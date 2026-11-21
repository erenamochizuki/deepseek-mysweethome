// 51-sky.js — 天空部件（house2 场景里 id 为 'sky' 的部件）。移植自 v1 的 61-sky.js：天空球（渐变、太阳光晕、星星、银河）、
// MC 方块云；天气只取颜色 / 云量 / 雾（雨丝雪花闪电在 54-wx，闪电通过 'wx:flash' 让这里一亮）。新增：可点选的圆形发光太阳、
// 有月相的像素月亮（Mesh：天空/太阳、天空/月亮），地平线下的淡紫云海（岛像浮在云上），画出来的天空按镜头高度往下挪
// （state.sunShow / moonShow；光照阴影仍用真实方向），太阳/月亮平行光（4096 阴影，阴影相机贴合场地盒子）、半球光、雾。
// 颜色全部来自 V3.env.state（linear HDR）。本部件不调用 V3.env.update（场景每帧先调它），只读 state、写 toneMappingExposure。
(function (V3) {
  'use strict';
  const U = V3.util;
  const P = {                          // V3.sky.params：控制台里改了下一帧就生效
    sunK: 0.5, moonK: 1.35, moonSoft: 2.5, ambK: 1, groundK: 0.6, nightK: 0.55, exposure: 1, fogDensity: 0.004,   // nightK：夜里半球光再乘它；moonSoft：月光强度软上限 I/(1+I·moonSoft)，满月不至于像白天
    moonBlue: 1, moonTint: [0.26, 0.45, 1.0],   // 夜里月光和半球光往这个冷蓝偏（保持亮度），moonBlue 是 night=1 时的强度（0 关）
    sunR: 0.0175, moonR: 0.036,        // 角半径（弧度）：太阳约 1°，月亮约 2°（MC 风格的大月亮）
    sunMie: 1, sunHalo: 0.3, sunCorona: 0.5, sunDisc: 22,   // 太阳：近日米氏光晕 / 中圈 / 日冕 / 圆盘亮度（黄昏时圆盘再 ×0.7）。光晕太强会和圆盘糊成一团
    cloud: 0.35, wind: [-0.8, 0.5],    // 方块云覆盖率；云图偏移速度（m/s）
    sea: 1, seaY: -14,                 // 地平线下云海：强度（0 关）、云海平面高度
    voidMix: 0.45, voidSat: 0.7, voidK: 0.75, voidTint: [0.9, 0.95, 1.12],   // 地平线下背景 = 地平线色和天顶色混合
    shadowBox: [-20, -1, -22, 20, 9, 18], target: [0, 1, -6],
    cutShadow: true,                   // 剖切时被藏起来的屋顶/阁楼/墙照样投影（只在阴影图里出现）→ 室内有屋顶的影子、窗户在地上留下亮斑
    sunMinY: 0.22,                     // 阳光方向最低抬到这个高度（≈12.7°）：黄昏的光能从窗户照到地板上，影子也不会拖得太长
    goldenSun: 1.7, goldenAmb: 0.8,    // 黄金时刻（golden=1）阳光 ×1.7、半球光 ×0.8：窗户在地板上的光斑和影子更清楚
    lowSky: true,                      // 画出来的天空 / 日月 / 云按镜头高度往下挪（env.showParams；?realsky=1 关）
    fogWhite: 0.55,                    // 雾天：背景和雾色往亮灰白靠
    flashAmb: 1.2, flashSky: 1, flashExp: 0.35, flashTau: 0.1,    // 闪电（wx:flash k）：半球光 +k×1.2 冷白、天空/云一闪、曝光 +35%；停 30 ms 后 τ=0.1 s 衰减（0.15 s 时剩 ~30%）
  };
  const R0 = 250;                      // 日月面片离相机的距离（米）

  // ---- shared GLSL: hash / noise / fbm（v1 01-render.js 的 kHash12 等），uniform，skyBase(d)（d.y >= 0），月亮 UV ----
  const GLSL = `
uniform vec3 uSky; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uVoid; uniform float uTime;
uniform vec3 uSunV; uniform vec3 uMoonV; uniform float uGolden; uniform float uStars; uniform float uMoonPh; uniform float uMoonIl;
uniform float uCloud; uniform vec3 uLitCol; uniform vec3 uLitDir; uniform vec2 uCloudOff;
uniform float uSunR; uniform float uMoonR; uniform float uSea; uniform float uSeaY; uniform vec4 uSunG;
uniform vec4 uShow;   // x = 画出来的地平线压低多少（弧度），y = 真实太阳 y，z = 真实月亮 y（uSunV / uMoonV 是画出来的位置）
uniform vec4 uWx;     // 天气：x 阴天 0..1，y 雷雨，z 雾，w 闪电闪光
varying vec3 vW;
float kHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float kHash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float kNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(kHash12(i), kHash12(i + vec2(1., 0.)), f.x), mix(kHash12(i + vec2(0., 1.)), kHash12(i + vec2(1., 1.)), f.x), f.y); }
float kFbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * kNoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
float sLum(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
vec3 sWarm() { return mix(vec3(1., .84, .64), vec3(1., .46, .2), uGolden); }
float sDay() { return smoothstep(-.12, .2, uShow.y); }
// 画出来的天空整体往下挪 uShow.x：真实仰角 e（弧度）→ 画法仰角（地平线 −dip 处 = 0，天顶 / 天底不动，方位不变）
float skyE(float e) {
  float dp = uShow.x;
  return e >= -dp ? (e + dp) / (1.5707963 + dp) * 1.5707963 : (e + dp) / (1.5707963 - dp) * 1.5707963;
}
vec3 skyDir(vec3 d) {
  float e = skyE(asin(clamp(d.y, -1., 1.)));
  vec2 h = d.xz / max(length(d.xz), 1e-5);
  return vec3(h * cos(e), sin(e)).xzy;
}
vec3 skyCol(vec3 d, float y) {        // d = 真实视线（和画出来的日月比夹角），y = 画法仰角的 sin
  float e = max(y, 0.), mu = dot(d, uSunV), m = max(mu, 0.);
  vec3 c = mix(uSky, uHorizon, pow(1. - e, 3.2));
  float L = sLum(uHorizon) + .02;
  float up = smoothstep(-.14, .04, uShow.y), clr = 1. - .8 * smoothstep(.45, 1., uCloud);
  float mie = (.22 * pow(m, 6.) + uSunG.y * pow(m, 40.) + uSunG.x * pow(m, 4000.)) * (.3 + .9 * uGolden);   // v1: .7·m^40 + 3·m^1400（太宽，把圆盘糊掉）
  float belt = uGolden * exp(-e * 7.) * (.3 + .7 * smoothstep(-.3, 1., mu));       // warm horizon band, toward the sun
  c += L * sWarm() * (mie + belt * .75) * up * clr;
  c = mix(c, c * vec3(1.12, .9, 1.04), uGolden * exp(-e * 3.) * max(-mu, 0.));     // pink anti-solar belt
  return c;
}
vec3 skyBase(vec3 d) { return skyCol(d, skyDir(d).y); }
vec2 moonUV(vec3 d, out vec3 rt, out vec3 upv) {                                    // 16-px MC moon grid, 1 = disc edge
  vec3 m = uMoonV;
  rt = normalize(cross(m, abs(m.y) > .995 ? vec3(0., 0., 1.) : vec3(0., 1., 0.))); upv = cross(rt, m);
  vec2 p = vec2(dot(d, rt), dot(d, upv)) / uMoonR;
  return (floor(p * 8.) + .5) / 8.;
}
`;
  const VS = 'varying vec3 vW;\nvoid main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
  const OUT = '\n  #include <tonemapping_fragment>\n  #include <encodings_fragment>\n}';

  // ---- dome：天空 + 星星 + 月晕；地平线下 = 背景色 + 低云海（世界坐标的平面 y = uSeaY，随相机正确视差） ----
  const FS_DOME = `
uniform vec3 uGalPole;
vec3 milkyWay(vec3 d) {
  float q = dot(d, uGalPole) / .16;
  return vec3(.3,.38,.62) * exp(-q*q) * .05 * kFbm(d.xz * 11. + d.y * 5.);
}
vec3 below(vec3 d) {                        // d = 画法方向（地平线下）
  vec2 h = normalize(d.xz + vec2(1e-5));
  vec3 hz = skyCol(vec3(h.x * cos(uShow.x), -sin(uShow.x), h.y * cos(uShow.x)), .002);   // 画出来的地平线那一圈的颜色
  vec3 c = uVoid * mix(1., .86, 1. - smoothstep(-.9, -.2, d.y));
  if (uSea > 0. && cameraPosition.y > uSeaY + .5 && d.y < -.001) {
    float t = (cameraPosition.y - uSeaY) / -d.y;
    vec2 q = (cameraPosition.xz + d.xz * t + uCloudOff * .35) / 26.;
    float n = kFbm(q), cov = smoothstep(.4, .62, n) * min(uSea, 1.);
    float lit = clamp((n - kFbm(q + normalize(uLitDir.xz + vec2(1e-4)) * .3)) * 5. + .5, 0., 1.);
    vec3 sh = uVoid * vec3(.84, .82, .96), tp = uVoid * 1.15 + uLitCol * (sLum(uHorizon) + .02) * .25;
    c = mix(c, mix(sh, tp, lit), cov);
  }
  return mix(hz, c, 1. - smoothstep(-.2, 0., d.y));
}
void main() {
  vec3 d = normalize(vW - cameraPosition), w = skyDir(d);
  float e = w.y, day = sDay();
  vec3 c = skyCol(d, e), rt, upv;
  vec2 mp = moonUV(d, rt, upv);
  float mm = step(dot(mp, mp), 1.) * step(0., dot(d, uMoonV));                     // stars hide behind the moon
  c += milkyWay(w) * uStars * .16 * (1. - mm) * smoothstep(0., .2, e);
  float vis = smoothstep(-.004, .012, e) * (1. - .96 * smoothstep(.55, .95, uCloud)) * (1. - .85 * uWx.z);
  float mup = smoothstep(-.03, .04, uShow.z), ma = max(dot(d, uMoonV), 0.);
  c += vec3(.5, .6, .85) * pow(ma, 90.) * .035 * uMoonIl * (1. - day) * mup * vis;   // wide moon halo
  c = mix(below(w), c, smoothstep(-.012, .03, e));
  c = c * (1. + 2.2 * uWx.w) + vec3(.5, .56, .78) * .3 * uWx.w;                      // 闪电：整片天一闪
  gl_FragColor = vec4(c, 1.);`;
  // ---- sun：圆盘（约 1°，HDR 很亮，交给泛光）+ 一圈日冕；加法混合叠在天空球上 ----
  const FS_SUN = `
void main() {
  vec3 d = normalize(vW - cameraPosition);
  float r = length(d - uSunV) / uSunR, aa = max(fwidth(r), 1e-4);
  float disc = 1. - smoothstep(1. - aa, 1. + aa, r), limb = .8 + .2 * sqrt(max(1. - r * r, 0.));
  float cor = exp(-max(r - 1., 0.) * 2.4) * (1. - smoothstep(4.5, 7.5, r));
  vec3 col = mix(vec3(1., .96, .9), vec3(1., .52, .24), uGolden);
  float hz = smoothstep(-.004, .012, skyDir(d).y) * (1. - .96 * smoothstep(.55, .95, uCloud)) * (1. - .9 * uWx.z);   // 画出来的地平线 / 阴天 / 雾
  gl_FragColor = vec4(col * (disc * limb * uSunG.w * mix(1., .7, uGolden) + cor * uSunG.z * mix(.55, 1., uGolden) * (1. - disc)) * hz, 1.);` + OUT;
  // ---- moon：16 格像素月亮，月相按日月夹角（v1 的 moonDisk），暗面有一点地照；加法混合 ----
  const FS_MOON = `
void main() {
  vec3 d = normalize(vW - cameraPosition), m = uMoonV, rt, upv;
  vec2 p = moonUV(d, rt, upv);
  float r2 = dot(p, p), mask = step(r2, 1.) * step(0., dot(d, m)), day = sDay();
  vec3 n = p.x * rt + p.y * upv - sqrt(max(1. - r2, 0.)) * m;
  vec3 sd = uSunV - dot(uSunV, m) * m;
  sd = dot(sd, sd) > 1e-6 ? normalize(sd) : rt;
  float el = 6.2831853 * min(uMoonPh, 1. - uMoonPh);                                 // elongation 0 (new) .. pi (full)
  float lit = smoothstep(-.04, .1, dot(n, cos(el) * m + sin(el) * sd));
  float mare = .8 + .2 * kNoise(p * 2.3 + 3.1) - .14 * step(.6, kNoise(p * 3.1 + 9.));
  vec3 mc = vec3(.93, .95, 1.) * mare * lit + vec3(.55, .7, 1.) * .03 * (1.25 - uMoonIl) * (1. - lit) * (1. - day) * (1. - day);
  float ma = max(dot(d, m), 0.);
  vec3 c = mc * mask * mix(1.5, .45, day) + vec3(.5, .6, .85) * pow(ma, 2400.) * .1 * uMoonIl * (1. - day);
  float hz = smoothstep(-.004, .012, skyDir(d).y) * (1. - .96 * smoothstep(.55, .95, uCloud)) * (1. - .9 * uWx.z) * smoothstep(-.03, .04, uShow.z);
  gl_FragColor = vec4(c * hz, 1.);` + OUT;
  // ---- MC 方块云：一个 BackSide 盒子，着色器里按格子做 DDA（v1 原样，去掉暴雨/闪电/雾天） ----
  const FS_CLOUD = `
const float CELL = 12., Y0 = 38., Y1 = 42., EXT = 300.;
float cOcc(vec2 c, float thr) {
  float n = kNoise(c * .23) * .62 + kNoise(c * .61 + 13.7) * .26 + kHash12(c) * .12;
  return step(thr, n);
}
void main() {
  vec3 ro = cameraPosition, rv = normalize(vW - ro), rd = skyDir(rv);   // 沿「画法方向」走格子：云跟着天空一起往下挪
  if (ro.y > Y0 - 1.) discard;
  vec3 rs = sign(rd + 1e-9) * max(abs(rd), vec3(1e-6)), inv = 1. / rs;
  vec3 t0 = (vec3(-EXT, Y0, -EXT) - ro) * inv, t1 = (vec3(EXT, Y1, EXT) - ro) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float tN = max(max(tn.x, tn.y), tn.z), tF = min(min(tf.x, tf.y), tf.z);
  if (tF <= max(tN, 0.)) discard;
  vec3 nrm = tN == tn.y ? vec3(0., -sign(rs.y), 0.) : (tN == tn.x ? vec3(-sign(rs.x), 0., 0.) : vec3(0., 0., -sign(rs.z)));
  if (tN < 0.) { tN = 0.; nrm = vec3(0., -sign(rs.y), 0.); }
  float cover = clamp(uCloud * 1.08, 0., 1.), thr = mix(.79, .24, cover);
  vec3 p = ro + rd * tN;
  vec2 q = (p.xz + uCloudOff) / CELL, cell = floor(q), rq = rs.xz / CELL;
  vec2 st = sign(rq), tD = abs(1. / rq), tM = tN + (cell + max(st, 0.) - q) / rq;
  float t = tN, hit = 0.;
  for (int i = 0; i < 80; i++) {
    if (t > tF) break;
    if (cOcc(cell, thr) > .5) { hit = 1.; break; }
    if (tM.x < tM.y) { t = tM.x; tM.x += tD.x; cell.x += st.x; nrm = vec3(-st.x, 0., 0.); }
    else { t = tM.y; tM.y += tD.y; cell.y += st.y; nrm = vec3(0., 0., -st.y); }
  }
  if (hit < .5) discard;
  vec3 hp = ro + rd * t, L = normalize(uLitDir);
  float day = sDay(), bot = step(nrm.y, -.5), top = step(.5, nrm.y), side = 1. - bot - top;
  float ndl = max(dot(nrm, L), 0.), Lh = sLum(uHorizon) + .02;
  vec3 skyA = mix(uHorizon, uSky, .4);
  vec3 cBot = Lh * mix(mix(vec3(.42, .5, .78), vec3(.5, .54, .62), day), vec3(.95, .55, .48), uGolden) * (.95 - .25 * uCloud) + uGround * .08;
  vec3 cSide = skyA * .5 + uLitCol * (.03 + .45 * ndl) + sWarm() * uGolden * Lh * .5 * ndl;
  vec3 cTop = skyA * 1.05 + uLitCol * (.15 + .6 * ndl);
  vec3 col = (cBot * bot + cSide * side + cTop * top) * (.95 + .1 * kHash12(cell + 3.3));
  col += uLitCol * pow(max(dot(rv, uSunV), 0.), 12.) * .35 * day * (1. - bot) * (1. - uWx.x);   // silver lining
  float nt = 1. - day;                                                                 // night: thin, moonlit, sky-tinted (no dark slabs)
  col += uLitCol * .3 * nt * (bot + .5 * side);
  col = mix(col, vec3(sLum(col)), .55 * uWx.x) * (1. - .35 * uWx.x * bot) * (1. - .45 * uWx.y);   // 阴天：灰、底更暗；雷雨更暗
  col = mix(col, skyBase(rv), .5 * (1. - exp(-t / 260.)) + .3 * nt);
  col += vec3(.55, .6, .85) * uWx.w * (1.2 * bot + .5);                                // 闪电从云里亮
  float a = mix(1., mix(.38, .85, uWx.x), nt) * (1. - smoothstep(EXT * .7, EXT, length(hp.xz)));
  gl_FragColor = vec4(col, a);` + OUT;
  // ---- JS helpers ----
  // linear HDR background below the horizon: horizon/zenith mix, desaturated, lavender tint (day pale lavender, night navy)
  const voidColor = (st, out) => {
    const z = st.sky.zenith, h = st.sky.horizon, k = P.voidMix, t = P.voidTint, s = P.voidSat, K = P.voidK;
    const r = h.r + (z.r - h.r) * k, g = h.g + (z.g - h.g) * k, b = h.b + (z.b - h.b) * k;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    out.r = (l + (r - l) * s) * t[0] * K; out.g = (l + (g - l) * s) * t[1] * K; out.b = (l + (b - l) * s) * t[2] * K;
    return out;
  };
  // three r152 ACESFilmicToneMapping on one colour (still linear: three encodes fog to sRGB itself). Fog mixes
  // after tonemapping, so without the post pipeline the fog colour must already be tonemapped.
  const fit = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
  const sat = v => Math.min(1, Math.max(0, v));
  const aces = (c, exp, out) => {
    const k = exp / 0.6, r = c.r * k, g = c.g * k, b = c.b * k;
    const a = fit(0.59719 * r + 0.35458 * g + 0.04823 * b), e = fit(0.07600 * r + 0.90834 * g + 0.01566 * b), f = fit(0.02840 * r + 0.13383 * g + 0.83777 * b);
    out.r = sat(1.60475 * a - 0.53108 * e - 0.07367 * f); out.g = sat(-0.10208 * a + 1.10813 * e - 0.00605 * f); out.b = sat(-0.00327 * a - 0.07276 * e + 1.07602 * f);
    return out;
  };
  const mkMat = (fs, uni, opt) => {
    const m = new THREE.ShaderMaterial(Object.assign({ uniforms: uni, vertexShader: VS, fragmentShader: GLSL + fs, depthWrite: false, depthTest: false }, opt));
    m.extensions.derivatives = true;
    return m;
  };
  const ADD = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
  const OVER = { blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
  const mkDir = (name) => {
    const l = new THREE.DirectionalLight(0xffffff, 0);
    l.name = name; l.castShadow = false;
    l.shadow.mapSize.set(4096, 4096); l.shadow.bias = -0.0004; l.shadow.normalBias = 0.03;   // 2026-11-05 测过 2048：帧时间无差别，保留 4096
    return l;
  };
  // ortho shadow camera fitted to P.shadowBox in light space (same basis as three's shadowCamera.lookAt)
  const _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0), _cp = new THREE.Vector3();
  const fitShadow = (l, dir) => {
    const T = P.target, B = P.shadowBox, c = l.shadow.camera;
    l.target.position.set(T[0], T[1], T[2]);
    l.position.copy(l.target.position).addScaledVector(dir, 60);
    _m.lookAt(l.position, l.target.position, _up);
    const e = _m.elements;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const px = B[i & 1 ? 3 : 0] - l.position.x, py = B[i & 2 ? 4 : 1] - l.position.y, pz = B[i & 4 ? 5 : 2] - l.position.z;
      const cx = px * e[0] + py * e[1] + pz * e[2], cy = px * e[4] + py * e[5] + pz * e[6], cz = -(px * e[8] + py * e[9] + pz * e[10]);
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy); z0 = Math.min(z0, cz); z1 = Math.max(z1, cz);
    }
    c.left = x0 - 0.5; c.right = x1 + 0.5; c.bottom = y0 - 0.5; c.top = y1 + 0.5; c.near = Math.max(0.1, z0 - 1); c.far = z1 + 1;
    c.updateProjectionMatrix();
  };
  // dome / cloud shell follow the camera (shader rebuilds the world ray from vW - cameraPosition)
  function follow(r, s, cam) {
    cam.getWorldPosition(_cp);
    if (this.parent) this.parent.worldToLocal(_cp);
    this.position.copy(_cp); this.updateMatrixWorld();
  }
  // sun / moon: camera-facing quad R0 metres away along the body's direction; half-size = quad × angular radius
  const billboard = (dirU, radU, quad) => function (r, s, cam) {
    cam.getWorldPosition(_cp).addScaledVector(dirU.value, R0);
    if (this.parent) this.parent.worldToLocal(_cp);
    this.position.copy(_cp); this.quaternion.copy(cam.quaternion);
    this.scale.setScalar(R0 * Math.tan(radU.value * quad));
    this.updateMatrixWorld();
  };
  // picking by angular distance (the quad is only a billboard); hit sits R0 metres out, behind everything on the island
  const discRaycast = (dirU, radU, k) => function (ray, out) {
    if (!this.visible) return;
    const rd = ray.ray.direction;
    if (rd.dot(dirU.value) < Math.cos(radU.value * k)) return;
    out.push({ distance: R0, point: ray.ray.origin.clone().addScaledVector(rd, R0), object: this, faceIndex: 0,
      face: { a: 0, b: 1, c: 2, normal: new THREE.Vector3(0, 0, 1), materialIndex: 0 } });
  };
  const WARM = new THREE.Color(1.05, 0.95, 0.82);
  const NOPOST = U.qs('nopost', '') === '1';
  const isPost = () => !NOPOST && typeof V3.post === 'function' && V3.post.active !== false && !!(V3.R && V3.R.post);
  // HDR colour → light colour (max channel 1) + intensity (legacy lights: radiance ≈ albedo × colour × intensity × N·L)
  const hdrLight = (l, c, k) => {
    const m = Math.max(c.r, c.g, c.b);
    if (!(m > 1e-4) || !(k > 0)) { l.intensity = 0; return; }
    l.color.setRGB(c.r / m, c.g / m, c.b / m); l.intensity = m * k;
  };
  // night tint: push a light colour toward P.moonTint by k while keeping its luma (night brightness stays the same)
  const _tint = new THREE.Color(), _mc = new THREE.Color(), _sd = new THREE.Vector3();
  const cool = (c, k) => {
    const t = P.moonTint, y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (!(k > 0) || !t || !(y > 1e-6)) return c;
    const ty = Math.max(1e-6, 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]);
    _tint.setRGB(t[0] * y / ty, t[1] * y / ty, t[2] * y / ty);
    return c.lerp(_tint, Math.min(1, k));
  };

  // ---- the part ----
  let live = null;
  // 闪电（54-wx 发 V3.emit('wx:flash', k)）：一下子亮起来，停 30 ms 后按 flashTau 衰减；用墙上时钟（t= 冻结时也会闪完）
  const FL = { k: 0, t0: 0 };
  const flashNow = () => {
    if (!(FL.k > 0)) return 0;
    const dt = (performance.now() - FL.t0) / 1000, v = FL.k * Math.exp(-Math.max(0, dt - 0.03) / Math.max(0.02, P.flashTau));
    if (v < 0.004) { FL.k = 0; return 0; }
    return v;
  };
  if (V3.on) V3.on('wx:flash', (k) => {
    k = +k; if (!(k > 0)) k = 1;
    FL.k = Math.min(2, flashNow() + Math.min(k, 1.5)); FL.t0 = performance.now();
  });
  const _cw = new THREE.Vector3(), _fw = new THREE.Color();
  const applyEnv = (L) => {
    const st = V3.env && V3.env.state, u = L.uni;
    if (!st || !st.sky) return;
    const sky = st.sky, moonKey = st.key === 'moon', E = V3.env;
    // 画出来的日月按当前镜头高度压低（state.sunShow / moonShow 同步成画面上的位置，50-scene 的 sun/moon 视角读它们）
    const cam = V3.R && V3.R.camera;
    if (E.showParams) E.showParams.on = P.lowSky !== false && U.qs('realsky', '') !== '1';
    if (typeof E.show === 'function') E.show(cam && E.dipFor ? E.dipFor(cam.getWorldPosition(_cw).y) : undefined);
    u.uSky.value.copy(sky.zenith); u.uHorizon.value.copy(sky.horizon); u.uGround.value.copy(sky.ground || sky.horizon);
    u.uSunV.value.copy(st.sunShow || st.sunDir); u.uMoonV.value.copy(st.moonShow || st.moonDir);
    u.uShow.value.set((st.showDip || 0) * Math.PI / 180, st.sunDir.y, st.moonDir.y, 0);
    const wx = st.wx || {}, oc = U.smooth(0.5, 0.95, wx.cloud || 0), fl = flashNow();
    u.uWx.value.set(oc, wx.storm || 0, wx.fog || 0, fl * P.flashSky);
    u.uGolden.value = st.golden || 0; u.uStars.value = st.stars != null ? st.stars : st.night;
    u.uMoonPh.value = st.moonPhase; u.uMoonIl.value = st.moonIllum;
    u.uCloud.value = Math.max(P.cloud, wx.cloud || 0); u.uSea.value = P.sea; u.uSeaY.value = P.seaY; u.uSunR.value = P.sunR; u.uMoonR.value = P.moonR;
    u.uSunG.value.set(P.sunMie, P.sunHalo, P.sunCorona, P.sunDisc);
    voidColor(st, u.uVoid.value);
    if (wx.fog > 0 && P.fogWhite > 0) {   // 雾天：背景 / 雾色往亮灰白靠（远处发白）
      const h = sky.horizon, y = 0.2126 * h.r + 0.7152 * h.g + 0.0722 * h.b;
      u.uVoid.value.lerp(_fw.setRGB(y * 0.96, y * 0.99, y * 1.06), Math.min(1, wx.fog * P.fogWhite));
    }
    const sunDir = _sd.copy(st.sunLightDir || st.sunDir), moonDir = st.moonLightDir || st.moonDir;
    if (P.sunMinY > 0 && sunDir.y < P.sunMinY) {   // lift a low sun (keeps its azimuth); the visible disc stays where it is
      const h = Math.hypot(sunDir.x, sunDir.z) || 1, y = Math.min(P.sunMinY, 0.95), k = Math.sqrt(1 - y * y) / h;
      sunDir.set(sunDir.x * k, y, sunDir.z * k);
    }
    u.uLitCol.value.copy(moonKey ? sky.moon : sky.sun); u.uLitDir.value.copy(moonKey ? moonDir : sunDir);
    // lights: only the key light casts (both keep the same shadow config, so switching never recompiles)
    const dk = Math.min(1, Math.max(0, (st.sunAlt + 12) / 8)), deep = 1 - dk * dk * (3 - 2 * dk);   // 0 above −4° (dusk keeps its lavender) → 1 below −12°
    const blue = (P.moonBlue || 0) * deep;   // moonlight cool blue, only through the light colours
    const gk = st.golden || 0, sunK = P.sunK * (1 + ((P.goldenSun || 1) - 1) * gk), ambK = P.ambK * (1 + ((P.goldenAmb || 1) - 1) * gk);
    hdrLight(L.sun, sky.sun, sunK); hdrLight(L.moon, cool(_mc.copy(sky.moon || u.uLitCol.value), blue), P.moonK);
    L.moon.intensity /= 1 + L.moon.intensity * (P.moonSoft || 0);   // soft cap: the full moon stays a night light
    fitShadow(L.sun, sunDir); fitShadow(L.moon, moonDir);
    const key = moonKey ? L.moon : L.sun, other = moonKey ? L.sun : L.moon;
    if (!key.castShadow || other.castShadow) {
      key.castShadow = true; other.castShadow = false;
      if (other.shadow.map) { other.shadow.map.dispose(); other.shadow.map = null; }
    }
    const nk = 1 - (1 - P.nightK) * (st.night || 0);
    cool(L.hemi.color.copy(sky.ambient), blue).multiplyScalar(ambK * nk);
    cool(L.hemi.groundColor.copy(sky.ambient).multiply(WARM), blue * 0.6).multiplyScalar(P.groundK * nk);
    if (fl > 0) {   // 闪电：环境光一下子冷白
      const a = fl * P.flashAmb;
      L.hemi.color.r += 0.85 * a; L.hemi.color.g += 0.9 * a; L.hemi.color.b += a;
      L.hemi.groundColor.r += 0.3 * a; L.hemi.groundColor.g += 0.32 * a; L.hemi.groundColor.b += 0.36 * a;
    }
    // fog: linear while post renders into its HDR target, tonemapped when three renders straight to the screen
    const exp = (st.exposure || 1) * P.exposure * (1 + P.flashExp * Math.min(1, fl));
    L.fog.density = (st.fog && st.fog.density != null ? st.fog.density : 0.004) * P.fogDensity / 0.004;   // env 按天气给（晴 0.004 → 雾 ≈0.02）
    if (isPost()) L.fog.color.copy(u.uVoid.value); else aces(u.uVoid.value, exp, L.fog.color);
    if (V3.R && V3.R.renderer) V3.R.renderer.toneMappingExposure = exp;
    L.sunM.visible = st.sunAlt > -3; L.moonM.visible = st.moonAlt > -3;
    L.clouds.visible = u.uCloud.value > 0.01;
  };

  // ---- cutaway shadows: the house is still whole for the sun. Pieces the cutaway hides (roof / loft / walls facing the
  // camera, tagged like 50-scene's collect) are shown again only while three draws the shadow maps, then hidden again.
  const CUT = { r: null, orig: null, list: null, root: null, g: null, on: [] };
  const cutList = (root) => {
    const out = [];
    root.traverse(o => {
      const u = o.userData || {};
      if (u.wall || u.onWall || u.layer === 'roof' || u.layer === 'loft') out.push(o);
    });
    return out;
  };
  const hookShadows = (g) => {
    const r = V3.R && V3.R.renderer, sm = r && r.shadowMap;
    CUT.g = g; CUT.list = null; CUT.root = null;   // a rebuild re-collects
    if (!sm || CUT.orig) return;
    CUT.r = r; CUT.orig = sm.render;
    sm.render = function (lights, scene, camera) {
      const on = CUT.on, g = CUT.g; on.length = 0;
      if (P.cutShadow && g && live && live.g === g) {
        if (!CUT.list) {               // parts after the sky are built later: collect lazily on the first shadow pass
          let root = g; while (root.parent && root.parent !== scene) root = root.parent;
          CUT.root = root; CUT.list = root === g ? [] : cutList(root);
        }
        for (const o of CUT.list) if (!o.visible) { o.visible = true; on.push(o); }
      }
      try { return CUT.orig.call(this, lights, scene, camera); }
      finally { for (const o of on) o.visible = false; on.length = 0; }
    };
  };
  const unhookShadows = () => {
    if (CUT.r && CUT.orig) CUT.r.shadowMap.render = CUT.orig;
    CUT.r = CUT.orig = CUT.list = CUT.root = CUT.g = null; CUT.on.length = 0;
  };

  // 一次绘制整份星表。行星占末尾五个点，只在时间跨分钟时重算轨道。
  function starPoints(uni) {
    const stars=V3.stars, site={...V3.env.astro.site(), date:V3.env.state.ms};
    const rows=stars.catalog.concat(stars.planets(site)), g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(rows.flatMap(s=>s.v.toArray()),3));
    g.setAttribute('tint',new THREE.Float32BufferAttribute(rows.flatMap(s=>new THREE.Color(s.color).toArray()),3));
    g.setAttribute('mag',new THREE.Float32BufferAttribute(rows.map(s=>s.mag),1));
    const mat=new THREE.ShaderMaterial({...ADD, uniforms:uni, depthTest:false, depthWrite:false,
      vertexShader:`uniform mat4 uFrame; uniform vec4 uShow; uniform float uLimit,uTime,uMoonR,uDpr; uniform vec3 uMoonV;
        attribute float mag; attribute vec3 tint; varying vec3 light;
        void main(){ vec3 d=mat3(uFrame)*position; float alt=asin(clamp(d.y,-1.,1.));
          float e=alt*(1.+uShow.x/1.5707963)-uShow.x;
          vec3 shown=vec3(normalize(d.xz+vec2(1.e-8))*cos(e),sin(e)).xzy;
          gl_Position=projectionMatrix*vec4(mat3(viewMatrix)*shown*260.,1.);
          if(alt<=0. || mag>uLimit || dot(shown,uMoonV)>cos(uMoonR)) gl_Position=vec4(2.,2.,2.,1.);
          float bright=clamp((6.4-mag)/7.,0.,1.3);
          gl_PointSize=(1.1+3.7*bright)*uDpr;
          light=tint*(.10+bright*bright*1.3)*clamp((uLimit-mag+.1)*2.,0.,1.)
            *smoothstep(0.,.09,alt)*(.91+.09*sin(uTime*2.+position.z*125.)); }`,
      fragmentShader:`varying vec3 light; void main(){vec2 p=2.*gl_PointCoord-1.;
        gl_FragColor=vec4(light*max(0.,exp(-3.*dot(p,p))-.05),1.);`+OUT});
    const mesh=new THREE.Points(g,mat); mesh.raycast=()=>{};
    return mesh;
  }
  const galPole=V3.stars && V3.stars.vector(192.85948,27.12825);
  function updateStars(L,st) {
    const u=L.uni, max=V3.stars.limit(st);
    L.points.visible=Number.isFinite(max);
    if(!L.points.visible) { u.uStars.value=0; return; }
    u.uLimit.value=max; u.uDpr.value=V3.R.renderer.getPixelRatio();
    const site=V3.env.astro.site(), minute=Math.floor(st.ms/60000);
    if(L.starTime!==st.ms || L.starLat!==site.lat || L.starLon!==site.lon) {
      site.date=st.ms; u.uFrame.value.copy(V3.stars.frame(site));
      u.uGalPole.value.copy(galPole).applyMatrix4(u.uFrame.value);
      L.starTime=st.ms; L.starLat=site.lat; L.starLon=site.lon;
      if(minute!==L.planetMinute) {
        const pos=L.points.geometry.attributes.position, n=V3.stars.catalog.length;
        V3.stars.planets(site).forEach((p,i)=>pos.setXYZ(n+i,p.v.x,p.v.y,p.v.z));
        pos.updateRange.offset=n*3; pos.updateRange.count=15; pos.needsUpdate=true; L.planetMinute=minute;
      }
    }
  }
  const build = () => {
    const C = () => ({ value: new THREE.Color() }), V = (x, y, z) => ({ value: new THREE.Vector3(x, y, z) }), F = v => ({ value: v });
    const uni = {
      uFrame:{value:new THREE.Matrix4()}, uLimit:F(6), uDpr:F(1), uGalPole:V(0,1,0),
      uSky: C(), uHorizon: C(), uGround: C(), uVoid: C(), uLitCol: C(), uSunV: V(0, 1, 0), uMoonV: V(0, -1, 0), uLitDir: V(0, 1, 0),
      uCloudOff: { value: new THREE.Vector2() }, uTime: F(0), uGolden: F(0), uStars: F(0), uMoonPh: F(0.5), uMoonIl: F(1),
      uCloud: F(P.cloud), uSunR: F(P.sunR), uMoonR: F(P.moonR), uSea: F(P.sea), uSeaY: F(P.seaY),
      uSunG: { value: new THREE.Vector4(P.sunMie, P.sunHalo, P.sunCorona, P.sunDisc) },
      uShow: { value: new THREE.Vector4(0, 1, -1, 0) }, uWx: { value: new THREE.Vector4() },
    };
    const g = new THREE.Group(); g.name = 'sky';
    const add = (m, name, pick) => {
      m.name = name; m.frustumCulled = false;
      Object.assign(m.userData, { anchor: 'house2:sky-' + name, layer: 'site', noShadow: true, noReceive: true });
      if (!pick) m.userData.noPick = true;
      g.add(m); return m;
    };
    const dome = add(new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), mkMat(FS_DOME + OUT, uni, { side: THREE.BackSide })), 'dome');
    dome.renderOrder = -1000; dome.onBeforeRender = follow;
    const points=add(starPoints(uni),'catalog'); points.renderOrder=-999.5;
    const sunM = add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mkMat(FS_SUN, uni, ADD)), 'sun', true);
    sunM.renderOrder = -999; sunM.onBeforeRender = billboard(uni.uSunV, uni.uSunR, 8); sunM.raycast = discRaycast(uni.uSunV, uni.uSunR, 3);
    const moonM = add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mkMat(FS_MOON, uni, ADD)), 'moon', true);
    moonM.renderOrder = -999; moonM.onBeforeRender = billboard(uni.uMoonV, uni.uMoonR, 2.5); moonM.raycast = discRaycast(uni.uMoonV, uni.uMoonR, 1.6);
    // cloud shell: a camera-centred sphere (inside the far plane); the shader marches the world-space cloud slab
    const clouds = add(new THREE.Mesh(new THREE.SphereGeometry(280, 32, 16), mkMat(FS_CLOUD, uni, Object.assign({ side: THREE.BackSide }, OVER))), 'clouds');
    clouds.renderOrder = -998; clouds.onBeforeRender = follow;
    const sun = mkDir('sky-sun-light'), moon = mkDir('sky-moon-light');
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1); hemi.name = 'sky-hemi'; hemi.position.set(0, 1000, 0);
    for (const o of [sun, sun.target, moon, moon.target, hemi]) { o.userData.noPick = true; g.add(o); }
    const fog = new THREE.FogExp2(0xffffff, P.fogDensity);
    if (V3.R && V3.R.scene) V3.R.scene.fog = fog;
    V3.parts.declare(['天空', '天空/太阳', '天空/月亮'], { '天空': '天空', '天空/太阳': '太阳', '天空/月亮': '月亮' });
    V3.parts.tag(sunM, '天空/太阳', { label: '太阳' }); V3.parts.tag(moonM, '天空/月亮', { label: '月亮' });
    live = { uni, g, dome, points, sunM, moonM, clouds, sun, moon, hemi, fog, t: 0 };
    applyEnv(live);
    updateStars(live,V3.env.state);
    hookShadows(g);
    return g;
  };
  const update = (dt, t) => {
    const L = live; if (!L) return;
    L.t += dt || 0;
    const time = typeof t === 'number' && isFinite(t) ? t : L.t;
    L.uni.uTime.value = time;
    L.uni.uCloudOff.value.set(P.wind[0] * time, P.wind[1] * time);
    applyEnv(L);
    updateStars(L,V3.env.state);
  };
  const dispose = () => {
    unhookShadows();
    const L = live; live = null; if (!L) return;
    for (const l of [L.sun, L.moon]) if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    const R = V3.R;
    if (R && R.scene && R.scene.fog === L.fog) R.scene.fog = null;
    if (R && R.renderer) R.renderer.toneMappingExposure = 1;
  };
  const f2 = v => (+v).toFixed(2), c3 = c => '[' + [c.r, c.g, c.b].map(f2).join(',') + ']';
  V3.sky = {
    params: P, get live() { return live; },
    // 用当前模型 hero 视角的 dist / el / target（读不到就用 0.42 / 50 / [0,1.5,-5]），把方位转到太阳（key='sun'）或月亮那边：返回 { az, el, dist, target, pos, cam }（cam = 视角 token 的值）
    aim(key, o) {
      o = o || {};
      const st = V3.env && V3.env.state, k = key === 'moon' || key === 'moonDir' ? 'moon' : 'sun';
      const d = st && (st[k + 'Show'] || st[k + 'Dir']);
      const cur = V3.models && V3.models.current && V3.models.current(), hv0 = cur && cur.views && cur.views.hero;
      const hv = hv0 && typeof hv0 === 'object' ? hv0 : {};
      const el = o.el != null ? o.el : (hv.el != null ? hv.el : 0.42), dist = o.dist || hv.dist || 50, T = o.target || hv.target || [0, 1.5, -5];
      const az = d ? Math.atan2(-d.x, -d.z) : 0.55, h = dist * Math.cos(el);
      const pos = [T[0] + h * Math.sin(az), T[1] + dist * Math.sin(el), T[2] + h * Math.cos(az)];
      return { az, el, dist, target: T, pos, cam: pos.concat(T).map(v => (+v).toFixed(2)).join('_') };
    },
    info() {
      const L = live; if (!L) return 'sky: not built';
      const st = V3.env && V3.env.state, w = st && st.wx;
      return 'sun ' + f2(L.sun.intensity) + c3(L.sun.color) + ' moon ' + f2(L.moon.intensity) + ' hemi ' + c3(L.hemi.color) + '/' + c3(L.hemi.groundColor) +
        ' void ' + c3(L.uni.uVoid.value) + ' fog ' + c3(L.fog.color) + ' d ' + L.fog.density.toFixed(4) + ' exp ' + f2(V3.R.renderer.toneMappingExposure) +
        ' key ' + (L.sun.castShadow ? 'sun' : 'moon') + ' post ' + isPost() + ' cutShadow ' + (CUT.list ? CUT.list.length : '-') +
        ' dip ' + f2(st ? st.showDip : 0) + ' cloud ' + f2(L.uni.uCloud.value) + (w ? ' wx ' + w.kind + '/' + w.src : '') + ' flash ' + f2(flashNow());
    },
  };
  if (V3.scene && V3.scene.part) V3.scene.part({ id: 'sky', label: '天空', order: 0, build, update, dispose });
})(window.V3);
