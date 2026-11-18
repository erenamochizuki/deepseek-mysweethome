// Actor integration against the embedded cabin model, production nav, and bundled animation rig.
// No build, browser server, scene renderer, or persistent saves required.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { requireGirlZip } from '../tools/lib/girl-asset.mjs';
requireGirlZip('actor-behavior');   // 第三方模型不进仓库：没有就跳过

const image = await readFile(new URL('../assets/house/house-v4.png', import.meta.url));
const asset = await readFile(new URL('../assets/girl/fatfish-1.2.zip', import.meta.url));

async function cabin(t, { fallback = false } = {}) {
  const h = loadV3(['03-vox', '10-zip', '11-molang', '12-nbt', '13-share', '15-mcmodel', '29-ysm', '40-layout', '42-house-mc', '44-furn-mc'], { three: 'real' });
  const { V3: V, window } = h, T = window.THREE, parts = new Map(), events = [], clips = [], speech = [];
  window.document = new EventTarget();
  V.scene = { part: p => parts.set(p.id, p) };
  h.load(['54-house-mc', '61-nav', '65-girl-actor']);
  const HB = V.houseBlocks;
  window.__V3_ASSETS = { [V.layout.house.asset]: image.toString('base64') };
  HB.store = { get: async () => null };
  await HB.load();
  const model = V.ysm.load(await V.zip.read(asset));
  model.textures = []; // no browser image decode in this source-only test
  if (fallback) model.anims = { main: {} };
  V.girlv1 = { build: () => V.ysm.build(model, { height: 1.25 }) };
  V.bubble = { say(id, text) { speech.push(text); return true; } };
  const part = parts.get('girl-actor'), scene = new T.Group();
  part.build({ rng: () => () => 0.2 }).forEach(o => scene.add(o));
  V.viewTokens.girl('idle');
  const a = V.actor;
  V.on('actor:behavior', e => events.push({ ...e, state: a.state, pos: a.pos, actorPhase: a.behavior?.phase, ...a.inst.actorAnimation }));
  const update = () => { part.update(0.05); clips.push({ phase: a.behavior?.phase, state: a.state, v: a._dbg.v, armX: a.inst.bones.armR.rotation.x, ...a.inst.actorAnimation }); };
  const step = secs => { for (let i = 0; i < Math.ceil(secs / 0.05); i++) update(); };
  function until(fn, limit = 60) {
    for (let i = 0; i < Math.ceil(limit / 0.05); i++) { if (fn()) return; update(); }
    assert.ok(fn(), JSON.stringify({ behavior: a.behavior, pos: a.pos, dbg: a._dbg, events }));
  }
  t.after(() => { part.dispose(); assert.deepEqual(window.__errors, []); });
  return { a, V, T, HB, window, events, clips, speech, step, until };
}

test('meal uses production nav: counter, take once, chair, sit, looping Eat, stand and idle', async t => {
  const { a, V, events, clips, until } = await cabin(t);
  assert.deepEqual(a.behaviorAvailability('eat'), { available: true });
  assert.equal(a.startBehavior('eat', { seconds: 1 }), true, 'host cannot shorten the meal to an animation flash');
  assert.equal(a.startBehavior('draw'), false);
  assert.deepEqual(a.behaviorAvailability('draw'), { available: false, reason: 'busy' });
  until(() => a.behavior === null);
  assert.deepEqual(events.map(e => e.phase), ['started', 'action', 'completed']);
  const order = [...new Set(clips.map(c => c.phase))];
  assert.deepEqual(order, ['to_counter', 'face_counter', 'pickup', 'to_chair', 'sit', 'action', undefined]);
  assert.ok(clips.some(c => c.phase === 'pickup' && c.overlay === 'main:use_mainhand' && c.overlayMode === 'hold'));
  assert.ok(clips.some(c => c.phase === 'sit' && c.base === 'main:sit' && !c.overlay));
  const meal = clips.filter(c => c.overlay === 'arm:use_mainhand:eat');
  assert.ok(meal.length >= 460 && meal.length <= 500, '24 seconds of Eat');
  const armAngles = new Set(meal.map(c => c.armX.toFixed(3)));
  assert.ok(armAngles.size > 20, 'Eat animates the arm, not merely a state key');
  assert.equal(events[1].state, 'furniture');
  // 2026-11-14：她坐在方块模型真正的座面上（餐椅的座面中心比格子中心往椅子正面偏 2.25/16 m，胯再往后 0.05 m），不再是格子正中间
  const FACE = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }, fwd = 2.25 / 16 - 0.05;
  assert.ok(V.houseBlocks.furnInstances('dining_chair').some(({ cell, facing }) => {
    const f = FACE[facing];
    return Math.hypot(events[1].pos[0] - (cell[0] + 0.5 + f[0] * fwd), events[1].pos[2] - (cell[2] + 0.5 + f[1] * fwd)) < 0.08;
  }), 'hips on a dining chair seat: ' + events[1].pos.map(v => v.toFixed(2)));
  assert.equal(events[2].state, 'idle');
  assert.equal(events[2].overlay, null);
  assert.ok(V.nav.walkable(a.pos[0], a.pos[2], a.pos[1]), 'stands back at the safe approach');
});

test('reply uses Run; diary/draw walk; reading uses the real bookshelf without UI', async t => {
  const { a, events, clips, until } = await cabin(t);
  for (const kind of ['reply_private', 'write_diary', 'draw', 'read']) {
    a.place(-2.4, -7.5, 0, 1);
    events.length = clips.length = 0;
    assert.equal(a.startBehavior(kind, { seconds: 1 }), true, `${kind} from indoor floor`);
    until(() => a.behavior === null);
    assert.deepEqual(events.map(e => e.phase), ['started', 'action', 'completed'], kind);
    assert.equal(clips.some(c => c.base === 'main:run'), kind === 'reply_private', kind);
    if (kind === 'reply_private') assert.ok(clips.some(c => c.v > 1.3));
    else assert.ok(clips.every(c => c.v <= 1.00001));
    assert.equal(events[1].base, kind === 'read' ? 'tlm:bookshelf' : 'tlm:keyboard');
    assert.equal(events[1].state, kind === 'read' ? 'idle' : 'furniture');
  }
});

test('blocked or snapped route, missing furniture, and interrupted meals do not report completion', async t => {
  const { a, V, HB, window, events, step, until } = await cabin(t);
  const path = V.nav.path, furn = HB.furnInstances;
  V.nav.path = (_from, to) => [[to[0] + 2, to[1], to[2]]];
  assert.deepEqual(a.behaviorAvailability('eat'), { available: false, reason: 'unreachable' });
  assert.equal(a.startBehavior('eat'), false);
  V.nav.path = path;
  HB.furnInstances = id => ['dining_chair', 'bookshelf'].includes(id) ? [] : furn(id);
  assert.deepEqual(a.behaviorAvailability('eat'), { available: false, reason: 'missing-furniture' });
  assert.deepEqual(a.behaviorAvailability('read'), { available: false, reason: 'missing-furniture' });
  HB.furnInstances = furn;
  assert.deepEqual(events, []);
  assert.ok(a.startBehavior('eat'));
  until(() => a.behavior?.phase === 'pickup');
  assert.ok(a.poke());
  assert.deepEqual(events.map(e => e.phase), ['started'], 'poking no longer interrupts the meal');
  assert.equal(a.behavior && a.behavior.kind, 'eat', 'the meal behavior is untouched');
  until(() => a.behavior?.phase === 'action');
  window.document.hidden = true;
  window.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(a.behavior, null);
  assert.equal(a.state, 'idle');
  assert.equal(events.at(-1).reason, 'hidden');
  assert.equal(a.startBehavior('eat'), false);
  assert.equal(events.filter(e => e.phase === 'completed').length, 0);
});

test('missing animation clips retain navigation, mechanical seating and cleanup', async t => {
  const { a, events, until } = await cabin(t, { fallback: true });
  assert.ok(a.startBehavior('eat'));
  until(() => a.behavior?.phase === 'action');
  assert.equal(a.state, 'furniture');
  assert.equal(a.inst.actorAnimation.overlay, null);
  assert.equal(Math.abs(a.inst.bones.legL.rotation.x), Math.PI / 2);
  until(() => a.behavior === null);
  assert.deepEqual(events.map(e => e.phase), ['started', 'action', 'completed']);
});

// 2026-11-14：捡完以后先举手欢呼（pose 'cheer'）再回到空闲；collect() 进入「收拾沙滩」状态，沙滩空了才退出。
// 以前的假游戏 free() 一直返回这一颗（捡走以后也是），收拾状态下会一直去捡它，所以改成按沙滩上还剩什么返回
test('shell pickup stays one-shot, holds the last frame, cheers with both hands, then returns to idle', async t => {
  const { a, V, clips, speech, until } = await cabin(t);
  let claim = null, calls = 0;
  const shell = { id: 's', x: a.pos[0] + 0.65, z: a.pos[2] + 0.25, at: 0 };
  V.game = { S: { girlAuto: false }, st: { beach: [shell] }, free() { return this.st.beach.filter(b => claim !== 'girl' || b.id !== 's'); },
    claim: () => !!(claim = 'girl'), claimedBy: () => claim,
    unclaim: () => { claim = null; }, collect() { calls++; this.st.beach = []; claim = null; return { kind: { name: '测试贝壳' } }; } };
  assert.ok(a.collect('s'));
  assert.equal(a.sweeping, true, 'collect() starts the sweep state');
  until(() => a._dbg.sub === 'hold');
  assert.equal(a.inst.actorAnimation.overlayMode, 'hold');
  until(() => a._dbg.sub === 'cheer' && a._dbg.pose === 'cheer');
  assert.equal(a.state, 'collect', 'still collecting while she cheers');
  until(() => a.state === 'idle');
  assert.equal(a.sweeping, false, 'the beach is empty: the sweep is over');
  assert.equal(a._dbg.pose, 'stand');
  assert.equal(a.inst.actorAnimation.overlay, null);
  assert.equal(calls, 1);
  assert.ok(speech.some(text => text.includes('测试贝壳')));
  assert.ok(clips.some(c => c.overlay === 'main:use_mainhand'));
});

test('the actor recognizes player shell finds without interrupting desk work', async t => {
  const { a, V, speech, until } = await cabin(t);
  const collect = (by, name, category = 'collectible') => V.emit('game:collect', { by, kind: { name, category } });
  collect('girl', '自己捡的壳');
  collect('player', '旧瓶盖', 'trash');
  assert.deepEqual(speech, []);
  collect('player', '青贝壳');
  assert.match(speech.at(-1), /你.*青贝壳/);
  assert.ok(a.startBehavior('draw', { seconds: 1 }));
  collect('player', '白贝壳');
  assert.ok(a.behavior);
  assert.ok(!speech.some(text => text.includes('白贝壳')));
  until(() => a.behavior === null);
  until(() => speech.some(text => /你.*白贝壳/.test(text)), 20);
});

test('a player taking the targeted shell cancels her claim and gets the first-pick response', async t => {
  const { a, V, speech } = await cabin(t);
  const item = { id: 'first', x: a.pos[0] + .65, z: a.pos[2] + .25 };
  V.game = { S: { girlAuto: false }, st: { beach: [item] }, free: () => [], claim: () => true,
    claimedBy: () => 'girl', unclaim: () => {}, collect: () => assert.fail('she must not collect the removed shell') };
  assert.ok(a.collect(item.id));
  V.game.st.beach = [];
  V.emit('game:collect', { by: 'player', item, kind: { name: '扇贝', category: 'collectible' } });
  assert.equal(a._dbg.task, null);
  assert.match(speech.at(-1), /你.*先捡/);
});
test('feeding while seated keeps the current behavior and overlays the eating arm (no interrupt)', async t => {
  const { a, clips, until, step } = await cabin(t);
  assert.equal(a.startBehavior('sea', { seconds: 8 }), true);
  until(() => a.behavior && a.behavior.phase === 'action');
  const pos = a.pos.slice();
  assert.equal(a.state, 'furniture');
  assert.equal(a.snack({ kind: 'eat', text: '好吃' }), true);
  assert.equal(a.behavior && a.behavior.kind, 'sea', 'seated snack must not cancel the behavior');
  assert.equal(a.behavior && a.behavior.phase, 'action');
  assert.ok(a.snacking, 'snacking is active');
  assert.deepEqual(a.pos, pos, 'she stays seated where she was');
  step(0.2);
  const last = clips.at(-1);
  assert.equal(last.state, 'furniture');
  assert.equal(last.overlay, 'arm:use_mainhand:eat');
});

test('feeding while she is walking to a behavior is refused without cancelling it', async t => {
  const { a } = await cabin(t);
  assert.equal(a.startBehavior('read', { seconds: 8 }), true);
  const b0 = a.behavior;
  assert.ok(b0, 'behavior started');
  assert.notEqual(b0.phase, 'action');
  assert.equal(a.snack({ kind: 'eat' }), false, 'refused while she is on her way');
  assert.deepEqual(a.behavior, b0, 'the behavior is untouched');
});
test('poking her while seated keeps the current behavior (no interrupt)', async t => {
  const { a, speech, until } = await cabin(t);
  assert.equal(a.startBehavior('sea', { seconds: 8 }), true);
  until(() => a.behavior && a.behavior.phase === 'action');
  const pos = a.pos.slice(), b = a.behavior;
  assert.ok(a.poke());
  assert.deepEqual(a.behavior, b, 'seated poke must not cancel the behavior');
  assert.deepEqual(a.pos, pos, 'she stays seated where she was');
  assert.equal(a.state, 'furniture');
  assert.ok(speech.length > 0, 'she still says something');
});

test('poking her while walking to a behavior does not cancel it', async t => {
  const { a } = await cabin(t);
  assert.equal(a.startBehavior('read', { seconds: 8 }), true);
  const b = a.behavior;
  assert.ok(b && b.phase !== 'action');
  assert.ok(a.poke());
  assert.deepEqual(a.behavior, b, 'the behavior is untouched');
});