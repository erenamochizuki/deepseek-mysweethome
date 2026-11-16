// 05-blocks.js — V3.blocks：方块注册表 + 体素网格化（移植自 v1 的 03-voxel.js；去掉光照体积，改为按 tag 分组输出）。Owner: engine。
// 形状 cube / slab / stairs / pane / fence / cross / carpet / layer（+ def.box 小盒子）；相邻不透明面剔除；顶点色 = AO × tint（线性）。
// UV 按世界坐标连续：tileCells 格一张贴图（0.25 m 格 + tileCells 2 → 16 px = 0.5 m）。输出格式同 src/03-vox.js（faceTags / triTag / anchor / part）。
(function (V3) {
  'use strict';
  const SHAPES = { cube: 1, slab: 1, stairs: 1, pane: 1, fence: 1, cross: 1, carpet: 1, layer: 1 };
  const KINDS = ['opaque', 'cutout', 'glass'], FK = ['e', 'w', 'top', 'bottom', 's', 'n']; // 面 0 +x 东, 1 -x 西, 2 +y, 3 -y, 4 +z 南, 5 -z 北
  const defs = [null], byName = new Map(), warned = Object.create(null);
  const warn = (k, s) => { if (!warned[k]) { warned[k] = 1; console.warn('V3.blocks: ' + s); } };
  function faceTiles(name, t) {
    if (!t || typeof t === 'string') { const a = t || name; return { e: a, w: a, top: a, bottom: a, s: a, n: a }; }
    const side = t.side || t.all || name, top = t.top || t.end || t.all || side, bottom = t.bottom || t.end || t.all || top;
    return { e: t.e || side, w: t.w || side, top, bottom, s: t.s || side, n: t.n || side };
  }
  // def(name, { tiles, shape, opaque, tint, glass, cutout, leaves, axis, box: [x0,y0,z0,x1,y1,z1]（1/16 格）, uv: 'world'|'cell' })
  function def(name, o = {}) {
    if (!name || name === 'air') return 0;
    const shape = SHAPES[o.shape] ? o.shape : 'cube', glass = !!o.glass, leaves = !!o.leaves;
    const cutout = !glass && (!!o.cutout || leaves || shape === 'cross'), box = o.box ? o.box.map(v => v / 16) : null;
    const tc = new THREE.Color(1, 1, 1); if (o.tint != null) tc.setHex(o.tint);
    const d = { name, shape, tilesIn: o.tiles, tiles: faceTiles(name, o.tiles), glass, cutout, leaves, axis: !!o.axis, box,
      uvCell: o.uv === 'cell' || shape === 'cross', tint: o.tint != null ? o.tint : null, tc: [tc.r, tc.g, tc.b],
      kind: glass ? 2 : cutout ? 1 : 0, uvs: null, uvN: -1 };
    d.opaque = shape === 'cube' && !box && o.opaque !== false && !glass && !cutout;
    d.occ = d.opaque || leaves;
    let id = byName.get(name);
    if (id === undefined) { id = defs.length; if (id > 65535) { V3.err('blocks.def: too many blocks'); return 0; } }
    d.id = id; defs[id] = d; byName.set(name, id);
    return id;
  }
  // 名字 → id；'plaster.slab' / opts.shape 自动生成形状变体；图集里有的贴图名自动成为同名方块
  function rid(name, shape) {
    if (name == null || name === 0 || name === '' || name === 'air') return 0;
    if (typeof name === 'number') return defs[name] ? name : -1;
    const key = shape && shape !== 'cube' ? name + '.' + shape : String(name);
    const id = byName.get(key); if (id !== undefined) return id;
    const dot = key.lastIndexOf('.');
    if (dot > 0) {
      const sh = key.slice(dot + 1), b = rid(key.slice(0, dot));
      if (b > 0 && SHAPES[sh]) { const e = defs[b];
        return def(key, { tiles: e.tilesIn || e.name, shape: sh, glass: e.glass, cutout: e.cutout && !e.leaves && e.shape !== 'cross', tint: e.tint, axis: e.axis }); }
    } else if (V3.atlas.has(key)) return def(key, { tiles: key });
    warn(key, 'unknown block ' + key); return -1;
  }
  const uvsOf = d => { const n = V3.atlas.names.length; if (d.uvN !== n) { d.uvs = FK.map(k => V3.atlas.uv(d.tiles[k])); d.uvN = n; } return d.uvs; };
  // ---- 预置方块（v1 名字已转 camelCase）----
  {
    const WOOL = 'White LightBlue Blue Cyan Yellow Pink Red Lime Gray Brown'.split(' ');
    const CORAL = 'tube brain bubble fire horn'.split(' ').map(c => c + 'Coral');
    const FLOWERS = 'poppy dandelion blueOrchid allium azureBluet cornflower lilyOfTheValley oxeyeDaisy pinkTulip'.split(' ');
    for (const lg of ['oakLog', 'birchLog', 'jungleLog', 'strippedOakLog']) def(lg, { tiles: { side: lg, end: lg + 'Top' }, axis: true });
    def('timber', { tiles: { side: 'timber', end: 'timberEnd' }, axis: true });
    def('grassBlock', { tiles: { top: 'grassTop', side: 'grassSide', bottom: 'dirt' } });
    def('sandstone', { tiles: { side: 'sandstone', top: 'sandstoneTop' } });
    def('sandRipple', { tiles: { top: 'sandRipple', side: 'sand', bottom: 'sand' } });
    def('barrel', { tiles: { side: 'barrelSide', end: 'barrelTop' }, axis: true });
    def('hay', { tiles: { side: 'haySide', end: 'hayTop' }, axis: true });
    def('bookshelf', { tiles: { side: 'bookshelf', top: 'oakPlanks' } });
    def('glass', { tiles: 'glass', glass: true });
    def('glassPane', { tiles: 'glass', shape: 'pane', glass: true });
    for (const w of WOOL) def('wool' + w + 'Carpet', { tiles: 'wool' + w, shape: 'carpet' });
    def('snowLayer', { tiles: 'snow', shape: 'layer' });
    const CROSS = ['seagrass', 'kelp', 'kelpTop', 'seaPickle', 'beachGrass', 'fern', 'deadBush', 'sugarCane', 'vine'].concat(CORAL.map(c => c + 'Fan'), FLOWERS);
    for (const c of CROSS) def(c, { tiles: c, shape: 'cross' });
    def('lilyPad', { tiles: 'lilyPad', shape: 'carpet', cutout: true });
    for (const l of ['oakLeaves', 'birchLeaves', 'jungleLeaves', 'azaleaLeaves', 'floweringAzaleaLeaves']) def(l, { tiles: l, leaves: true });
    for (const p of ['oakDoorTop', 'oakDoorBottom', 'oakTrapdoor', 'flowerPot']) def(p, { tiles: p, cutout: true });
    def('lantern', { tiles: 'lantern', cutout: true, box: [5, 0, 5, 11, 9, 11] });
    def('paperLantern', { tiles: 'paperLantern', box: [3, 0, 3, 13, 13, 13] });
    const SKIP = { missing: 1, glassPaneTop: 1, timberEnd: 1 };
    for (const n of V3.atlas.names) if (!SKIP[n] && !byName.has(n)) def(n, { tiles: n }); // 其余贴图：同名不透明方块
  }
  // ---- 状态编码（Uint16）：h-1 | facing<<3 | half<<5 | axis<<6 | rot<<8 ----
  const FACING = { n: 0, s: 1, e: 2, w: 3 }, FN = ['n', 's', 'e', 'w'], AXIS = { y: 0, x: 1, z: 2 }, AN = ['y', 'x', 'z'];
  function enc(o) {
    if (!o) return 0; let s = 0;
    if (o.h) s |= Math.max(1, Math.min(8, o.h | 0)) - 1;
    if (o.facing) s |= (FACING[o.facing] | 0) << 3;
    if (o.half === 'top' || o.half === true) s |= 32;
    if (o.axis) s |= (AXIS[o.axis] | 0) << 6;
    if (o.rot) s |= 256;
    return s;
  }
  // ---- World：nx×ny×nz 格，cell 米/格，origin = 格 (0,0,0) 的最小角（米）----
  class World {
    constructor(o = {}) {
      this.cell = o.cell || 0.25; this.origin = (o.origin || [0, 0, 0]).slice(0, 3);
      const sz = o.size || [16, 16, 16]; this.nx = sz[0] | 0; this.ny = sz[1] | 0; this.nz = sz[2] | 0; this.size = [this.nx, this.ny, this.nz];
      this.tileCells = Math.max(1, (o.tileCells || 1) | 0);
      this.g0 = this.origin.map(v => Math.round(v / this.cell)); // 全局格号偏移：不同 World 之间 UV 也连续
      const N = this.nx * this.ny * this.nz;
      this.ids = new Uint16Array(N); this.st = new Uint16Array(N); this.tg = new Uint16Array(N);
      this.tags = ['']; this.tagIx = new Map([['', 0]]);
    }
    idx(i, j, k) { return i + this.nx * (j + this.ny * k); }
    inside(i, j, k) { return i >= 0 && j >= 0 && k >= 0 && i < this.nx && j < this.ny && k < this.nz; }
    tagId(t) { if (!t) return 0; let v = this.tagIx.get(t); if (v === undefined) { v = this.tags.length; this.tags.push(t); this.tagIx.set(t, v); } return v; }
    // opts: { facing: 'n'|'s'|'e'|'w', half: 'bottom'|'top', axis: 'y'|'x'|'z', rot: bool（贴图转 90°）, h: 1..8（layer）, shape, tag }
    set(i, j, k, name, o) {
      if (!this.inside(i, j, k)) return this;
      const id = rid(name, o && o.shape); if (id < 0) return this;
      const x = this.idx(i, j, k); this.ids[x] = id; this.st[x] = id ? enc(o) : 0; this.tg[x] = id ? this.tagId(o && o.tag) : 0;
      return this;
    }
    fill(i0, j0, k0, i1, j1, k1, name, o) { // 闭区间格号
      const id = rid(name, o && o.shape); if (id < 0) return this;
      const s = id ? enc(o) : 0, t = id ? this.tagId(o && o.tag) : 0;
      if (i0 > i1) [i0, i1] = [i1, i0]; if (j0 > j1) [j0, j1] = [j1, j0]; if (k0 > k1) [k0, k1] = [k1, k0];
      i0 = Math.max(0, i0); j0 = Math.max(0, j0); k0 = Math.max(0, k0);
      i1 = Math.min(this.nx - 1, i1); j1 = Math.min(this.ny - 1, j1); k1 = Math.min(this.nz - 1, k1);
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) {
        let x = this.idx(i0, j, k); for (let i = i0; i <= i1; i++, x++) { this.ids[x] = id; this.st[x] = s; this.tg[x] = t; } }
      return this;
    }
    clear(i0, j0, k0, i1, j1, k1) { return this.fill(i0, j0, k0, i1, j1, k1, 0); }
    // 米 → 格号范围：取中心落在 [a0, a1) 里的格子（至少一格）
    rangeM(a0, a1, ax) { const c = this.cell, o = this.origin[ax]; if (a0 > a1) [a0, a1] = [a1, a0];
      const lo = Math.ceil((a0 - o) / c - 0.5), hi = Math.max(lo, Math.ceil((a1 - o) / c - 0.5) - 1); return [lo, hi]; }
    fillM(x0, y0, z0, x1, y1, z1, name, o) {
      const [i0, i1] = this.rangeM(x0, x1, 0), [j0, j1] = this.rangeM(y0, y1, 1), [k0, k1] = this.rangeM(z0, z1, 2);
      return this.fill(i0, j0, k0, i1, j1, k1, name, o);
    }
    clearM(x0, y0, z0, x1, y1, z1) { return this.fillM(x0, y0, z0, x1, y1, z1, 0); }
    get(i, j, k) {
      if (!this.inside(i, j, k)) return null; const x = this.idx(i, j, k), id = this.ids[x]; if (!id) return null;
      const s = this.st[x], d = defs[id];
      return { name: d.name, id, shape: d.shape, facing: FN[(s >> 3) & 3], half: s & 32 ? 'top' : 'bottom', axis: AN[(s >> 6) & 3],
        rot: !!(s & 256), h: (s & 7) + 1, tag: this.tags[this.tg[x]] };
    }
    at(x, y, z) { const c = this.cell, o = this.origin; return [Math.floor((x - o[0]) / c), Math.floor((y - o[1]) / c), Math.floor((z - o[2]) / c)]; }
    pos(i, j, k) { const c = this.cell, o = this.origin; return [o[0] + i * c, o[1] + j * c, o[2] + k * c]; } // 格最小角（米）
    top(i, k) { for (let j = this.ny - 1; j >= 0; j--) if (this.ids[this.idx(i, j, k)]) return j; return -1; }
    mesh(o) { return meshWorld(this, o || {}); }
  }
  // ---- 网格化 ----
  const DIR = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const FA = [0, 0, 1, 1, 2, 2], FS = [1, 0, 1, 0, 1, 0];                 // 面的法线轴、是否正侧
  const TA = [[1, 2], [2, 1], [2, 0], [0, 2], [0, 1], [1, 0]];            // 面内两轴（a × b = 法线，角点逆时针）
  const TU = [[2, -1, 1, 1], [2, 1, 1, 1], [0, 1, 2, -1], [0, 1, 2, 1], [0, 1, 1, 1], [0, -1, 1, 1]]; // 贴图 U 轴/符号、V 轴/符号（从外面看）
  const TKEY = [[0, 1, 2, 3, 4, 5], [2, 3, 0, 0, 0, 0], [0, 0, 0, 0, 2, 3]]; // axis y/x/z：各面用哪个贴图（FK 下标）
  const AROT = [[0, 0, 0, 0, 0, 0], [0, 0, 1, 1, 1, 1], [1, 1, 0, 0, 0, 0]]; // axis 方块侧面贴图转 90°，纹理顺着轴
  const AO = [1, 0.846, 0.698, 0.45], BOX1 = [0, 0, 0, 1, 1, 1], BACK = [5, 4, 0, 1]; // BACK：楼梯高侧 n s e w → 面
  const ST_T = [[0, 0, 1, 0.5], [0, 0.5, 1, 1], [0.5, 0, 1, 1], [0, 0, 0.5, 1]], ST_R = [[0, 0.5, 1, 1], [0, 0, 1, 0.5], [0, 0, 0.5, 1], [0.5, 0, 1, 1]];
  const PA = 7 / 16, PB = 9 / 16, FP0 = 6 / 16, FP1 = 10 / 16, FR0 = 7 / 16, FR1 = 9 / 16, RAILS = [[6 / 16, 9 / 16], [12 / 16, 15 / 16]];
  function full(e, s2, g) { // 邻格 e 的 g 面是否整面实心
    if (e.box) return false;
    switch (e.shape) {
      case 'cube': return true;
      case 'slab': return g === (s2 & 32 ? 2 : 3);
      case 'stairs': return g === (s2 & 32 ? 2 : 3) || g === BACK[(s2 >> 3) & 3];
      case 'carpet': return g === 3;
      case 'layer': return g === 3 || (g === 2 && (s2 & 7) === 7);
      default: return false;
    }
  }
  function meshWorld(w, o) {
    const t0 = performance.now(), { nx, ny, nz, ids, st, tg } = w, N = ids.length, c = w.cell, T = w.tileCells, G0 = w.g0, ao = o.ao !== false;
    const vis = new Uint8Array(N), flt = o.filter, rg = o.range || [0, 0, 0, nx - 1, ny - 1, nz - 1]; // vis: 0 不参与 1 输出 2 实心（只剔除/AO）
    for (let k = 0, x = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, x++) {
      if (!ids[x]) continue; if (!flt) { vis[x] = 1; continue; }
      const v = flt(i, j, k, w.tags[tg[x]]); vis[x] = v === 'solid' ? 2 : v ? 1 : 0; }
    const nb = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : i + nx * (j + ny * k));
    const occ = (i, j, k) => { const x = nb(i, j, k); return x >= 0 && vis[x] && defs[ids[x]].occ ? 1 : 0; };
    const out = new Map(), P = [0, 0, 0], Q = [0, 0, 0], OC = [0, 0, 0, 0];
    let ci = 0, cj = 0, ck = 0, cd = null, cs = 0, cuv = null, cB = null, cax = 0, crot = 0;
    for (let k = Math.max(0, rg[2]); k <= Math.min(nz - 1, rg[5]); k++) for (let j = Math.max(0, rg[1]); j <= Math.min(ny - 1, rg[4]); j++)
      for (let i = Math.max(0, rg[0]); i <= Math.min(nx - 1, rg[3]); i++) {
        const x = i + nx * (j + ny * k); if (vis[x] !== 1) continue;
        ci = i; cj = j; ck = k; cd = defs[ids[x]]; cs = st[x]; cuv = uvsOf(cd); cax = cd.axis ? (cs >> 6) & 3 : 0; crot = cs & 256 ? 1 : 0;
        const key = cd.kind * 65536 + tg[x]; cB = out.get(key);
        if (!cB) { cB = { kind: cd.kind, tag: w.tags[tg[x]], p: [], n: [], uv: [], c: [], ix: [], v: 0 }; out.set(key, cB); }
        const sh = cd.shape;
        if (sh === 'cube') box(cd.box || BOX1, 63);
        else if (sh === 'slab') box(cs & 32 ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1], 63);
        else if (sh === 'carpet') box(cd.box || [0, 0, 0, 1, 1 / 16, 1], 63);
        else if (sh === 'layer') box([0, 0, 0, 1, ((cs & 7) + 1) / 8, 1], 63);
        else if (sh === 'stairs') stairs(); else if (sh === 'pane') pane(); else if (sh === 'fence') fence(); else if (sh === 'cross') cross();
      }
    function culled(f) {
      const D = DIR[f], y = nb(ci + D[0], cj + D[1], ck + D[2]); if (y < 0 || !vis[y]) return false;
      const e = defs[ids[y]], s2 = st[y];
      if (e.opaque) return true;
      if (cd.leaves && e.leaves) return (f & 1) === 0;
      if (e.kind === 1 ? e.id !== cd.id : e.kind === 2 && cd.kind !== 2) return false; // 透过去看得见
      if (full(e, s2, f ^ 1)) return true;
      if (e.shape !== cd.shape) return false;
      const a = FA[f];                                                                  // 相同截面并排：贴合面剔除
      switch (cd.shape) {
        case 'slab': return a !== 1 && ((s2 ^ cs) & 32) === 0;
        case 'carpet': return a !== 1;
        case 'layer': return a !== 1 && ((s2 ^ cs) & 7) === 0;
        case 'stairs': return ((s2 ^ cs) & 56) === 0 && a === (((cs >> 3) & 3) < 2 ? 0 : 2);
        case 'pane': case 'fence': return true;
        default: return false;
      }
    }
    function box(bx, mask) {
      for (let f = 0; f < 6; f++) { if (!((mask >> f) & 1)) continue;
        const a = FA[f], bd = FS[f] ? bx[a + 3] === 1 : bx[a] === 0;
        if (bd && culled(f)) continue;
        quad(f, bx, bd); }
    }
    function tcoord(ax, sg) { const l = P[ax]; if (cd.uvCell) return sg > 0 ? l : 1 - l;
      const g = (ax === 0 ? ci : ax === 1 ? cj : ck) + G0[ax];
      return sg > 0 ? ((((g % T) + T) % T) + l) / T : ((((-g - 1) % T) + T) % T + 1 - l) / T; }
    function quad(f, bx, bd) {
      const a = FA[f], ta = TA[f][0], tb = TA[f][1], D = DIR[f], B = cB, R = cuv[TKEY[cax][f]], du = R[2] - R[0], dv = R[3] - R[1], tc = cd.tc;
      let ua = TU[f][0], us = TU[f][1], va = TU[f][2], vs = TU[f][3];
      if (crot ^ AROT[cax][f]) { const u0 = ua, s0 = us; ua = va; us = vs; va = u0; vs = -s0; }
      const v0 = B.v;
      for (let q = 0; q < 4; q++) {
        const qa = q === 1 || q === 2, qb = q >= 2;
        P[a] = FS[f] ? bx[a + 3] : bx[a]; P[ta] = qa ? bx[ta + 3] : bx[ta]; P[tb] = qb ? bx[tb + 3] : bx[tb];
        B.p.push((ci + P[0]) * c, (cj + P[1]) * c, (ck + P[2]) * c); B.n.push(D[0], D[1], D[2]);
        B.uv.push(R[0] + du * tcoord(ua, us), R[1] + dv * tcoord(va, vs));
        let n = 0;
        if (ao) { // 只沿盒子贴到格边的方向采样；贴边面采样邻格那一层
          const sa = qa ? 1 : -1, sb = qb ? 1 : -1, ea = qa ? bx[ta + 3] === 1 : bx[ta] === 0, eb = qb ? bx[tb + 3] === 1 : bx[tb] === 0;
          Q[0] = ci + (bd ? D[0] : 0); Q[1] = cj + (bd ? D[1] : 0); Q[2] = ck + (bd ? D[2] : 0);
          let s1 = 0, s2 = 0, s3 = 0;
          if (ea) { Q[ta] += sa; s1 = occ(Q[0], Q[1], Q[2]); if (eb) { Q[tb] += sb; s3 = occ(Q[0], Q[1], Q[2]); Q[tb] -= sb; } Q[ta] -= sa; }
          if (eb) { Q[tb] += sb; s2 = occ(Q[0], Q[1], Q[2]); Q[tb] -= sb; }
          n = s1 && s2 ? 3 : s1 + s2 + s3;
        }
        OC[q] = n; const kk = AO[n]; B.c.push(tc[0] * kk, tc[1] * kk, tc[2] * kk);
      }
      if (OC[0] + OC[2] > OC[1] + OC[3]) B.ix.push(v0 + 1, v0 + 2, v0 + 3, v0 + 1, v0 + 3, v0); else B.ix.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
      B.v += 4;
    }
    function stairs() { // 楼梯：facing = 高的一侧（往那边上）；half top = 倒挂
      const f = (cs >> 3) & 3, t = ST_T[f], r = ST_R[f];
      if (!(cs & 32)) { box([0, 0, 0, 1, 0.5, 1], 59); box([t[0], 0.5, t[1], t[2], 1, t[3]], 55); box([r[0], 0.5, r[1], r[2], 0.5, r[3]], 4); }
      else { box([0, 0.5, 0, 1, 1, 1], 55); box([t[0], 0, t[1], t[2], 0.5, t[3]], 59); box([r[0], 0.5, r[1], r[2], 0.5, r[3]], 8); }
    }
    function pane() { // 玻璃板/薄板：连到不透明方块、板、栏杆（连接用原始格子，不受 filter 影响）
      const cn = (dx, dz) => { const y = nb(ci + dx, cj, ck + dz); if (y < 0) return false; const e = defs[ids[y]]; return !!e && (e.opaque || e.shape === 'pane' || e.shape === 'fence'); };
      const E = cn(1, 0), Wc = cn(-1, 0), S = cn(0, 1), Nn = cn(0, -1), X = E || Wc, Z = S || Nn;
      if (!X && !Z) return box([PA, 0, 0, PB, 1, 1], 63);
      if (X && !Z) return box([Wc ? 0 : PA, 0, PA, E ? 1 : PB, 1, PB], 63);
      if (Z && !X) return box([PA, 0, Nn ? 0 : PA, PB, 1, S ? 1 : PB], 63);
      box([PA, 0, PA, PB, 1, PB], 63 & ~((E ? 1 : 0) | (Wc ? 2 : 0) | (S ? 16 : 0) | (Nn ? 32 : 0)));
      if (E) box([PB, 0, PA, 1, 1, PB], 61); if (Wc) box([0, 0, PA, PA, 1, PB], 62);
      if (S) box([PA, 0, PB, PB, 1, 1], 31); if (Nn) box([PA, 0, 0, PB, 1, PA], 47);
    }
    function fence() { // 栏杆：立柱 + 两道横杆
      const cn = (dx, dz) => { const y = nb(ci + dx, cj, ck + dz); if (y < 0) return false; const e = defs[ids[y]]; return !!e && (e.opaque || e.shape === 'fence'); };
      box([FP0, 0, FP0, FP1, 1, FP1], 63);
      const E = cn(1, 0), Wc = cn(-1, 0), S = cn(0, 1), Nn = cn(0, -1);
      for (const [y0, y1] of RAILS) {
        if (E) box([FP1, y0, FR0, 1, y1, FR1], 61); if (Wc) box([0, y0, FR0, FP0, y1, FR1], 62);
        if (S) box([FR0, y0, FP1, FR1, y1, 1], 31); if (Nn) box([FR0, y0, 0, FR1, y1, FP0], 47);
      }
    }
    function cross() { // 两片对角交叉，正反各一面（FrontSide），法线朝上
      const B = cB, R = cuv[2], du = R[2] - R[0], dv = R[3] - R[1], tc = cd.tc, lo = 0.15, hi = 0.85;
      for (const [x0, z0, x1, z1] of [[lo, lo, hi, hi], [lo, hi, hi, lo]]) for (let sd = 0; sd < 2; sd++) {
        const v0 = B.v, xa = sd ? x1 : x0, za = sd ? z1 : z0, xb = sd ? x0 : x1, zb = sd ? z0 : z1;
        for (const [qx, qy, qz, u] of [[xa, 0, za, 0], [xb, 0, zb, 1], [xb, 1, zb, 1], [xa, 1, za, 0]]) {
          B.p.push((ci + qx) * c, (cj + qy) * c, (ck + qz) * c); B.n.push(0, 1, 0);
          B.uv.push(R[0] + du * (sd ? 1 - u : u), R[1] + dv * qy); B.c.push(tc[0], tc[1], tc[2]); }
        B.ix.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); B.v += 4;
      }
    }
    const groups = [...out.values()].filter(g => g.v).sort((A, B) => A.kind - B.kind || (A.tag < B.tag ? -1 : A.tag > B.tag ? 1 : 0));
    const anchor = o.anchor || 'blocks', part = o.part || '';
    const mesh = build(groups.filter(g => g.kind < 2), anchor, part), glass = groups.filter(g => g.kind === 2);
    mesh.position.set(w.origin[0], w.origin[1], w.origin[2]);
    if (glass.length) { const gm = build(glass, anchor + ':glass', part); gm.castShadow = false; gm.userData.noShadow = true; gm.renderOrder = 1; mesh.add(gm); }
    let tris = 0; mesh.traverse(m => { if (m.geometry && m.geometry.index) tris += m.geometry.index.count / 3; });
    mesh.userData.stats = { tris, groups: groups.length, ms: +(performance.now() - t0).toFixed(2) };
    return mesh;
  }
  function build(gs, anchor, part) { // 组 → 一个 Mesh（每组一个材质槽，triTag / faceTags 同 V3.vox）
    let nv = 0, ni = 0; for (const g of gs) { nv += g.v; ni += g.ix.length; }
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
    const ix = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), triTag = new Uint16Array(ni / 3), faceTags = [], mats = [];
    let vo = 0, io = 0;
    gs.forEach((g, gi) => {
      pos.set(g.p, vo * 3); nrm.set(g.n, vo * 3); uv.set(g.uv, vo * 2); col.set(g.c, vo * 3);
      for (let q = 0; q < g.ix.length; q++) ix[io + q] = g.ix[q] + vo;
      triTag.fill(gi, io / 3, (io + g.ix.length) / 3); geo.addGroup(io, g.ix.length, gi);
      faceTags.push(g.tag || part); mats.push(material(KINDS[g.kind]));
      vo += g.v; io += g.ix.length;
    });
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(ix, 1)); geo.computeBoundingBox(); geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mats.length ? mats : material('opaque'));
    mesh.name = anchor; mesh.userData = { faceTags, triTag, anchor, part };
    if (!nv) mesh.userData.empty = true;
    if (nv && V3.parts && V3.parts.tagFaces) V3.parts.tagFaces(mesh);
    return mesh;
  }
  const MATS = {};
  function material(kind = 'opaque') { // 共享材质（userData.shared：场景 dispose 时跳过）
    if (MATS[kind]) return MATS[kind];
    const m = new THREE.MeshStandardMaterial({ map: V3.atlas.texture(), vertexColors: true, roughness: kind === 'glass' ? 0.1 : 0.9, metalness: 0 });
    if (kind === 'cutout') m.alphaTest = 0.5;
    if (kind === 'glass') { m.transparent = true; m.depthWrite = false; }
    m.name = 'V3.blocks.' + kind; m.userData.shared = true;
    return (MATS[kind] = m);
  }
  V3.blocks = { def, World, material, KINDS, shapes: Object.keys(SHAPES),
    id: n => rid(n), has: n => byName.has(n), get: n => defs[byName.get(n)] || null, names: () => [...byName.keys()] };
  // ---- 一览模型 blocks：A 全部方块 / B 形状 × 材质 / C 0.25 m 墙样 / D 0.5 m 地形剖面（工作台默认灯光）----
  const PPM = 96, INK = '#3a3026', INK3 = '#1f4f8a';
  function board(x0, z0, x1, z1, items) { // 平放在地上的文字板；items: [x, z（世界米）, text, 字高 m, {bold, color, align, maxW}]
    const W = Math.min(4096, Math.ceil((x1 - x0) * PPM)), H = Math.min(4096, Math.ceil((z1 - z0) * PPM)), sx = W / (x1 - x0), sz = H / (z1 - z0);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'); g.textBaseline = 'middle';
    for (const [x, z, t, s, o = {}] of items) {
      g.font = (o.bold ? 'bold ' : '') + Math.round(s * sx) + 'px sans-serif'; g.fillStyle = o.color || INK; g.textAlign = o.align || 'center';
      if (o.maxW) g.fillText(t, (x - x0) * sx, (z - z0) * sz, o.maxW * sx); else g.fillText(t, (x - x0) * sx, (z - z0) * sz);
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2); m.renderOrder = 2; m.name = 'blocks:label';
    Object.assign(m.userData, { noPick: true, noShadow: true, noReceive: true });
    return m;
  }
  function overview() {
    const root = new THREE.Group(), P = V3.parts, st = {}; root.name = 'blocks';
    if (P) P.declare(['方块', '方块/全部', '方块/形状', '方块/墙样', '方块/地形'], { 方块: '方块一览', '方块/全部': '全部方块', '方块/形状': '形状 × 材质', '方块/墙样': '0.25 m 墙样', '方块/地形': '0.5 m 地形剖面' });
    const add = (m, cast = true) => { m.traverse(o => { if (o.isMesh) { o.castShadow = cast && !o.userData.noShadow; o.receiveShadow = !o.userData.noReceive; } }); root.add(m); return m; };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ color: 0x8f8b84, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(-7.5, -0.002, 0.5); ground.userData.noPick = true; ground.name = 'blocks:ground'; add(ground, false);
    try { // A 全部方块：每块 1 × 0.5 × 1 m（0.5 m 格），名字写在前面；v3 新贴图排在最前（离镜头最近）两排
      const V3N = ['plaster', 'plasterTrim', 'timber', 'planks', 'floorWood', 'roofA', 'roofB', 'roofEdge', 'windowFrame', 'glass', 'glassPane',
        'sand', 'sandRipple', 'sandWet', 'sandDark', 'sandstone', 'strata1', 'strata2', 'strata3', 'stone', 'stoneMoss', 'cobble', 'gravel', 'seabed', 'coralSand'];
      const v3 = new Set(V3N), names = V3N.filter(n => byName.has(n)).concat([...byName.keys()].filter(n => !n.includes('.') && !v3.has(n)));
      const C = 14, R = Math.ceil(names.length / C), X0 = -34, Z0 = -R, items = []; st.R = R;
      const w = new World({ cell: 0.5, origin: [X0, 0, Z0], size: [C * 3, 1, R * 4] });
      names.forEach((n, q) => { const r = (q / C) | 0, c = q % C, kb = (R - 1 - r) * 4;
        w.fill(c * 3, 0, kb + 1, c * 3 + 1, 0, kb + 2, n, { h: 4, tag: '方块/全部/' + n });
        items.push([X0 + c * 1.5 + 0.5, Z0 + (kb + 3.5) * 0.5, n, 0.24, { maxW: 1.45, color: v3.has(n) ? INK3 : INK }]); });
      items.push([X0 + 10.5, R + 0.9, '全部方块 ' + names.length + ' 种（蓝字 = v3 新贴图；0.5 m 格，tileCells 1）', 0.5, { bold: true, maxW: 21 }]);
      const m = add(w.mesh({ part: '方块/全部', anchor: 'blocks:all' })); st.all = m.userData.stats;
      add(board(X0 - 0.5, Z0 - 0.2, X0 + 21.5, R + 1.6, items), false);
    } catch (e) { V3.err('blocks overview A: ' + (e && e.stack || e)); }
    try { // B 形状 × 材质：每行一种材质，每列一种形状（cross 见 A 里的植物）
      const MAT = ['plaster', 'roofA', 'planks', 'sandstone', 'timber', 'glass'], X0 = -9, Z0 = 1, items = [];
      const w = new World({ cell: 0.5, origin: [X0, 0, Z0], size: [24, 1, 18] });
      const COLS = [['cube', 0, 'cube'], ['slab', 2, 'slab'], ['slab', 4, 'slab top', { half: 'top' }], ['stairs', 6, 'stairs n', { facing: 'n' }],
        ['stairs', 8, 'stairs e', { facing: 'e' }], ['stairs', 10, 'stairs top', { facing: 's', half: 'top' }], ['pane', 12, 'pane'], ['pane', 14, 'pane ×3', null, 3],
        ['fence', 18, 'fence', null, 2], ['carpet', 21, 'carpet'], ['layer', 23, 'layer h4', { h: 4 }]];
      MAT.forEach((mt, r) => { const kk = (5 - r) * 3 + 1, tag = '方块/形状/' + mt;
        for (const [sh, i, , o, n = 1] of COLS) { const nm = sh === 'cube' ? mt : mt === 'glass' && sh === 'pane' ? 'glassPane' : mt + '.' + sh;
          w.fill(i, 0, kk, i + n - 1, 0, kk, nm, Object.assign({ tag }, o)); }
        w.set(19, 0, kk + 1, mt + '.fence', { tag });
        items.push([X0 - 0.3, Z0 + (kk + 0.5) * 0.5, mt, 0.3, { align: 'right', bold: true }]); });
      for (const [, i, lab, , n = 1] of COLS) items.push([X0 + (i + n / 2) * 0.5, Z0 + 9.4, lab, 0.22, { maxW: 0.98 }]);
      items.push([X0 + 5.25, Z0 + 10.1, '形状 × 材质：cube / slab / stairs / pane / fence / carpet / layer', 0.36, { bold: true, maxW: 16 }]);
      const m = add(w.mesh({ part: '方块/形状', anchor: 'blocks:shapes' })); st.shapes = m.userData.stats;
      add(board(X0 - 3, Z0 - 0.2, X0 + 13.5, Z0 + 10.6, items), false);
    } catch (e) { V3.err('blocks overview B: ' + (e && e.stack || e)); }
    try { // C 0.25 m 墙样（tileCells 2：16 px = 0.5 m）：灰泥墙、木柱、梁、窗、门洞、门廊、栏杆、单坡檐（roofA/roofB 隔行）
      const X0 = -8, w = new World({ cell: 0.25, origin: [X0, 0, -6], size: [48, 14, 8], tileCells: 2 });
      const F = (i0, j0, k0, i1, j1, k1, n, t, o) => w.fill(i0, j0, k0, i1, j1, k1, n, Object.assign({ tag: '方块/墙样/' + t }, o));
      F(0, 0, 0, 47, 13, 0, 'plaster', '墙'); F(0, 1, 0, 47, 1, 0, 'plasterTrim', '墙');
      for (const i of [0, 8, 16, 24, 32, 40, 46]) F(i, 0, 0, i + 1, 13, 0, 'timber', '柱');
      F(0, 13, 0, 47, 13, 0, 'timber', '梁', { axis: 'x' });
      const win = (i0, i1) => { F(i0, 4, 0, i1, 11, 0, 'windowFrame', '窗'); F(i0 + 1, 5, 0, i1 - 1, 10, 0, 'glassPane', '窗'); };
      win(2, 7); win(10, 15); win(26, 31); win(34, 39);
      F(18, 1, 0, 23, 9, 0, 'timber', '门框'); w.clear(19, 1, 0, 22, 8, 0);
      F(0, 0, 1, 47, 0, 7, 'planks', '门廊');
      F(0, 1, 6, 17, 2, 6, 'planks.fence', '栏杆'); F(24, 1, 6, 47, 2, 6, 'planks.fence', '栏杆');
      // 左半边不加檐（看得见墙面、窗、门），右半边是带柱的门廊檐
      for (const i of [24, 35, 47]) F(i, 1, 6, i, 7, 6, 'timber', '柱');
      for (let k = 1; k <= 6; k++) F(24, 14 - k, k, 47, 14 - k, k, k & 1 ? 'roofA.stairs' : 'roofB.stairs', '檐', { facing: 'n' });
      F(24, 7, 7, 47, 7, 7, 'roofEdge.slab', '檐', { half: 'top' });
      const m = add(w.mesh({ part: '方块/墙样', anchor: 'blocks:wall' })); st.wall = m.userData.stats;
      const t = new World({ cell: 0.25, size: [48, 14, 1], tileCells: 2 }); t.fill(0, 0, 0, 47, 13, 0, 'plaster');
      for (let i = 0; i < 48; i += 8) t.fill(i, 0, 0, i + 1, 13, 0, 'timber'); t.fill(26, 4, 0, 31, 11, 0, 'windowFrame'); t.fill(27, 5, 0, 30, 10, 0, 'glassPane');
      let best = 1e9, cold = 0;
      for (let r = 0; r < 6; r++) { const t0 = performance.now(), tm = t.mesh(), dt = performance.now() - t0; if (!r) cold = dt; else best = Math.min(best, dt); tm.traverse(o => o.geometry && o.geometry.dispose()); }
      st.wallMs = { cold: +cold.toFixed(2), best: +best.toFixed(2) };
      add(board(X0 - 0.2, -4.0, X0 + 12.2, -2.4, [[X0 + 6, -3.55, '0.25 m 墙样（tileCells 2：16 px = 0.5 m）', 0.4, { bold: true, maxW: 12 }],
        [X0 + 6, -2.95, `12 × 3.5 m 墙网格化 ${cold.toFixed(1)} ms（冷）/ ${best.toFixed(1)} ms；本样 ${st.wall.tris} tris`, 0.3, { maxW: 12 }]]), false);
    } catch (e) { V3.err('blocks overview C: ' + (e && e.stack || e)); }
    try { // D 0.5 m 地形剖面：台地 → 崖 → 沙滩 → 湿沙 → 海床，前面和右侧切开看分层
      const X0 = 7, w = new World({ cell: 0.5, origin: [X0, 0, -6], size: [24, 8, 12] });
      const TAG = { sand: '沙', sandRipple: '沙', sandDark: '沙', gravel: '沙', sandWet: '湿沙', strata1: '岩层', strata2: '岩层', strata3: '岩层', seabed: '海床', coralSand: '海床',
        stone: '石', stoneMoss: '石', cobble: '石', brainCoral: '海床', tubeCoral: '海床' };
      const S = (i, j, k, n, o) => w.set(i, j, k, n, Object.assign({ tag: '方块/地形/' + (TAG[n] || '植物') }, o));
      const E = (i, j, k, n) => { if (w.inside(i, j, k) && !w.get(i, j, k)) S(i, j, k, n); };
      const H = i => (i < 7 ? 7 : i < 10 ? 3 : i < 14 ? 2 : 1), hs = U => V3.util.hash3(U[0], U[1], U[2]);
      for (let i = 0; i < 24; i++) for (let k = 0; k < 12; k++) { const h = H(i);
        for (let j = 0; j < h; j++) { const d = h - 1 - j; let n;
          if (h === 7) n = d === 0 ? (i >= 2 && i <= 4 && k >= 1 && k <= 3 ? 'gravel' : hs([i, k, 1]) < 0.2 ? 'sandDark' : 'sandRipple') : d < 2 ? 'sand' : d < 4 ? 'strata1' : d < 6 ? 'strata2' : 'strata3';
          else if (h === 3) n = d === 0 ? 'sand' : d === 1 ? 'strata1' : 'strata2';
          else if (h === 2) n = d === 0 ? 'sandWet' : 'strata2';
          else n = hs([i, k, 2]) < 0.3 ? 'coralSand' : 'seabed';
          S(i, j, k, n); } }
      S(1, 7, 2, 'stone'); S(2, 7, 2, 'stoneMoss'); S(1, 7, 3, 'stoneMoss'); S(1, 8, 2, 'stoneMoss'); S(5, 7, 8, 'cobble'); S(5, 7, 9, 'stone');
      for (let i = 0; i < 24; i++) for (let k = 0; k < 12; k++) { const h = H(i), r = hs([i, k, 3]);
        if (h === 7 && r < 0.14) E(i, 7, k, r < 0.04 ? 'deadBush' : 'beachGrass');
        else if (h === 3 && r < 0.1) E(i, 3, k, 'beachGrass');
        else if (h === 1 && r < 0.3) E(i, 1, k, r < 0.12 ? 'seagrass' : r < 0.18 ? 'kelp' : ['tubeCoralFan', 'brainCoralFan', 'fireCoralFan', 'hornCoralFan'][(r * 40 | 0) % 4]); }
      E(17, 1, 4, 'kelp'); E(17, 2, 4, 'kelpTop'); E(21, 1, 8, 'kelp'); E(21, 2, 8, 'kelp'); E(21, 3, 8, 'kelpTop');
      E(19, 1, 6, 'brainCoral'); E(22, 1, 2, 'tubeCoral'); E(11, 2, 5, 'stone'); E(12, 2, 9, 'stoneMoss');
      const m = add(w.mesh({ part: '方块/地形', anchor: 'blocks:terrain' })); st.terrain = m.userData.stats;
      add(board(X0, 0.02, X0 + 12, 0.9, [[X0 + 6, 0.45, '0.5 m 地形剖面：sand → strata1/2/3，沙滩 sandWet，海床 seabed / coralSand', 0.3, { bold: true, maxW: 11.8 }]]), false);
    } catch (e) { V3.err('blocks overview D: ' + (e && e.stack || e)); }
    let tris = 0; root.traverse(o => { if (o.isMesh && o.geometry.index && o.name !== 'blocks:label') tris += o.geometry.index.count / 3; });
    st.tris = tris; V3.blocks.stats = st;
    const R = st.R || 10;
    return { root, st, views: {
      all: { az: 0, el: 0.62, dist: 68, target: [-7.5, 0, 1.5] },
      tiles: { az: 0, el: 0.75, dist: 18, target: [-29, 0, R - 4] },
      tiles2: { az: 0, el: 0.75, dist: 18, target: [-18.4, 0, R - 4] },
      grid: { az: 0, el: 1.1, dist: 38, target: [-23.25, 0, 0.7] },
      shapes: { az: 0, el: 0.8, dist: 21, target: [-4, 0.2, 6.2] },
      wall: { az: 0, el: 0.3, dist: 17, target: [-2, 1.6, -5] },
      terrain: { az: 0.6, el: 0.45, dist: 22, target: [13, 1.5, -3] },
    } };
  }
  if (V3.models) V3.models.register({ id: 'blocks', label: '方块一览', build() {
    const o = overview();
    return { id: 'blocks', label: '方块一览', root: o.root, partRoot: '方块', views: o.views, stats: o.st,
      stage: { pedestal: false, size: 40, center: [-7.5, 1, 0] },
      update() {}, setState() {},
      dispose() { o.root.traverse(m => { if (!m.isMesh) return; m.geometry.dispose();
        for (const x of [].concat(m.material)) if (x && !x.userData.shared) { if (x.map && !x.map.userData.shared) x.map.dispose(); x.dispose(); } }); } };
  } });
  // @@NEXT@@
})(window.V3);
