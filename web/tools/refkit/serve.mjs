#!/usr/bin/env node
// tools/refkit/serve.mjs — 只开一个标注项目（不开工作台时用）。平时不用它：v3 的 serve.mjs 已经带了 2D 反馈，
// 工作台左上角切到「2D 反馈」就行。
//   node tools/refkit/serve.mjs --dir refs/<项目> [--port 5178]
// --dir is resolved against the v3 root and created when missing (images/ drafts/ exports/). Same page and API as
// serve.mjs (tools/refkit/server.mjs), limited to this one project; / redirects to /2d/?p=<项目>.
// Listens on 127.0.0.1 only, answers only Host 127.0.0.1/localhost, refuses writes from other origins.
// A busy port moves on to the next one (20 tries); --port 0 picks any free port. The address is printed as
// `refkit: <url>  dir=<dir>` and written to <dir>/.server.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRefkit, validName } from './server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'usage: node tools/refkit/serve.mjs --dir refs/<项目> [--port 5178]';
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DIR = path.resolve(ROOT, arg('dir', 'refs/default'));
const NAME = path.basename(DIR);
let port = Number(arg('port', 5178));
if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error('--port must be an integer 0-65535'); process.exit(2); }
if (!validName(NAME)) { console.error(`refkit: 项目文件夹名只能用字母、数字、中文和 - _ .：${NAME}`); process.exit(2); }
for (const d of ['images', 'drafts', 'exports']) fs.mkdirSync(path.join(DIR, d), { recursive: true });

const kit = createRefkit({ refsDir: path.dirname(DIR), root: ROOT, only: NAME });
const PAGE_URL = '/2d/?p=' + encodeURIComponent(NAME);
// Only answer requests addressed to this machine by name (blocks DNS-rebinding pages).
const okHost = (h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(h || ''));

const server = http.createServer((req, res) => {
  const p = String(req.url || '/').split(/[?#]/)[0];
  const end = (code, headers = {}, body = '') => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...headers }); res.end(body); };
  if (!okHost(req.headers.host)) return end(403, {}, 'forbidden host');
  if (kit.owns(p)) return kit.handle(req, res);
  if (p === '/' || p === '/index.html') return end(302, { Location: PAGE_URL });
  if (p === '/favicon.ico') return end(204);
  end(404, {}, 'not found');
});
let tries = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port && tries++ < 20) { port++; server.listen(port, '127.0.0.1'); return; }
  console.error('refkit: ' + e.message);
  process.exit(1);
});
server.on('listening', () => {
  const url = `http://127.0.0.1:${server.address().port}${PAGE_URL}`;
  try { fs.writeFileSync(path.join(DIR, '.server.json'), JSON.stringify({ url, pid: process.pid, started: new Date().toISOString() })); } catch { /* read-only dir */ }
  const rel = path.relative(ROOT, DIR);
  console.log(`refkit: ${url}  dir=${rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : DIR}`);
});
server.listen(port, '127.0.0.1');
