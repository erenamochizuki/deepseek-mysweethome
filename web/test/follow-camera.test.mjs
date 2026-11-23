// 「跟随」 camera mode (src/67-follow.js + the fourth button in src/67-hud.js + Orbit.noPan in src/01-render.js).
// Source-only: no build, no browser, no server.   node --test test/follow-camera.test.mjs
// FOLLOW_SRC_DIR=<dir> loads the modules from another src directory (used once to confirm these fail on the old files).
//
// Real modules: 00-core (events, models, V3.view), 01-render (the real Orbit controller on a real THREE camera; its
// pointer / wheel listeners are fired through a fake canvas), 50-scene (the real house2 model: floor state + cutaway),
// 67-follow, 67-hud (on a small fake DOM). "real" stages add the embedded cabin (54-house-mc data), production nav
// (61-nav) and the real actor (65-girl-actor) on the bundled YSM rig, so she really walks beach → door → stairs → loft.
// Not driven here: WebGL rendering, the real frame loop (frames are pumped in the loop's order: ctl.update, then the
// 'frame' event), the block house scene part (no re-mesh on a floor change), real mouse picking, 69-arrange itself
// (V3.arrange.on is set by hand) — the browser script haibian-test/cabin-follow-browser.mjs covers those.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { requireGirlZip } from '../tools/lib/girl-asset.mjs';
requireGirlZip('follow-camera');   // 第三方模型不进仓库：没有就跳过

const SRC = process.env.FOLLOW_SRC_DIR ? { srcDir: path.resolve(process.env.FOLLOW_SRC_DIR) } : {};
const image = await readFile(new URL('../assets/house/house-v4.png', import.meta.url));
const asset = await readFile(new URL('../assets/girl/fatfish-1.2.zip', import.meta.url));
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
// Bytes left on the heap by n calls, after a warm-up long enough for the optimising compiler and a full collection
// (same budget style as test/a3-tick-churn.test.mjs).
function heapGrowth(fn, n) {
  for (let i = 0; i < 20000; i++) fn();
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < n; i++) fn();
  return process.memoryUsage().heapUsed - before;
}
// Steady per-frame garbage: the smallest of a few rounds. Something allocated on every call shows up in every round
// (≥ its size × n), so the minimum cannot hide it; what the minimum does drop is a one-off — V8 installing the optimised
// code in the middle of a round (seen about once in ten runs here: one round of 130–270 kB, the next ones a few hundred bytes).
function steadyGrowth(fn, n, rounds = 4) {
  let min = Infinity;
  for (let r = 0; r < rounds; r++) min = Math.min(min, heapGrowth(fn, n));
  return min;
}

// ---- just enough DOM for U.el and the HUD ----
class El {
  constructor(tag) {
    Object.assign(this, { tagName: String(tag).toUpperCase(), nodeType: 1, children: [], attrs: {}, listeners: {}, dataset: {}, parent: null, innerHTML: '', title: '' });
    this.style = { setProperty() {} }; this.cls = new Set(); this.text = '';
  }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const s = this.cls;
    return { add: (...n) => n.forEach(x => s.add(x)), remove: (...n) => n.forEach(x => s.delete(x)), contains: n => s.has(n),
      toggle: (n, f) => { const on = f === undefined ? !s.has(n) : !!f; if (on) s.add(n); else s.delete(n); return on; } };
  }
  get textContent() { return this.text + this.children.map(c => (c && c.nodeType ? c.textContent : String(c))).join(''); }
  set textContent(v) { this.children = []; this.text = String(v); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  append(...kids) { for (const c of kids) { if (c && c.nodeType) c.parent = this; this.children.push(c); } }
  prepend(...kids) { for (const c of kids) if (c && c.nodeType) c.parent = this; this.children.unshift(...kids); }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  click() { for (const fn of this.listeners.click || []) fn({ target: this, preventDefault() {}, stopPropagation() {} }); }
  all(pred, out = []) { for (const c of this.children) if (c && c.nodeType) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
}
class Doc extends EventTarget {
  constructor() { super(); this.hidden = false; this.readyState = 'complete'; this.body = new El('body'); }
  createElement(tag) { return new El(tag); }
  querySelector() { return null; }
}
// The canvas the Orbit controller listens on: fire(type, event) runs its real handlers.
function fakeCanvas() {
  const L = {};
  return {
    clientHeight: 700, clientWidth: 1000, listeners: L, added: 0,
    addEventListener(type, fn) { (L[type] ||= []).push(fn); this.added++; },
    setPointerCapture() {},
    fire(type, e) { for (const fn of L[type] || []) fn({ preventDefault() {}, pointerId: 1, button: 0, shiftKey: false, clientX: 0, clientY: 0, deltaY: 0, ...e }); },
  };
}
const lcg = (seed) => { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

// real: the embedded cabin + production nav + the real actor. Otherwise V3.actor is a stand-in { root: { position } }
// that the test moves by hand (V3.layout's house rectangle is the real one either way).
async function stage(t, { real = false, hud = false } = {}) {
  const document = new Doc();
  const base = ['01-render', '40-layout', '50-scene'];
  const cabin = ['03-vox', '10-zip', '11-molang', '12-nbt', '13-share', '15-mcmodel', '29-ysm', '42-house-mc', '44-furn-mc', '54-house-mc', '61-nav', '65-girl-actor'];
  const h = loadV3(base.concat(real ? cabin : []), { three: 'real', document, ...SRC });
  const { V3: V, window } = h, T = window.THREE;
  const winTypes = [];   // window listeners added by 67-*.js
  const add = window.addEventListener; window.addEventListener = (type, ...a) => { winTypes.push(type); return add(type, ...a); };
  h.load([/^67-(follow|hud)\.js$/]);
  window.addEventListener = add;
  // only her: the block house part, nav debug … are not built (their data is still loaded for nav and the layout)
  const parts = V.scene.parts; for (let i = parts.length - 1; i >= 0; i--) if (parts[i].id !== 'girl-actor') parts.splice(i, 1);
  if (real) {
    window.__V3_ASSETS = { [V.layout.house.asset]: image.toString('base64') };
    V.houseBlocks.store = { get: async () => null };
    await V.houseBlocks.load();
    const model = V.ysm.load(await V.zip.read(asset));
    model.textures = [];   // no browser image decode in this source-only test
    V.girlv1 = { build: () => V.ysm.build(model, { height: 1.25 }) };
    V.bubble = { say: () => true };
  }
  const camera = new T.PerspectiveCamera(30, 1000 / 700, 0.02, 400); camera.updateProjectionMatrix();
  const canvas = fakeCanvas(), ctl = new V.Orbit(camera, canvas);
  V.R = { camera, ctl, canvas, scene: new T.Scene(), renderer: { toneMappingExposure: 1 }, t: 0, frozen: null, freeze() {} };
  const fake = (x, y, z) => ({ root: { position: new T.Vector3(x, y, z) } });
  if (!real) V.actor = fake(-1.6, 0, -0.9);
  let inst = V.models.show('house2');
  ctl.set(inst.views.hero, false);
  if (real) V.viewTokens.girl('idle');   // she stays put until the test sends her somewhere
  if (hud) V.hud.mount();
  let time = 0;
  // one frame, in the order of the real loop (01-render): controller first, then the 'frame' event (model update, follow, HUD)
  const frame = (dt = 1 / 60) => { ctl.update(dt); time += dt; V.emit('frame', dt, time); };
  const run = (secs, dt = 1 / 60, each) => { for (let i = 0, n = Math.round(secs / dt); i < n; i++) { frame(dt); if (each) each(i); } };
  const floor = () => V.models.current().states.floor.value;
  const g = () => ({ az: ctl.g.az, el: ctl.g.el, dist: ctl.g.dist, target: ctl.g.target.toArray() });
  const feet = () => V.actor.root.position;
  // how far the look-at point is from her (horizontally): goal = what follow wrote, cam = where the camera really looks
  const lag = () => ({ goal: Math.hypot(ctl.g.target.x - feet().x, ctl.g.target.z - feet().z), cam: Math.hypot(ctl.target.x - feet().x, ctl.target.z - feet().z) });
  const headNdc = () => V.actor.head().project(camera);
  const find = (cls) => document.body.all(e => e.classList.contains(cls));
  t.after(() => { const m = V.models.current(); if (m && m.dispose) m.dispose(); assert.deepEqual(window.__errors, []); });
  return { h, V, T, window, document, camera, canvas, ctl, fake, frame, run, floor, g, feet, lag, headNdc, find, winTypes, get inst() { return V.models.current(); } };
}
// Real actor: walk to (x, z[, y]) and pump frames until she is there. each() runs after every frame.
function walkTo(s, x, z, y, each, { dt = 1 / 60, limit = 90 } = {}) {
  const a = s.V.actor;
  a.goto(x, z, y);
  assert.ok(a._dbg.path > 0, 'a route to ' + [x, z, y] + ' exists');
  const there = () => Math.hypot(s.feet().x - x, s.feet().z - z) < 0.12 && a._dbg.mode === 'idle';
  let n = 0;
  for (const max = Math.ceil(limit / dt); n < max && !there(); n++) { s.frame(dt); if (each) each(n); }
  assert.ok(there(), 'she arrived at ' + [x, z, y] + ': ' + JSON.stringify({ pos: a.pos, dbg: a._dbg }));
  return n * dt;
}

test('API and token exist; off by default; Orbit pans as before unless noPan is set', async t => {
  const s = await stage(t), { V, ctl } = s, F = V.follow;
  assert.equal(typeof F, 'object'); for (const k of ['on', 'set', 'toggle', 'state', 'available', 'tick']) assert.equal(typeof F[k], 'function', k);
  assert.equal(typeof V.viewTokens.follow, 'function');
  assert.equal(F.on(), false); assert.equal(F.available(), true);
  assert.deepEqual({ ...F.state(), az: 0, el: 0, dist: 0, target: 0 }, { on: false, active: false, suspended: false, zone: 'all', floor: 'all', az: 0, el: 0, dist: 0, target: 0 });
  assert.equal(ctl.noPan, false);
  // pan(): the old formula, untouched while noPan is false
  ctl.set({ az: 0.6, el: 0.4, dist: 20, target: [1, 2, 3] }, false);
  const c = s.camera, k = 2 * 20 * Math.tan(c.fov * Math.PI / 360) / 700;
  const want = new s.T.Vector3(1, 2, 3).addScaledVector(new s.T.Vector3().setFromMatrixColumn(c.matrix, 0), -30 * k).addScaledVector(new s.T.Vector3().setFromMatrixColumn(c.matrix, 1), 12 * k);
  ctl.pan(30, 12);
  assert.deepEqual(ctl.g.target.toArray(), want.toArray());
  ctl.noPan = true; ctl.pan(30, 12); assert.deepEqual(ctl.g.target.toArray(), want.toArray(), 'noPan: pan does nothing');
  ctl.rotate(10, 5); ctl.zoom(0.5); assert.equal(ctl.g.dist, 10); assert.ok(Math.abs(ctl.g.az - 0.52) < 1e-12, 'noPan leaves rotate / zoom alone');
});

test('follow off: the per-frame hook leaves the controller and the floor alone, and reads nothing', async t => {
  const s = await stage(t, { real: true }), { V, ctl } = s, a = V.actor;
  const before = s.g();
  a.place(-1.5, -9, 0, 1);                       // inside, ground floor
  s.run(1);
  walkTo(s, -3, -10, 1);
  a.place(0, 4, 0);                              // back on the beach
  s.run(1);
  assert.deepEqual(s.g(), before, 'goal view untouched');
  assert.equal(s.floor(), 'all'); assert.equal(ctl.noPan, false); assert.equal(V.follow.tick(1 / 60), false);
  assert.equal(V.follow.state().zone, 'all');

  // nothing is looked at while off: V3.actor is not even read by the frame hook
  const l = await stage(t); let reads = 0; const actor = l.V.actor;
  Object.defineProperty(l.V, 'actor', { configurable: true, get() { reads++; return actor; } });
  l.run(2); assert.equal(reads, 0, 'off: no V3.actor reads in 120 frames');
  l.V.follow.set(true); l.run(0.5); assert.ok(reads >= 30, 'on: read every frame (' + reads + ')');
  l.V.follow.set(false); reads = 0; l.run(1); assert.equal(reads, 0);
});

test('follow on: default view, and the look-at point stays with her while she walks and while she runs', async t => {
  const s = await stage(t, { real: true }), { V, ctl } = s, a = V.actor, F = V.follow, C = F.CONFIG;
  assert.deepEqual([C.dist, C.el, C.lift], [9, 0.55, 0.75]);
  const az0 = ctl.g.az;
  assert.equal(F.set(true), true); assert.equal(F.on(), true);
  s.frame();
  assert.equal(ctl.g.dist, 9); assert.equal(ctl.g.el, 0.55); assert.equal(ctl.g.az, az0, 'azimuth is the one the user had');
  assert.ok(ctl.g.dist < s.inst.views.hero.dist / 4, 'much closer than the hero view');
  s.run(2);                                       // fly in
  assert.ok(s.lag().cam < 0.01, 'settled on her: ' + s.lag().cam);
  assert.ok(Math.abs(ctl.target.y - (s.feet().y + 0.75)) < 0.01, 'looks at her middle (feet + 0.75 m)');
  assert.ok(Math.abs(ctl.dist - 9) < 0.01 && Math.abs(ctl.el - 0.55) < 0.001);
  assert.deepEqual(F.state().target.map(v => +v.toFixed(2)), [+s.feet().x.toFixed(2), +(s.feet().y + 0.75).toFixed(2), +s.feet().z.toFixed(2)]);

  // walking (1 m/s) across the beach
  const home = a.pos, goal = [[6, 4], [5, 5], [-6, 4], [4, 6], [-5, 5]].map(([dx, dz]) => [home[0] + dx, home[2] + dz]).find(([x, z]) => V.nav.walkable(x, z) && V.nav.path([home[0], home[2], home[1]], [x, z]));
  assert.ok(goal, 'a beach point 7 m away');
  const seen = { goal: 0, cam: 0, v: 0, ndc: 0, moving: 0 };
  const watch = () => {
    const v = a._dbg.v; if (v < 0.05) return;
    const l = s.lag(), n = s.headNdc();
    seen.moving++; seen.v = Math.max(seen.v, v); seen.goal = Math.max(seen.goal, l.goal); seen.cam = Math.max(seen.cam, l.cam); seen.ndc = Math.max(seen.ndc, Math.abs(n.x), Math.abs(n.y));
  };
  walkTo(s, goal[0], goal[1], undefined, watch);
  const walked = Math.hypot(a.pos[0] - home[0], a.pos[2] - home[2]);
  assert.ok(walked > 6, 'walked ' + walked.toFixed(2) + ' m'); assert.ok(seen.moving > 300 && seen.v > 0.95 && seen.v < 1.05, JSON.stringify(seen));
  assert.ok(seen.goal < 0.2, 'walking: goal point never further than 0.2 m from her (' + seen.goal.toFixed(3) + ')');
  assert.ok(seen.cam < 0.35, 'walking: the camera looks never further than 0.35 m from her (' + seen.cam.toFixed(3) + ')');
  assert.ok(seen.ndc < 0.45, 'walking: her head stays near the middle of the picture (' + seen.ndc.toFixed(3) + ')');
  s.run(2);
  assert.ok(s.lag().cam < 0.01, 'after she stops the camera closes the gap: ' + s.lag().cam);

  // running (1.5 m/s) to the computer
  a.place(-2.4, -7.5, 0, 1); s.run(2);
  Object.assign(seen, { goal: 0, cam: 0, v: 0, ndc: 0, moving: 0 });
  assert.equal(a.startBehavior('reply_private', { seconds: 1 }), true);
  for (let i = 0; i < 3600 && a.behavior && a.behavior.phase !== 'action'; i++) { s.frame(); watch(); }
  assert.equal(a.behavior && a.behavior.phase, 'action', 'she reached the desk');
  assert.ok(seen.v > 1.3, 'she ran: ' + seen.v.toFixed(2) + ' m/s');
  assert.ok(seen.goal < 0.3, 'running: goal point never further than 0.3 m (' + seen.goal.toFixed(3) + ')');
  assert.ok(seen.cam < 0.5, 'running: the camera looks never further than 0.5 m from her (' + seen.cam.toFixed(3) + ')');
  assert.ok(seen.ndc < 0.5, 'running: her head stays well inside the picture (' + seen.ndc.toFixed(3) + ')');
  s.run(2);                                       // seated at the desk: the look-at point settles on where she sits
  assert.ok(s.lag().cam < 0.02, 'seated: ' + s.lag().cam);
});

test('drag-orbit and wheel-zoom stick while following; pan is ignored and does not end it', async t => {
  const s = await stage(t), { V, ctl, canvas } = s, F = V.follow, p = s.feet();
  F.set(true); s.run(1.5);
  // real handlers: left-drag 60 px right / 30 px down, then a wheel notch towards her
  canvas.fire('pointerdown', { clientX: 500, clientY: 300 });
  canvas.fire('pointermove', { clientX: 560, clientY: 330 });
  canvas.fire('pointerup', {});
  canvas.fire('wheel', { deltaY: -300 });
  const mine = s.g();
  assert.ok(Math.abs(mine.az - (0.58 - 0.48)) < 1e-9); assert.ok(Math.abs(mine.el - (0.55 + 0.24)) < 1e-9); assert.ok(Math.abs(mine.dist - 9 * Math.exp(-0.36)) < 1e-9);
  s.run(4, 1 / 60, () => { p.x += 1 / 60; });      // she walks 4 m east meanwhile
  const now = s.g();
  assert.deepEqual([now.az, now.el, now.dist], [mine.az, mine.el, mine.dist], 'not snapped back, not drifted');
  assert.ok(Math.abs(ctl.az - mine.az) < 1e-3 && Math.abs(ctl.el - mine.el) < 1e-3 && Math.abs(ctl.dist - mine.dist) < 1e-3, 'the camera is at the user view');
  assert.ok(s.lag().cam < 0.25 && s.lag().goal < 0.15, 'and still on her: ' + JSON.stringify(s.lag()));

  // pan: shift-drag (and the pan half of a two-finger gesture) changes nothing; the zoom half of the pinch still works
  assert.equal(ctl.noPan, true);
  const t0 = ctl.g.target.toArray();
  canvas.fire('pointerdown', { clientX: 500, clientY: 300, shiftKey: true });
  assert.equal(ctl.mode, 'pan');
  canvas.fire('pointermove', { clientX: 620, clientY: 380, shiftKey: true });
  canvas.fire('pointerup', {});
  assert.deepEqual(ctl.g.target.toArray(), t0, 'shift-drag does not move the target');
  canvas.fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 300 }); canvas.fire('pointerdown', { pointerId: 2, clientX: 600, clientY: 300 });
  canvas.fire('pointermove', { pointerId: 2, clientX: 700, clientY: 340 });      // fingers apart (zoom in) and drifting
  canvas.fire('pointerup', { pointerId: 1 }); canvas.fire('pointerup', { pointerId: 2 });
  assert.deepEqual(ctl.g.target.toArray(), t0, 'pinch does not move the target');
  assert.ok(ctl.g.dist < mine.dist * 0.75, 'pinch still zooms');
  assert.equal(F.on(), true, 'pan did not end follow mode');
  s.run(1); assert.ok(s.lag().cam < 0.01);

  // off again: the same shift-drag pans
  F.set(false); assert.equal(ctl.noPan, false);
  canvas.fire('pointerdown', { clientX: 500, clientY: 300, shiftKey: true });
  canvas.fire('pointermove', { clientX: 620, clientY: 380, shiftKey: true });
  canvas.fire('pointerup', {});
  assert.ok(ctl.g.target.distanceTo(new s.T.Vector3(...t0)) > 0.2, 'pan works again once follow is off');
});

test('the cutaway follows her for real: beach → ground floor → loft → back out, one switch per crossing', async t => {
  const s = await stage(t, { real: true }), { V } = s, a = V.actor, F = V.follow, H = V.layout.house;
  let sets = 0; const setState = V.setState; V.setState = (k, v) => { if (k === 'floor') sets++; return setState(k, v); };
  const seq = ['all']; let frames = 0, worstNdc = 0;
  const each = () => {
    const f = s.floor(), p = s.feet(); frames++;
    if (f !== seq.at(-1)) seq.push(f);
    assert.equal(F.state().zone, f);
    const deep = p.x > H.x0 + 0.5 && p.x < H.x1 - 0.5 && p.z > H.z0 + 0.5 && p.z < H.z1 - 0.5;
    const out = p.x < H.x0 - 0.5 || p.x > H.x1 + 0.5 || p.z < H.z0 - 0.5 || p.z > H.z1 + 0.5;
    const where = JSON.stringify({ pos: a.pos.map(v => +v.toFixed(2)), floor: f });
    if (out) assert.equal(f, 'all', 'outside the house the roof is on ' + where);
    else if (deep && p.y < H.loftY - 1.2) assert.equal(f, 'ground', 'on the ground floor the house is cut to it ' + where);
    else if (deep && p.y > H.loftY - 0.7) assert.equal(f, 'loft', 'in the loft the roof is off ' + where);
    if (frames > 120) { const n = s.headNdc(); worstNdc = Math.max(worstNdc, Math.abs(n.x), Math.abs(n.y)); }
  };
  F.set(true); s.run(2, 1 / 60, each);
  assert.equal(s.floor(), 'all', 'she starts on the beach');
  const home = a.pos;
  walkTo(s, -1.5, -9.5, H.floorY, each);
  assert.equal(s.floor(), 'ground');
  const rnd = lcg(7); let up = null;
  for (let i = 0; i < 40 && !up; i++) { const q = V.nav.randomPoint('loft', rnd); if (q && q[2] > H.loftY - 0.3 && Math.abs(q[0]) < 5) up = q; }
  assert.ok(up, 'a loft point');
  walkTo(s, up[0], up[1], up[2], each);
  assert.ok(Math.abs(s.feet().y - H.loftY) < 0.3, 'she is up in the loft: y = ' + s.feet().y);
  assert.equal(s.floor(), 'loft');
  walkTo(s, home[0], home[2], undefined, each);
  assert.equal(s.floor(), 'all');
  assert.deepEqual(seq, ['all', 'ground', 'loft', 'ground', 'all'], 'no flip-flop at the door or on the stairs');
  assert.equal(sets, 4, 'the floor state was set exactly once per crossing');
  assert.ok(worstNdc < 0.6, 'her head never left the middle of the picture on the whole trip (' + worstNdc.toFixed(3) + ')');
  assert.ok(frames > 2000, 'a real walk: ' + frames + ' frames');
});

test('no flicker on a boundary: ±5 cm around the door line, the thresholds and the stairs band', async t => {
  const s = await stage(t), { V } = s, F = V.follow, p = s.feet(), H = V.layout.house, C = F.CONFIG;
  assert.deepEqual([H.x0, H.x1, H.z0, H.z1, H.floorY, H.loftY], [-7, 7, -16, -6, 1, 5], 'the real layout');
  assert.ok(C.inMargin + C.outMargin >= 0.5 && C.loftDown - C.loftUp >= 0.25, 'hysteresis bands are wider than any jitter');
  F.set(true);
  const settle = (x, y, z) => { p.set(x, y, z); s.run(0.2); return s.floor(); };
  // oscillate ±5 cm around `mid` on one axis for 240 frames → the floor values seen, in order
  const jitter = (axis, mid, frames = 240) => {
    const seq = [s.floor()];
    for (let i = 0; i < frames; i++) { p[axis] = mid + (i % 2 ? 0.05 : -0.05); s.frame(); if (s.floor() !== seq.at(-1)) seq.push(s.floor()); }
    return seq;
  };
  // the outer face of the south wall (the door line), coming from outside and from inside
  assert.equal(settle(-1.5, 1, -3), 'all'); assert.deepEqual(jitter('z', H.z1), ['all']);
  assert.equal(settle(-1.5, 1, -9), 'ground'); assert.deepEqual(jitter('z', H.z1), ['ground']);
  // exactly on the "came in" threshold (0.15 m inside) and on the "went out" threshold (0.45 m outside): one switch, then quiet
  assert.equal(settle(-1.5, 1, -3), 'all'); assert.deepEqual(jitter('z', H.z1 - C.inMargin), ['all', 'ground']);
  assert.deepEqual(jitter('z', H.z1 - C.inMargin), ['ground']);
  assert.deepEqual(jitter('z', H.z1 + C.outMargin), ['ground', 'all']);
  assert.deepEqual(jitter('z', H.z1 + C.outMargin), ['all']);
  // the other three walls behave the same
  for (const [axis, edge, sign, at] of [['x', H.x0, 1, [0, 1, -10]], ['x', H.x1, -1, [0, 1, -10]], ['z', H.z0, 1, [0, 1, 0]]]) {
    const outside = at.slice(); outside[axis === 'x' ? 0 : 2] = edge - sign * 3;
    assert.equal(settle(...outside), 'all'); assert.deepEqual(jitter(axis, edge), ['all'], axis + '=' + edge + ' from outside');
    const inside = at.slice(); inside[axis === 'x' ? 0 : 2] = edge + sign * 3; inside[2] = axis === 'x' ? -10 : inside[2];
    assert.equal(settle(...inside), 'ground'); assert.deepEqual(jitter(axis, edge), ['ground'], axis + '=' + edge + ' from inside');
  }
  // stairs: going up switches at loftY − 0.8, going down at loftY − 1.1; in between nothing moves either way
  assert.equal(settle(0, 1, -10), 'ground');
  assert.deepEqual(jitter('y', H.loftY - 0.95), ['ground'], 'mid-band from below');
  assert.deepEqual(jitter('y', H.loftY - C.loftUp), ['ground', 'loft']);
  assert.deepEqual(jitter('y', H.loftY - C.loftUp), ['loft']);
  assert.deepEqual(jitter('y', H.loftY - 0.95), ['loft'], 'mid-band from above');
  assert.deepEqual(jitter('y', H.loftY - C.loftDown), ['loft', 'ground']);
  assert.deepEqual(jitter('y', H.loftY - C.loftDown), ['ground']);
  // anywhere at all: jittering in place never goes back to a value it has just left
  const r = lcg(99);
  for (let i = 0; i < 300; i++) {
    const c = [-9 + r() * 18, r() * 6, -18 + r() * 14];
    p.set(...c); s.frame();
    const seq = [s.floor()];
    for (let k = 0; k < 40; k++) { p.set(c[0] + (r() - 0.5) * 0.1, c[1] + (r() - 0.5) * 0.1, c[2] + (r() - 0.5) * 0.1); s.frame(); if (s.floor() !== seq.at(-1)) seq.push(s.floor()); }
    assert.equal(new Set(seq).size, seq.length, 'point ' + c.map(v => v.toFixed(2)) + ' flickered: ' + seq);
  }
  // a house moved in arrange mode: the placed walls count, not the original ones
  V.houseBlocks = { placedLayout: () => ({ house: { ...H, x0: H.x0 + 20, x1: H.x1 + 20 } }) };
  assert.equal(settle(0, 1, -10), 'all', 'where the house used to be is outdoors now');
  assert.equal(settle(20, 1, -10), 'ground'); assert.equal(settle(20, 5, -10), 'loft');
  delete V.houseBlocks;
});

test('HUD: a fourth button 跟随 right of 阁楼; floor buttons show the applied cutaway; floor button / second press exit', async t => {
  const s = await stage(t, { hud: true }), { V, ctl } = s, F = V.follow, p = s.feet();
  const bar = s.find('hud-floors')[0];
  assert.ok(bar && !bar.classList.contains('hide'));
  assert.deepEqual(bar.children.map(b => b.textContent), ['外观', '一楼', '阁楼', '跟随']);
  const [all, ground, loft, follow] = bar.children;
  assert.deepEqual(s.find('hud-floor').filter(b => b.dataset.v).map(b => b.dataset.v), ['all', 'ground', 'loft'], 'the floor state still has three values');
  assert.deepEqual(s.inst.states.floor.options.map(o => o[0]), ['all', 'ground', 'loft']);
  assert.ok(follow.classList.contains('hud-follow') && follow.dataset.v === undefined);
  const lit = () => bar.children.filter(b => b.classList.contains('on')).map(b => b.textContent);
  assert.deepEqual(lit(), ['外观']); assert.equal(follow.getAttribute('aria-pressed'), 'false'); assert.equal(follow.classList.contains('hide'), false);

  follow.click();
  assert.equal(F.on(), true); assert.deepEqual(lit(), ['外观', '跟随']); assert.ok(bar.classList.contains('following')); assert.equal(follow.getAttribute('aria-pressed'), 'true');
  p.set(-1.5, 1, -9); s.run(1);
  assert.equal(s.floor(), 'ground'); assert.deepEqual(lit(), ['一楼', '跟随'], 'the floor buttons show which cutaway is applied');
  p.set(0, 5, -10); s.run(1);
  assert.deepEqual(lit(), ['阁楼', '跟随']);

  // a floor button: follow off, then exactly what it did before (that floor + fly to its preset view)
  all.click();
  assert.equal(F.on(), false); assert.equal(s.floor(), 'all'); assert.deepEqual(lit(), ['外观']); assert.equal(bar.classList.contains('following'), false);
  assert.deepEqual(s.g(), { ...s.inst.views.hero }, 'goal = the hero preset');
  s.run(2);                                      // she is still in the loft: nothing follows her any more
  assert.equal(s.floor(), 'all'); assert.deepEqual(s.g(), { ...s.inst.views.hero }); assert.ok(Math.abs(ctl.dist - 43) < 0.01, 'the camera flew to the preset');
  follow.click(); s.run(1); assert.equal(s.floor(), 'loft');
  ground.click();
  assert.equal(F.on(), false); assert.equal(s.floor(), 'ground'); assert.deepEqual(lit(), ['一楼']);
  assert.deepEqual(s.g(), { ...s.inst.views.inside });
  s.run(1); assert.equal(s.floor(), 'ground'); assert.deepEqual(s.g(), { ...s.inst.views.inside });
  follow.click(); s.run(1);
  loft.click();
  assert.equal(F.on(), false); assert.equal(s.floor(), 'loft'); assert.deepEqual(s.g(), { ...s.inst.views.loft });

  // pressing 跟随 again: off, the camera stays where it is, the floor stays what it was
  follow.click(); p.set(-1.5, 1, -9); s.run(2);
  ctl.rotate(40, 10); ctl.zoom(0.7); s.run(1);
  const here = s.g(), cam = s.camera.position.toArray();
  follow.click();
  assert.equal(F.on(), false); assert.deepEqual(lit(), ['一楼']); assert.equal(follow.getAttribute('aria-pressed'), 'false');
  p.set(3, 0, 6); s.run(2);
  assert.deepEqual(s.g(), here, 'the goal view is left alone'); assert.equal(s.floor(), 'ground');
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(s.camera.position.toArray()[i] - cam[i]) < 0.02, 'the camera did not move');

  // no character: the button is put away (and comes back with her); while follow is on it stays so it can be switched off
  const actor = V.actor;
  V.actor = null; assert.equal(F.available(), false);
  V.emit('state', s.inst); assert.equal(follow.classList.contains('hide'), true, 'hidden without a character');
  assert.equal(F.set(true), true); s.run(0.5);
  assert.equal(follow.classList.contains('hide'), false); assert.deepEqual(s.g(), here, 'nothing to follow: the camera waits');
  assert.equal(F.state().active, false);
  V.actor = actor; s.run(2);
  assert.ok(s.lag().cam < 0.02, 'she is back: followed again'); assert.equal(F.state().active, true);
  F.set(false);
  // a model without a floor state has no switcher at all
  V.models.register({ id: 'plain', build: () => ({ root: new s.T.Group() }) });
  V.models.show('plain'); assert.ok(bar.classList.contains('hide')); assert.equal(bar.children.length, 0);
  V.models.show('house2'); assert.deepEqual(bar.children.map(b => b.textContent), ['外观', '一楼', '阁楼', '跟随']);
});

test('choosing a floor elsewhere ends follow; follow=1 / follow=0 tokens snap the camera and apply the cutaway at once', async t => {
  const s = await stage(t), { V, ctl, window } = s, F = V.follow, p = s.feet();
  p.set(-1.5, 1, -9);
  F.set(true); s.run(1); assert.equal(s.floor(), 'ground');
  V.setState('floor', 'loft');                    // e.g. ?view=floor=loft or the feedback tool's floor select
  s.frame();
  assert.equal(F.on(), false, 'an explicit floor choice wins'); assert.equal(s.floor(), 'loft');
  s.run(1); assert.equal(s.floor(), 'loft');

  // tokens, through the real V3.view (frames are pumped meanwhile, as the page loop would)
  ctl.set(s.inst.views.hero, false); V.setState('floor', 'all'); p.set(2, 5, -11);
  const pump = setInterval(() => s.frame(), 1);
  try {
    await V.view('follow=1');
    assert.equal(F.on(), true); assert.equal(s.floor(), 'loft', 'cutaway applied by the token itself');
    assert.deepEqual(ctl.target.toArray(), [2, 5.75, -11], 'camera already there'); assert.equal(ctl.dist, 9); assert.equal(ctl.el, 0.55);
    assert.ok(Math.abs(s.camera.position.distanceTo(ctl.target) - 9) < 1e-6);
    await V.view('follow=0');
    assert.equal(F.on(), false); assert.equal(s.floor(), 'loft', 'follow=0 leaves the floor and the camera');
    assert.deepEqual(ctl.target.toArray(), [2, 5.75, -11]);
    await V.view('follow=1+hero');               // a preset view after it: its angle / distance, still on her
    assert.equal(F.on(), true); assert.equal(ctl.g.dist, 43);
    await V.view('follow=0+floor=all+hero');
    assert.equal(F.on(), false); assert.equal(s.floor(), 'all');
  } finally { clearInterval(pump); }
  assert.deepEqual(window.__errors, [], 'no "view token not understood"');
});

test('arrange mode and the feedback tool own the camera: follow is suspended, then resumes with its own view', async t => {
  const s = await stage(t), { V, ctl } = s, F = V.follow, p = s.feet();
  F.set(true); s.run(1.5);
  ctl.rotate(50, 20); ctl.zoom(0.8); s.run(1);
  const mine = s.g();
  V.arrange = { on: true };
  s.frame();
  assert.deepEqual({ on: F.on(), active: F.state().active, suspended: F.state().suspended }, { on: true, active: false, suspended: true });
  assert.equal(ctl.noPan, false, 'arrange can pan');
  ctl.set(s.inst.views.top, true); ctl.pan(40, 10);            // the user looks around while arranging
  const theirs = s.g();
  p.set(-1.5, 1, -9);                                          // she is put inside meanwhile
  s.run(2);
  assert.deepEqual(s.g(), theirs, 'follow does not touch the camera in arrange mode'); assert.equal(s.floor(), 'all', 'nor the floor');
  V.arrange.on = false;
  s.run(2.5);
  const back = s.g();
  assert.deepEqual([back.az, back.el, back.dist], [mine.az, mine.el, mine.dist], 'back to the view it had while following');
  assert.ok(s.lag().cam < 0.02 && Math.abs(ctl.dist - mine.dist) < 0.01, 'and on her again'); assert.equal(s.floor(), 'ground');
  assert.equal(F.state().active, true); assert.equal(ctl.noPan, true);

  V.fb = { enabled: true };
  p.set(4, 0, 5); s.run(1);
  assert.equal(F.state().suspended, true); assert.equal(s.floor(), 'ground'); assert.ok(s.lag().goal > 5, 'feedback tool: not followed');
  delete V.fb; s.run(2);
  assert.ok(s.lag().cam < 0.02); assert.equal(s.floor(), 'all');

  // switched on while arranging: nothing moves until arrange ends, then the default view
  F.set(false); ctl.set(s.inst.views.hero, false); V.arrange.on = true;
  F.set(true); s.run(1);
  assert.equal(ctl.g.dist, 43); assert.equal(F.state().active, false);
  V.arrange.on = false; s.run(2);
  assert.equal(ctl.g.dist, 9); assert.equal(ctl.g.el, 0.55); assert.ok(s.lag().cam < 0.02);
  // switched off while arranging: stays off afterwards
  V.arrange.on = true; s.frame(); F.set(false); V.arrange.on = false; p.set(-4, 0, 3); s.run(1);
  assert.ok(s.lag().goal > 5); assert.equal(F.on(), false);
});

test('a new V3.actor, a body swap and a scene rebuild are picked up (no stale reference)', async t => {
  const s = await stage(t, { real: true, hud: true }), { V, ctl } = s, F = V.follow;
  F.set(true); s.run(2);
  const a0 = V.actor, root0 = a0.root;
  assert.ok(s.lag().cam < 0.02);
  // body swap: same actor API, new root object
  assert.equal(a0.useBody('v1', null), true);
  assert.notEqual(V.actor.root, root0, 'a new body root');
  a0.place(4, 5, 0); s.run(2);
  assert.ok(Math.hypot(s.feet().x - 4, s.feet().z - 5) < 0.6 && s.lag().cam < 0.02, 'follows the new body: ' + JSON.stringify(s.lag()));
  // scene rebuild (house change / model re-show): a new model, a new V3.actor
  const m0 = s.inst;
  V.models.show('house2'); V.viewTokens.girl('idle');
  assert.notEqual(s.inst, m0); assert.notEqual(V.actor, a0); assert.ok(V.actor && V.actor.root);
  assert.equal(F.on(), true, 'still on after the rebuild');
  const bar = s.find('hud-floors')[0];
  assert.deepEqual(bar.children.filter(b => b.classList.contains('on')).map(b => b.textContent), ['外观', '跟随'], 'the rebuilt switcher shows it');
  s.run(2);
  assert.ok(s.lag().cam < 0.02, 'follows the new actor'); assert.equal(s.floor(), 'all');
  V.actor.place(-1.5, -9, 0, 1); s.run(2);
  assert.equal(s.floor(), 'ground', 'the new model is cut to where she is'); assert.ok(s.lag().cam < 0.02);
  assert.equal(F.on(), true, 'the rebuilt model starting at 外观 was not mistaken for a floor choice');
  // any replacement object is read on the next frame
  const real = V.actor; V.actor = s.fake(6, 0, 8); s.run(2);
  assert.ok(Math.hypot(ctl.target.x - 6, ctl.target.z - 8) < 0.02); assert.equal(s.floor(), 'all');
  V.actor = real;
});

test('the per-frame update allocates nothing, on or off, and keeps the controller objects', async t => {
  const s = await stage(t), { V, ctl } = s, F = V.follow, p = s.feet();
  const goal = ctl.g, target = ctl.g.target, cam = ctl.target;
  const BUDGET = 16 * 1024;   // over 20000 frames: under 1 byte a frame. One boxed number per frame would be ≥ 240 kB, one [x, y, z] ≥ 800 kB
  let i = 0;
  // on, outdoors: she walks a loop on the beach (no floor change: V3.setState is not part of the per-frame cost)
  F.set(true); s.run(1);
  const outdoors = () => { i++; p.x = 2 + Math.sin(i * 0.01) * 3; p.z = 4 + Math.cos(i * 0.013) * 2; F.tick(1 / 60); };
  let bytes = steadyGrowth(outdoors, 20000);
  assert.ok(bytes < BUDGET, 'on / outdoors: heap grew ' + bytes + ' bytes over 20000 frames (' + (bytes / 20000).toFixed(2) + ' B/frame)');
  assert.equal(s.floor(), 'all');
  // the measurement does see per-frame garbage: the same loop with one small array a frame is far over the budget in every round
  let sink = null;
  const leaky = () => { sink = [p.x, p.y, p.z]; outdoors(); };
  bytes = steadyGrowth(leaky, 20000);
  assert.ok(bytes > 20 * BUDGET && sink.length === 3, 'control: one array per frame is detected (' + bytes + ' bytes)');
  // on, indoors on the ground floor
  p.set(0, 1, -10); s.run(0.5); assert.equal(s.floor(), 'ground');
  const indoors = () => { i++; p.x = Math.sin(i * 0.01) * 4; p.z = -10 + Math.cos(i * 0.013) * 2; F.tick(1 / 60); };
  bytes = steadyGrowth(indoors, 20000);
  assert.ok(bytes < BUDGET, 'on / indoors: heap grew ' + bytes + ' bytes over 20000 frames');
  assert.equal(s.floor(), 'ground');
  // it was really following during those frames: the stand-in moves at up to 2.9 m/s here, so the goal point trails by at
  // most speed / rate ≈ 0.36 m (+ one frame) — and closes the gap as soon as she stands still
  assert.ok(Math.hypot(target.x - p.x, target.z - p.z) < 0.45, 'following during the measured frames: ' + Math.hypot(target.x - p.x, target.z - p.z));
  for (let k = 0; k < 120; k++) F.tick(1 / 60);
  assert.ok(Math.hypot(target.x - p.x, target.z - p.z) < 1e-3, 'and on her once she stops');
  // suspended (arrange) and off
  V.arrange = { on: true };
  bytes = steadyGrowth(outdoors, 20000); assert.ok(bytes < BUDGET, 'suspended: ' + bytes);
  V.arrange.on = false; F.set(false);
  bytes = steadyGrowth(outdoors, 20000); assert.ok(bytes < BUDGET, 'off: ' + bytes);
  assert.equal(ctl.g, goal); assert.equal(ctl.g.target, target); assert.equal(ctl.target, cam, 'same goal / target objects as before: written in place');

  // and with the real actor API (its root getter) + the real placed layout
  const r = await stage(t, { real: true });
  r.V.follow.set(true); r.run(1);
  bytes = steadyGrowth(() => { r.V.follow.tick(1 / 60); }, 20000);
  assert.ok(bytes < BUDGET, 'real actor: heap grew ' + bytes + ' bytes over 20000 frames');
});

test('follow adds no pointer / window listeners: clicks, hover and poke keep their own handlers', async t => {
  const s = await stage(t), { V, canvas } = s;
  assert.deepEqual(s.winTypes, ['keydown'], 'only the HUD\'s Esc handler listens on window (as before)');
  const n = canvas.added, types = Object.keys(canvas.listeners).sort();
  assert.deepEqual(types, ['contextmenu', 'pointercancel', 'pointerdown', 'pointermove', 'pointerup', 'wheel'], 'the Orbit controller\'s own');
  V.follow.set(true); s.run(1); V.follow.set(false); V.follow.set(true); s.run(0.5);
  assert.equal(canvas.added, n, 'nothing added to the canvas'); assert.deepEqual(s.document.body.listeners, {}); assert.equal(V.R.ctl.enabled, true);
  // a click (press + release without moving) leaves the view alone
  const before = s.g();
  canvas.fire('pointerdown', { clientX: 300, clientY: 300 }); canvas.fire('pointerup', { clientX: 300, clientY: 300 });
  s.frame();
  assert.deepEqual([s.g().az, s.g().el, s.g().dist], [before.az, before.el, before.dist]);
});
