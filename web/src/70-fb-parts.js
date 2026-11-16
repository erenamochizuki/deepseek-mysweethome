// 70-fb-parts.js — feedback tool core: V3.fb namespace, selection, part units, hide/isolate, highlight overlays.
(function (V3) {
  'use strict';
  const U = V3.util, P = V3.parts;
  const fb = V3.fb = V3.fb || {};
  fb.enabled = U.qs('fb', '1') !== '0' && !window.__V3_NO_FB;
  fb.sel = null;      // selected part path
  fb.leaf = null;     // deepest path of the current selection chain (for [ ] navigation)
  fb.hit = null;      // last 3D click {path, anchor, obj, local, world, normal, cx, cy}
  fb.hover = null;    // hovered path
  fb.hl = true;       // highlight overlays on/off
  const under = fb.under = (p, root) => !!p && (!root || p === root || p.startsWith(root + '/'));
  const parentOf = fb.parentOf = p => (p && p.includes('/')) ? p.slice(0, p.lastIndexOf('/')) : null;
  fb.label = p => p ? P.label(p) : '';
  fb.inst = () => V3.models.current();

  // ---- root DOM (lazy, any module may call) ----
  let rootEl = null;
  fb.root = () => {
    if (!rootEl) { rootEl = U.el('div', { class: 'fb-root' }); document.body.append(rootEl); }
    return rootEl;
  };

  // ---- selection ----  info.src: pick | tree | list | key | crumb | ext | model ; info.hit (src pick)
  let selfEmit = false;
  fb.select = (path, info = {}) => {
    path = path || null;
    const src = info.src || 'ext', prev = fb.sel;
    if (info.hit) fb.hit = info.hit;
    else if (!path || !fb.hit || !(under(fb.hit.path, path) || under(path, fb.hit.path))) fb.hit = null;
    if (!path) fb.leaf = null;
    else if (src === 'key' || src === 'crumb') { if (!under(fb.leaf, path)) fb.leaf = path; }
    else fb.leaf = info.hit ? info.hit.path : path;
    fb.sel = path;
    fb.refreshHL();
    V3.emit('fb-select', path, { src, prev, hit: fb.hit });
    selfEmit = true;
    try { V3.emit('select', path); } finally { selfEmit = false; }
  };
  V3.on('select', p => { if (!selfEmit) fb.select(p, { src: 'ext' }); });

  // ---- units: Map(mesh -> Set(index)); index = faceTag group, -1 = whole (plain) mesh ----
  const ownPath = (o) => { for (; o; o = o.parent) if (o.userData.part) return o.userData.part; return null; };
  const addU = (map, m, i) => { let s = map.get(m); if (!s) map.set(m, s = new Set()); s.add(i); };
  // per-group material slots: an array, or a solo mesh (P.solo folded N equal slots into one material);
  // while we hold a whole mesh on HIDDEN its saved material still decides (units must not change shape)
  const slotsOf = (m) => {
    let mt = m.material;
    if (mt === P.HIDDEN && saved.has(m) && saved.get(m).whole) mt = saved.get(m).whole;
    return Array.isArray(mt) ? mt.length : m.userData.soloLen || 0;
  };
  const covers = (m, set) => {           // does the index set reach every slot of m?
    if (set.has(-1)) return true;
    const n = slotsOf(m); let k = 0;
    for (const i of set) if (i >= 0 && i < n) k++;
    return k >= n;
  };
  const addMesh = (map, m, root) => {
    if (!m.isMesh || m.userData.fbOverlay || m.userData.noPick) return;
    const tags = m.userData.faceTags, ok = p => root == null || under(p, root);
    if (tags && tags.length && slotsOf(m)) tags.forEach((t, i) => { if (ok(t || ownPath(m))) addU(map, m, i); });
    else if (ok(ownPath(m))) addU(map, m, -1);
  };
  fb.units = (path) => {
    const map = new Map(), seen = new Set();
    if (!path) return map;
    for (const it of P.objects(path)) it.obj.traverse(o => { if (!seen.has(o)) { seen.add(o); addMesh(map, o, path); } });
    return map;
  };
  // nearest ancestor path that owns geometry (decal sub-parts such as 眼睛 resolve to their mesh)
  fb.unitsLoose = (path) => {
    for (let p = path; p; p = parentOf(p)) { const m = fb.units(p); if (m.size) return m; }
    return new Map();
  };
  const allUnits = () => {
    const map = new Map(), inst = fb.inst();
    if (inst && inst.root) inst.root.traverse(o => addMesh(map, o, null));
    return map;
  };
  const slotShown = (m, i) => m.material !== P.HIDDEN && !(i >= 0 && Array.isArray(m.material) && m.material[i] === P.HIDDEN);

  // ---- hide / show / isolate: swap materials for V3.parts.HIDDEN (never toggles .visible) ----
  // solo meshes (P.SOLO) go back to a slot array via P.multi only while some, not all, of their slots
  // are hidden; a fully hidden mesh is one whole swap, and a fully shown one is P.solo'd again.
  let ops = [];                 // [{path, on}] replayed in order; on = hidden
  let hidden = new Map();       // mesh -> Set(index) hidden by us
  const saved = new Map();      // mesh -> {whole: material} | {slots: [materials]}
  fb.iso = null;
  const restoreAll = () => {
    const back = [];
    for (const [m, s] of saved) {
      if (s.whole) { if (m.material === P.HIDDEN) m.material = s.whole; }
      else { const a = P.multi(m); if (Array.isArray(a)) s.slots.forEach((mt, i) => { if (a[i] === P.HIDDEN && mt !== P.HIDDEN) a[i] = mt; }); }
      back.push(m);
    }
    saved.clear();
    return back;
  };
  const hideOn = (m, set) => {
    if (covers(m, set)) {
      if (m.material !== P.HIDDEN) { saved.set(m, { whole: m.material }); m.material = P.HIDDEN; }
      return;
    }
    const a = P.multi(m), copy = a.slice();
    let any = false;
    for (const i of set) if (i < a.length && a[i] !== P.HIDDEN) { a[i] = P.HIDDEN; any = true; }
    if (any) saved.set(m, { slots: copy });
  };
  const merge = (dst, src, on) => {
    for (const [m, s] of src) {
      let d = dst.get(m);
      if (on) { if (!d) dst.set(m, d = new Set()); for (const i of s) d.add(i); }
      else if (d) { for (const i of s) d.delete(i); if (!d.size) dst.delete(m); }
    }
  };
  const applyVis = () => {
    const back = restoreAll();
    const h = new Map();
    if (fb.iso) { merge(h, allUnits(), true); merge(h, fb.units(fb.iso), false); }
    for (const op of ops) merge(h, fb.units(op.path), op.on);
    hidden = h;
    for (const [m, s] of h) hideOn(m, s);
    for (const m of back) if (!h.has(m) && m.userData.soloLen) P.solo(m);   // fully shown again: one draw call
    fb.refreshHL();
    V3.emit('fb-vis');
  };
  // 0 = shown, 1 = hidden, 2 = partly hidden
  fb.visState = (path) => {
    let n = 0, k = 0;
    for (const [m, s] of fb.units(path)) { const hs = hidden.get(m); for (const i of s) { n++; if (hs && hs.has(i)) k++; } }
    return !n || !k ? 0 : k === n ? 1 : 2;
  };
  const pushOp = (path, on) => { ops = ops.filter(o => !under(o.path, path)); ops.push({ path, on }); };
  fb.hide = (path) => {
    if (!path) return false;
    if (!fb.units(path).size) { if (fb.toast) fb.toast('这个部位不能单独隐藏：' + fb.label(path)); return false; }
    pushOp(path, true); applyVis(); return true;
  };
  fb.show = (path) => { if (path) { pushOp(path, false); applyVis(); } };
  fb.toggleHidden = (path) => (fb.visState(path) === 1 ? fb.show(path) : fb.hide(path));
  fb.isolate = (path) => { fb.iso = path || null; applyVis(); };
  fb.showAll = () => { fb.iso = null; ops = []; applyVis(); };
  fb.hiddenAny = () => hidden.size > 0;
  // ---- highlight overlays: children of the target mesh sharing its geometry; never pickable ----
  const mat = (color, opacity, xray) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, depthTest: !xray, fog: false, toneMapped: false,
    polygonOffset: !xray, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const HL = {
    hover: { front: mat(0x35d4ff, 0.30, false), xray: null },
    select: { front: mat(0xffb020, 0.38, false), xray: mat(0xffb020, 0.13, true) },
  };
  const BASE_OP = new Map();
  for (const k in HL) for (const l in HL[k]) if (HL[k][l]) BASE_OP.set(HL[k][l], HL[k][l].opacity);
  const OFF = new THREE.MeshBasicMaterial({ visible: false });
  const layers = { hover: [], select: [] };
  const clearLayer = (k) => { for (const o of layers[k]) if (o.parent) o.parent.remove(o); layers[k] = []; };
  const visChain = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const overlay = (m, idx, material, order) => {
    const n = slotsOf(m);   // solo mesh: rebuild the slot array (OFF elsewhere); all slots of a solo mesh = one draw
    const mats = !n || idx.has(-1) || (m.userData.soloLen && covers(m, idx)) ? material
      : Array.from({ length: n }, (_, i) => (idx.has(i) ? material : OFF));
    let ov;
    if (m.isSkinnedMesh) { ov = new THREE.SkinnedMesh(m.geometry, mats); ov.bind(m.skeleton, m.bindMatrix); }
    else if (m.isInstancedMesh) { ov = new THREE.InstancedMesh(m.geometry, mats, m.count); ov.instanceMatrix = m.instanceMatrix; }
    else ov = new THREE.Mesh(m.geometry, mats);
    ov.userData.fbOverlay = true; ov.userData.noPick = true; ov.raycast = () => {};
    ov.castShadow = ov.receiveShadow = false; ov.renderOrder = order; ov.frustumCulled = m.frustumCulled;
    ov.name = 'fb-overlay';
    m.add(ov);
    return ov;
  };
  const build = (k, path) => {
    clearLayer(k);
    if (!path || !fb.hl) return;
    const L = HL[k];
    for (const [m, set] of fb.unitsLoose(path)) {
      if (!visChain(m)) continue;
      const idx = new Set([...set].filter(i => slotShown(m, i)));
      if (!idx.size) continue;
      layers[k].push(overlay(m, idx, L.front, 10));
      if (L.xray) layers[k].push(overlay(m, idx, L.xray, 11));
    }
  };
  let hovBuilt = null;
  fb.refreshHL = () => {
    build('select', fb.sel);
    hovBuilt = fb.hover && fb.hover !== fb.sel ? fb.hover : null;
    build('hover', hovBuilt);
  };
  fb.setHover = (path) => {
    path = path || null;
    if (path === fb.hover) return;
    fb.hover = path;
    const want = path && path !== fb.sel ? path : null;
    if (want !== hovBuilt) { hovBuilt = want; build('hover', want); }
    V3.emit('fb-hover', path);
  };
  fb.setHL = (on) => { fb.hl = !!on; fb.refreshHL(); V3.emit('fb-hl', fb.hl); };
  fb.hlScale = (f) => { for (const [m, o] of BASE_OP) m.opacity = o * f; };

  // ---- world bbox of a part (visible units first) / camera focus / named views ----
  const tv = new THREE.Vector3();
  const boxOf = (path, visOnly) => {
    const box = new THREE.Box3(), b = new THREE.Box3();
    for (const [m, set] of fb.unitsLoose(path)) {
      const g = m.geometry, pos = g && g.attributes && g.attributes.position;
      if (!pos) continue;
      const idx = [...set].filter(i => !visOnly || slotShown(m, i));
      if (!idx.length) continue;
      m.updateWorldMatrix(true, false);
      if (idx.includes(-1) || !g.groups.length || idx.length >= g.groups.length) {
        if (!g.boundingBox) g.computeBoundingBox();
        box.union(b.copy(g.boundingBox).applyMatrix4(m.matrixWorld));
        continue;
      }
      const want = new Set(idx), ix = g.index;
      for (const gr of g.groups) {
        if (!want.has(gr.materialIndex)) continue;
        for (let k = gr.start, e = gr.start + gr.count; k < e; k++) box.expandByPoint(tv.fromBufferAttribute(pos, ix ? ix.getX(k) : k).applyMatrix4(m.matrixWorld));
      }
    }
    return box;
  };
  fb.bbox = (path) => { const b = boxOf(path, true); return b.isEmpty() ? boxOf(path, false) : b; };
  fb.focus = (path, pad = 1.35) => {
    const R = V3.R, box = path || fb.sel ? fb.bbox(path || fb.sel) : null;
    if (!R || !box || box.isEmpty()) return false;
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(tv).length() / 2, 0.03);
    const cam = R.camera, vf = cam.fov * Math.PI / 360, hf = Math.atan(Math.tan(vf) * cam.aspect);
    R.ctl.set({ target: [c.x, c.y, c.z], dist: U.clamp(r * pad / Math.sin(Math.min(vf, hf)), R.ctl.minDist, R.ctl.maxDist) }, true);
    return true;
  };
  fb.view = (name) => {
    const inst = fb.inst(), v = inst && inst.views && inst.views[name];
    if (!v || !V3.R) return false;
    V3.R.ctl.set(v, true);
    return true;
  };
  fb.paused = () => !!V3.R && V3.R.frozen != null;
  fb.setPause = (on) => { const R = V3.R; if (!R) return; R.freeze(on ? R.t : null); V3.emit('fb-pause', fb.paused()); };

  // ---- wireframe (model materials only; overlays excluded) ----
  fb.wire = false;
  const wireMats = () => {
    const s = new Set(), inst = fb.inst(), add = mt => { if (mt && mt !== P.HIDDEN && 'wireframe' in mt) s.add(mt); };
    if (inst && inst.root) inst.root.traverse(o => { if (o.isMesh && !o.userData.fbOverlay) [].concat(o.material).forEach(add); });
    for (const sv of saved.values()) [].concat(sv.whole || sv.slots).forEach(add);
    return s;
  };
  fb.setWire = (on) => { fb.wire = !!on; for (const mt of wireMats()) mt.wireframe = fb.wire; V3.emit('fb-wire', fb.wire); };

  // ---- lifecycle ----
  const reset = () => {
    restoreAll(); hidden = new Map(); ops = []; fb.iso = null;
    clearLayer('hover'); clearLayer('select'); hovBuilt = null;
    fb.hover = null; fb.hit = null; fb.leaf = null;
  };
  V3.on('model', () => { reset(); if (fb.sel) fb.select(null, { src: 'model' }); if (fb.wire) fb.setWire(true); V3.emit('fb-vis'); });
  V3.on('parts-changed', () => applyVis());
  V3.on('state', () => { applyVis(); if (fb.wire) fb.setWire(true); });
})(window.V3);
