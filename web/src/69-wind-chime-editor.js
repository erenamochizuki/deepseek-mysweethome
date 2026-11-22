// 风铃工作台。草稿只属于打开的那个位置；关窗也要把最后一次改动存完。
(function (V3) {
  'use strict';
  const C = V3.chimeCraft, R = V3.inventoryRules, I = V3.cabinInventory, H = V3.hud, el = V3.util.el;
  const inv = () => I.data.inventory;
  const toast = text => H.toast(text, { color: '#efb378', ms: 3000 });
  const button = (text, fn, title = text) => el('button', { type: 'button', class: 'tray-btn', title, 'aria-label': title, onclick: fn }, text);
  let editor, menu, timer, offTap, offKey;
  function dismiss() {
    clearTimeout(timer);
    if (offTap) { document.removeEventListener('pointerdown', offTap, true); offTap = null; }
    if (offKey) { document.removeEventListener('keydown', offKey, true); offKey = null; }
    menu?.remove(); menu = null;
  }
  C.menu = (slot, point) => {
    if (!H.mounted || !point) return;
    dismiss();
    const p = new THREE.Vector3(...point).project(V3.R.camera), box = V3.R.canvas.getBoundingClientRect();
    menu = button('重新串一串', () => { dismiss(); C.open(slot); }); menu.classList.add('chime-menu'); document.body.append(menu);
    menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, box.left + (1 + p.x) * box.width / 2 + 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, box.top + (1 - p.y) * box.height / 2)) + 'px';
    // 点菜单外面的任何地方（空地、按钮、拖动镜头）或按 Esc 都收起；点菜单本身交给按钮。
    // 打开菜单的那一下 pointerdown 已经过去，所以马上挂监听不会把自己关掉。
    offTap = (e) => { if (menu && !menu.contains(e.target)) dismiss(); };
    document.addEventListener('pointerdown', offTap, true);
    offKey = (e) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', offKey, true);
    // 给浏览器一帧把菜单画出来，再计 4.2 秒。慢帧或切到后台时，不能在首次绘制前就收起。
    const current = menu;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (menu === current) timer = setTimeout(dismiss, 4200);
    }));
  };
  const closeButton = () => el('button', { type: 'button', class: 'hud-x', 'aria-label': '关闭', onclick: () => H.closeModal() }, '✕');
  C.choose = () => {
    const card = el('div', { class: 'hud-card chime-choose', role: 'dialog', 'aria-label': '风铃' },
      el('div', { class: 'hud-card-head' }, el('span', { class: 'hud-card-title' }, '风铃'), closeButton()),
      el('div', { class: 'chime-places' }, Object.entries(R.CHIME_SLOTS).map(([slot, spec]) => button(spec.name, () => C.open(slot)))));
    H.modal(card, { name: 'chime-choose' });
  };
  const stored = e => inv().chimes[e.slot];
  function reload(e) {
    e.own = C.owners(); e.draft = structuredClone(stored(e)); e.dirty = false; redraw(e);
  }
  async function save(e) {
    if (!e.dirty || e.saving) return;
    clearTimeout(e.timer); e.saving = true; e.dirty = false;
    const draft = structuredClone(e.draft);
    const result = await I.setChime(e.slot, draft);
    if (!result.ok) {
      await I.refresh(); clearTimeout(e.timer); e.dirty = false;
      toast(result.error); if (!e.closed) { e.drag?.(); reload(e); e.status.textContent = '已恢复存档'; }
    } else {
      e.draft.rev = result.chimeRev ?? result.inventory.chimes[e.slot].rev;
      if (!e.closed && !e.dirty) {
        // 抽屉里的按钮正接收拖动。重画会移除它，松手事件就送不到了。
        if (e.drag) e.refreshPending = true; else reload(e);
        e.status.textContent = '已保存';
      }
    }
    e.saving = false;
    if (e.dirty) { clearTimeout(e.timer); if (e.closed) void save(e); else e.timer = setTimeout(() => save(e), 500); }
  }
  function changed(e) {
    e.dirty = true; e.status.textContent = '待保存'; redraw(e);
    clearTimeout(e.timer); e.timer = setTimeout(() => save(e), 500);
  }
  const locate = (e, uid) => e.draft.strands.find(row => row.some(b => b.uid === uid));
  function usedCm(e, row) {
    return row.reduce((mm, bead) => mm + bead.gap * 10 + e.own.get(bead.uid).item.size, 0) / 10;
  }
  function fits(e, row, cm = usedCm(e, row)) {
    return row.length <= e.spec.beads && cm <= e.spec.length + 1e-9;
  }
  function drop(e, uid, strand, depth) {
    const src = locate(e, uid), bead = src?.find(b => b.uid === uid) || { uid, gap: R.CHIME.gap };
    const row = e.draft.strands[strand].filter(b => b.uid !== uid);
    const items = e.lines[strand].items.filter(b => b.uid !== uid);
    const index = items.findIndex(b => depth < (b.top + b.bottom) / 2);
    const insert = index < 0 ? row.length : index;
    row.splice(insert, 0, bead);
    const cm = usedCm(e, row), bottom = usedCm(e, row.slice(0, insert + 1));
    return { ok: fits(e, row, cm), row, src, cm, bottom };
  }
  function place(e, uid, strand, depth = Infinity) {
    if (!e.own.has(uid) || R.usedUids(inv(), e.slot).has(uid)) { toast('这一枚已经不能挂了'); return; }
    const d = drop(e, uid, strand, depth);
    if (!d.ok) { toast('这串放不下了'); return; }
    if (d.src) d.src.splice(d.src.findIndex(b => b.uid === uid), 1);
    e.draft.strands[strand] = d.row; e.sel = uid; e.strand = strand; changed(e);
  }
  function remove(e, uid) {
    const row = locate(e, uid); if (!row) return;
    row.splice(row.findIndex(b => b.uid === uid), 1); e.sel = null; changed(e);
  }
  function control(e) {
    e.tools.replaceChildren(); const row = locate(e, e.sel), idx = row?.findIndex(b => b.uid === e.sel);
    if (!row) { e.tools.append(el('span', null, `第 ${e.strand + 1} 串 · ${e.draft.strands[e.strand].length} 枚`)); return; }
    const bead = row[idx], k = V3.game.kind(e.own.get(bead.uid).kind);
    e.tools.append(el('strong', null, k.name), el('span', null, `间距 ${bead.gap} cm`));
    for (const [title, symbol, delta, gap] of [['上移','↑',-1,false], ['下移','↓',1,false], ['缩短间距','−',-1,true], ['增加间距','+',1,true]]) {
      const to = idx + delta, next = bead.gap + delta;
      const btn = button(symbol, () => {
        if (gap) bead.gap = next; else [row[idx], row[to]] = [row[to], row[idx]];
        changed(e);
      }, title);
      btn.disabled = gap ? next < R.CHIME.minGap || next > R.CHIME.maxGap || !fits(e, row.map(b => b === bead ? { ...b, gap: next } : b)) : to < 0 || to >= row.length;
      e.tools.append(btn);
    }
    e.tools.append(button('取下', () => remove(e, e.sel)));
  }
  function drawer(e) {
    const used = R.usedUids(inv(), e.slot); for (const b of e.draft.strands.flat()) used.add(b.uid);
    const groups = [];
    for (const k of V3.game.kinds()) {
      if (!R.chimeable(k)) continue;
      const items = inv().found[k.id]?.items.filter(it => !used.has(it.uid)); if (!items?.length) continue;
      groups.push({ k, items });
    }
    if (!groups.length) {
      e.drawer.replaceChildren(el('p', { class: 'tray-empty' }, '收藏盒里没有空闲的挂件'));
      return;
    }
    const previousKinds = e.drawer.querySelector('.chime-kinds')?.scrollLeft || 0;
    const previousItems = e.drawer.querySelector('.chime-items')?.scrollLeft || 0;
    const kinds = el('div', { class: 'chime-kinds', role: 'group', 'aria-label': '贝壳种类' });
    const list = el('div', { class: 'chime-items', role: 'group' });
    e.drawer.replaceChildren(kinds, list);
    function show({ k, items }, scroll = 0) {
      e.kind = k.id;
      for (const tab of kinds.children) tab.setAttribute('aria-pressed', String(tab.dataset.kind === k.id));
      list.setAttribute('aria-label', k.name + '的可用挂件');
      list.replaceChildren();
      for (const it of items) {
        const pat = R.pattern(it.pat), crown = R.crown(k, it.size);
        const pick = el('button', { type: 'button', class: 'chime-pick', 'data-uid': it.uid, 'aria-label': k.name + ' · ' + pat.name + ' · ' + it.size + ' mm' },
          el('img', { src: V3.shellIcons.get(k.id, { size: H.iconPx(44), pat: it.pat }), alt: '', draggable: 'false' }),
          el('span', null, `${it.size} mm`), el('span', null, pat.name), crown ? V3.collection.crownEl(crown) : null);
        pick.addEventListener('pointerdown', ev => drag(e, ev, it.uid, false));
        pick.onclick = ev => { if (ev.detail === 0) place(e, it.uid, e.strand); };
        list.append(pick);
      }
      list.scrollLeft = scroll;
    }
    for (const group of groups) {
      const { k, items } = group;
      kinds.append(el('button', { type: 'button', class: 'chime-kind', 'data-kind': k.id, onclick: () => show(group) },
        el('img', { src: V3.shellIcons.get(k.id, { size: H.iconPx(64) }), alt: '', draggable: 'false' }),
        k.name, el('span', { class: 'chime-stock' }, String(items.length))));
    }
    kinds.scrollLeft = previousKinds;
    const selected = groups.find(group => group.k.id === e.kind);
    show(selected || groups[0], selected ? previousItems : 0);
    if (!selected) kinds.scrollLeft = 0;
  }
  function redraw(e) {
    e.model?.group.removeFromParent(); e.model = C.build(e.slot, e.draft, e.own, { fullRopes: true }); e.scene.add(e.model.group);
    e.lines = e.model.lines;
    if (!locate(e, e.sel)) e.sel = null;
    e.count.textContent = `${e.draft.strands.flat().length} / ${e.spec.strands * e.spec.beads} 枚`;
    e.labels.forEach((b, i) => { b.classList.toggle('on', i === e.strand); b.title = `第 ${i + 1} 串，${e.lines[i].length.toFixed(1)} cm`; });
    showCapacity(e); control(e); drawer(e);
  }
  function showCapacity(e, strand = e.strand, proposed = null) {
    const row = e.draft.strands[strand], used = usedCm(e, row), total = e.spec.length;
    const box = e.capacity, state = box.dataset;
    const display = [strand, used, row.length, proposed?.cm, proposed?.row.length].join('/');
    if (e.capacityDisplay === display) return;
    e.capacityDisplay = display;
    state.strand = strand + 1; state.used = used; state.total = total; state.count = row.length;
    const cm = value => Number(value.toFixed(1)) + ' cm';
    box.replaceChildren(el('strong', null, `第 ${strand + 1} 串`),
      el('span', null, '绳长 ' + cm(total)), el('span', null, '已用 ' + cm(used)),
      el('span', null, `${row.length} / ${e.spec.beads} 枚`));
    if (proposed) {
      state.projected = proposed.cm; state.valid = proposed.ok; state.nextCount = proposed.row.length;
      const diff = proposed.cm - used;
      const reason = proposed.row.length > e.spec.beads ? '枚数已满' : '绳长不足';
      box.append(el('b', { class: 'chime-estimate' }, '放下后 ', el('span', null, cm(proposed.cm))),
        el('span', null, proposed.ok ? (diff > 0 ? '+' + cm(diff) : '长度不变') : reason));
    } else { delete state.projected; delete state.valid; delete state.nextCount; }
    e.ruler.style.setProperty('--used', Math.min(100, used / total * 100) + '%');
    e.ruler.style.setProperty('--projected', Math.min(100, (proposed?.cm ?? used) / total * 100) + '%');
    e.ruler.classList.toggle('bad', proposed?.ok === false);
  }
  // 预览用正交侧视图。命中范围跟着屏幕的真实宽高，不依赖设备像素比。
  function target(e, ev) {
    const r = e.cv.getBoundingClientRect(), u = (ev.clientX - r.left) / r.width, v = (ev.clientY - r.top) / r.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const x = (u - .5) * 2 * e.cam.right * 100, depth = (v * (e.cam.top - e.cam.bottom) - e.cam.top) * 100;
    let strand = 0; e.lines.forEach((line, i) => { if (Math.abs(x - line.x) < Math.abs(x - e.lines[strand].x)) strand = i; });
    return { strand, depth };
  }
  function drag(e, ev, uid, mounted) {
    if (ev.button !== 0 || e.drag) return;
    const source = ev.currentTarget, id = ev.pointerId; source.setPointerCapture(id);
    const entry = e.own.get(uid);
    const ghost = el('img', { class: 'chime-ghost', alt: '', draggable: 'false',
      src: V3.shellIcons.get(entry.kind, { size: H.iconPx(52), pat: entry.item.pat }) });
    document.body.append(ghost); source.classList.add('chime-dragging');
    const move = p => {
      if (p.pointerId !== id) return;
      ghost.style.left = p.clientX + 'px'; ghost.style.top = p.clientY + 'px';
      const t = target(e, p);
      const proposed = t && drop(e, uid, t.strand, t.depth);
      e.labels.forEach((b, i) => { const over = i === t?.strand; b.classList.toggle('over', over); b.classList.toggle('bad', over && !proposed.ok); });
      e.marker.hidden = !t;
      if (t) {
        e.marker.style.left = e.labels[t.strand].style.left;
        e.marker.style.top = (e.cam.top + Math.min(proposed.bottom, e.spec.length) / 100) / (e.cam.top - e.cam.bottom) * 100 + '%';
        e.marker.classList.toggle('bad', !proposed.ok);
      }
      showCapacity(e, t?.strand ?? e.strand, proposed);
    };
    const cancel = () => {
      e.drag = null;
      source.removeEventListener('pointermove', move); source.removeEventListener('lostpointercapture', end); source.removeEventListener('pointerup', end);
      source.removeEventListener('pointercancel', end);
      if (source.hasPointerCapture(id)) source.releasePointerCapture(id);
      e.labels.forEach(b => b.classList.remove('over', 'bad'));
      ghost.remove(); source.classList.remove('chime-dragging'); e.marker.hidden = true; showCapacity(e);
    };
    const end = p => {
      if (p.pointerId !== id) return;
      cancel();
      if (p.type !== 'pointerup') { if (e.refreshPending) syncEditor(e); return; }
      if (e.refreshPending && !syncEditor(e)) return;
      if (Math.hypot(p.clientX - ev.clientX, p.clientY - ev.clientY) < 5) {
        if (mounted) {
          e.sel = uid; V3.chimes.preview(e.lines[e.strand].items.filter(b => b.uid === uid));
          e.labels.forEach((b,i) => b.classList.toggle('on', i === e.strand)); control(e);
        } else place(e, uid, e.strand);
      } else {
        const t = target(e, p); if (t) place(e, uid, t.strand, t.depth); else if (mounted) remove(e, uid);
      }
    };
    e.drag = cancel;
    move(ev);
    source.addEventListener('pointermove', move); source.addEventListener('pointerup', end); source.addEventListener('lostpointercapture', end); source.addEventListener('pointercancel', end);
  }
  function draw(e, now) {
    const w = e.plot.clientWidth, h = e.plot.clientHeight; if (e.closed) return;
    if (w && h && (w !== e.w || h !== e.h)) {
      e.w = w; e.h = h; e.r.setSize(w, h, false);
      const foot = e.labels[0].offsetHeight, margin = Math.min(18, h * .05);
      const railTop = .037, rope = e.spec.length / 100, width = (e.spec.strands - 1) * .18 + .16;
      const scale = Math.min(w * .9 / width, (h - foot - margin * 2) / (railTop + rope));
      e.cam.top = (railTop - rope) / 2 + (h - foot) / (2 * scale);
      e.cam.bottom = e.cam.top - h / scale;
      e.cam.right = w / (2 * scale); e.cam.left = -e.cam.right; e.cam.updateProjectionMatrix();
      const railY = (e.cam.top - railTop) * scale;
      e.stage.style.setProperty('--chime-guide-height', h - foot - railY + 'px');
      e.stage.style.setProperty('--chime-rope-top', e.cam.top * scale + 'px');
      e.stage.style.setProperty('--chime-rope-height', rope * scale + 'px');
      e.labels.forEach((b, i) => { b.style.left = (50 + e.lines[i].x / (2 * e.cam.right)) + '%'; b.style.width = (9 / e.cam.right) + '%'; });
    }
    const phase = now / 1000 * 1.4; C.swing(e.model, phase, .23, Infinity, 0, 0); C.spin(e.model, phase);
    e.r.render(e.scene, e.cam); e.raf = requestAnimationFrame(t => draw(e, t));
  }
  C.open = slot => {
    dismiss(); if (!I.canChime()) { toast(I.ready ? '请更新本机小屋服务后再串风铃' : '小屋存档还在加载'); return; }
    if (!R.CHIME_SLOTS[slot]) return;
    if (editor?.slot === slot) return editor.card;
    H.closeModal();
    const spec = R.CHIME_SLOTS[slot], r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); const cv = r.domElement, scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-.6, .6, .1, -.9, .01, 5); cam.position.z = 2;
    scene.add(new THREE.HemisphereLight(0xfff7ed, 0x9bb7cc, 1.8)); const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(-1, 2, 2); scene.add(key);
    const capacity = el('div', { class: 'chime-capacity', role: 'status' });
    const ruler = el('div', { class: 'chime-ruler', 'aria-hidden': 'true' });
    for (let i = 0; i <= (slot === 'door' ? 4 : 3); i++) {
      const value = i * (slot === 'door' ? 20 : 15);
      const tick = el('span', null, String(value)); tick.style.top = value / spec.length * 100 + '%'; ruler.append(tick);
    }
    const marker = el('div', { class: 'chime-drop-marker', 'aria-hidden': 'true' }); marker.hidden = true;
    const plot = el('div', { class: 'chime-plot' }, cv, marker);
    const stage = el('div', { class: 'chime-stage' }, el('div', { class: 'chime-scale' }, capacity, ruler), plot);
    const tools = el('div', { class: 'chime-tools' }), strip = el('div', { class: 'chime-drawer' });
    const count = el('span', { class: 'tray-count' }), status = el('span', { class: 'tray-status', role: 'status' });
    const clear = button('全部取下', () => { if (!e.draft.strands.some(row => row.length)) return; e.draft.strands.forEach(row => { row.length = 0; }); changed(e); });
    const card = el('div', { class: 'hud-card chime-editor', role: 'dialog', 'aria-label': spec.name },
      el('div', { class: 'hud-card-head' }, el('span', { class: 'hud-card-title' }, spec.name), count, status, clear, closeButton()), stage, tools, strip);
    const e = editor = { slot, spec, r, cv, cam, scene, stage, plot, ruler, marker, capacity, card, count, status, tools, drawer: strip, strand: 0, labels: [] };
    for (let i = 0; i < spec.strands; i++) {
      const b = button(String(i + 1), () => { e.strand = i; e.sel = null; V3.chimes.preview(e.lines[i].items); redraw(e); }, `选择第 ${i + 1} 串`);
      b.className = 'chime-guide'; plot.append(b); e.labels.push(b);
    }
    const ray = new THREE.Raycaster();
    cv.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      const t = target(e, ev); if (!t) return; e.strand = t.strand;
      const r = cv.getBoundingClientRect(); ray.setFromCamera({ x: 2 * (ev.clientX - r.left) / r.width - 1, y: 1 - 2 * (ev.clientY - r.top) / r.height }, e.cam);
      let hit = ray.intersectObjects(e.model.beads, true)[0]?.object;
      while (hit && !e.model.beads.includes(hit)) hit = hit.parent;
      if (hit) { e.strand = e.model.sway.indexOf(hit.parent); drag(e, ev, hit.userData.uid, true); }
      else { e.sel = null; V3.chimes.preview(e.lines[t.strand].items); redraw(e); }
    });
    H.modal(card, { name: 'chime-editor', onClose() {
      e.closed = true; e.drag?.(); editor = null; clearTimeout(e.timer); void save(e);
      cancelAnimationFrame(e.raf); r.dispose(); r.forceContextLoss();
    } });
    reload(e); draw(e, performance.now()); return card;
  };
  function syncEditor(e) {
    e.refreshPending = false;
    const own = C.owners(), used = R.usedUids(inv(), e.slot);
    const stale = stored(e).rev !== e.draft.rev || e.draft.strands.flat().some(b => !own.has(b.uid) || used.has(b.uid));
    if (stale) {
      if (e.dirty) toast('另一页刚改过收藏，已恢复存档里的风铃');
      clearTimeout(e.timer); reload(e); e.status.textContent = ''; return false;
    }
    e.own = own; drawer(e); return true;
  }
  V3.on('inventory:change', () => {
    if (!editor || editor.saving) return;
    if (editor.drag) editor.refreshPending = true; else syncEditor(editor);
  });
})(window.V3);
