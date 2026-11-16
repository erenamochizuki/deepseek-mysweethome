// 03-vox.js — fine-voxel sculpt grid + AO face mesher (one mesh per bone, groups per tag).
// Design coords: integer cells, cell centre at (x,y,z); x mirrors x <-> -x (centre column 0).
(function (V3) {
  'use strict';
  const U = V3.util;

  class Grid {
    constructor(nx, ny, nz, opts = {}) {
      this.nx = nx; this.ny = ny; this.nz = nz;
      this.o = opts.origin || [nx >> 1, 0, nz >> 1];        // grid index of design (0,0,0)
      const n = nx * ny * nz;
      this.col = new Uint32Array(n);                          // 0 = empty, else 0x1RRGGBB
      this.tag = new Uint8Array(n);
      this.bone = new Uint8Array(n);
      this.tags = [''];                                       // tag 0 = untagged
      this.tagIdx = new Map([['', 0]]);
      this.cur = { col: 0xffffff, fn: null, tag: 0, bone: 0, mirror: false, mode: 'add' };
      this._u = 0;
    }
    // ---- drawing state (chainable) ----
    c(v) { if (typeof v === 'function') this.cur.fn = v; else { this.cur.fn = null; this.cur.col = v; } return this; }
    t(path) {
      let i = this.tagIdx.get(path);
      if (i == null) { i = this.tags.length; this.tags.push(path); this.tagIdx.set(path, i); }
      this.cur.tag = i; return this;
    }
    b(i) { this.cur.bone = i; return this; }
    mirror(on = true) { this.cur.mirror = !!on; return this; }
    m(mode) { this.cur.mode = mode || 'add'; return this; }     // add | under | paint | erase
    // ---- cell access ----
    idx(x, y, z) {
      const i = x + this.o[0], j = y + this.o[1], k = z + this.o[2];
      if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return -1;
      return i + this.nx * (j + this.ny * k);
    }
    has(x, y, z) { const i = this.idx(x, y, z); return i >= 0 && this.col[i] !== 0; }
    get(x, y, z) { const i = this.idx(x, y, z); return i < 0 || !this.col[i] ? -1 : (this.col[i] & 0xffffff); }
    tagAt(x, y, z) { const i = this.idx(x, y, z); return i < 0 || !this.col[i] ? null : this.tags[this.tag[i]]; }
    _put(x, y, z) { this._put1(x, y, z, x); if (this.cur.mirror && x !== 0) this._put1(-x, y, z, x); }
    _put1(x, y, z, sx) {
      const i = this.idx(x, y, z); if (i < 0) return;
      const m = this.cur.mode;
      if (m === 'erase') { this.col[i] = 0; return; }
      if (m === 'paint' && !this.col[i]) return;
      if (m === 'under' && this.col[i]) return;
      const c = this.cur.fn ? this.cur.fn(sx, y, z, this._u) : this.cur.col;
      if (c == null || c < 0) return;
      this.col[i] = (c & 0xffffff) | 0x1000000;
      this.tag[i] = this.cur.tag;
      if (m !== 'paint') this.bone[i] = this.cur.bone;
    }
    // ---- shapes (inclusive bounds, design coords) ----
    set(x, y, z) { this._put(x, y, z); return this; }
    fill(x0, y0, z0, x1, y1, z1, test) {
      const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
      const az = Math.min(z0, z1), bz = Math.max(z0, z1);
      for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++)
        if (!test || test(x, y, z)) this._put(x, y, z);
      return this;
    }
    box(x0, y0, z0, x1, y1, z1) { return this.fill(x0, y0, z0, x1, y1, z1, null); }
    ell(cx, cy, cz, rx, ry, rz) {
      return this.fill(Math.floor(cx - rx), Math.floor(cy - ry), Math.floor(cz - rz), Math.ceil(cx + rx), Math.ceil(cy + ry), Math.ceil(cz + rz),
        (x, y, z) => { const a = (x - cx) / rx, b = (y - cy) / ry, c = (z - cz) / rz; return a * a + b * b + c * c <= 1.0001; });
    }
    // box with rounded edges/corners of radius r (r may be [rx, ry, rz])
    rbox(x0, y0, z0, x1, y1, z1, r) {
      const [rx, ry, rz] = Array.isArray(r) ? r : [r, r, r];
      const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
      const az = Math.min(z0, z1), bz = Math.max(z0, z1);
      return this.fill(ax, ay, az, bx, by, bz, (x, y, z) => {
        const dx = rx ? Math.max(ax + rx - x, 0, x - (bx - rx)) / rx : 0;
        const dy = ry ? Math.max(ay + ry - y, 0, y - (by - ry)) / ry : 0;
        const dz = rz ? Math.max(az + rz - z, 0, z - (bz - rz)) / rz : 0;
        return dx * dx + dy * dy + dz * dz <= 1.0001;
      });
    }
    // vertical (elliptic) cylinder
    cyl(cx, cz, rx, y0, y1, rz = rx) {
      return this.fill(Math.floor(cx - rx), y0, Math.floor(cz - rz), Math.ceil(cx + rx), y1, Math.ceil(cz + rz),
        (x, y, z) => { const a = (x - cx) / rx, c = (z - cz) / rz; return a * a + c * c <= 1.0001; });
    }
    // capsule chain through pts [[x,y,z,r], ...]; colour fn receives u = segment index + t
    tube(pts, test) {
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const p of pts) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a] - p[3]); mx[a] = Math.max(mx[a], p[a] + p[3]); }
      return this.fill(Math.floor(mn[0]), Math.floor(mn[1]), Math.floor(mn[2]), Math.ceil(mx[0]), Math.ceil(mx[1]), Math.ceil(mx[2]), (x, y, z) => {
        let best = -1, bu = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
          const L2 = ex * ex + ey * ey + ez * ez || 1;
          const t = U.clamp(((x - a[0]) * ex + (y - a[1]) * ey + (z - a[2]) * ez) / L2, 0, 1);
          const px = a[0] + ex * t - x, py = a[1] + ey * t - y, pz = a[2] + ez * t - z, r = a[3] + (b[3] - a[3]) * t;
          const q = (px * px + py * py + pz * pz) / (r * r);
          if (q <= 1.0001 && (best < 0 || q < best)) { best = q; bu = i + t; }
        }
        if (best < 0) return false;
        this._u = bu;
        return !test || test(x, y, z, bu);
      });
    }
  }
  V3.vox = { Grid };

  // faces: normal n, tangents u/v with u×v = n; corners (0,0),(1,0),(1,1),(0,1) in (u,v) -> CCW seen from outside
  const FACES = [
    { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
  ];
  const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const tmpC = new THREE.Color();

  // mesh(g, {scale, bones:[{pivot:[x,y,z]}], noise, ao}) -> [{bone, geometry, faceTags, triTag}]
  V3.vox.mesh = (g, opt = {}) => {
    const s = opt.scale || 0.02, noise = opt.noise ?? 0.06, aoK = opt.ao ?? 0.55;
    const bones = opt.bones || [{ pivot: [0, 0, 0] }];
    const AO = [1, 1 - aoK * 0.28, 1 - aoK * 0.55, 1 - aoK];          // occluders 0..3 -> brightness
    const per = bones.map(() => new Map());                            // bone -> tag -> {pos, nor, col, n}
    const { nx, ny, nz, o, col, tag, bone } = g;
    const filled = (x, y, z) => g.has(x, y, z);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = i + nx * (j + ny * k), c = col[id];
      if (!c) continue;
      const x = i - o[0], y = j - o[1], z = k - o[2], b = bone[id], tg = tag[id];
      if (b >= bones.length) continue;
      const pv = bones[b].pivot;
      const h = U.hash3(x, y, z), f = 1 + (h - 0.5) * 2 * noise;
      tmpC.setHex(c & 0xffffff);                                        // sRGB hex -> linear
      const r0 = tmpC.r * f, g0 = tmpC.g * f, b0 = tmpC.b * f;
      for (const F of FACES) {
        const ax = x + F.n[0], ay = y + F.n[1], az = z + F.n[2];
        const ni = g.idx(ax, ay, az);
        if (ni >= 0 && col[ni] && bone[ni] === b) continue;             // culled only against same bone
        let bucket = per[b].get(tg);
        if (!bucket) { bucket = { pos: [], nor: [], col: [], ao: [] }; per[b].set(tg, bucket); }
        const ocs = [];
        for (const [cu, cv] of CORNERS) {
          const su = cu ? 1 : -1, sv = cv ? 1 : -1;
          const s1 = filled(ax + F.u[0] * su, ay + F.u[1] * su, az + F.u[2] * su);
          const s2 = filled(ax + F.v[0] * sv, ay + F.v[1] * sv, az + F.v[2] * sv);
          const cc = filled(ax + F.u[0] * su + F.v[0] * sv, ay + F.u[1] * su + F.v[1] * sv, az + F.u[2] * su + F.v[2] * sv);
          const oc = s1 && s2 ? 3 : (s1 + s2 + cc);
          ocs.push(oc);
          // corner position: cell centre ± 0.5 along n, u, v
          const px = x + 0.5 * F.n[0] + (cu - 0.5) * F.u[0] + (cv - 0.5) * F.v[0];
          const py = y + 0.5 * F.n[1] + (cu - 0.5) * F.u[1] + (cv - 0.5) * F.v[1];
          const pz = z + 0.5 * F.n[2] + (cu - 0.5) * F.u[2] + (cv - 0.5) * F.v[2];
          bucket.pos.push((px - pv[0]) * s, (py + 0.5 - pv[1]) * s, (pz - pv[2]) * s);
          bucket.nor.push(F.n[0], F.n[1], F.n[2]);
          const a = AO[oc];
          bucket.col.push(r0 * a, g0 * a, b0 * a);
        }
        bucket.ao.push(ocs[0] + ocs[2] > ocs[1] + ocs[3] ? 1 : 0);      // flip diagonal toward darker pair
      }
    }
    const out = [];
    per.forEach((tags, b) => {
      if (!tags.size) return;
      const faceTags = [], groups = [];
      let nv = 0;
      for (const [tg, bk] of tags) { faceTags.push(g.tags[tg] || ''); groups.push(bk); nv += bk.pos.length / 3; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), colA = new Float32Array(nv * 3);
      const nq = nv / 4, idx = nv > 65535 ? new Uint32Array(nq * 6) : new Uint16Array(nq * 6), triTag = new Uint16Array(nq * 2);
      const geo = new THREE.BufferGeometry();
      let vo = 0, io = 0;
      groups.forEach((bk, gi) => {
        pos.set(bk.pos, vo * 3); nor.set(bk.nor, vo * 3); colA.set(bk.col, vo * 3);
        const start = io, q = bk.pos.length / 12;
        for (let qi = 0; qi < q; qi++) {
          const a = vo + qi * 4;
          if (bk.ao[qi]) idx.set([a + 1, a + 2, a + 3, a + 1, a + 3, a], io);
          else idx.set([a, a + 1, a + 2, a, a + 2, a + 3], io);
          triTag[io / 3] = gi; triTag[io / 3 + 1] = gi;
          io += 6;
        }
        geo.addGroup(start, io - start, gi);
        vo += q * 4;
      });
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      out.push({ bone: b, geometry: geo, faceTags, triTag });
    });
    return out;
  };

  V3.vox.material = (opt = {}) => new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: opt.roughness ?? 0.82, metalness: 0, ...(opt.extra || {}),
  });

  // build(g, {scale, bones:[{name, pivot, parent}], part:'小鲸鱼', anchor:'girl', material})
  //   -> {root, bones:[Group], meshes:[Mesh], byName:{name: Group}}
  V3.vox.build = (g, opt = {}) => {
    const s = opt.scale || 0.02, defs = opt.bones || [{ name: 'root', pivot: [0, 0, 0], parent: -1 }];
    const base = opt.material || V3.vox.material();
    const bones = defs.map(d => { const gr = new THREE.Group(); gr.name = d.name; return gr; });
    const byName = {};
    let root = null;
    defs.forEach((d, i) => {
      const p = d.parent ?? -1, pp = p >= 0 ? defs[p].pivot : [0, 0, 0];
      bones[i].position.set((d.pivot[0] - pp[0]) * s, (d.pivot[1] - pp[1]) * s, (d.pivot[2] - pp[2]) * s);
      bones[i].userData.rest = bones[i].position.clone();
      if (p >= 0) bones[p].add(bones[i]); else root = root || bones[i];
      byName[d.name] = bones[i];
    });
    const meshes = [];
    for (const m of V3.vox.mesh(g, { scale: s, bones: defs, noise: opt.noise, ao: opt.ao })) {
      const mesh = new THREE.Mesh(m.geometry, m.faceTags.map(() => base));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = 'vox:' + defs[m.bone].name;
      Object.assign(mesh.userData, {
        faceTags: m.faceTags, triTag: m.triTag, anchor: (opt.anchor || 'vox') + ':' + defs[m.bone].name,
        part: opt.part || undefined,
      });
      bones[m.bone].add(mesh);
      V3.parts.tagFaces(mesh);
      meshes.push(mesh);
    }
    return { root, bones, meshes, byName, scale: s };
  };
})(window.V3);
