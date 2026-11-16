// "吃饭的时候碗没有端到桌子上去": the bowl of her meal travels with her. Counter → her hand (pickup, walking to the chair) →
// the dining table in front of her chair while she eats → gone when she has finished; back on the counter if the meal is cancelled.
//
// Real modules together, no build, no browser, no server:   node --test test/meal-bowl-carry.test.mjs
//   same harness as test/meal-cooker-link.test.mjs: real cabin model + 54-house-mc data, real 61-nav, real 65 actor on the bundled
//   YSM rig, real 50-scene ctx, real 56-furn-ground kitchen overlay (counter dishes + their rice) and loose bowl, real 69-furniture-play.
// All positions asserted here are WORLD positions read from the three.js objects; "shown" means the object and every parent is visible.
// Not driven here: WebGL rendering (what it looks like: _work/…/closeup.mjs screenshots), the house scene part itself (the dining table
//   and the counter bowl of the block model are not built: the table is known by its block cell and the authored heights below),
//   real mouse picking (91-cabin).
// BOWL_SRC_DIR=<dir> loads the modules from another src directory (used once to confirm these fail on the old files).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { loadV3 } from '../tools/lib/v3-node.mjs';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
// Bytes left on the heap by n calls, after a warm-up and a full collection (same measure as test/a3-tick-churn.test.mjs).
// On the real house the furniture update needs a long warm-up before the optimising compiler has settled.
function heapGrowth(fn, n, warm = 20000) {
  for (let i = 0; i < warm; i++) fn();
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < n; i++) fn();
  return process.memoryUsage().heapUsed - before;
}

const SRC = process.env.BOWL_SRC_DIR ? { srcDir: path.resolve(process.env.BOWL_SRC_DIR) } : {};
const image = await readFile(new URL('../assets/house/house-v4.png', import.meta.url));
const asset = await readFile(new URL('../assets/girl/fatfish-1.2.zip', import.meta.url));
const MODULES = ['03-vox', '10-zip', '11-molang', '12-nbt', '13-share', '15-mcmodel', '16-mcmesh', '17-mcfallback', '29-ysm', '40-layout', '42-house-mc', '44-furn-mc',
  '50-scene', '54-house-mc', '56-furn-ground', '61-nav', '65-girl-actor', '69-furniture-play'];
// Authored sizes (56-furn-ground / the dining_table block model): cloth 20/32 m above the floor, plates 1/32 m thick; the bowl is
// 1/128 m voxels, 7.3 wide at the rim, standing on a 3.2 voxel foot.
const CLOTH = 20 / 32, PLATE = 21 / 32, RIM = 7.3 / 128;

const paint = new Proxy({}, { get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => ({ data: [], addColorStop() {} })), set: () => true });
class El {
  constructor(tag) { Object.assign(this, { tagName: tag, nodeType: 1, children: [], attrs: {}, style: {}, listeners: {}, className: '', textContent: '', parent: null, width: 0, height: 0 }); }
  get classList() { return { contains: name => this.className.split(/\s+/).includes(name) }; }
  getContext() { return paint; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  append(...kids) { for (const c of kids) { if (c && c.nodeType) c.parent = this; this.children.push(c); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  all(pred, out = []) { for (const c of this.children) if (c && c.nodeType) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  querySelector(sel) { return this.all(c => c.classList.contains(sel.replace(/^\./, '')))[0] || null; }
}
class Doc extends EventTarget {
  constructor() { super(); this.hidden = false; this.body = new El('body'); }
  createElement(tag) { return new El(tag); }
}
const fakeStore = () => ({
  data: new Map(),
  get length() { return this.data.size; },
  key(i) { return [...this.data.keys()][i] ?? null; },
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; },
  setItem(k, v) { this.data.set(k, String(v)); },
  removeItem(k) { this.data.delete(k); },
});
const READY = { phase: 'ready', remaining: 0, bowl: false }, IDLE = { phase: 'idle', remaining: 0, bowl: false }, SERVED = { phase: 'idle', remaining: 0, bowl: true };
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), flat = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]);

// saved: the cooker state found in localStorage when the page opens. The scene (root, ctx, parts) can be torn down and built again.
async function cabin(t, { saved } = {}) {
  const store = fakeStore(), toasts = [], events = [], document = new Doc();
  const h = loadV3(MODULES, { three: 'real', document, globals: { localStorage: store }, ...SRC });
  const { V3: V, window } = h, T = window.THREE, HB = V.houseBlocks, F = V.furniturePlay;
  window.__V3_ASSETS = { [V.layout.house.asset]: image.toString('base64') };
  HB.store = { get: async () => null };
  await HB.load();
  const KEY = 'cooker:' + HB.furnInstances('kitchen_counter')[0].cell.join(','), houseKey = F.houseKey(HB.model);
  if (saved) store.data.set(houseKey, JSON.stringify({ [KEY]: saved }));
  const model = V.ysm.load(await V.zip.read(asset));
  model.textures = []; // no browser image decode in this source-only test
  V.girlv1 = { build: () => V.ysm.build(model, { height: 1.25 }) };
  V.bubble = { say() { return true; } };
  V.hud = { toast: text => toasts.push(text) };
  V.on('actor:behavior', e => events.push(e.phase));
  const part = id => V.scene.parts.find(p => p.id === id), ground = part('furn-ground'), actorPart = part('girl-actor'), play = part('furniture-play');
  const c = { V, T, HB, F, window, store, toasts, events, KEY, trace: [] };
  let time = 0;
  c.build = async () => {
    const root = new T.Group(), ctx = V.scene.ctx(root);
    root.add(ground.build(ctx));
    for (const o of actorPart.build(ctx)) root.add(o);
    root.add(play.build(ctx));
    await Promise.all(ctx._waits);
    assert.equal(F.state().ready, true);
    V.viewTokens.girl('idle');
    Object.assign(c, { root, ctx, a: V.actor, built: true });
    // the counter dishes: every rice mesh of the kitchen overlay, and the counter bowl (the group the bowl's rice hangs in)
    c.rice = []; c.home = null;
    root.traverse(o => { if (o.userData.furn === 'kitchen' && o.userData.cell) o.traverse(m => { if (m.isMesh && m.name === 'vox:rice') c.rice.push(m); if (m.name === 'furn:bowl') c.home = m; }); });
    assert.equal(c.rice.length, 2, 'the kitchen overlay carries the rice of the bowl and of the basin');
    assert.ok(c.home, 'and the counter bowl');
    return c;
  };
  c.dispose = () => { if (!c.built) return; c.built = false; c.ctx.dead = true; ground.dispose(c.ctx); actorPart.dispose(); play.dispose(c.ctx); };
  const v3 = new T.Vector3();
  const world = o => { c.root.updateMatrixWorld(true); return o.getWorldPosition(v3).toArray(); };
  c.shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  c.inScene = o => { for (let p = o; p; p = p.parent) if (p === c.root) return true; return false; };
  c.cooker = () => F.state().items.find(r => r.key === KEY).state;
  c.counterRice = () => c.rice.filter(c.shown).length;                       // rice meshes really drawn on the counter
  c.bowlObj = () => { let b = null; c.root.traverse(o => { if (o.name === 'furniture-play:bowl') { assert.equal(b, null, 'one travelling bowl at most'); b = o; } }); return b; };
  c.bowl = () => {                                                           // the travelling bowl as drawn: null, or its world position (foot centre)
    const b = c.bowlObj(); if (!b || !c.shown(b)) return null;
    const rice = []; b.traverse(m => { if (m.isMesh && m.name === 'vox:rice') rice.push(m); });
    assert.ok(rice.length === 1 && c.shown(rice[0]), 'a travelling bowl always shows its rice');
    return world(b);
  };
  c.homeAt = () => world(c.home);
  c.hand = () => c.a.hand().toArray();
  c.frame = () => {
    actorPart.update(0.05); time += 0.05; play.update(0.05, time);
    const b = c.a.behavior;
    c.trace.push({ at: b ? b.phase : '', bowl: c.bowl(), counter: c.counterRice(), hand: c.hand(), pos: c.a.pos.slice(), state: c.cooker().bowl });
  };
  c.step = secs => { for (let i = 0; i < Math.ceil(secs / 0.05); i++) c.frame(); };
  c.until = (fn, limit = 90) => {
    for (let i = 0; i < Math.ceil(limit / 0.05); i++) { if (fn()) return; c.frame(); }
    assert.ok(fn(), JSON.stringify({ behavior: c.a.behavior, pos: c.a.pos, cooker: c.cooker(), events, toasts }));
  };
  c.press = action => F.action(KEY, action);
  c.phase = name => c.trace.filter(x => x.at === name);
  // the dining table she sits at and her chair, from the house blocks (cell centres; y = floor)
  c.table = () => { const it = HB.furnInstances('dining_table')[0]; return [it.cell[0] + 0.5, it.cell[1], it.cell[2] + 0.5]; };
  c.chair = () => HB.furnInstances('dining_chair').map(it => [it.cell[0] + 0.5, it.cell[1], it.cell[2] + 0.5]).sort((p, q) => flat(p, c.a.pos) - flat(q, c.a.pos))[0];
  t.after(() => { c.dispose(); assert.deepEqual(window.__errors, []); });
  return c.build();
}
// The bowl stands on the table, on her side: inside the footprint with its whole rim, on the cloth or on a plate (never below the
// cloth, never above a plate), between the middle of the table and her chair, straight in front of her.
function onTable(c, at, top) {
  const tb = c.table(), ch = c.chair();
  assert.ok(Math.abs(at[0] - tb[0]) <= 0.5 - RIM && Math.abs(at[2] - tb[2]) <= 0.5 - RIM, 'inside the table top: ' + at);
  const up = at[1] - tb[1];
  assert.ok(up >= CLOTH - 1e-6 && up <= PLATE + 1e-6, 'standing on the table top, not sunk into it and not hovering: ' + up);
  if (top != null) assert.ok(Math.abs(up - top) < 1e-6, 'exactly on ' + (top === PLATE ? 'the plate' : 'the cloth') + ': ' + up);
  assert.ok(flat(at, ch) < flat(tb, ch) - 0.2, 'on her side of the table');
  assert.ok(flat(at, tb) > 0.15, 'not in the vase in the middle');
  const fx = (tb[0] - ch[0]) / flat(tb, ch), fz = (tb[2] - ch[2]) / flat(tb, ch);   // chair → table
  assert.ok(Math.abs((at[0] - ch[0]) * fz - (at[2] - ch[2]) * fx) < 0.01, 'straight in front of her chair');
}

test('盛到碗里: the bowl leaves the counter in her hand, stands on the table in front of her while she eats, and is gone when she has finished', async t => {
  const c = await cabin(t, { saved: READY }), { a, T } = c;
  assert.equal(c.counterRice(), 0); assert.equal(c.bowl(), null);
  let taken = null;   // the moment she takes it (this listener runs after the cooker's)
  c.V.on('actor:meal', () => { taken = { bowl: c.bowl(), home: c.homeAt(), counter: c.counterRice(), state: c.cooker() }; });
  assert.equal(c.press('serve'), true);
  c.until(() => a.behavior === null);
  assert.deepEqual(c.events, ['started', 'action', 'completed']);
  assert.deepEqual([...new Set(c.trace.map(x => x.at))], ['to_counter', 'face_counter', 'pickup', 'to_chair', 'sit', 'action', '']);

  // before the pickup: nothing on the counter, nothing travelling
  const before = c.trace.filter(x => x.at === 'to_counter' || x.at === 'face_counter');
  assert.ok(before.length > 100);
  assert.ok(before.every(x => !x.state && x.counter === 0 && x.bowl === null), 'no rice anywhere before she reaches the counter');

  // the pickup: the rice is served into the travelling bowl, which starts exactly where the counter bowl stands
  assert.deepEqual(taken.state, SERVED);
  assert.equal(taken.counter, 0, 'the served rice is not left on the counter');
  assert.ok(taken.bowl && dist(taken.bowl, taken.home) < 1e-6, 'it starts where the counter bowl stands: ' + taken.bowl + ' / ' + taken.home);
  const pickup = c.phase('pickup');
  assert.ok(pickup.length >= 20 && pickup.every(x => x.bowl && x.counter === 0 && x.state));
  assert.ok(dist(pickup[0].bowl, taken.home) < 0.05 && dist(pickup.at(-1).bowl, pickup.at(-1).hand) < 1e-6, 'lifted from the counter into her hand');
  for (let i = 1; i < pickup.length; i++) assert.ok(dist(pickup[i].bowl, pickup[i - 1].bowl) < 0.15, 'lifted smoothly, no jump');

  // walking to the chair: in her hand, every frame
  const walk = c.phase('to_chair');
  assert.ok(walk.length > 40, 'she really walks: ' + walk.length);
  for (const x of walk) {
    assert.ok(x.bowl && x.counter === 0 && x.state, 'travelling, not on the counter');
    assert.ok(dist(x.bowl, x.hand) < 1e-6, 'in her hand: ' + dist(x.bowl, x.hand));
    assert.ok(flat(x.bowl, x.pos) < 0.45 && x.bowl[1] > x.pos[1] + 0.2 && x.bowl[1] < x.pos[1] + 0.8, 'at her side, between knee and shoulder');
  }
  const moved = flat(walk[0].bowl, walk.at(-1).bowl), walked = flat(walk[0].pos, walk.at(-1).pos);
  assert.ok(walked > 1.5 && Math.abs(moved - walked) < 0.6, 'the bowl covers the same ground as she does: ' + moved + ' / ' + walked);
  assert.ok(flat(walk.at(-1).bowl, taken.home) > 1.5, 'and is far from the counter by then');

  // seated: put down on the table (a short glide while she sits down), then it stands still for the whole meal
  const sit = c.phase('sit'), eat = c.phase('action');
  assert.ok(sit.length >= 8 && sit.every(x => x.bowl && x.counter === 0));
  for (let i = 1; i < sit.length; i++) assert.ok(dist(sit[i].bowl, sit[i - 1].bowl) < 0.35, 'put down, not teleported');
  assert.ok(eat.length >= 479, '24 s of eating: ' + eat.length);
  for (const x of eat) {
    assert.ok(x.bowl && x.counter === 0 && x.state);
    assert.ok(dist(x.bowl, eat[0].bowl) < 1e-9, 'the bowl stands still while she eats');
  }
  onTable(c, eat[0].bowl, PLATE);   // her chair is in line with a plate: the bowl stands on it
  assert.ok(dist(eat[0].bowl, eat[0].hand) > 0.3, 'it is on the table, not in her hand');

  // from the pickup to the last bite the rice is drawn in exactly one place
  const meal = c.trace.filter(x => ['pickup', 'to_chair', 'sit', 'action'].includes(x.at));
  assert.ok(meal.every(x => x.state && x.bowl && x.counter === 0));
  // finished: nothing left
  assert.deepEqual(c.cooker(), IDLE);
  assert.equal(c.bowl(), null, 'the bowl on the table is gone'); assert.equal(c.counterRice(), 0);
  assert.ok(c.trace.filter(x => x.at === '').every(x => x.bowl === null && x.counter === 0));

  // one object for the whole meal, upright, never a click target; nothing is created per frame
  const obj = c.bowlObj(); assert.ok(obj, 'the travelling bowl is kept (hidden) for the next meal');
  assert.ok(new T.Vector3(0, 1, 0).applyQuaternion(obj.getWorldQuaternion(new T.Quaternion())).y > 0.9999, 'right way up');
  const meshes = []; obj.traverse(m => { if (m.isMesh) meshes.push(m); });
  assert.deepEqual(meshes.map(m => m.name).sort(), ['vox:rice', 'vox:root']);
  const box = new T.Box3().setFromObject(obj), size = box.getSize(new T.Vector3());
  assert.ok(Math.abs(size.x - 2 * RIM) < 0.012 && Math.abs(size.z - 2 * RIM) < 0.012 && size.y > 0.07 && size.y < 0.11, 'the size of the counter bowl: ' + size.toArray());
  assert.ok(Math.abs(box.min.y - obj.getWorldPosition(new T.Vector3()).y) < 1e-6, 'its origin is the underside of its foot');
});

test('a second meal reuses the same bowl object; hover outline, click targets and the panel are untouched by it', async t => {
  const c = await cabin(t, { saved: READY }), { a, F, T } = c;
  const hover0 = F.hoverObjects({ key: c.KEY }), cand0 = F.candidates();
  assert.equal(c.press('serve'), true);
  c.until(() => a.behavior?.phase === 'to_chair'); c.step(0.5);
  const obj = c.bowlObj(); assert.ok(obj && c.bowl());
  const count = () => { let n = 0; c.root.traverse(() => n++); return n; }, n0 = count();
  // not a click target: nothing of it in the candidates, rays pass through it, and it is flagged for the pickers
  const cand = F.candidates(), mine = new Set(); obj.traverse(o => mine.add(o));
  assert.deepEqual(cand, cand0); assert.ok(cand.every(o => !mine.has(o)));
  assert.deepEqual(F.hoverObjects({ key: c.KEY }), hover0, 'the cooker outline is the same while the bowl travels');
  const at = c.bowl(), ray = new T.Raycaster(new T.Vector3(at[0], at[1] + 1, at[2]), new T.Vector3(0, -1, 0));
  c.root.updateMatrixWorld(true);
  assert.equal(ray.intersectObject(obj, true).length, 0, 'a ray straight down through the bowl hits nothing of it');
  obj.traverse(o => { if (o.isMesh) assert.equal(o.userData.noPick, true); });
  for (let o = obj; o && o !== c.root; o = o.parent) assert.ok(!o.userData.clickable && !o.userData.furnitureKey);
  // the panel still works while she carries it
  assert.equal(F.activate({ obj: { userData: { furnitureKey: c.KEY } } }), true);
  assert.match(c.window.document.body.children.find(e => e && e.className === 'furniture-panel').querySelector('.fp-status').textContent, /碗里有饭.*小鲸鱼正在吃饭/);
  c.until(() => a.behavior?.phase === 'action'); c.step(1);
  assert.equal(count(), n0, 'no object is added to the scene while the bowl travels');
  c.until(() => a.behavior === null);
  assert.deepEqual(c.cooker(), IDLE); assert.equal(c.bowl(), null);

  assert.equal(c.press('cook'), true); c.step(30.2); assert.deepEqual(c.cooker(), READY);
  c.until(() => c.press('eat'), 10);   // she answers the cook line for a moment first
  c.trace.length = 0;
  c.until(() => a.behavior === null);
  assert.equal(c.bowlObj(), obj, 'the same object');
  assert.equal(count(), n0);
  const eat = c.phase('action');
  assert.ok(eat.length >= 479); onTable(c, eat.at(-1).bowl, PLATE);
  assert.ok(c.phase('to_counter').every(x => x.bowl === null), 'hidden until she takes it again');
  assert.deepEqual(c.cooker(), IDLE);
});

test('cancelled after the pickup: the travelling bowl is gone at once, the counter shows the served bowl, and 吃饭 retries', async t => {
  const c = await cabin(t, { saved: READY }), { a, V } = c;
  // (1) while she carries it
  assert.equal(c.press('serve'), true);
  c.until(() => a.behavior?.phase === 'to_chair'); c.step(1);
  assert.ok(c.bowl()); assert.equal(c.counterRice(), 0);
  assert.equal(a.cancelBehavior('test'), true);
  assert.equal(c.bowl(), null, 'gone in the same call, not a frame later');
  assert.equal(c.counterRice(), 2, 'the counter shows the served rice again'); assert.deepEqual(c.cooker(), SERVED);
  assert.match(c.toasts.at(-1), /碗里的饭还在/);
  c.step(3);
  assert.equal(c.bowl(), null); assert.equal(c.counterRice(), 2); assert.equal(a.mealBowl(new c.T.Vector3()), 0);

  // (2) retry, then the player opens arrange mode while she eats: off the table, back on the counter
  assert.equal(c.press('eat'), true);
  c.until(() => a.behavior?.phase === 'pickup');
  assert.ok(c.bowl()); assert.equal(c.counterRice(), 0);
  c.until(() => a.behavior?.phase === 'action'); c.step(2);
  onTable(c, c.bowl());
  V.arrange = { on: true }; c.frame();
  assert.equal(a.behavior, null);
  assert.equal(c.bowl(), null, 'no bowl left on the table'); assert.equal(c.counterRice(), 2); assert.deepEqual(c.cooker(), SERVED);
  V.arrange = null; c.step(1);

  // (3) retry, poked at the table; (4) the page is hidden on the way to the chair
  assert.equal(c.press('eat'), true);
  c.until(() => a.behavior?.phase === 'action'); c.step(1);
  assert.ok(a.poke()); assert.equal(c.bowl(), null); assert.equal(c.counterRice(), 2);
  c.step(5);
  assert.equal(c.press('eat'), true);
  c.until(() => a.behavior?.phase === 'to_chair'); c.step(0.5); assert.ok(c.bowl());
  c.window.document.hidden = true; c.frame();
  assert.equal(a.behavior, null); assert.equal(c.bowl(), null); assert.equal(c.counterRice(), 2); assert.deepEqual(c.cooker(), SERVED);
  c.window.document.hidden = false; c.step(1);

  // (5) and finally she eats it
  assert.equal(c.press('eat'), true);
  c.until(() => a.behavior === null);
  assert.deepEqual(c.cooker(), IDLE); assert.equal(c.bowl(), null); assert.equal(c.counterRice(), 0);
  assert.equal(c.events.filter(e => e === 'completed').length, 1);
  assert.equal(c.events.filter(e => e === 'cancelled').length, 4);
});

test('a served bowl nobody carries stays on the counter; the instant fallback and a cold pot never show a travelling bowl', async t => {
  const c = await cabin(t, { saved: SERVED }), { a, HB } = c, furn = HB.furnInstances;
  assert.equal(c.counterRice(), 2); assert.equal(c.bowlObj(), null, 'loaded served: on the counter, no travelling bowl is even built');
  c.step(2); assert.equal(c.counterRice(), 2); assert.equal(c.bowlObj(), null);
  // she cannot act it out (no dining chair): the state flips at once and the rice is simply on / off the counter
  HB.furnInstances = id => id === 'dining_chair' ? [] : furn(id);
  assert.equal(c.press('eat'), true); assert.deepEqual(c.cooker(), IDLE); assert.equal(c.counterRice(), 0);
  assert.equal(c.press('cook'), true); c.step(30.2);
  assert.equal(c.press('serve'), true); assert.deepEqual(c.cooker(), SERVED);
  assert.equal(c.counterRice(), 2); assert.equal(c.bowlObj(), null); assert.equal(a.behavior, null);
  assert.equal(c.press('eat'), true); assert.deepEqual(c.cooker(), IDLE); assert.equal(c.counterRice(), 0); assert.equal(c.bowlObj(), null);
  HB.furnInstances = furn;
  // a meal without cooked rice (a direct host call on a cold pot): she eats, no bowl is invented
  c.step(4);
  assert.ok(a.startBehavior('eat')); c.trace.length = 0;
  c.until(() => a.behavior === null);
  assert.ok(c.phase('action').length >= 479);
  assert.ok(c.trace.every(x => x.bowl === null && x.counter === 0 && !x.state)); assert.equal(c.bowlObj(), null);
});

test('a meal nobody pressed a button for (lunch routine, AI tag: startBehavior) carries the bowl too when a cooker has rice', async t => {
  for (const saved of [READY, SERVED]) {
    const c = await cabin(t, { saved }), { a } = c;
    assert.ok(a.startBehavior('eat'));
    c.until(() => a.behavior === null);
    const walk = c.phase('to_chair'), eat = c.phase('action');
    assert.ok(walk.length > 40 && walk.every(x => x.bowl && x.counter === 0 && dist(x.bowl, x.hand) < 1e-6), 'in her hand on the way');
    assert.ok(eat.length >= 479 && eat.every(x => x.bowl && x.counter === 0)); onTable(c, eat.at(-1).bowl, PLATE);
    // a bowl that was already served waits on the counter until she takes it
    const before = c.trace.filter(x => x.at === 'to_counter' || x.at === 'face_counter');
    assert.ok(before.every(x => x.bowl === null && x.counter === (saved.bowl ? 2 : 0)));
    assert.deepEqual(c.cooker(), IDLE); assert.equal(c.bowl(), null); assert.equal(c.counterRice(), 0);
  }
});

test('the table spot follows the furniture: from the other chair, and from a chair on a side without a plate', async t => {
  const c = await cabin(t, { saved: SERVED }), { a, HB } = c, furn = HB.furnInstances, chairs = furn('dining_chair'), tb = c.table();
  assert.equal(chairs.length, 2);
  const spots = [];
  for (const only of chairs) {   // one chair at a time: west of the table, then east of it
    HB.furnInstances = id => id === 'dining_chair' ? [only] : furn(id);
    assert.equal(c.press('eat'), true);
    c.until(() => a.behavior?.phase === 'action'); c.step(1);
    const at = c.bowl(); onTable(c, at, PLATE); spots.push(at);
    assert.ok(flat(c.chair(), [only.cell[0] + 0.5, 0, only.cell[2] + 0.5]) < 1e-9, 'she sits on that chair');
    assert.equal(a.cancelBehavior('test'), true); c.step(4);
  }
  assert.ok(Math.abs(spots[0][0] + spots[1][0] - 2 * tb[0]) < 1e-6 && Math.abs(spots[0][2] - spots[1][2]) < 1e-6 && Math.abs(spots[0][0] - spots[1][0]) > 0.5,
    'mirror spots on the two plates: ' + JSON.stringify(spots));
  // a chair moved to the north side of the table, facing it (south): no plate there, the bowl stands on the cloth in front of it
  const north = { ...chairs[0], cell: [chairs[0].cell[0] + 1, chairs[0].cell[1], chairs[0].cell[2] - 1], facing: 'south' };
  assert.ok(Math.abs(north.cell[0] + 0.5 - tb[0]) < 1e-9 && Math.abs(north.cell[2] + 0.5 - (tb[2] - 1)) < 1e-9);
  HB.furnInstances = id => id === 'dining_chair' ? [north] : furn(id);
  assert.deepEqual(a.behaviorAvailability('eat'), { available: true });
  assert.equal(c.press('eat'), true);
  c.until(() => a.behavior?.phase === 'action'); c.step(1);
  const at = c.bowl();
  const ch = [north.cell[0] + 0.5, north.cell[1], north.cell[2] + 0.5];
  assert.ok(flat(a.pos, ch) < 0.1, 'she sits on the moved chair');
  assert.ok(Math.abs(at[0] - tb[0]) < 1e-6 && at[2] < tb[2] - 0.15 && at[2] > tb[2] - 0.5 + RIM, 'north half of the table, in front of her: ' + at);
  assert.ok(Math.abs(at[1] - tb[1] - CLOTH) < 1e-6, 'on the cloth: ' + (at[1] - tb[1]));
  c.until(() => a.behavior === null);
  assert.deepEqual(c.cooker(), IDLE); assert.equal(c.bowl(), null);
  HB.furnInstances = furn;
});

test('dispose while she carries it, then rebuild: no bowl is left attached, its geometry and materials are freed once, nothing else is', async t => {
  const c = await cabin(t, { saved: READY }), { a, T } = c;
  assert.equal(c.press('serve'), true);
  c.until(() => a.behavior?.phase === 'to_chair'); c.step(1);
  const obj = c.bowlObj(); assert.ok(obj && c.bowl());
  const fired = new Map(), watch = o => { fired.set(o, 0); o.addEventListener('dispose', () => fired.set(o, fired.get(o) + 1)); return o; };
  const mine = [], theirs = [];
  obj.traverse(m => { if (m.isMesh) { mine.push(watch(m.geometry)); for (const x of new Set([].concat(m.material))) mine.push(watch(x)); } });
  assert.equal(mine.length, 4, 'two geometries, two materials');
  for (const m of c.rice) { theirs.push(watch(m.geometry)); for (const x of new Set([].concat(m.material))) if (!fired.has(x)) theirs.push(watch(x)); }
  assert.ok(theirs.every(o => !mine.includes(o)), 'the travelling bowl shares no geometry or material with the counter');
  const oldRoot = c.root, oldRice = c.rice.slice(), dishes = oldRice.map(m => m.parent.parent);

  c.dispose();   // the scene goes away in the middle of the walk (model switch, house rebuilt)
  assert.equal(obj.parent, null, 'detached');
  let left = 0; oldRoot.traverse(o => { if (o.name === 'furniture-play:bowl' || (o.isMesh && mine.includes(o.geometry))) left++; });
  assert.equal(left, 0, 'no bowl mesh is left under the old scene');
  for (const o of mine) assert.equal(fired.get(o), 1, 'freed exactly once');
  for (const o of theirs) assert.equal(fired.get(o), 0, 'the counter rice belongs to the kitchen overlay (the scene sweep frees it)');
  assert.ok(dishes.every(d => d.visible), 'the counter dishes are left shown');
  c.dispose(); for (const o of mine) assert.equal(fired.get(o), 1, 'a second dispose frees nothing twice');

  // the rebuilt scene starts clean: the bowl she had taken is served on the new counter, and the next meal gets a new bowl
  await c.build();
  assert.notEqual(c.root, oldRoot);
  assert.deepEqual(c.cooker(), SERVED); assert.equal(c.counterRice(), 2); assert.equal(c.bowlObj(), null);
  assert.equal(c.a.behavior, null);
  assert.equal(c.press('eat'), true);
  c.until(() => c.a.behavior?.phase === 'action'); c.step(1);
  const next = c.bowlObj(); assert.ok(next && next !== obj); assert.ok(c.inScene(next)); onTable(c, c.bowl(), PLATE);
  next.traverse(m => { if (m.isMesh) assert.ok(!mine.includes(m.geometry), 'fresh geometry'); });
  c.until(() => c.a.behavior === null);
  assert.deepEqual(c.cooker(), IDLE); assert.equal(c.bowl(), null); assert.equal(c.counterRice(), 0);
  for (const o of mine) assert.equal(fired.get(o), 1);
});

test('actor API: hand(out) writes into the given vector, mealBowl(out) reports none / hand / table; carrying allocates nothing per frame', async t => {
  const c = await cabin(t, { saved: READY }), { a, T } = c, v = new T.Vector3(7, 7, 7);
  assert.equal(a.mealBowl(v), 0); assert.deepEqual(v.toArray(), [7, 7, 7], 'untouched when she has no bowl');
  assert.equal(a.hand(v), v); assert.ok(dist(v.toArray(), a.hand().toArray()) < 1e-12, 'hand(out) is hand()');
  assert.notEqual(a.hand(), a.hand(), 'hand() without out still returns a fresh vector, as before');
  assert.ok(a.startBehavior('read')); c.step(1); assert.equal(a.mealBowl(v), 0, 'another behaviour has no bowl');
  assert.equal(a.cancelBehavior('test'), true); c.step(3);
  assert.equal(c.press('serve'), true);
  const seen = {}, measured = new Set();
  c.until(() => {
    const b = a.behavior; if (b) (seen[b.phase] ||= new Set()).add(a.mealBowl(v));
    if (b && !measured.has(b.phase) && (b.phase === 'action' || (b.phase === 'to_chair' && c.phase('to_chair').length > 10))) {
      measured.add(b.phase);   // once with the bowl in her hand, once with it on the table
      // frozen in time (dt 0) with the bowl in her hand, then on the table: what the two per-frame calls leave on the heap.
      // The furniture update without any bowl code leaves 16 – 32 bytes a frame here (one or two boxed numbers: its own clock handed
      // to the TV / cooker painters), measured on the files before this change; one new Vector3 a frame would be about 100 more.
      const play = c.V.scene.parts.find(p => p.id === 'furniture-play'), at = c.bowl();
      assert.ok(at);
      const ask = heapGrowth(() => a.mealBowl(v), 5000), draw = heapGrowth(() => play.update(0, 1), 5000, 200000);
      assert.ok(ask < 32 * 1024, b.phase + ': mealBowl left ' + ask + ' bytes over 5000 calls');
      assert.ok(draw < 320 * 1024, b.phase + ': furniture-play update left ' + draw + ' bytes over 5000 frames (' + draw / 5000 + ' a frame)');
      assert.ok(dist(c.bowl(), at) < 1e-9, 'and the bowl did not move meanwhile');
    }
    return b === null;
  });
  assert.deepEqual([...measured], ['to_chair', 'action']);
  assert.deepEqual(Object.fromEntries(Object.entries(seen).map(([k, s]) => [k, [...s]])),
    { to_counter: [0], face_counter: [0], pickup: [1], to_chair: [1], sit: [2], action: [2] });
  assert.equal(a.mealBowl(v), 0);
});
