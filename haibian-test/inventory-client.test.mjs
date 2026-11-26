import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createInventoryStore } from '../integration/cabin-inventory.mjs';

const src = '../web/src/';
const code = ['58-inventory-rules.js', '59-cabin-inventory.js', '60-game.js'].map((f) => readFileSync(new URL(src + f, import.meta.url), 'utf8'));
const original = {
  v: 1, S: { washChance: .35 }, st: {
    found: { scallop: { n: 3, first: 100, last: 200 } },
    beach: [{ id: 'b1', kind: 'scallop', at: 99, x: 0, z: 0 }],
  },
};
const shape = (o) => JSON.parse(JSON.stringify(o));
function page({ store, initial = {}, hosted = true }) {
  const ls = new Map(Object.entries(initial)), handlers = new Map(), events = [], calls = [];
  let offline = false;
  const V3 = {
    util: { qs: (k, def) => def, clamp: (n, a, b) => Math.min(b, Math.max(a, n)) },
    viewTokens: {}, shells: { KINDS: [{ id: 'scallop', rarity: 'common' }] },
    err: (m) => assert.fail(m),
    on: (k, fn) => { if (!handlers.has(k)) handlers.set(k, []); handlers.get(k).push(fn); },
    emit: (k, v) => { events.push([k, v]); for (const fn of handlers.get(k) || []) fn(v); },
  };
  const ctx = {
    window: { V3, __CABIN_LOCAL_INVENTORY: hosted }, location: { protocol: 'file:' }, document: { addEventListener() {} },
    localStorage: { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v) },
    navigator: { webdriver: true }, AbortController, crypto: { randomUUID },
    addEventListener() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    fetch: async (path, init) => {
      assert.equal(path, '/api/cabin/inventory');
      calls.push(init.method);
      if (offline) throw new TypeError('test outage');
      try {
        if (init.method === 'POST') assert.equal(init.headers['X-Cabin-Inventory'], '1');
        const json = init.method === 'GET' ? store.get() : store.post(JSON.parse(init.body));
        return { ok: true, json: async () => shape(json) };
      } catch (error) {
        if (!error.status) throw error;
        return { ok: false, status: error.status, json: async () => ({ ok: false, error: error.code }) };
      }
    },
  };
  vm.createContext(ctx);
  for (const c of code) vm.runInContext(c, ctx);
  V3.game.start();
  return { V3, ls, events, calls, offline: (v) => { offline = v; } };
}

test('legacy import once, preserved legacy, and one increment for two views of the same shell', async () => {
  const store = createInventoryStore({ dataDir: mkdtempSync(join(tmpdir(), 'cabin-client-')) });
  const raw = JSON.stringify(original);
  const a = page({ store, initial: { 'v3.game': raw } });
  const b = page({ store, initial: { 'v3.game': raw } });
  await Promise.all([a.V3.cabinInventory.refresh(), b.V3.cabinInventory.refresh()]);
  assert.equal(store.get().inventory.found.scallop.n, 3);
  assert.equal(a.V3.game.get('washChance'), 7 * .05);
  assert.equal(a.ls.get('v3.game'), raw);
  assert.equal('found' in JSON.parse(a.ls.get('v3.cabinGame')).st, false);
  const got = await Promise.all([a.V3.game.collect('b1'), b.V3.game.collect('b1', 'girl')]);
  assert.equal(got.filter(Boolean).length, 1);
  assert.equal(store.get().inventory.found.scallop.n, 4);
  assert.equal(a.V3.game.st.beach.length + b.V3.game.st.beach.length, 0);
  assert.equal(a.events.concat(b.events).filter(([k]) => k === 'game:collect').length, 1);
  const otherBrowser = page({ store });
  await otherBrowser.V3.cabinInventory.refresh();
  assert.equal(otherBrowser.V3.game.counts().items, 4);
  assert.equal(otherBrowser.V3.cabinInventory.exportData().inventory.found.scallop.n, 4);
  assert.equal(a.ls.get('v3.game'), raw);
});

test('a failed save leaves the shell on the beach and does not report a collection', async () => {
  const store = createInventoryStore({ dataDir: mkdtempSync(join(tmpdir(), 'cabin-client-')) });
  const p = page({ store, initial: { 'v3.game': JSON.stringify(original) } });
  await p.V3.cabinInventory.refresh();
  p.offline(true);
  assert.equal(await p.V3.game.collect('b1'), null);
  assert.equal(p.V3.game.st.beach.length, 1);
  assert.equal(p.events.filter(([k]) => k === 'game:collect').length, 0);
  p.offline(false);
  await p.V3.game.collect('b1');
  assert.equal(p.V3.game.st.beach.length, 0);
});

test('migrate the whole offline collection only into an empty service save', async () => {
  const store = createInventoryStore({ dataDir: mkdtempSync(join(tmpdir(), 'cabin-old-inventory-')) });
  const offline = page({ hosted: false });
  await offline.V3.cabinInventory.refresh();
  await offline.V3.cabinInventory.devCoins(19);
  const local = offline.ls.get('v3.inventory');
  const first = page({ store, initial: { 'v3.inventory': local } });
  await first.V3.cabinInventory.refresh();
  assert.equal(store.get().inventory.coins, 19);
  assert.equal(first.ls.get('v3.inventory'), local);
  await offline.V3.cabinInventory.devCoins(11);
  const second = page({ store, initial: { 'v3.inventory': offline.ls.get('v3.inventory') } });
  await second.V3.cabinInventory.refresh();
  assert.equal(second.V3.cabinInventory.data.inventory.coins, 19);
  assert.equal(JSON.parse(second.ls.get('v3.inventory')).inventory.coins, 30);
});

test('standalone mode persists locally and never calls the local service', async () => {
  const p = page({ hosted: false, initial: { 'v3.game': JSON.stringify(original) } });
  await p.V3.cabinInventory.refresh();
  const r = await p.V3.game.collect('b1');
  assert.equal(r.n, 4);
  assert.equal(JSON.parse(p.ls.get('v3.inventory')).inventory.found.scallop.n, 4);
  assert.deepEqual(p.calls, []);
});
