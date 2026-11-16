#!/usr/bin/env node
// probe.mjs：探针的命令行调试工具。输出 JSON。连接信息默认读 mod/run/xjyprobe.json。

import fs from 'node:fs';
import path from 'node:path';
import { ProbeClient, ProbeError, DEFAULT_PROBE_FILE, waitForStatus, WAIT_KEYS } from './probe-client.mjs';
import { isAlive, waitUntil } from './lib/proc.mjs';

const USAGE = `用法: node mod/tools/probe.mjs <命令> [参数] [选项]
命令:
  status                              游戏状态
  open [name] [--seed N]              开一个新的超平坦世界（只是开始；进没进去用 status / wait 看）
  leave                               离开世界
  wait 键=值 ... [--stable 秒]         等 /status 满足条件，比如 wait inWorld=true screen=null
  cmd <命令文字> [--as server]         执行命令，比如 cmd setblock 1 -60 3 minecraft:stone
  block x y z [--dim 维度]            读一个方块
  region x1 y1 z1 x2 y2 z2 [--dim 维度] 读一个区域（每个方向最多 64 格）
  shapes x1 y1 z1 x2 y2 z2 [--dim 维度] 查区域里的方块是不是游戏按邻居算出来的样子（只读，每个方向最多 64 格）
  shot [name] [--hide-gui]            截图（名字只能用字母、数字和 . _ -；--hide-gui 截不带界面的纯世界画面）
  input lock|unlock                   锁住 / 解开游戏对这台电脑键盘鼠标的响应
  screen config <模组id> | press <按钮上的字> | close   打开模组的配置界面 / 点一个按钮 / 关掉界面（不发真实键鼠）
  use x y z [--face 面] [--hit x y z] [--sneak]   模拟右键这个方块（不发真实键鼠），回动作栏的字
  quit [--no-wait]                    让游戏退出，默认等游戏进程消失
选项:
  --probe-file <文件>   连接信息文件，默认 mod/run/xjyprobe.json
  --timeout <秒>        这次请求最多等多久（wait 和 quit 是总共等多久，默认 60）
  --                    后面的全当参数（命令文字里有 -- 开头的词时用）
成功：输出探针的回复，退出码 0。出错：输出 {"ok":false,"error":"错误码","message":"..."}，退出码 1。用法写错：退出码 2。`;

class UsageError extends Error {}

function fmt(v, ind = '') {
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== 'object')) return JSON.stringify(v);
    const inner = `${ind}  `;
    return `[\n${v.map((x) => inner + fmt(x, inner)).join(',\n')}\n${ind}]`;
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (keys.length === 0) return '{}';
    const inner = `${ind}  `;
    return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${fmt(v[k], inner)}`).join(',\n')}\n${ind}}`;
  }
  return JSON.stringify(v);
}

function int(v, what) {
  if (!/^-?\d+$/.test(String(v))) throw new UsageError(`${what} 要是整数：${v}`);
  return Number(v);
}

function seconds(v, what, allowZero = false) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new UsageError(`${what} 要是秒数：${v}`);
  return n;
}

function parseValue(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

async function main(argv) {
  const f = { probeFile: DEFAULT_PROBE_FILE, timeout: null, stable: 0, noWait: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    const need = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${a} 后面要跟一个值`);
      return argv[++i];
    };
    if (a === '--probe-file') f.probeFile = path.resolve(need());
    else if (a === '--timeout') f.timeout = seconds(need(), a);
    else if (a === '--stable') f.stable = seconds(need(), a, true);
    else if (a === '--as') f.as = need();
    else if (a === '--dim') f.dim = need();
    else if (a === '--seed') f.seed = int(need(), a);
    else if (a === '--no-wait') f.noWait = true;
    else if (a === '--hide-gui') f.hideGui = true;
    else if (a === '--face') f.face = need();
    else if (a === '--sneak') f.sneak = true;
    else if (a === '--hit') {
      if (i + 3 >= argv.length) throw new UsageError('--hit 后面要跟 3 个数');
      f.hit = argv.slice(i + 1, i + 4).map((v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new UsageError(`--hit 要是数字：${v}`);
        return n;
      });
      i += 3;
    }
    else if (a === '-h' || a === '--help') f.help = true;
    else if (a.startsWith('--')) throw new UsageError(`不认识的选项 ${a}`);
    else pos.push(a);
  }
  const cmd = pos[0];
  if (f.help || !cmd) {
    console.log(USAGE);
    return f.help ? 0 : 2;
  }
  const args = pos.slice(1);
  const nargs = (min, max = min) => {
    if (args.length < min || args.length > max) throw new UsageError(`${cmd} 的参数个数不对`);
  };
  const req = f.timeout ? { timeoutMs: f.timeout * 1000 } : {};
  if (f.as !== undefined && f.as !== 'player' && f.as !== 'server') throw new UsageError('--as 只能是 player 或 server');

  const client = ProbeClient.fromFile(f.probeFile);
  switch (cmd) {
    case 'status':
      nargs(0);
      return client.status(req);
    case 'open':
      nargs(0, 1);
      return client.openWorld({ name: args[0], seed: f.seed }, req);
    case 'leave':
      nargs(0);
      return client.leaveWorld(req);
    case 'wait': {
      if (args.length === 0) throw new UsageError('wait 后面写条件，比如 wait inWorld=true screen=null');
      const cond = {};
      for (const kv of args) {
        const m = kv.match(/^([A-Za-z]+)=(.*)$/);
        if (!m || !WAIT_KEYS.includes(m[1])) throw new UsageError(`wait 的条件要写成 键=值，键只能是 ${WAIT_KEYS.join('、')}：${kv}`);
        cond[m[1]] = parseValue(m[2]);
      }
      const r = await waitForStatus(client, cond, { timeoutMs: (f.timeout ?? 60) * 1000, stableMs: f.stable * 1000 });
      return { ok: true, waitedMs: r.ms, status: r.status };
    }
    case 'cmd':
      if (args.length === 0) throw new UsageError('cmd 后面写命令文字');
      return client.command(args.join(' '), { as: f.as }, req);
    case 'block':
      nargs(3);
      return client.block(args.map((v) => int(v, '坐标')), { dim: f.dim }, req);
    case 'region': {
      nargs(6);
      const n = args.map((v) => int(v, '坐标'));
      return client.region(n.slice(0, 3), n.slice(3), { dim: f.dim }, req);
    }
    case 'shapes': {
      nargs(6);
      const n = args.map((v) => int(v, '坐标'));
      return client.shapes(n.slice(0, 3), n.slice(3), { dim: f.dim }, req);
    }
    case 'shot':
      nargs(0, 1);
      return client.screenshot({ name: args[0], hideGui: f.hideGui }, req);
    case 'input':
      nargs(1);
      if (args[0] !== 'lock' && args[0] !== 'unlock') throw new UsageError(`input 后面写 lock（锁住键盘鼠标）或 unlock（解开）：${args[0]}`);
      return client.input(args[0] === 'lock', req);
    case 'screen': {
      if (args[0] === 'close' && args.length === 1) return client.screen({ close: true }, req);
      if ((args[0] === 'config' || args[0] === 'press') && args.length >= 2) return client.screen({ [args[0]]: args.slice(1).join(' ') }, req);
      throw new UsageError('screen 后面写 config <模组id>、press <按钮上的字> 或 close');
    }
    case 'use':
      nargs(3);
      return client.use(args.map((v) => int(v, '坐标')), { face: f.face, hit: f.hit, sneak: f.sneak }, req);
    case 'quit': {
      nargs(0);
      const pid = client.info.pid;
      let reply;
      try {
        reply = await client.quit(req);
      } catch (e) {
        if (!(e instanceof ProbeError) || e.code !== 'connection_lost') throw e;
        reply = { ok: true, note: '回复前连接断了，游戏可能已经在退出' };
      }
      if (f.noWait || !pid) return reply;
      const t0 = Date.now();
      const exited = await waitUntil(() => !isAlive(pid), (f.timeout ?? 60) * 1000);
      return { ...reply, pid, exited, waitedMs: Date.now() - t0, probeFileLeft: fs.existsSync(f.probeFile) };
    }
    default:
      throw new UsageError(`不认识的命令 ${cmd}`);
  }
}

try {
  const out = await main(process.argv.slice(2));
  if (typeof out === 'number') process.exitCode = out;
  else {
    console.log(fmt(out));
    process.exitCode = 0;
  }
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`${e.message}\n用 --help 看用法`);
    process.exitCode = 2;
  } else if (e instanceof ProbeError) {
    console.log(fmt({ ok: false, ...e.toJSON() }));
    process.exitCode = 1;
  } else {
    console.log(fmt({ ok: false, error: 'internal', message: String(e?.stack || e) }));
    process.exitCode = 1;
  }
}
