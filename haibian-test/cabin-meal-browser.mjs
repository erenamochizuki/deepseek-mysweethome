// Real-browser check of the SCRATCH build (never the source dist): press the real 盛到碗里 button, watch her walk and eat.
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
// CABIN_TEST_STAGE=<…/web>：换一份暂存构建；默认 _work/cabin-b-20261112/web。截图写在那份构建的上一级目录。
const web = 'D:/Dafeiyu/haibianxiaowu/haibian-v4-complete/source/web/';
const W = path.join(process.env.CABIN_TEST_STAGE || 'D:/Dafeiyu/_work/cabin-b-20261112/web', '..') + path.sep;
const { launchBrowser, serveFiles } = await import(pathToFileURL(web + 'tools/mc-lib.mjs'));
const srv = await serveFiles({ '/cabin.html': path.join(W, 'web/cabin.html') });
const browser = await launchBrowser({ width: 1280, height: 800 }), errors = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
try {
  const page = await browser.newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(srv.url + '/cabin.html?wx=clear', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__READY && V3.furniturePlay.state().ready && V3.actor && V3.actor.startBehavior, { timeout: 120000 });
  await page.evaluate(() => { window.__ev = []; V3.on('actor:behavior', e => __ev.push(e.kind + ':' + e.phase + (e.reason ? ':' + e.reason : ''))); V3.on('actor:meal', e => __ev.push('meal:' + e.step)); });
  const st = () => page.evaluate(() => { const c = V3.furniturePlay.state().items.find(r => r.kind === 'cooker'), a = V3.actor; let rice = 0; V3.models.current().root.traverse(o => { if (o.name !== 'vox:rice') return; for (let p = o; p; p = p.parent) if (!p.visible) return; rice++; });
    return { cooker: c.state, behavior: a.behavior, actor: a.state, body: a.bodyId, rice, status: document.querySelector('.fp-status')?.textContent, buttons: [...document.querySelectorAll('.fp-controls button')].map(b => b.textContent + (b.disabled ? '(off)' : '')), toast: [...document.querySelectorAll('.toast,.hud-toast')].map(e => e.textContent).slice(-2), ev: window.__ev }; });
  log('loaded', JSON.stringify(await st()));
  await page.evaluate(async () => { await V3.view('floor=ground'); const c = V3.furniturePlay.state().items.find(r => r.kind === 'cooker'); const o = V3.furniturePlay.candidates().find(o => o.userData.furnitureKey === c.key); V3.furniturePlay.activate({ obj: o }); });
  log('cooker clicked (activate)', JSON.stringify(await st()));
  await page.evaluate(() => { const p = V3.scene.parts.find(p => p.id === 'furniture-play'); p.update(31, 31); });
  await page.evaluate(() => V3.nextFrames(3));
  const ready = await st(); log('rice ready', JSON.stringify(ready));
  assert.equal(ready.cooker.phase, 'ready'); assert.equal(ready.cooker.bowl, false);
  // press the real button; if she is busy (answering the cook line), the toast says so and we press again, as a player would
  let started = false;
  for (let i = 0; i < 20 && !started; i++) {
    await page.click('[data-action="serve"]');
    const s = await st(); started = s.behavior?.kind === 'eat';
    log('pressed 盛到碗里 #' + (i + 1), JSON.stringify({ behavior: s.behavior, actor: s.actor, cooker: s.cooker, status: s.status }));
    if (!started) { assert.equal(s.cooker.phase, 'ready'); assert.equal(s.cooker.bowl, false); await new Promise(r => setTimeout(r, 1500)); }
  }
  assert.ok(started, 'the eat behaviour started from the real button');
  const going = await st(); assert.equal(going.cooker.bowl, false, 'bowl not filled by the click');
  await page.screenshot({ path: path.join(W, 'shot-1-walking.png') });
  await page.waitForFunction(() => { const b = V3.actor.behavior; return !b || ['pickup', 'to_chair', 'sit', 'action'].includes(b.phase); }, { timeout: 120000, polling: 50 });
  const picked = await st(); log('pickup', JSON.stringify(picked));
  assert.ok(picked.behavior, 'not cancelled on the way: ' + JSON.stringify(picked.ev));
  assert.equal(picked.cooker.bowl, true); assert.equal(picked.cooker.phase, 'idle'); assert.ok(picked.rice >= 1, 'rice visible');
  await page.waitForFunction(() => V3.actor.behavior?.phase === 'action' || !V3.actor.behavior, { timeout: 120000, polling: 50 });
  await page.evaluate(() => V3.nextFrames(30));
  const eating = await st(); log('eating', JSON.stringify(eating));
  assert.equal(eating.behavior?.phase, 'action'); assert.equal(eating.actor, 'furniture'); assert.equal(eating.cooker.bowl, true);
  await page.screenshot({ path: path.join(W, 'shot-2-eating.png') });
  await page.waitForFunction(() => !V3.actor.behavior, { timeout: 120000, polling: 50 });
  await page.evaluate(() => V3.nextFrames(3));
  const done = await st(); log('done', JSON.stringify(done));
  assert.equal(done.cooker.bowl, false); assert.equal(done.cooker.phase, 'idle'); assert.equal(done.rice, 0);
  assert.deepEqual(done.ev.filter(e => e.startsWith('eat:') || e.startsWith('meal:')).slice(-4), ['eat:started', 'meal:pickup', 'eat:action', 'eat:completed']);
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.__errors || []), []);
  console.log('PASS scratch-build browser: real 盛到碗里 click → walk → pickup fills bowl → sit + eat → bowl empty');
} catch (e) { console.log('FAIL', e && e.stack || e); console.log('pageerrors', errors); process.exitCode = 1; }
finally { await browser.close(); await srv.close(); }
