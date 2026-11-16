// share-cases.mjs — 两边共用的「标准答案」样例（fixtures/share/cases/*.json）
//
// 每个 case 用 cell(x, y, z) → 状态字符串 定义每一格，再列出方块实体（pos 是相对坐标，data 是
// FORMAT.md 第 4 节的 typed JSON compound 或 null）。caseDump(name) 直接从定义算出 dump：
// 自己数调色板（按第一次出现）、自己做游程、自己核对 RequiredMods，不经过 web/src/13-share.js，
// 免得读取器「自己证明自己」。

// ---------- typed JSON 小工具 ----------
export const J = Object.freeze({
  byte: (v) => ({ byte: v }),
  short: (v) => ({ short: v }),
  int: (v) => ({ int: v }),
  long: (v) => ({ long: String(v) }),
  float: (hex) => ({ float: hex }),
  double: (hex) => ({ double: hex }),
  string: (v) => ({ string: v }),
  byteArray: (v) => ({ byteArray: v }),
  intArray: (v) => ({ intArray: v }),
  longArray: (v) => ({ longArray: v.map(String) }),
  list: (items) => ({ list: items }),
  compound: (obj) => ({ compound: obj }),
  strings: (arr) => ({ list: arr.map((s) => ({ string: s })) }),
});

// 用 [键, 值] 对建 compound；键可以是 "__proto__"（对象字面量写不出这个键）
export function C(pairs) {
  const o = {};
  for (const [k, v] of pairs) {
    Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  return { compound: o };
}

export const DATA_VERSION = 4790;
export const DATE = '1793923200000';   // 2026-11-06T00:00:00Z

// 标准的 Metadata（FORMAT.md 第 3.1 节）；opts: author, mods（RequiredMods）, facing, origin, extra（多加的键）
export function meta(name, opts = {}) {
  const m = { Name: J.string(name), Author: J.string(opts.author ?? 'tester'), Date: J.long(DATE) };
  if (opts.mods) m.RequiredMods = J.strings(opts.mods);
  m.Xiaojingyu = J.compound({
    FormatVersion: J.int(1),
    Facing: J.string(opts.facing ?? 'north'),
    Origin: J.intArray(opts.origin ?? [0, 64, 0]),
    Dimension: J.string('minecraft:overworld'),
    Source: J.string('haibian-web/4.0.0-dev'),
    GameVersion: J.string('26.1.2'),
  });
  Object.assign(m, opts.extra || {});
  return J.compound(m);
}

const AIR = 'minecraft:air';
const GRASS = 'minecraft:grass_block[snowy=false]';
const CHEST = 'minecraft:chest[facing=north,type=single,waterlogged=false]';
const P0 = [
  GRASS,
  'minecraft:oak_log[axis=x]',
  'minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]',
  CHEST,
  'minecraft:lantern[hanging=false,waterlogged=false]',
  AIR,
];

export const CASES = [];
function def(c) { CASES.push(Object.freeze(c)); }

def({
  name: 'single-stone',
  purpose: '最小的建筑：1 格石头，没有 Metadata',
  size: [1, 1, 1], offset: [0, 0, 0], meta: null,
  cell: () => 'minecraft:stone',
  blockEntities: [],
});

// 摆法要经得起「真的盖进世界」（P2 会把 js/p0-blocks.png 盖进开发世界再读回来比，docs/COMMANDS.md §7）：
// y0 = 草方块、原木、倒置楼梯；y1 = 箱子（在草方块上）、灯笼（hanging=false，正下方是原木）、空气。
// 只有一个箱子、一个楼梯，邻居更新后每格的状态都不变。
def({
  name: 'p0-blocks',
  purpose: 'P0 实测过的 6 个完整状态字符串、负的 Offset、空箱子的方块实体（P0 实测的写法）',
  size: [3, 2, 1], offset: [-1, 0, 2],
  meta: meta('P0 方块', { facing: 'east', origin: [7, -60, 3] }),
  cell: (x, y) => P0[x + y * 3],
  blockEntities: [
    { pos: [0, 1, 0], id: 'minecraft:chest', data: J.compound({ Items: J.list([]), components: J.compound({}) }) },
  ],
});

function item(slot, id, count, components) {
  const o = { Slot: J.byte(slot), id: J.string(id), count: J.int(count) };
  if (components) o.components = J.compound(components);
  return J.compound(o);
}

def({
  name: 'chest-items',
  purpose: '箱子里有物品（MC 26.1：Slot byte、id、count int、components），箱子有自定义名字',
  size: [1, 1, 1], offset: [0, 0, 0],
  meta: meta('一箱宝贝'),
  cell: () => CHEST,
  blockEntities: [{
    pos: [0, 0, 0], id: 'minecraft:chest',
    data: J.compound({
      CustomName: J.string('海边的箱子'),
      Items: J.list([
        item(0, 'minecraft:diamond', 12),
        item(13, 'minecraft:iron_sword', 1, {
          'minecraft:custom_name': J.string('小鲸鱼的剑'),
          'minecraft:enchantments': J.compound({ 'minecraft:sharpness': J.int(3) }),
          'minecraft:damage': J.int(5),
        }),
        item(26, 'minecraft:oak_log', 64),
      ]),
      components: J.compound({}),
    }),
  }],
});

// 5×4×5 的小屋：地板、四面墙（南墙中间有门洞）、半砖屋顶、屋里一盏模组灯、北墙内侧一块告示牌
function house(x, y, z) {
  if (y === 0) return 'minecraft:oak_planks';
  if (y === 3) return 'minecraft:spruce_slab[type=bottom,waterlogged=false]';
  if (x === 2 && y === 1 && z === 2) return 'xiaojingyu:whale_lamp';
  if (x === 2 && y === 2 && z === 1) return 'minecraft:oak_wall_sign[facing=south,waterlogged=false]';
  const edge = x === 0 || x === 4 || z === 0 || z === 4;
  if (!edge || (x === 2 && z === 4)) return AIR;
  return 'minecraft:white_concrete';
}

function signText(lines) {
  return J.compound({ messages: J.strings(lines), color: J.string('black'), has_glowing_text: J.byte(0) });
}

def({
  name: 'small-house',
  purpose: '混一个 xiaojingyu: 命名空间的方块（RequiredMods）、没有 Data 的方块实体、告示牌方块实体',
  size: [5, 4, 5], offset: [-2, 0, -2],
  meta: meta('小鲸鱼的海边小屋', { mods: ['xiaojingyu'], facing: 'south', origin: [100, 64, -20] }),
  cell: house,
  blockEntities: [
    { pos: [2, 1, 2], id: 'xiaojingyu:whale_lamp', data: null },
    {
      pos: [2, 2, 1], id: 'minecraft:sign',
      data: J.compound({
        front_text: signText(['海边小屋', '欢迎 🐳', '', '']),
        back_text: signText(['', '', '', '']),
        is_waxed: J.byte(0),
      }),
    },
  ],
});

// 300 种 redstone_wire 状态：调色板编号 ≥ 128 时 varint 要写 2 字节
const SIDES = ['none', 'side', 'up'];
const WIRES = [];
for (const east of SIDES) for (const north of SIDES) for (let power = 0; power < 16; power++) {
  for (const south of SIDES) for (const west of SIDES) {
    WIRES.push(`minecraft:redstone_wire[east=${east},north=${north},power=${power},south=${south},west=${west}]`);
  }
}

def({
  name: 'big-palette',
  purpose: '300 种状态：调色板编号超过 127，Data 里要用 2 字节 varint；上层倒着排',
  size: [20, 2, 15], offset: [0, 0, 0],
  meta: meta('红石线大全'),
  cell: (x, y, z) => { const i = x + z * 20; return WIRES[y === 0 ? i : 299 - i]; },
  blockEntities: [],
});

function nest(n) { return n === 0 ? J.string('最里面') : J.compound({ ['d' + n]: nest(n - 1) }); }

const NBT_TYPES = J.compound({
  bytes: J.compound({ min: J.byte(-128), max: J.byte(127), zero: J.byte(0), minusOne: J.byte(-1) }),
  shorts: J.compound({ min: J.short(-32768), max: J.short(32767), zero: J.short(0) }),
  ints: J.compound({ min: J.int(-2147483648), max: J.int(2147483647), zero: J.int(0) }),
  longs: J.compound({
    min: J.long('-9223372036854775808'), max: J.long('9223372036854775807'),
    zero: J.long('0'), date: J.long(DATE),
  }),
  floats: J.compound({
    zero: J.float('00000000'), negZero: J.float('80000000'), one: J.float('3f800000'),
    negOne: J.float('bf800000'), max: J.float('7f7fffff'), minNormal: J.float('00800000'),
    minSubnormal: J.float('00000001'), negSubnormal: J.float('80000001'),
    inf: J.float('7f800000'), negInf: J.float('ff800000'), nan: J.float('7fc00000'),
  }),
  doubles: J.compound({
    zero: J.double('0000000000000000'), negZero: J.double('8000000000000000'),
    one: J.double('3ff0000000000000'), negOne: J.double('bff0000000000000'),
    max: J.double('7fefffffffffffff'), minNormal: J.double('0010000000000000'),
    minSubnormal: J.double('0000000000000001'), negSubnormal: J.double('8000000000000001'),
    inf: J.double('7ff0000000000000'), negInf: J.double('fff0000000000000'),
    nan: J.double('7ff8000000000000'),
  }),
  strings: J.compound({
    empty: J.string(''), chinese: J.string('中文：海边小屋'), emoji: J.string('🐳🐋'),
    nul: J.string('a\u0000b'), escapes: J.string('tab\t换行\n"引号"\\反斜杠'), latin: J.string('é ß ñ'),
  }),
  lists: J.compound({
    empty: J.list([]),
    bytes: J.list([J.byte(1), J.byte(-1)]),
    longs: J.list([J.long('-9223372036854775808'), J.long('1')]),
    floats: J.list([J.float('80000000'), J.float('7fc00000'), J.float('00000001')]),
    doubles: J.list([J.double('8000000000000000'), J.double('7ff8000000000000')]),
    strings: J.strings(['', '一', '🐳']),
    nested: J.list([J.list([J.int(1), J.int(2)]), J.list([]), J.strings(['a'])]),
    compounds: J.list([J.compound({}), J.compound({ a: J.int(1), b: J.int(2) })]),
    mixed: J.list([
      J.int(1), J.string('二'), J.compound({ a: J.int(1), b: J.int(2) }), J.list([]), C([['', J.int(7)]]),
    ]),
    wrapperShaped: J.list([C([['', J.int(5)]]), C([['', J.string('包')]])]),
    wrapperAndPlain: J.list([C([['', J.int(5)]]), J.compound({ x: J.int(1) })]),
    arrays: J.list([J.intArray([1]), J.intArray([])]),
  }),
  arrays: J.compound({
    emptyBytes: J.byteArray([]), bytes: J.byteArray([-128, -1, 0, 1, 127]),
    emptyInts: J.intArray([]), ints: J.intArray([-2147483648, -1, 0, 1, 2147483647]),
    emptyLongs: J.longArray([]),
    longs: J.longArray(['-9223372036854775808', '-1', '0', '1', '9223372036854775807']),
  }),
  keys: C([
    ['', J.string('空键名')], ['中文键', J.int(1)], ['__proto__', J.int(2)], ['2', J.int(3)],
    ['10', J.int(4)], ['with space', J.int(5)], ['a.b:c', J.int(6)],
  ]),
  wrapperOutsideList: C([['', J.int(9)]]),
  deep: nest(10),
});

def({
  name: 'nbt-types',
  purpose: '所有标签类型和极值、float/double 的 −0/±Inf/次正规数/标准 NaN、空串/中文/emoji/U+0000、'
    + '空列表/嵌套列表/混合列表/像包装的 compound、空数组、怪键名',
  size: [1, 1, 1], offset: [0, 0, 0],
  meta: meta('NBT 类型大全'),
  cell: () => 'minecraft:barrel[facing=up,open=false]',
  blockEntities: [{ pos: [0, 0, 0], id: 'minecraft:barrel', data: NBT_TYPES }],
});

def({
  name: 'unicode-meta',
  purpose: '中文 + emoji 的 Name/Author，Metadata 里有不认识的键（要原样保留）',
  size: [2, 1, 1], offset: [0, 0, 0],
  meta: meta('海边小屋 🐳', {
    author: '小鲸鱼🐋',
    extra: {
      OtherTool: J.compound({
        Note: J.string('别的工具写的，要原样保留'),
        Tags: J.strings(['沙滩', 'beach', '🌊']),
        Version: J.int(7),
      }),
      Scale: J.double('3ff8000000000000'),
    },
  }),
  cell: (x) => (x === 0 ? 'minecraft:sand' : 'minecraft:water[level=0]'),
  blockEntities: [],
});

def({
  name: 'tall-thin',
  purpose: '1×200×1 的细高柱子：查 y 方向的下标和负的 Offset',
  size: [1, 200, 1], offset: [0, -10, 0],
  meta: meta('细高柱子'),
  cell: (x, y) => (y < 100 ? 'minecraft:stone' : y < 150 ? 'minecraft:glass' : y === 150 ? 'minecraft:glowstone' : AIR),
  blockEntities: [],
});

const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const AXES = [...COLORS.map((c) => `minecraft:${c}_wool`), ...COLORS.slice(0, 8).map((c) => `minecraft:${c}_concrete`)];
AXES[5] = 'minecraft:chest[facing=west,type=single,waterlogged=false]';   // (1,0,2)
AXES[9] = 'minecraft:furnace[facing=south,lit=false]';                     // (1,1,0)
AXES[16] = 'minecraft:barrel[facing=east,open=false]';                     // (0,2,0)

function label(x, y, z) { return J.compound({ Label: J.string(`x=${x},y=${y},z=${z}`) }); }

def({
  name: 'axes',
  purpose: '2×3×4，24 格状态全不同：查格子顺序 i = x + z×W + y×W×L；方块实体故意不按顺序列',
  size: [2, 3, 4], offset: [5, 6, 7],
  meta: meta('轴向检查'),
  cell: (x, y, z) => AXES[x + z * 2 + y * 8],
  blockEntities: [
    { pos: [0, 2, 0], id: 'minecraft:barrel', data: label(0, 2, 0) },
    { pos: [1, 0, 2], id: 'minecraft:chest', data: label(1, 0, 2) },
    { pos: [1, 1, 0], id: 'minecraft:furnace', data: label(1, 1, 0) },
  ],
});

def({
  name: 'big-air',
  purpose: '256×64×256 = 4,194,304 格（正好到上限），大部分是空气；读要 < 3 秒',
  size: [256, 64, 256], offset: [-128, 0, -128],
  meta: meta('一大片空气'),
  cell: (x, y, z) => {
    if (y === 0) return GRASS;
    if (x === 128 && z === 128 && y <= 10) return 'minecraft:glass';
    if (x === 255 && y === 63 && z === 255) return 'minecraft:gold_block';
    return AIR;
  },
  blockEntities: [],
});

// ---------- 从定义直接算 dump ----------

// 命名空间：'[' 前面那段里第一个 ':' 之前的文字；没有 ':' 就是 minecraft（FORMAT.md 第 3.1 节）
export function namespaceOf(state) {
  const base = state.split('[')[0];
  const c = base.indexOf(':');
  return c < 0 ? 'minecraft' : base.slice(0, c);
}

function build(c) {
  const [W, H, L] = c.size;
  const palette = [];
  const ids = new Map();
  const cells = [];
  let last = -1, run = 0;
  for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
    const s = c.cell(x, y, z);
    if (typeof s !== 'string' || !s) throw new Error(`${c.name}：(${x},${y},${z}) 没有状态`);
    let id = ids.get(s);
    if (id === undefined) { id = palette.length; ids.set(s, id); palette.push(s); }
    if (id === last) run++;
    else { if (run) cells.push([run, last]); last = id; run = 1; }
  }
  cells.push([run, last]);
  const seen = new Set();
  const bes = c.blockEntities.map((b) => {
    const [x, y, z] = b.pos;
    if (!(x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < L)) throw new Error(`${c.name}：方块实体 ${b.pos} 出界`);
    const i = x + z * W + y * W * L;
    if (seen.has(i)) throw new Error(`${c.name}：两个方块实体在同一格 ${b.pos}`);
    seen.add(i);
    return { i, be: { pos: [x, y, z], id: b.id, data: b.data } };
  }).sort((a, b) => a.i - b.i).map((e) => e.be);
  const mods = [...new Set(palette.map(namespaceOf).filter((n) => n !== 'minecraft'))].sort();
  const req = c.meta && c.meta.compound.RequiredMods;
  const declared = req ? req.list.map((t) => t.string) : [];
  if (c.meta && JSON.stringify(declared) !== JSON.stringify(mods)) {
    throw new Error(`${c.name}：meta 的 RequiredMods [${declared}] 和调色板算出来的 [${mods}] 不一样`);
  }
  return {
    dump: 1, size: [W, H, L], offset: c.offset.slice(), dataVersion: DATA_VERSION, meta: c.meta,
    palette, cells, blockEntities: bes, warnings: [],
  };
}

const built = new Map();
// 每次返回一份新的拷贝（调用方随便改）
export function caseDump(name) {
  if (!built.has(name)) {
    const c = CASES.find((k) => k.name === name);
    if (!c) throw new Error('没有这个 case：' + name);
    built.set(name, JSON.stringify(build(c)));
  }
  return JSON.parse(built.get(name));
}
