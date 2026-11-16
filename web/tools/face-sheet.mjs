// tools/face-sheet.mjs — contact sheet of every V3.girlFace expression -> shots/face/sheet.png
// node tools/face-sheet.mjs [--scale 6] [--cols 4] [--out shots/face/sheet.png]
// Each face is composited over skin #ffe1d9 with a navy bar over rows 0..8 (mimics the bangs).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const SCALE = +arg('scale', 6), COLS = +arg('cols', 4);
const OUT = path.resolve(ROOT, arg('out', 'shots/face/sheet.png'));

// ---- load the face module in a sandbox with a fake window ----
const win = { V3: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/21-girl-face.js'), 'utf8'), { window: win });
const F = win.V3.girlFace;

// ---- PNG writer (RGB 8-bit) ----
const CRC = new Int32Array(256).map((_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c;
});
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgb) {
  const stride = w * 3, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

// ---- drawing ----
const hex = (s) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
const SKIN = hex('#ffe1d9'), BANG = hex('#2a3f8f'), BG = hex('#d4d6db'), INK = hex('#30344a');
function fillRect(img, IW, x, y, w, h, c) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { const o = (j * IW + i) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; }
}
function drawFace(img, IW, ox, oy, rgba) {
  for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W; x++) {
    const i = (y * F.W + x) * 4, a = rgba[i + 3] / 255;
    let c = SKIN.map((s, k) => Math.round(rgba[i + k] * a + s * (1 - a)));
    if (y <= 8) c = BANG;
    fillRect(img, IW, ox + x * SCALE, oy + y * SCALE, SCALE, SCALE, c);
  }
}
// 3x5 font, each glyph = 5 octal rows (4=left 2=mid 1=right)
const FONT = { a:'25755', b:'65656', d:'65556', e:'74647', g:'34553', h:'55755', i:'72227', k:'55655', l:'44447',
  m:'57755', n:'65555', o:'75557', p:'65644', r:'65655', s:'34216', t:'72222', u:'55557', w:'55775', y:'55222',
  x:'55255', 1:'26227', 2:'61247', ' ':'00000' };
function text(img, IW, x, y, s, c, k = 2) {
  for (const ch of s) {
    const g = FONT[ch] || '00000';
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (+g[r] & (4 >> q)) fillRect(img, IW, x + q * k, y + r * k, k, k, c);
    x += 4 * k;
  }
}

// ---- cells: every expression (blink 0) + neutral blink 1/2 + talk mouth 1 ----
const cells = F.exprs.map(([id]) => ({ id, opt: {}, label: id }));
cells.splice(1, 0, { id: 'neutral', opt: { blink: 1 }, label: 'neutral b1' }, { id: 'neutral', opt: { blink: 2 }, label: 'neutral b2' });
cells.splice(cells.findIndex(c => c.id === 'talk') + 1, 0, { id: 'talk', opt: { mouth: 1 }, label: 'talk m1' });

const CW = F.W * SCALE, CH = F.H * SCALE, GAP = 16, LBL = 16;
const NR = Math.ceil(cells.length / COLS);
const IW = COLS * (CW + GAP) + GAP, IH = NR * (CH + LBL + GAP) + GAP;
const img = Buffer.alloc(IW * IH * 3);
fillRect(img, IW, 0, 0, IW, IH, BG);
cells.forEach((cell, n) => {
  const ox = GAP + (n % COLS) * (CW + GAP), oy = GAP + Math.floor(n / COLS) * (CH + LBL + GAP);
  const a = F.raster(cell.id, cell.opt);
  drawFace(img, IW, ox, oy + LBL, a);
  text(img, IW, ox, oy + 2, cell.label, INK);
  if (cell.id === 'wink') return;           // symmetry check (wink is asymmetric on purpose)
  let bad = 0;
  for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W / 2; x++) {
    const i = (y * F.W + x) * 4, j = (y * F.W + F.W - 1 - x) * 4;
    if (a[i] !== a[j] || a[i + 1] !== a[j + 1] || a[i + 2] !== a[j + 2] || a[i + 3] !== a[j + 3]) bad++;
  }
  if (bad) console.log('asym', cell.label, bad + 'px');
});
writePNG(OUT, IW, IH, img);
console.log('wrote', path.relative(ROOT, OUT), IW + 'x' + IH, cells.length + ' cells');
