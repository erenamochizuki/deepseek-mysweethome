// src/07-post.js — V3.post(renderer, scene, camera, dt)：泛光 + ACES + 调色 + 暗角（移植自 v1 的 07-post.js；体积光和 FXAA 不移植）
// 流程：场景 → 线性 HDR 半浮点 MSAA 目标（这一遍临时关掉 renderer.toneMapping）→ 泛光（Karis 预滤 + 软阈值，6 级 13-tap 下采样，tent 上采样叠加）
//       → 合成到屏幕：曝光 → +泛光 → 白平衡 → ACES（保色相混合）→ 饱和度 → 分离色调 → 暗角 → sRGB → 对比 → 抬黑 → 8×8 抖动。
// 曝光 = renderer.toneMappingExposure（天空部件按 env.exposure 写）× params.exposure × tone.pre（1/0.6 = three 的 ACES 输入缩放，和不开后期时一致）。
// house2 模型把它挂到 V3.R.post；URL ?nopost=1 或出错时退回 renderer.render。V3.post.params 每帧读取，可实时调；?postdebug=1 只看泛光。
(function (V3) {
  'use strict';
  const U = V3.util || {};
  const qs = (k, d) => (typeof U.qs === 'function' ? U.qs(k, d) : d);
  const NOPOST = String(qs('nopost', '')) === '1';
  const P = {
    enabled: true,
    exposure: 1.0,
    tone: { pre: 1 / 0.6, night: 0.0, hue: 0.8, hueNight: 0.7 },   // hue：0 普通 ACES，1 只压亮度（保住夕阳下沙子/屋顶的暖色）；夜里按 hueNight 减
    bloom: { on: true, threshold: 1.0, knee: 0.5, intensity: 0.12, golden: 0.3, night: 0.85,    // 强度：白天 / 黄昏 / 夜晚
             thrGolden: 0.8, thrNight: 0.6, levels: 6, radius: 1.0, scatter: 0.88, clamp: 64, karis: true },
    grade: { warm: 0.05, sat: 1.06, lift: 0.010, goldenWarm: 0.12, nightCool: 0.12, maxWarm: 0.22,
             envWarm: 0.35, envSat: 0.5, envLift: 0.4, nightSat: 1.12,
             contrast: 0.12, split: 0.08, splitGolden: 0.18, splitNight: 0.30,
             hi: [1.07, 1.0, 0.88], lo: [0.88, 0.96, 1.12] },
    vignette: { on: true, amount: 0.18, night: 0.25, inner: 0.25, outer: 1.15 },
    dither: 1.0,                       // ±0.5 LSB 有序抖动，防天空色带
    msaa: 4,                           // 场景目标多重采样（WebGL2）；超过 3.7 MP 的画布自动降到 2（2026-11-05 测过 4→2：同页交替 A/B 帧时间无差别，保留 4）
    debug: +qs('postdebug', 0) || 0    // 0 成片 | 1 只看泛光
  };
  const S = { rt: null, q: null, mb: null, mc: null, black: null, v2: null, norm: 1, broken: false };
  const stats = { ms: 0, w: 0, h: 0, samples: 0, exp: 0, bloom: 0, thr: 0, night: 0, golden: 0, draws: 0, tris: 0 };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const cl = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const Uv = (v) => ({ value: v });

  // ---- GLSL ------------------------------------------------------------------------------------------
  const VS = 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const HEAD = `varying vec2 vUv;
const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 rrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 acesFit(vec3 c) { return clamp(ACES_OUT * rrtOdt(ACES_IN * c), 0.0, 1.0); }
vec3 toSRGB(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer8(vec2 a) { return bayer2(0.25 * a) * 0.0625 + bayer2(0.5 * a) * 0.25 + bayer2(a); }
`;
  // 13-tap 下采样；PRE = 第一级：乘曝光、防 NaN/萤火虫、Karis 加权、软阈值
  const DOWN = `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uExp, uThr, uKnee, uClamp, uKaris;
vec3 tap(vec2 o) {
  vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb;
#ifdef PRE
  c *= uExp; float t = c.r + c.g + c.b;
  if (!(t >= 0.0 && t < 65000.0)) c = vec3(0.0);
  c = min(max(c, 0.0), vec3(uClamp));
#endif
  return c;
}
float kw(vec3 c) { return mix(1.0, 1.0 / (1.0 + luma(c)), uKaris); }
void main() {
  vec3 a = tap(vec2(-2.0, 2.0)), b = tap(vec2(0.0, 2.0)), c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0)), e = tap(vec2(0.0)), f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0)), h = tap(vec2(0.0, -2.0)), i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0)), k = tap(vec2(1.0, 1.0)), l = tap(vec2(-1.0, -1.0)), m = tap(vec2(1.0, -1.0));
#ifdef PRE
  vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
  float w0 = 0.5 * kw(g0), w1 = 0.125 * kw(g1), w2 = 0.125 * kw(g2), w3 = 0.125 * kw(g3), w4 = 0.125 * kw(g4);
  vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  float br = max(col.r, max(col.g, col.b)), kn = max(uKnee, 1e-4);
  float rq = clamp(br - uThr + kn, 0.0, 2.0 * kn); rq = rq * rq / (4.0 * kn);
  col *= max(rq, br - uThr) / max(br, 1e-4);
#else
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
#endif
  gl_FragColor = vec4(col, 1.0);
}`;
  // tent 上采样，叠加到上一级（dst += weight × tent(src)）
  const UP = `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight;
void main() {
  vec2 d = uTexel, u = vUv;
  vec3 c = texture2D(tSrc, u).rgb * 4.0;
  c += (texture2D(tSrc, u + vec2(d.x, 0.0)).rgb + texture2D(tSrc, u - vec2(d.x, 0.0)).rgb
      + texture2D(tSrc, u + vec2(0.0, d.y)).rgb + texture2D(tSrc, u - vec2(0.0, d.y)).rgb) * 2.0;
  c += texture2D(tSrc, u + d).rgb + texture2D(tSrc, u - d).rgb
      + texture2D(tSrc, u + vec2(d.x, -d.y)).rgb + texture2D(tSrc, u + vec2(-d.x, d.y)).rgb;
  gl_FragColor = vec4(c * (uWeight / 16.0), 1.0);
}`;
  // 合成：曝光 → +泛光 → 白平衡 → ACES（uHue 保色相）→ 饱和度 → 分离色调 → 暗角 → sRGB → 对比 → 抬黑 → 抖动
  const COMP = `uniform sampler2D tSrc, tBloom; uniform float uExp, uBloom, uSat, uSplit, uLift, uVig, uVin, uVout, uAspect, uCon, uHue, uDither;
uniform vec3 uWB, uHi, uLo; uniform int uDebug;
void main() {
  vec3 hdr = max(texture2D(tSrc, vUv).rgb, 0.0) * uExp;
  float t = hdr.r + hdr.g + hdr.b;
  if (!(t >= 0.0 && t < 65000.0)) hdr = vec3(0.0);
  vec3 c = hdr + texture2D(tBloom, vUv).rgb * uBloom;
  if (uDebug == 1) c = texture2D(tBloom, vUv).rgb * uBloom * 4.0;
  c *= uWB;
  float yIn = max(luma(c), 1e-5);
  vec3 cHue = c * (luma(acesFit(vec3(yIn))) / yIn);
  float mx = max(max(cHue.r, cHue.g), cHue.b);
  if (mx > 1.0) { float yh = luma(cHue); cHue = mix(vec3(yh), cHue, clamp((1.0 - yh) / max(mx - yh, 1e-5), 0.0, 1.0)); }
  c = mix(acesFit(c), clamp(cHue, 0.0, 1.0), uHue);
  float y = luma(c);
  c = max(mix(vec3(y), c, uSat), 0.0);
  vec3 tone = mix(uLo, uHi, smoothstep(0.03, 0.5, sqrt(y)));
  c *= mix(vec3(1.0), tone, uSplit);
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0) / (0.5 * sqrt(uAspect * uAspect + 1.0));
  c *= 1.0 - uVig * smoothstep(uVin, uVout, length(q));
  vec3 s = toSRGB(c);
  s = mix(s, s * s * (3.0 - 2.0 * s), uCon);
  s = s + uLift * (1.0 - s);
  s += (bayer8(gl_FragCoord.xy) - 0.5) * uDither / 255.0;
  gl_FragColor = vec4(s, 1.0);
}`;

  // ---- helpers: fullscreen triangle, passes, targets -------------------------------------------------
  function quad() {
    if (S.q) return S.q;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const mesh = new THREE.Mesh(g), scene = new THREE.Scene();
    mesh.frustumCulled = false; scene.add(mesh);
    S.q = { mesh, scene, base: mesh.material, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    return S.q;
  }
  function pass(fs, uniforms, additive, defines) {
    const m = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: HEAD + fs, uniforms, defines: defines || {},
      depthTest: false, depthWrite: false, toneMapped: false });
    if (additive) {                                   // dst += src（上采样原地累加），alpha 不动
      m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
      m.blendEquationAlpha = THREE.AddEquation; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
    }
    return m;
  }
  function mats() {
    if (S.mb) return S.mb;
    const V2 = () => Uv(new THREE.Vector2()), V3c = () => Uv(new THREE.Vector3(1, 1, 1));
    const du = () => ({ tSrc: Uv(null), uTexel: V2(), uExp: Uv(1), uThr: Uv(1), uKnee: Uv(0.5), uClamp: Uv(64), uKaris: Uv(0) });
    S.mb = {
      pre: pass(DOWN, du(), false, { PRE: 1 }), down: pass(DOWN, du()),
      up: pass(UP, { tSrc: Uv(null), uTexel: V2(), uWeight: Uv(1) }, true),
      comp: pass(COMP, { tSrc: Uv(null), tBloom: Uv(null), uExp: Uv(1), uBloom: Uv(0), uSat: Uv(1), uSplit: Uv(0), uLift: Uv(0),
        uVig: Uv(0), uVin: Uv(0.25), uVout: Uv(1.15), uAspect: Uv(1.6), uCon: Uv(0), uHue: Uv(0), uDither: Uv(1),
        uWB: V3c(), uHi: V3c(), uLo: V3c(), uDebug: Uv(0) })
    };
    return S.mb;
  }
  function blackTex() {
    if (!S.black) { S.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat); S.black.needsUpdate = true; }
    return S.black;
  }
  function draw(renderer, mat, target) {
    const q = quad();
    q.mesh.material = mat;
    renderer.setRenderTarget(target || null);
    renderer.render(q.scene, q.cam);
  }
  const TOPT = () => ({ type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
  function freeTargets() {
    const rt = S.rt; S.rt = null;
    if (rt) { rt.scene.dispose(); rt.mips.forEach((m) => m.dispose()); }
  }
  function ensure(renderer) {                         // 场景目标（MSAA，带深度）+ 6 级泛光 mip（半分辨率起）；尺寸变了就重建
    const v = renderer.getDrawingBufferSize(S.v2 || (S.v2 = new THREE.Vector2()));
    const w = Math.max(1, v.x | 0), h = Math.max(1, v.y | 0);
    const gl2 = !!(renderer.capabilities && renderer.capabilities.isWebGL2);
    const smp = gl2 ? Math.max(0, Math.min(w * h > 3.7e6 ? 2 : 8, P.msaa | 0)) : 0;
    if (S.rt && S.rt.w === w && S.rt.h === h && S.rt.samples === smp) return S.rt;
    freeTargets();
    const o = TOPT(); o.depthBuffer = true; o.samples = smp;
    const rt = S.rt = { w, h, samples: smp, scene: new THREE.WebGLRenderTarget(w, h, o), mips: [] };
    let mw = w, mh = h;
    for (let i = 0; i < 6; i++) { mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); rt.mips.push(new THREE.WebGLRenderTarget(mw, mh, TOPT())); }
    return rt;
  }
  function floatOK(renderer) {                        // 半浮点目标能不能画（WebGL2 要 EXT_color_buffer_float）
    if (S.fok !== undefined) return S.fok;
    const ex = renderer.extensions, gl2 = !!(renderer.capabilities && renderer.capabilities.isWebGL2);
    S.fok = !!(ex && ex.has && (gl2 ? ex.has('EXT_color_buffer_float') : ex.has('EXT_color_buffer_half_float')));
    if (!S.fok) stats.fallback = 'no float render target';
    return S.fok;
  }

  // ---- bloom: Karis 预滤 + 软阈值 → 13-tap 下采样 ×5 → tent 上采样（叠加）--------------------------------
  function bloom(renderer, rt, exp, thr) {
    const B = P.bloom, m = mats(), n = Math.max(1, Math.min(6, B.levels | 0));
    let u = m.pre.uniforms;
    u.tSrc.value = rt.scene.texture; u.uTexel.value.set(1 / rt.w, 1 / rt.h); u.uExp.value = exp;
    u.uThr.value = thr; u.uKnee.value = B.knee; u.uClamp.value = B.clamp; u.uKaris.value = B.karis ? 1 : 0;
    draw(renderer, m.pre, rt.mips[0]);
    for (let i = 1; i < n; i++) {
      const src = rt.mips[i - 1]; u = m.down.uniforms;
      u.tSrc.value = src.texture; u.uTexel.value.set(1 / src.width, 1 / src.height);
      draw(renderer, m.down, rt.mips[i]);
    }
    for (let i = n - 2; i >= 0; i--) {                // mip[i] += scatter × tent(mip[i+1])
      const src = rt.mips[i + 1]; u = m.up.uniforms;
      u.tSrc.value = src.texture; u.uTexel.value.set(B.radius / src.width, B.radius / src.height); u.uWeight.value = B.scatter;
      draw(renderer, m.up, rt.mips[i]);
    }
    S.norm = 0; for (let i = 0; i < n; i++) S.norm += Math.pow(B.scatter, i);   // mip0 = Σ scatter^k
    return rt.mips[0].texture;
  }

  // ---- grade：env.grade {warm, sat, lift} 叠在基础调色上；黄昏更暖，夜里更冷 + 分离色调 ------------------
  function grade(E) {
    const G = P.grade, eg = E.grade || {}, night = cl(num(E.night, 0), 0, 1), golden = cl(num(E.golden, 0), 0, 1), day = 1 - night;
    let ew = num(eg.warm, 0), es = num(eg.sat, 1);
    const el = num(eg.lift, 0), mw = num(G.maxWarm, 0.3);
    if (Math.abs(ew) > 2) ew = (6500 - ew) / 3000;    // 容忍开尔文
    if (es < 0.35) es = 1 + es;                       // 容忍偏移量
    const w = cl(G.warm + ew * num(G.envWarm, 0.35) + G.goldenWarm * golden * day - G.nightCool * night, -mw, mw);
    const r = 1 + 0.30 * w, b = 1 - 0.36 * w, gg = 1 + 0.04 * w, l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    es = 1 + (cl(es, 0, 2) - 1) * num(G.envSat, 0.5);
    let split = G.split + (num(G.splitGolden, G.split) - G.split) * golden * day;
    split += (G.splitNight - split) * night;
    return { night, golden, wb: [r / l, gg / l, b / l], sat: cl(G.sat * es * (1 + (num(G.nightSat, 1) - 1) * night), 0, 2),
      lift: cl(G.lift + (el > 0.2 ? el * 0.1 : el) * num(G.envLift, 0.4), 0, 0.06), split, con: cl(num(G.contrast, 0), 0, 1) };
  }

  // ---- 一帧 ------------------------------------------------------------------------------------------
  function run(renderer, scene, camera) {
    const t0 = performance.now();
    const rt = ensure(renderer), E = (V3.env && V3.env.state) || {}, g = grade(E), B = P.bloom, dbg = P.debug | 0;
    const exp = Math.max(1e-4, num(P.exposure, 1) * num(renderer.toneMappingExposure, 1) * num(P.tone.pre, 1 / 0.6) * (1 + num(P.tone.night, 0) * g.night));
    const bi = lerp(lerp(B.intensity, B.golden, g.golden), B.night, g.night);
    const thr = lerp(lerp(B.threshold, B.thrGolden, g.golden), B.thrNight, g.night);
    const hue = cl(num(P.tone.hue, 0) * (1 - num(P.tone.hueNight, 0.7) * g.night), 0, 1);
    const tm = renderer.toneMapping, ac = renderer.autoClear, info = renderer.info, ar = info.autoReset;
    info.autoReset = false; info.reset();             // 统计 = 场景 + 后期各遍
    try {
      renderer.toneMapping = THREE.NoToneMapping;     // 场景这一遍出线性 HDR；ACES 在合成里做
      renderer.setRenderTarget(rt.scene);
      renderer.render(scene, camera);
      stats.draws = info.render.calls; stats.tris = info.render.triangles;
      renderer.autoClear = false;
      const useB = B.on || dbg === 1, bl = useB ? bloom(renderer, rt, exp, thr) : blackTex();
      const m = mats().comp, u = m.uniforms, V = P.vignette;
      u.tSrc.value = rt.scene.texture; u.tBloom.value = bl;
      u.uExp.value = exp; u.uBloom.value = useB ? bi / Math.max(1, S.norm) : 0;
      u.uSat.value = g.sat; u.uSplit.value = g.split; u.uLift.value = g.lift; u.uCon.value = g.con; u.uHue.value = hue;
      u.uVig.value = V.on ? Math.min(0.9, V.amount * (1 + V.night * g.night)) : 0; u.uVin.value = V.inner; u.uVout.value = V.outer;
      u.uAspect.value = rt.w / rt.h; u.uDither.value = num(P.dither, 1); u.uDebug.value = dbg;
      u.uWB.value.set(g.wb[0], g.wb[1], g.wb[2]); u.uHi.value.fromArray(P.grade.hi); u.uLo.value.fromArray(P.grade.lo);
      draw(renderer, m, null);
    } finally {
      renderer.toneMapping = tm; renderer.autoClear = ac; renderer.setRenderTarget(null); info.autoReset = ar;
    }
    Object.assign(stats, { ms: performance.now() - t0, w: rt.w, h: rt.h, samples: rt.samples, exp, bloom: bi, thr, hue,
      night: g.night, golden: g.golden, passes: info.render.calls - stats.draws });
  }

  // ---- API：V3.post(renderer, scene, camera, dt) ------------------------------------------------------
  function post(renderer, scene, camera, dt) {
    const R = V3.R || {};
    renderer = renderer || R.renderer; scene = scene || R.scene; camera = camera || R.camera;
    if (NOPOST || !P.enabled || S.broken || !floatOK(renderer)) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    try { run(renderer, scene, camera, dt || 0); }
    catch (e) {                                       // 出错：记一次，之后一直走普通渲染（post.reset() 可重试）
      S.broken = true; stats.fallback = 'error';
      V3.err('post: ' + (e && e.message ? e.message : e));
      renderer.setRenderTarget(null); renderer.render(scene, camera);
    }
  }
  post.params = P;
  post.stats = stats;
  Object.defineProperty(post, 'active', { enumerable: true, get: () => !NOPOST && !!P.enabled && !S.broken && S.fok !== false });
  post.reset = () => { S.broken = false; S.fok = undefined; delete stats.fallback; };
  post.dispose = () => {
    freeTargets();
    if (S.mb) { Object.keys(S.mb).forEach((k) => S.mb[k].dispose()); S.mb = null; }
    if (S.black) { S.black.dispose(); S.black = null; }
    if (S.q) { S.q.mesh.geometry.dispose(); S.q.base.dispose(); S.q = null; }
  };
  post.info = () => 'post ' + (post.active ? 'on' : 'off') + ' ' + stats.w + 'x' + stats.h + ' msaa ' + stats.samples +
    ' exp ' + (+stats.exp || 0).toFixed(2) + ' bloom ' + (+stats.bloom || 0).toFixed(2) + ' thr ' + (+stats.thr || 0).toFixed(2) +
    ' hue ' + (+stats.hue || 0).toFixed(2) + ' night ' + (+stats.night || 0).toFixed(2) + ' golden ' + (+stats.golden || 0).toFixed(2) +
    ' draws ' + stats.draws + '+' + (stats.passes || 0) + ' ' + (+stats.ms || 0).toFixed(1) + 'ms' + (stats.fallback ? ' (' + stats.fallback + ')' : '');
  V3.post = post;
  if (typeof V3.on === 'function') V3.on('model', () => { if (!(V3.R && V3.R.post)) post.dispose(); });   // 换到不用后期的模型：释放显存
})(window.V3);
