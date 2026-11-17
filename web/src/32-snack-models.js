// 32-snack-models.js — V3.snackModels：零食的低多边形模型（和贝壳一样用 V3.shellKit.sculpt：每个三角一个顶点色、平直着色）。
// 单位米，底面 y = 0、水平居中，正面朝 +z。几何按（sku, 什么, 档位）缓存、标 shared（场景 dispose 不会删）；材质两种光泽各一份。
//   pack(sku, left) → Group   一件零食：盒 / 袋（正面贴着一份零食当标志）；杯 / 瓶 / 罐：液面跟 left（3 满 2 中 1 低 0 空）
//   piece(sku) → Group        一份：一颗蓝莓、一片海苔、一块蛋糕……（杯装的「一份」就是杯子本身：piece 返回 pack(sku, 3)）
//   held(sku, left) → Group   拿在她手里的样子：盒 / 袋装 = 一份，杯装 = 当前液面的杯子
(function (V3) {
  'use strict';
  const C = () => V3.snackCatalog;
  const K = () => V3.shellKit;
  const geos = new Map();
  let MAT = null, GLASS = null;
  const mat = () => {
    if (!MAT) { MAT = V3.vox.material({ roughness: 0.62 }); MAT.name = 'V3.snackModels'; MAT.userData.shared = true; }
    return MAT;
  };
  const glass = () => {
    if (!GLASS) { GLASS = V3.vox.material({ roughness: 0.18 }); GLASS.name = 'V3.snackModels.glass'; GLASS.userData.shared = true; }
    return GLASS;
  };
  const mix = (a, b, t) => K().mix(a, b, t);
  const WHITE = 0xffffff;

  // 一个缓存好的几何 → Mesh（材质数组，30-shells 一样的用法）
  function geo(key, draw) {
    if (!geos.has(key)) {
      const g = K().sculpt(draw);
      g.computeBoundingBox(); g.computeBoundingSphere(); g.userData.shared = true;
      geos.set(key, g);
    }
    return geos.get(key);
  }
  function mesh(key, draw, shiny) {
    const m = new THREE.Mesh(geo(key, draw), [shiny ? glass() : mat()]);
    m.name = 'snack:' + key; m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  // 按法线上色：朝上的面 top，其余 side
  const byNormal = (top, side, k = 0.45) => (n) => { const l = Math.hypot(n[0], n[1], n[2]) || 1; return n[1] / l > k ? top : side; };
  const T = (g, x, y, z) => g.translate(x, y, z);

  // ---- 一份零食 ----
  const PIECES = {
    blueberry: (s) => ({ add }) => {
      add(T(new THREE.IcosahedronGeometry(0.0075, 1), 0, 0.0075, 0), (n, a) => (a[1] > 0.0125 ? mix(s.colors[2], 0x101433, 0.5) : s.colors[2]));
      add(T(new THREE.CylinderGeometry(0.0022, 0.0028, 0.0024, 5), 0, 0.0152, 0), 0x2a2f5c);
    },
    nori: (s) => ({ add }) => add(T(new THREE.BoxGeometry(0.045, 0.0022, 0.034), 0, 0.0011, 0), byNormal(s.colors[2], mix(s.colors[2], 0x000000, 0.3))),
    cake: () => ({ tri, quad, add }) => {
      // 一块三角蛋糕：海绵 + 奶油夹层 + 顶上奶油 + 一颗草莓
      const R = 0.05, A = 0.42, layers = [[0, 0.014, 0xf1cf8a], [0.014, 0.019, 0xfff8ee], [0.019, 0.033, 0xf1cf8a], [0.033, 0.039, 0xfffaf2]];
      const p = (r, a, y) => [Math.sin(a) * r - 0.012, y, Math.cos(a) * r - R * 0.5];
      for (const [y0, y1, col] of layers) {
        const c0 = p(0, 0, y0), c1 = p(0, 0, y1), a0 = p(R, -A, y0), a1 = p(R, -A, y1), b0 = p(R, A, y0), b1 = p(R, A, y1);
        quad(c0, a0, a1, c1, col, [-Math.cos(A), 0, -Math.sin(A)]);
        quad(c0, c1, b1, b0, col, [Math.cos(A), 0, -Math.sin(A)]);
        const N = 5;
        for (let i = 0; i < N; i++) {
          const t0 = -A + (2 * A * i) / N, t1 = -A + (2 * A * (i + 1)) / N;
          quad(p(R, t0, y0), p(R, t1, y0), p(R, t1, y1), p(R, t0, y1), col, [Math.sin((t0 + t1) / 2), 0, Math.cos((t0 + t1) / 2)]);
          tri(p(0, 0, y1), p(R, t0, y1), p(R, t1, y1), col, [0, 1, 0]);
          tri(p(0, 0, y0), p(R, t0, y0), p(R, t1, y0), col, [0, -1, 0]);
        }
      }
      add(T(new THREE.IcosahedronGeometry(0.0085, 1).scale(1, 1.15, 1), ...p(R * 0.62, 0, 0.047)), (n) => (n[1] > 0.6 ? 0x3f8a3a : 0xe0303f));
    },
    bread: () => ({ add }) => add(T(new THREE.IcosahedronGeometry(1, 2).scale(0.028, 0.019, 0.024), 0, 0.016, 0), (n) => (n[1] > 0.25 ? 0xc9782f : 0xf0d8a8)),
    chips: (s) => ({ add }) => {
      const g = new THREE.CylinderGeometry(0.022, 0.022, 0.0016, 12, 1), p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, p.getY(i) + 260 * (x * x) - 120 * (z * z)); }
      add(T(g, 0, 0.006, 0), (n, a) => (U.hash3(Math.round(a[0] * 900), Math.round(a[2] * 900), 3) > 0.85 ? 0xd9a33f : s.colors[2]));
    },
    fish_cracker: (s) => ({ add }) => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.022, 0); sh.quadraticCurveTo(-0.004, 0.014, 0.012, 0.004); sh.lineTo(0.024, 0.012); sh.lineTo(0.022, -0.012);
      sh.lineTo(0.012, -0.004); sh.quadraticCurveTo(-0.004, -0.014, -0.022, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2);
      add(g, byNormal(s.colors[2], mix(s.colors[2], 0x7a4a1c, 0.3)));
      add(T(new THREE.IcosahedronGeometry(0.0022, 0), -0.013, 0.006, -0.002), 0x3a2a1a);
    },
    cookie: (s) => ({ add }) => {
      add(T(new THREE.CylinderGeometry(0.023, 0.024, 0.0065, 12), 0, 0.00325, 0), byNormal(s.colors[2], mix(s.colors[2], 0x7a4a1c, 0.25)));
      for (const [x, z] of [[0.008, 0.004], [-0.009, 0.007], [0.002, -0.011], [-0.006, -0.004], [0.012, -0.008]]) add(T(new THREE.BoxGeometry(0.0045, 0.003, 0.0045), x, 0.0072, z), 0x4a2a17);
    },
    marshmallow: (s) => ({ add }) => add(T(new THREE.CylinderGeometry(0.0125, 0.0125, 0.017, 10), 0, 0.0085, 0), byNormal(s.colors[1], s.colors[2], 0.7)),
    onigiri: (s) => ({ add }) => {
      const sh = new THREE.Shape(), r = 0.028;
      sh.moveTo(0, r); sh.quadraticCurveTo(r * 0.9, -r * 0.3, r * 0.75, -r * 0.65); sh.quadraticCurveTo(0, -r * 0.95, -r * 0.75, -r * 0.65);
      sh.quadraticCurveTo(-r * 0.9, -r * 0.3, 0, r);
      add(T(new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false, curveSegments: 5 }), 0, r * 0.95, -0.01), s.colors[2]);
      add(T(new THREE.BoxGeometry(0.03, 0.022, 0.0215), 0, 0.011, 0), s.colors[1]);
    },
  };
  const U = V3.util;

  // ---- 包装 ----
  function box(s) {
    const [c0, c1] = s.colors, w = 0.12, h = 0.06, d = 0.085;
    return mesh('box:' + s.sku, ({ add }) => {
      add(T(new THREE.BoxGeometry(w, h, d), 0, h / 2, 0), byNormal(mix(c0, WHITE, 0.25), c0));
      add(T(new THREE.BoxGeometry(w + 0.002, h * 0.36, d + 0.002), 0, h * 0.5, 0), c1);
      add(T(new THREE.BoxGeometry(w + 0.006, 0.008, d + 0.006), 0, h + 0.002, 0), byNormal(mix(c0, WHITE, 0.4), mix(c0, 0x000000, 0.12)));
    });
  }
  function bag(s) {
    const [c0, c1] = s.colors;
    return mesh('bag:' + s.sku, ({ add }) => {
      add(T(new THREE.IcosahedronGeometry(1, 2).scale(0.058, 0.08, 0.026), 0, 0.08, 0), (n, a) => (a[1] > 0.1 && a[1] < 0.125 ? c1 : c0));
      add(T(new THREE.BoxGeometry(0.1, 0.012, 0.014), 0, 0.157, 0), mix(c0, WHITE, 0.35));
      add(T(new THREE.BoxGeometry(0.1, 0.012, 0.014), 0, 0.006, 0), mix(c0, 0x000000, 0.15));
    });
  }
  // 杯装：开口的杯（马克杯 / 小杯），里面一层液面；瓶 / 罐不透明，液面高度画成瓶身下半截的颜色
  function cup(s, left) {
    const [c0, c1, c2] = s.colors, v = s.vessel || 'cup', lv = Math.max(0, Math.min(3, left | 0));
    const key = 'cup:' + s.sku + ':' + lv;
    if (v === 'bottle' || v === 'jar') {
      const jar = v === 'jar', r = jar ? 0.036 : 0.026, h = jar ? 0.07 : 0.105, fill = lv / 3;
      return mesh(key, ({ add }) => {
        const lo = Math.max(0.004, h * (0.08 + 0.84 * fill));
        add(T(new THREE.CylinderGeometry(r, r, lo, 12), 0, lo / 2, 0), lv ? c2 : mix(c0, 0x9fb4c8, 0.3));
        if (h - lo > 0.002) add(T(new THREE.CylinderGeometry(r, r, h - lo, 12), 0, lo + (h - lo) / 2, 0), mix(c0, 0xdfe9f2, 0.6));
        add(T(new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.3, 12, 1, true), 0, h * 0.45, 0), c1);
        if (jar) add(T(new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.014, 12), 0, h + 0.007, 0), c1);
        else {
          add(T(new THREE.CylinderGeometry(0.011, r, 0.026, 12), 0, h + 0.013, 0), mix(c0, 0xdfe9f2, 0.6));
          add(T(new THREE.CylinderGeometry(0.0115, 0.0115, 0.012, 10), 0, h + 0.032, 0), c1);
        }
      }, true);
    }
    const mug = v === 'mug', r = mug ? 0.032 : 0.028, h = mug ? 0.075 : 0.05, t = 0.003;
    return mesh(key, ({ add }) => {
      add(T(new THREE.CylinderGeometry(r, r * 0.92, h, 14, 1, true), 0, h / 2, 0), c0);                        // 外壁
      add(T(new THREE.CylinderGeometry(r - t, r * 0.92 - t, h, 14, 1, true).scale(-1, 1, 1), 0, h / 2, 0), mix(c0, 0x000000, 0.08));   // 内壁（翻面朝里）
      add(T(new THREE.RingGeometry(r - t, r, 14).rotateX(-Math.PI / 2), 0, h, 0), mix(c0, WHITE, 0.3));         // 杯沿
      add(T(new THREE.CircleGeometry(r * 0.92, 14).rotateX(Math.PI / 2), 0, 0, 0), mix(c0, 0x000000, 0.1));      // 杯底
      add(T(new THREE.CylinderGeometry(r * 1.005, r * 0.97, h * 0.3, 14, 1, true), 0, h * 0.42, 0), c1);         // 杯身色带
      const y = lv ? h * (0.18 + 0.24 * lv) : 0.002;
      add(T(new THREE.CircleGeometry((r - t) * (0.93 + 0.07 * (y / h)), 14).rotateX(-Math.PI / 2), 0, y, 0), lv ? c2 : mix(c0, 0x8a96a8, 0.25));
      if (mug) add(T(new THREE.TorusGeometry(0.019, 0.005, 6, 10, Math.PI).rotateZ(-Math.PI / 2), r + 0.002, h * 0.5, 0), c0);
      if (s.hot && lv === 3) for (const [x, z] of [[0.008, 0.004], [-0.01, -0.006], [0.0, -0.012]]) add(T(new THREE.BoxGeometry(0.009, 0.007, 0.009), x, y + 0.003, z), 0xfff8f0);
      if (s.sip === 'spoon' && lv) add(T(new THREE.BoxGeometry(0.006, 0.06, 0.003).rotateZ(-0.35), r * 0.45, y + 0.026, 0), 0xd8dde6);
    });
  }
  function piece(sku) {
    const s = C().get(sku); if (!s) return null;
    if (s.pack === 'cup') return pack(sku, 3);
    const g = new THREE.Group(); g.name = 'snack-piece:' + sku;
    const draw = PIECES[sku] ? PIECES[sku](s) : PIECES.cookie(s);
    g.add(mesh('piece:' + sku, draw));
    g.userData.snack = sku;
    return g;
  }
  function pack(sku, left) {
    const s = C().get(sku); if (!s) return null;
    const g = new THREE.Group(); g.name = 'snack-pack:' + sku;
    if (s.pack === 'cup') g.add(cup(s, left == null ? s.count : left));
    else {
      g.add(s.pack === 'box' ? box(s) : bag(s));
      // 正面贴一份零食当标志（盒子正面中间 / 袋子鼓起的正面）
      const p = piece(sku), b = s.pack === 'box';
      p.scale.setScalar(b ? 1.05 : 0.95);
      p.rotation.x = Math.PI / 2 - 0.15;
      p.position.set(0, b ? 0.018 : 0.06, b ? 0.05 : 0.03);   // 盒子的标签带外面一点，不埋进色带里
      g.add(p);
    }
    g.userData.snack = sku;
    return g;
  }
  const held = (sku, left) => { const s = C().get(sku); return !s ? null : s.pack === 'cup' ? pack(sku, left) : piece(sku); };
  // 图标（66-shell-icons 的离屏渲染，按 sku / 什么 / 档位缓存）：what 'pack'（默认）| 'piece'；left 只对杯装有用
  function icon(sku, o = {}) {
    const I = V3.shellIcons, s = C() && C().get(sku);
    if (!I || !s) return null;
    const what = o.what === 'piece' && s.pack !== 'cup' ? 'piece' : 'pack', lv = s.pack === 'cup' ? (o.left == null ? s.count : o.left) : '';
    return I.get('snack:' + sku + ':' + what + ':' + lv, { size: o.size || 96, build: () => (what === 'piece' ? piece(sku) : pack(sku, lv === '' ? undefined : lv)),
      view: what === 'piece' ? { az: 0.5, el: 0.95 } : { az: 0.55, el: 0.42 } });
  }
  V3.snackModels = { pack, piece, held, icon, has: (sku) => !!(C() && C().get(sku)) };
})(window.V3);
