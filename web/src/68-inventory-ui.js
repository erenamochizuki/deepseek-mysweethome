// 收集盒里的本机存档工具，不写、不清旧浏览器档。
(function (V3) {
  'use strict';
  const I = V3.cabinInventory, U = V3.util;
  let panel, info, restore, input, busy = false, message = '';
  const empty = () => {
    const x = I.data && I.data.inventory;
    return !!x && (V3.inventoryRules ? V3.inventoryRules.isEmpty(x) : !Object.keys(x.found).length && !Object.keys(x.placements).length && !x.trash && !x.cleaned);
  };
  const button = (s, fn) => U.el('button', { class: 'col-back', type: 'button', onclick: fn }, s);
  function update() {
    if (!panel) return;
    restore.disabled = !I.ready || !empty() || busy;
    restore.title = I.ready && !empty() ? '为了保护现有收藏，只能导入到空存档' : '从小屋收藏备份恢复';
    const bin = V3.cabinTrash;
    const trash = bin && (bin.count() || bin.cleaned()) ? ` · 待清理 ${bin.count()} · 已清理 ${bin.cleaned()}` : '';
    const where = I.remote ? (I.serverV1 ? '收藏保存在这台电脑上（小屋服务还是旧版存档）' : '收藏保存在这台电脑上') : '收藏保存在这个浏览器里';
    info.textContent = message || I.error || (I.ready ? where + trash : '正在读取小屋存档…');
  }
  async function importFile() {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file || busy) return;
    message = '';
    if (!empty()) { message = '只能导入到空存档，现有收藏没有改动。'; return update(); }
    if (file.size > 1024 * 1024) { message = '备份文件太大。'; return update(); }
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { message = '读不懂这份备份，现有收藏没有改动。'; return update(); }
    busy = true;
    update();
    try {
      const r = await I.restore(data);
      message = r.ok ? '收藏备份已恢复。' : r.error;
    } finally { busy = false; update(); }
  }
  V3.inventoryUI = { panel() {
    if (!panel) {
      info = U.el('span', { role: 'status', class: 'col-inventory-info' });
      input = U.el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: importFile });
      restore = button('导入收藏备份', () => input.click());
      panel = U.el('div', { class: 'col-inventory' }, info, restore, input);
    }
    update();
    return panel;
  } };
  V3.on('inventory:status', update);
  V3.on('game:inventory-error', (error) => {
    if (error && V3.hud && V3.hud.toast) V3.hud.toast(error, { color: '#f5aa73', ms: 3500 });
  });
})(window.V3);
