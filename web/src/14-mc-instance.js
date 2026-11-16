// Browser-local Minecraft instance binding. The caller owns the picker and prompts.
// bind/refresh/current -> null or {name, layers, modIds}; layers are low to high priority.
// Only the directory handle is persisted. Pack contents are read on demand, never uploaded.
(function (V3) {
  'use strict';
  const MB = 1024 * 1024, KB = 1024;
  const MAX_ZIP = 2 * 1024 * MB, MAX_CD = 8 * MB, SCAN_CD = 64 * MB;
  const MAX_OPTIONS = 256 * KB, MAX_META = 256 * KB, MAX_TEXTURE = 8 * MB;
  const MAX_PACKS = 64, MAX_MODS = 1024, MAX_DIR_ENTRIES = 4096, MAX_PATH = 512;
  const DB = 'v3-mc-instance', STORE = 'binding', KEY = 'directory';
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const zipNames = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const modFiles = new Set(['fabric.mod.json', 'quilt.mod.json', 'META-INF/neoforge.mods.toml', 'META-INF/mods.toml']);
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (u16(b, i) | (u16(b, i + 2) << 16)) >>> 0;
  const fail = () => { throw new Error('Invalid or oversized Minecraft archive data'); };

  // All filesystem lookups use individual child names, never paths or normalization.
  function safePart(name) {
    return typeof name === 'string' && name.length > 0 && name.length <= 255 &&
      !/[\\/:\x00-\x1f\x7f]/.test(name) && !/[. ]$/.test(name);
  }
  function textureLimit(path) {
    if (typeof path !== 'string' || path.length > MAX_PATH ||
        !/^assets\/[a-z0-9_.-]+\/textures\/block\/(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.png(?:\.mcmeta)?$/.test(path)) return 0;
    const parts = path.split('/');
    if (parts.length > 32 || !parts.every(safePart)) return 0;
    return path.endsWith('.mcmeta') ? MAX_META : MAX_TEXTURE;
  }

  async function slice(file, start, size) {
    if (start < 0 || size < 0 || start + size > file.size) fail();
    const data = new Uint8Array(await file.slice(start, start + size).arrayBuffer());
    if (data.length !== size) fail();
    return data;
  }
  async function child(dir, name, kind) {
    try { return await (kind === 'file' ? dir.getFileHandle(name) : dir.getDirectoryHandle(name)); }
    catch (_) { return null; }
  }
  async function readFile(dir, name, limit) {
    const item = await child(dir, name, 'file');
    if (!item) return null;
    const file = await item.getFile();
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limit) return null;
    return slice(file, 0, file.size);
  }

  // Classic ZIP only, no split archives. Read the tail and central directory, then only
  // a requested entry's header and payload. Never allocate the whole ZIP or trust its lengths.
  async function openZip(file, limitFor, budget) {
    const size = file.size;
    if (!Number.isSafeInteger(size) || size < 22 || size > MAX_ZIP) return null;
    let tailStart = size - 22, tail = await slice(file, tailStart, 22), e = 0;
    if (u32(tail, 0) !== 0x06054b50 || u16(tail, 20)) {
      // The usual no-comment case above reads no payload, even in tiny archives.
      tailStart = Math.max(0, size - 65557);
      tail = await slice(file, tailStart, size - tailStart);
      for (e = tail.length - 22; e >= 0; e--) {
        if (u32(tail, e) === 0x06054b50 && e + 22 + u16(tail, e + 20) === tail.length) break;
      }
    }
    if (e < 0 || u16(tail, e + 4) || u16(tail, e + 6)) return null;
    const count = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdStart = u32(tail, e + 16);
    if (count === 65535 || u16(tail, e + 8) !== count || count * 46 > cdSize ||
        cdStart + cdSize !== tailStart + e || cdSize > MAX_CD || cdSize > budget.left || count > budget.entries) return null;
    budget.left -= cdSize;
    budget.entries -= count;
    const cd = cdStart >= tailStart ? tail.subarray(cdStart - tailStart, e) : await slice(file, cdStart, cdSize);
    const entries = new Map();
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50 || u16(cd, p + 34)) return null;
      const nameLen = u16(cd, p + 28);
      const next = p + 46 + nameLen + u16(cd, p + 30) + u16(cd, p + 32);
      if (next > cd.length) return null;
      let name = '';
      if (nameLen && nameLen <= MAX_PATH) {
        try { name = zipNames.decode(cd.subarray(p + 46, p + 46 + nameLen)); } catch (_) { /* not a targeted path */ }
      }
      const limit = limitFor(name);
      if (limit) {
        const flags = u16(cd, p + 8), method = u16(cd, p + 10), crc = u32(cd, p + 16);
        const csize = u32(cd, p + 20), usize = u32(cd, p + 24), off = u32(cd, p + 42);
        const usable = !(flags & ~0x80e) && (method === 8 || (method === 0 && csize === usize)) &&
          usize <= limit && csize <= limit + 64 * KB && off + 30 + nameLen + csize <= cdStart;
        entries.set(name, usable && !entries.has(name) ? { flags, method, crc, csize, usize, off, nameLen } : null);
      }
      p = next;
    }
    if (p !== cd.length) return null;
    let hasEntries = false;
    for (const entry of entries.values()) if (entry) { hasEntries = true; break; }
    return {
      hasEntries,
      async read(name) {
        const entry = entries.get(name);
        if (!entry) return null;
        const { flags, method, crc, csize, usize, off, nameLen } = entry;
        if (budget.metadata !== undefined) {
          if (csize + usize > budget.metadata) return null;
          budget.metadata -= csize + usize;
        }
        const header = await slice(file, off, 30 + nameLen);
        if (u32(header, 0) !== 0x04034b50 || u16(header, 6) !== flags || u16(header, 8) !== method ||
            u16(header, 26) !== nameLen || zipNames.decode(header.subarray(30)) !== name) return null;
        if (!(flags & 8) && (u32(header, 14) !== crc || u32(header, 18) !== csize || u32(header, 22) !== usize)) return null;
        const start = off + 30 + nameLen + u16(header, 28);
        if (start + csize > cdStart) return null;
        const compressed = await slice(file, start, csize);
        const bytes = method === 0 ? compressed : inflateBounded(compressed, usize);
        return bytes.length === usize && crc32(bytes) === crc ? bytes : null;
      },
    };
  }

  const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value;
  });
  function crc32(bytes) {
    let c = 0xffffffff;
    for (const byte of bytes) c = (c >>> 8) ^ crcTable[(c ^ byte) & 255];
    return (c ^ 0xffffffff) >>> 0;
  }

  // Bounded RFC 1951 decoder: the older shared ZIP/JAR helpers grow their buffers
  // from actual output, so a dishonest central directory can evade their size checks.
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  function tree(lengths, max) {
    const counts = new Uint16Array(max + 1), next = new Uint16Array(max + 1), symbols = new Uint16Array(lengths.length);
    for (const length of lengths) if (length) counts[length]++;
    let free = 1;
    for (let i = 1; i <= max; i++) {
      next[i] = next[i - 1] + counts[i - 1];
      free = free * 2 - counts[i];
      if (free < 0) fail();
    }
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[next[lengths[i]]++] = i;
    return { counts, symbols };
  }
  const FIXED_LIT = tree(Uint8Array.from({ length: 288 }, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8), 15);
  const FIXED_DIST = tree(new Uint8Array(32).fill(5), 15);
  function inflateBounded(src, max) {
    let at = 0, bits = 0, have = 0, len = 0, blocks = 0, last;
    const out = new Uint8Array(max);
    function take(n) {
      while (have < n) {
        if (at >= src.length) fail();
        bits |= src[at++] << have;
        have += 8;
      }
      const result = bits & ((1 << n) - 1);
      bits >>>= n;
      have -= n;
      return result;
    }
    function symbol({ counts, symbols }) {
      let code = 0, first = 0, index = 0;
      for (let n = 1; n < counts.length; n++) {
        code = (code << 1) | take(1);
        const count = counts[n];
        if (code >= first && code < first + count) return symbols[index + code - first];
        index += count;
        first = (first + count) << 1;
      }
      fail();
    }
    do {
      if (++blocks > 65536) fail();
      last = take(1);
      const type = take(2);
      if (type === 0) {
        bits = have = 0;
        const n = take(16), check = take(16);
        if ((n ^ check) !== 65535 || at + n > src.length || len + n > max) fail();
        out.set(src.subarray(at, at + n), len);
        at += n; len += n;
        continue;
      }
      if (type === 3) fail();
      let lit = FIXED_LIT, dist = FIXED_DIST;
      if (type === 2) {
        const nl = take(5) + 257, nd = take(5) + 1, nc = take(4) + 4;
        if (nl > 286) fail();
        const codes = new Uint8Array(19), lengths = new Uint8Array(nl + nd);
        for (let i = 0; i < nc; i++) codes[CODE_ORDER[i]] = take(3);
        const codeTree = tree(codes, 7);
        for (let i = 0; i < lengths.length;) {
          const code = symbol(codeTree);
          if (code < 16) lengths[i++] = code;
          else {
            if (code === 16 && !i) fail();
            const n = code === 16 ? take(2) + 3 : code === 17 ? take(3) + 3 : take(7) + 11;
            if (i + n > lengths.length) fail();
            lengths.fill(code === 16 ? lengths[i - 1] : 0, i, i + n);
            i += n;
          }
        }
        if (!lengths[256]) fail();
        lit = tree(lengths.subarray(0, nl), 15);
        dist = tree(lengths.subarray(nl), 15);
      }
      for (;;) {
        const s = symbol(lit);
        if (s === 256) break;
        if (s < 256) {
          if (len >= max) fail();
          out[len++] = s;
        } else {
          const l = s - 257;
          if (l >= LBASE.length) fail();
          const n = LBASE[l] + take(LEXTRA[l]), d = symbol(dist);
          if (d >= DBASE.length) fail();
          const back = DBASE[d] + take(DEXTRA[d]);
          if (back > len || len + n > max) fail();
          for (let i = 0; i < n; i++) { out[len] = out[len - back]; len++; }
        }
      }
    } while (!last);
    if (at !== src.length) fail();
    return out.subarray(0, len);
  }

  // Optional companion for callers decoding a local PNG. Pass a cap derived from
  // validated IHDR dimensions/format, not from PNG data or a caller-supplied archive size.
  function inflateZlib(bytes, maxBytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 6 || bytes.length > MAX_TEXTURE ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 32 * MB ||
        (bytes[0] & 15) !== 8 || (bytes[0] >>> 4) > 7 || (bytes[1] & 32) ||
        ((bytes[0] << 8) | bytes[1]) % 31) fail();
    const end = bytes.length - 4;
    const raw = inflateBounded(bytes.subarray(2, end), maxBytes);
    let a = 1, b = 0;
    for (const n of raw) { a = (a + n) % 65521; b = (b + a) % 65521; }
    if (b !== ((bytes[end] << 8) | bytes[end + 1]) || a !== ((bytes[end + 2] << 8) | bytes[end + 3])) fail();
    return raw;
  }

  async function enabledPacks(root) {
    // Missing, oversized, or malformed options never means "enable all". Ignore built-in,
    // server and mod packs: only the modern explicit file/<single local name> form is local.
    try {
      const bytes = await readFile(root, 'options.txt', MAX_OPTIONS);
      if (!bytes) return [];
      const lines = utf8.decode(bytes).split(/\r?\n/).filter((line) => line.startsWith('resourcePacks:'));
      if (lines.length !== 1) return [];
      const values = JSON.parse(lines[0].slice('resourcePacks:'.length));
      if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) return [];
      const names = new Set();
      for (let i = values.length - 1; i >= 0 && names.size < MAX_PACKS; i--) {
        const value = values[i], name = value.slice(5);
        if (value.startsWith('file/') && safePart(name)) names.add(name);
      }
      return Array.from(names).reverse();
    } catch (_) { return []; }
  }

  async function packLayers(root, active, canRead) {
    const names = await enabledPacks(root);
    if (!names.length || !active()) return [];
    const packs = await child(root, 'resourcepacks', 'directory');
    if (!packs) return [];
    const layers = [], budget = { left: SCAN_CD, entries: 200000 };
    // Spend the ZIP indexing budget on higher-priority packs first.
    for (const name of names.reverse()) {
      if (!active()) break;
      try {
        const dir = await child(packs, name, 'directory');
        const assets = dir && await child(dir, 'assets', 'directory');
        let read;
        if (assets) {
          read = async (path, limit) => {
            const parts = path.split('/');
            let folder = assets;
            for (let i = 1; i < parts.length - 1; i++) {
              folder = await child(folder, parts[i], 'directory');
              if (!folder) return null;
            }
            return readFile(folder, parts[parts.length - 1], limit);
          };
        } else if (!dir && /\.zip$/i.test(name)) {
          const zip = await child(packs, name, 'file');
          const index = zip && await openZip(await zip.getFile(), textureLimit, budget);
          if (index && index.hasEntries) read = index.read;
        }
        if (read) layers.push(Object.freeze({ name, async read(path) {
          const limit = textureLimit(path);
          if (!limit || !await canRead()) return null;
          try {
            const bytes = await read(path, limit);
            return active() ? bytes : null;
          } catch (_) { return null; }
        } }));
      } catch (_) { /* Ignore an individual missing/corrupt pack. */ }
    }
    return layers.reverse();
  }

  const validId = (id) => typeof id === 'string' && id.length >= 2 && id.length <= 64 &&
    /^[a-z][a-z0-9_-]*$/.test(id) && !/\s/.test(id);
  // Targeted TOML extraction, not a general TOML evaluator. Only the modId key in
  // top-level [[mods]] records counts. Track strings and arrays so multiline descriptions,
  // dependencies, and comments cannot masquerade as installed mods.
  function tomlIds(text) {
    const ids = [];
    let inMods = false, id = null, seen = false, quote = '', multi = false;
    const stack = [];
    const save = () => { if (inMods && validId(id)) ids.push(id); };
    for (const line of text.split(/\r?\n/)) {
      if (!quote && !stack.length) {
        if (/^\s*\[/.test(line)) {
          save();
          inMods = /^\s*\[\[\s*(?:mods|"mods"|'mods')\s*\]\]\s*(?:#.*)?$/.test(line);
          id = null; seen = false;
          continue;
        }
        if (inMods && /^\s*(?:modId|"modId"|'modId')\s*=/.test(line)) {
          const m = /^\s*(?:modId|"modId"|'modId')\s*=\s*(["'])([a-z][a-z0-9_-]*)\1\s*(?:#.*)?$/.exec(line);
          id = !seen && m ? m[2] : null;
          seen = true;
        }
      }
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
          if (c === '\\' && quote === '"') { i++; continue; }
          if (c !== quote) continue;
          if (!multi) { quote = ''; continue; }
          let run = 1;
          while (line[i + run] === quote) run++;
          if (run > 5) return [];
          if (run >= 3) quote = '';
          i += run - 1;
        } else if (c === '#') break;
        else if (c === '"' || c === "'") {
          quote = c; multi = line[i + 1] === c && line[i + 2] === c;
          if (multi) i += 2;
        } else if (c === '[' || c === '{') {
          if (stack.length >= 32) return [];
          stack.push(c === '[' ? ']' : '}');
        } else if ((c === ']' || c === '}') && stack.pop() !== c) return [];
      }
      if (quote && !multi) return [];
    }
    if (quote || stack.length) return [];
    save();
    return ids;
  }
  async function installedMods(root, active) {
    const ids = new Set();
    const mods = await child(root, 'mods', 'directory');
    if (!mods || typeof mods.entries !== 'function') return ids;
    const budget = { left: SCAN_CD, entries: 500000, metadata: 32 * MB };
    let visited = 0, jars = 0;
    try {
      for await (const [name, handle] of mods.entries()) {
        if (!active() || ++visited > MAX_DIR_ENTRIES || jars >= MAX_MODS || budget.left <= 0) break;
        if (handle.kind !== 'file' || !/\.jar$/i.test(name) || !safePart(name)) continue;
        jars++;
        try {
          const zip = await openZip(await handle.getFile(), (path) => modFiles.has(path) ? MAX_META : 0, budget);
          if (!zip || !zip.hasEntries) continue;
          for (const path of modFiles) {
            try {
              const bytes = await zip.read(path);
              if (!bytes) continue;
              const text = utf8.decode(bytes);
              let found;
              if (path.endsWith('.toml')) found = tomlIds(text);
              else {
                const json = JSON.parse(text);
                const manifest = path === 'quilt.mod.json' ? json && json.quilt_loader : json;
                found = [manifest && Object.hasOwn(manifest, 'id') ? manifest.id : null];
              }
              for (const id of found) if (validId(id)) ids.add(id);
            } catch (_) { /* Skip corrupt metadata without masking other installed mods. */ }
          }
        } catch (_) { /* Bad JAR, not an installed-mod signal. */ }
      }
    } catch (_) { /* The directory might disappear while reading. */ }
    return ids;
  }

  async function settings(mode, operation) {
    const db = await new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = window.indexedDB.open(DB, 1);
      let blocked = false;
      req.onupgradeneeded = () => { if (!blocked) req.result.createObjectStore(STORE); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => { blocked = true; reject(new Error('Minecraft binding storage is blocked')); };
      req.onsuccess = () => { if (blocked) req.result.close(); else resolve(req.result); };
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = operation(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onabort = () => reject(tx.error || new Error('Minecraft binding storage aborted'));
      });
    } finally { db.close(); }
  }

  function isDirectory(dir) {
    return !!dir && dir.kind === 'directory' && typeof dir.name === 'string' && typeof dir.queryPermission === 'function' &&
      typeof dir.getDirectoryHandle === 'function' && typeof dir.getFileHandle === 'function';
  }
  async function allowed(dir, mayPrompt) {
    try {
      const opts = { mode: 'read' };
      if (await dir.queryPermission(opts) === 'granted') return true;
      return mayPrompt && typeof dir.requestPermission === 'function' && await dir.requestPermission(opts) === 'granted';
    } catch (_) { return false; }
  }
  let loaded = false, handle = null, revision = 0, snapshot = null, restoring = null, scanning = null;
  let writes = Promise.resolve();
  function setHandle(dir) {
    loaded = true; handle = dir; revision++; snapshot = null; scanning = null;
  }
  function restore() {
    if (loaded) return Promise.resolve(handle);
    if (!restoring) {
      const version = revision;
      restoring = settings('readonly', (store) => store.get(KEY)).then((dir) => {
        if (version === revision) setHandle(isDirectory(dir) ? dir : null);
        return handle;
      }).catch(() => handle).finally(() => { restoring = null; });
    }
    return restoring;
  }
  function copy(value) {
    return value ? { name: value.name, layers: value.layers.slice(), modIds: new Set(value.modIds) } : null;
  }
  async function getCurrent(force, mayPrompt) {
    const dir = loaded ? handle : await restore(), version = revision;
    const active = () => dir === handle && version === revision;
    if (!dir || !active()) return null;
    if (!await allowed(dir, mayPrompt) || !active()) {
      if (active()) snapshot = null;
      return null;
    }
    if (!force && snapshot) return copy(snapshot);
    if (!scanning) {
      let permissionCheck = null;
      const canRead = async () => {
        if (!active()) return false;
        if (!permissionCheck) permissionCheck = allowed(dir, false).finally(() => { permissionCheck = null; });
        return await permissionCheck && active();
      };
      const scan = Promise.all([packLayers(dir, active, canRead), installedMods(dir, active)]).then(([layers, modIds]) => {
        if (!active()) return null;
        snapshot = { name: dir.name, layers, modIds };
        return snapshot;
      }).finally(() => { if (scanning === scan) scanning = null; });
      scanning = scan;
    }
    return copy(await scanning);
  }
  function persist(dir) {
    const operation = writes.then(async () => {
      await settings('readwrite', (store) => dir ? store.put(dir, KEY) : store.delete(KEY));
      setHandle(dir);
      return revision;
    });
    writes = operation.catch(() => {});
    return operation;
  }

  V3.mcInstance = {
    async bind(dir) {
      if (!isDirectory(dir)) throw new TypeError('A Minecraft directory handle is required');
      const version = await persist(dir);
      return revision === version ? getCurrent(false, false) : null;
    },
    refresh({ requestPermission = false } = {}) { return getCurrent(true, requestPermission === true); },
    current() { return getCurrent(false, false); },
    async forget() { await persist(null); },
    inflateZlib,
  };
})(window.V3);
