#!/usr/bin/env node
// fixtures/furniture-p5/make3.mjs — P5 第 3 轮：屋外 15 种家具 × 4 个朝向的测试鲸图、风铃的小鲸图，和用它们的卡片 mod/cards/P5-003.yml
//
//   node fixtures/furniture-p5/make3.mjs           写 furniture-p5-3.json / .png（15 种 × 4 个朝向）、furniture-p5-3-chime.json / .png（风铃挂在 3 格高的地方）、mod/cards/P5-003.yml
//   node fixtures/furniture-p5/make3.mjs --check   在内存里重新生成，和这 5 个文件逐字节比
//
// 状态和格子照 docs/FURNITURE.md 8.1（和 make2.mjs 一样）：xiaojingyu:<id>[facing]（单格）或 [facing,part=0..N−1]；
// 朝北时本地格子 cx 0..w−1（东）、cz 0..d−1（往后 = 南）、cy 0..h−1（上），part = cx + w × (cz + d × cy)，
// 朝别的方向时跟着模型顺时针转：east (cx, cz) → (−cz, cx)；south → (−cx, −cz)；west → (cz, −cx)，都相对 part 0。
// 尺寸和 collide 用下面的 SIZES（9.1 的表；遮阳伞 1×1×3，lead 定的）；有 web/src/44-furn-mc.js 的规格时逐件核对（对不上就报错）。
//
// 鲸图的摆法（模型坐标，+x 东、+z 南，3 层高）：每种一排（表里的顺序），每排 4 个朝向 north / east / south / west，
// 第 c 个朝向占 x 4c .. 4c+2；这一排深 max(w, d) 格，排和排之间空 1 格。每件转过去以后贴着自己那块的西北角放。
// Facing north；站立点在盒子南边一格的正中，所以 Offset (−7, 0, −L−1)。
//
// 风铃（9.3）：furniture-p5-3-chime 是 1 × 4 × 1 的一列，最上面一格是风铃（朝南），下面 3 格空气；Offset (0, 0, −2)（站立点往北 2 格）。
// 卡片用 /xjy place 盖它（/xjy place 不调 onPlace，正好查「盖出来的风铃也会响」），再把猪、玩家 tp 进风铃下面那一列，
// 读开发版才有的计数 /data get storage xiaojingyu:dev wind_chime.rings / hits（mod/src/main/java/com/xiaojingyu/furniture/WindChimes.java）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { share, formatJSON } from '../../web/tools/share.mjs';
import { loadV3 } from '../../web/tools/lib/v3-node.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DIR, '..', '..');
const CARD = path.join(REPO, 'mod', 'cards', 'P5-003.yml');

// id, w, d, h, 每格的 collide（一个字符串 = 每格都一样），和 FURNITURE.md 9.1 的表一样（遮阳伞只有伞杆挡人：3 格都是 box）
const SIZES = [
  ['beach_lounger', 1, 2, 1, 'box'], ['beach_lounger_hat', 1, 2, 1, 'box'], ['beach_table', 1, 1, 1, 'box'],
  ['beach_parasol', 1, 1, 3, 'box'], ['crate_lantern', 1, 1, 1, 'box'],
  ['flower_box_purple', 2, 1, 1, 'box'], ['flower_box_pink', 2, 1, 1, 'box'],
  ['towel_hook', 1, 1, 1, 'none'], ['wind_chime', 1, 1, 1, 'none'], ['wall_lantern', 1, 1, 1, 'none'],
  ['potted_fern', 1, 1, 1, 'box'], ['hanging_basket', 1, 1, 1, 'none'], ['flower_pot', 1, 1, 1, 'box'],
  ['succulents', 1, 1, 1, 'box'], ['step_mat', 2, 1, 1, 'thin'],
].map(([id, w, d, h, collide]) => {
  const n = w * d * h;
  return { id, w, d, h, n, cellCollide: Array.from({ length: n }, (_, p) => (Array.isArray(collide) ? collide[p] : collide)) };
});
// 模型会伸出自己那格的（9.1：遮阳伞的伞面、吊篮的吊臂）：截图时多留点地方
const REACH = ['beach_parasol', 'hanging_basket'];

const FACINGS = ['north', 'east', 'south', 'west'];
const COL = 4;                                   // 每个朝向占的宽（最宽 2 格 + 空 2 格，伸出去的伞面不碰旁边的）
const W = 4 * COL - 1, H = 3;
const OFF_X = -7;

// ---- 和网页的规格核对（有就核对；44-furn-mc 还没加的件跳过）----
function crossCheck() {
  let furn = null;
  try { furn = loadV3(['44-furn-mc']).V3.furnMc; } catch { return 'no 44-furn-mc'; }
  const notes = [];
  for (const s of SIZES) {
    const f = furn.byId(s.id);
    if (!f) { notes.push(s.id + '（规格里还没有）'); continue; }
    const size = f.size;   // [宽 x, 高 y, 深 z]
    if (size && (size[0] !== s.w || size[1] !== s.h || size[2] !== s.d)) throw new Error(`${s.id}：44-furn-mc 是 ${size.join('×')}（宽×高×深），这里是 ${s.w}×${s.h}×${s.d}`);
    for (let p = 0; p < s.n; p++) {
      const c = furn.collideOf(f, p);
      if (c !== s.cellCollide[p]) throw new Error(`${s.id} part ${p}：44-furn-mc 的 collide 是 ${c}，这里是 ${s.cellCollide[p]}`);
    }
    if (!!f.reach !== REACH.includes(s.id)) throw new Error(`${s.id}：44-furn-mc 的 reach 是 ${!!f.reach}，这里是 ${REACH.includes(s.id)}`);
  }
  const extra = furn.list.filter((f) => f.round === 3 && !SIZES.some((s) => s.id === f.id)).map((f) => f.id);
  if (extra.length) throw new Error('44-furn-mc 第 3 轮多了：' + extra.join('、'));
  return notes.length ? '44-furn-mc 里还没有：' + notes.join('、') : 'ok';
}

// ---- 格子 ----
const local = (s, p) => [p % s.w, Math.floor(p / (s.w * s.d)), Math.floor(p / s.w) % s.d];   // [cx, cy, cz]
function turn(f, cx, cz) {
  switch (f) {
    case 'east': return [-cz, cx];
    case 'south': return [-cx, -cz];
    case 'west': return [cz, -cx];
    default: return [cx, cz];
  }
}
const state = (s, f, p) => `xiaojingyu:${s.id}[facing=${f}${s.n > 1 ? ',part=' + p : ''}]`;
// 一件朝 f 时每格相对 part 0 的位置，挪到 (0, 0) 起
function cells(s, f) {
  const raw = [];
  for (let p = 0; p < s.n; p++) {
    const [cx, cy, cz] = local(s, p);
    const [dx, dz] = turn(f, cx, cz);
    raw.push({ p, dx, dy: cy, dz });
  }
  const mx = Math.min(...raw.map((c) => c.dx)), mz = Math.min(...raw.map((c) => c.dz));
  return raw.map((c) => ({ ...c, dx: c.dx - mx, dz: c.dz - mz }));
}

function layout() {
  const pieces = [];   // {s, f, cells:[{p, x, y, z}]}
  let z0 = 0;
  for (const s of SIZES) {
    const depth = Math.max(s.w, s.d);
    FACINGS.forEach((f, c) => {
      const cs = cells(s, f).map((k) => ({ p: k.p, x: COL * c + k.dx, y: k.dy, z: z0 + k.dz }));
      pieces.push({ s, f, cells: cs });
    });
    z0 += depth + 1;
  }
  return { pieces, L: z0 - 1 };
}

const runsOf = (grid) => {
  const runs = [];
  for (const k of grid) {
    if (runs.length && runs[runs.length - 1][1] === k) runs[runs.length - 1][0]++;
    else runs.push([1, k]);
  }
  return runs;
};
const meta = (name, origin) => ({ compound: {
  Name: { string: name },
  Author: { string: 'xiaojingyu-mod' },
  Xiaojingyu: { compound: {
    FormatVersion: { int: 1 },
    Facing: { string: 'north' },
    Origin: { intArray: origin },
    Source: { string: 'fixtures/furniture-p5/make3.mjs' },
  } },
} });

function dump() {
  const { pieces, L } = layout();
  const palette = ['minecraft:air'];
  const grid = new Array(W * H * L).fill(0);
  for (const pc of pieces) {
    for (const c of pc.cells) {
      if (c.x < 0 || c.x >= W || c.y >= H || c.z < 0 || c.z >= L) throw new Error(`${pc.s.id} ${pc.f} 出界`);
      const i = c.x + c.z * W + c.y * W * L;
      if (grid[i] !== 0) throw new Error(`${pc.s.id} ${pc.f} 和别的件重了`);
      const st = state(pc.s, pc.f, c.p);
      let k = palette.indexOf(st);
      if (k < 0) k = palette.push(st) - 1;
      grid[i] = k;
    }
  }
  return {
    d: {
      dump: 1, size: [W, H, L], offset: [OFF_X, 0, -(L + 1)], dataVersion: 4790,
      meta: meta('P5 家具测试 第 3 轮（屋外 15 种 × 4 个朝向）', [-OFF_X, 0, L + 1]),
      palette, cells: runsOf(grid), blockEntities: [], warnings: [],
    },
    pieces, L,
  };
}

// 风铃挂在 3 格高的地方：1 × 4 × 1，下面 3 格空气
const CHIME_STATE = 'xiaojingyu:wind_chime[facing=south]';
function chimeDump() {
  return {
    dump: 1, size: [1, 4, 1], offset: [0, 0, -2], dataVersion: 4790,
    meta: meta('P5 家具测试 第 3 轮：风铃（9.3）', [0, 0, 2]),
    palette: ['minecraft:air', CHIME_STATE], cells: [[3, 0], [1, 1]], blockEntities: [], warnings: [],
  };
}

// ---- 卡片 ----
const A = [1, -60, 5];                       // setblock 放的那份：格子 (0,0,0) 的世界坐标
const B_STAND = [40, -60, 0];                // /xjy place 的站立点（朝北，auto 不转）；格子 (0,0,0) = 站立点 + Offset
const R_STAND = [100, -60, 0];               // 转 90° 再盖一份的站立点
const C_STAND = [150, -60, 4];               // 风铃的站立点（朝北）：风铃在 (150, −57, 2)，下面那一列是 y −60..−58
const SHOT_Z = 70;                           // 截图用的那排（每种朝南一件），在 A 的南边，不和 B、R 重

const fmt = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(Math.round(v * 100) / 100));

function card(d, pieces, L) {
  const off = d.offset;
  const B = [B_STAND[0] + off[0], B_STAND[1], B_STAND[2] + off[2]];
  // 转 90°（顺时针）：(x, z) → (−z, x)
  const rot = (x, z) => [-z, x];
  const rc = [[off[0], off[2]], [off[0] + W - 1, off[2]], [off[0], off[2] + L - 1], [off[0] + W - 1, off[2] + L - 1]].map(([x, z]) => rot(x, z));
  const R0 = [R_STAND[0] + Math.min(...rc.map((c) => c[0])), R_STAND[2] + Math.min(...rc.map((c) => c[1]))];
  const R1 = [R_STAND[0] + Math.max(...rc.map((c) => c[0])), R_STAND[2] + Math.max(...rc.map((c) => c[1]))];
  const CH = [C_STAND[0], C_STAND[1] + 3, C_STAND[2] - 2];          // 风铃
  const PIG_OUT = [CH[0] + 3, C_STAND[1], CH[2]];                   // 猪在旁边等着（不在风铃下面）
  const cellsTotal = W * H * L;
  const out = [];
  const say = (s) => out.push(s);
  const get = (k, result) => say(`  - cmd: {command: 'data get storage xiaojingyu:dev wind_chime.${k}', result: ${result}}`);
  say('# P5-003：第 3 轮的屋外 15 种家具方块（docs/FURNITURE.md 8.1、9.1、9.3）在开发 MC 里核对。');
  say('# 这个文件是 fixtures/furniture-p5/make3.mjs 生成的，不要手改：改了生成器重新跑（--check 会查）。');
  say('# 状态：xiaojingyu:<id>[facing]（单格）或 [facing,part=0..N−1]；part = cx + w×(cz + d×cy)，主格 part 0；');
  say('# 朝向转法 east (cx,cz)→(−cz,cx)、south →(−cx,−cz)、west →(cz,−cx)，相对主格。');
  say(`# 测试鲸图 fixtures/furniture-p5/furniture-p5-3.png：${W}×${H}×${L}，Offset (${off.join(',')})，Facing north，每种一排、每排 4 个朝向。`);
  say(`#  A：setblock … strict 一格一格照鲸图放，格子 (0,0,0) = (${A.join(',')})，盒子 x ${A[0]}..${A[0] + W - 1}、z ${A[2]}..${A[2] + L - 1}；`);
  say('#     然后 expect_file（和 dump 一模一样）、expect_shapes（游戏不会改）。');
  say(`#  B：站 (${B_STAND.join(',')}) 朝北 xjy place（auto 不转），格子 (0,0,0) = (${B.join(',')})；expect_file、expect_shapes。`);
  say(`#  R：站 (${R_STAND.join(',')}) 朝北 xjy place … 90（顺时针 90°：(x,z)→(−z,x)），盒子 x ${R0[0]}..${R1[0]}、z ${R0[1]}..${R1[1]}；expect_shapes。`);
  say('#  站高（创造模式，人会往下掉）：tp 到格子上方半格，等 2 秒，data get entity @s Pos[1] 16 的 result：');
  say('#     thin 站在 1/16 格高的地方 = (−60 + 1/16)×16 = −959；none 掉穿过去站在草地上 = −960。');
  say('#     遮阳伞伸出去的伞面没有碰撞：tp 到伞顶那格东边一格、伞面的高度，也掉到草地上（−960）。');
  say('#  拆：B 里每种挑朝东那件，setblock 它最后一格（单格就是它自己）… air destroy（像玩家挖），整件都变空气，');
  say('#     附近正好 1 个掉落物，就是这种家具。每次之前清掉掉落物。');
  say(`#  风铃（9.3）：站 (${C_STAND.join(',')}) 朝北 xjy place 风铃的小鲸图，风铃在 (${CH.join(',')})，下面 3 格 y ${CH[1] - 3}..${CH[1] - 1} 是「风铃下面」。`);
  say('#     开发版里每响一串 wind_chime.rings 加 1、每响一下 wind_chime.hits 加 1（command storage xiaojingyu:dev）。');
  say('#     猪（NoAI）tp 进来响 1 串（2–3 下）；站着不动不再响；两只猪一起进来只响 1 串；创造模式的玩家进来也响；旁观模式不响。');
  say(`#  截图：每种朝南放一件在 z=${SHOT_Z} 那排，旁观模式、不带界面，从东南边看（正面和东面）；再拍一张 A 的全景。`);
  say('title: 第 3 轮屋外 15 种家具：setblock / xjy place 各 4 个朝向、/shapes、站高、伸出格子、拆、风铃会响、截图');
  say('steps:');
  say('  - open: P5-003');
  say('  - wait: {inWorld: true, screen: null, timeout: 180}');
  for (const c of ['gamerule send_command_feedback false', 'gamerule random_tick_speed 0', 'gamerule advance_time false',
    'gamerule advance_weather false', 'gamerule spawn_mobs false', 'time set noon', 'weather clear']) say(`  - cmd: ${c}`);
  say('  - cmd: {command: "kill @e[type=!minecraft:player]", success: any}');
  say(`  - cmd: tp @s ${A[0] + 7}.5 -60 ${A[2] - 3}.5 0 0`);
  say('');
  say('  # ---- A：setblock 照鲸图放（两格以上的每格都放，strict）----');
  for (const pc of pieces) {
    say(`  # ${pc.s.id} ${pc.f}`);
    for (const c of pc.cells) say(`  - cmd: setblock ${A[0] + c.x} ${A[1] + c.y} ${A[2] + c.z} ${state(pc.s, pc.f, c.p)} strict`);
  }
  say(`  - expect_file: {file: fixtures/furniture-p5/furniture-p5-3.json, at: [${A.join(', ')}], size: [${W}, ${H}, ${L}], offset: [${off.join(', ')}]}`);
  say(`  - expect_shapes: {file: fixtures/furniture-p5/furniture-p5-3.json, at: [${A.join(', ')}]}`);
  say('');
  say('  # ---- B：/xjy place 原样盖；R：转 90° 再盖一份 ----');
  say("  - copy_file: {from: fixtures/furniture-p5/furniture-p5-3.png, to: 'P5-003-${run}.png'}");
  say(`  - cmd: tp @s ${B_STAND[0]}.5 ${B_STAND[1]} ${B_STAND[2]}.5 180 0`);
  say(`  - cmd: {command: 'xjy place P5-003-\${run}', result: ${cellsTotal}}`);
  say('  - cmd: {command: xjy status, until: 0}');
  say(`  - expect_file: {file: fixtures/furniture-p5/furniture-p5-3.json, at: [${B.join(', ')}], size: [${W}, ${H}, ${L}], offset: [${off.join(', ')}]}`);
  say(`  - expect_shapes: {file: fixtures/furniture-p5/furniture-p5-3.json, at: [${B.join(', ')}]}`);
  say(`  - cmd: tp @s ${R_STAND[0]}.5 ${R_STAND[1]} ${R_STAND[2]}.5 180 0`);
  say(`  - cmd: {command: 'xjy place P5-003-\${run} 90', result: ${cellsTotal}}`);
  say('  - cmd: {command: xjy status, until: 0}');
  say(`  - expect_shapes: {from: [${R0[0]}, -60, ${R0[1]}], to: [${R1[0]}, ${-60 + H - 1}, ${R1[1]}]}`);
  say('');
  say('  # ---- 站高：thin 站得上去，none 穿得过去（A 里朝北的那件；创造模式）----');
  for (const pc of pieces) {
    if (pc.f !== 'north') continue;
    const c = pc.cells.find((k) => pc.s.cellCollide[k.p] !== 'box');
    if (!c) continue;
    const kind = pc.s.cellCollide[c.p];
    const want = kind === 'thin' ? -959 : -960;
    say(`  # ${pc.s.id}（${kind}）part ${c.p}`);
    say(`  - cmd: tp @s ${A[0] + c.x}.5 ${A[1] + c.y + 0.5} ${A[2] + c.z}.5 0 0`);
    say('  - sleep: 2');
    say(`  - cmd: {command: 'data get entity @s Pos[1] 16', result: ${want}}`);
  }
  {
    const pc = pieces.find((k) => k.s.id === 'beach_parasol' && k.f === 'north');
    const top = pc.cells.find((k) => k.p === pc.s.n - 1);
    say('  # 遮阳伞的伞面伸出格子，没有碰撞：伞顶那格东边一格、伞面的高度');
    say(`  - cmd: tp @s ${A[0] + top.x + 1}.5 ${A[1] + top.y + 0.5} ${A[2] + top.z}.5 0 0`);
    say('  - sleep: 2');
    say("  - cmd: {command: 'data get entity @s Pos[1] 16', result: -960}");
  }
  say('');
  say('  # ---- 拆：B 里每种朝东那件，拆最后一格（像玩家挖），整件没了，正好掉 1 个 ----');
  const box = `x=${B[0] - 3},y=-62,z=${B[2] - 3},dx=${W + 5},dy=${H + 5},dz=${L + 5}`;
  say(`  - cmd: tp @s ${B_STAND[0]}.5 -60 ${B_STAND[2] + 20}.5 180 0`);
  say('  - cmd: {command: "kill @e[type=minecraft:item]", success: any}');
  for (const pc of pieces) {
    if (pc.f !== 'east') continue;
    const last = pc.cells.reduce((a, b) => (b.p > a.p ? b : a));
    say(`  # ${pc.s.id}：拆 part ${last.p}`);
    say(`  - cmd: setblock ${B[0] + last.x} ${B[1] + last.y} ${B[2] + last.z} minecraft:air destroy`);
    for (const c of pc.cells) say(`  - expect_block: {pos: [${B[0] + c.x}, ${B[1] + c.y}, ${B[2] + c.z}], state: 'minecraft:air'}`);
    say(`  - cmd: {command: 'execute if entity @e[type=minecraft:item,${box},nbt={Item:{id:"xiaojingyu:${pc.s.id}",count:1}}]', result: 1}`);
    say(`  - cmd: {command: 'execute if entity @e[type=minecraft:item,${box}]', result: 1}`);
    say('  - cmd: {command: "kill @e[type=minecraft:item]", success: any}');
  }
  say('');
  say('  # ---- 风铃会响（9.3）：/xjy place 盖出来的风铃，猪和玩家走进下面那一列 ----');
  say("  - copy_file: {from: fixtures/furniture-p5/furniture-p5-3-chime.png, to: 'P5-003-chime-${run}.png'}");
  say(`  - cmd: tp @s ${C_STAND[0]}.5 ${C_STAND[1]} ${C_STAND[2]}.5 180 0`);
  say("  - cmd: {command: 'xjy place P5-003-chime-${run}', result: 4}");
  say('  - cmd: {command: xjy status, until: 0}');
  say(`  - expect_block: {pos: [${CH.join(', ')}], state: '${CHIME_STATE}'}`);
  say(`  - expect_block: {pos: [${CH[0]}, ${CH[1] - 1}, ${CH[2]}], state: 'minecraft:air'}`);
  say("  - cmd: 'data merge storage xiaojingyu:dev {wind_chime:{rings:0,hits:0}}'");
  say('  - cmd: {command: "scoreboard objectives add xjy_p5 dummy", success: any}');
  say(`  - cmd: 'summon minecraft:pig ${PIG_OUT[0]}.5 ${PIG_OUT[1]} ${PIG_OUT[2]}.5 {NoAI:1b,Tags:["xjy_pig","xjy_a"]}'`);
  say(`  - cmd: 'summon minecraft:pig ${PIG_OUT[0]}.5 ${PIG_OUT[1]} ${PIG_OUT[2] - 2}.5 {NoAI:1b,Tags:["xjy_pig","xjy_b"]}'`);
  say('  - sleep: 1');
  say('  # 还没有东西进来：不响');
  get('rings', 0);
  say('  # 一只猪进来：响 1 串，2–3 下');
  say(`  - cmd: tp @e[tag=xjy_a] ${CH[0]}.5 ${C_STAND[1]} ${CH[2]}.5`);
  say("  - cmd: {command: 'data get storage xiaojingyu:dev wind_chime.rings', until: {result: 1, timeout: 5, interval: 0.1}}");
  say('  - sleep: 1.5');
  say("  - cmd: 'execute store result score hits xjy_p5 run data get storage xiaojingyu:dev wind_chime.hits'");
  say("  - cmd: {command: 'execute if score hits xjy_p5 matches 2..3', result: 1}");
  say(`  - cmd: {command: 'data get storage xiaojingyu:dev wind_chime.last[1]', result: ${CH[1]}}`);
  say('  # 站着不动：不再响');
  say('  - sleep: 2');
  get('rings', 1);
  say('  # 出去，再和另一只猪一起进来：只响 1 串（同一个风铃 1 秒内不重复响）');
  say(`  - cmd: tp @e[tag=xjy_a] ${PIG_OUT[0]}.5 ${PIG_OUT[1]} ${PIG_OUT[2]}.5`);
  say('  - sleep: 0.5');
  get('rings', 1);
  say(`  - cmd: tp @e[tag=xjy_pig] ${CH[0]}.5 ${C_STAND[1]} ${CH[2]}.5`);
  say("  - cmd: {command: 'data get storage xiaojingyu:dev wind_chime.rings', until: {result: 2, timeout: 5, interval: 0.1}}");
  say('  - sleep: 1.5');
  get('rings', 2);
  say('  # 猪都出去；创造模式的玩家进来：响');
  say(`  - cmd: tp @e[tag=xjy_pig] ${PIG_OUT[0]}.5 ${PIG_OUT[1]} ${PIG_OUT[2]}.5`);
  say('  - sleep: 1.5');
  say(`  - cmd: tp @s ${CH[0]}.5 ${C_STAND[1]} ${CH[2]}.5 180 0`);
  say("  - cmd: {command: 'data get storage xiaojingyu:dev wind_chime.rings', until: {result: 3, timeout: 5, interval: 0.1}}");
  say('  # 旁观模式进来：不响');
  say(`  - cmd: tp @s ${C_STAND[0]}.5 ${C_STAND[1]} ${C_STAND[2]}.5 180 0`);
  say('  - cmd: gamemode spectator');
  say('  - sleep: 1.5');
  say(`  - cmd: tp @s ${CH[0]}.5 ${C_STAND[1]} ${CH[2]}.5 180 0`);
  say('  - sleep: 1.5');
  get('rings', 3);
  say('  - cmd: gamemode creative');
  say(`  - cmd: tp @s ${C_STAND[0]}.5 ${C_STAND[1]} ${C_STAND[2]}.5 180 0`);
  say('  - cmd: {command: "kill @e[tag=xjy_pig]", success: any}');
  say('');
  say(`  # ---- 截图：每种朝南一件，放在 z=${SHOT_Z} 那排，从东南边看 ----`);
  let x = 0;
  const shots = [];
  for (const s of SIZES) {
    const cs = cells(s, 'south');
    const reach = REACH.includes(s.id) ? 2 : 0;
    x += reach;
    for (const c of cs) say(`  - cmd: setblock ${x + c.dx} ${-60 + c.dy} ${SHOT_Z + c.dz} ${state(s, 'south', c.p)} strict`);
    const wx = Math.max(...cs.map((c) => c.dx)) + 1, wz = Math.max(...cs.map((c) => c.dz)) + 1;
    shots.push({ s, cx: x + wx / 2, cz: SHOT_Z + wz / 2, size: Math.max(wx, wz, s.h) + reach });
    x += wx + 4 + reach;
  }
  say(`  - expect_shapes: {from: [-1, -60, ${SHOT_Z - 1}], to: [${x - 3}, ${-60 + H - 1}, ${SHOT_Z + 2}]}`);
  say('  - cmd: gamemode spectator');
  for (const sh of shots) {
    const dist = 1.6 + 0.9 * sh.size;                // 水平方向往东、往南各退这么多
    const eye = -60 + 0.9 + 0.55 * sh.size;          // 眼睛高度
    const feet = eye - 1.62;
    const pitch = Math.round((Math.atan2(eye - (-60 + sh.s.h * 0.45), dist * Math.SQRT2) * 180) / Math.PI);
    say(`  # ${sh.s.id}`);
    say(`  - cmd: tp @s ${fmt(sh.cx + dist)} ${fmt(feet)} ${fmt(sh.cz + dist)} 135 ${pitch}`);
    say('  - sleep: 1');
    say('  - wait: {chunksRendered: true, stableFor: 2, timeout: 60}');
    say('  - sleep: 2');
    say(`  - shot: {name: P5-003-${sh.s.id}, meanBrightness: [0.05, 0.95], distinctColors: 100, hideGui: true}`);
  }
  say('  # A 的全景：盒子南边高处往北看');
  say(`  - cmd: tp @s ${A[0] + 7}.5 -48.0 ${A[2] + L + 6}.5 180 45`);
  say('  - sleep: 1');
  say('  - wait: {chunksRendered: true, stableFor: 2, timeout: 60}');
  say('  - sleep: 2');
  say('  - shot: {name: P5-003-all, meanBrightness: [0.05, 0.95], distinctColors: 100, hideGui: true}');
  say('');
  say('  - leave');
  say('  - wait: {inWorld: false, screen: TitleScreen, timeout: 60}');
  return out.join('\n') + '\n';
}

async function build() {
  const S = share();
  const { d, pieces, L } = dump();
  const files = new Map();
  for (const [name, dd] of [['furniture-p5-3', d], ['furniture-p5-3-chime', chimeDump()]]) {
    const png = Buffer.from(await S.writePng(S.fromDump(dd)));
    const json = Buffer.from(formatJSON(S.dump(await S.read(png))), 'utf8');
    files.set(path.join(DIR, name + '.png'), png);
    files.set(path.join(DIR, name + '.json'), json);
  }
  files.set(CARD, Buffer.from(card(d, pieces, L), 'utf8'));
  return files;
}

console.log('核对 44-furn-mc：' + crossCheck());
const files = await build();
const rel = (p) => path.relative(REPO, p).replace(/\\/g, '/');
if (process.argv.includes('--check')) {
  let bad = 0;
  for (const [p, buf] of files) {
    const same = fs.existsSync(p) && fs.readFileSync(p).equals(buf);
    console.log(`${same ? 'same' : 'DIFF'}  ${rel(p)}`);
    if (!same) bad++;
  }
  process.exitCode = bad ? 1 : 0;
} else {
  for (const [p, buf] of files) {
    if (fs.existsSync(p) && fs.readFileSync(p).equals(buf)) { console.log(`没变  ${rel(p)}`); continue; }
    fs.writeFileSync(p, buf);
    console.log(`写了  ${rel(p)}（${buf.length} 字节）`);
  }
}
