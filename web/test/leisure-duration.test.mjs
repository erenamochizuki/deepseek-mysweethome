// 她闲着时自己找事做（看书 / 看电视 / 翻相册 / 看海 / 看星星）每次做多久（2026-11-18）。
// 以前：read 固定 15 秒、watch_tv 35–65 秒、album 20–35、sea 50–100、stargaze 40–80 —— 用户反馈「有时候很快就停下来」。
// 现在：设置「消遣」里的最短 / 最长（分钟，默认 1 和 5），每次在这个区间里随机取。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { actorCabin } from '../tools/lib/actor-cabin.mjs';

function routinePage() {
  const mem = new Map();
  const localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const document = { addEventListener() {}, hidden: false, body: { classList: { contains: () => false } }, querySelector: () => null };
  return loadV3(['89-cabin-routine'], { page: 'cabin', three: 'stub', globals: { localStorage, document } });
}
function gamePage() {
  const mem = new Map();
  const localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const document = { addEventListener() {}, hidden: false, body: { classList: { contains: () => false } }, querySelector: () => null };
  return loadV3(['60-game'], { page: 'cabin', three: 'stub', globals: { localStorage, document } });
}
function withRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = original; }
}

test('default 消遣 duration is 1–5 minutes (60–300 s)', () => {
  const { V3 } = routinePage();
  V3.game = { S: {} };
  assert.ok(V3.cabinRoutine.leisure.some(([kind, weight]) => kind === 'draw' && weight > 0));
  for (const r of [0, 0.5, 0.999999]) {
    const seconds = withRandom(r, () => V3.cabinRoutine.leisureSeconds());
    assert.ok(seconds >= 60 && seconds <= 300, 'in 1–5 min: ' + seconds);
  }
  assert.equal(withRandom(0, () => V3.cabinRoutine.leisureSeconds()), 60);
  assert.equal(withRandom(0.5, () => V3.cabinRoutine.leisureSeconds()), 180);
  assert.equal(Math.round(withRandom(0.999999, () => V3.cabinRoutine.leisureSeconds())), 300);
});

test('custom min/max (minutes) become seconds and the range is respected', () => {
  const { V3 } = routinePage();
  V3.game = { S: { leisureMin: 2, leisureMax: 3 } };
  assert.equal(withRandom(0, () => V3.cabinRoutine.leisureSeconds()), 120);
  assert.equal(withRandom(0.5, () => V3.cabinRoutine.leisureSeconds()), 150);
  assert.equal(Math.round(withRandom(0.999999, () => V3.cabinRoutine.leisureSeconds())), 180);
});

test('a max below min collapses to the min (never shorter than the configured min)', () => {
  const { V3 } = routinePage();
  V3.game = { S: { leisureMin: 5, leisureMax: 2 } };
  assert.equal(withRandom(0, () => V3.cabinRoutine.leisureSeconds()), 300);
  assert.equal(withRandom(0.999999, () => V3.cabinRoutine.leisureSeconds()), 300);
});

test('settings schema exposes 消遣 min/max with 1/5 minute defaults and keeps min ≤ max', () => {
  const { V3 } = gamePage();
  const G = V3.game;
  const min = G.SCHEMA.find((f) => f.key === 'leisureMin'), max = G.SCHEMA.find((f) => f.key === 'leisureMax');
  assert.ok(min && max, 'both settings exist');
  assert.equal(min.group, '消遣'); assert.equal(max.group, '消遣');
  assert.equal(min.def, 1); assert.equal(max.def, 5);
  assert.equal(min.unit, '分钟'); assert.equal(max.unit, '分钟');
  assert.equal(G.S.leisureMin, 1); assert.equal(G.S.leisureMax, 5);
  // PAIRS：调一端会把另一端顶过去，保证最短 ≤ 最长
  G.set('leisureMin', 8);
  assert.equal(G.S.leisureMax, 8);
  G.set('leisureMax', 2);
  assert.equal(G.S.leisureMin, 2);
});

test('actor keeps a long leisure (no clamp at the old 300 s ceiling)', async (t) => {
  const c = await actorCabin(t, {}), { a } = c;
  // 设置最长 30 分钟时，秒数会超过以前各消遣写死的 300 秒上限；这里给 15 分钟并跑过 400 秒，她仍应在看书
  assert.ok(a.startBehavior('read', { seconds: 900 }));
  c.until(() => a.behavior?.phase === 'action', 120, 'reading');
  c.step(400);
  assert.equal(a.behavior?.kind, 'read', 'still reading after 400 s');
  assert.equal(a.behavior?.phase, 'action');
  a.cancelBehavior('test');
});
