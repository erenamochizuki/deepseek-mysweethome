#!/usr/bin/env node
// tools/refkit/draw.mjs — render an SVG or HTML file to PNG with headless Edge/Chrome. For agent drafts
// such as top-down layout plans and comparison boards, which then go into refs/<project>/drafts/.
// The PNG gets the SVG's own width/height attributes unless --w/--h are given (HTML defaults to 1600x1000).
// Usage: node tools/refkit/draw.mjs <in.svg|in.html> <out.png> [--w 1600 --h 1000]   (paths relative to the v3 root)
// Browser: TOOLKIT_BROWSER=<exe> if set, else Edge (then Chrome) from the standard install folders.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
const wOpt = +opt('w') || 0, hOpt = +opt('h') || 0;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!argv[0] || !argv[1]) { console.error('usage: node tools/refkit/draw.mjs <in.svg|in.html> <out.png> [--w N --h N]'); process.exit(2); }
const [src, out] = argv.slice(0, 2).map((p) => path.resolve(ROOT, p));

const text = fs.readFileSync(src, 'utf8');
const tag = (/<svg\b[^>]*>/.exec(text) || [''])[0];
const num = (k) => +((new RegExp('\\s' + k + '="(\\d+(?:\\.\\d+)?)"').exec(tag) || [])[1] || 0);
const W = Math.round(wOpt || num('width') || 1600), H = Math.round(hOpt || num('height') || 1000);

const edge = (dir) => dir && path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const chrome = (dir) => dir && path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe');
const BROWSERS = [process.env.TOOLKIT_BROWSER, edge(process.env['ProgramFiles(x86)']), edge(process.env.ProgramFiles),
  chrome(process.env.ProgramFiles), chrome(process.env['ProgramFiles(x86)']), chrome(process.env.LOCALAPPDATA), '/usr/bin/google-chrome', '/usr/bin/chromium'];
const exe = BROWSERS.find((p) => p && fs.existsSync(p));
if (!exe) { console.error('no Edge or Chrome found'); process.exit(1); }

const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(src).href, { waitUntil: 'load' });
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } });
  if (errors.length) console.error('page errors:\n  ' + errors.join('\n  '));
  console.log(`wrote ${path.relative(ROOT, out).split(path.sep).join('/')}  ${W}x${H}`);
} finally {
  await browser.close();
}
