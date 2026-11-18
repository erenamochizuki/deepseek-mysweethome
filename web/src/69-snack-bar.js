// 69-snack-bar.js — 零食：零食篮（小冰箱顶上）+ 零食栏（HUD「零食」）+ 喂小鲸鱼 + 她自己找零食吃。V3.snackBar。
// 零食的数据在收藏存档里（inventory.snacks，58-inventory-rules 的 buy / consume）；这里只负责显示和动作。
//   零食栏：每件一格（盒 / 袋显示还剩几份，杯 / 瓶 / 罐显示 满 / 中 / 低）。按住一格拖出来：盒装 / 袋装拖出的是「一份」，
//     杯装拖出的是杯子本身；拖到小鲸鱼身上松手 = 喂她（91-cabin 的 pick 判定落点，和点击用同一套）。没拖到她身上就弹回去。
//   喂到了：她站着转过来吃一份（65 actor.snack：手往嘴边送、开心脸、说一句），这份拿在她手里（每帧放到 actor.hand() 上）；
//     consume 成功才算吃掉。杯装喝一口液面降一档，喝完的空杯变成一件垃圾（门廊垃圾桶清理再得 1 贝币）。
//   她自己吃（girlSnack）：走到零食篮前拿一份，吃完再走开。89-cabin-routine 隔一阵问一次 considerGirl()：
//     有零食、她闲着、不是夜里、离上次吃零食过了 40 分钟、离午饭（11:00–14:00）远、今天还没吃满 4 次。冷天 / 下雨下雪先挑热饮。
//   对话里叫她吃零食（cabinAction 'snack'）：girlSnack({ force: true })，不看间隔。
// 上报：'game:cabin-event' { type: 'snack_eat' }（桥接的行为日志白名单不认识的动作会让整批上传失败，所以零食不进行为日志）。
// token：snack=<sku>[:<qty>]（本地存档里直接买好，测试 / 截图用）、snackbar=1、feed=<sku>（喂她一份）、girlsnack=1
(function (V3) {
  'use strict';
  const U = V3.util, H = V3.hud, I = V3.cabinInventory;
  const CAT = () => V3.snackCatalog, M = () => V3.snackModels;
  const GAP_MS = 40 * 60000, DAILY = 4, KEY = 'cabin.snack.v1', PROP = 1.7;   // 手里的零食比真的大一点，远处看得清
  const LINES = {
    blueberry: ['蓝莓酸酸甜甜的！', '这颗好甜～'], nori: ['咔嚓，是海的味道。', '海苔好香！'], cake: ['奶油好软，好幸福……', '草莓蛋糕最好吃了！'],
    cocoa: ['热乎乎的，好暖和。', '可可上面的棉花糖化掉啦。'], honey: ['一勺蜂蜜，甜到心里啦。', '好甜好甜～'], bread: ['软软的，香香的。', '小餐包刚刚好一口。'],
    chips: ['咔嚓咔嚓！', '再来一片……就一片。'], fish_cracker: ['小鱼饼干，一口一条～', '嘿嘿，吃掉小鱼。'], cookie: ['巧克力豆！', '曲奇好酥。'],
    marshmallow: ['软乎乎的。', '像云一样。'], onigiri: ['饭团真好吃！', '有海苔的饭团最棒了。'], milk: ['凉凉的牛奶～', '咕嘟咕嘟。'],
    lemonade: ['气泡在嘴里跳！', '酸酸的，好清爽。'], pudding: ['滑滑的布丁～', '焦糖的地方最好吃。'],
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const inv = () => (I && I.data ? I.data.inventory : null);
  const snacks = () => (inv() ? inv().snacks : []);
  const toast = (text, color = '#f6c443') => { if (H && H.toast) H.toast(text, { color, ms: 2800 }); };
  const event = (type, id, text, detail) => V3.emit('game:cabin-event', { type, id, at: Date.now(), text, detail });
  const shanghai = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function dayMinute(at) {
    const p = Object.fromEntries(shanghai.formatToParts(at).map(({ type, value }) => [type, value]));
    return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
  }

  // ---- 零食篮的位置：小冰箱顶上（冰箱方块 16/16 高，北朝向模型的顶面中心约 (8.25, 16, 10.25)/16），站在冰箱正面前 ----
  let spotCache = null;
  function basketSpot() {
    const HB = V3.houseBlocks, FM = V3.furnMc, nav = V3.nav;
    if (!HB || !HB.grid || !HB.furnInstances || !FM) return null;
    const key = HB.version;
    if (spotCache && spotCache.key === key && spotCache.nav === nav) return spotCache.spot;
    let spot = null;
    const spec = FM.byId && FM.byId('mini_fridge');
    for (const t of spec ? HB.furnInstances(spec.block) : []) {
      const add = (p) => [t.cell[0] + p[0], t.cell[1] + p[1], t.cell[2] + p[2]];
      const pos = add(FM.rotatePoint([8.25 / 16, 1, 10.25 / 16], t.facing));
      let approach = null;
      for (const d of [-0.32, -0.55, -0.8]) {
        const p = add(FM.rotatePoint([0.5, 0, d], t.facing));
        if (!nav || (nav.walkable(p[0], p[2], p[1]) && (!nav.reachable || nav.reachable(p[0], p[2], p[1])))) { approach = p; break; }
      }
      if (!approach) continue;
      spot = { position: pos, approach, yaw: Math.atan2(approach[0] - pos[0], approach[2] - pos[2]), cell: t.cell.slice() };
      break;
    }
    spotCache = { key, nav, spot };
    return spot;
  }

  // ---- 零食篮（场景部件）：柳条篮 + 最多 4 件零食露在篮口 ----
  let basketGeo = null;
  function basketMesh() {
    if (!basketGeo) {
      basketGeo = V3.shellKit.sculpt(({ add, loft, quad }) => {
        const r1 = 0.13, r0 = 0.105, h = 0.085, weave = (n, a) => (Math.floor(a[1] / 0.017) % 2 ? 0xb07a3c : 0xc99556);
        add(new THREE.CylinderGeometry(r1, r0, h, 12, 1, true).translate(0, h / 2, 0), weave);
        add(new THREE.CylinderGeometry(r1 - 0.006, r0 - 0.006, h, 12, 1, true).scale(-1, 1, 1).translate(0, h / 2, 0), 0x9a6a33);
        add(new THREE.CircleGeometry(r0 - 0.004, 12).rotateX(-Math.PI / 2).translate(0, 0.004, 0), 0xa9743a);
        add(new THREE.CircleGeometry(r0, 12).rotateX(Math.PI / 2), 0x8a5a2b);
        // Braided hoops and a tucked linen liner, baked with the basket. The liner supports short produce trays.
        const ring = (r, y, dy = 0) => Array.from({ length: 32 }, (_, i) => {
          const a = i * Math.PI / 16; return [r * Math.sin(a), y + dy * Math.cos(8 * a + .3), r * Math.cos(a)];
        });
        for (let i = 0; i < 7; i++) {
          const y = .008 + i * .011, r = r0 + (r1 - r0) * y / h + .001;
          loft([ring(r, y), ring(r + .0016, y + .0016), ring(r + .001, y + .005)],
            (_, j) => j % 4 === i % 4 ? 0xb98954 : i % 2 ? 0xca9860 : 0xc08d55, { cap0: false, cap1: false });
        }
        const lining = [ring(.038, .068, .001), ring(.088, .073, .0025), ring(.11, .074, .0035), ring(.116, .060, .004)];
        for (let i = 0; i < lining.length - 1; i++) for (let j = 0; j < 32; j++) {
          const k = (j+1)%32; quad(lining[i][j], lining[i][k], lining[i+1][k], lining[i+1][j], j % 8 === 2 && i === 2 ? 0x94afa1 : 0xecd6ad, [0,1,0]);
        }
        add(new THREE.CircleGeometry(.038, 32).rotateX(-Math.PI/2).translate(0,.068,0), 0xecd6ad);
        add(new THREE.TorusGeometry(r1 - 0.002, 0.007, 5, 14).rotateX(Math.PI / 2).translate(0, h, 0), 0xd9a463);
        add(new THREE.TorusGeometry(r1 - 0.01, 0.006, 5, 12, Math.PI).translate(0, h, 0), 0xc99556);
      });
      basketGeo.userData.shared = true;
    }
    const m = new THREE.Mesh(basketGeo, [V3.vox.material({ roughness: 0.85 })]);
    m.material[0].userData.shared = false;
    m.castShadow = m.receiveShadow = true; m.name = 'snack-basket';
    return m;
  }
  const SLOTS = [[-0.05, -0.035, 0.3], [0.05, -0.03, -0.25], [-0.045, 0.045, -0.5], [0.05, 0.04, 0.6]];
  let active = null;
  function syncBasket(S) {
    const spot = basketSpot();
    S.root.visible = !!spot;
    if (!spot) return;
    if (S.spot !== spot) {
      S.spot = spot;
      S.root.position.set(spot.position[0], spot.position[1], spot.position[2]); S.root.rotation.y = spot.yaw; S.root.updateMatrixWorld(true);
    }
    const list = snacks(), sig = list.slice(0, 4).map((s) => s.sku + (CAT().get(s.sku)?.pack === 'cup' ? ':' + s.left : '')).join(',');
    if (sig === S.sig) return;
    S.sig = sig;
    for (const o of S.items) o.removeFromParent();
    S.items = [];
    list.slice(0, 4).forEach((s, i) => {
      const o = M().pack(s.sku, s.left); if (!o) return;
      const [x, z, ry] = SLOTS[i];
      // Short trays and tins sit on the basket liner: their tops, like the taller bags, clear the woven rim.
      const h = new THREE.Box3().setFromObject(o).max.y * 0.62;
      o.scale.setScalar(0.62); o.position.set(x, Math.min(0.072, Math.max(0.012, 0.113 - h)), z); o.rotation.y = ry;
      o.traverse((m) => { m.userData.layer = 'ground'; });
      S.box.add(o); S.items.push(o);
    });
  }
  V3.scene.part({
    id: 'snack-basket', label: '零食篮', order: 55,
    build(ctx) {
      if (!V3.game || !V3.game.hosted || !V3.snackModels) return null;
      const root = new THREE.Group(); root.name = 'snack-basket'; root.visible = false;
      Object.assign(root.userData, { clickable: 'snackBasket', layer: 'ground' });
      const box = new THREE.Group(); root.add(box);
      const mesh = basketMesh(); box.add(mesh);
      const S = ctx.snackBasket = active = { ctx, root, box, mesh, mat: mesh.material[0], items: [], sig: null, spot: null };
      syncBasket(S);
      return root;
    },
    update(dt, t, ctx) { if (ctx.snackBasket) syncBasket(ctx.snackBasket); },
    dispose(ctx) {
      const S = ctx.snackBasket; if (!S) return;
      if (S.mat) S.mat.dispose();   // 场景自己的清理可能已经先把 mesh 的材质摘掉了
      S.root.removeFromParent();
      if (active === S) active = null;
      ctx.snackBasket = null;
    },
  });

  // ---- 拿在她手里的那份 ----
  let held = null;
  const _v = new THREE.Vector3();
  function holdProp(sku, left) {
    dropProp();
    const R = V3.R, o = M() && M().held(sku, left);
    if (!R || !o) return;
    o.scale.setScalar(PROP);
    o.traverse((m) => { m.userData.noPick = true; m.raycast = () => {}; });
    R.scene.add(o);
    held = { o, t: 0 };
  }
  function dropProp() { if (held) { held.o.removeFromParent(); held = null; } }
  V3.on('frame', () => {
    if (!held) return;
    const a = V3.actor, s = a && a.snacking;
    if (!s) { dropProp(); return; }
    a.hand(_v);
    held.o.position.copy(_v); held.o.position.y -= 0.03;
    held.o.rotation.y = (a.yaw || 0) + Math.PI;
  });

  // ---- 喂 / 吃 ----
  let feeding = false;
  function busyText(a) {
    const b = a && a.behavior;
    if (!a) return '小鲸鱼还没出来。';
    if (a.resting || (b && b.kind === 'sleep')) return '她睡着了，明天再给她吧。';
    if (b && b.kind === 'eat') return '她正在吃饭呢。';
    if (b && !a.seated) return '她正忙着，等她坐下再喂吧。';
    if (a.held) return '布置的时候不能喂她。';
    return '她现在不方便吃，等一会儿吧。';
  }
  // feed(uid, by, { facePoint }) → Promise<{ ok, error?, emptied? }>
  async function feed(uid, by = 'player', o = {}) {
    const sn = snacks().find((x) => x.uid === uid), s = sn && CAT().get(sn.sku), a = V3.actor;
    if (!sn || !s) return { ok: false, error: '这份零食已经没有了' };
    if (feeding) return { ok: false, error: '她嘴里还有呢，等她吃完这口。' };
    if (I.serverV1) return { ok: false, error: '小屋服务还是旧版存档，吃零食要等它升级' };
    const drink = s.pack === 'cup';
    if (!a || !a.snack || !a.snack({ kind: drink ? 'drink' : 'eat', text: pick(LINES[s.sku] || ['好吃！']), seconds: drink ? 3.6 : 3, facePoint: o.facePoint, force: o.force })) {
      return { ok: false, error: busyText(a) };
    }
    feeding = true;
    holdProp(s.sku, sn.left);
    const id = I.id('snack');
    try {
      const r = await I.perform({ op: 'consume', id, uid, by });
      if (!r.ok) { dropProp(); if (a.say) a.say('……咦？', 'think'); return r; }
      if (r.applied !== false) {
        const what = drink ? (s.sip === 'spoon' ? '舀了一勺' : '喝了一口') + s.name : '吃了一' + s.unit + s.name;
        event('snack_eat', id, (by === 'girl' ? '她自己' : '你喂她') + what, V3.snackEvents.eatDetail(s, by, r.left, !!r.emptied));
        if (r.emptied) toast(`${s.name}吃完了，空${s.vessel === 'bottle' ? '瓶' : s.vessel === 'jar' ? '罐' : '杯'}可以扔进门廊垃圾桶。`, '#8bd8ae');
        else if (!r.left) toast(`${s.name}吃完啦。`, '#8bd8ae');
        if (by === 'girl') remember();
      }
      return { ok: true, emptied: !!r.emptied, left: r.left };
    } finally { feeding = false; }
  }

  // ---- 她自己吃 ----
  function memory() {
    try { const m = JSON.parse(localStorage.getItem(KEY) || 'null'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; }
  }
  function remember() {
    const { day } = dayMinute(Date.now()), m = memory();
    const n = m.day === day ? (m.n || 0) + 1 : 1;
    try { localStorage.setItem(KEY, JSON.stringify({ day, n, last: Date.now() })); } catch (e) { /* 私密窗口：这次不记 */ }
  }
  function choose(list) {
    const env = V3.env && V3.env.state, wx = env && env.wx, kind = wx && wx.kind, t = wx && Number(wx.tempC);
    const cold = /rain|drizzle|storm|snow/.test(kind || '') || (Number.isFinite(t) && t < 10);
    const hot = cold ? list.filter((s) => CAT().get(s.sku)?.hot) : [];
    // 开过的先吃完（left 少于整件的），再拿新的
    const pool = hot.length ? hot : list;
    const opened = pool.filter((s) => s.left < (CAT().get(s.sku)?.count || 0));
    return pick(opened.length ? opened : pool);
  }
  let girlBusy = false;
  // → true = 她出发了（结果异步）
  function girlSnack(o = {}) {
    const a = V3.actor, list = snacks();
    if (girlBusy || feeding || !a || !I.ready || I.serverV1) return false;
    if (!list.length) { if (o.force && a.say) a.say('零食篮空空的……', 'sad'); return false; }
    if (!['idle', 'wander'].includes(a.state) || a.behavior || a.held || (a.resting && !o.force) || V3.shellControls?.busy) return false;
    const spot = basketSpot(); if (!spot) return false;
    const it = choose(list);
    girlBusy = true;
    void (async () => {
      try {
        const [x, y, z] = spot.approach, p = a.pos;
        const here = p && Math.hypot(p[0] - x, p[2] - z) < 0.15 && Math.abs(p[1] - y) < 0.5;
        if (!here && !(await a.goto(x, z, y))) return;
        if (!['idle', 'wander'].includes(a.state) || a.behavior) return;
        await feed(it.uid, 'girl', { force: o.force });
      } catch (e) { V3.err('girlSnack: ' + (e && e.message || e)); }
      finally { girlBusy = false; }
    })();
    return true;
  }
  // 89-cabin-routine 每拍问一次：该不该去吃点零食（给了 now 方便测试）
  function considerGirl(now = Date.now()) {
    if (!snacks().length || girlBusy) return false;
    const { day, minute } = dayMinute(now), m = memory();
    if (minute >= 11 * 60 && minute < 14 * 60) return false;              // 午饭前后不吃零食
    if (m.day === day && (m.n || 0) >= DAILY) return false;
    if (m.last && now - m.last < GAP_MS) return false;
    if (Math.random() > 0.35) return false;                               // 不是一到点就去
    return girlSnack();
  }

  // ---- 零食栏 ----
  let bar = null, list = null, coinsEl = null, drag = null;
  function buildBar() {
    coinsEl = U.el('span', { class: 'snk-coins' });
    list = U.el('div', { class: 'snk-list' });
    bar = U.el('div', { class: 'snk-bar hide', role: 'region', 'aria-label': '零食篮' },
      U.el('div', { class: 'snk-head' },
        U.el('span', { class: 'snk-title' }, '零食篮'), coinsEl,
        U.el('span', { class: 'snk-tip' }, '按住一份拖到小鲸鱼身上'),
        U.el('button', { type: 'button', class: 'snk-shop', onclick: () => V3.emit('game:open', 'shop:buy') }, '去小店'),
        U.el('button', { type: 'button', class: 'snk-x', 'aria-label': '收起零食栏', title: '收起', onclick: () => B.toggle(false) }, '✕')),
      list);
    document.body.append(bar);
  }
  let later = false;
  function renderBar() {
    if (!bar || bar.classList.contains('hide')) return;
    if (drag) { later = true; return; }   // 拖着的那一格不能被重建掉（指针捕获会丢）：松手以后再刷新
    later = false;
    coinsEl.textContent = '贝币 ' + (inv() ? inv().coins : 0);
    list.textContent = '';
    const items = snacks();
    if (!I.ready) { list.append(U.el('div', { class: 'snk-empty' }, I.error || '小屋存档还在加载…')); return; }
    if (!items.length) { list.append(U.el('div', { class: 'snk-empty' }, '零食篮空空的。去小店买点零食吧：卖贝壳、清理垃圾都能换贝币。')); return; }
    for (const sn of items) {
      const s = CAT().get(sn.sku); if (!s) continue;
      const cup = s.pack === 'cup', src = M().icon(s.sku, { left: sn.left, size: H.iconPx(56) });
      const el = U.el('button', { type: 'button', class: 'snk-item' + (cup ? ' cup' : ''), title: s.name + '：拖到小鲸鱼身上', 'aria-label': s.name },
        src ? U.el('img', { src, alt: '', draggable: 'false' }) : U.el('i', { class: 'snk-dot' }),
        U.el('span', { class: 'snk-name' }, s.name),
        U.el('span', { class: 'snk-left' + (cup ? ' lv' + sn.left : '') }, cup ? CAT().level(sn.left) : `${sn.left} ${s.unit}`));
      el.dataset.uid = sn.uid;
      el.addEventListener('pointerdown', (e) => startDrag(e, sn, s, el));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); keyFeed(sn); } });
      list.append(el);
    }
  }
  // 键盘：回车 = 直接喂（没法拖的时候）
  async function keyFeed(sn) { const r = await feed(sn.uid, 'player'); if (!r.ok) toast(r.error, '#f5aa73'); }

  // 拖：按下不动是点（提示要拖），挪过 6 px 才开始拖；指针落在她身上（91-cabin 的 pick）= 喂
  function startDrag(e, sn, s, el) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* 没关系 */ }
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, sn, s, el, ghost: null, over: false, raf: 0, last: null };
    const move = (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      if (!drag.ghost && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 6) return;
      if (!drag.ghost) {
        const src = M().icon(s.sku, { what: s.pack === 'cup' ? 'pack' : 'piece', left: sn.left, size: H.iconPx(64) });
        drag.ghost = U.el('div', { class: 'snk-ghost' }, src ? U.el('img', { src, alt: '' }) : null, U.el('span', { class: 'snk-ghost-tip' }, '松手喂她'));
        document.body.append(drag.ghost); el.classList.add('dragging');
      }
      drag.last = { clientX: ev.clientX, clientY: ev.clientY };
      drag.ghost.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px)`;
      if (!drag.raf) drag.raf = requestAnimationFrame(() => { if (!drag) return; drag.raf = 0; drag.over = overGirl(drag.last); drag.ghost.classList.toggle('over', drag.over); });
    };
    const up = async (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      const d = drag; drag = null;
      if (d.raf) cancelAnimationFrame(d.raf);
      el.classList.remove('dragging');
      if (later) setTimeout(renderBar, 0);
      if (!d.ghost) { toast('按住拖到小鲸鱼身上，就能喂她。', '#6fc3f5'); return; }
      const hit = ev.type === 'pointerup' && overGirl({ clientX: ev.clientX, clientY: ev.clientY });
      if (!hit) { flyBack(d); return; }
      d.ghost.remove();
      const r = await feed(d.sn.uid, 'player', { facePoint: V3.R && V3.R.camera ? V3.R.camera.position.toArray() : undefined });
      if (!r.ok) toast(r.error, '#f5aa73');
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  function overGirl(p) {
    const T = V3.cabinTargets;
    if (!p || !T || !T.pick) return false;
    try { const t = T.pick(p); return !!(t && t.what === 'girl'); } catch (e) { return false; }
  }
  function flyBack(d) {
    const r = d.el.getBoundingClientRect(), g = d.ghost;
    g.classList.add('back');
    g.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px) scale(.4)`;
    setTimeout(() => g.remove(), 260);
  }

  const B = V3.snackBar = {
    toggle(on) {
      if (!bar) buildBar();
      const show = on == null ? bar.classList.contains('hide') : !!on;
      bar.classList.toggle('hide', !show);
      document.body.classList.toggle('snk-on', show);
      if (show) renderBar();
      return show;
    },
    isOpen: () => !!bar && !bar.classList.contains('hide'),
    feed, girlSnack, considerGirl, basketSpot, objects: () => (active && active.root.visible ? [active.root] : []),
    get busy() { return girlBusy || feeding; },
  };
  V3.on('inventory:change', () => renderBar());
  V3.on('inventory:status', () => renderBar());

  // ---- 测试 / 截图 token ----
  const T = V3.viewTokens;
  T.snack = async (v) => {   // snack=<sku>[:<qty>]：本地存档里先给够贝币再买（只在浏览器本地存档上）
    const [sku, q] = String(v || 'blueberry').split(':'), qty = Math.max(1, Math.min(5, Number(q) || 1)), s = CAT().get(sku);
    if (!s || !I.ready || I.remote) return;
    const need = s.price * qty - (inv() ? inv().coins : 0);
    if (need > 0 && I.devCoins) await I.devCoins(need);
    await I.perform({ op: 'buy', id: I.id('buy'), sku, qty });
  };
  T.snackbar = (v) => { B.toggle(v !== '0'); };
  T.feed = async (v) => { const sn = snacks().find((x) => !v || x.sku === v); if (sn) await feed(sn.uid, 'player'); };
  T.girlsnack = () => { girlSnack({ force: true }); };
})(window.V3);
