// 14-mcjar.js — 读玩家自己选的 Minecraft 客户端 jar：只取画方块要用的资源（blockstates、方块模型、方块贴图、colormap、平原群系），
// 缓存到 IndexedDB（按 jar 版本，玩家只选一次）；自带 PNG 解码（拿到原样的 RGBA，不经过浏览器的颜色管理）。
// 版权：这里不带任何 Mojang 的文件，全部在运行时从玩家的 jar 里读。
(function (V3) {
  'use strict';
  const J = V3.mcjar = {};
  J.CACHE_VER = 3;

  // 要保留的文件（其余 3 万多个条目不解压）。版本 2 起多存主世界的维度设置（雾和天空的颜色），
  // 版本 3 起多存箱子和床的实体贴图（19-mcentity.js 用）。
  const KEEP = [
    /^assets\/minecraft\/blockstates\/[^/]+\.json$/,
    /^assets\/minecraft\/models\/block\/.+\.json$/,
    /^assets\/minecraft\/textures\/block\/.+\.png(\.mcmeta)?$/,
    /^assets\/minecraft\/textures\/colormap\/[^/]+\.png$/,
    /^assets\/minecraft\/textures\/entity\/(chest|bed)\/[^/]+\.png$/,
    /^data\/minecraft\/worldgen\/biome\/plains\.json$/,
    /^data\/minecraft\/dimension_type\/overworld\.json$/,
    /^version\.json$/,
  ];
  J.wanted = (name) => KEEP.some((re) => re.test(name));

  const u16 = (b, p) => b[p] | (b[p + 1] << 8);
  const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
  const u32be = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  const utf8 = new TextDecoder('utf-8');

  async function toU8(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input && typeof input.arrayBuffer === 'function') return new Uint8Array(await input.arrayBuffer());
    throw new Error('mcjar: 不认识的输入（要 File / Blob / ArrayBuffer / Uint8Array）');
  }

  // 2026-11-09：老浏览器（实测 Edge 100）没有 DecompressionStream('deflate-raw')，读 jar 里的 deflate 条目会直接抛错。
  // 原生失败时退回 10-zip.js 的纯 JS inflate；'deflate'（zlib 头 + adler 尾）去掉 2 字节头再按 raw 解。
  async function streamInflate(data, fmt) {
    if (typeof DecompressionStream === 'function') {
      try {
        const s = new Blob([data]).stream().pipeThrough(new DecompressionStream(fmt));
        return new Uint8Array(await new Response(s).arrayBuffer());
      } catch (e) { /* 老浏览器：走下面的纯 JS 解压 */ }
    }
    const jsInflate = V3.zip && V3.zip.inflateRawJS;
    if (fmt === 'deflate-raw' && typeof jsInflate === 'function') return jsInflate(data);
    if (fmt === 'deflate' && typeof jsInflate === 'function' && data.length > 2) return jsInflate(data.subarray(2));
    throw new Error('这个浏览器不支持解压（缺少 DecompressionStream: ' + fmt + '）');
  }
  J.inflateRaw = (data) => streamInflate(data, 'deflate-raw');
  J.inflateZlib = (data) => streamInflate(data, 'deflate');

  // ---- zip 目录 ----
  // 返回 [{name, method, csize, usize, offset(本地头位置), flags}]
  J.listZip = function (b) {
    let eocd = -1;
    for (let p = b.length - 22; p >= Math.max(0, b.length - 22 - 65535); p--) {
      if (u32(b, p) === 0x06054b50) { eocd = p; break; }
    }
    if (eocd < 0) throw new Error('mcjar: 不是 zip/jar 文件（找不到目录结尾）');
    const count = u16(b, eocd + 10), cdOff = u32(b, eocd + 16);
    if (count === 0xffff || cdOff === 0xffffffff) throw new Error('mcjar: 不支持 zip64');
    const out = [];
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (u32(b, p) !== 0x02014b50) throw new Error('mcjar: 中央目录损坏（第 ' + i + ' 项）');
      const flags = u16(b, p + 8), method = u16(b, p + 10);
      const csize = u32(b, p + 20), usize = u32(b, p + 24);
      const nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32);
      const offset = u32(b, p + 42);
      const name = utf8.decode(b.subarray(p + 46, p + 46 + nl));
      out.push({ name, method, csize, usize, offset, flags });
      p += 46 + nl + xl + cl;
    }
    return out;
  };

  async function entryBytes(b, e, inflateRaw) {
    const p = e.offset;
    if (u32(b, p) !== 0x04034b50) throw new Error('本地头损坏：' + e.name);
    const start = p + 30 + u16(b, p + 26) + u16(b, p + 28);
    const raw = b.subarray(start, start + e.csize);
    if (e.method === 0) return raw.slice();
    if (e.method === 8) return await inflateRaw(raw);
    throw new Error('不支持的压缩方式 ' + e.method + '：' + e.name);
  }

  // 读 jar → pack。opts.inflateRaw 可以换成同步实现（Node 测试用 zlib），opts.filter 可换保留规则
  J.fromBytes = async function (input, opts = {}) {
    const b = await toU8(input);
    const filter = opts.filter || J.wanted;
    const inflateRaw = opts.inflateRaw || J.inflateRaw;
    const entries = J.listZip(b).filter((e) => !e.name.endsWith('/') && !(e.flags & 1) && filter(e.name));
    const files = new Map();
    const warnings = [];
    let next = 0;
    async function worker() {
      while (next < entries.length) {
        const e = entries[next++];
        try { files.set(e.name, await entryBytes(b, e, inflateRaw)); }
        catch (err) { warnings.push(String(err && err.message || err)); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(16, entries.length || 1) }, worker));
    const sorted = new Map([...files.keys()].sort().map((k) => [k, files.get(k)]));
    const pack = J.makePack(sorted, { jarSize: b.length, entryCount: entries.length, inflateZlib: opts.inflateZlib });
    pack.warnings.push(...warnings);
    if (!pack.counts.blockstates || !pack.counts.models) throw new Error('mcjar: 这个文件里没有方块模型（选的是 Minecraft 客户端 jar 吗？）');
    return pack;
  };

  J.fromFile = (file, opts) => J.fromBytes(file, opts);

  // ---- pack：按路径取文件 + 常用的取法 ----
  J.parseId = function (id, kind) {
    let s = String(id || '');
    let ns = 'minecraft';
    const c = s.indexOf(':');
    if (c >= 0) { ns = s.slice(0, c); s = s.slice(c + 1); }
    return { ns, path: s, full: ns + ':' + s, kind };
  };

  J.makePack = function (files, info = {}) {
    const jsonCache = new Map(), spriteCache = new Map();
    const pack = { files, warnings: [], errors: [] };
    pack.has = (p) => files.has(p);
    pack.bytes = (p) => files.get(p) || null;
    pack.text = (p) => (files.has(p) ? utf8.decode(files.get(p)) : null);
    pack.json = (p) => {
      if (jsonCache.has(p)) return jsonCache.get(p);
      let v = null;
      const t = pack.text(p);
      if (t != null) { try { v = JSON.parse(t); } catch (e) { pack.errors.push('JSON 解析失败：' + p + '：' + e.message); } }
      jsonCache.set(p, v);
      return v;
    };
    pack.blockstate = (name) => { const id = J.parseId(name); return pack.json('assets/' + id.ns + '/blockstates/' + id.path + '.json'); };
    pack.model = (name) => { const id = J.parseId(name); return pack.json('assets/' + id.ns + '/models/' + id.path + '.json'); };
    pack.texturePath = (name) => { const id = J.parseId(name); return 'assets/' + id.ns + '/textures/' + id.path + '.png'; };
    pack.hasTexture = (name) => files.has(pack.texturePath(name));
    pack.biome = (name) => pack.json('data/minecraft/worldgen/biome/' + name + '.json');
    pack.dimension = (name) => pack.json('data/minecraft/dimension_type/' + name + '.json');
    // 贴图 → Promise<sprite|null>（sprite 见 J.makeSprite）
    pack.sprite = (name) => {
      const p = pack.texturePath(name);
      if (spriteCache.has(p)) return spriteCache.get(p);
      const pr = (async () => {
        const bytes = files.get(p);
        if (!bytes) return null;
        try {
          const img = await J.decodePng(bytes, pack.inflateZlib);
          let meta = null;
          if (files.has(p + '.mcmeta')) meta = pack.json(p + '.mcmeta');
          return J.makeSprite(J.parseId(name).full, img, meta);
        } catch (e) { pack.errors.push('贴图读不出：' + p + '：' + e.message); return null; }
      })();
      spriteCache.set(p, pr);
      return pr;
    };
    pack.colormap = (name) => pack.sprite('minecraft:colormap/' + name);
    let ver = null;
    try { ver = files.has('version.json') ? JSON.parse(pack.text('version.json')) : null; } catch (e) { ver = null; }
    pack.version = ver ? { id: ver.id, name: ver.name, worldVersion: ver.world_version, buildTime: ver.build_time } : null;
    pack.jarSize = info.jarSize || 0;
    pack.key = info.key || ['v' + J.CACHE_VER, ver ? ver.id : 'unknown', ver ? ver.build_time : '', info.jarSize || 0].join('|');
    const counts = { blockstates: 0, models: 0, textures: 0, mcmeta: 0, colormap: 0, entity: 0 };
    let bytes = 0;
    for (const [k, v] of files) {
      bytes += v.length;
      if (k.includes('/blockstates/')) counts.blockstates++;
      else if (k.includes('/models/')) counts.models++;
      else if (k.includes('/textures/colormap/')) counts.colormap++;
      else if (k.includes('/textures/entity/')) counts.entity++;
      else if (k.endsWith('.mcmeta')) counts.mcmeta++;
      else if (k.includes('/textures/')) counts.textures++;
    }
    pack.counts = counts;
    pack.byteSize = bytes;
    pack.inflateZlib = info.inflateZlib || null;
    return pack;
  };

  // ---- 贴图：动画取第一帧；透明度按 uv 矩形统计（所有帧合起来） ----
  J.makeSprite = function (id, img, meta) {
    const anim = meta && meta.animation;
    let fw = img.width, fh = img.height;
    if (anim) {
      if (anim.width || anim.height) { fw = anim.width || img.width; fh = anim.height || img.height; }
      else { fw = fh = Math.min(img.width, img.height); }
    }
    const cols = Math.max(1, Math.floor(img.width / fw)), rows = Math.max(1, Math.floor(img.height / fh));
    const total = cols * rows;
    let order = [0];
    if (anim) {
      order = Array.isArray(anim.frames) && anim.frames.length
        ? anim.frames.map((f) => (typeof f === 'number' ? f : f && f.index) | 0).filter((i) => i >= 0 && i < total)
        : Array.from({ length: total }, (_, i) => i);
      if (!order.length) order = [0];
    }
    const tiles = [...new Set(order)];
    const first = order[0];
    const data = new Uint8Array(fw * fh * 4);
    const ox = (first % cols) * fw, oy = Math.floor(first / cols) * fh;
    for (let y = 0; y < fh; y++) {
      const src = ((oy + y) * img.width + ox) * 4;
      data.set(img.data.subarray(src, src + fw * 4), y * fw * 4);
    }
    return { id, w: fw, h: fh, data, image: img, cols, tiles, animated: !!anim, meta: meta || null };
  };

  // 'solid' | 'cutout' | 'translucent'；u/v 是 0..1（贴图一帧里的位置）
  J.spriteTransparency = function (sp, u0, v0, u1, v1) {
    const a0 = Math.min(u0, u1), a1 = Math.max(u0, u1), b0 = Math.min(v0, v1), b1 = Math.max(v0, v1);
    let x0 = Math.max(0, Math.floor(a0 * sp.w)), x1 = Math.min(sp.w, Math.ceil(a1 * sp.w));
    let y0 = Math.max(0, Math.floor(b0 * sp.h)), y1 = Math.min(sp.h, Math.ceil(b1 * sp.h));
    if (x1 <= x0) x1 = Math.min(sp.w, x0 + 1);
    if (y1 <= y0) y1 = Math.min(sp.h, y0 + 1);
    let cut = false, tr = false;
    const img = sp.image;
    for (const t of sp.tiles) {
      const ox = (t % sp.cols) * sp.w, oy = Math.floor(t / sp.cols) * sp.h;
      for (let y = y0; y < y1; y++) {
        let p = ((oy + y) * img.width + ox + x0) * 4 + 3;
        for (let x = x0; x < x1; x++, p += 4) {
          const a = img.data[p];
          if (a === 0) cut = true; else if (a < 255) tr = true;
        }
      }
    }
    return tr ? 'translucent' : cut ? 'cutout' : 'solid';
  };

  // 群系颜色：colormap 256×256；temp/rain 先夹到 0..1，rain 乘 temp
  J.climateColor = function (sp, temp, rain, fallback) {
    if (!sp) return fallback || null;
    const t = Math.min(1, Math.max(0, temp)), r = Math.min(1, Math.max(0, rain)) * t;
    const x = Math.floor((1 - t) * 255), y = Math.floor((1 - r) * 255);
    if (x >= sp.image.width || y >= sp.image.height) return fallback || null;
    const p = (y * sp.image.width + x) * 4;
    return [sp.image.data[p], sp.image.data[p + 1], sp.image.data[p + 2]];
  };

  // ---- PNG 解码（支持所有颜色类型 / 位深 / tRNS / 隔行） ----
  const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  J.decodePng = async function (input, inflate) {
    const b = await toU8(input);
    const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) throw new Error('不是 PNG');
    let p = 8, w = 0, h = 0, depth = 8, ctype = 6, interlace = 0, plte = null, trns = null;
    const idat = [];
    let idatLen = 0;
    while (p + 8 <= b.length) {
      const len = u32be(b, p);
      const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      const d = b.subarray(p + 8, p + 8 + len);
      if (type === 'IHDR') { w = u32be(d, 0); h = u32be(d, 4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
      else if (type === 'PLTE') plte = d;
      else if (type === 'tRNS') trns = d;
      else if (type === 'IDAT') { idat.push(d); idatLen += d.length; }
      else if (type === 'IEND') break;
      p += 12 + len;
    }
    if (!w || !h) throw new Error('PNG 没有 IHDR');
    if (w * h > 64 * 1024 * 1024) throw new Error('PNG 太大');
    const z = new Uint8Array(idatLen);
    let o = 0;
    for (const d of idat) { z.set(d, o); o += d.length; }
    const raw = await (inflate || J.inflateZlib)(z);
    return { width: w, height: h, data: pngPixels(raw, w, h, depth, ctype, interlace, plte, trns) };
  };

  function pngPixels(raw, w, h, depth, ctype, interlace, plte, trns) {
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
    if (!ch) throw new Error('PNG 颜色类型不支持：' + ctype);
    const bitsPP = ch * depth, bpp = Math.max(1, bitsPP >> 3);
    const out = new Uint8Array(w * h * 4);
    const maxV = (1 << Math.min(depth, 8)) - 1;
    const passes = interlace ? ADAM7 : [[0, 0, 1, 1]];
    let pos = 0;
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const rowLen = Math.ceil((pw * bitsPP) / 8);
      let prev = new Uint8Array(rowLen), cur = new Uint8Array(rowLen);
      for (let yy = 0; yy < ph; yy++) {
        const f = raw[pos++];
        for (let i = 0; i < rowLen; i++) {
          const x = raw[pos + i], a = i >= bpp ? cur[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
          let v;
          if (f === 0) v = x;
          else if (f === 1) v = x + a;
          else if (f === 2) v = x + up;
          else if (f === 3) v = x + ((a + up) >> 1);
          else if (f === 4) {
            const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c);
            v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
          } else throw new Error('PNG 过滤类型不对：' + f);
          cur[i] = v & 255;
        }
        pos += rowLen;
        const y = y0 + yy * dy;
        for (let xx = 0; xx < pw; xx++) {
          const x = x0 + xx * dx;
          const q = (y * w + x) * 4;
          const s = (c) => {
            if (depth === 8) return cur[xx * ch + c];
            if (depth === 16) return cur[(xx * ch + c) * 2];
            const bit = (xx * ch + c) * depth;
            return (cur[bit >> 3] >> (8 - depth - (bit & 7))) & maxV;
          };
          const full = (c) => (depth === 16 ? (cur[(xx * ch + c) * 2] << 8) | cur[(xx * ch + c) * 2 + 1] : s(c));
          const sc = (v) => (depth < 8 ? Math.round((v * 255) / maxV) : v);
          if (ctype === 3) {
            const idx = s(0);
            out[q] = plte ? plte[idx * 3] : 0; out[q + 1] = plte ? plte[idx * 3 + 1] : 0; out[q + 2] = plte ? plte[idx * 3 + 2] : 0;
            out[q + 3] = trns && idx < trns.length ? trns[idx] : 255;
          } else if (ctype === 0) {
            const g = sc(s(0));
            out[q] = out[q + 1] = out[q + 2] = g;
            out[q + 3] = trns && trns.length >= 2 && full(0) === ((trns[0] << 8) | trns[1]) ? 0 : 255;
          } else if (ctype === 2) {
            out[q] = s(0); out[q + 1] = s(1); out[q + 2] = s(2);
            out[q + 3] = trns && trns.length >= 6 && full(0) === ((trns[0] << 8) | trns[1]) && full(1) === ((trns[2] << 8) | trns[3]) && full(2) === ((trns[4] << 8) | trns[5]) ? 0 : 255;
          } else if (ctype === 4) {
            const g = s(0);
            out[q] = out[q + 1] = out[q + 2] = g; out[q + 3] = s(1);
          } else {
            out[q] = s(0); out[q + 1] = s(1); out[q + 2] = s(2); out[q + 3] = s(3);
          }
        }
        const t = prev; prev = cur; cur = t;
      }
    }
    return out;
  }
  J._pngPixels = pngPixels;

  // ---- IndexedDB 缓存（只留一份：最后一次选的 jar） ----
  const DB = 'v3-mcjar', STORE = 'packs';
  function idb() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('没有 IndexedDB')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function idbDo(mode, fn) {
    return idb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); res(req && 'result' in req ? req.result : undefined); };
      tx.onerror = () => { db.close(); rej(tx.error); };
      tx.onabort = () => { db.close(); rej(tx.error || new Error('IndexedDB 中止')); };
    }));
  }
  J.serialize = function (pack) {
    const names = [...pack.files.keys()];
    const offsets = new Uint32Array(names.length + 1);
    let n = 0;
    names.forEach((k, i) => { offsets[i] = n; n += pack.files.get(k).length; });
    offsets[names.length] = n;
    const blob = new Uint8Array(n);
    names.forEach((k, i) => blob.set(pack.files.get(k), offsets[i]));
    return { key: pack.key, version: pack.version, jarSize: pack.jarSize, savedAt: Date.now(), names, offsets, blob };
  };
  J.deserialize = function (rec) {
    const files = new Map();
    rec.names.forEach((k, i) => files.set(k, rec.blob.subarray(rec.offsets[i], rec.offsets[i + 1])));
    const pack = J.makePack(files, { jarSize: rec.jarSize, key: rec.key });
    pack.fromCache = true;
    pack.savedAt = rec.savedAt;
    return pack;
  };
  const progress = V3.cabinProgress;
  const localRecord = () => idbDo('readonly', st => st.get('current'));
  progress?.legacy('texturePack', localRecord);
  J.cacheSave = (pack) => progress ? progress.write('texturePack', J.serialize(pack)) : idbDo('readwrite', (st) => { st.clear(); return st.put(J.serialize(pack), 'current'); });
  // 旧版本存的缓存（key 不是 v<CACHE_VER>| 开头）不用，让玩家重新选一次 jar
  J.cacheUsable = (rec) => !!(rec && rec.names && String(rec.key || '').startsWith('v' + J.CACHE_VER + '|'));
  J.cacheRecord = progress ? async () => progress.read('texturePack') : localRecord;
  J.cacheLoad = () => J.cacheRecord().then((rec) => (J.cacheUsable(rec) ? J.deserialize(rec) : null));
  J.cacheClear = () => progress ? progress.write('texturePack', null) : idbDo('readwrite', (st) => st.clear());
  // 选了 jar：读 + 存缓存（缓存失败不影响使用）
  J.open = async function (file, opts) {
    const pack = await J.fromFile(file, opts);
    try { await J.cacheSave(pack); pack.cached = true; } catch (e) { pack.cached = false; pack.warnings.push('缓存没存上：' + e.message); }
    return pack;
  };
})(window.V3);
