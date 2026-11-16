// The rice cooker (69-furniture-play) and the character's meal (65-girl-actor 'eat') are one story:
// 盛到碗里 / 吃饭 make her really walk to the counter, take the bowl, sit at the table and eat, and the cooker state
// follows what she does. The lunch routine (89-cabin-routine) waits for cooked rice.
//
// Real modules together, no build, no browser, no server:   node --test test/meal-cooker-link.test.mjs
//   real cabin model (assets/house/house-v4.png) + 54-house-mc data, real 61-nav, real 65 actor on the bundled YSM rig,
//   real 50-scene ctx, real 56-furn-ground kitchen overlay (the 'vox:rice' meshes the cooker shows / hides),
//   real 69-furniture-play scene part incl. its panel (a small fake DOM), real 89-cabin-routine.
// Not driven here: the house scene part itself (no doors / lanterns, no cutaway), WebGL rendering, real mouse picking,
//   and the browser page wiring (91-cabin). HB.meshFor runs for real but without the mod resource pack, so the hover
//   outline is built from fallback cubes; it is not asserted here.
// MEAL_SRC_DIR=<dir> loads the modules from another src directory (used once to confirm these fail on the old files).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const SRC = process.env.MEAL_SRC_DIR ? { srcDir: path.resolve(process.env.MEAL_SRC_DIR) } : {};
const image = await readFile(new URL('../assets/house/house-v4.png', import.meta.url));
const asset = await readFile(new URL('../assets/girl/fatfish-1.2.zip', import.meta.url));
const MODULES = ['03-vox', '10-zip', '11-molang', '12-nbt', '13-share', '15-mcmodel', '16-mcmesh', '17-mcfallback', '29-ysm', '40-layout', '42-house-mc', '44-furn-mc',
  '50-scene', '54-house-mc', '56-furn-ground', '61-nav', '65-girl-actor', '69-furniture-play'];

// ---- just enough DOM for the furniture panel (U.el) and the canvases of the TV / PC overlays ----
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
  data: new Map(), sets: [],
  get length() { return this.data.size; },
  key(i) { return [...this.data.keys()][i] ?? null; },
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; },
  setItem(k, v) { this.sets.push([k, String(v)]); this.data.set(k, String(v)); },
  removeItem(k) { this.data.delete(k); },
});

const READY = { phase: 'ready', remaining: 0, bowl: false }, IDLE = { phase: 'idle', remaining: 0, bowl: false }, SERVED = { phase: 'idle', remaining: 0, bowl: true };
const COOK_LINE = '到饭点啦，先煮一锅饭，等一小会儿。';
const count = (list, x) => list.filter(v => v === x).length;

// saved: the cooker state found in localStorage when the page opens.   overlays: false = a house without a rice cooker overlay.
// routine: also load 89-cabin-routine on PAGE 'cabin', with Date.now() under the test's control (start = Shanghai wall clock).
async function cabin(t, { saved, overlays = true, routine = false, start = '2026-11-12T12:00:00+08:00' } = {}) {
  const store = fakeStore(), clock = { now: Date.parse(start) }, toasts = [], speech = [], events = [], meals = [], trace = [];
  const document = new Doc(), globals = { localStorage: store };
  if (routine) globals.Date = class extends Date { static now() { return clock.now; } };
  const h = loadV3(MODULES.concat(routine ? ['89-cabin-routine'] : []), { three: 'real', document, globals, page: routine ? 'cabin' : undefined, ...SRC });
  const { V3: V, window } = h, T = window.THREE, HB = V.houseBlocks, F = V.furniturePlay;
  window.__V3_ASSETS = { [V.layout.house.asset]: image.toString('base64') };
  HB.store = { get: async () => null };
  await HB.load();
  const counters = HB.furnInstances('kitchen_counter');
  assert.equal(counters.length, 1, 'the cabin has one kitchen counter');
  const KEY = 'cooker:' + counters[0].cell.join(','), houseKey = F.houseKey(HB.model);
  if (saved) store.data.set(houseKey, JSON.stringify({ [KEY]: saved }));
  const model = V.ysm.load(await V.zip.read(asset));
  model.textures = []; // no browser image decode in this source-only test
  V.girlv1 = { build: () => V.ysm.build(model, { height: 1.25 }) };
  V.bubble = { say(_id, text) { speech.push(text); return true; } };
  V.hud = { toast: text => toasts.push(text) };
  const root = new T.Group(), ctx = V.scene.ctx(root), part = id => V.scene.parts.find(p => p.id === id);
  if (overlays) root.add(part('furn-ground').build(ctx));
  const actorPart = part('girl-actor'), play = part('furniture-play');
  for (const o of actorPart.build(ctx)) root.add(o);
  root.add(play.build(ctx));
  await Promise.all(ctx._waits);
  assert.equal(F.state().ready, true);
  V.viewTokens.girl('idle');
  const a = V.actor;
  V.on('actor:behavior', e => events.push({ ...e }));
  V.on('actor:meal', e => meals.push({ ...e }));
  const rice = [];
  root.traverse(o => { if (o.userData.furn === 'kitchen' && o.userData.cell) o.traverse(m => { if (m.name === 'vox:rice' || m.name === 'rice') rice.push(m); }); });
  const cooker = () => { const r = F.state().items.find(r => r.key === KEY); return r ? r.state : null; };
  const riceShown = () => { const seen = new Set(rice.map(o => o.visible)); assert.equal(seen.size, 1, 'every rice mesh of the cooker agrees'); return rice[0].visible; };
  if (routine) { V.game = { live: true, auto: true }; window.__READY = true; }
  let time = 0, frames = 0;
  const frame = () => {
    clock.now += 50; actorPart.update(0.05); time += 0.05; play.update(0.05, time);
    if (routine && ++frames % 30 === 0) V.cabinRoutine.tick();   // the page ticks the routine every 1.5 s
    if (overlays) { const s = cooker(); trace.push({ at: a.behavior?.phase, kind: a.behavior?.kind, pot: s.phase, bowl: s.bowl, rice: riceShown() }); }
  };
  const step = secs => { for (let i = 0; i < Math.ceil(secs / 0.05); i++) frame(); };
  function until(fn, limit = 90) {
    for (let i = 0; i < Math.ceil(limit / 0.05); i++) { if (fn()) return; frame(); }
    assert.ok(fn(), JSON.stringify({ behavior: a.behavior, pos: a.pos, dbg: a._dbg, cooker: cooker(), events, toasts }));
  }
  // the panel, as the player sees it
  const panel = () => document.body.children.find(c => c && c.className === 'furniture-panel');
  const buttonEls = () => panel().all(c => c.tagName === 'button' && c.attrs['data-action']);
  const buttons = () => Object.fromEntries(buttonEls().map(b => [b.attrs['data-action'], !('disabled' in b.attrs)]));   // action → enabled
  const click = action => { const b = buttonEls().find(b => b.attrs['data-action'] === action); assert.ok(b && !('disabled' in b.attrs), action + ' button is enabled'); b.listeners.click[0](); };
  const status = () => panel().querySelector('.fp-status').textContent;
  const openPanel = () => F.activate({ obj: { userData: { furnitureKey: KEY } } });
  const press = action => F.action(KEY, action);   // exactly what a panel button's onclick calls
  const stored = () => JSON.parse(store.data.get(houseKey))[KEY];
  t.after(() => { actorPart.dispose(); play.dispose(ctx); assert.deepEqual(window.__errors, []); });
  return { V, T, HB, F, a, window, document, store, clock, toasts, speech, events, meals, trace, rice, KEY, houseKey, cooker, riceShown, step, until, buttons, click, status, openPanel, press, stored };
}
const phases = events => events.map(e => e.phase);
const BEFORE = ['to_counter', 'face_counter'], AFTER = ['pickup', 'to_chair', 'sit', 'action'];

test('morning story on the real panel: cook, 盛到碗里 makes her walk; the bowl fills when she takes it and empties when she has eaten', async t => {
  const c = await cabin(t), { a } = c;
  assert.ok(c.rice.length >= 1, 'the real kitchen overlay carries the rice meshes');
  assert.equal(c.riceShown(), false);
  assert.equal(c.openPanel(), true);   // clicking an idle cooker starts a pot, as before
  assert.equal(c.cooker().phase, 'cooking');
  assert.deepEqual(c.buttons(), { cook: false, serve: false, eat: false, cancel: true });
  c.step(30.2);
  assert.deepEqual(c.cooker(), READY);
  assert.deepEqual(c.buttons(), { cook: false, serve: true, eat: true }, 'rice ready: both 盛到碗里 and 吃饭 are offered');
  assert.equal(a.behavior, null, 'nothing happens until the player asks');
  c.trace.length = c.events.length = c.speech.length = 0;

  c.click('serve');
  assert.equal(a.behavior?.kind, 'eat', 'the button starts the real meal behaviour');
  assert.equal(a.behavior.phase, 'to_counter');
  assert.deepEqual(c.cooker(), READY, 'the click itself does not fill the bowl');
  assert.match(c.status(), /饭煮好了.*碗是空的.*小鲸鱼正去盛饭/);
  assert.deepEqual(c.buttons(), { cook: false, serve: false, eat: false }, 'the meal buttons wait for her');
  assert.deepEqual(c.speech, [], 'no cooker line interrupts the walk it just started');

  c.until(() => a.behavior?.phase === 'pickup');
  assert.deepEqual(c.cooker(), SERVED, 'served at the counter pickup');
  assert.deepEqual(c.stored(), SERVED, 'and saved at once');
  assert.deepEqual(c.meals.map(e => e.step), ['pickup']);
  assert.ok(Number.isFinite(c.meals[0].at));
  c.step(0.1);
  assert.match(c.status(), /碗里有饭.*小鲸鱼正在吃饭/);

  c.until(() => a.behavior === null);
  assert.deepEqual(c.cooker(), IDLE, 'eaten: the bowl is empty again');
  assert.deepEqual(c.stored(), IDLE);
  assert.deepEqual(phases(c.events), ['started', 'action', 'completed'], 'actor:behavior keeps its exact phase list');
  assert.equal(c.meals.length, 1);
  assert.deepEqual([...new Set(c.trace.map(x => x.at))], ['to_counter', 'face_counter', 'pickup', 'to_chair', 'sit', 'action', undefined]);
  const before = c.trace.filter(x => BEFORE.includes(x.at)), after = c.trace.filter(x => AFTER.includes(x.at));
  assert.ok(before.length > 5 && after.length > 480, 'she really walks, then eats for 24 s: ' + before.length + ' / ' + after.length);
  assert.ok(before.every(x => !x.bowl && !x.rice && x.pot === 'ready'), 'no rice in the bowl before she reaches the counter');
  assert.ok(after.every(x => x.bowl && x.rice && x.pot === 'idle'), 'rice visible from the pickup until she has finished');
  assert.equal(c.riceShown(), false);
  assert.deepEqual(c.speech, ['饭好了，盛一碗。', '开动啦。', '吃饱啦，谢谢你陪我吃饭。']);
  c.step(0.1);
  assert.match(c.status(), /^待机 · 碗是空的$/);
  assert.deepEqual(c.buttons(), { cook: true, serve: false, eat: false });
  assert.equal(a.state, 'idle');
});

test('吃饭 with a bowl already served: she goes to eat it, the bowl empties only when she has finished; the pot can be restarted meanwhile', async t => {
  const c = await cabin(t, { saved: SERVED }), { a } = c;
  assert.deepEqual(c.cooker(), SERVED); assert.equal(c.riceShown(), true);
  assert.equal(c.press('serve'), false, 'nothing to serve');
  assert.equal(a.behavior, null);
  assert.equal(c.press('eat'), true);
  assert.equal(a.behavior?.kind, 'eat');
  assert.deepEqual(c.cooker(), SERVED, 'not eaten by the click');
  c.until(() => a.behavior?.phase === 'action');
  assert.deepEqual(c.cooker(), SERVED);
  const n = c.toasts.length;
  assert.equal(c.press('eat'), false, 'a second press while she eats changes nothing');
  assert.match(c.toasts.at(-1), /已经在忙这顿饭/); assert.equal(c.toasts.length, n + 1);
  assert.equal(c.press('cook'), true, 'a new pot may be started while she eats');
  assert.equal(a.behavior?.phase, 'action', 'and that does not pull her away from the table');
  assert.equal(c.speech.at(-1), '开始煮饭啦，等一小会儿。');
  c.until(() => a.behavior === null);
  assert.equal(c.cooker().bowl, false);
  assert.notEqual(c.cooker().phase, 'idle', 'the new pot kept cooking');
  assert.deepEqual(phases(c.events), ['started', 'action', 'completed']);
  assert.ok(c.trace.filter(x => x.kind === 'eat').every(x => x.bowl && x.rice), 'the bowl stays served for the whole meal');
  assert.equal(c.meals.length, 1);
});

test('吃饭 with rice ready and an empty bowl: one press serves at the pickup and eats', async t => {
  const c = await cabin(t, { saved: READY }), { a } = c;
  assert.equal(c.press('eat'), true);
  assert.equal(a.behavior?.kind, 'eat'); assert.deepEqual(c.cooker(), READY);
  c.until(() => a.behavior?.phase === 'pickup'); assert.deepEqual(c.cooker(), SERVED);
  c.until(() => a.behavior === null); assert.deepEqual(c.cooker(), IDLE);
  assert.deepEqual(phases(c.events), ['started', 'action', 'completed']);
});

test('interrupted meals lose nothing: before the pickup the rice stays in the pot, after it the bowl stays served and 吃饭 retries', async t => {
  const c = await cabin(t, { saved: READY }), { a } = c;
  assert.equal(c.press('serve'), true);
  c.until(() => a.behavior?.phase === 'to_counter' && c.trace.length > 10);
  assert.equal(a.cancelBehavior('test'), true);
  assert.deepEqual(c.cooker(), READY, 'cancelled on the way: still in the pot');
  assert.match(c.toasts.at(-1), /饭还在锅里/);
  assert.deepEqual(c.meals, []);

  assert.equal(c.press('serve'), true, 'press again');
  c.until(() => a.behavior?.phase === 'pickup');
  assert.deepEqual(c.cooker(), SERVED);
  assert.ok(a.poke(), 'the player pokes her at the counter');
  assert.equal(a.behavior, null);
  assert.deepEqual(phases(c.events), ['started', 'cancelled', 'started', 'cancelled']);
  assert.deepEqual(c.cooker(), SERVED, 'cancelled after the pickup: the bowl stays served');
  assert.deepEqual(c.stored(), SERVED);
  assert.match(c.toasts.at(-1), /碗里的饭还在/);
  c.step(5);
  assert.deepEqual(c.cooker(), SERVED, 'and nobody eats it behind her back');

  assert.equal(c.press('eat'), true, '吃饭 retries');
  c.until(() => a.behavior?.phase === 'pickup');
  assert.deepEqual(c.cooker(), SERVED, 'the second pickup does not serve twice');
  c.until(() => a.behavior === null);
  assert.deepEqual(c.cooker(), IDLE);
  assert.equal(count(phases(c.events), 'completed'), 1, 'one meal, counted once');
  assert.equal(c.meals.length, 2);
});

test('busy: the cooker state is left alone, the player is told, and may press again', async t => {
  const c = await cabin(t, { saved: READY }), { a } = c;
  // 2026-11-14：看书成了她自己找的消遣，会给吃饭让路（下一项测试）；「忙」改用写日记（正事，不让路）
  assert.ok(a.startBehavior('write_diary'), 'she is writing her diary');
  const sets = c.store.sets.length;
  assert.equal(c.press('serve'), false);
  assert.equal(c.press('eat'), false);
  assert.deepEqual(c.cooker(), READY);
  assert.equal(a.behavior?.kind, 'write_diary', 'the diary is not interrupted');
  assert.equal(c.toasts.length, 2); assert.match(c.toasts[0], /正忙着.*再点一次/);
  assert.equal(c.store.sets.length, sets, 'nothing written');
  c.until(() => a.behavior === null);
  assert.deepEqual(c.cooker(), READY);

  assert.ok(a.respond('嗯？'), 'answering the player for a few seconds is busy too');
  assert.equal(c.press('serve'), false); assert.deepEqual(c.cooker(), READY); assert.equal(c.toasts.length, 3);
  c.step(4);
  assert.equal(c.press('serve'), true, 'pressing again once she is free works');
  assert.equal(a.behavior?.kind, 'eat');
  c.until(() => a.behavior === null);
  assert.deepEqual(c.cooker(), IDLE);
  assert.deepEqual(phases(c.events.filter(e => e.kind === 'eat')), ['started', 'action', 'completed']);
});

test('2026-11-14: something she does by herself (reading) gives way to 吃饭: the reading is cancelled (preempted) and she goes to eat', async t => {
  const c = await cabin(t, { saved: READY }), { a } = c;
  assert.ok(a.startBehavior('read'), 'she is reading');
  c.until(() => a.behavior?.phase === 'action');
  assert.equal(c.press('eat'), true, 'the press is taken');
  assert.equal(a.behavior?.kind, 'eat');
  const read = c.events.filter(e => e.kind === 'read');
  assert.deepEqual(read.map(e => e.phase), ['started', 'action', 'cancelled']);
  assert.equal(read[2].reason, 'preempted');
  assert.equal(c.toasts.filter(x => /正忙着/.test(x)).length, 0, 'no "busy" toast');
  c.until(() => a.behavior === null);
  assert.deepEqual(c.cooker(), IDLE);
  assert.deepEqual(phases(c.events.filter(e => e.kind === 'eat')), ['started', 'action', 'completed']);
});

test('a button press turns her round from an idle stroll; the lunch routine default still treats a stroll as busy', async t => {
  const c = await cabin(t, { saved: READY }), { a, V } = c;
  V.viewTokens.girl('wander');
  c.step(1);
  assert.equal(a.state, 'wander');
  assert.deepEqual(a.behaviorAvailability('eat'), { available: false, reason: 'busy' });
  assert.equal(a.startBehavior('eat'), false, 'unchanged for callers that do not ask to interrupt');
  assert.deepEqual(c.events, []);
  assert.equal(c.press('serve'), true);
  assert.equal(a.behavior?.kind, 'eat');
  c.until(() => a.behavior?.phase === 'pickup'); assert.deepEqual(c.cooker(), SERVED);
  c.until(() => a.behavior === null); assert.deepEqual(c.cooker(), IDLE);
  assert.deepEqual(phases(c.events), ['started', 'action', 'completed']);
});

test('no dining chair, or no character that can act: the old instant change, with the reason said', async t => {
  const c = await cabin(t, { saved: READY }), { a, V, HB } = c, furn = HB.furnInstances;
  HB.furnInstances = id => id === 'dining_chair' ? [] : furn(id);
  assert.deepEqual(a.behaviorAvailability('eat'), { available: false, reason: 'missing-furniture' });
  assert.equal(c.press('serve'), true);
  assert.deepEqual(c.cooker(), SERVED, 'flips at once'); assert.equal(c.riceShown(), true); assert.deepEqual(c.stored(), SERVED);
  assert.equal(a.behavior, null);
  assert.equal(c.toasts.at(-1), '餐桌旁没有能坐的椅子，这次先直接盛好。');
  assert.equal(c.speech.at(-1), '盛好了，小心烫！');
  assert.equal(c.press('eat'), true);
  assert.deepEqual(c.cooker(), IDLE); assert.equal(c.riceShown(), false);
  assert.equal(c.toasts.at(-1), '餐桌旁没有能坐的椅子，这次就直接吃完啦。');
  assert.equal(c.speech.at(-1), '吃饱啦，谢谢你陪我吃饭。');
  assert.deepEqual(c.events, []); assert.deepEqual(c.meals, []);

  // 吃饭 on a ready pot without a seat: the first press serves, the second eats
  assert.equal(c.press('cook'), true); c.step(30.2); assert.deepEqual(c.cooker(), READY);
  assert.equal(c.press('eat'), true); assert.deepEqual(c.cooker(), SERVED);
  assert.match(c.toasts.at(-1), /这次先直接盛好。$/);

  // a character without the behaviour API (mocks, a reduced actor)
  const real = V.actor, said = [];
  V.actor = { respond: text => { said.push(text); return true; } };
  assert.equal(c.press('eat'), true); assert.deepEqual(c.cooker(), IDLE);
  assert.equal(c.toasts.at(-1), '小鲸鱼现在没法自己走过去，这次就直接吃完啦。');
  assert.deepEqual(said, ['吃饱啦，谢谢你陪我吃饭。']);
  V.actor = real;

  // the chair is back: the real meal works again from the same state machine
  HB.furnInstances = furn;
  assert.equal(c.press('cook'), true); c.step(30.2);
  assert.equal(c.press('serve'), true); assert.equal(a.behavior?.kind, 'eat'); assert.deepEqual(c.cooker(), READY);
  c.until(() => a.behavior === null); assert.deepEqual(c.cooker(), IDLE);
});

test('mealReady(): true without a cooker, true with a bowl or a ready pot, false while cooking, and an idle pot is started exactly once', async t => {
  const none = await cabin(t, { overlays: false });
  assert.equal(none.cooker(), null, 'this house has no cooker overlay');
  assert.equal(none.F.mealReady(), true); assert.equal(none.F.hasRice(), false);

  const c = await cabin(t), { F, a } = c;   // idle pot, empty bowl
  assert.equal(F.hasRice(), false);
  for (let i = 0; i < 5; i++) assert.equal(F.mealReady(), false, 'call ' + i);
  assert.deepEqual(c.cooker(), { phase: 'cooking', remaining: 30, bowl: false });
  assert.equal(count(c.speech, COOK_LINE), 1, 'started (and announced) once');
  assert.equal(a.behavior, null); assert.equal(a.state, 'idle', 'the announcement does not grab her attention');
  c.step(10);
  const left = c.cooker().remaining; assert.ok(Math.abs(left - 20) < 0.2);
  assert.equal(F.mealReady(), false); assert.equal(c.cooker().remaining, left, 'asking again does not restart the pot');
  assert.equal(F.hasRice(), false);
  c.step(20.2);
  assert.deepEqual(c.cooker(), READY);
  assert.equal(F.mealReady(), true); assert.equal(F.hasRice(), true); assert.deepEqual(c.cooker(), READY, 'no side effect once ready');
  assert.equal(count(c.speech, COOK_LINE), 1);
  assert.equal(c.store.sets.filter(([k, v]) => k === c.houseKey && JSON.parse(v)[c.KEY].remaining === 30).length, 1, 'one pot started');

  const served = await cabin(t, { saved: SERVED });
  assert.equal(served.F.mealReady(), true); assert.equal(served.F.hasRice(), true); assert.deepEqual(served.cooker(), SERVED);
  const both = await cabin(t, { saved: { phase: 'cooking', remaining: 12, bowl: true } });
  assert.equal(both.F.mealReady(), true, 'a served bowl is enough even while the next pot cooks');

  // nobody could sit down to eat it: do not cook, let the routine behave as it always did
  const seatless = await cabin(t), furn = seatless.HB.furnInstances;
  seatless.HB.furnInstances = id => id === 'dining_chair' ? [] : furn(id);
  assert.equal(seatless.F.mealReady(), true); assert.deepEqual(seatless.cooker(), IDLE); assert.deepEqual(seatless.speech, []);
  // she is merely busy: the rice can cook meanwhile
  seatless.HB.furnInstances = furn;
  assert.ok(seatless.a.startBehavior('read'));
  assert.equal(seatless.F.mealReady(), false); assert.equal(seatless.cooker().phase, 'cooking');
  assert.equal(seatless.a.behavior?.kind, 'read');
});

test('the actor only announces cooked rice when there is some; a meal started without a button still uses the cooker', async t => {
  const cold = await cabin(t);   // idle pot, empty bowl: e.g. a direct host call
  assert.ok(cold.a.startBehavior('eat'));
  cold.until(() => cold.a.behavior === null);
  assert.deepEqual(cold.speech, ['拿上碗筷，吃点东西。']);
  assert.deepEqual(cold.cooker(), IDLE);
  assert.ok(cold.trace.every(x => !x.bowl && !x.rice), 'no rice appears from a cold pot');
  assert.deepEqual(cold.meals.map(e => e.step), ['pickup']);

  const warm = await cabin(t, { saved: READY });
  assert.ok(warm.a.startBehavior('eat'));
  warm.until(() => warm.a.behavior?.phase === 'pickup'); assert.deepEqual(warm.cooker(), SERVED);
  warm.until(() => warm.a.behavior === null); assert.deepEqual(warm.cooker(), IDLE);
  assert.deepEqual(warm.speech, ['饭好了，盛一碗。', '吃饱啦。']);
});

test('lunch routine (real 89): an idle cooker is started first, she serves once the rice is ready, and the meal is counted once', async t => {
  const c = await cabin(t, { routine: true, start: '2026-11-12T12:00:00+08:00' }), { a, V, store } = c;
  const records = () => [...store.data].filter(([k]) => k.startsWith('cabin.routine.unread.v2:')).map(([, v]) => JSON.parse(v).action);
  c.step(1.6);   // first routine tick inside the lunch window
  assert.equal(c.cooker().phase, 'cooking', 'the routine starts a pot instead of serving from a cold cooker');
  assert.equal(a.behavior, null);
  c.until(() => c.cooker().phase === 'ready', 40);
  assert.ok(c.trace.every(x => x.pot !== 'cooking' || x.kind === undefined), 'she waits while it cooks');
  assert.ok(c.trace.filter(x => x.pot === 'cooking').length > 590, 'for the whole 30 s');
  assert.equal(count(c.speech, COOK_LINE), 1, 'the retries do not start the pot again');
  c.until(() => a.behavior?.kind === 'eat', 10);
  c.until(() => a.behavior?.phase === 'pickup'); assert.deepEqual(c.cooker(), SERVED);
  c.until(() => a.behavior === null); assert.deepEqual(c.cooker(), IDLE);
  assert.deepEqual(phases(c.events), ['started', 'action', 'completed']);
  assert.equal(store.getItem('cabin.routine.lunch.v1'), '2026-11-12');
  assert.deepEqual(records(), ['meal']);
  assert.ok(c.speech.includes('饭好了，盛一碗。') && c.speech.includes('吃饱啦。'));
  c.step(20);
  assert.deepEqual(c.cooker(), IDLE, 'lunch is done for today: no second pot');
  assert.equal(count(c.speech, COOK_LINE), 1); assert.deepEqual(records(), ['meal']); assert.equal(a.behavior, null);

  // rice the player cooked earlier is simply used
  const d = await cabin(t, { routine: true, saved: READY, start: '2026-11-13T11:30:00+08:00' });
  d.until(() => d.a.behavior?.kind === 'eat', 10);
  assert.equal(count(d.speech, COOK_LINE), 0);
  d.until(() => d.a.behavior === null); assert.deepEqual(d.cooker(), IDLE);
  assert.equal(d.store.getItem('cabin.routine.lunch.v1'), '2026-11-13');
});
