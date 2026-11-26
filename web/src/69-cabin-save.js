// The connected cabin exports the service's snapshot. A standalone page exports its local save.
(function (V3) {
  'use strict';
  const { util: U, cabinInventory: inventory } = V3;
  const saveKey = V3.cabinProgressKey;
  const generationKey = 'cabin.local-save-generation', pendingKey = 'cabin.local-save-pending';
  const generation = () => localStorage.getItem(generationKey);
  let openedGeneration, restoring = false;
  try { openedGeneration = generation(); } catch (_) {}

  function browserStorage() {
    const entries = new Map();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && saveKey(key)) entries.set(key, localStorage.getItem(key));
    }
    // Include edits that the game and furniture autosaves have yet to write.
    const [gameKey, game] = V3.game.saveEntry();
    entries.set(gameKey, game);
    const furniture = V3.furniturePlay?.saveEntry();
    if (furniture) entries.set(...furniture);
    entries.delete('v3.inventory');
    return Object.fromEntries(entries);
  }

  async function serviceSnapshot() {
    await V3.cabinProgress.flush();
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/cabin/save', {
        cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
      });
      if (!response.ok) throw new Error('小屋服务的存档暂时无法读取');
      const data = await response.json();
      if (!data?.ok || !data.inventory?.inventory || !Array.isArray(data.recipes) || !data.browser?.localStorage ||
          !Array.isArray(data.browser.models) || !Object.hasOwn(data.browser, 'house') || !Object.hasOwn(data.browser, 'texturePack')) {
        throw new Error('小屋服务返回的存档不完整');
      }
      return { inventory: data.inventory, recipes: data.recipes, browser: data.browser };
    } finally { clearTimeout(deadline); }
  }

  function encodeBinary(key, value) {
    if (!ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) return value;
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    // Chunks are divisible by three so older browsers can concatenate base64 without padding gaps.
    const size = 24 * 1024;
    let data = '';
    for (let i = 0; i < bytes.length; i += size) {
      data += btoa(String.fromCharCode(...bytes.subarray(i, i + size)));
    }
    return { type: value.constructor.name, encoding: 'base64', data };
  }

  async function standaloneSnapshot() {
    const storage = browserStorage();
    const browserRecords = window.indexedDB ? [
      V3.houseBlocks.store.get(),
      V3.ysmUI.backupModels(),
      V3.mcjar.cacheRecord(),
    ] : [null, [], null];
    const [saved, house, models, texturePack, recipes] = await Promise.all([
      inventory.localBackup(),
      ...browserRecords,
      window.indexedDB ? importRecord('readonly', s => s.get('recipes')) : [],
    ]);
    return { inventory: saved, recipes: recipes || [], browser: { localStorage: storage, house: house ?? null, models, texturePack: texturePack ?? null } };
  }

  // Recipes from a service backup and an undo snapshot during local restoration can be larger than localStorage.
  function importRecord(mode, run) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('cabin-save-import', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('records');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('records', mode), req = run(tx.objectStore('records'));
        tx.oncomplete = () => { db.close(); resolve(req?.result); };
        tx.onabort = () => { db.close(); reject(tx.error || Error('浏览器取消了存档写入')); };
      };
    });
  }

  const byteTypes = { Uint8Array, Uint8ClampedArray, Uint32Array, ArrayBuffer };
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  function requireValue(ok, msg) { if (!ok) throw Error(msg + '格式不正确'); }
  function decodeBinary(_, v) {
    if (!object(v) || v.encoding !== 'base64') return v;
    requireValue(Object.hasOwn(byteTypes, v.type) && typeof v.data === 'string', '二进制资料');
    let bytes;
    try {
      const text = atob(v.data);
      bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      return v.type === 'ArrayBuffer' ? bytes.buffer : new byteTypes[v.type](bytes.buffer);
    } catch (_) { throw Error('二进制资料损坏，无法还原'); }
  }

  async function readArchive(text) {
    let data;
    try { data = JSON.parse(text, decodeBinary); }
    catch (e) { throw Error(e instanceof SyntaxError ? '无法读取 JSON 存档' : e.message); }
    requireValue(data?.format === 'cabin-save-v1' && ['service','browser'].includes(data.source), '小屋完整存档');
    try { data.inventory = V3.inventoryRules.parseState(data.inventory, { catalog: inventory.catalog() }); }
    catch (_) { throw Error('收藏数据格式不正确'); }
    if (data.source === 'browser' && data.recipes === undefined) data.recipes = [];
    requireValue(Array.isArray(data.recipes) && data.recipes.every(row => object(row) && typeof row.name === 'string' &&
      typeof row.ingredients === 'string' && typeof row.steps === 'string' && typeof row.notes === 'string' &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(row.id) && ['player','assistant'].includes(row.source) &&
      typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt))), '食谱');
    const b = data.browser;
    requireValue(object(b) && object(b.localStorage), '浏览器存档');
    const storage = Object.create(null);
    for (const [k, v] of Object.entries(b.localStorage)) {
      if (!saveKey(k)) continue; // Early exports also contained device caches and pending QQ deliveries.
      requireValue(typeof v === 'string', '设置');
      if (/^v3\.(?:game|cabinGame)$/.test(k)) {
        let game;
        try { game = JSON.parse(v); } catch (_) {}
        requireValue(game?.v === 1 && object(game.S) && object(game.st), '游戏进度');
      }
      storage[k] = v;
    }
    b.localStorage = storage;
    if (b.house !== null) {
      requireValue(object(b.house) && [1,2].includes(b.house.v) && b.house.bytes?.byteLength &&
        (b.house.place === undefined || ['dx','dz','k'].every(k => Number.isSafeInteger(b.house.place?.[k]))), '房屋和相册');
      try { await V3.share.read(b.house.bytes); } catch (_) { throw Error('房屋或相册数据已损坏'); }
    }
    const textValue = v => typeof v === 'string' && v.length > 0;
    const ids = new Set();
    requireValue(Array.isArray(b.models), '角色模型');
    for (const row of b.models) {
      requireValue(object(row) && textValue(row.id) && textValue(row.name) && !ids.has(row.id) &&
        Array.isArray(row.files) && row.files.length > 0, '角色模型');
      ids.add(row.id);
      requireValue(row.files.every(file => Array.isArray(file) && file.length === 2 && textValue(file[0]) &&
        file[1] instanceof Uint8Array), '角色模型文件');
      const files = new Map(row.files);
      requireValue(files.size === row.files.length &&
        (row.authors === undefined || Array.isArray(row.authors) && row.authors.every(textValue)), '角色模型');
      try { V3.ysm.load(files, { name: row.name }); } catch (_) { throw Error('无法读取角色模型「' + row.name + '」'); }
    }
    const t = b.texturePack;
    requireValue(t === null || object(t) && textValue(t.key) && Array.isArray(t.names) && t.names.every(textValue) &&
      new Set(t.names).size === t.names.length &&
      t.blob instanceof Uint8Array && t.offsets instanceof Uint32Array && t.offsets.length === t.names.length + 1 &&
      t.offsets[0] === 0 && t.offsets[t.names.length] === t.blob.length && t.offsets.every((v,i,a) => !i || v >= a[i-1]), '纹理');
    return data;
  }

  async function restoreService(archive) {
    const generation = document.querySelector('meta[name="cabin-save-generation"]')?.content || '0';
    const res = await fetch('/api/cabin/save', { method: 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Cabin-Save': '1', 'X-Cabin-Generation': generation },
      body: JSON.stringify(archive, encodeBinary) });
    const data = await res.json().catch(() => null);
    if (res.status === 409) throw Error('另一页刚刚导入了存档，请刷新后重新选择文件。');
    if (res.status === 405 || res.status === 404) throw Error('当前小屋服务未提供完整存档导入，请更新服务端。');
    if (!res.ok || data?.ok !== true || typeof data.generation !== 'string') throw Error(data?.message || data?.error || '小屋服务未能确认导入结果，请重新导出并检查存档。');
  }

  function readStorage() {
    return Object.fromEntries(Object.keys(localStorage).filter(k => saveKey(k) || k === 'v3.inventory')
      .map(k => [k, localStorage.getItem(k)]));
  }
  function writeStorage(storage) {
    for (const k of Object.keys(readStorage())) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  }
  async function writeLocal(b, storage, recipes) {
    if (window.indexedDB) {
      if (b.house) await V3.houseBlocks.store.put(b.house); else await V3.houseBlocks.store.clear();
      await V3.ysmUI.replaceLocalModels(b.models);
      await V3.mcjar.replaceLocalRecord(b.texturePack);
      await importRecord('readwrite', s => recipes?.length ? s.put(recipes, 'recipes') : s.delete('recipes'));
    }
    writeStorage(storage);
  }
  const localLock = fn => navigator.locks?.request ? navigator.locks.request('v3.inventory', fn) : fn();
  async function restoreLocal(data) {
    await localLock(async () => {
      if (generation() !== openedGeneration || localStorage.getItem(pendingKey)) throw Error('另一页已开始导入，请刷新后再试。');
      const b = data.browser;
      if (!window.indexedDB && (b.house || b.models.length || b.texturePack || data.recipes.length)) throw Error('本浏览器不能保存备份中的房屋、角色、纹理或食谱。');
      V3.game.flushPending?.();
      V3.furniturePlay?.flushPending?.();
      const prior = await standaloneSnapshot();
      const before = { browser: prior.browser, storage: readStorage(), recipes: prior.recipes };
      const storage = { ...b.localStorage, 'v3.inventory': JSON.stringify(data.inventory) };
      const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      // Keep the previous state durable until all three IndexedDB stores and localStorage have committed.
      if (window.indexedDB) await importRecord('readwrite', s => s.put(before, 'undo'));
      restoring = true;
      try {
        if (window.indexedDB) localStorage.setItem(pendingKey, id);
        const recipes = data.source === 'browser' && !data.recipes.length ? before.recipes : data.recipes;
        await writeLocal(b, storage, recipes);
        localStorage.setItem(generationKey, id);
      } catch (e) {
        try { await writeLocal(before.browser, before.storage, before.recipes); }
        catch (_) { throw Error('导入中断，已保留原存档副本。请释放浏览器存储空间后刷新页面以恢复。'); }
        localStorage.removeItem(pendingKey);
        restoring = false;
        throw e;
      }
      localStorage.removeItem(pendingKey);
      if (window.indexedDB) await importRecord('readwrite', s => s.delete('undo')).catch(() => {});
    });
  }

  async function recoverLocal() {
    let pending;
    try { pending = localStorage.getItem(pendingKey); } catch (_) { return; }
    if (V3.cabinProgress || !pending) return;
    await localLock(async () => {
      const id = localStorage.getItem(pendingKey);
      if (!id) return;
      if (id !== generation()) {
        const before = await importRecord('readonly', s => s.get('undo'));
        if (!before) throw Error('无法读取导入前的小屋存档副本。');
        await writeLocal(before.browser, before.storage, before.recipes);
      }
      localStorage.removeItem(pendingKey);
      await importRecord('readwrite', s => s.delete('undo'));
    });
  }
  V3.cabinSave = {
    recoverLocal,
    localWritesPaused() {
      if (V3.cabinProgress) return false;
      try { return restoring || openedGeneration !== generation() || !!localStorage.getItem(pendingKey); }
      catch (_) { return false; }
    },
  };
  if (!V3.cabinProgress) window.addEventListener('storage', e => {
    if (e.key === generationKey && e.newValue !== openedGeneration) location.reload();
  });

  async function download() {
    const saved = await (inventory.remote ? serviceSnapshot() : standaloneSnapshot());
    const now = new Date();
    const archive = {
      format: 'cabin-save-v1',
      exportedAt: now.toISOString(),
      source: inventory.remote ? 'service' : 'browser',
      ...saved,
    };
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(n => String(n).padStart(2, '0')).join('-');
    const url = URL.createObjectURL(new Blob([JSON.stringify(archive, encodeBinary, 2)], { type: 'application/json' }));
    const link = U.el('a', { href: url, download: '海边小屋存档-' + date + '.json' });
    try { link.click(); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
  }

  function render() {
    const status = U.el('div', { class: 'set-house-msg', role: 'status' });
    const button = U.el('button', { class: 'set-btn pri', type: 'button', disabled: !V3.game.live }, '导出存档');
    const input = U.el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    const load = U.el('button', { class: 'set-btn', type: 'button', disabled: !V3.game.live, onclick: () => input.click() }, '导入存档');
    function busy(value) { button.disabled = load.disabled = value; }
    button.addEventListener('click', async () => {
      busy(true);
      status.className = 'set-house-msg busy';
      status.textContent = '正在打包存档…';
      try {
        await download();
        status.className = 'set-house-msg ok';
        status.textContent = '已生成存档，请查看浏览器下载。';
      } catch (error) {
        V3.err('cabin save: ' + error.message);
        status.className = 'set-house-msg bad';
        status.textContent = '存档导出失败，请确认浏览器存储和小屋服务可用后重试。';
      } finally { busy(false); }
    });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      busy(true);
      status.className = 'set-house-msg busy';
      status.textContent = '正在读取备份…';
      try {
        const archive = await readArchive(await file.text());
        status.className = 'set-house-msg ask';
        const source = inventory.remote ? '小屋服务' : '这个浏览器';
        status.textContent = '用「' + file.name + '」覆盖' + source + '中的小屋存档？导入完成后将重新载入。';
        if (!inventory.remote && archive.recipes.length) status.append(' 食谱会随存档保留，查看和编辑食谱请使用小屋服务。');
        const cancel = U.el('button', { type: 'button', class: 'set-btn', onclick: () => {
          status.textContent = '已取消导入。'; status.className = 'set-house-msg'; busy(false); load.focus();
        } }, '取消');
        const confirm = U.el('button', { type: 'button', class: 'set-btn warn go', onclick: async () => {
          confirm.disabled = cancel.disabled = true;
          status.className = 'set-house-msg busy';
          status.textContent = '正在导入存档…';
          try {
            if (inventory.remote) await restoreService(archive); else await restoreLocal(archive);
            status.textContent = '已导入存档，正在重新载入…';
            location.reload();
          } catch (e) {
            status.textContent = '导入失败：' + e.message; status.className = 'set-house-msg bad'; busy(false);
          }
        } }, '确认覆盖');
        status.append(U.el('div', { class: 'set-house-btns' }, confirm, cancel));
        cancel.focus();
      } catch (e) { status.className = 'set-house-msg bad'; status.textContent = '导入失败：' + e.message; busy(false); }
    });
    return U.el('div', null, U.el('div', { class: 'set-house-btns' }, button, load), input, status);
  }

  V3.game.SCHEMA.push({ key: 'cabinSave', group: '存档', type: 'custom', render });
})(window.V3);
