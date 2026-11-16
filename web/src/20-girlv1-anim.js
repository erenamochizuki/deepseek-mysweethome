/* 20-girlv1-anim.js — v1 小鲸鱼的动作片段 + 程序动画层，移植自 v1 的 41-anim.js。
   V3.girlv1Anim = { drive(girl), lookAt(vec3 | null), mood(name), talk(text), names: [clip names], CN: { name: 中文 } }
   片段放在 V3.cuboid.clips['g.<name>']；每个值都是相对骨骼静止姿势的偏移（度 / px）。
   v3 新加 3 个给 65-girl-actor 用的姿势：pickHold（蹲下伸手）、cheer（开心地连蹦）、huddle（坐在门廊沿上缩着）。 */
(function (V3) {
'use strict';
V3.girlv1Anim = V3.girlv1Anim || {};
(function () {
  const A = V3.girlv1Anim, M = V3.cuboid;
  A.names = A.names || [];
  // add(tracks, bone, ch, t, v): push one key [t, x, y, z] into tracks[bone][ch]
  const add = (tr, b, ch, t, v) => { const o = tr[b] = tr[b] || {}; (o[ch] = o[ch] || []).push([t, v[0], v[1], v[2]]); };
  // pose list → tracks.  frames = [[t, { bone: [rx, ry, rz] | [rx, ry, rz, px, py, pz] }], …]
  A.seq = function (frames) {
    const tr = {};
    // every frame is a full pose: a bone missing from a frame (or a missing pos/scl part) is at rest there
    const ch = {};
    for (const [, p] of frames) for (const b in p) ch[b] = Math.max(ch[b] || 3, p[b].length);
    for (const [t, p] of frames) for (const b in ch) {
      const v = p[b] || [0, 0, 0], n = ch[b];
      add(tr, b, 'rot', t, v);
      if (n >= 6) add(tr, b, 'pos', t, v.length >= 6 ? [v[3], v[4], v[5]] : [0, 0, 0]);
      if (n >= 9) add(tr, b, 'scl', t, v.length >= 9 ? [v[6], v[7], v[8]] : [1, 1, 1]);
    }
    return tr;
  };
  // cycle(len, n, fn(phase 0..1) → pose): sample a periodic pose fn n times (closes the loop at t = len)
  A.cyc = function (len, n, fn) {
    const fr = [];
    for (let i = 0; i <= n; i++) fr.push([len * i / n, fn((i % n) / n)]);
    return A.seq(fr);
  };
  // mix(...poses): later poses override bones of earlier ones
  A.mix = (...ps) => Object.assign({}, ...ps);
  // bend(th, sp): thigh th° forward, shin pitched sp° back from vertical (foot is rigid with the shin) →
  //   { leg, shin } local x rotations + hips offset { dy, dz } (px) that keep the sole on the floor
  const R = Math.PI / 180;
  A.bend = function (th, sp) {
    const s = Math.sin, c = Math.cos;
    let dy = -(3.5 * (1 - c(th * R)) + 4 * (1 - c(sp * R)));
    dy += sp > 0 ? 1.85 * s(sp * R) : 1.35 * s(-sp * R);           // tiptoe: toes (or heel) stay on the floor
    return { leg: -th, shin: th + sp, dy, dz: -(3.5 * s(th * R) - 4 * s(sp * R)) };
  };
  // def(name, len, tracks, opts): register clip 'g.<name>'
  A.def = function (name, len, tracks, o) {
    if (!M || !M.clips) return;
    M.clips['g.' + name] = Object.assign({ len, loop: true, ease: 'smooth', tracks }, o || {});
    if (A.names.indexOf(name) < 0) A.names.push(name);
  };
})();

// ---- clips 1: standing + locomotion (signs: −x = limb forward / head up, +z raises armL sideways, −z armR) --------
(function () {
  const { cyc, seq, def } = V3.girlv1Anim, S = Math.sin, C = Math.cos, TAU = Math.PI * 2, mx = Math.max;
  // idle: weight shift, hands loosely clasped in front, small look-around
  def('idle', 3.2, cyc(3.2, 12, ph => {
    const s = S(ph * TAU), s2 = S(ph * TAU * 2);
    return {
      hips: [0, 0, s * 1.5, s * 0.25, 0, 0], spine: [2, 0, -s * 1.2], chest: [0, s * 2, 0],
      head: [-2 + s2 * 1.5, s * 5, s * 2], legL: [0, 0, -s * 1.5], legR: [0, 0, -s * 1.5],
      armL: [-18, 0, -16], forearmL: [-48, 6, 0], armR: [-18, 0, 16], forearmR: [-48, -6, 0],
      skirt: [0, 0, -s * 0.8], tail1: [0, s * 6, 0]
    };
  }), { ease: 'linear' });
  // walk: 0.6 s per two steps; bouncy chibi stride, opposite arm swing, little pelvis twist
  def('walk', 0.6, cyc(0.6, 12, ph => {
    const a = ph * TAU, s = S(a), c = C(a);
    return {
      hips: [0, -6 * s, 0, 0, -0.05 + 0.3 * C(2 * a), 0], spine: [5, 0, 0], chest: [0, 9 * s, 0],
      head: [-3, -3 * s, 0],
      legL: [-28 * s, 0, 0], shinL: [8 + 30 * mx(0, c), 0, 0], legR: [28 * s, 0, 0], shinR: [8 + 30 * mx(0, -c), 0, 0],
      armL: [30 * s, 0, 2], forearmL: [-14 - 16 * mx(0, -s), 0, 0],
      armR: [-30 * s, 0, -2], forearmR: [-14 - 16 * mx(0, s), 0, 0],
      skirt: [0, 2 * s, 2 * s], tail1: [0, 10 * s, 0], tail2: [0, 6 * C(a - 0.8), 0]
    };
  }), { ease: 'linear' });
  // run: 0.42 s, long bouncy stride, bent arms pumping, leaning in
  def('run', 0.42, cyc(0.42, 12, ph => {
    const a = ph * TAU, s = S(a), c = C(a);
    return {
      hips: [0, -8 * s, 0, 0, 0.1 + 0.7 * C(2 * a), 0.4], spine: [12, 0, 0], chest: [4, 12 * s, 0],
      head: [-12, -4 * s, 0],
      legL: [-45 * s, 0, 0], shinL: [15 + 60 * mx(0, c), 0, 0], legR: [45 * s, 0, 0], shinR: [15 + 60 * mx(0, -c), 0, 0],
      armL: [42 * s, 0, 10], forearmL: [-70, 0, 0], armR: [-42 * s, 0, -10], forearmR: [-70, 0, 0],
      skirt: [-4, 0, 3 * s], tail1: [8, 16 * s, 0], tail2: [6, 10 * C(a - 0.8), 0]
    };
  }), { ease: 'linear' });
  // hop: one happy hop (anticipation → air with arms up → squash → settle)
  const crouch = (k) => {
    const b = V3.girlv1Anim.bend(45 * k, 12 * k);
    return {
      hips: [0, 0, 0, 0, b.dy, b.dz], spine: [14 * k, 0, 0], head: [-8 * k, 0, 0],
      legL: [b.leg, 0, 0], shinL: [b.shin, 0, 0], legR: [b.leg, 0, 0], shinR: [b.shin, 0, 0],
      armL: [28 * k, 0, 10 * k], forearmL: [-10 * k, 0, 0], armR: [28 * k, 0, -10 * k], forearmR: [-10 * k, 0, 0],
      tail1: [-6 * k, 0, 0], skirt: [0, 0, 0]
    };
  };
  def('hop', 0.75, seq([
    [0, crouch(0)], [0.16, crouch(1)],
    [0.34, { hips: [0, 0, 0, 0, 4, 0], spine: [-6, 0, 0], head: [-10, 0, 0],
      legL: [-12, 0, 0], shinL: [38, 0, 0], legR: [-4, 0, 0], shinR: [28, 0, 0],
      armL: [-10, 0, 112], forearmL: [-20, 0, 0], armR: [-10, 0, -112], forearmR: [-20, 0, 0],
      tail1: [22, 0, 0], skirt: [6, 0, 0] }],
    [0.5, crouch(0.6)], [0.75, crouch(0)]
  ]), { loop: false });
  // wave: right hand up beside the head, forearm waving, head tilted toward it
  const wv = (f, s) => ({
    armR: [-18, 0, -128], forearmR: [0, 0, f], handR: [0, 0, f * 0.4],
    armL: [-6, 0, -8], forearmL: [-20, 0, 0],
    head: [-4, -8, 7 + s], spine: [0, 0, -2 - s * 0.5], hips: [0, 0, 1.5, 0, 0, 0], tail1: [0, s * 4, 0]
  });
  def('wave', 1.2, seq([[0, wv(22, 1)], [0.3, wv(-26, -1)], [0.6, wv(22, 1)], [0.9, wv(-26, -1)], [1.2, wv(22, 1)]]));
})();
// ---- clips 2: sitting + lying.  V3.girlv1Anim.seat = seat-contact height (px above her root) each clip assumes ---------
// lieBed / sleep / wake pivot on her hips: put the root on the mattress top where her bottom goes (head → local −z).
(function () {
  const A = V3.girlv1Anim, { cyc, seq, def, mix } = A, S = Math.sin, TAU = Math.PI * 2;
  A.seat = { chair: 6.4, sofa: 5.1, floor: 0, bed: 0 };
  const P = A.P = A.P || {};
  // chair: thighs level, chibi shins dangle above the floor, hands on the lap, tail curled aside on the seat
  P.chair = {
    hips: [0, 0, 0, 0, 0, 0], spine: [3, 0, 0], chest: [0, 0, 0], head: [-2, 0, 0],
    legL: [-88, 0, 3], shinL: [92, 0, -3], legR: [-88, 0, -3], shinR: [92, 0, 3],
    armL: [-38, 0, -12], forearmL: [-42, 0, 0], armR: [-38, 0, 12], forearmR: [-42, 0, 0],
    skirt: [-12, 0, 0, 0, 0, 0.3, 1.05, 0.85, 1.05], tail1: [-6, -85, 0]
  };
  // sofa: lower seat, leaning back into the cushions, hands resting beside her
  P.sofa = mix(P.chair, {
    hips: [-10, 0, 0, 0, -1.3, 0.8], spine: [-4, 0, 0], head: [10, 0, 0],
    legL: [-76, 0, 4], shinL: [78, 0, -3], legR: [-76, 0, -4], shinR: [78, 0, 3],
    armL: [-14, 0, 6], forearmL: [-30, 0, 0], armR: [-14, 0, -6], forearmR: [-30, 0, 0]
  });
  // floor: hugging her knees, cheek tilted onto them
  P.floor = {
    hips: [-10, 0, 0, 0, -6.6, 0], spine: [22, 0, 0], chest: [8, 0, 0], head: [-10, 0, 6],
    legL: [-115, 0, 6], shinL: [70, 0, -4], legR: [-115, 0, -6], shinR: [70, 0, 4],
    armL: [-50, 0, -26], forearmL: [-20, 0, 0], armR: [-50, 0, 26], forearmR: [-20, 0, 0],
    skirt: [-30, 0, 0, 0, 0.4, 0.6, 1.14, 0.58, 1.14], tail1: [18, -100, 0], tail2: [-14, 0, 0]
  };
  // lie: on her back (hips pitched −90 → head toward −z), hands folded on the tummy, tail out to her left
  P.lie = {
    hips: [-90, 0, 0, 0, -6.5, 0], spine: [0, 0, 0], neck: [4, 0, 0], head: [6, 0, 0],
    legL: [0, 0, 3], shinL: [4, 0, 0], legR: [0, 0, -3], shinR: [4, 0, 0],
    armL: [-14, 0, -24], forearmL: [-80, 0, -35], armR: [-14, 0, 24], forearmR: [-80, 0, 35],
    skirt: [0, 0, 0, 0, 0, 0, 1.05, 1, 0.7], tail1: [0, -120, 0], finL: [0, -40, 0], finR: [0, 40, 0]
  };
  // curl: asleep on her left side (up → −z, left → down, facing +x), knees drawn up, hands by her cheek
  P.curl = {
    hips: [-90, 90, 0, 0, -3.5, 0], spine: [14, 0, 0], chest: [8, 0, 0], neck: [6, 0, 0], head: [10, 0, 0],
    legL: [-80, 0, 0], shinL: [100, 0, 0], legR: [-68, 0, -4], shinR: [96, 0, 0],
    armL: [-80, 0, -14], forearmL: [-70, 0, 0], armR: [-70, 0, 12], forearmR: [-80, 0, 0],
    skirt: [-20, 0, 0, 0, 0, 0, 1, 0.9, 1], tail1: [-40, 40, 0]
  };
  // sitting up in bed, legs straight under the duvet
  P.bedUp = {
    hips: [0, 0, 0, 0, -6.4, 0.5], spine: [8, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    legL: [-90, 0, 3], shinL: [2, 0, 0], legR: [-90, 0, -3], shinR: [2, 0, 0],
    armL: [-22, 0, 4], forearmL: [-34, 0, 0], armR: [-22, 0, -4], forearmR: [-34, 0, 0],
    skirt: [-35, 0, 0, 0, 0.6, 0, 1.12, 0.5, 1.12], tail1: [0, -120, 0], finL: [0, 0, 0], finR: [0, 0, 0]
  };
  def('sitChair', 4, cyc(4, 16, ph => {
    const s = S(ph * TAU), k = S(ph * TAU * 2);
    return mix(P.chair, { shinL: [92 + 10 * k, 0, -3], shinR: [92 - 10 * k, 0, 3], head: [-2, 4 * s, 2 * s], spine: [3, 0, s] });
  }), { ease: 'linear' });
  def('sitSofa', 5, cyc(5, 10, ph => {
    const s = S(ph * TAU);
    return mix(P.sofa, { head: [10 + 2 * s, 3 * s, 0], shinL: [78 + 6 * s, 0, -3], shinR: [78 - 6 * s, 0, 3] });
  }), { ease: 'linear' });
  def('sitFloor', 4, cyc(4, 12, ph => {
    const s = S(ph * TAU);
    return mix(P.floor, { hips: [-10 + 3 * s, 0, 0, 0, -6.6, 0], head: [-10, 0, 6 + 3 * s] });
  }), { ease: 'linear' });
  def('lieBed', 4, cyc(4, 8, ph => mix(P.lie, { spine: [S(ph * TAU) * 1.5, 0, 0] })), { ease: 'linear' });
  def('sleep', 4.5, cyc(4.5, 12, ph => {
    const s = S(ph * TAU);
    return mix(P.curl, { spine: [14 + 1.5 * s, 0, 0], head: [10 + s, 0, 0] });
  }), { ease: 'linear' });
  // wake: lying → sit up → rub an eye → big stretch → settle (then play idle / walk)
  const up = P.bedUp, rub = f => mix(up, { armR: [-125, 0, 30], forearmR: [-95, 0, f], head: [6, 0, -6] });
  def('wake', 3.4, seq([
    [0, P.lie], [0.9, up], [1.3, rub(0)], [1.55, rub(18)], [1.8, rub(-10)], [2.0, rub(12)],
    [2.6, mix(up, { armL: [-168, 0, 6], forearmL: [-10, 0, 0], armR: [-168, 0, -6], forearmR: [-10, 0, 0],
      spine: [-6, 0, 0], head: [-16, 0, 0] })],
    [3.4, up]
  ]), { loop: false });
})();
// ---- clips 3: kitchen, table, desk.  Hands work ≈ 10.5 px above her root, 4–5 px in front --------------------
// clip.face = [[t, eyes | null, mouth | null], …] → drive() sets her face as the clip passes each key.
(function () {
  const A = V3.girlv1Anim, { cyc, seq, def, mix, P } = A, S = Math.sin, C = Math.cos, TAU = Math.PI * 2;
  // counter: standing at the stove looking into the pot, left hand on the pot handle
  P.counter = {
    hips: [0, 0, 0, 0, 0, 0], spine: [8, 0, 0], chest: [2, 0, 0], head: [16, 0, 0],
    armL: [-52, 0, -14], forearmL: [-38, 0, 0], armR: [-62, 0, 18], forearmR: [-34, 0, 0], handR: [0, 0, 0],
    tail1: [0, 0, 0]
  };
  const stir = a => mix(P.counter, {
    armR: [-62 + 7 * S(a), 0, 18 + 7 * C(a)], forearmR: [-34 - 6 * S(a), 0, 0], handR: [0, 0, 6 * C(a)],
    head: [16, 4 * C(a), 0], hips: [0, 0, 1.5 * C(a), 0, 0, 0], tail1: [0, 6 * C(a), 0]
  });
  const taste = (o) => mix(P.counter, { armR: [-104, 0, 24], forearmR: [-62, 0, 0], handR: [-25, 0, 0],
    head: [4, 0, 0], spine: [4, 0, 0] }, o || {});
  // cook: four stirs, then lift the ladle, blow, taste, nod
  const fr = [];
  for (let i = 0; i <= 32; i++) fr.push([i * 0.1, stir(i / 8 * TAU)]);
  fr.push([3.6, taste()], [3.9, taste({ head: [0, 0, 4] })], [4.3, taste({ head: [8, 0, -3] })], [4.8, stir(0)]);
  def('cook', 4.8, seq(fr), { ease: 'linear',
    face: [[0, 'open', 'smile'], [3.6, 'open', 'o'], [4.0, 'happy', 'smile'], [4.6, 'open', 'smile']] });
  // ladle: scoop from the pot, carry to her left, pour into a bowl
  const ld = (x, z, f, h) => mix(P.counter, { armR: [x, 0, z], forearmR: [f, 0, 0], handR: [0, 0, h] });
  def('ladle', 2.2, seq([[0, ld(-62, 18, -34, 0)], [0.5, ld(-50, 14, -30, -20)], [0.9, ld(-74, 20, -40, 0)],
    [1.4, ld(-70, 36, -40, 0)], [1.75, ld(-66, 36, -36, 60)], [2.2, ld(-62, 18, -34, 0)]]), { loop: false });
  // serve: plate held in both hands → lean and set it down → straighten
  P.carry = { spine: [-3, 0, 0], head: [8, 0, 0], hips: [0, 0, 0, 0, 0, 0],
    armL: [-58, 0, -18], forearmL: [-40, 0, 0], armR: [-58, 0, 18], forearmR: [-40, 0, 0] };
  const put = mix(P.carry, { spine: [16, 0, 0], head: [12, 0, 0], hips: [0, 0, 0, 0, 0, 0.3],
    armL: [-76, 0, -16], forearmL: [-12, 0, 0], armR: [-76, 0, 16], forearmR: [-12, 0, 0] });
  def('serve', 2, seq([[0, P.carry], [0.6, put], [1.0, put],
    [1.5, mix(P.carry, { armL: [-20, 0, -8], forearmL: [-30, 0, 0], armR: [-20, 0, 8], forearmR: [-30, 0, 0] })],
    [2, mix(P.carry, { spine: [0, 0, 0], head: [0, 0, 6], armL: [-10, 0, 0], forearmL: [-20, 0, 0], armR: [-10, 0, 0], forearmR: [-20, 0, 0] })]
  ]), { loop: false, face: [[0, 'open', 'smile'], [1.5, 'happy', 'open']] });
  // eat (at the table): spoon from the bowl to her mouth, chew happily
  P.table = mix(P.chair, { spine: [8, 0, 0], head: [10, 0, 0], armL: [-60, 0, -10], forearmL: [-34, 0, 12], handR: [0, 0, 0] });
  const bowl = mix(P.table, { armR: [-58, 0, 16], forearmR: [-36, 0, 0], head: [16, 0, 0] });
  const bite = mix(P.table, { armR: [-100, 0, 26], forearmR: [-66, 0, 0], handR: [-20, 0, 0], head: [6, 0, 0], spine: [10, 0, 0] });
  const chew = k => mix(P.table, { armR: [-62, 0, 16], forearmR: [-40, 0, 0], head: [4 + 3 * k, 0, 2 + 2 * k] });
  def('eat', 2.6, seq([[0, bowl], [0.35, mix(bowl, { forearmR: [-28, 0, 0] })], [0.8, bite], [1.0, bite],
    [1.3, chew(0)], [1.55, chew(1)], [1.8, chew(0)], [2.05, chew(1)], [2.3, chew(0)], [2.6, bowl]]),
  { face: [[0, 'open', 'smile'], [0.75, 'open', 'o'], [1.05, 'happy', 'flat'], [1.3, 'happy', 'o_'], [1.55, 'happy', 'flat'],
    [1.8, 'happy', 'o_'], [2.05, 'happy', 'smile'], [2.4, 'open', 'smile']] });
  // desk: leaning over the paper, left hand holding it flat
  P.desk = mix(P.chair, { spine: [12, 0, 0], chest: [4, 0, 0], head: [18, 0, 0], handR: [0, 0, 0],
    armL: [-64, 0, -6], forearmL: [-30, 0, 10], armR: [-62, 0, 14], forearmR: [-30, 0, 0] });
  // draw: quick crayon strokes sweeping across the page, tail swishing
  def('draw', 2.4, cyc(2.4, 24, ph => {
    const a = ph * TAU, q = a * 6;
    return mix(P.desk, { armR: [-62 + 4 * S(a), 0, 14 + 5 * S(q)], forearmR: [-30 + 5 * C(q), 0, 0], handR: [0, 0, 8 * S(q)],
      head: [18, 4 * S(a), 3], tail1: [-6, -85 + 8 * S(a), 0] });
  }), { ease: 'linear', face: [[0, 'open', 'smile']] });
  // write: diary line by line (small left→right steps), then pen to chin to think
  const wr = (u, l) => mix(P.desk, { armR: [-64, 0, 6 + 12 * u], forearmR: [-30 + 4 * l, 0, 0], head: [18, -4 + 8 * u, 2] });
  const wf = [];
  for (let i = 0; i <= 20; i++) wf.push([i * 0.1, wr(i / 20, i % 2)]);
  for (let i = 0; i <= 16; i++) wf.push([2.4 + i * 0.1, wr(i / 16 * 0.8, i % 2)]);
  const think = mix(P.desk, { armR: [-112, 0, 30], forearmR: [-92, 0, 0], handR: [-10, 0, 0], spine: [4, 0, 0], head: [-6, 10, 8] });
  wf.push([4.5, think], [5.6, mix(think, { head: [-8, -6, 6] })], [6.2, wr(0, 0)]);
  def('write', 6.2, seq(wf), { ease: 'linear',
    face: [[0, 'open', 'flat'], [4.4, 'half', 'o_'], [5.6, 'open', 'smile'], [6.0, 'open', 'flat']] });
})();
// ---- clips 4: computer, book, rocking chair, TV, pick up, gaze far, yawn ---------------------------------------
(function () {
  const A = V3.girlv1Anim, { cyc, seq, def, mix, bend, P } = A, S = Math.sin, C = Math.cos, TAU = Math.PI * 2;
  // type: desk chair, both hands on the keyboard, eyes on the screen
  P.type = mix(P.chair, { spine: [6, 0, 0], head: [2, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0],
    armL: [-62, 0, -4], forearmL: [-36, 0, -16], armR: [-62, 0, 4], forearmR: [-36, 0, 16] });
  const tap = (i, k) => mix(P.type, { forearmL: [-36 - 5 * k * (i % 2), 0, -16], forearmR: [-36 - 5 * k * ((i + 1) % 2), 0, 16],
    handL: [-8 * k * ((i + 1) % 2), 0, 0], handR: [-8 * k * (i % 2), 0, 0], head: [2, 2 * S(i * 0.7), 0] });
  const tf = [];
  for (let i = 0; i <= 20; i++) tf.push([i * 0.12, tap(i, 1)]);
  tf.push([2.7, mix(P.type, { head: [-2, 8, 4], spine: [2, 0, 0] })], [3.0, mix(P.type, { head: [-2, 8, 4] })],
    [3.2, mix(P.type, { armR: [-70, 0, 4], forearmR: [-50, 0, 16], handR: [-20, 0, 0] })],   // …and Enter!
    [3.35, mix(P.type, { forearmR: [-30, 0, 16], handR: [10, 0, 0] })], [3.6, tap(0, 1)]);
  def('type', 3.6, seq(tf), { ease: 'linear',
    face: [[0, 'open', 'flat'], [2.5, 'open', 'o_'], [3.25, 'happy', 'smile'], [3.5, 'open', 'flat']] });
  // read: on the sofa, book held up in both hands, eyes running along the lines, a page turn
  P.read = mix(P.sofa, { spine: [-4, 0, 0], head: [16, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0],
    armL: [-58, 0, -6], forearmL: [-58, 0, -24], armR: [-58, 0, 6], forearmR: [-58, 0, 24] });
  const rf = [];
  for (let i = 0; i <= 12; i++) rf.push([i * 0.375, mix(P.read, { head: [16 + i * 0.5, i % 2 ? -5 : 5, 0] })]);
  rf.push([4.9, mix(P.read, { armR: [-66, 0, -6], forearmR: [-46, 0, 46], handR: [0, -30, 0], head: [14, 8, 0] })],
    [5.3, mix(P.read, { head: [14, 4, 0] })], [6, mix(P.read, { head: [16, 5, 0] })]);
  def('read', 6, seq(rf), { face: [[0, 'half', 'flat'], [4.6, 'open', 'o_'], [5.3, 'open', 'smile'], [5.8, 'half', 'flat']] });
  // rock: curled up in the rocking chair, knees hugged, head on her knees, gentle sway
  P.rock = mix(P.chair, {
    spine: [16, 0, 0], chest: [6, 0, 0], head: [6, 0, 12],
    legL: [-140, 0, 8], shinL: [125, 0, -6], legR: [-140, 0, -8], shinR: [125, 0, 6],
    armL: [-62, 0, -22], forearmL: [-40, 0, -34], armR: [-62, 0, 22], forearmR: [-40, 0, 34],
    skirt: [-34, 0, 0, 0, 0.5, 0.6, 1.14, 0.55, 1.14], tail1: [12, -110, 0], tail2: [-10, 0, 0]
  });
  def('rock', 3.6, cyc(3.6, 12, ph => {
    const a = ph * TAU;
    return mix(P.rock, { hips: [3.5 * S(a), 0, 0, 0, 0, 0], head: [6 - 2 * S(a), 0, 12 + 2 * C(a)], tail2: [-10 + 6 * S(a), 0, 0] });
  }), { ease: 'smooth', face: [[0, 'sleepy', 'smile']] });
  // watchTv: leaning back on the sofa hugging her tummy, a giggle in the middle
  P.tv = mix(P.sofa, { spine: [-6, 0, 0], head: [-2, 0, 4], handL: [0, 0, 0], handR: [0, 0, 0],
    armL: [-30, 0, -8], forearmL: [-62, 0, -30], armR: [-30, 0, 8], forearmR: [-62, 0, 30] });
  const lf = [[0, P.tv], [1.4, mix(P.tv, { head: [-2, 4, 6] })], [2.3, mix(P.tv, { head: [-4, 0, 2] })]];
  for (let i = 0; i < 8; i++) lf.push([2.4 + i * 0.13, mix(P.tv, { spine: [i % 2 ? -2 : 6, 0, 0], head: [-8, 0, i % 2 ? 0 : 4], tail1: [0, i % 2 ? 10 : -10, 0] })]);
  lf.push([3.8, mix(P.tv, { head: [-2, 0, -4] })], [5.0, mix(P.tv, { head: [-2, -4, -6] })], [6, P.tv]);
  def('watchTv', 6, seq(lf), { face: [[0, 'open', 'flat'], [2.3, 'happy', 'a'], [3.5, 'open', 'smile'], [4.8, 'open', 'flat']] });
  // pick: crouch, take something from the floor beside her right foot, look at it, stand up holding it
  const sq = bend(110, 50);
  P.crouch = { hips: [0, 0, 0, 0, sq.dy, sq.dz], spine: [20, 0, 0], head: [22, 0, 0],
    legL: [sq.leg, 0, 8], shinL: [sq.shin, 0, -6], legR: [sq.leg, 0, -8], shinR: [sq.shin, 0, 6],
    armL: [-30, 0, -6], forearmL: [-40, 0, -10], armR: [-14, 0, 14], forearmR: [-6, 0, 0], handR: [0, 0, 0],
    skirt: [-16, 0, 0, 0, 0.6, 0.4, 1.1, 0.7, 1.1], tail1: [30, 0, 0] };
  const hc = bend(55, 25);
  def('pick', 1.9, seq([[0, {}], [0.22, { hips: [0, 0, 0, 0, hc.dy, hc.dz], legL: [hc.leg, 0, 4], shinL: [hc.shin, 0, -3],
      legR: [hc.leg, 0, -4], shinR: [hc.shin, 0, 3], spine: [10, 0, 0], head: [12, 0, 0], armR: [-8, 0, 8], armL: [-14, 0, -4],
      forearmL: [-20, 0, -4], skirt: [-8, 0, 0, 0, 0.3, 0.2, 1.05, 0.85, 1.05], tail1: [14, 0, 0] }], [0.45, P.crouch], [0.7, mix(P.crouch, { handR: [-30, 0, 0] })],
    [1.15, mix(P.crouch, { armR: [-58, 0, 12], forearmR: [-60, 0, 0], handR: [-20, 0, 0], head: [26, 0, 6] })],
    [1.3, (() => { const h = bend(80, 34); return mix(P.crouch, { hips: [0, 0, 0, 0, h.dy, h.dz], legL: [h.leg, 0, 6], shinL: [h.shin, 0, -5],
      legR: [h.leg, 0, -6], shinR: [h.shin, 0, 5], spine: [15, 0, 0], armR: [-54, 0, 11], forearmR: [-61, 0, 0], handR: [-20, 0, 0],
      head: [22, 0, 7] }); })()],
    [1.42, (() => { const h = bend(50, 18); return { hips: [0, 0, 0, 0, h.dy, h.dz], legL: [h.leg, 0, 4], shinL: [h.shin, 0, -3],
      legR: [h.leg, 0, -4], shinR: [h.shin, 0, 3], spine: [10, 0, 0], armR: [-50, 0, 10], forearmR: [-62, 0, 0], handR: [-20, 0, 0],
      head: [18, 0, 8], tail1: [-14, 0, 0], skirt: [-8, 0, 0] }; })()],
    [1.65, { armR: [-46, 0, 10], forearmR: [-62, 0, 0], handR: [-20, 0, 0], head: [14, 0, 8], spine: [-2, 0, 0], tail1: [-6, 0, 0] }],
    [1.9, { armR: [-48, 0, 10], forearmR: [-60, 0, 0], handR: [-20, 0, 0], head: [12, 0, 6] }]
  ]), { loop: false, face: [[0, 'open', 'flat'], [0.5, 'open', 'o'], [1.15, 'wide', 'o_'], [1.5, 'happy', 'smile']] });
  // look: gazing far out to sea, hands clasped behind her back, weight shifting, head drifting
  P.behind = { armL: [26, 0, -6], forearmL: [30, 0, -60], armR: [26, 0, 6], forearmR: [30, 0, 60], handL: [0, 0, 0], handR: [0, 0, 0] };
  def('look', 6, cyc(6, 12, ph => {
    const a = ph * TAU;
    return mix(P.behind, { head: [-8 + 2 * S(2 * a), 14 * S(a), 3 * S(a)], spine: [-2, 0, 0],
      hips: [0, 0, 2 * S(a), 0.3 * S(a), 0, 0], legL: [0, 0, 1 + S(a)], legR: [0, 0, -1 + S(a)],
      tail1: [0, 10 * S(a + 1), 0], skirt: [0, 0, -1.5 * S(a)] });
  }), { ease: 'smooth', face: [[0, 'open', 'flat'], [2.6, 'half', 'smile'], [4.4, 'open', 'smile']] });
  // yawn: one arm up, the other hand over her mouth, eyes squeezed shut, then a sleepy shake
  const yu = { head: [-14, 0, 6], spine: [-6, 0, 0], armL: [0, 0, 128], forearmL: [-10, 0, 0], handL: [0, 0, 20],
    armR: [-106, 0, 28], forearmR: [-72, 0, 0], handR: [-20, 0, 0], tail1: [-14, 0, 0] };
  def('yawn', 2.4, seq([[0, {}],
    [0.4, mix(yu, { head: [-6, 0, 2], armL: [-20, 0, 60], armR: [-60, 0, 14], forearmR: [-50, 0, 0] })],
    [0.8, yu], [1.45, mix(yu, { head: [-16, 0, 8], armL: [0, 0, 132] })],
    [1.85, { head: [4, 6, 0], armR: [-20, 0, 6], forearmR: [-30, 0, 0] }], [2.1, { head: [4, -6, 0] }], [2.4, {}]
  ]), { loop: false, face: [[0, 'open', 'flat'], [0.35, 'half', 'o'], [0.7, 'closed', 'o'], [1.6, 'sleepy', 'u'], [2.1, 'half', 'flat']] });
})();
// ---- clips 5: pout, door, outfit spin, shoes off, stretch.  face key eyes '@name' = a V3.girlv1Face preset ------------
(function () {
  const A = V3.girlv1Anim, { cyc, seq, def, mix, bend, P } = A, S = Math.sin, C = Math.cos, TAU = Math.PI * 2;
  // pout: arms crossed, head turned away with the chin up, a little stomp, cheeks puffed
  P.cross = { armL: [-50, 0, 2], forearmL: [-80, 0, -90], armR: [-56, 0, -2], forearmR: [-78, 0, 90],
    handL: [0, 0, 0], handR: [0, 0, 0], spine: [-4, 0, 0], head: [-10, 26, -6], tail1: [10, 0, 0] };
  const stomp = bend(26, -8);
  def('pout', 2.4, seq([[0, P.cross],
    [0.2, mix(P.cross, { legR: [-34, 0, 0], shinR: [50, 0, 0], hips: [0, 0, -3, 0, 0, 0], tail1: [24, 14, 0] })],
    [0.32, mix(P.cross, { hips: [0, 0, 0, 0, stomp.dy * 0.4, 0], head: [-6, 26, -8], tail1: [-10, -10, 0] })],
    [0.6, mix(P.cross, { head: [-12, 30, -6] })], [1.3, mix(P.cross, { head: [-12, 28, -4], tail1: [10, 16, 0] })],
    [1.5, mix(P.cross, { head: [-4, 10, 0] })], [1.75, mix(P.cross, { head: [-12, 30, -6] })], [2.4, P.cross]]),
  { face: [[0, '@pout'], [1.4, 'angry', 'flat'], [1.75, '@pout']] });
  // doorOpen: reach the knob, turn it, pull the door toward her while stepping back, peek out
  const knob = { armR: [-68, 0, 8], forearmR: [-26, 0, 0], handR: [0, 0, 0], spine: [6, 0, 0], head: [4, 0, 0] };
  def('doorOpen', 1.6, seq([[0, {}], [0.3, knob], [0.45, mix(knob, { handR: [0, 50, 0] })],
    [0.85, mix(knob, { armR: [-56, 0, 22], forearmR: [-52, 0, 0], handR: [0, 50, 0], spine: [-4, 0, 0], hips: [0, -14, 0, -0.8, 0, -1.2],
      legR: [12, 0, -4], legL: [-4, 0, 0], head: [2, 18, 0] })],
    [1.2, { armR: [-20, 0, 10], forearmR: [-30, 0, 0], spine: [8, 0, 0], head: [6, 22, 8], hips: [0, -10, 0, -0.6, 0, -0.6], tail1: [0, 12, 0] }],
    [1.6, { head: [0, 8, 0] }]]), { loop: false, face: [[0, 'open', 'flat'], [0.9, 'wide', 'o'], [1.2, 'open', 'smile']] });
  // change: dip, spin once on the spot with arms out and skirt flaring, land in a cute pose (outfit swaps mid-spin)
  const fl = (y, k) => ({ hips: [0, y, 0, 0, 0.6 * k, 0], spine: [-4 * k, 0, 0], head: [-6 * k, 0, 0],
    armL: [-10, 0, 48 * k], forearmL: [-10, 0, 0], armR: [-10, 0, -48 * k], forearmR: [-10, 0, 0],
    skirt: [0, 0, 0, 0, 0.5 * k, 0, 1 + 0.22 * k, 1 - 0.3 * k, 1 + 0.22 * k], tail1: [16 * k, 0, 0], legL: [0, 0, 4 * k], legR: [0, 0, -4 * k] });
  const dip = bend(30, 8);
  def('change', 1.3, seq([[0, {}], [0.16, { hips: [0, 0, 0, 0, dip.dy, dip.dz], legL: [dip.leg, 0, 0], shinL: [dip.shin, 0, 0],
      legR: [dip.leg, 0, 0], shinR: [dip.shin, 0, 0], armL: [10, 0, 16], armR: [10, 0, -16] }],
    [0.3, fl(60, 1)], [0.45, fl(160, 1)], [0.6, fl(260, 1)], [0.75, fl(360, 1)], [0.751, fl(0, 1)],
    [0.95, { hips: [0, 0, 3, 0, 0, 0], head: [-4, 0, 10], armR: [-18, 0, -128], forearmR: [0, 0, -20], armL: [-20, 0, 20], forearmL: [-50, 0, 0],
      legL: [0, 0, 0], legR: [-16, 0, -4], shinR: [34, 0, 0], tail1: [20, 12, 0] }],
    [1.3, {}]]), { loop: false, ease: 'linear', face: [[0, 'open', 'smile'], [0.3, 'happy', 'open'], [0.95, 'wink', 'smile'], [1.3, 'open', 'smile']] });
  // shoesOff: balance on one foot, heel up behind, reach back and pull — left shoe, then right
  // knee pulled up in front, both hands down on it, leaning over the standing leg (which counter-rolls to stay planted)
  const off = (s, k) => { const a = s > 0 ? 'L' : 'R', b = s > 0 ? 'R' : 'L'; return {
    ['leg' + a]: [-95 * k, 0, 4 * s * k], ['shin' + a]: [110 * k, 0, 0], ['leg' + b]: [0, 0, 5 * s * k],
    armL: [-30 * k, 0, -8 * k], forearmL: [-26 * k, 0, 0], armR: [-30 * k, 0, 8 * k], forearmR: [-26 * k, 0, 0],
    spine: [30 * k, 12 * s * k, 0], chest: [10 * k, 0, 0], head: [10 * k, 0, 6 * s * k],
    hips: [0, 0, -5 * s * k, -0.6 * s * k, 0, 0], skirt: [-18 * k, 0, 0], tail1: [16 * k, 0, 0] }; };
  def('shoesOff', 2.8, seq([[0, {}], [0.4, off(1, 1)], [0.7, off(1, 1.1)], [0.85, off(1, 0.9)], [1.3, {}],
    [1.7, off(-1, 1)], [2.0, off(-1, 1.1)], [2.15, off(-1, 0.9)], [2.8, {}]]),
  { loop: false, face: [[0, 'open', 'flat'], [0.4, 'focus', 'u'], [1.2, 'open', 'smile'], [1.6, 'focus', 'u'], [2.5, 'happy', 'smile']] });
  // stretch: arms up over her head on tiptoe, lean left and right, then let go with a sigh
  const toe = bend(0, -14);
  const up = (lean, k) => ({ armL: [16, 0, 150], forearmL: [0, 0, 12], armR: [16, 0, -150], forearmR: [0, 0, -12],
    handL: [0, 0, 0], handR: [0, 0, 0], spine: [-8 * k, 0, lean], chest: [-4 * k, 0, lean * 0.6], head: [-14 * k, 0, lean * 0.5],
    hips: [0, 0, 0, 0, toe.dy * k, 0], legL: [toe.leg, 0, 0], shinL: [toe.shin * k, 0, 0], legR: [toe.leg, 0, 0], shinR: [toe.shin * k, 0, 0],
    tail1: [-20 * k, 0, 0], ahoge: [-10 * k, 0, 0] });
  def('stretch', 3.2, seq([[0, {}], [0.5, up(0, 1)], [0.9, up(0, 1)], [1.4, up(14, 0.6)], [1.9, up(-14, 0.6)], [2.3, up(0, 0.9)],
    [2.7, { spine: [6, 0, 0], head: [8, 0, 0], armL: [4, 0, 6], armR: [4, 0, -6], tail1: [6, 0, 0] }], [3.2, {}]]),
  { loop: false, face: [[0, 'open', 'flat'], [0.4, 'closed', 'o'], [1.3, 'joy', 'u'], [2.6, 'half', 'smile'], [3.1, 'open', 'smile']] });
})();
// ---- clips 6: water — wade, swim, float -------------------------------------------------------------------------
// WATER DEPTH (for the brain): V3.girlv1Anim.water = px to put her root BELOW the water surface for each clip:
//   swim : root.y = surfaceY − 11 px (≈ 0.69 m). Hips pitched +75° face-down; her back (torso rear, 2.5 px behind
//          the spine) then sits ≈ 3 px above the hips pivot (8 px) → 8 + 3 = 11 px: back just at the surface,
//          head lifted a little so the face is half in.
//   float: root.y = surfaceY − 8 px (≈ 0.5 m): hips pivot on the surface, back 2.5 px under, tummy + face above.
//   wade : root on the sea floor; water up to her ankles (≤ 2 px) — use it in the shallows only.
(function () {
  const A = V3.girlv1Anim, { cyc, def, mix } = A, S = Math.sin, C = Math.cos, TAU = Math.PI * 2, mx = Math.max;
  A.water = { swim: 11, float: 8, wade: 0 };
  // wade: slow careful high steps, arms out a little for balance, a small splashy kick forward each step
  def('wade', 1.4, cyc(1.4, 16, ph => {
    const a = ph * TAU, s = S(a), c = C(a), kL = mx(0, S(a + 0.9)), kR = mx(0, S(a + 0.9 + Math.PI));
    return {
      hips: [0, -4 * s, 2 * s, 0.2 * s, 0.3 * Math.abs(C(a)), 0], spine: [6, 0, -2 * s], chest: [0, 5 * s, 0],
      head: [8, -3 * s, 2 * s],
      legL: [-30 * mx(0, s) + 6 * mx(0, -s), 0, 2], shinL: [6 + 40 * mx(0, s) - 26 * kL * mx(0, -c), 0, 0],
      legR: [-30 * mx(0, -s) + 6 * mx(0, s), 0, -2], shinR: [6 + 40 * mx(0, -s) - 26 * kR * mx(0, c), 0, 0],
      armL: [-10 + 8 * s, 0, 30 + 6 * s], forearmL: [-24, 0, 6], handL: [0, 0, 10],
      armR: [-10 - 8 * s, 0, -30 + 6 * s], forearmR: [-24, 0, -6], handR: [0, 0, -10],
      skirt: [-6, 0, 2 * s], tail1: [10, 8 * s, 0]
    };
  }), { ease: 'linear', face: [[0, 'open', 'o_']] });
  // swim: face-down crawl — alternating overhead strokes (reach → pull under → push to hip → recover), flutter
  //   kick, wide tail sway, head lifted for air; 1.2 s per full L+R stroke
  def('swim', 1.2, cyc(1.2, 24, ph => {
    const a = ph * TAU, k = S(a * 4);
    const arm = (p, sd) => {                       // p = stroke phase; sd = +1 left, −1 right
      const x = -95 - 85 * C(p);                  // −180 overhead reach … −10 at the hip
      const up = S(p) < 0 ? 1 : 0;                // recovery half: arm lifted out of the water, elbow bent
      return [[x, 0, sd * (6 + 26 * up)], [-(10 + 40 * up), 0, 0]];
    };
    const [aL, fL] = arm(a, 1), [aR, fR] = arm(a + Math.PI, -1);
    return {
      hips: [75, 6 * S(a), 4 * S(a), 0, 0, 0], spine: [0, -4 * S(a), 0], chest: [0, -8 * S(a), 0],
      neck: [-14, 0, 0], head: [-26, 10 * S(a), 0],
      armL: aL, forearmL: fL, handL: [-10, 0, 0], armR: aR, forearmR: fR, handR: [-10, 0, 0],
      legL: [18 * k, 0, 2], shinL: [14 + 12 * mx(0, -k), 0, 0], legR: [-18 * k, 0, -2], shinR: [14 + 12 * mx(0, k), 0, 0],
      skirt: [10, 0, 0, 0, 0, 0, 1.05, 0.9, 1.05],
      tail1: [10 + 8 * k, 26 * S(a * 2), 0], tail2: [6, 18 * S(a * 2 - 0.8), 0], tail3: [4, 14 * S(a * 2 - 1.6), 0],
      finL: [0, 0, 10 * S(a)], finR: [0, 0, -10 * S(a)]
    };
  }), { ease: 'linear', face: [[0, 'focus', 'o']] });
  // float: on her back, arms and legs spread loosely, slow bob, tail drifting
  def('float', 5, cyc(5, 12, ph => {
    const a = ph * TAU, s = S(a);
    return {
      hips: [-90 + 2 * s, 0, s, 0, 0.4 * s, 0], spine: [-2, 0, 0], neck: [-6, 0, 0], head: [-6 + 2 * S(a + 1), 4 * s, 0],
      armL: [0, 0, 62 + 6 * s], forearmL: [-12, 0, 8], armR: [0, 0, -62 - 6 * s], forearmR: [-12, 0, -8],
      handL: [0, 0, 0], handR: [0, 0, 0],
      legL: [4, 0, 12 + 2 * s], shinL: [6, 0, 0], legR: [4, 0, -12 - 2 * s], shinR: [6, 0, 0],
      skirt: [0, 0, 0, 0, 0, 0, 1.08, 1, 0.75], tail1: [-6, 8 * s, 0], tail2: [-4, 6 * S(a - 0.8), 0],
      finL: [0, -20, 0], finR: [0, 20, 0], hairBack: [-20, 0, 0]
    };
  }), { ease: 'smooth', face: [[0, 'half', 'smile']] });
})();
// ---- procedural layers: V3.girlv1Anim.drive(girl) — breathing, tail, follow-through, look-at, clip faces, blink -------
// All layers ADD to whatever the player wrote (rest + clip), so the rest rotations are always kept.
(function () {
  const A = V3.girlv1Anim, R = Math.PI / 180, S = Math.sin, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // tail: amplitude (deg) and speed (Hz) per mood; locomotion clips scale them up
  const MOOD = { calm: { amp: 7, hz: 0.45, expr: 'neutral' }, happy: { amp: 10, hz: 0.9, expr: 'happy' },
    sleepy: { amp: 6, hz: 0.28, expr: 'sleepy' }, pout: { amp: 8, hz: 0.7, expr: 'pout' } };
  const MOVE = { walk: [1.4, 2.2], run: [1.8, 3.4], swim: [2.2, 1.9], wade: [1.3, 1.6], hop: [1.4, 2] };   // [amp ×, speed ×]
  const st = A._st = { mood: 'calm', look: null, yaw: 0, pitch: 0, tailPh: 0, tailK: [1, 1], vel: new THREE.Vector3(),
    last: null, faceKey: -1, faceClip: null, blinkT: 2, blinkOn: 0, talkEnd: 0, sway: [0, 0] };
  const faceOf = g => g && g.face;
  const impl = g => { const f = faceOf(g); const i = f && (f.impl || f); return i && typeof i.expr === 'function' &&
    typeof i.talk === 'function' && typeof i.blink === 'function' ? i : null; };
  // clip face key → eyes/mouth, or '@preset' → face.expr(preset)
  const setFace = (g, eyes, mouth) => {
    const f = faceOf(g), I = impl(g);
    if (!f) return;
    if (typeof eyes === 'string' && eyes[0] === '@') { if (I) I.expr(eyes.slice(1)); else if (eyes === '@pout') { f.eyes('angry'); f.mouth('pout'); } return; }
    if (eyes) f.eyes(eyes); if (mouth) f.mouth(mouth);
  };
  const wind = () => { const w = V3.env && V3.env.state && V3.env.state.wind; return w && typeof w.speed === 'number' ? w.speed : 0; };
  const v3 = new THREE.Vector3(), h3 = new THREE.Vector3();
  A.drive = function (g) {
    if (!g || !g.player) return;
    if (A._off) A._off();
    A._driven = g;
    A._off = g.player.layer((b, t, dt) => {
      const p = g.player, cur = (p.current || '').replace(/^g\./, ''), m = MOOD[st.mood] || MOOD.calm;
      dt = Math.min(dt || 0, 0.1);
      // velocity from the root's world motion (the brain moves her root)
      const pos = g.root.getWorldPosition(v3);
      if (st.last && dt > 0) st.vel.lerp(h3.copy(pos).sub(st.last).divideScalar(dt), 1 - Math.exp(-dt * 6));
      st.last = (st.last || new THREE.Vector3()).copy(pos);
      const spd = Math.min(st.vel.length(), 4);
      // breathing: chest + shoulders, slower when sleepy / asleep
      const br = S(t * TAU() * (cur === 'sleep' || st.mood === 'sleepy' ? 0.22 : 0.33));
      if (b.chest) b.chest.rotation.x += -1.2 * R * br;
      if (b.armL) b.armL.rotation.z += 0.8 * R * br;
      if (b.armR) b.armR.rotation.z -= 0.8 * R * br;
      if (b.head) b.head.rotation.x += 0.6 * R * br;
      // tail layer: 6–10° sway on tail1..3 with a phase delay down the tail; faster + bigger while moving
      const mv = MOVE[cur] || [1 + spd * 0.25, 1 + spd * 0.5];
      st.tailK[0] += (mv[0] - st.tailK[0]) * (1 - Math.exp(-dt * 3));
      st.tailK[1] += (mv[1] - st.tailK[1]) * (1 - Math.exp(-dt * 3));
      st.tailPh += dt * m.hz * st.tailK[1] * Math.PI * 2;
      const amp = m.amp * st.tailK[0];
      ['tail1', 'tail2', 'tail3'].forEach((n, i) => {
        if (!b[n]) return;
        b[n].rotation.y += amp * (1 + i * 0.25) * R * S(st.tailPh - i * 0.9);
        b[n].rotation.x += amp * 0.25 * R * S(st.tailPh * 0.5 - i * 0.7);
      });
      // follow-through: hair, skirt, fins lag behind her motion; wind flutters them
      const w = wind(), fw = S(t * 7.3) * 0.6 + S(t * 11.1) * 0.4;
      const lean = clamp(spd * 6, 0, 18);
      st.sway[0] += ((lean + w * 4) - st.sway[0]) * (1 - Math.exp(-dt * 4));
      st.sway[1] = S(t * 2.1) * 1.2 + fw * w * 2.5;
      if (b.hairBack) b.hairBack.rotation.x += -(st.sway[0] + st.sway[1]) * R;
      if (b.hairL) b.hairL.rotation.z += (st.sway[1] * 0.8 + 1) * R * S(t * 1.7);
      if (b.hairR) b.hairR.rotation.z -= (st.sway[1] * 0.8 + 1) * R * S(t * 1.7 + 0.5);
      if (b.ahoge) b.ahoge.rotation.x += (S(t * 3.1) * 3 - st.sway[0] * 0.5 + fw * w * 3) * R;
      if (b.skirt) b.skirt.rotation.x += -st.sway[0] * 0.3 * R + fw * w * 1.5 * R;
      if (b.finL) b.finL.rotation.y += (S(t * 1.3) * 3 + st.sway[0] * 0.4) * R;
      if (b.finR) b.finR.rotation.y -= (S(t * 1.3 + 0.4) * 3 + st.sway[0] * 0.4) * R;
      // look-at: head yaw / pitch toward V3.girlv1Anim.lookAt target, eased, clamped
      let ty = 0, tp = 0;
      if (st.look && b.head) {
        const hp = b.head.getWorldPosition(h3); g.root.worldToLocal(hp);
        const tl = g.root.worldToLocal(v3.copy(st.look)).sub(hp);
        ty = clamp(Math.atan2(tl.x, tl.z), -1.05, 1.05);
        tp = clamp(-Math.atan2(tl.y, Math.hypot(tl.x, tl.z)), -0.5, 0.5);
        if (Math.abs(Math.atan2(tl.x, tl.z)) > 2.4) ty = tp = 0;        // behind her: don't twist the neck
      }
      const k = 1 - Math.exp(-dt * 5);
      st.yaw += (ty - st.yaw) * k; st.pitch += (tp - st.pitch) * k;
      if (b.head) { b.head.rotation.y += st.yaw * 0.7; b.head.rotation.x += st.pitch * 0.7; }
      if (b.neck) { b.neck.rotation.y += st.yaw * 0.3; b.neck.rotation.x += st.pitch * 0.3; }
      const f = faceOf(g);
      if (f && f.look) f.look(clamp(st.yaw * 0.6, -1, 1), clamp(-st.pitch * 0.8, -1, 1));
      // clip faces: apply the latest face key the base clip has passed
      const clip = V3.cuboid.clips[p.current], fk = clip && clip.face;
      if (fk) {
        const ct = p.time || 0; let j = -1;
        for (let i = 0; i < fk.length; i++) if (fk[i][0] <= ct + 1e-4) j = i;
        if (clip !== st.faceClip || j !== st.faceKey) { st.faceClip = clip; st.faceKey = j; if (j >= 0 && Date.now() >= st.talkEnd) setFace(g, fk[j][1], fk[j][2]); }
      } else st.faceClip = null;
      A._tickFace(g, t, dt);
    });
  };
  const TAU = () => Math.PI * 2;
  A.MOOD = MOOD;
})();
// ---- lookAt / mood / talk + fallback face (own blink only when V3.girlv1Face is missing) ----------------------------
(function () {
  const A = V3.girlv1Anim, st = A._st;
  const impl = g => { const f = g && g.face, i = f && (f.impl || f);
    return i && typeof i.expr === 'function' && typeof i.talk === 'function' && typeof i.blink === 'function' ? i : null; };
  A.lookAt = v => { st.look = v ? (st.look || new THREE.Vector3()).copy(v) : null; return A; };
  A.mood = name => {
    if (!A.MOOD[name]) return st.mood;
    st.mood = name;
    const g = A._driven, I = impl(g);
    if (I) I.expr(A.MOOD[name].expr);
    else if (g && g.face) {
      const fb = { calm: ['open', 'smile'], happy: ['happy', 'open'], sleepy: ['sleepy', 'flat'], pout: ['angry', 'pout'] }[name];
      g.face.eyes(fb[0]); g.face.mouth(fb[1]);
    }
    return name;
  };
  // talk(text): mouth moves for a duration from the text length (~0.11 s per char, 0.6–8 s)
  A.talk = text => {
    const n = String(text == null ? '' : text).length, sec = Math.max(0.6, Math.min(8, n * 0.11));
    const g = A._driven, I = impl(g);
    st.talkEnd = Date.now() + sec * 1000;
    if (I) I.talk(sec); else st.fbTalk = sec;
    return sec;
  };
  const FLAP = ['o', 'flat', 'a', 'o_', 'flat', 'e'];
  A._tickFace = (g, t, dt) => {
    if (impl(g) || !g.face) return;                       // the face module blinks + talks by itself
    const f = g.face, eyes = f.state && f.state.eyes;
    // own blink every 2–5 s (not while the eyes are shut by the clip / mood)
    if (st.blinkOn > 0) { st.blinkOn -= dt; if (st.blinkOn <= 0) f.eyes(st.blinkPrev || 'open'); }
    else if ((st.blinkT -= dt) <= 0) {
      st.blinkT = 2 + Math.random() * 3;
      if (!/closed|happy|joy|wink|sleep/.test(eyes || '')) { st.blinkPrev = eyes || 'open'; f.eyes('closed'); st.blinkOn = 0.12; }
    }
    if (st.fbTalk > 0) {
      st.fbTalk -= dt; st.flapT = (st.flapT || 0) - dt;
      if (st.flapT <= 0) { st.flapT = 0.1; st.flapI = ((st.flapI || 0) + 1 + (Math.random() * 2 | 0)) % FLAP.length; f.mouth(FLAP[st.flapI]); }
      if (st.fbTalk <= 0) f.mouth('smile');
    }
  };
})();
// ---- clips 7 (v3)：65-girl-actor 按 poseK 混进来的姿势 + 工作台里的中文名 ------------------------------------------
(function () {
  const A = V3.girlv1Anim, { cyc, seq, def, mix, P } = A, S = Math.sin, TAU = Math.PI * 2;
  // pickHold：蹲着，右手伸到地上（= 'pick' 0.7 s 那一帧），一直保持到 actor 让她站起来
  def('pickHold', 1.2, cyc(1.2, 4, ph => mix(P.crouch, { handR: [-30, 0, 0], head: [22 + 2 * S(ph * TAU), 0, 0] })), { ease: 'smooth' });
  // cheer：开心地蹦（'hop' 循环播放）
  const hop = V3.cuboid.clips['g.hop'];
  if (hop) def('cheer', hop.len, hop.tracks, { loop: true, ease: hop.ease || 'smooth' });
  // huddle：坐在门廊沿上（root 放在板子上，胯往下放 A.seat.chair px，小腿垂在台阶前），两手抱在胸前、低头、微微发抖
  const hud = (k) => mix(P.chair, { hips: [0, 0, 0, 0, -A.seat.chair, 0], spine: [18, 0, 0], chest: [6, 0, k * 1.5], head: [14, 0, k * 2],
    armL: [-44, 0, -18], forearmL: [-78, 0, -55], armR: [-44, 0, 18], forearmR: [-78, 0, 55], tail1: [-6, -85, 0] });
  def('huddle', 0.5, seq([[0, hud(0)], [0.12, hud(1)], [0.25, hud(-1)], [0.37, hud(0.6)], [0.5, hud(0)]]), { ease: 'linear' });
  A.CN = { idle: '待机', walk: '走路', run: '跑', hop: '蹦一下', wave: '挥手', sitChair: '坐椅子', sitSofa: '坐沙发', sitFloor: '坐地上',
    lieBed: '躺在床上', sleep: '睡觉', wake: '起床', cook: '做饭', ladle: '盛饭', serve: '端菜', eat: '吃饭', draw: '画画', write: '写日记',
    type: '打字', read: '看书', watchTv: '看电视', rock: '摇椅', pick: '捡东西', look: '看海', yawn: '打哈欠', pout: '嘟嘴',
    doorOpen: '开门', change: '转圈换衣服', shoesOff: '脱鞋', stretch: '伸懒腰', wade: '蹚水', swim: '游泳', float: '漂浮',
    pickHold: '蹲着伸手（游戏）', cheer: '欢呼（游戏）', huddle: '缩着坐（游戏）' };
})();
})(window.V3);
