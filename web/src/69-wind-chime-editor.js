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
  function fits(e, row) {
    return row.length <= e.spec.beads && row.reduce((mm, b) => mm + b.gap * 10 + e.own.get(b.uid).item.size, 0) <= e.spec.length * 10 + 1e-9;
  }
  function drop(e, uid, strand, depth) {
    const src = locate(e, uid), bead = src?.find(b => b.uid === uid) || { uid, gap: R.CHIME.gap };
    const row = e.draft.strands[strand].filter(b => b.uid !== uid);
    const items = e.lines[strand].items.filter(b => b.uid !== uid);
    const index = items.findIndex(b => depth < (b.top + b.bottom) / 2);
    row.splice(index < 0 ? row.length : index, 0, bead);
    return { ok: fits(e, row), row, src };
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
    const scroll = e.drawer.scrollLeft; e.drawer.replaceChildren();
    for (const k of V3.game.kinds()) {
      if (!R.decoratable(k)) continue;
      const items = inv().found[k.id]?.items.filter(it => !used.has(it.uid)); if (!items?.length) continue;
      const group = el('div', { class: 'chime-kind' }, el('b', null, k.name));
      const list = el('div', { class: 'chime-items' }); group.append(list);
      for (const it of items) {
        const pat = R.pattern(it.pat), crown = R.crown(k, it.size);
        const pick = el('button', { type: 'button', class: 'chime-pick', 'data-uid': it.uid },
          el('img', { src: V3.shellIcons.get(k.id, { size: H.iconPx(44), pat: it.pat }), alt: '', draggable: 'false' }),
          el('span', null, `${it.size} mm`), el('span', null, pat.name), crown ? V3.collection.crownEl(crown) : null);
        pick.addEventListener('pointerdown', ev => drag(e, ev, it.uid, false));
        pick.onclick = ev => { if (ev.detail === 0) place(e, it.uid, e.strand); };
        list.append(pick);
      }
      e.drawer.append(group);
    }
    if (!e.drawer.childElementCount) e.drawer.append(el('p', { class: 'tray-empty' }, '收藏盒里没有空闲的挂件'));
    e.drawer.scrollLeft = scroll;
  }
  function redraw(e) {
    e.model?.group.removeFromParent(); e.model = C.build(e.slot, e.draft, e.own); e.scene.add(e.model.group);
    e.lines = e.model.lines;
    const box = e.model.bounds;
    e.stage.style.setProperty('--chime-content-aspect', (box.max.y - box.min.y) / (box.max.x - box.min.x));
    if (!locate(e, e.sel)) e.sel = null;
    e.count.textContent = `${e.draft.strands.flat().length} / ${e.spec.strands * e.spec.beads} 枚`;
    e.labels.forEach((b, i) => { b.classList.toggle('on', i === e.strand); b.title = `第 ${i + 1} 串，${e.lines[i].length.toFixed(1)} cm`; });
    control(e); drawer(e);
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
    const move = p => {
      if (p.pointerId !== id) return;
      const t = target(e, p);
      e.labels.forEach((b, i) => { const over = i === t?.strand; b.classList.toggle('over', over); b.classList.toggle('bad', over && !drop(e, uid, i, t.depth).ok); });
    };
    const cancel = () => {
      e.drag = null;
      source.removeEventListener('pointermove', move); source.removeEventListener('lostpointercapture', end); source.removeEventListener('pointerup', end);
      source.removeEventListener('pointercancel', end);
      if (source.hasPointerCapture(id)) source.releasePointerCapture(id);
      e.labels.forEach(b => b.classList.remove('over', 'bad'));
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
    source.addEventListener('pointermove', move); source.addEventListener('pointerup', end); source.addEventListener('lostpointercapture', end); source.addEventListener('pointercancel', end);
  }
  function draw(e, now) {
    const w = e.stage.clientWidth, h = e.stage.clientHeight; if (!w || !h || e.closed) return;
    const newWidth = w !== e.w, resize = newWidth || h !== e.h;
    if (resize) { e.w = w; e.h = h; e.r.setSize(w, h, false); }
    const box = e.model.bounds, foot = e.labels[0].offsetHeight, margin = Math.min(18, h * .05);
    const width = Math.max(-box.min.x, box.max.x) * 2;
    const scale = Math.min(w * .92 / width, (h - foot - margin * 2) / (box.max.y - box.min.y));
    const height = h / scale, top = (box.max.y + box.min.y) / 2 + (h - foot) / (2 * scale);
    // 画面和落点共用逐帧插值后的镜头。换设备宽度时立即适配新的宽高比。
    const a = newWidth ? 1 : 1 - Math.exp(-(now - e.frameTime) / 110); e.frameTime = now;
    e.height = newWidth ? height : e.height + (height - e.height) * a;
    e.cam.top += (top - e.cam.top) * a; e.cam.bottom = e.cam.top - e.height;
    e.cam.right = e.height * w / h / 2; e.cam.left = -e.cam.right; e.cam.updateProjectionMatrix();
    const railY = (e.cam.top - box.max.y) * h / e.height;
    e.stage.style.setProperty('--chime-guide-height', Math.max(0, h - foot - railY) + 'px');
    e.labels.forEach((b, i) => { b.style.left = (50 + e.lines[i].x / (2 * e.cam.right)) + '%'; b.style.width = (9 / e.cam.right) + '%'; });
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
    const stage = el('div', { class: 'chime-stage' }, cv), tools = el('div', { class: 'chime-tools' }), strip = el('div', { class: 'chime-drawer' });
    const count = el('span', { class: 'tray-count' }), status = el('span', { class: 'tray-status', role: 'status' });
    const clear = button('全部取下', () => { if (!e.draft.strands.some(row => row.length)) return; e.draft.strands.forEach(row => { row.length = 0; }); changed(e); });
    const card = el('div', { class: 'hud-card chime-editor', role: 'dialog', 'aria-label': spec.name },
      el('div', { class: 'hud-card-head' }, el('span', { class: 'hud-card-title' }, spec.name), count, status, clear, closeButton()), stage, tools, strip);
    const e = editor = { slot, spec, r, cv, cam, scene, stage, card, count, status, tools, drawer: strip, strand: 0, labels: [] };
    for (let i = 0; i < spec.strands; i++) {
      const b = button(String(i + 1), () => { e.strand = i; e.sel = null; V3.chimes.preview(e.lines[i].items); redraw(e); }, `选择第 ${i + 1} 串`);
      b.className = 'chime-guide'; stage.append(b); e.labels.push(b);
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
