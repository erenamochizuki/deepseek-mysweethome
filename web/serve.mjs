#!/usr/bin/env node
// serve.mjs — v3 local server: static files + feedback API (docs/SPEC.md "HTTP"). Node built-ins only.
//   node serve.mjs [--port 5194] [--fb-dir feedback] [--ref-dir refs]   (both dirs are relative to this folder)
// Binds 127.0.0.1 only. Static (GET/HEAD): / -> 302 /studio.html · /<file> -> dist/ · /refs/ -> refs/ ·
// /feedback/ -> the feedback dir (screenshot of an item = /feedback/ + item.shot).
// API: GET /api/ping · GET /api/refs · GET|POST /api/fb · GET|PATCH|DELETE /api/fb/<id>
//      · GET|POST /api/girl3/edits[?model=v4], GET|POST /api/girl3/face-meta (whale-girl shape editor / 表情 panel:
//        save + rebuild, see docs/GIRL-V4.md).
// POST/PATCH need Content-Type: application/json (body ≤ 25 MB). Errors are {error} with a 4xx/5xx status.
// 2D 反馈 (reference-image annotation, tools/refkit/server.mjs): page /2d/?p=<project> · GET|POST /api/ref ·
//   /api/ref/<project>/{state,meta,img/…,answers,upload,delete,export}; projects are the sub-folders of --ref-dir.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { FbStore, FbError, localIso } from './tools/lib/fb-store.mjs';
import { createRefkit } from './tools/refkit/server.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const BODY_LIMIT = 25 * 1024 * 1024;

function parseArgs(argv) {
  const o = { port: 5194, fbDir: 'feedback', refDir: 'refs' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--fb-dir') o.fbDir = argv[++i];
    else if (a === '--ref-dir') o.refDir = argv[++i];
    else if (a === '-h' || a === '--help') { console.log('node serve.mjs [--port 5194] [--fb-dir feedback] [--ref-dir refs]'); process.exit(0); }
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) { console.error('--port must be an integer 1-65535'); process.exit(2); }
  if (!o.fbDir) { console.error('--fb-dir needs a value'); process.exit(2); }
  if (!o.refDir) { console.error('--ref-dir needs a value'); process.exit(2); }
  return o;
}
const opt = parseArgs(process.argv.slice(2));
const store = new FbStore(path.resolve(ROOT, opt.fbDir)).ensure();
// 2D 反馈 projects: <ref-dir>/<project>/ (default refs/); the page is tools/refkit/page
// The reference images (/refs/<name>, GET /api/refs) live in the same <ref-dir> (tests point it at a scratch folder).
const REFS_DIR = path.resolve(ROOT, opt.refDir);
const refkit = createRefkit({ refsDir: REFS_DIR, root: ROOT, log: (s) => console.log(`${localIso().slice(11, 19)} ${s}`) });
const MOUNTS = [['/refs/', REFS_DIR], ['/feedback/', store.dir], ['/', path.join(ROOT, 'dist')]];
// Only these Host headers are served (blocks DNS-rebinding pages that resolve their own name to 127.0.0.1).
const HOSTS = new Set([`127.0.0.1:${opt.port}`, `localhost:${opt.port}`, ...(opt.port === 80 ? ['127.0.0.1', 'localhost'] : [])]);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
};

function json(res, status, obj, headers = {}) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store', ...headers });
  res.end(buf);
}

/** JSON body (Content-Type application/json, ≤ BODY_LIMIT). Oversized bodies are drained, then 413. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') { req.resume(); reject(new FbError(415, 'Content-Type must be application/json')); return; }
    let size = 0, over = Number(req.headers['content-length']) > BODY_LIMIT;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) over = true;
      if (!over) chunks.push(c);
      else { chunks.length = 0; if (size > 2 * BODY_LIMIT) req.destroy(); }
    });
    req.on('end', () => {
      if (over) { reject(new FbError(413, `body larger than ${BODY_LIMIT / 1048576} MB`)); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new FbError(400, 'body is not valid JSON')); }
    });
    req.on('error', reject);
    req.on('close', () => reject(new FbError(400, 'request aborted')));
  });
}

// Path segments are decoded one by one; '.', '..', Windows device names and \ : * ? " < > | NUL are refused,
// and the result must stay inside the mount dir.
const BAD_SEG = /^(\.\.?|con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
function resolveStatic(base, rel) {
  const segs = [];
  for (const raw of rel.split('/')) {
    if (!raw) continue;
    let s;
    try { s = decodeURIComponent(raw); } catch { return null; }
    if (BAD_SEG.test(s) || /[\\:*?"<>|\0]/.test(s)) return null;
    segs.push(s);
  }
  const p = path.resolve(base, ...segs);
  return p === base || p.startsWith(base + path.sep) ? p : null;
}
function serveFile(req, res, file) {
  let st = null;
  try { st = fs.statSync(file); } catch { /* missing */ }
  if (!st || !st.isFile()) return json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
/** Image files directly in refs/, sorted (extra endpoint for the page's reference-image picker; URL = /refs/<name>). */
function listRefs() {
  try {
    return fs.readdirSync(REFS_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && IMAGE_EXT.has(path.extname(d.name).toLowerCase()))
      .map((d) => d.name).sort();
  } catch { return []; }
}
/** Optional build stamp for /api/ping: dist/build.json {"build": ...} if the build writes one. */
function buildInfo() {
  try { const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'build.json'), 'utf8')).build; return b == null ? undefined : b; }
  catch { return undefined; }
}
const withHeaders = (e, headers) => Object.assign(e, { headers });
const notAllowed = (allow) => withHeaders(new FbError(405, `method not allowed (use ${allow})`), { Allow: allow });

const FB_ITEM = /^\/api\/fb\/([^/]+)$/;

// ---- whale-girl editor: hand edits -> refs/models/<file>.edits.json, then rebuild glb + page ----
// ?model=v4 (default v3): the v4 head (rebuilt from the Tripo model) or the archived v3 head (docs/GIRL-V4.md)
const GIRL_MODELS = {
  v3: { file: 'whale-girl-head', build: ['tools/girl/build.mjs'] },
  v4: { file: 'whale-girl-head-v4', build: ['tools/girl/build.mjs', '--v4'] },
};
const girlModel = (req) => {
  const v = new URLSearchParams(String(req.url || '').split('?')[1] || '').get('model') || 'v3';
  if (!Object.hasOwn(GIRL_MODELS, v)) throw new FbError(400, 'unknown model ' + v.slice(0, 20));
  return { id: v, ...GIRL_MODELS[v], edits: path.join(ROOT, 'refs', 'models', GIRL_MODELS[v].file + '.edits.json') };
};
let girl3Busy = Promise.resolve();
const runNode = (args) => new Promise((resolve) => {
  execFile(process.execPath, args, { cwd: ROOT, timeout: 120000, windowsHide: true, maxBuffer: 4 << 20 }, (err, out, errOut) =>
    resolve({ ok: !err, log: (String(out || '') + String(errOut || '')).trim().slice(-2000) }));
});
function checkEdits(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new FbError(400, 'edits must be an object');
  const names = Object.keys(e);
  if (names.length > 5000) throw new FbError(400, 'too many edited blocks');
  for (const n of names) {
    const v = e[n];
    if (n.length > 80 || !v || typeof v !== 'object') throw new FbError(400, 'bad edit for ' + n.slice(0, 80));
    if (v.col != null && !/^#[0-9a-f]{6}$/i.test(String(v.col))) throw new FbError(400, 'bad colour for ' + n);
    for (const [k, d] of Object.entries(v.d || {})) {
      if (!/^\d{1,4}$/.test(k) || !Array.isArray(d) || d.length !== 3 || !d.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 500))
        throw new FbError(400, 'bad point offset in ' + n);
    }
  }
}
async function girl3Edits(req, res, m) {
  const G = girlModel(req);
  if (m === 'GET') {
    let data = { edits: {} };
    try { data = JSON.parse(fs.readFileSync(G.edits, 'utf8')); } catch { /* none yet */ }
    return json(res, 200, data);
  }
  if (m !== 'POST') throw notAllowed('GET, POST');
  const body = await readJson(req);
  checkEdits(body.edits);
  const job = girl3Busy.then(async () => {
    if (fs.existsSync(G.edits)) fs.copyFileSync(G.edits, G.edits + '.bak');
    const doc = { version: 1, model: G.file, saved: localIso(), units: 'design units (1 = 0.02 m), model space', edits: body.edits };
    fs.writeFileSync(G.edits, JSON.stringify(doc, null, 1));
    const t0 = Date.now(), a = await runNode(G.build), b = a.ok ? await runNode(['build.mjs']) : { ok: false, log: '' };
    return { ok: a.ok && b.ok, ms: Date.now() - t0, log: (a.log + '\n' + b.log).trim() };
  });
  girl3Busy = job.catch(() => {});
  const r = await job;
  return json(res, r.ok ? 200 : 500, r.ok ? { ok: true, ms: r.ms, log: r.log } : { error: 'rebuild failed', log: r.log });
}

// ---- whale-girl v3 expression annotations (studio 表情 panel) -> refs/face/face-meta.json, then regenerate the page ----
const FACE_META = path.join(ROOT, 'refs', 'face', 'face-meta.json');
function checkFaceMeta(m) {
  if (!m || typeof m !== 'object' || !m.cells || typeof m.cells !== 'object') throw new FbError(400, 'meta.cells must be an object');
  const ids = Object.keys(m.cells);
  if (!ids.length || ids.length > 64) throw new FbError(400, 'bad number of cells');
  const okBox = (b) => b && typeof b === 'object' && ['x', 'y', 'w', 'h'].every((k) => Number.isInteger(b[k]) && b[k] >= 0 && b[k] <= 1024);
  for (const id of ids) {
    const c = m.cells[id];
    if (!/^[\w-]{1,40}$/.test(id) || !c || typeof c !== 'object') throw new FbError(400, 'bad cell ' + id.slice(0, 40));
    if (typeof c.name !== 'string' || c.name.length > 40 || (c.note != null && (typeof c.note !== 'string' || c.note.length > 1000))) throw new FbError(400, 'bad name/note in ' + id);
    for (const k of ['eyeR', 'eyeL', 'mouth']) if (!okBox(c[k])) throw new FbError(400, `bad ${k} box in ${id}`);
  }
}
async function girl3FaceMeta(req, res, m) {
  if (m === 'GET') {
    let data = null;
    try { data = JSON.parse(fs.readFileSync(FACE_META, 'utf8')); } catch { /* none yet */ }
    return json(res, 200, data || { cells: {} });
  }
  if (m !== 'POST') throw notAllowed('GET, POST');
  const body = await readJson(req);
  checkFaceMeta(body.meta);
  const job = girl3Busy.then(async () => {
    if (fs.existsSync(FACE_META)) fs.copyFileSync(FACE_META, FACE_META + '.bak');
    fs.writeFileSync(FACE_META, JSON.stringify({ ...body.meta, saved: localIso() }, null, 1));
    const t0 = Date.now(), a = await runNode(['tools/girl/face-meta.mjs']), b = a.ok ? await runNode(['build.mjs']) : { ok: false, log: '' };
    return { ok: a.ok && b.ok, ms: Date.now() - t0, log: (a.log + '\n' + b.log).trim() };
  });
  girl3Busy = job.catch(() => {});
  const r = await job;
  return json(res, r.ok ? 200 : 500, r.ok ? { ok: true, ms: r.ms, log: r.log } : { error: 'rebuild failed', log: r.log });
}

async function api(req, res, p) {
  const m = req.method;
  if (p === '/api/ping') {
    if (m !== 'GET') throw notAllowed('GET');
    const build = buildInfo();
    return json(res, 200, build === undefined ? { ok: true } : { ok: true, build });
  }
  if (p === '/api/refs') {
    if (m !== 'GET') throw notAllowed('GET');
    return json(res, 200, { files: listRefs() });
  }
  if (p === '/api/fb') {
    if (m === 'GET') return json(res, 200, { items: store.list((name, e) => console.warn(`skip unreadable item ${name}: ${e.message}`)) });
    if (m === 'POST') return json(res, 200, { item: store.create(await readJson(req)) });
    throw notAllowed('GET, POST');
  }
  if (p === '/api/girl3/edits') return girl3Edits(req, res, m);
  if (p === '/api/girl3/face-meta') return girl3FaceMeta(req, res, m);
  const hit = FB_ITEM.exec(p);
  if (hit) {
    let id;
    try { id = decodeURIComponent(hit[1]); } catch { throw new FbError(400, 'bad id'); }
    store.checkId(id);
    if (m === 'GET') return json(res, 200, { item: store.get(id) });
    if (m === 'PATCH') return json(res, 200, { item: store.patch(id, await readJson(req)) });
    if (m === 'DELETE') return json(res, 200, { ok: true, id, moved: store.remove(id) });
    throw notAllowed('GET, PATCH, DELETE');
  }
  throw new FbError(404, `no such api: ${m} ${p}`);
}

async function handle(req, res) {
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) throw new FbError(403, 'bad Host header');
  const p = String(req.url || '/').split(/[?#]/)[0];
  if (!p.startsWith('/')) throw new FbError(400, 'bad request path');
  if (refkit.owns(p)) return refkit.handle(req, res);
  if (p.startsWith('/api/')) return api(req, res, p);
  if (req.method !== 'GET' && req.method !== 'HEAD') throw notAllowed('GET, HEAD');
  if (p === '/') { res.writeHead(302, { Location: '/studio.html', 'Content-Length': 0 }); return res.end(); }
  // no icon in dist/: answer 204 so browsers don't log a 404 console error on every page load
  if (p === '/favicon.ico' && !fs.existsSync(path.join(ROOT, 'dist', 'favicon.ico'))) { res.writeHead(204, { 'Cache-Control': 'max-age=86400' }); return res.end(); }
  for (const [prefix, base] of MOUNTS) {
    if (!p.startsWith(prefix)) continue;
    const file = resolveStatic(base, p.slice(prefix.length));
    if (!file) throw new FbError(404, 'not found');
    return serveFile(req, res, file);
  }
  throw new FbError(404, 'not found');
}

const server = http.createServer((req, res) => {
  const t0 = Date.now(), p = String(req.url || '/').split(/[?#]/)[0];
  res.on('finish', () => {
    // the 2D page polls /api/ref/<p>/meta every 3 s and autosaves often: only its uploads, deletes and errors are logged
    const quiet = p.startsWith('/api/ref/') && res.statusCode < 400 && (req.method === 'GET' || req.method === 'HEAD' || req.method === 'PUT' || p.endsWith('/export'));
    if ((p.startsWith('/api/') && !quiet) || res.statusCode >= 500) console.log(`${localIso().slice(11, 19)} ${req.method} ${p} ${res.statusCode} ${Date.now() - t0}ms`);
  });
  handle(req, res).catch((e) => {
    const status = e instanceof FbError ? e.status : 500;
    if (status >= 500) console.error(e && e.stack ? e.stack : e);
    if (res.headersSent || res.destroyed || !res.socket || res.socket.destroyed) { res.destroy(); return; }
    json(res, status, { error: status >= 500 ? `server error: ${e && e.message}` : e.message }, e.headers || {});
  });
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`port ${opt.port} is already in use (another serve.mjs?) - try --port <n>`);
  else console.error(e.stack || String(e));
  process.exit(1);
});
server.listen(opt.port, HOST, () => {
  const rel = (d) => path.relative(ROOT, d) || '.';
  console.log(`serve.mjs  http://${HOST}:${opt.port}/  ->  /studio.html`);
  console.log(`  dist: ${rel(path.join(ROOT, 'dist'))}   refs: ${rel(path.join(ROOT, 'refs'))}   feedback: ${rel(store.dir)}`);
  console.log(`  2D 反馈: http://${HOST}:${opt.port}/2d/   projects: ${rel(refkit.refsDir)}`);
});
