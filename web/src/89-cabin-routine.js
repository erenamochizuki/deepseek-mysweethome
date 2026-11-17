// Local cabin schedule. The hosted bridge may store a local copy for either chat entry point.
(function (V3) {
  'use strict';
  if (!['home', 'cabin'].includes(V3.PAGE)) return;
  const ACTOR_KIND = new Map([['meal', 'eat'], ['diary', 'write_diary'], ['draw', 'draw'], ['read', 'read'], ['reply_private', 'reply_private']]);
  const LOG_KIND = new Map([...ACTOR_KIND].map(([k, v]) => [v, k]));
  const EXTERNAL = new Set(['reply_private', 'diary', 'draw']);
  // snack：对话里叫她去吃零食（69-snack-bar）。不进行为日志（桥接的白名单不认识的动作会让整批上传失败）
  const isAction = (action) => action === 'shell' || action === 'snack' || ACTOR_KIND.has(action);
  const PREFIX = 'cabin.routine.unread.v2:';
  const MEAL_KEY = 'cabin.routine.lunch.v1';
  const LIMIT = 24, TTL = 120000;
  const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const openedAt = Date.now(), memory = new Map(), seen = new Map(), pending = [];
  const shanghai = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let lunchDay = '', lunchStartedDay = '', nextLunch = 0, nextLeisure = openedAt + 90000, nextSnack = openedAt + 120000, inChat = false;
  // 空闲时她自己找的消遣（65 的 leisure 行为）和各自的权重；测试可以改 V3.cabinRoutine.leisure 固定成某一样（2026-11-14）
  // stargaze（阁楼望远镜）只在天黑、看得到星星时开始得了，白天挑中了会换下一样；天黑以后它的权重最高
  const LEISURE = [['sea', 3], ['watch_tv', 2], ['read', 2], ['album', 1], ['stargaze', 4]];
  const LEISURE_SECONDS = { sea: [50, 100], watch_tv: [35, 65], album: [20, 35], stargaze: [40, 80] };   // read 用行为自己的 15 秒
  let uploader = null, uploading = null, retryAt = 0;
  function dayAndMinute(at) {
    const p = Object.fromEntries(shanghai.formatToParts(at).map(({ type, value }) => [type, value]));
    return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
  }
  function get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } }
  function drop(k) { memory.delete(k); try { localStorage.removeItem(k); } catch (_) {} }
  function records() {
    const map = new Map(memory);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(PREFIX)) continue;
        try {
          const r = JSON.parse(get(k)), id = k.slice(PREFIX.length);
          if (ID.test(id) && Number.isSafeInteger(r?.at) && r.at > 0 && isAction(r.action)) map.set(k, { id, at: r.at, action: r.action });
        } catch (_) { /* ignore invalid local data */ }
      }
    } catch (_) { /* private browser or quota fallback */ }
    return [...map].sort(([ka, a], [kb, b]) => a.at - b.at || ka.localeCompare(kb));
  }
  function flush(force = false) {
    if (uploading) return uploading;
    if (!uploader || (!force && Date.now() < retryAt)) return Promise.resolve(false);
    const snapshot = records().slice(-LIMIT);
    if (!snapshot.length) { retryAt = Date.now() + 1500; return Promise.resolve(true); }
    uploading = Promise.resolve().then(() => uploader(snapshot.map(([, r]) => r))).then(result => {
      const ids = result?.ok && result.data?.ok && result.data.ackIds;
      if (!Array.isArray(ids)) return false;
      const ack = new Set(ids);
      for (const [key, { id }] of snapshot) if (ack.has(id)) drop(key);
      return snapshot.every(([, { id }]) => ack.has(id));
    }).catch(() => false).then(ok => {
      retryAt = ok ? 0 : Date.now() + 12000;
      uploading = null;
      return ok;
    });
    return uploading;
  }
  function setUploader(send) {
    if (typeof send !== 'function' || uploader) return;
    uploader = send;
    void flush(true);
  }
  function newId() {
    const c = globalThis.crypto;
    if (c.randomUUID) return c.randomUUID();
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
  }
  function record(action, at = Date.now()) {
    const id = newId();
    const key = PREFIX + id, data = { id, at, action };
    if (!set(key, JSON.stringify({ at, action }))) memory.set(key, data);
    const all = records();
    for (const [k] of all.slice(0, Math.max(0, all.length - LIMIT))) drop(k);
    void flush();
  }
  function available() {
    return !document.hidden && !document.body?.classList.contains('ui-off') && !V3.arrange?.on && !V3.fb?.enabled;
  }
  function dispatch(action, opts) {
    const actor = V3.actor;
    if (!actor || V3.shellControls?.busy) return false;
    const cur = actor.behavior, free = ['idle', 'wander'].includes(actor.state) && !cur;
    // 她真的刚做过的事（回了私聊、写了日记、画了画）：正在收拾沙滩也放下去演；自己找的消遣给任何派来的事让路（2026-11-14）
    const urgent = EXTERNAL.has(action);
    const yielding = !!(cur && cur.leisure) || (urgent && !cur && actor.state === 'collect');
    if (!free && !yielding) return false;
    if (action === 'shell') {
      if (!free) return false;
      const G = V3.game;
      const pos = actor.pos;
      let best = null, distance = Infinity;
      for (const item of G?.free?.() || []) {
        if (G.kind(item.kind)?.category === 'trash') continue;
        const d = pos ? Math.hypot(item.x - pos[0], item.z - pos[2]) : 0;
        if (d < distance) { distance = d; best = item; }
      }
      return !!(best && actor.collect?.(best.id));
    }
    if (action === 'snack') return !!(free && V3.snackBar && V3.snackBar.girlSnack({ force: true }));
    const kind = ACTOR_KIND.get(action);
    // A house with a rice cooker: she serves cooked rice, not a cold pot. The optional furniture hook starts a pot when
    // nothing is ready and answers false until it is; the caller simply asks again on its normal cadence.
    if (kind === 'eat' && V3.furniturePlay?.mealReady && !V3.furniturePlay.mealReady()) return false;
    return !!(kind && actor.startBehavior?.(kind, yielding ? { ...opts, interrupt: true } : opts));
  }
  // 她闲着（站着 / 闲逛）时按权重挑一样消遣去做；挑中的做不了（没有那件家具、走不到、下雨不看海）就换下一样
  function startLeisure() {
    const actor = V3.actor;
    if (!actor || actor.behavior || !['idle', 'wander'].includes(actor.state) || V3.shellControls?.busy) return false;
    const pool = (V3.cabinRoutine.leisure || LEISURE).slice();
    while (pool.length) {
      let r = Math.random() * pool.reduce((sum, p) => sum + p[1], 0), i = 0;
      while (i < pool.length - 1 && (r -= pool[i][1]) >= 0) i++;
      const kind = pool.splice(i, 1)[0][0], range = LEISURE_SECONDS[kind];
      const seconds = range ? range[0] + Math.random() * (range[1] - range[0]) : undefined;
      if (actor.startBehavior?.(kind, { interrupt: true, seconds })) return true;   // interrupt：闲逛到一半也可以转身去
    }
    return false;
  }
  function enqueue(action, now = Date.now()) {
    if (!isAction(action) || pending.some(p => p.action === action) || pending.length >= 6) return false;
    pending.push({ action, expires: now + TTL });
    return true;
  }
  function acceptEvents(events) {
    if (!Array.isArray(events)) return;
    const now = Date.now();
    for (const [id, at] of seen) if (at + TTL < now) seen.delete(id);
    for (const e of events.slice(0, 24)) {
      if (!EXTERNAL.has(e?.action) || typeof e.id !== 'string' || e.id.length < 1 || e.id.length > 96 || seen.has(e.id) || !Number.isSafeInteger(e.at) || e.at < openedAt || e.at < now - TTL || e.at > now + 5000) continue;
      seen.set(e.id, e.at);
      enqueue(e.action, e.at);
    }
    tick();
  }
  // The night routine (88-cabin-night, optional) works on this same queue: has(action?) = something is waiting (that action / anything),
  // take(action) drops it, run(action, opts?) performs it through dispatch() and drops it when that started.
  const NIGHT_IO = {
    has: action => pending.some(p => action == null || p.action === action),
    take: action => { const i = pending.findIndex(p => p.action === action); if (i !== -1) pending.splice(i, 1); return i !== -1; },
    run: (action, opts) => { const i = pending.findIndex(p => p.action === action); if (i === -1 || !dispatch(action, opts)) return false; pending.splice(i, 1); return true; },
  };
  function tick() {
    const now = Date.now(), night = V3.cabinNight;
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].expires <= now) pending.splice(i, 1);
    if (night) night.guard(now);   // past 08:00 she gets up even while the page cannot act (hidden tab, arrange mode)
    if (!available() || !window.__READY || !V3.actor) return;
    void flush();
    if (inChat) return;
    if (night && night.tick(now, NIGHT_IO)) return;   // asleep, on her way to bed, or up for a night-time reply: nothing else is scheduled
    const next = pending.findIndex(p => dispatch(p.action));
    if (next !== -1) { pending.splice(next, 1); return; }
    if (!V3.game?.live || !V3.game.auto) return;
    const { day, minute } = dayAndMinute(now);
    if (minute >= 11 * 60 + 30 && minute < 13 * 60 && lunchDay !== day && get(MEAL_KEY) !== day && now >= nextLunch) {
      nextLunch = now + 5000;
      if (dispatch('meal')) { lunchStartedDay = day; return; }
    }
    // 零食（69-snack-bar）：有零食、她闲着、离上次够久了，偶尔自己去冰箱上的零食篮拿一份吃
    if (now >= nextSnack) { nextSnack = now + 60000; if (V3.snackBar?.considerGirl?.(now)) return; }
    if (now >= nextLeisure) nextLeisure = now + (startLeisure() ? 10 * 60000 : 15000);
  }
  function receiveAction(action) { enqueue(action); tick(); }
  async function chat(post) {
    // Flush locally before requesting an answer so the bridge can claim the
    // same queue for both web chat and an owner-private QQ wake.
    async function run(lock = true) {
      if (!lock || inChat) return { ok: false, data: { error: '小屋已有一条聊天请求在等回复' } };
      inChat = true;
      try {
        if (await flush(true) && records().length) await flush(true);
        const result = await post();
        if (result?.ok && result.data?.ok && result.data.reply?.text) receiveAction(result.data.cabinAction);
        return result;
      } finally { inChat = false; }
    }
    if (navigator.locks?.request) return navigator.locks.request('cabin.routine.chat.v1', { ifAvailable: true }, run);
    return run();
  }
  V3.cabinRoutine = { acceptEvents, chat, setUploader, tick, leisure: LEISURE };
  V3.on('actor:behavior', e => {
    // 一样消遣做完（或被打断）：隔 2.5–4.5 分钟再找下一样
    if (e && e.leisure && (e.phase === 'completed' || e.phase === 'cancelled')) nextLeisure = Date.now() + 150000 + Math.random() * 120000;
    const action = LOG_KIND.get(e.kind);
    if (!action) return;
    const at = Number.isSafeInteger(e.at) ? e.at : Date.now();
    if (action === 'meal' ? e.phase === 'completed' : e.phase === 'action') record(action, at);
    if (action === 'meal' && e.phase === 'completed') {
      lunchDay = lunchStartedDay || dayAndMinute(at).day;
      set(MEAL_KEY, lunchDay);
    }
    if (action === 'meal' && (e.phase === 'completed' || e.phase === 'cancelled')) lunchStartedDay = '';
  });
  V3.on('game:collect', e => {
    if (e?.by === 'girl' && e.kind?.category !== 'trash') record('shell');
  });
  V3.on('ready', () => { tick(); setInterval(tick, 1500); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
})(window.V3);
