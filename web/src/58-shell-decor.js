// Cabin shell placements: fixed supports in the built block house, separate from the collection cabinet.
// Inventory owns placement/return. This part only resolves supports and draws their current occupants.
(function (V3) {
  'use strict';
  const EPS = 1e-5, LIFT = 0.002, YAW = -0.25;
  const SILL = { id: 'loft-window', label: '阁楼窗台', fit: [0.22, 0.24, 0.22] };
  const TABLE = { id: 'coffee-table', label: '小茶几', fit: [0.19, 0.22, 0.19] };
  const FLOORS = [
    { id: 'ground-floor', label: '一楼地板', fit: [0.28, 0.24, 0.28], floor: true, layer: 'ground' },
    { id: 'loft-floor', label: '阁楼地板', fit: [0.28, 0.24, 0.28], floor: true, layer: 'loft' },
  ];
  const IN = { w: [1, 0], e: [-1, 0], n: [0, 1], s: [0, -1] };
  const AXIS_DIRS = { w: ['west', 'east'], e: ['west', 'east'], n: ['north', 'south'], s: ['north', 'south'] };
  const close = (a, b) => Math.abs(a - b) < EPS;
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const cellOf = (p) => p.map(Math.floor);
  const inside = (H, x, z) => x >= H.x0 + H.wallT && x < H.x1 - H.wallT && z >= H.z0 + H.wallT && z < H.z1 - H.wallT;
  const at = (HB, p) => HB.grid.at(...p);
  const offsets = (r) => [[0, 0], [-r, -r], [-r, r], [r, -r], [r, r]];
  const place = (HB, p) => HB.placePoint && HB.place ? HB.placePoint(p, HB.place) : p;
  const yaw = (HB) => HB.placeYaw && HB.place ? HB.placeYaw(YAW, HB.place) : YAW;

  // Require a known structural surface, not the conservative full-cell collision approximation
  // for an unknown imported block, furniture, glass or a fence.
  function support(HB, p, r) {
    const [x, y, z] = p, by = Math.ceil(y) - 1;
    return offsets(r).every(([dx, dz]) => {
      const bx = Math.floor(x + dx), bz = Math.floor(z + dz), s = at(HB, [bx, by, bz]);
      if (!s || s.ns !== 'minecraft' || !/(?:_planks|_log|_wood|_concrete|_bricks?|_terracotta|_slab)$|^(?:stone|cobblestone|smooth_quartz|quartz_block|calcite|bricks)$/.test(s.id)) return false;
      const fx = x + dx - bx, fz = z + dz - bz;
      return HB.boxes(s).some((b) => close(by + b[4], y) && fx >= b[0] && fx < b[3] && fz >= b[2] && fz < b[5]);
    });
  }

  // Do not decorate over a rug, cable, etc. just because it doesn't block navigation.
  // The only exemption is the specific cell containing the known tabletop or pane lip.
  function free(HB, p, fit, host) {
    const [x, y, z] = p;
    for (const [dx, dz] of offsets(Math.max(fit[0], fit[2]) / 2)) {
      for (let h = Math.floor(y + EPS); h <= Math.floor(y + fit[1] + LIFT); h++) {
        const c = [Math.floor(x + dx), h, Math.floor(z + dz)];
        if ((!host || !c.every((v, i) => v === host[i])) && at(HB, c)) return false;
      }
    }
    return true;
  }

  // Search only the nearby nav-grid cell centres on the same storey, from which the shell is
  // within reach. Verify both connectivity (not an isolated landing) and a clear reach to it.
  function approach(HB, H, nav, p, base, host, min, max, side) {
    const C = nav.C, [x, y, z] = p, candidates = [], [nx, nz] = side ? IN[side] : [0, 0];
    const clearReach = (sx, sz, d) => {
      const hand = base + 0.98, end = y + 0.08, steps = Math.ceil(d / 0.08);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, px = sx + (x - sx) * t, py = hand + (end - hand) * t, pz = sz + (z - sz) * t;
        if (host && Math.floor(px) === host[0] && Math.floor(py) === host[1] && Math.floor(pz) === host[2]) continue;
        if (HB.solids(px, pz).some(([lo, hi]) => lo + EPS < py && py < hi - EPS) ||
            HB.furnSolids(px, pz).some(([lo, hi]) => lo + EPS < py && py < hi - EPS)) return false;
      }
      return true;
    };
    for (let iz = Math.floor((z - max - nav.z0) / C); iz <= Math.floor((z + max - nav.z0) / C); iz++) {
      for (let ix = Math.floor((x - max - nav.x0) / C); ix <= Math.floor((x + max - nav.x0) / C); ix++) {
        const sx = nav.x0 + (ix + 0.5) * C, sz = nav.z0 + (iz + 0.5) * C, d = Math.hypot(sx - x, sz - z);
        if (d < min || d > max || (side && (sx - x) * nx + (sz - z) * nz < 0.45) || !inside(H, sx, sz)) continue;
        if (nav.walkable(sx, sz, base) && close(nav.heightAt(sx, sz, base), base) && nav.reachable(sx, sz, base)) candidates.push({ sx, sz, d });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    const best = candidates.find(({ sx, sz, d }) => clearReach(sx, sz, d));
    return best && [best.sx, base, best.sz];
  }

  function sillSlot(HB, L, nav) {
    const H = L.house, w = L.openings?.find((o) => o.id === 'gableW'), side = w?.wall;
    if (!IN[side] || !Number.isInteger(w.y0) || w.y0 < H.loftY || w.y0 - H.loftY > 1.15) return null;
    const ew = side === 'w' || side === 'e', [nx, nz] = IN[side], fixed = side === 'w' ? H.x0 : side === 'e' ? H.x1 - 1 : side === 'n' ? H.z0 : H.z1 - 1;
    const scan0 = ew ? H.z0 : H.x0, scan1 = ew ? H.z1 : H.x1, panes = [];
    for (let a = scan0 + 1; a < scan1 - 1; a++) {
      const c = ew ? [fixed, w.y0, a] : [a, w.y0, fixed], s = at(HB, c);
      // A pane runs along the wall; its inner half-block is open. Full glass or a perpendicular
      // connection occupies that lip. Never put a shell inside it, or over a removed sill.
      if (s?.ns === 'minecraft' && /^(?:glass_pane|[a-z_]+_stained_glass_pane)$/.test(s.id) &&
          AXIS_DIRS[side].every((d) => s.props?.[d] === 'false') && s.props?.waterlogged !== 'true') {
        panes.push({ a, c });
      }
    }
    const expected = panes.filter(({ a }) => a >= w.a0 && a < w.a1);
    // If the original opening was moved along this wall, accept one unambiguous pane run.
    const candidates = expected.length ? expected : panes.every(({ a }, i) => !i || a === panes[i - 1].a + 1) ? panes : [];
    const localOpening = V3.layout.openings.find((o) => o.id === w.id);
    if (localOpening) {
      // Along-axis order in the placed layout can reverse when the whole house rotates.
      const preferred = place(HB, [V3.layout.house.x0 + 0.5, w.y0, localOpening.a0 + 0.5])[ew ? 2 : 0];
      candidates.sort((a, b) => Math.abs(a.a + 0.5 - preferred) - Math.abs(b.a + 0.5 - preferred));
    }
    for (const { c } of candidates) {
      const p = [c[0] + 0.5 + nx * 0.275, c[1], c[2] + 0.5 + nz * 0.275], sill = [c[0], c[1] - 1, c[2]];
      if (!support(HB, p, SILL.fit[0] / 2) || !free(HB, p, SILL.fit, c)) continue;
      const a = approach(HB, H, nav, p, H.loftY, c, 0.65, 1.65, side);
      if (a) return { ...SILL, position: p, approach: a, layer: 'loft', yaw: yaw(HB), cell: sill };
    }
    return null;
  }

  function tableSlot(HB, H, nav) {
    const rect = V3.layout.ground?.find((r) => r.id === 'coffee'), FM = V3.furnMc, spec = rect?.block && FM?.byBlock(rect.block);
    if (spec?.id !== 'living_rug' || !spec.extra?.some((o) => o.id === 'coffee')) return null;
    const home = FM.homeOf(spec);
    if (!home) return null;
    const center = place(HB, add(home.cell, [0.5, 0, 0.5])), tables = HB.furnInstances(spec.block);
    // Do not jump to a duplicate if the original table still exists but has become unusable.
    const t = tables.find(({ cell }) => center.every((v, i) => close(v, cell[i] + (i === 1 ? 0 : 0.5)))) || (tables.length === 1 && tables[0]);
    if (!t) return null;
    const base = t.cell[1], layer = close(base, H.floorY) ? 'ground' : close(base, H.loftY) ? 'loft' : null;
    if (!layer) return null;
    const cells = FM.cellsFor(spec, t.facing).map(({ offset, part }) => ({ part, cell: add(t.cell, offset) }));
    if (!cells.every(({ part, cell }) => {
      const s = at(HB, cell);
      return s && s.ns + ':' + s.id === spec.block && s.props?.facing === t.facing && String(s.props?.part) === String(part);
    })) return null;
    // The table is part 1. In living_rug_1's north-facing model, [12.5,7,10.5]/16
    // is a clear rectangle on the 7/16-high tabletop, between its props and outer edge.
    const c = cells.find(({ part }) => part === 1)?.cell;
    if (!c) return null;
    const p = add(c, FM.rotatePoint([12.5 / 16, 7 / 16, 10.5 / 16], t.facing));
    if (!inside(H, p[0], p[2]) || !support(HB, [p[0], base, p[2]], TABLE.fit[0] / 2) || !free(HB, p, TABLE.fit, c)) return null;
    const a = approach(HB, H, nav, p, base, c, 0.60, 1.45);
    return a && { ...TABLE, position: p, approach: a, layer, cell: c, yaw: FM.mover(home, t).yaw(YAW) };
  }

  function floorSlot(HB, H, nav, def) {
    const R = V3.layout.house, loft = def.layer === 'loft', base = loft ? H.loftY : H.floorY;
    // Two house-relative nooks along the western wall, away from the front door and stairs.
    // No relocation within the room if an edit obstructs one: the key means this spot only.
    const p = place(HB, [R.x0 + R.wallT + 0.45, base, loft ? R.z0 + R.wallT + 0.375 : R.z1 - R.wallT - 1.625]);
    if (!inside(H, p[0], p[2]) || !support(HB, p, def.fit[0] / 2) || !free(HB, p, def.fit) ||
        !nav.walkable(p[0], p[2], base) || !close(nav.heightAt(p[0], p[2], base), base) || !nav.reachable(p[0], p[2], base)) return null;
    const a = approach(HB, H, nav, p, base, null, 0.50, 1.05);
    return a && { ...def, position: p, approach: a, yaw: yaw(HB), cell: cellOf([p[0], base - EPS, p[2]]) };
  }

  let cached = null, active = null;
  function geometry() {
    const HB = V3.houseBlocks, nav = V3.nav, L = HB?.placedLayout?.() || V3.layout;
    if (!HB?.grid || !nav || !L?.house?.blocks) return [];
    if (!cached || cached.grid !== HB.grid || cached.v !== HB.version || cached.nav !== nav || cached.layout !== L) {
      const H = L.house, defs = [sillSlot(HB, L, nav), tableSlot(HB, H, nav), ...FLOORS.map((def) => floorSlot(HB, H, nav, def))].filter(Boolean);
      cached = { grid: HB.grid, v: HB.version, nav, layout: L, defs };
    }
    return cached.defs;
  }

  function remove(holder) {
    holder.removeFromParent();
    const resources = new Set();
    holder.traverse((o) => {
      if (o.geometry && !o.geometry.userData?.shared) resources.add(o.geometry);
      for (const m of [].concat(o.material || [])) if (!m.userData?.shared) resources.add(m);
    });
    for (const r of resources) r.dispose();
  }

  // inst = 摆出来的那一枚 { uid, size, pat }：用它的花纹；按它在本种尺寸区间里的位置，最小的缩到 85%
  function mount(group, def, kind, inst) {
    const shell = V3.shells.build(kind, { tag: false, anchor: 'shell-decor:' + def.id, pat: inst && inst.pat });
    shell.rotation.y = def.yaw;
    const b = new THREE.Box3().setFromObject(shell, true), d = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const R = V3.inventoryRules, t = inst && R ? R.sizeT(V3.game?.kind?.(kind), inst.size) : null;
    const k = Math.min(2.2, def.fit[0] / d.x, def.fit[1] / d.y, def.fit[2] / d.z) * (t == null ? 1 : 0.85 + 0.15 * t);
    shell.position.set(-c.x, -b.min.y, -c.z);
    shell.traverse((o) => { if (o.isMesh) { o.userData.noShadow = true; o.castShadow = false; o.receiveShadow = true; } });
    const holder = new THREE.Group(); holder.name = 'shell-decor:' + def.id;
    holder.userData.clickable = 'shellDecor'; holder.userData.shellDecorSlot = def.id;
    holder.position.set(def.position[0], def.position[1] + LIFT, def.position[2]);
    holder.scale.setScalar(k); holder.add(shell); group.add(holder);
    holder.updateWorldMatrix(true, true); // immediately raycastable when a click reads the new inventory snapshot
    return holder;
  }

  function sync(S) {
    const defs = geometry(), placements = V3.game?.inventory?.()?.placements, HB = V3.houseBlocks, hidden = HB?.live?.()?.hidden;
    for (const [id, r] of S.shown) {
      const def = defs.find((d) => d.id === id), p = placements?.[id];
      if (!def || r.def !== def || p?.id !== r.id || p.kind !== r.kind || p.uid !== r.uid) { remove(r.holder); S.shown.delete(id); }
    }
    for (const def of defs) {
      const p = placements?.[def.id];
      if (!p || !V3.shells?.has(p.kind)) continue;
      let r = S.shown.get(def.id);
      if (!r) {
        const f = V3.game?.inventory?.()?.found?.[p.kind], inst = p.uid && f && Array.isArray(f.items) ? f.items.find((it) => it.uid === p.uid) : null;
        r = { def, id: p.id, kind: p.kind, uid: p.uid, holder: mount(S.groups[def.layer], def, p.kind, inst) };
        S.shown.set(def.id, r);
      }
      // The shelf/floor parents handle the storey cut; also hide when the actual supporting cell
      // is cut away by the camera or temporarily absent during an arrangement drag.
      r.holder.visible = (S.ctx.state?.floor !== 'ground' || def.layer !== 'loft') &&
        (!HB?.visibleAt || HB.visibleAt(...def.cell)) && !hidden?.has(def.cell.join(','));
    }
  }

  V3.scene.part({
    id: 'shell-decor', label: '摆在屋里的贝壳', order: 53,
    build(ctx) {
      const root = new THREE.Group(); root.name = 'shell-decor';
      const groups = {};
      for (const layer of ['ground', 'loft']) {
        const g = groups[layer] = new THREE.Group(); g.userData.layer = layer; root.add(g);
      }
      const S = ctx._shellDecor = active = { ctx, root, groups, shown: new Map() };
      sync(S);
      return root;
    },
    update(dt, t, ctx) { if (ctx._shellDecor) sync(ctx._shellDecor); },
    setState(k, v, ctx) { if (k === 'floor' && ctx._shellDecor) sync(ctx._shellDecor); },
    dispose(ctx) {
      const S = ctx._shellDecor;
      if (!S) return;
      for (const r of S.shown.values()) remove(r.holder);
      S.shown.clear(); S.root.removeFromParent(); ctx._shellDecor = null;
      if (active === S) active = null;
    },
  });

  V3.shellDecor = {
    slots: () => geometry().map(({ id, label, floor, position, approach }) => ({ id, label, floor: !!floor, position: position.slice(), approach: approach.slice() })),
    objects() {
      const S = active, current = V3.models?.current?.();
      if (!S || S.ctx.dead || S.ctx.root !== current?.root) return [];
      sync(S);
      const camera = V3.R?.camera;
      return [...S.shown.values()].map((r) => r.holder).filter((o) => {
        if (camera?.layers && !camera.layers.test(o.layers)) return false;
        for (let p = o; p; p = p.parent) if (!p.visible) return false;
        return true;
      });
    },
  };
})(window.V3);
