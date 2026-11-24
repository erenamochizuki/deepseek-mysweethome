// Run after the shared cabin build; never builds or changes the user's browser profile.
// node test/visual-feedback.test.mjs [http://127.0.0.1:5194/cabin.html]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { WEB_DIR, launchBrowser, serveFiles } from '../tools/mc-lib.mjs';
const srv = process.argv[2] ? null : await serveFiles({ '/cabin.html': path.join(WEB_DIR, 'dist/cabin.html') });
const url = process.argv[2] || srv.url + '/cabin.html';
const out = path.join(WEB_DIR, 'shots/visual-feedback');
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ width: 1280, height: 800 });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__READY === true, { timeout: 120000 });
  await page.evaluate(async () => { await V3.houseBlocks.ready; await V3.waitReady(V3.models.current()); await V3.houseBlocks.live().ready; V3.actor.hold(true); });
  const ids = await page.evaluate(() => V3.ysmUI.BUILTIN.map(b => b.id));
  assert.deepEqual(ids, ['builtin:blue-whale-maid-twin', 'builtin:blue-whale-maid-loose']);
  assert.equal(await page.evaluate(() => V3.actor.bodyId), ids[0]);
  for (const id of [ids[1], ids[0]]) {
    await page.evaluate(id => V3.ysmUI.choose(id), id);
    await page.waitForFunction(id => V3.actor.bodyId === id && V3.actor.inst.mesh.material.map?.image?.width === 2048, {}, id);
  }
  const scenes = {
    'porch-day': 'cam=10.77_8.615_12.453_3.5_2.4_1+time=noon+floor=all+door=0+girl=at_0_2_0+ui=0',
    'porch-night': 'cam=10.77_8.615_12.453_3.5_2.4_1+time=night+floor=all+door=0+ui=0',
    'door-day': 'cam=0.5_3.8_1.5_0_2.4_-6+time=noon+floor=all+door=0+ui=0',
    'interior-night': 'cam=0_22.997_-7.223_0_1_-10+time=night+floor=ground+door=0+ui=0',
    'interior-lantern': 'cam=-4.5_8.5_-10.5_-1.5_9.4_-10.5+time=night+floor=all+ui=0',
    'eyes-night': 'cam=0_1.5_4_0_0.9_2+time=night+floor=all+girl=at_0_2_0+ui=0',
  };
  for (const [name, view] of Object.entries(scenes)) {
    await page.evaluate(v => window.__view(v), view);
    await new Promise(r => setTimeout(r, 1200));
    await page.screenshot({ path: path.join(out, name + '.png') });
    console.log('SHOT', name);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__errors || []), []);
  console.log('PASS no page errors; 6 review screenshots');
} finally { await browser.close(); if (srv) await srv.close(); }
