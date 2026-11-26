import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createProgressHandler, backupProgress } from '../integration/cabin-progress.mjs';
import { createInventoryHandler } from '../integration/cabin-inventory.mjs';
import { stageFile } from './browser-files.mjs';

const opts = {
  dataDir: await mkdtemp(path.join(os.tmpdir(), 'cabin-progress-browser-')),
  sendJson(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); },
};
const progress = createProgressHandler(opts), inventory = createInventoryHandler(opts);
const html = await readFile(stageFile('home.html'), 'utf8');
let unavailable = false;
let generation = '0';
const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  if (pathname === '/api/cabin/progress') {
    res.setHeader('X-Cabin-Generation', generation);
    if (req.method === 'PUT' && req.headers['x-cabin-generation'] !== generation) {
      return opts.sendJson(res, 409, { ok:false, error:'stale_generation' });
    }
  }
  if (pathname === '/api/cabin/progress') return unavailable ? opts.sendJson(res, 503, { ok: false }) : progress(req, res);
  if (pathname === '/api/cabin/inventory') return inventory(req, res);
  if (!['/home', '/seed'].includes(pathname)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pathname === '/seed' ? '<html></html>' : html.replace('<head>', '<head><meta name="cabin-progress" content="1"><meta name="cabin-save-generation" content="'+generation+'">'));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port, url = origin + '/home?auto=0&wx=clear&time=noon';
let browser;
try {
  browser = await chromium.launch({channel:'msedge', headless:true, args:['--use-angle=d3d11','--ignore-gpu-blocklist']});
  const screen = { viewport: {width: 640, height: 420} };
  const ready = async p => {
    try { await p.waitForFunction(() => window.__READY && V3.cabinInventory.ready && V3.furniturePlay.state().ready, null, { timeout: 90000 }); }
    catch (e) { throw Error(JSON.stringify(await p.evaluate(() => [window.__READY, V3.cabinInventory.error, document.querySelector('.cabin-progress-status')?.textContent, window.__errors])), {cause:e}); }
  };
  const load = async p => { await p.goto(url); await ready(p); };
  const empty = await browser.newContext(screen), old = await browser.newContext(screen);
  const first = await empty.newPage();
  await load(first);
  await first.evaluate(() => V3.cabinProgress.flush());
  assert.equal(backupProgress(opts).house, null);
  assert.equal(backupProgress(opts).localStorage['v3.cabinGame'], undefined);
  const generated = await first.evaluate(async () => {
    await V3.houseBlocks.saveArranged({ gallerySync: true });
    const record = await V3.houseBlocks.store.get();
    return { ...record, bytes: Array.from(record.bytes) };
  });
  assert.equal(backupProgress(opts).house.galleryOnly, true);
  await first.close();
  console.log('Fresh service left the migration slots open');
  const page = await old.newPage();
  await page.goto(origin + '/seed');
  await page.evaluate(async generated => {
    localStorage.setItem('v3.cabinGame', JSON.stringify({v:1,S:{leisureMin:4},st:{}}));
    localStorage.setItem('v3.wx.example', 'weather cache');
    localStorage.setItem('unrelated', 'private');
    const db = await new Promise(resolve => {
      const req = indexedDB.open('v3-ysm',1);
      req.onupgradeneeded = () => req.result.createObjectStore('models',{keyPath:'id'});
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise(resolve => {
      const tx = db.transaction('models','readwrite');
      tx.objectStore('models').put({id:'old-model',name:'测试模型',files:[['test',new Uint8Array([10,20])]]});
      tx.oncomplete = resolve;
    });
    db.close();
    const houses = await new Promise(resolve => {
      const req = indexedDB.open('v3-house',1);
      req.onupgradeneeded = () => req.result.createObjectStore('house');
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise(resolve => {
      const tx = houses.transaction('house','readwrite');
      const { galleryOnly, ...original } = generated;
      tx.objectStore('house').put({...original, bytes: new Uint8Array(original.bytes), file:'old-house.png'},'current');
      tx.oncomplete = resolve;
    });
    houses.close();
  }, generated);
  await load(page);
  assert.equal(await page.evaluate(() => V3.game.get('leisureMin')),4);
  assert.equal(backupProgress(opts).models[0].files[0][1].data,'ChQ=');
  assert.equal(backupProgress(opts).house.file,'old-house.png');
  assert.equal(backupProgress(opts).house.galleryOnly,undefined);
  assert.equal(backupProgress(opts).localStorage['v3.wx.example'],undefined);
  assert.equal(backupProgress(opts).localStorage.unrelated,undefined);
  console.log('Migrated the original settings and model');
  await page.evaluate(async () => { await V3.houseBlocks.saveArranged(); V3.game.set('leisureMin',5); await V3.cabinProgress.flush(); });
  const remote = await empty.newPage(); await load(remote);
  const restored = await remote.evaluate(async () => {
    const model = await V3.ysmUI.get('old-model');
    return [V3.houseBlocks.from, V3.game.get('leisureMin'), [...model.files[0][1]]];
  });
  assert.deepEqual(restored, ['arranged',5,[10,20]]);
  await remote.evaluate(async () => { V3.game.set('leisureMin',6); await V3.cabinProgress.flush(); });
  await remote.close(); // Release the second WebGL scene before exercising reconnects on the original browser.
  console.log('Loaded and edited the shared house from a second profile');
  await page.bringToFront();
  assert.equal(await page.evaluate(async () => {
    V3.game.set('leisureMin',7);
    try { await V3.cabinProgress.flush(); return false; } catch { return true; }
  }),true);
  assert.equal(JSON.parse(backupProgress(opts).localStorage['v3.cabinGame']).S.leisureMin,6);
  await page.reload(); await ready(page);
  assert.equal(await page.evaluate(()=>V3.game.get('leisureMin')),6);
  unavailable = true;
  assert.equal(await page.evaluate(async () => {
    V3.game.set('leisureMin',8);
    try { await V3.cabinProgress.flush(); return false; } catch { return true; }
  }),true);
  assert.equal(JSON.parse(backupProgress(opts).localStorage['v3.cabinGame']).S.leisureMin,6);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.cabin-progress-status')?.textContent.includes('未能打开小屋存档'));
  assert.ok(!await page.evaluate(()=>window.__READY));
  unavailable = false; await page.reload(); await ready(page);
  assert.equal(await page.evaluate(()=>V3.game.get('leisureMin')),8);
  assert.equal(JSON.parse(backupProgress(opts).localStorage['v3.cabinGame']).S.leisureMin,8);
  generation = 'restored-test-save';
  await page.evaluate(async () => {
    V3.game.set('leisureMin',9);
    await V3.cabinProgress.flush().catch(() => {});
  });
  await page.waitForFunction(() => document.querySelector('.cabin-progress-status')?.textContent.includes('已导入另一份存档'));
  await page.reload(); await ready(page);
  assert.equal(await page.evaluate(() => V3.game.get('leisureMin')),8,'A restored save ignores the old tab’s unsent changes');
  console.log('PASS empty first launch, old records, binary assets, two independent browsers, conflicting writes, disconnected startup and replay');
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
