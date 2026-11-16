// P3 用的卡片改动：shot 步骤的 hideGui（截不带界面的纯世界画面，像按 F1）。
// 测：卡片参数检查、原样发进 /screenshot 的请求体、probe.mjs shot --hide-gui、mock 对非布尔值回 400。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCard, runStep, describeStep, CardError } from '../lib/cards.mjs';
import { ProbeClient, ProbeError } from '../probe-client.mjs';
import { startMockProbe, makeTempDir } from './mock-probe.mjs';
import { RUN_CARDS, PROBE_CLI, writeCard, runNode, removeDir, show } from './helpers.mjs';

const tmp = makeTempDir('p3steps-');
test.after(() => removeDir(tmp));
let n = 0;
const card = (text) => loadCard(writeCard(tmp, `p3-${++n}.yml`, text));

// 起一个 mock，配好 runStep 要的 ctx；用完调 done()
async function mockCtx() {
  const dir = path.join(tmp, `game${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const mock = await startMockProbe({ dir });
  const ctx = { client: new ProbeClient({ port: mock.port, token: mock.token }), shotsDir: path.join(dir, 'shots'), runId: '20261106-071500', gameDir: dir, snapshots: new Map() };
  return { mock, ctx, done: () => mock.close() };
}

test('shot 不写 hideGui：请求里没有这个键，和以前一样', async () => {
  const { mock, ctx, done } = await mockCtx();
  try {
    const [step] = card('steps:\n  - shot: plain\n').steps;
    assert.equal(step.params.hideGui, undefined);
    assert.doesNotMatch(describeStep(step), /hideGui/);
    const r = await runStep(step, ctx);
    assert.deepEqual(mock.state.lastShot, { name: 'plain' });
    assert.equal(r.hideGui, undefined);
    assert.ok(fs.existsSync(r.copy), '截图副本拷进了 shots/');
    // probe.mjs shot 不加 --hide-gui 也不发
    const c = await runNode(PROBE_CLI, ['shot', 'cli-plain', '--probe-file', mock.probeFile]);
    assert.equal(c.code, 0, show(c));
    assert.deepEqual(mock.state.lastShot, { name: 'cli-plain' });
  } finally {
    await done();
  }
});

test('shot 写了 hideGui：原样放进 /screenshot 的请求体（true、false 都照发）；probe.mjs shot --hide-gui', async () => {
  const { mock, ctx, done } = await mockCtx();
  try {
    const steps = card('steps:\n  - shot: {name: world, hideGui: true}\n  - shot:\n      name: gui\n      hideGui: false\n').steps;
    assert.equal(steps[0].params.hideGui, true);
    assert.match(describeStep(steps[0]), /hideGui=true/);
    const r = await runStep(steps[0], ctx);
    assert.deepEqual(mock.state.lastShot, { name: 'world', hideGui: true });
    assert.equal(r.hideGui, true);
    await runStep(steps[1], ctx);
    assert.deepEqual(mock.state.lastShot, { name: 'gui', hideGui: false });
    const c = await runNode(PROBE_CLI, ['shot', 'cli-world', '--hide-gui', '--probe-file', mock.probeFile]);
    assert.equal(c.code, 0, show(c));
    assert.equal(JSON.parse(c.stdout).ok, true);
    assert.deepEqual(mock.state.lastShot, { name: 'cli-world', hideGui: true });
  } finally {
    await done();
  }
});

test('hideGui 写成别的类型：卡片错误（带文件名和行号，开游戏前就停）；mock 回 400 bad_request', async () => {
  for (const [v, shown] of [["'true'", '"true"'], ['1', '1'], ['yes', '"yes"'], ['null', 'null']]) {
    assert.throws(
      () => card(`steps:\n  - shot:\n      name: bad\n      hideGui: ${v}\n`),
      (e) => e instanceof CardError && e.line === 4 && e.reason.includes('hideGui 要写 true 或 false') && e.reason.includes(shown),
      `hideGui: ${v}`,
    );
  }
  // run-cards：和别的参数写错一样，退出码 2，报出文件和行号，不建运行目录
  const bad = writeCard(tmp, 'hide-bad.yml', 'steps:\n  - shot: {name: bad, hideGui: "yes"}\n');
  const out = path.join(tmp, 'hide-bad-out');
  const r = await runNode(RUN_CARDS, ['--attach', '--probe-file', path.join(tmp, 'none.json'), '--out', out, bad]);
  assert.equal(r.code, 2, show(r));
  assert.match(r.stdout + r.stderr, /hide-bad\.yml:2: 第 1 步：hideGui 要写 true 或 false/);
  assert.equal(fs.existsSync(out), false);
  // 绕过卡片直接发错的类型：mock 按约定回 400 bad_request，也不截图
  const { mock, ctx, done } = await mockCtx();
  try {
    for (const v of ['true', 1, null]) {
      await assert.rejects(ctx.client.screenshot({ name: 'bad', hideGui: v }), (e) => e instanceof ProbeError && e.code === 'bad_request' && e.httpStatus === 400, String(v));
    }
    assert.equal(mock.state.lastShot, null);
  } finally {
    await done();
  }
});
