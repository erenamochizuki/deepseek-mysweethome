// 54-wx.js — owner: face。天气粒子（scene part 'wx'，order 35）：雨丝 / 落点水花 + 水面涟漪 / 雪 / 雷雨闪电。
// 读 V3.env.state.wx = { kind, cloud, rain, snow, fog, storm, … }（0..1，sky 负责平滑过渡）；wx 还只是名字时按 KIND 给默认量。
// 测试 token：wxfx=rain:0.8 / snow:0.6 / storm:1[:bolt] / off（直接覆盖读到的值；bolt = 立刻打一道闪电并定格在最亮那一帧）。
// 雨 / 雪各一个实例化网格（每滴一个面片），运动全在顶点着色器里：每滴在跟着镜头走的盒子里循环下落，盒子按世界坐标取模
// （镜头动，雨不跟着动）；房子屋顶下面的雨滴被遮掉（剖切看室内也不会下进屋里）。水花 / 涟漪：CPU 每个周期换一次落点。
// 不投影、不加点光源、noPick。闪电时 V3.emit('wx:flash', 强度 0..1)，每道闪电发一次；光照 / 曝光的瞬间变亮由 sky 接。
(function (V3) {
  'use strict';
  const U = V3.util, L = V3.layout, H = L.house;
  const MAX_RAIN = 7000, MAX_SNOW = 4500, MAX_SPL = 360;    // 实例上限（每个 2 三角）；雨 + 雪 + 水花合计 ≤ CAP 个实例（≤ 18k 三角）
  const CAP = 9000;
  const BOX = [24, 20, 24];                                 // 雨盒（m），中心 = 镜头 + 视线方向 · 0.5·BOX（盒子在镜头前方）
  const KIND = {                                            // state.wx 只有名字（sky 还没给数值）时的默认量
    clear: {}, cloudy: { cloud: 0.6 }, overcast: { cloud: 1 }, fog: { cloud: 0.8, fog: 0.8 },
    drizzle: { cloud: 0.9, rain: 0.35 }, rain: { cloud: 1, rain: 0.8 }, storm: { cloud: 1, rain: 1, storm: 1 }, snow: { cloud: 1, snow: 0.7 },
  };
  const W0 = { kind: 'clear', cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0 };
  let force = null;      // wxfx 覆盖值
  let pinBolt = false;   // wxfx …:bolt
  let live = null;       // 当前建好的部件状态
  let perf = 0, pf = null;   // wxfx …:perf → 90 帧后打印一次 draws / 三角 / 帧时（console.warn，shoot.mjs 会回显）
  function wxNow() {
    const st = V3.env && V3.env.state, w = st && st.wx;
    let o = w && typeof w === 'object' ? w : Object.assign({ kind: w || 'clear' }, KIND[w] || {});
    o = Object.assign({}, W0, o, force || {});
    for (const k of ['cloud', 'rain', 'snow', 'fog', 'storm']) o[k] = U.clamp(+o[k] || 0, 0, 1);
    return o;
  }
  const windNow = () => (V3.env && V3.env.state && V3.env.state.wind) || { speed: 0, gust: 0, dir: [0, -1] };

  // ---- 屋顶面高度（JS 版，和 GLSL roofY() 一致）：主屋脊东西向 + 朝海小山墙，取高的；不在屋顶上 → −1e9
  const OV = H.overhang != null ? H.overhang : 0.5, SL = (H.ridgeY - H.eaveY) / ((H.z1 - H.z0) / 2), ZM = (H.z0 + H.z1) / 2;
  const CG = H.crossGable || { x0: 0, x1: 0, z: H.z0, ridgeY: -1e9 };
  const HB = [H.x0 - OV, H.x1 + OV, H.z0 - OV, H.z1 + OV], CB = [CG.x0 - OV, CG.x1 + OV, CG.z + OV, CG.ridgeY];
  // 布置模式挪过、转过房子（54-house-mc 的 HB.place）：先把点转回房子自己的方向，再按上面的屋顶算
  const place = () => { const B = V3.houseBlocks; return B && B.place && B.unplacePoint && !B.isIdentity(B.place) ? B.place : null; };
  function roofY(x, z) {
    const pl = place();
    if (pl) { const q = V3.houseBlocks.unplacePoint([x, 0, z], pl); x = q[0]; z = q[2]; }
    if (x < HB[0] || x > HB[1] || z < HB[2] || z > Math.max(HB[3], CB[2])) return -1e9;
    let y = z <= HB[3] ? H.ridgeY - SL * Math.abs(z - ZM) : -1e9;
    if (x > CB[0] && x < CB[1] && z < CB[2]) y = Math.max(y, CB[3] - SL * Math.abs(x - (CG.x0 + CG.x1) / 2));
    return y;
  }
  const ROOF_GLSL = `
uniform vec4 uHB; uniform vec4 uCB; uniform vec3 uRf;   // uRf = (ridgeY, zMid, slope); uCB.w = cross ridgeY
uniform vec4 uPl; uniform float uPk;                    // 房子摆法：uPl = (转的中心 x, z, 挪 dx, dz)，uPk = 顺时针转几步
float roofY(vec2 p) {
  if (uPk != 0.0 || uPl.z != 0.0 || uPl.w != 0.0) {     // 先转回房子自己的方向
    vec2 q = p - uPl.xy - uPl.zw; float t = -uPk * 1.5707963268, c = cos(t), s = sin(t);
    p = vec2(q.x * c - q.y * s, q.x * s + q.y * c) + uPl.xy;
  }
  if (p.x < uHB.x || p.x > uHB.y || p.y < uHB.z || p.y > max(uHB.w, uCB.z)) return -1e9;
  float y = p.y <= uHB.w ? uRf.x - uRf.z * abs(p.y - uRf.y) : -1e9;
  if (p.x > uCB.x && p.x < uCB.y && p.y < uCB.z) y = max(y, uCB.w - uRf.z * abs(p.x - 0.5 * (uCB.x + uCB.y)));
  return y;
}`;
  const roofUni = () => {
    const pl = place(), c = pl ? V3.houseBlocks.pivot() : [0, 0];
    return { uHB: { value: new THREE.Vector4(...HB) }, uCB: { value: new THREE.Vector4(...CB) }, uRf: { value: new THREE.Vector3(H.ridgeY, ZM, SL) },
      uPl: { value: new THREE.Vector4(c[0], c[1], pl ? pl.dx : 0, pl ? pl.dz : 0) }, uPk: { value: pl ? pl.k : 0 } };
  };
  const seaY = () => (V3.water && Number.isFinite(V3.water.level) ? V3.water.level : L.sea && Number.isFinite(L.sea.y) ? L.sea.y : -1e9);
  // 水花落点：{ y, water } 或 null（屋顶被剖切藏起来时房子上不冒水花）
  function surf(x, z, roofOn) {
    const r = roofY(x, z);
    if (r > -1e8) return roofOn ? { y: r, water: false } : null;
    const P = (V3.houseBlocks && V3.houseBlocks.placedLayout ? V3.houseBlocks.placedLayout() : L).porch;
    if (P && x >= P.x0 && x <= P.x1 && z >= P.z0 && z <= P.z1) return { y: P.y, water: false };
    const T = V3.terrain, Wt = V3.water, g = T && T.groundY ? T.groundY(x, z) : 0, sea = seaY();
    if (g < sea - 0.02) return { y: Wt && Wt.waveY ? Wt.waveY(x, z) : sea, water: true };   // waveY 已含海平面
    return { y: g, water: false };
  }
  // ---- 雨 / 雪：每滴一个面片（实例化，position.xy = 面片角 ±1）。位置 = 种子·盒子 + 风漂 − 下落·t，按盒子取模
  const DROP_VS = ROOF_GLSL + `
uniform float uT; uniform vec3 uBox; uniform vec3 uC; uniform vec3 uDrift; uniform vec3 uVel; uniform float uMode; uniform float uSea; uniform float uK;
attribute vec4 aSeed;
varying vec2 vQ; varying float vA;
void main() {
  bool snow = uMode > 0.5;
  float k = 0.7 + 0.6 * aSeed.w, fall = snow ? 0.9 + 0.7 * aSeed.w : 7.5 + 2.5 * aSeed.w;
  vec3 p = aSeed.xyz * uBox + uDrift * k;
  p.y -= fall * uT;
  if (snow) { float ph = aSeed.w * 37.0; p.x += 0.35 * sin(uT * (0.9 + aSeed.x) + ph); p.z += 0.35 * cos(uT * (0.8 + aSeed.z) + ph * 1.3); }
  vec3 lo = uC - 0.5 * uBox;
  p = lo + mod(p - lo, uBox);
  vec3 e = abs(p - uC) / (0.5 * uBox);
  vec3 toC = cameraPosition - p; float d = length(toC); toC /= max(d, 1e-3);
  vA = (1.0 - smoothstep(0.7, 1.0, max(e.x, max(e.y, e.z)))) * (snow ? smoothstep(1.6, 4.0, d) : smoothstep(0.8, 2.5, d));   // 雪花离镜头太近会变成大光斑
  if (p.y < uSea || p.y < roofY(p.xz)) vA = 0.0;                      // 海面以下 / 屋顶下面（室内）没有雨
  vec3 v = snow ? vec3(0.0, -1.0, 0.0) : normalize(vec3(0.0, -fall, 0.0) + uVel * k);
  vec3 sd = cross(v, toC); if (dot(sd, sd) < 1e-4) sd = vec3(1.0, 0.0, 0.0); sd = normalize(sd);
  vec3 up = snow ? normalize(cross(toC, sd)) : v;
  float w = snow ? max(0.025 + 0.02 * aSeed.w, 2.3 * uK * d) : max(0.004, uK * d);   // uK = 1 px 半宽 / m：雨丝 ≈ 2 px；雪花 5–9 cm，远处不小于 ~5 px
  float len = snow ? w : 0.3 + 0.25 * aSeed.w;
  if (vA <= 0.0) { w = 0.0; len = 0.0; }
  vQ = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + sd * (position.x * w) + up * (position.y * len), 1.0);
}`;
  const DROP_FS = `
uniform vec4 uCol; uniform float uMode;
varying vec2 vQ; varying float vA;
void main() {
  float a = uMode > 0.5 ? 1.0 - smoothstep(0.3, 1.0, length(vQ))
    : (1.0 - abs(vQ.x)) * smoothstep(-1.0, 0.3, vQ.y) * (1.0 - smoothstep(0.75, 1.0, vQ.y));   // 头（下端）亮、尾巴淡
  a *= vA * uCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol.rgb, a);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;
  const quad = () => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = 0;
    return g;
  };
  function fxMesh(g, mat, id, order) {   // 不投影、不挡点击、不参与视锥剔除（位置在着色器里算）
    const m = new THREE.Mesh(g, mat);
    m.name = 'wx-' + id; m.frustumCulled = false; m.renderOrder = order; m.visible = false; m.raycast = () => {};
    Object.assign(m.userData, { anchor: 'house2:wx:' + id, layer: 'site', noPick: true, noShadow: true, noReceive: true });
    return m;
  }
  function drops(mode, max) {
    const g = quad(), r = U.rng(mode === 'rain' ? 7121 : 9157), s = new Float32Array(max * 4);
    for (let i = 0; i < s.length; i++) s[i] = r();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(roofUni(), { uT: { value: 0 }, uBox: { value: new THREE.Vector3(...BOX) }, uC: { value: new THREE.Vector3() },
        uDrift: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uMode: { value: mode === 'snow' ? 1 : 0 },
        uSea: { value: -1e9 }, uK: { value: 1 }, uCol: { value: new THREE.Vector4(1, 1, 1, 0) } }),
      vertexShader: DROP_VS, fragmentShader: DROP_FS, transparent: true, depthWrite: false,
    });
    return { mesh: fxMesh(g, mat, mode, 8), mat, geo: g, max, mode, drift: new THREE.Vector3() };
  }
  const _f = new THREE.Vector3();
  // 每帧：数量 ∝ amt；盒子中心 = 镜头前方；风漂按风速积分（风变了雨滴不跳）
  function stepDrops(D, amt, P) {
    const n = Math.round(D.max * amt);
    D.mesh.visible = n > 8;
    if (!D.mesh.visible) return;
    D.geo.instanceCount = n;
    const u = D.mat.uniforms, snow = D.mode === 'snow';
    u.uVel.value.copy(P.vel).multiplyScalar(snow ? 0.5 : 1);
    D.drift.addScaledVector(u.uVel.value, P.dt);
    if (snow) { D.drift.x += Math.sin(P.t * 0.37) * 0.25 * P.dt; D.drift.z += Math.cos(P.t * 0.29) * 0.25 * P.dt; }
    D.drift.x %= 3000; D.drift.z %= 3000;
    u.uDrift.value.copy(D.drift);
    u.uT.value = P.t;
    P.cam.getWorldDirection(_f);
    u.uC.value.copy(P.cam.position).addScaledVector(_f, 0.5 * BOX[0]);
    u.uK.value = P.pxK;
    u.uSea.value = P.sea;
    u.uCol.value.copy(snow ? P.snowCol : P.rainCol);
  }

  // ---- 水花（沙地 / 门廊 / 屋顶：竖着的小冠状水花，面向镜头）+ 涟漪（水面：平放的扩散细环）。aP = 位置 + 种类，aB.x = 出生时刻
  const SPL_LIFE = 0.7;   // 每个实例的周期（s）：水花 0.4 s 后隐藏，涟漪整整 0.7 s
  const SPL_VS = `
uniform float uT; uniform float uSz; uniform vec3 uR; uniform vec3 uU;
attribute vec4 aP; attribute vec2 aB;
varying vec2 vQ; varying float vK; varying float vAge;
void main() {
  float age = clamp((uT - aB.x) / ${SPL_LIFE.toFixed(2)}, 0.0, 1.0);
  bool ring = aP.w > 0.5;
  vK = aP.w; vQ = position.xy; vAge = age;
  float s = uSz * (ring ? 0.6 : 0.24) * (0.8 + 0.4 * aB.y);
  vec3 p = ring ? aP.xyz + vec3(position.x * s, 0.015, -position.y * s)   // −y → z：从上往下看是逆时针（正面），否则被背面剔除
    : aP.xyz + uR * (position.x * s) + uU * ((position.y * 0.5 + 0.5) * s * 1.3);   // 底边贴着地面
  if (aB.x < -1e8) p = vec3(0.0, -1e5, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
  const SPL_FS = `
uniform vec4 uCs; uniform vec4 uCr;
varying vec2 vQ; varying float vK; varying float vAge;
void main() {
  float a;
  if (vK > 0.5) {                                                       // 涟漪：两圈，外圈半径 0.15 → 1，内圈晚一点、淡一点
    float r = length(vQ), R = 0.15 + 0.85 * vAge, R2 = max(0.0, R - 0.35);
    a = (1.0 - smoothstep(0.0, 0.07, abs(r - R))) + 0.55 * (1.0 - smoothstep(0.0, 0.06, abs(r - R2))) * step(0.01, R2);
    a *= (1.0 - vAge) * (1.0 - vAge) * uCr.a;
  } else {                                                              // 水花：0.4 s 内一圈小水珠向上散开再落下
    float k = vAge * 1.75; if (k >= 1.0) discard;
    vec2 q = vec2(vQ.x, vQ.y * 0.5 + 0.5);                              // q.y 0..1 从地面往上
    float best = 1e3;
    for (int i = 0; i < 5; i++) {
      float fi = float(i) - 2.0, x = fi * 0.32 * (0.35 + 0.65 * k), y = (1.0 - fi * fi * 0.12) * 3.2 * k * (1.0 - k);
      best = min(best, length((q - vec2(x, y)) * vec2(1.0, 0.8)));
    }
    float crown = (1.0 - smoothstep(0.0, 0.1, abs(length(vec2(q.x, q.y * 3.0)) - 0.25 - 0.55 * k))) * step(q.y, 0.25) * (1.0 - k);
    a = max(1.0 - smoothstep(0.06, 0.13, best), crown) * (1.0 - k * k) * uCs.a;
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(vK > 0.5 ? uCr.rgb : uCs.rgb, a);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;
  function splashes() {
    const g = quad(), aP = new Float32Array(MAX_SPL * 4), aB = new Float32Array(MAX_SPL * 2), cyc = new Float64Array(MAX_SPL).fill(-1);
    for (let i = 0; i < MAX_SPL; i++) aB[i * 2] = -1e9;
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(aP, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 2).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uSz: { value: 1 }, uR: { value: new THREE.Vector3(1, 0, 0) }, uU: { value: new THREE.Vector3(0, 1, 0) },
        uCs: { value: new THREE.Vector4(1, 1, 1, 0.6) }, uCr: { value: new THREE.Vector4(1, 1, 1, 0.4) } },
      vertexShader: SPL_VS, fragmentShader: SPL_FS, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    return { mesh: fxMesh(g, mat, 'splash', 7), mat, geo: g, aP, aB, cyc };
  }
  const _t = new THREE.Vector3();
  // 每帧：前 n 个实例按各自周期换落点（镜头注视点周围的圆盘，半径随镜头距离）；落在水面 → 涟漪
  function stepSplashes(S, amt, P) {
    const n = Math.round(MAX_SPL * Math.min(1, amt * 1.15));
    S.mesh.visible = n > 4;
    if (!S.mesh.visible) return;
    S.geo.instanceCount = n;
    P.cam.getWorldDirection(_f);   // 落点圆盘中心 = 视线和地面（y≈0）的交点，4–40 m；不依赖控制器的 target
    const dn = -_f.y, dist = dn > 0.05 ? U.clamp(P.cam.position.y / dn, 4, 40) : 20;
    const tg = _t.copy(P.cam.position).addScaledVector(_f, dist), rad = U.clamp(dist * 0.45, 6, 26);
    let dirty = false;
    for (let i = 0; i < n; i++) {
      const off = U.hash3(i, 17, 3) * SPL_LIFE, c = Math.floor((P.t + off) / SPL_LIFE);
      if (c === S.cyc[i]) continue;
      S.cyc[i] = c; dirty = true;
      const h1 = U.hash3(i, c, 11), h2 = U.hash3(i, c, 29), a = h1 * Math.PI * 2, r = rad * Math.sqrt(h2);
      const x = tg.x + Math.cos(a) * r, z = tg.z + Math.sin(a) * r, s = surf(x, z, P.roofOn);
      const j = i * 4;
      if (!s) { S.aB[i * 2] = -1e9; continue; }
      S.aP[j] = x; S.aP[j + 1] = s.y; S.aP[j + 2] = z; S.aP[j + 3] = s.water ? 1 : 0;
      S.aB[i * 2] = c * SPL_LIFE - off; S.aB[i * 2 + 1] = U.hash3(i, c, 41);
    }
    if (dirty) { S.geo.attributes.aP.needsUpdate = true; S.geo.attributes.aB.needsUpdate = true; }
    const u = S.mat.uniforms, e = P.cam.matrixWorld.elements;
    u.uT.value = P.t; u.uSz.value = U.clamp(dist / 30, 0.5, 1.6);
    u.uR.value.set(e[0], e[1], e[2]).normalize(); u.uU.value.set(0, 1, 0);
    u.uCs.value.copy(P.splCol); u.uCr.value.copy(P.ripCol);
  }

  // ---- 闪电：远处天空里一道折线（面向镜头的条带，加色混合）+ 一条分叉；0.2 s 内亮两下
  const BOLT_N = 26;   // 条带段数上限（主干 16 + 分叉 8）
  const BOLT_VS = `attribute vec2 aE; uniform float uI; varying float vS; varying float vB;
void main() { vS = aE.x; vB = aE.y * uI; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
  const BOLT_FS = `varying float vS; varying float vB;
void main() {
  float c = 1.0 - abs(vS), a = pow(c, 1.6) * vB;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(vec3(0.55, 0.65, 1.0), vec3(1.0), pow(c, 6.0)) * 6.0 * a, 1.0);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;
  function bolt() {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(BOLT_N * 4 * 3), e = new Float32Array(BOLT_N * 4 * 2), idx = [];
    for (let i = 0; i < BOLT_N; i++) { const o = i * 4; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aE', new THREE.BufferAttribute(e, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx); g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({ uniforms: { uI: { value: 0 } }, vertexShader: BOLT_VS, fragmentShader: BOLT_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { mesh: fxMesh(g, mat, 'bolt', 9), mat, geo: g, pos, e };
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _s = new THREE.Vector3(), _w = new THREE.Vector3();
  function buildBolt(B, cam, rnd) {   // 在画面上方（NDC y 0.98 → 0.25–0.5）画一道折线，放到 250 m 远处：不管镜头俯仰，总落在天上
    cam.updateMatrixWorld();
    const D = 250, ndc = (x, y) => _a.set(x, y, 0.5).unproject(cam).sub(cam.position).normalize().multiplyScalar(D).add(cam.position).clone();
    const pxM = 2 * D * Math.tan((cam.fov || 30) * Math.PI / 360) / Math.max(200, (V3.R.canvas && V3.R.canvas.height) || 800);   // 250 m 处 1 px ≈ 多少 m
    const y0 = 0.98, y1 = 0.25 + rnd() * 0.25, dr = (rnd() - 0.5) * 0.25, pts = [], br = [];
    for (let i = 0, x = rnd() * 1.3 - 0.65; i <= 16; i++) {
      if (i) x += dr / 16 + (rnd() - 0.5) * 0.035;
      pts.push({ x, y: y0 + (y1 - y0) * i / 16, w: pxM * (6 - 3 * i / 16), b: 1 });
    }
    const k = 5 + Math.floor(rnd() * 4), sg = rnd() < 0.5 ? -1 : 1;
    br.push({ x: pts[k].x, y: pts[k].y, w: pxM * 3.4, b: 0.8 });
    for (let i = 1; i <= 6; i++) br.push({ x: br[i - 1].x + sg * (0.02 + rnd() * 0.025), y: br[i - 1].y - 0.03 - rnd() * 0.02, w: pxM * (3.4 - 0.3 * i), b: 0.8 * (1 - i / 9) });
    for (const o of pts.concat(br)) o.p = ndc(o.x, o.y);
    const toC = _w.copy(cam.position).sub(pts[8].p).normalize();
    let q = 0;
    const strip = (P) => {
      for (let i = 0; i < P.length - 1 && q < BOLT_N; i++, q++) {
        const A = P[i], C = P[i + 1], sd = _s.copy(C.p).sub(A.p).cross(toC).normalize(), o = q * 4;
        [[A, -1], [A, 1], [C, -1], [C, 1]].forEach(([X, s], v) => {
          const n = (o + v) * 3, m = (o + v) * 2;
          B.pos[n] = X.p.x + sd.x * s * X.w; B.pos[n + 1] = X.p.y + sd.y * s * X.w; B.pos[n + 2] = X.p.z + sd.z * s * X.w;
          B.e[m] = s; B.e[m + 1] = X.b;
        });
      }
    };
    strip(pts); strip(br);
    B.geo.attributes.position.needsUpdate = true; B.geo.attributes.aE.needsUpdate = true;
    B.geo.setDrawRange(0, q * 6);
  }
  const env = (u) => (u < 0 ? 0 : u < 0.04 ? u / 0.04 : u < 0.08 ? 1 - 0.75 * (u - 0.04) / 0.04 : u < 0.11 ? 0.25 + 0.75 * (u - 0.08) / 0.03 : u < 0.2 ? 1 - (u - 0.11) / 0.09 : 0);

  // ---- 每帧
  const WRAP = 630;   // 着色器时钟取模（整数个水花周期），避免 float 精度
  const P = { dt: 0, t: 0, cam: null, vel: new THREE.Vector3(), sea: 0, roofOn: true, pxK: 0.0007,
    rainCol: new THREE.Vector4(), snowCol: new THREE.Vector4(), splCol: new THREE.Vector4(), ripCol: new THREE.Vector4() };
  function tick(R, dt, ctx) {
    dt = U.clamp(dt || 0, 0, 0.1);
    R.t = (R.t + dt) % WRAP;
    const cam = V3.R.camera, w = wxNow(), wd = windNow(), st = (V3.env && V3.env.state) || {};
    const ws = (wd.speed || 0) * 14 + (wd.gust || 0) * 6, dir = wd.dir || [0, -1];
    Object.assign(P, { dt, t: R.t, cam, sea: seaY(), roofOn: !ctx || !ctx.state || !ctx.state.floor || ctx.state.floor === 'all' });
    P.vel.set(dir[0] * ws, 0, dir[1] * ws);
    // 闪电：storm > 0.5 每 6–20 s 一次；wxfx …:bolt → 立刻一道，定格在最亮
    let fl = 0;
    if (pinBolt && !R.pinned) { R.pinned = true; strike(R, cam, w); }
    else if (!pinBolt && w.storm > 0.5) { if (R.next < 0) R.next = R.t + 2 + R.rng() * 6; if (R.t >= R.next) strike(R, cam, w); }
    else R.next = -1;
    if (R.pinned) fl = 1; else fl = env(R.t - R.t0) * R.amp;
    R.bolt.mat.uniforms.uI.value = fl; R.bolt.mesh.visible = fl > 0.003;
    // 颜色（线性 HDR，和场景同一量级）：天光 + 日光 + 月光算出"被照亮的水"有多亮；夜里自然变暗，闪电那一下提亮
    const sky = st.sky || {}, lu = (c) => (c ? c.r * 0.3 + c.g * 0.55 + c.b * 0.15 : 0);
    const lum = sky.horizon ? lu(sky.horizon) : 0.67, sun = sky.sun ? lu(sky.sun) : 2.2, moon = lu(sky.moon);
    const base = U.clamp(1.25 * lum + 0.25 * sun + 0.3 * moon, 0.06, 2.5) + 2.5 * fl;
    P.rainCol.set(base * 0.88, base * 0.94, base, 0.5 + 0.2 * fl);
    const sb = U.clamp(1.1 * lum + 0.45 * sun + 0.4 * moon, 0.1, 3) + 1.5 * fl;
    P.snowCol.set(0.96 * sb, 0.98 * sb, sb, 0.95);
    P.splCol.set(base * 1.2, base * 1.26, base * 1.32, 0.55);
    P.ripCol.set(base * 1.3, base * 1.36, base * 1.43, 0.7);
    P.pxK = 2 * Math.tan(((cam && cam.fov) || 30) * Math.PI / 360) / Math.max(200, (V3.R.canvas && V3.R.canvas.height) || 800);
    const want = MAX_RAIN * w.rain + MAX_SNOW * w.snow + MAX_SPL * Math.min(1, w.rain * 1.15), cap = want > CAP ? CAP / want : 1;
    stepDrops(R.rain, w.rain * cap, P); stepDrops(R.snow, w.snow * cap, P); stepSplashes(R.spl, w.rain * cap, P);
    if (perf > 0) {   // 读的是上一帧的统计（07-post 把场景 + 后期各遍累计在 renderer.info 里）
      const now = performance.now(), inf = V3.R.renderer.info.render;
      if (!pf) pf = { t0: now, last: now, n: 0, max: 0, calls: 0, tris: 0 };
      else { const d = now - pf.last; pf.n++; pf.max = Math.max(pf.max, d); pf.calls += inf.calls; pf.tris += inf.triangles; pf.last = now; }
      if (--perf === 0 && pf.n) {
        const fx = [R.rain, R.snow, R.spl].reduce((s, D) => s + (D.mesh.visible ? D.geo.instanceCount * 2 : 0), 0) + (R.bolt.mesh.visible ? R.bolt.geo.drawRange.count / 3 : 0);
        console.warn('[wx perf] frames=' + pf.n + ' avgMs=' + ((pf.last - pf.t0) / pf.n).toFixed(2) + ' maxMs=' + pf.max.toFixed(1) +
          ' draws=' + Math.round(pf.calls / pf.n) + ' tris=' + Math.round(pf.tris / pf.n) + ' wxTris=' + Math.round(fx) +
          ' wxDraws=' + [R.rain, R.snow, R.spl, R.bolt].filter((D) => D.mesh.visible).length);
        pf = null;
      }
    }
  }
  function strike(R, cam, w) {
    buildBolt(R.bolt, cam, R.rng);
    R.t0 = R.t; R.amp = 0.75 + 0.25 * R.rng();
    R.next = R.t + 6 + R.rng() * 14 * (1.5 - Math.min(1, w.storm));
    try { V3.emit('wx:flash', R.amp * Math.max(0.5, w.storm)); } catch (e) { V3.err('wx:flash: ' + ((e && e.message) || e)); }
  }

  V3.scene.part({
    id: 'wx', label: '天气', order: 35,
    build(ctx) {
      const root = new THREE.Group(); root.name = 'wx';
      const R = live = { root, t: 0, t0: -1e9, amp: 0, next: -1, pinned: false, rng: ctx.rng ? ctx.rng('wx') : U.rng(4242),
        rain: drops('rain', MAX_RAIN), snow: drops('snow', MAX_SNOW), spl: splashes(), bolt: bolt() };
      for (const m of [R.rain.mesh, R.snow.mesh, R.spl.mesh, R.bolt.mesh]) root.add(m);
      V3.parts.tag(R.rain.mesh, '天空/雨', { label: '雨' });
      V3.parts.tag(R.snow.mesh, '天空/雪', { label: '雪' });
      return root;
    },
    update(dt, t, ctx) { if (live) tick(live, dt, ctx); },
    dispose() { live = null; },   // 几何体 / 材质由 50-scene 的 dispose 统一释放
  });

  // test token wxfx=<rain|snow|storm|drizzle>[:量 0..1][:bolt]，off / 0 = 不覆盖
  V3.viewTokens.wxfx = (v) => {
    const ps = String(v || '').split(/[:,]/), k = ps[0], n = ps[1] !== undefined && ps[1] !== '' && Number.isFinite(+ps[1]) ? U.clamp(+ps[1], 0, 1) : 1;
    pinBolt = ps.includes('bolt');
    if (ps.includes('perf')) { perf = 30; pf = null; }
    if (live) live.pinned = false;
    if (!k || k === 'off' || k === '0') { force = null; return; }
    const o = k === 'rain' ? { rain: n } : k === 'drizzle' ? { rain: 0.4 * n } : k === 'snow' ? { snow: n }
      : k === 'storm' ? { rain: Math.max(0.6, n), storm: n } : null;
    force = o ? Object.assign({ kind: k, cloud: 1, rain: 0, snow: 0, storm: 0 }, o) : null;
  };
  V3.wx = { now: wxNow, set: (o) => { force = o || null; }, strike: () => { if (live && V3.R.camera) strike(live, V3.R.camera, wxNow()); } };
})(window.V3);
