// test/a3-parts-registry.test.mjs — 00-core.js: V3.parts.untag (unregister by identity) and the cached V3.util.qs.
//   node --test test/a3-parts-registry.test.mjs
// A3_SRC_DIR=<dir with NN-*.js> runs the same checks against another copy of src/ (used to show they fail on the
// pre-fix files).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const srcDir = process.env.A3_SRC_DIR || undefined;

test('V3.parts.untag removes only the given object (and its subtree); paths, labels and other objects stay', () => {
  const h = loadV3([], { three: 'real', srcDir }), P = h.V3.parts, T = h.window.THREE;
  assert.equal(typeof P.untag, 'function');
  P.declare(['屋', '屋/墙', '屋/门', '屋/窗'], { '屋/墙': '外墙' });
  const mk = () => {
    const root = new T.Group(), wall = new T.Group(), door = new T.Group(), mesh = new T.Mesh();
    mesh.userData.faceTags = ['屋/窗', null, '屋/墙'];
    wall.add(mesh); root.add(wall, door);
    P.tag(wall, '屋/墙'); P.tag(door, '屋/门'); P.tagFaces(mesh);
    return { root, wall, door, mesh };
  };
  const a = mk(), b = mk(), other = P.tag(new T.Group(), '别处/东西');
  const before = { list: P.list(), tree: JSON.stringify(P.tree()) };
  assert.equal(P.objects('屋').length, 8);

  assert.equal(P.untag(a.root), 4, 'wall + door + two face tags of variant a');
  const left = P.objects('屋');
  assert.equal(left.length, 4);
  assert.ok(left.every(it => [b.wall, b.door, b.mesh].includes(it.obj)), 'only variant b is still registered');
  assert.deepEqual(P.objects('屋/窗').map(it => [it.obj === b.mesh, it.tagIndex]), [[true, 0]]);
  assert.deepEqual(P.objects('屋/墙').map(it => it.tagIndex).sort(), [-1, 2]);
  assert.equal(P.find('屋/门'), b.door, 'the anchor fallback no longer returns the retired object');
  assert.deepEqual(P.list(), before.list, 'paths (declared or not) are kept, in the same order');
  assert.equal(JSON.stringify(P.tree()), before.tree);
  assert.equal(P.label('屋/墙'), '外墙');
  assert.deepEqual(P.objects('别处').map(it => it.obj), [other], 'other roots are untouched');
  assert.ok(!P.pickables().includes(a.mesh) && P.pickables().includes(b.mesh));

  assert.equal(P.untag(a.root), 0, 'second untag is a no-op');
  assert.equal(P.untag(new T.Group()), 0);
  assert.equal(P.untag(null), 0);
  assert.equal(a.wall.userData.part, '屋/墙', 'userData.part is left alone');

  // deep: false → just that object, not what hangs below it
  assert.equal(P.untag(b.wall, { deep: false }), 1);
  assert.deepEqual(P.objects('屋/墙').map(it => [it.obj === b.mesh, it.tagIndex]), [[true, 2]]);
  assert.equal(P.untag(b.root), 3);
  assert.equal(P.objects('屋').length, 0);
  assert.deepEqual(P.list('屋'), ['屋', '屋/墙', '屋/门', '屋/窗'], 'declarations survive an empty registry');

  // a retired object can be registered again; P.reset still clears by path
  P.tag(a.door, '屋/门');
  assert.deepEqual(P.objects('屋/门').map(it => it.obj), [a.door]);
  P.reset('屋');
  assert.deepEqual(P.list('屋'), []);
  assert.deepEqual(h.window.__errors, []);
});

test('V3.util.qs parses location.search once per distinct string, same answers as before', () => {
  let made = 0;
  class Counting extends URLSearchParams { constructor(...a) { super(...a); made++; } }
  const h = loadV3([], { url: 'http://localhost/cabin.html?time=night&nopost=1&empty=&a=1&a=2', globals: { URLSearchParams: Counting }, srcDir });
  const U = h.V3.util, loc = h.window.location;
  const atLoad = made;                       // 00-core reads ?solo while loading
  assert.ok(atLoad <= 1);
  for (let i = 0; i < 500; i++) {
    assert.equal(U.qs('time', 'golden'), 'night');
    assert.equal(U.qs('nopost'), '1');
    assert.equal(U.qs('wx', 'clear'), 'clear');
  }
  assert.equal(U.qs('empty', 'def'), '', 'present but empty is not the default');
  assert.equal(U.qs('a'), '1', 'first value wins, like URLSearchParams.get');
  assert.equal(U.qs('missing'), undefined);
  assert.equal(U.qs('missing', null), null);
  assert.equal(made, 1, 'one URLSearchParams for 1500+ calls on an unchanged query');

  // the query changed without a reload (history.replaceState in a page): picked up on the next call
  loc.search = '?time=dawn';
  assert.equal(U.qs('time', 'golden'), 'dawn');
  assert.equal(U.qs('nopost', '0'), '0');
  assert.equal(made, 2);
  loc.search = '';
  for (let i = 0; i < 100; i++) assert.equal(U.qs('time', 'golden'), 'golden');
  assert.equal(made, 3);
});
