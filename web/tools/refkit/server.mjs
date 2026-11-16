// tools/refkit/server.mjs — 2D 反馈（参考图标注）的页面和 API，做成一个请求处理器。
// v3 的 serve.mjs（工作台左边切到「2D 反馈」）和 tools/refkit/serve.mjs（单开一个项目）共用它。Node 内置模块。
//
//   import { createRefkit } from './tools/refkit/server.mjs';
//   const kit = createRefkit({ refsDir, root, only, log });
//   if (kit.owns(pathname)) return kit.handle(req, res);      // the caller checks the Host header first
//
// A project is a sub-folder of refsDir that has questions.json, answers.json or an images/ folder
// (refs/face, refs/models … are not projects). `only` limits the handler to one project (standalone server).
// Routes (GET/HEAD unless noted; <p> = project name, URL-encoded):
//   /2d/  (+ app.css core.js view.js panel.js extra.js)   the page, project from ?p=<name>
//   /api/ref                         {dir, projects:[{name, images, drafts, round, submittedRound, savedAt}]}
//   POST /api/ref {name}             new project: refsDir/<name>/{images,drafts,exports} -> {ok, project}
//   /api/ref/<p>/state               {project, dir, images, sig, questions, questionsError, answers, answersError}
//   /api/ref/<p>/meta                {sig, questionsError}   (the page polls this every 3 s)
//   /api/ref/<p>/img/<images|drafts>/<file>   one image
//   PUT  /api/ref/<p>/answers        the page's answers -> answers.json (the page is the only writer)
//   POST /api/ref/<p>/upload?name=   raw image bytes -> images/<free name> -> {ok, key}
//   POST /api/ref/<p>/delete?key=images/<file>   moves it to trash/<stamp>__<file> -> {ok, trash}
//   POST /api/ref/<p>/export?key=    annotated jpeg -> exports/<group>__<name>.jpg
// Writes refuse a foreign Origin header (browsers send Origin on cross-site POST/PUT). Errors are {error} + 4xx/5xx.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'page');
const GROUPS = ['images', 'drafts'];
export const IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif' };
const STATIC = { '/2d/': 'index.html', '/2d/index.html': 'index.html', '/2d/app.css': 'app.css', '/2d/core.js': 'core.js',
  '/2d/view.js': 'view.js', '/2d/panel.js': 'panel.js', '/2d/extra.js': 'extra.js' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const LIMIT = { answers: 20e6, upload: 80e6, export: 30e6, json: 1e5 };
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const NAME_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]{0,59}$/u;
/** Project folder names: letters (Chinese too), digits, _ - . ; at most 60 characters. */
export const validName = (n) => typeof n === 'string' && NAME_RE.test(n) && !n.endsWith('.') && !DEVICE.test(n);

class HttpError extends Error {
  constructor(status, message, headers) { super(message); this.status = status; this.headers = headers || {}; }
}
const notAllowed = (allow) => new HttpError(405, `method not allowed (use ${allow})`, { Allow: allow });
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
export const exportName = (key) => key.replace('/', '__').replace(/\.[^.]+$/, '') + '.jpg';

function sendJson(res, status, obj, headers = {}) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store', ...headers });
  res.end(buf);
}
function sendFile(req, res, file, type, cache) {
  let st = null;
  try { st = fs.statSync(file); } catch { /* missing */ }
  if (!st || !st.isFile()) throw new HttpError(404, 'not found');
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}
/** Request body up to `limit` bytes; a bigger body is drained and answered with 413. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, over = Number(req.headers['content-length']) > limit;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) over = true;
      if (!over) chunks.push(c);
      else { chunks.length = 0; if (size > 2 * limit) req.destroy(); }
    });
    req.on('end', () => (over ? reject(new HttpError(413, `body larger than ${Math.round(limit / 1e6)} MB`)) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
    req.on('close', () => reject(new HttpError(400, 'request aborted')));   // no-op after 'end'
  });
}
const mime = (req) => String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
function needType(req, ok, what) { if (!ok(mime(req))) throw new HttpError(415, `Content-Type must be ${what}`); }
function parseJson(buf) {
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'body is not valid JSON'); }
}
function readJson(dir, file) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return { data: null, mtime: 0 };
  const mtime = Math.round(fs.statSync(p).mtimeMs);
  const txt = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  try { return { data: txt.trim() ? JSON.parse(txt) : null, mtime }; }
  catch (e) { return { data: null, mtime, error: `${file}: ${e.message}` }; }
}

// ---------------------------------------------------------------- one project folder
function listImages(dir) {
  const out = [];
  for (const g of GROUPS) {
    let names = [];
    try { names = fs.readdirSync(path.join(dir, g)); } catch { continue; }
    for (const name of names.sort(byName)) {
      if (!IMG[path.extname(name).toLowerCase()]) continue;
      let st = null;
      try { st = fs.statSync(path.join(dir, g, name)); } catch { continue; }
      if (st.isFile()) out.push({ key: g + '/' + name, group: g, name, size: st.size, mtime: Math.round(st.mtimeMs) });
    }
  }
  return out;
}
function signature(dir) {
  const qp = path.join(dir, 'questions.json');
  const q = fs.existsSync(qp) ? fs.statSync(qp).mtimeMs : 0;
  const s = 'q' + q + '|' + listImages(dir).map((i) => i.key + ':' + i.mtime).join(',');
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}
const listTrash = (dir) => { try { return fs.readdirSync(path.join(dir, 'trash')); } catch { return []; } };
/** A free file name in images/ for an upload. Names still in trash/ are taken too: answers.json keeps a deleted
 *  image's labels under its old name, so a new image must not inherit them. */
function safeName(dir, raw, type) {
  let name = path.basename(String(raw || '').replace(/\\/g, '/')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().replace(/^\.+/, '');
  let ext = path.extname(name).toLowerCase();
  if (!IMG[ext]) {
    ext = Object.keys(IMG).find((e) => IMG[e] === type) || '.png';
    name = (name || 'image') + ext;
  }
  let base = name.slice(0, name.length - ext.length).replace(/[. ]+$/, '').slice(0, 120) || 'image';
  if (DEVICE.test(base)) base = '_' + base;
  const trashed = new Set(listTrash(dir).map((t) => t.replace(/^\d{8}-\d{6}__/, '')));
  const taken = (n) => fs.existsSync(path.join(dir, 'images', n)) || trashed.has(n);
  let out = base + ext;
  for (let n = 2; taken(out); n++) out = `${base}-${n}${ext}`;
  return out;
}
/** Deleting moves the image to trash/<stamp>__<name>; its labels stay in answers.json, so moving the file back
 *  to images/ under the old name restores everything. */
function trashImage(dir, key) {
  const name = key.slice('images/'.length), dest = `${stamp()}__${name}`;
  fs.mkdirSync(path.join(dir, 'trash'), { recursive: true });
  fs.renameSync(path.join(dir, 'images', name), path.join(dir, 'trash', dest));
  fs.rmSync(path.join(dir, 'exports', exportName(key)), { force: true });
  return 'trash/' + dest;
}
function writeFileAtomic(p, data) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, p); } catch { fs.writeFileSync(p, data); fs.rmSync(tmp, { force: true }); }
}

// ---------------------------------------------------------------- the handler
/**
 * @param {object} o
 * @param {string} o.refsDir  folder that holds the projects (v3: refs/)
 * @param {string} [o.root]   paths under it are shown relative to it (dir fields, log lines)
 * @param {string|null} [o.only]  serve only this project (standalone server)
 * @param {(line: string) => void} [o.log]
 */
export function createRefkit({ refsDir, root = null, only = null, log = (s) => console.log(s) }) {
  const REFS = path.resolve(refsDir);
  const show = (p) => {
    const rel = root ? path.relative(root, p) : '';
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : p;
  };
  const backedUp = new Set();   // projects whose answers.json was already copied to answers.bak.json this run

  const isProject = (dir) => isDir(dir) && (fs.existsSync(path.join(dir, 'questions.json')) ||
    fs.existsSync(path.join(dir, 'answers.json')) || isDir(path.join(dir, 'images')));
  function info(name) {
    const dir = path.join(REFS, name), q = readJson(dir, 'questions.json').data || {}, a = readJson(dir, 'answers.json').data || {};
    const imgs = listImages(dir);
    return { name, images: imgs.filter((i) => i.group === 'images').length, drafts: imgs.filter((i) => i.group === 'drafts').length,
      round: Number(q.round) || 0, submittedRound: Number(a.submittedRound) || 0, savedAt: a.savedAt || null };
  }
  function listProjects() {
    let names = [];
    try { names = fs.readdirSync(REFS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* no refs dir */ }
    return names.filter((n) => validName(n) && (!only || n === only) && isProject(path.join(REFS, n))).sort(byName).map(info);
  }
  function project(raw) {
    let name;
    try { name = decodeURIComponent(raw); } catch { throw new HttpError(400, 'bad project name'); }
    if (!validName(name)) throw new HttpError(400, 'bad project name');
    const dir = path.join(REFS, name);
    if ((only && name !== only) || !isProject(dir)) throw new HttpError(404, 'no such project: ' + name);
    return { name, dir };
  }
  function createProject(name) {
    if (only) throw new HttpError(403, 'this server only serves ' + only);
    if (!validName(name)) throw new HttpError(400, '项目名只能用字母、数字、中文和 - _ .（最多 60 个字）');
    const dir = path.join(REFS, name);
    if (fs.existsSync(dir)) throw new HttpError(409, isProject(dir) ? '已经有这个项目了：' + name : '这个名字被别的文件夹占用了：' + name);
    for (const d of ['images', 'drafts', 'exports']) fs.mkdirSync(path.join(dir, d), { recursive: true });
    log(`2d: new project ${show(dir)}`);
    return info(name);
  }
  function writeAnswers(P, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'answers must be a JSON object');
    const p = path.join(P.dir, 'answers.json');
    if (!backedUp.has(P.dir) && fs.existsSync(p)) fs.copyFileSync(p, path.join(P.dir, 'answers.bak.json'));
    backedUp.add(P.dir);
    writeFileAtomic(p, JSON.stringify(data, null, 1));
  }
  function serveImage(req, res, P, group, raw, query) {
    let name;
    try { name = decodeURIComponent(raw); } catch { throw new HttpError(400, 'bad name'); }
    const type = IMG[path.extname(name).toLowerCase()];
    if (!type || name !== path.basename(name) || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /^\.+$/.test(name)) throw new HttpError(400, 'bad name');
    // the page adds ?v=<mtime>, so a changed file gets a new URL and the old one may be cached
    sendFile(req, res, path.join(P.dir, group, name), type, query.has('v') ? 'private, max-age=86400' : 'no-cache');
  }

  async function projectApi(req, res, P, rest, query) {
    const m = req.method;
    const img = /^img\/(images|drafts)\/([^/]+)$/.exec(rest);
    if (img) {
      if (m !== 'GET' && m !== 'HEAD') throw notAllowed('GET, HEAD');
      return serveImage(req, res, P, img[1], img[2], query);
    }
    if (rest === 'state' || rest === 'meta') {
      if (m !== 'GET') throw notAllowed('GET');
      const q = readJson(P.dir, 'questions.json');
      if (rest === 'meta') return sendJson(res, 200, { sig: signature(P.dir), questionsError: q.error || null });
      const a = readJson(P.dir, 'answers.json');
      return sendJson(res, 200, { project: P.name, dir: show(P.dir), images: listImages(P.dir), sig: signature(P.dir),
        questions: q.data, questionsError: q.error || null, answers: a.data, answersError: a.error || null });
    }
    if (rest === 'answers') {
      if (m !== 'PUT') throw notAllowed('PUT');
      needType(req, (t) => t === 'application/json', 'application/json');
      writeAnswers(P, parseJson(await readBody(req, LIMIT.answers)));
      return sendJson(res, 200, { ok: true, t: Date.now() });
    }
    if (rest === 'upload') {
      if (m !== 'POST') throw notAllowed('POST');
      needType(req, (t) => t.startsWith('image/'), 'an image type');
      const buf = await readBody(req, LIMIT.upload);
      if (!buf.length) throw new HttpError(400, 'empty upload');
      const name = safeName(P.dir, query.get('name'), mime(req));
      fs.mkdirSync(path.join(P.dir, 'images'), { recursive: true });
      fs.writeFileSync(path.join(P.dir, 'images', name), buf);
      log(`2d ${P.name}: uploaded images/${name} (${Math.round(buf.length / 1024)} KB)`);
      return sendJson(res, 200, { ok: true, key: 'images/' + name });
    }
    if (rest === 'delete') {
      if (m !== 'POST') throw notAllowed('POST');
      const key = query.get('key') || '';
      if (!key.startsWith('images/') || !listImages(P.dir).some((i) => i.key === key)) throw new HttpError(404, 'unknown image');
      const moved = trashImage(P.dir, key);
      log(`2d ${P.name}: deleted ${key} -> ${moved}`);
      return sendJson(res, 200, { ok: true, trash: moved });
    }
    if (rest === 'export') {
      if (m !== 'POST') throw notAllowed('POST');
      const key = query.get('key') || '';
      if (!listImages(P.dir).some((i) => i.key === key)) throw new HttpError(404, 'unknown image');
      needType(req, (t) => t === 'image/jpeg', 'image/jpeg');
      const buf = await readBody(req, LIMIT.export);
      if (!buf.length) throw new HttpError(400, 'empty export');
      fs.mkdirSync(path.join(P.dir, 'exports'), { recursive: true });
      fs.writeFileSync(path.join(P.dir, 'exports', exportName(key)), buf);
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(404, `no such api: ${m} /api/ref/${encodeURIComponent(P.name)}/${rest}`);
  }

  async function route(req, res) {
    const raw = String(req.url || '/'), qi = raw.indexOf('?');
    const p = (qi < 0 ? raw : raw.slice(0, qi)).split('#')[0], query = new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1).split('#')[0]);
    const m = req.method;
    if (m !== 'GET' && m !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && origin !== 'http://' + req.headers.host) throw new HttpError(403, 'forbidden origin');
    }
    if (p === '/2d') { res.writeHead(302, { Location: '/2d/' + (qi < 0 ? '' : raw.slice(qi)), 'Content-Length': 0 }); return res.end(); }
    if (STATIC[p]) {
      if (m !== 'GET' && m !== 'HEAD') throw notAllowed('GET, HEAD');
      const file = STATIC[p];
      return sendFile(req, res, path.join(PAGE, file), TYPES[path.extname(file)], 'no-store');
    }
    if (p === '/api/ref') {
      if (m === 'GET') return sendJson(res, 200, { dir: show(REFS), projects: listProjects() });
      if (m === 'POST') {
        needType(req, (t) => t === 'application/json', 'application/json');
        const body = parseJson(await readBody(req, LIMIT.json));
        return sendJson(res, 200, { ok: true, project: createProject(body && typeof body.name === 'string' ? body.name.trim() : '') });
      }
      throw notAllowed('GET, POST');
    }
    const hit = /^\/api\/ref\/([^/]+)\/(.+)$/.exec(p);
    if (hit) return projectApi(req, res, project(hit[1]), hit[2], query);
    throw new HttpError(404, 'not found');
  }

  return {
    refsDir: REFS,
    listProjects,
    owns: (p) => p === '/2d' || p.startsWith('/2d/') || p === '/api/ref' || p.startsWith('/api/ref/'),
    /** Answers the request (never throws): errors become {error} with a 4xx/5xx status. */
    async handle(req, res) {
      try { await route(req, res); } catch (e) {
        if (!req.complete) req.resume();   // refused before reading the body: drain it
        const status = e instanceof HttpError ? e.status : 500;
        if (status >= 500) console.error(e && e.stack ? e.stack : e);
        if (res.headersSent || res.destroyed) { res.destroy(); return; }
        sendJson(res, status, { error: status >= 500 ? `server error: ${e && e.message}` : e.message }, e.headers || {});
      }
    },
  };
}
