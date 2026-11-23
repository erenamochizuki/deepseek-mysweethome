// src/59-sealife.js — owner: engine。场景部件 sealife（order 70）：海带、珊瑚、鱼、海星 / 小石头、小螃蟹。
// 全部摆在海床 / 礁石上（高度取 V3.terrain.seabedY / groundY）；水面和海水切面是 53-water 的事，这里不管。
// 体素一律 1/32 m（SPEC-3 §2：32 px/m）；海带用图集 kelp / kelpTop 贴图做交叉面片（同样 32 px/m）。
// 每一丛 / 每一类一个网格、一个分组（= 一次绘制），userData.anchor 唯一（sealife:coral3 …），反馈工具能点到。
// 预算：≤40k 三角形、≤20 次绘制、不加灯；随机只用 ctx.rng / V3.util.hash3。
(function (V3) {
  'use strict';
  const U = V3.util, S32 = 1 / 32, SEA = -0.15, TAU = Math.PI * 2;
  const LABELS = {
    '海/海带': '海带', '海/珊瑚': '珊瑚', '海/鱼': '远礁鱼群', '海/海星': '海星', '海/石头': '海底小石头',
    '场地/螃蟹': '小螃蟹（住在东礁石北边的洞里）',
  };
  // 模块 { id, build(ctx, S) -> Object3D[], update?(dt, t, ctx), dispose?() }；S = 模块间共享的数据（珊瑚位置等）
  const MODS = [];
  let VMAT = null;                                   // 体素共用材质（userData.shared：换模型时不释放）
  const vmat = () => {
    if (!VMAT) { VMAT = V3.vox.material({ roughness: 0.78 }); VMAT.name = 'sealife:vox'; VMAT.userData.shared = true; }
    return VMAT;
  };

  // ---- 地形查询 ----
  const bedY = (x, z) => V3.terrain.seabedY(x, z), topY = (x, z) => V3.terrain.groundY(x, z);
  const inSite = (x, z, m) => { const S = V3.layout.site; return x > S.x0 + m && x < S.x1 - m && z > S.z0 + m && z < S.z1 - m; };
  // 脚下平整：中心和半径 r 圆周上 8 个点的高度一样（fn = topY / bedY），返回高度；不平返回 NaN
  function flat(fn, x, z, r) {
    const h = fn(x, z);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; if (Math.abs(fn(x + Math.cos(a) * r, z + Math.sin(a) * r) - h) > 0.01) return NaN; }
    return h;
  }
  // 从 (x, z) 一圈圈往外找（步长 0.25 m，最远 R m）满足 ok(x, z) 的点；找不到返回 null（确定性，不用随机数）
  function spot(x, z, ok, R = 3) {
    if (ok(x, z)) return [x, z];
    for (let r = 0.25; r <= R + 1e-6; r += 0.25) {
      const n = Math.max(8, Math.round(TAU * r / 0.25));
      for (let i = 0; i < n; i++) { const a = i / n * TAU, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (ok(px, pz)) return [px, pz]; }
    }
    return null;
  }
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  // ---- V3.vox 网格 → 一个几何体（所有骨骼 / 标签并成一组），可平移 / 绕 y 转；drop(ny, y) 为真的三角形去掉（埋进海床的底面） ----
  // list: [{ g, x, y, z, ry, bones, noise, ao }]；返回 { geo, ranges: [{ item, bone, v, nv }] }（螃蟹按骨骼的顶点范围做 CPU 动画）
  function merge(list, drop) {
    const ms = list.map(it => V3.vox.mesh(it.g, { scale: S32, noise: it.noise ?? 0.07, ao: it.ao ?? 0.55, bones: it.bones }));
    let nv = 0, ni = 0;
    for (const a of ms) for (const m of a) { nv += m.geometry.attributes.position.count; ni += m.geometry.index.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), ranges = [];
    let v = 0, k = 0;
    list.forEach((it, li) => {
      const c = Math.cos(it.ry || 0), s = Math.sin(it.ry || 0), tx = it.x || 0, ty = it.y || 0, tz = it.z || 0;
      for (const m of ms[li]) {
        const g = m.geometry, p = g.attributes.position.array, n = g.attributes.normal.array, cl = g.attributes.color.array, ix = g.index.array, v0 = v;
        for (let j = 0; j < p.length; j += 3, v++) {
          const q = v * 3;
          P[q] = tx + p[j] * c + p[j + 2] * s; P[q + 1] = ty + p[j + 1]; P[q + 2] = tz - p[j] * s + p[j + 2] * c;
          N[q] = n[j] * c + n[j + 2] * s; N[q + 1] = n[j + 1]; N[q + 2] = -n[j] * s + n[j + 2] * c;
          C[q] = cl[j]; C[q + 1] = cl[j + 1]; C[q + 2] = cl[j + 2];
        }
        for (let j = 0; j < ix.length; j += 3) {
          const a = ix[j] * 3;
          if (drop && drop(n[a + 1], p[a + 1])) continue;
          I[k++] = v0 + ix[j]; I[k++] = v0 + ix[j + 1]; I[k++] = v0 + ix[j + 2];
        }
        ranges.push({ item: li, bone: m.bone, v: v0, nv: v - v0 });
        g.dispose();
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.setIndex(new THREE.BufferAttribute(I.slice(0, k), 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return { geo, ranges };
  }
  // 网格 → 部件：一个分组 = 一次绘制；faceTags / triTag / anchor 和 03-vox 的输出同一格式，登记到部件树
  function tagMesh(m, tag, anchor, ud) {
    const g = m.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    g.clearGroups(); g.addGroup(0, n * 3, 0);
    if (!Array.isArray(m.material)) m.material = [m.material];
    m.name = anchor;
    Object.assign(m.userData, { faceTags: [tag], triTag: new Uint16Array(n), anchor, layer: 'site' }, ud || {});
    V3.parts.tagFaces(m);
    return m;
  }
  const triCount = (m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1);

  // ======== 珊瑚：每簇一个网格（sealife:coral1…）= 鹿角 + 脑珊瑚 + 扇形 + 管状 / 泡泡；只转 90°（体素和地形同轴） ========
  // 颜色比现实更艳：水会吃掉红色（53-water 的切面吸收），远处的会自然偏青
  const hx = (s) => s.split(' ').map(h => parseInt(h, 16));
  const PAL = {
    pink: hx('c93f7a e65c97 ff84b5 ffb0d0 ffe0ee'), magenta: hx('8f1d5c b52a76 d94594 f07ab4'),
    purple: hx('5e2a9e 7d3fc4 a066e6 c79bff'), orange: hx('c4501a e8692a ff8c42 ffb36b ffd9a8'),
    yellow: hx('b08a12 d6ad21 f0cc3f ffe27a'), red: hx('a3202e c93642 e85a62 ff8c8c'), violet: hx('6a2d8f 8f45b8 b56ee0 dca6ff'),
  };
  const STYLES = [
    { antler: PAL.pink, brain: PAL.magenta, fan: PAL.purple, extra: 'tubes', ex: PAL.orange },
    { antler: PAL.orange, brain: PAL.yellow, fan: PAL.red, extra: 'blobs', ex: PAL.violet },
    { antler: PAL.violet, brain: PAL.pink, fan: PAL.orange, extra: 'tubes', ex: PAL.yellow },
  ];
  const pick = (pal, f) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(f * pal.length)))];
  function antler(g, x, z, h, pal, rng) {            // 鹿角珊瑚：分叉的圆管（半径 ≥ 0.9 格，斜着也连得上），尖端最浅
    const segs = [];
    const grow = (p, d, len, r, lv) => {
      const q = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
      segs.push([p, q, r, lv]);
      if (lv >= 3 || len < 2.5) return;
      for (let i = 0, n = lv ? 2 : 3; i < n; i++) {
        const a = (i / n + rng() * 0.3) * TAU, s = 0.5 + rng() * 0.4;
        grow(q, norm([d[0] + Math.cos(a) * s, d[1] + 0.2, d[2] + Math.sin(a) * s]), len * (0.66 + rng() * 0.2), Math.max(0.9, r * 0.8), lv + 1);
      }
    };
    grow([x, 0, z], [0, 1, 0], h * 0.36, h > 16 ? 1.7 : 1.2, 0);
    for (const [a, b, r, lv] of segs) g.c((sx, y, zz, u) => pick(pal, lv >= 2 && u > 0.6 ? 1 : y / h * 0.85))
      .tube([[a[0], a[1], a[2], r], [b[0], b[1], b[2], Math.max(0.9, r * 0.85)]]);
  }
  function brain(g, x, z, rx, ry, rz, pal) {          // 脑珊瑚：压扁的半球，弯弯曲曲的沟纹只用颜色画（挖洞会多出很多面）
    g.c((sx, y, zz) => {
      const q = Math.sin(sx * 0.9 + Math.sin(zz * 0.55) * 2.2) + Math.sin(zz * 0.85 + Math.sin(sx * 0.6) * 1.8);
      return pick(pal, (q > 0.35 ? 0.1 : 0.6) + y / ry * 0.3);
    }).ell(x, 0, z, rx, ry, rz);
  }
  function fan(g, x, z, r, alongX, pal, rng) {        // 扇形珊瑚：一层体素厚的竖直扇面，叶脉 + 同心环颜色深
    const ph = rng() * TAU, put = (a, y) => alongX ? g.set(x + a, y, z) : g.set(x, y, z + a);
    g.c(pal[0]); for (let y = 0; y < 3; y++) put(0, y);
    for (let a = -r; a <= r; a++) for (let dy = 0; dy <= r; dy++) {
      const d = Math.hypot(a, dy), ang = Math.atan2(a, dy);
      if (Math.abs(ang) > 1.25 || d > r * (0.8 + 0.2 * Math.sin(ang * 3 + ph))) continue;
      const f = (ang + 1.25) / 0.36, vein = Math.abs(f - Math.floor(f) - 0.5) * 0.36 * d < 0.5, m = d % 3.5, ring = d > 2 && Math.min(m, 3.5 - m) < 0.5;
      g.c(pick(pal, vein || ring ? 0.15 + dy / r * 0.3 : 0.5 + dy / r * 0.5)); put(a, dy + 2);
    }
  }
  function tubes(g, x, z, h, pal, rng) {              // 管状珊瑚：几根竖管，管口最浅
    for (let i = 0, n = 3 + (rng() * 3 | 0); i < n; i++) {
      const a = rng() * TAU, d = i ? 1.6 + rng() * 2.4 : 0, th = Math.max(3, Math.round(h * (0.45 + rng() * 0.55)));
      g.c((sx, y) => pick(pal, y >= th - 1 ? 1 : y / th * 0.8)).cyl(Math.round(x + Math.cos(a) * d), Math.round(z + Math.sin(a) * d), 1.25, 0, th - 1);
    }
  }
  function blobs(g, x, z, r, pal, rng) {              // 泡泡珊瑚：几个小圆球挤在一起
    for (let i = 0, n = 3 + (rng() * 2 | 0); i < n; i++) {
      const a = rng() * TAU, d = i ? r * (0.6 + rng() * 0.5) : 0, rr = r * (i ? 0.55 + rng() * 0.3 : 0.8);
      const cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d, cy = rr * 0.8;
      g.c((sx, y, zz) => pick(pal, 0.25 + (y - cy + rr) / (2 * rr) * 0.75 + (U.hash3(sx, y, zz) - 0.5) * 0.2)).ell(cx, cy, cz, rr, rr, rr);
    }
  }
  // kind: deep = 鹿角 + 脑 + 扇 + 管/泡；reef（浅水，主要从上往下看）= 两丛鹿角 + 大脑珊瑚 + 管/泡；rock（岩顶）= 鹿角 + 扇
  // front：朝南切面摆（脑珊瑚在前 +z、扇面在后且正对 +z、不转），给从切面外看的镜头
  function cluster(kind, H, st, rng, front) {
    const R = kind === 'rock' ? 18 : 22, g = new V3.vox.Grid(2 * R + 1, H + 10, 2 * R + 1).t('海/珊瑚');
    const a0 = front ? Math.PI / 2 + (rng() - 0.5) * 0.6 : rng() * TAU;
    const at = (a, d) => [Math.round(Math.cos(a0 + a) * d), Math.round(Math.sin(a0 + a) * d)];
    const extra = (a, d, h) => {
      const [ex, ez] = at(a, Math.min(R - 6, d));
      if (st.extra === 'tubes') tubes(g, ex, ez, h, st.ex, rng); else blobs(g, ex, ez, Math.max(2.5, h * 0.32), st.ex, rng);
    };
    antler(g, 0, 0, H, st.antler, rng);
    if (kind === 'reef') {
      const [ax, az] = at(3.0, H * 0.6 + 4); antler(g, ax, az, Math.round(H * 0.75), st.antler, rng);
      const r = Math.max(6, H * 0.6), [bx, bz] = at(0, Math.min(R - r - 1, r + 3)); brain(g, bx, bz, r, Math.min(r * 0.55, H * 0.7), r * 0.85, st.brain);
      extra(4.4, H * 0.6 + 5, H * 0.6);
      return g;
    }
    if (kind === 'deep') {
      const r = Math.max(4, H * 0.28), [bx, bz] = at(0, Math.min(R - r - 1, H * 0.35 + 3)); brain(g, bx, bz, r, r * 0.62, r * 0.9, st.brain);
      extra(4.2, H * 0.35 + 3, H * 0.45);
    }
    const r = Math.round(Math.min(11, H * 0.42)), [fx, fz] = at(2.3, Math.min(R - r - 1, H * 0.3 + 3));
    fan(g, fx, fz, r, front ? true : rng() < 0.5, st.fan, rng);
    return g;
  }
  function extent(g) {                                 // 体素实际范围（格）：顶高 top、底层半径 r0、整体水平半径 r
    let top = 0, r0 = 0, r = 0;
    for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      if (!g.col[i + g.nx * (j + g.ny * k)]) continue;
      const y = j - g.o[1], d = Math.hypot(i - g.o[0], k - g.o[2]) + 0.5;
      top = Math.max(top, y + 1); r = Math.max(r, d); if (y === 0) r0 = Math.max(r0, d);
    }
    return { top, r0, r };
  }
  const CORALS = [   // [x, z, 落在 bed 海床 / rock 岩顶, 高度（格）, 样式, 类型, 朝南切面]；位置是起点，实际座位就近找平整处（太浅会自动变矮）
    [15.6, 16.2, 'bed', 14, 0, 'reef'], [12.9, 14.8, 'bed', 14, 1, 'reef'],         // 东礁石南脚 / 西南
    [-18.2, 18.4, 'bed', 14, 2, 'reef'], [-14.5, 17.8, 'bed', 14, 0, 'reef'],       // 西礁石南脚 / 东侧
    [-20.6, 30.6, 'rock', 20, 1, 'rock'], [18.3, 32.5, 'rock', 22, 2, 'rock'],     // 两块海底岩的岩顶
    [3.5, 38.4, 'bed', 34, 0, 'deep', 1], [7.8, 37.4, 'bed', 30, 1, 'deep', 1],    // 南切面旁（从切面外看得见）
    [-7.6, 36.6, 'rock', 24, 2, 'rock'], [19.2, 36.7, 'rock', 24, 0, 'rock'],      // 切面附近的海底岩
    [-8.0, 22.6, 'bed', 18, 1, 'deep'],                                            // 中间深沟
  ];
  MODS.push({
    id: 'coral',
    build(ctx, S) {
      const out = [];
      CORALS.forEach(([x0, z0, seat, H0, si, kind, front], n) => {
        const id = 'coral' + (n + 1);
        let H = H0, g = null, e = null, at = null;
        for (let tries = 0; tries < 5 && !at; tries++) {     // 找不到座位（太浅 / 不平）就矮一点、小一点再找
          g = cluster(kind, H, STYLES[si], ctx.rng('sealife:' + id), front); e = extent(g);
          const rr = Math.max(0.2, e.r0 * S32), top = e.top * S32;
          const ok = (x, z) => {
            if (!inSite(x, z, e.r * S32 + 0.3)) return false;
            const y = flat(topY, x, z, rr);
            if (Number.isNaN(y) || Number.isNaN(flat(topY, x, z, rr * 0.5)) || y + top > SEA - 0.25) return false;
            const b = bedY(x, z);
            return seat === 'bed' ? y - b < 0.01 : y - b > 0.2;
          };
          at = spot(x0, z0, ok, 3);
          if (!at) H = Math.max(6, Math.round(H * 0.8));
        }
        if (!at) { at = [x0, z0]; console.warn('sealife: ' + id + ' 没找到平整座位，按原位摆'); }
        let y = topY(at[0], at[1]);
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, d = e.r0 * S32; y = Math.max(y, topY(at[0] + Math.cos(a) * d, at[1] + Math.sin(a) * d)); }
        const ry = front ? 0 : (ctx.rng('sealife:' + id + ':yaw')() * 4 | 0) * Math.PI / 2;
        const { geo } = merge([{ g, ry }], (ny, py) => ny < -0.5 && py < 0.01);   // 贴着海床的底面看不见，去掉
        const m = new THREE.Mesh(geo, vmat());
        m.position.set(at[0], y, at[1]);
        out.push(tagMesh(m, '海/珊瑚', 'sealife:' + id, { kind, seat }));
        S.corals.push({ id, x: at[0], z: at[1], y, top: y + e.top * S32, r: e.r * S32, kind });
      });
      return out;
    },
  });

  // ======== 海带：深水台阶上 10 丛（每丛 3–5 根、高矮不一，靠南切面的 3 丛更高），每根 = 两张交叉面片（0.5 m 一节），update 里按高度摆动 ========
  // 贴图 sealifeKelp / sealifeKelpTop 在这里加进图集：叶片比自带 kelp 宽一倍（自带的远看太细）
  function kelpTile(top) {
    return (px) => {
      const K = ['#2f4a14', '#3d5a1a', '#5a8027', '#6a922f', '#7da53a', '#93bb48'];
      const put = (x, yy, c) => { if (yy >= 0 && yy < 16 && x >= 0 && x < 16) px(x, 15 - yy, c); };   // yy 从下往上数
      const sx = (yy) => 7 + ((yy >> 2) & 1), H = top ? 11 : 16;                                       // 2 px 折线茎（8 px 一周期，上下接得上）
      for (let yy = 0; yy < H; yy++) { put(sx(yy), yy, K[1]); put(sx(yy) + 1, yy, K[0]); }
      if (top) { const s = sx(10); put(s, 11, K[4]); put(s - 1, 12, K[3]); put(s + 2, 12, K[3]); put(s - 1, 13, K[5]); put(s + 2, 13, K[5]); }
      [[0, -1], [4, 1], [8, -1], [12, 1]].forEach(([b, side]) => {                                      // 叶片：左右交替、斜向上、根部 3 px 厚
        if (top && b > 8) return;
        const x0 = side < 0 ? sx(b) - 1 : sx(b) + 2, len = top && b === 8 ? 4 : 6;
        for (let d = 0; d < len; d++) {
          const x = x0 + side * d, y0 = b + (d >> 1), th = d < 3 ? 3 : d < len - 1 ? 2 : 1;
          for (let k = 0; k < th; k++) put(x, y0 + k, K[k === 0 ? 2 : d > len - 3 ? 5 : 3 + (k & 1)]);
        }
        put(x0, b + 1, '#a8a03a');                                                                     // 叶根的小气囊
      });
    };
  }
  V3.atlas.add('sealifeKelp', kelpTile(false)); V3.atlas.add('sealifeKelpTop', kelpTile(true));
  const KELP = [[-2, 30], [12, 27.5], [-14, 33], [22.5, 29.5], [2.2, 39.0], [9.0, 39.0], [-1.5, 38.9], [6, 33], [-22, 36], [15, 35.5]];
  const KS = { mesh: null, rest: null, w: null, ph: null, dir: null };
  MODS.push({
    id: 'kelp',
    build(ctx) {
      const A = V3.atlas, uvK = A.uv('sealifeKelp'), uvT = A.uv('sealifeKelpTop');
      const P = [], C = [], UV = [], IX = [], W = [], PH = [], DIR = [];
      KELP.forEach(([cx, cz], n) => {
        const rng = ctx.rng('sealife:kelp' + n), cur = rng() * TAU, ph0 = rng() * TAU, near = cz > 37.5;
        for (let s = 0, ns = 3 + (rng() * 3 | 0); s < ns; s++) {
          const a = rng() * TAU, d = s ? 0.2 + rng() * 0.5 : 0, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
          const b = bedY(x, z);
          if (topY(x, z) - b > 0.01 || !inSite(x, z, 0.4)) continue;                       // 根要扎在海床上（不在岩石上、不出切面）
          const f = (near ? 0.9 : 0.72) * (s ? 0.5 + rng() * 0.45 : 1);                    // 第一根最高，其余高矮不一
          const L = Math.min((SEA - 0.35) - b, -b * f), seg = Math.max(1, Math.round(L / 0.5));
          if (L < 0.6) continue;
          const yaw = rng() * Math.PI, ph = ph0 + rng() * 1.2, amp = 0.05 + L * 0.06, tint = 0.85 + rng() * 0.3;
          for (let p = 0; p < 2; p++) {                                                      // 两张面片交叉 90°
            const ux = Math.cos(yaw + p * Math.PI / 2) * 0.25, uz = Math.sin(yaw + p * Math.PI / 2) * 0.25;
            for (let k = 0; k < seg; k++) {
              const uv = k === seg - 1 ? uvT : uvK, y0 = b + k * L / seg, y1 = b + (k + 1) * L / seg, v = P.length / 3;
              for (const [sx, yy, uu, vv] of [[-1, y0, uv[0], uv[1]], [1, y0, uv[2], uv[1]], [1, y1, uv[2], uv[3]], [-1, y1, uv[0], uv[3]]]) {
                P.push(x + ux * sx, yy, z + uz * sx); UV.push(uu, vv);
                const h = (yy - b) / L, l = (0.68 + 0.4 * h) * tint;
                C.push(l * 0.95, l, l * 0.9);
                W.push(Math.pow(h, 1.5) * amp); PH.push(ph); DIR.push(cur);
              }
              IX.push(v, v + 1, v + 2, v, v + 2, v + 3, v, v + 2, v + 1, v, v + 3, v + 2);   // 正反两面都出（材质只画正面）
            }
          }
        }
      });
      const geo = new THREE.BufferGeometry(), nv = P.length / 3;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));   // 法线朝上：两面一样亮
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(UV), 2));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
      geo.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(IX, 1) : new THREE.Uint16BufferAttribute(IX, 1));
      geo.computeBoundingSphere(); geo.boundingSphere.radius += 0.5;                      // 摆动余量
      const m = new THREE.Mesh(geo, V3.blocks.material('cutout'));
      Object.assign(KS, { mesh: m, rest: Float32Array.from(P), w: Float32Array.from(W), ph: Float32Array.from(PH), dir: Float32Array.from(DIR) });
      return [tagMesh(m, '海/海带', 'sealife:kelp', { stalks: KELP.length })];
    },
    update(dt, t) {
      if (!KS.mesh) return;
      const a = KS.mesh.geometry.attributes.position, p = a.array, r = KS.rest;
      for (let i = 0, n = KS.w.length; i < n; i++) {
        const w = KS.w[i]; if (w === 0) continue;
        const s = Math.sin(t * 0.9 + KS.ph[i]) * w, q = Math.sin(t * 1.7 + KS.ph[i] * 1.3) * w * 0.35, d = KS.dir[i];
        p[i * 3] = r[i * 3] + Math.cos(d) * s - Math.sin(d) * q; p[i * 3 + 2] = r[i * 3 + 2] + Math.sin(d) * s + Math.cos(d) * q;
      }
      a.needsUpdate = true;
    },
    dispose() { KS.mesh = null; },
  });
  // ======== 远礁鱼群：每一拨三种，围着珊瑚绕 8 字 / 椭圆，最高 −1.0 m（水面 −0.15）；鼻子朝 +z ========
  function clownfish() {        // 小丑鱼：7 格身子 + 尾鳍，橙底三道白纹（≈ 0.28 m，比真的大一号，远处才看得清）
    const O = 0xff6a10, W = 0xfbfbf6, K = 0x1a1410, g = new V3.vox.Grid(5, 9, 13, { origin: [2, 0, 6] }).t('海/鱼');
    g.c((sx, y, z) => (z === 1 || z === -2 ? W : O)).ell(0, 3, 0, 1.5, 2.2, 3.4);
    g.c((sx, y, z) => (z === -4 ? W : y === 0 || y === 6 ? K : O)).fill(0, 0, -5, 0, 6, -4, (x, y, z) => z === -5 || (y >= 1 && y <= 5));
    g.c(O).fill(0, 6, -2, 0, 6, 1).c(K).set(0, 7, -1).c(O).set(2, 2, 1).set(-2, 2, 1).set(0, 0, 0);
    g.c(K).set(1, 4, 2).set(-1, 4, 2);
    return g;
  }
  function blueTang() {         // 蓝倒吊：宝蓝身子、背上深蓝"调色板"纹、黄尾巴（≈ 0.4 m）
    const B = 0x2f6ff0, N = 0x0c1a4f, Y = 0xffd21a, K = 0x0a0a0a, g = new V3.vox.Grid(5, 11, 15, { origin: [2, 0, 7] }).t('海/鱼');
    g.c((sx, y, z) => ((y >= 5 && z >= -3 && z <= 1) || (y === 4 && z <= -2 && z >= -4) ? N : B)).ell(0, 4, 0, 1.4, 3.0, 4.6);
    g.c(N).m('under').fill(0, 6, -3, 0, 8, 2).c(B).fill(0, 0, -3, 0, 1, 1).m('add');
    g.c(Y).fill(0, 2, -5, 0, 6, -5).fill(0, 1, -6, 0, 7, -6).c(B).set(2, 3, 1).set(-2, 3, 1).c(K).set(1, 5, 2).set(-1, 5, 2);
    return g;
  }
  const reefSpecies = { clown: { grid: clownfish, center: 3 }, tang: { grid: blueTang, center: 4 } };
  const reefCache = new Map();
  function blockbenchReef(species, form) {
    const model = V3.shoreModels.fish(species, .047, form), geometry = new THREE.BufferGeometry();
    const values = { position: [], normal: [], color: [] };
    model.position.y = -.14; model.updateMatrixWorld(true);
    model.traverse(part => {
      if (!part.isMesh) return;
      const piece = part.geometry.clone().applyMatrix4(part.matrixWorld);
      for (const key of Object.keys(values)) values[key].push(...piece.getAttribute(key).array);
      piece.dispose();
    });
    for (const key of Object.keys(values)) geometry.setAttribute(key, new THREE.Float32BufferAttribute(values[key], 3));
    return geometry;
  }
  function reefGeometry(species, form = 'base') {
    const entry = reefSpecies[species], key = species + ':' + form;
    if (!reefCache.has(key)) {
      const geometry = entry ? merge([{ g: entry.grid(), y: -entry.center * S32, noise: 0.04 }]).geo : blockbenchReef(species, form);
      geometry.userData.shared = true; reefCache.set(key, geometry);
    }
    return reefCache.get(key);
  }
  V3.reefFish = { model: (species, form) => new THREE.Mesh(reefGeometry(species, form), vmat()) };
  const SCHOOLS = [
    { n: 3, around: ['coral7', 'coral8'], path: 'eight', v: 0.32 },
    { n: 3, around: ['coral11'], path: 'oval', v: 0.28 },
    { n: 2, around: ['coral6'], path: 'oval', v: 0.25 },
    { high: true, n: 3, around: ['coral7', 'coral8'], path: 'oval', v: 0.4 },
  ];
  function swimPath(cs, s, all) {   // → { at(θ) → [x, z, dx, dz], L 周长, w θ 角速度, y 游的高度 }
    const c0 = cs[0], c1 = cs[cs.length - 1], half = Math.hypot(c1.x - c0.x, c1.z - c0.z) / 2, ang = Math.atan2(c1.z - c0.z, c1.x - c0.x);
    const rm = Math.max(...cs.map(c => c.r)), eight = s.path === 'eight', two = cs.length > 1, ca = Math.cos(ang), sa = Math.sin(ang);
    const A = eight ? half + rm + 0.55 : two ? half + rm + 0.9 : rm + 0.75, B = eight ? 2 * (rm + 0.45) : two ? rm + 0.8 : rm + 0.5;
    let cx = (c0.x + c1.x) / 2, cz = (c0.z + c1.z) / 2;
    const at = (th) => {
      const c = Math.cos(th), sn = Math.sin(th), u = A * c, du = -A * sn, w = eight ? B * sn * c : B * sn, dw = eight ? B * Math.cos(2 * th) : B * c;
      return [cx + u * ca - w * sa, cz + u * sa + w * ca, du * ca - dw * sa, du * sa + dw * ca];
    };
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, L = 0, q = at(0);
    for (let i = 1; i <= 96; i++) {
      const p = at(i / 96 * TAU); L += Math.hypot(p[0] - q[0], p[1] - q[1]); q = p;
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
    }
    const ST = V3.layout.site;                      // 别游出场地（切面外）：整条路线往里挪
    cx += Math.max(0, ST.x0 + 0.6 - x0) - Math.max(0, x1 - (ST.x1 - 0.6));
    cz += Math.max(0, ST.z0 + 0.6 - z0) - Math.max(0, z1 - (ST.z1 - 0.6));
    // 高度：小丑鱼在珊瑚半腰，蓝倒吊在珊瑚顶上；路过的海床 / 珊瑚顶要留余量；最高 SEA − 0.95（加上摆动也在 −0.8 以下）
    let y = s.high ? Math.max(...cs.map(c => c.top)) + 0.35 : cs.reduce((a, c) => a + c.y + (c.top - c.y) * 0.6, 0) / cs.length;
    for (let i = 0; i < 96; i++) {
      const [px, pz] = at(i / 96 * TAU);
      y = Math.max(y, topY(px, pz) + 0.3);
      for (const c of all) if (Math.hypot(px - c.x, pz - c.z) < c.r + 0.2) y = Math.max(y, c.top + 0.2);
    }
    if (y > SEA - 0.95) console.warn('sealife: 鱼群 ' + s.around + ' 那里水太浅，压到 ' + (SEA - 0.95));
    return { at, L, w: s.v / L * TAU, y: Math.min(y, SEA - 0.95) };
  }
  const FS = { meshes: [], fish: [], epoch: -1 }, _o = new THREE.Object3D();
  function reefShift(epoch) {
    const roster = V3.inventoryRules.reefAt(epoch);
    for (const [slot, mesh] of FS.meshes.entries()) {
      const kind = roster[slot], form = V3.inventoryRules.fishFormAt(kind, epoch), geometry = reefGeometry(kind, form);
      const vertices = geometry.index?.count ?? geometry.attributes.position.count;
      geometry.clearGroups(); geometry.addGroup(0, vertices, 0); mesh.geometry = geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      Object.assign(mesh.userData, { species: kind, form, encounterEpoch:epoch, radius:geometry.boundingSphere.radius+geometry.boundingSphere.center.length(), triTag: new Uint16Array(vertices / 3) });
    }
    FS.epoch = epoch;
  }
  function leaveReef() {
    if (FS.leaving) return FS.fish.every(f=>f.leg.complete);
    for (const f of FS.fish) {
      const mesh=FS.meshes[f.slot];
      mesh.getMatrixAt(f.k,_o.matrix);
      _o.position.setFromMatrixPosition(_o.matrix);
      f.leg=V3.fishPassage.begin(_o.position,f.yaw,mesh.userData.radius,false);
    }
    FS.leaving=true;
    return false;
  }
  function swim(dt,t) {
    const epoch=V3.inventoryRules.encounter(Date.now());
    let arriving=false, rejoining=false;
    if (epoch!==FS.epoch) {
      if (FS.epoch===-1 || !V3.R?.camera || leaveReef()) {
        arriving=FS.epoch!==-1 && !!V3.R?.camera;
        reefShift(epoch); FS.leaving=false;
      }
    } else if (FS.leaving) {
      rejoining=true; FS.leaving=false;
    }
    for (const f of FS.fish) {
      const m = FS.meshes[f.slot]; if (!m) continue;
      if (FS.leaving && f.leg.complete) continue;
      if (rejoining) {
        m.getMatrixAt(f.k,_o.matrix); _o.position.setFromMatrixPosition(_o.matrix);
        f.leg=V3.fishPassage.begin(_o.position,_o.rotation.y,m.userData.radius,true);
        f.leg.edge.copy(_o.position); f.leg.heading=f.yaw; f.leg.rejoining=true;
      }
      const P = f.P, [x, z, tx, tz] = P.at(t * P.w - f.lag), l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
      _o.position.set(x + nx * f.off, Math.min(SEA - 0.85, P.y + f.dy + Math.sin(t * 1.3 + f.ph) * 0.05), z + nz * f.off);
      _o.rotation.set(-Math.cos(t * 1.3 + f.ph) * 0.1, Math.atan2(tx, tz) + Math.sin(t * 8 + f.ph) * 0.12, 0, 'YXZ');
      _o.scale.setScalar(1);
      if (arriving) f.leg=V3.fishPassage.begin(_o.position,_o.rotation.y,m.userData.radius,true);
      if (f.leg) {
        V3.fishPassage.move(f.leg,_o,arriving || rejoining ? 0 : dt);
        if (f.leg.entering && f.leg.complete) f.leg=null;
      }
      f.yaw=_o.rotation.y;
      _o.updateMatrix(); m.setMatrixAt(f.k, _o.matrix);
    }
    for (const mesh of FS.meshes) { mesh.instanceMatrix.needsUpdate = true; mesh.boundingSphere = null; }
  }
  MODS.push({
    id: 'fish',
    build(ctx, S) {
      const epoch = V3.inventoryRules.encounter(Date.now()), roster = V3.inventoryRules.reefAt(epoch), cnt = roster.map(() => 0), out = [];
      FS.fish = []; FS.meshes = []; FS.epoch = -1; FS.leaving=false;
      SCHOOLS.forEach((s, si) => {
        const cs = s.around.map(id => S.corals.find(c => c.id === id)).filter(Boolean);
        if (!cs.length) { console.warn('sealife: 鱼群找不到珊瑚 ' + s.around); return; }
        const P = swimPath(cs, s, S.corals), rng = ctx.rng('sealife:fish' + si);
        const slot = si % roster.length;
        for (let i = 0; i < s.n; i++) FS.fish.push({ slot, k: cnt[slot]++, P, lag: (i * 0.55 / P.L + rng() * 0.03) * TAU, off: (rng() - 0.5) * 0.3, dy: (rng() - 0.5) * 0.2, ph: rng() * TAU });
      });
      for (const [slot, kind] of roster.entries()) {
        const mesh = new THREE.InstancedMesh(reefGeometry(kind, V3.inventoryRules.fishFormAt(kind, epoch)), vmat(), Math.max(1, cnt[slot]));
        mesh.count = cnt[slot]; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        FS.meshes.push(mesh);
        out.push(tagMesh(mesh, '海/鱼', 'sealife:reef-' + slot, { noShadow: true, species: kind, fish: mesh.count, clickable: 'reefWatch', clickAlways: true }));
      }
      swim(0,0);
      S.fish = FS.fish.map(f => ({ get sp() { return FS.meshes[f.slot]?.userData.species; }, y: f.P.y }));
      return out;
    },
    update(dt, t) { swim(dt,t); },
    // InstancedMesh 的 instanceMatrix 是网格自己的显存，场景收尾只释放几何体 / 材质：这里 dispose 网格（只放实例缓冲，几何体和共用材质不动）
    dispose() { for (const mesh of FS.meshes) mesh.dispose(); FS.meshes = []; FS.fish = []; FS.epoch = -1; },
  });
  // ======== 海星 4 个（浅水海床，一个网格 sealife:starfish）+ 海底小石头 8 块（一个网格 sealife:stones） ========
  // 找平整的海床座位：深 bed ∈ [lo, hi]，半径 r 内平、没有礁石 / 海底石，离珊瑚和已经摆好的东西够远
  function bedSpot(x, z, r, lo, hi, avoid) {
    return spot(x, z, (px, pz) => {
      if (!inSite(px, pz, r + 0.3)) return false;
      const b = flat(bedY, px, pz, r);
      if (!(b >= lo && b <= hi) || !(Math.abs(flat(topY, px, pz, r) - b) <= 0.01)) return false;   // NaN（不平）也算不行
      return avoid.every(o => Math.hypot(px - o.x, pz - o.z) > r + o.r + 0.15);
    }, 2.5);
  }
  const dropBottom = (ny, py) => ny < -0.5 && py < 0.01;
  // 海星：5 条臂、1 格厚 + 中间一道脊；颜色 [底, 暗, 亮]
  const STAR_PAL = [[0xff7a2e, 0xd9561c, 0xffb067], [0xe8344a, 0xb52234, 0xff8a8a], [0x8e4fd6, 0x6a32ad, 0xd3a6ff], [0xf2b84a, 0xc98b25, 0xffe39a]];
  function starfish(rng, pal) {
    const g = new V3.vox.Grid(15, 3, 15, { origin: [7, 0, 7] }), a0 = rng() * TAU, R = 6.4;
    const arm = (x, z) => {
      const d = Math.hypot(x, z), a = Math.atan2(z, x) - a0, k = TAU / 5;
      const da = Math.abs(((a % k) + k * 1.5) % k - k / 2);                   // 到最近一条臂中线的夹角
      return { d, w: d * Math.sin(Math.min(da, Math.PI / 2)), half: 1.7 * (1 - d / (R + 0.6)) + 0.45 };
    };
    g.c((x, y, z) => {
      const h = U.hash3(x * 3 + 1, y, z * 3 + 7);
      return y ? (h < 0.22 ? pal[2] : pal[0]) : (h < 0.3 ? pal[1] : pal[0]);
    });
    g.fill(-7, 0, -7, 7, 0, 7, (x, y, z) => { const q = arm(x, z); return q.d <= R && (q.d < 2.2 || q.w <= q.half); });
    g.fill(-7, 1, -7, 7, 1, 7, (x, y, z) => { const q = arm(x, z); return q.d <= R - 1.6 && (q.d < 1.6 || q.w <= q.half - 0.9); });
    return g;
  }
  const STARS = [[3, 15.5], [-6, 16.2], [10, 15.6], [19.5, 15.2]];
  MODS.push({
    id: 'starfish',
    build(ctx, S) {
      const rng = ctx.rng('sealife:starfish'), list = [];
      S.stars = [];
      STARS.forEach(([x0, z0], n) => {
        const g = starfish(rng, STAR_PAL[n % STAR_PAL.length]);
        const p = bedSpot(x0, z0, 0.23, -0.55, -0.2, S.corals.concat(S.stars));
        if (!p) { console.warn('[sealife] starfish' + n + ' 没找到座位'); return; }
        const y = bedY(p[0], p[1]);
        list.push({ g, x: p[0], y, z: p[1], noise: 0.05, ao: 0.4 });
        S.stars.push({ x: p[0], z: p[1], y, r: 0.2 });
      });
      if (!list.length) return [];
      const m = new THREE.Mesh(merge(list, dropBottom).geo, vmat());
      return [tagMesh(m, '海/海星', 'sealife:starfish', { noShadow: true, count: list.length })];
    },
  });
  // 小石头：半埋的扁椭球（只留 y ≥ 0 的部分），灰 / 带青苔
  const STONE_G = [0x8f8b84, 0x9c978e, 0x7e7a73, 0xa9a59c], STONE_M = [0x6f8a52, 0x5d7a45, 0x88a062];
  function stone(rng) {
    const rx = 2.5 + rng() * 3.2, rz = rx * (0.6 + rng() * 0.5), ry = 1.8 + rng() * 2, moss = rng() < 0.4;
    const n = Math.ceil(Math.max(rx, rz)) * 2 + 3, g = new V3.vox.Grid(n, Math.ceil(ry) + 2, n);
    g.c((x, y, z) => {
      const h = U.hash3(x * 5 + 3, y * 3, z * 5 + 1);
      return moss && y >= ry - 1.6 && h < 0.7 ? STONE_M[(h * 7 | 0) % 3] : STONE_G[(h * 11 | 0) % 4];
    });
    g.ell(0, ry * 0.25, 0, rx, ry, rz);                                       // 中心在海床下一点：底下的一截被网格截掉
    return { g, r: Math.max(rx, rz) * S32 };
  }
  const STONES = [[1.5, 15], [-5, 15.8], [11, 15], [18.5, 16.5], [-10, 17], [5.6, 39.2], [3.2, 37], [-3, 25]];
  MODS.push({
    id: 'stones',
    build(ctx, S) {
      const rng = ctx.rng('sealife:stones'), list = [], placed = [];
      STONES.forEach(([x0, z0], n) => {
        const st = stone(rng);
        const p = bedSpot(x0, z0, st.r + 0.02, -4.01, -0.2, S.corals.concat(S.stars || [], placed));
        if (!p) { console.warn('[sealife] stone' + n + ' 没找到座位'); return; }
        list.push({ g: st.g, x: p[0], y: bedY(p[0], p[1]), z: p[1], ry: (rng() * 4 | 0) * Math.PI / 2, noise: 0.08 });
        placed.push({ x: p[0], z: p[1], r: st.r });
      });
      if (!list.length) return [];
      S.stones = placed;
      const m = new THREE.Mesh(merge(list, dropBottom).geo, vmat());
      return [tagMesh(m, '海/石头', 'sealife:stones', { count: list.length })];
    },
  });
  // ======== 小螃蟹（sealife:crab，部件 '场地/螃蟹'）：住在东礁石北侧的洞里；在洞口外的湿沙上横着走、停下举钳子，偶尔钻回洞里 ========
  // 本地坐标：+x = 右手边（横着走的方向），+z = 前（钳子 / 眼睛），1 格 = 1/32 m；骨骼 0 身体，1–3 左腿，4–6 右腿，7 左钳，8 右钳
  const CRAB_LEG_Z = [2, 0, -2], CRAB_LEG_DZ = [[1, 2], [0, 0], [-1, -2]];
  function crabModel() {
    const g = new V3.vox.Grid(21, 10, 17, { origin: [10, 0, 7] }), bones = [{ pivot: [0, 0, 0] }];
    g.b(0).c((x, y, z) => {
      const h = U.hash3(x * 3 + 11, y * 5, z * 3 + 2);
      if (y >= 5) return h < 0.18 ? 0xa8241a : h < 0.3 ? 0xff8466 : 0xe8442c;   // 背甲：深色斑点 + 亮点
      return y >= 3 ? (h < 0.15 ? 0xa8241a : 0xd63a26) : 0xf2b89c;            // 侧面 / 肚子
    }).ell(0, 3.5, 0, 4.3, 2, 3.3);
    g.m('paint').c(0x6e1a12).fill(-1, 3, 3, 1, 3, 3).m('add');                 // 嘴
    for (const sx of [-1, 1]) g.c(0xc8341f).set(sx * 2, 6, 1).c(0x14100c).set(sx * 2, 7, 1).set(sx * 2, 7, 2);   // 眼柄 + 眼睛
    g.m('under');                                                              // 腿和钳子只填空格，不改身体的格子
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {                    // 每边 3 条腿：根 → 膝（拱起）→ 脚尖着地
      const z0 = CRAB_LEG_Z[k], [d1, d2] = CRAB_LEG_DZ[k];
      bones.push({ pivot: [sx * 3, 3.5, z0] });
      g.b(bones.length - 1).c((x, y, z, u) => (u > 1.55 ? 0xf5a06c : u > 0.9 ? 0xe2482e : 0xc9321f))
        .tube([[sx * 3, 3.5, z0, 0.8], [sx * 6, 5.5, z0 + d1, 0.75], [sx * 9, 0.5, z0 + d2, 0.6]]);
    }
    for (const sx of [-1, 1]) {                                                // 两只钳子：手臂往前弯，钳尖深色
      bones.push({ pivot: [sx * 2, 3, 2] });
      g.b(bones.length - 1).c(0xe0402a).tube([[sx * 2, 3, 2, 0.8], [sx * 3.5, 3.5, 4.5, 0.8], [sx * 3, 3.5, 6, 0.9]]);
      g.c(0xea4a30).ell(sx * 3, 3.5, 6.5, 1.6, 1.4, 1.4);
      g.c((x, y, z, u) => (u > 0.55 ? 0x2a1a14 : 0xf06a48))
        .tube([[sx * 2.5, 4.5, 7.5, 0.7], [sx * 1.5, 4.5, 9, 0.6]]).tube([[sx * 3, 2.5, 7.5, 0.7], [sx * 2, 2.5, 8.5, 0.6]]);
    }
    g.m('add');
    return { g, bones };
  }
  // 日程：洞口外举钳子 → 几段「转身 / 横着走 / 停一下」→ 回洞口 → 侧身钻进洞躲一会 → 出来；3 轮一循环，只和 t 有关（确定性）
  function crabPlan(rng) {
    const cave = V3.terrain.crabBurrow;
    if (!cave || cave.cells.size < 3) return null;
    const HX = cave.x, NZ = cave.frontZ, RZ = NZ + V3.terrain.CELL;
    const rock = (x, z) => topY(x, z) - bedY(x, z) > 0.01;
    const MZ = NZ - 0.33, HZ = NZ + 1.05, M = [HX, MZ];                       // 洞口外站的地方 / 躲在洞里的地方
    const okP = (x, z) => V3.terrain.isWet(x, z) && bedY(x, z) >= -0.05 && !rock(x, z);      // 湿沙、不在水里、不在石头上
    const free = (x, z) => !rock(x, z) && bedY(x, z) >= -0.12;                // 腿 / 钳子落的地方：不是石头、水不深（干沙也行）
    const RING = [];                                                           // 半径 0.32 m 一圈 8 点：腿伸开、钳子都在里面
    for (let i = 0; i < 8; i++) RING.push([Math.cos(i * Math.PI / 4) * 0.32, Math.sin(i * Math.PI / 4) * 0.32]);
    const ok = (x, z) => okP(x, z) && (Math.hypot(x - HX, z - MZ) < 0.02        // 只有洞口那一点只查左右和北边（南边就是洞）
      ? [[0.3, 0], [-0.3, 0], [0, -0.3]] : RING).every(([a, b]) => free(x + a, z + b));
    const line = (a, b) => {
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1));
      for (let i = 0; i <= n; i++) if (!ok(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)) return false;
      return true;
    };
    const seg = []; let t = 0, p = M, yaw = Math.PI, dist = 0;                  // yaw π：脸朝北（沙滩）
    const push = (k, d, p1, a1, dd) => { seg.push({ k, t0: t, d, p0: p, p1, a0: yaw, a1, g0: dist, gd: dd || 0 }); t += d; p = p1; yaw = a1; dist += dd || 0; };
    const face = (dx, dz) => {                                                 // 本地 +x 或 −x 对准走的方向，挑转得少的；钳子别朝南（礁石）
      const a = Math.atan2(-dz, dx); let best = a, bc = 1e9;
      for (let k = -4; k <= 4; k++) { const c = a + k * Math.PI, w = Math.abs(c - yaw) + (Math.cos(c) > 0.2 ? 2 : 0); if (w < bc) { bc = w; best = c; } }
      return best;
    };
    const turn = (a1) => { const d = Math.abs(a1 - yaw); if (d > 0.05) push('turn', Math.max(0.35, d / 2.2), p, a1, d * 0.08); };
    const walk = (p1, v) => { const L = Math.hypot(p1[0] - p[0], p1[1] - p[1]); if (L < 0.02) return; turn(face(p1[0] - p[0], p1[1] - p[1])); push('walk', L / v, p1, yaw, L); };
    const idle = (d, snap) => push(snap ? 'snap' : 'idle', d, p, yaw);
    idle(2.2, true);                                                           // t = 0：在洞口外举着钳子（截图时看得到）
    let walked = 0;
    for (let c = 0; c < 3; c++) {
      for (let w = 0, nw = 3 + (rng() * 3 | 0); w < nw; w++) {                // 一轮 3–5 段：快跑一小段 → 停下（有时举钳子）
        let q = null;
        for (let i = 0; i < 200 && !q; i++) {
          const x = 13.4 + rng() * 5.2, z = 10.1 + rng() * 1.8, L = Math.hypot(x - p[0], z - p[1]);
          if (L > 0.4 && L < 1.6 && ok(x, z) && line(p, [x, z]) && line([x, z], M)) q = [x, z];
        }
        if (!q) break;
        walk(q, 0.24 + rng() * 0.14); idle(1.5 + rng() * 3, rng() < 0.4); walked++;
      }
      walk(M, 0.26); idle(0.6 + rng(), false);
      const aIn = face(0, 1), hx = HX - Math.sin(aIn) * 0.065;                 // 侧身进洞；往后让一点，钳子和后腿都不碰洞壁
      walk([hx, HZ], 0.24); push('hide', 6 + rng() * 6, p, yaw); walk(M, 0.26); idle(1 + rng() * 1.5, rng() < 0.5);
    }
    turn(Math.PI + TAU * Math.round((yaw - Math.PI) / TAU)); idle(1, false);   // 回到起始朝向（差 2π 的整数倍）→ 循环接得上
    const hideSpots = new Set(seg.filter(segment => segment.k === 'hide').map(segment => segment.p0));
    return { seg, T: t, HX, NZ, RZ, MZ, HZ, M, walked, ok, line, hideSpots };
  }
  // 每帧摆姿势：按 t 找日程段 → 位置 / 朝向 / 步态距离；CPU 蒙皮：顶点 = R(骨骼) · 静止位置（相对关节） + 关节位置 + 身体起伏
  // 被点了以后（crabStartle）：CS.ov = 另排的一小段「受惊」路线，没走完之前照它摆；走完日程接着走，时间错开 CS.off（日程时间 = t − off）
  const CS = { mesh: null, R: new Float64Array(9), plan: null, ov: null, off: 0, si: 0, cur: null, now: null, t: 0, gait: 0, env: 0, u: 0, tw: 0, rng: null };
  const CRAB_FEET = [[0, 0], [0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]];
  function crabPose(t) {
    const m = CS.mesh; if (!m) return;
    const pl = CS.plan;
    let ov = CS.ov;
    if (ov !== null) {
      if (t < ov.t0) { CS.ov = ov = null; CS.off = 0; }                        // 时间倒回去了（截图 / 探针直接指定 t）：受惊那段作废，照原日程
      else if (!(t - ov.t0 < ov.T)) { CS.off = ov.t0 + ov.T - ov.resume; CS.si = ov.rsi; CS.ov = ov = null; }   // 走完：日程从「刚出洞站在洞口」那段的开头接着走
    }
    const sg = ov !== null ? ov.seg : pl.seg, tm = ov !== null ? t - ov.t0 : (((t - CS.off) % pl.T) + pl.T) % pl.T;
    let i = ov !== null ? ov.si : CS.si;
    if (!(sg[i] && sg[i].t0 <= tm && tm < sg[i].t0 + sg[i].d)) { i = 0; while (i < sg.length - 1 && sg[i].t0 + sg[i].d <= tm) i++; }
    if (ov !== null) ov.si = i; else CS.si = i;
    const first = ov !== null && i === 0;                                      // 受惊的第一段：从被点那一刻的姿势接过来（腿抬到哪、钳子举到哪）
    const s = sg[i], f = Math.min(1, (tm - s.t0) / s.d), e = f * f * (3 - 2 * f);
    const z = s.p0[1] + (s.p1[1] - s.p0[1]) * e;
    const tunnelEnd = s.k === 'walk' && (pl.hideSpots.has(s.p1) ? s.p1 : pl.hideSpots.has(s.p0) ? s.p0 : null);
    const x = tunnelEnd ? pl.HX + (tunnelEnd[0] - pl.HX) * U.smooth(pl.MZ, pl.NZ, z) : s.p0[0] + (s.p1[0] - s.p0[0]) * e;
    const yaw = s.a0 + (s.a1 - s.a0) * e, gait = s.g0 + s.gd * e, moving = s.k === 'walk' || s.k === 'turn';
    let y = 0; for (const [dx, dz] of CRAB_FEET) y += V3.terrain.crabFloorY(x + dx, z + dz); y /= CRAB_FEET.length;
    const ph = gait / 0.07 * TAU;                                              // 每走 7 cm 迈一轮（三脚架步态）
    const ts = tm - s.t0, env = moving ? Math.min(1, (first ? ov.e0 : 0) + ts / 0.25, (s.d - ts) / 0.25) : 0;   // 起步 / 停下 0.25 s 过渡，姿势不跳
    const hd = s.k === 'hide' ? Math.min(1, ts / 0.4, (s.d - ts) / 0.4) : 0;
    const bob = env * Math.abs(Math.sin(ph)) * 0.005 + (1 - env) * (1 + Math.sin(t * 2.1)) * 0.0015;
    m.position.set(x, y, z); m.rotation.set(0, yaw, 0); m.updateMatrix();
    const tw = first ? ts + ov.w0 : ts;                                        // 钳子一张一合的相位（受惊第一段接着原来的）
    const u = s.k === 'snap' ? Math.min(1, ts / 0.3, (s.d - ts) / 0.3) : first ? Math.max(0, ov.u0 - ts / 0.25) : 0;
    const P = m.geometry.attributes.position, N = m.geometry.attributes.normal, p = P.array, n = N.array, rp = CS.rest, rn = CS.restN, R = CS.R;
    for (const r of CS.ranges) {
      const b = r.bone, pv = CS.piv[b];
      if (b >= 1 && b <= 6) {                                                  // 腿：抬（绕本地 z，左右反号）+ 前后摆（绕 y）
        const sx = b <= 3 ? -1 : 1, q = ph + ((b - 1) % 2) * Math.PI;
        const lift = env * Math.max(0, Math.sin(q)) * 0.45 + (1 - env) * Math.pow(Math.max(0, Math.sin(t * 0.7 + b * 1.9)), 24) * 0.25;
        const th = sx * lift, ps = env * Math.cos(q) * 0.12, ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ps), sp = Math.sin(ps);
        R[0] = cp * ct; R[1] = -cp * st; R[2] = sp; R[3] = st; R[4] = ct; R[5] = 0; R[6] = -sp * ct; R[7] = sp * st; R[8] = cp;
      } else if (b >= 7) {                                                     // 钳子：举起（绕 x）+ 张开（绕 y）
        const sx = b === 7 ? -1 : 1, rest = 0.05 + (1 - env) * Math.sin(t * 1.3 + sx) * 0.05;   // 平时：微微晃；举钳 / 缩钳都从这里过渡
        const al = rest + u * (0.45 + 0.12 * Math.sin(tw * 7 + (sx > 0 ? 1.2 : 0))) - hd * 0.17;
        const be = 0.1 + u * (0.02 + 0.18 * Math.max(0, Math.sin(tw * 9 + (sx > 0 ? 0.8 : 0)))) - hd * 0.1;
        const ps = sx * be, ca = Math.cos(al), sa = Math.sin(al), cp = Math.cos(ps), sp = Math.sin(ps);
        R[0] = cp; R[1] = -sp * sa; R[2] = sp * ca; R[3] = 0; R[4] = ca; R[5] = sa; R[6] = -sp; R[7] = -cp * sa; R[8] = cp * ca;
      } else { R[0] = R[4] = R[8] = 1; R[1] = R[2] = R[3] = R[5] = R[6] = R[7] = 0; }
      const ox = pv[0] * S32, oy = pv[1] * S32 + bob, oz = pv[2] * S32;
      if (b === 8) {
        const gripX = (4.2 - pv[0]) * S32, gripY = (5.75 - pv[1]) * S32, gripZ = (8.1 - pv[2]) * S32;
        CS.rightClawGrip.set(ox + R[0] * gripX + R[1] * gripY + R[2] * gripZ,
          oy + R[3] * gripX + R[4] * gripY + R[5] * gripZ, oz + R[6] * gripX + R[7] * gripY + R[8] * gripZ).applyMatrix4(m.matrix);
      }
      for (let v = r.v, ve = r.v + r.nv; v < ve; v++) {
        const k = v * 3, a = rp[k], bb = rp[k + 1], c = rp[k + 2], na = rn[k], nb = rn[k + 1], nc = rn[k + 2];
        p[k] = R[0] * a + R[1] * bb + R[2] * c + ox; p[k + 1] = R[3] * a + R[4] * bb + R[5] * c + oy; p[k + 2] = R[6] * a + R[7] * bb + R[8] * c + oz;
        n[k] = R[0] * na + R[1] * nb + R[2] * nc; n[k + 1] = R[3] * na + R[4] * nb + R[5] * nc; n[k + 2] = R[6] * na + R[7] * nb + R[8] * nc;
      }
    }
    P.needsUpdate = true; N.needsUpdate = true;
    CS.now = { x, y, z, yaw, k: s.k };
    CS.cur = s; CS.t = t; CS.gait = gait; CS.env = env; CS.u = u; CS.tw = tw;   // 被点时从这里接姿势
  }
  // ---- 点一下螃蟹（91-cabin 的 'crab'）：吓一跳，跑回洞里躲一会再出来 ----
  // 日程不动。从现在的姿势（位置 / 朝向 / 步态 / 腿抬到哪）另排一小段路线 CS.ov：
  //   快跑到洞口（CRAB_RUN，平时走 0.24–0.38 m/s）→ 转成进洞的朝向 → 侧身钻进去（躲的位置和朝向直接用日程里某一次 hide 的：
  //   腿和钳子不碰洞壁）→ 躲 hide 秒（8–15 秒：建场景时按种子取的随机数；o.hide 可以直接给）→ 照日程里那次 hide 之后出洞的几段走出来。
  // 走完以后日程从「刚出洞、站在洞口」那一段的开头接着走（CS.off 记下错开的时间），位置和朝向正好对上。
  // 直线到洞口会蹭到礁石：先沿着正在走的这一段到它的一个端点（日程排的时候验证过端点到洞口是通的）再去洞口，不穿石头。
  // 正在往洞里跑 / 躲着 / 日程里本来就在进洞、躲着：不理（返回 false）。出洞走到一半被点：原路退回去再躲一次。
  const CRAB_RUN = 0.65, CRAB_DIVE = 0.5, CRAB_SPIN = 6;                      // 受惊：跑 0.65 m/s、钻洞 0.5 m/s、转身 6 rad/s（平时 2.2）
  function crabBusy() {                                                        // 现在点它没用（看不见 / 已经在躲）？
    const pl = CS.plan, s = CS.cur;
    if (!CS.mesh || !pl || !s || !CS.now) return true;
    if (CS.ov !== null) return CS.ov.si < CS.ov.nf;
    return s.k === 'hide' || (s.k === 'walk' && pl.hideSpots.has(s.p1));
  }
  function crabStartle(o) {
    if (crabBusy()) return false;
    const pl = CS.plan, sg = pl.seg, s = CS.cur, M = pl.M, P = [CS.now.x, CS.now.z];
    const seg = []; let t = 0, p = P, yaw = CS.now.yaw, dist = CS.gait;
    const push = (k, d, p1, a1, dd) => { seg.push({ k, t0: t, d, p0: p, p1, a0: yaw, a1, g0: dist, gd: dd || 0 }); t += d; p = p1; yaw = a1; dist += dd || 0; };
    const face = (dx, dz) => {                                                 // 和日程一样：本地 ±x 对准走的方向，挑转得少的；钳子别朝南
      const y0 = yaw - TAU * Math.round(yaw / TAU), a = Math.atan2(-dz, dx); let best = a, bc = 1e9;
      for (let k = -4; k <= 4; k++) { const c = a + k * Math.PI, w = Math.abs(c - y0) + (Math.cos(c) > 0.2 ? 2 : 0); if (w < bc) { bc = w; best = c; } }
      return best + (yaw - y0);
    };
    const turn = (a1) => { const d = Math.abs(a1 - yaw); if (d > 0.05) push('turn', Math.max(0.25, d / CRAB_SPIN), p, a1, d * 0.08); };
    const run = (p1) => {
      const distance = Math.hypot(p1[0] - p[0], p1[1] - p[1]);
      if (distance < 1e-9) return;
      if (distance >= 0.02) turn(face(p1[0] - p[0], p1[1] - p[1]));
      push('walk', Math.max(0.25, distance / CRAB_RUN), p1, yaw, distance);
    };
    const leavingBurrow = s.k === 'walk' && pl.hideSpots.has(s.p0);
    let hi = -1;                                                               // 照日程里哪一次 hide 躲
    if (leavingBurrow) {                                                       // 出洞走到一半：s 就是出洞那一段，p0 = 那次躲的位置
      for (let i = 0; i < sg.length && hi < 0; i++) if (sg[i].k === 'hide' && sg[i].p0 === s.p0) hi = i;
    } else {
      if (!pl.line(P, M)) {
        let w = null, wl = 1e9;
        for (const q of [s.p0, s.p1]) {
          if (pl.hideSpots.has(q) || !pl.line(q, M)) continue;
          const l = Math.hypot(q[0] - P[0], q[1] - P[1]) + Math.hypot(M[0] - q[0], M[1] - q[1]);
          if (l < wl) { wl = l; w = q; }
        }
        if (!w) return false;                                                  // 没有通的路（不该发生）：宁可不动，不穿石头
        run(w);
      }
      run(M);
      let best = 1e9;                                                          // 到洞口以后转得最少的那一次；一样就挑日程里接下来的那次
      for (let n = 0; n < sg.length; n++) {
        const i = (CS.si + n) % sg.length; if (sg[i].k !== 'hide') continue;
        const d = Math.abs(sg[i].a0 + TAU * Math.round((yaw - sg[i].a0) / TAU) - yaw);
        if (d < best - 1e-6) { best = d; hi = i; }
      }
    }
    if (hi < 0) return false;
    let r = hi + 1; while (r < sg.length && sg[r].k !== 'idle' && sg[r].k !== 'snap') r++;   // 那次 hide 出洞以后停在洞口的那一段
    if (r >= sg.length) return false;
    const H = sg[hi], aIn = H.a0 + TAU * Math.round((yaw - H.a0) / TAU), dy = aIn - H.a0;
    if (!leavingBurrow) turn(aIn);
    const L = Math.hypot(H.p0[0] - p[0], H.p0[1] - p[1]);
    push('walk', Math.max(0.25, L / CRAB_DIVE), H.p0, aIn, L);
    const want = o && Number.isFinite(o.hide) ? Math.max(1, Math.min(60, o.hide)) : 8 + (CS.rng ? CS.rng() : 0.5) * 7;
    push('hide', want, p, yaw);
    const nf = seg.length;
    for (let i = hi + 1; i < r; i++) {                                         // 出洞：日程里的原样（位置数组也是同一个），只是时间、步态接在后面
      const c = sg[i];
      seg.push({ k: c.k, t0: t, d: c.d, p0: c.p0, p1: c.p1, a0: c.a0 + dy, a1: c.a1 + dy, g0: dist, gd: c.gd }); t += c.d; dist += c.gd;
    }
    CS.ov = { seg, T: t, t0: CS.t, si: 0, nf, resume: sg[r].t0, rsi: r, hide: want, e0: CS.env, u0: CS.u, w0: CS.tw };
    return true;
  }
  const crabState = () => {
    const ov = CS.ov;
    return { startled: ov !== null, busy: crabBusy(), phase: ov === null ? 'routine' : ov.si < ov.nf - 1 ? 'flee' : ov.si === ov.nf - 1 ? 'hidden' : 'return',
      left: ov === null ? 0 : ov.t0 + ov.T - CS.t, hide: ov === null ? 0 : ov.hide, offset: CS.off, t: CS.t, k: CS.cur ? CS.cur.k : null };
  };
  MODS.push({
    id: 'crab',
    build(ctx, S) {
      const pl = crabPlan(ctx.rng('sealife:crab'));
      if (!pl) return [];
      if (!pl.ok(pl.HX, pl.MZ)) console.warn('[sealife] 螃蟹洞口外不是湿沙: ' + pl.HX + ', ' + pl.MZ);
      if (!pl.walked) console.warn('[sealife] 螃蟹没找到能走的湿沙');
      const { g, bones } = crabModel(), mg = merge([{ g, bones, noise: 0.05, ao: 0.5 }]), geo = mg.geo;
      geo.attributes.position.setUsage(THREE.DynamicDrawUsage); geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.12, 0), 0.45);              // 顶点每帧在动：包围体固定写大一点（点选 / 视锥）
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(-0.4, -0.05, -0.4), new THREE.Vector3(0.4, 0.35, 0.4));
      const m = new THREE.Mesh(geo, vmat());
      m.matrixAutoUpdate = false;
      // 点选：腿细、每帧在动，直接点网格容易点到腿缝里 → 加一块看不见的盒子罩住身子、腿和钳子（是网格的子物体，跟着走；描边只描螃蟹本身）
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.26, 0.46), new THREE.MeshBasicMaterial({ visible: false }));
      pick.name = 'sealife:crab:pick'; pick.position.set(0, 0.13, 0.095);
      Object.assign(pick.userData, { noShadow: true, noReceive: true, layer: 'site', fbOverlay: true });   // fbOverlay：反馈工具不把这块看不见的盒子当成螃蟹的面
      m.add(pick);
      Object.assign(CS, { mesh: m, plan: pl, ranges: mg.ranges, piv: bones.map(b => b.pivot), rightClawGrip: new THREE.Vector3(), si: 0,
        ov: null, off: 0, cur: null, now: null, t: 0, gait: 0, env: 0, u: 0, tw: 0, rng: ctx.rng('sealife:crab:startle'),   // 新场景 = 新日程：上一个场景的受惊状态不带过来
        rest: Float32Array.from(geo.attributes.position.array), restN: Float32Array.from(geo.attributes.normal.array) });
      crabPose(0);
      S.crab = { hole: [pl.HX, pl.NZ], mouth: [pl.HX, +pl.MZ.toFixed(2)], hide: [pl.HX, +pl.HZ.toFixed(2)], T: +pl.T.toFixed(1), segs: pl.seg.length, walked: pl.walked, plan: pl, pose: crabPose, now: () => CS.now,
        rightClawGrip: CS.rightClawGrip, startle: crabStartle, canStartle: () => !crabBusy(), state: crabState, RUN: CRAB_RUN, DIVE: CRAB_DIVE };
      return [tagMesh(m, '场地/螃蟹', 'sealife:crab', { kind: 'crab', clickable: 'crab', clickAlways: true })];
    },
    update(dt, t) { crabPose(t); },
    dispose() { CS.mesh = null; CS.ov = null; CS.off = 0; CS.cur = null; },
  });
  // @@NEXT@@

  if (V3.scene && V3.scene.part) V3.scene.part({
    id: 'sealife', label: '海洋生物', order: 70,
    build(ctx) {
      V3.parts.declare(Object.keys(LABELS), LABELS);
      const S = { corals: [], stats: {} }, out = [];
      for (const M of MODS) {
        const t0 = performance.now(); M.live = false;
        try {
          const r = M.build(ctx, S) || [];
          let tris = 0; for (const o of r) { out.push(o); o.traverse(m => { if (m.isMesh) tris += triCount(m); }); }
          M.live = true; S.stats[M.id] = { ms: Math.round(performance.now() - t0), meshes: r.length, tris: Math.round(tris) };
        } catch (e) { V3.err('sealife.' + M.id + ': ' + (e && e.stack ? e.stack : e)); }
      }
      V3.sealife = { stats: S.stats, corals: S.corals, fish: S.fish, stars: S.stars, stones: S.stones, crab: S.crab };   // 调试 / 探针用
      return out;
    },
    update(dt, t, ctx) {
      for (const M of MODS) {
        if (!M.live || !M.update) continue;
        try { M.update(dt, t, ctx); } catch (e) { M.live = false; V3.err('sealife.' + M.id + '.update: ' + (e && e.stack ? e.stack : e)); }
      }
    },
    dispose() { for (const M of MODS) if (M.dispose) M.dispose(); for (const p of Object.keys(LABELS)) V3.parts.reset(p); },
  });
})(window.V3);
