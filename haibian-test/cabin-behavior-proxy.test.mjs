import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('behavior proxy: local JSON reaches offline fallback; other methods/media do not', async t => {
  const listen = http.Server.prototype.listen, previous = process.env.CABIN_CONSOLE_TOKEN_FILE;
  let server;
  // Isolated loopback listener with a deliberately nonexistent token file; it cannot connect to SurfCore.
  process.env.CABIN_CONSOLE_TOKEN_FILE = path.join(os.tmpdir(), `unused-cabin-token-${randomUUID()}`);
  http.Server.prototype.listen = function (_port, host, cb) { server = this; return listen.call(this, 0, host, cb); };
  try { await import('../integration/server.mjs'); }
  finally {
    http.Server.prototype.listen = listen;
    if (previous === undefined) delete process.env.CABIN_CONSOLE_TOKEN_FILE; else process.env.CABIN_CONSOLE_TOKEN_FILE = previous;
  }
  assert.ok(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/api/cabin/behavior`, json = 'application/json; charset=utf-8';
  const body = JSON.stringify({ events: [{ id: randomUUID(), at: Date.now(), action: 'meal' }] });
  const post = type => fetch(url, { method: 'POST', headers: { Origin: base, 'Content-Type': type }, body });
  const accepted = await post(json);
  assert.equal(accepted.status, 503);
  assert.deepEqual(await accepted.json(), { ok: false, error: 'QQ 桥接没开' });
  const invalid = await post('text/plain');
  assert.equal(invalid.status, 415);
  assert.equal((await fetch(url)).status, 405);
  const drawing = base + '/api/cabin/drawing/generate';
  const invite = { method: 'POST', headers: { 'Content-Type': json }, body: '{}' };
  assert.equal((await fetch(drawing, invite)).status, 503);
  assert.equal((await fetch(drawing)).status, 405);
  assert.equal((await fetch(drawing, { ...invite, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await fetch(drawing, { ...invite, headers: { ...invite.headers, Origin: 'http://elsewhere.invalid' } })).status, 403);
  assert.equal((await fetch(drawing + '/extra', invite)).status, 404);
});
