// run-cards.mjs 启动模式的测试：用假游戏（test/fake-game.mjs）代替 gradlew runClient，
// 走的是同一套 cmd.exe 启动、/quit、taskkill 的代码。不碰 mod/run/，不用 Gradle。
// 运行：node --test mod/tools/test/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startMockProbe, makeTempDir } from './mock-probe.mjs';
import { isAlive, killPid } from '../lib/proc.mjs';
import { RUN_CARDS, FAKE_GAME, writeCard, startNode, runNode, readRun, removeDir, show, closedPort, PASS_CARD, LONG_CARD } from './helpers.mjs';

const tmp = makeTempDir('launch-');
test.after(() => removeDir(tmp));

let n = 0;
function caseDir() {
  const d = path.join(tmp, `case${++n}`);
  fs.mkdirSync(d, { recursive: true });
  return {
    dir: d,
    probeFile: path.join(d, 'xjyprobe.json'),
    out: path.join(d, 'out'),
    card: writeCard(d, 'ok.yml', PASS_CARD),
  };
}

const fakeEnv = (mode) => ({ XJY_TEST_FAKE_GAME: FAKE_GAME, XJY_FAKE_MODE: mode, XJY_FAKE_LIFETIME_MS: '40000' });
const launchArgs = (c, { timeoutStart = 15, timeoutQuit = 3, card = c.card } = {}) => [
  '--probe-file',
  c.probeFile,
  '--out',
  c.out,
  '--timeout-start',
  String(timeoutStart),
  '--timeout-quit',
  String(timeoutQuit),
  card,
];

/** 假游戏的 pid（它自己写在 xjyprobe.json 旁边）。 */
function fakeGamePid(c) {
  try {
    return Number(fs.readFileSync(`${c.probeFile}.game-pid`, 'utf8').trim()) || null;
  } catch {
    return null;
  }
}

/** 测试结束时把可能剩下的假游戏收掉（只结束这个测试自己的假进程）。 */
async function cleanup(c) {
  const pid = fakeGamePid(c);
  if (pid && isAlive(pid)) await killPid(pid, { tree: true });
}

test('正常：启动 → 跑卡片 → /quit → 游戏和 gradlew 都退出，退出码 0', async () => {
  const c = caseDir();
  try {
    const r = await runNode(RUN_CARDS, launchArgs(c), { env: fakeEnv('normal') });
    assert.equal(r.code, 0, show(r));
    const { runDir, results } = readRun(c.out);
    assert.equal(results.mode, 'launch');
    assert.equal(results.game.trusted, true, '游戏 pid 是这次启动之后才有的，应该可信');
    assert.equal(results.game.pid, fakeGamePid(c));
    assert.equal(results.shutdown.quitSent, true);
    assert.equal(results.shutdown.forced, false);
    assert.equal(results.shutdown.exited, true);
    assert.deepEqual(results.shutdown.leftover, []);
    const log = fs.readFileSync(path.join(runDir, 'gradle.log'), 'utf8');
    assert.match(log, /> Task :runClient/);
    assert.match(log, /BUILD SUCCESSFUL/);
    assert.match(log, /# gradlew 退出了，退出码 0/);
    assert.equal(isAlive(results.game.pid), false);
    assert.equal(isAlive(results.startup.childPid), false);
    assert.equal(fs.existsSync(c.probeFile), false);
  } finally {
    await cleanup(c);
  }
});

test('游戏不理 /quit：等 --timeout-quit 秒后按 pid 结束游戏（游戏不在我们的进程树里也能结束）', async () => {
  const c = caseDir();
  try {
    const r = await runNode(RUN_CARDS, launchArgs(c), { env: fakeEnv('hang-on-quit') });
    assert.equal(r.code, 0, `卡片都过了，强制结束也算 0${show(r)}`);
    const { results } = readRun(c.out);
    assert.equal(results.shutdown.quitSent, true);
    assert.equal(results.shutdown.forced, true);
    assert.ok(results.shutdown.killed.some((k) => k.what === 'game' && k.pid === results.game.pid && k.ok), JSON.stringify(results.shutdown));
    assert.equal(results.shutdown.exited, true);
    assert.match(r.stdout, /游戏没有自己退出，结束游戏进程/);
    assert.equal(isAlive(results.game.pid), false);
  } finally {
    await cleanup(c);
  }
});

test('gradlew 一开始就失败：退出码 2，fatal = start_failed，打印 gradle.log 末尾', async () => {
  const c = caseDir();
  try {
    const r = await runNode(RUN_CARDS, launchArgs(c), { env: fakeEnv('die-early') });
    assert.equal(r.code, 2, show(r));
    assert.equal(readRun(c.out).results.fatal.error, 'start_failed');
    assert.match(r.stdout + r.stderr, /FAILURE/);
  } finally {
    await cleanup(c);
  }
});

test('等不到 xjyprobe.json：超时退出码 2，fatal = start_timeout，结束自己启动的进程树', async () => {
  const c = caseDir();
  try {
    const r = await runNode(RUN_CARDS, launchArgs(c, { timeoutStart: 3 }), { env: fakeEnv('no-probe') });
    assert.equal(r.code, 2, show(r));
    const { results } = readRun(c.out);
    assert.equal(results.fatal.error, 'start_timeout');
    assert.ok(results.shutdown.killed.some((k) => k.what === 'gradlew'), JSON.stringify(results.shutdown));
    assert.equal(isAlive(results.startup.childPid), false);
  } finally {
    await cleanup(c);
  }
});

test('停在加载报错界面：退出码 2，fatal = load_error，先 /quit，游戏退出', async () => {
  const c = caseDir();
  try {
    const r = await runNode(RUN_CARDS, launchArgs(c), { env: fakeEnv('load-error') });
    assert.equal(r.code, 2, show(r));
    const { results } = readRun(c.out);
    assert.equal(results.fatal.error, 'load_error');
    assert.match(results.fatal.hint ?? '', /showLoadWarnings/);
    assert.equal(results.shutdown.quitSent, true);
    assert.equal(results.shutdown.exited, true);
    assert.equal(isAlive(results.game.pid), false);
  } finally {
    await cleanup(c);
  }
});

test('游戏退了但 gradlew 不退：结束自己启动的进程树，退出码 0', async () => {
  const c = caseDir();
  try {
    const r = await runNode(RUN_CARDS, launchArgs(c), { env: fakeEnv('client-hang') });
    assert.equal(r.code, 0, show(r));
    const { results } = readRun(c.out);
    assert.equal(results.shutdown.forced, true);
    assert.ok(results.shutdown.killed.some((k) => k.what === 'gradlew' && k.ok), JSON.stringify(results.shutdown));
    assert.equal(results.shutdown.exited, true);
    assert.equal(isAlive(results.startup.childPid), false);
  } finally {
    await cleanup(c);
  }
});

test('Ctrl+C（IPC 模拟）：退出码 2，发 /quit，游戏和 gradlew 都退出', async () => {
  const c = caseDir();
  const card = writeCard(c.dir, 'long.yml', LONG_CARD);
  try {
    const p = startNode(RUN_CARDS, launchArgs(c, { card }), { env: fakeEnv('normal'), ipc: true });
    await p.waitFor(/ 2\. .*ms/);
    p.child.send({ type: 'interrupt' });
    const r = await p.done;
    assert.equal(r.code, 2, show(r));
    const { results } = readRun(c.out);
    assert.equal(results.interrupted, true);
    assert.equal(results.shutdown.quitSent, true);
    assert.equal(results.shutdown.exited, true);
    assert.equal(isAlive(results.game.pid), false);
    assert.equal(isAlive(results.startup.childPid), false);
  } finally {
    await cleanup(c);
  }
});

test('已经有游戏开着（xjyprobe.json 能连上）：不启动第二个，退出码 2，也不去关那个游戏', async () => {
  const c = caseDir();
  const mock = await startMockProbe({ dir: c.dir, probeFile: c.probeFile });
  try {
    const r = await runNode(RUN_CARDS, launchArgs(c), { env: fakeEnv('normal') });
    assert.equal(r.code, 2, show(r));
    assert.equal(readRun(c.out).results.fatal.error, 'game_running');
    assert.equal(fakeGamePid(c), null, '不应该启动假游戏');
    assert.equal(mock.state.quitCount, 0, '不能关别人开的游戏');
    assert.equal(fs.existsSync(c.probeFile), true, '不能删正在用的 xjyprobe.json');
  } finally {
    await mock.close();
    await cleanup(c);
  }
});

test('旧的 xjyprobe.json（游戏已经不在了）：删掉它，正常启动', async () => {
  const c = caseDir();
  fs.writeFileSync(c.probeFile, JSON.stringify({ v: 1, port: await closedPort(), token: 'old', pid: 4, startedAt: 'x' }));
  try {
    const r = await runNode(RUN_CARDS, launchArgs(c), { env: fakeEnv('normal') });
    assert.equal(r.code, 0, show(r));
    assert.match(r.stdout, /删掉了旧的/);
  } finally {
    await cleanup(c);
  }
});
