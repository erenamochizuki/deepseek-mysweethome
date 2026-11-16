// 57-furn-loft2.js — 阁楼家具第二批（furn）：窗边坐垫、望远镜、储物箱 ×2。只往 V3.furn 的 REG 里登记（layer 'loft'），
// 不建场景部件：57-furn-loft.js 的 'furn-loft' 用 buildAll(ctx,'loft') 统一摆放；家具一览 'furn' 也会自动带上。
// 1 格 = 1/32 m，脚底 y = 0，正面朝 +z。Contract: docs/SPEC-3.md §2 §4 §5 §9.
(function (V3) {
  'use strict';
  if (!V3.furn) { V3.err('57-furn-loft2: V3.furn missing (56-furn-ground.js)'); return; }
  const U = V3.util, F = V3.furn;
  const { reg, grid, vox, mix, wood, check, OAK, OAKD, OAKL, WHITE } = F;
  const BRASS = 0xc9a24a, BRASSD = 0x9c7a32, BRASSL = 0xe2c272, BLK = 0x2b2b2e, NAVY = 0x34497a, SEA = 0x5b8fc0;
  const CREAM = 0xf1e8d4, GLASS = 0x6f8fa8, RED = 0xc84b3c;
  const hn = (a, b) => (x, y, z) => mix(a, b, U.hash3(x, y, z));        // 两色之间按格子哈希抖动（布料、藤、草）

  // ---- 窗边坐垫（南边小山墙窗下，看海）：矮木座箱（两扇小门 + 中间开格）+ 海军条纹长坐垫 + 两个靠垫（蓝格子 / 奶白船锚）+ 叠好的毯子、一本书 ----
  const ANCHOR = ['...#...', '..#.#..', '...#...', '.#####.', '...#...', '...#...', '#..#..#', '.#.#.#.', '..###..'];
  function buildSeat(ctx) {
    const g = grid('seat', 'loft', 26), X = g.hx, Z = g.hz, P = '小屋/阁楼/窗边坐垫/';
    g.t(P + '座箱').c(OAKD).box(-X + 1, 0, -Z, X - 1, 1, Z - 2);                                   // 缩进踢脚
    g.c(wood(OAK, OAKD, 0)).box(-X, 2, -Z, X, 8, Z - 1);                                            // 箱体
    g.c(wood(OAKL, OAK, 0)).box(-X, 9, -Z, X, 9, Z);                                                // 座板，前沿出 1 格
    for (const [x0, x1, kx] of [[-X + 1, -10, -11], [10, X - 1, 11]]) {                             // 左右两扇小门 + 铜钮
      g.c(wood(OAKL, OAK, 1)).box(x0, 3, Z, x1, 7, Z);
      g.m('paint').c(wood(OAK, OAKD, 1)).box(x0 + 2, 4, Z, x1 - 2, 6, Z).m('add');
      g.c(BRASS).box(kx, 5, Z + 1, kx, 5, Z + 1);
    }
    g.m('erase').box(-8, 3, -Z + 2, 8, 7, Z - 1).m('paint').c(0x6e4626).box(-8, 3, -Z + 1, 8, 7, -Z + 1).m('add');   // 中间开格
    g.c((x) => (((x + 40) >> 1) & 1 ? SEA : WHITE)).fill(-7, 3, 1, -1, 7, 5, (x, y, z) => (y - 5) * (y - 5) + (z - 3) * (z - 3) <= 4.9);  // 卷起的毛巾
    g.c(0x3f7f6f).box(1, 3, -2, 7, 3, 6).c(0xd9a441).box(2, 4, -1, 7, 4, 5);                        // 两本平放的书
    const tick = (x, y, z) => { const k = ((x % 6) + 6) % 6; return k === 0 ? NAVY : k === 3 ? 0xa9c1dc : hn(CREAM, 0xe9dec6)(x, y, z); };
    g.t(P + '坐垫').c(tick).box(-X + 1, 10, -Z + 1, X - 1, 11, Z - 1).box(-X + 2, 12, -Z + 2, X - 2, 12, Z - 2);
    g.m('paint').c(NAVY).box(-X + 1, 11, Z - 1, X - 1, 11, Z - 1).c(0x22305a);                      // 前沿滚边
    for (let x = -X + 7; x <= X - 7; x += 7) g.box(x, 12, -1, x, 12, -1).box(x, 12, 3, x, 12, 3);  // 拉扣
    g.m('add');
    const anc = (x, y) => { const r = ANCHOR[8 - (y - 15)]; return !!r && r[x - (X - 13)] === '#'; };
    g.t(P + '靠垫').c(check(0x5b74b0, WHITE, 2)).rbox(-X + 3, 12, -Z + 1, -X + 16, 24, -Z + 4, [2, 2, 1]);
    g.c((x, y, z) => (anc(x, y) ? NAVY : hn(CREAM, 0xeadfc8)(x, y, z))).rbox(X - 16, 12, -Z + 1, X - 3, 24, -Z + 4, [2, 2, 1]);
    g.t(P + '小物').c((x, y, z) => (y === 14 ? WHITE : hn(SEA, 0x4f7fae)(x, y, z))).box(X - 14, 13, 0, X - 4, 15, 6);   // 叠好的毯子
    g.c(0xf3ead8).box(-6, 13, 1, 1, 13, 7).c(RED).box(-6, 14, 1, 1, 14, 7).box(-6, 13, 1, -6, 13, 7).c(NAVY).box(-2, 12, 8, -2, 13, 8);  // 一本书 + 书签
    return vox(ctx, g, 'seat').root;
  }
  reg({ id: 'seat', name: '窗边坐垫', layer: 'loft', face: 'n', build: buildSeat });

  // ---- 望远镜（看月亮、星星）：木三脚架 + 托盘（星图、目镜）+ 铜镜筒。镜筒在骨骼 'tube' 上（枢轴 = 叉架横轴）；
  //      整体朝南边小山墙窗（gableS，x −3..−2）转 YAW，镜筒仰 TILT，从窗口望海 ----
  const PY = 25, YAW = -1.05, TILT = 0.24;   // P5：镜筒低 1 格（1 格高以内）
  function buildScope(ctx) {
    const g = new V3.vox.Grid(25, 36, 39, { origin: [12, 0, 19] }), P = '小屋/阁楼/望远镜/';     // 镜筒比占地长：自建网格
    g.hx = 9; g.hz = 9;
    const legC = (x, y, z) => (y <= 1 ? BRASSD : hn(0x7a4a2a, 0x5e3820)(x, y, z));
    g.t(P + '三脚架').b(0);
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + k * 2 * Math.PI / 3, c = Math.cos(a), s = Math.sin(a);
      g.c(legC).tube([[9 * c, 0, 9 * s, 0.9], [2.4 * c, 21, 2.4 * s, 0.75]]);                       // 三条腿（脚上铜套）
      g.c(OAKD).tube([[4.2 * c, 9, 4.2 * s, 0.6], [6.4 * c, 9, 6.4 * s, 0.6]]);                      // 托盘撑臂
    }
    g.c(wood(OAK, OAKD, 0)).cyl(0, 0, 4.6, 9, 9).c(OAKD).fill(-5, 10, -5, 5, 10, 5, (x, y, z) => { const d = Math.hypot(x, z); return d > 3.7 && d <= 4.6; });
    g.c(OAKD).cyl(0, 0, 3.2, 21, 21).c(BRASS).cyl(0, 0, 2.4, 22, 22);                               // 云台
    g.c(BRASSD).box(-3, 23, -1, 3, 23, 1).box(-3, 24, 0, -3, PY + 1, 0).box(3, 24, 0, 3, PY + 1, 0);   // 叉架
    g.c(BLK).box(-4, PY, 0, -4, PY, 0).box(4, PY, 0, 4, PY, 0);                                      // 锁紧旋钮
    g.t(P + '星图').c((x, y, z) => (U.hash3(x, y, z) > 0.8 ? 0xf2d36b : NAVY)).box(-3, 10, -2, 1, 10, 2);
    g.c(BRASSL).box(2, 10, 1, 2, 11, 1).c(BLK).box(2, 12, 1, 2, 12, 1).c(BRASSD).box(2, 10, -2, 3, 10, -2);   // 两个目镜
    g.t(P + '镜筒').b(1);
    const ring = (z0, z1, r, col) => g.c(col).fill(-4, PY - 4, z0, 4, PY + 4, z1, (x, y) => x * x + (y - PY) * (y - PY) <= r * r);
    ring(-17, -16, 1.5, BLK); ring(-15, -12, 1.0, BRASSL); ring(-11, -9, 1.6, BRASSD);            // 目镜罩 / 目镜 / 调焦座
    ring(-8, 9, 2.3, (x, y, z) => (z === -8 || z === 0 || z === 1 || z === 9 ? BRASSD : hn(BRASS, BRASSL)(x, y, z)));
    ring(10, 15, 3.0, (x, y, z) => (z === 15 ? BRASSD : hn(BRASSL, BRASS)(x, y, z)));              // 遮光罩
    g.m('erase'); ring(14, 15, 2.05, 0); g.m('add');
    ring(13, 13, 2.05, (x, y) => (x === -1 && y === PY + 1 ? 0xdff1ff : GLASS));                    // 物镜（一点高光）
    g.c(BLK).box(-2, PY - 1, -10, -2, PY - 1, -10).box(2, PY - 1, -10, 2, PY - 1, -10);             // 调焦旋钮
    g.c(BRASSD).box(0, PY + 3, -4, 0, PY + 3, -4).box(0, PY + 3, 3, 0, PY + 3, 3).c(BLK).box(0, PY + 4, -6, 0, PY + 4, 5).c(GLASS).box(0, PY + 4, 6, 0, PY + 4, 6);   // 寻星镜
    const v = vox(ctx, g, 'scope', [{ name: 'root', pivot: [0, 0, 0] }, { name: 'tube', pivot: [0, PY + 0.5, 0], parent: 0 }]);
    const tube = v.root.getObjectByName('tube'); if (tube) tube.rotation.x = -TILT;
    v.root.rotation.y = YAW;                                     // buildAll 会改外层 rotation，所以朝向放在里层
    const w = new THREE.Group(); w.add(v.root); return w;
  }
  reg({ id: 'scope', name: '望远镜', layer: 'loft', build: buildScope });

  // ---- 储物箱 ×2（北边矮墙下；连上面的东西都 ≤ 0.7 m，碰不到斜屋顶）：铁箍包角的木海员箱（顶上一顶草帽）+ 藤编箱（顶上叠着被子）+ 中间立一卷草席 ----
  function buildChests(ctx) {
    const g = grid('chests', 'loft', 24), X = g.hx, Z = g.hz, P = '小屋/阁楼/储物箱/';
    const a0 = -X + 1, a1 = -6, b0 = 4, b1 = X - 3, am = (a0 + a1) >> 1, bm = (b0 + b1) >> 1;
    const CH = wood(0x9a6a3e, 0x6e4626, 0), IRON = (x, y) => (y % 3 === 0 ? 0x6a6a70 : 0x3a3a3e);
    g.t(P + '木箱').c(0x5e3b20);
    for (const x of [a0 + 1, a1 - 2]) for (const z of [-Z + 2, Z - 3]) g.box(x, 0, z, x + 1, 1, z + 1);   // 四个小脚
    g.c((x, y, z) => (y === 6 || y === 10 ? 0x5e3b20 : CH(x, y, z))).box(a0, 2, -Z + 1, a1, 13, Z - 1);  // 箱身：三块横板
    g.c(CH).box(a0 - 1, 14, -Z, a1 + 1, 15, Z).box(a0 - 1, 16, -Z + 1, a1 + 1, 16, Z - 1).box(a0, 17, -Z + 3, a1, 17, Z - 3);  // 拱形箱盖
    g.m('paint').c(IRON).box(a0 + 6, 2, -Z, a0 + 7, 17, Z).box(a1 - 7, 2, -Z, a1 - 6, 17, Z);        // 两道铁箍
    g.c(BRASSD).fill(a0, 2, -Z + 1, a1, 13, Z - 1, (x, y, z) => (y <= 3 || y >= 12) && (x <= a0 + 1 || x >= a1 - 1) && (z <= -Z + 2 || z >= Z - 2));  // 铜包角
    g.m('add').c(BRASS).box(am - 1, 11, Z, am + 1, 13, Z).c(BLK).box(am, 12, Z, am, 12, Z).c(BRASSD).box(am, 13, Z + 1, am, 15, Z + 1);  // 锁扣
    for (const x of [a0 - 1, a1 + 1]) {                                                               // 两侧绳把手（木耳 + 垂下的麻绳）
      g.c(0x5e3b20).box(x, 10, -4, x, 11, -3).box(x, 10, 3, x, 11, 4);
      g.c(0xd8c49a).box(x, 9, -3, x, 9, -3).box(x, 8, -2, x, 8, 2).box(x, 9, 3, x, 9, 3);
    }
    const weave = (x, y, z) => { const k = (((x + z + 64) >> 1) + (y >> 1)) & 1; return hn(k ? 0xd9b77a : 0xb08548, k ? 0xe6c88e : 0xa47a40)(x, y, z); };
    const wrap = (x, y, z) => ((x + y + z) & 1 ? 0x9a7240 : 0x7e5a30);
    g.t(P + '藤箱').c(0x8a6a3a).box(b0, 0, -Z + 2, b1, 1, Z - 2);
    g.c(weave).box(b0, 2, -Z + 2, b1, 12, Z - 2).c(wrap).box(b0, 13, -Z + 2, b1, 13, Z - 2);
    g.c(weave).box(b0 - 1, 14, -Z + 1, b1 + 1, 15, Z - 1);                                             // 盖子四周出 1 格
    g.m('paint').c(wrap).fill(b0 - 1, 14, -Z + 1, b1 + 1, 14, Z - 1, (x, y, z) => x === b0 - 1 || x === b1 + 1 || z === -Z + 1 || z === Z - 1);
    g.c(0x6b4428).box(bm, 15, Z - 4, bm, 15, Z - 1).m('add').box(bm, 13, Z, bm, 15, Z).box(bm, 10, Z - 1, bm, 13, Z - 1).c(OAKL).box(bm, 11, Z, bm, 11, Z);  // 皮扣 + 木栓
    for (const [x, d] of [[b0 - 1, -1], [b1 + 1, 1]]) g.c(wrap).box(x, 9, -3, x, 10, -3).box(x, 9, 3, x, 10, 3).box(x + d, 9, -3, x + d, 10, 3);   // 藤把手
    const STRAW = hn(0xe6cf94, 0xcfb06e), hx = am + 6;
    g.t(P + '小物').c(STRAW).cyl(hx, 0, 5.6, 18, 18).cyl(hx, 0, 2.7, 19, 20).cyl(hx, 0, 2.1, 21, 21);   // 草帽
    g.m('paint').c(NAVY).cyl(hx, 0, 2.7, 19, 19).box(hx + 2, 18, 3, hx + 2, 18, 5).m('add');              // 蓝丝带 + 飘带
    g.c(check(0x5b74b0, WHITE, 2)).rbox(b0 + 4, 16, -Z + 4, b1 - 6, 18, Z - 4, [1, 0, 1]);               // 叠好的蓝格子被子
    g.c(hn(CREAM, 0xe7dcc4)).rbox(b0 + 7, 19, -Z + 5, b1 - 10, 19, Z - 5, [1, 0, 1]);                     // 奶白小毯
    g.c((x, y, z) => (y === 21 ? (Math.round(Math.hypot(x + 1, z + 5)) & 1 ? 0xc4a36a : 0xe6cf94) : y === 4 || y === 17 ? NAVY : y % 6 === 2 ? 0x6f9e6a : STRAW(x, y, z)))
      .cyl(-1, -5, 2.1, 0, 21);                                                                                // 立着的一卷草席
    return vox(ctx, g, 'chests').root;
  }
  reg({ id: 'chests', name: '储物箱', layer: 'loft', build: buildChests });
})(window.V3);
