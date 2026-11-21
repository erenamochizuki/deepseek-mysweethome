// 窗台花盆的照料菜单、模型观赏和收集盒手记。存档命令在玩家和她之间共用。
(function (V3) {
  'use strict';
  const el = V3.util.el, rules = V3.inventoryRules, client = V3.cabinInventory;
  const seeds = () => V3.washupCatalog?.seeds || [];
  const inventory = () => client.data?.inventory;
  const zoneOf = inv => rules.gardenZone(inv, V3.env?.astro?.site?.()?.tz);
  const today = inv => rules.gardenDay(Date.now(), zoneOf(inv));
  const names = ['种子', '发芽', '幼苗', '长叶', '花苞', '开花'];
  const seedName = kind => seeds().find(seed => seed.id === kind)?.name || kind;
  const plantName = kind => seedName(kind).replace(/种子$/, '');
  const writable = () => client.canGarden();
  const unavailable = () => client.ready ? '当前存档还不支持窗台花盆。' : client.error || '小屋存档尚未就绪。';
  const errors = { pot_busy: '花盆里已经有一棵植物了。', pot_empty: '花盆还是空的。', no_seed: '这种种子已经用完了。', not_ready: '种子还没长好。', day_changed: '刚换了一天，请再浇一次。' };
  const toast = text => V3.hud.toast(text);
  let pending = false, menu = null, viewer = null;

  function progress(inv) {
    const pot = inv.garden.pot, days = pot.watered.length, stage = rules.gardenStage(days);
    const day = today(inv), planted = rules.gardenDay(pot.plantedAt, zoneOf(inv));
    // 只比较当地的两个日历日期，夏令时的长短日也各算一天。
    const age = Math.max(1, 1 + (Date.parse(day) - Date.parse(planted)) / 86400000);
    const watered = pot.watered.includes(day);
    let next = '花已经开了。';
    if (stage < 5) next = `再浇 ${rules.GARDEN_DAYS[stage] - days} 天就会${names[stage + 1]}。`;
    return { stage, watered, title: plantName(pot.kind) + ' · ' + names[stage],
      record: `种下第 ${age} 天，已浇水 ${days} 天。${watered ? '今天已浇水。' : '今天还没浇水。'}`, next };
  }

  function report(type, id, text, detail) {
    V3.emit('game:cabin-event', { type, id, at: Date.now(), text, detail });
    toast(text);
  }

  async function perform(op, fields = {}) {
    if (pending || !writable()) return { ok: false, applied: false };
    const kind = fields.kind || inventory().garden.pot?.kind;
    const id = client.id(op);
    pending = true;
    try {
      refresh();
      const result = await client.perform({ op, id, ...fields });
      if (!result.ok) { toast(errors[result.code] || result.error || '这次没有存好，请再试一次。'); return result; }
      if (!result.applied) return result;
      // 另一页可能刚换过植物；以这次命令确认的快照为准。
      const actual = result.kind || result.inventory?.garden?.pot?.kind || kind, name = plantName(actual);
      const by = fields.by || 'player', detail = { kind: actual, by };
      if (op === 'garden_plant') report(op, id, `你在窗台花盆里种下了一颗${seedName(actual)}。`, detail);
      if (op === 'garden_water') {
        const waterDetail = { ...detail, day: fields.day, zone: fields.zone };
        report(op, id, `${by === 'girl' ? '她' : '你'}给窗台上的${name}浇了水。`, waterDetail);
        // 同一个操作产生两条日志，分别给它们稳定的事件编号。
        if (result.firstBloom) report('garden_bloom', id + '-bloom', `窗台上的${name}第一次开花了。`, waterDetail);
      }
      if (op === 'garden_harvest') report(op, id, `你收下了 ${result.gained} 颗${seedName(actual)}。`, { ...detail, gained: result.gained });
      if (op === 'garden_clear') toast('花盆已经腾空了。');
      return result;
    } finally { pending = false; refresh(); }
  }

  // 她到窗台才调用；和玩家共用存档响应的 ok / applied 语义。
  async function water(by = 'player') {
    if (!writable() || !['player', 'girl'].includes(by)) return { ok: false, applied: false };
    const inv = inventory(), pot = inv.garden.pot, zone = zoneOf(inv), day = rules.gardenDay(Date.now(), zone);
    if (!pot) return { ok: false, applied: false, code: 'pot_empty' };
    if (pot.watered.includes(day)) return { ok: true, applied: false };
    return perform('garden_water', { zone, day, by });
  }

  function picture(kind, stage, silhouette, size) {
    if (!V3.gardenModels || !V3.shellIcons) return null;
    const src = V3.shellIcons.get(`window-garden:${kind}:${stage}`, { size, silhouette,
      build: () => V3.gardenModels.build(kind, stage), view: { az: 2.92, el: .32 } });
    return el('img', { src, alt: silhouette ? '植物剪影' : plantName(kind), draggable: 'false' });
  }

  function updateView() {
    const inv = inventory(), pot = inv?.garden?.pot;
    if (!pot) { V3.hud.closeModal('windowGarden'); return; }
    const p = progress(inv), v = viewer;
    v.title.textContent = p.title; v.record.textContent = p.record; v.next.textContent = p.next;
    if (pot.kind === v.kind && p.stage === v.stage) return;
    v.kind = pot.kind; v.stage = p.stage;
    if (v.orbit) v.orbit.reload();
    else v.orbit = V3.modelOrbit.mount(v.host, { view: { az: 2.92, el: .32 },
      build: () => V3.gardenModels.build(v.kind, v.stage), label: () => v.title.textContent,
      still: () => picture(v.kind, v.stage, false, 384) });
  }

  function inspect() {
    if (!inventory()?.garden?.pot) return;
    V3.shore.close();
    const title = el('strong', { id: 'garden-view-title' }), host = el('div', { class: 'garden-orbit' });
    const record = el('p'), next = el('p'), close = el('button', { class: 'hud-x', type: 'button', 'aria-label': '关闭', onclick: () => V3.hud.closeModal('windowGarden') }, '×');
    const dialog = el('section', { class: 'garden-view', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title.id },
      el('header', {}, title, close), host, el('footer', {}, record, next));
    V3.hud.modal(dialog, { name: 'windowGarden', onClose: () => { viewer?.orbit?.dispose(); viewer = null; } });
    viewer = { host, title, record, next }; updateView(); close.focus();
  }

  function drawMenu({ body, text }) {
    const inv = inventory(), pot = inv?.garden?.pot;
    const action = (key, label, fn, disabled = false) => body.append(el('button', { type: 'button', 'data-garden-action': key, disabled: pending || disabled, onclick: fn }, label));
    if (!writable()) { text(unavailable()); return; }
    if (!pot) {
      menu.confirm = null;
      const owned = seeds().filter(seed => inv.garden.seeds[seed.id] > 0);
      text(owned.length ? '花盆空着，土已经松好了。' : '花盆空着。等潮水送来种子，就能种下第一棵了。');
      if (owned.length) {
        if (!owned.some(seed => seed.id === menu.kind)) menu.kind = owned[0].id;
        body.append(el('select', { 'aria-label': '选择种子', disabled: pending, onchange: e => { menu.kind = e.target.value; } },
          owned.map(seed => el('option', { value: seed.id, selected: seed.id === menu.kind }, `${seed.name} × ${inv.garden.seeds[seed.id]}`))));
      }
      action('plant', '种下一颗种子', () => perform('garden_plant', { kind: menu.kind }), !owned.length);
      return;
    }
    const identity = pot.kind + ':' + pot.plantedAt;
    if (menu.confirm === identity) {
      text(`要把${plantName(pot.kind)}移出花盆吗？种下的种子不会退回。`);
      action('cancel', '留下它', () => { menu.confirm = null; refresh(); });
      action('confirm-clear', '确认清空', () => perform('garden_clear'));
      return;
    }
    menu.confirm = null;
    const p = progress(inv);
    body.append(el('strong', { class: 'garden-plant-name' }, p.title)); text(p.record);
    text(p.stage === 5 ? (rules.gardenReady(pot) ? '种子熟了，可以收了。' : '花后每浇满三天，可以收一回种子。') : p.next);
    action('water', p.watered ? '今天已浇水' : '浇水', () => water('player'), p.watered);
    action('inspect', '看看', inspect);
    action('harvest', '收种子', () => perform('garden_harvest'), !rules.gardenReady(pot));
    action('clear', '换一棵', () => { menu.confirm = identity; refresh(); });
  }

  function open() {
    V3.hud.closeModal(); V3.shore.close();
    menu = { kind: null, confirm: null };
    V3.shore.open('窗台花盆', drawMenu, () => { menu = null; });
    V3.shore.panel.dataset.subject = 'windowGarden';
    V3.shore.panel.querySelector('button').focus({ preventScroll: true });
  }
  function refresh() {
    if (menu) V3.shore.redraw();
    if (viewer) updateView();
  }
  V3.on('inventory:status', refresh); V3.on('game:inventory', refresh);
  // 面板跨午夜留在屏幕上时，也要重新开放当天的浇水按钮。
  let checked = 0, lastDay = '';
  V3.on('frame', () => {
    if ((!menu && !viewer) || !writable() || performance.now() - checked < 1000) return;
    checked = performance.now(); const day = today(inventory());
    if (lastDay && day !== lastDay) refresh(); lastDay = day;
  });
  V3.on('game:open', () => { if (menu) V3.shore.close(); });
  window.addEventListener('keydown', event => {
    if (menu && event.key === 'Escape') { event.preventDefault(); V3.shore.close(); }
  });

  function journal(body) {
    const inv = inventory(), garden = inv?.garden, catalog = seeds();
    const stock = el('ul', { class: 'garden-stock' }), entries = el('div', { class: 'garden-entries' });
    let blooms = 0;
    for (const seed of catalog) {
      const first = garden?.bloomed?.[seed.id], bloomed = Number.isFinite(first);
      const seen = bloomed || garden?.seen?.includes(seed.id), count = garden?.seeds?.[seed.id] || 0;
      if (seen || count) stock.append(el('li', { 'data-kind': seed.id }, seed.name, el('b', {}, `× ${count}`)));
      if (bloomed) blooms++;
      const state = bloomed ? 'bloomed' : seen ? 'seen' : 'unseen';
      const date = bloomed ? rules.gardenDay(first, zoneOf(inv)) : null;
      entries.append(el('article', { class: 'garden-entry', 'data-kind': seed.id, 'data-state': state },
        el('div', { class: 'garden-plate' }, picture(seed.id, 5, !bloomed, 208)),
        el('div', {}, el('h3', {}, seen ? plantName(seed.id) : '未知的植物'),
          el('p', {}, bloomed ? seed.flower : seed.hint),
          date ? el('time', { datetime: date }, `初花 · ${date}`) : seen ? el('small', {}, '已拾到种子，待开花。') : null)));
    }
    if (!stock.childElementCount) stock.append(el('li', {}, garden ? '还没有拾到种子。' : unavailable()));
    body.replaceChildren(el('section', { class: 'garden-seeds', 'aria-label': '种子余量' }, el('h3', {}, '种子余量'), stock), entries);
    return { known: garden ? blooms : '—', total: catalog.length };
  }
  V3.windowGarden = { open, water, journal };
})(window.V3);
