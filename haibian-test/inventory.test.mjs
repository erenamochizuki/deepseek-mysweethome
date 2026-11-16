import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createInventoryStore } from '../cabin-inventory.mjs';

const stateFile = 'cabin-inventory.json';
const route = '/api/cabin/inventory';
const isolated = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-inventory-test-'));
const plain = (x) => JSON.parse(JSON.stringify(x));
const empty = () => ({ found: {}, placements: {}, trash: 0, cleaned: 0 });
const collect = (id, at = 100, kind = 'shell', category = 'collectible') => ({ op: 'collect', id, at, kind, category });
const place = (id, slot, returnAt) => ({ op: 'place', id, kind: 'shell', slot, by: 'player', ...(returnAt === undefined ? {} : { returnAt }) });
const matches = (code, status = 409) => ({ code, status });

test('fresh reads do not write; pickup IDs dedupe across instances and reset', () => {
  const dataDir = isolated();
  const first = createInventoryStore({ dataDir });
  assert.deepEqual(plain(first.get()), { ok: true, initialized: false, rev: 0, inventory: empty() });
  assert.deepEqual(fs.readdirSync(dataDir), []);
  assert.equal(first.post(collect('beach:a', 100)).applied, true);
  const second = createInventoryStore({ dataDir });
  const replay = second.post(collect('beach:a', 102));
  assert.equal(replay.applied, false);
  assert.equal(replay.rev, 1);
  assert.equal(replay.initialized, false);
  assert.deepEqual(replay.inventory.found.shell, { n: 1, first: 100, last: 100 });
  assert.throws(() => second.post(collect('beach:a', 102, 'other')), matches('id_reused'));
  assert.throws(() => first.post({ op: 'reset', id: 'reset:a', rev: 0 }), matches('revision_mismatch'));
  assert.equal(second.post({ op: 'reset', id: 'reset:a', rev: 1 }).initialized, true);
  assert.equal(first.post({ op: 'reset', id: 'reset:a', rev: 1 }).applied, false);
  assert.equal(second.post(collect('beach:a', 103)).applied, false);
  assert.deepEqual(plain(second.get().inventory), empty());
  assert.deepEqual(fs.readdirSync(dataDir), [stateFile]);
});

test('legacy import adds once, merges date bounds, and does not latch on empty input', () => {
  const dataDir = isolated();
  const s = createInventoryStore({ dataDir });
  assert.equal(s.post({ op: 'legacy', id: 'empty', found: {} }).applied, false);
  assert.equal(s.get().initialized, false);
  s.post(collect('beach-1', 100));
  const legacy = { op: 'legacy', id: 'legacy-1', found: { shell: { n: 4, first: 20, last: 150 }, coral: { n: 3, first: 40, last: 42 } } };
  const result = s.post(legacy);
  assert.equal(result.initialized, true);
  assert.deepEqual(plain(result.inventory.found), { shell: { n: 5, first: 20, last: 150 }, coral: { n: 3, first: 40, last: 42 } });
  const reopened = createInventoryStore({ dataDir });
  assert.equal(reopened.post({ ...legacy, found: { coral: legacy.found.coral, shell: { last: 150, first: 20, n: 4 } } }).applied, false);
  assert.equal(reopened.post({ ...legacy, id: 'legacy-2' }).applied, false);
  assert.equal(reopened.get().rev, 2);
});

test('slots reserve stock; identity and due time protect girl returns, not manual ones', () => {
  let now = 100;
  const dataDir = isolated();
  const s = createInventoryStore({ dataDir, clock: () => now });
  assert.throws(() => s.post(place('p1', 'shelf')), matches('out_of_stock'));
  s.post(collect('shell-1'));
  assert.deepEqual(s.post(place('p1', 'shelf', 150)).inventory.placements.shelf,
    { id: 'p1', kind: 'shell', placedAt: 100, by: 'player', returnAt: 150 });
  assert.throws(() => s.post(place('p2', 'shelf')), matches('slot_occupied'));
  assert.throws(() => s.post(place('p2', 'table')), matches('out_of_stock'));
  const auto = { op: 'return', id: 'auto', slot: 'shelf', by: 'girl' };
  assert.throws(() => s.post(auto), matches('invalid_input', 400));
  assert.throws(() => s.post({ ...auto, expectedId: 'p1' }), matches('return_not_due'));
  assert.equal(s.post({ ...auto, id: 'manual', by: 'player' }).applied, true);
  s.post(place('p2', 'shelf', 150));
  now = 150;
  assert.throws(() => s.post({ ...auto, expectedId: 'p1' }), matches('placement_changed'));
  const reopened = createInventoryStore({ dataDir, clock: () => now });
  assert.equal(reopened.post({ ...auto, expectedId: 'p2' }).applied, true);
  assert.equal(reopened.post({ ...auto, expectedId: 'p2' }).applied, false);
  assert.equal(reopened.post(place('p3', 'shelf')).applied, true);
  assert.throws(() => reopened.post({ ...auto, id: 'not-due', expectedId: 'p3' }), matches('return_not_due'));
  assert.throws(() => reopened.post({ ...auto, id: 'manual-2', by: 'player', expectedId: 'p2' }), matches('placement_changed'));
  assert.equal(reopened.get().inventory.found.shell.n, 1);
});

test('dispose transfers only current trash and a replay cannot dispose newer trash', () => {
  const dataDir = isolated();
  const s = createInventoryStore({ dataDir });
  const d = { op: 'dispose', id: 'd1' };
  assert.equal(s.post(d).applied, true);
  s.post(collect('trash-a', 1, 'bottle', 'trash'));
  const reopened = createInventoryStore({ dataDir });
  assert.equal(reopened.post(d).inventory.trash, 1);
  assert.equal(reopened.post(collect('trash-a', 2, 'bottle', 'trash')).applied, false);
  reopened.post(collect('trash-b', 3, 'bottle', 'trash'));
  const disposed = reopened.post({ ...d, id: 'd2' });
  assert.deepEqual(plain(disposed.inventory), { ...empty(), cleaned: 2 });
});

test('restore is revision-gated, refuses to overwrite, and reidentifies restored placements', () => {
  const s = createInventoryStore({ dataDir: isolated() });
  const restore = {
    op: 'restore', id: 'restore-1', rev: 0,
    inventory: { ...empty(), found: { shell: { n: 1, first: 1, last: 1 } },
      placements: { shelf: { id: 'old-id', kind: 'shell', placedAt: 2, by: 'girl', returnAt: 3 } }, trash: 1, cleaned: 2 },
  };
  assert.throws(() => s.post({ ...restore, rev: 1 }), matches('revision_mismatch'));
  const restored = s.post(restore);
  assert.equal(restored.initialized, true);
  assert.notEqual(restored.inventory.placements.shelf.id, 'old-id');
  assert.deepEqual(plain(restored.inventory), {
    ...restore.inventory, placements: { shelf: { ...restore.inventory.placements.shelf, id: restored.inventory.placements.shelf.id } },
  });
  assert.equal(s.post(restore).applied, false);
  assert.throws(() => s.post({ ...restore, id: 'restore-2', rev: 1 }), matches('inventory_not_empty'));
  assert.throws(() => s.post({ op: 'return', id: 'stale-girl', slot: 'shelf', by: 'girl', expectedId: 'old-id' }), matches('placement_changed'));
  assert.equal(s.post({ op: 'return', id: 'new-girl', slot: 'shelf', by: 'girl', expectedId: restored.inventory.placements.shelf.id }).applied, true);
  const history = createInventoryStore({ dataDir: isolated() });
  history.post(collect('trash-a', 1, 'bottle', 'trash'));
  history.post({ op: 'dispose', id: 'cleaned' });
  assert.throws(() => history.post({ ...restore, rev: 2 }), matches('inventory_not_empty'));
});

test('bounded validation and corrupt-file failures cannot mutate the directory', () => {
  const dataDir = isolated();
  const s = createInventoryStore({ dataDir });
  for (const command of [
    collect('x'.repeat(129)), collect('newline\n'), collect('x', -1), collect('x', 100, 'constructor'),
    collect('x', 100, 'shell', 'other'), { ...collect('x'), extra: true },
    JSON.parse('{"op":"legacy","id":"bad","found":{"__proto__":{"n":1,"first":1,"last":1}}}'),
    { op: 'legacy', id: 'bad', found: { shell: { n: 1, first: 200, last: 100 } } },
    { op: 'restore', id: 'bad', rev: 0, inventory: { ...empty(), placements: { shelf: { kind: 'shell', placedAt: 1, by: 'player' } } } },
  ]) assert.throws(() => s.post(command), matches('invalid_input', 400));
  assert.deepEqual(fs.readdirSync(dataDir), []);
  const file = path.join(dataDir, stateFile);
  const corrupted = '{"v":1,"initialized":false,"rev":1,"inventory":{"found":{},"placements":{},"trash":0,"cleaned":0},"seen":{}}';
  fs.writeFileSync(file, corrupted, { flag: 'wx' });
  assert.throws(() => s.get(), matches('inventory_corrupt', 503));
  assert.throws(() => s.post(collect('x')), matches('inventory_corrupt', 503));
  assert.equal(fs.readFileSync(file, 'utf8'), corrupted);
  const privateRoot = isolated();
  const webRoot = path.join(privateRoot, 'web');
  const inside = createInventoryStore({ dataDir: path.join(webRoot, 'nested'), webRoot });
  assert.throws(() => inside.post(collect('y')), matches('inventory_unavailable', 503));
  assert.deepEqual(fs.readdirSync(privateRoot), []);
});

function call(port, { method = 'GET', headers = {}, body, chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    if (body !== undefined && !chunked) headers = { 'Content-Length': Buffer.byteLength(body), ...headers };
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (x) => chunks.push(x));
      res.on('error', reject);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, value: JSON.parse(Buffer.concat(chunks)) });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (chunked) {
      req.write(body.slice(0, 64 * 1024));
      req.end(body.slice(64 * 1024));
    } else {
      req.end(body);
    }
  });
}

test('production HTTP dispatch guards requests and commits concurrent pickups only once', async (t) => {
  const dataDir = isolated();
  const listen = http.Server.prototype.listen;
  const previousDir = process.env.CABIN_INVENTORY_DATA_DIR;
  const previousToken = process.env.CABIN_CONSOLE_TOKEN_FILE;
  let server;
  process.env.CABIN_INVENTORY_DATA_DIR = dataDir;
  process.env.CABIN_CONSOLE_TOKEN_FILE = path.join(dataDir, 'unused-console-token');
  // Import the real entrypoint in this test worker; only its bind port is replaced.
  // Port 0 lets the OS choose a free ephemeral listener, never the running cabin.
  http.Server.prototype.listen = function (_port, host, callback) {
    server = this;
    return listen.call(this, 0, host, callback);
  };
  try {
    await import('../server.mjs');
  } finally {
    http.Server.prototype.listen = listen;
    if (previousDir === undefined) delete process.env.CABIN_INVENTORY_DATA_DIR;
    else process.env.CABIN_INVENTORY_DATA_DIR = previousDir;
    if (previousToken === undefined) delete process.env.CABIN_CONSOLE_TOKEN_FILE;
    else process.env.CABIN_CONSOLE_TOKEN_FILE = previousToken;
  }
  assert.ok(server);
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  if (!server.listening) await once(server, 'listening');
  const { port } = server.address();
  assert.notEqual(port, 5194);
  t.diagnostic(`Actual ephemeral inventory test port: ${port}`);
  const origin = `http://127.0.0.1:${port}`;
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Cabin-Inventory': '1', 'Sec-Fetch-Site': 'same-origin' };
  const post = (cmd, overrides = {}) => call(port, { method: 'POST', headers, body: JSON.stringify(cmd), ...overrides });
  const invalid = async (promise, status, error) => {
    const result = await promise;
    assert.equal(result.status, status);
    assert.deepEqual(result.value, { ok: false, error });
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  };
  const get = await call(port);
  assert.equal(get.status, 200);
  assert.equal(get.headers['cache-control'], 'no-store');
  assert.equal(get.headers['cross-origin-resource-policy'], 'same-origin');
  assert.deepEqual(get.value, { ok: true, initialized: false, rev: 0, inventory: empty() });
  await invalid(call(port, { headers: { Host: `evil.test:${port}` } }), 403, 'host_forbidden');
  await invalid(call(port, { headers: { Host: '127.0.0.1:1' } }), 403, 'host_forbidden');
  await invalid(call(port, { headers: { Origin: 'null' } }), 403, 'origin_forbidden');
  await invalid(post(collect('x'), { headers: { ...headers, Origin: 'http://attacker.example' } }), 403, 'origin_forbidden');
  await invalid(post(collect('x'), { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } }), 403, 'origin_forbidden');
  await invalid(post(collect('x'), { headers: { 'Content-Type': 'application/json' } }), 403, 'csrf_header_required');
  await invalid(post(collect('x'), { headers: { ...headers, 'Content-Type': 'text/plain' } }), 415, 'json_required');
  await invalid(post(collect('x'), { body: 'not JSON' }), 400, 'invalid_json');
  await invalid(post(collect('x'), { body: ' '.repeat(129 * 1024) }), 413, 'body_too_large');
  await invalid(post(collect('x'), { body: ' '.repeat(129 * 1024), chunked: true }), 413, 'body_too_large');
  await invalid(call(port, { method: 'OPTIONS', headers: { Origin: origin } }), 405, 'method_not_allowed');
  assert.deepEqual(fs.readdirSync(dataDir), []);
  const race = await Promise.all([post(collect('same-beach-item', 100)), post(collect('same-beach-item', 110))]);
  assert.deepEqual(race.map(({ status }) => status), [200, 200]);
  assert.deepEqual(race.map(({ value }) => value.applied).sort(), [false, true]);
  assert.equal((await call(port)).value.inventory.found.shell.n, 1);
  assert.deepEqual(fs.readdirSync(dataDir), [stateFile]);
});
