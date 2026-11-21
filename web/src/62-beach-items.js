// src/62-beach-items.js — 场景部件 beach-items（order 62）：沙滩上的贝壳海螺。
// build 时把 V3.game.st.beach 直接摆好；听 'game:wash'：新冲上来的先在浅水里漂到水线，再被 V3.water 的浪前沿
// 一下下推到落点，路上翻一两下，停稳后才开始闪光；silent 的直接放好。'game:reset' 时和 st.beach 对齐。
// 每个 item 一个 root：userData.collectId = id、part '贝壳/<名字>'、anchor 'beach:'+id；里面是 V3.shells.build(kind)、
// 随真实壳体尺寸变化的点选椭球和一颗隔几秒闪一下的闪光（稀有的更亮更大，noPick / noShadow）。
// 导出 V3.beachItems = { spot(rng) → {x,z,ry}|null, detach(id) → Object3D（世界坐标）, objects() → root[], get(id) → root,
// ready(id)（停稳了没有）, sync(), settle() }。
// 调试 token：beachDemo=N（没有 V3.game 时自己造 N 个来冲；有就调 washNow）、beachSettle（动画立刻落定）。
(function (V3) {
  'use strict';
  const U = V3.util, L = V3.layout;
  // Step flower-pot rim is approximately 0.375 m wide (12 voxels / 32).
  // Cap all three local dimensions, including tall pearl shells; preserve proportions.
  const SIZE = 0.375, PICK_R = 1, RADIUS = SIZE / Math.SQRT2, SWAY = 0.08, GAP = 0.75, TAU = Math.PI * 2;
  const GLINT = { common: [1.4, 0.15, 4.5], uncommon: [2.2, 0.19, 3.6], rare: [4.0, 0.25, 2.4], ultra: [4.4, 0.28, 2.2] };   // 亮度(HDR)、大小(m)、平均间隔(s)
  const WZ = (L.zones || []).find(z => z.id === 'wash') || { x0: -20, x1: 20 };
  let G = null;                                       // 当前场景里的组；没 build 时为 null
  const A = new Map();                                // id -> 记录 { it, root, spin, yaw, pick, sp, ... }
  let recent = [], demoN = 0, fseed = 1, onWash = null, onSync = null;

  const hs = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  const rnd = (s, k) => { const h = hs(s); return U.hash3(h & 0xffff, k, h >>> 16); };   // 每个 id 稳定的 0..1
  const kindOf = (id) => V3.game && V3.game.kind(id) || ((V3.shells && V3.shells.KINDS) || []).find(k => k.id === id);
  const gy = (x, z) => (V3.terrain ? V3.terrain.groundY(x, z) : 0);
  const night = () => (V3.env && V3.env.state ? V3.env.state.night || 0 : 0);

  // ---- 共享资源：闪光贴图（十字星 + 斜向短芒 + 光晕）、点选球
  let STAR = null, PG = null, PM = null;
  function starTex() {
    if (STAR) return STAR;
    const N = 64, d = new Uint8Array(N * N * 4);
    const ray = (a, b, len) => Math.exp(-Math.abs(a) * 26) * Math.max(0, 1 - Math.abs(b) / len);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, r = Math.hypot(u, v), p = (u + v) * 0.7071, q = (u - v) * 0.7071;
      const rays = Math.max(ray(u, v, 1), ray(v, u, 1)) * 0.9 + Math.max(ray(p, q, 0.55), ray(q, p, 0.55)) * 0.4;
      const a = r >= 1 ? 0 : Math.min(1, Math.exp(-r * r * 40) + Math.exp(-r * r * 7) * 0.22 + rays);
      const i = (y * N + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
    }
    STAR = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
    STAR.magFilter = STAR.minFilter = THREE.LinearFilter; STAR.generateMipmaps = false; STAR.needsUpdate = true;
    STAR.userData.shared = true;
    return STAR;
  }
  const pickGeo = () => PG || (PG = new THREE.SphereGeometry(PICK_R, 10, 8));
  const pickMat = () => {
    if (!PM) { PM = new THREE.MeshBasicMaterial({ visible: false }); PM.name = 'beach:pick'; PM.userData.shared = true; }
    return PM;
  };

  // ---- 一个 item：root(位置) → spin(绕世界 x 翻滚，原点在壳的中心) → yaw(朝向) → 壳；root 下还有点选球和闪光
  function make(it) {
    const k = kindOf(it.kind); if (!k) throw new Error('未知贝壳种类 ' + it.kind);
    const shell = V3.shells.build(it.kind, { anchor: 'beach:' + it.id, pat: it.pat });
    shell.updateMatrixWorld(true);
    shell.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true; o.userData.layer = 'site';

    });
    const bb = new THREE.Box3().setFromObject(shell, true), size = bb.getSize(new THREE.Vector3()), centre = bb.getCenter(new THREE.Vector3());
    // 这一枚的尺寸：本种区间里最小的 → 80%，最大的（大金冠）→ 100% 盆沿宽；没有尺寸的旧数据按 100%
    const R = V3.inventoryRules, t = it.size > 0 && R ? R.sizeT(k, it.size) : null;
    const scale = SIZE * (t == null ? 1 : 0.8 + 0.2 * t) / Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('贝壳没有有效可见尺寸 ' + it.kind);
    // Only this beach instance changes. Cached geometry and cabinet/icon instances remain untouched.
    shell.scale.multiplyScalar(scale);
    const ex = size.x * scale / 2, hy = size.y * scale / 2, ez = size.z * scale / 2;
    shell.position.set(-centre.x * scale, -centre.y * scale, -centre.z * scale);
    const root = new THREE.Group(), spin = new THREE.Group(), yaw = new THREE.Group();
    root.name = 'beach:' + it.id; spin.name = 'spin'; yaw.name = 'yaw';
    yaw.add(shell); spin.add(yaw); root.add(spin);
    Object.assign(root.userData, { collectId: it.id, anchor: 'beach:' + it.id, layer: 'site', kind: it.kind });
    V3.parts.tag(root, (k.category === 'trash' ? '海滩垃圾/' : k.category === 'seed' ? '海漂种子/' : '贝壳/') + k.name, { label: k.name });
    const pick = new THREE.Mesh(pickGeo(), pickMat());
    pick.name = 'beach:pick'; pick.position.y = hy; pick.scale.set(ex + 0.04, Math.max(hy, 0.06) + 0.04, ez + 0.04); pick.rotation.y = it.ry; pick.castShadow = pick.receiveShadow = false;
    Object.assign(pick.userData, { noShadow: true, noReceive: true, layer: 'site', pickSphere: true });
    root.add(pick);
    const g = k.category === 'trash' ? [.75, .105, 6.5] : GLINT[k.rarity] || GLINT.common;
    const sm = new THREE.SpriteMaterial({ map: starTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    sm.color.setRGB(g[0], g[0] * 0.94, g[0] * 0.82); sm.name = 'beach:glint';
    const sp = new THREE.Sprite(sm);
    sp.name = 'beach:glint'; sp.visible = false; sp.raycast = () => {};
    sp.position.set((rnd(it.id, 3) - 0.5) * 0.04, hy * 2 + 0.04, (rnd(it.id, 4) - 0.5) * 0.04);
    Object.assign(sp.userData, { noShadow: true, noReceive: true, noPick: true, layer: 'site' });
    root.add(sp);
    return { it, root, spin, yaw, pick, sp, g, hy, ex, ez, x: it.x, zT: it.z, z: it.z, done: true, n: 9,
      gl: 0.5 + rnd(it.id, 5) * g[2], t: 0, turns: rnd(it.id, 6) < 0.5 ? 1 : 2 };
  }

  // 摆姿势：p = 冲上岸的进度 0..1；翻滚时抬高中心，免得壳插进沙里
  function pose(a) {
    const p = a.done ? 1 : U.clamp((a.z0 - a.z) / Math.max(0.01, a.z0 - a.zT), 0, 1);
    const th = a.done ? 0 : -TAU * a.turns * U.smooth(0, 1, p);
    a.spin.rotation.x = th;
    const ry = a.done ? a.it.ry : U.lerp(a.ry0, a.it.ry, p);
    a.yaw.rotation.y = ry;
    const depth = a.ex * Math.abs(Math.sin(ry)) + a.ez * Math.abs(Math.cos(ry));
    a.spin.position.y = a.hy * Math.abs(Math.cos(th)) + depth * Math.abs(Math.sin(th));
    a.pick.visible = a.done; a.pick.rotation.y = ry;
    const x = a.done ? a.x : a.x + a.sw * Math.sin(Math.PI * p);
    let floor = gy(x, a.z);
    // Support the whole enlarged footprint on slopes, not just its old tiny centre point.
    for (let dx = -RADIUS; dx <= RADIUS + 1e-6; dx += RADIUS / 2) for (let dz = -RADIUS; dz <= RADIUS + 1e-6; dz += RADIUS / 2)
      if (dx * dx + dz * dz <= RADIUS * RADIUS) floor = Math.max(floor, gy(x + dx, a.z + dz));
    a.root.position.set(x, floor, a.z);
  }

  // 冲上岸：先出现在离水线 0.55 m 的浅水里，漂到水线；浪前沿往陆地推进且追到它时被水拽着走（≤ 1.6 m/s，平滑加减速），
  // 浪退了就靠摩擦慢慢停在原地等下一个浪；16 s 还没到就自己滑过去。没有 V3.water 时直接匀速滑。
  function startWash(a) {
    const sz = V3.terrain ? V3.terrain.shoreZ(a.x) : a.zT + 2;
    if (a.zT >= sz - 0.05) return;
    Object.assign(a, { done: false, t: 0, tp: null, v: 0, z0: sz + RADIUS + SWAY, z: sz + RADIUS + SWAY, zS: sz + 0.12, fz: 1e9,
      ry0: a.it.ry + (rnd(a.it.id, 7) - 0.5) * 3, sw: (rnd(a.it.id, 8) - 0.5) * 2 * SWAY });
  }
  // 2026-11-17：改成有速度的运动。以前被浪追上的那一帧直接按 ≤ 3 m/s 挪、浪一走立刻停，速度是跳的，
  // 翻滚又跟着位置走，所以壳一顿一顿、推得快时翻得飞快还上下蹦。现在 a.v（往陆地的速度）只按加速度变：
  // 浪推着时被水拽向浪前沿的速度（≤ 1.6 m/s），没被推时靠沙子的摩擦慢慢停；离落点近了提前减速，轻轻停在落点上。
  const WASH_V = 1.6, WASH_DRAG = 5, WASH_FRIC = 1.6, WASH_DRIFT = 0.3, WASH_EASE = 0.35;
  function stepWash(a, dt) {
    const W = V3.water, T = V3.terrain;
    a.t += dt;
    if (a.v == null) a.v = 0;
    let want = 0, k = WASH_FRIC;                                        // 想要的速度、往它靠的加速度
    if (!W || !W.frontD || !T) { want = 1.2; k = WASH_DRAG; }
    else {
      const fz = T.shoreZ(a.x) - W.frontD(a.x);
      const fv = a.fz > 1e8 || dt <= 0 ? 0 : (a.fz - fz) / dt;          // 浪前沿往陆地走的速度（退浪时为负）
      a.fz = fz;
      if (a.z > a.zS) { want = WASH_DRIFT; k = WASH_DRAG; }             // 还在浅水里：先漂到水线
      const push = fz + a.ez, gap = a.z - push;                          // gap > 0：浪已经漫过它；gap < 0：在浪前面
      // 浪往陆地推进、壳泡在涌上来的水里（或刚好在泡沫线前 RADIUS 内）：被水拽着，速度往浪前沿的速度靠。
      // 浪前沿越过了它也一样（水还在往岸上流），不然大浪一下冲过去、壳就被甩在后面等下一个浪
      if (fv > 0.05 && gap > -RADIUS && gap < 2.5) { want = Math.max(want, Math.min(WASH_V, fv)); k = WASH_DRAG; a.tp = a.t; }
      // 被推过、离落点只差一小段：别停下来等下一个大浪，慢慢滑过去
      if (a.tp != null && a.t - a.tp < 2.5 && a.z - a.zT < 0.4) { want = Math.max(want, WASH_EASE); if (k < WASH_DRAG) k = WASH_DRAG * 0.5; }
      if (a.t > 16) { want = Math.max(want, 0.6); k = WASH_DRAG; }       // 兜底：16 s 还没到就自己滑过去
    }
    a.v += U.clamp(want - a.v, -k * dt, k * dt);
    // 到落点前按「能刹住」的速度封顶（v² ≤ 2·a·d），最后 1 cm 允许 0.05 m/s 的蠕动，免得永远差一点
    const d = Math.max(0, a.z - a.zT);
    a.v = Math.min(a.v, Math.sqrt(2 * WASH_DRAG * 0.6 * d) + 0.05);
    a.z = Math.max(a.zT, a.z - Math.max(0, a.v) * dt);
    if (a.z <= a.zT + 0.004) { a.z = a.zT; a.v = 0; a.done = true; a.gl = 0.6; }
    pose(a);
  }
  // ---- 闪光：停稳后隔几秒闪一下（约 0.5 s 亮起再熄灭），稀有的更亮更大；夜里暗一点
  function glint(a, dt) {
    const sp = a.sp;
    if (!a.done) { sp.visible = false; return; }
    a.gl -= dt;
    if (a.gl > 0) { if (sp.visible) sp.visible = false; return; }
    const u = -a.gl / 0.5;                                              // 这次闪光的进度 0..1
    if (u >= 1) { sp.visible = false; a.n++; a.gl = a.g[2] * (0.5 + rnd(a.it.id, 20 + (a.n % 50))); return; }
    const k = Math.sin(Math.PI * u), nt = night(), s = a.g[1] * (0.35 + 0.65 * k) * (1 - 0.25 * nt);
    sp.visible = true; sp.scale.set(s, s, 1);
    sp.material.opacity = k * (1 - 0.35 * nt);
    sp.material.rotation = u * 0.6 + rnd(a.it.id, 9) * 3;
  }

  // ---- 增删：add 摆一个（anim = 从水里冲上来）；drop 直接删；sync 和 V3.game.st.beach 对齐（不动画）
  function add(it, anim) {
    if (!G || !it || A.has(it.id)) return null;
    let a = null;
    try { a = make(it); } catch (e) { V3.err('beach-items: ' + (e && e.message || e)); return null; }
    A.set(it.id, a); G.add(a.root);
    if (anim) startWash(a);
    pose(a); glint(a, 0);
    return a;
  }
  function strip(a) {                                                   // 拿掉点选球和闪光（交给收集特效前 / 删除时）
    if (a.pick.parent) a.pick.parent.remove(a.pick);
    if (a.sp.parent) a.sp.parent.remove(a.sp);
    a.sp.material.dispose();
  }
  function drop(id) {
    const a = A.get(id); if (!a) return;
    A.delete(id); strip(a);
    if (a.root.parent) a.root.parent.remove(a.root);
    a.root.traverse(o => { o.userData.noPick = true; });
  }
  function sync() {
    const st = V3.game && V3.game.st; if (!G || !st || !st.beach) return;
    const ids = new Set(st.beach.map(b => b.id));
    for (const id of [...A.keys()]) if (!ids.has(id)) drop(id);
    for (const it of st.beach) if (!A.has(it.id)) add(it, false);
  }
  // 收集：把壳从场景里拿出来，世界变换烘进它自己的 position/quaternion/scale，去掉点选球和闪光，交给收集特效
  function detach(id) {
    const a = A.get(id); if (!a) return null;
    A.delete(id); strip(a);
    const r = a.root;
    r.updateWorldMatrix(true, true);
    r.matrixWorld.decompose(r.position, r.quaternion, r.scale);
    if (r.parent) r.parent.remove(r);
    r.updateMatrixWorld(true);
    r.traverse(o => { o.userData.noPick = true; });
    return r;
  }
  function settle() {                                                   // 所有冲上岸动画立刻落定
    for (const a of A.values()) if (!a.done) { a.z = a.zT; a.done = true; a.gl = 0.6; pose(a); }
  }
  // ---- 落点：潮线到湿沙之间（和 nav 的 'tideline' 区一致：tideZ − 0.4 < z < shoreZ − 0.3），她走得到，不在石头 / 礁石 /
  // 沙滩椅那块上，从水线滑上来的路上也没有石头；和别的贝壳中心隔 ≥ 0.75 m（包含真实壳体宽度）。返回 {x, z, ry}，找不到返回 null。
  const OUT = id => (L.outside || []).find(o => o.id === id);
  const rectD = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
  function okAt(x, z) {
    const T = V3.terrain, N = V3.nav;
    if (x < WZ.x0 + RADIUS + SWAY || x > WZ.x1 - RADIUS - SWAY) return false;
    if (T) {
      const sz = T.shoreZ(x);
      if (z < T.tideZ(x) - 0.4 || z > sz - 0.3 || T.groundY(x, z) > 0.3) return false;
      for (let pz = z - RADIUS; pz <= sz + RADIUS + SWAY; pz += 0.25)                      // 滑上来的路（含左右摆动）不能碰石头
        for (let dx = -RADIUS - SWAY; dx <= RADIUS + SWAY + 0.001; dx += 0.2)
          if (T.groundY(x + dx, pz) - T.seabedY(x + dx, pz) > 0.05) return false;
    }
    for (const id of ['beachSet', 'rocks', 'reefE', 'reefW', 'chest', 'towel']) { const r = OUT(id); if (r && rectD(r, x, z) < RADIUS + SWAY + 0.1) return false; }
    try {
      if (N && N.walkable) for (const [dx, dz] of [[RADIUS, 0], [-RADIUS, 0], [0, RADIUS], [0, -RADIUS]])
        if (!N.walkable(x + dx, z + dz)) return false;
      if (N && N.reachable) return !!N.reachable(x, z);
      if (N && N.walkable) return !!N.walkable(x, z);
    } catch (e) { /* nav 出错时不拦 */ }
    return true;
  }
  function spot(rng) {
    const r = typeof rng === 'function' ? rng : U.rng(0x5be11 + (fseed++) * 7919), T = V3.terrain, N = V3.nav;
    const now = Date.now(), pts = [];
    recent = recent.filter(p => now - p.t < 3000);
    const st = V3.game && V3.game.st;
    if (st && st.beach) for (const b of st.beach) pts.push([b.x, b.z]);
    for (const a of A.values()) pts.push([a.x, a.zT]);
    for (const p of recent) pts.push([p.x, p.z]);
    let best = null, bd = -1;
    for (let i = 0; i < 60; i++) {
      let p = null;
      if (N && N.randomPoint && i % 2 === 0) { try { p = N.randomPoint('tideline', r); } catch (e) { p = null; } }
      if (!p) {
        const x = U.lerp(WZ.x0 + 0.5, WZ.x1 - 0.5, r());
        const z0 = T ? T.tideZ(x) - 0.2 : 9, z1 = T ? T.shoreZ(x) - 0.4 : 11.5;
        p = [x, U.lerp(z0, Math.max(z0, z1), r())];
      }
      const x = p[0], z = p[1];
      if (!okAt(x, z)) continue;
      let d = 1e9; for (const q of pts) d = Math.min(d, Math.hypot(q[0] - x, q[1] - z));
      if (d > bd) { bd = d; best = { x, z, ry: r() * TAU }; }
      if (d >= GAP) break;
    }
    if (!best || bd < GAP) return null;
    recent.push({ x: best.x, z: best.z, t: now });
    return best;
  }

  // ---- 场景部件：build 时摆好 st.beach；'game:wash' 冲上来新的；reset / start / settings 时和 st.beach 对齐
  V3.scene.part({
    id: 'beach-items', label: '沙滩贝壳', order: 62,
    build() {
      G = new THREE.Group(); G.name = 'beach-items'; G.userData.layer = 'site';
      A.clear(); recent = [];
      sync();
      onWash = V3.on('game:wash', (e) => { if (G && e && e.items) for (const it of e.items) add(it, !e.silent); });
      onSync = sync;
      for (const ev of ['game:reset', 'game:start', 'game:settings']) V3.on(ev, onSync);
      return G;
    },
    update(dt) {
      if (!G) return;
      const d = Math.min(dt || 0, 0.1);
      for (const a of A.values()) { if (!a.done) stepWash(a, d); glint(a, d); }
    },
    dispose() {
      if (onWash) V3.off('game:wash', onWash);
      if (onSync) for (const ev of ['game:reset', 'game:start', 'game:settings']) V3.off(ev, onSync);
      onWash = onSync = null;
      for (const a of A.values()) a.sp.material.dispose();
      A.clear(); G = null;
    },
  });

  // ---- 调试 token：beachDemo=N 冲 N 个上来（有 V3.game 就走 washNow）；beachSettle 让动画立刻落定
  V3.viewTokens = V3.viewTokens || {};
  V3.viewTokens.beachDemo = (v) => {
    const n = Math.max(1, Math.min(12, parseInt(v, 10) || 3));
    if (V3.game && V3.game.washNow) { V3.game.washNow(n); return; }
    const ks = (V3.shells && V3.shells.KINDS) || [];
    for (let i = 0; i < n && ks.length; i++) {
      const p = spot(); if (!p) break;
      demoN++;
      add({ id: 'demo' + demoN, kind: ks[(demoN * 5) % ks.length].id, x: p.x, z: p.z, ry: p.ry, at: Date.now() }, true);
    }
  };
  V3.viewTokens.beachSettle = () => settle();

  V3.beachItems = {
    spot, detach, sync, settle,
    objects: () => [...A.values()].map(a => a.root),
    get: (id) => { const a = A.get(id); return a ? a.root : null; },
    ready: (id) => { const a = A.get(id); return !!a && a.done; },   // 停稳了（不在冲上岸的路上）
  };
})(window.V3);
