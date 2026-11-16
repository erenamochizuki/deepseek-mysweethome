// 72-fb-ui.js — UI shell: toasts, top bar, breadcrumb, reference panel, help, image zoom.
(function (V3) {
  'use strict';
  const U = V3.util, fb = V3.fb;

  // ---- toasts ----
  let toasts = null;
  fb.toast = (msg, kind = '', ms = 2600) => {
    if (!fb.enabled) return null;
    if (!toasts) toasts = fb.root().appendChild(U.el('div', { class: 'fb-toasts' }));
    const t = toasts.appendChild(U.el('div', { class: 'fb-toast ' + kind }, msg));
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 350); }, ms);
    return t;
  };

  // ---- widget helpers (shared by 73-78) ----
  fb.btn = (label, title, fn, cls = '') => U.el('button', { class: 'fb-btn ' + cls, type: 'button', title, onclick: fn }, label);
  fb.selectEl = (opts, value, fn, title) => {
    const s = U.el('select', { class: 'fb-sel', title, onchange: () => fn(s.value) }, opts.map(([id, l]) => U.el('option', { value: id }, l)));
    s.value = value == null ? '' : String(value);
    return s;
  };
  const VIEW_LABEL = { front: '正面', side: '侧面', back: '背面', q34: '3/4', face: '脸部', top: '俯视', low: '仰视', hero: '主视角', isle: '小岛', house: '小屋', site: '全景', reef: '水下', inside: '一楼室内', loft: '阁楼', sun: '看太阳', moon: '看月亮' };
  const setOn = (b, on) => { if (b) b.classList.toggle('on', !!on); };

  // ---- top bar ----
  const bar = fb.bar = {};
  const buildBar = () => {
    const S = V3.stage, cur = fb.inst();
    bar.model = fb.selectEl(V3.models.list().map(m => [m.id, m.label]), cur && cur.id,
      id => { try { V3.models.show(id); } catch (e) { fb.toast(String((e && e.message) || e), 'err'); } }, '模型');
    bar.states = U.el('div', { class: 'fb-grp' });
    bar.light = S ? fb.selectEl(S.presets.map(p => [p.id, p.label]), S.preset, id => S.setPreset(id), '灯光') : null;
    bar.views = U.el('div', { class: 'fb-grp' });
    bar.spin = fb.btn('转台', '模型自动旋转', () => setOn(bar.spin, S && S.turntable()));
    bar.wire = fb.btn('线框', '线框显示', () => fb.setWire(!fb.wire));
    bar.ref = fb.btn('参考图', '显示/隐藏参考图', () => fb.toggleRef());
    bar.pause = fb.btn('暂停', '暂停动画（空格）', () => fb.setPause(!fb.paused()));
    bar.hl = fb.btn('高亮', '选中部位的高亮色（关掉可看原色）', () => fb.setHL(!fb.hl), fb.hl ? 'on' : '');
    bar.status = U.el('span', { class: 'fb-chip', title: '反馈保存位置' }, '检测中…');
    bar.io = U.el('div', { class: 'fb-grp' });
    bar.el = U.el('div', { class: 'fb-bar fb-panel' },
      U.el('span', { class: 'fb-title' }, '反馈'),
      U.el('div', { class: 'fb-grp' }, U.el('label', null, '模型'), bar.model),
      bar.states,
      bar.light && U.el('div', { class: 'fb-grp' }, U.el('label', null, '灯光'), bar.light),
      U.el('span', { class: 'fb-sep' }), bar.views, U.el('span', { class: 'fb-sep' }),
      U.el('div', { class: 'fb-grp' }, bar.spin, bar.wire, bar.ref, bar.pause, bar.hl),
      U.el('span', { class: 'fb-grow' }),
      bar.status, bar.io, fb.btn('?', '快捷键说明（?）', () => fb.help(), 'sm'));
    fb.root().append(bar.el);
  };
  const fillModel = (inst) => {
    if (!bar.el) return;
    bar.model.value = inst ? inst.id : '';
    bar.states.replaceChildren();
    for (const k in (inst && inst.states) || {}) {
      const st = inst.states[k];
      const s = fb.selectEl(st.options || [], st.value, v => V3.setState(k, v), st.label || k);
      s.dataset.k = k;
      bar.states.append(U.el('label', null, st.label || k), s);
    }
    bar.views.replaceChildren(...Object.keys((inst && inst.views) || {})
      .map((n, i) => fb.btn(VIEW_LABEL[n] || n, `视角：${VIEW_LABEL[n] || n}${i < 9 ? `（${i + 1}）` : ''}`, () => fb.view(n), 'sm')));
  };
  const syncState = () => {
    const inst = fb.inst();
    if (!bar.el || !inst || !inst.states) return;
    for (const s of bar.states.querySelectorAll('select')) { const st = inst.states[s.dataset.k]; if (st) s.value = String(st.value); }
  };
  fb.setStatus = (text, cls, title) => {
    if (!bar.status) return;
    bar.status.textContent = text; bar.status.className = 'fb-chip ' + (cls || '');
    if (title) bar.status.title = title;
  };
  V3.on('init', () => { if (fb.enabled) { buildBar(); fillModel(fb.inst()); } });
  V3.on('model', fillModel);
  V3.on('state', syncState);
  V3.on('stage', id => { if (bar.light) bar.light.value = id; });
  V3.on('fb-wire', on => setOn(bar.wire, on));
  V3.on('fb-hl', on => setOn(bar.hl, on));
  V3.on('fb-pause', on => { setOn(bar.pause, on); if (bar.pause) bar.pause.textContent = on ? '继续' : '暂停'; });
  fb.syncSpin = () => setOn(bar.spin, V3.stage && V3.stage.spin);
  // ---- breadcrumb (bottom): click an ancestor = coarser, dim tail = finer (from the last click) ----
  let crumb = null;
  const touch = matchMedia('(hover: none)').matches;
  const drawCrumb = () => {
    if (!crumb) return;
    const s = fb.sel, kids = [];
    if (!s) kids.push(U.el('span', { class: 'hint' }, touch ? '点按模型上的任意部位来选中 · 单指旋转 · 双指缩放/平移'
      : '点击模型上的任意部位来选中它 · 左键拖动旋转 · 右键平移 · 滚轮缩放 · ? 快捷键'));
    else {
      const leaf = fb.leaf && fb.under(fb.leaf, s) ? fb.leaf : s, segs = leaf.split('/'), n = s.split('/').length;
      segs.forEach((name, i) => {
        const p = segs.slice(0, i + 1).join('/');
        if (i) kids.push(U.el('span', { class: 'gt' }, '›'));
        kids.push(U.el('span', {
          class: 'seg' + (i === n - 1 ? ' cur' : i >= n ? ' deep' : ''), title: p,
          onclick: () => fb.select(p, { src: 'crumb' }),
          onpointerenter: () => fb.setHover(p), onpointerleave: () => fb.setHover(null),
        }, fb.label(p) || name));
      });
      const hid = fb.visState(s) === 1;
      kids.push(U.el('span', { class: 'fb-grp' },
        fb.btn('写反馈', '给选中的部位写反馈', () => fb.compose && fb.compose(), 'sm pri'),
        fb.btn('聚焦', '镜头对准这里（F / 双击）', () => fb.focus(s), 'sm'),
        fb.btn(hid ? '显示' : '隐藏', '隐藏 / 显示（H）', () => fb.toggleHidden(s), 'sm'),
        fb.btn(fb.iso === s ? '退出只看' : '只看这个', '只看这个部位（I）', () => fb.isolate(fb.iso === s ? null : s), 'sm')));
    }
    if (fb.hiddenAny()) kids.push(fb.btn('全部显示', '把隐藏的部位都显示出来（Shift+H）', () => fb.showAll(), 'sm warn'));
    crumb.replaceChildren(...kids);
  };

  // ---- reference image panel: drag by the header, resize by the corner grip; remembered ----
  const REFS = ['concept-girl.png', 'whale-girl-sheet.png', 'girl-turnaround-v1.png'];
  const refURL = f => (location.protocol === 'file:' ? '../refs/' : '/refs/') + encodeURIComponent(f);
  const LS = 'v3.fb.ref', cfg = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) { /* full */ } };
  let ref = null, listed = false;
  const dragOn = (h, onMove) => h.addEventListener('pointerdown', e => {
    if (e.button || e.target.closest('select,button')) return;
    e.preventDefault(); h.setPointerCapture(e.pointerId);
    const r = ref.el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    const mv = ev => onMove(r, ev.clientX - x0, ev.clientY - y0);
    const end = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', end); h.removeEventListener('pointercancel', end); save(); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
  });
  const place = () => {
    const s = ref.el.style, w = Math.min(cfg.w || 300, innerWidth - 16), h = Math.min(cfg.h || 360, innerHeight - 16);
    if (cfg.w) { s.width = w + 'px'; s.height = h + 'px'; }
    if (cfg.x != null) { s.left = U.clamp(cfg.x, 0, innerWidth - 80) + 'px'; s.top = U.clamp(cfg.y, 0, innerHeight - 40) + 'px'; }
  };
  const setRef = (f) => {
    cfg.file = f; save();
    ref.sel.value = f; ref.img.src = refURL(f); ref.img.title = f;
  };
  const buildRef = () => {
    const img = U.el('img', { alt: '参考图', draggable: 'false', ondblclick: () => fb.zoom(img.src) });
    img.onerror = () => fb.toast('参考图加载失败：' + (cfg.file || ''), 'err');
    const sel = fb.selectEl(REFS.map(f => [f, f.replace(/\.\w+$/, '')]), '', f => setRef(f), '选择参考图');
    const head = U.el('div', { class: 'fb-head' }, U.el('b', null, '参考图'), sel, fb.btn('×', '关闭', () => fb.toggleRef(false), 'sm ghost'));
    const grip = U.el('div', { class: 'fb-ref-grip', title: '拖动调整大小' });
    ref = { el: U.el('div', { class: 'fb-ref fb-panel hide' }, head, U.el('div', { class: 'fb-ref-body' }, img), grip), img, sel };
    dragOn(head, (r, dx, dy) => { cfg.x = r.left + dx; cfg.y = r.top + dy; place(); });
    dragOn(grip, (r, dx, dy) => { cfg.w = Math.max(160, r.width + dx); cfg.h = Math.max(120, r.height + dy); place(); });
    fb.root().append(ref.el);
    place();
    setRef(cfg.file || REFS[0]);
  };
  const listRefs = () => {
    if (listed || location.protocol === 'file:') return;
    listed = true;
    fetch('/api/refs').then(r => (r.ok ? r.json() : null)).then(j => {
      const files = j && Array.isArray(j.files) ? j.files.filter(f => /\.(png|jpe?g|webp)$/i.test(f)) : [];
      if (!files.length) return;
      ref.sel.replaceChildren(...files.map(f => U.el('option', { value: f }, f.replace(/\.\w+$/, ''))));
      ref.sel.value = files.includes(cfg.file) ? cfg.file : (files.includes(REFS[0]) ? REFS[0] : files[0]);
      if (ref.sel.value !== cfg.file) setRef(ref.sel.value);
    }).catch(() => {});
  };
  fb.toggleRef = (on) => {
    if (!ref) buildRef();
    on = on == null ? ref.el.classList.contains('hide') : !!on;
    ref.el.classList.toggle('hide', !on);
    cfg.open = on; save();
    if (on) listRefs();
    setOn(bar.ref, on);
    return on;
  };
  // ---- help overlay ----
  const KEYS = [
    ['点击', '选中部位（再点更细的地方 = 选更细的部位）'], ['左键拖动', '旋转镜头'], ['右键 / Shift+拖动', '平移'],
    ['滚轮', '缩放'], ['双击 / F', '镜头对准选中的部位'], ['[  ]', '上一级 / 下一级部位'], ['H', '隐藏 / 显示选中的部位'],
    ['I', '只看这个（再按一次退出）'], ['Shift+H', '全部显示'], ['1 – 5', '正面 / 侧面 / 背面 / 3/4 / 脸部'],
    ['空格', '暂停 / 继续动画'], ['Ctrl+Enter', '提交反馈'], ['Esc', '关闭弹窗 / 取消选中'],
  ];
  let help = null;
  fb.help = (on) => {
    if (!help) {
      help = U.el('div', { class: 'fb-help fb-panel', style: { display: 'none' } },
        U.el('div', { class: 'fb-head' }, U.el('b', null, '操作说明'), fb.btn('×', '关闭（Esc）', () => fb.help(false), 'sm ghost')),
        U.el('table', null, KEYS.map(([k, t]) => U.el('tr', null, U.el('td', null, U.el('kbd', null, k)), U.el('td', null, t)))));
      fb.root().append(help);
    }
    on = on == null ? help.style.display === 'none' : !!on;
    help.style.display = on ? '' : 'none';
    return on;
  };

  // ---- full-size image viewer ----
  let zoomEl = null;
  fb.zoom = (src) => {
    if (!zoomEl) { zoomEl = U.el('div', { class: 'fb-zoom', style: { display: 'none' }, onclick: () => fb.zoom(null) }, U.el('img', { alt: '' })); fb.root().append(zoomEl); }
    if (src) zoomEl.firstChild.src = src;
    zoomEl.style.display = src ? '' : 'none';
  };
  const shown = e => !!e && e.style.display !== 'none';
  fb.onEsc(() => { if (!shown(zoomEl)) return false; fb.zoom(null); return true; }, 30);
  fb.onEsc(() => { if (!shown(help)) return false; fb.help(false); return true; }, 20);

  // 顶栏在窄一点的页面（如 cabin）会折成两行，底部路径条也会变高：
  // 把它们实际占的高度写进 --fb-top / --fb-bot，侧栏、编辑框和 HUD 按钮都跟着让开
  const fit = () => {
    const st = document.documentElement.style;
    const b = bar.el && bar.el.getBoundingClientRect(), c = crumb && crumb.getBoundingClientRect();
    if (b && b.height) st.setProperty('--fb-top', Math.round(b.bottom + 8) + 'px');
    if (c && c.height) st.setProperty('--fb-bot', Math.round(innerHeight - c.top + 8) + 'px');
  };
  fb.fitPanels = fit;
  // ---- boot ----
  V3.on('init', () => {
    if (!fb.enabled) return;
    crumb = fb.root().appendChild(U.el('div', { class: 'fb-crumb fb-panel' }));
    drawCrumb();
    if (cfg.open) fb.toggleRef(true);
    if (window.ResizeObserver) { const ro = new ResizeObserver(fit); if (bar.el) ro.observe(bar.el); ro.observe(crumb); }
    fit();
  });
  V3.on('fb-select', drawCrumb);
  V3.on('fb-vis', drawCrumb);
  V3.on('model', drawCrumb);
  addEventListener('resize', () => { if (ref) place(); fit(); });
})(window.V3);
