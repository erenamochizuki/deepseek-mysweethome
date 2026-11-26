// 68-album.js — V3.album：相册和「换照片」（docs/PHOTOS.md 第 5 节，2026-11-08 web7）。游戏页（cabin / home）用，弹窗借 67-hud 的 V3.hud.modal。
// 相册：点相册矮桌打开（91-cabin → V3.album.open({ near: 点到的位置 })；game:open 'album' 也行）。网格显示照片；
//   添加（「添加照片」选文件，或者把图片拖进弹窗）：从中间裁成正方形，高质量缩到 128 × 128，存成 PNG，超过 48 KB 就减色（V3.photos.fitPng）；
//   点一张选中，下面一条可以改名、往前 / 往后挪、删除（点两下）。最多 64 张，同一张不重复加。
//   照片存在房子方块数据里这张相册矮桌的方块实体（Album）：HB.setEntities 换掉，再 HB.saveArranged 存进浏览器（房子变成「布置过的房子」，导出鲸图带着）。
//   房子里没有相册矮桌时说清楚怎么放一张；布置模式里只能看，不能改（改了会被布置模式的「完成 / 放弃」盖掉）。
// 换照片：游戏里点相框或画框墙的一个小框（55-photo-frames 的点的平面 → V3.album.pick({ cell, slot })），布置模式里选中相框再点「换照片」（69-arrange）。
//   从离它最近的相册矮桌（16 格以内，和 MC 一样）里挑一张，或者「空」（相框露出衬纸，画框墙露出原来的小画）。画框墙可以在上面先挑是哪个小框。
// 测试用：V3.album.state() / add(files) / remove(i) / rename(i, name) / move(i, j) / photos(cell) / pickState() / choose(i | null) / chooseSlot(s)。
(function (V3) {
  'use strict';
  if (!V3.util || !V3.photos) return;
  const U = V3.util, P = V3.photos, HB = () => V3.houseBlocks;
  const AL = V3.album = {};
  const key = (c) => c[0] + ',' + c[1] + ',' + c[2];
  const errText = (e) => String((e && e.message) || e);
  const say = (t, bad) => { if (V3.hud && V3.hud.toast && V3.hud.mounted) V3.hud.toast(t, { color: bad ? '#ff8a8a' : '#6fc3f5', ms: bad ? 4600 : 2600 }); };
  const arranging = () => !!(V3.arrange && V3.arrange.on);

  // ---- 小图：照片 PNG → object URL（按 Id 缓存，关弹窗时释放）----
  const URLS = new Map();
  const urlOf = (p) => { let u = URLS.get(p.id); if (!u) { u = URL.createObjectURL(new Blob([p.png], { type: 'image/png' })); URLS.set(p.id, u); } return u; };
  const dropUrls = () => { for (const u of URLS.values()) URL.revokeObjectURL(u); URLS.clear(); };

  // ---- 图片文件 → 一张照片（128 × 128 PNG）----
  async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(file); } catch (e) { /* 再试 <img> */ }
    }
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); res(im); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('打不开')); };
      im.src = u;
    });
  }
  // 线性空间里按面积平均缩小（src：n × n 的 RGBA，n ≥ 128）→ 128 × 128 × 3
  const TOLIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; TOLIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  const toSrgb = (v) => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };
  function areaDown(src, n, N) {
    const k = n / N, tmp = new Float32Array(N * n * 3), out = new Uint8Array(N * N * 3);
    const spans = []; for (let o = 0; o < N; o++) { const a = o * k, b = (o + 1) * k, list = []; for (let i = Math.floor(a); i < Math.min(n, Math.ceil(b)); i++) { const w = Math.min(b, i + 1) - Math.max(a, i); if (w > 1e-9) list.push([i, w]); } spans.push(list); }
    for (let y = 0; y < n; y++) for (let o = 0; o < N; o++) {   // 横着
      let r = 0, g = 0, b = 0;
      for (const [i, w] of spans[o]) { const s = (y * n + i) * 4; r += TOLIN[src[s]] * w; g += TOLIN[src[s + 1]] * w; b += TOLIN[src[s + 2]] * w; }
      const d = (y * N + o) * 3; tmp[d] = r / k; tmp[d + 1] = g / k; tmp[d + 2] = b / k;
    }
    for (let o = 0; o < N; o++) for (let x = 0; x < N; x++) {   // 竖着
      let r = 0, g = 0, b = 0;
      for (const [i, w] of spans[o]) { const s = (i * N + x) * 3; r += tmp[s] * w; g += tmp[s + 1] * w; b += tmp[s + 2] * w; }
      const d = (o * N + x) * 3; out[d] = toSrgb(r / k); out[d + 1] = toSrgb(g / k); out[d + 2] = toSrgb(b / k);
    }
    return out;
  }
  // 一张图片 → { photo, colors }：从中间裁成正方形；大图先用浏览器的高质量缩放缩到 ≤ 512，再在线性空间按面积平均缩到 128
  AL.fromFile = async (file, name) => {
    let img;
    try { img = await decodeImage(file); } catch (e) { throw new Error('打不开这张图片（用 JPG、PNG、WebP 这些浏览器认得的图片）'); }
    const w = img.width, h = img.height;
    if (!w || !h) throw new Error('这张图片是空的');
    const s = Math.min(w, h), sx = (w - s) / 2, sy = (h - s) / 2, N = P.SIZE, T = s >= 512 ? 512 : Math.max(N, Math.round(s));
    const cv = document.createElement('canvas'); cv.width = cv.height = T;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, T, T);                 // 透明的地方垫白（照片要不透明）
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, sx, sy, s, s, 0, 0, T, T);
    if (img.close) img.close();
    const data = g.getImageData(0, 0, T, T).data;
    let rgb;
    if (T === N) { rgb = new Uint8Array(N * N * 3); for (let i = 0; i < N * N; i++) { rgb[i * 3] = data[i * 4]; rgb[i * 3 + 1] = data[i * 4 + 1]; rgb[i * 3 + 2] = data[i * 4 + 2]; } }
    else rgb = areaDown(data, T, N);
    const fit = await P.fitPng(rgb);
    const base = name != null ? name : String((file && file.name) || '').replace(/\.[^.]*$/, '');
    return { photo: P.make(fit.png, base), colors: fit.colors };
  };

  // ---- 相册数据 ----
  const model = () => { const H = HB(); return H && H.model; };
  const tables = () => (model() ? P.albumTables(model()) : []);
  // near：场景里的一点（点到的位置）→ 离它最近的相册矮桌；没给就第一张
  function tableFor(near) {
    const t = tables();
    if (!t.length) return null;
    if (!near) return t[0].cell;
    let best = t[0].cell, bd = Infinity;
    for (const q of t) { const d = Math.hypot(q.cell[0] + 0.5 - near[0], q.cell[1] + 0.5 - near[1], q.cell[2] + 0.5 - near[2]); if (d < bd) { bd = d; best = q.cell; } }
    return best;
  }
  AL.photos = (cell) => { const m = model(), c = cell || (S && S.cell) || tableFor(null); return m && c ? P.albumAt(m, c).photos : []; };
  // 改相册：一次只改一个（排队），改完存进浏览器
  let Q = Promise.resolve();
  const queue = (fn) => (Q = Q.then(fn, fn));
  async function writeAlbum(cell, photos, options) {
    const H = HB(), a = P.albumAt(H.model, cell);
    H.setEntities(P.setAlbum(H.model, cell, photos.concat(a.keep)));   // 网页打不开的照片原样留在最后
    const r = await H.saveArranged(options);
    return r;
  }
  const storeNote = (r) => (r && !r.stored ? '（这次未能存档：' + (r.storeError || '') + '）' : '');

  // Gallery imports and loft drawings share the same write queue as edits in the album.
  AL.storeDrawing = (photo, cell, options) => queue(async () => {
    const H = HB(), targets = tables();
    const target = cell ? targets.find(t => key(t.cell) === key(cell)) : targets[0];
    if (!target || arranging()) return { ok: false, why: target ? 'arranging' : 'missing-album' };
    const a = P.albumAt(H.model, target.cell);
    const duplicate = a.photos.some(item => item.id === photo.id);
    if (!duplicate && a.photos.length + a.keep.length >= P.MAX) return { ok: false, why: 'album-full' };
    // A previous storage failure may have left the photo in memory. Retry persistence even for that duplicate.
    try {
      const saved = duplicate ? await H.saveArranged(options) : await writeAlbum(target.cell, [...a.photos, photo], options);
      if (AL.isOpen() && !S.diary) draw();
      return saved?.stored ? { ok: true, duplicate } : { ok: false, why: 'storage-failed' };
    } catch { return { ok: false, why: 'storage-failed' }; }
  });

  // ---- 相册弹窗 ----
  let S = null;   // { cell, sel, msg, kind, del, card, … }
  const ICON = '<svg viewBox="0 0 50 50" aria-hidden="true"><rect x="9" y="8" width="8" height="34" rx="3" fill="#2b3a75"/><rect x="12" y="8" width="29" height="34" rx="5" fill="#34497a"/>' +
    '<rect x="18" y="13" width="18" height="16" rx="2.5" fill="#fff"/><rect x="20" y="15" width="14" height="10" rx="1.5" fill="#bfe6fb"/><circle cx="30.5" cy="18" r="2.2" fill="#ffc94d"/>' +
    '<path d="M20 25v-2.5q3.5-3 7 0t7 0V25z" fill="#6fc3f5"/><rect x="20" y="33" width="14" height="2.4" rx="1.2" fill="#f3e9d2"/><path d="M36 42v4.5l2-1.6 2 1.6V42z" fill="#e0574a"/></svg>';
  AL.isOpen = () => !!S && !!(V3.hud && V3.hud.modalOpen && V3.hud.modalOpen('album'));
  AL.close = () => { if (V3.hud && V3.hud.closeModal) V3.hud.closeModal('album'); };
  AL.open = async (opts = {}) => {
    const H = HB(), hud = V3.hud, diary = typeof opts.loadPages === 'function';
    if (!hud || !hud.modal) return false;
    if (!diary && H && H.load) { try { await H.load(); } catch (e) { /* 54 自己报 */ } }
    if (PK) closePick();
    AL.close();
    const title = diary ? '书架 · 日记' : '相册';
    const s = S = { cell: diary ? null : opts.cell || tableFor(opts.near || null), diary, pages: [], sel: null, msg: '', kind: '', del: false, busy: diary };
    const body = U.el('div', { class: 'hud-card-body alb-body' }), foot = U.el('div', { class: 'alb-foot hide' }), count = U.el('span', { class: 'alb-count', 'aria-live': 'polite' });
    const card = U.el('div', { class: 'hud-card alb-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      U.el('div', { class: 'hud-card-head' }, U.el('div', { class: 'hud-card-title' }, title), count,
        U.el('button', { class: 'hud-x', type: 'button', title: '关闭', 'aria-label': '关闭', onclick: () => AL.close() }, '✕')),
      body, foot);
    s.card = card; s.body = body; s.foot = foot; s.count = count;
    const back = hud.modal(card, { name: 'album', onEsc: () => closePreview(s), onClose: () => {
      closePreview(s);
      if (S === s) S = null;
      dropUrls();
    } });
    if (diary) {
      draw();
      try {
        const pages = await opts.loadPages();
        if (S !== s) return false;
        s.pages = Array.isArray(pages) ? pages : [];
        s.sel = s.pages.length ? 0 : null;
      } catch (e) {
        if (S !== s) return false;
        s.msg = '日记暂时读不到。请确认本机小屋与助手服务在线后重试。';
      }
      s.busy = false;
      draw();
      return true;
    }
    // 拖图片进来：弹窗接住（不让 54 / 29 的拖放当成换房子、换模型）
    const files = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    back.addEventListener('dragover', (e) => { if (!files(e)) return; e.preventDefault(); e.stopPropagation(); back.classList.add('alb-dragging'); });
    back.addEventListener('dragleave', (e) => { if (e.target === back || !back.contains(e.relatedTarget)) back.classList.remove('alb-dragging'); });
    back.addEventListener('drop', (e) => {
      if (!files(e)) return;
      e.preventDefault(); e.stopPropagation(); back.classList.remove('alb-dragging');
      AL.add([...e.dataTransfer.files]);
    });
    draw();
    return true;
  };
  function msg(text, kind) { if (S && !S.diary) { S.msg = text; S.kind = kind || ''; draw(); } }
  function closePreview(s) {
    if (!s.preview) return false;
    s.preview.close();
    s.preview.remove();
    s.preview = null;
    s.foot.querySelector('.alb-zoom')?.focus({ preventScroll: true });
    return true;
  }
  function openPreview(s, photo, title) {
    if (s.preview) return;
    const close = () => closePreview(s);
    const dialog = U.el('dialog', { class: 'alb-preview', 'aria-label': title,
      oncancel: e => { e.preventDefault(); close(); }, onclick: e => { if (e.target === dialog) close(); } },
      U.el('div', { class: 'hud-card-head' }, U.el('strong', null, title),
        U.el('button', { type: 'button', class: 'hud-x', 'aria-label': '关闭大图', title: '关闭大图', onclick: close }, '✕')),
      U.el('img', { src: urlOf(photo), alt: title }));
    s.preview = dialog;
    s.card.append(dialog);
    dialog.showModal();
  }
  const button = (label, cls, on, disabled, title) => U.el('button', { class: 'alb-btn' + (cls ? ' ' + cls : ''), type: 'button', disabled: !!disabled, title: title || label, onclick: on }, label);
  function selectPage(i, count) {
    if (!S || !Number.isInteger(i) || i < 0 || i >= count || i === S.sel) return;
    S.sel = i; S.del = false;
    if (S.diary) S.body.scrollTop = 0;
    draw();
    S.foot.querySelector('.alb-pager select')?.focus();
  }
  function pager(count, unit) {
    const index = S.sel;
    const picker = U.el('select', { 'aria-label': '跳到指定页', onchange: e => selectPage(Number(e.target.value), count) });
    for (let i = 0; i < count; i++) picker.append(U.el('option', { value: i, selected: i === index }, S.diary ? S.pages[i].title : `第 ${i + 1} ${unit}`));
    const step = (delta, label) => button(label, '', () => {
      selectPage(index + delta, count);
      S?.foot.querySelector('select')?.focus();
    }, index + delta < 0 || index + delta >= count);
    return U.el('div', { class: 'alb-foot-btns alb-pager' }, step(-1, '上一页'), picker, step(1, '下一页'));
  }
  function drawDiary() {
    const s = S, page = s.pages[s.sel];
    s.count.textContent = page ? `${s.sel + 1} / ${s.pages.length} 篇` : '';
    if (!page) {
      const text = s.busy ? '正在读取本机日记……' : s.msg || '书架上还没有日记。';
      s.body.append(U.el('p', { class: 'alb-msg' + (s.msg ? ' bad' : ''), role: 'status' }, text));
      return;
    }
    s.body.append(U.el('h3', { class: 'alb-diary-date' }, page.title), U.el('div', { class: 'alb-diary-text' }, page.text));
    s.foot.append(pager(s.pages.length, '篇'));
    s.foot.classList.remove('hide');
  }
  function draw() {
    if (!S) return;
    const m = model(), body = S.body;
    body.replaceChildren();
    S.foot.classList.add('hide'); S.foot.replaceChildren();
    if (S.diary) { drawDiary(); return; }
    if (!m || !S.cell || !P.albumTables(m).some((t) => key(t.cell) === key(S.cell))) {
      S.count.textContent = '';
      const ic = U.el('div', { class: 'alb-ic' }); ic.innerHTML = ICON;
      body.append(U.el('div', { class: 'alb-empty' }, ic, U.el('b', null, '这栋房子里没有相册矮桌'),
        U.el('p', null, '照片存在相册矮桌里。点左下角「布置」→「加家具」→「屋里」，放一张「相册矮桌」，点「完成」，再点它打开相册。')));
      return;
    }
    const a = P.albumAt(m, S.cell), n = a.photos.length + a.keep.length, ro = arranging();
    const memory = V3.shore?.shore()?.memory;
    if (memory) {
      const page = S;
      body.append(U.el('div', { class: 'alb-bar' }, U.el('b', null, '邻居手记'), U.el('span', null, '第一次换壳：' + V3.shore.label(memory)),
        U.el('button', { type: 'button', disabled: ro || S.busy || n >= P.MAX, onclick: async () => {
          try { const photo = V3.shore.memoryFile(memory); if (S === page) await AL.add([photo]); }
          catch { if (S === page) msg('照片没洗出来，可以再试一次。', 'bad'); }
        } }, '把纪念照贴进这本相册')));
    }
    S.count.textContent = n + ' / ' + P.MAX + ' 张';
    if (S.sel != null && S.sel >= a.photos.length) S.sel = a.photos.length ? a.photos.length - 1 : null;
    const input = U.el('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
    input.addEventListener('change', () => { const fs = [...input.files]; input.value = ''; if (fs.length) AL.add(fs); });
    const addB = U.el('label', { class: 'alb-add' + (ro || S.busy || n >= P.MAX ? ' off' : ''), title: '选几张照片（可以多选）；也可以直接把照片拖到这里' }, '＋ 添加照片', input);
    body.append(U.el('div', { class: 'alb-bar' }, addB,
      U.el('span', { class: 'alb-hint' }, ro ? '布置模式里只能看。点「完成」退出布置以后再改相册。'
        : n >= P.MAX ? '相册满了（最多 ' + P.MAX + ' 张），删掉几张才能再加。' : '也可以把照片拖到这里。会从中间裁成正方形，缩到 128 × 128（和 MC 的地图一样大）。')));
    if (S.msg) body.append(U.el('div', { class: 'alb-msg ' + S.kind }, S.msg));
    if (a.keep.length) body.append(U.el('div', { class: 'alb-msg warn' }, '有 ' + a.keep.length + ' 张照片网页打不开（不是 128 × 128 的 PNG，或者超过 48 KB），不显示，原样留在相册最后。'));
    if (!a.photos.length) {
      const ic = U.el('div', { class: 'alb-ic' }); ic.innerHTML = ICON;
      body.append(U.el('div', { class: 'alb-empty' }, ic, U.el('b', null, '相册还是空的'),
        U.el('p', null, '点「添加照片」，或者把照片拖进来。加好以后，在游戏里点相框（或者一楼西墙画框上的小框），就能把照片挂上去。')));
    } else {
      const grid = U.el('div', { class: 'alb-grid' });
      a.photos.forEach((p, i) => {
        const t = U.el('button', { class: 'alb-tile' + (S.sel === i ? ' on' : ''), type: 'button', title: p.name || '（没有名字）', 'data-i': String(i),
          onclick: () => { if (S) { S.sel = S.sel === i ? null : i; S.del = false; draw(); } } },
          U.el('img', { src: urlOf(p), alt: p.name || '', draggable: 'false' }), U.el('span', { class: 'alb-n' }, String(i + 1)),
          U.el('span', { class: 'alb-name' }, p.name || '（没有名字）'));
        grid.append(t);
      });
      body.append(grid);
    }
    body.append(U.el('div', { class: 'alb-note' }, '照片随这张相册矮桌保存在小屋存档里。「导出鲸图」可以把照片一起带进 MC，在 MC 里右键相框可切换到相册里的下一张。删掉相册里的照片，已经挂在相框上的仍会保留。'));
    // 下面一条：选中的那张
    if (S.sel != null && a.photos[S.sel]) {
      const i = S.sel, p = a.photos[i], last = a.photos.length - 1;
      const name = U.el('input', { class: 'alb-name-in', type: 'text', maxlength: String(P.NAME_MAX), value: p.name || '', placeholder: '给这张照片起个名字', disabled: ro || S.busy });
      const commitName = () => { if (S && name.value !== (p.name || '')) AL.rename(i, name.value); };
      name.addEventListener('change', commitName);
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } e.stopPropagation(); });
      const b = button;
      const del = b(S.del ? '确定删除？' : '删除', 'warn' + (S.del ? ' ask' : ''), () => { if (!S.del) { S.del = true; draw(); setTimeout(() => { if (S && S.del) { S.del = false; draw(); } }, 3000); } else { S.del = false; AL.remove(i); } }, ro || S.busy, '从相册里删掉这张（点两下）');
      const title = p.name || '第 ' + (i + 1) + ' 张照片';
      S.foot.append(U.el('button', { class: 'alb-zoom', type: 'button', title: '放大查看', 'aria-label': '放大查看：' + title,
        'aria-haspopup': 'dialog', onclick: () => openPreview(S, p, title) },
        U.el('img', { class: 'alb-foot-img', src: urlOf(p), alt: '' }), U.el('span', { 'aria-hidden': 'true' }, '放大')),
        U.el('div', { class: 'alb-foot-main' }, U.el('div', { class: 'alb-foot-t' }, '第 ' + (i + 1) + ' 张' + (p.added ? ' · ' + fmtDay(p.added) + ' 加的' : '')), name),
        U.el('div', { class: 'alb-foot-btns' },
          b('← 往前', '', () => AL.move(i, i - 1), ro || S.busy || i === 0, '往前挪一个位置'),
          b('往后 →', '', () => AL.move(i, i + 1), ro || S.busy || i === last, '往后挪一个位置'), del),
        pager(a.photos.length, '张'));
      S.foot.classList.remove('hide');
    }
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDay = (t) => { const d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };

  // ---- 相册操作（界面和测试都走这里；返回 { ok, … }）----
  const ready = () => (S && S.cell && model() ? null : { ok: false, why: '相册没打开' });
  AL.add = (files) => queue(async () => {
    const r0 = ready(); if (r0) return r0;
    if (arranging()) { msg('布置模式里不能改相册，点「完成」以后再加。', 'bad'); return { ok: false, why: 'arranging' }; }
    const cell = S.cell, list = [...(files || [])];
    S.busy = true; msg('正在处理 ' + list.length + ' 张照片……', 'busy');
    const a = P.albumAt(model(), cell), photos = a.photos.slice(), have = new Set(photos.map((p) => p.id)), bad = [], dup = [], full = [];
    let reduced = 0;
    for (const f of list) {
      const nm = (f && f.name) || '图片';
      if (photos.length + a.keep.length >= P.MAX) { full.push(nm); continue; }
      if (f.type && !/^image\//.test(f.type)) { bad.push(nm + '（不是图片）'); continue; }
      try {
        const r = await AL.fromFile(f);
        if (have.has(r.photo.id)) { dup.push(nm); continue; }
        have.add(r.photo.id); photos.push(r.photo);
        if (r.colors) reduced++;
      } catch (e) { bad.push(nm + '（' + errText(e) + '）'); }
    }
    const added = photos.length - a.photos.length;
    let saved = null;
    if (added) { try { saved = await writeAlbum(cell, photos); } catch (e) { bad.push('存不进去：' + errText(e)); } }
    if (!S) return { ok: added > 0, added };
    S.busy = false;
    const bits = [];
    if (added) bits.push('加了 ' + added + ' 张' + (reduced ? '（' + reduced + ' 张颜色多，减了点颜色才压到 48 KB 以内）' : '') + '。' + storeNote(saved));
    if (dup.length) bits.push(dup.length + ' 张已经在相册里了，没再加（' + dup.join('、') + '）。');
    if (full.length) bits.push('相册最多 ' + P.MAX + ' 张，' + full.length + ' 张没加（' + full.join('、') + '）。');
    if (bad.length) bits.push('没加上：' + bad.join('；') + '。');
    if (added) S.sel = null;
    msg(bits.join(' ') || '没有照片要加。', bad.length || full.length ? (added ? 'warn' : 'bad') : 'ok');
    if (added) say('相册里加了 ' + added + ' 张照片');
    return { ok: added > 0, added, dup: dup.length, full: full.length, bad, reduced };
  });
  const edit = (fn, okText) => queue(async () => {
    const r0 = ready(); if (r0) return r0;
    if (arranging()) { msg('布置模式里不能改相册。', 'bad'); return { ok: false, why: 'arranging' }; }
    const cell = S.cell, photos = P.albumAt(model(), cell).photos.slice(), r = fn(photos);
    if (!r.ok) return r;
    S.busy = true; draw();
    let saved = null;
    try { saved = await writeAlbum(cell, photos); } catch (e) { if (S) { S.busy = false; msg('没存上：' + errText(e), 'bad'); } return { ok: false, why: errText(e) }; }
    if (S) { S.busy = false; if (r.sel !== undefined) S.sel = r.sel; msg(okText(r) + storeNote(saved), 'ok'); }
    return r;
  });
  AL.remove = (i) => edit((ph) => { if (!ph[i]) return { ok: false, why: '没有第 ' + (i + 1) + ' 张' }; const p = ph.splice(i, 1)[0]; return { ok: true, removed: p.name || p.id, sel: null }; }, (r) => '删掉了「' + r.removed + '」。');
  AL.rename = (i, name) => edit((ph) => { if (!ph[i]) return { ok: false, why: '没有第 ' + (i + 1) + ' 张' }; ph[i] = P.renamed(ph[i], name); return { ok: true, name: ph[i].name, sel: i }; }, (r) => (r.name ? '改名叫「' + r.name + '」了。' : '名字去掉了。'));
  AL.move = (i, j) => edit((ph) => {
    if (!ph[i] || j < 0 || j >= ph.length || i === j) return { ok: false, why: '挪不了' };
    const p = ph.splice(i, 1)[0]; ph.splice(j, 0, p);
    return { ok: true, sel: j, to: j };
  }, (r) => '挪到第 ' + (r.to + 1) + ' 张了。');
  AL.state = () => {
    const m = model(), a = S && S.cell && m ? P.albumAt(m, S.cell) : null;
    return { open: AL.isOpen(), cell: S ? S.cell : null, noTable: !!S && !a, busy: !!(S && S.busy), msg: S ? S.msg : '', kind: S ? S.kind : '', sel: S ? S.sel : null,
      count: a ? a.photos.length : 0, bad: a ? a.keep.length : 0, ids: a ? a.photos.map((p) => p.id) : [], names: a ? a.photos.map((p) => p.name) : [], tiles: S && S.body ? S.body.querySelectorAll('.alb-tile').length : 0 };
  };
  AL.whenIdle = () => Q;

  // ---- 换照片（游戏里点相框；布置模式里「换照片」）----
  // opts：{ cell（相框 / 画框墙 part=0 那格）, slot?（画框墙第几个框；不给 = 先挑）, model?: () => 模型（布置模式给它自己的）, apply?: (slot, photo) => 结果 }
  let PK = null;
  function closePick() { if (V3.hud && V3.hud.closeModal) V3.hud.closeModal('photo-pick'); }
  AL.closePick = closePick;
  // 游戏里（不是布置模式）：换掉这一格的方块实体，存进浏览器
  async function applyGame(cell, slot, photo) {
    const H = HB(), fr = P.frameAt(H.model, cell);
    if (!fr) return { ok: false, why: '那里没有相框了' };
    const cur = fr.slots[slot];
    if ((cur ? cur.id : null) === (photo ? photo.id : null)) return { ok: true, same: true };
    H.setEntities(P.setSlot(H.model, cell, slot, photo));
    const r = await H.saveArranged();
    return { ok: true, stored: r && r.stored, storeError: r && r.storeError };
  }
  AL.pick = (opts = {}) => {
    const hud = V3.hud;
    if (!hud || !hud.modal) return false;
    const getModel = opts.model || model, m = getModel(), fr = m && P.frameAt(m, opts.cell);
    if (!fr) { say('那里没有相框', true); return false; }
    if (S) AL.close();
    PK = { cell: opts.cell.slice(), slot: opts.slot != null ? opts.slot : fr.kind === 'frame' ? 0 : null, getModel, apply: opts.apply || null, kind: fr.kind, busy: false, msg: '' };
    const body = U.el('div', { class: 'hud-card-body alb-pick-body' });
    const card = U.el('div', { class: 'hud-card alb-pick', role: 'dialog', 'aria-label': '换照片' },
      U.el('div', { class: 'hud-card-head' }, U.el('div', { class: 'hud-card-title' }, '换照片'),
        U.el('button', { class: 'hud-x', type: 'button', title: '关闭', 'aria-label': '关闭', onclick: () => closePick() }, '✕')), body);
    PK.body = body;
    hud.modal(card, { name: 'photo-pick', onClose: () => { PK = null; } });
    drawPick();
    return true;
  };
  function drawPick() {
    if (!PK) return;
    const m = PK.getModel(), fr = m && P.frameAt(m, PK.cell), body = PK.body;
    body.replaceChildren();
    if (!fr) { body.append(U.el('div', { class: 'alb-msg bad' }, '那里没有相框了。')); return; }
    const isWall = fr.kind === 'wall', ac = P.nearestAlbum(m, PK.cell), album = ac ? P.albumAt(m, ac) : null;
    body.append(U.el('div', { class: 'alb-pick-t' }, isWall ? '画框墙：先点要换的那个小框，再挑一张照片' : '相框：挑一张照片挂上去'));
    if (isWall) {   // 6 个小框，照墙上的样子摆：上排 3、4、5，下排 0、1、2（从正面看从左到右）
      const slots = U.el('div', { class: 'alb-slots' });
      for (const s of [3, 4, 5, 0, 1, 2]) {
        const p = fr.slots[s];
        slots.append(U.el('button', { class: 'alb-slot' + (PK.slot === s ? ' on' : ''), type: 'button', 'data-slot': String(s), title: '第 ' + (s + 1) + ' 个小框',
          onclick: () => { if (PK) { PK.slot = s; drawPick(); } } },
          p ? U.el('img', { src: urlOf(p), alt: '' }) : U.el('span', { class: 'alb-slot-art' }, '原来的画'), U.el('small', null, String(s + 1))));
      }
      body.append(slots);
    }
    if (PK.msg) body.append(U.el('div', { class: 'alb-msg ' + (PK.kind2 || '') }, PK.msg));
    if (PK.slot == null) { body.append(U.el('div', { class: 'alb-hint' }, '点上面的一个小框。')); return; }
    const cur = fr.slots[PK.slot], grid = U.el('div', { class: 'alb-grid alb-pick-grid' });
    const tile = (label, p, i) => U.el('button', { class: 'alb-tile' + ((cur ? cur.id : null) === (p ? p.id : null) ? ' cur' : ''), type: 'button', 'data-i': i == null ? 'none' : String(i), disabled: PK.busy,
      onclick: () => AL.choose(i) },
      p ? U.el('img', { src: urlOf(p), alt: '' }) : U.el('span', { class: 'alb-none' }, isWall ? '原来的画' : '衬纸'),
      U.el('span', { class: 'alb-name' }, label), (cur ? cur.id : null) === (p ? p.id : null) ? U.el('span', { class: 'alb-cur' }, '现在挂着') : null);
    grid.append(tile('空', null, null));
    if (album) album.photos.forEach((p, i) => grid.append(tile(p.name || '第 ' + (i + 1) + ' 张', p, i)));
    body.append(grid);
    if (!ac) body.append(U.el('div', { class: 'alb-msg warn' }, '附近 16 格以内没有相册矮桌（和 MC 里一样，照片从最近的相册矮桌里挑）。只能选「空」。要挂照片，先在「布置」里放一张相册矮桌，在相册里加照片。'));
    else if (!album.photos.length) body.append(U.el('div', { class: 'alb-msg warn' }, '相册是空的：先点相册矮桌打开相册，加几张照片。'));
    if (ac && !arranging() && !PK.apply) body.append(U.el('div', { class: 'alb-pick-foot' }, U.el('button', { class: 'alb-btn', type: 'button', onclick: () => { const c = ac; closePick(); AL.open({ cell: c }); } }, '打开相册')));
  }
  // 挑一张：i = 相册里第几张，null = 空。布置模式交给 69-arrange（opts.apply），游戏里直接换、存
  AL.choose = async (i) => {
    if (!PK || PK.busy || PK.slot == null) return { ok: false, why: '没开「换照片」' };
    const m = PK.getModel(), ac = P.nearestAlbum(m, PK.cell), photos = ac ? P.albumAt(m, ac).photos : [];
    const photo = i == null ? null : photos[i];
    if (i != null && !photo) return { ok: false, why: '相册里没有第 ' + (i + 1) + ' 张' };
    PK.busy = true; drawPick();
    let r;
    try { r = PK.apply ? PK.apply(PK.slot, photo) : await applyGame(PK.cell, PK.slot, photo); } catch (e) { r = { ok: false, why: errText(e) }; }
    if (!PK) return r;
    PK.busy = false;
    const wall = PK.kind === 'wall';
    if (r && r.ok) {
      closePick();
      if (!r.same) say(photo ? '挂上了「' + (photo.name || '照片') + '」' : (wall ? '换回原来的小画了' : '取下来了，露出衬纸'));
    } else { PK.msg = '没换成：' + ((r && r.why) || ''); PK.kind2 = 'bad'; drawPick(); }
    return r;
  };
  AL.chooseSlot = (s) => { if (!PK) return false; PK.slot = s; drawPick(); return true; };
  AL.pickState = () => {
    if (!PK) return { open: false };
    const m = PK.getModel(), fr = m && P.frameAt(m, PK.cell), ac = m && P.nearestAlbum(m, PK.cell);
    return { open: true, cell: PK.cell.slice(), slot: PK.slot, kind: fr ? fr.kind : null, album: ac, tiles: PK.body.querySelectorAll('.alb-pick-grid .alb-tile').length, msg: PK.msg };
  };

  V3.on('game:open', (what) => { if (what === 'album') AL.open({}); });
})(window.V3);
