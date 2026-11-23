// Isolated actual cabin page; no native directory picker or live services involved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { stageFile } from './browser-files.mjs';
import { chromium } from 'playwright-core';

const files = Object.fromEntries(['home', 'studio'].map(page => [`/${page}.html`, stageFile(page + ".html")]));
const server = http.createServer((req, res) => {
  const file = files[new URL(req.url, 'http://127.0.0.1').pathname];
  if (file) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(file).pipe(res);
  }
  return res.writeHead(204).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 730 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.goto(base + '/home.html?live=0&auto=0&wx=clear&time=noon&nopost=1', { timeout: 60000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__READY && V3.houseBlocks?.live()?.pack, null, { timeout: 60000 });

  const result = await page.evaluate(async () => {
    const H = V3.houseBlocks, initial = H.model, oldSource = H.from;
    await H.live().ready;
    const initialPack = H.live().pack;
    const png = V3.share.png.solid(8, 8, [233, 31, 103]);
    const stone = 'assets/minecraft/textures/block/stone.png';
    let discovery = null;
    V3.mcInstance.current = async () => discovery;
    const layers = [{ name: 'fixture', read: async path => path === stone ? png : null },
      { name: 'damaged', read: async path => path === stone ? new Uint8Array([1, 2, 3]) : null }];
    discovery = { name: '隔离 MC 实例', layers, modIds: new Set() };
    V3.settingsPanel.open('房子');
    const mode = document.querySelector('[data-key="mcTextureMode"] select');
    const change = async value => { mode.value = value; mode.dispatchEvent(new Event('change', { bubbles: true })); await H.live().ready; };
    const initialMode = mode.value;
    await change('instance');
    const instPack = H.live().pack;
    const sample = await instPack.sprite('minecraft:block/stone');
    const instColor = [...sample.data.slice(0, 4)];
    await change('builtin');
    const builtin = H.live().pack;
    await change('instance');
    discovery = null;
    await H.reloadTextures();
    const denied = H.live().pack;
    await change('builtin');
    V3.hud.closeModal();

    const model = { ...initial, cells: Int32Array.from(initial.cells), palette: [...initial.palette, 'sample_a:block_one', 'sample_b:block_two'] };
    let n = 0;
    for (let i = 0; n < 2 && i < model.cells.length; i++) if (model.palette[model.cells[i]] === 'minecraft:stone' || (i > 300 && !/^minecraft:air$/.test(model.palette[model.cells[i]]))) {
      model.cells[i] = model.palette.length - 2 + n++;
    }
    if (n !== 2) throw new Error('fixture has no usable cells');
    const bytes = await V3.share.writeSchem(model);
    const saved = [], put = H.store.put;
    H.store.put = async record => { saved.push(record); };
    const rejected = await H.importFromUI(bytes, { file: 'fixture.schem', force: true });
    const listed = document.querySelector('.house-missing-mods')?.textContent.split('\n');
    const preserved = initial === H.model && H.from === oldSource && saved.length === 0;
    V3.hud.closeModal();
    discovery = { name: '测试实例', layers: [], modIds: new Set(['sample_a', 'sample_b']) };
    const imported = await H.importFile(bytes, { file: 'fixture.schem', force: true });
    H.store.put = put;
    return { initialMode, instKey: instPack.key, initialKey: initialPack.key, builtinKey: builtin.key, deniedKey: denied.key,
      instColor, rejected: rejected.ok, listed, preserved, imported: imported.ok, required: saved[0]?.requiredMods };
  });
  assert.equal(result.initialMode, 'builtin');
  assert.equal(result.instKey, result.initialKey + '+instance');
  assert.deepEqual(result.instColor, [233, 31, 103, 255]);
  assert.equal(result.builtinKey, result.initialKey);
  assert.equal(result.deniedKey, result.initialKey);
  assert.equal(result.rejected, false);
  assert.deepEqual(result.listed, ['sample_a', 'sample_b']);
  assert.equal(result.preserved, true);
  assert.equal(result.imported, true);
  assert.deepEqual(result.required, ['sample_a', 'sample_b', 'xiaojingyu']);
  assert.deepEqual(errors, []);
  console.log('PASS A2: settings, pack priority/invalid fallback, no-permission fallback, missing Mods modal, original house preserved, associated Mods accepted.');
  await page.goto(base + '/studio.html?model=blockeditor&nopost=1', { timeout: 60000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => V3.blockEditor?.current?.(), null, { timeout: 60000 });
  const editor = await page.evaluate(async () => {
    const e = V3.blockEditor.current(), model = e.model;
    await e.ready;
    const bytes = await V3.share.writeSchem({ size: [1, 1, 1], offset: [0, 0, 0], palette: ['sample_a:block_one'], cells: Int32Array.of(0) });
    let rejected;
    try { await e.importBytes(bytes); } catch (error) { rejected = error.message; }
    const preserved = e.model === model;
    const listed = document.querySelector('.house-missing-mods')?.textContent;
    V3.hud.closeModal();
    V3.mcInstance.current = async () => ({ name: '测试实例', layers: [], modIds: new Set(['sample_a']) });
    await e.importBytes(bytes);
    const round = await V3.share.read(await e.exportPng());
    return { rejected, preserved, listed, required: round.meta?.compound.RequiredMods?.list.map(x => x.string) };
  });
  assert.match(editor.rejected, /sample_a/);
  assert.equal(editor.preserved, true);
  assert.equal(editor.listed, 'sample_a');
  assert.deepEqual(editor.required, ['sample_a']);
  assert.deepEqual(errors, []);
  console.log('PASS A2 workbench: missing Mod prevents replacement; metadata-free import exports RequiredMods when dependency is present.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
