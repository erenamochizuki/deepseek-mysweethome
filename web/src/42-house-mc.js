// 42-house-mc.js — 小鲸鱼之家 v4（P4 定稿）：把小鲸鱼之家（小屋 2.0）改成 MC 原版方块，1 格 = 1 米
// 纯数据：不用 THREE，不碰 DOM。V3.houseMc.build({ variant, roof, wall }) 同步返回
//   { model, parts, labels, levels, anchors, furniture, info }，model 能直接交给 V3.share.writePng 写成鲸图。
// 说明见 docs/HOUSE-V4.md；测试 web/test/house-mc.test.mjs；导出 web/tools/house-mc.mjs。
// 定稿（用户 2026-11-06 选的）：方案 B（外墙 14 × 10）、一楼净高 3 米、两色屋顶、平滑石英白墙、屋脊加盖板。
// 方案 A 和一楼净高 2.5 米的草图在提交 d3440c4 里。
//
// 坐标：场景米 = MC 方块坐标（+x 东、+y 上、+z 南＝朝海）。格子 (x,y,z) 占 [x,x+1)×[y,y+1)×[z,z+1)，沙面 y=0。
// 模型格子 (0,0,0) 的场景位置 = Metadata.Xiaojingyu.Origin + Offset（docs/FORMAT.md §3.2）。
// 方块状态都写全（所有属性，按名字排序）。会互相连接的方块（栅栏、玻璃板、楼梯形状）在整栋房子摆好以后，
// 照 MC 26.1 源码重新算一遍：StairBlock.getStairsShape、FenceBlock.connectsTo、IronBarsBlock.attachsTo。
(function (V3) {
  'use strict';
  const H = V3.houseMc = {};

  // ---- 房子：墙那一圈格子的范围（含墙）。前墙在 z = −7（外皮 z = −6，和小屋 2.0 一样）----
  // 只有定稿这一种；variants 这个接口留着（工作台的方案开关用它），只剩一项。
  const VARIANTS = {
    b: { id: 'b', label: '小鲸鱼之家 v4（方案 B）', x0: -7, x1: 6, z0: -16, z1: -7, stairZ: -14, lampZ: -12 },
  };
  H.variants = Object.freeze(Object.values(VARIANTS).map((v) => Object.freeze({ id: v.id, label: v.label })));
  const ORIGIN = [-2, 0, -2];     // 站立点：台阶前一格（沙面上），朝北看房子
  const DOOR_X = -2;              // 门所在的那一格
  const CX0 = -4, CX1 = 0;        // 朝海小山墙的墙宽（5 格，正对着门）
  // 高度（格子 y）：y=0 地梁和一楼地板；y=1–3 一楼的墙、门窗；y=4 腰梁和阁楼地板；y=5 阁楼矮墙，也是屋檐那排屋顶
  const BEAM_Y = 4;               // 腰梁 / 阁楼地板那一层：一楼净高 = 1 → 4 = 3 米
  const LOFT_Y = 5;               // 阁楼地面（米）= 矮墙那一层
  const EAVE_Y = 5;               // 屋顶挑檐那一排台阶的 y；往里每排高 1
  H.ORIGIN = Object.freeze(ORIGIN.slice());
  // P5 第 3 轮：鲸图要包住的屋外范围（场景格子，两头都算；FURNITURE.md 第 9 节）；遮阳伞伞柱 3 格高（伞面在 2 米多，和原来一样高）
  const YARD = { x0: -11, x1: 8, z0: -17, z1: 5 };
  const PARASOL_H = 3;
  H.YARD = Object.freeze(Object.assign({}, YARD));
  H.SOURCE = 'haibian-web/4.0.0-dev';
  H.DATA_VERSION = 4790;

  // ---- 材料小样：屋顶 3 种，白墙 2 种（工作台还能换着看；默认见 DEFAULTS）----
  // 两色屋顶从挑檐那排起：丛林木、云杉木、丛林木……（和草图时一样：挑檐丛林木，屋脊那两排云杉木）
  const ROOFS = {
    two: { label: '两色交替（jungle + spruce）', name: '两色屋顶', wood: (y) => ((y - EAVE_Y) % 2 === 0 ? 'jungle' : 'spruce'), cap: 'spruce' },
    jungle: { label: '单色 jungle', name: '丛林木屋顶', wood: () => 'jungle', cap: 'jungle' },
    spruce: { label: '单色 spruce', name: '云杉木屋顶', wood: () => 'spruce', cap: 'spruce' },
  };
  const WALLS = {
    calcite: { label: '方解石（calcite）', name: '方解石墙', block: 'calcite' },
    quartz: { label: '平滑石英（smooth_quartz）', name: '平滑石英墙', block: 'smooth_quartz' },
  };
  H.roofs = Object.freeze(Object.keys(ROOFS).map((id) => Object.freeze({ id, label: ROOFS[id].label })));
  H.walls = Object.freeze(Object.keys(WALLS).map((id) => Object.freeze({ id, label: WALLS[id].label })));
  H.DEFAULTS = Object.freeze({ variant: 'b', roof: 'two', wall: 'quartz' });

  // ---- 方块：{id, props}；props 写全，输出时按名字排序 ----
  const NS = 'minecraft:';
  const blk = (name, props) => ({ id: NS + name, props: props || null });
  const stateString = (c) => !c.props ? c.id
    : c.id + '[' + Object.keys(c.props).sort().map((k) => k + '=' + c.props[k]).join(',') + ']';
  const SIDES4 = () => ({ east: 'false', north: 'false', south: 'false', waterlogged: 'false', west: 'false' });
  const B = {
    wall: (mat) => blk(mat.wall.block),
    log: (axis) => blk('stripped_spruce_log', { axis }),
    planks: () => blk('oak_planks'),
    slabBottom: (wood) => blk(wood + '_slab', { type: 'bottom', waterlogged: 'false' }),
    stairs: (wood, facing) => blk(wood + '_stairs', { facing, half: 'bottom', shape: 'straight', waterlogged: 'false' }),
    fence: () => blk('spruce_fence', SIDES4()),
    pane: () => blk('glass_pane', SIDES4()),
    door: (half) => blk('oak_door', { facing: 'north', half, hinge: 'left', open: 'false', powered: 'false' }),
    lantern: (hanging) => blk('lantern', { hanging: hanging ? 'true' : 'false', waterlogged: 'false' }),
  };
  const FULL = new Set(['calcite', 'smooth_quartz', 'stripped_spruce_log', 'oak_planks'].map((n) => NS + n));
  const isFull = (c) => !!c && FULL.has(c.id);
  const isStairs = (c) => !!c && c.id.endsWith('_stairs');
  const isFence = (c) => !!c && c.id.endsWith('_fence');             // 这里只有木栅栏
  const isPane = (c) => !!c && c.id === NS + 'glass_pane';
  const isSlab = (c) => !!c && c.id.endsWith('_slab');

  // ---- 尺寸推算 ----
  function layout(id) {
    const base = VARIANTS[id];
    if (!base) throw new Error('V3.houseMc：没有这个方案：' + id + '（现在只有 ' + Object.keys(VARIANTS).join(' / ') + '；方案 A 在提交 d3440c4 里）');
    const v = Object.assign({}, base);
    v.D = v.z1 - v.z0 + 1;                 // 南北外墙进深（10）
    v.Wd = v.x1 - v.x0 + 1;                // 东西外墙宽（14）
    if (v.D % 2) throw new Error('进深要是双数，屋脊才是两排背靠背的台阶');
    v.ridgeY = EAVE_Y + v.D / 2;           // 屋脊那两排台阶的 y（10），盖板在 ridgeY + 1，顶 = ridgeY + 1.5
    v.ridgeZ = v.z1 + 1 - v.D / 2;         // 屋脊南排的 z（−11），北排 = ridgeZ − 1
    v.stairX = v.x1 - 1;                   // 楼梯贴着东墙
    v.midX = Math.floor((v.x0 + 1 + v.x1) / 2);
    v.minX = v.x0 - 1; v.maxX = v.x1 + 1;  // 挑檐 / 门廊各宽出 1 格
    v.minZ = v.z0 - 1; v.maxZ = -3;        // 北边挑檐 1 格；南边到台阶那一排
    // 鲸图的范围（P5 第 3 轮起包住屋外的小物件：沙滩休闲角、木箱、台阶前的盆栽和地垫；FURNITURE.md 第 9 节）。
    // 房子本身（门廊、屋檐）照旧按 minX..maxX 盖，只有格子和鲸图用 bx0..bx1、bz0..bz1
    v.bx0 = Math.min(v.minX, YARD.x0); v.bx1 = Math.max(v.maxX, YARD.x1);
    v.bz0 = Math.min(v.minZ, YARD.z0); v.bz1 = Math.max(v.maxZ, YARD.z1);
    return v;
  }
  // 主屋顶（屋脊东西向）：南坡朝北、北坡朝南；挑檐那排 y=EAVE_Y，往里每排高 1
  const hMain = (v, z) => EAVE_Y + Math.min(v.z1 + 1 - z, z - (v.z0 - 1));
  const faceMain = (v, z) => (v.z1 + 1 - z <= z - (v.z0 - 1) ? 'north' : 'south');
  // 小山墙屋顶（屋脊南北向，x = −2）：西坡朝东、东坡朝西，中间那格放下半砖
  const hCross = (x) => EAVE_Y + Math.min(x - (CX0 - 1), CX1 + 1 - x);
  const faceCross = (x) => { const l = x - (CX0 - 1), r = CX1 + 1 - x; return l < r ? 'east' : l > r ? 'west' : null; };

  // ---- 格子：只存非空气；越界当空气 ----
  function makeGrid(v) {
    const W = v.bx1 - v.bx0 + 1, L = v.bz1 - v.bz0 + 1, Ht = v.ridgeY + 2;   // 最上一层是屋脊盖板
    const cells = new Array(W * Ht * L).fill(null), parts = new Array(W * Ht * L).fill(null);
    const at = (x, y, z) => (x < v.bx0 || x > v.bx1 || y < 0 || y >= Ht || z < v.bz0 || z > v.bz1) ? -1
      : (x - v.bx0) + (z - v.bz0) * W + y * W * L;
    return {
      W, H: Ht, L, cells, parts,
      get(x, y, z) { const i = at(x, y, z); return i < 0 ? null : cells[i]; },
      set(x, y, z, c, part) {
        const i = at(x, y, z);
        if (i < 0) throw new Error('V3.houseMc：格子出界 ' + [x, y, z].join(','));
        if (c && !part) throw new Error('V3.houseMc：方块没写部件 ' + [x, y, z].join(','));
        cells[i] = c || null; parts[i] = c ? part : null;
      },
      pos(i) { return [v.bx0 + (i % W), Math.floor(i / (W * L)), v.bz0 + Math.floor(i / W) % L]; },
    };
  }
  // ---- 外墙：四面墙各是一条线，每格一个字母：P 木柱、D 门、W 窗、. 白墙 ----
  // 开口：南墙西南窗 x −5..−4、门 x −2（两边 −3、−1 是门柱）、东南窗 x 1..2；北窗 x 0；东西窗 z −8。
  // 一段白墙连着 ≥ 4 格，就在中间加一根柱子（起点 + floor(长/2)），像小屋 2.0 那样把长墙分开。
  function wallLines(v) {
    const mk = (along, fixed, from, to, label, opens) => {
      const codes = new Map(), wins = new Map();
      for (let a = from; a <= to; a++) codes.set(a, '.');
      for (const [a, code, part] of opens) { codes.set(a, code); if (part) wins.set(a, part); }
      let run = [];
      const flush = () => { if (run.length >= 4) codes.set(run[0] + Math.floor(run.length / 2), 'P'); run = []; };
      for (let a = from; a <= to; a++) { if (codes.get(a) === '.') run.push(a); else flush(); }
      flush();
      return { along, fixed, from, to, part: '墙/' + label, codes, wins };
    };
    return [
      mk('x', v.z1, v.x0 + 1, v.x1 - 1, '南墙', [[-5, 'W', '门窗/西南窗'], [-4, 'W', '门窗/西南窗'], [-3, 'P'],
        [DOOR_X, 'D', '门窗/门'], [-1, 'P'], [1, 'W', '门窗/东南窗'], [2, 'W', '门窗/东南窗']]),
      mk('x', v.z0, v.x0 + 1, v.x1 - 1, '北墙', [[0, 'W', '门窗/北窗']]),
      mk('z', v.x0, v.z0 + 1, v.z1 - 1, '西墙', [[-8, 'W', '门窗/西窗']]),
      mk('z', v.x1, v.z0 + 1, v.z1 - 1, '东墙', [[-8, 'W', '门窗/东窗']]),
    ];
  }

  // 墙身 + 两层地板。y=0 地梁（门坐在上面）；y=1–3 白墙、柱子、门窗（门 y=1–2、窗 y=2，上面 y=3 都是白墙）；
  // y=4 腰梁；南北墙 y=5 是阁楼矮墙（东西两面 y ≥ 5 归山墙）。
  // 一楼地板 = y=0 一层木板（地面 1 米）；阁楼地板 = y=4 一层整块木板（4–5 米），一楼净高 3 米；
  // 正中 x = midX 那一条换成整根木梁（灯梁），一楼的灯笼吊在它下面。
  function buildShell(g, v, mat) {
    for (let x = v.x0 + 1; x < v.x1; x++) for (let z = v.z0 + 1; z < v.z1; z++) {
      g.set(x, 0, z, B.planks(), '一楼/地板');
      if (x === v.midX) g.set(x, BEAM_Y, z, B.log('z'), '一楼/灯梁');
      else g.set(x, BEAM_Y, z, B.planks(), '阁楼/地板');
    }
    for (const x of [v.x0, v.x1]) for (const z of [v.z0, v.z1]) for (let y = 0; y <= LOFT_Y; y++) g.set(x, y, z, B.log('y'), '墙/木柱');
    for (const w of wallLines(v)) {
      for (let a = w.from; a <= w.to; a++) {
        const x = w.along === 'x' ? a : w.fixed, z = w.along === 'x' ? w.fixed : a;
        const code = w.codes.get(a), win = w.wins.get(a);
        g.set(x, 0, z, B.log(w.along), '墙/地梁');
        for (let y = 1; y < BEAM_Y; y++) {
          if (code === 'P') g.set(x, y, z, B.log('y'), '墙/木柱');
          else if (code === 'D' && y <= 2) g.set(x, y, z, B.door(y === 1 ? 'lower' : 'upper'), win);
          else if (code === 'W' && y === 2) g.set(x, y, z, B.pane(), win);
          else g.set(x, y, z, B.wall(mat), w.part);
        }
        g.set(x, BEAM_Y, z, B.log(w.along), '墙/腰梁');
        if (w.along === 'x') g.set(x, LOFT_Y, z, B.wall(mat), '阁楼/矮墙');
      }
    }
  }

  // 东西山墙：从 y=5 补到屋顶台阶下面；屋脊那两排开 2×2 的窗（y 6–7，离阁楼地板 1 米）
  function buildGables(g, v, mat) {
    for (const [x, name] of [[v.x0, '西'], [v.x1, '东']]) {
      for (let z = v.z0 + 1; z < v.z1; z++) for (let y = LOFT_Y; y < hMain(v, z); y++) {
        const win = (z === v.ridgeZ || z === v.ridgeZ - 1) && (y === LOFT_Y + 1 || y === LOFT_Y + 2);
        g.set(x, y, z, win ? B.pane() : B.wall(mat), win ? '门窗/' + name + '山墙窗' : '阁楼/' + name + '山墙');
      }
    }
  }

  // 屋顶：主屋顶（屋脊东西向）+ 朝海的小山墙屋顶（屋脊南北向，正对着门）。四边各挑出 1 格。
  // 每一列 (x,z) 只放一块：小山墙比主屋顶高就用小山墙的，一样高算主屋顶的。
  // 屋脊是两排背靠背的台阶，上面各铺一排下半砖当盖板（含山墙挑檐那两格）。
  function buildRoof(g, v, mat) {
    const R = mat.roof;
    for (let x = v.minX; x <= v.maxX; x++) for (let z = v.z0 - 1; z <= v.z1 + 1; z++) {
      const hm = hMain(v, z);
      // 小山墙只在南坡（朝海那面）；北坡靠北墙那边主屋顶也低，不限制的话小山墙会从北边冒出来
      const hc = x >= CX0 - 1 && x <= CX1 + 1 && faceMain(v, z) === 'north' ? hCross(x) : -1;
      if (hc > hm) {
        const f = faceCross(x);
        g.set(x, hc, z, f ? B.stairs(R.wood(hc), f) : B.slabBottom(R.cap), '屋顶/小山墙屋顶');
        if (z === v.z1) for (let y = LOFT_Y + 1; y < hc; y++) {   // 小山墙的白墙三角（y=5 是矮墙），正中一扇小窗
          const win = x === DOOR_X && y === LOFT_Y + 1;
          g.set(x, y, z, win ? B.pane() : B.wall(mat), win ? '门窗/小山墙窗' : '阁楼/小山墙');
        }
      } else {
        const part = z === v.ridgeZ || z === v.ridgeZ - 1 ? '屋顶/屋脊' : z > v.ridgeZ ? '屋顶/南坡' : '屋顶/北坡';
        g.set(x, hm, z, B.stairs(R.wood(hm), faceMain(v, z)), part);
      }
    }
    // 屋脊盖板：半砖的外半边下面是台阶低的那半，留半格空（MC 里常见的样子，用户同意了）
    for (let x = v.minX; x <= v.maxX; x++) for (const z of [v.ridgeZ, v.ridgeZ - 1]) g.set(x, v.ridgeY + 1, z, B.slabBottom(R.cap), '屋顶/屋脊盖板');
  }

  // 室内楼梯：贴东墙，从北墙根往南上 4 级，每级 1 米，底下用木板填实（stairZ − 1 是上楼前站的那格，紧贴北墙）。
  // 最上一级在阁楼地板那一层（y=4），出口往南。
  // 阁楼地板在楼梯上方开 4 格的洞：站的那格 + 前三级的上方（和草图时一样「站的那格 + 除最上一级以外的每一级」）。
  // 洞北边是矮墙，西边围一排栅栏。
  function buildStairs(g, v) {
    const x = v.stairX, z = v.stairZ, n = BEAM_Y;
    for (let k = 0; k < n; k++) {
      g.set(x, 1 + k, z + k, B.stairs('oak', 'south'), '一楼/楼梯');
      for (let y = 1; y <= k; y++) g.set(x, y, z + k, B.planks(), '一楼/楼梯');
    }
    for (let dz = -1; dz <= n - 2; dz++) {
      g.set(x, BEAM_Y, z + dz, null);
      g.set(x - 1, LOFT_Y, z + dz, B.fence(), '阁楼/楼梯口栏杆');
    }
  }

  // 门廊：和室内地板一样高（1.0 米），进深 3 格（最外一排是栏杆，能走的 2 米），左右各比房子宽 1 格；
  // 台阶 3 格宽正对着门，一级。
  function buildPorch(g, v) {
    for (let x = v.minX; x <= v.maxX; x++) for (let z = -6; z <= -4; z++) g.set(x, 0, z, B.planks(), '门廊/地板');
    for (let x = v.minX; x <= v.maxX; x++) if (x < -3 || x > -1) g.set(x, 1, -4, B.fence(), '门廊/栏杆');
    for (const x of [v.minX, v.maxX]) for (const z of [-6, -5]) g.set(x, 1, z, B.fence(), '门廊/栏杆');
    for (let x = -3; x <= -1; x++) g.set(x, 0, -3, B.stairs('oak', 'north'), '门廊/台阶');
  }

  // 灯：一楼吊在灯梁下（餐桌上方，灯底离地板约 2 米，人走得过去）；阁楼吊在屋脊台阶下；门廊 4 盏站在栏杆柱上（两头 + 台阶两边）
  // P5 家具（模组「小鲸鱼之家」的方块，docs/FURNITURE.md 第 1、2 节）：床 1 × 2（床头朝北）、餐桌 1 格（一楼吊灯正下方）、贝壳柜 2 格（阁楼西墙，正面朝东）。
  // 状态写全、按名字排；两格的两格都写（另一格不对的话游戏会把它算成空气，/shapes 能查出来）。
  const XJY = 'xiaojingyu:';
  const mod = (name, props) => ({ id: XJY + name, props });
  function buildFurniture(g, v) {
    g.set(-6, 1, -14, mod('bed', { facing: 'north', part: 'foot' }), '家具/床');
    g.set(-6, 1, -15, mod('bed', { facing: 'north', part: 'head' }), '家具/床');
    g.set(v.midX, 1, v.lampZ, mod('dining_table', { facing: 'south' }), '家具/餐桌');   // 朝南：和体素版一样，杯子在南边（44-furn-mc 的规格）
    g.set(-6, LOFT_Y, -10, mod('shell_case', { facing: 'east', part: 'left' }), '家具/贝壳收集柜');   // 正面朝东：站在东边看，左手是南
    g.set(-6, LOFT_Y, -11, mod('shell_case', { facing: 'east', part: 'right' }), '家具/贝壳收集柜');
    for (const [id, facing, xs, ys, zs] of FURN2) placeFurn(g, id, facing, xs, ys, zs);
  }
  // 第 2 轮（docs/FURNITURE.md 8.1、8.2）：[方块 id, facing, [x0, x1], [y0, y1], [z0, z1]]（场景格子，两头都算）
  const FURN2 = [
    ['nightstand', 'south', [-5, -5], [1, 1], [-15, -15]], ['bookshelf', 'south', [-4, -4], [1, 2], [-15, -15]],
    ['kitchen_counter', 'south', [-2, 1], [1, 1], [-15, -15]], ['spice_rack', 'south', [-1, -1], [2, 2], [-15, -15]],
    ['mini_fridge', 'south', [2, 2], [1, 1], [-15, -15]],
    ['dining_chair', 'east', [-1, -1], [1, 1], [-12, -12]], ['dining_chair', 'west', [1, 1], [1, 1], [-12, -12]],
    ['desk', 'east', [-6, -6], [1, 1], [-11, -10]], ['desk_chair', 'west', [-5, -5], [1, 1], [-11, -11]],
    ['picture_frames', 'east', [-6, -6], [2, 2], [-11, -10]], ['rocking_chair', 'west', [-5, -5], [1, 1], [-8, -8]],
    ['tv_stand', 'west', [5, 5], [1, 1], [-10, -9]], ['sofa', 'east', [2, 2], [1, 1], [-10, -9]],
    ['living_rug', 'south', [3, 4], [1, 1], [-10, -9]], ['floor_plant', 'south', [5, 5], [1, 1], [-8, -8]],
    ['door_mat', 'south', [-2, -2], [1, 1], [-8, -8]],
    ['photo_album_table', 'south', [-2, -2], [LOFT_Y, LOFT_Y], [-11, -11]], ['floor_cushions', 'south', [-3, -2], [LOFT_Y, LOFT_Y], [-10, -10]],
    ['window_seat', 'north', [-2, -1], [LOFT_Y, LOFT_Y], [-8, -8]], ['telescope', 'south', [0, 0], [LOFT_Y, LOFT_Y], [-8, -8]],
    ['storage_chests', 'south', [-3, -2], [LOFT_Y, LOFT_Y], [-15, -15]], ['beanbag', 'south', [1, 1], [LOFT_Y, LOFT_Y], [-9, -9]],
  ];
  for (let x = -6; x <= 5; x++) FURN2.push(['string_lights', 'north', [x, x], [9, 9], [-12, -12]]);   // 一格一段，挂在屋脊台阶下
  // 第 3 轮：屋外的小物件（FURNITURE.md 9.1），格式同 FURN2
  const FURN3 = [
    ['beach_lounger', 'south', [-11, -11], [0, 0], [4, 5]], ['beach_lounger_hat', 'south', [-9, -9], [0, 0], [4, 5]],
    ['beach_table', 'south', [-10, -10], [0, 0], [4, 4]], ['beach_parasol', 'south', [-10, -10], [0, PARASOL_H - 1], [5, 5]],
    ['crate_lantern', 'south', [8, 8], [0, 0], [-4, -4]],
    ['flower_box_purple', 'south', [-5, -4], [1, 1], [-6, -6]], ['flower_box_pink', 'south', [1, 2], [1, 1], [-6, -6]],
    ['towel_hook', 'south', [0, 0], [1, 1], [-6, -6]], ['wind_chime', 'south', [-2, -2], [3, 3], [-6, -6]],
    ['wall_lantern', 'south', [-3, -3], [2, 2], [-6, -6]], ['wall_lantern', 'south', [-1, -1], [2, 2], [-6, -6]],
    ['potted_fern', 'south', [-7, -7], [1, 1], [-5, -5]], ['hanging_basket', 'west', [7, 7], [2, 2], [-5, -5]],
    ['flower_pot', 'south', [1, 1], [0, 0], [-3, -3]],
    ['succulents', 'south', [-4, -4], [0, 0], [-3, -3]], ['succulents', 'south', [0, 0], [0, 0], [-3, -3]], ['succulents', 'south', [1, 1], [2, 2], [-4, -4]],
    ['step_mat', 'south', [-2, -1], [0, 0], [-2, -2]],
  ];
  for (const r of FURN3) FURN2.push(r);
  const FURN3_LABEL = {
    beach_lounger: '沙滩躺椅（毛巾）', beach_lounger_hat: '沙滩躺椅（草帽）', beach_table: '小圆桌', beach_parasol: '遮阳伞', crate_lantern: '木箱和灯笼',
    flower_box_purple: '花箱（紫花）', flower_box_pink: '花箱（粉花）', towel_hook: '毛巾', wind_chime: '贝壳风铃', wall_lantern: '门边壁灯',
    potted_fern: '盆栽（门廊西角）', hanging_basket: '吊篮', flower_pot: '花盆', succulents: '多肉', step_mat: '台阶下地垫',
  };
  const FURN2_LABEL = {
    nightstand: '床头柜', bookshelf: '书架', kitchen_counter: '厨房台面', spice_rack: '调料罐架', mini_fridge: '小冰箱', dining_chair: '餐椅',
    desk: '书桌', desk_chair: '书桌椅', picture_frames: '画框', rocking_chair: '摇椅', tv_stand: '电视柜', sofa: '小沙发',
    living_rug: '地毯和小茶几', floor_plant: '大盆栽', door_mat: '门口地垫', photo_album_table: '相册矮桌', floor_cushions: '坐垫',
    window_seat: '窗边坐垫', telescope: '望远镜', storage_chests: '储物箱', beanbag: '懒人沙发', string_lights: '串灯',
  };
  Object.assign(FURN2_LABEL, FURN3_LABEL);
  // 平面图和工作台用：每件家具方块占的格子（场景米的盒子，含两头的下一格边）、楼层、正面朝向
  function furnBlocks() {
    const out = [
      { id: 'bed', label: '床', level: 'ground', box: [-6, 1, -15, -5, 2, -13], facing: 'north', block: true },
      { id: 'dining_table', label: '餐桌', level: 'ground', box: [0, 1, -12, 1, 2, -11], facing: 'south', block: true },
      { id: 'shell_case', label: '贝壳收集柜', level: 'loft', box: [-6, LOFT_Y, -11, -5, LOFT_Y + 1, -9], facing: 'east', block: true },
    ];
    for (const [id, facing, xs, ys, zs] of FURN2) {
      if (id === 'string_lights') continue;
      out.push({ id, label: FURN2_LABEL[id], level: ys[0] >= LOFT_Y ? 'loft' : 'ground', box: [xs[0], ys[0], zs[0], xs[1] + 1, ys[1] + 1, zs[1] + 1], facing, block: true });
    }
    const sl = FURN2.filter((r) => r[0] === 'string_lights');
    if (sl.length) out.push({ id: 'string_lights', label: '串灯', level: 'loft', facing: 'north', block: true,
      box: [Math.min(...sl.map((r) => r[2][0])), 9, sl[0][4][0], Math.max(...sl.map((r) => r[2][1])) + 1, 10, sl[0][4][0] + 1] });
    return out;
  }
  H.FURN2 = FURN2.map((r) => r.slice());
  H.FURN2_LABEL = Object.assign({}, FURN2_LABEL);
  // 世界格子 → 朝北时的本地格子 (cx, cz)（8.1：east (cx,cz)→(−cz,+cx)，south →(−cx,−cz)，west →(+cz,−cx)，都相对主格），本地宽 w、深 d
  function localCell(facing, xs, zs, x, z) {
    const sx = xs[1] - xs[0] + 1, sz = zs[1] - zs[0] + 1;
    if (facing === 'north') return { cx: x - xs[0], cz: z - zs[0], w: sx, d: sz };
    if (facing === 'south') return { cx: xs[1] - x, cz: zs[1] - z, w: sx, d: sz };
    if (facing === 'east') return { cx: z - zs[0], cz: xs[1] - x, w: sz, d: sx };
    return { cx: zs[1] - z, cz: x - xs[0], w: sz, d: sx };   // west
  }
  function placeFurn(g, id, facing, xs, ys, zs) {
    const h = ys[1] - ys[0] + 1;
    for (let y = ys[0]; y <= ys[1]; y++) for (let x = xs[0]; x <= xs[1]; x++) for (let z = zs[0]; z <= zs[1]; z++) {
      const { cx, cz, w, d } = localCell(facing, xs, zs, x, z), n = w * d * h;
      const props = n > 1 ? { facing, part: String(cx + w * (cz + d * (y - ys[0]))) } : { facing };
      g.set(x, y, z, mod(id, props), '家具/' + FURN2_LABEL[id]);
    }
  }
  function buildLights(g, v) {
    g.set(v.midX, BEAM_Y - 1, v.lampZ, B.lantern(true), '一楼/吊灯');
    g.set(DOOR_X, v.ridgeY - 1, v.ridgeZ, B.lantern(true), '阁楼/吊灯');
    for (const x of [v.minX, -4, 0, v.maxX]) g.set(x, 2, -4, B.lantern(false), '门廊/灯');
  }
  // ---- 连接：整栋摆好以后，照 26.1 源码算楼梯形状、栅栏和玻璃板的四边 ----
  const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' };
  const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
  const axisOf = (d) => (d === 'north' || d === 'south' ? 'z' : 'x');
  const near = (g, x, y, z, d) => g.get(x + DIRS[d][0], y, z + DIRS[d][1]);

  // StairBlock.getStairsShape：先看背后（facing 那边）有没有横着的楼梯 → 外角；再看前面 → 内角；都没有 → 直的
  function stairShape(g, x, y, z, c) {
    const f = c.props.facing, half = c.props.half;
    const canTake = (d) => { const n = near(g, x, y, z, d); return !isStairs(n) || n.props.facing !== f || n.props.half !== half; };
    const behind = near(g, x, y, z, f);
    if (isStairs(behind) && behind.props.half === half) {
      const bf = behind.props.facing;
      if (axisOf(bf) !== axisOf(f) && canTake(OPP[bf])) return bf === CCW[f] ? 'outer_left' : 'outer_right';
    }
    const front = near(g, x, y, z, OPP[f]);
    if (isStairs(front) && front.props.half === half) {
      const ff = front.props.facing;
      if (axisOf(ff) !== axisOf(f) && canTake(ff)) return ff === CCW[f] ? 'inner_left' : 'inner_right';
    }
    return 'straight';
  }

  // FenceBlock.connectsTo / IronBarsBlock.attachsTo：旁边是整块（那一面结实）或者同一类，就连上。
  // 旁边要是别的半格方块（台阶、半砖、门、灯笼…），连不连要看它的形状；这栋房子里没有这种情况，碰到就报错，免得算错。
  function connect(g) {
    g.cells.forEach((c, i) => {
      if (!c) return;
      const [x, y, z] = g.pos(i);
      if (isStairs(c)) { c.props.shape = stairShape(g, x, y, z, c); return; }
      if (!isFence(c) && !isPane(c)) return;
      for (const d of Object.keys(DIRS)) {
        const n = near(g, x, y, z, d);
        // 模组家具（P5）那一面都不是完整的实心面（碰撞盒只是模型的外包盒，这栋房子里栅栏旁边只有盆栽），不连；开发 MC 的 /shapes 会核对
        if (n && n.id.startsWith(XJY)) { c.props[d] = 'false'; continue; }
        if (n && !isFull(n) && !isFence(n) && !isPane(n)) {
          throw new Error('V3.houseMc：' + c.id + ' 旁边是 ' + n.id + '（' + [x, y, z].join(',') + ' 的 ' + d + ' 边），连不连没算');
        }
        c.props[d] = String(isFull(n) || (isFence(c) ? isFence(n) : isPane(n)));
      }
    });
  }

  // 放不放得住：站着的灯笼要下面那块「上表面中间」结实，吊着的要上面那块「下表面中间」结实（Block.canSupportCenter）；
  // 门的下半要坐在整块上，上半要在它正上方。
  function centerSturdy(c, face) {
    if (!c) return false;
    if (isFull(c)) return true;
    if (face === 'up') return isFence(c) || (isSlab(c) && c.props.type === 'top') || (isStairs(c) && c.props.half === 'top');
    return (isSlab(c) && c.props.type === 'bottom') || (isStairs(c) && c.props.half === 'bottom');
  }
  function checkSupports(g) {
    g.cells.forEach((c, i) => {
      if (!c) return;
      const [x, y, z] = g.pos(i), where = [x, y, z].join(',');
      if (c.id === NS + 'lantern') {
        const hanging = c.props.hanging === 'true';
        if (!centerSturdy(g.get(x, hanging ? y + 1 : y - 1, z), hanging ? 'down' : 'up')) throw new Error('V3.houseMc：灯笼放不住 ' + where);
      } else if (c.id.endsWith('_door') && c.props.half === 'lower') {
        const up = g.get(x, y + 1, z);
        if (!isFull(g.get(x, y - 1, z))) throw new Error('V3.houseMc：门下面没有整块 ' + where);
        if (!up || up.id !== c.id || up.props.half !== 'upper') throw new Error('V3.houseMc：门上半不对 ' + where);
      }
    });
  }

  // ---- 写成 V3.share 的模型（规范形式：调色板按第一次出现排，没有方块实体，没有警告）----
  // 名字：默认材料就叫「小鲸鱼之家 v4」；换了材料小样，括号里写换了的那几样
  function modelName(roofId, wallId) {
    const alt = [];
    if (roofId !== H.DEFAULTS.roof) alt.push(ROOFS[roofId].name);
    if (wallId !== H.DEFAULTS.wall) alt.push(WALLS[wallId].name);
    return '小鲸鱼之家 v4' + (alt.length ? '（' + alt.join('、') + '）' : '');
  }
  function toModel(g, v, name) {
    const palette = [], ids = new Map(), cells = new Int32Array(g.cells.length);
    g.cells.forEach((c, i) => {
      const s = c ? stateString(c) : NS + 'air';
      let id = ids.get(s);
      if (id === undefined) { id = palette.length; palette.push(s); ids.set(s, id); }
      cells[i] = id;
    });
    const meta = { compound: {
      Name: { string: name },
      Author: { string: 'Moci' },
      Xiaojingyu: { compound: {
        FormatVersion: { int: 1 },
        Facing: { string: 'north' },
        Origin: { intArray: ORIGIN.slice() },
        Source: { string: H.SOURCE },
      } },
    } };
    // 规范形式：RequiredMods 按调色板算（不是 minecraft 的命名空间，排好序，放在最后；FORMAT.md 第 3 节），写文件时编解码器也这样算
    const mods = [...new Set(palette.map((s) => { const k = s.indexOf('['), id = k < 0 ? s : s.slice(0, k), c = id.indexOf(':'); return c < 0 ? 'minecraft' : id.slice(0, c); }))]
      .filter((n) => n !== 'minecraft').sort();
    if (mods.length) meta.compound.RequiredMods = { list: mods.map((m) => ({ string: m })) };
    return {
      size: [g.W, g.H, g.L],
      offset: [v.bx0 - ORIGIN[0], 0 - ORIGIN[1], v.bz0 - ORIGIN[2]],   // 格子 (0,0,0) = Origin + Offset
      dataVersion: H.DATA_VERSION, meta, palette, cells, blockEntities: H.furnBlockEntities(palette, cells, g.W, g.L), warnings: [],
    };
  }
  // 带方块实体的家具（docs/PHOTOS.md 第 2 节）：相册矮桌、相框、画框墙（只在 part=0 那格）。MC 里放下就一定有方块实体，
  // 所以鲸图里也写一条，Data 是空 compound（相册、照片都没有）；格子编号 = x + z·W + y·W·L，pos 相对第 (0,0,0) 格
  const BE_RE = /^xiaojingyu:(photo_album_table|photo_frame|picture_frames)(?:\[(.*)\])?$/;
  H.furnBlockEntity = (state) => {
    const m = BE_RE.exec(String(state));
    if (!m || (m[1] === 'picture_frames' && !/(^|,)part=0(,|$)/.test(m[2] || ''))) return null;
    return 'xiaojingyu:' + m[1];
  };
  H.furnBlockEntities = (palette, cells, W, L) => {
    const ids = palette.map(H.furnBlockEntity), out = [];
    for (let i = 0; i < cells.length; i++) {
      const id = ids[cells[i]];
      if (id) out.push({ pos: [i % W, Math.floor(i / (W * L)), Math.floor(i / W) % L], id, data: { compound: {} } });
    }
    return out;
  };
  // ---- 家具占位（不写进鲸图）：[id, x0, x1, z0, z1, 高, 离地高(挂墙、吊着的才写), 说明] ----
  // 场景米；离地高不写就放在自己那层的地面上（一楼 1 米、阁楼 5 米）。位置照小屋 2.0（web/src/40-layout.js），
  // 靠墙的家具跟着墙走（北墙那一排往北挪了 1.25 米，东西两边各 0.25 米）。
  const FURN_LABEL = {
    bed: '床', nightstand: '床头柜', bookshelf: '书架', kitchen: '厨房台面', jars: '调料罐架', fridge: '小冰箱',
    dining: '餐桌', chairW: '餐椅（西）', chairE: '餐椅（东）', desk: '书桌', deskChair: '书桌椅', frames: '画框',
    rocking: '摇椅', tv: '电视柜', sofa: '小沙发', rug: '地毯', coffee: '小茶几', plant: '大盆栽', mat: '门口地垫',
    shellCase: '贝壳收集柜', album: '相册矮桌', cushions: '坐垫', seat: '窗边坐垫', scope: '望远镜', chests: '储物箱',
    beanbag: '懒人沙发', lights: '串灯',
  };
  const LIGHTS_NOTE = '只是示意；真的灯是屋脊下吊的那盏灯笼';
  // P5 起家具都是模组方块（buildFurniture），这里不再有占位盒子；接口照旧（furniture 是空的）
  const FURN = { ground: [], loft: [] };
  const round3 = (n) => Math.round(n * 1000) / 1000;
  function furniture(v) {
    const out = [];
    for (const level of ['ground', 'loft']) for (const [id, x0, x1, z0, z1, h, yAt, note] of FURN[level]) {
      // 串灯挂在屋脊下面一点（ridgeY − 0.1）
      const y0 = yAt === 'ridge' ? round3(v.ridgeY - 0.1) : yAt != null ? yAt : (level === 'ground' ? 1 : LOFT_Y);
      const f = { id, label: FURN_LABEL[id], level, box: [x0, y0, z0, x1, round3(y0 + h), z1] };
      if (note) f.note = note;
      out.push(f);
    }
    return out;
  }

  // ---- 部件名、楼层、站位点、尺寸说明 ----
  const LABELS = {
    '墙': '外墙', '墙/南墙': '南墙', '墙/北墙': '北墙', '墙/东墙': '东墙', '墙/西墙': '西墙', '墙/木柱': '木柱', '墙/地梁': '地梁', '墙/腰梁': '腰梁',
    '门窗': '门窗', '门窗/门': '门', '门窗/西南窗': '西南窗', '门窗/东南窗': '东南窗', '门窗/西窗': '西窗', '门窗/东窗': '东窗', '门窗/北窗': '北窗',
    '门窗/西山墙窗': '西山墙窗', '门窗/东山墙窗': '东山墙窗', '门窗/小山墙窗': '小山墙窗',
    '一楼': '一楼', '一楼/地板': '一楼地板', '一楼/楼梯': '楼梯', '一楼/灯梁': '灯梁', '一楼/吊灯': '一楼的灯',
    '阁楼': '阁楼', '阁楼/地板': '阁楼地板', '阁楼/楼梯口栏杆': '楼梯口栏杆', '阁楼/矮墙': '阁楼矮墙',
    '阁楼/西山墙': '西山墙', '阁楼/东山墙': '东山墙', '阁楼/小山墙': '朝海的小山墙', '阁楼/吊灯': '阁楼的灯',
    '屋顶': '屋顶', '屋顶/南坡': '南坡', '屋顶/北坡': '北坡', '屋顶/屋脊': '屋脊', '屋顶/屋脊盖板': '屋脊盖板', '屋顶/小山墙屋顶': '小山墙屋顶',
    '门廊': '门廊', '门廊/地板': '门廊地板', '门廊/栏杆': '栏杆', '门廊/台阶': '台阶', '门廊/灯': '门廊的灯',
    '家具': '家具', '家具/床': '床（模组方块）', '家具/餐桌': '餐桌（模组方块）', '家具/贝壳收集柜': '贝壳收集柜（模组方块）',
    '家具/床头柜': '床头柜', '家具/书架': '书架', '家具/厨房台面': '厨房台面', '家具/调料罐架': '调料罐架', '家具/小冰箱': '小冰箱', '家具/餐椅': '餐椅',
    '家具/书桌': '书桌', '家具/书桌椅': '书桌椅', '家具/画框': '画框', '家具/摇椅': '摇椅', '家具/电视柜': '电视柜', '家具/小沙发': '小沙发',
    '家具/地毯和小茶几': '地毯和小茶几', '家具/大盆栽': '大盆栽', '家具/门口地垫': '门口地垫', '家具/相册矮桌': '相册矮桌', '家具/坐垫': '坐垫',
    '家具/窗边坐垫': '窗边坐垫', '家具/望远镜': '望远镜', '家具/储物箱': '储物箱', '家具/懒人沙发': '懒人沙发', '家具/串灯': '串灯（一格一段）',
  };
  for (const l of Object.values(FURN3_LABEL)) LABELS['家具/' + l] = l;   // 第 3 轮屋外的家具
  const LEVELS = [
    { id: 'ground', label: '一楼', y0: 0, y1: BEAM_Y - 1, floorY: 1 },
    { id: 'loft', label: '阁楼', y0: BEAM_Y, y1: LOFT_Y, floorY: LOFT_Y },
  ];
  // 站位点：脚底的场景米坐标（格子正中）。楼梯上 = 最上一级后面那格（阁楼地板上）
  function anchors(v) {
    return [
      ['steps', '台阶前', [-1.5, 0, -1.5]], ['door_out', '门外', [-1.5, 1, -5.5]], ['door_in', '门里', [-1.5, 1, -7.5]],
      ['ground_mid', '一楼中间', [v.midX + 0.5, 1, v.ridgeZ + 0.5]], ['stair_bottom', '楼梯下', [v.stairX + 0.5, 1, v.stairZ - 0.5]],
      ['stair_top', '楼梯上', [v.stairX + 0.5, LOFT_Y, v.stairZ + BEAM_Y + 0.5]], ['loft_mid', '阁楼中间', [v.midX + 0.5, LOFT_Y, v.ridgeZ + 0.5]],
    ].map(([id, label, pos]) => ({ id, label, pos }));
  }
  function info(v, model, roofId, wallId, g) {
    const loftClear = [];
    for (let z = v.z1 - 1; z > v.z0; z--) loftClear.push(hMain(v, z) - LOFT_Y);   // 从南往北，每排阁楼地面到屋顶的净高
    const steps = BEAM_Y;
    return {
      variant: v.id, label: v.label, outer: [v.Wd, v.D], inner: [v.Wd - 2, v.D - 2],
      floorY: 1, groundClear: BEAM_Y - 1, loftFloorY: LOFT_Y, kneeWall: 1, wallTop: LOFT_Y + 1,
      ridgeTop: v.ridgeY + 1.5, cap: true, overhang: 1, loftClear,
      door: { x: DOOR_X, y0: 1, y1: 3, block: 'oak_door' },
      stairs: { x: v.stairX, z0: v.stairZ, z1: v.stairZ + steps - 1, steps, up: 'south', hole: [v.stairZ - 1, v.stairZ + steps - 2] },
      roof: { id: roofId, label: ROOFS[roofId].label, cap: ROOFS[roofId].cap }, wall: { id: wallId, label: WALLS[wallId].label, block: WALLS[wallId].block },
      size: model.size.slice(), blocks: g.cells.filter(Boolean).length, palette: model.palette.length,
      grid: { x0: v.x0, x1: v.x1, z0: v.z0, z1: v.z1, minX: v.minX, maxX: v.maxX, minZ: v.minZ, maxZ: v.maxZ, bx0: v.bx0, bx1: v.bx1, bz0: v.bz0, bz1: v.bz1,
        ridgeY: v.ridgeY, ridgeZ: v.ridgeZ, midX: v.midX, lampZ: v.lampZ, doorX: DOOR_X, cross: [CX0, CX1], beamY: BEAM_Y },
    };
  }

  H.build = function build(opts) {
    const o = opts || {};
    const v = layout(o.variant || H.DEFAULTS.variant);
    const roofId = o.roof || H.DEFAULTS.roof, wallId = o.wall || H.DEFAULTS.wall;
    if (!ROOFS[roofId]) throw new Error('V3.houseMc：没有这种屋顶：' + roofId);
    if (!WALLS[wallId]) throw new Error('V3.houseMc：没有这种墙：' + wallId);
    const mat = { roof: ROOFS[roofId], wall: WALLS[wallId] };
    const g = makeGrid(v);
    buildShell(g, v, mat); buildGables(g, v, mat); buildRoof(g, v, mat);
    buildStairs(g, v); buildPorch(g, v); buildLights(g, v); buildFurniture(g, v);
    connect(g); checkSupports(g);
    const model = toModel(g, v, modelName(roofId, wallId));
    return {
      model, parts: g.parts.slice(), labels: Object.assign({}, LABELS),
      levels: LEVELS.map((l) => Object.assign({}, l)), anchors: anchors(v), furniture: furniture(v), furnBlocks: furnBlocks(),
      info: info(v, model, roofId, wallId, g),
    };
  };
})(window.V3);
