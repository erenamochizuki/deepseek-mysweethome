// 收藏存档规则（58-inventory-rules）+ 浏览器本地存档（59-cabin-inventory 的 local 后端）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const KINDS = [
  { id: 'moon', size: 0.1 },
  { id: 'float', category: 'collectible', decoratable: true, size: 0.1 },
  { id: 'paper', category: 'collectible', size: 0.1 },
  { id: 'scallop', rarity: 'common', size: 0.13 },
  { id: 'cowrie', rarity: 'uncommon', size: 0.12 },
  { id: 'pearl', rarity: 'rare', size: 0.12 },
  { id: 'plastic_cap', rarity: 'common', size: 0.06, category: 'trash' },
];
const SNACKS = [{ sku: 'blueberry', pack: 'box', count: 12, price: 4 }, { sku: 'cocoa', pack: 'cup', count: 3, price: 4 }];

function rules() {
  const { V3 } = loadV3(['58-inventory-rules']);
  const R = V3.inventoryRules;
  return { R, catalog: R.catalogFrom(KINDS, SNACKS) };
}
function run(R, catalog, s, op, clock = () => 1000) {
  return R.apply(s, R.parseCommand(op, { catalog }), { catalog, clock });
}
const collect = (id, kind, size, pat = 'plain') => ({ op: 'collect', id, kind, at: 10, category: 'collectible', size, pat });

test('size range, crowns and roll distribution', () => {
  const { R, catalog } = rules();
  const k = catalog.kind('scallop');
  assert.deepEqual(R.sizeRange(k), [91, 169]);
  assert.equal(R.crown(k, 169), 'big');
  assert.equal(R.crown(k, 91 + 0.95 * 78), 'big');
  assert.equal(R.crown(k, 91 + 0.94 * 78), null);
  assert.equal(R.crown(k, 91 + 0.05 * 78), 'small');
  assert.equal(R.crown(k, 130), null);
  assert.equal(R.crown(null, 100), null);
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  let big = 0, small = 0, N = 40000;
  const pats = {};
  for (let i = 0; i < N; i++) {
    const mm = R.rollSize(k, rnd), c = R.crown(k, mm);
    assert.ok(mm >= 91 && mm <= 169);
    if (c === 'big') big++; if (c === 'small') small++;
    const p = R.rollPattern(rnd); pats[p] = (pats[p] || 0) + 1;
  }
  assert.ok(big / N > 0.012 && big / N < 0.026, 'big crown ≈ 1.9%: ' + big / N);
  assert.ok(small / N > 0.012 && small / N < 0.026, 'small crown ≈ 1.9%: ' + small / N);
  assert.ok(pats.plain / N > 0.65 && pats.plain / N < 0.75);
  assert.ok(pats.iris > 0 && pats.albino > 0);
});

test('collect stores one instance per shell; trash only counts', () => {
  const { R, catalog } = rules();
  const s = R.freshState();
  const r = run(R, catalog, s, collect('b-1', 'scallop', 168.9, 'iris'));
  assert.equal(r.crown, 'big');
  run(R, catalog, s, collect('b-2', 'scallop', 120));
  run(R, catalog, s, { op: 'collect', id: 't-1', kind: 'plastic_cap', at: 11, category: 'trash' });
  const f = s.inventory.found.scallop;
  assert.equal(f.n, 2);
  assert.deepEqual(f.items.map((x) => [x.uid, x.size, x.pat]), [['b-1', 168.9, 'iris'], ['b-2', 120, 'plain']]);
  assert.equal(s.inventory.trash, 1);
  assert.equal(s.inventory.found.plastic_cap, undefined);
  // 区间外的尺寸夹回区间；不认识的花纹当原色；旧版客户端不带尺寸 → 按 id 固定推出来
  run(R, catalog, s, collect('b-3', 'scallop', 999, 'weird'));
  assert.deepEqual([f.items[2].size, f.items[2].pat], [169, 'plain']);
  const a = R.parseCommand({ op: 'collect', id: 'b-old', kind: 'cowrie', at: 1, category: 'collectible' }, { catalog });
  const b = R.parseCommand({ op: 'collect', id: 'b-old', kind: 'cowrie', at: 2, category: 'collectible' }, { catalog });
  assert.equal(a.size, b.size); assert.equal(a.pat, b.pat);
  assert.ok(a.size >= 84 && a.size <= 156);
  assert.throws(() => run(R, catalog, s, collect('b-1', 'scallop', 120)), /id_reused/);
});

test('v1 inventories upgrade deterministically, never with crowns', () => {
  const { R, catalog } = rules();
  const v1 = { found: { scallop: { n: 3, first: 100, last: 400 }, pearl: { n: 1, first: 50, last: 50 } },
    placements: { 'loft-window': { id: 'p1', kind: 'scallop', placedAt: 500, by: 'girl' } }, trash: 2, cleaned: 5 };
  const a = R.parseInventory(v1, { catalog }), b = R.parseInventory(v1, { catalog });
  assert.deepEqual(a, b);
  assert.equal(a.found.scallop.items.length, 3);
  assert.deepEqual(a.found.scallop.items.map((x) => x.at), [100, 250, 400]);
  for (const it of a.found.scallop.items) { assert.equal(it.pat, 'plain'); assert.equal(R.crown(catalog.kind('scallop'), it.size), null); }
  assert.equal(a.placements['loft-window'].uid, 'legacy:scallop:0');
  assert.equal(a.coins, 0); assert.deepEqual(a.tray, { rev: 0, items: [] });
  // legacy op (旧浏览器档) 导入一次
  const s = R.freshState();
  run(R, catalog, s, { op: 'legacy', id: 'legacy-v3-browser', found: v1.found });
  assert.equal(s.inventory.found.scallop.n, 3);
  assert.equal(run(R, catalog, s, { op: 'legacy', id: 'again', found: v1.found }), false);
  // 整份 v1 文件
  const st = R.parseState({ v: 1, initialized: true, rev: 4, inventory: v1, seen: { a: 'x' } }, { catalog });
  assert.equal(st.v, 2); assert.equal(st.inventory.found.pearl.n, 1);
});

test('place picks a specific shell; used shells cannot be sold or placed twice', () => {
  const { R, catalog } = rules();
  const s = R.freshState();
  run(R, catalog, s, collect('a', 'pearl', 100)); run(R, catalog, s, collect('b', 'pearl', 110));
  assert.deepEqual(run(R, catalog, s, { op: 'place', id: 'p1', kind: 'pearl', uid: 'b', slot: 'coffee-table', by: 'player' }), { uid: 'b' });
  assert.throws(() => run(R, catalog, s, { op: 'place', id: 'p2', kind: 'pearl', uid: 'b', slot: 'loft-window', by: 'player' }), /in_use/);
  assert.deepEqual(run(R, catalog, s, { op: 'place', id: 'p3', kind: 'pearl', slot: 'loft-window', by: 'girl' }), { uid: 'a' });
  assert.throws(() => run(R, catalog, s, { op: 'place', id: 'p4', kind: 'pearl', slot: 'loft-floor', by: 'girl' }), /out_of_stock/);
  assert.throws(() => run(R, catalog, s, { op: 'sell', id: 's1', uids: ['a'] }), /in_use/);
  assert.deepEqual(run(R, catalog, s, { op: 'return', id: 'r1', slot: 'loft-window', by: 'player' }), { uid: 'a' });
  assert.deepEqual(run(R, catalog, s, { op: 'sell', id: 's2', uids: ['a'] }), { sold: 1, earned: 5 });
  assert.equal(s.inventory.coins, 5);
  assert.equal(s.inventory.found.pearl.n, 1);
});

test('coins: trash, selling by rarity, buying and eating snacks', () => {
  const { R, catalog } = rules();
  const s = R.freshState();
  for (const [i, k] of ['scallop', 'cowrie', 'pearl'].entries()) run(R, catalog, s, collect('x' + i, k, 120));
  run(R, catalog, s, { op: 'collect', id: 't1', kind: 'plastic_cap', at: 1, category: 'trash' });
  run(R, catalog, s, { op: 'collect', id: 't2', kind: 'plastic_cap', at: 1, category: 'trash' });
  assert.deepEqual(run(R, catalog, s, { op: 'dispose', id: 'd1' }), { disposed: 2, earned: 2 });
  assert.deepEqual(run(R, catalog, s, { op: 'sell', id: 's', uids: ['x0', 'x1', 'x2'] }), { sold: 3, earned: 9 });
  assert.equal(s.inventory.coins, 11);
  // 卖光了这一种：图鉴仍记得
  assert.equal(s.inventory.found.scallop.n, 0);
  assert.ok(R.parseInventory(JSON.parse(JSON.stringify(s.inventory)), { catalog }));
  assert.throws(() => run(R, catalog, s, { op: 'buy', id: 'b1', sku: 'blueberry', qty: 3 }), /not_enough_coins/);
  assert.throws(() => run(R, catalog, s, { op: 'buy', id: 'b1', sku: 'nope', qty: 1 }), /unknown_item/);
  assert.deepEqual(run(R, catalog, s, { op: 'buy', id: 'b2', sku: 'cocoa', qty: 1 }), { cost: 4, bought: ['b2:0'] });
  assert.equal(s.inventory.coins, 7);
  assert.deepEqual(run(R, catalog, s, { op: 'consume', id: 'c1', uid: 'b2:0', by: 'player' }), { sku: 'cocoa', left: 2, emptied: false });
  run(R, catalog, s, { op: 'consume', id: 'c2', uid: 'b2:0', by: 'girl' });
  assert.deepEqual(run(R, catalog, s, { op: 'consume', id: 'c3', uid: 'b2:0', by: 'girl' }), { sku: 'cocoa', left: 0, emptied: true });
  assert.equal(s.inventory.snacks.length, 0);
  assert.equal(s.inventory.trash, 1, 'empty cup becomes trash');
  assert.throws(() => run(R, catalog, s, { op: 'consume', id: 'c4', uid: 'b2:0', by: 'girl' }), /snack_gone/);
});

test('tray_set validates ownership, bounds and the base revision', () => {
  const { R, catalog } = rules();
  const s = R.freshState();
  run(R, catalog, s, collect('a', 'scallop', 120)); run(R, catalog, s, collect('b', 'scallop', 130));
  run(R, catalog, s, { op: 'place', id: 'p', kind: 'scallop', uid: 'b', slot: 'coffee-table', by: 'player' });
  const set = (id, base, items) => run(R, catalog, s, { op: 'tray_set', id, base, items, by: 'girl', via: 'chat-1' });
  assert.deepEqual(set('t1', 0, [{ uid: 'a', x: 1.23, z: -4, ry: 0.5 }]), { trayRev: 1 });
  assert.deepEqual(s.inventory.tray.items, [{ uid: 'a', x: 1.2, z: -4, ry: 0.5 }]);
  assert.throws(() => set('t2', 0, []), /tray_changed/);
  assert.throws(() => set('t3', 1, [{ uid: 'b', x: 0, z: 0, ry: 0 }]), /in_use/);
  assert.throws(() => set('t4', 1, [{ uid: 'zzz', x: 0, z: 0, ry: 0 }]), /not_owned/);
  assert.throws(() => set('t5', 1, [{ uid: 'a', x: 46, z: 0, ry: 0 }]), /invalid_input/);
  assert.throws(() => run(R, catalog, s, { op: 'sell', id: 's', uids: ['a'] }), /in_use/);
  assert.throws(() => run(R, catalog, s, { op: 'place', id: 'p2', kind: 'scallop', uid: 'a', slot: 'loft-window', by: 'player' }), /in_use/);
});

// 本地存档：假 localStorage + 假 document，走真的 59-cabin-inventory
function page(initial = {}) {
  const mem = new Map(Object.entries(initial));
  const localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const h = loadV3(['58-inventory-rules'], { globals: { localStorage, document: { addEventListener() {}, querySelector: () => null, hidden: false } } });
  h.V3.shells = { KINDS: KINDS.filter((k) => !k.category) };
  h.load(['59-cabin-inventory']);
  return { V3: h.V3, mem };
}

const strands = (...first) => [first, [], [], [], []];
const bead = (uid, gap = 4) => ({ uid, gap });
const chime = (rows, base = 0, slot = 'door') => ({ op: 'chime_set', id: `ch-${slot}-${base}`, slot, base, bar: 'driftwood', strands: rows, by: 'player' });

test('风铃整套替换、跨用途锁定、取下后还是原来那枚', () => {
  const { R, catalog } = rules(), s = R.freshState(), act = op => run(R, catalog, s, op);
  act(collect('a', 'moon', 109, 'iris')); act(collect('b', 'float', 95)); act(collect('c', 'paper', 99));
  const place = { op: 'place', id: 'p', kind: 'moon', slot: 'case', uid: 'a', by: 'player' };
  const tray = { op: 'tray_set', id: 't', base: 0, items: [{ uid: 'a', x: 0, z: 0, ry: 0 }], by: 'player' };
  const loan = { op: 'shore_loan', id: 'l', expected: null, next: 'a' }, sell = { op: 'sell', id: 's', uids: ['a'] };
  for (const other of [place, tray, loan, sell]) {
    const copy = structuredClone(s);
    run(R, catalog, copy, other);
    assert.throws(() => run(R, catalog, copy, chime(strands(bead('a')))), other === sell ? /not_owned/ : /in_use/);
  }
  assert.throws(() => act(chime(strands(bead('c')))), /invalid_input/);
  assert.deepEqual(act(chime(strands(bead('a'), bead('b')))), { slot: 'door', chimeRev: 1 });
  assert.throws(() => act(chime([[bead('a')], [], []], 0, 'window')), /in_use/);
  for (const other of [place, tray, loan, sell]) assert.throws(() => act(other), /in_use/);
  assert.throws(() => act(chime(strands())), e => e.status === 409 && e.code === 'chime_changed');
  act(chime([[], [bead('b'), bead('a', 12)], [], [], []], 1)); act(chime(strands(), 2));
  assert.deepEqual(R.available(s.inventory, 'moon')[0], { uid: 'a', pat: 'iris', size: 109, at: 10 });
  assert.deepEqual(act(chime([[bead('a')], [], []], 0, 'window')), { slot: 'window', chimeRev: 1 });
  assert.throws(() => act(chime(strands(bead('a')), 3)), /in_use/);
  for (const other of [place, tray, loan, sell]) assert.throws(() => act(other), /in_use/);
  assert.throws(() => act(chime([[], [], []], 0, 'window')), /chime_changed/);
  assert.equal(s.inventory.chimes.door.rev, 3);
});

test('五串各五枚，长度含间距，命令和备份都严格校验', () => {
  const { R, catalog } = rules(), s = R.freshState(), act = op => run(R, catalog, s, op);
  const full = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, j) => {
    const uid = `s${i}${j}`; act(collect(uid, 'scallop', 120)); return bead(uid);
  }));
  act(chime(full));
  for (const [rows, code] of [[full.slice(1), /invalid_input/], [[...full, []], /invalid_input/],
    [strands(...full[0], full[1][0]), /invalid_input/], [strands(bead('s00'), bead('s00')), /invalid_input/],
    [strands(bead('s00', 5), ...full[0].slice(1)), /invalid_input/], [strands(bead('absent')), /not_owned/],
    ...[1, 13, 2.5].map(g => [strands(bead('s00', g)), /invalid_input/])]) {
    assert.throws(() => act(chime(rows, 1)), code);
    assert.throws(() => R.parseInventory({ ...s.inventory, chimes: { ...s.inventory.chimes, door: { ...s.inventory.chimes.door, strands: rows } } }, { catalog }), code);
  }
  assert.equal(s.inventory.chimes.door.rev, 1);
  const both = structuredClone(s.inventory); both.chimes.window.strands[0].push(bead('s00'));
  assert.throws(() => R.parseInventory(both, { catalog }), /invalid_input/);
  assert.throws(() => act(chime([], 0, 'unknown')), /invalid_input/);
  act(chime(strands(), 1));
  const windowRows = Array.from({ length: 3 }, (_, i) => Array.from({ length: 4 }, (_, j) => {
    const uid = `w${i}${j}`; act(collect(uid, 'moon', 92.5)); return bead(uid, 2);
  }));
  act(chime(windowRows, 0, 'window'));
  for (const rows of [windowRows.slice(1), [...windowRows, []], [[...windowRows[0], bead('s00')], [], []],
    [[bead('w00', 3), ...windowRows[0].slice(1)], [], []]]) assert.throws(() => act(chime(rows, 1, 'window')), /invalid_input/);
});

test('旧存档、旧备份补默认款，操作重放、导出导入和刷新保留五串位置', async () => {
  const { R, catalog } = rules(), old = R.freshState(); delete old.inventory.chimes;
  const original = { door: { rev: 0, bar: 'driftwood', strands: strands() }, window: { rev: 0, bar: 'driftwood', strands: [[], [], []] } };
  assert.deepEqual(R.parseState(old, { catalog }).inventory.chimes, original);
  const { V3 } = page(), I = V3.cabinInventory, events = []; await I.start({});
  V3.on('game:cabin-event', e => events.push(e));
  assert.equal((await I.restore(R.exportData(old.inventory))).ok, true);
  assert.deepEqual(I.data.inventory.chimes, original);
  await I.perform(collect('b', 'scallop', 133, 'mist'));
  const op = { ...chime(strands(bead('b', 9))), by: 'girl', via: 'session' };
  assert.equal((await I.perform(op)).applied, true); assert.equal((await I.perform(op)).applied, false);
  assert.equal(events.length, 1); assert.equal(events[0].type, 'chime_set');
  assert.deepEqual(events[0].detail, { slot: 'door', by: 'girl', strands: [['scallop'], [], [], [], []], count: 1, via: 'session' });
  await I.perform(collect('w', 'moon', 111, 'iris')); await I.perform(chime([[], [bead('w', 6)], []], 0, 'window'));
  const backup = structuredClone(I.exportData());
  await I.perform({ op: 'reset', id: 'reset', rev: I.data.rev });
  assert.deepEqual(I.data.inventory.chimes, original);
  assert.equal((await I.restore(backup)).ok, true); await I.refresh();
  assert.deepEqual(I.exportData(), backup);
});

test('local backend: offline page keeps an idempotent v2 save in localStorage', async () => {
  const { V3, mem } = page();
  const I = V3.cabinInventory;
  await I.start({ scallop: { n: 2, first: 1, last: 2 } });
  assert.equal(I.remote, false);
  assert.equal(I.ready, true);
  assert.equal(I.data.inventory.found.scallop.n, 2, 'old browser save imported');
  const op = { op: 'collect', id: 'beach-1', kind: 'pearl', at: 5, category: 'collectible', size: 140, pat: 'dots' };
  const r1 = await I.perform(op);
  assert.equal(r1.applied, true); assert.equal(r1.item.uid, 'beach-1');
  const r2 = await I.perform({ ...op, at: 9 });
  assert.equal(r2.applied, false, 'same op id is a replay');
  assert.equal(I.data.inventory.found.pearl.n, 1);
  const saved = JSON.parse(mem.get('v3.inventory'));
  assert.equal(saved.v, 2); assert.equal(saved.inventory.found.pearl.items[0].pat, 'dots');
  const bad = await I.perform({ op: 'buy', id: 'b', sku: 'x', qty: 1 });
  assert.equal(bad.ok, false); assert.equal(bad.code, 'unknown_item');
  assert.equal(I.exportData().format, 'cabin-inventory-v2');
  // 再开一页：从 localStorage 读回来
  const again = page(Object.fromEntries(mem));
  await again.V3.cabinInventory.start({});
  assert.equal(again.V3.cabinInventory.data.inventory.found.pearl.items[0].size, 140);
});

test('local backend: corrupt save is reported, not overwritten', async () => {
  const { V3, mem } = page({ 'v3.inventory': '{"v":2,"broken":true}' });
  await V3.cabinInventory.start({});
  assert.equal(V3.cabinInventory.ready, false);
  assert.match(V3.cabinInventory.error, /读不了/);
  assert.equal(mem.get('v3.inventory'), '{"v":2,"broken":true}');
});

// 新页面 + 旧版（v1）本机服务：读回来的存档升级成 v2 给页面用；collect 照 v1 的格式发；v2 操作不发出去
test('remote v1 server: page upgrades the snapshot and speaks v1', async () => {
  const sent = [];
  let inv = { found: { scallop: { n: 1, first: 1, last: 1 } }, placements: {}, trash: 0, cleaned: 0 }, rev = 1;
  const fetch = async (url, o = {}) => {
    if (o.body) {
      const op = JSON.parse(o.body); sent.push(op);
      const allowed = { collect: ['op', 'id', 'kind', 'at', 'category'], place: ['op', 'id', 'kind', 'slot', 'by', 'returnAt'] }[op.op];
      if (allowed && Object.keys(op).some((k) => !allowed.includes(k))) return { ok: false, status: 400, json: async () => ({ ok: false, error: 'invalid_input' }) };
      if (op.op === 'collect') { const f = inv.found[op.kind] || (inv.found[op.kind] = { n: 0, first: op.at, last: op.at }); f.n++; rev++; }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, initialized: true, rev, inventory: JSON.parse(JSON.stringify(inv)), applied: true }) };
  };
  const h = loadV3(['58-inventory-rules'], { globals: { fetch, __CABIN_LOCAL_INVENTORY: true, document: { addEventListener() {}, querySelector: () => null, hidden: false } } });
  h.V3.shells = { KINDS: KINDS.filter((k) => !k.category) };
  h.load(['59-cabin-inventory']);
  const I = h.V3.cabinInventory;
  await I.start({});
  assert.equal(I.remote, true); assert.equal(I.serverV1, true);
  assert.equal(I.data.inventory.found.scallop.items[0].uid, 'legacy:scallop:0');
  const r = await I.perform({ op: 'collect', id: 'beach-9', kind: 'pearl', at: 3, category: 'collectible', size: 140, pat: 'iris' });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(sent.at(-1)).sort(), ['at', 'category', 'id', 'kind', 'op']);
  assert.equal(I.data.inventory.found.pearl.n, 1);
  const n = sent.length;
  const sell = await I.perform({ op: 'sell', id: 's', uids: ['legacy:scallop:0'] });
  assert.equal(sell.ok, false); assert.equal(sell.code, 'old_server');
  assert.equal(sent.length, n, 'v2 op never reaches the old server');
  assert.match(sell.error, /INVENTORY-V2/);
});
