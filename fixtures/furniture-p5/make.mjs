#!/usr/bin/env node
// fixtures/furniture-p5/make.mjs — 鲸图：P5 的 3 件家具方块 × 4 个朝向（卡片 mod/cards/P5-001.yml 用）
//
//   node fixtures/furniture-p5/make.mjs           写 furniture-p5.json（dump）和 furniture-p5.png（鲸图）
//   node fixtures/furniture-p5/make.mjs --check   在内存里重新生成，和这两个文件逐字节比
//
// 读写都用 web/tools/share.mjs（和网页、/xjy 同一套格式，docs/FORMAT.md）。状态照 docs/FURNITURE.md 第 2 节：
//   床 xiaojingyu:bed[facing,part]：head = foot + facing
//   餐桌 xiaojingyu:dining_table[facing]
//   贝壳柜 xiaojingyu:shell_case[facing,part]：right = left + （facing 逆时针转 90°）
// 摆法（模型坐标，+x 东、+z 南，只有 y=0 一层，11 × 1 × 7）：朝向 north / east / south / west 各一列，
// 第 c 列从 x = 3c 开始；床在 z 0..1，餐桌在 z 3，贝壳柜在 z 5..6。每件之间隔一格空气。
// Facing north，站立点 = 格子 (5, 0, 8)（盒子南边一格的正中），所以 Offset (-5, 0, -8)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { share, formatJSON } from '../../web/tools/share.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SIZE = [11, 1, 7];
const OFFSET = [-5, 0, -8];
const FACINGS = ['north', 'east', 'south', 'west'];
const STEP = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' };

function cells() {
  const out = [];   // [x, z, state]
  FACINGS.forEach((f, c) => {
    const x0 = 3 * c;
    const [fx, fz] = STEP[f];
    // 床：foot 和 head 放进 x0..x0+1、z 0..1 的 2×2 里
    const foot = [x0 + (fx < 0 ? 1 : 0), fz < 0 ? 1 : 0];
    const head = [foot[0] + fx, foot[1] + fz];
    out.push([...foot, `xiaojingyu:bed[facing=${f},part=foot]`], [...head, `xiaojingyu:bed[facing=${f},part=head]`]);
    // 餐桌
    out.push([x0, 3, `xiaojingyu:dining_table[facing=${f}]`]);
    // 贝壳柜：right = left + CCW(facing)，放进 x0..x0+1、z 5..6
    const [rx, rz] = STEP[CCW[f]];
    const left = [x0 + (rx < 0 ? 1 : 0), 5 + (rz < 0 ? 1 : 0)];
    const right = [left[0] + rx, left[1] + rz];
    out.push([...left, `xiaojingyu:shell_case[facing=${f},part=left]`], [...right, `xiaojingyu:shell_case[facing=${f},part=right]`]);
  });
  for (const [x, z] of out) if (x < 0 || x >= SIZE[0] || z < 0 || z >= SIZE[2]) throw new Error(`格子出界：${x},${z}`);
  return out;
}

function dump() {
  const palette = ['minecraft:air'];
  const grid = new Array(SIZE[0] * SIZE[1] * SIZE[2]).fill(0);
  for (const [x, z, state] of cells()) {
    const i = x + z * SIZE[0];
    if (grid[i] !== 0) throw new Error(`格子重了：${x},${z}`);
    let p = palette.indexOf(state);
    if (p < 0) p = palette.push(state) - 1;
    grid[i] = p;
  }
  const runs = [];
  for (const p of grid) {
    if (runs.length && runs[runs.length - 1][1] === p) runs[runs.length - 1][0]++;
    else runs.push([1, p]);
  }
  return {
    dump: 1, size: SIZE, offset: OFFSET, dataVersion: 4790,
    meta: { compound: {
      Name: { string: 'P5 家具测试（3 件 × 4 个朝向）' },
      Author: { string: 'xiaojingyu-mod' },
      Xiaojingyu: { compound: {
        FormatVersion: { int: 1 },
        Facing: { string: 'north' },
        Origin: { intArray: [5, 0, 8] },
        Source: { string: 'fixtures/furniture-p5/make.mjs' },
      } },
    } },
    palette, cells: runs, blockEntities: [], warnings: [],
  };
}

async function build() {
  const S = share();
  const png = Buffer.from(await S.writePng(S.fromDump(dump())));
  // json 用读回来的 dump（RequiredMods 是写的时候按调色板算的），保证和 png 读出来的一样
  const json = Buffer.from(formatJSON(S.dump(await S.read(png))), 'utf8');
  return new Map([['furniture-p5.png', png], ['furniture-p5.json', json]]);
}

const files = await build();
if (process.argv.includes('--check')) {
  let bad = 0;
  for (const [name, buf] of files) {
    const p = path.join(DIR, name);
    const same = fs.existsSync(p) && fs.readFileSync(p).equals(buf);
    console.log(`${same ? 'same' : 'DIFF'}  ${name}`);
    if (!same) bad++;
  }
  process.exitCode = bad ? 1 : 0;
} else {
  for (const [name, buf] of files) {
    const p = path.join(DIR, name);
    if (fs.existsSync(p) && fs.readFileSync(p).equals(buf)) { console.log(`没变  ${name}`); continue; }
    fs.writeFileSync(p, buf);
    console.log(`写了  ${name}（${buf.length} 字节）`);
  }
}
