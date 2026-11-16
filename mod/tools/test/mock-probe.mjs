// mock-probe.mjs：测试用的假探针（node:http）。按 docs/PROBE.md「接口约定（v1）」回复，方块存在内存里。
// 不是测试文件（名字不是 *.test.mjs），由测试和 fake-game.mjs 引用。

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gameShape, isAir } from './mock-shapes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_DIR = path.resolve(HERE, '..', '..', '..');
export const TMP_ROOT = path.join(REPO_DIR, 'tmp', 'probe-tools', 'test');

export function makeTempDir(prefix = 't') {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TMP_ROOT, `${prefix}-`));
}

const LIMIT = 64 * 1024;
const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPos = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isSafeInteger);

// 每个方块的属性：第一个值是默认值（和游戏一致）。
const BLOCKS = {
  'minecraft:air': {},
  'minecraft:stone': {},
  'minecraft:dirt': {},
  'minecraft:bedrock': {},
  'minecraft:grass_block': { snowy: ['false', 'true'] },
  'minecraft:oak_stairs': { facing: ['north', 'south', 'west', 'east'], half: ['bottom', 'top'], shape: ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'], waterlogged: ['false', 'true'] },
  'minecraft:oak_log': { axis: ['y', 'x', 'z'] },
  'minecraft:lantern': { hanging: ['false', 'true'], waterlogged: ['false', 'true'] },
  'minecraft:chest': { facing: ['north', 'south', 'west', 'east'], type: ['single', 'left', 'right'], waterlogged: ['false', 'true'] },
};
const WITH_BE = { 'minecraft:chest': 'minecraft:chest' };

/** 解析 minecraft:xxx[a=b,...]，补上默认属性。返回 { id, props, state } 或 { error }。 */
export function parseBlockState(text) {
  const m = /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)(?:\[(.*)\])?$/.exec(text);
  if (!m) return { error: `Invalid block state: ${text}` };
  const id = `${m[1] ?? 'minecraft'}:${m[2]}`;
  const def = BLOCKS[id];
  if (!def) return { error: `Unknown block type '${id}'` };
  const props = Object.fromEntries(Object.entries(def).map(([k, v]) => [k, v[0]]));
  if (m[3]) {
    for (const kv of m[3].split(',')) {
      const [k, v] = kv.split('=');
      if (!def[k]) return { error: `Block ${id} does not have property '${k}'` };
      if (!def[k].includes(v)) return { error: `Block ${id} does not accept '${v}' for ${k} property` };
      props[k] = v;
    }
  }
  return makeBlock(id, props);
}

export function makeBlock(id, props) {
  const keys = Object.keys(props).sort();
  const sorted = Object.fromEntries(keys.map((k) => [k, props[k]]));
  return { id, props: sorted, state: keys.length ? `${id}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]` : id };
}

const FLAT = { [-64]: makeBlock('minecraft:bedrock', {}), [-63]: makeBlock('minecraft:dirt', {}), [-62]: makeBlock('minecraft:dirt', {}), [-61]: makeBlock('minecraft:grass_block', { snowy: 'false' }) };
const AIR = makeBlock('minecraft:air', {});

function pngBytes(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([(x * 70) & 255, (y * 90) & 255, ((x + y) * 50) & 255], y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * 启动假探针。常用选项：
 *   dir（临时目录，放 xjyprobe.json 和截图）、probeFile、token、fileToken（写进文件的 token，测 401 用）、v（版本，默认 1）
 *   readyDelayMs、loadError（停在 LoadingErrorScreen）、neverReady、openDelayMs、leaveDelayMs、renderDelayMs
 *   shot：{ meanBrightness, distinctColors, width, height }
 *   dummyGame：起一个空转的子进程，/status 报它的 pid，/quit 后结束它（模拟游戏进程）
 *   quitBehavior：'exit'（默认：删文件、关服务，exitDelayMs 后「进程退出」）| 'hang'（删文件、关服务，但进程不退）
 *   onQuit：进程该退出时调用；pid：/status 报的 pid
 *   hang：{ '/command': 毫秒 } 让某个接口晚回；fail：{ '/block': { status, error, message, once } } 注入错误
 *   forbidAll：所有请求都回 403；crashOn：'/screenshot' 收到这个请求时模拟游戏崩溃（不回复、结束 dummy、关服务）
 * 返回的 state.lastShot：最后一次成功截图收到的 { name, hideGui }（请求里没有 hideGui 就没有这个键）
 */
export async function startMockProbe(opts = {}) {
  const o = { v: 1, readyDelayMs: 0, openDelayMs: 150, leaveDelayMs: 100, renderDelayMs: 300, exitDelayMs: 300, quitBehavior: 'exit', hang: {}, fail: {}, writeProbeFile: true, ...opts };
  const dir = o.dir ?? makeTempDir('mock');
  const probeFile = o.probeFile ?? path.join(dir, 'xjyprobe.json');
  const shotsDir = path.join(dir, 'probe-shots');
  const token = o.token ?? crypto.randomBytes(32).toString('hex');
  const t0 = Date.now();
  const requests = [];
  const timers = new Set();
  const worlds = new Set();
  let blocks = new Map();
  let closed = false;
  let quitting = false;
  const dummy = o.dummyGame ? spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore', windowsHide: true }) : null;
  const dummyExited = dummy ? new Promise((r) => dummy.once('exit', r)) : Promise.resolve();
  const st = { ready: false, screen: o.loadError ? 'LoadingErrorScreen' : null, inWorld: false, player: null, phase: 'title', phaseUntil: 0, tpAt: null, quitCount: 0, lastShot: null, inputLocked: o.inputLocked === true, windowFocused: o.windowFocused === true };

  const delay = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms);
      t.resolve = resolve;
      timers.add(t);
    });

  function tick() {
    const now = Date.now();
    if (!st.ready && !o.loadError && !o.neverReady && now - t0 >= o.readyDelayMs) {
      st.ready = true;
      st.screen = 'TitleScreen';
    }
    if (st.phase === 'opening') {
      if (now >= st.phaseUntil) {
        st.phase = 'world';
        st.inWorld = true;
        st.screen = null;
      } else if (now >= st.phaseUntil - o.openDelayMs / 2) {
        st.inWorld = true; // 加载界面还没关，inWorld 已经是 true
        st.screen = 'LevelLoadingScreen';
      }
    }
    if (st.phase === 'leaving' && now >= st.phaseUntil) {
      st.phase = 'title';
      st.screen = 'TitleScreen';
    }
  }

  function chunksRendered() {
    if (!st.inWorld) return null;
    if (st.phase === 'opening') return false;
    if (st.tpAt !== null) {
      const dt = Date.now() - st.tpAt;
      if (dt < 60) return true; // tp 之后一两个 tick 里还是旧值
      if (dt < o.renderDelayMs) return false;
    }
    return true;
  }

  const getBlock = (pos) => blocks.get(pos.join(',')) ?? FLAT[pos[1]] ?? AIR;
  const reportedPid = () => o.pid ?? dummy?.pid ?? process.pid;

  function writeFileAtomic() {
    const tmp = `${probeFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: o.v, port, token: o.fileToken ?? token, pid: reportedPid(), startedAt: new Date().toISOString() }));
    fs.renameSync(tmp, probeFile);
  }

  function deleteProbeFile() {
    try {
      if (JSON.parse(fs.readFileSync(probeFile, 'utf8')).port === port) fs.rmSync(probeFile, { force: true });
    } catch {
      // 不在了
    }
  }

  const cmdFail = (...msgs) => ({ success: false, result: 0, output: msgs });
  const INCOMPLETE = 'Unknown or incomplete command. See below for error';
  // 额外的命令（mock-xjy.mjs 用）：o.commands = { 命令名: (words, text, api, as) => 结果或 Promise }，会盖掉同名的内置命令
  const api = {
    get player() { return st.player; },
    get inWorld() { return st.inWorld; },
    // 这次进的世界（文件夹名）：/world/open 每开一个就换一个。存档里的东西（/xjy place 的记录）按它分开记
    get world() { return st.world ?? null; },
    dir,
    getBlock,
    setBlock: (pos, b) => blocks.set(pos.join(','), b),
    loaded: (x, z) => Math.abs(x) <= 1000 && Math.abs(z) <= 1000,
    // 打开一个界面（/status 的 screen 变成这个名字），比如 /xjy blacklist 打开 BlacklistScreen；退出世界时会换掉
    setScreen: (name) => { if (st.inWorld) st.screen = name; },
    cmdFail,
    INCOMPLETE,
  };

  function coord(w, base, int) {
    const m = /^(~)?(-?\d+(?:\.\d+)?)?$/.exec(w ?? '');
    if (!m || (!m[1] && m[2] === undefined)) return null;
    const v = m[1] ? base + Number(m[2] ?? 0) : Number(m[2]);
    return int ? Math.floor(v) : v;
  }

  function runCommand(text, as) {
    const w = text.trim().split(/\s+/);
    const extra = o.commands && Object.hasOwn(o.commands, w[0]) ? o.commands[w[0]] : null;
    if (extra) return extra(w, text.trim(), api, as);
    const origin = as === 'server' ? [0, -60, 0] : [st.player.x, st.player.y, st.player.z];
    switch (w[0]) {
      case 'setblock': {
        if (w.length < 5) return cmdFail(INCOMPLETE, `${text}<--[HERE]`);
        const pos = w.slice(1, 4).map((v, i) => coord(v, origin[i], true));
        if (pos.includes(null)) return cmdFail('Expected integer');
        const b = parseBlockState(w[4]);
        if (b.error) return cmdFail(b.error);
        if (pos[1] < -64 || pos[1] > 319) return cmdFail('Cannot place block outside of the world');
        if (getBlock(pos).state === b.state) return cmdFail('Could not set the block');
        if (WITH_BE[b.id]) b.be = `{Items:[],components:{},id:"${WITH_BE[b.id]}",x:${pos[0]},y:${pos[1]},z:${pos[2]}}`;
        blocks.set(pos.join(','), b);
        return { success: true, result: 1, output: [`Changed the block at ${pos.join(', ')}`] };
      }
      case 'tp':
      case 'teleport': {
        let a = w.slice(1);
        if (a[0]?.startsWith('@')) a = a.slice(1);
        const xyz = a.slice(0, 3).map((v, i) => coord(v, [st.player.x, st.player.y, st.player.z][i], false));
        if (xyz.length < 3 || xyz.includes(null)) return cmdFail(INCOMPLETE, `${text}<--[HERE]`);
        // 和真游戏一样：x、z 写整数时站到方块中间（+0.5）；yaw、pitch 按 Mth.wrapDegrees 取到 [-180, 180)，pitch 再夹到 [-90, 90]
        const center = (t, v) => (t.startsWith('~') || t.includes('.') ? v : v + 0.5);
        xyz[0] = center(a[0], xyz[0]);
        xyz[2] = center(a[2], xyz[2]);
        const wrap = (v) => { let r = v % 360; if (r >= 180) r -= 360; if (r < -180) r += 360; return r; };
        const rot = (t, base) => (t === undefined ? NaN : t.startsWith('~') ? base + Number(t.slice(1) || 0) : Number(t));
        const yaw = rot(a[3], st.player.yaw);
        const pitch = rot(a[4], st.player.pitch);
        Object.assign(st.player, { x: xyz[0], y: xyz[1], z: xyz[2] }, Number.isFinite(yaw) ? { yaw: wrap(yaw) } : {}, Number.isFinite(pitch) ? { pitch: Math.min(90, Math.max(-90, wrap(pitch))) } : {});
        st.tpAt = Date.now();
        return { success: true, result: 1, output: [`Teleported Player to ${xyz.join(', ')}`] };
      }
      case 'kill':
        return w.length >= 2 ? cmdFail('No entity was found') : cmdFail(INCOMPLETE, `${text}<--[HERE]`); // 假世界里没有实体
      case 'time':
      case 'weather':
      case 'say':
        return w.length >= 2 ? { success: true, result: 1, output: [`ok: ${text}`] } : cmdFail(INCOMPLETE, `${text}<--[HERE]`);
      default:
        return cmdFail(INCOMPLETE, `${text}<--[HERE]`);
    }
  }

  const ok = (o2 = {}) => [200, { ok: true, ...o2 }];
  const err = (status, error, message) => [status, { ok: false, error, message }];
  const loaded = (x, z) => Math.abs(x) <= 1000 && Math.abs(z) <= 1000;

  const ROUTES = {
    '/status': ['GET', () => ok({ v: o.v, mc: '26.1.2', neoforge: '26.1.2.76', pid: reportedPid(), ready: st.ready, screen: st.screen, inWorld: st.inWorld, player: st.player, chunksRendered: chunksRendered(), fps: 60, snapshotAgeMs: 5,
      // 09:30 加的三项；oldProbe 模拟没有这些字段、也没有 /input 的旧探针
      ...(o.oldProbe ? {} : { inputLocked: st.inputLocked, mouseGrabbed: !st.inputLocked && st.windowFocused && st.inWorld && st.screen === null, windowFocused: st.windowFocused }) })],
    '/world/open': [
      'POST',
      (q, b) => {
        if (st.inWorld || st.phase !== 'title') return err(409, 'busy', '已经在世界里了（或者正在进出世界）');
        if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim())) return err(400, 'bad_request', 'name 要是字符串');
        if (b.seed !== undefined && !Number.isSafeInteger(b.seed)) return err(400, 'bad_request', 'seed 要是整数');
        const name = b.name ?? `probe-${stamp()}`;
        let folder = name.replace(/[^A-Za-z0-9._ -]/g, '_');
        if (worlds.has(folder)) {
          let n = 1;
          while (worlds.has(`${folder} (${n})`)) n++;
          folder = `${folder} (${n})`;
        }
        worlds.add(folder);
        blocks = new Map();
        Object.assign(st, { world: folder, phase: 'opening', phaseUntil: Date.now() + o.openDelayMs, screen: 'GenericMessageScreen', tpAt: null, player: { x: 0.5, y: -60, z: 0.5, yaw: 0, pitch: 0, dimension: 'minecraft:overworld', gameMode: 'creative' } });
        return ok({ started: true, name, folder });
      },
    ],
    '/world/leave': [
      'POST',
      () => {
        if (!st.inWorld) return err(409, 'not_in_world', '不在世界里');
        Object.assign(st, { phase: 'leaving', phaseUntil: Date.now() + o.leaveDelayMs, inWorld: false, screen: 'GenericMessageScreen', player: null, tpAt: null });
        return ok({ started: true });
      },
    ],
    '/command': [
      'POST',
      async (q, b) => {
        if (typeof b.command !== 'string' || !b.command.trim()) return err(400, 'bad_request', 'command 要是字符串');
        if (b.as !== undefined && b.as !== 'player' && b.as !== 'server') return err(400, 'bad_request', 'as 只能是 player 或 server');
        if (!st.inWorld) return err(409, 'not_in_world', '不在世界里');
        return ok(await runCommand(b.command.replace(/^\//, ''), b.as ?? 'player'));
      },
    ],
    '/block': [
      'GET',
      (q) => {
        const pos = ['x', 'y', 'z'].map((k) => (/^-?\d+$/.test(q.get(k) ?? '') ? Number(q.get(k)) : null));
        if (pos.includes(null)) return err(400, 'bad_request', 'x、y、z 要是整数');
        if (q.has('dim') && q.get('dim') !== 'minecraft:overworld') return err(400, 'bad_request', '不认识的维度');
        if (!st.inWorld) return err(409, 'not_in_world', '不在世界里');
        if (pos[1] < -64 || pos[1] > 319) return err(400, 'bad_request', 'y 超出高度范围');
        if (!loaded(pos[0], pos[2])) return err(409, 'chunk_not_loaded', '区块没加载');
        const b = getBlock(pos);
        return ok({ pos, state: b.state, block: b.id, properties: b.props, blockEntity: b.be ?? null });
      },
    ],
    '/region': [
      'POST',
      (q, b) => {
        if (!isPos(b.from) || !isPos(b.to)) return err(400, 'bad_request', 'from、to 要是 [x, y, z]');
        if (!st.inWorld) return err(409, 'not_in_world', '不在世界里');
        const min = b.from.map((v, i) => Math.min(v, b.to[i]));
        const max = b.from.map((v, i) => Math.max(v, b.to[i]));
        const size = max.map((v, i) => v - min[i] + 1);
        if (size.some((n) => n > 64)) return err(400, 'too_large', '每个方向最多 64 格');
        if (min[1] < -64 || max[1] > 319) return err(400, 'bad_request', 'y 超出高度范围');
        if (!loaded(min[0], min[2]) || !loaded(max[0], max[2])) return err(409, 'chunk_not_loaded', '区块没加载');
        const palette = [];
        const index = new Map();
        const out = [];
        const bes = [];
        for (let y = min[1]; y <= max[1]; y++) {
          for (let z = min[2]; z <= max[2]; z++) {
            for (let x = min[0]; x <= max[0]; x++) {
              const blk = getBlock([x, y, z]);
              if (!index.has(blk.state)) {
                index.set(blk.state, palette.length);
                palette.push(blk.state);
              }
              out.push(index.get(blk.state));
              if (blk.be) bes.push({ pos: [x, y, z], nbt: blk.be });
            }
          }
        }
        return ok({ origin: min, size, palette, blocks: out, blockEntities: bes });
      },
    ],
    // /shapes：每个不是空气的格子按邻居重算一遍（mock 只会算栅栏、玻璃板、灯笼、门，见 mock-shapes.mjs），和现在的状态比
    '/shapes': [
      'POST',
      (q, b) => {
        if (!isPos(b.from) || !isPos(b.to)) return err(400, 'bad_request', 'from、to 要是 [x, y, z]');
        if (!st.inWorld) return err(409, 'not_in_world', '不在世界里');
        const min = b.from.map((v, i) => Math.min(v, b.to[i]));
        const max = b.from.map((v, i) => Math.max(v, b.to[i]));
        const size = max.map((v, i) => v - min[i] + 1);
        if (size.some((n) => n > 64)) return err(400, 'too_large', '每个方向最多 64 格');
        if (min[1] < -64 || max[1] > 319) return err(400, 'bad_request', 'y 超出高度范围');
        if (!loaded(min[0] - 1, min[2] - 1) || !loaded(max[0] + 1, max[2] + 1)) return err(409, 'chunk_not_loaded', '区块没加载（区域和外面一圈都要加载）');
        st.shapesCalls = (st.shapesCalls ?? 0) + 1;
        let checked = 0;
        let changed = 0;
        const diffs = [];
        for (let y = min[1]; y <= max[1]; y++) {
          for (let z = min[2]; z <= max[2]; z++) {
            for (let x = min[0]; x <= max[0]; x++) {
              const pos = [x, y, z];
              const blk = getBlock(pos);
              if (isAir(blk)) continue;
              checked++;
              const g = gameShape(blk, pos, getBlock);
              const game = makeBlock(g.id, g.props).state;
              if (game === blk.state) continue;
              changed++;
              if (diffs.length < 256) diffs.push({ pos, state: blk.state, game });
            }
          }
        }
        return ok({ origin: min, size, checked, changed, diffs, truncated: changed > diffs.length });
      },
    ],
    '/screenshot': [
      'POST',
      (q, b) => {
        const name = b.name ?? 'shot';
        if (typeof name !== 'string' || !NAME_RE.test(name)) return err(400, 'bad_request', '截图名只能用 [A-Za-z0-9._-]，1 到 64 个字符');
        if (b.hideGui !== undefined && typeof b.hideGui !== 'boolean') return err(400, 'bad_request', 'hideGui 要是布尔值');
        // 记下最后一次截图收到的参数（测试看 hideGui 有没有原样发过来；没发就没有这个键）
        st.lastShot = Object.hasOwn(b, 'hideGui') ? { name, hideGui: b.hideGui } : { name };
        if (o.onShot) o.onShot(st); // 测试用：截图的那一刻改动玩家（模拟截图时有人动了鼠标）
        const s = { meanBrightness: 0.45, distinctColors: 5000, width: 1280, height: 720, ...o.shot };
        fs.mkdirSync(shotsDir, { recursive: true });
        let file = path.join(shotsDir, `${name}-${stamp()}.png`);
        for (let n = 2; fs.existsSync(file); n++) file = path.join(shotsDir, `${name}-${stamp()}-${n}.png`);
        fs.writeFileSync(file, pngBytes(4, 3));
        return ok({ path: file, ...s, ms: 5 });
      },
    ],
    '/quit': ['POST', () => ok({})],
    '/input': [
      'POST',
      (q, b) => {
        if (typeof b.locked !== 'boolean') return err(400, 'bad_request', 'locked 要是布尔值');
        st.inputLocked = b.locked;
        st.inputCalls = (st.inputCalls ?? 0) + 1;
        return ok({ locked: st.inputLocked });
      },
    ],
    // /use：模拟右键（接口 12）。mock 不会换照片：o.onUse(body, api) 给回复 {result, consumed, actionBar}，不给就是「没起作用」
    '/use': [
      'POST',
      async (q, b) => {
        if (!isPos(b.pos)) return err(400, 'bad_request', 'pos 要是 [x, y, z]');
        if (b.face !== undefined && !['down', 'up', 'north', 'south', 'west', 'east'].includes(b.face)) return err(400, 'bad_request', 'face 不对');
        if (b.hit !== undefined && !(Array.isArray(b.hit) && b.hit.length === 3 && b.hit.every(Number.isFinite))) return err(400, 'bad_request', 'hit 要是 3 个数');
        if (b.sneak !== undefined && typeof b.sneak !== 'boolean') return err(400, 'bad_request', 'sneak 要是布尔值');
        if (!st.inWorld) return err(409, 'not_in_world', '不在世界里');
        if (!loaded(b.pos[0], b.pos[2])) return err(409, 'chunk_not_loaded', '区块没加载');
        st.uses = [...(st.uses ?? []), b];
        const r = o.onUse ? await o.onUse(b, api) : null;
        return ok(r ?? { result: 'pass', consumed: false, actionBar: null });
      },
    ],
  };
  if (o.oldProbe) delete ROUTES['/use']; // 旧探针：没有 /use（回 404）
  if (o.oldProbe) delete ROUTES['/input']; // 旧探针：没有 /input（回 404）
  if (o.oldProbe || o.noShapes) delete ROUTES['/shapes']; // 没有 /shapes 的探针（回 404）

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size <= LIMIT) chunks.push(c);
    }
    const rec = { method: req.method, path: url.pathname, origin: req.headers.origin, at: Date.now() };
    requests.push(rec);
    if (o.forbidAll || req.headers.origin !== undefined) return err(403, 'forbidden', '不接受带 Origin 的请求');
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return err(403, 'forbidden', 'Host 不对');
    if (req.headers.authorization !== `Bearer ${token}`) return err(401, 'unauthorized', 'token 不对');
    if (size > LIMIT) return err(400, 'too_large', '请求体超过 64 KB');
    const route = ROUTES[url.pathname];
    if (!route) return err(404, 'not_found', `没有这个接口：${url.pathname}`);
    if (route[0] !== req.method) return err(405, 'method_not_allowed', `${url.pathname} 要用 ${route[0]}`);
    let body = {};
    if (req.method === 'POST') {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          return err(400, 'bad_request', '请求体不是 JSON');
        }
      }
      if (!isObj(body)) return err(400, 'bad_request', '请求体要是 JSON 对象');
    }
    rec.body = body;
    if (o.crashOn === url.pathname) return 'crash';
    if (o.hang[url.pathname]) await delay(o.hang[url.pathname]);
    tick();
    if (!st.ready && url.pathname !== '/status' && url.pathname !== '/quit') return err(409, 'busy', '游戏还没到主菜单');
    const inj = o.fail[url.pathname];
    if (inj) {
      if (inj.once) delete o.fail[url.pathname];
      return err(inj.status ?? 500, inj.error ?? 'internal', inj.message ?? '注入的错误');
    }
    return route[1](url.searchParams, body);
  }

  async function crash(req) {
    if (dummy && dummy.exitCode === null) {
      dummy.kill();
      await dummyExited;
    }
    req.socket.destroy();
    stopServer();
  }

  function stopServer() {
    if (closed) return;
    closed = true;
    deleteProbeFile();
    server.closeAllConnections?.();
    server.close();
  }

  function onQuitReply() {
    st.quitCount++;
    if (quitting) return;
    quitting = true;
    stopServer(); // 和真探针一样：一开始就删文件、关服务，进程过一会儿才退
    if (o.quitBehavior === 'hang') return;
    const t = setTimeout(async () => {
      if (dummy && dummy.exitCode === null) {
        dummy.kill();
        await dummyExited;
      }
      o.onQuit?.();
    }, o.exitDelayMs);
    timers.add(t);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).then(
      (r) => {
        if (r === 'crash') return crash(req);
        const [status, body] = r;
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
        if (req.url.startsWith('/quit') && status === 200) res.on('finish', onQuitReply);
      },
      (e) => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'internal', message: String(e?.stack || e) }));
      },
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  if (o.writeProbeFile) writeFileAtomic();

  return {
    port,
    token,
    probeFile,
    dir,
    shotsDir,
    requests,
    state: st,
    blocks: () => blocks,
    get closed() {
      return closed;
    },
    gamePid: reportedPid(),
    writeProbeFile: writeFileAtomic,
    async close() {
      for (const t of timers) {
        clearTimeout(t);
        t.resolve?.();
      }
      timers.clear();
      stopServer();
      if (dummy && dummy.exitCode === null) {
        dummy.kill();
        await dummyExited;
      }
    },
  };
}
