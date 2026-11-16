// 16-mcmesh.js — MC 方块网格：面剔除、分层（实心/镂空/半透明）、明暗与 AO、群系颜色、图集、流体、方块实体盒子
// 纯 JS（不碰 THREE/DOM），Node 里也能跑。规则按 MC 26.1 源码核对过，和 MC 的差别写在 docs/MC-RENDER.md。
(function (V3) {
  'use strict';
  const S = V3.mcmesh = {};
  const M = V3.mcmodel, J = V3.mcjar;
  const DIRS = M.DIRS, NORMALS = M.NORMALS, OPP = M.OPP;
  // 各朝向的明暗（主世界）：下 上 北 南 西 东
  const CARD = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];
  S.CARDINAL = CARD;
  S.WHITE = 'v3:white'; S.WHITE_A = 'v3:white_a'; S.MISSING = M.MISSING;
  // 第 4 层 ENTITY：方块实体（箱子、床）的真模型，和 MC 的实体一样最近点采样、不用 mipmap、alpha < 0.1 丢弃
  const SOLID = 0, CUTOUT = 1, TRANSLUCENT = 2, ENTITY = 3;
  S.LAYERS = ['solid', 'cutout', 'translucent'];

  // ---- 每个朝向的 16×16 遮挡掩码（位图，Uint32Array(8)）----
  // 平面：[法线轴, 0=最小边/1=最大边, 平面内 u 轴, 平面内 v 轴]；相对的两个朝向 u/v 轴相同，掩码可以直接比
  const PLANE = [[1, 0, 0, 2], [1, 1, 0, 2], [2, 0, 0, 1], [2, 1, 0, 1], [0, 0, 2, 1], [0, 1, 2, 1]];
  S.faceMasks = function (quads, pick) {
    const masks = [];
    for (let d = 0; d < 6; d++) masks.push(new Uint32Array(8));
    for (let k = 0; k < quads.length; k++) {
      const q = quads[k];
      if (q.rotated || (pick && !pick(q, k))) continue;
      const d = q.dir, pl = PLANE[d], p = q.pos;
      let ok = true, u0 = 2, u1 = -1, v0 = 2, v1 = -1;
      for (let i = 0; i < 4; i++) {
        if (Math.abs(p[i * 3 + pl[0]] - pl[1]) > 1e-4) { ok = false; break; }
        const u = p[i * 3 + pl[2]], v = p[i * 3 + pl[3]];
        if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      if (!ok) continue;
      const a0 = Math.max(0, Math.round(u0 * 16)), a1 = Math.min(16, Math.round(u1 * 16));
      const b0 = Math.max(0, Math.round(v0 * 16)), b1 = Math.min(16, Math.round(v1 * 16));
      const m = masks[d];
      for (let b = b0; b < b1; b++) for (let a = a0; a < a1; a++) { const n = b * 16 + a; m[n >> 5] |= 1 << (n & 31); }
    }
    return masks;
  };
  const maskFull = (m) => { for (let i = 0; i < 8; i++) if (m[i] !== 0xFFFFFFFF) return false; return true; };
  const maskEmpty = (m) => { for (let i = 0; i < 8; i++) if (m[i]) return false; return true; };
  const maskCovers = (a, b) => { for (let i = 0; i < 8; i++) if ((a[i] & ~b[i]) >>> 0) return false; return true; };
  S.maskFull = maskFull; S.maskEmpty = maskEmpty;

  // ---- 方块分类（按 MC 26.1 Blocks.java 的属性整理；只用来决定剔除/AO，不含任何贴图或颜色）----
  // 不参与遮挡（noOcclusion / noCollision）的方块，按名字
  const NOOCC = /(^|_)(door|trapdoor|glass|glass_pane|bars|leaves|ice|chain|lantern|campfire|candle|ladder|scaffolding|cauldron|hopper|brewing_stand|beacon|spawner|vault|end_rod|lightning_rod|bamboo|lily_pad|cocoa|sea_pickle|turtle_egg|sniffer_egg|dragon_egg|chorus_plant|chorus_flower|slime_block|honey_block|copper_grate|powder_snow|amethyst_cluster|amethyst_bud|pointed_dripstone|azalea|flower_pot|frogspawn|dried_ghast|pale_moss_carpet|mangrove_roots|test_instance_block)$|^potted_/;
  const OCC_KEEP = new Set(['sea_lantern', 'jack_o_lantern', 'packed_ice', 'blue_ice']);
  // 不挡视线（AO 里算透光）
  const NOVIEW = /(^|_)(leaves|glass|copper_grate)$|^(mangrove_roots|moving_piston|trial_spawner|vault|test_instance_block)$/;
  // AO 亮度恒为 1 的整方块（玻璃一类、蜂蜜块的碰撞箱不满）
  const SB_ONE = /^(glass|tinted_glass|[a-z_]+_stained_glass|([a-z_]+_)?copper_grate|honey_block)$/;
  // 和同种方块相邻时不画中间的面
  const SKIP_SAME = /^(glass|tinted_glass|[a-z_]+_stained_glass|ice|frosted_ice|blue_ice|slime_block|honey_block|([a-z_]+_)?copper_grate|mangrove_roots|powder_snow)$/;
  const SKIP_BARS = /(^|_)(glass_pane|bars)$/;
  // 会发光的方块（发光时 MC 不做 AO）
  const EMIT = new Set(['lava', 'fire', 'soul_fire', 'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'glowstone', 'nether_portal',
    'jack_o_lantern', 'glow_lichen', 'enchanting_table', 'brewing_stand', 'lava_cauldron', 'end_portal', 'end_portal_frame', 'dragon_egg',
    'ender_chest', 'beacon', 'light', 'sea_lantern', 'end_rod', 'end_gateway', 'magma_block', 'conduit', 'lantern', 'soul_lantern',
    'shroomlight', 'crying_obsidian', 'amethyst_cluster', 'large_amethyst_bud', 'medium_amethyst_bud', 'small_amethyst_bud',
    'sculk_sensor', 'calibrated_sculk_sensor', 'sculk_catalyst', 'firefly_bush', 'brown_mushroom']);
  const EMIT_LIT = /^(furnace|smoker|blast_furnace|redstone_ore|deepslate_redstone_ore|redstone_torch|redstone_wall_torch|redstone_lamp|campfire|soul_campfire|([a-z_]+_)?candle|([a-z_]+_)?candle_cake|([a-z_]+_)?copper_bulb)$/;
  S.emits = function (st) {
    if (st.ns !== 'minecraft') return false;
    const id = st.id, p = st.props;
    if (EMIT.has(id) || /copper_(wall_)?torch$|copper_lantern$|_froglight$/.test(id)) return true;
    if (EMIT_LIT.test(id)) return p.lit === 'true';
    if (id === 'sea_pickle') return p.waterlogged === 'true';
    if (id === 'cave_vines' || id === 'cave_vines_plant') return p.berries === 'true';
    if (id === 'respawn_anchor') return (+p.charges || 0) > 0;
    return false;
  };
  // 花草的随机偏移（XZ：水平；XYZ：水平 + 向下）
  const OFF_XYZ = new Set(['short_grass', 'fern', 'short_dry_grass', 'tall_dry_grass', 'small_dripleaf']);
  const OFF_XZ = new Set(['mangrove_propagule', 'tall_seagrass', 'dandelion', 'golden_dandelion', 'torchflower', 'poppy', 'blue_orchid', 'allium',
    'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'wither_rose', 'lily_of_the_valley',
    'sunflower', 'lilac', 'rose_bush', 'peony', 'tall_grass', 'large_fern', 'pitcher_plant', 'bamboo_sapling', 'bamboo', 'warped_roots',
    'nether_sprouts', 'crimson_roots', 'hanging_roots', 'open_eyeblossom', 'closed_eyeblossom']);
  S.plantOffset = function (kind, wx, wz, id) {
    const seed = M.posSeed(wx, 0, wz);
    const f = (sh) => Number((seed >> BigInt(sh)) & 15n) / 15;
    const cl = (v) => Math.max(-0.25, Math.min(0.25, v));
    const x = cl((f(0) - 0.5) * 0.5), z = cl((f(8) - 0.5) * 0.5);
    const y = kind === 2 ? (f(4) - 1) * (id === 'small_dripleaf' ? 0.1 : 0.2) : 0;
    return [x, y, z];
  };

  // ---- 面要不要画（MC Block.shouldRenderFace）----
  function skipRendering(self, nb, d) {
    if (!self.skip || nb.name !== self.name) return false;
    if (self.skip === 'same') return true;
    if (d < 2) return true;
    return self.props[DIRS[d]] === 'true' && nb.props[DIRS[OPP[d]]] === 'true';
  }
  S.shouldDraw = function (self, nb, d) {
    if (!nb) return true;
    const o = OPP[d];
    if (nb.occ && nb.full[o]) return false;
    if (skipRendering(self, nb, d)) return false;
    if (!nb.occ || nb.empty[o]) return true;
    if (!self.occ || self.empty[d]) return true;
    return !maskCovers(self.masks[d], nb.masks[o]);
  };

  // ---- 平滑光照（AO）：照 BlockModelLighter.prepareQuadAmbientOcclusion ----
  // 每个朝向：[4 个角方向, 4 个顶点的权重下标(8 个), 顶点重排]；权重下标 0..5 = 下 上 北 南 西 东 的边界，6..11 = 1 − 对应值
  const AO = [[[4, 5, 2, 3], [[10, 3, 10, 9, 4, 9, 4, 3], [10, 2, 10, 8, 4, 8, 4, 2], [11, 2, 11, 8, 5, 8, 5, 2], [11, 3, 11, 9, 5, 9, 5, 3]], [0, 1, 2, 3]],
    [[5, 4, 2, 3], [[5, 3, 5, 9, 11, 9, 11, 3], [5, 2, 5, 8, 11, 8, 11, 2], [4, 2, 4, 8, 10, 8, 10, 2], [4, 3, 4, 9, 10, 9, 10, 3]], [2, 3, 0, 1]],
    [[1, 0, 5, 4], [[1, 10, 1, 4, 7, 4, 7, 10], [1, 11, 1, 5, 7, 5, 7, 11], [0, 11, 0, 5, 6, 5, 6, 11], [0, 10, 0, 4, 6, 4, 6, 10]], [3, 0, 1, 2]],
    [[4, 5, 0, 1], [[1, 10, 7, 10, 7, 4, 1, 4], [0, 10, 6, 10, 6, 4, 0, 4], [0, 11, 6, 11, 6, 5, 0, 5], [1, 11, 7, 11, 7, 5, 1, 5]], [0, 1, 2, 3]],
    [[1, 0, 2, 3], [[1, 3, 1, 9, 7, 9, 7, 3], [1, 2, 1, 8, 7, 8, 7, 2], [0, 2, 0, 8, 6, 8, 6, 2], [0, 3, 0, 9, 6, 9, 6, 3]], [3, 0, 1, 2]],
    [[0, 1, 2, 3], [[6, 3, 6, 9, 0, 9, 0, 3], [6, 2, 6, 8, 0, 8, 0, 2], [7, 2, 7, 8, 1, 8, 1, 2], [7, 3, 7, 9, 1, 9, 1, 3]], [1, 2, 3, 0]]];
  const FS = new Float64Array(12);
  // G：{sb(x,y,z) AO 亮度, tl(x,y,z) 是否透光, lc(x,y,z) 光照坐标, solid(x,y,z)}；out：4 个顶点的灰度（已乘朝向明暗）；
  // lout（可选）：4 个顶点的平滑光照坐标（打包同 MC：低 16 位方块光、高 16 位天光，每份 0..240）
  S.aoQuad = function (G, e, q, x, y, z, out, lout) {
    const p = q.pos, d = q.dir;
    let nx = 32, ny = 32, nz = 32, xx = -32, xy = -32, xz = -32;
    for (let i = 0; i < 4; i++) {
      const a = p[i * 3], b = p[i * 3 + 1], c = p[i * 3 + 2];
      if (a < nx) nx = a; if (a > xx) xx = a; if (b < ny) ny = b; if (b > xy) xy = b; if (c < nz) nz = c; if (c > xz) xz = c;
    }
    FS[0] = ny; FS[1] = xy; FS[2] = nz; FS[3] = xz; FS[4] = nx; FS[5] = xx;
    for (let i = 0; i < 6; i++) FS[6 + i] = 1 - FS[i];
    const lo = 1e-4, hi = 0.9999;
    const partial = d < 2 ? (nx >= lo || nz >= lo || xx <= hi || xz <= hi)
      : d < 4 ? (nx >= lo || ny >= lo || xx <= hi || xy <= hi) : (ny >= lo || nz >= lo || xy <= hi || xz <= hi);
    let cubic;
    switch (d) {
      case 0: cubic = ny === xy && (ny < lo || e.cube); break;
      case 1: cubic = ny === xy && (xy > hi || e.cube); break;
      case 2: cubic = nz === xz && (nz < lo || e.cube); break;
      case 3: cubic = nz === xz && (xz > hi || e.cube); break;
      case 4: cubic = nx === xx && (nx < lo || e.cube); break;
      default: cubic = nx === xx && (xx > hi || e.cube);
    }
    const n = NORMALS[d];
    const bx = cubic ? x + n[0] : x, by = cubic ? y + n[1] : y, bz = cubic ? z + n[2] : z;
    const T = AO[d], c = [NORMALS[T[0][0]], NORMALS[T[0][1]], NORMALS[T[0][2]], NORMALS[T[0][3]]];
    const s = [0, 0, 0, 0], t = [false, false, false, false];
    const LC = lout && G.lc ? [0, 0, 0, 0] : null;
    for (let k = 0; k < 4; k++) {
      const o = c[k];
      s[k] = G.sb(bx + o[0], by + o[1], bz + o[2]);
      if (LC) LC[k] = G.lc(bx + o[0], by + o[1], bz + o[2]);
      t[k] = G.tl(bx + o[0] + n[0], by + o[1] + n[1], bz + o[2] + n[2]);
    }
    const sb2 = (a, b) => G.sb(bx + c[a][0] + c[b][0], by + c[a][1] + c[b][1], bz + c[a][2] + c[b][2]);
    const lc2 = (a, b) => G.lc(bx + c[a][0] + c[b][0], by + c[a][1] + c[b][1], bz + c[a][2] + c[b][2]);
    // MC 原样：两边都挡光时用 shade0 / light0（不是对应边）
    const k02 = !t[2] && !t[0], k03 = !t[3] && !t[0], k12 = !t[2] && !t[1], k13 = !t[3] && !t[1];
    const c02 = k02 ? s[0] : sb2(0, 2);
    const c03 = k03 ? s[0] : sb2(0, 3);
    const c12 = k12 ? s[0] : sb2(1, 2);
    const c13 = k13 ? s[0] : sb2(1, 3);
    const ce = cubic ? G.sb(bx, by, bz) : e.sb;
    const l0 = (s[3] + s[0] + c03 + ce) * 0.25, l1 = (s[2] + s[0] + c02 + ce) * 0.25;
    const l2 = (s[2] + s[1] + c12 + ce) * 0.25, l3 = (s[3] + s[1] + c13 + ce) * 0.25;
    const r = T[2], W = T[1];
    if (partial) {
      for (let k = 0; k < 4; k++) {
        const w = W[k];
        const v = l0 * FS[w[0]] * FS[w[1]] + l1 * FS[w[2]] * FS[w[3]] + l2 * FS[w[4]] * FS[w[5]] + l3 * FS[w[6]] * FS[w[7]];
        out[r[k]] = Math.min(1, Math.max(0, v));
      }
    } else { out[r[0]] = l0; out[r[1]] = l1; out[r[2]] = l2; out[r[3]] = l3; }
    const CD = G.card || CARD, cs = q.shade ? CD[d] : CD[1];
    for (let k = 0; k < 4; k++) out[k] *= cs;
    if (LC) {
      // 平滑光照（BlockModelLighter）：中心先取自己这格；面是整面或者面前那格不是实心 → 换成面前那格
      let lce = G.lc(x, y, z);
      if (cubic || !G.solid(x + n[0], y + n[1], z + n[2])) lce = G.lc(x + n[0], y + n[1], z + n[2]);
      const SB = V3.mclight.smoothBlend, SW = V3.mclight.smoothWeightedBlend;
      const t1 = SB(LC[3], LC[0], k03 ? LC[0] : lc2(0, 3), lce), t2 = SB(LC[2], LC[0], k02 ? LC[0] : lc2(0, 2), lce);
      const t3 = SB(LC[2], LC[1], k12 ? LC[0] : lc2(1, 2), lce), t4 = SB(LC[3], LC[1], k13 ? LC[0] : lc2(1, 3), lce);
      if (partial) {
        for (let k = 0; k < 4; k++) {
          const w = W[k];
          lout[r[k]] = SW(t1, t2, t3, t4, FS[w[0]] * FS[w[1]], FS[w[2]] * FS[w[3]], FS[w[4]] * FS[w[5]], FS[w[6]] * FS[w[7]]);
        }
      } else { lout[r[0]] = t1; lout[r[1]] = t2; lout[r[2]] = t3; lout[r[3]] = t4; }
    }
    return out;
  };
  // 面是不是贴在方块边界上（prepareQuadShape 的 faceCubic；不用 AO 时决定从哪格取光）
  S.quadCubic = function (e, q) {
    const p = q.pos, d = q.dir, ax = d < 2 ? 1 : d < 4 ? 2 : 0;
    let lo = 32, hi = -32;
    for (let i = 0; i < 4; i++) { const v = p[i * 3 + ax]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo !== hi) return false;
    return (d & 1) ? (hi > 0.9999 || e.cube) : (lo < 1e-4 || e.cube);
  };

  // ---- 群系颜色（平原）：草/树叶从 jar 的 colormap 取，水色从 jar 的群系 json 取；没 jar 时用我们自己定的近似色 ----
  const parseColor = (v) => {
    if (typeof v === 'number') return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) { const n = parseInt(v.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
    return null;
  };
  // 白天地形雾（照 MC 26.1 FogRenderer / AtmosphericFogEnvironment / fog.glsl 的算法；颜色从 jar 的
  // 维度、群系文件里读，没有就不加雾）。只算正午、不下雨、不对着日出日落的情况。rd = 渲染距离（区块）。
  S.fogFrom = function (dim, bio, rd = 8) {
    const at = (o, k) => (o && o.attributes ? o.attributes['minecraft:visual/' + k] : undefined);
    const fogC = parseColor(at(bio, 'fog_color') || at(dim, 'fog_color'));
    const skyC = parseColor(at(bio, 'sky_color') || at(dim, 'sky_color'));
    if (!fogC || !skyC) return null;
    const num = (k, d) => { const v = at(bio, k) != null ? at(bio, k) : at(dim, k); return typeof v === 'number' ? v : d; };
    const skyEnd = Math.min(num('sky_fog_end_distance', 512) / 16, rd);
    const f = Math.min(1, Math.max(0, skyEnd / 32));
    const mix = 1 - Math.pow(0.25 + (1 - 0.25) * f, 0.25);
    // ARGB.srgbLerp：按 0–255 整数插值（lerpInt 向下取整）
    const color = fogC.map((c, i) => { const a = Math.round(c * 255), b = Math.round(skyC[i] * 255); return (a + Math.floor(mix * (b - a))) / 255; });
    const blocks = rd * 16, span = Math.min(64, Math.max(4, blocks / 10));
    return { color, start: num('fog_start_distance', 0), end: num('fog_end_distance', 1024), rdStart: blocks - span, rdEnd: blocks, renderDistance: rd };
  };
  S.environment = async function (pack, opts = {}) {
    // 没有 jar 时的颜色是我们自己挑的（不是 MC 的数值）；有 jar 就用 jar 里 colormap 和群系文件的颜色
    const env = { grass: [0.5, 0.72, 0.3], foliage: [0.38, 0.62, 0.22], dry: [0.66, 0.52, 0.3], water: [0.2, 0.42, 0.85], biome: opts.biome || 'plains', from: 'own' };
    if (pack) {
      const bio = pack.biome(env.biome) || {};
      const temp = typeof bio.temperature === 'number' ? bio.temperature : 0.8;
      const rain = typeof bio.downfall === 'number' ? bio.downfall : 0.4;
      const pick = async (name, k) => {
        const sp = await pack.colormap(name);
        const v = J.climateColor(sp, temp, rain, null);
        if (v) { env[k] = v.map((n) => n / 255); env.from = 'jar'; }
      };
      await Promise.all([pick('grass', 'grass'), pick('foliage', 'foliage'), pick('dry_foliage', 'dry')]);
      const w = parseColor(bio.effects && bio.effects.water_color);
      if (w) env.water = w;
      env.temperature = temp; env.downfall = rain;
      env.fog = S.fogFrom(pack.dimension && pack.dimension('overworld'), bio, opts.renderDistance);
    }
    // 下面几种 MC 用写死的颜色或公式，这里用自己定的近似值（记在 MC-RENDER.md）
    env.lily = env.foliage.map((v) => v * 0.7);
    env.stemRipe = [0.85, 0.55, 0.15];
    return env;
  };
  const GRASS_T = new Set(['grass_block', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'potted_fern', 'bush', 'sugar_cane']);
  const FOLIAGE_T = new Set(['oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'vine', 'spruce_leaves', 'birch_leaves']);
  S.tint = function (env, st, layer) {
    if (st.ns !== 'minecraft') return null;
    const id = st.id;
    if (id === 'pink_petals' || id === 'wildflowers') return layer === 1 ? env.grass : null;
    if (layer !== 0) return null;
    if (GRASS_T.has(id)) return env.grass;
    if (FOLIAGE_T.has(id)) return env.foliage;
    if (id === 'leaf_litter') return env.dry;
    if (id === 'water_cauldron' || id === 'water' || id === 'bubble_column') return env.water;
    if (id === 'lily_pad') return env.lily;
    if (id === 'redstone_wire') { const f = Math.max(0, Math.min(15, +st.props.power || 0)) / 15; return [0.3 + 0.7 * f, Math.max(0, f * f * 0.45 - 0.08), 0]; }
    if (id === 'melon_stem' || id === 'pumpkin_stem') { const f = Math.max(0, Math.min(7, +st.props.age || 0)) / 7; return [0.1 + 0.75 * f, 0.9 - 0.2 * f, 0.05 + 0.08 * f]; }
    if (id === 'attached_melon_stem' || id === 'attached_pumpkin_stem') return env.stemRipe;
    return null;
  };

  // ---- 方块实体（模型不在 json 里）：按名字用盒子近似 ----
  const DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  const FACING_Y = { north: 0, east: 90, south: 180, west: 270 };
  const HEADS = { skeleton: [0.82, 0.82, 0.78], wither_skeleton: [0.2, 0.2, 0.22], zombie: [0.3, 0.5, 0.32], creeper: [0.38, 0.68, 0.32], player: [0.55, 0.4, 0.3], dragon: [0.16, 0.13, 0.2], piglin: [0.86, 0.6, 0.55] };
  S.dyeOf = (id) => { let best = null; for (const d of DYES) if (id.startsWith(d + '_') && (!best || d.length > best.length)) best = d; return best; };
  S.specialShape = function (st) {
    if (st.ns !== 'minecraft') return null;
    const id = st.id, p = st.props, fy = FACING_Y[p.facing] || 0;
    const B = (a, b, c, d, e, f, col, rot) => ({ from: [a, b, c], to: [d, e, f], col: col || 'p', rot: rot || null });
    const sr = (r) => ({ origin: [8, 8, 8], axis: 'y', angle: -22.5 * ((+r || 0) % 16) });
    const head = () => { const k = Object.keys(HEADS).sort((a, b) => b.length - a.length).find((h) => id.startsWith(h + '_')); return k ? HEADS[k] : 'p'; };
    if (/(^|_)chest$/.test(id)) {
      if (p.type === 'left') return { y: fy, boxes: [B(1, 0, 1, 16, 14, 15), B(15, 7, 0, 16, 11, 1, 'latch')] };
      if (p.type === 'right') return { y: fy, boxes: [B(0, 0, 1, 15, 14, 15), B(0, 7, 0, 1, 11, 1, 'latch')] };
      return { y: fy, boxes: [B(1, 0, 1, 15, 14, 15), B(7, 7, 0, 9, 11, 1, 'latch')] };
    }
    if (/_bed$/.test(id)) return { y: fy, boxes: [B(0, 3, 0, 16, 9, 16, 'wool'), B(0, 0, 0, 3, 3, 3), B(13, 0, 0, 16, 3, 3)] };
    if (/_wall_hanging_sign$/.test(id)) return { y: fy, boxes: [B(0, 14, 6, 16, 16, 10), B(1, 0, 7, 15, 10, 9), B(3.5, 10, 7.5, 4.5, 14, 8.5, 'chain'), B(11.5, 10, 7.5, 12.5, 14, 8.5, 'chain')] };
    if (/_hanging_sign$/.test(id)) { const r = sr(p.rotation); return { y: 0, boxes: [B(1, 0, 7, 15, 10, 9, 'p', r), B(3.5, 10, 7.5, 4.5, 16, 8.5, 'chain', r), B(11.5, 10, 7.5, 12.5, 16, 8.5, 'chain', r)] }; }
    if (/_wall_sign$/.test(id)) return { y: fy, boxes: [B(0, 4.33, 14.67, 16, 12.33, 16)] };
    if (/_sign$/.test(id)) { const r = sr(p.rotation); return { y: 0, boxes: [B(7.33, 0, 7.33, 8.67, 9.33, 8.67, 'p', r), B(0, 9.33, 7.33, 16, 17.33, 8.67, 'p', r)] }; }
    if (/_wall_banner$/.test(id)) return { y: fy, boxes: [B(1.33, 14.67, 14.67, 14.67, 16, 16), B(1.33, -12, 15.33, 14.67, 14.67, 16, 'wool')] };
    if (/_banner$/.test(id)) { const r = sr(p.rotation); return { y: 0, boxes: [B(7.33, 0, 7.33, 8.67, 28, 8.67, 'p', r), B(1.33, 26.67, 7.33, 14.67, 28, 8.67, 'p', r), B(1.33, 1.33, 8.67, 14.67, 26.67, 9.33, 'wool', r)] }; }
    if (/_wall_(head|skull)$/.test(id)) return { y: fy, boxes: [B(4, 4, 8, 12, 12, 16, head())] };
    if (/_(head|skull)$/.test(id)) return { y: 0, boxes: [B(4, 0, 4, 12, 8, 12, head(), sr(p.rotation))] };
    if (/shulker_box$/.test(id)) return { y: 0, boxes: [B(0, 0, 0, 16, 16, 16)] };
    if (id === 'decorated_pot') return { y: fy, boxes: [B(1, 0, 1, 15, 13, 15), B(4, 13, 4, 12, 16, 12)] };
    if (id === 'conduit') return { y: 0, boxes: [B(5, 5, 5, 11, 11, 11)] };
    if (/copper_golem_statue$/.test(id)) return { y: fy, boxes: [B(4, 0, 4, 12, 14, 12)] };
    if (id === 'pitcher_crop') return { y: 0, boxes: [B(3, 0, 3, 13, 6, 13, [0.35, 0.55, 0.25])] };
    if (id === 'end_portal') return { y: 0, boxes: [B(0, 0, 0, 16, 12, 16, [0.04, 0.05, 0.09])] };
    if (id === 'end_gateway') return { y: 0, boxes: [B(0, 0, 0, 16, 16, 16, [0.04, 0.05, 0.09])] };
    return null;
  };
  const OWN_COL = { latch: [0.42, 0.42, 0.45], chain: [0.25, 0.25, 0.28] };
  S.avgColor = function (sp) {
    if (!sp || !sp.data) return null;
    let r = 0, g = 0, b = 0, a = 0;
    const d = sp.data;
    for (let i = 0; i < d.length; i += 4) { const A = d[i + 3]; r += d[i] * A; g += d[i + 1] * A; b += d[i + 2] * A; a += A; }
    return a ? [r / a / 255, g / a / 255, b / a / 255] : null;
  };
  const boxModel = (box, sprite) => {
    const face = { texture: '#a' };
    return { elements: [{ from: box.from, to: box.to, rotation: box.rot || undefined, faces: { down: face, up: face, north: face, south: face, west: face, east: face } }], textures: { a: { sprite, force: false } }, ao: false };
  };
  S.boxModel = boxModel;

  // ---- 流体：简化版（平顶、不看流向）----
  const FLUID = { water: { still: 'minecraft:block/water_still', flow: 'minecraft:block/water_flow', layer: TRANSLUCENT }, lava: { still: 'minecraft:block/lava_still', flow: 'minecraft:block/lava_flow', layer: SOLID } };
  const fluidCache = new Map();
  function fluidQuads(kind, h) {
    const key = kind + '|' + h.toFixed(4);
    let qs = fluidCache.get(key);
    if (!qs) {
      const side = { texture: '#flow', uv: [0, (1 - h) * 8, 8, 8] };
      const el = { from: [0, 0, 0], to: [16, h * 16, 16], faces: { down: { texture: '#still' }, up: { texture: '#still', uv: [0, 0, 16, 16] }, north: side, south: side, west: side, east: side } };
      qs = M.bakeModel({ elements: [el], textures: { still: { sprite: FLUID[kind].still }, flow: { sprite: FLUID[kind].flow } }, ao: false }, {});
      fluidCache.set(key, qs);
    }
    return qs;
  }
  // 这格里泡着什么流体（MC 的 FluidState）：纯水、纯岩浆、气泡柱；海带、海草一直泡在水里；waterlogged=true 的方块（含水方块）是水
  const WET_ALWAYS = /^(bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/;
  S.fluidOf = function (st) {
    if (!st) return null;
    if (st.ns === 'minecraft') {
      if (st.id === 'lava') return 'lava';
      if (st.id === 'water' || WET_ALWAYS.test(st.id)) return 'water';
    }
    return st.props && st.props.waterlogged === 'true' ? 'water' : null;
  };
  // 含水方块里的水：当一格静止的水源画（平顶 8/9 高，不看流向），和方块自己的模型叠在一起
  const WET = { kind: 'water', h: 8 / 9, layer: TRANSLUCENT, still: FLUID.water.still, flow: FLUID.water.flow };

  // ---- 图集：按需要的贴图拼一张，16 像素对齐 ----
  // 和 MC 26.1 一样：每张贴图四周留一圈边（默认 16 像素），边里填贴图边缘像素的延伸（MC 用 clamp 采样画进去）；
  // mipmap 按每张贴图自己算（透明度加权的 2×2 平均），每一级再把边重新延伸一遍。这样线性采样、mipmap 都不会混到隔壁的贴图。
  const boxDown = (src, w, h) => {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), dst = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0, rr = 0, gg = 0, bb = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy);
        const p = (sy * w + sx) * 4, A = src[p + 3];
        r += src[p] * A; g += src[p + 1] * A; b += src[p + 2] * A; a += A; rr += src[p]; gg += src[p + 1]; bb += src[p + 2];
      }
      const q = (y * nw + x) * 4;
      if (a > 0) { dst[q] = Math.round(r / a); dst[q + 1] = Math.round(g / a); dst[q + 2] = Math.round(b / a); }
      else { dst[q] = rr >> 2; dst[q + 1] = gg >> 2; dst[q + 2] = bb >> 2; }
      dst[q + 3] = Math.round(a / 4);
    }
    return { data: dst, w: nw, h: nh };
  };
  S.ATLAS_PAD = 16;
  S.ATLAS_SPRITE_MIPS = 4;
  S.packAtlas = function (sprites, opts = {}) {
    const pad = opts.pad == null ? S.ATLAS_PAD : Math.max(0, opts.pad | 0);
    const list = sprites.slice().sort((a, b) => (b.h - a.h) || (b.w - a.w) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const al = (n) => Math.max(16, Math.ceil(n / 16) * 16);
    const cw = (s) => al(s.w + 2 * pad), ch = (s) => al(s.h + 2 * pad);
    let area = 0;
    for (const s of list) area += cw(s) * ch(s);
    let W = 64;
    while (W * W < area) W *= 2;
    for (const s of list) while (cw(s) > W) W *= 2;
    let place = [], H = 1;
    for (;;) {
      place = [];
      let x = 0, y = 0, rowH = 0;
      for (const s of list) {
        const w = cw(s), h = ch(s);
        if (x + w > W) { x = 0; y += rowH; rowH = 0; }
        place.push([s, x, y]);
        x += w; if (h > rowH) rowH = h;
      }
      const used = y + rowH;
      if (used <= W) { H = 1; while (H < used) H *= 2; break; }
      W *= 2;
    }
    // 按贴图算的 mipmap 级数（再往下按整张图平均，那几级只在特别远的地方用到）
    const full = Math.log2(Math.max(W, H)) | 0;
    const K = opts.mipmaps === false ? 0 : Math.min(full, opts.spriteMips == null ? S.ATLAS_SPRITE_MIPS : opts.spriteMips);
    const levels = [];
    for (let k = 0; k <= K; k++) levels.push(new Uint8Array(Math.max(1, W >> k) * Math.max(1, H >> k) * 4));
    const rects = new Map();
    for (const [s, x, y] of place) {
      rects.set(s.id, [x + pad, y + pad, s.w, s.h]);
      let cur = { data: s.data, w: s.w, h: s.h };
      for (let k = 0; k <= K; k++) {
        if (k > 0) cur = boxDown(cur.data, cur.w, cur.h);
        const LW = Math.max(1, W >> k), dst = levels[k];
        const x0 = x >> k, y0 = y >> k, x1 = (x + cw(s)) >> k, y1 = (y + ch(s)) >> k;
        const ix = (x + pad) >> k, iy = (y + pad) >> k, src = cur.data, sw = cur.w, sh = cur.h;
        for (let py = y0; py < y1; py++) {
          const sy = Math.min(sh - 1, Math.max(0, py - iy));
          for (let px = x0; px < x1; px++) {
            const sx = Math.min(sw - 1, Math.max(0, px - ix)), p = (sy * sw + sx) * 4, q = (py * LW + px) * 4;
            dst[q] = src[p]; dst[q + 1] = src[p + 1]; dst[q + 2] = src[p + 2]; dst[q + 3] = src[p + 3];
          }
        }
      }
    }
    if (opts.mipmaps !== false) {
      let w = Math.max(1, W >> K), h = Math.max(1, H >> K);
      while (w > 1 || h > 1) { const d = boxDown(levels[levels.length - 1], w, h); levels.push(d.data); w = d.w; h = d.h; }
    }
    return { width: W, height: H, levels, rects, pad };
  };
  const solidSprite = (id, rgba, alt) => {
    const data = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < 256; i++) { const c = alt && (((i & 15) >> 3) ^ ((i >> 7) & 1)) ? alt : rgba; data.set(c, i * 4); }
    return { id, w: 16, h: 16, data };
  };
  const BUILTIN = {
    [S.WHITE]: solidSprite(S.WHITE, [255, 255, 255, 255]),
    [S.WHITE_A]: solidSprite(S.WHITE_A, [255, 255, 255, 110]),
    // 缺贴图：我们自己的黄黑格（不是 MC 的紫黑格）
    [S.MISSING]: solidSprite(S.MISSING, [240, 200, 40, 255], [30, 30, 30, 255]),
  };

  // ---- 输入：{size, palette, cells(平铺或游程)} / FORMAT.md 的 dump / 探针 /region 的结果 ----
  S.normalize = function (model, opts = {}) {
    if (!model || typeof model !== 'object') throw new Error('模型不是对象');
    const size = model.size;
    if (!Array.isArray(size) || size.length !== 3) throw new Error('模型缺 size:[W,H,L]');
    const W = size[0] | 0, H = size[1] | 0, L = size[2] | 0;
    if (!(W > 0 && H > 0 && L > 0)) throw new Error('size 不对：' + size.join(','));
    const N = W * H * L;
    if (N > (opts.maxCells || 16777216)) throw new Error('模型太大：' + N + ' 格');
    const palette = Array.isArray(model.palette) ? model.palette.map(String) : null;
    if (!palette || !palette.length) throw new Error('模型缺 palette');
    const src = model.cells || model.blocks;
    if (!Array.isArray(src) && !ArrayBuffer.isView(src)) throw new Error('模型缺 cells');
    const cells = new Int32Array(N);
    const bad = (v) => { throw new Error('cells 里的编号超出 palette：' + v); };
    if (src.length && Array.isArray(src[0])) {
      let i = 0;
      for (const run of src) {
        const c = run[0] | 0, v = run[1] | 0;
        if (c < 0 || i + c > N) throw new Error('cells 游程超出格子数');
        if (v < 0 || v >= palette.length) bad(v);
        cells.fill(v, i, i + c); i += c;
      }
      if (i !== N) throw new Error('cells 游程总数 ' + i + ' ≠ ' + N);
    } else {
      if (src.length !== N) throw new Error('cells 长度 ' + src.length + ' ≠ ' + N);
      for (let i = 0; i < N; i++) { const v = src[i] | 0; if (v < 0 || v >= palette.length) bad(v); cells[i] = v; }
    }
    // origin：第 (0,0,0) 格的世界坐标。随机朝向、花草偏移要用世界坐标才和游戏一样。
    const o = opts.origin || S.worldOrigin(model);
    const origin = Array.isArray(o) && o.length === 3 ? Array.from(o, (n) => n | 0) : [0, 0, 0];
    return { W, H, L, N, palette, cells, origin, blockEntities: Array.isArray(model.blockEntities) ? model.blockEntities : [] };
  };

  // 鲸图 / .schem（V3.share 读出来的模型）：世界坐标 = Metadata.Xiaojingyu.Origin + Offset（FORMAT.md §3.2）；
  // 没有 Origin（别的工具写的）就当在 Offset；探针 /region 自带 origin；都没有就 (0,0,0)。
  const tval = (v, k) => (v && typeof v === 'object' && k in v) ? v[k] : undefined;
  S.worldOrigin = function (model) {
    if (!model || typeof model !== 'object') return null;
    const off = Array.isArray(model.offset) || ArrayBuffer.isView(model.offset) ? Array.from(model.offset, (n) => n | 0) : null;
    const xjy = tval(tval(tval(tval(model.meta, 'compound'), 'Xiaojingyu'), 'compound'), 'Origin');
    const org = tval(xjy, 'intArray') || (Array.isArray(xjy) ? xjy : null);
    if (off && org && org.length === 3) return [0, 1, 2].map((k) => (org[k] | 0) + off[k]);
    if (Array.isArray(model.origin) && model.origin.length === 3) return model.origin.map((n) => n | 0);
    return off;
  };

  const RES = new WeakMap();
  S.resolverFor = (pack) => { let r = RES.get(pack); if (!r) { r = M.createResolver(pack); RES.set(pack, r); } return r; };
  const INVISIBLE = new Set(['barrier', 'light', 'structure_void', 'moving_piston']);

  // ---- 主函数 ----
  // opts：pack（14-mcjar 的 pack；没有就走兜底颜色）、ao（默认 true）、biome（默认 plains）、origin、mipmaps
  // 返回：{size, origin, atlas{width,height,levels,rects}, layers{solid,cutout,translucent: {position,uv,color,index,centers,quads}}, bounds, env, stats, warnings, debug}
  S.build = async function (model, opts = {}) {
    const t0 = Date.now();
    const pack = opts.pack || null;
    const R = pack ? S.resolverFor(pack) : null;
    const G = S.normalize(model, opts);
    const { W, H, L, N } = G;
    const stats = { cells: N, blocks: 0, entries: 0, culled: 0, quads: { solid: 0, cutout: 0, translucent: 0, entity: 0 }, missingStates: [], missingSprites: [], specials: [], entityModels: 0, fallback: 0, fluids: 0, waterlogged: 0, ms: 0 };
    const missSt = new Map(), spec = new Set();
    const warn0 = R ? R.warnings.length : 0;
    const ent = new Array(N).fill(null);
    const pal = G.palette.map((s) => {
      const st = M.parseState(s);
      let kind = 'block';
      if (M.isAir(st) || (st.ns === 'minecraft' && INVISIBLE.has(st.id))) kind = 'air';
      else if (st.ns === 'minecraft' && (st.id === 'water' || st.id === 'lava' || st.id === 'bubble_column')) kind = 'fluid';
      return { st, kind, entry: null };
    });
    const mkEntry = (P, kind, quads) => ({ st: P.st, name: P.st.name, ns: P.st.ns, id: P.st.id, props: P.st.props, kind, quads: quads || [],
      layers: null, qcol: null, occ: false, masks: null, full: [false, false, false, false, false, false], empty: [true, true, true, true, true, true],
      cube: false, sb: 1, opaque: false, emit: false, offset: 0, skip: null, tints: null, fluid: null, wet: null, special: null, fb: null });
    const fallbackEntry = (P) => {
      const fb = V3.mcfallback ? V3.mcfallback.block(P.st) : null;
      if (!fb || !fb.quads.length) return null;
      const e = mkEntry(P, 'fallback', fb.quads);
      e.fb = fb;
      return e;
    };
    const blockEntry = (P, b) => {
      if (b.status === 'ok') return mkEntry(P, 'block', b.quads);
      if (b.status === 'empty') {
        const sh = S.specialShape(P.st);
        if (!sh) return null;
        const e = mkEntry(P, 'special', null);
        e.special = sh;
        spec.add(P.st.id);
        return e;
      }
      if (missSt.size < 100 && !missSt.has(M.stateKey(P.st))) missSt.set(M.stateKey(P.st), b.status);
      stats.fallback++;
      return fallbackEntry(P);
    };
    const uniq = new Map();
    for (let i = 0; i < N; i++) {
      const pi = G.cells[i], P = pal[pi];
      if (P.kind === 'air') continue;
      stats.blocks++;
      if (P.entry) { ent[i] = P.entry; continue; }
      if (P.kind === 'fluid') {
        const e = mkEntry(P, 'fluid', null);
        const kind = P.st.id === 'lava' ? 'lava' : 'water';
        const lvl = P.st.id === 'bubble_column' ? 0 : (+P.st.props.level || 0);
        e.fluid = { kind, h: (lvl >= 1 && lvl <= 7) ? (8 - lvl) / 9 : 8 / 9, layer: FLUID[kind].layer, still: FLUID[kind].still, flow: FLUID[kind].flow };
        ent[i] = P.entry = e;
        continue;
      }
      if (!R) { stats.fallback++; ent[i] = P.entry = fallbackEntry(P); continue; }
      const x = i % W, z = Math.floor(i / W) % L, y = Math.floor(i / (W * L));
      const b = R.block(P.st, [G.origin[0] + x, G.origin[1] + y, G.origin[2] + z]);
      if (!b.random) { ent[i] = P.entry = blockEntry(P, b); continue; }
      const key = pi + '|' + b.parts.map((p) => { const v = p.variant; return v.model + ',' + v.x + ',' + v.y + ',' + v.z + ',' + (v.uvlock ? 1 : 0); }).join(';');
      let e = uniq.get(key);
      if (e === undefined) { e = blockEntry(P, b); uniq.set(key, e); }
      ent[i] = e;
    }
    const all = [...new Set(ent)].filter(Boolean);
    stats.entries = all.length;
    const sprites = new Map();
    if (pack && pack.fallbackSprite) {
      for (const e of all) {
        if (e.kind !== 'fallback') continue;
        const replacements = await Promise.all(e.quads.map(q => pack.fallbackSprite(e.st, q)));
        if (!replacements.some(Boolean)) continue;
        e.instanceFaces = replacements;
        e.quads = e.quads.map((q, i) => {
          const sp = replacements[i];
          if (!sp) return q;
          sprites.set(sp.id, sp);
          return { ...q, sprite: sp.id };
        });
      }
    }
    // 要用的贴图
    const need = new Set([S.WHITE, S.WHITE_A, S.MISSING]);
    for (const e of all) {
      if (e.kind === 'block' || e.kind === 'fallback') for (const q of e.quads) need.add(q.sprite);
      else if (e.kind === 'fluid') { need.add(e.fluid.still); need.add(e.fluid.flow); }
      else if (e.kind === 'special' && R) {
        const ps = R.particle(e.st);
        e.special.particle = ps;
        if (ps) need.add(ps);
        const dye = S.dyeOf(e.id);
        e.special.wool = dye ? 'minecraft:block/' + dye + '_wool' : null;
        if (e.special.wool) need.add(e.special.wool);
        // 箱子和床有真模型（19-mcentity.js），贴图读 jar 里的 textures/entity/…；读不到就还画盒子
        e.ent = V3.mcentity ? V3.mcentity.forState(e.st) : null;
        if (e.ent) need.add(e.ent.sprite);
      }
      // 含水方块（waterlogged=true、海带、海草）：方块自己的模型 + 一层水
      if (e.kind !== 'fluid' && S.fluidOf(e.st) === 'water') { e.wet = WET; need.add(WET.still); need.add(WET.flow); }
    }
    await Promise.all([...need].map(async (id) => {
      if (sprites.has(id)) return;
      let sp = BUILTIN[id] || null;
      if (!sp && pack) sp = await pack.sprite(id);
      if (!sp && V3.mcfallback) sp = V3.mcfallback.sprite(id);
      if (!sp) { if (stats.missingSprites.length < 100) stats.missingSprites.push(id); return; }
      sprites.set(id, sp);
    }));
    const env = await S.environment(pack, opts);
    // 光照（19-mclight）：有这个模块且没关（opts.light !== false）才算；没有就当处处正午露天（满亮）
    const LM = opts.light !== false && V3.mclight ? V3.mclight : null;
    // 每种方块算一次：分层、遮挡掩码、AO 参数、颜色
    for (const e of all) {
      e.emit = LM ? LM.emission(e.st) > 0 : S.emits(e.st);
      e.skip = e.ns === 'minecraft' ? (SKIP_SAME.test(e.id) ? 'same' : SKIP_BARS.test(e.id) ? 'bars' : null) : null;
      e.offset = e.ns === 'minecraft' ? (OFF_XYZ.has(e.id) ? 2 : OFF_XZ.has(e.id) ? 1 : 0) : 0;
      e.tints = [S.tint(env, e.st, 0), S.tint(env, e.st, 1), S.tint(env, e.st, 2)];
      if (e.kind === 'fluid') { stats.fluids++; continue; }
      if (e.kind === 'special') {
        if (e.ent && sprites.has(e.ent.sprite)) {
          e.quads = e.ent.quads; e.qcol = null;
          e.layers = new Uint8Array(e.quads.length).fill(ENTITY);
          stats.entityModels++;
          continue;
        }
        e.ent = null;
        const qs = [], qc = [];
        const pc = S.avgColor(sprites.get(e.special.particle)) || [0.6, 0.5, 0.4];
        const wc = S.avgColor(sprites.get(e.special.wool)) || pc;
        for (const box of e.special.boxes) {
          const col = Array.isArray(box.col) ? box.col : box.col === 'wool' ? wc : OWN_COL[box.col] || pc;
          for (const q of M.bakeModel(boxModel(box, S.WHITE), { y: e.special.y })) { qs.push(q); qc.push(col); }
        }
        e.quads = qs; e.qcol = qc;
        e.layers = new Uint8Array(qs.length);
        continue;
      }
      e.layers = new Uint8Array(e.quads.length);
      if (e.kind === 'fallback') {
        e.layers.fill(e.fb.layer || 0);
        e.qcol = e.fb.qcol || e.quads.map(() => e.fb.color);
        if (e.instanceFaces) {
          e.qcol = e.qcol.map((c, i) => e.instanceFaces[i] ? [1, 1, 1] : c);
          for (let i = 0; i < e.instanceFaces.length; i++) if (e.instanceFaces[i]) {
            const t = J.spriteTransparency(e.instanceFaces[i], ...e.quads[i].uvRect);
            e.layers[i] = t === 'translucent' ? TRANSLUCENT : t === 'cutout' ? CUTOUT : SOLID;
          }
        }
        e.occ = !!e.fb.occ;
      } else {
        for (let k = 0; k < e.quads.length; k++) {
          const q = e.quads[k];
          const sp = sprites.get(q.sprite);
          let l = SOLID;
          if (q.force) l = TRANSLUCENT;
          else if (sp) { const t = J.spriteTransparency(sp, q.uvRect[0], q.uvRect[1], q.uvRect[2], q.uvRect[3]); l = t === 'translucent' ? TRANSLUCENT : t === 'cutout' ? CUTOUT : SOLID; }
          e.layers[k] = l;
        }
        e.occ = e.ns !== 'minecraft' || OCC_KEEP.has(e.id) || !NOOCC.test(e.id);
      }
      if (e.occ) {
        e.masks = S.faceMasks(e.quads, (q, k) => e.layers[k] === SOLID);
        for (let d = 0; d < 6; d++) { e.full[d] = maskFull(e.masks[d]); e.empty[d] = maskEmpty(e.masks[d]); }
        if (e.empty.every(Boolean)) e.occ = false;
      }
      const gm = S.faceMasks(e.quads);
      e.cube = gm.every(maskFull);
      e.sb = (e.cube && !(e.ns === 'minecraft' && SB_ONE.test(e.id))) ? 0.2 : 1;
      if (e.kind === 'fallback') { e.sb = e.cube && e.fb.occ ? 0.2 : 1; e.opaque = e.cube && !!e.fb.occ; }
      else e.opaque = e.cube && !(e.ns === 'minecraft' && NOVIEW.test(e.id));
    }
    // 光照网格：每格的挡光、挡光形状、发光值；算天光和方块光（区域外当露天空气）
    let LG = null, LT = null, lget = null;
    if (LM) {
      const tl = Date.now();
      const damp = new Uint8Array(N), emit = new Uint8Array(N), emissive = new Uint8Array(N), shape = new Array(N).fill(null);
      const occ = new Map();
      const pem = pal.map((P) => LM.emission(P.st)), pes = pal.map((P) => LM.emissive(P.st) ? 1 : 0);
      for (let i = 0; i < N; i++) {
        const pi = G.cells[i];
        emit[i] = pem[pi]; emissive[i] = pes[pi];
        const e = ent[i];
        if (!e) continue;
        let o = occ.get(e);
        if (!o) { o = LM.occlusion(e); occ.set(e, o); }
        damp[i] = o.damp; shape[i] = o.shape;
      }
      LG = { W, H, L, damp, shape, emit, emissive };
      const light = LM.compute(LG);
      lget = LM.getter(LG, light);
      LT = LM.noonLightmap(opts.lightmap || {});
      stats.lightMs = Date.now() - tl;
      stats.light = { dark: light.sky.reduce((a, v, i) => a + (v < 15 && damp[i] < 15 ? 1 : 0), 0), lit: emit.reduce((a, v) => a + (v > 0 ? 1 : 0), 0) };
    }
    // 图集
    const list = [];
    for (const [id, sp] of sprites) list.push({ id, w: sp.w, h: sp.h, data: sp.data });
    const atlas = S.packAtlas(list, opts);
    const AW = atlas.width, AH = atlas.height;
    const missRect = atlas.rects.get(S.MISSING);
    const EPS = 1 / 2048;
    // 输出
    // cel：每个面是哪一格的方块出的（格子坐标）。模型可以伸出自己那格（MC 允许 −16..32 像素，比如遮阳伞的伞面、吊篮的吊臂），
    // 按面的位置猜会落到旁边的空气格里，按部件拆的时候用这个
    const mk = () => ({ pos: [], uv: [], col: [], idx: [], ctr: [], cel: [], n: 0 });
    const LY = [mk(), mk(), mk(), mk()];
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const emitQuad = (Ly, q, bx, by, bz, tr, tg, tb, ao, spr, lr) => {
      const rect = atlas.rects.get(spr || q.sprite) || missRect;
      const p = q.pos, uv = q.uv, base = Ly.n * 4;
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < 4; i++) {
        const X = p[i * 3] + bx, Y = p[i * 3 + 1] + by, Z = p[i * 3 + 2] + bz;
        Ly.pos.push(X, Y, Z); cx += X; cy += Y; cz += Z;
        if (X < bounds[0]) bounds[0] = X; if (Y < bounds[1]) bounds[1] = Y; if (Z < bounds[2]) bounds[2] = Z;
        if (X > bounds[3]) bounds[3] = X; if (Y > bounds[4]) bounds[4] = Y; if (Z > bounds[5]) bounds[5] = Z;
        let u = uv[i * 2], v = uv[i * 2 + 1];
        u = u < EPS ? EPS : u > 1 - EPS ? 1 - EPS : u;
        v = v < EPS ? EPS : v > 1 - EPS ? 1 - EPS : v;
        Ly.uv.push((rect[0] + u * rect[2]) / AW, (rect[1] + v * rect[3]) / AH);
        if (lr) Ly.col.push(tr * ao[i] * lr[i * 3], tg * ao[i] * lr[i * 3 + 1], tb * ao[i] * lr[i * 3 + 2]);
        else Ly.col.push(tr * ao[i], tg * ao[i], tb * ao[i]);
      }
      Ly.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      Ly.ctr.push(cx / 4, cy / 4, cz / 4);
      Ly.cel.push(Math.round(bx), Math.round(by), Math.round(bz));   // 花草的随机偏移不到半格
      Ly.n++;
    };
    // 光照坐标 → 每个顶点的光照图颜色（MC 在顶点着色器里做同样的采样，再乘顶点色）
    const lrgb = new Float32Array(12), lpk = [0, 0, 0, 0];
    const lightRGB = (p0, p1, p2, p3) => {
      LM.sample(LT, p0, lrgb, 0); LM.sample(LT, p1, lrgb, 3); LM.sample(LT, p2, lrgb, 6); LM.sample(LT, p3, lrgb, 9);
      return lrgb;
    };
    const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= L) ? null : ent[x + z * W + y * W * L];
    const AOG = { sb: (x, y, z) => { const e = at(x, y, z); return e ? e.sb : 1; }, tl: (x, y, z) => { const e = at(x, y, z); return e ? !e.opaque : true; },
      lc: lget ? lget.cell : null, solid: (x, y, z) => { const e = at(x, y, z); return !!(e && e.occ && e.cube); } };
    const aoOn = opts.ao !== false;
    // cardinal: false → 不乘各朝向的明暗（交给场景里的真实光照去照，比如游戏页的房子）；AO、染色照旧
    const CD = opts.cardinal === false ? [1, 1, 1, 1, 1, 1] : CARD;
    AOG.card = CD;
    const shade = new Float64Array(4);
    // 流体（纯流体格，或含水方块 host 里的那层水）。照 MC 的 FluidRenderer：挨着同一种流体的面不画（含水方块也算水）；
    // 自己这格的方块（host）那一面是完整的遮挡面就不画（向上的面不看自己）；邻格那一面完整遮挡也不画（向上的面要水满一格才算）
    const fluidAt = (x, y, z) => { const o = at(x, y, z); return !o ? null : o.kind === 'fluid' ? o.fluid.kind : o.wet ? 'water' : null; };
    const emitFluid = (f, tint, host, x, y, z) => {
      const h = fluidAt(x, y + 1, z) === f.kind ? 1 : f.h;
      // 没有流体贴图（没选 jar）时用纯色：水半透明蓝，岩浆橙色（我们自己定的颜色）
      const has = atlas.rects.has(f.still);
      const spr = has ? null : f.kind === 'water' ? S.WHITE_A : S.WHITE;
      const tc = tint || (!has && f.kind === 'lava' ? [0.9, 0.38, 0.06] : [1, 1, 1]);
      // 流体的光：这格和上面一格各取大的（FluidRenderer.getLightCoords）
      let lr = null;
      if (lget) { const p = LM.maxPack(lget.cell(x, y, z), lget.cell(x, y + 1, z)); lr = lightRGB(p, p, p, p); }
      for (const q of fluidQuads(f.kind, h)) {
        const d = q.dir, n = NORMALS[d], nb = at(x + n[0], y + n[1], z + n[2]);
        if (fluidAt(x + n[0], y + n[1], z + n[2]) === f.kind) continue;
        if (nb && nb.occ && nb.full && nb.full[OPP[d]] && (d !== 1 || h >= 1)) continue;
        if (host && d !== 1 && host.occ && host.full && host.full[d]) continue;
        shade[0] = shade[1] = shade[2] = shade[3] = CD[d];
        emitQuad(LY[f.layer], q, x, y, z, tc[0], tc[1], tc[2], shade, spr, lr);
      }
    };
    for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
      const i0 = x + z * W + y * W * L;
      const e = ent[i0];
      if (!e) continue;
      if (e.kind === 'fluid') { emitFluid(e.fluid, e.tints[0], null, x, y, z); continue; }
      if (e.wet) { stats.waterlogged++; emitFluid(e.wet, env.water, e, x, y, z); }
      let ox = 0, oy = 0, oz = 0;
      if (e.offset) { const o = S.plantOffset(e.offset, G.origin[0] + x, G.origin[2] + z, e.id); ox = o[0]; oy = o[1]; oz = o[2]; }
      const useAO = aoOn && !e.emit && e.kind !== 'special';
      const em = LG ? LG.emit[i0] : 0, es = LG ? LG.emissive[i0] : 0;
      // 箱子、床：整个模型用一个光（自己这格，大箱子和床跟另一半取大的，BrightnessCombiner），明暗用实体的两盏方向光
      let entLr = null;
      if (e.ent && lget) {
        let p = lget.cell(x, y, z);
        const pt = e.ent.partner, o = pt && at(x + pt[0], y, z + pt[1]);
        if (o && o.id === e.id) p = LM.maxPack(p, lget.cell(x + pt[0], y, z + pt[1]));
        entLr = Float32Array.from(lightRGB(p, p, p, p));
      }
      for (let k = 0; k < e.quads.length; k++) {
        const q = e.quads[k];
        if (q.entity) {
          shade[0] = shade[1] = shade[2] = shade[3] = q.light;
          emitQuad(LY[ENTITY], q, x, y, z, 1, 1, 1, shade, null, entLr);
          continue;
        }
        if (q.cull >= 0) {
          const n = NORMALS[q.cull];
          if (!S.shouldDraw(e, at(x + n[0], y + n[1], z + n[2]), q.cull)) { stats.culled++; continue; }
        }
        const tc = (e.qcol && e.qcol[k]) || (q.tint >= 0 && q.tint < 3 ? e.tints[q.tint] : null);
        let lr = null;
        if (useAO && q.ao) {
          S.aoQuad(AOG, e, q, x, y, z, shade, lget ? lpk : null);
          if (lget) lr = lightRGB(lpk[0], lpk[1], lpk[2], lpk[3]);
        } else {
          shade[0] = shade[1] = shade[2] = shade[3] = q.shade ? CD[q.dir] : CD[1];
          if (lget) {
            // 不平滑：有 cullface 的面取那一侧的格子；别的面贴边就取面前那格，否则取自己这格（方块实体也是自己这格）
            let p;
            if (e.kind === 'special') p = lget.cell(x, y, z);
            else if (q.cull >= 0) { const n = NORMALS[q.cull]; p = lget.withState(x + n[0], y + n[1], z + n[2], em, es); }
            else if (S.quadCubic(e, q)) { const n = NORMALS[q.dir]; p = lget.withState(x + n[0], y + n[1], z + n[2], em, es); }
            else p = lget.cell(x, y, z);
            lr = lightRGB(p, p, p, p);
          }
        }
        emitQuad(LY[e.layers[k]], q, x + ox, y + oy, z + oz, tc ? tc[0] : 1, tc ? tc[1] : 1, tc ? tc[2] : 1, shade, null, lr);
      }
    }
    const pack3 = (Ly) => ({ position: new Float32Array(Ly.pos), uv: new Float32Array(Ly.uv), color: new Float32Array(Ly.col), index: Ly.n * 4 > 65535 ? new Uint32Array(Ly.idx) : new Uint16Array(Ly.idx), centers: new Float32Array(Ly.ctr), cells: new Int32Array(Ly.cel), quads: Ly.n });
    const layers = { solid: pack3(LY[0]), cutout: pack3(LY[1]), translucent: pack3(LY[2]), entity: pack3(LY[3]) };
    stats.quads = { solid: LY[0].n, cutout: LY[1].n, translucent: LY[2].n, entity: LY[3].n };
    stats.missingStates = [...missSt.keys()];
    stats.specials = [...spec];
    stats.ms = Date.now() - t0;
    if (!isFinite(bounds[0])) bounds.fill(0);
    // 提示只给这次的：解析器是按 jar 缓存的，旧提示不重复；这次缺模型的方块状态每次都列出来
    const warnings = R ? R.warnings.slice(warn0) : [];
    for (const [k, why] of missSt) { const w = '没有模型：' + k + '（' + why + '）'; if (!warnings.includes(w)) warnings.push(w); }
    return { size: [W, H, L], origin: G.origin, atlas, layers, bounds, env, stats, warnings: warnings.slice(0, 100), debug: { at, entries: all } };
  };
})(window.V3);
