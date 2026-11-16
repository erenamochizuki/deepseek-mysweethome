// 68-collection.js — V3.collection 收集盒（第④阶段，cabin 页面）：open() / close() / isOpen()，也听 'game:open' 'collection'。
// 顶部「已找到 n / 12」+ 进度条；卡片按 常见 / 少见 / 稀有 分三组。没找到：剪影、「？？？」、稀有度；找到：图标、名字、×n。
// 点卡片打开详情：小转台（自己的 256×256 WebGLRenderer，关掉就 dispose）、名字、稀有度、介绍、第一次找到的时间、数量。
// 图标用 V3.shellIcons.get(id, { silhouette, size })；它还没好时用稀有度颜色的圆点。
(function (V3) {
  'use strict';
  const U = V3.util, H = V3.hud;
  const C = V3.collection = V3.collection || {};
  const GROUPS = ['common', 'uncommon', 'rare'];
  let card = null, body = null, head = null, main = null, detail = null, stage = null, flashId = null;
  const kinds = () => (V3.game && V3.game.kinds ? V3.game.kinds() : (V3.shells && V3.shells.KINDS) || []);
  const found = () => (V3.game && V3.game.st && V3.game.st.found) || {};
  const got = (id) => { const f = found()[id]; return f && f.n > 0 ? f : null; };
  const PIC = 64, BIG = 176;   // 卡片图标 / 详情大剪影的 CSS 尺寸；图片像素 = CSS × devicePixelRatio
  let preloaded = null;
  function preload() {   // shellIcons.preload 每帧画一个；hud:mount 时就开始，打开收集盒前再确认一次
    if (!preloaded && V3.shellIcons && V3.shellIcons.preload) preloaded = V3.shellIcons.preload(H.iconPx(PIC));
    return preloaded;
  }
  V3.on('hud:mount', () => preload());
  // 图标（V3.shellIcons.get → PNG dataURL）；shellIcons 没加载时用稀有度颜色的圆点
  function pic(k, sil, cls, css = PIC) {
    let src = null;
    try { if (V3.shellIcons && V3.shellIcons.get) src = V3.shellIcons.get(k.id, { silhouette: sil, size: H.iconPx(css) }); } catch (e) { src = null; }
    if (typeof src === 'string') return U.el('img', { class: cls + ' col-img' + (sil ? ' sil' : ''), src, alt: '', draggable: 'false' });
    const d = U.el('i', { class: cls + ' col-dot' + (sil ? ' sil' : '') });
    d.style.setProperty('--c', H.rarity(k).color);
    return d;
  }
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
  function counts() {
    try { if (V3.game && V3.game.counts) return V3.game.counts(); } catch (e) { /* 用下面的 */ }
    const ks = kinds(); return { kinds: ks.filter((k) => got(k.id)).length, total: ks.length || 12, items: 0 };
  }

  function cardOf(k) {
    const f = got(k.id), rar = H.rarity(k.rarity);
    const el = U.el('button', { class: 'col-card ' + k.rarity + (f ? ' got' : ' miss') + (flashId === k.id ? ' flash' : ''), type: 'button',
      title: f ? k.name : '还没找到', onclick: () => openDetail(k.id) },
      U.el('span', { class: 'col-well' }, pic(k, !f, 'col-pic')),
      U.el('span', { class: 'col-name' }, f ? k.name : '？？？'),
      U.el('span', { class: 'col-sub' }, f ? '×' + f.n : rar.label));
    tint(el, rar.color);
    el.dataset.id = k.id;
    return el;
  }
  function render() {
    if (!card) return;
    const c = counts(), ks = kinds();
    head.num.textContent = `已找到 ${c.kinds} / ${c.total}`;
    head.bar.style.width = (c.total ? (100 * c.kinds) / c.total : 0) + '%';
    head.sub.textContent = c.kinds >= c.total ? '全部找齐了，好厉害！' : c.items ? `一共捡到 ${c.items} 个` : '去沙滩上找找看吧';
    body.textContent = '';
    if (V3.inventoryUI && V3.game && V3.game.hosted) body.append(V3.inventoryUI.panel());
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
    body = U.el('div', { class: 'hud-card-body col-body' });
    main = U.el('div', { class: 'col-main' }, body);
    card = U.el('div', { class: 'hud-card col', role: 'dialog', 'aria-label': '收集盒' },
      U.el('div', { class: 'hud-card-head' },
        U.el('span', { class: 'hud-card-title' }, '收集盒'),
        U.el('div', { class: 'col-count' }, head.num, U.el('span', { class: 'col-bar' }, head.bar), head.sub),
        U.el('button', { class: 'hud-x', type: 'button', title: '关闭', 'aria-label': '关闭', onclick: () => C.close() }, '✕')),
      main);
  }

  // The catalog's weather list is a spawn-weight preference, not a gate.
  const MISSING_DESC = '还没找到。常去沙滩上走走，浪会把它冲上来的。';
  function missingDescription(k) {
    const labels = new Map(V3.scene?.WEATHERS || []);
    const preferred = [...new Set(Array.isArray(k.weather) ? k.weather : [])]
      .filter(wx => wx !== 'real' && labels.has(wx)).map(wx => wx === 'clear' ? '晴天' : labels.get(wx));
    return preferred.length ? `${MISSING_DESC} 等到${preferred.join('或')}的时候，说不定海浪就会把它带上岸……` : MISSING_DESC;
  }

  // ---- 详情：已找到的放小转台，没找到的放大剪影 ----
  function openDetail(id) {
    closeDetail();
    const k = kinds().find((x) => x.id === id); if (!k || !main) return;
    const f = got(id), rar = H.rarity(k.rarity);
    const view = U.el('div', { class: 'col-view' }), meta = U.el('div', { class: 'col-meta' });
    const chip = U.el('span', { class: 'col-chip' }, rar.label);
    tint(view, rar.color); chip.style.setProperty('--c', rar.color);
    const el = U.el('div', { class: 'col-detail ' + k.rarity + (f ? ' got' : ' miss') },
      U.el('button', { class: 'col-back', type: 'button', onclick: closeDetail }, '‹ 返回'),
      U.el('div', { class: 'col-dbody' }, view,
        U.el('div', { class: 'col-info' }, chip,
          U.el('h3', { class: 'col-title' }, f ? k.name : '？？？'),
          U.el('p', { class: 'col-desc' }, f ? k.desc : missingDescription(k)),
          meta)));
    detail = { id, el, meta, k, known: !!f };
    fillMeta();
    main.append(el);
    if (f) stage = turntable(view, k); else view.append(pic(k, true, 'col-big', BIG));
  }
  function fillMeta() {
    if (!detail) return;
    const f = got(detail.id); detail.meta.textContent = '';
    if (!f) return;
    const decor = V3.shellControls;
    detail.meta.append(
      U.el('div', null, U.el('b', null, '第一次找到'), when(f.first)),
      U.el('div', null, U.el('b', null, '一共找到'), f.n + ' 个'),
      U.el('span', { class: 'col-hint' }, '按住拖一拖，可以转着看'));
    if (decor && V3.game.hosted) {
      const controls = decor.detail(detail.id);
      if (controls) detail.meta.append(U.el('div', null, U.el('b', null, '柜中可用'), decor.available(detail.id) + ' 个'), controls);
    }
  }
  function closeDetail() {
    if (stage) { try { stage.dispose(); } catch (e) { V3.err('collection turntable dispose: ' + e.message); } stage = null; }
    if (detail) { detail.el.remove(); detail = null; }
  }
  // ---- 小转台：自己的 256×256 WebGLRenderer。几何和材质每种只借一次（V3.shells.build 的产物标 noPick、整组隐藏，
  //      不会被点到），开详情时复制一份给这个渲染器用，关掉时连复制品一起 dispose，主渲染器不受影响 ----
  const donors = {};
  function donor(id) {
    if (donors[id]) return donors[id];
    const g = V3.shells.build(id); let src = null;
    g.traverse((o) => { o.userData.noPick = true; if (o.isMesh && !src) src = o; });
    g.visible = false;
    return src ? (donors[id] = { geo: src.geometry, mats: [].concat(src.material) }) : null;
  }
  function turntable(view, k) {
    const still = () => { view.append(pic(k, false, 'col-big', BIG)); return null; };
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
    const geo = d.geo.clone(), mats = d.mats.map((m) => m.clone());
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
      dispose() {
        cancelAnimationFrame(raf);
        geo.dispose(); for (const m of mats) m.dispose(); pg.dispose(); pm.dispose();
        r.dispose(); r.forceContextLoss(); cv.remove();
      },
    };
  }

  C.open = () => {
    preload();
    if (!card) build();
    if (!H.modalOpen('collection')) {
      H.modal(card, { name: 'collection', onClose: closeDetail, onEsc: () => { if (!detail) return false; closeDetail(); return true; } });
    }
    render();
    return card;
  };
  C.close = () => H.closeModal('collection');
  C.isOpen = () => H.modalOpen('collection');
  C.openDetail = (id) => { C.open(); openDetail(id); };
  C.detail = () => (detail ? detail.id : null);
  C.stage = () => stage;
  V3.on('game:open', (what) => { if (what === 'collection' && H.mounted) C.open(); });
  V3.on('game:collect', (e) => {
    const id = e && e.item ? e.item.kind : null; if (!id) return;
    flashId = id;
    if (!C.isOpen()) return;
    render();
    if (detail && detail.id === id) { if (e.first) openDetail(id); else fillMeta(); }
  });
  V3.on('game:inventory', () => {
    if (!C.isOpen()) return;
    render();
    if (detail && detail.known !== !!got(detail.id)) openDetail(detail.id);
    else if (detail) fillMeta();
  });
  V3.on('game:reset', () => {
    if (!card) return;
    if (detail && !got(detail.id)) closeDetail(); else fillMeta();
    render();
  });
})(window.V3);
