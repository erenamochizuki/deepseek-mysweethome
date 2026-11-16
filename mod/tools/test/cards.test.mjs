// 卡片格式检查（loadCard）和每一步的执行（runStep，对着 mock 探针）。运行：node --test mod/tools/test/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCard, listDefaultCards, runStep, CardError, StepFailed, CARDS_DIR, STEP_TYPES } from '../lib/cards.mjs';
import { ProbeClient, ProbeError } from '../probe-client.mjs';
import { startMockProbe, makeTempDir } from './mock-probe.mjs';
import { writeCard, removeDir } from './helpers.mjs';

const tmp = makeTempDir('cards-');
test.after(() => removeDir(tmp));

let n = 0;
const card = (text) => writeCard(tmp, `c${++n}.yml`, text);

function cardErrorAt(text, line, re) {
  const file = card(text);
  assert.throws(
    () => loadCard(file),
    (e) => {
      assert.ok(e instanceof CardError, `应该是 CardError，实际是 ${e?.name}: ${e?.message}`);
      assert.equal(e.line, line, `行号不对：${e.message}`);
      assert.ok(e.message.includes(path.basename(file)), `错误信息里要有文件名：${e.message}`);
      if (re) assert.match(e.message, re);
      return true;
    },
  );
}

test('P0-001 卡片能读、格式对', () => {
  const files = listDefaultCards();
  assert.ok(files.includes(path.join(CARDS_DIR, 'P0-001.yml')), `默认卡片里没有 P0-001：${files.join(', ')}`);
  const c = loadCard(path.join(CARDS_DIR, 'P0-001.yml'));
  assert.equal(c.id, 'P0-001');
  assert.equal(c.title, '放方块、读回来、截图');
  assert.deepEqual(
    c.steps.map((s) => s.type),
    ['open', 'wait', 'cmd', 'cmd', 'cmd', 'cmd', 'cmd', 'cmd', 'cmd', 'cmd', 'expect_block', 'expect_block', 'expect_block', 'expect_block', 'expect_region', 'cmd', 'sleep', 'wait', 'shot', 'leave', 'wait'],
  );
  for (const s of c.steps) assert.ok(Number.isInteger(s.line) && s.line > 0, `第 ${s.index + 1} 步没有行号`);
  for (const t of ['open', 'leave', 'wait', 'cmd', 'expect_block', 'expect_region', 'shot', 'sleep']) assert.ok(STEP_TYPES.includes(t), t);
});

test('简写：「- leave」「- open: 名字」「- cmd: 命令」「- sleep: 秒」；id 默认是文件名', () => {
  const c = loadCard(card('steps:\n  - open: my-world\n  - leave\n  - cmd: say hi\n  - sleep: 0.5\n'));
  assert.equal(c.id, `c${n}`);
  assert.deepEqual(
    c.steps.map((s) => [s.type, s.index, s.line]),
    [
      ['open', 0, 2],
      ['leave', 1, 3],
      ['cmd', 2, 4],
      ['sleep', 3, 5],
    ],
  );
});

test('卡片写错了：CardError 带文件名和行号', () => {
  cardErrorAt('id: x\nstep:\n  - leave\n', 2, /不认识的键「step」/);
  cardErrorAt('id: x\ntitle: t\n', 1, /steps 要是一个不空的列表/);
  cardErrorAt('steps: []\n', 1, /steps 要是一个不空的列表/);
  cardErrorAt('id: a b\nsteps:\n  - leave\n', 1, /id 只能用/);
  cardErrorAt('steps:\n  - leave\n  - jump: 3\n', 3, /第 2 步：不认识的步骤「jump」/);
  cardErrorAt('steps:\n  - leave\n  - wait:\n    inWorld: true\n', 3, /第 2 步：一步只能有一个键/);
  cardErrorAt('steps:\n  - [1, 2]\n', 2, /每一步要写成/);
  cardErrorAt('steps:\n  - leave\n  - cmd: *x\n', 3);
});

test('步骤参数写错了：CardError 指到那一行', () => {
  cardErrorAt('steps:\n  - expect_block:\n      pos: [1, -60, 3]\n      state: minecraft:oak_stairs[half=top,facing=east]\n', 4, /字母顺序.*facing, half/);
  cardErrorAt('steps:\n  - expect_block:\n      pos: [1, -60, 3]\n      state: oak_log\n', 4);
  cardErrorAt('steps:\n  - expect_block:\n      pos: [1, -60]\n      state: minecraft:stone\n', 3);
  cardErrorAt('steps:\n  - wait:\n      inworld: true\n', 3, /inworld/);
  cardErrorAt('steps:\n  - wait:\n      timeout: 5\n', 2);
  cardErrorAt('steps:\n  - sleep: 0\n', 2);
  cardErrorAt('steps:\n  - cmd:\n      command: say hi\n      as: admin\n', 4);
  cardErrorAt('steps:\n  - shot:\n      meanBrightness: [0.5]\n', 3);
  cardErrorAt('steps:\n  - expect_region:\n      from: [0, -61, 0]\n      to: [2, -59, 2]\n      size: [3, 3, 2]\n', 5, /size/);
});

test('卡片文件不存在', () => {
  assert.throws(
    () => loadCard(path.join(tmp, 'nope.yml')),
    (e) => e instanceof CardError && /文件不存在/.test(e.message) && e.message.includes('nope.yml'),
  );
});

// ---- 对着 mock 跑每一步 ----

const PASS_CARD = `id: cards-pass
steps:
  - open
  - wait:
      inWorld: true
      screen: null
      timeout: 10
  - cmd: setblock 3 -60 3 minecraft:oak_log[axis=x]
  - cmd: setblock 7 -60 3 minecraft:chest[facing=north]
  - expect_block:
      pos: [3, -60, 3]
      state: minecraft:oak_log[axis=x]
  - expect_block:
      pos: [7, -60, 3]
      state: minecraft:chest[facing=north,type=single,waterlogged=false]
      blockEntityContains: 'id:"minecraft:chest"'
  - expect_region:
      from: [2, -61, 2]
      to: [4, -59, 4]
      size: [3, 3, 3]
      palette:
        - minecraft:grass_block[snowy=false]
        - minecraft:air
        - minecraft:oak_log[axis=x]
      at:
        - pos: [3, -60, 3]
          state: minecraft:oak_log[axis=x]
        - pos: [3, -59, 3]
          state: minecraft:air
  - cmd:
      command: notacommand foo
      success: false
      outputContains: Unknown or incomplete command
  - cmd:
      command: kill @e[type=minecraft:item]
      success: any
  - shot:
      meanBrightness: [0.05, 0.95]
      distinctColors: 50
  - sleep: 0.1
`;

const FAIL_CARD = `id: cards-fail
steps:
  - expect_block:
      pos: [3, -60, 3]
      state: minecraft:oak_log[axis=z]
  - expect_block:
      pos: [7, -60, 3]
      state: minecraft:chest[facing=north,type=single,waterlogged=false]
      blockEntityContains: CustomName
  - expect_block:
      pos: [3, -60, 3]
      state: minecraft:oak_log[axis=x]
      blockEntityContains: anything
  - expect_region:
      from: [2, -61, 2]
      to: [4, -59, 4]
      palette:
        - minecraft:stone
  - expect_region:
      from: [2, -61, 2]
      to: [4, -59, 4]
      at:
        - pos: [3, -59, 3]
          state: minecraft:stone
  - cmd: notacommand foo
  - cmd:
      command: say hi
      success: false
  - cmd:
      command: say hi
      outputContains: 不会出现的字
  - shot:
      distinctColors: 6000
  - shot:
      meanBrightness: [0.5, 0.9]
  - wait:
      screen: TitleScreen
      timeout: 0.5
`;

const END_CARD = `id: cards-end
steps:
  - leave
  - wait:
      inWorld: false
      screen: TitleScreen
      timeout: 10
  - sleep: 5
`;

test('runStep：对着 mock 跑通过的步骤和失败的步骤', async () => {
  const mockDir = path.join(tmp, 'mock');
  fs.mkdirSync(mockDir, { recursive: true });
  const mock = await startMockProbe({ dir: mockDir });
  const shotsDir = path.join(tmp, 'shots');
  const client = new ProbeClient({ port: mock.port, token: mock.token });
  const ctx = { client, shotsDir };
  try {
    const pass = loadCard(writeCard(tmp, 'cards-pass.yml', PASS_CARD));
    const results = [];
    for (const step of pass.steps) results.push(await runStep(step, ctx));
    assert.equal(results[0].name, 'cards-pass');
    const shot = results[9];
    assert.ok(path.basename(shot.path).startsWith('cards-pass-'), shot.path);
    assert.ok(fs.existsSync(shot.copy) && path.dirname(shot.copy) === shotsDir, `截图要复制到 ${shotsDir}：${shot.copy}`);

    const fail = loadCard(writeCard(tmp, 'cards-fail.yml', FAIL_CARD));
    const failures = [];
    for (const step of fail.steps) {
      await assert.rejects(runStep(step, ctx), (e) => {
        assert.ok(e instanceof StepFailed, `第 ${step.index + 1} 步应该是 StepFailed，实际是 ${e?.name}: ${e?.message}`);
        failures.push(e);
        return true;
      });
    }
    assert.match(failures[0].message, /方块状态不一样：期望 minecraft:oak_log\[axis=z\]，实际 minecraft:oak_log\[axis=x\]/);
    assert.equal(failures[0].expected.state, 'minecraft:oak_log[axis=z]');
    assert.equal(failures[0].actual.state, 'minecraft:oak_log[axis=x]');
    assert.match(failures[1].message, /方块实体里没有「CustomName」/);
    assert.match(failures[2].message, /这里没有方块实体/);
    assert.match(failures[3].message, /palette 里没有：minecraft:stone/);
    assert.match(failures[4].message, /\[3, -59, 3\] 期望 minecraft:stone，实际 minecraft:air/);
    assert.equal(failures[10].actual.screen, null);

    const end = loadCard(writeCard(tmp, 'cards-end.yml', END_CARD));
    await runStep(end.steps[0], ctx);
    await runStep(end.steps[1], ctx);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const t0 = Date.now();
    await assert.rejects(runStep(end.steps[2], { ...ctx, signal: ac.signal }), (e) => e instanceof ProbeError && e.code === 'aborted');
    assert.ok(Date.now() - t0 < 2000, 'sleep 被打断后应该马上结束');
  } finally {
    await mock.close();
  }
});
