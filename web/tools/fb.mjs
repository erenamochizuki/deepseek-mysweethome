#!/usr/bin/env node
// tools/fb.mjs — feedback CLI. Works directly on the files of a feedback dir (no server needed):
//   node tools/fb.mjs list [--status open,reopen] [--part 刘海] [--json]
//   node tools/fb.mjs show <id> [--json]
//   node tools/fb.mjs reply <id> "text" [--status fixed] [--who ai|user]      (who defaults to ai)
//   node tools/fb.mjs status <id> <status>
//   node tools/fb.mjs export <file> [--status ..] [--part ..] [--no-shots]
//   node tools/fb.mjs import <file>
//   node tools/fb.mjs summary [--json]
// Common option: --dir <feedback dir> (default feedback). Relative paths are resolved against the project root.
// Statuses may be given as code or Chinese label: open 新 | doing AI处理中 | fixed AI已修 | closed 已解决 | wontfix 不修 | reopen 重开.
// Exit codes: 0 ok, 1 error (bad id, missing item, invalid data), 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FbStore, FbError, STATUSES, STATUS_LABEL, SEVERITY_LABEL, BUNDLE_KIND } from './lib/fb-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `用法：node tools/fb.mjs <命令> [参数] [--dir feedback]
  list [--status open,reopen] [--part 刘海] [--json]    列出反馈（新的在前）
  show <id> [--json]                                   查看一条（含对话、截图路径）
  reply <id> "文字" [--status fixed] [--who ai|user]    追加一条回复（默认 who=ai），可同时改状态
  status <id> <状态>                                    只改状态
  export <文件> [--status ..] [--part ..] [--no-shots]  导出 v3-fb-bundle JSON（默认含截图）
  import <文件>                                         导入 bundle：按 id 合并，updated 较新的覆盖
  summary [--json]                                     按状态、按部位统计
状态：${STATUSES.map((s) => `${s}=${STATUS_LABEL[s]}`).join('  ')}（中文名也可以）
相对路径都相对于工程根目录。`;

function usage(msg) { if (msg) console.error(msg); console.error(USAGE); process.exit(msg ? 2 : 0); }

function parseArgs(argv) {
  const o = { dir: 'feedback', pos: [], json: false, shots: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v == null || v.startsWith('--')) usage(`${a} 需要一个值`); return v; };
    if (a === '--dir') o.dir = val();
    else if (a === '--status') o.status = val();
    else if (a === '--part') o.part = val();
    else if (a === '--who') o.who = val();
    else if (a === '--json') o.json = true;
    else if (a === '--no-shots') o.shots = false;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('--')) usage(`未知参数：${a}`);
    else o.pos.push(a);
  }
  return o;
}

// ---- display helpers (CJK characters take two terminal columns)
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;
const cw = (ch) => (WIDE.test(ch) ? 2 : 1);
const width = (s) => [...String(s)].reduce((n, ch) => n + cw(ch), 0);
/** Collapse whitespace, cut to display width w (ending in …), pad with spaces to w. */
function fit(v, w) {
  const s = String(v ?? '').replace(/\s+/g, ' ');
  let out = s, n = width(s);
  if (n > w) {
    out = ''; n = 0;
    for (const ch of s) { if (n + cw(ch) > w - 1) break; out += ch; n += cw(ch); }
    out += '…'; n += 1;
  }
  return out + ' '.repeat(Math.max(0, w - n));
}
/** cols: [{h: header, k: row key, max?: width cap}] */
function table(rows, cols) {
  const ws = cols.map((c) => Math.min(c.max || 99, Math.max(width(c.h), ...rows.map((r) => width(String(r[c.k] ?? '').replace(/\s+/g, ' '))))));
  const line = (cells) => cells.map((v, i) => fit(v, ws[i])).join('  ').trimEnd();
  console.log(line(cols.map((c) => c.h)));
  for (const r of rows) console.log(line(cols.map((c) => r[c.k])));
}
function fmtTime(s, full = false) {
  const d = new Date(s);
  if (!s || Number.isNaN(d.getTime())) return String(s ?? '-');
  const p = (n) => String(n).padStart(2, '0');
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return full ? `${d.getFullYear()}-${md}:${p(d.getSeconds())}` : md;
}
const label = (s) => STATUS_LABEL[s] || String(s ?? '?');
const countLine = (items) => STATUSES.map((s) => [s, items.filter((it) => it.status === s).length])
  .filter(([, n]) => n).map(([s, n]) => `${label(s)} ${n}`).join(' · ');

function toStatus(s) {
  if (STATUSES.includes(s)) return s;
  const hit = STATUSES.find((k) => STATUS_LABEL[k] === s);
  if (hit) return hit;
  throw new FbError(400, `未知状态：${s}（可用：${STATUSES.join('|')} 或 ${STATUSES.map(label).join('|')}）`);
}
const warnBad = (name, e) => console.error(`跳过无法读取的 ${name}：${e.message}`);
/** Items after --status (comma list) and --part (substring of part or partLabel) filters. */
function filtered() {
  let items = store.list(warnBad);
  if (opt.status) { const want = new Set(opt.status.split(/[,，\s]+/).filter(Boolean).map(toStatus)); items = items.filter((it) => want.has(it.status)); }
  if (opt.part) items = items.filter((it) => `${it.part || ''}\n${it.partLabel || ''}`.includes(opt.part));
  return items;
}

const opt = parseArgs(process.argv.slice(2));
const store = new FbStore(path.resolve(ROOT, opt.dir));
const UNRESOLVED = new Set(['open', 'doing', 'reopen']);

function cmdList() {
  const items = filtered();
  if (opt.json) return console.log(JSON.stringify(items, null, 2));
  if (!items.length) return console.log(opt.status || opt.part ? '没有符合条件的反馈。' : `还没有反馈（${store.dir}）。`);
  table(items.map((it) => ({
    id: it.id, st: label(it.status), sev: SEVERITY_LABEL[it.severity] || '-', cat: it.category || '-',
    part: it.part || it.partLabel || '-', n: Array.isArray(it.thread) ? it.thread.length : 0,
    upd: fmtTime(it.updated), text: it.text || '',
  })), [
    { h: 'ID', k: 'id' }, { h: '状态', k: 'st' }, { h: '程度', k: 'sev' }, { h: '类别', k: 'cat' },
    { h: '部位', k: 'part', max: 24 }, { h: '回复', k: 'n' }, { h: '更新', k: 'upd' }, { h: '内容', k: 'text', max: 48 },
  ]);
  console.log(`共 ${items.length} 条：${countLine(items)}`);
}

const KNOWN = ['id', 'created', 'updated', 'build', 'page', 'model', 'part', 'partLabel', 'point', 'camera', 'state',
  'category', 'severity', 'text', 'status', 'shot', 'thread'];
const val = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const vec = (a) => (Array.isArray(a) ? a.map((x) => (typeof x === 'number' ? +x.toFixed(3) : x)).join(', ') : '-');
const extra = (o, known) => Object.entries(o || {}).filter(([k]) => !known.includes(k)).map(([k, v]) => `${k}=${val(v)}`).join('  ');
function cmdShow([id]) {
  if (!id) usage('show 需要 <id>');
  const it = store.get(id);
  if (opt.json) return console.log(JSON.stringify(it, null, 2));
  const p = it.point, c = it.camera;
  const rows = [
    ['ID', it.id], ['状态', `${label(it.status)}（${it.status}）`],
    ['部位', `${it.part || '-'}${it.partLabel && it.partLabel !== it.part ? `（${it.partLabel}）` : ''}`],
    ['类别 / 程度', `${it.category || '-'} / ${SEVERITY_LABEL[it.severity] || '-'}`],
    ['页面 / 模型 / 构建', `${it.page || '-'} / ${it.model || '-'} / ${it.build || '-'}`],
    ['点击点', p ? `local(${vec(p.local)})  world(${vec(p.world)})  normal(${vec(p.normal)})  ${extra(p, ['local', 'world', 'normal'])}`.trim() : '-'],
    ['相机', c ? `pos(${vec(c.pos)})  target(${vec(c.target)})  fov ${c.fov ?? '-'}  ${extra(c, ['pos', 'target', 'fov'])}`.trim() : '-'],
    ['场景', it.state ? extra(it.state, []) || '-' : '-'],
    ['截图', store.shotPath(it) || '（无）'],
    ['创建 / 更新', `${fmtTime(it.created, true)} / ${fmtTime(it.updated, true)}`],
  ];
  const others = Object.keys(it).filter((k) => !KNOWN.includes(k));
  if (others.length) rows.push(['其他字段', others.map((k) => `${k}=${val(it[k])}`).join('  ')]);
  const lw = Math.max(...rows.map(([k]) => width(k)));
  for (const [k, v] of rows) console.log(`${fit(k, lw)}  ${v}`);
  console.log(`\n内容：\n  ${String(it.text || '').replace(/\n/g, '\n  ')}`);
  const th = Array.isArray(it.thread) ? it.thread : [];
  console.log(`\n对话（${th.length}）：`);
  for (const e of th) console.log(`  [${fmtTime(e.at)}] ${e.who === 'ai' ? 'AI' : '用户'}${e.status ? ` → ${label(e.status)}` : ''}：${String(e.text).replace(/\n/g, '\n      ')}`);
}

function cmdReply([id, ...words]) {
  const text = words.join(' ');
  if (!id || !text.trim()) usage('reply 需要 <id> 和 "回复内容"');
  const it = store.patch(id, { status: opt.status ? toStatus(opt.status) : undefined, reply: { who: opt.who || 'ai', text } }, 'ai');
  const last = it.thread[it.thread.length - 1];
  console.log(`已回复 ${it.id}（${last.who === 'ai' ? 'AI' : '用户'}），状态：${label(it.status)}，对话共 ${it.thread.length} 条`);
}

function cmdStatus([id, st]) {
  if (!id || !st) usage('status 需要 <id> <状态>');
  const want = toStatus(st), before = store.get(id).status;
  const it = store.patch(id, { status: want });
  console.log(`${it.id}：${label(before)} → ${label(it.status)}`);
}

function cmdExport([file]) {
  if (!file) usage('export 需要 <文件>');
  const out = path.resolve(ROOT, file), items = filtered();
  const bundle = store.exportBundle(items, { shots: opt.shots });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  const n = bundle.items.filter((x) => x.shotData).length;
  console.log(`已导出 ${items.length} 条（含截图 ${n} 张）→ ${out}  ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
}

function cmdImport([file]) {
  if (!file) usage('import 需要 <文件>');
  const src = path.resolve(ROOT, file);
  if (!fs.existsSync(src)) throw new FbError(404, `找不到文件：${src}`);
  let bundle;
  try { bundle = JSON.parse(fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { throw new FbError(400, `不是有效的 JSON：${e.message}`); }
  if (bundle && !Array.isArray(bundle) && bundle.kind && bundle.kind !== BUNDLE_KIND) console.error(`注意：kind=${bundle.kind}，不是 ${BUNDLE_KIND}，仍尝试导入`);
  const r = store.ensure().importBundle(bundle);
  console.log(`导入完成：新增 ${r.added}，更新 ${r.updated}，跳过 ${r.skipped}（本地已是同样或更新的版本）→ ${store.dir}`);
}

function cmdSummary() {
  const items = store.list(warnBad);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])), byPart = new Map();
  for (const it of items) {
    byStatus[it.status] = (byStatus[it.status] || 0) + 1;
    const k = it.part || it.partLabel || '（未指定部位）';
    const r = byPart.get(k) || { part: k, total: 0, unresolved: 0, ...Object.fromEntries(STATUSES.map((s) => [s, 0])) };
    r.total++; r[it.status] = (r[it.status] || 0) + 1; if (UNRESOLVED.has(it.status)) r.unresolved++;
    byPart.set(k, r);
  }
  const parts = [...byPart.values()].sort((a, b) => b.unresolved - a.unresolved || b.total - a.total || a.part.localeCompare(b.part, 'zh'));
  const unresolved = items.filter((it) => UNRESOLVED.has(it.status)).length;
  if (opt.json) return console.log(JSON.stringify({ dir: store.dir, total: items.length, unresolved, byStatus, byPart: parts }, null, 2));
  console.log(`反馈共 ${items.length} 条，未解决 ${unresolved} 条（新 + AI处理中 + 重开）  目录：${store.dir}`);
  if (!items.length) return;
  console.log('\n按状态：');
  table(STATUSES.map((s) => ({ s: `${label(s)}（${s}）`, n: byStatus[s] })), [{ h: '状态', k: 's' }, { h: '条数', k: 'n' }]);
  console.log('\n按部位：');
  table(parts.map((r) => ({ ...r, ...Object.fromEntries(STATUSES.map((s) => [s, r[s] || '·'])) })), [
    { h: '部位', k: 'part', max: 32 }, { h: '共', k: 'total' }, { h: '未解决', k: 'unresolved' },
    ...STATUSES.map((s) => ({ h: label(s), k: s })),
  ]);
}

const COMMANDS = { list: cmdList, ls: cmdList, show: cmdShow, reply: cmdReply, status: cmdStatus, export: cmdExport, import: cmdImport, summary: cmdSummary };
const [cmd, ...rest] = opt.pos;
if (opt.help) usage();
if (!cmd) usage('缺少命令');
if (!COMMANDS[cmd]) usage(`未知命令：${cmd}`);
try { COMMANDS[cmd](rest); }
catch (e) { console.error(`错误：${e instanceof FbError ? e.message : e.stack || e}`); process.exit(1); }
