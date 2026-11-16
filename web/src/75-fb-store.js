// 75-fb-store.js — feedback storage: serve.mjs API when reachable, else localStorage (file:// / server down).
(function (V3) {
  'use strict';
  const U = V3.util, fb = V3.fb;
  const LS = 'v3.fb.offline', ID_RE = /^fb-\d{8}-\d{6}-[a-z0-9]{3,6}$/, FILE = location.protocol === 'file:';
  const p2 = n => String(n).padStart(2, '0');
  const localIso = (d = new Date()) => {
    const off = -d.getTimezoneOffset(), a = Math.abs(off);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}` +
      `.${String(d.getMilliseconds()).padStart(3, '0')}${off >= 0 ? '+' : '-'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
  };
  const newId = (d = new Date()) => {
    let r = ''; for (let i = 0; i < 3; i++) r += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
    return `fb-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}-${r}`;
  };
  const time = s => { const t = Date.parse(s); return Number.isFinite(t) ? t : 0; };
  const newest = (a, b) => time(b.created) - time(a.created) || String(b.id).localeCompare(String(a.id));

  const st = fb.store = {
    online: false, checked: false, items: [], nums: new Map(),
    shotOpts: { type: 'jpeg', max: 960, q: 0.8 }, localIso, newId, ID_RE,
  };

  // ---- localStorage (offline items keep their screenshot inline as shotData) ----
  const loadLocal = () => {
    try { const j = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(j) ? j : (j && j.items) || []; }
    catch (e) { return []; }
  };
  let local = loadLocal(), server = [];
  const saveLocal = (arr) => {
    try { localStorage.setItem(LS, JSON.stringify(arr)); local = arr; }
    catch (e) {
      fb.toast('浏览器本地空间满了：请先「导出」备份，再删掉一些旧反馈', 'err', 7000);
      throw new Error('本地空间不足');
    }
  };
  addEventListener('storage', e => { if (e.key === LS) { local = loadLocal(); publish(); } });
  st.isLocal = id => local.some(x => x.id === id);
  st.localCount = () => local.length;
  st.shotURL = it => (it && (it.shotData || (it.shot && !FILE ? '/feedback/' + it.shot : null))) || null;

  // ---- published list (newest first) + stable numbers (oldest = 1) ----
  let lastSig = null;
  const publish = () => {
    const ids = new Set(server.map(i => i.id));
    const items = [...server, ...local.filter(i => !ids.has(i.id))].sort(newest);
    st.items = items;
    st.nums = new Map(items.slice().reverse().map((it, i) => [it.id, i + 1]));
    const sig = items.map(i => i.id + ':' + i.updated + ':' + i.status).join('|');
    if (sig !== lastSig) { lastSig = sig; V3.emit('fb-items', items); }
  };
  st.get = id => st.items.find(i => i.id === id) || null;

  // ---- server ----
  const api = async (method, url, body) => {
    const r = await fetch(url, {
      method, cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = null;
    try { j = await r.json(); } catch (e) { /* not json */ }
    if (!r.ok) throw new Error((j && j.error) || `HTTP ${r.status}`);
    return j || {};
  };
  const ping = async () => {
    if (FILE) return false;
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 2500);
    try { const r = await fetch('/api/ping', { cache: 'no-store', signal: ac.signal }); const j = r.ok ? await r.json() : null; return !!(j && j.ok); }
    catch (e) { return false; } finally { clearTimeout(tm); }
  };
  let lost = false;
  const chip = () => {
    if (!st.checked) fb.setStatus('检测中…', '');
    else if (st.online && lost) fb.setStatus('服务器断开，重试中…', 'err', '新的反馈会先存在这个浏览器里');
    else if (st.online) fb.setStatus('已连接服务器', 'ok', '反馈保存在工程的 feedback 文件夹，AI 可以直接读取');
    else fb.setStatus('离线模式', 'off', FILE ? '本地打开的页面：反馈存在这个浏览器里，用「导出」把反馈包交给 AI'
      : '连不上服务器（serve.mjs）：反馈先存在这个浏览器里，服务器恢复后可以上传');
    ioButtons();
  };
  const setMode = (on) => {
    st.online = on; st.checked = true; lost = false;
    st.shotOpts = on ? { type: 'png', max: 1280 } : { type: 'jpeg', max: 960, q: 0.8 };
    chip();
  };
  // toast when the AI fixes / answers something (only for changes seen by polling)
  let seen = null;
  const notify = (items) => {
    if (seen) for (const it of items) {
      const o = seen.get(it.id), th = it.thread || [];
      if (!o) continue;
      if (o.status !== it.status && it.status === 'fixed') fb.toast(`AI 说已修复：${it.partLabel || it.part}，请看看对不对`, 'ok', 6000);
      else if (th.length > o.n && th[th.length - 1].who === 'ai') fb.toast(`AI 回复了：${it.partLabel || it.part}`, '', 6000);
    }
    seen = new Map(items.map(it => [it.id, { status: it.status, n: (it.thread || []).length }]));
  };
  const upsert = (it) => {
    server = [it, ...server.filter(x => x.id !== it.id)];
    if (seen) seen.set(it.id, { status: it.status, n: (it.thread || []).length });
    publish();
  };
  // ---- write ops ----
  const toJpeg = (src, max = 960, q = 0.8) => new Promise((res) => {
    if (!src || /^data:image\/jpeg/.test(src)) return res(src || null);
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, max / im.width), c = document.createElement('canvas');
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', q));
    };
    im.onerror = () => res(null);
    im.src = src;
  });
  const addLocal = async (it, shotData) => {
    let id = newId();
    while (local.some(x => x.id === id)) id = newId();
    const at = localIso();
    const x = { ...it, id, created: at, updated: at, shot: null, shotData: await toJpeg(shotData), status: it.status || 'open', thread: it.thread || [] };
    saveLocal([x, ...local]);
    publish();
    return x;
  };
  st.add = async (it, shotData) => {
    if (st.online) {
      try { const j = await api('POST', '/api/fb', { ...it, shotData }); upsert(j.item); return j.item; }
      catch (e) {
        if (!(e instanceof TypeError)) throw e;          // server answered with an error: keep the composer open
        lost = true; chip();
        fb.toast('连不上服务器，这条先存在本机', 'err', 5000);
      }
    }
    return addLocal(it, shotData);
  };
  st.patch = async (id, body) => {
    if (st.online && !st.isLocal(id)) { const j = await api('PATCH', '/api/fb/' + encodeURIComponent(id), body); upsert(j.item); return j.item; }
    const arr = local.map(x => ({ ...x })), it = arr.find(x => x.id === id);
    if (!it) throw new Error('找不到这条反馈');
    const at = localIso();
    if (body.reply && String(body.reply.text || '').trim()) {
      const e = { who: body.reply.who || 'user', at, text: body.reply.text };
      if (body.status) e.status = body.status;
      it.thread = [...(it.thread || []), e];
    }
    if (body.status) it.status = body.status;
    it.updated = at;
    saveLocal(arr); publish();
    return it;
  };
  st.remove = async (id) => {
    if (st.online && !st.isLocal(id)) { await api('DELETE', '/api/fb/' + encodeURIComponent(id)); server = server.filter(x => x.id !== id); }
    else saveLocal(local.filter(x => x.id !== id));
    publish();
  };
  st.refresh = async () => {
    if (st.online) {
      try {
        const j = await api('GET', '/api/fb');
        server = Array.isArray(j.items) ? j.items : [];
        notify(server);
        if (lost) { lost = false; chip(); }
      } catch (e) { if (!lost) { lost = true; chip(); } }
    } else local = loadLocal();
    publish();
  };
  // ---- polling (10 s; immediately when the tab becomes visible) ----
  let timer = 0;
  const tick = async () => {
    clearTimeout(timer);
    if (!document.hidden) {
      if (!st.online && !FILE && await ping()) { setMode(true); fb.toast('已连上服务器', 'ok'); }
      if (st.online) await st.refresh();
    }
    if (!FILE) timer = setTimeout(tick, 10000);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.checked) tick(); });

  // ---- export / import (offline bundle = same format as tools/fb.mjs export) ----
  const download = (name, text) => {
    const a = U.el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  st.exportBundle = () => ({ kind: 'v3-fb-bundle', version: 1, exported: localIso(), items: local.map(x => ({ ...x })) });
  st.exportFile = () => {
    if (!local.length) { fb.toast('本机还没有离线反馈'); return; }
    download(`v3-feedback-${newId().slice(3, 18)}.json`, JSON.stringify(st.exportBundle(), null, 1));
    fb.toast(`已导出 ${local.length} 条。交给 AI：node tools/fb.mjs import <文件>`, 'ok', 7000);
  };
  st.importBundle = (b) => {
    const list = Array.isArray(b) ? b : b && Array.isArray(b.items) ? b.items : null;
    if (!list) throw new Error('不是反馈包（v3-fb-bundle）');
    const map = new Map(local.map(x => [x.id, x])), r = { added: 0, updated: 0, skipped: 0 };
    for (const raw of list) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { r.skipped++; continue; }
      const id = ID_RE.test(raw.id || '') ? raw.id : newId(new Date(time(raw.created) || Date.now()));
      const old = map.get(id);
      if (old && time(raw.updated) <= time(old.updated)) { r.skipped++; continue; }
      const created = old ? old.created : raw.created || localIso();
      map.set(id, { ...raw, id, created, updated: raw.updated || created, status: raw.status || 'open', thread: raw.thread || [] });
      r[old ? 'updated' : 'added']++;
    }
    saveLocal([...map.values()].sort(newest)); publish();
    return r;
  };
  st.importFile = () => {
    const inp = U.el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; inp.remove();
      if (!f) return;
      try { const r = st.importBundle(JSON.parse(await f.text())); fb.toast(`导入完成：新增 ${r.added}，更新 ${r.updated}，跳过 ${r.skipped}`, 'ok', 5000); }
      catch (e) { fb.toast('导入失败：' + ((e && e.message) || e), 'err', 6000); }
    };
    document.body.append(inp); inp.click();
  };
  // ---- upload offline items once the server is reachable (server assigns new ids; old id kept as offlineId) ----
  st.upload = async () => {
    if (!st.online || !local.length) return;
    let ok = 0;
    const keep = [];
    for (const x of local.slice().reverse()) {          // oldest first
      const { id, created, updated, shot, ...rest } = x;
      try { const j = await api('POST', '/api/fb', { ...rest, offlineId: id, offlineCreated: created }); upsert(j.item); ok++; }
      catch (e) { keep.unshift(x); }
    }
    saveLocal(keep); publish();
    fb.toast(keep.length ? `上传了 ${ok} 条，${keep.length} 条失败（还留在本机）` : `已上传 ${ok} 条离线反馈`, keep.length ? 'err' : 'ok', 5000);
  };
  const ioButtons = () => {
    const bar = fb.bar;
    if (!bar || !bar.io) return;
    const kids = [];
    if (st.checked && !st.online) {
      kids.push(fb.btn('导出', '把本机的离线反馈（含截图）下载成一个 JSON 文件，交给 AI', () => st.exportFile(), 'sm'));
      kids.push(fb.btn('导入', '读入一个反馈包 JSON（按 id 合并）', () => st.importFile(), 'sm'));
    } else if (st.online && local.length) {
      kids.push(fb.btn(`上传 ${local.length} 条离线反馈`, '这些反馈之前存在这个浏览器里，现在可以传到服务器', () => st.upload(), 'sm warn'));
    }
    bar.io.replaceChildren(...kids);
  };
  V3.on('fb-items', () => ioButtons());

  // ---- boot: ping, first load, then poll ----
  st.ready = new Promise(res => { st._ready = res; });
  V3.on('init', async () => {
    if (!fb.enabled) { st._ready(); return; }
    try {
      chip();
      // a big model (house2) can block the page longer than ping's 2.5 s timeout: ask once more before going offline
      setMode((await ping()) || (await ping()));
      await st.refresh();
    } catch (e) { (V3.err || console.error)('fb-store: ' + ((e && e.message) || e)); }
    finally { st._ready(); }
    if (!FILE) timer = setTimeout(tick, 10000);
  });
})(window.V3);
