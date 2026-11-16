#!/usr/bin/env node
// tools/refkit/report.mjs — read what the user answered in the 2D 反馈 page (参考图标注), for the agent.
// Usage: node tools/refkit/report.mjs --dir refs/<project> [mode]     (--dir is relative to the v3 root)
//   (no mode)  full summary: project notes and questions, characters, "same person?" pairs, things (one object or
//              place across images), every image
//   --list     images with pixel size, question state and unanswered count, plus questions.json problems
//   --todo     only what is still unanswered
//   --check    only validate questions.json; exit code 1 when it has problems
//   --json     the same content as JSON
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const has = (k) => argv.includes('--' + k);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
if (has('help')) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 8).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.resolve(ROOT, arg('dir', 'refs/default'));
const SHOWDIR = ((r) => (r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : DIR))(path.relative(ROOT, DIR));
if (!fs.existsSync(DIR)) { console.error('refkit report: no such dir ' + DIR); process.exit(1); }
const KIND = { character: '角色', passerby: '路人', object: '物件', sign: '招牌/文字', vehicle: '车辆', other: '其他', ignore: '忽略' };
const TYPES = ['choice', 'multi', 'yesno', 'text', 'number'];
const FIELDS = [['scene', '场景'], ['where', '室内外'], ['time', '时间'], ['weather', '天气']];

function readJson(file) {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) return { data: null };
  const t = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  try { return { data: t.trim() ? JSON.parse(t) : null }; } catch (e) { return { data: null, error: `${file}: ${e.message}` }; }
}
// Pixel size from the file header: PNG, GIF, BMP, WebP, JPEG. Returns null for anything else.
function dims(b) {
  try {
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
    if (b.toString('latin1', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
    if (b.toString('latin1', 0, 2) === 'BM') return [b.readInt32LE(18), Math.abs(b.readInt32LE(22))];
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const c = b.toString('latin1', 12, 16);
      if (c === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
      if (c === 'VP8L') { const n = b.readUInt32LE(21); return [1 + (n & 0x3fff), 1 + ((n >> 14) & 0x3fff)]; }
      if (c === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
        if (m === 0xff) { i++; continue; }
        if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch { /* unknown format */ }
  return null;
}

const images = [];
for (const g of ['images', 'drafts']) {
  const d = path.join(DIR, g);
  if (!fs.existsSync(d)) continue;
  for (const name of fs.readdirSync(d).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const p = path.join(d, name);
    if (!/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name) || !fs.statSync(p).isFile()) continue;
    images.push({ key: g + '/' + name, size: fs.statSync(p).size, dims: dims(fs.readFileSync(p)) });
  }
}
const qj = readJson('questions.json'), aj = readJson('answers.json');
// Both files may be hand-edited: coerce every list and map before use.
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const RAWQ = obj(qj.data);
const Q = { ...RAWQ, project: arr(RAWQ.project), characters: arr(RAWQ.characters), pairs: arr(RAWQ.pairs), things: arr(RAWQ.things), images: {} };
for (const [k, v] of Object.entries(obj(RAWQ.images))) Q.images[k] = { ...obj(v), questions: arr(obj(v).questions), boxes: arr(obj(v).boxes), fields: obj(obj(v).fields) };
const A = { ...obj(aj.data) };
A.characters = arr(A.characters);
A.pairs = obj(A.pairs);
A.things = arr(A.things);
A.project = obj(A.project);
A.images = {};
for (const [k, v] of Object.entries(obj(obj(aj.data).images))) A.images[k] = { ...obj(v), boxes: arr(obj(v).boxes), fields: obj(obj(v).fields), answers: obj(obj(v).answers) };
const QI = Q.images, AI = A.images;

const answered = (a) => !!a && ((Array.isArray(a.v) ? a.v.length > 0 : a.v != null && String(a.v).trim() !== '') || !!(a.otherText && String(a.otherText).trim()));
const filled = (v) => v != null && String(v).trim() !== '';
const same = (g, v) => JSON.stringify([].concat(g).map(String).sort()) === JSON.stringify([].concat(v).map(String).sort());
const list = (g) => [].concat(g).join('、');
function fmt(a) {
  if (!answered(a)) return '（未答）';
  let s = Array.isArray(a.v) ? a.v.join('、') : a.v == null ? '' : String(a.v);
  if (a.other) s = '其他：' + s;
  if (a.otherText) s += (s ? '、' : '') + '其他：' + a.otherText;
  return s + (a.note ? '（补充：' + a.note + '）' : '');
}
const vs = (g, a) => g == null || g === '' ? '' : !answered(a) ? `（我猜 ${list(g)}）` : same(g, a.v) ? '（我猜对了）' : `（我猜的是 ${list(g)}）`;
const local = (iso) => iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '';

const chars = (A.characters || []).map((c) => ({ ...c }));
for (const c of Q.characters || []) if (c && c.id && !chars.some((x) => x.id === c.id)) chars.push({ id: c.id, name: c.name || c.id, note: c.note || '', proposed: true });
const charName = (id) => { const c = chars.find((x) => x.id === id); return c ? c.name : id; };
const things = A.things.filter((t) => t && t.id).map((t) => ({ ...t }));
for (const t of Q.things) if (t && t.id && !things.some((x) => x.id === t.id)) things.push({ id: t.id, name: t.name || t.id, note: t.note || '', proposed: true });
const thingName = (id) => { const t = things.find((x) => x.id === id); return t ? t.name : id; };
const THING_KINDS = ['object', 'sign', 'vehicle', 'other'];

// Same merge as the page: agent boxes (with the user's decision, if any), then the user's own boxes.
function boxes(key) {
  const a = AI[key] || {}, own = new Map((a.boxes || []).map((b) => [b.id, b]));
  const qbs = ((QI[key] && QI[key].boxes) || []).filter((b) => b && b.id), qids = new Set(qbs.map((b) => b.id)), out = [];
  for (const qb of qbs) {
    const b = own.get(qb.id), s = b || qb;
    const moved = !!b && ['x', 'y', 'w', 'h'].some((k) => Math.abs(+b[k] - +qb[k]) > 0.002);
    out.push({ id: qb.id, src: 'agent', x: +s.x, y: +s.y, w: +s.w, h: +s.h, kind: (b && b.kind) || null, character: (b && b.character) || null,
      thing: (b && b.thing) || null, notThing: arr(b && b.notThing),
      note: (b && b.note) || '', removed: !!(b && b.removed), guess: qb.guess || null, ask: qb.ask || '', moved });
  }
  for (const b of a.boxes || []) {
    if (qids.has(b.id) || b.removed) continue;
    out.push({ id: b.id, src: 'user', x: +b.x, y: +b.y, w: +b.w, h: +b.h, kind: b.kind || null, character: b.character || null,
      thing: b.thing || null, notThing: arr(b.notThing), note: b.note || '', removed: false, guess: null, ask: '', moved: false });
  }
  for (const b of out) b.pending = !b.removed && (!b.kind || (b.kind === 'character' && !b.character));
  return out;
}

const PA = (A.project && A.project.answers) || {};
const model = {
  project: path.basename(DIR), dir: SHOWDIR, round: Q.round || 0, submittedRound: A.submittedRound || 0,
  submittedAt: A.submittedAt || null, savedAt: A.savedAt || null, errors: [qj.error, aj.error].filter(Boolean),
  notes: (A.project && A.project.notes) || {},
  projectQuestions: (Q.project || []).filter((q) => q && q.id).map((q) => ({ id: q.id, text: q.text, guess: q.guess, answer: PA[q.id] || null })),
  characters: [], unknownCharacter: [], unassignedCharacter: [], pairs: [], things: [], images: [], todo: 0,
};
for (const im of images) {
  const q = QI[im.key] || {}, a = AI[im.key] || {}, f = a.fields || {}, gf = q.fields || {};
  const w = (im.dims && im.dims[0]) || a.w || 0, h = (im.dims && im.dims[1]) || a.h || 0;
  const bx = boxes(im.key).map((b) => ({ ...b, crop: w ? `crop=${Math.round(b.w * w)}:${Math.round(b.h * h)}:${Math.round(b.x * w)}:${Math.round(b.y * h)}` : null }));
  const qs = (q.questions || []).filter((x) => x && x.id).map((x) => ({ id: x.id, text: x.text, guess: x.guess, answer: (a.answers || {})[x.id] || null }));
  const fields = FIELDS.map(([k, label]) => ({ k, label, value: filled(f[k]) ? f[k] : null, guess: gf[k] == null ? null : gf[k] }));
  const todo = f.skip ? 0 : qs.filter((x) => !answered(x.answer)).length + fields.filter((x) => x.guess != null && x.value == null).length + bx.filter((b) => b.pending).length;
  const ex = 'exports/' + im.key.replace('/', '__').replace(/\.[^.]+$/, '') + '.jpg';
  model.images.push({ key: im.key, w, h, size: im.size, asked: !!QI[im.key], summary: q.summary || '', main: !!f.main, skip: !!f.skip,
    fields, questions: qs, boxes: bx, note: a.note || '', todo, thingTodo: [], export: fs.existsSync(path.join(DIR, ex)) ? ex : null });
  model.todo += todo;
}
model.todo += model.projectQuestions.filter((x) => !answered(x.answer)).length;
for (const p of (Q.pairs || []).filter((x) => x && x.id)) {
  const ans = (A.pairs || {})[p.id] || null;
  model.pairs.push({ id: p.id, a: p.a, b: p.b, ask: p.ask || '', guess: p.guess, answer: ans });
  if (!answered(ans)) model.todo++;
}
for (const c of chars) {
  const refs = [], guessed = [];
  for (const im of model.images) {
    for (const b of im.boxes) {
      if (b.removed) continue;
      if (b.kind === 'character' && b.character === c.id) refs.push(im.key + '#' + b.id);
      else if (!b.kind && b.guess && b.guess.kind === 'character' && b.guess.character === c.id) guessed.push(im.key + '#' + b.id);
    }
  }
  model.characters.push({ id: c.id, name: c.name, note: c.note || '', proposed: !!c.proposed, boxes: refs, guessedOnly: guessed });
}
for (const im of model.images) {
  for (const b of im.boxes) {
    if (b.removed || b.kind !== 'character') continue;
    if (b.character === '?') model.unknownCharacter.push(im.key + '#' + b.id);
    else if (!b.character) model.unassignedCharacter.push(im.key + '#' + b.id);
  }
}
// Things: members are boxes whose box.thing is the thing; the agent's proposals (questions.json things[].boxes)
// are pending until the user says 是 (box.thing) or 不是 (box.notThing). Same rules as the page.
const qthing = new Map(Q.things.filter((t) => t && t.id).map((t) => [t.id, t]));
for (const t of things) {
  const members = [], pending = [], rejected = [], gone = [];
  for (const im of model.images) for (const b of im.boxes) if (!b.removed && b.thing === t.id && THING_KINDS.includes(b.kind)) members.push(im.key + '#' + b.id);
  for (const ref of arr((qthing.get(t.id) || {}).boxes)) {
    const s = String(ref), j = s.lastIndexOf('#'), im = j > 0 && model.images.find((x) => x.key === s.slice(0, j));
    const b = im && im.boxes.find((x) => x.id === s.slice(j + 1) && !x.removed);
    if (!b) { gone.push(s); continue; }
    if (b.thing === t.id) continue;
    if (b.notThing.includes(t.id)) { rejected.push(s); continue; }
    pending.push(s);
    if (!im.skip) { im.thingTodo.push({ ref: s, id: b.id, thing: t.id }); im.todo++; model.todo++; }
  }
  model.things.push({ id: t.id, name: t.name, note: t.note || '', proposed: !!t.proposed, members, pending, rejected, gone });
}

// ---------------------------------------------------------------- questions.json validation
function check() {
  const p = [];
  if (qj.error) return [qj.error];
  if (!qj.data) return p;
  if (RAWQ.round != null && !(Number.isInteger(RAWQ.round) && RAWQ.round > 0)) p.push('round 应该是正整数');
  for (const k of ['project', 'characters', 'pairs', 'things']) if (RAWQ[k] != null && !Array.isArray(RAWQ[k])) p.push(k + ' 应该是数组');
  if (RAWQ.images != null && (typeof RAWQ.images !== 'object' || Array.isArray(RAWQ.images))) p.push('images 应该是对象，键是 images/文件名');
  const qlist = (where, a) => {
    const ids = new Set();
    a.forEach((q, i) => {
      const at = `${where}[${i}]`;
      if (!q || typeof q !== 'object') { p.push(at + ' 不是对象'); return; }
      if (!q.id) p.push(at + ' 缺 id');
      else if (ids.has(q.id)) p.push(`${at} id 重复：${q.id}`);
      ids.add(q.id);
      if (!q.text) p.push(`${at}（${q.id}）缺 text`);
      const t = q.type || 'text';
      if (!TYPES.includes(t)) p.push(`${at}（${q.id}）type 不认识：${t}，可用 ${TYPES.join('/')}`);
      if ((t === 'choice' || t === 'multi') && !(Array.isArray(q.options) && q.options.length)) p.push(`${at}（${q.id}）${t} 题缺 options`);
    });
  };
  qlist('project', Q.project);
  const cids = new Set([...Q.characters.map((c) => c && c.id), ...arr(A.characters).map((c) => c && c.id)].filter(Boolean));
  const keys = new Set(images.map((i) => i.key));
  const tids = new Set([...Q.things.map((t) => t && t.id), ...A.things.map((t) => t && t.id)].filter(Boolean));
  for (const [key, raw] of Object.entries(obj(RAWQ.images))) {
    if (!keys.has(key)) p.push(`images 里的 "${key}" 找不到对应文件（键要写成 images/文件名 或 drafts/文件名）`);
    if (!raw || typeof raw !== 'object') { p.push(`${key} 应该是对象`); continue; }
    if (raw.questions != null && !Array.isArray(raw.questions)) p.push(`${key} questions 应该是数组`);
    if (raw.boxes != null && !Array.isArray(raw.boxes)) p.push(`${key} boxes 应该是数组`);
    const q = QI[key];
    qlist(key + ' questions', q.questions);
    for (const k of Object.keys(q.fields)) if (!FIELDS.some(([f]) => f === k)) p.push(`${key} fields 的键不认识：${k}，可用 ${FIELDS.map((f) => f[0]).join('/')}`);
    const bids = new Set();
    q.boxes.forEach((b, i) => {
      const at = `${key} boxes[${i}]`;
      if (!b || !b.id) { p.push(at + ' 缺 id'); return; }
      if (bids.has(b.id)) p.push(`${at} id 重复：${b.id}`);
      bids.add(b.id);
      if (/^u\d+$/.test(b.id)) p.push(`${at} id ${b.id} 会和用户画的框冲突，agent 的框 id 用 a 开头`);
      const [x, y, w, h] = ['x', 'y', 'w', 'h'].map((k) => +b[k]);
      if (![x, y, w, h].every(isFinite)) p.push(`${at}（${b.id}）x/y/w/h 不是数字`);
      else if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) p.push(`${at}（${b.id}）超出 0–1 范围（坐标是相对图片宽高的比例）`);
      const g = b.guess;
      if (g && g.kind && !KIND[g.kind]) p.push(`${at}（${b.id}）guess.kind 不认识：${g.kind}`);
      if (g && g.character && !cids.has(g.character)) p.push(`${at}（${b.id}）guess.character 不在 characters 里：${g.character}`);
      if (g && g.thing && !tids.has(g.thing)) p.push(`${at}（${b.id}）guess.thing 不在 things 里：${g.thing}`);
      if (g && g.thing && !THING_KINDS.includes(g.kind)) p.push(`${at}（${b.id}）guess.thing 要配 kind ${THING_KINDS.join('/')}`);
    });
  }
  const seenT = new Set();
  Q.things.forEach((t, i) => {
    if (!t || !t.id) { p.push(`things[${i}] 缺 id`); return; }
    if (seenT.has(t.id)) p.push(`things[${i}] id 重复：${t.id}`);
    seenT.add(t.id);
    if (/^ut\d+$/.test(t.id)) p.push(`things[${i}] id ${t.id} 会和用户新建的冲突，agent 的 id 用 t 开头`);
    if (cids.has(t.id)) p.push(`things[${i}] id ${t.id} 和角色 id 重复`);
    if (!t.name) p.push(`things[${i}]（${t.id}）缺 name`);
    if (t.boxes != null && !Array.isArray(t.boxes)) { p.push(`things ${t.id} boxes 应该是数组`); return; }
    for (const ref of arr(t.boxes)) {
      const s = String(ref || ''), j = s.lastIndexOf('#'), key = j > 0 ? s.slice(0, j) : '', id = j > 0 ? s.slice(j + 1) : '';
      const b = keys.has(key) && boxes(key).find((x) => x.id === id);
      if (!keys.has(key)) p.push(`things ${t.id} 引用的图片不存在：${s}（写成 images/文件名#框id）`);
      else if (!b) p.push(`things ${t.id} 引用的框不存在：${s}`);
      else if (b.kind && !THING_KINDS.includes(b.kind)) p.push(`things ${t.id} 引用的 ${s} 种类是 ${KIND[b.kind] || b.kind}，只有物件/招牌/车辆/其他能对应`);
    }
  });
  const pids = new Set();
  Q.pairs.forEach((pr, i) => {
    if (!pr || !pr.id) { p.push(`pairs[${i}] 缺 id`); return; }
    if (pids.has(pr.id)) p.push(`pairs[${i}] id 重复：${pr.id}`);
    pids.add(pr.id);
    for (const ref of [pr.a, pr.b]) {
      const s = String(ref || ''), j = s.lastIndexOf('#'), key = j > 0 ? s.slice(0, j) : '', id = j > 0 ? s.slice(j + 1) : '';
      if (!keys.has(key)) p.push(`pairs ${pr.id} 引用的图片不存在：${s}（写成 images/文件名#框id）`);
      else if (!boxes(key).some((b) => b.id === id)) p.push(`pairs ${pr.id} 引用的框不存在：${s}`);
    }
  });
  return p;
}

// ---------------------------------------------------------------- output
const probs = check();
if (has('json')) { console.log(JSON.stringify({ ...model, problems: probs }, null, 1)); process.exit(0); }
if (has('check')) {
  if (!qj.data && !qj.error) console.log('还没有 questions.json');
  else console.log(probs.length ? 'questions.json 有问题：\n' + probs.map((x) => '- ' + x).join('\n') : 'questions.json 没问题');
  process.exit(probs.length ? 1 : 0);
}
const out = [], P = (s = '') => out.push(s);
P(`项目 ${model.project}  ${SHOWDIR}`);
const sub = !model.round ? '还没有 questions.json'
  : `第 ${model.round} 轮` + (model.submittedRound >= model.round ? `，用户已点「这轮答完了」（${local(model.submittedAt)}）` : '，用户还没点「这轮答完了」');
P(`${sub}；最后保存 ${local(model.savedAt) || '（还没有回答）'}；图片 ${images.length} 张；未答 ${model.todo} 条`);
for (const e of model.errors) P('！读取失败：' + e);
if (probs.length) { P('！questions.json 有问题：'); for (const x of probs) P('  - ' + x); }
P();
const n0 = out.length;
if (has('list')) {
  for (const im of model.images) {
    const live = im.boxes.filter((b) => !b.removed).length;
    P(`${im.key}  ${im.w ? im.w + '×' + im.h : '尺寸未知'}  ${Math.round(im.size / 1024)} KB  ${!im.asked ? '没问过' : im.todo ? '未答 ' + im.todo : '已答完'}` +
      `${live ? '  框 ' + live : ''}${im.main ? '  主视角' : ''}${im.skip ? '  不用' : ''}`);
  }
  if (out.length === n0) P('还没有图片');
} else if (has('todo')) {
  for (const q of model.projectQuestions) if (!answered(q.answer)) P(`[整体] ${q.id} ${q.text}`);
  for (const p of model.pairs) if (!answered(p.answer)) P(`[同一人] ${p.id} ${p.a} ↔ ${p.b}`);
  for (const im of model.images) for (const t of im.thingTodo) P(`[同一东西] ${t.ref} 是不是 ${t.thing} ${thingName(t.thing)}`);
  for (const im of model.images) {
    if (im.skip) continue;
    for (const f of im.fields) if (f.guess != null && f.value == null) P(`[${im.key}] 基本信息 ${f.label}（我猜 ${list(f.guess)}）`);
    for (const q of im.questions) if (!answered(q.answer)) P(`[${im.key}] ${q.id} ${q.text}`);
    for (const b of im.boxes) if (b.pending) P(`[${im.key}] 框 ${b.id} ${b.kind === 'character' ? '角色没指定是谁' : '没确认种类'}${b.ask ? '：' + b.ask : ''}`);
  }
  if (out.length === n0) P('都答完了');
} else {
  const N = model.notes, NL = [['keep', '必须一致'], ['free', '可自由发挥'], ['avoid', '不要'], ['motion', '想要的动态']];
  if (NL.some(([k]) => filled(N[k]))) { P('== 项目备注'); for (const [k, l] of NL) if (filled(N[k])) P(`${l}：${N[k]}`); P(); }
  if (model.projectQuestions.length) {
    P('== 整体的问题');
    for (const q of model.projectQuestions) P(`${q.id} ${q.text} → ${fmt(q.answer)}${vs(q.guess, q.answer)}`);
    P();
  }
  if (model.characters.length || model.unknownCharacter.length || model.unassignedCharacter.length) {
    P('== 角色');
    for (const c of model.characters) {
      P(`${c.id} ${c.name}${c.proposed ? '（我起的名字，用户没改过）' : ''}${c.note ? '：' + c.note : ''}`);
      P(`   出现在：${c.boxes.length ? c.boxes.join('  ') : '（还没有框指定成 ta）'}`);
      if (c.guessedOnly.length) P(`   我猜也是 ta、用户还没确认：${c.guessedOnly.join('  ')}`);
    }
    if (model.unknownCharacter.length) P(`标了「不确定是谁」的角色框：${model.unknownCharacter.join('  ')}`);
    if (model.unassignedCharacter.length) P(`还没指定是谁的角色框：${model.unassignedCharacter.join('  ')}`);
    P();
  }
  if (model.pairs.length) {
    P('== 是不是同一个人');
    for (const p of model.pairs) P(`${p.id} ${p.a} ↔ ${p.b} → ${fmt(p.answer)}${vs(p.guess, p.answer)}`);
    P();
  }
  if (model.things.length) {
    P('== 物件/地点');
    for (const t of model.things) {
      P(`${t.id} ${t.name}${t.proposed ? '（我起的名字，用户没改过）' : ''}${t.note ? '：' + t.note : ''}`);
      P(`   出现在：${t.members.length ? t.members.join('  ') : '（还没有框对应到这里）'}`);
      if (t.pending.length) P(`   我提议的、用户还没回答：${t.pending.join('  ')}`);
      if (t.rejected.length) P(`   用户说不是：${t.rejected.join('  ')}`);
      if (t.gone.length) P(`   提议里的框已经不在了：${t.gone.join('  ')}`);
    }
    P();
  }
  const idle = [];
  for (const im of model.images) {
    const touched = im.asked || im.boxes.length || filled(im.note) || im.main || im.skip || im.fields.some((f) => f.value != null);
    if (!touched) { idle.push(im.key); continue; }
    P(`== ${im.key}  ${im.w ? im.w + '×' + im.h : '尺寸未知'}${im.main ? '  ★主视角' : ''}${im.skip ? '  （用户标了不用参考）' : ''}${im.todo ? '  未答 ' + im.todo : ''}`);
    if (im.summary) P(`我的理解：${im.summary}`);
    const fl = im.fields.filter((f) => f.value != null || f.guess != null)
      .map((f) => `${f.label} ${f.value != null ? f.value + vs(f.guess, { v: f.value }) : '（未确认，我猜 ' + list(f.guess) + '）'}`);
    if (fl.length) P(fl.join('；'));
    for (const q of im.questions) P(`${q.id} ${q.text} → ${fmt(q.answer)}${vs(q.guess, q.answer)}`);
    for (const b of im.boxes) {
      const g = b.guess || {}, gt = g.kind ? (KIND[g.kind] || g.kind) + (g.character ? ' ' + charName(g.character) : '') : '';
      let s;
      if (b.removed) s = `${b.id} 我框的，用户删了（说明框错了或不需要）`;
      else if (!b.kind) s = `${b.id} 未确认${gt ? '，我猜 ' + gt : ''}`;
      else {
        const who = b.kind !== 'character' ? '' : b.character === '?' ? ' 不确定是谁' : b.character ? ` ${b.character} ${charName(b.character)}` : ' 没指定是谁';
        const hit = g.kind === b.kind && (!g.character || g.character === b.character);
        s = `${b.id}${b.src === 'user' ? '（用户画的）' : ''} ${KIND[b.kind] || b.kind}${who}${b.src === 'agent' && gt ? (hit ? '（我猜对了）' : '（我猜的是 ' + gt + '）') : ''}`;
      }
      const at = `@${b.x.toFixed(3)},${b.y.toFixed(3)} ${b.w.toFixed(3)}×${b.h.toFixed(3)}${b.crop ? ' ' + b.crop : ''}`;
      const th = b.thing && THING_KINDS.includes(b.kind) ? `  = ${b.thing} ${thingName(b.thing)}` : '';
      P(`  ${s}${th}${b.moved ? '（用户调整过位置）' : ''}  ${at}${b.note ? '  备注：' + b.note : ''}`);
    }
    if (filled(im.note)) P(`本图备注：${im.note}`);
    if (im.export) P(`标注图：${im.export}`);
    P();
  }
  if (idle.length) P(`没问过、用户也没动过的图（${idle.length}）：${idle.join('  ')}`);
}
console.log(out.join('\n').replace(/\n+$/, ''));
