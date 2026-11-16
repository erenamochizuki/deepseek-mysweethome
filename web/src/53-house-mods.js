// 53-house-mods.js — 从实际使用的方块状态判断房子需要哪些模组；不读取 Metadata 或资源包。
(function (V3) {
  'use strict';

  const BUILTIN = 'xiaojingyu';

  // model 是已通过鲸图解码或校验的模型（cells 是 palette 下标）。
  // instanceModIds 只传当前关联实例声明的 ID（Set 或数组）；返回的两个列表均去重、排序。
  function getModDependencies({ palette, cells }, instanceModIds) {
    const mods = new Set();
    const seen = new Uint8Array(palette.length);
    for (let i = 0; i < cells.length; i++) {
      const id = cells[i];
      if (seen[id]) continue;
      seen[id] = 1;
      const state = palette[id];
      // 与 FORMAT.md §3.1 及编解码器一致：只看 '[' 前的命名空间；没有 ':' 就是原版。
      const colon = state.indexOf(':'), bracket = state.indexOf('[');
      if (colon < 0 || (bracket >= 0 && colon > bracket)) continue;
      const ns = state.slice(0, colon);
      if (ns !== 'minecraft') mods.add(ns);
    }
    const available = instanceModIds instanceof Set ? instanceModIds : new Set(Array.isArray(instanceModIds) ? instanceModIds : []);
    const required = [...mods].sort();
    const missing = required.filter((id) => id !== BUILTIN && !available.has(id));
    return { required, missing };
  }

  V3.houseMods = { getModDependencies };
})(window.V3);
