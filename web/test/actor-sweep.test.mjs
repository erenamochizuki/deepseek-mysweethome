// 收拾沙滩是一个状态（2026-11-14，用户的要求）：沙滩上有了能捡的东西 → 计时（从最早冲上来的那一件算起）→ 时间到进入「收拾」状态 →
// 把沙滩上所有的东西一件接一件捡完（途中新冲上来的也捡）→ 回到空闲。每捡起一件，站起来以后两只手举起来欢呼、蹦两下。
// 真实房屋 + 真实寻路 + 真实角色（自带的 YSM 模型），假的沙滩（tools/lib/actor-cabin.mjs 的 fakeGame）。
//   node --test test/actor-sweep.test.mjs
//   YSM_SRC_DIR=<改动前的 src>：同一批断言在旧代码上应当失败（旧代码一次只冲着一颗去，捡完就回空闲，没有欢呼）
import test from 'node:test';
import assert from 'node:assert/strict';
import { actorCabin, fakeGame } from '../tools/lib/actor-cabin.mjs';

const src = process.env.YSM_SRC_DIR ? { srcDir: process.env.YSM_SRC_DIR } : {};
const LONG_AGO = () => Date.now() - 3600e3;

// 她身边沙滩上三个能走到的点（门廊台阶前的沙滩，往海那边）
function spots(c, n = 3) {
  const [x, , z] = c.a.pos, out = [], N = c.V.nav;
  for (const [dx, dz] of [[1.2, 2.2], [-1.6, 3.0], [2.6, 3.6], [0.3, 4.4], [-2.8, 1.8], [3.4, 1.6]]) {
    const p = [x + dx, z + dz];
    if (N.walkable(p[0], p[1]) && out.length < n) out.push(p);
  }
  assert.equal(out.length, n, 'found walkable beach spots');
  return out;
}
const item = (id, p, at = LONG_AGO()) => ({ id, x: p[0], z: p[1], at, kind: 'k' });

test('nothing happens before the timer is up; then one sweep collects every item, cheering after each, and ends when the beach is empty', async t => {
  const G = fakeGame([], { girlMin: 600, girlMax: 600 });
  const c = await actorCabin(t, { game: G, ...src }), { a } = c;
  c.V.viewTokens.girl('auto');
  const [p1, p2, p3] = spots(c);
  G.add(item('a', p1, Date.now()), item('b', p2, Date.now()));
  c.step(20);
  assert.equal(G.collected.length, 0, 'the timer (girlMin..girlMax from the first item) is not up yet');
  assert.notEqual(a.state, 'collect');
  assert.equal(c.sweeps.length, 0);
  // 时间到了：把冲上来的时间往前挪（等够了），再加一件
  for (const b of G.st.beach) b.at = LONG_AGO();
  G.add(item('c', p3));
  c.until(() => c.sweeps.length > 0, 20, 'the sweep starts once the timer is up');
  assert.equal(c.sweeps[0].phase, 'started');
  const from = c.frames.length;
  c.until(() => c.sweeps.length > 1, 120, 'the sweep ends');
  assert.deepEqual(G.collected.map(x => x.by), ['girl', 'girl', 'girl'], 'all three collected by her in one sweep');
  assert.deepEqual(c.sweeps.map(s => s.phase), ['started', 'ended']);
  assert.equal(c.sweeps[1].count, 3); assert.equal(c.sweeps[1].reason, 'done');
  const during = c.frames.slice(from, -1);
  assert.ok(during.every(f => f.state === 'collect'), 'state stays "collect" from the first item to the last (no idle in between): '
    + [...new Set(during.map(f => f.state))].join(','));
  // 每一件之后都有一段欢呼：模型放它自己的 jump 动画演一下（pose 'cheer'），然后站着举手保持。
  // 蹦由模型动画演，代码不再抬 root（2026-11-16：抬 root 会和 jump 自带的弹跳叠成两下）
  const cheers = [];
  for (let i = from; i < c.frames.length; i++) {
    const f = c.frames[i];
    if (f.sub === 'cheer' && f.pose === 'cheer' && (!cheers.length || c.frames[i - 1].sub !== 'cheer')) cheers.push(i);
  }
  assert.equal(cheers.length, 3, 'one cheer per item');
  const cheerFrames = c.frames.slice(from).filter(f => f.sub === 'cheer');
  assert.ok(cheerFrames.some(f => f.pose === 'cheer'), 'the model plays its own jump once per cheer');
  assert.ok(cheerFrames.some(f => f.pose === 'stand'), 'after the jump she stands and holds the pose');
  const lift = Math.max(...cheerFrames.map(f => f.lift));
  assert.ok(lift < 1e-6, 'the hop comes from the model animation, not from moving her root: ' + lift.toFixed(3));
  c.step(1);
  assert.equal(a.sweeping, false);
  assert.notEqual(a.state, 'collect');
  assert.ok(c.speech.some(s => /收拾干净|都捡回来|收获/.test(s)), 'a line when the sweep is done');
});

test('an item washed up during the sweep is collected too; the sweep goes nearest first', async t => {
  const c0 = await actorCabin(t, { game: fakeGame([]), ...src });
  const [near, far, late] = spots(c0);
  const [x, , z] = c0.a.pos;
  const G = fakeGame([item('far', Math.hypot(far[0] - x, far[1] - z) > Math.hypot(near[0] - x, near[1] - z) ? far : near),
    item('near', Math.hypot(far[0] - x, far[1] - z) > Math.hypot(near[0] - x, near[1] - z) ? near : far)]);
  c0.V.game = G;
  c0.V.viewTokens.girl('auto');
  c0.until(() => G.collected.length === 1, 60, 'first item');
  assert.equal(G.collected[0].id, 'near', 'nearest first');
  G.add(item('late', late));
  c0.until(() => c0.sweeps.some(s => s.phase === 'ended'), 120, 'sweep ends');
  assert.deepEqual(G.collected.map(x => x.id).sort(), ['far', 'late', 'near']);
  assert.equal(c0.sweeps.filter(s => s.phase === 'started').length, 1, 'one sweep, not one start per item');
});

test('interrupted (the player pokes her): the sweep ends as "interrupted", then resumes by itself and finishes the beach', async t => {
  const c = await actorCabin(t, { game: fakeGame([]), ...src }), { a } = c;
  const G = fakeGame(spots(c).map((p, i) => item('i' + i, p)));
  c.V.game = G;
  c.V.viewTokens.girl('auto');
  c.until(() => G.collected.length === 1, 60, 'first item');
  c.until(() => a._dbg.sub !== 'cheer' && a._dbg.mode === 'walk', 10, 'on her way to the next one');
  assert.ok(a.respond('嗯？', { seconds: 2 }));
  assert.equal(c.sweeps.at(-1).phase, 'ended'); assert.equal(c.sweeps.at(-1).reason, 'interrupted');
  assert.equal(G.free().length, 2, 'the item she was walking to is released');
  c.until(() => c.sweeps.filter(s => s.phase === 'started').length === 2, 20, 'resumes after answering');
  c.until(() => G.st.beach.length === 0 && !a.sweeping, 120, 'the beach is cleared');
  assert.equal(G.collected.length, 3);
});

test('night (rest): the sweep stops at once and does not start again; storm and the "collect by herself" setting keep it from starting', async t => {
  const c = await actorCabin(t, { game: fakeGame([]), ...src }), { a } = c;
  const G = fakeGame(spots(c).map((p, i) => item('n' + i, p)));
  c.V.game = G;
  c.V.viewTokens.girl('auto');
  c.until(() => a.sweeping, 20, 'sweeping');
  a.rest(true);
  assert.equal(a.sweeping, false); assert.equal(c.sweeps.at(-1).reason, 'night');
  const n = G.collected.length;
  c.step(40);
  assert.ok(G.collected.length <= n + 1, 'at most the item already being saved');
  assert.equal(c.sweeps.filter(s => s.phase === 'started').length, 1, 'no new sweep at night');
  a.rest(false);
  G.S.girlAuto = false;
  c.step(30);
  assert.equal(c.sweeps.filter(s => s.phase === 'started').length, 1, 'setting off: she does not start by herself');
  assert.ok(a.collect(), 'but asked to collect (chat / girl=collect) she does');
  assert.equal(a.sweeping, true);
  c.until(() => G.st.beach.length === 0 && !a.sweeping, 120, 'and clears the beach');
});

// 小屋事件（2026-11-15，v6）：收工以后报一条 game:cabin-event type=sweep_end，桥接那边她才知道「把沙滩收拾干净了」。
// 一件都没捡到（夜里该睡了退出 / 被打断 / 一件都够不着）不报，别刷噪声。
test('cabin event: a finished sweep reports sweep_end with the count; a sweep that collected nothing reports nothing', async t => {
  const c = await actorCabin(t, { game: fakeGame([]), ...src }), { a } = c;
  const cabin = [];
  c.V.on('game:cabin-event', e => cabin.push({ ...e }));
  const G = fakeGame(spots(c).map((p, i) => item('e' + i, p)));
  c.V.game = G;
  c.V.viewTokens.girl('auto');
  c.until(() => a.sweeping, 20, 'sweeping');
  c.until(() => !a.sweeping, 120, 'the beach is cleared');
  const ends = cabin.filter(e => e.type === 'sweep_end');
  assert.equal(ends.length, 1, 'one report for one sweep: ' + JSON.stringify(cabin));
  assert.deepEqual(ends[0].detail, { count: 3, reason: 'done' });
  assert.equal(ends[0].text, '收拾了沙滩上冲上来的 3 件东西');
  assert.match(ends[0].id, /^[A-Za-z0-9_-]{1,80}$/, 'the id must pass the server\'s /^[A-Za-z0-9_-]{1,80}$/');
  assert.ok(Number.isFinite(ends[0].at) && ends[0].at > 0);
  // 沙滩空着再让她捡：进了一下收拾状态就退出（count = 0），这种不上报
  const before = cabin.length;
  assert.equal(a.collect(), false, 'nothing left on the beach');
  c.step(1);
  assert.equal(cabin.length, before, 'count = 0 is not reported: ' + JSON.stringify(cabin.slice(before)));
  assert.equal(cabin.filter(e => e.type === 'sweep_end').length, 1);
});
