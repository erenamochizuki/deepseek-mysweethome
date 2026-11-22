// Click interactions added 2026-11-12: the shell wind chime rings once per click, the crab runs back into its hole.
// Source-only, real modules + the vendored three (no build, no browser):   node --test test/click-chime-crab.test.mjs
//   66-chime-sound  V3.chimes.click            one burst per click, its own 0.4 s cooldown, setting / audio unlock
//   55-house-detail the voxel chime             click target (userData.clickable = 'chime'), kick by object or by cell
//   59-sealife      V3.sealife.crab.startle     the "startled" override on top of the untouched schedule
//   91-cabin        V3.cabinTargets             findTarget / actionable / act = what a real click runs
//   69-interaction-hover                        tooltip labels
// What Node cannot show: the sound itself, the outline, real pointer events (see haibian/test/cabin-toys-browser.mjs).
// CLICK_SRC_DIR=<dir> loads the modules from another src directory (used once to confirm these fail on the old files).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { packShore } from '../tools/lib/shore-blockbench.mjs';

const SRC = process.env.CLICK_SRC_DIR ? { srcDir: path.resolve(process.env.CLICK_SRC_DIR) } : {};

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.round(a / TAU);                 // angle difference modulo 2π, in (−π, π]
const fakeDocument = () => ({ readyState: 'loading', addEventListener() {} });   // 91-cabin only waits for DOMContentLoaded

// ---------------------------------------------------------------------------------------------------------------
// Wind chime: sound module alone (same fake AudioContext as chime-sound.test.mjs), two chimes side by side
// ---------------------------------------------------------------------------------------------------------------
function fakeAudio() {
  const A = { starts: 0, state: 'running', currentTime: 0, sampleRate: 1000, destination: {} };
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ gain: param(), frequency: param(), pan: param(), connect() {}, start() { A.starts++; }, stop() {} });
  Object.assign(A, { createGain: node, createStereoPanner: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node,
    createBuffer: (_, n) => ({ getChannelData: () => new Float32Array(n) }) });
  return A;
}
const CHIME_A = [10, 2, 20], CHIME_B = [11, 2, 20];
// The click cooldown runs on real time (performance.now()); the tests drive a fake one together with the frames.
function fakeTime() { const c = { ms: 5000 }; c.performance = { now: () => c.ms }; return c; }
function chimeSound() {
  const time = fakeTime();
  const h = loadV3([], { three: 'real', globals: { performance: time.performance }, ...SRC }), V3 = h.V3, audio = fakeAudio(), kicks = [];
  let enabled = true;
  V3.audio = { ctx: () => audio };
  V3.game = { get: (k) => (k === 'chimeSound' ? enabled : 1.3) };
  V3.houseDetail = { chimeKick(cell, obj) { kicks.push({ cell: cell && cell.slice(), obj: obj || null }); } };
  V3.houseBlocks = { grid: { W: 2, L: 1, org: CHIME_A.slice(), cells: [0, 0], st: [{ ns: 'xiaojingyu', id: 'wind_chime' }] } };
  h.load(['66-chime-sound']);
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { time.ms += 100; V3.emit('frame', 0.1); } };   // 0.1 s per tick: real time and the module's frame clock
  return { h, V3, audio, kicks, tick, time, mute: (v) => { enabled = !v; }, stats: () => V3.chimes.stats() };
}

test('chime: one click = exactly one burst (2–3 hits) at the clicked chime, and one kick of the voxel chime', () => {
  const c = chimeSound(), C = c.V3.chimes;
  assert.equal(typeof C.click, 'function', 'V3.chimes.click exists');
  assert.equal(C.click({ cell: CHIME_A }), true);
  const s = c.stats();
  assert.equal(s.rings, 1); assert.equal(s.clicks, 1); assert.equal(s.played, 1);
  assert.ok(s.hits === 2 || s.hits === 3, 'the same 2–3 hit burst as a walk-under: ' + s.hits);
  assert.equal(c.audio.starts, s.hits * 5, 'each hit = 4 partials + the shell tick; nothing else was scheduled');
  assert.deepEqual(s.last, CHIME_A);
  assert.equal(c.kicks.length, 1); assert.deepEqual(c.kicks[0].cell, CHIME_A);
  assert.equal(C.click(null), false); assert.equal(C.click({}), false); assert.equal(C.click({ cell: [1, 2] }), false);
  assert.equal(c.stats().rings, 1, 'a click on nothing rings nothing');
});

test('chime: a click rings inside the 1 s walk-under cooldown; clicks inside the 0.4 s click cooldown do not stack', () => {
  const c = chimeSound(), { V3, tick } = c, C = V3.chimes;
  V3.actor = { pos: [0, 0, 0] }; tick();
  V3.actor.pos = [10.5, 0, 20.5]; tick();                          // she walks in under chime A: the existing ring
  assert.equal(c.stats().rings, 1); assert.equal(c.kicks.length, 1);
  tick();                                                          // 0.1 s later: still deep inside the 1 s cooldown
  V3.emit('chime:gust', CHIME_A);
  assert.equal(c.stats().rings, 1, 'control: the walk-under cooldown is still active for gusts');
  assert.equal(C.click({ cell: CHIME_A }), true, 'a deliberate click is not swallowed by the walk-under cooldown');
  assert.equal(c.stats().rings, 2); assert.equal(c.stats().played, 2); assert.equal(c.kicks.length, 2);
  assert.equal(C.click({ cell: CHIME_A }), false, 'a second click at the same instant is ignored');
  tick(2);                                                         // 0.2 s after the click
  assert.equal(C.click({ cell: CHIME_A }), false, 'still inside the 0.4 s click cooldown');
  assert.equal(c.stats().rings, 2); assert.equal(c.stats().played, 2); assert.equal(c.kicks.length, 2);
  tick(3);                                                         // 0.5 s after the click, 0.6 s after the walk-under
  assert.equal(C.click({ cell: CHIME_A }), true, 'rings again after the click cooldown, still within 1 s of the walk-under');
  assert.equal(c.stats().rings, 3); assert.equal(c.stats().clicks, 2); assert.equal(c.kicks.length, 3);
  V3.emit('chime:gust', CHIME_A);
  assert.equal(c.stats().rings, 3, 'a gust right after a click does not add another burst');
  tick(11); V3.emit('chime:gust', CHIME_A);
  assert.equal(c.stats().rings, 4, 'the ordinary gust ring works again 1 s later');
  // the click cooldown is real time, not frames: a slow page (few frames) does not swallow a click made 0.5 s later…
  assert.equal(C.click({ cell: CHIME_B }), true);
  c.time.ms += 500;                                                // half a second, not a single frame in between
  assert.equal(C.click({ cell: CHIME_B }), true, 'no frame passed, 0.5 s did: the click counts');
  // …and a fast page (many frames in a short time) does not let clicks through early
  for (let i = 0; i < 30; i++) c.V3.emit('frame', 0.1);            // 3 s of frame clock in no real time
  assert.equal(C.click({ cell: CHIME_B }), false, 'frames alone do not end the click cooldown');
});

test('chime: the clicked one of two rings; each has its own click cooldown', () => {
  const c = chimeSound(), C = c.V3.chimes;
  assert.deepEqual(C.list(), [CHIME_A, CHIME_B]);
  assert.equal(C.click({ cell: CHIME_B }), true);
  assert.deepEqual(c.stats().last, CHIME_B); assert.deepEqual(c.kicks[0].cell, CHIME_B);
  assert.equal(C.click({ cell: CHIME_A }), true, 'the other chime is not in cooldown');
  assert.deepEqual(c.stats().last, CHIME_A); assert.deepEqual(c.kicks[1].cell, CHIME_A);
  assert.equal(C.click({ cell: CHIME_B }), false); assert.equal(C.click({ cell: CHIME_A }), false);
  assert.equal(c.stats().rings, 2);
});

test('chime: setting off → still swings, no sound; suspended audio → plays once the click has resumed it', async () => {
  const c = chimeSound(), C = c.V3.chimes;
  c.mute(true);
  assert.equal(C.click({ cell: CHIME_A }), true);
  assert.equal(c.kicks.length, 1, 'it still swings');
  assert.equal(c.stats().played, 0); assert.equal(c.audio.starts, 0, 'nothing was scheduled with 「风铃声」 off');
  c.mute(false); c.tick(5);

  c.audio.state = 'suspended';                                    // no resume() on this context: stays silent, no throw
  assert.equal(C.click({ cell: CHIME_A }), true);
  assert.equal(c.audio.starts, 0); assert.equal(c.stats().played, 0);
  c.tick(5);
  let resumed = 0;
  c.audio.resume = () => { resumed++; return Promise.resolve().then(() => { c.audio.state = 'running'; }); };
  assert.equal(C.click({ cell: CHIME_A }), true);
  assert.equal(c.audio.starts, 0, 'not while the context is still suspended');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(resumed, 1);
  assert.equal(c.stats().played, 1, 'the click resumed the context and its burst was scheduled once');
  const hits = c.audio.starts / 5; assert.ok(hits === 2 || hits === 3);
  c.tick(5);
  c.V3.R = { camera: { position: { x: 100, y: 100, z: 100 } } };   // out of earshot (24 m): swings, silent
  assert.equal(C.click({ cell: CHIME_A }), true);
  assert.equal(c.stats().played, 1); assert.equal(c.kicks.length, 4);
});

// ---------------------------------------------------------------------------------------------------------------
// Wind chime: the real voxel chime (55-house-detail) + sound module + the click path of 91-cabin
// ---------------------------------------------------------------------------------------------------------------
// blocks = false: the legacy path (chime built straight from the layout, no block cell).
// blocks = [[x, y, z] …]: the block house has one wind_chime block per cell (same facing as the default house).
function chimeHouse(blocks) {
  const time = fakeTime();
  const h = loadV3(['03-vox', '40-layout'].concat(blocks ? ['44-furn-mc'] : []), { three: 'real', globals: { performance: time.performance }, ...SRC });
  const { V3, window } = h, T = window.THREE, parts = new Map(), audio = fakeAudio();
  V3.scene = { part: (p) => parts.set(p.id, p) };
  V3.audio = { ctx: () => audio };
  if (blocks) {
    const FM = V3.furnMc, f = FM.byBlock('xiaojingyu:wind_chime'), home = FM.homesOf(f)[0];
    const xs = blocks.map((c) => c[0]), x0 = Math.min(...xs), W = Math.max(...xs) - x0 + 1;
    const cells = new Array(W).fill(0); for (const c of blocks) cells[c[0] - x0] = 1;
    V3.houseBlocks = {
      grid: { W, L: 1, org: [x0, blocks[0][1], blocks[0][2]], cells, st: [null, { ns: 'xiaojingyu', id: 'wind_chime' }] },
      whenGrid: (ctx, fn) => fn(),
      // same shape as 54-house-mc's HB.furnPlaced: { f, block, cell, facing, home, ref, mv }
      furnPlaced: (block) => (block !== f.block ? [] : blocks.map((cell) => {
        const r = { f, block: f.block, cell: cell.slice(), facing: home.facing };
        const hm = home.cell.every((v, k) => v === cell[k]) ? home : null;
        return Object.assign(r, { home: hm, ref: home, mv: FM.mover(home, r) });
      })),
    };
  }
  h.load(['55-house-detail', '66-chime-sound', '69-interaction-hover']);
  window.document = fakeDocument(); h.load(['91-cabin']);
  const part = parts.get('house-detail'), root = new T.Group();
  for (const o of part.build({})) root.add(o);
  root.updateMatrixWorld(true);
  const chimes = []; root.traverse((o) => { if (o.name === 'house2:chime') chimes.push(o); });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { time.ms += 100; V3.emit('frame', 0.1); part.update(0.1); } };
  // A ray from 3 m in front of the chime (outside, on the side it hangs on) through the middle of its shell strings.
  const rayAt = (gr, dx = 0) => {
    const pick = gr.children.find((o) => o.name === 'house2:chime:pick');
    const mid = pick.getWorldPosition(new T.Vector3()), out = new T.Vector3(0, 0, 1).transformDirection(gr.matrixWorld);
    const side = new T.Vector3(1, 0, 0).transformDirection(gr.matrixWorld);
    const from = mid.clone().addScaledVector(out, 3).addScaledVector(side, dx);
    return new T.Raycaster(from, out.clone().negate());
  };
  return { h, V3, T, window, audio, part, root, chimes, tick, rayAt };
}

test('chime (legacy layout, no block cell): the voxel chime is a click target and rings by object', () => {
  const w = chimeHouse(false), { V3, T } = w;
  assert.deepEqual(w.window.__errors, []);
  assert.equal(w.chimes.length, 1);
  const gr = w.chimes[0];
  assert.equal(gr.userData.clickable, 'chime'); assert.equal(gr.userData.clickAlways, true);
  assert.equal(gr.userData.cell, undefined, 'legacy layout: no block cell');
  assert.deepEqual(V3.houseDetail.chimes().map((c) => c.cell), [null]);
  assert.ok(V3.houseDetail.version >= 1, 'building a chime bumps the version 91-cabin keys its click-target cache on');

  // a real ray through the shell strings resolves to the chime group, via the visible voxels and via the pick box
  const hits = w.rayAt(gr).intersectObject(w.root, true);
  assert.ok(hits.length > 0, 'the ray hits the chime');
  const t = V3.cabinTargets.find(hits[0].object);
  assert.equal(t.what, 'chime'); assert.equal(t.obj, gr);
  assert.ok(hits.some((x) => x.object.name === 'house2:chime:pick'), 'the invisible pick box is hit');
  assert.ok(hits.some((x) => x.object.name !== 'house2:chime:pick' && V3.cabinTargets.find(x.object).obj === gr), 'so are the voxels themselves');
  const gap = w.rayAt(gr, 2 / 32).intersectObject(w.root, true);   // between two strings: only the pick box is there
  assert.ok(gap.length > 0 && V3.cabinTargets.find(gap[0].object).obj === gr, 'a click between the strings still counts');
  const pick = gr.children.find((o) => o.name === 'house2:chime:pick');
  assert.equal(pick.material.visible, false, 'the pick box is never drawn (and so never outlined)');
  assert.ok(!V3.parts.pickables().includes(pick), 'the pick box is not a feedback-tool target');
  // the box covers the shell strings: every voxel mesh below the driftwood bar is inside it (in the chime's own frame)
  const box = new T.Box3().setFromObject(pick), strings = new T.Box3();
  gr.traverse((m) => { if (m.isMesh && m !== pick && /^vox:s\d$/.test(m.name)) strings.expandByObject(m); });
  assert.ok(!strings.isEmpty() && box.containsBox(strings), 'pick box ' + JSON.stringify(box) + ' covers the strings ' + JSON.stringify(strings));

  assert.equal(V3.cabinTargets.actionable(t), true);
  assert.equal(V3.interactionHover.label(t), '贝壳风铃 · 点击摇一摇');
  const sway = () => { let a = 0; gr.traverse((b) => { if (/^s\d$/.test(b.name)) a = Math.max(a, Math.abs(b.rotation.z), Math.abs(b.rotation.x)); }); return a; };
  w.tick(3);
  assert.ok(sway() < 1e-9, 'no wind, not kicked: the strings hang still');
  const s0 = V3.chimes.stats(), k0 = gr.userData.clinks;
  assert.equal(V3.cabinTargets.act(t), true);
  const s1 = V3.chimes.stats();
  assert.equal(s1.rings - s0.rings, 1); assert.equal(s1.played - s0.played, 1); assert.equal(gr.userData.clinks - k0, 1);
  w.tick(1);
  assert.ok(sway() > 0.01, 'the voxel strings visibly swing after the click: ' + sway());
  assert.equal(V3.cabinTargets.act(t), false, 'inside the click cooldown');
  assert.equal(V3.chimes.stats().rings - s0.rings, 1); assert.equal(gr.userData.clinks - k0, 1);
  w.tick(5);
  assert.equal(V3.cabinTargets.act(t), true);
  assert.equal(V3.chimes.stats().rings - s0.rings, 2); assert.equal(gr.userData.clinks - k0, 2);
});

test('chime (block house, two chimes, one moved): a click rings and swings only the clicked one; a rebuild keeps working', () => {
  const HOME = [-2, 3, -6], MOVED = [1, 3, -6];
  const w = chimeHouse([HOME, MOVED]), { V3 } = w;
  assert.deepEqual(w.window.__errors, []);
  assert.equal(w.chimes.length, 2);
  const at = (cell) => w.chimes.find((g) => g.userData.cell && g.userData.cell.join() === cell.join());
  const a = at(HOME), b = at(MOVED);
  assert.ok(a && b && a !== b, 'one voxel chime per wind_chime block, each knows its cell');
  assert.ok(Math.abs(b.position.x - a.position.x - 3) < 1e-9, 'the second one hangs 3 blocks east');
  assert.deepEqual(V3.chimes.list(), [HOME, MOVED]);
  for (const g of [a, b]) { assert.equal(g.userData.clickable, 'chime'); assert.equal(g.userData.clickAlways, true); }

  const hit = w.rayAt(b).intersectObject(w.root, true)[0], t = V3.cabinTargets.find(hit.object);
  assert.equal(t.obj, b, 'a ray at the moved chime resolves to the moved chime');
  assert.equal(V3.cabinTargets.actionable(t), true);
  assert.equal(V3.cabinTargets.act(t), true);
  assert.deepEqual([a.userData.clinks, b.userData.clinks], [0, 1], 'only the clicked chime is kicked');
  assert.deepEqual(V3.chimes.stats().last, MOVED);
  assert.equal(V3.chimes.stats().rings, 1); assert.equal(V3.chimes.stats().played, 1);
  assert.equal(V3.cabinTargets.act(V3.cabinTargets.find(w.rayAt(a).intersectObject(w.root, true)[0].object)), true, 'the other one has its own cooldown');
  assert.deepEqual([a.userData.clinks, b.userData.clinks], [1, 1]);
  assert.deepEqual(V3.chimes.stats().last, HOME);

  // house rebuild: new scene objects, new version (91-cabin looks for click targets again), clicks keep working
  const v0 = V3.houseDetail.version;
  w.part.dispose({});
  const root2 = new w.T.Group(); for (const o of w.part.build({})) root2.add(o);
  root2.updateMatrixWorld(true);
  V3.emit('house:blocks');
  assert.ok(V3.houseDetail.version > v0);
  const again = []; root2.traverse((o) => { if (o.name === 'house2:chime') again.push(o); });
  assert.equal(again.length, 2); assert.ok(again.every((g) => g !== a && g !== b && g.userData.clickable === 'chime'));
  const t2 = V3.cabinTargets.find(again[1].children.find((o) => o.name === 'house2:chime:pick'));
  assert.equal(V3.cabinTargets.act(t2), true, 'no stale click cooldown after the house was rebuilt');
  assert.deepEqual(again.map((g) => g.userData.clinks), [0, 1]);
  assert.deepEqual([a.userData.clinks, b.userData.clinks], [1, 1], 'the old scene is left alone');
});

// ---------------------------------------------------------------------------------------------------------------
// Crab
// ---------------------------------------------------------------------------------------------------------------
function beach(seedBase = 0) {
  const h = loadV3(['03-vox', '04-atlas', '05-blocks', '40-layout'], { three: 'real', ...SRC });
  const { V3, window } = h, T = window.THREE, parts = new Map();
  V3.scene = { part: (p) => parts.set(p.id, p) };
  window.__V3_SHORE_MODELS = packShore();
  h.load(['31-shore-models', '52-terrain', '57-fish-passage', '58-inventory-rules', '59-sealife', '69-interaction-hover']);
  window.document = fakeDocument(); h.load(['91-cabin']);
  // The kelp needs the block atlas (a canvas): stubbed as in a3-scene-disposal.test.mjs, the crab does not use it.
  V3.blocks.material = () => new T.MeshBasicMaterial();
  V3.atlas.uv = () => [0, 0, 1, 1];
  const ctx = { rng: (seed) => { let hash = seedBase; for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return V3.util.rng(hash >>> 0); } };
  const part = parts.get('sealife');
  const w = { h, V3, T, window, part, ctx, root: null, crab: null, mesh: null, t: 0 };
  w.build = () => {
    w.root = new T.Group(); for (const o of part.build(ctx)) w.root.add(o);
    w.crab = V3.sealife.crab; w.mesh = w.root.children.find((o) => o.name === 'sealife:crab'); w.t = 0;
    return w;
  };
  w.pose = (t) => { w.t = t; w.crab.pose(t); return w.crab.now(); };
  w.step = (dt) => w.pose(w.t + dt);
  w.verts = () => Float32Array.from(w.mesh.geometry.attributes.position.array);   // local (skinned) vertex positions
  w.terrainMesh = () => parts.get('terrain').build(ctx)[0];
  return w.build();
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const DT = 0.05;
function shoreCamera(world, width = 1080, height = 760) {
  const { V3, T: three } = world;
  world.h.load(['01-render', '67-follow', '67-shore-view']);
  const camera = new three.PerspectiveCamera(30, width / height, .02, 400);
  const canvas = { clientHeight: height, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) };
  const ctl = new V3.Orbit(camera, canvas);
  V3.R = { camera, canvas, ctl }; return ctl;
}

test('shore close-ups: follow a visible crab only to the burrow; repeat clicks do not restart its retreat', () => {
  const world = beach(), { V3, crab, T: three } = world, ctl = shoreCamera(world), target = V3.cabinTargets.find(world.mesh);
  world.pose(20); const initial = crab.now();
  V3.follow.set(true); ctl.set({ az: 10 * Math.PI, dist: 24 });
  assert.ok(V3.cabinTargets.act(target)); assert.equal(V3.follow.on(), false); assert.equal(ctl.noPan, false);
  assert.equal(ctl.dist, 24); assert.ok(ctl.g.dist < 2.5 && Math.abs(ctl.g.az - ctl.az) <= Math.PI);
  assert.equal(ctl.g.target.x, initial.x); assert.equal(ctl.g.target.z, initial.z);
  assert.ok(crab.state().startled && !crab.canStartle());
  assert.ok(V3.cabinTargets.actionable(target)); const left = crab.state().left;
  assert.ok(V3.cabinTargets.act(target)); assert.equal(crab.state().left, left);
  ctl.rotate(20, 8); ctl.zoom(.88); const manual = [ctl.g.az, ctl.g.el, ctl.g.dist];
  let travelled = false;
  for (let frame = 0; frame < 900 && crab.now().k !== 'hide'; frame++) {
    const pose = world.step(DT); V3.emit('frame', DT, world.t);
    if (pose.z < crab.plan.MZ) {
      assert.equal(ctl.g.target.x, pose.x); assert.equal(ctl.g.target.z, pose.z);
      if (Math.hypot(initial.x - pose.x, initial.z - pose.z) > .1) travelled = true;
    }
  }
  assert.ok(travelled); assert.equal(crab.now().k, 'hide'); assert.equal(V3.cabinTargets.actionable(target), false);
  assert.equal(V3.cabinTargets.act(target), false); assert.deepEqual(manual, [ctl.g.az, ctl.g.el, ctl.g.dist]);
  const mouth = ctl.g.target.clone(); assert.deepEqual([mouth.x, mouth.z], crab.plan.M);
  for (let frame = 0; frame < 600; frame++) { world.step(DT); V3.emit('frame', DT, world.t); }
  assert.ok(ctl.g.target.equals(mouth));
  world.pose(0); assert.ok(V3.cabinTargets.act(target)); ctl.pan(32, -14);
  const panned = ctl.g.target.clone(); world.step(.5); V3.emit('frame', DT, world.t); assert.ok(ctl.g.target.equals(panned));
  assert.ok(V3.cabinTargets.act(target)); V3.actor = { root: new three.Group() }; V3.follow.set(true);
  V3.emit('frame', .5, world.t); assert.ok(ctl.g.target.distanceTo(panned) > 2);
});

test('shore close-ups: a portrait menu leaves the model visible, and closing or switching subjects releases the camera', () => {
  const world = beach(), { V3, T: three } = world, ctl = shoreCamera(world, 390, 844);
  world.window.matchMedia = () => ({ matches: true });
  const root = new three.Group(), hermit = new three.Group(), buoy = new three.Group(); root.add(hermit, buoy);
  root.position.set(5, .3, -8); hermit.scale.setScalar(.038); buoy.position.set(4, .15, 10);
  const panel = { isConnected: true, classList: { add() {} }, getBoundingClientRect: () => ({ left: 12, top: 450 }) };
  const opened = []; V3.shore = { panel, knows: key => key === 'hermit' || key === 'swimPost', act: key => { opened.push(key); return true; } };
  for (const [kind, object, height] of [['hermit', hermit, 4.8], ['swimPost', buoy, .8]]) {
    assert.ok(V3.cabinTargets.act({ what: kind, obj: object })); assert.equal(ctl.dist, ctl.g.dist);
    const point = object.localToWorld(new three.Vector3(0, height, 0)).project(V3.R.camera);
    assert.ok(Math.abs(point.x) < .2 && point.y > .1 && point.y < .9, `${kind} stays above the bottom sheet`);
    if (kind === 'hermit') {
      const before = ctl.g.target.clone(); hermit.position.x += .4; V3.emit('frame', DT, 0);
      assert.ok(Math.abs(ctl.g.target.x - before.x - .4) < 1e-6);
    }
  }
  const atBuoy = ctl.g.target.clone(); hermit.position.z -= 2; V3.emit('frame', DT, 0); assert.ok(ctl.g.target.equals(atBuoy));
  V3.cabinTargets.act({ what: 'hermit', obj: hermit }); panel.isConnected = false;
  const atDen = ctl.g.target.clone(); hermit.position.z += 2; V3.emit('frame', DT, 0); assert.ok(ctl.g.target.equals(atDen));
  assert.deepEqual(opened, ['hermit', 'swimPost', 'hermit']);
});
// Advance one sample and check the pose did not jump: position within top speed × dt, yaw within top turn rate × dt.
function advance(w, dt = DT) {
  const a = w.crab.now(), b = w.step(dt), vmax = 1.5 * w.crab.RUN, wmax = 1.5 * 6;   // smoothstep peaks at 1.5 × the average
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  assert.ok(d <= vmax * dt + 1e-9, `position jumped ${d.toFixed(4)} m in ${dt} s at t=${w.t.toFixed(2)} (${a.k}→${b.k})`);
  assert.ok(Math.abs(wrap(b.yaw - a.yaw)) <= wmax * dt + 1e-9, `yaw jumped ${wrap(b.yaw - a.yaw).toFixed(3)} rad at t=${w.t.toFixed(2)} (${a.k}→${b.k})`);
  assert.ok(Math.abs(b.y - a.y) <= vmax * dt + 1e-9, `height jumped from ${a.y} to ${b.y} at t=${w.t.toFixed(2)}`);
  return b;
}
const outside = (pl, p) => p.z <= pl.MZ + 0.02;                    // north of the hole mouth = on the open sand
const isHideSpot = (pl, p) => pl.seg.some((s) => s.k === 'hide' && Math.abs(s.p0[0] - p.x) < 1e-9 && Math.abs(s.p0[1] - p.z) < 1e-9);

test('crab: animated feet and claws clear the rendered burrow on entry, hide, exit and a startled retreat', () => {
  const scene = beach(2166136261), { crab, mesh } = scene, plan = crab.plan, terrain = scene.terrainMesh();
  terrain.updateMatrixWorld(true);
  const cell = scene.V3.terrain.CELL, sections = [], mouthY = scene.V3.terrain.seabedY(...plan.M);
  const ray = new scene.T.Raycaster();
  for (let row = 0; row < 3; row++) {
    ray.ray.origin.set(plan.HX, mouthY + 0.12, plan.NZ + (row + 0.5) * cell);
    const hit = (dx, dy, dz) => {
      ray.ray.direction.set(dx, dy, dz);
      return ray.intersectObject(terrain, true)[0]?.point;
    };
    sections.push({ floor: hit(0, -1, 0).y, roof: hit(0, 1, 0)?.y ?? Infinity, left: hit(-1, 0, 0).x, right: hit(1, 0, 0).x });
  }
  assert.ok(Number.isFinite(sections.at(-1).roof), 'hide spot has a real roof');
  let under = 0, through = 0, above = 0, lowestFootGap = 0, coinOverlap = 0;
  const inspect = () => {
    const pose = crab.now(), cos = Math.cos(pose.yaw), sin = Math.sin(pose.yaw), vertices = mesh.geometry.attributes.position.array;
    const grip = crab.rightClawGrip;
    for (const front of [-.016, .027]) for (let side = 0; side < 12; side++) {
      const rim = .102 * Math.cos(side * Math.PI / 6), height = grip.y + .102 * Math.sin(side * Math.PI / 6);
      const section = sections[Math.floor((grip.z - rim * sin + front * cos - plan.NZ) / cell)];
      if (!section) continue;
      const cross = grip.x + rim * cos + front * sin;
      coinOverlap = Math.max(coinOverlap, section.left - cross, cross - section.right, section.floor - height, height - section.roof);
    }
    let lowest = Infinity;
    for (let index = 0; index < vertices.length; index += 3) {
      const worldZ = pose.z - vertices[index] * sin + vertices[index + 2] * cos;
      const section = sections[Math.floor((worldZ - plan.NZ) / cell)];
      if (!section) continue;
      const worldX = pose.x + vertices[index] * cos + vertices[index + 2] * sin, worldY = pose.y + vertices[index + 1];
      under = Math.max(under, section.floor - worldY);
      through = Math.max(through, section.left - worldX, worldX - section.right);
      above = Math.max(above, worldY - section.roof);
      lowest = Math.min(lowest, worldY - section.floor);
    }
    if (pose.k === 'hide') lowestFootGap = Math.max(lowestFootGap, lowest);
  };
  for (const [index, segment] of plan.seg.entries()) if (segment.k === 'hide') {
    const entry = plan.seg[index - 1], exit = plan.seg[index + 1];
    for (let time = entry.t0; time <= exit.t0 + exit.d; time += 0.05) { scene.pose(time); inspect(); }
  }
  const advanceTo = target => {
    for (let frame = 0; frame < 30 / DT && crab.state().phase !== target; frame++) { advance(scene); inspect(); }
    assert.equal(crab.state().phase, target);
  };
  scene.pose(0); assert.ok(crab.startle({ hide: 1 }));
  advanceTo('return'); advance(scene); assert.ok(crab.startle({ hide: 1 }));
  advanceTo('routine');
  assert.ok(under < 0.001, `sank ${under.toFixed(4)} m below rendered sand`);
  assert.ok(through < 0.001 && above < 0.001, `clipped ${through.toFixed(4)} m through walls / ${above.toFixed(4)} m through roof`);
  assert.ok(lowestFootGap < 0.01, `floated ${lowestFootGap.toFixed(4)} m above the cave floor`);
  assert.ok(coinOverlap < .001, `the coin in the right claw clips ${coinOverlap.toFixed(4)} m into the cave`);
});

test('crab: is a click target; a real raycast at animated poses resolves to it; hover label; schedule itself is untouched', () => {
  const w = beach(), { V3, T, crab } = w, pl = crab.plan;
  assert.deepEqual(w.window.__errors, []);
  assert.equal(typeof crab.startle, 'function', 'V3.sealife.crab.startle exists');
  assert.equal(w.mesh.userData.clickable, 'crab'); assert.equal(w.mesh.userData.clickAlways, true);
  assert.equal(w.mesh.userData.kind, 'crab');
  // the precomputed schedule: still the plain 9-field segments, 3 hides, loops at the mouth
  assert.ok(pl.seg.every((s) => Object.keys(s).join() === 'k,t0,d,p0,p1,a0,a1,g0,gd'));
  assert.equal(pl.seg.filter((s) => s.k === 'hide').length, 3);
  const pick = w.mesh.children.find((o) => o.name === 'sealife:crab:pick');
  assert.ok(pick && pick.material.visible === false, 'an invisible pick box rides on the crab');
  // the feedback tool (71-fb-pick → V3.parts.pickables) keeps picking the crab's real faces, never the invisible box
  const fbPick = V3.parts.pickables();
  assert.ok(fbPick.includes(w.mesh) && !fbPick.includes(pick), 'the pick box is not a feedback-tool target');

  let checked = 0;
  for (const t of [0.5, 3.9, 9.7, 17.6, 20.4, 30.2, 63.1, 104.9]) {  // idle, snap, walking and turning poses
    const p = w.pose(t);
    assert.ok(outside(pl, p), 'sample pose is on the open sand');
    w.root.updateMatrixWorld(true);
    const down = new T.Raycaster(new T.Vector3(p.x, p.y + 3, p.z), new T.Vector3(0, -1, 0));
    const hits = down.intersectObject(w.root, true);
    assert.ok(hits.length > 0, 'a ray straight down on the crab hits something at t=' + t);
    const tg = V3.cabinTargets.find(hits[0].object);
    assert.ok(tg && tg.what === 'crab' && tg.obj === w.mesh, 'the first hit resolves to the crab target at t=' + t);
    const body = hits.find((x) => x.object === w.mesh);
    assert.ok(body, 'the CPU-skinned mesh itself is hit where the crab is now (t=' + t + ')');
    assert.ok(Math.abs(body.point.x - p.x) < 1e-6 && Math.abs(body.point.z - p.z) < 1e-6 && body.point.y > p.y + 0.05 && body.point.y < p.y + 0.3);
    // 0.26 m to the crab's side: leg tips / the gap between legs — the pick box still catches it
    const side = new T.Vector3(0.26, 0, 0).applyAxisAngle(new T.Vector3(0, 1, 0), p.yaw);
    const legs = new T.Raycaster(new T.Vector3(p.x + side.x, p.y + 3, p.z + side.z), new T.Vector3(0, -1, 0)).intersectObject(w.root, true);
    assert.ok(legs.length > 0 && V3.cabinTargets.find(legs[0].object).obj === w.mesh, 'over the legs at t=' + t);
    // and nothing where the crab was at t = 0 once it has walked away
    if (Math.hypot(p.x - pl.M[0], p.z - pl.M[1]) > 0.45) {
      const old = new T.Raycaster(new T.Vector3(pl.M[0], p.y + 3, pl.M[1]), new T.Vector3(0, -1, 0)).intersectObject(w.mesh, true);
      assert.equal(old.length, 0, 'the click target follows the crab (nothing left at the mouth at t=' + t + ')');
      checked++;
    }
    assert.equal(V3.cabinTargets.actionable(tg), true);
    assert.equal(V3.interactionHover.label(tg), '小螃蟹 · 点一下');
  }
  assert.ok(checked >= 4);
});

test('crab: clicked anywhere in its routine it runs to the mouth over clear sand, sidles into the hole, hides, comes out, and the routine resumes without a jump', () => {
  const w = beach(), ref = beach(), { V3, crab } = w, pl = crab.plan;
  const tg = V3.cabinTargets.find(w.mesh);
  const seen = { kinds: new Set(), clicks: 0, ignoredInRoutine: 0, runs: 0, hides: new Set() };
  const schedT = () => (((w.t - crab.state().offset) % pl.T) + pl.T) % pl.T;   // where the routine is now
  w.pose(0);
  // Click at 25 % and 75 % of EVERY segment of the schedule (all 60: idle, snap, turn, walk, walk into the hole, hide, walk out).
  for (let j = 0; j < pl.seg.length; j++) for (const frac of [0.25, 0.75]) {
    // still on the routine here: jump to 0.3 s before the mark (the routine is a pure function of time), then sample up to it
    const mark = pl.seg[j].t0 + pl.seg[j].d * frac;
    w.pose(w.t + ((((mark - 0.3 - schedT()) % pl.T) + pl.T) % pl.T));
    for (let k = 0; k < 6; k++) advance(w);
    const before = crab.state();
    assert.equal(before.startled, false); assert.equal(before.phase, 'routine'); assert.equal(before.k, pl.seg[j].k);
    assert.ok(Math.abs(schedT() - mark) < 1e-6);
    if (!crab.canStartle()) {                                         // scheduled hide / walking into the hole: not clickable
      assert.ok(before.k === 'hide' || !outside(pl, crab.now()), 'only unclickable in or on the way into the hole: ' + before.k);
      assert.equal(V3.cabinTargets.actionable(tg), false);
      assert.equal(V3.cabinTargets.act(tg), false); assert.equal(crab.startle(), false);
      assert.equal(crab.state().startled, false); assert.equal(crab.state().offset, before.offset);
      seen.ignoredInRoutine++;
      continue;
    }
    const at = crab.now(), fromHole = !outside(pl, at);               // clicked while walking out of the hole?
    seen.kinds.add(fromHole ? 'out' : before.k);
    assert.equal(V3.cabinTargets.actionable(tg), true);
    assert.equal(crab.startle({ hide: 2 }), true); seen.clicks++;
    assert.equal(crab.state().startled, true); assert.equal(crab.state().phase, 'flee'); assert.equal(crab.state().hide, 2);
    assert.equal(V3.cabinTargets.actionable(tg), false, 'not clickable while it runs away');
    const same = w.pose(w.t);                                         // re-posing the same instant: nothing moved yet
    assert.ok(Math.abs(same.x - at.x) < 1e-12 && Math.abs(same.z - at.z) < 1e-12 && Math.abs(same.yaw - at.yaw) < 1e-12);

    let phase = 'flee', hiddenFor = 0, spot = null, reachedMouth = fromHole, ranFast = 0, t0 = w.t;
    while (crab.state().startled) {
      const a = crab.now(), p = advance(w), st = crab.state();
      if (!st.startled) break;
      if (st.phase === 'flee') {
        assert.equal(phase, 'flee', 'phases only go forward');
        assert.equal(crab.startle(), false, 'a click while it is running to hide changes nothing');
        assert.equal(V3.cabinTargets.act(tg), false);
        if (outside(pl, p)) {
          assert.ok(!reachedMouth || Math.hypot(p.x - pl.M[0], p.z - pl.M[1]) < 0.03 || fromHole, 'once at the mouth it only goes in');
          assert.ok(pl.ok(p.x, p.z), `on clear wet sand all the way to the mouth: (${p.x.toFixed(3)}, ${p.z.toFixed(3)}) at t=${w.t.toFixed(2)}`);
          ranFast = Math.max(ranFast, Math.hypot(p.x - a.x, p.z - a.z) / DT);
          if (Math.hypot(p.x - pl.M[0], p.z - pl.M[1]) < 1e-6) reachedMouth = true;
        } else {
          // the sample before the first one inside was at the mouth (or one step short of it): in through the mouth, not the rock
          if (outside(pl, a)) assert.ok(Math.hypot(a.x - pl.M[0], a.z - pl.M[1]) <= 1.5 * crab.RUN * DT + 1e-9, 'it enters the hole through the mouth, not through the rock');
          reachedMouth = true;
          assert.ok(Math.abs(p.x - pl.HX) < 0.07, 'inside the hole it stays in the hole column');
        }
      } else if (st.phase === 'hidden') {
        if (phase === 'flee') { spot = p; seen.hides.add(p.x.toFixed(3)); }
        phase = 'hidden'; hiddenFor += DT;
        assert.equal(p.k, 'hide');
        assert.ok(isHideSpot(pl, p), 'hidden exactly at one of the schedule\'s hide spots');
        assert.ok(p.x === spot.x && p.z === spot.z && p.yaw === spot.yaw, 'it does not move while hidden');
        const H = pl.seg.find((s) => s.k === 'hide' && s.p0[0] === p.x);
        assert.ok(Math.abs(wrap(p.yaw - H.a0)) < 1e-9, 'and faces the way that scheduled hide does');
        assert.equal(crab.startle(), false, 'a click while it is hidden changes nothing');
        assert.equal(V3.cabinTargets.actionable(tg), false);
      } else {
        assert.equal(st.phase, 'return'); assert.ok(phase === 'hidden' || phase === 'return'); phase = 'return';
        assert.ok(Math.abs(p.x - pl.HX) < 0.07 && p.z >= pl.MZ - 1e-9, 'walks out along the hole to the mouth');
      }
    }
    assert.equal(phase, 'return', 'it went through flee → hidden → return');
    assert.ok(Math.abs(hiddenFor - 2) <= DT + 1e-9, 'stayed hidden for the requested 2 s: ' + hiddenFor.toFixed(2));
    if (!fromHole && Math.hypot(at.x - pl.M[0], at.z - pl.M[1]) > 0.5) {
      seen.runs++;
      assert.ok(ranFast > 0.5 && ranFast <= 1.5 * crab.RUN + 1e-6, 'it runs (faster than the 0.24–0.38 m/s walk): ' + ranFast.toFixed(2) + ' m/s');
    }
    // back on the normal schedule: the same pose the untouched schedule has at (t − offset), from now on
    const st = crab.state(), now = crab.now();
    assert.equal(st.startled, false); assert.equal(st.phase, 'routine'); assert.ok(st.offset !== before.offset);
    assert.ok(Math.hypot(now.x - pl.M[0], now.z - pl.M[1]) < 0.02, 'it resumes at the hole mouth');
    for (let k = 0; k < 8; k++) {
      const q = k ? advance(w) : now, r = ref.pose(w.t - st.offset);
      assert.ok(Math.abs(q.x - r.x) < 1e-9 && Math.abs(q.z - r.z) < 1e-9 && Math.abs(wrap(q.yaw - r.yaw)) < 1e-9 && q.k === r.k,
        `after the splice the pose is the schedule's at t − offset (t=${w.t.toFixed(2)}, offset=${st.offset.toFixed(2)})`);
    }
    assert.ok(w.t - t0 < 30, 'the whole episode is short: ' + (w.t - t0).toFixed(1) + ' s');
  }
  const nHole = pl.seg.filter((s) => s.k === 'hide' || (s.k === 'walk' && s.p1[1] > pl.MZ + 0.02)).length;   // 3 hides + 3 walks into the hole
  assert.equal(nHole, 6);
  assert.equal(seen.ignoredInRoutine, nHole * 2, 'clicks on a scheduled hide / walk into the hole are ignored, and only those');
  assert.equal(seen.clicks, (pl.seg.length - nHole) * 2, 'every other click startled it');
  for (const k of ['idle', 'snap', 'walk', 'turn', 'out']) assert.ok(seen.kinds.has(k), 'clicked at least once during: ' + k + ' (saw ' + [...seen.kinds] + ')');
  assert.ok(seen.runs >= 20, 'runs from more than 0.5 m away: ' + seen.runs);
  assert.ok(seen.hides.size === 2, 'both scheduled hide poses (left / right side first) get used: ' + [...seen.hides]);
  assert.deepEqual(w.window.__errors, []);
});

test('crab: the pose is continuous at both splice points (position, yaw, gait: every skinned vertex)', () => {
  const EPS = 1e-4;
  // click times: mid-walk (legs lifted, envelope 1), mid-snap (claws up), mid-turn, idle
  for (const tc of [3.9, 9.7, 1.1, 20.4, 16.3, 6.5, 30.9, 125.0]) {
    const w = beach(), { crab } = w, pl = crab.plan;
    w.pose(tc - EPS); const p0 = crab.now(), v0 = w.verts(), k = crab.state().k;
    w.pose(tc);
    assert.equal(crab.startle({ hide: 1 }), true, 'clickable at t=' + tc);
    const p1 = w.pose(tc + EPS), v1 = w.verts();
    assert.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) < 1e-3 && Math.abs(wrap(p1.yaw - p0.yaw)) < 2e-3 && Math.abs(p1.y - p0.y) < 1e-3, `no jump of the body at the click (t=${tc}, ${k})`);
    assert.ok(maxDiff(v0, v1) < 1e-3, `no jump of legs / claws at the click (t=${tc}, ${k}): ${maxDiff(v0, v1).toExponential(2)} m`);
    // …and no pop over the next 0.6 s either (the carried-over leg lift and claw raise fade out, they are not dropped at
    // the end of the first segment). Running legs really move up to ~8 m/s at the tips: 0.2 ms steps keep that under 2 mm.
    let prev = v1;
    for (let i = 1; i <= 3000; i++) { w.pose(tc + EPS + i * 2e-4); const v = w.verts(), d = maxDiff(prev, v); assert.ok(d < 0.004, `smooth after the click (t=${tc}, +${(i * 2e-4).toFixed(4)} s): ${d.toFixed(4)} m`); prev = v; }
    // end of the episode
    const end = w.t + crab.state().left;
    w.pose(end - EPS); const q0 = crab.now(), u0 = w.verts();
    assert.equal(crab.state().startled, true);
    const q1 = w.pose(end + EPS), u1 = w.verts();
    assert.equal(crab.state().startled, false);
    assert.ok(Math.hypot(q1.x - q0.x, q1.z - q0.z) < 1e-3 && Math.abs(wrap(q1.yaw - q0.yaw)) < 1e-3 && Math.abs(q1.y - q0.y) < 1e-3, `no jump of the body when the routine resumes (click at ${tc})`);
    assert.ok(maxDiff(u0, u1) < 1e-3, `no jump of legs / claws when the routine resumes (click at ${tc}): ${maxDiff(u0, u1).toExponential(2)} m`);
    assert.ok(Math.hypot(q1.x - pl.M[0], q1.z - pl.M[1]) < 1e-3);
  }
});

test('crab: the hide lasts 8–15 s from a seeded source (same scene, same clicks → same durations) or the injected value', () => {
  const run = () => {
    const w = beach(), { crab } = w, out = [];
    for (const tc of [4, 60, 110]) {
      for (w.pose(Math.max(w.t, tc)); !crab.canStartle();) w.step(DT);
      assert.equal(crab.startle(), true);
      const st = crab.state(); out.push(st.hide);
      assert.ok(st.hide >= 8 && st.hide < 15, 'hidden for 8–15 s: ' + st.hide);
      let hidden = 0, total = 0;
      while (crab.state().startled) { advance(w); total += DT; if (crab.state().phase === 'hidden') hidden += DT; }
      assert.ok(Math.abs(hidden - st.hide) <= DT + 1e-9, 'really stayed hidden that long: ' + hidden.toFixed(2) + ' vs ' + st.hide.toFixed(2));
      assert.ok(total < st.hide + 16, 'run + dive + walk out stay short: ' + (total - st.hide).toFixed(1) + ' s');
    }
    return out;
  };
  const a = run(), b = run();
  assert.deepEqual(a, b, 'reproducible');
  assert.ok(new Set(a.map((v) => v.toFixed(3))).size === 3, 'a little random from click to click: ' + a.map((v) => v.toFixed(2)));
  const w = beach(); w.pose(4);
  assert.equal(w.crab.startle({ hide: 11.5 }), true); assert.equal(w.crab.state().hide, 11.5);
  const w2 = beach(); w2.pose(4);
  assert.equal(w2.crab.startle({ hide: 1e9 }), true); assert.equal(w2.crab.state().hide, 60, 'an injected value is clamped');
});

test('crab: clicked while walking back out it turns round into the hole again; no straight line to the mouth → via a waypoint the plan validated', () => {
  { // walking out after a startle
    const w = beach(), { crab } = w, pl = crab.plan;
    w.pose(9.7); assert.equal(crab.startle({ hide: 1 }), true);
    while (crab.state().phase !== 'return') advance(w);
    for (let i = 0; i < 40; i++) advance(w);                           // 2 s out of the hole, still in the corridor
    const at = crab.now();
    assert.ok(!outside(pl, at) && crab.canStartle(), 'clickable again once it is on its way out');
    const left0 = crab.state().left;
    assert.equal(crab.startle({ hide: 1 }), true);
    assert.equal(crab.state().phase, 'flee'); assert.ok(crab.state().left !== left0);
    let minZ = at.z;
    while (crab.state().phase === 'flee') { const p = advance(w); minZ = Math.min(minZ, p.z); assert.ok(Math.abs(wrap(p.yaw - at.yaw)) < 1e-9, 'it backs in sideways, no turn'); }
    assert.ok(minZ >= at.z - 1e-9, 'it went straight back in, not out to the mouth first');
    assert.ok(isHideSpot(pl, crab.now()));
    while (crab.state().startled) advance(w);
    assert.ok(Math.hypot(crab.now().x - pl.M[0], crab.now().z - pl.M[1]) < 0.02);
  }
  { // scheduled walk out of the hole (segment after a scheduled hide)
    const w = beach(), { crab } = w, pl = crab.plan, i = pl.seg.findIndex((s) => s.k === 'hide'), out = pl.seg[i + 1];
    w.pose(out.t0 + out.d * 0.4);
    assert.ok(!outside(pl, crab.now()) && crab.canStartle());
    assert.equal(crab.startle({ hide: 1 }), true);
    while (crab.state().phase === 'flee') advance(w);
    assert.ok(Math.abs(crab.now().x - pl.seg[i].p0[0]) < 1e-9 && Math.abs(crab.now().z - pl.seg[i].p0[1]) < 1e-9, 'back at the hide spot it had just left');
    while (crab.state().startled) advance(w);
  }
  { // forced detour: pretend the straight line from where it is to the mouth is blocked
    const w = beach(), { crab } = w, pl = crab.plan, s = pl.seg[5];    // a walk between two validated points
    assert.equal(s.k, 'walk');
    w.pose(s.t0 + s.d * 0.5);
    const at = crab.now(), line = pl.line, asked = [];
    pl.line = (a, b) => { asked.push([a, b]); return (a === s.p0 || a === s.p1) ? line(a, b) : false; };   // only the segment's end points reach the mouth
    assert.equal(crab.startle({ hide: 1 }), true);
    pl.line = line;
    assert.ok(asked.length >= 2 && asked.every(([, b]) => b === pl.M), 'it asked the plan\'s own line test, towards the mouth');
    const want = [s.p0, s.p1].map((q) => [q, Math.hypot(q[0] - at.x, q[1] - at.z) + Math.hypot(q[0] - pl.M[0], q[1] - pl.M[1])]).sort((a, b) => a[1] - b[1])[0][0];
    let viaWaypoint = false, viaMouth = false;
    while (crab.state().phase === 'flee') {
      const p = advance(w);
      if (outside(pl, p)) assert.ok(pl.ok(p.x, p.z), 'the detour stays on clear sand');
      if (Math.hypot(p.x - want[0], p.z - want[1]) < 0.03) viaWaypoint = true;
      if (Math.hypot(p.x - pl.M[0], p.z - pl.M[1]) < 0.03) { assert.ok(viaWaypoint, 'waypoint first, then the mouth'); viaMouth = true; }
    }
    assert.ok(viaWaypoint && viaMouth, 'ran via the nearer end point of its current segment, then to the mouth');
    // and with no usable waypoint at all it stays put rather than cut through rock
    const w2 = beach(); w2.pose(s.t0 + s.d * 0.5);
    const before = w2.crab.now(); w2.crab.plan.line = () => false;
    assert.equal(w2.crab.startle(), false); assert.equal(w2.crab.state().startled, false);
    const after = w2.pose(w2.t);
    assert.ok(after.x === before.x && after.z === before.z);
  }
});

test('crab: a rebuild (new scene) starts clean; dispose leaves no startle behind', () => {
  const w = beach(), ref = beach(), { V3 } = w, old = w.crab;
  w.pose(9.7);
  assert.equal(old.startle({ hide: 30 }), true);
  for (let i = 0; i < 20; i++) advance(w);
  assert.equal(old.state().startled, true);
  w.part.dispose(w.ctx);
  assert.equal(old.state().startled, false, 'dispose drops the override');
  assert.equal(old.state().busy, true); assert.equal(old.canStartle(), false); assert.equal(old.startle(), false, 'nothing to startle once the scene is gone');
  w.build();
  const crab = V3.sealife.crab;
  assert.notEqual(crab, old);
  assert.deepEqual([crab.state().startled, crab.state().offset, crab.state().phase], [false, 0, 'routine']);
  for (const t of [0, 9.7, 44, 120.5]) {
    const p = w.pose(t), r = ref.pose(t);
    assert.deepEqual([p.x, p.z, p.yaw, p.k], [r.x, r.z, r.yaw, r.k], 'the new scene follows the plain schedule at t=' + t);
  }
  // time offset after a finished episode is also dropped by a rebuild
  w.pose(20); assert.equal(crab.startle({ hide: 1 }), true);
  while (crab.state().startled) w.step(DT);
  assert.ok(crab.state().offset !== 0);
  w.part.dispose(w.ctx); w.build();
  assert.equal(V3.sealife.crab.state().offset, 0);
  // a pose asked for an earlier time than the click (screenshot / probe with a fixed t) falls back to the plain schedule
  const c3 = V3.sealife.crab; w.pose(45); assert.equal(c3.canStartle(), false, 'scheduled hide'); w.pose(60);
  assert.equal(c3.startle({ hide: 5 }), true);
  const p = w.pose(9.7), r = ref.pose(9.7);
  assert.equal(c3.state().startled, false);
  assert.deepEqual([p.x, p.z, p.yaw], [r.x, r.z, r.yaw]);
  assert.deepEqual(w.window.__errors, []);
});

// ---------------------------------------------------------------------------------------------------------------
// Hover labels + what counts as clickable (91-cabin's actionable), without any scene
// ---------------------------------------------------------------------------------------------------------------
test('hover labels and actionable for both kinds; nothing else changed', () => {
  const h = loadV3(['69-interaction-hover'], { three: 'real', ...SRC }), { V3, window } = h;
  window.document = fakeDocument(); h.load(['91-cabin']);
  const L = V3.interactionHover.label, A = V3.cabinTargets.actionable, obj = { userData: {} };
  assert.equal(L({ what: 'chime', obj }), '贝壳风铃 · 点击摇一摇');
  assert.equal(L({ what: 'crab', obj }), '小螃蟹 · 点一下');
  assert.equal(L({ what: 'girl', obj }), '小鲸鱼 · 戳一戳'); assert.equal(L({ what: 'houseSwitch', obj }), '');
  // without their modules neither is clickable (and so neither is hoverable: hover uses the same pick)
  assert.equal(A({ what: 'chime', obj }), false); assert.equal(A({ what: 'crab', obj }), false);
  let can = true, startled = 0, rung = [];
  V3.chimes = { click: (t) => { rung.push(t); return true; } };
  V3.sealife = { crab: { canStartle: () => can, startle: () => { startled++; return can; } } };
  assert.equal(A({ what: 'chime', obj }), true); assert.equal(A({ what: 'crab', obj }), true);
  can = false;
  assert.equal(A({ what: 'crab', obj }), false, 'a crab that is hiding is not a click / hover target');
  assert.equal(V3.cabinTargets.act({ what: 'crab', obj }), false);
  can = true;
  assert.equal(V3.cabinTargets.act({ what: 'crab', obj }), true); assert.equal(startled, 2);
  const chime = { userData: { cell: [1, 2, 3], clickable: 'chime' } };
  assert.equal(V3.cabinTargets.act({ what: 'chime', obj: chime }), true);
  assert.deepEqual(rung, [{ cell: [1, 2, 3], obj: chime }], 'the click passes the chime\'s block cell and the object itself');
  assert.equal(A({ what: 'shellBox', obj }), true); assert.equal(A({ what: 'album', obj }), true); assert.equal(A({ what: 'nope', obj }), false);
  assert.equal(A(null), false); assert.equal(V3.cabinTargets.act(null), false);
  // findTarget: the nearest ancestor with a click kind
  const parent = { userData: { clickable: 'crab' }, parent: null }, child = { userData: {}, parent };
  assert.deepEqual(V3.cabinTargets.find(child), { what: 'crab', obj: parent });
  assert.equal(V3.cabinTargets.find({ userData: {}, parent: null }), null);
});
