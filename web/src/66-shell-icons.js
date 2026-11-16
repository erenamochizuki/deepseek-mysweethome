// 66-shell-icons.js — V3.shellIcons: shell icons + silhouettes for the HUD, collection box and collect FX
// (docs/SPEC-4.md §4). Each icon is drawn once with the MAIN renderer into an off-screen target (linear HDR,
// MSAA, 2× size) → one pass: 2×2 box downsample + ACES + sRGB into an 8-bit target → readPixels → canvas →
// PNG dataURL, cached per (kind, size). The renderer state is saved before and restored after every icon.
(function (V3) {
  'use strict';
  const U = V3.util;

  // rarity labels / colours, shared by the collection box and the collect toast
  const RARITY = {
    common: { id: 'common', label: '常见', color: '#6fc3f5' },
    uncommon: { id: 'uncommon', label: '少见', color: '#5fd3a6' },
    rare: { id: 'rare', label: '稀有', color: '#ffc94d' },
  };
  const SIL = [0x5d, 0x6b, 0x7c], SIL_A = 0.6;   // silhouette: one colour #5d6b7c, semi-transparent
  const EXPOSURE = 1.0, PAD = 1.08;              // fixed icon exposure (not the scene's time of day); frame padding
  // per-kind view: az = turn of the shell about y (rad, same sense as the catalog camera az), el = camera elevation (rad)
  const VIEW = {
    _: { az: 0.35, el: 0.8 },
    starfish: { el: 1.2 }, dollar: { el: 1.2 }, pearl: { el: 0.55 }, nautilus: { el: 1.3 },
    miter: { az: 2.19 }, nassa: { az: 2.19 },   // long axis on the diagonal, spire up-right
  };
  const cache = new Map();   // 'id@size' → { buf, n, url, sil }

  const VS = 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const FS = `uniform sampler2D tSrc; uniform float uExp; varying vec2 vUv;
const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 rrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 toSRGB(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec4 s = texture2D(tSrc, vUv);                        // bilinear tap on a 2×2 texel corner = box downsample
  float a = clamp(s.a, 0.0, 1.0);
  vec3 c = a > 1e-4 ? max(s.rgb, 0.0) / a : vec3(0.0);   // un-premultiply the anti-aliased edge
  c = toSRGB(clamp(ACES_OUT * rrtOdt(ACES_IN * (c * uExp / 0.6)), 0.0, 1.0));
  gl_FragColor = vec4(c, a);
}`;

  let K = null;   // lazy kit: icon scene + lights, ortho camera, composite quad
  function kit() {
    if (K) return K;
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xf3f6ff, 0x9a8f80, 0.9);
    const key = new THREE.DirectionalLight(0xfff1e0, 1.6); key.position.set(-0.6, 1.0, 0.75);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.5); fill.position.set(0.9, 0.35, 0.4);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(0.2, 0.6, -1.0);
    scene.add(hemi, key, fill, rim);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { tSrc: { value: null }, uExp: { value: EXPOSURE } },
      blending: THREE.NoBlending, depthTest: false, depthWrite: false, toneMapped: false });
    const quad = new THREE.Mesh(g, mat); quad.frustumCulled = false;
    const qs = new THREE.Scene(); qs.add(quad);
    K = { scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10), qs, qcam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat };
    return K;
  }

  // turn the shell, aim the ortho camera from elevation el, fit the square frame to the projected vertices
  const _v = new THREE.Vector3(), _m = new THREE.Matrix4();
  function pose(o, id) {
    const v = Object.assign({}, VIEW._, VIEW[id]), cam = K.cam;
    o.rotation.set(0, -v.az, 0); o.updateMatrixWorld(true);
    cam.position.set(0, Math.sin(v.el), Math.cos(v.el)); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
    _m.copy(cam.matrixWorld).invert();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    o.traverse((m) => {
      if (!m.isMesh) return;
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).applyMatrix4(_m);
        x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y);
        z0 = Math.min(z0, _v.z); z1 = Math.max(z1, _v.z);
      }
    });
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, h = Math.max(x1 - x0, y1 - y0) / 2 * PAD;
    cam.left = cx - h; cam.right = cx + h; cam.bottom = cy - h; cam.top = cy + h;
    cam.near = -z1 - 0.05; cam.far = -z0 + 0.05; cam.updateProjectionMatrix();
  }

  // everything an off-screen pass touches; restored exactly afterwards
  function save(r) {
    const c = new THREE.Color(); r.getClearColor(c);
    return { rt: r.getRenderTarget(), face: r.getActiveCubeFace(), mip: r.getActiveMipmapLevel(), cc: c, ca: r.getClearAlpha(),
      tm: r.toneMapping, cs: r.outputColorSpace, ac: r.autoClear, sa: r.shadowMap.autoUpdate, sn: r.shadowMap.needsUpdate,
      ar: r.info.autoReset, info: Object.assign({}, r.info.render) };
  }
  function restore(r, s) {
    r.setRenderTarget(s.rt, s.face, s.mip); r.setClearColor(s.cc, s.ca);
    r.toneMapping = s.tm; r.outputColorSpace = s.cs; r.autoClear = s.ac;
    r.shadowMap.autoUpdate = s.sa; r.shadowMap.needsUpdate = s.sn;
    r.info.autoReset = s.ar; Object.assign(r.info.render, s.info);
  }

  let floatOK;
  function render(id, n) {   // → Uint8Array n·n·4 (RGBA, rows bottom-up, straight alpha)
    const r = V3.R && V3.R.renderer;
    if (!r) throw new Error('no renderer yet');
    if (!V3.shells || !V3.shells.has(id)) throw new Error('unknown shell');
    const k = kit(), gl2 = !!r.capabilities.isWebGL2;
    if (floatOK === undefined) floatOK = r.extensions.has(gl2 ? 'EXT_color_buffer_float' : 'EXT_color_buffer_half_float');
    const rt1 = new THREE.WebGLRenderTarget(2 * n, 2 * n, { type: floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true, samples: gl2 ? 4 : 0 });
    const rt2 = new THREE.WebGLRenderTarget(n, n, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false });
    const o = V3.shells.build(id, { tag: false, anchor: 'icon:' + id });
    const s = save(r), buf = new Uint8Array(n * n * 4);
    try {
      r.info.autoReset = false; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false;
      r.toneMapping = THREE.NoToneMapping; r.autoClear = false;
      k.scene.add(o); pose(o, id);
      r.setRenderTarget(rt1); r.setClearColor(0x000000, 0); r.clear(true, true, false);
      r.render(k.scene, k.cam);
      k.mat.uniforms.tSrc.value = rt1.texture;
      r.setRenderTarget(rt2); r.clear(true, false, false);
      r.render(k.qs, k.qcam);
      r.readRenderTargetPixels(rt2, 0, 0, n, n, buf);
    } finally {
      k.scene.remove(o); k.mat.uniforms.tSrc.value = null;
      restore(r, s); rt1.dispose(); rt2.dispose();
    }
    return buf;
  }

  // RGBA rows bottom-up → PNG dataURL (sil: one flat colour, alpha × SIL_A)
  function toURL(buf, n, sil) {
    const c = U.el('canvas', { width: n, height: n }), g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data;
    for (let y = 0; y < n; y++) {
      const src = (n - 1 - y) * n * 4, dst = y * n * 4;
      for (let x = 0; x < n * 4; x += 4) {
        const a = buf[src + x + 3];
        if (sil) { d[dst + x] = SIL[0]; d[dst + x + 1] = SIL[1]; d[dst + x + 2] = SIL[2]; d[dst + x + 3] = Math.round(a * SIL_A); }
        else { d[dst + x] = buf[src + x]; d[dst + x + 1] = buf[src + x + 1]; d[dst + x + 2] = buf[src + x + 2]; d[dst + x + 3] = a; }
      }
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }
  let blank = '', warned = 0;
  const blankURL = () => blank || (blank = U.el('canvas', { width: 1, height: 1 }).toDataURL('image/png'));
  const idOf = (k) => (k && typeof k === 'object' ? k.id : String(k || ''));

  // get(kind, { silhouette, size: 96 }) → PNG dataURL. size = image pixels (pass CSS size × devicePixelRatio for crisp UI).
  // kind = id string or a KINDS entry. Fails soft: logs once to __errors and returns a 1×1 transparent PNG (not cached).
  function get(kind, opt = {}) {
    const id = idOf(kind), n = U.clamp(Math.round(opt.size || 96), 16, 512), key = id + '@' + n;
    let e = cache.get(key);
    if (!e) {
      try { e = { buf: render(id, n), n }; cache.set(key, e); }
      catch (err) { if (warned++ < 3) V3.err('shellIcons.get ' + id + ': ' + ((err && err.message) || err)); return blankURL(); }
    }
    const f = opt.silhouette ? 'sil' : 'url';
    if (!e[f]) e[f] = toURL(e.buf, n, !!opt.silhouette);
    if (e.url && e.sil) e.buf = null;   // both variants made → drop the pixels
    return e[f];
  }

  // preload(size, both = true) → Promise: renders every kind (and its silhouette), one icon per frame
  function preload(size = 96, both = true) {
    const q = [];
    for (const k of (V3.shells && V3.shells.KINDS) || []) { q.push([k.id, false]); if (both) q.push([k.id, true]); }
    return new Promise((res) => {
      if (!q.length) { res(); return; }
      const step = () => {
        const it = q.shift();
        if (it) get(it[0], { size, silhouette: it[1] });
        if (!q.length) { V3.off('frame', step); res(); }
      };
      V3.on('frame', step);
    });
  }

  function rarity(k) {   // KINDS entry | kind id | rarity id → RARITY entry
    if (k && typeof k === 'object' && RARITY[k.rarity]) return RARITY[k.rarity];
    if (RARITY[k]) return RARITY[k];
    const kk = ((V3.shells && V3.shells.KINDS) || []).find((x) => x.id === idOf(k));
    return (kk && RARITY[kk.rarity]) || RARITY.common;
  }

  // test token icons=1: every icon + silhouette on light and dark tiles (icons=0 removes the sheet)
  let sheet = null;
  V3.viewTokens.icons = (v) => {
    if (sheet) { sheet.remove(); sheet = null; }
    if (v === '0') return;
    const n = 80, ks = (V3.shells && V3.shells.KINDS) || [];
    const tile = (bg, url) => U.el('div', { style: { width: n + 'px', height: n + 'px', background: bg, borderRadius: '12px',
      display: 'flex', alignItems: 'center', justifyContent: 'center' } }, U.el('img', { src: url, width: n, height: n }));
    sheet = U.el('div', { id: 'v3-icon-sheet', style: { position: 'fixed', top: '0', left: '0', right: '0', zIndex: '50', background: '#8f99a6', display: 'grid',
      gridTemplateColumns: 'repeat(' + ks.length + ', ' + (n + 8) + 'px)', gap: '8px 4px', padding: '16px', alignContent: 'start',
      justifyContent: 'center', font: '13px sans-serif', color: '#fff', textAlign: 'center' } });
    for (const [bg, sil] of [['#ece6da', false], ['#ece6da', true], ['#1e2a56', false], ['#1e2a56', true]])
      for (const k of ks) sheet.append(tile(bg, get(k.id, { size: 2 * n, silhouette: sil })));
    for (const k of ks) sheet.append(U.el('div', { style: { color: rarity(k).color } }, k.name));
    document.body.append(sheet);
    const r = V3.R && V3.R.renderer;   // self-check: one fresh icon must leave the renderer state exactly as it was
    if (r) {
      const snap = () => { const s = save(r); s.cc = s.cc.getHex(); s.rt = s.rt ? s.rt.uuid : null; s.info = s.info.calls + '/' + s.info.triangles; return JSON.stringify(s); };
      cache.delete('scallop@64'); const a = snap(); get('scallop', { size: 64 }); const b = snap();
      window.__iconCheck = a === b ? 'state OK' : 'state CHANGED ' + a + ' → ' + b;
      if (a !== b) V3.err('shellIcons: ' + window.__iconCheck);
    }
  };
  // test token coldetail=<id> (cabin page, after found=all): opens that shell's detail card in the collection box
  V3.viewTokens.coldetail = (v) => {
    const C = V3.collection;
    if (!C || !C.openDetail || !V3.hud || !V3.hud.mounted) { V3.err('coldetail: no collection box on this page'); return; }
    C.openDetail(v || 'scallop');
  };

  V3.shellIcons = { RARITY, rarity, get, preload, clear: () => cache.clear(), _render: render };
})(window.V3);
