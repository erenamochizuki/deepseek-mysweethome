// 69-settings.js — V3.settingsPanel：设置面板（docs/SPEC-4.md §4）。界面完全按 V3.game.SCHEMA 自动生成：
// item.group → 页签（按第一次出现的顺序）；range → 滑条 + 数值；toggle → 开关；select → 下拉；
// button → V3.game.action(item.action)，带 confirm 的先在面板里确认一次；custom → item.render() 返回的元素（模块自己管）。
// 改动马上 V3.game.set(key, value)；成对的「最短 / 最长」会被 game 顺手推开，所以每次改完都把全部控件重新对齐。
// open(tab?)：tab = 组名（如 '天气'）就直接切到那一页；不传就停在上次看的那页。
(function (V3) {
  const U = V3.util;
  const H = V3.hud = V3.hud || {};
  const SP = V3.settingsPanel = V3.settingsPanel || {};
  const G = () => V3.game;
  let card = null, ctrls = [], asking = null, tabs = new Map(), tab = null, nowEl = null, ticker = 0;

  const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
  const decimals = (step) => { const s = String(step || 1); return s.includes('.') ? s.split('.')[1].length : 0; };
  function fmtVal(f, v) {
    v = num(v);
    if (f.fmt === 'pct') return Math.round(v * 100) + '%';
    const t = v.toFixed(decimals(f.step));
    return f.unit ? t + ' ' + f.unit : t;
  }
  const hintEl = (f) => (f.hint ? U.el('div', { class: 'set-hint' }, f.hint) : null);
  const getVal = (k) => (G().get ? G().get(k) : (G().S || {})[k]);
  function syncAll() { if (!card) return; for (const c of ctrls) c.sync(getVal(c.f.key)); syncNow(); }

  // ---- 右边的数值可以直接改（2026-11-12）：输入框本身是 00-core 的 U.numField（「角色」页的模型设置也用它）----
  // 能认的写法见 U.parseNumber：「7」「7.5」「７．５」「7,5」「7 分钟」；百分比字段（fmt: 'pct'，存 0..1）按 0–100 输入。
  // 范围和步长不在这里管：交给 V3.game.set（60-game 的 norm：夹到 min..max、对齐到 step），和拖滑条走同一条路；
  // 成对的「最短 / 最长」照样会互相推开。认不出来（空的、只有字）就恢复原来的值。
  const editText = (f, v) => (f.fmt === 'pct' ? String(Math.round(num(v) * 100)) : String(+num(v).toFixed(decimals(f.step))));

  function rangeRow(f) {
    const id = 'set-' + f.key;
    const inp = U.el('input', { class: 'set-range', type: 'range', id, min: f.min, max: f.max, step: f.step || 1 });
    const fill = () => inp.style.setProperty('--p', U.clamp((num(inp.value) - f.min) / ((f.max - f.min) || 1) * 100, 0, 100) + '%');
    const val = U.numField({ cls: 'set-val', label: f.label, pct: f.fmt === 'pct', step: f.step || 1,
      format: (v) => fmtVal(f, v), edit: (v) => editText(f, v), get: () => getVal(f.key), set: (v) => { G().set(f.key, v); syncAll(); } });
    inp.addEventListener('input', () => { G().set(f.key, num(inp.value)); syncAll(); });
    ctrls.push({ f, sync: (v) => { if (Math.abs(num(inp.value) - num(v)) > 1e-9) inp.value = v; val.sync(v); fill(); } });
    return U.el('div', { class: 'set-row set-r-range', 'data-key': f.key },
      U.el('label', { class: 'set-label', for: id }, f.label), inp, val.el, hintEl(f));
  }
  function toggleRow(f) {
    const inp = U.el('input', { class: 'set-check', type: 'checkbox', id: 'set-' + f.key });
    inp.addEventListener('change', () => { G().set(f.key, inp.checked); syncAll(); });
    ctrls.push({ f, sync: (v) => { inp.checked = !!v; } });
    return U.el('label', { class: 'set-row set-r-toggle', 'data-key': f.key },
      U.el('span', { class: 'set-label' }, f.label), inp, U.el('i', { class: 'set-switch' }), hintEl(f));
  }
  function selectRow(f) {
    const id = 'set-' + f.key;
    const opts = (f.options || []).map((o) => (Array.isArray(o) ? o : [o.id, o.label]));
    const sel = U.el('select', { class: 'set-select', id }, opts.map(([v, label]) => U.el('option', { value: v }, label)));
    sel.addEventListener('change', () => { G().set(f.key, sel.value); syncAll(); });
    ctrls.push({ f, sync: (v) => { if (sel.value !== String(v)) sel.value = v; } });
    const row = U.el('div', { class: 'set-row set-r-select', 'data-key': f.key },
      U.el('label', { class: 'set-label', for: id }, f.label), sel, hintEl(f));
    // 天气下拉下面放一行「现在」：图标 + 天气 + 气温 + 济宁 · 实时 / 手动（数据同 HUD 左上角的小牌）
    if (f.key === 'weather' && H.wxInfo) { nowEl = U.el('div', { class: 'set-now' }); row.append(nowEl); }
    return row;
  }
  function syncNow() {
    if (!nowEl || !H.wxInfo) return;
    const w = H.wxInfo(), sig = JSON.stringify(w);
    if (nowEl.dataset.sig === sig) return;
    nowEl.dataset.sig = sig;
    nowEl.replaceChildren(U.el('span', { class: 'set-now-ic' }, H.wxIcon(w)), U.el('b', null, '现在：' + w.name + (w.temp ? ' ' + w.temp : '')),
      U.el('span', { class: 'set-now-src' + (w.offline ? ' off' : '') }, w.place + (w.offline ? '（离线，用的是' + (w.src === 'cache' ? '上次的' : '估计的') + '天气）' : '')));
  }

  // custom：别的模块自己画这一行（f.render() → 元素），例如「角色」页的模型列表（29-ysm-ui.js）
  function customRow(f) {
    try { const el = typeof f.render === 'function' ? f.render() : null; return el ? U.el('div', { class: 'set-row set-r-custom', 'data-key': f.key }, el) : null; }
    catch (e) { V3.err('settings custom ' + f.key + ': ' + ((e && e.message) || e)); return null; }
  }
  // 按钮：连着的几个放一行；带 confirm 的点一下先变成「提示 + 确定 / 取消」，Esc 也是取消
  function run(f) {
    let res;
    try { res = G().action(f.action || f.key); } catch (e) {
      V3.err('settings action ' + f.key + ': ' + ((e && e.message) || e));
      if (H.toast) H.toast('没成功：' + f.label, { color: '#ff8a8a' });
      return;
    }
    if (!H.toast) return;
    if (Array.isArray(res)) {
      const st = G().st || {}, S = G().S || {};
      if (res.length) H.toast('冲上来 ' + res.length + ' 个贝壳，去沙滩看看吧', { color: '#6fc3f5' });
      else if (st.beach && S.maxBeach && st.beach.length >= S.maxBeach) H.toast('沙滩上已经放满了（最多 ' + S.maxBeach + ' 个），先去捡一捡吧', { color: '#6fc3f5' });
      else H.toast('这一波什么也没冲上来', { color: '#6fc3f5' });
    } else H.toast('已' + f.label, { color: '#6fc3f5' });
  }
  function buttonsRow(list) {
    const row = U.el('div', { class: 'set-row set-r-btns' });
    const draw = (ask) => {
      if (ask && asking) asking();
      row.replaceChildren();
      row.classList.toggle('asking', !!ask);
      asking = ask ? () => draw(null) : null;
      if (ask) {
        const no = U.el('button', { class: 'set-btn', type: 'button', onclick: () => draw(null) }, '取消');
        row.append(U.el('div', { class: 'set-ask' }, ask.confirm),
          U.el('button', { class: 'set-btn warn go', type: 'button', 'data-key': ask.key, onclick: () => { draw(null); run(ask); } }, '确定'), no);
        no.focus();
        return;
      }
      for (const f of list) row.append(U.el('button', { class: 'set-btn ' + (f.confirm ? 'warn' : 'pri'), type: 'button', 'data-key': f.key,
        onclick: () => (f.confirm ? draw(f) : run(f)) }, f.label));
    };
    draw(null);
    return row;
  }

  // ---- 页签 ----
  function setTab(name) {
    if (!tabs.has(name)) return;
    if (asking) asking();
    tab = name;
    for (const [n, t] of tabs) {
      const on = n === name;
      t.btn.classList.toggle('on', on); t.btn.setAttribute('aria-selected', on ? 'true' : 'false');
      t.panel.hidden = !on;
    }
    syncNow();
  }
  function build() {
    ctrls = []; asking = null; tabs = new Map(); nowEl = null;
    const groups = new Map();
    for (const f of G().SCHEMA || []) {
      const g = f.group || '其他';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(f);
    }
    const bar = U.el('div', { class: 'set-tabs', role: 'tablist' });
    const body = U.el('div', { class: 'hud-card-body set-body' });
    for (const [name, list] of groups) {
      const panel = U.el('section', { class: 'set-group', role: 'tabpanel', 'data-tab': name });
      let btns = null;
      for (const f of list) {
        if (f.type === 'button') { (btns = btns || []).push(f); continue; }
        if (btns) { panel.append(buttonsRow(btns)); btns = null; }
        const row = f.type === 'toggle' ? toggleRow(f) : f.type === 'select' ? selectRow(f) : f.type === 'custom' ? customRow(f)
          : (f.min != null && f.max != null) ? rangeRow(f) : null;
        if (row) panel.append(row);
      }
      if (btns) panel.append(buttonsRow(btns));
      const btn = U.el('button', { class: 'set-tab', type: 'button', role: 'tab', 'data-tab': name, onclick: () => setTab(name) }, name);
      bar.append(btn); body.append(panel);
      tabs.set(name, { btn, panel });
    }
    card = U.el('div', { class: 'hud-card set' },
      U.el('div', { class: 'hud-card-head' }, U.el('div', { class: 'hud-card-title' }, '设置'), bar,
        U.el('button', { class: 'hud-x', type: 'button', title: '关闭（改动已经自动记住）', 'aria-label': '关闭', onclick: () => SP.close() }, '✕')),
      body);
    setTab(tabs.has(tab) ? tab : groups.keys().next().value);
  }

  SP.open = (want) => {
    if (!G() || !G().SCHEMA || !H.modal) { if (H.toast) H.toast('设置还没准备好'); return false; }
    if (!card) build();
    if (want && tabs.has(want)) setTab(want);
    syncAll();
    if (!SP.isOpen()) {
      H.modal(card, { name: 'settings',
        onClose: () => { if (asking) asking(); clearInterval(ticker); ticker = 0; },
        onEsc: () => { if (asking) { asking(); return true; } return false; } });
      clearInterval(ticker); ticker = setInterval(syncNow, 1000);   // 实时天气是异步取的，开着面板时每秒对一下
    }
    return true;
  };
  SP.close = () => H.closeModal && H.closeModal('settings');
  SP.isOpen = () => !!(H.modalOpen && H.modalOpen('settings'));
  SP.tab = () => tab;
  SP.setTab = (name) => { if (!card) build(); setTab(name); };
  V3.on('game:open', (what) => { if (what === 'settings' && H.mounted) SP.open(); });
  V3.on('game:settings', () => { if (SP.isOpen()) syncAll(); });
})(window.V3);
