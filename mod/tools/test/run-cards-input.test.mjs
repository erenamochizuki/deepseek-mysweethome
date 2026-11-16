// run-cards.mjs 锁键盘鼠标（task-14，docs/PROBE.md 接口 9）：--attach 先锁再跑，--keep 时恢复原样；旧探针没有 /input 只提醒；
// 自己开的游戏启动时就锁着；整次运行里截图时被动过 → 这一步 pose_changed；现有卡片的截图都核对得了。
// 运行：node --test mod/tools/test/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startMockProbe, makeTempDir } from './mock-probe.mjs';
import { isAlive, killPid } from '../lib/proc.mjs';
import { loadCard, listDefaultCards } from '../lib/cards.mjs';
import { tpPose } from '../lib/pose.mjs';
import { RUN_CARDS, FAKE_GAME, writeCard, runNode, readRun, removeDir, show, PASS_CARD } from './helpers.mjs';

const tmp = makeTempDir('input-');
test.after(() => removeDir(tmp));
let n = 0;
function caseDir() {
  const d = path.join(tmp, `case${++n}`);
  fs.mkdirSync(path.join(d, 'mock'), { recursive: true });
  return d;
}
async function attachRun(d, mockOpts, extra = [], text = PASS_CARD) {
  const mock = await startMockProbe({ dir: path.join(d, 'mock'), dummyGame: true, ...mockOpts });
  const out = path.join(d, 'out');
  const r = await runNode(RUN_CARDS, ['--attach', '--probe-file', mock.probeFile, '--out', out, '--timeout-quit', '10', ...extra, writeCard(d, 'card.yml', text)]);
  return { mock, out, r, results: fs.existsSync(out) ? readRun(out).results : null };
}
const inputCalls = (mock) => mock.requests.filter((q) => q.path === '/input').map((q) => q.body?.locked);
const firstAt = (mock, p) => mock.requests.findIndex((q) => q.path === p);

test('--attach：跑卡片前先锁键盘鼠标（在开世界之前），跑完照常 /quit', async () => {
  const { mock, r, results } = await attachRun(caseDir(), {});
  try {
    assert.equal(r.code, 0, show(r));
    assert.deepEqual(inputCalls(mock), [true]);
    assert.ok(firstAt(mock, '/input') < firstAt(mock, '/world/open'), '先锁再开世界');
    assert.match(r.stdout, /键盘鼠标：已锁住（原来没锁）/);
    assert.deepEqual(results.input, { before: false, locked: true, by: 'runner', supported: true, error: null, restored: null });
    assert.equal(mock.state.quitCount, 1);
  } finally {
    await mock.close();
  }
});

test('--attach --keep：最后恢复成原来的样子（原来没锁就解开，原来锁着就不动）', async () => {
  for (const before of [false, true]) {
    const { mock, r, results } = await attachRun(caseDir(), { inputLocked: before }, ['--keep']);
    try {
      assert.equal(r.code, 0, show(r));
      assert.deepEqual(inputCalls(mock), before ? [true] : [true, false], `原来 ${before}`);
      assert.equal(mock.state.inputLocked, before, '和原来一样');
      assert.deepEqual([results.input.before, results.input.restored, results.shutdown.kept], [before, before ? null : true, true]);
      if (!before) assert.match(r.stdout, /键盘鼠标：恢复成原来的（没锁）/);
    } finally {
      await mock.close();
    }
  }
});

test('旧探针没有 /input（404 not_found）或锁的时候出别的错：提醒一句，照样跑完，退出码 0', async () => {
  const cases = [
    [{ oldProbe: true }, /提醒：这个探针太旧，没有 \/input，锁不住键盘鼠标/, 'not_found', false],
    [{ fail: { '/input': { status: 500, error: 'internal', message: '炸了' } } }, /提醒：锁键盘鼠标没成功（炸了），照样跑/, 'internal', true],
  ];
  for (const [opts, re, code, supported] of cases) {
    const { mock, r, results } = await attachRun(caseDir(), opts, ['--keep']);
    try {
      assert.equal(r.code, 0, show(r));
      assert.match(r.stdout, re);
      assert.deepEqual([results.input.locked, results.input.by, results.input.error?.error], [false, null, code]);
      assert.equal(results.input.supported, supported ? null : false);
      if (opts.oldProbe) assert.equal(results.input.before, null, '旧探针的 /status 里没有 inputLocked');
      assert.equal(results.cards[0].status, 'pass');
      assert.equal(mock.requests.filter((q) => q.path === '/input').length, 1, '只试一次，--keep 时也不去恢复');
    } finally {
      await mock.close();
    }
  }
});

test('自己开游戏：带 -Pxjyprobe.lockInput=true，一启动就锁着，不再发 /input；--keep 时提示怎么解锁', async () => {
  const d = caseDir();
  const probeFile = path.join(d, 'xjyprobe.json');
  const out = path.join(d, 'out');
  const env = { XJY_TEST_FAKE_GAME: FAKE_GAME, XJY_FAKE_MODE: 'normal', XJY_FAKE_LIFETIME_MS: '40000' };
  try {
    const r = await runNode(RUN_CARDS, ['--probe-file', probeFile, '--out', out, '--timeout-start', '15', '--timeout-quit', '3', '--keep', writeCard(d, 'card.yml', PASS_CARD)], { env });
    assert.equal(r.code, 0, show(r));
    assert.match(r.stdout, /键盘鼠标：游戏启动时就锁住了/);
    assert.match(r.stdout, /键盘鼠标还锁着；要自己在游戏里操作，先运行 node mod\/tools\/probe\.mjs input unlock/);
    const { results } = readRun(out);
    assert.match(results.startup.command, / -Pxjyprobe\.lockInput=true$/);
    assert.deepEqual([results.input.before, results.input.locked, results.input.by, results.input.restored], [true, true, 'launch', null]);
  } finally {
    let pid = null;
    try {
      pid = Number(fs.readFileSync(`${probeFile}.game-pid`, 'utf8').trim()) || null;
    } catch {
      // 假游戏没起来
    }
    if (pid && isAlive(pid)) await killPid(pid, { tree: true }); // 只结束这个测试自己的假游戏
  }
});

test('整次运行：截图时被人动了 → 这一步 pose_changed，退出码 1，results.json 里有期望、实际和图', async () => {
  const text = 'steps:\n  - open\n  - wait:\n      inWorld: true\n      screen: null\n      timeout: 10\n  - cmd: tp @s 3 -60 -2 145 17\n  - shot: moved\n';
  const onShot = (st) => Object.assign(st.player, { yaw: 129.4, pitch: 90 });
  const { mock, r, results } = await attachRun(caseDir(), { onShot }, [], text);
  try {
    assert.equal(r.code, 1, show(r));
    assert.match(r.stdout, /pose_changed：截图时玩家的位置或朝向变了（可能有人动了键盘鼠标，或者卡片 tp 之后又移动了玩家）/);
    const s = results.cards[0].steps[3];
    assert.deepEqual([s.status, s.error], ['fail', 'pose_changed']);
    assert.deepEqual(s.expected, { pose: { x: 3.5, y: -60, z: -1.5, yaw: 145, pitch: 17 } });
    assert.deepEqual([s.actual.pose.yaw, s.actual.pose.pitch], [129.4, 90]);
    assert.ok(fs.existsSync(s.result.copy), '截图时被动的：图留着给人看');
    assert.equal(mock.state.quitCount, 1);
  } finally {
    await mock.close();
  }
});

test('现有卡片（P0–P3）的每张截图都核对得了：前面最近的 tp 都是 tp @s 绝对坐标 + 朝向', () => {
  let cards = 0;
  for (const f of listDefaultCards()) {
    const c = loadCard(f);
    if (!/^P[0-3]-/.test(c.id)) continue;
    cards++;
    let last = null;
    for (const s of c.steps) {
      if (s.type === 'open' || s.type === 'leave') last = null;
      else if (s.type === 'cmd') last = tpPose(s.params.command, s.params.as) ?? last;
      else if (s.type === 'shot' && s.params.pose === undefined) {
        assert.ok(last?.pose, `${c.id} 第 ${s.index + 1} 步（第 ${s.line} 行）的截图核对不了：${last?.reason ?? '前面没有 tp'}`);
      }
    }
  }
  assert.ok(cards >= 3, `只找到 ${cards} 张 P0–P3 卡片`);
});
