// 19-mcentity.js — 箱子和床的真模型（照 MC 26.1.2 的 ChestModel / BedRenderer 的尺寸和 UV 自己写；贴图从玩家的 jar 读）
// 纯 JS，不碰页面和 three.js。出处和数值说明见 docs/MC-RENDER.md 和 tmp/mc-render/NOTES-entity.md。
(function (V3) {
  'use strict';
  const E = V3.mcentity = {};

  // ---- 3×4 仿射矩阵 [a b c tx; d e f ty; g h i tz]，按行存 ----
  const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const mul = (A, B) => {
    const r = new Array(12);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) r[i * 4 + j] = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j];
      r[i * 4 + 3] = A[i * 4] * B[3] + A[i * 4 + 1] * B[7] + A[i * 4 + 2] * B[11] + A[i * 4 + 3];
    }
    return r;
  };
  const T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
  // 90° 的倍数时 sin/cos 取整，避免 6e-17 这种误差
  const sc = (rad) => {
    let s = Math.sin(rad), c = Math.cos(rad);
    if (Math.abs(s - Math.round(s)) < 1e-9) s = Math.round(s);
    if (Math.abs(c - Math.round(c)) < 1e-9) c = Math.round(c);
    return [s, c];
  };
  // 右手定则绕 +X / +Y / +Z 转（和 JOML、MC 的 Axis.XP/YP/ZP 一样）
  const RX = (rad) => { const [s, c] = sc(rad); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; };
  const RY = (rad) => { const [s, c] = sc(rad); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; };
  const RZ = (rad) => { const [s, c] = sc(rad); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; };
  const around = (R, px, py, pz) => mul(T(px, py, pz), mul(R, T(-px, -py, -pz)));
  const app = (M, x, y, z) => [
    M[0] * x + M[1] * y + M[2] * z + M[3],
    M[4] * x + M[5] * y + M[6] * z + M[7],
    M[8] * x + M[9] * y + M[10] * z + M[11],
  ];
  const dirOf = (M, n) => [M[0] * n[0] + M[1] * n[1] + M[2] * n[2], M[4] * n[0] + M[5] * n[1] + M[6] * n[2], M[8] * n[0] + M[9] * n[1] + M[10] * n[2]];
  E.mat = { I, mul, T, RX, RY, RZ, around, app };

  // 方向编号和 15-mcmodel.js 一样：0 down 1 up 2 north 3 south 4 west 5 east
  const NRM = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  const nearest = (v) => {
    let best = 0, bd = -2;
    for (let d = 0; d < 6; d++) { const t = v[0] * NRM[d][0] + v[1] * NRM[d][1] + v[2] * NRM[d][2]; if (t > bd) { bd = t; best = d; } }
    return best;
  };
  E.nearest = nearest;

  // 实体的两盏方向光（Lighting.java:19-20，主世界 LEVEL）和 light.glsl 的混合：min(1, (max(0,L0·n)+max(0,L1·n))·0.6 + 0.4)
  const nz3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const L0 = nz3([0.2, 1, -0.7]), L1 = nz3([-0.2, 1, 0.7]);
  E.diffuse = (n) => Math.min(1, (Math.max(0, L0[0] * n[0] + L0[1] * n[1] + L0[2] * n[2]) + Math.max(0, L1[0] * n[0] + L1[1] * n[1] + L1[2] * n[2])) * 0.6 + 0.4);

  // ---- ModelPart.Cube：8 个角、6 个面的顶点顺序和 UV（ModelPart.java:243-324，mirror 都是 false） ----
  // 面：[方向编号, 角的序号, UV 矩形取哪几个值]；角 t0..t3 = 0..3（minZ），l0..l3 = 4..7（maxZ）
  const FACES = [
    [0, [5, 4, 0, 1], 'u1 v0 u2 v1'],   // DOWN  [l1,l0,t0,t1]
    [1, [2, 3, 7, 6], 'u2 v1 u22 v0'],  // UP    [t2,t3,l3,l2]
    [4, [0, 4, 7, 3], 'u0 v1 u1 v2'],   // WEST  [t0,l0,l3,t3]
    [2, [1, 0, 3, 2], 'u1 v1 u2 v2'],   // NORTH [t1,t0,t3,t2]
    [5, [5, 1, 2, 6], 'u2 v1 u3 v2'],   // EAST  [l1,t1,t2,l2]
    [3, [4, 5, 6, 7], 'u3 v1 u4 v2'],   // SOUTH [l0,l1,l2,l3]
  ];
  // box: {tex:[xo,yo], at:[x,y,z], size:[w,h,d], hide:方向编号或 -1}（单位 1/16）
  E.cubeFaces = function (box) {
    const [xo, yo] = box.tex, [x0, y0, z0] = box.at, [w, h, d] = box.size;
    const x1 = x0 + w, y1 = y0 + h, z1 = z0 + d;
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const U = { u0: xo, u1: xo + d, u2: xo + d + w, u22: xo + d + w + w, u3: xo + d + w + d, u4: xo + d + w + d + w, v0: yo, v1: yo + d, v2: yo + d + h };
    const out = [];
    for (const [dir, idx, uvs] of FACES) {
      if (dir === box.hide) continue;
      const [a, b, c, e] = uvs.split(' ').map((k) => U[k]);
      // Polygon：v0 = (ub, va)，v1 = (ua, va)，v2 = (ua, vb)，v3 = (ub, vb)
      out.push({ dir, pos: idx.map((i) => P[i]), uv: [[c, b], [a, b], [a, e], [c, e]] });
    }
    return out;
  };

  // ---- 零件（ChestModel.java:31-66，BedRenderer.java:65-100；单位 1/16，Y 朝上；hide = 不画的那面） ----
  const D = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };
  const chestParts = (wb, xb, xl, lw, hide) => [
    { tex: [0, 19], at: [xb, 0, 1], size: [wb, 10, 14], hide, pose: [0, 0, 0] },
    { tex: [0, 0], at: [xb, 0, 0], size: [wb, 5, 14], hide, pose: [0, 9, 1] },
    { tex: [0, 0], at: [xl, -2, 14], size: [lw, 4, 1], hide, pose: [0, 9, 1] },
  ];
  E.PARTS = {
    chest: chestParts(14, 1, 7, 2, -1),
    chest_right: chestParts(15, 1, 15, 1, D.east),
    chest_left: chestParts(15, 0, 0, 1, D.west),
    bed_head: [
      { tex: [0, 0], at: [0, 0, 0], size: [16, 16, 6], hide: D.up, pose: [0, 0, 0] },
      { tex: [50, 6], at: [0, 6, 0], size: [3, 3, 3], hide: D.down, pose: [0, 0, 0], rot: [Math.PI / 2, 0, Math.PI / 2] },
      { tex: [50, 18], at: [-16, 6, 0], size: [3, 3, 3], hide: D.down, pose: [0, 0, 0], rot: [Math.PI / 2, 0, Math.PI] },
    ],
    bed_foot: [
      { tex: [0, 22], at: [0, 0, 0], size: [16, 16, 6], hide: D.down, pose: [0, 0, 0] },
      { tex: [50, 0], at: [0, 6, -16], size: [3, 3, 3], hide: D.down, pose: [0, 0, 0], rot: [Math.PI / 2, 0, 0] },
      { tex: [50, 12], at: [-16, 6, -16], size: [3, 3, 3], hide: D.down, pose: [0, 0, 0], rot: [Math.PI / 2, 0, Math.PI * 3 / 2] },
    ],
  };
  // facing → Direction.toYRot()（south 0, west 90, north 180, east 270）
  const YROT = { south: 0, west: 90, north: 180, east: 270 };
  const RAD = Math.PI / 180;
  // ChestRenderer：rotationAround(YP(−yRot), 0.5, 0, 0.5)
  E.chestTransform = (facing) => around(RY(-(YROT[facing] || 0) * RAD), 0.5, 0, 0.5);
  // BedRenderer：translation(0, 0.5625, 0) · rotate(XP 90°) · rotateAround(ZP(180° + yRot), 0.5, 0.5, 0.5)
  E.bedTransform = (facing) => mul(T(0, 0.5625, 0), mul(RX(90 * RAD), around(RZ((180 + (YROT[facing] || 0)) * RAD), 0.5, 0.5, 0.5)));

  // ModelPart：translate(pose/16) → rotationZYX(z, y, x)（= Rz·Ry·Rx）→ 顶点 /16
  const partMatrix = (p) => {
    let M = T(p.pose[0] / 16, p.pose[1] / 16, p.pose[2] / 16);
    if (p.rot) M = mul(M, mul(RZ(p.rot[2]), mul(RY(p.rot[1]), RX(p.rot[0]))));
    return M;
  };
  const clean = (v) => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };

  // 把零件烤成四边形：格内坐标 0..1，uv 是贴图里 0..1（v 朝下），格式和 15-mcmodel.js 的 quad 一样（多一个 light）
  E.bake = function (parts, model, sprite, texW = 64, texH = 64) {
    const quads = [];
    for (const p of parts) {
      const M = mul(model, partMatrix(p));
      for (const f of E.cubeFaces(p)) {
        const pos = new Float32Array(12), uv = new Float32Array(8);
        let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
        for (let k = 0; k < 4; k++) {
          const w = app(M, f.pos[k][0] / 16, f.pos[k][1] / 16, f.pos[k][2] / 16);
          pos[k * 3] = clean(w[0]); pos[k * 3 + 1] = clean(w[1]); pos[k * 3 + 2] = clean(w[2]);
          const u = f.uv[k][0] / texW, v = f.uv[k][1] / texH;
          uv[k * 2] = u; uv[k * 2 + 1] = v;
          u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v);
        }
        const n = dirOf(M, NRM[f.dir]);
        quads.push({ pos, uv, sprite, force: false, tint: -1, shade: false, emit: 0, ao: false, dir: nearest(n), cull: -1,
          uvRect: [u0, v0, u1, v1], rotated: false, light: E.diffuse(n), entity: true });
      }
    }
    return quads;
  };

  // ---- 方块状态 → 用哪个模型、哪张贴图（ChestRenderer / Sheets / BedRenderer） ----
  const COPPER = /^(waxed_)?(exposed_|weathered_|oxidized_)?copper_chest$/;
  const DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  const STEP = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
  const CW = { north: 'east', east: 'south', south: 'west', west: 'north' };
  const OPP = { north: 'south', south: 'north', west: 'east', east: 'west' };
  E.chestPrefix = (id) => {
    if (id === 'chest') return 'normal';
    if (id === 'trapped_chest') return 'trapped';
    if (id === 'ender_chest') return 'ender';
    const m = COPPER.exec(id);  // 打蜡的和不打蜡的用同一张贴图
    return m ? 'copper' + (m[2] ? '_' + m[2].slice(0, -1) : '') : null;
  };
  // 返回 {kind, layout, sprite, transform, partner:[dx,dz]|null, cutout} 或 null（不是箱子/床）。
  // partner = 大箱子另一半 / 床另一半所在的格（ChestBlock.getConnectedDirection：left 顺时针，right 逆时针；床：脚朝 facing，头朝反方向）。
  E.spec = function (st) {
    if (!st || st.ns !== 'minecraft') return null;
    const p = st.props || {};
    const facing = STEP[p.facing] ? p.facing : 'north';
    const pre = E.chestPrefix(st.id);
    if (pre) {
      const side = pre !== 'ender' && (p.type === 'left' || p.type === 'right') ? p.type : 'single';
      const conn = side === 'left' ? CW[facing] : side === 'right' ? OPP[CW[facing]] : null;
      return { kind: 'chest', layout: side === 'single' ? 'chest' : 'chest_' + side,
        sprite: 'minecraft:entity/chest/' + pre + (side === 'single' ? '' : '_' + side),
        transform: E.chestTransform(facing), partner: conn ? STEP[conn] : null, cutout: true };
    }
    const m = /^([a-z_]+)_bed$/.exec(st.id);
    if (m && DYES.includes(m[1])) {
      const head = p.part === 'head';
      return { kind: 'bed', layout: head ? 'bed_head' : 'bed_foot', sprite: 'minecraft:entity/bed/' + m[1],
        transform: E.bedTransform(facing), partner: STEP[head ? OPP[facing] : facing], cutout: false };
    }
    return null;
  };
  const cache = new Map();
  // 同一个状态只烤一次（返回的 quads 是共用的，别改）
  E.forState = function (st) {
    const sp = E.spec(st);
    if (!sp) return null;
    const key = sp.layout + '|' + sp.sprite + '|' + (st.props && st.props.facing);
    if (!cache.has(key)) cache.set(key, Object.assign({}, sp, { quads: E.bake(E.PARTS[sp.layout], sp.transform, sp.sprite) }));
    return cache.get(key);
  };
})(window.V3);
