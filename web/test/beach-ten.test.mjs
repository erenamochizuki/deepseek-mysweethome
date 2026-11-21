import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const finds = [
  ['crab_molt_claw', '螃蟹蜕下的小钳', 'common'], ['drift_cork', '海漂软木塞', 'common'],
  ['sea_bamboo', '波纹海竹节', 'common'], ['fan_alga', '海扇藻叶', 'common'],
  ['mermaid_comb', '人鱼梳', 'uncommon'], ['gooseneck_cluster', '鹅颈藤壶空簇', 'uncommon'],
  ['crinoid_crown', '海百合冠化石', 'rare'], ['wreck_compass', '沉船罗盘', 'rare'],
  ['amber_shrimp', '琥珀封虾', 'rare'], ['silver_sail_badge', '银帆船徽', 'rare'],
];
const modules = ['03-vox', '30-shell-kit', '30-shell-m1', '30-shell-m2', '30-shell-variants',
  '30-shells', '31-washup-catalog', '58-inventory-rules', '59-cabin-inventory', '59-cabin-tide', '60-game'];
const fixture = () => loadV3(modules, {three: 'real', globals: {
  localStorage: new MapStorage(), document: {querySelector: () => null, addEventListener() {}},
}});
class MapStorage extends Map {
  getItem(key) { return this.get(key) ?? null; }
  setItem(key, value) { this.set(key, value); }
}

test('exhibition and icons can borrow a resolved view without modifying the shared pose', () => {
  const h = fixture(); h.load(['66-shell-icons']); const icons = h.V3.shellIcons;
  assert.equal(typeof icons.viewFor, 'function');
  const fallback = icons.viewFor('unknown');
  for (const [id] of finds) {
    const pose = icons.viewFor(id); assert.ok(Number.isFinite(pose.az) && Number.isFinite(pose.el));
    assert.notDeepEqual(pose, fallback, id);
    const original = {...pose}; pose.el = -10; assert.deepEqual(icons.viewFor(id), original);
  }
  assert.equal(icons.viewFor('starfish').az, fallback.az, 'legacy partial poses inherit defaults');
});

test('the tide can select each new find in its tier in the hosted beach catalog', () => {
  const { V3: V } = fixture(); V.game.hosted = true;
  for (const [id, name, rarity] of finds) {
    const k = V.game.kind(id); assert.ok(k, id);
    assert.equal(k.name, name); assert.equal(k.rarity, rarity); assert.equal(k.category, 'collectible');
    assert.equal(k.decoratable, true); assert.match(k.desc, /\p{Script=Han}/u); assert.ok(k.weather.length);
    const kinds = V.game.kinds(), settings = {wCommon: 0, wUncommon: 0, wRare: 0, wUltra: 0};
    settings[{common: 'wCommon', uncommon: 'wUncommon', rare: 'wRare'}[rarity]] = 1;
    const peers = kinds.filter(k => k.rarity === rarity), roll = (peers.indexOf(k) + .5) / peers.length;
    assert.equal(V.cabinTide.pick({wx: 'baseline', kinds, trash: [], settings, random: () => roll}).id, id);
  }
});

test('each find has its own grounded sculpt and all specimen patterns retain the full mesh', () => {
  const { V3: V, window: { THREE: T } } = fixture(), shapes = new Set();
  for (const [id] of finds) {
    assert.ok(V.shells.has(id), id);
    const root = V.shells.build(id, {tag: false}), [mesh] = root.children, geo = mesh.geometry;
    assert.equal(root.children.length, 1, 'collection turntable borrows the first mesh');
    const {position, normal, color} = geo.attributes;
    assert.ok(root.userData.tris > 0 && root.userData.tris < 2400, `${id}: ${root.userData.tris} triangles`);
    assert.equal(mesh.userData.triTag.length, root.userData.tris);
    assert.equal(geo.groups.length, 1); assert.equal(geo.groups[0].count, position.count);
    assert.ok(position.array.every(Number.isFinite) && color.array.every(Number.isFinite));
    for (let i = 0; i < normal.count; i += 3) assert.ok(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) > .99, `${id}: degenerate face ${i/3}`);
    const size = geo.boundingBox.getSize(new T.Vector3()), k = V.washupCatalog.collectibles.find(k => k.id === id);
    assert.ok(Math.abs(Math.max(...size.toArray()) - k.size) < 1e-6 && Math.abs(geo.boundingBox.min.y) < 1e-6, id);
    shapes.add(Buffer.from(position.array.buffer).toString('base64'));
    for (const pat of V.shellVariants.ids) {
      const painted = V.shells.build(id, {tag: false, pat}).children[0].geometry;
      assert.equal(painted.attributes.position, position); assert.notDeepEqual(painted.attributes.color.array, color.array, `${id}:${pat}`);
      assert.equal(painted, V.shells.build(id, {tag: false, pat}).children[0].geometry);
    }
  }
  assert.equal(shapes.size, finds.length, 'no two specimens reuse a placeholder shape');
});

test('the amber window stays translucent over a solid inclusion on the patterned turntable', () => {
  const {V3: V, window: {THREE: T}} = fixture();
  for (const pat of ['plain', 'mist']) {
    const donor = V.shells.build('amber_shrimp', {tag: false, pat}).children[0];
    const mesh = new T.Mesh(donor.geometry.clone(), donor.material[0].clone());
    const mat = mesh.material, mask = mat.alphaMap?.image;
    assert.ok(mat.transparent && mask, 'borrowed material must still expose the inclusion');
    const opacity = hit => mask.data[4 * Math.min(mask.width-1, Math.floor(hit.uv.x*mask.width)) + 1];
    const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0,-1,0));
    const b = mesh.geometry.boundingBox, centre = b.getCenter(new T.Vector3()), size = b.getSize(new T.Vector3());
    let visible = 0;
    for (let ix=-3; ix<=3; ix++) for(let iz=-2; iz<=2; iz++) {
      ray.ray.origin.set(centre.x+ix*.07*size.x, b.max.y+size.y, centre.z+iz*.07*size.z);
      const hits=ray.intersectObject(mesh);
      if (hits.length && opacity(hits[0])<128 && hits.slice(1).some(hit=>opacity(hit)===255 && hit.point.y>centre.y)) visible++;
    }
    assert.ok(visible>=4, `${pat}: rays must reach the raised shrimp beneath the polished surface`);
    mesh.geometry.dispose(); mat.dispose();
  }
});

test('a patterned specimen on the sand can be picked up, placed and read back from the inventory', async () => {
  const h = fixture(), V = h.V3, I = V.cabinInventory;
  await I.start({}); V.game.hosted = true;
  V.layout = {zones: [{id: 'wash', x0: -20, x1: 20}], outside: []};
  V.terrain = {groundY: () => 0, seabedY: () => 0};
  let beach; V.scene = {part: p => { beach = p; }}; h.load(['62-beach-items']); beach.build();
  try {
    for (const [id] of finds) {
      assert.ok(V.game.kind(id), id);
      const uid = `specimen:${id}`;
      V.game.st.beach.push({id: uid, kind: id, x: 0, z: 9, ry: .3, at: 1, pat: 'mist', size: 70});
      V.beachItems.sync(); const onSand = V.beachItems.get(uid);
      assert.ok(onSand.getObjectByName('beach:pick')); assert.equal(onSand.getObjectByName('shell-' + id).userData.pat, 'mist');
      assert.ok(await V.game.collect(uid)); assert.equal(V.beachItems.get(uid), null);
      const placement = await I.perform({op: 'place', id: `place:${id}`, slot: 'coffee-table', kind: id, uid, by: 'player'});
      assert.equal(placement.ok, true);
      const saved = V.inventoryRules.parseInventory(I.data.inventory);
      assert.equal(saved.placements['coffee-table'].uid, uid); assert.equal(saved.found[id].items[0].pat, 'mist');
      assert.ok((await I.perform({op: 'return', id: `return:${id}`, slot: 'coffee-table', by: 'player'})).ok);
    }
  } finally { beach.dispose(); }
});
