// tools/girl/head4.mjs — whale-girl v4 HEAD (rebuilt 2026-11-05 from the user's Tripo model; v3 is archived in
// archive/girl-v3/). Direction from the user: mostly square blocks, slanted faces only as chamfers on the cheek hair
// and under the fins; follow Tripo for the hair, ahoge, bows and proportions; follow refs/concept-girl.png for
// two things: the fins sweep back and down, and the headband's white cubes run from the crown down to the bows.
//
// Sources:
//   hair (bangs, side locks, crown, the long hair down to the waist), ahoge, bows: the Tripo template
//     refs/models/whale-girl-head-v4.template.json (0.5 u labelled voxels, made by tools/girl/tripo-template.mjs),
//     merged into blocks (vertical strands, at most 2 x 2 u across);
//   face block, neck, fins, headband, the hidden inner cap: designed here.
// Head frame: y = 0 at the chin, x = 0 centre (+x = her left), face plane z = 8.5, 1 u = 0.02 m (same as v3).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Model, C, add, sub, mul, norm, cross, dot, clamp, hash, mat } from './kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEMPLATE = path.join(ROOT, 'refs/models/whale-girl-head-v4.template.json');
const D2R = Math.PI / 180;

export const PAL4 = {
  hair: 0x2a4290, hairLt: 0x31499e, hairDk: 0x223679, hairDeep: 0x1a2a62,
  tip1: 0x3460b6, tip2: 0x3f80d2, tip3: 0x52a2e6, tip4: 0x6cbdf0, tip5: 0x8ad0f6,
  fin: 0x22357a, finTop: 0x293f88, finLt: 0xf4f6fb, finSh: 0xd9dfec,
  white: 0xfcfdff, whiteSh: 0xe4e9f3,
  bow: 0x3486d6, bowDk: 0x2668b8, ahoge: 0x26398a, neck: 0xe9bfa9,
};
// hair colour by height band: crown navy -> sky-blue tips (Tripo's gradient starts just below the chin)
export const hairAt4 = (y) => C.grad([[-16, PAL4.tip5], [-13, PAL4.tip4], [-10, PAL4.tip3], [-6.5, PAL4.tip2], [-3, PAL4.tip1], [0.5, PAL4.hair]], y);
// the expression texture covers x -9..9, y FACE_Y0..FACE_Y0+17 on the face plane: moved 0.7 u down from v3 so the
// eyes sit where Tripo's eyes are (just under the bangs) and the mouth at Tripo's mouth
export const FACE_Y0 = -0.7;
export const FACE_RECT = { x0: -9, x1: 9, y0: FACE_Y0, y1: FACE_Y0 + 17 };
export const FACE_BOX = { x: 8.5, y0: 0, y1: 12.75, z0: 4, z1: 8.5, chinX: 6.75, chinY: 1.0 };

// ---------- face-edit guide (tools/girl/face-edit.mjs) ----------
// texel at texture units (u, v) (v up from the texture's bottom edge) -> 'out' (not on the v4 face plane),
// 'hair' (behind the bangs) or null (visible)
let frontMask = null;
export function faceGuide4(u, v) {
  const x = u, y = v + FACE_Y0, FB = FACE_BOX;
  if (y < FB.y0 || y > FB.y1 || Math.abs(x) > FB.x || (y < FB.chinY && Math.abs(x) > FB.chinX)) return 'out';
  if (!frontMask) frontMask = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8')).front;
  const f = frontMask, c = Math.floor((x - f.box[0]) / f.res), r = Math.floor((f.box[3] - y) / f.res);
  return r >= 0 && r < f.rows.length && c >= 0 && c < f.rows[r].length && f.rows[r][c] === '1' ? 'hair' : null;
}

// ---------- voxel grids ----------
export class VGrid {
  constructor(res, g0, N, data) { this.res = res; this.g0 = g0; this.N = N; this.d = data || new Uint8Array(N[0] * N[1] * N[2]); }
  I(i, j, k) { return (k * this.N[1] + j) * this.N[0] + i; }
  inb(i, j, k) { return i >= 0 && j >= 0 && k >= 0 && i < this.N[0] && j < this.N[1] && k < this.N[2]; }
  get(i, j, k) { return this.inb(i, j, k) ? this.d[this.I(i, j, k)] : 0; }
  set(i, j, k, v) { if (this.inb(i, j, k)) this.d[this.I(i, j, k)] = v; }
  c(i, j, k) { const r = this.res, g = this.g0; return [g[0] + (i + 0.5) * r, g[1] + (j + 0.5) * r, g[2] + (k + 0.5) * r]; }
  ijk(x, y, z) { const r = this.res, g = this.g0; return [Math.floor((x - g[0]) / r), Math.floor((y - g[1]) / r), Math.floor((z - g[2]) / r)]; }
  at(x, y, z) { const [i, j, k] = this.ijk(x, y, z); return this.get(i, j, k); }
  each(fn) { const [X, Y, Z] = this.N; for (let k = 0; k < Z; k++) for (let j = 0; j < Y; j++) for (let i = 0; i < X; i++) fn(i, j, k); }
  clone() { return new VGrid(this.res, this.g0, this.N, this.d.slice()); }
}
// separable cube morphology (radius r voxels): max = dilate, min = erode; outside the grid counts as empty
function morph(G, r, isMax) {
  let a = G.d, [X, Y, Z] = G.N;
  const strides = [1, X, X * Y], lens = [X, Y, Z];
  for (let ax = 0; ax < 3; ax++) {
    const b = new Uint8Array(a.length), st = strides[ax], L = lens[ax];
    G.each((i, j, k) => {
      const p = [i, j, k][ax], id = G.I(i, j, k);
      let v = isMax ? 0 : 1;
      for (let q = -r; q <= r; q++) {
        const pp = p + q, w = pp < 0 || pp >= L ? 0 : a[id + q * st];
        if (isMax ? w : !w) { v = isMax ? 1 : 0; break; }
      }
      b[id] = v;
    });
    a = b;
  }
  return new VGrid(G.res, G.g0, G.N, a);
}
// closing with the cavity filled: dilate, mark everything reachable from the border through empty voxels as
// outside, the rest is solid, erode back
export function closeFill(G, r) {
  const D = morph(G, r, true), out = new Uint8Array(D.d.length), q = [];
  D.each((i, j, k) => {
    if ((i === 0 || j === 0 || k === 0 || i === G.N[0] - 1 || j === G.N[1] - 1 || k === G.N[2] - 1) && !D.d[D.I(i, j, k)]) { out[D.I(i, j, k)] = 1; q.push(i, j, k); }
  });
  for (let p = 0; p < q.length; p += 3) {
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const i = q[p] + a, j = q[p + 1] + b, k = q[p + 2] + c;
      if (!D.inb(i, j, k)) continue;
      const id = D.I(i, j, k);
      if (out[id] || D.d[id]) continue;
      out[id] = 1; q.push(i, j, k);
    }
  }
  const S = new VGrid(G.res, G.g0, G.N, out.map((v) => (v ? 0 : 1)));
  const E = morph(S, r, false);
  for (let id = 0; id < E.d.length; id++) if (G.d[id]) E.d[id] = 1;
  return E;
}
// greedy blocks over a voxel set: a run along y first (strands), then widened along x (<= maxX voxels) and z
// (<= maxZ voxels); voxels with a different key (colour band, part, bone) never share a block
function mergeBoxes(G, has, key, { maxX = 4, maxZ = 4, maxY = 1e9 } = {}) {
  const [NX, NY, NZ] = G.N, used = new Uint8Array(NX * NY * NZ), out = [];
  const free = (i, j, k, kk) => has(i, j, k) && !used[G.I(i, j, k)] && key(i, j, k) === kk;
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    if (!has(i, j, k) || used[G.I(i, j, k)]) continue;
    const kk = key(i, j, k);
    let j1 = j; while (j1 + 1 < NY && j1 + 1 - j < maxY && free(i, j1 + 1, k, kk)) j1++;
    const col = (ii, kz) => { for (let jj = j; jj <= j1; jj++) if (!free(ii, jj, kz, kk)) return false; return true; };
    let i1 = i; while (i1 + 1 < NX && i1 + 1 - i < maxX && col(i1 + 1, k)) i1++;
    const slab = (kz) => { for (let ii = i; ii <= i1; ii++) if (!col(ii, kz)) return false; return true; };
    let k1 = k; while (k1 + 1 < NZ && k1 + 1 - k < maxZ && slab(k1 + 1)) k1++;
    for (let kz = k; kz <= k1; kz++) for (let ii = i; ii <= i1; ii++) for (let jj = j; jj <= j1; jj++) used[G.I(ii, jj, kz)] = 1;
    const lo = G.c(i, j, k).map((v) => v - G.res / 2), hi = G.c(i1, j1, k1).map((v) => v + G.res / 2);
    out.push({ lo, hi, key: kk });
  }
  return out;
}

// ---------- template ----------
export function loadTemplate(file = TEMPLATE) {
  const D = JSON.parse(fs.readFileSync(file, 'utf8'));
  const G = new VGrid(D.res, D.g0, D.N, zlib.inflateSync(Buffer.from(D.grid, 'base64')));
  return { D, G, L: D.labels, lab: (i, j, k) => G.get(i, j, k) & 15, front: D.front };
}

export function buildHead4(F, edits) {
  const m = new Model('小鲸鱼头部 v4');
  m.edits = edits || null;
  const T = loadTemplate(), Lb = T.L, G = T.G;
  // ---- bones (pivots in the head frame) ----
  m.bone('neck', [0, -3.6, 1.6]);
  m.bone('head', [0, -0.4, 1.4], 'neck');
  m.bone('hairBack', [0, -1.0, -5.0], 'head');
  m.bone('finL', [11.4, 6.4, 0.6], 'head');
  m.bone('finR', [-11.4, 6.4, 0.6], 'head');
  const FB = FACE_BOX;
  const inFace = (x, y, z) => z > FB.z0 && z < FB.z1 && y > FB.y0 && y < FB.y1 && Math.abs(x) < (y < FB.chinY ? FB.chinX : FB.x);
  // the front of the face (bangs) comes from Tripo's front view, not from the voxels
  const FRONT = (x, y, z) => Math.abs(x) < 10 && y > -1 && y < 18 && z > 8.25;

  // ---- 0.5 u parts from the template ----
  const hair05 = new VGrid(G.res, G.g0, G.N), ahoge = new VGrid(G.res, G.g0, G.N), bows = new VGrid(G.res, G.g0, G.N);
  G.each((i, j, k) => {
    const L = T.lab(i, j, k), y = G.c(i, j, k)[1], id = G.I(i, j, k);
    if (L === Lb.hair) hair05.d[id] = 1;
    else if (L === Lb.ahoge) ahoge.d[id] = 1;
    else if (L === Lb.bow) bows.d[id] = 1;
    // Tripo's own headband sits on the crown: below the dome top it becomes hair, the frills above are dropped
    // (the v4 headband is a new row of cubes, see below)
    else if ((L === Lb.band || L === Lb.bandN) && y < 19.25) hair05.d[id] = 1;
  });
  // Tripo's hair is a thin, hollow shell: close its holes (1 u) and fill the inside
  const solid05 = closeFill(hair05, 2);
  // bangs: Tripo's front view over the face, as a 1 u thick panel just in front of the face plane (0.5 u cells)
  const bangs = new VGrid(G.res, G.g0, G.N), fr = T.front;
  fr.rows.forEach((row, r) => [...row].forEach((v, c) => {
    if (v !== '1') return;
    const x = fr.box[0] + (c + 0.5) * fr.res, y = fr.box[3] - (r + 0.5) * fr.res;
    for (const z of [8.75, 9.25]) { const [i, j, k] = bangs.ijk(x, y, z); bangs.set(i, j, k, 1); }
  }));
  // ---- 1 u hair: 2 x 2 x 2 cells of the closed shell, minus the face block and the bangs zone ----
  const N1 = G.N.map((v) => Math.floor(v / 2)), hair = new VGrid(1, G.g0, N1);
  hair.each((a, b, c) => {
    const [x, y, z] = hair.c(a, b, c);
    if (FRONT(x, y, z) || inFace(x, y, z)) return;
    let n = 0;
    for (let q = 0; q < 8; q++) n += solid05.get(2 * a + (q & 1), 2 * b + ((q >> 1) & 1), 2 * c + ((q >> 2) & 1));
    if (n >= 4) hair.set(a, b, c, 1);
  });
  // tidy the surface: a cell with at most one solid face-neighbour is a lone bump (dropped), an empty cell with five
  // or six is a dent (filled); the face block and the bangs zone count as solid so the hair stays sealed against them
  {
    const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const solidAt = (a, b, c) => { if (hair.get(a, b, c)) return true; if (!hair.inb(a, b, c)) return false; const p = hair.c(a, b, c); return inFace(...p) || FRONT(...p); };
    for (let pass = 0; pass < 2; pass++) {
      const add = [], del = [];
      hair.each((a, b, c) => {
        const p = hair.c(a, b, c);
        if (FRONT(...p) || inFace(...p)) return;
        let k = 0; for (const d of N6) if (solidAt(a + d[0], b + d[1], c + d[2])) k++;
        if (hair.get(a, b, c) && k <= 1) del.push([a, b, c]);
        else if (!hair.get(a, b, c) && k >= 5) add.push([a, b, c]);
      });
      for (const q of del) hair.set(...q, 0);
      for (const q of add) hair.set(...q, 1);
    }
  }
  // cheek hair (user: the hair at the cheeks is chamfered): a slanted wedge along each face edge, from the face's
  // front edge (|x| 8.5, z 8.5) back to the side hair (|x| 10, z 7); the voxel hair in that zone gives way
  const CHEEK = { x0: FB.x, x1: 10, z0: 6.5, z1: FB.z1, y0: FB.chinY, y1: FB.y1 };
  const inCheek = (x, y, z) => Math.abs(x) > CHEEK.x0 - 0.6 && Math.abs(x) < CHEEK.x1 && z > CHEEK.z0 && z < CHEEK.z1 + 0.6 && y > CHEEK.y0 && y < CHEEK.y1;
  hair.each((a, b, c) => { if (hair.get(a, b, c) && inCheek(...hair.c(a, b, c))) hair.set(a, b, c, 0); });
  // occupancy of everything solid (for hiding faces that touch another block)
  const occAt = (x, y, z) => hair.at(x, y, z) || bangs.at(x, y, z) || ahoge.at(x, y, z) || bows.at(x, y, z) || inFace(x, y, z) ||
    (Math.abs(x) > CHEEK.x0 && Math.abs(x) < CHEEK.x1 && z > CHEEK.z0 && z < CHEEK.z1 - (Math.abs(x) - CHEEK.x0) && y > CHEEK.y0 && y < CHEEK.y1);

  // ---- emit merged voxel blocks ----
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const exposure = (lo, hi) => DIRS.map((d) => {
    const ax = d.findIndex((v) => v !== 0), b = (ax + 1) % 3, c = (ax + 2) % 3;
    const p = [0, 0, 0]; p[ax] = d[ax] > 0 ? hi[ax] + 0.2 : lo[ax] - 0.2;
    for (let u = lo[b] + 0.25; u < hi[b]; u += 0.5) for (let v = lo[c] + 0.25; v < hi[c]; v += 0.5) { p[b] = u; p[c] = v; if (!occAt(p[0], p[1], p[2])) return true; }
    return false;
  });
  const faceIdx = (nrm) => { for (let f = 0; f < 6; f++) if (dot(nrm, DIRS[f]) > 0.999) return f; return -1; };
  function emitBlocks(boxes, opt) {
    let made = 0;
    for (const b of boxes) {
      const ex = exposure(b.lo, b.hi);
      if (!ex.some(Boolean)) continue;
      const c = mul(add(b.lo, b.hi), 0.5), sz = sub(b.hi, b.lo), o = opt(b, c, sz, ex);
      if (!o) continue;
      m.use({ part: o.part, bone: o.bone });
      m.box(c, sz, { col: o.col, jit: o.jit ?? 0.05, ch: o.ch, skip: (nrm) => { const f = faceIdx(nrm); return f >= 0 && !ex[f]; } });
      made++;
    }
    return made;
  }

  // ---- hair: 1 u strands (at most 2 x 2 u across), colour bands below the chin ----
  const band = (y) => (y < 0.5 ? Math.floor(y) : 99);
  const hairPart = (c) => (c[1] >= 14.5 ? '头顶头发' : Math.abs(c[0]) >= 7.5 && c[2] > -2.5 ? '侧发' : c[2] > 6 && Math.abs(c[0]) < 9 ? '刘海' : '后发');
  const PARTS = ['头顶头发', '刘海', '侧发', '后发'];
  const hairCol = (b, c) => (nrm) => {
    const along = Math.abs(nrm[0]) > 0.5 ? c[2] : c[0];   // the block centre: both triangles of a face agree
    const stripe = hash(Math.floor(along / 2), Math.abs(nrm[0]) > 0.5 ? Math.sign(nrm[0]) : 7, 3.1) < 0.3;
    const base = c[1] < 0.5 ? hairAt4(Math.floor(c[1]) + 0.5) : (stripe ? PAL4.hairLt : PAL4.hair);
    return nrm[1] < -0.5 ? C.shade(base, -0.16) : nrm[1] > 0.5 ? C.shade(base, 0.05) : base;
  };
  const nHair = emitBlocks(mergeBoxes(hair, (a, b, c) => hair.get(a, b, c), (a, b, c) => { const p = hair.c(a, b, c); return band(p[1]) * 8 + PARTS.indexOf(hairPart(p)); }, { maxX: 2, maxZ: 2 }),
    (b, c) => ({ part: hairPart(c), bone: c[1] < -1 ? 'hairBack' : 'head', jit: 0.012, col: hairCol(b, c) }));
  const nBangs = emitBlocks(mergeBoxes(bangs, (i, j, k) => bangs.get(i, j, k), () => 1, { maxX: 4, maxZ: 2 }),
    (b, c) => ({ part: '刘海', bone: 'head', jit: 0.04, col: hairCol(b, c) }));

  for (const s of [-1, 1]) {
    m.use({ part: '侧发', bone: 'head' });
    const xa = s * CHEEK.x0, xb = s * CHEEK.x1, key = s > 0 ? 'x+z+' : 'x-z+', dx = CHEEK.x1 - CHEEK.x0, dz = CHEEK.z1 - 7.0;
    for (let y = CHEEK.y0; y < CHEEK.y1 - 0.01; y += 2) {
      const y1 = Math.min(CHEEK.y1, y + 2), base = hash(s, y, 5.5) < 0.4 ? PAL4.hairLt : PAL4.hair;
      m.box2([Math.min(xa, xb), y, CHEEK.z0], [Math.max(xa, xb), y1, CHEEK.z1], { ch: { [key]: [dx, dz] }, jit: 0.025,
        col: (nrm) => (nrm[1] < -0.5 ? C.shade(base, -0.16) : Math.abs(nrm[0]) > 0.3 && nrm[2] > 0.3 ? C.shade(base, 0.04) : base) });
    }
  }

  // ---- ahoge (Tripo's flat curl), on its own bone pivoting at its root ----
  let aLo = null;
  ahoge.each((i, j, k) => { if (ahoge.get(i, j, k)) { const c = ahoge.c(i, j, k); if (!aLo || c[1] < aLo[1]) aLo = c; } });
  m.bone('ahoge', aLo ? [aLo[0], aLo[1] - 0.25, aLo[2]] : [0, 19.5, 4], 'head');
  const nAhoge = emitBlocks(mergeBoxes(ahoge, (i, j, k) => ahoge.get(i, j, k), () => 0, { maxX: 3, maxZ: 3, maxY: 4 }), () =>
    ({ part: '呆毛', bone: 'ahoge', jit: 0.05, col: (nrm) => (nrm[1] < -0.5 ? C.shade(PAL4.ahoge, -0.15) : PAL4.ahoge) }));

  // ---- bows (Tripo's ribbons) ----
  const nBow = emitBlocks(mergeBoxes(bows, (i, j, k) => bows.get(i, j, k), (i) => (bows.c(i, 0, 0)[0] > 0 ? 1 : 0), { maxX: 2, maxZ: 2, maxY: 3 }), () =>
    ({ part: '蝴蝶结', bone: 'head', jit: 0.04, col: (nrm) => (nrm[1] < -0.5 ? PAL4.bowDk : PAL4.bow) }));

  // ---- face block (flat front = the expression texture), chin step, neck ----
  {
    m.use({ part: '脸', bone: 'head', mat: 'block' });
    const R2 = FACE_RECT, front = (nrm) => nrm[2] > 0.999;
    const uv = (p) => [(p[0] - R2.x0) / (R2.x1 - R2.x0), (p[1] - R2.y0) / (R2.y1 - R2.y0)];
    const skin = F.SKIN || 0xf7e9dd;
    m.box2([-FB.x, FB.chinY, FB.z0], [FB.x, FB.y1, FB.z1], { col: skin, faceMat: front, uv });
    m.box2([-FB.chinX, FB.y0, FB.z0 + 0.5], [FB.chinX, FB.chinY, FB.z1], { col: skin, faceMat: front, uv });
    m.use({ part: '脖子', bone: 'neck' });
    m.box2([-2.2, -3.0, 0.5], [2.2, 0.5, 4.2], { col: PAL4.neck });
  }

  // ---- fins: Tripo's size, swept back and down like the concept; navy plate, white underside with chamfers ----
  const FIN = { L: 8.8, yaw: 34, droop: 12, t0: 3.2, t1: 1.3, slices: 8 };
  for (const s of [-1, 1]) {
    m.use({ part: '鲸鳍耳', bone: s > 0 ? 'finL' : 'finR' });
    const a = norm([s * Math.cos(FIN.yaw * D2R) * Math.cos(FIN.droop * D2R), -Math.sin(FIN.droop * D2R), -Math.sin(FIN.yaw * D2R) * Math.cos(FIN.droop * D2R)]);
    const up = norm(sub([0, 1, 0], mul(a, a[1]))), w = cross(a, up);
    m.push({ at: [s * 10.6, 6.4, 0.6], m: mat.cols(a, up, w) });
    const W = FIN.L / FIN.slices;
    for (let q = 0; q < FIN.slices; q++) {
      const u0 = q * W, u1 = (q + 1) * W, t = (q + 0.5) / FIN.slices;
      const top = 3.1 - 3.5 * Math.pow(t, 0.9), bot = -3.1 + 2.2 * t, th = FIN.t0 + (FIN.t1 - FIN.t0) * t;
      const wh = Math.min(1.1, (top - bot) * 0.35), navyLo = bot + wh;
      if (top - navyLo > 0.2) m.box2([u0, navyLo, -th / 2], [u1 + 0.02, top, th / 2], { col: (nrm) => (nrm[1] > 0.5 ? PAL4.finTop : PAL4.fin), jit: 0.03 });
      const cb = Math.min(0.55, wh * 0.5, th * 0.3);
      m.box2([u0, bot, -th / 2 + 0.05], [u1 + 0.02, navyLo, th / 2 - 0.05], { col: (nrm) => (Math.abs(nrm[1]) > 0.2 && Math.abs(nrm[1]) < 0.95 ? PAL4.finSh : PAL4.finLt), jit: 0.02, ch: { 'y-z+': cb, 'y-z-': cb } });
    }
    m.pop();
  }

  // ---- headband: white frill cubes from the crown down both sides to the bows (concept) ----
  {
    m.use({ part: '头饰', bone: 'head' });
    const tilt = Math.tan(20 * D2R), c0 = [0, 11.5], zAt = (y) => 0.6 + (y - 12) * tilt;
    const pts = [];
    for (let deg = -84; deg <= 84; deg += 1) {
      const d = [Math.sin(deg * D2R), Math.cos(deg * D2R)];
      let last = null;
      for (let r = 4; r < 22; r += 0.25) { const x = c0[0] + d[0] * r, y = c0[1] + d[1] * r; if (occAt(x, y, zAt(y))) last = r; else if (last != null && r - last > 1.5) break; }
      if (last == null) continue;
      const x = c0[0] + d[0] * (last + 1.0), y = c0[1] + d[1] * (last + 1.0);
      pts.push([x, y, zAt(y)]);
    }
    let acc = 0, next = 0; const at = [];
    for (let i = 0; i < pts.length; i++) {
      if (i) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc >= next) { at.push(pts[i]); next += 2.1; }
    }
    // two rows (front and back of the band), staggered like a ruffle
    at.forEach((p, i) => {
      for (const row of [0, 1]) {
        const big = (i + row) % 2 === 0, sz = big ? 2.3 : 1.9, out = big ? 0.25 : -0.1;
        const q = [p[0] + Math.sign(p[0]) * out * Math.abs(Math.sin(Math.atan2(p[0], p[1] - c0[1]))), p[1] + out, p[2] + (row ? -1.15 : 1.15)];
        m.box(q, [sz, sz, 2.2], { col: (nrm) => (nrm[1] < -0.5 ? PAL4.whiteSh : PAL4.white), jit: 0.025 });
      }
    });
  }
  return { model: m, stats: { hair: nHair, bangs: nBangs, ahoge: nAhoge, bow: nBow } };
}
