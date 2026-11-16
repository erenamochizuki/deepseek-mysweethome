// 43-house-mc-model.js — 工作台 3D 模型「小屋 v4 方块草图」：把 V3.houseMc（42-house-mc.js）给的方块房子按 MC 方块画出来
// 贴图：V3.mcjar.cacheLoad()（玩家在「MC 方块查看」页选过一次 jar 就有，同一个网址共用）；没有就用 17-mcfallback 的颜色。
// 42 还没好时用这里的 H.fakeHouse() 顶着（照同一个接口）。坐标：+x 东、+y 上、+z 南（海）；场景 y=0 = 沙面；1 格 = 1 米。
(function (V3) {
  'use strict';
  const H = V3.houseMcModel = {};
  const ROOT = '方块小屋';
  H.ROOT = ROOT;

  // ---- 假房子：只在 V3.houseMc 不在时用；接口和 42 一样（model / parts / labels / levels / anchors / furniture / info）----
  const mc = (n) => 'minecraft:' + n;
  const FULL = /(_planks|_concrete|_bricks|_log)$/;
  H.fakeHouse = function (variant) {
    const b = variant === 'b';
    const ow = b ? 13 : 12, od = b ? 9 : 8;          // 外墙宽 × 深（含墙，1 格厚）
    const W = ow + 2, L = od + 4, HH = 11;             // 东西、北各出檐 1；南边门廊 2 + 台阶 1
    const grid = new Array(W * L * HH).fill(null), part = new Array(W * L * HH).fill(null);
    const inside = (x, y, z) => x >= 0 && z >= 0 && y >= 0 && x < W && z < L && y < HH;
    const id = (x, y, z) => x + z * W + y * W * L;
    const put = (x, y, z, s, p) => { if (inside(x, y, z)) { grid[id(x, y, z)] = s; part[id(x, y, z)] = s ? p : null; } };
    const get = (x, y, z) => (inside(x, y, z) ? grid[id(x, y, z)] : null);
    const stairs = (n, f) => mc(`${n}[facing=${f},half=bottom,shape=straight,waterlogged=false]`);
    const slab = mc('spruce_slab[type=bottom,waterlogged=false]');
    // 地面一层（格子 y=0 占场景 0..1）：墙下石砖地基、屋里橡木地板、门廊云杉木板、门前一级台阶
    for (let x = 1; x <= ow; x++) for (let z = 1; z <= od; z++) {
      const edge = x === 1 || x === ow || z === 1 || z === od;
      put(x, 0, z, mc(edge ? 'stone_bricks' : 'oak_planks'), edge ? '地基' : '地板/一楼');
    }
    for (let x = 0; x < W; x++) for (let z = od + 1; z <= od + 2; z++) put(x, 0, z, mc('spruce_planks'), '门廊/地板');
    const doorX = 4;
    for (const x of [doorX, doorX + 1]) put(x, 0, od + 3, stairs('oak_stairs', 'north'), '门廊/台阶');
    // 墙：y=1..3 白混凝土 + 去皮橡木角柱；y=4 一圈横梁（也是阁楼的矮墙）
    const side = (x, z) => (z === od ? '墙/南墙' : z === 1 ? '墙/北墙' : x === 1 ? '墙/西墙' : '墙/东墙');
    for (let y = 1; y <= 4; y++) for (let x = 1; x <= ow; x++) for (let z = 1; z <= od; z++) {
      if (!(x === 1 || x === ow || z === 1 || z === od)) continue;
      const corner = (x === 1 || x === ow) && (z === 1 || z === od);
      if (corner) put(x, y, z, mc('stripped_oak_log[axis=y]'), '墙/柱子');
      else if (y === 4) put(x, y, z, mc(`stripped_oak_log[axis=${z === 1 || z === od ? 'x' : 'z'}]`), '墙/横梁');
      else put(x, y, z, mc('white_concrete'), side(x, z));
    }
    // 门、窗（窗 1 格高，在 y=2）
    put(doorX, 1, od, mc('oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]'), '门窗/门');
    put(doorX, 2, od, mc('oak_door[facing=north,half=upper,hinge=left,open=false,powered=false]'), '门窗/门');
    const zm = [Math.floor((od + 1) / 2), Math.ceil((od + 1) / 2)];
    for (const x of [2, 3, ow - 3, ow - 2]) put(x, 2, od, mc('glass_pane'), '门窗/窗');
    for (const x of [3, 4, ow - 4, ow - 3]) put(x, 2, 1, mc('glass_pane'), '门窗/窗');
    for (const z of zm) { put(1, 2, z, mc('glass_pane'), '门窗/窗'); put(ow, 2, z, mc('glass_pane'), '门窗/窗'); }
    // 阁楼地板（y=4）+ 楼梯（沿北墙往西爬）+ 楼梯口
    for (let x = 2; x < ow; x++) for (let z = 2; z < od; z++) put(x, 4, z, mc('oak_planks'), '地板/阁楼');
    for (let j = 0; j < 4; j++) put(ow - 1 - j, 1 + j, 2, stairs('oak_stairs', 'west'), '楼梯');
    for (let x = ow - 3; x <= ow - 1; x++) put(x, 4, 2, null, null);
    // 屋顶：45° 云杉楼梯，屋脊沿 x；两头山墙白混凝土，中间一扇小窗
    let k = 0;
    for (; k < od + 1 - k; k++) for (let x = 0; x < W; x++) {
      put(x, 4 + k, k, stairs('spruce_stairs', 'south'), '屋顶/北坡');
      put(x, 4 + k, od + 1 - k, stairs('spruce_stairs', 'north'), '屋顶/南坡');
    }
    for (let x = 0; x < W; x++) {
      if (k === od + 1 - k) { put(x, 3 + k, k, mc('spruce_planks'), '屋顶/屋脊'); put(x, 4 + k, k, slab, '屋顶/屋脊'); }
      else { put(x, 4 + k, k - 1, slab, '屋顶/屋脊'); put(x, 4 + k, k, slab, '屋顶/屋脊'); }
    }
    for (let y = 5; y < 4 + k; y++) for (let z = y - 3; z <= od - (y - 4); z++) for (const x of [1, ow]) {
      const win = y === 6 && zm.includes(z);
      put(x, y, z, mc(win ? 'glass_pane' : 'white_concrete'), win ? '门窗/窗' : x === 1 ? '墙/西山墙' : '墙/东山墙');
    }
    // 门廊栏杆（南边留出台阶口；东西两头各 2 格）
    for (let x = 0; x < W; x++) if (x !== doorX && x !== doorX + 1) put(x, 1, od + 2, mc('oak_fence'), '门廊/栏杆');
    for (const x of [0, W - 1]) put(x, 1, od + 1, mc('oak_fence'), '门廊/栏杆');
    // 栅栏、玻璃板的连接（和同类、整块的方块连）
    const base = (s) => s && s.replace(/\[.*$/, '');
    for (let i = 0; i < grid.length; i++) {
      const s = grid[i];
      if (s !== mc('oak_fence') && s !== mc('glass_pane')) continue;
      const x = i % W, z = Math.floor(i / W) % L, y = Math.floor(i / (W * L));
      const c = (dx, dz) => { const n = base(get(x + dx, y, z + dz)); return !!n && (n === s || FULL.test(n)); };
      grid[i] = `${s}[east=${c(1, 0)},north=${c(0, -1)},south=${c(0, 1)},waterlogged=false,west=${c(-1, 0)}]`;
    }
    const palette = [mc('air')], pidx = new Map([[mc('air'), 0]]), cells = new Int32Array(grid.length);
    for (let i = 0; i < grid.length; i++) {
      const s = grid[i]; if (!s) continue;
      let n = pidx.get(s);
      if (n == null) { n = palette.length; palette.push(s); pidx.set(s, n); }
      cells[i] = n;
    }
    // 格子 (0,0,0) 在场景 (-7, 0, -(od+7))：南墙固定在场景 z -7..-6，房子往北、往东长；站立点 = 台阶前一格
    const origin = [-3, 0, -3], cell0 = [-7, 0, -(od + 7)];
    const offset = [cell0[0] - origin[0], cell0[1] - origin[1], cell0[2] - origin[2]];
    const meta = { compound: {
      Name: { string: `小鲸鱼之家 v4 草图 ${b ? 'B' : 'A'}（假数据）` }, Author: { string: 'Moci' },
      Xiaojingyu: { compound: { Facing: { string: 'north' }, Origin: { intArray: Int32Array.from(origin) }, Source: { string: 'haibian-web/4.0.0-dev' } } },
    } };
    const sz = -(od + 7);
    return {
      model: { size: [W, HH, L], offset, dataVersion: 4790, meta, palette, cells, blockEntities: [], warnings: [] },
      parts: part,
      labels: { 墙: '墙', 地基: '地基', 地板: '地板', 屋顶: '屋顶', 门窗: '门和窗', 门廊: '门廊', 楼梯: '室内楼梯' },
      levels: [{ id: 'ground', label: '一楼', y0: 0, y1: 3 }, { id: 'loft', label: '阁楼', y0: 4, y1: 6 }],
      anchors: { door: [doorX - 7 + 0.5, 1, -6.5] },
      furniture: [
        { id: 'bed', label: '床', box: [-5, 1, sz + 2, -3, 1.6, sz + 4], level: 'ground' },
        { id: 'table', label: '桌子', box: [-1, 1, sz + 5, 1, 1.8, sz + 6], level: 'ground' },
        { id: 'sofa', label: '阁楼沙发', box: [-4, 5, sz + 5, -2, 5.7, sz + 6], level: 'loft' },
      ],
      info: { variant: b ? 'b' : 'a', outer: [ow, od], inner: [ow - 2, od - 2], fake: true, note: '假数据（42-house-mc.js 还没好）' },
    };
  };
  H.FAKE_VARIANTS = [{ id: 'a', label: 'A：外墙 12×8' }, { id: 'b', label: 'B：外墙 13×9' }];

  // ---- 楼层：选了某一层，就把这一层 y1 以上的格子换成空气（levels 的 y0..y1 是格子的 y，两头都算）；'all' = 整栋 ----
  H.cutY = function (levels, floor) {
    if (!floor || floor === 'all') return Infinity;
    const lv = (levels || []).find((l) => l.id === floor);
    return lv ? lv.y1 : Infinity;
  };
  H.cutModel = function (model, maxY) {
    if (!isFinite(maxY)) return model;
    const [W, , L] = model.size, n = W * L;
    const palette = model.palette.slice();
    let air = palette.findIndex((s) => /^(minecraft:)?(air|cave_air|void_air)$/.test(s));
    if (air < 0) { air = palette.length; palette.push('minecraft:air'); }
    const cells = Int32Array.from(model.cells);
    for (let i = Math.max(0, (maxY + 1) * n); i < cells.length; i++) cells[i] = air;
    return Object.assign({}, model, { palette, cells });
  };

  // ---- 把 mcmesh 的结果按部件拆开：面中心往面里退一点落在哪一格，那一格的 parts[i] 就是它的部件（没有 = ''）----
  // 返回 Map(部件 → {solid, cutout, entity, translucent})，每层和 mcmesh 的层一样 {position, uv, color, index, centers, quads}
  const LAYERS = ['solid', 'cutout', 'entity', 'translucent'];
  H.LAYERS = LAYERS;
  const sub = (Ly, ids) => {
    const n = ids.length, pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), col = new Float32Array(n * 12), ctr = new Float32Array(n * 3), cel = new Int32Array(n * 3);
    const index = n * 4 > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
    ids.forEach((q, i) => {
      pos.set(Ly.position.subarray(q * 12, q * 12 + 12), i * 12);
      uv.set(Ly.uv.subarray(q * 8, q * 8 + 8), i * 8);
      col.set(Ly.color.subarray(q * 12, q * 12 + 12), i * 12);
      if (Ly.centers) ctr.set(Ly.centers.subarray(q * 3, q * 3 + 3), i * 3);
      if (Ly.cells) cel.set(Ly.cells.subarray(q * 3, q * 3 + 3), i * 3);
      const v = i * 4, o = i * 6;
      index[o] = v; index[o + 1] = v + 1; index[o + 2] = v + 2; index[o + 3] = v; index[o + 4] = v + 2; index[o + 5] = v + 3;
    });
    return { position: pos, uv, color: col, index, centers: ctr, cells: Ly.cells ? cel : undefined, quads: n };
  };
  // 这个面归哪一格：mcmesh 记了出这个面的方块（cells）就用它，伸出格子的模型也归自己那格；没记的按面的位置算
  H.quadCell = (Ly, q) => (Ly.cells ? [Ly.cells[q * 3], Ly.cells[q * 3 + 1], Ly.cells[q * 3 + 2]] : H.cellOfQuad(Ly.position, q));
  H.cellOfQuad = function (P, q) {   // 一个面属于哪一格（格子坐标，可能出界）
    const o = q * 12;
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < 4; v++) { cx += P[o + v * 3]; cy += P[o + v * 3 + 1]; cz += P[o + v * 3 + 2]; }
    const ax = P[o + 3] - P[o], ay = P[o + 4] - P[o + 1], az = P[o + 5] - P[o + 2];
    const bx = P[o + 6] - P[o], by = P[o + 7] - P[o + 1], bz = P[o + 8] - P[o + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, k = 0.01 / (Math.hypot(nx, ny, nz) || Infinity);
    return [Math.floor(cx / 4 - nx * k), Math.floor(cy / 4 - ny * k), Math.floor(cz / 4 - nz * k)];
  };
  H.splitByPart = function (res, parts) {
    const [W, Hh, L] = res.size, groups = new Map();
    for (const k of LAYERS) {
      const Ly = res.layers[k];
      if (!Ly || !Ly.quads) continue;
      for (let q = 0; q < Ly.quads; q++) {
        const [x, y, z] = H.quadCell(Ly, q);
        const inb = x >= 0 && y >= 0 && z >= 0 && x < W && y < Hh && z < L;
        const p = (inb && parts && parts[x + z * W + y * W * L]) || '';
        let g = groups.get(p);
        if (!g) groups.set(p, (g = {}));
        (g[k] || (g[k] = [])).push(q);
      }
    }
    const out = new Map();
    for (const [p, g] of groups) { const e = {}; for (const k in g) e[k] = sub(res.layers[k], g[k]); out.set(p, e); }
    return out;
  };

  // ---- three.js：整栋一张贴图 + 一套材质（18-mcthree），每个部件一个 Group，下面每层一个 Mesh ----
  const ORDER = { solid: 1, cutout: 2, entity: 3, translucent: 4 };
  H.meshes = function (res, parts, opts = {}) {
    const T3 = V3.mcthree, tex = T3.atlasTexture(res.atlas, opts);
    const mats = T3.materials(tex, { bright: opts.bright, fog: null });
    const root = new THREE.Group(), groups = [];
    root.name = 'housemc-blocks';
    for (const [p, e] of H.splitByPart(res, parts)) {
      const g = new THREE.Group();
      g.name = p || '其他';
      for (const k of LAYERS) {
        const Ly = e[k];
        if (!Ly || !Ly.quads) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(Ly.position, 3));
        geo.setAttribute('mcuv', new THREE.BufferAttribute(Ly.uv, 2));
        geo.setAttribute('mccol', new THREE.BufferAttribute(Ly.color, 3));
        geo.setIndex(new THREE.BufferAttribute(Ly.index, 1));
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, mats[k]);
        m.name = k; m.renderOrder = ORDER[k];
        if (k === 'translucent') { m.userData.layer = Ly; m.onBeforeRender = (r, s, cam) => T3.sortTranslucent(m, cam); }
        g.add(m);
      }
      root.add(g); groups.push([g, p]);
    }
    root.userData = { tex, mats };
    return { root, groups };
  };
  H.furniture = function (list) {   // 家具只是占位盒子（半透明 + 描边），不在鲸图里
    const root = new THREE.Group(), items = [];
    root.name = 'housemc-furniture';
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2a65a, transparent: true, opacity: 0.45, depthWrite: false });
    const line = new THREE.LineBasicMaterial({ color: 0x8a4b12 });
    for (const f of list || []) {
      const [x0, y0, z0, x1, y1, z1] = f.box;
      const geo = new THREE.BoxGeometry(Math.abs(x1 - x0) || 0.05, Math.abs(y1 - y0) || 0.05, Math.abs(z1 - z0) || 0.05);
      const m = new THREE.Mesh(geo, mat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.name = f.label || f.id;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), line);
      edges.userData.noPick = true;
      m.add(edges); root.add(m); items.push([m, f]);
    }
    root.userData = { mats: { mat, line } };
    return { root, items };
  };
  H.disposeTree = function (root) {
    root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    const u = root.userData || {};
    for (const m of Object.values(u.mats || {})) m.dispose();
    if (u.tex) u.tex.dispose();
  };

  // ---- 数据来源：42 好了（有 V3.houseMc.build）用它，没好用假房子；方案名单和数据要来自同一边 ----
  H.real = () => !!(V3.houseMc && typeof V3.houseMc.build === 'function');
  H.variants = () => (H.real() && V3.houseMc.variants && V3.houseMc.variants.length ? V3.houseMc.variants : H.FAKE_VARIANTS);
  // 材料小样：42 的 V3.houseMc.roofs / walls = [{id,label}…]，有才出这两个开关
  H.materials = () => (H.real() ? { roof: V3.houseMc.roofs || [], wall: V3.houseMc.walls || [] } : {});
  // 开关的初始值：42 的 V3.houseMc.DEFAULTS（定稿：方案 b、两色屋顶、平滑石英）；没有或者不在名单里就用名单第一个
  H.defaults = () => (H.real() && V3.houseMc.DEFAULTS) || {};
  const pick = (list, want) => (list.some((o) => o.id === want) ? want : list[0].id);
  H.data = async (variant, mat = {}) => (H.real() ? V3.houseMc.build(Object.assign({ variant }, mat)) : H.fakeHouse(variant));
  H.HINT = '还没有 MC 贴图：去「MC 方块查看」页（mcview.html）选一次 Minecraft 客户端 jar，这里就会用真贴图；现在先用我们自己的颜色。';
  let jarPack = null;   // 找到过一次就留着（同一个 jar 的贴图解码也缓存在它身上）
  H.jarPack = async () => {
    if (jarPack) return jarPack;
    try { jarPack = V3.mcjar && V3.mcjar.cacheLoad ? await V3.mcjar.cacheLoad() : null; } catch (e) { jarPack = null; }
    return jarPack;
  };
  let hintShown = false;

  // 视角照 house2（50-scene.js），方便来回比
  const VIEWS = {
    hero: { az: 0.58, el: 0.42, dist: 43, target: [3.5, 2.4, 1.0] },
    house: { az: 0.55, el: 0.45, dist: 24, target: [0, 3.5, -9] },
    inside: { az: 0.6, el: 0.75, dist: 17, target: [0, 1.5, -10] },
    loft: { az: 0.6, el: 0.8, dist: 17, target: [0, 4, -10] },
    top: { az: 0, el: 1.45, dist: 30, target: [0, 1, -10] },
    site: { az: 0.3, el: 0.9, dist: 85, target: [0, 0, 6] },
  };

  function build() {
    const root = new THREE.Group();
    root.name = 'housemc';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 50), new THREE.MeshBasicMaterial({ color: 0xe8d6a8 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, -6);
    ground.userData.noPick = true; ground.name = '沙地（示意）';
    root.add(ground);
    let seq = 0, blocks = null, furn = null, data = null, dataKey = null;
    const vs = H.variants(), mats = H.materials(), def = H.defaults();
    const matState = (k, label) => (mats[k] && mats[k].length ? { [k]: { label, options: mats[k].map((o) => [o.id, o.label || o.id]), value: pick(mats[k], def[k]) } } : {});
    const inst = {
      id: 'housemc', label: '小屋 v4 方块草图', root, partRoot: ROOT,
      stage: { pedestal: false, size: 34, center: [0, 2, -4] },
      // 键名不用 variant：那是 56-furn-ground.js 的视角口令（V3.viewTokens.variant），反馈里存的视角会被它抢走
      states: Object.assign({
        plan: { label: '方案', options: vs.map((v) => [v.id, v.label || v.id]), value: pick(vs, def.variant) },
      }, matState('roof', '屋顶'), matState('wall', '墙面'), {
        floor: { label: '楼层', options: [['all', '外观'], ['ground', '一楼'], ['loft', '阁楼']], value: 'all' },
        furniture: { label: '家具', options: [['on', '显示占位盒子'], ['off', '不显示']], value: 'on' },
        tex: { label: '贴图', options: [['mc', 'MC 贴图（要先选过 jar）'], ['own', '我们自己的颜色']], value: 'mc' },
      }),
      views: VIEWS,
      ready: null, stats: null, error: null, hint: null, packUsed: null, builds: 0,
      setState(k, v) {
        if (!this.states[k]) return;
        this.states[k].value = v;
        if (k === 'furniture') applyFurniture();
        else this.ready = rebuild();
      },
      update() {},
      info() {
        return {
          variant: this.states.plan.value, roof: this.states.roof ? this.states.roof.value : null, wall: this.states.wall ? this.states.wall.value : null,
          floor: this.states.floor.value, furniture: this.states.furniture.value, tex: this.states.tex.value,
          fake: !!(data && data.info && data.info.fake), source: H.real() ? '42-house-mc' : 'fake', pack: this.packUsed, hint: this.hint, error: this.error,
          builds: this.builds, size: data && data.model.size, groups: blocks ? blocks.groups.map((g) => g[1]) : [],
          furnitureItems: furn ? furn.items.length : 0, furnitureShown: furn ? furn.items.filter(([m]) => m.visible).length : 0, stats: this.stats,
        };
      },
      dispose() { seq++; clear(); ground.geometry.dispose(); ground.material.dispose(); },
    };
    const clear = () => {
      for (const t of [blocks, furn]) if (t) { root.remove(t.root); H.disposeTree(t.root); }
      blocks = furn = null;
    };
    const toast = (m) => { if (V3.fb && V3.fb.toast) V3.fb.toast(m, '', 8000); else console.log(m); };
    function applyFurniture() {
      if (!furn) return;
      const on = inst.states.furniture.value === 'on', fl = inst.states.floor.value;
      const ids = (data.levels || []).map((l) => l.id), cut = fl === 'all' ? Infinity : ids.indexOf(fl);
      for (const [m, f] of furn.items) {
        const li = ids.indexOf(f.level);
        m.visible = on && (cut < 0 || li < 0 || li <= cut);
      }
    }
    function tagAll() {
      V3.parts.reset(ROOT);
      const labels = data.labels || {}, full = {}, paths = [];
      const add = (p) => { const fp = p ? ROOT + '/' + p : ROOT + '/其他'; if (!paths.includes(fp)) paths.push(fp); return fp; };
      for (const p of data.parts || []) if (p) add(p);
      for (const [, p] of blocks.groups) add(p);
      for (const [, f] of furn.items) add('家具/' + (f.label || f.id));
      for (const fp of paths) {
        const segs = fp.split('/');
        for (let i = 2; i <= segs.length; i++) { const sp = segs.slice(1, i).join('/'); full[segs.slice(0, i).join('/')] = labels[sp] || segs[i - 1]; }
      }
      full[ROOT] = '小屋 v4 方块草图'; full[ROOT + '/家具'] = '家具（占位）';
      for (const [, f] of furn.items) if (f.note) full[ROOT + '/家具/' + (f.label || f.id)] = (f.label || f.id) + '（' + f.note + '）';   // 42 给的说明（挪了、改小了）带在名字后面
      V3.parts.declare([ROOT, ...paths], full);
      for (const [g, p] of blocks.groups) V3.parts.tag(g, p ? ROOT + '/' + p : ROOT + '/其他');
      for (const [m, f] of furn.items) V3.parts.tag(m, ROOT + '/家具/' + (f.label || f.id));
    }
    async function rebuild() {
      const my = ++seq, st = inst.states;
      try {
        const mat = {}, key = [st.plan.value, st.roof && st.roof.value, st.wall && st.wall.value].join('|');
        if (st.roof) mat.roof = st.roof.value;
        if (st.wall) mat.wall = st.wall.value;
        if (dataKey !== key || !data) { const d = await H.data(st.plan.value, mat); if (my !== seq) return inst.info(); data = d; dataKey = key; }
        const cut = H.cutModel(data.model, H.cutY(data.levels, st.floor.value));
        const jar = st.tex.value === 'mc' ? await H.jarPack() : null;
        // P5：模组家具的资源（54-house-mc 打包的）盖在玩家的 jar 上一起画；没有 jar 时家具照样用模型，原版方块用近似颜色
        if (V3.houseBlocks && V3.houseBlocks.modPackReady) await V3.houseBlocks.modPackReady();
        const pack = V3.houseBlocks && V3.houseBlocks.renderPack ? V3.houseBlocks.renderPack(jar) : jar;
        const res = await V3.mcmesh.build(cut, { pack, ao: true, light: true, mipmaps: true });
        if (my !== seq) return inst.info();
        clear();
        blocks = H.meshes(res, data.parts);
        blocks.root.position.fromArray(V3.mcmesh.worldOrigin(data.model) || [0, 0, 0]);
        furn = H.furniture(data.furniture);
        root.add(blocks.root, furn.root);
        applyFurniture(); tagAll();
        inst.packUsed = jar ? jar.key : null;
        inst.hint = st.tex.value === 'mc' && !jar ? H.HINT : null;
        if (inst.hint && !hintShown) { hintShown = true; toast(inst.hint); }
        inst.stats = { blocks: res.stats.blocks, quads: res.stats.quads, fallback: res.stats.fallback, ms: res.stats.ms, warnings: res.warnings.length };
        inst.error = null; inst.builds++;
        V3.emit('parts-changed');
      } catch (e) {
        inst.error = String((e && e.message) || e);
        V3.err('housemc: ' + ((e && e.stack) || e));
      }
      return inst.info();
    }
    inst.ready = rebuild();
    return inst;
  }
  V3.models.register({ id: 'housemc', label: '小屋 v4 方块草图', build });
})(window.V3);
