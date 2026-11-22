// 零食（69-snack-bar）：喂 = 她先接（actor.snack），再 consume；她忙就不扣；杯装喝空变垃圾；她自己吃的间隔和次数。
// 真的规则 + 浏览器本地存档（58、59）+ 零食目录（32），假的 actor / HUD / 场景。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

function page({ accept = true } = {}) {
  const mem = new Map();
  const localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const h = loadV3(['58-inventory-rules', '32-snack-catalog', '69-snack-events'], { three: 'real', globals: { localStorage, document: { addEventListener() {}, querySelector: () => null, hidden: false } } });
  const V3 = h.V3, events = [], said = [];
  V3.shells = { KINDS: [{ id: 'pearl', rarity: 'rare', size: 0.12 }] };
  V3.scene = { part() {} };
  V3.hud = { toast() {}, iconPx: (n) => n };
  V3.on('game:cabin-event', (e) => events.push(e));
  const actor = {
    state: 'idle', behavior: null, held: false, resting: false, pos: [0, 0, 0], yaw: 0, snacks: [],
    snack(o) { if (!accept) return false; this.snacks.push(o); return true; },
    say(t) { said.push(t); return true; }, goto: async () => true, hand: (v) => v,
  };
  V3.actor = actor;
  h.load(['59-cabin-inventory', '59-cabin-wallet', '69-snack-bar']);
  return { V3, I: V3.cabinInventory, actor, events, said, mem };
}
async function stocked(p, sku, qty = 1) {
  await p.I.start({});
  await p.I.devCoins(50);
  const r = await p.I.perform({ op: 'buy', id: 'buy-' + sku, sku, qty });
  assert.equal(r.ok, true, r.error);
}

test('feeding a piece: she takes it first, then one is used up and reported', async () => {
  const p = await page();
  await stocked(p, 'blueberry');
  const sn = p.I.data.inventory.snacks[0];
  const r = await p.V3.snackBar.feed(sn.uid, 'player');
  assert.equal(r.ok, true);
  assert.equal(p.actor.snacks.length, 1);
  assert.equal(p.actor.snacks[0].kind, 'eat');
  assert.equal(p.I.data.inventory.snacks[0].left, 11);
  const eat = p.events.filter((e) => e.type === 'snack_eat').at(-1);
  assert.equal(eat.type, 'snack_eat');
  assert.match(eat.text, /你喂她吃了一颗蓝莓/);
  assert.equal(eat.detail.by, 'player');
  assert.equal(eat.detail.name, '蓝莓');
  assert.equal(eat.detail.taste, '酸酸甜甜');
});

test('wallet snapshot is reported on inventory change (coins + snacks with taste)', async () => {
  const p = await page();
  await stocked(p, 'blueberry', 2);
  await new Promise((r) => setTimeout(r, 450));
  const w = p.events.filter((e) => e.type === 'wallet').at(-1);
  assert.ok(w, 'wallet event emitted');
  assert.equal(w.detail.coins, p.I.data.inventory.coins);
  const blue = w.detail.snacks.find((s) => s.sku === 'blueberry');
  assert.ok(blue, 'snack listed in wallet');
  assert.equal(blue.name, '蓝莓');
  assert.equal(blue.taste, '酸酸甜甜');
  assert.equal(blue.left, 12);
});

test('the six fresh fruit boxes keep their servings, prices and individual eating reactions', async () => {
  const { V3, I: client, actor, events } = page();
  const expected = [ ['strawberry', 6, 5, '颗'], ['mandarin', 8, 3, '瓣'], ['apple', 6, 4, '片'],
    ['kiwi', 6, 4, '片'], ['watermelon', 4, 4, '角'], ['mango', 4, 5, '块'] ];
  const catalog = V3.snackCatalog;
  assert.equal(new Set(catalog.list.map(item => item.sku)).size, catalog.list.length);
  assert.deepEqual(catalog.list.filter(item => item.fruit).map(item => item.sku).sort(), ['blueberry', 'durian', ...expected.map(([sku]) => sku)].sort());
  await client.start({}); await client.devCoins(50);
  for (const [sku, count, price, unit] of expected) {
    const item = catalog.get(sku);
    assert.deepEqual([item.pack, item.count, item.price, item.unit], ['box', count, price, unit]);
    const sale = await client.perform({ op: 'buy', id: 'buy-' + sku, sku, qty: 1 });
    assert.equal(sale.cost, price);
    const box = client.data.inventory.snacks.find(entry => entry.sku === sku);
    assert.equal(box.left, count);
    for (let left = count - 1; left >= 0; left--) {
      const by = left % 2 ? 'player' : 'girl';
      const result = await V3.snackBar.feed(box.uid, by);
      assert.deepEqual(result, { ok: true, emptied: false, left });
      assert.equal(actor.snacks.at(-1).kind, 'eat');
      assert.notEqual(actor.snacks.at(-1).text, '好吃！');
      const detail = events.findLast(event => event.type === 'snack_eat').detail;
      assert.deepEqual([detail.sku, detail.left, detail.taste, detail.by], [sku, left, item.taste, by]);
    }
  }
  assert.equal(client.data.inventory.coins, 25);
  assert.equal(client.data.inventory.snacks.length, 0);
  assert.equal(client.data.inventory.trash, 0);
});

test('spoonfuls of honey and pudding use the eating pose', async () => {
  for (const sku of ['honey','pudding']) {
    const p = page();
    await stocked(p,sku);
    assert.ok((await p.V3.snackBar.feed(p.I.data.inventory.snacks[0].uid)).ok);
    assert.equal(p.actor.snacks[0].kind,'eat');
    assert.match(p.events.find(e=>e.type==='snack_eat').text,/舀了一勺/);
  }
});

test('a busy whale refuses and nothing is used up', async () => {
  const p = await page({ accept: false });
  await stocked(p, 'cake');
  const sn = p.I.data.inventory.snacks[0];
  const r = await p.V3.snackBar.feed(sn.uid, 'player');
  assert.equal(r.ok, false);
  assert.equal(p.I.data.inventory.snacks[0].left, 4);
  assert.equal(p.events.filter((e) => e.type === 'snack_eat').length, 0);
});

test('four disjoint shelves of eight; foods are paid for and consumed one serving at a time', async () => {
  const { V3, I:client, actor }=page(), catalog=V3.snackCatalog;
  assert.equal(catalog.list.length,32);
  for(const key of Object.keys(catalog.shelves)) assert.equal(catalog.list.filter(item=>item.category===key).length,8);
  await client.start({}); await client.devCoins(60);
  const goods={fruit:['durian'],savory:['pretzel','sandwich','dried_fish'],sweet:['madeleine','donut','berry_star'],drink:['barley_tea','matcha','peach_yogurt','sea_soda','osmanthus_oolong']};
  for(const [key,skus] of Object.entries(goods)) for(const sku of skus) {
    const item=catalog.get(sku), cup=key==='drink'; assert.equal(item.category,key);
    const sale=await client.perform({op:'buy',id:'buy-'+sku,sku,qty:1}); assert.equal(sale.cost,item.price);
    const box=client.data.inventory.snacks.find(entry=>entry.sku===sku); assert.equal(box.left,item.count);
    for(let left=item.count-1;left>=0;left--) {
      assert.deepEqual(await V3.snackBar.feed(box.uid,'player'),{ok:true,left,emptied:cup && !left});
      assert.equal(actor.snacks.at(-1).kind,cup?'drink':'eat'); assert.notEqual(actor.snacks.at(-1).text,'好吃！');
    }
  }
  assert.equal(client.data.inventory.coins,4); assert.equal(client.data.inventory.snacks.length,0); assert.equal(client.data.inventory.trash,5);
});

test('three sips empty a cup; the empty cup becomes trash worth a coin', async () => {
  const p = await page();
  await stocked(p, 'cocoa');
  const uid = p.I.data.inventory.snacks[0].uid, coins = p.I.data.inventory.coins;
  for (let i = 0; i < 3; i++) assert.equal((await p.V3.snackBar.feed(uid, 'player')).ok, true);
  assert.equal(p.actor.snacks[0].kind, 'drink');
  assert.equal(p.I.data.inventory.snacks.length, 0);
  assert.equal(p.I.data.inventory.trash, 1);
  const d = await p.I.perform({ op: 'dispose', id: 'd' });
  assert.equal(d.earned, 1);
  assert.equal(p.I.data.inventory.coins, coins + 1);
});

test('she snacks on her own only when it has been long enough', async () => {
  const p = await page();
  await stocked(p, 'chips', 2);
  const B = p.V3.snackBar;
  B.basketSpot = () => null;   // 不画房子：considerGirl 内部调用的是模块里的 basketSpot，这里只测间隔的记账
  const shanghai = (h, m) => Date.UTC(2026, 10, 17, h - 8, m);
  // 午饭前后（11:00–14:00）不去
  const orig = Math.random; Math.random = () => 0;
  try {
    assert.equal(B.considerGirl(shanghai(12, 0)), false);
    p.mem.set('cabin.snack.v1', JSON.stringify({ day: '2026-11-17', n: 1, last: shanghai(15, 0) }));
    assert.equal(B.considerGirl(shanghai(15, 20)), false, '40 minutes have not passed');
    p.mem.set('cabin.snack.v1', JSON.stringify({ day: '2026-11-17', n: 4, last: shanghai(9, 0) }));
    assert.equal(B.considerGirl(shanghai(16, 0)), false, 'four snacks today already');
  } finally { Math.random = orig; }
});
test('self-snack settings: auto / chance / gap / daily max come from game settings', async () => {
  const p = await page();
  await stocked(p, 'blueberry');
  p.V3.game = { S: { snackAuto: false, snackChance: 0, snackMinGap: 10, snackMaxGap: 20, snackDailyMax: 2, snackCheckMin: 2 } };
  const s = p.V3.snackBar.settings();
  assert.equal(s.auto, false);
  assert.equal(s.chance, 0);
  assert.equal(s.dailyMax, 2);
  assert.equal(s.minGapMs, 600000);
  assert.equal(s.maxGapMs, 1200000);
  assert.equal(s.checkMs, 120000, 'check interval comes from snackCheckMin');
  assert.equal(p.V3.snackBar.considerGirl(Date.now()), false, 'auto off = never');
  assert.equal(p.V3.snackBar.settings().checkMs, 120000);
  p.V3.game = { S: {} };
  assert.equal(p.V3.snackBar.settings().checkMs, 300000, 'default check interval is 5 minutes');
  p.V3.game = { S: { snackAuto: true, snackChance: 0, snackMinGap: 10, snackMaxGap: 20, snackDailyMax: 2, snackCheckMin: 2 } };
  p.V3.game.S.snackAuto = true;
  assert.equal(p.V3.snackBar.considerGirl(Date.now()), false, '0% chance = never');
  p.V3.game.S.snackChance = 1;
  const now = Date.now();
  p.mem.set('cabin.snack.v1', JSON.stringify({ day: 'x', n: 0, last: now - 5 * 60000, gap: 20 * 60000 }));
  assert.equal(p.V3.snackBar.considerGirl(now), false, 'inside the configured minimum gap');
  const sn = p.I.data.inventory.snacks[0];
  await p.V3.snackBar.feed(sn.uid, 'girl');
  const mem = JSON.parse(p.mem.get('cabin.snack.v1'));
  assert.ok(mem.gap >= 600000 && mem.gap <= 1200000, 'remembered gap inside settings range: ' + mem.gap);
});
