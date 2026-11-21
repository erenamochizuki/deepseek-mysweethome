import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const ids = ['beach_morning_glory', 'beach_bean', 'naupaka', 'crinum', 'sea_hibiscus'];
const bounds = (T, o) => new T.Box3().setFromObject(o, true);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('五种种子可单独查询和建模，保持独立目录和落地尺寸', () => {
  const { V3, window: { THREE: T } } = loadV3(['31-moon-treasures', '31-washup-catalog'], { three: 'real' });
  const c = V3.washupCatalog;
  assert.deepEqual(c.seeds?.map(k => k.id), ids);
  assert.deepEqual(c.seeds.map(k => k.rarity), ['common', 'common', 'uncommon', 'uncommon', 'rare']);
  assert.equal(c.collectibles.length + 12, 65);
  const shapes = new Set();
  for (const k of c.seeds) {
    assert.ok(![...c.collectibles, ...c.trash].some(it => it.id === k.id));
    assert.ok(c.has(k.id) && k.category === 'seed' && k.weather.length);
    assert.match(k.name, /种子/);
    for (const field of ['desc', 'hint', 'flower']) assert.match(k[field], /\p{Script=Han}/u);
    const root = c.build(k.id, { tag: false }), mesh = root.children[0];
    assert.ok(root.isGroup && mesh.isMesh && mesh.material[0].vertexColors);
    assert.equal(mesh.userData.category, 'seed');
    assert.equal(mesh.userData.shell, undefined);
    const b = bounds(T, root), d = b.getSize(new T.Vector3());
    near(b.min.y, 0); near(b.min.x + b.max.x, 0); near(b.min.z + b.max.z, 0);
    near(Math.max(d.x, d.y, d.z), k.size);
    assert.ok(root.userData.tris > 50 && root.userData.tris < 2400);
    shapes.add(mesh.geometry);
  }
  assert.equal(shapes.size, 5);
});

test('每个种类从土面到花都有可见变化，整盆落地并留出风铃净空', () => {
  const { V3, window: { THREE: T } } = loadV3(['30-shell-kit', '58-garden-models'], { three: 'real' });
  const build = V3.gardenModels.build, empty = bounds(T, build(null, 0)), mature = new Set();
  assert.ok(empty.max.y > .08 && empty.max.y < .22);
  for (const id of ids) {
    let previousHeight = 0;
    for (let stage = 0; stage <= 5; stage++) {
      const root = build(id, stage), b = bounds(T, root);
      assert.ok(root.isGroup); near(b.min.y, 0);
      assert.ok(b.max.y <= .55 && b.max.y > previousHeight, `${id} ${stage}: ${b.max.y}`);
      if (!stage) assert.ok(b.equals(empty));
      previousHeight = b.max.y;
      if (stage === 5) mature.add(b.getSize(new T.Vector3()).toArray().join(','));
    }
  }
  assert.equal(mature.size, 5);
});

test('陶盆、土和全株分两次绘制，曲面共用顶点、颜色与缓存', () => {
  const { V3 } = loadV3(['30-shell-kit', '58-garden-models'], { three: 'real' });
  for (const id of ids) for (let stage = 0; stage <= 5; stage++) {
    const build = () => V3.gardenModels.build(id, stage), root = build(), copy = build();
    assert.equal(root.children.length, stage ? 2 : 1);
    let faces = 0;
    root.children.forEach((m, i) => {
      const g = m.geometry;
      assert.equal(g, copy.children[i].geometry); assert.notEqual(m, copy.children[i]);
      assert.ok(!Array.isArray(m.material) && m.material.vertexColors && !g.groups.length);
      assert.ok(g.index && g.index.count > g.attributes.position.count);
      assert.equal(g.attributes.color.count, g.attributes.normal.count);
      assert.ok(g.attributes.normal.array.some(n => Math.abs(n) > .3 && Math.abs(n) < .8));
      faces += g.index.count / 3;
    });
    assert.ok(faces < 9000, id + ' 三角面 ' + faces);
  }
});

test('真屋南窗随房子移动，花随风而盆底不动，切层和拆掉窗台同步撤销点选', async () => {
  const h = loadV3(['03-vox', '12-nbt', '13-share', '15-mcmodel', '30-shell-kit', '30-shell-m1', '30-shell-m2', '30-shells',
    '40-layout', '42-house-mc', '44-furn-mc'], { three: 'real' });
  const { V3: V, window: { THREE: T } } = h, parts = new Map();
  V.scene = { part: p => parts.set(p.id, p) };
  h.load(['54-house-mc', '58-garden-models', '58-shell-decor', '58-window-garden', '61-nav']);
  const HB = V.houseBlocks, ctx = { root: new T.Group(), state: { floor: 'loft' } };
  const part = parts.get('window-garden');
  V.models.current = () => ({ root: ctx.root });
  ctx.root.add(part.build(ctx));
  assert.deepEqual(V.gardenScene.objects(), []);
  h.window.__V3_ASSETS = { [V.layout.house.asset]: (await readFile(new URL('../assets/house/house-v4.png', import.meta.url))).toString('base64') };
  HB.store = { get: async () => null };
  await HB.load();
  const [pot] = V.gardenScene.objects();
  assert.equal(pot.userData.clickable, 'windowGarden');
  const base = bounds(T, pot), position = pot.getWorldPosition(new T.Vector3()).toArray();
  near(base.min.y, 6);
  const potState = { kind: 'sea_hibiscus', watered: ['2026-11-21'] };
  const placements = { 'loft-window': { id: 'paired-shell', kind: 'dollar' } };
  V.game = { inventory: () => ({ garden: { pot: potState }, placements }) };
  ctx.root.add(parts.get('shell-decor').build(ctx));
  assert.ok(bounds(T, V.gardenScene.objects()[0]).equals(base));
  V.inventoryRules = { gardenStage: n => n === 1 ? 5 : 0 };
  assert.equal(V.gardenScene.objects()[0], pot);
  const bloom = bounds(T, pot);
  assert.ok(bloom.max.y > base.max.y + .15 && bloom.max.y <= 6.55);
  assert.ok(bloom.min.x > -2 && bloom.max.x < -1 && bloom.max.z < -6.5625 && bloom.min.z >= -7);
  const shell = V.shellDecor.slots().find(s => s.id === 'loft-window');
  assert.deepEqual(position, [-1.5, 6, -6.775]);
  assert.deepEqual(shell.position, [-6.225, 6, -11.5]);
  const [x, y, z] = V.gardenScene.approach();
  assert.deepEqual(V.nav.path([...V.nav.home, 0], [x, z, y]).at(-1), [x, z, y]);
  assert.equal(y, 5);
  const ray = new T.Raycaster(new T.Vector3(position[0], 6.05, -7.5), new T.Vector3(0, 0, 1));
  assert.ok(ray.intersectObject(pot, true).length);
  V.env = { state: { wind: { speed: .8, gust: .7, dir: [1, 0] } } };
  part.update(.08, 1, ctx);
  const swayed = bounds(T, pot);
  near(swayed.min.y, base.min.y); assert.ok(!swayed.equals(bloom));
  const [exhibit] = V.shellDecor.objects(), shellBox = bounds(T, exhibit);
  near(shellBox.min.y, 6.002);
  for (const kind of ids) {
    potState.kind = kind;
    for (let i = 0; i < 8; i++) {
      const angle = i*Math.PI/4;
      V.env.state.wind = { speed: 1, gust: 1, dir: [Math.cos(angle), Math.sin(angle)] };
      part.update(.08, i, ctx);
      const b = bounds(T, V.gardenScene.objects()[0]);
      assert.ok(!b.intersectsBox(shellBox) && b.min.x > -2 && b.max.x < -1 && b.min.z >= -7 && b.max.z < -6.5625 && b.max.y <= 6.55, kind);
    }
  }
  ctx.state.floor = 'ground';
  assert.deepEqual(V.gardenScene.objects(), []);
  assert.deepEqual(V.gardenScene.approach(), [x, y, z]);
  ctx.state.floor = 'loft';
  const original = HB.model, pl = { dx: 2, dz: 1, k: 1 };
  await HB.applyEdit(HB.placeModel(original, pl), { place: pl, rebuild: false });
  const moved = V.gardenScene.objects()[0].getWorldPosition(new T.Vector3());
  HB.placePoint(position, pl).forEach((value, i) => near(moved.toArray()[i], value));
  const movedShell = V.shellDecor.slots().find(s => s.id === 'loft-window');
  HB.placePoint(shell.position, pl).forEach((value, i) => near(movedShell.position[i], value));
  const cells = original.cells.slice(), [ox, oy, oz] = HB.originOf(original), [width, , depth] = original.size;
  cells[-2-ox + (-7-oz)*width + (5-oy)*width*depth] = original.palette.indexOf('minecraft:air');
  await HB.applyEdit({ ...original, cells }, { place: { dx: 0, dz: 0, k: 0 }, rebuild: false });
  assert.deepEqual(V.gardenScene.objects(), []);
  assert.equal(V.gardenScene.approach(), null);
  assert.deepEqual(V.shellDecor.slots().find(s => s.id === 'loft-window').position, [-6.225, 6, -11.5]);
  parts.get('shell-decor').dispose(ctx);
  part.dispose(ctx);
  assert.deepEqual(V.gardenScene.objects(), []);
});
