// capture 上次（docs/COMMANDS.md §2b）：卡片的 expect_files 步骤（两个鲸图逐格比），mock 的 /xjy capture 上次|last
// （place 放完才记、按世界分开、undo 退回上一次、转过的转回来），以及 P4-003 卡片对着 mock 从头跑一遍（截图、等画面那几步不跑）。
// 运行：node --test mod/tools/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCard, runStep, CardError, StepFailed, CARDS_DIR } from '../lib/cards.mjs';
import { loadModelFile } from '../lib/box.mjs';
import { ProbeClient } from '../probe-client.mjs';
import { startMockProbe, makeTempDir, REPO_DIR } from './mock-probe.mjs';
import { xjyCommands } from './mock-xjy.mjs';
import { writeCard, removeDir } from './helpers.mjs';

const tmp = makeTempDir('lastplace-');
test.after(() => removeDir(tmp));
let n = 0;
const RUN = '20261107-130000';
const HOUSE_JSON = 'fixtures/house-v4/house-v4-b.json';
const steps = (text) => loadCard(writeCard(tmp, `lp-${++n}.yml`, text)).steps;
const cardError = (text, re) => assert.throws(() => steps(text), (e) => e instanceof CardError && re.test(e.reason), text);
const failsWith = (p, re) => assert.rejects(p, (e) => {
  assert.ok(e instanceof StepFailed, String(e?.stack || e));
  assert.match(e.message, re);
  return true;
});
const ok = (_w, text) => ({ success: true, result: 1, output: [`ok: ${text}`] }); // mock 没有 gamerule / gamemode

async function world(name = 'lp', { open = true } = {}) {
  const dir = path.join(tmp, `game${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const mock = await startMockProbe({ dir, commands: { ...xjyCommands({ pendingMs: 60 }), gamerule: ok, gamemode: ok } });
  const ctx = { client: new ProbeClient({ port: mock.port, token: mock.token }), shotsDir: path.join(dir, 'shots'), runId: RUN, gameDir: dir, snapshots: new Map() };
  const run = async (text) => {
    const out = [];
    for (const s of steps(text)) out.push(await runStep(s, ctx));
    return out;
  };
  if (open) await run(`steps:\n  - open: ${name}\n  - wait: {inWorld: true, screen: null, timeout: 10}\n`);
  return { mock, ctx, dir, run };
}

test('expect_files：参数写错了，开游戏前就报', () => {
  cardError('steps:\n  - expect_files: {capture: a}\n', /file 和 saved 要写一个/);
  cardError(`steps:\n  - expect_files: {file: ${HOUSE_JSON}, saved: a, capture: b}\n`, /file 和 saved 要写一个/);
  cardError(`steps:\n  - expect_files: {file: ${HOUSE_JSON}}\n`, /capture 要是/);
  cardError(`steps:\n  - expect_files: {file: ${HOUSE_JSON}, capture: 'a/b'}\n`, /capture 要是/);
  cardError(`steps:\n  - expect_files: {file: ${HOUSE_JSON}, capture: a, diffs: [{pos: [1, 2], was: 'minecraft:air', now: 'minecraft:stone'}]}\n`, /pos 要是模型里的格子/);
  cardError(`steps:\n  - expect_files: {file: ${HOUSE_JSON}, capture: a, diffs: [{pos: [1, -1, 0], was: 'minecraft:air', now: 'minecraft:stone'}]}\n`, /pos 要是模型里的格子/);
  cardError(`steps:\n  - expect_files: {file: ${HOUSE_JSON}, capture: a, diffs: [{pos: [1, 1, 0], was: 'minecraft:air', now: 'minecraft:air'}]}\n`, /was 和 now 一样/);
  cardError(`steps:\n  - expect_files: {file: ${HOUSE_JSON}, capture: a, diffs: [{pos: [1, 1, 0], was: air, now: 'minecraft:stone'}]}\n`, /was 要是完整的方块状态/);
  cardError(`steps:\n  - expect_files: {file: ${HOUSE_JSON}, capture: a, diffs: [{pos: [1, 1, 0], was: 'minecraft:air', now: 'minecraft:stone'}, {pos: [1, 1, 0], was: 'minecraft:air', now: 'minecraft:dirt'}]}\n`, /写了两次/);
  cardError(`steps:\n  - expect_files: {file: ${HOUSE_JSON}, capture: a, fromPlace: {file: x.png, turn: 45}}\n`, /fromPlace 要写成/);
  cardError(`steps:\n  - expect_files: {file: ${HOUSE_JSON}, capture: a, extra: 1}\n`, /没有参数「extra」/);
  const s = steps(`steps:\n  - expect_files: {file: ${HOUSE_JSON}, capture: 'c-\${run}', fromPlace: {file: 'h.png', turn: 90}}\n`)[0];
  assert.deepEqual([s.params.capture.endsWith('c-20000101-000000-9'), s.params.diffs, s.params.fromPlace], [true, [], { file: 'h.png', turn: 90 }]);
});

test('mock：没 place 过 capture 上次 失败；place 完了才算「上次」；改了几处 expect_files 正好对上', async () => {
  const { mock, run, dir } = await world();
  try {
    await run(`steps:
  - cmd: {command: 'xjy capture 上次', success: false}
  - cmd: {command: 'xjy capture last', success: false}
  - cmd: {command: xjy status, outputContains: No building placed}
  - cmd: tp @s 0.5 -60 0.5 180 0
  - cmd: setblock 1 -60 -2 minecraft:oak_stairs[facing=east]
  - cmd: {command: xjy capture 2 1 2 orig, result: 7}
  - cmd: tp @s 7.5 -60 3.5 90 0
  - cmd: {command: 'xjy place orig', result: 12}
  - cmd: {command: 'xjy capture 上次', success: false}
  - cmd: {command: xjy status, until: 0}
  - cmd: {command: xjy status, outputContains: 'Last placed: orig.png, turned 270°'}
  - cmd: tp @s 50.5 -60 50.5 0 0
  - cmd: {command: 'xjy capture 上次 same', result: 7}
  - expect_files: {saved: orig, capture: same, fromPlace: {file: orig.png, turn: 270}}
  - cmd: setblock 6 -60 4 minecraft:stone
  - cmd: setblock 5 -60 3 minecraft:water
  - cmd: {command: 'xjy capture last 改过', result: 8}
  - expect_files:
      saved: orig
      capture: 改过
      diffs: [{pos: [0, 1, 1], was: 'minecraft:air', now: 'minecraft:stone'}]
`);
    // 原文件 3×2×2（地面一层 + 地面上一层），Facing north；站在 (7,-60,3) 朝西放，auto 转 270°：
    // 模型格子 (x,y,z) → 世界 (5+z, -61+y, 4-x)，石头 (6,-60,4) 是格子 (0,1,1)，水 (5,-60,3) 是格子 (1,1,0)
    const orig = await loadModelFile(path.join(dir, 'xiaojingyu', 'orig.png'));
    const same = await loadModelFile(path.join(dir, 'xiaojingyu', 'same.png'));
    assert.deepEqual([same.size, same.offset, same.facing], [orig.size, orig.offset, 'north']);
    assert.deepEqual(same.meta.compound.Xiaojingyu.compound.Origin, { intArray: [7, -60, 3] }, 'Origin 是 place 时的站立点');
    // 写错 diffs、漏写一处，都失败
    await failsWith(run(`steps:\n  - expect_files: {saved: orig, capture: 改过}\n`), /有 1 处不对：格子 \(0, 1, 1\) 原来是 minecraft:air，抓出来是 minecraft:stone/);
    await failsWith(run(`steps:\n  - expect_files: {saved: orig, capture: 改过, diffs: [{pos: [0, 1, 1], was: 'minecraft:air', now: 'minecraft:dirt'}]}\n`), /期望抓出来是 minecraft:dirt，实际 minecraft:stone/);
    await failsWith(run(`steps:\n  - expect_files: {saved: orig, capture: same, fromPlace: {file: orig.png, turn: 90}}\n`), /FromPlace 期望/);
    await failsWith(run(`steps:\n  - expect_files: {file: ${HOUSE_JSON}, capture: same}\n`), /大小：house-v4-b\.json 是 20×12×23，same\.png 是 3×2×2/);
  } finally {
    await mock.close();
  }
});

test('mock：undo 把那次的记录删掉，「上次」回到前一次；换个世界就没有记录', async () => {
  const { mock, run } = await world('lp-a');
  try {
    await run(`steps:
  - cmd: tp @s 0.5 -60 0.5 180 0
  - cmd: setblock 0 -60 -1 minecraft:stone
  - cmd: {command: xjy capture 1 0 2 one, result: 2}
  - cmd: setblock 0 -60 -1 minecraft:dirt
  - cmd: {command: xjy capture 1 0 2 two, result: 2}
  - cmd: tp @s 10.5 -60 0.5 180 0
  - cmd: {command: 'xjy place one', result: 2}
  - cmd: {command: xjy status, until: 0}
  - cmd: tp @s 20.5 -60 0.5 180 0
  - cmd: {command: 'xjy place two 90', result: 2}
  - cmd: {command: xjy status, until: 0}
  - cmd: {command: xjy status, outputContains: 'Last placed: two.png, turned 90°'}
  - cmd: {command: xjy undo, result: 2}
  - cmd: {command: xjy status, until: 0}
  - cmd: {command: xjy status, outputContains: 'Last placed: one.png, turned 0°'}
  - cmd: {command: 'xjy capture 上次 back', result: 2}
  - expect_files: {saved: one, capture: back, fromPlace: {file: one.png, turn: 0}}
  - cmd: {command: xjy undo, result: 2}
  - cmd: {command: xjy status, until: 0}
  - cmd: {command: 'xjy capture 上次', success: false}
  - cmd: {command: 'xjy place one', result: 2}
  - cmd: {command: xjy status, until: 0}
  - leave
  - wait: {inWorld: false, screen: TitleScreen, timeout: 10}
  - open: lp-b
  - wait: {inWorld: true, screen: null, timeout: 10}
  - cmd: {command: 'xjy capture 上次', success: false}
`);
  } finally {
    await mock.close();
  }
});

test('P4-003：卡片对着 mock 从头跑（截图、等画面、sleep 不跑）', async () => {
  const card = loadCard(path.join(CARDS_DIR, 'P4-003.yml'));
  const model = await loadModelFile(path.join(REPO_DIR, HOUSE_JSON));
  const places = card.steps.filter((s) => s.type === 'cmd' && /^xjy place P4-003-\$?/.test(s.params.command) && !/-V-/.test(s.params.command));
  assert.ok(places.length >= 4 && places.every((s) => s.params.result === model.states.length), '房子的 place 回的都是整个盒子的格数');
  const files = card.steps.filter((s) => s.type === 'expect_files');
  assert.ok(files.length >= 8, `expect_files 只有 ${files.length} 步`);
  const turns = new Set(files.map((s) => s.params.fromPlace?.turn));
  assert.deepEqual([...turns].sort((a, b) => a - b), [0, 90, 180, 270], '0、90、180、270 度都比过');

  const { mock, ctx } = await world('P4-003', { open: false });
  try {
    const skip = (s) => s.type === 'shot' || s.type === 'sleep' || (s.type === 'wait' && 'chunksRendered' in s.params.cond);
    const out = [];
    for (const s of card.steps) {
      if (skip(s)) continue;
      out.push([s, await runStep(s, ctx)]);
    }
    const byCapture = Object.fromEntries(out.filter(([s]) => s.type === 'expect_files').map(([s, r]) => [s.params.capture.replace(/-\d{8}-\d{6}(-\d+)?$/, ''), r]));
    assert.equal(byCapture['P4-003-B'].diffs, 3);
    assert.deepEqual(byCapture['P4-003-R90'].fromPlace, { file: `P4-003-${RUN}.png`, turn: 90 });
    assert.equal(byCapture['P4-003-V270'].blockEntities, 3, '床的两半和箱子的方块实体');
  } finally {
    await mock.close();
  }
});
