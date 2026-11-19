// 59-cabin-shore-report.js — 海边邻居 / 浅海鱼缸 / 收集进度 快照上报。
// v9（2026-11-18）：新玩法（东礁送贝币、寄居蟹借壳、鱼缸与抄鱼、50 种收藏）只写收藏存档，没有单独的动作事件；
// v10（2026-11-18 晚）：鱼类图鉴 20 种（浅海 14 + 远礁 6）、寄居蟹 8 种壳；观察册 observed 最多 20 种，全部上报。
// v11（2026-11-19）：鱼类图鉴 30 种（浅海 20 + 远礁 10）、寄居蟹 11 种壳；7 种鱼有另一套花色，
// 额外上报 seenForms（已见过的异色）与 formsTotal（异色总款数），鱼缸里每条鱼也带上自己的花色。
// 这里在存档变化后把 shore 摘要按「内容签名」去重上报 shore_state，桥接存进 state.shore，
// 注入【家里】提示词 / 网页聊天现场 / qq_social_state。名字都先在本机解析好，桥接不用认识收藏目录。
(function (V3) {
  'use strict';
  const I = V3.cabinInventory;
  let last = '', timer = 0;
  const rules = () => V3.inventoryRules;
  const inv = () => (I && I.data ? I.data.inventory : null);
  const shellName = (kind) => {
    try { const k = V3.game && V3.game.kind ? V3.game.kind(kind) : null; if (k && k.name) return k.name; } catch (e) { /* ignore */ }
    return String(kind || '');
  };
  const fishName = (kind) => {
    try {
      const r = rules();
      const hit = (r.FISH && r.FISH[kind]) || (r.REEF_FISH && r.REEF_FISH[kind]);
      if (hit) return hit;
    } catch (e) { /* ignore */ }
    return String(kind || '');
  };
  const fishTotal = () => {
    try { const r = rules(); return Object.keys(r.FISH || {}).length + Object.keys(r.REEF_FISH || {}).length; } catch (e) { return 0; }
  };
  // v11：鱼的异色（皮色/花纹）名字；旧规则没有 FISH_FORMS 时安全退回「原色」。
  const formName = (kind, form) => {
    try { if (rules().fishFormName) return rules().fishFormName(kind, form); } catch (e) { /* ignore */ }
    return form && form !== 'base' ? String(form) : '原色';
  };
  const formsTotal = () => {
    try {
      const r = rules(); let n = 0;
      for (const kind of Object.keys(r.FISH_FORMS || {})) n += Object.keys(r.FISH_FORMS[kind] || {}).length;
      return n;
    } catch (e) { return 0; }
  };
  const patName = (pat) => { try { return rules().pattern(pat).name; } catch (e) { return '原色'; } };
  const BERTH_NAMES = { west: '门廊西侧的小架', east: '门廊东侧的小架' };
  function berthName(key) {
    if (!key) return '';
    if (BERTH_NAMES[key]) return BERTH_NAMES[key];
    return /^table:/.test(key) ? '餐桌的一角' : '';
  }
  function progress() {
    try {
      if (V3.game && V3.game.counts) {
        const c = V3.game.counts();
        return { kinds: Math.max(0, c.kinds | 0), total: Math.max(0, c.total | 0), items: Math.max(0, c.items | 0) };
      }
    } catch (e) { /* ignore */ }
    const found = (inv() || {}).found || {};
    const kinds = [].concat((V3.shells && V3.shells.KINDS) || [], (V3.washupCatalog && V3.washupCatalog.collectibles) || []);
    let items = 0;
    for (const key of Object.keys(found)) items += Math.max(0, Number(found[key] && found[key].n) || 0);
    return { kinds: kinds.filter((k) => found[k.id]).length, total: kinds.length, items };
  }
  function ownedItem(uid) {
    const found = (inv() || {}).found || {};
    for (const key of Object.keys(found)) {
      const item = (found[key].items || []).find((it) => it && it.uid === uid);
      if (item) return { kind: key, ...item };
    }
    return null;
  }
  function snapshot() {
    const data = inv();
    if (!I || !I.ready || !data || !data.shore) return null;
    const s = data.shore, loanShell = s.loan ? ownedItem(s.loan) : null;
    return {
      gift: s.gift ? { zone: s.gift.zone, slot: s.gift.slot } : null,
      loan: s.loan ? {
        uid: s.loan,
        kindName: loanShell ? shellName(loanShell.kind) : '',
        patName: loanShell ? patName(loanShell.pat) : '原色',
        size: loanShell ? loanShell.size : 0,
      } : null,
      memory: s.memory ? {
        kindName: shellName(s.memory.kind),
        patName: patName(s.memory.pat),
        size: s.memory.size,
        at: s.memory.at,
      } : null,
      berth: s.berth || null,
      berthName: berthName(s.berth),
      fish: (s.fish || []).slice(0, 3).map((f) => ({
        kind: f.kind,
        kindName: fishName(f.kind),
        name: String(f.name || ''),
        fed: Number(f.fed) || 0,
        form: f.form || 'base',
        formName: formName(f.kind, f.form),
      })),
      observed: (s.observed || []).map((kind) => fishName(kind)),
      fishTotal: fishTotal(),
      // v11：只上报「非原色」的已见花色，名字在本机解析好；数量很少（每种鱼至多一款异色）。
      seenForms: (() => {
        const out = [];
        for (const kind of Object.keys(s.forms || {})) {
          for (const form of (s.forms[kind] || [])) {
            if (!form || form === 'base') continue;
            out.push({ kind, kindName: fishName(kind), form, formName: formName(kind, form) });
          }
        }
        return out;
      })(),
      formsTotal: formsTotal(),
      found: progress(),
    };
  }
  function report(force) {
    const detail = snapshot();
    if (!detail) return;
    const sig = JSON.stringify(detail);
    if (!force && sig === last) return;
    last = sig;
    try {
      V3.emit('game:cabin-event', { type: 'shore_state', id: I.id('shorestate'), at: Date.now(), text: '', detail });
    } catch (e) { if (V3.err) V3.err('shore_state event: ' + ((e && e.message) || e)); }
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
    if (I && I.ready && I.data && I.data.inventory && I.data.inventory.shore) { clearInterval(wait); report(true); }
  }, 500);
})(window.V3);
