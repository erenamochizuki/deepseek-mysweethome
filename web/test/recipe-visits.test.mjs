import assert from 'node:assert/strict';
import test from 'node:test';
import { actorCabin, fakeGame } from '../tools/lib/actor-cabin.mjs';
import { loadV3 } from '../tools/lib/v3-node.mjs';

async function kitchen(t, night = false) {
  const now = Date.parse(night ? '2026-11-25T17:00:00Z' : '2026-11-25T06:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const game = Object.assign(fakeGame([]), { auto: night, live: true });
  const c = await actorCabin(t, { game });
  c.V.PAGE = 'home';
  loadV3(['56-recipe-desk', ...(night ? ['88-cabin-night'] : []), '89-cabin-routine'], {
    core: false, three: c.T, document: c.window.document, globals: {
      V3: c.V, __READY: true, localStorage: { length: 0, getItem: () => null },
    },
  });
  c.V.nav.rebuild();
  return c;
}

test('QQ 翻阅与玩家记菜共用真实路线，抵达以后才进入翻页或书写', async t => {
  const { V, a, events, until, faces } = await kitchen(t);
  const desk = V.recipeDesk.spot(), routine = V.cabinRoutine;
  a.place(-1.5,-8,0,1);
  const request = { id: 'search-1', at: Date.now(), action: 'recipe_read' };
  routine.acceptEvents([request, request]); routine.recipeVisit(false);
  routine.recipeVisit(true);
  assert.equal(a.behavior?.phase, 'to_recipe_desk');
  for (const kind of ['recipe_read','recipe_write']) {
    routine.tick();
    until(() => a.behavior?.phase === 'action', 120);
    assert.equal(a.behavior.kind, kind);
    assert.ok(faces(a.yaw, a.pos, desk.point));
    assert.ok(Math.hypot(a.pos[0]-desk.point[0], a.pos[2]-desk.point[2]) < .85);
    until(() => !a.behavior, 20);
    assert.deepEqual(events.filter(e => e.kind === kind).map(e => e.phase), ['started','action','completed']);
  }
  routine.acceptEvents([request]);
  assert.equal(a.behavior, null);
  V.recipeDesk.spot = () => null;
  assert.equal(a.behaviorAvailability('recipe_write').reason, 'missing-furniture');
});

test('夜间睡下后收到查阅食谱，会起身走到厨房再返回床边', async t => {
  const { V, a, until } = await kitchen(t, true);
  V.cabinRoutine.tick(); until(() => a.behavior?.kind === 'sleep' && a.behavior.phase === 'action', 120);
  V.cabinRoutine.recipeVisit(false);
  until(() => !a.behavior, 3);
  V.cabinRoutine.tick();
  until(() => a.behavior?.kind === 'recipe_read' && a.behavior.phase === 'action', 120);
  until(() => !a.behavior, 20);
  V.cabinRoutine.tick();
  assert.equal(a.behavior?.kind, 'sleep');
});
