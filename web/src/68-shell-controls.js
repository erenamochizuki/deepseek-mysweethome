// Shared operations for the collection UI and the whale's idle-time decorating.
(function (V3) {
  'use strict';
  const I = V3.cabinInventory, U = V3.util;
  const WINDOW = 'loft-window', FLOOR_MS = 10 * 60 * 1000, WINDOW_MS = 15 * 60 * 1000;
  const labels = { [WINDOW]: '阁楼窗台', 'coffee-table': '矮桌', 'ground-floor': '一楼地板', 'loft-floor': '阁楼地板' };
  const favorites = ['rainbow_abalone', 'nautilus', 'pearl', 'scallop', 'moon', 'cowrie'];
  const slots = () => V3.shellDecor ? V3.shellDecor.slots() : [];
  const placements = () => I.data ? I.data.inventory.placements : {};
  const kind = (id) => V3.game.kind(id);
  const allowed = (id) => V3.inventoryRules.decoratable(kind(id));
  // 能摆出去的几枚（没摆着、没放进展示盒）
  const freeItems = (id) => (I.available ? I.available(id) : []);
  const available = (id) => freeItems(id).length;
  // 她挑的那一枚：稀有花纹优先，其次最大的
  const nicest = (id) => {
    const R = V3.inventoryRules, rare = (it) => (R && R.pattern(it.pat).rare ? 1 : 0);
    return freeItems(id).slice().sort((a, b) => rare(b) - rare(a) || b.size - a.size)[0] || null;
  };
  const label = (slot) => slot.startsWith('case:') ? V3.shellCaseSlots?.().find(row => row.id === slot)?.name || '原展柜' : (slots().find((s) => s.id === slot) || {}).label || labels[slot] || '旧摆放点';
  const windowDelay = () => Math.max(0, Number(V3.store.get('cabinDecorNext', 0)) || 0);
  const holdWindow = () => V3.store.set('cabinDecorNext', Date.now() + WINDOW_MS);
  const fail = (error) => ({ ok: false, error });
  function emit(type, op, item, slot, by, uid) {
    const name = (kind(item) || {}).name || item;
    const who = by === 'girl' ? '她' : '你';
    const point = label(slot);
    const text = type === 'shell_place' ? `${who}把${name}摆在${point}` : `${who}把${point}的${name}收回了柜子`;
    const event = type === 'shell_place' && by === 'girl' && slot === WINDOW ? 'window_display' : type;
    V3.emit('game:cabin-event', { type: event, id: op.id, at: Date.now(), text, detail: { kind: item, name, slot, by, ...(uid ? { uid } : {}) } });
  }
  async function place(item, slotId, by = 'player', uid) {
    const slot = slots().find((s) => s.id === slotId);
    if (!slot || V3.arrange && V3.arrange.on) return fail('现在不能在这个位置摆放');
    if (!allowed(item) || available(item) < 1) return fail('柜子里没有可摆出的这一种');
    if (placements()[slotId]) return fail('这里已经摆了东西');
    if (uid && !freeItems(item).some((it) => it.uid === uid)) return fail('这一枚正摆在别处');
    const op = { op: 'place', id: I.id('place'), kind: item, slot: slotId, by, ...(uid ? { uid } : {}) };
    if (slot.floor) op.returnAt = Date.now() + FLOOR_MS;
    const r = await I.perform(op);
    if (r.ok && r.applied !== false) { if (slotId === WINDOW) holdWindow(); emit('shell_place', op, item, slotId, by, r.uid || uid); }
    return r;
  }
  async function putAway(slot, by = 'player', expected) {
    const p = placements()[slot];
    if (!p || expected && p.id !== expected) return fail('这个位置的摆件已经变了');
    const op = { op: 'return', id: I.id('return'), slot, by, expectedId: p.id };
    const r = await I.perform(op);
    if (r.ok && r.applied !== false) { if (slot === WINDOW) holdWindow(); emit('shell_return', op, p.kind, slot, by, p.uid); }
    return r;
  }
  const A = V3.shellControls = { place, putAway, slots, placements, available, freeItems, nicest, label, busy: false };
  let mountedAt = 0, nextAttempt = 0;
  function stillHere(a) {
    return a === V3.actor && !document.hidden && !a.held && !(V3.arrange && V3.arrange.on) &&
      (!V3.env || V3.env.state.wx.kind !== 'storm');
  }
  A.consider = () => {
    const now = Date.now(), a = V3.actor, g = V3.game;
    if (!I.ready || !a || !g || !g.hosted || g.S.girlAuto === false || !g.auto || A.busy || now < nextAttempt ||
        !stillHere(a) || a.state !== 'idle' || a._dbg && a._dbg.manual) return false;
    const list = slots(), occupied = placements();
    let target = list.find((s) => s.floor && occupied[s.id] && occupied[s.id].returnAt && now >= occupied[s.id].returnAt);
    const old = target && occupied[target.id];
    let item;
    if (!target) {
      if (!mountedAt || now - mountedAt < 45000 || now < windowDelay() || occupied[WINDOW]) return false;
      target = list.find((s) => s.id === WINDOW);
      item = favorites.concat(Object.keys(I.data.inventory.found).sort()).find((id) => allowed(id) && available(id) > 0);
    }
    if (!target || (!old && !item)) return false;
    nextAttempt = now + 20000;
    A.busy = true;
    void (async () => {
      try {
        const [x, y, z] = target.approach;
        const here = a.pos;
        const arrived = here && Math.hypot(here[0] - x, here[1] - y, here[2] - z) < .12 || await a.goto(x, z, y);
        if (!arrived || !stillHere(a) || a.state !== 'idle') return;
        const current = slots().find((s) => s.id === target.id);
        if (!current || current.approach.some((v, i) => Math.abs(v - target.approach[i]) > 0.05)) return;
        const pickOne = item && nicest(item);
        const r = old ? await putAway(target.id, 'girl', old.id) : await place(item, target.id, 'girl', pickOne ? pickOne.uid : undefined);
        if (r.ok && r.applied !== false) {
          nextAttempt = Date.now() + 6000;
          if (stillHere(a) && a.state === 'idle') a.say(old ? '这只放回柜子里，地板就干净啦。' : '这只放在窗边，光照下来好好看。', 'happy');
        }
      } catch (e) { /* autonomy can safely retry on a later idle cycle */ }
      finally { A.busy = false; }
    })();
    return true;
  };
  V3.on('ready', () => { if (V3.game && V3.game.hosted) mountedAt = Date.now(); });
  // 收集盒详情里的按钮：给了 uid 就只管这一枚（收回 / 摆到哪）
  A.detail = (id, uid) => {
    if (!I.enabled || !allowed(id) && !V3.shellCaseSlots) return null;
    const content = U.el('div', { class: 'col-decor' });
    const add = (text, fn, disabled) => content.append(U.el('button', {
      type: 'button', class: 'col-back', disabled,
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        const r = await fn();
        if (!r.ok) V3.emit('game:inventory-error', r.error);
        if (e.target.isConnected) e.target.disabled = false;
      },
    }, text));
    const current = placements();
    for (const [slot, design] of Object.entries(I.data?.inventory.chimes || {})) {
      if (design.strands.some(row => row.some(b => b.uid === uid))) add('从' + V3.inventoryRules.CHIME_SLOTS[slot].name + '取下', () =>
        I.setChime(slot, { ...design, strands: design.strands.map(row => row.filter(b => b.uid !== uid)) }));
    }
    const mine = Object.keys(current).filter((slot) => current[slot].kind === id && (!uid || current[slot].uid === uid));
    for (const slot of mine) add(`从${label(slot)}收回`, () => putAway(slot));
    const free = uid ? freeItems(id).some((it) => it.uid === uid) : available(id) > 0;
    if (free && allowed(id)) for (const slot of slots()) if (!current[slot.id]) {
      add(`摆到${slot.label}`, () => place(id, slot.id, 'player', uid), !I.ready);
    }
    const cases = free && uid && I.canShore?.() ? (V3.shellCaseSlots?.() || []).filter(row => !current[row.id]).sort((left,right) => Number(right.empty) - Number(left.empty)) : [];
    if (cases.length) {
      const select = U.el('select', { 'aria-label': '今日展品的位置' });
      for (const row of cases) select.append(U.el('option', { value: row.id }, row.name + (row.empty ? '（空格）' : '（自动陈列）')));
      content.append(select);
      add('设为今日展品', () => !V3.shellCaseSlots().some(row => row.id === select.value) || V3.arrange?.on ? fail('展柜已经搬走了') : I.perform({ op: 'place', id: I.id('exhibit'), kind: id, uid, slot: select.value, by: 'player' }));
    }
    return content;
  };
})(window.V3);
