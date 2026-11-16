// mock-xjy.mjs：给 mock 探针加上 P2 卡片要用的命令，好在不开游戏的时候先把卡片跑一遍。
//   setblock（认任何方块，可以带 NBT）、fill、execute if/unless entity（假世界里除了玩家没有实体）、
//   /xjy capture / place / undo / status（按 docs/COMMANDS.md 的规则；文件用网页那边的 V3.share 读写）、
//   /xjy capture 上次|last [名字]（§2b：按这个世界里最近一次放完的 place 抓，格子和状态转回原文件的摆法；place 放完才记，undo 删掉它那条）、
//   抓取范围（§2「抓取范围配置」）：不写的数字每次现读游戏目录的 config/xiaojingyu-common.toml（configRange），往后 = 从自己站的这一列往身后，
//   /xjy capture 范围|range <前> <后> <左右> <高> [名字]，/xjy status 多一行 "… the same as /xjy capture range F B S U."、
//   /xjy blacklist [add|remove [方块] | list | clear]（§2a；名单只在内存里；不带参数的 add/remove 按玩家朝向找准星对着的方块；
//   不带子命令时 /status 的 screen 变成 BlacklistScreen），capture 按 §2 把名单里的方块、液体当空气、含水方块去掉水；
//   tick freeze|unfreeze、give、recipe give|take <玩家> <配方|*> 只回成功。
// 这不是游戏：方块不会按邻居重算形状、不补没写的属性、没有掉落物，水和岩浆不会流也不会互相变成石头。只用来检查卡片本身（坐标、转向、文件名）。
// 用法：startMockProbe({ commands: xjyCommands(), dummyGame: true })
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeBlock, REPO_DIR } from './mock-probe.mjs';
import { parseCompound, toSnbt, tagType } from '../lib/snbt.mjs';

let V3cache = null;
export async function share() {
  if (!V3cache) {
    const { loadV3 } = await import(pathToFileURL(path.join(REPO_DIR, 'web', 'tools', 'lib', 'v3-node.mjs')).href);
    V3cache = loadV3(['12-nbt', '13-share']).V3;
  }
  return V3cache.share;
}

const define = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });

// 有方块实体的方块 → 方块实体 id 和刚放下时的数据（只列卡片会用到的）
const signText = () => ({ compound: { color: { string: 'black' }, has_glowing_text: { byte: 0 }, messages: { list: [1, 2, 3, 4].map(() => ({ string: '' })) } } });
function beOf(id) {
  if (['minecraft:chest', 'minecraft:trapped_chest', 'minecraft:barrel'].includes(id)) return { id, data: { Items: { list: [] } } };
  if (/_sign$/.test(id) && !/hanging/.test(id)) return { id: 'minecraft:sign', data: { back_text: signText(), front_text: signText(), is_waxed: { byte: 0 } } };
  if (/_bed$/.test(id)) return { id: 'minecraft:bed', data: {} };
  return null;
}

// compound 合并：两边都是 compound 就往里合并，否则后面的盖掉前面的
function merge(base, extra) {
  const out = {};
  for (const k of Object.keys(base)) define(out, k, base[k]);
  for (const k of Object.keys(extra)) {
    const both = tagType(base[k]) === 'compound' && tagType(extra[k]) === 'compound';
    define(out, k, both ? { compound: merge(base[k].compound, extra[k].compound) } : extra[k]);
  }
  return out;
}

// 方块实体存成探针那样的 SNBT（saveWithFullMetadata：带 components、id、x、y、z）。
// 小鲸鱼之家的照片方块（相册矮桌、相框、画框墙）和模组一样：components 是空的就不写（PhotoBlockEntity，mod7）
const NO_EMPTY_COMPONENTS = new Set(['xiaojingyu:photo_album_table', 'xiaojingyu:photo_frame', 'xiaojingyu:picture_frames']);
export function beSnbt(id, data, pos) {
  const c = merge(NO_EMPTY_COMPONENTS.has(id) ? {} : { components: { compound: {} } }, data);
  define(c, 'id', { string: id });
  ['x', 'y', 'z'].forEach((k, i) => define(c, k, { int: pos[i] }));
  return toSnbt({ compound: c });
}

export function blockAt(id, props, pos, data) {
  const b = makeBlock(id, props);
  const be = beOf(id);
  if (be) b.be = beSnbt(be.id, data ? merge(be.data, data) : be.data, pos);
  return b;
}

/** P2 卡片用到的方块的默认属性（原版的默认值；游戏 setblock 会补上没写的属性，mock 也补）。连接类属性 mock 不按邻居重算。 */
const NONE4 = { east: 'none', north: 'none', south: 'none', west: 'none' };
const FALSE4 = { east: 'false', north: 'false', south: 'false', west: 'false' };
const DEFAULTS = {
  'minecraft:grass_block': { snowy: 'false' },
  'minecraft:oak_log': { axis: 'y' },
  'minecraft:oak_stairs': { facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'false' },
  'minecraft:stone_brick_stairs': { facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'false' },
  'minecraft:oak_slab': { type: 'bottom', waterlogged: 'false' },
  'minecraft:chest': { facing: 'north', type: 'single', waterlogged: 'false' },
  'minecraft:barrel': { facing: 'north', open: 'false' },
  'minecraft:red_bed': { facing: 'north', occupied: 'false', part: 'foot' },
  'minecraft:oak_door': { facing: 'north', half: 'lower', hinge: 'left', open: 'false', powered: 'false' },
  'minecraft:oak_fence': { ...FALSE4, waterlogged: 'false' },
  'minecraft:cobblestone_wall': { ...NONE4, up: 'true', waterlogged: 'false' },
  'minecraft:redstone_wire': { ...NONE4, power: '0' },
  'minecraft:oak_sign': { rotation: '0', waterlogged: 'false' },
  'minecraft:oak_wall_sign': { facing: 'north', waterlogged: 'false' },
  'minecraft:wall_torch': { facing: 'north' },
  'minecraft:lantern': { hanging: 'false', waterlogged: 'false' },
  'minecraft:ladder': { facing: 'north', waterlogged: 'false' },
  'minecraft:water': { level: '0' },
  'minecraft:lava': { level: '0' },
  'minecraft:bubble_column': { drag: 'true' },
  'xiaojingyu:dining_table': { facing: 'north' },
};
/** /xjy blacklist add 认得的方块（真游戏查注册表）：DEFAULTS 里的，加上这些没有属性的。 */
const KNOWN = new Set([...Object.keys(DEFAULTS), 'minecraft:air', 'minecraft:stone', 'minecraft:dirt', 'minecraft:glass',
  'minecraft:oak_planks', 'minecraft:stone_bricks', 'minecraft:short_grass', 'minecraft:seagrass', 'minecraft:tall_seagrass',
  'minecraft:magma_block', 'minecraft:bookshelf', 'minecraft:crafting_table', 'minecraft:diamond_block']);
/** 抓取时一定当空气、也不能加进名单的（COMMANDS.md §2）。 */
const LIQUIDS = new Set(['minecraft:water', 'minecraft:lava', 'minecraft:bubble_column']);
const ALWAYS_AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', ...LIQUIDS]);

/** setblock / fill 的方块参数：id[属性]{NBT}。认任何方块；DEFAULTS 里有的方块补上没写的属性。 */
export function parseBlockArg(text) {
  const m = /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)(?:\[([^\]]*)\])?(\{.*\})?$/.exec(text);
  if (!m) return { error: `Invalid block state: ${text}` };
  const id = `${m[1] ?? 'minecraft'}:${m[2]}`;
  const props = { ...(DEFAULTS[id] ?? {}) };
  for (const kv of m[3] ? m[3].split(',') : []) {
    const [k, v] = kv.split('=');
    if (!k || !v) return { error: `Invalid block state property: ${kv}` };
    props[k] = v;
  }
  let nbt = null;
  if (m[4]) {
    try { nbt = parseCompound(m[4]).compound; } catch (e) { return { error: `Invalid NBT: ${e.message}` }; }
  }
  return { id, props, nbt };
}

export const DIRS = ['north', 'east', 'south', 'west']; // 顺时针
/** 和 BlockState.rotate 一样顺时针转 k 次 90°（facing、axis、rotation、四个方向的连接属性）。 */
export function rotateProps(props, k) {
  k = ((k % 4) + 4) % 4;
  const out = { ...props };
  if (!k) return out;
  if (DIRS.includes(props.facing)) out.facing = DIRS[(DIRS.indexOf(props.facing) + k) % 4];
  if (k % 2 && (props.axis === 'x' || props.axis === 'z')) out.axis = props.axis === 'x' ? 'z' : 'x';
  if (props.rotation !== undefined) out.rotation = String((Number(props.rotation) + 4 * k) % 16);
  const conn = DIRS.filter((d) => props[d] !== undefined);
  for (const d of conn) delete out[d];
  for (const d of conn) out[DIRS[(DIRS.indexOf(d) + k) % 4]] = props[d];
  return out;
}
/** BlockPos.rotate：顺时针 90° 一次 (x, y, z) → (−z, y, x)。 */
export function rotatePos([x, y, z], k) {
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) [x, z] = [-z, x];
  return [x, y, z];
}
/** Direction.fromYRot：南 0、西 90、北 180、东 −90。 */
export const facingOf = (yaw) => ['south', 'west', 'north', 'east'][Math.floor((yaw ?? 0) / 90 + 0.5) & 3];
export const VEC = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };
export const RIGHT = { north: 'east', east: 'south', south: 'west', west: 'north' };
const standing = (api) => [api.player.x, api.player.y, api.player.z].map(Math.floor);
const coord = (v, b) => {
  const m = /^(~)?(-?\d+(?:\.\d+)?)?$/.exec(v);
  if (!m || (!m[1] && m[2] === undefined)) return null;
  return Math.floor(m[1] ? b + Number(m[2] ?? 0) : Number(m[2]));
};
const isAir = (s) => /^minecraft:(air|cave_air|void_air)$/.test(s);

function setblockCmd(_w, text, api) {
  const m = /^setblock\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+?)(?:\s+(destroy|keep|replace|strict))?$/.exec(text);
  if (!m) return api.cmdFail(api.INCOMPLETE, `${text}<--[HERE]`);
  const pos = [m[1], m[2], m[3]].map((v, i) => coord(v, [api.player.x, api.player.y, api.player.z][i]));
  if (pos.includes(null)) return api.cmdFail('Expected integer');
  const b = parseBlockArg(m[4]);
  if (b.error) return api.cmdFail(b.error);
  if (pos[1] < -64 || pos[1] > 319) return api.cmdFail('Cannot place block outside of the world');
  const old = api.getBlock(pos);
  const blk = blockAt(b.id, b.props, pos, b.nbt);
  if ((m[5] === 'keep' && !isAir(old.state)) || (old.state === blk.state && !old.be && !blk.be)) return api.cmdFail('Could not set the block');
  api.setBlock(pos, blk);
  return { success: true, result: 1, output: [`Changed the block at ${pos.join(', ')}`] };
}

function fillCmd(_w, text, api) {
  const m = /^fill(\s+\S+){6}\s+(.+?)(?:\s+(destroy|hollow|keep|outline|replace|strict))?$/.exec(text);
  if (!m) return api.cmdFail(api.INCOMPLETE, `${text}<--[HERE]`);
  const words = text.split(/\s+/).slice(1, 7);
  const p = words.map((v, i) => coord(v, [api.player.x, api.player.y, api.player.z][i % 3]));
  if (p.includes(null)) return api.cmdFail('Expected integer');
  const lo = [0, 1, 2].map((k) => Math.min(p[k], p[k + 3]));
  const hi = [0, 1, 2].map((k) => Math.max(p[k], p[k + 3]));
  const n = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
  if (n > 32768) return api.cmdFail(`Too many blocks in the specified area (maximum 32768, specified ${n})`);
  const b = parseBlockArg(m[2]);
  if (b.error) return api.cmdFail(b.error);
  let changed = 0;
  for (let y = lo[1]; y <= hi[1]; y++) {
    for (let z = lo[2]; z <= hi[2]; z++) {
      for (let x = lo[0]; x <= hi[0]; x++) {
        const old = api.getBlock([x, y, z]);
        const blk = blockAt(b.id, b.props, [x, y, z], b.nbt);
        if (old.state === blk.state && !old.be && !blk.be) continue;
        api.setBlock([x, y, z], blk);
        changed++;
      }
    }
  }
  if (!changed) return api.cmdFail('No blocks were filled');
  return { success: true, result: changed, output: [`Successfully filled ${changed} block(s)`] };
}

function executeCmd(_w, text, api) {
  // execute if|unless blocks <源起点> <源终点> <目标起点> all|masked：mock 只比方块状态（不比方块实体）
  const b = /^execute\s+(if|unless)\s+blocks((?:\s+-?\d+){9})\s+(all|masked)$/.exec(text);
  if (b) {
    const n = b[2].trim().split(/\s+/).map(Number);
    const lo = [0, 1, 2].map((i) => Math.min(n[i], n[i + 3]));
    const hi = [0, 1, 2].map((i) => Math.max(n[i], n[i + 3]));
    let same = true;
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const src = api.getBlock([x, y, z]);
      if (b[3] === 'masked' && src.id === 'minecraft:air') continue;
      if (api.getBlock([n[6] + x - lo[0], n[7] + y - lo[1], n[8] + z - lo[2]]).state !== src.state) same = false;
    }
    return (b[1] === 'if') === same ? { success: true, result: 1, output: ['Test passed'] } : api.cmdFail('Test failed');
  }
  const m = /^execute\s+(if|unless)\s+entity\s+(\S+)$/.exec(text);
  if (!m) return api.cmdFail(api.INCOMPLETE, `${text}<--[HERE]`);
  const found = /^@[spa]$/.test(m[2]) || /type=(minecraft:)?player\b/.test(m[2]);
  const pass = (m[1] === 'if') === found;
  return pass ? { success: true, result: 1, output: ['Test passed'] } : api.cmdFail('Test failed');
}

// ---- /xjy capture / place / undo / status ----
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const META_KEYS = ['id', 'x', 'y', 'z'];

function captureFile(raw, dir) {
  let name = raw.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[ .]+$/, '').slice(0, 64).replace(/[ .]+$/, '');
  if (!name) name = `capture-${stamp()}`;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) name = '_' + name;
  let file = path.join(dir, name + '.png');
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${name}-${n}.png`);
  return file;
}

/** COMMANDS.md §2「黑名单和液体」：名单里的、液体 → 空气（方块实体也不要）；含水的 → waterlogged=false。 */
export function captureFilter(b, blacklist) {
  if (isAir(b.state)) return b;
  if (blacklist.includes(b.id) || LIQUIDS.has(b.id)) return makeBlock('minecraft:air', {});
  if (b.props?.waterlogged === 'true') return { ...b, ...makeBlock(b.id, { ...b.props, waterlogged: 'false' }) };
  return b;
}

/**
 * 模组配置 config/xiaojingyu-common.toml 里的抓取范围（COMMANDS.md §2；真游戏是 NeoForge 读、文件变了自己重读，
 * mock 每次现读）：没有文件、没有这个键就是默认值，超出范围的按 NeoForge 的规矩截到最近的界上。
 */
export const RANGE_KEYS = [['captureFront', 16, 1], ['captureBack', 0, 0], ['captureSide', 8, 0], ['captureUp', 12, 1]];
export function configRange(dir) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(dir, 'config', 'xiaojingyu-common.toml'), 'utf8');
  } catch {
    // 没有文件：默认值
  }
  return RANGE_KEYS.map(([key, def, min]) => {
    const m = text.match(new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(-?\\d+)[ \\t]*$`, 'm'));
    return m ? Math.min(64, Math.max(min, Number(m[1]))) : def;
  });
}

async function capture(args, api, xs) {
  // 不写数字：全用配置；<前> <左右> <高>：往后用配置；范围|range <前> <后> <左右> <高>：都用写的
  let [front, back, side, height] = configRange(api.dir);
  let rest = args;
  const ints = (n) => args.length >= n && args.slice(0, n).every((a) => /^-?\d+$/.test(a));
  if (args[0] === '范围' || args[0] === 'range') {
    if (!(args.length >= 5 && args.slice(1, 5).every((a) => /^-?\d+$/.test(a)))) return api.cmdFail(api.INCOMPLETE, `xjy capture ${args.join(' ')}<--[HERE]`);
    [front, back, side, height] = args.slice(1, 5).map(Number);
    rest = args.slice(5);
  } else if (ints(3)) {
    [front, side, height] = args.slice(0, 3).map(Number);
    rest = args.slice(3);
  }
  if (front < 1 || front > 64 || back < 0 || back > 64 || side < 0 || side > 64 || height < 1 || height > 64) return api.cmdFail('Integer out of range');
  const S = standing(api);
  const F = facingOf(api.player.yaw);
  const f = VEC[F];
  const r = VEC[RIGHT[F]];
  const corners = [];
  for (const fi of [1 - back, front]) for (const si of [-side, side]) for (const u of [-1, height - 2]) corners.push([0, 1, 2].map((k) => S[k] + fi * f[k] + si * r[k] + (k === 1 ? u : 0)));
  const lo = [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k])));
  if (lo[1] < -64 || hi[1] > 319) return api.cmdFail('盒子超出了世界高度');
  if (!api.loaded(lo[0], lo[2]) || !api.loaded(hi[0], hi[2])) return api.cmdFail('区块没加载');
  const size = [0, 1, 2].map((k) => hi[k] - lo[k] + 1);
  const name = rest.join(' ').trim();
  return writeCapture(api, xs, { size, offset: lo.map((v, k) => v - S[k]), base: lo, k: 0, name: name || `capture-${stamp()}`, xjy: { Facing: { string: F }, Origin: { intArray: S } } });
}

/**
 * 读一个模型写成鲸图：格子 (x, y, z) 是世界里 base + 转 k(x, y, z) 那一格，方块状态转回 −k（k = 0 就是普通 capture），
 * 再按 §2 的黑名单和液体规则换。xjy：Metadata.Xiaojingyu 里除了 FormatVersion、Dimension、Source、GameVersion 以外的键。
 */
async function writeCapture(api, xs, { size, offset, base, k, name, xjy }) {
  const palette = [];
  const index = new Map();
  const runs = [];
  const bes = [];
  let nonAir = 0;
  for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
    const r = rotatePos([x, y, z], k);
    let b = api.getBlock([0, 1, 2].map((j) => base[j] + r[j]));
    if (k) b = { ...b, ...makeBlock(b.id, rotateProps(b.props ?? {}, -k)) };
    b = captureFilter(b, xs.blacklist);
    if (!index.has(b.state)) { index.set(b.state, palette.length); palette.push(b.state); }
    const p = index.get(b.state);
    const last = runs[runs.length - 1];
    if (last && last[1] === p) last[0]++; else runs.push([1, p]);
    if (!isAir(b.state)) nonAir++;
    if (b.be) {
      const c = parseCompound(b.be).compound;
      const data = {};
      for (const key of Object.keys(c)) if (!META_KEYS.includes(key)) define(data, key, c[key]);
      bes.push({ pos: [x, y, z], id: c.id.string, data: { compound: data } });
    }
  }
  const x = { FormatVersion: { int: 1 } };
  for (const key of Object.keys(xjy)) define(x, key, xjy[key]);
  Object.assign(x, { Dimension: { string: 'minecraft:overworld' }, Source: { string: 'xiaojingyu-mod/mock' }, GameVersion: { string: '26.1.2' } });
  const meta = { compound: { Name: { string: name }, Author: { string: 'Dev' }, Date: { long: String(Date.now()) }, Xiaojingyu: { compound: x } } };
  const S3 = await share();
  const model = S3.fromDump({ dump: 1, size, offset, dataVersion: S3.DATA_VERSION, meta, palette, cells: runs, blockEntities: bes, warnings: [] });
  const dir = path.join(api.dir, 'xiaojingyu');
  fs.mkdirSync(dir, { recursive: true });
  const file = captureFile(name, dir);
  fs.writeFileSync(file, await S3.writePng(model));
  return { success: true, result: nonAir, output: [`Captured ${size.join('x')} (${nonAir} blocks) to ${file}`] };
}

/**
 * /xjy capture 上次|last [名字]（COMMANDS.md §2b）：按这个世界里最近一次放完的 place 的盒子抓，不管玩家站在哪；
 * 格子和方块状态都转回原文件的摆法，大小、Offset、Facing 和原文件一样；Origin = 那次的站立点；多写 FromPlace。
 */
async function captureLast(rest, api, xs) {
  if (xs.left()) return api.cmdFail('上一次还没放完');
  const rec = xs.latest(api.world);
  if (!rec) return api.cmdFail('你在这个世界里还没有用 /xjy place 放过鲸图，没有「上次」可以抓');
  const base = [0, 1, 2].map((j) => rec.standing[j] + rotatePos(rec.offset, rec.k)[j]);
  const far = [0, 1, 2].map((j) => base[j] + rotatePos(rec.size.map((n) => n - 1), rec.k)[j]);
  if (!api.loaded(base[0], base[2]) || !api.loaded(far[0], far[2])) return api.cmdFail(`上次放 ${rec.file} 的地方离你太远，那里有区块没加载`);
  const stem = rec.file.replace(/\.(png|schem)$/i, '').replace(/-\d{8}-\d{6}(-\d+)?$/, '');
  const name = rest.join(' ').trim() || (stem ? `${stem}-${stamp()}` : stamp());
  const xjy = {};
  if (rec.facing) define(xjy, 'Facing', { string: rec.facing });
  define(xjy, 'Origin', { intArray: rec.standing });
  define(xjy, 'FromPlace', { compound: { File: { string: rec.file }, Turn: { int: rec.k * 90 } } });
  return writeCapture(api, xs, { size: rec.size, offset: rec.offset, base, k: rec.k, name, xjy });
}

async function place(text, api, xs) {
  if (xs.left()) return api.cmdFail('上一次放置还没放完');
  const m = /^xjy\s+place\s+(?:"([^"]*)"|([A-Za-z0-9_.+-]+))(?:\s+(auto|0|90|180|270))?$/.exec(text);
  if (!m) return api.cmdFail(api.INCOMPLETE, `${text}<--[HERE]`);
  const name = m[1] ?? m[2];
  // 文件名规则（COMMANDS.md §3，06:15 补充）：整个是 . 或 ..、含 / \ : 或控制字符 → 拒绝；中间带 .. 可以；同名的是文件夹 → 算找不到
  if (!name || name === '.' || name === '..' || /[\\/:\x00-\x1f]/.test(name)) return api.cmdFail('文件名不能带路径');
  const dir = path.join(api.dir, 'xiaojingyu');
  const file = (/\.(png|schem)$/i.test(name) ? [name] : [name + '.png', name + '.schem']).map((n) => path.join(dir, n)).find((f) => fs.statSync(f, { throwIfNoEntry: false })?.isFile());
  if (!file) return api.cmdFail(`找不到文件 ${name}`);
  const S3 = await share();
  let d;
  try { d = S3.dump(await S3.read(fs.readFileSync(file))); } catch (e) { return api.cmdFail(`读不出来：${e.code ?? ''} ${e.message}`); }
  const fileFacing = d.meta?.compound?.Xiaojingyu?.compound?.Facing?.string;
  const F = facingOf(api.player.yaw);
  const turn = m[3] ?? 'auto';
  const k = turn !== 'auto' ? Number(turn) / 90 : DIRS.includes(fileFacing) ? (DIRS.indexOf(F) - DIRS.indexOf(fileFacing) + 4) % 4 : 0;
  const S = standing(api);
  const [W, , L] = d.size;
  const states = [];
  for (const [n, p] of d.cells) for (let i = 0; i < n; i++) states.push(d.palette[p]);
  const beAt = new Map(d.blockEntities.map((b) => [b.pos.join(','), b]));
  const targets = [];
  for (let i = 0; i < states.length; i++) {
    const x = i % W;
    const z = Math.floor(i / W) % L;
    const y = Math.floor(i / (W * L));
    const rel = rotatePos([d.offset[0] + x, d.offset[1] + y, d.offset[2] + z], k);
    const pos = rel.map((v, j) => S[j] + v);
    if (pos[1] < -64 || pos[1] > 319) return api.cmdFail('超出了世界高度');
    if (!api.loaded(pos[0], pos[2])) return api.cmdFail('区块没加载');
    const b = parseBlockArg(states[i]);
    if (b.error || b.nbt) return api.cmdFail(`不认识的方块状态 ${states[i]}`);
    targets.push({ pos, id: b.id, props: rotateProps(b.props, k), be: beAt.get(`${x},${y},${z}`) });
  }
  const prev = targets.map((t) => ({ pos: t.pos, block: api.getBlock(t.pos) }));
  for (const t of targets) {
    const blk = makeBlock(t.id, t.props);
    if (t.be) blk.be = beSnbt(t.be.id, merge(beOf(t.id)?.data ?? {}, t.be.data?.compound ?? {}), t.pos);
    else Object.assign(blk, blockAt(t.id, t.props, t.pos, null));
    api.setBlock(t.pos, blk);
  }
  // 放完（status 回 0）时才记成「上次」（COMMANDS.md §2b）；撤销时按 id 删掉
  prev.place = { world: api.world, file: path.basename(file), standing: S, k, offset: d.offset, size: d.size, facing: DIRS.includes(fileFacing) ? fileFacing : null };
  xs.push(prev);
  xs.start(targets.length, prev.place);
  return { success: true, result: targets.length, output: [`Placing ${targets.length} blocks from ${path.basename(file)} (rotation ${k * 90})`] };
}

function undo(api, xs) {
  if (xs.left()) return api.cmdFail('还在放置，不能撤销');
  const prev = xs.pop();
  if (!prev) return api.cmdFail('没有可以撤销的放置');
  for (const { pos, block } of prev) api.setBlock(pos, block);
  xs.forget(prev.place);
  xs.start(prev.length);
  return { success: true, result: prev.length, output: [`Undoing ${prev.length} blocks`] };
}

/** 方块 id 照 BlacklistFile.normalize：去空格、小写、补 minecraft:、去掉 [状态]；不像 id 就是 null。 */
export function normalizeId(raw) {
  const s = raw.trim().toLowerCase().replace(/[[{].*$/, '').trim();
  const m = /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)$/.exec(s);
  return m ? `${m[1] ?? 'minecraft'}:${m[2]}` : null;
}

/** 准星对着的方块（不看液体，最远 5 格；眼睛高 1.62）：照 Entity.pick 的方向算，一小步一小步往前找。 */
function looking(api) {
  const p = api.player;
  const yaw = (p.yaw * Math.PI) / 180;
  const pitch = (p.pitch * Math.PI) / 180;
  const d = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const eye = [p.x, p.y + 1.62, p.z];
  for (let t = 0; t <= 5; t += 0.01) {
    const b = api.getBlock(eye.map((v, k) => Math.floor(v + d[k] * t)));
    if (!isAir(b.state) && !LIQUIDS.has(b.id)) return b.id;
  }
  return null;
}

/** /xjy blacklist …（COMMANDS.md §2a）。result：add/remove/list = 名单里现在几种，clear = 删掉几种，不带子命令 = 几种。 */
function blacklistCmd(w, text, api, as, xs) {
  const list = xs.blacklist;
  const sub = w[2];
  if (sub === undefined) {
    if (as !== 'server') api.setScreen('BlacklistScreen');
    return { success: true, result: list.length, output: [`${list.length} blocks on the capture blacklist`] };
  }
  if ((sub === 'list' || sub === 'clear') && w.length === 3) {
    if (sub === 'list') return { success: true, result: list.length, output: [`${list.length} blocks: ${list.join(', ')}`] };
    const n = list.length;
    list.length = 0;
    return { success: true, result: n, output: [n ? `Cleared ${n} blocks` : 'Already empty'] };
  }
  if ((sub !== 'add' && sub !== 'remove') || w.length > 4) return api.cmdFail(api.INCOMPLETE, `${text}<--[HERE]`);
  let id;
  if (w.length === 4) {
    if (!/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(w[3])) return api.cmdFail('Invalid ID');
    id = normalizeId(w[3]);
  } else {
    if (as === 'server') return api.cmdFail('A player is required to run this command here');
    id = looking(api);
    if (!id) return api.cmdFail('准星没有对着方块');
  }
  if (sub === 'remove') {
    const i = list.indexOf(id);
    if (i < 0) return api.cmdFail(`名单里没有 ${id}`);
    list.splice(i, 1);
    return { success: true, result: list.length, output: [`Removed ${id}`] };
  }
  if (!KNOWN.has(id)) return api.cmdFail(`这个游戏里没有叫 ${id} 的方块`);
  if (ALWAYS_AIR.has(id)) return api.cmdFail(`${id} 本来就当空气导出`);
  if (!list.includes(id)) list.push(id);
  return { success: true, result: list.length, output: [`Added ${id}`] };
}

/** 给 startMockProbe 的 commands。pendingMs：place / undo 之后 /xjy status 有多久不是 0（模拟分几个 tick 放）。 */
export function xjyCommands({ pendingMs = 400 } = {}) {
  const stack = [];
  let until = 0;
  let count = 0;
  let pending = null; // 正在放的 place：放完才进 places
  const places = new Map(); // 世界 → 最近放完的 place，新的在前，最多 5 个（真游戏存在存档里，换世界就是另一份）
  const settle = () => {
    if (pending && Date.now() >= until) {
      const list = places.get(pending.world) ?? [];
      list.unshift(pending);
      places.set(pending.world, list.slice(0, 5));
      pending = null;
    }
  };
  const xs = {
    blacklist: [],
    left: () => { settle(); return Date.now() < until ? count : 0; },
    start(n, place = null) { settle(); count = n; until = Date.now() + pendingMs; pending = place; },
    push(prev) { stack.push(prev); if (stack.length > 5) stack.shift(); },
    pop: () => stack.pop(),
    latest: (world) => { settle(); return places.get(world)?.[0] ?? null; },
    forget(place) {
      if (!place) return;
      const list = places.get(place.world);
      if (list) places.set(place.world, list.filter((p) => p !== place));
    },
  };
  return {
    setblock: setblockCmd,
    fill: fillCmd,
    execute: executeCmd,
    tick: (w, text, api) => (w.length === 2 && ['freeze', 'unfreeze'].includes(w[1])
      ? { success: true, result: 1, output: [`ok: ${text}`] } : api.cmdFail(api.INCOMPLETE, `${text}<--[HERE]`)),
    give: (w, text, api) => (w.length >= 3 ? { success: true, result: 1, output: [`ok: ${text}`] } : api.cmdFail(api.INCOMPLETE, `${text}<--[HERE]`)),
    recipe: (w, text, api) => (w.length === 4 && ['give', 'take'].includes(w[1]) ? { success: true, result: 1, output: [`ok: ${text}`] } : api.cmdFail(api.INCOMPLETE, `${text}<--[HERE]`)),
    async xjy(w, text, api, as) {
      if (w[1] === 'blacklist') return blacklistCmd(w, text, api, as, xs);
      if (as === 'server') return api.cmdFail('A player is required to run this command here');
      if (w[1] === 'capture' && (w[2] === '上次' || w[2] === 'last')) return captureLast(w.slice(3), api, xs);
      if (w[1] === 'capture') return capture(w.slice(2), api, xs);
      if (w[1] === 'place') return place(text, api, xs);
      if (w[1] === 'undo' && w.length === 2) return undo(api, xs);
      if (w[1] === 'status' && w.length === 2) {
        const left = xs.left();
        const last = xs.latest(api.world);
        const [f, b, s, u] = configRange(api.dir);
        return {
          success: true,
          result: left,
          output: [left ? `${left} blocks left` : 'Idle', last ? `Last placed: ${last.file}, turned ${last.k * 90}°` : 'No building placed in this world yet',
            `Plain /xjy capture takes ${f} in front, ${b} behind, ${s} to each side and ${u} up, the same as /xjy capture range ${f} ${b} ${s} ${u}.`],
        };
      }
      return api.cmdFail(api.INCOMPLETE, `${text}<--[HERE]`);
    },
  };
}
