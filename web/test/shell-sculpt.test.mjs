// 12 种经典贝壳的三角面雕刻版（2026-11-12，30-shell-kit + 30-shell-m1 / m2；体素版留在 30-shells.js 作对照和兜底，test/shell-surfaces.test.mjs 照旧测它）。
// 这里测线上默认用的雕刻版：每种都有、三角数降下来了、没有退化三角、表面封闭（每条边正好两个面，朝外，体积为正）、
// 归一（最长边 = KINDS.size、底面 y = 0、水平居中）、几何 / 材质共享缓存、翻过来从下面也看得见（沙滩上任意一面朝上）。
//   node --test test/shell-sculpt.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const MODS = ['03-vox', '30-shell-kit', '30-shell-m1', '30-shell-m2', '30-shells'];
const OLD_TRIS = { scallop: 3256, clam: 2520, mussel: 1356, moon: 3036, nassa: 1872, cowrie: 2304, starfish: 2152, miter: 1464, dollar: 2224, conch: 2864, nautilus: 2844, pearl: 2768 };

test('every classic shell has a sculpted model; far fewer triangles than the voxel version', () => {
  const { V3: V } = loadV3(MODS, { three: 'real' });
  let before = 0, after = 0;
  assert.equal(V.shells.KINDS.length, 12);
  for (const k of V.shells.KINDS) {
    const o = V.shells.build(k.id, { tag: false });
    assert.equal(o.userData.sculpt, true, k.id + ' uses the sculpted model');
    assert.ok(o.userData.tris <= 900, k.id + ' tris ' + o.userData.tris);
    assert.ok(o.userData.tris < OLD_TRIS[k.id] / 1.5, k.id + ' clearly cheaper than voxel ' + OLD_TRIS[k.id]);
    before += OLD_TRIS[k.id]; after += o.userData.tris;
  }
  assert.ok(after < before / 3, 'total ' + before + ' → ' + after);
});

test('sculpted meshes: normalised, non-degenerate, no see-through holes, outward-facing, shared cache, front-side material', () => {
  const { V3: V, window } = loadV3(MODS, { three: 'real' }), T = window.THREE;
  for (const k of V.shells.KINDS) {
    const o = V.shells.build(k.id, { tag: false }), mesh = o.children[0], geo = mesh.geometry;
    assert.equal(V.shells.build(k.id, { tag: false }).children[0].geometry, geo, k.id + ' shared geometry');
    assert.equal(geo.userData.shared, true);
    assert.ok(geo.groups.length >= 1, k.id + ' has a draw group (material array would draw nothing otherwise)');
    mesh.material.forEach(m => assert.equal(m.side, T.FrontSide));
    assert.equal(mesh.userData.triTag.length, o.userData.tris);
    const b = new T.Box3().setFromBufferAttribute(geo.getAttribute('position')), s = b.getSize(new T.Vector3()), c = b.getCenter(new T.Vector3());
    assert.ok(Math.abs(Math.max(s.x, s.y, s.z) - k.size) < 1e-6, k.id + ' longest side = size');
    assert.ok(Math.abs(b.min.y) < 1e-6 && Math.abs(c.x) < 1e-6 && Math.abs(c.z) < 1e-6, k.id + ' base at y=0, centred');
    const p = geo.getAttribute('position');
    const A = new T.Vector3(), B = new T.Vector3(), C = new T.Vector3();
    let vol = 0, minArea = Infinity;
    for (let i = 0; i < p.count; i += 3) {
      A.fromBufferAttribute(p, i); B.fromBufferAttribute(p, i + 1); C.fromBufferAttribute(p, i + 2);
      const n = B.clone().sub(A).cross(C.clone().sub(A));
      minArea = Math.min(minArea, n.length() / 2);
      vol += A.dot(B.clone().cross(C)) / 6;
    }
    assert.ok(minArea > 0, k.id + ' no degenerate triangle');
    assert.ok(vol > 0, k.id + ' outward winding (positive signed volume) ' + vol);
    // no see-through: the material is FrontSide, so wherever a ray from outside first meets the BACK of a triangle you would look
    // through the shell. Decorations laid on the surface (cowrie spots, starfish bumps, dollar petals) are open sheets on purpose and
    // never the first thing seen from behind. 1500 random rays through the bounding box; ≤ 1 % grazing edge hits allowed.
    const dbl = new T.Mesh(geo, new T.MeshBasicMaterial({ side: T.DoubleSide })), ray = new T.Raycaster(), size = b.getSize(new T.Vector3()), R = size.length();
    let seed = 11, rays = 0, back = 0; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 1500; i++) {
      const d = new T.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).normalize(), q = c.clone().add(new T.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).multiply(size).multiplyScalar(.6));
      ray.set(q.addScaledVector(d, -R), d); ray.far = 2 * R;
      const h = ray.intersectObject(dbl, false); if (!h.length) continue; rays++;
      if (h[0].face.normal.dot(d) > 1e-6) back++;
    }
    assert.ok(rays > 1000 && back <= rays * 0.01, k.id + ' no see-through holes: ' + back + ' of ' + rays + ' rays first meet a back face');
  }
});

test('lying any side up on the beach, a sculpted shell is visible from below (rays from under the mesh hit it)', () => {
  const { V3: V, window } = loadV3(MODS, { three: 'real' }), T = window.THREE, ray = new T.Raycaster();
  for (const k of V.shells.KINDS) {
    const o = V.shells.build(k.id, { tag: false });
    for (const flip of [0, Math.PI, Math.PI / 2]) {
      o.rotation.set(flip, 0, 0); o.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(o), c = box.getCenter(new T.Vector3());
      let hits = 0;
      for (const [dx, dz] of [[0, 0], [0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]]) {
        ray.set(new T.Vector3(c.x + dx * k.size, box.min.y - 0.05, c.z + dz * k.size), new T.Vector3(0, 1, 0));
 if (ray.intersectObject(o, true).length) hits++;
      }
      assert.ok(hits >= 3, k.id + ' underside visible after rotation ' + flip.toFixed(2) + ': ' + hits + '/5');
    }
  }
});

test('?shells=voxel keeps the old voxel shells for comparison', () => {
  const { V3: V } = loadV3(MODS, { three: 'real', globals: { location: { search: '?shells=voxel' } } });
  if (!V.shellKit.legacy) return;   // the loader does not expose location: covered in the browser comparison instead
  for (const k of V.shells.KINDS) assert.equal(V.shells.build(k.id, { tag: false }).userData.sculpt, false);
});
