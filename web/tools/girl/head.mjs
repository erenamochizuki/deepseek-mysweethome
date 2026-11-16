// tools/girl/head.mjs — whale-girl v3 HEAD, block-modelled (rotated / chamfered / tapered blocks of mixed sizes).
// Targets: refs/girl-head-turnaround.png (front view measured: hair 24.5 u wide, face window x ±8.5, fins to x ±20),
// girl-head-parts.png, girl-face-closeup.png, head of refs/concept-girl.png; depth cross-checked against the
// user's smooth model (小鲸鱼3d模型/, proportion reference only).
// Head-local design units (1 u = 0.02 m): y = 0 at the chin line, x = 0 centre (+x = her left), face plane z = 8.5.
import { Model, C, add, sub, mul, norm, cross, dot, smooth, hash, mat } from './kit.mjs';

export const PAL = {
  skin: 0xffcdae, neck: 0xe6b298,
  hair: 0x2a4290, hairLt: 0x3149a0, hairDk: 0x223679, hairDeep: 0x1a2a62,
  hairMid: 0x3462b8, tip1: 0x4388d8, tip2: 0x5aa8ec, tip3: 0x86ccf5,
  fin: 0x22357a, finTop: 0x283d86, finLt: 0xf4f6fb, finSh: 0xd5dbe8,
  white: 0xfcfdff, whiteSh: 0xe3e8f2,
  bow: 0x3486d6, bowDk: 0x1f5fae, gold: 0xe8c25a,
  ahoge: 0x2a4290,
};
// hair colour by height: crown navy -> sky-blue curls
export const hairAt = (y) => C.grad([[-9, PAL.tip3], [-5.5, PAL.tip2], [-2, PAL.tip1], [2, PAL.hairMid], [6, PAL.hair]], y);

// ---- skull + face: chamfered block, its flat front = textured face plane (V3.girlFace3) ----
const SK = { x: 9.5, y0: 0, y1: 17.5, z0: -8.5, z1: 8.5 };
function skull(m, F) {
  m.use({ part: '脸', bone: 'head', mat: 'block' });
  const c = [0, (SK.y0 + SK.y1) / 2, (SK.z0 + SK.z1) / 2], s = [SK.x * 2, SK.y1 - SK.y0, SK.z1 - SK.z0];
  const ch = { 'x+z+': 1.0, 'x-z+': 1.0, 'x+y-': [1.6, 3.2], 'x-y-': [1.6, 3.2], 'y-z-': 3, 'x+y+': 3, 'x-y+': 3, 'y+z-': 3, 'y+z+': 2, 'x+z-': 3, 'x-z-': 3 };
  const front = (n) => n[2] > 0.999, R = F.rect;
  // one element: its flat front goes on the 'face' material (expression texture), the rest is skin
  m.box(c, s, { ch, col: F.SKIN || PAL.skin, faceMat: front, uv: (p) => [(p[0] - R.x0) / (R.x1 - R.x0), (p[1] - R.y0) / (R.y1 - R.y0)] });
  m.use({ part: '脖子', bone: 'neck', mat: 'block' });
  m.box([0, -0.9, -1.2], [4.2, 2.8, 3.8], { ch: { 'x+z+': 0.8, 'x-z+': 0.8, 'x+z-': 0.8, 'x-z-': 0.8 }, col: PAL.neck });
}

// ---- hair cap: rounded dome over the skull; strands and shingles cover it ----
const CAP = { x: 11.4, y0: 2.5, y1: 19.6, z0: -12.8, z1: 7.0 };
function cap(m) {
  m.use({ part: '头顶头发', bone: 'head' });
  const c = [0, (CAP.y0 + CAP.y1) / 2, (CAP.z0 + CAP.z1) / 2], s = [CAP.x * 2, CAP.y1 - CAP.y0, CAP.z1 - CAP.z0];
  m.box(c, s, {
    ch: { 'x+y+': [4.2, 4.0], 'x-y+': [4.2, 4.0], 'y+z-': [4.6, 5.4], 'y+z+': [2.6, 2.6], 'x+z-': 4.4, 'x-z-': 4.4, 'x+z+': 1.2, 'x-z+': 1.2 },
    col: PAL.hair,
  });
  // crown strands: slabs running from behind the band over the crown and down the back (rounded top, stripes)
  [[-8.3, 3.0, 0], [-5.0, 3.7, 1], [-1.5, 3.7, 0], [2.0, 3.7, 1], [5.3, 3.7, 0], [8.5, 2.9, 1]].forEach(([x, w, t], i) => {
    const side = Math.abs(x) > 7, y0 = side ? 17.5 : 19.65, lift = 0.15 * (i % 3);
    const pts = [[x, y0 + lift, 4.2], [x, y0 + 0.35 + lift, -2.5], [x * 1.02, y0 - 0.9 + lift, -8.6], [x * 1.04, y0 - 4.3, -12.6], [x * 1.05, y0 - 8.5, -13.4]];
    m.chain(Model.tube(pts, w, 1.3, [1, 0, 0]), { col: t ? PAL.hair : PAL.hairDk, jit: 0.06 });
  });
}
// rectangular ring at height y: x0..x1, zb..zf (zf = front)
const ringY = (y, x0, x1, zb, zf) => [[x0, y, zf], [x1, y, zf], [x1, y, zb], [x0, y, zb]];
// strand hanging from 'top' down to yStart, then curling outward along o (unit, horizontal): down -> out -> up,
// 'turn' degrees around a circle of radius r. Width w tangent to the head, depth d. Returns the end point.
function curl(m, top, yStart, o, r, turn, w, d, opt = {}) {
  const pts = [top, [top[0], yStart, top[2]]];
  const S = pts[1], Cc = add(S, mul(o, r)), up = [0, 1, 0];
  const steps = Math.max(3, Math.round(turn / 40));
  for (let k = 1; k <= steps; k++) {
    const ph = (k / steps) * turn * Math.PI / 180;
    pts.push(sub(sub(Cc, mul(o, r * Math.cos(ph))), mul(up, r * Math.sin(ph))));
  }
  const n = pts.length, ws = pts.map((_, i) => w * (1 - 0.55 * Math.pow(i / (n - 1), 1.5))), ds = pts.map((_, i) => d * (1 - 0.45 * i / (n - 1)));
  m.chain(Model.tube(pts, ws, ds, [-o[2], 0, o[0]]), { col: (nn, c) => hairAt(c[1] + (opt.bias || 0)), jit: 0.05 });
  return pts[n - 1];
}

// ringlet: helix hanging from 'top' (around a vertical axis offset along o by r), 'turns' turns over 'len'
function ringlet(m, top, len, o, r, turns, w, d, opt = {}) {
  const Cc = add(top, mul(o, r)), a0 = Math.atan2(-o[2], -o[0]), N = Math.max(5, Math.round(turns * 8));
  const pts = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N, a = a0 + (opt.dir || 1) * t * turns * Math.PI * 2, rr = r * (1 - 0.25 * t);
    pts.push([Cc[0] + Math.cos(a) * rr, top[1] - t * len, Cc[2] + Math.sin(a) * rr]);
  }
  const ws = pts.map((_, i) => w * (1 - 0.55 * i / N)), ds = pts.map((_, i) => d * (1 - 0.45 * i / N));
  m.chain(Model.tube(pts, ws, ds, [0, 1, 0]), { col: (nn, c) => hairAt(c[1] + (opt.bias || 0)), jit: 0.05 });
}

// ---- bangs: wide blunt blocks with slanted tips (centre strand longest, between the eyes) ----
const BANGS = [ // [x0, x1, tip y at x0, tip y at x1, front z, tone]
  [-8.9, -6.3, 10.0, 10.6, 9.6, 0], [-6.5, -3.7, 10.8, 10.2, 10.35, 1], [-3.9, -1.4, 8.9, 8.5, 9.75, 0],
  [-1.55, 1.55, 5.6, 5.5, 10.6, 1], [1.4, 4.1, 8.4, 8.8, 9.85, 0], [3.95, 6.7, 10.3, 10.9, 10.4, 1], [6.5, 8.9, 10.5, 9.9, 9.55, 0],
];
function bangs(m) {
  m.use({ part: '刘海', bone: 'head' });
  for (const [x0, x1, tl, tr, zf, tone] of BANGS) {
    const top = Math.max(tl, tr);
    const rings = [
      ringY(19.0, x0, x1, zf - 5.4, zf - 2.6), ringY(16.4, x0, x1, zf - 3.0, zf - 0.4), ringY(top + 1.6, x0 + 0.05, x1 - 0.05, zf - 2.1, zf),
      [[x0 + 0.25, tl, zf - 0.1], [x1 - 0.25, tr, zf - 0.1], [x1 - 0.25, tr + 0.5, zf - 1.5], [x0 + 0.25, tl + 0.5, zf - 1.5]],
    ];
    const base = tone ? PAL.hairLt : PAL.hair;
    m.chain(rings, { col: (n) => (n[1] < -0.45 ? PAL.hairDk : base), jit: 0.04 });
  }
}
// front view: is face point (u, v) hidden behind the bangs or the face-framing side panels? (for the face-edit guide)
export function faceCovered(u, v) {
  if (v >= 16.4) return true;
  if (v >= 0.4 && Math.abs(u) >= (v < 1.4 ? 8.0 : 8.3)) return true;
  for (const [x0, x1, tl, tr] of BANGS) if (u >= x0 && u <= x1 && v >= tl + (tr - tl) * (u - x0) / (x1 - x0)) return true;
  return false;
}
// ---- side hair: thick panels framing the face (hooking in at the chin) + '( )' locks below the fins ----
function sideLocks(m) {
  m.use({ part: '侧发', bone: 'head' });
  for (const s of [-1, 1]) {
    const R = (y, a, b, zb, zf) => (s < 0 ? ringY(y, -b, -a, zb, zf) : ringY(y, a, b, zb, zf));
    // slanted tip ring: y0 at the inner edge, y1 at the outer edge
    const tip = (yIn, yOut, a, b, zb, zf) => {
      const xi = s * a, xo = s * b, top = Math.max(yIn, yOut) + 0.6;
      return [[xi, yIn, zf], [xo, yOut, zf], [xo, top, zb], [xi, top, zb]];
    };
    const col = (n, c) => (n[1] < -0.45 ? PAL.hairDk : hairAt(c[1] + 3));
    // inner panel: over the cheek edge, its tip hooks toward the chin
    m.chain([R(17.5, 8.5, 10.6, 3.0, 9.0), R(12.0, 8.4, 10.6, 3.5, 9.8), R(5.0, 8.35, 10.5, 3.6, 9.75), R(2.0, 8.3, 10.3, 3.8, 9.6), tip(0.4, 1.4, 8.0, 9.8, 4.4, 9.4)], { col, jit: 0.04 });
    // outer panel: to the hair edge
    m.chain([R(17.0, 10.3, 11.7, 2.2, 8.4), R(10.0, 10.4, 11.8, 2.6, 9.2), R(4.0, 10.4, 11.9, 2.8, 9.0), tip(2.0, 1.0, 10.2, 11.7, 3.2, 8.6)], { col, jit: 0.05 });
    // '( )' locks: from under the fin, bulging out, ending in a light-blue curl
    m.chain(Model.tube([[s * 11.0, 6.0, 5.6], [s * 12.4, 2.5, 6.1], [s * 12.8, -0.5, 6.3]], [2.8, 2.8, 2.6], [1.8, 1.8, 1.8], [1, 0, 0]), { col: (n, c) => hairAt(c[1]), jit: 0.05 });
    curl(m, [s * 12.8, -0.5, 6.3], -2.2, norm([s, 0, 0.25]), 2.8, 145, 2.8, 1.9);
    // curls under the face panels (front ends of the long hair)
    curl(m, [s * 9.2, 1.6, 7.2], -1.4, norm([s * 0.6, 0, 1]), 1.5, 120, 2.4, 1.6, { bias: 0.4 });
    curl(m, [s * 10.8, 1.8, 4.6], -4.4, norm([s, 0, 0.2]), 2.6, 120, 2.6, 1.8, { bias: -0.6 });
  }
}
// outline of the cap's horizontal section (superellipse fit to the chamfered rectangle) at angle a (deg):
// a = 0 points to her left (+x), a = -90 to the back (-z). Returns point + outward normal.
function capRing(a, grow = 0) {
  const X = CAP.x + grow, Z0 = CAP.z0 - grow, Z1 = CAP.z1 + grow, n = 5;
  const dx = Math.cos(a * Math.PI / 180), dz = Math.sin(a * Math.PI / 180);
  const zc = (Z0 + Z1) / 2, hx = X, hz = (Z1 - Z0) / 2;
  const r = Math.pow(Math.pow(Math.abs(dx) / hx, n) + Math.pow(Math.abs(dz) / hz, n), -1 / n);
  const p = [dx * r, 0, zc + dz * r];
  const nn = norm([Math.sign(dx) * Math.pow(Math.abs(p[0] / hx), n - 1) / hx, 0, Math.sign(dz) * Math.pow(Math.abs((p[2] - zc) / hz), n - 1) / hz]);
  return { p, n: nn };
}
// ---- back hair: bell of strand columns (flush with the cap, flaring below the ears), many light-blue curls,
//      thin curly tendrils at the sides ----
function backHair(m) {
  m.use({ part: '后发', bone: 'hairBack' });
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = -200 + (i / (N - 1)) * 220;
    const { p, n } = capRing(a, 0.15);
    const side = Math.abs(Math.cos(a * Math.PI / 180));
    const h1 = hash(i, 3.3), h2 = hash(i, 1.7), w = 3.3 + h1 * 0.6;
    const tan = [-n[2], 0, n[0]];
    const at = (y, out) => add([p[0], y, p[2]], mul(n, out));
    const yTop = 15.5 - side * 2.0;
    const flare = (y) => 0.25 + 0.35 * h1 + 3.8 * smooth(6, -5, y) * (0.6 + 0.4 * side);
    const pts = [at(yTop, 0.25), at(8, flare(8)), at(3, flare(3)), at(-1, flare(-1))];
    m.chain(Model.tube(pts, [w, w, w * 0.98, w * 0.95], [1.8, 1.9, 2.0, 2.0], tan), { col: (nn, c) => hairAt(c[1] + (h2 - 0.5) * 1.5), jit: 0.06 });
    ringlet(m, pts[3], 5.5 + h2 * 3.0, n, 1.1 + h1 * 0.5, 0.9 + h2 * 0.5, w * 0.85, 1.9, { bias: (h1 - 0.5), dir: i % 2 ? 1 : -1 });
    if (i % 2 === 1) {                                // a second, thinner curl beside it -> fuller bottom
      const off = add(pts[3], add(mul(tan, w * 0.3 * (h2 > 0.5 ? 1 : -1)), mul(n, 0.6)));
      ringlet(m, off, 7.5 + h1 * 2.0, norm(add(n, mul(tan, 0.3))), 0.9, 1.4, w * 0.5, 1.3, { bias: -0.5, dir: -1 });
    }
  }
  // thin curly tendrils just behind the fins (ringlets in the reference back view)
  for (const s of [-1, 1]) {
    const x0 = s * 12.6, z0 = -2.5;
    const pts = [];
    for (let k = 0; k <= 7; k++) { const y = 3.5 - k * 1.25; pts.push([x0 + s * (0.6 + 0.9 * Math.sin(k * 1.3)), y, z0 + 0.9 * Math.cos(k * 1.3)]); }
    m.chain(Model.tube(pts, 1.3, 1.0, [0, 0, 1]), { col: (nn, c) => hairAt(c[1] - 0.5), jit: 0.04 });
  }
}
// ---- whale-fin ears: big wedges out of the hair sides (root 6.5 u tall), nearly horizontal, swept back ~27°;
//      navy body with a slanted top, white underside block visible from the front ----
function fins(m) {
  for (const s of [-1, 1]) {
    const X = norm([s, -0.04, -0.26]), Y0 = [0, 1, 0];
    const Y = norm(sub(Y0, mul(X, dot(Y0, X)))), Z = norm(cross(X, Y));
    m.use({ part: '鲸鳍耳', bone: s > 0 ? 'finL' : 'finR' });
    m.push({ at: [s * 11.3, 7.2, 0.2], m: mat.cols(X, Y, Z) });
    const sec = (x, y0, y1, hz) => [[x, y0, -hz], [x, y0, hz], [x, y1, hz], [x, y1, -hz]];
    m.chain([sec(0, -1.0, 3.9, 2.8), sec(4.0, -1.2, 2.6, 2.4), sec(7.8, -1.4, 0.9, 1.6), sec(10.6, -1.6, -0.5, 0.7)],
      { col: (n) => (n[1] > 0.55 ? PAL.finTop : PAL.fin), jit: 0.02 });
    m.chain([sec(0.3, -3.6, -0.9, 2.8), sec(4.0, -3.4, -1.1, 2.45), sec(7.8, -3.0, -1.3, 1.65), sec(10.8, -2.5, -1.5, 0.75)],
      { col: (n) => (n[1] < -0.6 ? PAL.finSh : PAL.finLt) });
    m.pop();
  }
}
// ---- frilly maid headband: big white blocks along an arch hugging the crown, tilted forward; inner grey row ----
function headband(m) {
  m.use({ part: '头饰', bone: 'head' });
  m.push({ at: [0, 9.6, 1.7], rot: [24, 0, 0] });
  const A = 13.3, B = 10.9, n = 3.4;
  const arch = (t) => {
    const th = t * Math.PI * 0.5, sx = Math.sin(th), cy = Math.cos(th);
    const p = [A * Math.sign(sx) * Math.pow(Math.abs(sx), 2 / n), B * Math.sign(cy) * Math.pow(Math.abs(cy), 2 / n), 0];
    const g = [Math.sign(p[0]) * Math.pow(Math.abs(p[0] / A), n - 1) / A, Math.sign(p[1]) * Math.pow(Math.abs(p[1] / B), n - 1) / B, 0];
    p[2] = -4.2 * Math.pow(Math.abs(p[0]) / A, 2.2);
    return { p, nrm: norm(g) };
  };
  const N = 15;
  for (let k = 0; k < N; k++) {
    const t = (-1 + (2 * k) / (N - 1)) * 0.9;
    const { p, nrm } = arch(t), ang = Math.atan2(nrm[0], nrm[1]) * 180 / Math.PI;
    const big = k % 2 === 0;
    m.box(add(p, mul(nrm, big ? 0.9 : 0.1)), [3.4, big ? 3.8 : 2.6, big ? 3.3 : 2.7], {
      rot: [0, 0, -ang], ch: { 'y+z+': 0.5, 'y+z-': 0.5 }, col: (nn) => (nn[2] < -0.6 ? PAL.whiteSh : PAL.white), jit: 0.02,
    });
  }
  for (let k = 0; k < N - 1; k++) {
    const t = (-1 + (2 * k + 1) / (N - 1)) * 0.9;
    const { p, nrm } = arch(t), ang = Math.atan2(nrm[0], nrm[1]) * 180 / Math.PI;
    m.box(add(p, mul(nrm, -1.3)), [3.0, 2.0, 3.6], { rot: [0, 0, -ang], col: PAL.whiteSh, jit: 0.02 });
  }
  m.pop();
}
// ---- light-blue bows at both band ends, facing outward (6 u wide, 5 u tall) ----
function bows(m) {
  m.use({ part: '蝴蝶结', bone: 'head' });
  for (const s of [-1, 1]) {
    const bo = norm([s * 0.75, 0, 0.66]), bf = [bo[2], 0, -bo[0]];   // bow faces out + forward (45°)
    m.push({ at: [s * 14.5, 10.8, 0.6], m: mat.cols(bf, [0, 1, 0], bo) });   // local x = front/back, z = outward
    m.box([0, 0, 0.3], [1.6, 1.9, 1.7], { ch: { 'x+z+': 0.3, 'x-z+': 0.3 }, col: PAL.bowDk });
    m.box([0, 0.1, 1.25], [0.6, 0.6, 0.3], { col: PAL.gold });
    for (const u of [-1, 1]) {
      const loop = [[u * 0.7, -1.0, -0.8], [u * 0.7, 1.0, -0.8], [u * 0.7, -1.0, 1.0], [u * 0.7, 1.0, 1.0],
        [u * 3.7, -1.8, -0.7], [u * 3.7, 3.0, -0.7], [u * 3.7, -1.8, 0.9], [u * 3.7, 3.0, 0.9]];
      m.hullBlock(loop, { col: (n) => (Math.abs(n[0]) > 0.85 || n[1] < -0.7 ? PAL.bowDk : PAL.bow) });
      m.chain(Model.tube([[u * 0.4, -0.7, 0.4], [u * 1.2, -2.3, 0.45], [u * 1.8, -3.6, 0.4]], [1.0, 0.95, 0.7], [0.6, 0.6, 0.5], [1, 0, 0]), { col: PAL.bow });
    }
    m.pop();
  }
}
// ---- ahoge: thick '?' curl out of the crown, curling over to her left and down ----
function ahoge(m) {
  m.use({ part: '呆毛', bone: 'ahoge' });
  const pts = [[-1.6, 18.6, 0.4], [-1.9, 21.4, 0.5], [-1.2, 23.8, 0.6], [0.7, 25.0, 0.6], [3.0, 25.1, 0.5], [4.6, 23.9, 0.3], [4.8, 22.3, 0.1], [3.8, 21.3, -0.1]];
  const depth = [2.2, 2.2, 2.1, 2.1, 2.0, 1.9, 1.7, 1.3], thick = [2.7, 2.7, 2.6, 2.5, 2.4, 2.2, 1.9, 1.2];
  m.chain(Model.tube(pts, depth, thick, [0, 0, 1]), { col: (n) => (n[1] < -0.5 ? PAL.hairDk : PAL.ahoge), jit: 0.02 });
}
export function buildHead(F, edits = null) {
  const m = new Model('小鲸鱼头部');
  m.edits = edits;
  m.bone('neck', [0, -3.8, -0.6]);
  m.bone('head', [0, -0.2, -0.8], 'neck');
  m.bone('hairBack', [0, 12, -9], 'head');
  m.bone('ahoge', [-1.4, 19.2, 0.5], 'head');
  m.bone('finL', [11.4, 7.2, 0.2], 'head');
  m.bone('finR', [-11.4, 7.2, 0.2], 'head');
  for (const f of [skull, cap, bangs, sideLocks, backHair, fins, headband, bows, ahoge]) f(m, F);
  return m;
}
