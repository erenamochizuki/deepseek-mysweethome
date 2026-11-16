import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadV3 } from '../tools/lib/v3-node.mjs';

async function cabin() {
  const h = loadV3(['03-vox', '12-nbt', '13-share', '15-mcmodel', '30-shell-kit', '30-shell-m1', '30-shell-m2', '30-shells', '40-layout', '42-house-mc', '44-furn-mc'], { three: 'real' });
  const { V3: V, window } = h;
  const parts = new Map();
  V.scene = { part: p => parts.set(p.id, p) };
  h.load(['54-house-mc', '61-nav']);
  const HB = V.houseBlocks;
  const image = await readFile(new URL('../assets/house/house-v4.png', import.meta.url));
  window.__V3_ASSETS = { [V.layout.house.asset]: image.toString('base64') };
  HB.store = { get: async () => null }; // no IndexedDB or live save
  await HB.load();
  return { h, V, HB, parts, T: window.THREE };
}

const byId = (V) => new Map(V.shellDecor.slots().map((s) => [s.id, s]));
const assertNear = (a, b) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-6), `${a} != ${b}`);
const placement = (id, kind = 'dollar') => Object.freeze({ id, kind, placedAt: 1, by: 'player' });

function render({ h, V, parts, T }, placements) {
  V.game = { inventory: () => ({ placements: placements() }) };
  h.load(['58-shell-decor']);
  const ctx = { root: new T.Group(), state: { floor: 'all' } };
  V.models.current = () => ({ root: ctx.root });
  const part = parts.get('shell-decor');
  ctx.root.add(part.build(ctx));
  return { ctx, part, T };
}

function editModel(HB, edits, model = HB.model) {
  const org = HB.originOf(model), cells = model.cells.slice(), palette = model.palette.slice();
  const [W, , L] = model.size;
  for (const [world, state] of edits) {
    const [x, y, z] = world.map((v, i) => v - org[i]);
    if (!palette.includes(state)) palette.push(state);
    cells[x + z * W + y * W * L] = palette.indexOf(state);
  }
  return { ...model, cells, palette };
}

test('all four fixed anchors are on real embedded house supports and reachable on the correct storey', async () => {
  const c = await cabin(), { V, HB } = c;
  const ids = ['loft-window', 'coffee-table', 'ground-floor', 'loft-floor'];
  const inventory = Object.freeze(Object.fromEntries(ids.map((id) => [id, placement(id)])));
  const { ctx, part, T } = render(c, () => inventory), slots = byId(V);
  assert.deepEqual([...slots.keys()], ids);
  const expected = [[-6.225, 6, -11.5], [3.21875, 1.4375, -8.65625], [-5.55, 1, -8.625], [-5.55, 5, -14.625]];
  ids.forEach((id, i) => {
    const s = slots.get(id), [x, y, z] = s.approach;
    assertNear(s.position, expected[i]);
    assert.equal(s.floor, i >= 2);
    assert.equal(y, i === 0 || i === 3 ? 5 : 1);
    assert.ok(V.nav.walkable(x, z, y) && V.nav.reachable(x, z, y));
    assert.equal(V.nav.heightAt(x, z, y), y);
    const path = V.nav.path([...V.nav.home, 0], [x, z, y]);
    assertNear(path.at(-1), [x, z, y]);
  });
  assert.equal(HB.grid.at(-7, 5, -12).id, 'smooth_quartz');
  assert.equal(HB.grid.at(-7, 6, -12).id, 'glass_pane');
  assert.equal(HB.grid.at(3, 1, -9).props.part, '1');
  const model = JSON.parse(await readFile(new URL('../../mod/src/main/resources/assets/xiaojingyu/models/block/living_rug_1.json', import.meta.url), 'utf8'));
  const [tx, ty, tz] = [12.5, 7, 10.5], r = 16 * 0.19 / 2;
  assert.ok(model.elements.some(({ from, to, faces }) => faces.up && to[1] === ty && from[0] < tx-r && tx+r < to[0] && from[2] < tz-r && tz+r < to[2]));
  assert.ok(!model.elements.some(({ from, to }) => to[1] > ty && from[0] < tx+r && tx-r < to[0] && from[2] < tz+r && tz-r < to[2]));
  const objects = V.shellDecor.objects();
  assert.equal(objects.length, 4);
  for (const o of objects) {
    assert.equal(o.userData.clickable, 'shellDecor');
    const s = slots.get(o.userData.shellDecorSlot), box = new T.Box3().setFromObject(o, true);
    assertNear([box.getCenter(new T.Vector3()).x, box.min.y, box.getCenter(new T.Vector3()).z], [s.position[0], s.position[1] + 0.002, s.position[2]]);
  }
  slots.get('ground-floor').position[0] = 999;
  assertNear(byId(V).get('ground-floor').position, expected[2]);
  part.dispose(ctx);
});

test('follows rigid house rotation and the actual tabletop/window when edited', async () => {
  const c = await cabin(), { V, HB } = c;
  const inventory = Object.freeze({ 'coffee-table': placement('placed-table'), 'loft-window': placement('placed-sill') });
  const { ctx, part } = render(c, () => inventory), before = byId(V), local = HB.model;
  const p = { dx: 2, dz: 1, k: 1 };
  await HB.applyEdit(HB.placeModel(local, p), { place: p, rebuild: false });
  for (const [id, s] of byId(V)) assertNear(s.position, HB.placePoint(before.get(id).position, p));
  assert.equal(byId(V).size, 4);

  const t = HB.furnInstances('living_rug')[0], FM = V.furnMc, home = FM.homeOf(t.f);
  const away = { cell: [-4, 1, -11], facing: 'east' };
  const edits = FM.cellsFor(t.f, home.facing).map(({ offset }) => [home.cell.map((v, i) => v + offset[i]), 'minecraft:air']);
  edits.push(...FM.cellsFor(t.f, away.facing).map(({ offset, part }) => [away.cell.map((v, i) => v + offset[i]), FM.state(t.f, away.facing, part)]));
  const pane = 'minecraft:glass_pane[east=false,north=true,south=true,west=false,waterlogged=false]';
  edits.push([[-7, 6, -12], 'minecraft:smooth_quartz'], [[-7, 6, -11], 'minecraft:smooth_quartz'], [[-7, 6, -13], pane]);
  const moved = editModel(HB, edits, local);
  await HB.applyEdit(moved, { place: { dx: 0, dz: 0, k: 0 }, rebuild: false });
  const now = byId(V);
  assertNear(now.get('coffee-table').position, FM.mover(home, away).point(before.get('coffee-table').position));
  assertNear(now.get('loft-window').position, [-6.225, 6, -12.5]);
  assert.equal(V.shellDecor.objects().length, 2);

  const second = { cell: [0, 1, -11], facing: 'north' };
  const duplicate = FM.cellsFor(t.f, second.facing).map(({ offset, part }) => [second.cell.map((v, i) => v + offset[i]), FM.state(t.f, second.facing, part)]);
  await HB.applyEdit(editModel(HB, duplicate, moved), { rebuild: false });
  assert.equal(HB.furnInstances('living_rug').length, 2);
  assert.ok(!byId(V).has('coffee-table'), 'no arbitrary choice between two moved tables');
  part.dispose(ctx);
});

test('suppresses missing, blocked and cut supports without mutating inventory or freeing shared shell resources', async () => {
  const c = await cabin(), { V, HB } = c;
  const ids = ['loft-window', 'coffee-table', 'ground-floor', 'loft-floor'];
  const initial = Object.freeze(Object.fromEntries(ids.map((id) => [id, placement(id)])));
  let inventory = initial;
  const { ctx, part, T } = render(c, () => inventory);
  const byObject = () => new Map(V.shellDecor.objects().map((o) => [o.userData.shellDecorSlot, o]));
  const first = byObject();
  let disposed = 0;
  const mesh = first.get('loft-window').children[0].children[0];
  mesh.geometry.addEventListener('dispose', () => disposed++);
  mesh.material[0].addEventListener('dispose', () => disposed++);
  ctx.state.floor = 'ground';
  assert.deepEqual([...byObject().keys()], ['coffee-table', 'ground-floor']);
  assert.equal(byId(V).size, 4, 'floor view is not slot validity');
  ctx.state.floor = 'loft';
  HB.visibleAt = (x, y, z) => x !== -7;
  assert.deepEqual([...byObject().keys()], ['coffee-table', 'ground-floor', 'loft-floor']);
  HB.visibleAt = () => true;
  HB.live = () => ({ hidden: new Set(['3,1,-9']) });
  assert.ok(!byObject().has('coffee-table'), 'temporarily hidden furniture while dragging');
  HB.live = () => null;
  const camera = new T.PerspectiveCamera(); V.R = { camera };
  camera.layers.set(2);
  assert.deepEqual(V.shellDecor.objects(), []);
  camera.layers.set(0);
  assert.equal(byObject().get('loft-window'), first.get('loft-window'), 'visibility does not recreate shells');
  const original = HB.model;
  const edited = editModel(HB, [[[-7,5,-12], 'minecraft:air'], [[-7,5,-11], 'minecraft:air'], [[3,1,-9], 'minecraft:air'], [[-6,1,-9], 'minecraft:oak_planks'], [[-6,4,-15], 'minecraft:air']]);
  await HB.applyEdit(edited, { rebuild: false });
  assert.equal(byId(V).size, 0);
  assert.deepEqual(V.shellDecor.objects(), []);
  for (const o of first.values()) assert.equal(o.parent, null);
  assert.deepEqual(inventory, initial);
  await HB.applyEdit(original, { rebuild: false });
  assert.equal(V.shellDecor.objects().length, 4, 'placements reappear when supports return');
  inventory = Object.freeze({ 'loft-window': placement('new-id', 'not-a-shell') });
  assert.deepEqual(V.shellDecor.objects(), []);
  part.dispose(ctx);
  assert.deepEqual(V.shellDecor.objects(), []);
  assert.equal(disposed, 0, 'shared with beach, icons and collection cabinet');
});
