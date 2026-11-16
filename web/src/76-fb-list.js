// 76-fb-list.js — right panel: feedback list, filters, thread, status actions; click = restore that view.
(function (V3) {
  'use strict';
  const U = V3.util, fb = V3.fb;
  const STATUS = fb.STATUS = { open: '新', doing: '处理中', fixed: '已修复', closed: '已确认', wontfix: '不改', reopen: '又有问题' };
  const SEVL = { 1: '小', 2: '中', 3: '大' };
  const TABS = [
    ['all', '全部', () => true],
    ['todo', '待处理', s => s === 'open' || s === 'doing' || s === 'reopen'],
    ['done', '已修复', s => s === 'fixed' || s === 'closed'],
  ];
  const L = fb.list = { tab: 'all', openId: null, el: null, reply: null };
  const PK = 'v3.fb.panels';
  const panels = (() => { try { return JSON.parse(localStorage.getItem(PK)) || {}; } catch (e) { return {}; } })();
  fb.panelState = (k, v) => {
    if (v === undefined) return panels[k];
    panels[k] = v;
    try { localStorage.setItem(PK, JSON.stringify(panels)); } catch (e) { /* full */ }
  };
  const fmt = s => { const t = Date.parse(s); return isFinite(t) ? U.fmtTime(t) : ''; };
  const tabFn = k => (TABS.find(t => t[0] === k) || TABS[0])[2];

  // ---- restore the exact view an item was written in ----
  fb.restore = (it) => {
    const R = V3.R, S = V3.stage, s = it.state || {};
    if (it.model && (!fb.inst() || fb.inst().id !== it.model)) {
      try { V3.models.show(it.model); } catch (e) { fb.toast('找不到模型：' + it.model, 'err'); return false; }
    }
    const inst = fb.inst();
    if (inst && inst.states) for (const k in inst.states) {
      if (s[k] != null && String(inst.states[k].value) !== String(s[k])) V3.setState(k, s[k]);
    }
    if (s.light && S && S.preset !== s.light) S.setPreset(s.light);
    if (S && S.spin) { S.turntable(false); fb.syncSpin(); }
    if (inst && inst.root) inst.root.rotation.y = s.rotY || 0;
    if (s.t != null && isFinite(s.t)) { R.freeze(+s.t); V3.emit('fb-pause', true); }
    if (it.camera && it.camera.pos) R.setView(it.camera);
    if (it.part) {
      if (fb.iso && !fb.under(it.part, fb.iso)) fb.isolate(null);
      if (fb.visState(it.part)) fb.show(it.part);
      fb.select(it.part, { src: 'list' });
    }
    V3.emit('fb-flash', it.id);
    return true;
  };
  fb.openItem = (id, o = {}) => {
    const it = fb.store && fb.store.get(id);
    if (!it) return false;
    L.openId = id; L.reply = null;
    if (!tabFn(L.tab)(it.status)) L.tab = 'all';
    if (L.el && L.el.classList.contains('fb-collapsed')) setCollapsed(false);
    render();
    if (o.restore !== false) fb.restore(it); // emits fb-flash -> row + pin flash after the re-render
    else scrollToRow(id);
    return true;
  };

  // ---- actions ----
  const act = async (it, body, msg) => {
    try { await fb.store.patch(it.id, body); L.reply = null; render(); if (msg) fb.toast(msg, 'ok'); }
    catch (e) { fb.toast('操作失败：' + ((e && e.message) || e), 'err', 5000); }
  };
  const del = async (it) => {
    const n = fb.store.nums.get(it.id), local = fb.store.isLocal(it.id);
    if (!confirm(`删除反馈 #${n}「${String(it.text || '').slice(0, 20)}」？` + (local ? '' : '\n（服务器会把它移到回收站）'))) return;
    try { await fb.store.remove(it.id); if (L.openId === it.id) L.openId = null; render(); fb.toast('已删除'); }
    catch (e) { fb.toast('删除失败：' + ((e && e.message) || e), 'err', 5000); }
  };
  const actions = (it) => {
    const s = it.status, box = U.el('div', { class: 'fb-acts' });
    if (L.reply && L.reply.id === it.id) {
      const R = L.reply, ta = U.el('textarea', { class: 'fb-ta', rows: 2, placeholder: R.ph, oninput: () => { R.text = ta.value; } });
      ta.value = R.text || '';
      const go = () => {
        const t = ta.value.trim();
        if (!t) { ta.focus(); return; }
        act(it, { status: R.status || undefined, reply: { who: 'user', text: t } }, R.ok);
      };
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } });
      box.append(ta, fb.btn('发送', '发送（Ctrl+Enter）', go, 'sm pri'), fb.btn('取消', '', () => { L.reply = null; render(); }, 'sm ghost'));
      return box;
    }
    const ask = (status, ph, ok) => () => { L.reply = { id: it.id, status, ph, ok, text: '', focus: true }; render(); };
    if (s === 'fixed') {
      box.append(fb.btn('确认解决', '改好了，关闭这条', () => act(it, { status: 'closed' }, '已确认解决'), 'sm pri'),
        fb.btn('还有问题', '没改好：重新打开，并说说哪里还不对', ask('reopen', '哪里还不对？', '已重新打开'), 'sm warn'));
    } else if (s === 'closed' || s === 'wontfix') {
      box.append(fb.btn('重新打开', '这个问题又出现了 / 还是想改', ask('reopen', '为什么要重新打开？', '已重新打开'), 'sm'));
    } else {
      box.append(fb.btn('补充说明', '给这条反馈再加一句', ask(null, '补充说明…', '已补充'), 'sm'));
    }
    box.append(fb.btn('删除', '删除这条反馈', () => del(it), 'sm ghost'));
    return box;
  };
  // ---- rows ----
  const detail = (it) => {
    const url = fb.store.shotURL(it), d = U.el('div', { class: 'fb-detail' });
    if (url) d.append(U.el('img', { class: 'big', src: url, alt: '截图', title: '点击放大', onclick: () => fb.zoom(url) }));
    d.append(U.el('div', { class: 'fb-meta' }, it.part || '（整体）'),
      U.el('div', { class: 'fb-meta' }, `${it.category || '其他'} · 程度${SEVL[it.severity] || '中'} · ${fmt(it.created)} · ${it.id}${fb.store.isLocal(it.id) ? ' · 存在本机' : ''}`));
    const th = it.thread || [];
    if (th.length) d.append(U.el('div', { class: 'fb-thread' }, th.map(m => U.el('div', { class: 'fb-msg ' + (m.who === 'ai' ? 'ai' : 'user') },
      U.el('span', { class: 'who' }, m.who === 'ai' ? 'AI' : '我'), m.text,
      m.status ? U.el('span', { class: 'fb-st ' + m.status, style: { marginLeft: '5px' } }, STATUS[m.status] || m.status) : null,
      U.el('span', { class: 'at' }, fmt(m.at))))));
    const acts = actions(it);
    acts.prepend(fb.btn('回到当时的视角', '镜头、表情、动作恢复成写反馈时的样子', () => fb.restore(it), 'sm'));
    d.append(acts);
    return d;
  };
  const row = (it) => {
    const n = fb.store.nums.get(it.id), open = L.openId === it.id, url = fb.store.shotURL(it);
    const thumb = url ? U.el('img', { class: 'fb-thumb', src: url, alt: '', loading: 'lazy', draggable: 'false' }) : U.el('div', { class: 'fb-thumb' });
    const top = U.el('div', { class: 'fb-item-top' },
      U.el('span', { class: 'fb-num' }, '#' + n),
      U.el('span', { class: 'fb-ipart', title: it.part || '' }, it.partLabel || it.part || '（整体）'),
      U.el('span', { class: 'fb-sevtag s' + (it.severity || 2) }, SEVL[it.severity] || ''),
      U.el('span', { class: 'fb-st ' + it.status }, STATUS[it.status] || it.status));
    const el = U.el('div', { class: 'fb-item' + (open ? ' open' : ''), 'data-id': it.id },
      thumb, U.el('div', { style: { minWidth: 0 } }, top, U.el('div', { class: 'fb-itext' }, it.text || '')),
      open ? detail(it) : null);
    el.addEventListener('click', e => {
      if (!open) { fb.openItem(it.id); return; }
      if (e.target.closest('.fb-item-top, .fb-thumb')) { L.openId = null; L.reply = null; render(); }
    });
    el.addEventListener('pointerenter', () => V3.emit('fb-pin-hover', it.id));
    el.addEventListener('pointerleave', () => V3.emit('fb-pin-hover', null));
    return el;
  };

  // ---- panel ----
  let body = null, tabsEl = null, countEl = null;
  const setCollapsed = (c) => {
    L.el.classList.toggle('fb-collapsed', c);
    L.colBtn.textContent = c ? '▸' : '▾';
    fb.panelState('list', c ? 'min' : 'open');
  };
  const build = () => {
    countEl = U.el('span', { class: 'fb-dim' });
    L.colBtn = fb.btn('▾', '收起 / 展开', () => setCollapsed(!L.el.classList.contains('fb-collapsed')), 'sm ghost');
    tabsEl = U.el('div', { class: 'fb-tabs' });
    body = U.el('div', { class: 'fb-body' });
    L.el = U.el('div', { class: 'fb-side fb-right fb-panel' },
      U.el('div', { class: 'fb-head' }, U.el('b', null, '反馈列表'), countEl, L.colBtn), tabsEl, body);
    fb.root().append(L.el);
    const ps = fb.panelState('list');
    setCollapsed(ps ? ps === 'min' : innerWidth <= 760);
  };
  const render = fb.renderList = () => {
    if (!L.el) return;
    const items = (fb.store && fb.store.items) || [], f = tabFn(L.tab);
    countEl.textContent = items.length ? `${items.length} 条` : '';
    tabsEl.replaceChildren(...TABS.map(([k, label, fn]) =>
      fb.btn(`${label} ${items.filter(i => fn(i.status)).length}`, '', () => { L.tab = k; render(); }, 'sm' + (L.tab === k ? ' on' : ''))));
    const list = items.filter(i => f(i.status));
    V3.emit('fb-list', list);   // pins follow the same filter
    const ae = document.activeElement, hadFocus = !!ae && ae.tagName === 'TEXTAREA' && body.contains(ae), y = body.scrollTop;
    body.replaceChildren(...(list.length ? list.map(row) : [U.el('div', { class: 'fb-empty' },
      items.length ? '这一栏没有反馈' : fb.store && fb.store.checked ? '还没有反馈。\n点模型上不满意的地方，写一句话就行。' : '读取中…')]));
    body.scrollTop = y;
    const ta = body.querySelector('.fb-acts textarea');
    if (ta && (hadFocus || (L.reply && L.reply.focus))) {
      if (L.reply) L.reply.focus = false;
      ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  };
  const scrollToRow = (id) => {
    const r = body && body.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (r) r.scrollIntoView({ block: 'nearest' });
    return r;
  };
  const flashRow = (id) => { const r = scrollToRow(id); if (r) { r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash'); } };
  V3.on('init', () => { if (fb.enabled) { build(); render(); } });
  V3.on('fb-items', () => { if (L.openId && !fb.store.get(L.openId)) L.openId = null; render(); });
  V3.on('fb-added', (it) => { if (!tabFn(L.tab)(it.status)) L.tab = 'all'; render(); flashRow(it.id); });
  V3.on('fb-flash', flashRow);
})(window.V3);
