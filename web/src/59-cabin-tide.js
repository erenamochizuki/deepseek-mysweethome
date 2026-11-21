// Ordinary finds have weather affinities; ultra-rare finds have weather windows.
(function (V3) {
  'use strict';
  // hit ×, common ×, uncommon ×, rare ×, separate litter chance.
  const rows = {
    baseline: [1, 1, 1, 1, .09], clear: [.9, 1.15, .95, .8, .07], cloudy: [1, 1, 1.05, 1, .09],
    overcast: [1.1, 1.05, 1.1, 1, .13], fog: [.88, 1, 1.2, 1.15, .10], drizzle: [1.08, 1, 1.16, 1.2, .13],
    rain: [1.28, .96, 1.26, 1.4, .18], storm: [1.55, .9, 1.4, 1.8, .24], snow: [.7, 1.1, .9, 1, .06],
  };
  const tiers = ['common', 'uncommon', 'rare', 'ultra'];
  const defaultUltraWeight = 1;
  const rule = (wx) => Object.hasOwn(rows, wx) ? rows[wx] : rows.baseline;
  function weighted(choices, weight, random) {
    if (!choices.length) return null;
    let remainder = random() * choices.reduce((n, c) => n + weight(c), 0);
    for (const c of choices) { remainder -= weight(c); if (remainder < 0) return c; }
    return choices[choices.length - 1];
  }
  function pick({ wx, kinds, trash, seeds, settings, allowTrash, random }) {
    const w = rule(wx);
    const affinity = (k) => k.weather && k.weather.includes(wx) ? 2.4 : 1;
    // 默认平均一天 144 件拾物；持续清滩约三个自然日漂来一颗种子。
    if (seeds?.length && random() < 1 / 432) {
      const weight = { common: 7, uncommon: 3, rare: 1 };
      return weighted(seeds, k => weight[k.rarity] * affinity(k), random);
    }
    if (allowTrash && trash.length && random() < w[4]) return weighted(trash, affinity, random);
    const eligible = kinds.filter(k => k.rarity !== 'ultra' || !k.weather?.length || k.weather.includes(wx));
    const odds = {
      common: settings.wCommon * w[1], uncommon: settings.wUncommon * w[2], rare: settings.wRare * w[3],
      ultra: settings.wUltra ?? defaultUltraWeight,
    };
    const live = tiers.filter(t => odds[t] > 0 && eligible.some(k => k.rarity === t));
    const chosen = weighted(live, t => odds[t], random);
    if (chosen === 'ultra') return weighted(eligible.filter(k => k.rarity === 'ultra'), () => 1, random);
    return weighted(eligible.filter(k => chosen ? k.rarity === chosen : k.rarity !== 'ultra'), affinity, random);
  }
  V3.cabinTide = { defaultUltraWeight, chance: (base, wx) => Math.min(1, Math.max(0, base * rule(wx)[0])), pick };
})(window.V3);
