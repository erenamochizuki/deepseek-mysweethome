// The night routine: after the 23:30 diary (23:45 at the latest) she walks to the bed, lies down and sleeps until 08:00 (Shanghai time);
// a real private reply wakes her, she sits at the computer and goes back to bed 5 minutes after the last reply.
//
// Real modules together, no build, no browser, no server:   node --test test/night-sleep.test.mjs
//   real cabin model (assets/house/house-v4.png) + 54-house-mc data, real 61-nav, real 65 actor on the bundled YSM rig, real 50-scene ctx,
//   real 56-furn-ground (bed variant state + the quilt cover mesh), real 88-cabin-night + 89-cabin-routine on PAGE 'cabin'.
//   Date.now() is the test's clock: every simulated frame moves it 50 ms, jump() moves it without frames (the routine only reads the wall clock).
// Not driven here: WebGL rendering (how it looks: haibian/test/cabin-sleep-browser.mjs), the settings panel UI, the bridge that feeds
//   cabinActivityEvents (events are handed to V3.cabinRoutine.acceptEvents exactly as cabin-bridge.js does), a bed that exists but cannot
//   be reached (same code path as "no bed": startBehavior answers false with another reason).
// NIGHT_SRC_DIR=<dir> loads the modules from another src directory (used once to confirm these fail on the old files).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { GIRL_ZIP, requireGirlZip } from '../tools/lib/girl-asset.mjs';
if (!process.env.NIGHT_GIRL_ZIP) requireGirlZip('night-sleep');

const SRC = process.env.NIGHT_SRC_DIR ? { srcDir: path.resolve(process.env.NIGHT_SRC_DIR) } : {};
const image = await readFile(new URL('../assets/house/house-v4.png', import.meta.url));
const asset = await readFile(process.env.NIGHT_GIRL_ZIP || GIRL_ZIP);
const MODULES = ['03-vox', '10-zip', '11-molang', '12-nbt', '13-share', '15-mcmodel', '16-mcmesh', '17-mcfallback', '29-ysm', '40-layout', '42-house-mc', '44-furn-mc',
  '30-shell-kit', '50-scene', '54-house-mc', '56-furn-ground', '57-art-desk', '61-nav', '65-girl-actor', '88-cabin-night', '89-cabin-routine'];
const WHITELIST = ['meal', 'shell', 'read', 'diary', 'draw', 'reply_private'];   // what POST /api/cabin/behavior accepts
const MIN = 60000;

const paint = new Proxy({}, { get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => ({ data: [], addColorStop() {} })), set: () => true });
class El {
  constructor(tag) { Object.assign(this, { tagName: tag, nodeType: 1, children: [], attrs: {}, style: {}, className: '', textContent: '' }); }
  get classList() { return { contains: name => this.className.split(/\s+/).includes(name) }; }
  getContext() { return paint; }
  toBlob(done) { done(new Blob(['a crayon drawing'])); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() {} append() {} replaceChildren() {} remove() {}
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
const hhmm = at => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(at);

// start: Shanghai wall clock when the page opens.   settings: V3.game.get() values (nightSleep).   bed: false = a house without a bed.
// clips: false = a character model without the lying / sleeping animations (an imported model).
async function cabin(t, { start, settings = {}, bed = true, clips = true } = {}) {
  const store = fakeStore(), clock = { now: Date.parse(start) }, speech = [], events = [], uploaded = [], variants = [];
  const document = new Doc(), globals = { localStorage: store, Date: class extends Date { static now() { return clock.now; } },
    Image: class { naturalWidth = 16; naturalHeight = 16; async decode() {} } };
  const h = loadV3(MODULES, { three: 'real', document, globals, page: 'cabin', ...SRC });
  const { V3: V, window } = h, T = window.THREE, HB = V.houseBlocks;
  // 2026-11-14：空闲消遣（89 的 LEISURE）有看海 / 电视 / 相册 / 看书四样。这里测的是夜里的规矩，
  // 固定成以前唯一的那一样（看书，15 秒），下面「她在看书」「等她看完」的写法才照旧成立。消遣本身在 test/actor-leisure.test.mjs
  // 2026-11-18：消遣时长改成可设置（默认 1–5 分钟），这里把设置钉成 15 秒，夜里的规矩测试保持确定性、不跟着默认值变长。
  if (V.cabinRoutine) V.cabinRoutine.leisure = [['read', 1]];
  window.__V3_ASSETS = { [V.layout.house.asset]: image.toString('base64') };
  HB.store = { get: async () => null };
  await HB.load();
  if (!bed) { const all = HB.furnInstances; HB.furnInstances = id => (id === 'bed' ? [] : all(id)); }
  const model = V.ysm.load(await V.zip.read(asset));
  model.textures = []; // no browser image decode in this source-only test
  V.ysmUI = { initialBody: () => ({ id: 'test:model', builder: () => {
    const inst = V.ysm.build(model, { height: 1.25 });
    if (!clips) { const has = inst.hasAnimation.bind(inst); inst.hasAnimation = k => !['extra:extra12', 'extra:extra13', 'main:sleep'].includes(k) && has(k); }
    return inst;
  } }) };
  V.bubble = { say(_id, text) { speech.push(text); return true; }, hide() {} };
  V.game = { live: true, auto: true, get: k => settings[k], S: { leisureMin: 0.25, leisureMax: 0.25 } };   // 0.25 分钟 = 15 秒
  const root = new T.Group(), ctx = V.scene.ctx(root), part = id => V.scene.parts.find(p => p.id === id);
  root.add(part('furn-ground').build(ctx));
  const artPart = part('art-desk');
  root.add(artPart.build(ctx));
  const drawings = [];
  V.album = { async fromFile(blob, name) { return { photo: { blob, name } }; }, async storeDrawing(photo) { drawings.push(photo); return {ok:true}; } };
  const actorPart = part('girl-actor');
  const buildActor = () => { for (const o of actorPart.build(ctx)) root.add(o); };
  buildActor();
  await Promise.all(ctx._waits);
  V.on('actor:behavior', e => events.push({ kind: e.kind, phase: e.phase, reason: e.reason, at: clock.now }));
  V.on('furn:variant', e => { if (e.id === 'bed') variants.push(e.name); });
  V.cabinRoutine.setUploader(rows => { uploaded.push(...rows.map(r => r.action)); return { ok: true, data: { ok: true, ackIds: rows.map(r => r.id) } }; });
  window.__READY = true;
  let frames = 0, disposed = false;
  const frame = () => {
    clock.now += 50; actorPart.update(0.05);
    if (V.actor?.behavior?.kind === 'draw') artPart.update(.05, clock.now / 1000, ctx);
    if (++frames % 30 === 0) V.cabinRoutine.tick();   // the page ticks the routine every 1.5 s
  };
  const step = secs => { for (let i = 0; i < Math.ceil(secs / 0.05); i++) frame(); };
  const dump = () => JSON.stringify({ time: hhmm(clock.now), behavior: V.actor.behavior, state: V.actor.state, pos: V.actor.pos, night: V.cabinNight.state(), events: events.slice(-8), errors: window.__errors });
  function until(fn, limit = 120, what = '') {
    for (let i = 0; i < Math.ceil(limit / 0.05); i++) { if (fn()) return; frame(); }
    assert.ok(fn(), what + ' ' + dump());
  }
  const jump = ms => { clock.now += ms; V.cabinRoutine.tick(); };                 // wall clock only: nothing is simulated in between
  const to = hm => {                                                             // jump forward to the next HH:MM[:SS] Shanghai time
    const [H, M, S2 = 0] = hm.split(':').map(Number), day = 24 * 3600000, sh = clock.now + 8 * 3600000;
    let at = sh - (sh % day) + H * 3600000 + M * MIN + S2 * 1000;
    if (at <= sh) at += day;
    jump(at - sh);
  };
  let seq = 0;
  const feed = action => V.cabinRoutine.acceptEvents([{ id: 'ev' + (++seq), at: clock.now, action }]);   // what cabin-bridge.js does with cabinActivityEvents
  const asleep = () => { const b = V.actor.behavior; return !!b && b.kind === 'sleep' && b.phase === 'action'; };
  const bedBox = () => { const f = HB.furnInstances('bed')[0].cell; return { x0: f[0], x1: f[0] + 1, z0: f[2], z1: f[2] + 2, y: f[1] }; };   // 1 × 2 m, head cell first (facing north)
  // she really lies in the bed: root and head inside the bed's footprint, above the floor, head end towards the headboard, bed shown as 'sleeping'
  function assertInBed(msg = '') {
    const a = V.actor, B = bedBox(), r = a.root.position, L = a.lying;
    assert.ok(asleep(), msg + ' asleep ' + dump());
    assert.ok(L && L.k === 1, msg + ' fully down');
    root.updateMatrixWorld(true);
    const head = a.inst.bones.head.getWorldPosition(new T.Vector3()), hip = a.inst.bones.legL.getWorldPosition(new T.Vector3());
    for (const [name, p] of [['root', r], ['head', head], ['hip', hip]]) {
      assert.ok(p.x > B.x0 && p.x < B.x1 && p.z > B.z0 && p.z < B.z1, `${msg} ${name} is inside the bed footprint: ${p.toArray().map(v => v.toFixed(2))}`);
      assert.ok(p.y > B.y + 0.3 && p.y < B.y + 1, `${msg} ${name} is at bed height: ${p.y.toFixed(2)}`);
    }
    assert.ok(head.z < hip.z - 0.2, msg + ' head towards the headboard (north), feet towards the foot');
    assert.ok(head.y > hip.y + 0.05, msg + ' head higher than the hips (on the pillow)');
    assert.ok(Math.hypot(a.pos[0] - (B.x0 + 0.5), a.pos[2] - (B.z0 + 1)) < 1.3, msg + ' her standing spot is beside this bed');
    assert.equal(V.furn.variant('bed'), 'sleeping', msg + ' bed variant');
    const cover = root.children.filter(o => o.name === 'bed-sleep-cover');
    assert.equal(cover.length, 1, msg + ' one quilt cover in the scene');
    assert.ok(cover[0].visible && L.cover, msg + ' the cover lies over her');
    assert.equal(a.state, 'idle'); assert.equal(a.resting, true, msg + ' autonomous life is off');
  }
  function assertUp(msg = '') {
    const a = V.actor;
    assert.equal(a.lying, null, msg + ' not lying');
    assert.equal(V.furn.variant('bed'), 'made', msg + ' bed made again');
    assert.ok(root.children.filter(o => o.name === 'bed-sleep-cover').every(o => !o.visible), msg + ' cover hidden');
    assert.ok(Math.abs(a.root.rotation.x) < 1e-9 && Math.abs(a.root.rotation.z) < 1e-9, msg + ' upright');
    assert.ok(Math.abs(a.root.position.y - a.pos[1]) < 0.05, msg + ' on the floor');
  }
  // let the uploader finish, then give records made meanwhile their turn (the page does that on its next routine tick)
  const flush = async () => { for (let k = 0; k < 2; k++) { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); clock.now += 1600; V.cabinRoutine.tick(); } for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
  const records = () => [...store.data].filter(([k]) => k.startsWith('cabin.routine.unread.v2:')).map(([, v]) => JSON.parse(v).action);
  const started = (kind, since = 0) => events.filter(e => e.kind === kind && e.phase === 'started' && e.at >= since).length;
  t.after(async () => {
    await flush();
    if (!disposed) actorPart.dispose();
    artPart.dispose(ctx);
    assert.deepEqual(window.__errors, []);
    for (const action of uploaded.concat(records())) assert.ok(WHITELIST.includes(action), 'only whitelisted actions reach the behaviour log: ' + action);
    assert.equal(V.furn.variant('bed'), 'made', 'the bed is made again when the scene goes away');
  });
  return { V, T, HB, root, ctx, window, document, store, clock, speech, events, uploaded, variants, drawings, settings, actorPart, buildActor, step, until, jump, to, feed, asleep,
    assertInBed, assertUp, flush, frames: () => frames, records, started, dump, bedBox, get a() { return V.actor; }, setDisposed() { disposed = true; } };
}

test('the gallery sheet and a sketchbook invitation each wake her for exactly one drawing and then she goes back to bed', async t => {
  const c = await cabin(t, { start: '2026-11-26T00:20:00+08:00' });
  c.until(c.asleep);
  const remote = c.V.artDesk.drawForAlbum({imageUrl:'blob:qq-sheet'});
  await Promise.resolve();
  c.until(() => c.started('draw') === 1);
  c.until(c.asleep);
  assert.equal(await remote, true);
  assert.equal(c.drawings.length, 0, 'the gallery stores its own original');
  c.V.artDesk.invite();
  c.until(() => c.started('draw') === 2);
  c.until(c.asleep);
  await c.flush();
  assert.equal(c.started('draw'), 2);
  assert.equal(c.drawings.length, 1);
  c.assertInBed();
});

test('idle drawing saves the finished sheet once and keeps the full configured visit', async t => {
  const c = await cabin(t, { start: '2026-11-26T10:00:00+08:00' });
  c.V.cabinRoutine.leisure = [['draw', 1]];
  c.V.game.S.leisureMin = c.V.game.S.leisureMax = 2;
  c.jump(91000);
  c.until(() => c.a.behavior?.kind === 'draw' && c.a.behavior.phase === 'action');
  assert.equal(c.a.behavior.leisure, true);
  const start = c.clock.now;
  c.step(9);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.a.drawingProgress, 1);
  assert.equal(c.drawings.length, 1);
  assert.equal(c.ctx.artDesk.pen.visible, false);
  c.until(() => !c.a.behavior);
  assert.ok(Math.abs(c.clock.now - start - 120000) <= 100);
  assert.equal(c.drawings.length, 1);
});

test('cancelling a visit keeps only a finished drawing', async t => {
  const c = await cabin(t, { start: '2026-11-26T10:00:00+08:00' });
  for (const seconds of [2, 10]) {
    c.V.artDesk.invite();
    c.until(() => c.a.behavior?.phase === 'action');
    c.step(seconds);
    assert.equal(c.a.behavior.kind, 'draw');
    c.a.cancelBehavior('player');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(c.drawings.length, seconds === 2 ? 0 : 1);
  }
});

test('23:20: an ordinary evening; the 23:30 diary sends her to bed as soon as it is written, well before 23:45', async t => {
  const c = await cabin(t, { start: '2026-11-12T23:20:00+08:00' });
  c.step(20);
  assert.equal(c.V.cabinNight.state().window, false);
  assert.equal(c.started('sleep'), 0, '23:20 is not bedtime'); assert.equal(c.a.resting, false);
  c.to('23:30:20');
  c.step(10);
  assert.equal(c.V.cabinNight.state().window, true);
  assert.equal(c.started('sleep'), 0, 'in the window, but she waits for the diary (until 23:45)'); assert.equal(c.a.resting, false);
  c.until(() => c.a.behavior === null, 60);                     // (she may be reading: evening life goes on)
  const fed = c.events.length;
  c.feed('diary');                                             // the bridge reports: the assistant is writing today's diary
  c.until(() => c.a.behavior?.kind === 'write_diary', 60, 'diary behaviour');
  c.until(() => c.events.some(e => e.kind === 'write_diary' && e.phase === 'completed'), 90, 'diary done');
  c.until(() => c.a.behavior?.kind === 'sleep', 5, 'to bed right after the diary');
  const order = c.events.slice(fed).map(e => e.kind + ':' + e.phase);
  assert.deepEqual(order, ['write_diary:started', 'write_diary:action', 'write_diary:completed', 'sleep:started'], 'not before the diary is finished');
  assert.ok(['to_bed', 'face_bed'].includes(c.a.behavior.phase), 'she walks there: ' + c.a.behavior.phase);
  const from = c.a.pos.slice(), walk = [];
  c.until(() => { walk.push(c.a.root.position.clone()); return c.a.behavior?.phase === 'lie'; }, 60, 'walk to the bed');
  for (let i = 1; i < walk.length; i++) assert.ok(walk[i].distanceTo(walk[i - 1]) < 0.12, 'real navigation, no teleport on the way to the bed');
  assert.ok(Math.hypot(c.a.pos[0] - from[0], c.a.pos[2] - from[2]) > 0.5, 'she had to walk from the desk to the bed');
  assert.equal(c.V.furn.variant('bed'), 'sleeping', 'the bed changes when she gets in');
  const down = [];
  c.until(() => { down.push(c.a.root.position.clone()); return c.asleep(); }, 5, 'lying down');
  for (let i = 1; i < down.length; i++) assert.ok(down[i].distanceTo(down[i - 1]) < 0.12, 'getting in is a movement, not a jump');
  assert.ok(down.length >= 20, 'lying down takes about a second: ' + down.length + ' frames');
  c.assertInBed('after the diary');
  assert.ok(hhmm(c.clock.now) < '23:45:00', 'asleep before 23:45: ' + hhmm(c.clock.now));
  assert.equal(c.a.inst.actorAnimation.base, 'extra:extra13', 'the bundled model plays its lying clip');
  assert.equal(c.a.inst.states.expr.value, 'sleep', 'eyes closed (the sleep face: closed eyes, relaxed mouth)');
  await c.flush();
  assert.deepEqual(c.uploaded.filter(x => x !== 'read'), ['diary'], 'the diary is logged as before (plus her evening reading); going to bed is not');
});

test('no diary event at all: she goes to bed at 23:45, sleeps through the night without any routine activity, and gets up at 08:00', async t => {
  const c = await cabin(t, { start: '2026-11-12T23:25:00+08:00' });   // the page was open before the window began
  c.step(10);
  c.to('23:40:00'); c.step(30);
  assert.equal(c.started('sleep'), 0, '23:40, no diary yet: still up');
  c.to('23:44:50'); c.step(5);
  assert.equal(c.started('sleep'), 0, '23:44:55: still up');
  c.to('23:45:00');
  c.until(() => c.a.behavior?.kind === 'sleep', 5, '23:45 at the latest');
  c.until(c.asleep, 120);
  c.assertInBed('23:45');
  const since = c.clock.now, spot = c.a.pos.slice(), lying = c.a.root.position.clone(), before = c.events.length;
  // the night: every 4 minutes a bit of simulated time (the routine ticks 1.5 s apart inside), until 07:59
  let quiet = 0; const said = c.speech.length, f0 = c.frames();
  while (hhmm(c.clock.now) < '07:55:00' || hhmm(c.clock.now) > '23:00:00') {
    c.jump(4 * MIN); c.step(3);
    assert.ok(c.asleep(), 'asleep at ' + hhmm(c.clock.now));
    assert.deepEqual(c.a.pos, spot); assert.ok(c.a.root.position.distanceTo(lying) < 1e-6, 'she does not move in her sleep');
    quiet++;
  }
  assert.ok(quiet > 100, 'sampled the whole night: ' + quiet);
  assert.equal(c.events.length, before, 'no behaviour started, ended or was logged all night (no reading, no lunch, no wandering)');
  c.step(70);
  const zzz = c.speech.slice(said), secs = (c.frames() - f0) * 0.05;   // simulated seconds she lay there (the clock jumps are not simulated)
  assert.ok(zzz.every(x => /^(Zzz…|z z Z…|呼……)$/.test(x)), 'nothing but Zzz while asleep: ' + JSON.stringify(zzz));
  assert.ok(zzz.length >= 2 && zzz.length <= Math.ceil(secs / 50) + 1, 'a quiet Zzz about once a minute, not a stream: ' + zzz.length + ' in ' + Math.round(secs) + ' s');
  c.assertInBed('07:5x');
  c.to('07:59:50'); c.step(3);
  assert.ok(c.asleep(), 'still asleep at 07:59:5x');
  c.to('08:00:00');
  c.until(() => c.a.behavior?.phase === 'rise', 3, 'gets up at 08:00');
  const up = [];
  c.until(() => { up.push(c.a.root.position.clone()); return !c.a.behavior || c.a.behavior.kind !== 'sleep'; }, 5, 'up');
  for (let i = 1; i < up.length; i++) assert.ok(up[i].distanceTo(up[i - 1]) < 0.14, 'getting up is a movement');
  c.assertUp('08:00');
  assert.equal(c.a.resting, false, 'normal life again');
  assert.deepEqual(c.variants, ['sleeping', 'made']);
  assert.deepEqual(c.events.filter(e => e.kind === 'sleep').map(e => e.phase), ['started', 'action', 'completed']);
  const evening = c.events.filter(e => e.kind === 'read' && e.phase === 'action').length;   // what she read before bedtime
  c.until(() => c.started('read', since) === 1, 60, 'the routine resumes: she reads again');
  assert.ok(hhmm(c.events.find(e => e.kind === 'read' && e.at >= since).at) >= '08:00:00');
  c.until(() => c.a.behavior === null, 60);
  await c.flush();
  assert.deepEqual(c.uploaded, Array(evening + 1).fill('read'), 'the evening and the morning reading are logged, nothing about the night');
});

test('page opened at 02:00: asleep shortly after, also after a reload; a reply at night = computer, wait 5 minutes after the last reply, back to bed', async t => {
  const c = await cabin(t, { start: '2026-11-13T02:00:00+08:00' });
  c.until(() => c.a.behavior?.kind === 'sleep', 3, 'page opened inside the window: to bed at once');
  c.until(c.asleep, 120);
  c.assertInBed('02:00');
  assert.ok(c.clock.now - Date.parse('2026-11-13T02:00:00+08:00') < 90000, 'asleep within a minute and a half of opening the page');
  const chair = c.HB.furnInstances('desk_chair')[0].cell, atDesk = () => Math.hypot(c.a.root.position.x - (chair[0] + 0.5), c.a.root.position.z - (chair[2] + 0.5)) < 0.6;

  c.to('03:00:00'); c.step(2); c.assertInBed('03:00');
  const t0 = c.clock.now;
  c.feed('reply_private');                                     // she really answered the owner's private message
  c.until(() => c.a.behavior?.kind === 'reply_private', 6, 'gets up for the reply');
  c.assertUp('woken');
  assert.equal(c.a.behavior.hold, true, 'this visit to the computer waits for more');
  c.until(() => c.a.behavior?.phase === 'action', 60, 'at the computer');
  assert.equal(c.a.state, 'furniture'); assert.ok(atDesk(), 'seated on the desk chair');
  assert.equal(c.a.inst.actorAnimation.base, 'tlm:keyboard', 'typing');
  c.step(20);                                                  // the daytime reply would be over after 12 s
  assert.equal(c.a.behavior?.kind, 'reply_private'); assert.equal(c.a.state, 'furniture', 'she stays seated');
  assert.equal(c.a.inst.actorAnimation.base, 'main:sit', 'done typing: sits and waits');
  c.jump(3 * MIN - 25000); c.step(2);
  assert.ok(c.clock.now - t0 > 3 * MIN && c.clock.now - t0 < 3 * MIN + 10000);
  // 2026-11-14：5 分钟从这条回复到达的那一刻（feed）算起。以前 t1 取在 feed 之后 2 秒，量出来的间隔要看例行检查（每 1.5 秒）落在哪一拍，
  // 能差 1.5 秒；她跑去电脑前变快以后拍子错开，299.7 秒就不过了（从回复到达算是 301.7 秒，旧代码 302.9 秒）
  const replyAt = c.clock.now;
  c.feed('reply_private');                                     // +3 min: a second reply
  c.step(2);
  const t1 = c.clock.now;
  assert.equal(c.a.inst.actorAnimation.base, 'tlm:keyboard', 'types again');
  assert.equal(c.a.behavior?.kind, 'reply_private'); assert.ok(atDesk());
  c.jump(3 * MIN); c.step(2);                                   // 6 min after the first reply, 3 min after the second
  assert.equal(c.a.behavior?.kind, 'reply_private', 'the second reply restarted the wait'); assert.equal(c.a.state, 'furniture');
  c.jump(MIN + 50000); c.step(2);                               // 4 min 50-odd s after the second
  assert.ok(c.clock.now - t1 < 5 * MIN, 'not yet 5 minutes');
  assert.equal(c.a.behavior?.kind, 'reply_private', 'still waiting just before the 5 minutes are over'); assert.ok(atDesk());
  c.until(() => c.a.behavior?.kind === 'sleep', 12, 'after 5 minutes without a reply she gets up and goes back');
  const gap = c.clock.now - replyAt;
  assert.ok(gap >= 5 * MIN && gap < 5 * MIN + 6000, 'left the computer 5 minutes after the last reply: ' + Math.round(gap / 1000) + ' s');
  c.until(c.asleep, 60);
  c.assertInBed('back in bed');
  assert.deepEqual(c.events.filter(e => e.kind === 'reply_private').map(e => e.phase), ['started', 'action', 'action', 'completed']);
  await c.flush();
  assert.deepEqual(c.uploaded, ['reply_private', 'reply_private'], 'each real reply is logged once; sleeping and getting up are not');

  // A night request gets a full onsite visit, then she returns to bed.
  for (const [action, kind] of [['draw', 'draw'], ['diary', 'write_diary']]) {
    c.jump(10 * MIN); c.step(2); c.assertInBed('before ' + action);
    c.feed(action);
    c.until(() => c.a.behavior?.kind === kind, 6, action);
    assert.equal(c.a.behavior.hold, undefined, 'no waiting for ' + action);
    c.until(() => c.a.behavior?.phase === 'action', 60, 'at the furniture for ' + action);
    const s = c.clock.now;
    c.until(() => c.a.behavior?.kind !== kind, 40, action + ' completed');
    const onsite = c.clock.now - s;
    const expected = action === 'draw' ? 30000 : 15000;
    assert.ok(Math.abs(onsite - expected) <= 100, action + ' onsite milliseconds: ' + onsite);
    c.until(c.asleep, 90, 'back in bed after ' + action);
    c.assertInBed('after ' + action);
  }
  // reload at 04:30: a fresh page derives everything from the clock
  const d = await cabin(t, { start: '2026-11-13T04:30:00+08:00' });
  d.until(d.asleep, 120);
  d.assertInBed('after a reload');
  assert.ok(d.clock.now - Date.parse('2026-11-13T04:30:00+08:00') < 90000);
});

test('outside the sleep window a private reply is the same short visit as before', async t => {
  const c = await cabin(t, { start: '2026-11-12T21:00:00+08:00' });
  c.step(3);
  c.feed('reply_private');
  c.until(() => c.a.behavior?.kind === 'reply_private', 30);
  assert.equal(c.a.behavior.hold, undefined);
  c.until(() => c.a.behavior?.phase === 'action', 60);
  const s = c.clock.now;
  c.until(() => c.a.behavior === null, 20);
  assert.ok(Math.abs(c.clock.now - s - 12000) < 200, 'about 12 s at the keyboard: ' + (c.clock.now - s));
  assert.equal(c.started('sleep'), 0); assert.equal(c.a.resting, false);
  assert.equal(c.a.endBehavior(), false); assert.equal(c.a.renewBehavior(), false);
});

test('interruptions while asleep: poke, arrange mode, feedback mode, hidden page, house change, scene rebuild: always back to bed, bed restored in between', async t => {
  const c = await cabin(t, { start: '2026-11-13T01:00:00+08:00' });
  c.until(c.asleep, 120); c.assertInBed('first');
  const back = (what) => { c.until(() => c.a.behavior?.kind === 'sleep', 30, what + ': goes back'); c.until(c.asleep, 60, what + ': asleep again'); c.assertInBed(what); };

  // the owner pokes her
  const spot = c.a.pos.slice(), said = c.speech.length;
  assert.equal(c.a.poke(), true);
  c.assertUp('poked');
  assert.equal(c.a.behavior, null); assert.equal(c.a.state, 'respond');
  assert.match(c.speech[said], /唔|睡觉|天亮/, 'a sleepy answer: ' + c.speech[said]);
  const seen = new Set();
  c.until(() => {
    if (c.a.behavior?.kind === 'sleep') return true;
    seen.add(c.a.state); assert.ok(Math.hypot(c.a.pos[0] - spot[0], c.a.pos[2] - spot[2]) < 0.05, 'she stays beside the bed, no wandering at night');
    return false;
  }, 30, 'after the poke');
  assert.deepEqual([...seen].sort(), ['idle', 'respond']);
  back('poke');

  // arrange mode (69-arrange: actor.hold + V3.arrange.on)
  c.V.arrange = { on: true }; c.a.hold(true);
  c.assertUp('arrange on');
  assert.deepEqual(c.events.at(-1), { kind: 'sleep', phase: 'cancelled', reason: 'arrange', at: c.clock.now });
  c.step(30);
  assert.equal(c.a.behavior, null, 'nothing happens while arranging'); c.assertUp('arranging');
  c.a.hold(false); c.V.arrange.on = false;
  back('arrange off');

  // feedback mode
  c.V.fb = { enabled: true }; c.step(0.1);
  c.assertUp('feedback on'); assert.equal(c.events.at(-1).reason, 'blocked');
  c.step(10); assert.equal(c.a.behavior, null);
  c.V.fb.enabled = false;
  back('feedback off');

  // the tab goes to the background and comes back
  c.document.hidden = true; c.document.dispatchEvent(new Event('visibilitychange'));
  c.assertUp('hidden'); assert.equal(c.events.at(-1).reason, 'hidden');
  c.jump(20 * MIN); assert.equal(c.a.behavior, null);
  c.document.hidden = false; c.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(c.a.behavior?.kind, 'sleep', 'visible again inside the window: to bed at once');
  back('visible');

  // the house changed under her (import / arrange commit)
  c.HB.version++; c.step(0.1);
  c.assertUp('house changed'); assert.equal(c.events.at(-1).reason, 'house-changed');
  back('house changed');

  // the whole scene part is rebuilt while she sleeps
  const old = c.a, covers = () => c.root.children.filter(o => o.name === 'bed-sleep-cover');
  let freed = 0; covers()[0].geometry.addEventListener('dispose', () => freed++);
  c.actorPart.dispose();
  assert.equal(c.V.furn.variant('bed'), 'made', 'dispose makes the bed'); assert.equal(covers().length, 0, 'and takes the cover out of the scene');
  assert.equal(freed, 1, 'its geometry is freed');
  c.root.remove(old.root); c.buildActor();
  assert.notEqual(c.a, old); assert.equal(c.a.resting, true, 'the new actor still rests at night');
  back('rebuild');
  assert.equal(covers().length, 1);
  assert.equal(c.variants.filter(v => v === 'sleeping').length, c.variants.filter(v => v === 'made').length + 1, 'every sleeping variant but the current one was undone');
  await c.flush();
  assert.deepEqual(c.uploaded, [], 'none of this is logged');
});

test('hidden before bedtime, visible again at 23:32: she goes to bed without waiting for a diary', async t => {
  const c = await cabin(t, { start: '2026-11-12T23:20:00+08:00' });
  c.step(5);
  c.document.hidden = true; c.document.dispatchEvent(new Event('visibilitychange'));
  c.to('23:32:00'); c.step(3);
  assert.equal(c.started('sleep'), 0, 'nothing while hidden');
  c.document.hidden = false; c.document.dispatchEvent(new Event('visibilitychange'));
  c.until(() => c.a.behavior?.kind === 'sleep', 3, 'back in the foreground inside the window');
  c.until(c.asleep, 120); c.assertInBed('23:3x');
  assert.ok(hhmm(c.clock.now) < '23:45:00');
});

test('a house without a bed: nothing breaks, she lives as in the daytime and the bed is looked for once a minute, not every tick', async t => {
  const c = await cabin(t, { start: '2026-11-13T02:00:00+08:00', bed: false });
  let tries = 0; const start = c.a.startBehavior;
  c.a.startBehavior = (kind, opts) => { if (kind === 'sleep') tries++; return start(kind, opts); };
  assert.deepEqual(c.a.behaviorAvailability('sleep'), { available: false, reason: 'missing-furniture' });
  let ticks = 0; const tick = c.V.cabinRoutine.tick;
  c.V.cabinRoutine.tick = () => { ticks++; return tick(); };
  c.step(600);                                                 // 10 minutes of ordinary page life (a routine tick every 1.5 s)
  c.V.cabinRoutine.tick = tick;
  assert.equal(ticks, 400);
  assert.ok(tries >= 3 && tries <= 11, 'at most one attempt a minute (none while she is busy reading): ' + tries);
  assert.equal(c.started('sleep'), 0); assert.equal(c.a.resting, false, 'she is not kept standing still all night');
  // 2026-11-14：以前每 8 分钟看一次书，10 分钟里正好 1 次；现在一样消遣结束后隔 2.5–4.5 分钟找下一样，所以是「至少一次」
  c.until(() => c.started('read') >= 1, 30, 'the ordinary routine goes on (reading)');
  c.until(() => c.a.behavior === null, 60);
  c.feed('reply_private');
  c.until(() => c.a.behavior?.kind === 'reply_private', 30, 'a reply is the short daytime visit');
  assert.equal(c.a.behavior.hold, undefined);
  c.until(() => c.a.behavior === null, 60);
  assert.equal(c.events.filter(e => e.kind === 'reply_private' && e.phase === 'action').length, 1);
  assert.equal(c.V.furn.variant('bed'), 'made');
});

test('a character model without the lying clips still goes to bed (laid back as a whole); the setting turns the routine off and on', async t => {
  const settings = { nightSleep: false };
  const c = await cabin(t, { start: '2026-11-13T02:00:00+08:00', clips: false, settings });
  c.step(90);
  assert.equal(c.started('sleep'), 0, 'switched off: no bedtime'); assert.equal(c.a.resting, false);
  assert.equal(c.V.cabinNight.state().enabled, false);
  settings.nightSleep = true;
  c.until(() => c.a.behavior?.kind === 'sleep', 3, 'switched on in the middle of the night');
  c.until(c.asleep, 120);
  c.assertInBed('no clip');
  assert.equal(c.a.inst.actorAnimation.base, null, 'no lying clip to play');
  assert.ok(c.a.root.rotation.x < -1 && c.a.root.rotation.x > -1.6, 'the whole body is laid back: ' + c.a.root.rotation.x.toFixed(2));
  settings.nightSleep = false;
  c.until(() => c.a.behavior === null, 5, 'switched off while asleep: she gets up');
  c.assertUp('off'); assert.equal(c.a.resting, false);
  c.step(30); assert.equal(c.started('sleep'), 1);
});

test('the setting is registered the way the settings panel reads it: 房子 / 夜里上床睡觉, on by default, hint with the hours', async () => {
  const h = loadV3(['60-game', '88-cabin-night'], { three: 'real', document: new Doc(), globals: { localStorage: fakeStore() }, page: 'cabin', ...SRC });
  const V = h.V3;
  V.emit('init');
  const f = V.game.SCHEMA.find(x => x.key === 'nightSleep');
  assert.ok(f, 'in the schema');
  assert.equal(f.type, 'toggle'); assert.equal(f.def, true); assert.equal(f.group, '房子'); assert.equal(f.label, '夜里上床睡觉');
  assert.match(f.hint, /23:30/); assert.match(f.hint, /8:00/); assert.match(f.hint, /5 分钟/);
  assert.equal(V.game.get('nightSleep'), true);
  assert.equal(V.game.set('nightSleep', false), false); assert.equal(V.game.get('nightSleep'), false);
  V.emit('init');
  assert.equal(V.game.SCHEMA.filter(x => x.key === 'nightSleep').length, 1, 'registered once');
  const other = loadV3(['88-cabin-night'], { three: 'real', document: new Doc(), page: 'studio', ...SRC });
  assert.equal(other.V3.cabinNight, undefined, 'only on the game pages');
});

// 2026-11-12 23:51 (live): the page came back from the background while she was on her way to a 珍珠贝; the night rules were already due,
// yet she walked on, picked it up and only then went to bed. 哥哥: no shells while she sleeps. A small beach fake stands in for 60-game
// (the actor only uses free / claim / unclaim / claimedBy / collect / st.beach / S); everything else is real.
function fakeBeach(c, items) {
  const claims = new Map(), got = [];
  const st = { beach: items.map(([id, x, z]) => ({ id, x, z, kind: 'pearl', at: 0 })) };
  const G = Object.assign(c.V.game, {
    S: { girlMin: 5, girlMax: 5, girlAuto: true }, st, got,
    free: () => st.beach.filter(b => !claims.has(b.id)),
    claim: (id, who) => { if (claims.has(id)) return false; claims.set(id, who); return true; },
    unclaim: id => { claims.delete(id); }, claimedBy: id => claims.get(id) || null, claims,
    kind: () => ({ id: 'pearl', name: '珍珠贝', category: 'shell' }),
    collect: (id, by) => { const i = st.beach.findIndex(b => b.id === id); if (i < 0) return null; const it = st.beach.splice(i, 1)[0]; claims.delete(id); got.push([id, by, hhmm(c.clock.now)]); return { item: it, by }; },
  });
  return G;
}
const shellSpots = c => { const p = c.a.pos; return [['s1', p[0] + 6, p[2] + 6], ['s2', p[0] - 6, p[2] + 7], ['s3', p[0] + 3, p[2] + 9]].filter(([, x, z]) => c.V.nav && c.V.nav.walkable ? c.V.nav.walkable(x, z) : true); };

test('no shells at night: a shell she is walking to when bedtime comes is let go; ripe shells all night are left alone; a chat "shell" does not wake her', async t => {
  const c = await cabin(t, { start: '2026-11-12T23:25:00+08:00' });   // before the window: an ordinary evening
  c.step(5);
  const spots = shellSpots(c);
  assert.ok(spots.length >= 2, 'test setup: walkable shell spots ' + JSON.stringify(spots));
  const G = fakeBeach(c, spots);
  c.until(() => c.a.state === 'collect' || G.claims.size > 0, 120, 'before 23:30 she still goes for a ripe shell');
  assert.equal(G.got.length, 0, 'not picked up yet');
  c.to('23:45:00'); c.step(0.2);                  // mid-walk the clock passes 23:45 (bedtime at the latest): rest turns on in the next routine tick
  assert.equal(c.a.resting, true);
  assert.equal(G.claims.size, 0, 'the shell she was going for is let go (unclaimed)');
  c.until(c.asleep, 120, 'goes to bed instead');
  assert.equal(G.got.length, 0, 'nothing picked up on the way to bed: ' + JSON.stringify(G.got));
  // the night: ripe shells on the beach the whole time, plus a chat that asks her to pick one up
  for (let i = 0; i < 30; i++) { c.jump(10 * MIN); c.step(3); assert.ok(c.asleep(), 'asleep at ' + hhmm(c.clock.now)); }
  assert.equal(G.got.length, 0, 'no shell collected during the night');
  assert.equal(G.claims.size, 0, 'none even claimed');
  assert.equal(c.started('sleep'), 1, 'one sleep all night, never got up for a shell');
});

test('no shells at night: hidden while walking to a shell, back after bedtime (the live 23:51 case) — she lets it go and goes straight to bed', async t => {
  const c = await cabin(t, { start: '2026-11-12T23:20:00+08:00' });
  c.step(5);
  const G = fakeBeach(c, shellSpots(c));
  // as it was live: she is already on her way to a shell when the window goes to the background (no frames while hidden)
  c.until(() => G.claims.size > 0 && c.a.state === 'collect', 120, 'on her way to a shell before hiding');
  c.step(0.5);
  c.document.hidden = true; c.document.dispatchEvent(new Event('visibilitychange'));
  c.to('23:51:00');                                 // hidden: no frames, only the routine's (throttled) ticks
  c.document.hidden = false; c.document.dispatchEvent(new Event('visibilitychange'));
  c.until(c.asleep, 120, 'to bed');
  assert.equal(G.got.length, 0, 'went to bed without picking up a shell first: ' + JSON.stringify(G.got));
  assert.equal(G.claims.size, 0);
});

test('no shells at night: a "shell" action from the cabin chat at night is dropped, she stays asleep (other actions still wake her)', async t => {
  const c = await cabin(t, { start: '2026-11-13T02:00:00+08:00' });
  c.until(c.asleep, 180, 'asleep shortly after opening at 02:00');
  const G = fakeBeach(c, shellSpots(c));
  // what chat() does with the reply's cabinAction (receiveAction → enqueue + tick); 'shell' is not an EXTERNAL event, so go through chat()
  const r = await c.V.cabinRoutine.chat(async () => ({ ok: true, data: { ok: true, reply: { text: '好呀' }, cabinAction: 'shell' } }));
  assert.ok(r && r.ok);
  for (let i = 0; i < 20; i++) c.step(1.5);
  assert.ok(c.asleep(), 'still asleep ' + c.dump());
  assert.equal(G.got.length, 0); assert.equal(G.claims.size, 0);
  assert.equal(c.started('sleep'), 1, 'did not get up');
});
