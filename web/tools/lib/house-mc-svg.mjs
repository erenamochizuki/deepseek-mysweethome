// web/tools/lib/house-mc-svg.mjs — 小屋 v4 草图（refkit drafts）用的 SVG 小工具。
// 写法照 tools/refkit/gen-lib.mjs，区别：svg() 只返回字符串（house-mc.mjs 的 check 要在内存里比），写到哪里由调用的人定。
// 颜色只用自己的（17-mcfallback 的颜色 + 这里的几种），不用 MC 贴图。

const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const attrs = (o) => Object.entries(o || {}).filter(([, v]) => v != null).map(([k, v]) => `${kebab(k)}="${v}"`).join(' ');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (v) => +(+v).toFixed(1);

export const COL = Object.freeze({
  ink: '#24324a', sub: '#5a6478', bg: '#fbf8f1', sand: '#dccf9c', sea: '#9cc3d5', grid: '#0000001f', cut: '#3b3d46',
  girl: '#e5799c', skin: '#f7d9c6', player: '#50709e', legs: '#3b3d46', path: '#e07b2a', note: '#c0392b',
  furn: '#f6efe2', glass: '#d0e8f0', glassLine: '#5b8fb0', lamp: '#f0c050',
});
export const BG_RGB = [0xfb, 0xf8, 0xf1];

// 往 to（默认背景色）方向混 t（0–1）
export const mix = (rgb, t, to = BG_RGB) => rgb.map((v, i) => v + (to[i] - v) * t);

// 粗估文字宽度（中文按 1 个字号，ASCII 按 0.56 个字号）
export function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) w += ch.charCodeAt(0) < 0x2e80 ? 0.56 : 1;
  return w * size;
}

export function canvas(W = 1600, H = 1000) {
  const out = [];
  const C = {
    W, H,
    raw: (s) => out.push(s),
    rect: (x, y, w, h, o) => out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${attrs(o)}/>`),
    line: (x1, y1, x2, y2, o) => out.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${attrs(o)}/>`),
    poly: (pts, o) => out.push(`<polygon points="${pts.map(([x, y]) => f(x) + ',' + f(y)).join(' ')}" ${attrs(o)}/>`),
    pline: (pts, o) => out.push(`<polyline points="${pts.map(([x, y]) => f(x) + ',' + f(y)).join(' ')}" fill="none" ${attrs(o)}/>`),
    path: (d, o) => out.push(`<path d="${d}" ${attrs(o)}/>`),
    circle: (cx, cy, r, o) => out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${attrs(o)}/>`),
    text: (x, y, s, o) => out.push(`<text x="${f(x)}" y="${f(y)}" ${attrs(Object.assign({ fontSize: 16, fill: COL.ink }, o))}>${esc(s)}</text>`),
    lines: (x, y, arr, o, lh = 24) => arr.forEach((s, i) => C.text(x, y + i * lh, s, o)),
    tag: (x, y, n, fill = COL.ink) => {
      C.circle(x, y, 10, { fill, stroke: '#fff', strokeWidth: 1.5 });
      C.text(x, y + 4.5, n, { fontSize: 12, fill: '#fff', textAnchor: 'middle', fontWeight: 'bold' });
    },
    title: (s, sub) => {
      C.text(40, 54, s, { fontSize: 30, fontWeight: 'bold' });
      if (sub) C.text(40, 88, sub, { fontSize: 17, fill: COL.sub });
    },
    svg: () => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
      `font-family="Microsoft YaHei, 'PingFang SC', sans-serif"><rect width="100%" height="100%" fill="${COL.bg}"/>\n` +
      out.join('\n') + '\n</svg>\n',
  };
  return C;
}

// 带箭头的线
export function arrow(C, x1, y1, x2, y2, o = {}) {
  const col = o.stroke || COL.ink, w = o.strokeWidth || 2, a = Math.atan2(y2 - y1, x2 - x1), L = o.head || 11;
  C.line(x1, y1, x2 - Math.cos(a) * L * 0.6, y2 - Math.sin(a) * L * 0.6, { stroke: col, strokeWidth: w, strokeDasharray: o.dash || null });
  const p = (d) => [x2 - Math.cos(a + d) * L, y2 - Math.sin(a + d) * L];
  C.poly([[x2, y2], p(0.42), p(-0.42)], { fill: col });
}

// 尺寸线：横的（y 处，x0→x1）或竖的（x 处，y0→y1），文字在中间
export function dimH(C, x0, x1, y, label, o = {}) {
  const col = o.color || COL.sub;
  C.line(x0, y, x1, y, { stroke: col, strokeWidth: 1.2 });
  for (const x of [x0, x1]) C.line(x, y - 6, x, y + 6, { stroke: col, strokeWidth: 1.2 });
  C.rect((x0 + x1) / 2 - textWidth(label, 15) / 2 - 4, y - 10, textWidth(label, 15) + 8, 20, { fill: COL.bg });
  C.text((x0 + x1) / 2, y + 5, label, { fontSize: 15, fill: col, textAnchor: 'middle' });
}
export function dimV(C, x, y0, y1, label, o = {}) {
  const col = o.color || COL.sub, side = o.side || 'left';
  C.line(x, y0, x, y1, { stroke: col, strokeWidth: 1.2 });
  for (const y of [y0, y1]) C.line(x - 6, y, x + 6, y, { stroke: col, strokeWidth: 1.2 });
  const tx = side === 'left' ? x - 8 : x + 8;
  C.text(tx, (y0 + y1) / 2 + 5, label, { fontSize: o.size || 15, fill: col, textAnchor: side === 'left' ? 'end' : 'start' });
}

// 带底色的小标签（压在窗、柱子上也看得清）。anchor：'middle'（默认）| 'start' | 'end'
export function label(C, x, y, s, o = {}) {
  const size = o.size || 14, w = textWidth(s, size) + 8, anchor = o.anchor || 'middle';
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w + 4 : x - 4;
  C.rect(x0, y - size - 1, w, size + 7, { fill: COL.bg, fillOpacity: 0.92, stroke: o.color || COL.sub, strokeWidth: 0.8, rx: 3 });
  C.text(x, y + 1, s, { fontSize: size, fill: o.color || COL.ink, textAnchor: anchor, fontWeight: o.bold ? 'bold' : null });
}

// 人：脚在 (x, yFeet)，身高 hp 像素。kind = 'girl'（她，粉色裙子）或 'player'（MC 玩家）
export function person(C, x, yFeet, hp, kind) {
  const girl = kind === 'girl', u = hp / 10, top = yFeet - hp, col = girl ? COL.girl : COL.player;
  C.circle(x, top + u, u, { fill: COL.skin, stroke: COL.ink, strokeWidth: 1 });
  if (girl) C.poly([[x - 0.9 * u, top + 2.1 * u], [x + 0.9 * u, top + 2.1 * u], [x + 1.8 * u, top + 6.6 * u], [x - 1.8 * u, top + 6.6 * u]], { fill: col, stroke: COL.ink, strokeWidth: 1 });
  else C.rect(x - 1.2 * u, top + 2.1 * u, 2.4 * u, 3.9 * u, { rx: 0.4 * u, fill: col, stroke: COL.ink, strokeWidth: 1 });
  const legTop = top + (girl ? 6.6 : 6.0) * u, legCol = girl ? COL.skin : COL.legs;
  C.rect(x - 0.9 * u, legTop, 0.7 * u, yFeet - legTop, { fill: legCol, stroke: COL.ink, strokeWidth: 0.6 });
  C.rect(x + 0.2 * u, legTop, 0.7 * u, yFeet - legTop, { fill: legCol, stroke: COL.ink, strokeWidth: 0.6 });
}

// 图例：items = [{ draw: (x, y) => …, text }]，一行 lh 像素
export function legend(C, x, y, items, lh = 28) {
  items.forEach((it, i) => {
    const yy = y + i * lh;
    if (it.draw) it.draw(x, yy - 12); else if (it.fill) C.rect(x, yy - 14, 22, 18, { fill: it.fill, stroke: it.stroke || COL.cut, strokeWidth: 1, strokeDasharray: it.dash || null });
    C.text(x + 32, yy, it.text, { fontSize: it.size || 16, fill: it.color || COL.ink });
  });
  return y + items.length * lh;
}
