// 69-sand-tray.js — 沙盘展示盒（V3.sandTray）：门廊上靠墙的一个木框沙盘，内框 90 × 60 cm（58-inventory-rules 的 TRAY），贝壳按真实尺寸摆在沙子上。
// 数据：收藏存档 inventory.tray = { rev, items: [{ uid, x, z, ry, flip }] }（厘米，原点在沙盘中心，+x 右、+z 朝前；58-inventory-rules 的 tray_set）。
//   摆在沙盘里的贝壳算「在展示」：不能卖、不能再摆到别处。
// 三处用同一套画法（contents）：
//   · 场景部件 'sand-tray'：门廊上的沙盘，新摆上去的贝壳一枚接一枚落下来；点它打开编辑器
//   · 编辑器（HUD 弹窗）：自己的 WebGLRenderer。下面一排是能摆的贝壳（每一枚单独，按种类分组），拖到沙子上放下；
//     点沙盘里的一枚选中，拖着挪、按钮转 / 翻面 / 拿走；滚轮转选中的那枚。每次改动 0.5 秒后存档（tray_set，base = 当前 rev）
//   · snapshot()：俯视截图（主渲染器离屏画，66-shell-icons.shot），给「拍照」和小鲸鱼的工具用
// token：tray=1 打开编辑器、traydemo=<n>（本地存档里随便摆 n 枚，截图用）
(function (V3) {
  'use strict';
  const U = V3.util, H = V3.hud, I = V3.cabinInventory, R = () => V3.inventoryRules;
  const TRAY0 = (V3.inventoryRules && V3.inventoryRules.TRAY) || { w: 90, d: 60 };
  const W = TRAY0.w / 100, D = TRAY0.d / 100, RIM = 0.04, LEG = 0.3, SAND = LEG + 0.045, TOP = SAND + 0.022;   // 米：内框、木框宽、腿高、沙面高、框顶高
  const SAVE_MS = 500, DROP = 0.35;                                                         // 存档防抖；新贝壳一枚枚落下的间隔（秒）
  const inv = () => (I && I.data ? I.data.inventory : null);
  const trayItems = () => (inv() ? inv().tray.items : []);
  const toast = (text, color = '#6fc3f5') => { if (H && H.toast) H.toast(text, { color, ms: 2800 }); };

  // ---- 每一枚：uid → { kind, item }（收藏里找） ----
  function owners() {
    const m = new Map(), x = inv();
    if (x) for (const [kind, f] of Object.entries(x.found)) for (const it of f.items) m.set(it.uid, { kind, item: it });
    return m;
  }

  // ---- 沙盘本体（几何、材质全模块共用一份，标 shared）----
  let MODEL = null;
  function parts() {
    if (MODEL) return MODEL;
    const wood = V3.vox.material({ roughness: 0.78 }), sand = V3.vox.material({ roughness: 0.96 });
    wood.userData.shared = sand.userData.shared = true;
    const K = V3.shellKit, plank = (n, a) => (Math.floor((a[0] + 1) * 31) % 3 ? 0xb98a55 : 0xa87a48);
    const frame = K.sculpt(({ add }) => {
      const w = W + 2 * RIM, d = D + 2 * RIM, h = TOP - LEG + 0.02;
      add(new THREE.BoxGeometry(w, h, RIM).translate(0, LEG + h / 2 - 0.02, d / 2 - RIM / 2), plank);
      add(new THREE.BoxGeometry(w, h, RIM).translate(0, LEG + h / 2 - 0.02, -d / 2 + RIM / 2), plank);
      add(new THREE.BoxGeometry(RIM, h, D).translate(w / 2 - RIM / 2, LEG + h / 2 - 0.02, 0), plank);
      add(new THREE.BoxGeometry(RIM, h, D).translate(-w / 2 + RIM / 2, LEG + h / 2 - 0.02, 0), plank);
      add(new THREE.BoxGeometry(W, 0.02, D).translate(0, LEG, 0), 0x8a6238);
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(new THREE.BoxGeometry(0.045, LEG, 0.045).translate(x * (w / 2 - 0.04), LEG / 2, z * (d / 2 - 0.04)), 0x8a6238);
      add(new THREE.BoxGeometry(w - 0.08, 0.02, 0.03).translate(0, 0.08, d / 2 - 0.04), 0x9a6f42);       // 腿间横撑
      add(new THREE.BoxGeometry(w - 0.08, 0.02, 0.03).translate(0, 0.08, -d / 2 + 0.04), 0x9a6f42);
    });
    // 沙面：轻微起伏 + 颜色深浅（确定性噪声），比框顶低一点
    const sg = new THREE.PlaneGeometry(W, D, 36, 24).rotateX(-Math.PI / 2), p = sg.getAttribute('position'), col = [];
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = U.hash3(Math.round(x * 60), 7, Math.round(z * 60)), r = U.hash3(Math.round(x * 300), 3, Math.round(z * 300));
      const edge = Math.min(W / 2 - Math.abs(x), D / 2 - Math.abs(z));
      p.setY(i, SAND + (h - 0.5) * 0.004 + (edge < 0.02 ? 0.004 : 0));
      c.setHex(0xe9d4a7).lerp(c.clone().setHex(r > 0.5 ? 0xf3e2bd : 0xd8bf8d), Math.abs(r - 0.5) * 1.2);
      col.push(c.r, c.g, c.b);
    }
    sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    sg.computeVertexNormals();
    frame.userData.shared = sg.userData.shared = true;
    MODEL = { frame, sand: sg, wood, sandMat: sand };
    return MODEL;
  }
  function trayModel() {
    const P = parts(), g = new THREE.Group(); g.name = 'sand-tray';
    const f = new THREE.Mesh(P.frame, [P.wood]), s = new THREE.Mesh(P.sand, P.sandMat);
    f.name = 'sand-tray:frame'; s.name = 'sand-tray:sand';
    f.castShadow = f.receiveShadow = true; s.receiveShadow = true;
    g.add(f, s);
    return g;
  }
  // 一枚贝壳按真实尺寸摆在沙面上（厘米 → 米）。flip：翻过来，底朝上
  function shellObj(t, own) {
    const k = V3.game.kind(own.kind); if (!k) return null;
    const o = V3.shells.build(own.kind, { tag: false, pat: own.item.pat, anchor: 'tray:' + t.uid });
    const s = (own.item.size / 1000) / k.size;
    const box = new THREE.Box3().setFromObject(o, true), h = (box.max.y - box.min.y) * s;
    o.scale.setScalar(s);
    if (t.flip) { o.rotation.x = Math.PI; o.position.y = h; }
    const holder = new THREE.Group(); holder.name = 'tray-shell:' + t.uid; holder.add(o);
    holder.position.set(t.x / 100, SAND - 0.003, t.z / 100); holder.rotation.y = t.ry;
    holder.userData.uid = t.uid; holder.userData.h = h;
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    return holder;
  }
  function contents(items, own = owners()) {
    const g = new THREE.Group(); g.name = 'sand-tray:shells';
    for (const t of items) { const o = own.get(t.uid) && shellObj(t, own.get(t.uid)); if (o) g.add(o); }
    return g;
  }

  // ---- 门廊上的位置：靠墙、右边窗户下面；摆不下就试下一个（房子挪了 / 改过也按真方块判断）----
  const BASES = [[3.6, 1, -5.62], [-4.6, 1, -5.62], [3.6, 1, -4.2], [-4.6, 1, -4.2]];
  let spotCache = null;
  const rot = (x, z, yaw) => [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];
  function spot() {
    const HB = V3.houseBlocks, nav = V3.nav;
    if (!HB || !HB.grid) return null;
    if (spotCache && spotCache.v === HB.version && spotCache.grid === HB.grid) return spotCache.spot;
    let found = null;
    const yaw = HB.placeYaw && HB.place ? HB.placeYaw(0, HB.place) : 0;
    for (const b of BASES) {
      const p = HB.placePoint && HB.place ? HB.placePoint(b, HB.place) : b;
      const ok = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]].every(([sx, sz]) => {
        const [dx, dz] = rot(sx * (W / 2 + RIM - 0.02), sz * (D / 2 + RIM - 0.02), yaw);
        const x = Math.floor(p[0] + dx), z = Math.floor(p[2] + dz), floor = HB.grid.at(x, Math.floor(p[1] - 0.01), z);
        return floor && /_planks$/.test(floor.id) && !HB.grid.at(x, Math.floor(p[1] + 0.01), z);
      });
      if (!ok) continue;
      const [ax, az] = rot(0, D / 2 + 0.55, yaw), a = [p[0] + ax, p[1], p[2] + az];
      if (nav && nav.walkable && !nav.walkable(a[0], a[2], a[1])) continue;
      found = { position: p.slice(), yaw, approach: a };
      break;
    }
    spotCache = { v: HB.version, grid: HB.grid, spot: found };
    return found;
  }

  // ---- 场景部件 ----
  let live = null;
  const sig = (items) => items.map((t) => t.uid + ':' + t.x + ':' + t.z + ':' + t.ry + ':' + (t.flip ? 1 : 0)).join('|');
  function syncScene(S, dt) {
    const sp = spot();
    S.root.visible = !!sp;
    if (!sp) return;
    if (S.sp !== sp) { S.sp = sp; S.root.position.set(...sp.position); S.root.rotation.y = sp.yaw; S.root.updateMatrixWorld(true); }
    const items = trayItems(), k = sig(items);
    if (k !== S.sig) {
      const before = new Set(S.shells ? S.shells.children.map((c) => c.userData.uid) : []), first = S.sig == null;
      S.sig = k;
      if (S.shells) S.shells.removeFromParent();
      S.shells = contents(items); S.tray.add(S.shells);
      // 新摆上去的：从上面一枚接一枚落下来（读档时那一批不演）
      let n = 0;
      // 按真实时间算（截图时场景时间可能是冻住的）
      const now = performance.now();
      if (!first) for (const c of S.shells.children) if (!before.has(c.userData.uid)) { c.userData.fall = { at: now + DROP * 1000 * n++, y: c.position.y }; c.visible = false; }
    }
    const now = performance.now();
    for (const c of S.shells.children) {
      const f = c.userData.fall; if (!f) continue;
      if (now < f.at) continue;
      c.visible = true;
      const u = Math.min(1, (now - f.at) / 450);
      c.position.y = f.y + 0.25 * (1 - u * u);
      if (u >= 1) { c.position.y = f.y; c.userData.fall = null; }
    }
  }
  V3.scene.part({
    id: 'sand-tray', label: '沙盘展示盒', order: 56,
    build(ctx) {
      if (!V3.game || !V3.game.hosted) return null;
      const root = new THREE.Group(); root.name = 'sand-tray-root'; root.visible = false;
      Object.assign(root.userData, { clickable: 'sandTray', layer: 'site' });
      const tray = trayModel(); root.add(tray);
      const S = ctx.sandTray = live = { ctx, root, tray, shells: null, sig: null, sp: null };
      syncScene(S, 0);
      return root;
    },
    update(dt, t, ctx) { if (ctx.sandTray) syncScene(ctx.sandTray, dt); },
    dispose(ctx) { const S = ctx.sandTray; if (!S) return; S.root.removeFromParent(); if (live === S) live = null; ctx.sandTray = null; },
  });

  // ---- 截图：俯视（或斜看），沙盘 + 贝壳 ----
  function snapshot(o = {}) {
    const S = V3.shellIcons; if (!S || !S.shot || !V3.R || !V3.R.renderer) return null;
    const items = o.items || trayItems(), own = owners();
    return S.shot(() => { const g = trayModel(); g.add(contents(items, own)); return g; },
      { size: o.size || 512, view: o.view === 'angle' ? { az: 0, el: 0.75 } : { az: 0, el: 1.45 }, type: o.type || 'image/jpeg', bg: o.bg || '#cfe3f2' });
  }

  // ---- 存档 ----
  let saving = null;
  // commit(items, by, via) → Promise<r>：整盘替换（base = 现在的 rev；别处刚改过 → tray_changed）
  async function commit(items, by = 'player', via) {
    const x = inv(); if (!x) return { ok: false, error: I.error || '小屋存档还在加载' };
    const op = { op: 'tray_set', id: I.id('tray'), base: x.tray.rev, items: items.map((t) => ({ uid: t.uid, x: t.x, z: t.z, ry: t.ry, ...(t.flip ? { flip: true } : {}) })), by };
    if (via) op.via = String(via).slice(0, 128);
    return I.perform(op);
  }

  // ---- 编辑器 ----
  let E = null;
  const round1 = (v) => Math.round(v * 10) / 10, round3 = (v) => Math.round(v * 1000) / 1000;
  const clampX = (x) => U.clamp(x, -R().TRAY.w / 2 + 1, R().TRAY.w / 2 - 1), clampZ = (z) => U.clamp(z, -R().TRAY.d / 2 + 1, R().TRAY.d / 2 - 1);
  function buildEditor() {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    const M = V3.R && V3.R.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = M ? M.toneMapping : THREE.ACESFilmicToneMapping; r.toneMappingExposure = M ? M.toneMappingExposure : 1;
    r.shadowMap.enabled = true;
    r.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x7f95b5, 0.95));
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(0.5, 1.6, 0.9); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5, near: 0.1, far: 4 });
    scene.add(key);
    const tray = trayModel(); scene.add(tray);
    const cam = new THREE.PerspectiveCamera(30, 1.5, 0.05, 10);
    cam.position.set(0, SAND + 0.98 * W / 0.6, 0.44 * W / 0.6); cam.lookAt(0, SAND, 0.03 * W / 0.6);
    const cv = r.domElement; cv.className = 'tray-cv';
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf6c443, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.visible = false; ring.renderOrder = 3; scene.add(ring);
    const count = U.el('span', { class: 'tray-count' }), sel = U.el('div', { class: 'tray-sel' }), strip = U.el('div', { class: 'tray-strip' });
    const status = U.el('span', { class: 'tray-status', role: 'status' });
    const btn = (text, fn, title) => U.el('button', { type: 'button', class: 'tray-btn', title: title || text, onclick: fn }, text);
    const card = U.el('div', { class: 'hud-card tray', role: 'dialog', 'aria-label': '沙盘展示盒' },
      U.el('div', { class: 'hud-card-head' },
        U.el('span', { class: 'hud-card-title' }, '沙盘展示盒'), count, status,
        U.el('span', { class: 'tray-head-btns' }, btn('拍照', photo, '把现在的沙盘存成一张图'), btn('清空', clearAll, '把沙盘里的贝壳都收回柜子')),
        U.el('button', { class: 'hud-x', type: 'button', title: '关闭', 'aria-label': '关闭', onclick: () => T.close() }, '✕')),
      U.el('div', { class: 'tray-main' }, U.el('div', { class: 'tray-stage' }, cv, sel), strip));
    E = { r, scene, tray, cam, cv, ring, card, count, sel, strip, status, items: [], rev: -1, dirty: false, saveT: 0, shells: null, own: new Map(),
      selUid: null, drag: null, ghost: null, raf: 0, ray: new THREE.Raycaster(), ndc: new THREE.Vector2(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -SAND) };
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('wheel', (e) => { if (!E.selUid) return; e.preventDefault(); turn(e.deltaY > 0 ? 15 : -15); }, { passive: false });
    card.addEventListener('keydown', (e) => {
      if (!E.selUid) return;
      if (e.key === 'q' || e.key === 'Q') turn(-15); else if (e.key === 'e' || e.key === 'E') turn(15);
      else if (e.key === 'Delete' || e.key === 'Backspace') remove(E.selUid);
    });
  }
  function load() {   // 从存档读进编辑器（没有没存的改动时才读，免得冲掉）
    const x = inv(); if (!x || E.dirty) return;
    if (x.tray.rev === E.rev && E.items.length === x.tray.items.length) return;
    E.rev = x.tray.rev; E.items = x.tray.items.map((t) => ({ ...t }));
    if (E.selUid && !E.items.some((t) => t.uid === E.selUid)) E.selUid = null;
    redraw();
  }
  function redraw() {
    if (!E) return;
    E.own = owners();
    if (E.shells) E.shells.removeFromParent();
    E.shells = contents(E.items, E.own); E.tray.add(E.shells);
    E.count.textContent = `${E.items.length} / ${R().TRAY.max}`;
    fillSel(); fillStrip();
  }
  function fillSel() {
    const t = E.items.find((x) => x.uid === E.selUid), own = t && E.own.get(t.uid);
    E.sel.textContent = ''; E.sel.hidden = !t;
    const holder = t && E.shells.children.find((c) => c.userData.uid === t.uid);
    E.ring.visible = !!holder;
    if (!t || !own) return;
    const k = V3.game.kind(own.kind), b = new THREE.Box3().setFromObject(holder), r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 + 0.008;
    E.ring.scale.setScalar(r); E.ring.position.set(holder.position.x, SAND + 0.002, holder.position.z);
    const b2 = (text, fn, title) => U.el('button', { type: 'button', class: 'tray-btn sm', title, onclick: fn }, text);
    E.sel.append(U.el('span', { class: 'tray-sel-name' }, (k ? k.name : own.kind) + ' · ' + own.item.size.toFixed(1) + ' mm'),
      b2('⟲', () => turn(-15), '向左转 15°（Q）'), b2('⟳', () => turn(15), '向右转 15°（E / 滚轮）'),
      b2(t.flip ? '翻回来' : '翻面', () => { t.flip = !t.flip; changed(); }, '底朝上 / 正面朝上'), b2('拿走', () => remove(t.uid), '收回柜子（Delete）'));
  }
  // 下面一排：能摆的贝壳（没摆着、没在沙盘里），按种类分组；大的在前
  function fillStrip() {
    const used = new Set(E.items.map((t) => t.uid)), x = inv(), placed = R().usedUids(x, 'tray');
    E.strip.textContent = '';
    let any = false;
    for (const k of V3.game.kinds()) {
      const f = x && x.found[k.id]; if (!f) continue;
      const free = f.items.filter((it) => !used.has(it.uid) && !placed.has(it.uid)).sort((a, b) => b.size - a.size);
      if (!free.length) continue;
      any = true;
      const grp = U.el('div', { class: 'tray-grp' }, U.el('span', { class: 'tray-grp-name' }, k.name));
      for (const it of free) {
        let src = null;
        try { src = V3.shellIcons.get(k.id, { size: H.iconPx(40), pat: it.pat }); } catch (e) { src = null; }
        const el = U.el('button', { type: 'button', class: 'tray-pick', title: `${k.name} ${it.size.toFixed(1)} mm（拖到沙子上）` },
          src ? U.el('img', { src, alt: '', draggable: 'false' }) : U.el('i', { class: 'tray-dot' }), U.el('span', null, Math.round(it.size)));
        el.addEventListener('pointerdown', (e) => fromStrip(e, el, k.id, it));
        grp.append(el);
      }
      E.strip.append(grp);
    }
    if (!any) E.strip.append(U.el('div', { class: 'tray-empty' }, E.items.length ? '能摆的贝壳都在沙盘里了。' : '还没有能摆的贝壳：去沙滩捡一些，或者把摆在外面的收回柜子。'));
  }
  function changed() {
    E.dirty = true; redraw();
    clearTimeout(E.saveT); E.saveT = setTimeout(save, SAVE_MS);
    E.status.textContent = '…';
  }
  async function save() {
    if (!E || !E.dirty || saving) { if (E && E.dirty) E.saveT = setTimeout(save, SAVE_MS); return; }
    const items = E.items.map((t) => ({ ...t }));
    saving = commit(items, 'player');
    const r = await saving; saving = null;
    if (!E) return;
    if (!r.ok) {
      E.status.textContent = '';
      toast(r.code === 'tray_changed' ? '展示盒刚被改过（可能是小鲸鱼摆的），已换成最新的样子。' : r.error, '#f5aa73');
      E.dirty = false; E.rev = -1; load();
      return;
    }
    if (JSON.stringify(items) === JSON.stringify(E.items)) { E.dirty = false; E.rev = r.inventory.tray.rev; E.status.textContent = '已保存'; }
  }
  function turn(deg) { const t = E.items.find((x) => x.uid === E.selUid); if (!t) return; t.ry = round3(t.ry + deg * Math.PI / 180); changed(); }
  function remove(uid) { E.items = E.items.filter((t) => t.uid !== uid); if (E.selUid === uid) E.selUid = null; changed(); }
  function clearAll() {
    if (!E.items.length) return;
    if (!(E.clearT > performance.now())) { E.clearT = performance.now() + 3000; toast('再点一次「清空」，把沙盘里的贝壳都收回柜子。'); return; }
    E.items = []; E.selUid = null; changed();
  }
  function photo() {
    const url = snapshot({ size: 1024, items: E.items, type: 'image/png' });
    if (!url) return;
    const a = U.el('a', { href: url, download: '沙盘展示盒-' + new Date().toISOString().slice(0, 10) + '.png' });
    a.click();
    toast('拍好了，图片已经保存。');
  }
  // 屏幕坐标 → 沙面上的厘米坐标（不在沙盘里 → null）
  function sandAt(cx, cy) {
    const rc = E.cv.getBoundingClientRect();
    E.ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1);
    E.ray.setFromCamera(E.ndc, E.cam);
    const p = E.ray.ray.intersectPlane(E.plane, new THREE.Vector3());
    if (!p) return null;
    const x = p.x * 100, z = p.z * 100, T2 = R().TRAY;
    return Math.abs(x) <= T2.w / 2 && Math.abs(z) <= T2.d / 2 ? { x: round1(clampX(x)), z: round1(clampZ(z)) } : null;
  }
  function shellAt(cx, cy) {
    const rc = E.cv.getBoundingClientRect();
    E.ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1);
    E.ray.setFromCamera(E.ndc, E.cam);
    const hit = E.ray.intersectObject(E.shells, true)[0];
    for (let o = hit && hit.object; o; o = o.parent) if (o.userData.uid) return o.userData.uid;
    return null;
  }
  function onDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const uid = shellAt(e.clientX, e.clientY);
    E.selUid = uid; fillSel();
    if (!uid) return;
    const t = E.items.find((x) => x.uid === uid), p = sandAt(e.clientX, e.clientY);
    if (!t || !p) return;
    try { E.cv.setPointerCapture(e.pointerId); } catch (_) { /* 没关系 */ }
    E.drag = { id: e.pointerId, t, dx: t.x - p.x, dz: t.z - p.z, moved: false };
    const move = (ev) => {
      const d = E && E.drag; if (!d || ev.pointerId !== d.id) return;
      const q = sandAt(ev.clientX, ev.clientY); if (!q) return;
      d.t.x = round1(clampX(q.x + d.dx)); d.t.z = round1(clampZ(q.z + d.dz)); d.moved = true;
      const h = E.shells.children.find((c) => c.userData.uid === d.t.uid);
      if (h) { h.position.x = d.t.x / 100; h.position.z = d.t.z / 100; E.ring.position.x = h.position.x; E.ring.position.z = h.position.z; }
    };
    const up = (ev) => {
      const d = E && E.drag; if (!d || ev.pointerId !== d.id) return;
      E.cv.removeEventListener('pointermove', move); E.cv.removeEventListener('pointerup', up); E.cv.removeEventListener('pointercancel', up);
      E.drag = null;
      if (d.moved) changed();
    };
    E.cv.addEventListener('pointermove', move); E.cv.addEventListener('pointerup', up); E.cv.addEventListener('pointercancel', up);
  }
  // 从下面一排拖一枚出来：指针在沙盘上时预览跟着走，松手放下
  function fromStrip(e, el, kind, it) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    if (E.items.length >= R().TRAY.max) { toast(`沙盘里最多摆 ${R().TRAY.max} 枚。`); return; }
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* 没关系 */ }
    const t = { uid: it.uid, x: 0, z: 0, ry: round3((Math.random() - 0.5) * 1.2) };
    const ghost = shellObj(t, { kind, item: it }); ghost.visible = false; E.tray.add(ghost);
    const d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, at: null };
    const move = (ev) => {
      if (ev.pointerId !== d.id) return;
      d.at = sandAt(ev.clientX, ev.clientY);
      ghost.visible = !!d.at;
      if (d.at) { ghost.position.x = d.at.x / 100; ghost.position.z = d.at.z / 100; }
    };
    const up = (ev) => {
      if (ev.pointerId !== d.id) return;
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      ghost.removeFromParent();
      if (ev.type === 'pointerup' && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 6) {
        // 只是点了一下：放在沙盘中间附近空一点的地方
        const n = E.items.length;
        d.at = { x: round1(clampX(((n * 7.3) % 40) - 20)), z: round1(clampZ(((n * 5.1) % 24) - 12)) };
      }
      if (ev.type !== 'pointerup' || !d.at) return;
      E.items.push({ ...t, x: d.at.x, z: d.at.z });
      E.selUid = t.uid;
      changed();
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  function frame() {
    if (!E) return;
    const box = E.cv.parentElement.getBoundingClientRect(), w = Math.max(200, Math.round(box.width)), h = Math.max(150, Math.round(box.height));
    if (E.cv.width !== Math.round(w * E.r.getPixelRatio()) || E.cv.height !== Math.round(h * E.r.getPixelRatio())) {
      E.r.setSize(w, h, false); E.cam.aspect = w / h;
      // 整个沙盘都在画面里：窄屏时退远一点
      const k = Math.max(1, 1.5 / E.cam.aspect);
      const s = k * W / 0.6;
      E.cam.position.set(0, SAND + 0.98 * s, 0.44 * s); E.cam.lookAt(0, SAND, 0.03 * s); E.cam.updateProjectionMatrix();
    }
    E.r.render(E.scene, E.cam);
    E.raf = requestAnimationFrame(frame);
  }
  function closeEditor() {
    if (!E) return;
    if (E.dirty) { clearTimeout(E.saveT); const items = E.items.map((t) => ({ ...t })); void commit(items, 'player').then((r) => { if (!r.ok) toast(r.error, '#f5aa73'); }); }
    cancelAnimationFrame(E.raf);
    E.ring.geometry.dispose(); E.ring.material.dispose();
    E.r.dispose(); E.r.forceContextLoss();
    E = null;
  }

  // ---- 小鲸鱼的工具 sand_tray（58-cabin-tools；桥接见 docs/CABIN-TOOLS-BRIDGE.md）----
  // look：看看沙盘现在摆了什么、还有哪些贝壳能用；apply：按顺序执行 ops（place / move / remove / clear），整盘存档（by 'girl'，via = 对话 id），
  // 然后她走到沙盘前看一眼（场景里贝壳一枚接一枚落下）。两种都回：文字说明 + 俯视草图（字符格子）+ 可选的俯视截图。
  const deg = (r) => Math.round(((r * 180 / Math.PI) % 360 + 360) % 360), rad = (d) => round3(d * Math.PI / 180);
  const SYM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function kindOf(q) {
    if (typeof q !== 'string' || !q.trim()) return null;
    q = q.trim();
    return V3.game.kinds().find((k) => k.id === q || k.name === q) || V3.game.kinds().find((k) => k.name.includes(q) || q.includes(k.name)) || null;
  }
  function freeItems(items) {
    const x = inv(), inTray = new Set(items.map((t) => t.uid)), placed = x ? R().usedUids(x, 'tray') : new Set(), out = new Map();
    for (const [kind, f] of Object.entries(x ? x.found : {})) {
      const list = f.items.filter((it) => !inTray.has(it.uid) && !placed.has(it.uid));
      if (list.length) out.set(kind, list);
    }
    return out;
  }
  function choose(list, prefer) {
    const rare = (it) => (R().pattern(it.pat).rare ? 1 : 0);
    const by = prefer === 'small' ? (a, b) => a.size - b.size : prefer === 'rare' ? (a, b) => rare(b) - rare(a) || b.size - a.size : (a, b) => b.size - a.size;
    return list.slice().sort(by)[0] || null;
  }
  function applyOps(start, ops) {
    let items = start.map((t) => ({ ...t }));
    const results = [], T2 = R().TRAY, num = (v) => typeof v === 'number' && Number.isFinite(v);
    const place = (t, o) => {
      let clamped = false;
      if (num(o.x)) { const v = clampX(o.x); clamped = clamped || v !== o.x; t.x = round1(v); }
      if (num(o.z)) { const v = clampZ(o.z); clamped = clamped || v !== o.z; t.z = round1(v); }
      if (num(o.ry)) t.ry = rad(o.ry);
      if (typeof o.flip === 'boolean') { if (o.flip) t.flip = true; else delete t.flip; }
      return clamped;
    };
    (Array.isArray(ops) ? ops : []).slice(0, 200).forEach((o, i) => {
      const r = { i, op: o && o.op };
      results.push(r);
      if (!o || typeof o !== 'object') { r.error = 'bad_op'; return; }
      if (o.op === 'clear') { items = []; r.ok = true; return; }
      if (o.op === 'remove' || o.op === 'move') {
        const t = items.find((x) => x.uid === o.uid);
        if (!t) { r.error = 'not_in_tray'; return; }
        if (o.op === 'remove') items = items.filter((x) => x !== t); else r.clamped = place(t, o) || undefined;
        r.ok = true; r.uid = t.uid; return;
      }
      if (o.op !== 'place') { r.error = 'bad_op'; return; }
      if (!num(o.x) || !num(o.z)) { r.error = 'need_x_z'; return; }
      if (items.length >= T2.max) { r.error = 'tray_full'; return; }
      const free = freeItems(items);
      let it = null, kind = null;
      if (o.uid) {
        for (const [k, list] of free) { const f = list.find((x) => x.uid === o.uid); if (f) { it = f; kind = k; } }
        if (!it) { r.error = items.some((x) => x.uid === o.uid) ? 'already_in_tray' : 'not_available'; return; }
      } else {
        const k = kindOf(o.kind);
        if (!k) { r.error = 'unknown_kind'; return; }
        kind = k.id; it = choose(free.get(k.id) || [], o.prefer);
        if (!it) { r.error = 'none_free'; r.kind = k.id; return; }
      }
      const t = { uid: it.uid, x: 0, z: 0, ry: 0 };
      r.clamped = place(t, o) || undefined;
      items.push(t);
      Object.assign(r, { ok: true, uid: it.uid, kind });
    });
    return { items, results };
  }
  // 俯视草图：每格 3 × 3 cm（90 × 60 的沙盘 = 30 × 20 格），每种贝壳一个字母，按尺寸占格子；上 = 靠墙（后）、下 = 朝外（前）
  function sketch(items, own) {
    const T2 = R().TRAY, C = 3, cols = Math.round(T2.w / C), rows = Math.round(T2.d / C), g = Array.from({ length: rows }, () => Array(cols).fill('.'));
    const sym = new Map();
    for (const t of items) {
      const o = own.get(t.uid); if (!o) continue;
      if (!sym.has(o.kind)) sym.set(o.kind, SYM[sym.size % SYM.length]);
      const s = sym.get(o.kind), r = o.item.size / 10 / 2;   // 半径（厘米）≈ 最长边的一半
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const cx = -T2.w / 2 + (x + 0.5) * C, cz = -T2.d / 2 + (y + 0.5) * C;
        if (Math.hypot(cx - t.x, cz - t.z) <= Math.max(r * 0.8, C * 0.6)) g[y][x] = s;
      }
    }
    const legend = [...sym].map(([k, s]) => s + '=' + ((V3.game.kind(k) || {}).name || k)).join(' ');
    return ['+' + '-'.repeat(cols) + '+  ← 后（靠墙）', ...g.map((r) => '|' + r.join('') + '|'), '+' + '-'.repeat(cols) + '+  ← 前（朝外）', '图例：' + (legend || '（空）')].join('\n');
  }
  const ERR = { bad_op: '看不懂这一步', not_in_tray: '沙盘里没有这一枚', need_x_z: '放的时候要给 x 和 z', tray_full: '沙盘满了（最多 80 枚）',
    already_in_tray: '这一枚已经在沙盘里了，用 move', not_available: '这一枚现在不能用（不在收藏里或摆在别处）', unknown_kind: '不认识这种贝壳', none_free: '这一种没有空闲的了' };
  function report(items, results, own) {
    const T2 = R().TRAY, lines = [`沙盘展示盒：内框 ${T2.w} × ${T2.d} 厘米。坐标单位厘米，原点在正中间；x 从 -${T2.w / 2}（左）到 ${T2.w / 2}（右），z 从 -${T2.d / 2}（后，靠墙）到 ${T2.d / 2}（前，朝外）；朝向 ry 用角度。贝壳都是真实大小（尺寸是最长边，毫米）。`];
    if (results) {
      lines.push('', '这次的操作：');
      for (const r of results) {
        const o = r.uid && own.get(r.uid), name = o ? (V3.game.kind(o.kind) || {}).name : r.kind ? (V3.game.kind(r.kind) || {}).name : '';
        lines.push(`  ${r.i + 1}. ${r.op || '?'} ${r.ok ? '成功' : '失败：' + (ERR[r.error] || r.error)}${name ? ' ' + name : ''}${r.uid ? '（' + r.uid + '）' : ''}${r.clamped ? '（超出边界，已挪回沙盘里）' : ''}`);
      }
    }
    lines.push('', `现在摆着 ${items.length} / ${T2.max} 枚：`);
    for (const t of items) {
      const o = own.get(t.uid); if (!o) continue;
      const k = V3.game.kind(o.kind), pat = R().pattern(o.item.pat), c = R().crown(k, o.item.size);
      lines.push(`  - ${t.uid}：${k ? k.name : o.kind} ${o.item.size.toFixed(1)}mm ${pat.name}${c ? (c === 'big' ? ' 大金冠' : ' 小金冠') : ''} 在 (${t.x}, ${t.z}) 朝向 ${deg(t.ry)}°${t.flip ? ' 翻面' : ''}`);
    }
    lines.push('', '俯视草图（每格 3 厘米）：', sketch(items, own));
    const free = freeItems(items);
    lines.push('', '还能用的贝壳（place 时给 kind 就行，会挑一枚；prefer: big / small / rare）：');
    if (!free.size) lines.push('  （没有了）');
    for (const [kind, list] of free) {
      const k = V3.game.kind(kind), sizes = list.map((it) => it.size), rare = list.filter((it) => R().pattern(it.pat).rare).length;
      lines.push(`  - ${kind}（${k ? k.name : kind}）× ${list.length}，${Math.min(...sizes).toFixed(0)}–${Math.max(...sizes).toFixed(0)} mm${rare ? `，其中稀有花纹 ${rare} 枚` : ''}`);
    }
    return lines.join('\n');
  }
  function lookAt() {   // 她走到沙盘前，面朝沙盘待一会儿（不说话：对话里她自己会说）
    const a = V3.actor, sp = spot();
    if (!a || !sp || a.behavior || a.resting || a.held || !['idle', 'wander'].includes(a.state) || !a.goto) return;
    void Promise.resolve(a.goto(sp.approach[0], sp.approach[2], sp.approach[1])).then((ok) => {
      if (ok && a.respond && !a.behavior) a.respond('', { seconds: 3, facePoint: sp.position });
    }).catch(() => {});
  }
  async function runTool(args, ctx) {
    if (!I || !I.ready) return { ok: false, error: 'inventory_unavailable', text: '小屋存档还没读好，等一会儿再试。' };
    if (I.serverV1) return { ok: false, error: 'old_server', text: '小屋服务还是旧版存档，沙盘用不了（需要升级到 v2）。' };
    const wantImage = args.image !== false;
    if (args.action !== 'apply') {
      const items = trayItems(), own = owners();
      return { ok: true, text: report(items, null, own), result: { items }, ...(wantImage ? { image: snapshot({ items }) || undefined } : {}) };
    }
    let out = null;
    for (let tries = 0; tries < 2; tries++) {   // 别处（玩家的编辑器）刚改过：按最新的再做一遍
      out = applyOps(trayItems(), args.ops);
      if (!out.results.some((r) => r.ok)) break;
      const r = await commit(out.items, 'girl', ctx.via);
      if (r.ok) { out.saved = true; break; }
      if (r.code !== 'tray_changed') return { ok: false, error: r.code || 'save_failed', text: '存档失败：' + r.error };
    }
    const items = out.saved ? trayItems() : out.items, own = owners();
    if (out.saved) {
      const n = out.results.filter((r) => r.ok && r.op === 'place').length;
      V3.emit('game:cabin-event', { type: 'tray_arrange', id: I.id('tray-event'), at: Date.now(), text: `她在门廊的沙盘里${n ? '摆了' + n + '枚贝壳' : '重新摆了贝壳'}`,
        detail: { by: 'girl', via: ctx.via, placed: n, total: items.length } });
      lookAt();
    }
    return { ok: out.results.every((r) => r.ok), text: report(items, out.results, own), result: { items, results: out.results, saved: !!out.saved },
      ...(wantImage ? { image: snapshot({ items }) || undefined } : {}) };
  }
  if (V3.cabinTools) V3.cabinTools.register({
    name: 'sand_tray',
    description: `门廊上的沙盘展示盒（${TRAY0.w} × ${TRAY0.d} 厘米的沙子，贝壳按真实大小摆放）。你可以用它把收集到的贝壳摆成图案给玩家看。` +
      'action=look 先看看现在摆了什么、还有哪些贝壳能用；action=apply 按顺序执行 ops 并保存，返回摆好后的文字说明、俯视草图和俯视图。' +
      `坐标单位厘米，原点在沙盘正中：x 向右（-${TRAY0.w / 2}…${TRAY0.w / 2}），z 向前（-${TRAY0.d / 2} 靠墙…${TRAY0.d / 2} 朝外）；ry 是朝向角度。贝壳最长边 3–20 厘米，摆的时候留够间距。`,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['look', 'apply'], description: 'look = 只看；apply = 执行 ops 并保存' },
        ops: {
          type: 'array', maxItems: 200, description: 'apply 时按顺序执行的操作',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['place', 'move', 'remove', 'clear'], description: 'place 放一枚；move 挪 / 转 / 翻已有的一枚；remove 拿走一枚；clear 全部拿走' },
              kind: { type: 'string', description: 'place：贝壳种类 id 或中文名（会从这一种里挑一枚空闲的）' },
              uid: { type: 'string', description: '指定某一枚（look 的结果里有）；move / remove 必须给' },
              prefer: { type: 'string', enum: ['big', 'small', 'rare'], description: 'place 只给 kind 时挑哪一枚：最大（默认）/ 最小 / 稀有花纹优先' },
              x: { type: 'number', description: `厘米，-${TRAY0.w / 2}（左）到 ${TRAY0.w / 2}（右）` },
              z: { type: 'number', description: `厘米，-${TRAY0.d / 2}（后，靠墙）到 ${TRAY0.d / 2}（前，朝外）` },
              ry: { type: 'number', description: '朝向，角度' },
              flip: { type: 'boolean', description: 'true = 翻过来底朝上' },
            },
            required: ['op'],
          },
        },
        image: { type: 'boolean', description: '要不要附俯视图（默认要；看不了图的模型可以传 false）' },
      },
      required: ['action'],
    },
    run: runTool,
  });

  const T = V3.sandTray = {
    open() {
      if (!I || !I.ready) { toast(I && I.error || '小屋存档还在加载'); return null; }
      if (I.serverV1) { toast('小屋服务还是旧版存档，展示盒要等它升级（见 docs/INVENTORY-V2.md）。', '#f5aa73'); return null; }
      if (!E) buildEditor();
      if (!H.modalOpen('tray')) H.modal(E.card, { name: 'tray', onClose: closeEditor });
      E.rev = -1; E.dirty = false; load();
      cancelAnimationFrame(E.raf); E.raf = requestAnimationFrame(frame);
      return E.card;
    },
    close: () => H.closeModal('tray'),
    isOpen: () => !!(H && H.modalOpen && H.modalOpen('tray')),
    items: () => trayItems().map((t) => ({ ...t })),
    owners, spot, snapshot, commit, contents, trayModel, applyOps, sketch,
    objects: () => (live && live.root.visible ? [live.root] : []),
    SAND, W, D,
  };
  V3.on('inventory:change', () => {
    if (!E) return;
    if (E.dirty || E.rev === inv().tray.rev) fillStrip(); else load();
  });
  V3.on('game:open', (what) => { if (what === 'tray' && H.mounted) T.open(); });

  // ---- token ----
  V3.viewTokens.tray = (v) => { if (v !== '0') T.open(); else T.close(); };
  // traytool=heart|look：按小鲸鱼的工具调一次（heart = 用能用的贝壳摆个爱心），把回给模型的图和文字铺在屏幕上（核对用）
  V3.viewTokens.traytool = async (v) => {
    const ops = [];
    if (v === 'heart') {
      ops.push({ op: 'clear' });
      const kinds = [...freeItems([]).keys()];
      for (let i = 0; i < 16; i++) {
        const t = (i / 16) * Math.PI * 2, x = 16 * Math.sin(t) ** 3, z = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        ops.push({ op: 'place', kind: kinds[i % kinds.length], prefer: 'small', x: round1(x * 2.2), z: round1(z * 1.6 + 2), ry: Math.round(t * 57) });
      }
    }
    const r = await V3.cabinTools.call('sand_tray', v === 'heart' ? { action: 'apply', ops } : { action: 'look' }, { via: 'token' });
    const old = document.getElementById('v3-traytool'); if (old) old.remove();
    document.body.append(U.el('div', { id: 'v3-traytool', style: { position: 'fixed', inset: '0', zIndex: '70', display: 'flex', gap: '12px', padding: '12px', background: '#1e2a56' } },
      r.image ? U.el('img', { src: r.image, style: { width: '512px', height: '512px', flex: 'none' } }) : null,
      U.el('pre', { style: { margin: '0', color: '#fff', font: '11px/1.25 monospace', whiteSpace: 'pre-wrap', overflow: 'hidden' } }, r.text)));
  };
  V3.viewTokens.traydemo = async (v) => {   // 本地存档：把能用的贝壳随便摆 n 枚（截图用）
    if (!I.ready || I.remote) return;
    const n = Math.max(1, Math.min(R().TRAY.max, Number(v) || 12)), x = inv(), placed = R().usedUids(x, 'tray'), items = [];
    for (const f of Object.values(x.found)) for (const it of f.items) if (!placed.has(it.uid) && items.length < n) {
      const i = items.length;
      items.push({ uid: it.uid, x: round1(-38 + (i % 8) * 11), z: round1(-22 + Math.floor(i / 8) * 13), ry: round3(i * 0.7) });
    }
    await commit(items, 'player');
  };
})(window.V3);
