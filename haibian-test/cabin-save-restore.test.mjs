import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import Rules, { catalog } from '../web/dist/inventory-rules.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = (buf, type = 'Uint8Array') => ({ type, encoding: 'base64', data: Buffer.from(buf).toString('base64') });
const recipe = { id: '831c296b-ab86-4eb5-9a34-6b707c0b7eac', name: '烤鱼', ingredients: '鱼', steps: '烤熟',
  notes: '', source: 'assistant', updatedAt: '2026-01-01T00:00:00.000Z' };
function archive(coins) {
  const inventory = Rules.freshState();
  inventory.inventory.coins = coins;
  const geometry = JSON.stringify({ 'minecraft:geometry': [{ description: {}, bones: [{ name: 'root' }] }] });
  return { format: 'cabin-save-v1', source: 'service', inventory, recipes: [recipe], browser: {
    localStorage: { 'v3.cabinGame': JSON.stringify({v: 1, S: { leisureMin: coins }, st: { beach: [] } }) },
    house: { v: 1, bytes: binary(fs.readFileSync(path.join(root, 'web/assets/house/house-v4.png'))) },
    models: [{ id: 'character-test', name: '角色', authors: [], files: [['main.json', binary(geometry)]] }],
    texturePack: { key: 'v1|fixture', names: ['sample'], blob: binary([11]), offsets: binary([0,0,0,0,1,0,0,0], 'Uint32Array') },
  } };
}

// Exercise the production server, asking the OS for an ephemeral port. Simulate a process
// interruption immediately before/after the atomic filesystem switch in a separate child.
async function start(dataDir, crash = '') {
  const source = `
    import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
    const listen = http.Server.prototype.listen, rename = fs.renameSync;
    http.Server.prototype.listen = function (port, host, done) {
      return listen.call(this, 0, host, () => { done(); process.send(this.address().port); });
    };
    fs.renameSync = (from,to) => {
      if (path.basename(to) !== 'cabin-active-generation') return rename(from,to);
      if (process.env.TEST_SWITCH === 'before') process.exit(71);
      rename(from,to);
      if (process.env.TEST_SWITCH === 'after') process.exit(72);
    };
    await import('./integration/server.mjs');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd: root, windowsHide: true, stdio: ['ignore','ignore','inherit','ipc'],
    env: { ...process.env, CABIN_INVENTORY_DATA_DIR: dataDir, TEST_SWITCH: crash },
  });
  const exit = once(child, 'exit').then(([code]) => code);
  const port = await Promise.race([once(child, 'message').then(([p]) => p),
    exit.then(code => { throw Error('Child exited at startup: ' + code); })]);
  const origin = 'http://127.0.0.1:' + port;
  return {
    origin, exit, stop: async () => { if (child.exitCode === null) child.kill(); await exit; },
    get: async route => (await fetch(origin + '/api/cabin/' + route)).json(),
    write: (route, method, data, headers = {}) => fetch(origin + '/api/cabin/' + route, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data),
    }),
  };
}

const saveHeaders = generation => ({ 'X-Cabin-Save': '1', 'X-Cabin-Generation': generation });
const post = (server, archive, generation) => server.write('save', 'POST', archive, saveHeaders(generation));

test('full restore round trips real assets, rejects damaged input, fences stale writers and survives restart', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-full-save-'));
  const servers = [];
  t.after(async () => {
    for (const s of servers) await s.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const s = await start(dataDir); servers.push(s);
  const original = archive(17);
  const result = await post(s, original, '0');
  const body = await result.json();
  assert.equal(result.status, 200, JSON.stringify(body));
  const gen = body.generation;
  assert.equal(result.headers.get('X-Cabin-Generation'), gen);
  const expected = { ok: true, inventory: original.inventory, recipes: original.recipes, browser: original.browser };
  assert.deepEqual(await s.get('save'), JSON.parse(JSON.stringify(expected)));
  assert.equal((await fetch(s.origin + '/api/cabin/progress?revisions=1')).headers.get('X-Cabin-Generation'), gen);
  for (const page of ['home.html', 'cabin.html', 'studio.html', 'mcview.html']) {
    const html = await (await fetch(s.origin + '/' + page)).text();
    assert.ok(html.includes('<meta name="cabin-save-generation" content="' + gen + '">'), page);
  }

  for (const damage of [
    a => delete a.recipes, a => { a.inventory.inventory.coins = -5; },
    a => { a.browser.house.bytes = binary([1,2,3]); }, a => { a.browser.models[0].files[0][1] = binary('{'); },
    a => { a.browser.texturePack.offsets = binary([0,0,0,0,5,0,0,0], 'Uint32Array'); },
    a => { a.browser.localStorage['v3.cabinGame'] = '{'; }, a => { a.recipes.push(a.recipes[0]); },
  ]) {
    const bad = structuredClone(original); damage(bad);
    const response = await post(s, bad, gen);
    assert.equal(response.status, 400, JSON.stringify(await response.json()));
    assert.deepEqual(await s.get('save'), JSON.parse(JSON.stringify(expected)));
  }
  const change = { changes: [{ key: 'v3.girl.model', base: 0, value: 'old' }] };
  const stale = await s.write('progress', 'PUT', change, {'X-Cabin-Progress':'1','X-Cabin-Generation':'0'});
  assert.equal(stale.status, 409);
  assert.equal(stale.headers.get('X-Cabin-Generation'), gen);
  assert.equal((await s.write('progress', 'PUT', change, {'X-Cabin-Progress':'1'})).status, 409);
  assert.equal((await post(s, original, '0')).status, 409);
  const command = { op:'collect', id:'beach:restore-test', kind:'shell', at:100, category:'collectible' };
  assert.equal((await s.write('inventory','POST',command,{'X-Cabin-Inventory':'1', Origin:s.origin})).status, 409);
  assert.equal((await s.write('recipes','POST',recipe,{Origin:s.origin})).status, 409);
  assert.equal((await s.write('inventory','POST',command,{'X-Cabin-Inventory':'1'})).status, 200);
  assert.equal((await s.write('recipes','POST',{...recipe,name:'鱼汤',steps:'煮熟'})).status, 201);
  const assistantRecipes = (await s.get('save')).recipes;
  const standalone = archive(22);
  standalone.source = 'browser';
  const localCommand = Rules.parseCommand(command, { catalog });
  standalone.inventory.seen[command.id] = Rules.hash01(JSON.stringify({ ...localCommand, at: 0 })).toString(36);
  delete standalone.recipes;
  standalone.browser.localStorage['v3.cabinDrawing:123'] = 'queued';
  standalone.browser.localStorage['cabin.routine.unread.1'] = 'msg';
  standalone.browser.localStorage['v3.wx.1'] = 'cache';
  const concurrent = await Promise.all([post(s, standalone, gen), post(s, standalone, gen)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  const changed = await s.get('save');
  assert.deepEqual(changed.recipes, assistantRecipes);
  assert.equal(changed.inventory.inventory.coins, 22);
  assert.deepEqual(Object.keys(changed.browser.localStorage), ['v3.cabinGame']);
  const retry = await s.write('inventory','POST',command,{'X-Cabin-Inventory':'1'});
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).applied, false);
  await s.stop();
  const restarted = await start(dataDir); servers.push(restarted);
  assert.deepEqual(await restarted.get('save'), changed);
});

test('a process interrupted on either side of the generation switch reopens one complete save', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-interrupted-save-'));
  const servers = [];
  t.after(async () => {
    for (const s of servers) await s.stop();
    fs.rmSync(dir, {recursive: true, force: true});
  });
  let s = await start(dir); servers.push(s);
  const first = archive(11);
  const gen = (await (await post(s, first, '0')).json()).generation;
  const baseline = await s.get('save');
  await s.stop();
  const next = archive(44);
  next.recipes = [];
  next.browser.models = [];
  for (const phase of ['before','after']) {
    s = await start(dir, phase); servers.push(s);
    await assert.rejects(post(s, next, gen));
    assert.equal(await s.exit, phase === 'before' ? 71 : 72);
    s = await start(dir); servers.push(s);
    const current = await s.get('save');
    if (phase === 'before') assert.deepEqual(current, baseline);
    else assert.deepEqual(current, JSON.parse(JSON.stringify({ok:true, inventory:next.inventory, recipes:[], browser:next.browser})));
    await s.stop();
  }
});
