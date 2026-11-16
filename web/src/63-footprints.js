// src/63-footprints.js — 场景部件 footprints（order 63）：她在沙上走留下的小脚印。
// 一个 InstancedMesh（最多 300 个，满了换掉最旧的），贴在沙面上 2 mm，相乘混合（把下面的沙压暗一点，边上一圈更暗）。
// 干沙上 60 s 后开始变淡，约 3 分钟没了；湿沙上浪前沿（V3.water.frontD）扫过就在 0.4 s 内抹掉（没浪来 4 分钟也会干掉）。
// 门廊、台阶的木板、地垫和水里不放（V3.nav.surface 只认 sand / wet）。
// 导出 V3.footprints = { step(x, z, ry, foot 'L'|'R') → 槽位|-1, clear(), count(), visible(bool) }。
// ry 和 65-girl-actor 一样：前进方向 = (sin ry, cos ry)；脚尖朝本地 +z。贴图是右脚（大脚趾在本地 +x），左脚沿本地 x 镜像。
// 调试 token：fpDemo（从台阶前一路走到海边）、fpAge=秒（所有脚印老化 N 秒，看变淡）。
(function (V3) {
  'use strict';
  const U = V3.util, L = V3.layout;
  const MAX = 300, FW = 0.085, FL = 0.19, LIFT = 0.002;
  const DRY = { hold: 60, fade: 120 }, WET = { erase: 0.4, dry: 240 };
  let M = null, AT = null, clock = 0, slot = 0, used = 0, lastF = null;
  const PX = new Float32Array(MAX), PZ = new Float32Array(MAX);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  // ---- 脚印贴图（右脚，脚跟在 v=0，脚尖在 v=1，内侧 / 大脚趾在 +u）：R = 压下去的面积（软边），G = 外面一圈被挤起的沙，B = 越靠中间越深
  let TEX = null;
  function footTex() {
    if (TEX) return TEX;
    const W = 32, H = 64, d = new Uint8Array(W * H * 4), a = new Float32Array(W * H);
    const ell = (u, v, cu, cv, ru, rv) => 1 - Math.hypot((u - cu) / ru, (v - cv) / rv);   // > 0 在椭圆里
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W - 0.5, v = (j + 0.5) / H;
      let s = Math.max(ell(u, v, 0.0, 0.20, 0.27, 0.14),                  // 脚跟
        ell(u, v, 0.02, 0.62, 0.38, 0.17),                                // 前脚掌
        ell(u, v, -0.17, 0.40, 0.17, 0.22));                              // 外侧足弓（内侧是空的）
      const T = [[0.21, 0.88, 0.12, 0.075], [0.05, 0.905, 0.075, 0.055], [-0.07, 0.895, 0.065, 0.05], [-0.17, 0.87, 0.058, 0.045], [-0.26, 0.835, 0.05, 0.04]];
      for (const t of T) s = Math.max(s, ell(u, v, t[0], t[1], t[2], t[3]));
      a[j * W + i] = U.clamp(s * 6, 0, 1);
    }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let m = 0, c = 0;                                                   // 周围 7×7 的平均：边上一圈 rim
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) { c++; continue; }
        m += a[jj * W + ii]; c++;
      }
      const s = a[j * W + i], av = m / c, rim = U.clamp(av * 2.2, 0, 1) * (1 - s), k = (j * W + i) * 4;
      d[k] = Math.round(s * 255); d[k + 1] = Math.round(rim * 255); d[k + 2] = Math.round(s * U.clamp(av * 1.3, 0, 1) * 255); d[k + 3] = 255;
    }
    TEX = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
    TEX.magFilter = THREE.LinearFilter; TEX.minFilter = THREE.LinearMipmapLinearFilter; TEX.generateMipmaps = true; TEX.needsUpdate = true;   // 远处走 mip，不闪
    TEX.userData.shared = true;
    return TEX;
  }
  // 一块平放的四边形，脚尖朝 +z，略大一圈给 rim 留地方
  function quad() {
    const w = FW * 0.66, l = FL * 0.6, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, -l, w, 0, -l, w, 0, l, -w, 0, l], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    return g;
  }
  // ---- 材质：相乘混合 dst × c（c ≤ 1）。干沙：踩下去的地方压暗、外圈挤起的沙再暗一点，远处按像素大小加深；湿沙：更深、偏暖
  const QW = FW * 0.66, QL = FL * 0.6, f = (n) => n.toFixed(4);
  function mat() {
    return new THREE.ShaderMaterial({
      uniforms: { uMap: { value: footTex() }, uT: { value: 0 } },
      vertexShader: `
        attribute vec4 aFp;                  // x = 出生时刻 s, y = 被浪抹掉的时刻（< 0 没有）, z = 湿 1 / 干 0, w = 随机 0..1
        uniform float uT;
        varying vec2 vUv; varying float vA; varying float vWet; varying float vR;
        void main() {
          float age = uT - aFp.x;
          float a = aFp.z > 0.5 ? 1.0 - smoothstep(${f(WET.dry - 30)}, ${f(WET.dry)}, age)
                                : 1.0 - smoothstep(${f(DRY.hold)}, ${f(DRY.hold + DRY.fade)}, age);
          if (aFp.y >= 0.0) a *= 1.0 - smoothstep(0.0, ${f(WET.erase)}, uT - aFp.y);
          a *= smoothstep(0.0, 0.15, age);
          if (a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // 看不见的：挪出视锥
          vA = a; vWet = aFp.z; vR = aFp.w;
          vUv = vec2(position.x / ${f(2 * QW)} + 0.5, position.z / ${f(2 * QL)} + 0.5);
          vec4 p = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * p;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec2 vUv; varying float vA; varying float vWet; varying float vR;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          if (max(t.r, t.g) * vA < 0.004) discard;
          // 线性光里压暗：干沙中心约 50%（比初版深 30%）/ 湿沙约 50%，色调整体后屏幕上约 25% 的暗印；蓝通道压得多一点 → 偏暖褐
          vec3 dry = vec3(0.35, 0.38, 0.43) * t.r + vec3(0.10, 0.12, 0.13) * t.b + vec3(0.12, 0.13, 0.14) * t.g;
          vec3 wet = vec3(0.36, 0.38, 0.42) * t.r + vec3(0.10, 0.10, 0.10) * t.b + vec3(0.05, 0.05, 0.06) * t.g;
          // 远处一个脚印只占几个像素，mip 把脚形和空白一起平均会变浅：按每像素覆盖的纹素数补回来（只补干沙，最多 ×1.8）
          float far = clamp(log2(max(fwidth(vUv.x) * 32.0, fwidth(vUv.y) * 64.0)) / 3.0, 0.0, 1.0);
          dry *= 1.0 + 0.8 * far;
          vec3 dark = min(mix(dry, wet, vWet) * (0.85 + 0.3 * vR), vec3(0.75));
          gl_FragColor = vec4(vec3(1.0) - dark * vA, 1.0);
        }`,
      transparent: true, depthWrite: false, depthTest: true, toneMapped: false, fog: false,
      extensions: { derivatives: true },                                  // fwidth（WebGL2 自带，WebGL1 要开扩展）
      side: THREE.DoubleSide,                                             // 左脚是镜像（scale.x = −1），三角形绕向反了
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
  }

  // ---- 放脚印：只在沙 / 湿沙上（门廊、台阶、屋里、地垫、水里都不放）
  const OUT = id => (L.outside || []).find(o => o.id === id);
  const inR = (r, x, z, m) => !!r && x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
  const onBoards = (x, z) => inR(L.porch, x, z, 0.05) || inR(L.porch && L.porch.steps, x, z, 0.1) || inR(L.house, x, z, 0.05) || inR(OUT('stepMat'), x, z, 0.05);
  function surf(x, z) {
    const N = V3.nav, T = V3.terrain;
    if (N && N.surface) { try { const s = N.surface(x, z); return s === 'sand' || s === 'wet' ? s : null; } catch (e) { /* 用下面的判断 */ } }
    if (onBoards(x, z) || (T && T.depthAt && T.depthAt(x, z) > 0.02)) return null;
    return T && T.isWet && T.isWet(x, z) ? 'wet' : 'sand';
  }
  const PS = new Float32Array(MAX);                                       // 放下时那一列的岸线 z（浪扫过的判断用）
  function step(x, z, ry, foot) {
    if (!M || !Number.isFinite(x) || !Number.isFinite(z)) return -1;
    const s = surf(x, z); if (!s) return -1;
    const T = V3.terrain, wet = s === 'wet' || !!(T && T.isWet && T.isWet(x, z));
    const i = slot; slot = (slot + 1) % MAX; used = Math.min(MAX, used + 1);
    v3.set(x, (T ? T.groundY(x, z) : 0) + LIFT, z); q.setFromAxisAngle(up, ry || 0); s3.set(foot === 'L' ? -1 : 1, 1, 1);
    M.setMatrixAt(i, m4.compose(v3, q, s3)); M.instanceMatrix.needsUpdate = true;
    PX[i] = x; PZ[i] = z; PS[i] = T ? T.shoreZ(x) : 1e9;
    AT.setXYZW(i, clock, -1, wet ? 1 : 0, U.hash3(i, Math.floor(clock * 10), 7)); AT.needsUpdate = true;
    return i;
  }
  const alive = (i) => {
    const k = AT.getY(i), age = clock - AT.getX(i);
    if (k >= 0 && clock - k > WET.erase) return false;
    return age < (AT.getZ(i) > 0.5 ? WET.dry : DRY.hold + DRY.fade);
  };
  function clear() {
    if (!AT) return;
    for (let i = 0; i < MAX; i++) AT.setXYZW(i, -1e6, -1, 0, 0);
    AT.needsUpdate = true; used = slot = 0;
  }

  // ---- 场景部件：每帧推进时钟；浪前沿（V3.water.frontD）扫过的脚印在 0.4 s 内抹掉（干沙上的大浪也算）
  V3.scene.part({
    id: 'footprints', label: '脚印', order: 63,
    build() {
      const g = quad();
      AT = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
      AT.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aFp', AT);
      M = new THREE.InstancedMesh(g, mat(), MAX);
      M.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      M.name = 'footprints'; M.frustumCulled = false; M.renderOrder = 0.5; M.raycast = () => {};
      Object.assign(M.userData, { anchor: 'house2:footprints', layer: 'site', noPick: true, noShadow: true, noReceive: true });
      V3.parts.declare(['场地/脚印'], { '场地/脚印': '脚印' });
      V3.parts.tag(M, '场地/脚印', { label: '脚印' });
      clock = 0; clear();
      return M;
    },
    update(dt) {
      if (!M) return;
      clock += Math.min(Math.max(dt || 0, 0), 1);
      M.material.uniforms.uT.value = clock;
      const W = V3.water; if (!W || !W.frontD || !used) return;
      let ch = false;
      for (let i = 0; i < used; i++) {
        if (AT.getY(i) >= 0 || PS[i] - PZ[i] > 2.9) continue;              // 已经抹掉了 / 浪永远到不了
        if (PS[i] - W.frontD(PX[i]) <= PZ[i] && alive(i)) { AT.setY(i, clock); ch = true; }
      }
      if (ch) AT.needsUpdate = true;
    },
    // InstancedMesh 的 instanceMatrix 是网格自己的显存，场景收尾只释放几何体 / 材质：这里 dispose 网格（只放实例缓冲；几何体、材质留给场景收尾，脚印贴图是共用的，不放）
    dispose() { if (M) M.dispose(); M = null; AT = null; used = slot = 0; V3.parts.reset('场地/脚印'); },
  });

  V3.footprints = {
    step, clear,
    count: () => { let n = 0; if (AT) for (let i = 0; i < used; i++) if (alive(i)) n++; return n; },
    visible: (v) => { if (M) M.visible = v !== false; },
  };

  // ---- 调试 token：fpDemo = 从台阶前一路走到海边（左右脚交替，步长 0.32 m）；fpAge=秒 = 所有脚印老化 N 秒
  V3.viewTokens = V3.viewTokens || {};
  V3.viewTokens.fpDemo = () => {
    const st = (L.porch && L.porch.steps) || { x0: -3, x1: -1, z1: -2.5 }, T = V3.terrain;
    const x0 = (st.x0 + st.x1) / 2 + 0.6, zEnd = T ? T.shoreZ(x0) + 0.2 : 12;
    let n = 0, k = 0;
    for (let z = st.z1 + 1.2; z < zEnd; z += 0.32, k++) {
      const x = x0 + Math.sin(z * 0.35) * 0.6, ry = Math.atan2(Math.cos(z * 0.35) * 0.21, 1), s = (k & 1) ? -0.07 : 0.07;
      if (step(x + Math.cos(ry) * s, z - Math.sin(ry) * s, ry, (k & 1) ? 'R' : 'L') >= 0) n++;
    }
    return n;
  };
  V3.viewTokens.fpAge = (v) => {
    const s = parseFloat(v) || 0; if (!AT) return;
    for (let i = 0; i < used; i++) AT.setX(i, AT.getX(i) - s);
    AT.needsUpdate = true;
  };
})(window.V3);
