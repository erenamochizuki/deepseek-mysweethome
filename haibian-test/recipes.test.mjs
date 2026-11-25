import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRecipeHandler } from '../integration/cabin-recipes.mjs';

test('player and assistant share one durable recipe book', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-book-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const start = async () => {
    const handler = createRecipeHandler({
      dataDir, webRoot: path.join(dataDir, 'web'),
      sendJson(res, status, value) { res.writeHead(status); res.end(JSON.stringify(value)); },
    });
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    return 'http://127.0.0.1:' + server.address().port + '/api/cabin/recipes';
  };
  const base = await start();
  const request = async (path = '', method = 'GET', data, headers) => {
    const response = await fetch(base + path, { method, body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json', ...headers } });
    return { status: response.status, ...await response.json() };
  };
  const original = { name: '青柠 Soda', ingredients: '青柠 1 个\n汽水 1 杯', steps: '挤汁，再倒入汽水。' };
  assert.equal((await request()).total, 0);
  const writes = await Promise.all([
    request('', 'POST', { ...original, source: 'assistant' }),
    request('', 'POST', { ...original, name: ' 青柠ＳＯＤＡ ', steps: '将两种原料混合。' }),
  ]);
  assert.deepEqual(writes.map(r => r.status).sort(), [201, 409]);
  const recipe = writes.find(r => r.status === 201).recipe;
  const conflict = writes.find(r => r.code === 'duplicate');
  assert.equal(conflict.recipe.id, recipe.id);
  const same = await request('', 'POST', { ...recipe, name: '夏日汽水', ingredients: '汽水 1 杯\n青柠 1 个' });
  assert.equal(same.code, 'duplicate');
  const filtered = await request('?q=' + encodeURIComponent('汽水') + '&limit=1');
  assert.equal(filtered.total, 1);
  assert.equal(filtered.recipes[0].id, recipe.id);
  assert.equal(filtered.recipes[0].steps, undefined);
  assert.deepEqual((await request('?q=missing')).recipes, []);
  assert.deepEqual((await request('?offset=1')).recipes, []);
  const second = await request('', 'POST', { name: '茶泡饭', ingredients: '米饭、绿茶', steps: '用热茶浇饭。', source: 'assistant' });
  assert.equal(second.recipe.source, 'assistant');
  const detail = '/' + recipe.id;
  const update = { ...recipe, name: '青柠冰饮', notes: '冰镇', expectedUpdatedAt: recipe.updatedAt };
  const blocked = await request(detail, 'PUT', { ...update, name: second.recipe.name });
  assert.equal(blocked.code, 'duplicate');
  const saved = await request(detail, 'PUT', update);
  assert.equal(saved.status, 200);
  assert.notEqual(saved.recipe.updatedAt, recipe.updatedAt);
  const stale = await request(detail, 'PUT', { ...update, notes: '过期编辑' });
  assert.equal(stale.code, 'stale');
  assert.equal(stale.recipe.notes, '冰镇');
  assert.equal((await request(detail, 'GET', undefined, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await request('', 'POST', { ...original, steps: '' })).status, 400);
  assert.equal((await request('', 'POST', original, { 'Content-Type': 'text/plain' })).status, 415);
  const reopened = await start();
  assert.deepEqual((await (await fetch(reopened + detail)).json()).recipe, saved.recipe);
});
