// Shared lightweight hover feedback for the game click targets. No scene/material mutations.
(function (V3) {
  'use strict';
  const H = V3.interactionHover = {};
  H.label = t => {
    if (!t || !t.obj) return '';
    const u = t.obj.userData || {};
    if (t.what === 'reefWatch' && V3.inventoryRules?.REEF_FISH[u.species]) return V3.inventoryRules.REEF_FISH[u.species] + ' · 邀小鲸鱼到岸边观察';
    if (V3.shore?.knows(t.what)) return V3.shore.labelFor(t.what);
    if (t.what === 'collect') {
      const k = (V3.game && V3.game.kind && V3.game.kind(u.kind)) || ((V3.shells && V3.shells.KINDS) || []).find(k => k.id === u.kind);
      return (k ? k.name : '贝壳') + ' · 点击拾取';
    }
    if (t.what === 'girl') return '小鲸鱼 · 戳一戳';
    if (t.what === 'shellBox') return '收藏柜 · 查看贝壳';
    if (t.what === 'windowGarden') return '窗台花盆 · 点击照料';
    if (t.what === 'shellDecor') return '贝壳摆件 · 查看 / 收回';
    if (t.what === 'cabinTrash') return '垃圾桶 · ' + (V3.cabinTrash && V3.cabinTrash.count() ? '点击清理' : '现在是空的');
    if (t.what === 'snackBasket') return '零食篮 · 点击打开零食栏';
    if (t.what === 'sandTray') return '沙盘展示盒 · 点击摆贝壳';
    if (t.what === 'album') return '相册 · 点击翻看';
    if (t.what === 'diaryShelf') return '书架 · 点击翻看日记';
    if (t.what === 'recipeDesk') return '海边食谱台 · 翻开食谱';
    if (t.what === 'artDesk') return '地板画角 · 请她画一张';
    if (t.what === 'photo') return '照片 · 点击更换';
    if (t.what === 'chime') return '贝壳风铃 · 点击摇一摇';
    if (t.what === 'crab') return '小螃蟹 · 点一下';
    if (t.what !== 'furniture' || !V3.furniturePlay) return '';
    const r = V3.furniturePlay.state().items.find(r => r.key === u.furnitureKey);
    if (!r) return '';
    const s = r.state || {};
    if (r.kind === 'tv') return '电视 · ' + (s.on ? '点击控制' : '点击开机');
    if (r.kind === 'cooker') return '电饭煲 · ' + (s.phase === 'idle' && !s.bowl ? '点击煮饭' : '点击查看');
    if (r.kind === 'rocker') return '摇椅 · ' + (r.sitting || r.walking ? '点击起身 / 取消' : '邀请小鲸鱼坐下');
    if (r.kind === 'door') return '门 · ' + (s.open ? '点击关门' : '点击开门');
    if (r.kind === 'lamp') return '灯 · ' + (s.enabled === false ? '点击开灯' : '点击关灯');
    // 2026-11-15：望远镜的悬停永远给，星况不对时把原因写在提示里（点击由 69-furniture-play 回一句）
    if (r.kind === 'telescope') {
      const clear = V3.starView ? !V3.starView.reason() : V3.actor?.starry;
      return '望远镜 · ' + (clear ? '和小鲸鱼一起看星星' : '现在看不到星星');
    }
    return '';
  };
  H.mount = ({ canvas, pick, off }) => {
    if (H.dispose) H.dispose();
    const el = document.createElement('div'), tip = document.createElement('span');
    el.className = 'interaction-hover'; el.hidden = true; el.setAttribute('aria-hidden', 'true');
    tip.className = 'interaction-hover-tip';
    el.append(tip); document.body.append(el);
    let pointer = null, timer = 0, disposed = false;
    const clear = () => { el.hidden = true; el.removeAttribute('data-target'); document.body.classList.remove('hover-pick'); if (V3.hoverOutline) V3.hoverOutline.clear(); };
    const reset = () => { pointer = null; clear(); };
    const check = () => {
      if (disposed) return;
      if (!pointer || document.hidden || off() || document.elementFromPoint(pointer.clientX, pointer.clientY) !== canvas) { clear(); return; }
      let t; try { t = pick(pointer); } catch (_) { clear(); return; }
      const label = H.label(t); if (!label) { clear(); return; }
      tip.textContent = label; el.dataset.target = t.what; el.hidden = false;
      document.body.classList.add('hover-pick');
      if (V3.hoverOutline) {
        const resolved = V3.furniturePlay && V3.furniturePlay.hoverObjects ? V3.furniturePlay.hoverObjects(t) : null;
        V3.hoverOutline.set(resolved == null ? [t.obj] : resolved);
      }
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, pointer.clientX + 23)) + 'px';
      tip.style.top = Math.max(8, Math.min(innerHeight - h - 8, pointer.clientY + 23)) + 'px';
    };
    const move = e => {
      if (e.pointerType === 'touch' || e.buttons) { reset(); return; }
      pointer = { clientX: e.clientX, clientY: e.clientY };
    };
    const events = [[canvas, 'pointermove', move], [canvas, 'pointerdown', reset], [canvas, 'pointercancel', reset], [canvas, 'pointerleave', reset], [window, 'blur', reset], [document, 'visibilitychange', reset]];
    for (const [o, name, fn] of events) o.addEventListener(name, fn);
    V3.on('model', reset); V3.on('parts-changed', reset);
    timer = setInterval(check, 80);
    H.clear = reset;
    H.dispose = () => {
      disposed = true; clearInterval(timer); reset(); el.remove();
      for (const [o, name, fn] of events) o.removeEventListener(name, fn);
      V3.off('model', reset); V3.off('parts-changed', reset);
    };
    return H.dispose;
  };
})(window.V3);
