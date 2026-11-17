// 91-cabin.js — 海边小屋 game page (cabin.html): boot, V3.game.start, show house2 at real time, HUD,
// click a shell to collect it / click the loft shell cabinet to open the collection, ?view=, then __READY.
// Also clickable (2026-11-12): the wind chime ('chime' → rings once) and the crab ('crab' → runs back into its hole).
// Feedback tool is off here unless ?fb=1 (build.mjs PAGES.cabin.pre sets window.__V3_NO_FB).
(function (V3) {
  'use strict';
  const U = V3.util;
  // ---- clicks: beach shell → V3.game.collect(id,'player') · loft cabinet ('shellBox') → 'game:open' collection ·
  // album → V3.album.open (68-album; which album table = nearest to the hit point) · photo frame slot ('photo', 55-photo-frames) → V3.album.pick.
  // A click = press + release that moved < 6 px (a drag still orbits the camera).
  const findTarget = (o) => {
    for (let p = o; p; p = p.parent) {
      const u = p.userData;
      if (u.collectId) return { what: 'collect', id: u.collectId, obj: p };
      if (u.clickable) return { what: u.clickable, obj: p };
    }
    return null;
  };
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const matOf = (h) => {
    const m = h.object.material;
    if (!Array.isArray(m)) return m;
    const i = h.faceIndex * 3, g = h.object.geometry.groups.find(gr => i >= gr.start && i < gr.start + gr.count);
    return g ? m[g.materialIndex] : m[0];
  };
  // opaque visible surfaces hide what is behind them; glass, water, sprites and invisible pick spheres do not
  const blocks = (h) => {
    const o = h.object;
    if (o.userData.noPick || o.isSprite || o.isPoints || o.isLine) return false;
    const m = matOf(h);
    return !!m && m.visible !== false && !m.transparent;
  };
  let indoorFor = null, indoor = [], always = [];
  const indoorList = () => {                  // shell cabinet + album, found once per shown model (and again when the block house re-meshes)
    const c = V3.models.current(), hl = V3.houseBlocks && V3.houseBlocks.live && V3.houseBlocks.live();
    const key = c && (c.id + '|' + c.root.uuid + '|' + (hl ? hl.shown + '|' + hl.cache.size + '|' + hl.gen : '') + '|' + (V3.photoFrames ? V3.photoFrames.version : 0)
      + '|' + (V3.houseDetail && V3.houseDetail.version || 0));   // root.uuid：换房子时整个场景重建；相框的照片换了也重新找；风铃（55-house-detail）方块读得晚、后加进来的也重新找
    if (key !== indoorFor) {
      indoorFor = key; indoor = []; always = [];
      if (c && c.root) c.root.traverse(o => { if (o.userData.clickable && o.userData.clickable !== 'girl' && o.userData.clickable !== 'furniture') (o.userData.clickAlways ? always : indoor).push(o); });
    }
    // indoor targets only count while the roof is off (楼层 一楼/阁楼); with the roof on they sit inside a closed house.
    // 相框（clickAlways，55-photo-frames）：挂在外墙上的也点得到，一直算（被墙挡着的 pick 会查出来）
    return c && c.states && c.states.floor && c.states.floor.value !== 'all' ? indoor.concat(always) : always;
  };
  const candidates = () => {
    const a = V3.beachItems && V3.beachItems.objects ? V3.beachItems.objects().slice() : [];
    if (V3.actor && V3.actor.root) a.push(V3.actor.root);
    const furniture = V3.furniturePlay && V3.furniturePlay.candidates ? V3.furniturePlay.candidates() : [];
    const decor = V3.shellDecor ? V3.shellDecor.objects() : [];
    const bins = V3.cabinTrash ? V3.cabinTrash.objects() : [];
    const basket = V3.snackBar && V3.snackBar.objects ? V3.snackBar.objects() : [];
    return [...new Set(a.concat(indoorList(), furniture || [], decor, bins, basket))].filter(shown);
  };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pickable = o => {
    for (let p = o; p; p = p.parent) { if (!p.visible || p.userData.noPick) return false; if (p === V3.R.scene) return true; }
    return false;
  };
  async function loadDiaryPages() {
    const response = await fetch('/api/cabin/art', { cache: 'no-store' });
    if (!response.ok) throw new Error('diary HTTP ' + response.status);
    const data = await response.json();
    if (data?.ok !== true || !Array.isArray(data.diaries)) throw new Error('bad diary payload');
    return data.diaries.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d?.day) && typeof d.text === 'string')
      .sort((a, b) => b.day.localeCompare(a.day)).map(d => ({ title: d.day, text: d.text }));
  }
  const actionable = t => {
    if (!t) return false;
    if (t.what === 'girl') return !!(V3.actor && V3.actor.poke);
    if (t.what === 'collect') return !!(V3.game && V3.game.collect);
    if (t.what === 'shellBox') return true;
    if (t.what === 'shellDecor') return !!(V3.collection && V3.game.inventory()?.placements[t.obj.userData.shellDecorSlot]);
    if (t.what === 'cabinTrash') return !!V3.cabinTrash;
    if (t.what === 'snackBasket') return !!V3.snackBar;
    if (t.what === 'album') return true;
    if (t.what === 'diaryShelf') return !!(window.__cabinGallery && V3.album?.open);
    if (t.what === 'photo') return !!(t.obj.userData.photoTarget && V3.album && V3.album.pick);
    if (t.what === 'furniture') return !!(V3.furniturePlay && V3.furniturePlay.state().items.some(r => r.key === t.obj.userData.furnitureKey));
    // 贝壳风铃（55-house-detail）：点一下摇一摇、响一串（66-chime-sound）。小螃蟹（59-sealife）：点一下吓回洞里；已经在往洞里跑 / 躲着的时候不算
    if (t.what === 'chime') return !!(V3.chimes && V3.chimes.click);
    if (t.what === 'crab') { const c = V3.sealife && V3.sealife.crab; return !!(c && c.canStartle && c.canStartle()); }
    return false;
  };
  // 你打开了相册 / 书架上的日记：她闲着就跑过来一起看（65 的 join），面板关了她就起身（2026-11-14）。面板是异步打开的，头 3 秒不算「关了」
  const join = (kind, near, text) => {
    const a = V3.actor;
    if (!a || !a.join) return false;
    const t0 = performance.now(), open = () => !!(V3.album && V3.album.isOpen && V3.album.isOpen());
    try { return !!a.join(kind, { near, text, while: () => performance.now() - t0 < 3000 || open() }); }
    catch (err) { V3.err('cabin.join: ' + ((err && err.stack) || err)); return false; }
  };
  // What a click on target t does. Purely local for 'chime' / 'crab' (nothing is reported to the server).
  const act = (t) => {
    if (!t) return false;
    if (t.what === 'girl') return !!(V3.actor && V3.actor.poke && V3.actor.poke({ point: t.point }));
    if (t.what === 'furniture') return !!(V3.furniturePlay && V3.furniturePlay.activate && V3.furniturePlay.activate(t));
    if (t.what === 'collect') { if (V3.game && V3.game.collect) V3.game.collect(t.id, 'player'); return true; }
    if (t.what === 'shellBox') { V3.emit('game:open', 'collection'); return true; }
    if (t.what === 'cabinTrash') { V3.cabinTrash.dispose(); return true; }
    if (t.what === 'snackBasket') { V3.snackBar.toggle(true); return true; }   // 冰箱上的零食篮：打开零食栏
    if (t.what === 'shellDecor') {
      const p = V3.game.inventory()?.placements[t.obj.userData.shellDecorSlot];
      if (!p || !V3.collection) return false;
      V3.collection.openDetail(p.kind);
      return true;
    }
    // 相册：点的是哪一张相册矮桌（房子里可以有好几张）按点到的位置找（68-album）
    if (t.what === 'album') { if (V3.album && V3.album.open) V3.album.open({ near: t.point }); else V3.emit('game:open', 'album'); join('album', t.point, '一起看相册吧。'); return true; }
    if (t.what === 'diaryShelf') { V3.album.open({ loadPages: loadDiaryPages }); join('read', t.point, '一起看日记吧。'); return true; }
    // 相框 / 画框墙的一个小框（55-photo-frames 的点的平面）：换照片
    if (t.what === 'photo') { const pt = t.obj.userData.photoTarget; if (V3.album && V3.album.pick && pt) V3.album.pick({ cell: pt.cell, slot: pt.slot }); return !!pt; }
    // 风铃：点的是哪一个按方块格子认（方块房子里可以有好几个）；旧布局的风铃没有格子，按那件东西自己认
    if (t.what === 'chime') return !!(V3.chimes && V3.chimes.click && V3.chimes.click({ cell: t.obj.userData.cell, obj: t.obj }));
    if (t.what === 'crab') { const c = V3.sealife && V3.sealife.crab; return !!(c && c.startle && c.startle()); }
    return false;
  };
  V3.cabinTargets = { find: findTarget, actionable, act };   // 测试用（test/click-chime-crab.test.mjs）：和真的点击走同一套判断
  // Both hover and click use the same visible executable targets and opaque obstruction test.
  const pick = (e) => {
    const R = V3.R, r = R.canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, R.camera);
    const hits = ray.intersectObjects(candidates(), true).filter(h => pickable(h.object) && actionable(findTarget(h.object)));
    if (!hits.length) return null;
    const t = findTarget(hits[0].object);
    t.point = hits[0].point.toArray();
    for (const h of ray.intersectObject(R.scene, true)) {
      if (h.distance > hits[0].distance + 1e-3) break;
      if (!shown(h.object)) continue;
      const tt = findTarget(h.object);
      if (tt && pickable(h.object) && hits.some(hit => findTarget(hit.object).obj === tt.obj)) { tt.point = h.point.toArray(); return tt; }
      if (blocks(h)) return null;            // a wall, roof, rock … is in the way
    }
    return t;
  };
  V3.cabinTargets.pick = pick;   // 69-snack-bar：拖零食时判断松手的地方是不是她（和点击同一套遮挡判断）
  V3.cabinClicks = () => {
    const cv = V3.R.canvas; let down = null;
    const pointers = new Set();
    const off = () => !!(V3.fb && V3.fb.enabled) || !!(V3.arrange && V3.arrange.on);   // ?fb=1: clicks belong to the feedback tool; 布置模式: to 69-arrange
    cv.addEventListener('pointerdown', (e) => {
      pointers.add(e.pointerId);
      if (pointers.size > 1) { down = null; return; }
      if (e.button === 0 && !off()) down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
    });
    cv.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); down = null; });
    cv.addEventListener('pointerup', (e) => {
      pointers.delete(e.pointerId);
      const d = down; down = null;
      if (!d || d.id !== e.pointerId || e.button !== 0 || d.moved || off() || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 6) return;
      try { act(pick(e, true)); } catch (err) { V3.err('cabin.click: ' + ((err && err.stack) || err)); }
    });
    cv.addEventListener('pointermove', (e) => {
      if (down && (off() || Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 6)) down.moved = true;
    });
    if (V3.interactionHover) V3.interactionHover.mount({ canvas: cv, pick, off });
    // test token tap=first (first candidate, e.g. a beach shell) or tap=<x>_<y> (CSS px): runs the real click path
    V3.viewTokens.tap = async (v) => {
      let x, y;
      if (!v || v === 'first') {
        const o = candidates()[0]; if (!o) { V3.err('tap: nothing to tap'); return; }
        const p = new THREE.Vector3(); o.getWorldPosition(p); p.y += 0.07; p.project(V3.R.camera);
        const r = V3.R.canvas.getBoundingClientRect();
        x = r.left + (p.x + 1) / 2 * r.width; y = r.top + (1 - p.y) / 2 * r.height;
      } else [x, y] = String(v).split('_').map(Number);
      if (!act(pick({ clientX: x, clientY: y }, true))) V3.err('tap: missed at ' + Math.round(x) + ',' + Math.round(y));
    };
  };
  const start = async () => {
    const R = V3.boot();
    document.body.classList.add('page-cabin');
    if (V3.game && V3.game.start) V3.game.start({ live: U.qs('live', '1') !== '0' });
    if (V3.ysmUI && V3.ysmUI.preload) await V3.ysmUI.preload();   // 默认小鲸鱼（自带的 YSM 模型）/ 选中的 YSM 模型先读好，场景里直接用它
    // 房子的方块先读好（导入过的房子从浏览器里取，没有就用内嵌的鲸图）：跟着方块摆的灯、屏幕、风铃、遮阳伞建场景时就摆好
    if (V3.houseBlocks && V3.houseBlocks.load) { try { await V3.houseBlocks.load(); } catch (e) { /* 读不出来：54-house-mc 自己报 */ } }
    V3.models.show('house2');
    V3.setState('time', U.qs('time', 'real'));
    // weather: the setting (default 实时天气) unless ?wx= overrides it for this visit
    const wx0 = U.qs('wx', '') || (V3.game && V3.game.get ? V3.game.get('weather') : 'real') || 'real';
    V3.setState('weather', wx0);
    V3.on('game:settings', (e) => { if (e && e.key === 'weather' && !U.qs('wx', '')) V3.setState('weather', e.value); });
    if (V3.hud && V3.hud.mount) V3.hud.mount();
    if (V3.cabinClicks) V3.cabinClicks(R);
    const v0 = U.qs('view', '');
    if (v0) await V3.view(v0);
    await V3.nextFrames(4);
    window.__READY = true;
    V3.emit('ready');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window.V3);
