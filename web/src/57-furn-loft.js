// 57-furn-loft.js — 阁楼家具（furn）：用 56-furn-ground.js 的 V3.furn 工具，1 格 = 1/32 m，脚底 y = 0，正面朝 +z。
// Scene part 'furn-loft'（order 51）按 V3.layout.loft 摆放；家具一览模型 'furn' 自动包含 loft 层。Contract: docs/SPEC-3.md §2 §4 §5 §9.
// 阁楼：主屋脊东西向，南北矮墙 0.75 m，中间最高；西山墙圆窗下放贝壳柜，朝海的小山墙窗前放坐垫和望远镜。
(function (V3) {
  'use strict';
  if (!V3.furn) { V3.err('57-furn-loft: V3.furn missing (56-furn-ground.js)'); return; }
  const U = V3.util, S = 1 / 32, F = V3.furn;
  const { reg, grid, vox, mix, wood, check, OAK, OAKD, OAKL, WHITE } = F;
  if (V3.scene && V3.scene.part) V3.scene.part({ id: 'furn-loft', label: '阁楼家具', order: 51, build: (ctx) => F.buildAll(ctx, 'loft') });
  const BRASS = 0xc9a24a, CREAM = 0xf3e9d2, SAND = 0xe8d3a6, SEAB = 0x8fb8d8, NAVY = 0x34497a, SEA = 0x5b8fc0, VELVET = 0x4a6fa5;
  const BONES_GLASS = [{ name: 'root', pivot: [0, 0, 0] }, { name: 'glass', pivot: [0, 0, 0], parent: 0 }];
  const BONES_GLOW = [{ name: 'root', pivot: [0, 0, 0] }, { name: 'bulb', pivot: [0, 0, 0], parent: 0 }];
  // 骨骼名 → 材质（保持材质数组：反馈工具按槽位换材质做隐藏/高亮）
  function swapMat(v, map) {
    for (const m of v.meshes) {
      const k = m.userData.anchor.split(':').pop(), mt = map[k];
      if (mt) { m.material = [].concat(m.material).map(() => mt); m.userData.noShadow = true; }
    }
  }
  const glassMat = (ctx) => ctx.loftGlass || (ctx.loftGlass = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false }));
  const at = (x, y, z) => [x * S, (y + 0.5) * S, z * S].map((v) => +v.toFixed(4));   // 格子中心 → 局部米坐标

  // ---- 贝壳收集柜：靠西山墙（圆窗下）面朝东。P5 起是整格的模组方块 xiaojingyu:shell_case（2 × 1 格）：
  // 宽 63 格 ≈ 2 m（x −31..31）、高 32 格 = 1 m（y 0..31）、深 19 格 ≈ 0.6 m（z −9..9）。
  // 下半截 2 排 × 8 个小抽屉（标签 + 铜把手，每列下面正好 2 个），上半截白色玻璃展示格 4×3。
  // 第④阶段放贝壳：root.userData.slots = 12 个格子中心（局部米坐标；上排→下排，每排从左到右，正面看），
  // slotSize = 每格内部 [宽, 高, 深]（米），格子底面 = 中心 y − 高/2；整柜 userData.clickable = 'shellBox'。
  // MC 模型（朝北、方块内坐标）的格子位置在 44-furn-mc.js 的 V3.furnMc（改了这里的 SLOT_X / SLOT_F 要一起改，测试会查）。
  const SLOT_X = [-21, -7, 7, 21], SLOT_F = [24, 17, 10];          // 列中心（格内 x c−6..c+6）；每排绒布那一格（上、中、下），格内 f+1..f+5
  function buildShellCase(ctx) {
    const g = grid('shellCase', 'loft', 32), P = '小屋/阁楼/贝壳收集柜/';
    const oakY = wood(OAK, OAKD, 1), oakL = wood(OAKL, OAK, 0);
    g.t(P + '柜体').c(oakY).box(-30, 0, -9, -29, 7, 8).box(29, 0, -9, 30, 7, 8);       // 下半截侧板（落地当脚）
    g.c(OAKD).box(-28, 0, -9, 28, 0, 6).box(-28, 1, -9, 28, 7, 7);                     // 踢脚凹进去 + 深色柜芯（抽屉缝里看得到）
    g.c(oakL).box(-30, 8, -9, 30, 9, 9);                                               // 台面（向前出挑一格）
    g.c(oakY).box(-30, 10, -9, -29, 30, 6).box(29, 10, -9, 30, 30, 6).box(-28, 10, -9, 28, 30, -9);   // 上半截侧板 + 背板
    g.c(oakL).box(-31, 31, -9, 31, 31, 7);                                             // 顶上压檐
    g.t(P + '展示格').c(SEAB).box(-28, 10, -8, 28, 29, -8);                             // 浅海蓝衬底
    for (const f of SLOT_F) g.c(VELVET).box(-28, f, -7, 28, f, 4);                     // 蓝丝绒垫
    g.c(WHITE);
    for (const x of [-28, -14, 0, 14, 28]) g.box(x, 10, -8, x, 30, 6);                 // 内侧壁 + 竖隔板（前端就是白色竖框）
    for (const y of [16, 23]) g.box(-28, y, -8, 28, y, 6);                             // 层板
    g.box(-28, 30, -8, 28, 30, 6);                                                     // 顶板
    for (const f of SLOT_F) g.box(-28, f, 5, 28, f, 6);                                // 每排下面的白横档
    g.c(BRASS);
    for (const f of SLOT_F) for (const c of SLOT_X) g.box(c - 1, f, 7, c + 1, f, 7);   // 每格一块小铜牌
    g.t(P + '玻璃门').b(1);
    for (const f of SLOT_F) for (const c of SLOT_X)                                    // 12 块玻璃（凹进白框一格，左上角一小道反光）
      g.c((x, y) => { const d = x - c + 6 - y + f; return (d === -3 || d === -2) && y >= f + 3 ? 0xffffff : 0xcfe9f5; }).box(c - 6, f + 1, 5, c + 6, f + 5, 5);
    g.b(0);
    g.t(P + '抽屉');
    for (let k = 0; k < 8; k++) for (const y0 of [1, 5]) {                             // 2 排 × 8 个小抽屉（3 格高），缝 1 格
      const x0 = -27 + 7 * k;
      g.c(oakL).box(x0, y0, 8, x0 + 5, y0 + 2, 8)
        .m('paint').c(CREAM).box(x0 + 1, y0 + 2, 8, x0 + 4, y0 + 2, 8).m('add')         // 标签
        .c(BRASS).box(x0 + 2, y0 + 1, 9, x0 + 3, y0 + 1, 9);                            // 铜把手
    }
    const v = vox(ctx, g, 'shellCase', BONES_GLASS);
    swapMat(v, { glass: glassMat(ctx) });
    Object.assign(v.root.userData, {
      clickable: 'shellBox',
      slots: SLOT_F.flatMap((f) => SLOT_X.map((c) => at(c, f + 3, -1.5))),             // 格子 f+1..f+5、z −7..4 的中心
      slotSize: [13 * S, 5 * S, 12 * S].map((x) => +x.toFixed(4)),
    });
    return v.root;
  }
  reg({ id: 'shellCase', name: '贝壳收集柜', layer: 'loft', face: 'e', wall: true, build: buildShellCase });

  // ---- 相册矮桌：坐垫北边的小圆矮桌（桌面高 0.28 m），桌上一本合着的相册 + 一杯可可 ----
  // 相册是单独的骨骼网格（anchor 以 ':book' 结尾）；整张桌 userData.clickable = 'album'，
  // userData.book = { center, size }（局部米坐标，合着时的外形），第④阶段可以换成翻开的相册。
  const BONES_BOOK = [{ name: 'root', pivot: [0, 0, 0] }, { name: 'book', pivot: [0, 0, 0], parent: 0 }];
  const RIBBON = 0xc0392b, COCOA = 0x6b3f2a;
  function buildAlbum(ctx) {
    const g = grid('album', 'loft', 13), P = '小屋/阁楼/相册矮桌/', R = 15, Z = 0;      // P5：1 格，桌子在格子中间
    const top = wood(mix(OAKD, OAK, 0.3), mix(OAKD, 0, 0.25), 0), rim = wood(mix(OAKD, 0, 0.12), mix(OAKD, 0, 0.3), 0);
    const leg = wood(mix(OAKD, OAK, 0.3), mix(OAKD, 0, 0.25), 1);
    const disc = (x, z) => x * x + (z - Z) ** 2 <= R * R + 0.5;
    const edge = (x, z) => !disc(x + 1, z) || !disc(x - 1, z) || !disc(x, z + 1) || !disc(x, z - 1);
    g.t(P + '桌面').c((x, y, z) => (edge(x, z) ? rim : top)(x, y, z))
      .fill(-R, 7, Z - R, R, 8, Z + R, (x, y, z) => disc(x, z));                         // 深色圆桌面 2 格厚（和浅色地板分开），最外一圈更深当包边
    g.t(P + '桌腿').c(leg);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(sx * 9, 0, Z + sz * 9, sx * 10, 6, Z + sz * 10);   // 4 条方腿
    g.c(rim).box(-8, 6, Z - 10, 8, 6, Z - 10).box(-8, 6, Z + 10, 8, 6, Z + 10).box(-10, 6, Z - 8, -10, 6, Z + 8).box(10, 6, Z - 8, 10, 6, Z + 8);   // 牵脚
    g.t(P + '相册').b(1);
    g.c(NAVY).box(0, 9, Z - 2, 9, 9, Z + 6).box(0, 11, Z - 2, 9, 11, Z + 6).box(-1, 9, Z - 2, -1, 11, Z + 6);   // 上下封面 + 书脊（西边）
    g.c(CREAM).box(0, 10, Z - 2, 9, 10, Z + 6);                                          // 内页（侧面看是奶白一条）
    g.m('paint').c(CREAM).box(3, 11, Z, 6, 11, Z + 1).c(BRASS).box(4, 11, Z + 3, 5, 11, Z + 4).m('add');   // 封面标签 + 小金贝壳
    g.c(RIBBON).box(3, 10, Z + 7, 3, 10, Z + 7).box(3, 9, Z + 7, 3, 9, Z + 8);            // 书签红丝带从书尾垂到桌上
    g.t(P + '可可杯').b(0).c(WHITE).box(-8, 9, Z - 6, -6, 11, Z - 4).box(-9, 10, Z - 5, -9, 10, Z - 5)   // 杯子 + 把手
      .m('paint').c(SEA).box(-8, 10, Z - 6, -6, 10, Z - 4).c(COCOA).box(-7, 11, Z - 5, -7, 11, Z - 5).m('add');
    const v = vox(ctx, g, 'album', BONES_BOOK);
    Object.assign(v.root.userData, {
      clickable: 'album',
      book: { center: at(4, 10, Z + 2), size: [11 * S, 3 * S, 9 * S].map((x) => +x.toFixed(4)) },   // 相册 x −1..9、y 9..11、z Z−2..Z+6
    });
    return v.root;
  }
  reg({ id: 'album', name: '相册矮桌', layer: 'loft', face: 's', build: buildAlbum });

  // ---- 坐垫：矮桌南边两个方坐垫（蓝格 / 珊瑚格，滚边 + 中间一颗扣），右边那个被坐歪了一点 ----
  function buildCushions(ctx) {
    const g = grid('cushions', 'loft', 4), P = '小屋/阁楼/坐垫/';
    for (const [name, cx, cz, a, pipe] of [['蓝格子', -14, -2, 0x5b74b0, NAVY], ['珊瑚格子', 14, 0, 0xd0574a, mix(0xd0574a, 0, 0.3)]]) {
      g.t(P + name).c(check(a, WHITE, 2)).rbox(cx - 8, 0, cz - 8, cx + 8, 2, cz + 8, [3, 0, 3])   // 垫身 17×17 格，3 格厚
        .rbox(cx - 6, 3, cz - 6, cx + 6, 3, cz + 6, [2, 0, 2])                                     // 中间鼓起来一层
        .m('paint').c(pipe).fill(cx - 8, 1, cz - 8, cx + 8, 1, cz + 8, (x, y, z) => Math.max(Math.abs(x - cx), Math.abs(z - cz)) >= 7)   // 滚边
        .box(cx - 1, 3, cz, cx + 1, 3, cz).box(cx, 3, cz - 1, cx, 3, cz + 1).m('add');               // 中间的扣
    }
    return vox(ctx, g, 'cushions').root;
  }
  reg({ id: 'cushions', name: '坐垫', layer: 'loft', face: 's', build: buildCushions });

  // ---- 懒人沙发：梨形豆袋（海玻璃绿绒布），朝南看海；前面被坐出一个坑、两边鼓起像扶手；坑里趴着一只蓝色小鲸鱼抱枕 ----
  const SEAGLASS = 0x76a99b;
  function buildBeanbag(ctx) {
    const g = grid('beanbag', 'loft', 16), P = '小屋/阁楼/懒人沙发/';
    const base = (x, y, z) => (x / 14.5) ** 2 + ((y - 3) / 9) ** 2 + (z / 14.5) ** 2 <= 1;           // 宽而矮的底（地板把底切平）
    const back = (x, y, z) => (x / 11) ** 2 + ((y - 8) / 8) ** 2 + ((z + 7) / 8) ** 2 <= 1;          // 后面鼓起来当靠背（最高 16 格）
    const dent = (x, y, z) => (x / 9) ** 2 + ((y - 15) / 7) ** 2 + ((z - 6) / 9) ** 2 <= 1;          // 前面坐出来的坑，两边留下扶手
    g.t(P + '豆袋').c(SEAGLASS).fill(-15, 0, -16, 15, 16, 15, (x, y, z) => (base(x, y, z) || back(x, y, z)) && !dent(x, y, z))
      .m('paint').c(mix(SEAGLASS, 0, 0.25)).box(-15, 3, -16, 15, 3, 15).m('add');                    // 底边一圈滚边
    g.t(P + '鲸鱼抱枕').c((x, y) => (y <= 9 ? CREAM : SEA)).ell(-1, 10, 4, 6, 2.5, 3)                  // 蓝背白肚，头朝西，趴在坑里
      .c(SEA).box(6, 10, 3, 6, 10, 5).box(7, 11, 4, 7, 11, 4).box(8, 12, 1, 8, 12, 7)                 // 尾巴往上翘
      .box(9, 13, 0, 9, 13, 2).box(9, 13, 6, 9, 13, 8)
      .m('paint').c(0x1e2433).box(-5, 11, 5, -5, 11, 5).box(-5, 11, 3, -5, 11, 3)                    // 眼睛
      .c(0xf2a0a0).box(-4, 10, 6, -4, 10, 6).box(-4, 10, 2, -4, 10, 2).m('add');                       // 腮红
    return vox(ctx, g, 'beanbag').root;
  }
  reg({ id: 'beanbag', name: '懒人沙发', layer: 'loft', face: 's', build: buildBeanbag });

  // ---- 屋脊串灯（P5：模组方块 xiaojingyu:string_lights，一格一段，房子里 y 9 那层、z −12 那排 12 格，串在格子的南边上）。
  // 每段 32 格（1 米）：段头一个铜挂钩（顶在格子顶上），电线往下垂（中间低 5 格），两颗暖光灯泡；段数 = 布局矩形多长（米），家具一览只摆 2 段。
  // 体素在格子里 y 0..31；face 'n'：体素的 −z 是南边，电线在 z = −Z + 1（贴着格子的南边）。整串只用 1 个 ctx.lamp
  function buildLights(ctx) {
    const g = grid('lights', 'loft', 32), X = g.hx, Z = g.hz, P = '小屋/阁楼/串灯/', CORD = 0x2b2620;
    const n = Math.max(1, Math.round((2 * X + 1) / 32)), N = ctx.studio ? Math.min(2, n) : n, X0 = 1 - 16 * N, WZ = -Z + 1;
    const wy = (x) => { const u = ((x - X0) % 32 + 0.5) / 32; return Math.round(29 - 20 * u * (1 - u)); };     // 电线高度：两头 29，中间 24
    for (let i = 0; i < N; i++) g.t(P + '挂钩').c(BRASS).box(X0 + i * 32, 29, WZ, X0 + i * 32, 31, WZ);
    g.t(P + '电线').c(CORD);
    for (let x = X0; x < X0 + 32 * N; x++) g.box(x, wy(x), WZ, x, wy(x), WZ);
    for (let i = 0; i < N; i++) for (const f of [0.3, 0.7]) {
      const x = Math.round(X0 + (i + f) * 32), y = wy(x);
      g.b(0).c(CORD).box(x, y - 1, WZ, x, y - 1, WZ);                                               // 灯座
      g.t(P + '灯泡').b(1).c(0xffd28a)                                                               // 3×3×3 去掉 8 个角 = 圆一点的灯泡
        .fill(x - 1, y - 4, WZ - 1, x + 1, y - 2, WZ + 1, (a, b, c) => Math.abs(a - x) + Math.abs(b - y + 3) + Math.abs(c - WZ) <= 2);
      g.t(P + '电线');
    }
    const v = vox(ctx, g, 'lights', BONES_GLOW);
    swapMat(v, { bulb: ctx.glowMat(0xffd28a, { day: 0.25, night: 2.6 }) });
    for (const m of v.meshes) m.userData.ceilingFixture = 'loft';
    ctx.lamp({ pos: [0, 20 * S, WZ * S], color: 0xffc27a, intensity: 2.5, distance: 9, parent: v.root, keepWhenCut: true });
    return v.root;
  }
  reg({ id: 'lights', name: '串灯', layer: 'loft', face: 'n', build: buildLights, y: (it) => (it.wallY != null ? it.wallY : V3.layout.house.ridgeIn) });   // 布局的 wallY = 那层格子的底

  // @@NEXT@@
})(window.V3);
