#!/usr/bin/env node
// test/api.test.mjs — end-to-end test of serve.mjs (HTTP API + static files) and tools/fb.mjs (CLI).
//   node test/api.test.mjs        (or: npm test)
// Spawns serve.mjs on 127.0.0.1:5299 with --fb-dir test/tmp-fb --ref-dir test/tmp-ref, prints one PASS line per check,
// exits 1 on the first failure. Scratch dirs test/tmp-fb, test/tmp-fb2, test/tmp-out, test/tmp-ref are removed at the
// end (KEEP_TMP=1 keeps them). Both programs are started from the OS temp dir to prove that relative paths resolve
// against the project root. The 2D 反馈 routes (/2d/, /api/ref…) run on a scratch project, never on refs/.
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5299;
const T = (d) => path.join(ROOT, 'test', d);
const FB = T('tmp-fb'), FB2 = T('tmp-fb2'), OUT = T('tmp-out'), REF = T('tmp-ref');
const ID_RE = /^fb-\d{8}-\d{6}-[a-z0-9]{3,6}$/;
const LOCAL_ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/;
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readItem = (dir, id) => JSON.parse(fs.readFileSync(path.join(dir, 'items', `${id}.json`), 'utf8'));
const countItems = (dir) => fs.readdirSync(path.join(dir, 'items')).filter((f) => f.endsWith('.json')).length;

class TestFail extends Error {}
let passed = 0;
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v) ?? String(v)).slice(0, 600);
/** Assert and print a PASS line; `got` is shown when the check fails. */
function ok(cond, what, got) {
  if (!cond) throw new TestFail(`${what}${got === undefined ? '' : `\n  got: ${show(got)}`}`);
  passed++;
  console.log(`PASS ${what}`);
}

/** Raw HTTP request (no URL normalisation, so traversal paths and odd Host headers reach the server as written). */
function req(method, p, { body, type = 'application/json', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    const h = { ...(data ? { 'Content-Type': type, 'Content-Length': data.length } : {}), ...headers };
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        if (/json/.test(res.headers['content-type'] || '')) { try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ } }
        resolve({ status: res.statusCode, headers: res.headers, buf, json });
      });
    });
    r.on('error', reject);
    r.end(data || undefined);
  });
}

/** Run tools/fb.mjs from a foreign cwd; --dir is relative to the project root. */
function fb(args, dir = 'test/tmp-fb') {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'fb.mjs'), ...args, '--dir', dir], { cwd: os.tmpdir(), encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout || '', out: `${r.stdout || ''}${r.stderr || ''}` };
}

let server = null, exited = true, serverLog = '';
async function startServer() {
  // refs/ is not in git: the reference-image checks use a scratch image in the scratch --ref-dir instead of the developer's own refs/
  fs.mkdirSync(REF, { recursive: true });
  fs.writeFileSync(path.join(REF, 'whale-girl-sheet.png'), PNG);
  server = spawn(process.execPath, [path.join(ROOT, 'serve.mjs'), '--port', String(PORT), '--fb-dir', 'test/tmp-fb', '--ref-dir', 'test/tmp-ref'],
    { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
  exited = false;
  server.on('exit', () => { exited = true; });
  for (const s of [server.stdout, server.stderr]) { s.setEncoding('utf8'); s.on('data', (d) => { serverLog += d; }); }
  // Wait until *this* process has bound the port, so a leftover server on 5299 is never tested by mistake.
  const t0 = Date.now();
  while (!serverLog.includes(`http://127.0.0.1:${PORT}/`)) {
    if (exited) throw new TestFail(`serve.mjs exited early (exit code ${server.exitCode}):\n${serverLog}`);
    if (Date.now() - t0 > 10000) throw new TestFail(`serve.mjs did not start within 10 s, log:\n${serverLog}`);
    await sleep(100);
  }
}
async function stopServer() {
  if (!server || exited) return;
  const done = new Promise((r) => server.once('exit', r));
  server.kill();
  await Promise.race([done, sleep(3000)]);
}
const rmTmp = () => { for (const d of [FB, FB2, OUT, REF]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); };

// ---------------------------------------------------------------- HTTP
const BASE = {
  build: 'test-build', page: 'studio', model: 'girl', part: '小鲸鱼/头/刘海', partLabel: '刘海',
  point: { local: [0.1, 0.2, 0.3], world: [1, 2, 3], normal: [0, 0, 1], anchor: 'girl/head/bangs' },
  camera: { pos: [0, 1.5, 4], target: [0, 1.2, 0], fov: 35 }, state: { expr: 'smile', pose: 'idle', t: 0, light: 'day' },
  category: '形状', severity: 2, text: '刘海太厚了，应该更薄一点',
};
async function httpTests(ctx) {
  let r = await req('GET', '/api/ping');
  ok(r.status === 200 && r.json && r.json.ok === true, 'GET /api/ping -> 200 {ok:true}', r.json);
  r = await req('GET', '/');
  ok(r.status === 302 && r.headers.location === '/studio.html', 'GET / -> 302 /studio.html', [r.status, r.headers.location]);
  r = await req('GET', '/favicon.ico');
  ok(r.status === 204 || r.status === 200, 'GET /favicon.ico -> 204 (no 404 noise in the browser console)', r.status);
  r = await req('GET', '/api/refs');
  const files = r.json && r.json.files;
  ok(r.status === 200 && Array.isArray(files) && files.includes('whale-girl-sheet.png') && files.join() === [...files].sort().join(),
    'GET /api/refs -> sorted image list', files);
  r = await req('GET', '/refs/whale-girl-sheet.png');
  ok(r.status === 200 && r.headers['content-type'] === 'image/png' && r.buf.length === fs.statSync(path.join(REF, 'whale-girl-sheet.png')).size,
    'GET /refs/whale-girl-sheet.png -> 200 image/png, whole file', [r.status, r.headers['content-type'], r.buf.length]);
  for (const p of ['/refs/../serve.mjs', '/refs/%2e%2e/serve.mjs', '/refs/..%2fserve.mjs', '/refs/..%5cserve.mjs', '/refs/%2e%2e%5cserve.mjs',
    '/feedback/../serve.mjs', '/feedback/..%5c..%5cserve.mjs', '/..%5cserve.mjs', '/%2e%2e/serve.mjs', '/refs/C:%5cWindows%5cwin.ini',
    '/refs/%00x', '/refs/CON', '/refs/%zz', '/feedback/', '/refs/']) {
    r = await req('GET', p);
    ok((r.status === 404 || r.status === 400) && !r.buf.toString('utf8').includes('createServer'), `blocked: GET ${p} -> ${r.status}`, r.status);
  }
  r = await req('GET', '/api/ping', { headers: { Host: 'evil.example:5299' } });
  ok(r.status === 403, 'foreign Host header -> 403 (DNS-rebinding guard)', r.status);
  r = await req('POST', '/refs/whale-girl-sheet.png', { body: {} });
  ok(r.status === 405 && /GET/.test(r.headers.allow || ''), 'POST to a static file -> 405 + Allow', [r.status, r.headers.allow]);
  r = await req('PUT', '/api/fb', { body: {} });
  ok(r.status === 405, 'PUT /api/fb -> 405', r.status);
  r = await req('GET', '/api/nope');
  ok(r.status === 404 && r.json && typeof r.json.error === 'string', 'unknown /api/ path -> 404 {error}', r.json);

  // POST: bad input is rejected and writes nothing
  r = await req('POST', '/api/fb', { body: BASE, type: 'text/plain' });
  ok(r.status === 415, 'POST with Content-Type text/plain -> 415', r.status);
  r = await req('POST', '/api/fb', { body: '{"text": broken' });
  ok(r.status === 400 && /JSON/.test(r.json && r.json.error), 'POST malformed JSON -> 400', r.json);
  for (const [extra, field] of [[{ status: 'done' }, 'status'], [{ category: '心情' }, 'category'], [{ severity: 5 }, 'severity'],
    [{ shotData: `data:image/png;base64,${Buffer.from('not a png at all').toString('base64')}` }, 'shotData'], [{ thread: 'x' }, 'thread']]) {
    r = await req('POST', '/api/fb', { body: { ...BASE, ...extra } });
    ok(r.status === 400 && r.json && r.json.error.includes(field), `POST invalid ${field} -> 400`, [r.status, r.json]);
  }
  r = await req('POST', '/api/fb', { body: [BASE] });
  ok(r.status === 400, 'POST a JSON array -> 400', r.status);
  ok(countItems(FB) === 0 && fs.readdirSync(path.join(FB, 'shots')).length === 0, 'rejected POSTs wrote nothing', fs.readdirSync(path.join(FB, 'items')));

  // POST: server owns id/created/updated/shot; extra fields survive
  const t0 = Date.now();
  r = await req('POST', '/api/fb', { body: { ...BASE, id: 'fb-20000101-000000-hax', created: '2000-01-01T00:00:00Z', shot: '../../evil.png',
    shotData: `data:image/png;base64,${PNG_B64}`, extraField: { keep: true } } });
  const A = r.json && r.json.item;
  ok(r.status === 200 && A && ID_RE.test(A.id) && A.id !== 'fb-20000101-000000-hax', 'POST /api/fb (1x1 png) -> 200 {item}, server-assigned id', r.json);
  ok(LOCAL_ISO.test(A.created) && A.updated === A.created && Math.abs(Date.parse(A.created) - t0) < 60000, 'created/updated = server local time with offset', [A.created, A.updated]);
  ok(A.id.slice(3, 11) === A.created.slice(0, 10).replace(/-/g, '') && A.id.slice(12, 18) === A.created.slice(11, 19).replace(/:/g, ''), 'id timestamp matches created', [A.id, A.created]);
  ok(A.status === 'open' && Array.isArray(A.thread) && A.thread.length === 0 && A.shotData === undefined, 'defaults: status open, thread [], no shotData in item', A);
  ok(A.shot === `shots/${A.id}.png` && fs.readFileSync(path.join(FB, 'shots', `${A.id}.png`)).equals(PNG), 'shotData decoded into shots/<id>.png (same bytes)', A.shot);
  ok(A.point.anchor === 'girl/head/bangs' && A.extraField && A.extraField.keep === true, 'extra fields kept (point.anchor, unknown top-level key)', A);
  const raw = fs.readFileSync(path.join(FB, 'items', `${A.id}.json`), 'utf8');
  ok(raw.startsWith('{\n  "id": ') && raw.includes('刘海太厚了') && JSON.parse(raw).id === A.id, 'items/<id>.json is pretty UTF-8', raw.slice(0, 80));
  await sleep(20);
  r = await req('POST', '/api/fb', { body: { ...BASE, part: '小鲸鱼/身体/尾巴', partLabel: '尾巴', point: null, category: '颜色', severity: 1, text: '尾巴颜色偏灰' } });
  const B = r.json && r.json.item;
  ok(r.status === 200 && B.shot === null && B.point === null && fs.readdirSync(path.join(FB, 'shots')).length === 1, 'POST without shotData -> shot null (point null ok)', r.json);
  Object.assign(ctx, { A, B });

  // list / get
  r = await req('GET', '/api/fb');
  ok(r.status === 200 && r.json.items.map((x) => x.id).join() === [B.id, A.id].join(), 'GET /api/fb -> {items} newest first', r.json);
  r = await req('GET', `/api/fb/${A.id}`);
  ok(r.status === 200 && r.json.item.id === A.id && r.json.item.text === BASE.text, 'GET /api/fb/<id> -> {item}', r.json);
  for (const [p, code] of [['/api/fb/not-an-id', 400], ['/api/fb/fb-20260101-000000-zzz', 404], ['/api/fb/..%2f..%2fpackage', 400],
    [`/api/fb/${A.id.toUpperCase()}`, 400], [`/api/fb/${A.id}/x`, 404]]) {
    r = await req('GET', p);
    ok(r.status === code && r.json && typeof r.json.error === 'string', `GET ${p} -> ${code} {error}`, [r.status, r.json]);
  }
  await patchTests(A);
  await deleteTests();
}

async function patchTests(A) {
  let r = await req('PATCH', `/api/fb/${A.id}`, { body: { status: 'doing', reply: { who: 'ai', text: '收到，正在改刘海厚度' } } });
  const P = r.json && r.json.item, e = P && P.thread[0];
  ok(r.status === 200 && P.status === 'doing' && P.thread.length === 1 && e.who === 'ai' && e.text === '收到，正在改刘海厚度' && e.status === 'doing' && LOCAL_ISO.test(e.at),
    'PATCH {status, reply} -> status updated + reply appended to thread', r.json);
  ok(P.updated === e.at && P.created === A.created && readItem(FB, A.id).status === 'doing', 'PATCH bumps updated, keeps created, rewrites the file', [P.created, P.updated]);
  for (const [body, what] of [[{ status: 'done' }, 'bad status'], [{}, 'empty body'], [{ reply: { text: '  ' } }, 'blank reply'],
    [{ reply: { who: 'bot', text: 'x' } }, 'bad reply.who'], [{ reply: 'text' }, 'reply not an object'], [[1], 'array body']]) {
    r = await req('PATCH', `/api/fb/${A.id}`, { body });
    ok(r.status === 400 && r.json && typeof r.json.error === 'string', `PATCH ${what} -> 400`, [r.status, r.json]);
  }
  r = await req('PATCH', `/api/fb/${A.id}`, { body: { status: 'closed' } });
  ok(r.status === 200 && r.json.item.status === 'closed' && r.json.item.thread.length === 1, 'PATCH {status:"closed"} alone -> no thread entry', r.json);
  r = await req('PATCH', `/api/fb/${A.id}`, { body: { reply: { text: '确认，已经好了' } } });
  const t = r.json && r.json.item.thread;
  ok(r.status === 200 && r.json.item.status === 'closed' && t.length === 2 && t[1].who === 'user' && t[1].status === undefined,
    'PATCH {reply} alone -> who defaults to user, status unchanged', r.json);
  r = await req('PATCH', '/api/fb/fb-20260101-000000-zzz', { body: { status: 'fixed' } });
  ok(r.status === 404, 'PATCH missing id -> 404', r.status);
  r = await req('PATCH', `/api/fb/${A.id}`, { body: 'status=fixed', type: 'application/x-www-form-urlencoded' });
  ok(r.status === 415 && readItem(FB, A.id).status === 'closed', 'PATCH with a form Content-Type -> 415, item untouched', r.status);
  // the feedback dir is also served read-only under /feedback/
  r = await req('GET', `/feedback/${A.shot}`);
  ok(r.status === 200 && r.headers['content-type'] === 'image/png' && r.buf.equals(PNG), 'GET /feedback/ + item.shot -> the png', [r.status, r.headers['content-type']]);
  r = await req('GET', `/feedback/items/${A.id}.json`);
  ok(r.status === 200 && r.json && r.json.id === A.id, 'GET /feedback/items/<id>.json -> stored item', r.status);
  r = await req('DELETE', `/feedback/${A.shot}`);
  ok(r.status === 405 && fs.existsSync(path.join(FB, A.shot)), 'DELETE on /feedback/ -> 405, file kept', r.status);
}

async function deleteTests() {
  let r = await req('POST', '/api/fb', { body: { ...BASE, text: '删除测试', shotData: `data:image/png;base64,${PNG_B64}` } });
  const D = r.json.item;
  r = await req('DELETE', `/api/fb/${D.id}`);
  const moved = r.json && r.json.moved;
  ok(r.status === 200 && r.json.ok === true && Array.isArray(moved) && moved.includes(`trash/${D.id}.json`) && moved.includes(`trash/${D.id}.png`),
    'DELETE /api/fb/<id> -> 200 {ok, moved}', r.json);
  ok(!fs.existsSync(path.join(FB, 'items', `${D.id}.json`)) && !fs.existsSync(path.join(FB, 'shots', `${D.id}.png`)) &&
    fs.existsSync(path.join(FB, 'trash', `${D.id}.json`)) && fs.existsSync(path.join(FB, 'trash', `${D.id}.png`)), 'DELETE moved json + png into trash/');
  r = await req('DELETE', `/api/fb/${D.id}`);
  ok(r.status === 404, 'DELETE the same id again -> 404', r.status);
  r = await req('GET', '/api/fb');
  ok(r.json.items.length === 2 && !r.json.items.some((x) => x.id === D.id), 'deleted item is gone from the list', r.json.items.map((x) => x.id));
  // body limit 25 MB: a 5 MB screenshot is accepted; 26 MB is refused with 413 and the server keeps working
  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
  r = await req('POST', '/api/fb', { body: { ...BASE, text: '大截图', shotData: `data:image/png;base64,${big.toString('base64')}` } });
  ok(r.status === 200 && r.json && fs.statSync(path.join(FB, 'shots', `${r.json.item.id}.png`)).size === big.length, 'POST with a 5 MB screenshot -> 200', r.status);
  await req('DELETE', `/api/fb/${r.json.item.id}`);
  r = await req('POST', '/api/fb', { body: Buffer.alloc(26 * 1024 * 1024, 0x20) });
  ok(r.status === 413 && countItems(FB) === 2, 'POST 26 MB body -> 413, nothing written', [r.status, r.json]);
  r = await req('GET', '/api/ping');
  ok(r.status === 200, 'server still answers after the 413', r.status);
}

// ---------------------------------------------------------------- CLI: tools/fb.mjs on the same dir
async function cliTests({ A, B }) {
  let r = fb(['list']);
  ok(r.code === 0 && r.out.includes(A.id) && r.out.includes(B.id) && r.out.includes('共 2 条'), 'fb list -> table with both items', r.out);
  r = fb(['list', '--part', '尾巴']);
  ok(r.code === 0 && r.out.includes(B.id) && !r.out.includes(A.id), 'fb list --part 尾巴 -> only the tail item', r.out);
  r = fb(['list', '--status', 'open', '--json']);
  const arr = tryJson(r.stdout);
  ok(r.code === 0 && Array.isArray(arr) && arr.length === 1 && arr[0].id === B.id, 'fb list --status open --json -> [tail item]', r.out);
  r = fb(['show', A.id]);
  ok(r.code === 0 && r.out.includes('刘海太厚了') && r.out.includes('确认，已经好了') && r.out.includes(path.join(FB, 'shots', `${A.id}.png`)) && r.out.includes('anchor'),
    'fb show <id> -> fields, thread, absolute shot path', r.out);
  r = fb(['show', A.id, '--json']);
  ok(r.code === 0 && tryJson(r.stdout)?.id === A.id, 'fb show <id> --json', r.out);
  r = fb(['reply', B.id, '尾巴颜色已经调亮了', '--status', 'fixed']);
  ok(r.code === 0 && r.out.includes('已回复'), 'fb reply <id> "text" --status fixed', r.out);
  const it = (await req('GET', `/api/fb/${B.id}`)).json.item, e = it.thread.at(-1);
  ok(it.status === 'fixed' && e.who === 'ai' && e.text === '尾巴颜色已经调亮了' && e.status === 'fixed', 'CLI reply is visible through the API (who=ai, status fixed)', it);
  r = fb(['status', B.id, 'wontfix']);
  ok(r.code === 0 && readItem(FB, B.id).status === 'wontfix' && readItem(FB, B.id).thread.length === 1, 'fb status <id> wontfix -> status only, no thread entry', r.out);
  r = fb(['status', B.id, '重开']);
  ok(r.code === 0 && readItem(FB, B.id).status === 'reopen', 'fb status accepts the Chinese label (重开 -> reopen)', r.out);
  r = fb(['status', B.id, 'bogus']);
  ok(r.code === 1 && readItem(FB, B.id).status === 'reopen', 'fb status with an unknown status -> exit 1, unchanged', r.out);
  r = fb(['show', 'fb-20260101-000000-zzz']);
  ok(r.code === 1, 'fb show <missing id> -> exit 1', r.out);
  r = fb(['frobnicate']);
  ok(r.code === 2, 'fb <unknown command> -> exit 2 + usage', r.out);
  r = fb(['summary']);
  ok(r.code === 0 && r.out.includes('反馈共 2 条') && r.out.includes('按状态') && r.out.includes('小鲸鱼/头/刘海') && r.out.includes('小鲸鱼/身体/尾巴'), 'fb summary -> by status + by part', r.out);
  r = fb(['summary', '--json']);
  const s = tryJson(r.stdout);
  ok(s && s.total === 2 && s.unresolved === 1 && s.byStatus.closed === 1 && s.byStatus.reopen === 1 && s.byPart.length === 2, 'fb summary --json -> counts', r.out);
  await bundleTests({ A, B });
}

// ---------------------------------------------------------------- CLI: export / import (bundle shared with the page's 导出/导入)
const tryJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
async function bundleTests({ A, B }) {
  const file = 'test/tmp-out/bundle.json';
  let r = fb(['export', file]);
  const bundle = tryJson(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  ok(r.code === 0 && bundle && bundle.kind === 'v3-fb-bundle' && bundle.version === 1 && bundle.items.length === 2 &&
    bundle.items.find((x) => x.id === A.id)?.shotData === `data:image/png;base64,${PNG_B64}`, 'fb export <file> -> v3-fb-bundle with shotData', r.out);
  r = fb(['export', 'test/tmp-out/closed.json', '--status', 'closed', '--no-shots']);
  const ns = tryJson(fs.readFileSync(path.join(OUT, 'closed.json'), 'utf8'));
  ok(r.code === 0 && ns && ns.items.length === 1 && ns.items[0].id === A.id && ns.items[0].shotData === undefined, 'fb export --status closed --no-shots', r.out);
  r = fb(['import', file], 'test/tmp-fb2');
  ok(r.code === 0 && /新增 2，更新 0，跳过 0/.test(r.out) && JSON.stringify(readItem(FB2, A.id)) === JSON.stringify(readItem(FB, A.id)) &&
    fs.readFileSync(path.join(FB2, 'shots', `${A.id}.png`)).equals(PNG), 'fb import into an empty dir -> identical items + screenshot', r.out);
  r = fb(['import', file], 'test/tmp-fb2');
  ok(r.code === 0 && /新增 0，更新 0，跳过 2/.test(r.out), 'importing the same bundle again -> all skipped', r.out);
  const later = new Date(Date.now() + 60000).toISOString(), src = bundle.items;
  fs.writeFileSync(path.join(OUT, 'merge.json'), JSON.stringify({ kind: 'v3-fb-bundle', version: 1, exported: later, items: [
    { ...src.find((x) => x.id === A.id), text: '离线改过的文字', updated: later },
    src.find((x) => x.id === B.id),
    { ...BASE, id: 'offline-1', text: '离线新增', created: later, updated: later, shotData: `data:image/png;base64,${PNG_B64}` },
  ] }));
  r = fb(['import', 'test/tmp-out/merge.json'], 'test/tmp-fb2');
  ok(r.code === 0 && /新增 1，更新 1，跳过 1/.test(r.out) && readItem(FB2, A.id).text === '离线改过的文字' && readItem(FB2, A.id).updated === later &&
    readItem(FB2, A.id).created === A.created, 'import merge: newer updated overwrites (created kept), equal is skipped', r.out);
  const ids = fs.readdirSync(path.join(FB2, 'items')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  const fresh = ids.filter((x) => x !== A.id && x !== B.id);
  ok(fresh.length === 1 && ID_RE.test(fresh[0]) && readItem(FB2, fresh[0]).text === '离线新增' && fs.existsSync(path.join(FB2, 'shots', `${fresh[0]}.png`)),
    'import merge: item with a non-fb id gets a new id + its screenshot', ids);
  fs.writeFileSync(path.join(OUT, 'bad.json'), JSON.stringify({ kind: 'v3-fb-bundle', version: 1, items: [{ ...BASE, text: '不应写入' }, { ...BASE, status: 'nope' }] }));
  r = fb(['import', 'test/tmp-out/bad.json'], 'test/tmp-fb2');
  ok(r.code === 1 && r.out.includes('items[1]') && countItems(FB2) === 3, 'import with an invalid item -> exit 1, nothing written', r.out);
  fs.writeFileSync(path.join(OUT, 'junk.json'), 'not json');
  r = fb(['import', 'test/tmp-out/junk.json'], 'test/tmp-fb2');
  ok(r.code === 1 && countItems(FB2) === 3, 'import a non-JSON file -> exit 1', r.out);
}

// ---------------------------------------------------------------- 2D 反馈: page + /api/ref on the scratch project test/tmp-ref/p1
const REF_ANSWERS0 = { version: 1, submittedRound: 1, images: {}, note: '第 1 轮的回答' };
function makeRefDir() {
  fs.mkdirSync(path.join(REF, 'p1', 'images'), { recursive: true });
  fs.writeFileSync(path.join(REF, 'p1', 'images', 'a.png'), PNG);
  fs.writeFileSync(path.join(REF, 'p1', 'questions.json'), JSON.stringify({ round: 2, images: { 'images/a.png': { summary: '测试图' } } }));
  fs.writeFileSync(path.join(REF, 'p1', 'answers.json'), JSON.stringify(REF_ANSWERS0));
  fs.mkdirSync(path.join(REF, 'not-a-project'), { recursive: true });
  fs.writeFileSync(path.join(REF, 'not-a-project', 'readme.txt'), 'no images/, no questions.json');
}
async function refTests() {
  const P1 = path.join(REF, 'p1'), readA = () => JSON.parse(fs.readFileSync(path.join(P1, 'answers.json'), 'utf8'));
  let r = await req('GET', '/api/refs');
  const files = (r.json && r.json.files) || [];
  ok(r.status === 200 && files.length > 0 && files.every((f) => /^[^/\\]+\.(png|jpe?g|webp|gif|svg)$/i.test(f)) && !files.some((f) => f.startsWith('scene-01')),
    'GET /api/refs still lists only the image files directly in refs/ (project folders ignored)', files);
  r = await req('GET', '/2d/');
  ok(r.status === 200 && /text\/html/.test(r.headers['content-type']) && r.buf.toString('utf8').includes('core.js'), 'GET /2d/ -> the 2D page', r.status);
  r = await req('GET', '/2d/core.js');
  ok(r.status === 200 && /javascript/.test(r.headers['content-type']) && r.buf.toString('utf8').includes('/api/ref/'), 'GET /2d/core.js -> page script', r.status);
  r = await req('GET', '/api/ref');
  const pj = r.json && r.json.projects;
  ok(r.status === 200 && r.json.dir === 'test/tmp-ref' && Array.isArray(pj) && pj.length === 1 && pj[0].name === 'p1' && pj[0].images === 1 && pj[0].round === 2 && pj[0].submittedRound === 1,
    'GET /api/ref -> [p1] with images/round/submittedRound (a folder without images/ or json is not a project)', r.json);
  r = await req('GET', '/api/ref', { headers: { Host: 'evil.example:5299' } });
  ok(r.status === 403, 'GET /api/ref with a foreign Host -> 403', r.status);
  r = await req('GET', '/api/ref/p1/state');
  const st = r.json || {};
  ok(r.status === 200 && st.project === 'p1' && st.dir === 'test/tmp-ref/p1' && st.images.length === 1 && st.images[0].key === 'images/a.png' &&
    st.questions.round === 2 && st.answers.submittedRound === 1 && st.questionsError === null && /^[0-9a-f]{12}$/.test(st.sig), 'GET /api/ref/p1/state -> images, questions, answers, sig', st);
  r = await req('GET', '/api/ref/p1/meta');
  ok(r.status === 200 && r.json.sig === st.sig, 'GET /api/ref/p1/meta -> same sig', r.json);
  r = await req('GET', '/api/ref/p1/img/images/a.png?v=1');
  ok(r.status === 200 && r.headers['content-type'] === 'image/png' && r.buf.equals(PNG), 'GET /api/ref/p1/img/images/a.png -> the png', [r.status, r.headers['content-type']]);
  for (const [p, code] of [['/api/ref/p1/img/images/..%2Fanswers.json', 400], ['/api/ref/p1/img/images/..%5Canswers.json', 400], ['/api/ref/p1/img/images/x.txt', 400],
    ['/api/ref/p1/img/trash/a.png', 404], ['/api/ref/p1/img/images/nope.png', 404], ['/api/ref/not-a-project/state', 404], ['/api/ref/..%2F..%2Fpackage/state', 400],
    ['/api/ref/%E0%A4%A/state', 400], ['/api/ref/CON/state', 400], ['/2d/../serve.mjs', 404], ['/2d/nope.js', 404]]) {
    r = await req('GET', p);
    ok(r.status === code && r.json && typeof r.json.error === 'string', `blocked: GET ${p} -> ${code} {error}`, [r.status, r.json]);
  }
  // answers: the page is the only writer; the first save of a server run backs up the previous file
  const A1 = { ...REF_ANSWERS0, submittedRound: 2, savedAt: '2026-11-05T10:00:00.000Z', note: '第 2 轮' };
  r = await req('PUT', '/api/ref/p1/answers', { body: A1 });
  ok(r.status === 200 && r.json.ok === true && readA().note === '第 2 轮' &&
    JSON.parse(fs.readFileSync(path.join(P1, 'answers.bak.json'), 'utf8')).note === '第 1 轮的回答', 'PUT answers -> answers.json written, previous copy in answers.bak.json', r.json);
  r = await req('PUT', '/api/ref/p1/answers', { body: { ...A1, note: '再改一次' } });
  ok(r.status === 200 && readA().note === '再改一次' && JSON.parse(fs.readFileSync(path.join(P1, 'answers.bak.json'), 'utf8')).note === '第 1 轮的回答',
    'second PUT -> answers.bak.json keeps the copy from before this server run', readA());
  for (const [opts, code, what] of [[{ body: A1, type: 'text/plain' }, 415, 'text/plain'], [{ body: '{"x": broken' }, 400, 'malformed JSON'], [{ body: [1, 2] }, 400, 'a JSON array']]) {
    r = await req('PUT', '/api/ref/p1/answers', opts);
    ok(r.status === code && readA().note === '再改一次', `PUT answers with ${what} -> ${code}, file untouched`, [r.status, r.json]);
  }
  r = await req('PUT', '/api/ref/p1/answers', { body: A1, headers: { Origin: 'http://evil.example' } });
  ok(r.status === 403 && readA().note === '再改一次', 'PUT answers from another origin -> 403', r.status);
  // upload / export / delete
  r = await req('POST', '/api/ref/p1/upload?name=a.png', { body: PNG, type: 'image/png' });
  ok(r.status === 200 && r.json.key === 'images/a-2.png' && fs.readFileSync(path.join(P1, 'images', 'a-2.png')).equals(PNG), 'POST upload of an existing name -> images/a-2.png', r.json);
  r = await req('GET', '/api/ref/p1/meta');
  ok(r.json.sig !== st.sig, 'meta sig changes when an image is added', r.json);
  r = await req('POST', '/api/ref/p1/upload?name=b.png', { body: PNG, type: 'text/plain' });
  ok(r.status === 415 && !fs.existsSync(path.join(P1, 'images', 'b.png')), 'POST upload with a non-image Content-Type -> 415', r.status);
  r = await req('POST', '/api/ref/p1/export?key=images%2Fa.png', { body: PNG, type: 'image/jpeg' });
  ok(r.status === 200 && fs.existsSync(path.join(P1, 'exports', 'images__a.jpg')), 'POST export -> exports/images__a.jpg', r.json);
  r = await req('POST', '/api/ref/p1/export?key=images%2Fzzz.png', { body: PNG, type: 'image/jpeg' });
  ok(r.status === 404, 'POST export for an unknown image -> 404', r.status);
  r = await req('POST', '/api/ref/p1/delete?key=images%2Fa-2.png', { headers: { Origin: 'http://evil.example' } });
  ok(r.status === 403 && fs.existsSync(path.join(P1, 'images', 'a-2.png')), 'POST delete from another origin -> 403, file kept', r.status);
  r = await req('POST', '/api/ref/p1/delete?key=images%2Fa-2.png', { headers: { Origin: `http://127.0.0.1:${PORT}` } });
  ok(r.status === 200 && /^trash\/\d{8}-\d{6}__a-2\.png$/.test(r.json.trash) && !fs.existsSync(path.join(P1, 'images', 'a-2.png')), 'POST delete -> moved to trash/<stamp>__a-2.png', r.json);
  r = await req('POST', '/api/ref/p1/upload?name=a-2.png', { body: PNG, type: 'image/png' });
  ok(r.status === 200 && r.json.key === 'images/a-2-2.png', 'a name still in trash/ is not reused (its labels stay in answers.json)', r.json);
  r = await req('POST', '/api/ref/p1/delete?key=drafts%2Fa.png');
  ok(r.status === 404, 'POST delete outside images/ -> 404', r.status);
  for (const [m, p, allow] of [['DELETE', '/api/ref/p1/state', 'GET'], ['GET', '/api/ref/p1/answers', 'PUT'], ['PUT', '/api/ref', 'GET, POST']]) {
    r = await req(m, p);
    ok(r.status === 405 && r.headers.allow === allow, `${m} ${p} -> 405 Allow: ${allow}`, [r.status, r.headers.allow]);
  }
  // new project
  r = await req('POST', '/api/ref', { body: { name: '新项目-2' } });
  ok(r.status === 200 && r.json.project.name === '新项目-2' && ['images', 'drafts', 'exports'].every((d) => fs.existsSync(path.join(REF, '新项目-2', d))),
    'POST /api/ref {name:"新项目-2"} -> project folder with images/ drafts/ exports/', r.json);
  r = await req('GET', '/api/ref');
  ok(r.json.projects.map((x) => x.name).sort().join() === ['p1', '新项目-2'].sort().join(), 'new project is listed', r.json.projects);
  for (const [body, code, what] of [[{ name: '新项目-2' }, 409, 'an existing project'], [{ name: 'not-a-project' }, 409, 'a folder that is not a project'],
    [{ name: '../evil' }, 400, 'a path'], [{ name: 'a b' }, 400, 'a space'], [{ name: 'nul' }, 400, 'a device name'], [{}, 400, 'no name']]) {
    r = await req('POST', '/api/ref', { body });
    ok(r.status === code && typeof r.json.error === 'string', `POST /api/ref with ${what} -> ${code}`, [r.status, r.json]);
  }
  ok(!fs.existsSync(path.join(ROOT, 'test', 'evil')), 'no folder created outside the ref dir');
  ok(!serverLog.includes('GET /api/ref/p1/meta') && !serverLog.includes('GET /api/ref/p1/state') && !serverLog.includes('PUT /api/ref/p1/answers 200') &&
    serverLog.includes('2d p1: uploaded images/a-2.png'),
    'server log: 2D polling is quiet, uploads are logged', serverLog.slice(-600));
}

// ---------------------------------------------------------------- main
async function main() {
  rmTmp();
  makeRefDir();
  await startServer();
  const ctx = {};
  await httpTests(ctx);
  await refTests();
  await cliTests(ctx);
  await stopServer();
  ok(!/ 5\d\d \d+ms/.test(serverLog) && !/^\s+at /m.test(serverLog), 'server log has no 5xx responses or stack traces', serverLog);
}
let failed = false;
main().then(
  () => console.log(`\nALL PASS (${passed} checks)`),
  (e) => { failed = true; console.error(`\nFAIL ${e instanceof TestFail ? e.message : e.stack || e}\n--- server log ---\n${serverLog}`); },
).finally(async () => {
  await stopServer();
  if (process.env.KEEP_TMP) console.log(`kept ${FB}, ${FB2}, ${OUT}, ${REF}`);
  else { try { rmTmp(); } catch (e) { console.error(`warning: could not remove scratch dirs: ${e.message}`); } }
  process.exit(failed ? 1 : 0);
});
