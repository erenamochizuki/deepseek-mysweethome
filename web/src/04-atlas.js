// 04-atlas.js — V3.atlas：程序生成 16×16 像素贴图图集（移植自 v1 的 04-atlas.js）。Owner: engine。
// 固定 1024×512 = 32×16 个 32 px 槽（16 px 贴图 + 每边 8 px 护边：可平铺贴图按周期复制，精灵按边缘延伸），
// 数据行自下而上（flipY=false，v 向上），手工 mip 链（线性空间、alpha 加权），放大最近邻。确定性：不用 Math.random。
// API：add(name, paint(px, rng, lib), {clamp}) / has / index / uv(name)→[u0,v0,u1,v1] / texture() / names / lib。
(function (V3) {
  'use strict';
  const S = 16, SLOT = 32, G = 8, COLS = 32, ROWS = 16, W = COLS * SLOT, H = ROWS * SLOT, MAX = COLS * ROWS;
  // ---------- helpers (deterministic) ----------
  const hs = s => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
  const mk = seed => { let a = (typeof seed === 'string' ? hs(seed) : seed) >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  let rr = mk('atlas');                       // 当前贴图的 rng（每张贴图绘制前按名字重置，贴图之间互不影响）
  const r = () => rr();
  const h2 = (x, y, s) => { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const sm = t => t * t * (3 - 2 * t);
  const n2 = (x, y, seed, p) => { // value noise in [0,1); p = lattice period (seamless)
    const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi), w = v => (p ? ((v % p) + p) % p : v);
    const a = h2(w(xi), w(yi), seed), b = h2(w(xi + 1), w(yi), seed), c = h2(w(xi), w(yi + 1), seed), d = h2(w(xi + 1), w(yi + 1), seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  const tn = (x, y, seed, cells) => n2(x * cells / S, y * cells / S, seed, cells); // 贴图无缝噪声（x、y 的倍率须为整数）
  const cl = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const mix = (c1, c2, t) => { t = cl(t); return [0, 1, 2].map(i => Math.round(c1[i] + (c2[i] - c1[i]) * t)); };
  const hex = s => { s = String(s).replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
  const P = (...a) => a.map(hex);             // palette from hex strings, dark → light
  const ramp = (pal, t) => pal[Math.min(pal.length - 1, Math.max(0, Math.floor(t * pal.length)))];
  const each = fn => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) fn(x, y); };
  const rgb = c => (typeof c === 'number' ? [(c >> 16) & 255, (c >> 8) & 255, c & 255] : typeof c === 'string' ? hex(c) : c);
  // 贴图缓冲：可直接调用 px(x, y, c, a)（c = [r,g,b] | 0xRRGGBB | '#rrggbb'，a ≤ 0 清空），px.get(x, y)，px.d = RGBA（第 0 行在上）
  const buf = () => { const d = new Uint8ClampedArray(S * S * 4);
    const f = (x, y, c, a = 255) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= S || y >= S) return; const o = (y * S + x) * 4;
      if (a <= 0) { d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0; return; } c = rgb(c); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = a; };
    f.d = d; f.get = (x, y) => { const o = ((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4; return [d[o], d[o + 1], d[o + 2], d[o + 3]]; };
    return f; };
  const px = (g, x, y, c, a = 255) => { if (g && g.d) g(x, y, c, a); }; // v1 写法；v1 的自发光/高光画布在 v3 里是空槽，写入被忽略
  const SINK = { fillRect() {}, clearRect() {}, fillStyle: '' };
  // ---------- registry ----------
  const tiles = [], idx = Object.create(null), uvs = [], warned = Object.create(null);
  const camel = s => s.replace(/_([a-z0-9])/g, (m, c) => c.toUpperCase()); // v1 的 oak_log_top → oakLogTop
  let tex = null, dirty = false, queued = false, lvl0 = null;
  function reg(name, paint, legacy, o) {
    let i = idx[name];
    if (i === undefined) {
      if (tiles.length >= MAX) { V3.err('atlas: full (' + MAX + '), skip ' + name); return 0; }
      i = idx[name] = tiles.length; tiles.push(null); A.names.push(name);
      const c = i % COLS, rw = (i / COLS) | 0;
      uvs[i] = [(c * SLOT + G) / W, (rw * SLOT + G) / H, (c * SLOT + G + S) / W, (rw * SLOT + G + S) / H];
    }
    tiles[i] = { name, paint, legacy, clamp: !!(o && o.clamp), d: null };
    if (tex) { dirty = true; if (!queued) { queued = true; Promise.resolve().then(() => { queued = false; if (dirty) build(); }); } }
    return i;
  }
  const T = (name, paint, o) => reg(camel(name), paint, true, o);   // v1 painter (g, e, s)
  function dilate(d) { // 把颜色扩进 alpha=0 的像素，过滤/mip 时不会吸进黑边
    let m = new Uint8Array(S * S), n0 = 0, aR = 0, aG = 0, aB = 0;
    for (let i = 0; i < S * S; i++) if (d[i * 4 + 3]) { m[i] = 1; n0++; aR += d[i * 4]; aG += d[i * 4 + 1]; aB += d[i * 4 + 2]; }
    if (!n0 || n0 === S * S) return;
    for (let pass = 0; pass < 2; pass++) {
      const m2 = m.slice();
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = y * S + x; if (m[i]) continue;
        let n = 0, R = 0, Gc = 0, B = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue; const j = yy * S + xx; if (!m[j]) continue;
          n++; R += d[j * 4]; Gc += d[j * 4 + 1]; B += d[j * 4 + 2]; }
        if (n) { d[i * 4] = R / n; d[i * 4 + 1] = Gc / n; d[i * 4 + 2] = B / n; m2[i] = 1; } }
      m = m2;
    }
    for (let i = 0; i < S * S; i++) if (!m[i]) { d[i * 4] = aR / n0; d[i * 4 + 1] = aG / n0; d[i * 4 + 2] = aB / n0; }
  }
  function paint(t) {
    rr = mk('atlas:' + t.name); const g = buf();
    try { if (t.legacy) t.paint(g, SINK, SINK); else t.paint(g, r, L); } catch (e) { V3.err('atlas ' + t.name + ': ' + e); }
    const d = g.d; // 边缘有全透明像素 → 精灵：护边按边缘延伸（不周期复制）
    if (!t.clamp) for (let k = 0; k < S && !t.clamp; k++) if (!d[k * 4 + 3] || !d[((S - 1) * S + k) * 4 + 3] || !d[(k * S) * 4 + 3] || !d[(k * S + S - 1) * 4 + 3]) t.clamp = true;
    dilate(d); return d;
  }
  const wrap = (v, c) => (c ? (v < 0 ? 0 : v >= S ? S - 1 : v) : ((v % S) + S) % S);
  function compose() {
    const d = lvl0 || (lvl0 = new Uint8Array(W * H * 4)); d.fill(0);
    for (let i = 0; i < tiles.length; i++) { const t = tiles[i]; if (!t) continue; const s = t.d || (t.d = paint(t));
      const ox = (i % COLS) * SLOT, oy = ((i / COLS) | 0) * SLOT;
      for (let yy = 0; yy < SLOT; yy++) { const ty = S - 1 - wrap(yy - G, t.clamp); // 槽内自下而上 → 贴图行（0 在上）
        for (let xx = 0; xx < SLOT; xx++) { const si = (ty * S + wrap(xx - G, t.clamp)) * 4, di = ((oy + yy) * W + ox + xx) * 4;
          d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3]; } } }
    return d;
  }
  const S2L = new Float32Array(256), L2S = new Uint8Array(4097);
  for (let i = 0; i < 256; i++) { const c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  for (let i = 0; i <= 4096; i++) { const c = i / 4096; L2S[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }
  function down(src, w, h) { // 2×2 盒式降采样：线性空间、alpha 加权
    const w2 = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), d = new Uint8Array(w2 * hh * 4);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w2; x++) {
      let R = 0, Gs = 0, B = 0, Al = 0, R0 = 0, G0 = 0, B0 = 0;
      for (let k = 0; k < 4; k++) { const sx = Math.min(w - 1, x * 2 + (k & 1)), sy = Math.min(h - 1, y * 2 + (k >> 1)), o = (sy * w + sx) * 4, a = src[o + 3];
        const lr = S2L[src[o]], lg = S2L[src[o + 1]], lb = S2L[src[o + 2]]; R += lr * a; Gs += lg * a; B += lb * a; Al += a; R0 += lr; G0 += lg; B0 += lb; }
      if (Al) { R0 = R / Al; G0 = Gs / Al; B0 = B / Al; } else { R0 *= 0.25; G0 *= 0.25; B0 *= 0.25; }
      const o = (y * w2 + x) * 4; d[o] = L2S[(R0 * 4096) | 0]; d[o + 1] = L2S[(G0 * 4096) | 0]; d[o + 2] = L2S[(B0 * 4096) | 0]; d[o + 3] = (Al + 2) >> 2;
    }
    return { data: d, width: w2, height: hh };
  }
  function build() {
    dirty = false;
    const d0 = compose(), mips = [{ data: d0, width: W, height: H }];
    for (let m = mips[0]; m.width > 1 || m.height > 1;) { m = down(m.data, m.width, m.height); mips.push(m); }
    if (!tex) {
      tex = new THREE.DataTexture(d0, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = false; tex.flipY = false; tex.anisotropy = 4; tex.name = 'V3.atlas'; tex.userData.shared = true;
    }
    tex.image = { data: d0, width: W, height: H }; tex.mipmaps = mips; tex.needsUpdate = true;
    return tex;
  }
  // ---------- API ----------
  const L = { S, T, px, mix, n2, tn, h2, cl, hex, P, ramp, each, r, mk, buf };
  const A = V3.atlas = { S, size: [W, H], names: [], lib: L,
    add: (name, fn, o) => reg(String(name), fn, false, o),
    has: n => n in idx,
    index: n => (n in idx ? idx[n] : -1),
    slot(n) { if (n in idx) return idx[n]; if (!warned[n]) { warned[n] = 1; console.warn('V3.atlas: unknown tile ' + n); } return 0; },
    uv: n => uvs[A.slot(n)],                 // 共享数组，别改；GL 约定 v0 在下、v1 在上
    texture() { if (!tex || dirty) build(); return tex; } };
  reg('missing', g => each((x, y) => px(g, x, y, ((x >> 3) + (y >> 3)) & 1 ? [0, 0, 0] : [248, 0, 248])), false);
  // ---------- 以下移植自 v1（名字自动转 camelCase：oak_log_top → oakLogTop）----------
  { // ---------- terrain ----------
    const { S, T, px, mix, tn, h2, cl, P, ramp, each, r } = L;
    const noisy = (g, pal, o = {}) => each((x, y) => {
      const k = o.k ?? 0.5, t = tn(x, y, o.seed ?? 1, o.cells ?? 4) * k + r() * (1 - k);
      px(g, x, y, ramp(pal, cl(t * (o.gain ?? 1) + (o.bias ?? 0))));
    });
    const spec = () => {}; // v1 的高光图（v3 不用）
    const pts = n => Array.from({ length: n }, () => [r() * S, r() * S, r()]);
    const vor = (x, y, ps) => { let d1 = 1e9, d2 = 1e9, i1 = 0; // wrapped voronoi → [cell, d1, d2]
      for (let i = 0; i < ps.length; i++) {
        let dx = Math.abs(x + 0.5 - ps[i][0]), dy = Math.abs(y + 0.5 - ps[i][1]);
        dx = Math.min(dx, S - dx); dy = Math.min(dy, S - dy); const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; i1 = i; } else if (d < d2) d2 = d;
      }
      return [i1, Math.sqrt(d1), Math.sqrt(d2)]; };
    Object.assign(L, { noisy, spec, pts, vor });
    const SAND = L.SAND = P('a88859', 'c0a070', 'cfb081', 'dbbd90', 'e6cba0'); // wide ramp: noon tonemap squashes highlights
    const SST = L.SST = P('a08250', 'b69767', 'c4a676', 'd0b384', 'dbbf92');
    const GRV = L.GRV = P('5f5953', '766f68', '8b837b', 'a0978d', 'b8aea3', 'cfc6bb');
    const DIRT = L.DIRT = P('5e3f29', '6f4c32', '80593b', '916746', 'a27753');
    const GRS = L.GRS = P('4f7d2f', '5e8f37', '6e9f40', '7fae49', '90bc54', 'a3c961');
    T('sandstone', g => each((x, y) => {
      let t = 0.45 + (r() - 0.5) * 0.35 + (tn(x, y, 5, 4) - 0.5) * 0.3;
      if (y < 3) t += 0.3;                       // pale top lip
      else if (y === 3) t -= 0.3;                // shadow line under the lip
      else if (y >= 11) t -= y === 11 ? 0.3 : 0.12; // darker base band
      px(g, x, y, ramp(SST, cl(t)));
    }));
    T('sandstone_top', g => noisy(g, SST, { seed: 6, k: 0.3, gain: 0.6, bias: 0.3 }));
    T('smooth_sandstone', g => noisy(g, SST, { seed: 7, k: 0.5, gain: 0.3, bias: 0.45 }));
    T('cut_sandstone', g => each((x, y) => {
      let t = 0.5 + (r() - 0.5) * 0.25;
      if (x === 0 || y === 0 || y === 8) t = 0.9; else if (x === 15 || y === 15 || y === 7) t = 0.1;
      px(g, x, y, ramp(SST, cl(t)));
    }));
    T('gravel', g => { const ps = pts(18); each((x, y) => { const [i, a, b] = vor(x, y, ps);
      let t = ps[i][2] * 0.75 + r() * 0.25; if (b - a < 0.9) t *= 0.3; else if (a < 1.2) t += 0.12;
      px(g, x, y, ramp(GRV, cl(t))); }); });
    T('dirt', g => noisy(g, DIRT, { seed: 8, k: 0.3 }));
    T('coarse_dirt', g => { noisy(g, DIRT, { seed: 9, k: 0.3, gain: 0.9 }); const ps = pts(8);
      each((x, y) => { const [i, a] = vor(x, y, ps); if (a < 1.2 && ps[i][2] < 0.65) px(g, x, y, ramp(GRV, cl(0.2 + ps[i][2] + r() * 0.15))); }); });
    T('grass_top', g => noisy(g, GRS, { seed: 10, k: 0.35 }));
    T('grass_side', g => { noisy(g, DIRT, { seed: 11, k: 0.3 });
      for (let x = 0; x < S; x++) {
        const d = 2 + ((h2(x, 0, 12) * 3) | 0) + (h2(x, 1, 12) > 0.8 ? 2 : 0);
        for (let y = 0; y < d; y++) px(g, x, y, ramp(GRS, cl(0.3 + r() * 0.55 - (y === d - 1 ? 0.25 : 0))));
      } });
    T('clay', g => noisy(g, P('949bab', '9fa6b5', 'a9b0be', 'b3bac7', 'bdc3cf'), { seed: 13, k: 0.5, gain: 0.8, bias: 0.1 }));
  }
  { // ---------- stone ----------
    const { S, T, px, mix, tn, h2, cl, P, ramp, each, r, noisy, spec, pts, vor } = L;
    const STONE = L.STONE = P('66635f', '726f6b', '7e7b77', '8a8783', '96938f', 'a3a09c');
    const MOSS = L.MOSS = P('46622a', '557531', '64873a', '739744', '82a64e');
    const AND = P('6f6d6b', '7f7c79', '8e8b88', '9c9996', 'aaa7a3');
    const bricks = L.bricks = (g, pal, mort, o) => each((x, y) => {
      const row = (y / o.rh) | 0, yy = y % o.rh, sx = x + (row & 1) * o.off, xx = ((sx % o.bw) + o.bw) % o.bw;
      if (yy === o.rh - 1 || xx === o.bw - 1) return px(g, x, y, ramp(mort, r() * 0.99));
      const id = ((sx / o.bw) | 0) % (S / o.bw);
      let t = 0.3 + h2(id, row, o.seed) * (o.var ?? 0.35) + r() * 0.25 + (tn(x, y, o.seed, 4) - 0.5) * 0.15;
      if (yy === 0 || xx === 0) t += 0.2; else if (yy === o.rh - 2 || xx === o.bw - 2) t -= 0.12;
      px(g, x, y, ramp(pal, cl(t)));
    });
    const moss = L.moss = (g, seed, thr) => each((x, y) => {
      const m = tn(x, y, seed, 4) * 0.8 + r() * 0.3 + (y < 6 ? 0.08 : 0);
      if (m > thr) px(g, x, y, ramp(MOSS, cl((m - thr) * 2.5 + r() * 0.3)));
    });
    const cobble = L.cobble = (g, seed, pal = STONE) => { const ps = pts(11); each((x, y) => { const [i, a, b] = vor(x, y, ps);
      let t = 0.3 + ps[i][2] * 0.45 + r() * 0.2; const e = b - a;
      if (e < 1.0) t = 0.02 + r() * 0.1; else if (e < 2.0) t -= 0.18; else if (a < 1.5) t += 0.15;
      px(g, x, y, ramp(pal, cl(t))); }); };
    T('mossy_cobblestone', g => { cobble(g, 22); moss(g, 23, 0.62); });
    T('andesite', g => each((x, y) => { const t = tn(x, y, 24, 8) * 0.5 + r() * 0.5;
      px(g, x, y, t > 0.82 ? [116, 104, 96] : ramp(AND, cl(t * 0.9))); }));
    T('polished_andesite', g => each((x, y) => {
      let t = 0.45 + r() * 0.2 + (tn(x, y, 25, 2) - 0.5) * 0.2;
      if (x === 0 || y === 0) t = 0.95; else if (x === 15 || y === 15) t = 0.1; else if (x === 1 || y === 1) t += 0.15;
      px(g, x, y, ramp(AND, cl(t)));
    }));
    T('deepslate', g => { const DS = P('2f3036', '393a40', '44454b', '4f5056', '5b5c62');
      each((x, y) => px(g, x, y, ramp(DS, cl(tn(x * 0.5, y * 2, 26, 4) * 0.6 + r() * 0.4)))); });
    T('bedrock', g => noisy(g, P('262626', '3c3c3c', '555555', '6f6f6f', '8c8c8c'), { seed: 27, k: 0.5, cells: 8 }));
    T('prismarine', (g, e, s) => { const PR = P('3f7f76', '4c9286', '5aa495', '6ab3a3', '7fc2b0', '9ad2c0');
      each((x, y) => { const t = tn(x, y, 28, 4) * 0.55 + tn(x, y, 29, 8) * 0.25 + r() * 0.2; px(g, x, y, ramp(PR, cl(t * 1.1 - 0.05))); });
      spec(s, 110, 110); });
    T('dark_prismarine', (g, e, s) => {
      bricks(g, P('2c4e44', '345b50', '3d685b', '467566', '508371'), P('1f3730', '24403a'), { rh: 8, bw: 8, off: 0, seed: 30, var: 0.25 });
      spec(s, 100, 130); });
    T('stone_bricks', g => bricks(g, STONE, P('4f4c49', '595653'), { rh: 8, bw: 16, off: 8, seed: 31 }));
    T('mossy_stone_bricks', g => { bricks(g, STONE, P('4f4c49', '595653'), { rh: 8, bw: 16, off: 8, seed: 32 }); moss(g, 33, 0.6); });
    T('bricks', g => bricks(g, P('7f3f31', '8f4a39', '9c5442', 'a95f4b', 'b56b55'), P('8f877d', '9c948a', 'a8a096'), { rh: 4, bw: 8, off: 4, seed: 34, var: 0.4 }));
  }
  { // ---------- sea ----------
    const { S, T, px, tn, h2, cl, P, ramp, each, r, pts, vor } = L;
    const CORAL = L.CORAL = {
      tube: P('1f3d9c', '2a4fb8', '3561cc', '4a78dc', '6a93e8'),
      brain: P('a83f7c', 'c24f92', 'd463a4', 'e27db6', 'ee9cc9'),
      bubble: P('7a1f8c', '9a2aa8', 'b23cbd', 'c556cd', 'd679dc'),
      fire: P('8c1f1f', 'a82a26', 'c23a2e', 'd6503a', 'e66f4c'),
      horn: P('b39a22', 'c9b12c', 'd9c23a', 'e6d150', 'f0df73'),
    };
    const blk = {
      tube: (x, y, ps) => { const [, a] = vor(x, y, ps); return a < 1.1 ? 0.02 : a < 1.8 ? 0.3 : 0.55 + r() * 0.3; },
      brain: (x, y, ps) => { const [, a, b] = vor(x, y, ps); return b - a < 1.3 ? 0.8 + r() * 0.2 : 0.25 + r() * 0.25; },
      bubble: (x, y, ps) => { const [, a] = vor(x, y, ps); return a > 1.6 && a < 2.6 ? 0.85 + r() * 0.15 : a <= 1.6 ? 0.2 + r() * 0.2 : 0.4 + r() * 0.2; },
      fire: (x, y) => cl(tn(x * 2, y * 0.5, 41, 4) * 0.7 + r() * 0.3),
      horn: (x, y, ps) => { const [, a] = vor(x, y, ps); return a < 1 ? 0.95 : cl(0.3 + tn(x, y, 42, 4) * 0.4 + r() * 0.25); },
    };
    const fan = (g, pal, seed) => each((x, y) => { // fan sprite growing from the bottom centre; background stays alpha 0
      const dx = x + 0.5 - 8, dy = 15.5 - y, rr = Math.hypot(dx, dy), ang = Math.atan2(dx, dy);
      if (rr < 3.5) { if (Math.abs(dx) < 1.2) px(g, x, y, pal[1]); return; }
      if (Math.abs(ang) > 1.25 || rr > 12.5 - h2(x, y, seed) * 1.5) return;
      const ri = (ang / 1.25 + 1) * 3.5, rd = Math.abs(ri - Math.round(ri));
      if (rd < 0.2 || (rr > 6 && h2(x, y, seed + 1) > 0.5 && rd < 0.45)) px(g, x, y, ramp(pal, cl(rr / 13 + r() * 0.25)));
    });
    const keys = Object.keys(CORAL);
    keys.forEach(k => T(k + '_coral', g => { const ps = pts(k === 'bubble' ? 6 : 10); each((x, y) => px(g, x, y, ramp(CORAL[k], blk[k](x, y, ps)))); }));
    keys.forEach((k, i) => T(k + '_coral_fan', g => fan(g, CORAL[k], 50 + i * 7)));
    const GREEN = L.GREEN = P('2f5e1f', '3c7326', '4a882e', '5a9b38', '6fae45', '86c055');
    T('seagrass', g => { for (let b = 0; b < 6; b++) {
      const x0 = 1.5 + b * 2.4 + r(), h = 9 + r() * 6.5, ph = r() * 6, amp = 0.6 + r() * 0.9;
      for (let y = 15; y > 15 - h; y--) { const t = (15 - y) / h, x = Math.round(x0 + Math.sin(y * 0.45 + ph) * amp * t);
        px(g, x, y, ramp(GREEN, cl(0.15 + t * 0.75 + r() * 0.15))); }
    } });
    const KELP = P('3d5a1a', '4b6d20', '5a8027', '6a922f', '7da53a');
    const kelp = (g, top) => {
      for (let y = top ? 3 : 0; y < S; y++) { const x = 7 + ((y >> 2) & 1);
        px(g, x, y, ramp(KELP, 0.4 + r() * 0.2)); px(g, x + 1, y, ramp(KELP, 0.15 + r() * 0.15)); }
      for (let k = 0; k < 4; k++) { const yb = 3 + k * 4 + (top ? 1 : 0), dir = k & 1 ? 1 : -1, len = top && k === 0 ? 2 : 4;
        const cx = 7 + ((yb >> 2) & 1) + (dir > 0 ? 1 : 0);
        for (let i = 1; i <= len; i++) for (let w = 0; w < 2; w++) { const y = yb - (i >> 1) + w;
          if (y < S) px(g, cx + dir * i, y, ramp(KELP, cl(0.45 + i * 0.1 - w * 0.2 + r() * 0.15))); }
      }
      if (top) { px(g, 7, 2, KELP[3]); px(g, 8, 1, KELP[4]); }
    };
    T('kelp', g => kelp(g, false));
    T('kelp_top', g => kelp(g, true));
    T('sea_pickle', (g, e) => { const PK = P('3f5a1e', '556f22', '6b8a2c', '86a33a', 'a3bb4f');
      [[3, 9, 6], [7, 6, 9], [11, 10, 5]].forEach(([x0, y0, h]) => {
        for (let y = y0; y < Math.min(S, y0 + h); y++) for (let x = x0; x < x0 + 3; x++)
          px(g, x, y, ramp(PK, cl((x === x0 ? 0.2 : x === x0 + 2 ? 0.45 : 0.7) + r() * 0.2)));
        px(g, x0 + 1, y0 - 1, [214, 226, 140]); px(e, x0 + 1, y0 - 1, [150, 170, 80]);
      }); });
  }
  { // ---------- plants (cross sprites, alpha 0 background) ----------
    const { S, T, px, h2, cl, P, ramp, each, r } = L;
    const pat = L.pat = (g, x0, y0, rows, map) => rows.forEach((row, y) => [...row].forEach((ch, x) => { if (map[ch]) px(g, x0 + x, y0 + y, map[ch]); }));
    const STEM = L.STEM = [[58, 104, 36], [78, 128, 46], [98, 150, 56]];
    const C = { R: [206, 44, 34], r: [150, 24, 22], k: [36, 30, 22], Y: [248, 214, 56], y: [222, 168, 28], W: [242, 244, 238], w: [204, 210, 208],
      B: [118, 200, 242], b: [66, 150, 222], C: [84, 120, 228], c: [52, 82, 190], V: [198, 132, 228], v: [150, 84, 196], N: [246, 164, 198], n: [212, 112, 160] };
    const stalk = (g, x, y0, y1) => { for (let y = y0; y <= y1; y++) px(g, x, y, STEM[y & 1]); };
    const leaf = (g, x, y, dir, n) => { for (let i = 1; i <= n; i++) px(g, x + dir * i, y - ((i - 1) >> 1), STEM[i === n ? 2 : 1]); };
    const flower = (name, rows, heads, lv = 1) => T(name, g => {
      const w = rows[0].length >> 1, hs = heads || [[8 - w, 3]];
      hs.forEach(([hx, hy]) => stalk(g, hx + w, hy + rows.length - 1, 15));
      leaf(g, 7, 12, -1, 3); leaf(g, 8, 10, 1, 2 + lv);
      hs.forEach(([hx, hy]) => pat(g, hx, hy, rows, C));
    });
    flower('poppy', [' rRr ', 'rRRRr', 'RRkRR', 'rRRRr', ' rRr '], [[5, 2]]);
    flower('dandelion', [' YY ', 'YyYY', 'YYyY', ' YY '], [[6, 4]], 0);
    flower('blue_orchid', ['B B B', ' BbB ', 'BbYbB', ' BbB '], [[1, 2], [9, 4]]);
    flower('allium', [' vVv ', 'vVvVv', 'VvVvV', 'vVvVv', ' vVv '], [[5, 1]], 0);
    flower('azure_bluet', [' W ', 'WYW', ' W '], [[2, 6], [6, 3], [11, 5]]);
    flower('cornflower', ['C C C', ' CcC ', 'CcccC', ' cCc '], [[5, 3]]);
    flower('oxeye_daisy', ['  W  ', ' wWw ', 'WWYWW', ' wWw ', '  W  '], [[5, 2]]);
    flower('pink_tulip', ['N N N', 'NnNnN', 'NnnnN', ' nNn '], [[5, 3]]);
    T('lily_of_the_valley', g => {
      for (let y = 9; y < 16; y++) { const w = y < 12 ? y - 9 : 3; for (let i = 1; i <= w; i++) { px(g, 6 - i, y, STEM[0]); px(g, 6 + i, y, STEM[2]); } }
      stalk(g, 6, 5, 15); [[7, 4], [8, 3], [9, 3], [10, 4], [11, 5]].forEach(([x, y]) => px(g, x, y, STEM[1]));
      [[8, 4], [10, 5], [12, 6], [5, 4]].forEach(([x, y]) => { px(g, x, y, C.W); px(g, x, y + 1, C.W); px(g, x - 1, y + 1, C.w); px(g, x + 1, y + 1, C.w); });
    });
    const STRAW = P('6f7f36', '86953f', '9eaa4f', 'b3bc62', 'c9cc7a', 'dcd795');
    T('beach_grass', g => { for (let b = 0; b < 7; b++) {
      const x0 = 1 + b * 2.2 + r(), h = 8 + r() * 7.5, lean = (r() - 0.5) * 6;
      for (let y = 15; y > 15 - h; y--) { const t = (15 - y) / h; px(g, Math.round(x0 + lean * t * t), y, ramp(STRAW, cl(0.1 + t * 0.8 + r() * 0.15))); }
    } });
    T('fern', g => { const FG = P('2e5a20', '3b6e28', '4a8231', '5a963b', '6daa47');
      [-1.0, -0.45, 0.05, 0.5, 1.0].forEach(a => { const len = 9 + r() * 5;
        for (let t = 1; t < len; t++) { const b = a * (1 + t / len * 0.6), x = Math.round(7.5 + Math.sin(b) * t), y = Math.round(15.5 - Math.cos(b) * t);
          px(g, x, y, ramp(FG, cl(0.3 + t / len * 0.4 + r() * 0.2)));
          if (t > 1) { const nx = Math.round(Math.cos(b)), ny = Math.round(Math.sin(b)), o = t % 2 === 0 && t < len - 2 ? 2 : 1;
            px(g, x + nx * o, y + ny * o, ramp(FG, cl(0.55 + r() * 0.3))); px(g, x - nx * o, y - ny * o, ramp(FG, cl(0.2 + r() * 0.3)));
            if (o === 2) { px(g, x + nx, y + ny, ramp(FG, cl(0.45 + r() * 0.2))); px(g, x - nx, y - ny, ramp(FG, cl(0.25 + r() * 0.2))); } }
        } }); });
    T('dead_bush', g => { const DB = P('6b4524', '835630', '9c6a3d', 'b07e4c');
      const br = (x, y, a, n, d) => { for (let i = 0; i < n; i++) { x += Math.sin(a); y -= Math.cos(a);
        px(g, Math.round(x), Math.round(y), ramp(DB, cl(0.2 + r() * 0.6)));
        if (d < 3 && i > 1 && r() < 0.3) br(x, y, a + (r() < 0.5 ? -0.7 : 0.7), n - i - 1, d + 1);
        a += (r() - 0.5) * 0.5; } };
      [-0.6, 0, 0.55].forEach(a => br(7.5, 15.5, a, 10 + ((r() * 3) | 0), 0)); });
    T('sugar_cane', g => { const SC = P('5d8a3a', '76a248', '8fb85a', 'a8cc6e', 'c2dd8a');
      [2, 7, 12].forEach((x0, k) => {
        for (let y = 0; y < S; y++) { const j = (y + k * 2) % 6 === 0; px(g, x0, y, j ? SC[4] : SC[2]); px(g, x0 + 1, y, j ? SC[3] : SC[1]); }
        const ly = 3 + k * 4; px(g, x0 + 2, ly, SC[2]); px(g, x0 + 3, ly - 1, SC[3]);
      }); });
    T('vine', g => { const VG = P('2d5a1c', '3a6e24', '48822d', '579637');
      for (let k = 0; k < 4; k++) { let x = 1 + k * 4 + ((r() * 2) | 0);
        for (let y = 0; y < S; y++) { px(g, x, y, ramp(VG, cl(0.2 + r() * 0.4)));
          if (r() < 0.35) { const d = r() < 0.5 ? -1 : 1; px(g, x + d, y, ramp(VG, cl(0.5 + r() * 0.5))); if (r() < 0.5) px(g, x + d, y - 1, VG[3]); }
          if (r() < 0.25) x = (x + (r() < 0.5 ? -1 : 1) + S) % S; } } });
    T('lily_pad', g => { const LP = P('1f5a1f', '2a6e26', '36822e', '449638', '55a944');
      each((x, y) => { const dx = x + 0.5 - 8, dy = y + 0.5 - 8, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        if (d > 7.4 - h2(x, y, 61) * 0.8 || (Math.abs(a + 1.3) < 0.28 && d > 1)) return;
        const vein = Math.abs(Math.sin(a * 3.5)) < 0.18 && d > 2;
        px(g, x, y, ramp(LP, cl((vein ? 0.85 : 0.35) + r() * 0.25 - (d > 6.2 ? 0.25 : 0)))); }); });
  }
  { // ---------- logs + leaves ----------
    const { S, T, px, tn, h2, cl, P, ramp, each, r } = L;
    const OAKB = L.OAKB = P('3e2d1a', '4c3720', '5a4228', '684d30', '765838');
    const OAKW = L.OAKW = P('8a6438', '9c7242', 'ad814c', 'bd9058', 'cc9f66');
    const BIR = P('c9c4ba', 'd8d4cb', 'e6e3db', 'f2f0e9');
    const JUNB = P('4a3a1c', '5a4823', '6b562b', '7c6434', '8c723e');
    const SOAK = L.SOAK = P('a37b48', 'b58a53', 'c49960', 'd1a76d', 'dcb47c');
    const bark = (g, pal, seed, fz = 0.3) => each((x, y) => { // vertical fissure dashes, seamless in y
      const off = (h2(x, 1, seed) * S) | 0, seg = (((y + off) % S) / 4) | 0;
      let t = 0.3 + h2(x, 0, seed) * 0.4 + r() * 0.2;
      if (h2(x, seg, seed + 1) < fz) t -= 0.35; else if (h2(x, seg, seed + 2) < 0.15) t += 0.25;
      px(g, x, y, ramp(pal, cl(t)));
    });
    const top = (g, wood, rim, seed) => each((x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return px(g, x, y, ramp(rim, cl(0.2 + r() * 0.6)));
      const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5), d = Math.max(dx, dy) * 0.6 + Math.hypot(dx, dy) * 0.4 + (h2(x, y, seed) - 0.5) * 0.5;
      const ring = Math.floor(d * 0.75) & 1;
      px(g, x, y, ramp(wood, cl(0.5 + (ring ? -0.28 : 0.12) + r() * 0.15 - (d < 1.2 ? 0.15 : 0))));
    });
    T('oak_log', g => bark(g, OAKB, 70));
    T('oak_log_top', g => top(g, OAKW, OAKB, 71));
    T('birch_log', g => { each((x, y) => px(g, x, y, ramp(BIR, cl(0.45 + r() * 0.35 + (h2(x, 0, 72) - 0.5) * 0.3))));
      for (let k = 0; k < 8; k++) { const y = (r() * S) | 0, x0 = (r() * S) | 0, w = 2 + ((r() * 4) | 0);
        for (let i = 0; i < w; i++) { px(g, (x0 + i) % S, y, [46, 42, 38]);
          if (i > 0 && i < w - 1 && r() < 0.5) px(g, (x0 + i) % S, (y + 1) % S, [92, 86, 78]); } } });
    T('birch_log_top', g => top(g, P('b39a6a', 'c2a979', 'cfb788', 'dbc497'), BIR, 73));
    T('jungle_log', g => bark(g, JUNB, 74, 0.25));
    T('jungle_log_top', g => top(g, P('a06e40', 'af7c4b', 'bd8a57', 'c99863'), JUNB, 75));
    T('stripped_oak_log', g => bark(g, SOAK, 76, 0.12));
    T('stripped_oak_log_top', g => top(g, SOAK, P('8f6a3c', '9c7444', 'a77d4b'), 77));
    const leaves = (g, pal, seed, hole = 0.3) => {
      const m = []; each((x, y) => { m[y * S + x] = tn(x, y, seed, 8) * 0.45 + h2(x, y, seed + 1) * 0.55 < hole; });
      const H = (x, y) => m[((y + S) % S) * S + ((x + S) % S)];
      each((x, y) => { if (H(x, y)) return; // holes stay alpha 0 (cutout)
        let t = 0.42 + r() * 0.3;
        if (H(x, y - 1) || H(x - 1, y)) t += 0.25; if (H(x, y + 1) || H(x + 1, y)) t -= 0.3;
        px(g, x, y, ramp(pal, cl(t))); });
    };
    const AZ = P('3e6020', '4c7428', '5c8a30', '6c9c3a', '7eae46');
    T('oak_leaves', g => leaves(g, P('3f6a1e', '4f7f24', '62932c', '76a536', '8ab642', '9fc552'), 80));
    T('birch_leaves', g => leaves(g, P('5a7a2a', '6c8e32', '80a23c', '94b448', 'a8c456'), 81));
    T('jungle_leaves', g => leaves(g, P('2a5e14', '35721a', '428722', '519a2b', '62ad36'), 82, 0.26));
    T('azalea_leaves', g => leaves(g, AZ, 83, 0.28));
    T('flowering_azalea_leaves', g => { leaves(g, AZ, 84, 0.28);
      for (let k = 0; k < 6; k++) { const x = (r() * S) | 0, y = (r() * S) | 0;
        [[0, 0, 0], [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]].forEach(([dx, dy, o]) =>
          px(g, (x + dx + S) % S, (y + dy + S) % S, o ? [196, 92, 170] : [240, 166, 216])); } });
  }
  { // ---------- building A: planks, whites, glass, doors ----------
    const { S, T, px, tn, h2, cl, P, ramp, each, r, noisy, spec, bricks } = L;
    const OAKP = L.OAKP = P('6b4a26', '86602f', '9a6e38', 'ab7d42', 'bb8b4d', 'c99a5a');
    const SPRP = L.SPRP = P('4a3320', '5a3f27', '68492d', '765434', '845f3c');
    const BIRP = P('a8915e', 'bba46d', 'c8b27a', 'd4bf88', 'dfcb96');
    const planks = L.planks = (g, pal, seed) => each((x, y) => {
      const row = y >> 2, yy = y & 3, sx = (x + row * 5 + ((h2(row, 0, seed) * 3) | 0)) % S;
      let t = 0.38 + h2(row, sx >> 3, seed + 1) * 0.3 + r() * 0.18 + (tn(x * 2, y, seed, 4) - 0.5) * 0.15;
      if (yy === 3) t = 0.04 + r() * 0.08; else if (yy === 0) t += 0.14;
      if (sx === 0 && yy !== 3) t = 0.12;
      px(g, x, y, ramp(pal, cl(t)));
    });
    T('oak_planks', g => planks(g, OAKP, 90));
    T('spruce_planks', g => planks(g, SPRP, 91));
    T('birch_planks', g => planks(g, BIRP, 92));
    T('white_plaster', g => noisy(g, P('cbbfa9', 'd6cbb7', 'dfd5c3', 'e7decf', 'eee7db'), { seed: 93, k: 0.35, gain: 0.9, bias: 0.05 }));
    T('calcite', g => each((x, y) => { const t = tn(x, y, 94, 4) * 0.5 + r() * 0.5;
      px(g, x, y, t > 0.84 ? [190, 194, 196] : ramp(P('c9cbc8', 'd6d8d4', 'e0e2de', 'e9eae6'), cl(t))); }));
    const QZ = L.QZ = P('c4bcaf', 'd1cabe', 'dcd6cb', 'e6e1d8', 'eeebe4');
    T('quartz_block', (g, e, s) => { each((x, y) => { let t = 0.55 + r() * 0.15 + (tn(x, y, 95, 2) - 0.5) * 0.15;
      if (x === 0 || y === 0) t += 0.3; else if (x === 15 || y === 15) t = 0.1; px(g, x, y, ramp(QZ, cl(t))); }); spec(s, 90, 120); });
    T('quartz_bricks', (g, e, s) => { bricks(g, QZ, P('b7b0a5', 'c2bbb0'), { rh: 8, bw: 8, off: 4, seed: 96, var: 0.15 }); spec(s, 80, 130); });
    T('terracotta_white', g => noisy(g, P('b39a86', 'bea592', 'c8b09d', 'd1baa8'), { seed: 97, k: 0.45, gain: 0.8, bias: 0.1 }));
    const FR = [[214, 228, 232], [178, 198, 204]];
    T('glass_pane_top', (g, e, s) => { each((x, y) => { if (x < 7 || x > 8) return;
      px(g, x, y, x === 7 ? FR[0] : FR[1], y === 0 || y === 15 ? 255 : 200); }); spec(s, 200, 30); });
    const door = (g, upper) => { planks(g, OAKP, upper ? 98 : 99);
      each((x, y) => { const fr = x < 2 || x > 13 || (upper ? y < 2 : y > 13);
        if (fr) px(g, x, y, ramp(OAKP, cl((x === 0 || y === 0 ? 0.6 : 0.3) + r() * 0.15))); });
      if (upper) each((x, y) => { // 2×2 window, panes cut out (alpha 0) with a glint
        if (x < 3 || x > 12 || y < 3 || y > 12 || x === 7 || x === 8 || y === 7 || y === 8) return;
        px(g, x, y, [0, 0, 0], 0); if ((x === 4 || x === 10) && (y === 4 || y === 10)) px(g, x, y, [230, 240, 244], 140); });
      else { each((x, y) => { if (x > 3 && x < 12 && y > 1 && y < 12 && (x === 4 || x === 11 || y === 2 || y === 11)) px(g, x, y, OAKP[1]); });
        px(g, 12, 1, [44, 40, 38]); px(g, 12, 2, [70, 64, 60]); px(g, 13, 1, [44, 40, 38]); }
    };
    T('oak_door_top', g => door(g, true));
    T('oak_door_bottom', g => door(g, false));
  }
  { // ---------- building B: trapdoor, shelves, barrel, hay, pot, snow ----------
    const { S, T, px, tn, h2, cl, P, ramp, each, r, noisy, planks, OAKP, SPRP } = L;
    const IRON = [[52, 50, 50], [74, 72, 70], [98, 96, 92]];
    T('oak_trapdoor', g => { planks(g, OAKP, 100);
      each((x, y) => { const fr = x < 2 || y < 2 || x > 13 || y > 13 || x === 7 || x === 8 || y === 7 || y === 8;
        if (!fr) px(g, x, y, [0, 0, 0], 0); else if (x === 0 || y === 0) px(g, x, y, OAKP[4]); else if (x === 15 || y === 15) px(g, x, y, OAKP[1]); }); });
    T('bookshelf', g => { planks(g, OAKP, 101);
      const BK = [[150, 46, 38], [52, 84, 140], [62, 112, 58], [166, 120, 54], [112, 64, 120], [190, 168, 120], [96, 60, 36]];
      [[2, 6], [9, 13]].forEach(([y0, y1]) => { let x = 1;
        while (x < 15) { const w = 1 + (r() < 0.35 ? 1 : 0), c = BK[(r() * BK.length) | 0], h = (r() * 2) | 0;
          for (let i = 0; i < w && x < 15; i++, x++) for (let y = y0 + h; y <= y1; y++)
            px(g, x, y, y === y0 + h ? c.map(v => Math.min(255, v + 40)) : i === w - 1 && w > 1 ? c.map(v => v * 0.75) : c);
          if (r() < 0.2 && x < 15) { for (let y = y0; y <= y1; y++) px(g, x, y, [40, 28, 18]); x++; } }
      }); });
    T('barrel_top', g => { planks(g, SPRP, 102);
      each((x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (d > 6.9) px(g, x, y, IRON[x === 0 || y === 0 ? 2 : 1]); else if (d > 5.9) px(g, x, y, IRON[0]);
        else if (d < 1.1) px(g, x, y, d < 0.6 ? [30, 22, 16] : SPRP[0]); }); });
    T('barrel_side', g => each((x, y) => {
      const st = x >> 2, xx = x & 3; let t = 0.35 + h2(st, 0, 103) * 0.3 + r() * 0.18 + (tn(x, y * 2, 104, 4) - 0.5) * 0.15;
      if (xx === 3) t = 0.05; else if (xx === 0) t += 0.15;
      if (y === 2 || y === 3 || y === 12 || y === 13) return px(g, x, y, IRON[y === 2 || y === 12 ? 2 : 0]);
      px(g, x, y, ramp(SPRP, cl(t)));
    }));
    const HAY = P('9a7a1e', 'b08e24', 'c4a12e', 'd4b23a', 'e2c34c', 'ecd263');
    const BAND = [[112, 70, 30], [138, 90, 40]];
    T('hay_top', g => each((x, y) => { const d = Math.hypot(x - 7.5, y - 7.5);
      let t = 0.35 + tn(x, y, 105, 8) * 0.35 + r() * 0.25; if (Math.abs(d - 5) < 0.6) return px(g, x, y, BAND[(r() * 2) | 0]);
      if (x === 0 || y === 0 || x === 15 || y === 15) t -= 0.25; px(g, x, y, ramp(HAY, cl(t))); }));
    T('hay_side', g => each((x, y) => {
      if (y === 3 || y === 4 || y === 11 || y === 12) return px(g, x, y, BAND[y === 3 || y === 11 ? 1 : 0]);
      px(g, x, y, ramp(HAY, cl(0.3 + h2(x, (y + ((h2(x, 9, 106) * 8) | 0)) >> 2, 106) * 0.45 + r() * 0.2)));
    }));
    T('flower_pot', g => { const TC = P('7c3e26', '96502f', 'ab5f38', 'bd6e43');
      for (let y = 9; y < 16; y++) { const w = y === 9 ? 4 : 3;
        for (let x = 8 - w; x < 8 + w; x++) {
          const t = y === 9 ? 0.85 : x === 8 - w ? 0.6 : x === 7 + w ? 0.05 : 0.35 + r() * 0.2; px(g, x, y, ramp(TC, cl(t))); } }
      for (let x = 5; x < 11; x++) px(g, x, 10, x === 5 || x === 10 ? TC[1] : [58, 40, 26]); });
    T('snow', g => noisy(g, P('d5dde6', 'e0e6ee', 'eaeef4', 'f3f6f9', 'fbfcfd'), { seed: 107, k: 0.4, gain: 0.9, bias: 0.1 }));
  }
  { // ---------- wool + emissive ----------
    const { S, T, px, mix, tn, h2, cl, P, ramp, each, r, noisy, pts, vor } = L;
    const WOOL = { white: [222, 224, 220], light_blue: [96, 182, 222], blue: [58, 66, 162], cyan: [30, 140, 150], yellow: [246, 200, 52],
      pink: [238, 148, 178], red: [164, 44, 38], lime: [118, 186, 34], gray: [70, 76, 80], brown: [116, 74, 44] };
    Object.keys(WOOL).forEach((k, i) => T('wool_' + k, g => { const b = WOOL[k], lo = b.map(v => v * 0.78), hi = b.map(v => Math.min(255, v * 1.08 + 6));
      each((x, y) => { const w = Math.sin((x * 2 + y) * Math.PI / 4) * 0.5 + Math.sin((y * 2 - x) * Math.PI / 8) * 0.3;
        px(g, x, y, mix(lo, hi, 0.5 + w * 0.22 + (tn(x, y, 110 + i, 4) - 0.5) * 0.3 + (r() - 0.5) * 0.3)); }); }));
    const glow = (g, e, x, y, c, k = 1) => { px(g, x, y, c); px(e, x, y, c.map(v => v * k)); };
    const IR = [[38, 36, 40], [58, 56, 62], [84, 82, 88]];
    T('lantern', (g, e) => { // sprite: handle, cap, glowing body, base; background alpha 0
      [[7, 1], [8, 1], [6, 2], [9, 2]].forEach(([x, y]) => px(g, x, y, IR[1]));
      for (let x = 5; x <= 10; x++) px(g, x, 4, IR[0]);
      for (let x = 4; x <= 11; x++) { px(g, x, 5, IR[2]); px(g, x, 14, IR[1]); }
      for (let x = 5; x <= 10; x++) px(g, x, 15, IR[0]);
      for (let y = 6; y <= 13; y++) for (let x = 5; x <= 10; x++) {
        if (x === 5 || x === 10) { px(g, x, y, IR[x === 5 ? 2 : 0]); continue; }
        const c = Math.abs(x - 7.5) < 1 && y > 7 && y < 12; glow(g, e, x, y, c ? [255, 244, 196] : y < 8 ? [240, 150, 58] : [255, 196, 92]);
      } });
    T('paper_lantern', (g, e) => each((x, y) => {
      if (y < 2 || y > 13 || x === 0 || x === 15) return px(g, x, y, y === 0 || y === 14 ? [104, 66, 38] : [72, 44, 28]);
      const s = 1 - Math.abs(x - 7.5) / 8, rib = y % 3 === 0, c = mix([226, 150, 82], [255, 222, 150], s * 0.9 - (rib ? 0.35 : 0) + (r() - 0.5) * 0.1);
      glow(g, e, x, y, c, 0.9);
    }));
    T('glowstone', (g, e) => { const ps = pts(14), GL = P('9c6428', 'c48838', 'e0aa50', 'f2ca6e', 'fbe496');
      each((x, y) => { const [i, a, b] = vor(x, y, ps);
        if (b - a < 0.55) return glow(g, e, x, y, [150, 98, 44], 0.35);
        const t = cl(ps[i][2] * 0.7 + r() * 0.2 + (a < 1.2 ? 0.15 : 0)); glow(g, e, x, y, ramp(GL, t), 0.5 + t * 0.5); }); });
    T('sea_lantern', (g, e) => each((x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || x === 8 || y === 7 || y === 8)
        return glow(g, e, x, y, (x + y) & 1 ? [150, 184, 174] : [172, 202, 192], 0.35);
      const bx = x < 8 ? x - 1 : x - 9, by = y < 8 ? y - 1 : y - 9, d = Math.max(Math.abs(bx - 2.5), Math.abs(by - 2.5));
      glow(g, e, x, y, d < 1.5 ? [240, 250, 244] : d < 2.5 ? [206, 232, 222] : [184, 214, 204], d < 1.5 ? 1 : 0.7);
    }));
    T('shroomlight', (g, e) => { const ps = pts(7), SH = P('c4502a', 'd86432', 'e87c3c', 'f29448', 'f8ac58');
      each((x, y) => { const [, a] = vor(x, y, ps); const c = a < 1.3 ? [252, 214, 130] : ramp(SH, cl(tn(x, y, 120, 4) * 0.6 + r() * 0.4));
        glow(g, e, x, y, c, 0.85); }); });
    T('lamp_on', (g, e) => each((x, y) => {
      if (x < 2 || y < 2 || x > 13 || y > 13) return px(g, x, y, x === 0 || y === 0 ? [122, 80, 44] : (x + y) & 1 ? [84, 52, 28] : [98, 62, 34]);
      if (x === 7 || x === 8 || y === 7 || y === 8) return glow(g, e, x, y, [196, 126, 52], 0.5);
      const bx = x < 8 ? x - 2 : x - 9, by = y < 8 ? y - 2 : y - 9, c = bx > 0 && bx < 4 && by > 0 && by < 4;
      glow(g, e, x, y, c ? [255, 238, 172] : [250, 202, 108]);
    }));
  }
  { // ---------- v3 新贴图（SPEC-3 §6 配色；16 px = 0.5 m，一格 0.25 m = 8 px）----------
    const { pts, vor, planks, moss, cobble } = L, N = (n, f, o) => reg(n, f, false, o);
    // 白灰泥：细噪声 + 稀疏斑点 + 若隐若现的灰缝（错缝砌块 16×8 px）
    const PL = P('dcd3c3', 'e4dccd', 'eae3d5', 'efe8da', 'f3eee3'), MORT = hex('d8cfbf');
    const plaster = (g, seed) => each((x, y) => {
      const t = 0.5 + (tn(x, y, seed, 4) - 0.5) * 0.5 + (r() - 0.5) * 0.35, sp = h2(x, y, seed + 1);
      let c = ramp(PL, cl(t));
      if (sp > 0.965) c = mix(c, [176, 166, 150], 0.45); else if (sp < 0.02) c = mix(c, [255, 252, 246], 0.6);
      const seam = (y & 7) === 7 || x === (y < 8 ? 15 : 7);
      if (seam && h2(x >> 1, y, seed + 2) > 0.3) c = mix(c, MORT, 0.3 + r() * 0.25);
      px(g, x, y, c); });
    N('plaster', g => plaster(g, 100));
    N('plasterTrim', g => each((x, y) => { const yy = y & 7; // 每 8 px 一道倒角：单排 0.25 m 也是完整线脚
      let t = 0.45 + (tn(x, y, 101, 4) - 0.5) * 0.3 + (r() - 0.5) * 0.2;
      if (yy === 0) t += 0.35; else if (yy === 1) t += 0.15; else if (yy === 7) t -= 0.35; else if (yy === 6) t -= 0.12;
      px(g, x, y, ramp(P('cfc5b3', 'd9d0bf', 'e2dacb', 'e9e2d4', 'f1ebdf'), cl(t))); }));
    // 深色木柱：竖纹（按列的纹理 + 竖向拉长的节疤）
    const TB = P('3f2a1a', '4f3522', '5c3e28', '6b4a2f', '78553a', '866244');
    N('timber', g => { const col = x => h2(x, 0, 102) * 0.6 + h2((x + 1) & 15, 0, 102) * 0.2 + h2((x + 15) & 15, 0, 102) * 0.2;
      each((x, y) => { let t = 0.25 + col(x) * 0.5 + (tn(x, y, 103, 2) - 0.5) * 0.3 + (r() - 0.5) * 0.12;
        if (h2(x, 1, 104) > 0.72 && tn(x, y, 104, 4) > 0.32) t -= 0.2; // 断续的深色竖纹
        px(g, x, y, ramp(TB, cl(t))); }); });
    N('timberEnd', g => each((x, y) => { const dx = (x & 7) - 3.5, dy = (y & 7) - 3.5, d = Math.sqrt(dx * dx + dy * dy); // 年轮，每格一套
      let t = 0.55 + Math.sin(d * 2.2) * 0.15 + (r() - 0.5) * 0.15; if (d > 3.6) t = 0.15 + r() * 0.1;
      px(g, x, y, ramp(TB, cl(t))); }));
    N('planks', g => planks(g, P('9a6a3c', 'ad7a47', 'bb8650', 'c89058', 'd29c66', 'dcaa76'), 105));    // 门廊浅木
    N('floorWood', g => planks(g, P('6e4524', '7f5130', '8e5d39', '9a6a40', 'a6774b', 'b38558'), 106)); // 室内暖色地板
    // 屋顶横向木板：4 px 一排，下沿压影，8 px 一段接缝
    const boards = (g, pal, seed) => each((x, y) => { const row = y >> 2, yy = y & 3, sx = (x + ((h2(row, 1, seed) * 16) | 0)) & 15;
      let t = 0.45 + (h2(row, sx >> 3, seed) - 0.5) * 0.35 + (tn(x * 2, y, seed, 4) - 0.5) * 0.2 + (r() - 0.5) * 0.12;
      if (yy === 3) t = 0.04 + r() * 0.06; else if (yy === 0) t += 0.18;
      if ((sx & 7) === 0 && yy < 3) t -= 0.3;
      px(g, x, y, ramp(pal, cl(t))); });
    N('roofA', g => boards(g, P('6f3f1d', '854d26', '97592e', 'a8683a', 'b77646', 'c48553'), 107));
    N('roofB', g => boards(g, P('5a3418', '6c3f1f', '7b4826', '8a5530', '99613b', 'a66d46'), 108));
    N('roofEdge', g => each((x, y) => { const yy = y & 7;
      let t = 0.5 + (tn(x * 2, y, 109, 4) - 0.5) * 0.3 + (r() - 0.5) * 0.12;
      if (yy === 0) t += 0.3; else if (yy === 7) t = 0.06; else if (yy === 6) t -= 0.15;
      px(g, x, y, ramp(P('4a2c16', '5c3820', '6e4429', '7f5133', '8f5e3d'), cl(t))); }));
    N('windowFrame', g => each((x, y) => { const xx = x & 7, yy = y & 7; // 白漆木框，每格一圈浅倒角
      let t = 0.62 + (r() - 0.5) * 0.12 + (tn(x, y, 110, 2) - 0.5) * 0.1;
      if (xx === 0 || yy === 0) t += 0.25; else if (xx === 7 || yy === 7) t -= 0.28;
      px(g, x, y, ramp(P('d9d4cb', 'e6e2da', 'eeebe4', 'f6f3ee', 'fbf9f5'), cl(t))); }));
    N('glass', g => each((x, y) => { const s = (x + y) & 15, st = s === 3 || s === 4 || s === 11; // 无边框，斜向反光
      px(g, x, y, st ? [234, 246, 251] : [191, 227, 242], st ? 140 : 90); }));
    // 沙：细颗粒 + 稀疏深/亮颗粒；o.f(x,y) 叠加图案
    const grainy = (g, pal, seed, o = {}) => each((x, y) => {
      let t = 0.5 + (tn(x, y, seed, 4) - 0.5) * (o.n ?? 0.45) + (r() - 0.5) * (o.g ?? 0.5);
      const sp = h2(x, y, seed + 7); if (sp > 0.97) t -= 0.35; else if (sp < 0.025) t += 0.3;
      if (o.f) t += o.f(x, y);
      px(g, x, y, ramp(pal, cl(t))); });
    const SD = P('cdb57f', 'dbc391', 'e3cc9b', 'ead5a3', 'f0ddb0', 'f5e6c0');
    N('sand', g => grainy(g, SD, 111));
    N('sandRipple', g => grainy(g, SD, 112, { f: (x, y) => { // 沙纹：每 8 px 一道，横向正弦起伏（16 px 周期）
      const w = (y + Math.round(Math.sin(x / 16 * Math.PI * 2) * 1.5) + 16) & 7; return w === 0 ? 0.28 : w === 1 ? -0.22 : 0; } }));
    N('sandWet', g => grainy(g, P('a68a5a', 'b49866', 'bfa370', 'c9ab78', 'd2b585', 'dcc194'), 113, { n: 0.35, g: 0.3 }));
    N('sandDark', g => grainy(g, P('8f7650', '9c825a', 'a88d64', 'b2976d', 'bca279'), 114, { n: 0.4, g: 0.35 }));
    // 岛侧分层：沙 / 砂岩 / 石头（横向层理，可上下拼接）
    N('strata1', g => grainy(g, P('b39a68', 'c2a875', 'cdb381', 'd6bd8c', 'dfc898'), 115, { n: 0.3, g: 0.35, f: (x, y) => {
      const b = (y + ((h2(x >> 2, 0, 115) * 2) | 0)) & 7; return b === 0 ? -0.3 : (tn(x, y * 2, 116, 4) - 0.5) * 0.4; } }));
    N('strata2', g => grainy(g, P('9e7448', 'ae8254', 'bc8f5f', 'c89c6b', 'd3a977'), 117, { n: 0.25, g: 0.3, f: (x, y) => { // 暖橙砂岩，和 strata1 拉开
      if (y === 4 || y === 11 || (y === 12 && h2(x, 2, 117) > 0.6)) return -0.35;
      if (y === 5 || y === 0) return 0.15; return h2(x, y >> 2, 118) > 0.94 ? -0.3 : (tn(x, y * 2, 119, 4) - 0.5) * 0.35; } }));
    const ST = P('77736b', '858179', '918c84', '9c978e', 'a8a39a', 'b4afa6');
    const rock = (g, seed, o = {}) => { const ps = pts(o.n ?? 7); each((x, y) => { const [i, a, b] = vor(x, y, ps);
      let t = 0.5 + (ps[i][2] - 0.5) * 0.3 + (tn(x, y, seed, 4) - 0.5) * 0.35 + (r() - 0.5) * 0.25;
      if (b - a < 0.8) t -= 0.4; else if (b - a < 1.6) t -= 0.12;
      if (o.f) t += o.f(x, y);
      px(g, x, y, ramp(o.pal || ST, cl(t))); }); };
    N('strata3', g => rock(g, 120, { n: 5, f: (x, y) => ((y === 5 || y === 13) && h2(x >> 1, y, 121) > 0.3 ? -0.35 : 0) }));
    N('stone', g => rock(g, 122));
    N('stoneMoss', g => { rock(g, 123); moss(g, 124, 0.62); });
    N('cobble', g => cobble(g, 125, ST));
    N('seabed', g => { grainy(g, P('7d7a68', '8a8672', '96917b', 'a19c85', 'aca78f'), 126, { n: 0.5, g: 0.4 });
      each((x, y) => { const k = h2(x, y, 127); if (k > 0.985) px(g, x, y, [96, 118, 82]); else if (k < 0.012) px(g, x, y, [196, 190, 170]); }); });
    N('coralSand', g => { grainy(g, P('d9c3a6', 'e3cfb4', 'ebd9c0', 'f1e2cc', 'f6ead8'), 128, { n: 0.35, g: 0.45 });
      each((x, y) => { const k = h2(x, y, 129); if (k > 0.975) px(g, x, y, [232, 160, 150]); else if (k > 0.95) px(g, x, y, [250, 246, 238]); }); });
    Object.assign(L, { grainy, boards, rock, plaster });
  }
  // @@NEXT@@
})(window.V3);
