#!/usr/bin/env node
// share.test.mjs — 鲸图读写（web/src/12-nbt.js、13-share.js）和共用样例 fixtures/share/ 的测试
//
//   node test/share.test.mjs                  跑全部；fixtures/share/java/ 缺文件时打印 SKIP
//   node test/share.test.mjs --require-cross  java/ 缺文件算失败（P1 验收用这个）
//
// 写法和 api.test.mjs 一样：每项打印一行 PASS，第一个失败就退出 1。不开浏览器、不开端口。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { loadV3, WEB_DIR } from '../tools/lib/v3-node.mjs';
import { R, T, rawNbt } from '../tools/lib/share-raw.mjs';
import { CASES, caseDump } from '../tools/lib/share-cases.mjs';
import { ODD } from '../tools/lib/share-odd.mjs';
import { checkFixtures, diffJSON, FIXTURE_DIR } from '../tools/share.mjs';

const REQUIRE_CROSS = process.argv.includes('--require-cross');
const V3 = loadV3(['12-nbt', '13-share']).V3;
const N = V3.nbt;
const S = V3.share;

class TestFail extends Error {}
// 第一个失败就停：只打印 FAIL 那一行（不打印调用栈），退出码 1。别的意外错误照常带调用栈，也是退出码 1。
process.on('uncaughtException', (e) => {
  const msg = e instanceof TestFail ? e.message : `CRASH ${e && e.stack ? e.stack : e}`;
  process.stdout.write(msg + '\n', () => process.exit(1));   // 等前面的输出都写出去再退出
});
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x)));
let checks = 0;
function ok(cond, what, got) {
  checks++;
  if (!cond) throw new TestFail(`FAIL ${what}` + (got === undefined ? '' : `\n  got: ${show(got)}`));
  console.log(`PASS ${what}`);
}
function codeOf(fn) {
  try { fn(); return '（没出错）'; } catch (e) { return e && e.code ? e.code : String(e); }
}
async function codeOfAsync(fn) {
  try { await fn(); return '（没出错）'; } catch (e) { return e && e.code ? e.code : String(e); }
}
const hex = (b) => Buffer.from(b).toString('hex');
const bytes = (h) => Uint8Array.from(Buffer.from(h.replace(/\s+/g, ''), 'hex'));
const same = (a, b) => N.equalJSON(a, b);

// ---------------------------------------------------------------- varint
{
  const cases = [[0, '00'], [127, '7f'], [128, '8001'], [16383, 'ff7f'], [16384, '808001'], [2147483647, 'ffffffff07']];
  for (const [v, h] of cases) {
    const enc = N.varint.encode([v]);
    ok(hex(enc) === h && N.varint.decode(enc, 1)[0] === v, `varint ${v} ↔ ${h}`, hex(enc));
  }
  const all = cases.map((c) => c[0]);
  const dec = N.varint.decode(N.varint.encode(all), all.length);
  ok(Array.from(dec).join() === all.join(), 'varint 一串值来回一致');
  ok(N.varint.decode(bytes('8000'), 1)[0] === 0, 'varint 不要求最短编码（80 00 = 0）');
  ok(codeOf(() => N.varint.decode(bytes('8080808080 00'), 1)) === 'bad_varint', 'varint 6 字节 → 出错');
  ok(codeOf(() => N.varint.decode(bytes('ffffffff0f'), 1)) === 'bad_varint', 'varint 第 5 字节 > 07（大于 2³¹−1）→ 出错');
  ok(codeOf(() => N.varint.decode(bytes('80'), 1)) === 'bad_varint', 'varint 没写完 → 出错');
  ok(codeOf(() => N.varint.decode(bytes('01'), 2)) === 'bad_varint', 'varint 格数不够 → 出错');
  ok(codeOf(() => N.varint.decode(bytes('0102'), 1)) === 'bad_varint', 'varint 读完还多字节 → 出错');
  ok(codeOf(() => N.varint.encode([-1])) === 'bad_value' && codeOf(() => N.varint.encode([2147483648])) === 'bad_value'
    && codeOf(() => N.varint.encode([1.5])) === 'bad_value', 'varint 写负数 / 2³¹ / 小数 → 出错');
}

// ---------------------------------------------------------------- MUTF-8
{
  const enc = (s) => hex(N.mutf8.encode(s));
  const dec = (h) => N.mutf8.decode(bytes(h));
  ok(enc('a\u0000b') === '61c08062', 'MUTF-8：U+0000 写成 C0 80');
  ok(enc('🐳') === 'eda0bdedb0b3', 'MUTF-8：emoji 写成两个代理项、各 3 字节', enc('🐳'));
  ok(enc('中') === 'e4b8ad' && dec('e4b8ad') === '中', 'MUTF-8：中文 3 字节');
  ok(dec('eda0bdedb0b3') === '🐳' && dec('61c08062') === 'a\u0000b', 'MUTF-8：读回 emoji 和 U+0000');
  ok(dec(enc('\ud800x\udc00')) === '\ud800x\udc00' && enc('\ud800') === 'eda080', 'MUTF-8：落单的代理项原样来回');
  ok(dec('00') === '\u0000' && dec('c181') === 'A' && dec('e08080') === '\u0000', 'MUTF-8：读时接受裸 00 和过长编码（同 JDK readUTF）');
  for (const [h, why] of [['f09f90b3', '4 字节 UTF-8'], ['80', '落单的后续字节'], ['c341', '后续字节不是 10xxxxxx'], ['e4b8', '没写完']]) {
    ok(codeOf(() => dec(h)) === 'bad_nbt', `MUTF-8：${why}（${h}）→ bad_nbt`);
  }
  ok(N.mutf8.encode('a'.repeat(65535)).length === 65535 && N.mutf8.encode('中'.repeat(21845)).length === 65535, 'MUTF-8：正好 65535 字节可以写');
  ok(codeOf(() => N.mutf8.encode('a'.repeat(65536))) === 'bad_value' && codeOf(() => N.mutf8.encode('中'.repeat(21846))) === 'bad_value',
    'MUTF-8：超过 65535 字节 → 写入出错');
}

// ---------------------------------------------------------------- NBT 各类型来回
{
  const typed = { compound: {
    b: { byte: -128 }, s: { short: 32767 }, i: { int: -2147483648 }, l: { long: '-9223372036854775808' },
    f: { float: '7fc00001' }, d: { double: 'fff8000000000001' }, z: { float: '80000000' }, str: { string: '中🐳\u0000' },
    ba: { byteArray: [-128, 0, 127] }, ia: { intArray: [-1, 2147483647] }, la: { longArray: ['9223372036854775807', '-1'] },
    li: { list: [{ short: 1 }, { short: -1 }] }, c: { compound: { '': { string: '' } } },
  } };
  const raw = rawNbt(R.compound([
    ['b', R.byte(-128)], ['s', R.short(32767)], ['i', R.int(-2147483648)], ['l', R.long('-9223372036854775808')],
    ['f', R.float('7fc00001')], ['d', R.double('fff8000000000001')], ['z', R.float('80000000')], ['str', R.string('中🐳\u0000')],
    ['ba', R.byteArray([-128, 0, 127])], ['ia', R.intArray([-1, 2147483647])], ['la', R.longArray([9223372036854775807n, -1n])],
    ['li', R.list(T.short, [R.short(1), R.short(-1)])], ['c', R.compound([['', R.string('')]])],
  ]));
  const written = N.write(N.fromJSON(typed));
  ok(hex(written) === hex(raw), 'NBT：写出来的字节和独立编码器一样（所有类型）');
  const back = N.read(raw);
  ok(same(N.toJSON(back.value), typed) && back.name === '' && back.end === raw.length, 'NBT：读回来一样（float/double 的位原样，含非标准 NaN 和 −0）');
  ok(back.value.compound.ba.byteArray instanceof Int8Array && back.value.compound.la.longArray instanceof BigInt64Array, 'NBT：大数组读成 TypedArray');
  const named = rawNbt(R.compound([]), '鲸图');
  ok(N.read(Buffer.concat([named, Buffer.from('尾巴')])).name === '鲸图', 'NBT：根名字照样解码，后面多的字节不管');
  ok(codeOf(() => N.read(rawNbt(R.string('x')))) === 'bad_nbt', 'NBT：根不是 compound → bad_nbt');
  ok(codeOf(() => N.read(rawNbt(R.compound([['x', R.raw(13, [])]])))) === 'bad_nbt', 'NBT：不认识的标签 13 → bad_nbt');
  ok(codeOf(() => N.read(raw.subarray(0, raw.length - 1))) === 'bad_nbt', 'NBT：少一个字节 → bad_nbt');
  ok(codeOf(() => N.read(rawNbt(R.compound([['a', R.byteArray([1], 2147483647)]])))) === 'bad_nbt'
    && codeOf(() => N.read(rawNbt(R.compound([['a', R.intArray([], -1)]])))) === 'bad_nbt', 'NBT：数组长度超出剩余字节 / 是负数 → bad_nbt');
}

// ---------------------------------------------------------------- 列表规则（FORMAT.md 第 2 节，照 MC 26.1 ListTag）
{
  const listBytes = (items) => N.write(N.fromJSON({ compound: { L: { list: items } } }));
  const head = (items) => { const b = listBytes(items); return [b[7], new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(8)]; };   // 0a 0000 | 09 0001 'L' | 类型 | 个数
  const roundTrip = (items) => N.toJSON(N.read(listBytes(items)).value).compound.L.list;
  ok(head([]).join() === '0,0', '列表：空列表元素类型写 0');
  ok(head([{ int: 1 }, { int: 2 }]).join() === '3,2', '列表：同一类型 → 那个类型');
  ok(head([{ int: 1 }, { string: 'a' }])[0] === 10, '列表：混合类型 → 类型 10');
  const mixed = [{ int: 1 }, { string: 'a' }, { compound: { k: { byte: 1 } } }, { compound: { '': { int: 7 } } }, { list: [] }];
  ok(same(roundTrip(mixed), mixed), '列表：混合类型来回一致（非 compound 和像包装的 compound 都包一层 {"": …}）');
  const mixedRaw = N.read(listBytes(mixed)).value;   // 用独立的写法核对字节：非 compound 包一层、普通 compound 不包、像包装的 compound 再包一层
  const expect = rawNbt(R.compound([['L', R.list(T.compound, [
    R.compound([['', R.int(1)]]), R.compound([['', R.string('a')]]), R.compound([['k', R.byte(1)]]),
    R.compound([['', R.compound([['', R.int(7)]])]]), R.compound([['', R.list(T.end, [])]]),
  ])]]));
  ok(hex(listBytes(mixed)) === hex(expect) && same(N.toJSON(mixedRaw).compound.L.list, mixed), '列表：混合类型的字节和独立编码器一样');
  const wrappers = [{ compound: { '': { int: 1 } } }, { compound: { '': { int: 2 } } }];
  ok(same(roundTrip(wrappers), wrappers), '列表：元素全是 {"": x} 形状的 compound 列表，再包一层，读回来原样');
  ok(same(N.toJSON(N.read(rawNbt(R.compound([['L', R.list(T.compound, [R.compound([['', R.int(5)]]), R.compound([['', R.string('s')]])])]]))).value)
    .compound.L.list, [{ int: 5 }, { string: 's' }]), '列表：读时只有一个 "" 键的 compound 元素拆成里面的值');
  const twoKeys = rawNbt(R.compound([['L', R.list(T.compound, [R.compound([['', R.int(5)], ['x', R.int(6)]])])]]));
  ok(same(N.toJSON(N.read(twoKeys).value).compound.L.list, [{ compound: { '': { int: 5 }, x: { int: 6 } } }]), '列表：有 "" 键但不止一个键的 compound 不拆');
  ok(codeOf(() => N.read(rawNbt(R.compound([['L', R.list(T.end, [R.raw(T.end, [])], 1)]])))) === 'bad_nbt', '列表：元素类型 0 但长度 > 0 → bad_nbt');
  ok(codeOf(() => N.read(rawNbt(R.compound([['L', R.list(T.int, [], -1)]])))) === 'bad_nbt', '列表：长度是负数 → bad_nbt');
  ok(codeOf(() => N.read(rawNbt(R.compound([['L', R.list(T.int, [R.int(1)], 2147483647)]])))) === 'bad_nbt', '列表：长度超出剩余字节 → bad_nbt');
  ok(same(N.toJSON(N.read(rawNbt(R.compound([['L', R.list(99, [], 0)]]))).value).compound.L.list, []), '列表：元素类型不认识但长度 0 → 空列表');
}

// ---------------------------------------------------------------- 嵌套层数（compound 和列表都算一层，根也算）
{
  const nest = (n) => { let t = R.compound([]); for (let i = 1; i < n; i++) t = R.compound([['a', t]]); return rawNbt(t); };
  const nestList = (n) => { let t = R.list(T.end, []); for (let i = 2; i < n; i++) t = R.list(T.list, [t]); return rawNbt(R.compound([['a', t]])); };
  ok(codeOf(() => N.read(nest(512))) === '（没出错）' && codeOf(() => N.read(nest(513))) === 'bad_nbt', '嵌套：512 层 compound 能读，513 层 → bad_nbt');
  ok(codeOf(() => N.read(nestList(512))) === '（没出错）' && codeOf(() => N.read(nestList(513))) === 'bad_nbt', '嵌套：列表也算层数（512 能读，513 → bad_nbt）');
  const deep = (n) => { let t = { compound: {} }; for (let i = 1; i < n; i++) t = { compound: { a: t } }; return t; };
  ok(codeOf(() => N.write(N.fromJSON(deep(512)))) === '（没出错）' && codeOf(() => N.write(N.fromJSON(deep(513)))) === 'bad_value',
    '嵌套：写入同样最多 512 层');
}

// ---------------------------------------------------------------- 标签总数（FORMAT.md 第 2 节：最多 2,097,152 个，读写都数）
{
  ok(N.MAX_TAGS === 2097152 && S.LIMITS.tags === 2097152, '标签上限是 2,097,152（2^21）');
  // 正好 n 个：maxTags = n 能写能读，n − 1 就 too_large（写和读一样）
  const exactly = (j, n, why) => {
    const raw = N.write(j, '', { maxTags: n });
    ok(codeOf(() => N.write(j, '', { maxTags: n - 1 })) === 'too_large', `标签数：${why} → 写 ${n} 个（少 1 个上限就 too_large）`);
    ok(N.read(raw, { maxTags: n }).tags === n && codeOf(() => N.read(raw, { maxTags: n - 1 })) === 'too_large', `标签数：${why} → 读也是 ${n} 个`);
  };
  exactly({ compound: {} }, 1, '只有根');
  exactly({ compound: { a: { int: 1 }, b: { string: 'x' } } }, 3, '根 + 2 个成员');
  exactly({ compound: { a: { byteArray: new Int8Array(1000) }, b: { intArray: [1, 2, 3] }, c: { longArray: [] } } }, 4, '数组不管多长算 1 个');
  exactly({ compound: { l: { list: [] } } }, 2, '空列表');
  exactly({ compound: { l: { list: [{ byte: 1 }, { byte: 2 }, { byte: 3 }] } } }, 5, 'byte 列表每个元素 1 个');
  exactly({ compound: { l: { list: [{ int: 1 }, { string: 'a' }] } } }, 6, '混合列表：包装 {"": v} 和里面的值各 1 个');
  exactly({ compound: { l: { list: [{ compound: { '': { int: 1 } } }, { compound: { '': { int: 2 } } }] } } }, 8, '长得像包装的 compound：再包一层，每个元素 3 个');
  exactly({ compound: { a: { compound: { b: { compound: {} } } } } }, 3, '嵌套 compound');
  const dup = rawNbt(R.compound([['a', R.int(1)], ['a', R.int(2)]]));
  ok(N.read(dup).value.compound.a.int === 2 && N.read(dup, { maxTags: 3 }).tags === 3 && codeOf(() => N.read(dup, { maxTags: 2 })) === 'too_large',
    '标签数：重复的键按出现次数算（后面的值算数）');
  ok(codeOf(() => N.read(bytes('0a 0000 08 0005 6162'), { maxTags: 1 })) === 'too_large' && codeOf(() => N.read(bytes('0a 0000 08 0005 6162'), { maxTags: 2 })) === 'bad_nbt',
    '标签数：成员在读名字之前就数（名字被截断也先报 too_large）');
  ok(codeOf(() => N.read(bytes('0a 0000 0d 0001 61 00'), { maxTags: 1 })) === 'too_large' && codeOf(() => N.read(bytes('0a 0000 0d 0001 61 00'), { maxTags: 2 })) === 'bad_nbt',
    '标签数：先数，再查类型认不认识');
  ok(codeOf(() => N.read(rawNbt(R.compound([['l', R.list(T.int, [], 1000)]])), { maxTags: 2 })) === 'bad_nbt', '标签数：列表头的检查在数元素之前（声明 1000 个、没有数据 → bad_nbt）');
  const deep = (n) => { let t = { compound: {} }; for (let i = 1; i < n; i++) t = { compound: { a: t } }; return t; };
  ok(codeOf(() => N.write(deep(513), '', { maxTags: 512 })) === 'too_large' && codeOf(() => N.write(deep(513), '', { maxTags: 513 })) === 'bad_value',
    '写：标签数和层数在同一次遍历里查，先碰到哪个报哪个（和读这份数据时一样）');
}

// ---------------------------------------------------------------- typed JSON 严格检查、__proto__、float/double 的位
{
  for (const [j, why] of [[{ long: '01' }, 'long 有前导 0'], [{ long: '-0' }, 'long 写成 -0'], [{ long: '9223372036854775808' }, 'long 超范围'],
    [{ float: '7FC00000' }, 'float 用大写'], [{ float: '7fc0000' }, 'float 不够 8 位'], [{ double: '0' }, 'double 不够 16 位'],
    [{ byte: 128 }, 'byte 超范围'], [{ int: 1.5 }, 'int 不是整数'], [{ int: 1, short: 1 }, '两个类型键'], [{ bool: true }, '不认识的类型']]) {
    ok(codeOf(() => N.fromJSON({ compound: { x: j } })) === 'bad_value', `typed JSON：${why} → bad_value`);
  }
  const p = N.fromJSON(JSON.parse('{"compound":{"__proto__":{"int":1},"constructor":{"int":2}}}'));
  const noObjectProto = (c) => Object.getPrototypeOf(c) === N.Compound.prototype && Object.getPrototypeOf(N.Compound.prototype) === null
    && !('toString' in c) && !('hasOwnProperty' in c);
  ok(noObjectProto(p.compound) && Object.keys(p.compound).join() === '__proto__,constructor' && p.compound.constructor.int === 2,
    'typed JSON："__proto__"、"constructor" 是普通的键，compound 的原型链上没有 Object.prototype');
  ok(noObjectProto(N.read(N.write(p)).value.compound) && noObjectProto(N.compound({ a: { int: 1 } }).compound), '读出来的、N.compound 造的 compound 也一样');
  ok(N.toJSON(N.read(N.write(p)).value).compound.__proto__.int === 1 && ({}).int === undefined, 'typed JSON："__proto__" 写读来回，不污染原型');
  for (const h of ['00000000', '80000000', '7fc00000', 'ffc00000', '7f800001', '00000001', 'ff800000']) {
    const t = N.toJSON(N.read(N.write({ compound: { f: { float: h }, d: { double: h + h } } })).value).compound;
    ok(t.f.float === h && t.d.double === h + h, `float/double 位原样来回：${h} / ${h + h}`);
  }
  ok(N.floatBits(-0) === '80000000' && N.doubleBits(-0) === '8000000000000000' && N.floatBits(1) === '3f800000', 'floatBits/doubleBits：−0 和 1');
}

// ---------------------------------------------------------------- gzip
{
  const raw = new TextEncoder().encode('海边小屋 whale '.repeat(5000));
  const gz = await N.gzip(raw);
  ok(hex(gz.subarray(0, 10)) === '1f8b08000000000000ff', 'gzip：头是 1f8b 08 00 00000000 00 ff（mtime 0、没有文件名、OS ff）', hex(gz.subarray(0, 10)));
  ok(Buffer.from(zlib.gunzipSync(gz)).equals(Buffer.from(raw)), 'gzip：Node 的 zlib 能解开');
  ok(hex(await N.gzip(raw)) === hex(gz), 'gzip：写两次一样');
  ok(Buffer.from(await N.gunzip(zlib.gzipSync(raw))).equals(Buffer.from(raw)), 'gunzip：能解开 zlib 写的');
  ok((await N.gunzip(gz, raw.length)).length === raw.length && await codeOfAsync(() => N.gunzip(gz, raw.length - 1)) === 'too_large',
    'gunzip：正好到上限能解，超过 1 字节 → too_large');
  ok(await codeOfAsync(() => N.gunzip(gz.subarray(0, gz.length - 9))) === 'bad_gzip', 'gunzip：被截断 → bad_gzip');
  const bad = Uint8Array.from(gz); bad[bad.length - 8] ^= 1;
  ok(await codeOfAsync(() => N.gunzip(bad)) === 'bad_gzip' && await codeOfAsync(() => N.gunzip(bytes('1f8b0800000000000003ff'))) === 'bad_gzip',
    'gunzip：CRC 不对 / 坏数据 → bad_gzip');
}

// ---------------------------------------------------------------- CRC32、PNG 块
{
  const t = new TextEncoder().encode('123456789');
  ok(S.png.crc32(t, 0, t.length) === 0xcbf43926, 'CRC32("123456789") = cbf43926');
  ok(S.png.crc32(new TextEncoder().encode('IEND'), 0, 4) === 0xae426082, 'CRC32("IEND") = ae426082');
  const rnd = Uint8Array.from({ length: 4096 }, (_, i) => (i * 2654435761) >>> 24);
  ok(S.png.crc32(rnd, 100, 4000) === (zlib.crc32(rnd.subarray(100, 4000)) >>> 0), 'CRC32 和 Node 的 zlib.crc32 一样（带起止位置）');
  const png = S.png.solid(16, 16, [0x12, 0x34, 0x56]);
  const list = S.png.chunks(png, { crc: true });
  ok(list.map((c) => c.type).join() === 'IHDR,IDAT,IEND' && list.every((c) => c.crcOk), '纯色图：IHDR IDAT IEND，CRC 都对');
  const ihdr = Buffer.from(png.subarray(list[0].start + 8, list[0].start + 8 + 13));
  ok(ihdr.readUInt32BE(0) === 16 && ihdr.readUInt32BE(4) === 16 && ihdr[8] === 8 && ihdr[9] === 2, '纯色图：16×16、8 位 RGB');
  const raw = zlib.inflateSync(png.subarray(list[1].start + 8, list[1].start + 8 + list[1].length));
  let pixelsOk = raw.length === 16 * 49;
  for (let y = 0; y < 16 && pixelsOk; y++) {
    pixelsOk = raw[y * 49] === 0 && hex(raw.subarray(y * 49 + 1, y * 49 + 49)) === '123456'.repeat(16);
  }
  ok(pixelsOk, '纯色图：zlib 解开后每行都是 123456');
  const one = S.png.setChunk(png, 'xjSc', bytes('0102'));
  const two = S.png.setChunk(Buffer.concat([one.subarray(0, 33), S.png.chunk('xjSc', bytes('09')), one.subarray(33), bytes('ffff')]), 'xjSc', bytes('0304'));
  const types = (b) => S.png.chunks(b).map((c) => c.type).join();
  ok(types(one) === 'IHDR,IDAT,xjSc,IEND', 'setChunk：插在 IEND 紧前面', types(one));
  ok(types(two) === 'IHDR,IDAT,xjSc,IEND' && hex(S.extract(two)) === '0304' && hex(two.subarray(two.length - 12)) === hex(png.subarray(png.length - 12)),
    'setChunk：先删掉所有旧的 xjSc（这里有两个）、IEND 后面的字节丢掉', types(two));
  ok(codeOf(() => S.png.chunks(png.subarray(0, 40))) === 'bad_png' && codeOf(() => S.png.chunks(bytes('00'))) === 'bad_png', 'chunks：结构坏了 → bad_png');
}

// ---------------------------------------------------------------- 模型、写入器自己检查、规范化
const tiny = (o = {}) => Object.assign({
  size: [2, 1, 1], offset: [0, 0, 0], dataVersion: 4790, meta: null,
  palette: ['minecraft:stone', 'minecraft:glass'], cells: [0, 1], blockEntities: [], warnings: [],
}, o);
{
  ok(S.index([2, 3, 4], 1, 2, 3) === 23 && S.posOf([2, 3, 4], 23).join() === '1,2,3', 'index / posOf：i = x + z×W + y×W×L');
  ok(JSON.stringify(S.requiredMods(['minecraft:stone', 'xiaojingyu:lamp[a=b:c]', ':odd', 'stone', 'Abc:def', 'xiaojingyu:x']))
    === '["","Abc","xiaojingyu"]', 'requiredMods：去掉 minecraft、去重、排序；":odd" 的命名空间是 ""');
  const bad = [
    [{ size: [0, 1, 1], cells: [] }, 'bad_schematic', '有一边是 0'], [{ size: [1025, 1, 1] }, 'too_large', '一边超过 1024'],
    [{ size: [1024, 1024, 5] }, 'too_large', '总格数超过 4,194,304'], [{ cells: [0] }, 'bad_schematic', '格数不对'],
    [{ cells: [0, 2] }, 'bad_schematic', '编号不在调色板里'], [{ palette: ['minecraft:stone', 'minecraft:stone'] }, 'bad_schematic', '调色板有重复'],
    [{ blockEntities: [{ pos: [2, 0, 0], id: 'minecraft:chest', data: null }] }, 'bad_schematic', '方块实体出界'],
    [{ blockEntities: [{ pos: [1, 0, 0], id: 'a', data: null }, { pos: [1, 0, 0], id: 'b', data: null }] }, 'bad_schematic', '方块实体同一格两个'],
    [{ meta: { string: 'x' } }, 'bad_schematic', 'meta 不是 compound'],
  ];
  for (const [o, code, why] of bad) ok(await codeOfAsync(() => S.writeSchem(tiny(o))) === code, `写入器先检查模型：${why} → ${code}`);
  ok(await codeOfAsync(() => S.writePng(tiny(), bytes('00'))) === 'bad_png', 'writePng：给的底图不是 PNG → bad_png');
  const messy = tiny({
    palette: ['minecraft:dirt', 'x:lamp', 'minecraft:stone'], cells: [2, 1],
    meta: { compound: { Name: { string: 'n' }, RequiredMods: { list: [{ string: 'stale' }] } } },
  });
  const d = S.dump(await S.read(await S.writePng(messy)));
  ok(same(d.palette, ['minecraft:stone', 'x:lamp']) && same(d.cells, [[1, 0], [1, 1]]) && d.warnings.length === 0,
    '写入器规范化：没用到的调色板项去掉、按第一次出现排编号，读回来没有警告', d);
  ok(same(d.meta.compound.RequiredMods, { list: [{ string: 'x' }] }), '写入器按调色板重算 RequiredMods（旧的不对的被替换）');
  const noMods = S.dump(await S.read(await S.writePng(tiny({ meta: messy.meta }))));
  ok(noMods.meta.compound.RequiredMods === undefined && noMods.meta.compound.Name.string === 'n', '调色板全是 minecraft: → 不写 RequiredMods');
  const png = await S.writePng(tiny(), S.png.solid(4, 4, [1, 2, 3]));
  ok(S.png.chunks(png).map((c) => c.type).join() === 'IHDR,IDAT,xjSc,IEND' && same(S.dump(await S.read(new Blob([png]))), S.dump(tiny())),
    'writePng 用给的底图；read 也收 Blob');
  const again = await S.writePng(tiny({ palette: ['minecraft:dirt', 'minecraft:glass'] }), png);
  ok(S.png.chunks(again).filter((c) => c.type === 'xjSc').length === 1 && S.dump(await S.read(again)).palette[0] === 'minecraft:dirt',
    'writePng 写到已有鲸图上：替换旧数据，只留一个 xjSc');
  const dump0 = S.dump(tiny());
  ok(codeOf(() => S.fromDump({ ...dump0, extra: 1 })) === 'bad_dump' && codeOf(() => S.fromDump({ ...dump0, cells: [[1, 0]] })) === 'bad_dump',
    'fromDump 严格：多一个键 / 游程总数不对 → bad_dump');
}

// ---------------------------------------------------------------- 标签太多：写入器也数；odd/ 的三个大文件很快报错
{
  const base = N.read(N.write(S.toNbt(tiny({ meta: { compound: { L: { list: [] } } } })))).tags;
  const room = S.LIMITS.tags - base;                 // meta.L 里再放 room 个 int，正好到上限
  const ints = Array.from({ length: room }, (_, i) => ({ int: i & 7 }));
  const full = tiny({ meta: { compound: { L: { list: ints } } } });
  let t0 = performance.now();
  const r = N.read(await N.gunzip(await S.writeSchem(full)));
  ok(r.tags === S.LIMITS.tags && r.value.compound.Schematic.compound.Metadata.compound.L.list.length === room,
    `写入器：标签正好 2,097,152 个能写，读回来也是这么多（${Math.round(performance.now() - t0)} ms）`);
  ints.push({ int: 0 });
  ok(await codeOfAsync(() => S.writeSchem(full)) === 'too_large' && await codeOfAsync(() => S.writePng(full)) === 'too_large',
    '写入器：多 1 个标签 → too_large（不写）');
  const oddFile = (name) => fs.readFileSync(path.join(FIXTURE_DIR, 'odd', `${name}.png`));
  const many = oddFile('many-tags');
  const unzipped = zlib.gunzipSync(S.extract(many), { maxOutputLength: S.LIMITS.unzipped });
  ok(many.length < 64 * 1024 && unzipped.length === 12 + 60000001 && unzipped.length < S.LIMITS.unzipped,
    `many-tags.png：文件 ${many.length} 字节，解压后 ${unzipped.length} 字节（没超 64 MiB，所以是标签数拦下的）`);
  t0 = performance.now();
  let err = null;
  try { await S.read(many); } catch (e) { err = e; }
  const ms = Math.round(performance.now() - t0);
  ok(err instanceof S.ShareError && err.code === 'too_large' && /标签超过 2,097,152 个/.test(err.detail) && ms < 3000,
    `many-tags.png（6000 万个空 compound）很快报 too_large：${ms} ms`, err && `${err.code} ${err.detail}`);
  const atLimit = N.read(zlib.gunzipSync(S.extract(oddFile('tags-at-limit'))));
  ok(atLimit.tags === S.LIMITS.tags && atLimit.value.compound.l.list.length === S.LIMITS.tags - 2,
    'tags-at-limit.png：NBT 正好 2,097,152 个标签，能读完（再报 bad_schematic 是因为没有 Version）');
  ok(codeOf(() => N.read(zlib.gunzipSync(S.extract(oddFile('tags-over-limit'))))) === 'too_large', 'tags-over-limit.png：2,097,153 个 → too_large');
}

// ---------------------------------------------------------------- 每个 case：模型 → PNG / .schem → 读回 → dump == case；写两次一样
const CASE_DIR = path.join(FIXTURE_DIR, 'cases');
const readCase = (name) => JSON.parse(fs.readFileSync(path.join(CASE_DIR, `${name}.json`), 'utf8'));
for (const c of CASES) {
  const want = readCase(c.name);
  ok(same(want, caseDump(c.name)), `case ${c.name}：提交的 cases/${c.name}.json 和生成器里的模型一致`);
  const model = S.fromDump(want);
  ok(same(S.dump(model), want), `case ${c.name}：fromDump → dump 原样回来`);
  const t0 = Date.now();
  const png1 = await S.writePng(model);
  const t1 = Date.now();
  const back = S.dump(await S.read(png1));
  const t2 = Date.now();
  const diff = diffJSON(back, want);
  ok(diff === null, `case ${c.name}：模型 → PNG → 读回 → dump == case`, diff);
  const png2 = await S.writePng(S.fromDump(want));
  ok(Buffer.compare(Buffer.from(png1), Buffer.from(png2)) === 0, `case ${c.name}：写两次 PNG 字节一样（${png1.length} 字节）`);
  const schem1 = await S.writeSchem(model);
  const schem2 = await S.writeSchem(model);
  ok(Buffer.compare(Buffer.from(schem1), Buffer.from(schem2)) === 0 && same(S.dump(await S.read(schem1)), want),
    `case ${c.name}：裸 .schem 写两次一样、读回 == case`);
  const committed = fs.readFileSync(path.join(FIXTURE_DIR, 'js', `${c.name}.png`));
  ok(Buffer.compare(committed, Buffer.from(png1)) === 0, `case ${c.name}：和提交的 js/${c.name}.png 逐字节一样`);
  if (c.name === 'big-air') {
    ok(t1 - t0 < 3000 && t2 - t1 < 3000, `case big-air：写 ${t1 - t0} ms、读 ${t2 - t1} ms（都要 < 3 秒）`);
  }
}

// ---------------------------------------------------------------- 读 fmt-java 写的 java/*.png（P1 验收）
let crossSkipped = false;
{
  const JAVA_DIR = path.join(FIXTURE_DIR, 'java');
  const missing = [];
  for (const c of CASES) {
    const file = path.join(JAVA_DIR, `${c.name}.png`);
    if (!fs.existsSync(file)) { missing.push(`${c.name}.png`); continue; }
    const t0 = Date.now();
    let got;
    try {
      got = S.dump(await S.read(fs.readFileSync(file)));
    } catch (e) {
      ok(false, `java/${c.name}.png 读不了`, e instanceof S.ShareError ? `${e.code}：${e.message}（${e.detail}）` : String(e && e.stack));
    }
    const ms = Date.now() - t0;
    const diff = diffJSON(got, readCase(c.name));
    ok(diff === null, `java/${c.name}.png 读出来的 dump == cases/${c.name}.json${c.name === 'big-air' ? `（${ms} ms）` : ''}`, diff);
    if (c.name === 'big-air') ok(ms < 3000, `java/big-air.png 读 ${ms} ms（要 < 3 秒）`);
  }
  if (missing.length) {
    const what = `fixtures/share/java/ 缺 ${missing.length} 个：${missing.join(' ')}（在 mod/ 里跑 gradlew shareFixtures 生成）`;
    ok(!REQUIRE_CROSS, `--require-cross：${what}`);
    console.log(`\n######## SKIP 没测「读 Java 写的图」：${what} ########\n`);
  }
  crossSkipped = missing.length > 0;
}

// ---------------------------------------------------------------- odd/：每个怪文件的结果和 .expect.json 一样
{
  const ODD_DIR = path.join(FIXTURE_DIR, 'odd');
  for (const o of ODD) {
    const expect = JSON.parse(fs.readFileSync(path.join(ODD_DIR, `${o.name}.expect.json`), 'utf8'));
    ok(same(expect, o.expect), `odd ${o.file}：提交的 .expect.json 和生成器一致`);
    let got;
    try {
      got = { dump: S.dump(await S.read(fs.readFileSync(path.join(ODD_DIR, o.file)))) };
    } catch (e) {
      if (!(e instanceof S.ShareError)) ok(false, `odd ${o.file}：不该抛这种错`, String(e && e.stack));
      got = { error: e.code };
    }
    ok(diffJSON(got, expect) === null, `odd ${o.file} → ${expect.error ? expect.error : 'dump 一致'}`, expect.error ? got : diffJSON(got, expect));
  }
}

// ---------------------------------------------------------------- 错误提示和 FORMAT.md 第 5 节一字不差
{
  const md = fs.readFileSync(path.join(WEB_DIR, '..', 'docs', 'FORMAT.md'), 'utf8');
  const sec = md.slice(md.indexOf('\n## 5.'), md.indexOf('\n## 6.'));
  const table = {};
  for (const m of sec.matchAll(/^\| `([a-z_]+)` \|[^|\n]*\| ([^|\n]+?) \|\s*$/gm)) table[m[1]] = m[2];
  const codes = ['unknown_file', 'bad_png', 'no_data', 'multiple_data', 'bad_crc', 'too_large', 'bad_gzip', 'bad_nbt', 'unsupported_version', 'bad_schematic'];
  ok(codes.every((k) => typeof table[k] === 'string'), 'FORMAT.md 第 5 节：10 个错误代码都找到了', Object.keys(table));
  for (const k of codes) {
    const want = k === 'bad_schematic' ? table[k].replace('（写明具体哪里）', '') : table[k];
    ok(S.MESSAGES[k] === want, `提示文字 ${k} 和 FORMAT.md 一样`, S.MESSAGES[k]);
  }
  ok(new S.ShareError('unsupported_version', 'Version = 2', { version: 2 }).message === '这个文件是 Sponge 第 2 版格式，现在只支持第 3 版。'
    && new S.ShareError('bad_schematic', '没有 Blocks').message === '方块数据不完整：没有 Blocks', '提示文字：版本号填进去、bad_schematic 接上具体原因');
}

// ---------------------------------------------------------------- check-fixtures、命令行
{
  const t0 = Date.now();
  const r = await checkFixtures();
  ok(r.problems.length === 0, `check-fixtures：重新生成 ${r.files} 个文件，和提交的逐字节一样（${Date.now() - t0} ms）`, r.problems.slice(0, 5));
  const run = (...args) => spawnSync(process.execPath, [path.join(WEB_DIR, 'tools', 'share.mjs'), ...args], { encoding: 'utf8' });
  const axes = path.join(FIXTURE_DIR, 'js', 'axes.png');
  const d = run('dump', axes);
  ok(d.status === 0 && same(JSON.parse(d.stdout), readCase('axes')), '命令行 dump js/axes.png == cases/axes.json', d.stderr);
  const e = run('dump', path.join(FIXTURE_DIR, 'odd', 'bad-crc.png'));
  ok(e.status === 1 && JSON.parse(e.stdout).error === 'bad_crc', '命令行 dump 坏文件：退出码 1，输出 {"error":"bad_crc",…}', e.stdout);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'share-test-'));
  try {
    const x = run('extract', axes, path.join(tmp, 'a.schem'));
    const w = run('wrap', path.join(tmp, 'a.schem'), path.join(tmp, 'a.png'));
    ok(x.status === 0 && w.status === 0 && same(S.dump(await S.read(fs.readFileSync(path.join(tmp, 'a.png')))), readCase('axes')),
      '命令行 extract → wrap：读回 == cases/axes.json', x.stderr + w.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  ok(run('nope').status === 2, '命令行：不认识的命令 → 退出码 2');
}

console.log(crossSkipped ? `\nALL PASS (${checks} checks) —— 但跳过了「读 Java 写的图」（见上面的 SKIP）` : `\nALL PASS (${checks} checks)`);
