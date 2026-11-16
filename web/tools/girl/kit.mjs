// tools/girl/kit.mjs — block-modelling kit for the whale girl (Node, no dependencies).
// Every block is a convex polyhedron (hull of points, or intersection of planes), so blocks can be rotated,
// chamfered, tapered or wedge-cut: the slanted faces of refs/concept-girl.png. Faces are flat-shaded with one
// colour per face (colour fn of normal + centre). Units: design units u (1 u = 0.02 m), +x = her left, +y up,
// +z = her front. Output = triangle soup grouped by (part, bone, material) for the exporters (glb.mjs).

// ---------- vector / matrix helpers ----------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const D2R = Math.PI / 180;

// 3x3 rotation matrices as row arrays [[r00,r01,r02],[r10,..],[r20,..]]; apply: M·v
export const mat = {
  apply: (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)],
  mul: (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])),
  rx: (d) => { const c = Math.cos(d * D2R), s = Math.sin(d * D2R); return [[1, 0, 0], [0, c, -s], [0, s, c]]; },
  ry: (d) => { const c = Math.cos(d * D2R), s = Math.sin(d * D2R); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; },
  rz: (d) => { const c = Math.cos(d * D2R), s = Math.sin(d * D2R); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; },
  // Euler degrees [x, y, z], three.js order 'XYZ' (M = Rx·Ry·Rz)
  euler: (r) => mat.mul(mat.mul(mat.rx(r[0] || 0), mat.ry(r[1] || 0)), mat.rz(r[2] || 0)),
  // basis from columns (x axis, y axis, z axis)
  cols: (ax, ay, az) => [[ax[0], ay[0], az[0]], [ax[1], ay[1], az[1]], [ax[2], ay[2], az[2]]],
};

// ---------- colour helpers (hex ints, sRGB) ----------
export const C = {
  mix(a, b, t) {
    t = clamp(t, 0, 1);
    const ch = (s) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * t));
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  },
  shade(c, k) { return k >= 0 ? C.mix(c, 0xffffff, k) : C.mix(c, 0x000000, -k); },
  // piecewise gradient: stops = [[v0, hex0], [v1, hex1], ...] sorted by v
  grad(stops, v) {
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) return C.mix(stops[i - 1][1], stops[i][1], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    }
    return stops[stops.length - 1][1];
  },
  toLinear(hex) {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
  },
};
export const hash = (...n) => {
  let h = 0x811c9dc5;
  for (const v of n) { h ^= Math.round(v * 1000) | 0; h = Math.imul(h, 0x01000193); h ^= h >>> 15; }
  return ((h >>> 0) % 100000) / 100000;
};

// ---------- convex hull (incremental, for small point sets) ----------
// returns triangles [[a, b, c], ...] (points) wound counter-clockwise seen from outside
// wantIdx: return index triples into input instead of point triples
export function hull(input, eps = 1e-7, wantIdx = false) {
  const pts = [], orig = [];
  input.forEach((p, ii) => { if (!pts.some((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-6)) { pts.push(p); orig.push(ii); } });
  if (pts.length < 4) throw new Error('hull: need 4+ distinct points');
  let size = 0; for (const p of pts) size = Math.max(size, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  const E = eps * Math.max(1, size);
  // initial tetrahedron
  let i0 = 0; pts.forEach((p, i) => { if (p[0] < pts[i0][0]) i0 = i; });
  let i1 = -1, best = -1; pts.forEach((p, i) => { const d = len(sub(p, pts[i0])); if (d > best) { best = d; i1 = i; } });
  const dirL = norm(sub(pts[i1], pts[i0]));
  let i2 = -1; best = -1;
  pts.forEach((p, i) => { const v = sub(p, pts[i0]); const d = len(sub(v, mul(dirL, dot(v, dirL)))); if (d > best) { best = d; i2 = i; } });
  const nP = norm(cross(sub(pts[i1], pts[i0]), sub(pts[i2], pts[i0])));
  let i3 = -1; best = -1;
  pts.forEach((p, i) => { const d = Math.abs(dot(sub(p, pts[i0]), nP)); if (d > best) { best = d; i3 = i; } });
  if (best < E * 10) throw new Error('hull: points are coplanar');
  const inner = mul(add(add(pts[i0], pts[i1]), add(pts[i2], pts[i3])), 0.25);
  const faces = [];
  const mk = (a, b, c) => {
    let n = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]));
    if (dot(n, sub(inner, pts[a])) > 0) { [b, c] = [c, b]; n = mul(n, -1); }
    n = norm(n);
    faces.push({ v: [a, b, c], n, d: dot(n, pts[a]), alive: true });
  };
  mk(i0, i1, i2); mk(i0, i1, i3); mk(i0, i2, i3); mk(i1, i2, i3);
  const used = new Set([i0, i1, i2, i3]);
  for (let pi = 0; pi < pts.length; pi++) {
    if (used.has(pi)) continue;
    const p = pts[pi];
    const vis = faces.filter((f) => f.alive && dot(f.n, p) - f.d > E);
    if (!vis.length) continue;
    const edges = new Set();
    for (const f of vis) for (let k = 0; k < 3; k++) edges.add(f.v[k] + ',' + f.v[(k + 1) % 3]);
    const horizon = [];
    for (const f of vis) {
      f.alive = false;
      for (let k = 0; k < 3; k++) {
        const a = f.v[k], b = f.v[(k + 1) % 3];
        if (!edges.has(b + ',' + a)) horizon.push([a, b]);
      }
    }
    for (const [a, b] of horizon) {
      const n = norm(cross(sub(pts[b], pts[a]), sub(p, pts[a])));
      faces.push({ v: [a, b, pi], n, d: dot(n, pts[a]), alive: true });
    }
    used.add(pi);
  }
  return faces.filter((f) => f.alive).map((f) => f.v.map((i) => (wantIdx ? orig[i] : pts[i])));
}

// convex polyhedron = intersection of half-spaces {n·x <= d}; returns its vertices
export function planeVerts(planes, eps = 1e-6) {
  const out = [];
  const det3 = (a, b, c) => dot(a, cross(b, c));
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) for (let k = j + 1; k < planes.length; k++) {
    const A = planes[i], B = planes[j], Cc = planes[k];
    const det = det3(A.n, B.n, Cc.n);
    if (Math.abs(det) < 1e-9) continue;
    // Cramer: x = (dA (nB×nC) + dB (nC×nA) + dC (nA×nB)) / det
    const x = mul(add(add(mul(cross(B.n, Cc.n), A.d), mul(cross(Cc.n, A.n), B.d)), mul(cross(A.n, B.n), Cc.d)), 1 / det);
    if (planes.every((P) => dot(P.n, x) <= P.d + eps)) out.push(x);
  }
  return out;
}

// box half-sizes h=[hx,hy,hz] with optional chamfers. ch keys name an edge by its two faces, e.g. 'x+y-' =
// edge between the +x face and the -y face; value = amount (both ways) or [along first axis, along second axis].
const AX = { x: 0, y: 1, z: 2 };
export function boxPlanes(h, ch = {}) {
  const P = [];
  for (let a = 0; a < 3; a++) for (const s of [1, -1]) { const n = [0, 0, 0]; n[a] = s; P.push({ n, d: h[a] }); }
  for (const key in ch) {
    const m = /^([xyz])([+-])([xyz])([+-])$/.exec(key);
    if (!m) throw new Error('bad chamfer key ' + key);
    const a = AX[m[1]], sa = m[2] === '+' ? 1 : -1, b = AX[m[3]], sb = m[4] === '+' ? 1 : -1;
    const v = ch[key], da = Array.isArray(v) ? v[0] : v, db = Array.isArray(v) ? v[1] : v;
    if (!(da > 0 && db > 0)) continue;
    const n = [0, 0, 0]; n[a] = sa * db; n[b] = sb * da;
    const nn = norm(n), A = [0, 0, 0]; A[a] = sa * (h[a] - da); A[b] = sb * h[b];
    P.push({ n: nn, d: dot(nn, A) });
  }
  return P;
}
// shorthand: chamfer every edge of a box by c (number) — a "rounded" block
export const allEdges = (c) => {
  const o = {};
  for (const [a, b] of [['x', 'y'], ['x', 'z'], ['y', 'z']]) for (const sa of '+-') for (const sb of '+-') o[a + sa + b + sb] = c;
  return o;
};
// ---------- model: bones, parts, elements ----------
// An ELEMENT is one editable block: kind 'hull' (convex hull of its points) or 'chain' (rings of ringLen points;
// segment i = hull of ring i + ring i+1). Its control points are kept in model space (head-local units), so the
// studio editor can drag them; hand edits come from model.edits = { <name>: { d: { <pointIndex>: [dx,dy,dz] },
// col: '#rrggbb' } } and are applied before hulling. Names are '<part>/<n>' (n counts elements per part in build
// order) unless opt.name is given.
// tri = { part, bone, mat, p: [a, b, c], n, col (hex), uv?: [[u,v] x3], el: element id }
export class Model {
  constructor(name) {
    this.name = name;
    this.bones = [];                     // { name, pivot [u], parent (name|null) }
    this.tris = [];
    this.elements = [];
    this.partOrder = [];
    this.cur = { part: '', bone: null, mat: 'block' };
    this.stack = [];                     // frames { o, m } applied outermost-first
    this.edits = null;                   // hand edits (see above)
    this.applied = 0;                    // number of elements that had edits applied
    this.counter = {};
  }
  bone(name, pivot, parent = null) { this.bones.push({ name, pivot, parent }); if (!this.cur.bone) this.cur.bone = name; return this; }
  use(o) {
    Object.assign(this.cur, o);
    if (o.part && !this.partOrder.includes(o.part)) this.partOrder.push(o.part);
    return this;
  }
  // frames: push({ at:[x,y,z], rot:[dx,dy,dz] | m:3x3 }) — following blocks are given in this frame
  push(f) { this.stack.push({ o: f.at || [0, 0, 0], m: f.m || mat.euler(f.rot || [0, 0, 0]) }); return this; }
  pop() { this.stack.pop(); return this; }
  world(p) {
    let q = p;
    for (let i = this.stack.length - 1; i >= 0; i--) q = add(this.stack[i].o, mat.apply(this.stack[i].m, q));
    return q;
  }
  worldDir(v) { let q = v; for (let i = this.stack.length - 1; i >= 0; i--) q = mat.apply(this.stack[i].m, q); return q; }

  // register an element (model-space points), apply its hand edits, return it
  element(kind, pts, opt) {
    const part = opt.part || this.cur.part, bone = opt.bone || this.cur.bone, matName = opt.mat || this.cur.mat;
    const n = (this.counter[part] = (this.counter[part] || 0) + 1);
    const el = { id: this.elements.length, name: opt.name || part + '/' + n, part, bone, mat: matName, kind,
      ringLen: opt.ringLen || 0, base: pts.map((p) => p.slice()), faces: [] };
    let ed = this.edits && this.edits[el.name];
    // the block changed shape in the generator since the edit was made (different point count): skip that edit
    if (ed && ed.n != null && ed.n !== pts.length) { console.warn(`edit of ${el.name} skipped: it was made for ${ed.n} points, the block now has ${pts.length}`); ed = null; }
    el.pts = pts.map((p, i) => (ed && ed.d && ed.d[i] ? add(p, ed.d[i]) : p.slice()));
    el.colOverride = ed && typeof ed.col === 'string' && /^#[0-9a-f]{6}$/i.test(ed.col) ? parseInt(ed.col.slice(1), 16) : null;
    if (ed) this.applied++;
    this.elements.push(el);
    return el;
  }
  // hull 'pts' (model space) and emit its faces for element el; seg = segment index (chains) for the manifest
  emit(el, pts, opt, seg = 0) {
    const tris = hull(pts, 1e-7, true);
    const jit = opt.jit ?? 0, tone = jit ? (hash(el.id, 7.31) - 0.5) * 2 * jit : 0;
    const faces = el.faces[seg] || (el.faces[seg] = []);
    for (const ix of tris) {
      const t = ix.map((i) => pts[i]);
      const nrm = norm(cross(sub(t[1], t[0]), sub(t[2], t[0])));
      const c = mul(add(add(t[0], t[1]), t[2]), 1 / 3);
      if (opt.skip && opt.skip(nrm, c)) continue;
      let col = el.colOverride ?? (typeof opt.col === 'function' ? opt.col(nrm, c, { id: el.id, seg, t: opt.nseg ? (seg + 0.5) / opt.nseg : 0 }) : (opt.col ?? 0xff00ff));
      if (tone && el.colOverride == null) col = C.shade(col, tone);
      const faceMat = opt.faceMat && opt.faceMat(nrm, c);
      const tri = { part: el.part, bone: el.bone, mat: faceMat ? 'face' : el.mat, p: t, n: nrm, col, el: el.id };
      if (faceMat && opt.uv) tri.uv = t.map(opt.uv);
      this.tris.push(tri);
      if (!faces.some((f) => dot(f.n, nrm) > 0.999)) faces.push({ n: nrm.map((v) => +v.toFixed(4)), col, face: faceMat ? 1 : 0 });
    }
  }
  // convex block from local points. opt: rot (deg, about pivot | centroid), col (hex | fn(n, c, info)), skip(n, c),
  // jit (tone jitter), faceMat(n, c) -> true puts that face on the 'face' material with uv(p) -> [u, v], name, part/bone/mat
  hullBlock(points, opt = {}) {
    let pts = points;
    if (opt.rot) {
      const R = mat.euler(opt.rot);
      const pv = opt.pivot || mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
      pts = pts.map((p) => add(pv, mat.apply(R, sub(p, pv))));
    }
    const el = this.element('hull', pts.map((p) => this.world(p)), opt);
    this.emit(el, el.pts, opt);
    return this;
  }
  // axis-aligned (in the current frame) box: centre c, size s, opt.ch chamfers (see boxPlanes), opt.rot about c
  box(c, s, opt = {}) {
    const h = [s[0] / 2, s[1] / 2, s[2] / 2];
    const local = opt.ch ? planeVerts(boxPlanes(h, opt.ch)) :
      [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x * h[0], y * h[1], z * h[2]])));
    return this.hullBlock(local.map((p) => add(p, c)), { pivot: c, ...opt });
  }
  box2(a, b, opt = {}) {
    return this.box(mul(add(a, b), 0.5), [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])], opt);
  }
  // chain of convex segments through rings (arrays of points, same count): segment i = hull(ring i ∪ ring i+1).
  // Faces lying on an inner ring are dropped. opt.col may use info.seg (segment index) and info.t (0..1 along).
  chain(rings, opt = {}) {
    const L = rings[0].length, n = rings.length - 1;
    const el = this.element('chain', rings.flat().map((p) => this.world(p)), { ...opt, ringLen: L });
    const R = (i) => el.pts.slice(i * L, i * L + L);
    const plane = (ring) => { const nn = norm(cross(sub(ring[1], ring[0]), sub(ring[2], ring[0]))); return { n: nn, d: dot(nn, ring[0]) }; };
    const near = (P, c) => P && Math.abs(dot(P.n, c) - P.d) < 1e-5;
    for (let i = 0; i < n; i++) {
      const pa = i > 0 ? plane(R(i)) : null, pb = i < n - 1 ? plane(R(i + 1)) : null;
      this.emit(el, [...R(i), ...R(i + 1)], { ...opt, nseg: n, skip: (nrm, c) => near(pa, c) || near(pb, c) || (opt.skip ? opt.skip(nrm, c) : false) }, i);
    }
    return this;
  }
  // rectangle ring: centre c, unit axes u (width) and v (depth), sizes w x d
  static rect(c, u, v, w, d) {
    const hu = mul(u, w / 2), hv = mul(v, d / 2);
    return [add(add(c, hu), hv), add(sub(c, hu), hv), sub(sub(c, hu), hv), sub(add(c, hu), hv)];
  }
  // ring frames along a path: pts [[x,y,z], ...], width/depth arrays, ref = preferred width direction
  static tube(pts, w, d, ref = [1, 0, 0]) {
    const rings = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      const t = norm(sub(next, prev));
      let u = sub(ref, mul(t, dot(ref, t)));
      if (len(u) < 1e-4) u = cross(t, [0, 0, 1]);
      u = norm(u);
      const v = norm(cross(t, u));
      rings.push(Model.rect(pts[i], u, v, Array.isArray(w) ? w[i] : w, Array.isArray(d) ? d[i] : d));
    }
    return rings;
  }
  summary() {
    const by = new Map();
    for (const t of this.tris) by.set(t.part, (by.get(t.part) || 0) + 1);
    return { tris: this.tris.length, blocks: this.elements.length, edited: this.applied, parts: Object.fromEntries(by) };
  }
}
