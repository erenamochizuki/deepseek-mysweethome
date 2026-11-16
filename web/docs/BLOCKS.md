# BLOCKS — V3.atlas 贴图图集 + V3.blocks 方块网格化

src/04-atlas.js（移植自 v1 的 04-atlas.js）和 src/05-blocks.js（移植自 v1 的 03-voxel.js，去掉了光照体积）。
一览模型：`model=blocks`，视角 all / tiles / tiles2 / grid / shapes / wall / terrain；`V3.blocks.stats` 有各区 tris 和 ms。

## V3.atlas
- 程序生成 16×16 像素贴图，确定性（每张图用 `'atlas:' + name` 做种子，不用 Math.random）。图集固定 1024×512（32×16 格，每格 16 px + 8 px 边），最多 512 张。
- `add(name, (px, rng, lib) => …, { clamp })`：px(x, y, c, a) 写像素，c = [r,g,b] | 0xRRGGBB | '#rrggbb'，a ≤ 0 清成透明；px.get(x, y)。同名再 add = 替换；贴图已建好时会在同一个 texture 对象上重传。
- `index(name)`（未知 −1）、`uv(name) → [u0, v0, u1, v1]`（GL 约定，v0 在下）、`has(name)`、`names`、`S = 16`。
- `texture()`：THREE.DataTexture，sRGB，放大最近邻，缩小 mipmap（手工生成，透明边不发黑），`userData.shared = true`（别 dispose）。
- `lib`：noise / palette 工具（n2 tn h2 mix ramp P each vor pts）和图案（planks bricks moss cobble grainy boards rock plaster），自己加贴图时用。

## V3.blocks
```js
const w = new V3.blocks.World({ cell: 0.25, origin: [x0, y0, z0], size: [nx, ny, nz], tileCells: 2 });
```
- 格 (i, j, k) = x / y / z，格最小角 = origin + (i, j, k)·cell。房子外壳用 cell 0.25 + tileCells 2（16 px = 0.5 m），地形用 0.5 + 1。
- `w.set(i, j, k, name, opts)`；`w.fill(i0, j0, k0, i1, j1, k1, name, opts)`（下标，两端都含）；`w.clear(…)`；`w.get(i, j, k) → { name, shape, facing, half, axis, h, tag } | null`。
- `w.fillM(x0, y0, z0, x1, y1, z1, name, opts)` / `w.clearM(…)`：用米，半开区间，取格心落在区间里的格（至少一格）。`w.at(x, y, z) → [i, j, k]`，`w.pos(i, j, k)` → 格最小角（米），`w.top(i, k)` → 最高的非空 j。
- opts：`tag`（部件路径，如 '小屋/墙/南'）、`facing: 'n'|'s'|'e'|'w'`（stairs 指高的一侧，n = −z）、`half: 'top'`（上半 slab / 倒挂楼梯）、`axis: 'x'|'y'|'z'`（原木、木柱、梁）、`rot`（贴图转 90°）、`h: 1..8`（layer 高度，单位 1/8 格）、`shape`。
- 方块名：任何图集贴图名都是一个 cube 方块；加后缀换形状：`.slab` `.stairs` `.pane` `.fence` `.carpet` `.layer`（如 'roofA.stairs'、'planks.fence'），或 opts.shape。名字不认识时警告一次，不放方块。
- `V3.blocks.def(name, { tiles, shape, opaque, tint, glass, cutout, leaves, axis, box, uv })`：tiles = 'plaster' | { top, bottom, side, end, n, s, e, w }；tint = 0xRRGGBB 乘色；box = [x0, y0, z0, x1, y1, z1]（1/16 格）；uv: 'cell' = 每格一整张贴图（默认 'world'）。
- `w.mesh({ part, anchor, filter, range, ao })` → THREE.Mesh，位置 = origin。
  - 相邻不透明面剔除，AO 烘在顶点色里。按 (类型, tag) 分组：一组一个材质槽，`userData = { faceTags, triTag, anchor, part, stats: { tris, groups, ms } }`，和 src/03-vox.js 一样，已调 `V3.parts.tagFaces`，点选能落到 tag。没 tag 的格用 part。
  - 玻璃面单独放在子 Mesh `anchor + ':glass'`（透明，`userData.noShadow = true`）。
  - `filter(i, j, k, tag)`：返回 true = 输出；false = 当空气（剖切：切口露出侧面）；'solid' = 不输出，但仍剔除邻面、算 AO（把一个 World 分成几块 Mesh 时用，接缝处不多出面）。
  - `range: [i0, j0, k0, i1, j1, k1]`：只输出这块，范围外的格照样参与剔除和 AO。
- `V3.blocks.material(kind)`：kind = 'opaque' | 'cutout' | 'glass'，全局共享一份（MeshStandardMaterial，map = 图集，vertexColors，roughness 0.9），`userData.shared = true`，不要改它、不要 dispose。
- UV 按世界格坐标连续：同 cell、origin 对齐格子的两个 World 拼在一起，贴图不断。
- 性能（Edge d3d11）：12×3.5 m 墙（0.25 m 格，带柱、窗）冷 3–8 ms，热 1–2 ms，约 3k tris；10×7×8 m 实心外壳 18 ms，20k tris（每格每面一个四边形，没有合并面）。第一次 mesh() 会顺带生成图集（约 45 ms，只一次）。

## 贴图 / 方块名
- v3 新贴图（SPEC-3 §6 配色）：plaster plasterTrim timber timberEnd planks floorWood roofA roofB roofEdge windowFrame glass
  sand sandRipple sandWet sandDark sandstone strata1 strata2 strata3 stone stoneMoss cobble gravel seabed coralSand
- v1 移植：sandstoneTop smoothSandstone cutSandstone dirt coarseDirt grassTop grassSide clay mossyCobblestone andesite
  polishedAndesite deepslate bedrock prismarine darkPrismarine stoneBricks mossyStoneBricks bricks tubeCoral brainCoral
  bubbleCoral fireCoral hornCoral oakLog(Top) birchLog(Top) jungleLog(Top) strippedOakLog(Top) oakPlanks sprucePlanks
  birchPlanks whitePlaster calcite quartzBlock quartzBricks terracottaWhite bookshelf barrelTop barrelSide hayTop haySide
  snow woolWhite woolLightBlue woolBlue woolCyan woolYellow woolPink woolRed woolLime woolGray woolBrown
  lantern paperLantern glowstone seaLantern shroomlight lampOn（只是贴图颜色，夜里发光靠场景 glowMat）
- 预定义方块：axis 类 oakLog birchLog jungleLog strippedOakLog timber barrel hay（自动用端面贴图）；grassBlock、
  sandstone、sandRipple（顶面和侧面不同）；glass、glassPane；wool*Carpet、snowLayer、lilyPad；
  十字精灵：seagrass kelp kelpTop seaPickle beachGrass fern deadBush sugarCane vine，五种 *CoralFan，
  花 poppy dandelion blueOrchid allium azureBluet cornflower oxeyeDaisy pinkTulip lilyOfTheValley；
  cutout：五种 *Leaves、oakDoorTop oakDoorBottom oakTrapdoor flowerPot lantern；paperLantern（小方盒）。

## 例子
```js
// 1) 0.25 m 南墙：灰泥 + 木柱 + 窗，按部件分组（点窗选到 '小屋/窗'）
const w = new V3.blocks.World({ cell: 0.25, origin: [-6, 0, 4], size: [48, 14, 1], tileCells: 2 });
w.fill(0, 0, 0, 47, 13, 0, 'plaster', { tag: '小屋/墙/南' });
for (const i of [0, 8, 16, 24, 32, 40, 46]) w.fill(i, 0, 0, i + 1, 13, 0, 'timber', { tag: '小屋/墙/柱' });
w.fill(10, 4, 0, 15, 11, 0, 'windowFrame', { tag: '小屋/窗' }); w.fill(11, 5, 0, 14, 10, 0, 'glassPane', { tag: '小屋/窗' });
const full = w.mesh({ part: '小屋/墙/南', anchor: 'house2:wall-s-full' });
const low = w.mesh({ part: '小屋/墙/南', anchor: 'house2:wall-s-low', filter: (i, j) => j < 5 }); // 剖切：只留 1.25 m 以下
// 2) 单坡屋顶：每排降一格，两色隔行，檐口半格
const w2 = new V3.blocks.World({ cell: 0.25, origin: [-6, 0, 4], size: [48, 14, 8], tileCells: 2 });
for (let k = 1; k <= 6; k++) w2.fill(0, 14 - k, k, 47, 14 - k, k, k & 1 ? 'roofA.stairs' : 'roofB.stairs', { facing: 'n', tag: '小屋/屋顶' });
w2.fill(0, 7, 7, 47, 7, 7, 'roofEdge.slab', { half: 'top', tag: '小屋/屋顶' });
// 3) 地形（米）：岛侧分层 + 沙纹顶面 + 草丛；自定义方块
const t = new V3.blocks.World({ cell: 0.5, origin: [-12, -3, -12], size: [48, 9, 48] });
t.fillM(-12, -3, -12, 12, -1.5, 12, 'strata3'); t.fillM(-12, -1.5, -12, 12, -0.5, 12, 'strata2');
t.fillM(-12, -0.5, -12, 12, 0.5, 12, 'strata1'); t.fillM(-12, 0.5, -12, 12, 1, 12, 'sandRipple');
t.set(...t.at(2.2, 1.2, 3.1), 'beachGrass');
V3.blocks.def('driftwood', { tiles: { side: 'strippedOakLog', end: 'strippedOakLogTop' }, axis: true, tint: 0xd8d0c4 });
```
