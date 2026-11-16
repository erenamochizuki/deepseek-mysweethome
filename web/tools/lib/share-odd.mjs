// share-odd.mjs — fixtures/share/odd/ 的「怪文件」：每个文件只触发一个问题
//
// 都用 share-raw.mjs 自己的小编码器拼（可以写错类型、假长度、坏字节），gzip / zlib 用「不压缩」块
// （gzip 炸弹和「标签太多」那几个用手写的 deflate），结果不依赖 zlib 版本。能读的文件，期望的 dump 在这里手写（不经过读取器）。
// 底子：2×1×1，石头 + 玻璃，调色板 {stone:0, glass:1}，Data [0, 1]，一个小 Metadata，空的 BlockEntities。

import {
  T, R, rawNbt, fromTyped, gzipStored, gzipBomb, gzipZeroRun, GZ_HEAD, PNG_SIG, pngChunk, solidChunks,
} from './share-raw.mjs';
import { meta } from './share-cases.mjs';

export const BASE_META = meta('怪文件');                 // typed JSON
const clone = (v) => JSON.parse(JSON.stringify(v));

// 默认条目 + 覆盖：o 里给的键替换默认值，值是 null 就去掉这个键，默认里没有的键接在后面
function entries(defaults, o = {}) {
  const out = [];
  for (const [k, v] of defaults) {
    if (!(k in o)) out.push([k, v]);
    else if (o[k] !== null) out.push([k, o[k]]);
  }
  for (const k of Object.keys(o)) {
    if (o[k] !== null && !defaults.some(([d]) => d === k)) out.push([k, o[k]]);
  }
  return out;
}

export function blocks(b = {}) {
  return R.compound(entries([
    ['Palette', R.compound([['minecraft:stone', R.int(0)], ['minecraft:glass', R.int(1)]])],
    ['Data', R.byteArray([0, 1])],
    ['BlockEntities', R.list(T.end, [])],
  ], b));
}

// o 覆盖 Schematic 里的键，b 覆盖 Blocks 里的键
export function schematic(o = {}, b = {}) {
  return R.compound(entries([
    ['Version', R.int(3)],
    ['DataVersion', R.int(4790)],
    ['Metadata', fromTyped(BASE_META)],
    ['Width', R.short(2)], ['Height', R.short(1)], ['Length', R.short(1)],
    ['Offset', R.intArray([0, 0, 0])],
    ['Blocks', blocks(b)],
  ], o));
}

export const root = (o, b) => R.compound([['Schematic', schematic(o, b)]]);
export const schem = (o, b) => gzipStored(rawNbt(root(o, b)));

// Metadata 换掉 / 加上几个键（值是原始标签）
export function metaWith(o) {
  return R.compound(entries(fromTyped(BASE_META).entries, o));
}

// ---------- PNG ----------
const IMG = solidChunks(16, 16, [0xe8, 0xd5, 0xa0]);       // 沙色 16×16
export const IHDR = IMG.IHDR, IDAT = IMG.IDAT, IEND = pngChunk('IEND');
export const xj = (data, opts) => pngChunk('xjSc', data, opts);
export const png = (...chunks) => Buffer.concat([PNG_SIG, ...chunks]);
export const wrap = (schemBytes) => png(IHDR, IDAT, xj(schemBytes), IEND);

// 期望的 dump（手写，和底子对应）；o 覆盖其中的字段
export function baseDump(o = {}) {
  return {
    dump: 1, size: [2, 1, 1], offset: [0, 0, 0], dataVersion: 4790, meta: clone(BASE_META),
    palette: ['minecraft:stone', 'minecraft:glass'], cells: [[1, 0], [1, 1]],
    blockEntities: [], warnings: [], ...o,
  };
}

export function metaDump(fn) {
  const m = clone(BASE_META);
  fn(m.compound);
  return m;
}

export function deepCompound(n) { return n === 0 ? R.int(1) : R.compound([['d', deepCompound(n - 1)]]); }
export function deepList(n) { return n === 0 ? R.list(T.end, []) : R.list(T.list, [deepList(n - 1)]); }

// 不是 PNG 也不是 gzip 的字节：中文开头 + 512 个伪随机字节（xorshift32，固定种子，里面有 NUL）
export function randomBytes() {
  const out = Buffer.alloc(512);
  let s = 0x2545f491;
  for (let i = 0; i < out.length; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    out[i] = s & 0xff;
  }
  out[100] = 0;
  return Buffer.concat([Buffer.from('这不是图片也不是 schem：', 'utf8'), out]);
}

export const ENTITY = R.compound([
  ['Pos', R.list(T.double, [R.double('3fe0000000000000'), R.double('0000000000000000'), R.double('3fe0000000000000')])],
  ['Id', R.string('minecraft:armor_stand')],
  ['Data', R.compound([])],
]);
export const BIOMES = R.compound([
  ['Palette', R.compound([['minecraft:plains', R.int(0)]])],
  ['Data', R.byteArray([0, 0])],
]);

export const ODD = [];
const ok = (name, file, purpose, bytes, dump) => ODD.push(Object.freeze({ name, file, purpose, bytes, expect: { dump } }));
const bad = (name, file, purpose, bytes, code) => ODD.push(Object.freeze({ name, file, purpose, bytes, expect: { error: code } }));

const be = (pos) => R.compound([['Pos', R.intArray(pos)], ['Id', R.string('minecraft:chest')], ['Data', R.compound([])]]);
const META_FV2 = metaDump((m) => { m.Xiaojingyu.compound.FormatVersion = { int: 2 }; });
const WRAPPED = R.list(T.compound, [R.compound([['', R.int(1)]]), R.compound([['', R.int(2)]])]);

// ---------- 能读的（expect 是 dump） ----------
ok('bare', 'bare.schem', '裸 .schem（gzip，不包在 PNG 里）', () => schem(), baseDump());
ok('root-no-wrapper', 'root-no-wrapper.png', '根上没有 Schematic 这一层，Version 等键直接在根上',
  () => wrap(gzipStored(rawNbt(schematic()))), baseDump());
ok('entities-biomes', 'entities-biomes.png', '带 Entities（1 个）和 Biomes：忽略，给两个警告',
  () => wrap(schem({ Entities: R.list(T.compound, [ENTITY]), Biomes: BIOMES })),
  baseDump({ warnings: ['ignored_biomes', 'ignored_entities'] }));
ok('palette-shuffled', 'palette-shuffled.png', '调色板乱序（编号 0/3/7）且 dirt 没用到：规范化，给 unused_palette 警告',
  () => wrap(schem({}, {
    Palette: R.compound([['minecraft:dirt', R.int(0)], ['minecraft:glass', R.int(3)], ['minecraft:stone', R.int(7)]]),
    Data: R.byteArray([7, 3]),
  })),
  baseDump({ warnings: ['unused_palette'] }));
ok('no-metadata', 'no-metadata.png', '没有 Metadata：meta 是 null', () => wrap(schem({ Metadata: null })), baseDump({ meta: null }));
ok('format-version-2', 'format-version-2.png', 'Metadata.Xiaojingyu.FormatVersion 是 2：能读，给 newer_format 警告',
  () => wrap(schem({ Metadata: fromTyped(META_FV2) })), baseDump({ meta: META_FV2, warnings: ['newer_format'] }));
ok('old-data-version', 'old-data-version.png', 'DataVersion 是 3700：能读，保留读到的值，给 data_version 警告',
  () => wrap(schem({ DataVersion: R.int(3700) })), baseDump({ dataVersion: 3700, warnings: ['data_version'] }));
ok('data-before-idat', 'data-before-idat.png', 'xjSc 块在 IDAT 前面', () => png(IHDR, xj(schem()), IDAT, IEND), baseDump());
ok('text-chunk', 'text-chunk.png', '有一个 tEXt 块（别的软件加的）',
  () => png(IHDR, pngChunk('tEXt', Buffer.from('Software\0haibian-test', 'latin1')), IDAT, xj(schem()), IEND), baseDump());
ok('trailing-after-iend', 'trailing-after-iend.png', 'IEND 后面还有字节（里面甚至有一个完整的 xjSc 块）：不管',
  () => Buffer.concat([wrap(schem()), xj(schem({ DataVersion: R.int(1) })), Buffer.from('尾巴', 'utf8')]), baseDump());
ok('list-wrapped', 'list-wrapped.png', 'Metadata 里有个 compound 列表，元素都是 {"": int}：读成 int 列表',
  () => wrap(schem({ Metadata: metaWith({ Wrapped: WRAPPED }) })),
  baseDump({ meta: metaDump((m) => { m.Wrapped = { list: [{ int: 1 }, { int: 2 }] }; }) }));
ok('nbt-trailing', 'nbt-trailing.png', '解压后 NBT 后面还多 4 个字节：不管',
  () => wrap(gzipStored(Buffer.concat([rawNbt(root()), Buffer.from([0, 1, 2, 3])]))), baseDump());
ok('root-name', 'root-name.png', '根标签的名字不是空的（"鲸图"）：不管', () => wrap(gzipStored(rawNbt(root(), '鲸图'))), baseDump());

// ---------- PNG 层 ----------
bad('no-data', 'no-data.png', '普通 PNG，没有 xjSc 块', () => png(IHDR, IDAT, IEND), 'no_data');
bad('two-data', 'two-data.png', '两个 xjSc 块', () => png(IHDR, IDAT, xj(schem()), xj(schem()), IEND), 'multiple_data');
bad('bad-crc', 'bad-crc.png', 'xjSc 块的 CRC 不对', () => png(IHDR, IDAT, xj(schem(), { crcXor: 1 }), IEND), 'bad_crc');
bad('random', 'random.png', '随机字节（不是 PNG 也不是 gzip，里面有 NUL）', randomBytes, 'unknown_file');
bad('truncated', 'truncated.png', 'PNG 在 xjSc 块的数据中间被截断',
  () => { const f = wrap(schem()); return Buffer.from(f.subarray(0, f.indexOf('xjSc') + 4 + 20)); }, 'bad_png');
bad('no-iend', 'no-iend.png', '没有 IEND（文件在 xjSc 块后面就结束了）', () => png(IHDR, IDAT, xj(schem())), 'bad_png');
bad('data-length-huge', 'data-length-huge.png', 'xjSc 声明长度 16,777,217（超过 16 MiB），文件本身很小',
  () => png(IHDR, IDAT, xj(schem(), { length: 16777217 }), IEND), 'too_large');
bad('data-length-limit', 'data-length-limit.png', 'xjSc 声明长度正好 16,777,216（没超上限），但数据不够',
  () => png(IHDR, IDAT, xj(schem(), { length: 16777216 }), IEND), 'bad_png');
bad('chunk-length-huge', 'chunk-length-huge.png', 'tEXt 块声明长度 0xFFFFFFF4（当有符号数是负的），超出文件',
  () => png(IHDR, pngChunk('tEXt', Buffer.from('a\0b', 'latin1'), { length: 0xfffffff4 }), IDAT, xj(schem()), IEND), 'bad_png');

// ---------- gzip 层 ----------
bad('gzip-bomb', 'gzip-bomb.png', 'gzip 炸弹：文件约 64 KB，解压出 67,633,153 字节（超过 64 MiB）', () => wrap(gzipBomb()), 'too_large');
bad('bad-gzip', 'bad-gzip.png', 'gzip 头没问题，压缩数据的块类型是保留值 3',
  () => wrap(Buffer.concat([GZ_HEAD, Buffer.from([0x07, 0, 0, 0, 0, 0, 0, 0, 0])])), 'bad_gzip');
bad('truncated-gzip', 'truncated-gzip.png', 'gzip 数据只剩前一半（xjSc 块本身完整）',
  () => { const g = schem(); return wrap(g.subarray(0, Math.floor(g.length / 2))); }, 'bad_gzip');
bad('not-gzip', 'not-gzip.png', 'xjSc 里是没压缩的 NBT（开头不是 1f 8b）', () => wrap(rawNbt(root())), 'bad_gzip');

// ---------- NBT 层 ----------
bad('unknown-tag', 'unknown-tag.png', 'Schematic 里有一个类型号 13 的标签', () => wrap(schem({ Weird: R.raw(13, [0, 0, 0, 0]) })), 'bad_nbt');
bad('deep-nesting', 'deep-nesting.png', '600 层嵌套的 compound', () => wrap(schem({ Deep: deepCompound(600) })), 'bad_nbt');
bad('deep-lists', 'deep-lists.png', '600 层嵌套的列表', () => wrap(schem({ Deep: deepList(600) })), 'bad_nbt');
bad('bad-mutf8', 'bad-mutf8.png', 'Metadata.Name 的字节不是合法的 MUTF-8（C3 41）',
  () => wrap(schem({ Metadata: metaWith({ Name: R.raw(T.string, [0, 2, 0xc3, 0x41]) }) })), 'bad_nbt');
bad('root-not-compound', 'root-not-compound.png', '根标签是字符串，不是 compound',
  () => wrap(gzipStored(rawNbt(R.string('Schematic')))), 'bad_nbt');
bad('huge-array-length', 'huge-array-length.png', 'Data 声明长度 2,147,483,647，实际只有 2 字节（不能按声明长度预先分配）',
  () => wrap(schem({}, { Data: R.byteArray([0, 1], 0x7fffffff) })), 'bad_nbt');
bad('huge-list-length', 'huge-list-length.png', 'BlockEntities 声明 2,147,483,647 个元素，实际一个也没有',
  () => wrap(schem({}, { BlockEntities: R.list(T.compound, [], 0x7fffffff) })), 'bad_nbt');
bad('negative-array-length', 'negative-array-length.png', 'Data 的长度是 −1', () => wrap(schem({}, { Data: R.byteArray([0, 1], -1) })), 'bad_nbt');
bad('negative-list-count', 'negative-list-count.png', 'BlockEntities 的长度是 −1',
  () => wrap(schem({}, { BlockEntities: R.list(T.compound, [], -1) })), 'bad_nbt');

// ---------- 标签太多（FORMAT.md 第 2 节：标签总数最多 2,097,152 个）----------
// 根 {l: [n 个空 compound]}：标签数 = 根 1 + "l" 1 + n。解压后是 12 字节的头 + (n + 1) 个 0
// （每个空 compound 只有结束标记，最后一个 0 结束根），gzipZeroRun 压得很小，字节也固定。
const MANY_TAGS = 60000000;
export const TAG_LIMIT = 2097152;
const emptyCompounds = (n) => gzipZeroRun(Buffer.from([T.compound, 0, 0, T.list, 0, 1, 0x6c, T.compound,
  (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]), n + 1);
export const TAGS_FILES = Object.freeze({ 'many-tags': MANY_TAGS, 'tags-at-limit': TAG_LIMIT - 2, 'tags-over-limit': TAG_LIMIT - 1 });
bad('many-tags', 'many-tags.png', '根 {l: [60,000,000 个空 compound]}：文件约 58 KB，解压后约 57 MiB（没超 64 MiB），标签太多',
  () => wrap(emptyCompounds(MANY_TAGS)), 'too_large');
bad('tags-at-limit', 'tags-at-limit.png', '根 {l: [2,097,150 个空 compound]}：标签正好 2,097,152 个，能读完 NBT，但没有 Version',
  () => wrap(emptyCompounds(TAG_LIMIT - 2)), 'bad_schematic');
bad('tags-over-limit', 'tags-over-limit.png', '根 {l: [2,097,151 个空 compound]}：标签 2,097,153 个，多了 1 个',
  () => wrap(emptyCompounds(TAG_LIMIT - 1)), 'too_large');

// ---------- Sponge 结构层 ----------
bad('version-2', 'version-2.schem', 'Sponge 第 2 版的裸 .schem（根标签名字是 Schematic，Version 2）',
  () => gzipStored(rawNbt(R.compound([
    ['Version', R.int(2)], ['DataVersion', R.int(4790)], ['Width', R.short(2)], ['Height', R.short(1)], ['Length', R.short(1)],
    ['PaletteMax', R.int(2)], ['Palette', R.compound([['minecraft:stone', R.int(0)], ['minecraft:glass', R.int(1)]])],
    ['BlockData', R.byteArray([0, 1])],
  ]), 'Schematic')), 'unsupported_version');
bad('no-blocks', 'no-blocks.png', '没有 Blocks', () => wrap(schem({ Blocks: null })), 'bad_schematic');
bad('data-length-wrong', 'data-length-wrong.png', 'Data 里只有 1 格（应该有 2 格）', () => wrap(schem({}, { Data: R.byteArray([0]) })), 'bad_schematic');
bad('palette-missing-id', 'palette-missing-id.png', 'Data 用了编号 2，调色板里没有', () => wrap(schem({}, { Data: R.byteArray([0, 2]) })), 'bad_schematic');
bad('palette-duplicate-id', 'palette-duplicate-id.png', '调色板里 glass 和 dirt 都是编号 1',
  () => wrap(schem({}, { Palette: R.compound([['minecraft:stone', R.int(0)], ['minecraft:glass', R.int(1)], ['minecraft:dirt', R.int(1)]]) })),
  'bad_schematic');
bad('be-duplicate-pos', 'be-duplicate-pos.png', '两个方块实体都在 [1,0,0]',
  () => wrap(schem({}, { BlockEntities: R.list(T.compound, [be([1, 0, 0]), be([1, 0, 0])]) })), 'bad_schematic');
bad('be-out-of-range', 'be-out-of-range.png', '方块实体的 Pos 是 [2,0,0]，出界（Width 是 2）',
  () => wrap(schem({}, { BlockEntities: R.list(T.compound, [be([2, 0, 0])]) })), 'bad_schematic');
bad('width-zero', 'width-zero.png', 'Width 是 0', () => wrap(schem({ Width: R.short(0) })), 'bad_schematic');
bad('width-not-short', 'width-not-short.png', 'Width 是 int，不是 short', () => wrap(schem({ Width: R.int(2) })), 'bad_schematic');
bad('width-2000', 'width-2000.png', 'Width 是 2000（每边上限 1024），Height = Length = 1', () => wrap(schem({ Width: R.short(2000) })), 'too_large');
bad('varint-too-long', 'varint-too-long.png', 'Data 第 2 格的 varint 有 6 字节（80 80 80 80 80 00）',
  () => wrap(schem({}, { Data: R.byteArray([0, 0x80, 0x80, 0x80, 0x80, 0x80, 0]) })), 'bad_schematic');
bad('varint-too-big', 'varint-too-big.png', 'Data 第 2 格的 varint 是 FF FF FF FF 0F（大于 2³¹−1）',
  () => wrap(schem({}, { Data: R.byteArray([0, 0xff, 0xff, 0xff, 0xff, 0x0f]) })), 'bad_schematic');
