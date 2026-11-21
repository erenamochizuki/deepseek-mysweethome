// 朝海窗的花盆和风。手记、特写和房内从同一份雕塑取模型。
(function (V3) {
  'use strict';

  let active = null;
  const sill = () => V3.shellDecor?.gardenSill?.() || null;
  function sync(s) {
    const spot = sill(), hb = V3.houseBlocks;
    if (!spot) { s.holder.visible = false; return; }
    if (s.spot !== spot) {
      s.spot = spot; s.holder.position.set(...spot.position); s.holder.rotation.y = spot.yaw;
    }
    const pot = V3.game?.inventory?.()?.garden?.pot, kind = pot?.kind || null;
    const stage = Array.isArray(pot?.watered) ? V3.inventoryRules?.gardenStage?.(pot.watered.length) || 0 : 0;
    if (!s.model || kind !== s.kind || stage !== s.stage) {
      s.holder.clear(); s.model = V3.gardenModels.build(kind,stage); s.holder.add(s.model);
      s.kind = kind; s.stage = stage; s.leaves = s.model.getObjectByName('garden-foliage');
    }
    s.holder.visible = s.ctx.state?.floor !== 'ground' && (!hb?.visibleAt || hb.visibleAt(...spot.cell)) &&
      !hb?.live?.()?.hidden?.has(spot.cell.join(','));
  }
  function sway(s, t) {
    const w = V3.env?.state?.wind, leaves = s.leaves;
    if (!leaves || !s.holder.visible) return;
    const speed = w?.speed || 0, gust = w?.gust || 0, [dx,dz] = w?.dir || [0,0];
    const a = s.holder.rotation.y, c = Math.cos(a), sn = Math.sin(a);
    const bend = speed*(.024+.014*Math.sin(t*2.1)) + gust*.012*Math.sin(t*3.7);
    leaves.rotation.z = -(c*dx-sn*dz)*bend;
    leaves.rotation.x = (sn*dx+c*dz)*bend;
  }
  V3.gardenScene = {
    // 与 shellDecor.slots()[i].approach 一致，返回世界 [x,y,z]，走路用 actor.goto(x,z,y)。
    approach: () => sill()?.approach?.slice() || null,
    objects() {
      const s = active;
      if (!s || s.ctx.dead || s.ctx.root !== V3.models?.current?.()?.root) return [];
      sync(s);
      const layers = V3.R?.camera?.layers;
      if (layers && !layers.test(s.holder.layers)) return [];
      for (let p = s.holder; p; p = p.parent) if (!p.visible) return [];
      s.holder.updateWorldMatrix(true,true);
      return [s.holder];
    },
  };
  V3.scene?.part?.({
    id: 'window-garden', label: '窗台小花盆', order: 54,
    build(ctx) {
      const holder = new THREE.Group(); holder.name = 'window-garden'; holder.userData.clickable = 'windowGarden';
      const root = new THREE.Group(); root.userData.layer = 'loft'; root.add(holder);
      const s = ctx._windowGarden = active = { ctx, root, holder }; sync(s); return root;
    },
    update(dt,t,ctx) { const s = ctx._windowGarden; if (s) { sync(s); sway(s,t); } },
    setState(k,v,ctx) { if (k === 'floor' && ctx._windowGarden) sync(ctx._windowGarden); },
    dispose(ctx) {
      const s = ctx._windowGarden; if (!s) return;
      s.holder.clear(); s.root.removeFromParent(); ctx._windowGarden = null;
      if (active === s) active = null;
    },
  });
})(window.V3);
