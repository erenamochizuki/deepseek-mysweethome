import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { stageFile } from './browser-files.mjs';
import Rules from '../web/dist/inventory-rules.mjs';
import { backupProgress, createProgressHandler } from '../integration/cabin-progress.mjs';

const home = await fs.readFile(stageFile('home.html'), 'utf8');
const options = {
  dataDir: await fs.mkdtemp(path.join(os.tmpdir(), 'cabin-save-browser-')),
  sendJson(res, status, json) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(json));
  },
};
const progress = createProgressHandler(options);
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/cabin/progress')) return progress(req, res);
  if (req.url === '/seed') return res.end('<!doctype html>');
  const html = req.url.startsWith('/connected')
    ? home.replace('</head>', '<meta name="cabin-progress" content="1"></head>').replace('</body>', '<script src="/cabin-bridge.js"></script></body>') : home;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({
    channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  for (const connected of [false, true]) {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    const fixture = { id: '12345678-1234-4321-8765-123456789012', name: '茶泡饭', ingredients: '米饭和绿茶', steps: '浇上热茶。',
      notes: '趁热吃', updatedAt: '2026-11-26T00:00:00Z', source: 'player' };
    const snapshot = Rules.freshState();
    snapshot.inventory.coins = 37;
    let refuseBackup = false;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/cabin-bridge.js') return route.fulfill({ body: '', contentType: 'application/javascript' });
      if (url.pathname === '/api/cabin/save') {
        assert.ok(connected);
        if (refuseBackup) return route.fulfill({ status: 503, json: { ok: false } });
        return route.fulfill({ json: { ok: true, inventory: snapshot, recipes: [fixture], browser: backupProgress(options) } });
      }
      if (url.pathname === '/api/cabin/inventory') {
        assert.ok(connected);
        return route.fulfill({ json: { ok: true, ...snapshot } });
      }
      return route.continue();
    });
    await page.addInitScript(state => {
      localStorage.setItem('unrelated', 'omit this');
      if (!location.pathname.startsWith('/connected') && !localStorage.getItem('v3.inventory')) localStorage.setItem('v3.inventory', JSON.stringify(state));
    }, snapshot);
    await page.goto(origin + '/seed', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('v3-ysm', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('models', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('models', 'readwrite');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.objectStore('models').put({ id: 'test-model', name: '测试模型', authors: [],
          files: [['test.json', new Uint8Array([9, 8, 7, 6]).subarray(1)]] });
      });
      db.close();
    });
    await page.goto(origin + (connected ? '/connected' : '/standalone') + '?auto=0&wx=clear&time=noon');
    await page.waitForFunction(() => window.__READY && V3.cabinInventory.ready || document.querySelector('.cabin-progress-status'), null,
      { timeout: 60000 }).catch(async error => { throw new Error((connected ? 'Service' : 'Standalone') + ' boot: ' +
        JSON.stringify(await page.evaluate(() => [window.__errors, V3.cabinInventory?.error])), { cause: error }); });
    assert.equal(await page.locator('.cabin-progress-status').allTextContents().then(text => text.join(' ')), '');
    await page.evaluate(async () => {
      await V3.houseBlocks.store.put({ v: 2, bytes: new Uint8Array([1, 2, 3]), kind: 'arranged' });
      await V3.mcjar.cacheSave({ files: new Map([['texture.png', new Uint8Array([4, 5, 6])]]) });
      V3.game.set('leisureMin', 3);
    });

    await page.locator('.hud-settings').click({ force: true });
    await page.locator('.set-tab[data-tab="存档"]').click({ force: true });
    const settings = page.locator('[data-key="cabinSave"]');
    const exportButton = settings.locator('button').filter({ hasText: /^导出存档$/ });
    assert.equal(await exportButton.textContent(), '导出存档');
    const [download] = await Promise.all([page.waitForEvent('download').catch(async error => {
      const detail = await page.evaluate(() => ({ status: document.querySelector('[data-key="cabinSave"] [role="status"]')?.textContent, errors: window.__errors }));
      throw new Error((connected ? 'Service' : 'Standalone') + ' export: ' + JSON.stringify(detail), { cause: error });
    }), exportButton.click({ force: true })]);
    assert.match(download.suggestedFilename(), /^海边小屋存档-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.equal(data.format, 'cabin-save-v1');
    assert.equal(data.source, connected ? 'service' : 'browser');
    assert.equal(data.inventory.inventory.coins, 37);
    assert.deepEqual(data.recipes, connected ? [fixture] : []);
    assert.equal(data.browser.localStorage.unrelated, undefined);
    assert.equal(JSON.parse(data.browser.localStorage['v3.cabinGame']).S.leisureMin, 3);
    assert.deepEqual(data.browser.house.bytes, { type: 'Uint8Array', encoding: 'base64', data: 'AQID' });
    assert.equal(data.browser.models[0].files[0][1].data, 'CAcG');
    assert.equal(data.browser.texturePack.blob.data, 'BAUG');
    assert.equal(data.browser.texturePack.offsets.type, 'Uint32Array');
    if (connected) {
      refuseBackup = true;
      await exportButton.click({ force: true });
      await page.waitForFunction(() => document.querySelector('[data-key="cabinSave"] [role="status"]').textContent.includes('存档导出失败'));
      assert.equal(await exportButton.isEnabled(), true);
    } else {
      // Exercise the real house/photo and YSM parsers, not just storage-shaped fixtures.
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const g = canvas.getContext('2d'); g.fillStyle = '#339988'; g.fillRect(0,0,128,128);
        const bytes = new Uint8Array(await (await new Promise(r => canvas.toBlob(r))).arrayBuffer());
        const saved = await V3.album.storeDrawing(V3.photos.make(bytes,'恢复测试'));
        if (!saved.ok) throw Error(JSON.stringify(saved));
        const model = V3.ysmUI.BUILTIN[0];
        const zip = Uint8Array.from(atob(window.__V3_ASSETS[model.asset]), ch => ch.charCodeAt(0));
        const row = (await V3.ysmUI.read([new File([zip], 'readable-model.zip')])).rec;
        row.id = 'restored-model';
        await V3.ysmUI.replaceLocalModels([row]);
      });
      const [file] = await Promise.all([page.waitForEvent('download'), exportButton.click({ force: true })]);
      const archive = JSON.parse(await fs.readFile(await file.path(), 'utf8'));
      archive.recipes = [fixture]; archive.source = 'service';
      archive.inventory.inventory.coins = 95;
      archive.browser.texturePack.key = 'v3|import-test';
      archive.browser.localStorage['v3.girl.model'] = 'restored-model';
      archive.browser.localStorage['v3.cabinDrawing:old'] = 'do not deliver';
      const record = JSON.parse(archive.browser.localStorage['v3.cabinGame']);
      record.S.leisureMin = 7;
      archive.browser.localStorage['v3.cabinGame'] = JSON.stringify(record);
      const picker = page.locator('[data-key="cabinSave"] input[type="file"]');
      const confirm = settings.locator('button').filter({ hasText: /^确认覆盖$/ });
      const select = record => picker.setInputFiles({ name: '备份.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(record)) });
      await select({ ...archive, browser: { ...archive.browser, house: { v: 2, bytes: data.browser.house.bytes } } });
      await page.waitForFunction(() => document.querySelector('[data-key="cabinSave"] .bad'));
      assert.equal(await confirm.count(), 0);
      await select(archive);
      await settings.locator('button').filter({ hasText: /^取消$/ }).click({ force:true });
      assert.equal(await page.evaluate(() => V3.cabinInventory.data.inventory.coins), 37);
      await page.evaluate(() => {
        const original = V3.mcjar.replaceLocalRecord;
        V3.mcjar.replaceLocalRecord = () => { V3.mcjar.replaceLocalRecord = original; throw Error('simulated write failure'); };
      });
      await select(archive); await confirm.click({ force:true });
      await page.waitForFunction(() => document.querySelector('[data-key="cabinSave"] .bad'));
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('v3.inventory')).inventory.coins), 37);
      assert.equal(await page.evaluate(() => localStorage.getItem('cabin.local-save-pending')), null);
      await select(archive);
      await Promise.all([page.waitForNavigation({ waitUntil:'domcontentloaded' }), confirm.click({ force:true })]);
      await page.waitForFunction(() => window.__READY && V3.cabinInventory.ready);
      assert.deepEqual(await page.evaluate(async () => ({
        coins: V3.cabinInventory.data.inventory.coins, min: V3.game.get('leisureMin'), model: V3.ysmUI.choice(),
        imports: (await V3.ysmUI.list()).map(m => m.id), texture: [...(await V3.mcjar.cacheRecord()).blob],
        album: V3.album.photos().some(p => p.name === '恢复测试'), queued: localStorage.getItem('v3.cabinDrawing:old'),
        unrelated: localStorage.getItem('unrelated'),
      })), { coins: 95, min: 7, model: 'restored-model', imports: ['restored-model'], texture: [4,5,6],
        album: true, queued: null, unrelated: 'omit this' });
      await page.locator('.hud-settings').click({ force: true });
      await page.locator('.set-tab[data-tab="存档"]').click({ force: true });
      const [check] = await Promise.all([page.waitForEvent('download'),exportButton.click({ force: true })]);
      const roundTrip = JSON.parse(await fs.readFile(await check.path(), 'utf8'));
      assert.deepEqual(roundTrip.recipes, [fixture]);
      assert.deepEqual(roundTrip.browser.house, archive.browser.house);
      assert.deepEqual(roundTrip.browser.models, archive.browser.models);
      assert.deepEqual(roundTrip.browser.texturePack, archive.browser.texturePack);
    }
    const collection = await page.evaluate(() => V3.inventoryUI.panel().textContent);
    assert.ok(collection.includes('导入收藏备份'));
    assert.ok(!collection.includes('导出收藏'));
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS: archive downloads, legacy collection import, failed export, standalone cancel/rollback and full import/export including recipes and album');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
