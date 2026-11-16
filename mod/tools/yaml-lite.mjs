// yaml-lite.mjs：卡片用的 YAML 子集解析器（只用 Node 自带的东西，不装包）。
//
// 支持：映射（键: 值）、列表（- 开头）、空格缩进的嵌套、行内列表 [1, -60, 3]、行内映射 {a: 1}、
//       单引号 / 双引号字符串、整数和小数、true/false、null/~、# 注释。
// 不支持（遇到就报错，带行号）：tab 缩进、锚点 &、别名 *、标签 !、多行字符串（| > 和折行）、
//       多文档 ---、? 复杂键、跨行的 [ ] { }。
// 规则细节写在 docs/PROBE.md「卡片格式」。这不是通用 YAML，够卡片用就行。

export class YamlError extends Error {
  constructor(reason, { line, col, filename } = {}) {
    const where = filename ? `${filename}:${line ?? '?'}` : `第 ${line ?? '?'} 行`;
    super(`${where}: ${reason}`);
    this.name = 'YamlError';
    this.reason = reason;
    this.line = line;
    this.col = col;
    this.filename = filename;
  }
}

/** 解析，只要值。 */
export function parseYaml(text, opts = {}) {
  return parseYamlDocument(text, opts).value;
}

/**
 * 解析，同时给出行号查询：
 *   lineOf(对象或数组) → 它开始的行
 *   itemLine(数组, i) → 第 i 项所在的行
 *   keyLine(对象, 键) → 这个键所在的行
 */
export function parseYamlDocument(text, { filename } = {}) {
  const p = new Parser(text, filename);
  const value = p.parseDocument();
  return {
    value,
    lineOf: (node) => (node !== null && typeof node === 'object' ? p.lineOf.get(node) : undefined),
    itemLine: (arr, i) => p.itemLines.get(arr)?.[i] ?? p.lineOf.get(arr),
    keyLine: (obj, key) => p.keyLines.get(obj)?.get(key) ?? p.lineOf.get(obj),
  };
}

const INDICATORS = {
  '&': '不支持锚点（&）',
  '*': '不支持别名（*）',
  '!': '不支持标签（!）',
  '|': '不支持多行字符串（|）',
  '>': '不支持多行字符串（>）',
  '%': '不支持 % 开头的值，请加引号',
  '@': '@ 开头的值请加引号',
  '`': '` 开头的值请加引号',
  '?': '不支持 ? 开头的写法；要字符串就加引号',
};

const isSeqEntry = (content) => content === '-' || content.startsWith('- ') || content.startsWith('-\t');
const isBlank = (ch) => ch === ' ' || ch === '\t';

function defineKey(obj, key, value) {
  // 用 defineProperty，避免 "__proto__" 这种键改掉原型
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

class Parser {
  constructor(text, filename) {
    if (typeof text !== 'string') throw new TypeError('parseYaml 需要字符串');
    this.filename = filename;
    this.lineOf = new WeakMap();
    this.itemLines = new WeakMap();
    this.keyLines = new WeakMap();
    this.lines = this.tokenize(text);
    this.i = 0;
  }

  err(reason, line, col) {
    return new YamlError(reason, { line, col, filename: this.filename });
  }

  cur() {
    return this.lines[this.i];
  }

  // 拆行：去掉空行和整行注释，记下每行的缩进（只认空格）。
  tokenize(text) {
    const raw = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    const out = [];
    raw.forEach((s, idx) => {
      const no = idx + 1;
      if (/^[ \t]*$/.test(s) || /^[ \t]*#/.test(s)) return;
      let ind = 0;
      while (s[ind] === ' ') ind++;
      if (s[ind] === '\t') throw this.err('缩进不能用 tab，请换成空格', no, ind + 1);
      const rest = s.slice(ind);
      if (/^(---|\.\.\.)([ \t]|$)/.test(rest)) throw this.err('不支持 --- / ...（一张卡就是一个文件，不用写）', no, ind + 1);
      out.push({ no, indent: ind, text: s });
    });
    return out;
  }

  parseDocument() {
    if (this.lines.length === 0) return null;
    const first = this.lines[0];
    if (first.indent !== 0) throw this.err('第一行不能缩进', first.no, first.indent + 1);
    const value = this.parseBlock(0);
    if (this.i < this.lines.length) {
      const l = this.cur();
      throw this.err('这一行和上面接不上（检查缩进，或者是不是列表和「键: 值」混在了同一层）', l.no, l.indent + 1);
    }
    return value;
  }

  // 从当前行开始解析一个块，块的缩进是 indent（当前行的 indent 必须等于它）。
  parseBlock(indent) {
    const l = this.cur();
    const content = l.text.slice(l.indent);
    if (isSeqEntry(content)) return this.parseSeq(indent);
    if (this.tryKey(l)) return this.parseMap(indent);
    const value = this.parseValue(l, l.indent);
    this.i++;
    return value;
  }

  parseSeq(indent) {
    const arr = [];
    const lines = [];
    this.lineOf.set(arr, this.cur().no);
    this.itemLines.set(arr, lines);
    while (this.i < this.lines.length) {
      const l = this.cur();
      if (l.indent < indent) break;
      if (l.indent > indent) throw this.err('缩进不对：比上面的列表项多缩进了（不支持多行字符串）', l.no, l.indent + 1);
      if (!isSeqEntry(l.text.slice(l.indent))) break;
      lines.push(l.no);
      let c = l.indent + 1;
      while (l.text[c] === ' ') c++;
      if (l.text[c] === '\t') throw this.err('「-」后面不能用 tab，请用空格', l.no, c + 1);
      const rest = l.text.slice(c);
      if (rest === '' || rest.startsWith('#')) {
        // 「-」单独一行：值在下面更深的缩进里
        this.i++;
        const nxt = this.cur();
        arr.push(nxt && nxt.indent > indent ? this.parseBlock(nxt.indent) : null);
      } else {
        // 「- 键: 值」：把这一行当成从「-」后面那一列开始的行，后面的键要和它对齐
        l.indent = c;
        arr.push(this.parseBlock(c));
      }
    }
    return arr;
  }

  parseMap(indent) {
    const obj = {};
    const keyLines = new Map();
    this.lineOf.set(obj, this.cur().no);
    this.keyLines.set(obj, keyLines);
    while (this.i < this.lines.length) {
      const l = this.cur();
      if (l.indent < indent) break;
      if (l.indent > indent) {
        throw this.err('缩进不对：这一行比同一层的键缩进多，但这里不能开始嵌套（上一个键已经有值了？同一层混用了列表和「键: 值」？不支持多行字符串）', l.no, l.indent + 1);
      }
      const content = l.text.slice(l.indent);
      if (isSeqEntry(content)) throw this.err('这里应该是「键: 值」，却出现了列表项「- 」（检查缩进）', l.no, l.indent + 1);
      const k = this.tryKey(l);
      if (!k) throw this.err('这一行不是「键: 值」（冒号后面要有空格）', l.no, l.indent + 1);
      if (Object.hasOwn(obj, k.key)) throw this.err(`键「${k.key}」重复了`, l.no, l.indent + 1);
      keyLines.set(k.key, l.no);
      let c = k.valueCol;
      while (isBlank(l.text[c])) c++;
      const rest = l.text.slice(c);
      let value;
      if (rest === '' || rest.startsWith('#')) {
        this.i++;
        const nxt = this.cur();
        if (nxt && nxt.indent > indent) value = this.parseBlock(nxt.indent);
        else if (nxt && nxt.indent === indent && isSeqEntry(nxt.text.slice(nxt.indent))) value = this.parseSeq(indent);
        else value = null;
      } else {
        value = this.parseValue(l, c);
        this.i++;
      }
      defineKey(obj, k.key, value);
    }
    return obj;
  }

  // 这一行是不是「键: 值」？是就返回 { key, valueCol }（valueCol 是冒号后面那一列）。
  tryKey(l) {
    const s = l.text;
    const start = l.indent;
    const ch = s[start];
    if (ch === '"' || ch === "'") {
      const q = readQuoted(s, start, (m, col) => this.err(m, l.no, col + 1));
      let c = q.end;
      while (isBlank(s[c])) c++;
      if (s[c] === ':' && (c + 1 >= s.length || isBlank(s[c + 1]))) return { key: q.value, valueCol: c + 1 };
      return null; // 只是一个带引号的值
    }
    if (ch === '[' || ch === '{') return null; // 行内列表/映射当值；不支持拿它们当键
    for (let c = start; c < s.length; c++) {
      if (s[c] === '#' && c > start && isBlank(s[c - 1])) return null; // 后面是注释
      if (s[c] === ':' && (c + 1 >= s.length || isBlank(s[c + 1]))) {
        const key = s.slice(start, c).trimEnd();
        if (key === '') throw this.err('键不能是空的', l.no, start + 1);
        if (INDICATORS[key[0]] && key[0] !== '@') throw this.err(INDICATORS[key[0]], l.no, start + 1);
        return { key, valueCol: c + 1 };
      }
    }
    return null;
  }

  // 解析写在一行里的值（从 col 列开始）：行内列表/映射、带引号的字符串，或普通值。
  parseValue(l, col) {
    const s = l.text;
    const ch = s[col];
    const errAt = (m, c) => this.err(m, l.no, c + 1);
    if (ch === '[' || ch === '{') {
      const r = this.parseFlow(l, col);
      this.expectLineEnd(l, r.end, '行内列表/映射');
      return r.value;
    }
    if (ch === '"' || ch === "'") {
      const q = readQuoted(s, col, errAt);
      this.expectLineEnd(l, q.end, '引号');
      return q.value;
    }
    if (INDICATORS[ch]) throw errAt(INDICATORS[ch], col);
    if (isSeqEntry(s.slice(col))) throw errAt('值不能用「- 」开头（列表要另起一行写；要字符串就加引号）', col);
    // 普通值：到行尾或注释（空白后面的 #）为止
    let end = s.length;
    for (let c = col; c < s.length; c++) {
      if (s[c] === '#' && isBlank(s[c - 1])) {
        end = c;
        break;
      }
    }
    const text = s.slice(col, end).trim();
    const colon = text.search(/:([ \t]|$)/);
    if (colon !== -1) throw errAt('值里面有「: 」或者以「:」结尾，请给整个值加引号', col + colon);
    return resolvePlain(text, errAt, col);
  }

  expectLineEnd(l, pos, what) {
    const s = l.text;
    let c = pos;
    while (isBlank(s[c])) c++;
    if (c >= s.length) return;
    if (s[c] === '#' && c > pos) return;
    throw this.err(`${what}后面多了东西：「${s.slice(c)}」`, l.no, c + 1);
  }

  // 行内列表 [ ] 和行内映射 { }，必须写在一行里。返回 { value, end }。
  parseFlow(l, col) {
    const s = l.text;
    let p = col;
    const err = (m, c = p) => this.err(m, l.no, c + 1);
    const ws = () => {
      while (isBlank(s[p])) p++;
    };
    const isMapColon = (c) => s[c] === ':' && (c + 1 >= s.length || /[ \t,\]}]/.test(s[c + 1]));

    const value = () => {
      ws();
      const ch = s[p];
      if (p >= s.length || (ch === '#' && isBlank(s[p - 1]))) throw err('[ ] 或 { } 没有写完（不支持跨行）');
      if (ch === '[') return seq();
      if (ch === '{') return map();
      if (ch === '"' || ch === "'") {
        const q = readQuoted(s, p, err);
        p = q.end;
        return q.value;
      }
      if (ch === ',' || ch === ']' || ch === '}') throw err('这里缺一个值');
      if (INDICATORS[ch]) throw err(INDICATORS[ch]);
      const start = p;
      while (p < s.length) {
        const c = s[p];
        if (c === ',' || c === ']' || c === '}' || c === '[' || c === '{') break;
        if (isMapColon(p)) break;
        if (c === '#' && isBlank(s[p - 1])) break;
        p++;
      }
      const text = s.slice(start, p).trim();
      if (s[p] === '[' || s[p] === '{') {
        throw err(`「${text}${s[p]}…」写在 [ ] 或 { } 里面时要加引号（里面的 [ ] { } , 会被当成结构），比如 "minecraft:oak_log[axis=x]"`);
      }
      return resolvePlain(text, err, start);
    };

    const seq = () => {
      const arr = [];
      this.lineOf.set(arr, l.no);
      this.itemLines.set(arr, []);
      p++; // [
      ws();
      if (s[p] === ']') {
        p++;
        return arr;
      }
      for (;;) {
        arr.push(value());
        this.itemLines.get(arr).push(l.no);
        ws();
        if (s[p] === ',') {
          p++;
          ws();
          if (s[p] === ']') {
            p++;
            return arr;
          }
          continue;
        }
        if (s[p] === ']') {
          p++;
          return arr;
        }
        if (s[p] === ':') throw err('[ ] 里面不支持「键: 值」，请写成 {键: 值}');
        if (p >= s.length || s[p] === '#') throw err('[ ] 没有写完（不支持跨行）');
        throw err('这里应该是「,」或「]」');
      }
    };

    const map = () => {
      const obj = {};
      const keyLines = new Map();
      this.lineOf.set(obj, l.no);
      this.keyLines.set(obj, keyLines);
      p++; // {
      ws();
      if (s[p] === '}') {
        p++;
        return obj;
      }
      for (;;) {
        ws();
        const ch = s[p];
        let key;
        const keyCol = p;
        if (ch === '"' || ch === "'") {
          const q = readQuoted(s, p, err);
          key = q.value;
          p = q.end;
        } else if (ch === '[' || ch === '{') {
          throw err('不支持用 [ ] 或 { } 当键');
        } else if (p >= s.length || ch === '#') {
          throw err('{ } 没有写完（不支持跨行）');
        } else if (ch === ',' || ch === '}' || ch === ':') {
          throw err('这里缺一个键');
        } else {
          while (p < s.length && !/[,\]}[{]/.test(s[p]) && !isMapColon(p)) p++;
          key = s.slice(keyCol, p).trim();
          if (key.includes(':')) throw err('「:」后面要有空格，比如 {a: 1}', keyCol + key.indexOf(':'));
        }
        ws();
        if (s[p] !== ':') throw err(`键「${key}」后面要跟「: 值」`);
        p++;
        if (Object.hasOwn(obj, key)) throw err(`键「${key}」重复了`, keyCol);
        keyLines.set(key, l.no);
        defineKey(obj, key, value());
        ws();
        if (s[p] === ',') {
          p++;
          ws();
          if (s[p] === '}') {
            p++;
            return obj;
          }
          continue;
        }
        if (s[p] === '}') {
          p++;
          return obj;
        }
        if (p >= s.length || s[p] === '#') throw err('{ } 没有写完（不支持跨行）');
        throw err('这里应该是「,」或「}」');
      }
    };

    const v = value();
    return { value: v, end: p };
  }
}

// 读一个带引号的字符串，s[p] 是开头的引号。返回 { value, end }（end 是结尾引号后面那一列）。
function readQuoted(s, p, err) {
  const q = s[p];
  let i = p + 1;
  let out = '';
  if (q === "'") {
    for (;;) {
      if (i >= s.length) throw err('单引号字符串没有结束（不支持跨行）', p);
      if (s[i] === "'") {
        if (s[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        return { value: out, end: i + 1 };
      }
      out += s[i++];
    }
  }
  const simple = { '\\': '\\', '"': '"', '/': '/', n: '\n', t: '\t', r: '\r', 0: '\0', b: '\b', f: '\f', ' ': ' ' };
  for (;;) {
    if (i >= s.length) throw err('双引号字符串没有结束（不支持跨行）', p);
    const c = s[i];
    if (c === '"') return { value: out, end: i + 1 };
    if (c === '\\') {
      const e = s[i + 1];
      if (e !== undefined && Object.hasOwn(simple, e)) {
        out += simple[e];
        i += 2;
        continue;
      }
      if (e === 'u' || e === 'x') {
        const n = e === 'u' ? 4 : 2;
        const hex = s.slice(i + 2, i + 2 + n);
        if (hex.length !== n || !/^[0-9a-fA-F]+$/.test(hex)) throw err(`转义「\\${e}」后面要跟 ${n} 位十六进制数`, i);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2 + n;
        continue;
      }
      throw err(`不认识的转义「\\${e ?? ''}」（要写反斜杠本身请用 \\\\，或者改用单引号）`, i);
    }
    out += c;
    i++;
  }
}

// 不带引号的值：null / true / false / 数字 / 字符串。
function resolvePlain(text, err, col) {
  if (/^(null|Null|NULL|~)$/.test(text)) return null;
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^[-+]?\d+$/.test(text)) {
    const n = Number(text);
    if (!Number.isSafeInteger(n)) throw err(`整数 ${text} 太大了（超出 JavaScript 能精确表示的范围），请加引号当字符串写`, col);
    return n === 0 ? 0 : n; // 把 -0 变成 0
  }
  if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(text) || /^[-+]?\d+[eE][-+]?\d+$/.test(text)) return Number(text);
  return text;
}
