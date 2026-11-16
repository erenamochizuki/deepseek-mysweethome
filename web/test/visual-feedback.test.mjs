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
  const glow = await page.evaluate(async () => {
    const model = await V3.ysmUI.model('builtin:fatfish');
    // 2026-11-12：眼睛不全亮改成所有模型的默认规则（冬装版是导入的模型，拿不到自带模型的调校表）。
    // imported = 导入模型的默认建法（没有 tune）；optIn = 玩家在「模型设置」里勾了「眼睛发光」。
    const imported = V3.ysm.build(model, { height: 1.26 });
    const optIn = V3.ysm.build(model, { height: 1.26, eyeGlow: true });
    const tuned = V3.ysm.build(model, { height: 1.26, tune: V3.ysmUI.BUILTIN[0].tune });
    const inspect = inst => { const root = inst.root; let glow = 0, body = 0; root.traverse(o => { if (o.name === 'ysm-glow') glow += o.geometry.index.count; if (o.name === 'ysm-body') body += o.geometry.index.count; }); return { glow, body }; };
    const result = { imported: inspect(imported), optIn: inspect(optIn), tuned: inspect(tuned), actor: inspect(V3.actor.inst), id: V3.actor.bodyId };
    imported.dispose(); optIn.dispose(); tuned.dispose(); return result;
  });
  assert.equal(glow.id, 'builtin:fatfish');
  assert.equal(glow.actor.glow, 0);
  assert.equal(glow.tuned.glow, 0);
  assert.equal(glow.imported.glow, 0, 'Imported YSM eyes follow scene lighting by default');
  assert.ok(glow.optIn.glow > 0, 'Opting in restores the original full-bright eyes');
  assert.equal(glow.imported.body, glow.tuned.body, 'Eye geometry preserved');
  assert.equal(glow.optIn.body, glow.tuned.body, 'Eye geometry preserved when opted in');
  console.log('PASS eyes lit normally for builtin and imported models, opt-in glow retained', JSON.stringify(glow));
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
