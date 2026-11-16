// run-cards.mjs --attach 的测试：连 mock 探针，不启动游戏。运行：node --test mod/tools/test/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startMockProbe, makeTempDir } from './mock-probe.mjs';
import { xjyCommands } from './mock-xjy.mjs';
import { isAlive } from '../lib/proc.mjs';
import { listDefaultCards } from '../lib/cards.mjs';
import { RUN_CARDS, writeCard, startNode, runNode, readRun, removeDir, show, closedPort, PASS_CARD, LONG_CARD } from './helpers.mjs';

const tmp = makeTempDir('attach-');
test.after(() => removeDir(tmp));

let n = 0;
/** 每个测试一个目录：mock 的文件、卡片、--out 都放在里面。 */
function caseDir() {
  const d = path.join(tmp, `case${++n}`);
  fs.mkdirSync(path.join(d, 'mock'), { recursive: true });
  return d;
}

async function attachRun(d, mockOpts, cards, extra = []) {
  const mock = await startMockProbe({ dir: path.join(d, 'mock'), dummyGame: true, ...mockOpts });
  const out = path.join(d, 'out');
  const r = await runNode(RUN_CARDS, ['--attach', '--probe-file', mock.probeFile, '--out', out, '--timeout-quit', '10', ...extra, ...cards]);
  return { mock, out, r };
}

test('全过：退出码 0，发了 /quit，没带 Origin，results.json 齐全', async () => {
  const d = caseDir();
  const card = writeCard(d, 'ok.yml', PASS_CARD);
  const { mock, out, r } = await attachRun(d, {}, [card]);
  try {
    assert.equal(r.code, 0, show(r));
    assert.match(r.stdout, /PASS ok/);
    assert.equal(mock.state.quitCount, 1, '应该发一次 /quit');
    assert.equal(mock.requests.filter((q) => q.origin !== undefined).length, 0, '不能带 Origin');
    const { runDir, results } = readRun(out);
    assert.equal(results.mode, 'attach');
    assert.equal(results.exitCode, 0);
    assert.deepEqual([results.summary.total, results.summary.pass, results.summary.fail], [1, 1, 0]);
    const c = results.cards[0];
    assert.equal(c.status, 'pass');
    assert.equal(c.title, '测试用');
    assert.equal(c.steps.length, 7);
    for (const s of c.steps) {
      assert.equal(s.status, 'pass');
      assert.ok(Number.isInteger(s.ms), `第 ${s.index} 步没有耗时`);
    }
    const shot = c.steps[4].result;
    assert.ok(fs.existsSync(shot.copy), `截图没复制到运行目录：${shot.copy}`);
    assert.equal(path.dirname(shot.copy), path.join(runDir, 'shots'));
    assert.equal(results.shutdown.quitSent, true);
    assert.equal(results.shutdown.exited, true);
    assert.deepEqual(results.shutdown.killed, [], '--attach 不能结束任何进程');
    assert.equal(isAlive(mock.gamePid), false, '/quit 之后游戏（假进程）应该退出了');
  } finally {
    await mock.close();
  }
});

test('--keep：不发 /quit，游戏保持开着', async () => {
  const d = caseDir();
  const card = writeCard(d, 'ok.yml', PASS_CARD);
  const { mock, out, r } = await attachRun(d, {}, [card], ['--keep']);
  try {
    assert.equal(r.code, 0, show(r));
    assert.equal(mock.state.quitCount, 0);
    assert.equal(mock.closed, false);
    assert.equal(isAlive(mock.gamePid), true);
    assert.equal(readRun(out).results.shutdown.kept, true);
  } finally {
    await mock.close();
  }
});

test('某一步失败：退出码 1，打印失败的那一步，results.json 里有期望值和实际值，照样 /quit', async () => {
  const d = caseDir();
  const card = writeCard(
    d,
    'bad.yml',
    `steps:
  - open
  - wait:
      inWorld: true
      screen: null
      timeout: 10
  - cmd: setblock 3 -60 3 minecraft:oak_log[axis=x]
  - expect_block:
      pos: [3, -60, 3]
      state: minecraft:oak_log[axis=z]
  - leave
`,
  );
  const { mock, out, r } = await attachRun(d, {}, [card]);
  try {
    assert.equal(r.code, 1, show(r));
    assert.match(r.stdout, /FAIL bad\s+第 4 步「[^」]*」（[^）]*bad\.yml:8）：方块状态不一样：期望 minecraft:oak_log\[axis=z\]，实际 minecraft:oak_log\[axis=x\]/);
    const { results } = readRun(out);
    assert.equal(results.exitCode, 1);
    const c = results.cards[0];
    assert.equal(c.status, 'fail');
    assert.deepEqual([c.failedStep.index, c.failedStep.line, c.failedStep.type, c.failedStep.error], [4, 8, 'expect_block', 'check_failed']);
    const s = c.steps[3];
    assert.equal(s.expected.state, 'minecraft:oak_log[axis=z]');
    assert.equal(s.actual.state, 'minecraft:oak_log[axis=x]');
    assert.equal(c.steps.length, 4, '失败之后不再跑后面的步骤');
    assert.equal(mock.state.quitCount, 1);
  } finally {
    await mock.close();
  }
});

test('两张卡片：第一张在世界里失败，第二张照样从主菜单开始并通过', async () => {
  const d = caseDir();
  const a = writeCard(d, 'a.yml', 'steps:\n  - open\n  - wait:\n      inWorld: true\n      screen: null\n  - cmd: notacommand\n');
  const b = writeCard(d, 'b.yml', PASS_CARD);
  const { mock, out, r } = await attachRun(d, {}, [a, b]);
  try {
    assert.equal(r.code, 1, show(r));
    assert.match(r.stdout, /FAIL a /);
    assert.match(r.stdout, /PASS b/);
    const { results } = readRun(out);
    assert.deepEqual(results.cards.map((c) => [c.id, c.status]), [
      ['a', 'fail'],
      ['b', 'pass'],
    ]);
    assert.deepEqual([results.summary.pass, results.summary.fail], [1, 1]);
    assert.ok(mock.requests.some((q) => q.path === '/world/leave'), '第一张卡片失败后要先离开世界');
  } finally {
    await mock.close();
  }
});

test('wait 等不到：这一步失败（退出码 1），results.json 里写着等的条件和最后的状态', async () => {
  const d = caseDir();
  const card = writeCard(d, 'w.yml', 'steps:\n  - wait:\n      inWorld: true\n      timeout: 0.5\n');
  const { mock, out, r } = await attachRun(d, {}, [card]);
  try {
    assert.equal(r.code, 1, show(r));
    const s = readRun(out).results.cards[0].steps[0];
    assert.equal(s.status, 'fail');
    assert.deepEqual(s.expected, { inWorld: true });
    assert.equal(s.actual.inWorld, false);
  } finally {
    await mock.close();
  }
});

test('请求超时：这一步失败，错误码 request_timeout', async () => {
  const d = caseDir();
  const card = writeCard(d, 't.yml', 'steps:\n  - open\n  - wait:\n      inWorld: true\n      screen: null\n  - cmd:\n      command: say slow\n      timeout: 0.5\n');
  const { mock, out, r } = await attachRun(d, { hang: { '/command': 3000 } }, [card]);
  try {
    assert.equal(r.code, 1, show(r));
    const c = readRun(out).results.cards[0];
    assert.equal(c.failedStep.error, 'request_timeout');
    assert.equal(c.failedStep.index, 3);
  } finally {
    await mock.close();
  }
});

test('游戏在卡片中间崩了：退出码 2，fatal = game_exited', async () => {
  const d = caseDir();
  const card = writeCard(d, 'crash.yml', PASS_CARD);
  const { mock, out, r } = await attachRun(d, { crashOn: '/screenshot' }, [card]);
  try {
    assert.equal(r.code, 2, show(r));
    const { results } = readRun(out);
    assert.equal(results.fatal.error, 'game_exited');
    assert.equal(results.cards[0].failedStep.type, 'shot');
  } finally {
    await mock.close();
  }
});

test('token 不对（401）：退出码 2，fatal = unauthorized，不跑卡片', async () => {
  const d = caseDir();
  const card = writeCard(d, 'ok.yml', PASS_CARD);
  const { mock, out, r } = await attachRun(d, { fileToken: 'not-the-token' }, [card]);
  try {
    assert.equal(r.code, 2, show(r));
    const { results } = readRun(out);
    assert.equal(results.fatal.error, 'unauthorized');
    assert.equal(results.summary.pass, 0);
    assert.equal(mock.requests.filter((q) => q.path === '/world/open').length, 0);
  } finally {
    await mock.close();
  }
});

test('探针拒绝（403，比如带了 Origin）：退出码 2，fatal = forbidden', async () => {
  const d = caseDir();
  const card = writeCard(d, 'ok.yml', PASS_CARD);
  const { mock, out, r } = await attachRun(d, { forbidAll: true }, [card]);
  try {
    assert.equal(r.code, 2, show(r));
    assert.equal(readRun(out).results.fatal.error, 'forbidden');
  } finally {
    await mock.close();
  }
});

test('没有 xjyprobe.json、或者端口上没人：退出码 2', async () => {
  const d = caseDir();
  const card = writeCard(d, 'ok.yml', PASS_CARD);
  const r1 = await runNode(RUN_CARDS, ['--attach', '--probe-file', path.join(d, 'none.json'), '--out', path.join(d, 'out1'), card]);
  assert.equal(r1.code, 2, show(r1));
  const stale = path.join(d, 'stale.json');
  fs.writeFileSync(stale, JSON.stringify({ v: 1, port: await closedPort(), token: 'ab', pid: process.pid, startedAt: 'x' }));
  const r2 = await runNode(RUN_CARDS, ['--attach', '--probe-file', stale, '--out', path.join(d, 'out2'), card]);
  assert.equal(r2.code, 2, show(r2));
  assert.equal(readRun(path.join(d, 'out2')).results.fatal.error, 'connect_failed');
});

test('卡片写错了：退出码 2，报出文件和行号，不建运行目录', async () => {
  const d = caseDir();
  const card = writeCard(d, 'typo.yml', 'steps:\n  - open\n  - jump: 3\n');
  const out = path.join(d, 'out');
  const r = await runNode(RUN_CARDS, ['--attach', '--probe-file', path.join(d, 'none.json'), '--out', out, card]);
  assert.equal(r.code, 2, show(r));
  assert.match(r.stdout + r.stderr, /typo\.yml:3: 第 2 步：不认识的步骤「jump」/);
  assert.equal(fs.existsSync(out), false);
});

test('Ctrl+C（测试里用 IPC 模拟）：马上停下，退出码 2，照样 /quit', async () => {
  const d = caseDir();
  const card = writeCard(d, 'long.yml', LONG_CARD);
  const mock = await startMockProbe({ dir: path.join(d, 'mock'), dummyGame: true });
  try {
    const out = path.join(d, 'out');
    const p = startNode(RUN_CARDS, ['--attach', '--probe-file', mock.probeFile, '--out', out, card], { ipc: true });
    await p.waitFor(/ 2\. .*ms/);
    const t0 = Date.now();
    p.child.send({ type: 'interrupt' });
    const r = await p.done;
    assert.equal(r.code, 2, show(r));
    assert.ok(Date.now() - t0 < 10000, '打断之后要很快结束');
    const { results } = readRun(out);
    assert.equal(results.interrupted, true);
    assert.equal(results.cards[0].status, 'interrupted');
    assert.equal(results.cards[0].steps[2].status, 'interrupted');
    assert.equal(mock.state.quitCount, 1);
  } finally {
    await mock.close();
  }
});

test('默认跑 mod/cards/ 下的全部卡片（全都读得进来；P0、P2 的卡片对着 mock 加假 /xjy 都能通过）', async () => {
  const d = caseDir();
  const { mock, out, r } = await attachRun(d, { commands: xjyCommands() }, []);
  try {
    // P3 的卡片（gamerule、旁观模式……）mock 不认识，可能失败；但不能是卡片写错（退出码 2）
    assert.ok(r.code === 0 || r.code === 1, show(r));
    const { results } = readRun(out);
    assert.equal(results.fatal ?? null, null, show(r));
    const ids = listDefaultCards().map((f) => path.basename(f).replace(/\.ya?ml$/i, ''));
    assert.deepEqual(results.cards.map((c) => path.basename(c.file).replace(/\.ya?ml$/i, '')), ids);
    assert.ok(ids.includes('P0-001') && ids.some((id) => id.startsWith('P2-')), ids.join(', '));
    for (const c of results.cards) {
      if (/^P[02]-/.test(c.id)) assert.equal(c.status, 'pass', `${c.id}：${c.failedStep?.message ?? ''}\n${show(r)}`);
    }
  } finally {
    await mock.close();
  }
});
