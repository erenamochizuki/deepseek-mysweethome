// helpers.mjs：测试共用的小工具。它不是测试文件，名字不要改成 .test.mjs 结尾。

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO_DIR } from './mock-probe.mjs';

export const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TOOLS_DIR = path.resolve(TEST_DIR, '..');
export const RUN_CARDS = path.join(TOOLS_DIR, 'run-cards.mjs');
export const PROBE_CLI = path.join(TOOLS_DIR, 'probe.mjs');
export const FAKE_GAME = path.join(TEST_DIR, 'fake-game.mjs');

/** 在 dir 里写一张卡片，返回完整路径。 */
export function writeCard(dir, name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
}

/**
 * 用当前的 node 跑一个脚本。返回 { child, done, stdout, waitFor(re) }。
 * done 在进程结束后给出 { code, signal, stdout, stderr, timedOut }。
 * 超过 timeoutMs 还没结束就直接结束它（免得测试挂住）。
 */
export function startNode(script, args = [], { env = {}, cwd = REPO_DIR, ipc = false, timeoutMs = 90000 } = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env: childEnv,
    windowsHide: true,
    stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  const waiters = new Set();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    out += d;
    for (const w of [...waiters]) w();
  });
  child.stderr.on('data', (d) => {
    err += d;
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  const done = new Promise((resolve) => {
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: out, stderr: err, timedOut });
    });
  });
  return {
    child,
    done,
    get stdout() {
      return out;
    },
    /** 等 stdout 里出现 re。 */
    waitFor(re, ms = 30000) {
      return new Promise((resolve, reject) => {
        let t = null;
        const cleanup = () => {
          clearTimeout(t);
          waiters.delete(check);
        };
        const check = () => {
          const m = out.match(re);
          if (m) {
            cleanup();
            resolve(m);
          }
        };
        t = setTimeout(() => {
          cleanup();
          reject(new Error(`等不到输出 ${re}，目前的输出：\n${out}\n${err}`));
        }, ms);
        waiters.add(check);
        check();
      });
    },
  };
}

export const runNode = (script, args, opts) => startNode(script, args, opts).done;

/** 读 --out 目录下唯一的那次运行。 */
export function readRun(outDir) {
  const names = fs.readdirSync(outDir).sort();
  if (names.length !== 1) throw new Error(`${outDir} 里应该正好有一次运行，实际：${names.join(', ')}`);
  const runDir = path.join(outDir, names[0]);
  const results = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8'));
  return { runDir, results };
}

/** 删目录；Windows 上文件可能被短暂占用，所以重试几次，最后删不掉也不报错。 */
export function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // 留在 tmp/probe-tools/test 下，不影响测试结果
  }
}

/** 测试输出不一样时，把 run-cards 的完整输出带上，方便看。 */
export const show = (r) => `\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;

/** 拿一个刚关掉的端口（上面没人监听）。 */
export async function closedPort() {
  const http = await import('node:http');
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

/** 一张会跑很久的卡片（用来测 Ctrl+C）。 */
export const LONG_CARD = `steps:
  - open
  - wait:
      inWorld: true
      screen: null
      timeout: 10
  - sleep: 30
  - leave
`;

/** 一张能通过的小卡片（7 步，第 5 步截图）。 */
export const PASS_CARD = `title: 测试用
steps:
  - open
  - wait:
      inWorld: true
      screen: null
      timeout: 10
  - cmd: setblock 1 -60 3 minecraft:oak_stairs[facing=east,half=top]
  - expect_block:
      pos: [1, -60, 3]
      state: minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]
  - shot:
      meanBrightness: [0.05, 0.95]
      distinctColors: 50
  - leave
  - wait:
      inWorld: false
      screen: TitleScreen
      timeout: 10
`;
