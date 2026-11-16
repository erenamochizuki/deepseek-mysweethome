// 58-plants.js — 绿植（face）：墙上藤蔓、花箱里的花、盆栽、多肉、沙滩贴地爬藤、海边草、椰子树。
// Scene part 'plants' (order 60) + catalog model 'plants'（绿植一览，工作台默认灯光，带白色示意房子）。
// Positions only from V3.layout (L.plants / L.outside / L.porch). Contract: docs/SPEC-3.md §2 §4 §5 §8.
(function (V3) {
  'use strict';
  const U = V3.util;
  const S32 = 1 / 32, S16 = 1 / 16;            // voxel sizes (m)
  const ROOT = '绿植';
  const LABELS = {
    '绿植': '绿植', '绿植/藤蔓': '墙上藤蔓', '绿植/藤蔓/西南': '藤蔓·西南墙角', '绿植/藤蔓/东南': '藤蔓·粉花窗东',
    '绿植/藤蔓/东墙': '藤蔓·东墙北段', '绿植/花箱花': '花箱里的花', '绿植/花箱花/紫': '紫花（西窗花箱）',
    '绿植/花箱花/粉': '粉花（东窗花箱）', '绿植/盆栽': '盆栽', '绿植/盆栽/门廊西': '盆栽·门廊西角',
    '绿植/盆栽/门廊东吊篮': '吊篮·门廊东角', '绿植/盆栽/台阶东': '盆栽·台阶东侧', '绿植/多肉': '多肉小盆栽',
    '绿植/爬藤': '沙滩贴地爬藤', '绿植/爬藤/西': '爬藤·石堆旁（紫花）', '绿植/爬藤/东': '爬藤·东侧',
    '绿植/海边草': '海边草丛', '绿植/椰子树': '椰子树', '绿植/椰子树/西': '椰子树·屋子西北',
    '绿植/椰子树/东': '椰子树·东边沙滩',
  };
  // ---- palette ----
  const C = {
    leaf: [0x3f8a3a, 0x4f9e3f, 0x5fae48, 0x6fbe55, 0x3a7a36], leafHi: 0x8fd468, leafDk: 0x2c5e2c,
    stem: 0x4a6b2a, vineStem: 0x6b5a34, soil: 0x5a3e2a, pot: 0xc0673f, potDk: 0x9a4f30, potHi: 0xd98a5a,
    purple: [0x7b5cd6, 0x8f6ee6, 0x6a4ac2, 0x9d84ee], pink: [0xf59ab8, 0xf7b3c8, 0xe9809f, 0xfbc8d6],
    white: 0xfff6ea, yellow: 0xffd75a, mg: [0xc061c9, 0xd07ad6, 0xa94cb5], mgIn: 0x7a2a86,
    succ: [0x7fb59a, 0x8cc4a6, 0x6aa38a], succTip: 0xe58a9a, grass: [0x6f9443, 0x80a34c, 0x5e8238, 0xc2bf78],
    trunk: [0xb39470, 0xa3845f, 0x8f7350], ring: 0x7a6145, frond: [0x4f8f3a, 0x5c9e42, 0x6aad4a, 0x447f33],
    coco: 0x7a5a2e, cocoDk: 0x5e4423, basket: 0xb0844f, chain: 0x5b5b60,
  };
  const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
  let FLAT = false;                                // catalog: plants stand on the flat mock sand (y 0)
  const groundY = (x, z) => (!FLAT && V3.terrain && V3.terrain.heightAt) ? V3.terrain.heightAt(x, z) : 0;
  // wall frames: local x = along wall (east for s, south for e), local z = out of the wall, y = world height
  const WALLS = {
    s: (H, a) => ({ pos: [a, 0, H.z1], ry: 0 }),
    e: (H, a) => ({ pos: [H.x1, 0, a], ry: Math.PI / 2 }),
    w: (H, a) => ({ pos: [H.x0, 0, a], ry: -Math.PI / 2 }),
    n: (H, a) => ({ pos: [a, 0, H.z0], ry: Math.PI }),
  };

  // drop triangles the camera can never see (into the wall / onto the floor): drop(nx, ny, nz, x, y, z) -> bool
  function cull(geo, triTag, drop) {
    const ix = geo.index.array, N = geo.attributes.normal.array, Pa = geo.attributes.position.array;
    const out = new ix.constructor(ix.length), tt = new Uint16Array(triTag.length), grs = [];
    let o = 0;
    for (const gr of geo.groups) {
      const s = o;
      for (let i = gr.start; i < gr.start + gr.count; i += 3) {
        const a = ix[i] * 3;
        if (drop(N[a], N[a + 1], N[a + 2], Pa[a], Pa[a + 1], Pa[a + 2])) continue;
        out[o] = ix[i]; out[o + 1] = ix[i + 1]; out[o + 2] = ix[i + 2]; tt[o / 3] = triTag[i / 3]; o += 3;
      }
      grs.push([s, o - s, gr.materialIndex]);
    }
    geo.setIndex(new THREE.BufferAttribute(out.slice(0, o), 1));
    geo.clearGroups(); for (const [s, n, m] of grs) geo.addGroup(s, n, m);
    return tt.slice(0, o / 3);
  }
  const INTO_WALL = (nx, ny, nz) => nz < -0.5;
  const ON_FLOOR = (nx, ny, nz, x, y) => ny < -0.5 && y < 0.002;
  const WALL_FLOOR = (nx, ny, nz, x, y) => nz < -0.5 || (ny < -0.5 && y < 0.002);

  // ---- vox helper: grid -> meshes (one per bone) under a Group; returns { group, bones:[Group], meshes } ----
  // opt: { scale, part (default face-tag path), anchor, layer, onWall, bones:[{name,pivot,parent}], noise, ao, cull }
  function voxGroup(B, g, opt) {
    const s = opt.scale || S32, defs = opt.bones || [{ name: 'root', pivot: [0, 0, 0], parent: -1 }];
    const group = new THREE.Group(); group.name = opt.anchor;
    const bones = defs.map((d) => { const b = new THREE.Group(); b.name = d.name; return b; });
    defs.forEach((d, i) => {
      const p = d.parent == null ? -1 : d.parent, pp = p >= 0 ? defs[p].pivot : [0, 0, 0];
      bones[i].position.set((d.pivot[0] - pp[0]) * s, (d.pivot[1] - pp[1]) * s, (d.pivot[2] - pp[2]) * s);
      bones[i].userData.rest = bones[i].rotation.clone();
      (p >= 0 ? bones[p] : group).add(bones[i]);
    });
    const meshes = [];
    for (const m of V3.vox.mesh(g, { scale: s, bones: defs, noise: opt.noise ?? 0.07, ao: opt.ao ?? 0.5 })) {
      if (opt.cull) m.triTag = cull(m.geometry, m.triTag, opt.cull);
      const tags = m.faceTags.map((t) => t || opt.part);
      const mat = opt.mat || B.mat, mesh = new THREE.Mesh(m.geometry, tags.map(() => mat));
      mesh.name = opt.anchor + ':' + defs[m.bone].name;
      Object.assign(mesh.userData, { faceTags: tags, triTag: m.triTag, anchor: 'house2:plants:' + mesh.name,
        layer: opt.layer || 'site' });
      if (opt.onWall) mesh.userData.onWall = opt.onWall;
      bones[m.bone].add(mesh); V3.parts.tagFaces(mesh);
      B.geos.push(m.geometry); B.tris += m.geometry.index.count / 3; meshes.push(mesh);
    }
    Object.assign(group.userData, { part: opt.part, layer: opt.layer || 'site' });
    if (opt.onWall) group.userData.onWall = opt.onWall;
    return { group, bones, meshes };
  }

  // ---- builders: fn(B, it) -> Object3D (local origin = placement point); B.ticks.push(fn(dt,t)) for motion ----
  const MAKERS = {};
  // ---- 墙上藤蔓: stems at z=0 (touching the wall), leaves z=1..2, flowers z=2..3; slides around windows ----
  const inHole = (holes, x, y) => holes.some((h) => x >= h[0] && x <= h[2] && y >= h[1] && y <= h[3]);
  const LEAF_SHAPES = [[[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]], [[0, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]]];
  MAKERS.vine = (B, it, r) => {
    const n = 32, hw = Math.floor(it.len * n / 2), y1 = Math.round(it.y1 * n), y0 = Math.round(it.y0 * n);
    const holes = it.holes.map((h) => [Math.floor(h[0] * n), Math.floor(h[1] * n), Math.ceil(h[2] * n), Math.ceil(h[3] * n)]);
    const g = new V3.vox.Grid(2 * hw + 5, y1 + 10, 5, { origin: [hw + 2, 0, 0] });
    const free = (x, y) => x >= -hw && x <= hw && y >= 0 && y <= y1 + 3 && !inHole(holes, x, y);
    const lc = (x, y) => { const h = U.hash3(x, y, 11); return h < 0.12 ? C.leafHi : h < 0.22 ? C.leafDk : C.leaf[Math.floor(h * 97) % C.leaf.length]; };
    const blob = (cx, cy, rx, ry, z) => {      // ragged leaf patch (z=1 sheet, z=2 loose leaves)
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const a = (x - cx) / rx, b = (y - cy) / ry;
        if (a * a + b * b + (U.hash3(x, y, z) - 0.5) * 0.8 > 1 || !free(x, y)) continue;
        g.c(lc(x, y)).set(x, y, z);
      }
    };
    const grow = (x, top) => {                 // one stem from the root (local y 0) up; lush above y0
      let tx = x;
      for (let y = 0, k = 0; y <= top; y++, k++) {
        if (!free(x, y)) {                    // window sill / edge: run along the sill to the nearest free column
          let nx = null;
          for (let d = 1; d <= 2 * hw && nx == null; d++) for (const s of [-1, 1])
            if (nx == null && free(x + s * d, y) && free(x + s * d, y - 1)) nx = x + s * d;
          if (nx == null) return;
          for (let xx = x; xx !== nx; xx += Math.sign(nx - xx)) { g.c(C.vineStem).set(xx, y - 1, 0); if (k % 3 === 0) blob(xx, y - 2, 2, 1.5, 1); }
          x = tx = nx;
        }
        g.c(C.vineStem).set(x, y, 0);
        if (k % 14 === 13) tx = U.clamp(x + Math.round((r() - 0.5) * 14), -hw + 1, hw - 1);
        if (x !== tx && r() < 0.5 && free(x + Math.sign(tx - x), y)) { x += Math.sign(tx - x); g.set(x, y, 0); }
        if (y >= y0 && k % 4 === 0) blob(x + (r() - 0.5) * 6, y, 2.5 + r() * 2.5, 2 + r() * 2, 1);
        else if (y < y0 && k % 6 === 0) blob(x + (k % 12 ? 2 : -2), y, 1.5, 1, 1);
        if (y >= y0 && r() < 0.08) blob(x + (r() - 0.5) * 8, y, 1.5, 1.2, 2);
      }
      blob(x, top, 5, 3, 1);                  // crown
    };
    const ns = Math.max(2, Math.round(it.len * 2));
    for (let s = 0; s < ns; s++) {
      const x = Math.round(-hw + (s + 0.5) * 2 * hw / ns + (r() - 0.5) * 4);
      grow(U.clamp(x, -hw + 1, hw - 1), y1 - Math.floor(r() * 0.35 * (y1 - y0)));
    }
    let nf = Math.round(it.len * (y1 - y0) / n * 8);  // flowers on the leaf sheet (~8 per m²)
    for (let i = 0; i < 400 && nf > 0; i++) {
      const x = Math.round((r() * 2 - 1) * (hw - 1)), y = y0 + 2 + Math.floor(r() * (y1 - y0));
      if (!g.has(x, y, 1) || !g.has(x - 1, y, 1) || !g.has(x + 1, y, 1) || g.has(x, y, 2)) continue;
      g.c(pick(r, it.flowers)).set(x - 1, y, 2).set(x + 1, y, 2).set(x, y - 1, 2).set(x, y + 1, 2);
      g.c(C.yellow).set(x, y, 2); nf--;
    }
    return voxGroup(B, g, { scale: S32, part: it.path, anchor: it.id, layer: 'ground', onWall: it.wall, cull: INTO_WALL, mat: windMat(B, 'vine') }).group;
  };
  // ---- 花箱里的花: leafy mound + flower heads on the box top (local origin = box top centre, +z = front) ----
  MAKERS.box = (B, it, r) => {
    const n = 32, hx = Math.floor(it.w * n / 2), hz = Math.floor(it.d * n / 2), H = {};
    const g = new V3.vox.Grid(2 * hx + 7, 26, 2 * hz + 9, { origin: [hx + 3, 10, hz + 3] });
    const lc = (x, y, z) => { const h = U.hash3(x, y, z); return h < 0.1 ? C.leafHi : h < 0.3 ? C.leafDk : C.leaf[Math.floor(h * 89) % C.leaf.length]; };
    for (let x = -hx + 1; x <= hx; x++) for (let z = -hz; z <= hz + 1; z++) {   // mound: domed, spills 1 cell past the rim（P5：64 列，和箱体一样宽）
      const e = Math.min(x + hx - 1, hx - x, z + hz, hz + 1 - z), q = U.hash3(x >> 1, 3, z >> 1);
      const h = Math.max(0, Math.min(5, Math.floor(e * 0.9 + q * 2.2) - (z > hz ? 1 : 0)));
      H[x + ',' + z] = h;
      for (let y = 0; y <= h; y++) g.c(lc(x, y, z)).set(x, y, z);
    }
    for (let x = -hx + 1; x <= hx - 1; x += 2 + Math.floor(r() * 4)) {    // trailing strands over the front face
      const len = 2 + Math.floor(r() * 6);
      for (let y = 0; y >= -len; y--) g.c(lc(x, y, 9)).set(x + ((y >> 1) & 1), y, hz + 1);
      if (r() < 0.5) g.c(C.leafHi).set(x + 1, -len, hz + 1);
    }
    let nf = Math.round(it.w * 28);
    for (let i = 0; i < 600 && nf > 0; i++) {
      const x = 1 + Math.round((r() * 2 - 1) * (hx - 2)), z = Math.round((r() * 2 - 1) * hz);
      const h0 = H[x + ',' + z]; if (h0 == null || g.has(x, h0 + 1, z) || g.has(x, h0 + 2, z)) continue;
      const tall = r() < 0.3, y = h0 + 1 + (tall ? 1 : 0), col = r() < 0.12 ? C.white : pick(r, it.cols);
      if (tall) g.c(C.stem).set(x, h0 + 1, z);
      g.c(col).set(x - 1, y, z).set(x + 1, y, z).set(x, y, z - 1).set(x, y, z + 1);
      if (r() < 0.5) g.set(x, y + 1, z);
      g.c(col === C.white ? C.yellow : 0xfff1a8).set(x, y, z); nf--;
    }
    return voxGroup(B, g, { scale: S32, part: it.path, anchor: it.id, layer: 'ground', onWall: 's', cull: WALL_FLOOR }).group;
  };
  // ---- 盆栽 / 多肉 (1/32 m; local origin = pot base centre on the floor) ----
  const leafCol = (x, y, z) => { const h = U.hash3(x, y, z); return h < 0.1 ? C.leafHi : h < 0.28 ? C.leafDk : C.leaf[Math.floor(h * 89) % C.leaf.length]; };
  const layerOf = (it) => it.layer || (it.pos[1] >= V3.layout.porch.y - 0.01 ? 'ground' : 'site');
  const potBody = (g, R, h) => {               // tapered terracotta pot with a lip; soil flush with the lip
    g.c((x, y, z) => U.hash3(x, y, z) < 0.22 ? C.potDk : C.pot);
    for (let y = 0; y < h - 1; y++) g.cyl(0, 0, R - 1.5 + 1.5 * y / h, y, y);
    g.c(C.potHi).cyl(0, 0, R + 0.6, h - 1, h); g.c(C.soil).cyl(0, 0, R - 0.8, h, h);
  };
  const fern = (g, r, y0, L, maxR = Infinity) => {   // arching fronds with paired leaflets（maxR：叶子最长几格，P5 方块版收进 1 格）
    for (let i = 0, nf = 7; i < nf; i++) {
      const a = (i + r() * 0.6) / nf * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), len = Math.min(maxR, L * (0.75 + r() * 0.45));
      for (let s = 1; s <= len; s++) {
        const t = s / len, x = Math.round(ca * s), z = Math.round(sa * s), y = y0 + Math.round(len * (1.05 * t - 1.35 * t * t));
        g.c(t > 0.85 ? C.leafHi : leafCol(x, y, z)).set(x, y, z);
        if (s % 2 === 0 && t > 0.12 && t < 0.92) for (let d = 1; d <= (t < 0.6 ? 2 : 1); d++) {
          const px = Math.round(-sa * d), pz = Math.round(ca * d); g.set(x + px, y, z + pz).set(x - px, y, z - pz);
        }
      }
    }
    g.c(C.leafDk).ell(0, y0, 0, 3, 2, 3);
  };
  const bush = (g, r, y0, R, cols) => {         // ragged leafy dome dotted with flowers
    g.c(leafCol).fill(-R - 1, y0, -R - 1, R + 1, y0 + R, R + 1, (x, y, z) => {
      const a = x / R, b = (y - y0) / (R * 0.8), c = z / R; return a * a + b * b + c * c + (U.hash3(x, y, z) - 0.5) * 0.5 <= 1; });
    for (let i = 0; i < R * 3; i++) {
      const th = r() * Math.PI * 2, ph = r() * 1.25, x = Math.round(Math.cos(th) * Math.sin(ph) * R), z = Math.round(Math.sin(th) * Math.sin(ph) * R);
      let y = y0 + R + 1; while (y > y0 && !g.has(x, y, z)) y--;
      if (g.has(x, y + 1, z)) continue;
      g.c(pick(r, cols)).set(x - 1, y + 1, z).set(x + 1, y + 1, z).set(x, y + 1, z - 1).set(x, y + 1, z + 1); g.c(C.yellow).set(x, y + 1, z);
    }
  };
  const layoutOf = (it) => (V3.layout.plants || []).find((p) => p.id === it.id) || {};
  MAKERS.pot = (B, it, r) => {
    const fit = !!layoutOf(it).block;                // P5：模组方块（1 格）的盆栽，整盆收进格子里
    const R = Math.round((fit ? 5.5 : 6) * it.size), h = Math.round(12 * it.size), L = Math.round((fit ? 12 : 16) * it.size);
    const g = new V3.vox.Grid(2 * L + 9, h + 2 * R + 16, 2 * L + 9, { origin: [L + 4, 8, L + 4] });
    potBody(g, R, h);
    if (it.style === 'fern') fern(g, r, h + 2, L, fit ? 13 : Infinity); else bush(g, r, h + 1, R + 1, C.pink.concat([C.white, C.white]));
    return voxGroup(B, g, { scale: S32, part: it.path, anchor: it.id, layer: layerOf(it), cull: ON_FLOOR }).group;
  };
  MAKERS.succ = (B, it, r) => {                 // little bowls of rosettes (v 0-2 by the steps, 3 = post top)
    const v = it.v | 0, top = v === 3, R = top ? 2.5 : v === 1 ? 4 : 5, h = top ? 4 : 5, G = Math.ceil(R) + 7;
    const g = new V3.vox.Grid(2 * G + 1, h + 12, 2 * G + 1, { origin: [G, 0, G] });
    potBody(g, R, h);
    const ros = (cx, cz, rr, y0) => {
      g.c((x, y, z) => y === y0 && U.hash3(x, y, z) < 0.4 ? C.succTip : C.succ[Math.floor(U.hash3(z, x, y) * 3) % 3]);
      for (let k = 0; k <= rr; k++) g.cyl(cx, cz, Math.max(0.5, rr - k), y0 + k, y0 + k);
      g.c(C.succTip);
      for (let j = 0; j < 6; j++) { const a = j / 6 * Math.PI * 2 + rr; g.set(Math.round(cx + Math.cos(a) * (rr + 1)), y0, Math.round(cz + Math.sin(a) * (rr + 1))); }
    };
    const SET = [[[-2, 0, 3], [2.5, 1, 2]], [[0, 0, 3.5]], [[-2, -1, 2], [2, -1, 2], [0, 2, 2.5]], [[0, 0, 2]]][v] || [[0, 0, 3]];
    for (const [x, z, rr] of SET) ros(x, z, rr, h + 1);
    return voxGroup(B, g, { scale: S32, part: it.path, anchor: it.id, layer: layerOf(it), cull: ON_FLOOR }).group;
  };
  // ---- 吊篮: bracket arm on the lantern post, chains + basket of trailing leaves; swings gently ----
  const ARM = { e: 0, n: Math.PI / 2, w: Math.PI, s: -Math.PI / 2 };
  MAKERS.basket = (B, it, r) => {
    const lay = layoutOf(it), onPost = lay.arm != null;
    const [px, pz] = onPost ? [0, 0] : it.post, d = Math.hypot(px, pz) || 1;
    const A = onPost ? 22 : Math.round(Math.min(0.45, d) * 32), Y = onPost ? 28 : 46, hk = A - 1, R = 6, by = Y - (onPost ? 11 : 14);
    const FL = [C.white, 0xfbe08a, C.pink[1]];
    const g = new V3.vox.Grid(A + 16, Y + 6, 2 * R + 12, { origin: [4, 0, R + 6] });
    g.c(C.chain).box(0, Y, 0, A, Y + 1, 0);
    if (onPost) g.box(-1, 0, -1, 0, Y + 1, 0).box(-1, Y + 2, -1, 0, Y + 2, 0);   // 竖杆（立在栏杆柱顶上）+ 杆头
    for (let k = 0; k <= 7; k++) g.set(k, Y - 7 + k, 0);                        // brace
    g.b(1);
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + 0.5;          // three chains to the rim
      for (let y = by + 1; y < Y; y++) { const t = (Y - y) / (Y - by); g.set(Math.round(hk + Math.cos(a) * R * t), y, Math.round(Math.sin(a) * R * t)); } }
    g.c((x, y, z) => (x + y + z) & 1 ? C.basket : 0x8f6a3c)
      .fill(hk - R, by - R, -R, hk + R, by, R, (x, y, z) => { const a = (x - hk) / R, b = (y - by) / R, c = z / R; return a * a + b * b + c * c <= 1.0001; });
    g.m('under').c(leafCol).ell(hk, by + 1, 0, R + 1, 3, R + 1); g.m();
    for (let j = 0; j < 16; j++) {                                              // trailing strands
      const a = (j + r() * 0.5) / 16 * Math.PI * 2, len = Math.min(by - 2, 4 + Math.floor(r() * 11));
      const x = Math.round(hk + Math.cos(a) * (R + 1)), z = Math.round(Math.sin(a) * (R + 1));
      for (let y = by; y > by - len; y--) g.c(leafCol(x, y, z)).set(x + ((y >> 2) & 1), y, z);
      if (r() < 0.45) g.c(pick(r, FL)).set(x, by - len, z).set(x + 1, by - len + 1, z);
    }
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2, q = r() * R, x = Math.round(hk + Math.cos(a) * q), z = Math.round(Math.sin(a) * q);
      const y = by + 2 + Math.floor(3 * Math.sqrt(Math.max(0, 1 - q * q / ((R + 1) * (R + 1)))));
      g.c(pick(r, FL)).set(x - 1, y, z).set(x + 1, y, z).set(x, y, z - 1).set(x, y, z + 1); g.c(C.yellow).set(x, y, z);
    }
    const res = voxGroup(B, g, { scale: S32, part: it.path, anchor: it.id, layer: 'ground',
      bones: [{ name: 'root', pivot: [0, 0, 0], parent: -1 }, { name: 'hang', pivot: [hk, Y, 0], parent: 0 }] });
    res.group.position.set(px, onPost ? lay.post || 0 : 0, pz); res.group.rotation.y = onPost ? ARM[lay.arm] || 0 : Math.atan2(pz, -px);
    const hb = res.bones[1], ph = r() * 6, W = B.W;
    B.ticks.push(() => {                                         // pendulum: hangs downwind, swings harder in gusts
      const [lx, lz] = localWind(W, hb), q = W.ph * 1.25 + ph;
      const lean = 0.12 * W.sp, sw = 0.008 + 0.06 * W.sp + 0.06 * W.gu;
      hb.rotation.z = lean * lx + sw * Math.sin(q) + 0.02 * W.gu * Math.sin(q * 4.3);
      hb.rotation.x = -lean * lz + 0.75 * sw * Math.sin(q * 0.68 + ph * 1.7);
    });
    const outer = new THREE.Group(); outer.name = it.id; outer.add(res.group);
    Object.assign(outer.userData, { part: it.path, layer: 'ground' });
    return outer;
  };
  // ---- 沙滩爬藤 (马鞍藤, 1/16 m): runners random-walk over the sand from a few roots; two-lobed leaves + purple trumpets ----
  const DOWN = (nx, ny) => ny < -0.5;
  MAKERS.creep = (B, it, r) => {
    const hx = Math.round(it.w * 8) + 2, hz = Math.round(it.d * 8) + 2;          // half extents in cells
    const g = new V3.vox.Grid(2 * hx + 7, 4, 2 * hz + 7, { origin: [hx + 3, 0, hz + 3] });
    const av = it.avoid.map((a) => a.map((v) => v * 16));
    const ok = (x, z) => { const a = x / hx, b = z / hz; if (a * a + b * b > 1) return false;
      for (const q of av) if (x >= q[0] && x <= q[2] && z >= q[1] && z <= q[3]) return false; return true; };
    const RUN = 0x6e7436, put = (x, y, z, c) => { if (ok(x, z)) g.c(c).set(x, y, z); };
    const leaf = (x, z, nx, nz) => {                                               // U-shaped two-lobed leaf beside the runner
      const tx = nz, tz = -nx;
      for (const s of [-1, 0, 1]) put(x + nx + tx * s, 0, z + nz + tz * s, leafCol(x + s, 1, z));
      for (const s of [-1, 1]) put(x + 2 * nx + tx * s, 0, z + 2 * nz + tz * s, leafCol(x, 2, z + s));
      if (r() < 0.4) put(x + 2 * nx + tx, 1, z + 2 * nz + tz, C.leafHi);          // one lobe held up
    };
    const flower = (x, z, nx, nz) => {
      const fx = x + 2 * nx, fz = z + 2 * nz, c = pick(r, C.mg);
      put(x + nx, 0, z + nz, C.stem); put(fx, 0, fz, C.stem);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(fx + dx, 1, fz + dz, c);
      put(fx, 1, fz, C.mgIn);
    };
    const mat = (x0, z0) => {                                                       // leafy crown at a root
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
        const h = U.hash3(x0 + dx, 7, z0 + dz);
        if (dx * dx + dz * dz > 9 + h * 8) continue;
        put(x0 + dx, 0, z0 + dz, leafCol(dx, 0, dz));
        if (h < 0.3) put(x0 + dx, 1, z0 + dz, leafCol(dz, 1, dx));
      }
    };
    const run = (x, z, a, len, depth) => {
      let fx = x, fz = z, side = r() < 0.5 ? 1 : -1;
      for (let s = 0; s < len; s++) {
        a += (r() - 0.5) * 0.45; fx += Math.cos(a); fz += Math.sin(a);
        const nx = Math.round(fx), nz = Math.round(fz);
        if (!ok(nx, nz)) { a += Math.PI * 0.6; fx = x; fz = z; continue; }
        if (nx !== x && nz !== z) put(nx, 0, z, RUN);                                // keep the runner 4-connected
        x = nx; z = nz; put(x, 0, z, RUN);
        if (s % 2 === 1 && s < len - 1) {
          const ax = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
          (r() < 0.18 ? flower : leaf)(x, z, ax ? 0 : side, ax ? side : 0); side = -side;
        }
        if (!depth && s === (len * 0.45 | 0) && r() < 0.75) run(x, z, a + (r() < 0.5 ? 0.9 : -0.9), len >> 1, 1);
      }
    };
    const roots = [];
    for (let k = 0; k < 80 && roots.length < 2; k++) {
      const x = Math.round((r() * 2 - 1) * hx * 0.6), z = Math.round((r() * 2 - 1) * hz * 0.6);
      if (ok(x, z) && roots.every(([px, pz]) => Math.hypot(px - x, pz - z) > 24)) roots.push([x, z]);
    }
    for (const [x0, z0] of roots) {
      mat(x0, z0);
      for (let j = 0; j < 3; j++) run(x0, z0, (j + r() * 0.6) / 3 * Math.PI * 2, 16 + Math.floor(r() * 14), 0);
    }
    const res = voxGroup(B, g, { scale: S16, part: it.path, anchor: it.id, layer: 'site', cull: DOWN, ao: 0.35 });
    res.group.scale.y = 0.6;                                                        // flatter than a full cell
    const y0 = it.pos[1];                                                           // drape each quad onto the stepped terrain
    for (const m of res.meshes) {
      const a = m.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 12) {
        const cx = (a[i] + a[i + 6]) / 2, cz = (a[i + 2] + a[i + 8]) / 2, d = (groundY(it.pos[0] + cx, it.pos[2] + cz) - y0) / 0.6;
        if (d) for (let k = 1; k < 12; k += 3) a[i + k] += d;
      }
      m.geometry.attributes.position.needsUpdate = true; m.geometry.computeBoundingBox(); m.geometry.computeBoundingSphere();
    }
    return res.group;
  };
  // ---- 海边草 (1/16 m): a fountain of thin blades, upright in the middle, arching outward at the rim ----
  MAKERS.grass = (B, it, r) => {
    const g = new V3.vox.Grid(25, 14, 25, { origin: [12, 0, 12] });
    g.c(C.grass[2]).box(-1, 0, -1, 1, 0, 1);
    const nb = 7 + Math.floor(r() * 3);
    for (let i = 0; i < nb; i++) {
      const a = (i + r() * 0.8) / nb * Math.PI * 2, q = r(), L = Math.round(10 - 4 * q + r() * 2), lean = 0.15 + q * 0.9;
      const x0 = Math.round(Math.cos(a) * 1.2 * q), z0 = Math.round(Math.sin(a) * 1.2 * q);
      const base = pick(r, [C.grass[0], C.grass[1], C.grass[2]]);
      for (let k = 0; k <= L; k++) {
        const t = k / L, y = Math.round(L * (t - 0.3 * lean * t * t)), o = lean * L * 0.8 * t * t;
        g.c(t > 0.7 ? C.grass[3] : base).set(x0 + Math.round(Math.cos(a) * o), y, z0 + Math.round(Math.sin(a) * o));
      }
    }
    if (r() < 0.6) g.c(C.grass[3]).box(0, 2, 0, 0, 8 + Math.floor(r() * 3), 0);   // seed stalk
    return voxGroup(B, g, { scale: S16, part: it.path, anchor: it.id, layer: 'site', cull: ON_FLOOR, ao: 0.4, mat: windMat(B, 'grass') }).group;
  };
  // ---- 椰子树 (1/16 m): ringed trunk (cells ×2 tall, sheared into a bowed lean) + sheet fronds on 3 swaying bones + coconuts ----
  MAKERS.palm = (B, it, r) => {
    const h = it.h || 6, [lx, lz] = it.lean, LX = lx * h, LZ = lz * h, sc = h / 6;
    const outer = new THREE.Group(); outer.name = it.id; Object.assign(outer.userData, { part: it.path, layer: 'site' });
    const NY = Math.round(h * 8), tg = new V3.vox.Grid(13, NY + 1, 13, { origin: [6, 0, 6] });
    tg.c((x, y) => (y % 3 === 0 ? C.ring : C.trunk[(y >> 2) % 3]));
    for (let y = 0; y < NY; y++) tg.cyl(0, 0, (y < 2 ? 3.9 : 3.1 - 0.9 * y / NY) + (y % 6 === 0 && y > 2 ? 0.5 : 0), y, y);
    const tr = voxGroup(B, tg, { scale: S16, part: it.path, anchor: it.id + ':trunk', layer: 'site', cull: ON_FLOOR });
    tr.group.scale.y = 2;
    for (const m of tr.meshes) {                                                    // bow the straight trunk: offset grows 1.5t - 0.5t²
      const p = m.geometry.attributes.position, a = p.array;
      for (let i = 0; i < a.length; i += 3) { const t = Math.min(1, a[i + 1] * 2 / h), f = 1.5 * t - 0.5 * t * t; a[i] += LX * f; a[i + 2] += LZ * f; }
      p.needsUpdate = true; m.geometry.computeBoundingBox(); m.geometry.computeBoundingSphere();
    }
    outer.add(tr.group);
    const R = Math.round(36 * sc), CG = R + 4, top = 14, bot = Math.round(48 * sc) + 2;
    const cg = new V3.vox.Grid(2 * CG + 1, top + bot + 1, 2 * CG + 1, { origin: [CG, bot, CG] });
    cg.c((x, y, z) => U.hash3(x, y, z) < 0.5 ? C.ring : C.trunk[1]).ell(0, -2, 0, 3.6, 4, 3.6);   // leaf-base boots
    const nf = it.id === 'palmE' ? 6 : 7;
    for (let i = 0; i < nf; i++) {
      const az = (i + 0.25 + r() * 0.5) / nf * Math.PI * 2, age = r(), up = 0.75 - 0.95 * age, dr = 0.5 + 0.45 * age;
      const L = Math.round((26 + r() * 10) * sc), W = 3.2 * sc, ca = Math.cos(az), sa = Math.sin(az);
      cg.b(1 + i % 3); let py = null;
      for (let k = 2; k <= L; k += 0.5) {
        const u = k / L, y = k * up - dr * L * u * u, w = Math.round(W * Math.sin(Math.PI * Math.min(1, u * 1.15)));
        const ry = Math.round(y);                                                     // rachis: no vertical gaps where it droops steeply
        if (py !== null) for (let s = Math.min(py, ry) + 1; s < Math.max(py, ry); s++) cg.c(0x9fb050).set(Math.round(ca * k), s, Math.round(sa * k));
        py = ry;
        for (let j = -w; j <= w; j += 0.5) {
          if (Math.abs(j) > w - 1 && (Math.floor(k) & 1)) continue;                  // serrated edge
          const yy = Math.round(y - 0.18 * j * j * (0.4 + u)), x = Math.round(ca * k - sa * j), z = Math.round(sa * k + ca * j);
          const c = j === 0 ? 0x9fb050 : u > 0.86 ? 0xa8a24e : C.frond[((Math.floor(k) + Math.floor(Math.abs(j))) & 1) + 2 * (j < 0)];
          cg.c(c).set(x, yy, z);
        }
      }
    }
    cg.b(0);
    for (let i = 0; i < 4; i++) {                                                   // coconuts under the crown
      const a = i * 1.7 + r(), x = Math.round(Math.cos(a) * 3.2), z = Math.round(Math.sin(a) * 3.2), y = -4 - (i & 1) * 2;
      cg.c((xx, yy, zz) => U.hash3(xx, yy, zz) < 0.3 ? C.cocoDk : C.coco).ell(x, y, z, 1.8, 2, 1.8);
    }
    const defs = [{ name: 'crown', pivot: [0, 0, 0], parent: -1 }];
    for (let k = 0; k < 3; k++) defs.push({ name: 'frond' + k, pivot: [0, 0, 0], parent: 0 });
    const cr = voxGroup(B, cg, { scale: S16, part: it.path, anchor: it.id + ':crown', layer: 'site', bones: defs });
    cr.group.position.set(LX, h, LZ); cr.group.rotation.set(lz * 0.5, 0, -lx * 0.5);
    outer.add(cr.group);
    const ph = r() * 6, bn = cr.bones, W = B.W;
    B.ticks.push(() => {                                         // upright: fronds bend toward the wind, gusts add flutter
      const [lx, lz] = localWind(W, outer), q = W.ph + ph;
      const lean = 0.08 * W.sp, fl = 0.008 + 0.04 * W.sp + 0.04 * W.gu;
      for (let k = 1; k <= 3; k++) {
        bn[k].rotation.x = lean * lz + fl * Math.sin(q * 1.1 + k * 2.1);
        bn[k].rotation.z = -lean * lx + fl * Math.sin(q * 0.9 + k * 1.3);
      }
      const tl = 0.012 * W.sp, tw = 0.004 + 0.008 * W.gu;      // the whole tree leans a little and sways slowly
      outer.rotation.x = tl * lz + tw * Math.sin(q * 0.5); outer.rotation.z = -tl * lx + tw * Math.sin(q * 0.43 + ph);
    });
    return outer;
  };
  // @@NEXT@@ builders

  // ---- placement list (world poses from layout) ----
  const SIGN = { s: 1, e: -1, w: 1, n: -1 };     // local x = SIGN * (along-wall world coord - centre)
  // ctx：场景的 build ctx。P5 第 3 轮起花箱的花、3 个盆栽、多肉是模组方块（布局带 block），游戏场景里不画（54-house-mc 画方块）；
  // 工作台和绿植一览（ctx.studio）照旧画
  function ITEMS(ctx) {
    const L = V3.layout, H = L.house, P = L.porch, st = P.steps, out = [], O = {}, PL = {};
    const FM = V3.furnMc, gone = (r) => !!(r && FM && FM.webKeep && FM.webKeep(ctx, r.block) === null);
    for (const o of L.outside) O[o.id] = o;
    for (const p of L.plants || []) PL[p.id] = p;
    const VINES = { vineSW: ['西南', [0xfff6ea, 0xf7b3c8]], vineSE: ['东南', [0xf7b3c8, 0xf59ab8]], vineE: ['东墙', [0xfff6ea, 0xfbe08a]] };
    // 贴墙的藤蔓跟着房子：布置模式挪过、转过房子时，墙、门窗用摆好以后的（54-house-mc 的 HB.placedLayout()）
    const HBk = V3.houseBlocks, LP = !ctx || !ctx.studio ? (HBk && HBk.placedLayout ? HBk.placedLayout() : L) : L, VP = {};
    for (const p of LP.plants || []) VP[p.id] = p;
    for (const id in VINES) {
      const p = VP[id]; if (!p) continue;
      const c = (p.a + p.b) / 2, f = WALLS[p.wall](LP.house, c), sg = SIGN[p.wall];
      const base = (p.onPorch != null ? p.onPorch : p.wall === 's') ? P.y : groundY(f.pos[0], f.pos[2]);   // 朝门廊那面墙从门廊板上长
      const holes = LP.openings.filter((o) => o.wall === p.wall).map((o) => {
        const u0 = sg * (o.a0 - c), u1 = sg * (o.a1 - c);
        return [Math.min(u0, u1) - 0.1, o.y0 - base - 0.1, Math.max(u0, u1) + 0.1, o.y1 - base + 0.1];
      });
      out.push({ id, kind: 'vine', pos: [f.pos[0], base, f.pos[2]], ry: f.ry, path: '绿植/藤蔓/' + VINES[id][0], wall: p.wall,
        len: Math.abs(p.b - p.a), y0: p.y0 - base, y1: p.y1 - base, flowers: VINES[id][1], holes });
    }
    for (const [id, path, cols] of [['boxW', '绿植/花箱花/紫', C.purple], ['boxE', '绿植/花箱花/粉', C.pink]]) {
      const b = O[id]; if (!b || gone(b)) continue;
      out.push({ id, kind: 'box', pos: [(b.x0 + b.x1) / 2, b.wallY, (b.z0 + b.z1) / 2], path, w: b.x1 - b.x0, d: b.z1 - b.z0, cols, wall: 's' });
    }
    if (PL.potW && !gone(PL.potW)) out.push({ id: 'potW', kind: 'pot', pos: [PL.potW.x, P.y, PL.potW.z], path: '绿植/盆栽/门廊西', size: 1.1, style: 'fern' });
    if (PL.potE && !gone(PL.potE)) { const q = L.lanterns[3] || [PL.potE.x + 0.5, PL.potE.z + 0.5];
      out.push({ id: 'potE', kind: 'basket', pos: [PL.potE.x, P.y, PL.potE.z], path: '绿植/盆栽/门廊东吊篮', post: [q[0] - PL.potE.x, q[1] - PL.potE.z] }); }
    if (PL.potStep && !gone(PL.potStep)) out.push({ id: 'potStep', kind: 'pot', pos: [PL.potStep.x, groundY(PL.potStep.x, PL.potStep.z), PL.potStep.z],
      path: '绿植/盆栽/台阶东', size: 0.85, style: 'flower' });
    if (O.succ && !gone(O.succ)) {
      const xw = (O.succ.x0 + st.x0) / 2, xe = (O.succ.x1 + st.x1) / 2;
      // 第 4 盆在栏杆头上：v4 方块房子的栏杆是云杉栅栏，台阶东边第一根柱子上站着灯笼，放到再往东一根（格子正中）
      [[xw, null, st.z1 - 0.22], [xw, null, st.z1 - 0.62], [xe, null, st.z1 - 0.22], H.blocks ? [st.x1 + 1.5, P.y + P.railH, P.z1 - 0.5] : [st.x1 + 0.1, P.y + P.railH, st.z0]]
        .forEach(([x, y, z], i) => out.push({ id: 'succ' + i, kind: 'succ', pos: [x, y == null ? groundY(x, z) : y, z], path: '绿植/多肉', v: i }));
    }
    const rect = (r, cx, cz, m = 0) => [r.x0 - cx - m, r.z0 - cz - m, r.x1 - cx + m, r.z1 - cz + m];
    for (const [id, path] of [['creepW', '绿植/爬藤/西'], ['creepE', '绿植/爬藤/东']]) {
      const p = PL[id]; if (!p) continue;
      const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      const avoid = [rect(H, cx, cz, 0.2), rect(P, cx, cz, 0.15), O.rocks && rect(O.rocks, cx, cz, 0.15), O.chest && rect(O.chest, cx, cz, 0.15)].filter(Boolean);
      out.push({ id, kind: 'creep', pos: [cx, groundY(cx, cz), cz], path, w: p.x1 - p.x0, d: p.z1 - p.z0, avoid });
    }
    const tufts = [];
    if (PL.grassS) { const g = PL.grassS, r = U.rng(9127);
      for (let i = 0; i < 9; i++) tufts.push([g.x0 + (i + 0.2 + 0.6 * r()) * (g.x1 - g.x0) / 9, g.z0 + r() * (g.z1 - g.z0)]); }
    // 用户反馈 fb-20261105-054413-wx1「海边草喧宾夺主了，去掉」：沙丘上（grassS）和东边爬藤旁的海边草都不种了
    if (PL.creepE && PL.creepE.grass) { const g = PL.creepE; tufts.push([g.x1 - 0.8, g.z1 - 0.6], [g.x1 - 1.6, g.z0 + 1.2], [(g.x0 + g.x1) / 2 + 1, g.z1 - 0.4]); }
    tufts.forEach(([x, z], i) => out.push({ id: 'grass' + i, kind: 'grass', pos: [x, groundY(x, z), z], ry: i * 2.4, path: '绿植/海边草', v: i }));
    for (const [id, path] of [['palmW', '绿植/椰子树/西'], ['palmE', '绿植/椰子树/东']]) {
      const p = PL[id]; if (!p) continue;
      out.push({ id, kind: 'palm', pos: [p.x, groundY(p.x, p.z), p.z], path, h: p.h, lean: p.lean || [0, 0] });
    }
    return out;
  }

  // ---- 风：读 V3.env.state.wind（没有 env = 无风）。B.W 每帧更新一次，所有植物共用 ----
  // B.W = { sp 风力 0..1, gu 阵风 0..1, dx/dz 风吹向的方向（世界）, ph 抖动相位（阵风里走得快）, u 着色器 uniforms }
  function windTick(B) {
    const W = B.W;
    return (dt) => {
      const w = (V3.env && V3.env.state && V3.env.state.wind) || null;
      dt = Math.min(Math.max(dt || 0, 0), 0.1);
      W.sp = w ? +w.speed || 0 : 0; W.gu = w ? +w.gust || 0 : 0;
      if (w && w.dir) { W.dx = w.dir[0]; W.dz = w.dir[1]; }
      W.ph += dt * (1 + 1.5 * W.gu);
      W.u.uT.value = W.ph; W.u.uWind.value.set(W.dx, W.dz, W.sp, W.gu);
    };
  }
  // world wind direction expressed in obj's frame (its own + all parents' y rotations) → [lx, lz]
  function localWind(W, obj) {
    let a = 0; for (let o = obj; o; o = o.parent) a += o.rotation.y;
    const c = Math.cos(a), s = Math.sin(a);
    return [c * W.dx - s * W.dz, s * W.dx + c * W.dz];
  }
  // 草 / 藤蔓：顶点着色器里弯（根不动、梢动）。草按本地 y 渐强；藤蔓按离墙的本地 +z 渐强，且不往墙里推。
  // 位移只取决于顶点位置，相邻格子的共用顶点动得一样，不会裂缝。
  function windMat(B, kind) {
    const key = 'plants-wind-' + kind;
    if (B.wm[key]) return B.wm[key];
    const m = V3.vox.material({ roughness: 0.85 }), vine = kind === 'vine';
    m.customProgramCacheKey = () => key;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uT = B.W.u.uT; sh.uniforms.uWind = B.W.u.uWind;
      sh.vertexShader = 'uniform float uT;\nuniform vec4 uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        vine ? 'float wf = clamp(transformed.z / 0.09, 0.0, 1.0);' : 'float wf = clamp(transformed.y / 0.6, 0.0, 1.0); wf *= wf;',
        'vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        'float wq = uT * 4.0 + dot(wp, vec3(4.1, 3.3, 3.7));',
        'float wa = uWind.z * ' + (vine ? '(0.015 + 0.03 * uWind.w)' : '(0.03 + 0.06 * uWind.w)') + ';',
        'vec3 wo = vec3(uWind.x, 0.0, uWind.y) * (uWind.z * ' + (vine ? '0.02' : '0.12') + ' + wa * sin(wq))',
        '  + vec3(-uWind.y, 0.0, uWind.x) * (0.6 * wa * sin(wq * 1.37 + 1.0)) + vec3(0.0, 0.4 * wa * sin(wq * 1.9 + 2.0), 0.0);',
        'vec3 wl = (vec4(wo * wf, 0.0) * modelMatrix).xyz;',      // world → local (rotation only: transpose = inverse)
        vine ? 'wl.z = max(wl.z, 0.0);' : '',
        'transformed += wl;',
      ].join('\n'));
    };
    return (B.wm[key] = m);
  }

  function buildAll(rng, ctx) {
    const B = { geos: [], mat: V3.vox.material({ roughness: 0.85 }), ticks: [], tris: 0, rng, stats: {}, root: new THREE.Group(), wm: {} };
    B.W = { sp: 0, gu: 0, dx: -0.33, dz: -0.94, ph: 0, u: { uT: { value: 0 }, uWind: { value: new THREE.Vector4(-0.33, -0.94, 0, 0) } } };
    B.ticks.push(windTick(B));                                   // first: every other tick reads B.W
    B.root.name = 'plants';
    V3.parts.declare(Object.keys(LABELS), LABELS);
    for (const it of ITEMS(ctx)) {
      if (!MAKERS[it.kind]) continue;
      try {
        const t0 = B.tris, o = MAKERS[it.kind](B, it, rng('plants:' + it.id));
        B.stats[it.id] = B.tris - t0;
        if (!o) continue;
        o.position.set(...it.pos); o.rotation.y = it.ry || 0;
        B.root.add(o);
      } catch (e) { V3.err('plants ' + it.id + ': ' + (e && e.stack || e)); }
    }
    B.dispose = () => { for (const g of B.geos) g.dispose(); B.mat.dispose(); for (const k in B.wm) B.wm[k].dispose(); B.geos = []; B.wm = {}; };
    return B;
  }

  // ---- scene part (house2) ----
  let live = null;
  const strSeed = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  const rngOf = (ctx) => (ctx && ctx.rng) ? ctx.rng : (seed) => U.rng(typeof seed === 'number' ? seed : strSeed(seed));
  if (V3.scene && V3.scene.part) V3.scene.part({
    id: 'plants', label: '绿植', order: 60,
    build(ctx) { if (live) live.dispose(); live = buildAll(rngOf(ctx), ctx); return live.root; },
    update(dt, t) { if (live) for (const f of live.ticks) f(dt, t); },
    dispose() { if (live) live.dispose(); live = null; V3.parts.reset(ROOT); },
  });

  // ---- catalog model 'plants': plants at their layout spots + white stand-ins (house, porch, boxes, sand) ----
  function mockSet(root, geos, mats) {
    const L = V3.layout, H = L.house, P = L.porch, st = P.steps, O = {};
    for (const o of L.outside) O[o.id] = o;
    const box = (x0, y0, z0, x1, y1, z1, hex) => {
      const m = mats[hex] || (mats[hex] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9 }));
      const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)); geos.push(g);
      const me = new THREE.Mesh(g, m);
      me.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      me.castShadow = me.receiveShadow = true; me.userData.noPick = true; root.add(me); return me;
    };
    box(-16, -0.1, -16, 16, 0, 9, 0xead5a3);                                   // sand
    box(H.x0, 0, H.z0, H.x1, H.eaveY, H.z1, 0xefe8da);                         // house body (示意)
    for (const o of L.openings) {
      const c = o.id === 'door' ? 0x7a5235 : 0x3d5a78, d = 0.03;
      if (o.y1 > H.eaveY) continue;                                             // gable panes: no gable in the mock
      if (o.wall === 's') box(o.a0, o.y0, H.z1, o.a1, o.y1, H.z1 + d, c);
      else if (o.wall === 'n') box(o.a0, o.y0, H.z0 - d, o.a1, o.y1, H.z0, c);
      else if (o.wall === 'e') box(H.x1, o.y0, o.a0, H.x1 + d, o.y1, o.a1, c);
      else box(H.x0 - d, o.y0, o.a0, H.x0, o.y1, o.a1, c);
    }
    box(P.x0, 0, P.z0, P.x1, P.y, P.z1, 0xc89058);                            // porch deck
    for (let j = 0; j < st.n; j++) box(st.x0, 0, st.z0, st.x1, (j + 1) * P.y / st.n, st.z0 + (st.n - j) * (st.z1 - st.z0) / st.n, 0xb07a48);
    for (const id of ['boxW', 'boxE']) { const b = O[id]; box(b.x0, b.wallY - 0.3, b.z0, b.x1, b.wallY, b.z1, 0x8a5a35); }
    for (const [x, z] of L.lanterns.slice(0, 4)) box(x - 0.1, P.y, z - 0.1, x + 0.1, P.y + 1.6, z + 0.1, 0x6b4a2f); // posts
    box(st.x1 + 0.02, P.y, st.z0 - 0.08, st.x1 + 0.18, P.y + P.railH, st.z0 + 0.08, 0x6b4a2f);         // east step post
    const r = O.rocks; box(r.x0, 0, r.z0, r.x1, r.h / 2, r.z1, 0x9c978e); box(r.x0 + 1, 0, r.z0 + 1, r.x1 - 1, r.h, r.z1 - 1.5, 0x8f8a82);
    const c = O.chest; box(c.x0, 0, c.z0, c.x1, c.h, c.z1, 0x8a5a35);
  }
  V3.models.register({ id: 'plants', label: '绿植一览', build() {
    const root = new THREE.Group(); root.name = 'plants-catalog';
    const ctx = V3.scene && V3.scene.ctx ? V3.scene.ctx(root, { studio: true }) : null;
    FLAT = true; let B; try { B = buildAll(rngOf(ctx), ctx || { studio: true }); } finally { FLAT = false; }
    const geos = [], mats = {};
    root.add(B.root); mockSet(root, geos, mats);
    return {
      id: 'plants', label: '绿植一览', root, partRoot: ROOT, tris: B.tris,
      stage: { pedestal: false, size: 30, center: [0, 2, -5] },
      views: {
        all: { az: 0.55, el: 0.42, dist: 36, target: [0, 2, -5] },
        wall: { az: 0.15, el: 0.18, dist: 13, target: [-1, 2.4, -5.5] },
        porch: { az: 0.3, el: 0.3, dist: 7, target: [-1, 1.2, -3.8] },
        east: { az: 1.3, el: 0.22, dist: 13, target: [8, 2, -8] },
        beach: { az: 0.1, el: 0.75, dist: 16, target: [-10, 0, -2] },
        palmW: { az: -0.5, el: 0.15, dist: 16, target: [-10.5, 3.5, -11.5] },
        palmE: { az: 0.7, el: 0.12, dist: 14, target: [11.5, 3, 1.5] },
      },
      update(dt, t) { for (const f of B.ticks) f(dt, t); },
      dispose() { B.dispose(); for (const g of geos) g.dispose(); for (const k in mats) mats[k].dispose(); },
    };
  } });
})(window.V3);
