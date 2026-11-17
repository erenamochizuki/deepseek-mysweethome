// 30-shell-variants.js — V3.shellVariants：贝壳花纹（58-inventory-rules 的 PATTERNS）。
// 不逐个改模型：拿已经烘好的顶点色（每个三角一个颜色），按位置整体改色，所有可收藏的贝壳 / 拾物都能用。
// 变体几何和原几何共用 position / normal（同一份显存），只多一份 color；按（原几何, 花纹）缓存，标 shared，不会被场景 dispose。
//   paint(group, id, pat) → group：把组里每个带顶点色的 mesh 换成这个花纹的几何（'plain' / 未知花纹 = 不动）
//   geo(srcGeo, pat) → BufferGeometry
(function (V3) {
  'use strict';
  const U = V3.util;
  const cache = new WeakMap();                 // 原几何 → Map(花纹 → 变体几何)
  let C, T, D;                                  // 复用的 THREE.Color（THREE 用到时才有）
  const hsl = { h: 0, s: 0, l: 0 };
  const fract = (x) => x - Math.floor(x);
  const towardHue = (h, target, k) => { let d = target - h; d -= Math.round(d); return fract(h + d * k); };

  // 每个花纹：f(颜色 C（就地改）, p = [0..1]³ 包围盒里的位置, r = 离竖直中轴多远 0..1)
  const PAINT = {
    sunset(c) {                                  // 晚霞：往橘粉偏，略鲜艳
      c.getHSL(hsl);
      c.setHSL(towardHue(hsl.h, 0.02, 0.38), Math.min(1, hsl.s * 1.15 + 0.06), Math.min(0.92, hsl.l * 1.03));
    },
    mist(c) {                                    // 雾蓝：往青蓝偏，淡一点
      c.getHSL(hsl);
      c.setHSL(towardHue(hsl.h, 0.57, 0.42), hsl.s * 0.72, Math.min(0.94, hsl.l * 0.9 + 0.07));
    },
    ring(c, p, r) {                              // 环纹：从中轴往外一圈深一圈浅
      const band = Math.floor((r * 0.85 + p[1] * 0.55) * 7);
      if (band % 2) { c.getHSL(hsl); c.setHSL(towardHue(hsl.h, 0.07, 0.25), Math.min(1, hsl.s * 1.1 + 0.05), hsl.l * 0.66); }
    },
    dots(c, p) {                                 // 斑点：位置分格，一部分格子点上深褐色
      const h = U.hash3(Math.floor(p[0] * 11), Math.floor(p[1] * 11), Math.floor(p[2] * 11));
      if (h < 0.2) c.lerp(D.setRGB(0.12, 0.055, 0.025), 0.72);
    },
    albino(c) {                                  // 白化：几乎褪成奶白
      c.getHSL(hsl);
      c.setHSL(hsl.h, hsl.s * 0.18, Math.min(0.95, 0.72 + hsl.l * 0.25));
    },
    iris(c, p) {                                 // 虹彩：像贝母一样随位置变色
      c.getHSL(hsl);
      const h = fract(hsl.h + 0.62 * (p[0] * 1.3 + p[2] * 0.9 + p[1] * 0.7));
      T.setHSL(h, Math.max(0.5, hsl.s), Math.max(0.6, hsl.l));
      c.lerp(T, 0.55);
    },
  };

  function build(src, pat) {
    const fn = PAINT[pat], col = src.getAttribute('color'), pos = src.getAttribute('position');
    if (!fn || !col || !pos) return src;
    if (!C) { C = new THREE.Color(); T = new THREE.Color(); D = new THREE.Color(); }
    if (!src.boundingBox) src.computeBoundingBox();
    const b = src.boundingBox, min = b.min, size = new THREE.Vector3().subVectors(b.max, min);
    const sx = size.x || 1, sy = size.y || 1, sz = size.z || 1, cx = min.x + sx / 2, cz = min.z + sz / 2, rr = Math.max(sx, sz) / 2;
    const out = new Float32Array(col.count * 3);
    // 非索引的雕刻几何：每个三角一个颜色 → 按三角的中心算，三角里不出现渐变（保持平直着色的风格）
    const flat = !src.index && col.count % 3 === 0, step = flat ? 3 : 1;
    const p = [0, 0, 0];
    for (let i = 0; i < col.count; i += step) {
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < step; j++) { x += pos.getX(i + j); y += pos.getY(i + j); z += pos.getZ(i + j); }
      x /= step; y /= step; z /= step;
      p[0] = (x - min.x) / sx; p[1] = (y - min.y) / sy; p[2] = (z - min.z) / sz;
      const r = Math.min(1, Math.hypot(x - cx, z - cz) / rr);
      C.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      fn(C, p, r);
      for (let j = 0; j < step; j++) { const k = (i + j) * 3; out[k] = C.r; out[k + 1] = C.g; out[k + 2] = C.b; }
    }
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(src.attributes)) if (name !== 'color') g.setAttribute(name, src.attributes[name]);
    g.setAttribute('color', new THREE.Float32BufferAttribute(out, 3));
    if (src.index) g.setIndex(src.index);
    for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.boundingBox = src.boundingBox.clone();
    if (src.boundingSphere) g.boundingSphere = src.boundingSphere.clone();
    g.userData.shared = true; g.userData.pat = pat;
    return g;
  }
  function geo(src, pat) {
    if (!src || !pat || pat === 'plain' || !PAINT[pat]) return src;
    let m = cache.get(src);
    if (!m) cache.set(src, (m = new Map()));
    if (!m.has(pat)) m.set(pat, build(src, pat));
    return m.get(pat);
  }
  function paint(group, id, pat) {
    if (!group || !pat || pat === 'plain' || !PAINT[pat]) return group;
    group.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      o.geometry = geo(o.geometry, pat);
      // 雕刻几何每个三角都有面标签（triTag），三角数不变，照用
    });
    group.userData.pat = pat;
    return group;
  }
  V3.shellVariants = { paint, geo, has: (pat) => !!PAINT[pat], ids: Object.keys(PAINT) };
})(window.V3);
