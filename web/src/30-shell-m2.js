// 30-shell-m2.js — 六种螺 / 宝贝的三角面雕刻版（2026-11-12）：白玉螺、织纹螺、笔螺、女王凤凰螺、鹦鹉螺、虎斑宝贝。
// 体素原版在 30-shells.js（MAKERS），这里只注册 V3.shellKit.model；大小 / 摆放由 30-shells 的 geoOf 归一。
// 螺用 K.spiral 的 at(th, b) 取点自己排截面（th = 从壳口往壳顶转过的角，b = 绕管子的角，0 = 最外沿、+π/2 = 朝壳顶），
// 再 loft 成管：壳口一头用 c0（管子里面一点）当盖子的锥尖 → 看进去是凹进去的「内壁」颜色。前后圈互相穿插没关系，平直着色看不出接缝。
(function (V3) {
  'use strict';
  const K = V3.shellKit, TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const frac = (v) => v - Math.floor(v);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const addv = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // 体素版 spiral 和 kit 的 spiral 绕向相反（体素 out = cosφ·e1 − sinφ·e2，kit u = cosθ·e1 + sinθ·e2）：
  // kit(mirror = !m, roll = −r) 正好是体素版 (m, r) 的同一个摆法，下面的参数都照抄体素版
  const coil = (o) => K.spiral(Object.assign({}, o, { mirror: !o.mirror, roll: -(o.roll || 0) }));

  // snail(loft, o)：一根盘旋的管子。o = 体素版参数 + per0（壳口那圈每转几圈截面）/ perMin（壳顶每转至少几圈）/ sides，
  //   bump(th, b) → 半径倍数（纵肋珠粒等），paint(f) → 颜色，f = { th, turn, b, s, P, lip, sut, inn, r, i }。
  //   sut：这一格贴着前一圈 / 后一圈的管壁（缝合线），按两圈管子的椭圆截面距离算
  function snail(loft, o) {
    const S = coil(o), at = S.at, T = o.turns * TAU, q = o.q, fl = o.flat || 1, sides = o.sides || 10;
    const t = (o.tilt || 0) * Math.PI / 180, AX = [-Math.cos(t), Math.sin(t), 0];
    const ths = [];
    for (let th = 0; th < T - 1e-6;) {
      ths.push(th);
      const per = Math.max(o.perMin || 5, (o.per0 || 12) * Math.sqrt(Math.pow(q, th / TAU)));
      th += TAU / per;
    }
    ths.push(T);
    const bs = Array.from({ length: sides }, (_, j) => -Math.PI + (j + 0.5) / sides * TAU + (o.b0 || 0));
    const sections = ths.map((th, r) => bs.map((b) => at(th, b, o.bump ? o.bump(th, b, r) : 1).p));
    const ell = (P, th2) => {                                         // P 到第 th2 处那一圈管子的「椭圆半径」（1 = 正好在管壁上）
      const c = at(th2, 0).c, rr = o.r * Math.pow(q, th2 / TAU), v = sub(P, c), al = dot(v, AX);
      return Math.sqrt(Math.max(0, dot(v, v) - al * al) / (rr * rr) + al * al / (rr * rr * fl * fl));
    };
    const SW = o.sutW || 1.3;
    const paint = (r, i) => {
      if (r < 0) return o.paint({ inn: true, th: 0, turn: 0, b: bs[i], s: 1, r, i });
      const r2 = Math.min(r + 1, ths.length - 1), th = (ths[r] + ths[r2]) / 2, b = bs[i] + Math.PI / sides;
      const P = at(th, b).p;
      let sut = false;
      if (th + TAU < T && ell(P, th + TAU) < SW) sut = true;          // 贴着里面那圈（更靠壳顶）
      if (th - TAU > 0 && ell(P, th - TAU) < SW) sut = true;          // 贴着外面那圈
      return o.paint({ inn: false, th, turn: th / TAU, b, s: Math.pow(q, th / TAU), P, lip: r === 0, sut, r, i, end: r >= ths.length - 2 });
    };
    loft(sections, paint, { c0: o.c0 ? o.c0(S) : S.c0 });
    const g = nrm(sub(at(0, 0).c, at(0.05, 0).c));                    // 壳口朝外的方向（顺着管子往外）
    return { S, at, ths, bs, AX, g };
  }

  // 一颗小锥（凤凰螺的瘤）：底面 n 边形（埋在壳里）+ 尖
  function knob(tri, base, out, side, h, w, col, colTip) {
    const o = nrm(out), s1 = nrm(side), s2 = nrm([o[1] * s1[2] - o[2] * s1[1], o[2] * s1[0] - o[0] * s1[2], o[0] * s1[1] - o[1] * s1[0]]);
    const tip = addv(base, o, h), n = 4, ring = [];
    for (let k = 0; k < n; k++) { const a = TAU * k / n + Math.PI / 4; ring.push(addv(addv(addv(base, s1, Math.cos(a) * w), s2, Math.sin(a) * w), o, -0.25 * h)); }
    for (let k = 0; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n], m = [(a[0] + b[0]) / 2 - base[0], (a[1] + b[1]) / 2 - base[1], (a[2] + b[2]) / 2 - base[2]];
      tri(a, b, tip, k % 2 ? col : colTip, addv(m, o, 0.3));
    }
    for (let k = 1; k < n - 1; k++) tri(ring[0], ring[k], ring[k + 1], col, [-o[0], -o[1], -o[2]]);
  }

  // 白玉螺：圆胖洁白、螺塔低；斜躺，顶上看得到一圈圈缝合线，壳口里面粉棕色
  K.model('moon', ({ loft }) => {
    const white = 0xf3e7d5, cream = 0xd2bba7, sutC = 0x97828a, tip = 0xc4ab8e, inside = 0xb87e77, lip = 0xf2e6d2;
    snail(loft, { turns: 3.2, q: 0.36, r: 7.0, d: 5.8, flat: .97, drop: 5.1, tilt: 47, roll: 8, sides: 12, per0: 16, perMin: 5,
      paint: (f) => {
        if (f.inn) return inside;
        if (f.lip) return lip;
        if (f.sut) return sutC;
        if (f.turn > 2.3) return tip;
        return K.mix(white,cream,.10+.48*(.5+.5*Math.cos(f.th*8+f.b*1.6))**4);          // 淡淡的生长纹
      } });
  });

  // 织纹螺：小尖螺侧躺，尖朝 −x；一条棕色螺带 + 白 / 棕黄相间的纵肋珠粒（隔一圈截面鼓一点），壳口白
  K.model('nassa', ({ loft }) => {
    const brown = 0x855849, tan = 0xc89b76, white = 0xf3ead9, sutC = 0x5e3d28, mouth = 0xfaf3e6, inner = 0xe8d2b4;
    snail(loft, { turns: 6, q: .61, r: 4.7, d: 3.0, flat: 1.15, drop: 5.2, tilt: 12, roll: 32, sides: 9, per0: 14, perMin: 4,
      bump: (th, b, r) => (th > 0.4 && r % 2 ? 1.13 : 1),                           // 纵肋：隔一圈截面鼓一点
      paint: (f) => {
        if (f.inn) return inner;
        if (f.lip) return mouth;
        if (f.sut) return sutC;
        const band = Math.floor((f.b + Math.PI) / TAU * 5);
        if (band % 5 === 2) return brown;
        return (f.r+band)%3===0 ? K.mix(white,tan,.12) : K.mix(tan,brown,(band%2)*.38);                       // 白 / 棕黄错开 → 一粒粒的珠
      } });
  });

  // 笔螺：细长尖塔（约 4:1）侧躺，尖朝 −x；白底，橙红方斑排成一圈圈，深色缝合线
  K.model('miter', ({ loft }) => {
    const white = 0xf1dfbc, red = 0xa94e40, orange = 0xcc7951, sutC = 0x6d4a3a, mouth = 0xe9b88a, inner = 0xf2d2b0;
    snail(loft, { turns: 7, q: .72, r: 3.5, d: 1.7, flat: 1.25, drop: 6.5, tilt: 8, roll: 26, sides: 9, per0: 10, perMin: 4,
      paint: (f) => {
        if (f.inn) return inner;
        if (f.lip) return mouth;
        if (f.sut) return sutC;
        const band = Math.floor((f.b + Math.PI) / TAU * 6), spot = (f.r + (band>>1)) % 4 < 2;
        if (band % 2 === 0 && spot) return band % 4 === 0 ? red : orange;
        return white;
      } });
  });

  // 女王凤凰螺：大体螺层、带瘤的螺塔，奶油 / 浅棕底 + 棕色火焰纹；壳口外翻出一大片粉色的翼（两面 + 边，有厚度）
  K.model('conch', ({ tri, quad, loft }) => {
    const cream = 0xf4e6cc, tan = 0xd8b07e, tanD = 0xb88a58, brown = 0x8a5a36, sutC = 0x6e4a30, pk = [0xbb526e, 0xdf7d8b, 0xf1ad9f, 0xf6d8b2];
    const o = { turns: 5.2, q: 0.6, r: 4.4, d: 3.3, flat: 1.3, drop: 8.4, tilt: 18, roll: -145, mirror: true, sides: 9, per0: 10, perMin: 4,
      paint: (f) => {
        if (f.inn) return pk[0];
        if (f.lip) return pk[1];
        if (f.sut) return sutC;
        const up = clamp((f.b + 0.8) / 2.0, 0, 1);                    // 0 底 → 1 肩
        if (f.turn > 1.6) return up > 0.55 ? cream : tan;
        const fl = frac(f.th * 6 / TAU + f.b * 0.9);                   // 体螺层上斜斜的火焰纹
        if (up < 0.85 && fl > 0.55 && fl < 0.8) return brown;
        return up > 0.7 ? cream : up > 0.35 ? tan : tanD;
      } };
    const { at, AX, g } = snail(loft, o);
    // 肩上的瘤：每转 9 个，从壳口后一点一直排到第 2.6 圈
    for (let th = 0.55; th < 2.6 * TAU; th += TAU / 9) {
      const s = Math.pow(o.q, th / TAU), b = 0.55, P = at(th, b).p, c = at(th, b).c;
      knob(tri, P, sub(P, c), sub(at(th + 0.05, b).p, P), 0.55 * o.r * s, 0.32 * o.r * s, tan, cream);
    }
    // 外翻的唇：从壳口外沿（b = −0.7 … 1.9）往外、往壳顶那边长出去的一片厚翼，正面粉、背面浅棕
    const NB = 10, NU = 3, TH = 0.22 * o.r, top = [], bot = [];
    for (let k = 0; k <= NB; k++) {
      const b = -0.7 + 2.6 * k / NB, R = at(0, b, 0.92).p, c = at(0, b).c;
      const rad = nrm(sub(R, c)), L = o.r * (0.34 + 1.33 * Math.sin(Math.PI * Math.min(1, (b + 0.7) / 2.8)) ** 0.8);
      const dir = nrm(addv(addv(rad, g, 0.2), AX, 0.35 + 0.45 * Math.max(0, b)));    // 越往肩越朝壳顶翘
      top.push([]); bot.push([]);
      for (let u = 0; u <= NU; u++) {
        const t = u / NU, p = addv(addv(R, dir, L * t), g, (0.42+.14*Math.cos(k*2))*o.r*t*t);   // 往壳口那边微微卷起
        top[k].push(p); bot[k].push(addv(p, g, -TH * (1 - 0.5 * t)));
      }
    }
    const colTop = (u) => (u === 0 ? pk[0] : u === 1 ? pk[1] : pk[2]);
    for (let k = 0; k < NB; k++) for (let u = 0; u < NU; u++) {
      quad(top[k][u], top[k + 1][u], top[k + 1][u + 1], top[k][u + 1], colTop(u), g);
      quad(bot[k][u], bot[k + 1][u], bot[k + 1][u + 1], bot[k][u + 1], u === NU - 1 ? cream : tan, [-g[0], -g[1], -g[2]]);
    }
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const ctr = mid(top[NB >> 1][0], top[NB >> 1][NU]);
    for (let k = 0; k < NB; k++) quad(top[k][NU], top[k + 1][NU], bot[k + 1][NU], bot[k][NU], pk[3], sub(mid(top[k][NU], top[k + 1][NU]), ctr));   // 外缘
    for (let k = 0; k < NB; k++) quad(top[k][0], top[k + 1][0], bot[k + 1][0], bot[k][0], pk[0], sub(mid(top[k][0], top[k + 1][0]), ctr));         // 根（埋在壳口里）
    for (const k of [0, NB]) for (let u = 0; u < NU; u++) {          // 两头
      const w = sub(top[k][u], top[k === 0 ? 1 : NB - 1][u]);
      quad(top[k][u], top[k][u + 1], bot[k][u + 1], bot[k][u], pk[2], w);
    }
  });

  // 鹦鹉螺：平卷（tilt 90），后一圈把前一圈整个包住；奶油底，锈红虎纹从脐部往外长，壳口前的一段是素的；壳口里深色内壁
  K.model('nautilus', ({ loft }) => {
    const cream = 0xf4ead8, rust = 0x99533c, rust2 = 0xc38b60, dark = 0x5a4238, lipC = 0xe9dcc8, callus = 0xdccbb2;
    const o = { turns: 2.0, q: 1 / 3, r: 7.6, d: 6.1, flat: .54, drop: 0, tilt: 86, roll: 7, sides: 11, per0: 26, perMin: 8,
      paint: (f) => {
        if (f.inn) return dark;
        if (f.lip) return lipC;
        if (f.th > TAU - 0.7) return dark;                            // 第二圈只在壳口里看得到：深色内壁
        const ax = Math.hypot(f.P[0], f.P[2]), u = clamp(ax / ((o.d + o.r) * f.s), 0, 1);   // 0 轴心 … 1 外沿
        if (u < 0.16) return callus;
        const lim = clamp((f.th - 0.5) / 1.4, 0, 1) * 1.05;           // 虎纹从脐部长出来，壳口前那段没有
        if (u > lim) return cream;
        return frac(f.th * 10 / TAU + u * .76 + .83*u*u) < .27 ? (lim - u < 0.15 ? rust2 : rust) : cream;
      } };
    snail(loft, o);
  });

  // 虎斑宝贝：光滑饱满的半椭球（长轴 x），背上奶白 → 两侧浅棕，下缘一圈蓝灰；底面一条带齿的缝（齿一直排到底面两侧）。
  // 经纬网：沿 x 一圈圈截面，截面上半椭圆高 C、下半扁 D，底下插三个点凹成一道缝。斑点不画在网格上（会碎成三角），
  // 而是一片片贴在椭球面外一点点的小六边形（按错位网格摆，大小 / 深浅随机）。整只往前侧倾 TILT 露出缝
  K.model('cowrie', ({ tri }) => {
    const A = 11.5, B = 6.7, C = 7.8, D = 2.55, TILT = 25 * Math.PI / 180, ct = Math.cos(TILT), st = Math.sin(TILT), P = 3.9;
    const cream = 0xf0e2c6, tan = 0xba8961, spot = 0x4b3843, halo = 0x926a56, rim = 0x8a9ba6, line = 0xf8efdc;
    const belly = 0xf3ebdc, tooth = 0xfdf8ee, gap = 0xa27552, slit = 0x5a3a2a;
    const sl = (u) => 0.7 + 0.01 * u * u;
    const NX = 16, M = 15;                                            // 16 圈截面，每圈 15 个椭圆点 + 3 个缝的点
    const W = (u, v, w) => [u, v * ct + w * st, -v * st + w * ct];  // 壳体坐标 (u 长轴, v 高, w 宽) → 世界
    const aOf = (u) => (u > 0 ? A * 0.95 : A);
    const scOf = (u) => Math.sqrt(Math.max(0.02, 1 - (u / aOf(u)) ** 2));
    const rings = [];
    for (let k = 0; k < NX; k++) {
      const u = -A * 0.97 + (A * 0.97 + A * 0.93) * k / (NX - 1), sc = scOf(u);
      const ring = [], c = sl(u);
      for (let j = 0; j < M; j++) {                                   // 从缝的右边（+w）绕上去到左边：φ 从 −78° 到 258°
        const ph = (-78 + 336 * j / (M - 1)) * Math.PI / 180, cs = Math.cos(ph), sn = Math.sin(ph);
        ring.push([u, sn * (sn > 0 ? C : D) * sc, B * cs * sc]);
      }
      const yb = -D * sc * 0.9, deep = 0.8 + 1.6 * sc;                 // 缝：两唇 + 往里凹的缝底
      ring.push([u, yb, c - 0.75], [u, yb + deep, c], [u, yb, c + 0.75]);
      rings.push(ring);
    }
    const n = rings[0].length;
    const colour = (u, v, w, k) => {
      if (v < -0.3) {
        const dw = Math.abs(w - sl(u));
        if (dw < 4.8 && Math.abs(u) < A * 0.9) return k % 2 ? tooth : gap;   // 齿一直排到底面两侧
        return belly;
      }
      const t = v / (C * scOf(u));
      if (t < 0.22) return rim;
      if (t > 0.9 && Math.abs(w - 0.9 - 0.05 * u) < 1.0) return line;        // 背上一条浅色细线
      return K.mix(tan, cream, clamp((t - 0.25) / 0.6, 0, 1));
    };
    const face = (a, b, d, k) => {
      const m = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3];
      tri(W(...a), W(...b), W(...d), colour(m[0], m[1], m[2], k), W(0, m[1] * (m[1] > 0 ? 1 / (C * C) : 1 / (D * D)), m[2] / (B * B)));
    };
    for (let k = 0; k < NX - 1; k++) for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n, a = rings[k][j], b = rings[k][j2], d = rings[k + 1][j2], e = rings[k + 1][j];
      if (j >= M) {                                                    // 缝里的两道斜墙，朝缝的中间
        const c = sl((a[0] + d[0]) / 2), side = (a[2] + b[2]) / 2 > c ? 1 : -1;
        tri(W(...a), W(...b), W(...d), slit, W(0, -0.4, -side)); tri(W(...a), W(...d), W(...e), slit, W(0, -0.4, -side));
      } else { face(a, b, d, k); face(a, d, e, k); }
    }
    for (const [k, tipU] of [[0, -A], [NX - 1, A * 0.95]]) {          // 两头收成尖
      const tip = [tipU, 0.3, sl(tipU) * 0.5], R = rings[k];
      for (let j = 0; j < n; j++) {
        const a = R[j], b = R[(j + 1) % n], m = [(a[0] + b[0] + tip[0]) / 3, (a[1] + b[1] + tip[1]) / 3, (a[2] + b[2] + tip[2]) / 3];
        tri(W(...a), W(...b), W(...tip), j >= M ? slit : colour(m[0], m[1], m[2], k), W(Math.sign(tipU), 0, 0));
      }
    }
    // 斑点：椭球面上的点 E(u, φ)（φ 0 → π 从 +w 侧翻过背到 −w 侧），贴一片六边形，略浮在面外（网格是弦，都在真曲面里面）
    const E = (u, ph, lift = 1) => { const sc = scOf(u); return [u, Math.sin(ph) * C * sc * lift, Math.cos(ph) * B * sc * lift]; };
    const onE = (p, lift) => {                                        // 把任意点沿「中心 → 点」推回椭球面 × lift
      const a = aOf(p[0]), k = 1 / Math.sqrt((p[0] / a) ** 2 + (p[1] / C) ** 2 + (p[2] / B) ** 2);
      return [p[0] * k * lift, p[1] * k * lift, p[2] * k * lift];
    };
    let row = 0;
    for (let u = -A * 0.8; u <= A * 0.76; u += P * 0.62, row++) {
      const sc = scOf(u), R = (B + C) / 2 * sc, dph = P * 0.7 / R;
      for (let ph = 0.5 + (row & 1) * dph / 2; ph < Math.PI - 0.5; ph += dph) {
        if (K.hash(row * 3, ph * 13, 5) < 0.18) continue;              // 偶尔空一个，不那么整齐
        const h1 = K.hash(row, ph * 10, 3), h2 = K.hash(ph * 7, row, 9);
        const uu = u + (h1 - 0.5) * 1.2, pp = ph + (h2 - 0.5) * 0.18, c = E(uu, pp);
        const nn = nrm([uu / (aOf(uu) ** 2), c[1] / (C * C), c[2] / (B * B)]);
        const t1 = nrm(sub([1, 0, 0], nn.map((x) => x * nn[0]))), t2 = [nn[1] * t1[2] - nn[2] * t1[1], nn[2] * t1[0] - nn[0] * t1[2], nn[0] * t1[1] - nn[1] * t1[0]];
        const rs = (0.68 + 0.57 * K.hash(row + 5, ph * 3, 1)) * (0.75 + 0.25 * sc), col = h1 > 0.65 ? halo : spot, lift = 1.012;
        const ctr = onE(c, lift + 0.004), hex = [];
        for (let m = 0; m < 5; m++) { const a = TAU * m / 5 + h2 * 3, w = rs * (0.8 + 0.4 * K.hash(m, row, ph)); hex.push(onE(addv(addv(c, t1, Math.cos(a) * w * 1.2), t2, Math.sin(a) * w), lift)); }
        for (let m = 0; m < 5; m++) tri(W(...ctr), W(...hex[m]), W(...hex[(m + 1) % 5]), col, W(...nn));
      }
    }
  });
})(window.V3);