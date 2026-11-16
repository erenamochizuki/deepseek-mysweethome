#!/usr/bin/env node
// photo-card.mjs：生成卡片 mod/cards/P5-004.yml（相册和相框，docs/PHOTOS.md，mod7 2026-11-08）。
//
//   node mod/tools/photo-card.mjs           写 mod/cards/P5-004.yml
//   node mod/tools/photo-card.mjs --check   在内存里重新生成，和现在的卡片逐字比（不一样退出码 1）
//
// 卡片里的照片是这里造的 128 × 128 PNG（纯色块，压出来几百字节），直接写进 /setblock 的 NBT。每张照片：
// 底色 + 左上白块、右上黄块、左下黑块（看截图就知道贴得正不正、有没有左右反）+ 中间 1–4 根白竖条（第几张）。
// 画框墙每个框的点击位置按 FurnitureShapes.java 里的 photoSlots 算（和模组的 PhotoSlots 一样的转法），
// 所以那边的数变了，重新跑一遍这个脚本就行。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(TOOLS, '..');
export const CARD_FILE = path.join(MOD, 'cards', 'P5-004.yml');
const SHAPES_JAVA = path.join(MOD, 'src', 'main', 'java', 'com', 'xiaojingyu', 'furniture', 'FurnitureShapes.java');

// ---- PNG ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** RGB 的 PNG（颜色类型 2，每行过滤 0）。rgb(x, y) → 0xRRGGBB。 */
export function makePng(w, h, rgb) {
  const raw = Buffer.alloc(h * (1 + 3 * w));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rgb(x, y);
      const at = y * (1 + 3 * w) + 1 + 3 * x;
      raw[at] = (c >> 16) & 255;
      raw[at + 1] = (c >> 8) & 255;
      raw[at + 2] = c & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 一张测试照片：底色 + 三个角的标记 + bars 根白竖条。 */
export function photoPng(background, bars) {
  const M = 48;
  return makePng(128, 128, (x, y) => {
    if (y < M && x < M) return 0xFFFFFF;          // 左上：白
    if (y < M && x >= 128 - M) return 0xF2C94C;   // 右上：黄
    if (y >= 128 - M && x < M) return 0x111111;   // 左下：黑
    const left = 64 - (bars * 12 - 4) / 2;          // 中间的白竖条：每根 8 宽，间隔 4
    if (y >= 52 && y < 100 && x >= left && x < left + bars * 12 - 4 && (x - left) % 12 < 8) return 0xFFFFFF;
    return background;
  });
}

/** PHOTOS.md §1 的检查（和模组的 Photos.problem 一样）：null = 好的。 */
export function photoProblem(png) {
  if (!png) return 'missing';
  if (png.length > 48 * 1024) return 'too_large';
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (png.length < 24 || sig.some((b, i) => png[i] !== b) || png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR') return 'not_png';
  return png.readUInt32BE(16) === 128 && png.readUInt32BE(20) === 128 ? null : 'wrong_size';
}

export const photoId = (png) => crypto.createHash('sha1').update(png).digest('hex').slice(0, 16);

/** 卡片用的 4 张照片：A、B、C 在相册里（顺序就是这样），D 不在相册里。 */
export function photos() {
  const make = (key, name, background, bars) => {
    const png = photoPng(background, bars);
    return { key, name, png, id: photoId(png) };
  };
  return {
    A: make('A', '海边日落', 0xD9534F, 1),
    B: make('B', '小船', 0x5CB85C, 2),
    C: make('C', '灯塔', 0x337AB7, 3),
    D: make('D', '不在相册里', 0x8E44AD, 4),
  };
}

/** 照片的 SNBT compound：{Id, Png, Name, Added}。 */
export function photoSnbt(p, added = 1762560000000) {
  const bytes = [...p.png].map((b) => `${(b << 24) >> 24}b`).join(',');
  return `{Id:"${p.id}",Png:[B;${bytes}],Name:"${p.name}",Added:${added}L}`;
}
const BAD_SNBT = '{Id:"0000000000000bad",Png:[B;1b,2b,3b],Name:"坏的"}';

// ---- 画框墙的格子和点击位置（docs/PHOTOS.md §3，和模组 PhotoSlots 一样）----

/** FurnitureShapes.java 里一种家具的 photoSlots 行。 */
export function readSlots(name, javaText = fs.readFileSync(SHAPES_JAVA, 'utf8')) {
  const m = new RegExp(`${name}_PHOTO_SLOTS = \\{(.*?)\\};`).exec(javaText);
  if (!m) throw new Error(`FurnitureShapes.java 里没有 ${name}_PHOTO_SLOTS`);
  return [...m[1].matchAll(/\{([^{}]*)\}/g)].map((r) => r[1].split(',').map(Number));
}

const FACINGS = ['north', 'east', 'south', 'west'];
/** 朝北模型的像素（相对主格的最小角）→ 世界方块（相对主格的最小角）：顺时针转 q 个 90°，(X, Z) → (16 − Z, X)。 */
export function toWorld(q, px, py, pz) {
  for (let t = 0; t < q; t++) [px, pz] = [16 - pz, px];
  return [px / 16, py / 16, pz / 16];
}
/** 画框墙（2 × 1 × 1）：part 1 在朝北时的东边一格。第 i 个框正中、画框正面（z 14.5 像素）上的点。 */
export function slotHit(rows, i, q, main) {
  const r = rows[i];
  const cx = r[0];                               // 画框墙只有 part 0 / 1，都在 cy = cz = 0
  const w = toWorld(q, cx * 16 + (r[1] + r[3]) / 2, (r[2] + r[4]) / 2, 14.5);
  return w.map((v, k) => Math.round((main[k] + v) * 1e4) / 1e4);
}
/** 画框墙 part 1 相对 part 0 的格子（FURNITURE.md 8.1）。 */
const PART1 = { north: [1, 0, 0], east: [0, 0, 1], south: [-1, 0, 0], west: [0, 0, -1] };

/** 相册翻页（docs/PHOTOS.md §4，和模组 AlbumPaging 一样）：返回下标或 -1（空）。 */
export function step(ids, current, back) {
  const n = ids.length;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0) return back ? n - 1 : 0;
  if (back) return at === 0 ? -1 : at - 1;
  return at === n - 1 ? -1 : at + 1;
}

// ---- 卡片 ----

export function cardText() {
  const P = photos();
  const album = [P.A, P.B, P.C];
  const ids = album.map((p) => p.id);
  const rows = readSlots('PICTURE_FRAMES');
  const L = [];
  const add = (s) => L.push(s);
  const q = (s) => `'${s.replaceAll("'", "''")}'`;
  const cmd = (c, extra = '') => add(`  - cmd: ${extra ? `{command: ${q(c)}, ${extra}}` : q(c)}`);
  const use = (pos, face, o = {}) => {
    const parts = [`pos: [${pos.join(', ')}]`, `face: ${face}`];
    if (o.hit) parts.push(`hit: [${o.hit.join(', ')}]`);
    if (o.sneak) parts.push('sneak: true');
    if (o.consumed !== undefined) parts.push(`consumed: ${o.consumed}`);
    if (o.bar) parts.push(`actionBarContains: ${q(o.bar)}`);
    add(`  - use: {${parts.join(', ')}}`);
  };
  const barFor = (n) => (n < 0 ? null : `Photo ${n + 1} of ${album.length}: ${album[n].name}`);
  const expectPhoto = (pos, pathExpr, p) => {
    if (p) cmd(`data get block ${pos.join(' ')} ${pathExpr}.Id`, `outputContains: ${q(p.id)}`);
    else cmd(`data get block ${pos.join(' ')} ${pathExpr}.Id`, 'success: false');
  };
  // 模拟一个格子里的照片：点 n 下（back = 潜行），每下检查动作栏，最后检查方块实体
  const click = (state, key, pos, face, o, emptyText) => {
    const cur = state[key] ?? null;
    const n = step(ids, cur, !!o.sneak);
    state[key] = n < 0 ? null : ids[n];
    use(pos, face, { ...o, consumed: true, bar: n < 0 ? emptyText : barFor(n) });
  };

  add(`# P5-004：相册和相框（docs/PHOTOS.md 第 4 节，mod7 2026-11-08）。这张卡片是 node mod/tools/photo-card.mjs 生成的，别手改。`);
  add('# 相册矮桌（xiaojingyu:photo_album_table）带 3 张照片（中间夹一张坏的，翻页时跳过）；新相框和画框墙各 4 个朝向，挂在一个');
  add('# 白色方块（x 10..14，y -60..-57，z 10..14）的四面上；相册矮桌放在方块顶上 (12,-56,12)，离每个框都不到 16 格。');
  add('# 照片：底色 + 左上白块、右上黄块、左下黑块 + 中间几根白竖条（A 红 1 根、B 绿 2 根、C 蓝 3 根；D 紫 4 根不在相册里）。');
  add('# 1. 用探针 /use 模拟右键（不发真实键鼠）：下一张、潜行上一张、最后一张后面是空、找不到换第一张 / 潜行换最后一张；');
  add('#    画框墙按点到的位置找是哪个框（4 个朝向，6 个框都点）；手里拿方块时右键是放方块，不换照片；潜行又拿着东西时不换；');
  add('#    拿着新相框的物品点墙的侧面 → 贴在那面墙上（用物品放，(15,-58,11) 朝东），点地面 → 朝着人。');
  add('#    远处：16 格里没有相册矮桌（40,-59,10）、相册是空的（60,-59,10，旁边 (60,-60,12) 是空的相册矮桌）、坏照片 (42,-59,10)。');
  add('# 2. 旁观模式拍 4 面（看照片贴的位置、朝向：从正面看白块在左上、黄块在右上、黑块在左下）。');
  add('# 3. 区块包的照片预算（开发游戏才有的 xiaojingyu:dev photo_chunk_budget）调成 2000 字节，走远再回来，区块重发时');
  add('#    超出预算的方块实体单独发（photo_late_sent 有数），再拍 2 张照片还在。');
  add('# 4. 站 (12,-60,3) 朝南 xjy capture range 12 0 3 6 → 清成空气 → 原地 xjy place → 马上拍照（客户端马上看得到）→');
  add('#    capture 上次 和第一次抓的逐格一样（方块实体的数据也比：照片、坏照片原样）。');
  add('title: 相册和相框：右键换照片（4 个朝向）、画出来、区块包预算、capture / place 带着照片');
  add('steps:');
  add('  - open: P5-004');
  add('  - wait: {inWorld: true, screen: null, timeout: 180}');
  for (const c of ['gamerule send_command_feedback false', 'gamerule random_tick_speed 0', 'gamerule advance_time false',
    'gamerule advance_weather false', 'gamerule spawn_mobs false', 'time set noon', 'weather clear']) add(`  - cmd: ${c}`);
  add('  - cmd: {command: "kill @e[type=!minecraft:player]", success: any}');
  add('  - cmd: gamemode creative');
  add('  - cmd: tp @s 12.5 -60 3.5 0 0');
  add('');
  add('  # 搭场景：白方块、相册矮桌（A、坏的、B、C）');
  cmd('fill 10 -60 10 14 -57 14 minecraft:white_concrete');
  cmd(`setblock 12 -56 12 xiaojingyu:photo_album_table[facing=south]{Album:[${photoSnbt(P.A)},${BAD_SNBT},${photoSnbt(P.B)},${photoSnbt(P.C)}]}`);
  use([12, -56, 12], 'up', { consumed: true, bar: 'The album has 3 photos' });

  // 新相框：四面各一个；西面的先放一张不在相册里的 D（潜行右键 → 最后一张）；东面的也放 D（右键 → 第一张）
  const frames = {
    north: { pos: [10, -59, 9], pre: null },
    east: { pos: [15, -59, 10], pre: P.D },
    south: { pos: [14, -59, 15], pre: null },
    west: { pos: [9, -59, 14], pre: P.D },
  };
  // 画框墙：part 0 的位置；南面的先放好 Slots（0 = A、4 = B）
  const walls = {
    north: [12, -59, 9],
    east: [15, -59, 12],
    south: [13, -59, 15],
    west: [9, -59, 13],
  };
  add('');
  add('  # 新相框（4 个朝向）和画框墙（4 个朝向，两格都 strict）');
  for (const f of FACINGS) {
    const fr = frames[f];
    cmd(`setblock ${fr.pos.join(' ')} xiaojingyu:photo_frame[facing=${f}]${fr.pre ? `{Photo:${photoSnbt(fr.pre)}}` : ''}`);
    const m = walls[f];
    const p1 = m.map((v, k) => v + PART1[f][k]);
    const pre = f === 'south' ? `{Slots:[${photoSnbt(P.A)},{},{},{},${photoSnbt(P.B)},{}]}` : '';
    cmd(`setblock ${m.join(' ')} xiaojingyu:picture_frames[facing=${f},part=0]${pre} strict`);
    cmd(`setblock ${p1.join(' ')} xiaojingyu:picture_frames[facing=${f},part=1] strict`);
    cmd(`execute if block ${p1.join(' ')} xiaojingyu:picture_frames[facing=${f},part=1]`, 'result: 1');
  }
  cmd('data get block 9 -59 14 Photo.Id', `outputContains: ${q(P.D.id)}`);
  cmd('data get block 13 -59 15 Slots[4].Id', `outputContains: ${q(P.B.id)}`);
  cmd('data get block 13 -59 15 Slots[1].Id', 'success: false');

  add('');
  add('  # 新相框：下一张、潜行上一张、末尾是空、空的潜行 → 最后一张');
  const fs0 = {};
  const fpos = frames.north.pos;
  for (const o of [{}, {}, { sneak: true }, { sneak: true }, { sneak: true }, {}, {}]) {
    click(fs0, 'n', fpos, 'north', o, 'The frame is empty now');
  }
  expectPhoto(fpos, 'Photo', P.A);
  add('  # 东面的是 D（不在相册里）：右键 → 第一张，再一下 → 第二张');
  const fe = { e: P.D.id };
  click(fe, 'e', frames.east.pos, 'east', {}, '');
  click(fe, 'e', frames.east.pos, 'east', {}, '');
  expectPhoto(frames.east.pos, 'Photo', P.B);
  add('  # 南面的：三下 → 第三张');
  const fsth = {};
  for (let k = 0; k < 3; k++) click(fsth, 's', frames.south.pos, 'south', {}, '');
  expectPhoto(frames.south.pos, 'Photo', P.C);
  add('  # 西面的是 D：潜行右键 → 最后一张，再潜行 → 第二张');
  const fw = { w: P.D.id };
  click(fw, 'w', frames.west.pos, 'west', { sneak: true }, '');
  click(fw, 'w', frames.west.pos, 'west', { sneak: true }, '');
  expectPhoto(frames.west.pos, 'Photo', P.B);

  add('');
  add('  # 手里拿方块：右键是放方块（放在相框前面那格），照片不变；拿着木棍：照常换；潜行又拿着木棍：不换（原版规矩）');
  cmd('item replace entity @s weapon.mainhand with minecraft:stone');
  use(fpos, 'north', { consumed: true });
  cmd('execute if block 10 -59 8 minecraft:stone', 'result: 1');
  expectPhoto(fpos, 'Photo', P.A);
  cmd('setblock 10 -59 8 minecraft:air');
  cmd('item replace entity @s weapon.mainhand with minecraft:stick');
  use(fpos, 'north', { sneak: true, consumed: false });
  expectPhoto(fpos, 'Photo', P.A);
  click(fs0, 'n', fpos, 'north', {}, '');
  expectPhoto(fpos, 'Photo', P.B);
  add('  # 拿着新相框的物品放：点白方块的东侧面 → 贴在东面、朝东（像展示框）；点地面 → 朝着人（人朝南站，相框朝北）');
  cmd('item replace entity @s weapon.mainhand with xiaojingyu:photo_frame');
  use([14, -58, 11], 'east', { consumed: true });
  cmd('execute if block 15 -58 11 xiaojingyu:photo_frame[facing=east]', 'result: 1');
  use([20, -61, 12], 'up', { consumed: true });
  cmd('execute if block 20 -60 12 xiaojingyu:photo_frame[facing=north]', 'result: 1');
  cmd('setblock 20 -60 12 minecraft:air');
  cmd('item replace entity @s weapon.mainhand with minecraft:air');

  add('');
  add('  # 画框墙：按点到的位置找框。每个朝向 6 个框都点，第 i 个框换成第 (i mod 3) + 1 张（南面的 0、4 先有照片）');
  for (const f of FACINGS) {
    const qd = FACINGS.indexOf(f);
    const m = walls[f];
    const st = f === 'south' ? { 0: P.A.id, 4: P.B.id } : {};
    add(`  # ${f}`);
    for (let i = 0; i < rows.length; i++) {
      const target = ids[i % 3];
      for (let guard = 0; st[i] !== target && guard < 5; guard++) {
        click(st, i, m, f, { hit: slotHit(rows, i, qd, m) }, 'Back to the little painting');
      }
    }
    for (let i = 0; i < rows.length; i++) expectPhoto(m, `Slots[${i}]`, album[i % 3]);
  }
  add('  # 南面第 0 个框潜行两下：A → 空（原来的小画）→ C；再点一下 → 空；再点 → A');
  const ss = { 0: P.A.id };
  const sh = slotHit(rows, 0, 2, walls.south);
  click(ss, 0, walls.south, 'south', { hit: sh, sneak: true }, 'Back to the little painting');
  cmd('data get block 13 -59 15 Slots[0].Id', 'success: false');
  click(ss, 0, walls.south, 'south', { hit: sh, sneak: true }, 'Back to the little painting');
  click(ss, 0, walls.south, 'south', { hit: sh }, 'Back to the little painting');
  click(ss, 0, walls.south, 'south', { hit: sh }, 'Back to the little painting');
  expectPhoto(walls.south, 'Slots[0]', P.A);

  add('');
  add('  # 远处：16 格里没有相册矮桌；相册是空的；坏照片（不崩，数据原样留着）');
  cmd('setblock 40 -59 11 minecraft:stone');
  cmd('setblock 40 -59 10 xiaojingyu:photo_frame[facing=north]');
  use([40, -59, 10], 'north', { consumed: true, bar: 'No photo album table within 16 blocks' });
  cmd('data get block 40 -59 10 Photo', 'success: false');
  cmd('setblock 60 -59 11 minecraft:stone');
  cmd('setblock 60 -59 10 xiaojingyu:photo_frame[facing=north]');
  cmd('setblock 60 -60 12 xiaojingyu:photo_album_table[facing=south]');
  use([60, -59, 10], 'north', { consumed: true, bar: 'The album is empty' });
  use([60, -60, 12], 'up', { consumed: true, bar: 'The album is empty' });
  cmd('setblock 42 -59 11 minecraft:stone');
  cmd(`setblock 42 -59 10 xiaojingyu:photo_frame[facing=north]{Photo:${BAD_SNBT}}`);
  cmd('data get block 42 -59 10 Photo.Png', 'result: 3');
  use([42, -59, 10], 'north', { consumed: true, bar: 'No photo album table within 16 blocks' });
  cmd('data get block 42 -59 10 Photo.Png', 'result: 3');

  // 截图：眼睛和框一样高（框的格子 y -59..-58，中间 -58.5；眼睛比脚高 1.62）
  const feet = -60.12;
  const views = [
    ['north', [12.0, feet, 5.0], 0],
    ['east', [19.0, feet, 12.0], 90],
    ['south', [12.0, feet, 19.0], 180],
    ['west', [5.0, feet, 12.0], -90],
  ];
  const shot = (name, [x, y, z], yaw, sleep = 3) => {
    add(`  - cmd: tp @s ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} ${yaw} 0`);
    add('  - sleep: 1');
    add('  - wait: {chunksRendered: true, stableFor: 2, timeout: 60}');
    add(`  - sleep: ${sleep}`);
    add(`  - shot: {name: ${name}, meanBrightness: [0.05, 0.95], distinctColors: 50, hideGui: true}`);
  };
  add('');
  add('  # 拍 4 面（旁观模式，不画界面）');
  cmd('gamemode spectator');
  views.forEach(([f, at, yaw], k) => shot(`P5-004-${f}`, at, yaw, k === 0 ? 8 : 3));
  add('  # 远一点（20 格外）看照片会不会闪');
  shot('P5-004-far', [12.0, feet, -12.0], 0);

  add('');
  add('  # 区块包预算调成 2000 字节（开发游戏才认），走远（区块卸掉）再回来：区块重发时超出预算的单独发');
  cmd('data modify storage xiaojingyu:dev photo_chunk_budget set value 2000');
  cmd('data remove storage xiaojingyu:dev photo_late_sent', 'success: any');
  add('  - cmd: tp @s 3000.5 -50 3000.5 0 0');
  add('  - sleep: 2');
  add('  - wait: {chunksRendered: true, stableFor: 2, timeout: 60}');
  add('  - sleep: 3');
  shot('P5-004-late-north', views[0][1], views[0][2], 5);
  shot('P5-004-late-south', views[2][1], views[2][2]);
  cmd('execute if data storage xiaojingyu:dev photo_late_sent', 'result: 1');
  cmd('data remove storage xiaojingyu:dev photo_chunk_budget');

  add('');
  add('  # capture → 清成空气 → 原地 place → 马上拍 → capture 上次 和第一次的逐格一样（方块实体的数据也比）');
  cmd('gamemode creative');
  cmd('tp @s 12.5 -60 3.5 0 0');
  cmd("xjy capture range 12 0 3 6 P5-004-A-${run}");
  cmd('fill 9 -61 4 15 -56 15 minecraft:air');
  // 清的时候画框墙先没了一格的话，另一格会按规矩变空气并掉一个物品：清掉，免得拍进照片
  cmd('kill @e[type=minecraft:item]', 'success: any');
  cmd('data get block 10 -59 9 Photo', 'success: false');
  cmd('tp @s 12.5 -60 3.5 0 0');
  cmd("xjy place P5-004-A-${run}", 'result: 504');
  add('  - cmd: {command: xjy status, until: 0}');
  expectPhoto(fpos, 'Photo', P.B);
  expectPhoto(walls.north, 'Slots[2]', P.C);
  cmd('data get block 42 -59 10 Photo.Png', 'result: 3');
  cmd('gamemode spectator');
  shot('P5-004-placed-north', views[0][1], views[0][2]);
  shot('P5-004-placed-west', views[3][1], views[3][2]);
  cmd('gamemode creative');
  cmd("xjy capture 上次 P5-004-B-${run}");
  add("  - expect_files: {saved: 'P5-004-A-${run}', capture: 'P5-004-B-${run}'}");
  add('');
  add('  - leave');
  add('  - wait: {inWorld: false, screen: TitleScreen, timeout: 60}');
  return L.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = cardText();
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(CARD_FILE) ? fs.readFileSync(CARD_FILE, 'utf8') : '';
    if (now !== text) {
      console.error(`mod/cards/P5-004.yml 和生成的不一样：跑 node mod/tools/photo-card.mjs 重新生成`);
      process.exit(1);
    }
    console.log('P5-004.yml 是最新的');
  } else {
    fs.writeFileSync(CARD_FILE, text);
    const P = photos();
    console.log(`写了 ${path.relative(process.cwd(), CARD_FILE)}（${text.length} 字）；照片 ${Object.values(P).map((p) => `${p.key} ${p.png.length} 字节 ${p.id}`).join('，')}`);
  }
}
