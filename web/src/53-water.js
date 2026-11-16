// src/53-water.js — owner: beach。海面 / 浪花 / 海水切面（移植自 v1 的 60-water.js：涌浪、细节法线、吸收、天空反光、闪光、岸边泡沫、碎浪线、冲上沙滩的浪）。
// v1 用不透明画面纹理做折射；v3 不做折射，每块水分两遍画：
//   吸收遍（乘法混合 dst·T，T = exp(−K·水深·光程)）把水下的海床 / 珊瑚 / 鱼染成青绿，越深越暗；
//   着色遍（MeshStandardMaterial + onBeforeCompile，预乘 alpha 叠加）加水体散射、天空反光、太阳高光、泡沫。
// 海床水深 / 离岸距离 / 礁石泡沫从 V3.terrain 烘成一张 104×116 的数据贴图（每列一个像素），水面和切面共用。
// 导出 V3.water = { level, WASH, frontD(x,t), runup(x), waveY(x,z) }。水不投影（userData.noShadow）。
(function (V3) {
  'use strict';
  const U = V3.util, L = V3.layout, S = L.site, SEA = L.sea.y;
  const WASH = { period: 7.0, up: 0.36, base: 2.3 };               // 浪冲沙滩：周期 (s)、上冲占比、平均上冲距离 (m)
  const K = { body: 1.0, sky: 1.0, glit: 0.25, cutNight: 2.0 };      // 水体散射 / 天空反光 / 闪光 强度 / 切面夜间补亮（看图调）
  const f3 = v => (+v).toFixed(3);
  let wt = 0;                                                        // 水的时钟 (s)，模 3584 = 512 个浪周期（浮点不失精度）

  // ---- 浪前沿（JS 版，和 GLSL 的 wRunR / wSurge 一致；GLSL 另加一点噪声）
  const phx = x => 0.06 * Math.sin(x * 0.21) + 0.04 * Math.sin(x * 0.53 + 1.3);
  const runR = (x, n) => WASH.base * (0.78 + 0.22 * Math.sin(n * 2.39 + x * 0.17) + 0.12 * Math.sin(x * 0.61 - n * 1.7));
  const surge = ph => (ph < WASH.up ? Math.sin(ph / WASH.up * Math.PI / 2) : 0.5 + 0.5 * Math.cos(Math.PI * (ph - WASH.up) / (1 - WASH.up)));
  const frontD = (x, t) => { const c = t / WASH.period + phx(x), n = Math.floor(c); return surge(c - n) * runR(x, n); };
  // 涌浪高度（JS 版 wWaves.x），水深 < 0.35 m 处衰减到 0
  const SINES = [[0.149, -0.989, 0.024, 7.3, 0.0], [-0.41, -0.912, 0.016, 4.1, 1.7], [0.8, -0.6, 0.010, 2.6, 3.4], [-0.301, -0.954, 0.008, 1.7, 5.1]];
  const waves = (x, z, t) => {
    let h = 0;
    for (const [dx, dz, a, l, o] of SINES) { const k = 2 * Math.PI / l; h += a * Math.sin(k * (dx * x + dz * z) - 0.8 * Math.sqrt(9.81 * k) * t + o); }
    return h;
  };

  // ---- 所有水着色器共用的 GLSL（前缀 w*）。uSea：r = 水深/6，g = (离岸距离+4)/16，b = 礁石泡沫
  const GL = `
uniform float uWT; uniform sampler2D uSea; uniform vec4 uBox;
uniform vec3 uSky; uniform vec3 uHz; uniform vec3 uLCol; uniform vec3 uLDir; uniform float uGold; uniform float uNight;
float wHash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 wHash2(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
vec3 wNoiseD(vec2 p){
  vec2 i = floor(p), f = p - i, u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = wHash(i), b = wHash(i + vec2(1.0, 0.0)), c = wHash(i + vec2(0.0, 1.0)), d = wHash(i + 1.0);
  float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
void wSine(inout vec3 r, vec2 xz, float t, vec2 d, float a, float l, float o){
  float k = 6.2831853 / l, ph = k * dot(d, xz) - 0.8 * sqrt(9.81 * k) * t + o;
  r.x += a * sin(ph); r.yz += a * k * cos(ph) * d;
}
vec3 wWaves(vec2 xz, float t){
  vec3 r = vec3(0.0);
  wSine(r, xz, t, vec2(0.149, -0.989), 0.024, 7.3, 0.0);
  wSine(r, xz, t, vec2(-0.41, -0.912), 0.016, 4.1, 1.7);
  wSine(r, xz, t, vec2(0.8, -0.6), 0.010, 2.6, 3.4);
  wSine(r, xz, t, vec2(-0.301, -0.954), 0.008, 1.7, 5.1);
  return r;
}
vec2 wDetail(vec2 xz, float t, float px){
  const mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
  vec2 g = vec2(0.0), q = xz; mat2 M = mat2(1.0); float s = 1.6, a = 0.075;
  for (int i = 0; i < 4; i++) {
    vec3 n = wNoiseD(q * s + vec2(0.31, -0.57) * t * (1.0 + 0.45 * float(i)));
    g += a * s * (n.yz * M) * clamp(1.5 - px * s * 2.0, 0.0, 1.0);
    q = R * q; M = M * R; s *= 2.1; a *= 0.45;
  }
  return g;
}
float wPhx(float x){ return 0.06 * sin(x * 0.21) + 0.04 * sin(x * 0.53 + 1.3); }
vec4 wSeaT(vec2 xz){ return texture2D(uSea, (xz - uBox.xy) / uBox.zw); }
float wDepth(vec2 xz){ return wSeaT(xz).r * 6.0; }
float wDisp(vec2 xz){ return wWaves(xz, uWT).x * smoothstep(0.05, 0.35, wDepth(xz)); }
vec3 wSkyCol(vec3 R){
  float h = clamp(R.y, 0.0, 1.0);
  vec3 c = mix(uHz, uSky, pow(h, 0.55));
  c += uLCol * pow(max(dot(normalize(R), normalize(uLDir)), 0.0), 24.0) * 0.12 * (0.4 + uGold);   // 太阳方向的暖晕
  return c;
}
`;
  const GL2 = `
const float SEA_Y = ${f3(SEA)}; const float W_P = ${f3(WASH.period)}; const float W_U = ${f3(WASH.up)}; const float W_B = ${f3(WASH.base)};
const float S_X0 = ${f3(S.x0)}; const float S_X1 = ${f3(S.x1)}; const float S_Z1 = ${f3(S.z1)};
const float BODY_K = ${f3(K.body)}; const float SKY_K = ${f3(K.sky)}; const float GLIT_K = ${f3(K.glit)}; const float CUT_NG = ${f3(K.cutNight)};
void wOver(inout vec4 o, vec3 c, float a){ o.rgb = c * a + o.rgb * (1.0 - a); o.a = a + o.a * (1.0 - a); }   // 预乘 alpha 的“盖上一层”
// 顶点位移：切面的半米点取左右两个整米点的平均（和 1 m 水面网格的边一致，不裂缝）
float wDispV(vec2 xz, float top, float mid, vec3 n){
  if (top < 0.5) return 0.0;
  if (mid > 0.5) { vec2 t = vec2(abs(n.z), abs(n.x)) * 0.5; return 0.5 * (wDisp(xz - t) + wDisp(xz + t)); }
  return wDisp(xz);
}
float wPath(float dep, float vy){ return dep * (1.0 + 1.0 / max(vy, 0.25)); }        // 看进去 + 光照下来的水程
vec3 wAbsK(){ return vec3(0.62, 0.16, 0.06) + vec3(0.3, 0.03, 0.0) * uGold; }
float wCutPath(float dU, float dep, float vy){ return clamp((dep - dU) / max(vy, 0.08), 0.0, 14.0); }
vec3 wCutT(float cp, float dep){ return exp(-vec3(0.20, 0.050, 0.030) * cp - vec3(0.10, 0.030, 0.015) * dep); }   // 切面看进去的透过率
float wRunR(float x, float n){ return W_B * (0.78 + 0.22 * sin(n * 2.39 + x * 0.17) + 0.12 * sin(x * 0.61 - n * 1.7)); }
float wSurge(float p){ return p < W_U ? sin(p / W_U * 1.5707963) : 0.5 + 0.5 * cos(3.1415926 * (p - W_U) / (1.0 - W_U)); }
float wUncov(float d, float R){ float s = clamp(d / max(R, 1e-3), 0.0, 1.0); return W_U + (1.0 - W_U) * acos(2.0 * s - 1.0) / 3.1415926; }
`;
  const FOG_DECL = `
#ifdef USE_FOG
uniform vec3 fogColor;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear; uniform float fogFar;
#endif
#endif
float wFogF(float d){
#ifdef USE_FOG
#ifdef FOG_EXP2
  return 1.0 - exp(-fogDensity * fogDensity * d * d);
#else
  return smoothstep(fogNear, fogFar, d);
#endif
#else
  return 0.0;
#endif
}
`;
  // 预乘 alpha 的雾：雾色也要乘 alpha（否则半透明水在远处会变成一层不透明的雾）
  const FOG_PREMUL = `
#ifdef USE_FOG
#ifdef FOG_EXP2
  float wFf = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
#else
  float wFf = smoothstep(fogNear, fogFar, vFogDepth);
#endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * gl_FragColor.a, wFf);
#endif
`;
  // ---- 吸收遍：dst × T（乘法混合），不写深度
  const ABS_VS = `
attribute float aTop; attribute float aMid;
varying vec3 vWp; varying vec3 vWn;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  w.y += wDispV(w.xz, aTop, aMid, normal);
  vWp = w.xyz; vWn = normal;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
  const ABS_FS = cut => `
varying vec3 vWp; varying vec3 vWn;
void main(){
  vec3 V = cameraPosition - vWp; float dist = length(V); V /= dist;
${cut ? `  float dU = max(SEA_Y - vWp.y, 0.0), dep = max(wDepth(vWp.xz - vWn.xz * 0.25), dU);
  vec3 T = wCutT(wCutPath(dU, dep, V.y), dep);`
    : `  vec3 T = exp(-wAbsK() * wPath(wDepth(vWp.xz), V.y));`}
  T = mix(T, vec3(1.0), wFogF(dist));
  gl_FragColor = linearToOutputTexel(vec4(T, 1.0));
}`;
  const absorbMat = (THREE, UNI, cut) => new THREE.ShaderMaterial({
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), UNI),
    vertexShader: GL + GL2 + ABS_VS, fragmentShader: GL + GL2 + FOG_DECL + ABS_FS(cut),
    fog: true, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  // ---- 着色遍：MeshStandardMaterial（吃天空部件的太阳/月亮/半球光、阴影、雾、色调映射），onBeforeCompile 换法线和输出
  const NRM = {
    sea: `  float wPx = max(length(dFdx(vWp.xz)), length(dFdy(vWp.xz)));
  float wDk = smoothstep(0.05, 0.35, wDepth(vWp.xz));
  vec2 wG = wWaves(vWp.xz, uWT).yz * wDk + wDetail(vWp.xz, uWT, wPx) * (0.35 + 0.65 * wDk);
  vec3 wN = normalize(vec3(-wG.x, 1.0, -wG.y));
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);`,
    cut: `  vec3 wN = normalize(vWn);
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);`,
    wash: `  if (vM < 0.01) discard;
  float wX = vWp.x, wD = vD, wC = uWT / W_P + wPhx(wX), wNn = floor(wC), wPh = wC - wNn;
  float wRn = wRunR(wX, wNn), wRp = wRunR(wX, wNn - 1.0);
  if (wD > max(wRn, wRp) + 0.5) discard;
  float wF = wSurge(wPh) * wRn + (wNoiseD(vec2(wX * 1.9, wNn * 3.1)).x - 0.5) * 0.22 + (wNoiseD(vWp.xz * 4.0).x - 0.5) * 0.06;
  float wTs = 1e3;
  if (wD < wF) wTs = 0.0;
  else if (wPh > W_U && wD < wRn) wTs = (wPh - wUncov(wD, wRn)) * W_P;
  else if (wD < wRp) wTs = (wPh + 1.0 - wUncov(wD, wRp)) * W_P;
  float wWet = exp(-max(wTs, 0.0) / 3.2);
  float wFilm = 1.0 - smoothstep(wF - 0.1, wF + 0.02, wD), wAge = wPh < W_U ? 0.0 : (wPh - W_U) / (1.0 - W_U);
  vec2 wG = wNoiseD(vWp.xz * 3.0 + vec2(0.0, (wAge > 0.0 ? 0.6 : -0.9) * uWT)).yz * 0.05 * wFilm;
  vec3 wN = normalize(vec3(-wG.x, 1.0, -wG.y));
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);`,
  };
  const OUT = {
    sea: `  vec3 V = normalize(cameraPosition - vWp);
  float NV = clamp(dot(wN, V), 0.0, 1.0), F = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
  float dep = wDepth(vWp.xz), pth = wPath(dep, V.y);
  float Sc = 1.0 - exp(-0.22 * pth);                                   // 水体散射量（标量）：浅水清，深水蓝
  vec3 ill = mix(totalDiffuse, vec3(dot(totalDiffuse, vec3(0.25, 0.5, 0.25))) * vec3(0.8, 1.0, 1.1), 0.5 * uGold) * (1.0 + 0.8 * uGold);
  vec3 body = mix(vec3(0.03, 0.30, 0.40), mix(vec3(0.006, 0.07, 0.28), vec3(0.008, 0.10, 0.36), uGold), smoothstep(0.8, 3.5, dep));
  vec3 R = reflect(-V, wN); R.y = abs(R.y);
  vec4 o = vec4(body * ill * Sc * (1.0 - F) * BODY_K + wSkyCol(R) * F * SKY_K, F);
  o.rgb += totalSpecular;
  vec2 fq = vWp.xz * 6.0 + vec2(0.13, 0.31) * uWT, fc = floor(fq), fh = wHash2(fc), fo = fq - fc - 0.5;
  float rr = clamp(wPx * 5.4, 0.08, 0.45), tw = pow(0.5 + 0.5 * sin(uWT * (1.3 + 2.7 * fh.y) + fh.x * 40.0), 6.0);
  vec3 Lw = normalize(uLDir), H = normalize(Lw + V);
  float sv = smoothstep(-0.03, 0.05, Lw.y), nh = max(dot(wN, H), 0.0);
  float lobe = (0.02 + 0.98 * pow(smoothstep(0.0, 0.9, dot(reflect(-V, vec3(0.0, 1.0, 0.0)), Lw)), 3.0)) * (0.35 + 0.65 * pow(nh, 4.0));
  float glit = step(0.93, fh.x) * tw * (1.0 - smoothstep(rr * 0.2, rr, length(fo))) * lobe * sv * (1.0 - smoothstep(0.06, 0.16, wPx));
  o.rgb += glit * uLCol * mix(vec3(5.0), vec3(5.5, 4.2, 2.4), uGold) * (0.35 + 3.4 * uGold) * GLIT_K * smoothstep(0.1, 0.4, dep);
  vec4 st = wSeaT(vWp.xz); float d = st.g * 16.0 - 4.0;
  float n1 = wNoiseD(vWp.xz * 2.7 + vec2(0.05, 0.22) * uWT).x, n2 = wNoiseD(vWp.xz * 6.9 - vec2(0.17, 0.08) * uWT).x;
  float wph = fract(uWT / W_P + wPhx(vWp.x));
  float cov = max((1.0 - smoothstep(0.1, 1.3, d)) * (0.75 + 0.25 * sin(6.2831 * (wph + 0.15))), st.b * (0.7 + 0.3 * sin(6.2831 * wph + vWp.x)));
  float foam = smoothstep(1.0 - cov, 1.12 - cov, n1 * 0.6 + n2 * 0.4) * min(cov * 2.0, 1.0);
  float bq = (d - mix(4.0, 0.4, wph)) * 2.2;
  float brk = exp(-bq * bq) * smoothstep(0.0, 0.25, wph) * (1.0 - smoothstep(0.7, 1.0, wph));
  brk *= smoothstep(0.08, 0.6, d) * (1.0 - smoothstep(2.0, 4.5, dep));
  foam = clamp(max(foam, smoothstep(0.62 - brk * 0.5, 0.9 - brk * 0.5, n1 * 0.55 + n2 * 0.45) * brk), 0.0, 1.0);
  wOver(o, (totalDiffuse * 0.85 + uSky * 0.05) * (1.0 - 0.25 * uNight), foam * 0.92 * (1.0 - 0.45 * uNight));   // 夜里泡沫收一点，不然像雪
  gl_FragColor = o;`,
    cut: `  vec3 V = normalize(cameraPosition - vWp);
  float dU = max(SEA_Y + wWaves(vWp.xz, uWT).x - vWp.y, 0.0), dep = max(wDepth(vWp.xz - wN.xz * 0.25), dU);
  float cp = wCutPath(dU, dep, V.y), Sc = 1.0 - exp(-0.07 * cp - 0.10 * dU);   // 切面里的水体散射量
  vec3 ill = uSky * 0.95 + uHz * 0.18 + uLCol * max(uLDir.y, 0.0) * 0.5;
  vec3 body = mix(vec3(0.03, 0.30, 0.40), vec3(0.008, 0.09, 0.30), smoothstep(0.5, 4.0, dU))
    * mix(ill, vec3(dot(ill, vec3(0.25, 0.5, 0.25))) * vec3(0.75, 1.0, 1.1), 0.6 * uGold) * (1.0 + 0.8 * uGold);
  // 夜里不加青色底光：颜色只跟环境光（ill = 天空 + 主光）走；CUT_NG 只补一点夜里的亮度，让屏幕上约为白天的 35–40%
  body = body * (0.45 + 0.55 * exp(-dU * 0.12)) * (1.0 + CUT_NG * uNight);
  float sh = wNoiseD(vec2((vWp.x + vWp.z) * 1.7 + uWT * 0.15, uWT * 0.05)).x;
  vec3 glow = uLCol * max(uLDir.y, 0.0) * smoothstep(0.55, 1.0, sh) * exp(-dU * 0.25) * 0.05
    + (uLCol * max(uLDir.y, 0.1) * 0.25 + uSky * 0.35) * (exp(-dU * 14.0) * 0.8 + exp(-dU * 4.0) * 0.12);
  float ce = wN.z > 0.5 ? min(vWp.x - S_X0, S_X1 - vWp.x) : S_Z1 - vWp.z;
  glow += (uSky * 0.4 + uLCol * 0.05) * exp(-max(ce, 0.0) * 25.0);
  float NV = clamp(dot(wN, V), 0.0, 1.0), F = (0.02 + 0.98 * pow(1.0 - NV, 5.0)) * 0.6;
  gl_FragColor = vec4((body * Sc + glow) * (1.0 - F) + wSkyCol(reflect(-V, wN)) * F + totalSpecular, F);`,
    wash: `  vec3 V = normalize(cameraPosition - vWp);
  float NV = clamp(dot(wN, V), 0.0, 1.0), F = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
  vec4 o = vec4(0.0);
  wOver(o, vec3(0.0), 0.12 * wWet * (1.0 - wFilm));
  // 水膜：近似“透过薄水看到的湿沙”（沙子反照率 × 浅青透过率），而不是往沙上叠青色——青 + 黄褐会混成灰
  wOver(o, totalDiffuse * vec3(0.26, 0.25, 0.12) + uSky * 0.01, wFilm * clamp(0.25 + (wF - wD) * 0.15, 0.0, 0.5));
  vec3 R = reflect(-V, wN); R.y = abs(R.y);
  wOver(o, wSkyCol(R) * SKY_K, F * (0.15 * wWet + 0.6 * wFilm));
  o.rgb += totalSpecular * wFilm;
  float nf = wNoiseD(vWp.xz * vec2(3.1, 5.3) + vec2(0.0, uWT * 0.4)).x * 0.6 + wNoiseD(vWp.xz * 9.0 - uWT * 0.3).x * 0.4;
  float fw = mix(0.45, 0.16, wAge);
  float foam = (1.0 - smoothstep(wF - 0.02, wF + 0.05, wD)) * smoothstep(wF - fw - 0.15, wF - fw * 0.3, wD) * smoothstep(0.25 + wAge * 0.3, 0.5 + wAge * 0.28, nf) * (1.0 - 0.45 * wAge);
  foam = max(foam, exp(-abs(wD - wRn) * 18.0) * step(wF, wD) * step(W_U, wPh) * (1.0 - 0.7 * wAge) * smoothstep(0.4, 0.65, nf) * 0.75);
  wOver(o, (totalDiffuse * 0.85 + uSky * 0.05) * (1.0 - 0.25 * uNight), clamp(foam, 0.0, 1.0) * 0.95 * (1.0 - 0.45 * uNight));
  if (o.a < 0.004) discard;
  gl_FragColor = o * vM;`,
  };
  const VARS = {
    sea: 'attribute float aTop; attribute float aMid; varying vec3 vWp; varying vec3 vWn;',
    cut: 'attribute float aTop; attribute float aMid; varying vec3 vWp; varying vec3 vWn;',
    wash: 'attribute float aD; attribute float aM; varying vec3 vWp; varying vec3 vWn; varying float vD; varying float vM;',
  };
  const VPOS = {
    sea: '  { vec4 w = modelMatrix * vec4(transformed, 1.0); transformed.y += wDispV(w.xz, aTop, aMid, objectNormal); vWp = w.xyz; vWp.y += transformed.y - position.y; vWn = normal; }',
    cut: '  { vec4 w = modelMatrix * vec4(transformed, 1.0); transformed.y += wDispV(w.xz, aTop, aMid, objectNormal); vWp = w.xyz; vWp.y += transformed.y - position.y; vWn = normal; }',
    wash: '  { vWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = normal; vD = aD; vM = aM; }',
  };
  const litMat = (THREE, UNI, kind, rough) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, UNI);
      sh.vertexShader = sh.vertexShader
        .replace('#include <clipping_planes_pars_vertex>', '#include <clipping_planes_pars_vertex>\n' + GL + GL2 + VARS[kind])
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VPOS[kind]);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <clipping_planes_pars_fragment>', '#include <clipping_planes_pars_fragment>\n' + GL + GL2 + VARS[kind].replace(/attribute float \w+; /g, ''))
        .replace('#include <normal_fragment_maps>', NRM[kind])
        .replace('#include <output_fragment>', OUT[kind])
        .replace('#include <fog_fragment>', FOG_PREMUL);
    };
    m.customProgramCacheKey = () => 'beach-water-' + kind;
    return m;
  };
  // ---- 数据贴图（每个地形列一个像素）：r 水深/6，g (离岸距离+4)/16，b 礁石泡沫，a 有水
  const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
  const seaTex = (THREE) => {
    const T = V3.terrain, NX = T.NX, NZ = T.NZ, C = T.CELL, N = NX * NZ;
    const top = new Float32Array(N), rock = new Uint8Array(N);
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
      const x = S.x0 + (i + 0.5) * C, z = S.z0 + (k + 0.5) * C, n = i + NX * k;
      top[n] = T.groundY(x, z);
      rock[n] = top[n] > T.seabedY(x, z) + 0.05 && top[n] > SEA - 0.35 ? 1 : 0;   // 露出 / 贴近水面的礁石
    }
    const data = new Uint8Array(N * 4), R = 3;
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
      const x = S.x0 + (i + 0.5) * C, z = S.z0 + (k + 0.5) * C, n = i + NX * k, o = n * 4, dep = SEA - top[n];
      let fb = 0;
      if (dep > 0) for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) {
        const ii = i + a, kk = k + b;
        if (ii < 0 || kk < 0 || ii >= NX || kk >= NZ || !rock[ii + NX * kk]) continue;
        fb = Math.max(fb, 1 - Math.hypot(a, b) * C / 1.6);
      }
      data[o] = Math.round(cl(dep / 6, 0, 1) * 255);
      data[o + 1] = Math.round(cl((z - T.shoreZ(x) + 4) / 16, 0, 1) * 255);
      data[o + 2] = Math.round(cl(fb, 0, 1) * 255);
      data[o + 3] = dep > 0 ? 255 : 0;
    }
    const tex = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    return { tex, top, rock };
  };
  const mkGeo = (THREE, pos, nrm, attrs, idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    for (const k in attrs) g.setAttribute(k, new THREE.Float32BufferAttribute(attrs[k], 1));
    g.setIndex(idx); g.computeBoundingSphere();
    return g;
  };
  // 海面：1 m 网格，只留附近有水的格子（陆地下面的被地形挡住，不画）
  const seaGeo = (THREE, D) => {
    const T = V3.terrain, NX = T.NX, NZ = T.NZ, C = T.CELL;
    let zMin = 1e9; for (let x = S.x0; x <= S.x1; x += 0.5) zMin = Math.min(zMin, T.shoreZ(x));
    const z0 = Math.max(S.z0, Math.floor(zMin - 1)), nx = Math.round(S.x1 - S.x0), nz = Math.round(S.z1 - z0);
    const wet = (x, z) => {
      const i = Math.floor((x - S.x0) / C), k = Math.floor((z - S.z0) / C);
      return i >= 0 && k >= 0 && i < NX && k < NZ && D.top[i + NX * k] < SEA + 0.02;
    };
    const pos = [], nrm = [], aTop = [], aMid = [], idx = [];
    for (let r = 0; r <= nz; r++) for (let c = 0; c <= nx; c++) { pos.push(S.x0 + c, SEA, z0 + r); nrm.push(0, 1, 0); aTop.push(1); aMid.push(0); }
    for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
      let any = false;
      for (let b = -0.25; b <= 1.25 && !any; b += 0.5) for (let a = -0.25; a <= 1.25 && !any; a += 0.5) any = wet(S.x0 + c + a, z0 + r + b);
      if (!any) continue;
      const v = r * (nx + 1) + c;
      idx.push(v, v + nx + 1, v + 1, v + 1, v + nx + 1, v + nx + 2);
    }
    return mkGeo(THREE, pos, nrm, { aTop, aMid }, idx);
  };
  // 浪花：岸线附近的 0.25 m 轴对齐网格（往陆 2.9 m、往海 0.5 m），每格正好落在一个地形格里，顶点高 = 相邻地形格最高 + 1 cm（不会被台阶戳穿）；
  // aD = 岸线 − z（往陆为正），aM 遮罩（礁石上 / 深水里不画）
  const washGeo = (THREE, D) => {
    const T = V3.terrain, NX = T.NX, NZ = T.NZ, C = T.CELL, h = 0.25, DL = 2.9, DS = 0.5;
    const col = (x, z) => cl(Math.floor((x - S.x0) / C), 0, NX - 1) + NX * cl(Math.floor((z - S.z0) / C), 0, NZ - 1);
    const nc = Math.round((S.x1 - S.x0) / h), Q4 = [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]];
    let zA = 1e9, zB = -1e9;
    for (let c = 0; c <= nc; c++) { const s = T.shoreZ(S.x0 + c * h); zA = Math.min(zA, s - DL); zB = Math.max(zB, s + DS); }
    zA = Math.floor(zA / h) * h; zB = Math.ceil(zB / h) * h;
    const nr = Math.round((zB - zA) / h), pos = [], nrm = [], aD = [], aM = [], idx = [], ys = [], inb = [];
    for (let c = 0; c <= nc; c++) {
      const x = S.x0 + c * h, sz = T.shoreZ(x);
      for (let r = 0; r <= nr; r++) {
        const z = zA + r * h, d = sz - z;
        let g = -1e9, rk = 0;
        for (const [a, b] of Q4) { const n = col(x + a, z + b); g = Math.max(g, D.top[n]); rk |= D.rock[n]; }
        const y = Math.max(g, SEA - 0.3) + 0.01;
        const m = (rk ? 0 : 1) * cl((g - (SEA - 0.14)) / 0.08, 0, 1) * (g > SEA + 0.6 ? 0 : 1);
        pos.push(x, y, z); nrm.push(0, 1, 0); aD.push(d); aM.push(m); ys.push(y); inb.push(d <= DL && d >= -DS ? 1 : 0);
      }
    }
    for (let c = 0; c < nc; c++) for (let r = 0; r < nr; r++) {
      const v = c * (nr + 1) + r, w = v + nr + 1, q = [v, v + 1, w, w + 1];
      if (q.every(n => !inb[n]) || q.every(n => aM[n] === 0)) continue;
      const yy = q.map(n => ys[n]);
      if (Math.max(...yy) - Math.min(...yy) > 0.3) continue;
      idx.push(v, v + 1, w, w, v + 1, w + 1);
    }
    return mkGeo(THREE, pos, nrm, { aD, aM }, idx);
  };
  // 海水切面：岛的南 / 东 / 西边界上，每个有水的 0.5 m 列一块竖面（海床顶 → 海面）；顶点 aTop=1 跟着浪动，半米点 aMid=1
  const cutGeo = (THREE, D) => {
    const T = V3.terrain, NX = T.NX, NZ = T.NZ, C = T.CELL;
    const pos = [], nrm = [], aTop = [], aMid = [], idx = [];
    const half = s => (Math.abs(s - Math.round(s)) > 0.25 ? 1 : 0);
    // (b − a) × (+y) = 法线方向，三角形朝外
    const quad = (ax, az, bx, bz, y0, nx, nz, ma, mb) => {
      const v = pos.length / 3;
      pos.push(ax, y0, az, bx, y0, bz, ax, SEA, az, bx, SEA, bz);
      for (let q = 0; q < 4; q++) nrm.push(nx, 0, nz);
      aTop.push(0, 0, 1, 1); aMid.push(0, 0, ma, mb);
      idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    };
    for (let i = 0; i < NX; i++) {                                       // 南面 z = S.z1，法线 +z
      const t = D.top[i + NX * (NZ - 1)]; if (t >= SEA - 0.02) continue;
      const xa = S.x0 + i * C; quad(xa, S.z1, xa + C, S.z1, t, 0, 1, half(xa), half(xa + C));
    }
    for (let k = 0; k < NZ; k++) {
      const za = S.z0 + k * C, tE = D.top[NX - 1 + NX * k], tW = D.top[NX * k];
      if (tE < SEA - 0.02) quad(S.x1, za + C, S.x1, za, tE, 1, 0, half(za + C), half(za));    // 东面，法线 +x
      if (tW < SEA - 0.02) quad(S.x0, za, S.x0, za + C, tW, -1, 0, half(za), half(za + C));   // 西面，法线 −x
    }
    return mkGeo(THREE, pos, nrm, { aTop, aMid }, idx);
  };
  // ---- 天空状态 → 水的 uniform（没有天空部件时用默认值）
  const setV = (u, c) => { if (c) u.value.set(c.r !== undefined ? c.r : c.x, c.g !== undefined ? c.g : c.y, c.b !== undefined ? c.b : c.z); };
  const sync = (UNI) => {
    const E = V3.env && V3.env.state;
    if (!E) return;
    const s = E.sky || {};
    setV(UNI.uSky, s.zenith); setV(UNI.uHz, s.horizon);
    setV(UNI.uLCol, E.key === 'moon' ? s.moon : s.sun);
    setV(UNI.uLDir, E.lightDir || E.sunLightDir);
    UNI.uGold.value = +E.golden || 0; UNI.uNight.value = +E.night || 0;
  };

  let D = null, UNI = null;
  V3.scene.part({
    id: 'water', label: '海水', order: 30,
    build(ctx) {
      const THREE = ctx.THREE, T = V3.terrain;
      V3.parts.declare(['海', '海/海面', '海/浪花', '海/切面'], { '海': '海', '海/海面': '海面', '海/浪花': '浪花', '海/切面': '海水切面' });
      D = seaTex(THREE);
      UNI = {
        uWT: { value: wt }, uSea: { value: D.tex }, uBox: { value: new THREE.Vector4(S.x0, S.z0, T.NX * T.CELL, T.NZ * T.CELL) },
        uSky: { value: new THREE.Vector3(0.30, 0.50, 0.85) }, uHz: { value: new THREE.Vector3(0.70, 0.80, 0.90) },
        uLCol: { value: new THREE.Vector3(1.0, 0.92, 0.80) }, uLDir: { value: new THREE.Vector3(0.45, 0.55, 0.35).normalize() },
        uGold: { value: 0 }, uNight: { value: 0 },
      };
      sync(UNI);
      const mk = (geo, mat, path, anchor, ro, extra) => {
        const m = new THREE.Mesh(geo, mat);
        m.renderOrder = ro;
        Object.assign(m.userData, { anchor, layer: 'site', noShadow: true }, extra || {});
        V3.parts.tag(m, path);
        return m;
      };
      const sg = seaGeo(THREE, D), cg = cutGeo(THREE, D), wg = washGeo(THREE, D);
      const wm = litMat(THREE, UNI, 'wash', 0.12);
      wm.polygonOffset = true; wm.polygonOffsetFactor = -2; wm.polygonOffsetUnits = -4;
      const ab = { noPick: true, noReceive: true };
      return [
        mk(wg, wm, '海/浪花', 'house2:sea-wash', 1),
        mk(sg, absorbMat(THREE, UNI, false), '海/海面', 'house2:sea-surface-absorb', 2, ab),
        mk(sg, litMat(THREE, UNI, 'sea', 0.06), '海/海面', 'house2:sea-surface', 3),
        mk(cg, absorbMat(THREE, UNI, true), '海/切面', 'house2:sea-cut-absorb', 4, ab),
        mk(cg, litMat(THREE, UNI, 'cut', 0.1), '海/切面', 'house2:sea-cut', 5),
      ];
    },
    update(dt, t) {
      wt = (((+t || 0) % 3584) + 3584) % 3584;
      if (UNI) { UNI.uWT.value = wt; sync(UNI); }
    },
    dispose() {
      for (const p of ['海/海面', '海/浪花', '海/切面']) V3.parts.reset(p);   // 不清 '海' 根：海洋生物也挂在下面
      if (D) D.tex.dispose();
      D = null; UNI = null;
    },
  });

  // ---- 导出：小鲸鱼走路 / 脚印 / 海洋生物用
  const now = t => (t === undefined ? wt : t);
  V3.water = {
    level: SEA, WASH,
    time: () => wt,
    frontD: (x, t) => frontD(x, now(t)),                                     // 浪前沿离岸线往陆的距离 (m)
    runup: (x, t) => V3.terrain.shoreZ(x) - frontD(x, now(t)),               // 浪前沿此刻的 z
    waveY: (x, z, t) => SEA + waves(x, z, now(t)) * U.smooth(0.05, 0.35, V3.terrain.depthAt(x, z)),
  };
})(window.V3);
