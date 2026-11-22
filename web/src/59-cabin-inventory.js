// 59-cabin-inventory.js — 小屋收藏存档客户端（V3.cabinInventory）。规则在 58-inventory-rules.js（v2）。
// 两种后端，接口完全一样（perform(op) / refresh() / data / ready / exportData / restore）：
//   · 本机小屋服务（remote）：页面由本机服务注入 cabin-bridge.js 时，服务端 /api/cabin/inventory 是唯一真相；
//   · 浏览器本地（local）：离线成品 / 没有服务的时候，存档在 localStorage「v3.inventory」，每个操作用同一份规则就地算完。
// 旧版服务端（只认 v1 存档）：读回来的存档按规则升级成 v2 再给页面用；collect 照 v1 的格式发（不带尺寸 / 花纹，那一枚的
// 尺寸 / 花纹由 uid 固定推出来）；卖、买、吃、沙盘这些 v2 操作直接告诉玩家「小屋服务还没升级」，不会发出去。
(function (V3) {
  'use strict';
  const PATH = '/api/cabin/inventory', LOCAL_KEY = 'v3.inventory', SEEN_KEEP = 400;
  const V2_OPS = new Set(['sell', 'buy', 'consume', 'tray_set', 'chime_set']);
  const id = (prefix) => prefix + '-' + (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const remote = () => window.__CABIN_LOCAL_INVENTORY === true ||
    !!(location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname) &&
       document.querySelector('script[src="/cabin-bridge.js"]'));
  const rules = () => V3.inventoryRules;
  // 目录：贝壳 + 潮汐拾物 + 垃圾 + 零食（规则拿它算尺寸区间、卖价、零食价格）
  function catalog() {
    const W = V3.washupCatalog, S = V3.snackCatalog;
    const kinds = [].concat((V3.shells && V3.shells.KINDS) || [], W ? W.collectibles : [], W ? W.trash : [], W?.seeds || []);
    return rules().catalogFrom(kinds, S && S.list ? S.list : []);
  }
  const client = V3.cabinInventory = {
    enabled: false, ready: false, data: null, error: '', id,
    // use(): 这一页的收藏交给存档客户端管（实时页面都是）；remote: 有没有本机小屋服务；serverV1: 服务端还是旧版存档
    use: () => true, remote: false, serverV1: false, catalog,
  };
  const messages = {
    chime_changed: '另一页刚改过这串风铃，请按最新的样子重新选择',
    pot_empty: '花盆里还没有种子', pot_busy: '花盆里已经种了一棵', no_seed: '手里没有这种种子了',
    not_ready: '还没到收种的时候', day_changed: '小屋已经换日，请重新浇水',
    tank_too_small:'小海豚只能住在潮湾超级大缸里',
    shift_changed: '潮班已换，请领取洞口的当班礼物', shore_changed: '另一页刚改过，请重新选择',
    shell_unsuitable: '它找不到钻进去的壳口', fish_gone: '这尾鱼已经游走了', tank_full: '缸里的空格不够这尾鱼住', tank_berth: '落地缸需要门廊的位置',
    revision_mismatch: '另一个页面刚修改了存档，请刷新后再试',
    inventory_not_empty: '已有收藏，未覆盖现有存档',
    slot_occupied: '这个位置已经摆了东西', out_of_stock: '柜子里没有可摆出的这一种',
    placement_changed: '这个位置的摆件已经变了', slot_empty: '这个位置已经收空了',
    return_not_due: '还没到收回的时候', inventory_corrupt: '小屋存档读不了，原文件没有改动',
    inventory_unavailable: '小屋存档暂时不可用', inventory_capacity: '小屋存档达到容量上限，先导出备份',
    invalid_input: '存档内容格式不对，原收藏没有改动',
    in_use: '这一枚正摆在别处', not_owned: '这一枚已经不在收藏里了', not_enough_coins: '贝币不够',
    unknown_item: '小店里没有这样东西', snack_gone: '这份零食已经吃完了', tray_changed: '展示盒刚被改过，请再试一次',
    id_reused: '这个操作和之前的冲突了', inventory_limit: '收藏太多，放不下了',
  };
  const OLD_SERVER = '小屋服务还是旧版存档，这个功能要等它升级（见 docs/INVENTORY-V2.md）';
  let boot, refreshJob, legacyFound, migrationDone = false, retryTimer;
  function publish() { V3.emit('inventory:status', client); }
  function fail(code, status) { const e = new Error(messages[code] || code || '小屋存档暂不可用'); e.status = status; e.code = code; return e; }

  // 服务端回来的存档：旧版（没有 coins）按规则升级成 v2 再交给页面
  function normalize(json) {
    if (!json || json.ok !== true || !Number.isSafeInteger(json.rev) || json.rev < 0 ||
        !json.inventory || !json.inventory.found || !json.inventory.placements) throw new Error('小屋存档响应不完整');
    const R = rules();
    if (R.isV1(json.inventory)) {
      client.serverV1 = true;
      try { json = { ...json, inventory: R.parseInventory(json.inventory, { catalog: catalog(), allowMissingPlacementId: true }) }; }
      catch (e) { throw new Error('小屋存档响应格式不对'); }
    } else client.serverV1 = false;
    return json;
  }
  function apply(json) {
    json = normalize(json);
    if (!client.data || json.rev > client.data.rev) {
      client.data = json;
      V3.emit('inventory:change', json);
    }
    return json;
  }

  // ---- 本机服务 ----
  // 旧版服务端只认 v1 的字段：collect 去掉尺寸 / 花纹，摆放去掉 uid
  function forV1(op) {
    if (!op || !client.serverV1) return op;
    if (V2_OPS.has(op.op)) throw fail('old_server', 0);
    if (op.op === 'collect' || op.op === 'place') { const { size, pat, uid, ...rest } = op; return rest; }
    return op;
  }
  async function requestRemote(op) {
    op = forV1(op);
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
        err.status = res.status; err.code = code;
        throw err;
      }
      return apply(json);
    } finally { clearTimeout(timeout); }
  }

  // ---- 浏览器本地：读 → 规则 → 写，全在一个同步段里（同一浏览器的别的标签页靠 storage 事件跟上） ----
  function localLoad() {
    const R = rules();
    let raw = null;
    try { raw = localStorage.getItem(LOCAL_KEY); } catch (e) { throw fail('inventory_unavailable', 503); }
    if (raw == null) return R.freshState();
    try { return R.parseState(JSON.parse(raw), { catalog: catalog() }); }
    catch (e) { throw fail('inventory_corrupt', 503); }
  }
  function localSave(s) {
    const keys = Object.keys(s.seen);   // 本地只为重试去重，留最近的一批 id 就够
    if (keys.length > SEEN_KEEP) for (const k of keys.slice(0, keys.length - SEEN_KEEP)) delete s.seen[k];
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); } catch (e) { throw fail('inventory_capacity', 507); }
  }
  const snapshot = (s) => ({ ok: true, initialized: s.initialized, rev: s.rev, inventory: s.inventory });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function requestLocal(op) {
    const R = rules(), cat = catalog();
    const s = localLoad();
    if (!op) return Promise.resolve(apply(clone(snapshot(s))));
    try {
      const cmd = R.parseCommand(op, { catalog: cat });
      const hash = R.hash01(JSON.stringify(cmd.op === 'collect' ? { ...cmd, at: 0 } : cmd)).toString(36);
      if (Object.prototype.hasOwnProperty.call(s.seen, cmd.id)) {
        if (s.seen[cmd.id] !== hash) throw new R.InventoryError(409, 'id_reused');
        return Promise.resolve({ ...apply(clone(snapshot(s))), applied: false });
      }
      const result = R.apply(s, cmd, { catalog: cat });
      if (result === false) return Promise.resolve({ ...apply(clone(snapshot(s))), applied: false });
      s.seen[cmd.id] = hash; s.rev++;
      localSave(s);
      return Promise.resolve({ ...apply(clone(snapshot(s))), applied: true, ...result });
    } catch (e) {
      if (e instanceof R.InventoryError) return Promise.reject(fail(e.code, e.status));
      return Promise.reject(e);
    }
  }
  let lockDatabase;
  function locked(work) {
    if (globalThis.navigator?.locks?.request) return navigator.locks.request(LOCAL_KEY, work);
    if (!window.indexedDB) return work();
    lockDatabase ||= new Promise((resolve, reject) => {
      const opening = window.indexedDB.open(LOCAL_KEY + '.locks', 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('writers');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(fail('inventory_unavailable', 503));
    }).catch(error => { lockDatabase = null; throw error; });
    return lockDatabase.then(database => new Promise((resolve, reject) => {
      const transaction = database.transaction('writers', 'readwrite');
      transaction.onabort = () => reject(fail('inventory_unavailable', 503));
      transaction.objectStore('writers').get(0).onsuccess = () => { try { resolve(work()); } catch (error) { reject(error); } };
    }));
  }
  const request = (op) => client.remote ? requestRemote(op) : op ? locked(() => requestLocal(op)) : requestLocal();

  function recover() {
    if (!client.remote) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (!(V3.backgroundPaused?.() ?? document.hidden)) client.refresh(); else recover(); }, 12000);
    if (retryTimer && retryTimer.unref) retryTimer.unref();   // Node 测试里不让这个定时器拖住进程（浏览器里是数字，没这个方法）
  }
  function failed(e) {
    client.error = e && (e.status || e.code || e.name !== 'AbortError' && !(e instanceof TypeError)) && e.message || '连不上小屋存档，请稍后再试';
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
          // 同一个 id 跨标签页、跨重试都一样；一个浏览器的旧档只导入一次，空档不导入
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
    client.remote = remote();
    legacyFound = found || {};
    document.addEventListener('visibilitychange', () => { if (!document.hidden) client.refresh(); });
    addEventListener('focus', () => client.refresh());
    if (!client.remote) addEventListener('storage', (e) => { if (e.key === LOCAL_KEY) client.refresh(); });
    boot = client.refresh();
    return boot;
  };
  client.perform = async (op) => {
    if (!client.ready) return { ok: false, error: client.error || '小屋存档还在加载' };
    if (op.op === 'chime_set' && !client.canChime()) return { ok: false, error: OLD_SERVER, code: 'old_server' };
    if ((op.op.startsWith('garden_') || op.op === 'collect' && op.category === 'seed') && !client.canGarden()) return { ok: false, error: OLD_SERVER, code: 'old_server' };
    if (op.op.startsWith('shore_') && !client.canShore()) return { ok: false, error: OLD_SERVER, code: 'old_server' };
    if (client.remote && ['shore_upgrade','shore_catch'].includes(op.op) && client.data?.inventory?.shore?.tankTier === undefined) return { ok:false,error:OLD_SERVER,code:'old_server' };
    if (client.remote && (op.op==='shore_visit' || op.op==='shore_fish' && op.action==='release') && !client.data?.inventory?.shore?.released) return {ok:false,error:OLD_SERVER,code:'old_server'};
    if (client.serverV1 && V2_OPS.has(op.op)) return { ok: false, error: OLD_SERVER, code: 'old_server', status: 0 };
    try {
      let json;
      try { json = await request(op); }
      catch (e) {
        if (!client.remote || e.status && e.status < 500) throw e;
        json = await request(op); // 只用同一个操作 id 重试
      }
      client.error = '';
      publish();
      if (op.op === 'chime_set' && json.applied) {
        const own = new Map();
        for (const [kind, f] of Object.entries(json.inventory.found)) for (const it of f.items) own.set(it.uid, V3.game?.kind(kind)?.name || kind);
        const strands = json.inventory.chimes[op.slot].strands.map(row => row.map(b => own.get(b.uid)));
        const count = strands.flat().length, name = rules().CHIME_SLOTS[op.slot].name, who = op.by === 'girl' ? '她' : '你';
        V3.emit('game:cabin-event', { type: op.op, id: op.id, at: Date.now(), text: count ? `${who}用${count}枚藏品重新串好了${name}` : `${who}取下了${name}上的藏品`,
          detail: { slot: op.slot, by: op.by, strands, count, ...(op.via ? { via: op.via } : {}) } });
      }
      return json;
    } catch (e) {
      const error = failed(e);
      if (e.status === 409) client.refresh();
      return { ok: false, error, code: e.code, status: e.status || 0 };
    }
  };
  // 测试 / 截图用（?view=found=…）：浏览器本地存档直接换成给定的 found（摆件、展示盒清空）；本机服务上什么也不做
  client.devFound = async (found) => {
    if (client.remote || !client.enabled) return false;
    await boot;
    return locked(() => {
      const R = rules(), s = localLoad();
      s.inventory = R.parseInventory({ ...s.inventory, found, placements: {}, chimes: R.emptyChimes(), shore: { ...s.inventory.shore, loan: null }, tray: { rev: s.inventory.tray.rev + 1, items: [] } }, { catalog: catalog() });
      s.initialized = true; s.rev++; localSave(s); apply(clone(snapshot(s))); return true;
    });
  };
  // 测试 / 截图用：浏览器本地存档里直接加贝币（本机服务上什么也不做）
  client.devCoins = async (n) => {
    if (client.remote || !client.enabled || !(n > 0)) return false;
    await boot;
    return locked(() => {
      const s = localLoad(); s.inventory.coins += Math.round(n); s.rev++;
      localSave(s); apply(clone(snapshot(s))); return true;
    });
  };
  // 一种贝壳现在能用的那几枚（没摆出去、没放进沙盘）
  client.canShore = () => client.ready && !client.serverV1 && !!client.data?.inventory?.shore;
  client.canChime = () => client.ready && !client.serverV1 && !!client.data?.inventory?.chimes;
  client.setChime = (slot, design, by = 'player', via) => client.perform({ op: 'chime_set', id: id('chime'), slot, base: design.rev,
    bar: design.bar, strands: design.strands, by, ...(via === undefined ? {} : { via }) });
  client.canGarden = () => client.ready && !client.serverV1 && !!client.data?.inventory?.garden;
  client.available = (kind) => client.data ? rules().available(client.data.inventory, kind) : [];
  client.used = () => client.data ? rules().usedUids(client.data.inventory) : new Set();
  client.exportData = () => client.ready && client.data ? rules().exportData(client.data.inventory) : null;
  // 旧版服务端只收 v1 的备份：把 v2 收藏压回「每种几枚」
  function toV1(inv) {
    const found = {};
    for (const [k, f] of Object.entries(inv.found)) if (f.n > 0) found[k] = { n: f.n, first: f.first, last: f.last };
    const placements = {};
    for (const [slot, p] of Object.entries(inv.placements)) {
      placements[slot] = { kind: p.kind, placedAt: p.placedAt, by: p.by, ...(p.returnAt !== undefined ? { returnAt: p.returnAt } : {}) };
    }
    return { found, placements, trash: inv.trash, cleaned: inv.cleaned };
  }
  client.restore = (backup) => {
    if (!rules().isBackup(backup) || !client.data) return Promise.resolve({ ok: false, error: '不是小屋收藏备份' });
    let inventory = backup.inventory;
    if (client.remote && !client.canChime() && inventory.chimes) {
      if (Object.values(inventory.chimes).some(c => c?.strands?.some(row => row.length))) return Promise.resolve({ ok: false, error: OLD_SERVER, code: 'old_server' });
      const { chimes, ...older } = inventory; inventory = older;
    }
    if (client.remote && !client.canGarden() && inventory.garden) {
      const { garden, ...older } = inventory;
      if (garden.pot || garden.zone || garden.seen?.length || Object.keys(garden.seeds || {}).length || Object.keys(garden.bloomed || {}).length) return Promise.resolve({ ok: false, error: OLD_SERVER, code: 'old_server' });
      inventory = older;
    }
    if (client.remote && inventory.shore?.released && !client.data.inventory.shore?.released) {
      if (inventory.shore.released.length) return Promise.resolve({ok:false,error:OLD_SERVER,code:'old_server'});
      const { released:unused, ...shore }=inventory.shore; inventory={...inventory,shore};
    }
    if (client.remote && !client.canShore() && inventory.shore) {
      const shore = inventory.shore;
      if (shore.tankTier || shore.gift || shore.loan || shore.memory || shore.berth || shore.observed?.length || shore.fish?.length) return Promise.resolve({ ok: false, error: OLD_SERVER, code: 'old_server' });
      const { shore: unused, ...oldInventory } = inventory; inventory = oldInventory;
    }
    if (client.serverV1 && !rules().isV1(inventory)) inventory = toV1(inventory);
    return client.perform({ op: 'restore', id: id('restore'), rev: client.data.rev, inventory });
  };
})(window.V3);
