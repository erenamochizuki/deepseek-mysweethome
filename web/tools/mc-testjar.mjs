// tools/mc-testjar.mjs — 造一个很小的「假 MC jar」给测试用：几张纯色贴图 + 我们自己手写的模型 JSON（不含任何 Mojang 文件）
//   node tools/mc-testjar.mjs <输出.jar>      也可以在测试里 import { makeTestJar }
import fs from 'node:fs';
import { encodePng, makeZip } from './mc-lib.mjs';

export const TEST_COLORS = { stone: [128, 128, 128], planks: [160, 110, 60], dirt: [120, 85, 50], grass_top: [200, 200, 200], grass_side: [110, 120, 70],
  leaves: [180, 180, 180], glass: [230, 240, 250], water: [200, 200, 220], grassMap: [100, 200, 60], foliageMap: [60, 160, 40] };

// 16×16 纯色贴图；edge 给 1 像素边框另一种颜色/透明度
function tex(rgb, a = 255, edge = null, w = 16, h = 16) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const onEdge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    const c = onEdge && edge ? edge : [...rgb, a];
    d.set([c[0], c[1], c[2], c[3] == null ? 255 : c[3]], (y * w + x) * 4);
  }
  return encodePng(w, h, d);
}
// 棋盘镂空（树叶）：一半像素透明
function checker(rgb) {
  const d = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) d.set([...rgb, ((i % 16) + (i >> 4)) % 2 ? 255 : 0], i * 4);
  return encodePng(16, 16, d);
}
// 实体贴图（64×64）：底色 + 几块别的颜色的长方形 [x, y, w, h, [r,g,b]]，测试按颜色认 UV 落在哪
function paint(base, rects, w = 64, h = 64) {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([...base, 255], i * 4);
  for (const [x0, y0, rw, rh, c] of rects) for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) d.set([...c, 255], (y * w + x) * 4);
  return encodePng(w, h, d);
}

const faces = (tx, cull = true) => Object.fromEntries(['down', 'up', 'north', 'south', 'west', 'east'].map((f) => [f, { texture: tx(f), ...(cull ? { cullface: f } : {}) }]));
const M = (o) => o;

export function testJarEntries() {
  const C = TEST_COLORS, B = 'assets/minecraft/';
  return [
    ['version.json', { id: 'test-1', name: 'test-1', world_version: 1, build_time: '2026-01-01T00:00:00+00:00' }],
    ['data/minecraft/worldgen/biome/plains.json', { temperature: 0.8, downfall: 0.4, effects: { water_color: '#3355cc' }, attributes: { 'minecraft:visual/sky_color': '#2040ff' } }],
    // 维度文件：雾色、天空色都是随便定的测试值
    ['data/minecraft/dimension_type/overworld.json', { attributes: { 'minecraft:visual/fog_color': '#ff8000', 'minecraft:visual/sky_color': '#000000', 'minecraft:visual/fog_end_distance': 50 } }],
    [B + 'textures/block/stone.png', tex(C.stone)],
    [B + 'textures/block/planks.png', tex(C.planks)],
    [B + 'textures/block/dirt.png', tex(C.dirt)],
    [B + 'textures/block/grass_top.png', tex(C.grass_top)],
    [B + 'textures/block/grass_side.png', tex(C.grass_side)],
    [B + 'textures/block/leaves.png', checker(C.leaves)],
    [B + 'textures/block/glass.png', tex(C.glass, 0, [C.glass[0], C.glass[1], C.glass[2], 255])],
    [B + 'textures/block/water_still.png', tex(C.water, 180)],
    [B + 'textures/block/water_flow.png', tex(C.water, 180, null, 32, 32)],
    [B + 'textures/block/water_still.png.mcmeta', { animation: { frametime: 2 } }],
    [B + 'textures/colormap/grass.png', tex(C.grassMap, 255, null, 256, 256)],
    [B + 'textures/colormap/foliage.png', tex(C.foliageMap, 255, null, 256, 256)],
    // 模型：一个通用方块 + 继承
    [B + 'models/block/t_cube.json', M({ elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: faces((f) => '#' + f) }] })],
    [B + 'models/block/t_cube_all.json', M({ parent: 'minecraft:block/t_cube', textures: { particle: '#all', down: '#all', up: '#all', north: '#all', south: '#all', west: '#all', east: '#all' } })],
    [B + 'models/block/stone.json', M({ parent: 'block/t_cube_all', textures: { all: 'block/stone' } })],
    [B + 'models/block/glass.json', M({ parent: 'block/t_cube_all', textures: { all: 'block/glass' } })],
    [B + 'models/block/oak_planks.json', M({ parent: 'block/t_cube_all', textures: { all: 'block/planks' } })],
    [B + 'models/block/oak_leaves.json', M({ parent: 'block/t_cube_all', textures: { all: 'block/leaves' }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: faces(() => '#all') }] })],
    [B + 'models/block/grass_block.json', M({ textures: { particle: 'block/dirt', bottom: 'block/dirt', top: 'block/grass_top', side: 'block/grass_side' },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { down: { texture: '#bottom', cullface: 'down' }, up: { texture: '#top', cullface: 'up', tintindex: 0 },
        north: { texture: '#side', cullface: 'north' }, south: { texture: '#side', cullface: 'south' }, west: { texture: '#side', cullface: 'west' }, east: { texture: '#side', cullface: 'east' } } }] })],
    [B + 'models/block/t_slab.json', M({ elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: { down: { texture: '#all', cullface: 'down' }, up: { texture: '#all' },
      north: { texture: '#all', cullface: 'north' }, south: { texture: '#all', cullface: 'south' }, west: { texture: '#all', cullface: 'west' }, east: { texture: '#all', cullface: 'east' } } }] })],
    [B + 'models/block/oak_slab.json', M({ parent: 'block/t_slab', textures: { all: 'block/planks' } })],
    [B + 'models/block/oak_slab_top.json', M({ parent: 'block/oak_slab', elements: [{ from: [0, 8, 0], to: [16, 16, 16], faces: faces(() => '#all', false) }] })],
    [B + 'models/block/oak_fence_post.json', M({ textures: { all: 'block/planks' }, elements: [{ from: [6, 0, 6], to: [10, 16, 10], faces: faces(() => '#all', false) }] })],
    [B + 'models/block/oak_fence_side.json', M({ textures: { all: 'block/planks' }, elements: [{ from: [7, 12, 0], to: [9, 15, 9], faces: faces(() => '#all', false) }] })],
    // 方块状态：variants（含按属性匹配、随机列表）和 multipart（含 OR）
    [B + 'blockstates/stone.json', { variants: { '': { model: 'minecraft:block/stone' } } }],
    [B + 'blockstates/glass.json', { variants: { '': { model: 'minecraft:block/glass' } } }],
    [B + 'blockstates/oak_planks.json', { variants: { '': { model: 'minecraft:block/oak_planks' } } }],
    [B + 'blockstates/oak_leaves.json', { variants: { '': { model: 'minecraft:block/oak_leaves' } } }],
    [B + 'blockstates/grass_block.json', { variants: { 'snowy=false': [{ model: 'minecraft:block/grass_block' }, { model: 'minecraft:block/grass_block', y: 90 }], 'snowy=true': { model: 'minecraft:block/stone' } } }],
    [B + 'blockstates/oak_slab.json', { variants: { 'type=bottom': { model: 'minecraft:block/oak_slab' }, 'type=top': { model: 'minecraft:block/oak_slab_top' }, 'type=double': { model: 'minecraft:block/oak_planks' } } }],
    [B + 'blockstates/oak_fence.json', { multipart: [{ apply: { model: 'minecraft:block/oak_fence_post' } },
      { when: { north: 'true' }, apply: { model: 'minecraft:block/oak_fence_side', uvlock: true } },
      { when: { east: 'true' }, apply: { model: 'minecraft:block/oak_fence_side', y: 90, uvlock: true } },
      { when: { OR: [{ south: 'true' }, { west: 'true' }] }, apply: { model: 'minecraft:block/oak_fence_side', y: 180, uvlock: true } }] }],
  ];
}

// 箱子、床（方块实体）测试用的额外文件：方块模型只有 particle（和 MC 一样没有 elements），
// 外观靠 textures/entity/… 的实体贴图。颜色是自己定的：箱子底色棕、盖子顶面红、锁黄；床底色红、床头那半的顶面白。
// 故意不放 chest/normal_left、normal_right、trapped：大箱子、陷阱箱读不到贴图，要退回盒子。
export const ENTITY_COLORS = { chest: [120, 80, 40], chestLid: [200, 30, 30], chestLock: [240, 220, 40], bed: [170, 20, 20], pillow: [240, 240, 240], wool: [180, 30, 30] };
export function entityTestEntries() {
  const C = ENTITY_COLORS, B = 'assets/minecraft/';
  return [
    [B + 'textures/entity/chest/normal.png', paint(C.chest, [[28, 0, 14, 14, C.chestLid], [0, 0, 6, 5, C.chestLock]])],
    [B + 'textures/entity/bed/red.png', paint(C.bed, [[6, 6, 16, 16, C.pillow]])],
    [B + 'textures/block/red_wool.png', tex(C.wool)],
    [B + 'models/block/chest.json', M({ textures: { particle: 'block/planks' } })],
    [B + 'models/block/bed.json', M({ textures: { particle: 'block/red_wool' } })],
    [B + 'blockstates/chest.json', { variants: { '': { model: 'minecraft:block/chest' } } }],
    [B + 'blockstates/trapped_chest.json', { variants: { '': { model: 'minecraft:block/chest' } } }],
    [B + 'blockstates/red_bed.json', { variants: { '': { model: 'minecraft:block/bed' } } }],
  ];
}

// opts.entities = true：再加上箱子、床那几个文件（命令行造的 jar 默认带上）
export const makeTestJar = (opts = {}) => makeZip([...testJarEntries(), ...(opts.entities ? entityTestEntries() : [])]);

if (process.argv[1] && /mc-testjar\.mjs$/.test(process.argv[1])) {
  const out = process.argv[2];
  if (!out) { console.error('用法：node tools/mc-testjar.mjs <输出.jar>'); process.exit(2); }
  fs.writeFileSync(out, makeTestJar({ entities: true }));
  console.log('wrote', out);
}
