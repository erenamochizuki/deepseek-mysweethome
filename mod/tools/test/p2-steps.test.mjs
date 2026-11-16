// P2 加的卡片功能：${run}、cmd until、snapshot / expect_same、expect_file、copy_file，以及 mock 的 /xjy。
// 运行：node --test mod/tools/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCard, runStep, bindStep, describeStep, CardError, StepFailed, SAMPLE_RUN } from '../lib/cards.mjs';
import { readBox, boxFromDump, compareBoxes } from '../lib/box.mjs';
import { ProbeClient } from '../probe-client.mjs';
import { startMockProbe, makeTempDir, REPO_DIR } from './mock-probe.mjs';
import { xjyCommands, rotateProps, rotatePos, facingOf, share } from './mock-xjy.mjs';
import { writeCard, removeDir } from './helpers.mjs';

const tmp = makeTempDir('p2steps-');
test.after(() => removeDir(tmp));
let n = 0;
const RUN = '20261106-053000';
const steps = (text) => loadCard(writeCard(tmp, `p2-${++n}.yml`, text)).steps;
const cardError = (text, line, re) => assert.throws(() => steps(text), (e) => e instanceof CardError && e.line === line && re.test(e.reason), text);
const failsWith = (p, re) => assert.rejects(p, (e) => {
  assert.ok(e instanceof StepFailed, String(e?.stack || e));
  assert.match(e.message, re);
  return true;
});

// 开一个带 /xjy 的 mock 世界；run(text) 按顺序执行卡片里的步骤，返回每步结果
async function world() {
  const dir = path.join(tmp, `game${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const mock = await startMockProbe({ dir, commands: xjyCommands({ pendingMs: 300 }) });
  const ctx = { client: new ProbeClient({ port: mock.port, token: mock.token }), shotsDir: path.join(dir, 'shots'), runId: RUN, gameDir: dir, snapshots: new Map() };
  const run = async (text) => {
    const out = [];
    for (const s of steps(text)) out.push(await runStep(s, ctx));
    return out;
  };
  await run('steps:\n  - open: p2\n  - wait: {inWorld: true, screen: null, timeout: 10}\n');
  return { mock, ctx, dir, run };
}

test('${run}：读卡片时用样例编号检查格式，运行时换成真的编号', () => {
  const s = steps('steps:\n  - cmd: xjy capture 8 4 6 P2-${run}-A\n  - cmd: "say ${run} ${run}"\n  - copy_file: {from: fixtures/share/js/p0-blocks.png, to: "p0-${run}.png"}\n');
  assert.equal(s[0].params.command, `xjy capture 8 4 6 P2-${SAMPLE_RUN}-A`);
  assert.equal(bindStep(s[0], RUN).params.command, `xjy capture 8 4 6 P2-${RUN}-A`);
  assert.equal(describeStep(bindStep(s[1], 'R1')), 'cmd say R1 R1');
  assert.equal(bindStep(s[2], RUN).params.to, `p0-${RUN}.png`);
  assert.equal(s[0].params.command.includes('${'), false);
  assert.throws(() => runStep(s[0], {}), /运行编号/);
  cardError('steps:\n  - leave\n  - cmd: say ${foo}\n', 3, /不认识的变量「\$\{foo\}」/);
  cardError('steps:\n  - cmd: say ${run\n', 2, /不认识的变量/);
  cardError('steps:\n  - copy_file: {from: "fixtures/${run}.png"}\n', 2, /from 不存在/);
});

test('cmd until：反复执行到 result 等于期望值；等不到、命令失败都是这一步失败', async () => {
  const { mock, run, ctx } = await world();
  try {
    const r = await run(`steps:
  - cmd: tp @s 0.5 -60 0.5 180 0
  - cmd: xjy capture 2 0 2 cap
  - cmd: {command: xjy place cap, outputContains: Placing}
  - cmd: {command: xjy status, until: 0}
  - cmd: {command: xjy status, until: {result: 0, timeout: 5, interval: 0.05}}
`);
    assert.equal(r[2].result, 4);
    assert.ok(r[3].tries >= 2 && r[3].waitedMs >= 150, JSON.stringify(r[3]));
    assert.equal(r[4].tries, 1);
    const s = steps('steps:\n  - cmd: xjy place cap\n  - cmd: {command: xjy status, until: {result: 0, timeout: 0.1, interval: 0.05}}\n  - cmd: {command: xjy nope, until: 0}\n');
    await runStep(s[0], ctx);
    await failsWith(runStep(s[1], ctx), /等了 0\.1 秒（执行了 \d+ 次），result 一直不是 0，最后一次是 4/);
    await failsWith(runStep(s[2], ctx), /命令执行失败了，期望成功/);
    cardError('steps:\n  - cmd: {command: xjy status, until: abc}\n', 2, /until 写成/);
    cardError('steps:\n  - cmd: {command: xjy status, until: 0, success: any}\n', 2, /必须期望成功/);
    assert.match(describeStep(steps('steps:\n  - cmd: {command: xjy status, until: 0}\n')[0]), /\(until result=0\)$/);
  } finally {
    await mock.close();
  }
});

test('snapshot / expect_same：状态、方块实体（不管 x y z）都要一样，可以换个地方比', async () => {
  const { mock, run, ctx } = await world();
  try {
    const chest = (x, count) => `'setblock ${x} -60 2 minecraft:chest[facing=north,type=single,waterlogged=false]{Items:[{Slot:0b,id:"minecraft:apple",count:${count}}]}'`;
    await run(`steps:\n  - cmd: ${chest(2, 3)}\n  - cmd: ${chest(12, 3)}\n  - cmd: setblock 1 -59 1 minecraft:oak_log[axis=x]\n  - cmd: setblock 11 -59 1 minecraft:oak_log[axis=x]\n`);
    const s = steps(`steps:
  - snapshot: {name: A, from: [3, -59, 3], to: [1, -61, 1]}
  - expect_same: A
  - expect_same: {snapshot: A, at: [11, -61, 1]}
  - cmd: ${chest(12, 2)}
  - expect_same: {snapshot: A, at: [11, -61, 1]}
  - cmd: setblock 13 -60 3 minecraft:stone
  - expect_same: {snapshot: A, at: [11, -61, 1]}
`);
    const r0 = await runStep(s[0], ctx);
    assert.deepEqual(r0, { origin: [1, -61, 1], size: [3, 3, 3], blockEntities: 1 });
    assert.deepEqual(await runStep(s[1], ctx), { origin: [1, -61, 1], size: [3, 3, 3], cells: 27, blockEntities: 1 });
    assert.deepEqual((await runStep(s[2], ctx)).origin, [11, -61, 1]);
    await runStep(s[3], ctx);
    await failsWith(runStep(s[4], ctx), /和 A（\[1,-61,1\] 起）比，有 1 处不一样：\[12, -60, 2\] 方块实体 minecraft:chest 的数据不一样：\.Items\[0\]\.count：期望 \{"int":3\}，实际 \{"int":2\}/);
    await runStep(s[5], ctx);
    await failsWith(runStep(s[6], ctx), /有 2 处不一样：\[13, -60, 3\] 期望 minecraft:air，实际 minecraft:stone/);
    cardError('steps:\n  - expect_same: B\n', 2, /前面没有叫「B」的 snapshot 步骤/);
    cardError('steps:\n  - snapshot: {name: Z, from: [0, -64, 0], to: [1000, 319, 1000]}\n', 2, /区域太大/);
  } finally {
    await mock.close();
  }
});

test('copy_file / expect_file：复制鲸图进游戏目录，放下去以后逐格和 dump、PNG 比', async () => {
  const { mock, run, ctx, dir } = await world();
  try {
    const r = await run(`steps:
  - copy_file: {from: fixtures/share/js/p0-blocks.png, to: "p0-\${run}.png"}
  - cmd: tp @s 7.5 -60 3.5 -90 0
  - cmd: {command: "xjy place p0-\${run}", outputContains: rotation 0}
  - cmd: {command: xjy status, until: 0}
  - expect_file: {file: fixtures/share/cases/p0-blocks.json, at: [6, -60, 5], size: [3, 2, 1], offset: [-1, 0, 2]}
  - expect_file: {file: fixtures/share/js/p0-blocks.png, at: [6, -60, 5]}
`);
    const dest = path.join(dir, 'xiaojingyu', `p0-${RUN}.png`);
    assert.deepEqual(r[0], { path: dest, bytes: fs.statSync(path.join(REPO_DIR, 'fixtures/share/js/p0-blocks.png')).size });
    const { file, ...same } = r[4];
    assert.match(file, /p0-blocks\.json$/);
    assert.deepEqual(same, { origin: [6, -60, 5], size: [3, 2, 1], cells: 6, blockEntities: 1 });
    assert.equal(r[5].cells, 6);
    const s = steps(`steps:
  - expect_file: {file: fixtures/share/cases/p0-blocks.json, at: [6, -60, 5], size: [1, 2, 3]}
  - expect_file: {file: fixtures/share/cases/p0-blocks.json, at: [6, -60, 5], offset: [0, 0, 0]}
  - expect_file: {file: fixtures/share/cases/p0-blocks.json, at: [6, -60, 15]}
  - expect_file: {saved: nope, at: [0, -60, 0]}
  - copy_file: {from: fixtures/share/js/p0-blocks.png, to: "p0-\${run}.png"}
  - copy_file: {from: fixtures/share/odd/no-data.png, to: "bad-\${run}.png"}
  - expect_file: {saved: "bad-\${run}", at: [0, -60, 0]}
  - cmd: {command: "xjy place bad-\${run}", success: false}
`);
    await failsWith(runStep(s[0], ctx), /p0-blocks\.json 的大小是 3×2×1，期望 1×2×3/);
    await failsWith(runStep(s[1], ctx), /p0-blocks\.json 的 offset 是 \[-1, ?0, ?2\]，期望 \[0, ?0, ?0\]/);
    await failsWith(runStep(s[2], ctx), /有 6 处不一样：\[6, -60, 15\] 期望 minecraft:grass_block\[snowy=false\]，实际 minecraft:air.*期望有方块实体 minecraft:chest，实际没有/);
    await failsWith(runStep(s[3], ctx), /文件不存在：.*nope\.png/);
    await failsWith(runStep(s[4], ctx), /已经有了，不覆盖/);
    await runStep(s[5], ctx);
    await failsWith(runStep(s[6], ctx), /bad-20261106-053000\.png 读不出来：no_data：/);
    assert.equal((await runStep(s[7], ctx)).success, false);
    cardError('steps:\n  - expect_file: {file: fixtures/share/cases/p0-blocks.json, saved: x, at: [0, 0, 0]}\n', 2, /file 和 saved 要写一个/);
    cardError('steps:\n  - expect_file: {file: ../outside.json, at: [0, 0, 0]}\n', 2, /仓库里的相对路径/);
    cardError('steps:\n  - expect_file: {file: docs/PROBE.md, at: [0, 0, 0]}\n', 2, /要是 \.json（dump）、\.png 或 \.schem/);
    cardError('steps:\n  - expect_file: {saved: a/b, at: [0, 0, 0]}\n', 2, /saved 要是 xiaojingyu 文件夹里的文件名/);
    cardError('steps:\n  - copy_file: {from: fixtures/share/js/p0-blocks.png, to: x/y.png}\n', 2, /to 只能是文件名/);
    cardError('steps:\n  - copy_file: {to: x.png}\n', 2, /from 要是仓库里的相对路径/);
    const plain = steps('steps:\n  - copy_file: {from: fixtures/share/js/p0-blocks.png}\n')[0];
    assert.equal(plain.params.to, 'p0-blocks.png');
    await failsWith(runStep(plain, {}), /不知道游戏目录在哪/);
  } finally {
    await mock.close();
  }
});

test('mock 的 /xjy：朝北拍、朝东放（转 90°）、再拍、朝北放回来和原来一样；undo 把箱子和里面的东西还回来', async () => {
  const { mock, run, dir } = await world();
  try {
    const r = await run(`steps:
  - cmd: setblock 0 -60 -2 minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]
  - cmd: 'setblock 1 -60 -3 minecraft:chest[facing=south,type=single,waterlogged=false]{Items:[{Slot:1b,id:"minecraft:stick",count:5}]}'
  - cmd: setblock -1 -59 -1 minecraft:oak_log[axis=x]
  - cmd: tp @s 0.5 -60 0.5 180 0
  - cmd: xjy capture 3 1 3 rot-A
  - snapshot: {name: A, from: [-1, -61, -3], to: [1, -59, -1]}
  - cmd: tp @s 20.5 -60 0.5 -90 0
  - cmd: {command: xjy place rot-A, outputContains: rotation 90}
  - cmd: {command: xjy status, until: 0}
  - expect_block: {pos: [22, -60, 0], state: "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]"}
  - expect_block: {pos: [23, -60, 1], state: "minecraft:chest[facing=west,type=single,waterlogged=false]", blockEntityContains: 'id:"minecraft:stick"'}
  - expect_block: {pos: [21, -59, -1], state: "minecraft:oak_log[axis=z]"}
  - cmd: xjy capture 3 1 3 rot-B
  - cmd: tp @s 40.5 -60 0.5 180 0
  - cmd: {command: xjy place rot-B, outputContains: rotation 270}
  - cmd: {command: xjy status, until: 0}
  - expect_same: {snapshot: A, at: [39, -61, -3]}
`);
    assert.equal(r[4].result, 12);
    assert.equal(r[7].result, 27);
    const S3 = await share();
    const d = S3.dump(await S3.read(fs.readFileSync(path.join(dir, 'xiaojingyu', 'rot-A.png'))));
    assert.deepEqual([d.size, d.offset], [[3, 3, 3], [-1, -1, -3]]);
    const x = d.meta.compound.Xiaojingyu.compound;
    assert.deepEqual([x.Facing, x.Origin], [{ string: 'north' }, { intArray: [0, -60, 0] }]);
    await run(`steps:
  - cmd: 'setblock 61 -60 -3 minecraft:chest[facing=north,type=single,waterlogged=false]{Items:[{Slot:0b,id:"minecraft:apple",count:7}]}'
  - snapshot: {name: before, from: [59, -61, -3], to: [61, -59, -1]}
  - cmd: tp @s 60.5 -60 0.5 180 0
  - cmd: {command: xjy place rot-A, outputContains: rotation 0}
  - cmd: {command: xjy status, until: 0}
  - expect_block: {pos: [61, -60, -3], state: "minecraft:chest[facing=south,type=single,waterlogged=false]", blockEntityContains: 'id:"minecraft:stick"'}
  - cmd: xjy undo
  - cmd: {command: xjy status, until: 0}
  - expect_same: before
  - cmd: {command: "execute if entity @e[type=minecraft:item,x=59,y=-61,z=-3,dx=2,dy=2,dz=2]", success: false}
  - cmd: execute if entity @s
`);
  } finally {
    await mock.close();
  }
});

test('box：dump 展开成盒子，逐格、逐个方块实体比；/region 每个方向最多 64 格，大盒子分块读', async () => {
  const dump = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'fixtures/share/cases/p0-blocks.json'), 'utf8'));
  const want = boxFromDump(dump, 'p0');
  assert.deepEqual([want.size, want.offset, want.states.length, [...want.bes.keys()]], [[3, 2, 1], [-1, 0, 2], 6, ['0,1,0']]);
  assert.equal(want.states[4], 'minecraft:lantern[hanging=false,waterlogged=false]');
  const bad = (d, re) => assert.throws(() => boxFromDump({ ...dump, ...d }, 'p0'), re);
  bad({ dump: 2 }, /p0：不是 dump/);
  bad({ size: [3, 2] }, /size 不对/);
  bad({ cells: [[5, 0]] }, /cells 一共 5 格，size 是 6 格/);
  bad({ cells: [[7, 0]] }, /格子数比 size（6 格）多/);
  bad({ cells: [[6, 9]] }, /cells 里的 \[6,9\] 不对/);
  const got = { ...boxFromDump(dump), origin: [10, -60, 0] };
  assert.deepEqual(compareBoxes(want, got), { count: 0, problems: [] });
  assert.deepEqual(compareBoxes(want, { ...got, size: [1, 2, 3] }), { count: 1, problems: ['大小不一样：期望 3×2×1，实际 1×2×3'] });
  got.states = [...got.states];
  got.states[2] = 'minecraft:stone';
  got.bes = new Map([['0,1,0', { id: 'minecraft:chest', data: { compound: {} } }], ['2,1,0', { id: 'minecraft:barrel', data: { compound: {} } }]]);
  const c = compareBoxes(want, got);
  assert.equal(c.count, 3, c.problems.join('\n'));
  assert.equal(c.problems[0], '[12, -60, 0] 期望 minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]，实际 minecraft:stone');
  assert.equal(c.problems[1], '[10, -59, 0] 方块实体 minecraft:chest 的数据不一样：.Items：实际没有这个键（期望 {"list":[]}）');
  assert.equal(c.problems[2], '[12, -59, 0] 多了方块实体 minecraft:barrel');
  const { mock, run, ctx } = await world();
  try {
    await run('steps:\n  - cmd: setblock 29 -61 1 minecraft:stone\n');
    const regions = () => mock.requests.filter((q) => q.path === '/region').length;
    const before = regions();
    const box = await readBox(ctx.client, [-35, -61, 0], [34, -61, 2]);
    assert.equal(regions() - before, 2);
    assert.deepEqual([box.origin, box.size, box.states.length], [[-35, -61, 0], [70, 1, 3], 210]);
    assert.deepEqual([box.states.indexOf('minecraft:stone'), box.states.lastIndexOf('minecraft:stone')], [134, 134]);
    assert.equal(box.states.filter((s) => s === 'minecraft:grass_block[snowy=false]').length, 209);
    await assert.rejects(readBox(ctx.client, [0, -61, 0], [2000, -61, 600]), /区域太大/);
  } finally {
    await mock.close();
  }
});

test('mock 的转向规则：和 BlockState.rotate / BlockPos.rotate 一样顺时针', () => {
  assert.deepEqual(rotateProps({ facing: 'north', half: 'top' }, 1), { facing: 'east', half: 'top' });
  assert.deepEqual(rotateProps({ facing: 'west' }, 3), { facing: 'south' });
  assert.deepEqual(rotateProps({ facing: 'up' }, 1), { facing: 'up' });
  assert.deepEqual(rotateProps({ axis: 'x' }, 1), { axis: 'z' });
  assert.deepEqual(rotateProps({ axis: 'z' }, 2), { axis: 'z' });
  assert.deepEqual(rotateProps({ axis: 'y' }, 1), { axis: 'y' });
  assert.deepEqual(rotateProps({ rotation: '14' }, 1), { rotation: '2' });
  assert.deepEqual(rotateProps({ north: 'true', east: 'false', south: 'false', west: 'low', up: 'true' }, 1), { east: 'true', south: 'false', west: 'false', north: 'low', up: 'true' });
  assert.deepEqual(rotateProps({ north: 'side' }, 2), { south: 'side' });
  assert.deepEqual(rotatePos([1, 5, -3], 1), [3, 5, 1]);
  assert.deepEqual(rotatePos([1, 5, -3], 3), [-3, 5, -1]);
  assert.deepEqual(rotatePos([1, 5, -3], 4), [1, 5, -3]);
  assert.deepEqual([0, 45, 90, 135, 180, -90, 270, -180].map(facingOf), ['south', 'west', 'west', 'north', 'north', 'east', 'east', 'north']);
});

test('cmd result：命令的 result 必须正好等于期望值', async () => {
  cardError('steps:\n  - cmd:\n      command: fill 0 -60 0 1 -60 1 minecraft:stone\n      result: 1.5\n', 4, /result 要是整数/);
  cardError('steps:\n  - cmd:\n      command: xjy status\n      result: 0\n      until: 0\n', 4, /result 和 until 不能一起用/);
  cardError('steps:\n  - cmd:\n      command: xjy status\n      result: 0\n      success: any\n', 5, /用了 result 的命令必须期望成功/);
  const { mock, run } = await world();
  try {
    await run('steps:\n  - cmd:\n      command: fill 0 -60 0 1 -60 1 minecraft:stone\n      result: 4\n');
    await failsWith(run('steps:\n  - cmd:\n      command: fill 5 -60 0 6 -60 0 minecraft:stone\n      result: 3\n'), /result 是 2，期望 3/);
  } finally {
    await mock.close();
  }
});
