(function (V3) {
  'use strict';
  const rules = V3.inventoryRules, client = V3.cabinInventory, element = V3.util.el;
  const inventory = () => client.data?.inventory, shore = () => inventory()?.shore;
  const toast = text => V3.hud?.toast?.(text);
  const name = kind => V3.game?.kind(kind)?.name || kind;
  let identityVersion, identity;
  function houseId() {
    const blocks = V3.houseBlocks;
    if (!blocks?.model || !V3.furniturePlay?.houseKey) return 'default';
    if (!identity || identityVersion !== blocks.version) {
      identity = V3.furniturePlay.houseKey(blocks.localModel()).split(':').at(-1); identityVersion = blocks.version;
    }
    return identity;
  }
  const handlers = new Map(); let panel, drawPage, onDismiss, pending = false, scene, trial, selectedLoanUid, worn;
  const close = () => { panel?.remove(); const done = onDismiss; onDismiss = panel = drawPage = null; trial = selectedLoanUid = null; done?.(); };
  function open(title, draw, dismiss) {
    close(); drawPage = draw; onDismiss = dismiss;
    panel = element('section', { class: 'furniture-panel shore-panel', role: 'dialog', 'aria-label': title },
      element('div', { class: 'fp-heading' }, element('strong', null, title), element('button', { type: 'button', 'aria-label': '关闭', onclick: close }, '×')),
      element('div', { class: 'shore-body' })); document.body.append(panel); redraw();
  }
  function redraw() {
    if (!panel) return;
    const body = panel.lastElementChild; body.replaceChildren();
    const text = value => body.append(element('p', null, value));
    const button = (title, fn, disabled = false) => body.append(element('button', { type: 'button', disabled: pending || disabled, onclick: fn }, title));
    drawPage({ body, text, button });
  }
  async function save(op, args, message, afterWrite) {
    if (pending) return false;
    pending = true; redraw();
    try {
      const result = await client.perform({ op, id: client.id(op), ...args });
      if (!result.ok) toast(result.error); else if (result.applied !== false) { if (message) toast(message); afterWrite?.(); }
      return result.ok;
    } finally { pending = false; redraw(); }
  }
  function tag(obj, key) { Object.assign(obj.userData, { clickable: key, clickAlways: true, layer: 'site' }); return obj; }
  function giftClock(at = Date.now()) {
    const gift = shore()?.gift, zone = gift?.zone || V3.env?.astro.site().tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const slot = rules.halfDay(at, zone); return { zone, slot, due: !gift || gift.slot < slot };
  }
  function owned(uid) {
    if (uid) for (const kind of rules.SHELL_LOANS) {
      const row = inventory()?.found[kind]?.items.find(item => item.uid === uid); if (row) return { kind, ...row };
    }
    return null;
  }
  const label = item => item ? `${rules.pattern(item.pat).name} · ${name(item.kind)}（${item.size} 毫米）` : '它自己的素壳';
  function hermitPage({ text, button, body }) {
    const current = shore()?.loan || null;
    text('它的住处：' + label(owned(current)) + '。');
    body.append(element('details', null, element('summary', null, `它能住哪些壳？（${rules.SHELL_LOANS.length} 种）`),
      element('p', null, rules.SHELL_LOANS.map(name).join('、') + '。')));
    if (!client.canShore()) { text('可以观察；存档尚未就绪或小屋服务需要升级。'); return; }
    const choices = rules.SHELL_LOANS.flatMap(kind => client.available(kind).map(item => ({ kind, ...item })));
    if (trial && !choices.some(item => item.uid === trial.uid)) trial = null;
    if (choices.length) {
      const selected = choices.find(item => item.uid === selectedLoanUid) || choices[0];
      const select = element('select', { 'aria-label': '选择一枚空螺' });
      for (const item of choices) select.append(element('option', { value: item.uid, selected: item === selected }, label(item)));
      select.onchange = () => { selectedLoanUid = select.value; trial = null; redraw(); body.querySelector('select')?.focus(); };
      body.append(select);
      if (trial) text('正在试穿：' + label(trial) + '。点「借给它」才算借出。');
      button('试这枚', () => { trial = owned(select.value); scene.tryTime = 0; redraw(); });
      button('借给它', async () => {
        if (!trial || trial.uid !== select.value) { toast('先让它试试这枚壳。'); return; }
        if (await save('shore_loan', { next: trial.uid, expected: current }, '它背着新壳走了两步。')) trial = null;
        redraw();
      }, !trial || trial.uid !== selected.uid);
    } else text('手里还没有空闲的合适螺壳。可以去潮线找，也可以先把摆出去的那一枚收回来。');
    if (current) button('收回借出的壳', async () => { if (await save('shore_loan', { next: null, expected: current }, '原来那枚壳已回到收藏盒。')) trial = null; });
  }
  function bulletin() {
    const clock = giftClock(), wx = V3.wx?.now?.() || {}, epoch = rules.encounter(Date.now());
    return `${wx.storm > .4 ? '雷雨，泳区关闭' : wx.snow > .1 ? '落雪，干沙正慢慢变白' : '浅海可观鱼'} · 鱼讯：${rules.FISH[rules.fishAt(epoch)]} · 下班贝币 ${clock.slot.endsWith('/am') ? '12:00' : '明日 00:00'}（${clock.zone}）`;
  }
  function memoryFile(memory) {
    const portrait = V3.shellIcons.shot(() => { const model = V3.shoreModels.build('hermit', .04); V3.shoreModels.wear(model, memory.kind, memory.pat); return model; },
      { size: 128, view: { az: 2.6, el: .35 }, bg: '#e9debe' });
    const bytes = Uint8Array.from(atob(portrait.split(',')[1]), char => char.charCodeAt(0));
    return new File([bytes], '邻居·' + name(memory.kind) + '·' + rules.pattern(memory.pat).name + '.png', { type: 'image/png' });
  }
  function exhibit(slot, obj) {
    const placed = inventory()?.placements[slot], item = placed && inventory().found[placed.kind]?.items.find(row => row.uid === placed.uid);
    if (!item) return;
    V3.R?.ctl?.set?.({ target: obj.getWorldPosition(new THREE.Vector3()).toArray(), dist: 2.7 }, true);
    const words = `这枚${name(placed.kind)}是${rules.pattern(item.pat).name}的，有 ${item.size} 毫米呢。`;
    if (!V3.actor || V3.actor.behavior || !['idle','wander'].includes(V3.actor.state) || !V3.actor.say?.(words)) toast(words);
  }
  const api = V3.shore = { open, close, redraw, save, shore, tag, toast, bulletin, memoryFile, label, exhibit, giftClock, houseId,
    register: (key, description, act, enabled = () => true) => handlers.set(key, { description, act, enabled }),
    knows: key => handlers.has(key), labelFor: key => handlers.get(key)?.description,
    actionable: key => !!handlers.get(key)?.enabled(), act: (key, ...args) => { const handler = handlers.get(key); if (!handler?.enabled()) return false; handler.act(...args); return true; },
    get panel() { return panel; },
    get state() { return scene && { delivery: scene.delivery, slot: scene.slot, trial: trial?.uid, den: scene.den, coin: scene.coin }; } };
  api.register('hermit', '石堆寄居蟹 · 观察 / 试壳', () => open('石堆里的邻居', hermitPage));
  api.register('featuredShell', '今日展品 · 一起看花纹', target => { if (target) exhibit(target.userData.shellDecorSlot, target); });
  api.register('crabCoin', '小螃蟹的礼物 · 拾起一枚贝币', async () => {
    const { zone, slot, due } = giftClock();
    if (due && slot === scene.slot) await save('shore_gift', { zone, slot }, '叮！小螃蟹送了你 1 枚贝币。', () => V3.chimes?.coin?.());
  }, () => scene?.delivery === 'dropped' && client.canShore() && !pending && giftClock().due);
  const paint = color => new THREE.MeshStandardMaterial({ color, roughness: .72 });
  function build() {
    const den = V3.terrain.hermitDen, root = new THREE.Group(), crab = V3.shoreModels.build('hermit', .038), coin = new THREE.Group();
    root.name = 'shore-neighbors'; tag(crab, 'hermit'); tag(coin, 'crabCoin');
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(.102, .102, .032, 12), paint(0xedba5c));
    const inset = new THREE.Mesh(new THREE.TorusGeometry(.071, .008, 4, 12), paint(0xffe5a0)); inset.position.z = .019; disc.rotation.x = Math.PI / 2;
    coin.add(disc, inset); coin.visible = false; root.add(coin);
    if (den) { crab.rotation.y = Math.PI; root.add(crab); }
    const legs = ['leg_left_1','leg_left_2','leg_right_1','leg_right_2'].map(key => crab.getObjectByName(key));
    scene = { coin, crab, den, legs, body: crab.getObjectByName('body'), claw: crab.getObjectByName('claw_right'),
      delivery: 'waiting', dropFrom: new THREE.Vector3(), dropTo: new THREE.Vector3(), slot: '', next: 0, near: .75, tryTime: 10 }; worn = null; return root;
  }
  function update(delta, time) {
    if (!scene) return;
    const { coin, crab, den } = scene;
    if (den) {
      const key = trial?.uid || shore()?.loan || '';
      if (worn !== key || scene.wearRev !== client.data?.rev) {
        const item = trial || owned(key); V3.shoreModels.wear(crab, item?.kind, item?.pat); worn = key; scene.wearRev = client.data?.rev;
      }
      scene.tryTime += delta;
      const want = trial || shore()?.loan || drawPage === hermitPage ? 1 : .75 + .16 * Math.sin(time * .55);
      scene.near += (want - scene.near) * Math.min(1, delta * 2.2);
      const back = den.frontZ - (den.cells.size / 2 - .5) * V3.terrain.CELL + .05;
      const step = scene.near * (den.frontZ + .48 - back), depth = Math.sin(Math.PI * Math.min(1, scene.tryTime / 1.3));
      const shuffle = scene.tryTime < 2.4 && scene.near > .74 ? Math.sin(scene.tryTime * Math.PI / .6) * .055 : 0;
      crab.position.set(den.x + shuffle, V3.terrain.seabedY(den.x, back + step) + .012, back + step);
      scene.body.scale.y = 1 - .19 * depth;
      scene.claw.rotation.x = depth * .4 + .05 * Math.sin(time * 2);
      const stride = Math.sin(step * 22 + scene.tryTime * 7) * (Math.abs(want - scene.near) * .22 + Math.abs(shuffle));
      scene.legs.forEach((leg,index) => { leg.rotation.x = index === 0 || index === 3 ? stride : -stride; });
    }
    const courier = V3.sealife?.crab;
    if (!courier || !client.canShore()) { coin.visible = false; return; }
    if (performance.now() >= scene.next || scene.rev !== client.data.rev) {
      scene.next = performance.now() + 350; scene.rev = client.data.rev;
      const { slot, due } = giftClock();
      if (slot !== scene.slot || due !== scene.due) { scene.slot = slot; scene.due = due; scene.delivery = due ? 'waiting' : 'claimed'; coin.visible = false; }
    }
    if (!scene.due) return;
    const pose = courier.now(), plan = courier.plan;
    if (scene.delivery === 'waiting') {
      if (pose.k === 'hide') scene.delivery = 'carrying';
      else if (!courier.state().startled && courier.canStartle()) courier.startle({ hide: 1.2 });
    }
    if (scene.delivery === 'carrying') {
      coin.visible = pose.k !== 'hide'; coin.position.copy(courier.rightClawGrip); coin.rotation.y = pose.yaw;
      if (pose.z <= plan.MZ + .04) {
        scene.delivery = 'placing'; scene.dropFrom.copy(coin.position); scene.dropYaw = pose.yaw; scene.release = 0;
        scene.dropTo.set(plan.HX, V3.terrain.groundY(plan.HX, plan.MZ - .39) + .14, plan.MZ - .39);
      }
    } else if (scene.delivery === 'placing') {
      scene.release = Math.min(1, scene.release + delta / .65);
      const progress = scene.release, ease = progress * progress * (3 - 2 * progress);
      coin.position.lerpVectors(scene.dropFrom, scene.dropTo, ease); coin.position.y += .045 * Math.sin(Math.PI * progress);
      coin.rotation.y = scene.dropYaw + .65 * ease;
      if (progress === 1) { scene.delivery = 'dropped'; scene.restAt = time; }
    }
    if (scene.delivery === 'dropped') {
      const resting = Math.max(0, time - scene.restAt);
      coin.visible = true; coin.position.copy(scene.dropTo); coin.position.y += .018 * Math.sin(resting * 3);
      coin.rotation.y = scene.dropYaw + .65 + resting * .8;
    }
  }
  V3.on('arrange', on => { if (on) close(); });
  V3.scene?.part({ id: 'shore-neighbors', order: 71, build, update, dispose() { close(); scene = null; } });
})(window.V3);
