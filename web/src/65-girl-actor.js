// 65-girl-actor.js — 场景部件 girl-actor（order 65）：小鲸鱼在场景里站着、闲逛、捡贝壳、说话（docs/SPEC-4.md §4）。
// 模型：默认是自带的 YSM 模型（29-ysmui 的 initialBody，2026-11-05 第9轮起）；设置里可换 v1 小鲸鱼 V3.girlv1.build()
// 或导入的 YSM 模型（useBody）；建不出来退回 v1 小鲸鱼。依赖都是可选的，缺了就降级：
//   V3.nav 没有 → 直线走、自己躲开房子/门廊/石堆，高度用 V3.terrain.groundY；V3.footprints 没有 → 不放脚印；
//   V3.bubble 没有 → 不说话；V3.game 没有 free/claim/collect → 不捡；天气（V3.wx.now() / V3.env.state.wx）没有 → 不撑伞、不躲雷。
// 天气：rain|snow > 0.3 撑小伞（1/32 m 体素，挂在 hand() 上）走 0.7 m/s；storm > 0.5 跑回台阶、坐在门廊沿上缩着等，storm < 0.3 再出来。
// V3.actor = { inst, root, head() → 头顶上方 0.15 m 的世界坐标（撑伞时在伞尖上方）, hand(), state（idle|walk|wander|collect|shelter）, pos,
//   goto(x, z) → Promise<bool>, say(text, mood), collect(id?), wander() }
// Host actor API (after actor:ready): startBehavior(kind, {seconds?, text?}) → bool, behaviorAvailability(kind) → {available, reason?},
// behavior → null | {kind, phase}, cancelBehavior(reason?) → bool. Call startBehavior directly to avoid re-planning a queried route.
// garden_water：随手拿壶上阁楼，到操作点转向盆心才调用 windowGarden.water('girl')。
// Kinds: eat (24s seated, fixed), reply_private (12s), write_diary/draw/read (15s each); other durations are seated/onsite seconds.
// 2026-11-14 (v5):
//   · Collecting is a state (see 收拾沙滩 below): state 'collect' lasts from the first shell of a sweep to the last; sweeping / sweep getters,
//     actor:sweep events. collect(id?) enters that state right away.
//   · After every pickup she cheers: both hands up (inst.cheerArms on a YSM body, pose 'cheer' otherwise) and one little hop, played once, then she holds the pose ~3 s (CHEER_HOLD).
//   · Leisure kinds watch_tv / album / sea (and read): things she does by herself when idle, see BEHAVIORS. join(kind, opts) = the player
//     opened that thing: she runs over and watches along. behavior getter adds leisure / together.
//   · She runs (HURRY_SPEED, the model's run clip) to: eat, reply_private, anything started with opts.run, goto(x, z, y, { run: true }).
//   · Chairs: hips go onto the seat surface the block model really has (SEATS), not the middle of the block cell.
// One run at a time; host handles scheduling, retries, dedupe and persistence. Check behavior, not just the legacy state (pickup/read can be idle).
// actor:behavior → {kind, phase:'started'|'action'|'completed'|'cancelled', at, durationMs?, reason?}.
// 'started' = route committed; 'action' = at furniture, ready to play action; 'completed' = back standing. Rejected starts emit nothing.
// Log desk/read at 'action', and count a meal only at 'completed'. Duration is actor simulation time; at is wall-clock epoch milliseconds.
// actor:meal → {step:'pickup', at}: the eat behaviour has reached the counter and begins taking the bowl (69-furniture-play serves the rice now).
// mealBowl(out) → 0 | 1 | 2: where the bowl of the running meal is (none / in her hand / on the table before her chair); out ← world point.
// opts.interrupt === true (a player's own request, e.g. the rice cooker buttons): an idle stroll does not count as busy, she turns round at once.
// Night routine (88-cabin-night drives it; nothing here looks at the clock):
//   startBehavior('sleep') = walk to a bed, turn, lie down (1.1 s), sleep until the host ends it. 'action' = she is lying asleep.
//     While she lies there V3.furn's bed variant is 'sleeping' (restored when she is up, also after a cancel) and, on a block-house bed,
//     a quilt bump from V3.furn.sleepCover lies over her, and the folded pyjamas + nightcap baked into the block bed are hidden
//     (V3.houseBlocks.setSleeper(bed centre) / setSleeper(null) when she is up). Any cancel puts her back on her feet beside the bed at once.
//   opts.hold === true (reply_private / write_diary / draw): after the usual seconds she stays seated until the host ends it.
//   endBehavior() -> bool: end 'sleep' or a held desk behaviour the normal way (sleep: 0.9 s getting up) -> 'completed'.
//   renewBehavior() -> bool: a held desk behaviour types again for its seconds (emits another 'action': one more real reply).
//   rest(on) / resting: no strolling, shell collecting, decor placing or idle chatter while on (she stands where she is; a shell she is
//     walking to or crouching over is let go the moment rest turns on — 2026-11-12: no shells at night; interactions,
//     host behaviours and storm shelter still work). Kept across scene rebuilds, like hold().
//   lying -> null | { bed: [x, y, z] bed centre, head: [x, y, z] pillow point, k: 0..1 how far she is down, cover: bool }.
// token：girl=collect（马上去捡最近的）、girl=x_z（走到某点）、girl=at_x_z[_yaw]（瞬移，截图用）、girl=idle|wander|auto|pickup|cheer|shelter
(function (V3) {
  'use strict';
  const U = V3.util, TAU = Math.PI * 2;
  const SPEED = 1.0, TURN = 5.5;                        // 走路 m/s（SPEC-4）、转身 rad/s 上限
  const REACH_YAW_MAX = 0.35;                           // 捡东西时为了让手对准、身子最多偏开多少（rad）
  const RAIN_SPEED = 0.7, RUN_SPEED = 1.5, CLIMB_SPEED = 0.8;   // 撑伞走 / 打雷跑回家 / 上台阶
  const HURRY_SPEED = 1.9;                              // 赶着去（回消息、吃饭、你叫她过去一起看）：跑着去，放模型的 run 动画
  // 捡到以后举手欢呼：模型放自己的 jump 动画演一下（它的一个循环 0.75 s 正好是一下蹦，只放 CHEER_ACT 这么久），
  // 然后换回 idle 只举着手保持 CHEER_HOLD 秒，再放下。2026-11-16：原来 1 秒里手一直晃、蹦两下，看着像连演了两三遍；
  // 后来在 jump 之外又用代码抬 root 蹦了一下，结果叠成两下——现在完全交给模型的 jump，代码不抬高度。
  // 没有 cheerArms 的旧模型（v1 / 20-girl）的欢呼是循环动画，定不住，仍按 CHEER_T_OLD
  // 模型自带的 jump 是循环的"蹲一下再起来"的弹跳，一个循环 0.75 s 里弹两下（约 0.42 s 一下）：
  // 只放 0.42 s = 正好一下，然后换 idle 站着举手（放满一个循环会弹两下）
  const CHEER_ACT = 0.12, CHEER_HOLD = 3.0, CHEER_T = CHEER_ACT + CHEER_HOLD, CHEER_T_OLD = 1.0;
  const LEG = 0.28, SWING = 0.45;                       // 旧版 20-girl 的腿长（胯 → 脚底）和走路摆幅；新模型在 makeBody 里给自己的
  // 一步 = 2·腿长·sin(摆幅)；走路时动画时钟快几倍脚才不打滑：腿摆一个来回 = 2π/6 个动画秒（20-girl 的 sin(t·6)，v1 的 walk 也按这个对齐）
  const rateOf = (leg, swing) => Math.PI * SPEED / (6 * 2 * leg * Math.sin(swing));
  const HOME = [-1.6, -0.9], HOME_YAW = 0.6;            // 门廊台阶前的沙滩，面朝主镜头 / 大海
  const UP15 = new THREE.Vector3(0, 0.15, 0);
  const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);   // → [-π, π)
  const ease = (k) => k * k * (3 - 2 * k);
  const warned = new Set();
  const warn = (k, msg) => { if (!warned.has(k)) { warned.add(k); V3.err('girl-actor ' + msg); } };   // 别的模块抛错只报一次
  // ---- 小屋事件（2026-11-15，v6）：页面里「她做了什么」当中桥接该知道的那几件（收拾沙滩收工、她自己开始一种消遣）----
  //   照 58-cabin-trash 的形状 V3.emit('game:cabin-event', { type, id, at, text, detail }) → cabin-bridge 的 durableEvent
  //   → POST /api/cabin/event。text 在这一层写成人话（服务端有白名单，进不进时间线/日记素材由它决定）；id 要满足
  //   服务端的 /^[A-Za-z0-9_-]{1,80}$/。上报失败只记一次警告，不能影响她继续做事。
  function emitCabinEvent(type, detail, text) {
    try {
      const at = Date.now(), tag = type.replace(/[^A-Za-z0-9]/g, '').slice(0, 16) || 'cabin';
      V3.emit('game:cabin-event', { type, id: tag + '_' + at + '_' + Math.random().toString(36).slice(2, 8),
        at, text: String(text || ''), detail: detail || {} });
    } catch (e) { warn('cabin-event', 'game:cabin-event: ' + e); }
  }
  let HOLD = false;                                      // 布置模式：她停在原地（放在模块里：场景重建、换新的 A 以后还停着）
  let REST = false;                                      // 夜里（88-cabin-night）：不闲逛、不捡贝壳、不摆贝壳、不自言自语（同样放在模块里）
  let A = null;                                          // 这一个小鲸鱼的全部状态（场景重建就换新的）

  // ---- 走路网格：优先 V3.nav（plan 在写）；没有就兜底：只走沙滩，躲开房子/门廊/台阶/石堆/木箱/礁石/椰子树干，不下水 ----
  const nav = () => V3.nav || null;
  const pt = (p) => !p ? null : Array.isArray(p) ? [+p[0], +p[1]] : [+p.x, +p.z];
  let BLOCKS = null;
  function blocks() {
    if (BLOCKS) return BLOCKS;
    const L = V3.layout || {}, P = L.porch || {}, B = BLOCKS = [], pad = 0.3;
    const box = (r) => { if (r && r.x0 != null) B.push([r.x0 - pad, r.z0 - pad, r.x1 + pad, r.z1 + pad]); };
    box(L.house); box(P); box(P.steps);
    for (const r of L.outside || []) if (/^(rocks|chest|succ|reefE|reefW)$/.test(r.id)) box(r);
    for (const p of L.plants || []) if (/^palm/.test(p.id)) box({ x0: p.x - 0.3, z0: p.z - 0.3, x1: p.x + 0.3, z1: p.z + 0.3 });
    return B;
  }
  function fbWalk(x, z) {
    const S = (V3.layout && V3.layout.site) || { x0: -26, x1: 26, z0: -18, z1: 40 }, T = V3.terrain;
    if (x < S.x0 + 1 || x > S.x1 - 1 || z < S.z0 + 1 || z > S.z1 - 1) return false;
    for (const b of blocks()) if (x > b[0] && x < b[2] && z > b[1] && z < b[3]) return false;
    if (!T) return true;
    const top = T.groundY(x, z);
    return top <= T.seabedY(x, z) + 0.01 && top >= -0.2;          // 不上石头 / 礁石，不下水（湿沙可以）
  }
  function walkable(x, z, y) {                 // y：她现在（或目标）的高度，屋里有一楼和阁楼两层时用来选层
    const n = nav();
    if (n && n.walkable) { try { return !!n.walkable(x, z, y); } catch (e) { warn('nw', 'nav.walkable: ' + e); } }
    return fbWalk(x, z);
  }
  function heightAt(x, z, hint) {
    const n = nav();
    if (n && n.heightAt) { try { const y = +n.heightAt(x, z, hint); if (Number.isFinite(y)) return y; } catch (e) { warn('nh', 'nav.heightAt: ' + e); } }
    return V3.terrain ? V3.terrain.groundY(x, z) : 0;
  }
  function nearest(x, z) {
    const n = nav();
    if (n && n.nearest) { try { const p = pt(n.nearest(x, z)); if (p) return p; } catch (e) { warn('nn', 'nav.nearest: ' + e); } }
    if (walkable(x, z)) return [x, z];
    for (let r = 0.25; r <= 3; r += 0.25) for (let k = 0; k < 16; k++) {
      const a = k / 16 * TAU, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (walkable(px, pz)) return [px, pz];
    }
    return null;
  }

  // ---- 模型：v1 小鲸鱼（20-girlv1）；导入了 YSM 模型就用它的 ----
  // 返回 { inst, root, headBone, headTop, height, rate, handBone, handOff, reach: { x, z }, reachD, reachYaw }
  //   rate：走路时动画时钟的倍数（按模型的腿长 / 摆幅算）；hand*：右手心（伞柄、贝壳从这里飞走）；
  //   reach：蹲下伸手（pose pickup, poseK 1）时手在 root 局部的水平位置 → 她站多远、朝哪边蹲，手才落在贝壳上
  function makeBody(builder) {
    let inst = null;
    if (builder) { try { inst = builder(); } catch (e) { V3.err('girl-actor: 导入的角色建不出来，用小鲸鱼 ' + ((e && e.message) || e)); inst = null; } }
    if (!inst) {
      try { inst = V3.girlv1.build({ anchor: 'girl:' }); }
      catch (e) { V3.err('girl-actor: 小鲸鱼建不出来：' + ((e && e.message) || e)); throw e; }
    }
    const root = new THREE.Group();
    root.name = 'girl-actor'; root.userData.clickable = 'girl'; root.add(inst.root);
    const fm = inst.face && inst.face.mesh;
    if (fm) { fm.userData.anchor = fm.userData.anchor || 'girl:face'; fm.userData.noShadow = true; }
    root.traverse((o) => { if (o.isMesh) o.userData.layer = 'site'; });
    const hb = inst.bones.head;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(hb);
    // 模型自己给的头顶优先（YSM：骨骼没有网格，Box3 是空的）；量不出来就用头骨骼上方 0.3 m
    let headTop = inst.headTop && Number.isFinite(inst.headTop.y) ? inst.headTop.clone()
      : box.isEmpty() ? null : hb.worldToLocal(new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2));
    if (!headTop || !Number.isFinite(headTop.x + headTop.y + headTop.z)) headTop = new THREE.Vector3(0, 0.3, 0);
    const handBone = inst.handBone || inst.bones.armR, handOff = inst.handOff ? inst.handOff.clone() : HAND.clone();
    let reach = { x: 0, z: REACH };
    if (inst.handBone) {                         // 量一下：摆成蹲下伸手的样子，看右手心在哪
      const st = inst.states;
      st.pose.value = 'pickup'; inst.poseK = 1; inst.update(0, 0);
      root.updateMatrixWorld(true);
      const p = root.worldToLocal(handBone.localToWorld(handOff.clone()));
      if (Number.isFinite(p.x) && Number.isFinite(p.z) && Math.hypot(p.x, p.z) > 0.05) reach = { x: p.x, z: p.z };
      st.pose.value = 'stand'; inst.poseK = 0; inst.update(0, 0);
    }
    return { inst, root, headBone: hb, headTop, height: new THREE.Box3().setFromObject(root).max.y,
      rate: rateOf(inst.leg || LEG, inst.swing || SWING), handBone, handOff, reach,
      reachD: Math.hypot(reach.x, reach.z), reachYaw: Math.atan2(reach.x, reach.z) };
  }

  // 换身体（玩着的时候也行）：先清掉旧身体的反馈部位，再建新的，放到同一个父节点下
  function useBody(id, builder) {
    const a = A;
    if (!a) return false;
    stand('body-change'); a.attentionUntil = 0;
    const old = a.body, parent = old.root.parent;
    if (V3.parts && V3.parts.reset) V3.parts.reset('小鲸鱼');
    const nb = makeBody(builder);
    nb.root.traverse((o) => { if (o.isMesh) { o.castShadow = !o.userData.noShadow; o.receiveShadow = !o.userData.noReceive; } });
    if (parent) { parent.add(nb.root); parent.remove(old.root); }
    if (a.umb) { for (const m of a.umb.meshes) m.geometry.dispose(); a.umb.material.dispose(); a.umb = null; }
    a.umbFail = false;
    dropCover(a);
    try { old.inst.dispose(); } catch (e) { V3.err('girl-actor dispose: ' + e); }
    a.body = nb; a.bodyId = builder && nb.inst.id !== 'girlv1' && nb.inst.id !== 'girl' ? id : 'v1';
    tick(0);
    V3.emit('parts-changed');
    return true;
  }
  // ---- 每帧把状态写进模型：走路摆幅跟速度走，pickup / cheer 用 inst.poseK 平滑过渡，眨眼用确定性随机 ----
  const RAMP = { pickup: [0.45, 0.4], cheer: [0.25, 0.3], huddle: [0.8, 0.6] };   // 进入 / 退出秒数
  function drive(dt) {
    const a = A, inst = a.body.inst, b = inst.bones;
    if (a.poseCur !== a.pose) {
      a.poseK = RAMP[a.poseCur] ? Math.max(0, a.poseK - dt / RAMP[a.poseCur][1]) : 0;
      if (a.poseK <= 0) a.poseCur = a.pose;
    } else if (RAMP[a.pose]) a.poseK = Math.min(1, a.poseK + dt / RAMP[a.pose][0]);
    const walking = a.gait > 0.001;
    inst.states.pose.value = walking ? 'walk' : RAMP[a.poseCur] ? a.poseCur : 'stand';
    inst.poseK = ease(a.poseK);
    // 躺着睡：闭眼（表情表里的 'sleep'：—_— 两条线、嘴放松，29-ysmui 的 FATFISH_TUNE；没有这张表的模型照旧自己眨眼）
    // 捡到东西以后（拿着 → 站起来 → 举手欢呼）一直是开心脸 >_< O∀O，盖过说话的嘴型和「第一次见」的惊讶（2026-11-17）
    const glad = a.mode === 'pick' && (a.sub === 'hold' || a.sub === 'up' || a.sub === 'cheer');
    inst.states.expr.value = glad ? 'laugh' : a.clock < a.moodT ? a.mood : a.clock < a.talkT ? 'talk' : a.lying && a.lying.k >= 1 ? 'sleep' : a.shelter ? 'pout' : 'happy';
    const f = inst._f;
    if (f) {                                   // 20-girl 的眨眼计时器停掉，这里自己眨
      f.next = 1e9; a.blinkT -= dt;
      if (a.blinkT <= 0) { const bt = -a.blinkT; f.blink = bt < 0.05 ? 1 : bt < 0.12 ? 2 : bt < 0.17 ? 1 : 0; if (bt >= 0.17) { f.blink = 0; a.blinkT = 2 + a.rng() * 4; } }
    }
    if (inst.setLook) inst.setLook(a.look, a.lookUp > 0 ? Math.sin(Math.PI * Math.min(1, a.lookUp / 1.4)) * 0.35 : 0);   // 模型自己转头（YSM：头跟着视线）
    if (inst.setWeather) {                     // YSM：淋雨效果；跑回家、上台阶时还淋着，到了门廊板上（转身坐下以后）就不算
      const dry = a.shelter && /^(turn|sit|wait|up)$/.test(a.shelter.sub);
      inst.setWeather(a.storm ? 2 : a.rainy ? 1 : 0, (a.rainy || a.storm) && !dry);
    }
    const scriptedArm = driveBehaviorAnimation(a, inst, walking);
    inst.update(dt, a.anim);
    if (inst.noOverlay) {                      // YSM 模型：骨骼轴向和旧版不同，不叠加下面这些（动作都用模型自己的动画），只撑伞
      if (a.lookUp > 0) a.lookUp = Math.max(0, a.lookUp - dt);
      if (dt > 0) a.flinch *= Math.exp(-dt * 3);
      // 欢呼：两只手举起来（只晃一遍，之后定住）。用手自己的进度 cheerK：保持阶段姿势已经换回站立（跳的动画会让身体一直上下起伏），
      // 但手不能跟着姿势一起放下。cheerpose token 摆姿势（cheerT == null、poseCur === 'cheer'）也举着
      const wantCheer = a.cheerT != null || a.poseCur === 'cheer';
      a.cheerK = wantCheer ? Math.min(1, a.cheerK + (dt > 0 ? dt / 0.25 : 1)) : Math.max(0, a.cheerK - (dt > 0 ? dt / 0.3 : 0));
      if (inst.cheerArms && a.cheerK > 0) inst.cheerArms(ease(a.cheerK), a.cheerT != null ? a.clock - a.cheerT : 1e9);
      if (scriptedArm && a.snackKind === 'drink' && a.snackUntil > a.clock) scriptedArm(b);
      if (a.snackBottle && a.snackUntil > a.clock && (a.snackKeep || a.attentionUntil > a.clock)) inst.holdBottle?.();
      umbrella(dt);
      return;
    }
    if (walking && a.gait < 1) {               // 起步 / 停下：摆幅跟着速度
      for (const k of ['legR', 'legL', 'armR', 'armL']) b[k].rotation.x *= a.gait;
      const r = b.hips.userData.rest.y; b.hips.position.y = r + (b.hips.position.y - r) * a.gait;
    }
    b.head.rotation.y += a.look;
    if (a.gait > 1) b.chest.rotation.x += Math.min(0.2, (a.gait - 1) * 0.4);   // 跑：身子往前倾
    if (a.flinch > 0.01) {                     // 闪电：哆嗦一下
      b.chest.rotation.z += Math.sin(a.clock * 47) * 0.05 * a.flinch; b.head.rotation.x += 0.08 * a.flinch;
      if (dt > 0) a.flinch *= Math.exp(-dt * 3);
    }
    if (a.lookUp > 0) { b.head.rotation.x -= Math.sin(Math.PI * Math.min(1, a.lookUp / 1.4)) * 0.35; a.lookUp = Math.max(0, a.lookUp - dt); }   // 下雨了：抬头看天
    if (scriptedArm) scriptedArm(b);
    umbrella(dt);
  }
  function tick(dt) {
    const a = A;
    a.clock += dt;
    if (a.waterTrip && (V3.shallows?.closed() || HOLD || V3.backgroundPaused() || (a.waterTrip.sighting && !a.waterTrip.sighting.valid()))) finishWater();
    if (a.waterTrip) weather();
    if (a.waterTrip) {
      if (a.waterTrip.phase === 'watch') {
        const trip = a.waterTrip;
        if (trip.sighting) {
          const [x, , z] = trip.sighting.locate?.() || trip.sighting.point, yaw = Math.atan2(x - a.x, z - a.z);
          a.yaw += U.clamp(wrap(yaw - a.yaw), -dt * 3.8, dt * 3.8);
          if (Math.abs(wrap(yaw - a.yaw)) < .12) trip.gaze += dt;
          if (!trip.noted && trip.gaze >= 1.1) { trip.noted = true; trip.sighting.seen(); }
          if (trip.gaze >= 4) finishWater();
        } else look(dt);
      }
      else if (a.waterTrip.phase !== 'approach') { waterTick(dt); return; }
    } else brain(dt);
    move(dt);
    a.anim += dt * (1 + (a.body.rate * Math.max(1, a.gait) - 1) * Math.min(1, a.gait * 4));   // 跑（gait > 1）时步频跟着快，摆幅不变
    const h = a.yLock != null ? a.yLock : heightAt(a.x, a.z, a.y);   // 坐在门廊沿上：高度定住（脚下的台阶高度不算）；屋里按现在的高度选一楼 / 阁楼
    a.y += (h - a.y) * (dt > 0 ? Math.min(1, dt * 12) : 1);
    // 捡到贝壳欢呼的时候原地蹦两下（只抬模型，a.y 不变：脚印、对话框、寻路都不受影响）
    // 蹦是模型自己的 jump 动画演出来的（不抬 root）：一段循环 0.75 s = 一下蹦，65-girl-actor 只放 CHEER_ACT 这么长
    const r = a.body.root; r.position.set(a.x, a.y, a.z); r.rotation.y = a.yaw;
    drive(dt);
    if (a.behavior?.can) poseWateringCan(a, a.behavior);
    seatPose();
    lyingPose(dt);
  }
  // ---- 走路：route → go(路点, 完成回调) → 每帧 move()；转身平滑（先原地转，再边走边转），起步 / 停下有加减速 ----
  function lineOk(x0, z0, x1, z1) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2));
    for (let i = 1; i <= n; i++) if (!walkable(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n)) return false;
    return true;
  }
  function routeFrom(from, x, z, y) {             // from = [x, y, z]；返回不含起点的路点
    const n = nav();
    if (n && n.path) {
      try { const p = n.path([from[0], from[2], from[1]], [x, z, y]); return p && p.length ? p.map(pt) : null; } catch (e) { warn('np', 'nav.path: ' + e); }
    }
    return lineOk(from[0], from[2], x, z) ? [[x, z]] : null;
  }
  function route(x, z, y) {                    // → [[x, z]…]（不含起点）或 null；y = 目标高度（阁楼上的点要给）
    const a = A;
    return routeFrom([a.x, a.y, a.z], x, z, y);
  }
  function go(x, z, why, done, y, checkedPath) {
    stop(false);
    const p = checkedPath || route(x, z, y);
    if (!p) { if (done) done(false); return false; }
    Object.assign(A, { mode: 'walk', why, path: p, pi: 0, done: done || null, face: null, holdT: 0, pose: 'stand', hurry: false });   // 要走路就先站起来；要跑的由调用的人在 go() 之后把 hurry 打开
    if (A.moodT > A.clock + 100) A.moodT = 0;   // token 定住的表情（cheer）也放掉
    return true;
  }
  function stop(ok) {
    const a = A, d = a.done;
    a.done = null; a.path = null; a.hurry = false;
    if (a.mode === 'walk') {
      a.mode = 'idle'; a.modeT = ok ? 1.5 + a.rng() * 4 : 0.6;
      // 模型带 longIdle（自带的 YSM 模型）：闲逛走到地方后偶尔多站一会儿，她自己的控制器站满约 38 秒会演待机动画（铁盆那段）
      const L = a.body.inst.longIdle;
      if (ok && L > 0 && a.why === 'wander' && !a.task && a.rng() < 0.3) a.modeT = L + a.rng() * 8;
    }
    if (d) d(ok);                              // 最后调：回调里可以马上 go() 下一段
  }
  function move(dt) {
    const a = A;
    let want = 0, to = null;
    if (a.mode === 'walk' && a.path) {
      while (a.pi < a.path.length - 1 && Math.hypot(a.path[a.pi][0] - a.x, a.path[a.pi][1] - a.z) < 0.3) a.pi++;
      const p = a.path[a.pi];
      let rest = Math.hypot(p[0] - a.x, p[1] - a.z);
      for (let i = a.pi; i < a.path.length - 1; i++) rest += Math.hypot(a.path[i + 1][0] - a.path[i][0], a.path[i + 1][1] - a.path[i][1]);
      if (rest < 0.06) { a.v = Math.min(a.v, 0.2); stop(true); }
      else {
        to = Math.atan2(p[0] - a.x, p[1] - a.z);
        const off = Math.abs(wrap(to - a.yaw));
        const top = spd();                       // 跑着的时候提前一点减速（刹车距离跟着速度长），不冲过头
        want = off > 1.2 || a.poseK > 0.02 ? 0 : top * Math.min(1, rest / (0.35 * Math.max(1, top / SPEED)) + 0.08) * Math.max(0.3, Math.cos(off));
      }
    } else if (a.face != null && a.poseK < 0.02) to = a.face;
    a.v += U.clamp(want - a.v, -dt * 5, dt * 3);
    let dy = 0;
    if (to != null) {
      dy = U.clamp(wrap(to - a.yaw), -TURN * dt, TURN * dt);
      a.yaw = wrap(a.yaw + dy);
      if (a.face != null && Math.abs(wrap(a.face - a.yaw)) < 0.02) a.face = null;
    }
    if (a.v > 0) { a.x += Math.sin(a.yaw) * a.v * dt; a.z += Math.cos(a.yaw) * a.v * dt; }
    const g = a.v > 0.02 ? a.v / SPEED : Math.abs(dy) > 1e-4 ? 0.3 : 0;   // 原地转身也挪挪脚
    a.gait += U.clamp(g - a.gait, -dt * 12, dt * 3);
    feet();
  }
  function feet() {                            // 腿摆过竖直位置（脚落在胯下面）时放一个脚印：k 偶数 = 右脚，奇数 = 左脚
    const a = A, k = Math.floor(a.anim * 6 / Math.PI);
    if (k === a.stepK) return;
    a.stepK = k;
    const fp = V3.footprints;
    if (!fp || !fp.step || a.v < 0.15) return;
    const right = (k & 1) === 0, s = right ? -0.07 : 0.07;
    const x = a.x + Math.cos(a.yaw) * s, z = a.z - Math.sin(a.yaw) * s, n = nav();
    let ok = true;
    if (n && n.surface) { try { ok = /^(sand|wet)$/.test(n.surface(x, z)); } catch (e) { warn('ns', 'nav.surface: ' + e); } }
    if (ok) { try { fp.step(x, z, a.yaw, right ? 'R' : 'L'); } catch (e) { warn('fp', 'footprints.step: ' + e); } }
  }
  function gotoP(x, z, manual, y, run) {       // → Promise<bool>：走到了 true；被打断 / 走不到 false（y：阁楼上的点给阁楼高度；run：跑着去）
    return new Promise((res) => {
      if (!A) return res(false);
      stand('goto'); A.attentionUntil = 0;
      dropTask();
      if (manual) A.manual = true;
      if (go(+x, +z, manual ? 'goto' : 'api', res, y != null ? +y : undefined) && run) A.hurry = true;
    });
  }
  function look(dt) {                          // 站着时转头看看；走路 / 捡东西时回正
    const a = A, idle = a.mode === 'idle' && !a.task && a.poseK < 0.02;
    if (idle) {
      a.lookT -= dt;
      if (a.lookT <= 0) { a.lookT = 1.2 + a.rng() * 2.6; a.lookTo = a.rng() < 0.35 ? 0 : (a.rng() * 2 - 1) * 0.7; }
    }
    a.look += ((idle ? a.lookTo : 0) - a.look) * Math.min(1, dt * 3);
  }
  function brain(dt) {
    const a = A;
    if (a.behavior) return behaviorTick();
    if (a.seated) {
      if (a.clock >= a.seated.until) stand('timeout');
      else return;
    }
    if (a.attentionUntil > a.clock && !HOLD) { a.look = a.lookTo = 0; return; }
    if (a.attentionUntil) { a.attentionUntil = 0; a.pose = 'stand'; if (a.storm && !a.manual && !HOLD && !a.shelter && !(REST && indoors())) shelterStart(); }
    weather();
    look(dt);
    if (HOLD) { if (a.shelter) shelterTick(dt); return; }   // 布置模式：站在原地，什么都不做
    if (a.shelter) return shelterTick(dt);         // 打雷：跑回家、坐在门廊沿上等（别的都不做）
    if (a.mode === 'pick') return pick(dt);
    if (a.holdT > 0) { a.holdT -= dt; if (a.holdT <= 0) a.pose = 'stand'; return; }
    if (a.mode === 'walk') {
      if (a.task && !onBeach(a.task.id)) lost();
      // 闲逛到一半，沙滩上的东西等够了：不逛了，下一拍开始收拾
      else if (a.why === 'wander' && !a.task && !a.manual && !REST && !(V3.shellControls && V3.shellControls.busy) && sweepDue()) { stop(false); a.modeT = 0; }
      return;
    }
    if (V3.shellControls && V3.shellControls.busy) return;
    if (REST) { sweepEnd('night'); noticePlayerFind(a); return; }   // 夜里：站在原地，等 88-cabin-night 叫她回床上
    if (!noticePlayerFind(a)) idleChat(dt);
    if ((a.modeT -= dt) > 0 || a.manual) return;
    if (autoCollect()) return;
    if (V3.shellControls && V3.shellControls.consider()) return;
    const r = a.rng();
    if (r < 0.55) { if (wander()) return; }
    else if (r < 0.75) a.face = wrap(HOME_YAW + (a.rng() * 2 - 1) * 0.6);
    a.modeT = 2 + a.rng() * 4;
  }
  // ---- 收拾沙滩（2026-11-14 起，捡贝壳是一个状态，不是冲着某一颗去）----
  //   沙滩上有了能捡的东西 → 计时（从最早冲上来的那一件算起，girlMin..girlMax 秒之间，每件按 id 定）→ 时间到，进入「收拾」状态
  //   （a.sweep）→ 从近的开始一件接一件，把沙滩上所有的都捡了（收拾途中新冲上来的也算）→ 沙滩空了（或者剩下的都够不着）→ 回到空闲。
  //   每一件：claim → 走到跟前 → 转向 → 蹲下 → collect → 站起来 → 两只手举起来欢呼、蹦一下、说一句，举着手保持一会儿（CHEER_T 秒）→ 下一件。
  //   被叫住、打雷、进布置模式、夜里该睡了、去做别的事（dropTask）：先停下、退出收拾状态；之后闲下来沙滩上还有东西，时间早就到了，
  //   马上重新进入收拾状态接着捡。actor:sweep → { phase: 'started' | 'ended', at, count?, reason? }。
  const game = () => (V3.game && V3.game.free && V3.game.claim && V3.game.collect ? V3.game : null);
  const onBeach = (id) => { const g = V3.game; return !!(g && g.st && g.st.beach.some((b) => b.id === id)); };
  const REACH = 0.3;                              // 旧版 20-girl：蹲下时手在胯前面多远（新模型由 makeBody 实测，见 body.reach）
  function hashId(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; }
  function ripe(it) {                             // 待够了没：每颗等的秒数在 girlMin..girlMax 之间，按 id 定
    const S = (V3.game && V3.game.S) || {}, lo = +S.girlMin || 30, hi = Math.max(lo, +S.girlMax || 90);
    return Date.now() - (+it.at || 0) >= (lo + (hi - lo) * hashId(String(it.id))) * 1000;
  }
  function pickItem(any) {                        // 最近的一颗（any = 不管等没等够）
    const g = game(), a = A;
    if (!g) return null;
    let best = null, bd = 1e9;
    for (const it of g.free()) {
      if ((!any && !ripe(it)) || (a.skip[it.id] || 0) > a.clock) continue;
      const d = Math.hypot(it.x - a.x, it.z - a.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }
  function startTask(it) {
    const g = game(), a = A;
    if (!g || !it || !g.claim(it.id, 'girl')) return false;
    dropTask(true); stop(false);
    a.task = { id: it.id, x: it.x, z: it.z, kind: it.kind };
    const dx = a.x - it.x, dz = a.z - it.z, d = Math.hypot(dx, dz) || 1;
    const R = a.body.reachD;                    // 站在贝壳朝她这边、手够得着的距离（旧版 0.3 m）
    let sx = it.x + dx / d * R, sz = it.z + dz / d * R;
    if (!walkable(sx, sz)) { const n = nearest(sx, sz); if (n) { sx = n[0]; sz = n[1]; } }
    const ok = go(sx, sz, 'collect', (arrived) => {
      if (!a.task || a.task.id !== it.id) return;
      if (!onBeach(it.id)) return lost();
      if (!arrived || Math.hypot(it.x - a.x, it.z - a.z) > R + 0.45) { a.skip[it.id] = a.clock + 60; dropTask(true); a.modeT = 0.3; return; }   // 够不着：先放着，去捡别的
      // 手在身体右前方：身子往左偏一点。偏多少有上限（2026-11-17）：YSM 模型蹲下时手在身体侧面，量出来的角度接近 90°，
      // 以前她会侧着身子蹲、贝壳在身边；现在最多偏 0.35 rad（约 20°），看上去是面朝贝壳蹲下去的
      Object.assign(a, { mode: 'pick', sub: 'face', subT: 0, face: wrap(Math.atan2(it.x - a.x, it.z - a.z) - U.clamp(a.body.reachYaw, -REACH_YAW_MAX, REACH_YAW_MAX)) });
    });
    if (!ok) { a.skip[it.id] = a.clock + 60; dropTask(true); }
    return ok;
  }
  // 放弃当前这颗（还给别人 claim）。keep 不给：连「收拾沙滩」的状态一起退出（被叫住、去做别的事）；keep = true：只放下这一颗，接着收拾
  function dropTask(keep) {
    const a = A;
    if (!a) return;
    if (!keep) sweepEnd('interrupted');
    if (!a.task) return;
    const g = V3.game, id = a.task.id;
    a.task = null;
    try { if (g && g.claimedBy && g.claimedBy(id) === 'girl') g.unclaim(id); } catch (e) { warn('gu', 'game.unclaim: ' + e); }
    if (a.mode === 'pick') Object.assign(a, { mode: 'idle', sub: '', pose: 'stand', face: null, modeT: 0.8, cheerT: null });
  }
  function lost() {                               // 被玩家先捡走了：换下一颗，没有就去逛（夜里 REST：都不去，站着等回床上）
    dropTask(true); stop(false);
    if (REST) { sweepEnd('night'); A.modeT = 1; return; }
    if (!autoCollect() && !wander()) A.modeT = 1;
  }
  // 该开始收拾了吗 → 沙滩上最早冲上来的那一件（它等够了才算；沙滩是空的、还没等够、现在不该捡 → null）
  function sweepDue() {
    const g = game(), a = A;
    if (!g || REST || a.storm || (g.S && g.S.girlAuto === false)) return null;   // 夜里、打雷、设置里关了「自己去捡」：不开始
    let first = null;
    for (const it of g.free()) if (!((a.skip[it.id] || 0) > a.clock) && (!first || (+it.at || 0) < (+first.at || 0))) first = it;
    return first && ripe(first) ? first : null;
  }
  function sweepBegin(forced) {                   // forced：你 / 聊天让她现在去捡（不看计时，也不看「自己去捡」的设置）
    const a = A;
    if (a.sweep) { if (forced) a.sweep.forced = true; return; }
    a.sweep = { n: 0, forced: !!forced, start: a.clock };
    V3.emit('actor:sweep', { phase: 'started', at: Date.now() });
  }
  function sweepEnd(reason) {
    const a = A, s = a && a.sweep;
    if (!s) return false;
    a.sweep = null;
    V3.emit('actor:sweep', { phase: 'ended', at: Date.now(), count: s.n, reason: reason || 'done' });
    // 报给桥接（v6）：一件都没捡到就不报（夜里该睡了退出、被打断、一件都够不着都不该刷噪声）
    if (s.n > 0) emitCabinEvent('sweep_end', { count: s.n, reason: reason || 'done' }, '收拾了沙滩上冲上来的 ' + s.n + ' 件东西');
    return true;
  }
  function sweepNext() {                          // 收拾状态里去捡下一件（最近的）→ true；沙滩上没有能捡的了 → 退出收拾状态 → false
    const a = A, g = game();
    if (!a.sweep) return false;
    if (!g || REST || a.storm) { sweepEnd('blocked'); return false; }
    for (let i = 0; i < 24; i++) {                // 走不到的那件 startTask 会记进 skip，接着试别的
      const it = pickItem(true);
      if (!it) break;
      if (startTask(it)) return true;
    }
    const n = a.sweep.n;
    sweepEnd('done');
    if (n >= 2) say(line('swept'), 'happy');      // 捡了不止一件：收工说一句
    a.modeT = 2 + a.rng() * 3;
    return false;
  }
  // 夜里（REST 打开那一刻）：正往贝壳那儿走、或者刚蹲下还没捡起来的那颗，放下不捡了（还给别人 claim）。
  // 已经在存（sub 'saving'：game.collect 已经发出去了）的不拦，捡完就站起来。2026-11-12 23:51 实测：页面从后台回来时她正去捡一颗珍珠贝，
  // 夜里规矩已经开了，她还是走过去捡了才上床——REST 以前只拦「开始新的一颗」，不拦已经在路上的。
  function quitShell() {
    const a = A;
    if (!a) return false;
    sweepEnd('night');                            // 夜里不收拾：正在存的那一颗捡完就停，不去下一颗
    if (!a.task || (a.mode === 'pick' && a.sub === 'saving')) return false;
    const walking = a.mode === 'walk';
    dropTask();
    if (walking) stop(false);
    return true;
  }
  function autoCollect() {                        // 空闲时看一眼：正在收拾 → 去下一件；计时到了 → 进入收拾状态、去第一件
    const a = A;
    if (!a.sweep) { if (!sweepDue()) return false; sweepBegin(false); }
    return sweepNext();
  }
  // 现在就去收拾（聊天让她捡、girl=collect）：从指定的那一件（没给就最近的）开始，捡完接着把沙滩上别的也捡了
  function collectNow(id) {
    const g = game();
    if (!A || !g || A.storm) return false;
    stand('collect'); A.attentionUntil = 0;
    A.manual = false;
    const had = !!A.sweep;
    sweepBegin(true);
    if (startTask(id ? g.st.beach.find((b) => b.id === id) : pickItem(true))) return true;
    if (!had) sweepEnd('unreachable');
    return false;
  }
  const SHELL_HOLD = 0.25;
  function pick(dt) {                             // mode 'pick'：face → down → collect → hold → up → cheer（举手欢呼）→ idle
    const a = A, t = a.task;
    a.subT += dt;
    if ((a.sub === 'face' || a.sub === 'down') && (!t || !onBeach(t.id))) return lost();
    if (a.sub === 'face') { if (a.face == null || a.subT > 1.2) Object.assign(a, { face: null, sub: 'down', subT: 0, pose: 'pickup' }); return; }
    if (a.sub === 'down') {
      if (a.poseCur !== 'pickup' || a.poseK < 1 || a.subT < 0.75) return;
      const BI = V3.beachItems;                   // 冲上岸的动画还没停稳就再蹲一会儿（最多 6 s）
      if (BI && BI.ready && a.subT < 6) { try { if (!BI.ready(t.id)) return; } catch (e) { warn('br', 'beachItems.ready: ' + e); } }
      const finish = (ev) => {
        if (A !== a || a.task !== t || a.mode !== 'pick') return; // an explicit user action interrupted her
        if (!ev) return lost();
        const held = a.sub === 'saving' ? a.subT : 0;
        if (a.sweep) a.sweep.n++;
        Object.assign(a, { task: null, got: ev, sub: held < SHELL_HOLD ? 'hold' : 'up', subT: held, cheerYaw: null });
      };
      try {
        const ev = V3.game.collect(t.id, 'girl');
        if (ev && typeof ev.then === 'function') {
          a.sub = 'saving'; a.subT = 0;
          ev.then(finish, () => finish(null));
        } else finish(ev);
      } catch (e) { warn('gc', 'game.collect: ' + e); finish(null); }
      return;
    }
    if (a.sub === 'saving') { if (a.subT >= SHELL_HOLD) a.pose = 'stand'; return; }
    if (a.sub === 'hold') {
      if (a.subT >= SHELL_HOLD) Object.assign(a, { sub: 'up', pose: 'stand', subT: 0 });
      return;
    }
    if (a.sub === 'up' && a.cheerYaw == null) {
      // 站起来的同时转向镜头（这一刻镜头在哪就朝哪），欢呼对着看她的人，而不是捡贝壳时随便朝着的方向（2026-11-17）
      const cam = V3.R && V3.R.camera;
      a.cheerYaw = cam ? Math.atan2(cam.position.x - a.x, cam.position.z - a.z) : a.yaw;
      a.face = a.cheerYaw;
    }
    if (a.sub === 'up' && a.poseCur === 'stand') {
      if (a.subT < 0.2) return;                   // 等模型把蹲下的姿势淡完（YSM 约 0.2 s），不然欢呼是从半蹲开始、看着像又蹲了一次
      if (a.face != null && a.subT < 1.5) return;   // 还在转身（蹲下的姿势淡完才转，转半圈约 0.57 s）：转完再举手，最多等 1.5 s
      a.face = null; a.cheerYaw = null;
      // 站起来了：两只手举起来欢呼、蹦一下，同时说一句
      cheerLine(a.got);
      Object.assign(a, { sub: 'cheer', subT: 0, got: null, pose: 'cheer', cheerT: a.clock });
      return;
    }
    if (a.sub === 'cheer') {
      // YSM 模型：整段都是站立姿势 + root 蹦一次 + cheerK 举手，保持到 CHEER_T 再放手。
      // 不放模型自带的 jump 动画：那段动画自己是循环的（0.75 s），会跟我们的蹦叠成两下、拉长以后还会一直上下起伏。
      // 没有 cheerArms 的旧模型定不住手，整段（CHEER_T_OLD）都放它自己的欢呼动画
      const ysmCheer = !!a.body.inst.cheerArms;
      if (ysmCheer) {
        // 模型自己的一下蹦（jump 一个循环 = CHEER_ACT 0.75 s）演完就换回 idle，剩下时间只举手保持
        if (a.pose === 'cheer') { if (a.subT >= CHEER_ACT) a.pose = 'stand'; return; }
        if (a.subT < CHEER_T) return;                                // 保持：站着、手举着
        if (a.cheerT != null) { a.cheerT = null; return; }           // 时间到：放手（cheerK 在 0.3 s 里收起）
        if (a.poseCur !== 'stand' || a.cheerK > 0.001) return;
      } else {
        if (a.pose === 'cheer') { if (a.subT >= CHEER_T_OLD) a.pose = 'stand'; return; }
        if (a.poseCur !== 'stand') return;
      }
      Object.assign(a, { mode: 'idle', sub: '', cheerT: null, cheerK: 0, modeT: a.sweep ? 0.3 : 1.5 + a.rng() * 2 });
    }
  }

  // ---- 台词（每类随机一句，不连着重复）+ say：冒泡 + 配表情（先 mood 表情 0.6 s，再张嘴说话）----
  const LINES = {
    poke: ['嗯？你叫我呀？', '我在呢～怎么啦？', '哎呀，被你发现了！'],
    pokeAgain: ['嘿嘿，有点痒～', '听到啦，陪你待一会儿。', '又戳我？小心我也戳你哦～'],
    pokeAsleep: ['唔……怎么啦？', '嗯……我在睡觉呢……', '（揉眼睛）天亮了吗……'],
    pokeSleepy: ['好困……让我再睡一会儿嘛。', '嗯嗯……晚安……', '再戳就睡不着啦……'],
    first: ['哇，是{name}！', '新发现！{name}！', '咦？这是……{name}！第一次见！', '{name}！快收进盒子里！'],
    rare: ['又是{name}，运气真好～', '{name}！今天是幸运日！', '闪闪发光的{name}～'],
    common: ['捡到{name}啦～', '又一个{name}！', '{name}，收下了～', '嘿嘿，{name}。', '这个{name}好看！'],
    helped: ['啊，那枚{name}被你先捡到啦～', '你先捡到了{name}！那我去看看别处。'],
    playerFind: ['你捡到{name}啦！', '原来是你捡到了{name}～', '你找到了一枚{name}，真好看。'],
    idle: ['海风好舒服～', '今天会冲上来什么呢？', '浪花哗啦啦……', '沙子暖暖的。', '要不要去门廊坐一会儿？', '小螃蟹又躲起来了。', '收集盒还差几种呢……'],
    wash: ['浪带东西上来了！', '咦，那边亮亮的是什么？', '有贝壳！'],
    calm: ['不打雷了～', '雷停啦，出去看看！', '呼……没事了。'],
    swept: ['沙滩收拾干净啦！', '都捡回来啦～', '今天的收获不错！'],
    // 空闲时自己找事做（行为 watch_tv / album / read / sea）：坐着的时候隔一阵说一句
    watch_tv: ['这个节目好看～', '海边频道的浪好大。', '再看一小会儿。'],
    watch_tank: ['刚才那条从石头后面游出来了。', '原来你躲在水草后面呀。', '我再陪它们待一会儿。'],
    album: ['这张拍得真好。', '那天的海好蓝呀。', '还想再去一次……'],
    read: ['嗯嗯……原来是这样。', '这一页写得真好。'],
    sea: ['海风好舒服～', '浪花哗啦啦……', '今天的海好蓝。', '远处有船吗？', '坐在这儿看海最舒服了。'],
    stargaze: ['哇，今晚的星星好多！', '那颗最亮的是什么星呀？', '找到北斗七星了！', '月亮上的坑看得好清楚～', '你也来看一眼嘛。', '刚才是不是有流星！', '星星一闪一闪的……'],
  };
  function line(cat) {
    const L = LINES[cat] || LINES.idle, a = A;
    let i = Math.floor(a.rng() * L.length);
    if (L.length > 1 && i === a.lastLine[cat]) i = (i + 1) % L.length;
    a.lastLine[cat] = i;
    return L[i];
  }
  function cheerLine(ev) {
    if (speakMoonAside(A)) return;
    const k = (ev && ev.kind) || {}, name = k.name || '贝壳';
    if (k.category === 'trash') return say('这件垃圾先带回去，别留在沙滩上。', 'happy');
    const cat = ev && ev.first ? 'first' : (k.rarity === 'rare' || k.rarity === 'ultra') ? 'rare' : 'common';
    say(line(cat).replace('{name}', name), ev && ev.first ? 'surprise' : 'happy');
  }
  function idleChat(dt) {
    const a = A;
    if ((a.chatT -= dt) > 0) return;
    a.chatT = 35 + a.rng() * 50;
    say(line('idle'), a.rng() < 0.4 ? 'think' : 'happy');
  }
  const EXPR = { happy: 'laugh', surprise: 'surprised', think: 'neutral', sad: 'pout' };
  function say(text, mood) {                      // → true = 气泡冒出来了（say= token 靠它判断要不要自己冒）
    const a = A, B = V3.bubble;
    text = String(text == null ? '' : text).trim();
    if (!a || !text) return false;
    mood = EXPR[mood] ? mood : 'happy';
    Object.assign(a, { mood: EXPR[mood], moodT: a.clock + 0.6, talkT: a.clock + 0.6 + Math.min(3, 0.4 + text.length * 0.12) });
    if (!B || !B.say) return false;
    try { return !!B.say('girl', text, { mood }); } catch (e) { warn('bs', 'bubble.say: ' + e); return false; }
  }
  // Player/furniture attention interrupts claims before cancelling callbacks, never collects on interruption.
  function stand(reason = 'stand') {
    return finishWater() || cancelBehavior(reason) || standSeat(reason);
  }
  function finishWater() {
    const actor = A, trip = actor?.waterTrip; if (!trip) return false;
    actor.waterTrip = null;
    if (trip.phase === 'approach') stop(false);
    else { actor.x = trip.shore[0]; actor.z = trip.shore[1]; actor.y = heightAt(actor.x, actor.z); }
    if (actor.body.inst.states.clip) actor.body.inst.states.clip.value = trip.previous;
    actor.body.inst.setActorAnimation?.();
    Object.assign(actor, { mode: 'idle', modeT: 1.2, gait: 0, v: 0, yLock: null, face: null });
    actor.body.root.position.set(actor.x, actor.y, actor.z);
    actor.body.inst.states.pose.value = 'stand'; actor.body.inst.update(0, actor.anim);
    V3.emit('shore:swim', null); return true;
  }
  function startWater(sighting = null) {
    const actor = A, track = V3.shallows?.track();
    const interruptLeisure = !!(sighting && actor?.behavior?.leisure);
    if (!actor || !track || V3.shallows.closed() || actor.waterTrip || HOLD || (actor.seated && !interruptLeisure) || actor.shelter || actor.manual || actor.attentionUntil > actor.clock || actor.mode === 'pick' || actor.task || actor.behavior && !actor.behavior.leisure) return false;
    const [shoreX, shoreZ] = track.shore;
    // A seated leisure returns to its saved standing point when cancelled; plan the route from there.
    const from = interruptLeisure && actor.seated ? actor.seated.back : [actor.x, actor.y, actor.z];
    const path = routeFrom(from, shoreX, shoreZ);
    if (!path || !walkable(shoreX, shoreZ)) return false;
    if (actor.behavior) cancelBehavior('swim');
    const inst = actor.body.inst, options = inst.states.clip?.options || [];
    const clips = sighting ? {} : Object.fromEntries(['wade','swim','float'].map(key => [key, options.some(option => option[0] === key) ? key : inst.findAnimation?.(key) || null]));
    const trip = { track, shore: track.shore, phase: 'approach', progress: 0, drift: 0, clips, sighting, gaze: 0, noted: false, floating: false, previous: inst.states.clip?.value || '', faceProbe: new THREE.Vector3() };
    actor.waterTrip = trip;
    const ok = go(shoreX, shoreZ, 'swim', arrived => {
      if (actor.waterTrip !== trip) return;
      if (!arrived || Math.hypot(actor.x - shoreX, actor.z - shoreZ) > .3 || (sighting && !sighting.valid())) { finishWater(); return; }
      trip.phase = clips.swim ? 'out' : 'watch'; actor.v = actor.gait = 0;
      actor.x = shoreX; actor.z = shoreZ;
      if (!clips.swim) actor.face = sighting ? null : 0;
      else if (actor.umb) { actor.umb.k = 0; actor.umb.root.visible = false; }
      V3.emit('shore:swim', trip.phase);
    }, undefined, path);
    if (ok) { actor.hurry = true; V3.emit('shore:swim', trip.phase); } else finishWater();
    return ok;
  }
  function waterTick(delta) {
    const actor = A, inst = actor.body.inst, trip = actor.waterTrip;
    if (trip.phase === 'out' || trip.phase === 'back') {
      trip.progress = U.clamp(trip.progress + delta * (trip.phase === 'back' ? -1 : 1) / trip.track.length, 0, 1);
      if (trip.progress === 0 && trip.phase === 'back') { finishWater(); return; }
      if (trip.progress === 1 && trip.phase === 'out') { trip.phase = 'swim'; V3.emit('shore:swim', trip.phase); }
    }
    if (trip.phase === 'swim' && !trip.floating) trip.drift += delta * .53;
    const point = trip.track.point(trip.progress, trip.drift), depth = V3.terrain.depthAt(...point);
    const water = depth >= .52 ? 'swim' : depth > 0 ? 'wade' : null;
    const clip = water === 'swim' ? (trip.floating && trip.clips.float) || trip.clips.swim : water === 'wade' ? trip.clips.wade : null;
    const height = V3.terrain.groundY(...point), surface = V3.water?.waveY(...point) ?? V3.layout.sea.y;
    const minFace = inst.setActorAnimation && Number.isFinite(trip.faceHeight) ? surface + .065 - trip.faceHeight : -Infinity;
    const targetY = depth < .52 ? height : Math.max(height, surface - (trip.floating ? .50 : .69), minFace);
    const shiftX = point[0] - actor.x, shiftZ = point[1] - actor.z;
    if (Math.hypot(shiftX, shiftZ) > .0001) actor.yaw += U.clamp(wrap(Math.atan2(shiftX, shiftZ) - actor.yaw), -delta * 3, delta * 3);
    actor.x = point[0]; actor.z = point[1]; actor.y += (targetY - actor.y) * Math.min(1, delta * 8); actor.anim += delta;
    actor.body.root.position.set(actor.x, actor.y, actor.z); actor.body.root.rotation.y = actor.yaw;
    inst.setWeather?.(actor.rainy ? 1 : 0, actor.rainy);
    if (inst.setActorAnimation) inst.setActorAnimation(clip, null, null, { posed: true, water });
    else if (inst.states.clip) inst.states.clip.value = clip || '';
    inst.states.pose.value = clip ? 'stand' : 'walk'; inst.update(delta, actor.anim);
    if (depth >= .52 && inst.setActorAnimation) {
      actor.body.headBone.localToWorld(trip.faceProbe.copy(actor.body.headTop).multiplyScalar(.66));
      trip.faceHeight = U.clamp(trip.faceProbe.y - actor.y, .02, actor.body.height);
    }
  }
  function leaveWater() {
    const trip = A?.waterTrip; if (!trip) return false;
    if (trip.phase === 'watch' || trip.phase === 'approach') return finishWater();
    trip.floating = false; trip.phase = 'back'; V3.emit('shore:swim', 'back'); return true;
  }
  function standSeat(reason) {
    const a = A, s = a && a.seated;
    if (!s) return false;
    a.seated = null;
    Object.assign(a, { x: s.back[0], y: s.back[1], z: s.back[2], yaw: s.yaw, yLock: null, pose: 'stand', poseCur: 'stand', poseK: 0, mode: 'idle', modeT: 1, v: 0, gait: 0 });
    a.body.root.position.set(a.x, a.y, a.z); a.body.root.rotation.set(0, a.yaw, 0);
    if (s.onEnd) { try { s.onEnd(reason); } catch (e) { warn('seat-end', String(e)); } }
    return true;
  }
  function interrupt() {
    stand('interrupted'); unshelter(); dropTask(); stop(false);
    Object.assign(A, { mode: 'idle', sub: '', got: null, pose: 'stand', poseCur: 'stand', poseK: 0, holdT: 0, v: 0, gait: 0, look: 0, lookTo: 0, lookUp: 0, cheerT: null, cheerK: 0 });
  }
  function respond(text, opts = {}) {
    const a = A;
    if (!a || HOLD) return false;
    interrupt();
    const seconds = U.clamp(Number(opts.seconds) || 3, 1, 12), p = opts.facePoint || (V3.R && V3.R.camera && V3.R.camera.position.toArray());
    a.attentionUntil = a.clock + seconds; a.modeT = seconds + 1; a.chatT = Math.max(a.chatT, seconds + 8);
    a.pose = opts.pose === 'cheer' ? 'cheer' : 'stand';
    if (p && Number.isFinite(p[0]) && Number.isFinite(p[2])) a.face = Math.atan2(p[0] - a.x, p[2] - a.z);
    say(text, opts.mood || 'happy');
    return true;
  }
  function poke() {
    const a = A;
    if (!a || HOLD || a.clock - a.lastPoke < 0.65) return false;
    const again = a.clock - a.lastPoke < 6;
    // 被戳醒（正躺着 / 正往床上去），或者夜里刚被戳起来又戳：迷迷糊糊地回一句
    const sleepy = !!(a.behavior && a.behavior.kind === 'sleep') || (REST && a.sleepyUntil > a.clock);
    a.lastPoke = a.clock; a.pokes++;
    if (sleepy) a.sleepyUntil = a.clock + 20;
    const text = line(sleepy ? (again ? 'pokeSleepy' : 'pokeAsleep') : again ? 'pokeAgain' : 'poke');
    // 和喂零食一样：她正坐着 / 正在做事时，戳一下只冒一句话，不打断当前动作（睡觉除外，戳醒要真醒）。
    const b = a.behavior;
    if ((a.seated || b) && !a.lying && !(b && b.kind === 'sleep') && !sleepy) {
      say(text, again ? 'happy' : 'surprise');
      a.chatT = Math.max(a.chatT, 3);
      V3.emit('actor:poke', { text, count: a.pokes });
      return true;
    }
    respond(text, { mood: sleepy ? 'think' : again ? 'happy' : 'surprise', seconds: 3.2 });
    V3.emit('actor:poke', { text, count: a.pokes });
    return true;
  }
  // ---- 吃零食（2026-11-17）：你拖一份零食 / 一杯喝的给她，或者她自己从零食篮里拿。站着转向 facePoint（默认镜头），
  //      按 kind 播吃或喝的手部动画；模型缺少对应动画时按骨骼摆姿势。
  //      拿在手里的那份由调用方画（69-snack-bar：每帧放到 hand() 上），snacking 告诉它还要拿多久。
  //      正在睡觉 / 正在吃饭 / 布置模式时不吃 → false；坐着（椅子 / 沙发 / 台阶 / 地板，或在书桌/沙发上看书看电视）
  //      不打断：保持现在的坐姿和正在做的事，只叠一层「手往嘴边送」的动作；站着 / 闲逛才转身停下吃。
  function snack(opts = {}) {
    const a = A;
    if (!a || HOLD) return false;
    const b = a.behavior;
    if (a.lying || a.shelter || (REST && !opts.force)) return false;
    if (b && (b.kind === 'sleep' || b.kind === 'eat')) return false;
    // 正赶去做一件事（还没坐下）：不打断她；等她坐下/做完再喂。
    if (b && !a.seated) return false;
    const seconds = U.clamp(Number(opts.seconds) || 3.2, 1.5, 8);
    // 坐着（或在做一件坐着的事）：不打断当前动作，就地吃。
    if (a.seated) {
      a.snackStarted = a.clock;
      a.snackBottle = opts.kind === 'drink' && opts.vessel === 'bottle';
      a.snackUntil = a.clock + seconds;
      a.snackKind = opts.kind === 'drink' ? 'drink' : 'eat';
      a.snackKeep = true;
      if (opts.text) say(opts.text, opts.mood || 'happy');
      return true;
    }
    if (!respond(opts.text || '', { seconds, mood: opts.mood || 'happy', facePoint: opts.facePoint })) return false;
    a.snackBottle = opts.kind === 'drink' && opts.vessel === 'bottle';
    a.snackStarted = a.clock;
    a.snackUntil = a.clock + seconds; a.snackKind = opts.kind === 'drink' ? 'drink' : 'eat';
    a.snackKeep = false;
    return true;
  }
  function canSit(a) {
    const b = a && a.body.inst.bones;
    return !!(b && b.legL && b.legR && b.legL.parent && b.legR.parent);
  }
  function sit(opts = {}) { return sitAt(opts, false); }
  function sitAt(opts, scripted) {
    const a = A, p = opts.position;
    if (!a || HOLD || !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite) || !canSit(a)) return false;
    if (!scripted) interrupt();
    a.attentionUntil = 0;
    a.seated = { position: p.slice(), back: [a.x, a.y, a.z], yaw: a.yaw, anchor: typeof opts.anchor === 'function' ? opts.anchor : null, tilt: 0,
      legs: Number.isFinite(opts.legs) ? U.clamp(opts.legs, 0.3, Math.PI / 2) : Math.PI / 2,   // 大腿往前抬多少（π/2 = 平着；台阶沿上小一点，腿往下垂）
      until: a.clock + U.clamp(Number(opts.seconds) || 12, 1, 120), onEnd: typeof opts.onEnd === 'function' ? opts.onEnd : null };
    Object.assign(a, { x: p[0], y: p[1], z: p[2], yaw: Number.isFinite(opts.yaw) ? opts.yaw : a.yaw, yLock: p[1], face: null, v: 0, gait: 0 });
    if (opts.text) say(opts.text, 'happy');
    if (!scripted) tick(0);
    return true;
  }
  function seatPose() {
    const a = A, s = a.seated; if (!s) return;
    if (s.anchor) {
      try { const t = s.anchor(); if (t && Array.isArray(t.position) && t.position.length === 3 && t.position.every(Number.isFinite)) { s.position = t.position.slice(); if (Number.isFinite(t.yaw)) a.yaw = t.yaw; s.tilt = U.clamp(Number(t.tilt) || 0, -0.35, 0.35); } }
      catch (e) { stand('anchor-error'); warn('seat-anchor', String(e)); return; }
    }
    const b = a.body.inst.bones, root = a.body.root;
    root.rotation.set(s.tilt, a.yaw, 0, 'YXZ'); root.updateMatrixWorld(true);
    // YSM has an internal PI turn; derive bend direction in each leg parent's space.
    for (const side of ['L', 'R']) {
      const leg = b['leg' + side], forward = new THREE.Vector3(0, 0, 1).transformDirection(root.matrixWorld).transformDirection(new THREE.Matrix4().copy(leg.parent.matrixWorld).invert());
      const angle = forward.z >= 0 ? -s.legs : s.legs;
      leg.rotation.x = angle; leg.rotation.z = side === 'L' ? 0.08 : -0.08;
      const knee = b['shin' + side] || b['lowerLeg' + side]; if (knee) knee.rotation.x = -angle;
    }
    root.updateMatrixWorld(true);
    const hip = b.legL.getWorldPosition(new THREE.Vector3()).add(b.legR.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    root.position.add(new THREE.Vector3(...s.position).sub(hip)); root.updateMatrixWorld(true);
  }
  // A single host-driven behavior owns navigation, seating, and clips until completion or interruption.
  // run：赶着去，路上跑（吃饭、回消息；别的行为 opts.run === true 时也跑——你叫她过去的）。
  // leisure（2026-11-14）：空闲时自己找的消遣——看书 read、看电视 watch_tv（坐到朝着电视的沙发上，没有沙发坐在电视前的地板上）、
  //   翻相册 album（坐在相册矮桌旁的地板上）、坐在门口台阶上看海 sea。它们给别的事让路：正事（吃饭、回消息、写日记、画画、睡觉）
  //   随时可以顶掉正在进行的消遣（'cancelled'，reason 'preempted'）；沙滩上的东西等够了，她自己放下消遣去收拾（reason 'collect'）；
  //   你点了电视 / 相册 / 书架（opts.interrupt + together）她跑过来一起看：正在看别的就换过来，已经在看同一样就接着看、算陪你。
  //   opts.while（函数）：返回 false 就结束（面板关了、电视关了）；opts.near [x, y, z]：有好几件时去离这一点最近的那件。
  const BEHAVIORS = {
    eat: { seconds: 24, max: 60, run: true },
    reply_private: { seconds: 12, max: 120, text: '我看看消息。', run: true },
    write_diary: { seconds: 15, max: 900, text: '写几句今天的事。' },
    draw: { seconds: 15, max: 480, text: '在这里画一会儿。' },
    // 消遣的时长由 89-cabin-routine 读设置「消遣」随机决定（默认 1–5 分钟，2026-11-18），
    // 这里 seconds 只是单独 startBehavior 时的默认值，max 只当兜底硬上限（30 分钟）。
    read: { seconds: 15, max: 1800, text: '翻几页书。', leisure: true },
    watch_tv: { seconds: 45, max: 1800, text: '看会儿电视。', leisure: true },
    watch_tank: { seconds: 40, max: 1800, text: '看看今天谁游到前面来了。', leisure: true },
    album: { seconds: 24, max: 1800, text: '翻翻相册。', leisure: true },
    sea: { seconds: 60, max: 1800, text: '坐这儿看会儿海。', leisure: true },
    stargaze: { seconds: 40, max: 1800, text: '看看今晚的星星。', leisure: true },
    garden_water: { seconds: 3, max: 120 },
    sleep: { seconds: 0, max: Infinity, text: '' },
  };
  // 消遣报给桥接（v6）：她自己找的消遣（together=false）/ 你点了东西她过来一起看（together=true）各说一句人话。
  // 只在她真的开始一段消遣时报一次（join 时 together 变了才补一次），别每拍报。
  const LEISURE_EVENT_TEXT = {
    read: ['自己翻几页书', '过来陪我一起看书'],
    watch_tv: ['自己看会儿电视', '过来陪我一起看电视'],
    watch_tank: ['去鱼缸边看鱼', '过来陪我一起看鱼'],
    album: ['翻翻相册', '过来陪我一起翻相册'],
    sea: ['坐在那儿看会儿海', '过来陪我一起看海'],
    stargaze: ['看看今晚的星星', '过来陪我一起看星星'],
  };
  const leisureEventText = (kind, together) => {
    const t = LEISURE_EVENT_TEXT[kind];
    return (t && (together ? t[1] : t[0])) || (BEHAVIORS[kind] && BEHAVIORS[kind].text) || '找点事做';
  };
  // opts.hold：做完以后坐着等，host 说结束才起身（书桌前的三样；消遣是陪你看的时候）
  const HOLDABLE = { reply_private: 1, write_diary: 1, draw: 1, read: 1, watch_tv: 1, album: 1, stargaze: 1 };
  // 看星星（2026-11-14）：只在夜里（天黑：V3.env 的 night > 0.6），下雨、下雪、打雷看不到。阁楼的望远镜：镜筒沿方块模型的 z，物镜（大头）
  // 朝家具正面、往上斜，目镜（小头）在背面 0.3 m、离地约 0.6 m。她站在背面、面朝正面，用 MC 的蹲下动作（main:sneaking）凑到目镜上
  function starry() {
    const st = V3.env && V3.env.state, w = wxRead();
    const night = st ? +(st.stars != null ? st.stars : st.night) || 0 : 0;
    return night > 0.6 && !(w && (Math.max(+w.rain || 0, +w.snow || 0) > 0.3 || +w.storm > 0.3));
  }
  const SCOPE_SPOTS = [[0, -0.66], [0.12, -0.7], [-0.12, -0.7], [0, -0.82]];
  // 看海时隔一阵随机演一段模型自带的动作（2026-11-14，用户点名的「拿出铁盆」那段是 main:idle_1）：[动画, 秒, 权重]。
  // 模型没有的跳过；全没有就只是坐着。坐着时腿由 seatPose 摆，这些动作只动上半身、表情和道具，坐在台阶上演也不穿帮（截图看过）
  const SEA_FIDGETS = [['main:idle_1', 17.5, 4], ['extra:extra10', 6, 1.5], ['extra:extra45', 6, 1], ['extra:extra15', 5, 1], ['extra:extra21', 5, 1],
    ['extra:extra16', 4, 0.7], ['extra:extra17', 4, 0.7], ['extra:extra18', 4, 0.7], ['extra:extra19', 4, 1]];
  function pickFidget(a) {
    const inst = a.body.inst, has = inst.hasAnimation ? k => inst.hasAnimation(k) : () => false;
    const pool = SEA_FIDGETS.filter(f => has(f[0]));
    if (!pool.length) return null;
    let r = a.rng() * pool.reduce((s, f) => s + f[2], 0);
    for (const f of pool) if ((r -= f[2]) < 0) return f;
    return pool[pool.length - 1];
  }
  const HOLD_MAX = 1800;                                           // host 一直没来收（页面出了别的错）：半小时后自己起身（消遣最多它自己的 max）
  // 座面在哪（2026-11-14）：方块模型里椅子不在自己那一格的正中间（desk_chair 的座面中心比格子中心往正面偏 3.75/16 m，椅背正好在格子
  // 中心）。以前按格子中心放她，用电脑时人落在椅背上、看起来趴在椅子后面。fwd = 座面中心往椅子正面偏多少（只有方块房子；旧布局的
  // 矩形就是椅子自己，不偏），up = 坐下时胯离地多高（座面上方 3 cm），side = 双人沙发两个座位离中线多远。胯放在座面中心后面 HIP_BACK
  const SEATS = { dining_chair: { fwd: 2.25 / 16, up: 0.37 }, desk_chair: { fwd: 3.75 / 16, up: 0.43 }, sofa: { fwd: 0.75 / 16, up: 0.47, side: 0.4 } };
  const HIP_BACK = 0.05;
  function seatHip(f, side) {
    const S = SEATS[f.kind] || SEATS.desk_chair, fwd = (f.block ? S.fwd : 0) - HIP_BACK, lat = (S.side || 0) * (side || 0);
    const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
    return [f.center[0] + fx * fwd + fz * lat, f.center[1] + S.up, f.center[2] + fz * fwd - fx * lat];
  }
  // 坐地板 / 坐台阶沿：胯离地多高、大腿抬多少（弧度）；台阶沿上胯在沿里面 STEP_BACK，腿往下垂一点
  const FLOOR_HIP = 0.06, STEP_HIP = 0.05, STEP_BACK = 0.12, STEP_LEGS = 1.2;
  const FACINGS = { north: 0, east: 90, south: 180, west: 270 };
  const facingYaw = facing => wrap(Math.PI - ((V3.furnMc && V3.furnMc.FACING_Y) || FACINGS)[facing] * Math.PI / 180);
  function behaviorFurniture(id) {
    const hb = V3.houseBlocks, fm = V3.furnMc, layout = V3.layout || {};
    // Once a block house exists, a missing block means removed, not a phantom default seat.
    if (hb && hb.furnInstances && (hb.grid || hb.model)) {
      return hb.furnInstances(id).flatMap(it => {
        const c = it.cell, yaw = facingYaw(it.facing);
        if (!c || !c.every(Number.isFinite) || !Number.isFinite(yaw)) return [];
        const offsets = fm && fm.cellsFor && it.f ? fm.cellsFor(it.f, it.facing).map(q => q.offset) : [[0, 0, 0]];
        const mid = k => (Math.min(...offsets.map(o => o[k])) + Math.max(...offsets.map(o => o[k]))) / 2;
        let center = [c[0] + 0.5 + mid(0), c[1], c[2] + 0.5 + mid(2)];
        if (id === 'kitchen_counter' && fm && fm.mover && fm.homeOf && it.f) {
          const home = fm.homeOf(it.f);
          // The cooker sits 50/32 m along the counter, near its right end.
          if (home) center = fm.mover(home, it).point([50 / 32, home.cell[1], -14.75]);
        }
        return [{ center, yaw, kind: id, block: true, key: id + ':' + c.join(',') }];
      });
    }
    if (layout.house && layout.house.blocks) return []; // model not ready yet
    const legacyFacing = { kitchen: 'south', bookshelf: 'south', dining: 'south', chairDW: 'east', chairDE: 'west', desk: 'east', deskChair: 'west', bed: 'north' };
    return (layout.ground || []).filter(r => r.block === 'xiaojingyu:' + id).map(r => {
      const center = [r.id === 'kitchen' ? (r.x0 + r.x1) / 2 + 50 / 32 : (r.x0 + r.x1) / 2, layout.house.floorY, (r.z0 + r.z1) / 2];
      return { center: hb && hb.place && hb.placePoint ? hb.placePoint(center, hb.place) : center, kind: id, block: false,
        yaw: hb && hb.place && hb.placeYaw ? hb.placeYaw(facingYaw(legacyFacing[r.id]), hb.place) : facingYaw(legacyFacing[r.id]) };
    });
  }
  function strictRoute(from, to) {
    const n = nav();
    try {
      if (!n.walkable(to[0], to[1], to[2]) || Math.abs(n.heightAt(to[0], to[1], to[2]) - to[2]) > 0.35) return null;
      const p = n.path(from, to), end = p && p[p.length - 1];
      if (!end || Math.hypot(end[0] - to[0], end[1] - to[1]) > 0.14 || (end[2] != null && Math.abs(end[2] - to[2]) > 0.35)) return null;
      return p.map(pt);
    } catch (e) { warn('behavior-nav', String(e)); return null; }
  }
  // 站到家具旁边的哪些点（[往它的右边, 往它的正面] 米，按顺序试）：seat = true 椅子旁边；false 站在它正面；数组 = 自己给一组
  const SEAT_SPOTS = [[0, 0.78], [0.78, 0], [-0.78, 0], [0.85, 0.28], [-0.85, 0.28], [0, 1.05], [1.05, 0], [-1.05, 0], [0.85, -0.48], [-0.85, -0.48]];
  const STAND_SPOTS = [[0, 0.78], [0, 1.03], [0.36, 0.86], [-0.36, 0.86], [0.7, 1.05], [-0.7, 1.05], [0, 1.28], [-0.9, 1.28], [0.9, 1.28]];
  const SOFA_SPOTS = [[0.4, 0.85], [-0.4, 0.85], [0.4, 1.1], [-0.4, 1.1], [1.25, 0.3], [-1.25, 0.3], [1.3, 0], [-1.3, 0]].concat(SEAT_SPOTS);   // 双人沙发：先试两个座位的正前方
  const TV_SPOTS = [[0, 1.7], [0.5, 1.7], [-0.5, 1.7], [0, 2.1], [0, 1.35], [0.6, 1.35], [-0.6, 1.35], [0.9, 2.0], [-0.9, 2.0]];           // 没有沙发：坐在电视前面的地板上
  const TABLE_SPOTS = [[0, 0.95], [0.95, 0], [-0.95, 0], [0, -0.95], [0, 1.15], [1.15, 0], [-1.15, 0], [0, -1.15]];                        // 矮桌四边的地板
  function approaches(f, seat) {
    const [x, y, z] = f.center, dx = Math.sin(f.yaw), dz = Math.cos(f.yaw);
    const offsets = Array.isArray(seat) ? seat : seat ? SEAT_SPOTS : STAND_SPOTS;
    return offsets.map(([side, front]) => [x + dx * front + dz * side, z + dz * front - dx * side, y]);
  }
  function approach(f, from, seat = false) {
    for (const to of approaches(f, seat)) {
      const path = strictRoute(from, to);
      if (path) return { to, path };
    }
    return null;
  }
  // Does seat c face t (same floor, within far metres)? A chair at its table: within 2 m. A sofa at its television: 4.5 m.
  const facesIt = (c, t, far) => {
    const x = t.center[0] - c.center[0], z = t.center[2] - c.center[2], d = Math.hypot(x, z);
    return d > 0.15 && d < far && Math.abs(t.center[1] - c.center[1]) < 0.25 &&
      Math.sin(c.yaw) * x + Math.cos(c.yaw) * z > d * 0.5;
  };
  const atTable = (c, t) => facesIt(c, t, 2);
  // 有好几件同样的家具：离 near（[x, y, z]，比如你点的那一点）近的排前面；没给就照原来的顺序
  const sortNear = (list, near) => !Array.isArray(near) || near.length < 3 ? list
    : list.slice().sort((p, q) => Math.hypot(p.center[0] - near[0], p.center[1] - near[1], p.center[2] - near[2]) - Math.hypot(q.center[0] - near[0], q.center[1] - near[1], q.center[2] - near[2]));
  const matchingChairs = (chairs, tables) => chairs.filter(c => tables.some(t => atTable(c, t)));
  // Where the bowl of her meal stands while she eats (69-furniture-play draws it): on the table her chair faces, on her side of it,
  // 0.27 m from the middle. Heights above the floor as authored in 56-furn-ground buildDining and the dining_table block model:
  // the cloth is 20/32 m up; the two plates (0.27 m from the middle along the table's own x) are 1/32 m thick. A chair in line with
  // a plate gets the bowl on that plate, a chair on one of the other two sides the bare cloth. → [x, y, z] of the bowl's foot, or null.
  const DISH_AT = 0.27, CLOTH_TOP = 20 / 32, PLATE_TOP = 21 / 32;
  function dishSpot(chair, tables) {
    let table = null, near = Infinity;
    for (const t of tables) {
      const d = Math.hypot(t.center[0] - chair.center[0], t.center[2] - chair.center[2]);
      if (d < near && atTable(chair, t)) { near = d; table = t; }
    }
    if (!table) return null;
    const fx = Math.sin(chair.yaw), fz = Math.cos(chair.yaw);
    const plate = Math.abs(fx * Math.sin(table.yaw) + fz * Math.cos(table.yaw)) < 0.5;   // she looks along the table's x: a plate is there
    return [table.center[0] - fx * DISH_AT, table.center[1] + (plate ? PLATE_TOP : CLOTH_TOP), table.center[2] - fz * DISH_AT];
  }
  const actorNavPos = a => [a.x, a.z, a.y];
  const blockedBehavior = () => HOLD || (V3.arrange && V3.arrange.on) || (V3.fb && V3.fb.enabled) || V3.backgroundPaused();
  let savingWater = false, retryWaterAt = 0;
  function thirstyPot(now) {
    const G = V3.game, astro = V3.env?.astro, R = V3.inventoryRules;
    if (!G?.live || !G.auto || G.S?.gardenHelp === false || REST || savingWater || now < retryWaterAt) return null;
    const inv = G.inventory?.(), pot = inv?.garden?.pot;
    if (!pot || !V3.windowGarden?.water || !R?.gardenZone || !R.gardenDay || !(astro?.localInfo?.(now).hour >= 12)) return null;
    // 午后看小屋的钟，浇过哪一天看存档固定的奖励时区。
    const day = R.gardenDay(now, R.gardenZone(inv, astro.site?.()?.tz));
    return pot.watered.at(-1) >= day ? null : pot;
  }
  async function waterAtWindow(a, b) {
    savingWater = b.waterPending = true;
    let result;
    try { result = await V3.windowGarden.water('girl'); }
    catch (e) { warn('garden-water', '浇花存档失败：' + e); }
    finally { savingWater = b.waterPending = false; }
    if (result?.ok !== true || result.applied !== true) {
      retryWaterAt = Date.now() + 30000;
      if (A === a && a.behavior === b) cancelBehavior('water-not-applied');
    }
  }
  function behaviorPlan(kind, opts) {
    const a = A, n = nav(), interrupt = !!(opts && opts.interrupt === true);
    const ownerVisualVisit = (kind === 'watch_tank' || kind === 'stargaze') && interrupt && opts.preempt === true;
    // A route that cannot be planned from mid-stride is reported as busy (ask again), not as an unreachable kitchen.
    const stroll = !!(interrupt && a && a.mode === 'walk' && a.why === 'wander' && !a.task);
    // 正在收拾沙滩（走向下一件，或者两件之间）时来了要紧的事：放下去做。正蹲着捡的那一件先捡完（mode 'pick' 算忙）
    const sweeping = !!(interrupt && a && a.sweep && (a.mode === 'idle' || (a.mode === 'walk' && a.why === 'collect')));
    const fail = reason => ({ available: false, reason: !ownerVisualVisit && (stroll || sweeping) && reason === 'unreachable' ? 'busy' : reason });
    if (!Object.hasOwn(BEHAVIORS, kind)) return fail('unknown-behavior');
    if (!a) return fail('actor-not-ready');
    if (a.waterTrip) return fail('busy');
    const spec = BEHAVIORS[kind], cur = a.behavior, curLeisure = !!(cur && BEHAVIORS[cur.kind].leisure);
    if (kind === 'garden_water' && (cur || a.sweep || a.manual || REST)) return fail('busy');
    // Bed is the best shelter there is: a storm does not keep her from going to sleep (from the porch edge she first has to be seated there).
    const bedtime = kind === 'sleep', sheltered = bedtime && !!a.shelter && a.shelter.sub === 'wait' && a.poseCur === 'huddle';
    if (blockedBehavior() || (!bedtime && (a.shelter || a.storm)) || (bedtime && a.shelter && !sheltered)) return fail('blocked');
    // 她已经在做这一样消遣，你又叫她（点了电视 / 相册 / 书架）：不重来，接着做，算陪你（startBehavior → joinBehavior）
    const otherScope = kind === 'stargaze' && cur?.kind === kind && opts.telescopeKey && opts.telescopeKey !== cur.target.key;
    if (curLeisure && cur.kind === kind && interrupt && !otherScope) return { available: true, join: true };
    // 正在进行的消遣让路：来的是正事，或者是你叫她去看别的
    const yields = (curLeisure || cur?.kind === 'garden_water') && (cur.kind !== kind || otherScope) && (!spec.leisure || interrupt);
    const moving = a.mode === 'idle' || stroll || sweeping || (yields && a.mode === 'walk' && a.why === 'behavior');
    if (V3.shellControls?.busy || (ownerVisualVisit && a.mode === 'pick' && a.sub === 'saving')) return fail('busy');
    if (!ownerVisualVisit && ((cur && !yields) || !moving || (a.sweep && !sweeping) || (a.seated && !yields)
      || a.attentionUntil > a.clock || a.holdT > 0 || (a.poseK > 0.02 && !sheltered))) return fail('busy');
    if (!n || !n.path || !n.walkable || !n.heightAt) return fail('navigation-unavailable');
    // Plan from the same safe point that standing up or leaving the bed will restore.
    const back = (ownerVisualVisit || yields) && (a.seated?.back || a.lying?.from);
    const from = back ? [back[0], back[2], back[1]] : actorNavPos(a);
    const near = opts && opts.near;
    if (kind === 'garden_water') {
      const pot = thirstyPot(Date.now());
      if (!pot || sweepDue()) return fail('not-due');
      const spot = V3.gardenScene?.approach?.();
      if (!spot) return fail('missing-pot');
      const [x, y, z] = spot, to = [x, z, y], path = strictRoute(from, to);
      if (!path) return fail('unreachable');
      const house = V3.houseBlocks, yaw = house?.place ? house.placeYaw(0, house.place) : 0;
      const center = V3.shellDecor?.gardenSill?.()?.position || [x + Math.sin(yaw), y, z + Math.cos(yaw)];
      return { available: true, first: { to, path }, phase: 'to_garden', target: {
        kind: pot.kind, plantedAt: pot.plantedAt, spot: spot.slice(), center,
      } };
    }
    if (bedtime) {
      const beds = behaviorFurniture('bed');
      for (const target of beds) for (const [to, side] of bedsides(target)) {
        const path = strictRoute(from, to);
        if (path) return { available: true, first: { to, path }, target, side, phase: 'to_bed' };
      }
      return fail(beds.length ? 'unreachable' : 'missing-furniture');
    }
    if (kind === 'read') {
      const shelves = sortNear(behaviorFurniture('bookshelf'), near);
      for (const target of shelves) { const first = approach(target, from); if (first) return { available: true, first, target, phase: 'to_bookshelf' }; }
      return fail(shelves.length ? 'unreachable' : 'missing-furniture');
    }
    if (kind === 'watch_tank') {
      const target=V3.shallows?.watchTarget?.(); if(!target)return fail('empty-tank');
      if(target.outdoor && (a.storm || wetNow()))return fail('weather');
      const z=Math.max(.88,target.depth/2+.54), x=Math.max(.93,target.width/2+.55);
      const first=approach(target,from,[[.30,z],[-.35,z],[0,z+.16],[x,.12],[-x,.12],[0,-z]]);
      return first?{available:true,first,target,phase:'to_tank',ownerVisualVisit}:fail('unreachable');
    }
    if (kind === 'watch_tv') {
      const tvs = sortNear(behaviorFurniture('tv_stand'), near), sofas = canSit(a) ? behaviorFurniture('sofa') : [];
      for (const target of tvs) {
        for (const sofa of sofas) {                 // 朝着这台电视的沙发：坐上去看（离她站的那一点近的那个座位）
          if (!facesIt(sofa, target, 4.5)) continue;
          const first = approach(sofa, from, SOFA_SPOTS);
          if (!first) continue;
          const side = (first.to[0] - sofa.center[0]) * Math.cos(sofa.yaw) - (first.to[1] - sofa.center[2]) * Math.sin(sofa.yaw) >= 0 ? 1 : -1;
          return { available: true, first, target, chair: sofa, side, phase: 'to_seat' };
        }
        const first = approach(target, from, TV_SPOTS);   // 没有沙发：坐在电视前面的地板上（坐不了的角色站着看）
        if (first) return { available: true, first, target, phase: 'to_floor' };
      }
      return fail(tvs.length ? 'unreachable' : 'missing-furniture');
    }
    if (kind === 'album') {
      const tables = sortNear(behaviorFurniture('photo_album_table'), near);
      for (const target of tables) { const first = approach(target, from, TABLE_SPOTS); if (first) return { available: true, first, target, phase: 'to_floor' }; }
      return fail(tables.length ? 'unreachable' : 'missing-furniture');
    }
    if (kind === 'stargaze') {                      // 阁楼的望远镜：只在夜里、天上看得到星星的时候
      if (opts?.together && V3.starView ? V3.starView.reason() : !starry()) return fail('daytime');
      if (!canSit(a)) return fail('seating-unavailable');
      const scopes = sortNear(behaviorFurniture('telescope').filter(scope => !opts.telescopeKey || scope.key === opts.telescopeKey), near);
      for (const target of scopes) { const first = approach(target, from, SCOPE_SPOTS); if (first) return { available: true, first, target, phase: 'to_scope', ownerVisualVisit }; }
      return fail(scopes.length ? 'unreachable' : 'missing-furniture');
    }
    if (kind === 'sea') {                           // 门口的台阶沿上（和躲雷坐的是同一个地方），面朝大海；下雨下雪不去
      if (a.rainy || wetNow()) return fail('blocked');
      const s = seat(), to = [s.ex, s.ez, s.y], path = strictRoute(from, to);
      if (!path) return fail('unreachable');
      return { available: true, first: { to, path }, target: { center: [s.x, s.y, s.z], yaw: s.yaw }, phase: 'to_steps' };
    }
    if (!canSit(a)) return fail('seating-unavailable');
    const meal = kind === 'eat';
    const chairs = matchingChairs(behaviorFurniture(meal ? 'dining_chair' : 'desk_chair'), behaviorFurniture(meal ? 'dining_table' : 'desk'));
    if (!chairs.length) return fail('missing-furniture');
    if (meal) {
      const counters = behaviorFurniture('kitchen_counter');
      if (!counters.length) return fail('missing-furniture');
      for (const target of counters) for (const to of approaches(target, false)) {
        const path = strictRoute(from, to);
        if (!path) continue;
        const chair = chairs.find(c => approach(c, to, true));
        if (chair) return { available: true, first: { to, path }, target, chair, phase: 'to_counter' };
      }
    } else for (const chair of chairs) {
      const first = approach(chair, from, true);
      if (first) return { available: true, first, chair, phase: 'to_desk' };
    }
    return fail('unreachable');
  }
  const wetNow = () => { const w = wxRead(); return !!w && Math.max(+w.rain || 0, +w.snow || 0) > 0.3; };
  function behaviorAvailability(kind, opts) {
    const { available, reason } = behaviorPlan(kind, opts);
    return reason ? { available, reason } : { available };
  }
  function behaviorEvent(b, phase, extra) {
    const e = { kind: b.kind, phase, at: Date.now() };
    if (b.leisure) { e.leisure = true; e.together = !!b.together; if (b.target && b.target.center) e.spot = b.target.center.slice(); }
    V3.emit('actor:behavior', Object.assign(e, extra));
  }
  function startBehavior(kind, opts = {}) {
    opts = opts || {};
    const plan = behaviorPlan(kind, opts);
    if (!plan.available) return false;
    const a = A, spec = BEHAVIORS[kind], secs = opts.seconds;
    if (plan.join) return joinBehavior(a.behavior, opts);
    if (a.behavior) finishBehavior(false, 'preempted');   // 路线已确认，结束旧动作后从同一起点出发
    if (a.task || a.sweep) dropTask();                    // 放下还没保存的贝壳
    if (plan.ownerVisualVisit) {
      if (a.seated) standSeat('preempted');
      Object.assign(a, { attentionUntil: 0, holdT: 0, pose: 'stand', poseCur: 'stand', poseK: 0, v: 0, gait: 0 });
    }
    const hold = !!(opts.hold === true && HOLDABLE[kind]);
    if (a.shelter) unshelter();                  // only 'sleep' gets here from the porch edge (see behaviorPlan)
    const b = a.behavior = { kind, phase: plan.phase, target: plan.target, chair: plan.chair, start: a.clock,
      until: a.clock + (hold ? (spec.leisure ? spec.max : HOLD_MAX) : spec.max), text: typeof opts.text === 'string' ? opts.text : spec.text,
      seconds: kind === 'eat' || kind === 'sleep' || !Number.isFinite(secs) ? spec.seconds : U.clamp(secs, 1, spec.max - 0.6),
      house: V3.houseBlocks, houseVersion: V3.houseBlocks && V3.houseBlocks.version, hold, side: plan.side || 0,
      run: !!(spec.run || opts.run === true), leisure: !!spec.leisure, together: !!(spec.leisure && opts.together === true),
      while: typeof opts.while === 'function' ? opts.while : null, chatAt: Infinity,
      dish: kind === 'eat' ? dishSpot(plan.chair, behaviorFurniture('dining_table')) : null };
    if (kind === 'watch_tank') b.photoOnly = opts.photoOnly === true;
    Object.assign(a, { look: 0, lookTo: 0, lookUp: 0 });
    if (kind === 'garden_water') {
      b.can = makeWateringCan(); a.body.root.add(b.can.root); poseWateringCan(a, b);
    }
    behaviorGo(b, plan.first, plan.phase);
    behaviorEvent(b, 'started');
    // 她自己开始 / 你叫她过来陪你看：一段消遣报一次（她已经在看同一样、你又叫一次走 joinBehavior，不在这里）
    if (b.leisure) emitCabinEvent('leisure_start', { kind, together: !!b.together }, leisureEventText(kind, !!b.together));
    return true;
  }
  // 她已经在做这样消遣，你又叫了一次：改成陪你（together / hold / while 换成这次给的），时间重新算，路上的话跑起来
  function joinBehavior(b, opts) {
    const a = A, spec = BEHAVIORS[b.kind], alone = !b.together;
    if (b.kind === 'watch_tank') b.photoOnly = opts.photoOnly === true;
    if (opts.together === true) b.together = true;
    // 她自己在做这样消遣，你过来点开了同一件：从「自己」变成「陪你」，这一下值得说一次；之后再叫不重复报
    if (b.leisure && alone && b.together) emitCabinEvent('leisure_start', { kind: b.kind, together: true }, leisureEventText(b.kind, true));
    if (opts.hold === true && HOLDABLE[b.kind]) b.hold = true;
    if (typeof opts.while === 'function') b.while = opts.while;
    b.until = a.clock + spec.max;
    if (opts.run === true) { b.run = true; if (a.mode === 'walk' && a.why === 'behavior') a.hurry = true; }
    if (b.phase === 'action') {
      b.actionStart = a.clock; b.next = a.clock + b.seconds;
      if (typeof opts.text === 'string' && opts.text) say(opts.text, 'happy');
    } else if (typeof opts.text === 'string') b.text = opts.text;
    return true;
  }
  const FACE_NEXT = { to_counter: 'face_counter', to_bookshelf: 'face_bookshelf', to_floor: 'face_floor', to_steps: 'face_steps', to_scope: 'face_scope', to_tank:'face_tank', to_garden: 'face_garden' };
  function behaviorGo(b, route, phase) {
    const a = A, { to, path } = route;
    b.phase = phase;
    const going = go(to[0], to[1], 'behavior', ok => {
      if (A !== a || a.behavior !== b) return;
      if (!ok || Math.hypot(a.x - to[0], a.z - to[1]) > 0.16 || Math.abs(a.y - to[2]) > 0.35) return cancelBehavior('unreachable');
      Object.assign(a, { v: 0, gait: 0 });
      if (phase === 'to_bed') {                  // turn her back to the pillow, then lie back (sleepTick)
        b.phase = 'face_bed'; a.face = wrap(b.target.yaw + Math.PI);
      } else if (FACE_NEXT[phase]) {             // turn to the thing first (the steps: to the sea); behaviorTick goes on from there
        b.phase = FACE_NEXT[phase];
        // 台阶：转向大海；望远镜：顺着镜筒朝家具正面（物镜那头）；别的：转向那件家具
        a.face = phase === 'to_steps' || phase === 'to_scope' ? b.target.yaw : Math.atan2(b.target.center[0] - a.x, b.target.center[2] - a.z);
      } else {                                   // a chair (dining, desk) or the sofa: hips onto the seat surface the block model really has
        if (!sitAt({ position: seatHip(b.chair, b.side), yaw: b.chair.yaw }, true)) return cancelBehavior('seating-unavailable');
        b.phase = 'sit'; b.next = a.clock + 0.45;
      }
    }, to[2], path);
    if (going && b.run && a.behavior === b && a.mode === 'walk') a.hurry = true;   // 赶着去：跑
  }
  function finishBehavior(completed, reason) {
    const a = A, b = a && a.behavior;
    if (!b) return false;
    a.behavior = null; // clear ownership before cancelling the route or standing
    if (b.can) {
      b.can.root.removeFromParent();
      for (const mesh of b.can.meshes) mesh.geometry.dispose();
      b.can.material.dispose();
    }
    if (a.why === 'behavior' && a.mode === 'walk') stop(false);
    if (a.seated) standSeat(reason || 'completed');
    if (a.lying) leaveBed(a);
    Object.assign(a, { mode: 'idle', modeT: 2, v: 0, gait: 0, face: null, pose: 'stand' });
    const inst = a.body.inst;
    if (inst.setActorAnimation) inst.setActorAnimation();
    const detail = { durationMs: Math.round((a.clock - b.start) * 1000) };
    if (reason) detail.reason = reason;
    behaviorEvent(b, completed ? 'completed' : 'cancelled', detail);
    return true;
  }
  function cancelBehavior(reason = 'cancelled') { return finishBehavior(false, reason); }
  // The host ends an open-ended behaviour the normal way: sleep gets up (0.9 s), a held desk behaviour stands up now -> 'completed'.
  function endBehavior() {
    const a = A, b = a && a.behavior;
    if (!b) return false;
    if (b.kind === 'sleep') {
      if (b.phase === 'rise') return true;
      if (!a.lying) return finishBehavior(true);            // still on her way to the bed: just stop
      b.phase = 'rise';
      if (V3.bubble && V3.bubble.hide) { try { V3.bubble.hide('girl'); } catch (e) { warn('bh', 'bubble.hide: ' + e); } }
      return true;
    }
    if (!b.hold) return false;
    if (b.phase !== 'action') { b.hold = false; b.until = Math.min(b.until, a.clock + BEHAVIORS[b.kind].max); return true; }   // not there yet: the usual short visit
    return finishBehavior(true);
  }
  // A held desk behaviour: the same real thing happened again (another reply) -> type again for the usual seconds.
  function renewBehavior() {
    const a = A, b = a && a.behavior;
    if (!b || !b.hold) return false;
    b.until = a.clock + (b.leisure ? BEHAVIORS[b.kind].max : HOLD_MAX);
    if (b.phase !== 'action') return true;                  // on her way: the visit that is about to start covers it
    b.actionStart = a.clock; b.next = a.clock + b.seconds;
    behaviorEvent(b, 'action');
    return true;
  }
  function enterBehaviorAction(a, b) {
    b.phase = 'action'; b.actionStart = a.clock; b.next = a.clock + b.seconds;
    if (b.kind === 'garden_water') void waterAtWindow(a, b);
    if (b.leisure) b.chatAt = a.clock + (b.together ? 6 : 10) + a.rng() * 8;
    if (b.kind === 'sea') { b.fidget = null; b.fidgetAt = a.clock + 8 + a.rng() * 8; }   // 坐下 8–16 秒后第一次随机动作
    if (b.text) say(b.text, 'happy');
    driveBehaviorAnimation(a, a.body.inst, false);
    behaviorEvent(b, 'action');
    if (b.kind === 'watch_tank' && !b.photoOnly) V3.shallows?.feedIfNeededToday?.();
  }
  function behaviorTick() {
    const a = A, b = a.behavior;
    if (blockedBehavior()) return cancelBehavior('blocked');
    if (b.house !== V3.houseBlocks || (b.house && b.house.version !== b.houseVersion)) return cancelBehavior('house-changed');
    if (b.kind === 'sleep') return sleepTick(a, b);
    if (b.kind === 'garden_water' && (!V3.game?.auto || V3.game.S?.gardenHelp === false || REST)) return cancelBehavior('disabled');
    if (b.kind==='watch_tank') {
      const target=V3.shallows?.watchTarget?.();if(!target || target.key!==b.target.key)return cancelBehavior('tank-changed');
      if(target.outdoor && (a.storm || wetNow()))return cancelBehavior('weather');
      if(b.phase==='action')a.lookTo=.21*Math.sin((a.clock-b.actionStart)*.68);
    }
    // 她自己找的消遣（不是陪你看的）：沙滩上的东西等够了，放下去收拾（brain 下一拍进入收拾状态）
    if ((b.leisure && !b.together || b.kind === 'garden_water') && sweepDue()) return cancelBehavior('collect');
    // opts.while：陪你看的那样东西关掉了（相册面板、电视）→ 已经坐下看了一会儿算看完，还在路上就不去了
    if (b.while && !(b.phase === 'action' && a.clock - b.actionStart < 2)) {
      let on = true;
      try { on = !!b.while(); } catch (e) { warn('behavior-while', String(e)); on = false; }
      if (!on) return b.phase === 'action' ? finishBehavior(true) : cancelBehavior('dismissed');
    }
    if (b.phase === 'action' && a.clock >= b.next && !b.hold && !b.waterPending) return finishBehavior(true);
    if (a.clock >= b.until) return b.hold && b.phase === 'action' ? finishBehavior(true) : cancelBehavior('timeout');
    const wx = wxRead();
    if (wx && +wx.storm > 0.5 && !indoors()) return cancelBehavior('weather');
    if (b.kind === 'sea' && wetNow()) return cancelBehavior('weather');      // 下起雨了：不在台阶上坐着了
    if (b.kind === 'stargaze' && (b.together && V3.starView ? V3.starView.reason() : !starry())) {
      if (b.phase === 'action') { say(wetNow() ? '下雨了，星星躲起来了。' : '天亮啦，星星看不到了。', 'think'); return finishBehavior(true); }
      return cancelBehavior('daytime');
    }
    if (b.kind === 'sea' && b.phase === 'action' && a.seated) {               // 看海时隔一阵随机演一段模型自带的动作
      if (b.fidget && a.clock >= b.fidget.until) { b.fidget = null; b.fidgetAt = a.clock + 15 + a.rng() * 20; }
      else if (!b.fidget && a.clock >= b.fidgetAt) {
        const f = pickFidget(a);
        if (f) { b.fidget = { clip: f[0], until: a.clock + f[1] }; b.chatAt = Math.max(b.chatAt, b.fidget.until + 4); }
        else b.fidgetAt = Infinity;
      }
    }
    if (b.leisure && b.phase === 'action' && a.clock >= b.chatAt && LINES[b.kind] && !b.fidget) {   // 坐着 / 看着的时候隔一阵说一句；陪你看时说得勤一点
      b.chatAt = a.clock + (b.together ? 9 + a.rng() * 7 : 18 + a.rng() * 16);
      say(line(b.kind), a.rng() < 0.4 ? 'think' : 'happy');
    }
    if (b.phase === 'face_garden' && a.face == null) {
      const pot = thirstyPot(Date.now()), spot = V3.gardenScene?.approach?.();
      if (!pot || pot.kind !== b.target.kind || pot.plantedAt !== b.target.plantedAt || !spot ||
          spot.some((v, i) => Math.abs(v - b.target.spot[i]) > 0.05)) return cancelBehavior('garden-changed');
      enterBehaviorAction(a, b);
    } else if (b.phase === 'face_counter' && a.face == null) {
      b.phase = 'pickup'; b.actionStart = a.clock; b.next = a.clock + 1.15;
      V3.emit('actor:meal', { step: 'pickup', at: Date.now() });   // the cooker (69-furniture-play) fills the bowl at this moment
      if (a.behavior !== b) return;
      const fp = V3.furniturePlay;   // only announce cooked rice when a cooker really has some
      say(fp && fp.hasRice && fp.hasRice() ? '饭好了，盛一碗。' : '拿上碗筷，吃点东西。', 'happy');
    } else if (b.phase === 'pickup' && a.clock >= b.next) {
      const route = approach(b.chair, actorNavPos(a), true);
      if (route) behaviorGo(b, route, 'to_chair'); else cancelBehavior('unreachable');
    } else if ((b.phase === 'face_floor' || b.phase === 'face_steps' || b.phase === 'face_scope') && a.face == null) {
      // 转好了：坐下。地板：就坐在站的这一点；台阶：胯挪到门廊沿上，腿垂在台阶前面。坐不了的角色（没有腿骨骼）站着看
      const steps = b.phase === 'face_steps', s = steps ? seat() : null;
      const at = steps ? { position: [s.x - Math.sin(s.yaw) * STEP_BACK, s.y + STEP_HIP, s.z - Math.cos(s.yaw) * STEP_BACK], yaw: s.yaw, legs: STEP_LEGS }
        : { position: [a.x, a.y + FLOOR_HIP, a.z], yaw: a.yaw };
      if (canSit(a) && sitAt(at, true)) { b.phase = 'sit'; b.next = a.clock + 0.45; }
      else if (b.phase === 'face_scope') cancelBehavior('seating-unavailable');
      else enterBehaviorAction(a, b);
    } else if ((b.phase === 'sit' && a.clock >= b.next) || ((b.phase === 'face_bookshelf' || b.phase === 'face_tank') && a.face == null)) {
      enterBehaviorAction(a, b);
    }
  }
  function driveBehaviorAnimation(a, inst, walking) {
    const b = a.behavior, clip = (...keys) => inst.hasAnimation ? keys.find(k => inst.hasAnimation(k)) : undefined;
    let base, overlay, mode, fallback;
    if (!walking && a.pose === 'pickup' && a.poseCur === 'pickup') {
      overlay = clip('extra:PickShell', 'main:PickShell', 'arm:PickShell', 'tlm:PickShell') || (inst.findAnimation && inst.findAnimation('PickShell')) || clip('main:use_mainhand', 'arm:use_mainhand', 'main:swing_hand'); mode = 'hold';
    }
    // 赶着去（回消息、吃饭、你叫她过去；也包括不属于行为的 goto(…, { run })）：跑起来以后放模型自己的跑步动画
    if (walking && a.hurry && a.v > 1.05) base = clip('main:run', 'main:sprint');
    if (b) {
      if (a.seated) base = clip('main:sit', 'tlm:chair');
      if (a.lying && a.lying.clip && b.phase !== 'rise') base = a.lying.clip;
      if (b.phase === 'pickup') {
        overlay = clip('main:use_mainhand', 'arm:use_mainhand', 'main:swing_hand'); mode = 'hold';
        fallback = 0.65 * Math.sin(Math.PI * U.clamp((a.clock - b.actionStart) / 1.15, 0, 1));
      } else if (b.phase === 'action') {
        const t = a.clock - b.actionStart;
        if (b.kind === 'eat' && a.seated) {
          overlay = clip('arm:use_mainhand:eat', 'arm:use_offhand:eat'); mode = 'loop';
          fallback = (1 - Math.cos(t * TAU / 1.625)) * 0.55;
        } else if (b.kind === 'garden_water') {
          overlay = clip('main:use_mainhand', 'arm:use_mainhand'); mode = 'hold'; fallback = 0.75;
        } else if (b.kind === 'read') base = clip('tlm:bookshelf');
        else if (b.kind === 'sea' && b.fidget) base = clip(b.fidget.clip) || base;
        // At the desk (reply / diary / draw) she types; held and done typing: she just sits. Sofa, floor and steps: she just sits.
        else if (a.seated && !b.leisure && !(b.hold && a.clock >= b.next)) base = clip('tlm:keyboard', 'tlm:computer') || base;
      }
    }
    const snacking = a.snackUntil > a.clock && (a.seated || (!b && !walking && a.attentionUntil > a.clock));
    const sipping = snacking && a.snackKind === 'drink';
    if (snacking) {
      overlay = sipping ? clip('arm:use_mainhand:drink') : clip('arm:use_mainhand:eat', 'arm:use_offhand:eat');
      mode = 'loop';
      const left = a.snackUntil - a.clock;
      fallback = sipping ? ease(U.clamp(Math.min(a.clock-a.snackStarted, left)/.65, 0, 1)) :
        (1 - Math.cos(left * TAU / 1.2)) * .6;
    }
    // 不坐着、不躺着时演的底层动画（翻书 tlm:bookshelf、跑 main:run）脚要踩在地上：29-ysm 按这个动画量出脚比站着低多少，往上抬回来
    // posed：坐着（书桌、摇椅……）或躺着时她不是「站着发呆」，模型自己的待机动画（自带模型站满约 38 秒的铁盆）不演
    if (inst.setActorAnimation) inst.setActorAnimation(base, overlay, mode, { ground: !!base && !a.seated && !(a.lying && base === a.lying.clip), posed: !!(a.seated || a.lying) });
    if (!overlay && fallback) return bones => {
      if (sipping) {
        const bend = inst.noOverlay ? fallback : -fallback; // YSM 模型面朝局部 -Z，旧模型面朝 +Z。
        bones.armR.rotation.x += bend * (bones.forearmR ? 1.3 : 1.95);
        if (bones.forearmR) bones.forearmR.rotation.x += bend * 1.1;
        bones.head.rotation.x += bend * .16;
        return;
      }
      if (bones.armR) bones.armR.rotation.x -= fallback;
      if (bones.forearmR) bones.forearmR.rotation.x -= fallback * 0.8;
    };
    return null;
  }
  // ---- 睡觉（kind 'sleep'）：走到床边 → 背朝枕头转好 → 往后躺下（LIE_T 秒）→ 睡到 host 叫她（endBehavior）→ 起身（RISE_T 秒）----
  // 床的尺寸照 56-furn-ground buildBed（1 × 2 m，床头在 facing 那头）：被面离地 0.5 m，枕头面 0.59 m，枕头中心离床中心 0.766 m，
  // 床头板里面 0.9375 m。她躺在床正中（自带模型摊开的手臂有 0.78 m 宽，鱼尾巴还要往一边甩，偏一点就伸到床外面去了），只往她上床
  // 的那一侧偏 BED_SIDE。头心对着枕头中心，但头顶离床头板至少 2 cm（自带模型头大，会往床尾挪一点）。
  // 身子陷在被子里：胯离地 BED_HIP（比被面低，腿、手、尾巴都在被面下面，被方块床自己挡住），头心比胯高 BED_PILLOW（上身斜靠在枕头上，
  // 头露在枕头上面）；胸口到脚那一段由 V3.furn.sleepCover 的鼓包盖住（COVER_W / COVER_H：半宽、最高处，床的设计格）。
  const LIE_T = 1.1, RISE_T = 0.9, BED_SIDE = 0.03, BED_HIP = 0.47, BED_PILLOW = 0.23, BED_HEAD = 0.766, BED_BOARD = 0.9175, BED_TOP = 0.5;
  const COVER_W = 12, COVER_H = 7.6;
  const BED_OFF = [[0.83, 0.1], [0.83, -0.3], [0.83, 0.5], [0.95, 0.1], [0.83, -0.7], [0.95, -0.4], [0.83, 0.8], [1.05, 0.1]];   // [离床中线, 往床头] 米
  const ZZZ = ['Zzz…', 'z z Z…', '呼……'];
  const _ly = new THREE.Vector3();
  // 床两侧能站的点（先试离她现在近的那一侧）→ [[x, z, y], side]；side：+1 = 床自己的 +x 那侧（56-furn-ground 的设计坐标），−1 = 另一侧
  function bedsides(f) {
    const a = A, [x, y, z] = f.center, hx = Math.sin(f.yaw), hz = Math.cos(f.yaw), rx = -hz, rz = hx;   // h = 往床头，r = 床的 +x
    const near = (a.x - x) * rx + (a.z - z) * rz >= 0 ? 1 : -1, out = [];
    for (const side of [near, -near]) for (const [lat, fwd] of BED_OFF) out.push([[x + rx * lat * side + hx * fwd, z + rz * lat * side + hz * fwd, y], side]);
    return out;
  }
  // 躺着的时候，root 局部坐标（y 往上、z 往前）里头心、脖子、胯在哪。每个身体量一次（换身体重新量）。有躺着的动画就按它量；
  // 没有（导入的模型、v1）按站着量，躺下时整个人往后放倒（lyingPose 转 root）。量不出来 → null：这个身体不会躺，sleep 取消
  function lyingRig(a) {
    const B = a.body;
    if (B.lyingRig !== undefined) return B.lyingRig;
    B.lyingRig = null;
    try {
      const inst = B.inst, root = B.root, b = inst.bones;
      const clip = inst.hasAnimation && inst.setActorAnimation ? ['extra:extra13', 'extra:extra12'].find(k => inst.hasAnimation(k)) || null : null;   // 躺着 / 睡觉
      if (clip) inst.setActorAnimation(clip);
      inst.states.pose.value = 'stand'; inst.poseK = 0; inst.update(0, a.anim);   // dt 0：直接摆成那个姿势，不淡入
      root.updateMatrixWorld(true);
      const local = (v) => root.worldToLocal(v);
      const neck = local(b.head.getWorldPosition(new THREE.Vector3())), top = local(b.head.localToWorld(B.headTop.clone()));
      const hip = b.legL && b.legR ? local(b.legL.getWorldPosition(new THREE.Vector3()).add(b.legR.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5)) : null;
      if (clip) { inst.setActorAnimation(); inst.update(0, a.anim); root.updateMatrixWorld(true); }
      const leg = Math.max(0.1, +inst.leg || LEG);
      if (!hip) return null;
      const head = neck.clone().add(top).multiplyScalar(0.5);
      const dy = head.y - hip.y, dz = head.z - hip.z, len = Math.hypot(dy, dz);
      if (!Number.isFinite(len + neck.y + neck.z + top.y + top.z + head.x) || len < 0.08 || len > 3) return null;
      // base = 「胯 → 头」原来的仰角（躺着的动画 ≈ 0：平着朝后；站着 = π/2：朝上）
      B.lyingRig = { clip, x: head.x, head: [head.y, head.z], hip: [hip.y, hip.z], len, leg, base: Math.atan2(dy, -dz),
        reach: Math.hypot(top.y - head.y, top.z - head.z), neck: Math.hypot(neck.y - hip.y, neck.z - hip.z) };
    } catch (e) { warn('lying-rig', 'lying: ' + e); B.lyingRig = null; }
    return B.lyingRig;
  }
  // 她到床边、转好了：算躺好以后 root 在哪、转多少，床换成「睡着」，备好被子 → a.lying。躺不了 → false
  function enterBed(a, b) {
    const R = lyingRig(a), f = b.target;
    if (!R || !f || !f.center.every(Number.isFinite) || !Number.isFinite(f.yaw)) return false;
    const [bx, by, bz] = f.center, hx = Math.sin(f.yaw), hz = Math.cos(f.yaw), rx = -hz, rz = hx, side = b.side < 0 ? -1 : 1;
    const tilt = Math.asin(U.clamp(BED_PILLOW / R.len, -0.5, 0.5));   // 头心比胯高 BED_PILLOW
    const pitch = tilt - R.base, c = Math.cos(pitch), s = Math.sin(pitch);   // root.rotation.x：把「胯 → 头」转到仰角 tilt（负的 = 往后倒）
    const rot = (p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];   // root 局部的 (y, z) 绕 x 转 pitch
    const H = rot(R.head), P = rot(R.hip);
    const along = Math.min(BED_HEAD, BED_BOARD - R.reach);            // 头心离床中心（往床头）：头顶不顶床头板
    const lat = BED_SIDE * side, rootY = by + BED_HIP - P[0], ax = lat - R.x, az = along + H[1];   // root 原点：床的 +x 方向 ax、往床头 az
    const L = a.lying = { bed: [bx, by, bz], yaw: wrap(f.yaw + Math.PI), pitch, clip: R.clip, k: 0, cover: false, variant: null,
      from: [a.x, a.y, a.z], fromYaw: a.yaw, to: [bx + rx * ax + hx * az, rootY, bz + rz * ax + hz * az],
      head: [bx + rx * lat + hx * along, rootY + H[0], bz + rz * lat + hz * along] };
    // 被子：只有方块房子里的床才叠（体素版的床自己有「睡着」那一版，见 56-furn-ground buildBed）。盖到脖子，脚后面多出一点
    const HBk = V3.houseBlocks, F = V3.furn;
    if (HBk && (HBk.grid || HBk.model) && F && F.sleepCover) {
      const ct = Math.cos(tilt), neckAt = along - (R.len - R.neck) * ct, feetAt = along - (R.len + R.leg) * ct;   // 离床中心（往床头为正）
      const o = { x: lat * 32, z0: -(neckAt + 0.03) * 32, z1: -(feetAt - 0.16) * 32, w: COVER_W, h: COVER_H };   // 床的设计格：−z 是床头
      try { L.cover = showCover(a, [bx, by, bz, f.yaw, Math.round(o.x), Math.round(o.z0), Math.round(o.z1)].join(','), f, o); }
      catch (e) { warn('cover', 'sleepCover: ' + e); L.cover = false; }
    }
    // 方块床上叠好的睡衣、枕头上的睡帽（烤在床的方块模型里，54-house-mc 单独画了一份）：躺进去就藏，leaveBed 摆回去
    if (HBk && HBk.setSleeper) { try { HBk.setSleeper([bx, by, bz]); } catch (e) { warn('props', 'setSleeper: ' + e); } }
    if (F && F.variant && F.setVariant) {
      try {
        const cur = F.variant('bed');
        if (cur != null) { L.variant = cur === 'sleeping' ? 'made' : cur; if (cur !== 'sleeping') F.setVariant('bed', 'sleeping'); }
      } catch (e) { warn('variant', 'furn.setVariant: ' + e); }
    }
    return true;
  }
  function leaveBed(a) {                             // 不躺了（起身完、被打断、换场景）：回到床边站着，床恢复原样，被子藏起来
    const L = a.lying, F = V3.furn;
    a.lying = null;
    Object.assign(a, { x: L.from[0], y: L.from[1], z: L.from[2], yaw: L.fromYaw, yLock: null });
    a.body.root.position.set(a.x, a.y, a.z); a.body.root.rotation.set(0, a.yaw, 0);
    if (a.cover) a.cover.mesh.visible = false;
    const HBk = V3.houseBlocks;
    if (HBk && HBk.setSleeper) { try { HBk.setSleeper(null); } catch (e) { warn('props', 'setSleeper: ' + e); } }
    if (L.variant && F && F.variant && F.setVariant) {
      try { if (F.variant('bed') === 'sleeping') F.setVariant('bed', L.variant); } catch (e) { warn('variant', 'furn.setVariant: ' + e); }
    }
    if (V3.bubble && V3.bubble.hide) { try { V3.bubble.hide('girl'); } catch (e) { warn('bh', 'bubble.hide: ' + e); } }   // 还挂着的 Zzz
  }
  // 那块被子（V3.furn.sleepCover）：一个场景最多留一块，换了床 / 换了边才重建；不盖的时候藏着，dropCover 释放
  function showCover(a, key, f, o) {
    if (!a.cover || a.cover.key !== key) {
      dropCover(a);
      const parent = a.body.root.parent, c = parent ? V3.furn.sleepCover(o) : null;
      if (!c) return false;
      c.mesh.position.set(f.center[0], f.center[1], f.center[2]);
      c.mesh.rotation.y = wrap(f.yaw + Math.PI);     // 床的设计坐标：−z 是床头
      c.mesh.visible = false;
      parent.add(c.mesh);
      a.cover = { key, mesh: c.mesh, material: c.material };
    }
    return true;
  }
  function dropCover(a) {
    const c = a && a.cover;
    if (!c) return;
    a.cover = null;
    c.mesh.removeFromParent(); c.mesh.geometry.dispose(); c.material.dispose();
  }
  function sleepTick(a, b) {
    if (b.phase === 'face_bed') {
      if (a.face != null) return;
      if (!enterBed(a, b)) return cancelBehavior('lying-unavailable');
      b.phase = 'lie';
      return;
    }
    const L = a.lying;
    if (!L) return;                                 // to_bed：move() 在走
    if (b.phase === 'lie' && L.k >= 1) {
      b.phase = 'action'; b.actionStart = a.clock; b.zzz = a.clock + 5 + a.rng() * 5;
      behaviorEvent(b, 'action');
    } else if (b.phase === 'action' && a.clock >= b.zzz) {
      b.zzz = a.clock + 50 + a.rng() * 40;           // 一分钟左右冒一个小小的 Zzz（不走 say：睡着不张嘴）
      const B = V3.bubble;
      if (B && B.say) { try { B.say('girl', ZZZ[Math.min(ZZZ.length - 1, Math.floor(a.rng() * ZZZ.length))], { mood: 'think', ms: 2600 }); } catch (e) { warn('bs', 'bubble.say: ' + e); } }
    } else if (b.phase === 'rise' && L.k <= 0) finishBehavior(true);
  }
  // 每帧（在 seatPose 之后）：躺下 / 起身的过渡，把 root 摆到床上。这里不新建对象
  function lyingPose(dt) {
    const a = A, L = a.lying;
    if (!L) return;
    const b = a.behavior, rising = !b || b.phase === 'rise';
    L.k = U.clamp(L.k + (rising ? -dt / RISE_T : dt / LIE_T), 0, 1);
    const k = ease(L.k), root = a.body.root, F = L.from, T = L.to;
    const lift = Math.sin(Math.PI * L.k) * 0.12;     // 中间抬一点：从床沿上面过去，不从床帮里穿
    root.position.copy(_ly.set(F[0] + (T[0] - F[0]) * k, F[1] + (T[1] - F[1]) * k + lift, F[2] + (T[2] - F[2]) * k));
    root.rotation.set(L.pitch * k, L.yaw, 0, 'YXZ');
    if (a.cover) {
      const m = a.cover.mesh, ck = L.cover ? U.clamp((L.k - 0.55) / 0.45, 0, 1) : 0;   // 躺到一半被子才鼓起来
      m.visible = ck > 0;
      if (m.visible) { m.scale.y = 0.5 + 0.5 * ck; m.position.y = L.bed[1] + BED_TOP * (1 - m.scale.y); }   // 从被面往上长
    }
  }
  const stateName = () => A.seated ? 'furniture' : A.attentionUntil > A.clock ? 'respond' : A.shelter ? 'shelter' : A.task || A.mode === 'pick' || A.sweep ? 'collect' : A.mode === 'walk' ? (A.why === 'wander' ? 'wander' : 'walk') : 'idle';
  const HAND = new THREE.Vector3(-0.03, -0.2, 0.01);   // 旧版 20-girl 的右手拳头（armR 骨骼局部）；新模型用 body.handBone + handOff
  const UMB_TIP = new THREE.Vector3(0, 0.1, 0);        // 伞尖（伞面骨骼局部）
  function api() {
    return {
      get inst() { return A ? A.body.inst : null; },
      get root() { return A ? A.body.root : null; },
      get state() { return A?.waterTrip ? 'shore' : A ? stateName() : 'none'; },
      startWater: () => startWater(), watchReef: sighting => startWater(sighting), leaveWater, get water() { return A?.waterTrip?.phase || null; },
      get watchingReef() { return !!A?.waterTrip?.sighting; },
      floatWater() { const trip = A?.waterTrip; if (trip?.phase !== 'swim') return false; trip.floating = !trip.floating; return true; },
      get floating() { return !!A?.waterTrip?.floating; },
      get pos() { return A ? [A.x, A.y, A.z] : null; },
      head() {                                   // 对话框锚点：头顶上方 0.15 m；撑着伞时慢慢挪到伞尖上方
        if (!A) return new THREE.Vector3();
        const b = A.body, u = A.umb; b.root.updateMatrixWorld(true);
        const p = b.headBone.localToWorld(b.headTop.clone()).add(UP15);
        const o = u && u.root.visible ? ease(U.clamp((u.k - 0.3) / 0.7, 0, 1)) : 0;
        return o > 0 ? p.lerp(u.canopy.localToWorld(UMB_TIP.clone()).add(UP15), o) : p;
      },
      hand(out) {                                // collectFx 用：by 'girl' 时贝壳先飞到她手边。out（可选）：写进这个 Vector3，不新建
        if (!A) return out || new THREE.Vector3();
        const b = A.body; b.root.updateMatrixWorld(true);
        return b.handBone.localToWorld((out || new THREE.Vector3()).copy(b.handOff));
      },
      // The bowl of the meal she is at, for 69-furniture-play (it owns and draws the bowl; called every frame, allocates nothing):
      // 0 = she has none (no meal, or not yet at the counter), 1 = in her hand (pickup, walking to the chair), 2 = on the table in front
      // of her chair (seated). out (a THREE.Vector3) receives the world point: her palm, or where the bowl's foot stands on the table.
      mealBowl(out) {
        const a = A, b = a && a.behavior, p = b && b.kind === 'eat' ? b.phase : '';
        const seated = p === 'sit' || p === 'action';
        if (!seated && p !== 'pickup' && p !== 'to_chair') return 0;
        if (seated && b.dish) { const d = b.dish; out.x = d[0]; out.y = d[1]; out.z = d[2]; return 2; }   // plain stores: no boxed numbers
        const B = a.body; B.root.updateMatrixWorld(true);
        B.handBone.localToWorld(out.copy(B.handOff));
        return 1;
      },
      poke, respond, sit, stand, snack,
      // 正在吃零食：null | { kind: 'eat' | 'drink', left: 还剩几秒 }
      // （被叫去走路 / 捡贝壳 / 别的事打断时 attentionUntil 清零，这里也就结束了）
      get snacking() { const a = A; return a && a.snackUntil > a.clock && (a.snackKeep || a.attentionUntil > a.clock) ? { kind: a.snackKind, left: a.snackUntil - a.clock } : null; },
      startBehavior, behaviorAvailability, cancelBehavior, endBehavior, renewBehavior,
      get behavior() {
        const b = A && A.behavior;
        if (!b) return null;
        const o = { kind: b.kind, phase: b.phase };
        if (b.kind === 'stargaze') { o.telescopeKey = b.target.key; o.seated = !!A.seated; }
        if (b.hold) o.hold = true;
        if (b.leisure) { o.leisure = true; if (b.together) o.together = true; if (b.target && b.target.center) o.spot = b.target.center.slice(); }
        return o;
      },
      // 你点了电视 / 相册 / 书架：她跑过来一起看（kind = watch_tv | album | read）。正在看别的消遣就换过来，已经在看这一样就接着看。
      // opts：{ near: [x, y, z] 你点的那一点, while: () => bool 返回 false 就结束（面板关了）, text, seconds }。她正忙别的 → false
      join: (kind, opts) => startBehavior(kind, Object.assign({ interrupt: true, run: true, together: true, hold: true }, opts)),
      // 现在天上看得到星星吗（天黑、没下雨下雪打雷）：望远镜（69-furniture-play）只在这时候能点、她也只在这时候去看
      get starry() { return starry(); },
      stargazeLine: () => line('stargaze'),
      // 正在「收拾沙滩」的状态里（一件接一件捡，直到沙滩上没有）；sweep → null | { count: 这一轮已经捡了几件, forced }
      get sweeping() { return !!(A && A.sweep); },
      get sweep() { const s = A && A.sweep; return s ? { count: s.n, forced: !!s.forced } : null; },
      // 夜里（88-cabin-night）：rest(true) 以后她不自己闲逛、捡贝壳、摆贝壳、自言自语；场景重建以后也还这样
      rest(on) {
        REST = !!on;
        if (REST) {
          quitShell();
          if (A?.behavior?.kind === 'garden_water') cancelBehavior('night');
        } else if (A) A.modeT = Math.max(A.modeT, 0.8);
        return REST;
      },
      get resting() { return REST; },
      // 正躺在床上（或正在躺下 / 起身）：床中心、枕头上她的头心、躺下了多少（0..1）、身上有没有盖着那块被子
      get lying() { const L = A && A.lying; return L ? { bed: L.bed.slice(), head: L.head.slice(), k: L.k, cover: !!(L.cover && A.cover && A.cover.mesh.visible) } : null; },
      goto: (x, z, y, o) => { stand('goto'); if (A) A.attentionUntil = 0; return gotoP(x, z, false, y, !!(o && o.run)); }, say: (t, mood) => say(t, mood), collect: (id) => collectNow(id),
      get bodyId() { return A ? A.bodyId : null; },
      useBody: (id, builder) => useBody(id, builder),     // 换身体：'v1' + null = 自带小鲸鱼；YSM 由 29-ysmui.js 调
      wander: (zone) => !!A && (stand('wander'), A.attentionUntil = 0, dropTask(), wander(zone)),
      get yaw() { return A ? A.yaw : 0; },
      // 布置模式（69-arrange）：hold(true) 她停在原地（不逛、不捡贝壳、不跑去躲雷），场景重建以后也还停着；hold(false) 接着玩
      hold: (on) => holdSet(on),
      get held() { return HOLD; },
      // 放到 (x, z) 这一点（朝 yaw，y 选层）；那里走不了（比如家具挪到她脚下了）就挪到最近能站的地方。不改 manual（和 girl=at_… 不一样）
      place: (x, z, yaw, y) => placeAt(+x, +z, yaw, y),
      get _dbg() {
        const a = A;
        return a && { pokes: a.pokes, attention: Math.max(0, a.attentionUntil - a.clock), seated: !!a.seated, yaw: a.yaw, v: a.v, gait: a.gait, pi: a.pi, mode: a.mode, sub: a.sub, task: a.task && a.task.id, manual: a.manual,
          poseK: a.poseK, pose: a.poseCur, path: a.path && a.path.length, rainy: a.rainy, storm: a.storm,
          shelter: a.shelter && a.shelter.sub, yLock: a.yLock, umb: a.umb ? Math.round(a.umb.k * 100) / 100 : null };
      },
    };
  }
  // ---- 闲逛：沙滩上随便走走（别离门廊太远，主镜头里看得见）；偶尔去潮线看海；也会进屋、上阁楼待一会儿 ----
  // 在屋外：12% 进屋（一楼）、8% 上阁楼；在屋里：多半在屋里接着走，35% 出门回沙滩
  const INDOOR = { inside: 1, loft: 1 };
  function indoors() { const HBk = V3.houseBlocks, L = (HBk && HBk.placedLayout ? HBk.placedLayout() : V3.layout) || {}, H = L.house; return !!(H && A && A.x > H.x0 && A.x < H.x1 && A.z > H.z0 && A.z < H.z1); }
  function pickZone() {
    const a = A, r = a.rng(), n = nav();
    const has = (z) => !!(n && n.randomPoint) && !(a.zoneOk && a.zoneOk[z] === false);
    if (indoors()) return r < 0.35 ? 'inside' : r < 0.65 ? 'loft' : r < 0.75 ? 'tideline' : 'beach';
    if (r < 0.12 && has('inside')) return 'inside';
    if (r < 0.2 && has('loft')) return 'loft';
    return a.rng() < 0.25 ? 'tideline' : 'beach';
  }
  function wanderPoint(want) {
    const a = A, n = nav(), h = a.home;
    for (let i = 0; i < 10; i++) {
      let p = null;
      const zone = want || pickZone(), inz = !!INDOOR[zone];
      if (n && n.randomPoint) {
        const o = inz ? null : i & 1 ? { near: [a.x, a.z], r: 6 } : { near: h, r: zone === 'tideline' ? 14 : 8 };
        try { const q = n.randomPoint(zone, a.rng, o); p = q ? [+q[0], +q[1], q[2] != null ? +q[2] : undefined] : null; } catch (e) { warn('nr', 'nav.randomPoint: ' + e); }
        if (!p && inz) { (a.zoneOk = a.zoneOk || {})[zone] = false; continue; }   // 屋里走不进去（门挡着 / 没有方块房子）：以后不挑这个
      } else if (inz) continue;
      else p = [h[0] + (a.rng() * 2 - 1) * 7, h[1] + 0.5 + a.rng() * 7];
      if (!p) continue;
      const d = Math.hypot(p[0] - a.x, p[1] - a.z) + Math.abs((p[2] || 0) - a.y), dh = Math.hypot(p[0] - h[0], p[1] - h[1]);
      if (d > 1.2 && (inz || dh < 13) && walkable(p[0], p[1], p[2])) return { p, zone };
    }
    return null;
  }
  function wander(want) {
    const w = wanderPoint(want), a = A;
    if (!w) return false;
    return go(w.p[0], w.p[1], 'wander', (ok) => {
      if (!ok || A !== a) return;
      a.modeT = w.zone === 'tideline' ? 4 + a.rng() * 4 : INDOOR[w.zone] ? 3 + a.rng() * 6 : 1.5 + a.rng() * 4;
      if (w.zone === 'tideline') a.face = wrap((a.rng() * 2 - 1) * 0.5);   // 到了潮线：朝着海站一会儿
    }, w.p[2]);
  }
  function syncMoonAside(a) {
    const st = V3.game?.st, key = V3.moonTreasures?.collectionKey(st?.found);
    a.moonAside = key && st.moonAsideFor !== key ? key : null;
  }
  function speakMoonAside(a) {
    if (!a.moonAside || HOLD || V3.backgroundPaused() || a.behavior || a.seated || a.shelter) return false;
    if (!say('可惜没有火鼠裘。', 'think')) return false;
    V3.game.st.moonAsideFor = a.moonAside; V3.game.save?.();
    a.moonAside = null; a.playerFind = null; a.helpT = a.clock + 6; a.chatT = Math.max(a.chatT, 6);
    return true;
  }
  function noticePlayerFind(a, immediate = false) {
    if (a.moonAside && (immediate || a.mode === 'idle') && speakMoonAside(a)) return true;
    const find = a.playerFind;
    if (!find) return false;
    if (a.clock - find.at > 45) { a.playerFind = null; return false; }
    if (HOLD || V3.backgroundPaused() || a.behavior || a.seated || a.shelter || a.attentionUntil > a.clock) return false;
    if (!immediate && (a.mode !== 'idle' || a.task || a.holdT > 0 || a.clock < a.helpT)) return false;
    a.playerFind = null;
    a.helpT = a.clock + 12;
    say(line(find.mine ? 'helped' : 'playerFind').replace('{name}', find.name), 'happy');
    return true;
  }
  // ---- 事件：记住玩家捡的东西；玩家抢先拿到当前目标就改道 ----
  function subscribe(a) {
    const on = (ev, fn) => {
      const f = (e) => { if (A === a) { try { fn(e || {}); } catch (err) { warn('ev:' + ev, ev + ': ' + err); } } };
      V3.on(ev, f); a.subs.push([ev, f]);
    };
    syncMoonAside(a);
    for (const event of ['game:start','game:inventory','game:reset']) on(event, () => syncMoonAside(a));
    on('game:collect', (e) => {
      syncMoonAside(a);
      if (e.by !== 'player') return;
      const mine = !!(a.task && e.item && e.item.id === a.task.id);
      if (e.kind && e.kind.category !== 'trash') {
        a.playerFind = { name: e.kind.name || '贝壳', mine, at: a.clock };
        noticePlayerFind(a, mine);
      }
      if (mine) lost();
    });
    on('game:wash', (e) => {
      const it = e.items && e.items[0];
      if (!it || e.silent || a.behavior || a.seated || a.attentionUntil > a.clock || a.manual || a.task || a.shelter || a.storm || a.mode !== 'idle' || a.holdT > 0) return;
      a.face = Math.atan2(it.x - a.x, it.z - a.z);
      if (a.rng() < 0.6) say(line('wash'), 'surprise');
    });
    const doc = window.document;
    if (doc && doc.addEventListener) {
      const pagehide = () => { if (A === a) { finishWater(); cancelBehavior('hidden'); } };
      const hidden = () => { if (V3.backgroundPaused()) pagehide(); };
      on('game:settings', e => { if (e.key === 'powerSaving') hidden(); });
      doc.addEventListener('visibilitychange', hidden);
      window.addEventListener('pagehide', pagehide);
      a.removeVisibility = () => { doc.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pagehide); };
    }
    on('wx:flash', () => {                         // 闪电：哆嗦一下，吓一跳
      a.flinch = 1;
      if (!a.manual) { a.mood = 'surprised'; a.moodT = a.clock + 0.5; }
    });
  }
  // ---- token：girl=collect | wander | auto | idle | pickup | cheer | x_z（走过去）| at_x_z[_yaw]（瞬移，截图用）----
  V3.viewTokens = V3.viewTokens || {};
  V3.viewTokens.girl = (v) => {
    const a = A;
    if (!a) return;
    v = String(v || '').trim();
    stand('command'); a.attentionUntil = 0;
    if (v === 'shelter') { shelterNow(); return; }                       // 直接坐到门廊沿上缩着（截图用）
    if (v === 'collect') {
      if (a.storm) { say('打雷了，不敢去…', 'sad'); return; }           // 打雷时不去捡（不算错误）
      unshelter(); if (!collectNow()) V3.err('girl=collect: 沙滩上没有能捡的贝壳'); return;
    }
    if (v === 'wander') { unshelter(); dropTask(); a.manual = false; if (!wander()) V3.err('girl=wander: 没找到能去的点'); return; }
    if (v === 'inside' || v === 'loft' || v === 'beach' || v === 'porch') {   // 去屋里 / 阁楼 / 沙滩 / 门廊随便一点（测试、截图用）
      unshelter(); dropTask(); a.manual = false; if (!wander(v)) V3.err('girl=' + v + ': 没找到能去的点'); return;
    }
    if (v === 'auto') {
      Object.assign(a, { manual: false, holdT: 0, moodT: 0, modeT: 0.5 });
      if (!a.shelter) a.pose = 'stand';
      if (a.storm && !a.shelter) shelterStart();
      return;
    }
    if (v === 'idle' || v === 'pickup' || v === 'cheer') {
      unshelter(); dropTask(); stop(false);
      Object.assign(a, { manual: true, pose: v === 'idle' ? 'stand' : v, holdT: v === 'idle' ? 0 : 1e9, face: null, moodT: 0 });
      if (v === 'cheer') Object.assign(a, { mood: 'laugh', moodT: a.clock + 1e9 });
      return;
    }
    // x_z[_y]：走过去（y 选层，阁楼上的点给 5）；at_x_z[_yaw[_y]]：瞬移
    const m = /^(at_)?(-?[\d.]+)_(-?[\d.]+)(?:_(-?[\d.]+))?(?:_(-?[\d.]+))?$/.exec(v);
    if (!m) { V3.err('girl=' + v + ': 不认识（collect|wander|inside|loft|beach|porch|auto|idle|pickup|cheer|shelter|x_z[_y]|at_x_z[_yaw[_y]]）'); return; }
    const x = +m[2], z = +m[3];
    unshelter(); dropTask(); stop(false);
    a.manual = true;
    if (!m[1]) { if (!go(x, z, 'goto', null, m[4] != null ? +m[4] : undefined)) V3.err('girl=' + v + ': 走不到'); return; }
    Object.assign(a, { x, z, yaw: m[4] != null ? +m[4] : a.yaw, v: 0, gait: 0, face: null, holdT: 0, pose: 'stand' });
    a.y = heightAt(x, z, m[5] != null ? +m[5] : undefined); tick(0);
  };
  // token behave=<kind>（eat|reply_private|write_diary|draw|read|sleep|watch_tv|album|sea）：马上开始这个行为（测试、截图用）；
  // behave=end 正常结束（睡觉 / 等着的行为），结束不了就取消
  V3.viewTokens.behave = (v) => {
    if (!A) return;
    v = String(v || '').trim();
    if (v === 'end' || v === 'stop') { if (!endBehavior()) cancelBehavior('token'); return; }
    if (!startBehavior(v, { interrupt: true })) V3.err('behave=' + v + ': ' + (behaviorAvailability(v, { interrupt: true }).reason || '开始不了'));
  };
  // token girlanim=<组:名>：定住放模型的某一个动画（YSM 模型；看动画长什么样用），girlanim= 或 girlanim=off 放开
  V3.viewTokens.girlanim = (v) => {
    const inst = A && A.body.inst;
    if (!inst || !inst.states || !inst.states.anim) return;
    v = String(v || '').trim();
    inst.setState('anim', v === 'off' ? '' : v);
  };
  // token cheerpose=ax_ay_az_fx_fy_fz[_wave]：调欢呼时举手的角度（YSM 模型，29-ysm 的 CHEER_POSE；大臂 + 小臂，Blockbench 度数）
  V3.viewTokens.cheerpose = (v) => {
    const inst = A && A.body.inst, n = String(v || '').split('_').map(Number);
    if (!inst || !inst.cheerArms) return;
    inst.cheerPose = n.length >= 6 && n.every(Number.isFinite) ? { arm: n.slice(0, 3), fore: n.slice(3, 6), wave: n[6] || 0 } : null;
  };
  // ---- 天气：读 V3.wx.now()（54-wx，含 wxfx 覆盖），没有就读 V3.env.state.wx；没有 rain/snow/storm 字段 → 什么都不做 ----
  //   rain 或 snow > 0.3：撑伞（体素小伞挂在 hand() 上），走 0.7 m/s，第一次说「下雨啦～」（think）
  //   storm > 0.5：不捡了，跑回家（台阶前）说「打雷了好可怕…」（sad），再上台阶、坐在门廊沿上缩着等；storm < 0.3 站起来
  function wxRead() {
    let w = null;
    try { w = V3.wx && V3.wx.now ? V3.wx.now() : V3.env && V3.env.state && V3.env.state.wx; } catch (e) { warn('wx', 'wx.now: ' + e); }
    return w && typeof w === 'object' && (w.rain != null || w.snow != null || w.storm != null) ? w : null;
  }
  function weather() {
    const a = A, w = wxRead();
    if (!w) return;
    const wet = Math.max(+w.rain || 0, +w.snow || 0), st = +w.storm || 0;
    const rainy = a.rainy ? wet > 0.2 : wet > 0.3, storm = a.storm ? st >= 0.3 : st > 0.5;   // 回差，免得在门槛上来回跳
    if (rainy && !a.rainy && !a.saidRain && !storm) {
      a.saidRain = true; a.lookUp = 1.4;
      say((+w.snow || 0) > (+w.rain || 0) ? '下雪啦～' : '下雨啦～', 'think');
    }
    const was = a.storm;
    a.rainy = rainy; a.storm = storm;
    if (storm && !was) { a.saidRain = true; if (!a.manual && !a.shelter && !HOLD && !(REST && indoors())) shelterStart(); }   // 夜里已经在屋里：不往门廊跑
    else if (!storm && was) { a.saidStorm = false; if (a.shelter) shelterEnd(); }
  }
  // ---- 布置模式：停在原地 / 放到某一点 ----
  function holdSet(on) {
    HOLD = !!on;
    const a = A;
    if (!a) return HOLD;
    if (HOLD) {
      stand('arrange'); a.attentionUntil = 0;
      dropTask();
      if (a.mode === 'walk') stop(false);
      if (a.mode === 'pick') Object.assign(a, { mode: 'idle', sub: '' });
      if (a.shelter && !/^(sit|wait)$/.test(a.shelter.sub)) unshelter();   // 正跑着去躲雷：停下；已经坐好了就接着坐
      Object.assign(a, { holdT: 0, face: null });
      if (a.poseCur !== 'huddle') a.pose = 'stand';
    } else {
      a.modeT = 0.8 + a.rng() * 1.5;
      if (a.storm && !a.shelter && !a.manual) shelterStart();
    }
    return HOLD;
  }
  function placeAt(x, z, yaw, y) {
    const a = A;
    if (!a || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    finishWater(); cancelBehavior('place'); unshelter(); dropTask(); stop(false);
    let px = x, pz = z, py = Number.isFinite(+y) ? +y : undefined;
    const n = nav();
    if (n && n.nearest && !walkable(px, pz, py)) {
      try { const q = n.nearest(px, pz, 8, py); if (q) { px = +q[0]; pz = +q[1]; py = q[2] != null ? +q[2] : py; } } catch (e) { warn('np2', 'nav.nearest: ' + e); }
    }
    Object.assign(a, { x: px, z: pz, yaw: Number.isFinite(+yaw) ? +yaw : a.yaw, v: 0, gait: 0, face: null, holdT: 0, pose: 'stand' });
    a.y = heightAt(px, pz, py); tick(0);
    return true;
  }
  function spd() {                                 // 现在该走多快
    const a = A, T = a.shelter;
    if (a.hurry) return HURRY_SPEED;
    if (T && T.sub === 'run') return RUN_SPEED;
    if (T && T.sub === 'climb') return CLIMB_SPEED;
    return a.rainy ? RAIN_SPEED : SPEED;
  }
  function seat() {                                // 门廊沿、台阶正中：root 在沿外 4 cm（裙摆坐在板上，腿垂在第一级台阶前），面朝大海（+z）
    const L = V3.layout || {}, P = L.porch || {}, S = P.steps || {};
    const x = S.x0 != null ? (S.x0 + S.x1) / 2 : -2, ze = P.z1 != null ? P.z1 : -3.5;
    const s = { x, z: ze + 0.04, ex: x, ez: ze - 0.12, y: P.y, yaw: 0 };   // ex/ez = 先走到门廊板上这一点，再转身坐下
    // 布置模式挪过、转过房子：上面是房子自己方向上的位置，转、挪过去（54-house-mc 的 HB.placePoint）
    const HBk = V3.houseBlocks, pl = HBk && HBk.place && HBk.placePoint && !HBk.isIdentity(HBk.place) ? HBk.place : null;
    if (pl) {
      const a = HBk.placePoint([s.x, 0, s.z], pl), b = HBk.placePoint([s.ex, 0, s.ez], pl);
      Object.assign(s, { x: a[0], z: a[2], ex: b[0], ez: b[2], yaw: HBk.placeYaw(0, pl) });
    }
    if (s.y == null) s.y = heightAt(s.ex, s.ez);
    return s;
  }
  function shelterStart() {
    const a = A, T = { sub: 'run' };
    a.shelter = null; dropTask(); stop(false);
    a.shelter = T;
    Object.assign(a, { holdT: 0, pose: 'stand', face: null, manual: false });
    if (!a.saidStorm) { a.saidStorm = true; a.flinch = 1; say('打雷了好可怕…', 'sad'); }
    go(a.home[0], a.home[1], 'shelter', () => { if (A === a && a.shelter === T) shelterClimb(T); });   // 跑回台阶前（走不到也接着上台阶）
  }
  function shelterClimb(T) {
    const a = A, s = seat();
    T.sub = 'climb';
    go(s.ex, s.ez, 'shelter', (ok) => {
      if (A !== a || a.shelter !== T) return;
      if (ok) { T.sub = 'turn'; a.face = s.yaw; } else T.sub = 'stand';   // 上不去：就在台阶前站着等
    });
  }
  function shelterTick() {                         // run / climb 交给 move()；turn → sit → wait →（雷停）up → 放开
    const a = A, T = a.shelter, s = seat();
    if (T.sub === 'turn') {
      if (a.face == null) { Object.assign(T, { sub: 'sit', x0: a.x, z0: a.z }); Object.assign(a, { pose: 'huddle', yLock: s.y }); }
      return;
    }
    if (T.sub !== 'sit' && T.sub !== 'wait' && T.sub !== 'up') return;
    const k = ease(Math.min(1, a.poseK / 0.4));    // 先挪到沿上，再坐低（脚不插进板子）
    a.x = T.x0 + (s.x - T.x0) * k; a.z = T.z0 + (s.z - T.z0) * k;
    if (T.sub === 'sit' && a.poseCur === 'huddle' && a.poseK >= 1) T.sub = 'wait';
    if (T.sub === 'up' && a.poseCur !== 'huddle') Object.assign(a, { shelter: null, yLock: null, mode: 'idle', modeT: 1 + a.rng() * 2 });
  }
  function shelterEnd() {
    const a = A, T = a.shelter;
    if (!T || T.sub === 'up') return;
    if (T.sub === 'sit' || T.sub === 'wait') { T.sub = 'up'; a.pose = 'stand'; say(line('calm'), 'happy'); return; }
    a.shelter = null; a.yLock = null; stop(false); a.modeT = 1;
  }
  function shelterNow() {                          // token girl=shelter：直接坐到门廊沿上（截图用）
    const a = A, s = seat();
    a.shelter = null; dropTask(); stop(false);
    a.shelter = { sub: 'wait', x0: s.ex, z0: s.ez };
    Object.assign(a, { x: s.x, z: s.z, yaw: s.yaw, y: s.y, yLock: s.y, v: 0, gait: 0, face: null, holdT: 0,
      pose: 'huddle', poseCur: 'huddle', poseK: 1, manual: false });
    if (!a.saidStorm) { a.saidStorm = true; say('打雷了好可怕…', 'sad'); }
    tick(0);
  }
  function unshelter() {                           // 别的 token 接管：不缩着坐了
    const a = A;
    if (!a.shelter) return;
    a.shelter = null; a.yLock = null;
    if (a.poseCur === 'huddle') Object.assign(a, { pose: 'stand', poseCur: 'stand', poseK: 0 });
  }
  // ---- 小伞（1/32 m 体素，第一次下雨才建）：杆 + 木头 J 形把手；伞面 8 片蓝白相间、伞骨处外沿翘一点，中间白圆里一只深蓝小鲸鱼 ----
  const US = 1 / 32, UMB_L = 31, UMB_R = 16, UMB_H = 6.4;   // 握点 → 伞尖 31 格（≈0.97 m），伞面半径 0.5 m，拱高 0.2 m
  const UC = { blue: 0x3d86e0, white: 0xf7f8fb, navy: 0x1d3f7a, pole: 0xd9dde3, wood: 0x8a5a32, eye: 0xffffff };
  function whaleAt(x, z) {                         // 伞顶中间的小鲸鱼（头朝 −x）：-1 = 不是鲸鱼，否则颜色
    const az = Math.abs(z);
    if (x === -3 && az === 1) return UC.eye;
    if ((x + 1) * (x + 1) / 20.25 + z * z / 6.25 <= 1) return UC.navy;               // 身子
    if (x >= 3 && x <= 6 && az <= (x <= 4 ? 1 : 0)) return UC.navy;                  // 尾巴根
    if ((x === 7 && az >= 1 && az <= 2) || (x === 8 && az >= 2 && az <= 3)) return UC.navy;   // 尾鳍（V 形）
    return -1;
  }
  function makeWateringCan() {
    // 壶把横梁过手心，壶身悬在下面，细长的壶嘴朝她前方。
    const g = new V3.vox.Grid(13, 17, 25, { origin: [6, 13, 7] });
    g.t('小鲸鱼/小喷壶').c(0x478f87).ell(0, -8, 2, 5, 4.8, 6);
    g.c(0x8acac0).ell(0, -5, 2, 4.5, 1.5, 5.5);
    g.c(0x306e6a).ell(0, -4, 2, 2.6, 0.7, 3);
    g.c(0xc2a16c).box(-1, -6, -3, 1, 0, -2).box(-1, 0, -2, 1, 1, 4).box(-1, -5, 4, 1, 0, 5);
    for (let i = 0; i < 8; i++) g.c(0x72b6a9).box(-1, -8 + i, 7 + i, 1, -7 + i, 8 + i);
    g.c(0xdfc98b).ell(0, 0, 15, 2.8, 2, 1.4);
    g.c(0x627f78).set(0, 0, 16).set(-1, 1, 16).set(1, -1, 16);
    const material = V3.vox.material(), can = V3.vox.build(g, { scale: 0.015, material, anchor: 'watering-can' });
    can.root.name = 'girl-actor:watering-can';
    for (const mesh of can.meshes) mesh.userData.layer = 'site';
    return { ...can, material };
  }
  function poseWateringCan(a, b) {
    const root = b.can.root, body = a.body;
    body.root.worldToLocal(body.handBone.localToWorld(root.position.copy(body.handOff)));
    // 到位后往花盆倾壶，再慢慢扶正。
    const t = a.clock - b.actionStart;
    root.rotation.x = b.phase === 'action' ? 0.85 * ease(U.clamp(Math.min(t, b.seconds - t) / 0.7, 0, 1)) : 0;
  }
  function makeUmbrella() {
    const N = UMB_R + 2, g = new V3.vox.Grid(2 * N + 1, 48, 2 * N + 1, { origin: [N, 8, N] }), tag = '小鲸鱼/雨伞';
    const Rs = (UMB_R * UMB_R + UMB_H * UMB_H) / (2 * UMB_H);                     // 伞面所在球面的半径（格）
    g.t(tag).b(0).c(UC.pole).fill(0, 2, 0, 0, UMB_L - 1, 0);                       // 杆（握点 y 0 在手里）
    g.c(UC.wood).fill(0, -4, 0, 0, 1, 0).tube([[0, -4, 0, 0.55], [1, -6, 0, 0.55], [3, -6, 0, 0.55], [4, -4, 0, 0.55], [4, -3, 0, 0.55]]);
    g.b(1);
    for (let z = -UMB_R; z <= UMB_R; z++) for (let x = -UMB_R; x <= UMB_R; x++) {
      const r = Math.hypot(x, z), a = Math.atan2(z, x), cr = Math.cos(4 * a);  // 8 根伞骨在 cr = ±1 处
      if (r > UMB_R - 1.2 * (1 - Math.abs(cr)) + 0.3) continue;                    // 伞骨之间的外沿往里收一点（波浪边）
      const sag = r > 10 ? (r - 10) / 6 * 1.2 * (1 - Math.abs(cr)) : 0;            // 伞骨之间往下垂
      const top = Math.round(UMB_L - (Rs - Math.sqrt(Math.max(0, Rs * Rs - r * r))) - sag);
      const wc = whaleAt(x, z), gore = Math.floor((a + Math.PI) / (Math.PI / 4)) & 1;
      g.c(r <= 8.6 ? (wc >= 0 ? wc : UC.white) : gore ? UC.blue : UC.white).fill(x, top - (r > 10 ? 1 : 0), z, x, top, z);
    }
    g.c(UC.navy).fill(0, UMB_L + 1, 0, 0, UMB_L + 2, 0);                            // 伞尖（像鲸鱼背上的喷气孔）
    const material = V3.vox.material({ roughness: 0.5 });
    const v = V3.vox.build(g, { scale: US, material, noise: 0.03, part: tag, anchor: 'girl-actor',
      bones: [{ name: 'umbrella', pivot: [0, 0, 0], parent: -1 }, { name: 'umbrella-canopy', pivot: [0, UMB_L, 0], parent: 0 }] });
    v.root.name = 'girl-actor:umbrella'; v.root.visible = false;
    for (const m of v.meshes) { m.userData.layer = 'site'; m.castShadow = true; m.receiveShadow = true; }
    if (V3.parts && V3.parts.declare) V3.parts.declare([tag], { [tag]: '雨伞' });
    return { root: v.root, canopy: v.byName['umbrella-canopy'], meshes: v.meshes, material, k: 0 };
  }
  const _uh = new THREE.Vector3(), _ut = new THREE.Vector3(), _ud = new THREE.Vector3(), _uy = new THREE.Vector3(0, 1, 0);
  const UMB_ARM = [-1.0, 0, 0.35];                  // 旧版 20-girl 举伞：右臂往前上举、往里收（rad）；inst.umbArm / umbFore 可以换
  const UMB_TOP = new THREE.Vector3(0, 0.1, -0.02);   // 伞尖瞄准的点：头顶上方（头骨骼局部，加在 headTop 上）
  function umbrella(dt) {                          // 每帧：开 / 收，右手握杆，杆从手里指向头顶上方
    const a = A, B = a.body, b = B.inst.bones, want = (a.rainy || (a.storm && a.shelter)) && !a.behavior?.can && !(a.behavior && indoors()) && !a.waterTrip?.clips.swim;
    if (B.inst.noUmbrella) return;               // 导入的模型先不撑伞
    if (want && !a.umb && !a.umbFail) {
      try { a.umb = makeUmbrella(); B.root.add(a.umb.root); } catch (e) { a.umbFail = true; warn('umb', 'umbrella: ' + e); }
    }
    const U2 = a.umb;
    if (!U2) return;
    U2.k = dt > 0 ? U.clamp(U2.k + (want ? dt / 0.5 : -dt / 0.35), 0, 1) : U2.k;
    const k = U2.k;
    U2.root.visible = k > 0.001;
    if (!U2.root.visible) return;
    const h = ease(Math.min(1, k / 0.4));          // 先举手，再撑开
    if (B.inst.umbrellaArm) B.inst.umbrellaArm(h); // YSM 模型自己摆（骨骼轴向不一样）
    else {
      const r = b.armR.rotation;
      const ua = B.inst.umbArm || UMB_ARM, uf = B.inst.umbFore, fr = uf && b.forearmR && b.forearmR.rotation;   // 模型可以给自己的举伞姿势
      r.set(r.x + (ua[0] - r.x) * h, r.y + (ua[1] - r.y) * h, r.z + (ua[2] - r.z) * h);
      if (fr) fr.set(fr.x + (uf[0] - fr.x) * h, fr.y + (uf[1] - fr.y) * h, fr.z + (uf[2] - fr.z) * h);
    }
    B.root.updateMatrixWorld(true);
    B.root.worldToLocal(B.handBone.localToWorld(_uh.copy(B.handOff)));
    B.root.worldToLocal(B.headBone.localToWorld(_ut.copy(B.headTop).add(UMB_TOP)));
    _ud.subVectors(_ut, _uh).normalize();
    const up = B.inst.umbUp;                       // 模型可以限定伞杆最多斜多少（cos）：YSM 大头小手，伞杆从脸颊外侧几乎竖直往上
    if (up) { if (_ud.y < up) { const k = Math.sqrt(1 - up * up) / (Math.hypot(_ud.x, _ud.z) || 1); _ud.x *= k; _ud.z *= k; _ud.y = up; } }
    else if (_ud.y < 0.82) { _ud.y = 0.82; _ud.normalize(); }   // 最多斜 35°
    U2.root.position.copy(_uh);
    U2.root.quaternion.setFromUnitVectors(_uy, _ud);
    U2.root.scale.setScalar(Math.max(0.01, ease(Math.min(1, k / 0.3))));
    const o = ease(U.clamp((k - 0.3) / 0.7, 0, 1));   // 伞面撑开：收着时贴着杆（细长），打开后变圆
    U2.canopy.scale.set(0.12 + 0.88 * o, 1.6 - 0.6 * o, 0.12 + 0.88 * o);
  }
  // @@NEXT@@

  V3.scene.part({
    id: 'girl-actor', label: '小鲸鱼（场景里）', order: 65,
    build(ctx) {
      if (!(V3.girlv1 && V3.girlv1.build)) throw new Error('V3.girlv1.build 不存在');
      // 玩家选的 YSM 模型（导入的其它模型）已由 91-cabin 先读好就直接用它建；没有就建 v1 小鲸鱼（2026-11-16 起可发布版的默认）
      const pre = V3.ysmUI && V3.ysmUI.initialBody ? V3.ysmUI.initialBody() : null;
      const body = makeBody(pre ? pre.builder : undefined);
      const n = nav(), nh = n && pt(n.home), home = nh && Number.isFinite(nh[0]) && Number.isFinite(nh[1]) ? nh : HOME;
      A = {
        body, rng: ctx.rng('girl-actor'), x: home[0], z: home[1], y: 0, yaw: HOME_YAW, v: 0, gait: 0, anim: 0, clock: 0,
        pose: 'stand', poseCur: 'stand', poseK: 0, mood: 'happy', moodT: 0, talkT: 0, blinkT: 2.5, look: 0, lookTo: 0, lookT: 2,
        mode: 'idle', modeT: 6, why: '', path: null, pi: 0, done: null, face: null, task: null, sub: '', subT: 0, stepK: 0,
        attentionUntil: 0, snackUntil: 0, snackKind: '', lastPoke: -Infinity, pokes: 0, seated: null, behavior: null, lying: null, cover: null, sleepyUntil: 0,
        chatT: 25, helpT: 0, lastLine: {}, subs: [], home, manual: false, holdT: 0, skip: {}, got: null, sweep: null, hurry: false, cheerT: null, cheerK: 0,
        rainy: false, storm: false, saidRain: false, saidStorm: false, shelter: null, yLock: null, flinch: 0, lookUp: 0, umb: null, umbFail: false,
      };
      A.y = heightAt(A.x, A.z);
      A.bodyId = pre && body.inst.id !== 'girlv1' && body.inst.id !== 'girl' ? pre.id : 'v1';
      subscribe(A);
      tick(0);
      V3.actor = api();
      setTimeout(() => { if (A && V3.actor) V3.emit('actor:ready', V3.actor); }, 0);   // 29-ysmui 看选的是不是导入的角色
      return [body.root];
    },
    update(dt) { if (A) tick(Math.min(dt, 0.1)); },
    dispose() {
      const a = A; if (!a) return;
      stand('dispose');
      try { dropTask(); } catch (e) { /* 还 claim 失败不要紧：game 那边换场景也会清 */ }
      for (const [ev, fn] of a.subs) V3.off(ev, fn);
      if (a.removeVisibility) a.removeVisibility();
      if (V3.bubble && V3.bubble.hide) { try { V3.bubble.hide('girl'); } catch (e) { /* 对话框模块自己会清 */ } }
      try { a.body.inst.dispose(); } catch (e) { V3.err('girl-actor dispose: ' + e); }
      if (a.umb) { for (const m of a.umb.meshes) m.geometry.dispose(); a.umb.material.dispose(); }
      dropCover(a);
      A = null; V3.actor = null;
    },
  });
})(window.V3);
