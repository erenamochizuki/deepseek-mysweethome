import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_DIR } from './mock-probe.mjs';
import { parseSnbt, parseCompound, toSnbt, typedDiff, decimalToBits, javaDecimal, SnbtError } from '../lib/snbt.mjs';

const bad = (text, re) => assert.throws(() => parseSnbt(text), (e) => e instanceof SnbtError && re.test(e.message), text);

test('各种类型都读得出来', () => {
  const v = parseSnbt('{a:1b,b:-2s,c:3,d:4L,e:1.5f,f:2.0d,g:"x",h:[B;1B,-2B],i:[I;1,-2],j:[L;1L,-9223372036854775808L],k:[1,2],l:{},m:[]}');
  assert.deepEqual(v, { compound: {
    a: { byte: 1 }, b: { short: -2 }, c: { int: 3 }, d: { long: '4' }, e: { float: '3fc00000' },
    f: { double: '4000000000000000' }, g: { string: 'x' }, h: { byteArray: [1, -2] }, i: { intArray: [1, -2] },
    j: { longArray: ['1', '-9223372036854775808'] }, k: { list: [{ int: 1 }, { int: 2 }] }, l: { compound: {} }, m: { list: [] },
  } });
  assert.deepEqual(parseSnbt('[B;]'), { byteArray: [] });
  assert.deepEqual(parseSnbt('[I;]'), { intArray: [] });
  assert.deepEqual(parseSnbt('[L;]'), { longArray: [] });
  assert.deepEqual(parseSnbt('[[],[{}],["a",1b]]'), { list: [{ list: [] }, { list: [{ compound: {} }] }, { list: [{ string: 'a' }, { byte: 1 }] }] });
  // 只有一个空键的 compound 不拆开
  assert.deepEqual(parseSnbt('[{"":5}]'), { list: [{ compound: { '': { int: 5 } } }] });
});

test('探针真实给出的箱子', () => {
  assert.deepEqual(parseCompound('{Items:[{Slot:0b,count:3,id:"minecraft:apple"}],components:{},id:"minecraft:chest",x:7,y:-60,z:3}'), { compound: {
    Items: { list: [{ compound: { Slot: { byte: 0 }, count: { int: 3 }, id: { string: 'minecraft:apple' } } }] },
    components: { compound: {} }, id: { string: 'minecraft:chest' }, x: { int: 7 }, y: { int: -60 }, z: { int: 3 },
  } });
  assert.throws(() => parseCompound('[1]'), /最外层要是/);
});

test('整数的范围和写法', () => {
  assert.deepEqual(parseSnbt('[127b,-128b,32767s,-32768s,2147483647,-2147483648,9223372036854775807L]'), { list: [
    { byte: 127 }, { byte: -128 }, { short: 32767 }, { short: -32768 }, { int: 2147483647 }, { int: -2147483648 },
    { long: '9223372036854775807' }] });
  for (const t of ['128b', '-129b', '32768s', '2147483648', '9223372036854775808L', '-0', '01', '+1', '1B', '1l', '1S']) bad(t, /看不懂/);
  bad('[B;1b]', /数组里/);
  bad('[L;1]', /数组里/);
  bad('[I;1L]', /数组里/);
});

test('float、double 精确到位', () => {
  const f = { '1.5': '3fc00000', '0.1': '3dcccccd', '3.4028235E38': '7f7fffff', '1.4E-45': '00000001', '-0.0': '80000000',
    '0.0': '00000000', 'NaN': '7fc00000', 'Infinity': '7f800000', '-Infinity': 'ff800000', '1.17549435E-38': '00800000', '1.0E-5': '3727c5ac' };
  for (const [t, h] of Object.entries(f)) assert.deepEqual(parseSnbt(t + 'f'), { float: h }, t);
  const d = { '0.1': '3fb999999999999a', '1.7976931348623157E308': '7fefffffffffffff', '4.9E-324': '0000000000000001',
    '-0.0': '8000000000000000', 'NaN': '7ff8000000000000', '-Infinity': 'fff0000000000000', '1.0E10': '4202a05f20000000' };
  for (const [t, h] of Object.entries(d)) assert.deepEqual(parseSnbt(t + 'd'), { double: h }, t);
  for (const t of ['1f', '.5f', '1.f', '1e5f', '1.0e5f', '1.0E+5f', 'nanf', '1.0E400f', '1.0', '1d']) bad(t, /看不懂/);
});

test('随机的 float / double 写出去再读回来位不变', () => {
  const dv = new DataView(new ArrayBuffer(8));
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed; };
  for (let n = 0; n < 3000; n++) {
    const bits = (rnd() ^ (rnd() << 16)) >>> 0;
    dv.setUint32(0, bits);
    if (!Number.isFinite(dv.getFloat32(0))) continue;
    const hex = bits.toString(16).padStart(8, '0');
    const text = toSnbt({ float: hex });
    assert.match(text, /^-?[0-9]+\.[0-9]+(E-?[0-9]+)?f$/, text);
    assert.deepEqual(parseSnbt(text), { float: hex }, text);
  }
  for (let n = 0; n < 3000; n++) {
    dv.setUint32(0, rnd() ^ (rnd() << 16)); dv.setUint32(4, rnd() ^ (rnd() << 16));
    const v = dv.getFloat64(0);
    if (!Number.isFinite(v)) continue;
    const hex = dv.getBigUint64(0).toString(16).padStart(16, '0');
    assert.equal(decimalToBits(javaDecimal(String(v)), 'double'), hex, String(v));
    assert.deepEqual(parseSnbt(toSnbt({ double: hex })), { double: hex });
  }
  assert.equal(toSnbt({ float: '00000001' }), '1.4E-45f');
  assert.equal(toSnbt({ double: '0000000000000001' }), '4.9E-324d');
  assert.equal(toSnbt({ float: '3dcccccd' }), '0.1f');
  assert.equal(toSnbt({ double: '4202a05f20000000' }), '1.0E10d');
  assert.equal(toSnbt({ double: '3f50624dd2f1a9fc' }), '0.001d');
});

test('字符串的引号和转义', () => {
  const s = (t) => parseSnbt(t).string;
  assert.equal(s('"abc"'), 'abc');
  assert.equal(s(`'a"b'`), 'a"b');
  assert.equal(s(`"a'b"`), "a'b");
  assert.equal(s(String.raw`"\\ \" \' \n\t\b\f\r \x01\x1F\x7f"`), '\\ " \' \n\t\b\f\r \x01\x1F\x7f');
  assert.equal(s('"海边🐳 小屋"'), '海边🐳 小屋');
  assert.equal(s('""'), '');
  for (const t of [String.raw`"\u0041"`, String.raw`"\s"`, String.raw`"\x4"`, '"abc', '"a\nb"']) bad(t, /转义|引号|控制字符|十六进制/);
  for (const t of ['abc', 'true', 'false', '{a:abc}']) bad(t, /看不懂/);
  // 打印器：先出现 " 就用 ' 包；只转义用来包的引号
  assert.equal(toSnbt({ string: `a"b'c` }), String.raw`'a"b\'c'`);
  assert.equal(toSnbt({ string: `a'b"c` }), String.raw`"a'b\"c"`);
  assert.equal(toSnbt({ string: '\\\n\x01' }), String.raw`"\\\n\x01"`);
});

test('键：不带引号、带引号、__proto__、重复', () => {
  const v = parseSnbt(`{"a b":1,"1x":2,"true":3,__proto__:4,'q"':5,a.b_c+-:6}`).compound;
  assert.deepEqual(Object.keys(v), ['a b', '1x', 'true', '__proto__', 'q"', 'a.b_c+-']);
  assert.ok(Object.hasOwn(v, '__proto__'));
  assert.deepEqual(v.__proto__, { int: 4 });
  assert.equal(JSON.stringify(parseSnbt('{__proto__:1}')), '{"compound":{"__proto__":{"int":1}}}');
  bad('{a:1,a:2}', /重复/);
  bad('{1a:1}', /键要么/);
  bad('{-a:1}', /键要么/);
  assert.equal(toSnbt({ compound: { b: { int: 1 }, 'a b': { int: 2 }, true: { int: 3 }, A: { int: 4 } } }), '{A:4,"a b":2,b:1,"true":3}');
});

test('写法不对的地方报错', () => {
  for (const t of ['{a: 1}', '{ a:1}', '[1, 2]', '{a:1,}', '[1,]', '{a:1}x', '{a:1', '[1', '{a}', '', '{,}', 'END']) bad(t, /./);
  bad('['.repeat(600) + ']'.repeat(600), /嵌套/);
});

test('共用样例里的数据写成 SNBT 再读回来不变', () => {
  const dir = path.join(REPO_DIR, 'fixtures', 'share', 'cases');
  let count = 0;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const dump = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const v of [dump.meta, ...dump.blockEntities.map((b) => b.data)]) {
      if (!v) continue;
      assert.deepEqual(parseSnbt(toSnbt(v)), v, f);
      count++;
    }
  }
  assert.ok(count >= 5, `只找到 ${count} 份数据`);
});

test('typedDiff 找出第一处不一样', () => {
  const a = parseSnbt('{Items:[{Slot:0b,count:3,id:"minecraft:apple"}],x:1}');
  assert.equal(typedDiff(a, parseSnbt('{x:1,Items:[{id:"minecraft:apple",count:3,Slot:0b}]}')), null);
  assert.match(typedDiff(a, parseSnbt('{Items:[{Slot:0b,count:2,id:"minecraft:apple"}],x:1}')), /^\.Items\[0\]\.count：期望 \{"int":3\}，实际 \{"int":2\}$/);
  assert.match(typedDiff(a, parseSnbt('{Items:[],x:1}')), /列表长度不一样，期望 1，实际 0/);
  assert.match(typedDiff(a, parseSnbt('{Items:[{Slot:0b,count:3,id:"minecraft:apple"}]}')), /^\.x：实际没有这个键/);
  assert.match(typedDiff(a, parseSnbt('{Items:[{Slot:0b,count:3,id:"minecraft:apple"}],x:1,y:2}')), /^\.y：实际多了这个键/);
  assert.match(typedDiff(a, parseSnbt('{Items:[{Slot:0b,count:3b,id:"minecraft:apple"}],x:1}')), /类型不一样/);
  assert.match(typedDiff({ intArray: [1, 2] }, { intArray: [1, 3] }), /数组不一样/);
});
