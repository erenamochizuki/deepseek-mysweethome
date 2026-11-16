// tools/girl/tripo-measure.mjs — measuring the Tripo reference for the v4 head (dev tool; needs refs/models/tripo-ref.glb).
//   node tools/girl/tripo-measure.mjs face                      chin height + face plane depth (body frame) -> HEAD_FRAME
//   node tools/girl/tripo-measure.mjs view <front|back|left|right|top|bottom> [res] [x0,x1,y0,y1] [--png out.png] [--depth]
//        orthographic first-hit map in the head frame: class letters (H hair, L light blue, N navy, W white, S skin)
//        or, with --depth, the hit depth along the view axis rounded to 1 u (as base-36 digits relative to the min)
//   node tools/girl/tripo-measure.mjs slice <y> [res]           x-z section of the solid at height y (head frame), class letters
//   node tools/girl/tripo-measure.mjs column <x> <z0,z1> [res]  y-runs along a vertical line set (debug)
import fs from 'node:fs';
import { loadTripo, voxelize, classify, ortho, HEAD_FRAME } from './tripo.mjs';
import { encodePNG } from './glb.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (k) => argv.includes('--' + k);
const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['depth'].includes(argv[i - 1].slice(2))));

function printMap(m, [u0, u1, v0, v1], res, cell) {
  const lines = [];
  const head = '      ' + Array.from({ length: m.cols }, (_, c) => { const u = u0 + (c + 0.5) * res; return Math.abs(u - Math.round(u)) < res / 2 + 1e-9 && Math.round(u) % 2 === 0 ? String(Math.abs(Math.round(u)) % 10) : ' '; }).join('');
  lines.push(head);
  m.out.forEach((row, ri) => {
    const v = v0 + (m.rows - ri - 0.5) * res;
    lines.push(v.toFixed(1).padStart(5) + ' ' + row.map((h) => (h ? cell(h) : '.')).join(''));
  });
  return lines.join('\n');
}

const T = loadTripo({ frame: cmd === 'face' ? 'body' : 'head' });
if (cmd === 'face') {
  // skin hits of the front view around the face, in the body frame
  const box = [-12, 12, 30, 56], res = 0.25, m = ortho(T, 'front', res, box);
  const skin = [];
  m.out.forEach((row, ri) => row.forEach((h, c) => { if (h && h.cls === 'S') skin.push({ x: box[0] + (c + 0.5) * res, y: box[2] + (m.rows - ri - 0.5) * res, z: h.depth, n: h.n }); }));
  const flat = skin.filter((s) => s.n[2] > 0.95 && Math.abs(s.x) < 6);
  const zs = flat.map((s) => s.z).sort((a, b) => a - b);
  const faceZ = zs[Math.floor(zs.length / 2)];
  const face = skin.filter((s) => Math.abs(s.z - faceZ) < 0.6);
  const ys = face.map((s) => s.y).sort((a, b) => a - b), xs = face.map((s) => s.x).sort((a, b) => a - b);
  console.log('skin hits', skin.length, 'on the face plane', face.length);
  console.log('face plane z (body frame) median', faceZ.toFixed(3), 'p10/p90', zs[Math.floor(zs.length * 0.1)].toFixed(2), zs[Math.floor(zs.length * 0.9)].toFixed(2));
  console.log('face x range', xs[0].toFixed(2), xs[xs.length - 1].toFixed(2), ' y range (chin = min)', ys[0].toFixed(2), ys[ys.length - 1].toFixed(2));
  console.log('current HEAD_FRAME', JSON.stringify(HEAD_FRAME));
  console.log('bones (body frame)', Object.entries(T.bones).filter(([k]) => /Head|Neck|Spine2|Shoulder/.test(k)).map(([k, v]) => k + ' ' + v.map((x) => x.toFixed(2)).join(',')).join(' | '));
} else if (cmd === 'view') {
  const view = pos[1], res = +(pos[2] || 0.5), box = (pos[3] || '-24,24,-28,28').split(',').map(Number);
  const m = ortho(T, view, res, box);
  if (flag('depth')) {
    let mn = Infinity; m.out.forEach((r) => r.forEach((h) => { if (h) mn = Math.min(mn, h.depth); }));
    console.log(`${view} depth map: digit = round(depth - ${mn.toFixed(2)}) in base 36 (depth = coordinate along the view axis towards the viewer)`);
    console.log(printMap(m, box, res, (h) => Math.max(0, Math.min(35, Math.round(h.depth - mn))).toString(36)));
  } else console.log(`${view} class map (H hair, L light blue, N navy, W white, S skin), res ${res}\n` + printMap(m, box, res, (h) => h.cls));
  const png = opt('png');
  if (png) {
    const s = Math.max(1, Math.round(4 / res)), W = m.cols * s, H = m.rows * s, rgba = new Uint8Array(W * H * 4);
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      const h = m.out[r][c], col = h ? h.rgb : [200, 204, 210];
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const o = ((r * s + y) * W + c * s + x) * 4;
        const u = box[0] + (c + (x + 0.5) / s) * res, v = box[3] - (r + (y + 0.5) / s) * res;
        const grid = (Math.abs(u - Math.round(u)) < 0.5 / s * res && Math.round(u) % 2 === 0) || (Math.abs(v - Math.round(v)) < 0.5 / s * res && Math.round(v) % 2 === 0);
        const axis = Math.abs(u) < res / s || Math.abs(v) < res / s;
        rgba.set(axis ? [255, 60, 60, 255] : grid ? [col[0] * 0.75, col[1] * 0.75, col[2] * 0.75, 255] : [...col, 255], o);
      }
    }
    fs.writeFileSync(png, encodePNG(W, H, rgba));
    console.log('png', png, W + 'x' + H, '(grid every 2 u, red = axes)');
  }
} else if (cmd === 'slice') {
  const y = +pos[1], res = +(pos[2] || 0.5);
  const V = voxelize(T, { lo: [-26, y - res / 2, -26], hi: [26, y + res / 2, 16], res });
  const j = 0, lines = [];
  for (let k = V.N[2] - 1; k >= 0; k--) {
    let s = (V.g0[2] + (k + 0.5) * res).toFixed(1).padStart(6) + ' ';
    for (let i = 0; i < V.N[0]; i++) {
      if (!V.at(i, j, k)) { s += '.'; continue; }
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([di, dk]) => !V.at(i + di, j, k + dk));
      if (!open) { s += '#'; continue; }
      const c = V.colorAt(V.center(i, j, k), [open[0], 0, open[1]]);
      s += c ? classify(c.rgb) : '?';
    }
    lines.push(s);
  }
  console.log(`slice y=${y} (head frame), x from ${V.g0[0]} step ${res}; rows = z (front at top); # = inside`);
  console.log(lines.join('\n'));
} else {
  console.log('usage: see the header of tools/girl/tripo-measure.mjs');
}
