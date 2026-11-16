// 18-mcthree.js — 把 16-mcmesh 的结果变成 three.js 物体：MC 式着色（贴图 × 顶点色），不做色调映射、不做颜色空间转换
(function (V3) {
  'use strict';
  const T3 = V3.mcthree = {};
  T3.MC_FOV = 70;          // options.txt fov:0.0 → 70°（竖直视野）
  T3.SPECTATOR_FOV = 77;   // 旁观模式一直在飞：70 × 1.1
  T3.EYE = 1.62;           // 站立眼睛高度
  T3.NEAR = 0.05;
  T3.MIP_LEVELS = 4;       // options mipmapLevels:4

  // MC 的渲染：画面颜色 = 贴图颜色 × 顶点颜色（染色 × 方向明暗 × AO），直接写进画面，不做 gamma/色调映射
  T3.renderer = function (canvas, opts = {}) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: !!opts.antialias, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
    r.toneMapping = THREE.NoToneMapping;
    if ('outputColorSpace' in r) r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.setPixelRatio(1);
    r.setClearColor(0x000000, 0);
    return r;
  };

  T3.atlasTexture = function (atlas, opts = {}) {
    const n = Math.max(0, opts.mipLevels == null ? T3.MIP_LEVELS : opts.mipLevels);
    const lv = atlas.levels.slice(0, n + 1);
    const tex = new THREE.DataTexture(lv[0], atlas.width, atlas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    // 和 MC 26.1 一样：采样器本身是线性 + mipmap（LevelRenderer 的 chunkLayerSampler），
    // 「像素风」靠着色器里的 sampleNearest（只在贴图像素交界处混一个屏幕像素宽）
    if (lv.length > 1) {
      tex.mipmaps = lv.map((data, i) => ({ data, width: Math.max(1, atlas.width >> i), height: Math.max(1, atlas.height >> i) }));
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    } else tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false; tex.flipY = false; tex.unpackAlignment = 1;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  };

  // 雾：和 MC 的 fog.glsl 一样，球面距离（环境雾）和柱面距离（渲染距离雾）各算一个比例，取大的，最后和雾色混合
  const VS = [
    'attribute vec2 mcuv; attribute vec3 mccol;',
    'varying vec2 vUv; varying vec3 vCol; varying float vSph; varying float vCyl;',
    'void main() {',
    '  vUv = mcuv; vCol = mccol;',
    '  vec3 rel = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;',
    '  vSph = length(rel); vCyl = max(length(rel.xz), abs(rel.y));',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n');
  const FS = [
    'uniform sampler2D map; uniform float cutoff; uniform float bright; uniform float keepAlpha; uniform float nearest;',
    'uniform float fogOn; uniform vec3 fogColor; uniform vec4 fogRange;',
    'varying vec2 vUv; varying vec3 vCol; varying float vSph; varying float vCyl;',
    'float lin(float d, float a, float b) { return d <= a ? 0.0 : (d >= b ? 1.0 : (d - a) / (b - a)); }',
    // 照 MC 的 terrain.fsh 的 sampleNearest：先找最近的贴图像素交界，按「一个贴图像素占几个屏幕像素」把偏移往像素中心收，
    // 再用原来的导数（选 mipmap 级）去取。WebGL1 没有 textureGrad，退回普通取样。
    '#if __VERSION__ >= 300',
    'vec4 mcSample(sampler2D s, vec2 uv) {',
    '  vec2 px = 1.0 / vec2(textureSize(s, 0));',
    // 实体（箱子、床）：MC 的实体图集不做 mipmap、最近点采样 → 直接取第 0 级最近的像素
    '  if (nearest > 0.5) return texelFetch(s, clamp(ivec2(floor(uv / px)), ivec2(0), textureSize(s, 0) - 1), 0);',
    '  vec2 du = dFdx(uv), dv = dFdy(uv);',
    '  vec2 ts = max(sqrt(du * du + dv * dv), vec2(1e-8));',
    '  vec2 t = uv / px; vec2 ctr = floor(t + 0.5) - 0.5; vec2 off = t - ctr;',
    '  off = clamp((off - 0.5) * px / ts + 0.5, 0.0, 1.0);',
    '  return textureGrad(s, (ctr + off) * px, du, dv);',
    '}',
    '#else',
    'vec4 mcSample(sampler2D s, vec2 uv) { return texture2D(s, uv); }',
    '#endif',
    'void main() {',
    '  vec4 c = mcSample(map, vUv);',
    '  if (c.a < cutoff) discard;',
    '  vec3 col = c.rgb * vCol * bright;',
    '  if (fogOn > 0.5) col = mix(col, fogColor, max(lin(vSph, fogRange.x, fogRange.y), lin(vCyl, fogRange.z, fogRange.w)));',
    '  gl_FragColor = vec4(col, keepAlpha > 0.5 ? c.a : 1.0);',
    '}',
  ].join('\n');

  // 四层：实心（不丢像素）、镂空（alpha < 0.5 丢掉）、半透明（alpha 混合、从远到近排序）、
  // 实体（箱子、床：最近点采样、不用 mipmap、alpha < 0.1 丢掉，MC 的 entityCutoutCull）。
  // opts.fog = mcmesh 的 env.fog（{color,start,end,rdStart,rdEnd}）就加 MC 那样的白天雾，null/false 不加
  T3.materials = function (tex, opts = {}) {
    const fog = opts.fog || null;
    const mk = (cutoff, keepAlpha, extra, nearest = 0) => new THREE.ShaderMaterial(Object.assign({
      uniforms: {
        map: { value: tex }, cutoff: { value: cutoff }, bright: { value: opts.bright == null ? 1 : opts.bright }, keepAlpha: { value: keepAlpha },
        nearest: { value: nearest },
        fogOn: { value: fog ? 1 : 0 }, fogColor: { value: new THREE.Vector3(...(fog ? fog.color : [1, 1, 1])) },
        fogRange: { value: new THREE.Vector4(...(fog ? [fog.start, fog.end, fog.rdStart, fog.rdEnd] : [0, 1, 0, 1])) },
      },
      vertexShader: VS, fragmentShader: FS, side: THREE.FrontSide,
    }, extra));
    return { solid: mk(-1, 0, {}), cutout: mk(0.5, 0, {}), entity: mk(0.1, 0, {}, 1), translucent: mk(0.01, 1, { transparent: true, depthWrite: true }) };
  };

  // 加载时不碰 THREE（要用时才建），这样别的页面只是多带了代码，不会多做事
  let tmpV = null;
  T3.sortTranslucent = function (mesh, cam) {
    const L = mesh.userData.layer, n = L.quads;
    if (n < 2) return;
    if (!tmpV) tmpV = new THREE.Vector3();
    tmpV.setFromMatrixPosition(cam.matrixWorld);
    mesh.worldToLocal(tmpV);
    const key = tmpV.x.toFixed(2) + ',' + tmpV.y.toFixed(2) + ',' + tmpV.z.toFixed(2);
    if (mesh.userData.sortKey === key) return;
    mesh.userData.sortKey = key;
    const c = L.centers, d = new Float32Array(n), ord = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const dx = c[i * 3] - tmpV.x, dy = c[i * 3 + 1] - tmpV.y, dz = c[i * 3 + 2] - tmpV.z;
      d[i] = dx * dx + dy * dy + dz * dz; ord[i] = i;
    }
    ord.sort((a, b) => d[b] - d[a]);
    const idx = mesh.geometry.index.array;
    for (let i = 0; i < n; i++) {
      const q = ord[i] * 4, o = i * 6;
      idx[o] = q; idx[o + 1] = q + 1; idx[o + 2] = q + 2; idx[o + 3] = q; idx[o + 4] = q + 2; idx[o + 5] = q + 3;
    }
    mesh.geometry.index.needsUpdate = true;
  };

  // res = V3.mcmesh.build(...) 的结果 → THREE.Group（坐标：格子 (0,0,0) 的角在原点，1 格 = 1 单位）
  // opts.fog：true = 用 res.env.fog（jar 里读到的雾色）；对象 = 直接用；不给 = 不加雾
  T3.group = function (res, opts = {}) {
    const tex = T3.atlasTexture(res.atlas, opts);
    const fog = opts.fog === true ? (res.env && res.env.fog) || null : opts.fog || null;
    const mats = T3.materials(tex, Object.assign({}, opts, { fog }));
    const g = new THREE.Group();
    g.name = 'mc-blocks';
    let order = 0;
    for (const k of ['solid', 'cutout', 'entity', 'translucent']) {
      const L = res.layers[k];
      if (!L || !L.quads) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(L.position, 3));
      geo.setAttribute('mcuv', new THREE.BufferAttribute(L.uv, 2));
      geo.setAttribute('mccol', new THREE.BufferAttribute(L.color, 3));
      geo.setIndex(new THREE.BufferAttribute(L.index, 1));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mats[k]);
      m.name = k; m.renderOrder = ++order; m.frustumCulled = false;
      if (k === 'translucent') { m.userData.layer = L; m.onBeforeRender = (r, s, cam) => T3.sortTranslucent(m, cam); }
      g.add(m);
    }
    g.userData = { tex, mats, res };
    return g;
  };

  T3.setBright = function (g, v) { for (const m of Object.values(g.userData.mats || {})) m.uniforms.bright.value = v; };

  T3.dispose = function (g) {
    if (!g) return;
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of Object.values(g.userData.mats || {})) m.dispose();
    if (g.userData.tex) g.userData.tex.dispose();
    if (g.parent) g.parent.remove(g);
  };

  // MC 相机。o.pos = 脚下的世界坐标；o.origin = 模型格子 (0,0,0) 的世界坐标；yaw 0 朝南(+z)、90 朝西；pitch 正值低头
  T3.placeCamera = function (cam, o) {
    const org = o.origin || [0, 0, 0];
    cam.fov = o.fov || T3.MC_FOV;
    cam.near = o.near || T3.NEAR; cam.far = o.far || 512;
    if (o.aspect) cam.aspect = o.aspect;
    cam.position.set(o.pos[0] - org[0], o.pos[1] + (o.eye == null ? T3.EYE : o.eye) - org[1], o.pos[2] - org[2]);
    const yaw = (o.yaw || 0) * Math.PI / 180, pitch = (o.pitch || 0) * Math.PI / 180;
    cam.rotation.set(-pitch, Math.PI - yaw, 0, 'YXZ');
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  };
})(window.V3);
