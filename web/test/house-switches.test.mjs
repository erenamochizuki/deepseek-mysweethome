import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { WEB_DIR, launchBrowser } from '../tools/mc-lib.mjs';

async function fixture() {
  const h = loadV3(['15-mcmodel', '16-mcmesh', '17-mcfallback'], { three: 'real' });
  const V = h.V3, T = h.window.THREE;
  V.layout = { house: { x0: -3, x1: 11, z0: -3, z1: 6, floorY: 0, loftY: 4, eaveY: 7, stand: [0, 0, 0] }, openings: [] };
  V.R = { camera: { position: new T.Vector3(12, 8, 12) } };
  const size = [8, 4, 3], cells = new Int32Array(96), palette = ['minecraft:air',
    'minecraft:oak_door[facing=north,half=lower,hinge=left,open=true,powered=false]',
    'minecraft:oak_door[facing=north,half=upper,hinge=left,open=true,powered=false]',
    'minecraft:lantern[hanging=true,waterlogged=false]', 'minecraft:stone'];
  for (const x of [1, 5]) { cells[x + 8] = 1; cells[x + 8 + 24] = 2; }
  for (const x of [2, 6]) { cells[x + 8 + 48] = 3; cells[x + 8 + 72] = 4; }
  const model = { size, cells, palette, offset: [0, 0, 0] };
  V.houseMc = { build: () => ({ model }) };
  h.load(['50-scene', '54-house-mc']);
  V.houseBlocks.store.get = async () => null;
  V.scene.fallbackK = 1;
  const root = new T.Group(), ctx = V.scene.ctx(root), part = V.scene.parts.find(p => p.id === 'house');
  const house = part.build(ctx); root.add(house); await house.userData.houseMc.ready;
  assert.equal(V.houseBlocks.error, null);
  return { ...h, V, T, root, ctx, part, HB: V.houseBlocks, model, me: house.userData.houseMc };
}

test('two paired doors switch independently, imported open state does not corrupt closed mesh or whale model', async () => {
  const h = await fixture(), { HB, model, me } = h;
  const before = JSON.stringify({ palette: model.palette, cells: Array.from(model.cells) });
  const doors = HB.interactions().filter(s => s.kind === 'door');
  assert.equal(doors.length, 2); assert.deepEqual(doors.map(d => d.cell), [[1, 0, 1], [5, 0, 1]]);
  assert.equal(me.doors[0].cells.length, 2);
  HB.setDoor(doors[0].key, 'open');
  assert.equal(me.doors[0].open.visible, true); assert.equal(me.doors[0].closed.visible, false);
  assert.equal(me.doors[1].open.visible, false); assert.equal(me.doors[1].closed.visible, true);
  HB.setDoor(doors[0].key, 'closed');
  assert.equal(HB.switchState(doors[0].key).open, false);
  assert.equal(JSON.stringify({ palette: model.palette, cells: Array.from(model.cells) }), before);
  assert.equal(HB.setDoor(doors[0].key, 'bad'), null);
  assert.equal(HB.toggleLamp(doors[0].key), null);
  assert.equal(HB.switchState('missing'), null);
  h.part.dispose();
});

test('manual closed door yields safely near actor and closes after actor leaves, auto keeps hysteresis', async () => {
  const h = await fixture(), { HB, V, me } = h, key = HB.interactions()[0].key;
  HB.setDoor(key, 'closed');
  V.actor = { pos: [1.5, 0, 2.8] }; me.tick();
  assert.equal(HB.switchState(key).yielding, true); assert.equal(HB.switchState(key).open, true);
  V.actor.pos = [1.5, 0, 3.3]; me.tick(); assert.equal(HB.switchState(key).open, true);
  V.actor.pos = [1.5, 0, 4]; me.tick(); assert.equal(HB.switchState(key).open, false);
  assert.equal(HB.switchState(key).mode, 'closed');
  HB.setDoor(key, 'auto'); V.actor.pos = [1.5, 4, 1.5]; me.tick(); assert.equal(HB.switchState(key).open, false, 'other storey does not open door');
  V.actor.pos = [1.5, 0, 1.5]; me.tick(); assert.equal(HB.switchState(key).open, true);
  assert.equal(HB.switchState(key).yielding, false);
  h.part.dispose();
});

test('individual lamps stay off through day/night updates; cutaway hides unsupported lantern but retains illumination', async () => {
  const h = await fixture(), { HB, ctx, me, V } = h, [a, b] = me.lanterns;
  HB.toggleLamp(a.key); ctx.tickLights();
  assert.equal(HB.switchState(a.key).enabled, false); assert.equal(a.light.intensity, 0);
  for (const m of Object.values(a.g.userData.mats)) assert.equal(m.emissiveIntensity, 0);
  assert.ok(b.light.intensity > 0);
  for (const k of [0, 0.4, 1]) { V.scene.fallbackK = k; ctx.tickLights(); assert.equal(a.light.intensity, 0); }
  HB.toggleLamp(a.key); await me.setFloor('ground'); ctx.tickLights();
  assert.equal(a.g.visible, false, 'support at y3 is above ground cut y2');
  assert.ok(a.light.intensity > 0); assert.equal(a.light.parent, me.root);
  await me.setFloor('loft'); assert.equal(a.g.visible, true, 'ground ceiling still exists in loft view');
  await me.setFloor('all'); assert.equal(a.g.visible, true);
  h.part.dispose();
});

test('reload and rotation preserve runtime preferences with fresh objects, no leaked light/glow registration', async () => {
  const h = await fixture(), { HB, ctx, me, part } = h;
  const door = me.doors[0], lamp = me.lanterns[0], old = HB.interactions().flatMap(r => r.objects);
  HB.setDoor(door.key, 'open'); HB.toggleLamp(lamp.key);
  const counts = [ctx._lamps.length, ctx._glows.length];
  await me.reload();
  assert.deepEqual([ctx._lamps.length, ctx._glows.length], counts);
  assert.ok(old.every(o => !o.parent));
  assert.equal(HB.switchState(door.key).open, true); assert.equal(HB.switchState(lamp.key).enabled, false);
  const place = { dx: 10, dz: -7, k: 1 }, moved = HB.placeModel(h.model, place);
  part.dispose(); await HB.applyEdit(moved, { place, rebuild: false });
  const next = part.build(ctx); h.root.add(next); await next.userData.houseMc.ready;
  assert.equal(HB.switchState(door.key).mode, 'open'); assert.equal(HB.switchState(lamp.key).enabled, false);
  assert.notDeepEqual(HB.interactions().find(r => r.key === door.key).cell, door.cell);
  assert.deepEqual([ctx._lamps.length, ctx._glows.length], counts);
  part.dispose(); assert.equal(HB.interactions().length, 0);
  assert.deepEqual([ctx._lamps.length, ctx._glows.length], [0, 0]);
});

test('light budget is bounded, switching updates glow and nearest point-light slots; cut anchors survive hidden parent', () => {
  const h = loadV3(['50-scene'], { three: 'real' }), V = h.V3, T = h.window.THREE, root = new T.Group();
  V.scene.fallbackK = 1; V.R = { camera: { position: new T.Vector3() } };
  const ctx = V.scene.ctx(root), lights = Array.from({ length: 12 }, (_, i) => ctx.lamp({ pos: [i, 0, 0], switchable: true }));
  ctx.tickLights(); assert.equal(lights.filter(l => l.visible).length, V.scene.MAX_LAMPS);
  ctx.setLightEnabled(lights[0], false); assert.equal(lights[0].intensity, 0); assert.equal(lights[8].visible, true);
  for (const l of lights) ctx.releaseLamp(l);
  const anchor = new T.Group(); anchor.position.set(3, 4, 5); root.add(anchor);
  const l = ctx.lamp({ parent: anchor, pos: [0, 2, 0], keepWhenCut: true }), glow = ctx.glowMat(0xffffff);
  anchor.visible = false; ctx.tickLights();
  assert.deepEqual(l.position.toArray(), [3, 6, 5]); assert.ok(l.intensity > 0);
  ctx.setLightEnabled(glow, false); ctx.tickLights(); assert.equal(glow.emissiveIntensity, 0);
  ctx.releaseGlow(glow); ctx.releaseLamp(l); assert.deepEqual([ctx._lamps.length, ctx._glows.length], [0, 0]);
});

// Lead builds once, then supplies the existing page URL. This never builds or starts MC.
test('browser floor fixtures and real lamp click', { skip: !process.env.HOUSE_SWITCHES_URL }, async () => {
  const browser = await launchBrowser({ width: 1280, height: 900 });
  const out = path.resolve(WEB_DIR, '../tmp/recovery-20261109/house-switches'); fs.mkdirSync(out, { recursive: true });
  try {
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.HOUSE_SWITCHES_URL, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__READY && V3.furniturePlay.state().ready, { timeout: 120000 });
    await page.evaluate(async () => { await V3.houseBlocks.live().ready; V3.actor.hold(true); });
    const records = [];
    for (const floor of ['all', 'ground', 'loft', 'all']) {
      const state = await page.evaluate(async floor => {
        await V3.view('floor=' + floor + '+time=night+cam=16_14_8_0_3_-10'); await V3.nextFrames(4);
        const c = V3.models.current(), fixtures = [];
        c.root.traverse(o => { if (o.userData.ceilingFixture) fixtures.push({ layer: o.userData.ceilingFixture, visible: o.visible }); });
        const lamps = V3.houseBlocks.live().lanterns.map(l => ({ supported: !l.hanging || V3.houseBlocks.visibleAt(...l.support), fixture: l.g.visible, separate: l.light.parent !== l.g }));
        const cutLights = c.ctx._lamps.filter(l => l.userData.cutAnchor).map(l => ({ independent: l.parent === c.root, enabled: l.userData.lightEnabled !== false }));
        return { floor, fixtures, lamps, cutLights, lights: c.ctx._lamps.filter(l => l.visible && l.intensity > 0).length };
      }, floor);
      assert.ok(state.fixtures.some(o => o.layer === 'loft'));
      for (const o of state.fixtures) assert.equal(o.visible, floor === 'all' || (floor === 'loft' && o.layer === 'ground'));
      for (const l of state.lamps) { assert.ok(l.separate); if (floor !== 'all' && !l.supported) assert.equal(l.fixture, false); }
      assert.ok(state.cutLights.length); assert.ok(state.cutLights.every(l => l.independent && l.enabled));
      assert.ok(state.lights > 0); records.push(state);
      await page.screenshot({ path: path.join(out, floor + '-night.png') });
    }
    const target = await page.evaluate(async () => {
      const item = V3.houseBlocks.interactions().find(s => s.kind === 'lamp'), o = item.objects[0];
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      await V3.view('floor=all+cam=' + [c.x, c.y + .25, c.z + 1.3, c.x, c.y, c.z].join('_')); await V3.nextFrames(4);
      const p = c.clone().project(V3.R.camera), r = V3.R.canvas.getBoundingClientRect();
      return { key: item.key, x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2, before: V3.houseBlocks.switchState(item.key).enabled };
    });
    await page.mouse.click(target.x, target.y);
    await page.waitForFunction(({ key, before }) => V3.houseBlocks.switchState(key).enabled !== before, { timeout: 5000 }, target);
    assert.equal(await page.evaluate(k => V3.houseBlocks.live().lanterns.find(l => l.key === k).light.intensity, target.key), 0);
    await page.screenshot({ path: path.join(out, 'lamp-off.png') });
    await page.click('[aria-label="关闭家具面板"]');
    const door = await page.evaluate(async () => {
      const item = V3.houseBlocks.interactions().find(s => s.kind === 'door');
      V3.houseBlocks.setDoor(item.key, 'closed');
      const o = V3.houseBlocks.live().doors.find(d => d.key === item.key).closed;
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      await V3.view('cam=' + [c.x, c.y + .2, c.z + 1.3, c.x, c.y, c.z].join('_')); await V3.nextFrames(4);
      const p = c.clone().project(V3.R.camera), r = V3.R.canvas.getBoundingClientRect();
      return { key: item.key, x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 };
    });
    await page.mouse.click(door.x, door.y);
    await page.waitForFunction(key => V3.houseBlocks.switchState(key).mode === 'open', { timeout: 5000 }, door.key);
    await page.screenshot({ path: path.join(out, 'door-open.png') });
    assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.__errors || []), []);
    fs.writeFileSync(path.join(out, 'floor-results.json'), JSON.stringify(records, null, 2));
  } finally { await browser.close(); }
});
