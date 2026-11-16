/* 09-cuboid.js — 长方体模型引擎，移植自 v1 的 05-model.js：cuboid 定义 → 每根骨骼一组合并网格 + 像素画贴图图集 + 动画片段播放器。
   V3.cuboid = { build, clone, player, clips, paint, tex, color, ease, matOf, setEi }。单位：模型 px（16 px = 1 m）× opts.scale，
   几何和骨骼位置存成米。v1 小鲸鱼（20-girlv1*.js）和以后的 YSM 导入共用这一套。
   v3 改动：
   - 材质换成 MeshStandardMaterial（吃场景的日光、灯光、阴影），不再依赖 v1 的 K.mat.lit；
   - 骨骼静止姿势放在 userData.cub = { p, r, s }；userData.rest 是静止位置 Vector3（65-girl-actor 读 hips.userData.rest.y）；
   - player.play(name, { weight }) / setWeight(layer, w)：这一层按固定权重叠在下面的层上（姿势按 poseK 过渡用）。 */
(function (V3) {
  'use strict';
  var M = V3.cuboid = V3.cuboid || {};
  var DEG = Math.PI / 180;
  M.clips = M.clips || {};
  M.paint = M.paint || {};

  function err(where, e) {
    var s = where + ': ' + ((e && (e.stack || e.message)) || e);
    if (V3.err) V3.err(s); else if (typeof console !== 'undefined') console.error(s);
  }

  // ---- colour + hash utils ------------------------------------------------------------------------------
  // col(c) → [r, g, b, a] (r,g,b 0..255, a 0..1); c = 0xrrggbb | '#rgb[a]' | '#rrggbb[aa]' | 'rgb[a](…)' | [r,g,b,a?]
  var colCache = {};
  function col(c) {
    if (Array.isArray(c)) return [c[0], c[1], c[2], c[3] == null ? 1 : c[3]];
    var key = typeof c + ':' + c, v = colCache[key];
    if (v) return v;
    if (typeof c === 'number') v = [(c >> 16) & 255, (c >> 8) & 255, c & 255, 1];
    else if (typeof c === 'string' && c[0] === '#') {
      var s = c.slice(1);
      if (s.length === 3 || s.length === 4) s = s.replace(/./g, '$&$&');
      var n = parseInt(s.slice(0, 6), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, s.length >= 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1];
    } else if (typeof c === 'string' && /^rgba?\(/.test(c)) {
      var p = c.replace(/[^\d.,]/g, '').split(',').map(Number);
      v = [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    } else { err('model.color', new Error('bad colour ' + c)); v = [255, 0, 255, 1]; }
    return (colCache[key] = v);
  }
  function cl(v) { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; }
  // css(c, k, a): canvas fillStyle of colour c with brightness × k and optional alpha override
  function css(c, k, a) {
    c = col(c); if (k == null) k = 1;
    return 'rgba(' + cl(c[0] * k) + ',' + cl(c[1] * k) + ',' + cl(c[2] * k) + ',' + (a == null ? c[3] : a) + ')';
  }
  // hash(x, y, s) → deterministic [0, 1)
  function hash(x, y, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  M.color = col;
  M._css = css;
  M._hash = hash;

  // canvas factory (node tests replace it with a stub)
  M._canvas = function (w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  // ---- V3.cuboid.paint: pixel-art helpers ------------------------------------------------------------------
  // Region helpers draw into (x, y, w, h) texels of a 2D context.  Factories (wood, plaid, stripes, dots)
  // return a memoised paint fn(g, w, h, face) — equal arguments give the same fn, so faces still dedupe.
  var P = M.paint;
  // MC-like face shading (top brightest, bottom darkest), used by paint objects with shade: true
  var SHADE = { py: 1, pz: 0.92, nz: 0.92, px: 0.87, nx: 0.87, ny: 0.76 };
  P.SHADE = SHADE;
  P.rect = function (g, x, y, w, h, c, k) { g.fillStyle = css(c, k); g.fillRect(x, y, w, h); };
  P.px = function (g, x, y, c, k) { g.fillStyle = css(c, k); g.fillRect(x, y, 1, 1); };
  // noise: base colour with deterministic per-texel brightness jitter (± amount); cell = texels per noise cell
  P.noise = function (g, x, y, w, h, base, amount, seed, cell) {
    if (amount == null) amount = 0.06;
    seed = seed == null ? 1 : seed | 0; cell = cell > 1 ? cell | 0 : 1;
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      g.fillStyle = css(base, 1 + (hash((i / cell) | 0, (j / cell) | 0, seed) * 2 - 1) * amount);
      g.fillRect(x + i, y + j, 1, 1);
    }
  };
  // gradient: c0 → c1, dir 'v' (top → bottom, default) or 'h' (left → right); steps > 1 posterises into bands
  P.gradient = function (g, x, y, w, h, c0, c1, dir, steps) {
    var a = col(c0), b = col(c1), hor = dir === 'h' || dir === 'x', n = hor ? w : h;
    for (var k = 0; k < n; k++) {
      var t = n > 1 ? k / (n - 1) : 0;
      if (steps > 1) t = Math.round(t * (steps - 1)) / (steps - 1);
      g.fillStyle = 'rgba(' + cl(a[0] + (b[0] - a[0]) * t) + ',' + cl(a[1] + (b[1] - a[1]) * t) + ',' +
        cl(a[2] + (b[2] - a[2]) * t) + ',' + (a[3] + (b[3] - a[3]) * t) + ')';
      if (hor) g.fillRect(x + k, y, 1, h); else g.fillRect(x, y + k, w, 1);
    }
  };
  // border: outline of thickness t (default 1 texel)
  P.border = function (g, x, y, w, h, c, t) {
    t = t || 1; g.fillStyle = css(c);
    g.fillRect(x, y, w, t); g.fillRect(x, y + h - t, w, t);
    g.fillRect(x, y, t, h); g.fillRect(x + w - t, y, t, h);
  };

  var facCache = {};
  function factory(name, args, make) {
    var key = name + JSON.stringify(args);
    var f = facCache[key];
    if (!f) { f = facCache[key] = make.apply(null, args); f.paintKey = key; }
    return f;
  }
  // face image axes: which model axis runs along image x (h) / image y (v), and the face normal axis
  var FACE_AXES = { pz: 'xyz', nz: 'xyz', px: 'zyx', nx: 'zyx', py: 'xzy', ny: 'xzy' };
  // wood(dir, base, { dark, plank, seed }): planks with grain along model axis dir 'x'|'y'|'z' (end grain on the
  // faces whose normal is dir) or along the image ('h' | 'v'); plank = seam spacing in texels (0 = none)
  P.wood = function (dir, base, o) {
    return factory('wood', [dir || 'x', base == null ? 0xb08550 : base, o || {}], function (dir, base, o) {
      var seed = o.seed == null ? 3 : o.seed, plank = o.plank | 0, dark = o.dark;
      var f = function (g, w, h, face) {
        var ax = FACE_AXES[face] || 'xyz', mode = dir;
        if (dir === 'x' || dir === 'y' || dir === 'z') mode = ax[0] === dir ? 'h' : ax[1] === dir ? 'v' : 'end';
        if (mode === 'end') {
          var cx = (w - 1) / 2, cy = (h - 1) / 2, rings = Math.max(2, Math.min(w, h) / 3);
          for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
            var d = Math.max(Math.abs(x - cx) / (w / 2), Math.abs(y - cy) / (h / 2));
            var ring = Math.floor(d * rings) % 2, edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
            if (edge && dark != null) P.px(g, x, y, dark); else P.px(g, x, y, base, edge ? 0.74 : ring ? 0.86 : 0.97);
          }
          return;
        }
        var hor = mode !== 'v', L = hor ? w : h, A = hor ? h : w;
        for (var j = 0; j < A; j++) {
          var line = hash(0, j, seed), tone = line < 0.25 ? 0.93 : line > 0.85 ? 1.04 : 1;
          var off = Math.floor(hash(1, j, seed) * 3), seam = plank > 0 && j % plank === plank - 1;
          for (var i = 0; i < L; i++) {
            var k = tone * (1 + (hash(i, j, seed + 11) - 0.5) * 0.05);
            if (hash(((i + off) / 3) | 0, j, seed + 7) < 0.16) k *= 0.88;
            if (seam) k = 0.72;
            var c = seam && dark != null ? dark : base;
            if (hor) P.px(g, i, j, c, seam && dark != null ? 1 : k); else P.px(g, j, i, c, seam && dark != null ? 1 : k);
          }
        }
      };
      f.byFace = true;            // output depends on the face → face is part of the dedupe key
      return f;
    });
  };
  // plaid(c1, c2, size): gingham / checked cloth — c1 background, c2 stripes, size = band width in texels
  P.plaid = function (c1, c2, size) {
    return factory('plaid', [c1, c2, size || 2], function (c1, c2, size) {
      var a = col(c1), b = col(c2), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, (a[3] + b[3]) / 2];
      return function (g, w, h) {
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
          var u = Math.floor(x / size) % 2, v = Math.floor(y / size) % 2;
          P.px(g, x, y, u && v ? b : u || v ? m : a);
        }
      };
    });
  };
  // stripes(c1, c2, width = 1, dir = 'h'): alternating bands ('h' = horizontal bands, 'v' = vertical)
  P.stripes = function (c1, c2, width, dir) {
    return factory('stripes', [c1, c2, width || 1, dir || 'h'], function (c1, c2, width, dir) {
      return function (g, w, h) {
        var n = dir === 'v' ? w : h;
        for (var k = 0; k < n; k++) {
          g.fillStyle = css(Math.floor(k / width) % 2 ? c2 : c1);
          if (dir === 'v') g.fillRect(k, 0, 1, h); else g.fillRect(0, k, w, 1);
        }
      };
    });
  };
  // dots(bg, fg, spacing = 4, r = 0): polka dots on a staggered grid; r = 1 draws small plus shapes
  P.dots = function (bg, fg, spacing, r) {
    return factory('dots', [bg, fg, spacing || 4, r | 0], function (bg, fg, sp, r) {
      return function (g, w, h) {
        P.rect(g, 0, 0, w, h, bg);
        for (var y = 0, row = 0; y < h + sp; y += sp, row++) for (var x = (row % 2) * (sp >> 1); x < w + sp; x += sp) {
          var cx = x + (sp >> 2), cy = y + (sp >> 2);
          P.px(g, cx, cy, fg);
          if (r > 0) { P.px(g, cx - 1, cy, fg); P.px(g, cx + 1, cy, fg); P.px(g, cx, cy - 1, fg); P.px(g, cx, cy + 1, fg); }
        }
      };
    });
  };

  // ---- face paint → normalised paint { key, w, h, k (shade multiplier), draw(g) } --------------------------
  // hex/colour → flat (packed as 1 texel); { color, noise = .06, shade = true (lit) | 0..1, border, bw, cell, seed, fn }
  // → drawn at face size; fn(g, w, h, face) → drawn as is (no shade unless wrapped: { fn, shade: true }).
  var fnIds = typeof WeakMap !== 'undefined' ? new WeakMap() : null, fnN = 0;
  function fnKey(f) {
    if (f.paintKey) return f.paintKey;
    if (!fnIds) return f.__paintId || (f.__paintId = 'f' + (++fnN));
    var id = fnIds.get(f);
    if (!id) fnIds.set(f, id = 'f' + (++fnN));
    return id;
  }
  function normPaint(p, face, kind, w, h, density) {
    var o = typeof p === 'function' ? { fn: p, shade: false } :
      p && typeof p === 'object' && !Array.isArray(p) ? p : { color: p, shade: false, noise: 0 };
    var fn = typeof o.fn === 'function' ? o.fn : null;
    var shade = o.shade == null ? kind === 'lit' : o.shade, s = shade === true ? 1 : +shade || 0;
    var k = 1 - (1 - (SHADE[face] || 1)) * s;
    var noise = fn ? 0 : o.noise == null ? 0.06 : +o.noise || 0;
    var c = o.color == null ? 0xffffff : o.color, cc = col(c), bw = o.bw || 1;
    var cell = o.cell || density || 1, seed = (o.seed | 0) + cc[0] * 7 + cc[1] * 13 + cc[2] * 31;
    if (!fn && !(noise > 0) && o.border == null) w = h = 1;          // flat colour: one texel is enough
    var key = (fn ? fnKey(fn) + (fn.byFace ? '@' + face : '') : 'c' + cc.join(',')) + '|' + noise + '|' + cell +
      '|' + seed + '|' + (o.border == null ? '' : col(o.border).join(',') + '/' + bw) + '|' + k.toFixed(3) + '|' + w + 'x' + h;
    return {
      key: key, w: w, h: h, k: k,
      draw: function (g) {
        if (fn) fn(g, w, h, face);
        else if (noise > 0) P.noise(g, 0, 0, w, h, c, noise, seed, cell);
        else P.rect(g, 0, 0, w, h, c);
        if (o.border != null) P.border(g, 0, 0, w, h, o.border, bw);
      }
    };
  }
  M._normPaint = normPaint;

  // ---- cube → faces -----------------------------------------------------------------------------------------
  // corners per face as (x y z) bits (0 = min, 1 = max), order BL BR TR TL seen from outside (CCW = front);
  // a = model axes along texel w / h.  Image up: sides +y, top -z (north), bottom +z.
  var FACES = {
    pz: { c: ['001', '101', '111', '011'], n: [0, 0, 1], a: [0, 1] },
    nz: { c: ['100', '000', '010', '110'], n: [0, 0, -1], a: [0, 1] },
    px: { c: ['101', '100', '110', '111'], n: [1, 0, 0], a: [2, 1] },
    nx: { c: ['000', '001', '011', '010'], n: [-1, 0, 0], a: [2, 1] },
    py: { c: ['011', '111', '110', '010'], n: [0, 1, 0], a: [0, 2] },
    ny: { c: ['000', '100', '101', '001'], n: [0, -1, 0], a: [0, 2] }
  };
  var FACE_ORDER = ['pz', 'nz', 'px', 'nx', 'py', 'ny'];
  FACE_ORDER.forEach(function (f) { FACES[f].c = FACES[f].c.map(function (s) { return [+s[0], +s[1], +s[2]]; }); });
  M._FACES = FACES;

  // rotFn(axis, angleDeg, origin) → fn(p, isDir) rotating a point about origin (right-handed, CCW seen from +axis)
  function rotFn(axis, angle, origin) {
    var ax = axis === 'x' ? 0 : axis === 'z' ? 2 : 1, a = angle * DEG, cs = Math.cos(a), sn = Math.sin(a);
    var i = (ax + 1) % 3, j = (ax + 2) % 3;
    return function (p, isDir) {
      var oi = isDir ? 0 : origin[i], oj = isDir ? 0 : origin[j], q = p.slice(), u = p[i] - oi, v = p[j] - oj;
      q[i] = u * cs - v * sn + oi; q[j] = u * sn + v * cs + oj;
      return q;
    };
  }
  // cubeFaces(cube, density) → [{ face, p: 4 × [x, y, z] (absolute model px, rotated), n, w, h, paint }]
  // texel size uses the un-inflated cube size (like Blockbench); faces of zero area are skipped.
  function cubeFaces(cb, density) {
    var f = cb.from, t = cb.to, inf = +cb.inflate || 0, out = [], lo = [], hi = [], size = [], ctr = [];
    for (var a = 0; a < 3; a++) {
      lo[a] = Math.min(f[a], t[a]) - inf; hi[a] = Math.max(f[a], t[a]) + inf;
      size[a] = Math.abs(t[a] - f[a]); ctr[a] = (f[a] + t[a]) / 2;
    }
    var r = cb.rot, rf = r && r.angle ? rotFn(r.axis, r.angle, r.origin || ctr) : null, fs = cb.faces || {};
    for (var q = 0; q < 6; q++) {
      var name = FACE_ORDER[q], paint = fs[name] !== undefined ? fs[name] : fs.all, F = FACES[name];
      if (paint == null || paint === false) continue;
      if (!(hi[F.a[0]] > lo[F.a[0]]) || !(hi[F.a[1]] > lo[F.a[1]])) continue;
      var pts = [];
      for (var c = 0; c < 4; c++) {
        var b = F.c[c], pt = [b[0] ? hi[0] : lo[0], b[1] ? hi[1] : lo[1], b[2] ? hi[2] : lo[2]];
        pts.push(rf ? rf(pt) : pt);
      }
      out.push({
        face: name, p: pts, n: rf ? rf(F.n, true) : F.n.slice(), paint: paint,
        w: Math.max(1, Math.round(size[F.a[0]] * density)), h: Math.max(1, Math.round(size[F.a[1]] * density))
      });
    }
    return out;
  }
  M._cubeFaces = cubeFaces;

  // ---- shelf packer + atlas -----------------------------------------------------------------------------------
  // shelfPack(rects [{ w, h }], W, H) → true when all fit; sets r.x, r.y = interior origin (each rect reserves a
  // 1-texel gutter on every side, so rects incl. gutters never overlap and stay inside the canvas)
  function shelfPack(rects, W, H) {
    var x = 0, y = 0, rowH = 0;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i], w = r.w + 2, h = r.h + 2;
      if (w > W) return false;
      if (x + w > W) { y += rowH; x = 0; rowH = 0; }
      if (y + h > H) return false;
      r.x = x + 1; r.y = y + 1;
      x += w; if (h > rowH) rowH = h;
    }
    return true;
  }
  var POW = [16, 32, 64, 128, 256, 512, 1024, 2048];
  // packAtlas(rects, max = 2048) → [W, H] smallest power-of-two canvas that holds all rects (sorted tall first), or null
  function packAtlas(rects, max) {
    max = max || 2048;
    rects.sort(function (a, b) { return b.h - a.h || b.w - a.w || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0); });
    var area = 0, mw = 0, mh = 0, cands = [];
    rects.forEach(function (r) { area += (r.w + 2) * (r.h + 2); mw = Math.max(mw, r.w + 2); mh = Math.max(mh, r.h + 2); });
    POW.forEach(function (W) {
      POW.forEach(function (H) { if (W <= max && H <= max && W >= mw && H >= mh && W * H >= area) cands.push([W, H]); });
    });
    cands.sort(function (a, b) {
      return a[0] * a[1] - b[0] * b[1] || Math.abs(Math.log2(a[0] / a[1])) - Math.abs(Math.log2(b[0] / b[1])) || b[0] - a[0];
    });
    for (var i = 0; i < cands.length; i++) if (shelfPack(rects, cands[i][0], cands[i][1])) return cands[i];
    return null;
  }
  M._shelfPack = shelfPack;
  M._packAtlas = packAtlas;

  // finishRect(data, W, r): apply the shade multiplier r.k to the interior, copy edge texels into the 1-texel
  // gutter ring (corners included) → returns true when any interior texel has alpha < 255
  function finishRect(d, W, r) {
    var x0 = r.x, y0 = r.y, w = r.w, h = r.h, k = r.k, alpha = false, x, y, o;
    for (y = y0; y < y0 + h; y++) for (x = x0; x < x0 + w; x++) {
      o = (y * W + x) * 4;
      if (k !== 1) { d[o] = d[o] * k; d[o + 1] = d[o + 1] * k; d[o + 2] = d[o + 2] * k; }
      if (d[o + 3] < 255) alpha = true;
    }
    function cp(gx, gy) {
      var sx = gx < x0 ? x0 : gx >= x0 + w ? x0 + w - 1 : gx, sy = gy < y0 ? y0 : gy >= y0 + h ? y0 + h - 1 : gy;
      var s = (sy * W + sx) * 4, t = (gy * W + gx) * 4;
      d[t] = d[s]; d[t + 1] = d[s + 1]; d[t + 2] = d[s + 2]; d[t + 3] = d[s + 3];
    }
    for (x = x0 - 1; x <= x0 + w; x++) { cp(x, y0 - 1); cp(x, y0 + h); }
    for (y = y0; y < y0 + h; y++) { cp(x0 - 1, y); cp(x0 + w, y); }
    return alpha;
  }
  M._finishRect = finishRect;

  // paintAtlas(uniq [{ key, w, h, k, draw }], max) → { canvas, W, H } (rects get x, y, alpha) or null on overflow
  function paintAtlas(uniq, max) {
    var size = packAtlas(uniq, max);
    if (!size) return null;
    var W = size[0], H = size[1], cv = M._canvas(W, H), i, r;
    var g = cv.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    for (i = 0; i < uniq.length; i++) {
      r = uniq[i];
      g.save();
      g.translate(r.x, r.y);
      g.beginPath(); g.rect(0, 0, r.w, r.h); g.clip();
      try { r.draw(g); } catch (e) { err('model.paint', e); g.fillStyle = '#ff00ff'; g.fillRect(0, 0, r.w, r.h); }
      g.restore();
    }
    var img = g.getImageData(0, 0, W, H);
    for (i = 0; i < uniq.length; i++) uniq[i].alpha = finishRect(img.data, W, uniq[i]);
    g.putImageData(img, 0, 0);
    return { canvas: cv, W: W, H: H };
  }
  M._paintAtlas = paintAtlas;

  // ---- build ----------------------------------------------------------------------------------------------------
  var KIND = { lit: 1, glass: 1, emis: 1 };
  var texIds = typeof WeakMap !== 'undefined' ? new WeakMap() : null, texN = 0;
  function texId(t) {
    var id = texIds ? texIds.get(t) : t.__modelId;
    if (!id) { id = (t.name || 'tex') + '#' + (++texN); if (texIds) texIds.set(t, id); else t.__modelId = id; }
    return id;
  }
  // v3: MeshStandardMaterial (scene sun / lamps / shadows). v1 option names rough / spec / ei are mapped;
  // other keys are copied only when the material has that property (no "not a property" warnings).
  function makeMat(kind, map, ei, alphaTest, extra, matOpts, label) {
    var o = {}, m, k;
    if (alphaTest) o.alphaTest = alphaTest;
    if (kind === 'glass') { o.transparent = true; o.rough = 0.1; delete o.alphaTest; }
    var mo = matOpts && matOpts[kind];
    for (k in mo) o[k] = mo[k];
    for (k in extra) o[k] = extra[k];
    m = new THREE.MeshStandardMaterial({ map: map, roughness: o.rough != null ? +o.rough : 0.85, metalness: 0 });
    if (kind === 'emis') { m.emissive.setRGB(1, 1, 1); m.emissiveMap = map; m.emissiveIntensity = ei; }
    for (k in o) {
      if (k === 'rough' || k === 'spec' || k === 'ei' || k === 'map') continue;
      if (k === 'color' || k === 'emissive') { m[k].set(o[k]); continue; }
      if (k in m) m[k] = o[k];
    }
    if (kind === 'glass') m.depthWrite = false;
    m.name = label;
    m.userData.kind = kind; m.userData.ei = ei;
    RECIPE.set(m, [kind, map, ei, alphaTest, extra, matOpts, label]);
    return m;
  }
  // clone({ ownMats }) rebuilds materials from their recipe (same as v1, where shared shader uniforms had to stay
  // live). The texture map stays shared; the current ei (setEi) carries over.
  var RECIPE = new WeakMap();
  function remake(m) {
    var r = RECIPE.get(m);
    if (!r) return m.clone();
    var n = makeMat(r[0], r[1], m.userData.ei, r[3], r[4], r[5], r[6]);
    if (r[0] === 'emis') M.setEi(n, m.userData.ei);
    return n;
  }
  function makeTex(canvas, label) {
    var t = new THREE.CanvasTexture(canvas);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.flipY = false;                       // v = canvas row / H
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding;
    t.name = label; t.needsUpdate = true;
    return t;
  }
  // buildOnce → built model, or null when the atlas does not fit at this density
  function buildOnce(def, opts, density, maxTex) {
    var name = def.name || 'model', u = (opts.scale == null ? 1 : opts.scale) / 16;
    var list = def.bones && def.bones.length ? def.bones : [{ name: 'root', pivot: [0, 0, 0] }];
    var abs = {}, groups = {}, order = [], uniq = {}, uniqList = [], alphaKind = {};
    list.forEach(function (b) { abs[b.name] = b.pivot || [0, 0, 0]; });
    (def.cubes || []).forEach(function (cb, ci) {
      if (!cb || !cb.from || !cb.to) return err('model.build', new Error(name + ': cube ' + ci + ' needs from/to'));
      var bn = abs[cb.bone] ? cb.bone : list[0].name, kind = KIND[cb.mat] ? cb.mat : 'lit';
      var ei = kind === 'emis' ? +(cb.ei != null ? cb.ei : def.ei != null ? def.ei : 1) : 0;
      var shadow = cb.shadow != null ? cb.shadow !== false : kind !== 'glass';
      cubeFaces(cb, density).forEach(function (fc) {
        var p = fc.paint, cust = p && typeof p === 'object' && p.tex ? p : null, gk = bn + '|' + kind + '|' + ei + '|' + shadow;
        if (cust) gk += '|' + texId(cust.tex);
        else {
          var np = normPaint(p, fc.face, kind, fc.w, fc.h, density);
          if (!uniq[np.key]) { uniq[np.key] = np; uniqList.push(np); }
          fc.rect = uniq[np.key];
        }
        var G = groups[gk];
        if (!G) { G = groups[gk] = { bone: bn, kind: kind, ei: ei, shadow: shadow, cust: cust, faces: [] }; order.push(gk); }
        G.faces.push(fc);
      });
    });
    var atlas = null;
    if (uniqList.length) {
      atlas = paintAtlas(uniqList, maxTex);
      if (!atlas) return null;
      atlas.tex = makeTex(atlas.canvas, 'model:' + name);
      atlas.rects = uniqList.length;
    }
    order.forEach(function (gk) {
      var G = groups[gk];
      if (!G.cust) G.faces.forEach(function (fc) { if (fc.rect.alpha) alphaKind[G.kind] = true; });
    });
    // bones: Object3D per bone, position relative to the parent pivot (metres), rest pose kept JSON-safe
    var root = new THREE.Group(), bones = {};
    root.name = 'model:' + name; root.userData.model = name;
    list.forEach(function (b) { var o = new THREE.Object3D(); o.name = b.name; bones[b.name] = o; });
    list.forEach(function (b) {
      var o = bones[b.name], par = b.parent != null && b.parent !== b.name && bones[b.parent] ? bones[b.parent] : root;
      for (var q = par; q; q = q.parent) if (q === o) { par = root; break; }   // parent cycle guard
      var pv = abs[b.name], pp = par === root ? [0, 0, 0] : abs[b.parent], r = b.rot || [0, 0, 0];
      par.add(o);
      o.position.set((pv[0] - pp[0]) * u, (pv[1] - pp[1]) * u, (pv[2] - pp[2]) * u);
      o.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ');
      o.userData.bone = true; o.userData.pivot = pv.slice();
      o.userData.cub = { p: o.position.toArray(), r: [o.rotation.x, o.rotation.y, o.rotation.z], s: [1, 1, 1] };
      o.userData.rest = o.position.clone();                             // contract: rest position (Vector3)
    });
    // meshes: one merged BufferGeometry per bone × kind (× ei, shadow flag, custom texture)
    var mats = {}, meshes = [], ei0 = {};
    order.forEach(function (gk) {
      var G = groups[gk], cu = G.cust, pre = cu ? 'tex:' + texId(cu.tex) + '/' : '';
      if (G.kind === 'emis' && ei0[pre] == null) ei0[pre] = G.ei;       // first ei → plain key 'emis'
      var key = pre + G.kind + (G.kind === 'emis' && G.ei !== ei0[pre] ? '@' + G.ei : '');
      var mat = mats[key] || (mats[key] = makeMat(G.kind, cu ? cu.tex : atlas.tex, G.ei,
        cu ? (cu.alphaTest == null ? 0.5 : cu.alphaTest) : alphaKind[G.kind] ? 0.5 : 0, cu && cu.opts, def.matOpts,
        name + ':' + key));
      var mesh = new THREE.Mesh(geoOf(G, abs[G.bone], u, atlas), mat);
      mesh.name = name + ':' + G.bone + ':' + key;
      if (!G.shadow) mesh.userData.noShadow = true;
      if (G.kind === 'glass') { mesh.userData.pass = 'trans'; mesh.renderOrder = 1; }
      mesh.castShadow = G.shadow; mesh.receiveShadow = true;
      bones[G.bone].add(mesh);
      meshes.push(mesh);
    });
    if (opts.parent) opts.parent.add(root);
    return { name: name, def: def, root: root, bones: bones, meshes: meshes, mats: mats, unit: u, density: density, atlas: atlas };
  }

  // geoOf(group, bone pivot px, unit, atlas) → BufferGeometry in bone-local metres (position, normal, uv, ao = 1)
  // atlas UV: flipY = false, so v = canvas row / H; custom { tex, uv: [u0, v0, u1, v1] } uses three.js UV space
  // (v0 = bottom edge of the face, v1 = top edge).
  function geoOf(G, pv, u, atlas) {
    var n = G.faces.length, pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), uv = new Float32Array(n * 8);
    var ao = new Float32Array(n * 4), idx = n * 4 > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
    for (var f = 0; f < n; f++) {
      var fc = G.faces[f], r = fc.rect, q, u0, v0, u1, v1;
      if (G.cust) { q = G.cust.uv || [0, 0, 1, 1]; u0 = q[0]; v0 = q[1]; u1 = q[2]; v1 = q[3]; }
      else { u0 = r.x / atlas.W; u1 = (r.x + r.w) / atlas.W; v0 = (r.y + r.h) / atlas.H; v1 = r.y / atlas.H; }
      var UV = [u0, v0, u1, v0, u1, v1, u0, v1];                     // BL BR TR TL
      for (var c = 0; c < 4; c++) {
        var p = fc.p[c], o = (f * 4 + c) * 3, o2 = (f * 4 + c) * 2;
        pos[o] = (p[0] - pv[0]) * u; pos[o + 1] = (p[1] - pv[1]) * u; pos[o + 2] = (p[2] - pv[2]) * u;
        nor[o] = fc.n[0]; nor[o + 1] = fc.n[1]; nor[o + 2] = fc.n[2];
        uv[o2] = UV[c * 2]; uv[o2 + 1] = UV[c * 2 + 1];
        ao[f * 4 + c] = 1;
      }
      var b = f * 4, ii = f * 6;
      idx[ii] = b; idx[ii + 1] = b + 1; idx[ii + 2] = b + 2; idx[ii + 3] = b; idx[ii + 4] = b + 2; idx[ii + 5] = b + 3;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  M._geoOf = geoOf;

  // V3.cuboid.build(def, { parent, scale = 1, density }) → { root, bones, meshes, mats, name, def, unit, density, atlas }
  // mats: { lit, glass, emis (first ei used), 'emis@<ei>' (other ei values), 'tex:<id>/<kind>' (custom texture
  // faces) } — only the kinds that occur.
  // Atlas over 2048² → density is halved (reported via V3.err) until it fits.
  M.build = function (def, opts) {
    opts = opts || {}; def = def || {};
    var d = opts.density || def.density || 1, b = null;
    for (var tries = 0; !b && tries < 6; tries++) {
      b = buildOnce(def, opts, d, tries === 5 ? 4096 : 2048);
      if (!b) { err('model.build', new Error((def.name || 'model') + ': atlas over 2048 at density ' + d)); d /= 2; }
    }
    return b || buildOnce({ name: def.name, bones: def.bones, cubes: [] }, opts, 1, 2048);
  };

  // V3.cuboid.clone(built, { parent, ownMats }) → same shape as build(); geometry, materials and textures are shared.
  // Shared materials mean hover glow (uHover) and setEi hit every clone; ownMats: true gives this clone its own
  // materials (same atlas texture, one extra draw-call state each) for separately hoverable / switchable objects.
  M.clone = function (b, opts) {
    var root = b.root.clone(true), map = new Map(), sa = [b.root], sb = [root], k;
    while (sa.length) {
      var x = sa.pop(), y = sb.pop();
      map.set(x, y);
      for (var i = 0; i < x.children.length; i++) { sa.push(x.children[i]); sb.push(y.children[i]); }
    }
    var out = {};
    for (k in b) out[k] = b[k];
    out.root = root; out.bones = {}; out.source = b.source || b;
    for (k in b.bones) out.bones[k] = map.get(b.bones[k]);
    out.meshes = b.meshes.map(function (m) { return map.get(m); });
    if (opts && opts.ownMats) {
      var mm = new Map(), own = function (m) { if (!mm.has(m)) mm.set(m, remake(m)); return mm.get(m); };
      out.mats = {};
      for (k in b.mats) out.mats[k] = own(b.mats[k]);
      root.traverse(function (o) { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material); });
    }
    if (opts && opts.parent) opts.parent.add(root);
    return out;
  };

  // V3.cuboid.matOf(built, tex) → the material of the custom-texture faces using tex (e.g. to edit uMapXf)
  M.matOf = function (b, tex) {
    var pre = 'tex:' + texId(tex) + '/';
    for (var k in b.mats) if (k.indexOf(pre) === 0) return b.mats[k];
    return null;
  };

  // V3.cuboid.setEi(built | material, ei): change the emissive strength at runtime (lamp on / off)
  var EI_NAMES = ['uEi', 'uEI', 'ei', 'uEmisI', 'uEmissiveI', 'uEmissiveIntensity', 'emissiveIntensity'];
  M.setEi = function (b, ei) {
    var list = [], k;
    if (b && b.isMaterial) list.push(b);
    else if (b && b.mats) for (k in b.mats) if (b.mats[k].userData.kind === 'emis') list.push(b.mats[k]);
    list.forEach(function (m) {
      m.userData.ei = ei;
      if (typeof m.setEi === 'function') return m.setEi(ei);
      var un = m.uniforms || {};
      for (var i = 0; i < EI_NAMES.length; i++) if (un[EI_NAMES[i]]) { un[EI_NAMES[i]].value = ei; return; }
      if ('emissiveIntensity' in m) { m.emissiveIntensity = ei; return; }
      if (m.color && !m.uniforms) m.color.setScalar(ei > 0 ? 1 : 0.4);       // MeshBasicMaterial fallback
    });
  };

  // ---- clips ----------------------------------------------------------------------------------------------------
  // V3.cuboid.clips[name] = { len, loop = true, ease = 'linear' | 'smooth' | 'step', speed = 1, additive = false,
  //   tracks: { bone: { rot: [[t, x, y, z] …] (deg, offset to rest), pos: [[t, x, y, z] …] (px), scl: [[t, x, y, z] …] (×) } } }
  // A key may carry its own ease as a 5th item ([t, x, y, z, 'step']); it eases the segment that starts at that key.
  // Looping clips wrap the last key back to the first (put a key at t = len to control the wrap).
  var EASE = {
    linear: function (t) { return t; },
    smooth: function (t) { return t * t * (3 - 2 * t); },
    step: function () { return 0; }
  };
  M.ease = EASE;
  function prepClip(c) {
    if (c.__prep) return c;
    var len = 0, b, ch, keys;
    c.tracks = c.tracks || {};
    for (b in c.tracks) for (ch in c.tracks[b]) {
      keys = c.tracks[b][ch];
      if (!Array.isArray(keys) || !keys.length) continue;
      keys.sort(function (p, q) { return p[0] - q[0]; });
      len = Math.max(len, keys[keys.length - 1][0]);
    }
    if (!(c.len > 0)) c.len = len || 1;
    if (c.loop == null) c.loop = true;
    Object.defineProperty(c, '__prep', { value: true, enumerable: false });
    return c;
  }
  M._prepClip = prepClip;
  // sample(keys, t, len, loop, ease, out) → out[0..2] = value of the track at clip time t
  function sample(keys, t, len, loop, ease, o) {
    var n = keys.length, a, b, ta, tb, i = n - 1;
    while (i >= 0 && keys[i][0] > t) i--;                             // keys[i] = last key at or before t
    if (n === 1 || (!loop && (i < 0 || i === n - 1))) {
      a = keys[i < 0 ? 0 : i]; o[0] = a[1]; o[1] = a[2]; o[2] = a[3];
      return o;
    }
    if (i < 0) { a = keys[n - 1]; b = keys[0]; ta = a[0] - len; tb = b[0]; }
    else if (i === n - 1) { a = keys[n - 1]; b = keys[0]; ta = a[0]; tb = b[0] + len; }
    else { a = keys[i]; b = keys[i + 1]; ta = a[0]; tb = b[0]; }
    var f = tb > ta ? (t - ta) / (tb - ta) : 0;
    f = (EASE[a[4] || ease] || EASE.linear)(f < 0 ? 0 : f > 1 ? 1 : f);
    o[0] = a[1] + (b[1] - a[1]) * f; o[1] = a[2] + (b[2] - a[2]) * f; o[2] = a[3] + (b[3] - a[3]) * f;
    return o;
  }
  M._sample = sample;
  // pose of one bone = 9 numbers: rot offset xyz (deg), pos offset xyz (px), scale multiplier xyz
  var S3 = [0, 0, 0];
  function sampleBone(tk, c, t, loop, add, to) {
    var k;
    if (tk.rot && tk.rot.length) {
      sample(tk.rot, t, c.len, loop, c.ease, S3);
      for (k = 0; k < 3; k++) to[k] = add ? to[k] + S3[k] : S3[k];
    }
    if (tk.pos && tk.pos.length) {
      sample(tk.pos, t, c.len, loop, c.ease, S3);
      for (k = 0; k < 3; k++) to[3 + k] = add ? to[3 + k] + S3[k] : S3[k];
    }
    if (tk.scl && tk.scl.length) {
      sample(tk.scl, t, c.len, loop, c.ease, S3);
      for (k = 0; k < 3; k++) to[6 + k] = add ? to[6 + k] * S3[k] : S3[k];
    }
  }
  // stepLayer: advance clip time + fade, blend this layer over the pose below (pose is updated in place)
  var TO = new Array(9);
  function stepLayer(L, dt, pose) {
    var c = L.clip, n, k, i;
    if (!c && !L.anyFrom) { L.out = {}; return; }
    if (c) {
      L.t += dt * L.speed;
      if (L.loop) L.t = ((L.t % c.len) + c.len) % c.len;
      else if (L.t >= c.len || (L.t <= 0 && L.speed < 0)) {
        L.t = Math.max(0, Math.min(c.len, L.t));
        if (!L.done) {
          L.done = true;
          if (L.onEnd) try { L.onEnd(L.name); } catch (e) { err('model.onEnd', e); }
        }
      }
    }
    L.fadeT += dt;
    var fix = L.wFix != null, w = fix ? Math.max(0, Math.min(1, L.wFix)) : L.fade > 0 ? EASE.smooth(Math.min(1, L.fadeT / L.fade)) : 1;
    var out = {}, tr = c ? c.tracks : null, names = [];
    if (tr) for (n in tr) if (pose[n]) names.push(n);
    for (n in L.from) if (pose[n] && !(tr && tr[n])) names.push(n);
    for (i = 0; i < names.length; i++) {
      n = names[i];
      var cur = pose[n], fr = (!fix && L.from[n]) || cur, res = out[n] = new Array(9);   // fixed weight: blend over the layers below
      for (k = 0; k < 9; k++) TO[k] = cur[k];
      if (tr && tr[n]) sampleBone(tr[n], c, L.t, L.loop, L.additive, TO);
      for (k = 0; k < 9; k++) res[k] = fr[k] + (TO[k] - fr[k]) * w;
      for (k = 0; k < 9; k++) cur[k] = res[k];
    }
    L.out = out;
    L.w = w;
    if (w >= 1 && L.anyFrom) { L.from = {}; L.anyFrom = false; }
  }

  // ---- player ---------------------------------------------------------------------------------------------------
  // V3.cuboid.player(built) → { play(name | clip | null, { fade = .25, loop, speed, layer = 0, additive, restart, at,
  //   onEnd }), stop({ layer, fade }), layer(fn(bones, t, dt, player)) → remove(), update(dt), current, time, … }
  // Layer 0 = base; layers 1+ override (or add to) only the bones their clip has tracks for (≥ 2 layers).
  // play() of the clip already on that layer is a no-op (pass restart: true to start it again), and so is
  // play(null) on a layer already stopped / fading out, so both are safe to call every frame.
  // update(dt): bones reset to rest → clip layers blended in order → layer fns.
  M.player = function (b) {
    var bones = b.bones, pose = {}, restOf = {}, layers = [], fns = [], T = 0, unit = b.unit || 1 / 16, n;
    for (n in bones) {
      if (!bones[n].userData.cub) continue;
      pose[n] = [0, 0, 0, 0, 0, 0, 1, 1, 1]; restOf[n] = bones[n].userData.cub;
    }
    function getL(i) {
      i = i | 0;
      while (layers.length <= i) layers.push({ clip: null, name: null, t: 0, speed: 1, loop: true, fade: 0, fadeT: 0,
        from: {}, anyFrom: false, out: {}, w: 1, wFix: null, done: false, additive: false, onEnd: null });
      return layers[i];
    }
    getL(1);
    function play(name, o) {
      o = o || {};
      var L = getL(o.layer), c = name == null ? null : typeof name === 'string' ? M.clips[name] : name;
      if (name != null && !c) { err('model.play', new Error('no clip ' + name)); return api; }
      if (c) prepClip(c);
      if (o.weight !== undefined) L.wFix = o.weight == null ? null : +o.weight;   // fixed layer weight (null = fade)
      if (c && L.clip === c && !o.restart) {
        if (o.speed != null) L.speed = o.speed;
        if (o.loop != null) L.loop = o.loop;
        return api;
      }
      // stop on a layer that is already stopped or fading out: keep the running fade (restarting it every frame froze
      // the last pose on that layer); fade: 0 clears it at once
      if (!c && !L.clip) {
        if (L.anyFrom && o.fade === 0) { L.from = {}; L.anyFrom = false; L.out = {}; }
        return api;
      }
      L.from = {}; L.anyFrom = false;
      for (var k in L.out) { L.from[k] = L.out[k].slice(); L.anyFrom = true; }
      L.fade = o.fade == null ? 0.25 : +o.fade; L.fadeT = 0;
      L.clip = c; L.name = c ? (typeof name === 'string' ? name : c.name || 'clip') : null;
      L.done = false; L.onEnd = o.onEnd || null;
      L.speed = o.speed != null ? +o.speed : c && c.speed != null ? c.speed : 1;
      L.loop = c ? (o.loop != null ? !!o.loop : c.loop !== false) : false;
      L.additive = !!(o.additive != null ? o.additive : c && c.additive);
      L.t = o.at != null ? +o.at : c && L.speed < 0 ? c.len : 0;
      return api;
    }
    function update(dt) {
      dt = +dt || 0; T += dt;
      var q, r, bo, i;
      for (n in pose) { q = pose[n]; q[0] = q[1] = q[2] = q[3] = q[4] = q[5] = 0; q[6] = q[7] = q[8] = 1; }
      for (i = 0; i < layers.length; i++) stepLayer(layers[i], dt, pose);
      for (n in pose) {
        bo = bones[n]; r = restOf[n]; q = pose[n];
        bo.rotation.set(r.r[0] + q[0] * DEG, r.r[1] + q[1] * DEG, r.r[2] + q[2] * DEG, 'XYZ');
        bo.position.set(r.p[0] + q[3] * unit, r.p[1] + q[4] * unit, r.p[2] + q[5] * unit);
        bo.scale.set(r.s[0] * q[6], r.s[1] * q[7], r.s[2] * q[8]);
      }
      for (i = 0; i < fns.length; i++) {
        try { fns[i](bones, T, dt, api); } catch (e) { err('model.layer', e); }
      }
      return api;
    }
    var api = {
      built: b, bones: bones, layers: layers, pose: pose, play: play, update: update,
      stop: function (o) { o = o || {}; return play(null, { layer: o.layer, fade: o.fade }); },
      layer: function (fn) {
        fns.push(fn);
        return function () { var i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); };
      },
      setWeight: function (i, w) { getL(i).wFix = w == null ? null : +w; return api; },
      clipOf: function (i) { return getL(i).name; },
      timeOf: function (i) { return getL(i).t; },
      done: function (i) { var L = getL(i); return !L.clip || L.done; }
    };
    Object.defineProperty(api, 'current', { enumerable: true, get: function () { return layers[0].name; } });
    Object.defineProperty(api, 'time', {
      enumerable: true, get: function () { return layers[0].t; }, set: function (v) { layers[0].t = +v || 0; }
    });
    Object.defineProperty(api, 'elapsed', { get: function () { return T; } });
    return api;
  };

  // V3.cuboid.tex(canvas, { flipY = true }) → nearest-filtered sRGB CanvasTexture without mipmaps, for { tex, uv }
  // faces (with flipY true, uv [0, 0, 1, 1] shows the canvas upright).  Call tex.needsUpdate = true after redraws.
  M.tex = function (canvas, o) {
    var t = makeTex(canvas, (o && o.name) || 'model:tex');
    t.flipY = !(o && o.flipY === false);
    return t;
  };

})(window.V3);
