// 59-cabin-wallet.js — 钱袋 / 零食篮快照上报（给「让她知道还剩多少钱、篮里有什么」用）。
// 收藏变化（买卖、清理垃圾、吃零食、捡贝壳）都会触发 inventory:change，这里按「内容签名」去重后上报 wallet 事件；
// 桥接收到后存进 state.wallet，注入【家里】提示词 / 网页聊天现场 / qq_social_state。
(function (V3) {
  'use strict';
  const I = V3.cabinInventory;
  let last = '', timer = 0;
  function snapshot() {
    if (!I || !I.data || !I.ready || !V3.snackEvents) return null;
    return V3.snackEvents.walletDetail(I.data.inventory);
  }
  function report(force) {
    const data = snapshot();
    if (!data) return;
    const sig = JSON.stringify([data.coins, data.snacks.map((s) => s.sku + ':' + s.left)]);
    if (!force && sig === last) return;
    last = sig;
    try {
      V3.emit('game:cabin-event', {
        type: 'wallet', id: I.id('wallet'), at: Date.now(), text: '',
        detail: data,
      });
    } catch (e) { V3.err && V3.err('wallet event: ' + (e && e.message || e)); }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => report(false), 300);
    if (timer && timer.unref) timer.unref();
  }
  V3.on('inventory:change', schedule);
  V3.on('inventory:status', schedule);
  // 页面刚起来、存档已就绪时先报一次（之后靠变化触发）
  const wait = setInterval(() => {
    if (I && I.ready && I.data) { clearInterval(wait); report(true); }
  }, 500);
})(window.V3);