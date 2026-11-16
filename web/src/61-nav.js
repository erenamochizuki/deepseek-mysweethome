// src/61-nav.js — V3.nav（plan）：小鲸鱼走路用的 0.25 m 网格，覆盖整块场地 x −26..26、z −18..40。
// 每个小格最多 2 层能站的面（MAXL）：沙地 / 门廊 / 一楼地板是第 0 层，阁楼地板是第 1 层。节点 = 层 × N + 格。
// 房子是 MC 方块（54-house-mc 的 V3.houseBlocks）：一格里从下往上的实心段（方块碰撞盒 + 沙面）里，
//   某段的顶面上面空着 ≥ CLEAR 米就是一个能站的面；家具（V3.layout.ground / loft）只挡路，不能站上去。
// 相邻两格高差 ≤ STEP（0.55 m：MC 的楼梯、台阶是半格一级）才连通；门廊边上、阁楼楼梯口不能直接跳下去。
// 身体半径 R：旁边一格在「脚下 STEP 到头顶」之间有实心的，这格就算挨着障碍（margin），走格子中心就不会蹭到墙。
// 沙滩上的石头、礁石、深水、场地边、椰子树照旧按布局挡；木箱、花箱、盆栽、沙滩椅这些模组方块按房子里的方块挡（HB.furnSolids）。
// API：walkable(x,z,y?)、heightAt(x,z,y?)、surface(x,z,y?)、blockedBy(x,z,y?)（y 是她现在的高度，用来选层；不给 = 最下面一层），
//   path([x,z,y?],[x,z,y?]) → [[x,z,y]…]、nearest、reachable、randomPoint(zone)（zone：beach / porch / tideline / inside / loft / any）、
//   setDoor(open)（默认开着：门由 54-house-mc 在她走近时打开；关着时门那一格挡死）、rebuild()（房子的方块变了就重建）。
(function (V3) {
  'use strict';
  if (!V3.util || !V3.layout) return;
  const U = V3.util, L = V3.layout, C = 0.25, R = 0.25, STEP = 0.55, DEEP = 0.35, EDGE = 0.75, EPS = 1e-6;
  const CLEAR = 1.45, MAXL = 2, NONE = 255;
  const S0 = L.site, NX = Math.round((S0.x1 - S0.x0) / C), NZ = Math.round((S0.z1 - S0.z0) / C), N = NX * NZ;
  const KIND = ['sand', 'wet', 'water', 'wood', 'mat', 'floor'];          // surface 编号 0..5（wood = 门廊和台阶的木板）
  const WHY = ['', 'house', 'rail', 'rock', 'tree', 'prop', 'water', 'edge', 'margin', 'furniture', 'none'];
  const B = { HOUSE: 1, RAIL: 2, ROCK: 3, TREE: 4, PROP: 5, WATER: 6, EDGE: 7, MARGIN: 8, FURN: 9, NONE: 10 };
  const cx = (i) => S0.x0 + (i + 0.5) * C, cz = (k) => S0.z0 + (k + 0.5) * C;
  const inR = (r, x, z) => x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1;
  const rectD = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
  const segD = (x, z, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, t = l2 ? U.clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0;
    return Math.hypot(x - ax - t * dx, z - az - t * dz);
  };
  // 外墙、门廊、台阶：布置模式挪过房子时用摆好以后的（54-house-mc 的 HB.placedLayout()）；rebuild() 时重新取
  let H = L.house, P = L.porch, ST = P && P.steps;
  const placed = () => { const HBk = V3.houseBlocks, LP = HBk && HBk.placedLayout ? HBk.placedLayout() : L; H = LP.house; P = LP.porch; ST = P && P.steps; return LP; };
  const cellOf = (n) => n % N, layerOf = (n) => (n / N) | 0;

  // ---- 家具：挡路的高度段（不能站上去）。地毯、地垫、吊着的、比她头高的挂墙物不挡 ----
  const furnSolids = () => {
    const out = [], head = (y) => y + (L.girlH || 1.3) + 0.1;
    for (const [list, base] of [[L.ground || [], H.floorY], [L.loft || [], H.loftY]]) {
      for (const o of list) {
        if (o.ceiling || !(o.h >= 0.1)) continue;
        const y0 = o.wallY != null ? o.wallY : base;
        if (o.wallY != null && o.wallY >= head(base)) continue;
        out.push({ r: o, y0, y1: y0 + o.h });
      }
    }
    return out;
  };

  // ---- 建网格（第一次用到时建；V3.nav.rebuild() 之后重建）：terrain 一份，门开 / 关各一份层数据 ----
  const build = () => {
    placed();
    const t0 = performance.now(), TR = V3.terrain, HBk = V3.houseBlocks && V3.houseBlocks.grid ? V3.houseBlocks : null;
    const sea = L.sea ? L.sea.y : -0.15, shore = L.sea ? L.sea.shoreZ : 12;
    const gY = TR && TR.groundY ? TR.groundY : (x, z) => (z < shore ? S0.sandY : sea - 1);
    const bY = TR && TR.seabedY ? TR.seabedY : gY, wet = TR && TR.isWet ? TR.isWet : (x, z) => z >= shore - 1.8;
    const tide = TR && TR.tideZ ? TR.tideZ : () => shore - 2.2, shz = TR && TR.shoreZ ? TR.shoreZ : () => shore;
    // 地形：沙 / 湿沙 / 水；石头；深水；场地边
    const tH = new Float32Array(N), tK = new Uint8Array(N), tB = new Uint8Array(N), rock = new Uint8Array(N);
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
      const c = i + NX * k, x = cx(i), z = cz(k), top = gY(x, z), d = sea - top;
      tH[c] = top; tK[c] = d > EPS ? 2 : wet(x, z) ? 1 : 0;
      if (top - bY(x, z) > 0.05) { tB[c] = B.ROCK; rock[c] = 1; }
      else if (d > DEEP) tB[c] = B.WATER;
      else if (Math.min(x - S0.x0, S0.x1 - x, z - S0.z0, S0.z1 - z) < EDGE) tB[c] = B.EDGE;
    }
    const m = Math.ceil(R / C);                                           // 石头外扩一圈
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
      if (!rock[i + NX * k]) continue;
      for (let dk = -m; dk <= m; dk++) for (let di = -m; di <= m; di++) {
        const ii = i + di, kk = k + dk, c2 = ii + NX * kk;
        if (ii < 0 || kk < 0 || ii >= NX || kk >= NZ || tB[c2]) continue;
        if (Math.hypot(Math.max(0, Math.abs(di) - 0.5), Math.max(0, Math.abs(dk) - 0.5)) * C < R - EPS) tB[c2] = B.MARGIN;
      }
    }
    const span = (r, pad) => [Math.max(0, Math.floor((r.x0 - pad - S0.x0) / C)), Math.min(NX - 1, Math.floor((r.x1 + pad - S0.x0) / C)),
      Math.max(0, Math.floor((r.z0 - pad - S0.z0) / C)), Math.min(NZ - 1, Math.floor((r.z1 + pad - S0.z0) / C))];
    const cells = (r, pad, fn) => { const [i0, i1, k0, k1] = span(r, pad); for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) fn(i + NX * k, cx(i), cz(k)); };
    // 台阶下的地垫（能踩，脚印不印在上面）：方块版跟着房子里的 step_mat 方块（布局的矩形搬到方块那里），没有方块数据时照布局
    const matR = (L.outside || []).find((o) => o.id === 'stepMat'), mats = [];
    if (matR && matR.block && HBk && HBk.furnPlaced) {
      for (const p of HBk.furnPlaced(matR.block)) {
        if (!p.mv) continue;
        const a = p.mv.point([matR.x0, 0, matR.z0]), b = p.mv.point([matR.x1, 0, matR.z1]);
        mats.push({ x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[2], b[2]), z1: Math.max(a[2], b[2]) });
      }
    } else if (matR) mats.push(matR);
    const FS = furnSolids();
    // 房子的方块范围（没有方块数据时：房子和门廊的矩形整块挡掉，等 54-house-mc 读好再 rebuild）
    const hb = HBk ? HBk.grid.bounds : null;
    const box = hb ? { x0: hb.x0, x1: hb.x1, z0: hb.z0, z1: hb.z1 } : null;
    const copy = (doorOpen) => {
      const hgt = new Float32Array(N * MAXL), kind = new Uint8Array(N * MAXL).fill(NONE), blk = new Uint8Array(N * MAXL);
      hgt.set(tH); kind.set(tK); blk.set(tB);
      for (let c = N; c < N * MAXL; c++) blk[c] = B.NONE;
      const sol = new Map();                                              // 格 → 实心段（方块 + 家具；margin 用）
      if (box) cells(box, 0, (c, x, z) => {
        if (!inR(box, x, z)) return;
        const bs = HBk.solids(x, z, { doorOpen });
        // 挡路的：布局里还不是方块的家具 + 模组家具方块（box 的；地毯、地垫能走，挂墙、吊顶的不挡）
        const fs = FS.filter((f) => !f.r.block && inR(f.r, x, z)).map((f) => [f.y0, f.y1]).concat(HBk.furnSolids ? HBk.furnSolids(x, z) : []);
        if (!bs.length && !fs.length) return;
        sol.set(c, bs.concat(fs));
        // 能站的面：沙面和方块段（相接的并起来）的顶面，到上面一段方块的底至少空着 CLEAR。
        // 家具不算面（不能站上去），只看它挡不挡：压在这个面上、低于头顶 → 这个面挡掉（FURN）
        const segs = [[-1e9, tH[c], 't']].concat(bs.map((s) => [s[0], s[1], 'b']));
        segs.sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const s of segs) {
          const t = merged[merged.length - 1];
          if (t && s[0] <= t[1] + 1e-6) { if (s[1] > t[1]) { t[1] = s[1]; t[2] = s[2]; } } else merged.push(s.slice());
        }
        const surf = [];
        merged.forEach((s, j) => {
          const top = s[1], above = j + 1 < merged.length ? merged[j + 1][0] : Infinity;
          if (above - top < CLEAR - 1e-6) return;
          const furn = fs.some((f) => f[0] < top + CLEAR && f[1] > top + 1e-6);
          surf.push({ y: top, terrain: s[2] === 't', furn });
        });
        for (let l = 0; l < MAXL; l++) {
          const q = c + l * N, sf = surf[l];
          if (!sf) { kind[q] = NONE; blk[q] = B.NONE; continue; }
          hgt[q] = sf.y;
          if (sf.terrain) { kind[q] = tK[c]; blk[q] = tB[c]; }
          else { kind[q] = inR(H, x, z) ? 5 : 3; blk[q] = 0; }
          if (sf.furn) blk[q] = B.FURN;
        }
      });
      else {                                                              // 还没有方块：房子 + 门廊挡掉
        for (const r of [H, P, ST]) if (r) cells(r, R, (c, x, z) => { if (rectD(r, x, z) < R - EPS) blk[c] = inR(r, x, z) ? B.HOUSE : blk[c] || B.MARGIN; });
      }
      for (const mat of mats) cells(mat, 0, (c, x, z) => { if (inR(mat, x, z) && kind[c] <= 1) { kind[c] = 4; hgt[c] += 0.035; } });
      // 挨着方块 / 家具：旁边一格在「脚下 STEP 到头顶」之间有实心 → margin
      if (sol.size) {
        const mark = [];
        for (let l = 0; l < MAXL; l++) cells(box, R, (c) => {
          const q = c + l * N; if (kind[q] === NONE || blk[q]) return;
          const h = hgt[q], i = c % NX, k = (c / NX) | 0;
          for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
            if (!di && !dk) continue;
            const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= NX || kk >= NZ) continue;
            const ss = sol.get(ii + NX * kk); if (!ss) continue;
            for (const s of ss) if (s[1] > h + STEP + 1e-3 && s[0] < h + CLEAR) { mark.push(q); return; }
          }
        });
        for (const q of mark) blk[q] = B.MARGIN;
      }
      // 屋外的小物件、树：只挡第 0 层（同以前，按矩形外扩 R）。布局里带 block 的是模组方块：有方块数据时上面已经按方块挡了
      // （HB.furnSolids；在 MC 里挪了、拆了都跟着），这里不再按布局的矩形挡；石堆、礁石、椰子树这些不是方块的照旧
      const block = (r, why, dist) => {
        const df = dist || ((x, z) => rectD(r, x, z));
        cells(r, R + C, (c, x, z) => { if (kind[c] === NONE) return; const v = df(x, z); if (v <= EPS) blk[c] = why; else if (v < R - EPS && !blk[c]) blk[c] = B.MARGIN; });
      };
      const head = (P ? P.y : H.floorY) + (L.girlH || 1.3) + 0.1;
      for (const o of L.outside || []) {
        if (o.id === 'stepMat' || (TR && /^(rocks|reef)/.test(o.id))) continue;   // 地垫能走；石堆礁石按地形算
        if (box && (o.block || o.blocks)) continue;                               // 模组方块：按方块挡（见上）
        if (o.wallY != null) { if (o.wallY - 0.8 < head) block(o, B.PROP); continue; }   // 挂墙物：底边比她头低才挡
        if (ST && o.x0 < ST.x1 && o.x1 > ST.x0 && o.z0 < ST.z1 && o.z1 > ST.z0) {         // 跨着台阶的（多肉）：只挡两边
          if (o.x0 < ST.x0) block({ x0: o.x0, z0: o.z0, x1: ST.x0, z1: o.z1 }, B.PROP);
          if (o.x1 > ST.x1) block({ x0: ST.x1, z0: o.z0, x1: o.x1, z1: o.z1 }, B.PROP);
          continue;
        }
        block(o, B.PROP);
      }
      for (const p of L.plants || []) {
        if (p.x == null) continue;                                        // 藤蔓、爬藤、草丛：贴墙或贴地，能走
        if (box && p.block) continue;                                     // 盆栽、吊篮是模组方块：按方块挡
        const isPalm = /^palm/.test(p.id), r = isPalm ? 0.25 : 0.22;
        let bx = p.x, bz = p.z;
        if (isPalm && p.lean) {                                           // 树干歪着长：挡到她头顶那么高的一段（同 58-plants 的弯法）
          const h = p.h || 6, t = Math.min(1, 1.5 / h), f = (1.5 * t - 0.5 * t * t) * h;
          bx += p.lean[0] * f; bz += p.lean[1] * f;
        }
        block({ x0: Math.min(p.x, bx) - r, z0: Math.min(p.z, bz) - r, x1: Math.max(p.x, bx) + r, z1: Math.max(p.z, bz) + r },
          isPalm ? B.TREE : B.PROP, (x, z) => Math.max(0, segD(x, z, p.x, p.z, bx, bz) - r));
      }
      // 区域（randomPoint 用）：inside = 一楼地板，loft = 阁楼地板
      const wz = (L.zones || []).find((z) => z.id === 'wash') || { x0: S0.x0, x1: S0.x1 };
      const zone = { beach: [], porch: [], tideline: [], inside: [], loft: [], any: [] };
      for (let q = 0; q < N * MAXL; q++) {
        const kd = kind[q]; if (kd === NONE || blk[q] || kd === 2) continue;
        const c = q % N, x = cx(c % NX), z = cz((c / NX) | 0);
        zone.any.push(q);
        if (kd === 5) (hgt[q] >= H.loftY - 0.3 ? zone.loft : zone.inside).push(q);
        else if (kd === 3) { if ((!ST || !inR(ST, x, z)) && Math.abs(hgt[q] - (P ? P.y : 1)) < 0.05) zone.porch.push(q); }
        else if (kd <= 1) {
          zone.beach.push(q);
          if (x > wz.x0 && x < wz.x1 && z > tide(x) - 0.4 && z < shz(x) - 0.3) zone.tideline.push(q);
        }
      }
      return { hgt, kind, blk, zone, doors: 0 };
    };
    const open = copy(true), shut = box ? copy(false) : open;
    return { shut, open, blocks: !!box, ms: performance.now() - t0 };
  };

  // ---- API ----
  let G = null, OPEN = true;                                              // OPEN = 门能过（setDoor）
  const grid = () => {
    if (!G) { try { G = build(); } catch (e) { if (V3.err) V3.err('nav.build: ' + ((e && e.stack) || e)); throw e; } }
    const v = OPEN ? G.open : G.shut;                                     // 当前这一份：hgt / kind / blk / zone / reach 跟着门换
    if (G.cur !== v) {
      if (G.cur) { G.cur.reach = G.reach; G.cur.zr = G.zr; }
      G.cur = v; G.hgt = v.hgt; G.kind = v.kind; G.blk = v.blk; G.zone = v.zone; G.reach = v.reach || null; G.zr = v.zr || null;
    }
    return G;
  };
  const idx = (x, z) => {
    const i = Math.floor((x - S0.x0) / C), k = Math.floor((z - S0.z0) / C);
    return i < 0 || k < 0 || i >= NX || k >= NZ ? -1 : i + NX * k;
  };
  // 这一格里选一层：给了 y 就选高度最接近的那层（只看有面的层），没给就第 0 层
  const pickL = (g, c, y) => {
    if (y == null || !Number.isFinite(y)) return c;
    let best = c, bd = Infinity;
    for (let l = 0; l < MAXL; l++) { const q = c + l * N; if (g.kind[q] === NONE) continue; const d = Math.abs(g.hgt[q] - y); if (d < bd) { bd = d; best = q; } }
    return best;
  };
  const nodeAt = (x, z, y) => { const c = idx(x, z); return c < 0 ? -1 : pickL(grid(), c, y); };
  // 给了 y：这一格离 y 最近的那层要在一步（STEP）加半米以内，不然算不能走（比如墙那一格只有墙顶 / 屋顶上能站）
  const walkable = (x, z, y) => {
    const q = nodeAt(x, z, y), g = grid();
    return q >= 0 && g.kind[q] !== NONE && !g.blk[q] && (y == null || !Number.isFinite(y) || Math.abs(g.hgt[q] - y) <= STEP + 0.5);
  };
  const heightAt = (x, z, y) => {
    const q = nodeAt(x, z, y);
    if (q >= 0 && grid().kind[q] !== NONE) return grid().hgt[q];
    const TR = V3.terrain; return TR && TR.groundY ? TR.groundY(x, z) : S0.sandY;
  };
  const surface = (x, z, y) => { const q = nodeAt(x, z, y); return q < 0 ? 'water' : grid().kind[q] === NONE ? 'none' : KIND[grid().kind[q]]; };
  const blockedBy = (x, z, y) => { const q = nodeAt(x, z, y); return q < 0 ? 'edge' : WHY[grid().blk[q]]; };
  const NAV = V3.nav = {
    C, R, STEP, DEEP, CLEAR, MAXL, NX, NZ, x0: S0.x0, z0: S0.z0,
    home: [0, 0],                                                       // 台阶前的沙滩（她出场的地方）：refreshPlace() 算，房子挪了跟着挪
    walkable, heightAt, surface, blockedBy,
    rebuild() { refreshPlace(); G = null; RNG = null; if (DBG && DBG.userData.grid) { const me = DBG.userData.grid, on = me.visible; DBG.remove(me); me.geometry.dispose(); me.material.dispose(); DBG.userData.grid = null; dbgShow(on); } },
  };
  // ---- A*（8 方向，斜走要两边都能走，不切墙角；浅水代价 ×3）+ 拉直 ----
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DK = [0, 0, 1, -1, 1, -1, 1, -1], DC = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  let GS = null, PA = null, SEEN = null, SHUT = null, HF = null, HC = null, hn = 0, gen = 0;
  const ok = (g, q) => g.kind[q] !== NONE && !g.blk[q];
  // 从节点 q 走到格 c2：那一格里高差 ≤ STEP 的能走的层（最接近的），没有 → −1
  const linkTo = (g, q, c2) => {
    const h = g.hgt[q];
    let best = -1, bd = STEP + 1e-6;
    for (let l = 0; l < MAXL; l++) { const n = c2 + l * N; if (!ok(g, n)) continue; const d = Math.abs(g.hgt[n] - h); if (d <= bd) { bd = d; best = n; } }
    return best;
  };
  const stepTo = (g, q, d) => {                                           // 节点 q 往 d 方向走一格 → 新节点或 −1
    const c = q % N, i = c % NX, k = (c / NX) | 0, ii = i + DI[d], kk = k + DK[d];
    if (ii < 0 || kk < 0 || ii >= NX || kk >= NZ) return -1;
    const n = linkTo(g, q, ii + NX * kk);
    if (n < 0) return -1;
    if (d >= 4 && (linkTo(g, q, ii + NX * k) < 0 || linkTo(g, q, i + NX * kk) < 0)) return -1;
    return n;
  };
  const push = (f, c) => {
    let j = hn++;
    while (j > 0) { const p = (j - 1) >> 1; if (HF[p] <= f) break; HF[j] = HF[p]; HC[j] = HC[p]; j = p; }
    HF[j] = f; HC[j] = c;
  };
  const pop = () => {
    const top = HC[0], f = HF[--hn], c = HC[hn];
    let j = 0;
    for (;;) {
      let m = 2 * j + 1; if (m >= hn) break;
      if (m + 1 < hn && HF[m + 1] < HF[m]) m++;
      if (HF[m] >= f) break;
      HF[j] = HF[m]; HC[j] = HC[m]; j = m;
    }
    if (hn > 0) { HF[j] = f; HC[j] = c; }
    return top;
  };
  const astar = (g, s, t) => {
    const NN = N * MAXL;
    if (!GS) { GS = new Float32Array(NN); PA = new Int32Array(NN); SEEN = new Uint32Array(NN); SHUT = new Uint32Array(NN); HF = new Float32Array(8 * NN); HC = new Int32Array(8 * NN); }
    gen++; hn = 0;
    const tc = t % N, ti = tc % NX, tk = (tc / NX) | 0, ty = g.hgt[t];
    const h = (q) => { const c = q % N, dx = Math.abs(c % NX - ti), dz = Math.abs(((c / NX) | 0) - tk); return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz) + Math.abs(g.hgt[q] - ty) / C; };
    GS[s] = 0; PA[s] = -1; SEEN[s] = gen; push(h(s), s);
    while (hn > 0) {
      const q = pop();
      if (SHUT[q] === gen) continue;
      SHUT[q] = gen;
      if (q === t) { const out = []; for (let p = t; p !== -1; p = PA[p]) out.push(p); return out.reverse(); }
      for (let d = 0; d < 8; d++) {
        const n = stepTo(g, q, d); if (n < 0 || SHUT[n] === gen) continue;
        const v = GS[q] + DC[d] * (g.kind[n] === 2 ? 3 : 1) + Math.abs(g.hgt[n] - g.hgt[q]) / C;
        if (SEEN[n] === gen && v >= GS[n]) continue;
        SEEN[n] = gen; GS[n] = v; PA[n] = q; push(v + h(n), n);
      }
    }
    return null;
  };
  // 拉直：从节点 a 沿线段走到 (bx,bz)，经过的每一格都要接得上（高差 ≤ STEP、能走、不过水），最后落在节点 tb 上
  const sight = (g, a, bx, bz, tb) => {
    const c0 = a % N, ax = cx(c0 % NX), az = cz((c0 / NX) | 0);
    let i = c0 % NX, k = (c0 / NX) | 0;
    const ti = Math.floor((bx - S0.x0) / C), tk = Math.floor((bz - S0.z0) / C), dx = bx - ax, dz = bz - az;
    const si = dx > 0 ? 1 : -1, sk = dz > 0 ? 1 : -1, ddx = Math.abs(dx) > EPS ? C / Math.abs(dx) : Infinity, ddz = Math.abs(dz) > EPS ? C / Math.abs(dz) : Infinity;
    let tx = Math.abs(dx) > EPS ? ((si > 0 ? S0.x0 + (i + 1) * C - ax : ax - (S0.x0 + i * C)) / Math.abs(dx)) : Infinity;
    let tz = Math.abs(dz) > EPS ? ((sk > 0 ? S0.z0 + (k + 1) * C - az : az - (S0.z0 + k * C)) / Math.abs(dz)) : Infinity;
    let q = a;
    for (let n = 0; n < 4 * (NX + NZ) && (i !== ti || k !== tk); n++) {
      if (Math.abs(tx - tz) < 1e-9) { if (linkTo(g, q, (i + si) + NX * k) < 0 || linkTo(g, q, i + NX * (k + sk)) < 0) return false; }   // 正好过格角
      if (tx < tz) { i += si; tx += ddx; } else { k += sk; tz += ddz; }
      if (i < 0 || k < 0 || i >= NX || k >= NZ) return false;
      const n2 = linkTo(g, q, i + NX * k);
      if (n2 < 0 || (g.kind[n2] === 2 && g.kind[q] !== 2)) return false;
      q = n2;
    }
    return q === tb;
  };
  const centre = (q) => { const c = q % N; return [cx(c % NX), cz((c / NX) | 0)]; };
  const nearCell = (x, z, maxR = 6, main = false, y) => {                 // 一圈圈往外找最近的能走节点（给了 y 时同一圈里挑高度近的）
    const g = grid(), i0 = U.clamp(Math.floor((x - S0.x0) / C), 0, NX - 1), k0 = U.clamp(Math.floor((z - S0.z0) / C), 0, NZ - 1);
    const good = (q) => ok(g, q) && (!main || reach()[q]);
    const best0 = (c) => { let b = -1, bd = Infinity; for (let l = 0; l < MAXL; l++) { const q = c + l * N; if (!good(q)) continue; const d = y == null ? l : Math.abs(g.hgt[q] - y); if (d < bd) { bd = d; b = q; } } return b; };
    if (idx(x, z) >= 0) { const q = best0(i0 + NX * k0); if (q >= 0 && (y == null || Math.abs(g.hgt[q] - y) <= STEP * 2 + 0.5)) return q; }
    let best = -1, bd = Infinity;
    for (let r = 1; r <= Math.ceil(maxR / C); r++) {
      for (let dk = -r; dk <= r; dk++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
        const i = i0 + di, k = k0 + dk; if (i < 0 || k < 0 || i >= NX || k >= NZ) continue;
        const q = best0(i + NX * k); if (q < 0) continue;
        const d = Math.hypot(cx(i) - x, cz(k) - z) + (y == null ? 0 : Math.abs(g.hgt[q] - y) * 2);
        if (d < bd) { bd = d; best = q; }
      }
      if (best >= 0 && bd <= r * C) break;
    }
    return bd <= maxR + (y == null ? 0 : 20) ? best : -1;
  };
  const reach = () => {                                                   // 从 home 出发能走到的节点（洪水填充，和 A* 同样的连通规则）
    const g = grid(); if (g.reach) return g.reach;
    const NN = N * MAXL, m = g.reach = new Uint8Array(NN), q = new Int32Array(NN);
    const c0 = idx(NAV.home[0], NAV.home[1]);
    const s = c0 >= 0 && ok(g, c0) ? c0 : nearCell(NAV.home[0], NAV.home[1]);
    if (s < 0) return m;
    let h = 0, n = 0; q[n++] = s; m[s] = 1;
    while (h < n) { const c = q[h++]; for (let d = 0; d < 8; d++) { const e = stepTo(g, c, d); if (e >= 0 && !m[e]) { m[e] = 1; q[n++] = e; } } }
    return m;
  };
  // ---- path / nearest / reachable / randomPoint ----
  const smooth = (g, nodes, P0, P1) => {                                  // 往前走着拉直：从 a 能直接看到的最远一点
    const pts = nodes.map((q, j) => (j === 0 ? P0 : j === nodes.length - 1 ? P1 : centre(q)));
    const out = [[pts[0][0], pts[0][1], g.hgt[nodes[0]]]];
    for (let a = 0; a < nodes.length - 1; ) {
      let b = a + 1;
      while (b + 1 < nodes.length && sight(g, nodes[a], pts[b + 1][0], pts[b + 1][1], nodes[b + 1])) b++;
      out.push([pts[b][0], pts[b][1], g.hgt[nodes[b]]]); a = b;
    }
    return out;
  };
  const leg = (a, b) => {
    const g = grid(), s = nearCell(a[0], a[1], 3, false, a[2]), t = nearCell(b[0], b[1], 6, true, b[2]);
    if (s < 0 || t < 0) return null;
    const ns = astar(g, s, t); if (!ns) return null;
    const sIn = idx(a[0], a[1]) === s % N, P0 = sIn ? [a[0], a[1]] : centre(s);
    const P1 = idx(b[0], b[1]) === t % N ? [b[0], b[1]] : centre(t);
    const out = ns.length > 1 ? smooth(g, ns, P0, P1) : [[P0[0], P0[1], g.hgt[s]], [P1[0], P1[1], g.hgt[t]]];
    if (!sIn) out.unshift([a[0], a[1], g.hgt[s]]);                         // 她站在障碍边上：先从原地走出来
    return out;
  };
  // 门内 / 门外落脚点、她出场的地方（台阶前）：按摆好以后的布局算（房子没挪过时和以前一样）
  const DOOR = (L.openings || []).find((o) => o.id === 'door' && o.wall === 's');
  const DL = DOOR ? { out: [0, 0], in: [0, 0] } : null;
  function refreshPlace() {
    const LP = placed(), HB0 = V3.houseBlocks, pl = LP.place, pt = (x, z) => { if (!pl || !HB0 || !HB0.placePoint) return [x, z]; const q = HB0.placePoint([x, 0, z], pl); return [q[0], q[2]]; };
    const S0h = L.porch && L.porch.steps, H0 = L.house;
    // 台阶前：在房子自己的方向上算（台阶外边往外 1.25 米），再转、挪过去
    NAV.home = S0h ? pt((S0h.x0 + S0h.x1) / 2, S0h.z1 + 1.25) : pt(0, (L.porch ? L.porch.z1 : H0.z1) + 2);
    if (DL) {
      DL.out = H.doorOut ? H.doorOut.slice() : pt((DOOR.a0 + DOOR.a1) / 2, H0.z1 + 0.6);
      DL.in = H.doorIn ? H.doorIn.slice() : pt((DOOR.a0 + DOOR.a1) / 2, H0.z1 - H0.wallT - 0.6);
    }
  }
  refreshPlace();
  const path = (a, b) => leg(a, b);
  const setDoor = (open) => {
    const v = !!open;
    if (v === OPEN) return OPEN;
    OPEN = v;
    if (DBG && DBG.userData.grid) {                                       // 调试格子按新的门重画
      const on = DBG.userData.grid.visible, me = DBG.userData.grid;
      DBG.remove(me); me.geometry.dispose(); me.material.dispose(); DBG.userData.grid = null;
      dbgShow(on);
    }
    return OPEN;
  };
  const reachable = (x, z, y) => { const q = nodeAt(x, z, y); return q >= 0 && reach()[q] === 1; };
  const nearest = (x, z, maxR = 6, y) => {
    if (reachable(x, z, y)) { const q = nodeAt(x, z, y); return [x, z, grid().hgt[q]]; }
    const q = nearCell(x, z, maxR, true, y); if (q < 0) return null;
    const [px, pz] = centre(q); return [px, pz, grid().hgt[q]];
  };
  let RNG = null;
  const randomPoint = (zone = 'beach', rng, o) => {                       // o = { near: [x, z], r: 5 } 只在这个圈里挑；→ [x, z, y]
    const g = grid(), m = reach();
    if (!g.zr) { g.zr = {}; for (const k in g.zone) g.zr[k] = g.zone[k].filter((q) => m[q]); }
    const list = g.zr[zone] || g.zr.any; if (!list || !list.length) return null;
    const r = typeof rng === 'function' ? rng : (RNG = RNG || U.rng(0x6e6176));
    let q = list[Math.floor(r() * list.length)];
    if (o && o.near) {
      const [nx, nz] = o.near, rr = o.r || 5, inC = (p) => { const [x, z] = centre(p); return Math.hypot(x - nx, z - nz) <= rr; };
      q = -1;
      for (let i = 0; i < 60 && q < 0; i++) { const p = list[Math.floor(r() * list.length)]; if (inC(p)) q = p; }
      if (q < 0) { const sub = list.filter(inC); if (!sub.length) return null; q = sub[Math.floor(r() * sub.length)]; }
    }
    const [x, z] = centre(q);
    return [x + (r() - 0.5) * C * 0.6, z + (r() - 0.5) * C * 0.6, g.hgt[q]];
  };
  Object.assign(NAV, {
    path, nearest, reachable, randomPoint, setDoor,
    doorLink: DL ? { get out() { return DL.out; }, get in() { return DL.in; }, get open() { return OPEN; } } : null,   // 门内 / 门外落脚点；open 只读，用 setDoor 改
    stats() {
      const g = grid(), m = reach(); let w = 0, n = 0, l1 = 0;
      for (let q = 0; q < g.blk.length; q++) { if (ok(g, q)) { w++; if (q >= N) l1++; } if (m[q]) n++; }
      randomPoint('any');
      const z = {}; for (const k in g.zr) z[k] = g.zr[k].length;
      return { cells: N, layers: MAXL, walk: w, walkLoft: l1, reach: n, ms: +g.ms.toFixed(1), zones: z, door: OPEN ? 'open' : 'shut', blocks: g.blocks };
    },
  });

  // ---- 调试：?nav=1 或 view token nav=1 在场景上画格子（每层画在自己的高度）；navpath=x0,z0,x1,z1[,y0,y1] 画一条路（黄点） ----
  let DBG = null;
  const dbgMesh = (g) => {
    const m = reach(), sea = L.sea ? L.sea.y : -0.15, w = C * 0.45, pos = [], col = [], ix = [];
    const tint = (q) => g.blk[q] === B.MARGIN ? [0.95, 0.6, 0.2] : g.blk[q] === B.WATER ? [0.55, 0.12, 0.12] : g.blk[q] ? [0.9, 0.15, 0.15]
      : !m[q] ? [0.95, 0.9, 0.2] : g.kind[q] === 2 ? [0.2, 0.75, 0.9] : q >= N ? [0.35, 0.55, 0.95] : [0.25, 0.85, 0.3];
    for (let l = 0; l < MAXL; l++) for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
      const c = i + NX * k, q = c + l * N;
      if (g.kind[q] === NONE) continue;
      if (g.blk[q] === B.WATER) {                                         // 深水只画靠岸的一圈
        let near = false;
        for (let d = 0; d < 4; d++) { const ii = i + DI[d], kk = k + DK[d]; if (ii >= 0 && kk >= 0 && ii < NX && kk < NZ && g.blk[ii + NX * kk] !== B.WATER) near = true; }
        if (!near) continue;
      }
      const x = cx(i), z = cz(k), y = Math.max(g.hgt[q], g.kind[q] === 2 ? sea : -99) + 0.04, t = tint(q), v = pos.length / 3;
      pos.push(x - w, y, z - w, x + w, y, z - w, x + w, y, z + w, x - w, y, z + w);
      for (let p = 0; p < 4; p++) col.push(t[0], t[1], t[2]);
      ix.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(ix), 1));
    const me = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    me.name = 'nav-grid'; me.renderOrder = 5; me.castShadow = me.receiveShadow = false;
    Object.assign(me.userData, { noPick: true, noShadow: true, noReceive: true });
    return me;
  };
  const dbgShow = (on) => {
    if (!DBG) return;
    if (on && !DBG.userData.grid) { DBG.userData.grid = dbgMesh(grid()); DBG.add(DBG.userData.grid); }
    if (DBG.userData.grid) DBG.userData.grid.visible = !!on;
  };
  const dbgPath = (pts) => {
    if (!DBG) return;
    const old = DBG.userData.path;
    if (old) { DBG.remove(old); old.geometry.dispose(); old.material.dispose(); DBG.userData.path = null; }
    if (!pts) return;
    const marks = [];
    pts.forEach(([ax, az, ay], j) => {
      marks.push([ax, az, ay, 2]);
      const nx = pts[j + 1]; if (!nx) return;
      const len = Math.hypot(nx[0] - ax, nx[1] - az), n = Math.max(1, Math.round(len / 0.25));
      for (let q = 1; q < n; q++) marks.push([ax + (nx[0] - ax) * q / n, az + (nx[1] - az) * q / n, ay + (nx[2] - ay) * q / n, 1]);
    });
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0xffd400 }), marks.length), M = new THREE.Matrix4();
    marks.forEach(([x, z, y, s], j) => { M.makeScale(s, s, s).setPosition(x, heightAt(x, z, y) + 0.12, z); im.setMatrixAt(j, M); });
    im.name = 'nav-path'; im.renderOrder = 6; im.castShadow = im.receiveShadow = false;
    Object.assign(im.userData, { noPick: true, noShadow: true, noReceive: true });
    DBG.add(im); DBG.userData.path = im;
  };
  if (V3.scene && V3.scene.part) V3.scene.part({
    id: 'nav-debug', label: '走路网格（调试 ?nav=1）', order: 99,
    build() {
      DBG = new THREE.Group(); DBG.name = 'nav-debug'; DBG.userData.noPick = true;
      if (U.qs && U.qs('nav', '0') === '1') dbgShow(true);
      return DBG;
    },
    dispose() { DBG = null; },
  });
  if (V3.on) V3.on('house:blocks', () => NAV.rebuild());                  // 54-house-mc 读好方块：按方块重建
  V3.viewTokens = V3.viewTokens || {};
  V3.viewTokens.nav = (v) => dbgShow(v !== '0');
  V3.viewTokens.navdoor = (v) => { setDoor(v !== '0'); };                 // 测试用：navdoor=1 门能过、navdoor=0 门挡死
  V3.viewTokens.navpath = (v) => {
    const n = String(v || '').split(/[,_;]/).map(Number);
    const [x0, z0, x1, z1, y0, y1] = n.length >= 4 && n.every(Number.isFinite) ? n : [-9, -1.5, 4, -4.5];
    dbgShow(true);
    const p = path([x0, z0, y0], [x1, z1, y1]); dbgPath(p);
    NAV.last = { from: [x0, z0, y0], to: [x1, z1, y1], pts: p };
  };
})(window.V3);
