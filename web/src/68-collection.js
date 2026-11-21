// 68-collection.js — V3.collection 收集盒（cabin 页面）：open() / close() / isOpen()，也听 'game:open' 'collection'。
// 顶部「已找到 n / 总数」+ 进度条；卡片按稀有度分组。没找到：剪影、「？？？」、稀有度；找到：图标、名字、×n，
// 右上角：这一种里有大金冠 / 小金冠的那一枚就显示对应的王冠（王冠规则见 58-inventory-rules：尺寸落在本种区间两端 5% 内）。
// 点卡片打开详情：小转台（自己的 256×256 WebGLRenderer，关掉就 dispose）、名字、稀有度、介绍，下面是「我的 N 枚」：
// 每一枚的花纹、尺寸、王冠、捡到的时间、现在在哪；点一枚，转台换成那一枚的花纹，尺寸条标出它在本种区间里的位置。
// 图标用 V3.shellIcons.get(id, { silhouette, size, pat })；它还没好时用稀有度颜色的圆点。
(function (V3) {
  'use strict';
  const U = V3.util, H = V3.hud;
  const C = V3.collection = V3.collection || {};
  const GROUPS = ['common', 'uncommon', 'rare', 'ultra'];
  let tab = 'shells', tabButtons, fishPane, fishPage, gardenPane;
  let card = null, body = null, head = null, main = null, detail = null, stage = null, flashId = null;
  const kinds = () => (V3.game && V3.game.kinds ? V3.game.kinds() : (V3.shells && V3.shells.KINDS) || []);
  const found = () => (V3.game && V3.game.st && V3.game.st.found) || {};
  // 见过这一种（卖光了 n = 0 也算：图鉴记得）
  const got = (id) => found()[id] || null;
  const itemsOf = (id) => { const f = got(id); return f && Array.isArray(f.items) ? f.items : []; };
  const R = () => V3.inventoryRules;
  const crownOf = (k, it) => (R() ? R().crown(k, it.size) : null);
  const PIC = 64, BIG = 176, ROW = 30;   // 卡片图标 / 详情大剪影 / 列表小图标的 CSS 尺寸；图片像素 = CSS × devicePixelRatio
  let preloaded = null;
  function preload() {   // shellIcons.preload 每帧画一个；hud:mount 时就开始，打开收集盒前再确认一次
    if (!preloaded && V3.shellIcons && V3.shellIcons.preload) preloaded = V3.shellIcons.preload(H.iconPx(PIC));
    return preloaded;
  }
  V3.on('hud:mount', () => preload());
  // 图标（V3.shellIcons.get → PNG dataURL）；shellIcons 没加载时用稀有度颜色的圆点
  function pic(k, sil, cls, css = PIC, pat) {
    let src = null;
    try { if (V3.shellIcons && V3.shellIcons.get) src = V3.shellIcons.get(k.id, { silhouette: sil, size: H.iconPx(css), pat }); } catch (e) { src = null; }
    if (typeof src === 'string') return U.el('img', { class: cls + ' col-img' + (sil ? ' sil' : ''), src, alt: '', draggable: 'false' });
    const d = U.el('i', { class: cls + ' col-dot' + (sil ? ' sil' : '') });
    d.style.setProperty('--c', H.rarity(k).color);
    return d;
  }
  // 王冠图标：大金冠五个尖、小金冠三个尖（都是金色），title 里写清楚
  const CROWN_SVG = {
    big: '<svg viewBox="0 0 24 18" aria-hidden="true"><path d="M2 15 L1 4 L7 9 L12 1 L17 9 L23 4 L22 15 Z" fill="#f6c443" stroke="#b9831a" stroke-width="1.4" stroke-linejoin="round"/><rect x="2" y="14.5" width="20" height="2.6" rx="1" fill="#e2a62b"/><circle cx="12" cy="10.5" r="1.7" fill="#fff4cf"/></svg>',
    small: '<svg viewBox="0 0 24 18" aria-hidden="true"><path d="M4 15 L3 6 L9 10 L12 4 L15 10 L21 6 L20 15 Z" fill="#f6c443" stroke="#b9831a" stroke-width="1.4" stroke-linejoin="round"/><rect x="4" y="14.5" width="16" height="2.6" rx="1" fill="#e2a62b"/></svg>',
  };
  const CROWN_NAME = { big: '大金冠：这一种里最大的那一档', small: '小金冠：这一种里最小的那一档' };
  function crownEl(kind, cls = '') {
    const s = U.el('span', { class: 'col-crown ' + kind + (cls ? ' ' + cls : ''), title: CROWN_NAME[kind], role: 'img', 'aria-label': CROWN_NAME[kind] });
    s.innerHTML = CROWN_SVG[kind];
    return s;
  }
  C.crownEl = crownEl;
  const p2 = (n) => String(n).padStart(2, '0');
  // 稀有度颜色和它的浅色 / 半透明色一起设到元素上（68-collection.css 用 --c-…；为什么不用 color-mix() 见那里的注释）
  function tint(el, c) {
    const st = el.style;
    st.setProperty('--c', c);
    st.setProperty('--c-30a', U.alpha(c, 0.3)); st.setProperty('--c-45a', U.alpha(c, 0.45));
    st.setProperty('--c-22w', U.mix(c, '#ffffff', 0.22)); st.setProperty('--c-24w', U.mix(c, '#ffffff', 0.24)); st.setProperty('--c-32w', U.mix(c, '#ffffff', 0.32));
    st.setProperty('--c-22g', U.mix(c, '#e6ecf4', 0.22)); st.setProperty('--c-50g', U.mix(c, '#c7d0dc', 0.5)); st.setProperty('--c-40b', U.mix(c, '#eaf4fb', 0.4));
  }
  const when = (ms) => { if (!ms) return '—'; const d = new Date(ms); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const day = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const mm = (v) => (+v).toFixed(1) + ' mm';
  function counts() {
    try { if (V3.game && V3.game.counts) return V3.game.counts(); } catch (e) { /* 用下面的 */ }
    const ks = kinds(); return { kinds: ks.filter((k) => got(k.id)).length, total: ks.length || 12, items: 0 };
  }
  // 这一枚现在在哪：摆件位置 / 展示盒 / 收在柜子里
  function whereMap() {
    const I = V3.cabinInventory, inv = I && I.data && I.data.inventory, out = new Map();
    if (!inv) return out;
    const label = (slot) => (V3.shellControls ? V3.shellControls.label(slot) : slot);
    for (const [slot, p] of Object.entries(inv.placements)) if (p.uid) out.set(p.uid, { slot, text: '摆在' + label(slot) });
    for (const t of (inv.tray && inv.tray.items) || []) out.set(t.uid, { tray: true, text: '在展示盒' });
    if (inv.shore?.loan) out.set(inv.shore.loan, { loan: true, text: '寄居蟹正背着' });
    return out;
  }

  function cardOf(k) {
    const f = got(k.id), rar = H.rarity(k.rarity), its = itemsOf(k.id);
    const crowns = U.el('span', { class: 'col-crowns' });
    for (const c of ['big', 'small']) if (its.some((it) => crownOf(k, it) === c)) crowns.append(crownEl(c));
    const el = U.el('button', { class: 'col-card ' + k.rarity + (f ? ' got' : ' miss') + (flashId === k.id ? ' flash' : ''), type: 'button',
      title: f ? k.name : '还没找到', onclick: () => openDetail(k.id) },
      crowns,
      U.el('span', { class: 'col-well' }, pic(k, !f, 'col-pic')),
      U.el('span', { class: 'col-name' }, f ? k.name : '？？？'),
      U.el('span', { class: 'col-sub' }, f ? '×' + f.n : rar.label));
    tint(el, rar.color);
    el.dataset.id = k.id;
    return el;
  }
  function render() {
    if (!card) return;
    if (tab === 'garden') {
      const { known, total } = V3.windowGarden.journal(gardenPane);
      head.num.textContent = `已开花 ${known} / ${total}`;
      head.bar.style.width = (total && Number.isFinite(known) ? 100 * known / total : 0) + '%';
      head.sub.textContent = '窗台上的第一朵花';
      return;
    }
    if (tab === 'fish') {
      const progress = fishPage.refresh();
      head.num.textContent = `已观察 ${progress.known} / ${progress.total}`;
      head.bar.style.width = (Number.isFinite(progress.known) ? 100 * progress.known / progress.total : 0) + '%'; head.sub.textContent = '小鲸鱼的潮池手记'; return;
    }
    const c = counts(), ks = kinds();
    head.num.textContent = `已找到 ${c.kinds} / ${c.total}`;
    head.bar.style.width = (c.total ? (100 * c.kinds) / c.total : 0) + '%';
    head.sub.textContent = c.kinds >= c.total ? '全部找齐了，好厉害！' : c.items ? `一共有 ${c.items} 个` : '去沙滩上找找看吧';
    body.textContent = '';
    if (V3.inventoryUI && V3.game && V3.game.hosted) body.append(V3.inventoryUI.panel());
    if (V3.sandTray && V3.game && V3.game.hosted) body.append(U.el('button', { type: 'button', class: 'col-back col-tray', onclick: () => V3.sandTray.open() }, '打开沙盘展示盒 ›'));
    for (const r of GROUPS) {
      const list = ks.filter((k) => k.rarity === r); if (!list.length) continue;
      const rar = H.rarity(r), n = list.filter((k) => got(k.id)).length;
      const h = U.el('div', { class: 'col-group-h' }, U.el('i', { class: 'col-gdot' }), rar.label, U.el('span', { class: 'col-gnum' }, `${n} / ${list.length}`));
      tint(h, rar.color);
      body.append(h, U.el('div', { class: 'col-grid' }, list.map(cardOf)));
    }
    if (!ks.length) body.append(U.el('div', { class: 'col-empty' }, '贝壳图鉴还没加载出来。'));
  }
  function build() {
    head = { num: U.el('span', { class: 'col-num' }), bar: U.el('i'), sub: U.el('span', { class: 'col-subhead' }) };
    const choices = [['shells', '海滩收藏'], ['fish', '鱼类图鉴'], ['garden', '花盆手记']];
    tabButtons = Object.fromEntries(choices.map(([key, title], index) => [key, U.el('button', { type: 'button', role: 'tab', id: 'col-tab-' + key, 'aria-controls': 'col-page-' + key,
      onclick: () => selectTab(key), onkeydown: event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const offset = event.key === 'ArrowLeft' ? -1 : 1;
        const next = event.key === 'Home' ? choices[0] : event.key === 'End' ? choices.at(-1) : choices[(index + offset + choices.length) % choices.length];
        selectTab(next[0]); tabButtons[next[0]].focus();
      } }, title)]));
    body = U.el('div', { class: 'hud-card-body col-body', role: 'tabpanel', id: 'col-page-shells', 'aria-labelledby': 'col-tab-shells' });
    fishPane = U.el('div', { class: 'fish-pages', role: 'tabpanel', id: 'col-page-fish', 'aria-labelledby': 'col-tab-fish', hidden: true });
    gardenPane = U.el('div', { class: 'garden-pages', role: 'tabpanel', id: 'col-page-garden', 'aria-labelledby': 'col-tab-garden', hidden: true });
    main = U.el('div', { class: 'col-main' }, body, fishPane, gardenPane);
    card = U.el('div', { class: 'col-folio', role: 'dialog', 'aria-modal': 'true', 'aria-label': '收集盒' },
      U.el('div', { class: 'col-bookmarks', role: 'tablist', 'aria-label': '收集盒分类' }, Object.values(tabButtons)),
      U.el('div', { class: 'hud-card col' },
      U.el('div', { class: 'hud-card-head' },
        U.el('span', { class: 'hud-card-title' }, '收集盒'),
        U.el('div', { class: 'col-count' }, head.num, U.el('span', { class: 'col-bar' }, head.bar), head.sub),
        U.el('button', { class: 'hud-x', type: 'button', title: '关闭', 'aria-label': '关闭', onclick: () => C.close() }, '✕')),
      main));
  }
  function selectTab(next) {
    if (!(next === 'fish' && V3.fishGuide) && !(next === 'garden' && V3.windowGarden)) next = 'shells';
    if (next !== tab) { closeDetail(); if (tab === 'fish') fishPage?.back(false); } tab = next;
    for (const [key, button] of Object.entries(tabButtons)) { button.setAttribute('aria-selected', String(key === tab)); button.tabIndex = key === tab ? 0 : -1; }
    fishPane.hidden = tab !== 'fish'; gardenPane.hidden = tab !== 'garden'; body.hidden = tab !== 'shells';
    if (tab === 'fish' && !fishPage) fishPage = V3.fishGuide.mount(fishPane);
    render();
  }

  // Ordinary finds prefer their listed weather. Weather-bound treasures require it.
  const MISSING_DESC = '还没找到。常去沙滩上走走，浪会把它冲上来的。';
  function missingDescription(k) {
    const labels = new Map(V3.scene?.WEATHERS || []);
    const preferred = [...new Set(Array.isArray(k.weather) ? k.weather : [])]
      .filter(wx => wx !== 'real' && labels.has(wx)).map(wx => wx === 'clear' ? '晴天' : labels.get(wx));
    if (k.rarity === 'ultra') return preferred.length ? `还没找到。只在${preferred.join('、')}时，潮水才会把它送上岸。` : '还没找到。不论什么天气，都可能随潮水上岸。';
    return preferred.length ? `${MISSING_DESC} 等到${preferred.join('或')}的时候，说不定海浪就会把它带上岸……` : MISSING_DESC;
  }

  // Read-only reference. A missed species keeps its silhouette; opening a known species does not
  // render all seven thumbnails until the player expands the comparison.
  function patternGuide(k) {
    const patterns = R()?.PATTERNS;
    if (!patterns?.length) return null;
    const grid = U.el('div', { class: 'col-samples' });
    const panel = U.el('details', { class: 'col-guide' },
      U.el('summary', {}, '花纹对照 · ' + patterns.length + ' 种'),
      U.el('p', {}, '同一种藏品可能出现的外观。百分比是该物种上岸后出现这款花纹的概率。'), grid);
    panel.addEventListener('toggle', () => {
      if (!panel.open || grid.childElementCount) return;
      const total = patterns.reduce((n, p) => n + p.w, 0);
      for (const p of patterns) {
        const sample = U.el('figure', { class: 'col-sample', 'data-pat': p.id },
          pic(k, false, 'col-swatch', 76, p.id),
          U.el('figcaption', {}, U.el('b', {}, p.name), U.el('small', {}, (100*p.w/total) + '%')));
        grid.append(sample);
      }
    });
    return panel;
  }


  // ---- 详情：已找到的放小转台，没找到的放大剪影；下面列出每一枚 ----
  function openDetail(id, uid) {
    closeDetail();
    const k = kinds().find((x) => x.id === id); if (!k || !main) return;
    const f = got(id), rar = H.rarity(k.rarity), its = itemsOf(id);
    const view = U.el('div', { class: 'col-view' }), meta = U.el('div', { class: 'col-meta' }), list = U.el('div', { class: 'col-items' });
    const chip = U.el('span', { class: 'col-chip' }, rar.label);
    tint(view, rar.color); chip.style.setProperty('--c', rar.color);
    const el = U.el('div', { class: 'col-detail ' + k.rarity + (f ? ' got' : ' miss') },
      U.el('button', { class: 'col-back', type: 'button', onclick: closeDetail }, '‹ 返回'),
      U.el('div', { class: 'col-dbody' }, view,
        U.el('div', { class: 'col-info' }, chip,
          U.el('h3', { class: 'col-title' }, f ? k.name : '？？？'),
          U.el('p', { class: 'col-desc' }, f ? k.desc : missingDescription(k)),
          meta)),
      f ? patternGuide(k) : null, list);
    tint(list, rar.color);
    const pick = its.find((it) => it.uid === uid) || biggest(its);
    detail = { id, el, meta, list, k, known: !!f, sel: pick ? pick.uid : null, sort: detail && detail.id === id ? detail.sort : 'size' };
    fillMeta(); fillList();
    main.append(el);
    if (f && its.length) stage = turntable(view, k, pick && pick.pat);
    else view.append(pic(k, !f, 'col-big', BIG));
  }
  const biggest = (its) => its.reduce((a, b) => (!a || b.size > a.size ? b : a), null);
  function selected() { return detail ? itemsOf(detail.id).find((it) => it.uid === detail.sel) || null : null; }
  function select(uid) {
    if (!detail || detail.sel === uid) return;
    detail.sel = uid;
    const it = selected();
    if (stage && stage.setPat) stage.setPat(it ? it.pat : 'plain');
    fillMeta(); fillList();
  }
  // 尺寸条：本种的区间，两端 5% 是王冠区（金色），竖线标出这一枚
  function sizeBar(k, it) {
    const r = R() && R().sizeRange(k), t = r && R().sizeT(k, it.size);
    if (!r || t == null) return null;
    const crownW = (R().CROWN * 100) + '%';
    const mark = U.el('i', { class: 'col-sizebar-mark' }); mark.style.left = (t * 100).toFixed(1) + '%';
    const lo = U.el('i', { class: 'col-sizebar-crown lo' }), hi = U.el('i', { class: 'col-sizebar-crown hi' });
    lo.style.width = hi.style.width = crownW;
    return U.el('div', { class: 'col-sizebar', title: `这一种的尺寸在 ${mm(r[0])} – ${mm(r[1])} 之间` },
      U.el('div', { class: 'col-sizebar-track' }, lo, hi, mark),
      U.el('div', { class: 'col-sizebar-ends' }, U.el('span', null, mm(r[0])), U.el('span', null, mm(r[1]))));
  }
  function fillMeta() {
    if (!detail) return;
    const f = got(detail.id), k = detail.k; detail.meta.textContent = '';
    if (!f) return;
    const it = selected(), its = itemsOf(detail.id);
    if (it) {
      const c = crownOf(k, it), pat = R() ? R().pattern(it.pat) : { name: '原色' };
      detail.meta.append(...[   // 原生 append 会把 null 写成文字：sizeBar 认不出种类时是 null
        U.el('div', { class: 'col-size' }, U.el('b', null, '这一枚'), U.el('span', { class: 'col-size-num' }, mm(it.size)), c ? crownEl(c, 'lg') : null),
        sizeBar(k, it),
        U.el('div', null, U.el('b', null, '花纹'), pat.name, pat.rare ? U.el('span', { class: 'col-rare' }, '稀有花纹') : null),
        U.el('div', null, U.el('b', null, '捡到'), when(it.at))].filter(Boolean));
    }
    detail.meta.append(
      U.el('div', null, U.el('b', null, '第一次找到'), when(f.first)),
      U.el('div', null, U.el('b', null, '现在有'), f.n + ' 个'));
    if (its.length) detail.meta.append(U.el('span', { class: 'col-hint' }, '按住拖一拖，可以转着看'));
    else detail.meta.append(U.el('span', { class: 'col-hint' }, '这一种现在一个都没有了，再去沙滩上找找吧。'));
    const decor = V3.shellControls;
    if (decor && V3.game.hosted && it) {
      const controls = decor.detail(detail.id, it.uid);
      if (controls) detail.meta.append(U.el('div', null, U.el('b', null, '柜中可用'), decor.available(detail.id) + ' 个'), controls);
    }
  }
  // 「我的 N 枚」：排序（尺寸 / 时间）、最大最小纪录、每一枚一行
  function fillList() {
    if (!detail) return;
    const k = detail.k, list = detail.list, its = itemsOf(detail.id).slice();
    list.textContent = '';
    if (!its.length) return;
    const where = whereMap();
    if (detail.sort === 'size') its.sort((a, b) => b.size - a.size || b.at - a.at); else its.sort((a, b) => b.at - a.at);
    const big = biggest(its), small = its.reduce((a, b) => (!a || b.size < a.size ? b : a), null);
    const sortBtn = (s, text) => U.el('button', { type: 'button', class: 'col-sort' + (detail.sort === s ? ' on' : ''),
      onclick: () => { detail.sort = s; fillList(); } }, text);
    list.append(U.el('div', { class: 'col-items-h' },
      U.el('span', { class: 'col-items-title' }, `我的 ${its.length} 枚`),
      U.el('span', { class: 'col-items-rec' }, `最大 ${mm(big.size)} · 最小 ${mm(small.size)}`),
      U.el('span', { class: 'col-sorts' }, sortBtn('size', '按尺寸'), sortBtn('time', '按时间'))));
    const rows = U.el('div', { class: 'col-rows', role: 'listbox', 'aria-label': '我的' + k.name });
    for (const it of its) {
      const c = crownOf(k, it), pat = R() ? R().pattern(it.pat) : { name: '原色' }, w = where.get(it.uid);
      const row = U.el('button', { type: 'button', role: 'option', 'aria-selected': String(it.uid === detail.sel),
        class: 'col-row' + (it.uid === detail.sel ? ' sel' : '') + (pat.rare ? ' rare-pat' : ''), onclick: () => select(it.uid) },
        pic(k, false, 'col-row-pic', ROW, it.pat),
        U.el('span', { class: 'col-row-size' }, mm(it.size)),
        U.el('span', { class: 'col-row-pat' }, pat.name),
        U.el('span', { class: 'col-row-crown' }, c ? crownEl(c) : null),
        U.el('span', { class: 'col-row-where' }, w ? w.text : ''),
        U.el('span', { class: 'col-row-day' }, day(it.at)));
      row.dataset.uid = it.uid;
      rows.append(row);
    }
    list.append(rows);
  }
  function closeDetail() {
    if (stage) { try { stage.dispose(); } catch (e) { V3.err('collection turntable dispose: ' + e.message); } stage = null; }
    if (detail) { detail.el.remove(); detail = null; }
  }
  // ---- 小转台：自己的 256×256 WebGLRenderer。几何和材质每种只借一次（V3.shells.build 的产物标 noPick、整组隐藏，
  //      不会被点到），开详情时复制一份给这个渲染器用，关掉时连复制品一起 dispose，主渲染器不受影响。
  //      setPat(pat)：换成那一枚的花纹（复制品换掉、旧的 dispose）----
  const donors = {};
  function donor(id) {
    if (donors[id]) return donors[id];
    const g = V3.shells.build(id); let src = null;
    g.traverse((o) => { o.userData.noPick = true; if (o.isMesh && !src) src = o; });
    g.visible = false;
    return src ? (donors[id] = { geo: src.geometry, mats: [].concat(src.material) }) : null;
  }
  const patGeo = (d, pat) => (V3.shellVariants ? V3.shellVariants.geo(d.geo, pat) : d.geo).clone();
  function turntable(view, k, pat) {
    const still = () => { view.append(pic(k, false, 'col-big', BIG, pat)); return null; };
    let d = null, r = null;
    try { d = V3.shells && V3.shells.has(k.id) ? donor(k.id) : null; } catch (e) { V3.err('collection donor ' + k.id + ': ' + e.message); }
    if (!d) return still();
    try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); } catch (e) { return still(); }
    const M = V3.R && V3.R.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(256, 256, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = M ? M.toneMapping : THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = M ? M.toneMappingExposure : 1;
    r.setClearColor(0x000000, 0);
    const cv = r.domElement; cv.className = 'col-tt';
    view.append(cv);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6f8fb5, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(1.2, 2, 1.6); scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfe8ff, 0.5); fill.position.set(-1.5, 0.6, -1); scene.add(fill);
    let geo = patGeo(d, pat);
    const mats = d.mats.map((m) => m.clone());
    const mesh = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const rad = geo.boundingSphere.radius, top = geo.boundingBox.max.y;
    const pg = new THREE.CylinderGeometry(rad * 0.95, rad, rad * 0.08, 48);
    const pm = new THREE.MeshStandardMaterial({ color: new THREE.Color(H.rarity(k.rarity).color), roughness: 0.6 });
    const plate = new THREE.Mesh(pg, pm); plate.position.y = -rad * 0.04;
    const spin = new THREE.Group(); spin.add(mesh, plate); scene.add(spin);
    const cy = top * 0.45, dist = (rad * 1.18) / Math.sin(THREE.MathUtils.degToRad(15)), el = 0.72;   // 稍微俯视，扁的贝壳也看得到正面
    const cam = new THREE.PerspectiveCamera(30, 1, rad * 0.05, rad * 40);
    cam.position.set(0, cy + dist * Math.sin(el), dist * Math.cos(el)); cam.lookAt(0, cy, 0);
    let ang = -0.6, vel = 0, drag = null, raf = 0, last = performance.now();
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, a: ang }; vel = 0; try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 没关系 */ } });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; const a = drag.a + (e.clientX - drag.x) * 0.012; vel = a - ang; ang = a; });
    const up = () => { drag = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    const draw = () => { spin.rotation.y = ang; r.render(scene, cam); };
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!drag) { vel *= 0.94; ang += vel + dt * 0.7; }
      draw(); raf = requestAnimationFrame(tick);
    };
    draw(); raf = requestAnimationFrame(tick);
    return {
      renderer: r,
      pat: pat || 'plain',
      setPat(p) {
        p = p || 'plain';
        if (p === this.pat) return;
        const g2 = patGeo(d, p);
        mesh.geometry = g2; geo.dispose(); geo = g2; this.pat = p;
      },
      dispose() {
        cancelAnimationFrame(raf);
        geo.dispose(); for (const m of mats) m.dispose(); pg.dispose(); pm.dispose();
        r.dispose(); r.forceContextLoss(); cv.remove();
      },
    };
  }

  C.open = (next = 'shells') => {
    if (V3.shore?.panel?.dataset.subject === 'windowGarden') V3.shore.close();
    preload();
    if (!card) build();
    if (!H.modalOpen('collection')) {
      H.modal(card, { name: 'collection', onClose: () => { closeDetail(); fishPage?.dispose(); fishPage = null; }, onEsc: () => {
        if (tab === 'fish') return fishPage?.back() || false;
        if (!detail) return false; closeDetail(); return true;
      } });
    }
    selectTab(next);
    return card;
  };
  C.close = () => H.closeModal('collection');
  C.isOpen = () => H.modalOpen('collection');
  C.openDetail = (id, uid) => { C.open(); openDetail(id, uid); };
  C.detail = () => (detail ? detail.id : null);
  C.selected = () => (detail ? detail.sel : null);
  C.select = (uid) => select(uid);
  C.stage = () => stage;
  // 收藏变了：详情里的列表 / 当前这一枚跟着刷新（这一枚被卖掉了就换成最大的那枚）
  function refreshDetail() {
    if (!detail) return;
    const its = itemsOf(detail.id);
    if (detail.known !== !!got(detail.id) || (!stage && its.length) || (stage && !its.length)) return openDetail(detail.id, detail.sel);
    if (!its.some((it) => it.uid === detail.sel)) { const b = biggest(its); detail.sel = b ? b.uid : null; if (stage && stage.setPat) stage.setPat(b ? b.pat : 'plain'); }
    fillMeta(); fillList();
  }
  V3.on('game:open', (what) => { if (what === 'collection' && H.mounted) C.open(); });
  V3.on('inventory:status', () => { if (C.isOpen() && tab !== 'shells') render(); });
  V3.on('game:collect', (e) => {
    const id = e && e.item ? e.item.kind : null; if (!id) return;
    flashId = id;
    if (!C.isOpen()) return;
    render();
    if (detail && detail.id === id) { if (e.first) openDetail(id, e.instance && e.instance.uid); else refreshDetail(); }
  });
  V3.on('game:inventory', () => {
    if (!C.isOpen()) return;
    render();
    refreshDetail();
  });
  V3.on('game:reset', () => {
    if (!C.isOpen()) return;
    if (detail && !got(detail.id)) closeDetail(); else refreshDetail();
    render();
  });
})(window.V3);
