// 30-shell-kit.js — 贝壳的三角面雕刻工具（2026-11-12）：12 种经典贝壳从体素改成自由三角面，和 31-washup-catalog 的潮汐拾物一个做法。
// 体素版原样留在 30-shells.js（MAKERS），备份在 _backups/cabin-shells-voxel-20261112/；网址带 ?shells=voxel 时仍用体素版（对照用）。
// 用法（30-shell-m*.js）：V3.shellKit.model(id, ({ tri, quad, loft, add, beam, tube }) => { … })；单位随意，30-shells 会按 KINDS.size 归一
//   （最长边 = size、底面 y=0、水平居中）。颜色是顶点色（0xRRGGBB），每个三角一个颜色，法线按面算（平直着色，和原来的体素风格一致）。
//   tri(a, b, c, col)        一个三角（a→b→c 逆时针 = 朝外）
//   quad(a, b, c, d, col)    两个三角（a b c d 逆时针）
//   loft(sections, paint, { cap0, cap1 })  一圈圈截面连成管 / 壳；sections[r][i] 是第 r 圈第 i 个点（每圈点数相同、按同一方向绕），
//                            paint(r, i) → 颜色（r = −1 起始盖，r = sections.length−1 结束盖）；cap0 / cap1 = false 不封口
//   add(geometry, col)       并入一个 THREE 几何（会被 dispose）
//   beam(a, b, ra, rb, col, sides)  两点之间的圆台
//   tube(points, radius(t) | number, col(t, j) | number, sides)  沿折线走的管子，两头封口
// V3.shellKit.makers：id → () => BufferGeometry（非索引，有 position / normal / color）；30-shells 的 geoOf 先找这里。
(function (V3) {
  'use strict';
  const K = V3.shellKit = V3.shellKit || {};
  K.makers = K.makers || {};
  K.legacy = typeof location !== 'undefined' && /[?&]shells=voxel(&|$)/.test(location.search || '');
  const TAU = Math.PI * 2;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  K.TAU = TAU;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  K.sculpt = function sculpt(draw) {
    const pos = [], colors = [], c = new THREE.Color();
    const push = (a, b, d, color) => { c.setHex(color); for (const p of [a, b, d]) { pos.push(p[0], p[1], p[2]); colors.push(c.r, c.g, c.b); } };
    // want：这个三角应该朝哪个方向（局部坐标里的向量）；给了就按它定绕向，不用自己算顺逆。map：画到哪（旋转 / 平移，不改朝向）
    const tri = (a, b, d, color, want, map) => {
      const n = cross(sub(b, a), sub(d, a));
      if (len(n) < 1e-9) return;
      if (want && dot(n, want) < 0) { const t = b; b = d; d = t; }
      if (map) { a = map(a); b = map(b); d = map(d); }
      push(a, b, d, color);
    };
    // color 可以是 [c1, c2]：两个三角各自的颜色（a b d 一个、a d e 一个，lens 里 = 靠内圈右下半 / 靠外圈左上半），画斜纹用
    const quad = (a, b, d, e, color, want, map) => { const two = Array.isArray(color); tri(a, b, d, two ? color[0] : color, want, map); tri(a, d, e, two ? color[1] : color, want, map); };
    const add = (geo, color) => {
      const g = geo.index ? geo.toNonIndexed() : geo, p = g.getAttribute('position');
      for (let i = 0; i < p.count; i += 3) {
        const a = [p.getX(i), p.getY(i), p.getZ(i)], b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)], d = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
        tri(a, b, d, typeof color === 'function' ? color(cross(sub(b, a), sub(d, a)), a) : color);
      }
      if (g !== geo) g.dispose(); geo.dispose();
    };
    const centre = (ring) => [0, 1, 2].map((k) => ring.reduce((s, p) => s + p[k], 0) / ring.length);
    // loft：一圈圈截面连成管。每个面都朝「离开所在那一圈中心」的方向（管子截面是凸的就对）；两头的盖朝管子外面
    const loft = (sections, paint, o = {}) => {
      const n = sections[0].length, end = sections.length - 1, C = sections.map(centre), map = o.map;
      if (o.cap0 !== false) { const m = o.c0 || C[0], w = sub(C[0], C[1]); for (let i = 0; i < n; i++) tri(m, sections[0][i], sections[0][(i + 1) % n], paint(-1, i), w, map); }
      if (o.cap1 !== false) { const m = o.c1 || C[end], w = sub(C[end], C[end - 1]); for (let i = 0; i < n; i++) tri(m, sections[end][i], sections[end][(i + 1) % n], paint(end, i), w, map); }
      for (let r = 0; r < end; r++) for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = sections[r][i], b = sections[r][j], d = sections[r + 1][j], e = sections[r + 1][i];
        const mid = [0, 1, 2].map((k) => (a[k] + b[k] + d[k] + e[k]) / 4), cc = [0, 1, 2].map((k) => (C[r][k] + C[r + 1][k]) / 2);
        quad(a, b, d, e, paint(r, i), sub(mid, cc), map);
      }
    };
    const beam = (a, b, ra, rb, color, sides = 6) => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A), mid = A.clone().lerp(B, 0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      add(new THREE.CylinderGeometry(rb, ra, dir.length(), sides).applyQuaternion(q).translate(mid.x, mid.y, mid.z), color);
    };
    // lens：俯视是个星形轮廓（outline(i) → [x, z]，绕 centre 一圈；open = 扇形不闭合）的「壳」：上表面 top、下表面 bot（不给 = 平底 y = floor），
    //   中间一圈圈按 ts（0 中心 … 1 边）往中心缩。上表面朝上、下表面朝下、边墙朝外。颜色：colTop(r, i, p) / colBot(r, i, p) / colRim(i, p)，
    //   p = 这一格中心 [x, y, z]、r = 第几圈（0 起）、i = 第几个角。map：画完再整体搬（旋转 / 平移）
    const lens = (o) => {
      const n = o.n, ts = o.ts, R = ts.length - 1, cx = o.centre ? o.centre[0] : 0, cz = o.centre ? o.centre[1] : 0, open = !!o.open, map = o.map;
      const B = Array.from({ length: n }, (_, i) => o.outline(i));
      const xz = (t, i) => [cx + (B[i][0] - cx) * t, cz + (B[i][1] - cz) * t];
      const T = ts.map((t, r) => B.map((_, i) => { const [x, z] = xz(t, i); return [x, o.top(t, i, x, z, r), z]; }));
      const floor = o.floor || 0;
      const Bo = o.bot ? ts.map((t, r) => B.map((_, i) => { const [x, z] = xz(t, i); return [x, o.bot(t, i, x, z, r), z]; })) : null;
      const m4 = (a, b, d, e) => [0, 1, 2].map((k) => (a[k] + b[k] + d[k] + e[k]) / 4);
      const segs = open ? n - 1 : n, UP = [0, 1, 0], DN = [0, -1, 0];
      for (let r = 0; r < R; r++) for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        quad(T[r][i], T[r][j], T[r + 1][j], T[r + 1][i], o.colTop(r, i, m4(T[r][i], T[r][j], T[r + 1][j], T[r + 1][i])), UP, map);
        if (Bo) quad(Bo[r][i], Bo[r][j], Bo[r + 1][j], Bo[r + 1][i], o.colBot(r, i, m4(Bo[r][i], Bo[r][j], Bo[r + 1][j], Bo[r + 1][i])), DN, map);
      }
      const low = (r, i) => (Bo ? Bo[r][i] : [T[r][i][0], floor, T[r][i][2]]);
      const C3 = [cx, 0, cz];
      for (let i = 0; i < segs; i++) {                                     // 外圈的边墙
        const j = (i + 1) % n, a = T[R][i], b = T[R][j], d = low(R, j), e = low(R, i), mid = m4(a, b, d, e);
        quad(a, b, d, e, (o.colRim || o.colTop)(i, mid), [mid[0] - cx, 0, mid[2] - cz], map);
        if (!Bo) tri([cx, floor, cz], [b[0], floor, b[2]], [a[0], floor, a[2]], o.colBot ? o.colBot(R, i, [cx, floor, cz]) : (o.colRim || o.colTop)(i, mid), DN, map);
      }
      if (open) {                                                           // 扇形的两条直边
        const ctr = [0, 1, 2].map((k) => B.reduce((s, p, i) => s + T[R][i][k], 0) / n);
        for (const i of [0, n - 1]) for (let r = 0; r < R; r++) {
          const a = T[r][i], b = T[r + 1][i], d = low(r + 1, i), e = low(r, i), mid = m4(a, b, d, e);
          quad(a, b, d, e, (o.colRim || o.colTop)(i, mid), [mid[0] - ctr[0], 0, mid[2] - ctr[2]], map);
        }
      }
      return { T, B: Bo };
    };
    draw({ tri, quad, loft, add, beam, lens });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();                                      // 非索引 → 每个面自己的法线（平直着色）
    geo.addGroup(0, pos.length / 3, 0);                              // 30-shells 的 Mesh 用材质数组 [mat]：没有 group 就什么都不画
    return geo;
  };
  // rings(profile, n, warp)：[y, x 半径, z 半径, x 偏移?, z 偏移?] 每行一圈，和 31-washup-catalog 的同名工具一样
  K.rings = (profile, n, warp) => profile.map(([y, rx, rz, x = 0, z = 0], r) => Array.from({ length: n }, (_, i) => {
    const a = TAU * i / n, p = [x + rx * Math.cos(a), y, z + rz * Math.sin(a)];
    return warp ? warp(p, a, i, r) : p;
  }));
  // spiral(o) → { sections, info }：螺（白玉螺、织纹螺、笔螺、凤凰螺、鹦鹉螺）。和 30-shells 体素版的 spiral 用同一套参数：
  //   一根管子绕轴盘旋，每转缩到 q 倍、往壳顶走 drop；th = 从壳口往壳顶转过的角，beta = 绕管子的角（0 = 最外沿，+π/2 = 朝壳顶那边）。
  //   o: turns, q, r（壳口处管半径）, d（轴到管中心）, drop, flat（管子沿轴方向的厚度 ÷ r）, tilt / roll（度）, mirror,
  //   perTurn（每转几圈截面）, sides（截面几个点）, knob {n, at, k}, flare(beta) → 壳口外翻的倍数（不给 = 不翻）, col(info) → 颜色
  //   壳口：最外一圈后面接一个往管子里凹进去的锥（看着是开口），颜色 inner(info)。返回 loft 用的 sections 和 paint。
  K.spiral = (o) => {
    const TAU2 = Math.PI * 2, q = o.q, K2 = (o.drop || 0) / (1 - q), fl = o.flat || 1;
    const t = (o.tilt || 0) * Math.PI / 180, ps = (o.roll || 0) * Math.PI / 180;
    const A = [-Math.cos(t), Math.sin(t), 0], B1 = [Math.sin(t), Math.cos(t), 0], B2 = [0, 0, o.mirror ? -1 : 1];
    const e1 = B1.map((v, i) => Math.cos(ps) * v + Math.sin(ps) * B2[i]);
    const e2 = B1.map((v, i) => Math.cos(ps) * B2[i] - Math.sin(ps) * v);
    const sides = o.sides || 8, per = o.perTurn || 9, N = Math.ceil(o.turns * per);
    const ths = Array.from({ length: N + 1 }, (_, k) => k / N * o.turns * TAU2);
    const at = (th, b, scale = 1) => {
      const s = Math.pow(q, th / TAU2), u = e1.map((v, i) => Math.cos(th) * v + Math.sin(th) * e2[i]);
      let rr = o.r * s * scale;
      if (o.knob) { const turn = th / TAU2, kn = Math.max(0, Math.cos(o.knob.n * th)); rr *= 1 + o.knob.k * kn * Math.exp(-(((b - o.knob.at) / 0.55) ** 2)) * (turn < 2.6 ? 1 : 0); }
      const c = u.map((v, i) => o.d * s * v + A[i] * K2 * (1 - s));
      return { p: c.map((v, i) => v + rr * (Math.cos(b) * u[i] + fl * Math.sin(b) * A[i])), c, s, u };
    };
    const bs = Array.from({ length: sides }, (_, j) => -Math.PI + (j + 0.5) / sides * TAU2);
    const sections = [], meta = [];
    if (o.flare) { sections.push(bs.map((b) => at(0, b, o.flare(b)).p)); meta.push({ th: 0, lip: true }); }
    for (const th of ths) { sections.push(bs.map((b) => at(th, b).p)); meta.push({ th, lip: false }); }
    const info = (r, j) => {
      if (r < 0) return { inn: true, lip: false, th: 0, turn: 0, beta: bs[j], sut: false };
      const m = meta[Math.min(r, meta.length - 1)], m2 = meta[Math.min(r + 1, meta.length - 1)], th = (m.th + m2.th) / 2, b = bs[j] + Math.PI / sides;
      const p = at(th, b).p, sut = Math.abs(b - 2.1) < 0.35;
      return { th, turn: th / TAU2, beta: b, sut, lip: m.lip, inn: false, x: p[0], y: p[1], z: p[2], s: Math.pow(q, th / TAU2) };
    };
    const inside = at(0.9, 0).c;                                       // 壳口的锥尖：往管子里 0.9 弧度
    return { sections, info, c0: inside, at };
  };
  // 一颗球（珍珠）：二十面体细分，每个面按朝向上色 col(法线) → 颜色
  K.ball = (add, c, r, detail, col) => add(new THREE.IcosahedronGeometry(r, detail).translate(c[0], c[1], c[2]), (n) => { const l = Math.hypot(...n) || 1; return col(n.map((v) => v / l)); });
  K.model = (id, draw) => { K.makers[id] = () => K.sculpt(draw); };
  K.mix = (a, b, t) => {
    const f = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
    return f(16) | f(8) | f(0);
  };
  K.hash = (a, b = 0, c = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
})(window.V3);
