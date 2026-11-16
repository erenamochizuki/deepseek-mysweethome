// 20-girlv1-face.js — v1 小鲸鱼的像素脸，移植自 v1 的 39-face.js。V3.girlv1Face.make({ density }) → three cutout planes
// (back → front: blush, eyes, mouth) covering the head's 8×8 px front square, centred on the group origin,
// facing +z, in metres (1 px = 1/16 m). Each layer is a small canvas (8·density texels square) that is redrawn
// only when its state changes; expressions, auto blink, talking and gaze are driven from this module's tick.
(function (V3) {
'use strict';
V3.girlv1Face = V3.girlv1Face || {};
(function () {
  const F = V3.girlv1Face;
  const PX = 1 / 16;                                   // metres per model px
  const C = { skin: 0xffe1d9, lash: 0x1b2147, navy: 0x1e2a56, ind: 0x3a5aa9, sky: 0x6fc3f5, pale: 0xb8e6f8,
    white: 0xffffff, blush: 0xff9aa6, cheek: 0xffc4c4, mD: 0x7a2a3a, mL: 0xe0707c, tongue: 0xf5a0a8 };
  F.C = C;
  F.EXPR = ['neutral', 'happy', 'smile', 'laugh', 'pout', 'sleepy', 'asleep', 'surprised', 'sad', 'shy', 'focus'];
  F.EYES = ['open', 'half', 'closed', 'happy', 'wide', 'sleepy', 'angry', 'wink', 'sad', 'focus'];
  F.MOUTHS = ['smile', 'flat', 'open', 'o', 'a', 'i', 'u', 'e', 'o_', 'pout', 'sleep', 'w', 'grin', 'wide', 'frown'];
  const hasDoc = typeof document !== 'undefined';

  // one layer = canvas + nearest sRGB texture + cutout plane (8×8 px, MeshStandardMaterial) at z (px) in front of the group
  function layer(d, z, name) {
    const n = 8 * d;
    const cv = hasDoc ? document.createElement('canvas') : { width: n, height: n, getContext: () => null };
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const off = { blush: 1, eyes: 2, mouth: 3 }[name] || 1;
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.85, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -off, polygonOffsetUnits: -2 * off });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8 * PX, 8 * PX), mat);
    mesh.name = 'face.' + name; mesh.position.z = z * PX;
    mesh.userData.noShadow = true; mesh.userData.noReflect = true;
    return { n, d, cv, g, tex, mat, mesh, key: '' };
  }
  F._layer = layer;

  // V3.girlv1Face.make({ density = 4 }) → { group, eyes(n), mouth(n), blush(v), look(x, y), expr, talk, blink, set, state }
  F.make = function (opts) {
    opts = opts || {};
    const d = Math.max(1, Math.round(opts.density || 4));
    const group = new THREE.Group(); group.name = 'face';
    const L = { blush: layer(d, 0, 'blush'), eyes: layer(d, 0.02, 'eyes'), mouth: layer(d, 0.04, 'mouth') };
    group.add(L.blush.mesh, L.eyes.mesh, L.mouth.mesh);
    const f = { group, layers: L, d };
    f.update = () => {};
    f.dispose = () => { for (const k in L) { L[k].tex.dispose(); L[k].mat.dispose(); L[k].mesh.geometry.dispose(); } };
    if (F._api) F._api(f);                            // methods + state machine (defined further down this file)
    return f;
  };

  // v3: no module tick here — the owner (20-girlv1.js) calls f.update(t, dt) every frame
})();
// ---------------------------------------------------------------- pens + eyes (design grid: 32 texels = density 4)
(function () {
  const F = V3.girlv1Face, C = Object.assign(F.C, { mid: 0x4a8ef0, pupil: 0x13204f });
  const hex = c => '#' + (c >>> 0).toString(16).padStart(6, '0');
  const mix = (a, b, t) => [16, 8, 0].reduce((o, s) => o | (Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s), 0);
  F.hex = hex; F.mix = mix;
  // pen(layer): clear() wipes it; px(c, x, y, w, h) paints design texels (scaled when density ≠ 4)
  F.pen = function (Ly) {
    const g = Ly.g, s = Ly.n / 32;
    return {
      clear() { if (!g) return; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, Ly.n, Ly.n); g.setTransform(s, 0, 0, s, 0, 0); },
      px(c, x, y, w, h) { if (!g) return; g.fillStyle = typeof c === 'string' ? c : hex(c); g.fillRect(x, y, w || 1, h || 1); },
      list(c, pts, ox, oy, X) { for (const [x, y] of pts) this.px(c, X ? X(x) : ox + x, oy + y); },
    };
  };
  // Eye box: 8 cols × 10 rows, local col 0 = outer corner, col 7 = inner (mirrored for the screen-right eye).
  // Open-type eyes are parametric: top = lid row (0 = fully open), slant = rows the inner end drops, inset = small iris.
  const EYE = F.EYE = {
    open:   { L: { top: 0 } },
    half:   { L: { top: 3 } },
    sleepy: { L: { top: 5, slant: -1 } },
    focus:  { L: { top: 2, slant: 1 } },
    angry:  { L: { top: 1, slant: 2 }, brow: 'angry' },
    sad:    { L: { top: 1, slant: -2 }, brow: 'sad' },
    wide:   { L: { top: -1, inset: 1 }, brow: 'up' },
    closed: { L: 'closed' },
    happy:  { L: 'chev' },                              // > <  (the >ω< face)
    joy:    { L: 'joy' },                               // ^ ^  closed smiling arcs
    wink:   { L: { top: 0 }, R: 'joy' },
  };
  F.CLOSED = { closed: 1, happy: 1, joy: 1, wink: 1 };  // no auto blink on these
  const LINES = {
    closed: [[-1, 4], [0, 5], [7, 5], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6], [2, 7], [3, 7], [4, 7], [5, 7]],
    joy: [[2, 4], [3, 4], [4, 4], [5, 4], [1, 5], [2, 5], [5, 5], [6, 5], [0, 6], [1, 6], [6, 6], [7, 6], [0, 7], [7, 7]],
    chev: [[0, 2], [1, 2], [1, 3], [2, 3], [3, 3], [3, 4], [4, 4], [5, 4], [5, 5], [6, 5], [3, 6], [4, 6], [5, 6],
      [1, 7], [2, 7], [3, 7], [0, 8], [1, 8]],
  };
  const BROW = {
    angry: [[1, -4], [2, -4], [3, -3], [4, -3], [5, -2], [6, -2]],
    sad: [[1, -2], [2, -2], [3, -3], [4, -3], [5, -4], [6, -4]],
    up: [[1, -4], [2, -5], [3, -5], [4, -5], [5, -5], [6, -4]],
  };
  // iris rows 1..9: indigo top (kept lighter than the lash so open eyes don't read as half-lidded) → sky → pale
  const IRIS = [C.ind, C.ind, C.ind, C.mid, C.mid, C.sky, C.sky, C.sky, C.pale];

  function openEye(p, X, oy, o, lx, ly) {
    const top = o.top || 0, sl = o.slant || 0, ins = o.inset || 0;
    const lid = x => top + Math.round(sl * x / 7);
    const edge = x => x === 0 || x === 7;
    const inside = (x, y) => x >= 0 && x <= 7 && y > lid(x) + (edge(x) ? 1 : 0) && y <= (edge(x) ? 8 : 9);
    for (let x = 0; x < 8; x++) for (let y = lid(x) + 1; y <= 9; y++) if (inside(x, y)) p.px(C.white, X(x), oy + y);
    const ip = (c, x, y) => { const xx = x + lx, yy = y + ly; if (inside(xx, yy)) p.px(c, X(xx), oy + yy); };
    for (let y = 1 + ins; y <= 9 - ins; y++) for (let x = 1 + ins; x <= 6 - ins; x++) {
      if ((y === 1 + ins || y === 9 - ins) && (x === 1 + ins || x === 6 - ins)) continue;   // rounded corners
      ip(y === 9 - ins && (x < 2 + ins || x > 5 - ins) ? C.sky : IRIS[y - 1], x, y);
    }
    if (ins) { ip(C.pupil, 3, 4); ip(C.pupil, 4, 4); ip(C.pupil, 3, 5); ip(C.pupil, 4, 5); ip(C.white, 2, 3); }
    else {
      for (let y = 3; y <= 6; y++) { ip(C.pupil, 3, y); ip(C.pupil, 4, y); }
      ip(C.white, 1, 2); ip(C.white, 2, 2); ip(C.white, 1, 3); ip(C.white, 2, 3); ip(C.white, 5, 7);
    }
    for (let x = 0; x < 8; x++) {                                  // upper lid lash, 2 rows (1 at the inner corner)
      p.px(C.lash, X(x), oy + lid(x));
      if (x < 7) p.px(C.lash, X(x), oy + lid(x) - 1);
    }
    p.px(C.lash, X(-1), oy + lid(0)); p.px(C.lash, X(-1), oy + lid(0) + 1); p.px(C.lash, X(0), oy + lid(0) + 1);
  }

  // drawEyes(layer, name, lx, ly): both eyes; (lx, ly) = gaze offset in design texels (+x screen right, +y down)
  // brow (optional) overrides the shape's own brow, so a blink keeps the expression's brows
  F.drawEyes = function (Ly, name, lx, ly, brow) {
    const p = F.pen(Ly), e = EYE[name] || EYE.open, oy = 13, bw = brow === undefined ? e.brow : brow;
    p.clear();
    [[4, false], [20, true]].forEach(([ox, mir], i) => {
      const X = x => mir ? ox + 7 - x : ox + x;
      const sh = (i === 1 && e.R) ? e.R : e.L;
      if (typeof sh === 'string') p.list(C.lash, LINES[sh], 0, oy, X);
      else openEye(p, X, oy, sh, mir ? -lx : lx, ly);
      if (bw) p.list(C.navy, BROW[bw], 0, oy, X);
    });
  };
})();
// ---------------------------------------------------------------- mouths + blush
(function () {
  const F = V3.girlv1Face, C = Object.assign(F.C, { mD: 0x6a2030, mIn: 0xa8384a, tongue: 0xf08a96, hatch: 0xf06a80 });
  // 8-wide grids, top-left at design texel (12, 25): d outline, m inside, t tongue, w teeth
  const M = F.MOUTH = {
    smile: [' d    d ', '  dddd  '],
    flat:  ['  dddd  '],
    open:  [' dddddd ', ' dmmmmd ', '  dttd  ', '   dd   '],
    a:     [' dddddd ', 'dmmmmmmd', 'dmmmmmmd', ' dmttmd ', '  dddd  '],
    grin:  ['dddddddd', 'dmmmmmmd', 'dmmmmmmd', ' dmttmd ', '  dddd  '],
    i:     ['dddddddd', 'dwwwwwwd', ' dddddd '],
    u:     ['   dd   ', '  dmmd  ', '   dd   '],
    e:     [' dddddd ', ' dmmmmd ', '  dddd  '],
    o:     ['  dddd  ', ' dmmmmd ', ' dmmmmd ', '  dddd  '],
    o_:    ['   dd   ', '  dmmd  ', '  dmmd  ', '   dd   '],
    w:     ['d  dd  d', ' dd  dd '],
    pout:  ['   dd   ', '  d  d  '],
    frown: ['  dddd  ', ' d    d '],
    sleep: ['        ', '   dd   ', '  d  d  ', '   dd   '],
    tongue: ['  dddd  ', '   tt   ', '   tt   '],
  };
  M.wide = M.a;
  F.MOUTHS = Object.keys(M);
  const COL = { d: 'mD', m: 'mIn', t: 'tongue', w: 'white' };
  F.drawMouth = function (Ly, name) {
    const p = F.pen(Ly), g = M[name] || M.smile;
    p.clear();
    g.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const k = COL[row[x]]; if (k) p.px(C[k], 12 + x, 25 + y); } });
  };
  // blush(v 0..1) on both cheeks, pre-mixed with skin so it stays an opaque cutout; puff = pouting cheeks, tear = sad
  const OVAL = [' xxxxx ', 'xxxxxxx', ' xxxxx '], PUFF = [' xxxxx ', 'xxxxxxx', 'xxxxxxx', ' xxxxx '];
  F.drawBlush = function (Ly, v, puff, tear) {
    const p = F.pen(Ly), k = Math.max(0, Math.min(1, v)) * 0.8;
    p.clear();
    [[3, false], [22, true]].forEach(([ox, mir]) => {
      const X = x => mir ? ox + 6 - x : ox + x;
      if (k > 0.04 || puff) {
        const c = F.mix(C.skin, C.blush, Math.max(k, puff ? 0.5 : 0));
        (puff ? PUFF : OVAL).forEach((r, y) => { for (let x = 0; x < 7; x++) if (r[x] === 'x') p.px(c, X(x), 22 + y); });
        if (k > 0.55) p.list(C.hatch, [[1, 2], [2, 1], [4, 2], [5, 1]], 0, 22, X);
        if (puff) { p.px(C.white, X(1), 22); p.px(F.mix(C.skin, C.blush, 0.9), X(6), 24); }
      }
      if (tear && !mir) { p.px(C.pale, X(1), 22); p.px(C.pale, X(0), 23); p.px(C.sky, X(1), 23); p.px(C.sky, X(0), 24); p.px(C.white, X(1), 24); }
    });
  };
})();
// ---------------------------------------------------------------- expressions, blink, talk, gaze (per-face state)
(function () {
  const F = V3.girlv1Face;
  const P = F.PRESET = {
    neutral:   { eyes: 'open',   mouth: 'smile',  blush: 0.15 },
    happy:     { eyes: 'happy',  mouth: 'open',   blush: 0.6 },              // 开心 >ω<
    smile:     { eyes: 'joy',    mouth: 'w',      blush: 0.35 },
    laugh:     { eyes: 'joy',    mouth: 'grin',   blush: 0.65 },
    pout:      { eyes: 'angry',  mouth: 'pout',   blush: 0.45, puff: true }, // 气鼓鼓
    sleepy:    { eyes: 'sleepy', mouth: 'flat',   blush: 0.1 },              // 困倦
    asleep:    { eyes: 'closed', mouth: 'sleep',  blush: 0.2 },
    surprised: { eyes: 'wide',   mouth: 'o',      blush: 0.1 },
    sad:       { eyes: 'sad',    mouth: 'frown',  blush: 0.05, tear: true },
    shy:       { eyes: 'open',   mouth: 'u',      blush: 1, look: [-0.8, -0.4] },
    focus:     { eyes: 'focus',  mouth: 'tongue', blush: 0.1, look: [0, -0.7] },
  };
  F.EXPR = Object.keys(P);
  const TALK = ['flat', 'e', 'a', 'o', 'w'];                     // closed, small open, wide open, o, ω
  const SHUT = { smile: 1, flat: 1, w: 1, pout: 1, frown: 1 };   // closed mouths double as the talk 'closed' frame
  const LX = 3, LY = 2;                                          // max gaze shift (design texels) at look ±1
  const clamp = v => Math.max(-1, Math.min(1, +v || 0));
  let seed = 7001;
  F._api = function (f) {
    const rnd = V3.util.rng(seed++);
    const s = f.state = { expr: 'neutral', eyes: 'open', mouth: 'smile', blush: 0, puff: false, tear: false, look: [0, 0] };
    const st = f._st = { t: 0, bl: 0, lk: [0, 0], wd: [0, 0], nWd: 1 + rnd() * 3, nBl: 2 + rnd() * 4,
      bT: -1, dbl: false, second: false, talk: false, tEnd: Infinity, tShape: 'flat', nT: 0, hold: null };
    f.autoBlink = true;
    const snap = () => Object.assign({}, s, { look: s.look.slice() });
    const apply = (name, p) => Object.assign(s, { expr: name, eyes: p.eyes, mouth: p.mouth, blush: p.blush,
      puff: !!p.puff, tear: !!p.tear, look: p.look ? p.look.slice() : [0, 0] });
    f.eyes = n => { if (F.EYE[n]) s.eyes = n; return f; };
    f.mouth = n => { if (F.MOUTH[n]) s.mouth = n; return f; };
    f.blush = v => { s.blush = Math.max(0, Math.min(1, +v || 0)); return f; };
    f.look = (x, y) => { s.look = [clamp(x), clamp(y)]; return f; };
    f.set = o => {
      o = o || {};
      if (o.eyes) f.eyes(o.eyes); if (o.mouth) f.mouth(o.mouth); if (o.blush != null) f.blush(o.blush);
      if (o.look) f.look(o.look[0], o.look[1]); if (o.puff != null) s.puff = !!o.puff; if (o.tear != null) s.tear = !!o.tear;
      return f;
    };
    f.expr = (name, holdSec) => {
      const p = P[name]; if (!p) return f;
      if (holdSec > 0) { if (!st.hold) st.hold = { prev: snap() }; st.hold.until = st.t + holdSec; } else st.hold = null;
      apply(name, p); return f;
    };
    f.talk = on => {
      if (typeof on === 'number') { st.talk = on > 0; st.tEnd = st.t + on; } else { st.talk = !!on; st.tEnd = Infinity; }
      st.nT = 0; return f;
    };
    f.talking = () => st.talk;
    f.blink = () => { if (!F.CLOSED[s.eyes] && st.bT < 0) st.bT = 0; return f; };
    f.update = (t, dt) => {
      st.t = t; dt = Math.max(0, Math.min(0.1, dt || 0));
      if (st.hold && t >= st.hold.until) { const pv = st.hold.prev; st.hold = null; Object.assign(s, pv); }
      // blink: half → closed (~0.12 s) → half, every 2–6 s, 20 % double; skipped while the expression shuts the eyes
      let eyes = s.eyes;
      if (F.CLOSED[eyes]) st.bT = -1;
      else {
        if (st.bT < 0 && f.autoBlink && (st.nBl -= dt) <= 0) {
          st.bT = 0; st.dbl = !st.second && rnd() < 0.2; st.second = false; st.nBl = 2 + rnd() * 4;
        }
        if (st.bT >= 0) {
          const b = (st.bT += dt), Lp = F.EYE[eyes].L, half = (Lp.top || 0) >= 3 ? 'closed' : 'half';
          if (b < 0.04) eyes = half; else if (b < 0.16) eyes = 'closed'; else if (b < 0.2) eyes = half;
          else { st.bT = -1; if (st.dbl) { st.dbl = false; st.second = true; st.nBl = 0.12; } }
        }
      }
      // gaze: eased toward look() + a small idle wander (±1 texel saccades)
      if ((st.nWd -= dt) <= 0) {
        st.wd = rnd() < 0.4 ? [0, 0] : [(rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6]; st.nWd = 1.5 + rnd() * 3.5;
      }
      const k = 1 - Math.exp(-dt * 14);
      for (let i = 0; i < 2; i++) st.lk[i] += (clamp(s.look[i] + st.wd[i]) - st.lk[i]) * k;
      const lx = Math.round(st.lk[0] * LX), ly = -Math.round(st.lk[1] * LY);
      // talk: random mouth frames at ~7–14 Hz (mean ≈ 9.5 Hz), never the same frame twice in a row
      let mouth = s.mouth;
      if (st.talk && t >= st.tEnd) st.talk = false;
      if (st.talk) {
        if ((st.nT -= dt) <= 0) {
          let n; do n = TALK[(rnd() * TALK.length) | 0]; while (n === st.tShape);
          st.tShape = n; st.nT = 0.07 + rnd() * 0.07;
        }
        mouth = st.tShape === 'flat' ? (SHUT[s.mouth] ? s.mouth : 'flat') : st.tShape;
      }
      st.bl += (s.blush - st.bl) * (dt > 0 ? 1 - Math.exp(-dt * 6) : 1);
      // redraw only the layers whose state key changed
      const L = f.layers, bq = Math.round(st.bl * 20) / 20;
      const bw = F.EYE[s.eyes].brow;             // the expression's brows survive the blink frames
      const ke = eyes + '|' + lx + '|' + ly + (bw && eyes !== s.eyes ? '|' + bw : ''), kb = bq + '|' + s.puff + '|' + s.tear;
      if (L.eyes.key !== ke) { L.eyes.key = ke; F.drawEyes(L.eyes, eyes, lx, ly, bw); L.eyes.tex.needsUpdate = true; }
      if (L.mouth.key !== mouth) { L.mouth.key = mouth; F.drawMouth(L.mouth, mouth); L.mouth.tex.needsUpdate = true; }
      if (L.blush.key !== kb) { L.blush.key = kb; F.drawBlush(L.blush, bq, s.puff, s.tear); L.blush.tex.needsUpdate = true; }
    };
    apply('neutral', P.neutral);
    f.update(st.t, 0);
  };
})();
})(window.V3);
