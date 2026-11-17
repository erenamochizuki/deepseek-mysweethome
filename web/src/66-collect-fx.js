// 66-collect-fx.js — V3.collectFx: the collect animation (docs/SPEC-4.md §4); listens to 'game:collect' itself.
// (by 'girl': glide into her hand) → lift 0.4 m + one full turn (0.5 s) → swap to the 2D icon (V3.shellIcons) and fly
// along an arc to V3.hud.anchor('box') (0.7 s) → V3.hud.pulse('box') + toast「+1 扇贝」/「新发现！扇贝」in the rarity colour.
// No HUD (studio): rise in place and fade out. The 3D obj is disposed as soon as it is not needed (userData.shared kept).
(function (V3) {
  'use strict';
  const U = V3.util;
  const T_HAND = 0.35, T_LIFT = 0.5, T_FLY = 0.7, T_FADE = 0.45, LIFT = 0.4, ICON = 56, END = 34;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const list = [];
  const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _y = new THREE.Vector3(0, 1, 0), _b = new THREE.Box3();

  let layer = null;   // fixed click-through layer for flying icons (stays with ui=0: it is part of the game, not chrome)
  const lay = () => layer || (layer = document.body.appendChild(U.el('div', { id: 'v3-fx', style: {
    position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '40', overflow: 'hidden' } })));

  // world → page CSS px via canvas.getBoundingClientRect (never drawing-buffer pixels)
  function toClient(p) {
    const R = V3.R, r = R.canvas.getBoundingClientRect();
    _c.copy(p).project(R.camera);
    return { x: r.left + (_c.x + 1) / 2 * r.width, y: r.top + (1 - _c.y) / 2 * r.height, z: _c.z };
  }
  function screenBox(o) {   // centre + largest projected extent (CSS px) of the object's world box
    _b.setFromObject(o); if (_b.isEmpty()) return null;
    const c = toClient(_b.getCenter(_v));
    let s = 0;
    for (let i = 0; i < 8; i++) {
      const p = toClient(_v.set(i & 1 ? _b.max.x : _b.min.x, i & 2 ? _b.max.y : _b.min.y, i & 4 ? _b.max.z : _b.min.z));
      s = Math.max(s, Math.abs(p.x - c.x) * 2, Math.abs(p.y - c.y) * 2);
    }
    return { x: c.x, y: c.y, s, behind: c.z > 1 };
  }
  let mockHud = null;   // test token override (studio has V3.hud but never mounts it)
  const hudOf = () => mockHud || V3.hud || null;
  function anchorBox() {   // hud.anchor('box') → {x, y} CSS px, or null (no HUD / not mounted / ui=0)
    const h = hudOf(); if (!h || !h.anchor) return null;
    let a = null; try { a = h.anchor('box'); } catch (e) { return null; }
    if (!a) return null;
    if (Array.isArray(a)) a = { x: a[0], y: a[1] };
    else if (a.width != null && a.left != null) a = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
    return Number.isFinite(a.x) && Number.isFinite(a.y) && (a.x || a.y) ? { x: a.x, y: a.y } : null;
  }
  function handPos(out) {   // her hand (world): V3.actor.hand() if the engine adds it, else in front of / below the head
    const A = V3.actor; if (!A) return null;
    try {
      if (A.hand) { const h = A.hand(); if (h) return out.copy(h); }
      const h = A.head && A.head(); if (!h || !A.root) return null;
      A.root.getWorldDirection(_d); _d.y = 0; if (_d.lengthSq() < 1e-6) _d.set(0, 0, 1);
      out.copy(h).addScaledVector(_d.normalize(), 0.18); out.y -= 0.55; return out;
    } catch (e) { return null; }
  }
  function dispose(o, extra) {   // geometries / materials of o (+ replaced originals), except userData.shared and parts.HIDDEN
    const mats = new Set(extra || []), geos = new Set(), H = V3.parts && V3.parts.HIDDEN;
    if (o) {
      if (o.parent) o.parent.remove(o);
      o.traverse((m) => {
        if (m.geometry && !(m.geometry.userData && m.geometry.userData.shared)) geos.add(m.geometry);
        if (m.material) for (const x of [].concat(m.material)) mats.add(x);
      });
    }
    geos.forEach((g) => g.dispose());
    mats.forEach((x) => { if (x && x !== H && !(x.userData && x.userData.shared)) x.dispose(); });
  }
  function flash(p) {   // small light burst where the 3D shell turns into the icon
    const d = lay().appendChild(U.el('div', { style: { position: 'absolute', left: p.x - 30 + 'px', top: p.y - 30 + 'px', width: '60px', height: '60px',
      borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,.95) 0 28%, rgba(168,228,255,.6) 45%, rgba(111,195,245,0) 70%)' } }));
    d.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.7)', opacity: 0 }], { duration: 380, easing: 'ease-out' }).onfinish = () => d.remove();
  }
  function notify(ev, arrived) {   // HUD pulse + toast (rarity colour); 'fx:arrive' lets the box badge tick on arrival
    const k = ev.kind || {}, h = hudOf(), name = k.name || String(k.id || ''), I = V3.shellIcons;
    try {
      if (h && arrived && h.pulse) h.pulse('box');
      // 这一枚的花纹（非原色才写）和王冠：王冠用金色、单独一条
      const inst = ev.instance || ev.item || {}, R = V3.inventoryRules, pat = R && inst.pat && inst.pat !== 'plain' ? R.pattern(inst.pat) : null;
      const label = name + (pat ? ' · ' + pat.name : '');
      if (h && h.toast) h.toast((ev.first ? '新发现！' : '+1 ') + label, { color: I ? I.rarity(k).color : '#6fc3f5', kind: k.id, rarity: k.rarity, first: !!ev.first });
      if (h && h.toast && ev.crown) h.toast((ev.crown === 'big' ? '大金冠！' : '小金冠！') + name + ' ' + (+inst.size).toFixed(1) + ' mm',
        { color: '#f2b72f', kind: k.id, first: true, crown: ev.crown });
    } catch (e) { V3.err('collectFx hud: ' + ((e && e.message) || e)); }
    V3.emit('fx:arrive', ev);
  }

  class Fx {
    constructor(ev, obj) {
      this.ev = ev; this.obj = obj; this.t0 = performance.now(); this.pin = null; this.orig = null;
      this.p0 = obj.position.clone(); this.q0 = obj.quaternion.clone(); this.s0 = obj.scale.clone(); this.base = this.p0.clone();
      this.hand = ev.by === 'girl' ? handPos(new THREE.Vector3()) : null;
      this.tL = this.hand ? T_HAND : 0;   // the lift starts here
      this.icon = null; this.fading = false; this.done = false; this.based = !this.hand;
      this.lift = LIFT; this.grow = 1; this.fit();
    }
    fit() {   // close cameras: keep the lift ≤ 16 % of the view height; far cameras: grow the shell to ≥ 48 px while it lifts
      const sb = screenBox(this.obj), h = V3.R.canvas.getBoundingClientRect().height;
      if (!sb || sb.behind || !h) return;
      const a = toClient(this.p0), b = toClient(_d.copy(this.p0).setY(this.p0.y + LIFT)), px = Math.abs(a.y - b.y);
      if (px > h * 0.16) this.lift = Math.max(0.05, LIFT * h * 0.16 / px);
      this.grow = U.clamp(48 / Math.max(1, sb.s), 1, 6);
      this.fitInfo = { s: Math.round(sb.s), px: Math.round(px), lift: +this.lift.toFixed(3), grow: +this.grow.toFixed(2) };
    }
    step(t) {   // pose = f(t) (so a pinned t gives a still frame); the swap / fade start once
      const o = this.obj;
      if (o && this.hand && t < this.tL) { o.position.lerpVectors(this.p0, handPos(_v) || this.hand, easeOut(t / this.tL)); return; }
      if (!this.based) { this.base.copy(handPos(_v) || this.hand); this.based = true; }
      const tl = t - this.tL;
      if (tl < T_LIFT) {
        if (o) {
          const k = tl / T_LIFT;
          o.position.copy(this.base); o.position.y += this.lift * easeOut(k);
          o.quaternion.copy(_q.setFromAxisAngle(_y, Math.PI * 2 * easeIO(k))).multiply(this.q0);
          o.scale.copy(this.s0).multiplyScalar(U.lerp(1, this.grow, easeOut(Math.min(1, k * 2))) * (1 + 0.3 * Math.sin(Math.PI * Math.min(1, k * 1.4))));
        }
        return;
      }
      if (!this.icon && !this.fading) { const a = anchorBox(); if (a && V3.shellIcons && o) this.swap(a); else this.startFade(); }
      const k = Math.min(1, (tl - T_LIFT) / (this.icon ? T_FLY : T_FADE));
      if (this.icon) this.fly(k); else this.fade(k);
    }
    swap(a) {   // 3D → 2D: the icon appears where the shell is on screen; the 3D obj is freed right away
      const o = this.obj, sb0 = screenBox(o), sb = sb0 && !sb0.behind ? sb0 : { x: innerWidth / 2, y: innerHeight / 2, s: ICON };
      const x = U.clamp(sb.x, 0, innerWidth), y = U.clamp(sb.y, 0, innerHeight), kind = this.ev.kind || (this.ev.item && this.ev.item.kind);
      this.from = { x, y }; this.to = a; this.sc0 = U.clamp(sb.s, 24, 140) / ICON;
      const pat = (this.ev.instance || this.ev.item || {}).pat;
      this.icon = lay().appendChild(U.el('img', { src: V3.shellIcons.get(kind, { size: 160, pat }), width: ICON, height: ICON, style: {
        position: 'absolute', left: -ICON / 2 + 'px', top: -ICON / 2 + 'px', width: ICON + 'px', height: ICON + 'px', willChange: 'transform',
        filter: 'drop-shadow(0 2px 3px rgba(20,32,70,.45))', transform: `translate(${x}px,${y}px) scale(${this.sc0})` } }));
      flash(this.from);
      dispose(o); this.obj = null;
    }
    fly(k) {   // quadratic arc (up, then down into the box) with a small wobble; follows the anchor if it moves
      const e = easeIO(k), f = this.from, a = anchorBox() || this.to; this.to = a;
      const mx = (f.x + a.x) / 2 - (a.y - f.y) * 0.18, my = Math.min(f.y, a.y) - 60 - 0.25 * Math.hypot(a.x - f.x, a.y - f.y);
      const u = 1 - e, x = u * u * f.x + 2 * u * e * mx + e * e * a.x, y = u * u * f.y + 2 * u * e * my + e * e * a.y;
      const s = k < 0.25 ? U.lerp(this.sc0, 1.25, easeOut(k / 0.25)) : U.lerp(1.25, END / ICON, easeIO((k - 0.25) / 0.75));
      this.icon.style.transform = `translate(${x}px,${y}px) rotate(${Math.sin(k * Math.PI * 2) * 14}deg) scale(${s})`;
      if (k >= 1) { notify(this.ev, true); this.kill(); }
    }
    startFade() {   // no HUD: rise in place and fade out; materials are cloned so shared ones stay untouched
      this.fading = true;
      const o = this.obj; if (!o) return;
      this.orig = [];
      o.traverse((m) => {
        if (!m.material) return;
        const cl = [].concat(m.material).map((x) => {
          this.orig.push(x);
          const c = x.clone(); c.userData = { a0: x.opacity }; c.transparent = true; return c;
        });
        m.material = Array.isArray(m.material) ? cl : cl[0];
      });
      notify(this.ev, false);   // the toast still shows if a HUD is mounted without a visible box
    }
    fade(k) {
      const o = this.obj;
      if (o) {
        o.position.copy(this.base); o.position.y += this.lift * (1 + 0.6 * easeOut(k));
        o.scale.copy(this.s0).multiplyScalar(this.grow * (1 - 0.2 * k));
        const a = 1 - easeIO(k);
        o.traverse((m) => { if (m.material) for (const x of [].concat(m.material)) if (x.userData.a0 != null) x.opacity = x.userData.a0 * a; });
      }
      if (k >= 1) this.kill();
    }
    kill() {   // remove the icon, dispose the obj (+ the originals replaced by fade clones)
      if (this.done) return;
      this.done = true;
      if (this.icon) { this.icon.remove(); this.icon = null; }
      dispose(this.obj, this.orig); this.obj = null; this.orig = null;
    }
  }

  // real time (performance.now), so a frozen scene clock (t=… shots) does not stop the FX; pin = fixed t for test stills
  V3.on('frame', () => {
    const now = performance.now();
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      try { f.step(f.pin != null ? f.pin : (now - f.t0) / 1000); }
      catch (e) { V3.err('collectFx: ' + ((e && e.message) || e)); f.kill(); }
      if (f.done) list.splice(i, 1);
    }
  });

  // play({ obj, kind, by, first, item?, pin? }) → handle | null. obj = detached Object3D in world coordinates (or null)
  function play(ev = {}) {
    ev = Object.assign({}, ev);
    const KS = (V3.shells && V3.shells.KINDS) || [], kid = typeof ev.kind === 'string' ? ev.kind : (ev.kind && ev.kind.id) || (ev.item && ev.item.kind);
    ev.kind = KS.find((k) => k.id === kid) || ev.kind || null;
    const R = V3.R;
    let o = ev.obj || null;
    if (!R) { notify(ev, true); dispose(o); return null; }
    if (!o && ev.item && kid && V3.shells && V3.shells.has(kid)) {   // no beach object (beach-items missing): a stand-in at the spot
      const T = V3.terrain, it = ev.item;
      o = V3.shells.build(kid, { tag: false, anchor: 'fx:' + kid, pat: ev.item.pat });
      o.position.set(it.x || 0, T && T.groundY ? T.groundY(it.x || 0, it.z || 0) : 0, it.z || 0); o.rotation.y = it.ry || 0;
    }
    if (!o) { notify(ev, true); return null; }
    o.traverse((m) => { m.userData.noPick = true; delete m.userData.collectId; });
    o.matrixAutoUpdate = true;
    if (o.parent !== R.scene) R.scene.attach(o);   // keeps the world transform (o.parent null → its local = world)
    const f = new Fx(ev, o);
    if (Number.isFinite(ev.pin)) f.pin = ev.pin;
    list.push(f);
    return f;
  }
  function clear() { for (const f of list) f.kill(); list.length = 0; }
  V3.on('game:collect', (ev) => {
    if (ev && ev.kind && ev.kind.category === 'trash') { dispose(ev.obj); return; }
    try { play(ev); } catch (e) { V3.err('collectFx.play: ' + ((e && e.message) || e)); dispose(ev && ev.obj); }
  });

  // test token fx=<kind>[:first][:girl][:nohud][:<t s>] (',' also works): demo collect on the ground under the screen centre,
  // optionally pinned at t seconds. If V3.hud gives no box anchor (studio: never mounted) a mock box button (bottom right)
  // stands in, unless nohud. fx=0 clears.
  let mock = null;
  const unmock = () => { if (mock) { mock.remove(); mock = null; } mockHud = null; const d = document.getElementById('v3-fx-dbg'); if (d) d.remove(); };
  V3.viewTokens.fx = (v) => {
    clear(); unmock();
    const ps = String(v || '').split(/[:,]/), id = ps[0], R = V3.R;
    if (!id || id === '0' || !R || !V3.shells || !V3.shells.has(id)) return;
    const pin = ps.map(Number).find((n, i) => i > 0 && Number.isFinite(n) && ps[i] !== '');
    if (!anchorBox() && !ps.includes('nohud')) {
      const el = mock = document.body.appendChild(U.el('div', { id: 'v3-fx-mock', style: { position: 'fixed', right: '24px', bottom: '24px', width: '64px',
        height: '64px', borderRadius: '50%', border: '3px dashed #6fc3f5', background: 'rgba(30,42,86,.6)', zIndex: '39', pointerEvents: 'none' } }));
      mockHud = { anchor: () => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
        pulse: () => el.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 300 }),
        toast: (text, o) => el.appendChild(U.el('div', { style: { position: 'absolute', right: '0', bottom: '76px', whiteSpace: 'nowrap',
          background: '#fff', color: (o && o.color) || '#1e2a56', border: '3px solid ' + ((o && o.color) || '#6fc3f5'), borderRadius: '14px',
          padding: '4px 12px', font: 'bold 16px sans-serif' } }, text)) };
    }
    R.camera.updateMatrixWorld();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, -0.25), R.camera);   // a bit below the centre
    const hit = ray.intersectObjects(R.scene.children, true).find((h) => h.object.isMesh && h.object.visible && h.face && h.face.normal.y > 0.5
      && !(h.object.material && [].concat(h.object.material).every((m) => !m.visible)));
    const p = hit ? hit.point : ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!p) return;
    const o = V3.shells.build(id, { tag: false, anchor: 'fx-demo:' + id });
    o.position.copy(p); o.rotation.y = 0.6;
    const f = play({ obj: o, kind: id, by: ps.includes('girl') ? 'girl' : 'player', first: ps.includes('first'), pin });
    if (f && ps.includes('dbg')) lay().appendChild(U.el('div', { id: 'v3-fx-dbg', style: { position: 'absolute', left: '8px', top: '8px', background: '#000a',
      color: '#fff', font: '12px monospace', padding: '2px 6px' } }, 'fx ' + JSON.stringify(f.fitInfo || {})));
  };

  V3.collectFx = { play, clear, active: () => list.length };
})(window.V3);
