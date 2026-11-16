// A3 (P2) disposal repairs, driven through the real modules and the vendored three (no browser, no build):
//  - 55-photo-frames: a refresh frees the quad geometry of the frame groups it detaches (and nothing that is shared);
//  - 59-sealife / 63-footprints: the owning part hook disposes its InstancedMesh, which is what makes three release the
//    mesh-owned instanceMatrix / instanceColor buffers (the scene sweep in 50-scene only frees geometry and material).
// What Node cannot show: the GPU buffers themselves. The tests pin the 'dispose' events three's renderer listens to.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadV3, VENDOR_THREE } from '../tools/lib/v3-node.mjs';

// Count 'dispose' events per three object (geometry / material / texture / mesh).
function counter() {
  const n = new Map();
  return {
    watch(o) { if (!n.has(o)) { n.set(o, 0); o.addEventListener('dispose', () => n.set(o, n.get(o) + 1)); } return o; },
    of: (o) => n.get(o),
    seen: (o) => n.has(o),
    all: () => [...n.keys()],
  };
}
// Same sweep as the scene model's dispose (50-scene.js): every geometry and every non-shared material under the root.
function sceneSweep(root) {
  const geos = new Set(), mats = new Set();
  root.traverse((m) => {
    if (m.geometry) geos.add(m.geometry);
    const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const x of ms) if (!(x.userData && x.userData.shared)) mats.add(x);
  });
  for (const g of geos) g.dispose();
  for (const x of mats) x.dispose();
}

test('vendored three: InstancedMesh.dispose() is the event the renderer uses to free instance buffers', () => {
  const { window } = loadV3([], { three: 'real' }), T = window.THREE;
  const mesh = new T.InstancedMesh(new T.BufferGeometry(), new T.MeshBasicMaterial(), 2);
  let fired = 0; mesh.addEventListener('dispose', () => fired++);
  mesh.dispose();
  assert.equal(fired, 1);
  // WebGLObjects: the 'dispose' listener it puts on an instanced mesh removes instanceMatrix and instanceColor.
  const src = fs.readFileSync(VENDOR_THREE, 'utf8');
  assert.match(src, /removeEventListener\("dispose",\w+\),\w+\.remove\(\w+\.instanceMatrix\),null!==\w+\.instanceColor&&\w+\.remove\(\w+\.instanceColor\)/);
  assert.match(src, /isInstancedMesh&&\(!1===\w+\.hasEventListener\("dispose",\w+\)&&\w+\.addEventListener\("dispose",\w+\)/);
});

// ---- 55-photo-frames ----
// A 128 × 128 PNG as far as V3.photos.check looks (signature + IHDR); the tail makes each photo a different one.
function fakePng(tag) {
  const b = new Uint8Array(40);
  b.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 128, 0, 0, 0, 128, 8, 2, 0, 0, 0]);
  b[39] = tag;
  return b;
}
function photoScene() {
  const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {} }) });
  const h = loadV3(['44-furn-mc', '45-photos'], {
    three: 'real',
    document: { createElement: fakeCanvas },                       // 55 decodes a photo onto a canvas
    globals: { createImageBitmap: async () => ({ close() {} }) },
  });
  const { V3, window } = h, P = V3.photos, parts = new Map();
  V3.scene = { part: (p) => parts.set(p.id, p) };
  const frameCell = [0, 0, 0], wallCell = [2, 0, 0];
  const HB = V3.houseBlocks = {
    originOf: () => [0, 0, 0], visibleAt: () => true, whenGrid: (ctx, fn) => fn(),
    model: { size: [3, 1, 1], offset: [0, 0, 0], cells: Int32Array.of(1, 0, 2), blockEntities: [],
      palette: ['minecraft:air', P.FRAME + '[facing=north]', P.WALL + '[facing=north,part=0]'] },
  };
  h.load(['55-photo-frames']);
  const photo = (tag) => P.make(fakePng(tag), 'p' + tag, 0);
  // What the album does (68-album → 54-house-mc HB.setEntities): new block entities, then 'house:entities'.
  const put = async (cell, slot, p) => { HB.model = P.setSlot(HB.model, cell, slot, p); V3.emit('house:entities'); await V3.photoFrames.whenReady(); };
  return { V3, T: window.THREE, window, P, HB, part: parts.get('photo-frames'), photo, put, frameCell, wallCell };
}

test('photo frames: every refresh disposes the quad geometry it detaches, and only that', async () => {
  const { V3, window, HB, P, part, photo, put, frameCell, wallCell } = photoScene();
  const A = photo(1), B = photo(2), C = photo(3);
  HB.model = P.setSlot(P.setSlot(HB.model, frameCell, 0, A), wallCell, 1, A);
  const ctx = { dead: false }, root = part.build(ctx), me = V3.photoFrames.live(), PF = V3.photoFrames;
  assert.equal(await PF.whenReady(), true);
  const geos = counter(), mats = counter(), texs = counter();
  const quads = () => { const out = []; root.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };
  const track = () => { for (const m of quads()) { geos.watch(m.geometry); if (m.name === 'photo-plane') { mats.watch(m.material); texs.watch(m.material.map); } } };
  mats.watch(me.pickMat);
  track();
  // 1 frame + 6 wall slots → 7 pick quads; photo A shows in the frame and in wall slot 1 → 2 photo quads.
  assert.equal(quads().filter((m) => m.name === 'photo-pick').length, 7);
  assert.equal(quads().filter((m) => m.name === 'photo-plane').length, 2);
  const matA = quads().find((m) => m.name === 'photo-plane').material, texA = matA.map;

  let previous = quads().map((m) => m.geometry);
  const edits = [[wallCell, 0, B], [wallCell, 0, C], [frameCell, 0, B], [wallCell, 2, C], [wallCell, 0, null], [frameCell, 0, null], [frameCell, 0, C]];
  for (const [cell, slot, p] of edits) {
    await put(cell, slot, p);
    for (const g of previous) assert.equal(geos.of(g), 1, 'geometry of a detached frame group is disposed exactly once');
    track();
    const now = quads().map((m) => m.geometry);
    for (const g of now) assert.equal(geos.of(g), 0, 'geometry still in the scene is not disposed');
    assert.equal(geos.all().filter((g) => geos.of(g) === 0).length, now.length, 'no undisposed geometry outside the scene');
    assert.equal(mats.of(me.pickMat), 0, 'the shared pick material survives a refresh');
    previous = now;
  }
  // Photo A is still on the wall (slot 1): its material and texture are shared by Id and must have survived every refresh.
  const stillA = quads().filter((m) => m.name === 'photo-plane' && m.material === matA);
  assert.equal(stillA.length, 1);
  assert.equal(mats.of(matA), 0); assert.equal(texs.of(texA), 0);
  // Photo B is gone from every frame: the existing owners released its material and (async) its texture.
  const goneB = mats.all().filter((m) => m !== me.pickMat && m !== matA && mats.of(m) === 1);
  assert.ok(goneB.length >= 1, 'an unused photo material is still released by its existing owner');
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(texs.all().some((t) => texs.of(t) === 1), 'an unused photo texture is still released by its existing owner');

  // Scene teardown: the part hook frees the shared materials; the geometry still attached is the scene sweep's job.
  ctx.dead = true; part.dispose(ctx);
  assert.equal(mats.of(me.pickMat), 1);
  for (const g of previous) assert.equal(geos.of(g), 0);
  sceneSweep(root);
  for (const g of geos.all()) assert.equal(geos.of(g), 1, 'each quad geometry is disposed exactly once over the whole life of the scene');
  assert.deepEqual(window.__errors, []);
});

test('photo frames: a refresh after the scene is dead leaves the detached scene alone', async () => {
  const { V3, HB, P, part, photo, frameCell } = photoScene();
  HB.model = P.setSlot(HB.model, frameCell, 0, photo(7));
  const ctx = { dead: false }, root = part.build(ctx);
  await V3.photoFrames.whenReady();
  const geos = counter(); root.traverse((o) => { if (o.geometry) geos.watch(o.geometry); });
  ctx.dead = true; V3.emit('house:entities');
  for (const g of geos.all()) assert.equal(geos.of(g), 0);
  part.dispose(ctx);
});

// ---- 59-sealife / 63-footprints ----
function beach() {
  const h = loadV3(['03-vox', '04-atlas', '05-blocks', '40-layout'], { three: 'real' });
  const { V3, window } = h, T = window.THREE, parts = new Map();
  V3.scene = { part: (p) => parts.set(p.id, p) };
  h.load(['52-terrain', '59-sealife', '63-footprints']);
  const ctx = { rng: (seed) => { let s = 0; for (const c of String(seed)) s = Math.imul(s ^ c.charCodeAt(0), 16777619); return V3.util.rng(s >>> 0); } };
  return { V3, T, window, parts, ctx };
}

test('sealife: the fish InstancedMeshes are disposed by the part hook; geometry and the shared material are not', () => {
  const { V3, T, window, parts, ctx } = beach();
  const part = parts.get('sealife'), root = new T.Group();
  // The kelp needs the block atlas (a canvas): keep that module out of this Node run, the fish do not depend on it.
  V3.blocks.material = () => new T.MeshBasicMaterial();
  V3.atlas.uv = () => [0, 0, 1, 1];
  for (const o of part.build(ctx)) root.add(o);
  assert.deepEqual(window.__errors, []);
  const fish = []; root.traverse((o) => { if (o.isInstancedMesh) fish.push(o); });
  assert.deepEqual(fish.map((m) => m.name).sort(), ['sealife:bluetang', 'sealife:clownfish']);
  assert.ok(fish.every((m) => m.count > 0 && m.instanceMatrix.count >= m.count), 'the schools found their corals');
  const n = counter();
  for (const m of fish) { n.watch(m); n.watch(m.geometry); n.watch(m.material[0]); }
  part.update(0.016, 1, ctx);
  part.dispose(ctx);
  for (const m of fish) {
    assert.equal(n.of(m), 1, m.name + ': InstancedMesh.dispose() releases its instance buffers');
    assert.equal(n.of(m.geometry), 0, 'geometry is left to the scene sweep');
    assert.equal(n.of(m.material[0]), 0, 'the shared voxel material is not disposed');
  }
  assert.equal(fish[0].material[0].userData.shared, true);
  sceneSweep(root);
  for (const m of fish) { assert.equal(n.of(m), 1); assert.equal(n.of(m.geometry), 1); assert.equal(n.of(m.material[0]), 0); }
  // A second scene builds new meshes; the hook of the first one must not have left anything pointing at the old ones.
  const again = part.build(ctx).filter((o) => o.isInstancedMesh);
  assert.equal(again.length, 2);
  assert.ok(again.every((m) => !fish.includes(m)));
  part.update(0.016, 2, ctx);
  part.dispose(ctx);
  for (const m of fish) assert.equal(n.of(m), 1, 'an old mesh is not disposed twice');
  assert.deepEqual(window.__errors, []);
});

test('footprints: the InstancedMesh is disposed by the part hook; the shared foot texture, geometry and material are not', () => {
  const { V3, T, window, parts, ctx } = beach();
  const part = parts.get('footprints'), F = V3.footprints;
  const M = part.build(ctx), root = new T.Group(); root.add(M);
  assert.equal(M.isInstancedMesh, true);
  assert.equal(M.instanceMatrix.count, 300);
  const tex = M.material.uniforms.uMap.value, n = counter();
  for (const o of [M, M.geometry, M.material, tex]) n.watch(o);
  assert.equal(tex.userData.shared, true);
  // somewhere on dry sand
  let placed = -1;
  for (let z = 0; z < 30 && placed < 0; z += 0.5) placed = F.step(0.3, z, 0, 'L');
  assert.ok(placed >= 0, 'a footprint lands on the sand');
  part.update(1);
  assert.equal(F.count(), 1);
  part.dispose(ctx);
  assert.equal(n.of(M), 1, 'InstancedMesh.dispose() releases instanceMatrix');
  assert.deepEqual([n.of(M.geometry), n.of(M.material), n.of(tex)], [0, 0, 0]);
  assert.equal(F.step(0.3, 5, 0, 'R'), -1, 'no footprints once the part is gone');
  assert.equal(F.count(), 0);
  part.dispose(ctx);                                                // a second teardown is harmless
  assert.equal(n.of(M), 1);
  sceneSweep(root);
  assert.deepEqual([n.of(M), n.of(M.geometry), n.of(M.material), n.of(tex)], [1, 1, 1, 0]);
  // The next scene gets its own mesh and reuses the shared texture.
  const M2 = part.build(ctx);
  assert.notEqual(M2, M);
  assert.equal(M2.material.uniforms.uMap.value, tex);
  part.dispose(ctx);
  assert.deepEqual(window.__errors, []);
});
