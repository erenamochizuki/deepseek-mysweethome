// 56-furn-ground.js — 一楼家具（furn）：V3.vox 体素家具，1 格 = 1/32 m，脚底 y = 0，正面朝 +z（朝向用 rotation.y）。
// Scene part 'furn-ground'（order 50）按 V3.layout.ground 摆放；一览模型 'furn'（家具一览）。Contract: docs/SPEC-3.md §2 §4 §5 §9.
(function (V3) {
  'use strict';
  const U = V3.util, S = 1 / 32;
  const ROT = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };
  const REG = [];                                       // {id, name, layer, face, build, y?, onWall?}
  const reg = (o) => REG.push(Object.assign({ layer: 'ground', face: 's' }, o));
  let RECT = null;                                      // buildAll 按方块摆时临时换掉布局里的矩形（串灯：连着几格就几米长）
  const find = (id, layer) => (RECT && RECT.id === id ? RECT : (V3.layout[layer || 'ground'] || []).find((it) => it.id === id));
  // ---- colours (packed 0xRRGGBB) ----
  const mix = (a, b, t) => { let o = 0; for (let s = 0; s < 24; s += 8) o |= Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s; return o; };
  const wood = (base, dark, ax) => (x, y, z) => {                    // streaks run along axis ax (0 x, 1 y, 2 z)
    const h = U.hash3(x, y, z), r = ax === 0 ? U.hash3(0, y, z) : ax === 1 ? U.hash3(x, 0, z) : U.hash3(x, y, 0);
    return h > 0.988 ? dark : mix(base, dark, r * 0.4 + h * 0.12);
  };
  const check = (a, b, n) => (x, y, z) => {                          // gingham: both stripes a, one stripe mid, none b
    const j = Math.floor(y / n), i = (Math.floor(x / n) + j) & 1, k = (Math.floor(z / n) + j) & 1;
    return i && k ? a : i || k ? mix(a, b, 0.5) : b;
  };
  const OAK = 0xc8925a, OAKD = 0x8a5a32, OAKL = 0xdcae78, WHITE = 0xf4f1ea;
  // ---- grid / build helpers ----
  function grid(id, layer, ny, oy) {                    // canonical footprint: width along x, depth along z
    const it = find(id, layer), r = REG.find((q) => q.id === id) || {}, sw = r.face === 'e' || r.face === 'w';
    const W = sw ? it.z1 - it.z0 : it.x1 - it.x0, D = sw ? it.x1 - it.x0 : it.z1 - it.z0;
    const hx = Math.floor((Math.round(W / S) - 1) / 2), hz = Math.floor((Math.round(D / S) - 1) / 2);
    const g = new V3.vox.Grid(2 * hx + 5, ny + (oy || 0) + 2, 2 * hz + 5, { origin: [hx + 2, oy || 0, hz + 2] });
    g.hx = hx; g.hz = hz; return g;
  }
  const mat = (ctx) => ctx.furnMat || (ctx.furnMat = V3.vox.material({ roughness: 0.8 }));
  // 网格瘦身：① 去掉永远看不到的面（贴地/低处的底面、靠墙矮墙段以下的背面；一览只去贴地底面）；
  // ② 同平面、同部件、颜色相近、AO 一致的相邻小方面沿一个方向并成长条（木纹/格子/标签的色差会打断合并，所以保留）。同步 groups / triTag。
  const TOL = 0.11, AXS = [{ p: [[0, 1], [3, 2]], st: [0, 3], nx: 1, end: [1, 2] }, { p: [[0, 3], [1, 2]], st: [0, 1], nx: 3, end: [2, 3] }];
  function trim(mesh, drop, q = 64) {             // q：坐标量化格数/米（= 2 / 网格边长；默认 1/32 m 网格）
    const geo = mesh.geometry, ix = geo.index.array, P = geo.attributes.position.array, N = geo.attributes.normal.array;
    const C = geo.attributes.color.array, tt = mesh.userData.triTag, byTag = new Map(), tOf = new Map(), used = new Set();
    const same = (a, b) => C[a * 3] === C[b * 3] && C[a * 3 + 1] === C[b * 3 + 1] && C[a * 3 + 2] === C[b * 3 + 2];
    const near = (a, b) => { for (let k = 0; k < 3; k++) { const x = C[a * 3 + k], y = C[b * 3 + k]; if (Math.abs(x - y) > TOL * Math.max(x, y, 0.02)) return false; } return true; };
    const key = (v) => (Math.round(P[v * 3] * q) + 4096) * 67108864 + (Math.round(P[v * 3 + 1] * q) + 4096) * 8192 + Math.round(P[v * 3 + 2] * q) + 4096;
    for (let t = 0; t < ix.length; t += 6) {
      const a = Math.min(ix[t], ix[t + 1], ix[t + 2], ix[t + 3], ix[t + 4], ix[t + 5]), tg = tt[t / 3];   // quad 的第 0 个角
      if (drop(N[a * 3 + 1], N[a * 3 + 2], P[a * 3 + 1], P[a * 3 + 2])) continue;
      const ax = Math.abs(N[a * 3]) > 0.5 ? 0 : Math.abs(N[a * 3 + 1]) > 0.5 ? 1 : 2;
      const bk = N[a * 3] + ',' + N[a * 3 + 1] + ',' + N[a * 3 + 2] + '@' + Math.round(P[a * 3 + ax] * q);
      if (!byTag.has(tg)) byTag.set(tg, new Map());
      const m = byTag.get(tg); if (!m.has(bk)) m.set(bk, []); m.get(bk).push(a); tOf.set(a, t);
    }
    const oP = [], oN = [], oC = [], oI = [], oT = [];
    const emit = (a, L, A, tg) => {
      const base = oP.length / 3;
      for (let k = 0; k < 4; k++) {
        const v = L !== a && A.end.includes(k) ? L + k : a + k;
        oP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); oN.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); oC.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
      }
      if (L === a) { const t = tOf.get(a); for (let k = 0; k < 6; k++) oI.push(ix[t + k] - a + base); }
      else oI.push(base, base + 1, base + 2, base, base + 2, base + 3);
      oT.push(tg, tg);
    };
    for (const tg of [...byTag.keys()].sort((p, q) => p - q)) for (const qs of byTag.get(tg).values()) {
      const at = new Map(); for (const a of qs) at.set(key(a), a);
      const uni = (a, A) => A.p.every(([i, j]) => same(a + i, a + j));
      const nxt = (a, A) => { const b = at.get(key(a + A.nx)); return b != null && !used.has(b) && uni(b, A) ? b : null; };
      const pair = (a, A) => { if (!uni(a, A)) return false; const b = nxt(a, A); return b != null && A.st.every((k) => near(a + k, b + k)); };
      const cnt = AXS.map((A) => qs.filter((a) => pair(a, A)).length), A = AXS[cnt[1] > cnt[0] ? 1 : 0], any = cnt[0] + cnt[1] > 0;
      if (any) { const wi = [0, 1, 2].find((i) => Math.abs(P[(qs[0] + A.nx) * 3 + i] - P[qs[0] * 3 + i]) > 1e-6); qs.sort((p, q) => P[p * 3 + wi] - P[q * 3 + wi]); }
      for (const a of qs) {
        if (used.has(a)) continue; used.add(a);
        let L = a;
        if (any && uni(a, A)) for (let b; (b = nxt(L, A)) != null && A.st.every((k) => near(a + k, b + k));) { used.add(b); L = b; }
        emit(a, L, A, tg);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(oP), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(oN), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(oC), 3));
    geo.setIndex(new THREE.BufferAttribute(new (oP.length / 3 > 65535 ? Uint32Array : Uint16Array)(oI), 1)); geo.clearGroups();
    const T = mesh.userData.triTag = new Uint16Array(oT);
    for (let s = 0, i = 1; i <= T.length; i++) if (i === T.length || T[i] !== T[s]) { geo.addGroup(s * 3, (i - s) * 3, T[s]); s = i; }
    geo.computeBoundingBox(); geo.computeBoundingSphere();
  }
  function vox(ctx, g, id, bones, opt = {}) {      // opt：scale / material / noise / ao / dMax（覆盖默认的"看不见的底面"高度）
    const defs = bones || [{ name: 'root', pivot: [0, 0, 0] }], s = opt.scale || S;
    const v = V3.vox.build(g, { scale: s, bones: defs, anchor: 'furn:' + id, material: opt.material || mat(ctx), noise: opt.noise ?? 0.03, ao: opt.ao ?? 0.45 });
    const r = REG.find((q) => q.id === id) || {}, loft = r.layer === 'loft', bz = (-g.hz - 0.5) * s + 1e-4;
    const dMax = opt.dMax != null ? opt.dMax : r.y ? -1 : ctx.studio ? 1e-4 : loft ? 0.2 : 0.45, cut = ctx.studio ? -1 : r.onWall ? 99 : r.wall ? (loft ? 0.75 : 1.0) : -1;
    for (const m of v.meshes) {                  // 顶点在骨骼局部坐标里：加回枢轴再判断（骨骼都直接挂在 root 下）
      const pv = (defs.find((q) => 'vox:' + q.name === m.name) || defs[0]).pivot, py = pv[1] * s, pz = pv[2] * s;
      trim(m, (ny, nz, y, z) => (ny < -0.5 && y + py < dMax) || (nz < -0.5 && z + pz < bz && y + py + s <= cut + 1e-4), 2 / s);
    }
    return v;
  }
  // 方块家具在网页里要叠的骨骼名（V3.furnMc 规格的 overlay，如 ['bulb', 'pc-screen']）；没有就 null。只留这些网格：V3.furnMc.prune（44-furn-mc）
  function overlayOf(block) {
    const f = V3.furnMc && V3.furnMc.byBlock && V3.furnMc.byBlock(block), k = f && f.overlay;
    return Array.isArray(k) && k.length ? k : null;
  }
  const pruneOverlay = (root, keep) => V3.furnMc.prune(root, keep);
  // 照布局摆一件（rect 换掉布局里的矩形；mv = V3.furnMc.mover：从默认房子里的摆法搬到方块那里）
  function placeOne(ctx, grp, r, it, layer, base, keep, o2) {
    const path = (layer === 'loft' ? '小屋/阁楼/' : '小屋/一楼/') + r.name, rect = (o2 && o2.rect) || it, mv = o2 && o2.mv;
    try {
      V3.parts.declare([path], { [path]: it.label });
      RECT = rect === it ? null : rect;
      let o; try { o = r.build(ctx); } finally { RECT = null; }
      let p = [(rect.x0 + rect.x1) / 2, r.y ? r.y(rect, base) : base, (rect.z0 + rect.z1) / 2], a = ROT[r.face] || 0;
      if (mv && !mv.same) { p = mv.point(p); a = mv.yaw(a); }
      o.position.set(p[0], p[1], p[2]);
      o.rotation.y = a; o.name = 'furn:' + r.id;
      Object.assign(o.userData, { layer: (o2 && o2.layer) || layer, furn: r.id }, r.onWall && !(mv && !mv.same) ? { onWall: r.onWall } : {},
        o2 && o2.cell ? { cell: o2.cell.slice(), facing: o2.facing } : {});
      if (keep) pruneOverlay(o, keep);
      grp.add(o);
      return o;
    } catch (e) { V3.err('furn ' + r.id + ': ' + (e && e.stack || e)); return null; }
  }
  // 方块在哪一层（剖开看一楼时阁楼的跟着藏）：房子外墙以内，阁楼地板那层（格子 y ≥ loftY − 1）往上算阁楼，下面算一楼；房子外面 'site'（一直画）
  function layerAt(cell) {
    const HBk = V3.houseBlocks, H = (HBk && HBk.placedLayout ? HBk.placedLayout() : V3.layout).house, [x, y, z] = cell;   // 房子挪过：按摆好以后的外墙
    if (x < H.x0 || x >= H.x1 || z < H.z0 || z >= H.z1) return 'site';
    return y >= H.loftY - 1 ? 'loft' : 'ground';
  }
  // 一格一段、连成一排的（串灯）：同朝向、同一层、沿着「朝北时的 +x」连着的几格算一段 → [{ p: 段头那件, n: 几格 }]
  function runsOf(list) {
    const FM = V3.furnMc, key = (c, f) => c.join(',') + '|' + f, has = new Set(list.map((p) => key(p.cell, p.facing))), out = [];
    for (const p of list) {
      const d = FM.rotate([1, 0, 0], p.facing), at = (k) => [p.cell[0] + d[0] * k, p.cell[1], p.cell[2] + d[2] * k];
      if (has.has(key(at(-1), p.facing))) continue;
      let n = 1; while (has.has(key(at(n), p.facing))) n++;
      out.push({ p, n });
    }
    return out;
  }
  // 默认房子里那一段的矩形（布局里的）改成 n 格长：从段头那头量
  function runRect(it, facing, n) {
    const d = V3.furnMc.rotate([1, 0, 0], facing), q = Object.assign({}, it);
    if (d[0] > 0) q.x1 = it.x0 + n; else if (d[0] < 0) q.x0 = it.x1 - n; else if (d[2] > 0) q.z1 = it.z0 + n; else q.z0 = it.z1 - n;
    return q;
  }
  // P5：这件已经是模组方块（房子的鲸图里有，54-house-mc 画）。游戏场景里只留规格（44-furn-mc 的 overlay）列的那几块会动 / 会亮的骨骼
  // （屏幕、灯泡、碗里的东西……）和点光，叠在方块上；没有 overlay 的整件不画。房子里这种方块有几件就叠几份，按方块的格子和 facing 摆
  // （没有就不画）；V3.layout 里的矩形只管体素版的大小。家具一览（studio）照旧照布局画完整的体素版
  function placeOnBlocks(ctx, grp, r, it, layer, base, keep) {
    const HB = V3.houseBlocks, f = V3.furnMc.byBlock(it.block), mine = (p) => (p.home ? p.home.id === it.id : (f.layout && f.layout.id) === it.id);
    const list = HB.furnPlaced(f.block).filter(mine);
    const runs = f.repeat ? runsOf(list) : list.map((p) => ({ p, n: 0 }));
    for (const { p, n } of runs) {
      if (!p.mv) continue;
      placeOne(ctx, grp, r, it, layer, base, keep, { mv: p.mv, rect: n ? runRect(it, p.ref.facing, n) : it, layer: layerAt(p.cell), cell: p.cell, facing: p.facing });
    }
  }
  function buildAll(ctx, layer) {
    const grp = new THREE.Group(), H = V3.layout.house, base = layer === 'loft' ? H.loftY : H.floorY, HB = V3.houseBlocks;
    grp.name = 'furn-' + layer;
    for (const r of REG) {
      const it = r.layer === layer && find(r.id, layer); if (!it) continue;
      const blockMode = it.block && H && H.blocks && !ctx.studio;
      if (!blockMode) { placeOne(ctx, grp, r, it, layer, base, null); continue; }
      const keep = overlayOf(it.block);
      if (!keep) continue;
      if (HB && HB.whenGrid && V3.furnMc.byBlock(it.block).house) HB.whenGrid(ctx, () => placeOnBlocks(ctx, grp, r, it, layer, base, keep));
      else placeOne(ctx, grp, r, it, layer, base, keep);   // 没有方块数据的页面：叠在布局的位置上
    }
    return grp;
  }
  // ---- 差分 variant：V3.furn.setVariant(id, name) / variants(id) / variant(id)；view token variant=<id>:<name> ----
  // VAR[id] = { names, cur, fns }：names[0] 是默认；在场的实例用 onVariant 登记 apply(name)，part dispose 时 release。
  // 状态存在模块里：先 setVariant 再建场景也行，换模型/重建后保持
  const VAR = {}, TICK = new Set();
  function defVariant(id, names) { if (!VAR[id]) VAR[id] = { names, cur: names[0], fns: new Set() }; return VAR[id]; }
  function onVariant(ctx, id, fn) {
    const v = VAR[id]; v.fns.add(fn); fn(v.cur);
    (ctx._furnOff = ctx._furnOff || []).push(() => v.fns.delete(fn));
  }
  function setVariant(id, name) {
    const v = VAR[id];
    if (!v || v.names.indexOf(name) < 0) { V3.err('furn.setVariant: unknown ' + id + ':' + name); return false; }
    v.cur = name; v.fns.forEach((f) => f(name));
    if (V3.emit) V3.emit('furn:variant', { id, name });
    return true;
  }
  const variants = (id) => (id == null ? Object.keys(VAR) : VAR[id] ? VAR[id].names.slice() : []);
  const variant = (id) => (VAR[id] ? VAR[id].cur : null);
  function onTick(ctx, fn) { TICK.add(fn); (ctx._furnOff = ctx._furnOff || []).push(() => TICK.delete(fn)); }
  function tick(dt, t) { TICK.forEach((f) => f(dt, t)); }
  function release(ctx) {
    (ctx._furnOff || []).forEach((f) => f()); ctx._furnOff = [];
    (ctx._furnTex || []).forEach((t) => t.dispose()); ctx._furnTex = [];
  }
  V3.viewTokens = V3.viewTokens || {};
  V3.viewTokens.variant = (v) => {
    const s = String(v), i = s.indexOf(':');
    if (i < 0) V3.err('variant token needs <id>:<name>, got ' + s); else setVariant(s.slice(0, i), s.slice(i + 1));
  };
  V3.furn = { reg, find, grid, vox, mix, wood, check, buildAll, setVariant, variants, variant, defVariant, onVariant, onTick, tick, release, buildNightcap, looseDish, sleepCover, OAK, OAKD, OAKL, WHITE };

  // ---- 床（蓝被子 + 白枕头）：床头靠北墙（-z），床尾朝南 ----
  function buildBed(ctx) {
    const g = grid('bed', 'ground', 32), X = g.hx, Z = g.hz, P = '小屋/一楼/床/';
    const oakX = wood(OAK, OAKD, 0), oakY = wood(OAK, OAKD, 1), oakZ = wood(OAK, OAKD, 2);
    g.t(P + '床架').c(oakY);
    for (const sx of [-X, X - 1]) g.box(sx, 0, -Z, sx + 1, 30, -Z + 1).box(sx, 0, Z - 1, sx + 1, 18, Z);      // 四根床柱
    g.c(oakZ).box(-X, 6, -Z + 2, -X + 1, 9, Z - 2).box(X - 1, 6, -Z + 2, X, 9, Z - 2);                          // 侧板
    g.c((x, y, z) => ((x + 64) % 4 === 0 ? OAKD : oakY(x, y, z))).box(-X + 2, 6, -Z, X - 2, 30, -Z + 1);        // 床头竖条板
    g.c((x, y, z) => (y === 12 ? OAKD : oakX(x, y, z))).box(-X + 2, 6, Z - 1, X - 2, 18, Z);                     // 床尾板
    g.c(OAKL).box(-X, 31, -Z, X, 31, -Z + 1).box(-X, 19, Z - 1, X, 19, Z);                                       // 柱帽横档
    g.c(OAKD).box(-X + 2, 6, -Z + 2, X - 2, 9, Z - 2);                                                        // 床板（被床垫盖住）
    g.t(P + '床垫').c(0xf1ece2).box(-X + 1, 10, -Z + 2, X - 1, 13, Z - 2);
    g.t(P + '被子').c(QUILT).box(-X, 9, -Z + 12, -X, 13, Z - 2).box(X, 9, -Z + 12, X, 13, Z - 2)    // 两侧垂边
      .box(-X, 14, -Z + 12, X, 15, Z - 2).c(WHITE).box(-X, 14, -Z + 12, X, 16, -Z + 14);           // 平铺的被面 + 翻出来的白床单边（两种状态共用）
    g.t(P + '枕头'); pillow(g, -X + 3, -1);                                                        // 靠墙那只枕头（上面放睡帽）
    const gm = grid('bed', 'ground', 32), gs = grid('bed', 'ground', 32);
    // made：叠好的睡衣 + 第二只枕头
    gm.t(P + '睡衣').c(check(0x6f8fc8, WHITE, 2)).rbox(2, 16, 15, 12, 17, 23, 1);
    gm.t(P + '枕头'); pillow(gm, 1, X - 3);
    // sleeping：第二只枕头上压出头窝，头的位置空着（小鲸鱼自己躺进来）；被子下的人形是 sleepQuilt 的平滑曲面
    gs.t(P + '枕头'); pillow(gs, 1, X - 3);
    gs.m('erase').ell(BX, 18.6, -Z + 6.5, 4.0, 2.2, 3.1).m('add');                                 // 枕头上的头窝
    const v = vox(ctx, g, 'bed'), vm = vox(ctx, gm, 'bed', [{ name: 'made', pivot: [0, 0, 0] }]);
    const vs = vox(ctx, gs, 'bed', [{ name: 'sleeping', pivot: [0, 0, 0] }]);
    vs.root.add(sleepQuilt(ctx, P));
    const cap = capOnPillow(ctx, Z);
    v.root.add(vm.root, vs.root, cap);
    // 睡着时睡帽也收起来（叠好的睡衣本来就只在 made 里；方块床的那一份见 54-house-mc 的 bedSplit）
    onVariant(ctx, 'bed', (name) => { vm.root.visible = name === 'made'; vs.root.visible = name === 'sleeping'; cap.visible = name !== 'sleeping'; });
    return v.root;
  }
  reg({ id: 'bed', name: '床', build: buildBed, wall: true });
  defVariant('bed', ['made', 'sleeping']);
  const QUILT = (x, y, z) => ((x + 64) % 8 === 0 || (z + 64) % 8 === 0 ? 0x4c64a0 : 0x5b74b0);
  function pillow(g, a, b) {                                                       // 鼓起来的枕头（x a..b，床头那头）
    g.c((x, y) => (y <= 14 ? 0xe6e0d4 : 0xf8f5ef)).rbox(a, 14, -31 + 3, b, 17, -31 + 10, 1).box(a + 2, 18, -31 + 4, b - 2, 18, -31 + 9);
  }
  // 睡着的人：被子下的平滑曲面（不用体素台阶，颜色/格子线和被面一样）。床的设计坐标：x 往房间那侧，z 从胸口（被头）到脚
  // PROF = [z, 半宽, 高]（格）：肩最高约 5.8 格 ≈ 0.18 m，脚最低；横截面是低矮的半椭圆，两边平滑垂下来
  const BX = 7, ZE = -19.5, PROF = [[-21, 8.2, 5.8], [-16, 8.2, 5.6], [-10, 7.6, 5.0], [-5, 7.0, 4.6], [0, 7.2, 4.8], [6, 7.4, 5.0], [11, 6.8, 4.3], [16, 6.0, 3.6], [20, 5.6, 3.3], [24, 5.0, 2.7], [27, 4.4, 2.0], [29, 3.0, 0.6], [30, 0, 0]];
  function profAt(z) {
    if (z <= PROF[0][0]) return PROF[0];
    for (let i = 0; i < PROF.length - 1; i++) {
      const A = PROF[i], B = PROF[i + 1];
      if (z <= B[0]) { const t = (z - A[0]) / (B[0] - A[0]); return [z, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]; }
    }
    return [z, 0, 0];
  }
  function prof(z) {                                                               // 沿身体方向做三角核平滑，轮廓不起棱
    let w = 0, h = 0, n = 0;
    for (let d = -3; d <= 3; d++) { const k = 4 - Math.abs(d), p = profAt(z + d); w += p[1] * k; h += p[2] * k; n += k; }
    return [w / n, h / n];
  }
  function sect(t) {                                                               // 横截面：t = |x|/半宽；0..0.45 半椭圆，之后 Hermite 平滑落到 1.25
    if (t <= 0.45) return Math.sqrt(1 - t * t);
    if (t >= 1.25) return 0;
    const u = (t - 0.45) / 0.8, y0 = Math.sqrt(1 - 0.2025), m0 = -0.45 / y0 * 0.8;
    return Math.max(0, (2 * u * u * u - 3 * u * u + 1) * y0 + (u * u * u - 2 * u * u + u) * m0);
  }
  function bodyH(x, z) {
    if (z >= 29.5 || z < ZE) return 0;
    const [w, h] = prof(z), dx = x - BX;
    let r = h * sect(Math.abs(dx) / Math.max(w, 0.5));
    const leg = z > 8 ? Math.min(1, (z - 8) / 6) : 0;                              // 两条腿之间浅浅的沟
    if (leg > 0) r -= Math.min(r, 0.9 * leg * Math.exp(-dx * dx / 3));
    return Math.max(0, r);
  }
  function sleepQuilt(ctx, P) {
    const m = new THREE.Mesh(quiltGeo(bodyH, -3, 17, -19, 29, ZE), mat(ctx));
    m.name = 'sleep-quilt'; m.castShadow = m.receiveShadow = true;
    m.userData.anchor = 'furn:bed:sleepQuilt';
    V3.parts.tag(m, P + '被子', { label: '被子' });
    return m;
  }
  // 被面鼓起来的那块曲面：bodyH(x, z) = 这一点比平铺的被面高多少（格）；格子 x X0..X1、z Z0..Z1，ze = 被头（胸口那头）的端面在哪。
  // 平的地方不出面（底下是平铺的被面）。颜色、噪点和体素被面一样。
  function quiltGeo(bodyH, X0, X1, Z0, Z1, ZE) {
    const EPS = 0.05, NX = X1 - X0 + 2, NZ = Z1 - Z0 + 2;
    const base = (z) => (z < -16 ? 17 : 16);                                       // 胸口三行是白床单边（比被面高一格）
    const Y = (x, z) => base(z) + bodyH(x, z);
    const nrm = (x, z) => {                                                        // 胸口那一排用单边差分，不让被头的端面把法线拽向床头
      const zb = Math.max(ZE, z - 0.5), a = Y(x + 0.5, z) - Y(x - 0.5, z), b = (Y(x, z + 0.5) - Y(x, zb)) / (z + 0.5 - zb), l = Math.hypot(a, 1, b);
      return [-a / l, 1 / l, -b / l];
    };
    const C = new THREE.Color(), col = (cx, cz) => {                               // 跟底下体素同一个颜色和噪点，边缘接得上
      const wh = cz <= -17, f = 1 + (U.hash3(cx, wh ? 16 : 15, cz) - 0.5) * 0.06;
      C.setHex(wh ? WHITE : QUILT(cx, 15, cz)); return [C.r * f, C.g * f, C.b * f];
    };
    const pos = [], nor = [], cl = [], idx = [];
    const quad = (pts, ns, c) => {
      const b = pos.length / 3;
      for (let k = 0; k < 4; k++) { pos.push(pts[k][0] * S, pts[k][1] * S, pts[k][2] * S); nor.push(...ns[k]); cl.push(...c); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    for (let i = 0; i < NX - 1; i++) for (let j = 0; j < NZ - 1; j++) {
      const x0 = X0 - 0.5 + i, z0 = Z0 - 0.5 + j, P4 = [[x0, z0], [x0, z0 + 1], [x0 + 1, z0 + 1], [x0 + 1, z0]];
      const hs = P4.map(([x, z]) => bodyH(x, z));
      if (hs[0] + hs[1] + hs[2] + hs[3] < 1e-4) continue;                          // 平的地方交给体素被面
      quad(P4.map(([x, z], k) => [x, base(z) + hs[k] + EPS, z]), P4.map(([x, z]) => nrm(x, z)), col(x0 + 0.5, z0 + 0.5));
    }
    for (let i = 0; i < NX - 1; i++) {                                             // 胸口被头的端面：白床单边跟着身体鼓起来
      const x0 = X0 - 0.5 + i, a = bodyH(x0, ZE), b = bodyH(x0 + 1, ZE), n = [0, 0, -1];
      if (a + b < 1e-4) continue;
      const eb = base(ZE + 0.5);                                                   // 端面从这一排的被面（床单边）往上
      quad([[x0, eb, ZE], [x0, eb + a + EPS, ZE], [x0 + 1, eb + b + EPS, ZE], [x0 + 1, eb, ZE]], [n, n, n, n], col(x0 + 0.5, Math.round(ZE + 1.5)));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    geo.setIndex(idx); geo.computeBoundingSphere();
    return geo;
  }
  // 她真的躺进床里时盖在身上的那一块被子（65-girl-actor 的 sleep 行为；游戏里的床是烤好的方块模型，没有「睡着」那一版可换，
  // 所以只在方块床的被面上叠这一块鼓包）。和 sleepQuilt 同一种曲面、同样的格子线，但大小跟着她实际躺的位置走：
  //   o.x 身体中线、o.z0 被头（盖到脖子）、o.z1 被尾（脚后面一点）、o.w 肩那里的半宽、o.h 胸口最高处，单位都是床的设计格（1/32 m，
  //   原点在床中心的地面，−z 是床头）。出了床沿、床尾板的部分压平（不出面）。
  //   o.tint：整块颜色乘多少。方块床画出来（贴图 × 方块的光照）比同一个颜色的体素面暗，默认 COVER_TINT 是在游戏里对着方块床的被面调的。
  // 不进部件表（点不到、反馈工具里没有、不会被导出成方块）、不跟差分走；返回的几何和材质都是新建的，归调用的人管，用完自己 dispose。
  const COVER_Z = [[0, 1], [0.15, 1], [0.4, 0.82], [0.65, 0.58], [0.85, 0.42], [0.95, 0.2], [1, 0]];   // [沿身体 0..1, 高度比例]：胸口最高，往脚那头矮下去
  const COVER_W = [[0, 1], [0.5, 1], [0.82, 0.9], [1, 0.66]];
  const COVER_TINT = 0.4;
  const lerpAt = (T, u) => {
    if (u <= T[0][0]) return T[0][1];
    for (let i = 0; i < T.length - 1; i++) if (u <= T[i + 1][0]) return T[i][1] + (T[i + 1][1] - T[i][1]) * (u - T[i][0]) / (T[i + 1][0] - T[i][0]);
    return T[T.length - 1][1];
  };
  function sleepCover(o) {
    o = o || {};
    const num = (v, d) => (Number.isFinite(+v) ? +v : d), EX = 15, EZ = 28;       // 床沿（两侧垂边外面）、床尾板里面
    const cx = U.clamp(num(o.x, BX), -8, 8), w = U.clamp(num(o.w, 8), 4, 14), h = U.clamp(num(o.h, 6), 2, 12), tint = U.clamp(num(o.tint, COVER_TINT), 0.1, 1);
    const ze = Math.round(U.clamp(num(o.z0, -19), -19, 10)) - 0.5, z1 = U.clamp(num(o.z1, 20), ze + 12, EZ), len = z1 - ze;
    const at = (x, z) => {
      if (z < ze - 1e-6 || z >= z1) return 0;
      let hh = 0, ww = 0, n = 0;                                                   // 沿身体方向三角核平滑（和 prof 一样），轮廓不起棱
      for (let d = -3; d <= 3; d++) { const k = 4 - Math.abs(d), u = (z + d - ze) / len; hh += lerpAt(COVER_Z, u) * k; ww += lerpAt(COVER_W, u) * k; n += k; }
      const edge = U.clamp((EX + 0.5 - Math.abs(x)) / 2.5, 0, 1);                  // 到床沿前收平：被子不悬在床外面
      return Math.max(0, h * hh / n * sect(Math.abs(x - cx) / Math.max(w * ww / n, 0.5)) * edge * edge * (3 - 2 * edge));
    };
    const material = V3.vox.material({ roughness: 0.92 });
    material.color.setRGB(tint, tint, tint);
    Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });   // 边上贴着方块床的被面：往前偏一点，免得闪
    const lo = Math.max(-EX - 1, Math.floor(cx - w * 1.3)), hi = Math.min(EX + 1, Math.ceil(cx + w * 1.3));
    const mesh = new THREE.Mesh(quiltGeo(at, lo, hi, ze + 0.5, Math.ceil(z1), ze), material);
    mesh.name = 'bed-sleep-cover'; mesh.castShadow = mesh.receiveShadow = true;
    return { mesh, material };
  }
  // 睡帽：原点在帽口中心，+y 朝上，+z 朝前；帽尖往后、往左耷拉，白色绒边 + 毛球。width = 帽口外径（米）
  const CAPL = [[0, 0, 0, 6.4], [0, 4, 0, 6.0], [-0.5, 8, -1.2, 5.1], [-1.5, 11.5, -3.2, 4.1], [-2.6, 13.6, -6.2, 3.1], [-3.4, 14.2, -9.5, 2.2], [-3.8, 13.6, -12.6, 1.5], [-3.9, 12.8, -14.5, 1.1]];
  const FLUFF = (x, y, z) => (U.hash3(x, y + 50, z) < 0.35 ? 0xe9edf5 : 0xfbfbf8);
  function buildNightcap(o) {
    o = o || {};
    const width = o.width || 0.5, sc = width / 15, P = o.part || '小屋/一楼/床/睡帽';
    const g = new V3.vox.Grid(17, 23, 28, { origin: [8, 0, 20] });
    g.t(P).c((x, y, z, u) => (Math.floor(u * 1.6) % 2 ? 0xeef1f8 : 0x5574c2)).tube(CAPL);   // 蓝白条纹
    g.c(FLUFF).ell(-4, 12.2, -16, 2.3, 2.3, 2.3);                                    // 毛球
    g.cyl(0, 0, 7, 0, 3).cyl(0, 0, 7.4, 1, 2);                                        // 白色绒边（中间鼓一点）
    g.m('erase').cyl(0, 0, 5.4, 0, 1).m('paint').c(0x3c4f86).cyl(0, 0, 5.4, 2, 2).m('add');   // 帽口里面凹进去（戴的时候头能塞进去）
    const v = V3.vox.build(g, { scale: sc, bones: [{ name: 'cap', pivot: [0, 0, 0] }], anchor: 'nightcap',
      material: o.ctx ? mat(o.ctx) : V3.vox.material({ roughness: 0.85 }), noise: 0.03, ao: 0.4 });
    for (const m of v.meshes) { trim(m, () => false, 2 / sc); m.userData.anchor = o.anchor || 'nightcap'; }
    v.root.name = 'nightcap'; v.root.userData.nightcap = true;
    return v.root;
  }
  function capOnPillow(ctx, Z) {                                                   // 床上那顶：侧躺在靠墙的枕头上，帽口朝房间，帽尖搭到枕头前沿
    const cap = buildNightcap({ width: 0.26, ctx, anchor: 'furn:bed:nightcap' }), k = 0.26 / 15 / S;   // k = 帽子一格 / 床一格
    const ax = new THREE.Vector3(-0.93, -0.06, -0.36).normalize(), fz = new THREE.Vector3(0.36, 0.45, -0.92);
    fz.addScaledVector(ax, -fz.dot(ax)).normalize();
    const fx = new THREE.Vector3().crossVectors(ax, fz);
    const h = new THREE.Group(); h.name = 'bed-nightcap'; h.add(cap);
    h.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fx, ax, fz)); h.scale.set(0.62, 1, 1);   // 软软地塌下来一点
    h.updateMatrix();
    let lo = 1e9; for (let i = 0; i < 24; i++) {                                   // 帽口那一圈最低点贴到枕头面上
      const a = i / 24 * Math.PI * 2, p = new THREE.Vector3(7.5 * Math.cos(a) * k * S, 0, 7.5 * Math.sin(a) * k * S).applyMatrix4(h.matrix);
      lo = Math.min(lo, p.y);
    }
    h.position.set(-3 * S, 19 * S - lo - 0.01, (-Z + 6.5) * S);
    return h;
  }

  // ---- scene part + 一览模型 ----
  if (V3.scene && V3.scene.part) V3.scene.part({ id: 'furn-ground', label: '一楼家具', order: 50, build: (ctx) => buildAll(ctx, 'ground'), update: (dt, t) => tick(dt, t), dispose: (ctx) => release(ctx) });
  V3.models.register({ id: 'furn', label: '家具一览', build() {
    const root = new THREE.Group(), ctx = V3.scene.ctx(root, { studio: true }), box = new THREE.Box3();
    root.name = 'furn-catalog';
    let x = 0, z = 0, rowD = 0, xm = 1, hm = 1;
    const all = [];                                // 高的排后面（相机在 +z 看 −z），矮的在前，互不遮挡
    for (const layer of ['ground', 'loft']) for (const o of buildAll(ctx, layer).children.slice()) {
      o.removeFromParent(); o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); all.push([o, new THREE.Box3().setFromObject(o)]);
    }
    all.sort((p, q) => (q[1].max.y - q[1].min.y) - (p[1].max.y - p[1].min.y));
    for (const [o, b] of all) {
      box.copy(b);
      const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
      if (x > 0 && x + w > 9) { x = 0; z += rowD + 0.6; rowD = 0; }
      o.position.set(x - box.min.x, -box.min.y, z - box.min.z); root.add(o);
      x += w + 0.5; xm = Math.max(xm, x); rowD = Math.max(rowD, d); hm = Math.max(hm, box.max.y - box.min.y);
    }
    const c = [xm / 2, hm / 2, (z + rowD) / 2], dist = Math.max(4, 1.25 * Math.hypot(xm, z + rowD, hm));
    return { id: 'furn', label: '家具一览', root, partRoot: '小屋',
      stage: { pedestal: false, size: Math.max(10, xm + 4), center: c },
      views: { all: { az: 0.35, el: 0.5, dist, target: c } },
      update(dt, t) { ctx.tickLights(); tick(dt, t); },
      dispose() { release(ctx); root.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) [].concat(m.material).forEach((x) => { if (x.map) x.map.dispose(); x.dispose(); }); }); } };
  } });
  // ---- 床头柜（咖啡壶、杯子）：靠北墙，下层开放格 + 抽屉 ----
  const MET = 0xb9c0c7, METD = 0x8d949b, BLK = 0x2b2b2e, BRASS = 0xc9a24a, COFFEE = 0x5a3a22;
  function buildNightstand(ctx) {
    const g = grid('nightstand', 'ground', 28), X = g.hx, Z = g.hz, P = '小屋/一楼/床头柜/';
    g.t(P + '柜体').c(wood(OAK, OAKD, 1));
    for (const sx of [-X + 1, X - 2]) for (const sz of [-Z, Z - 2]) g.box(sx, 0, sz, sx + 1, 2, sz + 1);       // 四条短腿
    g.box(-X + 1, 3, -Z, X - 1, 15, Z - 1).c(OAKL).box(-X, 16, -Z, X, 17, Z);                                  // 柜身 + 出檐台面
    g.m('erase').box(-X + 2, 4, -Z + 2, X - 2, 8, Z - 1).m('paint').c(mix(OAKD, 0, 0.25)).box(-X + 2, 4, -Z + 1, X - 2, 8, -Z + 1).m('add');
    g.c(0x34497a).box(-X + 3, 4, -Z + 3, -1, 5, Z - 3).c(0xb5473a).box(-X + 4, 6, -Z + 4, -2, 6, Z - 4);        // 下格平放两本书
    g.c(wood(OAK, OAKD, 0)).box(-X + 2, 10, Z, X - 2, 14, Z).c(BRASS).box(0, 12, Z + 1, 0, 12, Z + 1);         // 抽屉面板 + 黄铜拉手
    g.t(P + '咖啡壶').c((x, y) => (y === 21 ? METD : y >= 25 ? BLK : MET)).box(-6, 18, -2, -4, 24, 0).box(-5, 25, -1, -5, 25, -1);
    g.c(MET).box(-5, 24, 1, -5, 24, 1).c(BLK).box(-3, 22, -1, -3, 24, -1).box(-2, 21, -1, -2, 23, -1);          // 壶嘴 + 黑把手
    g.t(P + '杯子').c((x, y) => (y === 19 ? 0x5b74b0 : 0xf2efe8)).box(2, 18, -1, 4, 20, 1).box(5, 19, 0, 5, 20, 0);
    g.m('erase').box(3, 19, 0, 3, 20, 0).m('paint').c(COFFEE).box(3, 18, 0, 3, 18, 0).m('add');                 // 杯里的咖啡
    return vox(ctx, g, 'nightstand').root;
  }
  reg({ id: 'nightstand', name: '床头柜', build: buildNightstand, wall: true });

  // ---- 书架（书 + 小盆栽）：靠北墙，四层书，顶上一盆垂下来的绿萝 ----
  const BOOK = [0xb5473a, 0xd9a441, 0x3f7f7a, 0x34497a, 0xe9dfc8, 0x5d8a4e, 0x8a5a3c, 0xd68a8a, 0x6f8fc8];
  const LEAF = [0x5f9e55, 0x4f8a48, 0x7fb86a, 0x3f7a3e], TERRA = 0xb5653b, TERRAL = 0xc87a4f, SOIL = 0x4a3426;
  const leaf = (x, y, z) => LEAF[(U.hash3(x, y, z) * LEAF.length) | 0];
  function buildBookshelf(ctx) {
    const g = grid('bookshelf', 'ground', 76), X = g.hx, Z = g.hz, P = '小屋/一楼/书架/', oakX = wood(OAK, OAKD, 0);
    g.t(P + '柜体').c(wood(OAK, OAKD, 1)).box(-X, 0, -Z, -X, 50, Z).box(X, 0, -Z, X, 50, Z);                  // 侧板（P5：2 格高，柜子矮一点，顶上的绿萝放得下）
    g.c(mix(OAK, OAKD, 0.55)).box(-X + 1, 4, -Z, X - 1, 50, -Z);                                               // 背板
    g.c(oakX).box(-X + 1, 0, -Z, X - 1, 3, Z).m('erase').box(-X + 1, 0, Z, X - 1, 1, Z).m('add');             // 底座（踢脚内凹）
    for (const y of [15, 27, 39]) g.box(-X + 1, y, -Z + 1, X - 1, y, Z);                                       // 层板
    g.c(OAKL).box(-X, 51, -Z, X, 52, Z + 1);                                                                   // 顶檐（不往两边出挑：1 格宽）
    [[4, 14], [16, 26], [28, 38], [40, 50]].forEach(([yb, yt], ci) => {
      const H = yt - yb + 1, x0 = ci === 2 ? -X + 8 : -X + 1, x1 = ci === 1 ? X - 9 : ci === 3 ? X - 8 : X - 1;
      g.t(P + '书');
      for (let x = x0; x <= x1;) {                                                                             // 一组 2–4 本同高的书（省侧面）
        if (x > x0 + 3 && U.hash3(x, ci, 9) < 0.08) { x += 2; continue; }                                        // 偶尔留个空
        const n = 2 + ((U.hash3(x, ci, 7) * 3) | 0), top = yb + Math.floor(H * (0.6 + 0.3 * U.hash3(x, ci, 5))), fz = U.hash3(x, ci, 13) < 0.5 ? 0 : 1;
        for (let k = 0; k < n && x <= x1; k++) {
          const w = Math.min(x1 - x + 1, U.hash3(x, ci, 3) < 0.6 ? 1 : 2), col = BOOK[(U.hash3(x, ci, 11) * BOOK.length) | 0], lab = mix(col, WHITE, 0.5);
          g.c((xx, y) => (y === top - 2 ? lab : col)).box(x, yb, -Z + 1, x + w - 1, top, fz);                    // 书脊上一道浅色标签
          x += w;
        }
      }
      if (ci === 1) for (let k = 0; k < 4; k++)                                                                 // 平放的一摞书
        g.c(BOOK[(k * 4 + 2) % BOOK.length]).box(X - 8 + (k & 1), yb + 2 * k, -Z + 2, X - 2 - (k >> 1), yb + 2 * k + 1, 1 - (k & 1));
      if (ci === 3) {                                                                                          // 小相框：沙滩和海
        g.c(OAKD).box(X - 6, yb, -1, X - 2, yb + 6, -1).box(X - 4, yb, -2, X - 4, yb + 2, -2);
        g.m('paint').c((x, y) => (y <= yb + 1 ? 0xe8d6a8 : y <= yb + 3 ? 0x5b8fc0 : 0xbfd9ee)).box(X - 5, yb + 1, -1, X - 3, yb + 5, -1).m('add');
      }
    });
    g.t(P + '小盆栽').c(TERRA).box(-X + 2, 28, -2, -X + 6, 31, 2).c(SOIL).box(-X + 3, 31, -1, -X + 5, 31, 1);   // 中层小多肉
    g.m('under').c(leaf).ell(-X + 4, 33, 0, 2.6, 2, 2.6).m('add');
    g.c(TERRA).cyl(X - 8, -1, 3, 53, 56, 3).c(TERRAL).cyl(X - 8, -1, 3.4, 57, 57, 3.4).c(SOIL).cyl(X - 8, -1, 2.4, 57, 57, 2.4);
    g.m('under').c(leaf).fill(X - 15, 58, -7, X - 1, 63, 5, (x, y, z) =>                                         // 顶上的绿萝（到 2 米为止）
      (x - X + 8) ** 2 / 42 + (y - 58) ** 2 / 12 + (z + 1) ** 2 / 30 < 1);
    for (const [sx, sz, len, ax] of [[X + 1, Z - 3, 36, 2], [X - 2, Z + 2, 16, 0]]) {                        // 沿右侧/右前垂下的两根藤
      g.box(X - 4, 53, -1, sx, 53, -1).box(sx, 53, -1, sx, 53, sz);
      for (let k = 0; k < len; k++) {
        const s = Math.round(Math.sin(k * 0.4 + sx) * 1.2), x = ax ? sx : sx + s, z = ax ? sz + s : sz, y = 53 - k;
        g.box(x, y, z, x, y, z);
        if (k % 3 === 1) g.box(ax ? x : x - 1, y - 1, ax ? z - 1 : z, ax ? x : x + 1, y, ax ? z + 1 : z);    // 一片叶子
      }
    }
    g.m('add');
    const root = vox(ctx, g, 'bookshelf').root;
    root.userData.clickable = 'diaryShelf';
    return root;
  }
  reg({ id: 'bookshelf', name: '书架', build: buildBookshelf, wall: true });

  // ---- 厨房台面（灶台、水槽、电饭煲）：靠北墙一字排开；水槽对着北窗，灶台在调料罐架下面 ----
  const STONE = 0xe6dccb, GLASS = 0x2a2f36;
  function buildKitchen(ctx) {
    const g = grid('kitchen', 'ground', 38), X = g.hx, Z = g.hz, P = '小屋/一楼/厨房台面/';
    const oakX = wood(OAK, OAKD, 0), oakY = wood(OAK, OAKD, 1);
    g.t(P + '台面').c(OAKD).box(-X, 0, -Z, X, 3, Z - 2);                                                        // 内凹踢脚
    g.c(mix(OAKD, 0, 0.2)).box(-X, 4, -Z, X, 23, Z - 1);                                                         // 柜体（门缝里是深色）
    g.c((x, y, z) => (U.hash3(x, z, 3) < 0.05 ? mix(STONE, 0x8a8172, 0.5) : STONE)).box(-X, 24, -Z, X, 25, Z + 1);   // 石材台面，带细斑点
    g.c((x, y) => ((((x + 66) >> 2) + (y >> 2)) & 1 ? 0xa9c4e0 : 0xf3f0e8)).box(-X, 26, -Z, X, 29, -Z);         // 蓝白瓷砖挡水
    const MOD = [[-X, -46, 'door', 1], [-46, -27, 'drawers'], [-27, -5, 'oven'], [-5, 6, 'drawers'], [6, 27, 'door', 1], [27, 45, 'drawers'], [45, X, 'door', -1]];   // P5：4 米
    for (const [a, b, kind, side] of MOD) {
      const x1 = b < X ? b - 1 : b, m = (a + x1) >> 1;                                                          // 每个模块之间留一道门缝
      if (kind === 'door') {
        g.c(oakY).box(a, 4, Z, x1, 23, Z).box(a + 3, 7, Z + 1, x1 - 3, 20, Z + 1);                               // 门板 + 凸起的芯板
        g.c(BRASS).box(side > 0 ? x1 - 1 : a + 1, 17, Z + 1, side > 0 ? x1 - 1 : a + 1, 18, Z + 1);              // 黄铜拉手
      } else if (kind === 'drawers') for (const [y0, y1] of [[4, 9], [11, 16], [18, 23]]) {
        g.c(oakX).box(a, y0, Z, x1, y1, Z).box(a + 1, y0 + 1, Z + 1, x1 - 1, y1 - 1, Z + 1);
        g.c(BRASS).box(m - 2, y1 - 2, Z + 2, m + 2, y1 - 2, Z + 2);
      } else {                                                                                                   // 烤箱门 + 旋钮条
        g.t(P + '灶台').c(METD).box(a, 4, Z, x1, 18, Z).c(GLASS).box(a + 3, 7, Z, x1 - 3, 14, Z);
        g.c(MET).box(a + 2, 17, Z + 1, x1 - 2, 17, Z + 1).c(BLK).box(a, 20, Z, x1, 23, Z);
        for (let k = 0; k < 4; k++) g.c(MET).box(a + 4 + k * 5, 21, Z + 1, a + 5 + k * 5, 22, Z + 1);
        g.t(P + '小物').c(check(0x5b74b0, WHITE, 2)).box(m - 3, 18, Z + 1, m + 3, 18, Z + 1).box(m - 3, 8, Z + 2, m + 3, 18, Z + 2);   // 搭在把手上的格子擦手巾
        g.t(P + '台面');
      }
    }
    g.t(P + '灶台').c(0x1f1f22).box(-25, 26, -7, -7, 26, 5);                                                   // 黑色灶面 + 两个炉圈（在调料罐架下面）
    for (const cx of [-21, -11]) g.c(METD).fill(cx - 4, 27, -5, cx + 4, 27, 3, (x, y, z) => { const r = Math.hypot(x - cx, z + 1); return r > 2.2 && r < 3.8; }).box(cx, 27, -1, cx, 27, -1);
    g.c(0xc84b3c).cyl(-11, -1, 4, 28, 29, 4).c(0xb03e31).cyl(-11, -1, 3.6, 30, 30, 3.6).c(BLK).box(-11, 31, -1, -11, 31, -1)
      .box(-16, 29, -1, -16, 29, -1).box(-6, 29, -1, -6, 29, -1);                                                 // 红色搪瓷锅（矮一点，1 格以内）
    g.t(P + '水槽').c(MET).box(7, 17, -7, 25, 25, 6).m('erase').box(8, 18, -6, 24, 25, 5).m('add');               // 不锈钢水槽（对着北窗）
    g.m('paint').c(METD).box(16, 17, -1, 16, 17, -1).m('add');                                                     // 下水口
    g.c(MET).box(14, 26, -8, 18, 26, -8).box(16, 27, -8, 16, 31, -8).box(16, 31, -7, 16, 31, -3).box(16, 30, -3, 16, 30, -3);   // 鹅颈龙头（矮一点）
    g.c(METD).box(19, 28, -8, 19, 29, -8).box(19, 29, -7, 19, 29, -6);
    g.c(0x7fb86a).box(3, 26, -6, 4, 29, -5).c(METD).box(3, 30, -6, 3, 31, -6);                                    // 洗洁精
    g.t(P + '小物').c(check(0x5b74b0, WHITE, 1)).box(-4, 26, -1, 0, 26, 3).box(-5, 27, -2, 1, 28, 4)              // 蓝格子碗 + 橘子柠檬（灶台和水槽之间）
      .m('erase').box(-4, 28, -1, 0, 28, 3).m('add').c(0xe8902e).box(-3, 28, 0, -2, 29, 1).box(-1, 28, 1, -1, 28, 2).c(0xe8d24a).box(-3, 28, 2, -3, 28, 2);
    g.c(0xece4d4).cyl(-31, -4, 2.2, 26, 29, 2.2).c(OAKL).box(-32, 30, -4, -32, 31, -4).box(-30, 30, -5, -30, 31, -5);   // 厨具筒 + 木勺
    g.c(wood(OAKL, OAK, 1)).box(28, 26, -8, 36, 30, -8).box(31, 31, -8, 33, 31, -8);                             // 靠墙的砧板
    g.t(P + '电饭煲').c(0xf2efe8).cyl(50, -1, 5, 26, 29, 4.6).m('under').c(0xdcd8cf).ell(50, 30, -1, 4.6, 1.4, 4.2).m('add');
    g.c(0x3d4752).box(48, 27, 3, 52, 28, 3).c(0xff9a3c).box(49, 28, 4, 49, 28, 4);
    const kv = vox(ctx, g, 'kitchen'); addDishes(ctx, kv.root);
    return kv.root;
  }
  // ---- 饭碗 + 不锈钢盆（电饭煲两边）：各有 empty / full 差分，full = 堆起来的白米饭（米粒是三种白色 + 小凸起） ----
  // 细网格单独建：碗 1/128 m、盆 1/96 m；米饭是同一网格里的第二根骨骼 'rice'，empty 时隐藏
  defVariant('bowl', ['empty', 'full']); defVariant('basin', ['empty', 'full']);
  const RICE = (x, y, z) => { const h = U.hash3(x, y, z); return h < 0.22 ? 0xd9d3c3 : h > 0.8 ? 0xffffff : 0xf3f0e6; };
  const gau = (a, c, w) => { const d = Math.atan2(Math.sin(a - c), Math.cos(a - c)); return Math.exp(-d * d / (2 * w * w)); };
  function bowlCol(x, y, z, o) {                   // 白瓷碗：钴蓝碗沿 + 蓝格子外壁 + 白釉内壁
    const r = Math.hypot(x, z), H = o.prof.length;
    if (y >= H - 1) return r > o.prof[H - 1] - 0.8 ? 0x34508f : 0xf4f6fb;
    if (y >= o.floor && r < o.prof[y] - 0.9) return 0xf4f6fb;
    if (y < o.floor) return y === 0 ? 0x3f5f9a : 0xf4f6fb;
    const sa = Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI / 6)) & 1, sb = ((y - o.floor) >> 1) & 1;
    return sa && sb ? 0x5b7fc0 : sa || sb ? 0xbcd0ec : 0xf4f6fb;
  }
  function steelCol(x, y, z, o) {                  // 不锈钢：竖向亮带/暗带随方位角变（亮带朝镜头和吊灯），内壁反过来；卷边一道亮线
    const r = Math.hypot(x, z), H = o.prof.length, inner = y >= o.floor && r < o.prof[y] - 0.7;
    const a = Math.atan2(z, x) + (inner ? Math.PI : 0);
    let k = 0.42 + 0.38 * gau(a, 1.25, 0.35) + 0.3 * gau(a, 0.35, 0.16) - 0.28 * gau(a, 2.2, 0.25) + 0.08 * Math.cos(a - 1.0);
    if (!inner) k -= 0.12 * (1 - y / H);
    if (y === H - 1) k += 0.25;
    if (y < o.floor) k = 0.6 + 0.08 * Math.sin(r * 1.9);                       // 盆底车削纹
    return mix(0x6f7882, 0xf4f7fa, Math.max(0, Math.min(1, k)));
  }
  const DISHES = [
    { id: 'bowl', name: '饭碗', part: '碗', sc: 1 / 128, at: [59, 2], mat: 'china', wall: 1.3, floor: 2, col: bowlCol,
      prof: [3.2, 3.4, 4.6, 5.4, 6.0, 6.5, 6.9, 7.2, 7.3], dome: [6.0, 3.5] },
    { id: 'basin', name: '不锈钢盆', part: '盆', sc: 1 / 96, at: [38, 1], mat: 'steel', wall: 1.2, floor: 1, col: steelCol,
      prof: [8.5, 9.6, 10.4, 11.0, 11.5, 12.0, 12.4, 12.7, 13.4], dome: [11.3, 5.5] },
  ];
  const dishLook = (k) => (k === 'steel' ? { roughness: 0.3, extra: { metalness: 0.2 } } : { roughness: 0.4 });
  function dishMat(ctx, k) {
    const key = '_furnDish' + k;
    return ctx[key] || (ctx[key] = V3.vox.material(dishLook(k)));
  }
  // 体素本身（原点在碗底中心）。under：朝下的面也留着（端在手里的那只从低处能看到碗底；台面上的看不到，去掉）
  function dishVox(o, china, riceMat, under) {
    const H = o.prof.length, R = Math.ceil(Math.max(...o.prof)) + 2, n = 2 * R + 1, [dr, dh] = o.dome;
    const g = new V3.vox.Grid(n, H + Math.ceil(dh) + 3, n, { origin: [R, 0, R] }), P = '小屋/一楼/厨房台面/' + o.name + '/';
    g.t(P + o.part).b(0).c((x, y, z) => o.col(x, y, z, o));
    for (let y = 0; y < H; y++) g.cyl(0, 0, o.prof[y], y, y, o.prof[y]);
    g.m('erase'); for (let y = o.floor; y < H; y++) g.cyl(0, 0, o.prof[y] - o.wall, y, y, o.prof[y] - o.wall);
    g.m('under').t(P + '米饭').b(1).c(RICE).fill(-R, H - 2, -R, R, H + Math.ceil(dh), R, (x, y, z) => {
      const r = Math.hypot(x, z), bump = U.hash3(x, z, 77) < 0.3 ? 0.7 : 0;
      return y < H ? r <= o.prof[y] - o.wall + 0.6 : (r / dr) ** 2 + ((y - H + 0.5) / (dh + bump)) ** 2 <= 1;
    }).m('add');
    const v = V3.vox.build(g, { scale: o.sc, bones: [{ name: 'root', pivot: [0, 0, 0] }, { name: 'rice', pivot: [0, 0, 0], parent: 0 }],
      anchor: 'furn:' + o.id, material: china, noise: o.mat === 'steel' ? 0 : 0.02, ao: o.mat === 'steel' ? 0.3 : 0.5 });   // 钢面不加随机噪点（否则像藤编）
    for (const m of v.meshes) {
      trim(m, under ? () => false : (ny) => ny < -0.5, 2 / o.sc);               // 朝下的面（盆底、卷边下沿）看不见
      if (m.name === 'vox:rice') m.material = m.material.map(() => riceMat);
    }
    v.root.name = 'furn:' + o.id;
    return v;
  }
  function dish(ctx, o) {
    const v = dishVox(o, dishMat(ctx, o.mat), mat(ctx), false);
    v.root.position.set(o.at[0] * S, 26 * S, o.at[1] * S);
    const rice = v.byName.rice;
    onVariant(ctx, o.id, (nm) => { rice.visible = nm === 'full'; });
    return v.root;
  }
  // 一只不在台面上的碗 / 盆（69-furniture-play：她端到餐桌上的那碗饭）：体素和台面上那只一样，米饭一直显示，原点在碗底中心。
  // 不跟差分走、不进部件表（点不到、反馈工具里没有）；返回的几何和两种材质 [瓷, 米饭] 都是新建的，归调用的人管，用完自己 dispose。
  function looseDish(id) {
    const o = DISHES.find((q) => q.id === id);
    if (!o) return null;
    const materials = [V3.vox.material(dishLook(o.mat)), V3.vox.material({ roughness: 0.8 })];
    const v = dishVox(o, materials[0], materials[1], true);
    V3.parts.untag(v.root);
    return { root: v.root, meshes: v.meshes, materials };
  }
  function addDishes(ctx, root) {
    for (const o of DISHES) try { root.add(dish(ctx, o)); } catch (e) { V3.err('furn ' + o.id + ': ' + (e && e.stack || e)); }
  }
  reg({ id: 'kitchen', name: '厨房台面', build: buildKitchen, wall: true });

  // ---- 调料罐架：灶台上方北墙上的小木架，一排玻璃罐 + 一小盆罗勒，架子下挂三个杯子 ----
  function buildJars(ctx) {
    const g = grid('jars', 'ground', 11, 7), X = g.hx, Z = g.hz, P = '小屋/一楼/调料罐架/';
    g.t(P + '架子').c(wood(OAK, OAKD, 1)).box(-X, 0, -Z, -X, 9, Z).box(X, 0, -Z, X, 9, Z);                    // 两块侧板
    g.c(wood(OAK, OAKD, 0)).box(-X + 1, 0, -Z, X - 1, 1, Z).box(-X + 1, 9, -Z, X - 1, 9, Z).box(-X + 1, 4, Z, X - 1, 4, Z);   // 底板、顶板、前挡杆
    [[-X + 5, WHITE], [0, 0xe9dfc8], [X - 5, 0xa9c4e0]].forEach(([x, col]) => {                                 // 架子下挂三个杯子
      g.c(BLK).box(x, -2, 0, x, -1, 0);
      g.c((xx, y) => (y === -4 ? 0x5b74b0 : col)).box(x - 1, -6, -1, x + 1, -3, 1).box(x + 2, -5, 0, x + 2, -4, 0);
    });
    g.t(P + '罐子');
    for (const [x, h, col] of [[-13, 6, 0xe8c46a], [-9, 5, 0x8a3b2e], [-5, 6, 0xf3efe6], [-1, 4, 0xd27c3a], [3, 6, 0x4a2e1c], [7, 5, 0x8aa05a]]) {   // P5：1 米宽
      g.c((xx, y) => (y === 1 + h ? 0xdde9ea : col)).box(x, 2, -1, x + 2, 1 + h, 1);                                // 玻璃罐：装着东西 + 顶上一截空玻璃
      g.c(h > 5 ? 0xb08a5c : METD).box(x, 2 + h, -1, x + 2, 2 + h, 1);                                              // 木塞 / 铁盖
    }
    g.t(P + '小盆栽').c(TERRA).box(10, 2, -1, 14, 4, 1).c(SOIL).box(11, 4, 0, 13, 4, 0);
    g.m('under').c(leaf).ell(12, 6.5, 0, 2.6, 2.2, 1.8).m('add');
    return vox(ctx, g, 'jars').root;
  }
  reg({ id: 'jars', name: '调料罐架', build: buildJars, onWall: 'n', y: (it) => it.wallY });

  // ---- 小冰箱：复古圆角小冰箱（淡海蓝），门上用冰箱贴贴着她画的海边小画，顶上一篮面包 ----
  const FRIDGE = 0x9fc9dc, SAND = 0xe8d6a8, SEA = 0x5b8fc0, SUN = 0xf2c94c, RED = 0xc84b3c, PINK = 0xe88aa0;
  function buildFridge(ctx) {
    const g = grid('fridge', 'ground', 32), X = g.hx, Z = g.hz, P = '小屋/一楼/小冰箱/';   // P5：1 格高
    g.t(P + '箱体').c(METD);
    for (const sx of [-X + 1, X - 2]) for (const sz of [-Z + 1, Z - 3]) g.box(sx, 0, sz, sx + 1, 1, sz + 1);        // 四只镀铬脚
    g.c(FRIDGE).rbox(-X, 2, -Z, X, 27, Z - 1, [3, 3, 0]).box(-X, 2, -Z, X, 14, Z - 1);                            // 圆角箱体（底部方角）
    g.box(-X + 1, 3, Z, X - 1, 17, Z).rbox(-X + 1, 19, Z, X - 1, 26, Z, [2, 2, 0]);                                // 冷藏门 + 冷冻门
    for (const [y0, y1] of [[8, 15], [21, 24]])                                                                      // 镀铬把手
      g.c(MET).box(-X + 2, y0, Z + 1, -X + 2, y0, Z + 1).box(-X + 2, y1, Z + 1, -X + 2, y1, Z + 1).box(-X + 2, y0, Z + 2, -X + 2, y1, Z + 2);
    g.c(MET).box(-2, 25, Z + 1, 2, 25, Z + 1);                                                                        // 铭牌
    g.t(P + '冰箱贴').m('paint').c((x, y) => (y <= 6 ? SAND : y === 9 && x >= 1 && x <= 3 ? 0x8a5a3c : y <= 9 ? SEA
      : x >= 5 && x <= 6 && y >= 12 && y <= 13 ? SUN : (x === 2 && y <= 12) || (x === 3 && y <= 11) ? RED : WHITE))
      .box(0, 5, Z, 7, 15, Z).m('add');                                                                               // 她画的小画：沙滩、海、小船、太阳
    g.c(RED).box(0, 15, Z + 1, 0, 15, Z + 1).c(SUN).box(7, 15, Z + 1, 7, 15, Z + 1)                                   // 冰箱贴
      .c(SEA).box(-6, 6, Z + 1, -5, 6, Z + 1).c(0x7fb86a).box(4, 22, Z + 1, 4, 22, Z + 1);
    g.t(P + '面包篮').c((x, y, z) => ((x + y + z) & 1 ? 0xc9a46a : 0xa8824a)).box(-5, 28, -5, 5, 30, 4)
      .m('erase').box(-4, 29, -4, 4, 30, 3).m('add');
    g.c(0xd9a05a).ell(-1, 30, -1, 3.4, 1.4, 2.2).c(0xc98a45).tube([[-2, 29, 2, 1.0], [5, 30, -2, 1.0]]);            // 圆面包 + 法棍
    return vox(ctx, g, 'fridge').root;
  }
  reg({ id: 'fridge', name: '小冰箱', build: buildFridge, wall: true });

  // ---- 餐桌（红白格子桌布 + 小花瓶）：桌布四角垂下来，中间一瓶野花，两头各一套盘子杯子 ----
  function buildDining(ctx) {
    const g = grid('dining', 'ground', 40), X = g.hx, Z = g.hz, P = '小屋/一楼/餐桌/', oakY = wood(OAK, OAKD, 1);
    g.t(P + '桌子');
    for (const cx of [-X + 3, X - 3]) for (const cz of [-Z + 3, Z - 3]) {                                      // 车削桌腿：细腰 + 鼓节 + 深色环
      g.c(oakY).cyl(cx, cz, 1.2, 0, 16).cyl(cx, cz, 1.5, 0, 1).cyl(cx, cz, 1.5, 9, 11).cyl(cx, cz, 1.5, 14, 16);
      g.m('paint').c(OAKD).cyl(cx, cz, 1.5, 8, 8).cyl(cx, cz, 1.5, 12, 12).m('add');
    }
    g.c(wood(OAK, OAKD, 0)).box(-X + 1, 17, -Z + 1, X - 1, 18, Z - 1);                                           // 桌面
    g.t(P + '桌布').c(check(0xd0574a, WHITE, 3)).box(-X, 19, -Z, X, 19, Z)
      .box(-X, 14, -Z, -X, 18, Z).box(X, 14, -Z, X, 18, Z).box(-X, 14, -Z, X, 18, -Z).box(-X, 14, Z, X, 18, Z);
    for (const sx of [-X, X]) for (const sz of [-Z, Z]) {                                                       // 四个角垂得更低
      const ix = sx - Math.sign(sx), iz = sz - Math.sign(sz);
      g.box(sx, 11, sz, sx, 13, sz).box(ix, 12, sz, ix, 13, sz).box(sx, 12, iz, sx, 13, iz);
    }
    g.t(P + '花瓶').c((x, y) => (y === 22 ? WHITE : SEA)).cyl(0, 0, 2.2, 20, 23, 2.2).cyl(0, 0, 1.2, 24, 25, 1.2);   // 1 × 1 米（1 格）：花瓶矮 2 格，花低 3 格，最高到 1 米
    for (const [tx, ty, tz, col] of [[0, 31, 0, SUN], [-3, 29, 1, WHITE], [3, 28, -1, PINK], [1, 29, 3, 0x8fb3e0], [-1, 27, -3, WHITE]]) {
      g.c(0x4f8a48).tube([[0, 25, 0, 0.75], [tx, ty - 1, tz, 0.75]]);                                              // 花茎
      g.c(col).box(tx - 1, ty, tz, tx + 1, ty, tz).box(tx, ty, tz - 1, tx, ty, tz + 1).c(col === SUN ? 0xd27c3a : SUN).box(tx, ty, tz, tx, ty, tz);
    }
    g.t(P + '餐具');
    const PX = Math.min(15, X - 6);                                                                              // 盘子离中间（1 米宽的桌子是 9 格，在桌面里）
    for (const s of [-1, 1]) {                                                                                  // 两头各一个盘子 + 一只杯子
      g.c(WHITE).cyl(s * PX, 0, 3.6, 20, 20, 3.6).m('paint').c(0xe6e1d6).cyl(s * PX, 0, 2.2, 20, 20, 2.2).m('add');
      g.c((x, y) => (y === 22 ? 0x5b74b0 : WHITE)).box(s * PX - 1, 20, 6, s * PX + 1, 22, 8).box(s * PX + 2 * s, 21, 7, s * PX + 2 * s, 21, 7);
    }
    return vox(ctx, g, 'dining').root;
  }
  reg({ id: 'dining', name: '餐桌', build: buildDining });

  // ---- 餐椅 ×2：梯背椅 + 草编坐面，面朝餐桌 ----
  function buildChairD(ctx, id, name) {
    const g = grid(id, 'ground', 28), P = '小屋/一楼/' + name + '/', oakY = wood(OAK, OAKD, 1), oakX = wood(OAK, OAKD, 0);
    g.t(P + '框架').c(oakY);
    for (const sx of [-7, 6]) g.box(sx, 0, 5, sx + 1, 9, 6).box(sx, 0, -7, sx + 1, 24, -6);                  // 前腿 + 后柱
    g.c(oakX).box(-5, 3, 6, 5, 3, 6).box(-5, 5, -7, 5, 5, -7);                                                 // 前、后横撑
    g.c(wood(OAK, OAKD, 2)).box(-7, 4, -5, -7, 4, 4).box(7, 4, -5, 7, 4, 4);                                   // 侧横撑
    g.c(oakX).box(-7, 9, -7, 7, 9, 7);                                                                         // 坐面框
    for (const y of [14, 18]) g.box(-5, y, -7, 5, y + 1, -7);                                                  // 梯背横板
    g.c(OAKL).box(-8, 23, -7, 8, 25, -6);                                                                      // 顶横档
    g.t(P + '坐面').c((x, y, z) => (((x + z + 64) >> 1) & 1 ? 0xd9b77a : 0xc49f62)).box(-6, 10, -6, 6, 10, 6);   // 草编坐面
    return vox(ctx, g, id).root;
  }
  reg({ id: 'chairDW', name: '餐椅1', face: 'e', build: (ctx) => buildChairD(ctx, 'chairDW', '餐椅1') });
  reg({ id: 'chairDE', name: '餐椅2', face: 'w', build: (ctx) => buildChairD(ctx, 'chairDE', '餐椅2') });

  // ---- 书桌（复古电脑、台灯、摊开的书）：靠西墙面朝东；左边米色老电脑，右边黄铜台灯，中间摊开一本书 ----
  const BEIGE = 0xd9cfb8, BEIGED = 0xb8ad94, DESKB = [{ name: 'root', pivot: [0, 0, 0] }, { name: 'bulb', pivot: [0, 0, 0], parent: 0 }];
  function glowUp(v, gm) {                       // 发光骨骼换成 glowMat（保持材质数组，fb 工具按槽位换材质）
    for (const m of v.meshes) { const k = m.userData.anchor.split(':').pop(); if (gm[k]) { m.material = [].concat(m.material).map(() => gm[k]); m.userData.noShadow = true; } }
  }
  function buildDesk(ctx) {
    const g = grid('desk', 'ground', 36), X = g.hx, Z = g.hz, P = '小屋/一楼/书桌/', oakX = wood(OAK, OAKD, 0);
    g.t(P + '桌子').c(wood(OAK, OAKD, 1));
    for (const sx of [-X, X - 1]) for (const sz of [-Z, Z - 2]) g.box(sx, 0, sz, sx + 1, 17, sz + 1);           // 四条腿
    g.c(oakX).box(-X + 2, 14, Z - 1, X - 2, 17, Z - 1).box(-X + 2, 14, -Z, X - 2, 17, -Z);                       // 前后望板
    g.c(wood(OAK, OAKD, 2)).box(-X, 14, -Z + 2, -X, 17, Z - 3).box(X, 14, -Z + 2, X, 17, Z - 3);                 // 两侧望板
    g.m('erase').box(-7, 14, Z - 1, 7, 15, Z - 1).m('add');                                                       // 中间放腿的地方望板窄一点
    for (const [a, b] of [[-23, -9], [9, 23]]) g.c(oakX).box(a, 14, Z, b, 17, Z).c(BRASS).box((a + b) >> 1, 15, Z + 1, (a + b) >> 1, 16, Z + 1);
    g.c(wood(OAKL, OAK, 0)).box(-X, 18, -Z, X, 19, Z);                                                            // 桌面
    g.t(P + '电脑').c(BEIGE).box(-17, 20, -1, -3, 31, 2).c(BEIGED).box(-15, 21, -8, -5, 29, -2).box(-13, 23, -9, -7, 27, -9);   // 显像管显示器
    g.m('erase').box(-15, 22, 1, -5, 30, 2).m('paint').c(0x5fd068).box(-5, 20, 2, -5, 20, 2).c(SUN).box(-4, 29, 2, -3, 30, 2).m('add');   // 屏幕凹进去 + 电源灯 + 便利贴
    g.c(0x101418).box(-15, 22, 1, -5, 30, 1);                                                                    // 屏幕后面的暗玻璃（画面是 pcScreen 平面）
    g.c((x, y, z) => ((x + z) & 1 ? BEIGE : 0xece4d0)).box(-16, 20, 4, -4, 20, 8).c(BEIGE).box(-1, 20, 5, 0, 20, 7);   // 键盘 + 鼠标
    g.c(0x34497a).box(-22, 20, 3, -20, 20, 5);                                                                    // 一张软盘
    g.t(P + '书').c(0x3f7f7a).box(1, 20, 1, 13, 20, 9).c((x, y, z) => (z & 1 ? 0xd8d2c4 : 0xf6f2e8)).box(2, 20, 2, 6, 20, 8).box(8, 20, 2, 12, 20, 8)
      .box(5, 21, 2, 6, 21, 8).box(8, 21, 2, 9, 21, 8).c(0x2f5f5a).box(7, 20, 2, 7, 20, 8);                      // 摊开的书：页面向书脊拱起
    g.c(SEA).cyl(-22, -5, 1.6, 20, 24, 1.6).c(RED).box(-22, 25, -5, -22, 27, -5).c(SUN).box(-21, 25, -6, -21, 26, -6).c(0x5d8a4e).box(-23, 25, -4, -23, 28, -4);   // 笔筒
    g.c(0x5d8a4e).box(15, 20, 2, 22, 20, 8).c(0xe9dfc8).box(16, 21, 3, 22, 21, 7);                               // 两本笔记本
    g.t(P + '台灯').c(BRASS).cyl(19, -6, 2.4, 20, 20, 2.4).tube([[19, 21, -6, 0.6], [19, 28, -6, 0.6], [16, 31, -3, 0.6]]);
    g.c(0xb8913f).fill(11, 27, -8, 21, 31, 2, (x, y, z) => Math.hypot(x - 16, z + 3) <= 1.2 + (31 - y) * 0.75)    // 灯罩
      .m('erase').fill(11, 27, -8, 21, 28, 2, (x, y, z) => Math.hypot(x - 16, z + 3) <= (31 - y) * 0.75 - 0.3).m('add');
    g.b(1).c(0xfff0c8).box(16, 28, -3, 16, 28, -3).b(0);                                                          // 灯泡（发光）
    const v = vox(ctx, g, 'desk', DESKB);
    glowUp(v, { bulb: ctx.glowMat(0xffe0a8, { day: 0.5, night: 3 }) });
    ctx.lamp({ pos: [16 * S, 27 * S, -3 * S], color: 0xffc27a, intensity: 3, distance: 3.5, parent: v.root });
    v.root.add(pcScreen(ctx, P));
    return v.root;
  }
  // 电脑屏幕：64×52 CanvasTexture（Nearest），map + emissiveMap 都用它。变体 pc：off（默认）黑屏 + 暗蓝小鲸鱼图标；
  // on 亮屏，小鲸鱼在屏幕里游来游去（约 8 fps，只在 on 时重画）。V3.furn.setVariant('pc', 'on')
  defVariant('pc', ['off', 'on']);
  const PCW = 64, PCH = 52;
  const WHA = ['.....OOOOOO.........', '...OObbbbbbOO.......', '..ObbbbbbbbbbO....OO', '.ObbbbbbbbbbbbO..ObO', '.ObebbbbbbbbbbbOObO.',
    'ObbbbbbbbbbbbbbbbO..', 'OccccbbbbbbbbbbbO...', '.OccccccccbbbbOO....', '..OOccccccccOO......', '....OOOOOOOO........'];
  const WHB = ['.....OOOOOO.........', '...OObbbbbbOO.......', '..ObbbbbbbbbbO......', '.ObbbbbbbbbbbbO.....', '.ObebbbbbbbbbbbO....',
    'ObbbbbbbbbbbbbbbOOOO', 'OccccbbbbbbbbbbbObbO', '.OccccccccbbbbOO.OO.', '..OOccccccccOO......', '....OOOOOOOO........'];
  const PAL_OFF = { O: '#14223d', b: '#22385f', c: '#2e4a78', e: '#05070a' }, PAL_ON = { O: '#1f3560', b: '#3f66b0', c: '#e8f2ff', e: '#0b1020' };
  const hexs = (h) => '#' + h.toString(16).padStart(6, '0');
  const GRAD = Array.from({ length: PCH }, (_, y) => hexs(mix(0xc4f2e2, 0x7fd0bb, y / (PCH - 1))));
  function pcScreen(ctx, P) {
    const cv = document.createElement('canvas'); cv.width = PCW; cv.height = PCH;
    const c2 = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv);
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    (ctx._furnTex = ctx._furnTex || []).push(tex);
    const m = ctx.glowMat(0xffffff, { day: 0.25, night: 0.5 });
    m.map = m.emissiveMap = tex; m.roughness = 0.3; m.needsUpdate = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(11 * S, 9 * S), m);
    mesh.position.set(-10 * S, 26.5 * S, 1.5 * S + 0.002); mesh.name = 'pc-screen'; mesh.castShadow = false;
    Object.assign(mesh.userData, { screen: true, anchor: 'furn:desk:screen', noShadow: true });
    V3.parts.tag(mesh, P + '屏幕', { label: '电脑屏幕' });
    const px = (x, y, w, h, s) => { c2.fillStyle = s; c2.fillRect(x, y, w, h); };
    const sprite = (sp, ox, oy, pal, flip) => {
      for (let r = 0; r < sp.length; r++) for (let q = 0; q < sp[r].length; q++) {
        const ch = sp[r][q]; if (ch !== '.') px(flip ? ox + sp[r].length - 1 - q : ox + q, oy + r, 1, 1, pal[ch]);
      }
    };
    let on = false, fr = -1;
    const draw = (t) => {
      if (!on) {                                                                  // 关机：黑屏，玻璃上一点反光，中间暗蓝小鲸鱼图标
        px(0, 0, PCW, PCH, '#05070a');
        for (let k = 0; k < 14; k++) px(5 + k, 16 - k, 3, 1, 'rgba(255,255,255,0.05)');
        sprite(WHA, 22, 21, PAL_OFF, false);
      } else {                                                                    // 开机：海水渐变 + 沙底 + 水草 + 气泡，小鲸鱼来回游
        for (let y = 0; y < PCH; y++) px(0, y, PCW, 1, GRAD[y]);
        px(0, 0, PCW, 4, '#2f4f8f'); for (let k = 0; k < 3; k++) px(PCW - 5 - k * 4, 1, 2, 2, '#e8f2ff');   // 小窗口标题栏
        for (let x = 0; x < PCW; x++) { const top = 46 + Math.round(Math.sin(x * 0.3)); px(x, top, 1, PCH - top, x % 3 ? '#e8d6a8' : '#d9c08c'); }
        px(30, 46, 3, 1, '#f08a5d'); px(31, 45, 1, 3, '#f08a5d');                                  // 沙上的小海星
        for (const [sx, s] of [[10, 0], [53, 2]]) for (let y = 34; y < 46; y++) px(sx + Math.round(Math.sin(t * 2 + y * 0.5 + s)), y, 2, 1, '#3f8f5a');
        for (let i = 0; i < 4; i++) {
          const ph = t * 0.35 + i * 0.25, cyc = Math.floor(ph), u = ph - cyc;
          px(4 + Math.floor(U.hash3(i, cyc, 7) * 56) + Math.round(Math.sin(t * 2 + i)), Math.round(42 - u * 36), 2, 2, 'rgba(255,255,255,0.75)');
        }
        const a = t / 12 * Math.PI * 2;
        sprite(Math.floor(t * 4) % 2 ? WHB : WHA, Math.round(21 + 19 * Math.sin(a)), 18 + Math.round(4 * Math.sin(t * 1.7)), PAL_ON, Math.cos(a) > 0);
      }
      for (let y = 1; y < PCH; y += 2) px(0, y, PCW, 1, 'rgba(0,0,0,0.07)');      // 扫描线
      for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [PCW - 1, 0, -1, 1], [0, PCH - 1, 1, -1], [PCW - 1, PCH - 1, -1, -1]]) {
        px(Math.min(cx, cx + sx), cy, 2, 1, '#000'); px(cx, Math.min(cy, cy + sy), 1, 2, '#000');   // 显像管圆角
      }
      tex.needsUpdate = true;
    };
    onVariant(ctx, 'pc', (name) => {
      on = name === 'on';
      Object.assign(m.userData.glow, on ? { day: 0.45, night: 0.75 } : { day: 0.25, night: 0.5 });   // 夜里别被 bloom 冲白
      fr = -1; draw((V3.R && V3.R.t) || 0);
    });
    onTick(ctx, (dt, t) => { if (!on) return; const f = Math.floor(t * 8); if (f !== fr) { fr = f; draw(f / 8); } });
    return mesh;
  }
  reg({ id: 'desk', name: '书桌', face: 'e', build: buildDesk, wall: true });

  // ---- 椅子（蓝格子坐垫）：书桌前的温莎靠背椅，面朝书桌 ----
  function buildDeskChair(ctx) {
    const g = grid('deskChair', 'ground', 30), P = '小屋/一楼/椅子/', oakX = wood(OAK, OAKD, 0);
    g.t(P + '框架').c(wood(OAK, OAKD, 1));
    for (const sx of [-7, 6]) g.box(sx, 0, 5, sx + 1, 9, 6).box(sx, 0, -7, sx + 1, 26, -6);                      // 前腿 + 后柱
    g.c(wood(OAK, OAKD, 2)).box(-6, 3, -5, -6, 3, 4).box(6, 3, -5, 6, 3, 4).c(oakX).box(-5, 3, 0, 5, 3, 0);      // H 形横撑
    g.c(oakX).box(-7, 9, -7, 7, 10, 7);                                                                           // 坐板
    for (const x of [-3, -1, 1, 3]) g.box(x, 11, -7, x, 23, -7);                                                  // 靠背细柱
    g.c(OAKL).box(-8, 24, -7, 8, 25, -6).box(-5, 26, -7, 5, 26, -6);                                              // 弧形顶档
    g.t(P + '坐垫').c(check(0x5b74b0, WHITE, 2)).rbox(-6, 11, -5, 6, 12, 7, [2, 0, 2])
      .c(0x5b74b0).box(-5, 9, -8, -5, 10, -8).box(5, 9, -8, 5, 10, -8);                                          // 蓝格子坐垫 + 系带
    return vox(ctx, g, 'deskChair').root;
  }
  reg({ id: 'deskChair', name: '椅子', face: 'w', build: buildDeskChair });
  // ---- 6 个画框（西墙 2×3）：画布是单独的平面 mesh，userData.canvas = 0..5，第⑤阶段换成她的画；现在是占位小画 ----
  const FLW = [[0.34, 0.74, PINK], [0.5, 0.86, SUN], [0.66, 0.72, RED], [0.42, 0.62, WHITE], [0.6, 0.6, 0xb56aa0]];
  const ART = [                                    // (u, v) ∈ [0,1]²，v 向上
    (u, v) => (Math.hypot((u - 0.76) * 2, v - 0.74) < 0.15 ? SUN : v > 0.48 ? 0x9fd0ea : v > 0.25 ? SEA : v > 0.2 ? WHITE : SAND),   // 海和太阳
    (u, v) => (v < 0.4 ? (Math.abs(u - 0.5) < 0.04 + v * 0.2 && ((v * 30) | 0) % 2 ? 0xffd27a : 0x46699a)                           // 日落
      : Math.hypot((u - 0.5) * 2, v - 0.4) < 0.26 ? 0xffd27a : [0xf3a35c, 0xee7f6a, 0xb56aa0][Math.min(2, ((v - 0.4) * 5) | 0)]),
    (u, v) => {                                                                                                                     // 小帆船
      if (v < 0.3) return ((u * 10 + v * 7) | 0) % 3 ? SEA : 0x7aa9d4;
      if (v < 0.4 && Math.abs(u - 0.5) < 0.2 - (0.4 - v) * 0.8) return RED;
      if (u > 0.5 && u < 0.53 && v < 0.92) return OAKD;
      if (v > 0.42 && ((u >= 0.53 && u - 0.53 < (0.9 - v) * 0.6) || (u < 0.5 && 0.5 - u < (0.85 - v) * 0.45))) return WHITE;
      return 0xbfe2f0;
    },
    (u, v) => {                                                                                                                     // 灯塔
      const d = Math.abs(u - 0.3), e = 0.5 - v * 0.4;
      if (v > 0.3 && v < 0.78 && d < 0.06 - (v - 0.3) * 0.04) return ((v * 14) | 0) % 2 ? RED : WHITE;
      if (v >= 0.78 && v < 0.86 && d < 0.05) return 0xffe08a;
      if (v >= 0.86 && v < 0.95 && d < 0.07 - (v - 0.86) * 0.7) return BLK;
      if (v > 0.8 && v < 0.84 && u > 0.36 && u < 0.8) return 0xfff3c4;
      if (v < 0.3) return u < e ? 0x7d8f55 : u < e + 0.03 ? WHITE : SEA;
      return 0x9fc7e6;
    },
    (u, v) => {                                                                                                                     // 一瓶花
      for (const [hu, hv, c] of FLW) if (Math.hypot((u - hu) * 2, v - hv) < 0.12) return c;
      if (v < 0.12) return OAKL;
      if (v < 0.44 && Math.abs(u - 0.5) < 0.07 + Math.sin((v - 0.12) * 9.8) * 0.04) return SEA;
      for (const [hu, hv] of FLW) if (v > 0.44 && v < hv && Math.abs(u - 0.5 - (hu - 0.5) * (v - 0.44) / (hv - 0.44)) < 0.02) return 0x5d8a4e;
      return 0xf3e7cf;
    },
    (u, v) => {                                                                                                                     // 海边小屋
      const dx = Math.abs(u - 0.45);
      if (v < 0.22) return 0x86b56a;
      if (v < 0.55 && dx < 0.16) return Math.abs(u - 0.4) < 0.03 && v < 0.42 ? OAKD : Math.abs(u - 0.52) < 0.035 && v > 0.32 && v < 0.45 ? 0x9fd0ea : 0xf4efe4;
      if (v < 0.78 && dx < 0.2 - (v - 0.55) * 0.85) return 0xc8574a;
      return Math.hypot((u - 0.82) * 2, v - 0.8) < 0.11 ? SUN : 0xa9d6ee;
    },
  ];
  const FR = [   // [x0, x1, y0, y1, 框色, 框宽, 衬纸]：下排 3 幅（画布 0–2）+ 上排 3 幅（3–5）
    [-31, -11, 0, 13, wood(OAK, OAKD, 0), 1, WHITE], [-10, 10, 0, 13, wood(0x6b4428, 0x4a2e1a, 0), 2, 0], [11, 31, 0, 13, 0xf1ece2, 1, 0],
    [-31, -11, 15, 28, SEA, 1, 0xf3e7cf], [-10, 10, 15, 28, BRASS, 1, 0], [11, 31, 15, 28, wood(OAKL, OAK, 0), 2, 0]];   // P5：2 米宽
  function artTex(ctx, f, tw, th) {
    const d = new Uint8Array(tw * th * 4);
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      const c = f((i + 0.5) / tw, (j + 0.5) / th), n = 0.95 + U.hash3(i, j, 7) * 0.08, k = (j * tw + i) * 4;
      d[k] = Math.min(255, ((c >> 16) & 255) * n); d[k + 1] = Math.min(255, ((c >> 8) & 255) * n); d[k + 2] = Math.min(255, (c & 255) * n); d[k + 3] = 255;
    }
    const t = new THREE.DataTexture(d, tw, th, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
    (ctx._furnTex = ctx._furnTex || []).push(t);
    return t;
  }
  function buildFrames(ctx) {
    const g = grid('frames', 'ground', 29), P = '小屋/一楼/画框/', cv = [];
    g.t(P + '框');
    for (const [x0, x1, y0, y1, fc, w, sl] of FR) {
      const s = sl ? 1 : 0, a = x0 + w, b = x1 - w, c = y0 + w, d = y1 - w;
      g.c(fc).box(x0, y0, -1, x1, y1, 0).box(x0, y0, 1, x1, y0, 1).box(x0, y1, 1, x1, y1, 1).box(x0, y0, 1, x0, y1, 1).box(x1, y0, 1, x1, y1, 1);
      if (sl) g.m('paint').c(sl).box(a, c, 0, b, d, 0);                                                          // 衬纸一圈
      g.m('erase').box(a + s, c + s, 0, b - s, d - s, 0).m('add');
      const i = cv.length, ca = a + s, cb = b - s, cc = c + s, cd = d - s;                                     // 画也画进背板（MC 模型里看得到；网页里画布平面盖在它前面）
      g.t(P + '画').m('paint').c((x, y) => ART[i]((x - ca + 0.5) / (cb - ca + 1), (y - cc + 0.5) / (cd - cc + 1))).box(ca, cc, -1, cb, cd, -1).m('add').t(P + '框');
      cv.push([ca, cb, cc, cd]);
    }
    const v = vox(ctx, g, 'frames');
    cv.forEach(([a, b, c, d], i) => {
      const cw = b - a + 1, ch = d - c + 1, m = new THREE.Mesh(new THREE.PlaneGeometry(cw * S, ch * S),
        new THREE.MeshStandardMaterial({ map: artTex(ctx, ART[i], cw * 2, ch * 2), roughness: 0.85 }));
      m.position.set(((a + b) / 2) * S, ((c + d + 1) / 2) * S, -0.5 * S + 0.003);
      m.name = 'canvas' + i; m.castShadow = false;
      Object.assign(m.userData, { canvas: i, anchor: 'furn:frames:canvas' + i, noShadow: true });
      V3.parts.tag(m, P + '画' + (i + 1), { label: '画 ' + (i + 1) });
      v.root.add(m);
    });
    return v.root;
  }
  reg({ id: 'frames', name: '画框', face: 'e', build: buildFrames, onWall: 'w', y: (it) => it.wallY });

  // ---- 相框（P5 第 5 轮，docs/PHOTOS.md，2026-11-07 web7）：单个、挂墙、1 格。和画框一个风格：深色木框（外圈往前多出一格）+ 衬纸，
  // 中间 24 × 24 格是放照片的地方（tag「照片」，空的时候是衬纸的颜色）。不在默认房子里（布局里没有），也不 reg：
  // 只给转 MC 模型的工具用（44-furn-mc 的 make: 'photoFrame' → V3.furn.makers.photoFrame）。
  // 正面朝 +z，背板 z = −1 贴墙；x −14..15、y 1..30。工具按 rot 180、贴背面换成 MC 坐标：u = (16 − x, y, 30 − z)（u = 半个 MC 像素），
  // 所以照片那块是 MC 像素 x、y 2..14，面在 z 15（FurnitureShapes 的 photoSlots）。
  const PF_WOOD = 0x6b4428, PF_WOODD = 0x4a2e1a, PF_MAT = 0xfaf6ec, PF_PAPER = 0xf1e8d6;
  function buildPhotoFrame(ctx) {
    const g = new V3.vox.Grid(32, 32, 5, { origin: [15, 0, 2] }), P = '小屋/相框/';
    g.hx = 15; g.hz = 2;
    const wx = wood(PF_WOOD, PF_WOODD, 0), wy = wood(PF_WOOD, PF_WOODD, 1);
    g.t(P + '框').c(wood(0x5a3a22, 0x3e2615, 1)).box(-14, 1, -1, 15, 30, -1);                                  // 背板（贴墙）
    g.c(wy).box(-14, 1, 0, -13, 30, 1).box(14, 1, 0, 15, 30, 1);                                                 // 木框两边：2 格宽、2 格厚
    g.c(wx).box(-12, 1, 0, 13, 2, 1).box(-12, 29, 0, 13, 30, 1);                                                 // 上下两条
    g.c(wy).box(-14, 1, 2, -14, 30, 2).box(15, 1, 2, 15, 30, 2);                                                 // 最外一圈再往前 1 格
    g.c(wx).box(-13, 1, 2, 14, 1, 2).box(-13, 30, 2, 14, 30, 2);
    g.t(P + '衬纸').c(PF_MAT).box(-12, 3, 0, 13, 3, 0).box(-12, 28, 0, 13, 28, 0).box(-12, 4, 0, -12, 27, 0).box(13, 4, 0, 13, 27, 0);   // 衬纸一圈（半个 MC 像素宽）
    g.t(P + '照片').c(PF_PAPER).box(-11, 4, 0, 12, 27, 0);                                                     // 照片那块：和衬纸同一个面
    return vox(ctx, g, 'photoFrame').root;
  }
  V3.furn.makers = Object.assign(V3.furn.makers || {}, { photoFrame: buildPhotoFrame });

  // ---- 摇椅：面朝西窗。整把椅子挂在骨骼 'rock' 上，枢轴 = 弧形底脚的圆心 [0, RR, 0]，绕 x 轴转就是在地上摇 ----
  function buildRocking(ctx) {
    const RR = 30, g = grid('rocking', 'ground', 34), P = '小屋/一楼/摇椅/';
    const run = (z) => Math.round(RR - Math.sqrt(RR * RR - z * z)), lean = (y) => (y > 12 ? (y - 12) >> 2 : 0);
    g.t(P + '椅身').b(1).c(wood(OAK, OAKD, 2));
    for (const x of [-10, 10]) for (let z = -14; z <= 13; z++) g.box(x, run(z), z, x, run(z) + 1, z);           // 弧形底脚
    g.c(wood(OAK, OAKD, 1));
    for (const x of [-10, 10]) {
      const a0 = x < 0 ? -11 : 10, a1 = a0 + 1;
      g.box(x, 3, 8, x, 21, 9).box(x, 7, -5, x, 7, 7);                                                               // 前腿 + 侧撑
      for (let y = 3; y <= 30; y++) g.box(x, y, -7 - lean(y), x, y, -6 - lean(y));                                    // 后柱往后仰
      g.c(OAKL).box(a0, 21, -8, a1, 22, 11).box(a0, 20, 10, a1, 20, 11).c(wood(OAK, OAKD, 1));                         // 扶手 + 前端小卷
    }
    for (const x of [-6, -3, 0, 3, 6]) for (let y = 11; y <= 27; y++) g.box(x, y, -7 - lean(y), x, y, -7 - lean(y));  // 靠背细柱
    g.c(OAKL);
    for (let y = 28; y <= 31; y++) g.box(y > 30 ? -5 : -10, y, -7 - lean(y), y > 30 ? 5 : 10, y, -6 - lean(y));         // 弧形顶档
    g.c(wood(OAK, OAKD, 0)).box(-9, 11, -6, 9, 12, 9).box(-9, 8, 8, 9, 8, 8);                                        // 坐板 + 前横撑
    g.t(P + '坐垫').c((x, y, z) => (y === 14 && !(x & 3) && !(z & 3) ? 0xd9c9a8 : 0xefe3c8)).rbox(-8, 13, -5, 8, 14, 8, [2, 0, 2]);
    g.t(P + '毯子').c((x, y) => (y === 18 && x & 1 ? null : y % 5 ? 0xf1e6d0 : SEA));
    for (let y = 18; y <= 30; y++) g.box(-7, y, -8 - lean(y), 7, y, -8 - lean(y));                                   // 搭在椅背后面
    g.box(-7, 31, -12, 7, 31, -9).box(-7, 25, -9, 7, 30, -9);                                                        // 盖过顶档 + 前面垂一截（P5：1 格以内）
    g.t(P + '毛线篮').b(0).c((x, y, z) => ((x + y + z) & 1 ? 0xc49a5c : 0xa77b42)).cyl(14, 2, 2.6, 0, 7, 2.6).m('erase').cyl(14, 2, 1.6, 2, 7, 1.6).m('add');
    g.c(RED).ell(13, 6, 1, 1.6, 1.6, 1.6).c(SEA).ell(15, 6, 3, 1.4, 1.4, 1.4).c(OAKL).tube([[12, 6, 4, 0.5], [16, 10, 0, 0.5]]);
    return vox(ctx, g, 'rocking', [{ name: 'root', pivot: [0, 0, 0] }, { name: 'rock', pivot: [0, RR, 0], parent: 0 }]).root;
  }
  reg({ id: 'rocking', name: '摇椅', face: 'w', build: buildRocking });
  // ---- 电视 + 电视柜：贴东墙、面朝西（沙发）。屏幕是单独平面 mesh，userData.screen = true，材质 ctx.glowMat
  //      （现在 day/night 都是 0 = 关着；要开就改 material.userData.glow 和颜色）----
  function buildTV(ctx) {
    const g = grid('tv', 'ground', 32), X = g.hx, Z = g.hz, P = '小屋/一楼/电视/', RAT = check(0xe8d4a6, 0xc9a66b, 1);
    g.t(P + '电视柜').c(wood(OAKD, 0x5e3b20, 1));
    for (const x of [-X + 2, X - 3]) for (const z of [-Z + 1, Z - 2]) g.box(x, 0, z, x + 1, 3, z + 1);           // 短腿
    g.c(wood(OAK, OAKD, 0)).box(-X + 1, 4, -Z + 1, X - 1, 12, Z - 1).c(wood(OAKL, OAK, 0)).box(-X, 13, -Z, X, 13, Z);
    for (const [a, b] of [[-X + 2, -9], [9, X - 2]]) {                                                               // 两扇藤编门
      g.c(wood(OAKL, OAK, 1)).box(a, 5, Z, b, 11, Z).m('paint').c(RAT).box(a + 1, 6, Z, b - 1, 10, Z).m('add');
      g.c(BRASS).box(a < 0 ? b - 1 : a + 1, 8, Z + 1, a < 0 ? b - 1 : a + 1, 8, Z + 1);
    }
    g.m('erase').box(-7, 5, -Z + 3, 7, 11, Z - 1).m('add').c(OAKD).box(-7, 8, -Z + 3, 7, 8, Z - 1);                // 中间开格 + 隔板
    g.m('paint').c(0x5a3a22).box(-7, 5, -Z + 2, 7, 11, -Z + 2).m('add');
    g.t(P + '小物').c((x, y, z) => ((x + y + z) & 1 ? 0xc49a5c : 0xa77b42)).box(-6, 5, -2, -1, 7, 4);              // 编织收纳篮
    g.c(WHITE).box(1, 5, -1, 6, 6, 4).c(0x7fc8f0).box(5, 6, 4, 5, 6, 4);                                             // 游戏机 + 蓝灯
    for (let x = -6, i = 0; x <= 5; x++, i++) g.c(BOOK[(i * 5) % 9]).box(x, 9, -3, x, i % 3 ? 11 : 10, 3);          // 一排唱片
    g.c(BLK).box(13, 14, 4, 16, 14, 5).c(BOOK[0]).box(15, 14, -4, 21, 14, 1).c(BOOK[3]).box(16, 15, -3, 21, 15, 0);  // 遥控器 + 两本书
    g.c(OAKD).box(-21, 14, 0, -21, 14, 0).box(-18, 14, 0, -18, 14, 0);                                               // 帆船模型
    g.c(RED).box(-22, 15, -1, -17, 15, 1).c(WHITE).box(-23, 16, -1, -16, 16, 1).c(OAKL).box(-19, 17, 0, -19, 26, 0);
    g.c(0xf4efe4).fill(-23, 18, 0, -20, 25, 0, (x, y) => -19 - x <= (26 - y) * 0.5).fill(-18, 18, 0, -16, 24, 0, (x, y) => x + 19 <= (25 - y) * 0.45);
    g.c(RED).box(-18, 26, 0, -17, 26, 0);
    g.t(P + '电视').c(BLK).box(-6, 14, -4, 6, 14, 0).box(-1, 15, -2, 1, 18, -2);                                       // 底座 + 立柱
    g.c(0x232326).box(-13, 17, -1, 13, 31, -1).c(0x2f2f33).box(-9, 19, -2, 9, 29, -2);                               // 面板 + 后背鼓包
    g.m('paint').c(0xa0a0a6).box(-1, 17, -1, 1, 17, -1).c(0xe05040).box(12, 17, -1, 12, 17, -1).m('add');            // logo + 电源灯
    const v = vox(ctx, g, 'tv'), sm = ctx.glowMat(0x15171c, { day: 0, night: 0 });
    sm.roughness = 0.25; sm.metalness = 0.3;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(25 * S, 13 * S), sm);
    scr.position.set(0, 24.5 * S, -0.5 * S + 0.002); scr.name = 'screen'; scr.castShadow = false;
    Object.assign(scr.userData, { screen: true, anchor: 'furn:tv:screen', noShadow: true });
    V3.parts.tag(scr, P + '屏幕', { label: '屏幕' });
    v.root.add(scr);
    return v.root;
  }
  reg({ id: 'tv', name: '电视', face: 'w', build: buildTV, wall: true });

  // ---- 双人小沙发：面朝东（电视）。米白布面 + 两个格子靠垫 + 搭在扶手上的针织毯 ----
  function buildSofa(ctx) {
    const g = grid('sofa', 'ground', 26), X = g.hx, Z = g.hz, P = '小屋/一楼/沙发/';
    const CR = 0xe8dcc4, CRD = 0xcfc0a2, fab = (x, y, z) => mix(CR, CRD, U.hash3(x, y, z) * 0.25);
    g.t(P + '沙发').c(wood(OAKD, 0x5e3b20, 1));
    for (const x of [-X + 2, X - 3]) for (const z of [-Z + 2, Z - 3]) g.box(x, 0, z, x + 1, 2, z + 1);             // 短腿
    g.c(fab).rbox(-X, 3, -Z, X, 9, Z, [1, 1, 1]).rbox(-X + 1, 9, -Z, X - 1, 24, -Z + 3, [2, 2, 1]);                    // 底座 + 靠背
    g.rbox(-X, 9, -Z, -X + 5, 17, Z, [1, 2, 2]).rbox(X - 5, 9, -Z, X, 17, Z, [1, 2, 2]);                              // 扶手
    for (const [a, b] of [[-X + 6, -1], [1, X - 6]]) g.rbox(a, 10, -Z + 4, b, 13, Z, [2, 1, 2]).rbox(a, 14, -Z + 4, b, 23, -Z + 7, [2, 2, 1]);
    g.m('paint').c(CRD).box(-X + 6, 13, Z, X - 6, 13, Z).m('add');                                                    // 坐垫前沿滚边
    g.t(P + '靠垫').c(check(0x5b74b0, WHITE, 2)).rbox(-X + 7, 14, -Z + 8, -X + 17, 23, -Z + 10, [2, 2, 0]);
    g.c(check(0xd9a441, WHITE, 2)).rbox(X - 17, 14, -Z + 8, X - 7, 23, -Z + 10, [2, 2, 0]);
    g.t(P + '毯子').c((x, y, z) => (z % 4 === 0 ? 0xf1e6d0 : 0x86a9cf));                                             // 搭在南边扶手上
    g.box(-X, 18, -2, -X + 5, 18, 6).box(-X, 8, -2, -X, 18, 6).box(-X + 6, 14, -2, -X + 6, 18, 6);                   // P5：外侧那片贴着扶手（不出格）
    return vox(ctx, g, 'sofa').root;
  }
  reg({ id: 'sofa', name: '沙发', face: 'e', build: buildSofa });
  // ---- 蓝色编织圆地毯（沙发和电视之间）：一圈圈辫子纹，压扁成 1.5 cm 厚 ----
  const RUG = [0xeee4cc, 0x5b7fc0, 0x3f5f9a, 0xe2d6b8, 0x7fa0d0, 0x2f4a7c];
  function buildRug(ctx) {
    const g = grid('rug', 'ground', 2), R = g.hx + 0.5;
    g.t('小屋/一楼/地毯/编织毯').c((x, y, z) => {
      const r = Math.hypot(x, z), c = r > R - 2.4 ? 0x2f4a7c : RUG[Math.floor(r / 2.4) % RUG.length];
      return (Math.floor(Math.atan2(z, x) * r / 1.5) + Math.floor(r / 1.2)) & 1 ? mix(c, 0x1e2a40, 0.2) : c;   // 辫子一明一暗
    }).fill(-g.hx, 0, -g.hz, g.hx, 0, g.hz, (x, y, z) => Math.hypot(x, z) <= R);
    const v = vox(ctx, g, 'rug');
    v.root.scale.y = 0.5;
    for (const m of v.meshes) { m.castShadow = false; m.userData.noShadow = true; }
    return v.root;
  }
  reg({ id: 'rug', name: '地毯', build: buildRug });

  // ---- 大盆栽（东南角）：陶土盆 + 琴叶榕，叶子沿黄金角螺旋往上长，新叶浅、老叶深 ----
  function buildPlantSE(ctx) {
    const g = grid('plantSE', 'ground', 32), P = '小屋/一楼/大盆栽/';   // P5：1 格高
    g.t(P + '盆').c(TERRAL).cyl(0, 0, 7.2, 0, 0, 7.2);                                                       // 托盘
    g.c((x, y, z) => (y >= 10 ? TERRA : mix(TERRA, TERRAL, U.hash3(x, y, z) * 0.5)));
    for (let y = 1; y <= 11; y++) { const r = y >= 10 ? 7 : 5.2 + y * 0.12; g.cyl(0, 0, r, y, y, r); }      // 盆身微张 + 盆沿
    g.m('erase').cyl(0, 0, 5.6, 9, 11, 5.6).m('add').c(SOIL).cyl(0, 0, 5.6, 9, 9, 5.6);
    g.c(0xd8d0c0).box(2, 10, 1, 2, 10, 1).box(-3, 10, -2, -3, 10, -2);                                      // 小石子
    g.t(P + '叶子').c(0x6b4a2e).tube([[0, 9, 0, 1], [0.6, 19, 0.3, 0.75], [-0.3, 27, 0, 0.55]]);             // 树干
    for (let i = 0; i < 19; i++) {
      const a = i * 2.4, el = 0.3 + i * 0.028, L = 7.5 - i * 0.17, W = 3.6 - i * 0.05, rl = (U.hash3(i, 3, 9) - 0.5) * 0.7;
      const ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(el), se = Math.sin(el), cr = Math.cos(rl), sr = Math.sin(rl);
      const B = [ca * 1.2, 12 + i * 0.85, sa * 1.2], D = [ca * ce, se, sa * ce], S0 = [-sa, 0, ca], N0 = [se * ca, -ce, se * sa];
      const Sv = S0.map((s, k) => s * cr + N0[k] * sr), Nv = N0.map((n, k) => n * cr - S0[k] * sr);
      const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      const loc = (x, y, z) => { const p = [x - B[0], y - B[1], z - B[2]]; return [dot(p, D), dot(p, Sv), dot(p, Nv)]; };
      g.c((x, y, z) => (Math.abs(loc(x, y, z)[1]) < 0.55 ? 0x9ccc7a : mix(0x3c7a3c, 0x62a453, U.hash3(x, y, z) * 0.5 + i / 40)));
      const R = Math.ceil(L + W + 2);
      g.fill(Math.floor(B[0]) - R, Math.floor(B[1] - W - 3), Math.floor(B[2]) - R, Math.ceil(B[0]) + R, Math.ceil(B[1] + L + 2), Math.ceil(B[2]) + R, (x, y, z) => {
        const [t, w, h] = loc(x, y, z), u = t / L;                                                            // 沿叶 / 横向 / 厚度
        return u >= 0 && u <= 1 && Math.abs(w) <= W * Math.pow(Math.sin(Math.PI * u), 0.7) * (0.55 + 0.45 * u) && Math.abs(h - 1.2 * u * u) <= 0.6;
      });
    }
    return vox(ctx, g, 'plantSE').root;
  }
  reg({ id: 'plantSE', name: '大盆栽', build: buildPlantSE });
  // ---- 门口地垫：椰棕色 + 深色包边 + 两道蓝色海浪，压扁成 1.9 cm ----
  function buildMat(ctx) {
    const g = grid('mat', 'ground', 2), X = g.hx, Z = g.hz;
    g.t('小屋/一楼/门口地垫/垫子').c((x, y, z) => {
      if (Math.abs(x) > X - 2 || Math.abs(z) > Z - 2) return 0x5a3a22;
      const w = Math.round(1.6 * Math.sin(x * 0.42));
      if (Math.abs(z - 2.5 - w) < 0.6 || Math.abs(z + 2.5 - w) < 0.6) return 0x34497a;
      return mix(0xc49a5c, 0xa77b42, U.hash3(x, 0, z) * 0.6);
    }).box(-X, 0, -Z, X, 0, Z);
    const v = vox(ctx, g, 'mat');
    v.root.scale.y = 0.6;
    for (const m of v.meshes) { m.castShadow = false; m.userData.noShadow = true; }
    return v.root;
  }
  reg({ id: 'mat', name: '门口地垫', build: buildMat });

  // ---- 吊灯：铁艺灯笼，从一楼天花（阁楼楼板底面 loftY − 0.25）往下挂 18 格；玻璃是骨骼 'glass'（glowMat），里面 1 个 ctx.lamp ----
  function buildPendant(ctx) {
    const g = grid('pendant', 'ground', 1, 20), P = '小屋/一楼/吊灯/', IRON = (x, y, z) => mix(BLK, 0x4a4a50, U.hash3(x, y, z) * 0.5);
    g.t(P + '铁架').c(IRON).cyl(0, 0, 3, -1, -1, 3).box(0, -4, 0, 0, -2, 0);                                   // 吊盘 + 吊链
    g.box(-1, -5, -1, 1, -5, 1).box(-3, -6, -3, 3, -6, 3).box(-5, -7, -5, 5, -7, 5);                          // 灯帽
    g.box(-4, -8, -4, 4, -8, 4).box(-4, -16, -4, 4, -16, 4).box(-2, -17, -2, 2, -17, 2).box(0, -18, 0, 0, -18, 0);
    for (const x of [-4, 4]) for (const z of [-4, 4]) g.box(x, -15, z, x, -9, z);                             // 四根角柱
    g.t(P + '玻璃').b(1).c(0xffc76b);
    for (const s of [-4, 4]) g.box(-3, -15, s, 3, -9, s).box(s, -15, -3, s, -9, 3);
    g.b(0).t(P + '铁架').c(IRON);
    for (const s of [-4, 4]) g.box(0, -15, s, 0, -9, s).box(s, -15, 0, s, -9, 0).box(-3, -12, s, 3, -12, s).box(s, -12, -3, s, -12, 3);   // 窗格铁条
    const v = vox(ctx, g, 'pendant', [{ name: 'root', pivot: [0, 0, 0] }, { name: 'glass', pivot: [0, 0, 0], parent: 0 }]);
    glowUp(v, { glass: ctx.glowMat(0xffc76b, { day: 0.35, night: 1.6 }) });
    for (const m of v.meshes) m.userData.ceilingFixture = 'ground';
    ctx.lamp({ pos: [0, -12 * S, 0], color: 0xffc27a, intensity: 1.0, distance: 8, parent: v.root, keepWhenCut: true });
    return v.root;
  }
  reg({ id: 'pendant', name: '吊灯', build: buildPendant, y: () => V3.layout.house.loftY - 0.25 });
  // ---- 小茶几（地毯中间，沙发和电视之间）：矮木桌 + 下层条板；桌上一杯热可可、一盘小饼干、一本杂志 ----
  function buildCoffee(ctx) {
    const g = grid('coffee', 'ground', 20), X = g.hx, Z = g.hz, P = '小屋/一楼/小茶几/';
    g.t(P + '茶几').c(wood(OAK, OAKD, 1));
    for (const x of [-X + 1, X - 2]) for (const z of [-Z + 1, Z - 2]) g.box(x, 0, z, x + 1, 11, z + 1);            // 四条腿
    g.c(wood(OAKD, 0x5e3b20, 0)).box(-X + 3, 9, -Z + 1, X - 3, 10, -Z + 1).box(-X + 3, 9, Z - 1, X - 3, 10, Z - 1)
      .box(-X + 1, 9, -Z + 3, -X + 1, 10, Z - 3).box(X - 1, 9, -Z + 3, X - 1, 10, Z - 3);                           // 牙板
    g.c(wood(OAK, OAKD, 0));
    for (let z = -Z + 1; z <= Z - 1; z += 2) g.box(-X + 1, 3, z, X - 1, 3, z);                                     // 下层条板
    g.c(wood(OAKL, OAK, 0)).rbox(-X, 12, -Z, X, 13, Z, [1, 0, 1]);                                                  // 桌面
    g.c(BOOK[1]).box(-8, 4, -5, 2, 4, 4).c(BOOK[3]).box(-7, 5, -4, 1, 5, 3);                                        // 下层两本书
    g.t(P + '点心').c(0xe8835f).cyl(-6, 4, 1.6, 14, 17, 1.6).box(-4, 15, 4, -3, 15, 4).box(-3, 16, 4, -3, 16, 4).box(-4, 17, 4, -3, 17, 4);
    g.m('paint').c(0x5a3420).box(-6, 17, 4, -6, 17, 4).m('add').c(WHITE).box(-6, 18, 4, -6, 18, 4);                  // 热可可 + 奶油
    g.c((x, y, z) => (Math.hypot(x - 1, z + 4) > 3.6 ? 0x6f8fc8 : WHITE)).cyl(1, -4, 4.5, 14, 14, 4.5);           // 蓝边小盘
    g.c((x, y, z) => (U.hash3(x, y, z) > 0.72 ? 0x4a2e1a : 0xd9a45a));
    for (const [cx, cz, y] of [[0, -5, 15], [3, -3, 15], [-1, -2, 15], [1.5, -4, 16]]) g.cyl(cx, cz, 1.6, y, y, 1.6);  // 小饼干
    g.t(P + '杂志').c((x, y, z) => (z < 2 ? (x & 1 && z === 1 ? WHITE : RED) : z < 6 ? 0x9fd0ea : x > 8 ? SUN : SAND)).box(4, 14, 0, 11, 14, 8);
    return vox(ctx, g, 'coffee').root;
  }
  reg({ id: 'coffee', name: '小茶几', build: buildCoffee });
  // @@NEXT@@
})(window.V3);
