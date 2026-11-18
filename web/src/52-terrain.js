// src/52-terrain.js — 场景部件 terrain（order 10）：沙滩 + 海床 + 岛的分层侧面 + 石堆 + 礁石 + 潮线。
// 用户第5轮：海岸线弯曲不规整、干沙上低矮小沙丘、沙纹、湿沙带、潮线（海草 + 碎贝壳小体素）。
// 海床阶梯状下降到约 −4 m；侧面分层 沙 / 砂岩 / 石头（参考 v1 的 10-terrain.js：台阶边偶尔放半砖）。
// 导出 V3.terrain = { CELL, shoreZ(x), tideZ(x), groundY(x,z), heightAt(x,z), seabedY(x,z), isWet(x,z), depthAt(x,z) }。
(function (V3) {
  'use strict';
  const U = V3.util, L = V3.layout;
  const S = L.site, SEA = L.sea.y, CELL = 0.5, Q = 0.25;          // 0.5 m 一格；高度按 0.25 m（半砖）量化
  const NX = Math.round((S.x1 - S.x0) / CELL), NZ = Math.round((S.z1 - S.z0) / CELL);
  const Y0 = S.bottomY - 0.5, NY = 18;                            // y −6.5 … +2.5（最底一行只做支撑，不出面）
  const byId = (a, id) => (a || []).find(o => o.id === id);
  const O = id => byId(L.outside, id), PL = id => byId(L.plants, id);

  // ---- 噪声（值噪声 + fbm；确定性，不用 Math.random） ----
  const vn = (x, z, s) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz), h = (a, b) => U.hash3(a, b, s);
    return U.lerp(U.lerp(h(xi, zi), h(xi + 1, zi), ux), U.lerp(h(xi, zi + 1), h(xi + 1, zi + 1), ux), uz) * 2 - 1;
  };
  const fbm = (x, z, s, oct = 3) => {
    let a = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { a += amp * vn(x * f, z * f, s + i * 17); amp *= 0.5; f *= 2.03; }
    return a;
  };
  const gauss = (v, w) => Math.exp(-(v * v) / (2 * w * w));
  const rectD = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

  // ---- 海岸线：几道正弦 + 一点噪声 + 东礁处的小岬角 + 西边的小海湾 ----
  const shoreZ = x => U.clamp(L.sea.shoreZ + 0.9 * Math.sin(0.23 * x + 0.6) + 0.5 * Math.sin(0.51 * x + 2.1)
    + 0.25 * Math.sin(1.13 * x + 0.4) + 0.35 * fbm(x * 0.4, 3.7, 71)
    + 1.2 * gauss(x - 16, 2.5) - 1.0 * gauss(x + 8, 3.5), 9.0, 14.5);
  const wetW = x => 1.6 + 0.25 * (1 + Math.sin(0.37 * x + 1.3));      // 湿沙带宽 1.6–2.1 m
  const tideZ = x => shoreZ(x) - wetW(x) - 0.35;                       // 潮线（零星小卵石；真贝壳由 62-beach-items 冲上来）

  // ---- 海床：离岸距离 d → 高度（浅水 0.25 m 一级，深水 0.5 m 一级，到 −4 变平） ----
  const bedProfile = (x, z) => {
    let d = z - shoreZ(x);
    if (d > 1.0) d += 1.6 * fbm(x * 0.18, z * 0.18, 23);              // 等深线也是弯的
    if (d < 1.4) return -0.25;
    if (d < 4.2) return -0.5;
    if (d < 7.5) return -0.75;
    let b = Math.max(-4, -0.5 - 0.5 * Math.min(7, 1 + Math.floor((d - 7.5) / 2.3)));
    if (b > -1.6 && b < -0.6 && fbm(x * 0.3, z * 0.3, 41) > 0.3) b += 0.25;   // 小沙洲
    return b;
  };
  const BUMPS = (() => {                                              // 深水区海底的几块石头（珊瑚可以长在上面）
    const r = U.rng(5201), a = [];
    for (let i = 0; i < 7; i++) a.push({ x: S.x0 + 4 + r() * (S.x1 - S.x0 - 8), z: 24 + r() * 14, r: 0.7 + r() * 1.0, h: 0.5 + Math.floor(r() * 3) * 0.25 });
    return a;
  })();

  // ---- 小沙丘：fbm × 遮罩（房子、门廊、台阶、通向海的小路、石堆、箱子、椰子树、爬藤附近为 0） ----
  const H = L.house, P = L.porch, ST = P.steps;
  let FR = null;
  const flatRects = () => [
    [H, 1.5], [P, 1.2], [ST, 1.2], [O('rocks'), 0.8], [O('chest'), 0.8], [O('stepMat'), 0.8],
    [PL('creepW'), 0.3], [PL('creepE'), 0.3], [O('reefE'), 0.5],
    [O('beachSet'), 0.25],                                                     // 沙滩椅 + 遮阳伞 + 小圆桌：压平，外沿 0.5 m 平缓过渡
    [{ x0: ST.x0 - 0.5, x1: ST.x1 + 0.5, z0: ST.z1, z1: S.z1 }, 0.8],          // 台阶通向海的小路
  ].filter(a => a[0]);
  const duneW = (x, z) => {                                             // 保险：房子、门廊、小路等永远是平地
    FR = FR || flatRects();
    let w = 1;
    for (const [r, m] of FR) w = Math.min(w, U.smooth(0.4, 0.4 + 2 * m, rectD(r, x, z)));
    for (const id of ['palmW', 'palmE']) { const p = PL(id); if (p) w = Math.min(w, U.smooth(0.8, 2.2, Math.hypot(x - p.x, z - p.z))); }
    return w;
  };
  // 干沙基本是平的；只有三个大而缓的沙丘（直径 6–10 m，最高 0.5 m），边缘按 1/8 m 一圈圈降下来（同心的等高线）
  const DUNES = [
    { x: -19.5, z: -1.0, rx: 5.0, rz: 3.8, a: 0.35, h: 0.5, s: 81 },    // 西边，石堆和藤蔓的西南
    { x: 19.0, z: -6.5, rx: 5.0, rz: 4.2, a: -0.5, h: 0.5, s: 83 },     // 东边，藤蔓外侧
    { x: -17.0, z: -13.5, rx: 4.4, rz: 3.2, a: 0.2, h: 0.375, s: 85 },  // 屋后西北，小一点
  ];
  const DSTEP = 0.125;
  const duneH = (x, z) => {
    let h = 0;
    for (const d of DUNES) {
      const dx = x - d.x, dz = z - d.z, ca = Math.cos(d.a), sa = Math.sin(d.a);
      const u = (dx * ca + dz * sa) / d.rx, v = (-dx * sa + dz * ca) / d.rz;
      const e = Math.hypot(u, v) * (1 + 0.16 * fbm(x * 0.35, z * 0.35, d.s));   // 轮廓稍微不圆
      if (e >= 1) continue;
      h = Math.max(h, d.h * U.clamp((1 - e) / 0.7, 0, 1));             // 圆锥形：每圈宽度相同，顶上一小块平
    }
    if (h <= 0) return 0;
    return Math.floor(h * duneW(x, z) / DSTEP + 1e-6) * DSTEP;
  };

  // ---- 礁石：块状圆顶（0.5 m 一阶，偶尔 0.25）；石堆：三层台阶状灰石 + 散落小石块 ----
  const reefTop = (r, x, z, seed) => {                                  // 四层：t0, t0−0.5, t0−1, t0−1.5（t0 ≈ 海面 + h）
    if (!r) return null;
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, rx = (r.x1 - r.x0) / 2, rz = (r.z1 - r.z0) / 2;
    const e = Math.hypot((x - cx) / rx, (z - cz) / rz) + 0.3 * fbm(x * 0.7, z * 0.7, seed);
    if (e > 1) return null;
    const t0 = Math.round((SEA + (r.h || 1)) / 0.5) * 0.5, tier = e < 0.45 ? 0 : e < 0.75 ? 1 : e < 0.92 ? 2 : 3;
    return t0 - 0.5 * tier - (U.hash3(Math.floor(x * 2), Math.floor(z * 2), seed) < 0.25 ? Q : 0);
  };
  const HOLE_X = (() => { const r = O('reefE'); return r ? r.x0 + (r.x1 - r.x0) * 0.4 : null; })();   // 螃蟹洞：东礁北侧朝沙滩
  const rockTop = (x, z) => {
    const r = O('rocks'); if (!r) return null;
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, rx = (r.x1 - r.x0) / 2, rz = (r.z1 - r.z0) / 2;
    const ax = Math.abs(x - cx) / rx, az = Math.abs(z - cz) / rz;
    const e = 0.6 * Math.max(ax, az) + 0.4 * Math.hypot(ax, az) + 0.2 * fbm(x * 0.9, z * 0.9, 31) + 0.12 * ((x - cx) / rx + (z - cz) / rz);   // 西北高、东南低
    const hx = r.h || 1.5, hh = U.hash3(Math.floor(x * 2), Math.floor(z * 2), 77);
    if (e < 0.45) return hx;
    if (e < 0.72) return hx * 2 / 3 + (hh < 0.15 ? Q : 0);
    if (e < 0.98) return hx / 3 + (hh < 0.2 ? Q : 0);
    if (e < 1.3 && hh < 0.1) return Q;                                  // 散落的小石块（半砖）
    return null;
  };
  // ---- 每列高度表（懒算一次；groundY 和构建都用它，保证一致） ----
  // kind 0 干沙 · 1 湿沙 · 2 海床；bed = 沙面/海床（含沙丘）；top = 地表（再加石堆/礁石/海底石）；rock 0 无 1 石堆 2 东礁 3 西礁 4 海底石
  let T = null, V = null;
  const colX = i => S.x0 + (i + 0.5) * CELL, colZ = k => S.z0 + (k + 0.5) * CELL;
  function locateCrabBurrow(rock) {
    if (HOLE_X == null) return null;
    const column = Math.floor((HOLE_X - S.x0) / CELL);
    for (let row = 0; row < NZ; row++) {
      const first = column + NX * row;
      if (rock[first] !== 2) continue;
      const cells = new Set();
      for (let step = 0; step < 3 && rock[first + step * NX] === 2; step++) cells.add(first + step * NX);
      return { cells, x: colX(column), frontZ: S.z0 + row * CELL };
    }
    return null;
  }
  const burrowFloor = (bed) => Y0 + Math.ceil((bed - Y0) / CELL) * CELL;
  function hermitDen(rock, top, bed) {
    const ridge = O('rocks'); if (!ridge) return null;
    const column = Math.floor(((ridge.x0 + ridge.x1) / 2 - S.x0) / CELL);
    const cells = new Set(); let opening;
    for (let row = Math.floor((ridge.z1 + 1 - S.z0) / CELL); row > 1; row--) {
      const left = column + NX * row, pair = [left, left + 1];
      if (!opening && !pair.some(index => rock[index] === 1)) continue;
      if (!opening) opening = { x: colX(column) + CELL / 2, frontZ: colZ(row) + CELL / 2, cells };
      pair.forEach(index => cells.add(index));
      if (pair.every(index => top[index] >= burrowFloor(bed[index]) + .75)) return opening;
    }
    return null;
  }
  const table = () => {
    if (T) return T;
    const n = NX * NZ, top = new Float32Array(n), bed = new Float32Array(n), kind = new Uint8Array(n), rock = new Uint8Array(n);
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
      const x = colX(i), z = colZ(k), c = i + NX * k, sz = shoreZ(x);
      let b, kd;
      if (z < sz) { b = duneH(x, z); kd = z > sz - wetW(x) ? 1 : 0; } else { b = bedProfile(x, z); kd = 2; }
      let t = b, rk = 0;
      const rt = kd === 0 ? rockTop(x, z) : null;
      if (rt != null && rt > t) { t = rt; rk = 1; }
      for (const [id, code, seed] of [['reefE', 2, 61], ['reefW', 3, 67]]) {
        const v = reefTop(O(id), x, z, seed); if (v != null && v > t) { t = v; rk = code; }
      }
      if (kd === 2 && !rk) for (const bm of BUMPS) if (Math.hypot(x - bm.x, z - bm.z) < bm.r && b + bm.h > t) { t = b + bm.h; rk = 4; }
      bed[c] = b; kind[c] = kd; top[c] = t; rock[c] = rk;
    }
    for (let pass = 0; pass < 3; pass++) for (let k = 1; k < NZ - 1; k++) for (let i = 1; i < NX - 1; i++) {   // 沙丘：去掉孤立的尖和坑，坡不陡于半格
      const c = i + NX * k; if (kind[c] === 2) continue;
      const a0 = bed[c - 1], a1 = bed[c + 1], a2 = bed[c - NX], a3 = bed[c + NX], v = bed[c];
      const lo = Math.min(a0, a1, a2, a3), hi = Math.max(a0, a1, a2, a3);
      const nv = Math.max(0, Math.min(v > hi ? hi : v < lo ? lo : v, lo + 0.5));
      if (nv !== v) { bed[c] = nv; top[c] = rock[c] ? Math.max(top[c], nv) : nv; }
    }
    const b0 = bed.slice();                                           // 海床台阶边偶尔垫半砖（v1 做法）
    for (let k = 1; k < NZ - 1; k++) for (let i = 1; i < NX - 1; i++) {
      const c = i + NX * k; if (kind[c] !== 2 || rock[c]) continue;
      const hi = Math.max(b0[c - 1], b0[c + 1], b0[c - NX], b0[c + NX]);
      if (hi - b0[c] >= 0.5 && b0[c] % 0.5 === 0 && U.hash3(i, k, 91) < 0.22) { bed[c] += Q; top[c] = bed[c]; }
    }
    return (T = { top, bed, kind, rock, burrow: locateCrabBurrow(rock), den: hermitDen(rock, top, bed) });
  };

  // ---- 方块表（自己的体素：方块 id + 半砖 + 标签），之后交给 V3.blocks.World，或者预览用 V3.vox ----
  const B = ['', 'sand', 'sand_ripple', 'wet_sand', 'sandstone', 'cut_sandstone', 'stone', 'andesite', 'diorite',
    'gravel', 'clay', 'deepslate', 'cobblestone', 'mossy_cobblestone', 'rock', 'sand_damp', 'wet_dark'];
  const BI = Object.fromEntries(B.map((nm, i) => [nm, i]));
  const COL = { sand: 0xead5a3, sand_ripple: 0xe3cc98, wet_sand: 0xc9ab78, sandstone: 0xd9c18a, cut_sandstone: 0xceb27a,
    stone: 0x8f8b84, andesite: 0x8e8d88, diorite: 0xa9a7a1, gravel: 0x8c837b, clay: 0xe2b9a4, deepslate: 0x56565d,
    cobblestone: 0x88847c, mossy_cobblestone: 0x7d8a68, rock: 0x9c978e, sand_damp: 0xd9c08c, wet_dark: 0xb39565 };
  const TAGS = ['', '场地/沙滩', '场地/湿沙', '场地/沙丘', '场地/海床', '场地/岛侧', '场地/石堆', '场地/礁石/东', '场地/礁石/西'];
  const vid = (i, j, k) => i + NX * (j + NY * k);
  const rockBlk = (i, j, k, rk) => {                                  // rock = 露出的灰石（stone 是地层里的石头）
    const h = U.hash3(i, j * 7 + rk, k);
    if (rk === 1) return h < 0.45 ? 'rock' : h < 0.7 ? 'cobblestone' : h < 0.88 ? 'andesite' : 'mossy_cobblestone';
    return h < 0.35 ? 'rock' : h < 0.6 ? 'andesite' : h < 0.85 ? 'mossy_cobblestone' : 'cobblestone';
  };
  const ripple = (x, z) => fbm(x * 0.12, z * 0.16, 19) > 0.12;         // 干沙上几大片沙纹（每片几米）
  const fill = () => {
    if (V) return V;
    const t = table(), n = NX * NY * NZ, blk = new Uint8Array(n), half = new Uint8Array(n), tag = new Uint8Array(n);
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
      const c = i + NX * k, x = colX(i), z = colZ(k), b = t.bed[c], tp = t.top[c], kd = t.kind[c], rk = t.rock[c];
      const sandF = Math.min(-1.5 + 0.5 * vn(x * 0.21, z * 0.21, 3), b - 0.5);          // 沙层底（陆地约 3 格）
      const stoneB = Math.min(-3.5 + 0.5 * vn(x * 0.17, z * 0.17, 5), sandF - 1.5);    // 砂岩层底
      const edge = kd === 2 && !rk && [c - 1, c + 1, c - NX, c + NX].some(d => d >= 0 && d < NX * NZ && t.kind[d] === 2 && t.bed[d] <= b - 0.5);
      const ch = t.burrow?.cells.has(c) || t.den?.cells.has(c);
      for (let j = 0; j < NY; j++) {
        const y = Y0 + j * CELL; if (y >= tp) break;
        let nm, tg;
        if (y >= b) {                                                 // 沙面以上：石堆 / 礁石 / 海底石
          if (ch && y < burrowFloor(b) + CELL) continue;
          nm = rockBlk(i, j, k, rk); tg = rk === 1 ? 6 : rk === 2 ? 7 : rk === 3 ? 8 : 4;
        } else if (b - y <= CELL) {                                   // 地表这一格
          if (kd === 0) {                                             // 干沙：潮线下面一条半干的沙，沙丘和几大片沙纹
            const dz = z - tideZ(x) - 0.45 * (1 + vn(x * 0.3, 2.5, 17));
            nm = dz > -0.25 ? 'sand_damp' : (b > 0 || ripple(x, z)) ? 'sand_ripple' : 'sand'; tg = b > 0 ? 3 : 1;
          } else if (kd === 1) { nm = z > shoreZ(x) - 0.55 - 0.35 * (1 + vn(x * 0.4, 4.5, 18)) ? 'wet_dark' : 'wet_sand'; tg = 2; }
          else {
            const p = vn(x * 0.4, z * 0.4, 29);                       // 海床上零星的砾石 / 珊瑚砂
            nm = b >= -0.25 ? 'wet_sand' : edge ? 'sandstone' : p > 0.8 ? 'wet_dark' : p < -0.7 ? 'clay' : 'sand'; tg = 4;   // 海床深色斑用湿沙（灰砾石在水下像黑洞）
          }
        } else if (kd === 0 && y >= 0) { nm = 'sand'; tg = 3; }       // 沙丘里面
        else {                                                        // 岛的分层侧面
          tg = 5;
          if (j < 2) nm = 'deepslate';
          else if (edge && y >= b - 1.5) nm = 'sandstone';            // 海床台阶的立面
          else if (y >= sandF) nm = 'sand';
          else if (y >= sandF - CELL) nm = 'cut_sandstone';
          else if (y >= stoneB) nm = 'sandstone';
          else {
            const p = vn(x * 0.35 + y * 0.6, z * 0.35 - y * 0.4, 7);
            nm = p > 0.42 ? 'andesite' : p < -0.55 ? 'diorite' : (y > stoneB - 1.0 && vn(x * 0.5, z * 0.5 + y, 9) > 0.5) ? 'gravel' : 'stone';
          }
        }
        const id = vid(i, j, k), f = tp - y;                         // 顶上不满一格：记成 1/8 格的层数（半砖 = 4）
        blk[id] = BI[nm]; half[id] = f < CELL - 1e-4 ? Math.max(1, Math.round(f / CELL * 8)) : 0; tag[id] = tg;
      }
    }
    return (V = { blk, half, tag });
  };

  // ---- 导出（小鲸鱼走路、脚印、绿植都用） ----
  const colOf = (x, z) => U.clamp(Math.floor((x - S.x0) / CELL), 0, NX - 1) + NX * U.clamp(Math.floor((z - S.z0) / CELL), 0, NZ - 1);
  const TR = V3.terrain = {
    CELL, NX, NY, NZ, Y0, shoreZ, tideZ, wetW,
    get crabBurrow() { return table().burrow; },
    get hermitDen() { return table().den; },
    snowSurface(x, z) {
      const terrain = table(), index = colOf(x, z);
      if (terrain.burrow?.cells.has(index) || terrain.den?.cells.has(index)) {
        if (terrain.top[index] <= burrowFloor(terrain.bed[index]) + CELL) return null;
      }
      return !terrain.kind[index] || terrain.rock[index] && terrain.top[index] > SEA + .3 ? terrain.top[index] : null;
    },
    crabFloorY(x, z) {
      const terrain = table(), column = colOf(x, z), bed = terrain.bed[column];
      return terrain.burrow?.cells.has(column) ? burrowFloor(bed) : bed;
    },
    groundY: (x, z) => table().top[colOf(x, z)],                    // 地表（含沙丘、石堆、礁石）
    seabedY: (x, z) => table().bed[colOf(x, z)],                    // 沙面 / 海床（不含石堆礁石）
    isWet: (x, z) => table().kind[colOf(x, z)] > 0,                 // 湿沙带或水下
    depthAt: (x, z) => Math.max(0, SEA - table().top[colOf(x, z)]),
  };
  TR.heightAt = TR.groundY;

  // ---- 网格化：有 V3.blocks.World 用方块（贴图 + AO + 半砖）；还没有时用 V3.vox 顶点色预览（半砖略去） ----
  const TILE = {                                                      // 方块 → 图集贴图（04-atlas.js 的名字）
    sand: { top: 'sand', side: 'strata1', bottom: 'strata1' }, sand_ripple: { top: 'sandRipple', side: 'strata1', bottom: 'strata1' },
    wet_sand: 'sandWet', sandstone: { top: 'sandstoneTop', side: 'strata2', bottom: 'sandstoneTop' },
    cut_sandstone: { top: 'sandstoneTop', side: 'cutSandstone', bottom: 'sandstoneTop' }, stone: 'strata3', rock: 'stone',
    andesite: 'andesite', diorite: 'polishedAndesite', gravel: 'gravel', clay: 'coralSand', deepslate: 'deepslate',
    cobblestone: 'cobble', mossy_cobblestone: 'stoneMoss',
    sand_damp: { top: 'sand', side: 'strata1', bottom: 'strata1' }, wet_dark: 'sandDark',
  };
  const TINT = { sand_damp: 0xf0e8dc };                                 // 潮线下面半干的沙：干沙贴图压暗一点
  let MAT = null;
  const voxMat = () => { if (!MAT) { MAT = V3.vox.material({ roughness: 0.92 }); MAT.userData.shared = true; } return MAT; };
  const tilesOk = (t, nm) => {                                        // 图集里没有的贴图名退回 'sand'，免得出洋红黑格子
    const ok = n => !V3.atlas || !V3.atlas.has || V3.atlas.has(n), fix = n => (ok(n) ? n : (console.warn('terrain: 图集缺贴图 ' + n + '（' + nm + '）'), 'sand'));
    return typeof t === 'string' ? fix(t) : Object.fromEntries(Object.entries(t).map(([k, n]) => [k, fix(n)]));
  };
  const meshBlocks = () => {                                          // 不满一格的顶用形状变体 'beach_xxx.layer'（h = 1/8 格数，同贴图）
    const v = fill(), t = table(), BK = V3.blocks;
    for (const nm of B) if (nm) { const tiles = tilesOk(TILE[nm], nm); BK.def('beach_' + nm, TINT[nm] != null ? { tiles, tint: TINT[nm] } : { tiles }); }
    const w = new BK.World({ cell: CELL, origin: [S.x0, Y0, S.z0], size: [NX, NY, NZ], tileCells: 1 });
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const id = vid(i, j, k), b = v.blk[id]; if (!b) continue;
      const h = v.half[id], tag = TAGS[v.tag[id]];
      w.set(i, j, k, 'beach_' + B[b], h ? { shape: 'layer', h, tag } : { tag });
    }
    // 分两块：干沙 + 石堆 / 礁石 / 海底石头照常投影；湿沙带和海床不投影（低太阳下 0.25 m 台阶角会在岸边投出一串黑三角）。
    // 'solid' = 不输出但照样剔除邻面，两块接缝处不多面。
    const casts = (i, k) => { const c = i + NX * k; return t.kind[c] === 0 || t.rock[c] > 0; };
    const part = want => (i, j, k) => (j === 0 ? 'solid' : casts(i, k) === want ? true : 'solid');
    const land = w.mesh({ anchor: 'house2:terrain', filter: part(true) });                     // 最底一行只遮挡
    const sea = w.mesh({ anchor: 'house2:terrain-sea', filter: part(false) });
    sea.userData.noShadow = true;
    const g = new THREE.Group(); g.name = 'terrain'; g.add(land, sea);
    return g;
  };
  const meshVox = () => {                                             // 预览后备：顶点色，去掉最底一行和朝下的底面
    const v = fill(), g = new V3.vox.Grid(NX, NY, NZ, { origin: [0, 0, 0] });
    for (let k = 0; k < NZ; k++) for (let j = 1; j < NY; j++) for (let i = 0; i < NX; i++) {
      const id = vid(i, j, k), b = v.blk[id]; if (!b || v.half[id]) continue;
      g.t(TAGS[v.tag[id]]).c(COL[B[b]]).set(i, j, k);
    }
    const m = V3.vox.mesh(g, { scale: CELL, noise: 0.07, ao: 0.5 })[0], geo = m.geometry;
    const I = geo.index.array, Pa = geo.attributes.position.array, Na = geo.attributes.normal.array, keep = [], tt = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3; if (Na[a + 1] < -0.5 && Pa[a + 1] < CELL * 1.5) continue;
      keep.push(I[t], I[t + 1], I[t + 2]); tt.push(m.triTag[t / 3]);
    }
    geo.setIndex(keep); geo.clearGroups();
    for (let s = 0, t = 1; t <= tt.length; t++) if (t === tt.length || tt[t] !== tt[s]) { geo.addGroup(s * 3, (t - s) * 3, tt[s]); s = t; }
    const mesh = new THREE.Mesh(geo, m.faceTags.map(() => voxMat()));
    mesh.position.set(S.x0 + CELL / 2, Y0, S.z0 + CELL / 2);
    Object.assign(mesh.userData, { faceTags: m.faceTags, triTag: Uint16Array.from(tt) });
    return mesh;
  };
  // ---- 潮线：只留零星几小撮卵石（用户反馈 fb-20261105-054428-dji「去掉海草吧」；碎贝壳和海星也去掉，
  // 免得和能捡的真贝壳 62-beach-items 混淆）。1/32 m 体素原型，沿潮线摆放后合并成一个网格，不要底面 ----
  const tideMesh = () => {
    const r = U.rng(5207), VS = 1 / 32;
    const STONE = [0x9c978e, 0x7f7b75, 0xb5afa4, 0x6d6964, 0xa89f92];
    const proto = (fn) => {
      const g = new V3.vox.Grid(24, 4, 24); fn(g);
      const m = V3.vox.mesh(g, { scale: VS, noise: 0.08, ao: 0.4 })[0];
      return m ? m.geometry : null;
    };
    const stone = (g, x0, z0, rx, rz, c) => {                         // 一颗扁圆的小卵石，中间高一格
      g.c(c);
      for (let z = -rz; z <= rz; z++) for (let x = -rx; x <= rx; x++) {
        const e = (x * x) / ((rx + 0.5) * (rx + 0.5)) + (z * z) / ((rz + 0.5) * (rz + 0.5));
        if (e > 1) continue;
        g.set(x0 + x, 0, z0 + z);
        if (e < 0.3) g.set(x0 + x, 1, z0 + z);
      }
    };
    const pebbles = (g, n) => {                                       // 一小撮：n 颗 9–16 cm 的卵石
      for (let s = 0; s < n; s++) {
        const rx = r() < 0.4 ? 2 : 1;
        stone(g, Math.round((r() - 0.5) * 12), Math.round((r() - 0.5) * 12), rx, 1, STONE[r() * STONE.length | 0]);
      }
    };
    const P = [1, 1, 2, 2, 3].map(n => proto(g => pebbles(g, n)));
    const pos = [], nor = [], col = [], idx = [];
    const put = (geo, x, y, z, a) => {
      const P0 = geo.attributes.position.array, N0 = geo.attributes.normal.array, C0 = geo.attributes.color.array, I0 = geo.index.array;
      const ca = Math.cos(a), sa = Math.sin(a), base = pos.length / 3;
      for (let i = 0; i < P0.length; i += 3) {
        pos.push(x + P0[i] * ca - P0[i + 2] * sa, y + P0[i + 1], z + P0[i] * sa + P0[i + 2] * ca);
        nor.push(N0[i] * ca - N0[i + 2] * sa, N0[i + 1], N0[i] * sa + N0[i + 2] * ca);
        col.push(C0[i], C0[i + 1], C0[i + 2]);
      }
      for (let t = 0; t < I0.length; t += 3) if (N0[I0[t] * 3 + 1] > -0.5) idx.push(base + I0[t], base + I0[t + 1], base + I0[t + 2]);
    };
    const tb = table(), BS = O('beachSet');
    for (let x = S.x0 + 1.5; x < S.x1 - 1.5; x += 2.2 + r() * 2.6) {  // 每 2–5 m 一小撮，比原来稀很多
      const z = tideZ(x) + (r() - 0.6) * 1.2, c = colOf(x, z);
      if (tb.kind[c] !== 0 || tb.rock[c] || tb.top[c] !== 0 || (BS && rectD(BS, x, z) < 0.5)) continue;
      const k = r() * P.length | 0; if (P[k]) put(P[k], x, 0.002, z, r() * 6.283);
    }
    for (const g of P) if (g) g.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.addGroup(0, idx.length, 0); geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, [voxMat()]);
    Object.assign(mesh.userData, { faceTags: ['场地/潮线'], triTag: new Uint16Array(idx.length / 3), anchor: 'house2:terrain-tide', layer: 'site', noShadow: true });
    return mesh;
  };
  // @@NEXT@@

  // ---- 场景部件 ----
  const LABELS = { '场地': '场地', '场地/沙滩': '沙滩（干沙 + 沙纹）', '场地/湿沙': '湿沙带', '场地/沙丘': '小沙丘', '场地/海床': '海床（台阶状）',
    '场地/岛侧': '岛的侧面（沙 / 砂岩 / 石头分层）', '场地/石堆': '石块堆', '场地/礁石': '礁石', '场地/礁石/东': '东礁石（螃蟹的家）',
    '场地/礁石/西': '西礁石', '场地/潮线': '潮线（小卵石）' };
  if (V3.scene && V3.scene.part) V3.scene.part({
    id: 'terrain', label: '沙滩地形', order: 10,
    build() {
      V3.parts.declare(Object.keys(LABELS), LABELS);
      let ground = null;
      if (V3.blocks && V3.blocks.World) {
        try { ground = meshBlocks(); } catch (e) { console.warn('terrain: 方块网格化暂不可用，先用顶点色预览：' + e); ground = null; }
      }
      if (!ground || !ground.isObject3D) ground = meshVox();          // 方块网格化还没写完时用顶点色预览
      let n = 0;
      ground.traverse(o => {
        if (!o.isMesh) return;
        o.userData.layer = 'site'; if (!o.userData.anchor) o.userData.anchor = 'house2:terrain' + (n ? '-' + n : ''); n++;
        if (o.userData.faceTags) V3.parts.tagFaces(o);
      });
      const tide = tideMesh(); V3.parts.tagFaces(tide);
      return [ground, tide];
    },
    dispose() { V3.parts.reset('场地'); },
  });
})(window.V3);
