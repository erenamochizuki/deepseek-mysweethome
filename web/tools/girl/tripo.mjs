// tools/girl/tripo.mjs — read the Tripo reference model (refs/models/tripo-ref.glb, git-ignored, the user's own
// Tripo export) for measuring: bind-pose triangles in design units, texture colour lookup, voxelisation.
// Measuring only; nothing from this file ends up in the built model. Node built-ins + ffmpeg (texture decode).
//
// Frames: 'body' = Tripo's own frame scaled so the full height is 64 u (feet at y = 0, +z = her front, +x = her left);
// 'head' = the v4 head frame: y = 0 at the chin, the face front at z = 8.5 (same as v3), x unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TRIPO_GLB = path.join(ROOT, 'refs/models/tripo-ref.glb');
const CACHE = path.join(ROOT, 'test/tmp-girl/v4');
// v4 head frame inside the body frame, measured with `node tools/girl/tripo-measure.mjs face` (2026-11-05)
export const HEAD_FRAME = { cx: -0.65, chinY: 38.4, faceZ: 11.05 };
export const toHead = (p) => [p[0] - HEAD_FRAME.cx, p[1] - HEAD_FRAME.chinY, p[2] - (HEAD_FRAME.faceZ - 8.5)];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const M4 = {
  mul(a, b) { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
    const [x, y, z, w] = q, xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    return Float64Array.from([(1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0, 2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
      2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1]);
  },
  ap(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; },
};

// ---------- load: bind-pose positions (body frame), uvs, triangles, texture ----------
export function loadTripo({ frame = 'head' } = {}) {
  if (!fs.existsSync(TRIPO_GLB)) throw new Error('missing ' + TRIPO_GLB + ' (copy ../小鲸鱼模型参考/成品带贴图.glb there)');
  const buf = fs.readFileSync(TRIPO_GLB);
  const jl = buf.readUInt32LE(12), J = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
  const bl = buf.readUInt32LE(20 + jl), bin = buf.subarray(28 + jl, 28 + jl + bl);
  const acc = (i) => {
    const a = J.accessors[i], bv = J.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type], sz = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType];
    const stride = bv.byteStride || n * sz, base = (bv.byteOffset || 0) + (a.byteOffset || 0), out = new Float64Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
      const o = base + i * stride + k * sz;
      let v = a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : bin.readUInt8(o);
      if (a.normalized) v /= a.componentType === 5123 ? 65535 : 255;
      out[i * n + k] = v;
    }
    return out;
  };
  const world = [];
  const local = (n) => (n.matrix ? Float64Array.from(n.matrix) : M4.trs(n.translation, n.rotation, n.scale));
  const visit = (i, par) => { world[i] = par ? M4.mul(par, local(J.nodes[i])) : local(J.nodes[i]); for (const c of J.nodes[i].children || []) visit(c, world[i]); };
  for (const r of J.scenes[J.scene || 0].nodes) visit(r, null);
  const meshNode = J.nodes.findIndex((n) => n.mesh != null), skin = J.skins[J.nodes[meshNode].skin];
  const IBM = acc(skin.inverseBindMatrices), JM = skin.joints.map((j, k) => M4.mul(world[j], IBM.subarray(k * 16, k * 16 + 16)));
  const prim = J.meshes[J.nodes[meshNode].mesh].primitives[0];
  const P0 = acc(prim.attributes.POSITION), UV = acc(prim.attributes.TEXCOORD_0), JN = acc(prim.attributes.JOINTS_0), WT = acc(prim.attributes.WEIGHTS_0), IDX = acc(prim.indices);
  const NV = P0.length / 3, P = new Float64Array(NV * 3);
  for (let i = 0; i < NV; i++) {
    const v = [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]], s = [0, 0, 0]; let ws = 0;
    for (let k = 0; k < 4; k++) { const w = WT[i * 4 + k]; if (!w) continue; const q = M4.ap(JM[JN[i * 4 + k]], v); s[0] += w * q[0]; s[1] += w * q[1]; s[2] += w * q[2]; ws += w; }
    for (let k = 0; k < 3; k++) P[i * 3 + k] = s[k] / (ws || 1);
  }
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < NV; i++) { y0 = Math.min(y0, P[i * 3 + 1]); y1 = Math.max(y1, P[i * 3 + 1]); }
  const S = 64 / (y1 - y0);
  const conv = (x, y, z) => { const b = [x * S, (y - y0) * S, z * S]; return frame === 'head' ? toHead(b) : b; };
  for (let i = 0; i < NV; i++) P.set(conv(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), i * 3);
  const bones = {};
  J.nodes.forEach((n, i) => { const m = /:(\w+)$/.exec(n.name || ''); if (m && world[i]) bones[m[1]] = conv(world[i][12], world[i][13], world[i][14]); });
  // texture: decode the embedded JPEG once with ffmpeg into test/tmp-girl/v4/tripo-tex.rgb
  const im = J.images[J.textures[J.materials[prim.material].pbrMetallicRoughness.baseColorTexture.index].source];
  const ib = J.bufferViews[im.bufferView], jpg = bin.subarray(ib.byteOffset || 0, (ib.byteOffset || 0) + ib.byteLength);
  let TW = 0, TH = 0;
  for (let o = 2; o < jpg.length - 8;) {
    if (jpg[o] !== 0xff) { o++; continue; }
    const mk = jpg[o + 1];
    if (mk === 0xff) { o++; continue; }
    if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) { TH = jpg.readUInt16BE(o + 5); TW = jpg.readUInt16BE(o + 7); break; }
    o += 2 + jpg.readUInt16BE(o + 2);
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const raw = path.join(CACHE, 'tripo-tex.rgb');
  if (!fs.existsSync(raw) || fs.statSync(raw).size !== TW * TH * 3) {
    const jp = path.join(CACHE, 'tripo-tex.jpg');
    fs.writeFileSync(jp, jpg);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', jp, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
  }
  const TEX = fs.readFileSync(raw);
  const texel = (u, v) => { const x = Math.min(TW - 1, Math.max(0, Math.floor(u * TW))), y = Math.min(TH - 1, Math.max(0, Math.floor(v * TH))), o = (y * TW + x) * 3; return [TEX[o], TEX[o + 1], TEX[o + 2]]; };
  const tris = [];
  for (let t = 0; t < IDX.length; t += 3) {
    const a = IDX[t], b = IDX[t + 1], c = IDX[t + 2];
    const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], B = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], C = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
    const n = cross(sub(B, A), sub(C, A)), L = Math.hypot(...n);
    if (L < 1e-12) continue;
    tris.push({ v: [a, b, c], p: [A, B, C], n: n.map((x) => x / L), area: L / 2 });
  }
  return { P, UV, tris, texel, bones, scale: S, frame, tex: [TW, TH] };
}

// ---------- closest point on a triangle (barycentric weights), Ericson RTCD 5.1.5 ----------
function closestW(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [0, 1 - w, w]; }
  const dn = 1 / (va + vb + vc), v = vb * dn, w = vc * dn;
  return [1 - v - w, v, w];
}

// ---------- voxelise: winding rays along x, y and z (majority vote), 2x2x2 sub-samples per voxel ----------
// box = { lo: [x,y,z], hi: [x,y,z] } in the model's frame; res = voxel size (u); thr = sub-samples inside (of 8)
export function voxelize(T, { lo, hi, res = 0.5, thr = 4 }) {
  const tris = T.tris.filter((t) => t.p.some((p) => p[0] > lo[0] - 2 && p[0] < hi[0] + 2 && p[1] > lo[1] - 2 && p[1] < hi[1] + 2 && p[2] > lo[2] - 2 && p[2] < hi[2] + 2));
  const g0 = lo.map((v) => Math.floor(v / res) * res), N = hi.map((v, k) => Math.ceil((v - g0[k]) / res));
  const SS = 2, SN = N.map((n) => n * SS), votes = new Uint8Array(SN[0] * SN[1] * SN[2]);
  const sIdx = (i, j, k) => (k * SN[1] + j) * SN[0] + i, sC = (k, i) => g0[k] + ((i + 0.5) / SS) * res;
  for (let ax = 0; ax < 3; ax++) {
    const b = (ax + 1) % 3, c = (ax + 2) % 3, cell = 1, buckets = new Map(), key = (u, v) => u * 100003 + v;
    tris.forEach((t, ti) => {
      const ub = t.p.map((p) => p[b]), vb = t.p.map((p) => p[c]);
      for (let u = Math.floor(Math.min(...ub) / cell); u <= Math.floor(Math.max(...ub) / cell); u++)
        for (let v = Math.floor(Math.min(...vb) / cell); v <= Math.floor(Math.max(...vb) / cell); v++) {
          const k = key(u, v); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(ti);
        }
    });
    for (let ib = 0; ib < SN[b]; ib++) for (let ic = 0; ic < SN[c]; ic++) {
      const pu = sC(b, ib) + 1.3e-5, pv = sC(c, ic) + 2.7e-5, list = buckets.get(key(Math.floor(pu / cell), Math.floor(pv / cell)));
      if (!list) continue;
      const hits = [];
      for (const ti of list) {
        const [A, B, C] = tris[ti].p, x0 = A[b], y0 = A[c], x1 = B[b], y1 = B[c], x2 = C[b], y2 = C[c];
        const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(d) < 1e-14) continue;
        const l0 = ((y1 - y2) * (pu - x2) + (x2 - x1) * (pv - y2)) / d, l1 = ((y2 - y0) * (pu - x2) + (x0 - x2) * (pv - y2)) / d, l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        hits.push([l0 * A[ax] + l1 * B[ax] + l2 * C[ax], tris[ti].n[ax] < 0 ? 1 : -1]);
      }
      if (!hits.length) continue;
      hits.sort((p, q) => p[0] - q[0]);
      let w = 0, h = 0;
      for (let ia = 0; ia < SN[ax]; ia++) {
        const z = sC(ax, ia);
        while (h < hits.length && hits[h][0] < z) w += hits[h++][1];
        if (w > 0) { const ii = [0, 0, 0]; ii[ax] = ia; ii[b] = ib; ii[c] = ic; votes[sIdx(ii[0], ii[1], ii[2])]++; }
      }
    }
  }
  const cnt = new Uint8Array(N[0] * N[1] * N[2]), idx = (i, j, k) => (k * N[1] + j) * N[0] + i;
  for (let k = 0; k < SN[2]; k++) for (let j = 0; j < SN[1]; j++) for (let i = 0; i < SN[0]; i++)
    if (votes[sIdx(i, j, k)] >= 2) cnt[idx(Math.floor(i / SS), Math.floor(j / SS), Math.floor(k / SS))]++;
  const solid = new Uint8Array(cnt.length);
  for (let i = 0; i < cnt.length; i++) solid[i] = cnt[i] >= thr ? 1 : 0;
  // colour lookup: nearest surface point facing the given direction
  const cell3 = 2, grid3 = new Map(), k3 = (x, y, z) => ((x + 500) * 1000 + (y + 500)) * 1000 + (z + 500);
  tris.forEach((t, ti) => {
    const l = [0, 1, 2].map((k) => Math.floor(Math.min(...t.p.map((p) => p[k])) / cell3)), h = [0, 1, 2].map((k) => Math.floor(Math.max(...t.p.map((p) => p[k])) / cell3));
    for (let x = l[0]; x <= h[0]; x++) for (let y = l[1]; y <= h[1]; y++) for (let z = l[2]; z <= h[2]; z++) { const kk = k3(x, y, z); if (!grid3.has(kk)) grid3.set(kk, []); grid3.get(kk).push(ti); }
  });
  function colorAt(p, dir) {
    for (const minDot of [0.2, -2]) {
      let best = null, bd = Infinity;
      const c = p.map((v) => Math.floor(v / cell3));
      for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) {
        const list = grid3.get(k3(c[0] + x, c[1] + y, c[2] + z)); if (!list) continue;
        for (const ti of list) {
          const t = tris[ti]; if (dir && dot(t.n, dir) < minDot) continue;
          const w = closestW(p, ...t.p), q = [0, 1, 2].map((k) => w[0] * t.p[0][k] + w[1] * t.p[1][k] + w[2] * t.p[2][k]), d = Math.hypot(...sub(q, p));
          if (d < bd) { bd = d; best = [t, w]; }
        }
      }
      if (best) {
        const [t, w] = best, U = t.v;
        const u = w[0] * T.UV[U[0] * 2] + w[1] * T.UV[U[1] * 2] + w[2] * T.UV[U[2] * 2], v = w[0] * T.UV[U[0] * 2 + 1] + w[1] * T.UV[U[1] * 2 + 1] + w[2] * T.UV[U[2] * 2 + 1];
        return { rgb: T.texel(u, v), d: bd };
      }
      if (!dir) break;
    }
    return null;
  }
  const at = (i, j, k) => (i >= 0 && j >= 0 && k >= 0 && i < N[0] && j < N[1] && k < N[2] ? solid[idx(i, j, k)] : 0);
  const center = (i, j, k) => [g0[0] + (i + 0.5) * res, g0[1] + (j + 0.5) * res, g0[2] + (k + 0.5) * res];
  return { res, g0, N, solid, cnt, idx, at, center, colorAt };
}

// ---------- colour classes (OKLab nearest reference) ----------
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function oklab([r, g, b]) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
// reference colours sampled from Tripo's texture (k-means over the head + hair surface)
export const CLASS_REF = [
  ['H', 0x1f3690], ['H', 0x2342a3], ['H', 0x3256b4], ['H', 0x727ebe],     // hair blues
  ['L', 0x127bea], ['L', 0x3fb5f0], ['L', 0x7fd3f7],                       // light blue: bows, hair tips
  ['N', 0x17236c], ['N', 0x09125a],                                         // navy: fins, ahoge, dress
  ['W', 0xf0eff4], ['W', 0xbab1ca],                                         // white: headband, fin underside
  ['S', 0xedd1d2], ['S', 0xe6858e],                                         // skin (+ blush)
].map(([k, h]) => [k, oklab([(h >> 16) & 255, (h >> 8) & 255, h & 255])]);
export function classify(rgb) {
  const o = oklab(rgb);
  let best = '?', bd = Infinity;
  for (const [k, c] of CLASS_REF) { const d = (o[0] - c[0]) ** 2 + (o[1] - c[1]) ** 2 + (o[2] - c[2]) ** 2; if (d < bd) { bd = d; best = k; } }
  return best;
}

// orthographic first hit: rays along -dir (the viewer looks along dir... we cast from the viewer side)
export const VIEWS = {   // u axis (screen right), v axis (screen up), view axis (towards the viewer)
  front: { u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, back: { u: [-1, 0, 0], v: [0, 1, 0], w: [0, 0, -1] },
  left: { u: [0, 0, -1], v: [0, 1, 0], w: [1, 0, 0] }, right: { u: [0, 0, 1], v: [0, 1, 0], w: [-1, 0, 0] },
  top: { u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] }, bottom: { u: [1, 0, 0], v: [0, 0, 1], w: [0, -1, 0] },
};
export function ortho(T, view, res, [u0, u1, v0, v1]) {
  const V = VIEWS[view], cols = Math.round((u1 - u0) / res), rows = Math.round((v1 - v0) / res);
  const buckets = new Map(), key = (a, b) => a * 100003 + b;
  T.tris.forEach((t, ti) => {
    const us = t.p.map((p) => dot(p, V.u)), vs = t.p.map((p) => dot(p, V.v));
    for (let a = Math.floor((Math.min(...us) - u0) / res); a <= Math.floor((Math.max(...us) - u0) / res); a++)
      for (let b = Math.floor((Math.min(...vs) - v0) / res); b <= Math.floor((Math.max(...vs) - v0) / res); b++) {
        if (a < 0 || b < 0 || a >= cols || b >= rows) continue;
        const k = key(a, b); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(ti);
      }
  });
  const out = [];
  for (let r = rows - 1; r >= 0; r--) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const pu = u0 + (c + 0.5) * res + 1.1e-5, pv = v0 + (r + 0.5) * res + 2.3e-5;
      let best = null;
      for (const ti of buckets.get(key(c, r)) || []) {
        const t = T.tris[ti];
        const P = t.p.map((p) => [dot(p, V.u), dot(p, V.v), dot(p, V.w)]);
        const [A, B, C] = P, d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
        if (Math.abs(d) < 1e-14) continue;
        const l0 = ((B[1] - C[1]) * (pu - C[0]) + (C[0] - B[0]) * (pv - C[1])) / d, l1 = ((C[1] - A[1]) * (pu - C[0]) + (A[0] - C[0]) * (pv - C[1])) / d, l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const depth = l0 * A[2] + l1 * B[2] + l2 * C[2];
        if (!best || depth > best.depth) best = { depth, t, w: [l0, l1, l2] };
      }
      if (!best) { row.push(null); continue; }
      const U = best.t.v, w = best.w;
      const uu = w[0] * T.UV[U[0] * 2] + w[1] * T.UV[U[1] * 2] + w[2] * T.UV[U[2] * 2], vv = w[0] * T.UV[U[0] * 2 + 1] + w[1] * T.UV[U[1] * 2 + 1] + w[2] * T.UV[U[2] * 2 + 1];
      const rgb = T.texel(uu, vv);
      row.push({ depth: best.depth, rgb, cls: classify(rgb), n: best.t.n });
    }
    out.push(row);
  }
  return { cols, rows, out };
}
