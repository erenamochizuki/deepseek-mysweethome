#!/usr/bin/env node
// tools/shoot.mjs — headless Edge screenshots of a v3 page through its test hooks (SPEC "Test hooks").
//
//   node tools/shoot.mjs --page studio --views "front,side+expr=smile" --out shots/x
//        [--w 1280] [--h 800] [--wait 1500] [--gpu auto|d3d11|swiftshader|gl|egl] [--timeout 60]
//        [--url http://127.0.0.1:5194/studio.html | --file test/tmp-shoot/page.html]
//
// Opens dist/<page>.html via file:// (or --url / --file), waits for window.__READY (--timeout s), then for
// each view: await window.__view(view), waits --wait ms + 2 frames, saves <out>/<view, unsafe chars -> _>.png.
// --out is resolved against the project root (absolute paths work too); default shots/<page>.
// Prints live console errors/warnings, page errors and failed requests, then window.__errors, and ends with
// `RESULT: OK <n> shots` or `RESULT: FAIL <reason>` (exit 0 / 1; bad arguments exit 2).
// --gpu auto (default) tries d3d11 -> swiftshader -> gl -> swiftshader-legacy -> egl and keeps the first
// backend that has WebGL and renders a non-black frame; a page that fails while WebGL works is not retried.
// Browser: TOOLKIT_BROWSER=<exe> if set, else Microsoft Edge from its standard install folders.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const USAGE = `usage: node tools/shoot.mjs --page <name> | --url <http-url> | --file <html>
  --views "front,side+expr=smile"   comma-separated views (default front)
  --out <dir>        output folder, relative to the project root (default shots/<page>)
  --w 1280 --h 800   viewport size
  --wait 1500        ms to wait after each __view before the screenshot
  --gpu auto         auto | d3d11 | swiftshader | gl | swiftshader-legacy | egl
  --timeout 60       seconds to wait for __READY and for each __view`;

class Fail extends Error {}
const say = (s) => console.log(s);
const firstLine = (e) => String((e && e.message) || e).split('\n')[0];
function bad(msg) { console.error(`shoot: ${msg}\n${USAGE}`); process.exit(2); }

function parseArgs(argv) {
  const o = { page: null, url: null, file: null, views: 'front', out: null, w: 1280, h: 800, wait: 1500, gpu: 'auto', timeout: 60 };
  const MIN = { w: 16, h: 16, wait: 0, timeout: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    const m = /^--([a-z]+)(?:=(.*))?$/s.exec(a);
    if (!m || !Object.hasOwn(o, m[1])) bad(`unknown argument: ${a}`);
    const v = m[2] !== undefined ? m[2] : argv[++i];
    if (v === undefined) bad(`${a} needs a value`);
    if (Object.hasOwn(MIN, m[1])) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < MIN[m[1]]) bad(`${a} must be a number >= ${MIN[m[1]]}`);
      o[m[1]] = Math.round(n);
    } else o[m[1]] = v;
  }
  if (o.url && o.file) bad('give either --url or --file, not both');
  if (!o.url && !o.file && !o.page) bad('give --page <name>, --url <url> or --file <html>');
  if (o.page !== null && !/^[\w.-]+$/.test(o.page)) bad(`bad --page name: ${o.page}`);
  o.gpu = o.gpu === 'gl' ? 'angle-gl' : o.gpu;
  if (o.gpu !== 'auto' && !GPU_COMBOS[o.gpu]) bad(`unknown --gpu ${o.gpu}`);
  o.views = o.views.split(',').map((s) => s.trim()).filter(Boolean);
  if (!o.views.length) bad('--views is empty');
  if (o.url) {
    let u = null;
    try { u = new URL(o.url); } catch { /* reported below */ }
    if (!u || !/^https?:$/.test(u.protocol)) bad('--url must be an http:// or https:// URL');
    o.target = o.url;
    o.name = o.page || path.posix.basename(u.pathname, '.html') || 'page';
  } else {
    const file = o.file ? path.resolve(ROOT, o.file) : path.join(ROOT, 'dist', `${o.page}.html`);
    if (!fs.existsSync(file)) {
      throw new Fail(`${rel(file)} not found${o.file ? '' : ` (run: node build.mjs ${o.page})`}`);
    }
    o.target = pathToFileURL(file).href;
    o.name = o.page || path.basename(file, path.extname(file));
  }
  o.outDir = path.resolve(ROOT, o.out || path.join('shots', o.name));
  return o;
}

// Browser discovery: TOOLKIT_BROWSER first, then Edge x86 / x64 (from the environment, then the standard paths).
const EDGE_X86 = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EDGE_X64 = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
function findBrowser() {
  const edge = (dir) => dir && path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const env = process.env.TOOLKIT_BROWSER;
  if (env && !fs.existsSync(env)) say(`[browser] TOOLKIT_BROWSER does not exist, ignored: ${env}`);
  const cands = [['TOOLKIT_BROWSER', env], ['Edge (x86)', edge(process.env['ProgramFiles(x86)'])],
    ['Edge (x64)', edge(process.env.ProgramFiles)], ['Edge (x86)', EDGE_X86], ['Edge (x64)', EDGE_X64]];
  for (const [label, exe] of cands) if (exe && fs.existsSync(exe)) return { label, exe };
  return null;
}

// GPU backends (Chromium flags). auto tries AUTO_ORDER; d3d11 is the fast, faithful choice on Windows with a GPU.
const GPU_COMBOS = {
  d3d11: ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  'angle-gl': ['--use-gl=angle', '--use-angle=gl'],
  'swiftshader-legacy': ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  egl: ['--use-gl=egl', '--ignore-gpu-blocklist'],
};
const AUTO_ORDER = ['d3d11', 'swiftshader', 'angle-gl', 'swiftshader-legacy', 'egl'];
const BASE_ARGS = ['--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio'];

const rel = (p) => {
  const r = path.relative(ROOT, p);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : p;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Minimal PNG decoder (8-bit gray/RGB/RGBA, non-interlaced) -> mean luminance and non-black fraction.
function pngStats(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, inter = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; inter = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (depth !== 8 || !ch || inter !== 0 || !w || !h) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const stride = w * ch;
  if (raw.length < h * (stride + 1)) return null;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= ch ? px[dst + x - ch] : 0, b = y > 0 ? px[up + x] : 0, c = x >= ch && y > 0 ? px[up + x - ch] : 0;
      let p;
      if (f === 0) p = 0;
      else if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[dst + x] = (v + p) & 255;
    }
  }
  let sum = 0, lit = 0, min = 255, max = 0;
  for (let i = 0; i < px.length; i += ch) {
    const l = ch >= 3 ? 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] : px[i];
    sum += l; if (l > 10) lit++; if (l < min) min = l; if (l > max) max = l;
  }
  const n = w * h;
  return { width: w, height: h, mean: sum / n, nonBlack: lit / n, min: Math.round(min), max: Math.round(max) };
}
const isBlack = (s) => !s || s.mean <= 5;

// view string -> file name: unsafe characters become _, Windows device names get a leading _, duplicates get -2, -3…
function fileNames(views) {
  const seen = new Set();
  return views.map((v) => {
    let s = v.replace(/[\\/:*?"<>|\s\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'view';
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
    let name = s;
    for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${s}-${k}`;
    seen.add(name.toLowerCase());
    return `${name}.png`;
  });
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Fail(`${what} timed out after ${ms / 1000} s`)), ms); })])
    .finally(() => clearTimeout(t));
}

// WebGL renderer string, or null when this backend has no WebGL.
const PROBE_GL = () => {
  const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return null;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const lose = gl.getExtension('WEBGL_lose_context');
  if (lose) lose.loseContext();
  return r;
};
const TWO_FRAMES = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
const READ_ERRORS = () => {
  if (!Array.isArray(window.__errors)) return null;
  return window.__errors.map((e) => {
    if (e && typeof e === 'object') {
      if (e.message) return String(e.message);
      try { return JSON.stringify(e); } catch { return String(e); }
    }
    return String(e);
  });
};
function printErrors(errs) {
  if (errs === null) say('[__errors] window.__errors is not an array');
  else if (!errs.length) say('[__errors] none');
  else {
    say(`[__errors] ${errs.length}:`);
    for (const e of errs.slice(0, 20)) say(`  ${e}`);
    if (errs.length > 20) say(`  … ${errs.length - 20} more`);
  }
}

// One browser run with one GPU backend -> { status: 'ok' | 'black' | 'no-webgl', … }. Page problems throw Fail.
async function shootOnce(puppeteer, exe, gpu, o) {
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: [...BASE_ARGS, ...GPU_COMBOS[gpu]],
    defaultViewport: { width: o.w, height: o.h, deviceScaleFactor: 1 }, protocolTimeout: 120000 });
  const log = { console: 0, pageErrors: [], requests: 0 };
  let page = null;
  try {
    page = await browser.newPage();
    page.on('console', (m) => {
      const t = m.type();
      if (t !== 'error' && t !== 'warn' && t !== 'warning') return;
      const loc = m.location(), at = loc && loc.url && /^Failed to load resource/.test(m.text()) ? `  ${loc.url}` : '';
      if (++log.console <= 30) say(`  [console.${t === 'error' ? 'error' : 'warn'}] ${m.text()}${at}`);
    });
    page.on('pageerror', (e) => { log.pageErrors.push(firstLine(e)); say(`  [pageerror] ${firstLine(e)}`); });
    page.on('requestfailed', (r) => { log.requests++; say(`  [requestfailed] ${r.url()}  ${(r.failure() || {}).errorText || ''}`); });
    page.on('response', (r) => {
      if (r.status() >= 400 && !/\/favicon\.ico$/i.test(r.url())) { log.requests++; say(`  [http ${r.status()}] ${r.url()}`); }
    });
    try { await page.goto(o.target, { waitUntil: 'load', timeout: o.timeout * 1000 }); }
    catch (e) { throw new Fail(`cannot open ${o.target}: ${firstLine(e)}`); }
    const renderer = await page.evaluate(PROBE_GL);
    if (!renderer) { say(`[gpu] ${gpu}: no WebGL`); return { status: 'no-webgl' }; }
    say(`[gpu] ${gpu}: ${renderer}`);
    try {
      const t0 = Date.now();
      for (let errAt = 0; ;) {
        const st = await page.evaluate(() => ({ ready: window.__READY === true, errs: Array.isArray(window.__errors) ? window.__errors.length : 0 }));
        if (st.ready) break;
        if (!errAt && (st.errs || log.pageErrors.length)) errAt = Date.now();
        if (errAt && Date.now() - errAt > 5000) {
          const first = log.pageErrors[0] || ((await page.evaluate(READ_ERRORS)) || [])[0] || '?';
          throw new Fail(`page error and no __READY: ${first}`);
        }
        if (Date.now() - t0 > o.timeout * 1000) throw new Fail(`window.__READY not true after ${o.timeout} s`);
        await sleep(100);
      }
      say(`[ready] ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      if (!(await page.evaluate(() => typeof window.__view === 'function'))) throw new Fail('window.__view is not a function');
      fs.mkdirSync(o.outDir, { recursive: true });
      const names = fileNames(o.views), shots = [], viewFails = [];
      for (let i = 0; i < o.views.length; i++) {
        const v = o.views[i], file = path.join(o.outDir, names[i]);
        try {
          await withTimeout(page.evaluate(async (s) => { await window.__view(s); return true; }, v), o.timeout * 1000, `__view("${v}")`);
        } catch (e) {
          viewFails.push(`${v}: ${firstLine(e)}`);
          say(`  [view] ${v}  FAILED: ${firstLine(e)}`);
          continue;
        }
        await sleep(o.wait);
        await withTimeout(page.evaluate(TWO_FRAMES), 10000, 'two frames').catch(() => {});
        const buf = Buffer.from(await page.screenshot({ type: 'png' }));
        fs.writeFileSync(file, buf);
        const s = pngStats(buf);
        shots.push({ view: v, file, stats: s });
        const info = s ? `${s.width}x${s.height}  mean ${s.mean.toFixed(1)}  lit ${(s.nonBlack * 100).toFixed(0)}%` : 'no stats';
        say(`  [shot] ${v}  ->  ${rel(file)}  ${info}${isBlack(s) ? '  BLACK' : ''}`);
      }
      const errs = await page.evaluate(READ_ERRORS);
      const black = shots.length > 0 && shots.every((x) => isBlack(x.stats));
      return { status: black ? 'black' : 'ok', renderer, shots, viewFails, errs, log };
    } catch (e) {
      if (e instanceof Fail) printErrors(await page.evaluate(READ_ERRORS).catch(() => null));
      throw e;
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
function report(r, o, tried) {
  printErrors(r.errs);
  const notes = [];
  if (r.log.console) notes.push(`${r.log.console} console errors/warnings`);
  if (r.log.pageErrors.length) notes.push(`${r.log.pageErrors.length} page errors`);
  if (r.log.requests) notes.push(`${r.log.requests} failed requests`);
  if (r.errs && r.errs.length) notes.push(`${r.errs.length} __errors`);
  const blackN = r.shots.filter((x) => isBlack(x.stats)).length;
  if (blackN) notes.push(`${blackN} black`);
  if (r.viewFails.length) throw new Fail(`${r.viewFails.length} of ${o.views.length} views failed: ${r.viewFails.join(' | ')}`);
  if (r.status === 'black') throw new Fail(`all ${r.shots.length} shots are black (${tried.join(' | ')})`);
  say(`RESULT: OK ${r.shots.length} shots${notes.length ? `  (${notes.join(', ')})` : ''}`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { throw new Fail('puppeteer-core not found (node_modules missing?)'); }
  const b = findBrowser();
  if (!b) throw new Fail('Microsoft Edge not found; install it or set TOOLKIT_BROWSER=<path to msedge.exe>');
  say(`shoot  ${o.target}`);
  say(`  views ${o.views.join(', ')}  ->  ${rel(o.outDir)}  (${o.w}x${o.h}, wait ${o.wait} ms, gpu ${o.gpu})`);
  say(`[browser] ${b.label}: ${b.exe}`);
  const order = o.gpu === 'auto' ? AUTO_ORDER : [o.gpu], tried = [];
  let r = null;
  for (let i = 0; i < order.length; i++) {
    const gpu = order[i], last = i === order.length - 1;
    try { r = await shootOnce(puppeteer, b.exe, gpu, o); }
    catch (e) {
      if (e instanceof Fail) throw e;
      tried.push(`${gpu}: ${firstLine(e)}`);
      if (last) throw new Fail(`browser failed: ${tried.join(' | ')}`);
      say(`[gpu] ${gpu}: browser failed (${firstLine(e)}), trying next backend`);
      r = null;
      continue;
    }
    if (r.status === 'ok') break;
    tried.push(`${gpu}: ${r.status}`);
    if (!last) say(`[gpu] ${gpu}: ${r.status === 'black' ? 'all shots black' : 'no WebGL'}, trying next backend`);
  }
  if (!r || r.status === 'no-webgl') throw new Fail(`no usable WebGL backend (${tried.join(' | ')})`);
  report(r, o, tried);
}

main().then(() => process.exit(0), (e) => {
  say(`RESULT: FAIL ${e instanceof Fail ? e.message : firstLine(e)}`);
  if (!(e instanceof Fail)) console.error(e && e.stack);
  process.exit(1);
});
