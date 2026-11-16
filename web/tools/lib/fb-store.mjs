// tools/lib/fb-store.mjs — feedback items on disk, shared by serve.mjs (HTTP API) and tools/fb.mjs (CLI).
// Layout of a feedback dir: items/<id>.json (pretty UTF-8), shots/<id>.png|.jpg|.webp, trash/ (deleted).
// Node built-ins only. Item format: docs/SPEC.md "Feedback item".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ID_RE = /^fb-\d{8}-\d{6}-[a-z0-9]{3,6}$/;
export const STATUSES = ['open', 'doing', 'fixed', 'closed', 'wontfix', 'reopen'];
export const STATUS_LABEL = { open: '新', doing: 'AI处理中', fixed: 'AI已修', closed: '已解决', wontfix: '不修', reopen: '重开' };
export const CATEGORIES = ['形状', '颜色', '比例', '位置', '动作', '材质', '缺失', '其他'];
export const SEVERITY_LABEL = { 1: '轻', 2: '中', 3: '重' };
export const BUNDLE_KIND = 'v3-fb-bundle';

/** Error with an HTTP status (400 bad input, 404 missing). */
export class FbError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new FbError(400, msg);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const p2 = (n) => String(n).padStart(2, '0');
/** Local time ISO 8601 with offset, e.g. 2026-11-04T21:48:00.123+08:00 (Date.parse reads it). */
export function localIso(d = new Date()) {
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}` +
    `.${String(d.getMilliseconds()).padStart(3, '0')}${off >= 0 ? '+' : '-'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}
/** fb-YYYYMMDD-HHMMSS-xxx (local time + 3 random [a-z0-9]). */
export function newId(d = new Date()) {
  const ab = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const rnd = Array.from(crypto.randomBytes(3), (b) => ab[b % 36]).join('');
  return `fb-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}-${rnd}`;
}
export const time = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : 0; };
/** Sort comparator: newest created first, then id. */
export const newestFirst = (a, b) => time(b.created) - time(a.created) || String(b.id).localeCompare(String(a.id));

// ---------------------------------------------------------------- screenshots
const IMG_TYPES = [
  { ext: '.png', mime: 'image/png', ok: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  { ext: '.jpg', mime: 'image/jpeg', ok: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.webp', mime: 'image/webp', ok: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];
export const SHOT_EXTS = IMG_TYPES.map((t) => t.ext);
export const mimeOfShot = (file) => (IMG_TYPES.find((t) => t.ext === path.extname(file).toLowerCase()) || IMG_TYPES[0]).mime;
/** data:image/png|jpeg|webp;base64,... -> {buf, ext}; 400 unless the bytes really are that kind of image. */
export function decodeShot(dataUrl) {
  const s = String(dataUrl), comma = s.indexOf(',');
  if (comma < 0 || !/^data:image\/(png|jpeg|jpg|webp);base64$/i.test(s.slice(0, comma))) {
    throw bad('shotData must be a data:image/png|jpeg|webp;base64,... URL');
  }
  const buf = Buffer.from(s.slice(comma + 1), 'base64');
  const t = IMG_TYPES.find((x) => x.ok(buf));
  if (!t) throw bad('shotData is not a valid png/jpeg/webp image');
  return { buf, ext: t.ext };
}

// ---------------------------------------------------------------- validation
const SERVER_FIELDS = new Set(['id', 'created', 'updated', 'shot', 'shotData']);
const ORDER = ['id', 'created', 'updated', 'build', 'page', 'model', 'part', 'partLabel', 'point', 'camera', 'state',
  'category', 'severity', 'text', 'status', 'shot', 'thread'];
/** Same item with keys in SPEC order (unknown keys after). */
export function ordered(item) {
  const out = {};
  for (const k of ORDER) if (item[k] !== undefined) out[k] = item[k];
  for (const k of Object.keys(item)) if (!(k in out) && item[k] !== undefined) out[k] = item[k];
  return out;
}
function threadEntry(e, i) {
  if (!isObj(e) || typeof e.text !== 'string') throw bad(`thread[${i}] needs {who, text}`);
  const who = e.who == null ? 'user' : e.who;
  if (who !== 'user' && who !== 'ai') throw bad(`thread[${i}].who must be user or ai`);
  if (e.status != null && !STATUSES.includes(e.status)) throw bad(`thread[${i}].status must be one of ${STATUSES.join('|')}`);
  return { ...e, who, at: typeof e.at === 'string' && e.at ? e.at : localIso(), text: e.text };
}
/** Validate the client-owned part of an item. Unknown fields are kept; server fields are dropped. */
export function normalize(body) {
  if (!isObj(body)) throw bad('item must be a JSON object');
  const out = {};
  for (const [k, v] of Object.entries(body)) if (!SERVER_FIELDS.has(k)) out[k] = v;
  for (const k of ['build', 'page', 'model', 'part', 'partLabel', 'text']) {
    if (out[k] != null && typeof out[k] !== 'string') throw bad(`${k} must be a string`);
  }
  for (const k of ['point', 'camera', 'state']) if (out[k] != null && !isObj(out[k])) throw bad(`${k} must be an object or null`);
  if (out.category != null && !CATEGORIES.includes(out.category)) throw bad(`category must be one of ${CATEGORIES.join('|')}`);
  if (out.severity != null) {
    const s = Number(out.severity);
    if (![1, 2, 3].includes(s)) throw bad('severity must be 1, 2 or 3');
    out.severity = s;
  }
  out.status = out.status == null ? 'open' : out.status;
  if (!STATUSES.includes(out.status)) throw bad(`status must be one of ${STATUSES.join('|')}`);
  if (out.thread == null) out.thread = [];
  if (!Array.isArray(out.thread)) throw bad('thread must be an array');
  out.thread = out.thread.map(threadEntry);
  return out;
}

// ---------------------------------------------------------------- store
export class FbStore {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.items = path.join(this.dir, 'items');
    this.shots = path.join(this.dir, 'shots');
    this.trash = path.join(this.dir, 'trash');
  }
  ensure() { for (const d of [this.items, this.shots]) fs.mkdirSync(d, { recursive: true }); return this; }
  checkId(id) { if (!ID_RE.test(String(id))) throw bad(`bad id: ${id}`); return String(id); }
  file(id) { return path.join(this.items, this.checkId(id) + '.json'); }
  has(id) { return fs.existsSync(this.file(id)); }
  /** Existing screenshot files of an id (normally 0 or 1). */
  shotFiles(id) { this.checkId(id); return SHOT_EXTS.map((e) => path.join(this.shots, id + e)).filter((f) => fs.existsSync(f)); }
  /** Absolute path of the item's screenshot, or null. */
  shotPath(item) { return item && ID_RE.test(String(item.id)) ? this.shotFiles(item.id)[0] || null : null; }
  get(id) {
    const f = this.file(id);
    if (!fs.existsSync(f)) throw new FbError(404, `no such item: ${id}`);
    return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
  }
  /** All items, newest first. Unreadable files go to onBad(name, err) and are skipped. */
  list(onBad = () => {}) {
    if (!fs.existsSync(this.items)) return [];
    const out = [];
    for (const name of fs.readdirSync(this.items)) {
      if (!name.endsWith('.json') || !ID_RE.test(name.slice(0, -5))) continue;
      try { out.push(JSON.parse(fs.readFileSync(path.join(this.items, name), 'utf8').replace(/^\uFEFF/, ''))); }
      catch (e) { onBad(name, e); }
    }
    return out.sort(newestFirst);
  }
  /** Write items/<id>.json (pretty, UTF-8, via a temp file so readers never see half a file). */
  write(item) {
    const f = this.file(item.id), tmp = f + '.tmp';
    fs.mkdirSync(this.items, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(ordered(item), null, 2) + '\n', 'utf8');
    try { fs.renameSync(tmp, f); } catch { fs.writeFileSync(f, fs.readFileSync(tmp)); fs.rmSync(tmp, { force: true }); }
    return ordered(item);
  }
  putShot(id, shot) {
    fs.mkdirSync(this.shots, { recursive: true });
    for (const f of this.shotFiles(id)) fs.rmSync(f, { force: true });
    fs.writeFileSync(path.join(this.shots, id + shot.ext), shot.buf);
    return `shots/${id}${shot.ext}`;
  }
  /** POST: server assigns id/created/updated (local time); shotData -> shots/<id>.png (or .jpg/.webp). */
  create(body) {
    const fields = normalize(body);
    const shot = body.shotData ? decodeShot(body.shotData) : null;
    const now = new Date(), at = localIso(now);
    let id = newId(now);
    while (this.has(id)) id = newId(now);
    const item = { ...fields, id, created: at, updated: at, shot: null };
    if (shot) item.shot = this.putShot(id, shot);
    return this.write(item);
  }
  /** PATCH {status?, reply?:{who,text}}: reply is appended to thread (with the new status), status updated. */
  patch(id, body, defaultWho = 'user') {
    if (!isObj(body)) throw bad('body must be a JSON object');
    const { status, reply } = body;
    if (status == null && reply == null) throw bad('give status and/or reply');
    if (status != null && !STATUSES.includes(status)) throw bad(`status must be one of ${STATUSES.join('|')}`);
    let who = null;
    if (reply != null) {
      if (!isObj(reply) || typeof reply.text !== 'string' || !reply.text.trim()) throw bad('reply must be {who, text} with non-empty text');
      who = reply.who == null ? defaultWho : reply.who;
      if (who !== 'user' && who !== 'ai') throw bad('reply.who must be user or ai');
    }
    const item = this.get(id), at = localIso();
    if (who) {
      const e = { who, at, text: reply.text };
      if (status != null) e.status = status;
      item.thread = [...(Array.isArray(item.thread) ? item.thread : []), e];
    }
    if (status != null) item.status = status;
    item.updated = at;
    return this.write(item);
  }
  /** DELETE: move items/<id>.json and its screenshot into trash/. Returns ['trash/<file>', ...]. */
  remove(id) {
    const f = this.file(id);
    if (!fs.existsSync(f)) throw new FbError(404, `no such item: ${id}`);
    fs.mkdirSync(this.trash, { recursive: true });
    const moved = [];
    for (const src of [f, ...this.shotFiles(id)]) {
      let dst = path.join(this.trash, path.basename(src));
      if (fs.existsSync(dst)) dst = path.join(this.trash, `${Date.now()}-${path.basename(src)}`);
      fs.renameSync(src, dst);
      moved.push('trash/' + path.basename(dst));
    }
    return moved;
  }
  /** Bundle for `fb.mjs export` and the page's 导出: {kind, version, exported, items:[{...item, shotData?}]}. */
  exportBundle(items = this.list(), { shots = true } = {}) {
    return {
      kind: BUNDLE_KIND, version: 1, exported: localIso(),
      items: items.map((it) => {
        const f = shots ? this.shotPath(it) : null;
        return f ? { ...it, shotData: `data:${mimeOfShot(f)};base64,${fs.readFileSync(f).toString('base64')}` } : { ...it };
      }),
    };
  }
  /** Merge a bundle (or a bare item array) by id: newer `updated` wins, older/equal is skipped,
   *  missing or malformed ids get a new id. Everything is validated before anything is written. */
  importBundle(bundle) {
    const list = Array.isArray(bundle) ? bundle : isObj(bundle) && Array.isArray(bundle.items) ? bundle.items : null;
    if (!list) throw bad('not a feedback bundle: expected {items:[...]} or an array of items');
    const plan = list.map((raw, i) => {
      try { return { raw, fields: normalize(raw), shot: raw.shotData ? decodeShot(raw.shotData) : null }; }
      catch (e) { throw new FbError(e.status || 400, `items[${i}]: ${e.message}`); }
    });
    const res = { added: 0, updated: 0, skipped: 0, ids: [] };
    for (const { raw, fields, shot } of plan) {
      const keep = ID_RE.test(String(raw.id || ''));
      const old = keep && this.has(raw.id) ? this.get(raw.id) : null;
      if (old && time(raw.updated) <= time(old.updated)) { res.skipped++; res.ids.push(raw.id); continue; }
      const c = time(raw.created) ? new Date(time(raw.created)) : new Date();
      let id = keep ? raw.id : newId(c);
      while (!keep && this.has(id)) id = newId(c);
      const created = old ? old.created : typeof raw.created === 'string' && time(raw.created) ? raw.created : localIso(c);
      const updated = typeof raw.updated === 'string' && time(raw.updated) ? raw.updated : created;
      const kept = this.shotFiles(id)[0];
      this.write({ ...fields, id, created, updated, shot: shot ? this.putShot(id, shot) : kept ? 'shots/' + path.basename(kept) : null });
      res[old ? 'updated' : 'added']++; res.ids.push(id);
    }
    return res;
  }
}
