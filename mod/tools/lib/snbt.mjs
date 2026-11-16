// SNBT 读取器（附带一个打印器）。
//
// 探针 /block、/region 给的方块实体是 MC 26.1 的 Tag.toString()，也就是 StringTagVisitor 的输出。
// 这里把它读成 docs/FORMAT.md §4 dump 里那种带类型的 JSON，好和鲸图里的数据逐项比：
//   {"byte":-1} {"short":300} {"int":7} {"long":"-9223372036854775808"}
//   {"float":"3fc00000"} {"double":"3ff8000000000000"}（IEEE 754 的位，小写十六进制）
//   {"string":"…"} {"byteArray":[…]} {"intArray":[…]} {"longArray":["1","-2"]}
//   {"list":[…]} {"compound":{…}}
// 只认 StringTagVisitor 写得出来的写法：没有空格；字符串一定带引号；数字是 Java 的写法加后缀
// （1b 2s 3 4L 1.5f 2.0d，数组 [B;1B] [I;1] [L;1L]）。别的写法（空格、true/false、没引号的字符串、
// \u 转义……）直接报错，不去猜。
// 列表里「只有一个空键」的 compound 不拆开：探针打印的是内存里的值，二进制读进来时已经拆过了。

const MAX_DEPTH = 512;
const KEY_RE = /^[A-Za-z._][A-Za-z0-9._+-]*$/;
const INT_RE = /^(0|-?[1-9][0-9]*)$/;
const DEC_RE = /^-?([0-9]+)\.([0-9]+)(?:E(-?[0-9]+))?$/;
const RANGE = {
  byte: [-128n, 127n], short: [-32768n, 32767n],
  int: [-2147483648n, 2147483647n], long: [-(2n ** 63n), 2n ** 63n - 1n],
};
const ESC_IN = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '\\': '\\', '"': '"', "'": "'" };
const ESC_OUT = { 8: 'b', 9: 't', 10: 'n', 12: 'f', 13: 'r' };
const FLOATS = {
  float: { bits: 24, minExp: -149, bias: 150, maxBiased: 254, hexLen: 8, nan: '7fc00000' },
  double: { bits: 53, minExp: -1074, bias: 1075, maxBiased: 2046, hexLen: 16, nan: '7ff8000000000000' },
};

export const TAG_TYPES = ['byte', 'short', 'int', 'long', 'float', 'double', 'string',
  'byteArray', 'intArray', 'longArray', 'list', 'compound'];

export class SnbtError extends Error {
  constructor(reason, pos, text) {
    const near = typeof text === 'string'
      ? `（附近：${JSON.stringify(text.slice(Math.max(0, pos - 15), pos + 15))}）` : '';
    super(`SNBT 第 ${pos + 1} 个字符：${reason}${near}`);
    this.name = 'SnbtError';
    this.reason = reason;
    this.pos = pos;
  }
}

function intIn(text, type) {
  if (!INT_RE.test(text)) return null;
  const v = BigInt(text);
  const [lo, hi] = RANGE[type];
  return v < lo || v > hi ? null : v;
}

const bitlen = (n) => n.toString(2).length; // n > 0
const atLeast = (num, den, k) => (k >= 0 ? num >= den << BigInt(k) : num << BigInt(-k) >= den);

// num/den（> 0）按「就近，一样近取偶数」舍入成 q·2^e：q < 2^bits，e >= minExp。全程精确，不经过 double。
export function roundBinary(num, den, bits, minExp) {
  let p = bitlen(num) - bitlen(den);
  if (!atLeast(num, den, p)) p -= 1; // 2^p <= num/den < 2^(p+1)
  let e = Math.max(p - (bits - 1), minExp);
  let n = num;
  let d = den;
  if (e >= 0) d <<= BigInt(e); else n <<= BigInt(-e);
  let q = n / d;
  const r2 = (n - q * d) * 2n;
  if (r2 > d || (r2 === d && (q & 1n) === 1n)) q += 1n;
  if (q === 1n << BigInt(bits)) { q >>= 1n; e += 1; }
  return { q, e };
}

// Java 的 Float.toString / Double.toString 写法（不带 f/d 后缀）→ IEEE 位的十六进制；不认识 → null。
// NaN 一律给标准 NaN（Java 打印时已经分不出别的 NaN 了）。
export function decimalToBits(text, kind) {
  const K = FLOATS[kind];
  const neg = text.startsWith('-');
  const width = BigInt(K.hexLen * 4);
  const sign = neg ? 1n << (width - 1n) : 0n;
  const hex = (v) => v.toString(16).padStart(K.hexLen, '0');
  if (text === 'NaN') return K.nan;
  if ((neg ? text.slice(1) : text) === 'Infinity') {
    return hex(sign | (BigInt(K.maxBiased + 1) << BigInt(K.bits - 1)));
  }
  const m = DEC_RE.exec(text);
  if (!m) return null;
  const digits = BigInt(m[1] + m[2]);
  if (digits === 0n) return hex(sign);
  const exp10 = (m[3] ? Number(m[3]) : 0) - m[2].length;
  if (Math.abs(exp10) > 800) return null;
  const num = exp10 >= 0 ? digits * 10n ** BigInt(exp10) : digits;
  const den = exp10 >= 0 ? 1n : 10n ** BigInt(-exp10);
  const { q, e } = roundBinary(num, den, K.bits, K.minExp);
  const hidden = 1n << BigInt(K.bits - 1);
  if (q < hidden) return hex(sign | q); // 非规格化数
  const biased = e + K.bias;
  if (biased > K.maxBiased) return null; // 超出范围，Java 不会这样写
  return hex(sign | (BigInt(biased) << BigInt(K.bits - 1)) | (q - hidden));
}

// JS 的数字写法（1e+21、1.5e-7、0.001）→ Java 的写法（1.0E21、1.5E-7、0.001、1.0）
export function javaDecimal(js) {
  const neg = js.startsWith('-');
  const s = neg ? js.slice(1) : js;
  const [mant, e = '0'] = s.split('e');
  const [ip, fp = ''] = mant.split('.');
  let D = ip + fp;
  let X = ip.length + Number(e); // 值 = 0.D × 10^X
  const lead = D.length - D.replace(/^0+/, '').length;
  D = D.slice(lead).replace(/0+$/, '');
  X -= lead;
  let out;
  if (!D) out = '0.0';
  else if (X >= -2 && X <= 7) {
    if (X <= 0) out = '0.' + '0'.repeat(-X) + D;
    else if (X >= D.length) out = D + '0'.repeat(X - D.length) + '.0';
    else out = D.slice(0, X) + '.' + D.slice(X);
  } else out = D[0] + '.' + (D.slice(1) || '0') + 'E' + (X - 1);
  return (neg ? '-' : '') + out;
}

const view = new DataView(new ArrayBuffer(8));
// Java（JDK 19 起）取能读回同一个值的最短写法；最短只有 1 位时改用 2 位里最接近的（1.4E-45 而不是 1.0E-45）
function floatText(hex) {
  view.setUint32(0, Number.parseInt(hex, 16));
  const v = view.getFloat32(0);
  if (Number.isNaN(v) || !Number.isFinite(v)) return String(v);
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
  for (let p = 1; p < 9; p++) {
    const t = javaDecimal(v.toPrecision(p));
    if (decimalToBits(t, 'float') === hex) return p === 1 ? javaDecimal(v.toPrecision(2)) : t;
  }
  return javaDecimal(v.toPrecision(9));
}
function doubleText(hex) {
  view.setBigUint64(0, BigInt('0x' + hex));
  const v = view.getFloat64(0);
  if (Number.isNaN(v) || !Number.isFinite(v)) return String(v);
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
  const s = String(v);
  const one = s.replace(/^-|e.*$/g, '').replace('.', '').replace(/^0+|0+$/g, '').length === 1;
  return javaDecimal(one ? v.toPrecision(2) : s);
}

export function tagType(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  return keys.length === 1 && TAG_TYPES.includes(keys[0]) ? keys[0] : null;
}

// 和 StringTag.quoteAndEscape 一样：先出现 " 就用 ' 包，否则用 "；只转义 \ 和用来包的那种引号
function quoteString(s) {
  let q = '"';
  for (const ch of s) {
    if (ch === '"') { q = "'"; break; }
    if (ch === "'") break;
  }
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\\' || ch === q) out += '\\' + ch;
    else if (c < 0x20) out += '\\' + (ESC_OUT[c] ?? 'x' + c.toString(16).toUpperCase().padStart(2, '0'));
    else out += ch;
  }
  return out + q;
}
const keyText = (k) => (KEY_RE.test(k) && !/^(true|false)$/i.test(k) ? k : quoteString(k));

// 带类型的 JSON → SNBT，写法和 StringTagVisitor 一样（mock 探针和测试用）
export function toSnbt(v) {
  const t = tagType(v);
  if (!t) throw new TypeError('不是带类型的 NBT 值：' + JSON.stringify(v));
  const x = v[t];
  switch (t) {
    case 'byte': return x + 'b';
    case 'short': return x + 's';
    case 'int': return String(x);
    case 'long': return x + 'L';
    case 'float': return floatText(x) + 'f';
    case 'double': return doubleText(x) + 'd';
    case 'string': return quoteString(x);
    case 'byteArray': return '[B;' + x.map((n) => n + 'B').join(',') + ']';
    case 'intArray': return '[I;' + x.join(',') + ']';
    case 'longArray': return '[L;' + x.map((n) => n + 'L').join(',') + ']';
    case 'list': return '[' + x.map(toSnbt).join(',') + ']';
    default: {
      const keys = Object.keys(x).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return '{' + keys.map((k) => keyText(k) + ':' + toSnbt(x[k])).join(',') + '}';
    }
  }
}

const TOKEN = /[A-Za-z0-9.+-]+/y;
const KEY_TOKEN = /[A-Za-z0-9._+-]+/y;
const ARRAYS = { B: ['byteArray', 'byte', 'B'], I: ['intArray', 'int', ''], L: ['longArray', 'long', 'L'] };

function intTag(type, body) {
  const v = intIn(body, type);
  return v === null ? null : { [type]: type === 'long' ? v.toString() : Number(v) };
}
function floatTag(kind, body) {
  const h = decimalToBits(body, kind);
  return h === null ? null : { [kind]: h };
}

class Parser {
  constructor(text) { this.s = text; this.i = 0; }
  fail(reason, at = this.i) { throw new SnbtError(reason, at, this.s); }
  value(depth) {
    if (depth > MAX_DEPTH) this.fail(`嵌套超过 ${MAX_DEPTH} 层`);
    const c = this.s[this.i];
    if (c === '{') return this.compound(depth);
    if (c === '[') return this.listOrArray(depth);
    if (c === '"' || c === "'") return { string: this.string() };
    return this.number();
  }
  compound(depth) {
    const obj = {};
    this.i++;
    if (this.s[this.i] === '}') { this.i++; return { compound: obj }; }
    for (;;) {
      const at = this.i;
      const key = this.key();
      if (Object.hasOwn(obj, key)) this.fail(`键「${key}」重复了`, at);
      if (this.s[this.i] !== ':') this.fail('键后面要跟 :');
      this.i++;
      // defineProperty：键叫 __proto__ 也是普通的键
      Object.defineProperty(obj, key, { value: this.value(depth + 1), enumerable: true, writable: true, configurable: true });
      const c = this.s[this.i++];
      if (c === '}') return { compound: obj };
      if (c !== ',') this.fail('这里要是 , 或 }', this.i - 1);
    }
  }
  key() {
    const c = this.s[this.i];
    if (c === '"' || c === "'") return this.string();
    KEY_TOKEN.lastIndex = this.i;
    const m = KEY_TOKEN.exec(this.s);
    if (!m || !KEY_RE.test(m[0])) this.fail('键要么是字母、. 或 _ 开头的一串字符，要么带引号');
    this.i += m[0].length;
    return m[0];
  }
  listOrArray(depth) {
    const head = this.s.slice(this.i, this.i + 3);
    if (/^\[[BIL];$/.test(head)) return this.array(ARRAYS[head[1]], head);
    this.i++;
    const items = [];
    if (this.s[this.i] === ']') { this.i++; return { list: items }; }
    for (;;) {
      items.push(this.value(depth + 1));
      const c = this.s[this.i++];
      if (c === ']') return { list: items };
      if (c !== ',') this.fail('这里要是 , 或 ]', this.i - 1);
    }
  }
  array([name, type, suffix], head) {
    this.i += 3;
    const out = [];
    if (this.s[this.i] === ']') { this.i++; return { [name]: out }; }
    for (;;) {
      const at = this.i;
      const tok = this.token();
      const body = !suffix ? tok : tok.endsWith(suffix) ? tok.slice(0, -1) : null;
      const v = body === null ? null : intIn(body, type);
      if (v === null) this.fail(`${head} 数组里的「${tok}」不对（元素要写成 1${suffix} 这样）`, at);
      out.push(type === 'long' ? v.toString() : Number(v));
      const c = this.s[this.i++];
      if (c === ']') return { [name]: out };
      if (c !== ',') this.fail('这里要是 , 或 ]', this.i - 1);
    }
  }
  token() {
    TOKEN.lastIndex = this.i;
    const m = TOKEN.exec(this.s);
    if (!m) this.fail(this.i >= this.s.length ? '没写完就结束了' : `看不懂这里的「${this.s[this.i]}」`);
    this.i += m[0].length;
    return m[0];
  }
  number() {
    const at = this.i;
    const tok = this.token();
    const last = tok[tok.length - 1];
    const body = tok.slice(0, -1);
    const r = last === 'b' ? intTag('byte', body) : last === 's' ? intTag('short', body)
      : last === 'L' ? intTag('long', body) : last === 'f' ? floatTag('float', body)
        : last === 'd' ? floatTag('double', body) : intTag('int', tok);
    if (!r) this.fail(`看不懂「${tok}」（数字按 Java 的写法加后缀：1b 2s 3 4L 1.5f 2.0d；字符串要带引号）`, at);
    return r;
  }
  string() {
    const q = this.s[this.i];
    const start = this.i++;
    let out = '';
    for (;;) {
      if (this.i >= this.s.length) this.fail('字符串没有结束的引号', start);
      const c = this.s[this.i++];
      if (c === q) return out;
      if (c === '\\') {
        const e = this.s[this.i++];
        if (e === 'x') {
          const h = this.s.slice(this.i, this.i + 2);
          if (!/^[0-9A-Fa-f]{2}$/.test(h)) this.fail('\\x 后面要跟两位十六进制', this.i - 2);
          out += String.fromCharCode(Number.parseInt(h, 16));
          this.i += 2;
        } else if (e !== undefined && Object.hasOwn(ESC_IN, e)) out += ESC_IN[e];
        else this.fail(`不认识的转义「\\${e ?? ''}」`, this.i - 2);
      } else if (c.charCodeAt(0) < 0x20) this.fail('字符串里有没转义的控制字符', this.i - 1);
      else out += c;
    }
  }
}

// 读一整段 SNBT（任何类型），读完后面不能还有字符
export function parseSnbt(text) {
  if (typeof text !== 'string') throw new SnbtError('不是字符串', 0);
  if (text.length === 0) throw new SnbtError('是空的', 0, text);
  const p = new Parser(text);
  const v = p.value(0);
  if (p.i !== text.length) p.fail('后面还有多余的字符');
  return v;
}

// 方块实体用：最外层必须是 {…}
export function parseCompound(text) {
  const v = parseSnbt(text);
  if (tagType(v) !== 'compound') throw new SnbtError('最外层要是 {…}', 0, text);
  return v;
}

const brief = (v) => {
  const s = JSON.stringify(v);
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
};

// 比两个带类型的值（键的顺序不管，列表和数组的顺序要一样）。
// 一样 → null；不一样 → 第一处不一样的地方，例如「.Items[0].count：期望 {"int":3}，实际 {"int":2}」
export function typedDiff(want, got, at = '') {
  const tw = tagType(want);
  const tg = tagType(got);
  const where = at || '（最外层）';
  if (!tw || !tg) {
    if (JSON.stringify(want) === JSON.stringify(got)) return null;
    return `${where}：期望 ${brief(want)}，实际 ${brief(got)}`;
  }
  if (tw !== tg) return `${where}：类型不一样，期望 ${brief(want)}，实际 ${brief(got)}`;
  const a = want[tw];
  const b = got[tg];
  if (tw === 'compound') {
    for (const k of Object.keys(a)) {
      if (!Object.hasOwn(b, k)) return `${at}.${k}：实际没有这个键（期望 ${brief(a[k])}）`;
      const d = typedDiff(a[k], b[k], `${at}.${k}`);
      if (d) return d;
    }
    for (const k of Object.keys(b)) {
      if (!Object.hasOwn(a, k)) return `${at}.${k}：实际多了这个键（${brief(b[k])}）`;
    }
    return null;
  }
  if (tw === 'list') {
    if (a.length !== b.length) return `${where}：列表长度不一样，期望 ${a.length}，实际 ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = typedDiff(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (Array.isArray(a)) {
    const same = Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
    return same ? null : `${where}：数组不一样，期望 ${brief(a)}，实际 ${brief(b)}`;
  }
  return a === b ? null : `${where}：期望 ${brief(want)}，实际 ${brief(got)}`;
}
