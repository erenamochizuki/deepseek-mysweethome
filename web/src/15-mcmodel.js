// 15-mcmodel.js — MC 方块：状态字符串 → blockstates（variants / multipart）→ 模型（parent 链、贴图引用）→ 烘焙成面（quad）。
// 纯计算，不用 THREE / DOM，Node 里能测。规则按 26.1.2 的源码核对过（见 docs/MC-RENDER.md）。
(function (V3) {
  'use strict';
  const M = V3.mcmodel = {};
  const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
  const NORMALS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  const OPP = [1, 0, 3, 2, 5, 4];
  const AXIS = [1, 1, 2, 2, 0, 0]; // 每个方向的轴（0=x 1=y 2=z）
  M.DIRS = DIRS; M.NORMALS = NORMALS; M.OPP = OPP; M.AXIS = AXIS;
  M.dirIndex = (s) => DIRS.indexOf(String(s || '').toLowerCase());

  const normId = M.normId = (id) => { const s = String(id || ''); return s.includes(':') ? s : 'minecraft:' + s; };

  // ---- 状态字符串 ----
  // "minecraft:oak_stairs[facing=east,half=top]" → {name:'minecraft:oak_stairs', id:'oak_stairs', ns, props:{facing:'east',half:'top'}}
  M.parseState = function (s) {
    s = String(s || '').trim();
    let name = s;
    const props = {};
    const b = s.indexOf('[');
    if (b >= 0) {
      name = s.slice(0, b);
      const e = s.indexOf(']', b);
      const inner = s.slice(b + 1, e > b ? e : s.length);
      for (const kv of inner.split(',')) {
        const q = kv.indexOf('=');
        if (q > 0) props[kv.slice(0, q).trim()] = kv.slice(q + 1).trim();
      }
    }
    const c = name.indexOf('{');
    if (c >= 0) name = name.slice(0, c);
    name = normId(name.trim());
    const k = name.indexOf(':');
    return { name, ns: name.slice(0, k), id: name.slice(k + 1), props };
  };
  M.stateKey = (st) => st.name + '[' + Object.keys(st.props).sort().map((k) => k + '=' + st.props[k]).join(',') + ']';
  M.AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);
  M.isAir = (st) => M.AIR.has(st.name);

  // ---- variants 的 key / multipart 的 when ----
  // lenient=true：状态里没有的属性当作「不管」（只在严格匹配一个都没有时用，状态字符串不全的情况）
  M.matchVariantKey = function (key, props, lenient) {
    if (key === '') return true;
    for (const part of String(key).split(',')) {
      const q = part.indexOf('=');
      if (q < 0) return false;
      const have = props[part.slice(0, q)];
      if (have === undefined) { if (lenient) continue; return false; }
      if (have !== part.slice(q + 1)) return false;
    }
    return true;
  };
  M.matchCondition = function (when, props) {
    if (!when || typeof when !== 'object') return true;
    if (Array.isArray(when.OR)) return when.OR.some((c) => M.matchCondition(c, props));
    if (Array.isArray(when.AND)) return when.AND.every((c) => M.matchCondition(c, props));
    for (const k of Object.keys(when)) {
      const have = props[k];
      if (have === undefined) return false;
      const terms = String(when[k]).split('|');
      if (!terms.some((t) => (t.startsWith('!') ? have !== t.slice(1) : have === t))) return false;
    }
    return true;
  };
  const quadrant = (a) => { const n = ((Math.round(+a || 0) % 360) + 360) % 360; return n % 90 === 0 ? n : 0; };
  M.variantList = function (v) {
    const arr = Array.isArray(v) ? v : v ? [v] : [];
    return arr.filter((o) => o && typeof o.model === 'string').map((o) => ({
      model: normId(o.model), x: quadrant(o.x), y: quadrant(o.y), z: quadrant(o.z), uvlock: !!o.uvlock,
      weight: o.weight > 0 ? Math.floor(o.weight) : 1,
    }));
  };

  // ---- MC 的随机（java.util.Random 同款）和按位置的种子（Mth.getSeed） ----
  const MUL = 0x5DEECE66Dn, ADD = 0xBn, MASK = (1n << 48n) - 1n;
  class JavaRandom {
    constructor(seed) { this.setSeed(seed || 0n); }
    setSeed(seed) { this.s = (BigInt.asIntN(64, BigInt(seed)) ^ MUL) & MASK; }
    next(bits) { this.s = (this.s * MUL + ADD) & MASK; return Number(BigInt.asIntN(32, this.s >> BigInt(48 - bits))); }
    nextInt(bound) {
      if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
      let bits, val;
      do { bits = this.next(31); val = bits % bound; } while (bits - val + (bound - 1) > 0x7fffffff);
      return val;
    }
    nextLong() { const hi = BigInt(this.next(32)), lo = BigInt(this.next(32)); return BigInt.asIntN(64, (hi << 32n) + lo); }
  }
  M.JavaRandom = JavaRandom;
  M.posSeed = function (x, y, z) {
    let s = BigInt.asIntN(64, BigInt(Math.imul(x | 0, 3129871)) ^ (BigInt(z | 0) * 116129781n) ^ BigInt(y | 0));
    s = BigInt.asIntN(64, s * s * 42317861n + s * 11n);
    return s >> 16n;
  };
  function pickWeighted(list, rnd) {
    let total = 0;
    for (const v of list) total += v.weight;
    let r = rnd.nextInt(total);
    for (const v of list) { r -= v.weight; if (r < 0) return v; }
    return list[list.length - 1];
  }

  // ---- 3×3 矩阵（行优先） ----
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul3 = (a, b) => {
    const o = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return o;
  };
  const apply3 = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const transpose3 = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
  const isIdent = (m) => m.every((v, i) => Math.abs(v - I3[i]) < 1e-6);
  // 右手系绕轴旋转 deg 度
  function rotAxis(axis, deg) {
    const r = (deg * Math.PI) / 180;
    let c = Math.cos(r), s = Math.sin(r);
    if (deg % 90 === 0) { c = Math.round(c); s = Math.round(s); }
    if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
    if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
    return [c, -s, 0, s, c, 0, 0, 0, 1];
  }
  M.rotAxis = rotAxis; M.mul3 = mul3; M.apply3 = apply3;
  // blockstate 的 x/y/z：先 X 再 Y 再 Z，+90 = 绕正轴 −90°（y=90：北→东）
  M.blockRotation = (x, y, z) => mul3(rotAxis('z', -z), mul3(rotAxis('y', -y), rotAxis('x', -x)));
  function nearestDir(v) {
    let best = -1, bp = 0;
    for (let i = 0; i < 6; i++) {
      const n = NORMALS[i], p = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
      if (p >= 0 && p > bp) { bp = p; best = i; }
    }
    return best;
  }
  M.nearestDir = nearestDir;
  // uvlock 用：每个面的「本地 → 世界」（南面 = 不转）
  const L2G = [rotAxis('x', 90), rotAxis('x', -90), rotAxis('y', 180), I3, rotAxis('y', -90), rotAxis('y', 90)];
  const G2L = L2G.map(transpose3);
  function faceTransform(R, side) {
    const t = mul3(R, L2G[side]);
    return mul3(G2L[nearestDir(apply3(t, [0, 0, 1]))], t);
  }
  function elementRotation(rot) {
    if (!rot || typeof rot !== 'object') return null;
    const o = Array.isArray(rot.origin) ? rot.origin : [8, 8, 8];
    let m;
    if (rot.axis != null) m = rotAxis(String(rot.axis).toLowerCase(), +rot.angle || 0);
    else m = mul3(rotAxis('z', +rot.z || 0), mul3(rotAxis('y', +rot.y || 0), rotAxis('x', +rot.x || 0)));
    if (rot.rescale && !isIdent(m)) {
      const sc = [0, 1, 2].map((a) => 1 / Math.max(Math.abs(m[a]), Math.abs(m[3 + a]), Math.abs(m[6 + a])));
      m = m.map((v, i) => v * sc[i % 3]);
    }
    return { origin: [o[0] / 16, o[1] / 16, o[2] / 16], m };
  }

  // ---- 面的顶点（FaceInfo）和默认 uv ----
  // 每个顶点取 from(0) 还是 to(1)：[x, y, z]
  const FACEINFO = [
    [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]],
    [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]],
    [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
    [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]],
  ];
  M.FACEINFO = FACEINFO;
  function defaultUV(f, t, d) {
    switch (d) {
      case 0: return [f[0], 16 - t[2], t[0], 16 - f[2]];
      case 1: return [f[0], f[2], t[0], t[2]];
      case 2: return [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]];
      case 3: return [f[0], 16 - t[1], t[0], 16 - f[1]];
      case 4: return [f[2], 16 - t[1], t[2], 16 - f[1]];
      default: return [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]];
    }
  }
  M.defaultUV = defaultUV;
  function recalcWinding(pos, uv, dir) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 4; i++) for (let a = 0; a < 3; a++) { const v = pos[i * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
    for (let i = 0; i < 4; i++) {
      const sel = FACEINFO[dir][i];
      const want = [sel[0] ? mx[0] : mn[0], sel[1] ? mx[1] : mn[1], sel[2] ? mx[2] : mn[2]];
      let k = -1;
      for (let j = i; j < 4 && k < 0; j++) {
        if (Math.abs(pos[j * 3] - want[0]) < 1e-6 && Math.abs(pos[j * 3 + 1] - want[1]) < 1e-6 && Math.abs(pos[j * 3 + 2] - want[2]) < 1e-6) k = j;
      }
      if (k < 0) return;
      if (k !== i) {
        for (let a = 0; a < 3; a++) { const t = pos[i * 3 + a]; pos[i * 3 + a] = pos[k * 3 + a]; pos[k * 3 + a] = t; }
        for (let a = 0; a < 2; a++) { const t = uv[i * 2 + a]; uv[i * 2 + a] = uv[k * 2 + a]; uv[k * 2 + a] = t; }
      }
    }
  }

  // ---- 贴图引用 ----
  M.material = function (v) {
    if (typeof v === 'string') return { sprite: normId(v), force: false };
    if (v && typeof v === 'object' && typeof v.sprite === 'string') return { sprite: normId(v.sprite), force: !!v.force_translucent };
    return null;
  };
  // chain：子 → 根的模型 json 列表
  M.resolveTextures = function (chain) {
    const slots = {};
    for (let i = chain.length - 1; i >= 0; i--) {
      const t = chain[i].textures;
      if (t && typeof t === 'object') for (const k of Object.keys(t)) slots[k] = t[k];
    }
    const out = {};
    const isRef = (v) => typeof v === 'string' && v.startsWith('#');
    for (const k of Object.keys(slots)) if (!isRef(slots[k])) { const m = M.material(slots[k]); if (m) out[k] = m; }
    for (let changed = true; changed;) {
      changed = false;
      for (const k of Object.keys(slots)) {
        if (out[k] || !isRef(slots[k])) continue;
        const r = out[slots[k].slice(1)];
        if (r) { out[k] = r; changed = true; }
      }
    }
    return out;
  };
  M.lookupTexture = (textures, ref) => (typeof ref === 'string' ? textures[ref.startsWith('#') ? ref.slice(1) : ref] || null : null);
  M.MISSING = 'minecraft:missingno';

  // ---- 烘焙：解析好的模型 + 旋转 → quads ----
  // quad：pos(12，方块内 0..1) uv(8，贴图内 0..1) sprite force tint shade emit ao dir(最终朝向) cull(剔除方向或 −1) uvRect
  const C = [0.5, 0.5, 0.5];
  M.bakeModel = function (model, rot) {
    rot = rot || {};
    const R = M.blockRotation(rot.x | 0, rot.y | 0, rot.z | 0);
    const hasR = !isIdent(R);
    const quads = [];
    for (const el of model.elements) {
      if (!el || !Array.isArray(el.from) || !Array.isArray(el.to)) continue;
      const f = el.from.map(Number), t = el.to.map(Number);
      let dX = true, dY = true, dZ = true;
      if (f[0] === t[0]) { dY = false; dZ = false; }
      if (f[1] === t[1]) { dX = false; dZ = false; }
      if (f[2] === t[2]) { dX = false; dY = false; }
      if (!dX && !dY && !dZ) continue;
      const er = elementRotation(el.rotation);
      for (const fname of Object.keys(el.faces || {})) {
        const d = DIRS.indexOf(fname);
        const face = el.faces[fname];
        if (d < 0 || !face) continue;
        const ax = AXIS[d];
        if ((ax === 0 && !dX) || (ax === 1 && !dY) || (ax === 2 && !dZ)) continue;
        const uv = Array.isArray(face.uv) && face.uv.length === 4 ? face.uv.map(Number) : defaultUV(f, t, d);
        const frot = quadrant(face.rotation) / 90;
        let uvT = null;
        if (rot.uvlock && hasR) { const ft = faceTransform(R, d); if (!isIdent(ft)) uvT = transpose3(ft); }
        const pos = new Float32Array(12), tuv = new Float32Array(8);
        for (let i = 0; i < 4; i++) {
          const sel = FACEINFO[d][i];
          let p = [(sel[0] ? t[0] : f[0]) / 16, (sel[1] ? t[1] : f[1]) / 16, (sel[2] ? t[2] : f[2]) / 16];
          if (er) { const q = apply3(er.m, [p[0] - er.origin[0], p[1] - er.origin[1], p[2] - er.origin[2]]); p = [q[0] + er.origin[0], q[1] + er.origin[1], q[2] + er.origin[2]]; }
          if (hasR) { const q = apply3(R, [p[0] - 0.5, p[1] - 0.5, p[2] - 0.5]); p = [q[0] + 0.5, q[1] + 0.5, q[2] + 0.5]; }
          const j = (i + frot) % 4;
          let u = (j === 0 || j === 1 ? uv[0] : uv[2]) / 16, v = (j === 0 || j === 3 ? uv[1] : uv[3]) / 16;
          if (uvT) { const q = apply3(uvT, [u - 0.5, v - 0.5, 0]); u = q[0] + 0.5; v = q[1] + 0.5; }
          pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
          tuv[i * 2] = u; tuv[i * 2 + 1] = v;
        }
        // 最终朝向：(v2−v1)×(v0−v1)
        const ax1 = pos[6] - pos[3], ay1 = pos[7] - pos[4], az1 = pos[8] - pos[5];
        const bx = pos[0] - pos[3], by = pos[1] - pos[4], bz = pos[2] - pos[5];
        const nrm = [ay1 * bz - az1 * by, az1 * bx - ax1 * bz, ax1 * by - ay1 * bx];
        const dir = nearestDir(nrm);
        if (dir < 0) continue;
        if (!er) recalcWinding(pos, tuv, dir);
        let cull = -1;
        if (face.cullface != null) {
          const c = M.dirIndex(face.cullface);
          if (c >= 0) cull = hasR ? nearestDir(apply3(R, NORMALS[c])) : c;
        }
        const mat = M.lookupTexture(model.textures, face.texture);
        quads.push({
          pos, uv: tuv, sprite: mat ? mat.sprite : M.MISSING, force: !!(mat && mat.force),
          tint: Number.isInteger(face.tintindex) ? face.tintindex : -1, shade: el.shade !== false,
          emit: Math.max(0, Math.min(15, el.light_emission | 0)), ao: model.ao, dir, cull,
          uvRect: [uv[0] / 16, uv[1] / 16, uv[2] / 16, uv[3] / 16], rotated: !!er,
        });
      }
    }
    return quads;
  };

  // ---- 解析器：一个 jar 一个 ----
  M.createResolver = function (pack) {
    const R = { pack, errors: [], warnings: [] };
    const modelCache = new Map(), bakeCache = new Map(), bsCache = new Map(), warned = new Set();
    const warn = (k, msg) => { if (!warned.has(k)) { warned.add(k); R.warnings.push(msg); } };
    R.blockstate = (name) => { if (!bsCache.has(name)) bsCache.set(name, pack.blockstate(name)); return bsCache.get(name); };
    R.resolveModel = function (id) {
      const full = normId(id);
      if (modelCache.has(full)) return modelCache.get(full);
      const chain = [], seen = new Set();
      let cur = full, missing = null;
      while (cur) {
        if (seen.has(cur)) { warn('cycle:' + full, '模型 parent 循环：' + full); break; }
        seen.add(cur);
        const js = pack.model(cur);
        if (!js) { missing = cur; break; }
        chain.push(js);
        cur = typeof js.parent === 'string' ? normId(js.parent) : null;
      }
      let elements = null, ao = true;
      for (const js of chain) if (Array.isArray(js.elements)) { elements = js.elements; break; }
      for (const js of chain) if (typeof js.ambientocclusion === 'boolean') { ao = js.ambientocclusion; break; }
      if (missing && !elements) warn('model:' + missing, '找不到模型：' + missing + (missing !== full ? '（' + full + ' 的 parent）' : ''));
      const res = { id: full, missing, notFound: !chain.length, elements: elements || [], hasElements: !!(elements && elements.length), ao, textures: M.resolveTextures(chain) };
      modelCache.set(full, res);
      return res;
    };
    R.bake = function (v) {
      const key = v.model + '|' + v.x + '|' + v.y + '|' + v.z + '|' + (v.uvlock ? 1 : 0);
      let b = bakeCache.get(key);
      if (!b) { const model = R.resolveModel(v.model); b = { variant: v, model, quads: M.bakeModel(model, v) }; bakeCache.set(key, b); }
      return b;
    };
    // 选模型：返回 {status, parts:[variant…], random(是否和位置有关)}
    R.select = function (st, pos) {
      const def = R.blockstate(st.name);
      if (!def) return { status: 'noblockstate', parts: [], random: false };
      let rnd = null;
      const p = pos || [0, 0, 0];
      const seedFor = () => M.posSeed(p[0], p[1] - (st.props.half === 'upper' ? 1 : 0), p[2]);
      if (def.variants && typeof def.variants === 'object') {
        const keys = Object.keys(def.variants);
        let hit = keys.find((k) => M.matchVariantKey(k, st.props));
        if (hit === undefined && !Array.isArray(def.multipart)) {
          hit = keys.find((k) => M.matchVariantKey(k, st.props, true));
          if (hit !== undefined) warn('lenient:' + M.stateKey(st), '状态不全，宽松匹配：' + M.stateKey(st) + ' → ' + hit);
        }
        if (hit !== undefined) {
          const list = M.variantList(def.variants[hit]);
          if (!list.length) return { status: 'bad', parts: [], random: false };
          if (list.length === 1) return { status: 'ok', parts: list, random: false };
          rnd = new JavaRandom(seedFor());
          return { status: 'ok', parts: [pickWeighted(list, rnd)], random: true };
        }
      }
      if (Array.isArray(def.multipart)) {
        const parts = [];
        let seed = null, random = false;
        for (const sel of def.multipart) {
          if (!sel || (sel.when && !M.matchCondition(sel.when, st.props))) continue;
          const list = M.variantList(sel.apply);
          if (!list.length) continue;
          if (list.length === 1) { parts.push(list[0]); continue; }
          if (!rnd) { rnd = new JavaRandom(seedFor()); seed = rnd.nextLong(); }
          rnd.setSeed(seed);
          parts.push(pickWeighted(list, rnd));
          random = true;
        }
        return { status: parts.length ? 'ok' : 'empty', parts, random };
      }
      return { status: 'nomatch', parts: [], random: false };
    };
    // 一个方块（某个位置）的全部 quad
    R.block = function (state, pos) {
      const st = typeof state === 'string' ? M.parseState(state) : state;
      if (M.isAir(st)) return { st, status: 'air', quads: [], parts: [], random: false };
      const sel = R.select(st, pos);
      const parts = sel.parts.map((v) => R.bake(v));
      const quads = [];
      for (const b of parts) for (const q of b.quads) quads.push(q);
      let status = sel.status;
      if (status === 'ok' && !quads.length) status = parts.some((b) => b.model.notFound) ? 'missing' : 'empty';
      if (status === 'noblockstate' || status === 'nomatch' || status === 'bad') warn('bs:' + M.stateKey(st), '没有模型：' + M.stateKey(st) + '（' + status + '）');
      return { st, status, quads, parts, random: sel.random };
    };
    // 模型里提到的「粒子」贴图（没 elements 的方块，比如箱子、床，用它取颜色）
    R.particle = function (st) {
      const sel = R.select(st, [0, 0, 0]);
      for (const v of sel.parts) { const m = R.resolveModel(v.model); if (m.textures.particle) return m.textures.particle.sprite; }
      return null;
    };
    return R;
  };
})(window.V3);
