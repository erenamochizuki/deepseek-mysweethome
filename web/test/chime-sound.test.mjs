import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

function setup() {
  const h = loadV3([], { three: 'real' }), V3 = h.V3;
  let enabled = true, kicks = 0, starts = 0;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ gain: param(), frequency: param(), pan: param(), connect() {}, start() { starts++; }, stop() {} });
  const audio = { state: 'running', currentTime: 0, sampleRate: 1000, destination: {}, createGain: node,
    createStereoPanner: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node,
    createBuffer: (_, n) => ({ getChannelData: () => new Float32Array(n) }) };
  V3.audio = { ctx: () => audio };
  V3.game = { get: k => k === 'chimeSound' ? enabled : 1.3 };
  V3.houseDetail = { chimeKick() { kicks++; } };
  V3.houseBlocks = { grid: { W: 2, L: 1, org: [10, 2, 20], cells: [0, 0], st: [{ ns: 'xiaojingyu', id: 'wind_chime' }] } };
  h.load(['66-chime-sound']);
  const tick = (n = 11) => { for (let i = 0; i < n; i++) V3.emit('frame', 0.1); };
  return { V3, audio, tick, mute: v => { enabled = !v; }, kicks: () => kicks, starts: () => starts };
}

test('gust sounds at the matching chime, shares cooldown with passing actor, never kicks twice', () => {
  const h = setup(), { V3, tick } = h;
  V3.actor = { pos: [0, 0, 0] }; tick(1);
  V3.emit('chime:gust', [10, 2, 20]);
  assert.deepEqual(V3.chimes.stats().last, [10, 2, 20]);
  assert.equal(V3.chimes.stats().played, 1); assert.ok(h.starts() > 0); assert.equal(h.kicks(), 0);
  V3.emit('chime:gust', [10, 2, 20]);
  V3.actor.pos = [10.5, 0, 20.5]; tick(1);
  assert.equal(V3.chimes.stats().rings, 1, 'same-cell gust and passage share cooldown');
  V3.emit('chime:gust', [11, 2, 20]);
  assert.equal(V3.chimes.stats().played, 2, 'second chime is independent');
  tick(); V3.actor.pos = [0, 0, 0]; tick(1); V3.actor.pos = [10.5, 0, 20.5]; tick(1);
  assert.equal(h.kicks(), 1); assert.equal(V3.chimes.stats().played, 3);
});

test('gust obeys audio mute, browser unlock and distance without replaying old sounds', () => {
  const h = setup(), { V3, tick } = h;
  h.mute(true); V3.emit('chime:gust', [10, 2, 20]); assert.equal(V3.chimes.stats().played, 0);
  tick(); h.mute(false); h.audio.state = 'suspended'; V3.emit('chime:gust', [10, 2, 20]); assert.equal(h.starts(), 0);
  h.audio.state = 'running'; tick(); assert.equal(h.starts(), 0, 'unlock does not replay past gusts');
  V3.R = { camera: { position: { x: 100, y: 100, z: 100 } } };
  V3.emit('chime:gust', [10, 2, 20]); assert.equal(V3.chimes.stats().played, 0);
  tick(); V3.R.camera.position = { x: 10, y: 2, z: 20 }; V3.emit('chime:gust', [10, 2, 20]);
  assert.equal(V3.chimes.stats().played, 1);
});

test('invalid/deleted chimes stay silent; rebuilding house resets stale cooldown', () => {
  const h = setup(), { V3 } = h;
  for (const cell of [null, [], [NaN, 2, 20], [10, 2, 20, 4], [99, 2, 20]]) V3.emit('chime:gust', cell);
  assert.equal(h.starts(), 0);
  V3.emit('chime:gust', [10, 2, 20]); assert.equal(V3.chimes.stats().played, 1);
  V3.houseBlocks.grid.cells = []; V3.emit('house:blocks'); V3.emit('chime:gust', [10, 2, 20]);
  assert.equal(V3.chimes.stats().played, 1);
  V3.houseBlocks.grid.cells = [0, 0]; V3.emit('house:blocks'); V3.emit('chime:gust', [10, 2, 20]);
  assert.equal(V3.chimes.stats().played, 2);
});

test('每种能挂的藏品（含超稀有）都明确指定音色，同材质越大基音越低', () => {
  const { V3 } = loadV3(['03-vox', '30-shells', '31-moon-treasures', '31-washup-catalog', '58-inventory-rules', '66-chime-sound'], { three: 'real' });
  const kinds = [...V3.shells.KINDS, ...V3.washupCatalog.collectibles].filter(V3.inventoryRules.decoratable);
  assert.equal(kinds.filter(k => k.rarity === 'ultra').length, 5);
  assert.deepEqual([...new Set(kinds.map(k => k.chime))].sort(), ['glass','metal','shell','stone','wood']);
  for (const k of kinds) {
    assert.ok(V3.chimes.timbres[k.chime], k.id);
    const hz = size => V3.chimes.pitch(k.chime, size, .5);
    assert.ok(hz(25) > hz(80) && hz(80) > hz(240), k.id);
    assert.ok(V3.chimes.pitch(k.chime, 80, .1) < V3.chimes.pitch(k.chime, 80, .9));
  }
  assert.equal(kinds.find(k => k.id === 'treasure_shell').chime, 'metal');
});

test('相邻串靠近时只取最近的一对，持续接触、隔空串和静止分离都不响', () => {
  const { V3 } = loadV3(['57-wind-chime-craft']);
  const bead = (uid, top) => ({ uid, top, bottom: top + 10, radius: .04 });
  const model = { sway: [0,0,0].map(() => ({rotation:{x:0,z:0}})), lines: [
    {x:0, items:[bead('浅',1),bead('深',18)]}, {x:18,items:[bead('右',18)]}, {x:36,items:[]}] };
  const C = V3.chimeCraft;
  assert.equal(C.contact(model), undefined);
  model.sway[0].rotation.z = .28; model.sway[1].rotation.z = -.28;
  assert.deepEqual(C.contact(model).map(b => b.uid), ['深','右']); assert.equal(C.contact(model), undefined);
  model.sway[0].rotation.z = model.sway[1].rotation.z = 0; C.contact(model);
  const heard = [];
  for (let i = 0; i < 60; i++) {
    model.lines.forEach(l => { l.length = l.items.at(-1)?.bottom || 0; });
    C.swing(model, i / 60, .3, i / 60, 1, 0); const pair = C.contact(model); if (pair) heard.push(pair);
  }
  assert.ok(heard.length > 0, '一次真实的拨动会产生接触');
  model.lines[2].items = model.lines[1].items; model.lines[1].items = [];
  assert.equal(C.contact(model), undefined);
});

test('自制款拨动后等到相碰才响，碰撞冷却、点击限制和另一处风铃独立', () => {
  const h = setup(), { V3 } = h, models = [{},{}], notes = [{chime:'wood', size:60},{chime:'glass', size:140}];
  V3.houseDetail.crafted = cell => models[cell[0] - 10];
  const a = [10,2,20], b = [11,2,20];
  V3.emit('chime:gust', a); assert.equal(h.starts(), 0);
  const collide = (i,p) => V3.chimes.contact(models[i], notes, p);
  collide(0,a); assert.equal(h.starts(), 7); collide(0,a); assert.equal(h.starts(), 7);
  collide(1,b); assert.equal(h.starts(), 14); h.tick(); collide(0,a); assert.equal(h.starts(), 21);
  assert.equal(V3.chimes.click({cell:a}), true); assert.equal(h.starts(), 21);
  collide(0,a); assert.equal(h.starts(), 28); assert.equal(V3.chimes.click({cell:a}), false);
  collide(0,a); assert.equal(h.starts(), 28); h.tick(); h.mute(true); collide(0,a); assert.equal(h.starts(), 28);
  h.mute(false); h.tick(); V3.R = { camera:{position:{x:100,y:100,z:100}} }; collide(0,a); assert.equal(h.starts(), 28);
});

test('原款每次仍按原来的四个泛音和一下敲击发声，挂空后恢复原款', () => {
  const h = setup(), { V3 } = h;
  V3.houseDetail.crafted = () => null;
  V3.emit('chime:gust', [10,2,20]); const {hits,played} = V3.chimes.stats();
  assert.ok(hits === 2 || hits === 3); assert.equal(played, 1); assert.equal(h.starts(), hits * 5);
});
