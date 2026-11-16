// 空闲时她自己找的消遣、你叫她一起看、跑着去、坐在真正的座面上（2026-11-14，用户的要求 3 / 4 / 5 / 6）。
// 真实房屋（默认房子：一楼沙发朝着电视、书桌和书桌椅，阁楼相册矮桌，门廊台阶）+ 真实寻路 + 真实角色（自带的 YSM 模型）。
//   node --test test/actor-leisure.test.mjs
//   YSM_SRC_DIR=<改动前的 src>：同一批断言在旧代码上应当失败
import test from 'node:test';
import assert from 'node:assert/strict';
import { actorCabin, fakeGame } from '../tools/lib/actor-cabin.mjs';

const src = process.env.YSM_SRC_DIR ? { srcDir: process.env.YSM_SRC_DIR } : {};
const ahead = (f, d) => [f.center[0] + Math.sin(f.yaw) * d, f.center[1], f.center[2] + Math.cos(f.yaw) * d];
const flat = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]);
const phases = (events, kind) => events.filter(e => e.kind === kind).map(e => e.phase + (e.reason ? '(' + e.reason + ')' : ''));

test('task 6: at the computer she sits on the desk chair\'s seat (not on its back rest), after running there', async t => {
  const c = await actorCabin(t, src), { a } = c;
  const [chair] = c.furn('desk_chair');
  assert.ok(a.startBehavior('reply_private'));
  c.until(() => a.behavior?.phase === 'action', 60, 'typing');
  const seat = ahead(chair, 3.75 / 16 - 0.05), p = a.pos;
  assert.ok(flat(p, seat) < 0.08, 'hips over the seat cushion: ' + p.map(v => v.toFixed(2)) + ' seat ' + seat.map(v => v.toFixed(2)));
  // 椅背在格子正中（chair.center）：胯要在它前面（椅子正面那边）至少 0.12 m
  const front = (p[0] - chair.center[0]) * Math.sin(chair.yaw) + (p[2] - chair.center[2]) * Math.cos(chair.yaw);
  assert.ok(front > 0.12, 'in front of the back rest by ' + front.toFixed(3) + ' m');
  assert.ok(Math.abs(p[1] - (chair.center[1] + 0.43)) < 0.02, 'hip height above the seat');
  assert.equal(a.inst.actorAnimation.base, 'tlm:keyboard');
  // task 4：一路跑过去（模型的 run 动画，速度比走路快）
  const going = c.frames.filter(f => f.kind === 'reply_private' && f.phase === 'to_desk');
  assert.ok(Math.max(...going.map(f => f.v)) > 1.8, 'she runs: ' + Math.max(...going.map(f => f.v)).toFixed(2) + ' m/s');
  assert.ok(going.some(f => f.base === 'main:run'), 'with the run clip');
});

test('task 4: the meal is a run too; reading by herself is a walk', async t => {
  const c = await actorCabin(t, src), { a } = c;
  assert.ok(a.startBehavior('eat'));
  c.until(() => a.behavior?.phase === 'pickup', 60, 'at the counter');
  assert.ok(c.frames.some(f => f.kind === 'eat' && f.base === 'main:run'), 'runs to the counter');
  a.cancelBehavior('test');
  c.step(1);
  const from = c.frames.length;
  assert.ok(a.startBehavior('read'));
  c.until(() => a.behavior?.phase === 'action', 60, 'reading');
  const walk = c.frames.slice(from).filter(f => f.kind === 'read');
  assert.ok(Math.max(...walk.map(f => f.v)) <= 1.05, 'reading by herself: she walks');
  assert.ok(!walk.some(f => f.base === 'main:run'));
});

test('task 3: watching TV she sits on the sofa that faces it; with no sofa, on the floor in front of the TV', async t => {
  const c = await actorCabin(t, src), { a } = c;
  const [tv] = c.furn('tv_stand'), [sofa] = c.furn('sofa');
  assert.ok(tv && sofa, 'the default house has both');
  assert.ok(a.startBehavior('watch_tv'));
  c.until(() => a.behavior?.phase === 'action', 60, 'watching');
  assert.equal(a.state, 'furniture');
  const p = a.pos, mid = ahead(sofa, 0.75 / 16 - 0.05);
  const lat = (p[0] - mid[0]) * Math.cos(sofa.yaw) - (p[2] - mid[2]) * Math.sin(sofa.yaw);
  assert.ok(Math.abs(Math.abs(lat) - 0.4) < 0.05 && flat(p, mid) < 0.45, 'on one of the two sofa seats: ' + p.map(v => v.toFixed(2)));
  assert.ok(Math.abs(p[1] - (sofa.center[1] + 0.47)) < 0.02, 'hip height on the cushion');
  assert.ok(c.faces(a.yaw, p, tv.center), 'facing the TV');
  assert.equal(a.inst.actorAnimation.base, 'main:sit', 'just sits (no typing)');
  const e = c.events.find(x => x.kind === 'watch_tv' && x.phase === 'action');
  assert.equal(e.leisure, true); assert.deepEqual(e.spot, tv.center, 'the event names the TV (69-furniture-play switches that one on)');
});

test('task 3: no sofa → on the floor in front of the TV', async t => {
  const c = await actorCabin(t, src), { a, HB } = c;
  const all = HB.furnInstances; HB.furnInstances = id => (id === 'sofa' ? [] : all(id));
  const [tv] = c.furn('tv_stand');
  assert.ok(a.startBehavior('watch_tv'));
  c.until(() => a.behavior?.phase === 'action', 60, 'watching');
  const d = flat(a.pos, tv.center);
  assert.ok(d > 1.25 && d < 2.2, 'in front of the TV: ' + d.toFixed(2) + ' m');
  assert.ok(Math.abs(a.pos[1] - (tv.center[1] + 0.06)) < 0.02, 'sitting on the floor');
  assert.ok(c.faces(a.yaw, a.pos, tv.center), 'facing the TV');
});

test('task 3: the album — on the floor beside the loft album table, facing it', async t => {
  const c = await actorCabin(t, src), { a } = c;
  const [table] = c.furn('photo_album_table');
  assert.ok(a.startBehavior('album'));
  c.until(() => a.behavior?.phase === 'action', 90, 'at the album');
  const d = flat(a.pos, table.center);
  assert.ok(d > 0.9 && d < 1.2, 'beside the table: ' + d.toFixed(2));
  assert.ok(Math.abs(a.pos[1] - (table.center[1] + 0.06)) < 0.02, 'on the loft floor');
  assert.ok(c.faces(a.yaw, a.pos, table.center), 'facing the table');
  assert.equal(a.state, 'furniture');
});

test('task 5: she sits on the porch edge above the steps looking at the sea; not when it rains', async t => {
  const c = await actorCabin(t, src), { a, V } = c;
  assert.ok(a.startBehavior('sea'));
  c.until(() => a.behavior?.phase === 'action', 60, 'sitting on the steps');
  const P = V.layout.porch;
  assert.ok(a.pos[0] > P.steps.x0 - 0.2 && a.pos[0] < P.steps.x1 + 0.2, 'over the steps');
  assert.ok(Math.abs(a.pos[2] - (P.z1 - 0.08)) < 0.06, 'on the porch edge: z ' + a.pos[2].toFixed(2));
  assert.ok(Math.abs(Math.cos(a.yaw) - 1) < 0.01, 'facing the sea (+z)');
  assert.ok(Math.abs(Math.abs(a.inst.bones.legL.rotation.x) - 1.2) < 1e-6, 'legs hang down over the step');
  a.cancelBehavior('test'); c.step(1);
  V.wx = { now: () => ({ rain: 1, snow: 0, storm: 0 }) };
  assert.deepEqual(a.behaviorAvailability('sea'), { available: false, reason: 'blocked' });
});

test('sea: while she sits on the steps she now and then plays one of the model\'s own idle actions (the iron basin idle_1 among them), then sits again', async t => {
  const c = await actorCabin(t, src), { a } = c;
  assert.ok(a.startBehavior('sea', { seconds: 90 }));
  c.until(() => a.behavior?.phase === 'action', 60);
  const from = c.frames.length;
  c.until(() => a.behavior === null, 120, 'sea visit over');
  const bases = c.frames.slice(from).filter(f => f.kind === 'sea' && f.phase === 'action').map(f => f.base);
  const fidgets = [...new Set(bases.filter(b => b && b !== 'main:sit'))];
  assert.ok(fidgets.length >= 1, 'at least one random action in 90 s: ' + fidgets.join(','));
  assert.ok(fidgets.every(f => /^(main:idle_1|extra:extra\d+)$/.test(f)), fidgets.join(','));
  // 动作之间回到坐着；整段时间她一直坐在台阶上
  assert.ok(bases.filter(b => b === 'main:sit').length > 200, 'mostly just sitting');
  assert.ok(c.frames.slice(from).filter(f => f.kind === 'sea' && f.phase === 'action').every(f => f.state === 'furniture'), 'seated all the time');
});

test('telescope (loft): only at night; she stands behind it, crouches (MC sneak) at the eyepiece, says things; dawn ends it', async t => {
  const c = await actorCabin(t, src), { a, V } = c;
  const [scope] = c.furn('telescope');
  assert.ok(scope, 'the default loft has a telescope');
  V.env = { state: { night: 0, stars: 0 } };
  assert.equal(a.starry, false);
  assert.deepEqual(a.behaviorAvailability('stargaze'), { available: false, reason: 'daytime' });
  V.env.state.night = V.env.state.stars = 1;
  assert.equal(a.starry, true);
  assert.ok(a.join('stargaze', {}), 'you click the telescope at night: she comes');
  c.until(() => a.behavior?.phase === 'action', 90, 'at the eyepiece');
  assert.equal(a.inst.actorAnimation.base, 'main:sneaking', 'MC crouch');
  // 站在望远镜背面（目镜那头）、面朝正面（物镜那头）
  const back = -((a.pos[0] - scope.center[0]) * Math.sin(scope.yaw) + (a.pos[2] - scope.center[2]) * Math.cos(scope.yaw));
  assert.ok(back > 0.5 && back < 0.9, 'behind the telescope by ' + back.toFixed(2));
  assert.ok(Math.abs(Math.cos(a.yaw - scope.yaw) - 1) < 0.01, 'looking along the tube');
  assert.ok(Math.abs(a.pos[1] - scope.center[1]) < 0.05, 'on the loft floor');
  assert.ok(c.frames.some(f => f.kind === 'stargaze' && f.base === 'main:run'), 'ran there (you called her)');
  const said = c.speech.length;
  c.step(40);
  assert.equal(a.behavior?.kind, 'stargaze', 'held while you watch together');
  assert.ok(c.speech.length - said >= 2, 'she talks while looking: ' + c.speech.slice(said).join(' / '));
  V.env.state.night = V.env.state.stars = 0;
  c.until(() => a.behavior === null, 2, 'dawn: she stops');
  assert.match(c.speech.at(-1), /天亮/);
  assert.equal(c.events.filter(e => e.kind === 'stargaze').at(-1).phase, 'completed');
});

test('give way: real things preempt leisure; the player asking for another thing switches; asking for the same one joins in', async t => {
  const c = await actorCabin(t, src), { a } = c;
  assert.ok(a.startBehavior('watch_tv'));
  c.until(() => a.behavior?.phase === 'action', 60);
  assert.equal(a.startBehavior('read'), false, 'leisure does not preempt leisure by itself');
  assert.ok(a.startBehavior('eat'), 'a meal preempts it');
  assert.deepEqual(phases(c.events, 'watch_tv'), ['started', 'action', 'cancelled(preempted)']);
  a.cancelBehavior('test'); c.step(1);

  assert.ok(a.startBehavior('watch_tv'));
  c.until(() => a.behavior?.phase === 'action', 60);
  assert.ok(a.join('album', {}), 'you open the album: she comes over');
  assert.equal(a.behavior.kind, 'album'); assert.equal(a.behavior.together, true);
  assert.equal(phases(c.events, 'watch_tv').at(-1), 'cancelled(preempted)');
  c.until(() => a.behavior?.phase === 'action', 90, 'at the album');
  assert.ok(c.frames.some(f => f.kind === 'album' && f.base === 'main:run'), 'ran there');
  const starts = phases(c.events, 'album').filter(p => p === 'started').length;
  assert.ok(a.join('album', {}), 'asking again while she is at it');
  assert.equal(phases(c.events, 'album').filter(p => p === 'started').length, starts, 'no restart');
  assert.equal(a.behavior.phase, 'action');
});

test('watching along ends with the thing you opened (while → false); unless together, leisure gives way to a beach that is due', async t => {
  const c = await actorCabin(t, src), { a, V } = c;
  let open = true;
  assert.ok(a.join('album', { while: () => open }));
  c.until(() => a.behavior?.phase === 'action', 90);
  c.step(3);
  assert.equal(a.behavior?.kind, 'album', 'stays while the album is open (held)');
  c.step(30);
  assert.equal(a.behavior?.kind, 'album', 'held: longer than the usual 24 s');
  open = false;
  c.until(() => a.behavior === null, 2, 'gets up once it is closed');
  assert.equal(phases(c.events, 'album').at(-1), 'completed');

  // 她自己在看电视，沙滩上的东西等够了：放下电视去收拾
  assert.ok(a.startBehavior('watch_tv'));
  c.until(() => a.behavior?.phase === 'action', 60);
  const [x, , z] = [-1.6, 0, 1.4];
  V.game = fakeGame([{ id: 'w', x, z, at: Date.now() - 3600e3 }]);
  c.until(() => a.behavior === null, 2);
  assert.equal(phases(c.events, 'watch_tv').at(-1), 'cancelled(collect)');
  c.until(() => a.sweeping, 5, 'she starts the sweep');
});

// 小屋事件（2026-11-15，v6）：她自己开始一样消遣 → game:cabin-event type=leisure_start，detail {kind, together:false}；
// 你点了同一样东西过来陪看（join）→ 只有 together 从假变真那一下再报一条 together:true，之后再叫不重复报；每拍不报。
test('cabin event: leisure_start once per leisure (kind + together); joining in reports together exactly once', async t => {
  const c = await actorCabin(t, src), { a } = c;
  const cabin = [];
  c.V.on('game:cabin-event', e => cabin.push({ ...e }));
  const starts = () => cabin.filter(e => e.type === 'leisure_start');
  assert.ok(a.startBehavior('read'));
  c.until(() => a.behavior?.phase === 'action', 60, 'reading by herself');
  assert.equal(starts().length, 1, 'one report when she starts by herself: ' + JSON.stringify(cabin));
  assert.deepEqual(starts()[0].detail, { kind: 'read', together: false });
  assert.equal(starts()[0].text, '自己翻几页书');
  assert.match(starts()[0].id, /^[A-Za-z0-9_-]{1,80}$/);
  // 站着 / 看书的每一拍都不再报
  c.step(12);
  assert.equal(starts().length, 1, 'no report per tick');
  // 你点书架上的日记本：同一样消遣、变成陪你 → together 变了，补一条
  assert.ok(a.join('read', {}));
  assert.equal(a.behavior.together, true);
  assert.equal(starts().length, 2, 'alone → together reports once more: ' + JSON.stringify(cabin));
  assert.deepEqual(starts()[1].detail, { kind: 'read', together: true });
  assert.equal(starts()[1].text, '过来陪我一起看书');
  // 再点一次：还是陪着看，不重复报
  assert.ok(a.join('read', {}));
  c.step(2);
  assert.equal(starts().length, 2, 'asking again does not report again');
  // 换一样消遣：新的一段，报它自己的 kind
  a.cancelBehavior('test'); c.step(1);
  assert.ok(a.startBehavior('watch_tv'));
  c.until(() => a.behavior?.phase === 'action', 60, 'watching');
  assert.equal(starts().length, 3);
  assert.deepEqual(starts()[2].detail, { kind: 'watch_tv', together: false });
  assert.equal(starts()[2].text, '自己看会儿电视');
});
