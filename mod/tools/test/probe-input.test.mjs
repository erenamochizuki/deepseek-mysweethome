// probe.mjs input lock|unlock 和 ProbeClient.input()（task-14，docs/PROBE.md 接口 9）。
// 运行：node --test mod/tools/test/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startMockProbe, makeTempDir } from './mock-probe.mjs';
import { ProbeClient, ProbeError } from '../probe-client.mjs';
import { PROBE_CLI, runNode, removeDir, show } from './helpers.mjs';

const tmp = makeTempDir('probe-input-');
test.after(() => removeDir(tmp));
// mock 不会自己建 dir：目录不在的话写探针文件失败，server 却已经开着，测试进程就挂住不退
function sub(name) {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

test('probe.mjs input lock / unlock：发 POST /input {"locked":…}，回 {ok, locked}', async () => {
  const mock = await startMockProbe({ dir: sub('a') });
  try {
    for (const [arg, want] of [['lock', true], ['unlock', false]]) {
      const c = await runNode(PROBE_CLI, ['input', arg, '--probe-file', mock.probeFile]);
      assert.equal(c.code, 0, show(c));
      assert.deepEqual(JSON.parse(c.stdout), { ok: true, locked: want });
      assert.equal(mock.state.inputLocked, want);
    }
    assert.deepEqual(mock.requests.filter((q) => q.path === '/input').map((q) => [q.method, q.body]), [
      ['POST', { locked: true }],
      ['POST', { locked: false }],
    ]);
    const s = await new ProbeClient({ port: mock.port, token: mock.token }).status();
    assert.deepEqual([s.inputLocked, s.mouseGrabbed, typeof s.windowFocused], [false, false, 'boolean']);
  } finally {
    await mock.close();
  }
});

test('probe.mjs input 写错：退出码 2，不发请求；旧探针：退出码 1，not_found', async () => {
  const mock = await startMockProbe({ dir: sub('b'), oldProbe: true });
  try {
    for (const args of [['input', 'on'], ['input']]) {
      const c = await runNode(PROBE_CLI, [...args, '--probe-file', mock.probeFile]);
      assert.equal(c.code, 2, show(c));
      assert.match(c.stderr, args[1] ? /input 后面写 lock（锁住键盘鼠标）或 unlock（解开）：on/ : /用 --help 看用法/);
    }
    assert.equal(mock.requests.filter((q) => q.path === '/input').length, 0);
    const c = await runNode(PROBE_CLI, ['input', 'lock', '--probe-file', mock.probeFile]);
    assert.equal(c.code, 1, show(c));
    assert.equal(JSON.parse(c.stdout).error, 'not_found');
    await assert.rejects(new ProbeClient({ port: mock.port, token: mock.token }).input(true), (e) => e instanceof ProbeError && e.code === 'not_found' && e.httpStatus === 404);
  } finally {
    await mock.close();
  }
});
