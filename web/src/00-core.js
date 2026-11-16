// 00-core.js — V3 namespace, errors, events, utils, parts registry, model registry, view strings.
(function () {
  'use strict';
  const V3 = window.V3 = window.V3 || {};
  V3.BUILD = window.__V3_BUILD || 'dev';
  V3.PAGE = window.__V3_PAGE || 'dev';
  window.__errors = window.__errors || [];
  window.__READY = false;
  const pushErr = s => { window.__errors.push(String(s).slice(0, 500)); };
  window.addEventListener('error', e => pushErr((e.message || 'error') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e => pushErr('promise: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
  V3.err = pushErr;

  // ---- events ----
  const subs = new Map();
  V3.on = (ev, fn) => { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); return fn; };
  V3.off = (ev, fn) => { const s = subs.get(ev); if (s) s.delete(fn); };
  V3.emit = (ev, ...a) => {
    const s = subs.get(ev); if (!s) return;
    for (const fn of [...s]) { try { fn(...a); } catch (e) { console.error(e); pushErr(ev + ': ' + (e.stack || e)); } }
  };

  // ---- utils ----
  const U = V3.util = {};
  U.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smooth = (a, b, x) => { const t = U.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  U.rng = seed => { let s = (seed >>> 0) || 0x9e3779b9; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  U.hash3 = (x, y, z) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  U.hex = n => new THREE.Color(n);
  U.fmtTime = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  U.el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  };
  // Called per frame (50-scene post, 51-sky): parse the query once per distinct location.search string.
  // Keyed on the current string, so a history.pushState/replaceState that changes it is still picked up.
  let qsSrc = null, qsParams = null;
  U.qs = (k, def) => {
    const s = location.search;
    if (s !== qsSrc) { qsParams = new URLSearchParams(s); qsSrc = s; }
    const v = qsParams.get(k); return v == null ? def : v;
  };

  // U.mix('#rrggbb', '#rrggbb', k) → 'rgb(r, g, b)': k of the first colour mixed into the second (what CSS color-mix(in srgb, a k%, b)
  // gives). U.alpha('#rrggbb', a) → 'rgba(…)'. For browsers without color-mix() (Chrome / Edge < 111): compute tints in JS.
  const rgbOf = (hex) => { const h = String(hex).replace('#', ''), n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  U.mix = (a, b, k) => { const x = rgbOf(a), y = rgbOf(b); return 'rgb(' + x.map((v, i) => Math.round(v * k + y[i] * (1 - k))).join(', ') + ')'; };
  U.alpha = (a, k) => 'rgba(' + rgbOf(a).join(', ') + ', ' + k + ')';

  // ---- typed numbers next to sliders (settings panel 69-settings, model settings 29-ysmui) ----
  // U.parseNumber(text, { pct }) → number | null. Accepts "7", "7.5", full-width "７．５", a comma as decimal point "7,5",
  // a trailing unit "7 分钟" / "50%". pct: the field stores 0..1 but is shown / typed as 0..100. Unreadable → null.
  U.parseNumber = (text, opts) => {
    let s = String(text == null ? '' : text).trim();
    if (s.normalize) s = s.normalize('NFKC');
    const m = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))/.exec(s);
    if (!m) return null;
    const v = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(v)) return null;
    return opts && opts.pct ? v / 100 : v;
  };
  // U.numField({ cls, label, pct, step, format(v) → shown text, edit(v) → text while editing, get() → stored value, set(v) })
  //   → { el, sync(v) }: a text input that looks like a value badge. Focus: plain number, selected. Enter / blur: commit through
  //   set(); what is shown afterwards is get() (so clamping and step snapping done by the owner are visible). Esc: discard.
  //   ↑ / ↓: one step. While the user is typing, sync() from outside (dragging the slider, a paired field) leaves the text alone.
  // Esc while typing: the dialogs that host these fields close on Escape with a capture-phase listener on window
  // (67-hud's modal, 29-ysmui's dialog), which runs before any listener on the input itself. So the field that is being
  // edited is cancelled from here: one window listener, registered at load (this file loads first, so it runs first),
  // which discards the edit and stops the event — the dialog stays open, and a second Esc closes it as usual.
  let numEditing = null;                             // { cancel() } of the field being typed in, if any
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !numEditing) return;
    e.preventDefault(); e.stopImmediatePropagation();
    numEditing.cancel();
  }, true);
  U.numField = (o) => {
    const el = U.el('input', { class: o.cls || '', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
      'aria-label': (o.label || '') + '（可以直接输入数值）', title: '点一下直接输入数值；回车确定，Esc 取消' });
    let editing = false;
    const show = (v) => { el.value = o.format(v); };
    const me = { cancel() { editing = false; numEditing = null; show(o.get()); el.blur(); } };
    const commit = () => {
      if (numEditing === me) numEditing = null;
      if (!editing) return;
      editing = false;
      const v = U.parseNumber(el.value, o);
      if (v !== null) o.set(v);
      show(o.get());
    };
    el.addEventListener('focus', () => { editing = true; numEditing = me; el.value = o.edit(o.get()); el.select(); });
    el.addEventListener('blur', commit);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); el.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); me.cancel(); }   // hosts without the window listener (tests, plain pages)
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = U.parseNumber(el.value); if (cur === null) return;
        const step = (o.step || 1) * (o.pct ? 100 : 1), next = +(cur + (e.key === 'ArrowUp' ? step : -step)).toFixed(6);
        o.set(o.pct ? next / 100 : next);
        el.value = o.edit(o.get()); el.select();
      }
    });
    show(o.get());
    return { el, sync: (v) => { if (!editing) show(v); } };
  };

  // ---- parts registry (see SPEC "Parts") ----
  const P = V3.parts = {};
  P.HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
  P.HIDDEN.name = 'v3-hidden';
  const reg = new Map();          // path -> {path, label, items:[{obj, tagIndex}]}
  const ensure = (path, label) => {
    let e = reg.get(path);
    if (!e) { e = { path, label: label || path.split('/').pop(), items: [] }; reg.set(path, e); }
    else if (label) e.label = label;
    return e;
  };
  P.tag = (obj, path, opts = {}) => {
    obj.userData.part = path;
    ensure(path, opts.label).items.push({ obj, tagIndex: -1 });
    return obj;
  };
  // mesh with userData.faceTags (paths) + userData.triTag (Uint16Array per triangle)
  P.tagFaces = (mesh) => {
    const tags = mesh.userData.faceTags || [];
    tags.forEach((path, i) => { if (path) ensure(path).items.push({ obj: mesh, tagIndex: i }); });
    return mesh;
  };
  // pre-register paths (fixes tree order; also for parts reached only via resolveHit)
  P.declare = (paths, labels = {}) => { for (const p of paths) ensure(p, labels[p]); };
  P.label = path => (reg.get(path) || { label: String(path).split('/').pop() }).label;
  P.list = (rootPath) => {
    const out = [], seen = new Set();
    for (const path of reg.keys()) {
      if (rootPath && path !== rootPath && !path.startsWith(rootPath + '/')) continue;
      const segs = path.split('/');
      for (let i = 1; i <= segs.length; i++) {
        const p = segs.slice(0, i).join('/');
        if (!seen.has(p)) { seen.add(p); out.push(p); }
      }
    }
    return out;
  };
  P.tree = () => {
    const root = { name: '全部', path: '', label: '全部', children: [] }, byPath = new Map([['', root]]);
    for (const p of P.list()) {
      const parent = byPath.get(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') || root;
      const n = { name: p.split('/').pop(), path: p, label: P.label(p), children: [] };
      byPath.set(p, n); parent.children.push(n);
    }
    return root;
  };
  P.objects = (path) => {
    const out = [];
    for (const [p, e] of reg) if (!path || p === path || p.startsWith(path + '/')) out.push(...e.items);
    return out;
  };
  P.pickables = () => {
    const set = new Set();
    for (const e of reg.values()) for (const it of e.items) {
      it.obj.traverse(o => { if (o.isMesh && !o.userData.noPick && !o.userData.fbOverlay) set.add(o); });
    }
    return [...set];
  };
  const visibleChain = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const triGroup = (mesh, faceIndex) => {
    const tt = mesh.userData.triTag;
    return tt && faceIndex != null && faceIndex < tt.length ? tt[faceIndex] : -1;
  };
  // is this raycast hit on something currently shown (not hidden object / hidden face group)?
  P.hitVisible = (hit) => {
    const o = hit.object;
    if (!visibleChain(o) || o.userData.noPick || o.material === P.HIDDEN) return false;   // whole mesh hidden (also solo meshes)
    const g = triGroup(o, hit.faceIndex);
    if (g >= 0 && Array.isArray(o.material) && o.material[g] === P.HIDDEN) return false;
    return true;
  };
  P.resolve = (hit) => {
    let obj = hit.object, path = null, owner = obj;
    if (obj.userData.resolveHit) path = obj.userData.resolveHit(hit);
    if (!path) { const g = triGroup(obj, hit.faceIndex); if (g >= 0) path = obj.userData.faceTags[g]; }
    if (!path) for (let o = obj; o; o = o.parent) if (o.userData.part) { path = o.userData.part; owner = o; break; }
    if (!path) return null;
    const local = owner.worldToLocal(hit.point.clone());
    const anchor = owner.userData.anchor || owner.userData.part || path;
    return { path, obj: owner, anchor, local: [local.x, local.y, local.z] };
  };
  // find the object a stored anchor refers to (userData.anchor first, then exact part path)
  P.find = (anchor) => {
    let hit = null;
    const sc = V3.R && V3.R.scene;
    if (sc) sc.traverse(o => { if (!hit && o.userData.anchor === anchor) hit = o; });
    if (!hit) { const e = reg.get(anchor); if (e && e.items.length) hit = e.items[0].obj; }
    return hit;
  };
  P.reset = (rootPath) => {
    for (const p of [...reg.keys()]) if (!rootPath || p === rootPath || p.startsWith(rootPath + '/')) reg.delete(p);
  };
  // Unregister by identity (P.reset works by path): drops every entry (P.tag and P.tagFaces) whose object is `obj`
  // or, unless opts.deep === false, anything below it. Paths stay (declarations, labels, tree order) and so do other
  // objects registered on the same paths. For owners that keep several objects per path and retire one of them
  // (54-house-mc's cached house meshes): a retired object must not stay reachable from here. userData.part is left
  // as it is. Returns how many entries were removed.
  P.untag = (obj, opts = {}) => {
    if (!obj) return 0;
    const gone = new Set();
    if (opts.deep !== false && typeof obj.traverse === 'function') obj.traverse(o => { gone.add(o); });
    else gone.add(obj);
    let n = 0;
    for (const e of reg.values()) {
      const items = e.items;
      let k = 0;
      for (let i = 0; i < items.length; i++) { if (gone.has(items[i].obj)) n++; else items[k++] = items[i]; }
      items.length = k;
    }
    return n;
  };
  // ---- draw-call slimming: a faceTag mesh whose material array holds ONE shared material is
  // drawn as a single call when its material is that material (three ignores groups then).
  // Code that edits per-group slots must call P.multi(mesh) first and may call P.solo(mesh) after.
  P.solo = (m) => {
    const a = m.material;
    if (!Array.isArray(a) || !a.length || !a.every(x => x === a[0])) return false;
    m.userData.soloLen = a.length; m.material = a[0]; return true;
  };
  P.multi = (m) => {
    if (Array.isArray(m.material) || !m.userData.soloLen) return m.material;
    m.material = new Array(m.userData.soloLen).fill(m.material); return m.material;
  };
  P.soloAll = (root) => {
    let n = 0;
    root.traverse(o => { if (o.isMesh && !o.userData.fbOverlay && P.solo(o)) n++; });
    return n;
  };
  P.SOLO = V3.util.qs('solo', '1') === '1';   // ?solo=0 turns it off (70-fb-parts uses P.multi / P.solo)

  // ---- model registry ----
  const M = V3.models = {};
  const defs = new Map();
  let cur = null;
  M.register = (def) => { defs.set(def.id, def); return def; };
  M.list = () => [...defs.values()].map(d => ({ id: d.id, label: d.label || d.id }));
  M.get = id => defs.get(id);
  M.current = () => cur;
  M.show = (id, opts = {}) => {
    const def = defs.get(id);
    if (!def) throw new Error('unknown model ' + id);
    if (cur) {
      if (cur.root.parent) cur.root.parent.remove(cur.root);
      try { cur.dispose && cur.dispose(); } catch (e) { pushErr('dispose: ' + e); }
      P.reset(cur.partRoot);
    }
    cur = def.build(opts);
    cur.id = cur.id || id;
    cur.label = cur.label || def.label || id;
    if (P.SOLO && cur.solo) cur.soloCount = P.soloAll(cur.root);   // opt-in per model (house2): other models may write mesh.material[i]
    V3.R.scene.add(cur.root);
    V3.emit('model', cur);
    V3.emit('parts-changed');
    return cur;
  };
  V3.setState = (key, val) => {
    if (!cur || !cur.setState) return;
    cur.setState(key, val);
    V3.emit('state', cur);
  };
  V3.on('frame', (dt, t) => {
    if (cur && cur.update) { try { cur.update(dt, t); } catch (e) { pushErr('update: ' + (e && e.message || e)); cur.update = null; } }
  });
  V3.getState = () => {
    const s = {};
    if (cur && cur.states) for (const k in cur.states) s[k] = cur.states[k].value;
    return s;
  };

  // ---- view strings (SPEC "Test hooks") ----
  V3.nextFrames = (n = 2) => new Promise(res => {
    let k = 0; const fn = () => { if (++k >= n) { V3.off('frame', fn); res(); } };
    V3.on('frame', fn);
  });
  V3.viewTokens = V3.viewTokens || {};   // extra __view tokens: V3.viewTokens.wash = (v) => … (may be async)
  // 模型可以异步画（inst.ready 是 Promise，改状态时可能换成新的）：等它画完，最多 ms 毫秒。
  // 超时记一条中文错误、照常往下走（同一个 Promise 超时过就不再等）；失败也只记一次。返回 true = 画完了。
  const readyStuck = new WeakSet(), readyFailed = new WeakSet();
  V3.waitReady = async (inst = cur, ms = 10000) => {
    const t0 = Date.now();
    for (;;) {
      const p = inst && inst.ready;
      if (!p || typeof p.then !== 'function') return true;
      if (readyStuck.has(p)) return false;
      let timer = null;
      const r = await Promise.race([
        Promise.resolve(p).then(() => 'ok', (e) => { if (!readyFailed.has(p)) { readyFailed.add(p); pushErr('model ' + (inst.id || '?') + ' ready: ' + (e && (e.stack || e.message) || e)); } return 'fail'; }),
        new Promise((res) => { timer = setTimeout(() => res('late'), Math.max(0, ms - (Date.now() - t0))); }),
      ]);
      clearTimeout(timer);
      if (r === 'late') { readyStuck.add(p); pushErr('模型 ' + (inst.id || '?') + ' ' + +(ms / 1000).toFixed(1) + ' 秒还没画完'); return false; }
      if (inst.ready === p) return r === 'ok';   // 等的时候又改了状态（ready 换了新的）就接着等新的
    }
  };
  V3.view = async (str) => {
    const R = V3.R;
    for (const tok of String(str || '').split(/[+ ]/).map(s => s.trim()).filter(Boolean)) {   // ' ' = '+' after URL decoding
      const eq = tok.indexOf('='), k = eq < 0 ? tok : tok.slice(0, eq), v = eq < 0 ? '' : decodeURIComponent(tok.slice(eq + 1));
      if (k === 'model') { if (!cur || cur.id !== v) M.show(v); }
      else if (k === 'cam') { const n = v.split('_').map(Number); R.setView({ pos: n.slice(0, 3), target: n.slice(3, 6) }); }
      else if (k === 't') R.freeze(v === '' || v === 'run' ? null : Number(v));
      else if (k === 'light') V3.stage && V3.stage.setPreset(v);
      else if (k === 'ui') document.body.classList.toggle('ui-off', v === '0');
      else if (k === 'sel') { if (V3.fb && V3.fb.select) V3.fb.select(v || null); else V3.emit('select', v || null); }
      else if (V3.viewTokens[k]) await V3.viewTokens[k](v, eq > 0);
      else if (eq > 0 && cur && cur.states && cur.states[k]) V3.setState(k, v);
      else if (eq < 0 && cur && cur.views && cur.views[k]) R.ctl.set(cur.views[k], false);
      else pushErr('view token not understood: ' + tok);
    }
    await V3.waitReady(cur);   // model= 换了模型、改了状态，都等异步模型画完（没有 ready 就不等）
    R.ctl.update(0);
    await V3.nextFrames(2);
  };
  window.__view = V3.view;
})();
