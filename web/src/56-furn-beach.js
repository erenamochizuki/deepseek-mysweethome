// 56-furn-beach.js — 沙滩休闲角（场景部件 furn-beach，order 53，layer 'site'）
// 两张沙滩躺椅（面朝南边的海）+ 条纹遮阳伞（微微倾斜，跟着 V3.env.state.wind 轻轻晃）+ 白色独脚小圆桌（柠檬汁、高脚杯鸡尾酒）。
// 位置：layout outside 的 beachSet（-11.6, 3.4）–（-6.8, 6.6），beach 已把这块地压平；高度用 V3.terrain.groundY。
// 体素工具用 V3.furn（56-furn-ground.js，排在本文件后面加载，所以只在 build 里取）。
(function (V3) {
  const ROOT = '场地/沙滩休闲角', U = V3.util, S = 1 / 32;
  const NAVY = 0x34497a, CREAM = 0xf3ecdc, WHITE = 0xf7f5ef, RED = 0xd8503c, PINK = 0xf08aa8, YEL = 0xf6d55a;
  const TEAK = 0xd9a46a, TEAKD = 0xa8743f, GLASS_C = 0xdff3f2;
  const gy = (x, z) => (V3.terrain && V3.terrain.groundY ? V3.terrain.groundY(x, z) : 0);
  let F = null;

  // 躺椅：前方 = +z（脚朝海），头在 -z；靠背单独一块网格，绕铰链抬起 35°。kind 0 带毛巾 + 人字拖，kind 1 带草帽 + 书
  function buildLounger(ctx, id, kind) {
    const P = ROOT + '/沙滩椅' + (kind + 1) + '/', g = new V3.vox.Grid(29, 26, 67, { origin: [14, 0, 33] });
    const oakY = F.wood(TEAK, TEAKD, 1), oakZ = F.wood(TEAK, TEAKD, 2), oakX = F.wood(TEAK, TEAKD, 0);
    const stripe = (x) => ((x + 64) % 6 < 3 ? NAVY : CREAM);                      // 3 格一条，顺着躺椅长边
    g.t(P + '椅架').c(oakY);
    for (const x of [-9, 8]) for (const z of [-29, 28]) g.box(x, 0, z, x + 1, 7, z + 1);   // 四条腿
    g.c(oakZ).box(-9, 8, -30, -8, 9, 29).box(8, 8, -30, 9, 9, 29);                       // 两条长边
    g.c(oakX).box(-7, 8, -30, 7, 9, -29).box(-7, 8, 28, 7, 9, 29)                         // 头尾横档
      .box(-7, 8, -10, 7, 9, 27).box(-7, 8, -20, 7, 9, -19);                              // 座板 + 撑脚下的横档
    g.c(oakY).box(-6, 10, -20, -5, 16, -19).box(5, 10, -20, 6, 16, -19);                  // 撑起靠背的两根撑脚
    g.t(P + '坐垫').c(stripe).rbox(-8, 10, -10, 8, 12, 27, [1, 1, 0]);
    if (kind === 0) {
      const tw = (x) => ((x + 64) % 4 < 2 ? PINK : YEL);
      g.t(P + '毛巾').c(tw).rbox(-7, 13, 16, 7, 14, 27, [1, 0, 1]).box(-7, 10, 28, 7, 14, 28);   // 叠好搭在脚那头
      g.t(P + '人字拖').c(PINK).box(-14, 0, 5, -13, 0, 11).box(-11, 0, 7, -10, 0, 13)
        .c(WHITE).box(-14, 1, 7, -13, 1, 7).box(-11, 1, 9, -10, 1, 9);
    } else {
      const straw = (x, y, z) => (U.hash3(x, y, z) < 0.3 ? 0xd8b56e : 0xe8c98a);
      g.t(P + '草帽').c(straw).cyl(3, 18, 4.6, 13, 13).c(NAVY).cyl(3, 18, 2.8, 14, 14).c(straw).cyl(3, 18, 2.6, 15, 16);
      g.t(P + '书').c((x) => (x === -2 ? 0xf4f1ea : 0xc8503c)).box(-6, 13, 3, -2, 13, 9);
    }
    const gb = new V3.vox.Grid(19, 9, 24, { origin: [9, 0, 22] });
    gb.t(P + '靠背').c(oakZ).box(-8, 0, -20, 8, 1, -1);                                    // 靠背板
    gb.c(stripe).rbox(-8, 2, -20, 8, 4, -1, [1, 1, 0]);                                   // 靠背垫
    gb.c(WHITE).rbox(-6, 5, -20, 6, 7, -15, 1);                                           // 白枕头
    const v = F.vox(ctx, g, id, null, { dMax: 1e-4 }), vb = F.vox(ctx, gb, id + 'Back', null, { dMax: -1 });   // 靠背抬起后底面朝外，不能删
    const hinge = new THREE.Group(); hinge.name = 'lounger-back';
    hinge.position.set(0, 10 * S, -10 * S); hinge.rotation.x = 0.6; hinge.add(vb.root); v.root.add(hinge);
    return v.root;
  }

  // 遮阳伞（1/16 m 一格）：木杆 + 六层台阶式伞面（红白相间 8 片）+ 波浪垂边；原点在插进沙里的杆脚
  function buildParasol(ctx) {
    const P = ROOT + '/遮阳伞/', g = new V3.vox.Grid(43, 41, 43, { origin: [21, 0, 21] });
    g.t(P + '伞杆').c(0xe8d6a8).cyl(0, 0, 1.6, 0, 0);                                     // 杆脚的小沙堆
    g.c(F.wood(0xc89a64, 0x9a6c3c, 1)).box(0, 0, 0, 0, 37, 0).c(0x9a6c3c).box(0, 38, 0, 0, 38, 0);
    g.c(0xb9c0c7).cyl(0, 0, 1, 18, 18);                                                   // 杆中间的金属接头
    const gore = (x, y, z) => (Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI / 4)) % 2 ? WHITE : RED);
    g.t(P + '伞面').c(gore);
    for (const [y, r] of [[32, 20], [33, 17.5], [34, 14.5], [35, 11], [36, 7], [37, 3]]) g.cyl(0, 0, r, y, y);
    g.fill(-21, 30, -21, 21, 31, 21, (x, y, z) => {                                       // 每片中间垂得深一点
      const r = Math.hypot(x, z), a = (Math.atan2(z, x) + Math.PI) / (Math.PI / 4), f = a - Math.floor(a);
      return r > 18.6 && r <= 20.4 && y >= 32 - (1 + Math.round(Math.sin(f * Math.PI)));
    });
    return F.vox(ctx, g, 'parasol', null, { scale: 1 / 16, noise: 0.02, dMax: 1e-4 });
  }

  // 白色独脚小圆桌（1/32 m）：圆底座 + 细柱 + 圆桌面（顶面 18 格 ≈ 0.56 m）
  function buildTable(ctx) {
    const P = ROOT + '/小圆桌/', g = new V3.vox.Grid(19, 19, 19, { origin: [9, 0, 9] });
    const wh = (x, y, z) => (U.hash3(x, y, z) < 0.25 ? 0xeceae2 : WHITE);
    g.t(P + '桌子').c(wh).cyl(0, 0, 5.2, 0, 0).cyl(0, 0, 3.2, 1, 1).cyl(0, 0, 1.2, 2, 14).cyl(0, 0, 2.6, 15, 15)
      .cyl(0, 0, 8.4, 17, 17).c(0xdedbd2).cyl(0, 0, 8.4, 16, 16);                        // 底座、细柱、托盘、桌面（下沿一圈略暗）
    return F.vox(ctx, g, 'beachTable', null, { dMax: 1e-4 }).root;
  }

  // 饮料（1/128 m 一格）：玻璃单独一根骨骼 'glass'，换成半透明材质；里面的果汁/酒、冰块、柠檬片、吸管、樱桃、小伞不透明
  const GB = [{ name: 'root', pivot: [0, 0, 0] }, { name: 'glass', pivot: [0, 0, 0], parent: 0 }];
  function glassify(ctx, v) {
    const m = v.meshes.find((q) => q.name === 'vox:glass'); if (!m) return;
    const gm = ctx._beachGlass || (ctx._beachGlass = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0, depthWrite: false }));
    m.material = Array.isArray(m.material) ? m.material.map(() => gm) : gm;
    m.castShadow = false; m.userData.noShadow = true; m.renderOrder = 2;
  }
  const DRINK = { scale: 1 / 128, noise: 0, ao: 0, dMax: 1e-4 };                          // 透明杯子不需要 AO，关掉后面片能合并，省三角
  function buildLemonade(ctx) {                                                           // 柠檬汁：直身杯 + 冰块 + 杯沿柠檬片 + 红白吸管
    const P = ROOT + '/柠檬汁/', g = new V3.vox.Grid(17, 24, 17, { origin: [8, 0, 8] });
    g.b(1).t(P + '杯子').c(GLASS_C).cyl(0, 0, 4.6, 0, 1)
      .fill(-5, 2, -5, 5, 14, 5, (x, y, z) => { const r = Math.hypot(x, z); return r <= 4.6 && r > 3.6; }).b(0);
    g.t(P + '果汁').c((x, y, z) => (U.hash3(x, y, z) < 0.2 ? 0xf7e27a : 0xf3d65a)).cyl(0, 0, 3.6, 2, 11);
    g.c(0xeef8fb).box(-2, 9, -1, 0, 11, 1).box(1, 10, 0, 2, 12, 2);                       // 两块冰（一块露出水面）
    g.t(P + '柠檬片').c((x, y) => { const r = Math.hypot(x - 4, y - 14); return r > 2.4 ? 0xe8c62a : r < 0.8 ? 0xfff6c8 : 0xfbe98a; })
      .fill(1, 11, 0, 7, 17, 0, (x, y) => Math.hypot(x - 4, y - 14) <= 3.2);              // 卡在杯沿上
    g.t(P + '吸管').c((x, y) => (Math.floor(y / 2) % 2 ? 0xd8503c : WHITE)).tube([[-1.5, 3, -1, 0.7], [-2.4, 20, -3.4, 0.7]]);
    const v = F.vox(ctx, g, 'lemonade', GB, DRINK); glassify(ctx, v); return v.root;
  }
  function buildCocktail(ctx) {                                                           // 高脚杯：杯脚 + 细杆 + 张开的杯身，龙舌兰日出的渐变，樱桃 + 小纸伞
    const P = ROOT + '/鸡尾酒/', g = new V3.vox.Grid(17, 30, 17, { origin: [8, 0, 8] });
    const R = (y) => 1.5 + (y - 9) * 0.55;
    g.b(1).t(P + '杯子').c(GLASS_C).cyl(0, 0, 3.4, 0, 0).box(0, 1, 0, 0, 9, 0)
      .fill(-6, 9, -6, 6, 17, 6, (x, y, z) => { const r = Math.hypot(x, z); return r <= R(y) && (r > R(y) - 1.1 || y === 9); }).b(0);
    const SUN = [0xd8402c, 0xe85a2c, 0xf07a30, 0xf59a36, 0xf8b444, 0xfac04a];
    g.t(P + '酒').c((x, y) => SUN[Math.max(0, Math.min(5, y - 10))]).fill(-6, 10, -6, 6, 15, 6, (x, y, z) => Math.hypot(x, z) <= R(y) - 1.1);
    g.t(P + '樱桃').c(0xc8203a).ell(2.6, 16.5, 1.6, 1.3, 1.3, 1.3).c(0x3f6a2a).tube([[2.6, 17.5, 1.6, 0.4], [3.4, 19.5, 2.0, 0.4]]);
    const ub = (x, y, z) => [PINK, YEL, 0x7fd0bb][(Math.floor((Math.atan2(z + 2.4, x + 3.8) + Math.PI) / (Math.PI / 3)) % 3 + 3) % 3];
    g.t(P + '小伞').c(0xd9b07a).tube([[-1, 13, -0.5, 0.4], [-3.8, 25, -2.4, 0.4]])
      .c(ub).fill(-8, 24, -7, 1, 27, 2, (x, y, z) => Math.hypot(x + 3.8, z + 2.4) <= 3.8 - (y - 24) * 1.2);
    const v = F.vox(ctx, g, 'cocktail', GB, DRINK); glassify(ctx, v); return v.root;
  }

  V3.scene.part({
    id: 'furn-beach', label: '沙滩休闲角', order: 53,
    build(ctx) {
      F = V3.furn; if (!F || !F.vox) { V3.err('furn-beach: V3.furn 未加载'); return null; }
      // P5 第 3 轮：4 件都是模组方块（布局 beachSet.blocks）。游戏场景里躺椅、小圆桌（连饮料）不画，54-house-mc 画方块；
      // 遮阳伞整件照画体素版（随风晃），挪到方块那格、不斜（和 MC 里一样，伞杆正好在碰撞的位置）。工作台（ctx.studio）照旧
      const FM = V3.furnMc, keepOf = (id) => (FM && FM.webKeep ? FM.webKeep(ctx, 'xiaojingyu:' + id) : undefined);
      const kA = keepOf('beach_lounger'), kB = keepOf('beach_lounger_hat'), kT = keepOf('beach_table'), kP = keepOf('beach_parasol');
      const LB = { 沙滩椅1: ['沙滩椅（左）', kA], 沙滩椅2: ['沙滩椅（右）', kB], 遮阳伞: ['条纹遮阳伞', kP], 小圆桌: ['白色独脚小圆桌', kT], 柠檬汁: ['柠檬汁', kT], 鸡尾酒: ['高脚杯鸡尾酒', kT] };
      const labels = { [ROOT]: '沙滩休闲角' };
      for (const k in LB) if (LB[k][1] !== null) labels[ROOT + '/' + k] = LB[k][0];
      V3.parts.declare(Object.keys(labels), labels);
      const root = new THREE.Group(); root.name = 'furn-beach'; root.userData.layer = 'site';
      const cx = -9.2;
      const put = (o, x, z, yaw, name, k) => { o.position.set(x, gy(x, z), z); o.rotation.y = yaw; o.name = 'furn:' + name; if (k) FM.prune(o, k); root.add(o); return o; };
      if (kA !== null) put(buildLounger(ctx, 'loungerA', 0), cx - 0.62, 5.0, 0.06, 'loungerA', kA);
      if (kB !== null) put(buildLounger(ctx, 'loungerB', 1), cx + 0.62, 5.0, -0.06, 'loungerB', kB);
      if (kT !== null) {
        const tb = buildTable(ctx), lem = buildLemonade(ctx), ck = buildCocktail(ctx);
        lem.position.set(-3.5 * S, 18 * S, 1.5 * S); ck.position.set(3.5 * S, 18 * S, -1.5 * S);
        lem.name = 'furn:lemonade'; ck.name = 'furn:cocktail'; tb.add(lem, ck);
        put(tb, cx, 4.05, 0, 'beachTable', kT);
      }
      ctx._beachSway = [];
      if (kP === null) return root;
      const fp = kP && FM.byBlock('xiaojingyu:beach_parasol'), hp = fp && fp.house, HB = V3.houseBlocks;
      // 一把伞：base 在脚底（场景里），tilt 斜一点（只有布局版），sway 跟着风晃
      const one = (x, y, z, yaw, tiltOn, cell) => {
        const base = new THREE.Group(), tilt = new THREE.Group(), sway = new THREE.Group();
        put(base, x, z, yaw, 'parasol'); if (y != null) base.position.y = y;
        if (tiltOn) tilt.rotation.set(0.1, 0, 0.05);                                     // 往海那边、往西微微斜
        if (cell) base.userData.cell = cell.slice();
        base.add(tilt); tilt.add(sway);
        const entry = { sway, axis: new THREE.Vector3() }, instances = ctx._beachSway;
        instances.push(entry);
        if (!HB?.meshFor) { sway.add(buildParasol(ctx).root); return; }
        const spec = FM.byId('beach_parasol');
        const cells = FM.cellsFor(spec, spec.facing).map(({ part, offset }) => ({ pos: offset, state: FM.state(spec, spec.facing, part) }));
        HB.meshFor(cells).then(mesh => {
          if (ctx.dead || ctx._beachSway !== instances) { HB.disposeGroup(mesh); return; }
          const offset = tiltOn ? -0.5 : -0.5 + 1 / 64;
          mesh.position.set(offset, 0, offset);
          mesh.traverse(object => { if (object.isMesh) object.userData.anchor = 'furn:parasol'; });
          entry.mesh = mesh; sway.add(mesh); ctx.recut?.();
        }).catch(error => { if (!ctx.dead) V3.err('beach_parasol: ' + error); });
      };
      if (hp && HB && HB.whenGrid) {
        // 方块版：房子里每把遮阳伞（主格 = 伞柱最下面那格）一份，原点和 MC 模型一样（格子中心往西北偏 1/64 米，随 facing 转），脚底 = 方块底；没有就不画
        const home = [hp.xs[0] + 0.5 - 1 / 64, hp.ys[0], hp.zs[0] + 0.5 - 1 / 64], my = ctx._beachSway;
        HB.whenGrid(ctx, () => {
          if (ctx._beachSway !== my) return;
          for (const p of HB.furnPlaced(fp.block)) {
            if (!p.mv) continue;
            const q = p.mv.same ? home : p.mv.point(home);
            one(q[0], q[1], q[2], p.mv.yaw(0), false, p.cell);
          }
        });
      } else if (hp) one(hp.xs[0] + 0.5 - 1 / 64, hp.ys[0], hp.zs[0] + 0.5 - 1 / 64, 0, false);
      else one(cx, null, 4.75, 0, true);
      return root;
    },
    update(dt, t, ctx) {                                                                  // 伞跟着风轻轻晃：没风时也有一点点
      const list = ctx && ctx._beachSway; if (!list || !list.length) return;
      const w = (V3.env && V3.env.state && V3.env.state.wind) || null;
      const sp = w ? Math.min(1, (w.speed || 0) + (w.gust || 0) * 0.5) : 0, d = (w && w.dir) || [0.6, 0.8];
      const l = Math.hypot(d[0], d[1]) || 1;
      const ang = 0.012 + 0.03 * sp * (0.6 + 0.4 * Math.sin(t * 1.3)) + 0.02 * sp * Math.sin(t * 3.7 + 0.8) + 0.01 * Math.sin(t * 0.9);
      for (const s of list) {                                                             // 风是场景里的方向：转过的伞先把轴转到自己的坐标里
        const ry = s.sway.parent && s.sway.parent.parent ? s.sway.parent.parent.rotation.y : 0, c = Math.cos(ry), sn = Math.sin(ry);
        const ax = d[1] / l, az = -d[0] / l;
        s.axis.set(c * ax - sn * az, 0, sn * ax + c * az); s.sway.quaternion.setFromAxisAngle(s.axis, ang);
      }
    },
    dispose(ctx) {
      for (const entry of ctx._beachSway || []) if (entry.mesh) {
        entry.mesh.removeFromParent(); V3.houseBlocks.disposeGroup(entry.mesh);
      }
      ctx._beachSway = null;
    },
  });
})(window.V3);
