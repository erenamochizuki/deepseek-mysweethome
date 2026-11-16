// 本机小屋存档客户端。离线成品 / 工作台不启用；服务端是库存和摆设的唯一真相。
(function (V3) {
  'use strict';
  const PATH = '/api/cabin/inventory';
  const id = (prefix) => prefix + '-' + (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const hosted = () => window.__CABIN_LOCAL_INVENTORY === true ||
    !!(location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname) &&
       document.querySelector('script[src="/cabin-bridge.js"]'));
  const client = V3.cabinInventory = {
    enabled: false, ready: false, data: null, error: '', id, use: hosted,
  };
  const messages = {
    revision_mismatch: '另一个页面刚修改了存档，请刷新后再试',
    inventory_not_empty: '已有收藏，未覆盖现有存档',
    slot_occupied: '这个位置已经摆了东西', out_of_stock: '柜子里没有可摆出的这一种',
    placement_changed: '这个位置的摆件已经变了', slot_empty: '这个位置已经收空了',
    return_not_due: '还没到收回的时候', inventory_corrupt: '小屋存档读不了，原文件没有改动',
    inventory_unavailable: '小屋存档暂时不可用', inventory_capacity: '小屋存档达到容量上限，先导出备份',
    invalid_input: '存档内容格式不对，原收藏没有改动',
  };
  let boot, refreshJob, legacyFound, migrationDone = false, retryTimer;
  function publish() { V3.emit('inventory:status', client); }
  function apply(json) {
    if (!json || json.ok !== true || !Number.isSafeInteger(json.rev) || json.rev < 0 ||
        !json.inventory || !json.inventory.found || !json.inventory.placements) throw new Error('小屋存档响应不完整');
    if (!client.data || json.rev > client.data.rev) {
      client.data = json;
      V3.emit('inventory:change', json);
    }
    return json;
  }
  async function request(op) {
    const ctl = new AbortController(), timeout = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(PATH, {
        method: op ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: ctl.signal,
        ...(op ? { headers: { 'Content-Type': 'application/json', 'X-Cabin-Inventory': '1' }, body: JSON.stringify(op) } : {}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok !== true) {
        const code = json && json.error;
        const err = new Error(messages[code] || json && json.message || '小屋存档暂不可用');
        err.status = res.status;
        throw err;
      }
      return apply(json);
    } finally { clearTimeout(timeout); }
  }
  function recover() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (!document.hidden) client.refresh(); else recover(); }, 12000);
  }
  function failed(e) {
    client.error = e && (e.status || e.name !== 'AbortError' && !(e instanceof TypeError)) && e.message || '连不上小屋存档，请稍后再试';
    publish();
    return client.error;
  }
  client.refresh = () => {
    if (!client.enabled) return Promise.resolve(false);
    if (refreshJob) return refreshJob;
    refreshJob = (async () => {
      try {
        await request();
        if (!migrationDone && !client.data.initialized && Object.keys(legacyFound || {}).length) {
          // Stable across tabs and retries. A browser origin never imports an empty save.
          await request({ op: 'legacy', id: 'legacy-v3-browser', found: legacyFound });
        }
        migrationDone = true;
        client.ready = true;
        client.error = '';
        publish();
        return true;
      } catch (e) { failed(e); return false; }
      finally { recover(); }
    })().finally(() => { refreshJob = null; });
    return refreshJob;
  };
  client.start = (found) => {
    if (boot) return boot;
    client.enabled = true;
    legacyFound = found || {};
    document.addEventListener('visibilitychange', () => { if (!document.hidden) client.refresh(); });
    addEventListener('focus', () => client.refresh());
    boot = client.refresh();
    return boot;
  };
  client.perform = async (op) => {
    if (!client.ready) return { ok: false, error: client.error || '小屋存档还在加载' };
    try {
      let json;
      try { json = await request(op); }
      catch (e) {
        if (e.status && e.status < 500) throw e;
        json = await request(op); // Retry only with the very same operation ID.
      }
      client.error = '';
      publish();
      return json;
    } catch (e) {
      const error = failed(e);
      if (e.status === 409) client.refresh();
      return { ok: false, error, status: e.status || 0 };
    }
  };
  client.exportData = () => client.ready && client.data
    ? { format: 'cabin-inventory-v1', inventory: client.data.inventory } : null;
  client.restore = (backup) => {
    if (!backup || backup.format !== 'cabin-inventory-v1' || !backup.inventory || !client.data) {
      return Promise.resolve({ ok: false, error: '不是小屋收藏备份' });
    }
    return client.perform({ op: 'restore', id: id('restore'), rev: client.data.rev, inventory: backup.inventory });
  };
})(window.V3);
