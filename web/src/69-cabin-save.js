// The connected cabin exports the service's snapshot. A standalone page exports its local save.
(function (V3) {
  'use strict';
  const { util: U, cabinInventory: inventory } = V3;
  const saveKey = /^(v3\.|v4-furniture-play:|cabin\.snack\.|cabin\.routine\.|cabinGallery\.)/;

  function browserStorage() {
    const entries = new Map();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && saveKey.test(key)) entries.set(key, localStorage.getItem(key));
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
    const [saved, house, models, texturePack] = await Promise.all([
      inventory.localBackup(),
      ...browserRecords,
    ]);
    return { inventory: saved, recipes: [], browser: { localStorage: storage, house: house ?? null, models, texturePack: texturePack ?? null } };
  }

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
    button.addEventListener('click', async () => {
      button.disabled = true;
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
      } finally { button.disabled = false; }
    });
    return U.el('div', null, button, status);
  }

  V3.game.SCHEMA.push({ key: 'cabinSave', group: '存档', type: 'custom', render });
})(window.V3);
