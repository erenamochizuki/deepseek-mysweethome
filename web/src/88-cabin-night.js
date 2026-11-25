// 88-cabin-night.js — 夜里上床睡觉（2026-11-12）。只在本机按钟点走：不调模型、不联网、不往行为记录里写新东西。
// 规则（上海时间，和 89-cabin-routine 一样用 Intl 的 Asia/Shanghai，不看电脑自己的时区）：
//   · 睡觉时段 23:30 – 次日 08:00。到了「该上床」的时候她走到床边、躺下、睡着（65-girl-actor 的 'sleep' 行为）：
//       ① 23:30 以后那一晚的写日记动作结束（完成或被打断）；② 没等到日记，最晚 23:45；③ 在时段里才打开页面 / 页面从后台回来：马上。
//   · 08:00 自己起床，照常过白天。设置「夜里上床睡觉」关掉也一样：马上起来，夜里照白天过。
//   · 睡着时她真的回了主人的 QQ 私聊（89 收到的 reply_private）：起床 → 跑到电脑前坐下敲键盘 → 坐着等。每来一条新的回复重新等 5 分钟；
//     5 分钟没有新的回复就起身回床上接着睡。页面只知道「她回了」，不知道「有人发来了」，所以这 5 分钟是从她最后一次回复算的。
//   · 睡着时来了写日记 / 画画（很少见）：起床 → 去书桌做完（和白天一样约 15 秒）→ 回床上，不等 5 分钟。正坐在电脑前等的时候来了：
//     先结束等待去做这件事，做完回床上。
//   · 小屋网页聊天带回来的动作标记（吃饭、看书……是你当面叫她做的）：起床去做，做完回床上。捡贝壳例外：夜里不捡，这个标记直接丢掉（2026-11-12）。
//   · 夜里不捡贝壳：该上床了（due）那一刻起 rest 就打开（页面在后台也先开好），正往贝壳走 / 刚蹲下还没捡起来的那颗当场放下（65 的 rest → quitShell）。
//   · 你戳她、点家具、网页聊天让她回话：她被叫起来站在床边回应（戳醒的台词是迷糊的），之后不闲逛，回床上接着睡。
//   · 雷雨的夜里不为了回消息起床（白天打雷时这些动作本来也不演）。
//   · 没有床 / 走不到床边 / 这个角色躺不了：这一晚照白天过（闲逛、看书照旧），每 60 秒再看一次有没有床可以睡。
//   · 布置模式、反馈模式、页面在后台：和别的行为一样先停下（她站回床边）；结束以后还在时段里就回床上。
// 接法：89-cabin-routine 每 1.5 秒 tick 一次，先调 V3.cabinNight.guard(now)（不管页面能不能演，都把「时段过了」这件事办掉），
//   页面能演的时候再调 V3.cabinNight.tick(now, io)：返回 true = 这一拍夜里说了算，89 不再派发、不吃午饭、不看书。
//   io = { has(action?) 队列里有没有等着的动作, take(action) 拿掉一条, run(action, opts?) 用 89 自己的 dispatch 去做 }。
// V3.cabinNight = { guard, tick, state() → { enabled, window, due, asleep, waitUntil, noBedUntil, night } }
(function (V3) {
  'use strict';
  if (!['home', 'cabin'].includes(V3.PAGE)) return;
  const START = 23 * 60 + 30, LATEST = 23 * 60 + 45, END = 8 * 60;   // 上海时间的分钟数
  const WAIT_MS = 5 * 60000, RETRY_MS = 60000, BUSY_MS = 6000;
  const shanghai = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function clock(at) {
    const p = Object.fromEntries(shanghai.formatToParts(at).map(({ type, value }) => [type, value]));
    return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
  }
  // 这一刻在不在睡觉时段；night = 这一晚的名字（开始那天的日期：过了零点还算前一天晚上）
  function nightAt(at) {
    const c = clock(at);
    if (c.minute >= START) return { night: c.day, late: c.minute >= LATEST };
    if (c.minute < END) return { night: clock(at - 9 * 3600000).day, late: true };   // 往回 9 小时一定落在前一天（时段内最晚 07:59）
    return null;
  }
  const opened = nightAt(Date.now());
  // night：正在过的是哪一晚；due：这一晚该上床了；waitUntil：坐在电脑前等到什么时候（0 = 没在等）；
  // noBedUntil：这一晚暂时睡不了（没有床 / 走不到 / 躺不了），到这个时刻再试；tryAt：她正忙，过一会儿再叫
  const S = { night: opened ? opened.night : '', due: !!opened, waitUntil: 0, noBedUntil: 0, tryAt: 0, rest: false };
  const actor = () => V3.actor || null;
  const enabled = () => {
    const G = V3.game;
    return !!(G && G.live && G.auto) && !(G.get && G.get('nightSleep') === false);
  };
  const kindOf = () => { const a = actor(), b = a && a.behavior; return b ? b.kind : ''; };
  const rest = (on) => {
    const a = actor();
    S.rest = on;
    if (a && a.rest && !!a.resting !== on) { try { a.rest(on); } catch (e) { V3.err('cabin-night rest: ' + e); } }
  };
  const stormy = () => {
    try { const w = V3.wx && V3.wx.now ? V3.wx.now() : V3.env && V3.env.state && V3.env.state.wx; return !!w && +w.storm > 0.5; } catch (e) { return false; }
  };
  const end = () => { const a = actor(); try { return !!(a && a.endBehavior && a.endBehavior()); } catch (e) { V3.err('cabin-night end: ' + e); return false; } };

  // 不在时段里（或者关掉了）：睡着就起床，坐在电脑前等着就起身，白天的规矩全部放开。页面在后台时也要办（rest 不能留到早上）
  function guard(now) {
    const w = enabled() ? nightAt(now) : null;
    if (w) {
      if (w.night !== S.night) Object.assign(S, { night: w.night, due: false, waitUntil: 0, noBedUntil: 0, tryAt: 0 });
      if (w.late) S.due = true;
      // 该上床了就先把白天的事停下（不捡贝壳、不闲逛），不等页面能演：页面从后台回来的头几帧里她不会先跑去捡一颗再说
      if (S.due && now >= S.noBedUntil && !S.rest) rest(true);
      return true;
    }
    if (S.night || S.rest || S.waitUntil) {
      const a = actor(), b = a && a.behavior;
      if (b && (b.kind === 'sleep' || b.hold)) end();
      Object.assign(S, { night: '', due: false, waitUntil: 0, noBedUntil: 0, tryAt: 0 });
      rest(false);
    }
    return false;
  }
  function goToBed(now) {
    const a = actor();
    if (now < S.tryAt || !a || !a.startBehavior || !a.behaviorAvailability) return;
    // 和 89 的 dispatch 一样的门槛：她得闲着（夜里 rest 着，不会自己走开；万一正闲逛，interrupt 让她马上转身）
    // 正在做自己找的消遣（看电视、看海……，2026-11-14）也算闲着：startBehavior('sleep') 会让她放下去睡
    const b = a.behavior, leisure = !!(b && b.leisure);
    if ((!leisure && !['idle', 'wander'].includes(a.state)) || (b && !leisure) || (V3.shellControls && V3.shellControls.busy)) return;
    let ok = false, why = '';
    try {
      ok = !!a.startBehavior('sleep', { interrupt: true });
      if (!ok) why = a.behaviorAvailability('sleep', { interrupt: true }).reason || '';
    } catch (e) { V3.err('cabin-night sleep: ' + e); why = 'error'; }
    if (ok) return;
    if (why === 'busy' || why === 'blocked' || why === 'actor-not-ready') S.tryAt = now + BUSY_MS;   // 一会儿就好：还是夜里说了算
    else noBed(now);
  }
  function noBed(now) {                              // 这一晚先照白天过，过一会儿再看
    S.noBedUntil = now + RETRY_MS; S.tryAt = 0;
    rest(false);
  }
  // → true：这一拍夜里说了算（89 不派发、不午饭、不看书）
  function tick(now, io) {
    if (!guard(now) || !S.due) return false;
    const a = actor();
    if (!a || !a.startBehavior || !a.endBehavior) return false;          // 旧的角色模块：没有睡觉这回事
    if (now < S.noBedUntil) return false;
    // 这一晚已经知道睡不了（noBedUntil 设过），重试的时候到了：她这会儿有事（正在做别的、队列里有等着的动作）就接着照白天过，
    // 6 秒后再看，不接管。以前这一拍会把刚到的回复当成夜里的（坐在电脑前等 5 分钟），可这一晚根本没有床可回（2026-11-14）
    if (S.noBedUntil && (a.behavior || (io && io.has && io.has()))) { S.noBedUntil = now + BUSY_MS; return false; }
    rest(true);
    // 夜里不捡贝壳（2026-11-12 哥哥定的）：网页聊天带回来的「捡贝壳」动作直接丢掉，不为它起床（别的动作照旧起来做）
    if (io && io.take) while (io.take('shell'));
    const kind = kindOf(), b = a.behavior, has = io && io.has ? (x) => io.has(x) : () => false;
    // ---- 坐在电脑前等（held）----
    if (b && b.hold) {
      if (has('reply_private')) {                    // 又回了一条：再敲一会儿，重新等 5 分钟
        io.take('reply_private');
        if (a.renewBehavior) a.renewBehavior();
        S.waitUntil = now + WAIT_MS;
      } else if (has() || now >= S.waitUntil) { S.waitUntil = 0; end(); }   // 来了别的事：先起身（下一拍去做）；等够了：回床上
      return true;
    }
    S.waitUntil = 0;
    // ---- 有事要做：睡着就先起来，站好了再去 ----
    if (has()) {
      if (kind === 'sleep') { if (!stormy()) end(); return true; }       // 起身要 0.9 秒，下一拍再派
      if ((!b || b.leisure) && io.run) {
        if (has('reply_private') && io.run('reply_private', { hold: true })) S.waitUntil = now + WAIT_MS;
        else for (const x of ['diary', 'draw', 'recipe_read', 'recipe_write', 'meal', 'read']) if (has(x) && io.run(x)) break;
      }
      return true;
    }
    if (!b || b.leisure) goToBed(now);
    return now >= S.noBedUntil;
  }
  V3.cabinNight = {
    guard, tick,
    state() {
      const now = Date.now(), b = actor() && actor().behavior;
      return { enabled: enabled(), window: !!nightAt(now), night: S.night, due: S.due, asleep: !!(b && b.kind === 'sleep' && b.phase === 'action'),
        waitUntil: S.waitUntil, noBedUntil: S.noBedUntil, rest: S.rest };
    },
  };
  // 这一晚的日记写完了（或者被打断了）：该上床了。躺不下 / 走到一半走不通：这一晚先不睡
  V3.on('actor:behavior', (e) => {
    if (!e) return;
    const now = Date.now();
    if (e.kind === 'write_diary' && (e.phase === 'completed' || e.phase === 'cancelled')) {
      const w = nightAt(now);
      if (w) { if (w.night !== S.night) Object.assign(S, { night: w.night, waitUntil: 0, noBedUntil: 0, tryAt: 0 }); S.due = true; }
    }
    if (e.kind === 'sleep' && e.phase === 'cancelled' && (e.reason === 'unreachable' || e.reason === 'lying-unavailable' || e.reason === 'timeout')) noBed(now);
  });
  // 页面从后台回来时还在时段里：马上回床上（89 自己会在这时候 tick 一次）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const w = nightAt(Date.now());
    if (w) { if (w.night !== S.night) Object.assign(S, { night: w.night, waitUntil: 0, noBedUntil: 0, tryAt: 0 }); S.due = true; }
  });
  // 设置「房子」页的开关（60-game 的 SCHEMA 在 init 之后才有；和 66-chime-sound 的「风铃声」一样的加法）
  V3.on('init', () => {
    const G = V3.game;
    if (!G || !G.SCHEMA || G.SCHEMA.some((f) => f.key === 'nightSleep')) return;
    G.SCHEMA.push({ key: 'nightSleep', label: '夜里上床睡觉', type: 'toggle', group: '房子', def: true, hint: '每天 23:30 写完日记上床，睡到早上 8:00；夜里回你消息会起来坐到电脑前，5 分钟没有新消息再回去睡' });
    if (G.S && G.S.nightSleep == null) G.S.nightSleep = true;
  });
})(window.V3);
