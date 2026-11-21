import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { readFile } from 'node:fs/promises';

const craft = () => loadV3(['58-inventory-rules', '57-wind-chime-craft']).V3.chimeCraft;

test('挂点在每枚的顶部，厘米包含上方间距和真实尺寸', () => {
  const design = { strands: [[{ uid: 'a', gap: 2 }, { uid: 'b', gap: 12 }], [], [], [], []] };
  const lines = craft().layout('door', design, new Map([['a', { item: { size: 101 } }], ['b', { item: { size: 50 } }]]));
  assert.deepEqual(lines.map(s => s.length), [29.1, 0, 0, 0, 0]);
  assert.deepEqual(lines[0].items.map(b => [b.uid, b.top, b.bottom]), [['a', 2, 12.1], ['b', 24.1, 29.1]]);
  assert.ok(lines.every((s, i) => !i || s.x - lines[i-1].x === lines[1].x - lines[0].x));
});

test('真实房屋的两个方块、满长窗铃和窗台之间的净空、局部换串与恢复', async () => {
  const h = loadV3(['03-vox','12-nbt','13-share','15-mcmodel','30-shell-kit','30-shell-m1','30-shell-m2','30-shells','40-layout','44-furn-mc'], { three: 'real' });
  const { V3: V, window } = h, T = window.THREE, parts = new Map();
  V.scene = { part: p => parts.set(p.id, p) };
  h.load(['54-house-mc','55-house-detail','57-wind-chime-craft','58-inventory-rules']);
  const hb = V.houseBlocks; hb.store = { get: async () => null };
  window.__V3_ASSETS = { [V.layout.house.asset]: (await readFile(new URL('../assets/house/house-v4.png', import.meta.url))).toString('base64') };
  await hb.load();
  const inv = V.inventoryRules.empty(); V.cabinInventory = { data: { inventory: inv } };
  const part = parts.get('house-detail'), root = new T.Group(); root.add(...part.build({})); root.updateMatrixWorld(true);
  const door = root.getObjectByName('house2:chime'), win = root.getObjectByName('house2:chimeWindow');
  assert.equal(door.userData.chimeSlot, 'door'); assert.equal(win.userData.chimeSlot, 'window');
  assert.deepEqual(V.chimeCraft.cells(), { door: [-2,3,-6], window: [-2,7,-8] });
  assert.equal(V.chimeCraft.slotOf([-2,7,-8]), 'window'); assert.equal(V.chimeCraft.slotOf([0,0,0]), null);
  assert.equal(hb.grid.at(-2, 7, -8).props.facing, 'north'); assert.equal(hb.grid.at(-2, 7, -7).id, 'smooth_quartz');
  const opening = V.layout.openings.find(o => o.id === 'gableS'), x = Math.floor((opening.a0 + opening.a1) / 2), z = V.layout.house.z1 - 1;
  assert.match(hb.grid.at(x, opening.y0, z).id, /glass/);
  const support = hb.boxes(hb.grid.at(x, opening.y0 - 1, z));
  assert.ok(support.length, '朝海小窗下方有实体窗台');
  const sillTop = opening.y0 - 1 + Math.max(...support.map(b => b[4]));
  const ids = ['a','b','c','d']; inv.found.scallop = { items: ids.map(uid => ({ uid, size: 130, pat: 'plain' })) };
  inv.chimes.door.strands[0] = [{ uid: 'd', gap: 4 }]; inv.chimes.window.strands[0] = ids.slice(0, 3).map(uid => ({ uid, gap: 2 }));
  V.emit('inventory:change'); root.updateMatrixWorld(true);
  const custom = win.getObjectByName('chime:craft'), box = new T.Box3().setFromObject(custom, true), dg = door.getObjectByName('chime:craft');
  assert.ok(dg && custom);
  assert.equal(V.chimeCraft.layout('window', inv.chimes.window)[0].length, 45);
  assert.ok(box.min.y - sillTop >= .35, `满长窗铃下方给花盆留了 ${(box.min.y - sillTop) * 100} 厘米`);
  assert.equal(custom.children.length, 4); assert.equal(dg.children.length, 6);
  inv.chimes.window.strands[0] = []; V.emit('inventory:change');
  assert.equal(win.getObjectByName('chime:craft'), undefined); assert.ok(win.getObjectByName('s0').visible);
  assert.equal(door.getObjectByName('chime:craft'), dg);
  assert.deepEqual(window.__errors, []);
});

test('默认和搬过的两处、只剩门或窗、全拆掉，多出来的方块保持默认', () => {
  const C = craft();
  for (const offset of [0, 23]) {
    const door = { pos: [-1.5 + offset, 3.7, -6] }, window = { pos: [-1.5 + offset, 7.7, -7] }, extra = { pos: [80, 3, 35] };
    const assign = list => C.assign(list, [-1.5 + offset, 2, -6], [-1.5 + offset, 7, -7]);
    assert.deepEqual(assign([extra, window, door]), { door, window });
    assert.deepEqual(assign([window]), { door: null, window }); assert.deepEqual(assign([door]), { door, window: null });
    assert.deepEqual(assign([]), { door: null, window: null });
  }
});

test('门铃和窗铃的真实点击能摇响并打开对应菜单，慢帧也能看见，隔墙点不到', async () => {
  let menu, opened;
  const frames = [], timers = new Map();
  const document = { readyState: 'loading', addEventListener() {}, body: { append(el) { menu = el; } },
    createElement() { return Object.assign(new EventTarget(), { style: {}, offsetWidth: 100, offsetHeight: 32, classList: { add(cls) { this[cls] = true; } },
      setAttribute() {}, append(text) { this.textContent = text; }, remove() { if (menu === this) menu = null; } }); } };
  const h = loadV3(['03-vox','12-nbt','13-share','15-mcmodel','16-mcmesh','17-mcfallback','40-layout','44-furn-mc',
    '50-scene','54-house-mc','55-house-detail','57-wind-chime-craft','58-inventory-rules','66-chime-sound'], { three: 'real', document });
  const { V3: V, window: w } = h, T = w.THREE, hb = V.houseBlocks;
  Object.assign(w, { innerWidth: 1080, innerHeight: 760, requestAnimationFrame: fn => frames.push(fn),
    setTimeout: (fn, ms) => { timers.set(fn, ms); return fn; }, clearTimeout: fn => timers.delete(fn) });
  V.hud = { mounted: true }; h.load(['69-wind-chime-editor','91-cabin']);
  V.chimeCraft.open = slot => { opened = slot; }; // 菜单按钮的终点，工作台画面由浏览器验收。
  const camera = new T.PerspectiveCamera(43, 1080 / 760, .1, 400), scene = new T.Scene(), root = new T.Group();
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1080, height: 760 }) });
  V.R = { camera, scene, canvas }; V.models.current = () => ({ id: 'house2', root, states: { floor: { value: 'all' } } });
  hb.store = { get: async () => null }; w.__V3_ASSETS = { [V.layout.house.asset]: (await readFile(new URL('../assets/house/house-v4.png', import.meta.url))).toString('base64') };
  await hb.load(); scene.add(root);
  const ctx = V.scene.ctx(root), house = V.scene.parts.find(p => p.id === 'house').build(ctx);
  root.add(house); await house.userData.houseMc.ready;
  root.add(...V.scene.parts.find(p => p.id === 'house-detail').build(ctx)); scene.updateMatrixWorld(true); V.cabinClicks();
  for (const [slot, name, sign] of [['door','house2:chime',1], ['window','house2:chimeWindow',-1]]) {
    const obj = root.getObjectByName(name), pos = obj.position, pick = obj.getObjectByName('house2:chime:pick');
    const target = new T.Vector3(pos.x, pos.y - (slot === 'window' ? .55 : .35), pos.z + sign * .22);
    camera.position.set(pos.x + .18, target.y + .07, target.z + sign * (slot === 'window' ? 1.95 : 1.5));
    camera.lookAt(target); camera.updateMatrixWorld();
    const p = pick.getWorldPosition(new T.Vector3()).project(camera), coords = { clientX: Math.round((1 + p.x) * 540), clientY: Math.round((1 - p.y) * 380) };
    const tap = () => { for (const type of ['pointerdown','pointerup']) canvas.dispatchEvent(Object.assign(new Event(type), coords, { button: 0, pointerId: 1 })); };
    assert.equal(V.cabinTargets.pick(coords)?.obj, obj); tap();
    assert.deepEqual(V.chimes.stats().last, obj.userData.cell); assert.equal(obj.userData.clinks, 1);
    assert.ok(menu?.classList['chime-menu']); assert.equal(menu.textContent, '重新串一串');
    assert.ok(Math.abs(parseFloat(menu.style.left) - coords.clientX - 8) < 1 && Math.abs(parseFloat(menu.style.top) - coords.clientY) < 1);
    assert.equal(timers.size, 0, '第一次绘制前即使经过 4.2 秒也应保留菜单');
    while (frames.length) frames.shift()();
    menu.dispatchEvent(new Event('click')); assert.equal(opened, slot);
    const [[hide, ms]] = timers; assert.equal(ms, 4200); hide(); assert.equal(menu, null);
    const wall = new T.Mesh(new T.BoxGeometry(1, 1, .1), new T.MeshBasicMaterial());
    wall.position.lerpVectors(camera.position, pick.getWorldPosition(new T.Vector3()), .5);
    scene.add(wall); wall.updateMatrixWorld(); assert.equal(V.cabinTargets.pick(coords), null); tap();
    assert.equal(menu, null); assert.equal(obj.userData.clinks, 1); wall.removeFromParent();
  }
  assert.deepEqual(w.__errors, []);
});
