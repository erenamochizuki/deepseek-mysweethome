// 73-fb-compose.js — feedback composer next to the selection: category chips, severity, text, submit.
(function (V3) {
  'use strict';
  const U = V3.util, fb = V3.fb;
  const CATS = ['形状', '颜色', '比例', '位置', '动作', '材质', '缺失', '其他'];
  const SEV = [[1, '小'], [2, '中'], [3, '大']];
  const touch = matchMedia('(hover: none)').matches;
  fb.CATS = CATS;
  fb.draft = { cat: null, sev: 2, text: '' };          // survives close / Esc / retarget; cleared on submit
  const C = fb.comp = { el: null, open: false, target: null, moved: false, busy: false, autoPaused: false };

  const paint = () => {
    if (!C.el) return;
    for (const b of C.chips.children) b.classList.toggle('on', b.dataset.c === fb.draft.cat);
    for (const b of C.sev.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === fb.draft.sev);
    if (C.ta.value !== fb.draft.text) C.ta.value = fb.draft.text;
    C.send.disabled = C.busy;
    C.send.textContent = C.busy ? '保存中…' : '提交';
  };
  const build = () => {
    const title = U.el('b');
    const pathEl = U.el('div', { class: 'fb-comp-path' });
    const chips = U.el('div', { class: 'fb-chips' }, CATS.map(c => U.el('button', {
      class: 'fb-cat', type: 'button', 'data-c': c,
      onclick: () => { fb.draft.cat = fb.draft.cat === c ? null : c; paint(); },
    }, c)));
    const sev = U.el('div', { class: 'fb-sev' }, U.el('span', { class: 'fb-dim' }, '程度'), SEV.map(([v, l]) => U.el('button', {
      class: 'fb-btn sm', type: 'button', 'data-v': v, onclick: () => { fb.draft.sev = v; paint(); },
    }, l)));
    const ta = U.el('textarea', { class: 'fb-ta', rows: 3, placeholder: '哪里不对？想要什么样？\n例：刘海太厚挡住眼睛了，想要碎一点、短一点',
      oninput: () => { fb.draft.text = ta.value; } });
    const send = fb.btn('提交', '提交（Ctrl+Enter）', () => submit(), 'pri');
    const head = U.el('div', { class: 'fb-comp-h' }, U.el('span', { class: 'fb-dim' }, '反馈'), title,
      fb.btn('上一级', '改选上一级部位（[）', () => { const p = fb.parentOf(C.target); if (p) fb.select(p, { src: 'crumb' }); }, 'sm ghost'),
      fb.btn('×', '关闭（Esc，草稿会保留）', () => fb.closeCompose(), 'sm ghost'));
    const foot = U.el('div', { class: 'fb-comp-f' }, U.el('span', { class: 'fb-dim' }, touch ? '' : 'Ctrl+Enter 提交 · Esc 关闭'),
      fb.btn('取消', '关闭（草稿会保留）', () => fb.closeCompose(), 'ghost'), send);
    C.el = U.el('div', { class: 'fb-comp fb-panel', style: { display: 'none' } }, head, pathEl, chips, sev, ta, foot);
    Object.assign(C, { title, pathEl, chips, sev, ta, send });
    C.el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); fb.closeCompose(); }
    });
    // drag by the header
    head.addEventListener('pointerdown', e => {
      if (e.button || e.target.closest('button')) return;
      e.preventDefault(); head.setPointerCapture(e.pointerId);
      const r = C.el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      const mv = ev => {
        C.moved = true;
        C.el.style.left = U.clamp(r.left + ev.clientX - x0, 0, innerWidth - 60) + 'px';
        C.el.style.top = U.clamp(r.top + ev.clientY - y0, 0, innerHeight - 30) + 'px';
      };
      const end = () => { for (const [k, f] of [['pointermove', mv], ['pointerup', end], ['pointercancel', end]]) head.removeEventListener(k, f); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
    });
    fb.root().append(C.el);
  };
  // Ctrl+Enter submits from anywhere while the composer is open
  addEventListener('keydown', e => {
    if (C.open && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.defaultPrevented) { e.preventDefault(); submit(); }
  });
  const place = (cx, cy) => {
    const el = C.el, w = el.offsetWidth || 300, h = el.offsetHeight || 260;
    if (innerWidth <= 760) { el.style.left = el.style.top = ''; return; }   // docked at the bottom by css
    let x = cx + 28, y = cy - 40;
    if (x + w > innerWidth - 8) x = cx - w - 28;
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fb-top')) || 56;   // below the (maybe 2-row) top bar
    el.style.left = U.clamp(x, 8, innerWidth - w - 8) + 'px';
    el.style.top = U.clamp(y, top, innerHeight - h - 8) + 'px';
  };

  // ---- open / close ----
  fb.compose = (path) => {
    path = path || fb.sel;
    if (!path || !fb.enabled) return;
    if (!C.el) build();
    const was = C.open;
    C.target = path; C.open = true;
    C.title.textContent = fb.label(path); C.title.title = path;
    C.pathEl.textContent = path;
    paint();
    C.el.style.display = '';
    if (!was || !C.moved) {
      const h = fb.hit && fb.under(fb.hit.path, path) ? fb.hit : null, s = fb.screenOf(h ? h.world : path);
      place(s ? s.x : innerWidth / 2, s ? s.y : innerHeight / 2);
    }
    if (!was) {
      if (!fb.paused()) { fb.setPause(true); C.autoPaused = true; }
      if (!touch) setTimeout(() => { if (C.open) C.ta.focus({ preventScroll: true }); }, 0);
    }
    V3.emit('fb-compose', true, path);
  };
  fb.closeCompose = (o = {}) => {
    if (!C.open) return false;
    C.open = false; C.moved = false; C.el.style.display = 'none';
    if (document.activeElement && C.el.contains(document.activeElement)) document.activeElement.blur();
    if (C.autoPaused) { C.autoPaused = false; if (!o.keepPause && fb.paused()) fb.setPause(false); }
    V3.emit('fb-compose', false, null);
    return true;
  };
  fb.onEsc(() => fb.closeCompose(), 10);
  V3.on('fb-select', (path, info) => {
    if (!path) { fb.closeCompose(); return; }
    if (info.src === 'list') { fb.closeCompose({ keepPause: true }); return; }
    if (C.open || info.src === 'pick' || info.src === 'tree') fb.compose(path);
  });
  // ---- item builder (SPEC item; extra: point.anchor/path, view, viewport) ----
  const r4 = a => a.map(v => +(+v).toFixed(4));
  const inScene = o => { for (; o; o = o.parent) if (o === V3.R.scene) return true; return false; };
  fb.captureState = () => {
    const R = V3.R, S = V3.stage, st = Object.assign({}, V3.getState());
    st.t = +(R.frozen != null ? R.frozen : R.t).toFixed(3);
    st.light = S ? S.preset : null;
    const inst = fb.inst(), ry = inst && inst.root ? inst.root.rotation.y : 0;
    if (Math.abs(ry) > 1e-4) st.rotY = +ry.toFixed(4);
    return st;
  };
  // view string reproducing camera + state (tools/shoot.mjs --views, ?view=)
  fb.viewString = (it) => {
    const c = it.camera, s = it.state || {}, enc = v => String(v).replace(/[+%&#\s]/g, encodeURIComponent);
    const toks = ['model=' + enc(it.model)];
    if (c) toks.push('cam=' + [...c.pos, ...c.target].map(v => +(+v).toFixed(3)).join('_'));
    for (const k in s) if (k !== 'light' && k !== 'rotY' && s[k] != null && s[k] !== '') toks.push(k + '=' + enc(s[k]));
    if (s.light) toks.push('light=' + enc(s.light));
    return toks.join('+');
  };
  fb.makeItem = (path, f = {}) => {
    const R = V3.R, inst = fb.inst(), h = fb.hit && fb.under(fb.hit.path, path) ? fb.hit : null;
    let point = null;
    if (h) {
      const w = h.obj && inScene(h.obj) ? r4(h.obj.localToWorld(new THREE.Vector3(...h.local)).toArray()) : h.world;
      point = { local: h.local, world: w, normal: h.normal, anchor: h.anchor, path: h.path };
    }
    const cam = R.getView();
    const it = {
      build: V3.BUILD, page: V3.PAGE, model: inst ? inst.id : null,
      part: path, partLabel: fb.label(path), point,
      camera: { pos: r4(cam.pos), target: r4(cam.target), fov: cam.fov },
      state: fb.captureState(),
      category: f.cat || '其他', severity: f.sev || 2, text: String(f.text || '').trim(),
      status: 'open', thread: [],
      viewport: [R.canvas.clientWidth, R.canvas.clientHeight],
    };
    it.view = fb.viewString(it);
    return it;
  };

  // ---- submit ----
  const shake = () => { C.el.classList.remove('fb-shake'); void C.el.offsetWidth; C.el.classList.add('fb-shake'); };
  const submit = fb.submit = async () => {
    if (!C.open || C.busy) return null;
    fb.draft.text = C.ta.value;
    if (!fb.draft.text.trim()) { shake(); fb.toast('先写一句哪里不对吧'); C.ta.focus(); return null; }
    if (!fb.store) { fb.toast('保存模块没有加载', 'err'); return null; }
    C.busy = true; paint();
    try {
      const it = fb.makeItem(C.target, fb.draft);
      const shotData = fb.shot ? fb.shot(it) : V3.R.snapshot();
      const saved = await fb.store.add(it, shotData);
      fb.draft = { cat: null, sev: 2, text: '' };
      C.busy = false;
      fb.closeCompose();
      fb.toast((fb.store.isLocal(saved.id) ? '已保存到本机（离线）：' : '已保存反馈：') + saved.partLabel, 'ok');
      V3.emit('fb-added', saved);
      return saved;
    } catch (e) {
      fb.toast('保存失败：' + ((e && e.message) || e), 'err', 5000);
      return null;
    } finally {
      C.busy = false; paint();
    }
  };
})(window.V3);
