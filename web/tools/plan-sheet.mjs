#!/usr/bin/env node
// tools/plan-sheet.mjs — 「小屋 2.0」草图（给用户确认）。只读 src/40-layout.js（改布局只改那里）。
//   node tools/plan-sheet.mjs  →  test/tmp-plan/sheet.html  →  shots/plan/plan-{site,ground,loft,section}.png + sheet.png
// 坐标：米，+x 东，+z 南（海），y = 绝对高度。平面图北朝上：page-x = x，page-y = z。
// stdout 还会列出家具两两重叠、挡门扇/挡楼梯的物件。浏览器：TOOLKIT_BROWSER，否则标准安装位置的 Edge。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ctx = { window: { V3: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', '40-layout.js'), 'utf8'), ctx, { filename: 'src/40-layout.js' });
const L = ctx.window.V3.layout, H = L.house, SLAB = 0.25; // 阁楼楼板厚（3.5–3.75）：一楼净高 = loftY − floorY − SLAB
const f2 = (v) => { const s = String(+(+v).toFixed(2)); return s.includes('.') ? s : s + '.0'; }; // 标注数字：0.25 m 格，最多两位小数
const PANELS = [], DEFS = []; // sections below register { id, build() → { w, h, svg } }; main() runs after the module is evaluated
setImmediate(() => main().catch((e) => { console.error((e && e.stack) || e); process.exit(1); }));

// ---- svg helpers
const C = { ink: '#3b2a1a', wall: '#4a3020', sand: '#f3e3c0', floor: '#fbf6ec', furn: '#ead9bd', furnS: '#7a5a3a', wood: '#c99a62',
  tag: '#fffaf0', lamp: '#f2b630', girl: '#e5799c', thin: '#8a6f55', paper: '#fffdf8' };
const r1 = (v) => Math.round(v * 10) / 10;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tw = (s, f) => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) >= 0x2e80 ? 1 : 0.56) * f, 0); // estimated text width
const T = (x, y, s, o = {}) => `<text x="${r1(x)}" y="${r1(y)}" font-size="${o.fs || 18}"${o.a ? ` text-anchor="${o.a}"` : ''}${o.b ? ' font-weight="700"' : ''} fill="${o.c || C.ink}"`
  + `${o.halo ? ` stroke="${o.halo}" stroke-width="5" stroke-linejoin="round" paint-order="stroke"` : ''}${o.at || ''}>${esc(s)}</text>`;
const rect = (x, y, w, h, st = '') => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" ${st}/>`;
const line = (x1, y1, x2, y2, st = `stroke="${C.ink}"`) => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" ${st}/>`;
const circ = (x, y, r, st) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" ${st}/>`;
const hit = (a, b, pad = 0) => a[0] < b[2] + pad && b[0] < a[2] + pad && a[1] < b[3] + pad && b[1] < a[3] + pad;
const wrap = (s, f, maxW) => (String(s).match(/[\x21-\x7e²×≥–…°]+|.[）)，。、；：！？]*/gsu) || []).reduce((ls, tok) => { // never splits numbers / words
  if (ls.at(-1) && tw(ls.at(-1) + tok, f) > maxW) ls.push(tok === ' ' ? '' : tok); else ls[ls.length - 1] += tok; return ls; }, ['']);
const OC = { towel: '#7fb0dd', boxW: '#a58ad0', boxE: '#f0a3bf', chest: '#b98550', succ: '#8cc07a', stepMat: '#d9b48a', rocks: '#a9a49b', reefE: '#8f8a80', reefW: '#8f8a80' };
const svgWrap = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const header = (w, title, sub) => rect(0, 0, w, 54, `fill="${C.wall}"`) + T(20, 37, title, { fs: 28, b: 1, c: '#fff8ea' }) + (sub ? T(w - 20, 36, sub, { fs: 19, a: 'end', c: C.sand }) : '');
DEFS.push(`<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.ink}"/></marker>`);
function legend(x, y, w, title, rows, f = 18) { // rows [[tag, text]] → tagged list wrapped to width w; returns { s, y }
  let s = title ? T(x, y, title, { fs: 21, b: 1 }) : '';
  const kw = Math.max(24, ...rows.map(([k]) => (k.startsWith('#') ? 24 : tw(k, 18) + 10))); // '#rrggbb' key = colour dot
  for (const [k, txt] of rows) {
    const ls = wrap(txt, f, w - kw - 8);
    y += f + 10;
    s += k.startsWith('#') ? circ(x + 12, y - 6, 9, `fill="${k}" stroke="${C.ink}" stroke-width="1.2"`)
      : rect(x, y - 18, kw, 24, `rx="12" fill="${C.tag}" stroke="${C.ink}" stroke-width="1.3"`) + T(x + kw / 2, y, k, { fs: 18, a: 'middle', b: 1 });
    ls.forEach((l, i) => { s += T(x + kw + 8, y + i * (f + 5), l, { fs: f }); });
    y += (ls.length - 1) * (f + 5);
  }
  return { s, y };
}

// ---- plan view (一楼/阁楼共用画框): page-x = x, page-y = z
const PV = { x0: -8, x1: 9, z0: -15, z1: -1.5, s: 40, ox: 24, oy: 74 };
const px = (x) => PV.ox + (x - PV.x0) * PV.s, pz = (z) => PV.oy + (z - PV.z0) * PV.s;
const pbox = (it) => (Array.isArray(it) ? it : [it.x0, it.z0, it.x1, it.z1]).map((v, i) => (i % 2 ? pz(v) : px(v)));
const box = (it, st) => { const b = pbox(it); return rect(b[0], b[1], b[2] - b[0], b[3] - b[1], st); };
const wallRect = (w, a0, a1, t = H.wallT) => // wall piece (outer face flush with the footprint) → [x0, z0, x1, z1]
  w === 's' ? [a0, H.z1 - t, a1, H.z1] : w === 'n' ? [a0, H.z0, a1, H.z0 + t] : w === 'w' ? [H.x0, a0, H.x0 + t, a1] : [H.x1 - t, a0, H.x1, a1];
const wallFull = (w) => (w === 's' || w === 'n' ? wallRect(w, H.x0, H.x1) : wallRect(w, H.z0, H.z1));
function doorGeo(g) { // hinge on the a1 jamb, leaf swings inward; quad = bounding box of the swing (metres)
  const ax = g.wall === 's' || g.wall === 'n', n = { s: -1, n: 1, w: 1, e: -1 }[g.wall], r = g.a1 - g.a0;
  const f = { s: H.z1 - H.wallT, n: H.z0 + H.wallT, w: H.x0 + H.wallT, e: H.x1 - H.wallT }[g.wall], P = (a, o) => (ax ? [a, f + o] : [f + o, a]);
  const hinge = P(g.a1, 0), tip = P(g.a1, n * r), shut = P(g.a0, 0), xs = [hinge[0], tip[0], shut[0]], zs = [hinge[1], tip[1], shut[1]];
  return { hinge, tip, shut, r, quad: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
}
function walls(loft) { // solid wall pieces + door (leaf + dashed swing arc) / window (double thin line) in the gaps
  let s = '';
  for (const w of ['n', 's', 'w', 'e']) {
    const ax = w === 's' || w === 'n', gaps = L.openings.filter((o) => o.wall === w && (o.y0 >= H.loftY) === loft).sort((a, b) => a.a0 - b.a0);
    let a = ax ? H.x0 : H.z0;
    for (const g of [...gaps, { a0: ax ? H.x1 : H.z1, a1: 0 }]) { if (g.a0 > a) s += box(wallRect(w, a, g.a0), `fill="${C.wall}"`); a = Math.max(a, g.a1); }
    for (const g of gaps) {
      const r = pbox(wallRect(w, g.a0, g.a1));
      if (g.id === 'door') {
        const d = doorGeo(g), [hx, hy, tx, ty, sx, sy] = [...d.hinge, ...d.tip, ...d.shut].map((v, i) => (i % 2 ? pz(v) : px(v)));
        const sweep = (tx - hx) * (sy - hy) - (ty - hy) * (sx - hx) > 0 ? 1 : 0, R = r1(d.r * PV.s);
        s += `<path d="M${r1(tx)} ${r1(ty)} A${R} ${R} 0 0 ${sweep} ${r1(sx)} ${r1(sy)}" fill="none" stroke="${C.thin}" stroke-width="1.6" stroke-dasharray="6 4"/>`
          + line(hx, hy, tx, ty, `stroke="${C.wall}" stroke-width="4"`);
        continue;
      }
      s += rect(r[0], r[1], r[2] - r[0], r[3] - r[1], `fill="#fff" stroke="${C.wall}" stroke-width="1.5"`);
      for (const f of [0.36, 0.64]) {
        s += ax ? line(r[0], r[1] + (r[3] - r[1]) * f, r[2], r[1] + (r[3] - r[1]) * f, `stroke="${C.wall}" stroke-width="1.3"`)
          : line(r[0] + (r[2] - r[0]) * f, r[1], r[0] + (r[2] - r[0]) * f, r[3], `stroke="${C.wall}" stroke-width="1.3"`);
      }
    }
  }
  return s;
}
// ---- furniture, stairs, number tags
const numbering = (items) => { const m = new Map(); for (const it of items) if (!m.has(it.label)) m.set(it.label, m.size + 1); return (it) => String(m.get(it.label)); };
const legendRows = (items, num) => [...new Map(items.map((it) => [it.label, num(it)])).entries()].map(([lab, k]) => [k, lab]);
function furn(it) {
  const b = pbox(it), w = b[2] - b[0], h = b[3] - b[1];
  if (it.up) return stairs(it);
  if (it.round) return `<ellipse cx="${r1(b[0] + w / 2)}" cy="${r1(b[1] + h / 2)}" rx="${r1(w / 2)}" ry="${r1(h / 2)}" fill="#bcd3ea" fill-opacity="0.8" stroke="#5f86b0" stroke-width="1.5"/>`;
  if (it.ceiling) return it.id === 'lights' ? box(it, `fill="none" stroke="${C.lamp}" stroke-width="2.5" stroke-dasharray="3 5"`)
    : circ(b[0] + w / 2, b[1] + h / 2, Math.min(w, h) / 2, `fill="none" stroke="#c98a10" stroke-width="2.5" stroke-dasharray="5 3"`);
  if (it.wallY !== undefined) return box(it, `fill="#b98d5c" stroke="${C.furnS}" stroke-width="1"`);
  if (it.id === 'mat') return box(it, `fill="#d9b48a" fill-opacity="0.6" stroke="${C.furnS}" stroke-width="1" stroke-dasharray="4 3"`);
  if (/plant/i.test(it.id)) return circ(b[0] + w / 2, b[1] + h / 2, Math.min(w, h) / 2, `fill="#9cc58a" stroke="#4f7a3e" stroke-width="1.6"`);
  return box(it, `rx="5" fill="${C.furn}" stroke="${C.furnS}" stroke-width="1.6"`);
}
function stairs(it, word = '上') { // n treads; 上 at the foot, arrow toward the top (up: 's' = rises toward the south)
  const b = pbox(it), n = it.n || 13, alongZ = it.up === 's' || it.up === 'n', dir = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[it.up];
  let s = rect(b[0], b[1], b[2] - b[0], b[3] - b[1], `fill="#efe0c4" stroke="${C.furnS}" stroke-width="1.6"`);
  for (let i = 1; i < n; i++) {
    const f = i / n;
    s += alongZ ? line(b[0], b[1] + (b[3] - b[1]) * f, b[2], b[1] + (b[3] - b[1]) * f, `stroke="${C.furnS}" stroke-width="1"`)
      : line(b[0] + (b[2] - b[0]) * f, b[1], b[0] + (b[2] - b[0]) * f, b[3], `stroke="${C.furnS}" stroke-width="1"`);
  }
  const len = alongZ ? b[3] - b[1] : b[2] - b[0], cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const P = (d) => [cx + dir[0] * (d - len / 2), cy + dir[1] * (d - len / 2)], [lx, ly] = P(15), [ax, ay] = P(30), [bx, by] = P(len - 5);
  return s + T(lx, ly + 7, word, { fs: 19, a: 'middle', b: 1, halo: '#efe0c4' }) + circ(ax, ay, 3.5, `fill="${C.ink}"`)
    + line(ax, ay, bx, by, `stroke="${C.ink}" stroke-width="2.2" marker-end="url(#arr)"`);
}
function tags(items, num, occ, out = []) { // tag inside the rect when it fits, else the nearest free spot (toward the room centre) + leader
  const R = 13, lead = [], dots = [], fr = pbox([PV.x0, PV.z0, PV.x1, PV.z1]), hc = [px((H.x0 + H.x1) / 2), pz((H.z0 + H.z1) / 2)];
  const fits = (it) => { const b = pbox(it); return !out.includes(it.id) && b[2] - b[0] >= 2 * R + 2 && b[3] - b[1] >= 2 * R + 2; };
  for (const it of [...items].sort((a, b) => fits(b) - fits(a))) {
    const b = pbox(it), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, hw = (b[2] - b[0]) / 2, hh = (b[3] - b[1]) / 2, me = occ.find((o) => o.id === it.id);
    const inH = (p) => p[0] > px(H.x0) && p[0] < px(H.x1) && p[1] > pz(H.z0) && p[1] < pz(H.z1), mine = inH([cx, cy]);
    const cands = fits(it) ? [[cx, cy, -1]] : []; // order: inside the rect, same side of the walls as the item, nearer ring, nearer the room centre
    [18, 28, 42, 60, 84].forEach((d, ri) => cands.push(...[[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].map(([u, v]) => [cx + u * (hw + d), cy + v * (hh + d), ri])));
    const key = (p) => [p[2] < 0 ? 0 : 1, inH(p) === mine ? 0 : 1, p[2], Math.hypot(p[0] - hc[0], p[1] - hc[1])];
    cands.sort((p, q) => { const a = key(p), c = key(q); return a[0] - c[0] || a[1] - c[1] || a[2] - c[2] || a[3] - c[3]; });
    const ok = (p) => {
      const t = [p[0] - R, p[1] - R, p[0] + R, p[1] + R];
      return t[0] >= fr[0] && t[1] >= fr[1] && t[2] <= fr[2] && t[3] <= fr[3] && occ.every((o) => (o === me && p[0] === cx && p[1] === cy) || !hit(t, o.b, 1));
    };
    const anc = (p) => [Math.min(Math.max(p[0], b[0]), b[2]), Math.min(Math.max(p[1], b[1]), b[3])];
    const crosses = (p, q) => { const n = Math.max(2, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 4)); // leader through other furniture/tags?
      for (let i = 1; i < n; i++) { const x = p[0] + ((q[0] - p[0]) * i) / n, y = p[1] + ((q[1] - p[1]) * i) / n;
        if (occ.some((o) => o !== me && o.id !== 'wall' && x > o.b[0] && x < o.b[2] && y > o.b[1] && y < o.b[3])) return true; }
      return false; };
    const p = cands.find((c) => ok(c) && (c[2] < 0 || !crosses(c, anc(c)))) || cands.find(ok) || [cx, cy];
    occ.push({ id: 'tag', b: [p[0] - R, p[1] - R, p[0] + R, p[1] + R] });
    if (p[0] !== cx || p[1] !== cy) {
      const q = anc(p);
      lead.push(line(p[0], p[1], q[0], q[1], `stroke="${C.ink}" stroke-width="1.2"`) + circ(q[0], q[1], 2.4, `fill="${C.ink}"`));
    }
    dots.push(circ(p[0], p[1], R, `fill="${C.tag}" stroke="${C.ink}" stroke-width="1.5"`) + T(p[0], p[1] + 6, num(it), { fs: 18, a: 'middle', b: 1 }));
  }
  return lead.join('') + dots.join('');
}

// ---- 门廊（木地板、栏杆、3 级台阶）+ 灯笼 + 画框内的屋外小物件 → { under: 画在屋内地面之前, over: 画在墙之后 }
const inFrame = (it) => it.x0 >= PV.x0 && it.x1 <= PV.x1 && it.z0 >= PV.z0 && it.z1 <= PV.z1;
function porch() {
  const P = L.porch, st = P.steps, n = st.n || 3, b = pbox(P), sb = pbox(st), rail = `stroke="${C.furnS}" stroke-width="4"`;
  let u = rect(b[0], b[1], b[2] - b[0], b[3] - b[1], `fill="#e3bf8c" stroke="${C.furnS}" stroke-width="1.2"`), o = '';
  for (let z = P.z0 + 0.3; z < P.z1 - 0.05; z += 0.3) u += line(b[0], pz(z), b[2], pz(z), `stroke="#c99f69" stroke-width="1"`);
  u += rect(sb[0], sb[1], sb[2] - sb[0], sb[3] - sb[1], `fill="#d6aa72" stroke="${C.furnS}" stroke-width="1.4"`);
  for (let i = 1; i < n; i++) u += line(sb[0], sb[1] + ((sb[3] - sb[1]) * i) / n, sb[2], sb[1] + ((sb[3] - sb[1]) * i) / n, `stroke="${C.furnS}" stroke-width="1.2"`);
  const rails = [[b[0], b[1], b[0], b[3]], [b[2], b[1], b[2], b[3]], [b[0], b[3], sb[0], b[3]], [sb[2], b[3], b[2], b[3]]];
  if (P.x0 < H.x0) rails.push([b[0], b[1], px(H.x0), b[1]]);
  if (P.x1 > H.x1) rails.push([px(H.x1), b[1], b[2], b[1]]);
  u += rails.map((q) => line(...q, rail)).join('');
  const posts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]], [sb[0], b[3]], [sb[2], b[3]],
    ...L.lanterns.filter(([, z]) => Math.abs(z - P.z1) < 0.05).map(([x]) => [px(x), b[3]])];
  u += posts.map(([x, y]) => rect(x - 4.5, y - 4.5, 9, 9, `fill="${C.wall}"`)).join('');
  const col = OC;
  for (const it of L.outside.filter(inFrame)) {
    if (it.id === 'succ') {
      const y = pz((it.z0 + it.z1) / 2);
      for (const x of [it.x0 + 0.25, it.x1 - 0.25]) o += circ(px(x), y, 7, `fill="#8cc07a" stroke="#4f7a3e" stroke-width="1.3"`);
    } else if (it.h <= 0.05 && !it.wallY) u += box(it, `fill="#d9b48a" fill-opacity="0.6" stroke="${C.furnS}" stroke-width="1" stroke-dasharray="4 3"`);
    else o += box(it, `rx="2" fill="${col[it.id] || C.furn}" stroke="${C.furnS}" stroke-width="1.3"`);
  }
  o += L.lanterns.map(([x, z]) => circ(px(x), pz(z), 6, `fill="${C.lamp}" stroke="#9a6a00" stroke-width="1.4"`)).join('');
  const cx = L.outside.find((it) => it.id === 'chest');
  o += T(px((P.x0 + P.x1) / 2 + 3.6), b[3] - 13, `木门廊 · 栏杆 ${P.railH} m`, { fs: 18, a: 'middle', halo: '#e3bf8c' }) // low on the deck, clear of the 窗/门 tags
    + T(sb[2] + 34, sb[3] - 12, `台阶 ×${n}`, { fs: 18, halo: C.sand });
  if (cx && inFrame(cx)) o += T(pbox(cx)[2] + 20, pbox(cx)[3] + 24, '木箱+灯笼', { fs: 18, a: 'end', halo: C.sand });
  return { under: u, over: o };
}

// ---- ② 一楼平面
const planOcc = (items, skip) => [...['n', 's', 'w', 'e'].map((w) => ({ id: 'wall', b: pbox(wallFull(w)) })),
  ...items.filter((it) => !skip.includes(it.id)).map((it) => ({ id: it.id, b: pbox(it) }))];
PANELS.push({ id: 'ground', build() {
  const W = 1200, HH = 820, num = numbering(L.ground), fr = pbox([PV.x0, PV.z0, PV.x1, PV.z1]);
  const occ = [...planOcc(L.ground, ['rug', 'mat', 'pendant']), { id: 'swing', b: pbox(doorGeo(L.openings.find((o) => o.id === 'door')).quad) }];
  let s = rect(0, 0, W, HH, `fill="${C.paper}"`) + header(W, '② 一楼平面', `一楼地面 +${f2(H.floorY)} m · 净高 ${f2(H.loftY - H.floorY - SLAB)} m`);
  const pc = porch();
  s += rect(fr[0], fr[1], fr[2] - fr[0], fr[3] - fr[1], `fill="${C.sand}"`) + pc.under + box([H.x0, H.z0, H.x1, H.z1], `fill="${C.floor}"`);
  const ot = openTags(false, occ), gx = px(-0.6), gy = pz(-8.1), gt = `她 ${L.girlH} m`; // girl marker (scale) in the open living area
  occ.push({ id: 'girl', b: [gx - 9, gy - 9, gx + 9, gy + 9] }, { id: 'girlT', b: [gx + 13, gy - 11, gx + 17 + tw(gt, 18), gy + 11] });
  const dS = `stroke="${C.ink}" stroke-width="1.5"`, dA = `${dS} marker-start="url(#arr)" marker-end="url(#arr)"`, xA = px(H.x0), xB = px(H.x1), zA = pz(H.z0), zB = pz(H.z1), dy = pz(H.z0 - 0.7), dx = px(H.x1 + 2.2);
  const dims = line(xA, dy, xB, dy, dA) + line(xA, zA - 4, xA, dy - 6, dS) + line(xB, zA - 4, xB, dy - 6, dS) + T(px((H.x0 + H.x1) / 2 - 3), dy + 6, `${H.x1 - H.x0} m`, { fs: 18, b: 1, a: 'middle', halo: C.sand })
    + line(dx, zA, dx, zB, dA) + line(xB + 6, zA, dx + 8, zA, dS) + line(px(L.porch.x1) + 8, zB, dx + 8, zB, dS) + T(dx, (zA + zB) / 2 + 6, `${H.z1 - H.z0} m`, { fs: 18, b: 1, a: 'middle', halo: C.sand });
  s += L.ground.map(furn).join('') + walls(false) + pc.over + dims + ot.s + tags(L.ground, num, occ, ['stairs', 'pendant'])
    + circ(gx, gy, 9, `fill="${C.girl}" stroke="#fff" stroke-width="2"`) + T(gx + 15, gy + 6, gt, { fs: 18, halo: C.floor });
  s += legend(fr[2] + 24, 92, W - fr[2] - 36, '家具（图中编号）', legendRows(L.ground, num)).s;
  const grp = new Map(); // same name before '（' → one row: 花箱（紫花 / 粉花）
  for (const it of L.outside.filter(inFrame)) {
    const [, nm, ds] = /^([^（]*)(?:（(.*)）)?$/.exec(it.label), g = grp.get(nm);
    if (g) g.ds.push(ds); else grp.set(nm, { c: OC[it.id] || C.furn, ds: [ds] });
  }
  const outs = [[C.lamp, `灯笼 ×${L.lanterns.length}（门廊柱头 + 门两侧）`], ...[...grp].map(([nm, g]) => [g.c, nm + (g.ds.some(Boolean) ? `（${g.ds.filter(Boolean).join(' / ')}）` : '')])];
  s += legend(24, fr[3] + 30, 400, '门窗', ot.rows, 18).s + legend(440, fr[3] + 30, 340, '门廊 / 屋外', outs, 18).s;
  return { w: W, h: HH, svg: svgWrap(W, HH, s) };
} });

// ---- 门/窗 标签（墙外），两张平面图共用
function openTags(loft, occ) { // '门' / '窗n' just outside the walls → { s, rows }; tag boxes go into occ
  let s = ''; const rows = [], wins = L.openings.filter((o) => o.id !== 'door');
  for (const o of L.openings.filter((g) => (g.y0 >= H.loftY) === loft)) {
    const k = o.id === 'door' ? '门' : `窗${wins.indexOf(o) + 1}`, m = (o.a0 + o.a1) / 2, d = o.wall === 's' && !loft ? 0.8 : 0.45;
    const [x, z] = o.wall === 's' ? [m, H.z1 + d] : o.wall === 'n' ? [m, H.z0 - d] : o.wall === 'w' ? [H.x0 - d - 0.05, m] : [H.x1 + d + 0.05, m];
    const w = tw(k, 18) + 12, cx = px(x), cy = pz(z);
    s += rect(cx - w / 2, cy - 12, w, 24, `rx="12" fill="#fff" stroke="${C.wall}" stroke-width="1.6"`) + T(cx, cy + 6, k, { fs: 18, a: 'middle', b: 1 });
    occ.push({ id: 'otag', b: [cx - w / 2, cy - 12, cx + w / 2, cy + 12] });
    rows.push([k, o.label]);
  }
  return { s, rows };
}
const para = (x, y, w, lines, f = 18, o = {}) => { let s = ''; for (const l of lines) for (const seg of wrap(l, f, w)) { s += T(x, y, seg, { fs: f, ...o }); y += f + 7; } return { s, y }; };

// ---- ③ 阁楼平面：层高 = 屋顶内表面 − 阁楼地面（0.1 m 网格）+ 1.4 m 等高线
const RZ = (H.z0 + H.z1) / 2, HD = (H.z1 - H.z0) / 2, SL = (H.ridgeY - H.eaveY) / HD, CG = H.crossGable; // main ridge E–W at z = RZ
const CGC = (CG.x0 + CG.x1) / 2, CGW = (CG.x1 - CG.x0) / 2, CGS = (CG.ridgeY - H.eaveY) / CGW;      // cross gable over the door
const ceilY = (x, z) => Math.max(H.eaveY + SL * (HD - Math.abs(z - RZ)), x >= CG.x0 && x <= CG.x1 && z >= RZ ? H.eaveY + CGS * (CGW - Math.abs(x - CGC)) : -Infinity);
const headCls = (x, z) => { const h = ceilY(x, z) - H.loftY + 1e-9; return h < 1.0 ? 0 : h < 1.4 ? 1 : 2; };
const HEAD = [{ fill: 'url(#hLow)', name: '太矮(放箱子)', rng: '< 1.0 m' }, { fill: 'url(#hMid)', name: '只能坐/爬', rng: '1.0–1.4 m' }, { fill: C.floor, name: '能站', rng: '≥ 1.4 m' }];
DEFS.push(`<pattern id="hLow" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#c9a77e"/><rect width="3" height="8" fill="#6b4a2b"/></pattern>`,
  `<pattern id="hMid" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#f3e2c4"/><rect width="1.6" height="10" fill="#b88f62"/></pattern>`);
const edges = (a, b, d = 0.1) => { const e = [a]; for (let k = Math.floor(a / d + 1e-6) + 1; k * d < b - 1e-6; k++) e.push(+(k * d).toFixed(2)); return [...e, b]; };
function headroom() { // → { shade, line (1.4 m contour), area [m² per class, stair hole excluded] }
  const t = H.wallT, xe = edges(H.x0 + t, H.x1 - t), ze = edges(H.z0 + t, H.z1 - t), hole = L.loft.find((it) => it.id === 'stairHole');
  const cls = ze.slice(1).map((z1, j) => xe.slice(1).map((x1, i) => headCls((xe[i] + x1) / 2, (ze[j] + z1) / 2)));
  const inHole = (x, z) => hole && x > hole.x0 && x < hole.x1 && z > hole.z0 && z < hole.z1, area = [0, 0, 0], d = ['', ''];
  const hs = new Map(), vs = new Map(), add = (m, k, a, b) => { if (!m.has(k)) m.set(k, []); m.get(k).push([a, b]); };
  for (let j = 0; j < cls.length; j++) {
    let i0 = 0;
    for (let i = 0; i <= cls[j].length; i++) {
      if (i < cls[j].length) {
        if (!inHole((xe[i] + xe[i + 1]) / 2, (ze[j] + ze[j + 1]) / 2)) area[cls[j][i]] += (xe[i + 1] - xe[i]) * (ze[j + 1] - ze[j]);
        if (j + 1 < cls.length && (cls[j][i] === 2) !== (cls[j + 1][i] === 2)) add(hs, ze[j + 1], xe[i], xe[i + 1]);
        if (i + 1 < cls[j].length && (cls[j][i] === 2) !== (cls[j][i + 1] === 2)) add(vs, xe[i + 1], ze[j], ze[j + 1]);
      }
      if (i === cls[j].length || cls[j][i] !== cls[j][i0]) {
        if (cls[j][i0] < 2) d[cls[j][i0]] += `M${r1(px(xe[i0]))} ${r1(pz(ze[j]))}H${r1(px(xe[i]))}V${r1(pz(ze[j + 1]))}H${r1(px(xe[i0]))}Z`;
        i0 = i;
      }
    }
  }
  const merge = (m, horiz) => [...m].map(([k, segs]) => segs.sort((a, b) => a[0] - b[0])
    .reduce((o, sg) => { const l = o.at(-1); if (l && Math.abs(l[1] - sg[0]) < 1e-6) l[1] = sg[1]; else o.push([...sg]); return o; }, [])
    .map(([a, b]) => (horiz ? `M${r1(px(a))} ${r1(pz(k))}H${r1(px(b))}` : `M${r1(px(k))} ${r1(pz(a))}V${r1(pz(b))}`)).join('')).join('');
  return { area, shade: d.map((p, k) => (p ? `<path d="${p}" fill="${HEAD[k].fill}"/>` : '')).join(''),
    line: `<path d="${merge(hs, true)}${merge(vs, false)}" fill="none" stroke="#c0392b" stroke-width="3" stroke-linecap="round"/>` };
}
function stairHole(it) { // treads seen through the floor opening, 下 arrow, rail on the open side(s) (not walls, not the arrival side)
  const t = H.wallT, st = L.ground.find((g) => g.up && hit([g.x0, g.z0, g.x1, g.z1], [it.x0, it.z0, it.x1, it.z1])), top = st ? st.up : 's', b = pbox(it);
  let s = st ? stairs({ ...st, x0: it.x0, x1: it.x1, z0: it.z0, z1: it.z1, up: { s: 'n', n: 's', e: 'w', w: 'e' }[top] }, '下') : '';
  s += rect(b[0], b[1], b[2] - b[0], b[3] - b[1], `fill="#5a4632" fill-opacity="0.14" stroke="${C.ink}" stroke-width="1.5"`);
  const sides = { n: [it.x0, it.z0, it.x1, it.z0], s: [it.x0, it.z1, it.x1, it.z1], w: [it.x0, it.z0, it.x0, it.z1], e: [it.x1, it.z0, it.x1, it.z1] };
  const atWall = { n: it.z0 <= H.z0 + t + 0.01, s: it.z1 >= H.z1 - t - 0.01, w: it.x0 <= H.x0 + t + 0.01, e: it.x1 >= H.x1 - t - 0.01 };
  for (const [k, q] of Object.entries(sides)) {
    if (atWall[k] || k === top) continue;
    s += line(px(q[0]), pz(q[1]), px(q[2]), pz(q[3]), `stroke="${C.wood}" stroke-width="6" stroke-linecap="round"`) + circ(px(q[0]), pz(q[1]), 4, `fill="${C.wall}"`) + circ(px(q[2]), pz(q[3]), 4, `fill="${C.wall}"`);
  }
  return s;
}
function roofLines() { // ridges + valleys (plan projection), dashed
  const st = `stroke="#7d6a58" stroke-width="1.6" stroke-dasharray="10 6"`, zm = RZ + HD - (CG.ridgeY - H.eaveY) / SL; // cross ridge meets the main roof at zm
  return [[H.x0, RZ, H.x1, RZ], [CGC, zm, CGC, H.z1], [CGC, zm, CG.x0, H.z1], [CGC, zm, CG.x1, H.z1]].map(([a, b, c, e]) => line(px(a), pz(b), px(c), pz(e), st)).join('');
}
PANELS.push({ id: 'loft', build() {
  const W = 1200, HH = 820, num = numbering(L.loft), fr = pbox([PV.x0, PV.z0, PV.x1, PV.z1]), hr = headroom(), t = H.wallT, lx = fr[2] + 24, lw = W - fr[2] - 36;
  const occ = planOcc(L.loft, ['lights']), ot = openTags(true, occ), ev = [H.x0 - H.overhang, H.z0 - H.overhang, H.x1 + H.overhang, H.z1 + H.overhang];
  const lab = (x, z, str) => { const p = [px(x), pz(z)]; occ.push({ id: 'lab', b: [p[0], p[1] - 17, p[0] + tw(str, 18), p[1] + 5] }); return T(p[0], p[1], str, { fs: 18, halo: C.floor }); };
  let s = rect(0, 0, W, HH, `fill="${C.paper}"`) + header(W, '③ 阁楼平面', `阁楼地面 +${f2(H.loftY)} m · 矮墙 ${f2(H.eaveY - H.loftY)} m · 最高 ${f2(H.ridgeY - H.loftY)} m`);
  s += rect(fr[0], fr[1], fr[2] - fr[0], fr[3] - fr[1], `fill="#efe7d8"`) + box(ev, `fill="none" stroke="${C.thin}" stroke-width="1.4" stroke-dasharray="8 5"`)
    + T(px(ev[0]), pz(ev[3]) + 26, `外圈虚线 = 屋檐（挑出 ${H.overhang} m）`, { fs: 18, c: C.thin });
  s += box([H.x0, H.z0, H.x1, H.z1], `fill="${C.floor}"`) + hr.shade + roofLines();
  s += L.loft.map((it) => (it.id === 'stairHole' ? stairHole(it) : furn(it))).join('') + hr.line + walls(true) + ot.s;
  s += lab(0.3, H.z0 + t + 0.68, '▲ 只能坐/爬') + lab(2.2, H.z1 - t - 0.72, '▼ 只能坐/爬') + lab(0.9, H.z0 + t + 1.65, '能站（≥ 1.4 m）')
    + lab(3.0, RZ - 0.22, `脊 ${H.ridgeY} m`) + lab(CGC + 0.15, H.z1 - 1.4, `脊 ${CG.ridgeY} m`);
  s += tags(L.loft, num, occ, ['stairHole', 'lights']);
  const lg = legend(lx, 92, lw, '阁楼物件（图中编号）', legendRows(L.loft, num));
  let y = lg.y + 48;
  s += lg.s + T(lx, y, '层高 = 屋顶内表面 − 阁楼地面', { fs: 21, b: 1 });
  HEAD.forEach((hd, k) => { y += 34; s += rect(lx, y - 19, 44, 26, `fill="${hd.fill}" stroke="${C.ink}" stroke-width="1"`) + T(lx + 56, y, `${hd.rng}  ${hd.name}：${r1(hr.area[k])} m²`, { fs: 18 }); });
  y += 34; s += line(lx, y - 6, lx + 44, y - 6, `stroke="#c0392b" stroke-width="3"`) + T(lx + 56, y, '红线 = 1.4 m 等高线', { fs: 18 });
  const minH = (ceilY(H.x1 - t, H.z0 + t) - H.loftY).toFixed(2), nd = CGW - (1.4 - (H.eaveY - H.loftY)) / CGS, deg = Math.round((Math.atan(SL) * 180) / Math.PI);
  const notes = [`坡度 ${deg}°：离南/北墙每 1 m 高 ${r1(SL)} m；墙内皮处层高 ${minH} m${hr.area[0] < 0.05 ? '，所以屋里没有 < 1.0 m 的地方' : ''}`,
    `小山墙（门上方）下面，x ${r1(CGC - nd)}…${r1(CGC + nd)} m 靠南墙也能站`, '虚线：主屋脊（东西向）、小山墙屋脊、斜沟（俯视投影）'];
  s += para(lx, y + 40, lw, notes, 18, { c: '#5b4632' }).s + legend(24, fr[3] + 36, 420, '门窗（阁楼）', ot.rows).s;
  return { w: W, h: HH, svg: svgWrap(W, HH, s) };
} });

// ---- ① 场地总图（整个 L.site，北在上，12.5 px/m）
const ST = L.site, SV = { s: 12.5, ox: 24, oy: 74 };
const sx = (x) => SV.ox + (x - ST.x0) * SV.s, sz = (z) => SV.oy + (z - ST.z0) * SV.s;
const sbx = (b, st) => rect(sx(b[0]), sz(b[1]), (b[2] - b[0]) * SV.s, (b[3] - b[1]) * SV.s, st);
const ZF = { sand: C.sand, wash: '#ead3a4', wet: '#cdb48a', wade: 'url(#gWade)', swim: 'url(#gSwim)' }, ZD = { ...ZF, wade: '#9fd4ea', swim: '#2f6f9e' }; // fill / legend dot
DEFS.push('<linearGradient id="gWade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c4e8f3"/><stop offset="1" stop-color="#7cc3e0"/></linearGradient>',
  '<linearGradient id="gSwim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa6d2"/><stop offset="1" stop-color="#1f4f86"/></linearGradient>',
  '<marker id="arrO" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" orient="auto"><path d="M0 0L10 5L0 10z" fill="#e08a1e"/></marker>');
const sunG = (x, y, r) => circ(x, y, r, 'fill="#ffd25a" stroke="#e08a1e" stroke-width="2"') + [...Array(8)].map((_, k) => { const a = (k * Math.PI) / 4;
  return line(x + Math.cos(a) * (r + 3), y + Math.sin(a) * (r + 3), x + Math.cos(a) * (r + 8), y + Math.sin(a) * (r + 8), 'stroke="#e08a1e" stroke-width="2" stroke-linecap="round"'); }).join('');
PANELS.unshift({ id: 'site', build() {
  const W = 1200, HH = 820, fr = [sx(ST.x0), sz(ST.z0), sx(ST.x1), sz(ST.z1)], P = L.porch, st = P.steps, zc = (id) => L.zones.find((z) => z.id === id);
  let s = rect(0, 0, W, HH, `fill="${C.paper}"`) + header(W, '① 场地总图', `场地 ${ST.x1 - ST.x0} × ${ST.z1 - ST.z0} m · 北在上 · 海在南`);
  s += rect(fr[0], fr[1], fr[2] - fr[0], fr[3] - fr[1], `fill="${C.sand}"`) + L.zones.map((z) => sbx([z.x0, z.z0, z.x1, z.z1], `fill="${ZF[z.id] || C.sand}"`)).join('');
  const wz = zc('wash'), wt = zc('wet');
  for (let k = 0; k < 90 && wz; k++) { // shells / starfish / bottles in the visible wash band, clear of its label
    const x = wz.x0 + 0.4 + (((k * 37) % 89) / 89) * (wz.x1 - wz.x0 - 0.8), z = wz.z0 + 0.15 + (((k * 53) % 31) / 31) * ((wt ? wt.z0 : wz.z1) - wz.z0 - 0.3);
    if (Math.abs(x) < 14.5 && z > 8.45 && z < 10.5) continue;
    s += circ(sx(x), sz(z), 2.3, `fill="${['#fff6e8', '#f2a7a0', '#f7c95a', '#bfe3f2'][k % 4]}" stroke="#a88a62" stroke-width="0.6"`);
  }
  let fm = ''; // foam line along the shore, gap behind the 湿沙 label
  for (const [a, b] of [[ST.x0, -5.5], [5.5, ST.x1]]) { fm += `M${r1(sx(a))} ${r1(sz(L.sea.shoreZ))}`; for (let x = a + 0.5; x <= b + 1e-6; x += 0.5) fm += `L${r1(sx(x))} ${r1(sz(L.sea.shoreZ + 0.25 * Math.sin(x * 1.3)))}`; }
  s += `<path d="${fm}" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>`;
  s += sbx([P.x0, P.z0, P.x1, P.z1], `fill="#e3bf8c" stroke="${C.furnS}" stroke-width="1.2"`) + sbx([st.x0, st.z0, st.x1, st.z1], `fill="#d6aa72" stroke="${C.furnS}" stroke-width="1.2"`);
  const rocky = (it) => /^(reef|rocks)/.test(it.id);
  for (const it of L.outside) s += sbx([it.x0, it.z0, it.x1, it.z1], `rx="${rocky(it) ? 9 : 1}" fill="${OC[it.id] || C.furn}" stroke="${rocky(it) ? '#5f5a52' : C.furnS}" stroke-width="1.2"`);
  const ov = H.overhang, rb = [H.x0 - ov, H.z0 - ov, H.x1 + ov, H.z1 + ov], zm = RZ + HD - (CG.ridgeY - H.eaveY) / SL;
  s += sbx(rb, `fill="#a8624a" stroke="${C.wall}" stroke-width="2"`) + sbx([H.x0, H.z0, H.x1, H.z1], 'fill="none" stroke="#fff3e0" stroke-width="1.2" stroke-dasharray="5 4"');
  s += [[rb[0], RZ, rb[2], RZ], [CGC, zm, CGC, rb[3]], [CGC, zm, CG.x0 - ov, rb[3]], [CGC, zm, CG.x1 + ov, rb[3]]].map(([a, b, c, d]) => line(sx(a), sz(b), sx(c), sz(d), 'stroke="#6e3b2a" stroke-width="1.6"')).join('');
  s += T(sx((H.x0 + H.x1) / 2), sz(RZ - 1.1), '小屋', { fs: 20, b: 1, a: 'middle', c: '#fff8ea' });
  s += L.lanterns.map(([x, z]) => circ(sx(x), sz(z), 4.5, `fill="${C.lamp}" stroke="#9a6a00" stroke-width="1.2"`)).join('');
  const sp = (t) => [sx(24 * Math.cos(Math.PI * t)), sz(-2 + 22.5 * Math.sin(Math.PI * t))]; // sun path: east (t 0) → south over the sea (0.5) → west (1)
  s += `<path d="M${[...Array(61)].map((_, k) => sp(k / 60).map(r1).join(' ')).join('L')}" fill="none" stroke="#e08a1e" stroke-width="2.5" stroke-dasharray="9 6"/>`;
  for (const t of [0.15, 0.85]) s += `<path d="M${sp(t - 0.006).map(r1).join(' ')}L${sp(t).map(r1).join(' ')}" fill="none" stroke="none" marker-end="url(#arrO)"/>`;
  const [e, n, w] = [sp(0), sp(0.5), sp(1)];
  s += sunG(...e, 9) + sunG(...n, 11) + sunG(...w, 9) + T(e[0], e[1] - 24, '东升', { fs: 18, b: 1, a: 'middle', halo: C.sand }) + T(w[0], w[1] - 24, '西落', { fs: 18, b: 1, a: 'middle', halo: C.sand })
    + T(n[0], sz(23.6), '正午在海面上空（南）', { fs: 18, b: 1, a: 'middle', c: '#fff', halo: '#3d82b5' });
  const hc = [(H.x0 + H.x1) / 2, (H.z0 + H.z1) / 2], az = L.heroCam.az, dv = [-Math.sin(az), -Math.cos(az)], cam = [hc[0] - dv[0] * 19, hc[1] - dv[1] * 19];
  const c0 = [sx(cam[0] + dv[0] * 1.4), sz(cam[1] + dv[1] * 1.4)], c1 = [sx(cam[0] + dv[0] * 8), sz(cam[1] + dv[1] * 8)], ang = r1((Math.atan2(dv[1], dv[0]) * 180) / Math.PI);
  s += line(...c0, ...c1, `stroke="${C.ink}" stroke-width="3" marker-end="url(#arr)"`) + `<g transform="translate(${r1(sx(cam[0]))} ${r1(sz(cam[1]))}) rotate(${ang})">`
    + rect(-14, -9, 22, 18, `rx="3" fill="${C.ink}"`) + rect(8, -6, 8, 12, `fill="${C.ink}"`) + circ(-3, 0, 5, 'fill="#9fd4ea"') + '</g>' + T(sx(cam[0]) + 22, sz(cam[1]) + 6, '主视角', { fs: 18, b: 1, halo: C.sand });
  const zl = { sand: [12, -14, { fs: 22, b: 1, a: 'start' }], wash: [0, 10.0, { fs: 19 }], wet: [0, 12.55, { fs: 18 }], wade: [0, 17.4, { fs: 18 }] };
  for (const [id, [x, z, o]] of Object.entries(zl)) { const zz = zc(id); if (zz) s += T(sx(x), sz(z), zz.label, { a: 'middle', ...o }); }
  const sw = zc('swim'), [s1, s2] = sw ? sw.label.split(/(?=（)/) : [];
  if (sw) s += T(sx(0), sz(27.5), s1, { fs: 20, b: 1, a: 'middle', c: '#fff', halo: '#2a5f92' }) + (s2 ? T(sx(0), sz(27.5) + 25, s2, { fs: 18, a: 'middle', c: '#fff', halo: '#2a5f92' }) : '');
  const far = L.outside.filter((it) => !hit([it.x0, it.z0, it.x1, it.z1], [P.x0 - 0.5, P.z0 - 0.5, P.x1 + 0.5, st.z1 + 0.8]));
  for (const it of far) { // in-plan names: left of the item if west of the house, else right; reefs get their note as a 2nd line
    const b = [sx(it.x0), sz(it.z0), sx(it.x1), sz(it.z1)], right = it.x0 + it.x1 > 0, [nm, note] = [it.label.split('（')[0].trim(), (it.label.match(/（(.*)）/) || [])[1]];
    const x = right ? b[2] + 7 : b[0] - 7, my = (b[1] + b[3]) / 2, o = { fs: 18, a: right ? 'start' : 'end', halo: C.paper };
    s += /^reef/.test(it.id) && note ? T(x, my - 4, nm, o) + T(x, my + 17, note, o) : T(x, my + 6, it.id === 'rocks' ? nm : it.label, o);
  }
  s += T(640, 104, '北', { fs: 20, b: 1, a: 'middle' }) + `<path d="M640 112L652 150L640 141L628 150Z" fill="${C.ink}"/>`; // north arrow
  s += rect(44, 98, 62.5, 8, `fill="${C.ink}"`) + rect(106.5, 98, 62.5, 8, `fill="#fff" stroke="${C.ink}" stroke-width="1.2"`)
    + [[44, '0'], [106.5, '5'], [169, '10 m']].map(([x, t]) => T(x, 126, t, { fs: 18, a: 'middle', halo: C.sand })).join('');
  const lx = fr[2] + 26, lw = W - lx - 20, deg = Math.round((az * 180) / Math.PI);
  const lg1 = legend(lx, 92, lw, '分带（北 → 南）', L.zones.map((z) => [ZD[z.id] || C.sand, z.label]));
  const rows = [[C.lamp, `灯笼 ×${L.lanterns.length}（门廊柱头 + 门两侧）`], ['#a8624a', `小屋 ${H.x1 - H.x0} × ${H.z1 - H.z0} m（白虚线 = 墙，外框 = 屋檐 ${H.overhang} m）+ ${P.label}`],
    ...far.map((it) => [OC[it.id] || C.furn, it.label]), ['#e08a1e', '太阳：东升 → 正午在海面上空（南）→ 西落'], [C.ink, `主视角：从东南（正南偏东 ${deg}°）看向西北`]];
  const lg2 = legend(lx, lg1.y + 44, lw, '图例', rows);
  const nt = para(lx, lg2.y + 44, lw, [`绿化：${L.greenery}`, `天空：${L.sky.note}`, `沙面 y ${ST.sandY} m · 海面 y ${L.sea.y} m · 海岸线 z = ${L.sea.shoreZ} m`], 18, { c: '#5b4632' });
  s += rect(fr[0], fr[1], fr[2] - fr[0], fr[3] - fr[1], `fill="none" stroke="${C.thin}" stroke-width="1.5"`) + lg1.s + lg2.s + nt.s;
  return { w: W, h: HH, svg: svgWrap(W, HH, s) };
} });

// ---- ④ 剖面 A–A：x = CUTX 处南北剖切，海在右（page-x = z，page-y = 高度向上）
const CUTX = 3, QS = { s: 56, z0: -17.2, z1: 3.37, y0: -0.9, y1: 9.6, ox: 24, oy: 74 }, SOFT = /^(rug|mat|frames|jars|pendant|lights)$/;
const qz = (z) => QS.ox + (z - QS.z0) * QS.s, qy = (y) => QS.oy + (QS.y1 - y) * QS.s;
const qrect = (z0, y0, z1, y1, st) => rect(qz(Math.min(z0, z1)), qy(Math.max(y0, y1)), Math.abs(z1 - z0) * QS.s, Math.abs(y1 - y0) * QS.s, st);
const qpoly = (pts, st) => `<polygon points="${pts.map(([z, y]) => `${r1(qz(z))},${r1(qy(y))}`).join(' ')}" ${st}/>`;
const girlSide = (x, yF, hp) => { const u = hp / 8, c = `fill="${C.girl}"`; // girl seen from the side, hp = height in px
  return rect(x - 0.9 * u, yF - 3 * u, 0.7 * u, 3 * u, c) + rect(x + 0.2 * u, yF - 3 * u, 0.7 * u, 3 * u, c) + circ(x, yF - 7 * u, u, c)
    + `<path d="M${r1(x - 0.9 * u)} ${r1(yF - 6.1 * u)}H${r1(x + 0.9 * u)}L${r1(x + 1.6 * u)} ${r1(yF - 2.6 * u)}H${r1(x - 1.6 * u)}Z" ${c}/>`; };
const vdim = (z, ya, yb, label, side, yl) => { const x = qz(z), a = qy(ya), b = qy(yb), st = `stroke="${C.ink}" stroke-width="1.4"`;
  return line(x, a, x, b, `stroke="${C.ink}" stroke-width="1.6" marker-start="url(#arr)" marker-end="url(#arr)"`) + line(x - 7, a, x + 7, a, st) + line(x - 7, b, x + 7, b, st)
    + label.split('\n').map((l, i) => T(x + side * 9, qy(yl) + 6 + i * 23, l, { fs: 18, b: 1, a: side > 0 ? 'start' : 'end', halo: '#fff' })).join(''); };
PANELS.push({ id: 'section', build() {
  const W = 1200, HH = 820, t = H.wallT, ov = H.overhang, P = L.porch, PS = P.steps, fr = [qz(QS.z0), qy(QS.y1), qz(QS.z1), qy(QS.y0)], MZ = H.z0 + H.z1;
  const SKY = '#eef5f8', CUT = `fill="${C.wall}"`, BEY = `fill="#e8d3b0" fill-opacity="0.45" stroke="${C.furnS}" stroke-width="1.3" stroke-dasharray="5 4"`, RST = `fill="#a8683a" stroke="#6e3b2a" stroke-width="0.6"`, RST2 = `fill="#8a5530" stroke="#5e3420" stroke-width="0.6"`;
  let s = rect(0, 0, W, HH, `fill="${C.paper}"`) + header(W, '④ 剖面 A–A', `x = ${CUTX} m 处南北剖切 · 向东看，海（南）在右`);
  s += rect(fr[0], fr[1], fr[2] - fr[0], fr[3] - fr[1], `fill="${SKY}"`) + qrect(QS.z0, QS.y0, QS.z1, ST.sandY, `fill="${C.sand}"`) + line(fr[0], qy(ST.sandY), fr[2], qy(ST.sandY), 'stroke="#b89a6a" stroke-width="2"');
  const RS = 0.25, zA = H.z0 + t, NC = Math.round((H.z1 - H.z0) / RS), SLP = (H.ridgeY - H.eaveY) / ((H.z1 - H.z0) / 2); // roof: 0.25 m 方块台阶，3 格厚
  const col = (c) => { const m = Math.min(c, NC - 1 - c), U = m >= Math.floor(NC / 2) - 1 ? H.ridgeY : H.eaveY + RS * m * SLP; // c = 0.25 m 列号（0 = 北墙外皮）
    return { z0: H.z0 + RS * c, z1: H.z0 + RS * (c + 1), U, T: H.eaveY + RS * (m + 3) * SLP }; };
  for (const [y, nm, z] of [[H.ridgeY, '屋脊下沿', col(Math.floor(NC / 2) - 1).z0], [H.eaveY, '屋檐', H.z0 - ov], [H.loftY, '阁楼地面', H.z0], [H.floorY, '一楼地面', H.z0], [ST.sandY, '沙面', null]]) {
    s += `<path d="M34 ${r1(qy(y) - 12)}h12l-6 12z" fill="${C.ink}"/>` + T(50, qy(y) - 6, `${y ? '+' + f2(y) : '±0.0'} ${nm}`, { fs: 18, halo: SKY });
    if (z != null) s += line(46, qy(y), qz(z), qy(y), `stroke="${C.thin}" stroke-width="1.2" stroke-dasharray="2 4"`);
  }
  const N = [[zA, H.loftY]]; // loft air under the stepped roof
  for (let c = 1; c <= NC - 2; c++) { const q = col(c); N.push([q.z0, q.U], [q.z1, q.U]); }
  N.push([MZ - zA, H.loftY]);
  s += qrect(zA, H.floorY, H.z1 - t, H.loftY - SLAB, `fill="${C.floor}"`) + qpoly(N, `fill="${C.floor}"`);
  const stp = L.ground.find((g) => g.up === 's' || g.up === 'n');
  if (stp) { // indoor stair, beyond the cut (dashed)
    const n = stp.n || 13, f = stp.up === 'n' ? -1 : 1, za = f > 0 ? stp.z0 : stp.z1, run = (stp.z1 - stp.z0) / n, rise = (H.loftY - H.floorY) / n, pts = [[za, H.floorY]];
    for (let i = 0; i < n; i++) pts.push([za + f * i * run, H.floorY + (i + 1) * rise], [za + f * (i + 1) * run, H.floorY + (i + 1) * rise]);
    s += qpoly([...pts, [za + f * n * run, H.floorY]], BEY);
  }
  const ns = PS.n || 3, rs = (P.y - ST.sandY) / ns, ds = (PS.z1 - PS.z0) / ns, sp = [[PS.z0, P.y]]; // porch steps (projected, dashed): n 级，第一排和门廊面平
  for (let i = 0; i < ns; i++) sp.push([PS.z0 + i * ds, P.y - i * rs], [PS.z0 + (i + 1) * ds, P.y - i * rs]);
  s += qpoly([...sp, [PS.z1, 0], [PS.z0, 0]], BEY) + line(qz(H.z1), qy(P.y + P.railH), qz(P.z1), qy(P.y + P.railH), `stroke="${C.furnS}" stroke-width="2" stroke-dasharray="5 4"`);
  s += qrect(H.z0, H.floorY - SLAB, H.z1, H.floorY, CUT) + qrect(H.z0, H.floorY, zA, H.eaveY, CUT) + qrect(H.z1 - t, H.floorY, H.z1, H.eaveY, CUT) + qrect(zA, H.loftY - SLAB, H.z1 - t, H.loftY, CUT);
  for (let i = 0; i < 4; i++) { const z = H.z0 + 0.2 + (i * (H.z1 - H.z0 - 0.4)) / 3; s += qrect(z - 0.1, 0, z + 0.1, H.floorY - SLAB, CUT); } // piles
  s += qrect(H.z1, P.y - 0.15, P.z1, P.y, `fill="${C.wood}" stroke="${C.wall}" stroke-width="1.5"`) + [H.z1 + 0.15, P.z1 - 0.15].map((z) => qrect(z - 0.08, 0, z + 0.08, P.y - 0.15, CUT)).join('');
  if (L.lanterns.some(([x, z]) => Math.abs(x - CUTX) < 0.3 && Math.abs(z - P.z1) < 0.05)) // cut through a railing post with a lantern
    s += qrect(P.z1 - 0.15, P.y, P.z1, P.y + P.railH, CUT) + circ(qz(P.z1 - 0.075), qy(P.y + P.railH) - 9, 7, `fill="${C.lamp}" stroke="#9a6a00" stroke-width="1.4"`);
  const OCN = Math.round(ov / RS); // 挑檐列数
  for (let c = -OCN; c < NC + OCN; c++) { const q = c < 0 || c >= NC ? null : col(c), m = c < 0 ? c : NC - 1 - c, a = q || { z0: H.z0 + RS * c, z1: H.z0 + RS * (c + 1),
      U: H.eaveY + RS * m * SLP, T: H.eaveY + RS * (m + 3) * SLP }; // c < 0 / ≥ NC = 挑檐
    for (let y = a.U; y < a.T - 1e-6; y += RS) s += qrect(a.z0, y, a.z1, y + RS, Math.round((y - H.eaveY) / RS) % 2 ? RST2 : RST); }
  const cut = [[L.ground, H.floorY], [L.loft, H.loftY]].flatMap(([items, y]) => items
    .filter((it) => it.x0 <= CUTX && it.x1 >= CUTX && it.h >= 0.3 && !it.up && !it.ceiling && it.id !== 'stairHole' && !SOFT.test(it.id)).map((it) => [it, y]));
  s += cut.map(([it, y]) => qrect(it.z0, y, it.z1, y + it.h, `fill="${C.furn}" stroke="${C.furnS}" stroke-width="1.5"`)).join('');
  const gp = L.girlH * QS.s, gl = (z, y) => girlSide(qz(z), qy(y), gp) + T(qz(z) - 20, qy(y) - (7 * gp) / 8 + 6, `她 ${L.girlH} m`, { fs: 18, a: 'end', halo: C.floor });
  s += gl(H.z1 - 2.0, H.floorY) + gl(RZ - 0.9, H.loftY);
  s += line(fr[0], qy(L.sea.y), fr[2], qy(L.sea.y), 'stroke="#2f7fb8" stroke-width="2" stroke-dasharray="10 6"') + T(fr[2] - 10, qy(L.sea.y) + 22, `海平面 ${L.sea.y} m`, { fs: 18, a: 'end', c: '#1f5f8f', halo: C.sand })
    + T(fr[2] - 10, qy(ST.sandY) - 14, '→ 海（南）', { fs: 20, b: 1, a: 'end', c: '#1f5f8f', halo: SKY });
  s += vdim(H.z1 - 1.0, H.floorY, H.loftY - SLAB, `一楼净高 ${f2(H.loftY - SLAB - H.floorY)} m`, -1, 2.9)
    + vdim(H.z1 - t - 0.3, H.loftY, H.eaveY, `阁楼矮墙 ${f2(H.eaveY - H.loftY)} m`, -1, (H.loftY + H.eaveY) / 2) + vdim(RZ + 0.2, H.loftY, H.ridgeY, `阁楼最高\n${f2(H.ridgeY - H.loftY)} m`, 1, 5.9);
  s += T(qz(RZ), qy((H.floorY - SLAB) / 2) + 6, `架空层 ${f2(H.floorY - SLAB)} m`, { fs: 18, a: 'middle', halo: SKY }) + T(qz((H.z1 + P.z1) / 2), qy(P.y) - 16, '门廊', { fs: 18, a: 'middle', halo: SKY })
    + T(qz(PS.z1) + 10, qy(P.y / 2) + 6, `台阶 ×${ns}`, { fs: 18, halo: SKY });
  s += rect(fr[0], fr[1], fr[2] - fr[0], fr[3] - fr[1], `fill="none" stroke="${C.thin}" stroke-width="1.5"`) + T(fr[0] + 12, fr[1] + 28, '北', { fs: 20, b: 1 }) + T(fr[2] - 12, fr[1] + 28, '南（海）', { fs: 20, b: 1, a: 'end' });
  const ly = fr[3] + 40, cutNames = cut.map(([it]) => it.label.split('（')[0]).join('、') || '无';
  s += rect(24, ly - 15, 30, 18, CUT) + T(62, ly, '剖到的墙、楼板、门廊', { fs: 18 }) + rect(440, ly - 15, 30, 18, RST) + T(478, ly, `屋顶：${RS} m 一级的方块台阶，${f2(3 * RS)} m 厚，挑檐 ${ov} m`, { fs: 18 })
    + rect(24, ly + 19, 30, 18, BEY) + T(62, ly + 34, '虚线 = 不在剖切面上（楼梯、门廊台阶，投影）', { fs: 18 }) + circ(455, ly + 28, 9, `fill="${C.girl}"`) + T(478, ly + 34, `粉色小人 = 她（${L.girlH} m）`, { fs: 18 });
  s += para(24, ly + 80, W - 48, [`剖到的家具：${cutNames}。一楼净高 = ${f2(H.loftY)} − ${f2(SLAB)}（楼板）− ${f2(H.floorY)} = ${f2(H.loftY - SLAB - H.floorY)} m；阁楼最高 = 屋脊下沿 ${f2(H.ridgeY)} − ${f2(H.loftY)} = ${f2(H.ridgeY - H.loftY)} m；屋脊外顶 ${f2(col(Math.floor(NC / 2)).T)} m`], 18, { c: '#5b4632' }).s;
  return { w: W, h: HH, svg: svgWrap(W, HH, s) };
} });

// ---- render: one HTML page, each panel screenshotted by element
const CHECKS = []; // () => void, print the overlap / clearance report
function findEdge() {
  const dirs = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  return [process.env.TOOLKIT_BROWSER, ...dirs.map((d) => path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))].find((p) => p && fs.existsSync(p));
}
async function main() {
  const tmp = path.join(ROOT, 'test', 'tmp-plan'), out = path.join(ROOT, 'shots', 'plan'), rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
  fs.mkdirSync(tmp, { recursive: true }); fs.mkdirSync(out, { recursive: true });
  const built = [];
  for (const p of PANELS) built.push({ id: p.id, ...p.build(built) });
  for (const c of CHECKS) c();
  const css = 'body{margin:0;background:#cfc6b8;font-family:"Microsoft YaHei","微软雅黑","PingFang SC",sans-serif}.p{display:inline-block;margin:8px;vertical-align:top}.p svg{display:block}';
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>小屋 2.0 草图</title><style>${css}</style>`
    + `<svg width="0" height="0" style="position:absolute"><defs>${DEFS.join('')}</defs></svg>${built.map((b) => `<div class="p" id="p-${b.id}">${b.svg}</div>`).join('')}</html>`;
  const file = path.join(tmp, 'sheet.html');
  fs.writeFileSync(file, html);
  console.log(`page  ${rel(file)}`);
  const exe = findEdge();
  if (!exe) throw new Error('Microsoft Edge not found; set TOOLKIT_BROWSER=<path to msedge.exe>');
  const browser = await require('puppeteer-core').launch({ executablePath: exe, headless: true,
    args: ['--hide-scrollbars', '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check', '--disable-extensions'],
    defaultViewport: { width: 2600, height: 1900, deviceScaleFactor: 1 } });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    for (const b of built) {
      const f = path.join(out, b.id === 'sheet' ? 'sheet.png' : `plan-${b.id}.png`);
      await (await page.$(`#p-${b.id} > svg`)).screenshot({ path: f });
      console.log(`shot  ${rel(f)}  ${b.w}x${b.h}`);
      if (b.id === 'sheet') {   // copy for the studio reference panel (refs/ is read by the feedback tool)
        const r = path.join(ROOT, 'refs', 'plan-house2-sheet.png');
        fs.mkdirSync(path.dirname(r), { recursive: true }); fs.copyFileSync(f, r);
        console.log(`copy  ${rel(r)}`);
      }
    }
  } finally { await browser.close(); }
}
// ---- 检查（stdout + shots/plan/checks.txt）：家具两两重叠、穿墙、门扇扫过范围、楼梯梯段/上下口、阁楼家具头顶
const ov2 = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
const nmIt = (it) => `${it.id}「${it.label.split('（')[0]}」`, CN = { n: '北', s: '南', w: '西', e: '东' }, OPP = { s: 'n', n: 's', e: 'w', w: 'e' };
const solidOf = (items) => items.filter((it) => !SOFT.test(it.id) && !it.ceiling); // rug/mat/frames/jars/pendant/lights may overlap
CHECKS.push(() => {
  const out = [], t = H.wallT, e = 1e-6, D = 0.8, hole = L.loft.find((g) => g.id === 'stairHole');
  const outW = (b) => b.x0 < H.x0 + t - e || b.z0 < H.z0 + t - e || b.x1 > H.x1 - t + e || b.z1 > H.z1 - t + e;
  for (const [fl, items] of [['一楼', L.ground], ['阁楼', L.loft]]) {
    const so = solidOf(items); let n = 0;
    for (let i = 0; i < so.length; i++) for (let j = i + 1; j < so.length; j++) {
      const o = ov2(so[i], so[j]);
      if (o > e) { n++; out.push(`[重叠] ${fl}：${nmIt(so[i])} × ${nmIt(so[j])}  ${o.toFixed(2)} m²`); }
    }
    if (!n) out.push(`[重叠] ${fl}：${so.length} 件家具两两都不重叠（地毯/地垫/画框/调料罐/吊灯/串灯不算）`);
    for (const it of so) if (outW(it)) out.push(`[穿墙] ${fl}：${nmIt(it)} 伸出墙内皮`);
  }
  const dr = L.openings.find((o) => o.id === 'door');
  if (dr) { // anything inside the quarter circle swept by the leaf
    const d = doorGeo(dr), [hx, hz] = d.hinge, q = d.quad; let n = 0;
    for (const it of L.ground.filter((g) => !g.ceiling)) {
      const a = [Math.max(it.x0, q[0]), Math.max(it.z0, q[1]), Math.min(it.x1, q[2]), Math.min(it.z1, q[3])];
      if (a[2] <= a[0] || a[3] <= a[1] || Math.hypot(Math.min(Math.max(hx, a[0]), a[2]) - hx, Math.min(Math.max(hz, a[1]), a[3]) - hz) >= d.r) continue;
      n++; out.push(`[门扇] ${nmIt(it)}（高 ${it.h ?? 0} m）在门扇扫过的范围里${(it.h ?? 0) <= 0.05 ? '：很薄，门从上面扫过，不挡' : ' → 挡门！'}`);
    }
    if (!n) out.push('[门扇] 门扇扫过的范围里没有东西');
  }
  const zone = (r, k) => k === 'n' ? { x0: r.x0, z0: r.z0 - D, x1: r.x1, z1: r.z0 } : k === 's' ? { x0: r.x0, z0: r.z1, x1: r.x1, z1: r.z1 + D }
    : k === 'w' ? { x0: r.x0 - D, z0: r.z0, x1: r.x0, z1: r.z1 } : { x0: r.x1, z0: r.z0, x1: r.x1 + D, z1: r.z1 };
  const block = (zn, items, skip) => [...(outW(zn) ? ['墙'] : []), ...solidOf(items).filter((it) => !skip.includes(it) && ov2(it, zn) > e).map(nmIt)];
  const under = (x, z) => (hole && x >= hole.x0 && x <= hole.x1 && z >= hole.z0 && z <= hole.z1 ? ceilY(x, z) : H.loftY - SLAB);
  for (const st of L.ground.filter((g) => g.up)) {
    const run = block(st, L.ground, [st]), top = hole ? block(hole, L.loft, [hole]) : [];
    out.push(`[楼梯] 梯段上${run.length ? '有：' + run.join('、') : '空着'}；阁楼楼梯口上${top.length ? '有：' + top.join('、') : '空着'}`);
    const ft = OPP[st.up], lo = block(zone(st, ft), L.ground, [st]);
    const side = (st.up === 'n' || st.up === 's' ? ['w', 'e'] : ['n', 's']).filter((k) => !block(zone(st, k), L.ground, [st]).length).map((k) => CN[k]);
    out.push(`[楼梯] 下口（${CN[ft]}端，前方 ${D} m）：${lo.length ? `被 ${lo.join('、')} 挡住 → 只能从侧面上第一级（空着的一侧：${side.join('、') || '无'}）` : '空着'}`);
    const zt = zone(st, st.up), hi = block(zt, L.loft, [hole]), ha = ceilY((zt.x0 + zt.x1) / 2, (zt.z0 + zt.z1) / 2) - H.loftY;
    out.push(`[楼梯] 上口（阁楼，${CN[st.up]}端，前方 ${D} m）：${hi.length ? `被 ${hi.join('、')} 挡住` : '空着'}，那里层高 ${ha.toFixed(2)} m`);
    const ns = st.up === 'n' || st.up === 's', a0 = ns ? st.z0 : st.x0, a1 = ns ? st.z1 : st.x1, fwd = st.up === 's' || st.up === 'e', cm = ns ? (st.x0 + st.x1) / 2 : (st.z0 + st.z1) / 2;
    const n = st.n || 13, rn = (a1 - a0) / n, rs = (H.loftY - H.floorY) / n; let mh = Infinity;
    for (let i = 0; i < n; i++) for (const f of [i, i + 1]) { const a = fwd ? a0 + f * rn : a1 - f * rn, [x, z] = ns ? [cm, a] : [a, cm]; mh = Math.min(mh, under(x, z) - (H.floorY + (i + 1) * rs)); }
    out.push(`[楼梯] ${n} 级，每级高 ${rs.toFixed(2)} m、深 ${rn.toFixed(2)} m（坡度 ${Math.round((Math.atan2(rs, rn) * 180) / Math.PI)}°）；踏步上方最小净空 ${mh.toFixed(2)} m`);
  }
  let tight = null, bad = 0;
  for (const it of L.loft.filter((g) => !g.ceiling && g !== hole && (g.h ?? 0) > 0)) {
    let m = Infinity;
    for (const x of edges(it.x0, it.x1)) for (const z of edges(it.z0, it.z1)) m = Math.min(m, ceilY(x, z) - H.loftY);
    if (it.h > m - 0.05) { bad++; out.push(`[层高] 阁楼：${nmIt(it)} 高 ${it.h} m，头顶屋面只有 ${m.toFixed(2)} m → 顶到屋顶！`); }
    if (!tight || m - it.h < tight[1]) tight = [it, m - it.h, m];
  }
  if (tight && !bad) out.push(`[层高] 阁楼家具都碰不到屋顶；最紧的是 ${nmIt(tight[0])}：高 ${tight[0].h} m，头顶 ${tight[2].toFixed(2)} m`);
  console.log('\n=== 检查：家具重叠 / 门扇 / 楼梯 / 阁楼层高 ===\n' + out.join('\n') + '\n');
  fs.writeFileSync(path.join(ROOT, 'shots', 'plan', 'checks.txt'), out.join('\n') + '\n');
});

// ---- 总图 sheet.png：2×2 拼版 + 标题栏（标题 · 日期 · 比例尺）
PANELS.push({ id: 'sheet', build(built) {
  const g = 12, top = 84, by = Object.fromEntries(built.map((b) => [b.id, b])), cw = Math.max(...built.map((b) => b.w)), ch = Math.max(...built.map((b) => b.h));
  const W = 2 * cw + 3 * g, HH = top + 2 * ch + 2 * g, d = new Date(), two = (v) => String(v).padStart(2, '0'), date = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  let s = rect(0, 0, W, HH, 'fill="#ddd2bf"') + rect(0, 0, W, top - g, `fill="${C.wall}"`) + T(28, 51, '小屋 2.0 草图 · 待确认', { fs: 38, b: 1, c: '#fff8ea' })
    + T(450, 49, `日期 ${date} · 数据 src/40-layout.js · 生成 tools/plan-sheet.mjs`, { fs: 20, c: C.sand });
  const bars = [['① 场地', SV.s, 10], ['②③ 平面', PV.s, 5], ['④ 剖面', QS.s, 5]], wb = ([l, k, m]) => tw(l, 18) + 8 + k * m + 8 + tw(`${m} m`, 18);
  let x = W - 28 - bars.reduce((a, b) => a + wb(b) + 26, -26) - tw('比例尺', 20) - 14;
  const y = 36;
  s += T(x, y + 7, '比例尺', { fs: 20, b: 1, c: C.sand }); x += tw('比例尺', 20) + 14;
  for (const [l, k, m] of bars) {
    s += T(x, y + 7, l, { fs: 18, c: '#fff8ea' }); x += tw(l, 18) + 8;
    for (let i = 0; i < 5; i++) s += rect(x + (i * k * m) / 5, y - 5, (k * m) / 5, 10, `fill="${i % 2 ? 'none' : '#fff8ea'}" stroke="#fff8ea" stroke-width="1.5"`);
    x += k * m + 8; s += T(x, y + 7, `${m} m`, { fs: 18, c: '#fff8ea' }); x += tw(`${m} m`, 18) + 26;
  }
  [['site', 'ground'], ['loft', 'section']].forEach((row, j) => row.forEach((id, i) => { if (by[id]) s += by[id].svg.replace('<svg ', `<svg x="${g + i * (cw + g)}" y="${top + j * (ch + g)}" `); }));
  return { w: W, h: HH, svg: svgWrap(W, HH, s) };
} });
