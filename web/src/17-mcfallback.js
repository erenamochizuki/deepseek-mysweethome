// 17-mcfallback.js — 没选 jar 时的兜底：我们自绘的像素纹理、配色和简单形状
// 不读取或嵌入 MC 资源；v3:fallback/ 下的纹理由下面的确定性像素规则生成。
(function (V3) {
  'use strict';
  const F = V3.mcfallback = {};
  const C = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const DYE = { white: 0xe8e8e8, orange: 0xe07a1f, magenta: 0xb84fc0, light_blue: 0x4fa8d8, yellow: 0xf0cc30, lime: 0x78c02a, pink: 0xe88aa8, gray: 0x4a4f53,
    light_gray: 0x92928c, cyan: 0x168a90, purple: 0x7a32a8, blue: 0x3a45a0, brown: 0x74492a, green: 0x52692a, red: 0xa82c28, black: 0x1c1c22 };
  const DYES = Object.keys(DYE).sort((a, b) => b.length - a.length);
  F.dyeOf = (id) => DYES.find((d) => id.startsWith(d + '_')) || null;
  F.dyeColor = (d) => DYE[d] != null ? C(DYE[d]) : null;
  // 木头：[木板, 树皮]
  const WOOD = { oak: [0xb08c55, 0x6a5232], spruce: [0x6e5232, 0x3e2c18], birch: [0xcdbd85, 0xd8d8d0], jungle: [0xa8744c, 0x5a4a20],
    acacia: [0xb05f35, 0x6a645c], dark_oak: [0x4a3220, 0x3a2a18], mangrove: [0x7a3530, 0x553a30], cherry: [0xe0b0aa, 0x3a2228],
    bamboo: [0xc8b450, 0x8a9a30], crimson: [0x6c3248, 0x6a2a3a], warped: [0x2f6a64, 0x3a5a5a], pale_oak: [0xdcd6cc, 0x5a5450] };
  const WOODS = Object.keys(WOOD).sort((a, b) => b.length - a.length);
  const LEAVES = { cherry: 0xe8a8c0, pale_oak: 0x8a9282, azalea: 0x5a7a30, flowering_azalea: 0x6a7a40, spruce: 0x3a5a3a, birch: 0x6a8a3a };
  // [名字规则, 颜色, 分层(0 实心 / 2 半透明), 是否遮挡]
  const T = (re, hex, layer, occ) => [re, C(hex), layer || 0, occ !== false];
  const TABLE = [
    T(/^(water|bubble_column)$/, 0x3060d0, 2, false), T(/^lava$/, 0xe06010),
    T(/^tinted_glass$/, 0x3a3440, 2, false), T(/(^|_)glass(_pane)?$/, 0xd0e8f0, 2, false),
    T(/^(ice|frosted_ice)$/, 0x90b8f0, 2, false), T(/^packed_ice$/, 0x8ab0e8), T(/^blue_ice$/, 0x70a0e8),
    T(/^slime_block$/, 0x70c060, 2, false), T(/^honey_block$/, 0xe0a030, 2, false),
    T(/leaves$/, 0x4a7a28, 0, false),
    T(/^grass_block$/, 0x6aa040), T(/^(dirt|dirt_path|farmland)$/, 0x86603e), T(/^coarse_dirt$/, 0x76553a), T(/^rooted_dirt$/, 0x8a6448),
    T(/^podzol$/, 0x6a4a28), T(/^mycelium$/, 0x7a6878), T(/^(sand|suspicious_sand)$/, 0xdccf9c), T(/^red_sand$/, 0xb8642a),
    T(/^(gravel|suspicious_gravel)$/, 0x847e7c), T(/^clay$/, 0xa0a6b4), T(/^mud$/, 0x3a3438), T(/^(snow|snow_block|powder_snow)$/, 0xf4fafa),
    T(/^(soul_sand|soul_soil)$/, 0x523e30), T(/^(moss_block|moss_carpet)$/, 0x5a7a2a), T(/^pale_moss/, 0x8a9282),
    T(/^bedrock$/, 0x4a4a4a), T(/deepslate/, 0x4a4a50), T(/tuff/, 0x6a6a62), T(/calcite/, 0xdcdcd6), T(/blackstone/, 0x2c2830),
    T(/basalt/, 0x4a4a4e), T(/obsidian/, 0x1a1028), T(/end_stone/, 0xdcdca0), T(/purpur/, 0xa87aa8), T(/prismarine/, 0x5aa898),
    T(/red_sandstone/, 0xb8642a), T(/sandstone/, 0xd8cc98), T(/nether_brick/, 0x3a1c22), T(/(^|_)bricks?(_|$)/, 0x965040),
    T(/^netherrack|nylium$/, 0x6a2828), T(/quartz/, 0xe8e2da), T(/mud_brick|packed_mud/, 0x8a6a50), T(/dripstone/, 0x866a5a),
    T(/mossy/, 0x667a55), T(/^(smooth_stone|smooth_stone_slab)$/, 0x9a9a9a), T(/andesite/, 0x868688), T(/granite/, 0x9a6a58),
    T(/diorite/, 0xc8c8c8), T(/cobblestone/, 0x6f6f6f), T(/oxidized_copper|oxidized_cut_copper/, 0x52a88a), T(/weathered_(cut_)?copper/, 0x6aa080),
    T(/exposed_(cut_)?copper/, 0xa07a62), T(/copper/, 0xb8684a), T(/^iron_(block|bars|door|trapdoor)$/, 0xd8d8d8),
    T(/^gold_block$/, 0xf0cc40), T(/^diamond_block$/, 0x6ae0d8), T(/^emerald_block$/, 0x40c060), T(/^lapis_block$/, 0x2a4a9a),
    T(/^redstone_block$/, 0xa81810), T(/^coal_block$/, 0x1c1c1c), T(/^netherite_block$/, 0x3a3436), T(/amethyst/, 0x8a62c0),
    T(/terracotta$/, 0x986048), T(/_ore$/, 0x7d7d7d), T(/stone/, 0x7d7d7d),
    T(/^(short_grass|tall_grass|fern|large_fern|seagrass|tall_seagrass|bush|short_dry_grass|tall_dry_grass)$/, 0x5a9a38, 0, false),
    T(/^(poppy|rose_bush|red_tulip|red_mushroom)$/, 0xc02a20, 0, false), T(/^(dandelion|golden_dandelion|sunflower)$/, 0xf0d030, 0, false),
    T(/^cornflower$/, 0x4a6ad0, 0, false), T(/^(allium|lilac|peony)$/, 0xb070d0, 0, false), T(/^(pink_tulip|pink_petals)$/, 0xe88aa8, 0, false),
    T(/^orange_tulip|torchflower/, 0xe07a1f, 0, false), T(/^(oxeye_daisy|azure_bluet|lily_of_the_valley|white_tulip)$/, 0xe8e8e0, 0, false),
    T(/^(wheat|carrots|potatoes|beetroots)$/, 0xb0a040, 0, false), T(/^sugar_cane$/, 0x8ac060, 0, false), T(/^cactus$/, 0x4a8a30, 0, false),
    T(/^(vine|kelp|kelp_plant|lily_pad|glow_lichen)$/, 0x4a7a28, 0, false), T(/^brown_mushroom$/, 0x9a7458, 0, false),
    T(/sapling|propagule|azalea$|roots$|sprouts$|fungus$|eyeblossom|wildflowers|dripleaf|spore_blossom|hanging_roots/, 0x5a8a38, 0, false),
    T(/^(pumpkin|carved_pumpkin|jack_o_lantern)$/, 0xd88a20), T(/^melon$/, 0x7a9a2a), T(/^hay_block$/, 0xc8a830),
    T(/torch$|^(lantern|soul_lantern|end_rod|campfire|soul_campfire)$/, 0xf0c050, 0, false), T(/^glowstone$/, 0xe8c070),
    T(/^(sea_lantern|beacon)$/, 0xc8e0d8), T(/froglight|shroomlight/, 0xe8d8a0), T(/^redstone_lamp$/, 0x8a5a30),
    T(/^redstone_wire$/, 0x901010, 0, false), T(/rail$/, 0x8a8070, 0, false), T(/^(chain|iron_chain|lightning_rod|hopper|cauldron|.*_cauldron|anvil|chipped_anvil|damaged_anvil)$/, 0x4a4a50, 0, false),
    T(/^bookshelf|chiseled_bookshelf$/, 0x8a6a40), T(/^(crafting_table|fletching_table|smithing_table|cartography_table|loom|composter|barrel|beehive|bee_nest|lectern|note_block|jukebox)$/, 0x9a6a40),
    T(/^(furnace|blast_furnace|smoker|dispenser|dropper|observer|piston|sticky_piston|piston_head|stonecutter|grindstone)$/, 0x6a6a6a),
    T(/chest$/, 0xa87830, 0, false), T(/^tnt$/, 0xc03020), T(/^sponge|wet_sponge$/, 0xc8c050), T(/^bone_block$/, 0xe0dccb),
    T(/^(skeleton|wither_skeleton|zombie|creeper|player|dragon|piglin)_(wall_)?(head|skull)$/, 0xc0b8a8, 0, false),
    T(/^(cobweb|scaffolding|ladder|lever|tripwire|tripwire_hook|flower_pot|candle|cake|bell|decorated_pot|conduit)$/, 0xb0a080, 0, false),
  ];
  const DEF = C(0xa0a0a0), MOD = C(0xb0a8a0);
  // → {color:[r,g,b], layer, occ, cat, side?, bottom?, end?}
  F.colorOf = function (st) {
    if (st.ns !== 'minecraft') return { color: MOD, layer: 0, occ: true, cat: 'mod' };
    let id = st.id.replace(/^potted_/, '');
    if (st.id.startsWith('potted_')) return { color: C(0x7a4a34), layer: 0, occ: false, cat: 'pot' };
    const dye = F.dyeOf(id);
    if (dye && /(wool|carpet|concrete|concrete_powder|terracotta|glazed_terracotta|stained_glass|stained_glass_pane|bed|banner|wall_banner|candle|candle_cake|shulker_box)$/.test(id)) {
      let c = C(DYE[dye]);
      if (/powder$/.test(id)) c = mix(c, [1, 1, 1], 0.25);
      if (/terracotta$/.test(id)) c = mix(c, C(0x986048), 0.45);
      const glass = /stained_glass(_pane)?$/.test(id);
      return { color: c, layer: glass ? 2 : 0, occ: !glass && !/carpet|banner|bed|candle/.test(id), cat: 'dye' };
    }
    const stripped = id.startsWith('stripped_');
    if (stripped) id = id.slice(9);
    const w = WOODS.find((k) => id.startsWith(k + '_'));
    if (w) {
      const rest = id.slice(w.length + 1);
      if (rest === 'leaves') return { color: C(LEAVES[w] || 0x4a7a28), layer: 0, occ: false, cat: 'leaves' };
      const [plank, bark] = WOOD[w].map(C);
      if (/^(log|stem)$/.test(rest)) return { color: stripped ? plank : bark, end: mix(plank, [1, 1, 1], 0.1), layer: 0, occ: true, cat: 'log' };
      if (/^(wood|hyphae)$/.test(rest)) return { color: stripped ? plank : bark, layer: 0, occ: true, cat: 'log' };
      if (/sapling|propagule/.test(rest)) return { color: C(0x5a8a38), layer: 0, occ: false, cat: 'plant' };
      return { color: plank, layer: 0, occ: !/door|trapdoor|sign|button|pressure_plate|fence|fence_gate/.test(rest), cat: 'wood' };
    }
    if (LEAVES[id.replace(/_leaves$/, '')] && /_leaves$/.test(id)) return { color: C(LEAVES[id.replace(/_leaves$/, '')]), layer: 0, occ: false, cat: 'leaves' };
    for (const [re, col, layer, occ] of TABLE) if (re.test(id)) {
      const r = { color: col, layer, occ, cat: 'table' };
      if (id === 'grass_block') { r.side = C(0x7a7040); r.bottom = C(0x86603e); }
      return r;
    }
    return { color: DEF, layer: 0, occ: true, cat: 'default' };
  };

  // 原创 16×16 像素：木纹用中性亮度乘上各树种颜色；灯体直接用暖琥珀 / 青蓝与深铁灰。
  const SPR = 'v3:fallback/', sprites = new Map();
  F.sprite = function (id) {
    if (!id.startsWith(SPR)) return null;
    if (sprites.has(id)) return sprites.get(id);
    const kind = id.slice(SPR.length);
    if (!['planks', 'grain', 'rings', 'door_upper', 'door_lower', 'metal', 'lantern', 'soul_lantern'].includes(kind)) return null;
    const data = new Uint8Array(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const noise = ((x * 17 + y * 29 + (x * y * 7)) % 13) - 6;
      let c;
      if (kind === 'metal') c = [39 + noise, 44 + noise, 51 + noise];
      else if (kind === 'lantern' || kind === 'soul_lantern') {
        const frame = x < 2 || x > 13 || y < 2 || y > 13 || x === 7 || x === 8;
        const edge = x === 2 || x === 13 || y === 2 || y === 13;
        c = frame ? [34 + noise, 39 + noise, 46 + noise] : kind === 'lantern'
          ? (edge ? [183, 102, 34] : [239 + noise, 173 + noise, 70 + noise])
          : (edge ? [39, 125, 141] : [103 + noise, 209 + noise, 224 + noise]);
      } else {
        let v = 222 + noise;
        if (kind === 'planks') {
          if (y % 4 === 0 || x === ((y >> 2) % 2 ? 5 : 12)) v = 156 + noise;
          else if (y % 4 === 1) v = 244 + noise;
          else if ((x + y * 3) % 11 < 4) v -= 19;
        } else if (kind === 'rings') {
          const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
          if (Math.floor(r) % 3 === 0) v -= 45;
        } else {
          if (x % 4 === 0) v -= 37;
          if ((x * 3 + (y >> 1)) % 9 < 2) v -= 19;
          if (kind.startsWith('door_')) {
            // 两格门：连续竖梃、独立上下凹板和下半门锁扣。
            if (x < 2 || x > 13 || y < 2 || y > 13) v = 174 + noise;
            else if (x === 2 || x === 13 || y === 2 || y === 13) v = 246;
            else if (x === 3 || x === 12 || y === 3 || y === 12) v = 142;
            if (kind === 'door_lower' && x >= 11 && x <= 12 && y >= 4 && y <= 6) v = 64;
          }
        }
        c = [v, v, v];
      }
      const i = (y * 16 + x) * 4;
      data.set([...c, 255], i);
    }
    const sp = { id, w: 16, h: 16, data };
    sprites.set(id, sp);
    return sp;
  };

  // ---- 简单形状：盒子列表（0..16 像素）+ 绕 y 旋转；朝向规则和 MC 方块状态一致（y=90 把北转到东）----
  const FY = { north: 0, east: 90, south: 180, west: 270 };
  const FY_E = { east: 0, south: 90, west: 180, north: 270 };
  const SIDES = { north: (a, b, y0, y1) => [a, y0, 0, b, y1, a], south: (a, b, y0, y1) => [a, y0, 16 - a, b, y1, 16],
    west: (a, b, y0, y1) => [0, y0, a, a, y1, b], east: (a, b, y0, y1) => [16 - a, y0, a, 16, y1, b] };
  // 侧边连接件：从中心柱 [c0,c1] 伸到边上，厚度范围 [t0,t1]
  const arm = (d, t0, t1, c, y0, y1) => d === 'north' ? [t0, y0, 0, t1, y1, c] : d === 'south' ? [t0, y0, 16 - c, t1, y1, 16]
    : d === 'west' ? [0, y0, t0, c, y1, t1] : [16 - c, y0, t0, 16, y1, t1];
  const CARDS = ['north', 'south', 'west', 'east'];
  const cross = (h) => [[2, 0, 7.5, 14, h, 8.5], [7.5, 0, 2, 8.5, h, 14]];
  F.shape = function (st) {
    const id = st.id.replace(/^potted_/, ''), p = st.props;
    if (st.id.startsWith('potted_')) return { boxes: [[5, 0, 5, 11, 6, 11], [7, 6, 7, 9, 12, 9]] };
    if (/_slab$/.test(id)) return { boxes: [p.type === 'top' ? [0, 8, 0, 16, 16, 16] : p.type === 'double' ? [0, 0, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16]] };
    if (/_stairs$/.test(id)) { const t = p.half === 'top'; return { y: FY_E[p.facing] || 0, boxes: [t ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16], t ? [8, 0, 0, 16, 8, 16] : [8, 8, 0, 16, 16, 16]] }; }
    if (/_fence_gate$/.test(id)) { const b = [[0, 5, 7, 2, 16, 9], [14, 5, 7, 16, 16, 9]]; if (p.open !== 'true') b.push([2, 6, 7, 14, 9, 9], [2, 12, 7, 14, 15, 9]); return { y: FY[p.facing] || 0, boxes: b }; }
    if (/_fence$/.test(id)) { const b = [[6, 0, 6, 10, 16, 10]]; for (const d of CARDS) if (p[d] === 'true') b.push(arm(d, 7, 9, 6, 6, 9), arm(d, 7, 9, 6, 12, 15)); return { boxes: b }; }
    if (/_wall$/.test(id) && p.up) { const b = p.up === 'true' ? [[4, 0, 4, 12, 16, 12]] : []; for (const d of CARDS) if (p[d] && p[d] !== 'none') b.push(arm(d, 5, 11, 8, 0, p[d] === 'tall' ? 16 : 14)); if (!b.length) b.push([4, 0, 4, 12, 16, 12]); return { boxes: b }; }
    if (/(glass_pane|_bars)$/.test(id)) { const b = [[7, 0, 7, 9, 16, 9]]; for (const d of CARDS) if (p[d] === 'true') b.push(arm(d, 7, 9, 7, 0, 16)); return { boxes: b }; }
    if (/_door$/.test(id)) { const box = p.open === 'true' ? (p.hinge === 'right' ? [13, 0, 0, 16, 16, 16] : [0, 0, 0, 3, 16, 16]) : [0, 0, 13, 16, 16, 16]; return { y: FY[p.facing] || 0, boxes: [box] }; }
    if (/_trapdoor$/.test(id)) { if (p.open === 'true') return { y: FY[p.facing] || 0, boxes: [[0, 0, 13, 16, 16, 16]] }; return { boxes: [p.half === 'top' ? [0, 13, 0, 16, 16, 16] : [0, 0, 0, 16, 3, 16]] }; }
    if (/carpet$/.test(id)) return { boxes: [[0, 0, 0, 16, 1, 16]] };
    if (/pressure_plate$/.test(id)) return { boxes: [[1, 0, 1, 15, 1, 15]] };
    if (/rail$/.test(id)) return { boxes: [[0, 0, 0, 16, 1, 16]] };
    if (id === 'snow') return { boxes: [[0, 0, 0, 16, 2 * Math.max(1, Math.min(8, +p.layers || 1)), 16]] };
    if (/wall_torch$/.test(id)) return { y: FY_E[p.facing] || 0, boxes: [[0, 3, 7, 2, 13, 9]] };
    if (/torch$/.test(id)) return { boxes: [[7, 0, 7, 9, 10, 9]] };
    if (/lantern$/.test(id) && id !== 'sea_lantern' && id !== 'jack_o_lantern') {
      const dy = p.hanging === 'true' ? 1 : 0;
      const box = (b, skin) => Object.assign(b.map((v, i) => i % 3 === 1 ? v + dy : v), { skin });
      return { boxes: [box([5, 1, 5, 11, 8, 11], id === 'soul_lantern' ? id : 'lantern'), box([4, 0, 4, 12, 1, 12], 'metal'),
        box([4, 8, 4, 12, 9, 12], 'metal'), box([6, 9, 7, 7, 12, 9], 'metal'),
        box([9, 9, 7, 10, 12, 9], 'metal'), box([6, 12, 7, 10, 13, 9], 'metal'),
        ...(p.hanging === 'true' ? [Object.assign([7, 14, 7, 9, 16, 9], { skin: 'metal' })] : [])] };
    }
    if (/_button$|^lever$/.test(id)) {
      if (p.face === 'floor') return { y: FY[p.facing] || 0, boxes: [[5, 0, 6, 11, 2, 10]] };
      if (p.face === 'ceiling') return { y: FY[p.facing] || 0, boxes: [[5, 14, 6, 11, 16, 10]] };
      return { y: FY[p.facing] || 0, boxes: [[5, 6, 14, 11, 10, 16]] };
    }
    if (id === 'ladder') return { y: FY[p.facing] || 0, boxes: [[0, 0, 15, 16, 16, 16]] };
    if (id === 'vine' || id === 'glow_lichen') { const b = []; for (const d of CARDS) if (p[d] === 'true') b.push(SIDES[d](0, 16, 0, 16).map((v, i) => (i === 2 || i === 5) && d === 'north' ? Math.min(v, 1) : v)); if (p.up === 'true') b.push([0, 15, 0, 16, 16, 16]); if (p.down === 'true') b.push([0, 0, 0, 16, 1, 16]); return { boxes: b.length ? b : [[0, 0, 0, 16, 1, 16]] }; }
    if (id === 'redstone_wire') { const b = [[5, 0, 5, 11, 0.5, 11]]; for (const d of CARDS) if (p[d] && p[d] !== 'none') b.push(arm(d, 5, 11, 5, 0, 0.5)); return { boxes: b }; }
    if (/^(iron_)?chain$/.test(id) || /lightning_rod$|^end_rod$/.test(id)) { const a = p.axis || ({ north: 'z', south: 'z', east: 'x', west: 'x' })[p.facing] || 'y'; return { boxes: [a === 'x' ? [0, 7, 7, 16, 9, 9] : a === 'z' ? [7, 7, 0, 9, 9, 16] : [7, 0, 7, 9, 16, 9]] }; }
    if (/^(wheat|carrots|potatoes|beetroots)$/.test(id)) return { boxes: cross(2 + 2 * Math.min(7, +p.age || 0)) };
    if (/^(sugar_cane|bamboo|tall_grass|large_fern|sunflower|lilac|rose_bush|peony|kelp|kelp_plant|seagrass|tall_seagrass|cobweb)$/.test(id)) return { boxes: cross(16) };
    if (/^(short_grass|fern|bush|short_dry_grass|tall_dry_grass)$/.test(id)) return { boxes: cross(13) };
    if (/sapling|propagule|mushroom$|roots$|sprouts$|fungus$|eyeblossom|amethyst_(cluster|bud)$|dead_bush|^(poppy|dandelion|golden_dandelion|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|wither_rose|lily_of_the_valley|torchflower)$/.test(id)) return { boxes: cross(10) };
    if (/^(lily_pad|pink_petals|wildflowers|leaf_litter)$/.test(id)) return { boxes: [[0, 0, 0, 16, 0.5, 16]] };
    if (/^(dirt_path|farmland)$/.test(id)) return { boxes: [[0, 0, 0, 16, 15, 16]] };
    if (id === 'cactus') return { boxes: [[1, 0, 1, 15, 16, 15]] };
    if (/^cake$|candle_cake$/.test(id)) return { boxes: [[1, 0, 1, 15, 8, 15]] };
    if (/candle$/.test(id)) return { boxes: [[7, 0, 7, 9, 6, 9]] };
    if (id === 'flower_pot') return { boxes: [[5, 0, 5, 11, 6, 11]] };
    if (/^(campfire|soul_campfire)$/.test(id)) return { boxes: [[0, 0, 0, 16, 7, 16]] };
    if (/^(enchanting_table)$/.test(id)) return { boxes: [[0, 0, 0, 16, 12, 16]] };
    if (/^(daylight_detector|stonecutter)$/.test(id)) return { boxes: [[0, 0, 0, 16, id === 'stonecutter' ? 9 : 6, 16]] };
    if (id === 'hopper') return { boxes: [[0, 10, 0, 16, 16, 16], [4, 4, 4, 12, 10, 12], [6, 0, 6, 10, 4, 10]] };
    if (id === 'bell') return { boxes: [[4, 4, 4, 12, 13, 12]] };
    const sp = V3.mcmesh && V3.mcmesh.specialShape(st);
    if (sp) return { y: sp.y, boxes: sp.boxes.map((b) => Object.assign(b.from.concat(b.to), { rot: b.rot, col: b.col })) };
    return { boxes: [[0, 0, 0, 16, 16, 16]] };
  };

  // ---- 给 16-mcmesh 用：{quads, color, qcol, layer, occ} ----
  const NAMES = ['down', 'up', 'north', 'south', 'west', 'east'];
  const cache = new Map();
  F.block = function (st) {
    const key = V3.mcmodel.stateKey(st);
    if (cache.has(key)) return cache.get(key);
    const info = F.colorOf(st), sh = F.shape(st);
    const sprite = info.layer === 2 ? 'v3:white_a' : 'v3:white';
    const axis = st.props.axis || 'y';
    const elements = sh.boxes.map((b) => {
      const faces = {};
      const onEdge = [b[1] <= 0, b[4] >= 16, b[2] <= 0, b[5] >= 16, b[0] <= 0, b[3] >= 16];
      NAMES.forEach((n, d) => {
        let skin = null, uv;
        if (st.ns === 'minecraft') {
          if (b.skin) { skin = d < 2 ? 'metal' : b.skin; uv = [0, 0, 16, 16]; }
          else if (info.cat === 'log') skin = (axis === 'y' ? d < 2 : axis === 'z' ? d === 2 || d === 3 : d >= 4) ? 'rings' : 'grain';
          else if (info.cat === 'wood') {
            skin = /planks|slab|stairs/.test(st.id) ? 'planks' : 'grain';
            const broad = st.props.open === 'true' ? d >= 4 : d === 2 || d === 3;
            if (/_door$/.test(st.id) && broad) { skin = 'door_' + (st.props.half === 'upper' ? 'upper' : 'lower'); uv = [0, 0, 16, 16]; }
          }
        }
        faces[n] = { texture: skin ? SPR + skin : sprite, uv, cullface: onEdge[d] && !b.rot ? n : undefined };
      });
      return { from: b.slice(0, 3), to: b.slice(3, 6), rotation: b.rot || undefined, faces, col: b.skin ? [1, 1, 1] : b.col };
    });
    const quads = [], qcol = [];
    const dye = F.dyeColor(F.dyeOf(st.id));
    for (const el of elements) {
      const textures = Object.fromEntries(Object.values(el.faces).map(f => [f.texture, { sprite: f.texture, force: false }]));
      const qs = V3.mcmodel.bakeModel({ elements: [el], textures, ao: true }, { y: sh.y || 0 });
      for (const q of qs) {
        let c = info.color;
        if (el.col === 'wool' && dye) c = dye;
        else if (Array.isArray(el.col)) c = el.col;
        else if (info.side && q.dir >= 2) c = q.dir === 0 ? info.bottom : info.side;
        else if (info.side && q.dir === 0) c = info.bottom;
        else if (info.end && ((axis === 'y' && q.dir < 2) || (axis === 'z' && (q.dir === 2 || q.dir === 3)) || (axis === 'x' && q.dir >= 4))) c = info.end;
        quads.push(q); qcol.push(c);
      }
    }
    const full = sh.boxes.length === 1 && sh.boxes[0].join() === '0,0,0,16,16,16';
    const r = { quads, color: info.color, qcol, layer: info.layer, occ: info.occ && !(info.cat === 'table' && !full && /door|trapdoor|pane|bars|torch|lantern|rail|wire|plant/.test(st.id)), cat: info.cat };
    cache.set(key, r);
    return r;
  };
})(window.V3);
