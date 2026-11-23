// cabin-inventory v2（规则在 inventory-rules.mjs）的服务端行为测试。
// 相对 v1 的变化：inventory 多了 coins/snacks/tray；found[kind] 带 items[]（n === items.length）；
// 每枚贝壳有独立 uid/size/pat；dispose/sell/buy/consume/tray_set 是新增 op；错误码按 rules 的 InventoryError。
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createInventoryStore } from '../integration/cabin-inventory.mjs';
import Rules from '../web/dist/inventory-rules.mjs';

const stateFile = 'cabin-inventory.json';
const route = '/api/cabin/inventory';
const isolated = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-inventory-test-'));
const plain = (x) => JSON.parse(JSON.stringify(x));
// 第五版（2026-11-21）：风铃（门/窗）与窗台小花盆进存档；鱼缸住户带 releasedAt，潮湾放宽到 33 浅海鱼。
const emptyChimes = () => ({
  door: { rev: 0, bar: 'driftwood', strands: [[], [], [], [], []] },
  window: { rev: 0, bar: 'driftwood', strands: [[], [], []] },
});
const emptyGarden = () => ({ seeds: {}, seen: [], bloomed: {}, pot: null });
const emptyShore = { gift: null, loan: null, memory: null, berth: null, fish: [], observed: [], lastCatch: -1, tankTier: 0, released: [] };
const empty = () => ({ found: {}, placements: {}, trash: 0, cleaned: 0, coins: 0, snacks: [], tray: { rev: 0, items: [] }, shore: emptyShore, chimes: emptyChimes(), garden: emptyGarden() });
const collect = (id, at = 100, kind = 'shell', category = 'collectible') => ({ op: 'collect', id, at, kind, category });
const place = (id, slot, returnAt) => ({ op: 'place', id, kind: 'shell', slot, by: 'player', ...(returnAt === undefined ? {} : { returnAt }) });
const matches = (code, status = 409) => ({ code, status });
// v2 的 collect 会补 size/pat（同一个 id 永远同一个结果）；测试只固定 uid/at，size 对未知种类是 0。
const item = (row, uid, at) => {
  const it = row.items.find((x) => x.uid === uid);
  assert.ok(it, 'item ' + uid + ' exists');
  assert.equal(it.at, at);
  assert.equal(typeof it.size, 'number');
  assert.equal(typeof it.pat, 'string');
  return it;
};

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
  const row = replay.inventory.found.shell;
  assert.deepEqual({ n: row.n, first: row.first, last: row.last }, { n: 1, first: 100, last: 100 });
  assert.equal(row.items.length, 1);
  item(row, 'beach:a', 100);
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
  const found = result.inventory.found;
  assert.deepEqual({ n: found.shell.n, first: found.shell.first, last: found.shell.last }, { n: 5, first: 20, last: 150 });
  assert.equal(found.shell.items.length, 5);
  assert.deepEqual({ n: found.coral.n, first: found.coral.first, last: found.coral.last }, { n: 3, first: 40, last: 42 });
  assert.deepEqual(found.coral.items.map((x) => x.uid).sort(), ['legacy:coral:0', 'legacy:coral:1', 'legacy:coral:2']);
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
  const placed = s.post(place('p1', 'shelf', 150)).inventory.placements.shelf;
  assert.deepEqual(plain(placed), { id: 'p1', kind: 'shell', uid: 'shell-1', placedAt: 100, by: 'player', returnAt: 150 });
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

test('dispose transfers only current trash, earns coins, and a replay cannot dispose newer trash', () => {
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
  assert.deepEqual({ disposed: disposed.disposed, earned: disposed.earned }, { disposed: 2, earned: 2 });
  assert.deepEqual(plain(disposed.inventory), { ...empty(), cleaned: 2, coins: 2 });
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
  assert.equal(restored.inventory.placements.shelf.uid, 'legacy:shell:0');
  assert.deepEqual(plain(restored.inventory).found.shell.items.map((x) => x.uid), ['legacy:shell:0']);
  assert.equal(restored.inventory.coins, 0);
  assert.deepEqual(plain(restored.inventory.tray), { rev: 0, items: [] });
  assert.deepEqual({ trash: restored.inventory.trash, cleaned: restored.inventory.cleaned }, { trash: 1, cleaned: 2 });
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
  const corrupted = '{"v":2,"initialized":false,"rev":1,"inventory":';
  fs.writeFileSync(file, corrupted, { flag: 'wx' });
  assert.throws(() => s.get(), matches('inventory_corrupt', 503));
  assert.throws(() => s.post(collect('x')), matches('inventory_corrupt', 503));
  assert.equal(fs.readFileSync(file, 'utf8'), corrupted);
  // v1 文件读进来会自动升级成 v2（下次落盘才是 v2，读的时候不写盘）。
  const upgraded = createInventoryStore({ dataDir: isolated() });
  const v1Dir = isolated();
  fs.writeFileSync(path.join(v1Dir, stateFile), JSON.stringify({
    v: 1, initialized: true, rev: 5,
    inventory: { found: { shell: { n: 1, first: 10, last: 10 } }, placements: {}, trash: 0, cleaned: 0 },
    seen: {},
  }));
  const v1 = createInventoryStore({ dataDir: v1Dir }).get();
  assert.deepEqual(Object.keys(v1.inventory).sort(), ['chimes', 'cleaned', 'coins', 'found', 'garden', 'placements', 'shore', 'snacks', 'trash', 'tray']);
  assert.deepEqual(v1.inventory.found.shell.items.map((x) => x.uid), ['legacy:shell:0']);
  assert.equal(v1.rev, 5);
  assert.equal(upgraded.get().rev, 0);
  const privateRoot = isolated();
  const webRoot = path.join(privateRoot, 'web');
  const inside = createInventoryStore({ dataDir: path.join(webRoot, 'nested'), webRoot });
  assert.throws(() => inside.post(collect('y')), matches('inventory_unavailable', 503));
  assert.deepEqual(fs.readdirSync(privateRoot), []);
});

function call(port, { method = 'GET', headers = {}, body, chunked = false, requestPath = route } = {}) {
  return new Promise((resolve, reject) => {
    if (body !== undefined && !chunked) headers = { 'Content-Length': Buffer.byteLength(body), ...headers };
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers }, (res) => {
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
    await import('../integration/server.mjs');
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
  t.diagnostic('Actual ephemeral inventory test port: ' + port);
  const origin = 'http://127.0.0.1:' + port;
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
  const summary = await call(port, { requestPath: '/api/cabin/assistant-summary' });
  assert.equal(summary.status, 200);
  assert.deepEqual(summary.value, {
    ok: true, rev: 0, coins: 0,
    snacks: { packages: 0, portions: 0, items: [] },
    fish: { count: 0, residents: [], observedKinds: [] },
    collectibles: { kinds: 0, total: 0, items: [] },
  });
  const summaryPost = await call(port, { method: 'POST', requestPath: '/api/cabin/assistant-summary', headers });
  assert.equal(summaryPost.status, 405);
  assert.deepEqual(summaryPost.value, { ok: false, error: 'method_not_allowed' });
  await invalid(call(port, { headers: { Host: 'evil.test:' + port } }), 403, 'host_forbidden');
  await invalid(call(port, { headers: { Host: '127.0.0.1:1' } }), 403, 'host_forbidden');
  await invalid(call(port, { headers: { Origin: 'null' } }), 403, 'origin_forbidden');
  await invalid(post(collect('x'), { headers: { ...headers, Origin: 'http://attacker.example' } }), 403, 'origin_forbidden');
  await invalid(post(collect('x'), { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } }), 403, 'origin_forbidden');
  await invalid(post(collect('x'), { headers: { 'Content-Type': 'application/json' } }), 403, 'csrf_header_required');
  await invalid(post(collect('x'), { headers: { ...headers, 'Content-Type': 'text/plain' } }), 415, 'json_required');
  await invalid(post(collect('x'), { body: 'not JSON' }), 400, 'invalid_json');
  // v2 服务端 MAX_BODY = 256 KiB（v1 是 128 KiB）。
  await invalid(post(collect('x'), { body: ' '.repeat(257 * 1024) }), 413, 'body_too_large');
  await invalid(post(collect('x'), { body: ' '.repeat(257 * 1024), chunked: true }), 413, 'body_too_large');
  await invalid(call(port, { method: 'OPTIONS', headers: { Origin: origin } }), 405, 'method_not_allowed');
  assert.deepEqual(fs.readdirSync(dataDir), []);
  const race = await Promise.all([post(collect('same-beach-item', 100)), post(collect('same-beach-item', 110))]);
  assert.deepEqual(race.map(({ status }) => status), [200, 200]);
  assert.deepEqual(race.map(({ value }) => value.applied).sort(), [false, true]);
  const after = (await call(port)).value.inventory.found.shell;
  assert.equal(after.n, 1);
  assert.equal(after.items.length, 1);
  const currentSummary = await call(port, { requestPath: '/api/cabin/assistant-summary' });
  assert.equal(currentSummary.value.coins, 0);
  assert.equal(currentSummary.value.collectibles.items.find((item) => item.kind === 'shell').available, 1);
  assert.equal('inventory' in currentSummary.value, false);
  assert.equal('seen' in currentSummary.value, false);
  assert.equal(JSON.stringify(currentSummary.value).includes('same-beach-item'), false);
  assert.deepEqual(fs.readdirSync(dataDir), [stateFile]);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, stateFile), 'utf8'));
  assert.equal(onDisk.v, 2);
  assert.equal('coins' in onDisk.inventory, true);
});

// ---------------------------------------------------------------------------
// 海边邻居扩展（shore）：gift / loan / berth / catch / fish，以及旧档升级出空 shore。
// 只新增用例，不改动上面的断言。
// ---------------------------------------------------------------------------
const SHORE_T0 = Date.UTC(2026, 10, 18, 3, 10); // 2026-11-18 11:10 Asia/Shanghai → 上午班
const FISH_KINDS = Object.keys(Rules.FISH); // 第二版 14 种浅海鱼
const halfDayOf = (at, zone = 'Asia/Shanghai') => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}/${+p.hour < 12 ? 'am' : 'pm'}`;
};
const encounterOf = (at) => Math.floor(at / 300000);
// 第五版鱼缸按鱼种占格（虾虎 1 格 … 沙纹鳐 4 格，小海豚 6 格）：原木小缸只有 3 格，
// 想“三尾塞满再溢出”就只能捞 1 格的鱼。测试把班次推到下一个 1 格鱼的遭遇。
const isSmallFish = (epoch) => Rules.fishSlots(Rules.fishAt(epoch)) === 1;
const nextSmallFish = (from) => {
  let at = from;
  do { at += 300000; } while (!isSmallFish(encounterOf(at)));
  return at;
};

test('shore: new and v1 saves expose an empty shore record and upgrade without corrupt', () => {
  const fresh = createInventoryStore({ dataDir: isolated(), clock: () => SHORE_T0 }).get();
  assert.deepEqual(plain(fresh.inventory).shore, emptyShore);

  const v1Dir = isolated();
  const v1File = path.join(v1Dir, stateFile);
  const v1Raw = JSON.stringify({ v: 1, initialized: true, rev: 5,
    inventory: { found: { moon: { n: 2, first: 10, last: 20 } }, placements: {}, trash: 0, cleaned: 0 }, seen: {} });
  fs.writeFileSync(v1File, v1Raw);
  const store = createInventoryStore({ dataDir: v1Dir, clock: () => SHORE_T0 });
  const upgraded = store.get();
  assert.equal(upgraded.rev, 5);
  assert.deepEqual(Object.keys(upgraded.inventory).sort(), ['chimes', 'cleaned', 'coins', 'found', 'garden', 'placements', 'shore', 'snacks', 'trash', 'tray']);
  assert.deepEqual(plain(upgraded.inventory).shore, emptyShore);
  assert.equal(upgraded.inventory.coins, 0);
  assert.deepEqual(plain(upgraded.inventory).found.moon.items.map((x) => x.uid), ['legacy:moon:0', 'legacy:moon:1']);
  assert.equal(fs.readFileSync(v1File, 'utf8'), v1Raw); // 读升级不落盘
  const gifted = store.post({ op: 'shore_gift', id: 'gift-after-upgrade', zone: 'Asia/Shanghai', slot: halfDayOf(SHORE_T0) });
  assert.equal(gifted.applied, true);
  assert.equal(gifted.inventory.coins, 1);
  const onDisk = JSON.parse(fs.readFileSync(v1File, 'utf8'));
  assert.equal(onDisk.v, 2);
  assert.equal(onDisk.inventory.coins, 1);
  assert.deepEqual(onDisk.inventory.shore, { ...emptyShore, gift: { zone: 'Asia/Shanghai', slot: halfDayOf(SHORE_T0) } });
  assert.deepEqual(onDisk.inventory.found.moon.items.map((x) => x.uid), ['legacy:moon:0', 'legacy:moon:1']);
});

test('shore_gift pays once per half-day shift and replays idempotently', () => {
  let now = SHORE_T0;
  const store = createInventoryStore({ dataDir: isolated(), clock: () => now });
  const morning = halfDayOf(now);
  assert.equal(morning.endsWith('/am'), true);
  const first = store.post({ op: 'shore_gift', id: 'gift-1', zone: 'Asia/Shanghai', slot: morning });
  assert.equal(first.applied, true);
  assert.equal(first.earned, 1);
  assert.equal(first.inventory.coins, 1);
  assert.deepEqual(plain(first.inventory).shore.gift, { zone: 'Asia/Shanghai', slot: morning });
  const replay = store.post({ op: 'shore_gift', id: 'gift-1', zone: 'Asia/Shanghai', slot: morning });
  assert.equal(replay.applied, false);
  assert.equal(replay.rev, first.rev);
  assert.equal(replay.inventory.coins, 1);
  assert.throws(() => store.post({ op: 'shore_gift', id: 'gift-bad-slot', zone: 'Asia/Shanghai', slot: '2000-01-01/am' }), matches('shift_changed'));
  assert.throws(() => store.post({ op: 'shore_gift', id: 'gift-bad-zone', zone: 'UTC', slot: halfDayOf(now, 'UTC') }), matches('shift_changed'));
  assert.equal(store.get().inventory.coins, 1);
  now += 6 * 3600 * 1000; // 17:10 → 下午班
  assert.equal(halfDayOf(now).endsWith('/pm'), true);
  const second = store.post({ op: 'shore_gift', id: 'gift-2', zone: 'Asia/Shanghai', slot: halfDayOf(now) });
  assert.equal(second.applied, true);
  assert.equal(second.inventory.coins, 2);
  now += 12 * 3600 * 1000; // 次日 05:10 → 上午班
  const third = store.post({ op: 'shore_gift', id: 'gift-3', zone: 'Asia/Shanghai', slot: halfDayOf(now) });
  assert.equal(third.applied, true);
  assert.equal(third.inventory.coins, 3);
});

test('shore_loan borrows only a free moon/top_shell shell and keeps the first memory', () => {
  const store = createInventoryStore({ dataDir: isolated(), clock: () => SHORE_T0 });
  for (const [id, kind] of [['moon-a', 'moon'], ['top-a', 'top_shell'], ['scallop-a', 'scallop']]) {
    assert.equal(store.post({ op: 'collect', id, kind, at: 100, category: 'collectible' }).applied, true);
  }
  const take = store.post({ op: 'shore_loan', id: 'loan-take', next: 'moon-a', expected: null });
  assert.equal(take.applied, true);
  assert.equal(take.loan, 'moon-a');
  const memory = plain(take.inventory).shore.memory;
  assert.equal(memory.uid, 'moon-a');
  assert.equal(memory.kind, 'moon');
  assert.equal(typeof memory.pat, 'string');
  assert.equal(typeof memory.size, 'number');
  assert.equal(memory.at, SHORE_T0);
  const same = store.post({ op: 'shore_loan', id: 'loan-same', next: 'moon-a', expected: 'moon-a' });
  assert.equal(same.applied, false);
  assert.equal(same.inventory.shore.loan, 'moon-a');
  assert.throws(() => store.post({ op: 'shore_loan', id: 'loan-stale', next: null, expected: null }), matches('shore_changed'));
  assert.throws(() => store.post({ op: 'shore_loan', id: 'loan-wrong-kind', next: 'scallop-a', expected: 'moon-a' }), matches('shell_unsuitable'));
  const release = store.post({ op: 'shore_loan', id: 'loan-release', next: null, expected: 'moon-a' });
  assert.equal(release.applied, true);
  assert.equal(release.inventory.shore.loan, null);
  assert.equal(release.inventory.shore.memory.uid, 'moon-a');
  store.post({ op: 'place', id: 'place-moon', kind: 'moon', slot: 'shelf', by: 'player' });
  assert.throws(() => store.post({ op: 'shore_loan', id: 'loan-in-use', next: 'moon-a', expected: null }), matches('in_use'));
  const top = store.post({ op: 'shore_loan', id: 'loan-top', next: 'top-a', expected: null });
  assert.equal(top.applied, true);
  assert.equal(top.inventory.shore.loan, 'top-a');
  assert.equal(top.inventory.shore.memory.uid, 'moon-a'); // 纪念保留第一次那枚
});

test('shore_berth swaps the tank perch with an expected-value guard', () => {
  const store = createInventoryStore({ dataDir: isolated(), clock: () => SHORE_T0 });
  const set = store.post({ op: 'shore_berth', id: 'berth-set', next: 'tank-a', expected: null });
  assert.equal(set.applied, true);
  assert.equal(set.berth, 'tank-a');
  assert.equal(set.inventory.shore.berth, 'tank-a');
  assert.throws(() => store.post({ op: 'shore_berth', id: 'berth-stale', next: null, expected: 'tank-b' }), matches('shore_changed'));
  assert.equal(store.get().inventory.shore.berth, 'tank-a');
  const clear = store.post({ op: 'shore_berth', id: 'berth-clear', next: null, expected: 'tank-a' });
  assert.equal(clear.applied, true);
  assert.equal(clear.inventory.shore.berth, null);
});

test('shore_catch observes once per encounter, then stocks/renames/feeds/releases tank fish', () => {
  let now = SHORE_T0;
  const dataDir = isolated();
  const store = createInventoryStore({ dataDir, clock: () => now });
  store.post({ op: 'shore_berth', id: 'berth-a', next: 'tank-a', expected: null });
  const e1 = encounterOf(now);
  assert.throws(() => store.post({ op: 'shore_catch', id: 'catch-wrong-berth', epoch: e1, berth: 'tank-b' }), matches('shore_changed'));
  assert.throws(() => store.post({ op: 'shore_catch', id: 'catch-past', epoch: e1 - 1, berth: null }), matches('fish_gone'));
  const observe = store.post({ op: 'shore_catch', id: 'catch-observe', epoch: e1, berth: null });
  assert.equal(observe.applied, true);
  assert.equal(FISH_KINDS.includes(observe.kind), true);
  assert.deepEqual(observe.inventory.shore.observed, [observe.kind]);
  assert.equal(observe.inventory.shore.fish.length, 0);
  assert.equal(observe.inventory.shore.lastCatch, e1);
  assert.throws(() => store.post({ op: 'shore_catch', id: 'catch-again', epoch: e1, berth: null }), matches('fish_gone'));
  now = nextSmallFish(now);
  const e2 = encounterOf(now);
  assert.ok(e2 > e1);
  const caught = store.post({ op: 'shore_catch', id: 'catch-tank', epoch: e2, berth: 'tank-a' });
  assert.equal(caught.applied, true);
  const residents = plain(caught.inventory).shore.fish;
  assert.equal(residents.length, 1);
  const caughtForm = Rules.fishFormAt(caught.kind, e2);
  assert.deepEqual(residents[0], { uid: 'fish:' + e2, kind: caught.kind, name: '', fed: 0, caughtAt: now, ...(caughtForm === 'base' ? {} : { form: caughtForm }) });
  const named = store.post({ op: 'shore_fish', id: 'fish-name', uid: 'fish:' + e2, action: 'name', name: '小黑' });
  assert.equal(named.applied, true);
  assert.equal(named.inventory.shore.fish[0].name, '小黑');
  now += 1000;
  const fed = store.post({ op: 'shore_fish', id: 'fish-feed', uid: 'fish:' + e2, action: 'feed' });
  assert.equal(fed.inventory.shore.fish[0].fed, now);
  assert.throws(() => store.post({ op: 'shore_fish', id: 'fish-name-missing', uid: 'fish:' + e2, action: 'name' }), matches('invalid_input', 400));
  assert.throws(() => store.post({ op: 'shore_fish', id: 'fish-unknown', uid: 'fish:1', action: 'feed' }), matches('fish_gone'));
  now = nextSmallFish(now);
  store.post({ op: 'shore_catch', id: 'catch-2', epoch: encounterOf(now), berth: 'tank-a' });
  now = nextSmallFish(now);
  const e4 = encounterOf(now);
  store.post({ op: 'shore_catch', id: 'catch-3', epoch: e4, berth: 'tank-a' });
  assert.equal(store.get().inventory.shore.fish.length, 3);
  now = nextSmallFish(now);
  assert.throws(() => store.post({ op: 'shore_catch', id: 'catch-4', epoch: encounterOf(now), berth: 'tank-a' }), matches('tank_full'));
  const released = store.post({ op: 'shore_fish', id: 'fish-release', uid: 'fish:' + e4, action: 'release' });
  assert.equal(released.applied, true);
  assert.equal(released.inventory.shore.fish.length, 2);
  assert.equal(released.inventory.shore.fish.some((f) => f.uid === 'fish:' + e4), false);
  assert.equal(released.inventory.shore.observed.includes(caught.kind), true); // 放归后观察册仍记得
  assert.throws(() => store.post({ op: 'shore_fish', id: 'fish-gone', uid: 'fish:' + e4, action: 'release' }), matches('fish_gone'));
  // 重新打开：住户和名字都在；get 不写盘。
  const file = path.join(dataDir, stateFile);
  const before = fs.readFileSync(file, 'utf8');
  const reopened = createInventoryStore({ dataDir, clock: () => now }).get();
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(reopened.inventory.shore.fish.length, 2);
  assert.equal(reopened.inventory.shore.fish.some((f) => f.uid === 'fish:' + e2 && f.name === '小黑'), true);
});

// ---------------------------------------------------------------------------
// 第二版：14 浅海鱼 + 6 远礁鱼（图鉴 20 种）、8 种借壳、shore_watch、shore_catch 可选 kind。
// 第四版（2026-11-19）：20 浅海鱼 + 10 远礁鱼（图鉴 30 种）、11 种借壳；7 种鱼带第二套花色。
// 第五版（2026-11-21）：33 浅海鱼 + 10 远礁鱼（图鉴 43 种），含折帆/雨铃/月蚀鳐/驮岛鱼与潮湾大缸。
// 只新增用例；上面的断言一条不动。
// ---------------------------------------------------------------------------
const REEF_KINDS = Object.keys(Rules.REEF_FISH);
const ALL_FISH = [...Object.keys(Rules.FISH), ...Object.keys(Rules.REEF_FISH)];

test('fish guide covers 33 shallows + 10 reef, and observed is capped at 43', () => {
  assert.equal(Object.keys(Rules.FISH).length, 33);
  assert.equal(REEF_KINDS.length, 10);
  assert.equal(ALL_FISH.length, 43);
  assert.equal(Rules.SHELL_LOANS.length, 11);
  assert.equal(Object.values(Rules.FISH_FORMS).reduce((n, forms) => n + Object.keys(forms).length, 0), 7, '7 款异色');
  const emptyStore = createInventoryStore({ dataDir: isolated(), clock: () => SHORE_T0 });
  assert.deepEqual(emptyStore.get().inventory.shore.observed, []);
  // 满 43 种的观察册能被读回
  const dataDir = isolated();
  const file = path.join(dataDir, stateFile);
  const state = {
    v: 2, initialized: true, rev: 3, seen: {},
    inventory: { found: {}, placements: {}, trash: 0, cleaned: 0, coins: 0, snacks: [], tray: { rev: 0, items: [] },
      shore: { ...emptyShore, observed: ALL_FISH } },
  };
  fs.writeFileSync(file, JSON.stringify(state));
  assert.deepEqual(createInventoryStore({ dataDir }).get().inventory.shore.observed, ALL_FISH);
  // 第 44 种（未知鱼）读不进来
  state.inventory.shore.observed = [...ALL_FISH, 'unknown_fish'];
  fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => createInventoryStore({ dataDir }).get(), matches('inventory_corrupt', 503));
  // 重复的鱼种同样不接受
  state.inventory.shore.observed = [...ALL_FISH.slice(0, 19), ALL_FISH[0]];
  fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => createInventoryStore({ dataDir }).get(), matches('inventory_corrupt', 503));
});

test('shore_watch records only this encounter batch, once per kind, without touching the tank', () => {
  let now = SHORE_T0;
  const store = createInventoryStore({ dataDir: isolated(), clock: () => now });
  const e = encounterOf(now);
  const batch = Rules.reefAt(e);
  assert.equal(batch.length, 3);
  assert.equal(new Set(batch).size, 3);
  assert.equal(batch.every((k) => REEF_KINDS.includes(k)), true);
  const kind = batch[0];
  const first = store.post({ op: 'shore_watch', id: 'watch-1', epoch: e, kind });
  assert.equal(first.applied, true);
  assert.equal(first.kind, kind);
  assert.deepEqual(first.inventory.shore.observed, [kind]);
  assert.equal(first.inventory.shore.lastCatch, -1);
  assert.equal(first.inventory.shore.fish.length, 0);
  const replay = store.post({ op: 'shore_watch', id: 'watch-2', epoch: e, kind });
  assert.equal(replay.applied, false);
  assert.equal(replay.rev, first.rev);
  assert.deepEqual(replay.inventory.shore.observed, [kind]);
  const notNow = REEF_KINDS.find((k) => !batch.includes(k));
  assert.throws(() => store.post({ op: 'shore_watch', id: 'watch-3', epoch: e, kind: notNow }), matches('fish_gone'));
  assert.throws(() => store.post({ op: 'shore_watch', id: 'watch-4', epoch: e - 1, kind: Rules.reefAt(e - 1)[0] }), matches('fish_gone'));
  assert.throws(() => store.post({ op: 'shore_watch', id: 'watch-5', epoch: e, kind: Object.keys(Rules.FISH)[0] }), matches('invalid_input', 400));
  assert.equal(store.get().rev, first.rev);
  // 换一班还能记别的礁鱼（不占鱼缸、不消耗抄网）
  now += 300000;
  const e2 = encounterOf(now);
  const more = Rules.reefAt(e2).filter((k) => k !== kind);
  assert.ok(more.length > 0);
  store.post({ op: 'shore_watch', id: 'watch-6', epoch: e2, kind: more[0] });
  assert.equal(store.get().inventory.shore.observed.includes(more[0]), true);
  assert.equal(store.get().inventory.shore.fish.length, 0);
});

test('shore_catch optional kind must match the shallows draw of that encounter', () => {
  let now = SHORE_T0;
  const store = createInventoryStore({ dataDir: isolated(), clock: () => now });
  const e1 = encounterOf(now);
  const expected1 = Rules.fishAt(e1);
  const wrong = Object.keys(Rules.FISH).find((k) => k !== expected1);
  assert.throws(() => store.post({ op: 'shore_catch', id: 'kind-wrong', epoch: e1, berth: null, kind: wrong }), matches('fish_gone'));
  assert.equal(store.get().rev, 0); // 冲突不消耗班次、不落盘
  const ok = store.post({ op: 'shore_catch', id: 'kind-ok', epoch: e1, berth: null, kind: expected1 });
  assert.equal(ok.applied, true);
  assert.equal(ok.kind, expected1);
  assert.equal(ok.inventory.shore.lastCatch, e1);
  assert.throws(() => store.post({ op: 'shore_catch', id: 'kind-reef', epoch: e1 + 1, berth: null, kind: REEF_KINDS[0] }), matches('invalid_input', 400));
  // 下一班：带 kind + berth 入缸。原木小缸只有 3 格，把班次推到能装下的鱼（≤3 格）。
  now = (e1 + 1) * 300000 + 1000;
  while (Rules.fishSlots(Rules.fishAt(encounterOf(now))) > 3) now += 300000;
  const e2 = encounterOf(now);
  const expected2 = Rules.fishAt(e2);
  store.post({ op: 'shore_berth', id: 'kind-berth', next: 'tank-kind', expected: null });
  const tank = store.post({ op: 'shore_catch', id: 'kind-tank', epoch: e2, berth: 'tank-kind', kind: expected2 });
  assert.equal(tank.applied, true);
  assert.equal(tank.inventory.shore.fish.length, 1);
  const tankForm = Rules.fishFormAt(expected2, e2);
  assert.deepEqual(plain(tank.inventory).shore.fish[0], { uid: 'fish:' + e2, kind: expected2, name: '', fed: 0, caughtAt: now, ...(tankForm === 'base' ? {} : { form: tankForm }) });
});

test('second edition: all 11 shell kinds can be borrowed, others are refused', () => {
  const store = createInventoryStore({ dataDir: isolated(), clock: () => SHORE_T0 });
  const kinds = Rules.SHELL_LOANS.slice();
  assert.deepEqual(kinds, ['moon', 'top_shell', 'nassa', 'periwinkle', 'wentletrap', 'carrier_shell', 'violet_snail', 'conch', 'nautilus', 'sundial', 'miter']);
  const uids = {};
  for (const kind of kinds) {
    uids[kind] = 'loan2-' + kind;
    assert.equal(store.post({ op: 'collect', id: uids[kind], kind, at: 100, category: 'collectible' }).applied, true);
  }
  store.post({ op: 'collect', id: 'loan2-scallop', kind: 'scallop', at: 100, category: 'collectible' });
  let current = null;
  for (const kind of kinds) { // 每次换壳都会归还上一枚
    const res = store.post({ op: 'shore_loan', id: 'loan2-switch-' + kind, next: uids[kind], expected: current });
    assert.equal(res.applied, true);
    assert.equal(res.loan, uids[kind]);
    assert.equal(res.inventory.shore.loan, uids[kind]);
    current = uids[kind];
  }
  assert.equal(store.get().inventory.shore.memory.uid, uids[kinds[0]]); // 纪念留第一次那枚
  assert.throws(() => store.post({ op: 'shore_loan', id: 'loan2-bad-shell', next: 'loan2-scallop', expected: current }), matches('shell_unsuitable'));
  const back = store.post({ op: 'shore_loan', id: 'loan2-back', next: uids.moon, expected: current });
  assert.equal(back.applied, true);
  assert.equal(back.inventory.shore.loan, uids.moon);
  assert.equal(back.inventory.shore.memory.uid, uids[kinds[0]]);
});

test('chime and window-garden saves round-trip through the server', () => {
  const now = SHORE_T0;
  const dataDir = isolated();
  const store = createInventoryStore({ dataDir, clock: () => now });
  assert.equal(store.post({ op: 'collect', id: 'chime-bead', kind: 'scallop', at: 100, category: 'collectible' }).applied, true);
  const set = store.post({
    op: 'chime_set', id: 'chime-1', slot: 'door', base: 0, bar: 'driftwood',
    strands: [[{ uid: 'chime-bead', gap: 4 }], [], [], [], []], by: 'player',
  });
  assert.equal(set.applied, true);
  assert.equal(set.inventory.chimes.door.strands[0][0].uid, 'chime-bead');
  const seedKind = 'beach_morning_glory';
  assert.equal(store.post({ op: 'collect', id: 'garden-seed', kind: seedKind, at: now, category: 'seed' }).applied, true);
  assert.equal(store.post({ op: 'garden_plant', id: 'plant-1', kind: seedKind }).applied, true);
  assert.equal(store.get().inventory.garden.pot.kind, seedKind);
  // 服务端只负责持久化（语义在 inventory-rules.mjs）：重开后风铃与花盆都还在。
  const reopened = createInventoryStore({ dataDir, clock: () => now }).get();
  assert.equal(reopened.inventory.chimes.door.strands[0][0].uid, 'chime-bead');
  assert.equal(reopened.inventory.garden.pot.kind, seedKind);
  assert.equal(reopened.rev, 4);
});
