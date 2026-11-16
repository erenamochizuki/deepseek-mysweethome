// tools/girl/face-edit.mjs — hand-editable face sheet <-> face texture data (src/23-girl-face3-data.js).
//   node tools/girl/face-edit.mjs export        writes refs/face/face-edit.png      (1 px = 1 texel, the file to edit)
//                                                       refs/face/face-edit-x4.png   (same, 4x larger, also editable)
//                                                       refs/face/face-edit-guide.png (4x, cell numbers, hair overlay; view only)
//   node tools/girl/face-edit.mjs guide         rewrites only refs/face/face-edit-guide.png (hair of the v4 head)
//   node tools/girl/face-edit.mjs import [file]  reads an edited sheet (1x or any integer scale, e.g. the x4 file),
//                                                writes src/23-girl-face3-data.js, and refreshes refs/face/face-edit.png
// Layout (1x): 4 columns x 3 rows of 108 x 102 cells, 4 px grey gutters and margin, same order as the generated sheet:
//   1 neutral 2 happy 3 smile 4 laugh / 5 pout 6 sleepy 7 talk 8 surprised / 9 wink 10 half-blink 11 eyes-closed 12 mouth-closed
// Keep the image size and the cell positions; anything painted in the gutters is ignored.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './glb.mjs';
import { decodePNG } from './png.mjs';
import { faceGuide4 } from './head4.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'src/23-girl-face3-data.js');
const EDIT = path.join(ROOT, 'refs/face/face-edit.png');
const G = 4, COLS = 4, ROWS = 3, GUTTER = [127, 127, 127];

function loadData() {
  const win = { V3: {} };
  vm.runInNewContext(fs.readFileSync(DATA, 'utf8'), { window: win });
  const D = win.V3.girlFace3Data;
  D.idx = D.img.map((b) => Uint8Array.from(Buffer.from(b, 'base64')));
  return D;
}
const layout = (D) => ({ SW: COLS * D.W + (COLS + 1) * G, SH: ROWS * D.H + (ROWS + 1) * G, ox: (k) => G + (k % COLS) * (D.W + G), oy: (k) => G + Math.floor(k / COLS) * (D.H + G) });
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

// render the cells into an RGBA sheet at scale s; overlay(k, i, j, c) may tint a texel
function sheet(D, s, overlay) {
  const L = layout(D), W = L.SW * s, H = L.SH * s, out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) out.set([...GUTTER, 255], i * 4);
  D.idx.forEach((a, k) => {
    for (let j = 0; j < D.H; j++) for (let i = 0; i < D.W; i++) {
      let c = rgb(D.palette[a[j * D.W + i]]);
      if (overlay) c = overlay(k, i, j, c);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) out.set([c[0], c[1], c[2], 255], (((L.oy(k) + j) * s + y) * W + (L.ox(k) + i) * s + x) * 4);
    }
  });
  return { W, H, out };
}
// 3x5 digits for the guide's cell numbers
const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
function digits(img, W, x0, y0, text, px, col) {
  [...text].forEach((ch, n) => {
    const d = DIG[+ch];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (d[r * 3 + c] === '1')
      for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) img.set([...col, 255], ((y0 + r * px + y) * W + x0 + (n * 4 + c) * px + x) * 4);
  });
}

function doExport() {
  const D = loadData();
  fs.mkdirSync(path.dirname(EDIT), { recursive: true });
  if (fs.existsSync(EDIT) && !process.argv.includes('--force')) {
    console.error('refs/face/face-edit.png already exists (maybe hand-edited). Import it first, or pass --force to overwrite.');
    process.exit(1);
  }
  const a = sheet(D, 1); fs.writeFileSync(EDIT, encodePNG(a.W, a.H, a.out));
  const b = sheet(D, 4); fs.writeFileSync(path.join(ROOT, 'refs/face/face-edit-x4.png'), encodePNG(b.W, b.H, b.out));
  writeGuide(D);
  console.log(`exported refs/face/face-edit.png ${a.W}x${a.H} (1 px = 1 texel), face-edit-x4.png ${b.W}x${b.H}, face-edit-guide.png`);
}
// guide: texels behind the v4 bangs tinted blue, outside the face plane darkened, cell numbers
function writeGuide(D) {
  const tint = (c, t, k) => c.map((v, n) => Math.round(v + (t[n] - v) * k));
  const g = sheet(D, 4, (k, i, j, c) => {
    const u = D.rect.x0 + (i + 0.5) / D.PU, v = D.rect.y1 - (j + 0.5) / D.PU;
    const gd = faceGuide4(u, v);
    return gd === 'out' ? tint(c, [40, 40, 40], 0.7) : gd === 'hair' ? tint(c, [48, 80, 176], 0.6) : c;
  });
  const L = layout(D);
  for (let k = 0; k < 12; k++) digits(g.out, g.W, (L.ox(k) + 2) * 4, (L.oy(k) + 2) * 4, String(k + 1), 4, [255, 230, 60]);
  fs.writeFileSync(path.join(ROOT, 'refs/face/face-edit-guide.png'), encodePNG(g.W, g.H, g.out));
}
// small k-means (only used when an edited sheet has more than 256 colours, e.g. after soft-brush painting)
function quantise(colors, k) {
  const keys = [...colors.keys()].sort((a, b) => colors.get(b) - colors.get(a));
  let C = keys.slice(0, k).map(rgb);
  const pts = keys.map(rgb), w = keys.map((h) => colors.get(h));
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const near = (p) => { let best = 0, bd = Infinity; C.forEach((c, n) => { const d = d2(p, c); if (d < bd) { bd = d; best = n; } }); return best; };
  for (let it = 0; it < 8; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    pts.forEach((p, n) => { const a = acc[near(p)]; a[0] += p[0] * w[n]; a[1] += p[1] * w[n]; a[2] += p[2] * w[n]; a[3] += w[n]; });
    C = C.map((c, n) => (acc[n][3] ? acc[n].slice(0, 3).map((v) => Math.round(v / acc[n][3])) : c));
  }
  const map = new Map(keys.map((h, n) => [h, near(pts[n])]));
  return { palette: C.map((c) => (c[0] << 16) | (c[1] << 8) | c[2]), map };
}

function doImport(file) {
  const D = loadData(), L = layout(D);
  const img = decodePNG(fs.readFileSync(file));
  const s = img.w / L.SW;
  if (!Number.isInteger(s) || s < 1 || img.h !== L.SH * s) {
    console.error(`${path.relative(ROOT, file)} is ${img.w}x${img.h}; expected ${L.SW}x${L.SH} or an integer multiple (keep the size, do not crop)`);
    process.exit(1);
  }
  const off = Math.floor(s / 2), freq = new Map(), cells = [];
  let changed = 0;
  const report = [];
  D.idx.forEach((old, k) => {
    const a = new Array(D.W * D.H);
    let ch = 0;
    for (let j = 0; j < D.H; j++) for (let i = 0; i < D.W; i++) {
      const p = (((L.oy(k) + j) * s + off) * img.w + (L.ox(k) + i) * s + off) * 4;
      const was = D.palette[old[j * D.W + i]];
      const h = img.rgba[p + 3] < 128 ? was : (img.rgba[p] << 16) | (img.rgba[p + 1] << 8) | img.rgba[p + 2];   // transparent = unchanged
      if (h !== was) ch++;
      a[j * D.W + i] = h; freq.set(h, (freq.get(h) || 0) + 1);
    }
    cells.push(a); changed += ch; report.push(`${k + 1}:${ch}`);
  });
  let palette, map;
  if (freq.size <= 256) { palette = [...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a)); map = new Map(palette.map((h, n) => [h, n])); }
  else ({ palette, map } = quantise(freq, 256));
  const out = { ...D };
  delete out.idx;
  out.palette = palette;
  out.img = cells.map((a) => Buffer.from(Uint8Array.from(a, (h) => map.get(h))).toString('base64'));
  out.skin = palette[map.get([...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a))[0])];
  out.source = (D.source || '').replace(/ \+ hand-edited.*$/, '') + ' + hand-edited ' + path.relative(ROOT, file).replace(/\\/g, '/');
  fs.writeFileSync(DATA, '// 23-girl-face3-data.js — GENERATED by tools/girl/face-edit.mjs import (from the AI sheet + hand edits). Do not edit.\n' +
    '(function (V3) {\n  V3.girlFace3Data = ' + JSON.stringify(out) + ';\n})(window.V3);\n');
  if (s !== 1) {           // keep the 1x edit file in step with what was imported
    const D2 = loadData(), a = sheet(D2, 1);
    fs.writeFileSync(EDIT, encodePNG(a.W, a.H, a.out));
  }
  console.log(`imported ${path.relative(ROOT, file)} (scale ${s}): ${changed} texels changed [${report.join(' ')}], ${palette.length} colours` +
    (freq.size > 256 ? ` (quantised from ${freq.size})` : '') + ' -> src/23-girl-face3-data.js');
}

const cmd = process.argv[2];
if (cmd === 'export') doExport();
else if (cmd === 'guide') { writeGuide(loadData()); console.log('wrote refs/face/face-edit-guide.png (v4 head)'); }
else if (cmd === 'import') doImport(path.resolve(ROOT, process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'refs/face/face-edit.png'));
else { console.error('usage: node tools/girl/face-edit.mjs export [--force] | import [refs/face/face-edit.png | refs/face/face-edit-x4.png]'); process.exit(2); }
