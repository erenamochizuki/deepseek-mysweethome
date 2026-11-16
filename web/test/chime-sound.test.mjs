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
