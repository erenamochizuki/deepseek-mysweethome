import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

const code = fs.readFileSync(new URL('../../haibianxiaowu/haibian-v4-complete/source/web/src/89-cabin-routine.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function make({ start = '2026-11-12T00:00:00+08:00', disk = new Map(), live = false } = {}) {
  const listeners = new Map(), calls = [];
  let now = Date.parse(start), hidden = false;
  const DateClass = class extends Date { static now() { return now; } };
  const localStorage = { get length() { return disk.size; }, key: i => [...disk.keys()][i], getItem: k => disk.get(k) ?? null, setItem: (k, v) => disk.set(k, v), removeItem: k => disk.delete(k) };
  const actor = { state: 'idle', pos: [0, 0, 0], startBehavior(kind) { calls.push(kind); this.behavior = { kind }; return true; }, collect(id) { calls.push(id); return true; } };
  const V3 = { PAGE: 'home', actor, game: { live, auto: true, free: () => [{ id: 'far', kind: 'shell', x: 5, z: 3 }, { id: 'close', kind: 'shell', x: 2, z: 1 }, { id: 'trash', kind: 'trash', x: 0, z: 0 }], kind: k => ({ category: k }) }, on: (name, fn) => listeners.set(name, fn) };
  const document = { get hidden() { return hidden; }, addEventListener() {}, body: { classList: { contains: () => false } } };
  vm.runInNewContext(code, { window: { V3, __READY: true }, Date: DateClass, crypto: webcrypto, document, localStorage, navigator: {}, setInterval() {}, fetch() { throw new Error('a local behavior must not fetch directly'); } });
  return { ...V3.cabinRoutine, calls, V3, disk, actor, emit: (event, data) => listeners.get(event)?.(data), now: () => now, advance: ms => { now += ms; }, hide: on => { hidden = on; } };
}
const success = data => ({ ok: true, data: { ok: true, reply: { text: '好。' }, ...data } });

test('actual behaviors only: missing local ACK retries the same IDs, chat alone never clears them', async () => {
  const m = make(), sent = [];
  let ack = false;
  m.emit('actor:behavior', { kind: 'draw', phase: 'started' });
  m.emit('actor:behavior', { kind: 'draw', phase: 'cancelled' });
  m.emit('game:collect', { by: 'player', kind: { category: 'shell' } });
  m.emit('game:collect', { by: 'girl', kind: { category: 'trash' } });
  m.emit('game:collect', { by: 'girl', kind: { category: 'shell' } });
  const shellAt = m.now();
  m.advance(1);
  m.emit('actor:behavior', { kind: 'read', phase: 'action' });
  m.setUploader(rows => {
    sent.push(plain(rows));
    return ack ? { ok: true, data: { ok: true, ackIds: rows.map(r => r.id) } } : { ok: false };
  });
  await m.chat(rows => { assert.equal(rows, undefined); return success({ cabinBehaviorLogAck: true }); });
  assert.equal(m.disk.size, 2);
  ack = true;
  await m.chat(rows => { assert.equal(rows, undefined); return { ok: false }; });
  assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(sent[0].map(({ at, action }) => ({ at, action })), [{ at: shellAt, action: 'shell' }, { at: m.now(), action: 'read' }]);
  assert.ok(sent[0].every(r => /^[0-9a-f-]{36}$/i.test(r.id)));
  assert.equal(m.disk.size, 0, 'local ACK is independent of model availability');
});

test('new records during upload survive the older ACK; reload retries and keeps queue bounded', async () => {
  const m = make();
  m.emit('game:collect', { by: 'girl', kind: {} });
  let resolveFirst, first, sendCount = 0;
  m.setUploader(rows => {
    if (++sendCount > 1) return { ok: false };
    first = plain(rows);
    return new Promise(resolve => { resolveFirst = resolve; });
  });
  await Promise.resolve();
  m.advance(10); m.emit('actor:behavior', { kind: 'draw', phase: 'action' });
  assert.equal(m.disk.size, 2);
  resolveFirst({ ok: true, data: { ok: true, ackIds: [first[0].id] } });
  await m.chat(() => success({}));
  assert.equal(m.disk.size, 1);
  const n = make({ disk: m.disk });
  let restored;
  n.setUploader(rows => { restored = plain(rows); return { ok: false }; });
  await n.chat(() => success({}));
  assert.deepEqual(restored.map(({ at, action }) => ({ at, action })), [{ at: m.now(), action: 'draw' }]);
  for (let i = 0; i < 26; i++) { n.advance(100); n.emit('game:collect', { by: 'girl', kind: {} }); }
  await n.chat(() => success({}));
  assert.equal(restored.length, 24);
  assert.ok(restored.every(r => r.action === 'shell'));
});

test('Shanghai lunch starts only in window and is skipped on same day after completion, not cancellation', () => {
  const m = make({ start: '2026-11-12T11:29:59+08:00', live: true });
  m.tick(); assert.deepEqual(m.calls, []);
  m.advance(1000); m.tick(); assert.deepEqual(m.calls, ['eat']);
  m.emit('actor:behavior', { kind: 'eat', phase: 'cancelled' });
  m.actor.behavior = null; m.advance(5001); m.tick(); assert.deepEqual(m.calls, ['eat', 'eat']);
  m.emit('actor:behavior', { kind: 'eat', phase: 'completed' });
  const n = make({ start: '2026-11-12T12:00:00+08:00', disk: m.disk, live: true });
  n.tick(); assert.deepEqual(n.calls, []);
  n.advance(4 * 60000); n.tick(); assert.deepEqual(n.calls, ['read']);
  const tomorrow = make({ start: '2026-11-13T12:00:00+08:00', disk: m.disk, live: true });
  tomorrow.tick(); assert.deepEqual(tomorrow.calls, ['eat']);
});

test('accepts only fresh allowed external events and successful typed AI actions, defers during occupation', async () => {
  const m = make(); m.advance(1000);
  const now = m.now();
  const fresh = { action: 'reply_private', at: now, id: 'x' };
  m.actor.state = 'furniture';
  m.acceptEvents([fresh, { action: 'draw', id: 'old', at: now - 2000 }, { action: 'send_qq', id: 'bad', at: now }, { action: 'meal', id: 'no', at: now }]);
  assert.deepEqual(m.calls, []);
  m.actor.state = 'idle'; m.tick(); assert.deepEqual(m.calls, ['reply_private']);
  m.actor.behavior = null; m.acceptEvents([fresh]); assert.deepEqual(m.calls, ['reply_private']);
  await m.chat(() => success({ cabinAction: 'shell' })); m.tick();
  assert.deepEqual(m.calls, ['reply_private', 'close']);
  await m.chat(() => success({ cabinAction: 'constructor' })); m.tick();
  assert.equal(m.calls.length, 2);
});
