// Ordinary finds have weather affinities; ultra-rare finds have weather windows.
(function (V3) {
  'use strict';
  // hit ×, common ×, uncommon ×, rare ×, separate litter chance.
  const rows = {
    baseline: [1, 1, 1, 1, .09], clear: [.9, 1.15, .95, .8, .07], cloudy: [1, 1, 1.05, 1, .09],
    overcast: [1.1, 1.05, 1.1, 1, .13], fog: [.88, 1, 1.2, 1.15, .10], drizzle: [1.08, 1, 1.16, 1.2, .13],
    rain: [1.28, .96, 1.26, 1.4, .18], storm: [1.55, .9, 1.4, 1.8, .24], snow: [.7, 1.1, .9, 1, .06],
  };
  const tiers = ['common', 'uncommon', 'rare'];
  const defaultUltraChance = .01;
  const rule = (wx) => Object.hasOwn(rows, wx) ? rows[wx] : rows.baseline;
  function weighted(choices, weight, random) {
    if (!choices.length) return null;
    let remainder = random() * choices.reduce((n, c) => n + weight(c), 0);
    for (const c of choices) { remainder -= weight(c); if (remainder < 0) return c; }
    return choices[choices.length - 1];
  }
  function pick({ wx, kinds, trash, settings, allowTrash, random }) {
    const w = rule(wx);
    const affinity = (k) => k.weather && k.weather.includes(wx) ? 2.4 : 1;
    if (allowTrash && trash.length && random() < w[4]) return weighted(trash, affinity, random);
    const ultra = kinds.filter(k => k.rarity === 'ultra' && (!k.weather?.length || k.weather.includes(wx)));
    if (ultra.length && random() < (settings.ultraChance ?? defaultUltraChance)) return ultra[Math.floor(random() * ultra.length)];
    const ordinary = kinds.filter(k => k.rarity !== 'ultra');
    const values = [settings.wCommon, settings.wUncommon, settings.wRare];
    const odds = Object.fromEntries(tiers.map((t, i) => [t, values[i] * w[i + 1]]));
    const live = tiers.filter((t) => odds[t] > 0 && kinds.some((k) => k.rarity === t));
    const chosen = weighted(live, (t) => odds[t], random);
    return weighted(chosen ? ordinary.filter((k) => k.rarity === chosen) : ordinary, affinity, random);
  }
  V3.cabinTide = { defaultUltraChance, chance: (base, wx) => Math.min(1, Math.max(0, base * rule(wx)[0])), pick };
})(window.V3);
