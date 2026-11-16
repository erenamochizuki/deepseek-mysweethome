// test/a3-house-lifecycle.test.mjs — A3 P1: what the block house (54-house-mc) allocates must be released and
// unregistered when it is retired — full scene rebuilds, LRU eviction of cached variants, setHidden replace / cancel
// (布置模式拖家具), in-place reload, and builds that finish after their owner was replaced.
//   node --test test/a3-house-lifecycle.test.mjs
// Runs the real 50-scene + 54-house-mc + 16-mcmesh with the real three.js in Node (no browser, no GPU): every
// DataTexture / MeshStandardMaterial / BufferGeometry the modules create is tracked until its 'dispose' event, and
// the V3.parts registry is checked for objects that are no longer in the scene.
// A3_SRC_DIR=<dir with NN-*.js> runs the same checks against another copy of src/ (used to show they fail on the
// pre-fix files).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const srcDir = process.env.A3_SRC_DIR || undefined;
const ROOT = '小屋';
const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 8000) => {
  for (const t0 = Date.now(); !fn();) { if (Date.now() - t0 > ms) assert.fail('timed out waiting for ' + what); await sleep(2); }
};

// 8 × 5 × 3 house: stone floor, two doors (2 cells each), two hanging lanterns under a stone, one loose block to "drag"
const DRAG = [3, 1, 1];
function houseModel() {
  const size = [8, 5, 3], cells = new Int32Array(8 * 5 * 3), at = (x, y, z) => x + z * 8 + y * 24;
  const palette = ['minecraft:air', 'minecraft:stone',
    'minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]',
    'minecraft:oak_door[facing=north,half=upper,hinge=left,open=false,powered=false]',
    'minecraft:lantern[hanging=true,waterlogged=false]', 'minecraft:oak_planks'];
  for (let z = 0; z < 3; z++) for (let x = 0; x < 8; x++) cells[at(x, 0, z)] = 1;
  for (const x of [1, 5]) { cells[at(x, 1, 1)] = 2; cells[at(x, 2, 1)] = 3; }
  for (const x of [2, 6]) { cells[at(x, 3, 1)] = 4; cells[at(x, 4, 1)] = 1; }
  cells[at(...DRAG)] = 5;
  return { size, cells, palette, offset: [0, 0, 0] };
}

// count what the modules allocate through THREE.<Class> until it is disposed
function track(T) {
  const live = { tex: new Set(), mat: new Set(), geo: new Set() }, made = { tex: 0, mat: 0, geo: 0 }, twice = { tex: 0, mat: 0, geo: 0 };
  for (const [name, kind] of [['DataTexture', 'tex'], ['MeshStandardMaterial', 'mat'], ['BufferGeometry', 'geo']]) {
    const Orig = T[name];
    T[name] = class extends Orig {
      constructor(...a) { super(...a); made[kind]++; live[kind].add(this); this.addEventListener('dispose', () => { if (!live[kind].delete(this)) twice[kind]++; }); }
    };
    assert.notEqual(T[name], Orig, 'THREE.' + name + ' can be wrapped');
  }
  return { live, made, twice };   // twice: dispose() calls on something already disposed
}

function load() {
  const h = loadV3(['15-mcmodel', '16-mcmesh', '17-mcfallback'], { three: 'real', srcDir });
  const V = h.V3, T = h.window.THREE;
  V.layout = { house: { x0: -3, x1: 11, z0: -3, z1: 6, floorY: 0, loftY: 4, eaveY: 7, stand: [0, 0, 0] }, openings: [] };
  V.R = { scene: new T.Scene(), camera: { position: new T.Vector3(12, 8, 12) }, renderer: { toneMappingExposure: 1 } };
  const model = houseModel();
  V.houseMc = { build: () => ({ model }) };
  h.load(['50-scene', '54-house-mc']);
  V.houseBlocks.store.get = async () => null;
  V.scene.fallbackK = 1;
  // gate: hold the next mesh build after it has done its work, until the test lets it finish
  const real = V.mcmesh.build, gate = { next: null };
  V.mcmesh.build = (...a) => {
    const g = gate.next; gate.next = null;
    const p = real(...a);
    return g ? p.then(async (r) => { g.reached.resolve(); await g.release.promise; return r; }) : p;
  };
  const holdNext = () => (gate.next = { reached: Promise.withResolvers(), release: Promise.withResolvers() });
  return { h, V, T, HB: V.houseBlocks, model, tracker: track(T), holdNext };
}
// only the house part, on a bare root (like test/house-switches.test.mjs)
async function partFixture() {
  const f = load(), { V, T } = f;
  const root = new T.Group(), ctx = V.scene.ctx(root), part = V.scene.parts.find((p) => p.id === 'house');
  const house = part.build(ctx); root.add(house);
  const me = house.userData.houseMc;
  await me.ready;
  assert.equal(f.HB.error, null);
  return { ...f, root, ctx, part, me, top: root };
}
// the whole 'house2' model through V3.models.show (50-scene's build / dispose and 00-core's swap)
async function sceneFixture() {
  const f = load(), { V, T } = f;
  V.models.register({ id: 'empty', build: () => ({ root: new T.Group(), partRoot: 'empty' }) });
  V.models.show('house2');
  assert.equal(await V.waitReady(V.models.current()), true);
  assert.equal(f.HB.error, null);
  return { ...f, top: V.R.scene };
}

const topOf = (o) => { while (o.parent) o = o.parent; return o; };
// same members? (counts only in the message: assert.deepEqual on Sets of three.js objects would print megabytes of typed arrays)
function sameSet(got, want, what) {
  let extra = 0, missing = 0;
  for (const x of got) if (!want.has(x)) extra++;
  for (const x of want) if (!got.has(x)) missing++;
  assert.ok(!extra && !missing, what + ' — ' + extra + ' not owned by the live house (leaked), ' + missing + ' owned but gone; have ' + got.size + ', expected ' + want.size);
}
// every mesh group the live house owns: cached variants, variants waiting to be thrown away, doors, lanterns
function owned(me) {
  const gs = [];
  for (const v of me.cache.values()) if (v.g) gs.push(v.g);
  for (const v of me.stale || []) if (v.g) gs.push(v.g);
  for (const d of me.doors) gs.push(d.closed, d.open);
  for (const lp of me.lanterns) gs.push(lp.g);
  return gs;
}
// the invariants: nothing registered that is not in the scene, nothing registered twice, and every live GPU-side
// object belongs to a group the live house still owns (me = null: no house at all). opts.gpu === false: registry only
function audit(f, me, where, opts = {}) {
  const { V, tracker: { live }, top } = f, items = V.parts.objects(ROOT), gs = me ? owned(me) : [];
  const detached = items.filter((it) => topOf(it.obj) !== top);
  assert.equal(detached.length, 0, where + ': ' + detached.length + ' of ' + items.length + ' registered objects are not in the scene (' +
    [...new Set(detached.map((it) => it.obj.name))].join(', ') + ')');
  assert.equal(new Set(items.map((it) => it.obj)).size, items.length, where + ': an object is registered twice');
  const parts = gs.flatMap((g) => g.children);
  sameSet(new Set(items.map((it) => it.obj)), new Set(parts), where + ': registry = the part groups of the owned meshes');
  for (const g of gs) assert.equal(topOf(g), top, where + ': an owned group is not in the scene');
  if (opts.gpu === false) return { registered: items.length, groups: gs.length };
  sameSet(live.tex, new Set(gs.map((g) => g.userData.tex)), where + ': live atlas textures = one per owned group');
  sameSet(live.mat, new Set(gs.flatMap((g) => Object.values(g.userData.mats))), where + ': live materials = the layer materials of owned groups');
  const geos = new Set(); for (const g of gs) g.traverse((o) => { if (o.geometry) geos.add(o.geometry); });
  sameSet(live.geo, geos, where + ': live geometries = the meshes of owned groups');
  assert.deepEqual(f.h.window.__errors, [], where + ': page errors');
  return { registered: items.length, groups: gs.length };
}
const visibleVariants = (me) => [...me.cache.values()].filter((v) => v.g && v.g.visible).length + (me.stale || []).filter((v) => v.g && v.g.visible).length;
const tris = (g) => { let n = 0; g.traverse((o) => { if (o.geometry) n += o.geometry.index.count / 3; }); return n; };

test('teardown of the house part releases every cached variant (atlas, layer materials, geometry) and unregisters it', async () => {
  const f = await partFixture(), { me, part, tracker } = f;
  await me.setFloor('ground'); await me.setFloor('loft'); await me.setFloor('all');
  assert.equal(me.cache.size, 3, 'three cached variants (外观 / 一楼 / 阁楼)');
  const a = audit(f, me, 'before teardown');
  assert.equal(a.groups, 3 + 2 * 2 + 2, '3 variants + 2 doors × (open, closed) + 2 lanterns');
  assert.ok(a.registered > 0 && tracker.live.tex.size === 9);
  part.dispose();
  assert.deepEqual([tracker.live.tex.size, tracker.live.mat.size, tracker.live.geo.size], [0, 0, 0], 'released synchronously, before the scene-wide sweep runs');
  assert.equal(me.root.children.length, 0, 'nothing left under the house root for the sweep to dispose a second time');
  assert.equal(me.cache.size, 0);
  assert.equal(f.V.parts.objects(ROOT).length, 0);
  assert.ok(f.V.parts.list(ROOT).includes(ROOT + '/屋顶'), 'declared paths survive (P.reset is the owner model\'s job)');
  audit(f, null, 'after teardown');
});

test('repeated full rebuilds (HB.rebuildScene / HB.applyEdit → V3.models.show) do not accumulate textures, materials or registry entries', async () => {
  const f = await sceneFixture(), { V, HB, tracker } = f;
  // look at two storeys so the house being replaced always holds two cached variants (the shown one and a hidden one)
  const twoFloors = async () => {
    for (const v of ['all', 'ground']) { V.setState('floor', v); assert.equal(await V.waitReady(V.models.current()), true); }
    assert.equal(HB.live().cache.size, 2);
  };
  await twoFloors();
  const first = audit(f, HB.live(), 'first house');
  assert.equal(first.groups, 2 + 2 * 2 + 2);
  const made0 = { ...tracker.made };
  for (let i = 1; i <= 4; i++) {
    const old = HB.live();
    assert.equal(i % 2 ? await HB.rebuildScene() : await HB.applyEdit(HB.model), true);
    const me = HB.live();
    assert.notEqual(me, old); assert.equal(old.dead, true);
    assert.equal(old.root.children.length, 0, 'rebuild ' + i + ': the old house root is empty');
    assert.equal(V.getState().floor, 'ground', 'the storey is carried over');
    audit(f, me, 'rebuild ' + i);
    await twoFloors();
    assert.deepEqual(audit(f, me, 'rebuild ' + i + ', two storeys'), first, 'rebuild ' + i + ': same counts as the first house');
  }
  assert.ok(tracker.made.tex >= made0.tex + 4 * first.groups, 'each rebuild really allocated a new set');
  V.models.show('empty'); await sleep();
  assert.equal(HB.live(), null);
  audit(f, null, 'after the house model is replaced');
  assert.deepEqual(V.parts.list(ROOT), []);
  assert.deepEqual(tracker.twice, { tex: 0, mat: 0, geo: 0 }, 'the house and the scene-wide sweep (50-scene dispose) never dispose the same object twice');
});

test('LRU eviction of cached variants unregisters the evicted ones', async () => {
  const f = await partFixture(), { me, V } = f, cam = V.R.camera.position, seen = new Set();
  for (const floor of ['ground', 'loft']) {
    await me.setFloor(floor);
    for (let k = 0; k < 8; k++) {
      cam.set(4 + 20 * Math.sin(k * Math.PI / 4), 8, 1.5 + 20 * Math.cos(k * Math.PI / 4));
      me.tick();
      const want = me.want;
      await until(() => me.shown === want, 'variant ' + want);
      seen.add(want);
    }
  }
  assert.equal(seen.size, 16, 'eight wall-facing combinations per storey');
  assert.ok(me.cache.size <= 10, 'cache is capped (' + me.cache.size + ')');
  assert.equal(visibleVariants(me), 1);
  const a = audit(f, me, 'after 17 variants');
  assert.equal(a.groups, me.cache.size + 6);
  f.part.dispose();
  audit(f, null, 'after teardown');
});

test('setHidden replace / cancel / back-to-back calls retire the replaced variants (drag and drop in 布置模式)', async () => {
  const f = await partFixture(), { me } = f;
  await me.setFloor('ground'); await me.setFloor('all');
  const full = tris(me.cache.get(me.shown).g), base = audit(f, me, 'before drag');
  await me.setHidden([DRAG]);
  assert.equal(me.cache.size, 1); assert.equal(visibleVariants(me), 1);
  assert.ok(tris(me.cache.get(me.shown).g) < full, 'the dragged block is not in the new mesh');
  const hid = audit(f, me, 'while dragging');
  assert.equal(hid.groups, base.groups - 1, 'both old variants are gone, one new one');
  await me.setHidden(null);
  assert.equal(tris(me.cache.get(me.shown).g), full);
  const back = audit(f, me, 'after cancel');
  assert.deepEqual(back, { groups: hid.groups, registered: hid.registered + 1 }, 'one variant again, with the part group of the dragged block back');
  // grab and release before the first re-mesh is done
  const a = me.setHidden([DRAG]), b = me.setHidden(null);
  await Promise.all([a, b]);
  assert.equal(me.cache.size, 1); assert.equal(visibleVariants(me), 1);
  assert.equal(tris(me.cache.get(me.shown).g), full);
  assert.deepEqual(audit(f, me, 'after grab + release'), back);
  const c = me.setHidden([DRAG]), d = me.setHidden([DRAG, [2, 0, 0]]);
  await Promise.all([c, d]);
  assert.equal(visibleVariants(me), 1);
  assert.ok(tris(me.cache.get(me.shown).g) < full);
  assert.deepEqual(audit(f, me, 'after two different hides'), hid);
  f.part.dispose();
  audit(f, null, 'after teardown');
});

test('a slow build superseded by a full rebuild is thrown away without touching the new registry; dead owners ignore queued calls', async () => {
  const f = await sceneFixture(), { V, HB, holdNext } = f;
  const old = HB.live(), g = holdNext();
  const pending = old.setFloor('ground');            // starts a variant build that we keep hanging
  await g.reached.promise;
  V.models.show('house2');                           // full rebuild while the old house is still meshing
  assert.equal(await V.waitReady(V.models.current()), true);
  const me = HB.live();
  assert.notEqual(me, old);
  // registry first, on its own: the late build must not put its parts into the registry that V3.models.show just reset
  const fresh = audit(f, me, 'new house, old build still pending', { gpu: false });
  g.release.resolve(); await pending; await sleep();
  assert.equal(old.root.children.length, 0, 'the late mesh was not added to the dead house');
  assert.deepEqual(audit(f, me, 'after the superseded build finished', { gpu: false }), fresh);
  assert.deepEqual(audit(f, me, 'after the superseded build finished (textures, materials, geometry)'), fresh);
  // continuations queued on the dead owner (69-arrange / 50-scene may still hold it)
  await old.setFloor('loft'); await old.setHidden([DRAG]); await old.setHidden(null); await old.reload(); await sleep();
  assert.equal(old.root.children.length, 0);
  assert.equal(old.cache.size, 0, 'a dead house does not start new builds');
  assert.deepEqual(audit(f, me, 'after calls on the dead owner'), fresh);
  V.models.show('empty'); await sleep();
  audit(f, null, 'end');
});

test('a build superseded by an in-place reload, and a house torn down before its first mesh, leave nothing behind', async () => {
  const f = await partFixture(), { me, holdNext } = f;
  const base = audit(f, me, 'ready');
  const g = holdNext(), pending = me.setFloor('ground');
  await g.reached.promise;
  const again = me.reload();                         // 换贴图：原地重画
  g.release.resolve(); await pending; await again; await me.setFloor('all'); await sleep();
  assert.equal(me.cache.size, 2);
  assert.equal(audit(f, me, 'after reload').groups, base.groups + 1);
  f.part.dispose();
  audit(f, null, 'after teardown');

  const f2 = load(), root = new f2.T.Group(), ctx = f2.V.scene.ctx(root), part = f2.V.scene.parts.find((p) => p.id === 'house');
  const g2 = f2.holdNext(), house = part.build(ctx); root.add(house);
  const me2 = house.userData.houseMc;
  await g2.reached.promise;
  part.dispose();                                    // 第一份网格还没画完就拆了
  g2.release.resolve(); await me2.ready; await sleep();
  assert.equal(me2.root.children.length, 0);
  audit({ ...f2, top: root }, null, 'torn down while meshing');
});
