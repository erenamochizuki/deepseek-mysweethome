// 01-render.js — renderer, camera, orbit controller, loop, snapshot, view get/set.
(function (V3) {
  'use strict';
  const U = V3.util;

  class Orbit {
    constructor(camera, dom) {
      this.camera = camera; this.dom = dom;
      this.target = new THREE.Vector3(0, 0.6, 0); this.az = 0.5; this.el = 0.2; this.dist = 3;
      this.g = { target: this.target.clone(), az: this.az, el: this.el, dist: this.dist };
      this.minDist = 0.2; this.maxDist = 60; this.minEl = -1.3; this.maxEl = 1.5;
      this.enabled = true; this.damp = 14; this.moved = 0;
      this.noPan = false;   // true: pan() does nothing (67-follow.js owns the target while the camera follows the character); rotate / zoom are unaffected
      this.ptrs = new Map();
      const d = dom;
      d.addEventListener('contextmenu', e => e.preventDefault());
      d.addEventListener('pointerdown', e => {
        if (!this.enabled) return;
        d.setPointerCapture(e.pointerId);
        this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.ptrs.size === 1) { this.moved = 0; this.mode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'rot'; }
      });
      d.addEventListener('pointermove', e => {
        const p = this.ptrs.get(e.pointerId); if (!p) return;
        if (this.ptrs.size === 1) {
          const dx = e.clientX - p.x, dy = e.clientY - p.y;
          this.moved += Math.abs(dx) + Math.abs(dy);
          if (this.mode === 'pan') this.pan(dx, dy); else this.rotate(dx, dy);
          p.x = e.clientX; p.y = e.clientY;
        } else if (this.ptrs.size === 2) {
          const [a, b] = [...this.ptrs.values()];
          const d0 = Math.hypot(a.x - b.x, a.y - b.y), m0x = (a.x + b.x) / 2, m0y = (a.y + b.y) / 2;
          p.x = e.clientX; p.y = e.clientY;
          const d1 = Math.hypot(a.x - b.x, a.y - b.y), m1x = (a.x + b.x) / 2, m1y = (a.y + b.y) / 2;
          if (d1 > 1) this.zoom(d0 / d1);
          this.pan(m1x - m0x, m1y - m0y);
          this.moved += 10;
        }
      });
      const up = e => { this.ptrs.delete(e.pointerId); };
      d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
      d.addEventListener('wheel', e => { if (!this.enabled) return; e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    }
    rotate(dx, dy) { this.g.az -= dx * 0.008; this.g.el = U.clamp(this.g.el + dy * 0.008, this.minEl, this.maxEl); }
    zoom(f) { this.g.dist = U.clamp(this.g.dist * f, this.minDist, this.maxDist); }
    pan(dx, dy) {
      if (this.noPan) return;
      const c = this.camera, h = this.dom.clientHeight || 800;
      const s = 2 * this.dist * Math.tan(c.fov * Math.PI / 360) / h;
      const right = new THREE.Vector3().setFromMatrixColumn(c.matrix, 0);
      const upv = new THREE.Vector3().setFromMatrixColumn(c.matrix, 1);
      this.g.target.addScaledVector(right, -dx * s).addScaledVector(upv, dy * s);
    }
    set(v, animate = false) {
      const g = this.g;
      if (v.az != null) g.az = v.az; if (v.el != null) g.el = v.el; if (v.dist != null) g.dist = v.dist;
      if (v.target) g.target.set(v.target[0] ?? v.target.x, v.target[1] ?? v.target.y, v.target[2] ?? v.target.z);
      if (!animate) { this.az = g.az; this.el = g.el; this.dist = g.dist; this.target.copy(g.target); this.update(0); }
    }
    setFromPos(pos, target) {
      const t = new THREE.Vector3(...target), o = new THREE.Vector3(...pos).sub(t), d = Math.max(o.length(), 1e-4);
      this.set({ target: [t.x, t.y, t.z], dist: d, el: Math.asin(U.clamp(o.y / d, -1, 1)), az: Math.atan2(o.x, o.z) });
    }
    update(dt) {
      const g = this.g, k = dt > 0 ? 1 - Math.exp(-this.damp * dt) : 0;
      if (k) {
        this.az += (g.az - this.az) * k; this.el += (g.el - this.el) * k;
        this.dist += (g.dist - this.dist) * k; this.target.lerp(g.target, k);
      }
      const c = Math.cos(this.el);
      this.camera.position.set(this.target.x + this.dist * c * Math.sin(this.az), this.target.y + this.dist * Math.sin(this.el),
        this.target.z + this.dist * c * Math.cos(this.az));
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld();
    }
  }
  V3.Orbit = Orbit;

  // ---- boot: V3.boot() creates renderer + scene, emits 'init', starts the loop ----
  V3.boot = (opts = {}) => {
    if (V3.R) return V3.R;
    const canvas = U.el('canvas', { id: 'v3-canvas' });
    document.body.prepend(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(opts.fov || 30, 1, 0.02, 400);
    const ctl = new Orbit(camera, canvas);
    const R = V3.R = { renderer, scene, camera, ctl, canvas, t: 0, frozen: null, fps: 60 };
    const clock = R.clock = new THREE.Clock();

    R.freeze = (t) => { R.frozen = (t == null || isNaN(t)) ? null : Number(t); if (R.frozen != null) R.t = R.frozen; };
    // R.post = fn(renderer, scene, camera, dt) | null — a scene model may install a post pipeline (bloom etc.)
    R.post = null;
    R.render = (dt = 0) => {
      let rendered = false;
      if (R.post) { try { R.post(renderer, scene, camera, dt); rendered = true; } catch (e) { V3.err('post', e); R.post = null; } }
      if (!rendered) renderer.render(scene, camera);
      if (V3.hoverOutline) { try { V3.hoverOutline.render(renderer, scene, camera, V3.shallows?.selectedResident); } catch (e) { V3.hoverOutline.clear(); V3.err('hover-outline', e); } }
    };
    R.snapshot = (w, h) => {
      R.render();
      const src = renderer.domElement;
      if (!w) return src.toDataURL('image/png');
      h = h || Math.round(w * src.height / src.width);
      const c = U.el('canvas', { width: w, height: h });
      c.getContext('2d').drawImage(src, 0, 0, w, h);
      return c.toDataURL('image/png');
    };
    R.getView = () => ({
      pos: camera.position.toArray().map(v => +v.toFixed(4)),
      target: ctl.target.toArray().map(v => +v.toFixed(4)), fov: camera.fov,
    });
    R.setView = (v) => { if (v.fov) { camera.fov = v.fov; camera.updateProjectionMatrix(); } ctl.setFromPos(v.pos, v.target); };
    R.frameObject = (obj, pad = 1.3, animate = true) => {
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;
      const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
      const d = (r * pad) / Math.sin(camera.fov * Math.PI / 360);
      ctl.set({ target: [c.x, c.y, c.z], dist: U.clamp(d, ctl.minDist, ctl.maxDist) }, animate);
    };
    R.info = () => ({ fps: Math.round(R.fps), draws: renderer.info.render.calls, tris: renderer.info.render.triangles });

    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, true);
      camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix();
      V3.emit('resize', w, h);
    };
    window.addEventListener('resize', resize);
    resize();
    V3.emit('init', R);

    function advance(real) {
      const dt = R.frozen != null ? 0 : real;
      R.t = R.frozen != null ? R.frozen : R.t + dt;
      ctl.update(real);
      V3.emit('frame', dt, R.t);
    }

    let mode, frame, timer, pageHidden = false, pendingSeconds = 0;
    function foreground() {
      frame = requestAnimationFrame(foreground);
      const real = Math.min(clock.getDelta(), 0.1);
      if (real > 0) R.fps += (1 / real - R.fps) * 0.05;
      advance(real);
      R.render(real);
    }

    // Hidden tabs receive timers in batches. Advance the same simulation in small
    // motion steps, yielding between batches so input and visibility changes can run.
    const catchup = new MessageChannel();
    function runPending() {
      const until = performance.now() + 10;
      while (pendingSeconds > 0) {
        const step = Math.min(pendingSeconds, 0.1);
        pendingSeconds -= step;
        advance(step);
        if (pendingSeconds > 0 && performance.now() >= until) {
          catchup.port2.postMessage(0);
          return;
        }
      }
    }
    catchup.port1.onmessage = runPending;
    function background() {
      const wasPending = pendingSeconds > 0;
      // Leave long OS sleeps to the existing offline progression rules.
      pendingSeconds = Math.min(60, pendingSeconds + clock.getDelta());
      if (!wasPending) runPending();
    }
    function schedule() {
      const next = pageHidden || V3.backgroundPaused() ? 'paused' : document.hidden ? 'background' : 'foreground';
      if (next === mode) return;
      cancelAnimationFrame(frame);
      clearInterval(timer);
      pendingSeconds = 0;
      clock.getDelta();
      mode = next;
      if (mode === 'foreground') frame = requestAnimationFrame(foreground);
      if (mode === 'background') timer = setInterval(background, 250);
    }
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('pagehide', () => { pageHidden = true; schedule(); });
    window.addEventListener('pageshow', () => { pageHidden = false; schedule(); });
    V3.on('game:start', schedule);
    V3.on('game:settings', ({key}) => { if (key === 'powerSaving') schedule(); });
    schedule();
    return R;
  };
})(window.V3);
