// 69-snack-events.js — 小店 / 零食事件的 detail 构造（纯函数，不碰 DOM / 网络）。
// 桥接（3100 cabin-house）用这些 detail 生成「她看得懂」的中文描述：卖了什么、买了什么、还剩多少钱、吃了什么味道。
// 页面只负责把现场数据交出去；措辞在桥接那边统一生成，方便单测。
(function (V3) {
  'use strict';
  const CAT = () => V3.snackCatalog;
  const one = (s) => {
    if (!s) return '零食';
    if (s.pack === 'cup') return (s.sip === 'spoon' ? '一勺' : '一口') + s.name;
    return '一' + s.unit + s.name;
  };
  const piece = (s) => (s ? (s.pack === 'cup' ? (s.sip === 'spoon' ? '一勺' : '一口') : '一' + s.unit) + s.name : '零食');

  // 她吃了什么、什么味道（by: player=被投喂 / girl=自己拿的）
  function eatDetail(s, by, left, emptied) {
    const taste = s && s.taste ? String(s.taste) : '';
    return {
      sku: s ? s.sku : '', name: s ? s.name : '零食', taste,
      by: by === 'girl' ? 'girl' : 'player',
      pack: s ? s.pack : '', unit: s ? s.unit : '', sip: s ? s.sip || '' : '',
      left: Number.isFinite(Number(left)) ? Number(left) : 0,
      emptied: !!emptied,
    };
  }
  // 买了什么、花了多少、还剩多少
  function buyDetail(s, qty, cost, coins) {
    return {
      sku: s ? s.sku : '', name: s ? s.name : '零食', taste: s && s.taste ? String(s.taste) : '',
      pack: s ? s.pack : '', unit: s ? s.unit : '',
      qty: Number(qty) || 1, cost: Number(cost) || 0,
      coins: Number.isFinite(Number(coins)) ? Number(coins) : null,
    };
  }
  // 卖了什么（kinds: [{name, n}]）、得到多少、还剩多少
  function sellDetail(kinds, earned, coins) {
    return {
      kinds: (Array.isArray(kinds) ? kinds : []).filter((k) => k && k.name).slice(0, 20)
        .map((k) => ({ name: String(k.name).slice(0, 40), n: Math.max(1, Math.round(Number(k.n) || 1)) })),
      count: (Array.isArray(kinds) ? kinds : []).reduce((a, k) => a + (Math.round(Number(k && k.n)) || 0), 0),
      earned: Number(earned) || 0,
      coins: Number.isFinite(Number(coins)) ? Number(coins) : null,
    };
  }
  // 钱袋 / 零食篮快照（每次收藏变化上报）：让她随时知道还剩多少贝币、篮里有什么
  function walletDetail(inv) {
    const snacks = (inv && Array.isArray(inv.snacks) ? inv.snacks : []).slice(0, 12).map((s) => {
      const c = CAT() && CAT().get(s.sku);
      return {
        sku: s.sku, name: c ? c.name : s.sku, taste: c && c.taste ? String(c.taste) : '',
        pack: c ? c.pack : '', unit: c ? c.unit : '', left: Math.max(0, Number(s.left) || 0),
      };
    });
    return { coins: Math.max(0, Number(inv && inv.coins) || 0), snacks };
  }

  V3.snackEvents = { one, piece, eatDetail, buyDetail, sellDetail, walletDetail };
})(window.V3);
