// A3 逐帧开销 #5 — per-frame no-op work in 69-furniture-play.js (switch snapshots, idle cooker state, TV repaint
// while off, idle autosave) and 50-scene.js (tickLights / cutaway garbage).
// Source-only: no build, no browser, no server.   node --test test/a3-tick-churn.test.mjs
// A3_SRC_DIR=<dir> loads the modules from another src directory (used once to confirm these fail on the old files).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const SRC = process.env.A3_SRC_DIR ? { srcDir: path.resolve(process.env.A3_SRC_DIR) } : {};
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
// Bytes left on the heap by n calls, after a warm-up long enough for the optimising compiler and a full collection.
function heapGrowth(fn, n) {
  for (let i = 0; i < 20000; i++) fn();
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < n; i++) fn();
  return process.memoryUsage().heapUsed - before;
}
const fakeStore = (initial = {}) => ({
  data: new Map(Object.entries(initial)), sets: [],
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; },
  setItem(k, v) { this.sets.push([k, String(v)]); this.data.set(k, String(v)); },
});
const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

// ---------------------------------------------------------------------------------------------------------------
// 69-furniture-play: one TV + one cooker on a mock house (same harness idea as furniture-hover-targets.test.mjs)
// ---------------------------------------------------------------------------------------------------------------
const TV = 'tv:0,0,0', COOKER = 'cooker:3,0,0';
async function play({ stored, live } = {}) {
  const ops = [];   // every fillRect: [fillStyle, x, y, w, h]
  const paint = { fillStyle: '', font: '', fillRect(x, y, w, h) { ops.push([this.fillStyle, x, y, w, h]); }, fillText() {} };
  const store = fakeStore(stored);
  const h = loadV3([], { three: 'real', document: { createElement: () => ({ getContext: () => paint }) }, globals: { localStorage: store }, ...SRC });
  const V = h.V3, T = h.window.THREE;
  V.scene = { part: p => { V.part = p; } };
  V.furnMc = { cellsFor: () => [{ offset: [0, 0, 0], part: null }], state: (f, face) => f.block + '[facing=' + face + ']', FACING_Y: { north: 0 } };
  const root = new T.Group(), tv = new T.Group(), cooker = new T.Group();
  for (const [o, kind, cell] of [[tv, 'tv', [0, 0, 0]], [cooker, 'kitchen', [3, 0, 0]]]) { Object.assign(o.userData, { furn: kind, cell, facing: 'north' }); o.position.set(...cell); root.add(o); }
  const screen = new T.Mesh(new T.PlaneGeometry(0.7, 0.4), new T.MeshStandardMaterial()); screen.name = 'screen'; tv.add(screen);
  const calls = { interactions: 0 };
  const HB = V.houseBlocks = {
    model: { size: [1, 1, 1], offset: [0, 0, 0], cells: [0], palette: ['air'] }, visibleAt: () => true, switchState: () => ({}),
    // same shape as 54-house-mc's HB.interactions(): a fresh copy of every live switch
    interactions: () => { calls.interactions++; const lv = live && !live.dead ? live : null; return lv ? [...lv.doors, ...lv.lanterns].map(s => ({ key: s.key, kind: s.kind, cell: s.cell.slice(), objects: s.objects.slice() })) : []; },
    // 2026-11-14：69 也查望远镜（telescope）了；这个假房子只有电视和厨房台面
    furnInstances: block => block === 'rocking_chair' || block === 'telescope' ? [] : [{ f: { block }, block, cell: block === 'tv_stand' ? [0, 0, 0] : [3, 0, 0], facing: 'north' }],
    meshFor: async () => { const g = new T.Group(); g.add(new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial())); return g; },
    disposeGroup: g => g.traverse(o => o.geometry && o.geometry.dispose()),
  };
  if (live) HB.live = () => live;
  h.load(['69-furniture-play']);
  const F = V.furniturePlay, ctx = { root, _waits: [], wait: p => ctx._waits.push(p) };
  root.add(V.part.build(ctx)); await Promise.all(ctx._waits);
  assert.equal(F.state().ready, true);
  const reduceCalls = []; const reduce = F.reduce;
  F.reduce = (kind, state, action, dt) => { reduceCalls.push(action); return reduce(kind, state, action, dt); };
  let time = 0;   // mirrors the part's own clock (it adds dt the same way)
  const tick = (dt = 1 / 60) => { time += dt; V.part.update(dt, time); };
  const run = (seconds, dt = 1 / 60) => { for (let i = 0, n = Math.round(seconds / dt); i < n; i++) tick(dt); };
  const item = key => F.state().items.find(r => r.key === key);
  return { h, V, T, F, HB, root, ctx, screen, cooker, store, ops, calls, reduceCalls, pure: reduce, tick, run, item, clock: () => time, key: F.houseKey(HB.model) };
}
const DEFAULTS = JSON.stringify({ [TV]: { on: false, channel: 0 }, [COOKER]: { phase: 'idle', remaining: 0, bowl: false } });

test('idle autosave: nothing is written to localStorage once the stored text matches the state', async () => {
  const a = await play();
  a.run(60);
  assert.deepEqual(a.store.sets, [[a.key, DEFAULTS]], 'empty storage: the normalised state is written once, at the first 5 s check');
  a.run(120);
  assert.equal(a.store.sets.length, 1, 'no further writes while nothing changes (the old code wrote every 5 s)');

  const b = await play({ stored: { [a.key]: DEFAULTS } });
  b.run(120);
  assert.deepEqual(b.store.sets, [], 'returning player, state already stored: no write at all while idle');

  const tvOn = JSON.stringify({ [TV]: { on: true, channel: 2 }, [COOKER]: { phase: 'ready', remaining: 0, bowl: true } });
  const c = await play({ stored: { [a.key]: tvOn } });
  assert.deepEqual(c.item(TV).state, { on: true, channel: 2 }); assert.deepEqual(c.item(COOKER).state, { phase: 'ready', remaining: 0, bowl: true });
  c.run(60);
  assert.deepEqual(c.store.sets, [], 'TV on + rice ready is still an unchanged state: no write');

  const d = await play({ stored: { [a.key]: '{"' + TV + '":{"on":"yes","channel":9}}' } });
  d.run(6);
  assert.deepEqual(d.store.sets, [[a.key, DEFAULTS]], 'stored text that normalises to something else is rewritten once, as before');
  d.run(60); assert.equal(d.store.sets.length, 1);
});

test('changes are still saved at once, cooking progress every 5 s, and pagehide / dispose always flush', async () => {
  const a = await play({ stored: {} }), { F, store } = a, last = () => JSON.parse(store.sets.at(-1)[1]);
  assert.equal(F.action(TV, 'toggle'), true);
  assert.equal(store.sets.length, 1); assert.deepEqual(last()[TV], { on: true, channel: 0 });
  assert.equal(F.action(TV, 'next'), true);
  assert.equal(store.sets.length, 2); assert.deepEqual(last()[TV], { on: true, channel: 1 });
  assert.equal(F.action(COOKER, 'serve'), false, 'an action that changes nothing does not write');
  assert.equal(store.sets.length, 2);
  assert.equal(F.action(COOKER, 'cook'), true);
  assert.equal(store.sets.length, 3); assert.deepEqual(last()[COOKER], { phase: 'cooking', remaining: 30, bowl: false });

  a.run(12);   // autosave checks fall after 5 s and 10 s of part time: cooking progress is written at both
  assert.equal(store.sets.length, 5);
  assert.ok(Math.abs(last()[COOKER].remaining - 20) < 0.2, 'second autosave holds ~20 s left: ' + last()[COOKER].remaining);

  a.h.window.dispatchEvent(new Event('pagehide'));
  assert.equal(store.sets.length, 6, 'pagehide flushes');
  assert.ok(Math.abs(last()[COOKER].remaining - 18) < 0.2, 'the flush holds the progress since the last autosave');
  a.h.window.dispatchEvent(new Event('pagehide'));
  assert.equal(store.sets.length, 7, 'pagehide writes even when nothing changed since the last write (unchanged flush semantics)');

  a.run(19);   // rice ready at 30 s: written the moment the phase changes
  assert.equal(a.item(COOKER).state.phase, 'ready');
  assert.deepEqual(last()[COOKER], { phase: 'ready', remaining: 0, bowl: false });
  const n = store.sets.length;
  a.run(60);
  assert.equal(store.sets.length, n, 'rice kept warm is an unchanged state: no more writes');
  a.V.part.dispose(a.ctx);
  assert.equal(store.sets.length, n + 1, 'dispose flushes');
  assert.deepEqual(last(), { [TV]: { on: true, channel: 1 }, [COOKER]: { phase: 'ready', remaining: 0, bowl: false } });
});

test('a failed write is retried at the next 5 s check and warns once', async () => {
  const a = await play({ stored: {} }), toasts = []; let fail = true, tries = 0;
  a.V.hud = { toast: t => toasts.push(t) };
  const real = a.store.setItem.bind(a.store);
  a.store.setItem = (k, v) => { tries++; if (fail) throw new Error('quota'); real(k, v); };
  assert.equal(a.F.action(TV, 'toggle'), true); assert.equal(tries, 1);
  a.run(11); assert.equal(tries, 3, 'retried at both autosave checks'); assert.equal(toasts.length, 1);
  fail = false; a.run(5);
  assert.equal(JSON.parse(a.store.sets.at(-1)[1])[TV].on, true);
  const n = tries; a.run(30); assert.equal(tries, n, 'stored now: no more attempts');
});

test('TV that is off: painted once, then neither repainted nor re-uploaded; on / off picture and cadence unchanged', async () => {
  const a = await play(), { F, ops, screen } = a, tex = screen.material.map, mat = screen.material;
  assert.ok(tex && tex.isCanvasTexture);
  assert.deepEqual(ops, [['#12171e', 0, 0, 192, 96]], 'build paints the off screen once');
  const v0 = tex.version;
  a.run(10);   // 60 frame changes at 6 Hz
  assert.equal(ops.length, 1, 'no canvas repaint while off'); assert.equal(tex.version, v0, 'no texture upload while off');
  assert.deepEqual(mat.userData.glow, { day: 0, night: 0 });

  // on: one paint when switched on, then exactly one per 6 Hz frame change (same gating as before)
  let drawn = Math.floor(a.clock() * 6), expected = 1; const before = tex.version, first = ops.length;
  assert.equal(F.action(TV, 'toggle'), true);
  assert.equal(tex.version, before + 1, 'switching on repaints at once'); assert.deepEqual(ops[first], ['#69afce', 0, 0, 192, 96]);
  assert.deepEqual(mat.userData.glow, { day: 0.65, night: 0.45 });
  for (let i = 0; i < 300; i++) { a.tick(); const f = Math.floor(a.clock() * 6); if (f !== drawn) { drawn = f; expected++; } }
  assert.equal(tex.version - before, expected); assert.ok(expected >= 30 && expected <= 32, 'about 6 repaints a second: ' + expected);
  F.action(TV, 'next'); assert.equal(tex.version - before, expected + 1, 'changing channel repaints at once');
  assert.deepEqual(a.item(TV).state, { on: true, channel: 1 });

  // off again: the dark picture is painted exactly once, then nothing
  const n = ops.length, v1 = tex.version;
  assert.equal(F.action(TV, 'toggle'), true);
  assert.deepEqual(ops.slice(n), [['#12171e', 0, 0, 192, 96]], 'turning off draws the off picture once');
  assert.equal(tex.version, v1 + 1); assert.deepEqual(mat.userData.glow, { day: 0, night: 0 });
  assert.equal(mat.color.getHex(), 0xffffff); assert.equal(mat.emissive.getHex(), 0xffffff);
  a.run(10);
  assert.equal(ops.length, n + 1); assert.equal(tex.version, v1 + 1);
});

test('idle / ready cooker is not reduced every frame; cooking time, pause and steam are unchanged', async () => {
  const a = await play({ stored: {} }), { F, V, reduceCalls, cooker } = a;
  const steam = cooker.children.find(o => o.isGroup && o.children.length === 5);
  a.run(10);
  assert.equal(reduceCalls.filter(x => x === 'tick').length, 0, 'idle: no per-frame state object');
  assert.equal(steam.visible, false);

  assert.equal(F.action(COOKER, 'cook'), true);
  assert.equal(steam.visible, true); assert.ok(steam.children.every(o => o.position.y >= 1 && o.material.opacity > 0), 'steam is placed by the same call that shows it');
  // oracle: the reducer itself, fed the same dt sequence
  let want = { phase: 'cooking', remaining: 30, bowl: false }, ticks = 0;
  while (want.phase === 'cooking' && ticks < 5000) { want = a.pure('cooker', want, 'tick', 1 / 60); a.tick(); ticks++; assert.deepEqual(a.item(COOKER).state, want, 'tick ' + ticks); }
  assert.equal(want.phase, 'ready'); assert.ok(ticks >= 1799 && ticks <= 1801, 'ready after 30 s: ' + ticks + ' ticks');
  assert.equal(reduceCalls.filter(x => x === 'tick').length, ticks, 'cooking: one reduce per frame');
  assert.equal(steam.visible, true, 'kept warm: still steaming');

  const n = reduceCalls.length; a.run(10);
  assert.equal(reduceCalls.length, n, 'ready: no per-frame state object');
  assert.equal(F.action(COOKER, 'serve'), true); assert.equal(steam.visible, false);
  assert.ok(cooker.children.length > 0);

  // arrange mode pauses the timer but does not lose it
  assert.equal(F.action(COOKER, 'cook'), true); a.run(3);
  const left = a.item(COOKER).state.remaining; V.arrange = { on: true }; a.run(3);
  assert.equal(a.item(COOKER).state.remaining, left); assert.equal(a.item(COOKER).state.phase, 'cooking');
  V.arrange.on = false; a.run(1); assert.ok(a.item(COOKER).state.remaining < left);
});

test('saved cooking state with nothing left finishes on the first frame, even while paused', async () => {
  const key = (await play()).key;
  const a = await play({ stored: { [key]: JSON.stringify({ [COOKER]: { phase: 'cooking', remaining: 0, bowl: false } }) } });
  a.V.arrange = { on: true }; a.tick();
  assert.equal(a.item(COOKER).state.phase, 'ready');
});

test('switch snapshot is rebuilt only when the live doors / lanterns change, and then on the same frame (mock house)', async () => {
  const T0 = (await play()).T, obj = () => new T0.Group();
  const door = { key: 'door:a', kind: 'door', cell: [6, 0, 0], objects: [obj(), obj()] }, lamp = { key: 'lamp:a', kind: 'lamp', cell: [8, 0, 0], objects: [obj()] };
  const live = { dead: false, doors: [door], lanterns: [lamp] };
  const a = await play({ live }), { F, calls } = a, keys = () => F.state().items.filter(r => r.kind === 'door' || r.kind === 'lamp').map(r => r.key);
  for (const o of [...door.objects, ...lamp.objects]) a.root.add(o);
  assert.deepEqual(keys(), ['door:a', 'lamp:a']);
  const n0 = calls.interactions;
  a.run(5);
  assert.ok(calls.interactions - n0 <= 1, 'idle: at most the first frame builds a snapshot, got ' + (calls.interactions - n0));
  const sync = (what) => { const n = calls.interactions; a.tick(); assert.equal(calls.interactions, n + 1, what + ': synced on the next frame'); a.tick(); a.tick(); assert.equal(calls.interactions, n + 1, what + ': then idle again'); };

  const lamp2 = { key: 'lamp:b', kind: 'lamp', cell: [9, 0, 0], objects: [obj()] }; a.root.add(lamp2.objects[0]);
  live.lanterns.push(lamp2); sync('appended switch');
  assert.deepEqual(keys(), ['door:a', 'lamp:a', 'lamp:b']); assert.deepEqual(F.hoverObjects({ key: 'lamp:b' }), lamp2.objects);

  const fresh = [obj(), obj()]; for (const o of fresh) a.root.add(o);
  door.objects = fresh; sync('replaced object list');
  assert.deepEqual(F.hoverObjects({ key: 'door:a' }), fresh);
  assert.ok(fresh.every(o => o.userData.clickable === 'furniture' && o.userData.furnitureKey === 'door:a'));

  const door2 = { key: 'door:a', kind: 'door', cell: [6, 0, 0], objects: [obj()] }; a.root.add(door2.objects[0]);
  live.doors = [door2]; live.lanterns = []; sync('rebuilt arrays');
  assert.deepEqual(keys(), ['door:a']); assert.deepEqual(F.hoverObjects({ key: 'door:a' }), door2.objects);

  live.dead = true; sync('dead house');
  assert.deepEqual(keys(), []);
  assert.equal(F.state().items.length, 2, 'TV and cooker stay');
});

// ---------------------------------------------------------------------------------------------------------------
// 69-furniture-play on the real 50-scene + 54-house-mc (two doors, two lanterns): the cheap signature must follow
// what HB.interactions() really reports through reload and dispose.
// ---------------------------------------------------------------------------------------------------------------
async function realHouse() {
  const h = loadV3(['15-mcmodel', '16-mcmesh', '17-mcfallback'], { three: 'real', globals: { localStorage: fakeStore() }, ...SRC });
  const V = h.V3, T = h.window.THREE;
  V.layout = { house: { x0: -3, x1: 11, z0: -3, z1: 6, floorY: 0, loftY: 4, eaveY: 7, stand: [0, 0, 0] }, openings: [] };
  V.R = { camera: { position: new T.Vector3(12, 8, 12) } };
  const size = [8, 4, 3], cells = new Int32Array(96), palette = ['minecraft:air',
    'minecraft:oak_door[facing=north,half=lower,hinge=left,open=true,powered=false]',
    'minecraft:oak_door[facing=north,half=upper,hinge=left,open=true,powered=false]',
    'minecraft:lantern[hanging=true,waterlogged=false]', 'minecraft:stone'];
  for (const x of [1, 5]) { cells[x + 8] = 1; cells[x + 8 + 24] = 2; }
  for (const x of [2, 6]) { cells[x + 8 + 48] = 3; cells[x + 8 + 72] = 4; }
  V.houseMc = { build: () => ({ model: { size, cells, palette, offset: [0, 0, 0] } }) };
  h.load(['50-scene', '54-house-mc', '69-furniture-play']);
  V.houseBlocks.store.get = async () => null;
  V.scene.fallbackK = 1;
  const root = new T.Group(), ctx = V.scene.ctx(root), housePart = V.scene.parts.find(p => p.id === 'house'), playPart = V.scene.parts.find(p => p.id === 'furniture-play');
  const house = housePart.build(ctx); root.add(house); await house.userData.houseMc.ready;
  assert.equal(V.houseBlocks.error, null);
  root.add(playPart.build(ctx)); await Promise.all(ctx._waits);
  assert.equal(V.furniturePlay.state().ready, true);
  return { V, T, root, ctx, housePart, playPart, HB: V.houseBlocks, F: V.furniturePlay, me: house.userData.houseMc };
}

test('real house: idle frames build no switch snapshot; reload, dispose and switching are followed on the same frame', async () => {
  const h = await realHouse(), { HB, F, me, playPart } = h;
  let calls = 0; const real = HB.interactions; HB.interactions = () => { calls++; return real(); };
  const tick = () => playPart.update(1 / 60, 0);
  const same = () => {   // what furniture-play holds == what the house reports
    const want = real(), got = F.state().items;
    assert.deepEqual(got.map(r => [r.key, r.kind]), want.map(r => [r.key, r.kind]));
    for (const it of want) assert.deepEqual(F.hoverObjects({ key: it.key }), it.objects.filter(o => o.visible), it.key);
  };
  assert.equal(real().length, 4); same();
  for (let i = 0; i < 300; i++) tick();
  assert.ok(calls <= 1, 'idle: at most one snapshot in 300 frames, got ' + calls); same();

  const [door, , lamp] = real(), old = real().flatMap(r => r.objects);
  assert.equal(F.action(lamp.key, 'toggle'), true); assert.equal(HB.switchState(lamp.key).enabled, false, 'lamp answers in the same call');
  assert.equal(F.action(door.key, 'open'), true); assert.equal(HB.switchState(door.key).open, true);
  tick(); same();

  const reloading = me.reload();   // clears the switches now, rebuilds them asynchronously
  calls = 0; tick();
  assert.equal(calls, 1, 'cleared switches are noticed on the next frame'); assert.deepEqual(F.state().items, []);
  await reloading;
  calls = 0; tick();
  assert.equal(calls, 1, 'rebuilt switches are noticed on the next frame'); same();
  assert.ok(F.candidates().every(o => !old.includes(o)), 'no stale pick targets');
  assert.equal(HB.switchState(lamp.key).enabled, false, 'preferences survive the reload');
  calls = 0; for (let i = 0; i < 60; i++) tick(); assert.equal(calls, 0);

  h.housePart.dispose();
  calls = 0; tick(); assert.equal(calls, 1); assert.deepEqual(F.state().items, []);
  playPart.dispose(h.ctx);
});

// ---------------------------------------------------------------------------------------------------------------
// 50-scene: tickLights
// ---------------------------------------------------------------------------------------------------------------
// The implementation before this repair, kept as the oracle.
function oldTickLights(V3, T, ctx, root) {
  const SC = V3.scene, U = V3.util, lamps = ctx._lamps, glows = ctx._glows;
  const k = SC.lampK(), camera = V3.R && V3.R.camera, cp = camera && camera.position;
  for (const l of lamps) if (l.userData.cutAnchor) {
    const p = l.userData.cutAnchor.localToWorld(l.userData.cutPosition.clone());
    l.position.copy(root.worldToLocal(p));
  }
  const shown = (l) => { for (let p = l.parent; p; p = p.parent) if (!p.visible) return false; return true; };
  const active = lamps.filter(l => l.userData.lightEnabled !== false && l.userData.base > 0 && shown(l));
  if (cp && active.length > SC.MAX_LAMPS) {
    const pos = new T.Vector3(), distance = new Map(active.map(l => [l, l.getWorldPosition(pos).distanceToSquared(cp)]));
    active.sort((a, b) => distance.get(a) - distance.get(b));
  }
  const selected = new Set(active.slice(0, SC.MAX_LAMPS));
  for (const l of lamps) {
    l.visible = selected.has(l);
    l.intensity = l.visible ? l.userData.base * k * (ctx.studio ? 0.4 : 1) : 0;
  }
  for (const m of glows) m.emissiveIntensity = m.userData.lightEnabled === false ? 0 : U.lerp(m.userData.glow.day, m.userData.glow.night, k);
}
const lightState = (ctx) => ({ lamps: ctx._lamps.map(l => [l.visible, l.intensity, ...l.position.toArray()]), glows: ctx._glows.map(m => m.emissiveIntensity) });
function scramble(ctx) {
  for (const l of ctx._lamps) { l.visible = !l.visible; l.intensity = 123; if (l.userData.cutAnchor) l.position.set(99, 99, 99); }
  for (const m of ctx._glows) m.emissiveIntensity = -5;
}

test('tickLights picks exactly the lamps the old implementation picked (random scenes, ties, hidden parents, cut anchors)', () => {
  const h = loadV3(['50-scene'], { three: 'real', ...SRC }), V = h.V3, T = h.window.THREE;
  let compared = 0, overBudget = 0, ties = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed * 7919), int = (n) => Math.floor(r() * n), root = new T.Group();
    const grid = seed % 2 === 0;   // every other scene is unrotated on an integer grid: lamps exactly as far away as each other
    root.position.set(int(5) - 2, int(3), int(5) - 2); if (!grid) root.rotation.y = r() * 6;
    const ctx = V.scene.ctx(root, { studio: seed % 5 === 0 });
    const groups = [root];
    for (let i = 0; i < 6; i++) {
      const g = new T.Group(); g.position.set(int(7) - 3, int(3), int(7) - 3);
      if (!grid) { g.rotation.set(r(), r() * 6, 0); if (i % 3 === 2) g.scale.setScalar(0.5 + r()); }
      groups[int(groups.length)].add(g); groups.push(g);
    }
    const n = seed % 6 === 0 ? int(9) : 6 + int(18);   // some scenes stay within the budget
    for (let i = 0; i < n; i++) {
      const parent = groups[int(groups.length)], anchored = r() < 0.2 && parent !== root;
      // integer grid: many lamps are exactly as far from the camera as each other
      ctx.lamp({ pos: [int(4), int(2), int(4)], switchable: true, parent, keepWhenCut: anchored, intensity: r() < 0.1 ? 0 : 1 + int(3), enabled: r() >= 0.15 });
    }
    for (let i = 0; i < 4; i++) { const m = ctx.glowMat(0xffffff, { day: r(), night: 1 + r() }); if (i === 3) m.userData.lightEnabled = false; }
    const camera = { position: new T.Vector3() };
    for (let round = 0; round < 8; round++) {
      V.scene.fallbackK = [1, 0, 0.4, 0.65][round % 4];
      V.R = round === 5 ? {} : { camera };
      camera.position.set(int(9) - 4, int(5), int(9) - 4);
      if (round > 0) {
        groups[1 + int(6)].visible = r() < 0.7;                                   // cutaway hides / shows a branch
        const l = ctx._lamps[int(ctx._lamps.length)]; if (l) l.userData.lightEnabled = r() < 0.5;
        groups[1 + int(6)].position.x += int(3) - 1;                              // an anchor / parent moved
        if (round === 6 && ctx._lamps.length > 2) ctx.releaseLamp(ctx._lamps[int(ctx._lamps.length)]);
      }
      oldTickLights(V, T, ctx, root); const want = lightState(ctx);
      const act = ctx._lamps.filter(l => l.visible).length;
      const lit = ctx._lamps.filter(l => l.userData.lightEnabled !== false && l.userData.base > 0 && (function up(p) { return !p || (p.visible && up(p.parent)); })(l.parent));
      if (lit.length > 8) overBudget++;
      if (V.R.camera && lit.length > 8) {   // the 8th and 9th nearest are exactly as far: only registration order decides
        const d = lit.map(l => l.getWorldPosition(new T.Vector3()).distanceToSquared(camera.position)).sort((a, b) => a - b);
        if (d[7] === d[8]) ties++;
      }
      scramble(ctx); ctx.tickLights();
      assert.deepEqual(lightState(ctx), want, 'seed ' + seed + ' round ' + round);
      assert.ok(act <= V.scene.MAX_LAMPS);
      ctx.tickLights(); assert.deepEqual(lightState(ctx), want, 'a second call changes nothing');
      compared++;
    }
  }
  assert.equal(compared, 480); assert.ok(overBudget > 100, 'fixtures exercise the 8-light cap: ' + overBudget); assert.ok(ties >= 5, 'fixtures where a tie at the cap decides the selection: ' + ties);

  // every lamp exactly as far from the camera: the first 8 registered and lit ones win, as with the old stable sort
  const root = new T.Group(), ctx = V.scene.ctx(root); V.scene.fallbackK = 1; V.R = { camera: { position: new T.Vector3(0, 0, 0) } };
  const ring = Array.from({ length: 16 }, (_, i) => ctx.lamp({ pos: [[3, 0, 0], [-3, 0, 0], [0, 3, 0], [0, -3, 0], [0, 0, 3], [0, 0, -3]][i % 6], switchable: true }));
  ring[2].userData.lightEnabled = false; ring[5].userData.base = 0;
  oldTickLights(V, T, ctx, root); const want = lightState(ctx);
  assert.deepEqual(ring.map(l => l.visible), [true, true, false, true, true, false, true, true, true, true, false, false, false, false, false, false]);
  scramble(ctx); ctx.tickLights(); assert.deepEqual(lightState(ctx), want);
  V.R.camera.position.set(3, 0, 0);   // lamps 0, 6, 12 sit on the camera; the eight lit ones at distance² 18 tie for the other five slots
  oldTickLights(V, T, ctx, root); const want2 = lightState(ctx);
  scramble(ctx); ctx.tickLights(); assert.deepEqual(lightState(ctx), want2);
  assert.deepEqual(ring.map((l, i) => l.visible ? i : -1).filter(i => i >= 0), [0, 3, 4, 6, 8, 9, 10, 12]);
});

test('tickLights allocates nothing per call: no vector clone, filter / slice / sort, Map or Set', () => {
  const made = { Map: 0, Set: 0 };
  class CountMap extends Map { constructor(...a) { super(...a); made.Map++; } }
  class CountSet extends Set { constructor(...a) { super(...a); made.Set++; } }
  const h = loadV3(['50-scene'], { three: 'real', globals: { Map: CountMap, Set: CountSet }, ...SRC }), V = h.V3, T = h.window.THREE;
  const root = new T.Group(), ctx = V.scene.ctx(root);
  V.scene.fallbackK = 1; V.R = { camera: { position: new T.Vector3(3, 2, 9) } };
  const lights = Array.from({ length: 12 }, (_, i) => ctx.lamp({ pos: [i, 0, 0], switchable: true }));
  const anchor = new T.Group(); anchor.position.set(3, 4, 5); root.add(anchor);
  const cut = [ctx.lamp({ parent: anchor, pos: [0, 2, 0], keepWhenCut: true, switchable: true }), ctx.lamp({ parent: anchor, pos: [1, 2, 0], keepWhenCut: true, switchable: true })];
  ctx.glowMat(0xffffff);
  const calls = { clone: 0, filter: 0, slice: 0, sort: 0, map: 0 };
  const clone = T.Vector3.prototype.clone; T.Vector3.prototype.clone = function () { calls.clone++; return clone.call(this); };
  for (const k of ['filter', 'slice', 'sort', 'map']) ctx._lamps[k] = function (...a) { calls[k]++; return Array.prototype[k].apply(this, a); };
  made.Map = made.Set = 0;
  try { for (let i = 0; i < 100; i++) { V.R.camera.position.x = i % 7; ctx.tickLights(); } } finally { T.Vector3.prototype.clone = clone; }
  assert.deepEqual({ ...calls, ...made }, { clone: 0, filter: 0, slice: 0, sort: 0, map: 0, Map: 0, Set: 0 });
  // and it still does its job: 8 nearest of 14 lit, anchored lamps follow their hidden support
  anchor.visible = false; V.R.camera.position.set(0, 0, 0); ctx.tickLights();
  assert.equal(ctx._lamps.filter(l => l.visible).length, 8);
  assert.deepEqual(lights.map(l => l.visible), [true, true, true, true, true, true, true, true, false, false, false, false]);
  assert.deepEqual(cut[0].position.toArray(), [3, 6, 5]); assert.deepEqual(cut[1].position.toArray(), [4, 6, 5]);
});

// ---------------------------------------------------------------------------------------------------------------
// 50-scene: the house2 model's per-frame update (tickLights + cutaway)
// ---------------------------------------------------------------------------------------------------------------
const NORM = { s: [0, 0, 1], n: [0, 0, -1], e: [1, 0, 0], w: [-1, 0, 0] };
function collect(root) {   // as in 50-scene
  const c = { roof: [], loft: [], ground: [], walls: [], onWall: [], ceilingFixtures: [] };
  root.traverse(o => {
    const u = o.userData || {};
    if (u.ceilingFixture) c.ceilingFixtures.push(o);
    if (u.wall && NORM[u.wall]) c.walls.push(o);
    else if (u.onWall && NORM[u.onWall]) c.onWall.push(o);
    else if (u.layer === 'roof' || u.layer === 'loft' || u.layer === 'ground') c[u.layer].push(o);
  });
  return c;
}
// The cutaway before this repair, kept as the oracle.
function oldApplyCut(T, SC, c, floor, cam, centre) {
  const _d = new T.Vector3();
  _d.copy(cam.position).sub(centre); _d.y = 0; _d.normalize();
  const facing = (side) => { const n = NORM[side]; return n[0] * _d.x + n[2] * _d.z > 0.2; };
  for (const o of c.roof) o.visible = floor === 'all';
  for (const o of c.loft) o.visible = floor !== 'ground';
  for (const o of c.ground) o.visible = true;
  const low = {};
  const hl = SC.houseLowered && SC.houseLowered();
  if (hl) for (const k of hl.sides) low[hl.storey + ':' + k] = true;
  for (const o of c.walls) {
    const u = o.userData, st = u.storey || 'ground';
    const active = (floor === 'ground' && st === 'ground') || (floor === 'loft' && st === 'loft');
    const lowered = active && facing(u.wall);
    if (lowered) low[st + ':' + u.wall] = true;
    const storeyOn = !(st === 'loft' && floor === 'ground') && !(st === 'roof' && floor !== 'all');
    o.visible = storeyOn && (u.cut === 'low' ? lowered : !lowered);
  }
  for (const o of c.onWall) {
    const u = o.userData, st = u.storey || (u.layer === 'loft' ? 'loft' : 'ground');
    const storeyOn = !(st === 'loft' && floor === 'ground');
    o.visible = storeyOn && !low[st + ':' + u.onWall];
  }
  for (const o of c.ceilingFixtures) {
    const layer = o.userData.ceilingFixture;
    o.visible = floor === 'all' || (layer === 'ground' && floor === 'loft');
  }
}
function sceneModel({ walls = true } = {}) {
  const h = loadV3(['50-scene'], { three: 'real', ...SRC }), V = h.V3, T = h.window.THREE;
  V.layout = { house: { x0: -4, x1: 6, z0: -8, z1: 2, floorY: 0 } };
  V.R = { camera: { position: new T.Vector3(20, 10, 20) }, scene: { background: null, fog: null }, renderer: { toneMappingExposure: 1 } };
  V.scene.fallbackK = 1;
  V.scene.part({ id: 'cut-fixture', order: 1, build(ctx) {
    const g = new T.Group(), add = (ud, parent = g) => { const o = new T.Group(); Object.assign(o.userData, ud); parent.add(o); return o; };
    for (const side of ['s', 'n', 'e', 'w']) {
      if (walls) for (const storey of [undefined, 'ground', 'loft', 'roof']) for (const cut of [undefined, 'low']) add({ wall: side, storey, cut });
      for (const ud of [{}, { storey: 'ground' }, { storey: 'loft' }, { layer: 'loft' }, { layer: 'ground' }, { storey: 'roof' }]) add({ onWall: side, ...ud });
    }
    for (const layer of ['roof', 'loft', 'ground', 'site']) { const o = add({ layer }); add({ layer: 'ground', ceilingFixture: 'ground' }, o); add({ ceilingFixture: 'loft' }, o); }
    const anchor = add({ layer: 'loft' });
    for (let i = 0; i < 10; i++) ctx.lamp({ pos: [i, 1, -i], switchable: true });
    ctx.lamp({ parent: anchor, pos: [0, 2, 0], keepWhenCut: true, switchable: true });
    ctx.glowMat(0xffffff);
    return g;
  } });
  const inst = V.models.get('house2').build();
  const c = collect(inst.root), all = [...new Set(Object.values(c).flat())];
  const centre = new T.Vector3(1, 0, -3);
  return { V, T, inst, c, all, centre };
}
const HOUSE_LOWERED = [null, { storey: 'ground', sides: '' }, { storey: 'ground', sides: 's' }, { storey: 'ground', sides: 'se' }, { storey: 'loft', sides: 'nw' },
  { storey: 'loft', sides: 'snew' }, { storey: 'ground', sides: 'n' }];

test('cutaway shows and hides exactly what the old implementation did (floors x camera angles x lowered block walls)', () => {
  let compared = 0;
  for (const walls of [true, false]) {
    const { V, T, inst, c, all, centre } = sceneModel({ walls });
    assert.ok(all.length > 40 || !walls);
    const cams = []; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 + 0.01; cams.push([centre.x + Math.sin(a) * 20, 9, centre.z + Math.cos(a) * 20]); }
    cams.push([centre.x, 30, centre.z], [centre.x + 20 * 0.2, 5, centre.z + 20 * 0.98], [centre.x - 3, 2, centre.z - 0.5]);
    for (const floor of ['all', 'ground', 'loft', 'all', 'loft', 'ground']) {
      inst.setState('floor', floor);
      for (const hl of HOUSE_LOWERED) for (const cam of cams) {
        V.scene.houseLowered = hl ? () => ({ storey: hl.storey, sides: hl.sides }) : null;
        V.R.camera.position.set(...cam);
        oldApplyCut(T, V.scene, c, floor, V.R.camera, centre);
        const want = all.map(o => o.visible);
        for (const o of all) o.visible = 'scrambled';
        inst.update(1 / 60, 0);
        assert.deepEqual(all.map(o => o.visible), want, JSON.stringify({ walls, floor, hl, cam }));
        compared++;
      }
    }
    inst.dispose();
  }
  assert.equal(compared, 2 * 6 * 7 * 19);
});

test('cutaway is re-applied every frame: visibility flipped by arrange / the shadow pass is put back', () => {
  const { V, inst, all } = sceneModel();
  inst.setState('floor', 'ground'); V.R.camera.position.set(1, 9, 30); inst.update(1 / 60, 0);
  const want = all.map(o => o.visible);
  assert.ok(want.includes(true) && want.includes(false));
  for (const o of all) o.visible = !o.visible;   // 69-arrange unhideOriginal / 51-sky write visible on these same objects
  inst.update(1 / 60, 0);
  assert.deepEqual(all.map(o => o.visible), want);
  inst.dispose();
});

test('a frame of the scene model (tickLights + cutaway) leaves no garbage behind', () => {
  const { V, inst } = sceneModel();
  const hl = { storey: 'ground', sides: 'se' }; V.scene.houseLowered = () => hl;   // the real one (54-house-mc) allocates; not counted here
  inst.setState('floor', 'ground');
  let i = 0;
  const frame = () => { V.R.camera.position.x = 20 + (i++ % 50) * 0.3; inst.update(1 / 60, 0); };
  const frames = 5000, bytes = heapGrowth(frame, frames);
  // old code: ~3 kB per frame for this scene (≈ 15 MB here); steady state now is a few hundred bytes for the whole run
  assert.ok(bytes < 256 * 1024, 'heap grew ' + bytes + ' bytes over ' + frames + ' frames (' + (bytes / frames).toFixed(1) + ' B/frame)');
  inst.dispose();
});
