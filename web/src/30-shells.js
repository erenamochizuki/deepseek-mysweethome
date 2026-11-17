// src/30-shells.js — 12 种贝壳/海螺：精细 vox（按各自 size 归一；完整表面每种约 1.4k–3.3k 三角）。
// V3.shells = { KINDS:[{id,name,rarity,size,desc}], build(id, opt?) -> Object3D }：底面 y=0、水平中心在原点，
// mesh.userData.anchor = 'shell:'+id（opt.anchor 可覆盖，场景里摆多只时用），部件路径 '贝壳/'+name。
// 几何按种类缓存共享（geometry/material.userData.shared）。一览模型 'shells'：三排按稀有度。
(function (V3) {
  const U = V3.util, ROOT = '贝壳';
  const KINDS = [
    { id: 'scallop', name: '扇贝', rarity: 'common', size: 0.13, desc: '橙粉色的小扇子，一道道放射肋。' },
    { id: 'clam', name: '花蛤', rarity: 'common', size: 0.07, desc: '圆润的小蛤蜊，每一只花纹都不一样。' },
    { id: 'mussel', name: '青口', rarity: 'common', size: 0.09, desc: '蓝黑色的长壳，边上一圈珍珠光。' },
    { id: 'moon', name: '白玉螺', rarity: 'common', size: 0.06, desc: '圆胖洁白的螺，像一颗汤圆。' },
    { id: 'nassa', name: '织纹螺', rarity: 'common', size: 0.045, desc: '小小的尖螺，棕白相间的花纹。' },
    { id: 'cowrie', name: '虎斑宝贝', rarity: 'uncommon', size: 0.12, desc: '亮得像上过釉，背上满是斑点。' },
    { id: 'starfish', name: '海星', rarity: 'uncommon', size: 0.15, desc: '橙色的五角星，摸起来一粒一粒的。' },
    { id: 'miter', name: '笔螺', rarity: 'uncommon', size: 0.10, desc: '细长的尖塔，一圈一圈的螺纹。' },
    { id: 'dollar', name: '沙钱', rarity: 'uncommon', size: 0.10, desc: '扁扁圆圆，背上开着一朵五瓣花。' },
    { id: 'conch', name: '女王凤凰螺', rarity: 'rare', size: 0.16, desc: '大海螺，粉色的喇叭口里有海风的声音。' },
    { id: 'nautilus', name: '鹦鹉螺', rarity: 'rare', size: 0.15, desc: '白底棕色虎纹，一圈圈完美的螺旋。' },
    { id: 'pearl', name: '珍珠贝', rarity: 'rare', size: 0.12, desc: '微微张开，里面藏着一颗珍珠。' },
  ];
  const BY = {}; for (const k of KINDS) BY[k.id] = k;
  const GLOSS = { cowrie: 0.42, mussel: 0.55, nautilus: 0.42, pearl: 0.35, conch: 0.45 };   // roughness of the shiny ones
  const MAKERS = {};                                         // id -> () => V3.vox.Grid (design y ≥ 0)

  // ---- helpers ----
  const hh = (x, y, z) => U.hash3(x * 7 + 3, y * 13 + 5, z * 17 + 11);          // stable 0..1 per cell
  const mix = (a, b, t) => {
    const f = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
    return f(16) | f(8) | f(0);
  };
  const shade = (c, f) => mix(c, f < 1 ? 0 : 0xffffff, Math.abs(1 - f));       // f<1 darker, f>1 lighter
  const grid = (R, H, Rz = R) => new V3.vox.Grid(2 * R + 1, H + 1, 2 * Rz + 1, { origin: [R, 0, Rz] });
  // height field over x -R..R, z -Rz..Rz: f(x,z) -> null | { h: top y (≥0), top: colour, side?: colour | fn(y) }
  function field(g, R, Rz, f) {
    for (let z = -Rz; z <= Rz; z++) for (let x = -R; x <= R; x++) {
      const v = f(x, z); if (!v || v.h < 0) continue;
      for (let y = 0; y <= v.h; y++) {
        const c = y === v.h ? v.top : typeof v.side === 'function' ? v.side(y) : (v.side ?? shade(v.top, 0.84));
        g.c(c).set(x, y, z);
      }
    }
    return g;
  }

  // ---- spiral generator (snails, conch, nautilus) ----
  // A tube coils round an axis and shrinks by q per turn towards the apex; each whorl overlaps the one before,
  // `sut` marks where they meet, the end of the last whorl is hollowed out (the previous whorl stays as the
  // inner wall). World: axis apex end points −x, tilted up by o.tilt°; o.roll° turns the coil about its axis
  // (0 → the aperture faces +z, the viewer). o: turns, q, r (tube radius at the aperture), d (axis → tube
  // centre), drop (axial advance per turn; 0 = flat coil), flat (tube depth along the axis ÷ r), wall, open
  // (rad hollowed), lip (rad), knob {n per turn, at (rad round the tube, + = apex side), k (÷ r)}, pad,
  // col(i) → colour with i = {phi, turn, beta (0 = outer periphery), s, sut, inn, lip, x, y, z, h},
  // extra(add(x, y, z, colour), F = {c0, g, e1, e2, A, rad}) for flared lips etc.
  function spiral(o) {
    const TAU = Math.PI * 2, q = o.q, lam = -Math.log(q) / TAU, K = (o.drop || 0) / (1 - q), fl = o.flat || 1;
    const t = (o.tilt || 0) * Math.PI / 180, ps = (o.roll || 0) * Math.PI / 180, wall = o.wall || 1.2;
    const OPEN = o.open || 0.8, LIP = o.lip || 0.3;
    const A = [-Math.cos(t), Math.sin(t), 0], B1 = [Math.sin(t), Math.cos(t), 0], B2 = [0, 0, o.mirror ? -1 : 1];
    const e1 = B1.map((v, i) => Math.cos(ps) * v + Math.sin(ps) * B2[i]);
    const e2 = B1.map((v, i) => Math.cos(ps) * B2[i] - Math.sin(ps) * v);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const mk = (phi) => {
      const s = Math.pow(q, phi / TAU), out = e1.map((v, i) => Math.cos(phi) * v - Math.sin(phi) * e2[i]);
      return { phi, s, rad: s * o.r, out, c: out.map((v, i) => s * o.d * v - K * s * A[i]) };
    };
    const st = [];
    for (let phi = o.turns * TAU; phi > 0; phi -= Math.min(0.15, 0.35 / Math.max(0.5, o.d * Math.pow(q, phi / TAU)))) st.push(mk(phi));
    st.push(mk(0));
    const g0 = e1.map((v, i) => lam * o.d * v - lam * K * A[i] + o.d * e2[i]), gn = Math.hypot(...g0);
    for (let i = 0; i < 3; i++) g0[i] /= gn;
    // bounds → index space
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], kk = o.knob ? 1 + o.knob.k : 1;
    for (const p of st) for (let i = 0; i < 3; i++) {
      const e = p.rad * Math.max(1, fl) * kk + 1 + (p.phi < 1 ? (o.pad || 0) : 0);
      lo[i] = Math.min(lo[i], p.c[i] - e); hi[i] = Math.max(hi[i], p.c[i] + e);
    }
    const O = lo.map(Math.floor), N = hi.map((v, i) => Math.ceil(v) - O[i] + 1), NN = N[0] * N[1] * N[2];
    const own = new Int32Array(NN).fill(-1), cav = new Uint8Array(NN), prev = new Uint8Array(NN), ex = new Map();
    const at = (x, y, z) => (z * N[1] + y) * N[0] + x;
    function stamp(j, c, rad, f, mode) {         // mode 0: owner, 1: cavity
      const r2 = rad * rad, a2 = r2 * f * f, e = rad * Math.max(1, f) + 1, old = st[j].phi > Math.PI;
      const rg = (i) => [Math.max(0, Math.floor(c[i] - e - O[i])), Math.min(N[i] - 1, Math.ceil(c[i] + e - O[i]))];
      const [x0, x1] = rg(0), [y0, y1] = rg(1), [z0, z1] = rg(2);
      for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const v = [x + O[0] - c[0], y + O[1] - c[1], z + O[2] - c[2]], al = dot(v, A);
        if ((dot(v, v) - al * al) / r2 + al * al / a2 > 1) continue;
        const k = at(x, y, z);
        if (mode) cav[k] = 1; else { own[k] = j; if (old) prev[k] = 1; }
      }
    }
    let lastK = null;
    st.forEach((p, j) => {
      stamp(j, p.c, p.rad, fl, 0);
      if (o.knob && p.phi > LIP + 0.2) {
        const kn = Math.floor(p.phi * o.knob.n / TAU), a = o.knob.at;
        if (kn !== lastK) {
          lastK = kn;
          stamp(j, p.c.map((v, i) => v + p.rad * 0.9 * (Math.cos(a) * p.out[i] + Math.sin(a) * fl * A[i])), p.rad * o.knob.k, 1, 0);
        }
      }
      if (p.phi < OPEN && p.rad > wall + 0.5) stamp(j, p.c, p.rad - wall, (p.rad * fl - wall) / (p.rad - wall), 1);
    });
    // hollow the aperture (keeping the previous whorl), cut the cap ahead of the aperture plane
    const c0 = st[st.length - 1].c;
    for (let k = 0; k < NN; k++) {
      const j = own[k]; if (j < 0) { cav[k] = 0; continue; }
      const x = k % N[0], y = Math.floor(k / N[0]) % N[1], z = Math.floor(k / (N[0] * N[1]));
      const cap = st[j].phi < OPEN && dot([x + O[0] - c0[0], y + O[1] - c0[1], z + O[2] - c0[2]], g0) > 0.2;
      if ((cav[k] || cap) && !prev[k]) { own[k] = -1; cav[k] = 1; } else cav[k] = 0;
    }
    if (o.extra) o.extra((x, y, z, c) => {
      const X = Math.round(x) - O[0], Y = Math.round(y) - O[1], Z = Math.round(z) - O[2];
      if (X >= 0 && Y >= 0 && Z >= 0 && X < N[0] && Y < N[1] && Z < N[2] && own[at(X, Y, Z)] < 0) ex.set(at(X, Y, Z), c);
    }, { c0, g: g0, e1, e2, A, rad: o.r, fl });
    // colour every kept cell
    const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], out = [];
    let minY = 1e9;
    for (let k = 0; k < NN; k++) {
      const j = own[k]; if (j < 0 && !ex.has(k)) continue;
      const x = k % N[0], y = Math.floor(k / N[0]) % N[1], z = Math.floor(k / (N[0] * N[1]));
      minY = Math.min(minY, y);
      if (j < 0) { out.push([x, y, z, ex.get(k)]); continue; }
      const p = st[j], P = [x + O[0], y + O[1], z + O[2]], v = P.map((w, i) => w - p.c[i]);
      let sut = false, inn = false, air = false;
      for (const [dx, dy, dz] of NB) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= N[0] || Y >= N[1] || Z >= N[2]) { air = true; continue; }
        const k2 = at(X, Y, Z), j2 = own[k2];
        if (cav[k2]) inn = true; else if (j2 < 0) { if (!ex.has(k2)) air = true; } else if (st[j2].phi > p.phi + Math.PI) sut = true;
      }
      if (air) inn = false;                                   // a one-cell wall shows its outside colour
      // th: true angle round the coil axis behind the aperture (0..2π), ax: distance from the axis ÷ o.d
      const ang = Math.atan2(-dot(P, e2), dot(P, e1)), th = ((ang % TAU) + TAU) % TAU;
      const ax = Math.hypot(dot(P, e1), dot(P, e2)) / o.d;
      out.push([x, y, z, o.col({ phi: p.phi, turn: p.phi / TAU, beta: Math.atan2(dot(v, A), dot(v, p.out)), s: p.s, th, ax,
        rho: Math.hypot(dot(v, p.out), dot(v, A) / fl) / p.rad, sut, inn, x: P[0], y: P[1], z: P[2], h: hh(x, y, z),
        lip: p.phi < OPEN && dot(P.map((w, i) => w - c0[i]), g0) > -LIP * o.r })]);   // a band just behind the aperture plane
    }
    const G = new V3.vox.Grid(N[0], N[1] - minY, N[2], { origin: [0, 0, 0] });
    for (const [x, y, z, c] of out) G.c(c).set(x, y - minY, z);
    return G;
  }

  // 扇贝：壳顶 / 铰合线在后（−z），16 条放射肋从壳顶呈扇形散开（肋高一格、沟深一档），边缘随肋起伏成波浪；
  // 铰合线两侧两只小耳朵（一大一小）；颜色从壳顶深橙粉渐变到边缘浅杏色
  MAKERS.scallop = () => {
    const R = 12, ZU = -11, D = 11, RC = 11.5, A = 0.9, N = 13, g = grid(R, 6, R);
    const deepC = 0xb0341c, midC = 0xd04a24, edgeC = 0xe6783f, grooveK = 0.64, earC = 0xb4442a, earL = 0xca5e36;   // deeper, more saturated (studio light washes it out)
    return field(g, R, R, (x, z) => {
      const dz = z - ZU, rho = Math.hypot(x, dz), a = Math.atan2(x, dz);            // a = 0 → straight toward the viewer
      const ph = (a / (2 * A) + 0.5) * N, fr = ph - Math.floor(ph), onRib = fr > 0.2 && fr < 0.8;
      const rim = D * Math.cos(a) + Math.sqrt(RC * RC - (D * Math.sin(a)) ** 2), t = rho / rim;   // 0 umbo … 1 rim along the ray
      const inFan = dz >= 0 && Math.abs(a) <= A && Math.hypot(x, z - ZU - D) <= RC + (onRib && t > 0.5 ? 0.5 : -0.4);
      const earW = x < 0 ? 6.0 : 5.0;                                              // byssal ear a bit longer
      const inEar = !inFan && dz >= 0 && dz <= 3.2 && Math.abs(x) <= earW - 0.75 * dz;
      if (!inFan && !inEar) return null;
      if (!inFan) return { h: dz < 1.4 ? 1 : 0, top: (Math.round(Math.abs(x)) & 1) ? earC : earL };
      const tm = Math.min(1, t), rib = onRib && t > 0.35, dome = 0.4 + 2.8 * Math.sin(Math.PI * Math.min(1, 0.25 + 0.75 * tm)) * (1 - 0.45 * (a / A) ** 2);
      const h = U.clamp(Math.round(dome + (rib && t < 0.97 ? 1 : 0) - (!onRib && t > 0.4 ? 0.7 : 0)), 0, 6);   // grooves sunk a bit deeper
      const tt = U.clamp(t, 0, 1), grad = tt < 0.5 ? mix(deepC, midC, tt / 0.5) : mix(midC, edgeC, (tt - 0.5) / 0.5);
      const c = rib || t <= 0.35 ? grad : shade(grad, grooveK);
      return { h, top: c, side: (y) => shade(c, y === 0 ? 0.76 : 0.88) };
    });
  };

  // 花蛤：扁（高≈宽×0.4），圆三角轮廓、壳顶（−z）一个小鼓包；同心生长纹 + 一圈圈棕色锯齿纹；侧面接缝线
  MAKERS.clam = () => {
    const R = 12, Rz = 11, g = grid(R, 10, Rz);
    const base = 0xd8c3a0, light = 0xe9dbc0, zig = 0x7d4e33, umbo = 0xb88c66, seam = 0x6a4636;
    return field(g, R, Rz, (x, z) => {
      const dx = x / 1.1, dz = z - 0.6, th = Math.atan2(dx, -dz);                 // th = 0 points at the umbo
      const R0 = 9.6 * (1 + 0.09 * Math.cos(3 * th)), rho = Math.hypot(dx, dz) / R0;
      if (rho > 1) return null;
      const bump = 1.6 * Math.exp(-(x * x + (z + 7.4) ** 2) / 5);
      const h = U.clamp(Math.round(1.6 + 6.4 * Math.sqrt(1 - rho * rho) * (1 - 0.018 * dz) + bump), 1, 10);
      let c = Math.floor(rho * 8) & 1 ? light : base;                              // growth bands follow the outline
      const ru = Math.hypot(x, z + 7.4), tu = Math.atan2(x, z + 7.4);             // angle round the umbo (top-down)
      const tw = Math.abs(((ru * 0.42) % 2 + 2) % 2 - 1);                          // triangle wave along the radius
      const f = tu * 3.2 + 0.55 * tw;
      if (ru > 5 && rho < 0.95 && f - Math.floor(f) < 0.36) c = zig;               // radial zigzag lines cross the terraces
      if (bump > 0.7) c = umbo;
      return { h, top: c, side: (y) => y === 0 ? shade(base, 0.72) : y === 1 && rho > 0.8 ? seam : shade(c, 0.86) };
    });
  };

  // 青口：蓝黑长壳（尖头 = 壳顶在 −x），生长纹一圈圈；侧面 y=1 一圈珍珠层的彩光边
  MAKERS.mussel = () => {
    const R = 12, Rz = 8, g = grid(R, 6, Rz);
    const dark = 0x1a2030, blue = 0x2b3757, band = 0x3c4a74, edge = 0x5a6aa0, umbo = 0x3b3430;
    const NAC = [0xb9c6e8, 0xe2bfd9, 0xa9dcd3, 0xe6dcb4];
    return field(g, R, Rz, (x, z) => {
      const t = (x + 12) / 24; if (t < 0 || t > 1) return null;
      const w = 7.0 * Math.sqrt(t) * Math.sqrt(Math.max(0, 1 - t ** 4)), zc = 2.1 * (t - 0.6) ** 2 - 0.8;
      if (w < 0.6 || Math.abs(z - zc) > w) return null;
      const q = ((z - zc) / w) ** 2, ru = Math.hypot(x + 12, (z - zc) * 1.6);
      const h = U.clamp(1 + Math.round(4 * Math.sqrt(1 - q) * Math.sqrt(Math.sin(Math.PI * Math.min(t * 1.25, 1)))), 1, 6);
      const rim = q > 0.75 || t > 0.95, nac = NAC[Math.floor(t * 10) % 4];         // nacre bands along the shell
      let c = Math.floor(ru / 2.9) & 1 ? blue : dark;                              // concentric growth rings
      if (ru < 4.8) c = umbo; else if (rim) c = edge;
      if (h === 1) c = nac;
      return { h, top: c, side: (y) => y === 1 ? nac : y === 0 ? dark : shade(c, 0.85) };
    });
  };

  // 白玉螺：圆胖光滑的白螺，圈数少、螺塔低；斜躺在沙上，顶上看得到螺旋缝合线，壳口内棕色
  MAKERS.moon = () => {
    const white = 0xf8f3ea, cream = 0xece2d0, sut = 0xa8927a, tip = 0xc4ab8e, inside = 0xf0cdbf, lip = 0xf2e6d2;
    return spiral({ turns: 3.2, q: 0.36, r: 7.0, d: 5.5, flat: 1.0, drop: 4.0, wall: 1.3, open: 0.9, lip: 0.3, tilt: 55, roll: 0,
      col: (i) => {
        if (i.inn) return inside;
        if (i.lip) return lip;
        if (i.sut) return sut;
        if (Math.hypot(i.x, i.y, i.z) < 1.6) return tip;                         // apex
        const f = i.th * 10 / (Math.PI * 2);                                       // faint growth lines
        return f - Math.floor(f) < 0.18 ? cream : white;
      } });
  };

  // 织纹螺：小尖螺侧躺，螺塔尖朝 −x；棕色螺带 + 白色纵肋珠粒，壳口白
  MAKERS.nassa = () => {
    const brown = 0x8a5634, tan = 0xc79a6c, white = 0xf3ead9, sutC = 0x5e3d28, mouth = 0xfaf3e6, inner = 0xe8d2b4;
    return spiral({ turns: 6, q: 0.7, r: 4.0, d: 2.7, flat: 1.25, drop: 6.2, wall: 1.0, open: 0.8, lip: 0.3, tilt: 8, roll: 30,
      col: (i) => {
        if (i.inn) return inner;
        if (i.lip) return mouth;
        if (i.sut) return sutC;
        const band = Math.floor((i.beta + Math.PI) / (Math.PI * 2) * 5);         // spiral bands round the tube
        const rib = Math.floor(i.th * 11 / (Math.PI * 2)) % 2 === 0;              // axial beads
        if (band % 5 === 2) return brown;
        return rib ? white : tan;
      } });
  };

  // 虎斑宝贝：光滑饱满的半椭球（长轴 x），底面一条带齿的缝（齿一直延到底面两侧）；按 3.6 格错位网格放深棕圆点，
  // 底色背上奶白 → 两侧浅棕，下缘一圈浅蓝灰。整只绕 x 轴往前（+z）侧倾 TILT，让带齿的壳口露出来
  MAKERS.cowrie = () => {
    const A = 11.5, B = 7.6, C = 7.4, D = 2.4, TILT = 22 * Math.PI / 180, ct = Math.cos(TILT), st = Math.sin(TILT), P = 3.9;
    const cream = 0xf0e2c6, tan = 0xc0946a, spot = 0x4a2a1c, halo = 0x7e5236, rim = 0xa3b2c4, line = 0xf8efdc;
    const belly = 0xf3ebdc, tooth = 0xfdf8ee, gap = 0xa27552, slit = 0x5a3a2a;
    const sl = (u) => 0.7 + 0.01 * u * u;                                             // slit centre line (w), slightly curved
    const solid = (u, v, w) => {
      const a = u > 0 ? A * 0.95 : A, e = (u / a) ** 2 + (w / B) ** 2;
      if (e + (v / (v >= 0 ? C : D)) ** 2 > 1) return false;
      return !(v < -D * 0.45 && Math.abs(w - sl(u)) < 0.8 && Math.abs(u) < A * 0.93);  // the open slit
    };
    const colour = (u, v, w) => {
      if (v < 0) {
        const dw = Math.abs(w - sl(u));
        if (dw < 0.8) return slit;
        if (dw < 4.6 && Math.abs(u) < A * 0.9) return (Math.floor(u * 0.75 + 50) & 1) ? tooth : gap;   // teeth reach the rim
        return belly;
      }
      const t = v / C, sw = Math.atan2(w, v * B / C) * B;                            // sw ≈ arc length across the back
      if (t < 0.13) return rim;
      if (t > 0.8 && Math.abs(w - 0.9 - 0.05 * u) < 0.5) return line;                // thin dorsal line, top only
      const j = Math.round(sw / P), off = (j & 1) * P / 2, i = Math.round((u - off) / P);
      const d = Math.hypot(u - off - i * P, sw - j * P), rs = 1.5 + 0.35 * U.hash3(i + 40, j + 40, 7);
      if (t > 0.17 && d < rs * 0.7) return spot;
      if (t > 0.17 && d < rs) return halo;
      return mix(tan, cream, U.clamp((t - 0.2) / 0.6, 0, 1));
    };
    const out = []; let y0 = 1e9, y1 = -1e9;
    for (let x = -13; x <= 13; x++) for (let y = -11; y <= 11; y++) for (let z = -12; z <= 12; z++) {
      const v = y * ct - z * st, w = y * st + z * ct;                                // world → shell frame
      if (!solid(x, v, w)) continue;
      out.push([x, y, z, colour(x, v, w)]); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const g = new V3.vox.Grid(27, y1 - y0 + 1, 25, { origin: [13, 0, 12] });
    for (const [x, y, z, c] of out) g.c(c).set(x, y - y0, z);
    return g;
  };

  // 海星：五条臂往尖端变细、臂尖圆，中间微鼓；每条臂一排脊瘤 + 两侧各一排小凸点（规则排列），盘上 5 颗，边缘深一档
  MAKERS.starfish = () => {
    const R = 13, g = grid(R, 6, R), L = 10.6, W0 = 3.6, WT = 1.9, RC = 4, TIP = L + WT;
    const orange = 0xd9561f, ridge = 0xe0622a, deep = 0xb4441c, bump = 0xee8a4c, ctr = 0xc94f22, mad = 0xf2c36b;
    return field(g, R, R, (x, z) => {
      const rho = Math.hypot(x, z);
      let q = rho <= RC ? 0.95 * rho / RC : 9, best = null;
      for (let k = 0; k < 5; k++) {                                               // arm k points at angle k·72° from −z
        const a = k * 2 * Math.PI / 5, s = x * Math.sin(a) - z * Math.cos(a), n = x * Math.cos(a) + z * Math.sin(a);
        if (s < 0) continue;
        const w = s <= L ? W0 + (WT - W0) * s / L : WT, qa = s <= L ? Math.abs(n) / w : Math.hypot(s - L, n) / WT;
        if (qa < q) { q = qa; best = { s, n, w }; }
      }
      if (q > 1) return null;
      const hb = 1.0 + 3.0 * Math.pow(Math.max(0, 1 - rho / TIP), 1.2);           // thick centre, thin tips
      let h = Math.round(hb * Math.pow(1 - q * q, 0.35)), c = q > 0.75 ? deep : q < 0.3 ? ridge : orange, b = false;
      if (best) {
        const { s, n, w } = best, j = Math.round((s - 1.8) / 2.2), j2 = Math.round((s - 2.9) / 2.2);
        b = (j >= 0 && Math.hypot(s - 1.8 - 2.2 * j, n) < 0.72) ||
          (w > 1.7 && j2 >= 0 && Math.hypot(s - 2.9 - 2.2 * j2, Math.abs(n) - 0.58 * w) < 0.72);
      }
      for (let k = 0; k < 5 && !b; k++) {                                         // 5 bumps on the disc, between the arms
        const a = (k + 0.5) * 2 * Math.PI / 5;
        b = Math.hypot(x - 2.4 * Math.sin(a), z + 2.4 * Math.cos(a)) < 0.72;
      }
      if (b) { h += 1; c = bump; }
      else if (rho < 1.5) c = ctr;
      if (Math.hypot(x - 1, z - 1) < 0.6) c = mad;                                 // madreporite, a little off centre
      return { h: U.clamp(h, 0, 6), top: c, side: (y) => shade(b ? orange : c, y === 0 ? 0.72 : 0.86) };
    });
  };

  // 笔螺：细长尖塔（约 4:1，圈数多）侧躺，尖朝 −x；白底，橙红方斑排成一圈圈螺带，深色缝合线
  MAKERS.miter = () => {
    const white = 0xf5ecdc, red = 0xc8462a, orange = 0xe07a3c, sutC = 0x6d4a3a, mouth = 0xe9b88a, inner = 0xf2d2b0;
    return spiral({ turns: 7, q: 0.8, r: 2.9, d: 1.2, flat: 1.4, drop: 7.3, wall: 0.9, open: 0.8, lip: 0.3, tilt: 5, roll: 30,
      col: (i) => {
        if (i.inn) return inner;
        if (i.lip) return mouth;
        if (i.sut) return sutC;
        const band = Math.floor((i.beta + Math.PI) / (Math.PI * 2) * 6);          // spiral rows round the tube
        const spot = Math.floor(i.th * 10 / (Math.PI * 2) + band * 0.5) % 2 === 0;
        if (band % 2 === 0 && spot) return band % 4 === 0 ? red : orange;
        return white;
      } });
  };

  // 女王凤凰螺: short knobbed spire, big body whorl, a pink flared lip folded out beside the aperture
  MAKERS.conch = () => {
    // cream → light-brown shell with brown flame streaks, tall knobbed spire; pink only on the flared lip and in the aperture
    const cream = 0xf4e6cc, tan = 0xd8b07e, tanD = 0xb88a58, brown = 0x8a5a36, sutC = 0x6e4a30, pk = [0xe2647e, 0xee8ea0, 0xf6b6be, 0xf6e2d6];
    const frac = (v) => v - Math.floor(v), TAU = Math.PI * 2;
    // aperture faces the viewer, tipped up; dorsum, knobs and spire behind (mirror + roll −145)
    return spiral({ turns: 5.2, q: 0.6, r: 4.4, d: 3.3, flat: 1.3, drop: 8.4, wall: 1.1, open: 0.9, lip: 0.35, tilt: 18, roll: -145, mirror: true, pad: 10,
      knob: { n: 9, at: 0.55, k: 0.5 },
      col: (i) => {
        if (i.inn) return i.lip ? pk[2] : pk[0];
        if (i.lip) return pk[1];
        if (i.sut) return sutC;
        if (i.rho > 1.1) return cream;                                                // knob tips
        const up = Math.max(0, Math.min(1, (i.beta + 0.8) / 2.0));                   // 0 base → 1 shoulder
        if (i.turn > 1.6) return up > 0.55 ? cream : tan;                              // spire: each whorl cream above, tan below
        const fl = frac(i.th * 6 / TAU + i.beta * 0.9);                               // slanted flame streaks on the body whorl
        if (up < 0.85 && fl > 0.55 && fl < 0.8) return brown;
        return up > 0.7 ? cream : up > 0.35 ? tan : tanD;
      },
      extra: (add, F) => {                                                          // flared lip: a dish growing out of the aperture rim
        const { c0, g, e1, A, rad } = F;
        for (let u = 0.75; u <= 1.8; u += 0.12) for (let w = -0.9; w <= 2.1; w += 0.12) {
          const um = 1.0 + 0.7 * (1 - ((w - 0.6) / 1.5) ** 2); if (u > um) continue;  // rounded wing, widest mid-aperture
          const up = 0.25 * (u - 0.75) ** 2, P = [0, 1, 2].map((k) => c0[k] + rad * (u * e1[k] + w * A[k] + up * g[k]));
          const tt = (u - 0.75) / (um - 0.75);
          add(P[0], P[1], P[2], tt < 0.3 ? pk[0] : tt < 0.65 ? pk[1] : tt < 0.9 ? pk[2] : pk[3]);
          add(P[0] - g[0], P[1] - g[1], P[2] - g[2], tt > 0.85 ? cream : tan);      // outside of the lip
        }
      } });
  };
  // 鹦鹉螺: flat involute coil seen from above, cream with brown tiger stripes; the last part before the aperture is plain
  MAKERS.nautilus = () => {
    const cream = 0xf4ead8, rust = 0x8e3f1f, rust2 = 0xb0603a, nac = 0xf3dfe2, dark = 0x6a5246, lipC = 0xe9dcc8;
    return spiral({ turns: 2.5, q: 1 / 3, r: 7.6, d: 6.1, flat: 0.62, drop: 0, wall: 1.0, open: 1.2, lip: 0.25, tilt: 90, roll: 0,
      col: (i) => {
        if (i.inn) return i.ax < 0.8 ? dark : nac;                                   // previous whorl inside = dark parietal wall
        if (i.lip) return lipC;
        const u = i.ax / (Math.pow(1 / 3, i.th / (Math.PI * 2)) * (6.1 + 7.6) / 6.1);   // 0 axis .. 1 venter
        if (u < 0.13) return 0xdccbb2;                                                // umbilical callus
        const lim = U.clamp((i.th - 0.4) / 1.4, 0, 1) * 1.05;                         // stripes grow out from the umbilicus
        if (u > lim) return cream;
        const f = i.th * 9 / (Math.PI * 2) + u * 0.8;
        return f - Math.floor(f) < 0.45 ? (lim - u < 0.12 ? rust2 : rust) : cream;
      } });
  };

  // 沙钱：扁圆盘、边缘薄，背上 5 片花瓣纹（叶形孔带：浅底 + 一圈棕色点线，微微凸起），花瓣之间 5 条细长孔，中心一点
  MAKERS.dollar = () => {
    const R = 11, RD = 11.2, g = grid(R, 3, R);
    const body = 0xd6c19c, rimC = 0xc2aa84, line = 0x86603e, dot = 0x664527, fill = 0xf1e6d0, ctr = 0xa8885f, slotE = 0x7e6446;
    return field(g, R, R, (x, z) => {
      const rho = Math.hypot(x, z), rr = rho / RD;
      if (rr > 1) return null;
      let h = rr > 0.9 ? 0 : 1, c = rr > 0.82 ? rimC : body;
      for (let k = 0; k < 5; k++) {
        const a = k * 2 * Math.PI / 5, s = x * Math.sin(a) - z * Math.cos(a), n = x * Math.cos(a) + z * Math.sin(a);
        if (s < 1.6 || s > 8.4) continue;
        const t = (s - 1.6) / 6.8, w = 1.85 * Math.sin(Math.PI * t) ** 0.8;      // leaf-shaped petal
        if (Math.abs(n) > w + 0.5) continue;
        const edge = Math.abs(n) > w - 0.55;
        c = edge ? ((Math.round(s) & 1) ? line : dot) : fill;                      // dotted pore rows round each petal
        if (!edge) h = 2;
        break;
      }
      for (let k = 0; k < 5; k++) {                                               // 5 slots (lunules) between the petals
        const a = (k + 0.5) * 2 * Math.PI / 5, s = x * Math.sin(a) - z * Math.cos(a), n = x * Math.cos(a) + z * Math.sin(a);
        if (s > 5.6 && s < 8.6 && Math.abs(n) < 0.6) return null;
        if (s > 5.3 && s < 8.9 && Math.abs(n) < 1.1 && c === body) c = slotE;
      }
      if (rho < 1.1) c = ctr;
      return { h, top: c, side: (y) => shade(c === fill ? body : c, y === 0 ? 0.8 : 0.9) };
    });
  };

  // 珍珠贝：半开的贝，铰合线在后（−z）。下壳 = 浅碗，内面珍珠层（按半径 + 角度在粉/蓝/绿/金间渐变），边缘一圈黑边；
  // 上壳绕铰合线翻开 OPEN°，内面朝向镜头；下壳是薄边浅碗（边缘不规则、离地）；外面灰褐色层状鳞纹；碗里一颗圆珍珠（顶上高光点、底部淡粉）
  MAKERS.pearl = () => {
    const TAU = Math.PI * 2, ZH = -7.5, R0 = 8.0, ZC = ZH + R0, OPEN = 80 * Math.PI / 180, co = Math.cos(OPEN), so = Math.sin(OPEN), YR = 3;
    const NAC = [0xcfb3c8, 0xa7b8d8, 0xa6cbbb, 0xd3c398, 0xbfa9d3], OL = [0x7a6e60, 0x948776], olE = 0xb5a993, edge = 0x6a5c4c;
    const PR = 3.45, PC = [0, 4, 0], pearlC = 0xddd3c8, pLit = 0xf1ebe2, hi = 0xffffff, pink = 0xd8c0c0;   // body a touch warmer so the white dot pops
    const nac = (r, a) => { const f = ((r * 0.55 + a * 1.6) % 5 + 5) % 5, i = Math.floor(f); return mix(NAC[i], NAC[(i + 1) % 5], f - i); };
    const jag = (a) => 0.9 + 0.1 * hh(Math.floor((a + Math.PI) / TAU * 26), 3, 7);                 // irregular lamellar margin
    const polar = (x, z) => { const a = Math.atan2(x, z - ZC); return [Math.hypot(x, z - ZC) / R0 / jag(a), a]; };   // 0 centre … 1 margin
    const lam = (rr, a) => { const f = rr * 8 + 0.35 * Math.sin(a * 6); return f - Math.floor(f) > 0.78 ? olE : OL[Math.floor(f) & 1]; };  // grey-brown scales
    const cells = [];
    for (let x = -10; x <= 10; x++) for (let z = -9; z <= 11; z++) {                                // bottom valve: shallow bowl, thin margin off the ground
      const [rr, a] = polar(x, z); if (rr > 1) continue;
      const yo = Math.round(2.7 * Math.max(0, (rr - 0.45) / 0.55) ** 2), yi = Math.max(yo, Math.round(0.8 + 2 * rr * rr));
      for (let y = yo; y <= yi; y++) cells.push([x, y, z, y < yi ? lam(rr, a) : rr > 0.9 ? edge : shade(nac(rr * R0, a), 0.72)]);
    }
    for (let x = -10; x <= 10; x++) for (let y = 0; y <= 20; y++) for (let z = -11; z <= 4; z++) { // top valve, opened OPEN°
      const yy = y - YR, zz = z - ZH, lz = zz * co + yy * so, ly = -zz * so + yy * co;          // into the closed frame
      if (lz < 0) continue;
      const [rr, a] = polar(x, lz + ZH); if (rr > 1) continue;
      const d = ly - 1.8 * (1 - rr * rr); if (Math.abs(d) > (rr > 0.85 ? 0.5 : 0.75)) continue;
      cells.push([x, y, z, d < 0 ? (rr > 0.9 ? edge : nac(rr * R0 + 3, a)) : lam(rr, a)]);
    }
    for (let x = -4; x <= 4; x++) for (let y = 1; y <= 8; y++) for (let z = -4; z <= 4; z++) {       // the pearl
      const v = [x - PC[0], y - PC[1], z - PC[2]], d = Math.hypot(...v);
      if (d > PR) continue;
      const lit = (-v[0] * 0.5 + v[1] * 0.75 + v[2] * 0.43) / (d || 1);
      cells.push([x, y, z, lit > 0.86 ? hi : lit > 0.45 ? pLit : v[1] < -1.5 ? pink : lit > 0 ? pearlC : 0xd2c7bc]);   // painted light → shadow so it reads round
    }
    const g = new V3.vox.Grid(23, 22, 25, { origin: [11, 0, 12] });
    for (const [x, y, z, c] of cells) g.c(c).set(x, y, z);
    return g;
  };

  // @@NEXT@@ makers

  // ---- geometry cache + build ----
  const cache = {}, mats = {};
  function matOf(id) {
    const k = 'r' + (GLOSS[id] || 0.75);
    if (!mats[k]) {
      mats[k] = V3.vox.material({ roughness: GLOSS[id] || 0.75 });
      mats[k].name = 'V3.shells.' + k; mats[k].userData.shared = true;
    }
    return mats[k];
  }
  // every maker designs its shell at its own resolution (longest side ≈ 24 cells); the mesh is then
  // scaled so that its longest side equals KINDS.size, so small shells get finer cells
  // 2026-11-12 起默认用三角面雕刻版（30-shell-kit.js 的 V3.shellKit.makers，模型在 30-shell-m*.js）；那一种还没有雕刻版、
  // 或网址带 ?shells=voxel 时用下面的体素版（MAKERS）。两种都归一到同样的大小和摆法。
  const sculptOf = (id) => { const K = V3.shellKit; return K && !K.legacy && K.makers && K.makers[id] ? K.makers[id] : null; };
  function geoOf(id) {
    if (cache[id]) return cache[id];
    const sc = sculptOf(id);
    if (sc) {
      const geo = sc();
      geo.computeBoundingBox(); const b = geo.boundingBox;
      const span = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z), k = BY[id].size / span;
      geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); geo.scale(k, k, k);
      geo.computeBoundingBox(); geo.computeBoundingSphere(); geo.userData.shared = true;
      return (cache[id] = { geo, tris: geo.getAttribute('position').count / 3, cells: 0, sculpt: true });
    }
    const ms = V3.vox.mesh(MAKERS[id](), { scale: 1, noise: GLOSS[id] ? 0.02 : 0.05, ao: 0.45 });
    if (ms.length !== 1) throw new Error('shell ' + id + ': ' + ms.length + ' meshes');
    // Beach placement and collection animation can turn any side upward. Keep every exposed
    // voxel face; the makers' empty cells already define real slits, lunules and shell mouths.
    const geo = ms[0].geometry;
    geo.computeBoundingBox(); const b = geo.boundingBox;
    const cells = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z), k = BY[id].size / cells;
    geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); geo.scale(k, k, k);
    geo.computeBoundingBox(); geo.computeBoundingSphere(); geo.userData.shared = true;
    return (cache[id] = { geo, tris: geo.index.count / 3, cells });
  }
  // opt.pat：这一枚的花纹（58-inventory-rules 的 PATTERNS；30-shell-variants 上色）。'plain' / 不给 = 原色
  function build(id, opt = {}) {
    const o = buildPlain(id, opt);
    return opt.pat && opt.pat !== 'plain' && V3.shellVariants ? V3.shellVariants.paint(o, id, opt.pat) : o;
  }
  function buildPlain(id, opt) {
    const k = BY[id];
    if ((!k || !MAKERS[id]) && V3.washupCatalog && V3.washupCatalog.has(id)) return V3.washupCatalog.build(id, opt);
    if (!k || !MAKERS[id]) throw new Error('V3.shells.build: unknown id ' + id);
    const { geo, tris } = geoOf(id), path = ROOT + '/' + k.name, anchor = opt.anchor || 'shell:' + id;
    const mesh = new THREE.Mesh(geo, [matOf(id)]); mesh.name = anchor;
    Object.assign(mesh.userData, { anchor, faceTags: [path], triTag: new Uint16Array(tris), shell: id });
    if (opt.tag !== false) V3.parts.tagFaces(mesh);   // tag:false → not in the parts registry (off-screen icons, FX stand-ins)
    const o = new THREE.Group(); o.name = 'shell-' + id; o.add(mesh);
    Object.assign(o.userData, { shell: id, tris, cells: geoOf(id).cells, sculpt: !!geoOf(id).sculpt });
    return o;
  }
  V3.shells = { KINDS, build, has: (id) => !!(BY[id] && MAKERS[id] || V3.washupCatalog && V3.washupCatalog.has(id)), _grid: (id) => MAKERS[id](), _spiral: spiral };   // _grid/_spiral: debug tools only

  // ---- catalog model 'shells': rare row at the back, common row in front, rarity-coloured plates ----
  V3.models.register({ id: 'shells', label: '贝壳海螺一览', build() {
    const root = new THREE.Group(); root.name = 'shells-catalog';
    V3.parts.declare(KINDS.map((k) => ROOT + '/' + k.name));
    const ROW = { rare: -0.21, uncommon: 0, common: 0.19 }, GAP = 0.045;
    const RING = { common: 0xcdb99a, uncommon: 0x7fbcae, rare: 0xe2b252 }, geos = [], pm = {}, views = {};
    const fov = 30 * Math.PI / 180, fit = (w) => (w / 2) / Math.tan(Math.atan(Math.tan(fov / 2) * 1.6)) * 1.25;
    let tris = 0, wMax = 0;
    for (const r of ['common', 'uncommon', 'rare']) {
      const row = KINDS.filter((k) => k.rarity === r && MAKERS[k.id]).map((k) => {
        const o = build(k.id), b = geoOf(k.id).geo.boundingBox;
        return { k, o, w: b.max.x - b.min.x, d: b.max.z - b.min.z };
      });
      const W = row.reduce((s, e) => s + e.w, 0) + GAP * Math.max(0, row.length - 1);
      wMax = Math.max(wMax, W); pm[r] = new THREE.MeshStandardMaterial({ color: RING[r], roughness: 0.9 });
      views[r] = { az: 0, el: 0.55, dist: Math.max(0.4, fit(W)), target: [0, 0.02, ROW[r]] };
      let x = -W / 2;
      for (const { k, o, w, d } of row) {
        const cx = x + w / 2, pr = Math.max(w, d) / 2 + 0.012; x += w + GAP;
        o.position.set(cx, 0.003, ROW[r]); root.add(o); tris += o.userData.tris;
        const cg = new THREE.CylinderGeometry(pr, pr + 0.003, 0.003, 40), plate = new THREE.Mesh(cg, pm[r]);
        plate.position.set(cx, 0.0015, ROW[r]); geos.push(cg);
        Object.assign(plate.userData, { noPick: true, anchor: 'shells:plate:' + k.id }); root.add(plate);
        const s = Math.max(w, d);
        views[k.id] = { az: 0.3, el: 0.75, dist: Math.max(0.22, s * 3.2), target: [cx, s * 0.1, ROW[r]] };
      }
    }
    pm.tray = new THREE.MeshStandardMaterial({ color: 0x5d6b7c, roughness: 1 });                 // blue-grey mat: white shells stand out
    const tg = new THREE.BoxGeometry(wMax + 0.12, 0.02, 0.62), tray = new THREE.Mesh(tg, pm.tray);
    tray.position.y = -0.01; geos.push(tg); Object.assign(tray.userData, { noPick: true, anchor: 'shells:tray' }); root.add(tray);
    const all = { az: 0, el: 0.75, dist: fit(wMax + 0.06), target: [0, 0.01, 0] };
    // studio preset is too bright for pale shells: darker background + exposure 0.85 (re-applied whenever the preset is set)
    const onStage = (id) => {
      if (id !== 'studio') return;
      const R = V3.R, b = R.scene.background; if (b && b.dispose) b.dispose();
      R.renderer.toneMappingExposure = 0.85; V3.stage.setBg('#a3adb9', '#66717f');
    };
    V3.on('stage', onStage);
    return {
      id: 'shells', label: '贝壳海螺一览', root, partRoot: ROOT, tris,
      stage: { pedestal: false, size: 0.8, center: [0, 0.03, 0] }, views: Object.assign({ all }, views),
      dispose() { V3.off('stage', onStage); for (const g of geos) g.dispose(); for (const r in pm) pm[r].dispose(); },
    };
  } });
})(window.V3);
