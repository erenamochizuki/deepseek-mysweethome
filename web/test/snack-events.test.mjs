// 小店 / 零食事件 detail（69-snack-events）：买卖的 detail 要带名字、味道、花费/收入、剩余贝币，
// 桥接据此生成「她看得懂」的中文。纯函数，不碰 DOM / 网络。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

function env() {
  const h = loadV3(['32-snack-catalog', '69-snack-events'], { three: 'real' });
  return h.V3;
}

test('buyDetail: 名称、口味、份数、花费、剩余贝币', () => {
  const V3 = env();
  const s = V3.snackCatalog.get('blueberry');
  const d = V3.snackEvents.buyDetail(s, 2, 8, 12);
  assert.equal(d.sku, 'blueberry');
  assert.equal(d.name, '蓝莓');
  assert.equal(d.taste, '酸酸甜甜');
  assert.equal(d.qty, 2);
  assert.equal(d.cost, 8);
  assert.equal(d.coins, 12);
});

test('sellDetail: 每种卖了几枚、总收入、剩余贝币', () => {
  const V3 = env();
  const d = V3.snackEvents.sellDetail([{ name: '扇贝', n: 2 }, { name: '织纹螺', n: 1 }], 5, 17);
  assert.deepEqual(d.kinds, [{ name: '扇贝', n: 2 }, { name: '织纹螺', n: 1 }]);
  assert.equal(d.count, 3);
  assert.equal(d.earned, 5);
  assert.equal(d.coins, 17);
});

test('eatDetail: 区分被投喂/自己吃，带名字与味道；杯装记 sip', () => {
  const V3 = env();
  const box = V3.snackEvents.eatDetail(V3.snackCatalog.get('blueberry'), 'player', 9, false);
  assert.equal(box.by, 'player');
  assert.equal(box.name, '蓝莓');
  assert.equal(box.taste, '酸酸甜甜');
  assert.equal(box.left, 9);
  const cup = V3.snackEvents.eatDetail(V3.snackCatalog.get('cocoa'), 'girl', 2, false);
  assert.equal(cup.by, 'girl');
  assert.equal(cup.pack, 'cup');
  assert.equal(cup.name, '热可可');
  assert.match(cup.taste, /可可香/);
});

test('walletDetail: 钱袋 + 零食篮（带口味）', () => {
  const V3 = env();
  const d = V3.snackEvents.walletDetail({ coins: 11, snacks: [{ sku: 'blueberry', left: 10 }, { sku: 'nori', left: 8 }] });
  assert.equal(d.coins, 11);
  assert.equal(d.snacks.length, 2);
  assert.equal(d.snacks[0].name, '蓝莓');
  assert.equal(d.snacks[0].taste, '酸酸甜甜');
  assert.equal(d.snacks[1].name, '海苔');
});
