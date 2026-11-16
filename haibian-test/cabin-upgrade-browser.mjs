// Isolated staged browser test. Never opens the production cabin, Surfcore gateway, or QQ.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../surfcore/node_modules/playwright/index.mjs';
import { createInventoryHandler } from '../cabin-inventory.mjs';
import { createCabinHouse } from '../../surfcore/src/cabin-house.js';

const stage = fileURLToPath(new URL('../../_work/cabin-upgrade/web', import.meta.url));
const data = fs.mkdtempSync(path.join(tmpdir(), 'cabin-browser-upgrade-'));
let shift = 0;
const clock = () => Date.now() + shift;
const house = createCabinHouse({ stateDir: data, now: clock, config: { enabled: true } });
function json(res, status, out) {
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
}
const inventory = createInventoryHandler({ dataDir: data, webRoot: stage, sendJson: json, clock });
const assets = new Map(['home.html', 'cabin.html', 'cabin-bridge.js', 'cabin-gallery.js', 'cabin-gallery.css'].map((name) => [name, fs.readFileSync(path.join(stage, name), 'utf8')]));
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/api/cabin/inventory') return inventory(req, res);
    if (u.pathname === '/api/cabin/event') {
      const parts = []; for await (const ch of req) parts.push(ch);
      const out = house.recordEvent(JSON.parse(Buffer.concat(parts).toString('utf8')));
      return json(res, out.status, out.body);
    }
    if (u.pathname === '/api/cabin/timeline') {
      const out = house.getTimeline({ after: u.searchParams.get('after'), limit: u.searchParams.get('limit') });
      return json(res, out.status, out.body);
    }
    if (u.pathname === '/api/cabin/state') { const out = house.getState(); return json(res, out.status, out.body); }
    if (u.pathname === '/api/cabin/art') return json(res, 200, { ok: true, drawings: [], diaries: [] });
    if (u.pathname.startsWith('/api/')) return json(res, 200, { ok: true });
    const name = u.pathname === '/' ? 'home.html' : u.pathname.slice(1);
    const content = assets.get(name);
    if (!content) return res.writeHead(204).end();
    const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript';
    res.writeHead(200, { 'content-type': type + '; charset=utf-8' });
    return res.end(type === 'text/html' ? content.replace('</body>', '<link rel="stylesheet" href="/cabin-gallery.css"><script defer src="/cabin-bridge.js"></script><script defer src="/cabin-gallery.js"></script></body>') : content);
  } catch (e) { console.error('fixture:', e); if (!res.headersSent) json(res, 500, { ok: false }); else res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const errors = [];
  async function open({ legacy, name = '/' } = {}) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 780 } });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    if (legacy) await context.addInitScript((old) => { localStorage.setItem('v3.game', old); }, legacy);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + name + '?auto=0&wx=clear&time=noon&seed=51', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__READY && V3.actor && V3.cabinInventory.ready && V3.houseBlocks.grid, null, { timeout: 120000 });
    return page;
  }
  async function clickText(page, selector, text = '') {
    const point = await page.waitForFunction(({ selector, text }) => {
      const node = Array.from(document.querySelectorAll(selector)).find((n) => !n.disabled && (!text || n.textContent === text));
      if (!node || !node.getClientRects().length) return null;
      node.scrollIntoView({ block: 'nearest' });
      const r = node.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return node.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
    }, { selector, text }, { timeout: 10000 });
    const { x, y } = await point.jsonValue();
    await page.mouse.click(x, y);
  }
  const old = JSON.stringify({ v: 1, st: { found: { scallop: { n: 4, first: 100, last: 100 } } } });
  const page = await open({ legacy: old });
  assert.deepEqual(await page.evaluate(() => [V3.game.counts().total, V3.game.counts().items, localStorage.getItem('v3.game')]), [25, 4, old]);
  const scene = await page.evaluate(() => ({ slotIds: V3.shellDecor.slots().map((s) => s.id), bins: V3.cabinTrash.objects().map((o) => o.position.toArray()) }));
  assert.deepEqual(scene.slotIds, ['loft-window', 'coffee-table', 'ground-floor', 'loft-floor']);
  assert.equal(scene.bins.length, 1, JSON.stringify(scene));
  console.log('PASS migration, 25 collections, all four slots and porch bin');
  await page.evaluate(() => V3.collection.openDetail('scallop'));
  await clickText(page, '.col-decor button', '摆到小茶几');
  await page.waitForFunction(() => V3.game.inventory().placements['coffee-table']);
  await page.waitForFunction(() => V3.shellControls.available('scallop') === 3);
  await clickText(page, '.col-decor button', '从小茶几收回');
  await page.waitForFunction(() => !V3.game.inventory().placements['coffee-table']);
  await clickText(page, '.col-decor button', '摆到一楼地板');
  await page.waitForFunction(() => V3.game.inventory().placements['ground-floor']);
  await page.evaluate(() => V3.collection.close());
  console.log('PASS manual placement and return change saved available stock');
  await page.evaluate(async () => {
    const s = V3.shellDecor.slots().find((x) => x.id === 'ground-floor');
    const [x, y, z] = s.approach;
    V3.actor.place(x - .6, z, 0, y);
    const originalNow = Date.now;
    Date.now = () => originalNow() + 11 * 60000;
    V3.game.st.nextWash = Date.now() + 60 * 60000;
    V3.game.auto = true;
  });
  shift = 11 * 60000;
  await page.waitForFunction(() => !V3.game.inventory().placements['ground-floor'], null, { timeout: 40000 });
  await page.evaluate(() => {
    const [x, y, z] = V3.shellDecor.slots().find((s) => s.id === 'loft-window').approach;
    V3.actor.place(x + .45, z, 0, y);
  });
  try { await page.waitForFunction(() => V3.game.inventory().placements['loft-window']?.by === 'girl', null, { timeout: 65000 }); }
  catch (error) {
    console.error(await page.evaluate(() => ({ actor: V3.actor._dbg, pos: V3.actor.pos, placed: V3.game.inventory().placements,
      controlsBusy: V3.shellControls.busy, inventoryError: V3.cabinInventory.error, hidden: document.hidden, slots: V3.shellDecor.slots() })));
    throw error;
  }
  console.log('PASS actual actor walk, expired floor return and voluntary window display');
  await page.evaluate(async () => {
    V3.game.auto = false;
    V3.game.st.beach.push({ id: 'browser-trash-1', kind: 'crushed_can', x: -6, z: 9.5, at: Date.now(), ry: 0 });
    await V3.game.collect('browser-trash-1');
    await V3.cabinTrash.dispose();
  });
  assert.deepEqual(await page.evaluate(() => [V3.cabinTrash.count(), V3.cabinTrash.cleaned(), V3.game.counts().items]), [0, 1, 4]);
  await page.waitForFunction(() => window.__cabinGallery && document.querySelector('.cg-diary-toggle'));
  await clickText(page, '.cg-diary-toggle');
  await clickText(page, '.cg-diary-foot button', '今日小屋');
  await page.waitForFunction(() => document.querySelector('.cg-timeline').textContent.includes('你把1件海滩垃圾扔进垃圾桶'));
  const day = house.getTimeline().body.day;
  const captured = house.captureDiary(day);
  assert.ok(captured.lines.some((line) => line.includes('放到窗边展示')));
  house.recordEvent({ type: 'light_toggle', eventId: 'after-diary-capture', text: '写日记时新开了一盏灯' });
  assert.equal(house.settleDiary(captured), true);
  await clickText(page, '.cg-diary-foot button', '刷新');
  await page.waitForFunction(() => document.querySelector('.cg-timeline').textContent.includes('写日记时新开了一盏灯'));
  assert.equal(await page.evaluate(() => document.querySelector('.cg-timeline').textContent.includes('海滩垃圾扔进垃圾桶')), false);
  console.log('PASS litter disposal, diary watermark cleanup and later actions in the timeline UI');
  const second = await open({ name: '/cabin.html' });
  assert.deepEqual(await second.evaluate(() => [V3.game.counts().items, V3.game.inventory().placements['loft-window'].by, V3.cabinTrash.cleaned()]), [4, 'girl', 1]);
  assert.deepEqual(errors, []);
  console.log('PASS clean browser profile reads the shared save; no page errors');
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
