// tools/girl/face-from-sheet.mjs — turn the AI-generated expression sheet into the face texture data.
//   node tools/girl/face-from-sheet.mjs [--sheet refs/face/girl-face-sheet.png] [--pu 6] [--colors 32]
// In:  refs/face/girl-face-sheet.png (gpt-image-2.5-sunburst, prompt refs/prompts/girl-face-sheet.txt): 4 x 3 bald heads,
//      cells 1-9 = neutral happy smile laugh pout sleepy talk surprised wink, 10 = half blink, 11 = eyes closed,
//      12 = mouth closed.
// Out: src/23-girl-face3-data.js (V3.girlFace3Data: palette + one index image per cell, read by src/23-girl-face3.js)
//      test/tmp-girl/face-data-preview.png (all cells, 4x).
// Mapping (measured on cell 1 with a pixel grid): the head's flat front is 260 px wide = the model's face plane (17 u),
// so K = 15.3 px per unit, face centre = head bbox x0 + 172. The face is shifted so the iris bottom (bbox y0 + 210)
// lands on y = 2.75 u like in refs/concept-girl.png; the generated proportions are kept 1:1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG } from './png.mjs';
import { encodePNG } from './glb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const SHEET = path.resolve(ROOT, arg('sheet', 'refs/face/girl-face-sheet.png'));
const PU = +arg('pu', 6), NCOL = +arg('colors', 32);
const RECT = { x0: -9, x1: 9, y0: 0, y1: 17 };
const W = (RECT.x1 - RECT.x0) * PU, H = (RECT.y1 - RECT.y0) * PU;
const K = 15.3, CX = 172, IRIS_Y = 210, IRIS_V = 2.75;
// the generated mouths sit right on the generated chin: the mouth block (|u| < 2.6, v < 3.4) is taken 1.4 u lower
// in the sheet, i.e. moved up on the face, so the open mouths fit above the model's chin
const MOUTH = { u: 2.6, v: 3.4, shift: 0.95 };
const CELLS = ['neutral', 'happy', 'smile', 'laugh', 'pout', 'sleepy', 'talk', 'surprised', 'wink', 'half', 'closed', 'mouthClosed'];

// once refs/face/face-edit.png exists (hand-edited faces), it is the source of the face data: do not overwrite
if (fs.existsSync(path.join(ROOT, 'refs/face/face-edit.png')) && !argv.includes('--force')) {
  console.error('refs/face/face-edit.png exists: the face data now comes from it (node tools/girl/face-edit.mjs import). ' +
    'Re-running this script would throw those hand edits away; pass --force if that is really wanted.');
  process.exit(1);
}
const img = decodePNG(fs.readFileSync(SHEET));
const at = (x, y) => { const i = (y * img.w + x) * 4; return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]; };
const bg = at(4, 4);
const isBg = (c) => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) < 30;

// head bounding box per cell (non-background pixels)
function headBox(k) {
  const cw = img.w / 4, chh = img.h / 3, X0 = Math.round((k % 4) * cw), Y0 = Math.round(Math.floor(k / 4) * chh);
  let a = [1e9, 1e9, -1, -1];
  for (let y = Y0; y < Math.round(Y0 + chh); y++) for (let x = X0; x < Math.round(X0 + cw); x++)
    if (!isBg(at(x, y))) a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)];
  return { x0: a[0], y0: a[1], x1: a[2], y1: a[3] };
}

// sample one cell into W x H texels (box filter, background pixels ignored -> null = fill with skin later)
function sampleCell(k) {
  const b = headBox(k), cx = b.x0 + CX, iy = b.y0 + IRIS_Y, half = K / PU / 2;
  const out = new Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = RECT.x0 + (i + 0.5) / PU, v = RECT.y1 - (j + 0.5) / PU;
    const inMouth = Math.abs(u) < MOUTH.u && v < MOUTH.v;
    const sx = cx + u * K, sy = iy - (v - IRIS_V) * K + (inMouth ? MOUTH.shift * K : 0);
    let r = 0, g = 0, bl = 0, n = 0;
    for (let y = Math.round(sy - half); y < Math.round(sy + half); y++) for (let x = Math.round(sx - half); x < Math.round(sx + half); x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const c = at(x, y); if (isBg(c)) continue;
      r += c[0]; g += c[1]; bl += c[2]; n++;
    }
    const c = n ? [r / n, g / n, bl / n] : null;
    // outside the generated head's flat front (its outline, side faces, jaw corners, crown): skin, except eye colours
    const au = Math.abs(u), edge = au > 8.2 || v > 12.6 || (v < 3.8 && au > 6.2 + 0.73 * v) || (inMouth && v < 0.35);
    out[j * W + i] = c && edge && !(c[2] > c[0] + 25) ? null : c;
  }
  return { box: b, px: out };
}
// k-means palette (deterministic k-means++ seeding), sRGB space
function kmeans(points, k, iters = 14) {
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const C = [points[Math.floor(rnd() * points.length)].slice()];
  const dist = points.map((p) => d2(p, C[0]));
  while (C.length < k) {
    let sum = 0; for (const d of dist) sum += d;
    let t = rnd() * sum, idx = 0;
    for (; idx < points.length - 1 && t > dist[idx]; idx++) t -= dist[idx];
    C.push(points[idx].slice());
    for (let i = 0; i < points.length; i++) dist[i] = Math.min(dist[i], d2(points[i], C[C.length - 1]));
  }
  const lab = new Uint8Array(points.length);
  for (let it = 0; it < iters; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < C.length; c++) { const d = d2(points[i], C[c]); if (d < bd) { bd = d; best = c; } }
      lab[i] = best; const a = acc[best]; a[0] += points[i][0]; a[1] += points[i][1]; a[2] += points[i][2]; a[3]++;
    }
    for (let c = 0; c < C.length; c++) if (acc[c][3]) C[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
  }
  return { centers: C.map((c) => c.map((v) => Math.round(v))), labels: lab };
}

const cells = CELLS.map((_, k) => sampleCell(k));
// skin = the most common colour of cell 1's centre column band (cheeks/forehead), used for background texels too
const all = [];
for (const c of cells) for (const p of c.px) if (p) all.push(p);
const { centers, labels } = kmeans(all, NCOL);
const count = new Array(centers.length).fill(0); for (const l of labels) count[l]++;
const skinIdx = count.indexOf(Math.max(...count));
const hex = (c) => (c[0] << 16) | (c[1] << 8) | c[2];
let li = 0;
const indexImgs = cells.map((c) => Uint8Array.from(c.px, (p) => (p ? labels[li++] : skinIdx)));
// feedback/raster regions in texel coords (x right, y down), from head-local units
const R = (u0, u1, v0, v1) => ({ x: Math.round((u0 - RECT.x0) * PU), y: Math.round((RECT.y1 - v1) * PU), w: Math.round((u1 - u0) * PU), h: Math.round((v1 - v0) * PU) });
const regions = {
  eyeR: R(-8.9, -1.4, 2.1, 9.7), eyeL: R(1.4, 8.9, 2.1, 9.7),          // eyeR = her right eye = viewer's left
  mouth: R(-MOUTH.u, MOUTH.u, 0, MOUTH.v), blushR: R(-8.4, -5.0, 1.0, 2.6), blushL: R(5.0, 8.4, 1.0, 2.6),
};
const data = {
  W, H, PU, rect: RECT, skin: hex(centers[skinIdx]), palette: centers.map(hex), cells: CELLS,
  img: indexImgs.map((a) => Buffer.from(a).toString('base64')), regions,
  source: 'refs/face/girl-face-sheet.png (gpt-image-2.5-sunburst, refs/prompts/girl-face-sheet.txt)',
};
const js = '// 23-girl-face3-data.js — GENERATED by tools/girl/face-from-sheet.mjs from refs/face/girl-face-sheet.png. Do not edit.\n' +
  '(function (V3) {\n  V3.girlFace3Data = ' + JSON.stringify(data) + ';\n})(window.V3);\n';
fs.writeFileSync(path.join(ROOT, 'src/23-girl-face3-data.js'), js);
// preview: 12 cells in a 4 x 3 grid at 4x
const S = 4, PW = W * S * 4 + 50, PH = H * S * 3 + 40, pv = new Uint8Array(PW * PH * 4).fill(200);
indexImgs.forEach((a, k) => {
  const ox = 10 + (k % 4) * (W * S + 10), oy = 10 + Math.floor(k / 4) * (H * S + 10);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = centers[a[j * W + i]];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) pv.set([c[0], c[1], c[2], 255], ((oy + j * S + y) * PW + ox + i * S + x) * 4);
  }
});
fs.mkdirSync(path.join(ROOT, 'test/tmp-girl'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'test/tmp-girl/face-data-preview.png'), encodePNG(PW, PH, pv));
console.log(`face data: ${W}x${H} @${PU}px/u, ${centers.length} colours, skin #${hex(centers[skinIdx]).toString(16)}, ` +
  `src/23-girl-face3-data.js ${(js.length / 1024).toFixed(0)} KB; boxes ${cells.map((c) => c.box.x0 + ',' + c.box.y0).join(' ')}`);
