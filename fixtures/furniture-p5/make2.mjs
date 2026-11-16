#!/usr/bin/env node
// fixtures/furniture-p5/make2.mjs — P5 第 2 轮：22 种家具 × 4 个朝向的测试鲸图，和用它的卡片 mod/cards/P5-002.yml
//
//   node fixtures/furniture-p5/make2.mjs           写 furniture-p5-2.json（dump）、furniture-p5-2.png（鲸图）、mod/cards/P5-002.yml
//   node fixtures/furniture-p5/make2.mjs --check   在内存里重新生成，和这 3 个文件逐字节比
//
// 状态和格子照 docs/FURNITURE.md 8.1：xiaojingyu:<id>[facing]（单格）或 [facing,part=0..N−1]；
// 朝北时本地格子 cx 0..w−1（东）、cz 0..d−1（往后 = 南）、cy 0..h−1（上），part = cx + w × (cz + d × cy)，
// 朝别的方向时跟着模型顺时针转：east (cx, cz) → (−cz, cx)；south → (−cx, −cz)；west → (cz, −cx)，都相对 part 0。
// 尺寸和 collide 用下面的 SIZES（8.2 的表）；有 web/src/44-furn-mc.js 的规格时逐件核对（对不上就报错）。
//
// 鲸图的摆法（模型坐标，+x 东、+z 南，2 层高）：每种一排（表里的顺序），每排 4 个朝向 north / east / south / west，
// 第 c 个朝向占 x 5c .. 5c+3；这一排深 max(w, d) 格，排和排之间空 1 格。每件转过去以后贴着自己那块的西北角放。
// Facing north；站立点在盒子南边一格的正中，所以 Offset (−9, 0, −L)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { share, formatJSON } from '../../web/tools/share.mjs';
import { loadV3 } from '../../web/tools/lib/v3-node.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DIR, '..', '..');
const CARD = path.join(REPO, 'mod', 'cards', 'P5-002.yml');

// id, w, d, h, collide（box / thin / none），和 FURNITURE.md 8.2 的表一样
const SIZES = [
  ['nightstand', 1, 1, 1, 'box'], ['bookshelf', 1, 1, 2, 'box'], ['kitchen_counter', 4, 1, 1, 'box'],
  ['spice_rack', 1, 1, 1, 'none'], ['mini_fridge', 1, 1, 1, 'box'], ['dining_chair', 1, 1, 1, 'box'],
  ['desk', 2, 1, 1, 'box'], ['desk_chair', 1, 1, 1, 'box'], ['picture_frames', 2, 1, 1, 'none'],
  ['rocking_chair', 1, 1, 1, 'box'], ['tv_stand', 2, 1, 1, 'box'], ['sofa', 2, 1, 1, 'box'],
  ['living_rug', 2, 2, 1, 'thin'], ['floor_plant', 1, 1, 1, 'box'], ['door_mat', 1, 1, 1, 'thin'],
  ['photo_album_table', 1, 1, 1, 'box'], ['floor_cushions', 2, 1, 1, 'box'], ['window_seat', 2, 1, 1, 'box'],
  ['telescope', 1, 1, 1, 'box'], ['storage_chests', 2, 1, 1, 'box'], ['beanbag', 1, 1, 1, 'box'],
  ['string_lights', 1, 1, 1, 'none'],
].map(([id, w, d, h, collide]) => ({ id, w, d, h, collide, n: w * d * h }));

const FACINGS = ['north', 'east', 'south', 'west'];
const COL = 5;                                   // 每个朝向占的宽（最长的厨房台面 4 格 + 空 1 格）
const W = 4 * COL - 1, H = 2;

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
    // 每格的碰撞（一个字符串 = 每格都一样；数组 = 每个 part 一个）
    const c = f.collide || 'box';
    s.cellCollide = Array.from({ length: s.n }, (_, p) => (Array.isArray(c) ? c[p] : c));
    if (!s.cellCollide.includes(s.collide)) throw new Error(`${s.id}：44-furn-mc 的 collide 是 ${JSON.stringify(c)}，这里是 ${s.collide}`);
  }
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
  const pieces = [];   // {s, f, cells:[{p, x, y, z}], main:[x,y,z]}
  let z0 = 0;
  for (const s of SIZES) {
    const depth = Math.max(s.w, s.d);
    FACINGS.forEach((f, c) => {
      const cs = cells(s, f).map((k) => ({ p: k.p, x: COL * c + k.dx, y: k.dy, z: z0 + k.dz }));
      pieces.push({ s, f, cells: cs, row: z0, depth });
    });
    z0 += depth + 1;
  }
  return { pieces, L: z0 - 1 };
}

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
  const runs = [];
  for (const k of grid) {
    if (runs.length && runs[runs.length - 1][1] === k) runs[runs.length - 1][0]++;
    else runs.push([1, k]);
  }
  // 带方块实体的家具（docs/PHOTOS.md 第 2 节，和 web/src/42-house-mc.js 的 H.furnBlockEntity 一样）：相册矮桌、相框、
  // 画框墙 part=0 那格，MC 里放下就有方块实体，这里也写一条空的（Data 是空 compound），按格子编号排
  const beId = (s) => {
    const m = /^xiaojingyu:(photo_album_table|photo_frame|picture_frames)(?:\[(.*)\])?$/.exec(s);
    return !m || (m[1] === 'picture_frames' && !/(^|,)part=0(,|$)/.test(m[2] || '')) ? null : 'xiaojingyu:' + m[1];
  };
  const beIds = palette.map(beId), blockEntities = [];
  grid.forEach((k, i) => {
    if (beIds[k]) blockEntities.push({ pos: [i % W, Math.floor(i / (W * L)), Math.floor(i / W) % L], id: beIds[k], data: { compound: {} } });
  });
  return {
    d: {
      dump: 1, size: [W, H, L], offset: [-9, 0, -(L + 1)], dataVersion: 4790,
      meta: { compound: {
        Name: { string: 'P5 家具测试 第 2 轮（22 种 × 4 个朝向）' },
        Author: { string: 'xiaojingyu-mod' },
        Xiaojingyu: { compound: {
          FormatVersion: { int: 1 },
          Facing: { string: 'north' },
          Origin: { intArray: [9, 0, L + 1] },
          Source: { string: 'fixtures/furniture-p5/make2.mjs' },
        } },
      } },
      palette, cells: runs, blockEntities, warnings: [],
    },
    pieces, L,
  };
}

// ---- 卡片 ----
const A = [1, -60, 5];                       // setblock 放的那份：格子 (0,0,0) 的世界坐标
const B_STAND = [40, -60, 0];                // /xjy place 的站立点（朝北，auto 不转）；格子 (0,0,0) = 站立点 + Offset
const R_STAND = [100, -60, 0];               // 转 90° 再盖一份的站立点
const SHOT_Z = 70;                           // 截图用的那排（每种朝南一件，隔 4 格），在 A 的南边，不和 B、R 重

const fmt = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(Math.round(v * 100) / 100));

function card(d, pieces, L) {
  const off = d.offset;
  const B = [B_STAND[0] + off[0], B_STAND[1], B_STAND[2] + off[2]];
  // 转 90°（顺时针）：(x, z) → (−z, x)
  const rot = (x, z) => [-z, x];
  const rc = [[off[0], off[2]], [off[0] + W - 1, off[2]], [off[0], off[2] + L - 1], [off[0] + W - 1, off[2] + L - 1]].map(([x, z]) => rot(x, z));
  const R0 = [R_STAND[0] + Math.min(...rc.map((c) => c[0])), R_STAND[2] + Math.min(...rc.map((c) => c[1]))];
  const R1 = [R_STAND[0] + Math.max(...rc.map((c) => c[0])), R_STAND[2] + Math.max(...rc.map((c) => c[1]))];
  const cellsTotal = W * H * L;
  const out = [];
  const say = (s) => out.push(s);
  say('# P5-002：第 2 轮的 22 种家具方块（docs/FURNITURE.md 8.1、8.2）在开发 MC 里核对。');
  say('# 这个文件是 fixtures/furniture-p5/make2.mjs 生成的，不要手改：改了生成器重新跑（--check 会查）。');
  say('# 状态：xiaojingyu:<id>[facing]（单格）或 [facing,part=0..N−1]；part = cx + w×(cz + d×cy)，主格 part 0；');
  say('# 朝向转法 east (cx,cz)→(−cz,cx)、south →(−cx,−cz)、west →(cz,−cx)，相对主格。');
  say(`# 测试鲸图 fixtures/furniture-p5/furniture-p5-2.png：${W}×${H}×${L}，Offset (${off.join(',')})，Facing north，每种一排、每排 4 个朝向。`);
  say(`#  A：setblock … strict 一格一格照鲸图放，格子 (0,0,0) = (${A.join(',')})，盒子 x ${A[0]}..${A[0] + W - 1}、z ${A[2]}..${A[2] + L - 1}；`);
  say('#     然后 expect_file（和 dump 一模一样）、expect_shapes（游戏不会改）。');
  say(`#  B：站 (${B_STAND.join(',')}) 朝北 xjy place（auto 不转），格子 (0,0,0) = (${B.join(',')})；expect_file、expect_shapes。`);
  say(`#  R：站 (${R_STAND.join(',')}) 朝北 xjy place … 90（顺时针 90°：(x,z)→(−z,x)），盒子 x ${R0[0]}..${R1[0]}、z ${R0[1]}..${R1[1]}；expect_shapes。`);
  say('#  站高（创造模式，人会往下掉）：tp 到格子上方半格，等 2 秒，data get entity @s Pos[1] 16 的 result：');
  say('#     thin 站在 1/16 格高的地方 = (−60 + 1/16)×16 = −959；none 掉穿过去站在草地上 = −960。');
  say('#  拆：B 里每种挑朝东那件，setblock 它最后一格（单格就是它自己）… air destroy（像玩家挖），整件都变空气，');
  say('#     附近正好 1 个掉落物，就是这种家具。每次之前清掉掉落物。');
  say(`#  截图：每种朝南放一件在 z=${SHOT_Z} 那排（隔 4 格），旁观模式、不带界面，从东南边看（正面和东面）。`);
  say('title: 第 2 轮 22 种家具：setblock / xjy place 各 4 个朝向、/shapes、站高、拆、截图');
  say('steps:');
  say('  - open: P5-002');
  say('  - wait: {inWorld: true, screen: null, timeout: 180}');
  for (const c of ['gamerule send_command_feedback false', 'gamerule random_tick_speed 0', 'gamerule advance_time false',
    'gamerule advance_weather false', 'gamerule spawn_mobs false', 'time set noon', 'weather clear']) say(`  - cmd: ${c}`);
  say('  - cmd: {command: "kill @e[type=!minecraft:player]", success: any}');
  say(`  - cmd: tp @s ${A[0] + 9}.5 -60 ${A[2] - 3}.5 0 0`);
  say('');
  say('  # ---- A：setblock 照鲸图放（两格以上的每格都放，strict）----');
  for (const pc of pieces) {
    say(`  # ${pc.s.id} ${pc.f}`);
    for (const c of pc.cells) say(`  - cmd: setblock ${A[0] + c.x} ${A[1] + c.y} ${A[2] + c.z} ${state(pc.s, pc.f, c.p)} strict`);
  }
  say(`  - expect_file: {file: fixtures/furniture-p5/furniture-p5-2.json, at: [${A.join(', ')}], size: [${W}, ${H}, ${L}], offset: [${off.join(', ')}]}`);
  say(`  - expect_shapes: {file: fixtures/furniture-p5/furniture-p5-2.json, at: [${A.join(', ')}]}`);
  say('');
  say('  # ---- B：/xjy place 原样盖；R：转 90° 再盖一份 ----');
  say("  - copy_file: {from: fixtures/furniture-p5/furniture-p5-2.png, to: 'P5-002-${run}.png'}");
  say(`  - cmd: tp @s ${B_STAND[0]}.5 ${B_STAND[1]} ${B_STAND[2]}.5 180 0`);
  say(`  - cmd: {command: 'xjy place P5-002-\${run}', result: ${cellsTotal}}`);
  say('  - cmd: {command: xjy status, until: 0}');
  say(`  - expect_file: {file: fixtures/furniture-p5/furniture-p5-2.json, at: [${B.join(', ')}], size: [${W}, ${H}, ${L}], offset: [${off.join(', ')}]}`);
  say(`  - expect_shapes: {file: fixtures/furniture-p5/furniture-p5-2.json, at: [${B.join(', ')}]}`);
  say(`  - cmd: tp @s ${R_STAND[0]}.5 ${R_STAND[1]} ${R_STAND[2]}.5 180 0`);
  say(`  - cmd: {command: 'xjy place P5-002-\${run} 90', result: ${cellsTotal}}`);
  say('  - cmd: {command: xjy status, until: 0}');
  say(`  - expect_shapes: {from: [${R0[0]}, -60, ${R0[1]}], to: [${R1[0]}, -59, ${R1[1]}]}`);
  say('');
  say('  # ---- 站高：thin 站得上去，none 穿得过去（A 里朝北的那件；创造模式）----');
  for (const pc of pieces) {
    if (pc.f !== 'north' || pc.s.collide === 'box') continue;
    // 第一个是 thin / none 的格（地毯的 part 1 是茶几，box）；没有 44-furn-mc 的每格数据时按整件的 collide
    const kindOf = (p) => (pc.s.cellCollide ? pc.s.cellCollide[p] : pc.s.collide);
    const c = pc.cells.find((k) => kindOf(k.p) === pc.s.collide);
    const want = pc.s.collide === 'thin' ? -959 : -960;
    say(`  # ${pc.s.id}（${pc.s.collide}）part ${c.p}`);
    say(`  - cmd: tp @s ${A[0] + c.x}.5 -59.5 ${A[2] + c.z}.5 0 0`);
    say('  - sleep: 2');
    say(`  - cmd: {command: 'data get entity @s Pos[1] 16', result: ${want}}`);
  }
  say('');
  say('  # ---- 拆：B 里每种朝东那件，拆最后一格（像玩家挖），整件没了，正好掉 1 个 ----');
  const box = `x=${B[0] - 3},y=-62,z=${B[2] - 3},dx=${W + 5},dy=6,dz=${L + 5}`;
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
  say(`  # ---- 截图：每种朝南一件，放在 z=${SHOT_Z} 那排，从东南边看 ----`);
  let x = 0;
  const shots = [];
  for (const s of SIZES) {
    const cs = cells(s, 'south');
    for (const c of cs) say(`  - cmd: setblock ${x + c.dx} ${-60 + c.dy} ${SHOT_Z + c.dz} ${state(s, 'south', c.p)} strict`);
    const wx = Math.max(...cs.map((c) => c.dx)) + 1, wz = Math.max(...cs.map((c) => c.dz)) + 1;
    shots.push({ s, cx: x + wx / 2, cz: SHOT_Z + wz / 2, size: Math.max(wx, wz, s.h) });
    x += wx + 4;
  }
  say(`  - expect_shapes: {from: [-1, -60, ${SHOT_Z - 1}], to: [${x - 3}, -59, ${SHOT_Z + 2}]}`);
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
    say(`  - shot: {name: P5-002-${sh.s.id}, meanBrightness: [0.05, 0.95], distinctColors: 100, hideGui: true}`);
  }
  say('  # A 的全景：盒子南边高处往北看');
  say(`  - cmd: tp @s ${A[0] + 9}.5 -48.0 ${A[2] + L + 6}.5 180 45`);
  say('  - sleep: 1');
  say('  - wait: {chunksRendered: true, stableFor: 2, timeout: 60}');
  say('  - sleep: 2');
  say('  - shot: {name: P5-002-all, meanBrightness: [0.05, 0.95], distinctColors: 100, hideGui: true}');
  say('');
  say('  - leave');
  say('  - wait: {inWorld: false, screen: TitleScreen, timeout: 60}');
  return out.join('\n') + '\n';
}

async function build() {
  const S = share();
  const { d, pieces, L } = dump();
  const png = Buffer.from(await S.writePng(S.fromDump(d)));
  const json = Buffer.from(formatJSON(S.dump(await S.read(png))), 'utf8');
  return new Map([
    [path.join(DIR, 'furniture-p5-2.png'), png],
    [path.join(DIR, 'furniture-p5-2.json'), json],
    [CARD, Buffer.from(card(d, pieces, L), 'utf8')],
  ]);
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
