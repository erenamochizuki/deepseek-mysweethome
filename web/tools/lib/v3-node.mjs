// tools/lib/v3-node.mjs — load the browser modules in web/src (NN-*.js) into Node, in the MAIN realm.
//
//   import { loadV3 } from './lib/v3-node.mjs';           // from web/tools/*.mjs
//   const { V3, window } = loadV3(['12-nbt', '13-share']); // 00-core.js is loaded first by default
//   const model = await V3.share.read(bytes);
//
// Why the main realm: every file runs through vm.runInThisContext, so Uint8Array, ArrayBuffer, Promise, Map …
// inside the modules are the same classes as in the caller (instanceof and TypedArray checks just work).
// vm.runInNewContext would give the modules their own copies of those classes.
//
// How a file runs: its text is wrapped as `(function (window, self, globalThis, document, location, navigator,
// THREE, …) { <file> })` and called with `this` = the fake window, so `window.V3 = …` and the
// `(function (V3) { … })(window.V3)` pattern behave as in a page. Stack traces show the real file and line.
//
// Fake window: a fresh object per loadV3() call that inherits from Node's globalThis (so DecompressionStream,
// Blob, TextDecoder, setTimeout … are reachable as window.X), plus window/self/globalThis/top/parent = itself,
// location = new URL(opts.url), addEventListener/removeEventListener/dispatchEvent (a real EventTarget),
// __V3_BUILD / __V3_PAGE / __V3_MODULES, and anything passed in opts.globals.
//
// Differences from a real page (keep in mind):
//  - A bare name inside a file resolves, in order, to: the wrapper parameters above; the fake window's own
//    enumerable properties as they were when that file STARTED loading (a snapshot, not live); then Node's
//    real globals. Set things on window BEFORE loading the file that reads them as bare names, or read
//    them as window.X (always live).
//  - No DOM: document is undefined unless you pass opts.document (or opts.globals.document).
//  - THREE: opts.three = 'stub' (default; just enough for 00-core.js to load), 'real' (web/vendor/three.min.js
//    run in the same fake window, without its deprecation console.warn), false (none), or your own object.
//  - A file that throws while loading stops loadV3 with an Error naming the file (cause = the original error).
//    The page instead logs it and goes on.
//  - Each load() call runs its batch in build order (file-name order, like build.mjs); files already loaded
//    are skipped.
//
// Module names: '12-nbt.js', '12-nbt', 'nbt' (the part after the number), '12' or 12 (only if exactly one
// file has that number), or a RegExp tested against the file names (all matches). CSS files are ignored.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC_DIR = path.join(WEB_DIR, 'src');
export const VENDOR_THREE = path.join(WEB_DIR, 'vendor', 'three.min.js');

const MODULE_RE = /^\d\d-[^.]+\.js$/;
const BASE_PARAMS = ['window', 'self', 'globalThis', 'document', 'location', 'navigator', 'THREE'];
const SELF_NAMES = new Set(['window', 'self', 'globalThis', 'top', 'parent']);
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED = new Set(('break case catch class const continue debugger default delete do else enum export extends ' +
  'false finally for function if import in instanceof new null return super switch this throw true try typeof var ' +
  'void while with yield let static implements interface package private protected public await arguments eval ' +
  'undefined NaN Infinity').split(' '));

/** All loadable module file names in build order (sorted file names). */
export function listModules(srcDir = SRC_DIR) {
  return fs.readdirSync(srcDir).filter(f => MODULE_RE.test(f)).sort();
}

/** Resolve names (see header) to file names in build order, without duplicates. Throws on unknown/ambiguous. */
export function resolveModules(names, srcDir = SRC_DIR) {
  const all = listModules(srcDir);
  const out = new Set();
  const list = Array.isArray(names) ? names : [names];
  for (const n of list) {
    if (n instanceof RegExp) {
      const hit = all.filter(f => { n.lastIndex = 0; return n.test(f); });
      if (!hit.length) throw new Error(`v3-node: no module matches ${n} (have: ${all.join(', ')})`);
      hit.forEach(f => out.add(f));
      continue;
    }
    const s = String(n).trim();
    let hit;
    if (/^\d{1,2}$/.test(s)) hit = all.filter(f => f.startsWith(s.padStart(2, '0') + '-'));
    else if (MODULE_RE.test(s)) hit = all.filter(f => f === s);
    else if (MODULE_RE.test(s + '.js')) hit = all.filter(f => f === s + '.js');
    else hit = all.filter(f => f.slice(3) === s.replace(/\.js$/, '') + '.js');
    if (hit.length === 0) throw new Error(`v3-node: unknown module "${s}" (have: ${all.join(', ')})`);
    if (hit.length > 1) throw new Error(`v3-node: "${s}" is ambiguous (${hit.join(', ')}); use the full file name`);
    out.add(hit[0]);
  }
  return [...out].sort();
}

/** Minimal THREE for 00-core.js (it makes one hidden material at load time). Anything else needs three: 'real'. */
export function threeStub() {
  class MeshBasicMaterial {
    constructor(params) {
      this.type = 'MeshBasicMaterial'; this.isMaterial = true; this.isMeshBasicMaterial = true; this.name = '';
      Object.assign(this, params || {});
    }
  }
  return { __stub: true, REVISION: 'stub', MeshBasicMaterial };
}

/** A fresh fake window (see header). Exported for tests that want to prepare one by hand. */
export function makeWindow(opts = {}) {
  const win = Object.create(globalThis);
  // Node's accessor globals (crypto …) refuse a `this` that is not the real global: forward them.
  for (const k of Object.getOwnPropertyNames(globalThis)) {
    const d = Object.getOwnPropertyDescriptor(globalThis, k);
    if (!d || !d.get) continue;
    Object.defineProperty(win, k, {
      configurable: true, enumerable: false,
      get: () => globalThis[k],
      set: (v) => Object.defineProperty(win, k, { value: v, writable: true, configurable: true, enumerable: true }),
    });
  }
  for (const k of SELF_NAMES) win[k] = win;
  const et = new EventTarget();
  win.addEventListener = et.addEventListener.bind(et);
  win.removeEventListener = et.removeEventListener.bind(et);
  win.dispatchEvent = et.dispatchEvent.bind(et);
  win.location = new URL(opts.url || 'http://localhost/');
  win.__V3_BUILD = opts.build || 'node';
  win.__V3_PAGE = opts.page || 'node';
  win.__V3_MODULES = [];
  if (opts.document !== undefined) win.document = opts.document;
  if (opts.globals) Object.assign(win, opts.globals);
  return win;
}

function paramsFor(win) {
  const names = [...BASE_PARAMS];
  for (const k of Object.keys(win)) if (IDENT_RE.test(k) && !RESERVED.has(k) && !names.includes(k)) names.push(k);
  return names;
}

function runFile(win, absPath, code) {
  let params = paramsFor(win);
  let fn;
  for (;;) {
    try { fn = vm.runInThisContext(`(function (${params.join(', ')}) {\n${code}\n})`, { filename: absPath, lineOffset: -1 }); break; }
    catch (e) {
      // A top-level let/const/class in the file with the same name as a parameter: drop that parameter.
      const m = e instanceof SyntaxError && /Identifier '([^']+)' has already been declared/.exec(e.message);
      if (m && params.includes(m[1]) && !BASE_PARAMS.includes(m[1])) { params = params.filter(p => p !== m[1]); continue; }
      throw new Error(`v3-node: ${path.basename(absPath)} has a syntax error: ${e.message}`, { cause: e });
    }
  }
  try { fn.apply(win, params.map(p => (SELF_NAMES.has(p) ? win : win[p]))); }
  catch (e) { throw new Error(`v3-node: ${path.basename(absPath)} threw while loading: ${e && e.message}`, { cause: e }); }
}

function loadThreeReal(win) {
  // Blank the leading deprecation console.warn line but keep the line count (stack traces stay right).
  const code = fs.readFileSync(VENDOR_THREE, 'utf8').replace(/^console\.warn\([^\n]*\);?/, '');
  runFile(win, VENDOR_THREE, code);
  if (!win.THREE || !win.THREE.REVISION) throw new Error('v3-node: three.min.js did not define THREE');
}

/**
 * Load modules into a fresh fake window. Returns { V3, window, modules, load(names) }.
 * opts: core (default true: load 00-core.js first), three ('stub' | 'real' | false | object), url, page, build,
 *       globals (extra window properties), document, srcDir.
 */
export function loadV3(names = [], opts = {}) {
  const srcDir = opts.srcDir || SRC_DIR;
  const win = makeWindow(opts);
  const three = opts.three === undefined ? 'stub' : opts.three;
  if (three === 'stub') win.THREE = threeStub();
  else if (three === 'real') loadThreeReal(win);
  else if (three && typeof three === 'object') win.THREE = three;
  const loaded = win.__V3_MODULES;
  const handle = {
    window: win,
    modules: loaded,
    get V3() { return win.V3; },
    load(more) {
      for (const f of resolveModules(more, srcDir)) {
        if (loaded.includes(f)) continue;
        const abs = path.join(srcDir, f);
        runFile(win, abs, fs.readFileSync(abs, 'utf8'));
        loaded.push(f);
      }
      return handle;
    },
  };
  const first = opts.core === false ? [] : ['00-core.js'];
  // Without 00-core.js nobody creates window.V3; modules are written as `(function (V3) {…})(window.V3)`.
  if (opts.core === false && !win.V3) win.V3 = {};
  const list = Array.isArray(names) ? names : [names];
  if (first.length || list.length) handle.load([...first, ...list]);
  return handle;
}
