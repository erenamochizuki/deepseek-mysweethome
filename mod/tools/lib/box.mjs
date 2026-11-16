// 「盒子」：世界里的一块长方体，或者鲸图 / dump 里的模型，统一成一种样子好逐格比：
//   { origin: 最小角的世界坐标（模型是 null）, size: [W, H, L],
//     states: 方块状态字符串，下标 i = x + z·W + y·W·L（和探针 /region、FORMAT.md 一样）,
//     bes: Map<'x,y,z'（相对最小角）, { id, data: 带类型的 compound（去掉 id、x、y、z）}> }
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { MOD_DIR, ProbeError } from '../probe-client.mjs';
import { parseCompound, typedDiff, tagType } from './snbt.mjs';

export const REPO_DIR = path.resolve(MOD_DIR, '..');
export const SHARE_TOOL = path.join(REPO_DIR, 'web', 'tools', 'share.mjs');
export const MAX_BOX_CELLS = 1048576;
const TILE = 64;
const META_KEYS = ['id', 'x', 'y', 'z'];

export class BoxError extends Error {
  constructor(message) { super(message); this.name = 'BoxError'; }
}

export const boxCorners = (from, to) => [
  [0, 1, 2].map((k) => Math.min(from[k], to[k])),
  [0, 1, 2].map((k) => Math.max(from[k], to[k])),
];

// 探针给的方块实体 SNBT → { id, data }；顺便核对里面的 x、y、z 和位置一样
export function splitBlockEntity(nbt, pos) {
  const where = `[${pos.join(', ')}]`;
  let c;
  try { c = parseCompound(nbt).compound; } catch (e) { throw new BoxError(`${where} 的方块实体读不懂：${e.message}`); }
  if (tagType(c.id) !== 'string') throw new BoxError(`${where} 的方块实体没有字符串 id`);
  ['x', 'y', 'z'].forEach((k, j) => {
    if (c[k] !== undefined && c[k]?.int !== pos[j]) throw new BoxError(`${where} 的方块实体里 ${k} 是 ${JSON.stringify(c[k])}，和位置对不上`);
  });
  const data = {};
  for (const k of Object.keys(c)) {
    if (!META_KEYS.includes(k)) Object.defineProperty(data, k, { value: c[k], enumerable: true, writable: true, configurable: true });
  }
  return { id: c.id.string, data: { compound: data } };
}

// 用探针读一块区域（每个方向超过 64 格就分几次读）
export async function readBox(client, from, to, { dim, signal } = {}) {
  const [lo, hi] = boxCorners(from, to);
  const size = [0, 1, 2].map((k) => hi[k] - lo[k] + 1);
  const total = size[0] * size[1] * size[2];
  if (total > MAX_BOX_CELLS) throw new BoxError(`区域太大：${size.join('×')} = ${total} 格，最多 ${MAX_BOX_CELLS} 格`);
  const states = new Array(total);
  const bes = new Map();
  for (let y0 = lo[1]; y0 <= hi[1]; y0 += TILE) {
    for (let z0 = lo[2]; z0 <= hi[2]; z0 += TILE) {
      for (let x0 = lo[0]; x0 <= hi[0]; x0 += TILE) {
        const b = [Math.min(x0 + TILE - 1, hi[0]), Math.min(y0 + TILE - 1, hi[1]), Math.min(z0 + TILE - 1, hi[2])];
        const r = await client.region([x0, y0, z0], b, { dim }, { signal });
        const [w, h, l] = r.size ?? [];
        if (!Array.isArray(r.blocks) || r.blocks.length !== w * h * l) throw new BoxError('探针 /region 回的 blocks 长度和 size 对不上');
        for (let i = 0; i < r.blocks.length; i++) {
          const s = r.palette[r.blocks[i]];
          if (typeof s !== 'string') throw new BoxError('探针 /region 回的 blocks 里有 palette 外的下标');
          const x = r.origin[0] + (i % w) - lo[0];
          const z = r.origin[2] + (Math.floor(i / w) % l) - lo[2];
          const y = r.origin[1] + Math.floor(i / (w * l)) - lo[1];
          states[x + z * size[0] + y * size[0] * size[2]] = s;
        }
        for (const e of r.blockEntities ?? []) {
          bes.set(e.pos.map((v, k) => v - lo[k]).join(','), splitBlockEntity(e.nbt, e.pos));
        }
      }
    }
  }
  return { origin: lo, size, states, bes };
}

// FORMAT.md §4 的 dump → 盒子。data 是 null（文件里没存数据）就当空 compound 比。
export function boxFromDump(dump, label = 'dump') {
  const fail = (m) => { throw new BoxError(`${label}：${m}`); };
  if (!dump || typeof dump !== 'object' || dump.dump !== 1) fail('不是 dump（要有 "dump": 1）');
  const size = dump.size;
  if (!Array.isArray(size) || size.length !== 3 || !size.every((n) => Number.isSafeInteger(n) && n > 0)) fail('size 不对');
  const total = size[0] * size[1] * size[2];
  if (total > MAX_BOX_CELLS) fail(`太大了：${total} 格`);
  if (!Array.isArray(dump.palette) || !Array.isArray(dump.cells)) fail('没有 palette 或 cells');
  const states = [];
  for (const run of dump.cells) {
    const [n, p] = Array.isArray(run) ? run : [];
    if (!Number.isSafeInteger(n) || n < 1 || typeof dump.palette[p] !== 'string') fail(`cells 里的 ${JSON.stringify(run)} 不对`);
    if (states.length + n > total) fail(`cells 的格子数比 size（${total} 格）多`);
    for (let k = 0; k < n; k++) states.push(dump.palette[p]);
  }
  if (states.length !== total) fail(`cells 一共 ${states.length} 格，size 是 ${total} 格`);
  const bes = new Map();
  for (const e of dump.blockEntities ?? []) {
    if (!Array.isArray(e?.pos) || typeof e.id !== 'string') fail('blockEntities 里有不对的项');
    bes.set(e.pos.join(','), { id: e.id, data: e.data ?? { compound: {} } });
  }
  // meta 原样（带类型的 JSON，没有就是 null）；facing = Metadata.Xiaojingyu.Facing（没有就是 null）
  const xjy = dump.meta?.compound?.Xiaojingyu?.compound;
  return { origin: null, size, states, bes, offset: dump.offset ?? null, meta: dump.meta ?? null, facing: xjy?.Facing?.string ?? null };
}

// 读模型文件：.json 当 dump 读；.png / .schem 交给网页这边的 `node web/tools/share.mjs dump`
export async function loadModelFile(file, { signal } = {}) {
  const label = path.basename(file);
  if (!fs.existsSync(file)) throw new BoxError(`文件不存在：${file}`);
  if (/\.json$/i.test(file)) {
    let dump;
    try { dump = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new BoxError(`${label} 不是合法的 JSON：${e.message}`); }
    return boxFromDump(dump, label);
  }
  const r = await new Promise((resolve) => {
    execFile(process.execPath, [SHARE_TOOL, 'dump', file],
      { cwd: REPO_DIR, maxBuffer: 1 << 29, windowsHide: true, signal },
      (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
  if (r.err?.name === 'AbortError') throw new ProbeError('aborted', '被打断了');
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* 下面报错 */ }
  if (out?.error) throw new BoxError(`${label} 读不出来：${out.error}：${out.message}`);
  if (r.err || !out) {
    const tail = String(r.stderr || r.stdout || r.err?.message).trim().split('\n').slice(-3).join(' / ');
    throw new BoxError(`share.mjs dump ${label} 出错（退出码 ${r.err?.code ?? '?'}）：${tail}`);
  }
  return boxFromDump(out, label);
}

// 两个模型（鲸图 / dump，没有 origin）逐格比，坐标写模型里的格子 (x, y, z)。
// diffs：期望不一样的格子 [{pos: [x, y, z], was: 原来的状态, now: 抓出来的状态}]，这些格子必须正好是 was → now，
// 方块实体在这些格子上不比（状态都变了，方块实体跟着变）。别的格子的状态、方块实体都要一样（比法和 compareBoxes 一样）。
export function compareModels(want, got, { diffs = [], limit = 8 } = {}) {
  if (want.size.join() !== got.size.join()) {
    return { count: 1, problems: [`大小不一样：原来 ${want.size.join('×')}，抓出来 ${got.size.join('×')}`] };
  }
  const problems = [];
  let count = 0;
  const add = (m) => { count++; if (problems.length < limit) problems.push(m); };
  const [W, , L] = want.size;
  const expected = new Map(diffs.map((d) => [d.pos.join(','), d]));
  const cell = (k) => `格子 (${k.split(',').join(', ')})`;
  for (let i = 0; i < want.states.length; i++) {
    const key = [i % W, Math.floor(i / (W * L)), Math.floor(i / W) % L].join(',');
    const d = expected.get(key);
    if (d) {
      if (want.states[i] !== d.was) add(`${cell(key)} 原来是 ${want.states[i]}，卡片里写的是 ${d.was}`);
      if (got.states[i] !== d.now) add(`${cell(key)} 期望抓出来是 ${d.now}，实际 ${got.states[i]}`);
    } else if (want.states[i] !== got.states[i]) {
      add(`${cell(key)} 原来是 ${want.states[i]}，抓出来是 ${got.states[i]}`);
    }
  }
  for (const k of new Set([...want.bes.keys(), ...got.bes.keys()])) {
    if (expected.has(k)) continue;
    const a = want.bes.get(k);
    const b = got.bes.get(k);
    if (!b) add(`${cell(k)} 原来有方块实体 ${a.id}，抓出来没有`);
    else if (!a) add(`${cell(k)} 抓出来多了方块实体 ${b.id}`);
    else if (a.id !== b.id) add(`${cell(k)} 方块实体 id 原来是 ${a.id}，抓出来是 ${b.id}`);
    else {
      const d = typedDiff(a.data, b.data);
      if (d) add(`${cell(k)} 方块实体 ${a.id} 的数据不一样：${d}`);
    }
  }
  return { count, problems };
}

// 逐格比：状态、方块实体的位置、id、数据。got 要有 origin（用来写世界坐标）。
export function compareBoxes(want, got, { limit = 8 } = {}) {
  if (want.size.join() !== got.size.join()) {
    return { count: 1, problems: [`大小不一样：期望 ${want.size.join('×')}，实际 ${got.size.join('×')}`] };
  }
  const problems = [];
  let count = 0;
  const add = (m) => { count++; if (problems.length < limit) problems.push(m); };
  const [W, , L] = want.size;
  const world = (rel) => `[${rel.map((v, k) => got.origin[k] + v).join(', ')}]`;
  for (let i = 0; i < want.states.length; i++) {
    if (want.states[i] !== got.states[i]) {
      add(`${world([i % W, Math.floor(i / (W * L)), Math.floor(i / W) % L])} 期望 ${want.states[i]}，实际 ${got.states[i]}`);
    }
  }
  for (const k of new Set([...want.bes.keys(), ...got.bes.keys()])) {
    const at = world(k.split(',').map(Number));
    const a = want.bes.get(k);
    const b = got.bes.get(k);
    if (!b) add(`${at} 期望有方块实体 ${a.id}，实际没有`);
    else if (!a) add(`${at} 多了方块实体 ${b.id}`);
    else if (a.id !== b.id) add(`${at} 方块实体 id 期望 ${a.id}，实际 ${b.id}`);
    else {
      const d = typedDiff(a.data, b.data);
      if (d) add(`${at} 方块实体 ${a.id} 的数据不一样：${d}`);
    }
  }
  return { count, problems };
}
