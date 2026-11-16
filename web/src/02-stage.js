// 02-stage.js — studio stage: lighting presets, gradient background, pedestal, turntable.
(function (V3) {
  'use strict';
  const S = V3.stage = {
    presets: [{ id: 'studio', label: '工作室' }, { id: 'day', label: '白天' }, { id: 'golden', label: '黄昏' }, { id: 'night', label: '夜晚' }],
    preset: null, spin: false, ground: null,
  };
  // hemi [sky, ground, i]; key/fill/rim [color, intensity, [x,y,z]]
  const PRE = {
    studio: { bg: ['#f3f5f9', '#cfd5df'], hemi: [0xf2f5ff, 0xa89a8c, 0.8], key: [0xfff1e0, 1.8, [1.6, 3.2, 2.4]],
      fill: [0xd4e2ff, 0.5, [-2.8, 1.2, 1.6]], rim: [0xe0ecff, 1.0, [-1.0, 2.2, -3.0]], exp: 1.05, ped: 0xe4e1db },
    day: { bg: ['#9fd6ff', '#e8f6ff'], hemi: [0xbfe3ff, 0xe9d7b0, 0.9], key: [0xfff6e4, 2.0, [2.0, 4.0, 1.6]],
      fill: [0xbfdcff, 0.45, [-2.6, 1.4, 1.2]], rim: [0xffffff, 0.7, [-0.8, 2.4, -3.0]], exp: 1.0, ped: 0xead9b4 },
    golden: { bg: ['#6f5aa8', '#ffb37a'], hemi: [0xd9b8ff, 0x8a6a58, 0.65], key: [0xffb46b, 2.3, [-3.2, 1.3, 1.8]],
      fill: [0x9f8cff, 0.55, [2.6, 1.2, 1.4]], rim: [0xff9fb8, 1.1, [1.0, 1.8, -3.0]], exp: 1.05, ped: 0xd8b98e },
    night: { bg: ['#0b1230', '#26345e'], hemi: [0x4a5c9a, 0x1a1a24, 0.45], key: [0xbcd0ff, 0.9, [-2.0, 3.4, 1.4]],
      fill: [0xffb066, 0.9, [2.0, 0.9, 1.6]], rim: [0x8fb4ff, 0.9, [0.6, 2.0, -3.0]], exp: 1.15, ped: 0x5a5f72 },
  };

  const gradTex = (top, bot) => {
    const c = document.createElement('canvas'); c.width = 2; c.height = 256;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  V3.on('init', (R) => {
    const sc = R.scene;
    const hemi = S.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.8);
    const mk = () => { const l = new THREE.DirectionalLight(0xffffff, 1); sc.add(l, l.target); l.target.position.set(0, 0.6, 0); return l; };
    const key = S.key = mk(), fill = S.fill = mk(), rim = S.rim = mk();
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -1.3, right: 1.3, top: 1.6, bottom: -0.6, near: 0.5, far: 12 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012;
    sc.add(hemi);

    // pedestal: round disc with a darker rim, top at y = 0
    const ped = S.ground = new THREE.Group(); ped.name = 'pedestal';
    const topM = S.pedMat = new THREE.MeshStandardMaterial({ color: 0xe4e1db, roughness: 0.92 });
    const rimM = new THREE.MeshStandardMaterial({ color: 0x9aa2b2, roughness: 0.8 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.04, 64), topM); top.position.y = -0.02;
    const rimMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.78, 0.06, 64), rimM); rimMesh.position.y = -0.07;
    top.receiveShadow = true; rimMesh.receiveShadow = true;
    ped.add(top, rimMesh);
    const catcher = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.ShadowMaterial({ opacity: 0.18 }));
    catcher.rotation.x = -Math.PI / 2; catcher.position.y = -0.1; catcher.receiveShadow = true;
    ped.add(catcher);
    ped.traverse(o => { o.userData.noPick = true; });
    sc.add(ped);
    S.setPreset(V3.util.qs('light', 'studio'));
  });

  S.setPreset = (id) => {
    const p = PRE[id] || PRE.studio, R = V3.R;
    S.preset = PRE[id] ? id : 'studio';
    if (S.own) { V3.emit('stage', S.preset); return; }   // the model owns lights + sky; it may map the preset itself
    S.hemi.color.set(p.hemi[0]); S.hemi.groundColor.set(p.hemi[1]); S.hemi.intensity = p.hemi[2];
    for (const [l, d] of [[S.key, p.key], [S.fill, p.fill], [S.rim, p.rim]]) {
      l.color.set(d[0]); l.intensity = d[1]; l.position.set(...d[2]).multiplyScalar(S.k).add(S.c);
      l.target.position.copy(S.c);
    }
    if (R.scene.background && R.scene.background.dispose) R.scene.background.dispose();
    R.scene.background = gradTex(p.bg[0], p.bg[1]);
    R.renderer.toneMappingExposure = p.exp;
    S.pedMat.color.set(p.ped);
    V3.emit('stage', S.preset);
  };
  S.setBg = (top, bot) => { V3.R.scene.background = gradTex(top, bot || top); };
  S.turntable = (on) => { S.spin = on == null ? !S.spin : !!on; return S.spin; };
  // fit lights / shadow box / camera range to the model:
  // inst.stage = { pedestal, size (m), center [x,y,z], lights } — lights:false = the model brings its own
  // lights, sky and exposure (stage lights hidden, background left to the model)
  S.k = 1; S.c = new THREE.Vector3(0, 0.6, 0); S.own = false;
  S.fit = (inst) => {
    const st = (inst && inst.stage) || {}, R = V3.R;
    S.own = st.lights === false;
    for (const l of [S.hemi, S.key, S.fill, S.rim]) l.visible = !S.own;
    if (S.own && R.scene.background && R.scene.background.dispose) R.scene.background.dispose();
    if (S.own) R.scene.background = null;
    S.k = (st.size || 1.3) / 1.3;
    S.c = new THREE.Vector3(...(st.center || [0, 0.6, 0]));
    if (S.ground) S.ground.visible = st.pedestal !== false;
    const k = S.k, big = k > 3, h = 1.3 * k, sc = S.key.shadow.camera;
    Object.assign(sc, big ? { left: -h, right: h, top: h, bottom: -h, near: 1, far: 10 * h }
      : { left: -1.3, right: 1.3, top: 1.6, bottom: -0.6, near: 0.5, far: 12 });
    sc.updateProjectionMatrix();
    S.key.shadow.normalBias = 0.012 * Math.sqrt(k);
    R.camera.near = big ? 0.1 : 0.02; R.camera.updateProjectionMatrix();
    R.ctl.maxDist = Math.max(60, 4 * (st.size || 1.3));
    S.setPreset(S.preset || 'studio');
  };
  V3.on('model', (inst) => {
    V3.R.post = (inst && typeof inst.post === 'function') ? inst.post : null;   // per-model post pipeline
    S.fit(inst);
    const vs = inst && inst.views, first = vs && Object.keys(vs)[0];
    if (first) V3.R.ctl.set(vs[first], false);
  });
  V3.on('frame', (dt) => {
    const m = V3.models.current();
    if (S.spin && m && m.root) m.root.rotation.y += dt * 0.6;
  });
})(window.V3);
