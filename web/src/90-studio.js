// 90-studio.js — 小鲸鱼工作台 entry: boot renderer, show the selected model, apply ?view=, then __READY.
(function (V3) {
  'use strict';
  const U = V3.util;
  const start = async () => {
    const R = V3.boot();
    // game state without saving (studio previews: wash= / collect / found= tokens work, nothing is stored)
    if (V3.game && V3.game.start) V3.game.start({ live: false });
    const ui = V3.ysmUI;
    await ui.preload();
    const list = V3.models.list(), want = U.qs('model', 'ysm');
    const id = list.some(m => m.id === want) ? want : 'ysm';
    if (id === 'ysm') ui.studio = { id: ui.defaultId(), model: await ui.model(ui.defaultId()) };
    const inst = V3.models.show(id);
    const v0 = U.qs('view', '');
    if (inst.views && inst.views.front && !/(^|\+)(cam=|front|side|back|q34|face)/.test(v0)) R.ctl.set(inst.views.front, false);
    if (v0) await V3.view(v0);
    else await V3.waitReady(inst);   // 异步画的模型（inst.ready）画完再 __READY；最多等 10 秒（V3.view 里也一样）
    await V3.nextFrames(4);
    window.__READY = true;
    V3.emit('ready');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window.V3);
