// 08-bvh.js — faster raycasts for big meshes: one triangle BVH per geometry, used by THREE.Mesh raycasts.
// three r152 tests every triangle of every mesh the ray's bounding sphere/box touches (house2: 600k triangles,
// 5–9 ms per pick in Firefox). Here only the triangles whose BVH boxes the ray passes through are tested — with
// three's own per-triangle test, in three's order, giving the same hit objects (distance, point, object, uv,
// uv1/uv2, normal, face {a,b,c,normal,materialIndex}, faceIndex).
// Falls back to three's loop for: skinned / morphed meshes, < B.minTris triangles, geometry whose positions keep
// changing (3 version bumps), material groups that overlap / are unsorted / not aligned to whole triangles.
// Trees are built on the first ray, and in idle time after a model is shown (biggest geometry first).
// ?bvh=0 or V3.bvh.enabled = false → three's brute force everywhere (A/B tests: V3.bvh.compare()).
(function (V3) {
  'use strict';
  const MP = THREE.Mesh.prototype, orig = MP._computeIntersections;
  const qs = V3.util && V3.util.qs ? V3.util.qs : (k, d) => d;
  const B = V3.bvh = { enabled: !!orig && qs('bvh', '1') !== '0', minTris: 256, leaf: 8,
    stats: { built: 0, tris: 0, nodes: 0, ms: 0, dead: 0 } };
  if (!orig) { if (V3.err) V3.err('bvh: THREE.Mesh has no _computeIntersections (three changed?) — raycasts stay brute force'); return; }
  const cache = new WeakMap();   // BufferGeometry → tree | { dead: reason }
  const triCount = (g) => { const p = g.attributes.position; return p ? Math.floor((g.index ? g.index.count : p.count) / 3) : 0; };

  // ---- build: midpoint split of the centroid bounds on the longest axis, leaves ≤ B.leaf triangles ----
  const build = (geo) => {
    const t0 = performance.now();
    const pos = geo.attributes.position, idx = geo.index, n = triCount(geo);
    const plain = !pos.isInterleavedBufferAttribute && !pos.normalized && pos.itemSize === 3, pa = pos.array;
    const ia = idx ? idx.array : null;
    const tb = new Float32Array(n * 6), tc = new Float32Array(n * 3), order = new Uint32Array(n);
    let m = 0, gx0 = Infinity, gy0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gy1 = -Infinity, gz1 = -Infinity;
    for (let t = 0; t < n; t++) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = ia ? ia[t * 3 + k] : t * 3 + k;
        const x = plain ? pa[v * 3] : pos.getX(v), y = plain ? pa[v * 3 + 1] : pos.getY(v), z = plain ? pa[v * 3 + 2] : pos.getZ(v);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      if (!(x1 - x0 >= 0 && y1 - y0 >= 0 && z1 - z0 >= 0 && isFinite(x0 + x1 + y0 + y1 + z0 + z1))) continue;   // NaN / ∞ vertex: never hit
      const o = t * 6; tb[o] = x0; tb[o + 1] = y0; tb[o + 2] = z0; tb[o + 3] = x1; tb[o + 4] = y1; tb[o + 5] = z1;
      tc[t * 3] = (x0 + x1) * 0.5; tc[t * 3 + 1] = (y0 + y1) * 0.5; tc[t * 3 + 2] = (z0 + z1) * 0.5;
      if (x0 < gx0) gx0 = x0; if (y0 < gy0) gy0 = y0; if (z0 < gz0) gz0 = z0; if (x1 > gx1) gx1 = x1; if (y1 > gy1) gy1 = y1; if (z1 > gz1) gz1 = z1;
      order[m++] = t;
    }
    // boxes are padded so float noise at a box face can never drop a triangle three would hit
    const eps = 1e-5 * Math.max(1, m ? Math.hypot(gx1 - gx0, gy1 - gy0, gz1 - gz0) : 1);
    const cap = Math.max(1, 2 * m), nb = new Float32Array(cap * 6), nl = new Int32Array(cap), nr = new Int32Array(cap);
    let nodes = 1;
    const work = [0, 0, m];   // (node, start, end) triples
    while (work.length) {
      const end = work.pop(), start = work.pop(), id = work.pop();
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
      for (let i = start; i < end; i++) {
        const t = order[i], o = t * 6, c = t * 3;
        if (tb[o] < x0) x0 = tb[o]; if (tb[o + 1] < y0) y0 = tb[o + 1]; if (tb[o + 2] < z0) z0 = tb[o + 2];
        if (tb[o + 3] > x1) x1 = tb[o + 3]; if (tb[o + 4] > y1) y1 = tb[o + 4]; if (tb[o + 5] > z1) z1 = tb[o + 5];
        const cx = tc[c], cy = tc[c + 1], cz = tc[c + 2];
        if (cx < cx0) cx0 = cx; if (cx > cx1) cx1 = cx; if (cy < cy0) cy0 = cy; if (cy > cy1) cy1 = cy; if (cz < cz0) cz0 = cz; if (cz > cz1) cz1 = cz;
      }
      const b = id * 6;
      nb[b] = x0 - eps; nb[b + 1] = y0 - eps; nb[b + 2] = z0 - eps; nb[b + 3] = x1 + eps; nb[b + 4] = y1 + eps; nb[b + 5] = z1 + eps;
      const count = end - start, ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
      let ax = 0, ext = ex; if (ey > ext) { ax = 1; ext = ey; } if (ez > ext) { ax = 2; ext = ez; }
      if (count <= B.leaf || !(ext > 0)) { nl[id] = -(start + 1); nr[id] = count; continue; }   // leaf (or all centroids equal)
      const mid = (ax === 0 ? cx0 : ax === 1 ? cy0 : cz0) + ext * 0.5;
      let i = start, j = end - 1;
      while (i <= j) { const t = order[i]; if (tc[t * 3 + ax] < mid) i++; else { order[i] = order[j]; order[j] = t; j--; } }
      const split = i > start && i < end ? i : (start + end) >> 1;
      const L = nodes++, R = nodes++;
      nl[id] = L; nr[id] = R;
      work.push(L, start, split, R, split, end);
    }
    const tree = { v: pos.version, iv: idx ? idx.version : -1, changes: 0, n, nodes,
      nb: nb.slice(0, nodes * 6), nl: nl.slice(0, nodes), nr: nr.slice(0, nodes), order: order.slice(0, m), tg: null, gsig: null };
    const st = B.stats; st.built++; st.tris += n; st.nodes += nodes; st.ms += performance.now() - t0;
    return tree;
  };

  // tree for this mesh's geometry, or null = use three's own loop
  const treeFor = (mesh) => {
    const geo = mesh.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position || mesh.isSkinnedMesh) return null;
    let tr = cache.get(geo);
    if (tr && tr.dead) return null;
    const mp = geo.morphAttributes && geo.morphAttributes.position;
    if (mp && mp.length) { cache.set(geo, { dead: 'morph' }); return null; }
    if (!tr) {
      if (triCount(geo) < B.minTris) { cache.set(geo, { dead: 'small' }); return null; }
      cache.set(geo, tr = build(geo));
      return tr;
    }
    const pos = geo.attributes.position, idx = geo.index;
    if (tr.v !== pos.version || tr.iv !== (idx ? idx.version : -1)) {   // positions / index changed since the build
      if (tr.changes >= 2) { cache.set(geo, { dead: 'dynamic' }); B.stats.dead++; return null; }
      const c = tr.changes + 1;
      cache.set(geo, tr = build(geo)); tr.changes = c;
    }
    return tr;
  };

  // per-triangle group index for array materials; null when three's group loop can't be reproduced exactly
  const triGroups = (tr, geo) => {
    const gs = geo.groups, sig = gs.length + ':' + gs.map(g => g.start + ',' + g.count + ',' + g.materialIndex).join(';');
    if (tr.gsig === sig) return tr.tg;
    tr.gsig = sig; tr.tg = null;
    const tg = gs.length < 32767 ? new Int16Array(tr.n) : new Int32Array(tr.n);
    tg.fill(-1);
    let prev = -Infinity;
    for (let gi = 0; gi < gs.length; gi++) {
      const g = gs[gi];
      if (g.start % 3 || g.start < prev) return null;                       // unaligned or out of order: brute force
      prev = g.start;
      for (let i = g.start, e = Math.min(tr.n * 3, g.start + g.count); i < e; i += 3) {
        const t = i / 3;
        if (tg[t] !== -1) return null;                                     // overlapping groups
        tg[t] = gi;
      }
    }
    return (tr.tg = tg);
  };

  // ---- query ----
  let cand = new Uint32Array(4096);
  const stack = [];
  const collect = (tr, ray) => {
    const o = ray.origin, d = ray.direction, ox = o.x, oy = o.y, oz = o.z, dx = d.x, dy = d.y, dz = d.z;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz, nb = tr.nb, nl = tr.nl, nr = tr.nr, ord = tr.order;
    let k = 0;
    stack.length = 0; stack.push(0);
    while (stack.length) {
      const id = stack.pop(), b = id * 6;
      let tmin = 0, tmax = Infinity, t1, t2, s;
      if (dx !== 0) { t1 = (nb[b] - ox) * ix; t2 = (nb[b + 3] - ox) * ix; if (t1 > t2) { s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) continue; }
      else if (ox < nb[b] || ox > nb[b + 3]) continue;
      if (dy !== 0) { t1 = (nb[b + 1] - oy) * iy; t2 = (nb[b + 4] - oy) * iy; if (t1 > t2) { s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) continue; }
      else if (oy < nb[b + 1] || oy > nb[b + 4]) continue;
      if (dz !== 0) { t1 = (nb[b + 2] - oz) * iz; t2 = (nb[b + 5] - oz) * iz; if (t1 > t2) { s = t1; t1 = t2; t2 = s; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) continue; }
      else if (oz < nb[b + 2] || oz > nb[b + 5]) continue;
      const l = nl[id];
      if (l >= 0) { stack.push(l, nr[id]); continue; }
      const st = -l - 1, c = nr[id];
      if (k + c > cand.length) { const nc = new Uint32Array(Math.max(cand.length * 2, k + c)); nc.set(cand.subarray(0, k)); cand = nc; }
      for (let i = 0; i < c; i++) cand[k++] = ord[st + i];
    }
    return k;
  };

  // three r152 checkGeometryIntersection, unchanged (same math, same fields)
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), pL = new THREE.Vector3(), pW = new THREE.Vector3();
  const uA = new THREE.Vector2(), uB = new THREE.Vector2(), uC = new THREE.Vector2();
  const nA = new THREE.Vector3(), nB = new THREE.Vector3(), nC = new THREE.Vector3();
  const triHit = (obj, mat, rc, ray, uv, uv1, nrm, a, b, c) => {
    obj.getVertexPosition(a, vA); obj.getVertexPosition(b, vB); obj.getVertexPosition(c, vC);
    const r = mat.side === THREE.BackSide ? ray.intersectTriangle(vC, vB, vA, true, pL)
      : ray.intersectTriangle(vA, vB, vC, mat.side === THREE.FrontSide, pL);
    if (r === null) return null;
    pW.copy(pL).applyMatrix4(obj.matrixWorld);
    const dist = rc.ray.origin.distanceTo(pW);
    if (dist < rc.near || dist > rc.far) return null;
    const h = { distance: dist, point: pW.clone(), object: obj };
    if (uv) { uA.fromBufferAttribute(uv, a); uB.fromBufferAttribute(uv, b); uC.fromBufferAttribute(uv, c); h.uv = THREE.Triangle.getInterpolation(pL, vA, vB, vC, uA, uB, uC, new THREE.Vector2()); }
    if (uv1) { uA.fromBufferAttribute(uv1, a); uB.fromBufferAttribute(uv1, b); uC.fromBufferAttribute(uv1, c); h.uv1 = THREE.Triangle.getInterpolation(pL, vA, vB, vC, uA, uB, uC, new THREE.Vector2()); h.uv2 = h.uv1; }
    if (nrm) {
      nA.fromBufferAttribute(nrm, a); nB.fromBufferAttribute(nrm, b); nC.fromBufferAttribute(nrm, c);
      h.normal = THREE.Triangle.getInterpolation(pL, vA, vB, vC, nA, nB, nC, new THREE.Vector3());
      if (h.normal.dot(ray.direction) > 0) h.normal.multiplyScalar(-1);
    }
    const face = { a, b, c, normal: new THREE.Vector3(), materialIndex: 0 };
    THREE.Triangle.getNormal(vA, vB, vC, face.normal);
    h.face = face;
    return h;
  };

  const _inv = new THREE.Matrix4(), _ray = new THREE.Ray();
  MP._computeIntersections = function (raycaster, intersects) {
    const tr = B.enabled ? treeFor(this) : null;
    if (!tr) return orig.call(this, raycaster, intersects);
    const geo = this.geometry, mat = this.material, arr = Array.isArray(mat), dr = geo.drawRange;
    const tg = arr ? triGroups(tr, geo) : null;
    if ((arr && !tg) || dr.start % 3) return orig.call(this, raycaster, intersects);
    _inv.copy(this.matrixWorld).invert();
    _ray.copy(raycaster.ray).applyMatrix4(_inv);          // the same local ray three builds before calling us
    const k = collect(tr, _ray);
    if (!k) return;
    const c = cand.subarray(0, k); c.sort();               // three tests triangles in ascending order (groups sorted)
    const idx = geo.index, pos = geo.attributes.position, uv = geo.attributes.uv, uv1 = geo.attributes.uv1, nrm = geo.attributes.normal;
    const cnt = idx ? idx.count : pos.count, groups = geo.groups, dEnd = dr.start + dr.count;
    for (let q = 0; q < k; q++) {
      const t = c[q], i = t * 3;
      let m, g = null;
      if (arr) {
        const gi = tg[t]; if (gi < 0) continue;
        g = groups[gi];
        if (i < Math.max(g.start, dr.start) || i >= Math.min(cnt, g.start + g.count, dEnd)) continue;
        m = mat[g.materialIndex];
      } else {
        if (i < dr.start || i >= Math.min(cnt, dEnd)) continue;
        m = mat;
      }
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, cc = idx ? idx.getX(i + 2) : i + 2;
      const h = triHit(this, m, raycaster, _ray, uv, uv1, nrm, a, b, cc);
      if (h) { h.faceIndex = t; if (arr) h.face.materialIndex = g.materialIndex; intersects.push(h); }
    }
  };

  // ---- warm-up: build the shown model's big trees in idle time, biggest first ----
  const idle = window.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 500 }) : (fn) => setTimeout(fn, 30);
  let queue = [], gen = 0;
  const pump = (g) => {
    if (g !== gen || !queue.length || !B.enabled) return;
    try { treeFor(queue.shift()); } catch (e) { if (V3.err) V3.err('bvh warm: ' + ((e && e.message) || e)); }
    idle(() => pump(g));
  };
  B.warm = (root) => {
    gen++; queue = [];
    if (!B.enabled || !root) return;
    const seen = new Set();
    root.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.userData.fbOverlay || !o.geometry || seen.has(o.geometry)) return;
      seen.add(o.geometry);
      if (!cache.has(o.geometry) && triCount(o.geometry) >= B.minTris) queue.push(o);
    });
    queue.sort((a, b) => triCount(b.geometry) - triCount(a.geometry));
    const g = gen; idle(() => pump(g));
  };
  if (V3.on) V3.on('model', (inst) => B.warm(inst && inst.root));
  B.tree = (mesh) => treeFor(mesh);

  // ---- self-check: same rays with and without the BVH must give the same hit lists ----
  // V3.bvh.compare(objects, n = 200) → { rays, hits, diffs: [..first few], ms: { bvh, brute } }
  B.compare = (objects, n = 200, seed = 7) => {
    const R = V3.R, rc = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let s = seed >>> 0 || 1; const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const key = (h) => [h.object.uuid, h.faceIndex, h.face && h.face.materialIndex, h.distance.toFixed(6),
      h.uv ? h.uv.x.toFixed(6) + ',' + h.uv.y.toFixed(6) : '-', h.normal ? h.normal.toArray().map(v => v.toFixed(5)).join(',') : '-'].join('|');
    const out = { rays: n, hits: 0, diffs: [], ms: { bvh: 0, brute: 0 } }, was = B.enabled;
    try {
      for (let r = 0; r < n; r++) {
        ndc.set(rnd() * 2 - 1, rnd() * 2 - 1); rc.setFromCamera(ndc, R.camera);
        B.enabled = true; let t = performance.now(); const a = rc.intersectObjects(objects, true); out.ms.bvh += performance.now() - t;
        B.enabled = false; t = performance.now(); const b = rc.intersectObjects(objects, true); out.ms.brute += performance.now() - t;
        out.hits += b.length;
        const ka = a.map(key).join('\n'), kb = b.map(key).join('\n');
        if (ka !== kb && out.diffs.length < 5) out.diffs.push({ ray: r, bvh: a.length, brute: b.length, firstBvh: a[0] && key(a[0]), firstBrute: b[0] && key(b[0]) });
        if (ka !== kb) out.bad = (out.bad || 0) + 1;
      }
    } finally { B.enabled = was; }
    out.ms.bvh = +out.ms.bvh.toFixed(1); out.ms.brute = +out.ms.brute.toFixed(1);
    return out;
  };
})(window.V3);
