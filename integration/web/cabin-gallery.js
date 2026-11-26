// cabin-gallery.js — 把她的画册（QQ 助手画册）接进小屋相册和挂画，并把她的日记装进网页「日记本」。
// 与 cabin-bridge.js 同源注入（home.html / cabin.html），不依赖 bridge 的内部实现。
//
// 数据来源（经 5194 反代到桥接 /api/cabin/art）：
//   { ok, year, drawings:[{id,ts,name,caption,url}], diaries:[{day,ts,chars,text}], albumMax }
//
// 行为：
//   · 画：页面打开 / 每 60s 增量同步，把不在相册里的画（当年的）导入相册矮桌（128×128 照片，同 AL 上传流程）；
//     导入过的画记在 localStorage（drawingId → photoId），相册被清空后会重新导入。
//   · 挂画：只有第一次同步时，把一楼西墙 6 个画框填上最新的 6 张画；以后新画只进相册，不碰挂画。
//   · 日记：右下角「日记本」按钮打开，左侧按天列表、右侧全文；每次打开都重新拉，新日记自动出现。
(function () {
  'use strict';
  var VERSION = '1.0.1';
  var ART_API = '/api/cabin/art';
  var SYNC_MS = 60000;
  var LS_IMPORTED = 'cabinGallery.imported.v1';
  var LS_FRAMES = 'cabinGallery.frames-filled.v1';
  var FILL_FRAMES_FLAG = '1';
  var LS_REPAIR = 'cabinGallery.repair.v1';

  function warn(key, e) { try { console.warn('[cabin-gallery] ' + key + '：' + ((e && (e.message || e)) || e)); } catch (x) {} }
  function V3() { return window.V3 || null; }
  function HB() { var v = V3(); return v && v.houseBlocks; }
  function P() { var v = V3(); return v && v.photos; }
  function AL() { var v = V3(); return v && v.album; }

  // ---- 画的导入 ----
  function readImported() { try { return JSON.parse((V3()?.cabinProgress?.storage || localStorage).getItem(LS_IMPORTED) || '{}') || {}; } catch (e) { return {}; } }
  function saveImported(m) { try { (V3()?.cabinProgress?.storage || localStorage).setItem(LS_IMPORTED, JSON.stringify(m)); } catch (e) {} }
  function framesFilled() { try { return (V3()?.cabinProgress?.storage || localStorage).getItem(LS_FRAMES) === FILL_FRAMES_FLAG; } catch (e) { return false; } }
  function markFramesFilled() { try { (V3()?.cabinProgress?.storage || localStorage).setItem(LS_FRAMES, FILL_FRAMES_FLAG); } catch (e) {} }
  function repairDone() { try { return (V3()?.cabinProgress?.storage || localStorage).getItem(LS_REPAIR) === '1'; } catch (e) { return false; } }
  function markRepairDone() { try { (V3()?.cabinProgress?.storage || localStorage).setItem(LS_REPAIR, '1'); } catch (e) {} }
  // 「导入过的画大部分不在相册里」= 相册被清空 / 房子被恢复原来的样子，画丢过一次。
  // 只在第一次自动补回全部；以后手动删掉的画仍然尊重删除。
  function repairNeeded(album, list, imported, have) {
    if (repairDone()) return false;
    var known = [], missing = 0;
    for (var i = 0; i < list.length; i++) {
      var pid = imported[list[i].id];
      if (!pid) continue;
      known.push(pid);
      if (!have.has(pid)) missing++;
    }
    return known.length >= 5 && missing >= 5 && missing >= known.length / 2;
  }

  function toast(text) {
    try {
      var v = V3();
      if (v && v.hud && typeof v.hud.toast === 'function' && v.hud.mounted) { v.hud.toast(text, { color: '#6fc3f5', ms: 2600 }); return; }
    } catch (e) {}
  }

  async function fetchArt() {
    var r = await fetch(ART_API, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var data = await r.json();
    if (!data || data.ok !== true) throw new Error((data && data.error) || 'bad payload');
    return data;
  }

  function pickAlbumCell(model) {
    var p = P();
    if (!p || !model) return null;
    var tables = p.albumTables(model);
    return tables.length ? tables[0].cell : null;
  }

  async function importDrawings(art) {
    var v = V3(), hb = HB(), p = P(), al = AL();
    if (!v || !hb || !p || !al || !hb.model) return { added: 0, reason: 'not-ready' };
    // 上次的房子读不出来、现在用的是默认房子：不要往浏览器里存，否则会把玩家原来的存档盖掉。
    if (hb.importError) return { added: 0, reason: 'house-load-error' };
    if (v.arrange && v.arrange.on) return { added: 0, reason: 'arranging' };
    var cell = pickAlbumCell(hb.model);
    if (!cell) return { added: 0, reason: 'no-album-table' };
    var album = p.albumAt(hb.model, cell);
    var have = new Set(album.photos.map(function (x) { return x.id; }));
    var imported = readImported();
    var year = Number(art.year) || new Date().getFullYear();
    var list = (art.drawings || []).filter(function (d) { return d && d.url && new Date(Number(d.ts) || 0).getFullYear() === year; });
    // 相册整本被清空 → 全部补回来。以前这里只补回第一张（加了一张以后，后面的都被当成「手动删掉」），
    // 用户 2026-11-22 反馈「相册被清空了」时正好只剩一张。
    var cleared = album.photos.length === 0 && album.keep.length === 0;
    var repair = !cleared && repairNeeded(album, list, imported, have);
    var restore = cleared || repair;
    var added = 0;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      album = p.albumAt(hb.model, cell);
      if (album.photos.length + album.keep.length >= p.MAX) break;
      var known = imported[d.id];
      if (known) {
        if (have.has(known)) continue;                          // 已经导入过且还在相册里
        if (!restore) continue;                                 // 你手动删掉了这一张：尊重删除，不自动加回
      }
      var photo = null;
      try {
        var res = await fetch(d.url, { cache: 'force-cache' });
        if (!res.ok) continue;
        var blob = await res.blob();
        if (!blob || !blob.size) continue;
        var safeName = String(d.name || d.id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 48);
        var file = new File([blob], safeName + '.png', { type: blob.type || 'image/png' });
        var r = await al.fromFile(file, d.name || safeName);
        photo = r && r.photo;
        if (!photo) continue;
        if (!have.has(photo.id) && d.drawInLoft && !known) {
          // Keep the QQ original as a pending drawing until she finishes this exact picture.
          if (!v.artDesk || !al.storeDrawing || (v.backgroundPaused?.() ?? document.hidden)) break;
          var imageUrl = URL.createObjectURL(blob);
          try { if (!await v.artDesk.drawForAlbum({ imageUrl: imageUrl })) break; }
          finally { URL.revokeObjectURL(imageUrl); }
        }
      } catch (e) { warn('import ' + d.id, e); continue; }
      if (al.storeDrawing || !have.has(photo.id)) {
        if (hb.importError || v.arrange?.on || !pickAlbumCell(hb.model)) break;
        try {
          var saved;
          if (al.storeDrawing) saved = await al.storeDrawing(photo, cell, { gallerySync: true });
          else {
            // Older single-file pages can still restore previously archived art.
            album = p.albumAt(hb.model, cell);
            if (album.photos.length + album.keep.length >= p.MAX) break;
            hb.setEntities(p.setAlbum(hb.model, cell, album.photos.concat(photo, album.keep)));
            saved = await hb.saveArranged();
          }
          if (saved?.ok === false || saved?.stored === false) break;
          have.add(photo.id);
          if (!saved?.duplicate) added++;
        } catch (e) { warn('save album', e); break; }
      }
      imported[d.id] = photo.id;
      saveImported(imported);
    }
    if (repair && i === list.length && added) markRepairDone();
    if (added) toast('画册里同步了 ' + added + ' 张画');
    return { added: added };
  }

  // ---- 挂画：只填这一次 ----
  async function fillFramesOnce(art) {
    if (framesFilled()) return { filled: 0, skipped: true };
    var v = V3(), hb = HB(), p = P();
    if (!v || !hb || !p || !hb.model) return { filled: 0 };
    if (hb.importError) return { filled: 0, reason: 'house-load-error' };   // 房子没读出来：别用默认房子盖掉玩家存档
    if (v.arrange && v.arrange.on) return { filled: 0, reason: 'arranging' };
    var cell = pickAlbumCell(hb.model);
    if (!cell) return { filled: 0, reason: 'no-album-table' };
    var album = p.albumAt(hb.model, cell);
    if (!album.photos.length) return { filled: 0, reason: 'empty-album' };
    var walls = p.frames(hb.model).filter(function (f) { return f && f.kind === 'wall'; });
    if (!walls.length) return { filled: 0, reason: 'no-wall' };
    // 最新的 6 张（导入顺序就是画的时间正序）
    var picks = album.photos.slice(-6);
    if (!picks.length) return { filled: 0 };
    var model = hb.model, filled = 0;
    for (var wi = 0; wi < walls.length && filled < picks.length; wi++) {
      var wall = walls[wi];
      for (var slot = 0; slot < wall.slots.length && filled < picks.length; slot++) {
        if (wall.slots[slot]) continue;                       // 已经有照片的框不动
        try { model = p.setSlot(model, wall.cell, slot, picks[filled]); filled++; } catch (e) { warn('setSlot ' + slot, e); }
      }
    }
    if (!filled) return { filled: 0, reason: 'no-empty-slot' };
    try {
      hb.setEntities(model);
      const saved = await hb.saveArranged({ gallerySync: true });
      if (saved?.stored === false) throw Error(saved.storeError || '挂画还未保存');
    } catch (e) { warn('save frames', e); return { filled: 0, error: String(e && (e.message || e)) }; }
    markFramesFilled();
    toast('挂画填上了 ' + filled + ' 张');
    return { filled: filled };
  }

  // ---- 同步入口（并发保护：同一时间只跑一份）----
  var syncing = null;
  function syncArt(reason) {
    if (syncing) return syncing;
    syncing = (async function () {
      try {
        var art = await fetchArt();
        var a = await importDrawings(art);
        var f = await fillFramesOnce(art);
        return { reason: reason || '', added: a.added, filled: f.filled, art: art };
      } catch (e) {
        return { reason: reason || '', error: String(e && (e.message || e)) };
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  // =====================================================================
  // 日记本
  // =====================================================================
  var diary = { root: null, btn: null, panel: null, list: null, body: null, meta: null, entries: [], sel: -1, loading: false };

  var today = { active: false, loading: false, day: '', after: 0, more: false, rows: [], generation: 0 };
  var todayClock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  async function showToday(reset) {
    if (reset) {
      today.generation++; today.loading = false; today.day = ''; today.after = 0; today.more = false; today.rows = [];
      diary.timeline.textContent = '正在翻看今天的小屋记录……';
    }
    if (today.loading) return;
    var gen = today.generation;
    today.loading = true;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 8000);
    try {
      var res = await fetch('/api/cabin/timeline?after=' + today.after + '&limit=100', { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error('timeline');
      var x = await res.json();
      if (gen !== today.generation || !today.active) return;
      if (!x || !x.ok || !Array.isArray(x.events) || !/^\d{4}-\d{2}-\d{2}$/.test(x.day) || !Number.isSafeInteger(x.nextAfter)) throw new Error('timeline');
      if (today.day && today.day !== x.day) { showToday(true); return; }
      today.day = x.day;
      today.rows = today.rows.concat(x.events);
      today.after = x.nextAfter;
      today.more = x.hasMore === true;
      diary.meta.textContent = fmtDay(x.day);
      renderToday();
    } catch (e) {
      if (gen !== today.generation || !today.active) return;
      if (today.rows.length) renderToday();
      else diary.timeline.textContent = '今日小屋暂时翻不开，点刷新再试。';
    } finally { clearTimeout(timer); if (gen === today.generation) today.loading = false; }
  }
  function renderToday() {
    var area = diary.timeline;
    area.textContent = '';
    if (!today.rows.length) { area.textContent = '还没有新的小屋记录。写进日记的内容，可以去日记里看。'; return; }
    var list = document.createElement('ol');
    list.className = 'cg-timeline-list';
    today.rows.slice().sort(function (a, b) { return a.t - b.t || a.seq - b.seq; }).forEach(function (e) {
      if (!e || !Number.isFinite(e.t) || typeof e.text !== 'string') return;
      var row = document.createElement('li'), clock = document.createElement('time'), what = document.createElement('span');
      clock.textContent = todayClock.format(e.t); what.textContent = e.text;
      row.append(clock, what); list.appendChild(row);
    });
    area.appendChild(list);
    if (today.more) {
      var more = document.createElement('button'); more.type = 'button'; more.textContent = '继续加载';
      more.className = 'cg-timeline-more';
      more.onclick = function () { more.disabled = true; showToday(false); };
      area.appendChild(more);
    }
  }
  function switchToday(active) {
    today.active = active;
    diary.timeline.hidden = !active;
    diary.columns.hidden = active;
    diary.dayNav.forEach(function (b) { b.hidden = active; });
    diary.refresh.hidden = !active;
    diary.title.textContent = active ? '今日小屋' : '她的日记本';
    diary.todayBtn.textContent = active ? '回日记本' : '今日小屋';
    if (active) { diary.meta.textContent = ''; showToday(true); }
    else { today.generation++; renderDiaryBody(); }
  }

  function fmtDay(day) { return String(day || '').replace(/-/g, ' / '); }
  function diaryButtonText() { return '日记本'; }

  function renderDiaryList() {
    if (!diary.list) return;
    diary.list.textContent = '';
    if (!diary.entries.length) {
      var empty = document.createElement('div');
      empty.className = 'cg-diary-empty';
      empty.textContent = '她还没写日记。今晚 23:30 写完就会出现在这里。';
      diary.list.appendChild(empty);
      return;
    }
    diary.entries.forEach(function (d, i) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'cg-diary-item' + (i === diary.sel ? ' on' : '');
      var day = document.createElement('span');
      day.className = 'cg-di-day';
      day.textContent = fmtDay(d.day);
      var chars = document.createElement('span');
      chars.className = 'cg-di-chars';
      chars.textContent = d.chars + ' 字';
      item.appendChild(day); item.appendChild(chars);
      item.addEventListener('click', function () { selectDiary(i); });
      diary.list.appendChild(item);
    });
  }

  function renderDiaryBody() {
    if (!diary.body) return;
    var d = diary.entries[diary.sel];
    diary.body.textContent = '';
    if (!d) {
      var hint = document.createElement('div');
      hint.className = 'cg-diary-hint';
      hint.textContent = '左边选一天，看她那天写了什么。';
      diary.body.appendChild(hint);
    } else {
      var h = document.createElement('div');
      h.className = 'cg-diary-h';
      h.textContent = fmtDay(d.day) + ' 的日记';
      var pre = document.createElement('div');
      pre.className = 'cg-diary-text';
      pre.textContent = d.text;
      diary.body.appendChild(h); diary.body.appendChild(pre);
      diary.body.scrollTop = 0;
    }
    if (diary.meta && !today.active) diary.meta.textContent = diary.entries.length ? (diary.sel + 1) + ' / ' + diary.entries.length : '还没有日记';
  }

  function selectDiary(i) {
    if (i < 0 || i >= diary.entries.length) return;
    diary.sel = i;
    renderDiaryList(); renderDiaryBody();
  }

  async function loadDiary() {
    if (diary.loading) return;
    diary.loading = true;
    if (diary.body) diary.body.textContent = '正在翻日记本……';
    try {
      var art = await fetchArt();
      diary.entries = (art.diaries || []).slice().sort(function (a, b) { return String(b.day).localeCompare(String(a.day)); }); // 新的在上
      if (diary.sel < 0 || diary.sel >= diary.entries.length) diary.sel = diary.entries.length ? 0 : -1;
      renderDiaryList(); renderDiaryBody();
    } catch (e) {
      diary.entries = [];
      if (diary.body) diary.body.textContent = '日记本暂时翻不开（QQ 助手/小屋服务没开？）';
    } finally {
      diary.loading = false;
    }
  }

  function ensureDiaryUI() {
    if (diary.root) return;
    var host = document.getElementById('cabin-bridge');
    if (!host) return;
    var root = document.createElement('div');
    root.className = 'cg-root';
    root.id = 'cabin-gallery';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cg-diary-toggle';
    btn.textContent = diaryButtonText();
    btn.title = '翻她的日记本';
    btn.addEventListener('click', function () { openDiary(); });
    root.appendChild(btn);

    var panel = document.createElement('aside');
    panel.className = 'cg-diary-panel';
    panel.setAttribute('aria-label', '她的日记本');
    var head = document.createElement('div');
    head.className = 'cg-diary-head';
    var title = document.createElement('strong');
    title.textContent = '她的日记本';
    var meta = document.createElement('span');
    meta.className = 'cg-diary-meta';
    var close = document.createElement('button');
    close.type = 'button'; close.className = 'cg-diary-close'; close.textContent = '×'; close.title = '合上';
    close.addEventListener('click', closeDiary);
    head.appendChild(title); head.appendChild(meta); head.appendChild(close);

    var cols = document.createElement('div');
    cols.className = 'cg-diary-cols';
    var list = document.createElement('div');
    list.className = 'cg-diary-list';
    var body = document.createElement('div');
    body.className = 'cg-diary-body';
    var hint = document.createElement('div');
    hint.className = 'cg-diary-hint';
    hint.textContent = '左边选一天，看她那天写了什么。';
    body.appendChild(hint);
    cols.appendChild(list); cols.appendChild(body);

    var foot = document.createElement('div');
    foot.className = 'cg-diary-foot';
    var prev = document.createElement('button'); prev.type = 'button'; prev.textContent = '← 前一天';
    var next = document.createElement('button'); next.type = 'button'; next.textContent = '后一天 →';
    prev.addEventListener('click', function () { selectDiary(Math.min(diary.entries.length - 1, diary.sel + 1)); });   // 列表是新的在上，所以 +1 是前一天
    next.addEventListener('click', function () { selectDiary(Math.max(0, diary.sel - 1)); });
    var note = document.createElement('span');
    note.className = 'cg-diary-note';
    note.textContent = '以后每天写完日记会自动出现在这里';
    var timeline = document.createElement('div');
    timeline.className = 'cg-diary-body cg-timeline'; timeline.hidden = true;
    var todayBtn = document.createElement('button'); todayBtn.type = 'button'; todayBtn.textContent = '今日小屋';
    var refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = '刷新'; refresh.hidden = true;
    todayBtn.onclick = function () { switchToday(!today.active); };
    refresh.onclick = function () { showToday(true); };
    foot.append(prev, next, todayBtn, refresh, note);

    panel.append(head, cols, timeline, foot);
    root.appendChild(panel);
    host.appendChild(root);

    diary.root = root; diary.btn = btn; diary.panel = panel;
    diary.list = list; diary.body = body; diary.meta = meta; diary.title = title;
    diary.columns = cols; diary.timeline = timeline; diary.todayBtn = todayBtn; diary.refresh = refresh; diary.dayNav = [prev, next, note];

    document.addEventListener('keydown', function (e) {
      if (!panel.classList.contains('on')) return;
      if (e.key === 'Escape') closeDiary();
    });
  }

  function openDiary(options) {
    ensureDiaryUI();
    if (!diary.panel) return false;
    if (options && options.list && today.active) switchToday(false);
    diary.panel.classList.add('on');
    if (diary.btn) diary.btn.classList.add('on');
    if (today.active) showToday(true);
    else loadDiary();
  }
  function closeDiary() {
    if (!diary.panel) return;
    diary.panel.classList.remove('on');
    if (diary.btn) diary.btn.classList.remove('on');
  }

  // ---- 启动：等页面 ready + 房子加载好 ----
  var started = false;
  function tryStart() {
    if (started) return;
    var v = V3();
    if (!v || !v.houseBlocks || !v.houseBlocks.model || !v.photos || !v.album) return;
    started = true;
    ensureDiaryUI();
    var timelineRefresh = 0;
    function maybeRefreshToday() {
      if (today.active && diary.panel && diary.panel.classList.contains('on') && !document.hidden) showToday(true);
    }
    if (typeof v.on === 'function') v.on('cabin:recorded', function () {
      if (today.rows.length > 100) return;
      clearTimeout(timelineRefresh);
      timelineRefresh = setTimeout(maybeRefreshToday, 350);
    });
    // Let an open first page reflect diary settlement and midnight without changing views.
    setInterval(function () { if (today.rows.length <= 100) maybeRefreshToday(); }, 30000);
    syncArt('startup').then(function (r) {
      if (r && r.added) console.log('[cabin-gallery] 启动同步：加画 ' + r.added + '，填挂画 ' + (r.filled || 0));
    });
    setInterval(function () { if (!(v.backgroundPaused?.() ?? document.hidden)) syncArt('poll'); }, SYNC_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) ensureDiaryUI();
    });
  }

  function boot() {
    var t0 = Date.now();
    (function poll() {
      if (started) return;
      tryStart();
      if (started) return;
      if (Date.now() - t0 > 90000) { warn('start', '页面 90 秒还没就绪，画册同步放弃（刷新可重试）'); return; }
      setTimeout(poll, 800);
    })();
  }

  window.__cabinGallery = { version: VERSION, sync: syncArt, openDiary: openDiary, closeDiary: closeDiary };
  try {
    if (document.body) boot();
    else document.addEventListener('DOMContentLoaded', boot, { once: true });
  } catch (e) { warn('boot', e); }
})();
