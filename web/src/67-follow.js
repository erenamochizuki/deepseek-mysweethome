// 67-follow.js — V3.follow：「跟随」镜头（2026-11-12 用户要的第四个视角：镜头跟着小鲸鱼走）。
// 不是第四个楼层：楼层状态（floor）还是 外观 / 一楼 / 阁楼 三个值，跟随是叠在上面的镜头模式。按钮在 67-hud.js（楼层那一排最右边）。
//   镜头：只改轨道镜头的目标点（V3.R.ctl.g.target），每帧往她身上（脚底往上 lift 米）靠：水平按 rate、上下按 rateY 的指数平滑，
//         再经过镜头自己的阻尼（01-render 的 damp 14）——两级串起来，起步、停下都不顿；她跑步（1.5 m/s）时目标点落后约 0.3 米。
//         方位角、俯仰、远近这里只在进入时动一次（远近 dist、俯仰 el 换成默认值，方位角不动），之后都是玩家自己拖、滚轮 / 双指调的，不会被改回去。
//         平移（右键 / Shift 拖、双指挪）在跟随时不起作用（ctl.noPan），不会把跟随弄掉。时间冻住（t=…，dt 为 0）时直接贴在她身上。
//   剖开：跟着她在哪儿自动换楼层状态——屋外 → 外观（all），一楼 → 一楼（ground），阁楼 → 阁楼（loft）。都留了回差，站在门口、走在楼梯上不会来回闪：
//         进屋：走进外墙外皮 inMargin 米才算进；出屋：走出外墙外皮 outMargin 米才算出（外墙用 V3.houseBlocks.placedLayout()，挪过的房子也对）；
//         上阁楼：脚底高过 阁楼地面 − loftUp 才算上；下一楼：脚底低过 阁楼地面 − loftDown 才算下。
//   退出：V3.follow.set(false)（HUD 上再点一次「跟随」、或者点 外观 / 一楼 / 阁楼）；别处直接改了楼层状态（?view=floor=…、反馈工具）也算选了楼层，自动退出。
//   让出镜头：布置模式（V3.arrange.on）和反馈工具（V3.fb.enabled）开着时停下不动（还算开着，state().suspended）；布置完了接着跟，
//         方位角 / 俯仰 / 远近回到进布置之前跟随时的样子。没有小鲸鱼（V3.actor 是空的）时也不动，等她出来。
//   每帧都读 V3.actor（场景重建、换身体以后是新的对象）；不开的时候每帧只判断一个布尔值；开着的时候不新建任何对象。
//   不存进浏览器：楼层选的是哪个本来也不记，刷新以后都回到外观。
// API：V3.follow.on() → 开着没有；set(开不开, { snap }) → 现在开着没有（snap：镜头直接到位，不飞过去；截图用）；toggle()；
//   available() → 现在有没有小鲸鱼可跟；state() → { on, active, suspended, zone, floor, az, el, dist, target }；tick(dt)（每帧那一步，测试用）；
//   CONFIG（默认远近、俯仰、平滑、回差，可以改）。事件 'follow'（开 / 关时发，参数是开没开）。
// token：follow=1 / follow=0（?view= 和 V3.view；开的时候镜头直接到位、楼层马上换好，V3.view 会等房子画完）。
(function (V3) {
  'use strict';
  if (!V3 || !V3.util) return;
  const F = V3.follow = {};
  // dist / el：进入跟随时的远近（米）和俯仰（弧度，约 32°）。主镜头 hero 是 43 米；她身高约 1.26 米，镜头视角 30°，
  // 9 米远时画面上下能看到约 4.8 米：她占四分之一高，身边一圈家具 / 沙滩都看得见。
  const C = F.CONFIG = {
    dist: 9, el: 0.55, lift: 0.75,           // lift：目标点在她脚底往上多少米（身子中间偏上）
    rate: 8, rateY: 5,                       // 目标点往她身上靠的速度（1/秒）：水平、上下（上楼梯时高度一格一格变，上下放慢一点）
    inMargin: 0.15, outMargin: 0.45,         // 进屋 / 出屋的回差（米，量到外墙外皮）
    loftUp: 0.8, loftDown: 1.1,              // 上阁楼 / 下一楼的回差（米，量到阁楼地面往下）
  };
  let ON = false;
  let enter = false;                         // 刚打开：第一帧能跟的时候把远近、俯仰换成默认值
  let held = false, hAz = 0, hEl = 0, hDist = 0;   // 让出镜头的时候记下跟随时的方位角 / 俯仰 / 远近，接着跟的时候放回去
  let zone = 'all';                          // 现在算她在哪儿（回差要看上一次的结果）
  let appliedTo = null, applied = '';        // 上一次是在哪个模型上、换成了哪个楼层（之后楼层不是这个 = 别处改的 → 退出）

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const busy = () => !!((V3.arrange && V3.arrange.on) || (V3.fb && V3.fb.enabled));
  const floorOf = () => { const m = V3.models && V3.models.current ? V3.models.current() : null; return m && m.states && m.states.floor ? m : null; };

  // 她的脚底在 p（{ x, y, z }）：屋外 'all'、一楼 'ground'、阁楼 'loft'。按上一次的 zone 留回差。
  // 传的是 p 这个对象，不是三个小数：小数当参数传给没被内联的函数，每个都要新装一个盒子（每帧的垃圾）。
  function zoneOf(p) {
    const HB = V3.houseBlocks, L = HB && HB.placedLayout ? HB.placedLayout() : V3.layout, H = L && L.house;
    if (!H) return 'all';
    const m = zone === 'all' ? C.inMargin : -C.outMargin;
    if (!(p.x > H.x0 + m && p.x < H.x1 - m && p.z > H.z0 + m && p.z < H.z1 - m)) return 'all';
    if (H.loftY == null) return 'ground';
    return p.y >= H.loftY - (zone === 'loft' ? C.loftDown : C.loftUp) ? 'loft' : 'ground';
  }

  // 每帧一步（开着的时候才调）。→ true：这一帧在跟。不新建对象（换楼层的那一帧除外，V3.setState 自己要干活）。
  function tick(dt) {
    const R = V3.R, ctl = R && R.ctl;
    if (!ctl) return false;
    const g = ctl.g;
    if (busy()) {
      if (!held) { held = true; hAz = g.az; hEl = g.el; hDist = g.dist; }
      ctl.noPan = false;
      return false;
    }
    const a = V3.actor, root = a ? a.root : null;
    if (!root) { ctl.noPan = false; return false; }
    if (held) { held = false; g.az = hAz; g.el = hEl; g.dist = hDist; }
    if (enter) { enter = false; g.dist = clamp(C.dist, ctl.minDist, ctl.maxDist); g.el = clamp(C.el, ctl.minEl, ctl.maxEl); }
    ctl.noPan = true;
    const p = root.position, t = g.target;
    const k = dt > 0 ? 1 - Math.exp(-C.rate * dt) : 1, ky = dt > 0 ? 1 - Math.exp(-C.rateY * dt) : 1;
    t.x += (p.x - t.x) * k; t.z += (p.z - t.z) * k; t.y += (p.y + C.lift - t.y) * ky;
    const m = floorOf();
    if (m) {
      const fs = m.states.floor;
      if (m === appliedTo && fs.value !== applied) { F.set(false); return false; }   // 别处选了楼层：退出跟随，楼层照它的
      zone = zoneOf(p);
      if (fs.value !== zone) V3.setState('floor', zone);
      appliedTo = m; applied = zone;
    }
    return true;
  }
  // 镜头直接到位（不飞）：token、截图用
  function snap() {
    const ctl = V3.R && V3.R.ctl;
    if (!ctl || !tick(0)) return false;
    const g = ctl.g;
    ctl.az = g.az; ctl.el = g.el; ctl.dist = g.dist; ctl.target.copy(g.target); ctl.update(0);
    return true;
  }

  F.on = () => ON;
  F.available = () => !!(V3.actor && V3.actor.root);
  F.set = (on, o) => {
    on = !!on;
    if (on !== ON) {
      ON = on; held = false;
      if (on) {
        enter = true; appliedTo = null; applied = '';
        const m = floorOf(), v = m ? m.states.floor.value : 'all';
        zone = v === 'ground' || v === 'loft' ? v : 'all';
      } else {
        enter = false;
        const ctl = V3.R && V3.R.ctl;
        if (ctl) ctl.noPan = false;
      }
      V3.emit('follow', ON);
    }
    if (ON && o && o.snap) snap();
    return ON;
  };
  F.toggle = () => F.set(!ON);
  F.tick = (dt) => (ON ? tick(typeof dt === 'number' ? dt : 0) : false);   // dt 原样传下去（不重新装盒）
  F.state = () => {
    const ctl = V3.R && V3.R.ctl, g = ctl ? ctl.g : null, m = floorOf();
    return {
      on: ON, active: ON && !!ctl && !busy() && F.available(), suspended: ON && busy(), zone, floor: m ? m.states.floor.value : null,
      az: g ? g.az : null, el: g ? g.el : null, dist: g ? g.dist : null, target: g ? [g.target.x, g.target.y, g.target.z] : null,
    };
  };

  // 在模型的 update 之后跑（00-core 先登记的 frame）：她这一帧走到哪儿，目标点就跟到哪儿
  V3.on('frame', (dt) => { if (ON) tick(dt); });

  V3.viewTokens = V3.viewTokens || {};
  V3.viewTokens.follow = (v) => { F.set(v !== '0' && v !== 'off', { snap: true }); };
})(window.V3);
