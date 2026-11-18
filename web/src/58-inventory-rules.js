// 58-inventory-rules.js — 小屋收藏存档的规则（v2）。纯数据、纯函数：不碰 DOM、THREE、localStorage、网络。
// 两处共用同一份规则：
//   · 页面（V3.inventoryRules）：59-cabin-inventory 的本地存档（离线成品）直接用它算每一个操作；
//   · 本机小屋服务：build.mjs 另外产出 dist/inventory-rules.mjs，服务端 import 后只负责 rev / 幂等 / 落盘（见 docs/INVENTORY-V2.md）。
// 存档 inventory（v2）：
//   found[kind]  = { n, first, last, items: [{ uid, size, pat, at }] }   n === items.length；n 可以是 0（见过、但都卖掉了：图鉴仍算找到）
//                  size = 最长边（毫米，一位小数），pat = 花纹 id（PATTERNS）
//   placements[slot] = { id, kind, uid, placedAt, by, returnAt? }        摆件：具体哪一枚
//   trash, cleaned  垃圾：待清理 / 已清理件数
//   coins           贝币（清理垃圾、卖贝壳得到；买零食花掉）
//   snacks          [{ uid, sku, left, at }]                               一件 = 一盒 / 一袋 / 一杯（瓶），left = 还剩几份 / 几口
//   tray            { rev, items: [{ uid, x, z, ry, flip }] }              沙盘展示盒：厘米，原点在沙盘中心（内框 TRAY.w × TRAY.d）
// 王冠不存盘：按尺寸在本种区间里的位置算（crown）。区间以后调了，王冠跟着变。
(function (root) {
  'use strict';
  const VERSION = 2;
  const FORMAT = 'cabin-inventory-v2', FORMAT_V1 = 'cabin-inventory-v1';
  const MAX_KINDS = 128, MAX_SLOTS = 128, MAX_ITEMS = 20000, MAX_SNACKS = 500, MAX_QTY = 20;
  const MAX_COUNT = 1_000_000_000, MAX_TIME = 253_402_300_799_999, MAX_REV = MAX_COUNT;   // 服务端自己的 id 账本另有上限
  const TRAY = Object.freeze({ w: 90, d: 60, max: 80 });            // 沙盘内框（厘米）和最多摆几枚
  const SIZE_SPAN = [0.7, 1.3];                                       // 默认尺寸区间 = 标准尺寸 × 这个范围
  const CROWN = 0.05;                                                 // 落在区间两端 5% 内 → 王冠
  const PRICE = Object.freeze({ common: 1, uncommon: 3, rare: 5 });  // 卖一枚贝壳得几个贝币（按稀有度）
  const TRASH_COIN = 1;                                               // 清理一件垃圾得几个贝币
  // 花纹：w = 冲上岸时的权重（合计 100）；rare = 稀有花纹（界面上特别标出）。具体怎么上色在 30-shell-variants.js
  const PATTERNS = Object.freeze([
    { id: 'plain', name: '原色', w: 70 },
    { id: 'sunset', name: '晚霞', w: 9 },
    { id: 'mist', name: '雾蓝', w: 8 },
    { id: 'ring', name: '环纹', w: 6 },
    { id: 'dots', name: '斑点', w: 4 },
    { id: 'albino', name: '白化', w: 1.5, rare: true },
    { id: 'iris', name: '虹彩', w: 1.5, rare: true },
  ].map(Object.freeze));
  const PAT = new Map(PATTERNS.map((p) => [p.id, p]));

  const reserved = new Set(['__proto__', 'prototype', 'constructor']);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const dict = () => Object.create(null);
  const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
  const time = (v) => integer(v, 0, MAX_TIME);
  const count = (v) => integer(v, 0, MAX_COUNT);
  const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const id = (v) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:\/-]{0,159}$/.test(v) && !reserved.has(v);
  const label = (v) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(v) && !reserved.has(v);
  const actor = (v) => v === 'player' || v === 'girl';
  const round1 = (v) => Math.round(v * 10) / 10;

  class InventoryError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }
  const bad = (ok) => { if (!ok) throw new InventoryError(400, 'invalid_input'); };
  const conflict = (code) => { throw new InventoryError(409, code); };
  function shape(v, required, optional = []) {
    return record(v) && required.every((k) => own(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
  }

  // ---- 稳定的哈希（FNV-1a）→ [0, 1)：旧存档补实例、旧沙滩物件补尺寸，同一个输入永远同一个结果 ----
  function hash01(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }
  const seeded = (s) => { let i = 0; return () => hash01(s + '#' + (i++)); };

  // ---- 目录：kind(id) → { id, rarity, size(米), category, sizeRange?: [毫米, 毫米] } | null；snack(sku) → { sku, pack, count, price } | null ----
  // 规则对目录宽容：不认识的种类照样能收（尺寸只查是不是个合理的正数，卖价按常见算），新版页面配旧版服务端不会卡住。
  function catalogFrom(kinds = [], snacks = []) {
    const K = new Map(), S = new Map();
    for (const k of kinds) if (k && k.id) K.set(k.id, { id: k.id, rarity: k.rarity || 'common', size: +k.size || 0, category: k.category || 'collectible', ...(k.sizeRange ? { sizeRange: k.sizeRange } : {}) });
    for (const s of snacks) if (s && s.sku) S.set(s.sku, { sku: s.sku, pack: s.pack, count: s.count, price: s.price });
    return { kind: (x) => K.get(x) || null, snack: (x) => S.get(x) || null, kinds: () => [...K.values()], snacks: () => [...S.values()] };
  }
  const NO_CATALOG = catalogFrom();

  function sizeRange(kind) {
    if (!kind) return null;
    if (Array.isArray(kind.sizeRange)) return kind.sizeRange;
    if (!(kind.size > 0)) return null;
    return [round1(kind.size * 1000 * SIZE_SPAN[0]), round1(kind.size * 1000 * SIZE_SPAN[1])];
  }
  // 尺寸在本种区间里的位置 0..1（不认识的种类 → null）
  function sizeT(kind, mm) {
    const r = sizeRange(kind);
    return r && r[1] > r[0] ? Math.min(1, Math.max(0, (mm - r[0]) / (r[1] - r[0]))) : null;
  }
  function crown(kind, mm) {
    const t = sizeT(kind, mm);
    return t == null ? null : t >= 1 - CROWN - 1e-9 ? 'big' : t <= CROWN + 1e-9 ? 'small' : null;   // 边界算在王冠里
  }
  // 冲上岸时掷一次尺寸：70% 三角分布（偏中间）+ 30% 均匀分布 → 大 / 小金冠各约 1.9%
  function rollSize(kind, rnd) {
    const r = sizeRange(kind); if (!r) return 0;
    const t = rnd() < 0.7 ? (rnd() + rnd()) / 2 : rnd();
    return round1(r[0] + t * (r[1] - r[0]));
  }
  function rollPattern(rnd) {
    let x = rnd() * PATTERNS.reduce((a, p) => a + p.w, 0);
    for (const p of PATTERNS) { x -= p.w; if (x < 0) return p.id; }
    return PATTERNS[0].id;
  }
  // 一枚贝壳的固定属性（同一个 seed 永远一样）：旧版沙滩物件、旧版客户端发来的 collect 都用它补
  function seededTraits(kind, seed) {
    const rnd = seeded('traits:' + seed);
    return { size: rollSize(kind, rnd) || 0, pat: rollPattern(rnd) };
  }
  // v1 存档只有数量：每一枚按 (种类, 序号) 固定生成；原色、不会出王冠（t 夹在 0.06–0.94）
  function legacyItem(kind, kindId, i, at) {
    const r = sizeRange(kind), rnd = seeded('legacy:' + kindId + ':' + i);
    const t = 0.06 + 0.88 * (rnd() + rnd()) / 2;
    return { uid: 'legacy:' + kindId + ':' + i, size: r ? round1(r[0] + t * (r[1] - r[0])) : 0, pat: 'plain', at };
  }

  const SHELL_LOANS = ['moon', 'top_shell'];
  const FISH = Object.freeze({ goby: '点纹虾虎', silverside: '银线小鱼', wrasse: '青纹隆头鱼' });
  const emptyShore = () => ({ gift: null, loan: null, memory: null, berth: null, fish: [], observed: [], lastCatch: -1 });
  const empty = () => ({ found: dict(), placements: dict(), trash: 0, cleaned: 0, coins: 0, snacks: [], tray: { rev: 0, items: [] }, shore: emptyShore() });
  let zoneName, zoneFormat;
  function halfDay(at, zone) {
    if (zoneName !== zone || !zoneFormat) {
      bad(typeof zone === 'string' && zone.length > 0 && zone.length <= 64);
      try { zoneFormat = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }); }
      catch { throw new InventoryError(400, 'invalid_input'); }
      zoneName = zone;
    }
    const parts = Object.fromEntries(zoneFormat.formatToParts(at).map(part => [part.type, part.value]));
    return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}/${+parts.hour < 12 ? 'am' : 'pm'}`;
  }
  const slotKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}\/(am|pm)$/.test(value);
  const fishName = value => typeof value === 'string' && value === value.trim() && value.length <= 24 && !/[\u0000-\u001f\u007f]/.test(value);
  const encounter = at => Math.floor(at / 300000);
  const fishAt = epoch => Object.keys(FISH)[Math.floor(hash01('shallows:' + epoch) * Object.keys(FISH).length)];
  function parseShore(value, owner, used) {
    const next = emptyShore();
    if (value === undefined) return next;
    bad(shape(value, Object.keys(next)));
    if (value.gift !== null) {
      bad(shape(value.gift, ['zone', 'slot']) && slotKey(value.gift.slot)); halfDay(0, value.gift.zone);
      next.gift = { ...value.gift };
    }
    if (value.loan !== null) { bad(id(value.loan) && SHELL_LOANS.includes(owner[value.loan]) && !used.has(value.loan)); next.loan = value.loan; }
    if (value.memory !== null) {
      const memory = value.memory;
      bad(shape(memory, ['uid', 'kind', 'pat', 'size', 'at']) && id(memory.uid) && SHELL_LOANS.includes(memory.kind) && label(memory.pat) && num(memory.size, 0, 5000) && time(memory.at));
      next.memory = { ...memory };
    }
    bad(value.berth === null || id(value.berth)); next.berth = value.berth;
    bad(Array.isArray(value.observed) && value.observed.length <= Object.keys(FISH).length && value.observed.every(kind => own(FISH, kind)) && new Set(value.observed).size === value.observed.length);
    bad(integer(value.lastCatch, -1, encounter(MAX_TIME)) && Array.isArray(value.fish) && value.fish.length <= 3);
    next.observed = [...value.observed]; next.lastCatch = value.lastCatch;
    const residents = new Set();
    next.fish = value.fish.map(fish => {
      bad(shape(fish, ['uid', 'kind', 'name', 'fed']) && id(fish.uid) && !residents.has(fish.uid) && next.observed.includes(fish.kind) && fishName(fish.name) && time(fish.fed));
      residents.add(fish.uid); return { ...fish };
    });
    return next;
  }
  const isV1 = (inv) => record(inv) && !own(inv, 'coins');

  // ---- 解析 + 校验（服务端读盘、restore、本地存档读盘都走这里）。v1 的 inventory 自动升级成 v2 ----
  function parseFound(v, catalog, v1) {
    bad(record(v) && Object.keys(v).length <= MAX_KINDS);
    const out = dict(), uids = new Set();
    let total = 0;
    for (const key of Object.keys(v).sort()) {
      const row = v[key];
      bad(label(key) && record(row) && time(row.first) && time(row.last) && row.first <= row.last);
      let items;
      if (v1 || !own(row, 'items')) {
        bad(shape(row, ['n', 'first', 'last'], ['items']) && integer(row.n, 1, MAX_ITEMS));
        const k = catalog.kind(key);
        items = Array.from({ length: row.n }, (_, i) => legacyItem(k, key, i, row.n > 1 ? Math.round(row.first + (row.last - row.first) * i / (row.n - 1)) : row.first));
      } else {
        bad(shape(row, ['n', 'first', 'last', 'items']) && Array.isArray(row.items) && integer(row.n, 0, MAX_ITEMS) && row.n === row.items.length);
        items = row.items.map((it) => {
          bad(shape(it, ['uid', 'size', 'pat', 'at']) && id(it.uid) && num(it.size, 0, 5000) && label(it.pat) && time(it.at));
          return { uid: it.uid, size: it.size, pat: it.pat, at: it.at };
        });
      }
      for (const it of items) { bad(!uids.has(it.uid)); uids.add(it.uid); }
      total += items.length;
      bad(total <= MAX_ITEMS);
      out[key] = { n: items.length, first: row.first, last: row.last, items };
    }
    return out;
  }
  function parseInventory(v, opt = {}) {
    const catalog = opt.catalog || NO_CATALOG, v1 = isV1(v);
    bad(record(v) && count(v.trash) && count(v.cleaned));
    bad(v1 ? shape(v, ['found', 'placements', 'trash', 'cleaned']) : shape(v, ['found', 'placements', 'trash', 'cleaned', 'coins', 'snacks', 'tray'], ['shore']));
    const found = parseFound(v.found, catalog, v1);
    const owner = dict();
    for (const [k, f] of Object.entries(found)) for (const it of f.items) owner[it.uid] = k;
    const placements = dict(), used = new Set(), ids = new Set();
    bad(record(v.placements) && Object.keys(v.placements).length <= MAX_SLOTS);
    for (const slot of Object.keys(v.placements).sort()) {
      const row = v.placements[slot];
      const req = ['kind', 'placedAt', 'by'];
      bad(label(slot) && shape(row, opt.allowMissingPlacementId ? req : [...req, 'id'], ['id', 'returnAt', 'uid']) &&
        label(row.kind) && own(found, row.kind) && time(row.placedAt) && actor(row.by));
      let uid = row.uid;
      if (uid === undefined) uid = found[row.kind].items.map((it) => it.uid).find((u) => !used.has(u));   // v1 摆件：补上同种里第一枚没用上的
      bad(id(uid) && owner[uid] === row.kind && !used.has(uid));
      used.add(uid);
      const place = { kind: row.kind, uid, placedAt: row.placedAt, by: row.by };
      if (own(row, 'id')) { bad(id(row.id) && !ids.has(row.id)); ids.add(row.id); place.id = row.id; }
      if (own(row, 'returnAt')) { bad(time(row.returnAt)); place.returnAt = row.returnAt; }
      placements[slot] = place;
    }
    const inv = { found, placements, trash: v.trash, cleaned: v.cleaned, coins: 0, snacks: [], tray: { rev: 0, items: [] } };
    inv.shore = emptyShore();
    if (v1) return inv;
    bad(count(v.coins) && Array.isArray(v.snacks) && v.snacks.length <= MAX_SNACKS && record(v.tray));
    inv.coins = v.coins;
    const su = new Set();
    inv.snacks = v.snacks.map((s) => {
      bad(shape(s, ['uid', 'sku', 'left', 'at']) && id(s.uid) && !su.has(s.uid) && label(s.sku) && integer(s.left, 1, 1000) && time(s.at));
      su.add(s.uid);
      return { uid: s.uid, sku: s.sku, left: s.left, at: s.at };
    });
    bad(shape(v.tray, ['rev', 'items']) && integer(v.tray.rev, 0, MAX_COUNT) && Array.isArray(v.tray.items));
    inv.tray = { rev: v.tray.rev, items: parseTrayItems(v.tray.items, owner, used) };
    for (const item of inv.tray.items) used.add(item.uid);
    inv.shore = parseShore(v.shore, owner, used);
    return inv;
  }
  function parseTrayItems(list, owner, used) {
    bad(Array.isArray(list) && list.length <= TRAY.max);
    const seen = new Set();
    return list.map((t) => {
      bad(shape(t, ['uid', 'x', 'z', 'ry'], ['flip']) && id(t.uid) && !seen.has(t.uid) &&
        num(t.x, -TRAY.w / 2, TRAY.w / 2) && num(t.z, -TRAY.d / 2, TRAY.d / 2) && num(t.ry, -1000, 1000) &&
        (t.flip === undefined || typeof t.flip === 'boolean'));
      if (owner) {
        if (!owner[t.uid]) conflict('not_owned');
        if (used && used.has(t.uid)) conflict('in_use');
      }
      seen.add(t.uid);
      const r = { uid: t.uid, x: round1(t.x), z: round1(t.z), ry: Math.round(t.ry * 1000) / 1000 };
      if (t.flip) r.flip = true;
      return r;
    });
  }

  // ---- 操作 ----
  function parseCommand(v, opt = {}) {
    const catalog = opt.catalog || NO_CATALOG;
    bad(record(v) && id(v.id) && v.id.length <= 128);
    const base = ['op', 'id'], cmd = { op: v.op, id: v.id };
    switch (v.op) {
      case 'shore_gift':
        bad(shape(v, [...base, 'zone', 'slot']) && slotKey(v.slot)); halfDay(0, v.zone);
        return { ...cmd, zone: v.zone, slot: v.slot };
      case 'shore_loan':
      case 'shore_berth':
        bad(shape(v, [...base, 'next', 'expected']) && [v.next, v.expected].every(value => value === null || id(value)));
        return { ...cmd, next: v.next, expected: v.expected };
      case 'shore_catch':
        bad(shape(v, [...base, 'epoch', 'berth']) && integer(v.epoch, 0, encounter(MAX_TIME)) && (v.berth === null || id(v.berth)));
        return { ...cmd, epoch: v.epoch, berth: v.berth };
      case 'shore_fish':
        bad(shape(v, [...base, 'uid', 'action'], v.action === 'name' ? ['name'] : []) && id(v.uid) && ['name', 'feed', 'release'].includes(v.action));
        if (v.action === 'name') { bad(fishName(v.name)); cmd.name = v.name; }
        return { ...cmd, uid: v.uid, action: v.action };
      case 'collect': {
        bad(shape(v, [...base, 'kind', 'at', 'category'], ['size', 'pat']) && label(v.kind) && time(v.at) &&
          (v.category === 'collectible' || v.category === 'trash'));
        Object.assign(cmd, { kind: v.kind, at: v.at, category: v.category });
        if (v.category === 'collectible') {
          const k = catalog.kind(v.kind), t = seededTraits(k, v.id);
          let size = own(v, 'size') ? v.size : t.size, pat = own(v, 'pat') ? v.pat : t.pat;
          bad(num(size, 0, 5000) && label(pat));
          const r = sizeRange(k);
          if (r) size = Math.min(r[1], Math.max(r[0], size));             // 认识的种类：夹进区间
          cmd.size = round1(size); cmd.pat = PAT.has(pat) ? pat : 'plain';
        }
        return cmd;
      }
      case 'place':
        bad(shape(v, [...base, 'kind', 'slot', 'by'], ['returnAt', 'uid']) && label(v.kind) && label(v.slot) && actor(v.by));
        if (own(v, 'returnAt')) { bad(time(v.returnAt)); cmd.returnAt = v.returnAt; }
        if (own(v, 'uid')) { bad(id(v.uid)); cmd.uid = v.uid; }
        return { ...cmd, kind: v.kind, slot: v.slot, by: v.by };
      case 'return':
        bad(shape(v, [...base, 'slot', 'by'], ['expectedId']) && label(v.slot) && actor(v.by));
        if (v.by === 'girl' || own(v, 'expectedId')) { bad(id(v.expectedId)); cmd.expectedId = v.expectedId; }
        return { ...cmd, slot: v.slot, by: v.by };
      case 'dispose':
        bad(shape(v, base));
        return cmd;
      case 'sell':
        bad(shape(v, [...base, 'uids']) && Array.isArray(v.uids) && v.uids.length >= 1 && v.uids.length <= 200 &&
          v.uids.every(id) && new Set(v.uids).size === v.uids.length);
        return { ...cmd, uids: v.uids.slice() };
      case 'buy':
        bad(shape(v, [...base, 'sku', 'qty']) && label(v.sku) && integer(v.qty, 1, MAX_QTY));
        return { ...cmd, sku: v.sku, qty: v.qty };
      case 'consume':
        bad(shape(v, [...base, 'uid', 'by']) && id(v.uid) && actor(v.by));
        return { ...cmd, uid: v.uid, by: v.by };
      case 'tray_set':
        bad(shape(v, [...base, 'base', 'items', 'by'], ['via']) && integer(v.base, 0, MAX_COUNT) && actor(v.by) &&
          (v.via === undefined || (typeof v.via === 'string' && v.via.length <= 128)));
        if (own(v, 'via')) cmd.via = v.via;
        return { ...cmd, base: v.base, items: parseTrayItems(v.items), by: v.by };
      case 'legacy': {
        bad(shape(v, [...base, 'found']));
        const found = parseFound(v.found, catalog, true);
        return { ...cmd, found };
      }
      case 'restore':
        bad(shape(v, [...base, 'rev', 'inventory']) && integer(v.rev, 0, MAX_REV));
        return { ...cmd, rev: v.rev, inventory: parseInventory(v.inventory, { catalog, allowMissingPlacementId: true }) };
      case 'reset':
        bad(shape(v, [...base, 'rev']) && integer(v.rev, 0, MAX_REV));
        return { ...cmd, rev: v.rev };
      default:
        throw new InventoryError(400, 'invalid_input');
    }
  }

  // 正在用的贝壳（摆件 + 沙盘）：不能卖、不能再摆
  function usedUids(inv) {
    const s = new Set();
    if (inv.shore?.loan) s.add(inv.shore.loan);
    for (const p of Object.values(inv.placements)) s.add(p.uid);
    for (const t of inv.tray.items) s.add(t.uid);
    return s;
  }
  function ownerOf(inv) {
    const m = dict();
    for (const [k, f] of Object.entries(inv.found)) for (const it of f.items) m[it.uid] = k;
    return m;
  }
  function available(inv, kind) {
    const f = inv.found[kind]; if (!f) return [];
    const used = usedUids(inv);
    return f.items.filter((it) => !used.has(it.uid));
  }
  const isEmpty = (inv) => !Object.keys(inv.found).length && !Object.keys(inv.placements).length && !inv.trash && !inv.cleaned &&
    !inv.coins && !inv.snacks.length && !inv.tray.items.length && !(inv.shore?.gift || inv.shore?.memory || inv.shore?.berth || inv.shore?.observed.length);
  const priceOf = (catalog, kindId) => PRICE[(catalog.kind(kindId) || {}).rarity] || PRICE.common;

  function addFound(found, kind, items, first, last) {
    const f = found[kind];
    if (!f) {
      if (Object.keys(found).length >= MAX_KINDS) conflict('inventory_limit');
      found[kind] = { n: items.length, first, last, items: items.slice() };
      return;
    }
    if (f.n + items.length > MAX_ITEMS) conflict('inventory_limit');
    f.items.push(...items);
    f.n = f.items.length; f.first = Math.min(f.first, first); f.last = Math.max(f.last, last);
  }

  // apply(state, cmd, { clock, catalog }) → 结果对象 | false（什么也没变，例如 legacy 已经导入过）。state = { initialized, rev, inventory }；就地修改 state。
  function apply(s, cmd, opt = {}) {
    const clock = opt.clock || Date.now, catalog = opt.catalog || NO_CATALOG, inv = s.inventory;
    switch (cmd.op) {
      case 'shore_gift': {
        const shore = inv.shore, zone = shore.gift?.zone || cmd.zone, slot = halfDay(clock(), zone);
        if (cmd.slot !== slot || zone !== cmd.zone) conflict('shift_changed');
        if (shore.gift && shore.gift.slot >= slot) return false;
        if (!count(inv.coins + 1)) conflict('inventory_limit');
        shore.gift = { zone, slot }; inv.coins++; return { earned: 1 };
      }
      case 'shore_loan': {
        const shore = inv.shore;
        if (cmd.expected !== shore.loan) conflict('shore_changed');
        if (cmd.next === shore.loan) return false;
        if (cmd.next !== null) {
          const kind = ownerOf(inv)[cmd.next];
          if (!SHELL_LOANS.includes(kind)) conflict('shell_unsuitable');
          const item = available(inv, kind).find(row => row.uid === cmd.next);
          if (!item) conflict('in_use');
          if (!shore.memory) shore.memory = { kind, uid: item.uid, pat: item.pat, size: item.size, at: clock() };
        }
        shore.loan = cmd.next; return { loan: shore.loan };
      }
      case 'shore_berth': {
        if (cmd.expected !== inv.shore.berth) conflict('shore_changed');
        inv.shore.berth = cmd.next; return { berth: cmd.next };
      }
      case 'shore_catch': {
        const shore = inv.shore, epoch = encounter(clock());
        if (cmd.epoch !== epoch || epoch <= shore.lastCatch) conflict('fish_gone');
        if (cmd.berth !== null && cmd.berth !== shore.berth) conflict('shore_changed');
        if (cmd.berth !== null && shore.fish.length >= 3) conflict('tank_full');
        const kind = fishAt(epoch);
        if (cmd.berth !== null) shore.fish.push({ uid: 'fish:' + epoch, kind, name: '', fed: 0 });
        if (!shore.observed.includes(kind)) shore.observed.push(kind);
        shore.lastCatch = epoch; return { kind };
      }
      case 'shore_fish': {
        const residents = inv.shore.fish, index = residents.findIndex(fish => fish.uid === cmd.uid);
        if (index < 0) conflict('fish_gone');
        if (cmd.action === 'release') residents.splice(index, 1);
        else if (cmd.action === 'name') residents[index].name = cmd.name;
        else residents[index].fed = clock();
        return {};
      }
      case 'collect': {
        if (cmd.category === 'trash') {
          if (!count(inv.trash + 1)) conflict('inventory_limit');
          inv.trash++;
          return { kind: cmd.kind };
        }
        const owner = ownerOf(inv);
        if (owner[cmd.id]) conflict('id_reused');
        const item = { uid: cmd.id, size: cmd.size, pat: cmd.pat, at: cmd.at };
        addFound(inv.found, cmd.kind, [item], cmd.at, cmd.at);
        return { item, kind: cmd.kind, crown: crown(catalog.kind(cmd.kind), cmd.size) };
      }
      case 'place': {
        if (own(inv.placements, cmd.slot)) conflict('slot_occupied');
        if (Object.keys(inv.placements).length >= MAX_SLOTS) conflict('inventory_limit');
        const free = available(inv, cmd.kind);
        const it = cmd.uid ? free.find((x) => x.uid === cmd.uid) : free[0];
        if (!it) conflict(cmd.uid && ownerOf(inv)[cmd.uid] === cmd.kind ? 'in_use' : 'out_of_stock');
        const place = { id: cmd.id, kind: cmd.kind, uid: it.uid, placedAt: clock(), by: cmd.by };
        if (own(cmd, 'returnAt')) place.returnAt = cmd.returnAt;
        inv.placements[cmd.slot] = place;
        return { uid: it.uid };
      }
      case 'return': {
        const place = inv.placements[cmd.slot];
        if (!place) conflict('slot_empty');
        if (cmd.expectedId !== undefined && cmd.expectedId !== place.id) conflict('placement_changed');
        if (cmd.by === 'girl' && (place.returnAt === undefined || clock() < place.returnAt)) conflict('return_not_due');
        delete inv.placements[cmd.slot];
        return { uid: place.uid };
      }
      case 'dispose': {
        const disposed = inv.trash, earned = disposed * TRASH_COIN;
        if (!count(inv.cleaned + disposed) || !count(inv.coins + earned)) conflict('inventory_limit');
        // 回放一次已确认的清理时，不能把之后新捡的垃圾也清掉（幂等由调用方的 id 账本保证）
        inv.cleaned += disposed; inv.trash = 0; inv.coins += earned;
        return { disposed, earned };
      }
      case 'sell': {
        const owner = ownerOf(inv), used = usedUids(inv);
        for (const u of cmd.uids) { if (!owner[u]) conflict('not_owned'); if (used.has(u)) conflict('in_use'); }
        let earned = 0;
        const drop = new Set(cmd.uids);
        for (const u of cmd.uids) earned += priceOf(catalog, owner[u]);
        if (!count(inv.coins + earned)) conflict('inventory_limit');
        for (const k of new Set(cmd.uids.map((u) => owner[u]))) {
          const f = inv.found[k];
          f.items = f.items.filter((it) => !drop.has(it.uid)); f.n = f.items.length;   // n = 0 时保留：图鉴还记得见过
        }
        inv.coins += earned;
        return { sold: cmd.uids.length, earned };
      }
      case 'buy': {
        const sk = catalog.snack(cmd.sku);
        if (!sk || !(sk.price > 0) || !(sk.count > 0)) conflict('unknown_item');
        const cost = sk.price * cmd.qty;
        if (inv.coins < cost) conflict('not_enough_coins');
        if (inv.snacks.length + cmd.qty > MAX_SNACKS) conflict('inventory_limit');
        const at = clock(), bought = [];
        for (let i = 0; i < cmd.qty; i++) bought.push({ uid: cmd.id + ':' + i, sku: cmd.sku, left: sk.count, at });
        inv.snacks.push(...bought);
        inv.coins -= cost;
        return { cost, bought: bought.map((b) => b.uid) };
      }
      case 'consume': {
        const i = inv.snacks.findIndex((x) => x.uid === cmd.uid);
        if (i < 0) conflict('snack_gone');
        const sn = inv.snacks[i], sk = catalog.snack(sn.sku);
        sn.left--;
        let emptied = false;
        if (sn.left <= 0) {
          inv.snacks.splice(i, 1);
          // 杯 / 瓶喝完 → 空杯算一件垃圾，扔进垃圾桶再得 1 贝币
          if (sk && sk.pack === 'cup') { if (!count(inv.trash + 1)) conflict('inventory_limit'); inv.trash++; emptied = true; }
        }
        return { sku: sn.sku, left: Math.max(0, sn.left), emptied };
      }
      case 'tray_set': {
        if (cmd.base !== inv.tray.rev) conflict('tray_changed');
        const owner = ownerOf(inv), placed = new Set(Object.values(inv.placements).map((p) => p.uid));
        if (inv.shore?.loan) placed.add(inv.shore.loan);
        for (const t of cmd.items) { if (!owner[t.uid]) conflict('not_owned'); if (placed.has(t.uid)) conflict('in_use'); }
        inv.tray = { rev: inv.tray.rev + 1, items: cmd.items.map((t) => ({ ...t })) };
        return { trayRev: inv.tray.rev };
      }
      case 'legacy':
        if (s.initialized || !Object.keys(cmd.found).length) return false;
        for (const [k, row] of Object.entries(cmd.found)) {
          // 旧浏览器档按种类计数；uid 已存在（同一份旧档导入第二次）就跳过
          const have = new Set((inv.found[k] ? inv.found[k].items : []).map((it) => it.uid));
          const items = row.items.filter((it) => !have.has(it.uid));
          if (items.length) addFound(inv.found, k, items, row.first, row.last);
        }
        s.initialized = true;
        return {};
      case 'restore':
        if (cmd.rev !== s.rev) conflict('revision_mismatch');
        if (!isEmpty(inv)) conflict('inventory_not_empty');
        // 还在路上的旧回调不能对上恢复出来的摆件
        for (const [slot, place] of Object.entries(cmd.inventory.placements)) place.id = 'restored/' + cmd.id.slice(0, 80) + '/' + slot;
        s.inventory = cmd.inventory;
        s.initialized = true;
        return {};
      case 'reset':
        if (cmd.rev !== s.rev) conflict('revision_mismatch');
        s.inventory = empty();
        s.initialized = true;
        return {};
    }
    throw new InventoryError(400, 'invalid_input');
  }

  // 一份完整存档文件（服务端 / 本地）：{ v, initialized, rev, inventory, seen }；v1 文件读进来就升级
  function parseState(v, opt = {}) {
    bad(record(v) && (v.v === 1 || v.v === VERSION) && typeof v.initialized === 'boolean' && integer(v.rev, 0, MAX_REV) && record(v.seen));
    const seen = dict();
    for (const k of Object.keys(v.seen)) { bad(id(k) && typeof v.seen[k] === 'string' && v.seen[k].length <= 128); seen[k] = v.seen[k]; }
    return { v: VERSION, initialized: v.initialized, rev: v.rev, inventory: parseInventory(v.inventory, opt), seen };
  }
  const freshState = () => ({ v: VERSION, initialized: false, rev: 0, inventory: empty(), seen: dict() });

  // 导出 / 导入的备份
  const exportData = (inv) => ({ format: FORMAT, inventory: inv });
  const isBackup = (b) => record(b) && (b.format === FORMAT || b.format === FORMAT_V1) && record(b.inventory);

  const R = {
    VERSION, FORMAT, FORMAT_V1, TRAY, PATTERNS, PRICE, TRASH_COIN, CROWN, SIZE_SPAN, SHELL_LOANS, FISH, halfDay, encounter, fishAt,
    InventoryError, hash01, seeded, catalogFrom, sizeRange, sizeT, crown, rollSize, rollPattern, seededTraits, legacyItem,
    pattern: (p) => PAT.get(p) || PAT.get('plain'),
    empty, isV1, parseInventory, parseCommand, apply, parseState, freshState, usedUids, available, isEmpty, priceOf,
    exportData, isBackup,
  };
  if (root.V3) root.V3.inventoryRules = R;
  root.__cabinInventoryRules = R;
})(typeof window !== 'undefined' ? window : globalThis);
