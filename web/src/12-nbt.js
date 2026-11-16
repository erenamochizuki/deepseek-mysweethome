// 12-nbt.js — Java 版 NBT（大端）读写、modified UTF-8、无符号 LEB128 varint、gzip。
//
// 约定以 docs/FORMAT.md 第 2、4 节为准。这里只管「字节 ↔ 带类型的 NBT 值」，不懂 Schematic
// （那是 13-share.js 的事）。所有页面都会加载本文件，所以加载时只定义函数，不碰 DOM。
//
// 带类型的 NBT 值，形状和 FORMAT.md 第 4 节 dump 里的 typed JSON 一样：
//   {byte:n} {short:n} {int:n} {long:"十进制字符串"} {float:"8 位小写十六进制（IEEE 位）"}
//   {double:"16 位小写十六进制"} {string:s} {byteArray:Int8Array} {intArray:Int32Array}
//   {longArray:BigInt64Array} {list:[值…]} {compound:{键:值}}
// - 读出来的 compound 是 N.Compound 的实例：原型链上没有 Object.prototype（没有 toString、
//   hasOwnProperty 这些继承来的键，键叫 "__proto__" 也只是普通的键）；比 Object.create(null)
//   省内存（实测一个空 compound 67 字节 vs 227 字节，标签数到上限时差 300 多 MB）。
//   判断有没有某个键用 `k in c` 或 Object.hasOwn(c, k)，别用 c.hasOwnProperty。
// - 标签总数最多 N.MAX_TAGS（2^21）个，读、写都数（FORMAT.md 第 2 节），超了 too_large。
// - 写的时候数组也可以是普通数组（byteArray 还可以是 Uint8Array，按原始字节写），
//   long 也可以给 BigInt。N.toJSON / N.fromJSON 在它和纯 JSON 之间转换。
// - list 不记元素类型（FORMAT.md 第 2 节，照 MC 26.1 ListTag）：读时「只有一个空键」的
//   compound 元素换成里面的值；写时同类型 → 那个类型，混合 → 10 并把需要的元素包一层。
//
// 出错一律抛 N.NbtError，code：
//   bad_nbt   读到的 NBT 不对（截断、未知类型、嵌套超过 512 层、编码不对……）
//   bad_gzip  解压失败
//   too_large 解压后超过上限（默认 64 MiB），或者标签总数超过 N.MAX_TAGS（读和写都会）
//   bad_value 要写的值不对（类型、范围、字符串太长、嵌套太深）
//   bad_varint  varint 数据不对（13-share.js 把它报成 bad_schematic）
(function (V3) {
  'use strict';

  const N = V3.nbt = {};

  const KIND_BY_ID = ['end', 'byte', 'short', 'int', 'long', 'float', 'double',
    'byteArray', 'string', 'list', 'compound', 'intArray', 'longArray'];
  const KIND_ID = Object.create(null);
  KIND_BY_ID.forEach((k, i) => { if (i) KIND_ID[k] = i; });
  // 每种标签的载荷最少几个字节（检查「声明的长度比剩下的字节还多」用）
  const MIN_SIZE = [0, 1, 2, 4, 8, 4, 8, 4, 2, 5, 1, 4, 4];

  N.TAG = Object.freeze(Object.assign(Object.create(null), KIND_ID, { end: 0 }));
  N.KINDS = Object.freeze(KIND_BY_ID.slice(1));
  N.MAX_DEPTH = 512;
  N.MAX_STRING_BYTES = 65535;
  N.MAX_UNZIPPED = 64 * 1024 * 1024;
  // 标签总数上限（FORMAT.md 第 2 节）：根 1 个；compound 每个成员 1 个；list 每个元素 1 个
  // （展开 {"": v} 之前数，包装和里面的值各 1 个）；数组不管多长 1 个；结束标记不算。
  N.MAX_TAGS = 2097152;

  // compound 的对象。原型是一个冻结的、自己也没有原型的空对象：读到 "__proto__"、
  // "constructor" 这种键只是普通的自有属性；V8 对这种对象用快速属性，比字典模式省很多内存。
  function Compound() {}
  Compound.prototype = Object.freeze(Object.create(null));
  N.Compound = Compound;
  const tooManyTags = (max) => `标签超过 ${String(max).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} 个`;

  class NbtError extends Error {
    constructor(code, detail) {
      super(detail ? code + ': ' + detail : code);
      this.name = 'NbtError';
      this.code = code;
      this.detail = detail || '';
    }
  }
  N.NbtError = NbtError;
  function fail(code, detail) { throw new NbtError(code, detail); }

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const hex8 = (u) => (u >>> 0).toString(16).padStart(8, '0');
  const LONG_RE = /^(0|-?[1-9][0-9]*)$/;
  const HEX8_RE = /^[0-9a-f]{8}$/;
  const HEX16_RE = /^[0-9a-f]{16}$/;
  const LONG_MIN = -(2n ** 63n), LONG_MAX = 2n ** 63n - 1n;

  function asBytes(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    throw new TypeError('需要字节（Uint8Array 或 ArrayBuffer）');
  }
  N.asBytes = asBytes;

  function sub(path, key) {
    return path ? path + '.' + key : key;
  }

  // ---------- modified UTF-8（Java DataOutput.writeUTF / DataInput.readUTF） ----------

  function utfLength(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      n += (c >= 1 && c <= 0x7f) ? 1 : (c <= 0x7ff ? 2 : 3);
    }
    return n;
  }

  // 编码进 out[p…]，返回新的 p；调用方先保证空间够
  function utfEncodeInto(out, p, s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 1 && c <= 0x7f) {
        out[p++] = c;
      } else if (c <= 0x7ff) {
        out[p++] = 0xc0 | (c >> 6);
        out[p++] = 0x80 | (c & 0x3f);
      } else {
        out[p++] = 0xe0 | (c >> 12);
        out[p++] = 0x80 | ((c >> 6) & 0x3f);
        out[p++] = 0x80 | (c & 0x3f);
      }
    }
    return p;
  }

  // 和 JDK 的 readUTF 一样宽松：裸 00、过长编码（C0 80、E0 80 80）、单独的代理项都接受；
  // 首字节是 10xxxxxx / 1111xxxx、后续字节不是 10xxxxxx、字符没写完 → bad_nbt
  function utfDecode(b, start, end) {
    let out = '';
    let units = [];
    let i = start;
    while (i < end) {
      const c = b[i];
      let u;
      if (c < 0x80) {
        u = c;
        i += 1;
      } else if ((c & 0xe0) === 0xc0) {
        if (i + 2 > end) fail('bad_nbt', `字符串在第 ${i} 字节处，最后一个字没写完`);
        const c2 = b[i + 1];
        if ((c2 & 0xc0) !== 0x80) fail('bad_nbt', `字符串编码不对（第 ${i + 1} 字节）`);
        u = ((c & 0x1f) << 6) | (c2 & 0x3f);
        i += 2;
      } else if ((c & 0xf0) === 0xe0) {
        if (i + 3 > end) fail('bad_nbt', `字符串在第 ${i} 字节处，最后一个字没写完`);
        const c2 = b[i + 1], c3 = b[i + 2];
        if ((c2 & 0xc0) !== 0x80 || (c3 & 0xc0) !== 0x80) fail('bad_nbt', `字符串编码不对（第 ${i + 1} 字节）`);
        u = ((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f);
        i += 3;
      } else {
        fail('bad_nbt', `字符串编码不对（第 ${i} 字节是 0x${c.toString(16)}）`);
      }
      units.push(u);
      if (units.length >= 4096) {
        out += String.fromCharCode.apply(null, units);
        units = [];
      }
    }
    if (units.length) out += String.fromCharCode.apply(null, units);
    return out;
  }

  N.mutf8 = Object.freeze({
    byteLength(s) { return utfLength(String(s)); },
    encode(s) {
      if (typeof s !== 'string') fail('bad_value', '不是字符串');
      const n = utfLength(s);
      if (n > N.MAX_STRING_BYTES) fail('bad_value', `字符串编码后 ${n} 字节，超过 65535`);
      const out = new Uint8Array(n);
      utfEncodeInto(out, 0, s);
      return out;
    },
    decode(bytes, start, end) {
      const b = asBytes(bytes);
      return utfDecode(b, start == null ? 0 : start, end == null ? b.length : end);
    },
  });

  // ---------- 无符号 LEB128 varint（Blocks.Data） ----------

  N.varint = Object.freeze({
    // values：整数数组或 TypedArray，每个 0..2147483647 → Uint8Array
    encode(values) {
      const n = values.length;
      let len = 0;
      for (let i = 0; i < n; i++) {
        const v = values[i];
        if (!Number.isInteger(v) || v < 0 || v > 0x7fffffff) fail('bad_value', `第 ${i} 个值 ${v} 不是 0..2147483647 的整数`);
        len += v < 0x80 ? 1 : v < 0x4000 ? 2 : v < 0x200000 ? 3 : v < 0x10000000 ? 4 : 5;
      }
      const out = new Uint8Array(len);
      let p = 0;
      for (let i = 0; i < n; i++) {
        let v = values[i];
        while (v >= 0x80) {
          out[p++] = (v & 0x7f) | 0x80;
          v >>>= 7;
        }
        out[p++] = v;
      }
      return out;
    },
    // 正好读 count 个值，不能多也不能少字节；最多 5 字节、值 ≤ 2³¹−1；不要求最短编码
    decode(bytes, count) {
      const b = asBytes(bytes);
      const n = b.length;
      const out = new Int32Array(count);
      let p = 0;
      for (let i = 0; i < count; i++) {
        if (p >= n) fail('bad_varint', `只写了 ${i} 格，应该有 ${count} 格`);
        let c = b[p++];
        if (c < 0x80) {
          out[i] = c;
          continue;
        }
        let v = c & 0x7f;
        let shift = 7;
        for (;;) {
          if (p >= n) fail('bad_varint', `第 ${i} 格的编号没写完`);
          c = b[p++];
          if (shift === 28) {
            if (c > 0x07) fail('bad_varint', `第 ${i} 格的编号超过 5 字节或大于 2147483647`);
            v |= c << 28;
            break;
          }
          v |= (c & 0x7f) << shift;
          if (c < 0x80) break;
          shift += 7;
        }
        out[i] = v;
      }
      if (p !== n) fail('bad_varint', `${count} 格读完后还多出 ${n - p} 字节`);
      return out;
    },
  });

  // ---------- 读 ----------

  // 返回 {name, value: {compound:{…}}, end, tags}；根后面多出来的字节不管（end = 根结束的位置，
  // tags = 按 FORMAT.md 第 2 节数出来的标签数）。
  // opts.maxTags：标签总数上限，默认 N.MAX_TAGS（测试用小的值查数法）。
  N.read = function (bytes, opts) {
    const b = asBytes(bytes);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const n = b.length;
    const maxTags = opts && opts.maxTags != null ? opts.maxTags : N.MAX_TAGS;
    let p = 0;
    let depth = 0;
    let tags = 0;

    function need(k) {
      if (k > n - p) fail('bad_nbt', `数据在第 ${p} 字节处提前结束`);
    }
    // 每个标签在读它之前数（FORMAT.md 第 2 节）；第 maxTags+1 个就停，不再分配
    function countTag() {
      if (tags >= maxTags) fail('too_large', tooManyTags(maxTags));
      tags++;
    }
    function str() {
      need(2);
      const len = dv.getUint16(p);
      p += 2;
      need(len);
      const s = utfDecode(b, p, p + len);
      p += len;
      return s;
    }
    function arrayLength(size, what) {
      need(4);
      const len = dv.getInt32(p);
      p += 4;
      if (len < 0) fail('bad_nbt', `${what} 的长度是负数（${len}）`);
      if (len * size > n - p) fail('bad_nbt', `${what} 声明 ${len} 个元素，比剩下的字节还多`);
      return len;
    }
    function push() {
      if (depth >= N.MAX_DEPTH) fail('bad_nbt', '嵌套超过 512 层');
      depth++;
    }
    function compound() {
      push();
      const c = new Compound();
      for (;;) {
        need(1);
        const t = b[p++];
        if (t === 0) break;
        countTag();
        const key = str();
        if (t > 12) fail('bad_nbt', `未知的标签类型 ${t}（键 ${JSON.stringify(key)}）`);
        c[key] = payload(t);
      }
      depth--;
      return { compound: c };
    }
    function list() {
      push();
      need(5);
      const et = b[p];
      const count = dv.getInt32(p + 1);
      p += 5;
      if (count < 0) fail('bad_nbt', `列表长度是负数（${count}）`);
      if (et === 0 && count > 0) fail('bad_nbt', '列表元素类型是 0，长度却不是 0');
      const items = [];
      if (count > 0) {
        if (et > 12) fail('bad_nbt', `未知的列表元素类型 ${et}`);
        if (count * MIN_SIZE[et] > n - p) fail('bad_nbt', `列表声明 ${count} 个元素，比剩下的字节还多`);
        for (let i = 0; i < count; i++) {
          countTag();
          let v = payload(et);
          if (et === 10) {
            const c = v.compound;
            if ('' in c && Object.keys(c).length === 1) v = c[''];
          }
          items.push(v);
        }
      }
      depth--;
      return { list: items };
    }
    function payload(t) {
      switch (t) {
        case 1: need(1); return { byte: dv.getInt8(p++) };
        case 2: { need(2); const v = dv.getInt16(p); p += 2; return { short: v }; }
        case 3: { need(4); const v = dv.getInt32(p); p += 4; return { int: v }; }
        case 4: { need(8); const v = dv.getBigInt64(p); p += 8; return { long: String(v) }; }
        case 5: { need(4); const v = dv.getUint32(p); p += 4; return { float: hex8(v) }; }
        case 6: { need(8); const v = hex8(dv.getUint32(p)) + hex8(dv.getUint32(p + 4)); p += 8; return { double: v }; }
        case 7: {
          const len = arrayLength(1, 'byte array');
          const a = new Int8Array(len);
          a.set(new Int8Array(b.buffer, b.byteOffset + p, len));
          p += len;
          return { byteArray: a };
        }
        case 8: return { string: str() };
        case 9: return list();
        case 10: return compound();
        case 11: {
          const len = arrayLength(4, 'int array');
          const a = new Int32Array(len);
          for (let i = 0; i < len; i++, p += 4) a[i] = dv.getInt32(p);
          return { intArray: a };
        }
        case 12: {
          const len = arrayLength(8, 'long array');
          const a = new BigInt64Array(len);
          for (let i = 0; i < len; i++, p += 8) a[i] = dv.getBigInt64(p);
          return { longArray: a };
        }
        default: return fail('bad_nbt', `未知的标签类型 ${t}`);
      }
    }

    need(1);
    const t = b[p++];
    if (t !== 10) fail('bad_nbt', `根标签类型是 ${t}，必须是 compound（10）`);
    countTag();
    const name = str();
    const value = compound();
    return { name, value, end: p, tags };
  };

  // ---------- 写 ----------

  class Out {
    constructor(cap, maxTags) {
      this.b = new Uint8Array(cap);
      this.dv = new DataView(this.b.buffer);
      this.p = 0;
      this.tags = 0;
      this.maxTags = maxTags;
    }
    // 和读的时候一样数标签（顺序也一样：先数，再查这一层的深度）
    tag(path) {
      if (this.tags >= this.maxTags) fail('too_large', `${path || '根'}：${tooManyTags(this.maxTags)}`);
      this.tags++;
    }
    ensure(k) {
      if (this.p + k <= this.b.length) return;
      let cap = this.b.length * 2;
      while (cap < this.p + k) cap *= 2;
      const nb = new Uint8Array(cap);
      nb.set(this.b.subarray(0, this.p));
      this.b = nb;
      this.dv = new DataView(nb.buffer);
    }
    u8(v) { this.ensure(1); this.b[this.p++] = v; }
    i16(v) { this.ensure(2); this.dv.setInt16(this.p, v); this.p += 2; }
    i32(v) { this.ensure(4); this.dv.setInt32(this.p, v); this.p += 4; }
    u32(v) { this.ensure(4); this.dv.setUint32(this.p, v); this.p += 4; }
    i64(v) { this.ensure(8); this.dv.setBigInt64(this.p, v); this.p += 8; }
    raw(bytes) { this.ensure(bytes.length); this.b.set(bytes, this.p); this.p += bytes.length; }
    utf(s, path) {
      if (typeof s !== 'string') fail('bad_value', `${path || '值'}：不是字符串`);
      const len = utfLength(s);
      if (len > N.MAX_STRING_BYTES) fail('bad_value', `${path || '值'}：字符串编码后 ${len} 字节，超过 65535`);
      this.ensure(2 + len);
      this.dv.setUint16(this.p, len);
      this.p = utfEncodeInto(this.b, this.p + 2, s);
    }
    result() { return this.b.slice(0, this.p); }
  }

  function kindOf(tag, path) {
    if (tag === null || typeof tag !== 'object' || Array.isArray(tag)) {
      fail('bad_value', `${path || '值'}：不是带类型的 NBT 值（应该像 {int: 1}）`);
    }
    const keys = Object.keys(tag);
    if (keys.length !== 1 || !(keys[0] in KIND_ID)) {
      fail('bad_value', `${path || '值'}：应该是只有一个类型键的对象（byte、short、int、long、float、double、string、byteArray、intArray、longArray、list、compound），实际键是 ${JSON.stringify(keys)}`);
    }
    return keys[0];
  }
  N.kindOf = function (tag) {
    try { return kindOf(tag, ''); } catch (e) { return null; }
  };

  function checkInt(v, lo, hi, path) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
      fail('bad_value', `${path || '值'}：${String(v)} 不是 ${lo}..${hi} 的整数`);
    }
    return v;
  }
  function parseLong(v, path) {
    let big;
    if (typeof v === 'bigint') big = v;
    else if (typeof v === 'string' && LONG_RE.test(v)) big = BigInt(v);
    else fail('bad_value', `${path || '值'}：long 要写成十进制字符串（比如 "-5"），实际是 ${JSON.stringify(String(v))}`);
    if (big < LONG_MIN || big > LONG_MAX) fail('bad_value', `${path || '值'}：${v} 超出 long 的范围`);
    return big;
  }
  function parseHex(v, re, digits, path) {
    if (typeof v !== 'string' || !re.test(v)) {
      fail('bad_value', `${path || '值'}：要写成 ${digits} 位小写十六进制（IEEE 754 的位），实际是 ${JSON.stringify(String(v))}`);
    }
    return v;
  }
  function isWrapperShape(c) {
    return c !== null && typeof c === 'object' && hasOwn(c, '') && Object.keys(c).length === 1;
  }

  function writePayload(o, kind, v, path, depth) {
    switch (kind) {
      case 'byte': o.u8(checkInt(v, -128, 127, path) & 0xff); break;
      case 'short': o.i16(checkInt(v, -32768, 32767, path)); break;
      case 'int': o.i32(checkInt(v, -2147483648, 2147483647, path)); break;
      case 'long': o.i64(parseLong(v, path)); break;
      case 'float': o.u32(parseInt(parseHex(v, HEX8_RE, 8, path), 16)); break;
      case 'double': {
        const h = parseHex(v, HEX16_RE, 16, path);
        o.u32(parseInt(h.slice(0, 8), 16));
        o.u32(parseInt(h.slice(8), 16));
        break;
      }
      case 'string': o.utf(v, path); break;
      case 'byteArray': {
        if (v instanceof Int8Array || v instanceof Uint8Array || v instanceof Uint8ClampedArray) {
          o.i32(v.length);
          o.raw(v instanceof Uint8Array ? v : new Uint8Array(v.buffer, v.byteOffset, v.length));
        } else if (Array.isArray(v)) {
          o.i32(v.length);
          o.ensure(v.length);
          for (let i = 0; i < v.length; i++) o.b[o.p++] = checkInt(v[i], -128, 127, `${path}[${i}]`) & 0xff;
        } else {
          fail('bad_value', `${path || '值'}：byteArray 要是数组或 Int8Array`);
        }
        break;
      }
      case 'intArray': {
        if (!(v instanceof Int32Array) && !Array.isArray(v)) fail('bad_value', `${path || '值'}：intArray 要是数组或 Int32Array`);
        o.i32(v.length);
        for (let i = 0; i < v.length; i++) o.i32(checkInt(v[i], -2147483648, 2147483647, `${path}[${i}]`));
        break;
      }
      case 'longArray': {
        if (!(v instanceof BigInt64Array) && !Array.isArray(v)) fail('bad_value', `${path || '值'}：longArray 要是数组或 BigInt64Array`);
        o.i32(v.length);
        for (let i = 0; i < v.length; i++) o.i64(parseLong(v[i], `${path}[${i}]`));
        break;
      }
      case 'list': writeList(o, v, path, depth); break;
      case 'compound': writeCompound(o, v, path, depth); break;
      default: fail('bad_value', `${path || '值'}：未知类型 ${kind}`);
    }
  }

  // depth = 外面已经套了几层 compound / list；读的时候第 513 层会被拒，所以写的时候也拒
  function writeCompound(o, c, path, depth) {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) fail('bad_value', `${path || '值'}：compound 的值要是对象`);
    if (depth >= N.MAX_DEPTH) fail('bad_value', `${path || '值'}：嵌套超过 512 层`);
    for (const k of Object.keys(c)) {
      const kp = sub(path, k);
      o.tag(kp);
      const tag = c[k];
      const kind = kindOf(tag, kp);
      o.u8(KIND_ID[kind]);
      o.utf(k, kp + '（键）');
      writePayload(o, kind, tag[kind], kp, depth + 1);
    }
    o.u8(0);
  }

  function writeList(o, items, path, depth) {
    if (!Array.isArray(items)) fail('bad_value', `${path || '值'}：list 的值要是数组`);
    if (depth >= N.MAX_DEPTH) fail('bad_value', `${path || '值'}：嵌套超过 512 层`);
    const n = items.length;
    if (n === 0) {
      o.u8(0);
      o.i32(0);
      return;
    }
    const kinds = new Array(n);
    let same = true;
    for (let i = 0; i < n; i++) {
      kinds[i] = kindOf(items[i], `${path}[${i}]`);
      if (kinds[i] !== kinds[0]) same = false;
    }
    const et = same ? KIND_ID[kinds[0]] : 10;
    o.u8(et);
    o.i32(n);
    for (let i = 0; i < n; i++) {
      const k = kinds[i];
      const v = items[i][k];
      const ip = `${path}[${i}]`;
      o.tag(ip);
      if (et !== 10 || (k === 'compound' && !isWrapperShape(v))) {
        writePayload(o, k, v, ip, depth + 1);
      } else {
        // 包一层「只有一个空键」的 compound（MC 26.1 ListTag.wrapIfNeeded）。
        // 包装算 1 个标签（上面已经数了），里面的 "" 成员再算 1 个
        if (depth + 1 >= N.MAX_DEPTH) fail('bad_value', `${ip}：嵌套超过 512 层`);
        o.tag(ip);
        o.u8(KIND_ID[k]);
        o.utf('', ip);
        writePayload(o, k, v, ip, depth + 2);
        o.u8(0);
      }
    }
  }

  // root = {compound:{…}}；返回 Uint8Array（没压缩）。opts.maxTags 同 N.read（默认 N.MAX_TAGS）
  N.write = function (root, name, opts) {
    const kind = kindOf(root, '根');
    if (kind !== 'compound') fail('bad_value', `根标签必须是 compound，实际是 ${kind}`);
    const o = new Out(1024, opts && opts.maxTags != null ? opts.maxTags : N.MAX_TAGS);
    o.u8(10);
    o.tag('');
    o.utf(name == null ? '' : String(name), '根的名字');
    writeCompound(o, root.compound, '', 0);
    return o.result();
  };

  // ---------- gzip ----------

  // 时间戳 0、不写文件名、默认级别（CompressionStream 本来就是这样）。
  // 头里的 OS 字节在不同系统上不一样（zlib：Windows 10、Linux 3），统一改成 255（未知，
  // 和 Java 的 GZIPOutputStream 一样），保证同一份数据在哪台机器上写出来字节都一样。
  N.gzip = async function (bytes) {
    if (typeof CompressionStream !== 'function') throw new Error('这个浏览器不支持 CompressionStream，没法压缩（请换新版 Chrome / Edge / Firefox / Safari）');
    const stream = new Blob([asBytes(bytes)]).stream().pipeThrough(new CompressionStream('gzip'));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    if (out.length >= 10 && out[0] === 0x1f && out[1] === 0x8b && out[3] === 0) out[9] = 0xff;
    return out;
  };

  // 解压出错时的说明：Node 的 DecompressionStream 抛的 TypeError 没有 message，有用的是 code（比如 Z_DATA_ERROR）
  function errText(e) {
    if (!e || typeof e !== 'object') return String(e);
    return [e.name, e.code, e.message].filter((s) => typeof s === 'string' && s).join(' ') || String(e);
  }

  // 边解压边数字节，超过 limit（默认 64 MiB）马上停 → too_large；其他问题 → bad_gzip
  N.gunzip = async function (bytes, limit) {
    if (typeof DecompressionStream !== 'function') throw new Error('这个浏览器不支持 DecompressionStream，没法解压（请换新版 Chrome / Edge / Firefox / Safari）');
    const max = limit == null ? N.MAX_UNZIPPED : limit;
    const input = asBytes(bytes);
    let reader;
    try {
      reader = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    } catch (e) {
      fail('bad_gzip', errText(e));
    }
    const chunks = [];
    let total = 0;
    for (;;) {
      let r;
      try {
        r = await reader.read();
      } catch (e) {
        fail('bad_gzip', errText(e));
      }
      if (r.done) break;
      const c = r.value instanceof Uint8Array ? r.value : asBytes(r.value);
      total += c.length;
      if (total > max) {
        reader.cancel().catch(() => {});
        fail('too_large', `解压后超过 ${max} 字节`);
      }
      chunks.push(c);
    }
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  };

  N.readGzip = async function (bytes, limit, opts) {
    return N.read(await N.gunzip(bytes, limit), opts);
  };
  N.writeGzip = async function (root, name, opts) {
    return N.gzip(N.write(root, name, opts));
  };

  // ---------- 构造、转换、比较 ----------

  const scratch = new DataView(new ArrayBuffer(8));
  N.floatBits = function (x) { scratch.setFloat32(0, x); return hex8(scratch.getUint32(0)); };
  N.doubleBits = function (x) { scratch.setFloat64(0, x); return hex8(scratch.getUint32(0)) + hex8(scratch.getUint32(4)); };
  N.floatValue = function (h) { scratch.setUint32(0, parseInt(parseHex(h, HEX8_RE, 8, 'float'), 16)); return scratch.getFloat32(0); };
  N.doubleValue = function (h) {
    parseHex(h, HEX16_RE, 16, 'double');
    scratch.setUint32(0, parseInt(h.slice(0, 8), 16));
    scratch.setUint32(4, parseInt(h.slice(8), 16));
    return scratch.getFloat64(0);
  };

  N.byte = (v) => ({ byte: checkInt(v, -128, 127, 'byte') });
  N.short = (v) => ({ short: checkInt(v, -32768, 32767, 'short') });
  N.int = (v) => ({ int: checkInt(v, -2147483648, 2147483647, 'int') });
  N.long = (v) => ({ long: String(parseLong(typeof v === 'number' && Number.isSafeInteger(v) ? BigInt(v) : v, 'long')) });
  N.float = (x) => ({ float: N.floatBits(x) });
  N.double = (x) => ({ double: N.doubleBits(x) });
  N.string = (s) => { if (typeof s !== 'string') fail('bad_value', 'string：不是字符串'); return { string: s }; };
  N.byteArray = (a) => ({ byteArray: a instanceof Int8Array ? a : Int8Array.from(a) });
  N.intArray = (a) => ({ intArray: a instanceof Int32Array ? a : Int32Array.from(a) });
  N.longArray = (a) => ({ longArray: a instanceof BigInt64Array ? a : BigInt64Array.from(a, (x) => parseLong(typeof x === 'number' ? BigInt(x) : x, 'longArray')) });
  N.list = (items) => ({ list: Array.from(items) });
  N.compound = (obj) => {
    const c = new Compound();
    if (obj) for (const k of Object.keys(obj)) c[k] = obj[k];
    return { compound: c };
  };

  // 键叫 "__proto__" 时普通赋值会改原型，要用 defineProperty
  function setKey(o, k, v) {
    if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
    else o[k] = v;
  }

  // 带类型的值 → 纯 JSON（数组变普通数组、long 变十进制字符串），就是 dump 里的样子
  N.toJSON = function toJSON(tag) {
    const kind = kindOf(tag, '值');
    const v = tag[kind];
    switch (kind) {
      case 'byte': return { byte: v };
      case 'short': return { short: v };
      case 'int': return { int: v };
      case 'long': return { long: String(parseLong(v, 'long')) };
      case 'float': return { float: v };
      case 'double': return { double: v };
      case 'string': return { string: v };
      case 'byteArray': return { byteArray: Array.from(v, (x) => (x << 24) >> 24) };
      case 'intArray': return { intArray: Array.from(v, (x) => x | 0) };
      case 'longArray': return { longArray: Array.from(v, (x) => String(typeof x === 'bigint' ? x : parseLong(x, 'longArray'))) };
      case 'list': return { list: v.map(toJSON) };
      case 'compound': {
        const out = {};
        for (const k of Object.keys(v)) setKey(out, k, toJSON(v[k]));
        return { compound: out };
      }
    }
    return null;
  };

  // 纯 JSON → 带类型的值，严格检查（形状、范围、long 和十六进制的写法）
  N.fromJSON = function (json, path) {
    return fromJSON(json, path || '', 0);
  };
  function fromJSON(j, path, depth) {
    const kind = kindOf(j, path);
    const v = j[kind];
    switch (kind) {
      case 'byte': return { byte: checkInt(v, -128, 127, path) };
      case 'short': return { short: checkInt(v, -32768, 32767, path) };
      case 'int': return { int: checkInt(v, -2147483648, 2147483647, path) };
      case 'long': {
        if (typeof v !== 'string') fail('bad_value', `${path || '值'}：long 要写成十进制字符串`);
        parseLong(v, path);
        return { long: v };
      }
      case 'float': return { float: parseHex(v, HEX8_RE, 8, path) };
      case 'double': return { double: parseHex(v, HEX16_RE, 16, path) };
      case 'string':
        if (typeof v !== 'string') fail('bad_value', `${path || '值'}：不是字符串`);
        return { string: v };
      case 'byteArray': {
        if (!Array.isArray(v)) fail('bad_value', `${path || '值'}：byteArray 要是数组`);
        const a = new Int8Array(v.length);
        for (let i = 0; i < v.length; i++) a[i] = checkInt(v[i], -128, 127, `${path}[${i}]`);
        return { byteArray: a };
      }
      case 'intArray': {
        if (!Array.isArray(v)) fail('bad_value', `${path || '值'}：intArray 要是数组`);
        const a = new Int32Array(v.length);
        for (let i = 0; i < v.length; i++) a[i] = checkInt(v[i], -2147483648, 2147483647, `${path}[${i}]`);
        return { intArray: a };
      }
      case 'longArray': {
        if (!Array.isArray(v)) fail('bad_value', `${path || '值'}：longArray 要是数组`);
        const a = new BigInt64Array(v.length);
        for (let i = 0; i < v.length; i++) {
          if (typeof v[i] !== 'string') fail('bad_value', `${path}[${i}]：long 要写成十进制字符串`);
          a[i] = parseLong(v[i], `${path}[${i}]`);
        }
        return { longArray: a };
      }
      case 'list': {
        if (!Array.isArray(v)) fail('bad_value', `${path || '值'}：list 要是数组`);
        if (depth >= N.MAX_DEPTH) fail('bad_value', `${path || '值'}：嵌套超过 512 层`);
        return { list: v.map((x, i) => fromJSON(x, `${path}[${i}]`, depth + 1)) };
      }
      case 'compound': {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('bad_value', `${path || '值'}：compound 要是对象`);
        if (depth >= N.MAX_DEPTH) fail('bad_value', `${path || '值'}：嵌套超过 512 层`);
        const c = new Compound();
        for (const k of Object.keys(v)) c[k] = fromJSON(v[k], sub(path, k), depth + 1);
        return { compound: c };
      }
    }
    return null;
  }

  // 按 JSON 值比较（对象不管键的顺序）
  N.equalJSON = function eq(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    const arr = Array.isArray(a);
    if (arr !== Array.isArray(b)) return false;
    if (arr) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (!hasOwn(b, k) || !eq(a[k], b[k])) return false;
    return true;
  };
})(window.V3);
