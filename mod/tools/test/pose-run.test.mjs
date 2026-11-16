// 截图前核对站位（task-14），对着 mock 真的跑 shot：tp 之后对得上就截；截图前 / 截图时被动过 → pose_changed；
// pose 覆盖、pose: false、相对 tp 这些不核对的情况写清原因；离开世界后前面的 tp 不算。运行：node --test mod/tools/test/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCard, runStep, StepFailed } from '../lib/cards.mjs';
import { POSE_SETTLE_MS } from '../lib/pose.mjs';
import { ProbeClient } from '../probe-client.mjs';
import { startMockProbe, makeTempDir } from './mock-probe.mjs';
import { writeCard, removeDir } from './helpers.mjs';

const tmp = makeTempDir('poserun-');
test.after(() => removeDir(tmp));
let n = 0;
const card = (text) => loadCard(writeCard(tmp, `poserun-${++n}.yml`, text));
const OPEN = 'steps:\n  - open\n  - wait:\n      inWorld: true\n      screen: null\n      timeout: 10\n';
const TP = '  - cmd: tp @s 3 -60 -2 145 17\n'; // 站到 (3.5, -60, -1.5)，朝 145° 往下 17°
const WANT = { x: 3.5, y: -60, z: -1.5, yaw: 145, pitch: 17 };
const ZERO = { dist: 0, dYaw: 0, dPitch: 0 };

// 起一个 mock（hooks.onShot 在测试里随时换），配好 runStep 要的 ctx
async function mockCtx() {
  const dir = path.join(tmp, `game${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const hooks = { onShot: null };
  const mock = await startMockProbe({ dir, onShot: (st) => hooks.onShot?.(st) });
  const ctx = { client: new ProbeClient({ port: mock.port, token: mock.token }), shotsDir: path.join(dir, 'shots'), runId: '20261106-101500', gameDir: dir, snapshots: new Map() };
  return { mock, ctx, hooks, done: () => mock.close() };
}
const shots = (mock) => mock.requests.filter((q) => q.path === '/screenshot').length;
async function runAll(steps, ctx) {
  const res = [];
  for (const s of steps) res.push(await runStep(s, ctx));
  return res;
}

test('tp 之后站位对得上：照常截图，结果里有 player 和核对记录', async () => {
  const { mock, ctx, done } = await mockCtx();
  try {
    const res = await runAll(card(`${OPEN}${TP}  - shot: a\n`).steps, ctx);
    const r = res[3];
    assert.ok(fs.existsSync(r.copy), r.copy);
    const { x, y, z, yaw, pitch } = r.player;
    assert.deepEqual({ x, y, z, yaw, pitch }, WANT);
    assert.deepEqual([r.pose.checked, r.pose.source], [true, '第 3 步的 tp']);
    assert.deepEqual(r.pose.expected, WANT);
    assert.deepEqual(r.pose.before, ZERO);
    assert.deepEqual(r.pose.after, ZERO);
    assert.equal(shots(mock), 1);
  } finally {
    await done();
  }
});

test('截图前被动过（08:40 那种）：等 POSE_SETTLE_MS 还对不上就 pose_changed，不截图', async () => {
  const { mock, ctx, done } = await mockCtx();
  try {
    const c = card(`${OPEN}${TP}  - shot: a\n`);
    await runAll(c.steps.slice(0, 3), ctx);
    Object.assign(mock.state.player, { yaw: 129.4, pitch: 90 }); // 有人动了鼠标：转了过去，还朝下看
    const t0 = Date.now();
    await assert.rejects(runStep(c.steps[3], ctx), (e) => {
      assert.ok(e instanceof StepFailed);
      assert.equal(e.code, 'pose_changed');
      assert.match(e.message, /^截图前玩家的位置或朝向变了（可能有人动了键盘鼠标，或者卡片 tp 之后又移动了玩家）：期望 \(3\.5, -60, -1\.5\) yaw 145 pitch 17，实际 \(3\.5, -60, -1\.5\) yaw 129\.4 pitch 90（yaw 差 15\.6°，pitch 差 73°）$/);
      assert.deepEqual(e.expected, { pose: WANT });
      assert.deepEqual(e.actual.problems, ['yaw 差 15.6°', 'pitch 差 73°']);
      assert.equal(e.result.path, null);
      assert.equal(e.result.player.yaw, 129.4);
      return true;
    });
    assert.ok(Date.now() - t0 >= POSE_SETTLE_MS - 50, '先等 tp 生效再判');
    assert.equal(shots(mock), 0, '对不上就不截图');
  } finally {
    await done();
  }
});

test('tp 刚执行、客户端还没对上：POSE_SETTLE_MS 里对上了就照常截图', async () => {
  const { mock, ctx, done } = await mockCtx();
  try {
    const c = card(`${OPEN}${TP}  - shot: a\n`);
    await runAll(c.steps.slice(0, 3), ctx);
    const p = mock.state.player;
    p.yaw = 0; // 假装客户端还没收到新朝向
    const timer = setTimeout(() => { p.yaw = 145; }, 300);
    try {
      const r = await runStep(c.steps[3], ctx);
      assert.equal(r.pose.checked, true);
      assert.deepEqual(r.pose.before, ZERO);
      assert.equal(shots(mock), 1);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await done();
  }
});

test('截图时被动过：pose_changed，图照样复制出来给人看', async () => {
  const { mock, ctx, hooks, done } = await mockCtx();
  try {
    const c = card(`${OPEN}${TP}  - shot: a\n`);
    await runAll(c.steps.slice(0, 3), ctx);
    hooks.onShot = (st) => { st.player.yaw += 30; };
    await assert.rejects(runStep(c.steps[3], ctx), (e) => {
      assert.equal(e.code, 'pose_changed');
      assert.match(e.message, /^截图时玩家的位置或朝向变了.*（yaw 差 30°）$/);
      assert.ok(fs.existsSync(e.result.copy), '图留着');
      assert.equal(e.result.pose.after.dYaw, 30);
      assert.equal(e.result.player.yaw, 145, 'player 是截图前读到的');
      assert.equal(e.result.pose.playerAfter.yaw, 175);
      return true;
    });
    assert.equal(shots(mock), 1);
  } finally {
    await done();
  }
});

test('shot 写了 pose：按卡片里的 pose 核对（这时 tp 用相对坐标也行）', async () => {
  const { mock, ctx, done } = await mockCtx();
  try {
    const c = card(`${OPEN}  - cmd: tp @s ~2 ~ ~ 90 0\n  - shot:\n      name: a\n      pose: {x: 2.5, y: -60, z: 0.5, yaw: 90, pitch: 0}\n  - shot:\n      name: b\n      pose: {x: 2.5, y: -60, z: 0.5, yaw: 90, pitch: 30}\n`);
    const res = await runAll(c.steps.slice(0, 4), ctx);
    assert.deepEqual([res[3].pose.checked, res[3].pose.source, res[3].pose.before], [true, '卡片里的 pose', ZERO]);
    await assert.rejects(runStep(c.steps[4], ctx), (e) => e.code === 'pose_changed' && /（pitch 差 30°）$/.test(e.message));
    assert.equal(shots(mock), 1);
  } finally {
    await done();
  }
});

test('不核对的情况写清原因：还没 tp 过、pose: false、相对 tp、没写朝向、as server', async () => {
  const { mock, ctx, hooks, done } = await mockCtx();
  try {
    const c = card(`${OPEN}  - shot: s0\n${TP}  - shot: {name: s1, pose: false}\n  - cmd: tp @s ~ ~ ~ 90 0\n  - shot: s2\n  - cmd: tp @s 1 -60 1\n  - shot: s3\n  - cmd:\n      command: tp @s 2 -60 2 0 0\n      as: server\n  - shot: s4\n`);
    hooks.onShot = (st) => { st.player.yaw += 10; }; // 截图时动一下：不核对的截图照样过
    const res = await runAll(c.steps, ctx);
    const at = [2, 4, 6, 8, 10];
    assert.deepEqual(at.map((i) => res[i].pose), [
      { checked: false, note: '没核对：进世界以后卡片里还没有 tp 过' },
      { checked: false, note: '没核对：卡片里写了 pose: false' },
      { checked: false, note: '没核对：最近一次 tp（第 6 步）用了相对坐标（~ 或 ^）' },
      { checked: false, note: '没核对：最近一次 tp（第 8 步）没写朝向' },
      { checked: false, note: '没核对：最近一次 tp（第 10 步）是 as server 执行的' },
    ]);
    for (const i of at) assert.equal(typeof res[i].player?.yaw, 'number', `第 ${i + 1} 步也要记下 player`);
    assert.equal(shots(mock), 5);
  } finally {
    await done();
  }
});

test('离开世界再进：前面的 tp 不算；执行失败的 tp 也不算', async () => {
  const { ctx, done } = await mockCtx();
  try {
    const c = card(`${OPEN}${TP}  - leave\n  - wait:\n      inWorld: false\n      screen: TitleScreen\n      timeout: 10\n${OPEN.slice('steps:\n'.length)}  - shot: a\n${TP}  - cmd:\n      command: tp @s ^1 ^ ^ 0 0\n      success: false\n  - shot: b\n`);
    const res = await runAll(c.steps, ctx);
    assert.deepEqual(res[7].pose, { checked: false, note: '没核对：进世界以后卡片里还没有 tp 过' });
    assert.equal(res[7].player.x, 0.5, '新世界里还站在出生点');
    assert.deepEqual([res[10].pose.checked, res[10].pose.source], [true, '第 9 步的 tp'], '失败的 tp（第 10 步）不算');
  } finally {
    await done();
  }
});
