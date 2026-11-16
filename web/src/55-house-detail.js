// 55-house-detail.js — 场景部件 house-detail（order 45）：房子细节（V3.vox，1 格 = 1/32 m）
// 门（带小窗）、白色四格窗框 + 玻璃 + 窗台、山墙圆窗、花箱箱体（花由 58-plants 画）、
// 灯笼 ×6（ctx.lamp ≤ 4 盏 + ctx.glowMat）、木箱 + 灯笼、毛巾、台阶地垫、贝壳风铃（update 里随风轻摆）。
// 挂墙物 userData.onWall = 's|n|e|w' + storey：墙被压低时跟着隐藏（剖切由 50-scene 处理）。
// v4 方块房子（L.house.blocks）：门、窗、门廊灯笼都是方块（54-house-mc 画），这里只画花箱、门两侧壁灯、木箱、毛巾、地垫、风铃。
(function (V3) {
  'use strict';
  if (!V3.scene || !V3.scene.part || !V3.vox) return;
  const S = 1 / 32, C = 0.25;
  const COL = {
    frame: 0xf6f3ee, sill: 0xe9e2d6, timber: 0x6b4a2f, dark: 0x4a3221, iron: 0x2f2b28, brass: 0xc9a24a,
    doorA: 0x9a6438, doorB: 0x8a5a32, boxA: 0x8a5a35, boxB: 0x7a4e2e, soil: 0x5a4030, glass: 0xbfe3f2,
    lamp: 0xffb35c, chestA: 0x9a6a40, chestB: 0x86592f, towelA: 0x4f86c6, towelB: 0xf4f1ea,
    jute: 0xc8a46a, juteD: 0xb08c52, drift: 0xb89a72, thread: 0xd9d2c3, shells: [0xf3e6d6, 0xf2c9b8, 0xe8d8b0],
  };
  const GLOW = /\/灯$/;
  const short = (s) => String(s || '').split('（')[0].trim().replace(/\s*\+\s*/g, '和');
  const inner = (s) => (String(s || '').match(/（(.*?)）/) || [])[1] || short(s);
  const band = (a, b, sh = 2) => (v) => (((v + 4096) >> sh) & 1) ? a : b;
  // 墙面坐标系：局部 +x 沿墙（从屋外看向右），+z 朝外；a = 沿墙坐标（南北墙为 x，东西墙为 z）
  const WF = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };
  const wallPos = (H, w, a, y) => w === 's' ? [a, y, H.z1] : w === 'n' ? [a, y, H.z0] : w === 'e' ? [H.x1, y, a] : [H.x0, y, a];
  const hAt = (L, x, z) => (V3.terrain && V3.terrain.heightAt ? V3.terrain.heightAt(x, z) : L.site.sandY);
  // ext = [[x0,x1],[y0,y1],[z0,z1]]：设计格范围（含两端）
  const grid = (ext) => new V3.vox.Grid(ext[0][1] - ext[0][0] + 1, ext[1][1] - ext[1][0] + 1, ext[2][1] - ext[2][0] + 1,
    { origin: [-ext[0][0], -ext[1][0], -ext[2][0]] });

  // 贪心合面网格化（单骨骼物件）：同色同标签的相邻外露面合成一个矩形，三角形少一个数量级；每块面按位置略有深浅
  const LIN = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const gmesh = (g, path) => {
    const n = [g.nx, g.ny, g.nz], o = g.o, at = (i, j, k) => i + n[0] * (j + n[1] * k);
    const off = (ax, I) => (I - o[ax] - (ax === 1 ? 0 : 0.5)) * S, hs = V3.util && V3.util.hash3;
    const Q = new Map(), p = [0, 0, 0], mc = new Uint32Array(Math.max(n[0] * n[1], n[1] * n[2], n[2] * n[0])), mt = new Uint8Array(mc.length);
    for (let d = 0; d < 3; d++) for (const s of [1, -1]) {
      const u = (d + 1) % 3, v = (d + 2) % 3, nu = n[u], nv = n[v];
      for (let q = 0; q < n[d]; q++) {
        for (let b = 0; b < nv; b++) for (let a = 0; a < nu; a++) {
          p[d] = q; p[u] = a; p[v] = b;
          const ci = at(p[0], p[1], p[2]), c = g.col[ci], r = q + s;
          let e = 0;
          if (c) { if (r < 0 || r >= n[d]) e = 1; else { p[d] = r; e = g.col[at(p[0], p[1], p[2])] ? 0 : 1; } }
          mc[a + nu * b] = e ? c : 0; mt[a + nu * b] = e ? g.tag[ci] : 0;
        }
        for (let b = 0; b < nv; b++) for (let a = 0; a < nu;) {
          const c = mc[a + nu * b], t = mt[a + nu * b];
          if (!c) { a++; continue; }
          let w = 1, h = 1;
          while (a + w < nu && mc[a + w + nu * b] === c && mt[a + w + nu * b] === t) w++;
          grow: for (; b + h < nv; h++) for (let x = 0; x < w; x++) { const k = a + x + nu * (b + h); if (mc[k] !== c || mt[k] !== t) break grow; }
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mc[a + x + nu * (b + y)] = 0;
          if (!Q.has(t)) Q.set(t, []);
          Q.get(t).push([d, s, q + (s > 0 ? 1 : 0), u, a, a + w, v, b, b + h, c]);
          a += w;
        }
      }
    }
    const pos = [], nor = [], colr = [], idx = [], tri = [], tags = [], geo = new THREE.BufferGeometry();
    for (const t of [...Q.keys()].sort((x, y) => x - y)) {
      const gi = tags.length, start = idx.length;
      tags.push(g.tags[t] || path);
      for (const [d, s, D, u, a0, a1, v, b0, b1, c] of Q.get(t)) {
        const base = pos.length / 3, nn = [0, 0, 0], f = hs ? 1 + (hs(d * 7 + D, a0 * 3 + b0, s + u) - 0.5) * 0.08 : 1;
        nn[d] = s;
        for (const [A, B] of [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]) {
          const P3 = [0, 0, 0]; P3[d] = D; P3[u] = A; P3[v] = B;
          pos.push(off(0, P3[0]), off(1, P3[1]), off(2, P3[2])); nor.push(nn[0], nn[1], nn[2]);
          colr.push(LIN((c >> 16) & 255) * f, LIN((c >> 8) & 255) * f, LIN(c & 255) * f);
        }
        if (s > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3); else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        tri.push(gi, gi);
      }
      geo.addGroup(start, idx.length - start, gi);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    geo.setIndex(idx);
    return { geo, tags, tri: Uint16Array.from(tri) };
  };

  let K = null;                                    // 一次 build 的共享状态（材质、输出、风铃骨骼）
  let version = 0;                                 // 每建一个风铃 +1：91-cabin 按它重新找能点的东西（方块读得晚、风铃后加进场景时也找得到）
  // o: { id, path, pos, rot, off:[dx,dy,dz]（格）, bones, ud }。墙上物件 off z = 0.5：格 z 从墙外皮往外数（z ≤ -1 在墙里）
  // 无骨骼 → 贪心合面单网格；有骨骼（风铃）→ V3.vox.build（每根骨骼一块网格）
  const item = (g, o) => {
    let root, bones = [], meshes;
    if (o.bones) {
      const v = V3.vox.build(g, { scale: S, bones: o.bones, part: o.path, anchor: 'house2:' + o.id, material: K.base, noise: 0.05, ao: 0.5 });
      root = v.root; bones = v.bones; meshes = v.meshes;
    } else {
      const m = gmesh(g, o.path), mesh = new THREE.Mesh(m.geo, m.tags.map(() => K.base));
      mesh.name = 'house2:' + o.id;
      Object.assign(mesh.userData, { faceTags: m.tags, triTag: m.tri, anchor: 'house2:' + o.id, part: o.path });
      V3.parts.tagFaces(mesh);
      root = new THREE.Group(); root.add(mesh); meshes = [mesh];
    }
    for (const m of meshes) m.userData.faceTags.forEach((t, i) => {
      if (GLOW.test(t)) m.material[i] = K.glow;
    });
    const off = o.off || [0, 0, 0];
    root.position.x += off[0] * S; root.position.y += off[1] * S; root.position.z += off[2] * S;
    const gr = new THREE.Group();
    gr.name = 'house2:' + o.id;
    gr.position.set(o.pos[0], o.pos[1], o.pos[2]);
    gr.rotation.y = o.rot || 0;
    gr.add(root);
    Object.assign(gr.userData, o.ud || {});
    K.out.push(gr);
    return { gr, root, bones };
  };
  // 玻璃 = 两片单面：朝外一片夜里发暖光（屋外看是暖黄窗），朝里一片普通淡蓝半透明（屋里看是夜色），相距 1.5 mm
  const glass = (gr, id, path, w, h, x, y, z) => {
    [[K.glassOut, 0.00075, 0, ''], [K.glassIn, -0.00075, Math.PI, '-in']].forEach(([mat, dz, ry, sfx]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(x, y, z + dz); m.rotation.y = ry; m.renderOrder = 1;
      Object.assign(m.userData, { noShadow: true, anchor: 'house2:' + id + ':glass' + sfx });
      V3.parts.tag(m, path);
      gr.add(m);
    });
  };
  const onWall = (H, o) => ({ onWall: o.wall, storey: o.y0 >= H.loftY - 1e-6 ? 'loft' : 'ground' });
  const atWall = (H, o) => ({ pos: wallPos(H, o.wall, (o.a0 + o.a1) / 2, o.y0), rot: WF[o.wall], off: [-0.5, 0, 0.5], ud: onWall(H, o) });

  // 矩形窗：窗洞 N×M 格；白框（外框 3 格、中梃 2 格，深 3 格，居墙中）+ 外侧窗台 + 外圈窗套 + 玻璃
  const rectWin = (o) => {
    const H = K.H, N = Math.round((o.a1 - o.a0) / S), M = Math.round((o.y1 - o.y0) / S), h = N / 2, m = M / 2;
    const P = '小屋/门窗/' + short(o.label), g = grid([[-h - 3, h + 4], [-2, M + 3], [-8, 3]]);
    g.t(P + '/窗框').c(COL.frame).fill(-h + 1, 0, -6, h, M - 1, -4, (x, y) =>
      x <= -h + 3 || x >= h - 2 || y <= 2 || y >= M - 3 || x === 0 || x === 1 || y === m - 1 || y === m);
    g.box(-h - 1, M, 0, h + 2, M + 2, 0).box(-h - 1, 1, 0, -h, M - 1, 0).box(h + 1, 1, 0, h + 2, M - 1, 0);
    g.t(P + '/窗台').c(COL.sill).box(-h + 1, 0, -3, h, 0, -1).box(-h - 2, -1, 0, h + 3, 0, 2);
    const { gr } = item(g, Object.assign({ id: o.id, path: P }, atWall(H, o)));
    glass(gr, o.id, P + '/玻璃', N * S, M * S, 0, m * S, -4.5 * S);
  };

  // 山墙圆窗：方块圆洞（6×6 块去四角，同 54-house）里填白板 + 木圈 + 十字窗棂 + 圆窗玻璃
  const roundWin = (o) => {
    const H = K.H, N = Math.round((o.a1 - o.a0) / S), h = N / 2, nb = N / 8, rb = nb / 2, rin = 0.6 / S;
    const P = '小屋/门窗/' + short(o.label), g = grid([[-h, h + 1], [-1, N], [-8, 2]]);
    const inHole = (x, y) => {
      const bi = Math.floor((x - 1 + h) / 8), bj = Math.floor(y / 8);
      return bi >= 0 && bj >= 0 && bi < nb && bj < nb && (bi + 0.5 - rb) ** 2 + (bj + 0.5 - rb) ** 2 <= rb * rb + 1e-6;
    };
    const d = (x, y) => Math.hypot(x - 0.5, y + 0.5 - h), bar = (x, y) => Math.abs(x - 0.5) < 1 || Math.abs(y + 0.5 - h) < 1;
    g.t(P + '/窗框').c(COL.frame).fill(-h + 1, 0, -6, h, N - 1, -2, (x, y, z) =>
      inHole(x, y) && (d(x, y) >= rin || (z >= -5 && z <= -4 && bar(x, y))));
    g.c(COL.timber).fill(-h + 1, 0, -1, h, N - 1, 0, (x, y) => inHole(x, y) && d(x, y) >= rin && d(x, y) < rin + 3);
    const { gr } = item(g, Object.assign({ id: o.id, path: P }, atWall(H, o)));
    glass(gr, o.id, P + '/玻璃', 2 * rin * S, 2 * rin * S, 0, h * S, -4.5 * S);
  };

  // 前门：竖木板门扇（凹进墙面 3 格）+ 边梃/横档 + 上部田字小窗（暖光）+ 铜把手（西侧）+ 铁合页（东侧）+ 门槛
  const door = (o) => {
    const H = K.H, N = Math.round((o.a1 - o.a0) / S), M = Math.round((o.y1 - o.y0) / S), h = N / 2;
    const P = '小屋/门窗/' + short(o.label), g = grid([[-h - 1, h + 2], [-1, M + 1], [-8, 3]]);
    g.t(P + '/门槛').c(COL.dark).box(-h + 1, 0, -8, h, 0, 0);
    g.t(P + '/门板').c(band(COL.doorA, COL.doorB)).fill(-h + 1, 1, -5, h, M - 1, -4);
    g.c(COL.doorB).fill(-h + 1, 1, -3, h, M - 1, -3, (x, y) =>
      x <= -h + 2 || x >= h - 1 || (y >= 4 && y <= 7) || (y >= 28 && y <= 31) || y >= M - 3);
    g.m('erase').box(-9, 44, -5, 10, 57, -4).m('add');
    g.t(P + '/门板').c(COL.dark).fill(-11, 42, -3, 12, 59, -3, (x, y) =>
      x <= -10 || x >= 11 || y <= 43 || y >= 58 || x === 0 || x === 1 || y === 50 || y === 51);
    g.c(COL.iron).box(h - 9, 10, -2, h - 1, 11, -2).box(h - 8, M - 4, -2, h - 1, M - 3, -2);
    g.t(P + '/门把手').c(COL.brass).box(-h + 4, 33, -2, -h + 5, 35, -1);
    const { gr } = item(g, Object.assign({ id: o.id, path: P }, atWall(H, o)));
    glass(gr, o.id + '-win', P + '/小窗', 20 * S, 14 * S, 0, 51 * S, -4 * S);
  };

  // ---- 墙上和屋外的小物件 ----
  const OUT = { towel: '小屋/毛巾', chime: '小屋/风铃', chest: '场地/木箱和灯笼', stepMat: '场地/台阶地垫' };
  const outPath = (it) => /^box/.test(it.id) ? '小屋/花箱/' + inner(it.label) : OUT[it.id] || '场地/' + short(it.label);
  // 挂墙物：找最近的外墙 → { w, a（沿墙中心）, d0/d1（离墙外皮的近/远距离，m） }
  const wallAt = (H, it) => {
    const w = [['s', Math.abs(it.z0 - H.z1)], ['n', Math.abs(it.z1 - H.z0)], ['e', Math.abs(it.x0 - H.x1)], ['w', Math.abs(it.x1 - H.x0)]]
      .sort((p, q) => p[1] - q[1])[0][0];
    const d = w === 's' ? [it.z0 - H.z1, it.z1 - H.z1] : w === 'n' ? [H.z0 - it.z1, H.z0 - it.z0]
      : w === 'e' ? [it.x0 - H.x1, it.x1 - H.x1] : [H.x0 - it.x1, H.x0 - it.x0];
    return { w, a: w === 's' || w === 'n' ? (it.x0 + it.x1) / 2 : (it.z0 + it.z1) / 2, d0: Math.max(0, d[0]), d1: Math.max(0, d[1]) };
  };
  const hang = (wa, y, odd) => ({ pos: wallPos(K.H, wa.w, wa.a, y), rot: WF[wa.w], off: [odd ? 0 : -0.5, 0, 0.5], ud: { onWall: wa.w, storey: 'ground' } });

  // 花箱：空心木板箱（壁厚 2 格）+ 泥土（花由 58-plants 画在 wallY 处）+ 两个三角铁托架
  const flowerBox = (it) => {
    const wa = wallAt(K.H, it), len = wa.w === 's' || wa.w === 'n' ? it.x1 - it.x0 : it.z1 - it.z0;
    const n = Math.round(len / S / 2), ny = Math.round(0.3 / S), z0 = Math.round(wa.d0 / S), z1 = Math.max(z0 + 6, Math.round(wa.d1 / S) - 1);
    const P = outPath(it), g = grid([[-n, n + 1], [-8, ny], [-1, z1 + 1]]);
    g.t(P).c((x, y) => ((((y + 64) / 3) | 0) & 1) ? COL.boxA : COL.boxB).box(-n + 1, 0, z0, n, ny - 1, z1);
    g.m('erase').box(-n + 3, 2, z0 + 2, n - 2, ny - 1, z1 - 2).m('add');
    g.c(COL.soil).box(-n + 3, 2, z0 + 2, n - 2, ny - 2, z1 - 2);
    g.t(P + '/托架').c(COL.iron);
    for (const x of [-n + 5, n - 4]) {
      g.box(x, -6, 0, x, -1, 0).box(x, -1, 0, x, -1, z1 - 2);
      for (let q = 1; q < 5; q++) g.set(x, -6 + q, q);
    }
    item(g, Object.assign({ id: it.id, path: P }, hang(wa, it.wallY - ny * S, false)));
  };

  // 灯笼（7 × 15 格）：铁底座、四角柱、灯罩（发光）、帽、提环；(x0, y0, z0) = 底面中心格
  // lb：灯罩放进第 lb 根骨骼（P5：壁灯、木箱上的灯笼是模组方块，网页只把发光的灯罩叠上去，网格 'vox:lamp'）
  const LAMP_BONES = [{ name: 'root', pivot: [0, 0, 0], parent: -1 }, { name: 'lamp', pivot: [0, 0, 0], parent: 0 }];
  const lantern = (g, P, x0, y0, z0, lb) => {
    g.t(P).c(COL.iron).box(x0 - 3, y0, z0 - 3, x0 + 3, y0 + 1, z0 + 3)
      .fill(x0 - 3, y0 + 2, z0 - 3, x0 + 3, y0 + 9, z0 + 3, (x, y, z) => Math.abs(x - x0) === 3 && Math.abs(z - z0) === 3)
      .box(x0 - 3, y0 + 10, z0 - 3, x0 + 3, y0 + 10, z0 + 3).box(x0 - 2, y0 + 11, z0 - 2, x0 + 2, y0 + 11, z0 + 2)
      .box(x0 - 1, y0 + 12, z0 - 1, x0 + 1, y0 + 12, z0 + 1).box(x0, y0 + 13, z0, x0, y0 + 14, z0);
    if (lb) g.b(lb);
    g.t(P + '/灯').c(COL.lamp).box(x0 - 2, y0 + 2, z0 - 2, x0 + 2, y0 + 9, z0 + 2);
    if (lb) g.b(0);
  };
  const porchLantern = (id, name, x, z) => {
    const P = '小屋/灯笼/' + name, g = grid([[-3, 3], [0, 14], [-3, 3]]);
    lantern(g, P, 0, 0, 0);
    item(g, { id, path: P, pos: [x, K.postTop, z], ud: { layer: 'ground' } });
  };
  // 门两侧壁灯：墙上小铁板 + 横臂 + 吊钩，灯笼背面离墙 6 cm
  const wallLantern = (id, name, w, a, y) => {
    const P = '小屋/灯笼/' + name, g = grid([[-3, 3], [0, 20], [0, 9]]);
    g.t(P).c(COL.iron).box(-1, 6, 0, 1, 20, 0).box(0, 18, 1, 0, 19, 5).box(0, 15, 5, 0, 17, 5);
    lantern(g, P, 0, 0, 5, 1);
    item(g, Object.assign({ id, path: P, bones: LAMP_BONES }, hang({ w, a }, y, true)));
  };

  // 木箱：木板箱身 + 盖子（四周挑出 1 格）+ 两道铁箍 + 朝南铜锁 + 两侧铁把手 + 盖上一盏灯笼
  // P5（模组方块 xiaojingyu:crate_lantern，1 格）：箱子矮 2 格，连灯笼正好 1 米高；布局带 block 时不转、放在格子底上（和方块一样）
  const chest = (it) => {
    const odd = (v) => Math.floor((v / S - 1) / 2) * 2 + 1, hx = (odd(it.x1 - it.x0) - 3) / 2, hz = (odd(it.z1 - it.z0) - 3) / 2;
    const P = outPath(it), g = grid([[-hx - 2, hx + 2], [0, 34], [-hz - 3, hz + 3]]);
    g.t(P).c((x, y) => (((y + 64) >> 2) & 1) ? COL.chestA : COL.chestB).box(-hx, 0, -hz, hx, 12, hz);
    g.c((x, y, z) => (((z + 64) >> 2) & 1) ? COL.chestA : COL.chestB).box(-hx - 1, 13, -hz - 1, hx + 1, 16, hz + 1);
    g.c(COL.iron);
    for (const x of [-hx + 3, hx - 4]) g.fill(x, 0, -hz - 2, x + 1, 17, hz + 2, (_, y, z) => y === 17 || Math.abs(z) === (y <= 12 ? hz + 1 : hz + 2));
    g.box(-hx - 1, 7, -3, -hx - 1, 8, 3).box(hx + 1, 7, -3, hx + 1, 8, 3).box(-1, 11, hz + 2, 1, 15, hz + 2);
    g.c(COL.brass).box(-2, 7, hz + 1, 2, 11, hz + 1);
    lantern(g, P, 0, 17, -hz + 5, 1);
    const L = K.L, cx = (it.x0 + it.x1) / 2, cz = (it.z0 + it.z1) / 2;
    const y0 = (hAt(L, it.x0, it.z0) + hAt(L, it.x1, it.z0) + hAt(L, it.x0, it.z1) + hAt(L, it.x1, it.z1)) / 4, y = it.block ? Math.round(y0) : y0 - 0.02;
    item(g, { id: it.id, path: P, pos: [cx, y, cz], rot: it.block ? 0 : -0.12, bones: LAMP_BONES, ud: { layer: 'site' } });
    K.lampChests.push([cx, y + 23 * S, cz - (hz - 5) * S]);
  };

  // 毛巾：门右边墙上的铁挂钩 + 搭在钩上的蓝白条纹毛巾（前片长、后片短）
  const towel = (it) => {
    const P = outPath(it), g = grid([[-7, 7], [-28, 2], [0, 5]]);
    g.t(P + '/挂钩').c(COL.iron).box(-1, 1, 0, 0, 1, 5).box(-1, 2, 5, 0, 2, 5);
    g.t(P).c((x, y) => (((y + 64) >> 2) & 1) ? COL.towelA : COL.towelB)
      .box(-6, 0, 0, 5, 0, 4).box(-6, -26, 3, 5, -1, 4).box(-6, -14, 0, 5, -1, 1);
    item(g, Object.assign({ id: it.id, path: P }, hang(wallAt(K.H, it), it.wallY, false)));
  };

  // 台阶下地垫：黄麻编织纹 + 深色包边，平铺在沙上（取四角和中心的最高沙面）
  const stepMat = (it) => {
    const odd = (v) => Math.floor(v / S / 2) * 2 + 1, hx = (odd(it.x1 - it.x0) - 1) / 2, hz = (odd(it.z1 - it.z0) - 1) / 2;
    const P = outPath(it), g = grid([[-hx, hx], [0, 0], [-hz, hz]]);
    g.t(P).c((x, y, z) => Math.abs(x) >= hx - 1 || Math.abs(z) >= hz - 1 ? COL.timber
      : ((((x + 64) >> 1) + ((z + 64) >> 1)) & 1) ? COL.jute : COL.juteD).box(-hx, 0, -hz, hx, 0, hz);
    const L = K.L, cx = (it.x0 + it.x1) / 2, cz = (it.z0 + it.z1) / 2;
    const y = Math.max(hAt(L, cx, cz), hAt(L, it.x0, it.z0), hAt(L, it.x1, it.z0), hAt(L, it.x0, it.z1), hAt(L, it.x1, it.z1));
    item(g, { id: it.id, path: P, pos: [cx, y + 0.005, cz], ud: { layer: 'site' } });
  };

  // 贝壳风铃：门上方墙上的小铁臂 + 漂流木横条 + 3 串贝壳（每串一根骨骼，update 里随风摆）
  const chime = (it) => {
    const P = outPath(it), g = grid([[-6, 6], [-22, 2], [0, 11]]), xs = [-4, 0, 4];
    g.t(P + '/铁臂').c(COL.iron).box(-1, -2, 0, 1, 2, 0).box(0, 1, 1, 0, 1, 9).box(0, -1, 9, 0, 0, 9);
    g.t(P).c(COL.drift).box(-5, -2, 8, 5, -2, 10);
    xs.forEach((x, i) => {
      const n = i === 1 ? 4 : 3, len = 4 * n + (i & 1) * 2;
      g.b(i + 1).c(COL.thread).box(x, -2 - len, 9, x, -3, 9);
      for (let q = 0; q < n; q++) { const y = -5 - 4 * q - (i & 1) * 2; g.c(COL.shells[(i + q) % 3]).box(x - 1, y - 1, 8, x + 1, y, 10); }
    });
    g.b(0);
    const bones = [{ name: 'root', pivot: [0, 0, 0], parent: -1 }].concat(xs.map((x, i) => ({ name: 's' + i, pivot: [x, -2, 9], parent: 0 })));
    const wa = wallAt(K.H, it), r = item(g, Object.assign({ id: it.id, path: P, bones }, hang(wa, it.wallY, true)));
    K.chimes.push({ gr: r.gr, rot: WF[wa.w], kick: 0, gust: 0, since: 9, sway: r.bones.slice(1), cell: null });   // 方块版：cell = 风铃方块那格（onBlocks 填）
    // 点得到（91-cabin 的 'chime' → 66-chime-sound 的 click）：挂在屋外，屋顶盖着也算（clickAlways）；贝壳串细、会摆，
    // 另加一块看不见的盒子罩住三串贝壳，点在串和串之间也算点到（描边只描看得见的网格）。
    // 只在游戏场景里加：工作台 / 导出 MC 模型（ctx.studio）把这件家具的每个网格都当成要导出的东西，
    // 多出一块没有体素的盒子会被 furn-mc 当成「没处理的平面」报错。
    if (!K.studio) {
      const pick = new THREE.Mesh(new THREE.BoxGeometry(13 * S, 23 * S, 5 * S), K.pick || (K.pick = new THREE.MeshBasicMaterial({ visible: false })));
      pick.name = 'house2:chime:pick'; pick.position.set(0, -11.5 * S, 9.5 * S);
      Object.assign(pick.userData, { noShadow: true, noReceive: true, fbOverlay: true });   // fbOverlay：反馈工具不点这块看不见的盒子
      r.gr.add(pick);
    }
    Object.assign(r.gr.userData, { lastClink: -1, clinks: 0, clickable: 'chime', clickAlways: true });
    version++;
  };

  // ---- 灯笼命名：门两侧 = 门左/门右（从屋外看），门廊柱 = 门廊西角/门廊西/门廊东/门廊东角 ----
  const lanternNames = (L) => {
    const H = L.house, P = L.porch, d = L.openings.find(isDoor), dc = d ? (d.a0 + d.a1) / 2 : (H.x0 + H.x1) / 2, used = {};
    return L.lanterns.map(([x, z]) => {
      let n = Math.abs(z - H.z1) < 0.5 ? (x < dc ? '门左' : '门右')
        : Math.abs(x - P.x0) < 0.5 ? '门廊西角' : Math.abs(x - P.x1) < 0.5 ? '门廊东角' : x < 0 ? '门廊西' : '门廊东';
      used[n] = (used[n] || 0) + 1;
      if (used[n] > 1) n += used[n];
      return n;
    });
  };
  const isDoor = (o) => !o.round && o.wall === 's' && Math.abs(o.y0 - V3.layout.house.floorY) < 1e-6 && /门/.test(o.label);

  // ---- 方块版：照布局建好的一件（gr）搬到方块那里（p = V3.houseBlocks.furnPlaced 的一条）----
  const SIDES = ['n', 'e', 's', 'w'];                               // 从上往下看顺时针，和 MC 的 facing 一样转
  const DIR = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  function moveTo(gr, p) {
    const HBk = V3.houseBlocks, H = HBk && HBk.placedLayout ? HBk.placedLayout().house : K.H, u = gr.userData, mv = p.mv;   // 方块在摆好以后的房子里：外墙按摆好以后的算
    if (mv.same) return;
    const q = mv.point(gr.position.toArray());
    gr.position.set(q[0], q[1], q[2]); gr.rotation.y = mv.yaw(gr.rotation.y);
    const [x, y, z] = p.cell, inH = (a, b) => a >= H.x0 && a < H.x1 && b >= H.z0 && b < H.z1;
    if (u.onWall) {                                                  // 还挂在外墙上（背后那格是外墙那一圈）才算挂墙：剖开时跟着那面墙藏
      const d = DIR[p.facing] || [0, 0], bx = x - d[0], bz = z - d[1], ring = inH(bx, bz) && (bx === H.x0 || bx === H.x1 - 1 || bz === H.z0 || bz === H.z1 - 1);
      if (ring && !inH(x, z)) { u.onWall = SIDES[(SIDES.indexOf(u.onWall) + mv.k) % 4]; u.storey = y >= H.loftY - 1 ? 'loft' : 'ground'; return; }
      delete u.onWall; delete u.storey;
    }
    u.layer = inH(x, z) ? (y >= H.loftY - 1 ? 'loft' : 'ground') : 'site';
  }
  // 点光：相距 2.5 米以内的并成一盏（默认房子门两边的两盏壁灯合成一盏，和以前一样）
  function clusters(pts, r) {
    const out = [];
    for (const p of pts) {
      const c = out.find((g) => g.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) <= r));
      if (c) c.push(p); else out.push([p]);
    }
    return out;
  }
  function onBlocks(ctx, later, grp, names) {
    const L = K.L, H = K.H, FM = V3.furnMc, HB = V3.houseBlocks, keepOf = (b) => FM.webKeep(ctx, b);
    // 木箱灯笼、风铃……：房子里这种方块每件一份
    for (const it of later) {
      const f = FM.byBlock(it.block), k = keepOf(it.block);
      for (const p of HB.furnPlaced(f.block)) {
        if (!p.mv || (p.home ? p.home.id !== it.id : (f.layout && f.layout.id) !== it.id)) continue;
        const m0 = K.out.length, c0 = K.lampChests.length, h0 = K.chimes.length;
        ({ towel, chime, chest, stepMat }[it.id] || flowerBox)(it);
        for (const gr of K.out.slice(m0)) { moveTo(gr, p); gr.userData.cell = p.cell.slice(); if (k) FM.prune(gr, k); }
        for (let i = c0; i < K.lampChests.length; i++) K.lampChests[i] = p.mv.point(K.lampChests[i]);
        for (const ch of K.chimes.slice(h0)) { ch.rot = ch.gr.rotation.y; ch.cell = p.cell.slice(); }
      }
    }
    // 门边壁灯：房子里每盏 wall_lantern。默认房子里那两盏照旧叫 lantern0 / lantern1（门左 / 门右），别处的叫「壁灯 2」……
    const wl = FM.byBlock('xiaojingyu:wall_lantern'), kw = wl ? keepOf(wl) : null;
    if (wl && kw !== null) {
      let extra = 0;
      for (const p of HB.furnPlaced(wl.block)) {
        if (!p.mv) continue;
        const ri = +((/^lantern(\d+)$/.exec(p.ref.id) || [])[1] || 0), x = (L.lanterns[ri] || [p.ref.cell[0] + 0.5])[0];
        const hi = p.home ? +((/^lantern(\d+)$/.exec(p.home.id) || [])[1]) : NaN;
        const id = Number.isFinite(hi) ? 'lantern' + hi : 'lantern@' + p.cell.join('_'), name = Number.isFinite(hi) ? names[hi] : '壁灯 ' + (++extra + 1);
        if (!Number.isFinite(hi)) V3.parts.declare(['小屋/灯笼/' + name], { ['小屋/灯笼/' + name]: '灯笼（' + name + '）' });
        const m0 = K.out.length;
        wallLantern(id, name, 's', x, 2.3);
        for (const gr of K.out.slice(m0)) { moveTo(gr, p); gr.userData.cell = p.cell.slice(); if (kw) FM.prune(gr, kw); }
        grp.door.push(p.mv.point([x, 2.5, H.z1 + 0.3]));
      }
    }
    if (!ctx.lamp) return;
    const avg = (a) => [0, 1, 2].map((k) => a.reduce((s, q) => s + q[k], 0) / a.length);
    for (const c of clusters(grp.door, 2.5)) ctx.lamp({ pos: avg(c), color: COL.lamp });
    for (const k of ['w', 'e']) if (grp[k].length) ctx.lamp({ pos: avg(grp[k]), color: COL.lamp });
    for (const q of K.lampChests) ctx.lamp({ pos: q, color: COL.lamp });
  }

  V3.scene.part({
    id: 'house-detail', label: '房子细节（花箱、壁灯、风铃、毛巾）', order: 45,
    build(ctx) {
      const L = ctx.L || V3.layout, H = L.house, P = L.porch, D = V3.house && V3.house.dims ? V3.house.dims(L) : null;
      const glow = (hex, o) => ctx.glowMat ? ctx.glowMat(hex, o) : new THREE.MeshStandardMaterial({ color: hex, transparent: !!o.transparent, opacity: o.opacity ?? 1 });
      K = { L, H, out: [], chimes: [], lampChests: [], late: null, studio: !!ctx.studio, base: V3.vox.material({ roughness: 0.85 }),
        glow: glow(COL.lamp, { day: 0.15, night: 2.5 }),
        glassOut: glow(COL.glass, { transparent: true, opacity: 0.55, day: 0, night: 1.2 }),
        glassIn: new THREE.MeshStandardMaterial({ color: COL.glass, transparent: true, opacity: 0.4, roughness: 0.08, depthWrite: false }),
        postTop: P.y + Math.ceil(P.railH / C - 1e-6) * C };
      K.base.vertexColors = true;
      if (K.glassOut.emissive) K.glassOut.emissive.set(0xffc27a);
      K.glassOut.depthWrite = false; K.glassOut.roughness = 0.08;
      // P5 第 3 轮：带 block 的已经是模组方块（54-house-mc 画）。游戏场景里没 overlay 的不画（花箱箱体、毛巾、地垫），
      // 木箱和壁灯只留发光的灯罩（骨骼 lamp）叠在方块上、点光照旧，风铃整件照画（随风摆）。工作台（ctx.studio）照旧画完整的体素版
      const FM = V3.furnMc, keepOf = (b) => (FM && FM.webKeep ? FM.webKeep(ctx, b) : undefined);
      const names = lanternNames(L), outs = (L.outside || []).filter((it) => /^(box|towel|chime|chest|stepMat)/.test(it.id) && keepOf(it.block) !== null);
      const paths = [], labels = {};
      const add = (p, l) => { if (!labels[p]) { paths.push(p); labels[p] = l; } };
      if (!H.blocks) for (const o of L.openings) add('小屋/门窗/' + short(o.label), o.label);
      for (const it of outs.filter((it) => /^box/.test(it.id))) add(outPath(it), it.label);
      names.forEach((n) => add('小屋/灯笼/' + n, '灯笼（' + n + '）'));
      for (const it of outs.filter((it) => !/^box/.test(it.id))) add(outPath(it), it.label);
      V3.parts.declare(paths, labels);
      // 门窗
      if (!H.blocks) for (const o of L.openings) {
        if (o.round) roundWin(o); else if (isDoor(o)) door(o); else rectWin(o);
      }
      // 方块版（游戏场景、房子是方块）：布局里带 block、规格里写了房子里摆法的（木箱灯笼、风铃、门边壁灯），房子方块里有几件就画几件、
      // 按方块的格子和 facing 摆（没有就不画），灯光也跟着；体素版先照布局（默认房子里的摆法）建好，再用 V3.furnMc.mover 搬过去
      const HB = V3.houseBlocks, blockMode = !!(H.blocks && !ctx.studio && FM && FM.mover && HB && HB.whenGrid);
      const onBlock = (b) => { const f = blockMode && b && FM.byBlock(b); return !!(f && f.house); };
      // 花箱、毛巾、风铃、木箱、地垫
      const later = [];
      for (const it of outs) {
        if (onBlock(it.block)) { later.push(it); continue; }
        const n0 = K.out.length, k = keepOf(it.block);
        ({ towel, chime, chest, stepMat }[it.id] || flowerBox)(it);
        if (k) for (const o of K.out.slice(n0)) FM.prune(o, k);
      }
      // 灯笼：门两侧挂墙，门廊柱头上；门两盏共用 1 盏点光，门廊东西各 1 盏，木箱 1 盏（共 ≤ 4）
      const grp = { door: [], w: [], e: [] };
      L.lanterns.forEach(([x, z], i) => {
        const id = 'lantern' + i;
        if (Math.abs(z - H.z1) < 0.5) {
          const f = FM && FM.byLayout ? FM.byLayout(id, 'lanterns') : undefined, k = keepOf(f);   // 门边壁灯 = xiaojingyu:wall_lantern
          if (k === null || onBlock(f && f.block)) return;                                        // 方块版：下面按方块摆
          const n0 = K.out.length;
          wallLantern(id, names[i], 's', x, 2.3);
          if (k) for (const o of K.out.slice(n0)) FM.prune(o, k);
          grp.door.push([x, 2.5, H.z1 + 0.3]);
        } else {
          const cx = Math.min(P.x1 - C, Math.max(P.x0, Math.floor(x / C + 1e-6) * C)) + C / 2, cz = P.z1 - C / 2;
          porchLantern(id, names[i], cx, cz);
          (x < 0 ? grp.w : grp.e).push([cx, K.postTop + 0.2, cz + 0.15]);
        }
      });
      const avg = (a) => [0, 1, 2].map((k) => a.reduce((s, p) => s + p[k], 0) / a.length);
      if (!blockMode) {
        for (const k of ['door', 'w', 'e']) if (grp[k].length && ctx.lamp) ctx.lamp({ pos: avg(grp[k]), color: COL.lamp });
        for (const p of K.lampChests) if (ctx.lamp) ctx.lamp({ pos: p, color: COL.lamp });
      } else {
        const me = K, sync = !!HB.grid;
        if (!sync) { me.late = new THREE.Group(); me.late.name = 'house-detail-blocks'; me.out.push(me.late); }
        HB.whenGrid(ctx, () => { if (K !== me) return; const n0 = me.out.length; onBlocks(ctx, later, grp, names); if (!sync) for (const o of me.out.slice(n0)) me.late.add(o); });
      }
      if (!D && !H.blocks) V3.err('house-detail: V3.house.dims 不可用（54-house 未加载），只按布局放置');
      return K.out;
    },
    // 风铃：摆幅 ∝ 风力；阵风上升沿碰响，按方块坐标通知音效模块。
    update(dt) {
      if (!K || !K.chimes.length) return;
      dt = Math.min(dt || 0, 0.1);
      const W = (V3.env && V3.env.state && V3.env.state.wind) || null;
      const sp = W ? W.speed || 0 : 0, gu = W ? W.gust || 0 : 0, dir = (W && W.dir) || [0, 0];
      for (const ch of K.chimes) {
        if (!ch.sway.length) continue;
        ch.since += dt;
        if (gu > 0.35 && ch.gust <= 0.35 && ch.since > 1.5) {
          ch.kick = 1; ch.since = 0;
          ch.gr.userData.lastClink = W && W.t != null ? W.t : (V3.env && V3.env.state && V3.env.state.t) || 0;
          ch.gr.userData.clinks++;
          if (ch.cell && V3.emit) V3.emit('chime:gust', ch.cell.slice());
        }
        ch.gust = gu;
        ch.kick *= Math.exp(-dt * 3);
        ch.ph = (ch.ph || 0) + dt * (1.4 + gu);
        const c = Math.cos(ch.rot), s = Math.sin(ch.rot), lx = c * dir[0] - s * dir[1], lz = s * dir[0] + c * dir[1];
        const lean = 0.18 * sp, amp = 0.1 * sp + 0.06 * ch.kick;
        ch.sway.forEach((b, i) => {
          b.rotation.z = lean * lx + amp * Math.sin(ch.ph * 1.7 + 1.3 * i) + 0.05 * ch.kick * Math.sin(ch.ph * 9 + 2 * i);
          b.rotation.x = -lean * lz + 0.7 * amp * Math.sin(ch.ph * 1.3 + 0.7 * i + 1);
        });
      }
    },
    dispose() { K = null; },
  });
  // 有人从风铃下面走过（66-chime-sound）：那个风铃（cell = 方块格子；不给就全部）的体素版被碰一下，和阵风一样摆起来。
  // 点了一下风铃：obj = 被点的那一组（house2:chime），只摆它自己（旧布局的风铃没有格子，也这样认）
  V3.houseDetail = {
    get version() { return version; },
    chimeKick(cell, obj) {
      if (!K) return;
      let hit = obj ? K.chimes.filter((ch) => ch.gr === obj) : [];
      if (!hit.length && cell) hit = K.chimes.filter((ch) => ch.cell && ch.cell.every((v, k) => v === cell[k]));
      for (const ch of hit.length ? hit : K.chimes) { ch.kick = 1; ch.since = 0; ch.gr.userData.clinks++; }
    },
    chimes: () => (K ? K.chimes.map((ch) => ({ cell: ch.cell && ch.cell.slice(), pos: ch.gr.position.toArray(), clinks: ch.gr.userData.clinks })) : []),
  };
})(window.V3);
