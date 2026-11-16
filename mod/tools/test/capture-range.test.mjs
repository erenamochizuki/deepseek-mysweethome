// 抓取范围的配置（docs/COMMANDS.md §2「范围」，mod6）：卡片的 config 步骤（改 config/ 下的 .toml，卡片结束时改回去）、
// cmd 的 until.outputContains（等 /xjy status 里出现新的数），mock 的 /xjy capture 读配置、往后、范围|range，
// 以及 P2-006 卡片对着 mock 从头跑一遍。
// 运行：node --test mod/tools/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCard, runStep, describeStep, restoreFiles, setTomlKeys, CardError, StepFailed, CARDS_DIR } from '../lib/cards.mjs';
import { ProbeClient } from '../probe-client.mjs';
import { startMockProbe, makeTempDir } from './mock-probe.mjs';
import { xjyCommands, configRange } from './mock-xjy.mjs';
import { writeCard, removeDir } from './helpers.mjs';

const tmp = makeTempDir('caprange-');
test.after(() => removeDir(tmp));
let n = 0;
const RUN = '20261107-180000';
const steps = (text) => loadCard(writeCard(tmp, `cr-${++n}.yml`, text)).steps;
const cardError = (text, re) => assert.throws(() => steps(text), (e) => e instanceof CardError && re.test(e.reason), text);
const failsWith = (p, re) => assert.rejects(p, (e) => {
  assert.ok(e instanceof StepFailed, String(e?.stack || e));
  assert.match(e.message, re);
  return true;
});

// NeoForge 写出来的样子（TomlWriter：顶层的键不缩进，注释在上面）
const NEO_TOML = `# 不写数字的 /xjy capture 往前抓几格
# Default: 16
# Range: 1 ~ 64
captureFront = 16
# 往后
# Default: 0
# Range: 0 ~ 64
captureBack = 0
captureSide = 8
captureUp = 12
`;

async function world() {
  const dir = path.join(tmp, `game${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const mock = await startMockProbe({ dir, commands: xjyCommands({ pendingMs: 60 }) });
  const ctx = { client: new ProbeClient({ port: mock.port, token: mock.token }), shotsDir: path.join(dir, 'shots'), runId: RUN, gameDir: dir, snapshots: new Map() };
  const run = async (text) => {
    const out = [];
    for (const s of steps(text)) out.push(await runStep(s, ctx));
    return out;
  };
  await run('steps:\n  - open: cr\n  - wait: {inWorld: true, screen: null, timeout: 10}\n');
  return { mock, ctx, dir, run };
}

test('setTomlKeys：只改顶层的那一行，注释和别的行不动；没有的键加在最前面；换行符照原来的', () => {
  assert.equal(setTomlKeys(NEO_TOML, { captureBack: 7 }), NEO_TOML.replace('captureBack = 0', 'captureBack = 7'));
  assert.equal(setTomlKeys(NEO_TOML, { captureBack: 0 }), NEO_TOML, '改成一样的值，文字一个字都不变');
  assert.equal(setTomlKeys('', { captureBack: 7, flag: true, name: 'a "b"' }), 'captureBack = 7\nflag = true\nname = "a \\"b\\""\n');
  assert.equal(setTomlKeys('a = 1\r\n[t]\r\n\tcaptureBack = 3\r\n', { captureBack: 7 }), 'captureBack = 7\r\na = 1\r\n[t]\r\n\tcaptureBack = 3\r\n', '[表] 里同名的键不算');
  assert.equal(setTomlKeys('  captureBack=2 # x\n', { captureBack: 5 }), '  captureBack = 5\n');
  assert.equal(setTomlKeys('captureBackX = 1\n', { captureBack: 5 }), 'captureBack = 5\ncaptureBackX = 1\n', '名字只是开头一样的键不算');
});

test('config：参数写错了，开游戏前就报', () => {
  cardError('steps:\n  - config: {}\n', /set 要写成/);
  cardError('steps:\n  - config: {set: {}}\n', /set 要写成/);
  cardError('steps:\n  - config: {set: {"a.b": 1}}\n', /键只能有字母/);
  cardError('steps:\n  - config: {set: {captureBack: [1]}}\n', /要是整数、true \/ false 或字符串/);
  cardError('steps:\n  - config: {set: {captureBack: 1.5}}\n', /要是整数/);
  cardError('steps:\n  - config: {file: ../x.toml, set: {a: 1}}\n', /file 要是 config 文件夹里的 \.toml/);
  cardError('steps:\n  - config: {file: x.json, set: {a: 1}}\n', /file 要是 config 文件夹里的 \.toml/);
  cardError('steps:\n  - config: {set: {a: 1}, extra: 2}\n', /没有参数「extra」/);
  const s = steps('steps:\n  - config: {set: {captureBack: 7, captureUp: 3}}\n')[0];
  assert.deepEqual(s.params, { file: 'xiaojingyu-common.toml', set: { captureBack: 7, captureUp: 3 } });
  assert.equal(describeStep(s), 'config xiaojingyu-common.toml captureBack=7 captureUp=3');
});

test('config：改 config/ 下的文件；restoreFiles 原样改回去（原来没有就删掉），改了几次都回到第一次之前', async () => {
  const dir = path.join(tmp, `cfg${++n}`);
  const file = path.join(dir, 'config', 'xiaojingyu-common.toml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, NEO_TOML);
  const other = path.join(dir, 'config', 'other.toml');
  const ctx = { gameDir: dir };
  const [a, b, c] = steps('steps:\n  - config: {set: {captureBack: 7}}\n  - config: {set: {captureBack: 2, captureUp: 3}}\n  - config: {file: other.toml, set: {x: 1}}\n');
  assert.deepEqual(await runStep(a, ctx), { path: file, set: { captureBack: 7 }, created: false });
  assert.match(fs.readFileSync(file, 'utf8'), /^captureBack = 7$/m);
  await runStep(b, ctx);
  assert.match(fs.readFileSync(file, 'utf8'), /^captureBack = 2$/m);
  assert.match(fs.readFileSync(file, 'utf8'), /^captureUp = 3$/m);
  assert.equal((await runStep(c, ctx)).created, true);
  assert.equal(fs.readFileSync(other, 'utf8'), 'x = 1\n');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), ['other.toml', 'xiaojingyu-common.toml'], '没有留下临时文件');
  const restored = await restoreFiles(ctx);
  assert.deepEqual(restored.sort(), [file, other].sort());
  assert.equal(fs.readFileSync(file, 'utf8'), NEO_TOML);
  assert.equal(fs.existsSync(other), false, '原来没有的文件删掉');
  assert.deepEqual(await restoreFiles(ctx), [], '第二次没有要改回去的');
  // 改成一样的值：文件没变，不用写
  await runStep(steps('steps:\n  - config: {set: {captureBack: 0}}\n')[0], ctx);
  assert.deepEqual(await restoreFiles(ctx), []);
});

test('cmd until.outputContains：等到输出里有这些字；等不到报最后一次的输出；写法检查', async () => {
  const { mock, ctx, dir, run } = await world();
  try {
    const file = path.join(dir, 'config', 'xiaojingyu-common.toml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, NEO_TOML);
    setTimeout(() => fs.writeFileSync(file, setTomlKeys(NEO_TOML, { captureBack: 7 })), 200); // 像 NeoForge 过一会儿才重读
    const [r] = await run('steps:\n  - cmd: {command: xjy status, until: {outputContains: " 16 7 8 12", timeout: 5, interval: 0.05}}\n');
    assert.ok(r.tries >= 2, JSON.stringify(r));
    assert.match(r.output.join('\n'), /range 16 7 8 12/);
    const s = steps('steps:\n  - cmd: {command: xjy status, until: {outputContains: [" 1 2 3 4", Idle], timeout: 0.2, interval: 0.05}}\n')[0];
    assert.match(describeStep(s), /\(until output has 「 1 2 3 4」「Idle」\)$/);
    await failsWith(runStep(s, ctx), /等了 0\.2 秒（执行了 \d+ 次），输出里一直没有「 1 2 3 4」，最后一次：Idle \| /);
    const both = steps('steps:\n  - cmd: {command: xjy status, until: {result: 0, outputContains: Idle}}\n')[0];
    assert.match(describeStep(both), /\(until result=0, output has 「Idle」\)$/);
    assert.equal((await runStep(both, ctx)).tries, 1);
    cardError('steps:\n  - cmd: {command: xjy status, until: {timeout: 5}}\n', /until 写成/);
    cardError('steps:\n  - cmd: {command: xjy status, until: {outputContains: []}}\n', /until\.outputContains 要是字符串/);
    cardError('steps:\n  - cmd: {command: xjy status, until: {outputContains: x, result: a}}\n', /until 写成/);
  } finally {
    await mock.close();
  }
});

test('mock /xjy capture：不写数字用配置；3 个数字往后用配置；范围|range 4 个数都用写的；status 多一行', async () => {
  const { mock, dir, run } = await world();
  try {
    assert.deepEqual(configRange(dir), [16, 0, 8, 12], '没有文件：默认值');
    const file = path.join(dir, 'config', 'xiaojingyu-common.toml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'captureFront = 0\ncaptureBack = 99\ncaptureSide = 2\n');
    assert.deepEqual(configRange(dir), [1, 64, 2, 12], '超出范围的截到界上，没写的用默认值');
    fs.writeFileSync(file, setTomlKeys(NEO_TOML, { captureFront: 3, captureBack: 7, captureSide: 2, captureUp: 3 }));
    const r = await run(`steps:
  - cmd: tp @s 0.5 -60 0.5 180 0
  - cmd: setblock 0 -60 6 minecraft:gold_block
  - cmd: {command: xjy capture, result: 51}
  - cmd: {command: 'xjy capture 3 2 3 a', result: 51}
  - cmd: {command: 'xjy capture 范围 3 0 2 3 b', result: 15}
  - cmd: {command: 'xjy capture range 3 1 2 3 7 号', result: 20}
  - cmd: {command: 'xjy capture 范围 3 7 2', success: false}
  - cmd: {command: 'xjy capture 范围 3 65 2 3', success: false}
  - expect_file: {saved: a, at: [-2, -61, -3], size: [5, 3, 10], offset: [-2, -1, -3]}
  - expect_file: {saved: '7 号', at: [-2, -61, -3], size: [5, 3, 4], offset: [-2, -1, -3]}
  - cmd: {command: xjy status, outputContains: 'the same as /xjy capture range 3 7 2 3.'}
`);
    assert.equal(r.length, 11);
  } finally {
    await mock.close();
  }
});

test('P2-006：卡片对着 mock 从头跑；跑完 restoreFiles 把配置改回跑之前的样子', async () => {
  const card = loadCard(path.join(CARDS_DIR, 'P2-006.yml'));
  const configs = card.steps.filter((s) => s.type === 'config');
  assert.deepEqual(configs.at(-1).params.set, { captureFront: 16, captureBack: 0, captureSide: 8, captureUp: 12 }, '最后一个 config 改回默认值');
  const dir = path.join(tmp, `game${++n}`);
  const file = path.join(dir, 'config', 'xiaojingyu-common.toml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, NEO_TOML);
  const mock = await startMockProbe({ dir, commands: xjyCommands({ pendingMs: 60 }) });
  const ctx = { client: new ProbeClient({ port: mock.port, token: mock.token }), shotsDir: path.join(dir, 'shots'), runId: RUN, gameDir: dir, snapshots: new Map() };
  try {
    const out = [];
    for (const s of card.steps) out.push([s, await runStep(s, ctx)]);
    const files = out.filter(([s]) => s.type === 'expect_file').map(([, r]) => path.basename(r.file));
    assert.ok(files.includes(`P2-006-B-${RUN}.png`) && files.includes(`7 号房 ${RUN}.png`), files.join(', '));
    assert.equal(fs.readFileSync(file, 'utf8'), NEO_TOML, '最后一步改回默认值，和 NeoForge 写的一字不差');
    fs.writeFileSync(file, setTomlKeys(NEO_TOML, { captureBack: 5 })); // 假装卡片中途停了
    ctx.restoreFiles.set(file, NEO_TOML);
    assert.deepEqual(await restoreFiles(ctx), [file]);
    assert.equal(fs.readFileSync(file, 'utf8'), NEO_TOML);
  } finally {
    await mock.close();
  }
});

test('probe-client screen()：POST /screen，body 原样发过去（mock 没有这个接口，回 404 not_found）', async () => {
  const dir = path.join(tmp, `game${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const mock = await startMockProbe({ dir });
  try {
    const client = new ProbeClient({ port: mock.port, token: mock.token });
    await assert.rejects(client.screen({ config: 'xiaojingyu' }), (e) => e.code === 'not_found' && e.httpStatus === 404);
    assert.ok(mock.requests.some((r) => r.method === 'POST' && r.path === '/screen'), JSON.stringify(mock.requests));
  } finally {
    await mock.close();
  }
});
