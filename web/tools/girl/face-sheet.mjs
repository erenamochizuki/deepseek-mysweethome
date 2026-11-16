// tools/girl/face-sheet.mjs — contact sheet of V3.girlFace3 (src/23-girl-face3.js), no browser needed.
// node tools/girl/face-sheet.mjs [--scale 8] [--out test/tmp-girl/face-sheet.png]
// Row 1: the 9 expressions. Row 2: happy blink 1/2, talk mouth 1, look left/right. A navy band over the top
// rows mimics the bangs so the visible part reads like the model.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './glb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const SC = +arg('scale', 8), OUT = path.resolve(ROOT, arg('out', 'test/tmp-girl/face-sheet.png'));

export function loadFace() {
  const win = { V3: {} };
  const ctx = vm.createContext({ window: win, atob });
  const data = path.join(ROOT, 'src/23-girl-face3-data.js');
  if (fs.existsSync(data)) vm.runInContext(fs.readFileSync(data, 'utf8'), ctx);
  const meta = path.join(ROOT, 'src/23-girl-face3-meta.js');
  if (fs.existsSync(meta)) vm.runInContext(fs.readFileSync(meta, 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/23-girl-face3.js'), 'utf8'), ctx);
  return win.V3.girlFace3;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const F = loadFace();
  const cells = F.exprs.map(([id]) => [id, {}]);
  cells.push(['happy', { blink: 1 }], ['happy', { blink: 2 }], ['talk', { mouth: 1 }], ['happy', { lookX: -1 }], ['happy', { lookX: 1 }]);
  const COLS = 9, pad = 6, cw = F.W * SC + pad, ch = F.H * SC + pad, rows = Math.ceil(cells.length / COLS);
  const SW = COLS * cw + pad, SH = rows * ch + pad, out = new Uint8ClampedArray(SW * SH * 4).fill(200);
  cells.forEach(([id, o], k) => {
    const px = F.raster(id, o), ox = pad + (k % COLS) * cw, oy = pad + Math.floor(k / COLS) * ch;
    for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W; x++) {
      const i = (y * F.W + x) * 4, band = y < 25 && !(y > 18 && Math.abs(x - 26.5) < 5);   // fake bangs
      const c = band ? [62, 88, 171, 255] : [px[i], px[i + 1], px[i + 2], 255];
      for (let sy = 0; sy < SC; sy++) for (let sx = 0; sx < SC; sx++) out.set(c, ((oy + y * SC + sy) * SW + ox + x * SC + sx) * 4);
    }
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, encodePNG(SW, SH, out));
  console.log('wrote', path.relative(ROOT, OUT), SW + 'x' + SH);
}
