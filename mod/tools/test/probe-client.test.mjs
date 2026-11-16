// probe-client 的测试：对着 mock 探针跑 8 个接口和各种出错的情况。运行：node --test mod/tools/test/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  ProbeClient,
  ProbeError,
  readProbeFile,
  waitForStatus,
  statusMismatches,
  isConnectionError,
  PROTOCOL_VERSION,
  sleep,
} from '../probe-client.mjs';
import { startMockProbe, makeTempDir } from './mock-probe.mjs';
import { removeDir } from './helpers.mjs';

const tmp = makeTempDir('client-');
test.after(() => removeDir(tmp));

let mocks = 0;
const mockDir = () => {
  const d = path.join(tmp, `mock${++mocks}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

async function withMock(opts, fn) {
  const mock = await startMockProbe({ dir: mockDir(), ...opts });
  try {
    await fn(mock, new ProbeClient({ port: mock.port, token: mock.token }));
  } finally {
    await mock.close();
  }
}

/** 断言 promise 抛出带某个错误码的 ProbeError。 */
function rejectsCode(promise, code, httpStatus) {
  return assert.rejects(promise, (e) => {
    assert.ok(e instanceof ProbeError, `应该是 ProbeError，实际是 ${e?.name}: ${e?.message}`);
    assert.equal(e.code, code, `错误码不对：${e.code} ${e.message}`);
    if (httpStatus !== undefined) assert.equal(e.httpStatus, httpStatus);
    return true;
  });
}

function throwsCode(fn, code) {
  assert.throws(fn, (e) => e instanceof ProbeError && e.code === code);
}

test('readProbeFile：文件没有、不是 JSON、版本不对、缺字段', () => {
  const f = (name, text) => {
    const file = path.join(tmp, name);
    if (text !== undefined) fs.writeFileSync(file, text);
    return file;
  };
  throwsCode(() => readProbeFile(f('none.json')), 'no_probe_file');
  throwsCode(() => readProbeFile(f('bad.json', '{not json')), 'bad_probe_file');
  throwsCode(() => readProbeFile(f('v2.json', JSON.stringify({ v: 2, port: 1, token: 'ab', pid: 1 }))), 'version_mismatch');
  throwsCode(() => readProbeFile(f('noport.json', JSON.stringify({ v: 1, token: 'ab', pid: 1 }))), 'bad_probe_file');
  const ok = readProbeFile(f('ok.json', JSON.stringify({ v: 1, port: 1234, token: 'abcd', pid: 42, startedAt: 'x' })));
  assert.equal(ok.port, 1234);
  assert.equal(ok.token, 'abcd');
  assert.equal(ok.pid, 42);
  assert.equal(PROTOCOL_VERSION, 1);
});

test('8 个接口按约定工作（status、open、command、block、region、screenshot、leave、quit）', async () => {
  const mock = await startMockProbe({ dir: mockDir() });
  try {
    const client = ProbeClient.fromFile(mock.probeFile);
    const s = await client.status();
    assert.equal(s.ok, true);
    assert.equal(s.v, 1);
    assert.equal(s.ready, true);
    assert.equal(s.inWorld, false);
    assert.equal(s.screen, 'TitleScreen');

    const opened = await client.openWorld({ name: 'client-test' });
    assert.deepEqual([opened.started, opened.name, opened.folder], [true, 'client-test', 'client-test']);
    await rejectsCode(client.openWorld({ name: 'again' }), 'busy', 409);
    await waitForStatus(client, { inWorld: true, screen: null }, { timeoutMs: 5000 });

    const c = await client.command('setblock 3 -60 3 minecraft:oak_log[axis=x]');
    assert.equal(c.success, true);
    const bad = await client.command('/notacommand foo');
    assert.equal(bad.success, false);
    assert.equal(bad.result, 0);
    assert.match(bad.output.join('\n'), /Unknown or incomplete command/);
    const asServer = await client.command('setblock 0 -60 0 minecraft:stone', { as: 'server' });
    assert.equal(asServer.success, true);

    const b = await client.block([3, -60, 3]);
    assert.equal(b.state, 'minecraft:oak_log[axis=x]');
    assert.equal(b.block, 'minecraft:oak_log');
    assert.deepEqual(b.properties, { axis: 'x' });
    assert.equal(b.blockEntity, null);

    const r = await client.region([4, -59, 4], [2, -61, 2]);
    assert.deepEqual(r.origin, [2, -61, 2]);
    assert.deepEqual(r.size, [3, 3, 3]);
    assert.equal(r.blocks.length, 27);
    const at = (x, y, z) => r.palette[r.blocks[x - 2 + (z - 2) * 3 + (y + 61) * 9]];
    assert.equal(at(3, -60, 3), 'minecraft:oak_log[axis=x]');
    assert.equal(at(2, -61, 2), 'minecraft:grass_block[snowy=false]');
    assert.equal(at(4, -59, 4), 'minecraft:air');

    const shot = await client.screenshot({ name: 'client-test' });
    assert.ok(fs.existsSync(shot.path), shot.path);
    assert.equal(typeof shot.meanBrightness, 'number');
    assert.equal(typeof shot.distinctColors, 'number');

    assert.equal((await client.leaveWorld()).started, true);
    await waitForStatus(client, { inWorld: false, screen: 'TitleScreen' }, { timeoutMs: 5000 });
    const again = await client.openWorld({ name: 'client-test' });
    assert.equal(again.folder, 'client-test (1)', '同名存档要用新的文件夹');
    await waitForStatus(client, { inWorld: true, screen: null }, { timeoutMs: 5000 });

    assert.equal((await client.quit()).ok, true);
    for (let i = 0; i < 40 && fs.existsSync(mock.probeFile); i++) await sleep(50);
    assert.equal(fs.existsSync(mock.probeFile), false, '/quit 之后探针要删掉 xjyprobe.json');
    await rejectsCode(client.status({ timeoutMs: 5000 }), 'connect_failed');
  } finally {
    await mock.close();
  }
});

test('token、Origin、Host：带对 token、不带 Origin；错了回 401 / 403', () =>
  withMock({}, async (mock, client) => {
    await client.status();
    const last = mock.requests.at(-1);
    assert.equal(last.origin, undefined, '工具不能带 Origin 头');
    await rejectsCode(new ProbeClient({ port: mock.port, token: 'wrong' }).status(), 'unauthorized', 401);
    await rejectsCode(new ProbeClient({ port: mock.port, token: mock.token, extraHeaders: { Origin: 'http://evil.example' } }).status(), 'forbidden', 403);
    await rejectsCode(client.request('GET', '/status', { headers: { Host: 'evil.example' } }), 'forbidden', 403);
  }));

test('409：游戏还没准备好（busy）、不在世界里（not_in_world）', async () => {
  await withMock({ neverReady: true }, async (mock, client) => {
    const s = await client.status();
    assert.equal(s.ready, false);
    await rejectsCode(client.openWorld({ name: 'x' }), 'busy', 409);
  });
  await withMock({}, async (mock, client) => {
    await rejectsCode(client.command('say hi'), 'not_in_world', 409);
    await rejectsCode(client.leaveWorld(), 'not_in_world', 409);
    await rejectsCode(client.block([0, -60, 0]), 'not_in_world', 409);
  });
});

test('400 / 404 / 405：请求不对', () =>
  withMock({}, async (mock, client) => {
    await rejectsCode(client.request('GET', '/nope'), 'not_found', 404);
    await rejectsCode(client.request('GET', '/quit'), 'method_not_allowed', 405);
    await rejectsCode(client.command('x'.repeat(70 * 1024)), 'too_large', 400);
    await client.openWorld({ name: 'errs' });
    await waitForStatus(client, { inWorld: true, screen: null }, { timeoutMs: 5000 });
    await rejectsCode(client.block([0, 400, 0]), 'bad_request', 400);
    await rejectsCode(client.block([100000, -60, 0]), 'chunk_not_loaded', 409);
    await rejectsCode(client.region([0, -60, 0], [64, -60, 0]), 'too_large', 400);
  }));

test('超时、500、打断、连接断开、连不上', () =>
  withMock({ hang: { '/command': 2000 }, fail: { '/region': { status: 500, error: 'internal', message: '炸了' } }, crashOn: '/screenshot' }, async (mock, client) => {
    await client.openWorld({ name: 'net' });
    await waitForStatus(client, { inWorld: true, screen: null }, { timeoutMs: 5000 });

    const t0 = Date.now();
    await rejectsCode(client.command('say hi', {}, { timeoutMs: 300 }), 'request_timeout');
    assert.ok(Date.now() - t0 < 1500, '超时要按 timeoutMs 算');

    await assert.rejects(client.region([0, -60, 0], [1, -60, 1]), (e) => e instanceof ProbeError && e.code === 'internal' && e.httpStatus === 500 && /炸了/.test(e.message));

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    await rejectsCode(client.command('say hi', {}, { signal: ac.signal }), 'aborted');

    await assert.rejects(client.screenshot(), (e) => e instanceof ProbeError && e.code === 'connection_lost' && isConnectionError(e));
    await assert.rejects(client.status({ timeoutMs: 5000 }), (e) => e instanceof ProbeError && e.code === 'connect_failed' && isConnectionError(e));
  }));

test('回复不是 JSON → bad_reply', async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>not json</html>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await rejectsCode(new ProbeClient({ port: srv.address().port, token: 't' }).status(), 'bad_reply');
  } finally {
    srv.close();
  }
});

test('waitForStatus：满足就返回；等不到抛 wait_timeout，带最后一次的状态；stableFor', () =>
  withMock({}, async (mock, client) => {
    const ok = await waitForStatus(client, { ready: true, screen: 'TitleScreen' }, { timeoutMs: 2000 });
    assert.equal(ok.status.screen, 'TitleScreen');
    await assert.rejects(waitForStatus(client, { inWorld: true }, { timeoutMs: 400 }), (e) => {
      assert.ok(e instanceof ProbeError && e.code === 'wait_timeout', `${e?.code} ${e?.message}`);
      assert.deepEqual(e.details.cond, { inWorld: true });
      assert.equal(e.details.last.inWorld, false);
      return true;
    });
    await client.openWorld({ name: 'stable' });
    await waitForStatus(client, { inWorld: true, screen: null }, { timeoutMs: 5000 });
    await client.command('tp @s 4.5 -60 -2.5 0 13');
    const t0 = Date.now();
    const w = await waitForStatus(client, { chunksRendered: true }, { timeoutMs: 5000, stableMs: 500 });
    assert.equal(w.status.chunksRendered, true);
    assert.ok(Date.now() - t0 >= 500, 'stableFor 要求连续满足这么久');
  }));

test('statusMismatches：严格比较，缺字段也算不一样', () => {
  const s = { ready: true, screen: null, inWorld: true, chunksRendered: false };
  assert.deepEqual(statusMismatches(s, { inWorld: true, screen: null }), []);
  assert.equal(statusMismatches(s, { screen: 'TitleScreen', chunksRendered: true }).length, 2);
  assert.equal(statusMismatches({}, { inWorld: false }).length, 1);
});
