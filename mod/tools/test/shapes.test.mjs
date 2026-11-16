// /shapes（task-17，docs/PROBE.md 接口 10）：ProbeClient.shapes()、probe.mjs shapes、lib/shapes.mjs 分块读、
// 卡片步骤 expect_shapes（读卡片、对着 mock 跑：通过 / 失败列差别 / 全是空气 / 分块 / 截断 / 旧探针 / 区块没加载）。
// mock 怎么算见 mock-shapes.mjs（栅栏、玻璃板、灯笼、门）。运行：node --test mod/tools/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCard, runStep, describeStep, CardError, StepFailed } from '../lib/cards.mjs';
import { readShapes } from '../lib/shapes.mjs';
import { loadModelFile } from '../lib/box.mjs';
import { ProbeClient, ProbeError } from '../probe-client.mjs';
import { startMockProbe, makeTempDir, REPO_DIR } from './mock-probe.mjs';
import { xjyCommands } from './mock-xjy.mjs';
import { PROBE_CLI, runNode, writeCard, removeDir, show } from './helpers.mjs';

const tmp = makeTempDir('shapes-');
test.after(() => removeDir(tmp));
let n = 0;
const steps = (text) => loadCard(writeCard(tmp, `shapes-${++n}.yml`, text)).steps;
const cardError = (text, line, re) => assert.throws(() => steps(text), (e) => e instanceof CardError && e.line === line && re.test(e.reason), text);

// 开一个带 setblock / fill 的 mock 世界（mock 不会自己建目录，先建好）；run(text) 按顺序跑卡片里的步骤
async function world(opts = {}) {
  const dir = path.join(tmp, `game${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const mock = await startMockProbe({ dir, commands: xjyCommands(), ...opts });
  const client = new ProbeClient({ port: mock.port, token: mock.token });
  const ctx = { client, shotsDir: path.join(dir, 'shots'), runId: '20261106-113000', gameDir: dir, snapshots: new Map() };
  const run = async (text) => {
    const out = [];
    for (const s of steps(text)) out.push(await runStep(s, ctx));
    return out;
  };
  await run('steps:\n  - open: shapes\n  - wait: {inWorld: true, screen: null, timeout: 10}\n');
  return { mock, client, ctx, run, close: () => mock.close() };
}
const shapesCalls = (mock) => mock.requests.filter((q) => q.path === '/shapes');
const FENCE = (e, w) => `minecraft:oak_fence[east=${e},north=false,south=false,waterlogged=false,west=${w}]`;

test('ProbeClient.shapes / probe.mjs shapes：发 POST /shapes {from, to, dim?}；参数写错退出码 2、不发请求', async () => {
  const { mock, client, run, close } = await world();
  try {
    await run('steps:\n  - cmd: fill 0 -60 0 2 -60 0 minecraft:oak_fence\n'); // 三根栅栏，没连上（setblock / fill 不更新邻居）
    const r = await client.shapes([0, -60, 0], [2, -60, 0]);
    assert.deepEqual([r.ok, r.checked, r.changed, r.truncated, r.origin, r.size], [true, 3, 3, false, [0, -60, 0], [3, 1, 1]]);
    assert.deepEqual(r.diffs[0], { pos: [0, -60, 0], state: FENCE(false, false), game: FENCE(true, false) });
    assert.deepEqual(r.diffs[1].game, FENCE(true, true));
    const c = await runNode(PROBE_CLI, ['shapes', '2', '-60', '0', '0', '-60', '0', '--dim', 'minecraft:overworld', '--probe-file', mock.probeFile]);
    assert.equal(c.code, 0, show(c));
    assert.equal(JSON.parse(c.stdout).changed, 3);
    assert.deepEqual(shapesCalls(mock).map((q) => [q.method, q.body]), [
      ['POST', { from: [0, -60, 0], to: [2, -60, 0] }],
      ['POST', { from: [2, -60, 0], to: [0, -60, 0], dim: 'minecraft:overworld' }],
    ]);
    for (const [args, re] of [[['shapes', '0', '-60', '0'], /shapes 的参数个数不对/], [['shapes', '0', '-60', '0', '2', 'a', '0'], /坐标 要是整数：a/]]) {
      const b = await runNode(PROBE_CLI, [...args, '--probe-file', mock.probeFile]);
      assert.equal(b.code, 2, show(b));
      assert.match(b.stderr, re);
    }
    assert.equal(shapesCalls(mock).length, 2);
  } finally {
    await close();
  }
});

test('expect_shapes 读卡片：from/to 或 file + at（区域按文件大小算）；写错是卡片错误', () => {
  const [a, b] = steps('steps:\n  - expect_shapes: {from: [3, -60, 0], to: [0, -58, 2], dim: "minecraft:overworld"}\n  - expect_shapes: {file: fixtures/share/js/p0-blocks.png, at: [6, -60, 5]}\n');
  assert.deepEqual(a.params, { from: [3, -60, 0], to: [0, -58, 2], dim: 'minecraft:overworld' });
  assert.equal(describeStep(a), 'expect_shapes [3,-60,0]..[0,-58,2]');
  assert.deepEqual([b.params.file, b.params.at], [path.join(REPO_DIR, 'fixtures/share/js/p0-blocks.png'), [6, -60, 5]]);
  assert.equal(describeStep(b), 'expect_shapes fixtures/share/js/p0-blocks.png at [6,-60,5]');
  const E = 'steps:\n  - expect_shapes:\n';
  cardError(`${E}      from: [0, -60, 0]\n      file: fixtures/share/js/p0-blocks.png\n`, 2, /两种写法选一种/);
  cardError(`${E}      at: [0, -60, 0]\n`, 2, /写了 at，还要写 file/);
  cardError(`${E}      file: fixtures/share/js/p0-blocks.png\n`, 3, /at 要写成 \[x, y, z\]（三个整数）：undefined/);
  cardError(`${E}      file: mod/tools/probe.mjs\n      at: [0, -60, 0]\n`, 3, /file 要是 \.json（dump）、\.png 或 \.schem/);
  cardError(`${E}      from: [0, -60, 0]\n      to: [200, 140, 200]\n`, 4, /区域太大：\d+ 格/);
  cardError(`${E}      from: [0, -60, 0]\n      to: [1, -60, 1]\n      size: [2, 1, 2]\n`, 5, /expect_shapes 没有参数「size」/);
  cardError('steps:\n  - expect_shapes: yes\n', 2, /expect_shapes 要写 from、to/);
  cardError(`${E}      from: [0, -60]\n      to: [1, -60, 1]\n`, 3, /from 要写成 \[x, y, z\]/);
});

test('expect_shapes 对着 mock 跑：摆对了就过；摆错了失败，按下标顺序列出 现在 / 游戏算的', async () => {
  const { mock, ctx, run, close } = await world();
  try {
    // 摆对的一排（z=0）：栅栏连石头、立着的灯笼（下面石头）、玻璃板连石头、吊着的灯笼（上面石头）、门两半（下面草方块）
    await run(`steps:
  - cmd: "setblock 0 -60 0 minecraft:oak_fence[east=true]"
  - cmd: "setblock 1 -60 0 minecraft:oak_fence[east=true,west=true]"
  - cmd: setblock 2 -60 0 minecraft:stone
  - cmd: setblock 2 -59 0 minecraft:lantern
  - cmd: "setblock 3 -60 0 minecraft:glass_pane[east=false,north=false,south=false,waterlogged=false,west=true]"
  - cmd: setblock 6 -58 0 minecraft:stone
  - cmd: "setblock 6 -59 0 minecraft:lantern[hanging=true]"
  - cmd: setblock 8 -60 0 minecraft:oak_door
  - cmd: "setblock 8 -59 0 minecraft:oak_door[half=upper]"
`);
    const [ok] = await run('steps:\n  - expect_shapes: {from: [8, -58, 0], to: [0, -60, 0]}\n');
    assert.deepEqual([ok.origin, ok.size, ok.checked, ok.changed, ok.truncated, ok.diffs, ok.calls], [[0, -60, 0], [9, 3, 1], 9, 0, false, [], 1]);
    assert.deepEqual(shapesCalls(mock).at(-1).body, { from: [0, -60, 0], to: [8, -58, 0] });
    // 摆错的一排（z=5）：栅栏没连石头、吊着的灯笼上面是空的、门只有下半、玻璃板没连石头
    await run(`steps:
  - cmd: setblock 0 -60 5 minecraft:stone
  - cmd: setblock 1 -60 5 minecraft:oak_fence
  - cmd: "setblock 3 -59 5 minecraft:lantern[hanging=true]"
  - cmd: setblock 5 -60 5 minecraft:oak_door
  - cmd: setblock 7 -60 5 minecraft:stone
  - cmd: "setblock 8 -60 5 minecraft:glass_pane[east=false,north=false,south=false,waterlogged=false,west=false]"
`);
    const fence = 'minecraft:oak_fence[east=false,north=false,south=false,waterlogged=false,west=false]';
    const door = 'minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]';
    const pane = (w) => `minecraft:glass_pane[east=false,north=false,south=false,waterlogged=false,west=${w}]`;
    const want = `[0, -60, 5] 起 9×2×1：查了 6 格，有 4 格不是游戏按邻居算出来的样子（玩家在旁边一动就会变）：`
      + `[1, -60, 5] 现在 ${fence}，游戏算的 ${fence.replace('west=false', 'west=true')}；`
      + `[5, -60, 5] 现在 ${door}，游戏算的 minecraft:air；`
      + `[8, -60, 5] 现在 ${pane(false)}，游戏算的 ${pane(true)}；`
      + `[3, -59, 5] 现在 minecraft:lantern[hanging=true,waterlogged=false]，游戏算的 minecraft:air`;
    const [s] = steps('steps:\n  - expect_shapes: {from: [0, -60, 5], to: [8, -59, 5]}\n');
    await assert.rejects(runStep(s, ctx), (e) => {
      assert.ok(e instanceof StepFailed, String(e?.stack || e));
      assert.equal(e.message, want);
      assert.deepEqual(e.expected, { changed: 0 });
      assert.deepEqual([e.actual.checked, e.actual.changed, e.actual.truncated, e.actual.first.length], [6, 4, false, 4]);
      assert.deepEqual(e.result.diffs.map((d) => d.pos), [[1, -60, 5], [5, -60, 5], [8, -60, 5], [3, -59, 5]]);
      return true;
    });
  } finally {
    await close();
  }
});

test('expect_shapes：全是空气算失败；超过 64 格分块查、差别按整块下标排；超过 256 条截断', async () => {
  const { mock, ctx, run, close } = await world();
  try {
    const empty = steps('steps:\n  - expect_shapes: {from: [20, -59, 20], to: [22, -58, 22]}\n')[0];
    await assert.rejects(runStep(empty, ctx), (e) => e instanceof StepFailed && e.message === '[20, -59, 20] 起 3×2×3 全是空气，没有方块可查（坐标写错了？）');
    await run('steps:\n  - cmd: fill 0 -60 0 69 -60 0 minecraft:oak_fence\n  - cmd: fill 0 -60 10 19 -60 29 minecraft:oak_fence\n');
    const before = shapesCalls(mock).length;
    const r = await readShapes(ctx.client, [69, -60, 0], [0, -60, 0]);
    assert.deepEqual([r.origin, r.size, r.checked, r.changed, r.truncated, r.calls], [[0, -60, 0], [70, 1, 1], 70, 70, false, 2]);
    assert.deepEqual(r.diffs.map((d) => d.pos[0]), Array.from({ length: 70 }, (_, i) => i));
    assert.deepEqual([r.diffs[63].game, r.diffs[69].game], [FENCE(true, true), FENCE(false, true)]); // 分块边上照样看块外的邻居
    assert.deepEqual(shapesCalls(mock).slice(before).map((q) => q.body), [{ from: [0, -60, 0], to: [63, -60, 0] }, { from: [64, -60, 0], to: [69, -60, 0] }]);
    const big = steps('steps:\n  - expect_shapes: {from: [0, -60, 10], to: [19, -60, 29]}\n')[0];
    await assert.rejects(runStep(big, ctx), (e) => {
      assert.ok(e instanceof StepFailed, String(e?.stack || e));
      assert.match(e.message, /^\[0, -60, 10\] 起 20×1×20：查了 400 格，有 400 格.*；……还有 390 处$/);
      assert.deepEqual([e.actual.changed, e.actual.truncated, e.actual.first.length, e.result.diffs.length], [400, true, 10, 256]);
      return true;
    });
  } finally {
    await close();
  }
});

test('expect_shapes：文件写法按文件大小算区域；旧探针没有 /shapes → shapes_unsupported；区块没加载 → 探针错误', async () => {
  const file = path.join(REPO_DIR, 'fixtures/share/js/p0-blocks.png');
  const { size } = await loadModelFile(file);
  const { ctx, close } = await world();
  try {
    const [s] = steps('steps:\n  - expect_shapes: {file: fixtures/share/js/p0-blocks.png, at: [6, -61, 5]}\n');
    const r = await runStep(s, ctx);
    assert.deepEqual([r.origin, r.size, r.changed], [[6, -61, 5], size, 0]);
    assert.ok(r.checked > 0, '草方块那一层要算进去');
    assert.match(r.file, /p0-blocks\.png$/);
    const edge = steps('steps:\n  - expect_shapes: {from: [995, -61, 0], to: [1000, -61, 0]}\n')[0];
    await assert.rejects(runStep(edge, ctx), (e) => e instanceof ProbeError && e.code === 'chunk_not_loaded' && e.httpStatus === 409);
    const inside = steps('steps:\n  - expect_shapes: {from: [990, -61, 0], to: [999, -61, 0]}\n')[0];
    assert.equal((await runStep(inside, ctx)).checked, 10);
  } finally {
    await close();
  }
  const old = await world({ noShapes: true });
  try {
    const [s] = steps('steps:\n  - expect_shapes: {from: [0, -61, 0], to: [1, -61, 1]}\n');
    await assert.rejects(runStep(s, old.ctx), (e) => e instanceof StepFailed && e.code === 'shapes_unsupported' && /这个探针太旧，没有 \/shapes/.test(e.message));
  } finally {
    await old.close();
  }
});
