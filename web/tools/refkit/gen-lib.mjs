// tools/refkit/gen-lib.mjs — tiny SVG helpers for agent drafts (plans, sheets); render the .svg with tools/refkit/draw.mjs.
// Each generator builds one 1600×1000 sheet, then save() writes <name>.svg and <name>.boxes.json
// (box rects normalised to 0..1 for refkit questions.json).
import fs from 'node:fs';
const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const attrs = (o) => Object.entries(o || {}).map(([k, v]) => `${kebab(k)}="${v}"`).join(' ');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (v) => +(+v).toFixed(1);
export const INK = '#24324a', SUB = '#5a6478';
export function sheet(W = 1600, H = 1000) {
  const out = [], boxes = {};
  const S = {
    W, H, boxes,
    raw: (s) => out.push(s),
    rect: (x, y, w, h, o) => out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${attrs(o)}/>`),
    line: (x1, y1, x2, y2, o) => out.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${attrs(o)}/>`),
    poly: (pts, o) => out.push(`<polygon points="${pts.map(([x, y]) => f(x) + ',' + f(y)).join(' ')}" ${attrs(o)}/>`),
    pline: (pts, o) => out.push(`<polyline points="${pts.map(([x, y]) => f(x) + ',' + f(y)).join(' ')}" fill="none" ${attrs(o)}/>`),
    path: (d, o) => out.push(`<path d="${d}" ${attrs(o)}/>`),
    circle: (cx, cy, r, o) => out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${attrs(o)}/>`),
    ellipse: (cx, cy, rx, ry, o) => out.push(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" ${attrs(o)}/>`),
    text: (x, y, s, o) => out.push(`<text x="${f(x)}" y="${f(y)}" ${attrs(Object.assign({ fontSize: 15, fill: INK }, o))}>${esc(s)}</text>`),
    lines: (x, y, arr, o, lh = 24) => arr.forEach((s, i) => S.text(x, y + i * lh, s, o)),
    tag: (x, y, n) => {
      S.circle(x, y, 11, { fill: INK, stroke: '#fff', strokeWidth: 1.5 });
      S.text(x, y + 4.5, n, { fontSize: 12, fill: '#fff', textAnchor: 'middle', fontWeight: 'bold' });
    },
    box: (id, x, y, w, h) => {
      const c = (v) => +Math.min(1, Math.max(0, v)).toFixed(4);
      boxes[id] = { x: c(x / W), y: c(y / H), w: c(w / W), h: c(h / H) };
    },
    save: (base) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
        `font-family="Microsoft YaHei, 'PingFang SC', sans-serif"><rect width="100%" height="100%" fill="#fbf8f1"/>\n` +
        out.join('\n') + '\n</svg>\n';
      fs.writeFileSync(base + '.svg', svg);
      fs.writeFileSync(base + '.boxes.json', JSON.stringify(boxes, null, 1));
      console.log('wrote', base + '.svg', Object.keys(boxes).length, 'boxes');
    },
  };
  return S;
}
