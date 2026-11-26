// 海边小屋收藏存档服务端（v2）
// 规则只有一份：web/build.mjs 产出的 inventory-rules.mjs（与页面一字不差）。
// 本文件只负责：rev、幂等 id 账本、原子落盘、请求来源校验。见 docs/INVENTORY-V2.md。
// One cabin process owns this directory. Transactions are synchronous from
// read through rename, so two requests in that process cannot interleave.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Rules, { catalog } from '../web/dist/inventory-rules.mjs';

const FILE = 'cabin-inventory.json';
const MAX_BODY = 256 * 1024;
const MAX_STATE = 64 * 1024 * 1024;
const MAX_LEDGER = 100_000; // Do not evict IDs: an old retry must not become a new action.
const decoder = new TextDecoder('utf-8', { fatal: true });
const own = (obj, key) => Object.hasOwn(obj, key);
const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const { InventoryError } = Rules;

function snapshot(s) {
  return { ok: true, initialized: s.initialized, rev: s.rev, inventory: s.inventory };
}

function canonicalLocation(file) {
  try {
    return fs.realpathSync.native(file);
  } catch (e) {
    const parent = path.dirname(file);
    if (e.code !== 'ENOENT' || parent === file) throw e;
    return path.join(canonicalLocation(parent), path.basename(file));
  }
}

export function ensurePrivate(dir, webRoot) {
  if (!webRoot) return;
  const rel = path.relative(canonicalLocation(webRoot), canonicalLocation(dir));
  if (!rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep))) {
    throw new InventoryError(503, 'inventory_unavailable');
  }
}

function load(file) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    if (e.code === 'ENOENT') return Rules.freshState();
    throw e;
  }
  if (!st.isFile() || st.size > MAX_STATE) throw new InventoryError(503, 'inventory_corrupt');
  const bytes = fs.readFileSync(file);
  try {
    // v1 文件读进来自动升级成 v2（下次落盘就是 v2，旧服务端读不了 v2）。
    return Rules.parseState(JSON.parse(decoder.decode(bytes)), { catalog });
  } catch {
    throw new InventoryError(503, 'inventory_corrupt');
  }
}

function persist(dir, file, state) {
  const bytes = Buffer.from(JSON.stringify(state) + '\n');
  if (bytes.length > MAX_STATE) throw new InventoryError(507, 'inventory_capacity');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, `.${FILE}.${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // Windows indexers can briefly hold the previous file open after a read.
    // Keep the previous save intact throughout the atomic replacement.
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(temp, file);
        break;
      } catch (e) {
        if (process.platform !== 'win32' || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code) || attempt >= 5) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (attempt + 1));
      }
    }
  } catch (e) {
    try { fs.unlinkSync(temp); } catch {} // Only this transaction's staging file.
    throw e;
  }
  // Directory fsync is not supported by every OS (notably Windows). The data
  // file itself is flushed before rename; do not report a rollback after commit.
  try {
    const directory = fs.openSync(dir, 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } catch {}
}

export function createInventoryStore({ dataDir, webRoot, clock = Date.now }) {
  const dir = path.resolve(dataDir);
  const file = path.join(dir, FILE);
  function read() {
    ensurePrivate(dir, webRoot);
    return load(file);
  }
  return {
    get() { return snapshot(read()); },
    backup() { return read(); },
    assistantSummary() {
      const s = read();
      const inv = s.inventory;
      const placed = new Map();
      for (const item of Object.values(inv.placements || {})) {
        if (item && typeof item.kind === 'string') placed.set(item.kind, (placed.get(item.kind) || 0) + 1);
      }
      const collectibles = Object.entries(inv.found || {})
        .filter(([, row]) => row && row.n > 0)
        .map(([kind, row]) => ({ kind, count: row.n, available: Math.max(0, row.n - (placed.get(kind) || 0)) }));
      const snacks = (inv.snacks || []).map(({ sku, left }) => ({ sku, portions: left }));
      const fish = (inv.shore?.fish || []).map(({ kind, name, form, fed }) => ({ kind, ...(name ? { name } : {}), ...(form ? { form } : {}), fed }));
      return {
        ok: true, rev: s.rev, coins: inv.coins,
        snacks: { packages: snacks.length, portions: snacks.reduce((n, item) => n + item.portions, 0), items: snacks },
        fish: { count: fish.length, residents: fish, observedKinds: inv.shore?.observed || [] },
        collectibles: { kinds: collectibles.length, total: collectibles.reduce((n, item) => n + item.count, 0), items: collectibles },
      };
    },
    post(value) {
      const cmd = Rules.parseCommand(value, { catalog });
      const s = read();
      // Tabs may observe the same beach object at different times; the first timestamp wins.
      const hash = digest(cmd.op === 'collect' ? { ...cmd, at: 0 } : cmd);
      if (own(s.seen, cmd.id)) {
        if (s.seen[cmd.id] !== hash) throw new InventoryError(409, 'id_reused');
        return { ...snapshot(s), applied: false };
      }
      const result = Rules.apply(s, cmd, { catalog, clock });
      if (result === false) return { ...snapshot(s), applied: false };
      if (s.rev >= MAX_LEDGER) throw new InventoryError(507, 'inventory_capacity');
      s.seen[cmd.id] = hash;
      s.rev++;
      persist(dir, file, s);
      return { ...snapshot(s), applied: true, ...result };
    },
  };
}

export function guardLocalOrigin(req) {
  const port = req.socket.localPort;
  const host = req.headers.host?.toLowerCase();
  if (![`127.0.0.1:${port}`, `localhost:${port}`, ...(port === 80 ? ['127.0.0.1', 'localhost'] : [])].includes(host)) {
    throw new InventoryError(403, 'host_forbidden');
  }
  const originHost = port === 80 ? host.replace(/:80$/, '') : host;
  if ((req.headers.origin !== undefined && req.headers.origin !== `http://${originHost}`) ||
      (req.headers['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
    throw new InventoryError(403, 'origin_forbidden');
  }
}

function guard(req) {
  guardLocalOrigin(req);
  if (req.method === 'POST' && req.headers['x-cabin-inventory'] !== '1') {
    throw new InventoryError(403, 'csrf_header_required');
  }
}

export function readJson(req, maxBody = MAX_BODY) {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(req.headers['content-type'] || '') ||
      ![undefined, 'identity'].includes(req.headers['content-encoding'])) {
    throw new InventoryError(415, 'json_required');
  }
  if (Number(req.headers['content-length'] || 0) > maxBody) throw new InventoryError(413, 'body_too_large');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBody) {
        chunks.length = 0;
        reject(new InventoryError(413, 'body_too_large'));
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (size > maxBody) return;
      try {
        resolve(JSON.parse(decoder.decode(Buffer.concat(chunks, size))));
      } catch {
        reject(new InventoryError(400, 'invalid_json'));
      }
    });
    const fail = () => reject(new InventoryError(400, 'invalid_body'));
    req.on('aborted', fail);
    req.on('error', fail);
  });
}

export function createInventoryHandler({ dataDir, webRoot, sendJson, clock, summary = false }) {
  const store = createInventoryStore({ dataDir, webRoot, clock });
  return async (req, res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      guard(req);
      if (req.method === 'GET') return sendJson(res, 200, summary ? store.assistantSummary() : store.get());
      if (!summary && req.method === 'POST') return sendJson(res, 200, store.post(await readJson(req)));
      res.setHeader('Allow', summary ? 'GET' : 'GET, POST');
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    } catch (e) {
      if (res.destroyed || res.writableEnded) return;
      if (!req.complete) res.setHeader('Connection', 'close');
      const { status, code } = e instanceof InventoryError ? e : { status: 503, code: 'inventory_unavailable' };
      return sendJson(res, status, { ok: false, error: code });
    }
  };
}
