import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const kind = 'beach_morning_glory', zone = 'Asia/Singapore';
const start = Date.parse('2026-11-21T15:50:00Z'), dayMs = 86400000;
const seed = { op: 'collect', id: 'beach-1', at: start, kind, category: 'seed' };
function plot() {
  const { V3 } = loadV3(['58-inventory-rules']), R = V3.inventoryRules, s = R.freshState();
  const run = (cmd, now = start) => R.apply(s, R.parseCommand(cmd), { clock: () => now });
  const plant = () => run({ op: 'garden_plant', id: 'plant', kind });
  const water = (now, by = 'player') => run({ op: 'garden_water', id: 'water-' + now, by, zone, day: R.gardenDay(now, zone) }, now);
  return { R, s, run, plant, water };
}

test('拾种、种下扣一颗、换盆后仍记得捡过什么', () => {
  const { R, s, run, plant } = plot(); assert.throws(plant, /no_seed/);
  run(seed); plant(); const { garden, found } = s.inventory;
  assert.deepEqual(garden.seen, [kind]); assert.equal(garden.seeds[kind], 0);
  assert.equal(Object.keys(found).length, 0); assert.equal(R.isEmpty(s.inventory), false);
  assert.throws(plant, /pot_busy/); run({ op: 'garden_clear', id: 'clear' });
  assert.equal(garden.pot, null); assert.equal(garden.seeds[kind], 0); assert.deepEqual(garden.seen, [kind]);
  assert.throws(() => run({ op: 'garden_clear', id: 'again' }), /pot_empty/);
  for (const op of [{ ...seed, kind:'scallop' }, { ...seed, category:'collectible' }, { ...seed, size:10 }]) assert.throws(() => run(op), /invalid_input/);
});

test('固定奖励时区过午夜可再浇，漏浇不补长，夏令时回拨也只算一天', () => {
  const { R, s, run, plant, water } = plot(); run(seed); plant(); const p = s.inventory.garden.pot;
  water(start); assert.equal(water(start + 30000, 'girl'), false);
  const midnight = start + 10 * 60000;
  assert.throws(() => run({ op:'garden_water', id:'wrong-day', by:'girl', day:'2026-11-21', zone:'UTC' }, midnight), /day_changed/);
  assert.throws(() => run({ op:'shore_gift', id:'gift', zone:'UTC', slot:'2026-11-21/pm' }, midnight), /shift_changed/);
  water(midnight, 'girl'); water(start + 5 * dayMs);
  assert.deepEqual(p.watered, ['2026-11-21','2026-11-22','2026-11-26']); assert.deepEqual(p.by, ['player','girl','player']);
  assert.deepEqual([0,1,2,3,5,6,8,9,11,12,25].map(R.gardenStage), [0,1,1,2,2,3,3,4,4,5,5]);
  assert.equal(R.gardenDay(Date.parse('2026-11-01T08:30Z'), 'America/Los_Angeles'), R.gardenDay(Date.parse('2026-11-01T09:30Z'), 'America/Los_Angeles'));
});

test('十二日首花，再浇三日收种；重试同一操作不会多领', async () => {
  const { R, s, run, plant, water } = plot(); run(seed); plant();
  const harvest = { op:'garden_harvest', id:'harvest-1' };
  for (let i = 0; i < 14; i++) {
    assert.equal(!!water(start + i * dayMs).firstBloom, i === 11); assert.throws(() => run(harvest), /not_ready/);
  }
  assert.equal(s.inventory.garden.bloomed[kind], start + 11 * dayMs); water(start + 14 * dayMs);
  const mem = new Map([['v3.inventory', JSON.stringify(s)]]);
  const page = loadV3(['58-inventory-rules','59-cabin-inventory'], { globals: {
    localStorage: { getItem:k => mem.get(k), setItem:(k,v) => mem.set(k,v) }, document: { addEventListener() {}, querySelector() {} },
  } });
  const I = page.V3.cabinInventory; await I.start(); const a = await I.perform(harvest), b = await I.perform(harvest);
  assert.equal(a.applied, true); assert.equal(b.applied, false); assert.equal(a.gained, run(harvest).gained);
  assert.ok([1,2].includes(a.gained)); assert.equal(b.inventory.garden.seeds[kind], a.gained);
  water(start + 15 * dayMs); water(start + 16 * dayMs); assert.throws(() => run(harvest), /not_ready/);
  water(start + 17 * dayMs); assert.ok(R.gardenReady(s.inventory.garden.pot));
});

test('旧档补空花盆，带首花记录的备份往返，拒绝重复日期', () => {
  const { R, s, run, plant, water } = plot(); const old = R.empty(); delete old.garden;
  for (const inv of [old,{found:{}, placements:{}, trash:0, cleaned:0}]) assert.deepEqual(R.parseInventory(inv).garden, R.empty().garden);
  run(seed); plant(); for (let i = 0; i < 13; i++) water(start + i * dayMs);
  const backup = JSON.parse(JSON.stringify(R.exportData(s.inventory))); assert.ok(R.isBackup(backup));
  const restored = R.freshState(); R.apply(restored, R.parseCommand({op:'restore', id:'restore', rev:0, inventory:backup.inventory}));
  assert.deepEqual(restored.inventory, s.inventory);
  const p = backup.inventory.garden.pot; p.watered[1] = p.watered[0]; assert.throws(() => R.parseInventory(backup.inventory), /invalid_input/);
});

test('旧服务仍可收空花盆备份，已有种子时保留原备份', async () => {
  const { R } = plot(), older = R.empty(); delete older.garden;
  const sent = [], fetch = async (_, options) => {
    if (options.body) sent.push(JSON.parse(options.body));
    return {ok:true, json:async () => ({ok:true, initialized:true, rev:0, inventory:older})};
  };
  const { V3 } = loadV3(['58-inventory-rules','59-cabin-inventory'], {globals: {
    fetch, __CABIN_LOCAL_INVENTORY:true, document:{addEventListener() {}, querySelector() {}},
  }});
  const I = V3.cabinInventory; await I.start(); assert.equal(I.canGarden(), false);
  assert.equal((await I.perform(seed)).code, 'old_server');
  const {s,run} = plot(); run(seed);
  assert.equal((await I.restore(R.exportData(s.inventory))).code, 'old_server'); assert.equal(sent.length, 0);
  assert.ok((await I.restore(R.exportData(R.empty()))).ok); assert.equal(sent[0].inventory.garden, undefined);
});

test('海滩仍为 65 种；各种天气都能拾到五种种子，持续清滩平均几天一颗', () => {
  const { V3 } = loadV3(['03-vox','30-shells','31-moon-treasures','31-washup-catalog','59-cabin-tide','60-game'], {three:'real'});
  const {seeds,collectibles,trash} = V3.washupCatalog, settings = V3.game.S; V3.game.hosted = true;
  assert.equal(V3.game.counts().total, 65); assert.equal(seeds.length, 5);
  const tide = V3.cabinTide, random = V3.util.rng(20261121);
  for (const wx of ['clear','cloudy','overcast','fog','drizzle','rain','storm','snow']) {
    const seen = new Set(); let n = 0; const N = 150000;
    for (let i = 0; i < N; i++) {
      const k = tide.pick({wx, seeds, kinds:[collectibles[0]], trash, settings, allowTrash:true, random});
      if (k.category === 'seed') { n++; seen.add(k.id); }
    }
    assert.equal(seen.size, 5, wx);
    const days = N / n / (1440 / 7.5 * tide.chance(.5, wx) * 1.5);
    assert.ok(days > 1.5 && days < 5.5, wx + '：' + days);
  }
});
