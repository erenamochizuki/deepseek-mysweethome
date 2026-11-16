// 74-fb-shot.js — feedback screenshot: 3D render (selection highlighted, hover cleared) + pin + caption strip.
(function (V3) {
  'use strict';
  const U = V3.util, fb = V3.fb;
  const SEVL = { 1: '小', 2: '中', 3: '大' };
  const FONT = '"Microsoft YaHei UI","Microsoft YaHei","PingFang SC",system-ui,sans-serif';
  const proj = (p, W, H) => {
    const v = new THREE.Vector3(...p).project(V3.R.camera);
    return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, ok: v.z > -1 && v.z < 1 };
  };
  // teardrop pin with its tip exactly on the clicked point
  const drawPin = (g, x, y, s) => {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.beginPath(); g.moveTo(0, 0); g.arc(0, -24, 11, Math.PI * 0.8, Math.PI * 0.2, false); g.closePath();
    g.fillStyle = '#ffb020'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.65)'; g.stroke();
    g.beginPath(); g.arc(0, -24, 4.2, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.beginPath(); g.arc(0, 0, 3, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#000'; g.stroke();
    g.restore();
  };
  // dashed box around the projected part bbox (selection without a clicked point)
  const drawBox = (g, path, W, H, s, alpha = 1) => {
    const b = fb.bbox(path);
    if (b.isEmpty()) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const q = proj([i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z], W, H);
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
    }
    const pad = 6 * s;
    g.save(); g.globalAlpha = alpha; g.setLineDash([8 * s, 5 * s]); g.lineWidth = (alpha < 1 ? 1.8 : 2.5) * s; g.strokeStyle = '#ffb020';
    g.strokeRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2); g.restore();
  };
  const fit = (g, t, max) => {
    if (g.measureText(t).width <= max) return t;
    while (t && g.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  };
  const caption = (g, it, W, H, sh, s) => {
    g.fillStyle = '#121826'; g.fillRect(0, H, W, sh);
    g.fillStyle = '#ffb020'; g.fillRect(0, H, Math.max(3, 5 * s), sh);
    g.textBaseline = 'middle';
    const pad = 14 * s, cy = H + sh / 2;
    g.font = `${Math.round(13 * s)}px ${FONT}`;
    const right = `程度 ${SEVL[it.severity] || it.severity} · ${U.fmtTime(Date.now())}`, rw = g.measureText(right).width;
    g.fillStyle = '#9aa5ba'; g.fillText(right, W - pad - rw, cy);
    const tx = it.text.replace(/\s+/g, ' '), t30 = tx.length > 30 ? tx.slice(0, 30) + '…' : tx;
    g.font = `600 ${Math.round(17 * s)}px ${FONT}`; g.fillStyle = '#e9edf5';
    g.fillText(fit(g, `${it.partLabel} · ${it.category} · ${t30}`, W - pad * 3 - rw), pad, cy);
  };

  // it = item from fb.makeItem; o = {max, type 'png'|'jpeg', q}; default from the store (offline = small jpeg)
  fb.shot = (it, o) => {
    const R = V3.R, st = fb.store;
    o = o || (st && st.shotOpts) || {};
    const src = R.renderer.domElement, max = o.max || 1280;
    const W = Math.min(max, src.width), s0 = W / src.width, H = Math.round(src.height * s0);
    const s = U.clamp(W / 1100, 0.7, 1.3), sh = Math.round(40 * s);
    const out = document.createElement('canvas'); out.width = W; out.height = H + sh;
    const g = out.getContext('2d');
    const hadHL = fb.hl;
    fb.clearHover();
    if (!hadHL) { fb.hl = true; fb.refreshHL(); }
    fb.hlScale(/颜色|材质/.test(it.category) ? 0.35 : 0.85);   // keep the real colours readable when colour is the point
    try {
      R.render();
      g.drawImage(src, 0, 0, W, H);           // same task as render: no preserveDrawingBuffer needed
    } finally {
      fb.hlScale(1);
      if (!hadHL) { fb.hl = false; fb.refreshHL(); }
    }
    const q = it.point && it.point.world ? proj(it.point.world, W, H) : null;
    if (it.part) drawBox(g, it.part, W, H, s, q && q.ok ? 0.55 : 1);   // part extent (lighter when a pin marks the spot)
    if (q && q.ok) drawPin(g, q.x, q.y, s);
    caption(g, it, W, H, sh, s);
    return o.type === 'jpeg' ? out.toDataURL('image/jpeg', o.q || 0.8) : out.toDataURL('image/png');
  };
})(window.V3);
