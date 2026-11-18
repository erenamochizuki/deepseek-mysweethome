// src/57-shell-display.js — 场景部件 shell-display（order 52）：阁楼贝壳柜里摆贝壳（SPEC-4 §4）。
// 第 i 格放 V3.shells.KINDS[i]，找到了才放。格子来自贝壳柜 root.userData.slots / slotSize（fbui，57-furn-loft.js）。
// P5 起贝壳柜是模组方块（xiaojingyu:shell_case，在房子的鲸图里，54-house-mc 画）：等房子读好，在柜子那两格放一个空的「柜子」组，
// 格子按 44-furn-mc 的规格（朝北、主格 left 的方块内坐标，单位格）转到柜子的朝向上。
// 每帧对一遍 V3.game.st.found（读档、found=N、reset 都会改它）；'game:collect' 第一次找到的那一格闪两下，贝壳弹出来。
// 测试 token：shelfflash=i 让第 i 格停在闪光最亮的那一刻（截图用）。
(function (V3) {
  const FIT = [0.66, 0.74, 0.62], MAXK = 3.2, YAW = -0.25;   // 最多占格子 宽/高/深 的比例；最多放大几倍；略转向常用镜头（柜子左前方）
  const FLASH = 1.3, POP = 0.5;                                // 闪光、弹出时长（秒）
  let cur = null;                                              // 最近一次 build 的状态（给测试 token 用）
  const shelves = new Set();

  const backOut = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2; };

  function findCase(root) {
    let c = null;
    root.traverse((o) => { if (!c && o.userData && o.userData.clickable === 'shellBox' && Array.isArray(o.userData.slots)) c = o; });
    return c;
  }

  // 一只贝壳缩放进第 i 格：holder 在格子底面（贴着绒布，靠玻璃那边），按包围盒等比缩放，缩放中心是贝壳底部中点。
  function place(S, i, kind, pat) {
    const slot = S.slots[i], size = S.size;
    const shell = V3.shells.build(kind.id, { anchor: 'shelf:' + kind.id, pat });
    const holder = new THREE.Group(); holder.name = 'shelf:' + kind.id; holder.add(shell);
    shell.rotation.y = YAW; shell.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(shell, true), d = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const k = Math.min(MAXK, size[0] * FIT[0] / d.x, size[1] * FIT[1] / d.y, size[2] * FIT[2] / d.z);
    shell.position.set(-c.x, -b.min.y, -c.z);
    const front = slot[2] + size[2] / 2;                       // 格子里面最靠前（玻璃背面）的 z
    holder.position.set(slot[0], slot[1] - size[1] / 2 + 0.002, front - k * d.z / 2 - 0.025);
    holder.scale.setScalar(k);
    holder.userData.k = k;
    shell.traverse((m) => { if (m.isMesh) { m.userData.noShadow = true; m.castShadow = false; m.receiveShadow = true; } });
    S.group.add(holder);
    return holder;
  }

  function flash(S, i, hold) {
    const slot = S.slots[i], size = S.size;
    S.flashGeo = S.flashGeo || new THREE.PlaneGeometry(size[0], size[1]);
    const m = new THREE.Mesh(S.flashGeo, new THREE.MeshBasicMaterial({
      color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.name = 'shelf-flash' + i; m.renderOrder = 2;
    m.position.set(slot[0], slot[1], slot[2] + size[2] / 2 - 0.004);
    Object.assign(m.userData, { noPick: true, noShadow: true, anchor: 'shelf:flash' + i });
    S.group.add(m);
    S.fx.push({ m, i, t: hold ? FLASH * 0.25 : 0, hold: !!hold });
  }

  function sync(S) {
    const G = V3.game, found = G && G.st && G.st.found;
    if (!found || !V3.shells) return;
    let ks = V3.shells.KINDS;
    if (G.hosted) {
      const inv = G.inventory();
      if (S.inventory !== inv || !S.selection) {
        // 柜子里放「还能用的」：没摆出去、没进展示盒的那几枚；每种挑一枚最好看的（稀有花纹优先，再按大小）
        const C = V3.shellControls, I = V3.cabinInventory;
        const best = (id) => C && C.nicest ? C.nicest(id) : (I && I.available ? I.available(id)[0] : null);
        S.inventory = inv;
        S.picks = Object.create(null);
        S.selection = G.kinds().filter((k) => found[k.id] && (S.picks[k.id] = best(k.id)))
          .sort((a, b) => found[b.id].last - found[a.id].last || a.id.localeCompare(b.id)).slice(0, S.slots.length);
        S.exhibits = S.slots.map((_, index) => {
          const slot = S.key + ':' + index, placed = inv?.placements[slot];
          if (!placed) return null;
          const item = inv.found[placed.kind]?.items.find(row => row.uid === placed.uid);
          return item && { kind: G.kind(placed.kind), item, slot };
        });
        let automatic = 0; S.ordered = S.exhibits.map(exhibit => exhibit?.kind || S.selection[automatic++]);
      }
      ks = S.selection;
    }
    for (let i = 0; i < S.slots.length; i++) {
      const exhibit = S.exhibits?.[i];
      const k = (S.ordered || ks)[i], f = k && found[k.id], inst = exhibit?.item || (k && S.picks ? S.picks[k.id] : null);
      const want = f && f.n > 0 ? k.id + (inst && inst.pat && inst.pat !== 'plain' ? ':' + inst.pat : '') + (exhibit ? ':' + inst.uid : '') : null, have = S.shown[i];
      if (have && have.userData.kind !== want) {
        S.group.remove(have); S.shown[i] = null;
        for (const x of S.fx) if (x.i === i) x.t = FLASH;     // 这格的闪光也收掉
      }
      if (want && !S.shown[i]) {
        S.shown[i] = place(S, i, k, inst && inst.pat);
        S.shown[i].userData.kind = want;
        if (exhibit) Object.assign(S.shown[i].userData, { clickable: 'featuredShell', shellDecorSlot: exhibit.slot });
        if (S.pending.delete(k.id)) { S.shown[i].scale.setScalar(1e-3); flash(S, i); }
      }
    }
  }

  function tick(S, dt) {
    for (const x of S.fx) {
      if (!x.hold) x.t += dt;
      const u = Math.min(1, x.t / FLASH), h = S.shown[x.i];
      x.m.material.opacity = 0.6 * Math.sin(2 * Math.PI * u) ** 2 * (1 - 0.6 * u);   // 两下，第二下淡一些
      if (h) h.scale.setScalar(h.userData.k * (x.hold ? 1 : backOut(Math.min(1, x.t / POP))));
    }
    const done = S.fx.filter((x) => x.t >= FLASH);
    for (const x of done) { S.group.remove(x.m); x.m.material.dispose(); }
    if (done.length) S.fx = S.fx.filter((x) => x.t < FLASH);
  }

  // 方块版贝壳柜：房子的方块里每个 shell_case 的 left 格（主格）→ [{ x, y, z, facing }]（按格子编号排）。房子里没有贝壳柜就是 []（导入的房子可以拆掉它）
  const ROT = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };   // 正面（局部 +z）转到 facing
  function findBlockCases() {
    const HB = V3.houseBlocks;
    if (!HB || !HB.grid) return [];
    if (HB.furnInstances) return HB.furnInstances('xiaojingyu:shell_case').map((p) => ({ x: p.cell[0], y: p.cell[1], z: p.cell[2], facing: p.facing }));
    const G = HB.grid, out = [];
    for (let i = 0; i < G.cells.length; i++) {
      const s = G.st[G.cells[i]];
      if (!s || s.ns !== 'xiaojingyu' || s.id !== 'shell_case' || (s.props || {}).part !== 'left') continue;
      out.push({ x: G.org[0] + i % G.W, y: G.org[1] + Math.floor(i / (G.W * G.L)), z: G.org[2] + Math.floor(i / G.W) % G.L, facing: (s.props || {}).facing || 'north' });
    }
    return out;
  }
  // 规格里的格子（朝北，正面在 −z）→ 柜子组的局部坐标（正面在 +z，原点在主格底面中心）：转 180°
  function blockSlots(spec) {
    return { slots: spec.slots.map(([x, y, z]) => [0.5 - x, y, 0.5 - z]), size: spec.slotSize.slice() };
  }
  // 柜子在房子哪一层（剖开看一楼时阁楼的跟着藏；房子外面的不藏）
  function layerOf(c) {
    const HBk = V3.houseBlocks, H = (HBk && HBk.placedLayout ? HBk.placedLayout() : V3.layout).house;   // 房子挪过：按摆好以后的外墙
    if (c.x < H.x0 || c.x >= H.x1 || c.z < H.z0 || c.z >= H.z1) return null;
    return c.y >= H.loftY - 1 ? 'loft' : 'ground';
  }
  function newShelf(box, group, o) {
    const S = Object.assign({ box, group, slots: [], size: [0, 0, 0], shown: [], pending: new Set(), fx: [], flashGeo: null }, o || {});
    const blocks = V3.houseBlocks, cell = box.userData.cell || [0,0,0], centre = cell.map(value => value + .5);
    const local = blocks?.place ? blocks.unplacePoint(centre, blocks.place) : centre;
    S.key = 'case:' + (V3.shore?.houseId() || 'default') + ':' + local.map(Math.floor).join('.'); shelves.add(S);
    S.onCollect = V3.on('game:collect', (ev) => { if (ev && ev.first && ev.item) S.pending.add(ev.item.kind); });
    S.onReset = V3.on('game:reset', () => S.pending.clear());
    return S;
  }
  // 房子里每个贝壳柜一份：放一个「柜子」组在主格底面中心、转到柜子的朝向，12 个格子摆贝壳，点了打开收藏
  function placeBlockCases(ctx, list) {
    const spec = V3.furnMc && V3.furnMc.byBlock && V3.furnMc.byBlock('xiaojingyu:shell_case');
    const cases = findBlockCases();
    if (!cases.length) return;
    if (!spec || !Array.isArray(spec.slots) || !spec.slotSize) { V3.err('shell-display: 44-furn-mc 里没有贝壳柜的格子（slots / slotSize）'); return; }
    for (const c of cases) {
      const b = blockSlots(spec), box = new THREE.Group(), lay = layerOf(c);
      box.name = 'shell-case-block';
      Object.assign(box.userData, { clickable: 'shellBox', slots: b.slots, slotSize: b.size, cell: [c.x, c.y, c.z] }, lay ? { layer: lay } : {});
      box.position.set(c.x + 0.5, c.y, c.z + 0.5); box.rotation.y = ROT[c.facing] || 0;
      ctx.root.add(box);
      const group = new THREE.Group(); group.name = 'shell-display'; box.add(group);
      const S = newShelf(box, group, { slots: b.slots, size: b.size, shown: new Array(b.slots.length).fill(null), block: true });
      list.push(S);
      sync(S);
    }
    cur = list[0] || null;
  }

  V3.scene.part({
    id: 'shell-display', label: '贝壳柜里的贝壳', order: 52,
    build(ctx) {
      if (!V3.shells) { V3.err('shell-display: V3.shells missing'); return null; }
      const list = ctx._shelves = [];
      let box = findCase(ctx.root);
      if (!box && V3.layout.house && V3.layout.house.blocks && V3.houseBlocks && V3.houseBlocks.load) {   // 方块版：房子的方块读好就按方块摆（建场景时一般已经读好）
        const HB = V3.houseBlocks, go = () => { if (ctx._shelves === list) placeBlockCases(ctx, list); };
        if (HB.whenGrid) HB.whenGrid(ctx, go); else HB.load().then(go).catch((e) => V3.err('shell-display: ' + ((e && e.stack) || e)));
        return null;
      }
      if (!box) { V3.err('shell-display: 找不到贝壳柜（userData.clickable === shellBox）'); return null; }
      const group = new THREE.Group(); group.name = 'shell-display';
      box.add(group);                                          // 挂在柜子下面：跟着柜子的位置、朝向和楼层显隐，点到也算点柜子
      const S = newShelf(box, group, { slots: box.userData.slots, size: box.userData.slotSize, shown: new Array(box.userData.slots.length).fill(null) });
      list.push(S); cur = S;
      sync(S);
      return null;                                             // 已经挂在柜子下面，不用再加到 root
    },
    update(dt, t, ctx) {
      for (const S of ctx._shelves || []) { sync(S); if (S.fx.length) tick(S, dt); }
    },
    dispose(ctx) {
      for (const S of ctx._shelves || []) {
        shelves.delete(S);
        V3.off('game:collect', S.onCollect); V3.off('game:reset', S.onReset);
        for (const x of S.fx) x.m.material.dispose();
        if (S.flashGeo) S.flashGeo.dispose();
        if (S.group.parent) S.group.parent.remove(S.group);
        if (S.block && S.box.parent) S.box.parent.remove(S.box);
        if (cur === S) cur = null;
      }
      ctx._shelves = null;
    },
  });

  // 测试用：现在柜子在哪、几个格子、摆了几只（第一个柜子；all = 每个柜子）
  const info = (S) => ({ block: !!S.block, slots: S.slots.length, shown: S.shown.filter(Boolean).length,
    pos: S.box.position.toArray().map((v) => +v.toFixed(3)), rotY: +S.box.rotation.y.toFixed(3) });
  V3.shellDisplay = () => {
    if (!cur) return null;
    const all = [], root = V3.models && V3.models.current && V3.models.current() && V3.models.current().root;
    if (root) root.traverse((o) => { if (o.name === 'shell-display' && o.parent && o.parent.userData.clickable === 'shellBox' && o.parent.userData.slots) all.push(o.parent); });
    return Object.assign(info(cur), { all: all.map((b) => ({ pos: b.position.toArray().map((v) => +v.toFixed(3)), rotY: +b.rotation.y.toFixed(3), slots: b.userData.slots.length })) });
  };
  V3.shellCaseSlots = () => [...shelves].flatMap((shelf, cabinet) => shelf.slots.map((_, index) => ({
    id: shelf.key + ':' + index, name: `展柜${cabinet + 1} · 第 ${index + 1} 格`, empty: !shelf.shown[index],
  })));
  V3.viewTokens = V3.viewTokens || {};
  V3.viewTokens.shelfflash = (v) => { if (cur) flash(cur, Math.max(0, Math.min(cur.slots.length - 1, Number(v) || 0)), true); };
})(window.V3);
