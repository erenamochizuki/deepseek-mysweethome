// 50-scene.js — the game scene framework (lead; model id stays 'house2' so old feedback and view tokens keep working). Parts register with V3.scene.part(); the 'house2' model
// builds them in order, owns time / floor states, the cutaway, lamps + glow materials and the post hook.
// Contract: docs/SPEC-3.md §4–§6.
(function (V3) {
  'use strict';
  const U = V3.util;
  const SC = V3.scene = V3.scene || {};
  const parts = SC.parts = SC.parts || [];

  // ---- part registry ----
  SC.part = (def) => {
    if (!def || !def.id || typeof def.build !== 'function') { V3.err('scene.part: bad part ' + (def && def.id)); return; }
    const i = parts.findIndex(p => p.id === def.id);
    if (i >= 0) parts[i] = def; else parts.push(def);
    parts.sort((a, b) => (a.order || 0) - (b.order || 0));
    return def;
  };

  SC.TIMES = [['golden', '黄昏'], ['dawn', '清晨'], ['morning', '上午'], ['noon', '中午'], ['dusk', '傍晚'], ['night', '夜晚'], ['real', '实时']];
  SC.FLOORS = [['all', '外观'], ['ground', '一楼'], ['loft', '阁楼']];
  // 天气：'real' = 按 L.sky 的经纬度取真实天气（Open-Meteo），其余是手动指定。由 V3.env.setWeather(v) 实现（sky 负责）。
  SC.WEATHERS = [['real', '实时天气'], ['clear', '晴'], ['cloudy', '多云'], ['overcast', '阴'], ['fog', '雾'], ['drizzle', '小雨'], ['rain', '大雨'], ['storm', '雷雨'], ['snow', '雪']];
  SC.MAX_LAMPS = 8;

  const strSeed = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

  // lamp factor: 0 in daylight … 1 at night (golden hour already glows a little)
  SC.lampK = () => {
    const st = V3.env && V3.env.state;
    if (!st) return SC.fallbackK == null ? 0.35 : SC.fallbackK;
    return U.clamp(Math.max(st.night || 0, 0.65 * (st.golden || 0)), 0, 1);   // golden: glow ≈ 1.7, reads against sunlit walls
  };

  // tickLights 每帧都跑（开关灯时也跑）：下面这几样反复用，一帧里不新建数组 / Map / Set / 向量。
  const _lampP = new THREE.Vector3(), _lampAct = [], _lampDist = [];
  const lampShown = (l) => { for (let p = l.parent; p; p = p.parent) if (!p.visible) return false; return true; };

  // ---- build context (also usable by catalog models: V3.scene.ctx(root, { studio: true })) ----
  SC.ctx = (root, opts = {}) => {
    const lamps = [], glows = [], waits = [];
    const ctx = {
      THREE, L: V3.layout, root, state: opts.state || {}, studio: !!opts.studio,
      get env() { return V3.env; },
      rng: (seed) => U.rng(typeof seed === 'number' ? seed : strSeed(seed)),
      lamp(o = {}) {
        // 可交互灯保留独立对象，tickLights 按距离选择渲染预算；普通装饰灯沿用原来的上限。
        if (!o.switchable && lamps.filter(l => !l.userData.switchable).length >= SC.MAX_LAMPS) return null;
        const l = new THREE.PointLight(o.color != null ? o.color : 0xffb35c, 0, o.distance != null ? o.distance : 6, o.decay != null ? o.decay : 2);
        l.position.set(...(o.pos || [0, 1, 0]));
        l.castShadow = false;
        l.userData.base = o.intensity != null ? o.intensity : 2;     // night exposure ≈ 3.1 → 2 is enough (sky)
        l.userData.noPick = true;
        l.userData.switchable = !!o.switchable;
        l.userData.lightEnabled = o.enabled !== false;
        lamps.push(l);
        if (o.keepWhenCut && o.parent) {
          l.userData.cutAnchor = o.parent;
          l.userData.cutPosition = l.position.clone();
          root.add(l);   // 灯具剖掉时光源仍属于场景，位置每帧跟随原支架。
        } else (o.parent || root).add(l);
        return l;
      },
      glowMat(hex, o = {}) {
        const m = new THREE.MeshStandardMaterial({
          color: hex, emissive: hex, emissiveIntensity: 0, roughness: 0.6, metalness: 0,
          vertexColors: !!o.vertexColors, transparent: !!o.transparent, opacity: o.opacity != null ? o.opacity : 1,
        });
        m.userData.glow = { day: o.day != null ? o.day : 0.15, night: o.night != null ? o.night : 2.5 };
        glows.push(m);
        return m;
      },
      // 开关是独立乘子：调亮度、日夜变化都不会把关掉的灯重新点亮。
      setLightEnabled(target, enabled) {
        if (!target || !target.userData) return false;
        target.userData.lightEnabled = !!enabled;
        ctx.tickLights();
        return true;
      },
      releaseLamp(l) {
        const i = lamps.indexOf(l); if (i < 0) return;
        lamps.splice(i, 1); l.removeFromParent(); l.dispose();
      },
      releaseGlow(m) { const i = glows.indexOf(m); if (i >= 0) glows.splice(i, 1); },
      // 每盏灯有自己的开关/强度；同屏点光最多 MAX_LAMPS，优先照亮镜头附近。
      tickLights() {
        const k = SC.lampK(), camera = V3.R && V3.R.camera, cp = camera && camera.position, max = SC.MAX_LAMPS;
        const act = _lampAct, dist = _lampDist;
        let n = 0;
        for (let i = 0; i < lamps.length; i++) {
          const u = lamps[i].userData;
          if (u.cutAnchor) lamps[i].position.copy(root.worldToLocal(u.cutAnchor.localToWorld(_lampP.copy(u.cutPosition))));
        }
        for (let i = 0; i < lamps.length; i++) {
          const l = lamps[i];
          if (l.userData.lightEnabled !== false && l.userData.base > 0 && lampShown(l)) act[n++] = l;
        }
        if (cp && n > max) {
          for (let i = 0; i < n; i++) dist[i] = act[i].getWorldPosition(_lampP).distanceToSquared(cp);
          // 插入排序，和原来的 Array.sort 一样稳定：一样远的按登记顺序，选出来的灯和以前一模一样
          for (let i = 1; i < n; i++) {
            const l = act[i], d = dist[i];
            let j = i - 1;
            for (; j >= 0 && dist[j] > d; j--) { act[j + 1] = act[j]; dist[j + 1] = dist[j]; }
            act[j + 1] = l; dist[j + 1] = d;
          }
        }
        for (let i = 0; i < lamps.length; i++) { lamps[i].visible = false; lamps[i].intensity = 0; }
        for (let i = 0; i < n; i++) {
          if (i < max) { act[i].visible = true; act[i].intensity = act[i].userData.base * k * (ctx.studio ? 0.4 : 1); }
          act[i] = null;   // 不留着已经放掉的灯
        }
        for (let i = 0; i < glows.length; i++) {
          const m = glows[i];
          m.emissiveIntensity = m.userData.lightEnabled === false ? 0 : U.lerp(m.userData.glow.day, m.userData.glow.night, k);
        }
      },
      // 异步画的部件（54-house-mc 的方块房子）：ctx.wait(promise) → 模型的 ready 等它（V3.waitReady / V3.view 截图前会等）
      wait(p) { if (p && typeof p.then === 'function') waits.push(p); },
      _lamps: lamps, _glows: glows, _waits: waits,
    };
    return ctx;
  };

  // temporary light when no 'sky' part built (lets one part be tested alone)
  const fallbackLights = (root) => {
    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0xd9b98a, 0.9);
    const sun = new THREE.DirectionalLight(0xffd2a0, 2.2);
    sun.position.set(-18, 16, 14); sun.target.position.set(0, 1, -6);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.normalBias = 0.03;
    for (const o of [hemi, sun, sun.target]) { o.userData.noPick = true; root.add(o); }
    V3.R.scene.background = new THREE.Color(0x9cc6e6);
  };

  // ---- cutaway (manual only: 外观 / 一楼 / 阁楼; walls facing the camera drop to their low copy) ----
  const NORM = { s: [0, 0, 1], n: [0, 0, -1], e: [1, 0, 0], w: [-1, 0, 0] };
  const collect = (root) => {
    const c = { roof: [], loft: [], ground: [], walls: [], onWall: [], ceilingFixtures: [] };
    root.traverse(o => {
      const u = o.userData || {};
      if (u.ceilingFixture) c.ceilingFixtures.push(o);
      if (u.wall && NORM[u.wall]) c.walls.push(o);
      else if (u.onWall && NORM[u.onWall]) c.onWall.push(o);
      else if (u.layer === 'roof' || u.layer === 'loft' || u.layer === 'ground') c[u.layer].push(o);
    });
    return c;
  };
  const _d = new THREE.Vector3();
  const CUT_SIDES = ['s', 'n', 'e', 'w'], SIDE_BIT = { s: 1, n: 2, e: 4, w: 8 };
  // 每帧都跑，而且每帧都要把 visible 重新写一遍：69-arrange 拖家具、51-sky 画影子时会临时改这些物体的 visible，靠这里改回来。
  // 所以不能「没变就跳过」，只是不再每帧新建闭包、`${storey}:${side}` 表和字符串：压低的墙用两组位记（剖开的那层 / 方块房子那层）。
  const applyCut = (c, floor, cam, centre) => {
    _d.copy(cam.position).sub(centre); _d.y = 0; _d.normalize();
    let facing = 0;   // 朝着镜头的那几面
    for (let i = 0; i < 4; i++) { const n = NORM[CUT_SIDES[i]]; if (n[0] * _d.x + n[2] * _d.z > 0.2) facing |= 1 << i; }
    for (let i = 0; i < c.roof.length; i++) c.roof[i].visible = floor === 'all';
    for (let i = 0; i < c.loft.length; i++) c.loft[i].visible = floor !== 'ground';
    for (let i = 0; i < c.ground.length; i++) c.ground[i].visible = true;
    let lowCut = 0, lowHouse = 0, houseStorey = null;   // lowCut：floor 那层压低的面；lowHouse：houseStorey 那层压低的面
    const hl = SC.houseLowered && SC.houseLowered();   // 方块房子（54-house-mc）压低了哪几面墙：挂墙的东西跟着藏
    if (hl) { houseStorey = hl.storey; const sides = hl.sides; for (let i = 0; i < sides.length; i++) lowHouse |= SIDE_BIT[sides[i]] || 0; }
    for (let i = 0; i < c.walls.length; i++) {
      const o = c.walls[i], u = o.userData, st = u.storey || 'ground';
      const active = (floor === 'ground' && st === 'ground') || (floor === 'loft' && st === 'loft');
      const lowered = active && (facing & SIDE_BIT[u.wall]) !== 0;
      if (lowered) lowCut |= SIDE_BIT[u.wall];   // active：st 就是 floor
      const storeyOn = !(st === 'loft' && floor === 'ground') && !(st === 'roof' && floor !== 'all');
      o.visible = storeyOn && (u.cut === 'low' ? lowered : !lowered);
    }
    for (let i = 0; i < c.onWall.length; i++) {
      const o = c.onWall[i], u = o.userData, st = u.storey || (u.layer === 'loft' ? 'loft' : 'ground');
      const storeyOn = !(st === 'loft' && floor === 'ground'), bit = SIDE_BIT[u.onWall];
      o.visible = storeyOn && !((st === floor && (lowCut & bit) !== 0) || (st === houseStorey && (lowHouse & bit) !== 0));
    }
    // 只标记灯具 Mesh，PointLight 已独立在场景里；绝不因隐藏吊灯根组而丢光。
    for (let i = 0; i < c.ceilingFixtures.length; i++) {
      const o = c.ceilingFixtures[i], layer = o.userData.ceilingFixture;
      o.visible = floor === 'all' || (layer === 'ground' && floor === 'loft');
    }
  };

  const tris = (o) => { let n = 0; o.traverse(m => { if (m.isMesh && m.geometry) { const g = m.geometry; n += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3; } }); return n | 0; };

  // camera that looks over the house toward the current sun / moon (views 'sun' / 'moon')
  const toward = (key) => {
    // prefer the display direction (sunShow / moonShow: where the disc is drawn) over the real one
    const st = V3.env && V3.env.state, d = st && (st[key.replace('Dir', 'Show')] || st[key]);
    if (!d) return { az: 0.55, el: 0.42, dist: 50, target: [0, 1.5, -5] };
    const v = Array.isArray(d) ? new THREE.Vector3(d[0], d[1], d[2]) : new THREE.Vector3(d.x, d.y, d.z);
    v.normalize();
    let h = Math.hypot(v.x, v.z); const hx = h > 1e-3 ? v.x / h : 0, hz = h > 1e-3 ? v.z / h : -1;
    // camera stands on the far side of the house from the sun/moon, raised so the roof
    // does not hide a low sun, and swung 0.25 rad sideways so the house sits off-centre
    // display directions sit below the true horizon (sky presses the drawn horizon down), so allow looking down
    const pitch = U.clamp(Math.asin(U.clamp(v.y, -1, 1)) - 0.12, -0.25, 1.2);
    const sw = 0.25, cx = hx * Math.cos(sw) - hz * Math.sin(sw), cz = hx * Math.sin(sw) + hz * Math.cos(sw);
    const cam = new THREE.Vector3(-cx * 30, 10, -10 - cz * 30);
    const dir = new THREE.Vector3(hx * Math.cos(pitch), Math.sin(pitch), hz * Math.cos(pitch));
    const tgt = cam.clone().addScaledVector(dir, 40), off = cam.clone().sub(tgt);
    return { az: Math.atan2(off.x, off.z), el: Math.asin(off.y / off.length()), dist: off.length(), target: tgt.toArray() };
  };

  // ---- the model ----
  const build = () => {
    const HBk = V3.houseBlocks, H = (HBk && HBk.placedLayout ? HBk.placedLayout() : V3.layout).house;   // 布置模式挪过房子：剖开按摆好以后的外墙
    const root = new THREE.Group(); root.name = 'house2';
    const state = { time: U.qs('time', 'golden'), floor: 'all', weather: U.qs('wx', 'clear') };
    const ctx = SC.ctx(root, { state });
    const built = [], dead = new Set(), stats = [];
    let haveSky = false;
    for (const p of parts) {
      const t0 = performance.now();
      try {
        let out = p.build(ctx);
        out = out == null ? [] : Array.isArray(out) ? out : [out];
        let n = 0;
        for (const o of out) { if (o && o.isObject3D) { if (!o.parent) root.add(o); n += tris(o); } }
        built.push(p);
        if (p.id === 'sky') haveSky = true;
        stats.push({ id: p.id, ms: Math.round(performance.now() - t0), tris: n });
      } catch (e) {
        V3.err('scene.build ' + p.id + ': ' + (e && e.stack ? e.stack : e));
        stats.push({ id: p.id, ms: Math.round(performance.now() - t0), error: String(e && e.message || e) });
      }
    }
    root.traverse(m => {
      if (!m.isMesh) return;
      const u = m.userData || {};
      m.castShadow = !u.noShadow; m.receiveShadow = !u.noReceive;
    });
    if (!haveSky) fallbackLights(root);
    window.__sceneStats = { parts: stats, lamps: ctx._lamps.length, glows: ctx._glows.length, tris: tris(root) };

    const applyTime = (v) => {
      state.time = v;
      if (V3.env && typeof V3.env.setTime === 'function') { try { V3.env.setTime(v); } catch (e) { V3.err('env.setTime: ' + e); } }
      else SC.fallbackK = v === 'night' ? 1 : (v === 'golden' || v === 'dusk' || v === 'dawn') ? 0.6 : 0;
    };
    applyTime(state.time);
    const applyWeather = (v) => {
      state.weather = v;
      if (V3.env && typeof V3.env.setWeather === 'function') { try { V3.env.setWeather(v); } catch (e) { V3.err('env.setWeather: ' + e); } }
    };
    applyWeather(state.weather);
    let cut = collect(root);
    ctx.recut = () => { cut = collect(root); };   // 部件后来又加了东西（方块还没读好时，跟着方块摆的灯、屏幕晚一点才加）：重新收集剖切用的物体
    const centre = new THREE.Vector3((H.x0 + H.x1) / 2, H.floorY, (H.z0 + H.z1) / 2);
    let envDead = false;

    const inst = {
      id: 'house2', label: '小鲸鱼之家', root, partRoot: '小屋', ctx,
      ready: ctx._waits.length ? Promise.all(ctx._waits).then(() => true) : null,
      states: {
        time: { label: '时间', options: SC.TIMES, value: state.time },
        floor: { label: '楼层', options: SC.FLOORS, value: 'all' },
        weather: { label: '天气', options: SC.WEATHERS, value: state.weather },
      },
      solo: true,   // one draw per mesh when all its face groups share a material (00-core P.soloAll)
      stage: { pedestal: false, lights: false, size: 40, center: [0, 2, -4] },
      views: {
        hero: { az: 0.58, el: 0.42, dist: 43, target: [3.5, 2.4, 1.0] },
        isle: { az: 0.67, el: 0.40, dist: 74, target: [2, -1, 6] },
        front: { az: 0, el: 0.18, dist: 30, target: [0, 3, -8] },
        house: { az: 0.55, el: 0.45, dist: 24, target: [0, 3.5, -9] },
        inside: { az: 0.6, el: 0.75, dist: 17, target: [0, 1.5, -10] },
        loft: { az: 0.6, el: 0.8, dist: 17, target: [0, 4, -10] },
        top: { az: 0, el: 1.45, dist: 30, target: [0, 1, -10] },
        site: { az: 0.3, el: 0.9, dist: 85, target: [0, 0, 6] },
        reef: { az: 0, el: 0.07, dist: 10, target: [5.5, -2.6, 37] },
        get sun() { return toward('sunDir'); },
        get moon() { return toward('moonDir'); },
      },
      setState(k, v) {
        if (!this.states[k]) return;
        this.states[k].value = v;
        if (k === 'time') applyTime(v); else if (k === 'weather') applyWeather(v); else state[k] = v;
        const waits = [];   // 部件改状态要异步画（方块房子切楼层）：返回 Promise，ready 换成等它
        for (const p of built) if (typeof p.setState === 'function') { try { const r = p.setState(k, v, ctx); if (r && typeof r.then === 'function') waits.push(r); } catch (e) { V3.err('scene.setState ' + p.id + ': ' + e); } }
        if (waits.length) this.ready = Promise.all(waits).then(() => true);
      },
      update(dt, t) {
        if (V3.env && typeof V3.env.update === 'function' && !envDead) { try { V3.env.update(dt); } catch (e) { envDead = true; V3.err('env.update: ' + (e && e.stack ? e.stack : e)); } }
        for (const p of built) {
          if (typeof p.update !== 'function' || dead.has(p.id)) continue;
          try { p.update(dt, t, ctx); } catch (e) { dead.add(p.id); V3.err('scene.update ' + p.id + ': ' + (e && e.stack ? e.stack : e)); }
        }
        ctx.tickLights();
        if (!haveSky && !V3.R.scene.background) V3.R.scene.background = new THREE.Color(0x9cc6e6);   // stage.fit clears it after build
        applyCut(cut, state.floor, V3.R.camera, centre);
      },
      post(r, s, c, dt) {
        if (typeof V3.post === 'function' && U.qs('nopost') !== '1') V3.post(r, s, c, dt);
        else r.render(s, c);
      },
      dispose() {
        ctx.dead = true;   // 还在等方块数据的部件（54-house-mc 的 whenGrid）看到就不再往这个场景里加东西
        for (const p of built) if (typeof p.dispose === 'function') { try { p.dispose(ctx); } catch (e) { V3.err('scene.dispose ' + p.id + ': ' + e); } }
        const geos = new Set(), mats = new Set();
        root.traverse(m => {
          if (m.geometry) geos.add(m.geometry);
          const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
          for (const x of ms) if (!(x.userData && x.userData.shared)) mats.add(x);
        });
        for (const g of geos) g.dispose();
        for (const x of mats) x.dispose();
        for (const p of ['场地', '海', '天空', '绿植', '小鲸鱼', '贝壳']) V3.parts.reset(p);
        V3.R.scene.fog = null; V3.R.renderer.toneMappingExposure = 1;
        SC.fallbackK = null;
      },
    };
    return inst;
  };

  V3.models.register({ id: 'house2', label: '小鲸鱼之家', build });
})(window.V3);
