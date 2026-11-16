#!/usr/bin/env node
// tools/montage.mjs — tile screenshots into one numbered contact sheet (ffmpeg).
//
//   node tools/montage.mjs <out.jpg> <tileW> <tileH> <cols> <img|dir> [img|dir …]
//   e.g. node tools/montage.mjs shots/girl-sheet.jpg 640 400 3 shots/girl
//
// Each tile is scaled to fit tileW x tileH (letterboxed in black) and labelled 1, 2, 3… in yellow; the
// number -> file legend is printed. A directory expands to its images in the order they were written
// (oldest first, i.e. shoot.mjs view order); the output file itself is never an input.
// Paths are resolved against the project root first, then the current directory. Needs ffmpeg on PATH.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node tools/montage.mjs <out.jpg> <tileW> <tileH> <cols> <img|dir> [img|dir …]';
const die = (msg, code = 1) => { console.error(`montage: ${msg}`); process.exit(code); };
const rel = (p) => { const r = path.relative(ROOT, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : p; };
const IMG = /\.(png|jpe?g|webp|bmp)$/i;

const [outArg, ...rest] = process.argv.slice(2);
if (outArg === '--help' || outArg === '-h') { console.log(USAGE); process.exit(0); }
if (!outArg || rest.length < 4) die(USAGE, 2);
const [W, H, C] = rest.slice(0, 3).map(Number);
if (![W, H, C].every((n) => Number.isInteger(n) && n > 0)) die(`tileW, tileH and cols must be positive integers\n${USAGE}`, 2);
const out = path.resolve(ROOT, outArg);
if (!IMG.test(out)) die('output must end in .jpg, .png, .webp or .bmp', 2);

const find = (p) => [path.resolve(ROOT, p), path.resolve(p)].find((x) => fs.existsSync(x));
const files = [];
for (const a of rest.slice(3)) {
  const p = find(a);
  if (!p) die(`not found: ${a}`);
  if (fs.statSync(p).isDirectory()) {
    const list = fs.readdirSync(p).filter((f) => IMG.test(f)).map((f) => path.join(p, f)).filter((f) => f !== out)
      .map((f) => [f, fs.statSync(f).mtimeMs]).sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1)).map((x) => x[0]);
    if (!list.length) die(`no images in ${a}`);
    files.push(...list);
  } else files.push(p);
}

// drawtext needs a font file; ':' must be escaped inside the filter graph
const winDir = process.env.WINDIR || process.env.SystemRoot || '';
const fontPath = winDir ? path.join(winDir, 'Fonts', 'arial.ttf') : '';
const font = fontPath && fs.existsSync(fontPath) ? fontPath.replace(/\\/g, '/').replace(/:/g, '\\:') : null;
const n = files.length, rows = Math.ceil(n / C);
const label = (i) => (font ? `,drawtext=fontfile='${font}':text='${i + 1}':x=12:y=8:fontsize=${Math.max(12, Math.round(H / 9))}` +
  ':fontcolor=yellow:box=1:boxcolor=black@0.65:boxborderw=6' : '');
const tiles = files.map((_, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black${label(i)}[t${i}]`);
const layout = files.map((_, i) => `${(i % C) * W}_${Math.floor(i / C) * H}`).join('|');
const graph = `${tiles.join(';')};${files.map((_, i) => `[t${i}]`).join('')}${n > 1 ? `xstack=inputs=${n}:layout=${layout}:fill=black` : 'null'}[o]`;
const args = ['-hide_banner', '-loglevel', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', graph,
  '-map', '[o]', '-frames:v', '1', '-update', '1', ...(/\.jpe?g$/i.test(out) ? ['-q:v', '3'] : []), out];

fs.mkdirSync(path.dirname(out), { recursive: true });
const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
if (r.error) die(r.error.code === 'ENOENT' ? 'ffmpeg not found on PATH' : r.error.message);
if (r.status !== 0) die(`ffmpeg failed (exit ${r.status}):\n${(r.stderr || '').trim()}`);
files.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}  ${rel(f)}`));
console.log(`wrote ${rel(out)}  ${Math.min(n, C) * W}x${rows * H}  (${n} tiles, ${C} cols${font ? '' : ', no labels: arial.ttf not found'})`);
