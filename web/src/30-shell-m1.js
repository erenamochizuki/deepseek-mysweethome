// 30-shell-m1.js — 六种贝 / 海星 / 沙钱的三角面雕刻版（2026-11-12）：扇贝、花蛤、青口、沙钱、珍珠贝、海星。
// 体素原版在 30-shells.js（MAKERS），这里只注册 V3.shellKit.model；大小 / 摆放由 30-shells 的 geoOf 归一（单位随意，沿用体素版的格子单位）。
// 大多用 kit 的 lens：俯视轮廓 + 一圈圈往中心缩的环，上表面 / 下表面 / 边墙各自上色；平直着色，每个三角一个颜色。
(function (V3) {
  'use strict';
  const K = V3.shellKit, TAU = Math.PI * 2, mix = K.mix;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const shade = (c, f) => mix(c, f < 1 ? 0 : 0xffffff, Math.abs(1 - f));          // f<1 变暗，f>1 变亮
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const band = (ts, r) => (ts[Math.max(0, r)] + ts[Math.min(ts.length - 1, r + 1)]) / 2;   // 第 r 圈的中间 t
  // 小凸点：底面埋进表面里的锥（不封底，底圈在表面以下看不见）。c = [x, y 底, z]，h = 锥高，sides 几条棱
  const cone = (tri, c, r, h, col, sides = 4, rot = 0) => {
    const top = [c[0], c[1] + h, c[2]];
    for (let k = 0; k < sides; k++) {
      const a0 = rot + TAU * k / sides, a1 = rot + TAU * (k + 1) / sides, am = (a0 + a1) / 2;
      const p0 = [c[0] + r * Math.cos(a0), c[1], c[2] + r * Math.sin(a0)], p1 = [c[0] + r * Math.cos(a1), c[1], c[2] + r * Math.sin(a1)];
      tri(top, p0, p1, col, [Math.cos(am), r / Math.max(h, 0.01), Math.sin(am)]);
    }
  };
  // 第 k 条放射方向（k·72°，从 −z 起往 +x 转）的局部坐标 (s 沿臂, nn 横向) → 世界 [x, z]
  const arm = (k, s, nn) => { const a = k * TAU / 5; return [s * Math.sin(a) + nn * Math.cos(a), -s * Math.cos(a) + nn * Math.sin(a)]; };

  // 扇贝：壳顶在原点，扇面朝 +z 打开（±0.9 弧度）。13 条放射肋：每条肋 = 一条亮色平顶 + 两侧暗色斜面，凹沟是 V 形；
  // 肋尖处轮廓外凸一点 → 边缘波浪。颜色从壳顶深红渐到边缘橙杏。壳顶两侧两只耳朵（左大右小），耳朵上也有细肋。
  K.model('scallop', ({ lens }) => {
    const D = 10.3, RC = 12.6, A = 1.03, NR = 12, n = NR * 3 + 1;
    const deepC = 0x923f4a, midC = 0xd97877, edgeC = 0xe39c80, earC = 0xb4442a, earL = 0xd0623a, belly = 0xe0844e, wall = 0xc4532a;
    const ang = (i) => -A + 2 * A * i / (n - 1), rib = (i) => i % 3 !== 0;                  // 每 3 个点一个周期：沟、肋左、肋右
    const rim = (a) => D * Math.cos(a) + Math.sqrt(RC * RC - (D * Math.sin(a)) ** 2);
    const grad = (t) => (t < 0.5 ? mix(deepC, midC, t / 0.5) : mix(midC, edgeC, (t - 0.5) / 0.5));
    const ts = [0, .22, .43, .56, .63, .77, .84, .93, 1];
    lens({ n, ts, open: true, centre: [0, 0],
      outline: (i) => { const a = ang(i), r = rim(a) * (rib(i) ? 1.035 : 1); return [r * Math.sin(a), r * Math.cos(a)]; },
      top: (t, i) => {
        const a = ang(i), dome = 0.4 + 3.3 * Math.sin(Math.PI * Math.min(1, 0.25 + 0.75 * t)) * (1 - 0.45 * (a / A) ** 2);
        return dome + (t>.92?.24:0) + (rib(i) ? .85 : -.32) * sstep(0.05, 0.5, t);
      },
      colTop: (r, i) => { const g = mix(grad(band(ts,r)), 0xffe2bf, (r===3 || r===6 ? .66 : .05) + (i%9<3 ? .15 : 0)); return i%3===1 ? g : mix(g,deepC,.29); },   // 肋顶亮、两侧斜面暗
      colRim: () => wall,
      colBot: () => belly });
    // 耳朵：铰合线两侧的小三角片，外缘一圈小齿肋（左边的足丝耳长一点）
    const ear = (sx, W) => {
      const P = [[0.3, -0.5], [0.35 * W, -0.6], [0.7 * W, -0.6], [W, -0.5], [0.9 * W, 1.4], [3.2, 3.0]];
      const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cz = P.reduce((s, p) => s + p[1], 0) / P.length;
      lens({ n: P.length, ts: [0, 1], centre: [sx * cx, cz], outline: (i) => [sx * P[i][0], P[i][1]],
        top: (t, i) => 1.5 - 0.35 * t,
        colTop: (r, i) => (i % 2 ? earC : earL), colRim: (i) => (i % 2 ? shade(earC, 0.85) : earL), colBot: () => belly });
    };
    ear(-1, 6.8); ear(1, 5.5);
  });

  // 花蛤：圆三角轮廓，壳顶（−z）偏后；一圈圈生长纹绕着壳顶（lens 的中心就放在壳顶附近），浅米 / 奶白相间，
  // 几道棕色锯齿纹从壳顶往外放射（每圈错一格 → 之字）。两片壳合着：上片高拱，下片浅拱，中间一圈深棕接缝。
  K.model('clam', ({ lens }) => {
    const base = 0xb79184, light = 0xe9c9b0, zig = 0x805f70, zig2 = 0x9a777f, umbo = 0xb88c66, seam = 0x6a4636;
    const n = 30, ts = [0, 0.15, 0.29, 0.43, 0.57, 0.71, 0.86, 1], R = ts.length - 1;
    // 之字纹：每 3 个角一道，偶数圈斜着往右跨一格（两个半三角拼成平行四边形），奇数圈直着走一格 → 一折一折往外
    const paint = (r, i, dark) => {
      const k = dark ? 0.9 : 1, sh = (c) => (dark ? shade(c, k) : c);
      if (r === 0) return sh(umbo);
      const c = sh(r & 1 ? base : light), z = sh(r & 1 ? zig2 : zig);
      if (r >= R - 1) return c;
      const s0 = (r >> 1) + (dark ? 1 : 0), m = (i - s0 + 300) % 3;
      if (K.hash(Math.floor((i - s0 + 300) / 3), dark ? 3 : 1) < 0.15) return c;            // 偶尔断一道
      if (r & 1) return m === 1 ? z : c;
      return m === 0 ? [z, c] : m === 1 ? [c, z] : c;
    };
    lens({ n, ts, centre: [0, -5.2],
      outline: (i) => { const th = TAU * i / n, R0 = 9.6 * (1 + 0.09 * Math.cos(3 * th)); return [1.21 * R0 * Math.sin(th), 0.6 - .93*R0 * Math.cos(th)]; },
      top: (t) => 0.8 + 5.3 * Math.sqrt(Math.max(0, 1 - t * t)) + .29*Math.sin(t*7*Math.PI),
      bot: (t) => -0.3 - 1.5 * Math.sqrt(Math.max(0, 1 - t * t)),
      colTop: (r, i) => paint(r, i, false), colBot: (r, i) => paint(r, i, true), colRim: () => seam });
  });

  // 青口：蓝黑长壳，尖头（壳顶）在 −x；生长纹一圈圈绕着壳顶，蓝黑 / 深蓝相间，靠边一圈灰蓝；
  // 两片壳合着，中间的接缝是一圈珍珠层的彩光边（粉 / 蓝 / 绿 / 金轮换）
  K.model('mussel', ({ lens }) => {
    const dark = 0x223b44, blue = 0x365764, edge = 0x6da19b, umbo = 0x3b3430;
    const NAC = [0xb9c6e8, 0xe2bfd9, 0xa9dcd3, 0xe6dcb4];
    const n = 20, ts = [0,.16,.28,.40,.48,.60,.69,.79,.87,.94,1], R = ts.length - 1;
    const wf = (t) => 6.25 * Math.sqrt(Math.max(0, t)) * Math.sqrt(Math.max(0, 1 - t ** 4)), zc = (t) => 3.8 * (t - 0.52) ** 2 - 1.2;
    const hf = (x, z, k) => {
      const L = clamp((x + 12) / 24, 0, 1), w = wf(L), q = w > 0.3 ? Math.min(1, ((z - zc(L)) / w) ** 2) : 1;
      return 0.4 + k * Math.sqrt(1 - q) * Math.sqrt(Math.sin(Math.PI * Math.min(L * 1.25, 1)));
    };
    const paint = (r, under) => {
      const c = r === 0 ? umbo : r >= R - 1 ? edge : r & 1 ? blue : dark;
      return under ? shade(c, .83) : mix(c,0x709894,r===4?.42:.04);
    };
    lens({ n, ts, centre: [-9.3, zc(0.11)],
      outline: (i) => { const u = TAU * i / n, t = (1 - Math.cos(u)) / 2, s = Math.sin(u) >= 0 ? 1 : -1; return [-12 + 24 * t, zc(t) + s * wf(t)]; },
      top: (t, i, x, z) => hf(x, z, 3.4), bot: (t, i, x, z) => -hf(x, z, 2.0),
      colTop: (r) => paint(r, false), colBot: (r) => paint(r, true), colRim: (i) => NAC[i % 4] });
  });

  // 沙钱：扁圆盘，边缘削薄；背上 5 片微微凸起的叶形花瓣（浅色瓣心 + 一圈深浅相间的点线），花瓣之间 5 条细长孔
  // （画成深色的孔，上下两面都画，外面一圈浅棕边），中心一点
  K.model('dollar', ({ lens, tri }) => {
    const body = 0xd8c6b3, rimC = 0xbdab95, dot = 0x966d72, line = 0xb6918b, fill = 0xf8e3cc, ctr = 0xa8885f, slotE = 0x8e7252, hole = 0x3a2a1c, under = 0xcbb48e;
    const RD = 11.2, TOP = 1.62, NS = 35;
    lens({ n: NS, ts: [0, 0.12, 0.82, 0.92, 1], outline: (i) => {const a=TAU*i/NS,rr=RD*(1+.045*Math.cos(5*a));return [rr*Math.sin(a),.94*rr*Math.cos(a)];},
      top: (t) => (t <= 0.82 ? TOP : t <= 0.92 ? 1.05 : 0.45),
      colTop: (r) => (r === 0 ? ctr : r >= 2 ? rimC : body), colRim: () => shade(rimC, 0.9), colBot: () => under });
    for (let k = 0; k < 5; k++) {                                         // 花瓣
      const NP = 12, pts = Array.from({ length: NP }, (_, i) => {
        const u = TAU * i / NP, s = 1.8 + 6.6 * (1 - Math.cos(u)) / 2, t = (s - 1.8) / 6.6;
        return arm(k, s, Math.sign(Math.sin(u)) * 1.49 * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.8));
      });
      lens({ n: NP, ts: [0, 0.62, 1], centre: arm(k, 5.1, 0), floor: TOP - 0.1, outline: (i) => pts[i],
        top: (t) => TOP + 0.25 + 0.3 * (1 - t * t),
        colTop: (r, i) => (r === 0 ? fill : i % 2 ? dot : line), colRim: () => line });
    }
    for (let k = 0; k < 5; k++) {                                         // 细长孔：浅棕边 + 深色孔，上下两面
      const kk = k + 0.5, poly = (e) => [[5.4 - e, 0], [6.2, -0.55 - e], [8.0, -0.55 - e], [8.8 + e, 0], [8.0, 0.55 + e], [6.2, 0.55 + e]].map(([s, nn]) => arm(kk, s, nn));
      for (const [e, col, dy] of [[0.45, slotE, 0.02], [0, hole, 0.04]]) {
        const P = poly(e), c = arm(kk, 7.1, 0);
        for (let i = 0; i < P.length; i++) {
          const a = P[i], b = P[(i + 1) % P.length];
          tri([c[0], TOP + dy, c[1]], [a[0], TOP + dy, a[1]], [b[0], TOP + dy, b[1]], col, [0, 1, 0]);
          tri([c[0], -dy, c[1]], [a[0], -dy, a[1]], [b[0], -dy, b[1]], col, [0, -1, 0]);
        }
      }
    }
  });

  // 珍珠贝：铰合线在后（−z）。下壳 = 浅碗：里面珍珠层（粉 / 蓝 / 绿 / 金按半径 + 角度渐变），外面灰褐色层状鳞纹，边缘不齐、一圈深色边；
  // 上壳绕铰合线翻开 80°，里面的珍珠层朝着镜头；碗里一颗圆珍珠（亮面、高光、底下淡粉）
  K.model('pearl', ({ lens, add }) => {
    const ZH = -7.5, R0 = 8.0, ZC = ZH + R0, OPEN = 62 * Math.PI / 180, co = Math.cos(OPEN), so = Math.sin(OPEN), YR = 3;
    const NAC = [0xc890a1, 0x859eae, 0x9cbba2, 0xcfb889, 0xb59bb8], OL = [0x7a6e60, 0x968978], olE = 0xb8ac96, edge = 0x6a5c4c;
    const nac = (r, a) => { const f = ((r * 0.55 + a * 1.6) % 5 + 5) % 5, i = Math.floor(f); return mix(NAC[i], NAC[(i + 1) % 5], f - i); };
    const n = 20, jag = Array.from({ length: n }, (_, i) => 1+.045*Math.cos(i*TAU/24*9)+.035*K.hash(i,3,7));
    const outline = (i) => { const a = TAU * i / n; return [R0 * jag[i] * Math.sin(a), ZC + R0 * jag[i] * Math.cos(a)]; };
    const angOf = (p) => Math.atan2(p[0], p[2] - ZC);
    const lam = (r, i, last) => (r === last ? olE : OL[(r + (K.hash(i, r, 9) > 0.65 ? 1 : 0)) & 1]);
    const ts0 = [0, 0.4, 0.65, 0.82, 0.94, 1];                                           // 下壳
    lens({ n, ts: ts0, centre: [0, ZC], outline,
      top: (t) => 0.8 + 2.2 * t * t, bot: (t) => 2.7 * Math.max(0, (t - 0.45) / 0.55) ** 2,
      colTop: (r, i, p) => (r === ts0.length - 2 ? edge : shade(nac(band(ts0, r) * R0, angOf(p)), 0.86)),
      colBot: (r, i) => lam(r, i, ts0.length - 2), colRim: () => edge });
    const ts1 = [0, 0.5, 0.8, 0.94, 1];                                                  // 上壳：合着时的样子，再绕铰合线翻开
    const map = (p) => { const lz = p[2] - ZH, ly = p[1]; return [p[0], YR + lz * so + ly * co, ZH + lz * co - ly * so]; };
    lens({ n, ts: ts1, centre: [0, ZC], outline, map,
      top: (t) => 1.8 * (1 - t * t) + 0.5 - 0.2 * t, bot: (t) => 1.8 * (1 - t * t) - 0.3,
      colTop: (r, i) => lam(r, i, ts1.length - 2),
      colBot: (r, i, p) => (r === ts1.length - 2 ? edge : nac(band(ts1, r) * R0 + 3, angOf(p))), colRim: () => edge });
    const L = [-0.5, 0.75, 0.43];
    K.ball(add, [0, 4, 0], 3.71, 1, (v) => {
      const lit = v[0] * L[0] + v[1] * L[1] + v[2] * L[2];
      return lit > 0.86 ? 0xffffff : lit > 0.45 ? 0xf1ebe2 : v[1] < -0.45 ? 0xd8c0c0 : lit > 0 ? 0xddd3c8 : 0xd2c7bc;
    });
  });

  // 海星：五条臂往尖端变细、臂尖圆，中间鼓、边缘薄（高度 = 离中心多远 × 离臂中线多远）；
  // 每条臂中线一排凸点 + 两侧各一排小凸点（真凸起的小锥），盘上 5 颗，边缘深一档，偏心一个浅黄筛板
  K.model('starfish', ({ lens, tri }) => {
    const L = 11.3, W0 = 3.0, WT = 1.20, TIP = L + WT, RV = 4.6;
    const orange = 0xcb6246, ridge = 0xc95645, deep = 0xab4944, bump = 0xffbc8c, ctr = 0xc94f22, mad = 0xf2c36b, under = 0xc4501e;
    const wOf = (s) => (s <= L ? W0 + (WT - W0) * s / L : WT);
    const qOf = (x, z) => {                                               // 离最近那条臂的中线：0 中线 … 1 边
      let q = Math.hypot(x, z) <= 4 ? 0.95 * Math.hypot(x, z) / 4 : 9;
      for (let k = 0; k < 5; k++) {
        const a = k * TAU / 5, s = x * Math.sin(a) - z * Math.cos(a), nn = x * Math.cos(a) + z * Math.sin(a);
        if (s < 0) continue;
        q = Math.min(q, s <= L ? Math.abs(nn) / wOf(s) : Math.hypot(s - L, nn) / WT);
      }
      return Math.min(q, 1);
    };
    const hs = (x, z) => { const hb = 1.0 + 3.0 * Math.pow(Math.max(0, 1 - Math.hypot(x, z) / TIP), 1.2); return 0.35 + (hb - 0.35) * Math.pow(1 - qOf(x, z) ** 2, 0.35); };
    const pts = [];
    for (let k = 0; k < 5; k++) {
      for (const [s, f] of [[6, -1], [9, -1], [L, -0.95]]) pts.push(arm(k, s, f * wOf(s)));
      pts.push(arm(k, L + 0.75 * WT, -0.66 * WT), arm(k, TIP, 0), arm(k, L + 0.75 * WT, 0.66 * WT));
      for (const [s, f] of [[L, 0.95], [9, 1], [6, 1]]) pts.push(arm(k, s, f * wOf(s)));
      pts.push(arm(k + 0.5, RV, 0));                                      // 两臂之间的凹口
    }
    lens({ n: pts.length, ts: [0, 0.35, 0.65, 0.87, 1], outline: (i) => {const [x,z]=pts[i],a=.0014*(x*x+z*z);return [x*Math.cos(a)-z*Math.sin(a),x*Math.sin(a)+z*Math.cos(a)];}, top: (t, i, x, z) => hs(x, z),
      colTop: (r, i, p) => {
        if (Math.hypot(p[0], p[2]) < 1.6) return ctr;
        const q = qOf(p[0], p[2]); return q > 0.72 ? deep : q < 0.3 ? ridge : orange;
      },
      colRim: () => deep, colBot: () => under });
    const knob = (x, z, r, h, sides, col = bump) => {                    // 锥底埋到周围最低处以下，斜坡上也不露底
      let lo = hs(x, z); for (let k = 0; k < 6; k++) lo = Math.min(lo, hs(x + r * Math.cos(k), z + r * Math.sin(k)));
      cone(tri, [x, lo - 0.15, z], r, hs(x, z) - lo + 0.15 + h, col, sides, K.hash(x, z) * TAU);
    };
    for (let k = 0; k < 5; k++) {
      for (let j = 0; j < 4; j++) { const [x, z] = arm(k, 2.9 + 2.2 * j, 0); knob(x, z, 0.75, 0.55, 4); }       // 中线一排
      for (let j = 0; j < 3; j++) for (const sd of [-1, 1]) {                                                   // 两侧各一排
        const s = 4.0 + 2.2 * j, [x, z] = arm(k, s, sd * 0.58 * wOf(s)); knob(x, z, 0.55, 0.35, 3);
      }
      const [x, z] = arm(k + 0.5, 2.4, 0); knob(x, z, 0.65, 0.45, 4);                                          // 盘上 5 颗
    }
    knob(1, 1, 0.7, 0.15, 5, mad);                                                                              // 筛板
  });
})(window.V3);
