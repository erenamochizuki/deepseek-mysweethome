import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { HAND_MODELED, bbFile } from '../tools/furn-mc.mjs';

const modelApi = loadV3(['15-mcmodel']).V3.mcmodel;
const resources = new URL('../../mod/src/main/resources/assets/xiaojingyu/models/', import.meta.url);
const epsilon = 1e-7;
const dot = (left, right) => left.reduce((sum, value, axis) => sum + value * right[axis], 0);
const diff = (left, right) => left.map((value, axis) => value - right[axis]);
const cross = ([ax, ay, az], [bx, by, bz]) => [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
const unit = vector => vector.map(value => value / Math.hypot(...vector));

function surfaceConflicts(elements) {
  const surfaces = [], conflicts = [];
  for (const [index, element] of elements.entries()) {
    const quads = modelApi.bakeModel({ elements: [element], textures: {} }, {});
    for (const quad of quads) {
      const points = [0, 3, 6, 9].map(offset => Array.from(quad.pos.slice(offset, offset + 3)));
      const edges = [unit(diff(points[1], points[0])), unit(diff(points[3], points[0]))];
      const normal = unit(cross(...edges));
      for (const other of surfaces) {
        if (dot(normal, other.normal) < 1 - epsilon ||
            points.some(point => Math.abs(dot(other.normal, diff(point, other.points[0]))) > epsilon)) continue;
        const overlap = [...edges, ...other.edges].every(axis => {
          const left = points.map(point => dot(axis, point)), right = other.points.map(point => dot(axis, point));
          return Math.min(Math.max(...left), Math.max(...right)) - Math.max(Math.min(...left), Math.min(...right)) > epsilon;
        });
        if (overlap) conflicts.push([other.index, index]);
      }
      surfaces.push({ index, points, edges, normal });
    }
  }
  return conflicts;
}

test('detects the axle/barrel conflict after rotation, not flush joints or edge contact', () => {
  const cube = (from, to) => ({ from, to, faces: { east: { texture: '#0' }, west: { texture: '#0' } } });
  const axle = cube([6.3, 9.4, 6.1], [9.7, 10.7, 7.9]);
  const tube = { ...cube([6.3, 9.7, 2.6], [9.7, 11.9, 9.8]), rotation: { axis: 'x', angle: 22.5, origin: [8, 10.8, 7] } };
  assert.deepEqual(surfaceConflicts([axle, tube]), [[0, 1], [0, 1]]);
  assert.deepEqual(surfaceConflicts([axle, cube([9.7, 9.4, 6.1], [10.5, 10.7, 7.9])]), []);
  assert.deepEqual(surfaceConflicts([axle, cube([6.3, 10.7, 6.1], [9.7, 12, 7.9])]), []);
});

test('hand-modeled furniture has no overlapping outward faces in either export', () => {
  const issues = [];
  for (const folder of ['block/', 'item/']) {
    const directory = new URL(folder, resources);
    for (const file of fs.readdirSync(directory)) {
      if (!HAND_MODELED.has(file.replace(/(?:_\d+)?\.json$/, ''))) continue;
      const model = JSON.parse(fs.readFileSync(new URL(file, directory)));
      const clashes = surfaceConflicts(model.elements);
      if (clashes.length) issues.push({ model: folder + file, pairs: clashes });
    }
  }
  assert.deepEqual(issues, []);
});

test('simplified structural parts replace strips and stairs without flattening working features', () => {
  const budgets = { telescope: 20, kitchen_counter: 76, bookshelf: 40, sofa: 26, mini_fridge: 16, living_rug: 40,
    window_seat: 24, storage_chests: 18, beach_lounger: 28, beach_lounger_hat: 28 };
  for (const id of HAND_MODELED) {
    const { elements } = JSON.parse(fs.readFileSync(bbFile(id)));
    assert.ok(elements.length <= budgets[id], `${id}: ${elements.length} elements`);
    if (id.startsWith('beach_lounger')) assert.ok(elements.filter(element => Math.abs(element.rotation?.[0] ?? 0) > 20).length >= 2, `${id}: inclined back and headrest`);
    if (id === 'kitchen_counter') {
      const contains = (element, point) => point.every((value, axis) => value > element.from[axis] && value < element.to[axis]);
      assert.ok(!elements.some(element => contains(element, [24.25, 12.5, 11.5])), 'open sink basin');
      assert.ok(elements.some(element => contains(element, [24.25, 8.75, 11.5])), 'sink floor');
    }
  }
});
