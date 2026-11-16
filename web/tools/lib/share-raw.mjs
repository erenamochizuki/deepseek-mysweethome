// share-raw.mjs — 样例用的小编码器：原始 NBT（可以写错类型号、假长度、坏字节）、
// 「不压缩」的 gzip / zlib（结果不依赖 zlib 版本）、gzip 炸弹、PNG 块、dump 排版。
// 只给 web/tools/share.mjs 和 web/test/share.test.mjs 用；不依赖 web/src 里的读取器。

import zlib from 'node:zlib';
// ======================================================================
// 自己的小编码器（只给样例用；可以写出任意类型号、假长度、坏字节）
// ======================================================================

export const T = Object.freeze({
  end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6,
  byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11, longArray: 12,
});

export class Out {
  constructor() { this.parts = []; this.len = 0; }
  push(buf) { this.parts.push(buf); this.len += buf.length; }
  u8(v) { this.push(Buffer.from([v & 0xff])); }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); this.push(b); }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v); this.push(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); this.push(b); }
  i64(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); this.push(b); }
  bytes() { return Buffer.concat(this.parts, this.len); }
}

// Java writeUTF 的写法：U+0000 → C0 80；代理项各自按 3 字节写
export function mutf8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 1 && c <= 0x7f) out.push(c);
    else if (c <= 0x7ff) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  if (out.length > 65535) throw new Error('样例里的字符串太长');
  return Buffer.from(out);
}

// 原始标签：{t, v} / 列表 {t, et, items, declared?} / compound {t, entries:[[键, 标签]…]}（保留顺序）
// declared = 故意写错的长度；raw(t, bytes) = 任意类型号 + 任意内容
export const R = Object.freeze({
  byte: (v) => ({ t: T.byte, v }),
  short: (v) => ({ t: T.short, v }),
  int: (v) => ({ t: T.int, v }),
  long: (v) => ({ t: T.long, v: BigInt(v) }),
  float: (hex) => ({ t: T.float, v: hex }),
  double: (hex) => ({ t: T.double, v: hex }),
  string: (v) => ({ t: T.string, v }),
  byteArray: (v, declared) => ({ t: T.byteArray, v, declared }),
  intArray: (v, declared) => ({ t: T.intArray, v, declared }),
  longArray: (v, declared) => ({ t: T.longArray, v, declared }),
  list: (et, items, declared) => ({ t: T.list, et, items, declared }),
  compound: (entries) => ({ t: T.compound, entries }),
  raw: (t, bytes) => ({ t, raw: Buffer.from(bytes) }),
});

function writePayload(o, tag) {
  if (tag.raw) { o.push(tag.raw); return; }
  switch (tag.t) {
    case T.byte: o.u8(tag.v); return;
    case T.short: o.i16(tag.v); return;
    case T.int: o.i32(tag.v); return;
    case T.long: o.i64(tag.v); return;
    case T.float:
    case T.double: o.push(Buffer.from(tag.v, 'hex')); return;
    case T.string: { const s = mutf8(tag.v); o.u16(s.length); o.push(s); return; }
    case T.byteArray:
      o.i32(tag.declared ?? tag.v.length);
      o.push(Buffer.from(Uint8Array.from(tag.v, (x) => x & 0xff)));
      return;
    case T.intArray: o.i32(tag.declared ?? tag.v.length); for (const x of tag.v) o.i32(x); return;
    case T.longArray: o.i32(tag.declared ?? tag.v.length); for (const x of tag.v) o.i64(x); return;
    case T.list:
      o.u8(tag.et);
      o.i32(tag.declared ?? tag.items.length);
      for (const it of tag.items) writePayload(o, it);
      return;
    case T.compound:
      for (const [k, v] of tag.entries) writeNamed(o, k, v);
      o.u8(T.end);
      return;
    default: throw new Error('样例编码器不认识类型 ' + tag.t);
  }
}

function writeNamed(o, name, tag) {
  o.u8(tag.t);
  const n = mutf8(name);
  o.u16(n.length);
  o.push(n);
  writePayload(o, tag);
}

export function rawNbt(rootTag, name = '') {
  const o = new Out();
  writeNamed(o, name, rootTag);
  return o.bytes();
}

// typed JSON（FORMAT.md 第 4 节）→ 原始标签（只给 odd 用的简单 meta：列表要同一类型）
export function fromTyped(j) {
  const k = Object.keys(j)[0];
  const v = j[k];
  switch (k) {
    case 'byte': return R.byte(v);
    case 'short': return R.short(v);
    case 'int': return R.int(v);
    case 'long': return R.long(v);
    case 'float': return R.float(v);
    case 'double': return R.double(v);
    case 'string': return R.string(v);
    case 'byteArray': return R.byteArray(v);
    case 'intArray': return R.intArray(v);
    case 'longArray': return R.longArray(v);
    case 'compound': return R.compound(Object.keys(v).map((key) => [key, fromTyped(v[key])]));
    case 'list': {
      if (v.length === 0) return R.list(T.end, []);
      const items = v.map(fromTyped);
      if (!items.every((x) => x.t === items[0].t)) throw new Error('样例编码器只写同一类型的列表');
      return R.list(items[0].t, items);
    }
    default: throw new Error('不认识的 typed JSON：' + k);
  }
}

// ---------- gzip / zlib：全部用「不压缩」块，结果不依赖 zlib 版本 ----------

export const GZ_HEAD = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff]);

export function storedDeflate(raw) {
  const n = raw.length;
  const blocks = Math.max(1, Math.ceil(n / 65535));
  const parts = [];
  for (let i = 0; i < blocks; i++) {
    const s = i * 65535;
    const len = Math.min(65535, n - s);
    const h = Buffer.alloc(5);
    h[0] = i === blocks - 1 ? 1 : 0;
    h.writeUInt16LE(len, 1);
    h.writeUInt16LE(~len & 0xffff, 3);
    parts.push(h, raw.subarray(s, s + len));
  }
  return Buffer.concat(parts);
}

export function gzipStored(raw) {
  const tail = Buffer.alloc(8);
  tail.writeUInt32LE(zlib.crc32(raw) >>> 0, 0);
  tail.writeUInt32LE(raw.length >>> 0, 4);
  return Buffer.concat([GZ_HEAD, storedDeflate(raw), tail]);
}

export function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function zlibStored(raw) {
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(adler32(raw));
  return Buffer.concat([Buffer.from([0x78, 0x01]), storedDeflate(raw), tail]);
}

// ---------- gzip 炸弹：文件约 64 KB，解压出 67,633,153 个 0 字节（> 64 MiB） ----------
// 一个动态 Huffman 块：字面量 0，再重复 262,144 次「长度 258、距离 1」，最后块结束。
// 码表：字面量/长度 0 → 10、256 → 11、285 → 0；距离 0 → 0、1 → 1；码长码 1 → 10、2 → 11、18 → 0。
class Bits {
  constructor() { this.buf = []; this.acc = 0; this.n = 0; }
  put(value, count) {               // 头部字段和额外位：低位先写
    for (let i = 0; i < count; i++) {
      this.acc |= ((value >> i) & 1) << this.n;
      if (++this.n === 8) { this.buf.push(this.acc); this.acc = 0; this.n = 0; }
    }
  }
  code(bits) {                      // Huffman 码：高位先写
    for (const ch of bits) this.put(ch === '1' ? 1 : 0, 1);
  }
  bytes() {
    const out = this.buf.slice();
    if (this.n) out.push(this.acc);
    return Buffer.from(out);
  }
}

export const BOMB_SIZE = 1 + 258 * 262144;   // 67,633,153

export function gzipBomb() {
  const w = new Bits();
  w.put(1, 1);           // BFINAL
  w.put(2, 2);           // BTYPE = 动态 Huffman
  w.put(286 - 257, 5);   // HLIT
  w.put(2 - 1, 5);       // HDIST
  w.put(18 - 4, 4);      // HCLEN
  // 码长码的码长，顺序 16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1：18 → 1 位，2 和 1 → 2 位
  for (const len of [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2]) w.put(len, 3);
  const CL = { 1: '10', 2: '11', 18: '0' };
  // 字面量/长度表 286 项：0 → 2 位，1..255 → 0，256 → 2 位，257..284 → 0，285 → 1 位；距离表 2 项都是 1 位
  w.code(CL[2]);
  w.code(CL[18]); w.put(138 - 11, 7);
  w.code(CL[18]); w.put(117 - 11, 7);
  w.code(CL[2]);
  w.code(CL[18]); w.put(28 - 11, 7);
  w.code(CL[1]);
  w.code(CL[1]); w.code(CL[1]);
  w.code('10');                                                    // 字面量 0
  for (let i = 0; i < 262144; i++) { w.code('0'); w.code('0'); }  // 长度 258（码 285），距离 1（码 0）
  w.code('11');                                                    // 块结束
  let crc = 0;
  const zeros = Buffer.alloc(1 << 20);
  for (let left = BOMB_SIZE; left > 0; left -= zeros.length) {
    crc = zlib.crc32(zeros.subarray(0, Math.min(left, zeros.length)), crc);
  }
  const tail = Buffer.alloc(8);
  tail.writeUInt32LE(crc >>> 0, 0);
  tail.writeUInt32LE(BOMB_SIZE >>> 0, 4);
  return Buffer.concat([GZ_HEAD, w.bytes(), tail]);
}

// 固定 Huffman 的字面量码（RFC 1951 3.2.6），高位先写
function fixedLiteral(w, v) {
  if (v < 144) w.code((0x30 + v).toString(2).padStart(8, '0'));
  else w.code((0x190 + v - 144).toString(2).padStart(9, '0'));
}

// gzip：prefix + zeros 个 0 + suffix，压缩后很小，而且不依赖 zlib（字节固定）。
// 三个 deflate 块：① 固定 Huffman，写 prefix 和第一个 0；② 动态 Huffman，和 gzipBomb 同一张表，
// 每次「长度 258、距离 1」复制 258 个 0；③ 固定 Huffman（最后一块），剩下不到 258 个 0 和 suffix 逐个写。
export function gzipZeroRun(prefix, zeros, suffix = Buffer.alloc(0)) {
  const w = new Bits();
  const k = zeros > 0 ? Math.floor((zeros - 1) / 258) : 0;
  const rest = zeros > 0 ? zeros - 1 - 258 * k : 0;
  w.put(0, 1); w.put(1, 2);                        // ① BFINAL 0，BTYPE 1（固定）
  for (const v of prefix) fixedLiteral(w, v);
  if (zeros > 0) fixedLiteral(w, 0);
  w.code('0000000');                               // 块结束（256）
  if (k > 0) {
    w.put(0, 1); w.put(2, 2);                      // ② BFINAL 0，BTYPE 2（动态）
    w.put(286 - 257, 5); w.put(2 - 1, 5); w.put(18 - 4, 4);
    for (const len of [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2]) w.put(len, 3);
    w.code('11'); w.code('0'); w.put(138 - 11, 7); w.code('0'); w.put(117 - 11, 7);
    w.code('11'); w.code('0'); w.put(28 - 11, 7); w.code('10'); w.code('10'); w.code('10');
    for (let i = 0; i < k; i++) { w.code('0'); w.code('0'); }
    w.code('11');                                  // 块结束
  }
  w.put(1, 1); w.put(1, 2);                        // ③ BFINAL 1，BTYPE 1（固定）
  for (let i = 0; i < rest; i++) fixedLiteral(w, 0);
  for (const v of suffix) fixedLiteral(w, v);
  w.code('0000000');
  let crc = zlib.crc32(prefix);
  const chunk = Buffer.alloc(1 << 20);
  for (let left = zeros; left > 0; left -= chunk.length) crc = zlib.crc32(chunk.subarray(0, Math.min(left, chunk.length)), crc);
  crc = zlib.crc32(suffix, crc);
  const tail = Buffer.alloc(8);
  tail.writeUInt32LE(crc >>> 0, 0);
  tail.writeUInt32LE((prefix.length + zeros + suffix.length) >>> 0, 4);
  return Buffer.concat([GZ_HEAD, w.bytes(), tail]);
}

// ---------- PNG ----------

export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// opts.length = 故意写错的长度；opts.crcXor = 故意弄坏 CRC
export function pngChunk(type, data, opts = {}) {
  const d = Buffer.from(data || []);
  const head = Buffer.alloc(8);
  head.writeUInt32BE((opts.length ?? d.length) >>> 0, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((zlib.crc32(Buffer.concat([head.subarray(4), d])) ^ (opts.crcXor || 0)) >>> 0);
  return Buffer.concat([head, d, crc]);
}

export function solidChunks(w, h, rgb) {
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;   // 每通道 8 位
  ih[9] = 2;   // RGB
  const row = 1 + w * 3;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw.set(rgb, y * row + 1 + x * 3);
  }
  return { IHDR: pngChunk('IHDR', ih), IDAT: pngChunk('IDAT', zlibStored(raw)) };
}

// ---------- dump 的排版：短的写一行，长的展开；短元素一行放几个；LF 换行，末尾有换行 ----------

const WIDTH = 100;

function fmt(v, indent) {
  const flat = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || indent.length + flat.length <= WIDTH) return flat;
  const pad = indent + '  ';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const items = v.map((x) => fmt(x, pad));
    if (items.every((s) => !s.includes('\n') && s.length <= 24)) {
      const lines = [];
      let cur = '';
      for (const s of items) {
        const next = cur ? cur + ', ' + s : s;
        if (cur && pad.length + next.length + 1 > WIDTH) { lines.push(cur); cur = s; } else cur = next;
      }
      if (cur) lines.push(cur);
      return '[\n' + lines.map((l) => pad + l).join(',\n') + '\n' + indent + ']';
    }
    return '[\n' + items.map((s) => pad + s).join(',\n') + '\n' + indent + ']';
  }
  const keys = Object.keys(v);
  if (keys.length === 0) return '{}';
  return '{\n' + keys.map((k) => pad + JSON.stringify(k) + ': ' + fmt(v[k], pad)).join(',\n') + '\n' + indent + '}';
}

export function formatJSON(v) {
  return fmt(v, '') + '\n';
}
