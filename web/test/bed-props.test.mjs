// test/bed-props.test.mjs — the folded pyjamas and the nightcap on the block bed are hidden while she lies asleep in it, and back as
// soon as she is up (normal waking, every cancel path, scene / house rebuilds), in every cutaway and on a moved / rotated bed.
//   node --test test/bed-props.test.mjs
// Real modules, no build, no browser: the bundled house (assets/house/house-v4.png), the mod's own resource pack packed exactly like
// build.mjs does (__V3_ASSETS['mcpack.json.gz'] from mod/src/main/resources/assets/xiaojingyu), real 16-mcmesh meshes with real three.js,
// real 61-nav, the real 65 actor on the bundled YSM rig, real 50-scene ctx, real 54-house-mc + 56-furn-ground.
// BED_SRC_DIR=<dir> loads the modules from another src directory (used once to confirm these fail on the old files).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { requireGirlZip } from '../tools/lib/girl-asset.mjs';
requireGirlZip('bed-props');   // 第三方模型不进仓库：没有就跳过

const SRC = process.env.BED_SRC_DIR ? { srcDir: path.resolve(process.env.BED_SRC_DIR) } : {};
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), REPO = path.resolve(WEB, '..');
const image = fs.readFileSync(path.join(WEB, 'assets/house/house-v4.png'));
const asset = fs.readFileSync(path.join(WEB, 'assets/girl/fatfish-1.2.zip'));
const MOD = path.join(REPO, 'mod/src/main/resources/assets/xiaojingyu');
// build.mjs modPackBlob(): { 'assets/xiaojingyu/<sub>/…': {t: json text} | {b: base64} }, gzip
function modPack() {
  const obj = {};
  const walk = (dir, rel) => { for (const n of fs.readdirSync(dir).sort()) { const p = path.join(dir, n), r = rel + '/' + n; if (fs.statSync(p).isDirectory()) walk(p, r); else obj['assets/xiaojingyu' + r] = /\.json$/.test(n) ? { t: JSON.stringify(JSON.parse(fs.readFileSync(p, 'utf8'))) } : { b: fs.readFileSync(p).toString('base64') }; } };
  for (const sub of ['blockstates', 'models', 'textures', 'items']) walk(path.join(MOD, sub), '/' + sub);
  return zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64');
}
const MCPACK = modPack();
const MODULES = ['03-vox', '10-zip', '11-molang', '12-nbt', '13-share', '14-mcjar', '15-mcmodel', '16-mcmesh', '17-mcfallback', '29-ysm', '40-layout', '42-house-mc', '44-furn-mc',
  '50-scene', '54-house-mc', '56-furn-ground', '61-nav', '65-girl-actor'];
const BED = '小屋/家具/床';

const paint = new Proxy({}, { get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => ({ data: [], addColorStop() {} })), set: () => true });
class El {
  constructor(tag) { Object.assign(this, { tagName: tag, nodeType: 1, children: [], attrs: {}, style: {}, className: '', textContent: '' }); }
  get classList() { return { contains: name => this.className.split(/\s+/).includes(name) }; }
  getContext() { return paint; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() {} append() {} replaceChildren() {} remove() {}
}
class Doc extends EventTarget {
  constructor() { super(); this.hidden = false; this.body = new El('body'); }
  createElement(tag) { return new El(tag); }
}
const quads = g => { let n = 0; g.traverse(o => { if (o.isMesh) n += o.geometry.index.count / 6; }); return n; };
const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

// place: a house placement { dx, dz, k } applied before the scene is built (布置模式「挪房子」)
async function cabin(t, { place } = {}) {
  const document = new Doc();
  const h = loadV3(MODULES, { three: 'real', document, globals: { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, ...SRC });
  const { V3: V, window } = h, T = window.THREE, HB = V.houseBlocks;
  window.__V3_ASSETS = { [V.layout.house.asset]: image.toString('base64'), 'mcpack.json.gz': MCPACK };
  HB.store = { get: async () => null };
  await HB.load();
  if (place) await HB.applyEdit(HB.placeModel(HB.model, place), { place, rebuild: false });
  await HB.modPackReady();
  const model = V.ysm.load(await V.zip.read(asset));
  model.textures = [];
  V.girlv1 = { build: () => V.ysm.build(model, { height: 1.25 }) };
  V.bubble = { say() { return true; }, hide() {} };
  V.R = { camera: new T.PerspectiveCamera(), scene: null };
  V.R.camera.position.set(-2, 14, 10);                                   // south of the house, above: the south walls are the lowered ones
  const part = id => V.scene.parts.find(p => p.id === id), housePart = part('house'), ground = part('furn-ground'), actorPart = part('girl-actor');
  const c = { V, T, HB, window, document, housePart, actorPart, events: [] };
  V.on('actor:behavior', e => c.events.push(e.kind + ':' + e.phase + (e.reason ? ':' + e.reason : '')));
  c.buildHouse = async () => {
    const ctx = V.scene.ctx(c.root);
    const g = housePart.build(ctx); c.root.add(g); c.house = g; c.houseCtx = ctx;
    await g.userData.houseMc.ready;
    assert.equal(HB.error, null);
    return g.userData.houseMc;
  };
  c.dropHouse = () => { c.houseCtx.dead = true; housePart.dispose(c.houseCtx); c.root.remove(c.house); };
  c.root = new T.Group(); V.R.scene = c.root;
  c.ctx = V.scene.ctx(c.root);
  c.me = await c.buildHouse();
  c.root.add(ground.build(c.ctx));
  for (const o of actorPart.build(c.ctx)) c.root.add(o);
  await Promise.all(c.ctx._waits);
  c.frame = () => actorPart.update(0.05);
  c.step = secs => { for (let i = 0; i < Math.ceil(secs / 0.05); i++) c.frame(); };
  c.until = (fn, limit = 120, what = '') => {
    for (let i = 0; i < Math.ceil(limit / 0.05); i++) { if (fn()) return; c.frame(); }
    assert.ok(fn(), what + ' ' + JSON.stringify({ behavior: V.actor.behavior, pos: V.actor.pos, events: c.events.slice(-6), errors: window.__errors }));
  };
  c.asleep = () => { const b = V.actor.behavior; return !!b && b.kind === 'sleep' && b.phase === 'action' && !!V.actor.lying && V.actor.lying.k === 1; };
  c.props = () => { const list = HB.bedProps(); assert.equal(list.length, 1, 'one bed, one pyjama + nightcap mesh'); return list[0]; };
  c.drawn = () => { const p = c.props(); return p.shown && shown(p.object); };
  c.sleep = () => {
    assert.equal(V.actor.startBehavior('sleep', { interrupt: true }), true, 'she can go to bed: ' + JSON.stringify(V.actor.behaviorAvailability('sleep')));
    c.until(() => V.actor.behavior?.phase === 'lie', 90, 'reaches the bed');
    c.until(c.asleep, 10, 'lies down');
  };
  V.viewTokens.girl('idle');
  t.after(() => { if (V.actor) actorPart.dispose(); if (!c.houseCtx.dead) c.dropHouse(); ground.dispose(c.ctx); assert.deepEqual(window.__errors, []); });
  return c;
}
const bedCells = c => { const it = c.HB.furnInstances('bed')[0]; return c.V.furnMc.cellsFor(it.f, it.facing).map(q => [it.cell[0] + q.offset[0], it.cell[1] + q.offset[1], it.cell[2] + q.offset[2]]); };
function footprint(c) {
  const cs = bedCells(c), xs = cs.map(q => q[0]), zs = cs.map(q => q[2]);
  return { x0: Math.min(...xs), x1: Math.max(...xs) + 1, z0: Math.min(...zs), z1: Math.max(...zs) + 1, y: cs[0][1] };
}

test('the split is the .bbmodel\'s 睡帽 / 睡衣 elements, and the MC model files still contain them (MC keeps showing the pyjamas)', () => {
  const { V3: V } = loadV3(['44-furn-mc'], SRC), f = V.furnMc.byId('bed'), sp = f.sleepProps;
  assert.ok(sp, 'the bed spec names what is hidden while she sleeps');
  const bb = JSON.parse(fs.readFileSync(path.join(REPO, 'models/furniture/bed.bbmodel'), 'utf8'));
  const els = new Map(bb.elements.map(e => [e.uuid, e])), groups = new Map((bb.groups || []).map(g => [g.uuid, g]));
  const walk = (n, acc) => { for (const ch of n.children || []) { if (typeof ch === 'string') { if (els.has(ch)) acc.push(els.get(ch)); } else walk(ch, acc); } return acc; };
  for (const node of bb.outliner) {
    const name = (groups.get(node.uuid) || node).name, list = walk(node, []);
    const want = list.map((e, i) => (/^(睡帽|睡衣)$/.test(e.name) ? i : -1)).filter(i => i >= 0);
    assert.deepEqual(sp.parts[name], want, name + ': exactly the elements named 睡帽 / 睡衣, by their index in the exported model');
    assert.equal(sp.total[name], list.length, name + ': element count of the exported model');
    const js = JSON.parse(fs.readFileSync(path.join(MOD, 'models/block/bed_' + name + '.json'), 'utf8'));
    assert.equal(js.elements.length, list.length, name + ': the MC model is untouched (all elements still there)');
    for (const i of want) assert.deepEqual([js.elements[i].from, js.elements[i].to], [list[i].from, list[i].to].map(v => v.map((x, k) => x - (name === 'foot' && k === 2 ? 16 : 0))), name + ' element ' + i + ' is the same box in MC');
  }
  assert.equal(sp.parts.head.length, 17, '17 nightcap pieces'); assert.equal(sp.parts.foot.length, 1, 'one folded pyjama');
});

test('awake: pyjamas and nightcap drawn on the bed, as part of 床, and no longer duplicated in the house mesh', async t => {
  const c = await cabin(t), { HB, V, T, me } = c, p = c.props(), B = footprint(c);
  assert.ok(c.drawn(), 'shown while she is up');
  assert.deepEqual(p.cells.map(q => q.join(',')).sort(), bedCells(c).map(q => q.join(',')).sort(), 'both bed cells');
  // geometry: the nightcap near the pillow (y 9..12 px above the cell), the pyjamas on the foot half
  const box = new T.Box3().setFromObject(p.object);
  assert.ok(box.min.x >= B.x0 && box.max.x <= B.x1 && box.min.z >= B.z0 && box.max.z <= B.z1, 'inside the bed footprint ' + JSON.stringify([box.min, box.max]));
  assert.ok(Math.abs(box.min.y - (B.y + 8 / 16)) < 1e-6 && Math.abs(box.max.y - (B.y + 12 / 16)) < 1e-6, 'from the quilt top (8 px) to the cap tip (12 px)');
  // parts registry / cut / hover label: the group is 小屋/家具/床, registered, nothing else in it
  assert.deepEqual(p.object.children.map(g => g.userData.part), [BED]);
  assert.ok(V.parts.objects(BED).some(it => it.obj === p.object.children[0]), 'registered under 床 (feedback picking / hover resolve to the bed)');
  assert.equal(V.parts.label(BED), '床');
  // the house mesh + this mesh = the whole bed model exactly once (the full model drawn alone through the same pack: HB.meshFor)
  const main = me.cache.get(me.shown).g.children.find(g => g.name === BED);
  // the whole house meshed once more with the unsplit pack (what the house mesh was before): the faces of the bed's cells
  const res = await V.mcmesh.build(HB.model, { pack: me.pack, ao: true, light: false, cardinal: false, mipmaps: false, origin: HB.grid.org });
  const cells = new Set(bedCells(c).map(q => [q[0] - HB.grid.org[0], q[1] - HB.grid.org[1], q[2] - HB.grid.org[2]].join(',')));
  let fullQ = 0;
  for (const Ly of Object.values(res.layers)) for (let q = 0; q < Ly.quads; q++) if (cells.has([Ly.cells[q * 3], Ly.cells[q * 3 + 1], Ly.cells[q * 3 + 2]].join(','))) fullQ++;
  const props = quads(p.object), mainQ = quads(main);
  assert.ok(props >= 80, 'the props mesh has the 18 elements\' faces: ' + props);
  assert.equal(mainQ + props, fullQ, 'house mesh ' + mainQ + ' + props ' + props + ' = whole bed ' + fullQ + ' (nothing drawn twice, nothing lost)');
  // every cutaway: still shown while she is up (the bed is on the ground floor)
  for (const f of ['ground', 'loft', 'all']) { await me.setFloor(f); assert.ok(c.drawn(), 'shown on floor ' + f); }
});

test('asleep: hidden; getting up the normal way brings them back; a cancel too', async t => {
  const c = await cabin(t), { V, HB } = c;
  V.actor.startBehavior('sleep', { interrupt: true });
  c.until(() => V.actor.behavior?.phase === 'face_bed' || V.actor.behavior?.phase === 'lie', 90, 'at the bed');
  if (V.actor.behavior.phase === 'face_bed') assert.ok(c.drawn(), 'still there while she walks up and turns');
  c.until(c.asleep, 10, 'lies down');
  assert.equal(c.drawn(), false, 'hidden while she lies asleep'); assert.equal(c.props().asleep, true);
  assert.equal(c.root.children.filter(o => o.name === 'bed-sleep-cover' && o.visible).length, 1, 'the quilt cover lies over her instead');
  for (const f of ['ground', 'loft', 'all']) { await c.me.setFloor(f); assert.equal(c.drawn(), false, 'hidden on floor ' + f); }
  const n = c.HB.bedProps()[0].object;
  c.step(5); assert.equal(c.drawn(), false, 'stays hidden through the night'); assert.equal(c.HB.bedProps()[0].object, n, 'no re-mesh while she sleeps');
  assert.equal(V.actor.endBehavior(), true);
  c.until(() => V.actor.behavior === null, 5, 'gets up');
  assert.ok(c.drawn(), 'back when she is up'); assert.equal(HB.sleeper(), null);
  c.sleep(); assert.equal(c.drawn(), false);
  V.actor.cancelBehavior('test');
  assert.ok(c.drawn(), 'back at once after a cancel');
});

test('every interruption puts them back: arrange mode, feedback, page hidden, house changed, actor rebuilt, house rebuilt, teardown', async t => {
  const c = await cabin(t), { V, HB, document } = c;
  const back = what => { c.until(() => !V.actor.behavior, 2, what); assert.ok(c.drawn(), what + ': shown again'); assert.equal(HB.sleeper(), null, what); };
  c.sleep(); V.arrange = { on: true }; c.step(0.1); back('arrange mode'); V.arrange.on = false;
  c.sleep(); V.fb = { enabled: true }; c.step(0.1); back('feedback'); V.fb.enabled = false;
  c.sleep(); document.hidden = true; c.step(0.1); back('page hidden'); document.hidden = false;
  c.sleep(); HB.version++; c.step(0.1); back('house changed');
  // the actor part is rebuilt (scene rebuild): dispose stands her up
  c.sleep(); const old = V.actor.root; c.actorPart.dispose(); assert.ok(c.drawn(), 'actor disposed: shown'); assert.equal(HB.sleeper(), null);
  c.root.remove(old); for (const o of c.actorPart.build(c.ctx)) c.root.add(o); V.viewTokens.girl('idle');
  // the house part alone is rebuilt while she sleeps (texture reload / scene rebuild order): the new mesh starts hidden, old one freed
  c.sleep();
  const oldProps = c.props().object; let freed = 0; oldProps.traverse(o => { if (o.geometry) o.geometry.addEventListener('dispose', () => freed++); });
  let meshes = 0; oldProps.traverse(o => { if (o.isMesh) meshes++; });
  c.dropHouse();
  assert.equal(freed, meshes, 'the old props geometry is freed with the house'); assert.ok(!V.parts.objects(BED).some(it => it.obj.parent === oldProps), 'and unregistered');
  assert.equal(oldProps.parent, null, 'and out of the scene');
  c.me = await c.buildHouse();
  assert.notEqual(c.props().object, oldProps);
  assert.equal(c.drawn(), false, 'a house built while she sleeps starts with them hidden');
  assert.equal(V.actor.endBehavior(), true); c.until(() => !V.actor.behavior, 5);
  assert.ok(c.drawn(), 'and shows them when she gets up');
  // reload (textures switched): props are re-meshed, still follow the state
  c.sleep(); await c.me.reload(); assert.equal(c.drawn(), false, 'reloaded while asleep: hidden');
  V.actor.cancelBehavior('x'); assert.ok(c.drawn());
  // teardown while asleep: nothing of the props left registered or in the scene
  c.sleep(); const last = c.props().object; c.actorPart.dispose(); c.dropHouse();
  assert.equal(HB.bedProps().length, 0); assert.equal(last.parent, null); assert.equal(HB.sleeper(), null, 'teardown wakes her');
  // (only the bed's path: 56-furn-ground's prune() leaves the voxel meshes it removes registered under their furniture paths — older, not this change)
  const detached = V.parts.objects(BED).filter(it => { let o = it.obj; while (o.parent) o = o.parent; return o !== c.root; });
  assert.equal(detached.length, 0, 'no registered object outside the scene: ' + [...new Set(detached.map(it => it.obj.name + '@' + (it.obj.userData.part || '') + '<' + (it.obj.parent && it.obj.parent.name)))].join(' | '));
  c.me = await c.buildHouse();                                       // for t.after
  for (const o of c.actorPart.build(c.ctx)) c.root.add(o);
});

test('arrange mode dragging the bed hides them with it; the cutaway that removes the bed\'s storey hides them', async t => {
  const c = await cabin(t), { me } = c;
  me.setHidden(bedCells(c)); assert.equal(c.drawn(), false, 'the bed being dragged: its pyjamas go with it');
  await me.setHidden(null); assert.ok(c.drawn(), 'dropped back');
  // a cut that drops the bed cell: cutKeep of a ground-floor ring cell is false only for walls, so check the mechanism directly
  const p = c.props(), keep = p.cells.every(q => c.HB.visibleAt(...q));
  for (const f of ['ground', 'loft', 'all']) { await me.setFloor(f); assert.equal(c.drawn(), p.cells.every(q => c.HB.visibleAt(...q)), 'follows HB.visibleAt on ' + f); }
  assert.ok(keep);
});

test('a moved and rotated house (bed facing east): the props sit on the bed and still hide while she sleeps there', async t => {
  const c = await cabin(t, { place: { dx: 2, dz: -1, k: 1 } }), { V, HB, T } = c;
  assert.equal(HB.furnInstances('bed')[0].facing, 'east');
  const B = footprint(c), box = new T.Box3().setFromObject(c.props().object);
  assert.ok(box.min.x >= B.x0 - 1e-6 && box.max.x <= B.x1 + 1e-6 && box.min.z >= B.z0 - 1e-6 && box.max.z <= B.z1 + 1e-6, 'on the rotated bed ' + JSON.stringify({ B, box }));
  assert.ok(B.x1 - B.x0 === 2 && B.z1 - B.z0 === 1, 'the bed lies along x now');
  // the nightcap is at the head end (east = the bed's facing): the props' centre is east of the bed's centre
  const head = HB.furnInstances('bed')[0].cell;
  assert.ok(c.props().cells.some(q => q.join() === head.join()));
  assert.ok(c.drawn());
  c.sleep(); assert.equal(c.drawn(), false, 'hidden on the rotated bed');
  V.actor.endBehavior(); c.until(() => !V.actor.behavior, 5); assert.ok(c.drawn());
});

test('the old voxel bed (no block house): the nightcap on the pillow follows the sleeping variant like the pyjamas', () => {
  const h = loadV3(['03-vox', '40-layout', '44-furn-mc', '50-scene', '56-furn-ground'], { three: 'real', ...SRC }), V = h.V3, T = h.window.THREE;
  const root = new T.Group(), ctx = V.scene.ctx(root, { studio: true });
  root.add(V.furn.buildAll(ctx, 'ground'));
  let cap = null, made = null; root.traverse(o => { if (o.name === 'bed-nightcap') cap = o; if (o.name === 'vox:made') made = o; });
  assert.ok(cap && made);
  const visible = o => { for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false; return true; };
  assert.ok(visible(cap) && visible(made), 'made: cap and pyjamas');
  V.furn.setVariant('bed', 'sleeping'); assert.equal(visible(cap), false, 'sleeping: cap hidden'); assert.equal(visible(made), false, 'pyjamas hidden');
  V.furn.setVariant('bed', 'made'); assert.ok(visible(cap) && visible(made), 'made again: both back');
  V.furn.release(ctx);
});
