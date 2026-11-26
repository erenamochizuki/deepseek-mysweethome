/* cabin-bridge.js — 海边小屋 v4 ↔ QQ 助手（SurfCore）网页集成层（T2）
 *
 * 只通过 window.V3 的公开接口和本页 DOM 工作，不改构建产物；T1 的 server.mjs 在
 * home.html / cabin.html 的 </body> 前注入本文件（defer）。所有外部调用都 try/catch，
 * 任何异常都不允许打断原页面；接口 503（QQ 桥接没开）时 UI 优雅降级。
 *
 * 暴露：window.__cabinBridge = { version, ready, actorReady, lastState, lastError, api }
 * 控制台只打一行版本日志。
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';
  if (window.__cabinBridge && window.__cabinBridge.version) return;   // 只初始化一次
  try { console.log('[cabin-bridge] v' + VERSION + ' — 小屋 ↔ QQ 助手集成层'); } catch (e) {}

  var API = '/api/cabin';
  var POLL_STATE_MS = 12000;      // 契约：10–15s
  var POLL_ACTIVITY_MS = 9000;    // 契约：8–10s
  var ACTOR_WAIT_MS = 20000;      // 等 V3.actor 最多 20s
  var REPORT_DEBOUNCE_MS = 300;
  var WEATHER_POLL_MS = 20000;
  var UI_TICK_MS = 700;
  // 沙盘工具（门廊展示盒）：页面长轮询桥接的工具队列，见 up/docs/CABIN-TOOLS-BRIDGE.md。
  // 复制标签页会复制 sessionStorage；每个页面实例需要独立领取任务。
  var TOOL_CLIENT_ID = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID()
    : ('c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));

  var MOOD_LABEL = { happy: '开心', calm: '平静', tired: '有点累', sad: '难过', excited: '兴奋', sleepy: '困困的' };
  var WX_LABEL = { clear: '晴', cloudy: '多云', overcast: '阴', fog: '起雾了', drizzle: '下小雨', rain: '在下雨', storm: '打雷了', snow: '下雪了' };

  // 安全落脚点（米，世界坐标）。门廊前 = girl-actor 的 HOME，确定能走；
  // 其余点在运行时有 V3.nav.walkable 就校验，走不了就退回门廊前。
  var SAFE = {
    porch: [-1.6, -0.9],
    porchDoor: [-1.5, -5.4],     // layout.house.doorOut
    stargaze: [-8.5, 5.0],
    beach: [-8.0, 4.2],
    tideline: [-2.0, 9.5],
    rocking: [-4.5, -9.3],       // 摇椅（一楼西侧）旁边
    tv: [4.3, -9.0],             // 电视（东墙）前面
    kitchen: [0.0, -13.4]        // 电饭煲（厨房台面）前面
  };

  var errorsOnce = Object.create(null);
  function warnOnce(key, msg) {
    if (errorsOnce[key]) return;
    errorsOnce[key] = 1;
    try { console.warn('[cabin-bridge] ' + msg); } catch (e) {}
  }
  function safe(fn, key) {
    try { return fn(); } catch (e) { warnOnce(key || 'x', '内部错误 ' + (e && (e.message || e))); return null; }
  }

  // ---------------- HTTP（同源 /api/cabin/*；永不 throw） ----------------
  function withTimeout(ms) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms) : 0;
    return {
      signal: ctrl ? ctrl.signal : undefined,
      done: function () { if (timer) clearTimeout(timer); }
    };
  }
  function requestJson(method, path, body, ms) {
    var t = withTimeout(ms || 8000);
    var opt = { method: method, signal: t.signal, cache: 'no-store', headers: { accept: 'application/json' } };
    if (body !== undefined) {
      opt.headers['content-type'] = 'application/json';
      try { opt.body = JSON.stringify(body); } catch (e) { t.done(); return Promise.resolve({ ok: false, status: 0, data: null, netError: 'body' }); }
    }
    return fetch(API + path, opt).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        return { ok: !!res.ok, status: res.status, data: data };
      });
    }).catch(function (e) {
      return { ok: false, status: 0, data: null, netError: String((e && (e.name || e.message)) || e) };
    }).then(function (out) { t.done(); return out; });
  }
  function getJson(path, ms) { return requestJson('GET', path, undefined, ms); }
  function postJson(path, body, ms) { return requestJson('POST', path, body, ms); }
  async function generateDrawing() {
    const result = await postJson('/drawing/generate', {}, 150000);
    if (!result.ok || !result.data?.ok || !result.data.image?.startsWith('data:image/png;base64,')) return null;
    return { title: result.data.title || '阁楼小画', image: result.data.image };
  }
  const drawingPrefix = 'v3.cabinDrawing:';
  const pendingDrawings = new Map();
  let sendingDrawings = false;
  function queueDrawing(title, image) {
    const id = crypto.randomUUID();
    const body = { title, image };
    pendingDrawings.set(id, body);
    try { localStorage.setItem(drawingPrefix + id, JSON.stringify(body)); }
    catch { V3()?.hud?.toast('浏览器空间不足，QQ 待发的画暂存在本页。'); }
    void flushDrawings();
  }
  async function flushDrawings() {
    if (sendingDrawings || !pendingDrawings.size) return;
    sendingDrawings = true;
    try {
      for (const [id, body] of pendingDrawings) {
        const result = await postJson('/drawing', body, 30000);
        if (result.data?.ok && result.data.qqSent) {
          V3()?.hud?.toast('《' + body.title + '》已经发到主人 QQ 私聊了。');
        } else if (result.data?.uncertain || result.status === 400 || result.status === 413) {
          V3()?.hud?.toast(result.data?.error || '这张画暂时无法通过 QQ 发送。');
        } else {
          warnOnce('drawing-pending', '画作仍在等 QQ 助手，稍后会再试。');
          break;
        }
        pendingDrawings.delete(id);
        try { localStorage.removeItem(drawingPrefix + id); } catch {}
      }
    } finally { sendingDrawings = false; }
  }
  function restoreDrawings() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(drawingPrefix)) pendingDrawings.set(key.slice(drawingPrefix.length), JSON.parse(localStorage.getItem(key)));
      }
    } catch { warnOnce('drawing-queue', '有一张待发画作没能读出来。'); }
    void flushDrawings();
  }
  function chatRequest(text) {
    var v = V3(), routine = v && v.cabinRoutine;
    function post() { return postJson('/chat', { text: String(text || ''), client: 'cabin' }, 65000); }
    return routine ? routine.chat(post) : post();
  }
  async function shareStarChart(image) {
    var out = await postJson('/star-chart', { image: image }, 150000);
    var reply = typeof out.data?.reply === 'string' && out.data.reply.trim();
    var delivered = out.ok && out.data?.ok === true && out.data.qqSent === true;
    if (reply) {
      appendMsg('me', '给小鲸鱼看了一张星图。');
      appendMsg('her', reply);
      rememberSpoken(reply);
      if (!document.querySelector('.star-view[open]')) sayLine(reply, 'happy');
    }
    if (!delivered || !reply) {
      var problem = new Error(out.data?.error || '暂时无法确认 QQ 是否收到，请先看一下私聊。');
      problem.reply = reply;
      throw problem;
    }
    return { ok: true, qqSent: true, reply: reply };
  }

  // ---------------- V3 辅助 ----------------
  function V3() { return window.V3 || null; }
  function running() { return !(V3()?.backgroundPaused?.() ?? document.hidden); }
  function actor() {
    var v = V3();
    return v && v.actor ? v.actor : null;
  }
  function callActor(method, args) {
    var a = actor();
    if (!a || typeof a[method] !== 'function') return { called: false, value: undefined };
    var out;
    try { out = a[method].apply(a, args || []); } catch (e) { warnOnce('actor:' + method, 'actor.' + method + ' 失败：' + (e && e.message || e)); return { called: false, value: undefined }; }
    return { called: true, value: out };
  }
  // 她正在做「不能被打断的事」（捡贝壳、坐家具、回应你、躲雨）时，自主活动不要插队。
  // 2026-11-09 实测：桥接每 90s 派一条自主活动，会把“点她去捡贝壳”这种几十秒的任务打断，导致贝壳捡不到。
  // idle / wander / walk 都是她可以随时改主意的情况（walk 也来自自主活动本身），允许继续执行新活动。
  function actorBusy() {
    try {
      var a = actor(), v = V3();
      if (v && v.shellControls && v.shellControls.busy) return true;
      var s = a && a.state;
      if (!s) return false;
      return s === 'collect' || s === 'furniture' || s === 'respond' || s === 'shelter';
    } catch (e) { return false; }
  }
  // 只冒泡、不打断她正在做的事（activity 用）
  function sayLine(text, mood) {
    text = String(text == null ? '' : text).trim();
    if (!text) return false;
    var r = callActor('say', [text, mood || 'happy']);
    if (r.called) return true;
    var v = V3();
    if (v && v.bubble && typeof v.bubble.say === 'function') {
      try { v.bubble.say('girl', text, { mood: mood || 'happy' }); return true; } catch (e) { warnOnce('bubble.say', 'bubble.say 失败：' + (e && e.message || e)); }
    }
    return false;
  }
  // 让她回应你（聊天 / QQ 侧刚说的话）：转身、看镜头、冒泡（契约 §4.3 的 bubble.say('girl', …) 走 actor.say 内部同一气泡）
  function respondLine(text, mood) {
    text = String(text == null ? '' : text).trim();
    if (!text) return false;
    var r = callActor('respond', [text, { mood: mood || 'happy', seconds: 5 }]);
    if (r.called && r.value) return true;
    var v = V3();
    if (v && v.bubble && typeof v.bubble.say === 'function') {
      try { v.bubble.say('girl', text, { mood: mood || 'happy' }); return true; } catch (e) { warnOnce('bubble.say2', 'bubble.say 失败：' + (e && e.message || e)); }
    }
    return false;
  }

  // 已说过的话（去重，别刷屏）
  var spoken = [];
  function rememberSpoken(text) {
    spoken.push({ t: text, at: Date.now() });
    if (spoken.length > 60) spoken.splice(0, spoken.length - 60);
  }
  function wasSpoken(text) {
    var now = Date.now();
    for (var i = spoken.length - 1; i >= 0; i--) if (spoken[i].t === text && now - spoken[i].at < 30000) return true;
    return false;
  }

  // ---------------- 事件上报（debounce 300ms，失败静默重试 1 次） ----------------
  var pendingReport = Object.create(null);
  var reportStats = { sent: 0, failed: 0 };
  var eventPrefix = 'v3.cabinEvent:';
  var eventQueue = Object.create(null);
  var eventInFlight = false;
  function durableEvent(input) {
    var v = V3(), i = v && v.cabinInventory;
    var id = input.id || (i && i.id ? i.id('event') : 'event-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
    id = id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    var body = { id: id, eventId: id, at: input.at || Date.now(), type: input.type, detail: input.detail || {}, text: String(input.text || '') };
    eventQueue[id] = body;
    try { localStorage.setItem(eventPrefix + id, JSON.stringify(body)); } catch (e) {}
    flushEvents();
  }
  function restoreEventQueue() {
    try {
      for (var n = 0; n < localStorage.length; n++) {
        var key = localStorage.key(n);
        if (!key || key.indexOf(eventPrefix) !== 0) continue;
        var body = JSON.parse(localStorage.getItem(key));
        if (body && body.id === key.slice(eventPrefix.length)) eventQueue[body.id] = body;
      }
    } catch (e) { warnOnce('event-queue', '有小屋活动记录没能读出来'); }
  }
  async function flushEvents() {
    if (eventInFlight) return;
    eventInFlight = true;
    try {
      var entries = Object.values(eventQueue).sort(function (a, b) { return a.at - b.at; });
      for (var i = 0; i < entries.length; i++) {
        var body = entries[i];
        var r = await postJson('/event', body, 8000);
        if (r && r.ok && r.data && r.data.ok) {
          reportStats.sent++;
          var v = V3(); if (v && typeof v.emit === 'function') v.emit('cabin:recorded', body.type);
        } else {
          reportStats.failed++;
          // Network/bridge failure: leave the same ID queued. A rejected body should not block newer events.
          if (!r || ![400, 413, 415, 422].includes(r.status)) return;
        }
        delete eventQueue[body.id];
        try { localStorage.removeItem(eventPrefix + body.id); } catch (e) {}
      }
    } finally { eventInFlight = false; }
  }
  function report(type, detail, text) {
    if (!type) return;
    try {
      if (type !== 'weather' && type !== 'activity_start' && type !== 'activity_done') {
        durableEvent({ type: type, detail: detail, text: text });
        return;
      }
      var slot = pendingReport[type];
      if (slot && slot.timer) clearTimeout(slot.timer);
      slot = pendingReport[type] = { detail: detail || {}, text: String(text || ''), timer: 0 };
      slot.timer = setTimeout(function () { flushReport(type); }, REPORT_DEBOUNCE_MS);
    } catch (e) { warnOnce('report', 'event 上报排队失败：' + (e && e.message || e)); }
  }
  function flushReport(type) {
    var slot = pendingReport[type];
    if (!slot) return;
    delete pendingReport[type];
    if (slot.timer) clearTimeout(slot.timer);
    var body = { type: type, detail: slot.detail, text: slot.text };
    postJson('/event', body, 8000).then(function (r) {
      if (r && r.ok && r.data && r.data.ok) { reportStats.sent++; return; }
      reportStats.failed++;
      setTimeout(function () { postJson('/event', body, 8000).catch(function () {}); }, 1500);   // 静默重试一次
    }).catch(function () {});
  }

  // ---------------- 家具 / 天气 / 照片 / 布置 观察 ----------------
  var furnWrapped = false;
  function wrapFurniture() {
    var v = V3(), F = v && v.furniturePlay;
    if (!F || furnWrapped) return;
    furnWrapped = true;
    var origReduce = F.reduce;
    if (typeof origReduce === 'function') {
      F.reduce = function (kind, state, action, dt) {
        var out = origReduce.apply(this, arguments);       // 绝不改返回行为
        try { observeReduce(kind, state, action, out); } catch (e) { warnOnce('furn:reduce', 'furniturePlay.reduce 观察失败：' + (e && e.message || e)); }
        return out;
      };
    }
    var origAction = F.action;
    if (typeof origAction === 'function') {
      F.action = function (key, action) {
        var out, err = null;
        try { out = origAction.apply(this, arguments); } catch (e) { err = e; }
        try { observeAction(key, action); } catch (e2) { warnOnce('furn:action', 'furniturePlay.action 观察失败：' + (e2 && e2.message || e2)); }
        if (err) throw err;
        return out;
      };
    }
  }
  var TV_CHANNEL_NAME = ['海边频道', '星空频道', '天气频道'];
  function observeReduce(kind, prevState, action, next) {
    if (!kind || !next || typeof next !== 'object') return;
    var prev = prevState && typeof prevState === 'object' ? prevState : {};
    if (kind === 'tv') {
      if (action === 'toggle' && next.on !== prev.on) report(next.on ? 'tv_on' : 'tv_off', { on: !!next.on }, next.on ? '她打开了电视' : '她关掉了电视');
      else if (action === 'next' && next.channel !== prev.channel) report('tv_channel', { channel: next.channel, name: TV_CHANNEL_NAME[next.channel] || '' }, '她换到了' + (TV_CHANNEL_NAME[next.channel] || '另一个台'));
    } else if (kind === 'cooker') {
      if (action === 'cook' && next.phase === 'cooking' && prev.phase !== 'cooking') report('rice_cook', { phase: next.phase }, '她把饭煮上了');
      else if (action === 'serve' && next.bowl && !prev.bowl) report('rice_serve', { bowl: true }, '她盛了一碗饭');
      else if (action === 'eat' && !next.bowl && prev.bowl) report('rice_eat', { bowl: false }, '她把饭吃了');
    }
  }
  function observeAction(key, action) {
    if (!key || typeof key !== 'string' || !action) return;
    var kind = key.split(':')[0];
    if (kind === 'rocker' && action === 'sit') {
      // 摇椅是异步的（先走过去再坐）：过几秒看她的状态，确认真坐上了再上报一次
      checkRocker(key, 0);
    } else if (kind === 'door' || kind === 'lamp') {
      setTimeout(function () {
        var v = V3(), HB = v && v.houseBlocks;
        if (!HB || typeof HB.switchState !== 'function') return;
        var s = null;
        try { s = HB.switchState(key); } catch (e) { return; }
        if (!s) return;
        if (kind === 'door') {
          var open = s.mode !== 'closed';
          report(open ? 'door_open' : 'door_close', { mode: s.mode || '' }, open ? '门打开了' : '门关上了');
        } else {
          var on = s.enabled !== false;
          report('light_toggle', { enabled: on }, on ? '灯亮了' : '灯灭了');
        }
      }, 500);
    }
  }
  function checkRocker(key, attempt) {
    setTimeout(function () {
      var v = V3(), F = v && v.furniturePlay;
      var sitting = false;
      try {
        var st = F && typeof F.state === 'function' ? F.state() : null;
        var it = st && st.items ? st.items.filter(function (r) { return r.key === key; })[0] : null;
        sitting = !!(it && it.sitting);
      } catch (e) {}
      if (sitting) { report('rocking_sit', { key: key }, '她坐上摇椅摇了一会儿'); return; }
      if (attempt < 2) checkRocker(key, attempt + 1);   // 约 4s、10s 各看一次
    }, attempt === 0 ? 4000 : 6000);
  }

  var photoSig = null;
  function onPhotos(state) {
    try {
      var arr = Array.isArray(state) ? state : [];
      var cur = Object.create(null);
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i] || {};
        var k = (it.cell || []).join(',') + '#' + it.slot;
        cur[k] = it.id || null;
      }
      if (photoSig === null) { photoSig = cur; return; }     // 首次：只记基线，不上报
      var added = 0, removed = 0, changed = 0, k2;
      for (k2 in cur) {
        if (!(k2 in photoSig)) { if (cur[k2]) added++; continue; }
        if (photoSig[k2] !== cur[k2]) {
          if (photoSig[k2] && cur[k2]) changed++;
          else if (cur[k2]) added++;
          else removed++;
        }
      }
      for (k2 in photoSig) if (!(k2 in cur) && photoSig[k2]) removed++;
      photoSig = cur;
      if (added) report('photo_add', { n: added }, added > 1 ? '往相框里挂了 ' + added + ' 张照片' : '往相框里挂了一张照片');
      else if (changed) report('photo_change', { n: changed }, '换了一张照片');
      else if (removed) report('photo_remove', { n: removed }, removed > 1 ? '取下了 ' + removed + ' 张照片' : '取下一张照片');
    } catch (e) { warnOnce('photos', '照片变化观察失败：' + (e && e.message || e)); }
  }

  var arrangeOn = false;
  function checkArrange(force) {
    var on = !!(function () { var v = V3(); return v && v.arrange && v.arrange.on; })();
    if (!force && on === arrangeOn) return arrangeOn;
    arrangeOn = on;
    report(on ? 'arrange_start' : 'arrange_end', {}, on ? '开始布置小屋' : '布置完了');
    if (on) closeChat();
    return on;
  }

  var wxKind = null, wxTemp = null;
  function checkWeather() {
    var v = V3(), w = null;
    try { w = v && v.wx && v.wx.now ? v.wx.now() : (v && v.env && v.env.state && v.env.state.wx); } catch (e) { return; }
    var kind = null, tempC = null;
    if (w && typeof w === 'object') {
      kind = typeof w.kind === 'string' ? w.kind : null;
      tempC = Number.isFinite(Number(w.tempC)) ? Math.round(Number(w.tempC)) : null;
    } else if (typeof w === 'string') kind = w;
    if (!kind) return;
    var label = WX_LABEL[kind] || '';
    // 第一次读到天气也上报一次（之前只在变化时才报，桥接那边一直不知道外面什么天气/几度）
    if (wxKind === null) {
      wxKind = kind; wxTemp = tempC;
      report('weather', { wx: kind, tempC: tempC, label: label, initial: true }, (label ? '外面' + label : '天气') + (tempC != null ? ' ' + tempC + '°C' : ''));
      return;
    }
    if (kind === wxKind && tempC === wxTemp) return;
    wxKind = kind; wxTemp = tempC;
    report('weather', { wx: kind, tempC: tempC, label: label }, (label ? '外面' + label : '天气变了') + (tempC != null ? ' ' + tempC + '°C' : ''));
  }

  // ---------------- 状态轮询 + chip ----------------
  var stateBusy = false;
  var lastLineKeys = null;
  var lastSpeakAt = 0;
  var speakTimers = 0;

  function moodTextFor(home) {
    if (!home) return '不知道';
    var m = MOOD_LABEL[home.mood];
    if (m) return m;
    var t = String(home.moodText || '').trim();
    if (t && t.length <= 12) return t;
    return '不知道';
  }
  function updateChip(home, degraded) {
    if (!chipText) return;
    if (degraded) {
      chipText.textContent = '她现在：QQ 助手没开';
      chip.classList.add('cb-degraded');
      chip.classList.remove('cb-live');
      chip.title = '小屋服务在，但 QQ 助手（桥接）这边没连上' +
        (bridge.lastError ? '：' + bridge.lastError : '') + '。点一下看最近的家里事件。';
      return;
    }
    chip.classList.remove('cb-degraded');
    chip.classList.add('cb-live');
    var status = String((home && home.statusText) || '').trim() || '在家里待着';
    chipText.textContent = '她现在：' + status + ' · ' + moodTextFor(home);
    chip.title = String((home && home.moodText) || '') || chipText.textContent;
    var mood = (home && home.mood) || '';
    chip.setAttribute('data-mood', mood);
  }
  function fmtTime(t) {
    try {
      var d = new Date(Number(t) || Date.now()), p = function (n) { return (n < 10 ? '0' : '') + n; };
      return p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return ''; }
  }
  function renderEvents(events) {
    if (!panelEvents) return;
    panelEvents.textContent = '';
    var list = Array.isArray(events) ? events.slice(-5).reverse() : [];
    if (!list.length) {
      panelEvents.appendChild(el('div', 'cb-ev cb-ev-empty', '还没有什么家里的事'));
      return;
    }
    for (var i = 0; i < list.length; i++) {
      var ev = list[i] || {};
      var row = el('div', 'cb-ev');
      row.appendChild(el('span', 'cb-ev-t', fmtTime(ev.t)));
      row.appendChild(el('span', 'cb-ev-x', String(ev.text || ev.type || '')));
      panelEvents.appendChild(row);
    }
  }
  var lastPaintingNotice = '';
  function handleState(res) {
    if (!res || !res.ok || !res.data || !res.data.ok) {
      var msg = (res && res.data && res.data.error) || (res && res.status === 503 ? 'QQ 助手没开' : (res && res.netError ? '连不上小屋服务' : '状态取不到'));
      bridge.lastError = msg;
      updateChip(null, true);
      return;
    }
    var data = res.data;
    bridge.lastState = data;
    var v = V3();
    if (v && v.cabinRoutine) v.cabinRoutine.acceptEvents(data.cabinActivityEvents);
    var artReady = data.cabinActivityEvents?.findLast(e => e.action === 'art_ready');
    if (artReady && artReady.id !== lastPaintingNotice && window.__cabinGallery && !(v?.backgroundPaused?.() ?? document.hidden)) {
      lastPaintingNotice = artReady.id;
      void window.__cabinGallery.sync('new-drawing');
    }
    bridge.lastError = null;
    updateChip(data.home || {}, false);
    if (panelEvents) renderEvents(data.recentEvents || []);
    // recentLines：新条目用气泡播报（去重、别刷屏）
    var lines = Array.isArray(data.recentLines) ? data.recentLines : [];
    var keys = [];
    for (var i = 0; i < lines.length; i++) keys.push(String((lines[i] && lines[i].t) || 0) + '|' + String((lines[i] && lines[i].text) || ''));
    if (lastLineKeys === null) { lastLineKeys = keys.slice(); return; }   // 第一次只记基线，不把旧话全播一遍
    for (var j = 0; j < lines.length; j++) {
      var k = keys[j];
      if (lastLineKeys.indexOf(k) >= 0) continue;
      lastLineKeys.push(k);
      var text = String((lines[j] && lines[j].text) || '').trim();
      if (!text || wasSpoken(text)) continue;
      rememberSpoken(text);
      queueSpeak(text, (data.home && data.home.mood) || 'calm');
    }
    if (lastLineKeys.length > 120) lastLineKeys.splice(0, lastLineKeys.length - 120);
  }
  function queueSpeak(text, mood) {
    var now = Date.now();
    var wait = Math.max(0, 10000 - (now - lastSpeakAt));
    if (wait <= 0) { lastSpeakAt = now; sayLine(text, mood); return; }
    if (speakTimers >= 3) return;   // 已排队够多了就不再堆
    speakTimers++;
    setTimeout(function () {
      speakTimers--;
      lastSpeakAt = Date.now();
      sayLine(text, mood);
    }, wait);
  }
  function pollState() {
    if (stateBusy) return;
    stateBusy = true;
    getJson('/state', 8000).then(function (r) {
      stateBusy = false;
      try { handleState(r); } catch (e) { warnOnce('state:apply', '状态应用失败：' + (e && e.message || e)); }
    }).catch(function () { stateBusy = false; });
  }

  // ---------------- 自主活动 ----------------
  var executedActs = Object.create(null);
  var executedCount = 0;
  var activityBusy = false;

  function walkablePoint(p) {
    var nav = null;
    try { var v = V3(); nav = v && v.nav; } catch (e) {}
    if (!nav || typeof nav.walkable !== 'function') return p;
    try {
      if (nav.walkable(p[0], p[1])) return p;
    } catch (e) {}
    var offsets = [[0, 0.6], [0, -0.6], [0.6, 0], [-0.6, 0], [0, 1.2], [0, -1.2], [1.2, 0], [-1.2, 0], [0, 1.8], [0, -1.8]];
    for (var i = 0; i < offsets.length; i++) {
      var q = [p[0] + offsets[i][0], p[1] + offsets[i][1]];
      try { if (nav.walkable(q[0], q[1])) return q; } catch (e) {}
    }
    return SAFE.porch;
  }
  function actorGoto(p) {
    var a = actor();
    if (!a || typeof a.goto !== 'function') return Promise.resolve(false);
    var pt = walkablePoint(p);
    var r = callActor('goto', [pt[0], pt[1]]);
    if (!r.called) return Promise.resolve(false);
    return Promise.resolve(r.value).then(function (x) { return !!x; }, function () { return false; });
  }
  function gotoPointFor(act) {
    var d = act && act.detail && typeof act.detail === 'object' ? act.detail : null;
    if (d && Number.isFinite(+d.x) && Number.isFinite(+d.z)) return [+d.x, +d.z];
    if (act && Number.isFinite(+act.x) && Number.isFinite(+act.z)) return [+act.x, +act.z];
    return null;
  }
  function runActivity(act) {
    var action = String((act && act.action) || 'idle');
    var text = String((act && act.text) || '').trim();
    var mood = (act && act.mood) || 'calm';
    var id = act && act.id ? String(act.id) : '';
    report('activity_start', { id: id, action: action });
    var done = function () { setTimeout(function () { report('activity_done', { id: id, action: action }); }, 1200); };
    var walking = null;
    try {
      if (action === 'wander') {
        var w = callActor('wander', []);
        if (!w.called) { if (text) sayLine(text, mood); }
      } else if (action === 'collect') {
        var c = callActor('collect', []);
        if (!c.called || !c.value) { if (text) sayLine(text, mood); }
      } else if (action === 'goto') {
        var gp = gotoPointFor(act) || SAFE.porch;
        walking = actorGoto(gp);
      } else if (action === 'sit_porch') {
        walking = actorGoto(SAFE.porch);
      } else if (action === 'stargaze') {
        walking = actorGoto(SAFE.stargaze);
      } else if (action === 'sleep') {
        walking = actorGoto(SAFE.porchDoor);
      } else if (action === 'sit_rocking') {
        walking = actorGoto(SAFE.rocking);
      } else if (action === 'watch_tv') {
        walking = actorGoto(SAFE.tv);
      } else if (action === 'cook_rice') {
        walking = actorGoto(SAFE.kitchen);
      }
      // respond / idle / 未知 action：只冒泡（兜底，不崩）
      if (text) setTimeout(function () { sayLine(text, mood); }, action === 'respond' || action === 'idle' ? 0 : 700);
    } catch (e) {
      warnOnce('act:' + action, '执行活动 ' + action + ' 失败：' + (e && e.message || e));
      if (text) sayLine(text, mood);
    }
    if (walking) Promise.resolve(walking).catch(function () {}).then(done);
    else done();
  }
  function pollActivity() {
    var v = V3();
    if (v && v.cabinRoutine) return v.cabinRoutine.tick();
    if (activityBusy) return;
    activityBusy = true;
    getJson('/activity', 8000).then(function (r) {
      activityBusy = false;
      if (!r || !r.ok || !r.data || !r.data.ok) return;
      var act = r.data.activity;
      if (!act || !act.id) return;
      var id = String(act.id);
      if (executedActs[id]) return;                 // 新 id 才执行
      if (actorBusy()) return;                      // 她在忙（捡贝壳/走路/坐家具/回应）：不插队，下次轮询再看
      executedActs[id] = 1;
      if (++executedCount > 300) { executedActs = Object.create(null); executedActs[id] = 1; executedCount = 1; }
      try { runActivity(act); } catch (e) { warnOnce('act:run', '活动执行失败：' + (e && e.message || e)); }
    }).catch(function () { activityBusy = false; });
  }

  // ---------------- DOM / UI ----------------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  var root = null, chip = null, chipText = null, panelEvents = null, chatToggle = null, chatPanel = null;
  var msgList = null, chatInput = null, chatSend = null, chatHint = null;
  var chatOpen = false;
  var sending = false;

  var CHAT_KEY = 'cabinBridge.chat.v1';
  function loadHistory() {
    try {
      var raw = sessionStorage.getItem(CHAT_KEY);
      var arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) ? arr.filter(function (m) { return m && m.text && (m.who === 'me' || m.who === 'her'); }).slice(-80) : [];
    } catch (e) { return []; }
  }
  var history = loadHistory();
  function saveHistory() {
    try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(history.slice(-80))); } catch (e) {}
  }
  function appendMsg(who, text) {
    history.push({ who: who, text: String(text), at: Date.now() });
    if (history.length > 80) history.splice(0, history.length - 80);
    saveHistory();
    renderMsgs();
  }
  function renderMsgs() {
    if (!msgList) return;
    msgList.textContent = '';
    if (!history.length) {
      msgList.appendChild(el('div', 'cb-msg cb-msg-empty', '跟她说句话吧～她在小屋里等你。'));
    } else {
      for (var i = 0; i < history.length; i++) {
        var m = history[i];
        var row = el('div', 'cb-msg ' + (m.who === 'me' ? 'cb-me' : 'cb-her'));
        row.appendChild(el('span', 'cb-bubble', m.text));
        msgList.appendChild(row);
      }
    }
    try { msgList.scrollTop = msgList.scrollHeight; } catch (e) {}
  }
  function setBusy(on) {
    sending = !!on;
    if (chatPanel) chatPanel.classList.toggle('cb-busy', !!on);
    if (chatSend) { chatSend.disabled = !!on; chatSend.textContent = on ? '…' : '发送'; }
    var cur = chatPanel ? chatPanel.querySelector('.cb-typing') : null;
    if (on) {
      if (!cur && msgList) {
        var row = el('div', 'cb-msg cb-her cb-typing');
        row.appendChild(el('span', 'cb-bubble', '她在想…'));
        msgList.appendChild(row);
        try { msgList.scrollTop = msgList.scrollHeight; } catch (e) {}
      }
    } else if (cur) cur.remove();
  }
  function chatError(text) {
    if (chatHint) { chatHint.textContent = text; chatHint.classList.add('cb-on'); }
    toast(text);
  }
  function sendChat() {
    if (sending || !chatInput) return;
    var text = String(chatInput.value || '').trim();
    if (!text) return;
    if (text.length > 1200) text = text.slice(0, 1200);
    chatInput.value = '';
    if (chatHint) { chatHint.textContent = ''; chatHint.classList.remove('cb-on'); }
    appendMsg('me', text);
    setBusy(true);
    chatRequest(text).then(function (r) {
      setBusy(false);
      var data = r && r.data;
      if (r && r.ok && data && data.ok && data.reply && data.reply.text) {
        var reply = String(data.reply.text);
        var mood = (data.reply && data.reply.mood) || 'happy';
        appendMsg('her', reply);
        rememberSpoken(reply);
        respondLine(reply, mood);
        return;
      }
      var msg = (data && data.error) || (r && r.status === 503 ? 'QQ 助手没开，她现在听不到小屋这边说话' : (r && r.status === 0 ? '连不上小屋服务' : '她没回上来'));
      chatError('⚠ ' + msg);
    }).catch(function (e) {
      setBusy(false);
      chatError('⚠ 发送失败：' + ((e && e.message) || e));
    });
  }
  function openChat() {
    chatOpen = true;
    if (chatPanel) chatPanel.classList.add('cb-open');
    if (root) root.classList.add('cb-chat-open');
    if (chatToggle) chatToggle.textContent = '收起';
    renderMsgs();
    setTimeout(function () { try { chatInput && chatInput.focus(); } catch (e) {} }, 60);
  }
  function closeChat() {
    chatOpen = false;
    if (chatPanel) chatPanel.classList.remove('cb-open');
    if (root) root.classList.remove('cb-chat-open');
    if (chatToggle) chatToggle.textContent = '和她说话';
  }
  function toggleChat() { if (chatOpen) closeChat(); else openChat(); }
  function toast(text) {
    try {
      var v = V3();
      if (v && v.hud && typeof v.hud.toast === 'function') { v.hud.toast(text); return; }
    } catch (e) {}
    var t = el('div', 'cb-toast', text);
    try {
      document.body.appendChild(t);
      setTimeout(function () { t.classList.add('cb-out'); setTimeout(function () { t.remove(); }, 400); }, 2600);
    } catch (e) {}
  }

  function mountUI() {
    if (root || !document.body) return;
    root = el('div', 'cb-root');
    root.id = 'cabin-bridge';

    chip = el('button', 'cb-chip');
    chip.type = 'button';
    chip.setAttribute('aria-live', 'polite');
    chip.appendChild(el('span', 'cb-dot'));
    chipText = el('span', 'cb-chip-text', '她现在：正在连小屋…');
    chip.appendChild(chipText);
    chip.addEventListener('click', function () {
      var open = panelEvents && panelEvents.hasAttribute('hidden');
      if (!panelEvents) return;
      if (open) { panelEvents.removeAttribute('hidden'); chip.setAttribute('aria-expanded', 'true'); }
      else { panelEvents.setAttribute('hidden', ''); chip.setAttribute('aria-expanded', 'false'); }
    });

    panelEvents = el('div', 'cb-events');
    panelEvents.setAttribute('hidden', '');
    panelEvents.appendChild(el('div', 'cb-ev-head', '最近在家里'));

    chatToggle = el('button', 'cb-chat-toggle', '和她说话');
    chatToggle.type = 'button';
    chatToggle.addEventListener('click', toggleChat);

    chatPanel = el('aside', 'cb-panel');
    var head = el('div', 'cb-panel-head');
    head.appendChild(el('strong', 'cb-panel-title', '和小鲸鱼说说话'));
    var closeBtn = el('button', 'cb-panel-close', '×');
    closeBtn.type = 'button';
    closeBtn.title = '收起';
    closeBtn.addEventListener('click', closeChat);
    head.appendChild(closeBtn);
    msgList = el('div', 'cb-msgs');
    var form = el('form', 'cb-form');
    chatInput = el('textarea', 'cb-input');
    chatInput.rows = 1;
    chatInput.maxLength = 1200;
    chatInput.placeholder = '跟她说点什么…（Enter 发送，Shift+Enter 换行）';
    chatSend = el('button', 'cb-send', '发送');
    chatSend.type = 'submit';
    form.appendChild(chatInput);
    form.appendChild(chatSend);
    chatHint = el('div', 'cb-hint');
    form.appendChild(chatHint);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      sendChat();
    });
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
    });
    chatPanel.appendChild(head);
    chatPanel.appendChild(msgList);
    chatPanel.appendChild(form);

    root.appendChild(panelEvents);
    root.appendChild(chip);
    root.appendChild(chatToggle);
    root.appendChild(chatPanel);
    document.body.appendChild(root);

    renderMsgs();

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && chatOpen) { closeChat(); }
    });
  }

  // 布置 / 反馈 / ui=0 时让开：收起聊天、淡出 chip
  function uiTick() {
    try {
      checkArrange(false);
      var v = V3();
      var fb = !!(v && v.fb && v.fb.enabled);
      var uiOff = !!(document.body && document.body.classList.contains('ui-off'));
      var hide = arrangeOn || fb || uiOff;
      if (root) root.classList.toggle('cb-hidden', hide);
      if (hide && chatOpen) closeChat();
    } catch (e) { warnOnce('uitick', 'UI tick 失败：' + (e && e.message || e)); }
  }

  // ---------------- 启动 ----------------
  var bridge = window.__cabinBridge = {
    version: VERSION,
    ready: false,
    actorReady: false,
    lastState: null,
    lastError: null,
    lastActivityId: null,
    stats: reportStats,
    api: {
      state: function () { return getJson('/state', 8000); },
      chat: chatRequest,
      shareStarChart: shareStarChart,
      queueDrawing: queueDrawing,
      generateDrawing: generateDrawing,
      event: function (type, detail, text) { return postJson('/event', { type: type, detail: detail || {}, text: text || '' }, 8000); },
      activity: function () { return getJson('/activity', 8000); },
      refreshState: pollState,
      pollActivity: pollActivity,
      report: report,
      say: sayLine,
      respond: respondLine,
      speakRecent: queueSpeak,
      openChat: openChat,
      closeChat: closeChat,
      mounted: false
    }
  };

  function markActorReady(a) {
    if (bridge.actorReady) return;
    bridge.actorReady = true;   // 就绪标记；不主动说话，免得一进页面就冒泡
  }
  function waitActor() {
    var t0 = Date.now();
    (function poll() {
      if (bridge.actorReady) return;
      var v = V3();
      if (v && v.actor) { markActorReady(v.actor); return; }
      if (v && typeof v.on === 'function' && !waitActor.bound) {
        waitActor.bound = true;
        try { v.on('actor:ready', function (a) { markActorReady(a); }); } catch (e) {}
      }
      if (Date.now() - t0 > ACTOR_WAIT_MS) { warnOnce('actor:timeout', '等了 20 秒 V3.actor 还没就绪，气泡 / 动作先跳过；页面其它功能不受影响。'); return; }
      setTimeout(poll, 500);
    })();
  }
  function bindEvents() {
    var v = V3();
    if (!v || typeof v.on !== 'function' || bindEvents.done) return;
    bindEvents.done = true;
    try {
      v.on('game:collect', function (e) {
        var kind = (e && e.kind) || {};
        var name = kind.name || kind.label || '贝壳';
        var by = e && e.by === 'girl' ? 'girl' : 'player';
        var op = e && e.operation;
        var inst = (e && e.instance) || (e && e.item) || null;
        var patName = '';
        try {
          var R = v.inventoryRules;
          if (R && R.pattern && inst && inst.pat) patName = R.pattern(inst.pat).name || '';
        } catch (e2) { /* 规则缺失不影响拾取 */ }
        durableEvent({
          id: op && 'collect:' + op.id, at: op && op.at,
          type: kind.category === 'trash' ? 'trash_collect' : 'shell_collect',
          detail: {
            name: name, kind: kind.id || '', n: (e && e.n) || 1, by: by, first: !!(e && e.first),
            category: kind.category || '', rarity: kind.rarity || '',
            size: inst && Number.isFinite(Number(inst.size)) ? Number(inst.size) : null,
            pat: inst && inst.pat ? inst.pat : '', patName: patName,
            crown: (e && e.crown) || null
          },
          text: (by === 'girl' ? '她捡到了' : kind.category === 'trash' ? '你捡到了' : '玩家捡到了') + name
        });
      });
    } catch (e) { warnOnce('bind:collect', 'game:collect 监听失败：' + (e && e.message || e)); }
    try { v.on('game:cabin-event', durableEvent); } catch (e) { warnOnce('bind:cabin-event', '小屋流水接入失败'); }
    try {
      v.on('actor:poke', function (e) { report('poke', { count: (e && e.count) || 0 }, '你戳了戳她'); });
    } catch (e) { warnOnce('bind:poke', 'actor:poke 监听失败：' + (e && e.message || e)); }
    try { v.on('photos:frames', onPhotos); } catch (e) { warnOnce('bind:photos', 'photos:frames 监听失败：' + (e && e.message || e)); }
    try { v.on('arrange', function (on) { try { checkArrange(true); } catch (e2) {} }); } catch (e) { warnOnce('bind:arrange', 'arrange 监听失败：' + (e && e.message || e)); }
    try { v.on('wx', function () { try { checkWeather(); } catch (e2) {} }); } catch (e) { warnOnce('bind:wx', 'wx 监听失败：' + (e && e.message || e)); }
    try { v.on('game:settings', function (e) { if (e && e.key === 'weather') setTimeout(checkWeather, 1500); }); } catch (e) { warnOnce('bind:settings', 'game:settings 监听失败：' + (e && e.message || e)); }
    try { wrapFurniture(); } catch (e) { warnOnce('wrap:furniture', '家具观察接入失败：' + (e && e.message || e)); }
  }

  // ---------------- 沙盘工具（V3.cabinTools ↔ 桥接工具队列） ----------------
  // 页面只执行已注册的工具；身份由桥接保证（只在小屋聊天那一会话注册）。
  // 每次长轮询 25s 由桥接挂住，页面没开时桥接直接回 page_offline。
  function bindCabinTools() {
    if (bindCabinTools.done) return;
    var v = V3(), T = v && v.cabinTools;
    if (!T || typeof T.connect !== 'function' || typeof T.list !== 'function') {
      warnOnce('tools:missing', '页面没有 cabinTools（旧构建），沙盘工具未接');
      return;
    }
    bindCabinTools.done = true;
    var revision = 0;
    function pushList() {
      try {
        var tools = T.list();
        if (!tools || !tools.length) return;
        postJson('/tool/list', { client: TOOL_CLIENT_ID, tools: tools }, 5000).then(function (r) {
          if (!r || !r.ok) warnOnce('tools:list', '工具清单上报失败（HTTP ' + (r && r.status) + '）');
        });
      } catch (e) { warnOnce('tools:list', '工具清单上报失败：' + (e && e.message || e)); }
    }
    try {
      T.connect({
        next: function () {
          var query = '?client=' + encodeURIComponent(TOOL_CLIENT_ID) + '&visible=' + (document.hidden ? '0' : '1') + '&background=' + (document.hidden && running() ? '1' : '0') + '&revision=' + revision;
          return getJson('/tool/next' + query, 30000)
            .then(function (r) { return r && r.ok && r.data ? r.data : null; })
            .catch(function () { return null; });
        },
        reply: function (callId, result) {
          return postJson('/tool/result', { callId: callId, result: result }, 8000)
            .then(function (r) { return r && r.ok ? r.data : null; })
            .catch(function () { return null; });
        }
      });
    } catch (e) {
      warnOnce('tools:connect', 'cabinTools.connect 失败：' + (e && e.message || e));
      bindCabinTools.done = false;
      return;
    }
    pushList();
    function reportVisibility() {
      postJson('/tool/visibility', { client: TOOL_CLIENT_ID, visible: !document.hidden, background: document.hidden && running(), revision: ++revision }, 5000);
    }
    document.addEventListener('visibilitychange', reportVisibility);
    if (v.on) v.on('game:settings', function (e) { if (e?.key === 'powerSaving' && document.hidden) reportVisibility(); });
    try { window.addEventListener('beforeunload', function () { try { T.disconnect && T.disconnect(); } catch (e2) {} }); } catch (e2) {}
    bridge.tools = { client: TOOL_CLIENT_ID, connected: true };
  }

  function init() {
    try { mountUI(); } catch (e) { warnOnce('mount', 'UI 挂载失败：' + (e && (e.message || e))); }
    bridge.api.mounted = !!root;
    var v = V3();
    if (v && v.cabinRoutine) v.cabinRoutine.setUploader(function (events) { return postJson('/behavior', { events: events }, 5000); });
    restoreEventQueue();
    restoreDrawings();
    setInterval(function () { if (running()) void flushDrawings(); }, 60000);
    flushEvents();
    setInterval(function () { if (running()) flushEvents(); }, 7000);
    try { bindEvents(); } catch (e) { warnOnce('bind', '事件接入失败：' + (e && (e.message || e))); }
    try { bindCabinTools(); } catch (e) { warnOnce('bind:tools', '沙盘工具接入失败：' + (e && (e.message || e))); }
    try { waitActor(); } catch (e) { warnOnce('waitActor', '等待角色失败：' + (e && (e.message || e))); }
    // 首次状态：立刻拉一次（成败都行，chip 从「正在连小屋」变成真实状态）
    try { pollState(); } catch (e) {}
    // 轮询
    setInterval(function () { if (running()) { try { pollState(); } catch (e) {} } }, POLL_STATE_MS);
    setInterval(function () { if (running()) { try { pollActivity(); } catch (e) {} } }, POLL_ACTIVITY_MS);
    setInterval(function () { if (running()) { try { checkWeather(); } catch (e) {} } }, WEATHER_POLL_MS);
    try { checkArrange(false); } catch (e) {}
    setInterval(uiTick, UI_TICK_MS);
    try { checkWeather(); } catch (e) {}
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { try { pollState(); } catch (e) {} }
    });
    bridge.ready = true;
  }

  // 页面可能还没到 DOMContentLoaded（defer 脚本先跑）；body 一般已经有。
  try {
    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
  } catch (e) {
    warnOnce('boot', '启动失败：' + (e && (e.message || e)));
    bridge.lastError = String((e && (e.message || e)) || e);
  }
})();
