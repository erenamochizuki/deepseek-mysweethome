// 77-fb-pins.js — numbered pins for feedback items; follow the tagged object's local point every frame.
(function (V3) {
  'use strict';
  const U = V3.util, fb = V3.fb;
  const pins = new Map();   // id -> {it, el, obj, num, vis}
  let layer = null, draft = null, visDirty = true, probe = 0, lastProbe = 0;
  const v = new THREE.Vector3(), vc = new THREE.Vector3();

  const mkPin = (cls, text) => U.el('div', { class: 'fb-pin ' + cls }, U.el('i', null, text));
  const place = (el, x, y) => { el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(-45deg)`; };
  const inScene = (o) => { for (; o; o = o.parent) if (o.isScene) return true; return false; };
  const chainVisible = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };

  // ---- (re)build pin elements from the list's current filtered items ----
  const sync = (items) => {
    if (!layer) return;
    const want = new Set();
    for (const it of items) {
      if (!it.point || !(it.point.local || it.point.world)) continue;
      want.add(it.id);
      let p = pins.get(it.id);
      if (!p) {
        const el = mkPin('', '');
        el.addEventListener('click', (e) => { e.stopPropagation(); fb.openItem(it.id); });
        el.addEventListener('pointerenter', () => { const q = pins.get(it.id); if (q && q.it.part) fb.setHover(q.it.part); });
        el.addEventListener('pointerleave', () => fb.setHover(null));
        layer.append(el);
        pins.set(it.id, p = { el, obj: undefined, vis: true });
      }
      if (p.it && p.it.point && (p.it.point.anchor !== it.point.anchor)) p.obj = undefined;
      p.it = it; p.num = fb.store.nums.get(it.id) || '?';
      p.el.className = 'fb-pin ' + it.status + (fb.list.openId === it.id ? ' cur' : '') + (p.el.classList.contains('flash') ? ' flash' : '');
      p.el.firstChild.textContent = p.num;
      p.el.title = `#${p.num} ${it.partLabel || it.part || ''} · ${fb.STATUS[it.status] || it.status}\n${String(it.text || '').slice(0, 60)}`;
    }
    for (const [id, p] of pins) if (!want.has(id)) { p.el.remove(); pins.delete(id); }
    visDirty = true;
  };

  // anchor object for a stored point; null = not in this model (fall back to the stored world point)
  const resolveObj = (p) => {
    if (p.obj !== undefined && (!p.obj || inScene(p.obj))) return p.obj;
    const pt = p.it.point, a = pt.anchor;
    p.obj = (a && V3.parts.find(a)) || null;
    return p.obj;
  };
  const worldOf = (p) => {
    const pt = p.it.point, o = pt.local ? resolveObj(p) : null;
    if (o) { o.updateWorldMatrix(true, false); return o.visible && chainVisible(o) ? v.set(...pt.local).applyMatrix4(o.matrixWorld) : null; }
    return pt.world ? v.set(...pt.world) : null;
  };
  // client-space position inside the fixed overlay, or null when behind / off screen
  const project = (w) => {
    const R = V3.R, cam = R.camera;
    vc.copy(w).applyMatrix4(cam.matrixWorldInverse);
    if (vc.z > -cam.near) return null;
    vc.copy(w).project(cam);
    const rc = R.canvas.getBoundingClientRect();
    const x = rc.left + (vc.x + 1) / 2 * rc.width, y = rc.top + (1 - vc.y) / 2 * rc.height;
    if (x < rc.left - 30 || x > rc.right + 30 || y < rc.top - 30 || y > rc.bottom + 40) return null;
    return { x, y, ndc: [vc.x, vc.y] };
  };
  const show = (el, on) => { const d = on ? '' : 'none'; if (el.style.display !== d) el.style.display = d; };

  const frame = () => {
    const R = V3.R; if (!R || !layer) return;
    R.camera.updateMatrixWorld();
    const inst = fb.inst(), mid = inst && inst.id;
    if (visDirty) {
      visDirty = false;
      for (const p of pins.values()) p.vis = !p.it.part || fb.visState(p.it.part) !== 1;
    }
    // occlusion probe (a full-scene pick) for one pin at a time, at most every 90 ms: ~6 pins re-checked per 0.5 s
    const list = [...pins.values()], now = performance.now(), due = list.length && now - lastProbe >= 90;
    const k = due ? probe++ % list.length : -1;
    if (due) lastProbe = now;
    list.forEach((p, i) => {
      const w = p.vis && (!p.it.model || p.it.model === mid) ? worldOf(p) : null;
      const s = w && project(w);
      show(p.el, !!s);
      if (!s) return;
      place(p.el, s.x, s.y);
      if (i === k) {   // dim pins hidden behind other geometry
        const h = fb.pickAt(s.x, s.y), d = w.distanceTo(R.camera.position);
        p.el.classList.toggle('occl', !!h && h.dist < d - 0.02);
      }
    });
    // draft pin = where the composer's feedback will point
    const C = fb.comp, h = fb.hit;
    let ds = null;
    if (draft && C && C.open && h && h.local && fb.under(h.path, C.target)) {
      const o = h.obj && inScene(h.obj) ? h.obj : null;
      if (o) { o.updateWorldMatrix(true, false); ds = project(v.set(...h.local).applyMatrix4(o.matrixWorld)); }
      else if (h.world) ds = project(v.set(...h.world));
    }
    if (draft) { show(draft, !!ds); if (ds) place(draft, ds.x, ds.y); }
  };

  V3.on('init', () => {
    if (!fb.enabled) return;
    layer = U.el('div', { class: 'fb-pins' });
    draft = mkPin('draft', '+'); draft.style.display = 'none'; draft.style.pointerEvents = 'none';
    layer.append(draft);
    fb.root().prepend(layer);   // below every panel
  });
  V3.on('fb-list', sync);
  const stale = () => { for (const p of pins.values()) p.obj = undefined; visDirty = true; };
  V3.on('model', stale); V3.on('parts-changed', stale); V3.on('state', stale);
  V3.on('fb-vis', () => { visDirty = true; });
  V3.on('frame', frame);
  V3.on('fb-flash', (id) => {
    const p = pins.get(id); if (!p) return;
    p.el.classList.remove('flash'); void p.el.offsetWidth; p.el.classList.add('flash');
    clearTimeout(p.ft); p.ft = setTimeout(() => p.el.classList.remove('flash'), 2000);
  });
  V3.on('fb-pin-hover', (id) => { for (const [k, p] of pins) p.el.classList.toggle('hv', k === id); });
  fb.pins = { map: pins, visible: () => [...pins.values()].filter(p => p.el.style.display !== 'none').map(p => p.it.id) };
})(window.V3);
