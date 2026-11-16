// 64-bubble.js — V3.bubble：小鲸鱼头顶的对话气泡（SPEC-4 §4）。
// HTML 层（不画进画布）：每帧把锚点（世界坐标）投影到 canvas.getBoundingClientRect() 的 CSS 像素，
// 绝不用 drawingBuffer / canvas.width（v1 的毛病：把画布像素当 CSS 像素，DPR≠1 就偏）。DPR 1 / 1.25 / 2、窗口缩放都对。
// 投影放在 'frame' 之后的微任务里：这一帧的渲染已经结束，相机和角色的矩阵都是最终值，气泡和画面同一帧。
//   V3.bubble.say(id, text, { anchor, ms, mood })  anchor：() => Vector3 | Vector3 | Object3D | [x,y,z]，缺省 = 小鲸鱼头顶
//     ms：总显示毫秒（缺省按字数算；0 / Infinity = 一直显示到 hide）；mood：happy | surprise | think | sad
//     同一个 id 再 say = 替换。锚点在相机后面或出了画面就隐藏；离得远会缩小一点。
//   V3.bubble.hide(id, now?) · clear() · project(v) → { x, y, dist, visible, behind } · list() · head() · params
//   视角 token：say=文字（小鲸鱼说；场景里还没有小鲸鱼时对准场地中心）。?bubbledebug=1：锚点画红球（画布）+ 青点（HTML）。
(function (V3) {
  'use strict';
  const U = V3.util;
  const P = {
    msPerChar: 55, stopMs: 220, commaMs: 90,                     // 打字速度；句号/逗号后多停一下
    holdMs: 1600, holdPerChar: 200, minMs: 2200, maxMs: 9000,    // 打完以后停留
    near: 18, far: 70, farScale: 0.78, smallScreen: 520, smallScale: 0.88,
    margin: 6, flipTop: 6, edge: 0.5,      // 框离画布边 ≥ margin px；锚点越出画布 edge px 才算出画面
    tailInset: 18,                         // 尾巴离框左右边的最小距离（让开圆角）
    id: 'girl'                             // say= 和小鲸鱼共用的气泡 id
  };
  const DEBUG = U.qs('bubbledebug', '') === '1';
  const STOP = /[。！？!?…~～]/, COMMA = /[，、,；;：:]/;
  const map = new Map();
  let layer = null, queued = false, warned = false;
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Vector3();
  const _p = { x: 0, y: 0, dist: 0, visible: false, behind: false };
  // 尾巴：18×13，尖在 (9,12)（描边外沿 ≈ 13 = 锚点）；白色三角盖住框的下边框，两条斜边从边框中线开始描
  const TAIL = '<svg class="v3-bb-tail" viewBox="0 0 18 13" aria-hidden="true">' +
    '<path class="f" d="M0 0 H18 L9 12 Z"/><path class="s" d="M1.5 2 L9 12 L16.5 2"/></svg>';

  const toVec = (a, out) => {
    if (typeof a === 'function') a = a();
    if (!a) return null;
    if (a.isObject3D) return a.getWorldPosition(out);
    if (Array.isArray(a)) return a.length >= 3 ? out.set(+a[0], +a[1], +a[2]) : null;
    if (typeof a.x === 'number') return out.set(a.x, a.y, a.z);
    return null;
  };
  // 默认锚点：小鲸鱼头顶（V3.actor.head()）；还没有小鲸鱼时 = 场地中心（当前模型的 stage.center，house2 = 门廊前）
  const headAnchor = () => {
    const A = V3.actor;
    if (A && typeof A.head === 'function') { try { const h = A.head(); if (h) return h; } catch (e) { /* 还没放进场景 */ } }
    const cur = V3.models && V3.models.current ? V3.models.current() : null;
    const c = cur && cur.stage && cur.stage.center;
    return Array.isArray(c) ? _c.set(+c[0], +c[1], +c[2]) : _c.set(0, 1.5, 0);
  };
  // 世界坐标 → 视口 CSS 像素（以 canvas.getBoundingClientRect() 为准）
  const projectTo = (v, cam, rect, out) => {
    _w.copy(v).applyMatrix4(cam.matrixWorldInverse);
    out.dist = _w.length();
    out.behind = cam.isPerspectiveCamera ? _w.z > -cam.near : false;
    _w.applyMatrix4(cam.projectionMatrix);
    out.x = rect.left + (_w.x + 1) * 0.5 * rect.width;
    out.y = rect.top + (1 - _w.y) * 0.5 * rect.height;
    const e = P.edge;
    out.visible = !out.behind && out.x >= rect.left - e && out.x <= rect.right + e && out.y >= rect.top - e && out.y <= rect.bottom + e;
    return out;
  };
  const project = (v) => {
    const r = V3.R;
    if (!r || !r.camera || !r.canvas) return null;
    const p = toVec(v, _v);
    if (!p) return null;
    r.camera.updateMatrixWorld();
    const o = projectTo(p, r.camera, r.canvas.getBoundingClientRect(), { x: 0, y: 0, dist: 0, visible: false, behind: false });
    return o;
  };
  const charDelay = (ch) => P.msPerChar + (STOP.test(ch) ? P.stopMs : COMMA.test(ch) ? P.commaMs : 0);

  const ensureLayer = () => {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.className = 'v3-bubbles';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    return layer;
  };
  const make = (id) => {
    const el = document.createElement('div'), pop = document.createElement('div'), box = document.createElement('div');
    const typed = document.createElement('span'), rest = document.createElement('span');
    el.className = 'v3-bb off'; el.dataset.id = id;
    pop.className = 'v3-bb-pop'; box.className = 'v3-bb-box'; rest.className = 'v3-bb-rest';
    box.append(typed, rest); pop.appendChild(box); pop.insertAdjacentHTML('beforeend', TAIL); el.appendChild(pop);
    if (DEBUG) { const d = document.createElement('div'); d.className = 'v3-bb-dbg'; el.appendChild(d); }
    ensureLayer().appendChild(el);
    return { id, el, pop, box, typed, rest, chars: [], at: [], shown: -1, t0: 0, end: Infinity, kill: 0,
      anchor: headAnchor, bw: 0, bh: 0, below: false, left: NaN, tf: '', dbg: null };
  };
  const drop = (b) => {
    map.delete(b.id);
    b.el.remove();
    if (b.dbg) { b.dbg.removeFromParent(); b.dbg.geometry.dispose(); b.dbg.material.dispose(); b.dbg = null; }
  };

  const say = (id, text, opt) => {
    opt = opt || {};
    id = String(id == null ? P.id : id);
    text = text == null ? '' : String(text);
    if (!text.trim()) { hide(id); return null; }
    let b = map.get(id);
    if (!b) { b = make(id); map.set(id, b); }
    b.chars = Array.from(text);
    b.at = []; let t = 0;
    for (const ch of b.chars) { b.at.push(t); t += charDelay(ch); }
    const typing = t, hold = U.clamp(P.holdMs + P.holdPerChar * b.chars.length, P.minMs, P.maxMs);
    const ms = opt.ms == null ? typing + hold : (!(opt.ms > 0) || !isFinite(opt.ms)) ? Infinity : Math.max(+opt.ms, typing + 600);
    b.t0 = performance.now(); b.end = b.t0 + ms; b.kill = 0;
    b.anchor = opt.anchor || headAnchor;
    b.el.className = 'v3-bb off' + (opt.mood ? ' mood-' + String(opt.mood).replace(/[^\w-]/g, '') : '');
    b.below = false; b.left = NaN; b.tf = '';
    b.typed.textContent = ''; b.rest.textContent = text; b.shown = 0;
    b.bw = b.bh = 0;                       // 换了字 → 重新量框
    b.pop.classList.remove('go'); void b.pop.offsetWidth; b.pop.classList.add('go');
    run();                                 // 马上摆好位置，不等下一帧
    return id;
  };
  const hide = (id, now) => {
    const b = map.get(String(id == null ? P.id : id));
    if (!b) return false;
    if (now) { drop(b); return true; }
    if (!b.kill) { b.kill = performance.now() + 260; b.el.classList.add('out'); }
    return true;
  };
  const clear = () => { for (const b of [...map.values()]) drop(b); };

  // ?bubbledebug=1：画布里在锚点画一个约 5 px 半径的红球（不受遮挡），拿来核对 HTML 尾巴尖有没有对准
  const mark = (b, v, p, cam, rect) => {
    if (!b.dbg) {
      b.dbg = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
      b.dbg.name = 'bubble-debug'; b.dbg.renderOrder = 10000; b.dbg.userData.noPick = true; b.dbg.frustumCulled = false;
      V3.R.scene.add(b.dbg);
    }
    const f = cam.isPerspectiveCamera ? 2 * Math.tan(cam.fov * Math.PI / 360) * p.dist / rect.height : 1 / rect.height;
    b.dbg.position.copy(v); b.dbg.scale.setScalar(5 * f); b.dbg.visible = true;
  };
  // 每帧：打字 → 到时淡出 → 投影 → 摆位置（框夹在画布里，尾巴尖永远在锚点上）
  const place = (b, now, cam, rect) => {
    if (b.kill && now >= b.kill) { drop(b); return; }
    if (!b.kill && now >= b.end) { b.kill = now + 260; b.el.classList.add('out'); }
    let n = 0; const dt = now - b.t0;
    while (n < b.chars.length && b.at[n] <= dt) n++;
    if (n !== b.shown) { b.shown = n; b.typed.textContent = b.chars.slice(0, n).join(''); b.rest.textContent = b.chars.slice(n).join(''); }
    let v = null;
    try { v = toVec(b.anchor, _v); } catch (e) { v = null; }
    const p = v && cam && rect && rect.width > 0 && rect.height > 0 ? projectTo(v, cam, rect, _p) : null;
    if (!p || !p.visible) { b.el.classList.add('off'); if (b.dbg) b.dbg.visible = false; return; }
    if (!b.bw) { b.bw = b.box.offsetWidth; b.bh = b.box.offsetHeight; if (!b.bw) return; }
    const sc = U.lerp(1, P.farScale, U.smooth(P.near, P.far, p.dist)) * (Math.min(rect.width, rect.height) < P.smallScreen ? P.smallScale : 1);
    let left = U.clamp(-b.bw / 2, (rect.left + P.margin - p.x) / sc, (rect.right - P.margin - p.x) / sc - b.bw);
    left = Math.round(U.clamp(left, P.tailInset - b.bw, -P.tailInset));
    const top = p.y - (10 + b.bh) * sc;
    const below = top < rect.top + P.flipTop + (b.below ? 8 : 0);
    if (below !== b.below) { b.below = below; b.el.classList.toggle('below', below); }
    if (left !== b.left) { b.left = left; b.box.style.left = left + 'px'; }
    const dpr = window.devicePixelRatio || 1;
    const tf = 'translate(' + Math.round(p.x * dpr) / dpr + 'px,' + Math.round(p.y * dpr) / dpr + 'px) scale(' + sc.toFixed(3) + ')';
    if (tf !== b.tf) { b.tf = tf; b.el.style.transform = tf; }
    b.el.classList.remove('off');
    if (DEBUG) mark(b, v, p, cam, rect);
  };
  const run = () => {
    if (!map.size) return;
    const R = V3.R, cam = R && R.camera, cv = R && R.canvas;
    let rect = null;
    if (cam && cv && cv.isConnected) { cam.updateMatrixWorld(); rect = cv.getBoundingClientRect(); }
    const now = performance.now();
    try { for (const b of [...map.values()]) place(b, now, cam, rect); }
    catch (e) { if (!warned) { warned = true; V3.err('bubble: ' + (e && e.message || e)); } }
  };
  const tick = () => { queued = false; run(); };
  // 'frame' 里只排一个微任务：等这一帧的 R.render 跑完再投影（相机、角色、控制器都已是这一帧的最终值）
  V3.on('frame', () => { if (map.size && !queued) { queued = true; queueMicrotask(tick); } });
  V3.on('resize', run);          // 01-render 先改相机 aspect 再发 'resize'
  V3.on('model', clear);         // 换模型 → 旧锚点作废

  // 视角 token：say=文字 → 小鲸鱼说（V3.actor 在场景里就先交给它，它会配表情/动作；它没冒出这句（还没接上气泡）→ 这里直接冒泡）
  V3.viewTokens = V3.viewTokens || {};
  V3.viewTokens.say = (v) => {
    const A = V3.actor;
    if (A && typeof A.say === 'function' && A.root) { try { A.say(v); } catch (e) { V3.err('bubble say=: ' + (e && e.message || e)); } }
    const b = map.get(P.id);
    if (!(b && !b.kill && b.chars.join('') === String(v))) say(P.id, v);
  };

  V3.bubble = {
    say, hide, clear, project, params: P,
    head: () => toVec(headAnchor, new THREE.Vector3()),
    list: () => [...map.values()].map(b => ({ id: b.id, text: b.chars.join(''), shown: b.shown, visible: !b.el.classList.contains('off'),
      below: b.below, scale: b.tf, left: b.left, ms: isFinite(b.end) ? Math.round(b.end - b.t0) : 0 }))
  };
})(window.V3);
