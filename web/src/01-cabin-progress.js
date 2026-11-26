// The local service injects this marker before any game code. Static releases use their original stores.
(function (V3) {
  'use strict';
  if (!window.document?.querySelector?.('meta[name="cabin-progress"][content="1"]')) return;
  const path = '/api/cabin/progress', records = new Map(), dirty = new Map(), assets = new Map();
  const gameKeys = /^(?:v3\.(?:game|cabinGame|powerSaving|sky\.site|girl\.model|cabinDecorNext|ysm\.vars\..+)|v4-furniture-play:.+|cabin\.snack\.v1|cabin\.routine\.lunch\.v1|cabinGallery\.(?:imported|frames-filled|repair)\.v1)$/;
  const pendingPrefix = 'cabin.pending-progress.', journal = pendingPrefix + crypto.randomUUID();
  const byteTypes = { Uint8Array, Uint8ClampedArray, Uint32Array, ArrayBuffer };
  let started, ready = false, inflight, timer, banner, stale = false;

  function notice(text, retrying = false) {
    if (!banner) {
      banner = V3.util.el('aside', { role: 'status', class: 'cabin-progress-status' },
        V3.util.el('span'), V3.util.el('button', { type: 'button', onclick: () => location.reload() }, '重新载入'));
      document.body.append(banner);
    }
    banner.firstChild.textContent = text;
    banner.dataset.retrying = String(retrying);
  }
  function encode(_, value) {
    if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) return value;
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let data = '';
    for (let i = 0; i < bytes.length; i += 24576) data += btoa(String.fromCharCode(...bytes.subarray(i, i + 24576)));
    return { type: value.constructor.name, encoding: 'base64', data };
  }
  function decode(_, v) {
    if (v?.encoding !== 'base64' || !Object.hasOwn(byteTypes, v.type)) return v;
    const bin = atob(v.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return v.type === 'ArrayBuffer' ? bytes.buffer : new byteTypes[v.type](bytes.buffer);
  }
  async function request(url, changes) {
    const controller = new AbortController();
    const opts = { cache: 'no-store', credentials: 'same-origin', signal: controller.signal };
    if (changes) Object.assign(opts, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Cabin-Progress': '1' },
      body: JSON.stringify({ changes }, encode) });
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const res = await fetch(url, opts);
      const data = JSON.parse(await res.text(), decode);
      if (res.status === 409 && data.conflicts) throw Object.assign(Error('另一页已更新同一项存档，请重新载入最新进度。'), { conflicts: data.conflicts });
      if (!res.ok || data.ok !== true) throw Error('连不上小屋存档服务。');
      return data;
    } finally { clearTimeout(timeout); }
  }
  function remember(rows) {
    for (const [key, row] of Object.entries(rows)) records.set(key, row);
  }
  async function commit(changes) {
    const { revisions } = await request(path, changes);
    for (const { key, value } of changes) {
      if (!Number.isSafeInteger(revisions?.[key])) throw Error('未收到存档确认。');
      records.set(key, { rev: revisions[key], value });
    }
  }
  const change = (key, value) => ({ key, value, base: records.get(key)?.rev || 0 });
  // Preserve the last few unacknowledged synchronous preference/game writes across a close or disconnect.
  // Asset writes are awaited by their editors and travel straight to the service.
  function persistJournal() {
    const rows = [...dirty].map(([k, v]) => change(k, v));
    if (rows.length) localStorage.setItem(journal, JSON.stringify(rows));
    else localStorage.removeItem(journal);
  }
  async function recoverPending() {
    for (const key of Object.keys(localStorage).filter(k => k.startsWith(pendingPrefix))) {
      const text = localStorage.getItem(key);
      if (!text) continue;
      const rows = JSON.parse(text);
      for (const row of rows) {
        try { await commit([row]); }
        catch (e) {
          if (!e.conflicts) throw e;
          // Preserve a conflicting unsent edit for recovery. Never rebase stale snapshots over another player's choice.
          localStorage.setItem('cabin.conflicting-progress.' + key + '.' + row.key, JSON.stringify(row));
          notice('之前有一项未同步的更改与服务端冲突，已保留本机副本并使用服务端进度。');
          remember(e.conflicts);
        }
      }
      if (localStorage.getItem(key) === text) localStorage.removeItem(key);
    }
  }
  async function start() {
    const data = await request(path);
    if (!data.records || typeof data.records !== 'object') throw Error('小屋存档响应不完整。');
    remember(data.records);
    await recoverPending();
    // A fresh browser may already have rebuilt an album from QQ originals in the default house.
    // An owner's older house takes precedence over that generated scene, together with its gallery bookkeeping.
    if (records.get('house')?.value?.galleryOnly && assets.has('house') && window.indexedDB) {
      const oldHouse = await assets.get('house')();
      if (oldHouse) {
        const changes = [change('house', oldHouse)];
        for (const key of ['cabinGallery.imported.v1', 'cabinGallery.frames-filled.v1', 'cabinGallery.repair.v1']) {
          changes.push(change(key, localStorage.getItem(key)));
        }
        try { await commit(changes); }
        catch (e) { if (!e.conflicts) throw e; throw Error('迁移时服务端房屋已更新，请重新载入。'); }
      }
    }
    const migrate = async (key, value) => {
      if (value == null) return;
      try { await commit([change(key, value)]); }
      catch (e) { if (!e.conflicts) throw e; remember(e.conflicts); }
    };
    for (const key of Object.keys(localStorage)) {
      if (!records.has(key) && gameKeys.test(key)) await migrate(key, localStorage.getItem(key));
    }
    if (window.indexedDB) for (const [key, read] of assets) {
      if (!records.has(key)) {
        const value = await read();
        if (!Array.isArray(value) || value.length) await migrate(key, value);
      }
    }
    ready = true;
    window.addEventListener('focus', checkUpdates);
    setInterval(() => { if (!document.hidden) checkUpdates(); }, 30000);
    window.addEventListener('online', schedule);
  }
  async function checkUpdates() {
    if (stale || dirty.size || inflight || !ready) return;
    try {
      const { revisions } = await request(path + '?revisions=1');
      if (!dirty.size && !inflight && Object.entries(revisions).some(([k,r]) => (records.get(k)?.rev || 0) < r)) {
        notice('另一页更新了小屋存档，可以重新载入查看最新进度。');
      }
    } catch { /* A failed poll leaves the last acknowledged revision in place. */ }
  }
  function schedule() {
    clearTimeout(timer);
    if (!stale && dirty.size) timer = setTimeout(() => flush().catch(() => {}), 250);
  }
  function requireReady() {
    if (!ready || stale) throw Error(stale ? '请重新载入最新的小屋存档。' : '小屋存档还未载入。');
  }
  // All writes share the revisions acknowledged to this page. Only acknowledged snapshots advance them.
  function serial(fn) {
    const task = (inflight || Promise.resolve()).catch(() => {}).then(fn);
    inflight = task;
    task.finally(() => { if (inflight === task) inflight = null; }).catch(() => {});
    return task;
  }
  async function guardedCommit(changes) {
    try { await commit(changes); }
    catch (e) {
      if (e.conflicts) stale = true;
      notice(e.conflicts ? e.message : '小屋存档暂未同步。请保持页面打开，恢复连接后再试。', !e.conflicts);
      throw e;
    }
  }
  function flush() {
    requireReady();
    V3.game?.flushPending?.();
    V3.furniturePlay?.flushPending?.();
    clearTimeout(timer);
    return serial(async () => {
      requireReady();
      while (dirty.size) {
        const rows = [...dirty].map(([key, v]) => change(key, v));
        try { await guardedCommit(rows); }
        catch (e) {
          if (!stale) timer = setTimeout(() => flush().catch(() => {}), 6000);
          throw e;
        }
        for (const row of rows) if (dirty.get(row.key) === row.value) dirty.delete(row.key);
        persistJournal();
      }
      if (banner?.dataset.retrying === 'true') { banner.remove(); banner = null; }
    });
  }
  const storage = {
    getItem: key => dirty.has(key) ? dirty.get(key) : records.get(key)?.value ?? null,
    setItem(key, value) {
      requireReady();
      if (storage.getItem(key) === value) return;
      dirty.set(key, value);
      schedule();
      persistJournal();
    },
  };
  V3.cabinProgress = {
    storage, flush, legacy: (key, read) => assets.set(key, read),
    start() { return started ||= start().then(() => true).catch(e => { notice('未能打开小屋存档。' + e.message); return false; }); },
    read: key => records.get(key)?.value ?? null,
    has: key => records.has(key),
    updateModels(transform) {
      return serial(async () => {
        requireReady();
        await guardedCommit([change('models', transform(records.get('models')?.value || []))]);
      });
    },
    write(key, value) {
      return serial(async () => { requireReady(); await guardedCommit([change(key, value)]); });
    },
  };
})(window.V3);
