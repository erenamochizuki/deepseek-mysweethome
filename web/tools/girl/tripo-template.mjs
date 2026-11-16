// tools/girl/tripo-template.mjs — extract the v4 head template from the Tripo reference (dev tool).
//   node tools/girl/tripo-template.mjs   -> refs/models/whale-girl-head-v4.template.json
// The Tripo model (refs/models/tripo-ref.glb, git-ignored) is voxelised at 0.5 u in the v4 head frame
// (tools/girl/tripo.mjs: y = 0 at the chin, face plane z = 8.5, x centred), every voxel gets a colour class from the
// texture (nearest surface) and a part label. head4.mjs builds the v4 head from this template, so the build does not
// need the Tripo file. Labels: 0 empty, 1 hair, 2 ahoge, 3 bow, 4 Tripo headband (white), 5 Tripo headband band (navy),
// 6 Tripo fin, 7 face/skin, 8 body (dropped).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadTripo, voxelize, classify, ortho, HEAD_FRAME } from './tripo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'refs/models/whale-girl-head-v4.template.json');
const RES = 0.5, LO = [-26, -19, -17.5], HI = [26, 27.5, 12.5];
export const LABELS = { empty: 0, hair: 1, ahoge: 2, bow: 3, band: 4, bandN: 5, fin: 6, skin: 7, body: 8 };
const CLS = ['', 'H', 'L', 'N', 'W', 'S'];   // colour class codes 1..5

const t0 = Date.now();
const T = loadTripo({ frame: 'head' });
const V = voxelize(T, { lo: LO, hi: HI, res: RES });
const [NX, NY, NZ] = V.N, n = NX * NY * NZ, I = V.idx;
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// 1. colour class of surface voxels (vote over exposed faces), then flood inwards
const cls = new Uint8Array(n);
const queue = [];
for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  if (!V.at(i, j, k)) continue;
  const votes = [0, 0, 0, 0, 0, 0];
  for (const d of DIRS) {
    if (V.at(i + d[0], j + d[1], k + d[2])) continue;
    const c = V.center(i, j, k).map((v, a) => v + d[a] * RES / 2), s = V.colorAt(c, d);
    if (s) votes[Math.max(1, CLS.indexOf(classify(s.rgb)))]++;
  }
  const best = votes.indexOf(Math.max(...votes));
  if (votes[best] > 0) { cls[I(i, j, k)] = best; queue.push(i, j, k); }
}
for (let q = 0; q < queue.length; q += 3) {
  const i = queue[q], j = queue[q + 1], k = queue[q + 2], c = cls[I(i, j, k)];
  for (const d of DIRS) {
    const a = i + d[0], b = j + d[1], e = k + d[2];
    if (!V.at(a, b, e) || cls[I(a, b, e)]) continue;
    cls[I(a, b, e)] = c; queue.push(a, b, e);
  }
}

// 2. part labels (head frame rules, measured with tools/girl/tripo-measure.mjs)
const lab = new Uint8Array(n);
const C = (i, j, k) => V.center(i, j, k);
for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const id = I(i, j, k), c = cls[id];
  if (!V.at(i, j, k)) continue;
  const [x, y, z] = C(i, j, k), ax = Math.abs(x), K = CLS[c] || 'H';
  let L = LABELS.hair;
  if (y < -0.25 && (K === 'N' || K === 'W' || K === 'S')) L = LABELS.body;                       // dress, collar, arms, neck
  else if (K === 'L' && ax > 9.5 && y > 7.5 && y < 14.5) L = LABELS.bow;
  else if ((K === 'N' || K === 'W') && ax > 11.25 && y > 1.5 && y < 10.5) L = LABELS.fin;
  else if (K === 'W' && y > 12) L = LABELS.band;
  else if (K === 'N' && y > 16.25 && y < 19 && z > 2) L = LABELS.bandN;
  else if (K === 'N' && y > 18.75 && ax < 7) L = LABELS.ahoge;
  else if (K === 'S' && y > -0.75) L = LABELS.skin;
  lab[id] = L;
}
// the face front (and the forehead behind the bangs) becomes the designed face block in head4.mjs
for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const [x, y, z] = C(i, j, k), id = I(i, j, k);
  if (lab[id] && z < 8.5 && z > 3 && Math.abs(x) < 7.6 && y > -0.75 && y < 12.75) lab[id] = LABELS.skin;
}
// below the chin: keep only hair connected to the head hair (drops the dress, arms, hands)
{
  const seen = new Uint8Array(n), q = [];
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++)
    if (lab[I(i, j, k)] === LABELS.hair && C(i, j, k)[1] > 4) { seen[I(i, j, k)] = 1; q.push(i, j, k); }
  for (let p = 0; p < q.length; p += 3) {
    const i = q[p], j = q[p + 1], k = q[p + 2];
    for (const d of DIRS) {
      const a = i + d[0], b = j + d[1], e = k + d[2];
      if (a < 0 || b < 0 || e < 0 || a >= NX || b >= NY || e >= NZ) continue;
      const id = I(a, b, e);
      if (seen[id] || lab[id] !== LABELS.hair) continue;
      seen[id] = 1; q.push(a, b, e);
    }
  }
  let dropped = 0;
  for (let id = 0; id < n; id++) if (lab[id] === LABELS.hair && !seen[id]) { lab[id] = LABELS.body; dropped++; }
  console.log('hair voxels not connected to the head:', dropped);
}
// small specks of a label inside another part -> majority of the 26-neighbourhood
{
  let fixed = 0;
  for (let pass = 0; pass < 2; pass++) for (let k = 1; k < NZ - 1; k++) for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
    const id = I(i, j, k), L = lab[id];
    if (!L || L === LABELS.hair || L === LABELS.body) continue;
    let same = 0; const cnt = {};
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
      if (!a && !b && !e) continue;
      const M = lab[I(i + a, j + b, k + e)]; if (!M) continue;
      if (M === L) same++; else cnt[M] = (cnt[M] || 0) + 1;
    }
    if (same < 2) { const top = Object.entries(cnt).sort((p, q) => q[1] - p[1])[0]; if (top && top[1] >= 6) { lab[id] = +top[0]; fixed++; } }
  }
  console.log('isolated voxels relabelled:', fixed);
}

// front hair mask over the face (bangs): Tripo's bangs are a thin panel in front of a hollow forehead, which the
// voxels only half catch, so the front view decides: hair hit in front of the face plane (depth > 8.8)
const FRONT = { res: 0.5, box: [-10, 10, -1, 18] };
const fm = ortho(T, 'front', FRONT.res, FRONT.box);
const front = fm.out.map((row) => row.map((h) => (h && 'HLN'.includes(h.cls) && h.depth > 8.8 ? '1' : '0')).join(''));
console.log('front hair mask', fm.cols + 'x' + fm.rows, 'cells', front.join('').split('1').length - 1);

const count = {};
for (let id = 0; id < n; id++) if (lab[id]) { const k = Object.keys(LABELS).find((s) => LABELS[s] === lab[id]); count[k] = (count[k] || 0) + 1; }
console.log('labels', JSON.stringify(count));
// colour class per voxel is kept for the hair (H / L tells where Tripo's gradient turns light)
const packed = new Uint8Array(n);
for (let id = 0; id < n; id++) packed[id] = lab[id] | (lab[id] === LABELS.hair && cls[id] === 2 ? 16 : 0);
const doc = {
  version: 1, source: 'refs/models/tripo-ref.glb (Tripo export of the concept, by the user)', made: new Date().toISOString().slice(0, 10),
  frame: { ...HEAD_FRAME, note: 'head frame: y = 0 at the chin, face plane z = 8.5, +x = her left; 1 u = 0.02 m; Tripo full height = 64 u' },
  res: RES, g0: V.g0, N: V.N, labels: LABELS, lightBit: 16,
  bones: Object.fromEntries(Object.entries(T.bones).filter(([k]) => /^(Neck|Head|HeadTop_End|Spine2)$/.test(k)).map(([k, v]) => [k, v.map((x) => +x.toFixed(3))])),
  grid: zlib.deflateSync(Buffer.from(packed), { level: 9 }).toString('base64'),
  // rows top to bottom; row r covers y = box[3] - (r + 1) * res .. box[3] - r * res, column c covers x = box[0] + c * res ..
  front: { ...FRONT, rows: front },
};
fs.writeFileSync(OUT, JSON.stringify(doc));
console.log(`wrote ${path.relative(ROOT, OUT)} ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB, grid ${V.N.join('x')} @ ${RES} u, ${Date.now() - t0} ms`);
