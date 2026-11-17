import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const fixture = () => loadV3(['03-vox', '15-mcmodel', '31-collectible-abalone', '31-collectible-cubes', '31-collectible-render', '31-washup-catalog'], { three: 'real' });
const legacy = new Set(['scallop', 'clam', 'mussel', 'moon', 'nassa', 'cowrie', 'starfish', 'miter', 'dollar', 'conch', 'nautilus', 'pearl']);
const weatherIds = new Set(['clear', 'cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'storm', 'snow']);

test('washups are 27 collectibles by rarity, plus five independent litter kinds', () => {
  const { V3: { washupCatalog: c } } = fixture();
  assert.deepEqual(c.collectibles.map(k => k.id), [
    'limpet', 'oyster_shell', 'razor_clam', 'green_sea_glass', 'striped_pebble', 'driftwood', 'kelp_ribbon', 'sea_bean',
    'barnacle_cluster', 'coral_fragment', 'sea_urchin_test', 'blue_glass_float', 'rainbow_abalone',
    'cockle', 'coquina', 'tusk_shell', 'top_shell', 'mermaids_eye', 'winged_kelp', 'sea_pottery', 'ark_shell',
    'venus_comb', 'sundial', 'violet_snail', 'lions_paw', 'red_coral', 'opal_ammonite',
  ]);
  assert.deepEqual(c.trash.map(k => k.id), ['plastic_cap', 'crushed_can', 'tangled_fishing_line', 'broken_flipflop', 'foil_wrapper']);
  assert.deepEqual(['common', 'uncommon', 'rare'].map(r => c.collectibles.filter(k => k.rarity === r).length), [17, 7, 3]);
  assert.deepEqual(c.collectibles.filter(k => k.rarity === 'rare').map(k => k.id), ['rainbow_abalone', 'red_coral', 'opal_ammonite']);
  assert(c.collectibles.every(k => k.category === 'collectible'));
  assert(c.trash.every(k => k.category === 'trash' && !k.decoratable));
  const all = [...c.collectibles, ...c.trash];
  assert.equal(new Set(all.map(k => k.id)).size, all.length);
  for (const k of all) {
    assert(c.has(k.id));
    assert(!legacy.has(k.id) && /^[a-z]+(?:_[a-z]+)*$/.test(k.id));
    assert(/\p{Script=Han}/u.test(k.name) && /\p{Script=Han}/u.test(k.desc));
    assert(Number.isFinite(k.size) && k.size > 0);
    assert(k.weather.length > 0 && k.weather.every(w => weatherIds.has(w)));
    assert.equal(new Set(k.weather).size, k.weather.length);
  }
  assert(c.collectibles.some(k => k.decoratable) && c.collectibles.some(k => !k.decoratable));
  assert(!c.has('scallop') && !c.has('constructor') && !c.has('__proto__'));
  assert.throws(() => c.build('missing'), /unknown id missing/);
});

test('all kinds build a cheap, centred, grounded shell-compatible mesh with reusable resources', () => {
  const { V3, window: { THREE: T } } = fixture(), c = V3.washupCatalog;
  const near = (a, b, label) => assert(Math.abs(a - b) < 1e-7, `${label}: ${a} ≠ ${b}`);
  const geometries = new Set();
  for (const k of [...c.collectibles, ...c.trash]) {
    const root = c.build(k.id, { tag: false }), [mesh] = root.children, geo = mesh.geometry;
    const prefix = k.category === 'collectible' ? 'shell' : 'trash';
    assert(root.isGroup && root.children.length === 1 && mesh.isMesh, k.id);
    assert.equal(root.name, `${prefix}-${k.id}`);
    assert.equal(mesh.userData.anchor, `${prefix}:${k.id}`);
    assert.equal(mesh.userData.category, k.category);
    assert.equal(mesh.userData.kind, k.id);
    assert.equal(mesh.userData.shell, k.category === 'collectible' ? k.id : undefined);
    assert.equal(V3.parts.objects(mesh.userData.faceTags[0]).length, 0);
    const anchor = 'test:' + k.id, other = c.build(k.id, { anchor }).children[0];
    assert.equal(other.userData.anchor, anchor);
    assert.equal(V3.parts.objects(mesh.userData.faceTags[0])[0].obj, other);
    assert.notEqual(other, mesh);
    assert.equal(other.geometry, geo);
    assert.equal(other.material[0], mesh.material[0]);
    assert(geo.userData.shared && mesh.material[0].userData.shared && mesh.material[0].vertexColors);
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), color = geo.getAttribute('color');
    assert.equal(p.count, n.count);
    assert.equal(p.count, color.count);
    for (const attr of [p, n, color]) assert(attr.array.every(Number.isFinite), k.id);
    const nVerts = geo.index?.count ?? p.count;
    assert.equal(geo.groups.length, 1);
    assert.equal(geo.groups[0].count, nVerts);
    assert.equal(mesh.userData.triTag.length, nVerts / 3);
    assert(nVerts / 3 > 0 && nVerts / 3 < 2400, `${k.id} has ${nVerts / 3} triangles`);
    if (['sea_urchin_test', 'rainbow_abalone'].includes(k.id)) {
      // 2026-11-13: the web mesh went back to a triangle sculpt (urchin restored, abalone re-sculpted); only the MC
      // resource pack keeps the cuboid version, so check both halves of that split.
      assert.equal(geo.getAttribute('uv'), undefined, k.id + ' web mesh is the vertex-coloured sculpt');
      assert.equal(geo.userData.cuboids, undefined, k.id);
      assert(!mesh.material[0].map, k.id + ' has no atlas on the web');
      assert(nVerts / 3 <= (k.id === 'rainbow_abalone' ? 720 : 1300), k.id + ' sculpt budget');
      assert(new Set(Array.from(color.array, x => x.toFixed(3))).size > 6, k.id + ' is painted');
      const spec = V3.collectibleCubes.build(k.id);
      assert(spec.elements.length > 0 && spec.elements.length <= 64, k.id + ' MC cuboid model still exists');
      assert.equal(spec.rgba.length, spec.width * spec.height * 4);
    }
    const a = new T.Vector3(), bEdge = new T.Vector3(), cEdge = new T.Vector3(), normal = new T.Vector3();
    const vertex = i => geo.index ? geo.index.getX(i) : i;
    for (let i = 0; i < nVerts; i += 3) {
      a.fromBufferAttribute(p, vertex(i));
      bEdge.fromBufferAttribute(p, vertex(i + 1)).sub(a);
      cEdge.fromBufferAttribute(p, vertex(i + 2)).sub(a);
      bEdge.cross(cEdge);
      normal.fromBufferAttribute(n, vertex(i));
      assert(bEdge.dot(normal) > 0, `${k.id} triangle ${i / 3} has a nondegenerate, front-facing normal`);
    }
    geometries.add(geo);
    const b = new T.Box3().setFromObject(root, true), size = b.getSize(new T.Vector3());
    near(b.min.y, 0, k.id);
    near(b.min.x + b.max.x, 0, k.id);
    near(b.min.z + b.max.z, 0, k.id);
    near(Math.max(size.x, size.y, size.z), k.size, k.id);
  }
  assert.equal(geometries.size, 32);
});
