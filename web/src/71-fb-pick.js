// 71-fb-pick.js — pointer picking on the canvas: hover highlight + tooltip, click = select, drag = orbit, keys.
(function (V3) {
  'use strict';
  const U = V3.util, P = V3.parts, fb = V3.fb;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  // hit on a hidden slot? (whole-mesh HIDDEN, or the face's material group HIDDEN / invisible)
  const slotHidden = (h) => {
    const mt = h.object.material;
    if (mt === P.HIDDEN) return true;
    if (Array.isArray(mt)) { const x = h.face && mt[h.face.materialIndex]; return !x || x === P.HIDDEN || x.visible === false; }
    return !mt || mt.visible === false;
  };
  fb.pickAt = (cx, cy) => {
    const R = V3.R; if (!R) return null;
    const rc = R.canvas.getBoundingClientRect();
    if (!rc.width || !rc.height) return null;
    ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1);
    R.camera.updateMatrixWorld();
    ray.setFromCamera(ndc, R.camera);
    for (const h of ray.intersectObjects(P.pickables(), false)) {
      if (!P.hitVisible(h) || slotHidden(h)) continue;
      const r = P.resolve(h);
      if (!r || !r.path) continue;
      const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null;
      const f3 = a => a.map(v => +(+v).toFixed(4));
      return { path: r.path, anchor: r.anchor, obj: r.obj, local: f3(r.local), world: f3(h.point.toArray()),
        normal: n ? f3(n.toArray()) : null, dist: h.distance, cx, cy };
    }
    return null;
  };
  // client coords of a world point [x,y,z] or of a part's bbox centre
  fb.screenOf = (what) => {
    const R = V3.R; if (!R) return null;
    let v;
    if (Array.isArray(what)) v = new THREE.Vector3(...what);
    else { const b = fb.bbox(what); if (b.isEmpty()) return null; v = b.getCenter(new THREE.Vector3()); }
    v.project(R.camera);
    const rc = R.canvas.getBoundingClientRect();
    return { x: rc.left + (v.x + 1) / 2 * rc.width, y: rc.top + (1 - v.y) / 2 * rc.height, z: v.z };
  };

  // ---- tree lookup + finer/coarser ----
  let nodes = null;
  fb.node = (p) => {
    if (!nodes) { nodes = new Map(); const walk = n => { nodes.set(n.path, n); n.children.forEach(walk); }; walk(P.tree()); }
    return nodes.get(p) || null;
  };
  V3.on('parts-changed', () => { nodes = null; });
  V3.on('model', () => { nodes = null; });
  fb.finer = () => {
    const s = fb.sel; if (!s) return null;
    if (fb.leaf && fb.leaf !== s && fb.under(fb.leaf, s)) return s + '/' + fb.leaf.slice(s.length + 1).split('/')[0];
    const n = fb.node(s);
    return n && n.children.length ? n.children[0].path : null;
  };

  // ---- tooltip ----
  let tip = null;
  const showTip = (h, cx, cy) => {
    if (!tip) tip = fb.root().appendChild(U.el('div', { class: 'fb-tip' }));
    if (!h) { tip.style.display = 'none'; return; }
    tip.replaceChildren(U.el('b', null, fb.label(h.path)), U.el('span', null, h.path));
    tip.style.display = 'block';
    let x = cx + 16, y = cy + 18;
    if (x + tip.offsetWidth > innerWidth - 4) x = cx - tip.offsetWidth - 12;
    if (y + tip.offsetHeight > innerHeight - 4) y = cy - tip.offsetHeight - 12;
    tip.style.transform = `translate(${Math.max(4, x)}px,${Math.max(4, y)}px)`;
  };

  // ---- pointer: hover / click (≤4 px) / drag = orbit / multi-touch = camera ----
  const ptrs = new Set();
  let last = null, raf = 0, down = null, quiet = null;   // quiet = click point: no tooltip until the pointer moves away
  const doHover = () => {
    raf = 0;
    if (!last || ptrs.size || document.hidden) return;
    const h = fb.pickAt(last.x, last.y);
    fb.setHover(h ? h.path : null);
    if (quiet && Math.hypot(last.x - quiet.x, last.y - quiet.y) < 10) showTip(null);
    else { quiet = null; showTip(h, last.x, last.y); }
    V3.R.canvas.style.cursor = h ? 'pointer' : '';
  };
  const queueHover = () => { if (!raf) raf = requestAnimationFrame(doHover); };
  const clearHover = () => { fb.setHover(null); showTip(null); if (V3.R) V3.R.canvas.style.cursor = ''; };
  fb.clearHover = () => { last = null; clearHover(); };
  V3.on('init', (R) => {
    if (!fb.enabled) return;
    const cv = R.canvas;
    cv.addEventListener('pointerdown', e => {
      ptrs.add(e.pointerId);
      down = ptrs.size === 1 ? { x: e.clientX, y: e.clientY, max: 0, btn: e.button, shift: e.shiftKey } : null;
      clearHover();
    });
    cv.addEventListener('pointermove', e => {
      if (down) down.max = Math.max(down.max, Math.hypot(e.clientX - down.x, e.clientY - down.y));
      if (!ptrs.size && e.pointerType !== 'touch') { last = { x: e.clientX, y: e.clientY }; queueHover(); }
    });
    const up = e => {
      const had = ptrs.delete(e.pointerId), d = down;
      if (!ptrs.size) down = null;
      if (!had || !d || ptrs.size || e.type !== 'pointerup' || d.max > 4 || d.btn !== 0 || d.shift) return;
      const h = fb.pickAt(e.clientX, e.clientY);
      if (h) { quiet = { x: e.clientX, y: e.clientY }; fb.select(h.path, { src: 'pick', hit: h }); }
      else if (fb.sel) fb.select(null, { src: 'pick' });
      if (e.pointerType !== 'touch') { last = { x: e.clientX, y: e.clientY }; queueHover(); }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (!ptrs.size) fb.clearHover(); });
    cv.addEventListener('wheel', () => { if (last) setTimeout(queueHover, 150); }, { passive: true });
    cv.addEventListener('dblclick', () => { if (fb.sel) fb.focus(fb.sel); });
  });
  // ---- Esc chain: handlers by priority (zoom 30 > help 20 > composer 10), then deselect ----
  const escH = [];
  fb.onEsc = (fn, prio = 0) => { escH.push({ fn, prio }); escH.sort((a, b) => b.prio - a.prio); };
  fb.esc = () => {
    for (const h of escH) if (h.fn()) return true;
    if (fb.sel) { fb.select(null, { src: 'key' }); return true; }
    return false;
  };

  // ---- keys ----
  const VIEWS = ['front', 'side', 'back', 'q34', 'face'];
  const typing = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  window.addEventListener('keydown', (e) => {
    if (!fb.enabled || e.defaultPrevented) return;
    const k = e.key, s = fb.sel, t = e.target;
    if (typing(t)) { if (k === 'Escape') t.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (t && t.tagName === 'BUTTON' && (k === ' ' || k === 'Enter')) return;
    let done = true;
    if (k === 'Escape') done = fb.esc();
    else if (k === 'h' || k === 'H') { if (e.shiftKey) fb.showAll(); else if (s) fb.toggleHidden(s); else done = false; }
    else if (k === 'i' || k === 'I') { if (fb.iso && (!s || fb.iso === s)) fb.isolate(null); else if (s) fb.isolate(s); else done = false; }
    else if (k === 'f' || k === 'F') {
      if (!fb.focus(s)) { const i = fb.inst(); if (i && i.root && V3.R) V3.R.frameObject(i.root); }
    }
    else if (k === '[') { const p = fb.parentOf(s); if (p) fb.select(p, { src: 'key' }); }
    else if (k === ']') { const p = fb.finer(); if (p) fb.select(p, { src: 'key' }); }
    else if (/^[1-9]$/.test(k)) {
      const i = fb.inst(), vs = i && i.views ? Object.keys(i.views) : VIEWS;
      done = vs[+k - 1] ? fb.view(vs[+k - 1]) : false;
    }
    else if (k === ' ') fb.setPause(!fb.paused());
    else if (k === '?') { if (fb.help) fb.help(); }
    else done = false;
    if (done) e.preventDefault();
  });
})(window.V3);
