#!/usr/bin/env node
// tools/dsh-cost.mjs — usage, cost and activity report for one DSH session plus every subagent
// and teammate it spawned, at any depth. Works for any DSH project; Node >= 22.15, no packages.
//
// Sources: session logs <root>/sessions/<workspace>/<id>/session.v4.jsonl.zstd and the DSH usage
// ledger <root>/.dshw-usage.json. <root> defaults to ~/.dsh.
//
// Usage:
//   node tools/dsh-cost.mjs <session id or prefix> [options]
//     --turns            one row per turn: time span, calls, tokens, cost, end reason, files edited
//     --tools            tool-call counts and the most edited files of each session
//     --count a,b        count tool calls whose arguments contain each text, e.g. shoot.mjs,build.mjs
//     --price in,out,cr  CNY per million tokens for turns the ledger cannot match
//                        (default: the table fitted from matched turns, else 1,4,0.02)
//     --usd in,out,cr    add a USD column at these list prices per million tokens, e.g. 5,25,0.5
//     --json file        also write the full report as JSON
//     --root dir         DSH data directory
//
// Matching: when a turn finishes, DSH appends one ledger event {ts, model, cost, tokens} per model.
// The event has no session id, and ts is the time of the turn's last model call. A turn is matched
// to the unused event of the same model whose tokens are within 3% of the turn's total and whose ts
// lies 5 min before to 15 min after that last call. Unmatched or still-running turns are priced with
// the fitted table and counted in the "est" column.
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

const USAGE = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1)
  .filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n');

// ------------------------------------------------------------------ arguments
const argv = process.argv.slice(2);
const VALUED = new Set(['--count', '--price', '--usd', '--json', '--root']);
const opts = {};
let target;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUED.has(a)) opts[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) opts[a.slice(2)] = true;
  else if (!target) target = a;
}
if (!target || opts.help) { console.log(USAGE); process.exit(target ? 0 : 1); }
const die = (msg) => { console.error(msg); process.exit(1); };
const triple = (s, name) => {
  if (!s) return null;
  const v = String(s).split(',').map(Number);
  if (v.length !== 3 || v.some((x) => !Number.isFinite(x))) die(`--${name} needs three numbers: in,out,cacheRead`);
  return v;
};
const userPrice = triple(opts.price, 'price');
const usd = triple(opts.usd, 'usd');
const DEFAULT_PRICE = [1, 4, 0.02];
const countKeys = opts.count ? String(opts.count).split(',').filter(Boolean) : [];
const root = opts.root || path.join(os.homedir(), '.dsh');
const sessRoot = path.join(root, 'sessions');
if (!fs.existsSync(sessRoot)) die('no DSH sessions directory at ' + sessRoot);

// ------------------------------------------------------------------ log decoding
// A log is a chain of zstd frames. Bytes inside a frame can look like the frame magic, so a slice
// that fails to decode is widened to the next candidate; a truncated last frame (log still being
// written) is skipped.
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const frameOffsets = (buf) => {
  const offs = [];
  for (let i = buf.indexOf(MAGIC); i >= 0; i = buf.indexOf(MAGIC, i + 1)) offs.push(i);
  offs.push(buf.length);
  return offs;
};
const decodeEvents = (file, maxFrames = Infinity) => {
  const buf = fs.readFileSync(file), offs = frameOffsets(buf), parts = [];
  let k = 0;
  while (k + 1 < offs.length && parts.length < maxFrames) {
    let ok = false;
    for (let j = k + 1; j < offs.length; j++) {
      try { parts.push(zlib.zstdDecompressSync(buf.subarray(offs[k], offs[j])).toString('utf8')); k = j; ok = true; break; } catch { /* widen */ }
    }
    if (!ok) break;
  }
  const events = [];
  for (const line of parts.join('').split('\n')) {
    if (!line) continue;
    try { events.push(JSON.parse(line)); } catch { /* partial line */ }
  }
  return events;
};
// The first event of every log is {type:'session', id, createdAt, cwd, parentSession?, origin?}.
const headSession = (file) => {
  const fd = fs.openSync(file, 'r');
  let buf;
  try {
    const n = Math.min(fs.fstatSync(fd).size, 1 << 18);
    buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, 0);
  } finally { fs.closeSync(fd); }
  const offs = frameOffsets(buf);
  for (let j = 1; j < offs.length; j++) {
    try { return JSON.parse(zlib.zstdDecompressSync(buf.subarray(0, offs[j])).toString('utf8').split('\n')[0]); } catch { /* widen */ }
  }
  return decodeEvents(file, 1)[0] || null;
};

// ------------------------------------------------------------------ find the session tree
const logs = [];
for (const ws of fs.readdirSync(sessRoot, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue;
  for (const d of fs.readdirSync(path.join(sessRoot, ws.name), { withFileTypes: true })) {
    const file = path.join(sessRoot, ws.name, d.name, 'session.v4.jsonl.zstd');
    if (d.isDirectory() && fs.existsSync(file)) logs.push({ dir: d.name, file, mtime: fs.statSync(file).mtimeMs });
  }
}
const bare = (s) => s.replace(/^session-/, '');
const hits = logs.filter((L) => bare(L.dir).startsWith(bare(target)));
if (hits.length !== 1) die(hits.length ? `ambiguous id ${target}: ${hits.map((h) => h.dir).join(', ')}` : `no session matches ${target} under ${sessRoot}`);
const rootHead = headSession(hits[0].file);
if (!rootHead || rootHead.type !== 'session') die('cannot read the session header of ' + hits[0].file);
const heads = new Map();
for (const L of logs) {
  if (L.mtime < rootHead.createdAt) continue;   // descendants are written after the root was created
  const h = L === hits[0] ? rootHead : headSession(L.file);
  if (h && h.type === 'session') heads.set(h.id, { ...L, head: h });
}
const nodes = [], seen = new Set();
const visit = (id, depth) => {
  if (seen.has(id) || !heads.has(id)) return;
  seen.add(id);
  nodes.push({ ...heads.get(id), depth });
  const kids = [...heads.values()].filter((h) => h.head.parentSession === id).sort((a, b) => a.head.createdAt - b.head.createdAt);
  for (const k of kids) visit(k.head.id, depth + 1);
};
visit(rootHead.id, 0);

// ------------------------------------------------------------------ per-session analysis
const members = new Map();   // child session id -> teammate name (from team/member events)
const relPath = (p, cwd) => {
  let s = String(p || '').replace(/\\/g, '/');
  const c = String(cwd || '').replace(/\\/g, '/');
  if (c && s.toLowerCase().startsWith(c.toLowerCase() + '/')) s = s.slice(c.length + 1);
  return s;
};
const reasonText = (r) => {
  if (!r) return 'unknown';
  if (r.kind === 'error') { const m = /\((\d{3})\)/.exec((r.error && r.error.message) || ''); return 'error' + (m ? ':' + m[1] : ''); }
  return r.kind || 'unknown';
};
const firstString = (o) => { for (const v of Object.values(o || {})) if (typeof v === 'string' && v.trim()) return v.trim(); return ''; };
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

const analyze = (node) => {
  const S = {
    id: node.head.id, dir: node.dir, depth: node.depth, created: node.head.createdAt, origin: node.head.origin || 'root',
    parent: node.head.parentSession || null, cwd: node.head.cwd, label: '', title: '', model: '',
    turns: new Map(), tools: {}, files: {}, counts: {}, retries: 0, first: 0, last: 0,
  };
  const turn = (n) => {
    if (!S.turns.has(n)) S.turns.set(n, { n, t0: 0, t1: 0, lastUsage: 0, end: null, calls: 0, in: 0, out: 0, cr: 0, tot: 0, byModel: {}, tools: 0, files: {} });
    return S.turns.get(n);
  };
  for (const e of decodeEvents(node.file)) {
    const d = e.data || {}, t = typeof e.time === 'number' ? e.time : 0;
    if (t) { S.first = S.first || t; S.last = Math.max(S.last, t); }
    if (typeof d.turn === 'number' && t) { const T = turn(d.turn); T.t0 = T.t0 || t; T.t1 = Math.max(T.t1, t); }
    switch (e.type) {
      case 'subagent/descriptor': S.label = d.label || S.label; S.model = d.agentModel || S.model; break;
      case 'session/title': S.title = firstString(d) || S.title; break;
      case 'team/member': if (d.member && d.member.id) members.set(d.member.id, d.member.name); break;
      case 'turn/end': turn(d.turn).end = reasonText(d.reason); break;
      case 'llm/retry': S.retries++; break;
      case 'assistant/message': {
        const u = d.usage;
        if (!u) break;
        const T = turn(d.turn), model = (d.message && d.message.source && d.message.source.model) || S.model || 'unknown';
        const i = u.inputTokens || 0, o = u.outputTokens || 0, c = u.cacheReadTokens || 0, all = u.totalTokens || i + o + c;
        T.calls++; T.in += i; T.out += o; T.cr += c; T.tot += all; T.lastUsage = Math.max(T.lastUsage, t);
        const m = (T.byModel[model] = T.byModel[model] || { in: 0, out: 0, cr: 0, tot: 0 });
        m.in += i; m.out += o; m.cr += c; m.tot += all;
        break;
      }
      case 'tool/call': {
        const T = turn(d.turn), raw = typeof d.arguments === 'string' ? d.arguments : JSON.stringify(d.arguments || {});
        T.tools++; bump(S.tools, d.name);
        if (/^(write|edit|ops_replace)$/.test(d.name)) {
          let a = {};
          try { a = JSON.parse(raw); } catch { /* not JSON */ }
          const p = relPath(a.file_path || a.path, S.cwd);
          if (p) { bump(S.files, p); bump(T.files, p); }
        }
        for (const key of countKeys) if (raw.includes(key)) bump(S.counts, key);
        break;
      }
    }
  }
  return S;
};
const sessions = nodes.map(analyze);

// ------------------------------------------------------------------ ledger matching and price fit
const ledgerFile = path.join(root, '.dshw-usage.json');
let ledger = [];
try {
  const j = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  ledger = (Array.isArray(j) ? j : j.events || []).map((e) => ({
    ts: typeof e.ts === 'number' ? e.ts : Date.parse(e.ts), model: e.model, cost: Number(e.cost) || 0, tokens: Number(e.tokens) || 0,
  }));
} catch { /* no ledger: everything is estimated */ }
const units = [];
for (const S of sessions) for (const T of S.turns.values()) for (const [model, m] of Object.entries(T.byModel)) units.push({ S, T, model, ...m, last: T.lastUsage });
units.sort((a, b) => a.last - b.last);
const used = new Set();
for (const u of units) {
  let best = null;
  for (const e of ledger) {
    if (used.has(e) || e.model !== u.model || !u.tot) continue;
    const dt = e.ts - u.last, r = e.tokens / u.tot;
    if (dt < -300e3 || dt > 900e3 || Math.abs(r - 1) > 0.03) continue;
    const score = Math.abs(Math.log(r)) * 10 + Math.abs(dt) / 600e3;
    if (!best || score < best.score) best = { e, score };
  }
  if (best) { used.add(best.e); u.ledger = best.e; }
}
const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const fits = {};
for (const model of new Set(units.map((u) => u.model))) {
  const rows = units.filter((u) => u.model === model && u.ledger);
  if (rows.length < 3) continue;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (const u of rows) {
    const x = [u.in / 1e6, u.out / 1e6, u.cr / 1e6];
    for (let r = 0; r < 3; r++) { b[r] += x[r] * u.ledger.cost; for (let c = 0; c < 3; c++) A[r][c] += x[r] * x[c]; }
  }
  const D = det3(A);
  if (!(Math.abs(D) > 1e-12)) continue;
  const p = [0, 1, 2].map((k) => det3(A.map((row, r) => row.map((v, c) => (c === k ? b[r] : v)))) / D);
  if (p.some((v) => !Number.isFinite(v) || v < -1e-6)) continue;
  const resid = Math.max(...rows.map((u) => Math.abs(u.ledger.cost - (p[0] * u.in + p[1] * u.out + p[2] * u.cr) / 1e6)));
  fits[model] = { price: p, matched: rows.length, maxResidual: resid };
}
const priceOf = (model) => userPrice || (fits[model] && fits[model].price) || DEFAULT_PRICE;
const atPrice = (p, x) => (p[0] * x.in + p[1] * x.out + p[2] * x.cr) / 1e6;
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
for (const u of units) { u.cost = u.ledger ? u.ledger.cost : atPrice(priceOf(u.model), u); u.est = !u.ledger; }
for (const S of sessions) {
  const us = units.filter((u) => u.S === S);
  S.ledgerCost = sum(us.filter((u) => !u.est), (u) => u.cost);
  S.estCost = sum(us.filter((u) => u.est), (u) => u.cost);
  for (const T of S.turns.values()) {
    const tu = us.filter((u) => u.T === T);
    T.cost = sum(tu, (u) => u.cost);
    T.est = tu.some((u) => u.est);
  }
  const ts = [...S.turns.values()];
  for (const k of ['calls', 'in', 'out', 'cr', 'tot']) S[k] = sum(ts, (T) => T[k]);
  S.usd = usd ? atPrice(usd, S) : null;
  S.role = S.depth === 0 ? 'lead' : members.has(S.id) ? 'teammate ' + members.get(S.id) : S.origin;
}

// ------------------------------------------------------------------ report
const fmtT = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n));
const hm = (t) => (t ? new Date(t).toLocaleTimeString('en-GB', { hour12: false }) : '--:--:--');
const dayOf = (t) => new Date(t).toLocaleDateString('sv-SE');
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const ends = (S) => {
  const c = {};
  for (const T of S.turns.values()) bump(c, T.end || 'running');
  return Object.entries(c).map(([k, v]) => (v > 1 ? v + '×' : '') + k).join(' ');
};
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}×${v}`).join(' ');
const pad = (s, n, right) => (right ? String(s).padStart(n) : String(s).padEnd(n));
const lead = sessions[0];
console.log(`DSH session report: ${lead.id}${lead.title ? ` "${short(lead.title, 40)}"` : ''}`);
console.log(`created ${dayOf(lead.created)} ${hm(lead.created)}   cwd ${lead.cwd}`);
console.log(`sessions: 1 root + ${sessions.length - 1} descendants   ledger: ${ledgerFile} (${ledger.length} events)\n`);
const head = [pad('session', 9), pad('role', 18), pad('label', 34), pad('turns', 5, 1), pad('calls', 6, 1), pad('in', 8, 1), pad('out', 7, 1),
  pad('cacheRd', 8, 1), pad('¥ledger', 8, 1), pad('¥est', 7, 1), ...(usd ? [pad('$list', 8, 1)] : []), '  span          ', ' retries', '  turn ends'];
console.log(head.join(' '));
const row = (S) => [pad(bare(S.id).slice(0, 8), 9), pad(short(' '.repeat(S.depth ? S.depth - 1 : 0) + S.role, 18), 18), pad(short(S.label || S.title || '-', 34), 34),
  pad(S.turns.size, 5, 1), pad(S.calls, 6, 1), pad(fmtT(S.in), 8, 1), pad(fmtT(S.out), 7, 1), pad(fmtT(S.cr), 8, 1), pad(S.ledgerCost.toFixed(2), 8, 1),
  pad(S.estCost.toFixed(2), 7, 1), ...(usd ? [pad(S.usd.toFixed(2), 8, 1)] : []), ` ${hm(S.first).slice(0, 5)}–${hm(S.last).slice(0, 5)}   `, pad(S.retries, 7, 1), '  ' + ends(S)].join(' ');
for (const S of sessions) {
  console.log(row(S));
  if (opts.turns) {
    for (const T of [...S.turns.values()].sort((a, b) => a.n - b.n)) {
      console.log(`      turn ${pad(T.n, 3)} ${hm(T.t0)}–${hm(T.t1)}  ${pad(T.calls, 4, 1)} calls  in ${pad(fmtT(T.in), 7)} out ${pad(fmtT(T.out), 6)} cacheRd ${pad(fmtT(T.cr), 7)}`
        + ` ¥${T.cost.toFixed(2)}${T.est ? ' est' : ''}  end ${T.end || 'running'}${Object.keys(T.files).length ? '  files: ' + top(T.files, 5) : ''}`);
    }
  }
  if (opts.tools) {
    console.log(`      tools: ${top(S.tools, 8) || '-'}`);
    if (Object.keys(S.files).length) console.log(`      most edited: ${top(S.files, 6)}`);
  }
}
const all = { calls: sum(sessions, (S) => S.calls), in: sum(sessions, (S) => S.in), out: sum(sessions, (S) => S.out), cr: sum(sessions, (S) => S.cr) };
const totLedger = sum(sessions, (S) => S.ledgerCost), totEst = sum(sessions, (S) => S.estCost);
console.log([pad('TOTAL', 9), pad('', 18), pad('', 34), pad(sum(sessions, (S) => S.turns.size), 5, 1), pad(all.calls, 6, 1), pad(fmtT(all.in), 8, 1), pad(fmtT(all.out), 7, 1),
  pad(fmtT(all.cr), 8, 1), pad(totLedger.toFixed(2), 8, 1), pad(totEst.toFixed(2), 7, 1), ...(usd ? [pad(sum(sessions, (S) => S.usd).toFixed(2), 8, 1)] : [])].join(' '));
const inAll = all.in + all.cr;
console.log(`\ncost ¥${(totLedger + totEst).toFixed(2)} = ledger ¥${totLedger.toFixed(2)} + estimated ¥${totEst.toFixed(2)};`
  + ` cache-read share of input ${inAll ? ((100 * all.cr) / inAll).toFixed(1) : 0}%`);
for (const [model, f] of Object.entries(fits)) {
  console.log(`DSH price fitted for ${model} (CNY per million tokens): in ${f.price[0].toFixed(4)}  out ${f.price[1].toFixed(4)}  cacheRead ${f.price[2].toFixed(4)}`
    + `  from ${f.matched} matched turns, max residual ¥${f.maxResidual.toFixed(4)}`);
}
const unmatched = units.filter((u) => u.est);
if (unmatched.length) {
  const how = userPrice ? '--price ' + userPrice.join(',') : Object.keys(fits).length ? 'the fitted table' : 'the default table ' + DEFAULT_PRICE.join(',') + ' (override with --price)';
  console.log(`${unmatched.length} turn(s) have no ledger event (still running, or not recorded); they are priced with ${how}`);
}
if (usd) console.log(`$list uses ${usd.join(',')} USD per million tokens (in,out,cacheRead) as given by --usd`);
if (countKeys.length) {
  console.log('\ntool calls whose arguments contain:');
  console.log(pad('', 28) + countKeys.map((k) => pad(short(k, 14), 15, 1)).join(''));
  for (const S of sessions) console.log(pad(bare(S.id).slice(0, 8) + ' ' + short(S.role, 18), 28) + countKeys.map((k) => pad(S.counts[k] || 0, 15, 1)).join(''));
  console.log(pad('TOTAL', 28) + countKeys.map((k) => pad(sum(sessions, (S) => S.counts[k] || 0), 15, 1)).join(''));
}
if (opts.json) {
  const out = {
    root: lead.id, generatedAt: new Date().toISOString(), ledgerFile, fits,
    totals: { ...all, ledgerCost: totLedger, estCost: totEst },
    sessions: sessions.map((S) => ({
      id: S.id, parent: S.parent, role: S.role, label: S.label || S.title, created: S.created, first: S.first, last: S.last,
      calls: S.calls, in: S.in, out: S.out, cacheRead: S.cr, ledgerCost: S.ledgerCost, estCost: S.estCost, usd: S.usd,
      retries: S.retries, tools: S.tools, files: S.files, counts: S.counts,
      turns: [...S.turns.values()].map(({ byModel, ...T }) => ({ ...T, byModel })),
    })),
  };
  fs.writeFileSync(opts.json, JSON.stringify(out, null, 2));
  console.log('\nwrote ' + opts.json);
}
