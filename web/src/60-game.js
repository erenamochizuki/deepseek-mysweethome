// 60-game.js — V3.store (localStorage save) + V3.game: settings, beach state, wash-up timer, collect, events,
// test tokens. Pure data + events, no rendering (docs/SPEC-4.md §3). Other modules listen to 'game:*'.
(function (V3) {
  'use strict';
  const U = V3.util;
  const KEY = 'game', HOST_KEY = 'cabinGame', VER = 1;
  const I = V3.cabinInventory;
  const R = () => V3.inventoryRules;

  // ---- V3.store: localStorage with a 'v3.' prefix; writes only while live ----
  const store = V3.store = {
    live: false,
    get(k, def) { try { const s = localStorage.getItem('v3.' + k); return s == null ? def : JSON.parse(s); } catch (e) { return def; } },
    set(k, v) {
      if (!store.live) return false;
      try { localStorage.setItem('v3.' + k, JSON.stringify(v)); return true; } catch (e) { V3.err('store.set ' + k + ': ' + e.message); return false; }
    },
  };

  // ---- settings: flat object S, described by SCHEMA (the settings panel is generated from it) ----
  // extra fields: def (default), fmt 'pct' (show value × 100 %), action (button → G.action(key)), confirm (ask first)
  const SCHEMA = [
    { key: 'washMin', label: '冲上岸间隔·最短', type: 'range', min: 0.5, max: 60, step: 0.5, unit: '分钟', group: '海边', def: 7 },
    { key: 'washMax', label: '冲上岸间隔·最长', type: 'range', min: 0.5, max: 60, step: 0.5, unit: '分钟', group: '海边', def: 8 },
    { key: 'washChance', label: '每次触发真的有东西的概率', type: 'range', min: 0, max: 1, step: 0.05, fmt: 'pct', group: '海边', def: 0.5 },
    { key: 'perMin', label: '每次冲上来·最少', type: 'range', min: 1, max: 6, step: 1, unit: '个', group: '海边', def: 1 },
    { key: 'perMax', label: '每次冲上来·最多', type: 'range', min: 1, max: 6, step: 1, unit: '个', group: '海边', def: 2 },
    { key: 'maxBeach', label: '沙滩上最多', type: 'range', min: 1, max: 20, step: 1, unit: '个', group: '海边', def: 8 },
    { key: 'wCommon', label: '常见的权重', type: 'range', min: 0, max: 100, step: 1, group: '海边', def: 70 },
    { key: 'wUncommon', label: '少见的权重', type: 'range', min: 0, max: 100, step: 1, group: '海边', def: 25 },
    { key: 'wRare', label: '稀有的权重', type: 'range', min: 0, max: 100, step: 1, group: '海边', def: 5 },
    { key: 'wUltra', label: '超稀有的权重', type: 'range', min: 0, max: 100, step: 1, group: '海边', def: V3.cabinTide?.defaultUltraWeight ?? 1,
      hint: '和其他稀有度一起按权重抽取，不计垃圾。设为 0 就不会冲上超稀有宝物。宝藏螺不限天气，其余四件只在对应天气出现。' },
    { key: 'girlAuto', label: '小鲸鱼自己去收拾沙滩', type: 'toggle', group: '海边', def: true },
    { key: 'girlMin', label: '沙滩上有东西后多久开始收拾·最短', type: 'range', min: 5, max: 600, step: 5, unit: '秒', group: '海边', def: 30, hint: '从最早冲上来的那一件算起；时间到了她一口气把沙滩上的都捡完。留一点时间给你自己点' },
    { key: 'girlMax', label: '沙滩上有东西后多久开始收拾·最长', type: 'range', min: 5, max: 600, step: 5, unit: '秒', group: '海边', def: 90 },
    // 她自己吃零食（2026-11-18）：游戏每 60 秒检查一次；有零食、她闲着、不在午饭时段、离上次够久才考虑，再按概率决定。
    { key: 'snackAuto', label: '她会自己去零食篮找零食吃', type: 'toggle', group: '零食', def: true },
    { key: 'snackCheckMin', label: '多久检查一次', type: 'range', min: 1, max: 30, step: 1, unit: '分钟', group: '零食', def: 5,
      hint: '每隔这么久看她要不要去零食篮吃一份；调大更省，调小她反应更快' },
    { key: 'snackChance', label: '每次检查真去吃的概率', type: 'range', min: 0, max: 1, step: 0.05, fmt: 'pct', group: '零食', def: 0.35,
      hint: '按上面的间隔检查；0% = 只在你喂的时候吃，100% = 只要条件满足就去' },
    { key: 'snackMinGap', label: '两次自己吃·最短间隔', type: 'range', min: 5, max: 240, step: 5, unit: '分钟', group: '零食', def: 30 },
    { key: 'snackMaxGap', label: '两次自己吃·最长间隔', type: 'range', min: 5, max: 480, step: 5, unit: '分钟', group: '零食', def: 60,
      hint: '每次她自己去吃完，会在最短与最长之间随机挑一个下次的间隔' },
    { key: 'snackDailyMax', label: '每天自己吃·最多', type: 'range', min: 1, max: 12, step: 1, unit: '次', group: '零食', def: 4 },
    // 她闲着时自己找事做（看书 / 看电视 / 翻相册 / 看海 / 看星星）每次做多久（2026-11-18）。
    { key: 'leisureMin', label: '自己找事做·最短时长', type: 'range', min: 0.5, max: 30, step: 0.5, unit: '分钟', group: '消遣', def: 1,
      hint: '她闲着时自己看书 / 看电视 / 翻相册 / 看海 / 看星星，每次在这两个值之间随机取一个时长；以前看书只有 15 秒左右' },
    { key: 'leisureMax', label: '自己找事做·最长时长', type: 'range', min: 0.5, max: 30, step: 0.5, unit: '分钟', group: '消遣', def: 5 },
    { key: 'washNow', label: '现在就冲一波', type: 'button', group: '海边', action: 'washNow' },
    { key: 'reset', label: '清空收集', type: 'button', group: '海边', action: 'reset', confirm: '确定清空所有收集吗？设置不会变。' },
    { key: 'mcTextureMode', label: '纹理模式', type: 'select', group: '房子', def: 'builtin',
      options: [['builtin', '默认内置纹理'], ['instance', '跟随关联 MC 纹理包']],
      hint: '关联实例后读取其已启用资源包；单张贴图找不到或读不出来，就用原来的材质。' },
    // select: options [[id, label], …]; the cabin page forwards it to V3.setState('weather', v)
    { key: 'weather', label: '天气', type: 'select', group: '天气', def: 'real', hint: '实时天气按济宁的真实天气变化（需要联网）',
      options: (V3.scene && V3.scene.WEATHERS) || [['real', '实时天气'], ['clear', '晴'], ['cloudy', '多云'], ['overcast', '阴'], ['fog', '雾'], ['drizzle', '小雨'], ['rain', '大雨'], ['storm', '雷雨'], ['snow', '雪']] },
  ];
  const PAIRS = { washMin: 'washMax', washMax: 'washMin', perMin: 'perMax', perMax: 'perMin', girlMin: 'girlMax', girlMax: 'girlMin', snackMinGap: 'snackMaxGap', snackMaxGap: 'snackMinGap', leisureMin: 'leisureMax', leisureMax: 'leisureMin' };
  const defaults = () => { const s = {}; for (const f of SCHEMA) if (f.type !== 'button') s[f.key] = f.def; return s; };
  const fresh = () => ({ beach: [], found: {}, nextWash: 0, seq: 0, firstDone: false, stats: { washes: 0, hits: 0, misses: 0 } });
  const field = (k) => SCHEMA.find(f => f.key === k && f.type !== 'button');
  const norm = (f, v) => {
    if (f.type === 'toggle') return !!v;
    if (f.type === 'select') return f.options.some(o => o[0] === v) ? v : f.def;
    v = Number(v); if (!Number.isFinite(v)) v = f.def;
    v = U.clamp(v, f.min, f.max);
    return f.step ? Math.round(v / f.step) * f.step : v;
  };

  const seed = U.qs('seed', '');
  const rnd = seed !== '' ? U.rng(Number(seed) || 1) : Math.random;
  const claims = new Map();   // item id → who (not saved)
  const collecting = new Map();
  let timer = 0, saveT = 0;

  // hosted：收藏交给 V3.cabinInventory 管（实时页面都是：有本机小屋服务就存服务端，没有就存浏览器本地）。
  // 不是 hosted 的只有 start({ live: false })（测试 / 截图工具）：收藏只在内存里
  const G = V3.game = { SCHEMA, S: defaults(), st: fresh(), live: false, started: false, auto: true, hosted: false, rnd };
  const classicKinds = () => (V3.shells && V3.shells.KINDS) || [];
  const trashKinds = () => G.hosted && V3.washupCatalog ? V3.washupCatalog.trash : [];
  G.kinds = () => G.hosted && V3.washupCatalog ? classicKinds().concat(V3.washupCatalog.collectibles) : classicKinds();
  G.kind = (id) => G.kinds().find(k => k.id === id) || trashKinds().find(k => k.id === id) || null;
  G.inventory = () => G.hosted && I.data ? I.data.inventory : null;
  V3.on('inventory:change', (snapshot) => {
    if (!G.hosted) return;
    G.st.found = snapshot.inventory.found;
    V3.emit('game:inventory', snapshot.inventory);
  });

  const flush = () => {
    clearTimeout(saveT); saveT = 0;
    if (!G.hosted) return store.set(KEY, { v: VER, S: G.S, st: G.st });
    const { found, ...beachState } = G.st;
    return store.set(HOST_KEY, { v: VER, S: G.S, st: beachState });
  };
  const save = () => { if (!G.live) return; clearTimeout(saveT); saveT = setTimeout(flush, 300); };
  G.save = save;

  G.get = (k) => G.S[k];
  G.set = (k, v) => {
    const f = field(k); if (!f) return undefined;
    const S = G.S; S[k] = norm(f, v);
    const o = PAIRS[k];   // keep min ≤ max: moving one end pushes the other
    if (o) { const lo = /Min$/.test(k); if (lo ? S[k] > S[o] : S[k] < S[o]) S[o] = S[k]; }
    if ((k === 'washMin' || k === 'washMax') && G.live && G.st.nextWash) schedule(Date.now());
    save(); V3.emit('game:settings', { key: k, value: S[k] });
    return S[k];
  };
  G.action = (k) => k === 'washNow' ? G.washNow() : k === 'reset' ? G.reset() : null;

  // ---- spawning: rarity tier by weight, then a uniform kind inside the tier ----
  const pickKind = () => {
    const ks = G.kinds(); if (!ks.length) return null;
    const S = G.S, w = { common: S.wCommon, uncommon: S.wUncommon, rare: S.wRare };
    const tiers = ['common', 'uncommon', 'rare'].filter(t => w[t] > 0 && ks.some(k => k.rarity === t));
    if (!tiers.length) return ks[Math.floor(rnd() * ks.length)];
    let r = rnd() * tiers.reduce((a, t) => a + w[t], 0), tier = tiers[tiers.length - 1];
    for (const t of tiers) { r -= w[t]; if (r < 0) { tier = t; break; } }
    const pool = ks.filter(k => k.rarity === tier);
    return pool[Math.floor(rnd() * pool.length)];
  };
  const spotFallback = () => {   // used until V3.beachItems.spot exists: wet band between tide line and shore
    const T = V3.terrain;
    for (let i = 0; i < 16; i++) {
      const x = -20 + rnd() * 40;
      const z0 = T && T.tideZ ? T.tideZ(x) : 8, z1 = T && T.shoreZ ? T.shoreZ(x) : 12;
      const z = U.lerp(Math.min(z0, z1), Math.max(z0, z1), 0.15 + 0.7 * rnd());
      if (G.st.beach.every(b => Math.hypot(b.x - x, b.z - z) >= 1)) return { x, z, ry: rnd() * Math.PI * 2 };
    }
    return null;
  };
  const weather = () => V3.env && V3.env.state && V3.env.state.wx && V3.env.state.wx.kind || 'baseline';
  const tide = () => G.hosted && V3.cabinTide;
  // 旧存档里的沙滩物件没有尺寸 / 花纹：按物件 id 固定补上（每次读档都一样）
  function traits(b) {
    const k = G.kind(b.kind);
    if (!k || k.category === 'trash' || !R() || (b.size > 0 && typeof b.pat === 'string')) return b;
    const t = R().seededTraits(k, b.id);
    b.size = t.size; b.pat = t.pat;
    return b;
  }
  G.traits = traits;
  // 一枚贝壳的王冠：'big' | 'small' | null
  G.crown = (kindId, size) => R() ? R().crown(G.kind(kindId), size) : null;
  // 一种贝壳收藏里的每一枚 [{ uid, size, pat, at }]
  G.items = (kindId) => { const f = G.st.found[kindId]; return f && Array.isArray(f.items) ? f.items : []; };
  const makeItem = (wx, onlyCollectible) => {
    const litter = trashKinds();
    const cap = Math.max(1, Math.floor(G.S.maxBeach / 3));
    const allowTrash = !onlyCollectible && G.st.beach.filter((b) => litter.some((k) => k.id === b.kind)).length < cap;
    const k = tide() ? tide().pick({ wx, kinds: G.kinds(), trash: litter, settings: G.S, allowTrash, random: rnd }) : pickKind();
    if (!k) return null;
    let p = null;
    try { p = V3.beachItems && V3.beachItems.spot ? V3.beachItems.spot(rnd) : spotFallback(); } catch (e) { V3.err('beachItems.spot: ' + e.message); }
    // null from the placement service means no safe space; exceptions must not bypass it either.
    if (!p) return null;
    const seq = ++G.st.seq;
    const it = { id: G.hosted ? I.id('beach') : 'b' + seq, kind: k.id, x: +p.x.toFixed(3), z: +p.z.toFixed(3), ry: +(p.ry || 0).toFixed(3), at: Date.now() };
    // 这一枚的尺寸和花纹在冲上岸时就定了：沙滩上看到的就是捡到的那一枚
    if (k.category !== 'trash' && R()) { it.size = R().rollSize(k, rnd); it.pat = R().rollPattern(rnd); }
    return it;
  };
  const add = (n, silent, at, wx, first) => {   // up to n items now (fewer when the beach is full)
    const out = [], st = G.st;
    for (let i = 0; i < n && st.beach.length < G.S.maxBeach; i++) {
      const it = makeItem(wx, first && i === 0); if (!it) break;
      if (at) it.at = at;
      st.beach.push(it); out.push(it);
    }
    if (out.length) V3.emit('game:wash', { items: out, silent: !!silent });
    return out;
  };
  const count = () => G.S.perMin + Math.floor(rnd() * (G.S.perMax - G.S.perMin + 1));
  function schedule(from) { const S = G.S; G.st.nextWash = from + (S.washMin + rnd() * Math.max(0, S.washMax - S.washMin)) * 60000; }
  const roll = (silent, at) => {   // one wash trigger; the very first one of a new save always brings something
    const st = G.st; st.stats.washes++;
    const forced = !st.firstDone; st.firstDone = true;
    // Don't retroactively pretend the current sky is known for historical/offline waves.
    const wx = silent ? 'baseline' : weather();
    const chance = tide() ? tide().chance(G.S.washChance, wx) : G.S.washChance;
    const got = (forced || rnd() < chance) ? add(count(), silent, at, wx, forced) : [];
    if (got.length) st.stats.hits++; else { st.stats.misses++; if (!silent) V3.emit('game:miss'); }
    return got;
  };
  const tick = () => {
    if (!G.live || !G.auto) return;
    const now = Date.now(), st = G.st; let n = 0;
    while (st.nextWash && now >= st.nextWash && n++ < 50) {
      const at = st.nextWash;
      roll(now - at > 5000 || document.hidden, at);   // page was closed / tab hidden → catch up silently
      schedule(at);
    }
    if (st.nextWash && now >= st.nextWash) schedule(now);
    if (n) save();
  };

  // ---- start: load the save; live → timer + writes; automated browsers get no timer unless ?auto=1 ----
  G.start = (o = {}) => {
    if (G.started) return G;
    G.started = true;
    G.live = store.live = o.live !== false;
    G.hosted = !!(G.live && I && I.use());
    G.auto = U.qs('auto', navigator.webdriver ? '0' : '1') !== '0';
    const old = store.get(KEY, null);
    const d = G.hosted ? store.get(HOST_KEY, null) || old : old;
    if (d && d.v === VER) {
      for (const f of SCHEMA) if (f.type !== 'button' && d.S && d.S[f.key] != null) G.S[f.key] = norm(f, d.S[f.key]);
      // Carry over the old slider number (e.g. 1% → weight 1), not a fixed chance.
      if (d.S?.wUltra == null && typeof d.S?.ultraChance === 'number' && Number.isFinite(d.S.ultraChance)) {
        G.S.wUltra = norm(field('wUltra'), d.S.ultraChance * 100);
      }
      Object.assign(G.st, fresh(), d.st || {});
      if (G.kinds().length) G.st.beach = (G.st.beach || []).filter(b => b && G.kind(b.kind));
      for (const b of G.st.beach || []) traits(b);
    }
    if (G.hosted) {
      const legacy = old && old.v === VER && old.st && old.st.found;
      G.st.found = {};
      I.start(legacy);
      // Keep v3.game untouched as the migration backup, even after pagehide.
      flush();
    }
    if (G.live) {
      if (!G.st.nextWash) G.st.nextWash = Date.now() + 30000;   // new save: first wash after 30 s
      tick();
      timer = setInterval(tick, 1000);
      addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    }
    V3.emit('game:start', G);
    return G;
  };
  G.stop = () => { clearInterval(timer); timer = 0; if (G.live) flush(); };

  // ---- actions ----
  G.washNow = (n) => {
    const st = G.st, first = !st.firstDone; st.firstDone = true; st.stats.washes++;
    const got = add(n > 0 ? n : count(), false, 0, weather(), first);
    if (got.length) st.stats.hits++;
    save(); return got;
  };
  function finishCollect(item, by, n, first, operation, applied = true, instance = null) {
    const i = G.st.beach.indexOf(item);
    if (i < 0) return null;
    G.st.beach.splice(i, 1);
    claims.delete(item.id);
    let obj = null;
    if (applied) {
      try { obj = V3.beachItems && V3.beachItems.detach ? V3.beachItems.detach(item.id) : null; } catch (e) { V3.err('beachItems.detach: ' + e.message); }
    }
    const ev = { item, kind: G.kind(item.kind), by, first, n, obj, operation, instance,
      crown: instance ? G.crown(item.kind, instance.size) : null };
    if (G.hosted) flush(); else save();
    if (applied) V3.emit('game:collect', ev);
    return applied ? ev : null;
  }
  G.collect = (id, by = 'player') => {
    if (collecting.has(id)) return null;
    const st = G.st, item = st.beach.find(b => b.id === id);
    if (!item) return null;
    const kind = G.kind(item.kind), now = Date.now();
    if (!kind) return null;
    traits(item);
    if (!G.hosted) {
      const f = st.found[item.kind] || (st.found[item.kind] = { n: 0, first: now, last: now, items: [] });
      const first = !(f.items && f.items.length) && f.n === 0;
      const inst = kind.category === 'trash' ? null : { uid: item.id, size: item.size, pat: item.pat, at: now };
      if (inst) { (f.items || (f.items = [])).push(inst); f.n = f.items.length; } else f.n++;
      f.last = now;
      return finishCollect(item, by, f.n, first, undefined, true, inst);
    }
    const trash = kind.category === 'trash';
    const operation = {
      op: 'collect', id: /^b\d+$/.test(item.id) ? `legacy:${item.id}:${item.at || 0}:${item.kind}` : item.id,
      kind: item.kind, at: now, category: trash ? 'trash' : 'collectible',
      ...(trash ? {} : { size: item.size, pat: item.pat }),
    };
    const job = I.perform(operation).then((r) => {
      if (!r.ok) {
        V3.emit('game:inventory-error', r.error);
        return null;  // Nothing taken off the beach until the durable commit.
      }
      const f = r.inventory.found[item.kind], n = f ? f.n : 0;
      const inst = trash ? null : (r.item || (f && f.items.find((x) => x.uid === operation.id)) || null);
      // 第一次找到：图鉴里原来没有这一种（卖光了的种类 n = 0 但仍算见过）
      const first = !trash && !!f && f.items.length === 1 && f.first === f.last;
      return finishCollect(item, by, n, first, operation, r.applied !== false, inst);
    }).finally(() => collecting.delete(id));
    collecting.set(id, job);
    return job;
  };
  G.claim = (id, who = 'girl') => {
    if (collecting.has(id) || !G.st.beach.some(b => b.id === id) || (claims.has(id) && claims.get(id) !== who)) return false;
    claims.set(id, who); V3.emit('game:claim', { id, who }); return true;
  };
  G.unclaim = (id) => { claims.delete(id); };
  G.claimedBy = (id) => claims.get(id) || null;
  G.free = () => G.st.beach.filter(b => !claims.has(b.id) && !collecting.has(b.id));
  G.counts = () => {
    const ks = G.kinds(), f = G.st.found;
    return { kinds: ks.filter(k => f[k.id]).length, total: ks.length || 12,
      items: Object.values(f).reduce((a, x) => a + (x.n || 0), 0) };
  };
  G.reset = () => {
    if (!G.hosted) { G.st.found = {}; save(); V3.emit('game:reset'); return; }
    // The existing settings UI requires confirmation. No reset via ?view= on a real save.
    if (!I.ready) return V3.emit('game:inventory-error', I.error || '小屋存档还在加载');
    return I.perform({ op: 'reset', id: I.id('reset'), rev: I.data.rev }).then((r) => {
      if (!r.ok) V3.emit('game:inventory-error', r.error);
      else V3.emit('game:reset');
    });
  };
  G.setFound = (n) => {   // test helper: the first n kinds (KINDS order) count as found（浏览器本地存档也行；本机服务上不做）
    if (G.hosted && I.remote) return;
    const now = Date.now(), ks = G.kinds(); G.st.found = {};
    ks.slice(0, n).forEach((k, i) => {
      const m = 1 + (i % 3), rnd2 = U.rng(1000 + i);
      const items = Array.from({ length: m }, (_, j) => ({ uid: 'test:' + k.id + ':' + j,
        size: R() ? R().rollSize(k, rnd2) : 0, pat: R() ? R().PATTERNS[(i + j * 3) % R().PATTERNS.length].id : 'plain', at: now - j * 60e3 }));
      const r = R() && R().sizeRange(k);   // 截图要看得到王冠：第 1 种的第一枚是大金冠，第 2 种的第一枚是小金冠
      if (r && i < 2) items[0].size = r[i === 0 ? 1 : 0];
      G.st.found[k.id] = { n: m, first: now - (n - i) * 3600e3, last: now, items };
    });
    if (G.hosted) return I.devFound(G.st.found).then(() => V3.emit('game:reset'));
    save(); V3.emit('game:reset');
  };

  // ---- __view / ?view= test tokens ----
  const T = V3.viewTokens;
  T.wash = (v) => { G.washNow(Number(v) || 0); };
  T.collect = (v) => { const b = v ? G.st.beach.find(x => x.id === v) : G.st.beach[0]; if (b) G.collect(b.id, 'player'); };
  T.found = (v) => G.setFound(v === 'all' || v === '' ? G.kinds().length : Math.max(0, Number(v) || 0));
  T.reset = () => { if (!G.hosted) G.reset(); };
  T.open = (v) => V3.emit('game:open', v || 'collection');
})(window.V3);
