// 60-game.js — V3.store (localStorage save) + V3.game: settings, beach state, wash-up timer, collect, events,
// test tokens. Pure data + events, no rendering (docs/SPEC-4.md §3). Other modules listen to 'game:*'.
(function (V3) {
  'use strict';
  const U = V3.util;
  const KEY = 'game', HOST_KEY = 'cabinGame', VER = 1;
  const I = V3.cabinInventory;

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
    { key: 'girlAuto', label: '小鲸鱼自己去收拾沙滩', type: 'toggle', group: '海边', def: true },
    { key: 'girlMin', label: '沙滩上有东西后多久开始收拾·最短', type: 'range', min: 5, max: 600, step: 5, unit: '秒', group: '海边', def: 30, hint: '从最早冲上来的那一件算起；时间到了她一口气把沙滩上的都捡完。留一点时间给你自己点' },
    { key: 'girlMax', label: '沙滩上有东西后多久开始收拾·最长', type: 'range', min: 5, max: 600, step: 5, unit: '秒', group: '海边', def: 90 },
    { key: 'washNow', label: '现在就冲一波', type: 'button', group: '海边', action: 'washNow' },
    { key: 'reset', label: '清空收集', type: 'button', group: '海边', action: 'reset', confirm: '确定清空所有收集吗？设置不会变。' },
    { key: 'mcTextureMode', label: '纹理模式', type: 'select', group: '房子', def: 'builtin',
      options: [['builtin', '默认内置纹理'], ['instance', '跟随关联 MC 纹理包']],
      hint: '关联实例后读取其已启用资源包；单张贴图找不到或读不出来，就用原来的材质。' },
    // select: options [[id, label], …]; the cabin page forwards it to V3.setState('weather', v)
    { key: 'weather', label: '天气', type: 'select', group: '天气', def: 'real', hint: '实时天气按济宁的真实天气变化（需要联网）',
      options: (V3.scene && V3.scene.WEATHERS) || [['real', '实时天气'], ['clear', '晴'], ['cloudy', '多云'], ['overcast', '阴'], ['fog', '雾'], ['drizzle', '小雨'], ['rain', '大雨'], ['storm', '雷雨'], ['snow', '雪']] },
  ];
  const PAIRS = { washMin: 'washMax', washMax: 'washMin', perMin: 'perMax', perMax: 'perMin', girlMin: 'girlMax', girlMax: 'girlMin' };
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
    return { id: G.hosted ? I.id('beach') : 'b' + seq, kind: k.id, x: +p.x.toFixed(3), z: +p.z.toFixed(3), ry: +(p.ry || 0).toFixed(3), at: Date.now() };
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
      Object.assign(G.st, fresh(), d.st || {});
      if (G.kinds().length) G.st.beach = (G.st.beach || []).filter(b => b && G.kind(b.kind));
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
  function finishCollect(item, by, n, first, operation, applied = true) {
    const i = G.st.beach.indexOf(item);
    if (i < 0) return null;
    G.st.beach.splice(i, 1);
    claims.delete(item.id);
    let obj = null;
    if (applied) {
      try { obj = V3.beachItems && V3.beachItems.detach ? V3.beachItems.detach(item.id) : null; } catch (e) { V3.err('beachItems.detach: ' + e.message); }
    }
    const ev = { item, kind: G.kind(item.kind), by, first, n, obj, operation };
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
    if (!G.hosted) {
      const f = st.found[item.kind] || (st.found[item.kind] = { n: 0, first: now, last: now });
      const first = f.n === 0;
      f.n++; f.last = now;
      return finishCollect(item, by, f.n, first);
    }
    const operation = {
      op: 'collect', id: /^b\d+$/.test(item.id) ? `legacy:${item.id}:${item.at || 0}:${item.kind}` : item.id,
      kind: item.kind, at: now, category: kind.category === 'trash' ? 'trash' : 'collectible',
    };
    const job = I.perform(operation).then((r) => {
      if (!r.ok) {
        V3.emit('game:inventory-error', r.error);
        return null;  // Nothing taken off the beach until the durable commit.
      }
      const f = r.inventory.found[item.kind], n = f ? f.n : 0;
      return finishCollect(item, by, n, n === 1, operation, r.applied !== false);
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
    return { kinds: ks.filter(k => f[k.id] && f[k.id].n > 0).length, total: ks.length || 12,
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
  G.setFound = (n) => {   // test helper: the first n kinds (KINDS order) count as found
    if (G.hosted) return;
    const now = Date.now(), ks = G.kinds(); G.st.found = {};
    ks.slice(0, n).forEach((k, i) => { G.st.found[k.id] = { n: 1 + (i % 3), first: now - (n - i) * 3600e3, last: now }; });
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
