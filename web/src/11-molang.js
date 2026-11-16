// 11-molang.js — Molang（基岩版 / YSM 动画里的表达式）解释器：V3.molang.compile(src) → fn(ctx) → number。
// 安全：自己分词、解析成语法树、编译成闭包，绝不 eval / new Function（模型文件来自玩家，不可信）。
// 支持：数字、'字符串'、+ - * / 、比较、&& || !、?:（可省略 :）、??、赋值（v. / t. / c.）、( )、{ } 块、; 多语句 + return、
//   loop(n, {…})、break、continue；query./q.、variable./v.、temp./t.、context./c.、math.*、ysm.* 等命名空间；名字不分大小写。
//   math.sin / cos 用角度（和基岩版一样）；asin / acos / atan 看 V3.molang.radians（YSM 文档：返回弧度）。不认识的 query / 函数返回 0；-> 实体引用、数组、for_each 不支持（返回 0）。
// ctx = { q: { 名字: 数字 | fn(...参数) }, v: {}（实体变量，跨帧保留）, t: {}（每次求值清空）, c: {}, ns: { ysm: {…} } }
// 多级名字（v.roaming.size）存成扁平键 'roaming.size'。
(function (V3) {
  'use strict';
  const M = V3.molang = { errors: [] };
  const DEG = Math.PI / 180;
  const NS = { query: 'q', q: 'q', variable: 'v', v: 'v', temp: 't', t: 't', context: 'c', c: 'c', math: 'math' };
  // ---- tokenizer ----
  const OPS = ['??', '->', '==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '<', '>', '!', '?', ':', '=', '(', ')', '{', '}', '[', ']', ',', ';'];
  function lex(src) {
    const s = String(src), out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }      // // 注释（YSM 的 .molang 文件里有）
      if (ch === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue; }
      if (/[0-9.]/.test(ch) && (ch !== '.' || /[0-9]/.test(s[i + 1] || ''))) {
        const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?f?/i.exec(s.slice(i));
        out.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      if (/[A-Za-z_\u0080-￿]/.test(ch)) {
        const m = /^[A-Za-z_\u0080-￿][\w\u0080-￿]*(\.[A-Za-z_\u0080-￿][\w\u0080-￿]*)*/.exec(s.slice(i));
        out.push({ k: 'id', v: m[0].toLowerCase() }); i += m[0].length; continue;
      }
      if (ch === "'" || ch === '"') {
        const e = s.indexOf(ch, i + 1); if (e < 0) throw new Error('字符串没有结束');
        out.push({ k: 'str', v: s.slice(i + 1, e) }); i = e + 1; continue;
      }
      const op = OPS.find(o => s.startsWith(o, i));
      if (!op) throw new Error('不认识的字符 ' + ch);
      out.push({ k: 'op', v: op }); i += op.length;
    }
    out.push({ k: 'end', v: '' });
    return out;
  }
  // ---- parser → AST ----
  function parse(src) {
    const T = lex(src);
    let p = 0;
    const peek = () => T[p], next = () => T[p++];
    const is = (v) => T[p].k === 'op' && T[p].v === v;
    const eat = (v) => { if (!is(v)) throw new Error('这里应该是 ' + v + '，却是 ' + (T[p].v || '结尾')); p++; };
    function statements(stop) {                      // a; b; return c  →  { k: 'seq', list }
      const list = [];
      while (!(T[p].k === 'end') && !(stop && is(stop))) {
        if (is(';')) { p++; continue; }
        list.push(statement());
        if (is(';')) p++; else break;
      }
      return { k: 'seq', list, complex: list.length > 1 || T.some(t => t.k === 'op' && t.v === ';') };
    }
    function statement() {
      const t = peek();
      if (t.k === 'id' && t.v === 'return') { p++; return { k: 'ret', e: expr() }; }
      if (t.k === 'id' && (t.v === 'break' || t.v === 'continue')) { p++; return { k: t.v }; }
      return expr();
    }
    function expr() { return assign(); }
    function assign() {
      const l = cond();
      if (is('=')) { p++; const r = assign(); if (l.k !== 'var') throw new Error('只能给变量赋值'); return { k: 'set', ns: l.ns, name: l.name, e: r }; }
      return l;
    }
    function cond() {
      const c = nullc();
      if (is('?')) { p++; const a = cond(); let b = null; if (is(':')) { p++; b = cond(); } return { k: '?:', c, a, b }; }
      return c;
    }
    function nullc() { let l = or(); while (is('??')) { p++; l = { k: '??', a: l, b: or() }; } return l; }
    function or() { let l = and(); while (is('||')) { p++; l = { k: '||', a: l, b: and() }; } return l; }
    function and() { let l = eq(); while (is('&&')) { p++; l = { k: '&&', a: l, b: eq() }; } return l; }
    function eq() { let l = rel(); while (is('==') || is('!=')) { const o = next().v; l = { k: o, a: l, b: rel() }; } return l; }
    function rel() { let l = add(); while (is('<') || is('<=') || is('>') || is('>=')) { const o = next().v; l = { k: o, a: l, b: add() }; } return l; }
    function add() { let l = mul(); while (is('+') || is('-')) { const o = next().v; l = { k: o, a: l, b: mul() }; } return l; }
    function mul() { let l = unary(); while (is('*') || is('/')) { const o = next().v; l = { k: o, a: l, b: unary() }; } return l; }
    function unary() {
      if (is('-')) { p++; return { k: 'neg', a: unary() }; }
      if (is('+')) { p++; return unary(); }
      if (is('!')) { p++; return { k: 'not', a: unary() }; }
      return postfix();
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (is('->')) { p++; primary(); e = { k: 'num', v: 0 }; continue; }        // 实体引用：不支持
        if (is('[')) { p++; expr(); eat(']'); e = { k: 'num', v: 0 }; continue; }  // 数组：不支持
        return e;
      }
    }
    function primary() {
      const t = next();
      if (t.k === 'num') return { k: 'num', v: t.v };
      if (t.k === 'str') return { k: 'str', v: t.v };
      if (t.k === 'op' && t.v === '(') { const e = expr(); eat(')'); return e; }
      if (t.k === 'op' && t.v === '{') { const s = statements('}'); eat('}'); return { k: 'block', s }; }
      if (t.k === 'id') {
        if (t.v === 'true') return { k: 'num', v: 1 };
        if (t.v === 'false') return { k: 'num', v: 0 };
        if (t.v === 'this') return { k: 'this' };
        if (t.v === 'loop' && is('(')) {
          p++; const n = expr(); eat(','); const body = expr(); eat(')');
          return { k: 'loop', n, body };
        }
        if (t.v === 'for_each' && is('(')) { p++; let d = 1; while (d && T[p].k !== 'end') { if (is('(')) d++; else if (is(')')) d--; p++; } return { k: 'num', v: 0 }; }
        const dot = t.v.indexOf('.'), head = dot < 0 ? t.v : t.v.slice(0, dot), rest = dot < 0 ? '' : t.v.slice(dot + 1);
        const ns = NS[head] || head;
        if (is('(')) {
          p++; const args = [];
          if (!is(')')) { args.push(expr()); while (is(',')) { p++; args.push(expr()); } }
          eat(')');
          return { k: 'call', ns, name: rest, args };
        }
        return { k: 'var', ns: dot < 0 ? '?' : ns, name: dot < 0 ? head : rest };
      }
      throw new Error('这里不能是 ' + (t.v || '结尾'));
    }
    const s = statements(null);
    if (T[p].k !== 'end') throw new Error('多出来的 ' + T[p].v);
    return s;
  }
  // ---- compile AST → closure (ctx) => value; control flow via thrown tokens only inside loop / seq ----
  const RET = { r: 0 }, BRK = {}, CNT = {};
  const num = (x) => (typeof x === 'number' ? x : typeof x === 'string' ? 0 : x ? 1 : 0);
  let seed = 0x2545f491;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const wrap180 = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };
  const MATH = {
    abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round, trunc: Math.trunc, sqrt: Math.sqrt, exp: Math.exp,
    ln: Math.log, pow: Math.pow, max: Math.max, min: Math.min, sign: Math.sign,
    sin: (a) => Math.sin(a * DEG), cos: (a) => Math.cos(a * DEG), // 反三角：基岩版返回角度，YSM 的文档说返回弧度 → M.radians = true（导入 YSM 时打开）
    asin: (x) => Math.asin(x) / (M.radians ? 1 : DEG), acos: (x) => Math.acos(x) / (M.radians ? 1 : DEG),
    atan: (x) => Math.atan(x) / (M.radians ? 1 : DEG), atan2: (y, x) => Math.atan2(y, x) / (M.radians ? 1 : DEG),
    clamp: (v, a, b) => Math.min(Math.max(v, a), b), lerp: (a, b, t) => a + (b - a) * t, inverse_lerp: (a, b, v) => (b === a ? 0 : (v - a) / (b - a)),
    lerprotate: (a, b, t) => a + wrap180(b - a) * t, min_angle: wrap180, mod: (a, b) => (b ? a % b : 0), copy_sign: (a, b) => Math.sign(b || 1) * Math.abs(a),
    hermite_blend: (t) => 3 * t * t - 2 * t * t * t, random: (a, b) => a + (b - a) * rnd(), random_integer: (a, b) => Math.floor(a + (b - a + 1) * rnd()),
    die_roll: (n, a, b) => { let s = 0; for (let i = 0; i < Math.min(n, 64); i++) s += a + (b - a) * rnd(); return s; },
    die_roll_integer: (n, a, b) => { let s = 0; for (let i = 0; i < Math.min(n, 64); i++) s += Math.floor(a + (b - a + 1) * rnd()); return s; },
    ease_in_quad: (a, b, t) => a + (b - a) * t * t, ease_out_quad: (a, b, t) => a + (b - a) * (1 - (1 - t) * (1 - t)),
    ease_in_out_sine: (a, b, t) => a + (b - a) * (1 - Math.cos(Math.PI * t)) / 2,
  };
  const CONST = { pi: Math.PI };
  function comp(n) {
    switch (n.k) {
      case 'num': { const v = n.v; return () => v; }
      case 'str': { const v = n.v; return () => v; }
      case 'this': return (c) => num(c.self || 0);
      case 'var': {
        const ns = n.ns, k = n.name;
        if (ns === 'math') { const v = CONST[k] || 0; return () => v; }
        if (ns === 'v' || ns === 't' || ns === 'c') return (c) => { const o = c[ns]; const x = o && o[k]; return x === undefined ? 0 : x; };
        if (ns === 'q') return (c) => { const x = c.q && c.q[k]; return typeof x === 'function' ? num(x()) : x === undefined ? 0 : x; };
        return (c) => { const o = c.ns && c.ns[ns]; const x = o && o[k]; return typeof x === 'function' ? num(x()) : x === undefined ? 0 : x; };
      }
      case 'set': {
        const ns = n.ns === '?' ? 'v' : n.ns, k = n.name, e = comp(n.e);
        if (ns !== 'v' && ns !== 't' && ns !== 'c') return (c) => e(c);
        return (c) => { const x = e(c); (c[ns] || (c[ns] = {}))[k] = x; return x; };
      }
      case 'call': {
        const args = n.args.map(comp), k = n.name;
        if (n.ns === 'math') {
          const f = MATH[k];
          if (!f) return () => 0;
          return (c) => { const a = args.map(g => num(g(c))); const r = f.apply(null, a); return Number.isFinite(r) ? r : 0; };
        }
        if (n.ns === 'q') return (c) => { const f = c.q && c.q[k]; return typeof f === 'function' ? num(f.apply(null, args.map(g => g(c)))) : typeof f === 'number' ? f : 0; };
        return (c) => { const o = c.ns && c.ns[n.ns]; const f = o && o[k]; return typeof f === 'function' ? num(f.apply(null, args.map(g => g(c)))) : 0; };
      }
      case 'neg': { const a = comp(n.a); return (c) => -num(a(c)); }
      case 'not': { const a = comp(n.a); return (c) => (num(a(c)) ? 0 : 1); }
      case '+': case '-': case '*': case '/': case '<': case '<=': case '>': case '>=': case '==': case '!=': case '&&': case '||': case '??': {
        const a = comp(n.a), b = comp(n.b);
        switch (n.k) {
          case '+': return (c) => num(a(c)) + num(b(c));
          case '-': return (c) => num(a(c)) - num(b(c));
          case '*': return (c) => num(a(c)) * num(b(c));
          case '/': return (c) => { const d = num(b(c)); return d ? num(a(c)) / d : 0; };
          case '<': return (c) => (num(a(c)) < num(b(c)) ? 1 : 0);
          case '<=': return (c) => (num(a(c)) <= num(b(c)) ? 1 : 0);
          case '>': return (c) => (num(a(c)) > num(b(c)) ? 1 : 0);
          case '>=': return (c) => (num(a(c)) >= num(b(c)) ? 1 : 0);
          case '==': return (c) => { const x = a(c), y = b(c); return (typeof x === 'string' || typeof y === 'string' ? String(x) === String(y) : num(x) === num(y)) ? 1 : 0; };
          case '!=': return (c) => { const x = a(c), y = b(c); return (typeof x === 'string' || typeof y === 'string' ? String(x) !== String(y) : num(x) !== num(y)) ? 1 : 0; };
          case '&&': return (c) => (num(a(c)) && num(b(c)) ? 1 : 0);
          case '||': return (c) => (num(a(c)) || num(b(c)) ? 1 : 0);
          default: return (c) => { const x = a(c); return x === undefined || x === null ? b(c) : x; };
        }
      }
      case '?:': { const cc = comp(n.c), a = comp(n.a), b = n.b ? comp(n.b) : () => 0; return (c) => (num(cc(c)) ? a(c) : b(c)); }
      case 'block': return compSeq(n.s, true);
      case 'loop': {
        const cnt = comp(n.n), body = comp(n.body);
        return (c) => {
          const m = Math.min(1024, Math.max(0, Math.floor(num(cnt(c)))));
          for (let i = 0; i < m; i++) { try { body(c); } catch (x) { if (x === BRK) break; if (x === CNT) continue; throw x; } }
          return 0;
        };
      }
      case 'ret': { const e = comp(n.e); return (c) => { RET.r = e(c); throw RET; }; }
      case 'break': return () => { throw BRK; };
      case 'continue': return () => { throw CNT; };
      case 'seq': return compSeq(n, false);
    }
    return () => 0;
  }
  function compSeq(s, inner) {
    const fs = s.list.map(comp);
    if (!s.complex && fs.length === 1 && !inner) return fs[0];      // simple expression → its own value
    if (inner) return (c) => { for (const f of fs) f(c); return 0; };   // { } block: statements; return bubbles up
    return (c) => {                                                    // complex expression: value of `return`, else 0
      try { for (const f of fs) f(c); return 0; } catch (x) { if (x === RET) return RET.r; if (x === BRK || x === CNT) return 0; throw x; }
    };
  }
  const cache = new Map();
  // compile(src | number) → fn(ctx) → number | string. Syntax errors: fn always 0, message in M.errors (first 50).
  M.compile = (src) => {
    if (typeof src === 'number') return () => src;
    const key = String(src);
    let f = cache.get(key);
    if (f) return f;
    try {
      const g = comp(parse(key));
      f = (c) => { try { if (c) c.t = {}; return g(c || {}); } catch (x) { if (x === RET) return RET.r; return 0; } };
    } catch (e) {
      if (M.errors.length < 50) M.errors.push(key.slice(0, 80) + ' → ' + e.message);
      f = () => 0;
    }
    cache.set(key, f);
    return f;
  };
  M.eval = (src, ctx) => num(M.compile(src)(ctx || {}));
  M.num = num;
})(window.V3);
