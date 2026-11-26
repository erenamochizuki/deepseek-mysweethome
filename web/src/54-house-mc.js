// 54-house-mc.js — 场景部件 'house'（order 40）：小鲸鱼之家 v4 的方块房子（MC 原版方块，1 格 = 1 米；docs/HOUSE-V4.md）。
// 方块数据：鲸图 assets/<V3.layout.house.asset>（build.mjs 内嵌）。以后在 MC 里改了房子、/xjy capture 抓回来，换掉这张图就行。
//   页面里没有这张图时用 V3.houseMc.build()（工作台带着 42-house-mc）。
// 画法：16-mcmesh 按 MC 的方块模型出网格（玩家选过 jar → 他自己的 MC 贴图；没选 → 17-mcfallback 我们定的颜色），
//   不乘 MC 的朝向明暗（cardinal: false），换成场景材质（贴图 × AO），和别的东西一样受太阳、阴影、灯光照。
// 楼层（50-scene 的 floor：外观 / 一楼 / 阁楼）：去掉上面几层，朝着镜头的外墙压到 1 格高（按需重新出网格，缓存几份）。
// 门：她走到门前 1.5 米内就开，走开就关（门单独出网格，开 / 关两份）。灯笼：单独出网格、自发光；门廊 4 盏合成 2 盏点光，一楼 1 盏。
// V3.houseBlocks：给 61-nav 按方块算能走的地方（solids），ready 是 Promise（读好方块数据就 resolve）。
// 导入 MC 抓回来的房子（docs/HOUSE-V4.md 第 17 节）：设置「房子」页「导入鲸图」或者把鲸图拖进页面 → HB.importFile；检查规则 HB.check；
//   存在这台电脑的浏览器里（IndexedDB 'v3-house'），下次打开还在；「恢复原来的房子」→ HB.restore。换房子时整个场景重建（HB.rebuildScene）。
//   家具方块在哪：HB.furnInstances / HB.furnPlaced（55 / 56 / 57 的灯、屏幕、风铃、遮阳伞、贝壳柜格子都跟着方块摆）。
(function (V3) {
  'use strict';
  if (!V3.scene || !V3.scene.part) return;
  const U = V3.util;
  const ROOT = '小屋';
  const HB = V3.houseBlocks = { ready: null, error: null, from: null, version: 0, grid: null, info: null, custom: null, defaultModel: null, importError: null };
  // 只在本次网页运行中保存偏好，绝不改鲸图的 palette / cells / 方块实体。
  const SWITCHES = new Map();
  const switchKey = (kind, cell, block) => {
    const p = HB.place, q = [cell[0] + 0.5, cell[1], cell[2] + 0.5];
    const local = p && HB.unplacePoint ? HB.unplacePoint(q, p) : q;
    return kind + ':' + [Math.floor(local[0]), Math.round(local[1]), Math.floor(local[2])].join(',') + ':' + block;
  };
  const switchPref = (key, kind) => {
    // 门只有开 / 关两种（2026-11-17）：默认关着；关着的门小鲸鱼走近时自己打开、走开再关上（以前的「自动」就是这样）。
    if (!SWITCHES.has(key)) SWITCHES.set(key, kind === 'door' ? { mode: 'closed' } : { on: true });
    return SWITCHES.get(key);
  };

  // ---- 站立点：鲸图格子 (0,0,0) 的场景位置 = 站立点 + Offset（FORMAT.md §3.2）----
  // 站立点 = 场景里台阶前那一格（V3.layout.house.stand，和 42-house-mc 的 ORIGIN 一样）。Metadata 里的 Origin 是抓的时候 MC 世界里的坐标，
  // 只做记录：/xjy capture 抓回来的 Origin 是玩家自己世界里的坐标，网页不按它放
  HB.stand = () => ((V3.layout.house && V3.layout.house.stand) || (V3.houseMc && V3.houseMc.ORIGIN) || [-2, 0, -2]).slice();
  HB.originOf = (model) => {
    const s = HB.stand(), o = model && model.offset ? Array.from(model.offset, (n) => n | 0) : [0, 0, 0];
    return [s[0] + o[0], s[1] + o[1], s[2] + o[2]];
  };

  // ---- 读方块数据：先看浏览器里有没有导入的房子，没有就用内嵌的鲸图（页面里没有时用 42 的生成器）----
  const b64bytes = (s) => { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  async function loadDefault(L) {
    const name = L.house && L.house.asset, b64 = name && (window.__V3_ASSETS || {})[name];
    if (b64 && V3.share && V3.share.read) return { model: await V3.share.read(b64bytes(b64)), from: 'assets/' + name };
    if (V3.houseMc && V3.houseMc.build) return { model: V3.houseMc.build().model, from: '42-house-mc' };
    throw new Error('没有房子的方块数据：页面里没有 assets/' + name + '，也没有 42-house-mc');
  }
  const errText = (e) => String((e && e.message) || e);
  function dependencies(model, instanceModIds) {
    if (V3.houseMods) return V3.houseMods.getModDependencies(model, instanceModIds);
    // Standalone tool harnesses that load only the house module still fail closed.
    const required = V3.share?.requiredMods?.(model.palette) || [];
    const installed = new Set(instanceModIds || []);
    return { required, missing: required.filter(id => id !== 'xiaojingyu' && !installed.has(id)) };
  }
  HB.withDependencyMetadata = (model, required = dependencies(model).required) =>
    !model.meta && required.length ? { ...model, meta: { compound: {} } } : model;
  HB.validateDependencies = async (model) => {
    const builtin = dependencies(model);
    if (!builtin.missing.length || !V3.mcInstance) return builtin;
    const associated = await V3.mcInstance.current().catch(() => null);
    return dependencies(model, associated?.modIds);
  };
  HB.load = () => HB.ready || (HB.ready = (async () => {
    const def = await loadDefault(V3.layout);
    HB.defaultModel = def.model; HB.defaultFrom = def.from;
    let use = def, custom = null, rec = null, place = null;
    try { rec = await HB.store.get(); } catch (e) { rec = null; }             // 存储打不开：当没有导入过
    if (rec && rec.bytes) {
      const arranged = rec.kind === 'arranged';
      try {
        const model = await V3.share.read(rec.bytes), c = HB.check(model, await HB.validateDependencies(model));
        if (c.reject) throw new Error(c.reject);
        use = { model, from: arranged ? 'arranged' : 'import' }; custom = customOf(rec, model);
        if (arranged && rec.place && HB.placeOk) place = HB.placeOk(rec.place);
      } catch (e) {
        HB.importError = '上次' + (arranged ? '布置过' : '导入') + '的房子读不出来了（' + errText(e) + '），先用原来的房子。可以重新导入，或者点「恢复原来的房子」把它删掉。';
      }
    }
    setLocal(use.model, place, use.from, custom);
    return HB.info;
  })());
  // ---- 房子摆在沙滩哪儿、朝哪（布置模式「挪房子」）：HB.place = { dx, dz, k }（格；k = 顺时针转几个 90°）。
  // HB.model 是摆好以后场景里的模型（画、走路、跟着方块的东西都读它）；HB.localModel() 是房子自己方向的（存、导出都用它），
  // 没挪过时就是 HB.model。转、挪的算法在下面「挪房子」一节（HB.placeModel）
  HB.place = { dx: 0, dz: 0, k: 0 };
  HB.isIdentity = (p) => !p || (!p.dx && !p.dz && !((p.k | 0) % 4));
  function setLocal(local, place, from, custom) {
    SWITCHES.clear();
    const p = place && !HB.isIdentity(place) ? { dx: place.dx | 0, dz: place.dz | 0, k: (((place.k | 0) % 4) + 4) % 4 } : { dx: 0, dz: 0, k: 0 };
    HB.place = p;
    if (HB.applyLayoutPlace) HB.applyLayoutPlace(p);
    setModel(HB.isIdentity(p) || !HB.placeModel ? local : HB.placeModel(local, p), from, custom);
  }
  // 房子自己方向的模型（Facing 北、Offset 和原来一样）：没挪过 = HB.model；挪过、转过 = 转回去
  HB.localModel = () => (HB.isIdentity(HB.place) || !HB.unplaceModel ? HB.model : HB.unplaceModel(HB.model, HB.place));
  HB.isCustom = () => HB.from === 'import' || HB.from === 'arranged';
  function setModel(model, from, custom) {
    HB.model = model; HB.from = from; HB.custom = custom || null; HB.grid = makeGrid(model); HB.version++; FI = null;
    HB.info = { size: model.size.slice(), origin: HB.grid.org.slice(), blocks: Array.from(model.cells).filter((c) => HB.grid.st[c]).length, palette: model.palette.length, from };
    if (V3.nav && V3.nav.rebuild) V3.nav.rebuild();
    if (V3.emit) V3.emit('house:blocks', HB.info);
  }
  // 格子：世界方块坐标查方块（{ns, id, name, props}，空气 = null）
  function makeGrid(model) {
    const M = V3.mcmodel, [W, Hh, Lz] = model.size, org = HB.originOf(model);
    const st = model.palette.map((s) => { const p = M.parseState(s); return M.isAir(p) ? null : p; });
    const cells = model.cells, idx = (x, y, z) => x + z * W + y * W * Lz;
    const at = (wx, wy, wz) => {
      const x = wx - org[0], y = wy - org[1], z = wz - org[2];
      return (x < 0 || y < 0 || z < 0 || x >= W || y >= Hh || z >= Lz) ? null : st[cells[idx(x, y, z)]];
    };
    return { W, H: Hh, L: Lz, org, st, cells, idx, at,
      bounds: { x0: org[0], x1: org[0] + W, y0: org[1], y1: org[1] + Hh, z0: org[2], z1: org[2] + Lz } };
  }

  // ---- 挪房子（布置模式第二步，docs/HOUSE-V4.md 18.4）----
  // 摆法 p = { dx, dz, k }：先绕房子外墙的中心（布局 house 矩形的中心取整，默认 (0, −11)）从上往下看顺时针转 k 个 90°（和 MC 的 Rotation 一样），
  // 再挪 (dx, dz) 格。转的中心是整数，格子转过去还是落在整格上。
  // 跟着房子的：整张鲸图（HB.model = HB.placeModel(房子自己方向的模型, p)，方块状态的 facing、axis、四边连接、rotation 跟着转）、
  //   布局里和房子绑着的点和区域（HB.placedLayout()：外墙矩形、门内外落脚点、门廊、台阶、门窗、贴墙的藤蔓）。
  // V3.layout 本身不改：家具的体素版先照它摆在默认房子里，再按方块（已经转好、挪好）搬过去（V3.furnMc.mover），所以 overlay 自己就跟着走了。
  const pivot = () => { const H = V3.layout.house; return [Math.round((H.x0 + H.x1) / 2), Math.round((H.z0 + H.z1) / 2)]; };
  const rot2 = (x, z, k) => { for (let i = ((k % 4) + 4) % 4; i > 0; i--) [x, z] = [-z, x]; return [x + 0, z + 0]; };
  // 场景里的一点（米）：房子自己方向（默认摆法）→ 摆好以后；和反过来
  HB.placePoint = (p, pl) => { const c = pivot(), [x, z] = rot2(p[0] - c[0], p[2] - c[1], pl.k | 0); return [x + c[0] + (pl.dx | 0), p[1], z + c[1] + (pl.dz | 0)]; };
  HB.unplacePoint = (p, pl) => { const c = pivot(), [x, z] = rot2(p[0] - c[0] - (pl.dx | 0), p[2] - c[1] - (pl.dz | 0), -(pl.k | 0)); return [x + c[0], p[1], z + c[1]]; };
  HB.placeYaw = (a, pl) => a - (pl.k | 0) * Math.PI / 2;                 // three.js rotation.y：顺时针一步 = 减 90°
  HB.pivot = pivot;
  HB.placeOk = (p) => (p && Number.isFinite(+p.dx) && Number.isFinite(+p.dz) ? { dx: Math.round(+p.dx), dz: Math.round(+p.dz), k: (((Math.round(+p.k) || 0) % 4) + 4) % 4 } : null);
  // 方块状态顺时针转 k 步（同 MC 的 BlockState.rotate）：facing、axis、rotation（告示牌这类 0..15）、四边连接（栅栏、玻璃板、墙、藤蔓）。
  // 楼梯的 shape、门的 hinge、床和箱子的左右都是相对 facing 的，不用改。属性的顺序不变
  const FROT = ['north', 'east', 'south', 'west'];
  HB.rotateState = (s, k) => {
    k = ((k % 4) + 4) % 4;
    const b = s.indexOf('[');
    if (!k || b < 0) return s;
    const e = s.lastIndexOf(']'), props = s.slice(b + 1, e > b ? e : s.length).split(',').map((kv) => { const q = kv.indexOf('='); return [kv.slice(0, q), kv.slice(q + 1)]; });
    const val = Object.fromEntries(props);
    const out = props.map(([pk, v]) => {
      if (pk === 'facing') { const i = FROT.indexOf(v); return [pk, i < 0 ? v : FROT[(i + k) % 4]]; }
      if (pk === 'axis' && k % 2) return [pk, v === 'x' ? 'z' : v === 'z' ? 'x' : v];
      if (pk === 'rotation' && /^\d+$/.test(v)) return [pk, String((+v + 4 * k) % 16)];
      const i = FROT.indexOf(pk);
      if (i >= 0) { const from = FROT[(i - k + 4) % 4]; return [pk, val[from] != null ? val[from] : v]; }   // 新的东边 = 原来的北边……
      return [pk, v];
    });
    return s.slice(0, b) + '[' + out.map(([a, v]) => a + '=' + v).join(',') + ']' + (e > b ? s.slice(e + 1) : '');
  };
  // 整张模型按场景里的点变换 f 搬过去（转 k 步），格子、调色板（方块状态跟着转）、方块实体、Offset（相对站立点）都重算
  function mapModel(m, f, k) {
    const [W, Hh, Lz] = m.size, org = HB.originOf(m), odd = ((k % 4) + 4) % 2 === 1, size = odd ? [Lz, Hh, W] : [W, Hh, Lz];
    const cellTo = (x, y, z) => { const q = f([x + 0.5, y, z + 0.5]); return [Math.round(q[0] - 0.5), y, Math.round(q[2] - 0.5)]; };
    const cs = [[0, 0], [W - 1, 0], [0, Lz - 1], [W - 1, Lz - 1]].map(([x, z]) => cellTo(org[0] + x, org[1], org[2] + z));
    const mn = [Math.min(...cs.map((c) => c[0])), org[1], Math.min(...cs.map((c) => c[2]))];
    const palette = m.palette.map((s) => HB.rotateState(s, k)), cells = new Int32Array(m.cells.length);
    for (let y = 0; y < Hh; y++) for (let z = 0; z < Lz; z++) for (let x = 0; x < W; x++) {
      const c = cellTo(org[0] + x, org[1] + y, org[2] + z);
      cells[(c[0] - mn[0]) + (c[2] - mn[2]) * size[0] + y * size[0] * size[2]] = m.cells[x + z * W + y * W * Lz];
    }
    const be = (m.blockEntities || []).map((q) => { const c = cellTo(org[0] + q.pos[0], org[1] + q.pos[1], org[2] + q.pos[2]); return Object.assign({}, q, { pos: [c[0] - mn[0], q.pos[1], c[2] - mn[2]] }); });
    const st = HB.stand();
    return Object.assign({}, m, { size, offset: [mn[0] - st[0], mn[1] - st[1], mn[2] - st[2]], palette, cells, blockEntities: be });
  }
  HB.placeModel = (local, pl) => mapModel(local, (q) => HB.placePoint(q, pl), pl.k | 0);
  HB.unplaceModel = (world, pl) => mapModel(world, (q) => HB.unplacePoint(q, pl), -(pl.k | 0));
  // 布局里跟着房子的点和区域（摆好以后的场景坐标）。没挪过 = V3.layout 本身
  let PL = null;
  HB.applyLayoutPlace = (p) => { PL = HB.isIdentity(p) ? null : placeLayout(V3.layout, p); };
  HB.placedLayout = () => PL || V3.layout;
  function placeLayout(L, p) {
    const P2 = (x, z) => { const q = HB.placePoint([x, 0, z], p); return [q[0], q[2]]; };
    const rect = (r) => { if (!r) return r; const a = P2(r.x0, r.z0), b = P2(r.x1, r.z1); return Object.assign({}, r, { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) }); };
    const SIDE = ['n', 'e', 's', 'w'], k = ((p.k | 0) % 4 + 4) % 4, H0 = L.house;
    // 贴墙的（门窗、藤蔓）：wall + 沿墙的两个坐标 → 转到哪面墙、沿墙的坐标
    const onWall = (o, ka, kb) => {
      const pt = (a) => (o.wall === 's' ? [a, H0.z1] : o.wall === 'n' ? [a, H0.z0] : o.wall === 'e' ? [H0.x1, a] : [H0.x0, a]);
      const A = P2(...pt(o[ka])), B = P2(...pt(o[kb])), w = SIDE[(SIDE.indexOf(o.wall) + k) % 4], along = (q) => (w === 's' || w === 'n' ? q[0] : q[1]);
      return Object.assign({}, o, { wall: w, [ka]: Math.min(along(A), along(B)), [kb]: Math.max(along(A), along(B)) });
    };
    const H = rect(H0);
    if (H0.doorIn) H.doorIn = P2(H0.doorIn[0], H0.doorIn[1]);
    if (H0.doorOut) H.doorOut = P2(H0.doorOut[0], H0.doorOut[1]);
    if (k % 2 && H0.ridgeAxis) H.ridgeAxis = H0.ridgeAxis === 'x' ? 'z' : 'x';
    if (H0.crossGable) H.crossGable = Object.assign({}, H0.crossGable, { placed: true });   // 54-wx 按房子自己的方向算（先把点转回去）
    const porch = rect(L.porch);
    if (porch && L.porch.steps) porch.steps = rect(L.porch.steps);
    const openings = (L.openings || []).map((o) => (o.wall ? onWall(o, 'a0', 'a1') : o));
    const plants = (L.plants || []).map((q) => (q.wall ? Object.assign(onWall(q, 'a', 'b'), { onPorch: q.wall === 's' }) : q));
    return Object.assign({}, L, { house: H, porch, openings, plants, place: Object.assign({}, p) });
  }

  // ---- 碰撞盒（方块内坐标 0..1，[x0,y0,z0,x1,y1,z1]）：给走路用，够用就行 ----
  // 栅栏、墙、玻璃板按整格挡（不让她从栏杆缝里钻）；门：关着整格挡，开着不挡；没有碰撞的方块返回 []。
  const NOCOL = /(^|_)(air|button|torch|sapling|sign|banner|pressure_plate|rail|vine|lichen|flower|tulip|orchid|daisy|bluet|allium|poppy|dandelion|roots|sprouts)$|^(water|lava|light|structure_void|short_grass|tall_grass|fern|large_fern|dead_bush|redstone_wire|tripwire|string|cobweb)$/;
  const Q = { north: [0, 0, 0, 1, 1, 0.5], south: [0, 0, 0.5, 1, 1, 1], west: [0, 0, 0, 0.5, 1, 1], east: [0.5, 0, 0, 1, 1, 1] };
  const LEFT = { north: 'west', west: 'south', south: 'east', east: 'north' }, RIGHT = { north: 'east', east: 'south', south: 'west', west: 'north' };
  const inter = (a, b) => [Math.max(a[0], b[0]), 0, Math.max(a[2], b[2]), Math.min(a[3], b[3]), 1, Math.min(a[5], b[5])];
  function stairBoxes(p) {
    const top = p.half === 'top', f = p.facing || 'north', sh = p.shape || 'straight';
    const base = top ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1], y0 = top ? 0 : 0.5, y1 = top ? 0.5 : 1;
    let qs;
    if (sh === 'straight') qs = [Q[f]];
    else if (sh === 'outer_left') qs = [inter(Q[f], Q[LEFT[f]])];
    else if (sh === 'outer_right') qs = [inter(Q[f], Q[RIGHT[f]])];
    else if (sh === 'inner_left') qs = [Q[f], inter(Q[OPP(f)], Q[LEFT[f]])];
    else qs = [Q[f], inter(Q[OPP(f)], Q[RIGHT[f]])];
    return [base, ...qs.map((q) => [q[0], y0, q[2], q[3], y1, q[5]])];
  }
  function OPP(f) { return { north: 'south', south: 'north', east: 'west', west: 'east' }[f]; }
  HB.boxes = function (s, opt) {
    if (!s) return [];
    const id = s.id, p = s.props || {};
    if (NOCOL.test(id)) return [];
    if (/_carpet$/.test(id)) return [[0, 0, 0, 1, 1 / 16, 1]];
    if (/_slab$/.test(id)) return p.type === 'top' ? [[0, 0.5, 0, 1, 1, 1]] : p.type === 'double' ? [[0, 0, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
    if (/_stairs$/.test(id)) return stairBoxes(p);
    if (/_door$/.test(id)) return opt && opt.doorOpen ? [] : [[0, 0, 0, 1, 1, 1]];
    if (/(_fence|_wall|_fence_gate)$/.test(id)) return [[0, 0, 0, 1, 1.5, 1]];
    if (/(_pane|^iron_bars|_bars)$/.test(id)) return [[0, 0, 0, 1, 1, 1]];
    if (/lantern$/.test(id)) return p.hanging === 'true' ? [[0.3125, 0.0625, 0.3125, 0.6875, 1, 0.6875]] : [[0.3125, 0, 0.3125, 0.6875, 0.5625, 0.6875]];
    if (/chain$/.test(id)) return [[0.4, 0, 0.4, 0.6, 1, 0.6]];
    return [[0, 0, 0, 1, 1, 1]];
  };
  // 一点 (x, z)（世界米）正上方所有实心的高度段 [[y0, y1]…]（从下往上，相接的并起来）；不在房子范围里 → []
  // 模组的家具方块（P5）不算在这里：它们只挡路、不能站上去，走路网格另外用 HB.furnSolids 拿
  const isMod = (s) => !!(s && s.ns && s.ns !== 'minecraft');
  HB.solids = function (x, z, opt) {
    const G = HB.grid; if (!G) return [];
    const bx = Math.floor(x), bz = Math.floor(z), fx = x - bx, fz = z - bz, out = [];
    if (bx < G.bounds.x0 || bx >= G.bounds.x1 || bz < G.bounds.z0 || bz >= G.bounds.z1) return out;
    for (let by = G.bounds.y0; by < G.bounds.y1; by++) {
      const s = G.at(bx, by, bz);
      if (isMod(s)) continue;
      for (const b of HB.boxes(s, opt)) {
        if (fx < b[0] || fx >= b[3] || fz < b[2] || fz >= b[5]) continue;
        out.push([by + b[1], by + b[4]]);
      }
    }
    out.sort((a, b) => a[0] - b[0]);
    const m = [];
    for (const s of out) { const t = m[m.length - 1]; if (t && s[0] <= t[1] + 1e-6) t[1] = Math.max(t[1], s[1]); else m.push(s.slice()); }
    return m;
  };

  // 家具方块的名字：44-furn-mc 的规格里有就用它的，没有就用方块 id
  const furnLabel = (s) => { const f = V3.furnMc && V3.furnMc.byBlock && V3.furnMc.byBlock(s.ns + ':' + s.id); return (f && f.label) || s.id; };
  const CLICK = { 'xiaojingyu:shell_case': 'shellBox', 'xiaojingyu:photo_album_table': 'album', 'xiaojingyu:bookshelf': 'diaryShelf' };
  // 家具方块这一格的碰撞（FURNITURE.md 8.1）：box / thin（贴地，人能走上去）/ none（挂墙、吊顶）。规格里 collide 可以是一个字符串，
  // 也可以按 part 给（数组或 {part: …}）；没有规格的按 box
  HB.collideOf = function (s) {
    const f = V3.furnMc && V3.furnMc.byBlock && V3.furnMc.byBlock(s.ns + ':' + s.id), c = f && f.collide, part = (s.props || {}).part;
    if (!c) return 'box';
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c[+part || 0] || 'box';
    return c[part] || c.default || 'box';
  };
  // 家具方块占的高度段（box 的整格算，只用来挡路；thin、none 的不挡）
  HB.furnSolids = function (x, z) {
    const G = HB.grid; if (!G) return [];
    const bx = Math.floor(x), bz = Math.floor(z), out = [];
    if (bx < G.bounds.x0 || bx >= G.bounds.x1 || bz < G.bounds.z0 || bz >= G.bounds.z1) return out;
    for (let by = G.bounds.y0; by < G.bounds.y1; by++) { const s = G.at(bx, by, bz); if (isMod(s) && HB.collideOf(s) === 'box') out.push([by, by + 1]); }
    return out;
  };
  // ---- 部件：按位置和方块分类（编辑过的房子也能分）----
  const LABELS = {
    [ROOT + '/外墙']: '外墙（平滑石英）', [ROOT + '/外墙/木柱和木梁']: '木柱、地梁、腰梁', [ROOT + '/门窗/门']: '前门', [ROOT + '/门窗/窗']: '窗（玻璃板）',
    [ROOT + '/一楼/地板']: '一楼地板', [ROOT + '/一楼/楼梯']: '楼梯', [ROOT + '/一楼/灯梁']: '灯梁', [ROOT + '/阁楼/地板']: '阁楼地板',
    [ROOT + '/阁楼/楼梯口栏杆']: '楼梯口栏杆', [ROOT + '/阁楼/矮墙']: '阁楼矮墙', [ROOT + '/阁楼/山墙']: '山墙', [ROOT + '/屋顶']: '屋顶',
    [ROOT + '/门廊/地板']: '门廊地板', [ROOT + '/门廊/栏杆']: '门廊栏杆', [ROOT + '/门廊/台阶']: '台阶', [ROOT + '/灯笼']: '灯笼（方块）', [ROOT + '/其他']: '其他方块',
  };
  function partOf(L, s, wx, wy, wz) {
    const H = L.house, id = s.id, inX = wx >= H.x0 && wx < H.x1, inZ = wz >= H.z0 && wz < H.z1;
    const ring = inX && inZ && (wx === H.x0 || wx === H.x1 - 1 || wz === H.z0 || wz === H.z1 - 1);
    const inside = inX && inZ && !ring, gTop = H.loftY - 2;   // 一楼墙顶那层（格子 y）
    if (s.ns && s.ns !== 'minecraft') return ROOT + '/家具/' + furnLabel(s);   // 模组的家具方块（P5）
    if (/lantern$/.test(id)) return ROOT + '/灯笼';
    if (/_door$/.test(id)) return ROOT + '/门窗/门';
    if (/(_pane|glass)$/.test(id)) return ROOT + '/门窗/窗';
    if (/(_stairs|_slab)$/.test(id) && wy >= H.eaveY - 1 && !(inside && wy <= H.loftY)) return ROOT + '/屋顶';
    if (ring) {
      if (/_log$|_wood$/.test(id) && wy < H.loftY) return ROOT + '/外墙/木柱和木梁';
      if (wy < H.loftY - 1) return ROOT + '/外墙';
      if (wy >= H.loftY) return ROOT + (wz === H.z0 || wz === H.z1 - 1 ? '/阁楼/矮墙' : '/阁楼/山墙');
      return ROOT + '/外墙/木柱和木梁';
    }
    if (inside) {
      if (wy === 0) return ROOT + '/一楼/地板';
      if (/_fence$/.test(id)) return ROOT + '/阁楼/楼梯口栏杆';
      if (wy === gTop + 1) return /_log$/.test(id) ? ROOT + '/一楼/灯梁' : ROOT + '/阁楼/地板';
      if (wy <= gTop + 1) return ROOT + '/一楼/楼梯';
      return ROOT + '/其他';
    }
    if (wy === 0 && /_stairs$/.test(id)) return ROOT + '/门廊/台阶';
    if (/_fence$/.test(id)) return ROOT + '/门廊/栏杆';
    if (wy === 0) return ROOT + '/门廊/地板';
    return ROOT + '/其他';
  }

  // ---- 出网格 ----
  const LAYERS = ['solid', 'cutout', 'entity', 'translucent'];
  // 一个面属于哪一格：面中心往面里退一点（同 43-house-mc-model）
  function cellOfQuad(P, q) {
    const o = q * 12;
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < 4; v++) { cx += P[o + v * 3]; cy += P[o + v * 3 + 1]; cz += P[o + v * 3 + 2]; }
    const ax = P[o + 3] - P[o], ay = P[o + 4] - P[o + 1], az = P[o + 5] - P[o + 2];
    const bx = P[o + 6] - P[o], by = P[o + 7] - P[o + 1], bz = P[o + 8] - P[o + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, k = 0.01 / (Math.hypot(nx, ny, nz) || Infinity);
    return [Math.floor(cx / 4 - nx * k), Math.floor(cy / 4 - ny * k), Math.floor(cz / 4 - nz * k)];
  }
  function makeTex(atlas) {
    const lv = atlas.levels;
    const tex = new THREE.DataTexture(lv[0], atlas.width, atlas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    if (lv.length > 1) {
      tex.mipmaps = lv.map((data, i) => ({ data, width: Math.max(1, atlas.width >> i), height: Math.max(1, atlas.height >> i) }));
      tex.minFilter = THREE.NearestMipmapLinearFilter;
    } else tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.flipY = false; tex.unpackAlignment = 1;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace; else tex.encoding = 3001;
    tex.needsUpdate = true;
    return tex;
  }
  // MC 是在显示空间里「贴图 × 顶点色」；three 在线性空间乘，所以顶点色（AO）先转成线性，暗角才和 MC 一样
  const lin = (c) => Math.pow(Math.max(0, c), 2.2);
  function layerGeo(Ly, quads) {
    const n = quads.length, pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), col = new Float32Array(n * 12);
    const index = n * 4 > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
    quads.forEach((q, i) => {
      pos.set(Ly.position.subarray(q * 12, q * 12 + 12), i * 12);
      uv.set(Ly.uv.subarray(q * 8, q * 8 + 8), i * 8);
      for (let k = 0; k < 12; k++) col[i * 12 + k] = lin(Ly.color[q * 12 + k]);
      const v = i * 4, o = i * 6;
      index[o] = v; index[o + 1] = v + 1; index[o + 2] = v + 2; index[o + 3] = v; index[o + 4] = v + 2; index[o + 5] = v + 3;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
  function materials(tex, glow) {
    const std = (o) => (glow ? glow(o) : new THREE.MeshStandardMaterial(Object.assign({ map: tex, vertexColors: true, roughness: 0.92, metalness: 0 }, o)));
    return {
      solid: std({}),
      cutout: std({ alphaTest: 0.5 }),
      entity: std({ alphaTest: 0.1 }),
      translucent: std({ transparent: true, depthWrite: false }),
    };
  }
  // 出一份网格：model（整栋或剖开的）→ Group（下面每个部件一个 Group，部件下面每层一个 Mesh）
  // opts.org：格子 (0,0,0) 的场景位置（默认房子的；布置模式的预览、家具清单的小图用自己的）
  async function meshGroup(model, opts) {
    const org = opts.org || HB.grid.org;
    const res = await V3.mcmesh.build(model, { pack: opts.pack, ao: true, light: false, cardinal: false, mipmaps: true, origin: org });
    const tex = makeTex(res.atlas), mats = materials(tex, opts.glow ? (o) => opts.glow(tex, o) : null);
    const [W, Hh, Lz] = res.size, groups = new Map(), M = V3.mcmodel;
    const stm = model.palette.map((s) => { const p = M.parseState(s); return M.isAir(p) ? null : p; });   // 剖开的那份调色板多了空气、开着的门
    for (const k of LAYERS) {
      const Ly = res.layers[k];
      if (!Ly || !Ly.quads) continue;
      for (let q = 0; q < Ly.quads; q++) {
        // 出这个面的方块那格（16-mcmesh 记的 cells；伸出格子的吊篮吊臂也归吊篮）；没记的按面的位置算
        const [x, y, z] = Ly.cells ? [Ly.cells[q * 3], Ly.cells[q * 3 + 1], Ly.cells[q * 3 + 2]] : cellOfQuad(Ly.position, q);
        const inb = x >= 0 && y >= 0 && z >= 0 && x < W && y < Hh && z < Lz;
        const s = inb ? stm[model.cells[x + z * W + y * W * Lz]] : null;
        const p = s && opts.parts ? partOf(opts.L, s, org[0] + x, org[1] + y, org[2] + z) : ROOT + '/其他';
        let g = groups.get(p); if (!g) groups.set(p, (g = {}));
        if (s && CLICK[s.ns + ':' + s.id]) g.click = CLICK[s.ns + ':' + s.id];
        (g[k] || (g[k] = [])).push(q);
      }
    }
    const root = new THREE.Group();
    root.position.set(org[0], org[1], org[2]);
    for (const [p, g] of groups) {
      const pg = new THREE.Group(); pg.name = p;
      for (const k of LAYERS) {
        if (!g[k]) continue;
        const m = new THREE.Mesh(layerGeo(res.layers[k], g[k]), mats[k]);
        m.name = 'house-mc:' + k;
        m.castShadow = k !== 'translucent'; m.receiveShadow = true;
        m.userData.anchor = 'house2:blocks';
        pg.add(m);
      }
      // 反馈部件（V3.parts）：这里只记路径，不登记。出网格是异步的，画好时这栋房子可能已经换掉了；
      // 收下这份网格的人确认它没过期再 registerParts(root)，扔的时候 disposeGroup 会注销
      if (opts.tag !== false) pg.userData.part = p;
      if (g.click && opts.tag !== false) pg.userData.clickable = g.click;
      root.add(pg);
    }
    root.userData = { tex, mats, stats: res.stats, warnings: res.warnings };
    return root;
  }
  // 把一份网格的部件登记进 V3.parts（只登记一次）；unregisterParts 按对象拿掉（路径、别的几份网格不动）
  function registerParts(g) {
    const P = V3.parts;
    if (!g || !P || !P.tag || g.userData.partsOn) return;
    g.userData.partsOn = true;
    for (const pg of g.children) if (pg.userData.part) P.tag(pg, pg.userData.part);
  }
  function unregisterParts(g) {
    const P = V3.parts;
    if (!g || !g.userData || !g.userData.partsOn) return;
    g.userData.partsOn = false;
    if (P && P.untag) P.untag(g);
  }
  function disposeGroup(g) {
    if (!g) return;
    unregisterParts(g);
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    const u = g.userData || {};
    for (const m of Object.values(u.mats || {})) m.dispose();
    if (u.tex) u.tex.dispose();
  }
  // 换掉一部分格子（keep(x,y,z,s) → false 的变成空气；swap(s) → 新的状态字符串）
  function editModel(model, keep, swap) {
    const G = HB.grid, palette = model.palette.slice(), ids = new Map(palette.map((s, i) => [s, i]));
    let air = palette.findIndex((s) => /^(minecraft:)?(air|cave_air|void_air)$/.test(s));
    if (air < 0) { air = palette.length; palette.push('minecraft:air'); }
    const cells = Int32Array.from(model.cells), [W, , Lz] = model.size, n = W * Lz;
    for (let i = 0; i < cells.length; i++) {
      const s = G.st[cells[i]]; if (!s) continue;
      const x = i % W, z = Math.floor(i / W) % Lz, y = Math.floor(i / n);
      if (!keep(G.org[0] + x, G.org[1] + y, G.org[2] + z, s)) { cells[i] = air; continue; }
      if (swap) {
        const t = swap(s, model.palette[cells[i]]);
        if (t) { let k = ids.get(t); if (k == null) { k = palette.length; palette.push(t); ids.set(t, k); } cells[i] = k; }
      }
    }
    return Object.assign({}, model, { palette, cells });
  }

  // ---- MC 贴图：玩家选过的 jar（14-mcjar 存在本机 IndexedDB）；设置里可以选 / 忘掉 ----
  let packP = null;
  const jarPack = () => (packP = packP || (V3.mcjar && V3.mcjar.cacheLoad ? V3.mcjar.cacheLoad().catch(() => null) : Promise.resolve(null)));
  // 模组自己的资源（家具的 blockstates / models / textures / items）：build.mjs 打进页面的 __V3_ASSETS['mcpack/…']。
  // 画的时候和玩家的 jar 合成一个包（我们的文件盖在后面）；没选 jar 就只用我们的：家具照样是模型，原版方块退回近似颜色。
  // 打包成 __V3_ASSETS['mcpack.json.gz']（build.mjs 的 modPackBlob：{ 路径: {t: 文本} | {b: base64} }，gzip），第一次用时解开
  let modFiles = new Map(), modP = null;
  const modPackFiles = () => modFiles;
  HB.modPackReady = () => (modP = modP || (async () => {
    const b64 = (window.__V3_ASSETS || {})['mcpack.json.gz'];
    if (!b64 || typeof DecompressionStream === 'undefined') return modFiles;
    const txt = await new Response(new Blob([b64bytes(b64)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const enc = new TextEncoder(), m = new Map();
    for (const [p, v] of Object.entries(JSON.parse(txt))) m.set(p, v.t != null ? enc.encode(v.t) : b64bytes(v.b));
    modFiles = m; packs.clear();
    return modFiles;
  })().catch((e) => { V3.err('house-mc: 模组资源包解不开 ' + ((e && e.message) || e)); return modFiles; }));
  const packs = new Map();
  HB.renderPack = (jar) => {
    const J = V3.mcjar, mine = modPackFiles();
    if (!J || !J.makePack || !mine.size) return jar || null;
    const key = (jar ? jar.key : 'nojar') + '+xiaojingyu:' + mine.size;
    if (!packs.has(key)) {
      const files = jar ? new Map([...jar.files, ...mine]) : new Map(mine);
      packs.set(key, J.makePack(files, { key, jarSize: jar ? jar.jarSize : 0, inflateZlib: (jar && jar.inflateZlib) || J.inflateZlib }));
    }
    return packs.get(key);
  };
  HB.jarInfo = async () => { const p = await jarPack(); return p ? { key: p.key, version: (p.version && p.version.id) || '' } : null; };
  // The existing explicit client-JAR preview is available to the workbench/API.
  // Gameplay defaults to the bundled palette unless this preview is requested.
  let previewJar = false;
  HB.textureMode = () => V3.game?.get?.('mcTextureMode') === 'instance' ? 'instance' : 'builtin';
  async function activePack(jar) {
    const base = HB.renderPack(jar);
    if (HB.textureMode() !== 'instance' || !V3.mcInstance || !V3.mcTextureLayer) return base;
    const inst = await V3.mcInstance.current().catch(() => null);
    return V3.mcTextureLayer.apply(base, inst?.layers, V3.mcInstance.inflateZlib);
  }
  const previewSource = () => previewJar || V3.PAGE === 'studio' ? jarPack() : Promise.resolve(null);

  let LIVE = null;   // 当前场景里的这个部件（场景重建就换）
  // ---- 床上叠好的睡衣和枕头上的睡帽（44-furn-mc 规格里的 sleepProps）：她躺进床里时藏起来，起来了再摆回去 ----
  // MC 的资源不动（MC 里它们一直摆着）。网页里画房子用的资源包换成两份「派生」包：main 里这几个方块模型去掉这些元素（房子主体、剖开的
  // 每一份都用它），props 里只留这些元素（每张床单独出一小份网格，build 里的 me.bedProps）。睡着时只切这份小网格的 visible，不重出房子。
  // 模型对不上规格（元素数不一样）：不拆，main 就是原来的包，没有 props（照旧一直画在床上，不藏）。按包缓存：同一个包的解析、烘焙结果复用
  const SPLIT = new WeakMap();
  function bedSplit(pack) {
    if (!pack) return { main: pack, props: null };
    let s = SPLIT.get(pack);
    if (s) return s;
    s = { main: pack, props: null };
    const FM = V3.furnMc, norm = V3.mcmodel.normId, want = new Map();
    for (const f of (FM && FM.list) || []) {
      const sp = f.sleepProps; if (!sp) continue;
      for (const part of Object.keys(sp.parts)) if (f.models[part]) want.set(norm(f.models[part]), { idx: new Set(sp.parts[part]), total: sp.total[part] });
    }
    let ok = want.size > 0;
    for (const [name, w] of want) { const js = pack.model(name); if (!js || !Array.isArray(js.elements) || js.elements.length !== w.total) ok = false; }
    if (ok) {
      const derive = (tag, keep) => Object.assign({}, pack, { key: pack.key + '+' + tag, model(name) {
        const js = pack.model(name), w = js && want.get(norm(name));
        return w ? Object.assign({}, js, { elements: js.elements.filter((e, i) => keep(w.idx.has(i))) }) : js;
      } });
      s = { main: derive('bed-made', (p) => !p), props: derive('bed-props', (p) => p) };
    }
    SPLIT.set(pack, s);
    return s;
  }
  HB.bedSplit = bedSplit;
  // 她躺在哪张床上（床中心的场景坐标，65-girl-actor 躺下时给、起来 / 被打断时给 null）。存在模块里：场景重建时新的房子照样知道
  let SLEEP = null;
  HB.setSleeper = (p) => {
    SLEEP = Array.isArray(p) && p.length >= 3 && [0, 1, 2].every((k) => Number.isFinite(+p[k])) ? [+p[0], +p[1], +p[2]] : null;
    if (LIVE && !LIVE.dead && LIVE.applyBedProps) LIVE.applyBedProps();
    return HB.sleeper();
  };
  HB.sleeper = () => (SLEEP ? SLEEP.slice() : null);
  HB.reloadTextures = () => LIVE ? LIVE.reload() : Promise.resolve();
  V3.on?.('game:settings', (e) => {
    if (e?.key !== 'mcTextureMode') return;
    previewJar = false;
    void HB.reloadTextures();
  });
  HB.useJar = async (file) => {
    if (!V3.mcjar || !V3.mcjar.open) throw new Error('这个页面没有读 jar 的模块');
    const pack = await V3.mcjar.open(file);
    packP = Promise.resolve(pack);
    previewJar = true;
    void HB.reloadTextures();
    return pack;
  };
  HB.forgetJar = async () => {
    if (V3.mcjar && V3.mcjar.cacheClear) await V3.mcjar.cacheClear();
    packP = Promise.resolve(null);
    previewJar = false;
    void HB.reloadTextures();
  };

  // ---- 剖开：外墙那一圈的格子在哪一面（s/n/w/e），按楼层和压低的墙要不要画这一格 ----
  function ringSideOf(H, x, z) {
    const out = [];
    if (x < H.x0 || x >= H.x1 || z < H.z0 || z >= H.z1) return out;
    if (z === H.z1 - 1) out.push('s'); if (z === H.z0) out.push('n'); if (x === H.x0) out.push('w'); if (x === H.x1 - 1) out.push('e');
    return out;
  }
  function cutKeep(H, floor, sides, x, y, z) {
    if (floor === 'all') return true;
    if (y > (floor === 'ground' ? H.loftY - 2 : H.loftY)) return false;
    const sd = ringSideOf(H, x, z);
    if (!sd.length || !sd.some((k) => sides.includes(k))) return true;
    return floor === 'ground' ? y <= H.floorY : y < H.loftY;     // 一楼：留地梁和最下一格墙；阁楼：去掉矮墙
  }
  // 现在画出来的房子里这一格看得见吗（剖开时上面几层、压低的墙看不见）：布置模式点选、拖动用
  HB.visibleAt = (x, y, z) => {
    const me = LIVE;
    if (!me || me.floor === 'all') return true;
    return cutKeep(HB.placedLayout().house, me.floor, me.shown ? me.shown.split('|')[1] || '' : '', x, y, z);
  };
  // 布置模式：几个方块单独出一份网格（拖动时的半透明预览、家具清单的小图）。list = [{ pos: [x,y,z], state }]（场景格子）
  //   → Promise<THREE.Group>（每种家具一个子 Group，名字是部件路径「小屋/家具/<名字>」，可以用 HB.disposeGroup 释放）
  HB.meshFor = async (list) => {
    if (!list.length) return new THREE.Group();
    const mn = [0, 1, 2].map((k) => Math.min(...list.map((c) => c.pos[k]))), mx = [0, 1, 2].map((k) => Math.max(...list.map((c) => c.pos[k])));
    const size = [0, 1, 2].map((k) => mx[k] - mn[k] + 1), palette = ['minecraft:air'], cells = new Int32Array(size[0] * size[1] * size[2]);
    for (const c of list) {
      let i = palette.indexOf(c.state); if (i < 0) { i = palette.length; palette.push(c.state); }
      cells[(c.pos[0] - mn[0]) + (c.pos[2] - mn[2]) * size[0] + (c.pos[1] - mn[1]) * size[0] * size[2]] = i;
    }
    await HB.modPackReady();
    const pack = LIVE && LIVE.pack ? LIVE.pack : await activePack(await previewSource());
    return meshGroup({ size, offset: [0, 0, 0], palette, cells }, { pack, parts: true, tag: false, L: V3.layout, org: mn });   // 不登记反馈部件、不能点
  };
  HB.disposeGroup = (g) => disposeGroup(g);

  // ---- 场景部件 ----
  const NORM = { s: [0, 0, 1], n: [0, 0, -1], e: [1, 0, 0], w: [-1, 0, 0] };
  function build(ctx) {
    const L = ctx.L && ctx.L !== V3.layout ? ctx.L : HB.placedLayout(), H = L.house;   // 房子挪过：外墙、门廊按摆好以后的算（剖开、部件分类、点光）
    const root = new THREE.Group(); root.name = 'house-mc';
    const me = { root, cache: new Map(), stale: [], hideSeq: 0, shown: null, want: null, busy: false, door: null, doors: [], lanterns: [], bedProps: [], floor: (ctx.state && ctx.state.floor) || 'all',
      sides: '', doorOpen: false, gen: 0, stats: null, pack: null, packMain: null, packProps: null, dead: false };
    LIVE = me;
    // 这栋房子（这个场景）已经拆了：排着队的 setFloor / setHidden、还在画的网格回来时看到就不再往里加东西
    const gone = () => me.dead || !!ctx.dead;
    const tagAll = () => { if (V3.parts && V3.parts.declare) V3.parts.declare(Object.keys(LABELS), LABELS); };
    tagAll();
    const centre = new THREE.Vector3((H.x0 + H.x1) / 2, H.floorY, (H.z0 + H.z1) / 2);
    const gTop = H.loftY - 2, lTop = H.loftY;   // 剖到一楼：留到格子 y = gTop；剖到阁楼：留到 lTop
    const ringSide = (x, z) => ringSideOf(H, x, z);
    // 门、灯笼单独画；规格里 overlay 是 ['*'] 的家具（风铃、遮阳伞：会随风摆）网页里整件用体素版画，房子网格里不画（FURNITURE.md 第 9 节）
    const webVoxel = (s) => { const f = s.ns && s.ns !== 'minecraft' && V3.furnMc && V3.furnMc.byBlock && V3.furnMc.byBlock(s.ns + ':' + s.id); return !!(f && Array.isArray(f.overlay) && f.overlay.includes('*')); };
    const special = (s) => /_door$/.test(s.id) || (s.ns === 'minecraft' && /lantern$/.test(s.id)) || webVoxel(s)
      || (V3.furniturePlay && s.ns === 'xiaojingyu' && s.id === 'rocking_chair');
    const keyOf = (floor, sides) => floor + '|' + sides;
    // 一份「主体」：去掉门和灯笼（单独画），按楼层剖开、压低朝镜头的墙
    // me.hidden：布置模式拖着的那件家具先不画（格子 'x,y,z' 的集合）
    const mainModel = (floor, sides) => editModel(HB.model, (x, y, z, s) => {
      if (special(s)) return false;
      if (me.hidden && me.hidden.has(x + ',' + y + ',' + z)) return false;
      // 吊灯的链条也属于灯具；剖掉顶部支撑时不能只把灯泡藏掉而留下悬空铁链。
      if (floor !== 'all' && /chain$/.test(s.id)) {
        let bottom = y - 1, top = y + 1;
        while (bottom >= HB.grid.bounds.y0 && /chain$/.test((HB.grid.at(x, bottom, z) || {}).id || '')) bottom--;
        while (top < HB.grid.bounds.y1 && /chain$/.test((HB.grid.at(x, top, z) || {}).id || '')) top++;
        const below = HB.grid.at(x, bottom, z);
        if (below && /lantern$/.test(below.id) && !cutKeep(H, floor, sides, x, top, z)) return false;
      }
      if (s.ns === 'xiaojingyu' && s.id === 'string_lights' && !cutKeep(H, floor, sides, x, y + 1, z)) return false;
      return cutKeep(H, floor, sides, x, y, z);
    });
    // 一份主体不要了：画好的马上从场景摘掉、注销部件、释放网格 / 材质 / 图集（disposeGroup）；还在画的画完看到 v.dead 自己扔
    const retire = (v) => {
      v.dead = true;
      const g = v.g; v.g = null;
      if (g) { root.remove(g); disposeGroup(g); }
    };
    // 缓存的、换下来还没扔的（me.stale）全部扔掉：重新读贴图、拆场景时用
    const dropAll = () => {
      for (const v of me.cache.values()) retire(v);
      for (const v of me.stale.splice(0)) retire(v);
      me.cache.clear(); me.shown = null;
    };
    const variant = (key) => {
      let v = me.cache.get(key);
      if (v) { me.cache.delete(key); me.cache.set(key, v); return v.p; }   // 最近用过的排到最后
      if (gone()) return Promise.resolve(null);
      const [floor, sides] = key.split('|'), my = me.gen;
      v = { p: null, g: null, dead: false };
      v.p = meshGroup(mainModel(floor, sides), { pack: me.packMain, parts: true, L }).then((g) => {
        if (v.dead || gone() || my !== me.gen) { disposeGroup(g); return null; }   // 画的时候被换掉了：没登记过部件，直接扔
        v.g = g; g.visible = false; registerParts(g); root.add(g); return g;
      });
      me.cache.set(key, v);
      while (me.cache.size > 10) {                           // 最多留 10 份
        const [k0, v0] = me.cache.entries().next().value;
        if (k0 === me.shown) break;
        me.cache.delete(k0);
        retire(v0);
      }
      return v.p;
    };
    const show = async (key) => {
      if (gone()) return;
      me.want = key;
      const g = await variant(key);
      const cur = me.cache.get(key);
      if (!g || gone() || me.want !== key || !cur || cur.g !== g) return;   // 等的时候房子拆了 / 要看的换了 / 这份被换掉了
      for (const v of me.cache.values()) if (v.g) v.g.visible = v.g === g;
      for (const v of me.stale) if (v.g) v.g.visible = false;                // 换下来还没扔的不能和新的叠着画
      me.shown = key;
      applyExtras();
    };
    // 门（开 / 关两份）和灯笼（每盏一份，自发光）
    const glowFor = (tex, o) => {
      const m = ctx.glowMat ? ctx.glowMat(0xffffff, { vertexColors: true, day: 0.05, night: 0.65 }) : new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
      m.map = tex; m.emissiveMap = tex; m.alphaTest = o.alphaTest || 0.5; m.roughness = 0.8;
      if (o.transparent) { m.transparent = true; m.depthWrite = false; }
      m.needsUpdate = true;
      return m;
    };
    const releaseExtra = (g) => {
      if (!g) return;
      for (const m of Object.values(g.userData.mats || {})) if (ctx.releaseGlow) ctx.releaseGlow(m);
      root.remove(g); disposeGroup(g);
    };
    function clearExtras() {
      for (const lp of me.lanterns) { releaseExtra(lp.g); if (lp.light && ctx.releaseLamp) ctx.releaseLamp(lp.light); }
      for (const d of me.doors) { releaseExtra(d.open); releaseExtra(d.closed); }
      for (const bp of me.bedProps) releaseExtra(bp.g);
      me.lanterns = []; me.doors = []; me.bedProps = []; me.door = null; me.doorOpen = false;
    }
    const tagSwitch = (g, item) => Object.assign(g.userData, { clickable: 'houseSwitch', clickAlways: true, switchKey: item.key });
    async function buildExtras(my) {
      const G = HB.grid, doors = new Map(), lamps = [];
      for (let i = 0; i < G.cells.length; i++) {
        const s = G.st[G.cells[i]]; if (!s) continue;
        const x = G.org[0] + i % G.W, z = G.org[2] + Math.floor(i / G.W) % G.L, y = G.org[1] + Math.floor(i / (G.W * G.L));
        if (/_door$/.test(s.id)) {
          const cell = [x, y - ((s.props || {}).half === 'upper' ? 1 : 0), z], block = s.ns + ':' + s.id;
          const key = switchKey('door', cell, block);
          let d = doors.get(key);
          if (!d) { d = { key, kind: 'door', cell, cells: [], x: x + 0.5, y: cell[1], z: z + 0.5, effectiveOpen: false, yielding: false }; doors.set(key, d); }
          d.cells.push([x, y, z]);
        } else if (s.ns === 'minecraft' && /lantern$/.test(s.id)) {
          const cell = [x, y, z], hanging = (s.props || {}).hanging === 'true';
          let supportY = y + 1;
          while (supportY < G.bounds.y1 && /chain$/.test((G.at(x, supportY, z) || {}).id || '')) supportY++;
          lamps.push({ key: switchKey('lamp', cell, s.ns + ':' + s.id), kind: 'lamp', cell, x, y, z, hanging, support: [x, supportY, z] });
        }
      }
      const stale = () => my !== me.gen || me.dead || ctx.dead;
      const only = (list) => { const keys = new Set(list.map(c => c.join(','))); return (x, y, z) => keys.has([x, y, z].join(',')); };
      for (const d of doors.values()) {
        if (stale()) return;
        const isD = only(d.cells), swap = (open) => (s, str) => /open=/.test(str)
          ? str.replace(/open=(true|false)/, 'open=' + open) : str.replace(/\]$/, ',open=' + open + ']');
        const [gc, go] = await Promise.all([
          meshGroup(editModel(HB.model, isD, swap(false)), { pack: me.pack, parts: true, L }),
          meshGroup(editModel(HB.model, isD, swap(true)), { pack: me.pack, parts: true, L }),
        ]);
        if (stale()) { releaseExtra(gc); releaseExtra(go); return; }
        Object.assign(d, { closed: gc, open: go, objects: [gc, go] });
        switchPref(d.key, 'door'); tagSwitch(gc, d); tagSwitch(go, d);
        registerParts(gc); registerParts(go);
        go.visible = false; root.add(gc, go); me.doors.push(d);
      }
      // 旧的 door / doorOpen 统计保留为「第一扇门 / 任意门开着」，交互使用 doors。
      me.door = me.doors[0] || null;
      for (const lp of lamps) {
        if (stale()) return;
        const g = await meshGroup(editModel(HB.model, only([lp.cell])), { pack: me.pack, parts: true, L, glow: glowFor });
        if (stale()) { releaseExtra(g); return; }
        Object.assign(lp, { g, objects: [g] }); switchPref(lp.key, 'lamp'); tagSwitch(g, lp);
        registerParts(g);
        root.add(g);
        // 点光放在 house 根组，不随灯具剖掉；同半边门廊仍合计原来的 2.0 强度。
        const P = L.porch || {}, alongX = !(P.x1 - P.x0 < P.z1 - P.z0);
        const porchHalf = (p) => {
          const on = p.y < H.loftY && (alongX ? p.z + 0.5 >= P.z0 - 0.01 && p.z + 0.5 <= P.z1 + 0.01 : p.x + 0.5 >= P.x0 - 0.01 && p.x + 0.5 <= P.x1 + 0.01);
          return !on ? null : (alongX ? p.x + 0.5 < (P.x0 + P.x1) / 2 : p.z + 0.5 < (P.z0 + P.z1) / 2) ? 'a' : 'b';
        };
        const half = porchHalf(lp), intensity = half == null ? 1.4 : 2 / lamps.filter(p => porchHalf(p) === half).length;
        lp.light = ctx.lamp ? ctx.lamp({ pos: [lp.x + 0.5, lp.y + 0.3, lp.z + 0.5], color: half == null ? 0xffc27a : 0xffb35c, intensity, distance: half == null ? 9 : 6, switchable: true, parent: root }) : null;
        me.lanterns.push(lp);
      }
      // 床上的睡衣和睡帽：每张床一小份网格（只有这几个元素，部件照样是「小屋/家具/床」），按方块的 facing 摆好，跟着床挪、转
      const FM = V3.furnMc;
      if (me.packProps && FM) for (const it of HB.furnInstances()) {
        const f = it.f, sp = f.sleepProps;
        if (!sp) continue;
        if (stale()) return;
        const cells = FM.cellsFor(f, it.facing).filter((c) => sp.parts[c.part]).map((c) => [it.cell[0] + c.offset[0], it.cell[1] + c.offset[1], it.cell[2] + c.offset[2]])
          .filter(([x, y, z]) => { const s = G.at(x, y, z); return !!s && s.ns + ':' + s.id === f.block && (s.props || {}).facing === it.facing; });   // 半张床：只画还在的那格
        if (!cells.length) continue;
        // 周围一格的方块也带上（不出睡衣以外的面也算 AO：靠墙那头的暗角和房子网格里一样），出完只留这张床的部件。别的床不带（它的睡衣睡帽会画进来）
        const mine = only(cells), near = (x, y, z, s) => mine(x, y, z) || (!(V3.furnMc.byBlock(s.ns + ':' + s.id) || {}).sleepProps &&
          cells.some((c) => Math.abs(c[0] - x) <= 1 && Math.abs(c[1] - y) <= 1 && Math.abs(c[2] - z) <= 1));
        const g = await meshGroup(editModel(HB.model, near), { pack: me.packProps, parts: true, L });
        if (stale()) { releaseExtra(g); return; }
        const bedPart = ROOT + '/家具/' + f.label;
        for (const pg of g.children.slice()) if (pg.name !== bedPart) { g.remove(pg); pg.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
        if (!g.children.length) { disposeGroup(g); continue; }
        g.name = 'bed-props';
        const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[2]);
        const bp = { cells, g, objects: [g], asleep: false, y: cells[0][1], box: [Math.min(...xs), Math.min(...zs), Math.max(...xs) + 1, Math.max(...zs) + 1] };
        registerParts(g);
        root.add(g); me.bedProps.push(bp);
      }
      updateDoors(); applyExtras();
    }
    // 睡衣和睡帽这一份看不看得见：她睡在这张床上就藏；剖开时这一格剖掉了、布置模式正拖着这张床也藏。不逐帧跑（切楼层、拖家具、躺下 / 起来时）
    function applyBedProps() {
      const sides = me.shown ? me.shown.split('|')[1] || '' : '';
      for (const bp of me.bedProps) {
        const b = bp.box;
        bp.asleep = !!SLEEP && Math.abs(SLEEP[1] - bp.y) < 0.6 && SLEEP[0] >= b[0] - 0.01 && SLEEP[0] <= b[2] + 0.01 && SLEEP[2] >= b[1] - 0.01 && SLEEP[2] <= b[3] + 0.01;
        let shown = !bp.asleep;
        for (const c of bp.cells) if (shown && (!cutKeep(H, me.floor, sides, c[0], c[1], c[2]) || (me.hidden && me.hidden.has(c[0] + ',' + c[1] + ',' + c[2])))) shown = false;
        bp.g.visible = shown;
      }
    }
    me.applyBedProps = applyBedProps;
    function updateDoors() {
      const a = V3.actor && V3.actor.pos;
      for (const d of me.doors) {
        const pref = switchPref(d.key, 'door'), mode = V3.houseDoorForce == null ? (pref.mode === 'open' ? 'open' : 'closed') : V3.houseDoorForce ? 'open' : 'closed';
        // nav 一直允许通门：门关着也挡不住她（她自己会开门）。逐门独立关闭不能调用 nav 的全局 setDoor(false)。
        // 关着的门：角色走近 / 还在门洞里时她自己打开，走开再关上，避免穿门或夹人。
        const near = !!(a && Math.abs(a[1] - d.y) < 1.6 && Math.hypot(a[0] - d.x, a[2] - d.z) < (d.effectiveOpen ? 1.9 : 1.5));
        d.yielding = mode === 'closed' && near;
        d.effectiveOpen = mode === 'open' || near;
      }
      me.doorOpen = me.doors.some(d => d.effectiveOpen);
    }
    function applyExtras() {
      const cut = me.floor === 'all' ? Infinity : me.floor === 'ground' ? gTop : lTop;
      const sides = me.floor === 'ground' && me.shown ? me.shown.split('|')[1] : '';
      for (const d of me.doors) {
        const hid = d.y > cut || ringSide(Math.floor(d.x), Math.floor(d.z)).some((k) => sides.includes(k));
        d.open.visible = !hid && d.effectiveOpen; d.closed.visible = !hid && !d.effectiveOpen;
      }
      for (const lp of me.lanterns) if (lp.g) {
        const supportVisible = !lp.hanging || cutKeep(H, me.floor, me.shown ? me.shown.split('|')[1] || '' : '', ...lp.support);
        lp.g.visible = lp.y <= cut && supportVisible;
        const enabled = switchPref(lp.key, 'lamp').on;
        for (const m of Object.values(lp.g.userData.mats || {})) m.userData.lightEnabled = enabled;
        if (lp.light) lp.light.userData.lightEnabled = enabled;
      }
      applyBedProps();
      if (ctx.tickLights) ctx.tickLights();
    }
    me.applySwitches = () => { updateDoors(); applyExtras(); };
    const facingSides = () => {
      const cam = V3.R && V3.R.camera; if (!cam) return '';
      const dx = cam.position.x - centre.x, dz = cam.position.z - centre.z, l = Math.hypot(dx, dz) || 1;
      return ['s', 'n', 'e', 'w'].filter((k) => NORM[k][0] * dx / l + NORM[k][2] * dz / l > 0.2).join('');
    };
    // 给 50-scene：哪几面墙压低了（挂墙的东西跟着藏）
    V3.scene.houseLowered = () => (me.floor === 'all' ? null : { storey: me.floor, sides: me.shown ? me.shown.split('|')[1] : '' });
    async function start() {
      if (gone()) return;
      const my = ++me.gen;
      dropAll();
      clearExtras();
      const jar = await previewSource();
      if (me.dead || ctx.dead || my !== me.gen) return;
      const pack = await activePack(jar);
      if (me.dead || ctx.dead || my !== me.gen) return;
      me.jar = jar;
      me.pack = pack;
      const split = bedSplit(pack);
      me.packMain = split.main; me.packProps = split.props;
      await show(keyOf(me.floor, me.floor === 'all' ? '' : facingSides()));
      if (me.dead || ctx.dead || my !== me.gen) return;
      await buildExtras(my);
      if (me.dead || ctx.dead || my !== me.gen) return;
      const g = me.cache.get(me.shown);
      me.stats = g && g.g ? g.g.userData.stats : null;
    }
    // 拆掉（整个场景重建、换模型）：先作废（dead、gen），缓存的每一份主体都摘掉、注销、释放（图集和没挂在网格上的那几层材质
    // 50-scene 的统一清理扫不到），门和灯笼也是；还在画的回来看到作废了自己扔。这里摘干净了，50-scene 再扫时不会碰到它们第二次
    me.dispose = () => { me.dead = true; me.gen++; me.want = null; dropAll(); clearExtras(); };
    me.reload = () => { me.ready = start().catch((e) => { HB.error = String(e && e.message || e); V3.err('house-mc: ' + (e && e.stack || e)); }); return me.ready; };
    // 先读方块数据（只读一次；换房子时 HB.importFile / HB.restore 换掉 HB.model 再重建场景）
    me.ready = HB.load().then(() => HB.modPackReady()).then(() => me.reload());
    if (ctx.wait) ctx.wait(me.ready);
    me.ready.catch((e) => { HB.error = String(e && e.message || e); V3.err('house-mc: ' + (e && e.stack || e)); });
    // 门：只要不是剖开看，她（V3.actor）走到门前 1.5 米内就开，走开 1.9 米外再关
    me.tick = () => {
      const before = me.doors.map(d => d.effectiveOpen);
      updateDoors();
      if (me.doors.some((d, i) => d.effectiveOpen !== before[i])) applyExtras();
      if (me.floor !== 'all' && me.shown) {
        const k = keyOf(me.floor, facingSides());
        if (k !== me.want) show(k);
      }
    };
    me.setFloor = (v) => {
      me.floor = v || 'all';
      if (gone()) return Promise.resolve();
      applyExtras();
      return me.ready.then(() => (gone() ? undefined : show(keyOf(me.floor, me.floor === 'all' ? '' : facingSides()))));
    };
    // 布置模式：拖着的家具先不画（cells = [[x,y,z]…]，null = 都画）。旧的几份网格等新的画好再扔，不闪
    // 连着叫两次（刚拖起来就放下）：换下来的都先放在 me.stale，最后叫的那一次画好了一起扔
    me.setHidden = async (cells) => {
      const key = cells && cells.length ? cells.map((c) => c.join(',')).sort().join(';') : '';
      if (key === (me.hiddenKey || '')) return;
      me.hiddenKey = key; me.hidden = key ? new Set(key.split(';')) : null;
      if (me.applyBedProps) me.applyBedProps();             // 拖着的是床：上面的睡衣睡帽马上跟着藏
      const seq = ++me.hideSeq;
      await me.ready;
      if (gone()) return;
      me.stale.push(...me.cache.values());
      me.cache.clear(); me.shown = null;
      await show(keyOf(me.floor, me.floor === 'all' ? '' : facingSides()));
      if (gone() || seq !== me.hideSeq) return;              // 拆了：dispose 已经全扔了；后面又叫了一次：等那一次
      for (const v of me.stale.splice(0)) retire(v);
    };
    root.userData.houseMc = me;
    return root;
  }

  V3.scene.part({
    id: 'house', label: '方块房子（v4）', order: 40,
    build(ctx) { const r = build(ctx); this._me = r.userData.houseMc; return r; },
    update() { if (this._me) this._me.tick(); },
    setState(k, v) { if (k === 'floor' && this._me) return this._me.setFloor(v); },
    dispose() { if (LIVE === this._me) LIVE = null; if (this._me) this._me.dispose(); this._me = null; V3.scene.houseLowered = null; },
  });
  HB.live = () => LIVE;
  // 每张床上那一份睡衣和睡帽（测试、浏览器检查用）：cells 是它在哪几格，shown 现在画不画，asleep 她是不是正睡在这张床上，object 那份网格
  HB.bedProps = () => (LIVE && !LIVE.dead ? LIVE.bedProps.map((b) => ({ cells: b.cells.map((c) => c.slice()), shown: b.g.visible, asleep: b.asleep, object: b.g })) : []);
  // objects 是真实可射线命中的组（开/关两份门按 visible 排除隐藏的一份）。
  // key 使用房子本地格子坐标，整栋移动/旋转、换贴图或重建不丢本次运行的偏好。
  HB.interactions = () => LIVE && !LIVE.dead ? [...LIVE.doors, ...LIVE.lanterns].map(s => ({ key: s.key, kind: s.kind, cell: s.cell.slice(), objects: s.objects.slice() })) : [];
  const liveSwitch = (key) => LIVE && !LIVE.dead ? [...LIVE.doors, ...LIVE.lanterns].find(s => s.key === key) : null;
  HB.switchState = (key) => {
    const s = liveSwitch(key); if (!s) return null;
    const p = switchPref(key, s.kind);
    return s.kind === 'door' ? { key, kind: 'door', mode: p.mode === 'open' ? 'open' : 'closed', open: s.effectiveOpen, yielding: s.yielding }
      : { key, kind: 'lamp', enabled: p.on, on: p.on };
  };
  // setDoor(key, 'open' | 'closed' | 'toggle')：玩家点门就是 toggle（看门现在是不是开着的：她正从门里过、门临时开着时点一下 = 关上，
  // 等她走过去就关）。'auto' 是旧写法，等于 'closed'。
  HB.setDoor = (key, mode) => {
    const s = liveSwitch(key); if (!s || s.kind !== 'door' || !['auto', 'open', 'closed', 'toggle'].includes(mode)) return null;
    if (mode === 'toggle') mode = s.effectiveOpen ? 'closed' : 'open';
    if (mode === 'auto') mode = 'closed';
    V3.houseDoorForce = null; switchPref(key, 'door').mode = mode; LIVE.applySwitches();
    const state = HB.switchState(key); if (V3.emit) V3.emit('house:switch', state); return state;
  };
  HB.toggleLamp = (key) => {
    const s = liveSwitch(key); if (!s || s.kind !== 'lamp') return null;
    const p = switchPref(key, 'lamp'); p.on = !p.on; LIVE.applySwitches();
    const state = HB.switchState(key); if (V3.emit) V3.emit('house:switch', state); return state;
  };
  HB.stats = () => (LIVE ? { from: HB.from, custom: HB.custom, info: HB.info, shown: LIVE.shown, cached: LIVE.cache.size, doorOpen: LIVE.doorOpen, lanterns: LIVE.lanterns.length,
    door: !!LIVE.door, pack: LIVE.pack ? LIVE.pack.key : null, jar: LIVE.jar ? LIVE.jar.key : null, modFiles: modPackFiles().size, mesh: LIVE.stats && { blocks: LIVE.stats.blocks, quads: LIVE.stats.quads, fallback: LIVE.stats.fallback, ms: LIVE.stats.ms,
      missingMod: (LIVE.stats.missingStates || []).filter((k) => String(k).includes('xiaojingyu:')) },   // 模组家具缺模型（资源没打进页面）
    error: HB.error } : null);
  V3.viewTokens = V3.viewTokens || {};
  V3.viewTokens.door = (v) => { V3.houseDoorForce = v === 'auto' ? null : v !== '0'; };   // 截图用：door=1 开、door=0 关、door=auto 跟着她

  // ---- 家具方块在房子里的摆法（55 / 56 / 57 的 overlay、灯、风铃、遮阳伞、贝壳柜格子跟着它摆）----
  // 每件一条（多格的只算主格）：{ f: V3.furnMc 的规格, block, cell: [x,y,z] 主格, facing }，按格子编号排（同一份房子每次一样）
  let FI = null;
  HB.furnInstances = (block) => {
    const G = HB.grid, FM = V3.furnMc;
    if (!G || !FM) return [];
    if (!FI || FI.v !== HB.version) {
      FI = { v: HB.version, all: [] };
      for (let i = 0; i < G.cells.length; i++) {
        const s = G.st[G.cells[i]];
        if (!s || !s.ns || s.ns === 'minecraft') continue;
        const f = FM.byBlock(s.ns + ':' + s.id); if (!f) continue;
        const p = s.props || {}, mp = FM.mainPart(f);
        if (mp != null && String(p.part) !== String(mp)) continue;
        const facing = FM.FACINGS.includes(p.facing) ? p.facing : (f.facing || 'north');
        FI.all.push({ f, block: f.block, cell: [G.org[0] + i % G.W, G.org[1] + Math.floor(i / (G.W * G.L)), G.org[2] + Math.floor(i / G.W) % G.L], facing });
      }
    }
    const k = block ? (String(block).includes(':') ? String(block) : 'xiaojingyu:' + block) : null;
    return k ? FI.all.filter((r) => r.block === k) : FI.all.slice();
  };
  // 再加上：home = 默认房子里同一格、同朝向的那一件（{cell, facing, id}，id 是布局里的名字，比如 lantern1），没对上就 null；
  // ref = 搬的参照（home，没有就用这一种在默认房子里的第一件）；mv = V3.furnMc.mover(ref, 这一件)：体素版照布局摆好以后，用 mv 搬到方块那里
  HB.furnPlaced = (block) => {
    const FM = V3.furnMc;
    return HB.furnInstances(block).map((r) => {
      const hs = FM.homesOf(r.f), home = hs.find((h) => h.facing === r.facing && h.cell.every((v, k) => v === r.cell[k])) || null, ref = home || hs[0] || null;
      return Object.assign({}, r, { home, ref, mv: ref ? FM.mover(ref, r) : null });
    });
  };
  // 场景部件用：方块读好了就马上 fn()（建场景时同步摆好）；还没读好（比如工作台）就等读好再 fn()，再让 50-scene 重新收集剖切用的物体
  HB.whenGrid = (ctx, fn) => {
    if (HB.grid) { fn(); return; }
    HB.load().then(() => { if (ctx && ctx.dead) return; fn(); if (ctx && ctx.recut) ctx.recut(); })
      .catch((e) => V3.err('house-mc whenGrid: ' + ((e && e.stack) || e)));
  };

  // ---- 导入的房子存在这台电脑的浏览器里（IndexedDB，只留一份）。存不了也能用，只是下次打开回到原来的房子 ----
  const DBN = 'v3-house', STN = 'house';
  let dbP = null;
  const db = () => dbP || (dbP = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { rej(new Error('这个浏览器不能存东西（没有 IndexedDB）')); return; }
    const r = indexedDB.open(DBN, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STN)) r.result.createObjectStore(STN); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('打不开浏览器里的存储'));
    r.onblocked = () => rej(new Error('浏览器里的存储被别的页面占着'));
  }).catch((e) => { dbP = null; throw e; }));
  const idb = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STN, mode), req = fn(t.objectStore(STN));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('存储被取消'));
    });
  };
  const localHouse = {
    get: () => idb('readonly', (s) => s.get('current')),
    put: (rec) => idb('readwrite', (s) => s.put(rec, 'current')),
    clear: () => idb('readwrite', (s) => s.delete('current')),
  };
  const progress = V3.cabinProgress;
  progress?.legacy('house', localHouse.get);
  HB.store = progress ? {
    get: async () => progress.read('house'), put: rec => progress.write('house', rec), clear: () => progress.write('house', null),
  } : localHouse;

  // ---- 鲸图的 Metadata（FORMAT.md 3.1）----
  const tv = (v, k) => (v && typeof v === 'object' && k in v ? v[k] : undefined);
  function metaOf(model) {
    const c = tv(tv(model, 'meta'), 'compound') || {}, x = tv(tv(c, 'Xiaojingyu'), 'compound');
    const str = (v) => (v && typeof v.string === 'string' ? v.string : null);
    const lng = (v) => { const n = v && v.long != null ? Number(v.long) : NaN; return Number.isFinite(n) && n > 0 ? n : null; };
    return { name: str(tv(c, 'Name')), author: str(tv(c, 'Author')), date: lng(tv(c, 'Date')), xjy: !!x, facing: x ? str(tv(x, 'Facing')) : null, source: x ? str(tv(x, 'Source')) : null };
  }
  function customOf(rec, model) {
    const m = metaOf(model);
    return { name: m.name || rec.name || '', author: m.author || rec.author || '', date: m.date || rec.date || null, file: rec.file || '', at: rec.at || Date.now(), source: m.source || '',
      arranged: rec.kind === 'arranged', base: rec.base || null };
  }
  HB.metaOf = metaOf;

  // ---- 导入时的检查（docs/HOUSE-V4.md 17.2）：reject = 不用（说清楚为什么）；ask = 先问一句（列出哪里不一样），点「还是用它」才换；notes = 换了以后提一下 ----
  const FN = { north: '北', south: '南', east: '东', west: '西' };
  const isAirS = (s) => /^(minecraft:)?(air|cave_air|void_air)$/.test(String(s).replace(/\[.*$/, ''));
  const idOf = (s) => { const t = String(s).replace(/\[.*$/, ''); return t.includes(':') ? t : 'minecraft:' + t; };
  const missingMessage = ids => '缺少所需模组：' + ids.join('、') + '。房屋没有替换。';
  HB.check = (model, deps = dependencies(model)) => {
    const out = { reject: null, ask: [], notes: [], match: null, same: false, requiredMods: deps.required, missingMods: deps.missing };
    if (deps.missing.length) { out.reject = missingMessage(deps.missing); return out; }
    const L = V3.layout, H = L.house, S = L.site, D = HB.defaultModel, m = metaOf(model), want = (D && metaOf(D).facing) || 'north';
    if (m.facing && m.facing !== want) {
      out.reject = '这张鲸图是面朝' + (FN[m.facing] || m.facing) + '抓的，这栋房子要面朝' + FN[want] + '抓（站在台阶前那一格、面朝房子）。网页不会自己把房子转过来，所以没有用它。';
      return out;
    }
    const [W, Hh, Lz] = model.size, n = W * Hh * Lz, air = model.palette.map(isAirS);
    let blocks = 0; for (let i = 0; i < n; i++) if (!air[model.cells[i]]) blocks++;
    if (!blocks) { out.reject = '这张鲸图里一个方块都没有。'; return out; }
    const o = HB.originOf(model), b = { x0: o[0], x1: o[0] + W, y0: o[1], y1: o[1] + Hh, z0: o[2], z1: o[2] + Lz };
    if (b.x0 < S.x0 || b.x1 > S.x1 || b.z0 < S.z0 || b.z1 > S.z1 || b.y0 < -8 || b.y1 > 48) {
      out.reject = '放进来会超出场地：场地是东西 ' + S.x0 + '..' + S.x1 + '、南北 ' + S.z0 + '..' + S.z1 + ' 米，这张图会落在东西 ' + b.x0 + '..' + b.x1 + '、南北 ' + b.z0 + '..' + b.z1 +
        '、高 ' + b.y0 + '..' + b.y1 + '。不像是这栋房子（是不是站的位置不对，或者抓的范围太大了）。';
      return out;
    }
    if (b.x1 <= H.x0 || b.x0 >= H.x1 || b.z1 <= H.z0 || b.z0 >= H.z1) { out.reject = '这张鲸图没盖到房子那块地方，不像是这栋房子。'; return out; }
    if (D) {
      const same3 = (a, c) => a.length === 3 && c.length === 3 && a.every((v, k) => (v | 0) === (c[k] | 0));
      if (!same3(Array.from(model.size), Array.from(D.size))) out.ask.push('大小不一样：原来的房子是 ' + D.size.join(' × ') + ' 格，这张是 ' + W + ' × ' + Hh + ' × ' + Lz + ' 格。');
      if (!same3(Array.from(model.offset), Array.from(D.offset))) out.ask.push('站立点不一样（Offset：原来 ' + Array.from(D.offset).join(', ') + '，这张 ' + Array.from(model.offset).join(', ') + '）。');
      // 原来房子里的原版方块（房子那一圈外墙以内，家具不算），有几成在这张图的同一格里还是同一种方块
      const dO = HB.originOf(D), [dW, dH, dL] = D.size, dId = D.palette.map((s) => (isAirS(s) ? null : idOf(s))), mId = model.palette.map((s) => (isAirS(s) ? null : idOf(s)));
      let tot = 0, hit = 0;
      for (let y = 0; y < dH; y++) for (let z = 0; z < dL; z++) for (let x = 0; x < dW; x++) {
        const wx = dO[0] + x, wy = dO[1] + y, wz = dO[2] + z, id = dId[D.cells[x + z * dW + y * dW * dL]];
        if (!id || !id.startsWith('minecraft:') || wx < H.x0 || wx >= H.x1 || wz < H.z0 || wz >= H.z1) continue;
        tot++;
        const mx = wx - o[0], my = wy - o[1], mz = wz - o[2];
        if (mx >= 0 && my >= 0 && mz >= 0 && mx < W && my < Hh && mz < Lz && mId[model.cells[mx + mz * W + my * W * Lz]] === id) hit++;
      }
      out.match = tot ? hit / tot : 1;
      if (out.match < 0.6) out.ask.push('房子本身只有 ' + Math.round(out.match * 100) + '% 的方块和原来的对得上（墙、地板、屋顶这些）。');
    }
    if (!m.xjy) out.ask.push('这张图里没有小鲸鱼之家模组写的信息（朝向、站立点），可能不是用 /xjy capture 抓的，会当成「面朝北、站在台阶前那一格」抓的来放。');
    const mods = deps.required.filter(k => k !== 'xiaojingyu');
    if (mods.length) out.notes.push('检测到已关联的模组（' + mods.join('、') + '）。网页不运行模组代码；未匹配材质的方块仍按近似颜色显示。');
    const FM = V3.furnMc, unknown = [...new Set(model.palette.map(idOf).filter((k) => k.startsWith('xiaojingyu:') && !(FM && FM.byBlock(k))))];
    if (unknown.length) out.notes.push('有 ' + unknown.length + ' 种小鲸鱼之家的方块网页还不认识（' + unknown.join('、') + '），可能画不出来。');
    // 相册、相框里的照片（docs/PHOTOS.md 第 1 节）：坏的不画，提一句
    const PH = V3.photos;
    if (PH && PH.albumTables) {
      let photos = 0, bad = 0;
      try {
        for (const t of PH.albumTables(model)) { const a = PH.albumAt(model, t.cell); photos += a.photos.length; bad += a.bad; }
        for (const fr of PH.frames(model)) { photos += fr.slots.filter(Boolean).length; bad += fr.bad.filter(Boolean).length; }
      } catch (e) { bad++; }
      out.photos = { photos, bad };
      if (bad) out.notes.push('有 ' + bad + ' 张照片坏了（不是 128 × 128 的 PNG，或者超过 48 KB），网页里不显示它们。');
    }
    out.same = !out.ask.length;
    return out;
  };

  // ---- 导入 / 恢复 ----
  const readError = (e, file) => {
    if (V3.share && e instanceof V3.share.ShareError) {
      let t = e.message;
      if (e.code === 'unknown_file' && /\.(jpe?g|webp|heic|gif|bmp)$/i.test(file || '')) t += '这是一张 ' + file.split('.').pop().toUpperCase() + ' 图片：聊天软件常把鲸图（PNG）转成别的格式，请让对方「发送原图」或者把图片当文件发。';
      return t;
    }
    return '读不出来：' + errText(e);
  };
  // src：File / Blob / Uint8Array / ArrayBuffer；opts：{ file（文件名）, force（「问一句」的也直接用） }
  // → { ok: true, stored, storeError, check, custom } / { ok: false, error } / { ok: false, ask: [..], check }（再调一次带 force: true 就换）
  HB.importFile = async (src, opts = {}) => {
    const file = opts.file || (src && src.name) || '';
    let bytes;
    try {
      bytes = typeof Blob !== 'undefined' && src instanceof Blob ? new Uint8Array(await src.arrayBuffer())
        : src instanceof ArrayBuffer ? new Uint8Array(src) : ArrayBuffer.isView(src) ? new Uint8Array(src.buffer, src.byteOffset, src.byteLength) : null;
    } catch (e) { return { ok: false, error: '文件读不出来：' + errText(e) }; }
    if (!bytes || !bytes.length) return { ok: false, error: '文件是空的。' };
    let model;
    try { model = await V3.share.read(bytes); } catch (e) { return { ok: false, error: readError(e, file) }; }
    try { await HB.load(); } catch (e) { /* 原来的房子读不出来：照样能换 */ }
    const check = HB.check(model, await HB.validateDependencies(model));
    if (check.reject) return { ok: false, error: check.reject, check };
    if (check.ask.length && !opts.force) return { ok: false, ask: check.ask.slice(), check };
    const custom = customOf({ file, at: Date.now() }, model);
    let stored = false, storeError = null;
    try {
      await HB.store.put({ v: 1, bytes: bytes.slice(), requiredMods: check.requiredMods, file, at: custom.at, name: custom.name, author: custom.author, date: custom.date });
      stored = true;
    } catch (e) { if (progress) return { ok: false, error: errText(e) }; storeError = errText(e); }
    HB.importError = null;
    setLocal(model, null, 'import', custom);
    await HB.rebuildScene();
    return { ok: true, stored, storeError, check, custom };
  };
  HB.restore = async () => {
    let cleared = true;
    try { await HB.store.clear(); } catch (e) { if (progress) throw e; cleared = false; }
    await HB.load();
    HB.importError = null;
    if (HB.isCustom() || !HB.isIdentity(HB.place)) { setLocal(HB.defaultModel, null, HB.defaultFrom, null); await HB.rebuildScene(); }
    return { ok: true, cleared };
  };
  // 换了房子：整个场景重建（方块网格、走路网格、剖开的楼层、灯光、家具上叠的东西都按新的方块来），时间、天气、楼层和镜头照旧。
  // opts.keepGirl：她留在原地（布置模式；不给 = 回到台阶前重新出场）；opts.girlAt = [x, z, yaw, y] 放到这里
  HB.rebuildScene = async (opts = {}) => {
    const cur = V3.models && V3.models.current && V3.models.current();
    if (!cur || cur.id !== 'house2' || !V3.R) return false;
    const st = V3.getState ? V3.getState() : {}, C = V3.R.ctl;
    const cam = C ? { az: C.g.az, el: C.g.el, dist: C.g.dist, target: C.g.target.toArray() } : null;
    const A = V3.actor, girl = opts.girlAt || (opts.keepGirl && A && A.pos ? [A.pos[0], A.pos[2], A.yaw, A.pos[1]] : null);
    V3.models.show('house2');
    for (const k of ['time', 'weather', 'floor']) if (st[k] != null) V3.setState(k, st[k]);
    if (cam) C.set(cam, false);
    if (girl && V3.actor && V3.actor.place) V3.actor.place(girl[0], girl[1], girl[2], girl[3]);
    if (V3.waitReady) await V3.waitReady(V3.models.current(), 30000);
    if (V3.emit) V3.emit('house:changed', HB.info);
    return true;
  };

  // ---- 布置模式（69-arrange）改了方块：换上新的模型（场景里的摆法），整个场景重建，她留在原地 ----
  // place：房子挪了 / 转了（{dx, dz, k}，model 已经是摆好的）；不给 = 不变
  HB.applyEdit = async (model, opts = {}) => {
    if (opts.place) { HB.place = Object.assign({}, opts.place); if (HB.applyLayoutPlace) HB.applyLayoutPlace(HB.place); }
    setModel(model, HB.from, HB.custom);
    if (opts.rebuild === false) return true;
    return HB.rebuildScene({ keepGirl: true, girlAt: opts.girlAt });
  };
  // 只换了方块实体（相册里的照片、相框换照片，docs/PHOTOS.md；68-album）：方块没变，场景、走路网格都不用重建。
  // model 是场景里的模型（和 HB.model 同一份方块，只是 blockEntities 不一样）；55-photo-frames 听 'house:entities' 重新贴照片
  HB.setEntities = (model) => {
    if (!HB.model || model.cells !== HB.model.cells && (model.cells.length !== HB.model.cells.length || model.palette.join('|') !== HB.model.palette.join('|'))) throw new Error('setEntities 只能换方块实体，方块不能变');
    HB.model = model;
    if (V3.emit) V3.emit('house:entities', HB.info);
    return true;
  };
  // 「完成」：布置过的房子存进浏览器（和导入的一样只留一份；下次打开还是它）。存的是房子自己方向的方块 + 摆在哪儿（place）
  HB.saveArranged = async ({ gallerySync = false } = {}) => {
    const local = HB.localModel(), m = metaOf(local), at = Date.now();
    const prev = HB.custom || {};
    const custom = { arranged: true, name: m.name || prev.name || '', author: m.author || prev.author || '', date: m.date || prev.date || null,
      file: prev.file || '', at, source: m.source || '', base: HB.from === 'import' ? 'import' : HB.from === 'arranged' ? prev.base || 'default' : 'default' };
    let stored = false, storeError = null;
    try {
      const requiredMods = dependencies(local).required;
      const bytes = await V3.share.writeSchem(HB.withDependencyMetadata(local, requiredMods));
      const previous = progress?.read('house');
      const galleryOnly = gallerySync && progress && (previous?.galleryOnly === true || (!previous && !progress.has('house')));
      await HB.store.put({ v: 2, kind: 'arranged', ...(galleryOnly ? { galleryOnly: true } : {}), bytes, requiredMods, file: custom.file, at, name: custom.name, author: custom.author, date: custom.date,
        base: custom.base, place: Object.assign({}, HB.place) });
      stored = true;
    } catch (e) { storeError = errText(e); }
    HB.from = 'arranged'; HB.custom = custom; HB.importError = null;
    if (HB.info) HB.info.from = 'arranged';
    redraw();
    return { ok: true, stored, storeError, custom };
  };

  // ---- 导出鲸图：房子自己的方向（Facing 北、Offset 和原来一样），放进 MC 的 xiaojingyu 文件夹，/xjy place 盖出来和网页里一样 ----
  // opts.image：鲸图上的图（PNG 字节或 dataURL，一般是现在的截图）；不给就用纯色小图。→ { bytes, name, model }
  const dataUrlBytes = (u) => b64bytes(String(u).replace(/^data:[^,]*,/, ''));
  HB.exportName = (t) => {
    const d = new Date(t || Date.now());
    return '小鲸鱼之家' + (HB.from === 'arranged' || (V3.arrange && V3.arrange.dirty && V3.arrange.dirty()) ? '-布置过' : '') + '-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.png';
  };
  HB.exportModel = (t) => {
    const local = HB.localModel(), N = V3.nbt, src = local.meta && local.meta.compound ? N.toJSON(local.meta) : null;
    const c = N.fromJSON(src && src.compound ? src : { compound: {} }).compound, m = metaOf(local);
    const arranged = HB.from === 'arranged' || !!(V3.arrange && V3.arrange.dirty && V3.arrange.dirty());
    const base = m.name || (HB.defaultModel && metaOf(HB.defaultModel).name) || '小鲸鱼之家 v4';
    c.Name = { string: arranged && !/网页里布置过/.test(base) ? base + '（网页里布置过）' : base };
    c.Author = { string: m.author || '' };
    c.Date = { long: String(Math.round(t || Date.now())) };
    const x = c.Xiaojingyu && c.Xiaojingyu.compound ? c.Xiaojingyu.compound : {};
    delete x.FromPlace;                                                       // 不再是「按上次 place 抓回来的原样」
    x.FormatVersion = { int: 1 };
    x.Facing = { string: m.facing || (HB.defaultModel && metaOf(HB.defaultModel).facing) || 'north' };
    if (!x.Origin) x.Origin = { intArray: Int32Array.from(HB.stand()) };
    x.Source = { string: V3.share.SOURCE };
    c.Xiaojingyu = { compound: x };
    return Object.assign({}, local, { meta: { compound: c }, blockEntities: (local.blockEntities || []).slice() });
  };
  HB.exportPng = async (opts = {}) => {
    const t = Date.now(), model = HB.exportModel(t);
    let image = opts.image || null;
    if (typeof image === 'string') image = dataUrlBytes(image);
    const bytes = await V3.share.writePng(model, image || undefined);
    return { bytes, name: HB.exportName(t), model };
  };
  // 界面上的「导出鲸图」：截一张现在的画面当鲸图上的图，下载
  HB.exportFromUI = async () => {
    let image = null;
    try { if (V3.R && V3.R.snapshot) image = V3.R.snapshot(480); } catch (e) { image = null; }
    const r = await HB.exportPng({ image });
    if (typeof document !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL && !window.__V3_NO_DOWNLOAD) {
      const url = URL.createObjectURL(new Blob([r.bytes], { type: 'image/png' })), a = U.el('a', { href: url, download: r.name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    toast('导出了「' + r.name + '」：放进 MC 的 xiaojingyu 文件夹，用 /xjy place 盖出来', false);
    return r;
  };

  // ---- 设置「房子」页：用哪栋房子（导入鲸图 / 恢复原来的房子）+ MC 贴图（选 jar / 忘掉）----
  V3.on && V3.on('init', () => {
    const G = V3.game;
    if (!G || !G.SCHEMA) return;
    if (!G.SCHEMA.some((f) => f.key === 'houseFile')) G.SCHEMA.push({ key: 'houseFile', label: '房子', type: 'custom', group: '房子', render: () => houseRow() });
    if (!G.SCHEMA.some((f) => f.key === 'mcInstance')) G.SCHEMA.push({ key: 'mcInstance', label: '关联 MC 实例', type: 'custom', group: '房子', render: () => instanceRow() });
  });
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtTime = (t) => { const d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  // 现在用的是哪张（设置里显示、测试也查）
  HB.describe = () => {
    if (HB.from === 'arranged' && HB.custom) {
      const c = HB.custom, bits = [];
      if (c.at) bits.push(fmtTime(c.at) + ' 布置');
      if (c.base === 'import') bits.push('在导入的房子上布置的');
      if (!HB.isIdentity(HB.place)) bits.push('房子挪过' + (HB.place.k ? '、转过' : ''));
      return '现在用的是布置过的房子：「' + (c.name || '小鲸鱼之家 v4') + '」' + (bits.length ? '（' + bits.join('，') + '）' : '') + '。';
    }
    if (HB.from === 'import' && HB.custom) {
      const c = HB.custom, bits = [];
      if (c.author) bits.push('作者 ' + c.author);
      if (c.date) bits.push(fmtTime(c.date) + ' 抓的');
      if (c.file) bits.push('文件 ' + c.file);
      if (c.at) bits.push(fmtTime(c.at) + ' 导入');
      return '现在用的是导入的房子：「' + (c.name || '（没写名字）') + '」' + (bits.length ? '（' + bits.join('，') + '）' : '') + '。';
    }
    const m = HB.defaultModel ? metaOf(HB.defaultModel) : {};
    return '现在用的是原来的房子：「' + (m.name || '小鲸鱼之家 v4') + '」' + (m.author ? '（作者 ' + m.author + '）' : '') + '。';
  };
  // 界面状态放在模块里：拖进页面导入时设置面板可能还没开，开了以后照样看得到结果 / 要问的话
  const UI = { msg: '', kind: '', ask: null, busy: false, draw: null };
  const redraw = () => { if (UI.draw) UI.draw(); };
  const toast = (t, bad) => { if (V3.hud && V3.hud.toast && V3.hud.mounted) V3.hud.toast(t, { color: bad ? '#ff8a8a' : '#6fc3f5', ms: bad ? 6000 : 3500 }); };
  HB.showMissingMods = (ids) => {
    const hud = V3.hud;
    if (!hud?.modal || typeof document === 'undefined') {
      if (typeof window.alert === 'function') window.alert(missingMessage(ids));
      return;
    }
    const close = U.el('button', { class: 'set-btn pri', type: 'button', onclick: () => hud.closeModal('house-missing-mods') }, '知道了');
    const card = U.el('div', { class: 'hud-card', role: 'alertdialog', 'aria-label': '缺少房屋模组', 'aria-modal': 'true' },
      U.el('div', { class: 'hud-card-head' }, U.el('span', { class: 'hud-card-title' }, '缺少房屋模组')),
      U.el('div', { class: 'hud-card-body' },
        U.el('p', null, '房屋没有替换。请先在关联的 MC 实例安装这些模组，然后刷新关联并重试：'),
        U.el('pre', { class: 'house-missing-mods', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, ids.join('\n')), close));
    hud.modal(card, { name: 'house-missing-mods' });
    close.focus();
  };
  const openPanel = () => { if (V3.settingsPanel && V3.settingsPanel.open && !(V3.settingsPanel.isOpen && V3.settingsPanel.isOpen())) V3.settingsPanel.open('房子'); else if (V3.settingsPanel && V3.settingsPanel.setTab) V3.settingsPanel.setTab('房子'); };
  // 界面上的导入（选文件、拖进页面）：结果写进 UI，设置面板没开时弹个提示，要问的打开面板问
  HB.importFromUI = async (src, opts = {}) => {
    if (UI.busy) return null;
    const file = opts.file || (src && src.name) || '';
    Object.assign(UI, { busy: true, ask: null, kind: 'busy', msg: '正在读「' + (file || '鲸图') + '」……' }); redraw();
    let r;
    try { r = await HB.importFile(src, opts); } catch (e) { r = { ok: false, error: '没换成：' + errText(e) }; V3.err('house import: ' + ((e && e.stack) || e)); }
    UI.busy = false;
    if (r.ok) {
      const n = r.check && r.check.notes.length ? r.check.notes.join('') : '';
      UI.kind = r.stored ? 'ok' : 'warn';
      UI.msg = '换好了。' + (r.stored ? '已经保存到小屋存档，下次打开还是它。' : '但存档失败（' + r.storeError + '），这次能用，下次打开会回到原来的房子。') + n;
      toast('房子换好了：「' + (r.custom.name || file) + '」', false);
    } else if (r.ask) {
      UI.kind = 'ask'; UI.msg = '这张鲸图和原来的房子不太一样，确定用它吗？';
      UI.ask = { lines: r.ask, go: () => HB.importFromUI(src, Object.assign({}, opts, { force: true, file })) };
      openPanel();
    } else {
      UI.kind = 'bad'; UI.msg = '没有换：' + r.error;
      if (r.check?.missingMods?.length) HB.showMissingMods(r.check.missingMods);
      else toast('没有换房子：' + r.error, true);
    }
    redraw();
    return r;
  };
  HB.ui = () => ({ msg: UI.msg, kind: UI.kind, ask: UI.ask ? UI.ask.lines.slice() : null, busy: UI.busy });
  HB.isHouseFile = (f) => !!f && (/\.(png|schem)$/i.test(f.name || '') || f.type === 'image/png');
  // 拖进页面：只拖了一个鲸图（.png / .schem）就当导入房子（29-ysmui 的拖放先问这里，YSM 模型照旧归它）
  HB.dropFiles = (files) => {
    const list = Array.from(files || []);
    if (list.length !== 1 || !HB.isHouseFile(list[0]) || V3.PAGE === 'studio' || !V3.game || !V3.game.SCHEMA) return false;   // 只在游戏页
    HB.importFromUI(list[0]);
    return true;
  };
  if (!V3.ysmUI && typeof addEventListener === 'function') {
    addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    addEventListener('drop', (e) => { if (e.dataTransfer && HB.dropFiles(e.dataTransfer.files)) e.preventDefault(); });
  }
  function houseRow() {
    const box = U.el('div', { class: 'set-row set-r-custom set-house' });
    const cur = U.el('div', { class: 'set-hint set-house-cur' });
    const msg = U.el('div', { class: 'set-house-msg' });
    const file = U.el('input', { type: 'file', accept: '.png,.schem,image/png', style: 'display:none' });
    const pick = U.el('label', { class: 'set-btn pri', title: '选一张鲸图（MC 里用 /xjy capture 抓回来的 PNG，也可以直接拖进页面）' }, '导入鲸图…', file);
    const back = U.el('button', { class: 'set-btn warn', type: 'button' }, '恢复原来的房子');
    const exp = U.el('button', { class: 'set-btn', type: 'button', 'data-key': 'houseExport', title: '把现在这栋房子存成一张鲸图（PNG），放进 MC 的 xiaojingyu 文件夹，用 /xjy place 盖出来' }, '导出鲸图');
    const btns = U.el('div', { class: 'set-house-btns' }, pick, exp, back);
    exp.addEventListener('click', async () => {
      Object.assign(UI, { busy: true, kind: 'busy', msg: '正在导出……', ask: null }); draw();
      try { const r = await HB.exportFromUI(); Object.assign(UI, { kind: 'ok', msg: '导出了「' + r.name + '」（在浏览器的下载文件夹里）。放进 MC 游戏目录的 xiaojingyu 文件夹（一般是 .minecraft/xiaojingyu；启动器开了版本隔离就是 .minecraft/versions/<版本>/xiaojingyu），站在要当「台阶前那一格」的地方、面朝要盖房子的方向，输入 /xjy place "' + r.name.replace(/\.png$/, '') + '"，盖出来和网页里一样。' }); }
      catch (e) { Object.assign(UI, { kind: 'bad', msg: '没导出来：' + errText(e) }); }
      UI.busy = false; draw();
    });
    let asking = false;
    file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) HB.importFromUI(f); });
    back.addEventListener('click', () => { asking = true; Object.assign(UI, { ask: null }); draw(); });
    const draw = () => {
      cur.textContent = HB.ready ? HB.describe() + (HB.importError ? ' ' + HB.importError : '') : '读取中…';
      back.disabled = UI.busy || !HB.isCustom() && HB.isIdentity(HB.place) && !HB.importError;
      exp.disabled = UI.busy || !HB.ready;
      pick.classList.toggle('off', UI.busy);
      msg.replaceChildren();
      msg.className = 'set-house-msg' + (UI.kind ? ' ' + UI.kind : '');
      if (asking) {
        msg.className = 'set-house-msg ask';
        const ok = U.el('button', { class: 'set-btn warn go', type: 'button', 'data-key': 'houseRestore', onclick: async () => {
          asking = false; Object.assign(UI, { busy: true, kind: 'busy', msg: '正在换回原来的房子……' }); draw();
          try { const r = await HB.restore(); Object.assign(UI, { kind: 'ok', msg: '换回原来的房子了。' + (r.cleared ? '' : '（小屋存档仍保留之前的房屋，下次打开可能又是它。）') }); toast('换回原来的房子了', false); }
          catch (e) { Object.assign(UI, { kind: 'bad', msg: '没换回去：' + errText(e) }); }
          UI.busy = false; draw();
        } }, '确定');
        msg.append(U.el('div', { class: 'set-house-q' }, '恢复原来的房子？' + (HB.from === 'arranged' ? '布置过的那栋' : '导入的那张') + '会从当前小屋存档里删掉（你电脑上的鲸图文件不动）。相册里的照片和挂画也会一起清掉；画册同步的那些画下次打开会自动补回来。'), U.el('div', { class: 'set-house-a' }, ok,
          U.el('button', { class: 'set-btn', type: 'button', onclick: () => { asking = false; draw(); } }, '取消')));
        return;
      }
      if (UI.msg) msg.append(U.el('div', { class: 'set-house-q' }, UI.msg));
      if (UI.ask) {
        msg.append(U.el('ul', { class: 'set-house-list' }, UI.ask.lines.map((t) => U.el('li', null, t))), U.el('div', { class: 'set-house-a' },
          U.el('button', { class: 'set-btn pri', type: 'button', 'data-key': 'houseForce', onclick: () => { const go = UI.ask && UI.ask.go; UI.ask = null; if (go) go(); } }, '还是用它'),
          U.el('button', { class: 'set-btn', type: 'button', onclick: () => { Object.assign(UI, { ask: null, kind: '', msg: '' }); draw(); } }, '不用了')));
      }
    };
    UI.draw = draw;
    if (HB.ready) HB.ready.then(draw, draw);
    box.append(U.el('span', { class: 'set-label' }, '用哪栋房子'), btns, cur, msg,
      U.el('div', { class: 'set-hint' }, '在 MC 里改好房子，用 /xjy capture 抓回来，把那张鲸图导入（或者直接拖进页面），游戏里的房子就换成它。也可以在游戏里点左下角「布置」直接挪家具。布置会随小屋存档保存。「导出鲸图」可以把网页里的房子带回 MC。'));
    draw();
    return box;
  }
  function instanceRow() {
    const api = V3.mcInstance;
    const box = U.el('div', { class: 'set-row set-r-custom' });
    const status = U.el('div', { class: 'set-hint', role: 'status' }, '正在查看关联状态……');
    const describe = (rec) => {
      status.textContent = rec ? '已关联「' + rec.name + '」：识别到 ' + rec.modIds.size + ' 个 Mod ID，' + rec.layers.length + ' 个已启用资源包。'
        + (rec.layers.length ? '' : ' 没有可读取的启用包，将使用默认纹理。')
        : '尚未关联或浏览器未授权。当前使用默认纹理。';
    };
    const run = async (fn) => {
      try { const result = await fn(); describe(result); await HB.reloadTextures(); }
      catch (e) { if (e?.name !== 'AbortError') status.textContent = '关联操作未完成：' + errText(e); }
    };
    const select = U.el('button', { class: 'set-btn pri', type: 'button', disabled: !api || typeof window.showDirectoryPicker !== 'function', onclick: () => run(async () => {
      const dir = await window.showDirectoryPicker({ id: 'cabin-minecraft', mode: 'read' });
      return api.bind(dir);
    }) }, '关联 MC 游戏目录…');
    const refresh = U.el('button', { class: 'set-btn', type: 'button', disabled: !api, onclick: () => run(() => api.refresh({ requestPermission: true })) }, '重新读取／授权');
    const forget = U.el('button', { class: 'set-btn', type: 'button', disabled: !api, onclick: () => run(async () => { await api.forget(); return null; }) }, '解除关联');
    box.append(U.el('span', { class: 'set-label' }, '关联 MC 实例'), U.el('div', { class: 'set-house-btns' }, select, refresh, forget), status,
      U.el('div', { class: 'set-hint' }, '请选择包含 options.txt、resourcepacks 或 mods 的游戏目录（启用版本隔离时选该版本的实例目录）。仅本机只读，不上传文件；在 MC 里变更资源包后可点「重新读取」。' + (select.disabled ? ' 这个浏览器不支持关联目录，请用本机 Chromium/Edge 打开。' : '')));
    if (api) void api.current().then(describe, () => describe(null)); else describe(null);
    return box;
  }
})(window.V3);
