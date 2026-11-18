// 69-snack-shop.js — V3.snackShop 小店（HUD「小店」按钮 / 'game:open' 'shop'）。贝币：清理垃圾每件 1 个、卖贝壳（常见 1 / 少见 3 / 稀有 5）。
//   买零食：小店里的零食（32-snack-catalog），买来的放进零食篮（69-snack-bar），从零食栏拖给小鲸鱼吃。
//   卖贝壳：按种类列出每一枚，勾选后卖掉。锁着不能卖：正摆在外面 / 放在展示盒里的（一直锁）；带王冠的、每种最后一枚（默认锁，可以解开）。
// 所有改动都走 V3.cabinInventory.perform（58-inventory-rules 的 buy / sell）；页面只负责显示。
(function (V3) {
  'use strict';
  const U = V3.util, H = V3.hud, I = V3.cabinInventory;
  const R = () => V3.inventoryRules, CAT = () => V3.snackCatalog;
  let card = null, body = null, foot = null, coinsEl = null, tab = 'buy', busy = false, open = new Set(), picked = new Set(), confirmT = 0;
  const allow = { crown: false, last: false };
  const QTY = new Map();   // sku → 选的数量
  const inv = () => (I && I.data ? I.data.inventory : null);
  const coins = () => (inv() ? inv().coins : 0);
  const toast = (text, color = '#f6c443') => { if (H && H.toast) H.toast(text, { color, ms: 3000 }); };
  const coin = (n) => U.el('span', { class: 'shop-coin' }, U.el('i', { class: 'shop-coin-ic', 'aria-hidden': 'true' }), String(n));
  const event = (type, id, text, detail) => V3.emit('game:cabin-event', { type, id, at: Date.now(), text, detail });

  function build() {
    coinsEl = U.el('span', { class: 'shop-balance', title: '贝币：清理垃圾、卖贝壳得到' });
    body = U.el('div', { class: 'hud-card-body shop-body' });
    foot = U.el('div', { class: 'shop-sellbar' });   // 卖贝壳页的底栏：不跟着列表滚
    const tabBtn = (id, text) => U.el('button', { type: 'button', class: 'shop-tab', 'data-tab': id, onclick: () => { tab = id; render(); } }, text);
    card = U.el('div', { class: 'hud-card shop', role: 'dialog', 'aria-label': '小店' },
      U.el('div', { class: 'hud-card-head' },
        U.el('span', { class: 'hud-card-title' }, '小店'),
        coinsEl,
        U.el('div', { class: 'shop-tabs', role: 'tablist' }, tabBtn('buy', '买零食'), tabBtn('sell', '卖贝壳')),
        U.el('button', { class: 'hud-x', type: 'button', title: '关闭', 'aria-label': '关闭', onclick: () => S.close() }, '✕')),
      body, foot);
  }
  function render() {
    if (!card) return;
    coinsEl.textContent = '';
    coinsEl.append('贝币 ', coin(coins()));
    for (const b of card.querySelectorAll('.shop-tab')) { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    const top = body.scrollTop;
    body.textContent = ''; foot.textContent = ''; foot.hidden = true;
    if (!I || !I.ready) { body.append(U.el('div', { class: 'shop-note' }, I && I.error || '小屋存档还在加载…')); return; }
    if (I.serverV1) body.append(U.el('div', { class: 'shop-note warn' }, '小屋服务还是旧版存档：买卖要等它升级（见 docs/INVENTORY-V2.md）。'));
    if (tab === 'buy') renderBuy(); else renderSell();
    body.scrollTop = top;
  }

  // ---- 买零食 ----
  function renderBuy() {
    const M = V3.snackModels, have = new Map();
    for (const s of inv().snacks) have.set(s.sku, (have.get(s.sku) || 0) + 1);
    body.append(U.el('div', { class: 'shop-hint' }, '买来的零食放进冰箱上的零食篮，点 HUD 的「零食」拖一份给她吃。杯装的能喝三口，喝完的空杯扔进门廊垃圾桶还能换 1 贝币。'));
    const grid = U.el('div', { class: 'shop-grid' });
    for (const s of CAT().list) {
      const q = QTY.get(s.sku) || 1, cost = s.price * q, can = coins() >= cost && !busy && !I.serverV1;
      const icon = M && M.icon ? M.icon(s.sku, { size: H.iconPx(72) }) : null;
      const qtyEl = U.el('span', { class: 'shop-qty-n' }, String(q));
      const step = (d) => { QTY.set(s.sku, U.clamp(q + d, 1, 5)); render(); };
      grid.append(U.el('div', { class: 'shop-item' + (s.mine ? ' mine' : '') },
        U.el('span', { class: 'shop-pic' }, icon ? U.el('img', { src: icon, alt: '', draggable: 'false' }) : U.el('i', { class: 'shop-dot' })),
        U.el('div', { class: 'shop-item-main' },
          U.el('div', { class: 'shop-name' }, s.name, have.get(s.sku) ? U.el('span', { class: 'shop-have' }, '篮里 ' + have.get(s.sku)) : null),
          U.el('div', { class: 'shop-desc' }, s.desc || ''),
          U.el('div', { class: 'shop-meta' }, packText(s), ' · ', coin(s.price))),
        U.el('div', { class: 'shop-buy' },
          U.el('span', { class: 'shop-qty' },
            U.el('button', { type: 'button', 'aria-label': '少一件', disabled: q <= 1, onclick: () => step(-1) }, '−'), qtyEl,
            U.el('button', { type: 'button', 'aria-label': '多一件', disabled: q >= 5, onclick: () => step(1) }, '+')),
          U.el('button', { type: 'button', class: 'shop-go', disabled: !can, title: can ? '' : '贝币不够', onclick: () => buy(s, q) }, '买 ', coin(cost)))));
    }
    body.append(grid);
  }
  const packText = (s) => s.pack === 'cup' ? `${{ mug: '一杯', bottle: '一瓶', jar: '一罐', cup: '一杯' }[s.vessel || 'cup']}，${s.count}${s.unit}` : `${s.pack === 'box' ? '一盒' : '一袋'} ${s.count} ${s.unit}`;
  async function buy(s, q) {
    if (busy) return;
    busy = true; render();
    const id = I.id('buy');
    try {
      const r = await I.perform({ op: 'buy', id, sku: s.sku, qty: q });
      if (!r.ok) { toast(r.error, '#f5aa73'); return; }
      if (r.applied !== false) {
        toast(`买到了 ${s.name}${q > 1 ? ' ×' + q : ''}，放进零食篮啦`);
        event('snack_buy', id, `你在小店买了${q > 1 ? q + '份' : ''}${s.name}`, V3.snackEvents.buyDetail(s, q, r.cost, coins()));
        V3.emit('snack:bought', { sku: s.sku, qty: q });
      }
    } finally { busy = false; render(); }
  }

  // ---- 卖贝壳 ----
  // 这一枚为什么不能卖（null = 可以卖）
  function lockOf(k, it, f, used) {
    if (used.has(it.uid)) return '正在展示';
    if (!allow.crown && R().crown(k, it.size)) return '带王冠';
    // 再勾上这一枚，这一种就一枚不剩了
    if (!allow.last && !picked.has(it.uid) && f.items.filter((x) => x.uid !== it.uid && !picked.has(x.uid)).length < 1) return '最后一枚';
    return null;
  }
  function renderSell() {
    const G = V3.game, found = inv().found, used = I.used(), kinds = G.kinds().filter((k) => found[k.id] && found[k.id].items.length);
    for (const u of [...picked]) if (!kinds.some((k) => found[k.id].items.some((it) => it.uid === u)) || used.has(u)) picked.delete(u);
    const toggle = (key, text) => U.el('label', { class: 'shop-toggle' },
      U.el('input', { type: 'checkbox', checked: allow[key], onchange: (e) => { allow[key] = e.target.checked; if (!allow[key]) dropLocked(); render(); } }), text);
    body.append(U.el('div', { class: 'shop-hint' }, '常见 1、少见 3、稀有 5 贝币一枚。正摆在外面、放在展示盒里的不能卖。'),
      U.el('div', { class: 'shop-toggles' }, toggle('crown', '也可以卖带王冠的'), toggle('last', '也可以卖每种最后一枚')));
    if (!kinds.length) { body.append(U.el('div', { class: 'shop-note' }, '还没有贝壳可以卖，去沙滩上捡一些吧。')); return; }
    const list = U.el('div', { class: 'shop-kinds' });
    for (const k of kinds) {
      const f = found[k.id], rar = H.rarity(k.rarity), price = R().PRICE[k.rarity] || 1;
      const sel = f.items.filter((it) => picked.has(it.uid)).length, isOpen = open.has(k.id);
      const head = U.el('button', { type: 'button', class: 'shop-kind-h', 'aria-expanded': String(isOpen),
        onclick: () => { if (isOpen) open.delete(k.id); else open.add(k.id); render(); } },
        shellPic(k, null, 34), U.el('span', { class: 'shop-kind-name' }, k.name),
        U.el('span', { class: 'shop-chip' }, rar.label), U.el('span', { class: 'shop-kind-n' }, `${f.items.length} 枚`),
        U.el('span', { class: 'shop-kind-price' }, coin(price), ' / 枚'), sel ? U.el('span', { class: 'shop-kind-sel' }, `已选 ${sel}`) : null,
        U.el('span', { class: 'shop-caret' }, isOpen ? '▾' : '▸'));
      head.style.setProperty('--c', rar.color);
      const box = U.el('div', { class: 'shop-kind' + (isOpen ? ' open' : '') }, head);
      if (isOpen) {
        const rows = U.el('div', { class: 'shop-shells' });
        for (const it of f.items.slice().sort((a, b) => b.size - a.size)) {
          const lock = lockOf(k, it, f, used), c = R().crown(k, it.size), pat = R().pattern(it.pat), on = picked.has(it.uid);
          rows.append(U.el('label', { class: 'shop-shell' + (lock ? ' locked' : '') + (on ? ' on' : '') },
            U.el('input', { type: 'checkbox', checked: on, disabled: !!lock || busy, onchange: (e) => { if (e.target.checked) picked.add(it.uid); else picked.delete(it.uid); render(); } }),
            shellPic(k, it.pat, 28), U.el('span', { class: 'shop-shell-size' }, it.size.toFixed(1) + ' mm'),
            U.el('span', { class: 'shop-shell-pat' + (pat.rare ? ' rare' : '') }, pat.name),
            U.el('span', { class: 'shop-shell-crown' }, c && V3.collection && V3.collection.crownEl ? V3.collection.crownEl(c) : null),
            U.el('span', { class: 'shop-shell-lock' }, lock || '')));
        }
        box.append(rows);
      }
      list.append(box);
    }
    body.append(list);
    const n = picked.size, earn = [...picked].reduce((a, u) => a + priceOfUid(u), 0);
    const go = U.el('button', { type: 'button', class: 'shop-go big' + (confirmT > performance.now() ? ' confirm' : ''), disabled: !n || busy || I.serverV1, onclick: sell },
      confirmT > performance.now() ? `确定卖掉这 ${n} 枚？` : n ? ['卖掉 ' + n + ' 枚，得 ', coin(earn)] : '勾选要卖的贝壳');
    foot.hidden = false;
    // 原生 append 会把 null 写成文字「null」：先滤掉
    foot.append(...[U.el('span', null, n ? `已选 ${n} 枚` : '还没选'), n ? U.el('button', { type: 'button', class: 'shop-clear', onclick: () => { picked.clear(); render(); } }, '全不选') : null, go].filter(Boolean));
  }
  // 刚把「也可以卖…」关掉：已经勾上的王冠取消；某一种全勾上了就留下最大的那枚
  function dropLocked() {
    for (const k of V3.game.kinds()) {
      const f = inv().found[k.id]; if (!f) continue;
      const mine = f.items.filter((it) => picked.has(it.uid));
      if (!allow.crown) for (const it of mine) if (R().crown(k, it.size)) picked.delete(it.uid);
      if (!allow.last && f.items.length && f.items.every((it) => picked.has(it.uid))) {
        picked.delete(f.items.reduce((a, b) => (b.size > a.size ? b : a)).uid);
      }
    }
  }
  function priceOfUid(u) {
    for (const [kid, f] of Object.entries(inv().found)) if (f.items.some((it) => it.uid === u)) { const k = V3.game.kind(kid); return R().PRICE[k && k.rarity] || 1; }
    return 0;
  }
  function shellPic(k, pat, css) {
    let src = null;
    try { src = V3.shellIcons && V3.shellIcons.get(k.id, { size: H.iconPx(css), pat }); } catch (e) { src = null; }
    return typeof src === 'string' ? U.el('img', { class: 'shop-shell-pic', src, alt: '', width: css, height: css, draggable: 'false' }) : U.el('i', { class: 'shop-dot' });
  }
  async function sell() {
    if (busy || !picked.size) return;
    if (!(confirmT > performance.now())) { confirmT = performance.now() + 3500; render(); setTimeout(() => { if (S.isOpen()) render(); }, 3600); return; }
    confirmT = 0; busy = true; render();
    const uids = [...picked], id = I.id('sell');
    try {
      const r = await I.perform({ op: 'sell', id, uids });
      if (!r.ok) { toast(r.error, '#f5aa73'); return; }
      if (r.applied !== false) {
        const kindCount = new Map();
        for (const u of uids) {
          for (const [kid, f] of Object.entries(inv().found)) {
            if (f.items.some((it) => it.uid === u)) { const k = V3.game.kind(kid); const name = k ? k.name : kid; kindCount.set(name, (kindCount.get(name) || 0) + 1); break; }
          }
        }
        picked.clear();
        toast(`卖掉 ${r.sold} 枚贝壳，得到 ${r.earned} 贝币`);
        event('shell_sell', id, `你在小店卖掉了${r.sold}枚贝壳，换了${r.earned}贝币`,
          V3.snackEvents.sellDetail([...kindCount].map(([name, n]) => ({ name, n })), r.earned, coins()));
      }
    } finally { busy = false; render(); }
  }

  const S = V3.snackShop = {
    open(which) {
      if (which === 'buy' || which === 'sell') tab = which;
      if (!card) build();
      if (!H.modalOpen('shop')) H.modal(card, { name: 'shop', onClose: () => { confirmT = 0; } });
      render();
      return card;
    },
    close: () => H.closeModal('shop'),
    isOpen: () => !!(H && H.modalOpen && H.modalOpen('shop')),
    _picked: picked,
  };
  V3.on('game:open', (what) => { if ((what === 'shop' || what === 'shop:buy' || what === 'shop:sell') && H.mounted) S.open(what.split(':')[1]); });
  V3.on('inventory:change', () => { if (S.isOpen()) render(); });
  V3.on('inventory:status', () => { if (S.isOpen()) render(); });
})(window.V3);
