// 67-hud.js — V3.hud 游戏页 HUD（第④阶段，只在 cabin 页面挂载；91-cabin.js 调 V3.hud.mount()）。
// 右下角圆按钮：收集盒（角标 已找到种类/12）、设置、反馈（跳到 ?fb=1，再点一次退出）；左下角楼层：外观 / 一楼 / 阁楼，再加一个「跟随」（镜头跟着小鲸鱼，67-follow.js）。
// anchor(name) → { x, y, w, h } 按钮中心的屏幕坐标（CSS 像素）或 null（没挂载、ui=0、按钮看不见）。
// pulse(name)；badge(name, text)；toast(text, { color, icon, ms })。rarity(r) → { label, color }。
// modal(el, { name, onClose, onEsc })：收集盒和设置共用的弹窗，一次只开一个，Esc 或点背景关闭。
// 左上角天气小牌：wxInfo() → { kind, name, temp, place, offline, … }，wxIcon(w) → 图标节点；点小牌打开设置的「天气」页。
// game:open 'album'（点阁楼相册）→ 相册（68-album.js，2026-11-08 起；以前这里是「相册 · 以后开放」的小卡片）。
(function (V3) {
  'use strict';
  const U = V3.util;
  const H = V3.hud = V3.hud || {};
  // 稀有度的中文名和颜色以 V3.shellIcons（66-shell-icons.js）为准，这里只转调（r 可以是稀有度 id、贝壳 id 或 KINDS 条目）
  H.rarity = (r) => (V3.shellIcons && V3.shellIcons.rarity ? V3.shellIcons.rarity(r) : { id: String(r || ''), label: '', color: '#6fc3f5' });
  H.mounted = false;
  const svg = (d, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true">${d}</svg>`;
  const ICON = {
    box: svg('<path d="M12 20L2.4 11.2A13 13 0 0 1 21.6 11.2Z" fill="currentColor"/>' +
      '<path d="M12 16V8.2M10.8 16.2L8.4 8.7M13.2 16.2l2.4-7.5M9.7 16.7L5.2 10.3M14.3 16.7l4.5-6.4" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".85"/>' +
      '<path d="M8.6 18.4h6.8l-1.3 2.8H9.9z" fill="currentColor"/>', '0 2 24 24'),
    settings: svg('<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="3.2" stroke-dasharray="3.1 3.18"/>' +
      '<circle cx="12" cy="12" r="6.1" fill="none" stroke="currentColor" stroke-width="2.6"/>'),
    fb: svg('<path d="M5 4.5h14a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2h-7l-4.6 3.6V17H5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z" fill="currentColor"/>' +
      '<path d="M7.5 9h9M7.5 12.4h5.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>'),
  };
  // ---- 天气：数据读 V3.env.state.wx（sky 的 06-env.js）{ mode, kind, tempC, src }；
  // 它还没接上设置（V3.env.setWeather 不存在）时，退回 V3.game.get('weather') 的中文名，不显示气温 ----
  const WX_LIST = [['real', '实时天气'], ['clear', '晴'], ['cloudy', '多云'], ['overcast', '阴'], ['fog', '雾'],
    ['drizzle', '小雨'], ['rain', '大雨'], ['storm', '雷雨'], ['snow', '雪']];
  const wxName = (k) => { for (const [id, l] of (V3.scene && V3.scene.WEATHERS) || WX_LIST) if (id === k) return l; return String(k || ''); };
  // → 纯数据 { kind, name, temp（'18°C' 或 ''）, place（'济宁 · 实时' | '手动'）, real, offline, src, night }
  H.wxInfo = () => {
    const env = V3.env, st = env && env.state, w = st && st.wx, night = !!(st && st.night > 0.5);
    if (w && typeof w === 'object' && w.kind && typeof env.setWeather === 'function') {
      const real = w.mode === 'real', t = w.tempC;
      return { kind: w.kind, name: wxName(w.kind), temp: t != null && isFinite(t) ? Math.round(t) + '°C' : '',
        place: real ? '济宁 · 实时' : '手动', real, offline: real && (w.src === 'fallback' || w.src === 'cache'), src: String(w.src || ''), night };
    }
    const s = (V3.game && V3.game.get && V3.game.get('weather')) || 'real', real = s === 'real';
    return { kind: s, name: wxName(s), temp: '', place: real ? '济宁 · 实时' : '手动', real, offline: false, src: '', night };
  };
  // 天气图标（32×32 的 SVG）：云 = 几个圆 + 圆角矩形，先整体描一层深色边再盖一层浅色，拼出干净的外轮廓
  const f1 = (n) => +n.toFixed(1);
  const CL = '<circle cx="12" cy="18.5" r="5.5"/><circle cx="18" cy="14" r="6.5"/><circle cx="23.5" cy="18.5" r="5"/><rect x="7" y="16" width="21" height="8" rx="4"/>';
  const cloud = (fill, line, tf) => `<g transform="${tf}"><g fill="${line}" stroke="${line}" stroke-width="2.6" stroke-linejoin="round">${CL}</g><g fill="${fill}">${CL}</g></g>`;
  function sun(cx, cy, r) {
    let d = '';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
      d += `M${f1(cx + c * (r + 2.4))} ${f1(cy + s * (r + 2.4))}L${f1(cx + c * (r + 4.6))} ${f1(cy + s * (r + 4.6))}`;
    }
    return `<path d="${d}" stroke="#ffb830" stroke-width="2.2" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffc94d" stroke="#f0a92c" stroke-width="1.2"/>`;
  }
  // 月牙 = 圆 (15,17) r9 减去圆 (20,12) r8
  const moon = (tf) => `<path transform="${tf}" d="M23.76 19.06A9 9 0 1 1 12.94 8.24A8 8 0 0 0 23.76 19.06Z" fill="#ffe08a" stroke="#e8b84a" stroke-width="1.2" stroke-linejoin="round"/>`;
  const spark = (x, y, s) => `<path d="M${x} ${y - s}Q${x + s / 4} ${y - s / 4} ${x + s} ${y}Q${x + s / 4} ${y + s / 4} ${x} ${y + s}Q${x - s / 4} ${y + s / 4} ${x - s} ${y}Q${x - s / 4} ${y - s / 4} ${x} ${y - s}Z" fill="#ffe08a"/>`;
  const lines = (d, c, w = 2.4) => `<path d="${d}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
  const TOP = 'translate(1.5 -3) scale(.9)';            // 下面要画雨 / 雪时，云往上提
  const WX_ICON = {
    clear: (n) => (n ? moon('translate(2 -3)') + spark(21.5, 10, 2.8) + spark(26.5, 5.5, 1.6) : sun(16, 16, 6.5)),
    cloudy: (n) => (n ? moon('translate(1 -1) scale(.62)') : sun(11.5, 11, 5)) + cloud('#fff', '#9fb7cc', 'translate(3 6) scale(.85)'),
    overcast: () => cloud('#cfdbe6', '#9fb0c2', 'translate(-3 -3) scale(.8)') + cloud('#fff', '#9fb7cc', 'translate(3 5) scale(.85)'),
    fog: () => cloud('#eef3f7', '#a9b8c6', 'translate(2.5 -1.5) scale(.85)') + lines('M5 22.5h16M10 26h17M6 29.5h13', '#a9bfd3', 2.2),
    drizzle: () => cloud('#fff', '#8fb0cc', TOP) + lines('M11 22.5l-.8 2M17.5 22.5l-.8 2M24 22.5l-.8 2M14.2 27.5l-.8 2M20.7 27.5l-.8 2', '#5aa9e6', 2),
    rain: () => cloud('#eef4fa', '#7f9fbb', TOP) + lines('M11 21.5l-2 5M17.5 21.5l-2 5M24 21.5l-2 5M14.3 27l-1.4 3.5M20.8 27l-1.4 3.5', '#4a9be0'),
    storm: () => cloud('#c9d4e0', '#7d8ea3', TOP) + lines('M10 21.5l-1.6 4M25.5 21.5l-1.6 4', '#4a9be0', 2.2) +
      '<path d="M18.5 18.5l-4.5 7h3.6l-2.1 5.6 6.3-8.1h-3.8l2.6-4.5z" fill="#ffc94d" stroke="#e0a020" stroke-width="1" stroke-linejoin="round"/>',
    snow: () => cloud('#fff', '#9fb7cc', TOP) + [[11, 24.5], [17.5, 28], [24, 24.5]].map(([x, y]) =>
      lines(`M${x} ${y - 2.3}v4.6M${x - 2} ${y - 1.15}l4 2.3M${x - 2} ${y + 1.15}l4 -2.3`, '#7cc0ef', 1.6)).join(''),
  };
  // → <span class="hud-wx-svg"><svg…></span>（DOM 节点，设置面板的「现在」一行也用）
  H.wxIcon = (w) => {
    const s = document.createElement('span');
    s.className = 'hud-wx-svg';
    s.innerHTML = svg((WX_ICON[w && w.kind] || WX_ICON.cloudy)(!!(w && w.night)), '0 0 32 32');
    return s;
  };
  const btns = {};
  let root = null, toasts = null, floorEl = null, wxEl = null, wxSig = '', lastBadge = '', hold = 0, lastPoll = 0;
  const fbOn = () => !window.__V3_NO_FB;

  function roundBtn(name, label, title, onClick) {
    const b = U.el('button', { class: 'hud-btn hud-' + name, type: 'button', title, 'aria-label': title, onclick: onClick });
    b.innerHTML = ICON[name];
    const badge = U.el('span', { class: 'hud-badge hide' });
    b.append(badge);
    btns[name] = { el: b, badge };
    return U.el('div', { class: 'hud-cell' }, b, U.el('span', { class: 'hud-tag' }, label));
  }
  function toggleFb() {
    const u = new URL(location.href);
    if (fbOn()) u.searchParams.delete('fb'); else u.searchParams.set('fb', '1');
    location.href = u.toString();
  }
  // ---- 楼层：先 setState('floor')，再把镜头飞到对应视角（远景里看不清一楼和阁楼）----
  // 最右边多一个「跟随」（67-follow.js，不是楼层状态的第四个值）：镜头跟着小鲸鱼走，楼层跟着她在哪儿自动换。
  // 再点一次「跟随」= 退出（镜头、楼层留在原地）；点 外观 / 一楼 / 阁楼 = 退出，然后和平时一样换楼层、飞到那个视角。
  // 跟随开着时楼层按钮照样标出现在剖开的是哪一层（.hud-floors.following 下只描边），「跟随」自己是实心的。
  const FLOOR_VIEW = { all: 'hero', ground: 'inside', loft: 'loft' };
  const floorState = () => { const m = V3.models.current && V3.models.current(); return m && m.states && m.states.floor ? m : null; };
  let followBtn = null;
  function setFloor(v) {
    const m = floorState(); if (!m) return;
    if (V3.follow && V3.follow.on()) V3.follow.set(false);
    V3.setState('floor', v);
    const view = m.views && m.views[FLOOR_VIEW[v]];
    if (view && V3.R && V3.R.ctl) V3.R.ctl.set(view, true);
  }
  function buildFloors() {
    if (!floorEl) return;
    const m = floorState();
    floorEl.textContent = '';
    followBtn = null;
    floorEl.classList.toggle('hide', !m);
    if (!m) return;
    for (const [v, label] of m.states.floor.options) {
      floorEl.append(U.el('button', { class: 'hud-floor', type: 'button', 'data-v': v, onclick: () => setFloor(v) }, label));
    }
    if (V3.follow) {
      followBtn = U.el('button', { class: 'hud-floor hud-follow', type: 'button', title: '镜头跟着小鲸鱼走（再点一次停下）', 'aria-pressed': 'false',
        onclick: () => V3.follow.toggle() }, '跟随');
      floorEl.append(followBtn);
    }
    syncFloors();
  }
  function syncFloors() {
    const m = floorState(); if (!floorEl || !m) return;
    for (const b of floorEl.children) if (b !== followBtn) b.classList.toggle('on', b.dataset.v === m.states.floor.value);
    syncFollow();
  }
  // 「跟随」按钮：开着就亮；没有小鲸鱼可跟（V3.actor 是空的）而且没开着时不显示
  function syncFollow() {
    if (!floorEl || !followBtn) return;
    const F = V3.follow, on = F.on();
    followBtn.classList.toggle('on', on);
    followBtn.classList.toggle('hide', !on && !F.available());
    followBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    floorEl.classList.toggle('following', on);
  }
  // ---- 收集盒角标：跟着 V3.game.counts()；捡到时等图标飞进盒子（pulse('box')）再跳数字，最多等 3 秒 ----
  function syncBox() {
    const G = V3.game; let c = null;
    try { c = G && G.counts ? G.counts() : null; } catch (e) { c = null; }
    const t = c ? c.kinds + '/' + (c.total || 12) : '';
    if (t === lastBadge) return;
    lastBadge = t; H.badge('box', t || null);
    if (btns.box) btns.box.badge.classList.toggle('full', !!c && c.kinds >= (c.total || 12));
  }

  H.anchor = (name) => {
    const b = btns[name];
    if (!H.mounted || !b || document.body.classList.contains('ui-off')) return null;
    const r = b.el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  };
  H.pulse = (name) => {
    const b = btns[name]; if (!b) return;
    b.el.classList.remove('pulse'); void b.el.offsetWidth; b.el.classList.add('pulse');
    clearTimeout(b.pt); b.pt = setTimeout(() => b.el.classList.remove('pulse'), 650);
    if (name === 'box') { if (hold > 0) hold--; syncBox(); }
  };
  H.badge = (name, text) => {
    const b = btns[name]; if (!b) return;
    const on = text != null && text !== '';
    b.badge.textContent = on ? String(text) : '';
    b.badge.classList.toggle('hide', !on);
  };
  // 图标像素 = CSS 尺寸 × devicePixelRatio（shellIcons.get 的 size 是图片像素）
  H.iconPx = (css) => Math.round(css * (window.devicePixelRatio || 1));
  H.toast = (text, o = {}) => {
    if (!toasts) return null;
    const t = U.el('div', { class: 'hud-toast' + (o.first ? ' first' : '') });
    if (o.color) t.style.setProperty('--c', o.color);
    let ic = o.icon || null;
    if (!ic && o.kind && V3.shellIcons && V3.shellIcons.get) ic = V3.shellIcons.get(o.kind, { size: H.iconPx(28) });
    t.append(ic ? U.el('img', { class: 'hud-toast-ic', src: ic, alt: '' }) : U.el('i', { class: 'hud-toast-dot' }), U.el('span', null, String(text)));
    toasts.append(t);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 380); }, o.ms || 2600);
    return t;
  };
  // ---- 弹窗：收集盒和设置共用，一次只开一个；Esc / 点背景关闭（Esc 走捕获阶段，先于反馈工具的快捷键）----
  let cur = null;
  H.modal = (card, o = {}) => {
    H.closeModal();
    const back = U.el('div', { class: 'hud-modal' + (o.cls ? ' ' + o.cls : '') });
    // 只有按下和松开都在背景上才算"点背景关闭"（拖滑条拖到卡片外面松手不会误关）
    let downBack = false;
    back.addEventListener('pointerdown', (e) => { downBack = e.target === back; });
    back.addEventListener('click', (e) => { if (e.target === back && downBack) H.closeModal(); downBack = false; });
    back.append(card);
    document.body.append(back);
    cur = { back, card, o };
    requestAnimationFrame(() => back.classList.add('in'));
    return back;
  };
  H.closeModal = (name) => {
    if (!cur || (name && cur.o.name !== name)) return false;
    const c = cur; cur = null;
    c.back.remove();
    if (c.o.onClose) { try { c.o.onClose(); } catch (e) { V3.err('hud modal onClose: ' + e.message); } }
    return true;
  };
  H.modalOpen = (name) => !!cur && (!name || cur.o.name === name);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !cur) return;
    e.preventDefault(); e.stopPropagation();
    if (cur.o.onEsc && cur.o.onEsc() === true) return;   // 例如收集盒详情：先回到列表
    H.closeModal();
  }, true);

  // ---- 左上角天气小牌：图标 + 气温（没有气温时是天气名）+「济宁 · 实时 / 手动」，离线加小灰点；点了打开设置的「天气」页 ----
  function syncWx() {
    if (!wxEl) return;
    const w = H.wxInfo(), sig = JSON.stringify(w);
    if (sig === wxSig) return;
    wxSig = sig;
    const main = w.temp ? w.name + ' ' + w.temp : w.name;
    wxEl.replaceChildren(H.wxIcon(w), U.el('span', { class: 'hud-wx-txt' },
      U.el('b', { class: 'hud-wx-main' }, main),
      U.el('span', { class: 'hud-wx-place' }, w.offline ? U.el('i', { class: 'hud-wx-off' }) : null, w.place)));
    wxEl.dataset.kind = w.kind;
    wxEl.classList.toggle('night', w.night);
    wxEl.classList.toggle('offline', w.offline);
    const tip = '现在：' + main + '（' + w.place + '）' +
      (w.offline ? '\n离线：' + (w.src === 'cache' ? '用的是上次取到的天气' : '取不到实时天气，先当晴天') : '') + '\n点一下可以换天气';
    wxEl.title = tip;
    wxEl.setAttribute('aria-label', tip.replace(/\n/g, '，'));
  }
  function openWx() {
    const f = ((V3.game && V3.game.SCHEMA) || []).find((x) => x.key === 'weather');
    if (V3.settingsPanel && V3.settingsPanel.open) V3.settingsPanel.open((f && f.group) || '天气');
    else V3.emit('game:open', 'settings');
  }
  // 相册（点阁楼的相册矮桌）在 68-album.js：它自己听 game:open 'album'

  H.mount = () => {
    if (H.mounted) return root;
    H.mounted = true;
    document.body.classList.add('hud-on');
    document.body.classList.toggle('hud-fb', fbOn());
    toasts = U.el('div', { class: 'hud-toasts' });
    floorEl = U.el('div', { class: 'hud-floors hide' });
    wxEl = U.el('button', { class: 'hud-wx', type: 'button', onclick: openWx });
    const open = (what) => () => V3.emit('game:open', what);
    root = U.el('div', { class: 'hud-root' }, wxEl, floorEl,
      U.el('div', { class: 'hud-corner' },
        window.__V3_PLAY ? null : roundBtn('fb', fbOn() ? '退出反馈' : '反馈', fbOn() ? '关掉反馈工具' : '打开反馈工具：点模型的任何地方写意见', toggleFb),   // 小鲸鱼之家（只玩）没有反馈
        roundBtn('settings', '设置', '设置', open('settings')),
        roundBtn('box', '收集盒', '收集盒', open('collection'))));
    document.body.append(root, toasts);
    buildFloors(); syncBox(); syncWx();
    V3.emit('hud:mount', H);
    return root;
  };
  V3.on('model', () => buildFloors());
  V3.on('state', () => { syncFloors(); syncWx(); });
  V3.on('follow', () => syncFollow());
  V3.on('wx', () => syncWx());
  V3.on('game:settings', () => syncWx());
  V3.on('game:collect', () => {
    if (!H.mounted) return;
    hold++; setTimeout(() => { if (hold > 0) hold--; syncBox(); }, 2500);
  });
  V3.on('game:reset', () => { hold = 0; syncBox(); });
  V3.on('frame', () => {
    if (!H.mounted) return;
    const now = performance.now(); if (now - lastPoll < 400) return;
    lastPoll = now; syncWx();                              // 气温、白天 / 夜里的图标都慢慢变，轮询就够了
    syncFollow();                                          // 小鲸鱼晚一点才出来 / 没了：「跟随」按钮跟着显示 / 收起
    if (hold <= 0) syncBox();
  });
})(window.V3);
