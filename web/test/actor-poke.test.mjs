// Pure actor regressions; --url <existing cabin/home URL> adds real browser clicks. Never builds or serves.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { launchBrowser, WEB_DIR, serveFiles } from '../tools/mc-lib.mjs';
const env = loadV3([], { three: 'real' }), { V3 } = env, T = env.window.THREE;
let part, collected = 0; const claims = new Map(), speech = [], ended = [];
V3.scene = { part(p) { part = p; } };
V3.R = { camera: { position: new T.Vector3(0, 2, 10) } };
V3.nav = { home: [0, 0], walkable: () => true, heightAt: () => 0, path: (a, b) => [[b[0], b[1]]], randomPoint: () => [4, 4] };
V3.bubble = { say(id, text) { speech.push(text); return true; }, hide() {} };
V3.game = { S: { girlAuto: false }, st: { beach: [{ id: 's1', x: 3, z: 0, at: 0 }] }, free() { return this.st.beach.filter(b => !claims.has(b.id)); }, claim(id, who) { if (claims.has(id)) return false; claims.set(id, who); return true; }, claimedBy: id => claims.get(id), unclaim: id => claims.delete(id), collect() { collected++; return {}; } };
function body() {
  const root = new T.Group(), bones = {};
  for (const name of ['hips', 'head', 'armR', 'armL', 'chest', 'legL', 'legR', 'shinL', 'shinR']) { const b = bones[name] = new T.Bone(); b.position.set(name === 'legL' ? .1 : name === 'legR' ? -.1 : 0, name === 'head' ? 1 : name.startsWith('leg') ? .4 : 0, 0); b.userData.rest = b.position.clone(); root.add(b); }
  return { id: 'test-body', root, bones, noOverlay: true, noUmbrella: true, headTop: new T.Vector3(0, .2, 0), states: { pose: { value: 'stand' }, expr: { value: 'happy' } }, update() { Object.values(bones).forEach(b => b.rotation.set(0, 0, 0)); }, dispose() {} };
}
V3.ysmUI = { initialBody: () => ({ id: 'test:model', builder: body }) }; env.load('65-girl-actor');
const scene = new T.Group();
function reset() { if (V3.actor) part.dispose(); scene.clear(); claims.clear(); collected = 0; speech.length = 0; ended.length = 0; part.build({ rng: () => () => .2 }).forEach(o => scene.add(o)); V3.actor.hold(false); return V3.actor; }
function step(s) { for (let i = 0; i < Math.ceil(s * 10); i++) part.update(.1); }
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
await check('poke stops goto immediately and settles promise false', async () => { const a = reset(), pending = a.goto(5, 0); step(.5); assert.ok(a._dbg.v > 0); const p = a.pos; assert.ok(a.poke()); assert.equal(await pending, false); assert.equal(a._dbg.v, 0); step(1); assert.deepEqual(a.pos, p); assert.equal(a.state, 'respond'); assert.ok(speech.length); });
await check('poke releases shell claim without collecting', () => { const a = reset(); assert.ok(a.collect('s1')); assert.equal(claims.get('s1'), 'girl'); a.poke(); step(2); assert.equal(claims.size, 0); assert.equal(a._dbg.task, null); assert.equal(collected, 0); });
await check('cooldown ignores spam without extending stop; repeated lines vary', () => { const a = reset(); a.poke(); const t = a._dbg.attention; for (let i = 0; i < 5; i++) assert.equal(a.poke(), false); assert.equal(a._dbg.attention, t); step(.7); a.poke(); const text = speech.at(-1); step(.7); a.poke(); assert.notEqual(speech.at(-1), text); step(3.3); assert.notEqual(a.state, 'respond'); step(6); assert.ok(a.state === 'wander' || a.state === 'idle'); assert.equal(a._dbg.manual, false); });
await check('manual intent retained, face camera and arrange rejects poke', () => { const a = reset(); V3.viewTokens.girl('idle'); a.poke(); step(1); const p = a.pos, want = Math.atan2(-p[0], 10 - p[2]); assert.ok(Math.abs(a.yaw - want) < .03); step(4); assert.equal(a._dbg.manual, true); a.hold(true); assert.equal(a.poke(), false); assert.equal(a.respond('no'), false); a.hold(false); });
await check('response rejects unbounded delays and resumes weather avoidance', () => { const a = reset(); a.respond('hi', { seconds: Infinity }); assert.equal(a._dbg.attention, 12); a.respond('hi', { seconds: 1 }); V3.wx = { now: () => ({ storm: 1 }) }; step(1.2); assert.equal(a.state, 'shelter'); delete V3.wx; });
await check('sit bends thighs and follows rocking hip anchor exactly', () => { const a = reset(), back = a.pos; let target = { position: [2, .6, 2], yaw: .5, tilt: .1 }; assert.ok(a.sit({ ...target, anchor: () => target, seconds: 20, onEnd: r => ended.push(r) })); step(.1); const hip = () => a.inst.bones.legL.getWorldPosition(new T.Vector3()).add(a.inst.bones.legR.getWorldPosition(new T.Vector3())).multiplyScalar(.5); assert.ok(hip().distanceTo(new T.Vector3(...target.position)) < 1e-8); assert.equal(a.inst.bones.legL.rotation.x, -Math.PI / 2); target = { position: [2, .65, 2.05], yaw: .7, tilt: -.1 }; step(.2); assert.ok(hip().distanceTo(new T.Vector3(...target.position)) < 1e-8); assert.equal(a.state, 'furniture'); a.poke(); assert.equal(a.state, 'furniture', 'poke keeps her seated'); assert.equal(ended.length, 0, 'poke does not end the seat'); assert.ok(speech.length, 'she still reacts'); });
await check('seat exits on timeout, hold, body swap and disposal exactly once', () => { for (const action of ['timeout', 'arrange', 'body-change', 'dispose']) { const a = reset(), back = a.pos; a.sit({ position: [2, .6, 2], seconds: 1, onEnd: r => ended.push(r) }); if (action === 'timeout') step(1.1); if (action === 'arrange') a.hold(true); if (action === 'body-change') a.useBody('imported', body); if (action === 'dispose') part.dispose(); assert.deepEqual(ended, [action]); if (V3.actor) { assert.deepEqual(a.pos, back); a.hold(false); assert.equal(a.root.userData.clickable, 'girl'); } } });
await check('bad seat data or no actual leg bones cannot claim seating', () => { const a = reset(); assert.equal(a.sit({ position: [NaN, 0, 0] }), false); const b = a.inst.bones.legL; b.removeFromParent(); assert.equal(a.sit({ position: [2, 1, 2] }), false); });
part.dispose();
console.log('PASS ' + checks + ' pure actor interaction regressions');
const u = process.argv.indexOf('--url');
const server = process.argv.includes('--browser') ? await serveFiles({ '/cabin.html': path.join(WEB_DIR, 'dist/cabin.html') }) : null;
if (u >= 0 || server) {
  const browser = await launchBrowser({ width: 1280, height: 900 });
  const out = path.resolve(WEB_DIR, '../tmp/recovery-20261109/actor-poke'); fs.mkdirSync(out, { recursive: true });
  try {
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    const url = new URL(server ? server.url + '/cabin.html' : process.argv[u + 1]); url.searchParams.set('live', '0'); url.searchParams.set('time', 'noon'); url.searchParams.set('wx', 'clear');
    await page.goto(url.href, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__READY && V3.actor, { timeout: 120000 });
    await page.evaluate(async () => { await V3.houseBlocks.ready; await V3.houseBlocks.live().ready; window.pokeEvents = []; V3.on('actor:poke', e => pokeEvents.push(e)); window.importModel = V3.actor.inst.model; V3.game.set('girlAuto', false); });
    async function prep() {
      await page.evaluate(async () => { await V3.view('girl=at_0_4_0'); V3.R.ctl.set({ az: 0, el: .15, dist: 3.5, target: [0, .65, 4] }, false); V3.actor.respond('', { seconds: 1 }); });
      await page.waitForFunction(() => V3.actor._dbg.attention === 0, { timeout: 6000 });
    }
    async function point() { return page.evaluate(() => { const p = V3.actor.head().add(new THREE.Vector3(0, -.4, 0)).project(V3.R.camera), r = V3.R.canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }); }
    async function clickGirl() { const p = await point(); await page.mouse.click(p.x, p.y); }
    const count = () => page.evaluate(() => pokeEvents.length);
    for (const type of ['default', 'loose', 'imported']) {
      if (type === 'loose') {
        await page.evaluate(() => V3.ysmUI.choose('builtin:blue-whale-maid-loose'));
        await page.waitForFunction(() => V3.actor.bodyId === 'builtin:blue-whale-maid-loose');
      }
      if (type === 'imported') await page.evaluate(() => V3.actor.useBody('imported-test', () => V3.ysm.build(importModel, { height: 1.25, anchor: 'girl:' })));
      await prep(); const n = await count(); await clickGirl();
      assert.equal(await count(), n + 1, type + ' actual pointer hits actor');
      assert.equal(await page.evaluate(() => V3.actor.state), 'respond');
      assert.ok(await page.evaluate(() => V3.bubble.list().length > 0));
      await page.screenshot({ path: path.join(out, type + '-poke.png') });
      await page.evaluate(() => { window.seatBack = V3.actor.pos; window.seatEnds = []; V3.actor.sit({ position: [0, .6, 4], yaw: .3, seconds: 20, anchor: () => ({ position: [0, .6, 4], yaw: .3, tilt: .08 }), onEnd: r => seatEnds.push(r) }); V3.R.ctl.set({ az: 1.1, el: .12, dist: 3.2, target: [0, 1, 4] }, false); });
      await page.evaluate(() => V3.nextFrames(8));
      const seated = await page.evaluate(() => { const a = V3.actor, b = a.inst.bones, p = b.legL.getWorldPosition(new THREE.Vector3()).add(b.legR.getWorldPosition(new THREE.Vector3())).multiplyScalar(.5); const forward = new THREE.Vector3(0, 0, 1).transformDirection(a.root.matrixWorld), downLeg = new THREE.Vector3(0, -1, 0).transformDirection(b.legL.matrixWorld); return { state: a.state, err: p.distanceTo(new THREE.Vector3(0, .6, 4)), thigh: b.legL.rotation.x, forward: forward.dot(downLeg) }; });
      assert.equal(seated.state, 'furniture'); assert.ok(seated.err < 1e-5); assert.equal(Math.abs(seated.thigh), Math.PI / 2); assert.ok(seated.forward > .9, type + ' thighs extend forward, not behind skirt');
      await page.screenshot({ path: path.join(out, type + '-seat.png') });
      await page.evaluate(() => V3.actor.stand()); assert.deepEqual(await page.evaluate(() => V3.actor.pos), await page.evaluate(() => seatBack));
      console.log('PASS browser ' + type + ' poke/seat/stand');
    }
    await prep(); let n = await count(); const p = await point();
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 35, p.y); await page.mouse.move(p.x, p.y); await page.mouse.up(); assert.equal(await count(), n, 'returning drag is not a poke');
    await prep();
    await page.evaluate(() => { const a = V3.actor, c = V3.R.camera.position, p = a.head().add(new THREE.Vector3(0, -.4, 0)); window.pokeWall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .08), new THREE.MeshBasicMaterial({ color: 0x888888 })); pokeWall.position.copy(p).lerp(c, .25); pokeWall.lookAt(c); V3.R.scene.add(pokeWall); });
    await page.evaluate(() => V3.nextFrames(3)); await clickGirl(); assert.equal(await count(), n, 'opaque wall prevents poke');
    await page.evaluate(() => { V3.R.scene.remove(pokeWall); pokeWall.geometry.dispose(); pokeWall.material.dispose(); });
    await page.evaluate(() => { window.savedArrange = V3.arrange; V3.arrange = { on: true }; }); await clickGirl(); assert.equal(await count(), n, 'arrange gate prevents poke'); await page.evaluate(() => V3.arrange = savedArrange);
    await prep();
    await page.evaluate(() => { V3.game.washNow(1); V3.actor.collect(); });
    await clickGirl();
    assert.equal(await count(), n + 1); assert.equal(await page.evaluate(() => V3.actor._dbg.task), null); assert.equal(await page.evaluate(() => V3.actor._dbg.v), 0);
    // Default west-facing rocker: actual pointer, short approach, moving anchor, automatic stand.
    await page.evaluate(async () => {
      V3.furniturePlay.close(); V3.actor.stand(); V3.actor.useBody('default', V3.ysmUI.initialBody().builder);
      await V3.view('floor=ground');
      window.rocker = V3.furniturePlay.state().items.find(r => r.kind === 'rocker');
      const r = rocker, f = V3.furnMc.rotate([0, 0, -1], r.facing);
      await V3.view('girl=at_-3.5_-7.5_0_1');
      V3.R.ctl.set({ az: -.7, el: .9, dist: 4.5, target: [r.cell[0] + .5, r.cell[1] + .65, r.cell[2] + .5] }, false);
    });
    await page.evaluate(() => V3.nextFrames(5));
    const chairPoint = () => page.evaluate(() => { const o = V3.furniturePlay.candidates().find(o => o.userData.furnitureKey === rocker.key), p = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).project(V3.R.camera), r = V3.R.canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; });
    let cp = await chairPoint();
    await page.screenshot({ path: path.join(out, 'rocker-before-click.png') });
    console.log('rocker navigation', await page.evaluate(() => { const r = rocker, f = V3.furnMc.rotate([0,0,-1], r.facing), a = V3.actor.pos; return [1.05,1.4].map(d => { const p = [r.cell[0]+.5+f[0]*d,r.cell[2]+.5+f[2]*d,r.cell[1]]; return { target:p, walkable:V3.nav.walkable(...p), path:V3.nav.path([a[0],a[2],a[1]],p) }; }); }));
    await page.mouse.click(cp.x, cp.y);
    assert.equal(await page.evaluate(() => V3.furniturePlay.state().selected), await page.evaluate(() => rocker.key), 'actual chair click opens rocker');
    await page.waitForFunction(() => V3.actor.state === 'furniture', { timeout: 12000 }).catch(async e => { console.log('rocker approach failure', await page.evaluate(() => ({ actor: V3.actor.pos, dbg: V3.actor._dbg, rocker: V3.furniturePlay.state(), status: document.querySelector('.fp-status')?.textContent, body: document.body.innerText.slice(-600) }))); throw e; });
    await page.evaluate(() => V3.nextFrames(8));
    const align = await page.evaluate(() => { const a = V3.actor, b = a.inst.bones, o = V3.furniturePlay.candidates().find(o => o.userData.furnitureKey === rocker.key), target = o.parent.localToWorld(new THREE.Vector3(0, -.28, -.02)), hip = b.legL.getWorldPosition(new THREE.Vector3()).add(b.legR.getWorldPosition(new THREE.Vector3())).multiplyScalar(.5); return { error: target.distanceTo(hip), yaw: a.yaw, tilt: a.root.rotation.x, seated: a._dbg.seated }; });
    assert.ok(align.error < .01, 'rocking chair hip anchor tracks within 1cm'); assert.ok(align.seated);
    await page.screenshot({ path: path.join(out, 'rocker-seated.png') });
    await page.waitForFunction(() => !V3.actor._dbg.seated, { timeout: 25000 });
    assert.equal(await page.evaluate(() => V3.furniturePlay.state().items.find(r => r.key === rocker.key).sitting), false);
    console.log('PASS real rocker click, approach, seat anchor, 20-second automatic stand');
    cp = await chairPoint(); await page.mouse.click(cp.x, cp.y);
    await page.waitForFunction(() => V3.actor.state === 'furniture', { timeout: 12000 }).catch(async e => { console.log('rocker approach failure', await page.evaluate(() => ({ actor: V3.actor.pos, dbg: V3.actor._dbg, rocker: V3.furniturePlay.state(), status: document.querySelector('.fp-status')?.textContent, body: document.body.innerText.slice(-600) }))); throw e; });
    const beforePoke = await count(); await clickGirl(); assert.equal(await count(), beforePoke + 1, 'seated actor can be poked');
    assert.equal(await page.evaluate(() => V3.actor._dbg.seated), false);
    assert.equal(await page.evaluate(() => V3.furniturePlay.state().items.find(r => r.key === rocker.key).sitting), false);
    await page.screenshot({ path: path.join(out, 'rocker-poke-stand.png') });
    assert.deepEqual(errors, []);
    const report = { pass: true, build: await page.evaluate(() => window.__V3_BUILD), pokeEvents: await count(), errors };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log('PASS real browser poke gates', report);
  } finally { await browser.close(); if (server) await server.close(); }
}