// 老存档补窗边风铃：布置过的房子是「窗边风铃」方块加进默认房子之前存的，只有门上一件。
// 重新打开时阁楼里那一串不能消失（用户 2026-11-22：「阁楼的风铃在阁楼视角下看不到」）。
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';

const server = await serveFiles({ '/cabin.html': path.join(WEB_DIR, 'dist', 'cabin.html') });
const dir = path.join(WEB_DIR, 'shots', 'chime-legacy');
let browser, page, step = '打开小屋';
try {
  const args = process.argv.includes('--isolated-runner') ? ['--no-sandbox'] : [];
  browser = await launchBrowser({ width: 1280, height: 800, gpu: 'swiftshader', args });
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.stack || e.message));
  await page.goto(server.url + '/cabin.html?auto=0&wx=clear&time=noon', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__READY && V3.houseDetail.chimes().length === 2, { timeout: 120000 });

  step = '做一栋没有窗边风铃的布置房（= 老存档）';
  const made = await page.evaluate(async () => {
    const HB = V3.houseBlocks, D = HB.defaultModel;
    const idOf = s => { const t = String(s).replace(/\[.*$/, ''); return t.includes(':') ? t : 'minecraft:' + t; };
    const isAir = s => /^(minecraft:)?(air|cave_air|void_air)$/.test(String(s));
    const m = structuredClone(D), org = HB.originOf(m), [W, Hh, L] = m.size;
    const air = m.palette.findIndex(isAir);
    const at = (x, y, z) => {
      const mx = x - org[0], my = y - org[1], mz = z - org[2];
      if (mx < 0 || my < 0 || mz < 0 || mx >= W || my >= Hh || mz >= L) return null;
      const i = mx + mz * W + my * W * L;
      return { i, id: idOf(m.palette[m.cells[i]]) };
    };
    const win = at(-2, 7, -8);
    if (!win || win.id !== 'xiaojingyu:wind_chime') throw Error('默认房子没有阁楼窗边的风铃方块：' + JSON.stringify(win));
    m.cells[win.i] = air;                                  // 老默认房子少的就是这一格
    await HB.applyEdit(m, { rebuild: false });
    const saved = await HB.saveArranged();
    if (!saved.ok) throw Error('老房子没存下：' + JSON.stringify(saved));
    return { from: HB.from, base: HB.custom && HB.custom.base };
  });
  assert.deepEqual(made, { from: 'arranged', base: 'default' }, '存成一栋默认房子上布置的房');

  step = '重新打开：阁楼的风铃按默认位置补上';
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__READY, { timeout: 120000 });
  await page.waitForFunction(() => V3.houseDetail.chimes().length === 2, { timeout: 30000 });
  const scene = await page.evaluate(async () => {
    await V3.view('floor=loft+loft'); V3.R.freeze(0); await V3.waitReady(); await V3.nextFrames(4);
    const root = V3.models.current().root, obj = root.getObjectByName('house2:chimeWindow');
    let shown = !!obj, chain = [];
    for (let p = obj; p; p = p.parent) { chain.push([p.name || p.type, p.visible]); shown = shown && p.visible; }
    const wp = obj.getWorldPosition(new THREE.Vector3()), pr = wp.clone().project(V3.R.camera), rect = V3.R.canvas.getBoundingClientRect();
    const px = [Math.round(rect.left + (1 + pr.x) * rect.width / 2), Math.round(rect.top + (1 - pr.y) * rect.height / 2)];
    const hit = V3.cabinTargets.pick({ clientX: px[0], clientY: px[1] });
    return { from: V3.houseBlocks.from, base: V3.houseBlocks.custom?.base, chimes: V3.houseDetail.chimes(), shown, chain, px,
      inFrame: Math.abs(pr.x) < 1 && Math.abs(pr.y) < 1, pick: hit && { what: hit.what, slot: hit.obj?.userData?.chimeSlot } };
  });
  assert.equal(scene.from, 'arranged');
  assert.equal(scene.chimes.length, 2, '老存档里也要有两件风铃：' + JSON.stringify(scene.chimes));
  assert.equal(scene.chimes.find(c => c.slot === 'window')?.cell.join(), '-2,7,-8', '阁楼窗边的风铃要按默认位置补在 (−2,7,−8)');
  assert.ok(scene.shown && scene.inFrame, '阁楼视角下看不到补上的风铃：' + JSON.stringify({ shown: scene.shown, chain: scene.chain, px: scene.px }));
  assert.deepEqual(scene.pick, { what: 'chime', slot: 'window' }, '阁楼视角下要能点到它、并认出是窗边的风铃');

  await mkdir(dir, { recursive: true });
  await page.evaluate(() => document.body.classList.add('ui-off'));
  await page.screenshot({ path: path.join(dir, 'legacy-loft.png') });
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.__errors), []);
  console.log('PASS 老存档补上阁楼窗边的风铃，阁楼视角下看得到、点得到；截图在 ' + dir);
} catch (error) {
  console.error(step, String(error && error.stack || error));
  const state = await page?.evaluate(() => ({ from: V3?.houseBlocks?.from, custom: V3?.houseBlocks?.custom, chimes: V3?.houseDetail?.chimes?.(),
    errors: window.__errors?.slice(-3) })).catch(() => null);
  console.error('state', JSON.stringify(state));
  throw error;
} finally { await browser?.close(); await server.close(); }
