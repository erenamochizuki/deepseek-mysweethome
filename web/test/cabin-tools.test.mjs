// 小鲸鱼的工具（58-cabin-tools + 69-sand-tray 的 sand_tray）：看、摆、挪、拿走、清空；结果给文字（草图）+ 存档 by 'girl'；桥接用 connect 接进来。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const KINDS = [
  { id: 'scallop', name: '扇贝', rarity: 'common', size: 0.13 },
  { id: 'pearl', name: '珍珠贝', rarity: 'rare', size: 0.12 },
];
async function page() {
  const mem = new Map();
  const localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const h = loadV3(['58-inventory-rules', '58-cabin-tools'], { three: 'real', globals: { localStorage, document: { addEventListener() {}, querySelector: () => null, hidden: false } } });
  const V3 = h.V3, events = [];
  V3.shells = { KINDS };
  V3.scene = { part() {} };
  V3.hud = { toast() {}, iconPx: (n) => n };
  V3.game = { kinds: () => KINDS, kind: (id) => KINDS.find((k) => k.id === id) || null, hosted: true };
  V3.on('game:cabin-event', (e) => events.push(e));
  h.load(['59-cabin-inventory', '69-sand-tray']);
  const I = V3.cabinInventory;
  await I.start({});
  for (const [id, kind, size, pat] of [['s1', 'scallop', 160, 'plain'], ['s2', 'scallop', 100, 'iris'], ['p1', 'pearl', 130, 'plain']]) {
    await I.perform({ op: 'collect', id, kind, at: 1, category: 'collectible', size, pat });
  }
  return { V3, I, events };
}

test('the registry lists sand_tray with a JSON schema', async () => {
  const { V3 } = await page();
  const t = V3.cabinTools.list().find((x) => x.name === 'sand_tray');
  assert.ok(t);
  assert.deepEqual(t.parameters.required, ['action']);
  assert.deepEqual(t.parameters.properties.action.enum, ['look', 'apply']);
  assert.ok(JSON.parse(JSON.stringify(t.parameters)), 'schema is plain JSON');
});

test('look, then apply: she places, moves and removes; saved as hers with the conversation id', async () => {
  const { V3, I, events } = await page();
  const look = await V3.cabinTools.call('sand_tray', { action: 'look', image: false });
  assert.equal(look.ok, true);
  assert.match(look.text, /现在摆着 0 \/ 80 枚/);
  assert.match(look.text, /scallop（扇贝）× 2，100–160 mm，其中稀有花纹 1 枚/);
  const r = await V3.cabinTools.call('sand_tray', { action: 'apply', image: false, ops: [
    { op: 'place', kind: '扇贝', x: -10, z: 0, ry: 90 },
    { op: 'place', kind: 'scallop', prefer: 'rare', x: 10, z: 0 },
    { op: 'place', kind: 'pearl', x: 99, z: 5 },
    { op: 'place', kind: 'pearl', x: 0, z: 0 },
    { op: 'move', uid: 's1', z: -12, flip: true },
    { op: 'remove', uid: 's2' },
    { op: 'place', kind: 'octopus', x: 0, z: 0 },
  ] }, { via: 'chat-42' });
  assert.equal(r.result.saved, true);
  assert.equal(r.ok, false, 'some steps failed');
  assert.deepEqual(r.result.results.map((x) => x.ok ? 'ok' : x.error), ['ok', 'ok', 'ok', 'none_free', 'ok', 'ok', 'unknown_kind']);
  assert.equal(r.result.results[0].uid, 's1', 'biggest scallop by default');
  assert.equal(r.result.results[1].uid, 's2', 'rare pattern when asked');
  assert.equal(r.result.results[2].clamped, true);
  const tray = I.data.inventory.tray.items;
  assert.deepEqual(tray.map((t) => t.uid).sort(), ['p1', 's1']);
  const s1 = tray.find((t) => t.uid === 's1');
  assert.deepEqual([s1.x, s1.z, s1.flip], [-10, -12, true]);
  assert.ok(Math.abs(s1.ry - Math.PI / 2) < 1e-3);
  assert.equal(tray.find((t) => t.uid === 'p1').x, 44, 'clamped inside the tray');
  assert.match(r.text, /4\. place 失败：这一种没有空闲的了/);
  assert.match(r.text, /俯视草图/);
  assert.match(r.text, /A=扇贝/);
  const ev = events.find((e) => e.type === 'tray_arrange');
  assert.equal(ev.detail.via, 'chat-42'); assert.equal(ev.detail.by, 'girl');
  // 摆在沙盘里的不能卖
  const sell = await I.perform({ op: 'sell', id: 'sell-x', uids: ['s1'] });
  assert.equal(sell.ok, false);
});

test('a plan with no successful step saves nothing; clear empties the tray', async () => {
  const { V3, I } = await page();
  const rev = I.data.rev;
  const bad = await V3.cabinTools.call('sand_tray', { action: 'apply', image: false, ops: [{ op: 'move', uid: 'nope' }] });
  assert.equal(bad.result.saved, false);
  assert.equal(I.data.rev, rev);
  await V3.cabinTools.call('sand_tray', { action: 'apply', image: false, ops: [{ op: 'place', kind: 'pearl', x: 0, z: 0 }] });
  assert.equal(I.data.inventory.tray.items.length, 1);
  await V3.cabinTools.call('sand_tray', { action: 'apply', image: false, ops: [{ op: 'clear' }] });
  assert.equal(I.data.inventory.tray.items.length, 0);
  const unknown = await V3.cabinTools.call('nope', {});
  assert.equal(unknown.ok, false); assert.equal(unknown.error, 'unknown_tool');
});

test('a bridge can plug in a transport; each call is answered on the same call id', async () => {
  const { V3 } = await page();
  const replies = [];
  let served = false;
  const done = new Promise((resolve) => {
    V3.cabinTools.connect({
      next: async () => { if (served) return new Promise(() => {}); served = true; return { callId: 'c-1', name: 'sand_tray', args: { action: 'look', image: false }, via: 'chat-7' }; },
      reply: async (id, result) => { replies.push([id, result]); resolve(); },
    });
  });
  await done;
  V3.cabinTools.disconnect();
  assert.equal(replies[0][0], 'c-1');
  assert.equal(replies[0][1].ok, true);
  assert.match(replies[0][1].text, /沙盘展示盒/);
});
