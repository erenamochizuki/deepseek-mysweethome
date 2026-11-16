// 相册和相框（docs/PHOTOS.md，mod7）：卡片的 use 步骤（探针接口 12 /use）、ProbeClient.use()、
// 生成卡片 P5-004 的 photo-card.mjs（照片合不合规、翻页规则、画框墙的点击位置、卡片是不是最新的）。
// 运行：node --test mod/tools/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCard, runStep, describeStep, CardError, StepFailed } from '../lib/cards.mjs';
import { ProbeClient } from '../probe-client.mjs';
import { startMockProbe, makeTempDir } from './mock-probe.mjs';
import { writeCard, removeDir } from './helpers.mjs';
import { cardText, CARD_FILE, photos, photoProblem, photoId, makePng, readSlots, slotHit, toWorld, step } from '../photo-card.mjs';

const tmp = makeTempDir('photos-');
test.after(() => removeDir(tmp));
let n = 0;
const steps = (text) => loadCard(writeCard(tmp, `ph-${++n}.yml`, text)).steps;
const cardError = (text, re) => assert.throws(() => steps(text), (e) => e instanceof CardError && re.test(e.reason), text);

async function world(onUse, extra = {}) {
  const dir = path.join(tmp, `game${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const mock = await startMockProbe({ dir, onUse, ...extra });
  const ctx = { client: new ProbeClient({ port: mock.port, token: mock.token }), shotsDir: path.join(dir, 'shots'), runId: '20261108-040000', gameDir: dir, snapshots: new Map() };
  const run = async (text) => {
    const out = [];
    for (const s of steps(text)) out.push(await runStep(s, ctx));
    return out;
  };
  await run('steps:\n  - open: ph\n  - wait: {inWorld: true, screen: null, timeout: 10}\n');
  return { mock, ctx, run };
}

test('use 步骤：参数检查', () => {
  const s = steps('steps:\n  - use: {pos: [1, -59, 2], face: north, hit: [1.5, -58.7, 2.9], sneak: true, consumed: true, actionBarContains: Photo 1}\n')[0];
  assert.deepEqual(s.params, { pos: [1, -59, 2], face: 'north', hit: [1.5, -58.7, 2.9], sneak: true, consumed: true, actionBarContains: ['Photo 1'] });
  assert.equal(describeStep(s), 'use 1 -59 2 north at 1.5 -58.7 2.9  (sneak)');
  cardError('steps:\n  - use: {face: north}\n', /pos 要写成/);
  cardError('steps:\n  - use: {pos: [1, 2, 3], face: front}\n', /face 只能是/);
  cardError('steps:\n  - use: {pos: [1, 2, 3], hit: [1, 2]}\n', /hit 要写成/);
  cardError('steps:\n  - use: {pos: [1, 2, 3], sneak: yes}\n', /sneak 只能是/);
  cardError('steps:\n  - use: {pos: [1, 2, 3], consumed: 1}\n', /consumed 只能是/);
  cardError('steps:\n  - use: {pos: [1, 2, 3], hand: off}\n', /没有参数「hand」/);
});

test('use 步骤：发给探针的请求、检查 consumed 和动作栏', async () => {
  const seen = [];
  const { mock, run } = await world((b) => {
    seen.push(b);
    return b.sneak ? { result: 'pass', consumed: false, actionBar: null } : { result: 'success', consumed: true, actionBar: 'Photo 2 of 3: 小船' };
  });
  try {
    const [r] = await run('steps:\n  - use: {pos: [10, -59, 9], face: north, consumed: true, actionBarContains: [Photo 2 of 3, 小船]}\n');
    assert.deepEqual(r, { result: 'success', consumed: true, actionBar: 'Photo 2 of 3: 小船' });
    assert.deepEqual(seen[0], { pos: [10, -59, 9], face: 'north' }, '没写的参数不发');
    await run('steps:\n  - use: {pos: [10, -59, 9], hit: [10.5, -58.5, 9.9], sneak: true, consumed: false}\n');
    assert.deepEqual(seen[1], { pos: [10, -59, 9], hit: [10.5, -58.5, 9.9], sneak: true });
    await assert.rejects(run('steps:\n  - use: {pos: [10, -59, 9], actionBarContains: Photo 3}\n'),
      (e) => e instanceof StepFailed && /动作栏的字里没有「Photo 3」/.test(e.message));
    await assert.rejects(run('steps:\n  - use: {pos: [10, -59, 9], sneak: true, consumed: true}\n'),
      (e) => e instanceof StepFailed && /右键没有起作用/.test(e.message));
    await assert.rejects(run('steps:\n  - use: {pos: [10, -59, 9], sneak: true, actionBarContains: x}\n'),
      (e) => e instanceof StepFailed && /动作栏没有新的字/.test(e.message));
  } finally {
    await mock.close();
  }
});

test('ProbeClient.use()：不在世界里 409；旧探针没有 /use 回 404', async () => {
  const dir = path.join(tmp, `old${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const old = await startMockProbe({ dir, oldProbe: true });
  try {
    const c = new ProbeClient({ port: old.port, token: old.token });
    await assert.rejects(c.use([0, -60, 0]), (e) => e.code === 'not_found' && e.httpStatus === 404);
  } finally {
    await old.close();
  }
  const dir2 = path.join(tmp, `new${++n}`);
  fs.mkdirSync(dir2, { recursive: true });
  const mock = await startMockProbe({ dir: dir2 });
  try {
    const c = new ProbeClient({ port: mock.port, token: mock.token });
    await assert.rejects(c.use([0, -60, 0]), (e) => e.code === 'not_in_world');
  } finally {
    await mock.close();
  }
});

test('photo-card：卡片 P5-004 是最新的、读得懂', () => {
  assert.equal(fs.readFileSync(CARD_FILE, 'utf8'), cardText(), '跑 node mod/tools/photo-card.mjs 重新生成');
  const card = loadCard(CARD_FILE);
  assert.ok(card.steps.filter((s) => s.type === 'use').length >= 60);
  assert.ok(card.steps.some((s) => s.type === 'expect_files'));
  for (const s of card.steps) {
    if (s.type === 'cmd') assert.ok(Buffer.byteLength(JSON.stringify({ command: s.params.command })) < 60 * 1024, '探针的请求体最多 64 KB');
  }
});

test('photo-card：照片合 PHOTOS.md §1 的规矩，检查和模组一样', () => {
  const P = photos();
  for (const p of Object.values(P)) {
    assert.equal(photoProblem(p.png), null, p.key);
    assert.match(p.id, /^[0-9a-f]{16}$/);
    assert.equal(p.id, photoId(p.png));
  }
  assert.equal(new Set(Object.values(P).map((p) => p.id)).size, 4, '4 张照片都不一样');
  const bad = Buffer.from(P.A.png);
  bad[1] = 0x4A;
  assert.equal(photoProblem(bad), 'not_png');
  assert.equal(photoProblem(makePng(64, 64, () => 0)), 'wrong_size');
  const noise = (x, y) => { let h = Math.imul(x * 128 + y + 1, 0x9E3779B1); h ^= h >>> 15; h = Math.imul(h, 0x85EBCA77); h ^= h >>> 13; return h & 0xFFFFFF; };
  assert.equal(photoProblem(makePng(128, 128, noise)), 'too_large', '随机像素压不下去，超过 48 KB');
  assert.equal(photoProblem(Buffer.alloc(10)), 'not_png');
});

test('photo-card：翻页规则和画框墙的点击位置（和模组 PhotoTests 的手算点一样）', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual([step(ids, null, false), step(ids, 'a', false), step(ids, 'c', false), step(ids, 'x', false)], [0, 1, -1, 0]);
  assert.deepEqual([step(ids, null, true), step(ids, 'c', true), step(ids, 'a', true), step(ids, 'x', true)], [2, 1, -1, 2]);
  const rows = readSlots('PICTURE_FRAMES');
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], [1, 6.5, 1, 15, 6, 15.5]);
  assert.deepEqual(readSlots('PHOTO_FRAME'), [[0, 2, 2, 14, 14, 15]]);
  // 朝北：模型 = 世界；第 0 个框正中 x = 16 + (6.5 + 15) / 2 = 26.75 像素
  assert.deepEqual(slotHit(rows, 0, 0, [12, -59, 9]), [13.6719, -58.7812, 9.9063]);
  // 朝东：(X, Z) → (16 − Z, X)；朝南：(16 − X, 16 − Z)；朝西：(Z, 16 − X)
  assert.deepEqual(toWorld(1, 26.75, 0, 14.5), [1.5 / 16, 0, 26.75 / 16]);
  assert.deepEqual(toWorld(2, 26.75, 0, 14.5), [(16 - 26.75) / 16, 0, 1.5 / 16]);
  assert.deepEqual(toWorld(3, 26.75, 0, 14.5), [14.5 / 16, 0, (16 - 26.75) / 16]);
});
