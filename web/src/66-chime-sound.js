// 66-chime-sound.js — 贝壳风铃会响（docs/FURNITURE.md 9.3；用户 2026-11-07：网页里「当然要有」）。
// 和 MC 里一样（模组的 WindChimes.java）：房子方块里每个 xiaojingyu:wind_chime 正下方那一列、往下 3 格以内，
// 她刚走进来就响一串：2–3 下，每下隔 0.15–0.25 秒，音高 0.8–1.6 倍随机；同一个风铃 1 秒内不重复响，站着不动不再响。
// 响的时候门上方的体素风铃也被碰一下（55-house-detail 的 chimeKick）。
// 声音是 WebAudio 现合成的：几个不成整数倍的正弦泛音（像紫水晶 / 玻璃风铃，MC 里用的是原版紫水晶风铃声）+ 一点点碰撞的「嗒」，
// 不用声音文件。离镜头越远越小声（24 米外听不见），左右按镜头方向分声道。设置「房子」页的「风铃声」可以关。
// 浏览器要等页面上点过一次（或按过键）才出声：之前她走过照样摆、照样计数，只是没声音。
// 点一下风铃（2026-11-12，91-cabin 的 'chime'）：V3.chimes.click({ cell, obj }) 摇一下、响同样的一串；不受上面 1 秒的限制，
// 但同一个风铃 0.4 秒（真实时间）内只算一次点击（连点不会叠出一大片声音）。
// V3.audio.ctx()：共用的 AudioContext（没有就 null）。V3.chimes = { list(), stats(), test(x, y, z), click(t) }。
(function (V3) {
  const BELOW = 3, COOLDOWN = 1.0, CLICK_COOLDOWN = 0.4, HALF = 0.25, HEAR = 24;
  const G = () => V3.game;
  const on = () => !(G() && G().get && G().get('chimeSound') === false);

  // ---- 共用的 AudioContext：第一次点 / 按键时建好（或恢复），之后谁要都给同一个 ----
  const AU = V3.audio = V3.audio || {};
  let actx = null;
  AU.ctx = AU.ctx || function () {
    if (actx) return actx;
    try { const AC = window.AudioContext || window.webkitAudioContext; actx = AC ? new AC() : null; } catch (e) { actx = null; }
    return actx;
  };
  const unlock = () => { const c = AU.ctx(); if (c && c.state === 'suspended') c.resume().catch(() => {}); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true, passive: true });

  // ---- 一下风铃声：when = AudioContext 时间，pitch = 音高倍数，vol 0..1，pan −1..1 ----
  const PARTS = [[1, 1, 1.5], [2.76, 0.42, 0.8], [5.4, 0.2, 0.45], [8.93, 0.09, 0.25]];   // [频率倍数, 音量, 衰减秒]
  function hit(c, when, pitch, vol, pan) {
    const out = c.createGain(); out.gain.value = vol * 0.22;
    let tail = out;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; out.connect(p); tail = p; }
    tail.connect(c.destination);
    const f0 = 1180 * pitch;
    for (const [k, a, d] of PARTS) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f0 * k * (1 + (Math.random() - 0.5) * 0.004);
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(a, when + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, when + d);
      o.connect(g); g.connect(out); o.start(when); o.stop(when + d + 0.05);
    }
    const n = Math.floor(c.sampleRate * 0.02), buf = c.createBuffer(1, n, c.sampleRate), ch = buf.getChannelData(0);   // 贝壳碰一下的「嗒」
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const src = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; hp.type = 'highpass'; hp.frequency.value = 2500; g.gain.value = 0.18;
    src.connect(hp); hp.connect(g); g.connect(out); src.start(when);
  }

  // ---- 房子里的风铃：方块读好（house:blocks）时找一遍 ----
  let list = null, under = new Set(), primed = false;
  const last = new Map(), S = { rings: 0, hits: 0, played: 0, clicks: 0, last: null };
  const clickAt = new Map(); let clickObj = new WeakMap(), wp = null;   // 上次被点的时刻：按格子（方块房子）/ 按那件东西（旧布局，没有格子）
  function find() {
    const HB = V3.houseBlocks, Gd = HB && HB.grid;
    list = [];
    if (!Gd) return list;
    for (let i = 0; i < Gd.cells.length; i++) {
      const s = Gd.st[Gd.cells[i]];
      if (!s || s.ns !== 'xiaojingyu' || s.id !== 'wind_chime') continue;
      const x = i % Gd.W, z = Math.floor(i / Gd.W) % Gd.L, y = Math.floor(i / (Gd.W * Gd.L));
      list.push([Gd.org[0] + x, Gd.org[1] + y, Gd.org[2] + z]);
    }
    return list;
  }
  if (V3.on) V3.on('house:blocks', () => { list = null; under = new Set(); primed = false; last.clear(); clickAt.clear(); clickObj = new WeakMap(); });

  // 站在 (x, y, z)（脚底）、身高 h 的她，头顶往上 3 格内有哪些风铃（和 WindChimes 一样：风铃 (cx, cy, cz) 管 [cx, cx+1) × [cy−3, cy) × [cz, cz+1)）
  function above(x, y, z, h) {
    const out = [];
    for (let i = 0; i < (list || find()).length; i++) {
      const [cx, cy, cz] = list[i];
      if (x + HALF <= cx || x - HALF >= cx + 1 || z + HALF <= cz || z - HALF >= cz + 1) continue;
      if (y < cy && y + h > cy - BELOW) out.push(i);
    }
    return out;
  }
  function ring(i, now, gust = false) {
    if (now - (last.get(i) ?? -1e9) < COOLDOWN) return;
    last.set(i, now);
    const [cx, cy, cz] = list[i], n = 2 + (Math.random() < 0.5 ? 1 : 0);
    S.rings++; S.hits += n; S.last = [cx, cy, cz];
    if (!gust && V3.houseDetail && V3.houseDetail.chimeKick) V3.houseDetail.chimeKick([cx, cy, cz]);   // 阵风已经摆动过，不再踢一次
    if (!on()) return;
    const c = AU.ctx(); if (!c || c.state !== 'running') return;
    if (sound(c, [cx + 0.5, cy + 0.5, cz + 0.5], n)) S.played++;
  }
  // 在 p（世界坐标）响一串 n 下：离镜头越远越小声、按镜头方向分左右。真的排了声音返回 true（太远听不见 → false）
  function sound(c, p, n) {
    const cam = V3.R && V3.R.camera;
    let vol = 1, pan = 0;
    if (cam) {
      const dx = p[0] - cam.position.x, dy = p[1] - cam.position.y, dz = p[2] - cam.position.z, d = Math.hypot(dx, dy, dz);
      vol = Math.max(0, 1 - d / HEAR);
      const yaw = cam.rotation ? new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ').y : 0;
      const rx = Math.cos(yaw) * dx - Math.sin(yaw) * dz;                // 镜头右边为正
      pan = Math.max(-0.8, Math.min(0.8, rx / Math.max(4, d)));
    }
    if (vol <= 0.01) return false;
    let t = c.currentTime + 0.02;
    for (let k = 0; k < n; k++) { hit(c, t, 0.8 + Math.random() * 0.8, vol, pan); t += 0.15 + Math.random() * 0.1; }
    return true;
  }
  let clock = 0;
  // 点击的冷却按真实时间算：帧率低的时候模块自己的 clock（每帧最多走 0.1 秒）比真实时间慢，按它算会把隔了半秒的第二下也吞掉
  const wall = () => (typeof performance !== 'undefined' && performance && performance.now ? performance.now() : Date.now()) / 1000;
  // ---- 点一下风铃：t = { cell: 风铃方块那格（方块房子）, obj: 体素风铃那一组 }，至少给一个 ----
  // 一次点击 = 一串（和她走过去一样的 2–3 下）+ 体素风铃被碰一下。刚走过（1 秒冷却里）也照样响；同一个风铃 CLICK_COOLDOWN 秒内
  // 的第二次点击不算（返回 false）。点完记进走过 / 阵风的冷却，紧跟着的阵风不再补一串。「风铃声」关着：照样摆，不出声。
  // 没有格子的（旧布局）按那件东西自己的位置响、只摆它自己。点击本身就是手势：AudioContext 还在恢复的话等它好了再响。
  function click(t) {
    const obj = t && t.obj && t.obj.isObject3D ? t.obj : null, c0 = t && t.cell;
    const cell = Array.isArray(c0) && c0.length === 3 && c0.every(Number.isFinite) ? c0.slice() : null;
    if (!cell && !obj) return false;
    const key = cell ? cell.join() : null, prev = key !== null ? clickAt.get(key) : clickObj.get(obj), now = wall();
    if (now - (prev ?? -1e9) < CLICK_COOLDOWN) return false;
    if (key !== null) clickAt.set(key, now); else clickObj.set(obj, now);
    const i = cell ? (list || find()).findIndex((p) => p.every((v, a) => v === cell[a])) : -1;
    if (i >= 0) last.set(i, clock);
    let p;
    if (cell) p = [cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5];
    else { obj.getWorldPosition(wp || (wp = new THREE.Vector3())); p = wp.toArray(); }
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    S.rings++; S.clicks++; S.hits += n; S.last = cell || p.map(Math.floor);
    if (V3.houseDetail && V3.houseDetail.chimeKick) V3.houseDetail.chimeKick(cell, obj);
    if (!on()) return true;
    const c = AU.ctx(); if (!c) return true;
    if (c.state === 'running') { if (sound(c, p, n)) S.played++; return true; }
    if (c.state !== 'suspended' || typeof c.resume !== 'function') return true;
    try {
      Promise.resolve(c.resume()).then(() => { if (c.state === 'running' && wall() - now < 0.5 && on() && sound(c, p, n)) S.played++; }, () => {});
    } catch (e) { /* 恢复不了：这一下就不出声 */ }
    return true;
  }
  if (V3.on) V3.on('chime:gust', (cell) => {
    if (!Array.isArray(cell) || cell.length !== 3 || !cell.every(Number.isFinite)) return;
    const i = (list || find()).findIndex((p) => p.every((v, a) => v === cell[a]));
    if (i >= 0) ring(i, clock, true);
  });
  function tick(dt) {
    clock += Math.min(dt || 0, 0.1);
    const A = V3.actor, pos = A && A.pos;
    if (!pos || !(list || find()).length) { under = new Set(); return; }
    const h = (V3.game && V3.game.get && V3.game.get('girlHeight')) || (V3.layout && V3.layout.girlH) || 1.3;
    const now = new Set(above(pos[0], pos[1], pos[2], h));
    if (primed) for (const i of now) if (!under.has(i)) ring(i, clock);
    under = now; primed = true;
  }
  if (V3.on) V3.on('frame', (dt) => { try { tick(dt); } catch (e) { V3.err && V3.err('chime-sound: ' + (e && e.stack || e)); } });

  V3.chimes = {
    list: () => (list || find()).map((p) => p.slice()),
    stats: () => Object.assign({ on: on(), audio: actx ? actx.state : 'none', under: [...under] }, S, { last: S.last && S.last.slice() }),
    test: (x, y, z, h) => { find(); return above(x, y, z, h || 1.3); },
    click,
    coin() { const context = on() && AU.ctx(); if (context?.state === 'running') hit(context, context.currentTime + .01, 1.65, .45, 0); },
    // 离线渲染一串（3 下、音高 0.8 / 1.2 / 1.6、正前方满音量），返回最大振幅和响的时长（测试用：有声音、不爆音）
    async offline(o) {
      const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OC) return null;
      const c = new OC(2, 44100 * 3, 44100);
      [0.8, 1.2, 1.6].forEach((p, k) => hit(c, 0.02 + k * 0.2, p, 1, 0));
      const b = await c.startRendering(), d = b.getChannelData(0);
      let peak = 0, lastLoud = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; if (v > 0.003) lastLoud = i; }
      const r = { peak, seconds: lastLoud / b.sampleRate };
      if (o && o.samples) r.samples = Array.from(d.subarray(0, lastLoud + 2205), (v) => Math.round(v * 32767));   // 16 位，存 wav 用
      return r;
    },
  };

  // ---- 游戏页设置：「房子」页加一个开关（60-game 的 SCHEMA 在 init 之后才有）----
  if (V3.on) V3.on('init', () => {
    const Gm = V3.game;
    if (!Gm || !Gm.SCHEMA || Gm.SCHEMA.some((f) => f.key === 'chimeSound')) return;
    Gm.SCHEMA.push({ key: 'chimeSound', label: '风铃声', type: 'toggle', group: '房子', def: true, hint: '阵风吹动贝壳或她从风铃下面走过时响一串（页面上点过一次以后才有声音）' });
    if (Gm.S && Gm.S.chimeSound == null) Gm.S.chimeSound = true;
  });
})(window.V3);
