// A small porch bin. No world pollution timer: cleanup only happens when you use the bin.
(function (V3) {
  'use strict';
  let active, busy = false, openUntil = 0;
  const I = () => V3.cabinInventory;
  const inv = () => V3.game && V3.game.inventory();
  function toast(text) { if (V3.hud && V3.hud.toast) V3.hud.toast(text, { color: '#8bd8ae', ms: 3200 }); }
  async function dispose() {
    const state = inv();
    if (busy) return;
    if (!I().ready) { toast(I().error || '小屋存档还在加载'); return; }
    if (!state.trash) { toast('垃圾桶空着。捡到垃圾再带回来吧。'); return; }
    busy = true;
    try {
      const id = I().id('dispose'), result = await I().perform({ op: 'dispose', id });
      if (!result.ok) { toast(result.error); return; }
      if (!(result.disposed > 0)) { toast('已经收拾干净了。'); return; }
      openUntil = performance.now() + 1500;
      const text = `你把${result.disposed}件垃圾扔进垃圾桶`;
      toast('清理了 ' + result.disposed + ' 件' + (result.earned > 0 ? '，得到 ' + result.earned + ' 贝币' : '') + '，沙滩干净一点啦。');
      V3.emit('game:cabin-event', { type: 'trash_dispose', id, at: Date.now(), text, detail: { count: result.disposed, earned: result.earned || 0 } });
    } finally { busy = false; }
  }
  const bases = [[-6.55, 1, -5.68], [5.55, 1, -5.68], [-6.55, 1, -4.5]];
  function update(s) {
    const hb = V3.houseBlocks;
    if (!hb || !hb.grid) return;
    if (s.grid !== hb.grid || s.version !== hb.version) {
      s.grid = hb.grid; s.version = hb.version;
      const pos = bases.map((p) => hb.placePoint && hb.place ? hb.placePoint(p, hb.place) : p).find(([x, y, z]) => {
        return [[0, 0], [-.22, -.22], [.22, -.22], [-.22, .22], [.22, .22]].every(([dx, dz]) => {
          const a = Math.floor(x + dx), b = Math.floor(z + dz), floor = hb.grid.at(a, Math.floor(y - .01), b);
          return floor && /_planks$/.test(floor.id) && !hb.grid.at(a, Math.floor(y + .01), b);
        });
      });
      s.root.visible = !!pos;
      if (pos) s.root.position.set(...pos);
      if (hb.placeYaw && hb.place) s.root.rotation.y = hb.placeYaw(0, hb.place);
      s.root.updateMatrixWorld(true);
    }
    const target = performance.now() < openUntil ? -0.6 : 0;
    s.hinge.rotation.x += (target - s.hinge.rotation.x) * .16;
  }
  V3.scene.part({
    id: 'cabin-trash', label: '门廊垃圾桶', order: 54,
    build(ctx) {
      if (!V3.game || !V3.game.hosted) return null;
      const root = new THREE.Group(); root.name = 'cabin-trash'; root.visible = false;
      Object.assign(root.userData, { clickable: 'cabinTrash', layer: 'site' });
      const mats = [0x4c796d, 0x263d3d, 0xa6d1a0, 0x375a51].map((color) => new THREE.MeshStandardMaterial({ color, roughness: .82 }));
      const all = [];
      function mesh(parent, geo, mat, pos) {
        const m = new THREE.Mesh(geo, mats[mat]); m.position.set(...pos); m.castShadow = m.receiveShadow = true;
        m.userData.layer = 'site'; parent.add(m); all.push(geo); return m;
      }
      mesh(root, new THREE.CylinderGeometry(.242, .208, .5, 10, 1, true), 0, [0, .27, 0]);
      mesh(root, new THREE.CylinderGeometry(.211, .22, .045, 10), 3, [0, .04, 0]);
      mesh(root, new THREE.CylinderGeometry(.21, .21, .012, 10), 1, [0, .45, 0]);
      mesh(root, new THREE.BoxGeometry(.19, .125, .025), 3, [0, .31, .229]);
      mesh(root, new THREE.BoxGeometry(.08, .022, .027), 2, [0, .322, .244]);
      mesh(root, new THREE.BoxGeometry(.04, .04, .029), 2, [0, .286, .244]);
      const hinge = new THREE.Group(); hinge.position.set(0, .52, -.21); root.add(hinge);
      mesh(hinge, new THREE.CylinderGeometry(.244, .252, .065, 10), 3, [0, .014, .21]);
      mesh(hinge, new THREE.BoxGeometry(.11, .041, .044), 2, [0, .067, .24]);
      const s = ctx.cabinTrash = active = { root, hinge, all, mats, ctx };
      update(s);
      return root;
    },
    update(dt, t, ctx) { if (ctx.cabinTrash) update(ctx.cabinTrash); },
    dispose(ctx) {
      const s = ctx.cabinTrash; if (!s) return;
      for (const r of s.all.concat(s.mats)) r.dispose();
      if (active === s) active = null;
      ctx.cabinTrash = null;
    },
  });
  V3.cabinTrash = { dispose, count: () => inv()?.trash || 0, cleaned: () => inv()?.cleaned || 0,
    objects: () => active && active.root.visible ? [active.root] : [],
  };
  V3.on('game:collect', (e) => { if (e && e.kind && e.kind.category === 'trash') toast('捡到' + e.kind.name + '。可以带去门廊垃圾桶。'); });
})(window.V3);
