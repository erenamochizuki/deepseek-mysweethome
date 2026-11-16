/* tools/refkit/page/view.js — image canvas: fit / zoom / pan, draw boxes, draw / move / resize boxes,
   crops for the character sheet, and annotated exports (<dir>/exports/*.jpg) for the agent. */
(function () {
  'use strict';
  const RK = window.RK, $ = RK.$;
  const cv = $('cv'), g = cv.getContext('2d');
  const V = RK.V = { img: null, key: null, iw: 1, ih: 1, s: 1, ox: 0, oy: 0, dpr: 1, fitted: true };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cache = new Map();
  let drag = null;

  RK.loadImg = (key) => {
    const i = RK.info(key);
    if (!i) return Promise.reject(new Error('no such image: ' + key));
    const id = key + '?' + i.mtime;
    if (!cache.has(id)) {
      cache.set(id, new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => { cache.delete(id); rej(new Error('图片加载失败')); };
        im.src = RK.imgUrl(i);
      }));
    }
    return cache.get(id);
  };
  RK.showImage = (key, keep) => {
    const same = key === V.key;
    V.key = key;
    if (!key) { V.img = null; RK.draw(); return; }
    if (!same) { V.img = null; RK.draw(); }
    RK.loadImg(key).then((im) => {
      if (V.key !== key) return;
      V.img = im;
      V.iw = im.naturalWidth;
      V.ih = im.naturalHeight;
      const a = RK.aimg(key);
      if (a.w !== V.iw || a.h !== V.ih) { a.w = V.iw; a.h = V.ih; RK.save(); if (!RK.typing()) RK.renderPanel(); }
      if (keep && same && !V.fitted) RK.draw(); else RK.fit();
    }).catch((e) => { if (V.key === key) RK.toast(e.message); });
  };
  function resize() {
    const r = cv.getBoundingClientRect();
    V.dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * V.dpr));
    cv.height = Math.max(1, Math.round(r.height * V.dpr));
    if (V.fitted) RK.fit(); else RK.draw();
  }
  new ResizeObserver(resize).observe($('stage'));
  RK.fit = () => {
    if (!V.img) { RK.draw(); return; }
    const W = cv.width / V.dpr, H = cv.height / V.dpr - 34;
    V.s = Math.max(0.01, Math.min((W - 32) / V.iw, (H - 32) / V.ih));
    V.ox = (W - V.iw * V.s) / 2;
    V.oy = (H - V.ih * V.s) / 2;
    V.fitted = true;
    RK.draw();
  };
  const toScr = (b) => ({ x: V.ox + b.x * V.iw * V.s, y: V.oy + b.y * V.ih * V.s, w: b.w * V.iw * V.s, h: b.h * V.ih * V.s });
  const toNorm = (sx, sy) => ({ x: (sx - V.ox) / (V.iw * V.s), y: (sy - V.oy) / (V.ih * V.s) });

  // ---------------------------------------------------------------- drawing
  RK.boxColor = (b) => {
    if (b.kind === 'character' && b.character && b.character !== '?') { const c = RK.char(b.character); if (c) return c.color; }
    if (b.thing && RK.canThing(b.kind)) { const t = RK.thing(b.thing); if (t) return t.color; }
    const k = RK.kind(b.kind);
    return k ? k.color : '#ffb347';
  };
  RK.boxLabel = (b) => {
    const k = RK.kind(b.kind), gk = b.q && b.q.guess && RK.kind(b.q.guess.kind);
    let t = b.id + ' ' + (k ? k.label : gk ? '我猜' + gk.label + '？' : '待确认');
    const c = b.character && b.character !== '?' ? RK.char(b.character) : null;
    if (c) t += ' · ' + c.name; else if (b.character === '?') t += ' · 不确定是谁';
    const th = b.thing && RK.canThing(b.kind) ? RK.thing(b.thing) : null;
    if (th) t += ' · ' + th.name;
    return t;
  };
  function drawBox(x, r, b, selected, u) {
    const col = RK.boxColor(b);
    x.save();
    x.lineWidth = (selected ? 3 : 2) * u;
    x.strokeStyle = col;
    if (!b.kind) x.setLineDash([6 * u, 4 * u]);
    if (b.kind === 'ignore') { x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(r.x, r.y, r.w, r.h); }
    x.strokeRect(r.x, r.y, r.w, r.h);
    x.setLineDash([]);
    const txt = RK.boxLabel(b);
    x.font = `${12 * u}px system-ui, "Microsoft YaHei", sans-serif`;
    const tw = x.measureText(txt).width + 8 * u, th = 17 * u, ly = r.y - th >= 0 ? r.y - th : r.y;
    x.fillStyle = col;
    x.fillRect(r.x, ly, tw, th);
    x.fillStyle = '#111';
    x.fillText(txt, r.x + 4 * u, ly + 12.5 * u);
    if (selected) {
      x.fillStyle = '#fff';
      for (const [cx, cy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) x.fillRect(cx - 4, cy - 4, 8, 8);
    }
    x.restore();
  }
  RK.draw = () => {
    const W = cv.width / V.dpr, H = cv.height / V.dpr;
    g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    $('zoom').textContent = V.img ? Math.round(V.s * 100) + '%' : '';
    if (!V.img) {
      if (V.key) { g.fillStyle = '#9097a6'; g.font = '14px system-ui'; g.fillText('加载中…', 20, 30); }
      return;
    }
    g.imageSmoothingEnabled = V.s < 2;
    g.drawImage(V.img, V.ox, V.oy, V.iw * V.s, V.ih * V.s);
    for (const b of RK.boxes(V.key)) drawBox(g, toScr(b), b, b.id === RK.sel, 1);
    if (drag && drag.mode === 'new') {
      const a = drag.start, c = drag.cur;
      const r = toScr({ x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) });
      g.setLineDash([5, 4]);
      g.lineWidth = 2;
      g.strokeStyle = RK.kind(RK.newKind).color;
      g.strokeRect(r.x, r.y, r.w, r.h);
      g.setLineDash([]);
    }
  };

  // ---------------------------------------------------------------- mouse
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function hit(sx, sy) {
    if (!V.img) return null;
    const boxes = RK.boxes(V.key), cur = boxes.find((b) => b.id === RK.sel);
    if (cur) {
      const r = toScr(cur);
      const cs = { nw: [r.x, r.y], ne: [r.x + r.w, r.y], sw: [r.x, r.y + r.h], se: [r.x + r.w, r.y + r.h] };
      for (const [h, [cx, cy]] of Object.entries(cs)) if (Math.abs(sx - cx) <= 7 && Math.abs(sy - cy) <= 7) return { b: cur, handle: h };
    }
    let best = null, ba = Infinity;
    for (const b of boxes) {
      const r = toScr(b);
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h && r.w * r.h < ba) { ba = r.w * r.h; best = b; }
    }
    return best ? { b: best, handle: null } : null;
  }
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    if (!V.img) return;
    cv.setPointerCapture(e.pointerId);
    const p = pos(e);
    if (e.button === 1 || e.button === 2) { drag = { mode: 'pan', sx: p.x, sy: p.y, ox: V.ox, oy: V.oy }; return; }
    if (e.button !== 0) return;
    const h = hit(p.x, p.y);
    if (h) {
      const changedSel = RK.sel !== h.b.id;
      RK.sel = h.b.id;
      drag = { mode: h.handle ? 'resize' : 'move', handle: h.handle, id: h.b.id, start: toNorm(p.x, p.y), r0: { x: h.b.x, y: h.b.y, w: h.b.w, h: h.b.h }, moved: false };
      if (changedSel) RK.renderPanel();
    } else {
      drag = { mode: 'new', start: toNorm(p.x, p.y), cur: toNorm(p.x, p.y) };
      if (RK.sel) { RK.sel = null; RK.renderPanel(); }
    }
    RK.draw();
  });
  cv.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (!drag) {
      const h = hit(p.x, p.y);
      cv.style.cursor = !h ? 'crosshair' : !h.handle ? 'move' : h.handle === 'nw' || h.handle === 'se' ? 'nwse-resize' : 'nesw-resize';
      return;
    }
    if (drag.mode === 'pan') { V.ox = drag.ox + p.x - drag.sx; V.oy = drag.oy + p.y - drag.sy; V.fitted = false; RK.draw(); return; }
    const n = toNorm(p.x, p.y);
    if (drag.mode === 'new') { drag.cur = n; RK.draw(); return; }
    const dx = n.x - drag.start.x, dy = n.y - drag.start.y, r = drag.r0;
    if (!drag.moved) {
      if (Math.hypot(dx * V.iw * V.s, dy * V.ih * V.s) < 3) return;
      drag.moved = true;
      drag.own = RK.own(V.key, drag.id);
    }
    const b = drag.own;
    if (drag.mode === 'move') {
      b.x = clamp(r.x + dx, 0, 1 - r.w);
      b.y = clamp(r.y + dy, 0, 1 - r.h);
    } else {
      let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
      if (drag.handle.includes('w')) x0 = clamp(x0 + dx, 0, 1);
      if (drag.handle.includes('e')) x1 = clamp(x1 + dx, 0, 1);
      if (drag.handle.includes('n')) y0 = clamp(y0 + dy, 0, 1);
      if (drag.handle.includes('s')) y1 = clamp(y1 + dy, 0, 1);
      b.x = Math.min(x0, x1); b.y = Math.min(y0, y1);
      b.w = Math.max(Math.abs(x1 - x0), 0.002); b.h = Math.max(Math.abs(y1 - y0), 0.002);
    }
    RK.draw();
  });
  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.mode === 'new') {
      const x0 = clamp(Math.min(d.start.x, d.cur.x), 0, 1), x1 = clamp(Math.max(d.start.x, d.cur.x), 0, 1);
      const y0 = clamp(Math.min(d.start.y, d.cur.y), 0, 1), y1 = clamp(Math.max(d.start.y, d.cur.y), 0, 1);
      if ((x1 - x0) * V.iw * V.s > 6 && (y1 - y0) * V.ih * V.s > 6) {
        RK.sel = RK.addBox(V.key, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }).id;
        RK.changed();
        return;
      }
    } else if (d.moved) { RK.changed(); return; }
    RK.draw();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => {
    if (!V.img) return;
    e.preventDefault();
    const p = pos(e), s = clamp(V.s * Math.exp(-clamp(e.deltaY, -100, 100) * 0.0015), 0.02, 16);
    V.ox = p.x - (p.x - V.ox) * s / V.s;
    V.oy = p.y - (p.y - V.oy) * s / V.s;
    V.s = s;
    V.fitted = false;
    RK.draw();
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => { const p = pos(e); if (!hit(p.x, p.y)) RK.fit(); });
  RK.focusBox = (key, id) => { RK.closeOverlay(); RK.select(key); RK.sel = id; RK.renderPanel(); RK.draw(); };

  // ---------------------------------------------------------------- crops and exports
  RK.crop = async (key, b, mw, mh) => {
    const im = await RK.loadImg(key), iw = im.naturalWidth, ih = im.naturalHeight;
    const x = b.x * iw, y = b.y * ih, w = b.w * iw, h = b.h * ih, pad = 0.12;
    const sx = Math.max(0, x - w * pad), sy = Math.max(0, y - h * pad);
    const sw = Math.max(1, Math.min(iw - sx, w * (1 + 2 * pad))), sh = Math.max(1, Math.min(ih - sy, h * (1 + 2 * pad)));
    const s = Math.min(mw / sw, mh / sh, 4);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * s));
    c.height = Math.max(1, Math.round(sh * s));
    const x2 = c.getContext('2d');
    x2.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
    x2.strokeStyle = RK.boxColor(b);
    x2.lineWidth = 2;
    x2.strokeRect((x - sx) * s, (y - sy) * s, w * s, h * s);
    return c;
  };
  const exTimers = new Map();
  RK.scheduleExport = (key) => {
    clearTimeout(exTimers.get(key));
    exTimers.set(key, setTimeout(() => RK.exportImage(key).catch(() => {}), 2000));
  };
  RK.cancelExport = (key) => { clearTimeout(exTimers.get(key)); exTimers.delete(key); };
  RK.exportImage = async (key) => {
    const im = await RK.loadImg(key);
    const s = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * s);
    c.height = Math.round(im.naturalHeight * s);
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0, c.width, c.height);
    const u = Math.max(1, c.width / 900);
    for (const b of RK.boxes(key)) drawBox(x, { x: b.x * c.width, y: b.y * c.height, w: b.w * c.width, h: b.h * c.height }, b, false, u);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
    const r = await fetch(RK.api('export?key=' + encodeURIComponent(key)), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    if (!r.ok) throw new Error(await RK.errText(r));
  };
  RK.exportAll = async () => {
    for (const i of RK.st.images) if (RK.boxes(i.key).length) { try { await RK.exportImage(i.key); } catch { /* skip */ } }
  };
})();
