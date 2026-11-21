// Per-instance cabin furniture play. Runtime states stay outside the exported schematic.
(function (V3) {
  'use strict';
  const F = V3.furniturePlay = {}, U = V3.util, COOK = 30, CHANNELS = ['海边频道', '星空频道', '天气频道'];
  const fresh = kind => kind === 'tv' ? { on: false, channel: 0 } : kind === 'cooker' ? { phase: 'idle', remaining: 0, bowl: false } : {};
  F.reduce = (kind, state, action, dt = 0) => {
    const s = Object.assign(fresh(kind), state);
    if (kind === 'tv') {
      if (action === 'toggle') s.on = !s.on;
      if (action === 'next') { s.on = true; s.channel = (s.channel + 1) % CHANNELS.length; }
    } else if (kind === 'cooker') {
      if (action === 'cook' && s.phase === 'idle') { s.phase = 'cooking'; s.remaining = COOK; }
      if (action === 'tick' && s.phase === 'cooking') { s.remaining = Math.max(0, s.remaining - Math.max(0, Number.isFinite(dt) ? dt : 0)); if (!s.remaining) s.phase = 'ready'; }
      if (action === 'serve' && s.phase === 'ready' && !s.bowl) { s.phase = 'idle'; s.bowl = true; }
      if (action === 'eat' && s.bowl) s.bowl = false;
      if (action === 'cancel' && s.phase === 'cooking') { s.phase = 'idle'; s.remaining = 0; }
    }
    return s;
  };
  const normalize = (kind, v) => {
    v = v || {};
    if (kind === 'tv') return { on: v.on === true, channel: Number.isInteger(v.channel) && v.channel >= 0 && v.channel < 3 ? v.channel : 0 };
    if (kind === 'cooker') return { phase: ['idle', 'cooking', 'ready'].includes(v.phase) ? v.phase : 'idle', remaining: Number.isFinite(v.remaining) ? Math.max(0, Math.min(COOK, v.remaining)) : 0, bowl: v.bowl === true };
    return {};
  };
  // Content identity isolates imported houses; photos do not reset the kettle/TV.
  F.houseKey = model => {
    let h = 2166136261;
    const add = s => { for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); };
    add(JSON.stringify([model.size, model.offset, model.palette]));
    for (const c of model.cells) { h = Math.imul(h ^ c, 16777619); }
    return 'v4-furniture-play:1:' + (h >>> 0).toString(16);
  };
  let live = null, panel = null, selected = null, lastPanel = '';
  // The cooker whose rice the character's running eat behaviour (65-girl-actor) uses: { owner: live, key, user, picked }.
  // Only counts while she really is at that meal, so a link can never keep the buttons waiting for nobody.
  let meal = null;
  const mealOf = r => { const a = V3.actor, b = meal && meal.owner === live && meal.key === r.key && a ? a.behavior : null; return !!b && b.kind === 'eat'; };
  const HB = () => V3.houseBlocks;
  const blocked = () => !!(V3.arrange && V3.arrange.on) || !!(V3.fb && V3.fb.enabled);
  const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const tell = text => { if (V3.hud && V3.hud.toast) V3.hud.toast(text); };
  const respond = text => { if (V3.actor && V3.actor.respond) V3.actor.respond(text, { seconds: 3 }); };
  // force = flush points (pagehide / dispose): always write, as before. Otherwise the synchronous localStorage
  // write is skipped when the browser already holds exactly this text (the idle 5 s autosave used to rewrite it).
  function save(force) {
    if (!live || !live.storageKey) return;
    const values = {};
    for (const r of live.items.values()) if (r.kind === 'tv' || r.kind === 'cooker') values[r.key] = r.state;
    const text = JSON.stringify(values);
    live.dirty = false;
    if (force !== true && text === live.savedText) return;
    try { localStorage.setItem(live.storageKey, text); live.savedText = text; } catch (_) { live.dirty = true; if (!live.warned) { live.warned = true; tell('这次家具状态无法保存在浏览器，当前仍可继续玩。'); } }
  }
  function close() { if (panel) panel.remove(); panel = null; selected = null; lastPanel = ''; }
  F.close = close;
  function label(r) { return ({ tv: '电视', cooker: '电饭煲', rocker: '摇椅', door: '门', lamp: '灯', telescope: '望远镜' })[r.kind] || '家具'; }
  // 望远镜（2026-11-14）：她正在（或正去）这一台看星星吗
  const gazing = r => { const b = V3.actor && V3.actor.behavior; return !!b && b.kind === 'stargaze' && r.kind === 'telescope' && live && tvNearKind('telescope', b.spot) === r; };
  const starry = () => V3.starView ? !V3.starView.reason() : !!V3.actor?.starry;
  function status(r) {
    const s = r.state;
    if (r.kind === 'tv') return s.on ? CHANNELS[s.channel] + (s.channel === 2 && V3.shore ? ' · ' + V3.shore.bulletin() : '') : '电视关着';
    if (r.kind === 'cooker') return (s.phase === 'cooking' ? '正在煮饭 · 还要 ' + Math.ceil(s.remaining) + ' 秒' : s.phase === 'ready' ? '饭煮好了，正在保温' : '待机') + (s.bowl ? ' · 碗里有饭' : ' · 碗是空的')
      + (mealOf(r) ? (meal.picked ? ' · 小鲸鱼正在吃饭' : ' · 小鲸鱼正去盛饭') : '');
    if (r.kind === 'rocker') return r.sitting ? '坐着摇一会儿，再点椅子可以起身' : r.walking ? '正在走向摇椅' : '邀请小鲸鱼坐一会儿';
    if (r.kind === 'telescope') {
      const b = V3.actor && V3.actor.behavior, on = gazing(r);
      if (!starry()) return '天亮了 / 天上有云，现在看不到星星';
      return on ? (b.phase === 'action' ? '小鲸鱼正蹲在目镜前看星星' : '小鲸鱼正跑过来') : '夜里星星正亮，叫小鲸鱼一起来看';
    }
    const v = HB().switchState(r.key) || {};
    return r.kind === 'door' ? (v.open ? '门开着' : '门关着') : (v.enabled === false ? '灯已关闭' : '灯已打开');
  }
  function drawPanel(force) {
    const r = live && live.items.get(selected); if (!r || !panel) return;
    const text = status(r), sig = text + '|' + selected;
    if (!force && sig === lastPanel) return; lastPanel = sig;
    const info = panel.querySelector('.fp-status'); info.textContent = text;
    const controls = panel.querySelector('.fp-controls'); controls.replaceChildren();
    const button = (text, action, disabled) => controls.append(U.el('button', { type: 'button', disabled: !!disabled, 'data-action': action, onclick: () => F.action(r.key, action) }, text));
    if (r.kind === 'tv') { button(r.state.on ? '关电视' : '开电视', 'toggle'); button('换台', 'next'); }
    if (r.kind === 'cooker') {
      // While she is on her way or eating, the two meal buttons wait for her; rice that is ready can be eaten in one press.
      const s = r.state, busy = mealOf(r);
      button('煮一锅饭', 'cook', s.phase !== 'idle'); button('盛到碗里', 'serve', busy || s.phase !== 'ready' || s.bowl); button('吃饭', 'eat', busy || (!s.bowl && s.phase !== 'ready'));
      if (s.phase === 'cooking') button('停止煮饭', 'cancel');
    }
    if (r.kind === 'rocker') button(r.sitting || r.walking ? '起来 / 取消' : '坐一会儿', 'sit');
    // 2026-11-15：白天/阴天也能按下去，按下后由 telescope() 告诉她「等天黑、天晴了再来」
    if (r.kind === 'telescope') { button('一起看星星', 'gaze'); if (gazing(r)) button('看够了', 'stop'); }
    if (r.kind === 'lamp') button('开 / 关', 'toggle');
  }
  function open(r) {
    close(); selected = r.key;
    panel = U.el('section', { class: 'furniture-panel', role: 'dialog', 'aria-label': label(r) },
      U.el('div', { class: 'fp-heading' }, U.el('strong', null, label(r)), U.el('button', { type: 'button', 'aria-label': '关闭家具面板', onclick: close }, '×')),
      U.el('p', { class: 'fp-status', 'aria-live': 'polite' }), U.el('div', { class: 'fp-controls' }));
    document.body.append(panel); drawPanel(true);
  }
  function pickTag(o, r) { o.userData.clickable = 'furniture'; o.userData.furnitureKey = r.key; o.userData.clickAlways = true; r.objects.push(o); }
  function proxy(r, parent, pos, size) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
    m.position.set(...pos); m.userData.noShadow = true; parent.add(m); pickTag(m, r); live.owned.push(m);
    return m;
  }
  function tvSetup(r, root) {
    r.screen = root.getObjectByName('screen'); if (!r.screen) return;
    const c = document.createElement('canvas'); c.width = 192; c.height = 96; r.canvas = c; r.paint = c.getContext('2d');
    r.texture = new THREE.CanvasTexture(c); r.texture.magFilter = THREE.NearestFilter; r.texture.minFilter = THREE.LinearFilter; r.texture.colorSpace = THREE.SRGBColorSpace;
    r.screen.material.map = r.texture; r.screen.material.emissiveMap = r.texture; r.screen.material.metalness = 0; r.screen.material.roughness = 1; r.screen.material.needsUpdate = true;
    pickTag(r.screen, r); r.frame = -1;
  }
  function tvDraw(r, t) {
    const frame = Math.floor(t * 6), s = r.state;
    // Same state and, while on, same 6 Hz frame: nothing new to show. A switched-off screen is a still picture,
    // so after the one repaint that turns it off it is neither redrawn nor re-uploaded until the state changes.
    if (r.drawOn === s.on && r.drawChannel === s.channel && (!s.on || r.frame === frame)) return;
    r.frame = frame; r.drawOn = s.on; r.drawChannel = s.channel; const g = r.paint;
    if (!g) return;
    g.fillStyle = !s.on ? '#12171e' : ['#69afce', '#121c40', '#324759'][s.channel]; g.fillRect(0, 0, 192, 96);
    const mat = r.screen.material; mat.color.setHex(0xffffff); mat.emissive.setHex(0xffffff); mat.userData.glow = { day: s.on ? 0.65 : 0, night: s.on ? 0.45 : 0 };
    if (s.on) {
      if (s.channel === 0) {
        g.fillStyle = '#277b9b'; g.fillRect(0, 47, 192, 49); g.fillStyle = '#c2e2e5';
        for (let i = 0; i < 8; i++) g.fillRect((i * 31 + t * 8) % 210 - 15, 51 + i % 3 * 12, 17, 2);
        const x = (t * 14) % 220 - 20; g.fillStyle = '#8ac6ed'; g.fillRect(x, 61, 25, 13); g.fillRect(x + 23, 57, 7, 8); g.fillStyle = '#15304d'; g.fillRect(x + 4, 64, 3, 3);
      } else if (s.channel === 1) {
        for (let i = 0; i < 27; i++) { g.fillStyle = i % 3 ? '#bfd9ea' : '#ffe6a0'; g.fillRect((i * 37) % 189, 26 + (i * 19) % 66, i % 4 === frame % 4 ? 3 : 2, 2); }
        g.fillStyle = '#f4e4ba'; g.fillRect(142, 31, 13, 14);
      } else {
        const w = V3.wx && V3.wx.now ? V3.wx.now() : {}; const wet = (w.rain || 0) > 0.3;
        g.fillStyle = wet ? '#b7c8d5' : '#ffe4a0'; g.fillRect(30, 36, 30, 25); g.fillStyle = '#eef5f7'; g.font = '14px sans-serif'; g.fillText(wet ? '听听雨声' : '去海边走走', 78, 54);
        if (wet) { g.fillStyle = '#69afce'; for (let i = 0; i < 7; i++) g.fillRect(20 + i * 8, 66 + (frame + i * 3) % 15, 2, 5); }
      }
      g.fillStyle = '#f4f7ef'; g.font = 'bold 12px sans-serif'; g.fillText(CHANNELS[s.channel], 8, 17);
    }
    r.texture.needsUpdate = true;
  }
  function cookerSetup(r, root) {
    r.rice = []; root.traverse(o => { if (o.name === 'vox:rice' || o.name === 'rice') r.rice.push(o); });
    // The existing fine rice overlay is instance-local; never use the global bowl variant.
    // Each dish (bowl, basin) is its own group under the overlay. While she has the bowl with her (bowlSync) these groups are hidden
    // as a whole (dishesShow, only when that changes); the rice meshes themselves keep following the state every frame.
    // r.home = the counter bowl the travelling one leaves from.
    r.dishes = []; r.home = null;
    for (const o of r.rice) {
      let d = o; while (d.parent && d.parent !== root) d = d.parent;
      if (d === o || d.parent !== root || r.dishes.includes(d)) continue;
      r.dishes.push(d); if (d.name === 'furn:bowl') r.home = d;
    }
    proxy(r, root, [50 / 32, 29 / 32, -1 / 32], [0.4, 0.28, 0.36]);
    r.steam = new THREE.Group(); root.add(r.steam); live.owned.push(r.steam);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.035), new THREE.MeshBasicMaterial({ color: 0xe5f1f0, transparent: true, opacity: 0.4, depthWrite: false }));
      m.userData.noPick = true; m.userData.noShadow = true; r.steam.add(m);
    }
    r.indicator = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.012), new THREE.MeshBasicMaterial({ color: 0x68746b }));
    r.indicator.position.set(49 / 32, 28 / 32, 4 / 32 + 0.012); r.indicator.userData.noPick = true; root.add(r.indicator); live.owned.push(r.indicator);
  }
  function cookerDraw(r, t) {
    for (const o of r.rice) o.visible = r.state.bowl;
    r.indicator.material.color.setHex(r.state.phase === 'cooking' ? 0xff7b32 : r.state.phase === 'ready' ? 0x8dcc76 : 0x68746b);
    r.steam.visible = r.state.phase !== 'idle';
    if (!r.steam.visible) return;   // hidden puffs are not animated; the first draw after 'cook' places them
    const dim = r.state.phase === 'cooking' ? 0.42 : 0.12, puffs = r.steam.children;
    for (let i = 0; i < puffs.length; i++) { const o = puffs[i], k = (t * 0.32 + i / 5) % 1; o.position.set(50 / 32 + Math.sin(t + i) * 0.04, 1 + k * 0.35, -1 / 32); o.material.opacity = (1 - k) * dim; }
  }
  async function rockerSetup(r, item, owner) {
    const cell = item.cell, facing = item.facing;
    const mesh = await HB().meshFor([{ pos: cell, state: item.block + '[facing=' + facing + ']' }]);
    if (owner !== live || owner.ctx.dead) { HB().disposeGroup(mesh); return; }
    r.pivot = new THREE.Group(); r.pivot.position.set(cell[0] + 0.5, cell[1] + 0.72, cell[2] + 0.5);
    // 摇的是椅子自己的左右轴（先转朝向、再绕自己的 x 摇 = 'YXZ'），所以是前后摇（2026-11-17）。
    // 以前用默认的 'XYZ'：绕的是世界的 x 轴，朝东 / 朝西的摇椅就变成左右晃
    r.pivot.rotation.order = 'YXZ'; r.pivot.rotation.y = -V3.furnMc.FACING_Y[facing] * Math.PI / 180;
    // meshFor uses world vertices; put them in the pivot's local basis without changing the rest pose.
    r.pivot.updateMatrixWorld(true); mesh.applyMatrix4(r.pivot.matrixWorld.clone().invert()); r.pivot.add(mesh); owner.root.add(r.pivot); r.mesh = mesh;
    r.yaw = Math.PI - V3.furnMc.FACING_Y[facing] * Math.PI / 180;
    r.cell = cell.slice(); pickTag(mesh, r);
  }
  async function sit(r) {
    const a = V3.actor;
    if (!a || !a.sit || !r.pivot) return false;
    if (r.sitting || r.walking) { r.ticket++; r.walking = false; if (a.stand) a.stand(); if (a.respond) a.respond('好，起来活动一下。', { seconds: 1 }); return true; }
    const owner = live, ticket = ++r.ticket, forward = V3.furnMc.rotate([0, 0, -1], r.facing);
    const targets = [1.05, 1.4].map(d => [r.cell[0] + 0.5 + forward[0] * d, r.cell[1], r.cell[2] + 0.5 + forward[2] * d]);
    const p = targets.find(p => !V3.nav || !V3.nav.walkable || V3.nav.walkable(p[0], p[2], p[1]));
    if (!p) { tell('椅子前面没有落脚的地方，挪开挡路的家具再试试。'); return false; }
    r.walking = true; drawPanel(true);
    const ok = await a.goto(p[0], p[2], p[1], { run: true });   // 你叫她过来坐：跑着来（2026-11-14）
    if (owner !== live || r.ticket !== ticket) return false;
    r.walking = false;
    if (!ok) { tell('小鲸鱼暂时走不到这把摇椅前。'); drawPanel(true); return false; }
    const anchor = () => { r.pivot.updateMatrixWorld(true); return { position: r.pivot.localToWorld(new THREE.Vector3(0, -0.28, -0.02)).toArray(), yaw: r.yaw, tilt: -r.pivot.rotation.x }; };   // 她面朝椅子的 −z（朝向差半圈），同一个前后摇在她自己的坐标里是反号
    r.sitting = !!a.sit(Object.assign(anchor(), { seconds: 20, text: '在这里摇一会儿，看看海。', anchor, onEnd: () => { r.sitting = false; r.pivot.rotation.x = 0; drawPanel(true); } }));
    if (!r.sitting) tell('这个角色的骨骼暂时不支持坐姿，可以换回小鲸鱼再试。');
    drawPanel(true); return r.sitting;
  }
  // 望远镜（2026-11-14）：一块看不见的点选盒（只在夜里、这一层显示着时才显示 → 白天点不到、没有悬停提示），
  // 悬停描边用方块模型本身（和电视 / 电饭煲一样只给描边那一遍画，不进正常场景）
  async function telescopeSetup(r, item, owner) {
    const c = item.cell;
    r.hit = proxy(r, owner.root, [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5], [0.8, 1.0, 0.8]);
    r.hit.visible = false;
    const fm = V3.furnMc, cells = fm.cellsFor(item.f, item.facing).map(q => ({ pos: q.offset.map((v, i) => v + c[i]), state: fm.state(item.f, item.facing, q.part) }));
    const mesh = await HB().meshFor(cells);
    if (owner !== live || owner.ctx.dead) { mesh.visible = false; HB().disposeGroup(mesh); return; }
    mesh.updateWorldMatrix(true, true);
    mesh.traverse(m => { if (m.isMesh) m.raycast = () => {}; });
    mesh.userData.hoverOutlineOnly = true; mesh.matrixAutoUpdate = false; mesh.matrix.copy(mesh.matrixWorld);
    mesh.name = 'hover-outline:telescope';
    r.outline = mesh;
  }
  // HB.interactions() copies every switch (cell + object list) on each call. The live house only ever replaces its
  // doors / lanterns arrays (rebuild) or appends finished switches, so comparing those arrays, their items and each
  // item's object list in place tells whether that snapshot could differ from the one already synced.
  const NONE = [];
  function switchesChanged(me) {
    const hb = HB(); if (!hb.live) return true;   // a house API without live(): no cheap signal, sync every frame as before
    const lv = hb.live(), on = !!lv && !lv.dead, a = on ? lv.doors : NONE, b = on ? lv.lanterns : NONE;
    if (!Array.isArray(a) || !Array.isArray(b)) return true;
    const sw = me.sw || (me.sw = { a: null, b: null, items: [], lists: [], sizes: [] }), n = a.length + b.length;
    let same = sw.a === a && sw.b === b && sw.items.length === n;
    for (let i = 0; same && i < n; i++) { const s = i < a.length ? a[i] : b[i - a.length], o = s && s.objects; same = sw.items[i] === s && sw.lists[i] === o && sw.sizes[i] === (o ? o.length : -1); }
    if (same) return false;
    sw.a = a; sw.b = b; sw.items.length = sw.lists.length = sw.sizes.length = n;
    for (let i = 0; i < n; i++) { const s = i < a.length ? a[i] : b[i - a.length], o = s && s.objects; sw.items[i] = s; sw.lists[i] = o; sw.sizes[i] = o ? o.length : -1; }
    return true;
  }
  function syncSwitches(me) {
    if (!HB().interactions || !switchesChanged(me)) return;
    const incoming = HB().interactions(), keys = new Set(incoming.map(it => it.key));
    for (const [key, r] of me.items) if ((r.kind === 'door' || r.kind === 'lamp') && !keys.has(key)) { me.items.delete(key); if (selected === key) close(); }
    for (const it of incoming) {
      let r = me.items.get(it.key);
      if (!r) { r = { kind: it.kind, key: it.key, cell: it.cell, state: {}, objects: [] }; me.items.set(it.key, r); }
      if (r.objects.length !== it.objects.length || r.objects.some((o, i) => o !== it.objects[i])) { r.objects = []; for (const o of it.objects) pickTag(o, r); }
    }
  }
  // ---- The bowl she carries: off the counter in her hand, then on the table while she eats ----
  // One loose copy of the counter bowl per scene (56-furn-ground looseDish: same voxels, own geometry and materials), built at the first
  // pickup and owned here. Every frame the actor says where the bowl of her meal is (65 mealBowl: in her hand / on the table before her
  // chair) and it glides there from where it was, first from the counter bowl's place. Meanwhile that cooker's dishes are hidden on the
  // counter: the served rice is in one place only. No meal link, no served rice, a meal that ended or was cancelled, a character
  // or a house that cannot tell → no travelling bowl and the counter exactly as the state says. Never a click target.
  const GLIDE = [0, 0.8, 0.4];   // seconds to reach her hand (the pickup lasts 1.15 s) / the table (she sits down for 0.45 s)
  const dishesShow = (r, on) => { for (const o of r.dishes) o.visible = on; };
  function bowlMake(me) {
    if (me.bowl !== undefined) return me.bowl;
    me.bowl = null;
    try {
      const d = V3.furn && V3.furn.looseDish ? V3.furn.looseDish('bowl') : null;
      if (d) {
        d.root.name = 'furniture-play:bowl'; d.root.visible = false; d.root.userData.noPick = true;
        for (const m of d.meshes) { m.userData.noPick = true; m.userData.layer = 'site'; m.raycast = () => {}; m.castShadow = true; m.receiveShadow = true; }
        me.root.add(d.root);
        me.bowl = { root: d.root, meshes: d.meshes, materials: d.materials, cooker: null, mode: 0, k: 1,
          spot: new THREE.Vector3(), from: new THREE.Vector3(), at: new THREE.Vector3() };
      }
    } catch (e) { V3.err('furniture-play bowl: ' + (e && e.stack || e)); }
    return me.bowl;
  }
  function bowlSync(me, dt) {
    const a = V3.actor, link = meal && meal.owner === me && meal.picked ? meal : null;
    let r = link ? me.items.get(link.key) : null, b = me.bowl || null, mode = 0;
    if (r && r.home && r.state.bowl && a && a.mealBowl && (b = bowlMake(me))) mode = a.mealBowl(b.spot);
    if (!b) return;
    if (!mode) r = null;
    const was = b.cooker;
    if (was !== r) {
      b.cooker = r;
      if (was) dishesShow(was, true);
      if (r) dishesShow(r, false);
    }
    b.root.visible = !!r;
    if (!r) { b.mode = 0; return; }
    if (b.mode !== mode) {
      if (!b.mode) { r.home.getWorldPosition(b.at); r.home.getWorldQuaternion(b.root.quaternion); }   // just taken: it starts where the counter bowl stands
      b.from.copy(b.at); b.k = 0; b.mode = mode;
    }
    b.k = Math.min(1, b.k + dt / GLIDE[mode]);
    const s = b.k * b.k * (3 - 2 * b.k), f = b.from, to = b.spot, at = b.at;
    at.x = f.x + (to.x - f.x) * s; at.y = f.y + (to.y - f.y) * s; at.z = f.z + (to.z - f.z) * s;
    me.root.worldToLocal(b.root.position.copy(at));
  }
  // ---- Meal link: the rice follows what the character really does, not the click ----
  // 盛到碗里 / 吃饭 start her real eat behaviour (65-girl-actor: walk to the counter, take the bowl, sit at the table, eat). The bowl
  // fills when she takes it ('actor:meal' pickup), empties when she has finished ('completed'), and stays served if she is
  // interrupted after taking it, so 吃饭 tries again. interrupt: a button press may turn her round from an idle stroll.
  const MEAL_OPTS = { interrupt: true, text: '开动啦。' };
  const WHY = { 'missing-furniture': '餐桌旁没有能坐的椅子', unreachable: '小鲸鱼走不到灶台和餐桌那边', 'seating-unavailable': '这个角色的骨骼暂时不支持坐姿',
    'navigation-unavailable': '现在没法给小鲸鱼找路', blocked: '小鲸鱼现在不方便走过去' };
  const speak = text => { const a = V3.actor; if (text && !(a && a.say && a.say(text))) tell(text); };   // a bubble that interrupts nothing
  function cookerSet(r, action) {
    const was = r.state, s = F.reduce('cooker', was, action);
    if (s.phase === was.phase && s.bowl === was.bowl && s.remaining === was.remaining) return false;
    r.state = s; cookerDraw(r, live.time); save(); return true;
  }
  function mealAction(r, action) {
    const s = r.state, ready = s.phase === 'ready';
    if (action === 'serve' ? !ready || s.bowl : !s.bowl && !ready) return false;   // nothing to serve / to eat: no change, as before
    const a = V3.actor; let why = '';
    if (a && a.startBehavior) {
      // Start directly (65: a queried route would be planned twice); ask for the reason only after a refusal.
      if (a.startBehavior('eat', MEAL_OPTS)) { meal = { owner: live, key: r.key, user: true, picked: false }; drawPanel(true); return true; }
      const av = a.behaviorAvailability ? a.behaviorAvailability('eat', MEAL_OPTS) : null;
      why = !av ? '' : av.available ? 'busy' : av.reason || 'busy';
      if (why === 'busy') { tell(a.behavior && a.behavior.kind === 'eat' ? '小鲸鱼已经在忙这顿饭啦，等她吃完再点。' : '小鲸鱼正忙着，等她停下来再点一次。'); return false; }
    }
    // She cannot act it out (no dining seat, no route, a body that cannot sit, no character at all): the instant change, with the reason.
    const step = action === 'eat' && s.bowl ? 'eat' : 'serve';
    if (!cookerSet(r, step)) return false;
    tell((WHY[why] || '小鲸鱼现在没法自己走过去') + (step === 'serve' ? '，这次先直接盛好。' : '，这次就直接吃完啦。'));
    // With the behaviour API a plain bubble: respond() would hold her attention and make the very next press "busy".
    (a && a.startBehavior ? speak : respond)(step === 'serve' ? '盛好了，小心烫！' : '吃饱啦，谢谢你陪我吃饭。');
    drawPanel(true); return true;
  }
  // Is there cooked rice (kept warm or already in the bowl)? The actor picks its pickup line with this.
  F.hasRice = () => {
    if (live) for (const r of live.items.values()) if (r.kind === 'cooker' && (r.state.bowl || r.state.phase === 'ready')) return true;
    return false;
  };
  // Lunch routine hook (89-cabin-routine): may she go and serve now? No cooker in this house → true (nothing to wait for). A served
  // bowl or a ready pot → true. A pot still cooking → false. Everything idle → start one pot, like 煮一锅饭, and answer false until it is done.
  F.mealReady = () => {
    if (!live || !live.ready) return true;
    let idle = null, cooking = false;
    for (const r of live.items.values()) if (r.kind === 'cooker') {
      if (r.state.bowl || r.state.phase === 'ready') return true;
      if (r.state.phase === 'cooking') cooking = true; else if (!idle) idle = r;
    }
    if (cooking) return false;
    if (!idle) return true;
    if (blocked()) return false;
    // Rice nobody can sit down to eat (no dining seat, no route, …) would only go cold: let the routine carry on exactly as before.
    const a = V3.actor, av = a && a.behaviorAvailability ? a.behaviorAvailability('eat') : null;
    if (av && !av.available && av.reason !== 'busy') return true;
    if (cookerSet(idle, 'cook')) { speak('到饭点啦，先煮一锅饭，等一小会儿。'); drawPanel(true); }
    return false;
  };
  // 离 spot（[x, y, z]）最近的那台电视（或别的 kind）；spot 没给就第一台
  function tvNear(spot) { return tvNearKind('tv', spot); }
  function tvNearKind(kind, spot) {
    let best = null, bd = Infinity;
    if (live) for (const r of live.items.values()) if (r.kind === kind) {
      const d = Array.isArray(spot) ? Math.hypot(r.cell[0] + 0.5 - spot[0], r.cell[1] - spot[1], r.cell[2] + 0.5 - spot[2]) : 0;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  // 你开了电视 / 换了台 / 点了一台开着的电视：她闲着就跑过来一起看（65 的 join，电视关掉就结束）；她在忙别的就原地说一句。
  // 你关了电视：她正陪着看的话自己会起身（while 变 false），这里只说一句。你碰过的电视归你管（auto = false），她走的时候不替你关
  function tvCompany(r) {
    const a = V3.actor, on = r.state.on, b = a && a.behavior;
    const text = on ? '一起看一会儿' + CHANNELS[r.state.channel] + '吧。' : '关好电视，去听海浪。';
    r.auto = false;
    const owner = live, near = [r.cell[0] + 0.5, r.cell[1], r.cell[2] + 0.5];
    if (on && a && a.join && a.join('watch_tv', { near, text, seconds: 60, while: () => live === owner && owner.items.get(r.key) === r && r.state.on })) return;
    // 没去成（在忙、走不到、关电视）：以前的回应。正在做正事（吃饭、回消息……）或者正陪着看时只冒泡，不打断她；睡觉时照旧被叫醒
    (b && b.kind !== 'sleep' ? speak : respond)(text);
  }
  // 望远镜：「一起看星星」→ 她跑过来、蹲在目镜前看，一直看到你点「看够了」或者天亮 / 下雨（最多 10 分钟）；陪你看时说得勤一点。
  // 她在忙正事（吃饭、回消息……）、睡着、走不过去：说一句原因，不打断她
  const GAZE_WHY = { busy: '小鲸鱼正忙着，等她停下来再叫她一起看。', daytime: '现在看不到星星，等天黑、天晴了再来。', unreachable: '小鲸鱼走不到望远镜那边。',
    blocked: '小鲸鱼现在不方便过来。', 'missing-furniture': '找不到望远镜。' };
  function telescope(r, action) {
    const a = V3.actor;
    if (!a || !a.join) return false;
    if (action === 'stop') {
      if (!gazing(r)) return false;
      if (a.endBehavior && a.endBehavior()) speak('好，下次再一起看。');
      else a.cancelBehavior && a.cancelBehavior('player');
      drawPanel(true); return true;
    }
    const view = V3.starView, whySky = view?.reason();
    if (whySky) { tell(whySky); return false; }
    const near = [r.cell[0] + 0.5, r.cell[1], r.cell[2] + 0.5];
    if (a.join('stargaze', { near, text: '一起看星星吧！', while: view && (() => view.isOpen) })) {
      if (view) { removeStarInvite(); close(); view.open({fromTelescope:true}); } else drawPanel(true);
      return true;
    }
    const b = a.behavior, av = a.behaviorAvailability ? a.behaviorAvailability('stargaze', { interrupt: true, near }) : null;
    const why = av && !av.available ? av.reason : 'busy';
    if (b && b.kind === 'sleep') respond('唔……星星明天再看吧……');   // 睡着了：和别的家具一样被叫醒迷糊地回一句
    else tell(GAZE_WHY[why] || GAZE_WHY.busy);
    drawPanel(true); return false;
  }
  F.action = (key, action) => {
    const r = live && live.items.get(key); if (!r || blocked()) return false;
    if (r.kind === 'rocker') { sit(r).catch(e => V3.err('furniture.sit: ' + e)); return true; }
    if (r.kind === 'telescope') return telescope(r, action);
    if (r.kind === 'cooker' && (action === 'serve' || action === 'eat')) return mealAction(r, action);
    if (r.kind === 'door') HB().setDoor(key, action);
    else if (r.kind === 'lamp') HB().toggleLamp(key);
    else {
      const before = JSON.stringify(r.state); r.state = F.reduce(r.kind, r.state, action);
      if (before === JSON.stringify(r.state)) return false;
      if (r.kind === 'tv') { tvDraw(r, live.time); tvCompany(r); }
      else {
        // Starting or stopping a pot while she is at her meal must not pull her away from it (respond interrupts a behaviour).
        const a = V3.actor, eating = !!(a && a.behavior && a.behavior.kind === 'eat');
        cookerDraw(r, live.time); (eating ? speak : respond)(({ cook: '开始煮饭啦，等一小会儿。', cancel: '那就先不煮啦。' })[action] || '');
      }
      save();
    }
    drawPanel(true); return true;
  };
  F.activate = target => {
    const key = target && target.obj && target.obj.userData.furnitureKey, r = live && live.items.get(key);
    if (!r || blocked()) return false;
    // 门（2026-11-17）：点一下就开 / 关这扇门，不弹面板
    if (r.kind === 'door') { close(); F.action(key, 'toggle'); return true; }
    open(r);
    if (r.kind === 'tv' && !r.state.on) F.action(key, 'toggle');
    else if (r.kind === 'tv') tvCompany(r);                // 电视开着时点它：也叫她过来一起看
    else if (r.kind === 'cooker' && r.state.phase === 'idle' && !r.state.bowl) F.action(key, 'cook');
    else if (r.kind === 'rocker') F.action(key, 'sit');
    else if (r.kind === 'telescope') F.action(key, 'gaze');
    else if (r.kind === 'lamp') F.action(key, 'toggle');
    return true;
  };
  // Extract only triangles belonging to the appliance from its real MC model.
  // The detached root is drawn exclusively by the hover mask renderer, never the normal scene.
  function applianceOutline(source, anchor, kind, bounds) {
    const limit = kind === 'tv' ? [[-14.01, 13.99, -5.01], [13.01, 32.01, 0.01]] : [[44, 25.9, -7], [56, 33, 5.5]];
    const lo = bounds ? bounds[0] : limit[0].map(v => v / 32), hi = bounds ? bounds[1] : limit[1].map(v => v / 32);
    anchor.updateWorldMatrix(true, false); source.updateWorldMatrix(true, true);
    const inverse = anchor.matrixWorld.clone().invert();
    source.traverse(m => {
      if (!m.isMesh || !m.geometry) return;
      const g = m.geometry, pos = g.attributes.position, index = g.index, keep = [], p = new THREE.Vector3();
      const toLocal = inverse.clone().multiply(m.matrixWorld), n = index ? index.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        const tri = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
        if (tri.every(j => { p.fromBufferAttribute(pos, j).applyMatrix4(toLocal); return [p.x, p.y, p.z].every((v, a) => v >= lo[a] - 1e-5 && v <= hi[a] + 1e-5); })) keep.push(...tri);
      }
      g.setIndex(keep); g.clearGroups(); g.addGroup(0, keep.length, 0);
      m.visible = keep.length > 0; m.raycast = () => {}; delete m.userData.noPick;
    });
    source.userData.hoverOutlineOnly = true;
    source.matrixAutoUpdate = false; source.matrix.copy(source.matrixWorld); source.matrixWorld.copy(source.matrix);
    source.name = 'hover-outline:' + kind;
    return source;
  }
  async function outlineSetup(r, owner) {
    const fm = V3.furnMc, block = r.kind === 'tv' ? 'tv_stand' : 'kitchen_counter';
    const item = HB().furnInstances(block).find(it => it.cell.every((v, i) => v === r.cell[i]));
    if (!item) return;
    const cells = fm.cellsFor(item.f, item.facing).map(c => ({ pos: c.offset.map((v, i) => v + item.cell[i]), state: fm.state(item.f, item.facing, c.part) }));
    const mesh = await HB().meshFor(cells);
    if (owner !== live || owner.ctx.dead) { mesh.visible = false; HB().disposeGroup(mesh); return; }
    r.outline = applianceOutline(mesh, r.root, r.kind);
  }
  // Frame bars can be merged across slots. Clip real triangles, interpolating UV/normal/color,
  // rather than rejecting a long bar or outlining the neighbouring frame with it.
  function clipPhoto(source, box) {
    source.updateWorldMatrix(true, true);
    source.traverse(m => {
      if (!m.isMesh) return;
      const g = m.geometry, attrs = Object.entries(g.attributes), index = g.index, count = index ? index.count : g.attributes.position.count;
      const output = Object.fromEntries(attrs.map(([name]) => [name, []]));
      const vertex = i => { const a = {}; for (const [name, attr] of attrs) a[name] = Array.from({length: attr.itemSize}, (_, k) => attr.array[i * attr.itemSize + k]); return { a, p: new THREE.Vector3(...a.position).applyMatrix4(m.matrixWorld).toArray() }; };
      const lerp = (a, b, t) => ({ p: a.p.map((v,k) => v+(b.p[k]-v)*t), a: Object.fromEntries(attrs.map(([name]) => [name, a.a[name].map((v,k) => v+(b.a[name][k]-v)*t)])) });
      for (let i=0; i<count; i+=3) {
        let poly=[0,1,2].map(j => vertex(index ? index.getX(i+j) : i+j));
        for (let axis=0; axis<3; axis++) for (const side of [0,1]) {
          const bound=(side?box.max:box.min).getComponent(axis), inside=v => side?v.p[axis]<=bound+1e-7:v.p[axis]>=bound-1e-7, next=[];
          for(let j=0;j<poly.length;j++){const a=poly[j],b=poly[(j+1)%poly.length],ia=inside(a),ib=inside(b);if(ia)next.push(a);if(ia!==ib)next.push(lerp(a,b,(bound-a.p[axis])/(b.p[axis]-a.p[axis])));} poly=next;
        }
        for(let j=1;j+1<poly.length;j++)for(const v of [poly[0],poly[j],poly[j+1]])for(const [name]of attrs)output[name].push(...v.a[name]);
      }
      const ng=new THREE.BufferGeometry();for(const [name,attr]of attrs)ng.setAttribute(name,new THREE.Float32BufferAttribute(output[name],attr.itemSize));ng.setIndex(Array.from({length:output.position.length/3},(_,i)=>i));ng.computeBoundingBox();ng.computeBoundingSphere();m.geometry=ng;g.dispose();m.visible=ng.index.count>0;
    });
    source.userData.hoverOutlineOnly=true;source.matrixAutoUpdate=false;source.matrix.copy(source.matrixWorld);return source;
  }
  function photoOutline(target) {
    const data = target.obj && target.obj.userData.photoTarget;
    if (!data || !shown(target.obj) || !V3.photos || !HB().model) return [];
    const owner = live, version = HB().version, key = version + ':' + data.cell.join(',') + ':' + data.slot;
    if (!owner.photos) owner.photos = new Map();
    for (const [k, entry] of owner.photos) if (entry.version !== version) {
      if (entry.mesh) { entry.mesh.visible = false; HB().disposeGroup(entry.mesh); } owner.photos.delete(k);
    }
    let entry = owner.photos.get(key);
    if (!entry) {
      entry = { version, mesh: null }; owner.photos.set(key, entry);
      const frame = V3.photos.frameAt(HB().model, data.cell), fm = V3.furnMc;
      if (!frame || !frame.f) return [];
      const cells = fm.cellsFor(frame.f, frame.facing).map(c => ({ pos: c.offset.map((v, i) => v + frame.cell[i]), state: fm.state(frame.f, frame.facing, c.part) }));
      HB().meshFor(cells).then(mesh => {
        if (live !== owner || owner.ctx.dead || HB().version !== version || owner.photos.get(key) !== entry) { mesh.visible = false; HB().disposeGroup(mesh); return; }
        const geo = V3.photos.slotGeom(frame.f, frame.cell, frame.facing, data.slot);
        if (!geo) { HB().disposeGroup(mesh); return; }
        if (frame.kind === 'wall') {
          const margin = [1, 1, 0.5, 1, 0.5, 1][data.slot] / 16;
          const b = new THREE.Box3().setFromPoints(geo.corners.map(p => new THREE.Vector3(...p)));
          const pad = geo.normal.map(n => n ? 2 / 16 : margin);
          b.min.sub(new THREE.Vector3(...pad)); b.max.add(new THREE.Vector3(...pad));
          entry.mesh = clipPhoto(mesh, b);
        } else {
          mesh.updateWorldMatrix(true, true); mesh.userData.hoverOutlineOnly = true; mesh.matrixAutoUpdate = false; mesh.matrix.copy(mesh.matrixWorld); entry.mesh = mesh;
        }
      }).catch(e => { if (live === owner) V3.err('hover photo: ' + e.message); });
    }
    if (!entry.mesh) return [];
    const planes = target.obj.parent ? target.obj.parent.children.filter(o => o.name === 'photo-plane' && shown(o)) : [];
    return [entry.mesh].concat(planes);
  }
  F.hoverObjects = target => {
    if (target && target.what && !['furniture', 'photo'].includes(target.what)) return null;
    if (!live || live.ctx.dead || blocked()) return [];
    if (target && target.what === 'photo') return photoOutline(target);
    let obj = target && (target.obj || target.object), key = target && target.key;
    for (let o = obj; o && !key; o = o.parent) key = o.userData && o.userData.furnitureKey;
    const r = live.items.get(key); if (!r) return [];
    if (r.kind === 'telescope') return r.outline && r.hit && r.hit.visible ? [r.outline] : [];
    if ((r.kind === 'tv' || r.kind === 'cooker')) {
      if (!r.root || !shown(r.root) || !HB().visibleAt(...r.cell) || !r.outline) return [];
      // The screen/indicator are real visible overlays; the transparent hit proxy is never returned.
      return [r.outline].concat(r.kind === 'tv' && r.screen && shown(r.screen) ? [r.screen] : []);
    }
    return (r.kind === 'rocker' ? [r.mesh] : r.objects).filter(o => o && shown(o));
  };
  F.candidates = () => live ? [...live.items.values()].flatMap(r => r.objects).filter(shown) : [];
  F.state = () => ({ ready: !!live && live.ready, selected, items: live ? [...live.items.values()].map(r => ({ key: r.key, kind: r.kind, cell: r.cell, facing: r.facing, state: r.kind === 'door' || r.kind === 'lamp' ? HB().switchState(r.key) : Object.assign({}, r.state), sitting: !!r.sitting, walking: !!r.walking,
    ...(r.kind === 'telescope' ? { gazing: gazing(r), clickable: !!(r.hit && r.hit.visible) } : {}) })) : [] });
  F.COOK_SECONDS = COOK;
  if (!V3.scene || !V3.scene.part) return;
  V3.scene.part({ id: 'furniture-play', order: 90, build(ctx) {
    const root = new THREE.Group(); root.name = 'furniture-play';
    const owner = live = { ctx, root, items: new Map(), owned: [], ready: false, time: 0, saveT: 0, dirty: true };
    const before = ctx._waits.slice();
    const ready = Promise.all(before).then(async () => {
      if (live !== owner || ctx.dead || !HB().model) return;
      owner.storageKey = F.houseKey(HB().model); let saved = {};
      try { owner.savedText = localStorage.getItem(owner.storageKey); saved = JSON.parse(owner.savedText || '{}') || {}; } catch (_) {}
      const add = (kind, key, cell, facing) => { const r = { kind, key, cell, facing, objects: [], state: normalize(kind, saved[key]), ticket: 0 }; owner.items.set(key, r); return r; };
      const overlays = []; ctx.root.traverse(o => { if (o.userData.cell && ['tv', 'kitchen'].includes(o.userData.furn)) overlays.push(o); });
      for (const o of overlays) {
        const kind = o.userData.furn === 'tv' ? 'tv' : 'cooker', r = add(kind, kind + ':' + o.userData.cell.join(','), o.userData.cell.slice(), o.userData.facing);
        r.root = o; if (kind === 'tv') { tvSetup(r, o); tvDraw(r, 0); } else { cookerSetup(r, o); cookerDraw(r, 0); }
        await outlineSetup(r, owner); if (live !== owner || ctx.dead) return;
      }
      for (const item of HB().furnInstances('rocking_chair')) {
        const r = add('rocker', 'rocker:' + item.cell.join(','), item.cell.slice(), item.facing); await rockerSetup(r, item, owner);
      }
      for (const item of HB().furnInstances('telescope')) {
        const r = add('telescope', 'telescope:' + item.cell.join(','), item.cell.slice(), item.facing); await telescopeSetup(r, item, owner);
        if (live !== owner || ctx.dead) return;
      }
      if (HB().interactions) for (const it of HB().interactions()) { const r = add(it.kind, it.key, it.cell, null); for (const o of it.objects) pickTag(o, r); }
      owner.ready = true;
    });
    ctx.wait(ready); return root;
  }, update(dt, t) {
    const me = live; if (!me || !me.ready) return;
    me.time += dt;
    syncSwitches(me);
    if (me.bowl && me.bowl.cooker) bowlSync(me, dt);   // only while a bowl travels: the meal events start and end that (an idle frame does nothing here)
    for (const r of me.items.values()) {
      if (r.kind === 'tv') tvDraw(r, me.time);
      if (r.kind === 'cooker') {
        // Only a cooking pot changes with time: ticking an idle / ready one just built an identical state object every frame.
        if (r.state.phase === 'cooking') {
          const left = r.state.remaining; r.state = F.reduce('cooker', r.state, 'tick', blocked() ? 0 : dt);
          if (r.state.remaining !== left || r.state.phase !== 'cooking') me.dirty = true;
          if (r.state.phase !== 'cooking') { tell('饭煮好了，点电饭煲盛饭。'); save(); }
        }
        cookerDraw(r, me.time);
      }
      if (r.kind === 'telescope' && r.hit) {
        // 2026-11-15：交互（悬停高亮 / 点击）不再被星况挡住——白天、阴天、雨雪也能点，
        // 点了会由行为可用性给她一句「现在看不到星星」；可见性只跟楼层/布置模式有关。
        const show = HB().visibleAt(...r.cell) && !(V3.arrange && V3.arrange.on);
        if (r.hit.visible !== show) { r.hit.visible = show; if (!show && selected === r.key && !gazing(r)) close(); }
      }
      if (r.kind === 'rocker' && r.pivot) {
        r.pivot.visible = HB().visibleAt(...r.cell) && !(V3.arrange && V3.arrange.on && HB().live() && HB().live().hidden && HB().live().hidden.has(r.cell.join(',')));
        r.pivot.rotation.x = r.sitting ? Math.sin(me.time * 1.8) * 0.055 : 0;
      }
    }
    me.saveT += dt; if (me.saveT > 5) { me.saveT = 0; if (me.dirty) save(); }   // dirty: cooking progress, a failed write, or the first check after load
    drawPanel(false);
  }, dispose(ctx) {
    removeStarInvite(); V3.starView?.close();
    const me = live; if (!me || me.ctx !== ctx) return;
    save(true); close();
    for (const entry of (me.photos || new Map()).values()) if (entry.mesh) { entry.mesh.visible = false; HB().disposeGroup(entry.mesh); }
    if (me.photos) me.photos.clear();
    for (const r of me.items.values()) {
      r.ticket++; if (r.sitting && V3.actor && V3.actor.stand) V3.actor.stand();
      if (r.texture) { r.screen.material.map = null; r.screen.material.emissiveMap = null; r.texture.dispose(); }
      if (r.outline) { r.outline.visible = false; HB().disposeGroup(r.outline); }
      if (r.mesh) HB().disposeGroup(r.mesh);
    }
    for (const o of me.owned) { o.removeFromParent(); o.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }); }
    if (me.bowl) {   // the travelling bowl: off the scene, its geometry and materials freed; the counter dishes shown again
      const b = me.bowl; me.bowl = null;
      b.root.removeFromParent();
      for (const m of b.meshes) m.geometry.dispose();
      for (const x of b.materials) x.dispose();
    }
    for (const r of me.items.values()) if (r.dishes) dishesShow(r, true);
    if (meal && meal.owner === me) meal = null;
    live = null;
  } });
  // She has reached the counter and takes the bowl: serve the pot the button named, else (lunch routine) a bowl that is already
  // served, else a pot that is ready. The reducer only fills an empty bowl from a ready pot, so nothing is served twice.
  V3.on('actor:meal', e => {
    if (!live || !live.ready || !e || e.step !== 'pickup') return;
    let r = meal && meal.owner === live ? live.items.get(meal.key) : null;
    if (!r || r.kind !== 'cooker') {
      r = null; let ready = null;
      for (const c of live.items.values()) if (c.kind === 'cooker') { if (c.state.bowl) { r = c; break; } if (c.state.phase === 'ready' && !ready) ready = c; }
      r = r || ready; meal = r ? { owner: live, key: r.key, user: false, picked: false } : null;
    }
    if (!r) return;
    meal.picked = true; cookerSet(r, 'serve'); bowlSync(live, 0); drawPanel(true);
  });
  // Finished: the bowl is empty. Cancelled: the rice stays where it is (in the pot before the pickup, in the bowl after it).
  // Either way the travelling bowl is gone at once and the counter shows what the state says.
  V3.on('actor:behavior', e => {
    if (!e || e.kind !== 'eat' || (e.phase !== 'completed' && e.phase !== 'cancelled') || !meal) return;
    const link = meal, r = link.owner === live ? live.items.get(link.key) : null; meal = null;
    if (live) bowlSync(live, 0);
    if (!r || r.kind !== 'cooker') return;
    if (e.phase === 'completed') { if (cookerSet(r, 'eat')) speak(link.user ? '吃饱啦，谢谢你陪我吃饭。' : '吃饱啦。'); }
    else if (link.user) tell(r.state.bowl ? '这顿饭被打断了，碗里的饭还在，再点「吃饭」就好。' : '小鲸鱼没走到灶台，饭还在锅里，再点一次就好。');
    drawPanel(true);
  });
  // 她自己到了目镜前才邀请。走开、场景重建或玩家加入时收起入口。
  let starInvite=null;
  function removeStarInvite() { starInvite?.remove(); starInvite=null; }
  V3.on('actor:behavior', e => {
    if(e?.kind!=='stargaze') return;
    removeStarInvite();
    if(e.phase==='cancelled' || e.phase==='completed') { V3.starView?.closeForBehavior(); return; }
    if(e.phase!=='action' || e.together || !live || !V3.starView || !document.body.classList.contains('page-cabin')) return;
    const r=tvNearKind('telescope',e.spot);
    if(r) { starInvite=U.el('button',{class:'star-invite',type:'button',onclick:()=>{if(F.action(r.key,'gaze')) removeStarInvite();}},'一起看星星'); document.body.append(starInvite); }
  });
  // 她自己去看电视（65 的 watch_tv）：坐下开始看的那一刻电视关着就打开（auto），看完 / 被打断时把自己开的那台关掉。
  // 你开的、你碰过的电视不归她管（tvCompany 里 auto = false）
  V3.on('actor:behavior', e => {
    if (!e || e.kind !== 'watch_tv' || !live || !live.ready) return;
    const r = tvNear(e.spot);
    if (!r) return;
    const flip = () => { r.state = F.reduce('tv', r.state, 'toggle'); tvDraw(r, live.time); save(); drawPanel(true); };
    if (e.phase === 'action' && !r.state.on) { flip(); r.auto = true; }
    else if ((e.phase === 'completed' || e.phase === 'cancelled') && r.auto) { r.auto = false; if (r.state.on) flip(); }
  });
  V3.on('arrange', on => { if (on) { close(); if (live) for (const r of live.items.values()) { r.ticket++; r.walking = false; } if (V3.actor && V3.actor.stand) V3.actor.stand(); } });
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => save(true));
})(window.V3);
