// 20-girlv1.js — v1 小鲸鱼（女仆小鲸鱼），移植自 v1 的 40-girl.js。长方体骨架，用 V3.cuboid 搭（16 px = 1 m，脸朝 +z，她的左边 = +x）。
// 骨骼支点在关节上（模型 px）；静止姿势两臂微微张开。v3 加了：缩放到 layout.girlH、反馈部位、65-girl-actor 用的接口、工作台模型 girlv1。
(function (V3) {
  'use strict';
  const G = V3.girlv1 = V3.girlv1 || {};
  const B = (name, parent, pivot, rot) => {
    const b = { name, pivot };
    if (parent) b.parent = parent;
    if (rot) b.rot = rot;
    return b;
  };
  G.bonesDef = () => [
    B('root', null, [0, 0, 0]),
    B('hips', 'root', [0, 8, 0]),
    B('spine', 'hips', [0, 9, 0]),
    B('chest', 'spine', [0, 10.5, 0]),
    B('neck', 'chest', [0, 13, 0]),
    B('head', 'neck', [0, 13.5, 0]),
    B('ahoge', 'head', [0, 22.3, 0.5]),
    B('hairBack', 'head', [0, 20.5, -4]),
    B('hairL', 'head', [3.6, 19.5, 0.5]),
    B('hairR', 'head', [-3.6, 19.5, 0.5]),
    B('finL', 'head', [4.2, 18.2, -0.4], [0, 18, -22]),
    B('finR', 'head', [-4.2, 18.2, -0.4], [0, -18, 22]),
    B('armL', 'chest', [3.3, 12.5, 0], [0, 0, 14]),
    B('forearmL', 'armL', [3.75, 10.1, 0]),
    B('handL', 'forearmL', [3.75, 8.2, 0]),
    B('armR', 'chest', [-3.3, 12.5, 0], [0, 0, -14]),
    B('forearmR', 'armR', [-3.75, 10.1, 0]),
    B('handR', 'forearmR', [-3.75, 8.2, 0]),
    B('skirt', 'hips', [0, 9, 0]),
    B('legL', 'hips', [1.2, 7.5, 0]),
    B('shinL', 'legL', [1.2, 4, 0]),
    B('legR', 'hips', [-1.2, 7.5, 0]),
    B('shinR', 'legR', [-1.2, 4, 0]),
    // tail chain (rest, deg): tail1 [-10, 0, 0] hangs straight down-back (was [-4, -30, 0]); tail2 [14, 0, 0] (was 24)
    // and tail3 [44, 0, 0] (was 42) curl the fluke up into a J. tail1 → tail2 → tail3 are nested, so a yaw on tail1
    // swings the whole tail and tail2 / tail3 bend after it.
    B('tail1', 'hips', [0, 6.4, -2.2], [-10, 0, 0]),
    B('tail2', 'tail1', [0, 6.2, -5.4], [14, 0, 0]),
    B('tail3', 'tail2', [0, 6.05, -8.0], [44, 0, 0]),
  ];
  // ---- palette (whale-girl-sheet) + paint helpers ------------------------------------------------------
  const C = G.C = { navy: 0x1e2a56, ind: 0x3a5aa9, sky: 0x6fc3f5, pale: 0xb8e6f8, white: 0xfbfbfe, grey: 0xe6eaf2,
    skin: 0xffe1d9, dark: 0x4a4a4a, gold: 0xd9a944, blue: 0x2f8de4, sole: 0x141a38, pj: 0xa8d4f2 };
  const P = (color, noise) => ({ color, noise: noise == null ? 0.05 : noise, shade: true });
  const hsh = (x, y, s) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const rgb = (c, k) => 'rgb(' + [16, 8, 0].map(s => Math.max(0, Math.min(255, Math.round(((c >> s) & 255) * k)))).join(',') + ')';
  const lerpC = (a, b, t) => [16, 8, 0].reduce((o, s) => o | (Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s), 0);
  const isMap = f => f && typeof f === 'object' && !('color' in f) && !('tex' in f);
  // cu(bone, from, to, paint | per-face map, extra) → cube (px)
  const cu = (bone, from, to, f, x) => Object.assign({ bone, from, to, faces: isMap(f) ? f : { all: f }, shadow: true }, x);
  const swapLR = n => /L$/.test(n) ? n.slice(0, -1) + 'R' : /R$/.test(n) ? n.slice(0, -1) + 'L' : n;
  const mirror = c => {        // mirror across x = 0 (her left ↔ right)
    const m = Object.assign({}, c, { bone: swapLR(c.bone), from: [-c.to[0], c.from[1], c.from[2]], to: [-c.from[0], c.to[1], c.to[2]] });
    if (isMap(c.faces)) { m.faces = Object.assign({}, c.faces); delete m.faces.px; delete m.faces.nx;
      if (c.faces.px !== undefined) m.faces.nx = c.faces.px;
      if (c.faces.nx !== undefined) m.faces.px = c.faces.nx; }
    if (c.rot) m.rot = { axis: c.rot.axis, angle: c.rot.axis === 'x' ? c.rot.angle : -c.rot.angle,
      origin: [-c.rot.origin[0], c.rot.origin[1], c.rot.origin[2]] };
    return m;
  };
  const sym = list => list.concat(list.map(mirror));

  // ---- parts: separate defs on the same skeleton (own density; toggled as a group) ----------------------
  G.parts = {};
  const part = (name, density, fn) => { G.parts[name] = { density, fn }; };
  G._h = { C, P, hsh, rgb, lerpC, cu, sym, mirror, part };
  const defOf = n => ({ name: 'girl-' + n, density: G.parts[n].density, bones: G.bonesDef(), cubes: G.parts[n].fn() });
  G.def = () => defOf('body');
  const graft = (g, pb) => {   // move a part's meshes onto the matching bones of the main build
    const out = [];
    for (const n in pb.bones) pb.bones[n].children.filter(o => o.isMesh).forEach(m => { g.bones[n].add(m); out.push(m); });
    if (Array.isArray(g.built.meshes)) g.built.meshes.push(...out);
    return out;
  };

  // ---- legs: white tights (+ feet, seen when barefoot) ---------------------------------------------------
  const TI = P(0xf1f2f8, 0.03);
  part('body', 2, () => sym([
    cu('legL', [0.15, 3.9, -1.1], [2.35, 7.9, 1.1], TI),
    cu('shinL', [0.15, 0.6, -1.05], [2.35, 4.05, 1.05], TI),
    cu('shinL', [0.15, 0, -1.05], [2.35, 1, 1.5], TI),
  ]));
  // ---- shoes: navy Mary-Janes (chunky sole, strap, gold buckle) / slippers -------------------------------
  const SH = (c, top) => ({ all: P(c, 0.04), py: P(top, 0.04) });
  part('maryjane', 3, () => sym([
    cu('shinL', [0, 0, -1.35], [2.5, 0.45, 1.85], P(C.sole, 0.03)),
    cu('shinL', [0.05, 0.45, 0.15], [2.45, 1.15, 1.8], SH(0x22306a, 0x2e4088)),
    cu('shinL', [0.05, 0.45, -1.3], [2.45, 1.8, 0.15], SH(0x1f2b5e, 0x26346e)),
    cu('shinL', [-0.05, 1.55, 0.25], [2.55, 1.85, 1.2], P(0x1a2450, 0.02)),
    cu('shinL', [2.52, 1.5, 0.35], [2.72, 1.9, 0.75], P(C.gold, 0.08)),
  ]));
  part('slippers', 2, () => sym([
    cu('shinL', [-0.05, 0, -1.3], [2.55, 0.9, 1.9], { all: P(0xbfe2f6, 0.06), ny: P(0x8fb8d8) }),
    cu('shinL', [-0.15, 0.7, 0.5], [2.65, 1.35, 1.95], P(0xffffff, 0.1)),
  ]));
  // ---- dress: bodice, waist, bell skirt (3 tiers), petticoat frill, gold hem trim, back bow, bow tie ------
  // ring(bone, x0, x1, z0, z1, y0, y1, step, paint, sides) → scalloped frill of small blocks around a rectangle
  const ring = (bone, x0, x1, z0, z1, y0, y1, st, f, sides) => {
    const out = [], t = 0.55, sd = sides || 'fbrl';
    const row = (a0, a1, mk) => { const n = Math.max(1, Math.round((a1 - a0) / st)), d = (a1 - a0) / n;
      for (let i = 0; i < n; i++) { const lo = i % 2 ? 0.28 : 0; mk(a0 + i * d, a0 + (i + 1) * d, y0 - lo, y1 - lo * 0.5); } };
    if (sd.includes('f')) row(x0, x1, (a, b, l, h) => out.push(cu(bone, [a, l, z1 - 0.15], [b, h, z1 + t], f, { shadow: false })));
    if (sd.includes('b')) row(x0, x1, (a, b, l, h) => out.push(cu(bone, [a, l, z0 - t], [b, h, z0 + 0.15], f, { shadow: false })));
    if (sd.includes('r')) row(z0, z1, (a, b, l, h) => out.push(cu(bone, [x0 - t, l, a], [x0 + 0.15, h, b], f, { shadow: false })));
    if (sd.includes('l')) row(z0, z1, (a, b, l, h) => out.push(cu(bone, [x1 - 0.15, l, a], [x1 + t, h, b], f, { shadow: false })));
    return out;
  };
  const FR = (g, w, h) => {    // white frill: vertical folds + soft grey underside
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      const k = 1 - 0.07 * (x % 3 === 0) - 0.1 * (y / h) - 0.03 * hsh(x, y, 7);
      g.fillStyle = rgb(C.white, k); g.fillRect(x, y, 1, 1);
    }
  };
  // navy pleats; trim → gold hem band with crosses; bows → two small gold bows near the lower corners
  const PLEAT = (base, trim, bows) => (g, w, h) => {
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      const k = 0.92 + 0.12 * Math.sin(x * 0.9) - 0.05 * hsh(x, y, 3);
      g.fillStyle = rgb(base, k); g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = rgb(C.gold, 1);
    const R = (x, y, ww, hh) => { if (x >= 0 && y >= 0 && x + ww <= w && y + hh <= h) g.fillRect(x, y, ww, hh); };
    if (trim) {
      const ty = h - 2;
      R(0, ty, w, 1);
      for (let x = 4; x < w - 3; x += 9) { R(x, ty - 4, 1, 3); R(x - 1, ty - 3, 3, 1); }
    }
    if (bows && w >= 30) for (const cx of [4, w - 5]) {
      const by = h - 6;
      R(cx - 2, by, 2, 2); R(cx + 1, by, 2, 2); R(cx, by, 1, 1); R(cx - 1, by + 2, 1, 2); R(cx + 1, by + 2, 1, 2);
    }
  };
  const NV = P(C.navy, 0.04), NV2 = P(0x26346c, 0.04), WH = P(C.white, 0.03), FRP = FR;
  const SK = (trim, bows) => {
    const s = PLEAT(0x24336a, trim, false), f = PLEAT(0x24336a, trim, bows);
    return { px: s, nx: s, pz: f, nz: s, py: NV, ny: P(0x161e40) };
  };
  part('dress', 4, () => [
    // bodice + white blouse panel + gold buttons
    cu('chest', [-2.9, 10.4, -1.6], [2.9, 13, 1.6], NV),
    cu('chest', [-0.75, 10.5, 1.55], [0.75, 12.9, 1.7], WH),
    cu('chest', [-0.2, 11.5, 1.68], [0.2, 11.9, 1.8], P(C.gold, 0.06)),
    cu('chest', [-0.2, 10.8, 1.68], [0.2, 11.2, 1.8], P(C.gold, 0.06)),
    // white collar + navy bow tie
    cu('chest', [-2.2, 12.7, -1.4], [2.2, 13.3, 1.75], WH),
    cu('chest', [-0.45, 12.1, 1.75], [0.45, 12.9, 2.05], P(0x18214a, 0.03)),
    cu('chest', [-1.7, 12.0, 1.7], [-0.4, 13.05, 1.95], NV2),
    cu('chest', [0.4, 12.0, 1.7], [1.7, 13.05, 1.95], NV2),
    cu('chest', [-0.75, 11.0, 1.72], [-0.25, 12.1, 1.9], NV2, { rot: { axis: 'z', angle: -12, origin: [-0.5, 12.1, 1.8] } }),
    cu('chest', [0.25, 11.0, 1.72], [0.75, 12.1, 1.9], NV2, { rot: { axis: 'z', angle: 12, origin: [0.5, 12.1, 1.8] } }),
    // waist (navy band), hip filler
    cu('spine', [-2.6, 9, -1.5], [2.6, 10.6, 1.5], NV),
    cu('hips', [-2.4, 7, -1.4], [2.4, 9.2, 1.4], NV),
    // bell skirt: three widening tiers
    cu('skirt', [-3.6, 8.1, -2.6], [3.6, 9.6, 2.6], SK(false)),
    cu('skirt', [-4.4, 6.8, -3.3], [4.4, 8.2, 3.3], SK(false, true)),
    cu('skirt', [-5.3, 5.5, -4.0], [5.3, 6.9, 4.0], SK(true)),
    // white petticoat frill (two layers) under the hem
    ...ring('skirt', -5.2, 5.2, -3.9, 3.9, 4.85, 5.7, 0.9, FRP),
    ...ring('skirt', -4.9, 4.9, -3.6, 3.6, 4.5, 5.05, 0.8, FRP),
    // big white back bow at the small of the back (knot, two loops, two tails), below the hair tips
    // (sits outside the mid tier's back face so it reads below the hair tips)
    cu('skirt', [-0.8, 7.6, -4.15], [0.8, 9.1, -3.3], WH),
    cu('skirt', [-4.0, 7.1, -4.0], [-0.6, 9.7, -3.35], P(0xf3f4fa, 0.04), { rot: { axis: 'z', angle: -10, origin: [-0.6, 8.4, -3.7] } }),
    cu('skirt', [0.6, 7.1, -4.0], [4.0, 9.7, -3.35], P(0xf3f4fa, 0.04), { rot: { axis: 'z', angle: 10, origin: [0.6, 8.4, -3.7] } }),
    cu('skirt', [-3.1, 4.9, -4.5], [-2.0, 7.8, -4.05], P(0xeef0f8, 0.04), { rot: { axis: 'z', angle: -8, origin: [-2.5, 7.8, -4.3] } }),
    cu('skirt', [2.0, 4.9, -4.5], [3.1, 7.8, -4.05], P(0xeef0f8, 0.04), { rot: { axis: 'z', angle: 8, origin: [2.5, 7.8, -4.3] } }),
  ]);
  G._h.ring = ring; G._h.FR = FR;
  // ---- apron: short bib, frilled straps over the shoulders, sash, stepped skirt panel, whale emblem -------
  const APR = whale => (g, w, h) => {
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      g.fillStyle = rgb(C.white, 1 - 0.035 * hsh(x, y, 11) - 0.04 * (y / h)); g.fillRect(x, y, 1, 1);
    }
    if (!whale) return;
    const ox = Math.round(w * 0.6), oy = h - 5;
    g.fillStyle = rgb(0x3d70d4, 1);
    g.fillRect(ox + 1, oy + 1, 5, 1); g.fillRect(ox, oy + 2, 7, 1); g.fillRect(ox + 1, oy + 3, 5, 1);
    g.fillRect(ox + 7, oy + 1, 1, 2); g.fillRect(ox + 8, oy, 1, 2);
    g.fillStyle = rgb(0x8fd0ff, 1); g.fillRect(ox + 2, oy - 1, 1, 1); g.fillRect(ox + 1, oy - 2, 1, 1); g.fillRect(ox + 3, oy - 2, 1, 1);
    g.fillStyle = rgb(0xffffff, 1); g.fillRect(ox + 2, oy + 2, 1, 1);
  };
  const AW = { all: APR(false), pz: APR(false) }, ST = FR;
  part('apron', 4, () => [
    // bib + frilled straps (front, over the shoulder, back)
    cu('chest', [-1.6, 10.4, 1.6], [1.6, 11.35, 1.78], AW),
    ...sym([
      cu('chest', [1.6, 10.4, 1.6], [2.35, 13.05, 1.95], ST),
      cu('chest', [1.6, 12.95, -1.9], [2.35, 13.3, 1.95], ST),
      cu('chest', [1.6, 10.4, -1.95], [2.35, 13.05, -1.6], ST),
    ]),
    // sash around the waist + tie under the back bow
    cu('spine', [-2.75, 9.0, -1.65], [2.75, 9.9, 1.65], WH),
    // skirt panel: three steps that follow the bell, side frills, scalloped bottom frill
    cu('skirt', [-2.7, 8.1, 2.6], [2.7, 9.1, 2.78], AW),
    cu('skirt', [-3.2, 6.15, 3.3], [3.2, 8.2, 3.48], { all: APR(false), pz: APR(true) }),
    ...sym([
      cu('skirt', [2.7, 8.1, 2.6], [3.05, 9.1, 2.95], ST),
      cu('skirt', [3.2, 6.15, 2.95], [3.55, 8.2, 3.65], ST),
    ]),
    ...ring('skirt', -3.5, 3.5, 3.3, 3.55, 5.7, 6.25, 0.7, FR, 'f'),
  ]);
  // ---- arms: navy puff sleeves, navy forearm sleeves, white frill cuffs (maid) ---------------------------
  const PUFF = { all: P(0x22306a, 0.05), py: P(0x34489a, 0.05), ny: P(0x161e40) };
  part('arms', 4, () => sym([
    cu('armL', [2.7, 10.2, -1.3], [4.8, 12.95, 1.3], PUFF),
    cu('armL', [2.9, 9.95, -1.1], [4.6, 10.4, 1.1], FR, { shadow: false }),
    cu('forearmL', [3.05, 8.9, -0.8], [4.45, 10.3, 0.8], P(0x1e2a5c, 0.04)),
    cu('forearmL', [2.8, 8.15, -1.05], [4.7, 9.05, 1.05], FR),
    ...ring('forearmL', 2.85, 4.65, -1.0, 1.0, 7.95, 8.45, 0.6, FR),
  ]));
  // ---- skin: hands (+ head and neck, see below) ---------------------------------------------------------
  const SKN = P(C.skin, 0.03);
  const skinCubes = () => sym([
    cu('handL', [3.15, 6.95, -0.6], [4.35, 8.25, 0.6], SKN),
    cu('handL', [3.0, 7.55, 0.2], [3.45, 8.1, 0.75], SKN),
  ]);
  // fallback face (until 39-face exists): big blue eyes, small open smile, blush — painted on the head front
  const FACE = (g, w, h) => {
    const u = w / 8;          // texels per px
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { g.fillStyle = rgb(C.skin, 1 - 0.02 * hsh(x, y, 5)); g.fillRect(x, y, 1, 1); }
    const R = (c, x, y, ww, hh) => { g.fillStyle = typeof c === 'string' ? c : rgb(c, 1); g.fillRect(Math.round(x * u), Math.round(y * u), Math.max(1, Math.round(ww * u)), Math.max(1, Math.round(hh * u))); };
    for (const [ex, side] of [[1.0, -1], [5.0, 1]]) {
      R(0x1b2147, ex + 0.25, 3.3, 1.5, 0.25);                    // thin lash line
      R(0x1b2147, side < 0 ? ex : ex + 1.75, 3.45, 0.25, 0.3);   // outer flick
      R(0x2a4aa0, ex + 0.25, 3.55, 1.5, 2.2);                    // iris (dark top → bright bottom)
      R(0x2a4aa0, ex, 3.8, 2.0, 1.75);
      R(0x4a8ef0, ex + 0.25, 4.6, 1.5, 0.95);
      R(0x9ad8ff, ex + 0.5, 5.25, 1.0, 0.4);
      R(0x13204f, ex + 0.75, 4.0, 0.5, 0.75);                    // pupil
      R(0xffffff, ex + 0.25, 3.8, 0.5, 0.5); R(0xffffff, ex + 1.25, 5.0, 0.25, 0.25);  // sparkles
      R('rgba(255,140,150,0.5)', ex - 0.1, 6.0, 1.75, 0.5);      // blush
    }
    R(0x8a3040, 3.5, 6.3, 1.0, 0.45); R(0xe07a80, 3.75, 6.55, 0.5, 0.3);   // small open smile
  };
  // ---- head + neck (skin) ------------------------------------------------------------------------------
  part('skin', 4, () => skinCubes().concat([
    cu('neck', [-0.9, 12.9, -0.9], [0.9, 13.7, 0.9], SKN),
    cu('head', [-4, 13.5, -4], [4, 21.5, 4], { all: SKN, pz: (V3.girlv1Face && V3.girlv1Face.make) ? SKN : FACE }),
  ]));
  // ---- hair: cuboid strands, navy at the top → sky blue at the tips ------------------------------------
  const HS = [[21.5, 0x2c45a0], [17.5, 0x3a5fc0], [13.5, 0x4a80d8], [11, 0x6bbaf2], [9, 0x8fd3f8]];
  const hc = y => { for (let i = 1; i < HS.length; i++) if (y >= HS[i][0]) {
    const [y0, c0] = HS[i - 1], [y1, c1] = HS[i]; return lerpC(c1, c0, Math.min(1, (y - y1) / (y0 - y1))); }
    return HS[HS.length - 1][1]; };
  // vertical gradient by the strand's absolute y + strand shading; band: lit crest → shaded trough per segment (a wave)
  const GR = (top, bot, s, band) => (g, w, h) => {
    for (let y = 0; y < h; y++) { const c = hc(top + (bot - top) * (y + 0.5) / h), v = (y + 0.5) / h;
      const k = band ? 1.07 - 0.2 * v + (v > 0.82 ? -0.05 : 0) : 0.97;
      for (let x = 0; x < w; x++) { g.fillStyle = rgb(c, k - 0.06 * hsh(x, y, s) + (x === 0 ? -0.06 : 0)); g.fillRect(x, y, 1, 1); } }
  };
  // st(bone, x0, x1, z0, z1, top, bot, seed, band) → one strand cube with gradient sides
  const st = (bone, x0, x1, z0, z1, top, bot, s, band) => {
    const sd = GR(top, bot, s || 1, band);
    return cu(bone, [x0, bot, z0], [x1, top, z1], { px: sd, nx: sd, pz: sd, nz: sd, py: P(hc(top), 0.04), ny: P(hc(bot), 0.04) });
  };
  // wv(bone, cx, cz, y, segs, seed): one wavy lock hanging from y. segs = [[len, w, d, dx, dz] …]: each segment moves
  // the lock centre by dx / dz (the zig-zag of the centres is the wave) and overlaps the one above by 0.25 px
  const wv = (bone, cx, cz, y, segs, seed) => segs.map(([len, w, d, dx, dz], j) => {
    cx += dx; cz += dz;
    const c = st(bone, cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, y, y - len, seed + j, j > 0);
    y -= len - 0.25;
    return c;
  });
  part('hair', 4, () => {
    const o = [];
    // cap over the skull (front stops 2 px into the face square), back + side shells
    o.push(st('head', -4.45, 4.45, -4.45, 4.45, 22.3, 19.5, 2));
    o.push(st('head', -4.45, 4.45, -4.45, -3.3, 19.6, 13.6, 3));
    for (const s of [-1, 1]) o.push(st('head', s > 0 ? 4 : -4.45, s > 0 ? 4.45 : -4, -4.4, 3.4, 19.6, 13.6, 4));
    // bangs: strands over the top of the face, uneven tips
    const bl = [19.7, 19.5, 19.85, 19.5, 19.55, 19.85, 19.5, 19.7];
    for (let i = 0; i < 8; i++) o.push(st('head', -4 + i, -3 + i, 4.3, 4.75 + (i % 2) * 0.15, 22.0, bl[i], 20 + i));
    // side locks framing the face (outside the face square), then a wavy lock over each shoulder (before the sleeve)
    for (const s of [-1, 1]) {
      const a = s > 0 ? 4.0 : -4.9, b = s > 0 ? 4.9 : -4.0;
      o.push(st('head', a, b, 2.4, 4.55, 21.2, 15.5, 30));
      o.push(st('head', a + 0.2 * s, b + 0.2 * s, 2.6, 4.3, 15.6, 13.3, 31));
      const sh = [[1.9, 1.0, 1.5, 0.35, -0.75], [1.7, 0.95, 1.3, 0.3, -0.3], [1.2, 0.75, 1.0, -0.25, -0.05]];
      o.push(...wv(s > 0 ? 'hairL' : 'hairR', s * 4.55, 3.35, 13.55, sh.map(g => [g[0], g[1], g[2], s * g[3], g[4]]), s > 0 ? 32 : 36));
    }
    // long side hair: 4 wavy locks per side (front → back), flaring out past the hands; neighbours wave in
    // opposite phase so the outline ripples
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
      const ph = (k + (s > 0 ? 0 : 1)) % 2 ? 1 : -1, cz = 0.3 - k * 1.55;
      const segs = [[3.0, 1.3, 1.8, 0, 0], [2.6, 1.45, 1.9, 0.55 + 0.4 * ph, -0.1], [2.5, 1.55, 1.9, 0.55 - 0.5 * ph, 0],
        [2.4, 1.6, 1.8, 0.6 + 0.5 * ph, -0.1], [2.0 - 0.2 * k, 1.3, 1.5, 0.35 - 0.55 * ph, 0]];
      o.push(...wv(s > 0 ? 'hairL' : 'hairR', s * (4.95 + 0.15 * k), cz, 19.3,
        segs.map(g => [g[0], g[1], g[2], s * g[3], g[4]]), 40 + k * 6 + (s > 0 ? 0 : 30)));
    }
    // long back hair: crown puff + core sheets + 13 wavy strands that fan out (odd ones a layer further back);
    // the centre tips stop above the big back bow, the outer ones hang lower
    o.push(st('hairBack', -4.3, 4.3, -5.3, -4.3, 21.8, 20.4, 57));
    o.push(st('hairBack', -4.75, 4.75, -5.1, -4.2, 20.6, 15.0, 58), st('hairBack', -5.6, 5.6, -5.3, -4.4, 15.2, 10.6, 59));
    for (let i = -6; i <= 6; i++) {
      const a = Math.abs(i), ph = i % 2 ? 1 : -1;
      const tip = (a < 2 ? 10.35 : a < 4 ? 9.7 - 0.3 * (a - 2) : 8.9 - 0.2 * (a - 4)) - 0.3 * hsh(i, 1, 9);
      const L = (20.6 - tip + 0.75) / 4, zb = -4.75 - (i % 2 ? 0.45 : 0) - 0.2 * hsh(i, 2, 9);
      const segs = [0, 1, 2, 3].map(j => [L, j === 3 ? 1.0 : 0.95 + 0.12 * j, 1.25,
        j ? i * 0.12 + ph * (j % 2 ? 0.42 : -0.42) : 0, j ? -0.06 : 0]);
      o.push(...wv('hairBack', i * 0.8, zb, 20.6, segs, 60 + i * 5));
    }
    // ahoge: little curl on top
    const AH = P(0x22337a, 0.04);
    o.push(cu('ahoge', [-0.3, 22.2, 0.1], [0.3, 23.6, 0.7], AH), cu('ahoge', [-0.3, 23.4, 0.5], [0.3, 24.0, 1.7], AH),
      cu('ahoge', [-0.3, 22.9, 1.4], [0.3, 23.6, 2.0], AH));
    return o;
  });
  // ---- headband (maid): white band over the crown, scalloped frill crest, blue side bows -----------------
  part('headband', 4, () => {
    const o = [cu('head', [-4.65, 22.15, -0.3], [4.65, 22.6, 1.1], WH)];
    for (let i = -5; i < 5; i++) {            // crest of frills over the top
      const hi = i % 2 ? 23.05 : 23.35;
      o.push(cu('head', [i * 0.95 + 0.04, 22.4, -0.6], [i * 0.95 + 0.91, hi, 1.4], FR, { shadow: false }));
    }
    o.push(...sym([
      cu('head', [4.4, 19.3, -0.3], [4.75, 22.6, 1.1], WH),                                     // band down the side
      cu('head', [4.55, 20.9, -0.6], [5.25, 21.75, 1.4], FR, { shadow: false }),                // side frills
      cu('head', [4.5, 21.7, -0.6], [5.1, 22.55, 1.4], FR, { shadow: false }),
      cu('head', [4.7, 19.75, 0.1], [5.3, 20.55, 0.75], P(0x2477c9, 0.04)),                    // blue bow knot
      cu('head', [4.6, 19.45, 0.75], [5.1, 20.95, 1.85], P(C.blue, 0.05)),                     // loops
      cu('head', [4.6, 19.45, -1.0], [5.1, 20.95, 0.1], P(C.blue, 0.05)),
    ]));
    return o;
  });
  // ---- whale fins on the sides of the head: navy outside, light inside (always worn) ---------------------
  const FIN = { all: P(0x2a3c7e, 0.04), py: P(0x34488c, 0.04), ny: P(C.pale, 0.04) };
  const FINLT = { all: P(0xdcefff, 0.04), py: P(0xeef7ff, 0.03) };
  part('fins', 4, () => sym([
    cu('finL', [4.2, 17.3, -2.2], [6.0, 19.6, 1.4], FIN),
    cu('finL', [5.9, 17.2, -1.9], [7.3, 19.2, 1.0], FIN),
    cu('finL', [7.2, 17.1, -1.5], [8.4, 18.7, 0.6], FIN),
    cu('finL', [8.3, 17.0, -1.1], [9.2, 18.1, 0.1], FIN),
    cu('finL', [4.4, 16.85, -1.8], [6.0, 17.35, 1.1], FINLT),     // light underside
    cu('finL', [5.9, 16.75, -1.6], [7.3, 17.25, 0.7], FINLT),
    cu('finL', [7.2, 16.7, -1.2], [8.4, 17.15, 0.3], FINLT),
  ]));
  // ---- whale tail: 3 segments (navy top, white belly), frill at the root, flared fluke --------------------
  const TN = { all: P(0x26366f, 0.04), py: P(0x30447f, 0.04) }, TB = P(0xf2f4fa, 0.03);
  const TF = { all: P(0x26366f, 0.04), py: P(0x30447f, 0.04), ny: P(0xe8ecf6, 0.03) };
  part('tail', 4, () => [
    cu('tail1', [-1.6, 5.0, -5.8], [1.6, 7.6, -2.0], TN),
    cu('tail1', [-1.3, 4.5, -5.7], [1.3, 5.1, -2.2], TB),
    // frill cuff where the tail leaves the skirt
    cu('tail1', [-1.9, 4.25, -4.95], [1.9, 7.9, -4.25], FR),
    ...[[-1.3, 7.85], [0, 7.95], [1.3, 7.85], [-1.9, 6.2], [1.9, 6.2], [-0.8, 4.2], [0.8, 4.2]].map(([x, y]) =>
      cu('tail1', [x - 0.45, y - 0.45, -5.3], [x + 0.45, y + 0.45, -4.85], FR, { shadow: false })),
    // shorter chain (≈10.5 px) with joint blocks so the curl reads smooth instead of stair-stepped
    cu('tail2', [-1.5, 4.9, -5.9], [1.5, 7.5, -4.9], TN),
    cu('tail2', [-1.35, 5.1, -8.2], [1.35, 7.3, -5.2], TN),
    cu('tail2', [-1.1, 4.65, -8.1], [1.1, 5.2, -5.3], TB),
    cu('tail3', [-1.15, 5.05, -8.5], [1.15, 7.05, -7.5], TN),
    cu('tail3', [-1.0, 5.25, -9.9], [1.0, 6.85, -7.8], TN),
    cu('tail3', [-0.8, 4.85, -9.8], [0.8, 5.35, -7.9], TB),
    // fluke: centre + flared lobes (wide in x; the tail3 curl stands it up into a V)
    cu('tail3', [-0.9, 5.35, -11.0], [0.9, 6.45, -9.6], TF),
    ...sym([
      cu('tail3', [0.6, 5.45, -11.5], [2.6, 6.35, -10.0], TF),
      cu('tail3', [2.4, 5.5, -12.4], [3.7, 6.3, -11.0], TF),
      cu('tail3', [3.5, 5.55, -13.1], [4.4, 6.25, -11.8], TF),
    ]),
  ]);
  // ---- pyjama: light-blue top + trousers with white dots, white trims, nightcap with a pompom ------------
  const DOTS = (g, w, h) => {
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      const dot = (y % 8 < 2) && ((x + (Math.floor(y / 8) % 2) * 4) % 8 < 2);
      g.fillStyle = dot ? rgb(0xffffff, 0.98) : rgb(C.pj, 0.95 + 0.05 * hsh(x, y, 13)); g.fillRect(x, y, 1, 1);
    }
  };
  const PJ = { all: DOTS, ny: P(0x86b6dc) };
  part('pyjama', 4, () => [
    cu('chest', [-2.95, 10.4, -1.65], [2.95, 13, 1.65], PJ),
    cu('spine', [-2.8, 9.0, -1.6], [2.8, 10.6, 1.6], PJ),
    cu('hips', [-3.0, 7.4, -1.8], [3.0, 9.2, 1.8], PJ),
    cu('chest', [-2.2, 12.7, -1.45], [2.2, 13.3, 1.8], WH),
    ...[12.0, 11.0, 10.0, 9.0].map(y => cu(y > 10.4 ? 'chest' : 'spine', [-0.25, y, 1.6], [0.25, y + 0.5, 1.75], WH)),
    ...sym([
      cu('armL', [2.75, 9.6, -1.15], [4.65, 12.95, 1.15], PJ),
      cu('forearmL', [2.95, 8.55, -0.9], [4.55, 10.2, 0.9], PJ),
      cu('forearmL', [2.85, 8.15, -1.0], [4.65, 8.65, 1.0], WH),
      cu('legL', [0.05, 3.9, -1.2], [2.45, 7.9, 1.2], PJ),
      cu('shinL', [0.05, 1.45, -1.18], [2.45, 4.1, 1.18], PJ),
      cu('shinL', [0.0, 1.05, -1.22], [2.5, 1.55, 1.22], WH),
    ]),
  ]);
  const CAP = { all: DOTS, ny: P(0x86b6dc) };
  part('nightcap', 4, () => [
    cu('head', [-4.75, 21.15, -4.75], [4.75, 22.25, 5.05], P(0xffffff, 0.08)),   // fluffy band
    cu('head', [-4.35, 22.2, -4.35], [4.35, 23.5, 4.35], CAP),
    cu('head', [-3.4, 23.4, -3.5], [3.2, 24.4, 3.0], CAP),
    cu('head', [-1.6, 24.3, -2.4], [2.2, 25.1, 1.4], CAP),
    cu('head', [1.6, 23.6, -2.0], [3.9, 24.9, 0.9], CAP),
    cu('head', [3.6, 22.4, -1.7], [4.9, 24.0, 0.3], CAP),
    cu('head', [4.1, 21.2, -1.9], [5.7, 22.8, -0.3], P(0xffffff, 0.1)),           // pompom
  ]);
  // @@PARTS@@

  // ---- v3: 组装（身体 + 每个部件 + 像素脸）-----------------------------------------------------------------------
  // make({ parent, scale }) → { root, bones, built, unit, parts: { 部件名: [meshes] }, face, outfit(n), shoes(n), hold(obj, hand) }
  G.make = function (opts) {
    opts = opts || {};
    const CB = V3.cuboid, sc = opts.scale == null ? 1 : +opts.scale;
    const built = CB.build(defOf('body'), { parent: opts.parent, scale: sc });
    const g = { root: built.root, bones: built.bones, built, unit: built.unit, parts: { body: built.meshes.slice() } };
    for (const n in G.parts) if (n !== 'body') {
      try { g.parts[n] = graft(g, CB.build(defOf(n), { scale: sc })); } catch (e) { V3.err('girlv1 part ' + n + ': ' + ((e && e.message) || e)); g.parts[n] = []; }
    }
    g.show = (n, v) => (g.parts[n] || []).forEach(m => { m.visible = v; });
    const u = built.unit, hb = g.bones.head, FM = V3.girlv1Face;
    g.face = null;
    if (FM && FM.make) {        // 像素脸：头正面 8×8 px 方块的中心，往外 0.05 px
      try {
        const f = FM.make({ density: 4 });
        f.group.position.set(0, (17.5 - 13.5) * u, (4 + 0.05) * u);
        f.group.scale.setScalar(u * 16);
        hb.add(f.group);
        g.face = f;
      } catch (e) { V3.err('girlv1 face: ' + ((e && e.message) || e)); }
    }
    // 衣服 / 鞋：每个部件只建一次，切换只改 visible
    const MAID = ['dress', 'apron', 'headband', 'arms'], PJS = ['pyjama', 'nightcap'];
    g.outfit = name => {
      const pj = name === 'pyjama';
      MAID.forEach(n => g.show(n, !pj)); PJS.forEach(n => g.show(n, pj));
      g.outfitName = pj ? 'pyjama' : 'maid';
      V3.emit('girlv1:outfit', g.outfitName);
      return g.outfitName;
    };
    g.shoes = name => {
      const n = name === 'slippers' || name === 'none' ? name : 'maryjane';
      g.show('maryjane', n === 'maryjane'); g.show('slippers', n === 'slippers');
      g.shoesName = n;
      return n;
    };
    // hold(obj | null, hand = 'R')：东西挂在手心（手骨骼支点 = 手腕）
    g.held = null;
    g.hold = (obj, hand) => {
      if (g.held && g.held.parent) g.held.parent.remove(g.held);
      g.held = obj || null;
      if (!obj) return null;
      g.bones[hand === 'L' ? 'handL' : 'handR'].add(obj);
      obj.position.set(0, -0.75 * u, 0.35 * u);
      return obj;
    };
    g.outfit('maid'); g.shoes('maryjane');
    return g;
  };

  // ---- 反馈部位：小鲸鱼/<部件>/<骨骼>，每个网格一个 anchor；脸只有最前面那层能点，按 uv 分 眼睛 / 嘴 / 腮红 ----------
  const PART_CN = { body: '腿', maryjane: '鞋', slippers: '拖鞋', dress: '裙子', apron: '围裙', arms: '袖子', skin: '皮肤',
    hair: '头发', headband: '头饰', fins: '鲸鳍耳', tail: '尾巴', pyjama: '睡衣', nightcap: '睡帽' };
  const BONE_CN = { root: '身体', hips: '胯', spine: '腰', chest: '上身', neck: '脖子', head: '头', ahoge: '呆毛', hairBack: '后发',
    hairL: '左侧发', hairR: '右侧发', finL: '左鳍耳', finR: '右鳍耳', armL: '左上臂', forearmL: '左前臂', handL: '左手',
    armR: '右上臂', forearmR: '右前臂', handR: '右手', skirt: '裙摆', legL: '左大腿', shinL: '左小腿', legR: '右大腿', shinR: '右小腿',
    tail1: '尾巴根', tail2: '尾巴中段', tail3: '尾鳍' };
  const ROOT = '小鲸鱼';
  function tagParts(g, pre) {
    const P = V3.parts, used = new Set(), paths = [];
    const tag = (m, path) => { if (P && P.tag) P.tag(m, path); else m.userData.part = path; paths.push(path); };
    for (const n in g.parts) for (const m of g.parts[n]) {
      const bone = m.parent ? m.parent.name : 'root';
      let a = pre + n + ':' + bone, i = 2;
      while (used.has(a)) a = pre + n + ':' + bone + ':' + i++;
      used.add(a); m.userData.anchor = a; m.name = a;
      tag(m, ROOT + '/' + (PART_CN[n] || n) + '/' + (BONE_CN[bone] || bone));
    }
    const f = g.face;
    if (f) {
      const Ly = f.layers, face = ROOT + '/脸', mm = Ly.mouth.mesh;
      for (const k of ['blush', 'eyes']) { Ly[k].mesh.userData.noPick = true; Ly[k].mesh.userData.anchor = pre + 'face:' + k; }
      mm.userData.anchor = pre + 'face';
      mm.userData.resolveHit = (hit) => {          // 设计网格 32×32：嘴 (12..19, 25..29)、腮红 (3..9 / 22..28, 22..25)、眼睛 (4..11 / 20..27, 8..22)
        const uv = hit && hit.uv;
        if (!uv) return face;
        const x = uv.x * 32, y = (1 - uv.y) * 32;
        if (y >= 24 && y < 31 && x >= 11 && x < 21) return face + '/嘴';
        if (y >= 22.5 && y < 26 && (x < 10.5 || x >= 21.5)) return face + '/腮红';
        if (y >= 7 && y < 24 && ((x >= 2 && x < 13) || (x >= 19 && x < 30))) return face + '/眼睛';
        return face;
      };
      tag(mm, face);
      paths.push(face + '/眼睛', face + '/嘴', face + '/腮红');
    }
    if (P && P.declare) P.declare(paths);
  }

  // ---- v3 接口：65-girl-actor 和工作台模型 girlv1 共用（约定见 docs/接入新小鲸鱼.md 第 2 节）-------------------------
  // actor 的表情名 → v1 脸的预设；v1 独有的几种在工作台里也能选
  const EXPR_TO_V1 = { happy: 'neutral', laugh: 'laugh', surprised: 'surprised', neutral: 'neutral', pout: 'pout', talk: 'neutral',
    v1happy: 'happy', smile: 'smile', sleepy: 'sleepy', asleep: 'asleep', sad: 'sad', shy: 'shy', focus: 'focus' };
  const EXPRS = [['happy', '开心（默认）'], ['laugh', '大笑'], ['surprised', '惊讶'], ['neutral', '平静'], ['pout', '气鼓鼓'], ['talk', '说话'],
    ['v1happy', '>ω<'], ['smile', '眯眼笑'], ['sleepy', '困'], ['asleep', '睡着'], ['sad', '难过'], ['shy', '害羞'], ['focus', '专心']];
  const POSES = [['stand', '站立'], ['walk', '走路'], ['pickup', '蹲下捡'], ['cheer', '欢呼'], ['huddle', '缩着坐']];
  const POSE_CLIP = { pickup: 'pickHold', cheer: 'cheer', huddle: 'huddle' };
  // actor 的动画时钟：腿摆一个来回 = 2π/6（旧版 20-girl 的 sin(t·6)）；v1 的 walk 一个来回 0.6 s
  const WALK_K = 0.6 / (2 * Math.PI / 6);
  G.HEIGHT_PX = 24;                                  // 呆毛顶（模型 px）
  G.VIEWS = {
    front: { az: 0, el: 0.06, dist: 3.0, target: [0, 0.65, 0] },
    side: { az: Math.PI / 2, el: 0.06, dist: 3.0, target: [0, 0.65, 0] },
    back: { az: Math.PI, el: 0.06, dist: 3.0, target: [0, 0.65, 0] },
    q34: { az: 0.6, el: 0.15, dist: 3.1, target: [0, 0.65, 0] },
    face: { az: 0, el: 0.05, dist: 1.35, target: [0, 0.95, 0] },
  };
  // build({ height = layout.girlH || 1.3, anchor = 'girlv1:', studio }) → inst
  G.build = function (opts) {
    opts = opts || {};
    const L = V3.layout || {}, H = opts.height || L.girlH || 1.3, scale = H / (G.HEIGHT_PX / 16);
    const g = G.make({ scale });
    const root = new THREE.Group(); root.name = 'girlv1'; root.add(g.root);
    tagParts(g, opts.anchor || 'girlv1:');
    const player = g.player = V3.cuboid.player(g.built), A = V3.girlv1Anim;
    if (A && A.drive) A.drive(g);                  // 呼吸、尾巴、头发 / 裙摆 / 鳍耳跟随、片段里的表情帧
    player.play('g.idle', { fade: 0 });
    const u = g.unit, b = g.bones;
    let clock = 0, lastT = null, exprCur = null, talking = false, clipCur = '';
    const clipOpts = [['', '（跟着动作走）']].concat(((A && A.names) || []).map(n => [n, ((A && A.CN) || {})[n] || n]));
    const inst = {
      id: 'girlv1', label: '小鲸鱼', root, partRoot: ROOT, bones: b, g, player,
      face: g.face ? { mesh: g.face.layers.mouth.mesh } : null,
      states: {
        expr: { label: '表情', options: EXPRS, value: 'happy' },
        pose: { label: '动作', options: POSES, value: 'stand' },
        clip: { label: '片段', options: clipOpts, value: '' },
        outfit: { label: '衣服', options: [['maid', '女仆装'], ['pyjama', '睡衣']], value: 'maid' },
        shoes: { label: '鞋', options: [['maryjane', '玛丽珍鞋'], ['slippers', '拖鞋'], ['none', '光脚']], value: 'maryjane' },
      },
      views: G.VIEWS, poseK: null,
      // 65-girl-actor 的 makeBody 读这些：腿长 / 摆幅（算步幅，脚不打滑）、右手心、撑伞的手臂姿势
      leg: 7.5 * u, swing: 28 * Math.PI / 180, handBone: b.handR, handOff: new THREE.Vector3(0, -0.75 * u, 0.35 * u),
      umbArm: [-0.5, 0, -0.75], umbFore: [-1.4, 0, 0.3],   // 撑伞：右臂往外侧抬、前臂竖起来，手在脸的右边（伞杆贴着头往上，不挡脸）
      setState(k, v) {
        if (!this.states[k]) return;
        this.states[k].value = v;
        if (k === 'outfit') g.outfit(v); else if (k === 'shoes') g.shoes(v);
      },
      // update(dt, t)：actor 传自己的动画时钟 t（走路时按步速加快）；工作台传 R.t
      update(dt, t) {
        dt = Math.max(0, +dt || 0);
        let da = t != null && lastT != null ? t - lastT : dt;
        lastT = t;
        if (!(da >= 0) || da > 0.5) da = dt;
        clock += dt;
        const st = inst.states, pose = st.pose.value, clip = st.clip.value;
        const k = inst.poseK == null ? 1 : Math.max(0, Math.min(1, inst.poseK));
        if (clip) {                                // 工作台：单独播一个片段
          if (clip !== clipCur) { player.play('g.' + clip, { layer: 0, fade: 0.2, restart: true }); player.play(null, { layer: 1, weight: null, fade: 0.15 }); clipCur = clip; }
          player.update(dt);
        } else {
          clipCur = '';
          const fd = dt > 0 ? 1 : 0;               // dt = 0（量伸手位置、换身体、暂停）：直接切过去，不留半截过渡
          player.play(pose === 'walk' ? 'g.walk' : 'g.idle', { layer: 0, fade: 0.25 * fd });
          const over = POSE_CLIP[pose];
          if (over) player.play('g.' + over, { layer: 1, weight: k, fade: 0 });
          else player.play(null, { layer: 1, weight: null, fade: 0.2 * fd });
          player.update(pose === 'walk' && !opts.studio ? da * WALK_K : dt);
        }
        const f = g.face;
        if (f) {
          if (!clip) {
            const e = st.expr.value, v1 = EXPR_TO_V1[e] || 'neutral';
            if (v1 !== exprCur) { f.expr(v1); exprCur = v1; if (e === 'happy') f.blush(0.35); }
            const tk = e === 'talk';
            if (tk !== talking) { f.talk(tk); talking = tk; }
          } else exprCur = null;
          f.update(clock, dt);
        }
      },
      dispose() {
        if (A && A._driven === g && A._off) { A._off(); A._off = null; A._driven = null; }
        if (g.face) g.face.dispose();
        const geos = new Set(), mats = new Set(), texs = new Set();
        root.traverse(o => {
          if (!o.isMesh) return;
          geos.add(o.geometry);
          for (const m of [].concat(o.material)) { mats.add(m); if (m.map) texs.add(m.map); }
        });
        geos.forEach(x => x.dispose()); mats.forEach(x => x.dispose()); texs.forEach(x => x.dispose());
      },
    };
    return inst;
  };

  // 工作台模型「小鲸鱼」：看造型、33 个动作片段、表情、衣服；反馈部位和游戏里一样
  if (V3.models && V3.models.register) V3.models.register({ id: 'girlv1', label: '小鲸鱼', build: () => G.build({ studio: true }) });
})(window.V3);
