// 19-mclight.js — 按 MC 26.1.2 的规矩算一块区域里的天光和方块光，再按正午的光照图换成亮度
// 只是计算，不碰 DOM / THREE / 网络；16-mcmesh 在 build 时如果有它就用（V3.mclight）。
// 发光值、挡光规则抄自 26.1.2 源码（Blocks.java、BlockBehaviour、各方块类），出处写在 docs/MC-RENDER.md。
(function (V3) {
  'use strict';
  const L = V3.mclight = {};

  // ---- 发光值（getLightEmission）----
  const FIX = {
    lava: 15, fire: 15, glowstone: 15, jack_o_lantern: 15, lava_cauldron: 15, end_portal: 15, beacon: 15, sea_lantern: 15,
    end_gateway: 15, conduit: 15, lantern: 15, shroomlight: 15, ochre_froglight: 15, verdant_froglight: 15, pearlescent_froglight: 15,
    torch: 14, wall_torch: 14, copper_torch: 14, copper_wall_torch: 14, end_rod: 14,
    nether_portal: 11,
    soul_fire: 10, soul_torch: 10, soul_wall_torch: 10, soul_lantern: 10, crying_obsidian: 10,
    enchanting_table: 7, ender_chest: 7, sculk_catalyst: 6, amethyst_cluster: 5, large_amethyst_bud: 4, magma_block: 3,
    medium_amethyst_bud: 2, firefly_bush: 2,
    small_amethyst_bud: 1, brewing_stand: 1, end_portal_frame: 1, dragon_egg: 1, sculk_sensor: 1, calibrated_sculk_sensor: 1, brown_mushroom: 1,
  };
  // lit=true 才发光
  const LIT = {
    furnace: 13, smoker: 13, blast_furnace: 13, redstone_ore: 9, deepslate_redstone_ore: 9, redstone_torch: 7, redstone_wall_torch: 7,
    redstone_lamp: 15, campfire: 15, soul_campfire: 10,
    copper_bulb: 15, exposed_copper_bulb: 12, weathered_copper_bulb: 8, oxidized_copper_bulb: 4,
  };
  const SPAWNER = { inactive: 0, waiting_for_players: 4, active: 8, waiting_for_reward_ejection: 8, ejecting_reward: 8, cooldown: 0 };
  const EMIT_CACHE = new Map();
  L.emission = function (st) {
    if (!st || st.ns !== 'minecraft') return 0;
    const key = st.name + JSON.stringify(st.props);
    let v = EMIT_CACHE.get(key);
    if (v === undefined) { v = emissionOf(st.id.replace(/^waxed_/, ''), st.props); EMIT_CACHE.set(key, v); }
    return v;
  };
  function emissionOf(id, p) {
    if (id in FIX) return FIX[id];
    if (id in LIT) return p.lit === 'true' ? LIT[id] : 0;
    if (/(^|_)copper_lantern$/.test(id)) return 15;
    if (/(^|_)candle$/.test(id)) return p.lit === 'true' ? 3 * (+p.candles || 1) : 0;
    if (/(^|_)candle_cake$/.test(id)) return p.lit === 'true' ? 3 : 0;
    if (id === 'sea_pickle') return p.waterlogged === 'true' ? 3 + 3 * (+p.pickles || 1) : 0;
    if (id === 'respawn_anchor') return Math.floor((+p.charges || 0) / 4 * 15);
    if (id === 'light') return p.level === undefined ? 15 : +p.level;
    if (id === 'glow_lichen') return ['north', 'south', 'east', 'west', 'up', 'down'].some((d) => p[d] === 'true') ? 7 : 0;
    if (id === 'cave_vines' || id === 'cave_vines_plant') return p.berries === 'true' ? 14 : 0;
    if (id === 'trial_spawner') return SPAWNER[p.trial_spawner_state] || 0;
    if (id === 'vault') return p.vault_state === 'inactive' ? 6 : 12;
    return 0;
  }
  // emissiveRendering：这样的方块光照直接满格（岩浆块；激活中的幽匿感测器）
  L.emissive = function (st) {
    if (!st || st.ns !== 'minecraft') return false;
    if (st.id === 'magma_block') return true;
    return (st.id === 'sculk_sensor' || st.id === 'calibrated_sculk_sensor') && st.props.sculk_sensor_phase === 'active';
  };

  // ---- 挡光（getLightDampening）和挡光形状（useShapeForLightOcclusion）----
  // e 是 16-mcmesh 的条目：occ（能挡）、cube（模型是满格）、masks（6 个面的 16×16 掩码）
  const SHAPE_LO = /(_slab|_stairs|_shelf)$|^(snow|dirt_path|farmland|daylight_detector|enchanting_table|end_portal_frame|lectern|stonecutter|piston|sticky_piston|piston_head|sculk_sensor|calibrated_sculk_sensor|sculk_shrieker)$/;
  const GLASSY = /^(glass|tinted_glass|[a-z_]+_stained_glass)$/;
  const WATERY = new Set(['water', 'lava', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);
  L.AIR = { damp: 0, shape: null, solid: false };
  L.SOLID = { damp: 15, shape: null, solid: true };
  L.occlusion = function (e) {
    if (!e) return L.AIR;
    const mc = e.ns === 'minecraft', id = e.id;
    const wet = e.props && e.props.waterlogged === 'true';
    if (mc && WATERY.has(id)) return { damp: 1, shape: null, solid: false };
    const solid = !!(e.occ && e.cube);
    if (solid && !(mc && id === 'tinted_glass')) return L.SOLID;
    if (mc && /(^|_)leaves$/.test(id)) return { damp: 1, shape: null, solid: false };
    if (mc && id === 'tinted_glass') return { damp: 15, shape: null, solid: false };
    if (mc && GLASSY.test(id)) return { damp: 0, shape: null, solid: false };
    if (mc && /copper_grate$/.test(id)) return { damp: wet ? 1 : 0, shape: null, solid: false };
    if (mc && /(^|_)shulker_box$/.test(id)) return { damp: 1, shape: null, solid: false };
    const shape = mc && SHAPE_LO.test(id) && e.occ && e.masks ? e.masks : null;
    // 默认：不是满格或者含水 → 天光往下走不了的才挡 1
    const skyDown = !e.cube && !wet;
    return { damp: skyDown ? 0 : 1, shape, solid: false };
  };

  // ---- 光的传播（LightEngine.propagateIncrease：新值 = 来源 − max(1, 目标挡光)；形状把这个面封死就不过）----
  const DX = [0, 0, 0, 0, -1, 1], DY = [-1, 1, 0, 0, 0, 0], DZ = [0, 0, -1, 1, 0, 0], OPP = [1, 0, 3, 2, 5, 4];
  const FULL16 = 0xFFFFFFFF;
  // a 在 b 的 d 方向那一侧的面：a 的 d 面 + b 的反面合起来盖满 → 封死
  function shut(sa, sb, d) {
    const ma = sa ? sa[d] : null, mb = sb ? sb[OPP[d]] : null;
    if (!ma && !mb) return false;
    for (let w = 0; w < 8; w++) {
      const a = ma ? ma[w] : 0, b = mb ? mb[w] : 0;
      if (((a | b) >>> 0) !== FULL16) return false;
    }
    return true;
  }
  L.shut = shut;
  // grid：{W, H, L, damp Uint8Array, shape Array（null 或 6 个掩码）, emit Uint8Array}；
  // opts.floor = true：区域下面当成实心的地；否则区域外面全是露天的空气（天光 15）
  L.compute = function (grid, opts = {}) {
    const { W, H, L: Ln, damp, shape, emit } = grid;
    const N = W * H * Ln, WL = W * Ln;
    const sky = new Uint8Array(N), blk = new Uint8Array(N);
    const floor = !!opts.floor;
    const spread = (arr, queue) => {
      for (let qi = 0; qi < queue.length; qi++) {
        const i = queue[qi], v = arr[i];
        if (v <= 1) continue;
        const x = i % W, z = Math.floor(i / W) % Ln, y = Math.floor(i / WL);
        for (let d = 0; d < 6; d++) {
          const X = x + DX[d], Y = y + DY[d], Z = z + DZ[d];
          if (X < 0 || Y < 0 || Z < 0 || X >= W || Y >= H || Z >= Ln) continue;
          const j = X + Z * W + Y * WL;
          const nv = v - Math.max(1, damp[j]);
          if (nv <= arr[j]) continue;
          if ((shape[i] || shape[j]) && shut(shape[i], shape[j], d)) continue;
          arr[j] = nv; queue.push(j);
        }
      }
    };
    // 天光源：每一列从最上面往下，直到碰到「挡住的边」（下面那格挡光 ≠ 0，或者上下两个面合起来封死）
    const q = [];
    for (let z = 0; z < Ln; z++) for (let x = 0; x < W; x++) {
      let above = null;
      for (let y = H - 1; y >= 0; y--) {
        const j = x + z * W + y * WL;
        if (damp[j] !== 0 || ((above || shape[j]) && shut(shape[j], above, 1))) break;
        sky[j] = 15; q.push(j);
        above = shape[j];
      }
    }
    // 区域四周（和不铺地时的下面）外面是露天空气：从外面照进来
    const edge = (j, d) => {
      const nv = 15 - Math.max(1, damp[j]);
      if (nv <= sky[j] || (shape[j] && shut(shape[j], null, d))) return;
      sky[j] = nv; q.push(j);
    };
    for (let y = 0; y < H; y++) for (let z = 0; z < Ln; z++) { edge(z * W + y * WL, 4); edge(W - 1 + z * W + y * WL, 5); }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { edge(x + y * WL, 2); edge(x + (Ln - 1) * W + y * WL, 3); }
    for (let z = 0; z < Ln; z++) for (let x = 0; x < W; x++) edge(x + z * W + (H - 1) * WL, 1);
    if (!floor) for (let z = 0; z < Ln; z++) for (let x = 0; x < W; x++) edge(x + z * W, 0);
    spread(sky, q);
    // 方块光：从发光的格子开始
    const qb = [];
    for (let i = 0; i < N; i++) if (emit[i] > blk[i]) { blk[i] = emit[i]; qb.push(i); }
    spread(blk, qb);
    return { sky, blk };
  };

  // ---- 光照坐标（和 MC 的 LightCoordsUtil 一样打包：低 16 位方块光、高 16 位天光，每份 0..240）----
  L.pack = (block, sky) => (block << 4) | (sky << 20);
  L.FULL = L.pack(15, 15);
  L.maxPack = (a, b) => Math.max(a & 0xFFFF, b & 0xFFFF) | (Math.max(a >>> 16, b >>> 16) << 16);
  // smoothBlend：中心够亮时，邻居是 0 的那份用中心的补上，再四个平均
  L.smoothBlend = function (n1, n2, n3, c) {
    if (((c >>> 20) & 15) > 2 || ((c >>> 4) & 15) > 2) {
      if (((n1 >>> 20) & 15) === 0) n1 |= c & 0xFF0000; if (((n1 >>> 4) & 15) === 0) n1 |= c & 0xFF;
      if (((n2 >>> 20) & 15) === 0) n2 |= c & 0xFF0000; if (((n2 >>> 4) & 15) === 0) n2 |= c & 0xFF;
      if (((n3 >>> 20) & 15) === 0) n3 |= c & 0xFF0000; if (((n3 >>> 4) & 15) === 0) n3 |= c & 0xFF;
    }
    return ((n1 + n2 + n3 + c) >> 2) & 0xFF00FF;
  };
  L.smoothWeightedBlend = function (c1, c2, c3, c4, w1, w2, w3, w4) {
    const sky = Math.trunc(((c1 >>> 16) & 0xFF) * w1 + ((c2 >>> 16) & 0xFF) * w2 + ((c3 >>> 16) & 0xFF) * w3 + ((c4 >>> 16) & 0xFF) * w4);
    const blk = Math.trunc((c1 & 0xFF) * w1 + (c2 & 0xFF) * w2 + (c3 & 0xFF) * w3 + (c4 & 0xFF) * w4);
    return (blk & 0xFF) | ((sky & 0xFF) << 16);
  };
  // 取光：cell(x,y,z) = 那一格自己的状态（LevelRenderer.getLightCoords）；with(…, 发光值, emissive) = 用别的状态的发光值
  L.getter = function (grid, light, opts = {}) {
    const { W, H, L: Ln, emit, emissive } = grid, { sky, blk } = light, WL = W * Ln;
    const OUT = L.pack(0, 15), BELOW = opts.floor ? 0 : OUT;
    const withState = (x, y, z, em, es) => {
      if (es) return L.FULL;
      let p;
      if (y < 0) p = BELOW;
      else if (x < 0 || z < 0 || x >= W || z >= Ln || y >= H) p = OUT;
      else { const i = x + z * W + y * WL; p = L.pack(blk[i], sky[i]); }
      return em ? L.maxPack(p, em << 4) : p;
    };
    const cell = (x, y, z) => {
      if (y < 0) return BELOW;
      if (x < 0 || z < 0 || x >= W || z >= Ln || y >= H) return OUT;
      const i = x + z * W + y * WL;
      return emissive[i] ? L.FULL : L.pack(Math.max(blk[i], emit[i]), sky[i]);
    };
    return { cell, withState };
  };

  // ---- 正午的光照图（lightmap.fsh；主世界白天：天光系数 1、天光白色、环境光 #0a0a0a、方块光色 #ffd88c、方块光系数 1.4、亮度 0.5）----
  L.noonLightmap = function (opts = {}) {
    const amb = opts.ambient || [10 / 255, 10 / 255, 10 / 255], tint = opts.blockTint || [1, 216 / 255, 140 / 255];
    const skyF = opts.skyFactor === undefined ? 1 : opts.skyFactor, blockF = opts.blockFactor || 1.4;
    const gamma = opts.gamma === undefined ? 0.5 : opts.gamma;
    const t = new Float32Array(16 * 16 * 3), br = (l) => l / (4 - 3 * l);
    for (let s = 0; s < 16; s++) for (let b = 0; b < 16; b++) {
      const bl = b / 15, sl = s / 15, bb = br(bl) * blockF, sb = br(sl) * skyF, mf = 0.9 * (2 * bl - 1) * (2 * bl - 1);
      const c = [0, 1, 2].map((k) => Math.min(1, Math.max(0, amb[k] + sb + (tint[k] + (1 - tint[k]) * mf) * bb)));
      const mx = Math.max(c[0], c[1], c[2]), inv = 1 - mx, sc = mx > 0 ? (1 - inv * inv * inv * inv) / mx : 0;
      for (let k = 0; k < 3; k++) t[(s * 16 + b) * 3 + k] = Math.round((c[k] + (c[k] * sc - c[k]) * gamma) * 255) / 255;
    }
    return t;
  };
  // sample_lightmap：线性插值；packed 的每份 0..240 → 贴图格子 0..15
  L.sample = function (lm, packed, out, o = 0) {
    const fb = Math.min(15, (packed & 0xFFFF) / 16), fs = Math.min(15, (packed >>> 16) / 16);
    const b0 = Math.floor(fb), s0 = Math.floor(fs), b1 = Math.min(15, b0 + 1), s1 = Math.min(15, s0 + 1);
    const tb = fb - b0, ts = fs - s0;
    for (let k = 0; k < 3; k++) {
      const a = lm[(s0 * 16 + b0) * 3 + k] * (1 - tb) + lm[(s0 * 16 + b1) * 3 + k] * tb;
      const c = lm[(s1 * 16 + b0) * 3 + k] * (1 - tb) + lm[(s1 * 16 + b1) * 3 + k] * tb;
      out[o + k] = a * (1 - ts) + c * ts;
    }
    return out;
  };
})(window.V3);
