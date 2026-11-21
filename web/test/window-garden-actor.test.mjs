import test from 'node:test';
import assert from 'node:assert/strict';
import { actorCabin, fakeGame } from '../tools/lib/actor-cabin.mjs';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const NOON = Date.parse('2026-11-21T03:00:00Z'); // 东京正午，洛杉矶还是 20 日
const WATER = 'garden_water';

async function garden(t) {
  let now = NOON;
  t.mock.method(Date, 'now', () => now);
  const G = fakeGame([]), inv = { shore: { gift: { zone: 'America/Los_Angeles' } }, garden: {
    zone: 'UTC', pot: { kind: 'beach_bean', plantedAt: NOON - 86400000, watered: [], by: [] },
  } };
  Object.assign(G, { live: true, auto: true, inventory: () => inv });
  const c = await actorCabin(t, { game: G }), { V, a, window } = c;
  V.PAGE = 'cabin';
  V.layout.sky = { tz: 'Asia/Tokyo' };
  loadV3(['06-env', '58-inventory-rules', '58-shell-decor', '58-window-garden', '89-cabin-routine'], { core: false, three: c.T, document: window.document,
    globals: { V3: V, __READY: true, localStorage: { length: 0, getItem: () => null, setItem() {} } } });
  const slot = V.shellDecor.gardenSill();
  const calls = [];
  V.windowGarden = { water(by) {
    calls.push({ by, pos: a.pos, phase: a.behavior?.phase, yaw: a.yaw });
    inv.garden.pot.watered.push(V.inventoryRules.gardenDay(now, V.inventoryRules.gardenZone(inv, 'Asia/Tokyo')));
    inv.garden.pot.by.push(by);
    return Promise.resolve({ ok: true, applied: true });
  } };
  return { ...c, inv, G, slot, calls, tick: V.cabinRoutine.tick, time: at => { now = at; } };
}

test('小屋正午出发，拿壶走上阁楼，面向花盆才浇一次', async t => {
  const { a, T, slot, calls, events, frames, inv, tick, time, step, until } = await garden(t);
  time(NOON - 1); tick(); assert.equal(a.behavior, null);
  time(NOON); tick(); assert.equal(a.behavior?.kind, WATER);
  assert.equal(calls.length, 0);
  const can = () => a.root.getObjectByName('girl-actor:watering-can');
  step(1);
  assert.ok(can()?.visible && !new T.Box3().setFromObject(can()).isEmpty());
  assert.ok(can().getWorldPosition(new T.Vector3()).distanceTo(a.hand()) < 0.02);
  assert.ok(a.pos[1] < 2);
  until(() => calls.length > 0, 95, '到达阁楼窗边');
  const [{ pos, by, yaw, phase }] = calls;
  assert.equal(by, 'girl'); assert.equal(phase, 'action');
  assert.ok(Math.hypot(...pos.map((v, i) => v - slot.approach[i])) < 0.16);
  const facing = Math.atan2(slot.position[0] - pos[0], slot.position[2] - pos[2]);
  assert.ok(Math.cos(yaw - facing) > .99, '朝向盆心');
  assert.ok(frames.some(f => f.kind === WATER && f.v > 0.3));
  const at = can().rotation.x; step(1); assert.notEqual(can().rotation.x, at);
  await Promise.resolve();
  until(() => !a.behavior, 8); tick();
  assert.ok(!can()?.visible); assert.equal(calls.length, 1);
  assert.deepEqual(inv.garden.pot.watered, ['2026-11-20']);
  assert.deepEqual(events.filter(e => e.kind === WATER).map(e => e.phase), ['started', 'action', 'completed']);
  assert.notEqual(a.behavior?.kind, WATER);
});

test('按固定奖励时区查浇水日，首次按小屋时区；关闭、空盆、后台、不可达都不出发', async t => {
  const { a, V, G, window, inv, tick, slot } = await garden(t);
  const pot = inv.garden.pot;
  pot.watered.push('2026-11-20'); tick(); assert.equal(a.behavior, null);
  inv.shore.gift = null; inv.garden.zone = ''; pot.watered[0] = '2026-11-21';
  tick(); assert.equal(a.behavior, null);
  pot.watered.length = 0;
  G.S.gardenHelp = false; tick(); assert.equal(a.behavior, null); G.S.gardenHelp = true;
  inv.garden.pot = null; tick(); assert.equal(a.behavior, null); inv.garden.pot = pot;
  window.document.hidden = true; tick(); assert.equal(a.behavior, null); window.document.hidden = false;
  V.gardenScene.approach = () => [999, 5, 999];
  tick(); assert.equal(a.behavior, null);
  V.gardenScene.approach = () => slot.approach; tick(); assert.equal(a.behavior?.kind, WATER);
});

test('她忙时先等，半路让私聊接手，回来时玩家已浇过就收壶', async t => {
  const { a, V, inv, calls, tick, until, events, step } = await garden(t);
  assert.ok(a.startBehavior('read')); tick(); assert.equal(a.behavior.kind, 'read');
  a.cancelBehavior(); tick(); assert.equal(a.behavior?.kind, WATER);
  V.cabinRoutine.acceptEvents([{ id: 'private-1', action: 'reply_private', at: NOON }]);
  assert.equal(a.behavior?.kind, 'reply_private');
  assert.equal(events.find(e => e.kind === WATER && e.phase === 'cancelled')?.reason, 'preempted');
  assert.equal(calls.length, 0);
  a.cancelBehavior(); tick(); assert.equal(a.behavior?.kind, WATER);
  step(1); inv.garden.pot.watered.push('2026-11-20');
  until(() => !a.behavior, 95); assert.equal(calls.length, 0);
  assert.ok(!a.root.getObjectByName('girl-actor:watering-can')?.visible);
  tick(); assert.equal(a.behavior, null);
});

test('出发后关闭帮忙、换种、进入后台或移走落脚点，均可在落水前取消', async t => {
  const { a, V, G, inv, slot, window, calls, events, tick, step, until } = await garden(t);
  const [x, y, z] = a.pos;
  for (const change of [() => { G.S.gardenHelp = false; }, () => { inv.garden.pot.plantedAt++; },
    () => { window.document.hidden = true; window.document.dispatchEvent(new Event('visibilitychange')); },
    () => { V.gardenScene.approach = () => null; }]) {
    a.place(x, z, 0, y); tick(); assert.equal(a.behavior?.kind, WATER); step(0.2);
    assert.equal(a.behavior?.phase, 'to_garden'); change();
    until(() => !a.behavior, 95); assert.equal(calls.length, 0);
    assert.equal(events.at(-1).phase, 'cancelled');
    G.S.gardenHelp = true; window.document.hidden = false; V.gardenScene.approach = () => slot.approach;
  }
});

test('请求发出后正事仍能打断，迟到的失败不碰新行为，稍后可重试', async t => {
  const { a, V, tick, time, step, until } = await garden(t);
  let settle, sends = 0;
  V.windowGarden.water = () => { sends++; return new Promise(resolve => { settle = resolve; }); };
  tick(); until(() => !!settle, 95); step(4);
  assert.equal(a.behavior?.phase, 'action');
  assert.ok(a.startBehavior('write_diary')); a.cancelBehavior();
  tick(); assert.equal(a.behavior, null);
  assert.ok(a.startBehavior('draw')); settle({ ok: false, applied: false }); await Promise.resolve();
  assert.equal(a.behavior.kind, 'draw'); a.cancelBehavior(); tick(); assert.equal(a.behavior, null);
  time(NOON + 60000); tick(); until(() => sends === 2, 95);
  settle({ ok: true, applied: true }); await Promise.resolve(); until(() => !a.behavior, 5);
});

for (const result of [{ ok: false, applied: false }, { ok: true, applied: false }]) {
  test(`浇水响应 ${JSON.stringify(result)} 时取消并收壶`, async t => {
    const { a, V, tick, until, events } = await garden(t);
    V.windowGarden.water = async () => result;
    tick(); until(() => a.behavior?.phase === 'action', 95);
    await Promise.resolve();
    assert.equal(a.behavior, null);
    assert.deepEqual(events.map(e => e.phase), ['started', 'action', 'cancelled']);
    assert.equal(events.at(-1).reason, 'water-not-applied');
    assert.ok(!a.root.getObjectByName('girl-actor:watering-can'));
  });
}

test('午饭和夜间休息优先，后台往返后可以继续照料', async t => {
  const { a, V, window, calls, tick, time } = await garden(t);
  time(NOON + 3600000); tick(); assert.equal(a.behavior?.kind, 'eat');
  a.cancelBehavior(); time(NOON); tick(); assert.equal(a.behavior?.kind, WATER);
  a.rest(true); tick(); assert.equal(a.behavior, null);
  a.rest(false); tick(); assert.equal(a.behavior?.kind, WATER);
  window.document.hidden = true; window.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(a.behavior, null); assert.equal(calls.length, 0);
  window.document.hidden = false; window.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(V.actor.behavior?.kind, WATER);
});
