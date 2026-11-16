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
  const allowed = (id) => { const k = kind(id); return !!k && (k.category === 'collectible' ? k.decoratable === true : !k.category); };
  const available = (id) => {
    const f = I.data && I.data.inventory.found[id];
    return f ? f.n - Object.values(placements()).filter((p) => p.kind === id).length : 0;
  };
  const label = (slot) => (slots().find((s) => s.id === slot) || {}).label || labels[slot] || '旧摆放点';
  const windowDelay = () => Math.max(0, Number(V3.store.get('cabinDecorNext', 0)) || 0);
  const holdWindow = () => V3.store.set('cabinDecorNext', Date.now() + WINDOW_MS);
  const fail = (error) => ({ ok: false, error });
  function emit(type, op, item, slot, by) {
    const name = (kind(item) || {}).name || item;
    const who = by === 'girl' ? '她' : '你';
    const point = label(slot);
    const text = type === 'shell_place' ? `${who}把${name}摆在${point}` : `${who}把${point}的${name}收回了柜子`;
    const event = type === 'shell_place' && by === 'girl' && slot === WINDOW ? 'window_display' : type;
    V3.emit('game:cabin-event', { type: event, id: op.id, at: Date.now(), text, detail: { kind: item, name, slot, by } });
  }
  async function place(item, slotId, by = 'player') {
    const slot = slots().find((s) => s.id === slotId);
    if (!slot || V3.arrange && V3.arrange.on) return fail('现在不能在这个位置摆放');
    if (!allowed(item) || available(item) < 1) return fail('柜子里没有可摆出的这一种');
    if (placements()[slotId]) return fail('这里已经摆了东西');
    const op = { op: 'place', id: I.id('place'), kind: item, slot: slotId, by };
    if (slot.floor) op.returnAt = Date.now() + FLOOR_MS;
    const r = await I.perform(op);
    if (r.ok && r.applied !== false) { if (slotId === WINDOW) holdWindow(); emit('shell_place', op, item, slotId, by); }
    return r;
  }
  async function putAway(slot, by = 'player', expected) {
    const p = placements()[slot];
    if (!p || expected && p.id !== expected) return fail('这个位置的摆件已经变了');
    const op = { op: 'return', id: I.id('return'), slot, by, expectedId: p.id };
    const r = await I.perform(op);
    if (r.ok && r.applied !== false) { if (slot === WINDOW) holdWindow(); emit('shell_return', op, p.kind, slot, by); }
    return r;
  }
  const A = V3.shellControls = { place, putAway, slots, placements, available, label, busy: false };
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
        const r = old ? await putAway(target.id, 'girl', old.id) : await place(item, target.id, 'girl');
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
  A.detail = (id) => {
    if (!I.enabled || !allowed(id)) return null;
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
    const current = placements(), labelsById = Object.keys(current).filter((slot) => current[slot].kind === id);
    for (const slot of labelsById) add(`从${label(slot)}收回`, () => putAway(slot));
    if (available(id)) for (const slot of slots()) if (!current[slot.id]) {
      add(`摆到${slot.label}`, () => place(id, slot.id), !I.ready);
    }
    return content;
  };
})(window.V3);
