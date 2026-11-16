// 78-fb-tree.js — left panel: collapsible part tree (hover = highlight, click = select, eye = hide), search, isolate.
(function (V3) {
  'use strict';
  const U = V3.util, fb = V3.fb;
  const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  const T = fb.tree = { el: null, open: new Set(), q: '', rows: new Map(), counts: new Map(), sig: '' };
  let body = null, countEl = null, colBtn = null, isoBtn = null, allBtn = null, search = null, vis = null;
  const isTodo = s => s === 'open' || s === 'doing' || s === 'reopen';

  // feedback counts per path (an item counts for its part and every ancestor)
  const recount = () => {
    const m = new Map(), inst = fb.inst(), mid = inst && inst.id;
    for (const it of (fb.store && fb.store.items) || []) {
      if (!it.part || (it.model && it.model !== mid)) continue;
      for (let p = it.part; p; p = fb.parentOf(p)) {
        const c = m.get(p) || { n: 0, todo: 0 }; c.n++; if (isTodo(it.status)) c.todo++; m.set(p, c);
      }
    }
    T.counts = m;
    return [...m].map(([p, c]) => `${p}:${c.n}/${c.todo}`).join('|');
  };
  const match = (n, q) => String(n.label || '').toLowerCase().includes(q) || String(n.name || '').toLowerCase().includes(q);

  const row = (n, depth) => {
    const kids = n.children.length, open = !!T.q || T.open.has(n.path), c = T.counts.get(n.path);
    const tw = U.el('span', { class: 'fb-tw' }, kids ? (open ? '▾' : '▸') : '');
    const eye = U.el('span', { class: 'fb-eye', title: '隐藏 / 显示（H）' });
    const r = U.el('div', { class: 'fb-tree-row', 'data-path': n.path, title: n.path, style: { paddingLeft: (4 + depth * 14) + 'px' } },
      tw, U.el('span', { class: 'fb-tl' }, n.label || n.name),
      c ? U.el('span', { class: 'fb-tc' + (c.todo ? '' : ' done'), title: c.todo ? `${c.todo} 条待处理` : `${c.n} 条反馈（都处理过了）` }, String(c.todo || c.n)) : null,
      eye);
    r.eye = eye;
    tw.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!kids || T.q) return;
      if (open) T.open.delete(n.path); else T.open.add(n.path);
      render();
    });
    eye.addEventListener('click', (e) => { e.stopPropagation(); fb.toggleHidden(n.path); });
    r.addEventListener('click', () => fb.select(n.path, { src: 'tree' }));
    r.addEventListener('dblclick', () => fb.focus(n.path));
    r.addEventListener('pointerenter', () => fb.setHover(n.path));
    r.addEventListener('pointerleave', () => fb.setHover(null));
    return r;
  };

  const render = () => {
    if (!body) return;
    T.sig = recount(); T.rows.clear(); vis = null;
    const root = fb.node(''), q = T.q.trim().toLowerCase(), frag = document.createDocumentFragment();
    let keep = null;
    if (q && root) {   // matches + their ancestors
      keep = new Set();
      const walk = (n) => { let hit = match(n, q); for (const k of n.children) if (walk(k)) hit = true; if (hit) keep.add(n.path); return hit; };
      root.children.forEach(walk);
    }
    const add = (n, d) => {
      if (keep && !keep.has(n.path)) return;
      const r = row(n, d); T.rows.set(n.path, r); frag.append(r);
      if (n.children.length && (keep || T.open.has(n.path))) n.children.forEach(k => add(k, d + 1));
    };
    if (root) root.children.forEach(k => add(k, 0));
    if (!T.rows.size) frag.append(U.el('div', { class: 'fb-empty' }, root && root.children.length ? '没有找到这个部位' : '还没有部位'));
    body.replaceChildren(frag);
    countEl.textContent = root ? `${V3.parts.list().length} 个` : '';
    paint();
  };
  const paint = () => {
    if (!body) return;
    if (!vis) { vis = new Map(); for (const p of T.rows.keys()) vis.set(p, fb.visState(p)); }
    for (const [p, r] of T.rows) {
      const vs = vis.get(p) || 0;
      r.classList.toggle('sel', p === fb.sel);
      r.classList.toggle('hv', p === fb.hover);
      r.classList.toggle('hid', vs === 1);
      r.classList.toggle('part', vs === 2);
      const want = vs === 1 ? 'off' : 'on';
      if (r.eye.dataset.s !== want) { r.eye.dataset.s = want; r.eye.innerHTML = vs === 1 ? EYE_OFF : EYE; }
    }
    isoBtn.textContent = fb.iso ? '退出只看' : '只看这个';
    isoBtn.classList.toggle('on', !!fb.iso);
    isoBtn.disabled = !fb.iso && !fb.sel;
    allBtn.disabled = !fb.iso && !fb.hiddenAny();
  };
  const reveal = (path) => {
    let changed = false;
    for (let p = fb.parentOf(path); p; p = fb.parentOf(p)) if (!T.open.has(p)) { T.open.add(p); changed = true; }
    return changed;
  };
  const defaultOpen = () => { T.open.clear(); const r = fb.node(''); if (r) for (const k of r.children) T.open.add(k.path); };
  const setCollapsed = (c) => { T.el.classList.toggle('fb-collapsed', c); colBtn.textContent = c ? '▸' : '▾'; fb.panelState('tree', c ? 'min' : 'open'); };

  const build = () => {
    search = U.el('input', { class: 'fb-in', type: 'search', placeholder: '搜索部位…（如 刘海、尾巴）' });
    search.addEventListener('input', () => { T.q = search.value; render(); });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) { e.preventDefault(); search.value = ''; T.q = ''; render(); }
      else if (e.key === 'Enter') {
        const q = T.q.trim().toLowerCase();
        for (const p of T.rows.keys()) { const n = fb.node(p); if (q && n && match(n, q)) { fb.select(p, { src: 'tree' }); break; } }
      }
    });
    isoBtn = fb.btn('只看这个', '只显示选中的部位（I）', () => { if (fb.iso) fb.isolate(null); else if (fb.sel) fb.isolate(fb.sel); }, 'sm');
    allBtn = fb.btn('全部显示', '显示所有隐藏的部位（Shift+H）', () => fb.showAll(), 'sm');
    const expBtn = fb.btn('展开全部', '展开 / 收起整棵树', () => {
      const all = []; const walk = n => { if (n.children.length) { if (n.path) all.push(n.path); n.children.forEach(walk); } };
      const root = fb.node(''); if (root) walk(root);
      if (all.every(p => T.open.has(p))) defaultOpen(); else all.forEach(p => T.open.add(p));
      render();
    }, 'sm ghost');
    countEl = U.el('span', { class: 'fb-dim' });
    colBtn = fb.btn('▾', '收起 / 展开', () => setCollapsed(!T.el.classList.contains('fb-collapsed')), 'sm ghost');
    body = U.el('div', { class: 'fb-body' });
    T.el = U.el('div', { class: 'fb-side fb-left fb-panel' },
      U.el('div', { class: 'fb-head' }, U.el('b', null, '部位'), countEl, colBtn),
      U.el('div', { class: 'fb-tools' }, search, isoBtn, allBtn, expBtn), body);
    fb.root().append(T.el);
    const ps = fb.panelState('tree');
    setCollapsed(ps ? ps === 'min' : innerWidth <= 760);
    render();
  };

  V3.on('init', () => { if (fb.enabled) build(); });
  V3.on('model', () => { T.q = ''; if (search) search.value = ''; T.open.clear(); });
  V3.on('parts-changed', () => { if (!T.open.size) defaultOpen(); render(); });
  V3.on('fb-vis', () => { vis = null; paint(); });
  V3.on('fb-hover', (p) => { for (const [k, r] of T.rows) r.classList.toggle('hv', k === p); });
  V3.on('fb-items', () => { if (body && recount() !== T.sig) render(); });
  V3.on('fb-select', (path, info) => {
    if (!body) return;
    if (path && T.q && !T.rows.has(path)) { T.q = ''; search.value = ''; }
    if (path && (reveal(path) || !T.rows.has(path))) render(); else paint();
    const r = path && T.rows.get(path);
    if (r && info && info.src !== 'tree') r.scrollIntoView({ block: 'nearest' });
  });
})(window.V3);
