// web/tools/lib/house-mc-views.mjs — 把 V3.houseMc.build() 的结果画成平面 / 南立面 / 东剖面（SVG 片段，自己的颜色）。
// 坐标照场景：+x 东、+y 上、+z 南（海）。1 格 = 1 米。
import { openGrid, rgbOf, hex } from './house-mc-grid.mjs';
import { COL, mix, textWidth, arrow } from './house-mc-svg.mjs';

const EDGE = 'rgba(0,0,0,0.16)';
const f = (v) => +(+v).toFixed(1);
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
const LEFT = { north: 'west', west: 'south', south: 'east', east: 'north' };   // 往 look 方向看时，左手边
const DIR = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

// 侧面看楼梯 / 半砖的形状：[[x0, y0, x1, y1]…]，格子里 0–1，y 向上
function profile(st, kind, look) {
  if (kind === 'slabTop') return [[0, 0.5, 1, 1]];
  if (kind === 'slabBottom') return [[0, 0, 1, 0.5]];
  if (kind !== 'stairs') return [[0, 0, 1, 1]];
  const fc = st.props.facing, top = st.props.half === 'top';
  if (fc === look || fc === OPP[look]) return [[0, 0, 1, 1]];
  const lo = top ? [0, 0.5, 1, 1] : [0, 0, 1, 0.5], hy = top ? [0, 0.5] : [0.5, 1];
  return [lo, fc === LEFT[look] ? [0, hy[0], 0.5, hy[1]] : [0.5, hy[0], 1, hy[1]]];
}
const isFull = (k) => k === 'full' || k === 'door';

// 沿视线找：最前面那个实心的（first）；它不满一格时，再找后面第一个形状不一样的（behind，填 first 空着的那块）；
// first 前面的细东西（thin，只留最前一个）
const FULL = JSON.stringify([[0, 0, 1, 1]]);
function scanLine(G, cells, look) {
  let first = null, key = ''; const thin = [];
  for (const [x, y, z, d] of cells) {
    const k = G.kind(x, y, z);
    if (k === 'air') continue;
    if (k === 'thin') { if (!first && !thin.length) thin.push({ st: G.state(x, y, z), d }); continue; }
    const st = G.state(x, y, z), pr = JSON.stringify(profile(st, k, look));
    if (!first) { first = { st, kind: k, d }; key = pr; if (pr === FULL) break; continue; }
    if (pr !== key) return { first, behind: { st, kind: k, d }, thin };
  }
  return { first, behind: null, thin };
}

function cellRect(C, X, Y, s, st, fade, parts, o = {}) {
  const fill = hex(mix(rgbOf(st), fade));
  for (const [a, b, c, d] of parts) C.rect(X + a * s, Y + (1 - d) * s, (c - a) * s, (d - b) * s, { fill, stroke: o.stroke || EDGE, strokeWidth: o.sw || 0.6 });
  if (o.mid) C.line(X, Y + s / 2, X + s, Y + s / 2, { stroke: EDGE, strokeWidth: 0.8 });
}

function sideThin(C, X, Y, s, t, look, fade) {
  const p = t.st.props, id = t.st.id, op = (1 - fade).toFixed(2);
  if (id === 'glass_pane') {
    const along = look === 'north' || look === 'south' ? p.east === 'true' || p.west === 'true' : p.north === 'true' || p.south === 'true';
    if (along) C.rect(X + 1.5, Y + 1.5, s - 3, s - 3, { fill: COL.glass, stroke: COL.glassLine, strokeWidth: 1, opacity: op });
    else C.rect(X + s * 0.44, Y, s * 0.12, s, { fill: COL.glassLine, opacity: op });
  } else if (id.endsWith('_fence')) {
    const col = hex(mix(rgbOf(t.st), fade)), L = LEFT[look], R = OPP[L];
    C.rect(X + s * 0.375, Y, s * 0.25, s, { fill: col, stroke: EDGE, strokeWidth: 0.6 });
    for (const [side, a, b] of [[L, 0, 0.375], [R, 0.625, 1]]) if (p[side] === 'true')
      for (const y1 of [9, 15]) C.rect(X + a * s, Y + (1 - y1 / 16) * s, (b - a) * s, s * 3 / 16, { fill: col });
  } else if (id === 'lantern') {
    const up = p.hanging === 'true' ? 1 / 16 : 0;
    if (up) C.line(X + s / 2, Y, X + s / 2, Y + (1 - 9 / 16 - up) * s, { stroke: COL.ink, strokeWidth: 1, opacity: op });
    C.rect(X + s * 5 / 16, Y + (1 - 7 / 16 - up) * s, s * 6 / 16, s * 7 / 16, { fill: COL.lamp, stroke: COL.ink, strokeWidth: 0.8, opacity: op });
    C.rect(X + s * 6 / 16, Y + (1 - 9 / 16 - up) * s, s * 4 / 16, s * 2 / 16, { fill: COL.ink, opacity: op });
  }
}

function drawColumn(C, G, X, Y, s, cells, look, k, cut) {
  const { first, behind, thin } = scanLine(G, cells, look), fade = (d) => Math.min(cut ? 0.72 : 0.6, d * k);
  if (behind) cellRect(C, X, Y, s, behind.st, fade(behind.d), profile(behind.st, behind.kind, look));
  if (first) {
    const atCut = cut && first.d === 0, mid = first.kind === 'stairs' && profile(first.st, 'stairs', look).length === 1;
    cellRect(C, X, Y, s, first.st, fade(first.d), profile(first.st, first.kind, look), atCut ? { stroke: COL.cut, sw: 1.3, mid } : { mid });
    if (first.kind === 'door' && first.st.props.half === 'upper') C.rect(X + s * 0.22, Y + s * 0.2, s * 0.56, s * 0.4, { fill: COL.glass, stroke: COL.glassLine, strokeWidth: 0.8 });
  }
  for (const t of thin) sideThin(C, X, Y, s, t, look, fade(t.d));
}

// 南立面：从南往北看，东在右边。返回投影 { px(x米), py(y米), w, h }
export function drawSouth(C, r, { x: X0, y: Y0, s }) {
  const G = openGrid(r), gi = r.info.grid, top = G.max[1] + 1;
  const V = { s, px: (x) => X0 + (x - gi.minX) * s, py: (y) => Y0 + (top - y) * s, w: (gi.maxX - gi.minX + 1) * s, h: top * s };
  C.rect(X0 - s, V.py(0), V.w + 2 * s, s * 0.6, { fill: COL.sand });
  for (let y = 0; y < top; y++) for (let x = gi.minX; x <= gi.maxX; x++) {
    const cells = [];
    for (let z = gi.maxZ; z >= gi.minZ; z--) cells.push([x, y, z, Math.max(0, gi.z1 - z)]);
    drawColumn(C, G, V.px(x), V.py(y + 1), s, cells, 'north', 0.06, false);
  }
  return V;
}

// 东剖面：在 x = cutX 切开，从东往西看，南（海）在左边。切到的描深色边，后面的按远近变淡。
export function drawSection(C, r, { x: X0, y: Y0, s, cutX }) {
  const G = openGrid(r), gi = r.info.grid, top = G.max[1] + 1, cx = cutX ?? r.info.stairs.x;
  const V = { s, cutX: cx, pz: (z) => X0 + (gi.maxZ + 1 - z) * s, py: (y) => Y0 + (top - y) * s, w: (gi.maxZ - gi.minZ + 1) * s, h: top * s };
  C.rect(X0 - s, V.py(0), V.w + 2 * s, s * 0.6, { fill: COL.sand });
  for (let y = 0; y < top; y++) for (let z = gi.minZ; z <= gi.maxZ; z++) {
    const cells = [];
    for (let x = cx; x >= gi.minX; x--) cells.push([x, y, z, cx - x]);
    drawColumn(C, G, V.pz(z + 1), V.py(y + 1), s, cells, 'west', 0.07, true);
  }
  return V;
}

export { DIR, f, EDGE, textWidth };
