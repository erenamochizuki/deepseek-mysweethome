// web/tools/lib/furn-mc-vox.mjs — 取网页里的体素家具（56-furn-ground / 57-furn-loft 的真代码），换到朝北的 MC 坐标。
//
// 体素：1 格 = 1/32 米 = 半个 MC 像素。家具的局部坐标里格子 (x, y, z) 占 x−0.5..x+0.5、y..y+1、z−0.5..z+0.5（格），正面朝 +z。
// MC 坐标（这里叫 u 格）：整数 (ux, uy, uz)，占 MC 像素 u/2 .. u/2 + 0.5；主格（offset [0,0,0]）的方块是 u 0..31。
//   1. 绕 y 转 rot（V3.furnMc 里的 rot：180 = 正面从 +z 转到 −z）；
//   2. 平移：x、z 按 align 放（'center'：体素原点那格放在占的格子正中间往 +x/+z 偏 1/4 像素，这样所有边都在半像素上；
//      'back'：z 方向贴着背面），y 不动（脚底 = 方块底）。
// 不是 1/32 米、或者转过的体素（床上的睡帽）按 1/32 米重新取样（每格 3×3×3 个点，过 3 成算有）。
// 只取默认样子（床是 made 那一套）：看不见的骨骼（sleeping 的被窝、空碗里的米饭）不要；不是体素的网格（被窝曲面）跳过并报出来。
// 格子外面的体素（比格子大的家具）裁掉并报出来。
// 简化（furn-mc-lite，第 10 节）用的：体素记下 overlay 里的骨骼名（bone）；第 2 轮的还有 keepOut（不许盖的空格子：空碗里的米饭、屏幕面板前面那层）、
// pinned（屏幕面板）、screens（屏幕平面在 u 里的位置）。
import path from 'node:path';
import { loadV3 } from './v3-node.mjs';

let H = null;
// 书桌的电脑屏幕要画布（CanvasTexture）：Node 里给一个什么都不画的假画布（屏幕是平面，不转 MC）
const NOOP = new Proxy({}, { get: () => () => {}, set: () => true });
const FAKE_DOC = { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => NOOP, addEventListener() {} }) };
export function v3() {
  if (!H) {
    // FURN_MC_SRC=<目录>：从别的 src 目录读（试改体素家具用，不动 web/src）
    const srcDir = process.env.FURN_MC_SRC ? path.resolve(process.env.FURN_MC_SRC) : undefined;
    H = loadV3(['03-vox', '40-layout', '44-furn-mc', '56-furn-ground', '57-furn-loft', '57-furn-loft2'], { three: 'real', srcDir, document: FAKE_DOC });
    const V3 = H.V3, orig = V3.vox.build;
    V3.vox.build = (g, opt = {}) => { const r = orig(g, opt); if (H.capture) H.capture.push({ g, opt, r }); return r; };
  }
  return H;
}
export const furnMc = () => v3().V3.furnMc;

const S = 1 / 32;

// 占的格子（朝北，单位格）：[x0, x1) × [y0, y1) × [z0, z1)
export function footprint(f) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const c of f.cells) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], c.offset[a]); hi[a] = Math.max(hi[a], c.offset[a] + 1); }
  return { lo, hi };
}

// 体素版的 three.js 物体（工作台「家具一览」的样子：ctx.studio）+ 建它时用到的体素网格。
// src = { layer, id }；rect = 换掉布局矩形（[x0, z0, x1, z1]，串灯只取一格）；keep = 留着 buildAll 摆好的场景位置和朝向
export function buildVoxel(f, src = f.layout, { rect = null, keep = false } = {}) {
  if (f.make && src === f.layout) return buildMade(f);
  const h = v3(), V3 = h.V3, THREE = h.window.THREE, L = V3.layout, { layer, id } = src;
  let it = (L[layer] || []).find((q) => q.id === id);
  if (!it) throw new Error(`V3.layout.${layer} 里没有 ${id}`);
  if (rect) it = Object.assign({}, it, { x0: rect[0], z0: rect[1], x1: rect[2], z1: rect[3] });
  const ctx = { studio: true, glowMat: (c, o) => Object.assign(new THREE.MeshBasicMaterial({ color: c }), { userData: { glow: Object.assign({}, o) } }), lamp: () => null, tickLights() {} };
  const saved = L[layer], E = h.window.__errors, err0 = E.length;
  h.capture = [];
  L[layer] = [it];
  let grp;
  try { grp = V3.furn.buildAll(ctx, layer); } finally { L[layer] = saved; }
  const cap = h.capture; h.capture = null;
  const errs = E.slice(err0).map(String);
  const o = grp && grp.children.find((c) => c.name === 'furn:' + id);
  if (!o) throw new Error(`体素家具 ${id} 没建出来` + (errs.length ? '：' + errs[0] : ''));
  if (keep) grp.updateMatrixWorld(true);
  else { o.removeFromParent(); o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.updateMatrixWorld(true); }
  return { o, cap, errors: errs, THREE };
}

// 第 5 轮（相框）：体素版不在布局里，规格的 f.make = V3.furn.makers 里的名字，直接建（正面朝 +z、原点在脚底中间），后面照第 1 轮的换法（rot + align）
function buildMade(f) {
  const h = v3(), V3 = h.V3, THREE = h.window.THREE, mk = V3.furn.makers && V3.furn.makers[f.make];
  if (!mk) throw new Error(`V3.furn.makers 里没有 ${f.make}（${f.id}）`);
  const ctx = { studio: true, glowMat: (c, o) => Object.assign(new THREE.MeshBasicMaterial({ color: c }), { userData: { glow: Object.assign({}, o) } }), lamp: () => null, tickLights() {} };
  const E = h.window.__errors, err0 = E.length;
  h.capture = [];
  let o = null;
  try { o = mk(ctx); } finally { /* 抓到的网格在 h.capture 里 */ }
  const cap = h.capture; h.capture = null;
  const errs = E.slice(err0).map(String);
  if (!o) throw new Error(`体素家具 ${f.id} 没建出来` + (errs.length ? '：' + errs[0] : ''));
  o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.updateMatrixWorld(true);
  return { o, cap, errors: errs, THREE };
}

// ---- 第 2 轮：「场景」换法（f.house）：体素在场景里的位置（buildAll 照 40-layout 摆好的）→ 朝北、主格的本地格子 ----
// 世界 → 本地（单位格，主格的西北下角是 0）：north (x−x0, z−z0)、south (x1+1−x, z1+1−z)、east (z−z0, x1+1−x)、west (z1+1−z, x−x0)，y−y0
// （和 42-house-mc 的 localCell 一样）。u = floor(本地 × 32 + 1e−6)：体素中心落在哪一格。
export function worldToU(f, THREE) {
  const { facing, xs, ys, zs } = f.house, m = new THREE.Matrix4(), x0 = xs[0], x1 = xs[1] + 1, z0 = zs[0], z1 = zs[1] + 1, y0 = ys[0];
  const rows = {
    north: [[1, 0, 0, -x0], [0, 0, 1, -z0]], south: [[-1, 0, 0, x1], [0, 0, -1, z1]],
    east: [[0, 0, 1, -z0], [-1, 0, 0, x1]], west: [[0, 0, -1, z1], [1, 0, 0, -x0]],
  }[facing];
  const [rx, rz] = rows, k = 32;
  m.set(rx[0] * k, rx[1] * k, rx[2] * k, rx[3] * k, 0, k, 0, -y0 * k, rz[0] * k, rz[1] * k, rz[2] * k, rz[3] * k, 0, 0, 0, 1);
  return m;
}
function voxelsScene(f) {
  const V3 = v3().V3, U = V3.util, fp = footprint(f), src = [];
  const NU = [fp.hi[0] * 32, fp.hi[1] * 32, fp.hi[2] * 32];
  const skipped = [], errors = [], keepOut = [], pinned = [], screens = [];
  let THREE = null;
  for (const [si, s] of [f.layout, ...(f.extra || [])].entries()) {
    const b = buildVoxel(f, s, { rect: si === 0 ? f.voxRect : null, keep: true }), o = b.o;
    THREE = b.THREE; errors.push(...b.errors);
    const W2U = worldToU(f, THREE), used = new Set();
    for (const { g, opt, r } of b.cap) {
      if (!visibleUpTo(r.root, o)) continue;
      const defs = opt.bones || [{ name: 'root' }];
      const alphaOf = defs.map((d) => { const m = r.meshes.find((q) => q.name === 'vox:' + d.name), mt = m && [].concat(m.material)[0]; return mt && mt.transparent ? +mt.opacity.toFixed(3) : 1; });
      const boneOn = defs.map((d, k) => !!r.bones[k] && visibleUpTo(r.bones[k], o));
      for (const m of r.meshes) used.add(m);
      const sc = opt.scale || 0.02, T = W2U.clone().multiply(r.root.matrixWorld), noise = opt.noise ?? 0.06, ao = opt.ao ?? 0.55;
      const { nx, ny, nz, o: org, col, tag, bone } = g;
      // 简化（furn-mc-lite）用：overlay 里的骨骼（网页叠上去的）记下名字；看不见的（空碗里的米饭）记成 keepOut
      const hid = defs.map((d, k) => (f.overlay || []).includes(d.name) && !boneOn[k]);
      const emit = (cell, put) => {
      // 直接换：每个轴只对着一个轴（转 90° 的倍数），一格不比 1/32 米大（地毯压扁了也行）
      const e = T.elements, cols = [0, 1, 2].map((c) => [e[c * 4] * sc, e[c * 4 + 1] * sc, e[c * 4 + 2] * sc]);
      const direct = cols.every((v) => v.filter((x) => Math.abs(x) > 1e-9).length === 1 && v.every((x) => Math.abs(x) <= 1 + 1e-9))
        && new Set(cols.map((v) => v.findIndex((x) => Math.abs(x) > 1e-9))).size === 3;
      const p = new THREE.Vector3();
      if (direct) {
        for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const id = cell(i, j, k); if (id < 0) continue;
          const x = i - org[0], y = j - org[1], z = k - org[2];
          p.set(x * sc, (y + 0.5) * sc, z * sc).applyMatrix4(T);
          put([Math.floor(p.x + 1e-6), Math.floor(p.y + 1e-6), Math.floor(p.z + 1e-6)], id, x, y, z, false);
        }
        return;
      }
      // 重新取样（转过的：睡帽、望远镜）：目标格子每格 27 个点，过 3 成算有，取最多的颜色
      const Ti = T.clone().invert(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const cx of [-org[0] - 0.5, nx - org[0] - 0.5]) for (const cy of [-org[1], ny - org[1]]) for (const cz of [-org[2] - 0.5, nz - org[2] - 0.5]) {
        p.set(cx * sc, cy * sc, cz * sc).applyMatrix4(T);
        [p.x, p.y, p.z].forEach((v, a) => { lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v); });
      }
      const N = 3, NEED = 10;
      for (let z = Math.floor(lo[2]); z <= Math.ceil(hi[2]); z++) for (let y = Math.floor(lo[1]); y <= Math.ceil(hi[1]); y++) for (let x = Math.floor(lo[0]); x <= Math.ceil(hi[0]); x++) {
        const hits = new Map(); let n = 0;
        for (let a = 0; a < N; a++) for (let bb = 0; bb < N; bb++) for (let d = 0; d < N; d++) {
          p.set(x + (a + 0.5) / N, y + (bb + 0.5) / N, z + (d + 0.5) / N).applyMatrix4(Ti);
          const ci = Math.round(p.x / sc) + org[0], cj = Math.floor(p.y / sc) + org[1], ck = Math.round(p.z / sc) + org[2];
          if (ci < 0 || cj < 0 || ck < 0 || ci >= nx || cj >= ny || ck >= nz) continue;
          const id = cell(ci, cj, ck); if (id < 0) continue;
          n++;
          const h = hits.get(col[id]); if (h) h.n++; else hits.set(col[id], { n: 1, id, s: [ci - org[0], cj - org[1], ck - org[2]] });
        }
        if (n < NEED) continue;
        let best = null; for (const h of hits.values()) if (!best || h.n > best.n) best = h;
        put([x, y, z], best.id, ...best.s, true);
      }
      };
      emit((i, j, k) => { const id = i + nx * (j + ny * k); return col[id] && bone[id] < defs.length && boneOn[bone[id]] ? id : -1; },
        (u, id, sx, sy, sz, rs) => src.push({ u, col: col[id] & 0xffffff, tag: g.tags[tag[id]] || '', alpha: alphaOf[bone[id]], noise: 1 + (U.hash3(sx, sy, sz) - 0.5) * 2 * noise, ao, rs, si,
          bone: (f.overlay || []).includes(defs[bone[id]].name) ? defs[bone[id]].name : undefined }));
      if (hid.some(Boolean)) emit((i, j, k) => { const id = i + nx * (j + ny * k); return col[id] && bone[id] < defs.length && hid[bone[id]] ? id : -1; }, (u) => keepOut.push(u));
    }
    o.traverse((m) => { if (m.isMesh && !used.has(m) && visibleUpTo(m, o)) skipped.push(m.name || m.userData.anchor || 'mesh'); });
    // overlay 里的平面（电脑屏、电视屏）：在 u 里的位置（ax = 法线的轴，sg = 正面朝哪边，D = 平面的坐标，r = 平面盖住的格子范围）
    o.traverse((m) => {
      if (!m.isMesh || used.has(m) || !(f.overlay || []).includes(m.name) || !(f.planes || []).includes(m.name)) return;
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox, T = W2U.clone().multiply(m.matrixWorld), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], p = new THREE.Vector3();
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        p.set(x, y, z).applyMatrix4(T); [p.x, p.y, p.z].forEach((v, a) => { lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v); });
      }
      const nrm = new THREE.Vector3(0, 0, 1).transformDirection(T), ax = [0, 1, 2].find((a) => hi[a] - lo[a] < 0.5), sg = Math.sign([nrm.x, nrm.y, nrm.z][ax]);
      screens.push({ name: m.name, ax, sg, D: (lo[ax] + hi[ax]) / 2, lo, hi, r: [0, 1, 2].map((a) => [Math.floor(lo[a] + 1e-3), Math.ceil(hi[a] - 1e-3) - 1]) });
    });
  }
  const vox = new Map(), clipped = { outside: 0, overlap: 0, where: new Map() };
  for (const v of src) {
    const u = v.u;
    if (u[0] < 0 || u[1] < 0 || u[2] < 0 || u[0] >= NU[0] || u[1] >= NU[1] || u[2] >= NU[2]) {
      clipped.outside++; const t = v.tag.split('/').pop(); clipped.where.set(t, (clipped.where.get(t) || 0) + 1); continue;
    }
    const k = key3(u);
    if (vox.has(k)) { clipped.overlap++; continue; }   // 先来的（主件、直接换的）优先
    vox.set(k, { u, col: v.col, tag: v.tag, alpha: v.alpha, noise: v.noise, ao: v.ao, bone: v.bone });
  }
  // 屏幕：平面后面最近的那层体素是屏幕面板（pinned，不许删；简化时它的正面挪到平面后面 2 毫米，见 furn-mc-lite）；
  // 面板前面那层空着的格子不许盖（keepOut）。看不见的骨骼（米饭）只算空着的格子（和碗壁重合的那几格本来就有体素）
  for (const sc of screens) {
    const at = (layer, fn) => { const r = sc.r.slice(); r[sc.ax] = [layer, layer]; for (let x = r[0][0]; x <= r[0][1]; x++) for (let y = r[1][0]; y <= r[1][1]; y++) for (let z = r[2][0]; z <= r[2][1]; z++) fn([x, y, z]); };
    const c0 = Math.floor(sc.D);
    let n = 0; at(c0, (u) => { if (vox.has(key3(u))) n++; });
    sc.panel = n ? c0 : c0 - sc.sg;                       // 平面在哪一格里：那格有体素（平面陷在面板里）就是它，没有就是后面那格
    at(sc.panel, (u) => { if (vox.has(key3(u))) pinned.push(u); });
    at(sc.panel + sc.sg, (u) => { if (!vox.has(key3(u))) keepOut.push(u); });
  }
  const keep = [...new Map(keepOut.filter((u) => !vox.has(key3(u))).map((u) => [u.join(), u])).values()];
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of vox.values()) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v.u[a]); mx[a] = Math.max(mx[a], v.u[a] + 1); }
  const unexpected = skipped.filter((n) => !(f.planes || []).includes(n));
  return { vox, fp, off: null, clipped, skipped, unexpected, errors, scene: true, keepOut: keep, pinned, screens,
    bounds: { min: mn.map((v) => v / 2), max: mx.map((v) => v / 2) }, voxSize: [0, 1, 2].map((a) => (mx[a] - mn[a]) / 32) };
}

const visibleUpTo = (n, top) => { for (let p = n; p; p = p.parent) { if (!p.visible) return false; if (p === top) return true; } return true; };

// 体素家具 → { vox: Map(key → 体素), n, clipped, skipped, info }；体素：{ u:[x,y,z], col, tag, alpha, noise, ao }
export function voxelsOf(f) {
  if (f.vox) return voxelsPart(f);
  if (f.house) return voxelsScene(f);
  const { o, cap, errors, THREE } = buildVoxel(f), V3 = v3().V3, U = V3.util;
  const fp = footprint(f), rot = f.rot || 0;
  const R = (x, z) => (rot === 180 ? [-x, -z] : rot === 90 ? [-z, x] : rot === 270 ? [z, -x] : [x, z]);
  const inv = o.matrixWorld.clone().invert();
  const src = [];               // 体素：设计坐标 (x, y, z) 在家具局部坐标里（1/32 米的格），先收齐再定平移
  const skipped = [], used = new Set();
  for (const c of cap) {
    const { g, opt, r } = c;
    if (!visibleUpTo(r.root, o)) continue;   // 整个不显示（床的 sleeping 那一套）
    const defs = opt.bones || [{ name: 'root' }];
    const alphaOf = defs.map((d, b) => {
      const m = r.meshes.find((q) => q.name === 'vox:' + d.name);
      const mt = m && [].concat(m.material)[0];
      return mt && mt.transparent ? +mt.opacity.toFixed(3) : 1;
    });
    const boneOn = defs.map((d, b) => !!r.bones[b] && visibleUpTo(r.bones[b], o));
    for (const m of r.meshes) used.add(m);
    const sc = opt.scale || 0.02, M = inv.clone().multiply(r.root.matrixWorld);
    const ident = Math.abs(sc - S) < 1e-9 && M.elements.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9);
    const noise = opt.noise ?? 0.06, ao = opt.ao ?? 0.55;
    const { nx, ny, nz, o: org, col, tag, bone } = g;
    const cell = (i, j, k) => { const id = i + nx * (j + ny * k); return col[id] && bone[id] < defs.length && boneOn[bone[id]] ? id : -1; };
    const put = (x, y, z, id, sx, sy, sz) => src.push({ x, y, z, col: col[id] & 0xffffff, tag: g.tags[tag[id]] || '', alpha: alphaOf[bone[id]],
      noise: 1 + (U.hash3(sx, sy, sz) - 0.5) * 2 * noise, ao, rs: !ident });
    if (ident) {
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const id = cell(i, j, k); if (id < 0) continue;
        const x = i - org[0], y = j - org[1], z = k - org[2];
        put(x, y, z, id, x, y, z);
      }
      continue;
    }
    // 重新取样：源格子 (cx, cy, cz) 的中心在 root 局部坐标 (cx·sc, (cy+0.5)·sc, cz·sc)
    const Mi = M.clone().invert(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], p = new THREE.Vector3();
    for (const cx of [-org[0] - 0.5, nx - org[0] - 0.5]) for (const cy of [-org[1], ny - org[1]]) for (const cz of [-org[2] - 0.5, nz - org[2] - 0.5]) {
      p.set(cx * sc, cy * sc, cz * sc).applyMatrix4(M);
      const v = [p.x / S, p.y / S, p.z / S];
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v[a]); hi[a] = Math.max(hi[a], v[a]); }
    }
    const N = 3, NEED = 10;
    for (let z = Math.floor(lo[2]); z <= Math.ceil(hi[2]); z++) for (let y = Math.floor(lo[1]) - 1; y <= Math.ceil(hi[1]); y++) for (let x = Math.floor(lo[0]); x <= Math.ceil(hi[0]); x++) {
      const hits = new Map();
      let n = 0;
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) for (let d = 0; d < N; d++) {
        p.set((x - 0.5 + (a + 0.5) / N) * S, (y + (b + 0.5) / N) * S, (z - 0.5 + (d + 0.5) / N) * S).applyMatrix4(Mi);
        const ci = Math.round(p.x / sc) + org[0], cj = Math.floor(p.y / sc) + org[1], ck = Math.round(p.z / sc) + org[2];
        if (ci < 0 || cj < 0 || ck < 0 || ci >= nx || cj >= ny || ck >= nz) continue;
        const id = cell(ci, cj, ck); if (id < 0) continue;
        n++;
        const e = hits.get(col[id]); if (e) e.n++; else hits.set(col[id], { n: 1, id, s: [ci - org[0], cj - org[1], ck - org[2]] });
      }
      if (n < NEED) continue;
      let best = null; for (const e of hits.values()) if (!best || e.n > best.n) best = e;
      put(x, y, z, best.id, ...best.s);
    }
  }
  o.traverse((m) => { if (m.isMesh && !used.has(m) && visibleUpTo(m, o)) skipped.push(m.name || m.userData.anchor || 'mesh'); });
  // 转向 + 平移
  const rotated = src.map((v) => { const [x, z] = R(v.x, v.z); return Object.assign(v, { rx: x, rz: z }); });
  const off = [0, 0, 0];
  for (const a of [0, 2]) {
    const lo = fp.lo[a] * 32, hi = fp.hi[a] * 32, key = a === 0 ? 'rx' : 'rz';
    if (f.align === 'back' && a === 2) { let mx = -Infinity; for (const v of rotated) if (!v.rs) mx = Math.max(mx, v[key]); off[a] = hi - 1 - mx; }
    else off[a] = (lo + hi) / 2;
  }
  const vox = new Map(), clipped = { outside: 0, overlap: 0, where: new Map() }, Hy = fp.hi[1] * 32, ylo = fp.lo[1] * 32;
  const inside = (u) => u[0] >= fp.lo[0] * 32 && u[0] < fp.hi[0] * 32 && u[1] >= ylo && u[1] < Hy && u[2] >= fp.lo[2] * 32 && u[2] < fp.hi[2] * 32;
  for (const v of rotated) {
    const u = [v.rx + off[0], v.y, v.rz + off[2]];
    if (!inside(u)) { clipped.outside++; const t = v.tag.split('/').pop(); clipped.where.set(t, (clipped.where.get(t) || 0) + 1); continue; }
    const k = key3(u);
    if (vox.has(k)) { clipped.overlap++; continue; }   // 先来的（主网格）优先：重新取样的睡帽不压住枕头
    vox.set(k, { u, col: v.col, tag: v.tag, alpha: v.alpha, noise: v.noise, ao: v.ao });
  }
  const mn = [Infinity, Infinity, Infinity], mxx = [-Infinity, -Infinity, -Infinity];
  for (const v of vox.values()) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v.u[a]); mxx[a] = Math.max(mxx[a], v.u[a] + 1); }
  return { vox, fp, off, clipped, skipped, errors,
    bounds: { min: mn.map((v) => v / 2), max: mxx.map((v) => v / 2) },          // MC 像素（主格坐标）
    voxSize: [0, 1, 2].map((a) => (mxx[a] - mn[a]) / 32) };                     // 体素版的外形（米）
}

export const key3 = (u) => (u[0] + 512) * 1048576 + (u[1] + 512) * 1024 + (u[2] + 512);

// 体素版的一个点（家具局部坐标，米，正面 +z）→ 朝北、主格方块内（单位格），和 voxelsOf 一样的转向、平移
export function voxPointToMc(f, off, p) {
  const rot = f.rot || 0, x = p[0] / S, z = p[2] / S;
  const [rx, rz] = rot === 180 ? [-x, -z] : rot === 90 ? [-z, x] : rot === 270 ? [z, -x] : [x, z];
  // 格子 v 占 u = v + off 的那一格：中心在 MC 像素 (v + off)/2 + 0.25
  return [((rx + off[0]) / 2 + 0.25) / 16, p[1] / S / 2 / 16, ((rz + off[2]) / 2 + 0.25) / 16];
}

// ---- 第 3 轮：屋外的小物件，体素在场景部件里（55-house-detail、56-furn-beach、58-plants；规格的 f.vox） ----
// 在 Node 里把这 3 个场景部件建一次（ctx.studio，和工作台一样），抓下建的时候用到的体素网格：
//   V3.vox.build（55 带骨骼的、56-furn-beach）、V3.vox.mesh（58 的 voxGroup）、V3.vox.Grid（55 不带骨骼的走自己的 gmesh：按网格外包盒对上网格）。
// 每个网格算出「体素坐标（米，原点 = 网格的设计原点，体素中心 (i, j + 0.5, k) × 格长）→ 世界」的矩阵，再换到朝北模型的 u：
//   不带 place：世界 → u 和第 2 轮的「场景」换法一样（worldToU）；
//   place：物体自己的坐标 → u：x、z 转 180°（正面转到北边），原点放到 at（默认占的格子正中间），y 不动（物体脚底 = 方块底）；straight 去掉倾斜。
// 比 1/32 米细的体素（饮料 1/128 米）：每个目标格子里数一数，过 1/20 才算有，取最多的颜色；粗的（遮阳伞 1/16 米）一个体素填 2×2×2 格。
// 伸出格子（f.reach）：格子外面、MC 允许的 −16..32 像素以内的留着（归最近的那格），别的照旧裁掉。
export const PART_MODULES = ['03-vox', '40-layout', '44-furn-mc', '50-scene', '55-house-detail', '56-furn-beach', '56-furn-ground', '58-plants'];
export const PART_IDS = ['house-detail', 'furn-beach', 'plants'];
let PH = null;
export function v3parts() {
  if (PH) return PH;
  const srcDir = process.env.FURN_MC_SRC ? path.resolve(process.env.FURN_MC_SRC) : undefined;
  const h = loadV3(PART_MODULES, { three: 'real', srcDir, document: FAKE_DOC }), V3 = h.V3, THREE = h.window.THREE;
  const grids = [], builds = [], meshes = [];
  let inBuild = 0;
  const G0 = V3.vox.Grid;
  V3.vox.Grid = class extends G0 { constructor(...a) { super(...a); grids.push(this); } };
  const b0 = V3.vox.build, m0 = V3.vox.mesh;
  V3.vox.build = (g, opt = {}) => { inBuild++; try { const r = b0(g, opt); builds.push({ g, opt, r }); return r; } finally { inBuild--; } };
  V3.vox.mesh = (g, opt = {}) => { const out = m0(g, opt); if (!inBuild) meshes.push({ g, opt, out }); return out; };
  const root = new THREE.Group(), ctx = V3.scene.ctx(root, { studio: true }), outs = {}, E = h.window.__errors, err0 = E.length;
  for (const id of PART_IDS) {
    const p = V3.scene.parts.find((q) => q.id === id);
    if (!p) throw new Error(`场景部件 ${id} 没加载`);
    const g = new THREE.Group(); g.name = 'part:' + id;
    for (const o of [].concat(p.build(ctx) || [])) g.add(o);
    g.updateMatrixWorld(true);
    outs[id] = g;
  }
  PH = { h, V3, THREE, grids, builds, meshes, outs, errors: E.slice(err0).map(String), gmesh: new Map() };
  // 55 不带骨骼的（gmesh）：顶点就是体素坐标（1/32 米），按「填了的体素的外包盒」对上抓到的 Grid；一样大的（两个花箱、两盏壁灯）按建的先后
  const taken = new Set([...builds.map((b) => b.g), ...meshes.map((b) => b.g)]), boxOf = new Map(), S = 1 / 32;
  for (const g of grids) {
    if (taken.has(g)) continue;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      if (!g.col[i + g.nx * (j + g.ny * k)]) continue;
      const v = [i, j, k]; for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v[a]); hi[a] = Math.max(hi[a], v[a]); }
    }
    if (lo[0] !== Infinity) boxOf.set(g, [(lo[0] - g.o[0] - 0.5) * S, (lo[1] - g.o[1]) * S, (lo[2] - g.o[2] - 0.5) * S, (hi[0] + 1 - g.o[0] - 0.5) * S, (hi[1] + 1 - g.o[1]) * S, (hi[2] + 1 - g.o[2] - 0.5) * S]);
  }
  const usedMesh = new Set([...builds.flatMap((b) => b.r.meshes)]), geoms = new Set(meshes.flatMap((b) => b.out.map((q) => q.geometry))), assigned = new Set();
  for (const id of PART_IDS) outs[id].traverse((m) => {
    if (!m.isMesh || usedMesh.has(m) || geoms.has(m.geometry) || !m.userData.faceTags || /^vox:/.test(m.name)) return;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox, got = [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z];
    const g = grids.find((q) => !assigned.has(q) && boxOf.has(q) && boxOf.get(q).every((v, a) => Math.abs(v - got[a]) < 1e-5));
    if (g) { assigned.add(g); PH.gmesh.set(m, g); }
  });
  return PH;
}
// 场景部件里的物体（名字）
export function partObject(part, name) {
  const P = v3parts(), g = P.outs[part];
  if (!g) throw new Error(`没有场景部件 ${part}`);
  let o = null;
  g.traverse((m) => { if (!o && m.name === name) o = m; });
  if (!o) throw new Error(`场景部件 ${part} 里没有 ${name}`);
  return o;
}
const isUnder = (n, top) => { for (let p = n; p; p = p.parent) if (p === top) return true; return false; };
// 物体下面的体素网格：{ caps: [{ g, sc, defs, T（体素坐标 → 世界）, boneOn, alphaOf }], skipped（没对上体素网格的网格名） }
export function capturesOf(o) {
  const P = v3parts(), THREE = P.THREE, out = [], used = new Set();
  const trans = (m, pv, sc) => m.clone().multiply(new THREE.Matrix4().makeTranslation(-pv[0] * sc, -pv[1] * sc, -pv[2] * sc));
  const alphaFrom = (mesh) => { const mt = mesh && [].concat(mesh.material)[0]; return mt && mt.transparent ? +mt.opacity.toFixed(3) : 1; };
  for (const { g, opt, r } of P.builds) {
    if (!isUnder(r.root, o)) continue;
    const defs = opt.bones || [{ name: 'root', pivot: [0, 0, 0] }], sc = opt.scale || 0.02;
    for (const m of r.meshes) used.add(m);
    out.push({ g, sc, defs, T: trans(r.root.matrixWorld, defs[0].pivot || [0, 0, 0], sc), noise: opt.noise ?? 0.06, ao: opt.ao ?? 0.55,
      boneOn: defs.map((d, k) => !!r.bones[k] && visibleUpTo(r.bones[k], o)),
      alphaOf: defs.map((d) => alphaFrom(r.meshes.find((q) => q.name === 'vox:' + d.name))) });
  }
  const meshOf = new Map();
  o.traverse((m) => { if (m.isMesh) meshOf.set(m.geometry, m); });
  for (const { g, opt, out: res } of P.meshes) {
    const hit = res.map((q) => ({ q, m: meshOf.get(q.geometry) })).filter((x) => x.m);
    if (!hit.length) continue;
    const defs = opt.bones || [{ name: 'root', pivot: [0, 0, 0] }], sc = opt.scale || 0.02, { q, m } = hit[0];
    for (const x of hit) used.add(x.m);
    const alphaOf = defs.map((d, k) => { const x = hit.find((y) => y.q.bone === k); return x ? alphaFrom(x.m) : 1; });
    out.push({ g, sc, defs, T: trans(m.matrixWorld, defs[q.bone].pivot, sc), noise: opt.noise ?? 0.06, ao: opt.ao ?? 0.55, part: (m.userData.faceTags || []).find(Boolean) || '',
      boneOn: defs.map((d, k) => { const x = hit.find((y) => y.q.bone === k); return !x || visibleUpTo(x.m, o); }), alphaOf });
  }
  // 55 不带骨骼的（gmesh）：v3parts 里已经按外包盒对上了 Grid
  o.traverse((m) => {
    if (!m.isMesh || used.has(m) || !P.gmesh.has(m)) return;
    used.add(m);
    out.push({ g: P.gmesh.get(m), sc: 1 / 32, defs: [{ name: 'root', pivot: [0, 0, 0] }], T: m.matrixWorld.clone(), noise: 0.05, ao: 0.5, boneOn: [true], alphaOf: [1], gmesh: true });
  });
  const skipped = [];
  o.traverse((m) => { if (m.isMesh && !used.has(m) && visibleUpTo(m, o)) skipped.push(m.name || m.userData.anchor || 'mesh'); });
  return { caps: out, skipped };
}
// place 的矩阵：物体自己的坐标（米）→ u（整格体素的中心落在格子中间，floor 就是格子）
function placeToU(THREE, at) {
  return new THREE.Matrix4().set(-32, 0, 0, at[0] + 0.5, 0, 32, 0, 0, 0, 0, -32, at[1] + 0.5, 0, 0, 0, 1);
}
// 一个网格的体素 → u（M：体素坐标（米）→ u 空间）；put(u, 体素 id, 源坐标 x, y, z, 重新取样过)
function emitVoxels(THREE, cap, M, put) {
  const { g, sc, defs, boneOn } = cap, { nx, ny, nz, o: org, col, bone } = g;
  const cell = (i, j, k) => { const id = i + nx * (j + ny * k), b = bone ? bone[id] : 0; return col[id] && b < defs.length && boneOn[b] ? id : -1; };
  const e = M.elements, cols = [0, 1, 2].map((c) => [e[c * 4] * sc, e[c * 4 + 1] * sc, e[c * 4 + 2] * sc]);
  const axisOf = cols.map((v) => (v.filter((x) => Math.abs(x) > 1e-9).length === 1 ? v.findIndex((x) => Math.abs(x) > 1e-9) : -1));
  const aligned = axisOf.every((a) => a >= 0) && new Set(axisOf).size === 3, mag = cols.map((v, c) => Math.abs(v[axisOf[c]] || 0));
  const p = new THREE.Vector3();
  if (aligned && mag.every((m) => Math.abs(m - mag[0]) < 1e-9) && (mag[0] <= 1 + 1e-9 || Math.abs(mag[0] - Math.round(mag[0])) < 1e-9)) {
    const k = mag[0];
    if (k > 1 + 1e-9) {                              // 粗的：一个体素填 n³ 格
      const n = Math.round(k);
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const id = cell(x, y, z); if (id < 0) continue;
        const sx = x - org[0], sy = y - org[1], sz = z - org[2];
        p.set(sx * sc, (sy + 0.5) * sc, sz * sc).applyMatrix4(M);
        const b = [p.x, p.y, p.z].map((v) => Math.floor(v - n / 2 + 0.5 + 1e-6));
        for (let a = 0; a < n; a++) for (let bb = 0; bb < n; bb++) for (let c = 0; c < n; c++) put([b[0] + a, b[1] + bb, b[2] + c], id, sx, sy, sz, false);
      }
      return;
    }
    const fine = k < 1 - 1e-9, acc = fine ? new Map() : null;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const id = cell(x, y, z); if (id < 0) continue;
      const sx = x - org[0], sy = y - org[1], sz = z - org[2];
      p.set(sx * sc, (sy + 0.5) * sc, sz * sc).applyMatrix4(M);
      const u = [Math.floor(p.x + 1e-6), Math.floor(p.y + 1e-6), Math.floor(p.z + 1e-6)];
      if (!fine) { put(u, id, sx, sy, sz, false); continue; }
      const kk = key3(u); let a = acc.get(kk);
      if (!a) acc.set(kk, a = { u, n: 0, by: new Map() });
      a.n++; const c = col[id], hh = a.by.get(c); if (hh) hh.n++; else a.by.set(c, { n: 1, id, s: [sx, sy, sz] });
    }
    if (fine) {
      const need = Math.max(1, Math.round(1 / (k * k * k) / 20));   // 过 1/20 算有（吸管、小伞的杆子也留得住）
      for (const a of acc.values()) {
        if (a.n < need) continue;
        let best = null; for (const hh of a.by.values()) if (!best || hh.n > best.n) best = hh;
        put(a.u, best.id, ...best.s, true);
      }
    }
    return;
  }
  // 重新取样（转过的：躺椅的靠背）：目标格子每格 27 个点，过 3 成算有，取最多的颜色
  const Mi = M.clone().invert(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const cx of [-org[0] - 0.5, nx - org[0] - 0.5]) for (const cy of [-org[1], ny - org[1]]) for (const cz of [-org[2] - 0.5, nz - org[2] - 0.5]) {
    p.set(cx * sc, cy * sc, cz * sc).applyMatrix4(M);
    [p.x, p.y, p.z].forEach((v, a) => { lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v); });
  }
  const N = 3, NEED = 10;
  for (let z = Math.floor(lo[2]); z <= Math.ceil(hi[2]); z++) for (let y = Math.floor(lo[1]); y <= Math.ceil(hi[1]); y++) for (let x = Math.floor(lo[0]); x <= Math.ceil(hi[0]); x++) {
    const hits = new Map(); let n = 0;
    for (let a = 0; a < N; a++) for (let bb = 0; bb < N; bb++) for (let d = 0; d < N; d++) {
      p.set(x + (a + 0.5) / N, y + (bb + 0.5) / N, z + (d + 0.5) / N).applyMatrix4(Mi);
      const ci = Math.round(p.x / sc) + org[0], cj = Math.floor(p.y / sc) + org[1], ck = Math.round(p.z / sc) + org[2];
      if (ci < 0 || cj < 0 || ck < 0 || ci >= nx || cj >= ny || ck >= nz) continue;
      const id = cell(ci, cj, ck); if (id < 0) continue;
      n++;
      const hh = hits.get(col[id]); if (hh) hh.n++; else hits.set(col[id], { n: 1, id, s: [ci - org[0], cj - org[1], ck - org[2]] });
    }
    if (n < NEED) continue;
    let best = null; for (const hh of hits.values()) if (!best || hh.n > best.n) best = hh;
    put([x, y, z], best.id, ...best.s, true);
  }
}
// 一个来源的矩阵：W2U（不带 place）或 P2U（place）；objToWorld = 放进房子以后物体的世界矩阵（预览图里摆体素版用）
export function sourceMatrices(f, s) {
  const P = v3parts(), THREE = P.THREE, o = partObject(s.part, s.name), fp = footprint(f), W2U = worldToU(f, THREE);
  if (!s.place) return { o, W2U, objToWorld: null };
  const at = s.at || [(fp.lo[0] + fp.hi[0]) * 16, (fp.lo[2] + fp.hi[2]) * 16], P2U = placeToU(THREE, at);
  return { o, W2U, P2U, at, objToWorld: W2U.clone().invert().multiply(P2U) };
}
export function voxelsPart(f) {
  const P = v3parts(), THREE = P.THREE, U = P.V3.util, fp = footprint(f), src = [], skipped = [], errors = P.errors.slice();
  const NU = [fp.hi[0] * 32, fp.hi[1] * 32, fp.hi[2] * 32];
  for (const [si, s] of f.vox.entries()) {
    const sm = sourceMatrices(f, s), o = sm.o, inv = o.matrixWorld.clone().invert(), r = capturesOf(o);
    skipped.push(...r.skipped);
    for (const cap of r.caps) {
      let M;
      if (!s.place) M = sm.W2U.clone().multiply(cap.T);
      else {
        let L = inv.clone().multiply(cap.T);
        if (s.straight) { const pp = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(); L.decompose(pp, q, sc); L = new THREE.Matrix4().compose(pp, new THREE.Quaternion(), sc); }
        M = sm.P2U.clone().multiply(L);
      }
      const g = cap.g;
      emitVoxels(THREE, cap, M, (u, id, sx, sy, sz, rs) => {
        const b = g.bone ? g.bone[id] : 0;
        src.push({ u, col: g.col[id] & 0xffffff, tag: g.tags[g.tag[id]] || cap.part || '', alpha: cap.alphaOf[b] ?? 1, noise: 1 + (U.hash3(sx, sy, sz) - 0.5) * 2 * cap.noise, ao: cap.ao, rs, si,
          bone: cap.defs[b] && (f.overlay || []).includes(cap.defs[b].name) ? cap.defs[b].name : undefined });
      });
    }
  }
  const vox = new Map(), clipped = { outside: 0, overlap: 0, where: new Map() };
  const LO = [0, 1, 2].map((a) => (f.reach ? -32 : 0)), HI = [0, 1, 2].map((a) => (f.reach ? NU[a] + 32 : NU[a]));
  let reach = 0;
  for (const v of src) {
    const u = v.u;
    if ([0, 1, 2].some((a) => u[a] < LO[a] || u[a] >= HI[a])) {
      clipped.outside++; const t = v.tag.split('/').pop(); clipped.where.set(t, (clipped.where.get(t) || 0) + 1); continue;
    }
    const k = key3(u);
    if (vox.has(k)) { clipped.overlap++; continue; }   // 先来的优先（花箱：箱体先，花后）
    if ([0, 1, 2].some((a) => u[a] < 0 || u[a] >= NU[a])) reach++;
    vox.set(k, { u, col: v.col, tag: v.tag, alpha: v.alpha, noise: v.noise, ao: v.ao, bone: v.bone });
  }
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of vox.values()) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v.u[a]); mx[a] = Math.max(mx[a], v.u[a] + 1); }
  const unexpected = skipped.filter((n) => !(f.planes || []).includes(n));
  return { vox, fp, off: null, clipped, skipped, unexpected, errors, scene: true, part: true, reach, keepOut: [], pinned: [], screens: [],
    bounds: { min: mn.map((v) => v / 2), max: mx.map((v) => v / 2) }, voxSize: [0, 1, 2].map((a) => (mx[a] - mn[a]) / 32) };
}
