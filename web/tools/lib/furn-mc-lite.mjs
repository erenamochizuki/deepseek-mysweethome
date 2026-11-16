// web/tools/lib/furn-mc-lite.mjs — 简化：一格的元素超过 LIMIT（32）个时，把这一格合成 ≤ 32 个元素（docs/FURNITURE.md 第 10 节）。
//
// 用户 2026-11-07：cube 太多 MC 负担不了，每格 ≤ 32。体素版不改；这里只管「体素 → 元素」怎么合。
// 1. 分种类：透明度（玻璃单独）× 分组。受保护的分组不合、不删（元素原样留着）：
//      solid（f.solid 的部件，碰撞只算它们，比如遮阳伞的伞杆；别的元素可以盖住它）、
//      glow（f.glow 的部件，发光的灯罩）、overlay（f.overlay 里网页要叠上去的骨骼，比如台灯的灯泡；别的元素不许盖住它们）。
//    不许盖的地方（keepOut）：overlay 里看不见的骨骼（空碗里的米饭）、屏幕平面所在的那层（电脑屏、电视屏）；
//    不许删的（pinned）：屏幕平面后面那层（屏幕面板，平面不悬空）；简化完，盖着屏幕面板的元素正面挪到平面后面 2 毫米
//    （体素换到 MC 格子时取整，原来电脑屏的平面陷在 MC 的玻璃里 7 毫米、电视屏的平面浮在面板前面 17 毫米）。
// 2. 先不分部件精确合成长方块（和老做法一样的「试 6 个方向长」），够了就停。
// 3. 不够就贪心：每一步在「两块合成它们的外包盒」（代价 = 多盖进去的空气，体素个数）和「删掉一块」
//   （代价 = 只有它盖着的体素个数 − 只有它盖着的空气）里挑每少一个元素代价最小的，直到 ≤ LIMIT。
//    合出来的外包盒里不许有别的种类的体素（玻璃、受保护的）；顺手吞掉被它整个包住的同种块。
//    删的时候整格的外包盒不许缩超过 1 个 MC 像素（2 个体素）：碰撞盒、选框不变小。
// 4. 面：像素 = 从这个面往里走，碰到的第一个同种体素的颜色（× 明暗噪点 × AO，和老做法一样），
//    整列都没有体素的像素透明（alpha 0；MC 26.1 按面的 uv 那块贴图有没有透明像素自动放进 cutout 层，网页 14-mcjar 一样）：
//    合起来的块里原来是空的地方（椅背栏杆的缝、花丛的空隙、伞面圆边外面的角）看过去还是空的。
//    这个面外面贴着别的不透明体素、并且那个体素有元素盖着的像素算「看不见」；整面看不见的面不要。
import { UVAX, NORMALS, aoOf, lin, srgb } from './furn-mc-bb.mjs';

export const LIMIT = 32;
// 丢一个体素比多盖一个空气难看（零件断开、悬空）：删的代价 × LOSS
export const SCREEN_GAP = 0.064;
export const LOSS = +(process.env.FURN_LITE_LOSS || 6);
const ORDERS = [[0, 2, 1], [2, 0, 1], [0, 1, 2], [1, 0, 2], [1, 2, 0], [2, 1, 0]];
const SCANS = [[0, 2, 1], [2, 0, 1], [0, 1, 2]];
const lastTag = (t) => String(t || '').split('/').pop();

// 体素的分组：'' = 一般；'solid:…' / 'glow:…' / 'overlay:…' = 受保护
function groupOf(f, v) {
  const t = lastTag(v.tag);
  if (v.bone && (f.overlay || []).includes(v.bone)) return 'overlay:' + v.bone;
  if ((f.glow || []).includes(t)) return 'glow:' + t;
  if ((f.solid || []).includes(t)) return 'solid:' + t;
  return '';
}

// 3D 前缀和：sum(lo, hi) = [lo, hi) 里 1 的个数（局部坐标）
function prefix(mask, n) {
  const S1 = n + 1, S2 = S1 * S1, S = new Int32Array(S1 * S2);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (x + 1) + S1 * (y + 1) + S2 * (z + 1);
    S[i] = mask[x + n * (y + n * z)] + S[i - 1] + S[i - S1] + S[i - S2] - S[i - 1 - S1] - S[i - 1 - S2] - S[i - S1 - S2] + S[i - 1 - S1 - S2];
  }
  return (lo, hi) => {
    if (hi[0] <= lo[0] || hi[1] <= lo[1] || hi[2] <= lo[2]) return 0;
    const a = (x, y, z) => S[x + S1 * y + S2 * z];
    return a(hi[0], hi[1], hi[2]) - a(lo[0], hi[1], hi[2]) - a(hi[0], lo[1], hi[2]) - a(hi[0], hi[1], lo[2])
      + a(lo[0], lo[1], hi[2]) + a(lo[0], hi[1], lo[2]) + a(hi[0], lo[1], lo[2]) - a(lo[0], lo[1], lo[2]);
  };
}
const vol = (b) => (b.hi[0] - b.lo[0]) * (b.hi[1] - b.lo[1]) * (b.hi[2] - b.lo[2]);
const inside = (a, b) => a.lo.every((v, k) => v >= b.lo[k]) && a.hi.every((v, k) => v <= b.hi[k]);
const touch = (a, b) => a.lo.every((v, k) => v < b.hi[k]) && a.hi.every((v, k) => v > b.lo[k]);

// 一格 → { boxes: [{ lo, hi（u）, cls, tag, kind }], stats }。G = furn-mc-bb 的 denseGrid；vr = furn-mc-vox 的结果；ci = 第几格
export function simplifyCell(G, f, vr, ci, opt = {}) {
  const limit = opt.limit ?? LIMIT, c = f.cells[ci], m = G.reach ? 32 : 0, n = 32 + 2 * m, N = n * n * n;
  const O = c.offset.map((v) => v * 32 - m);
  const L = (x, y, z) => x + n * (y + n * z);
  const local = (u) => { const x = u[0] - O[0], y = u[1] - O[1], z = u[2] - O[2]; return x < 0 || y < 0 || z < 0 || x >= n || y >= n || z >= n ? -1 : L(x, y, z); };
  // ---- 1. 种类 ----
  const rows = [];
  for (const v of vr.vox.values()) {
    const li = local(v.u); if (li < 0) continue;
    const gi = G.idx(...v.u);
    if (G.own && G.own[gi] !== ci) continue;
    rows.push([li, gi, G.cls[gi] + '|' + groupOf(f, v)]);
  }
  const names = [...new Set(rows.map((r) => r[2]))].sort(), K = names.length;
  const kinds = names.map((nm) => { const [cls, grp] = nm.split('|'); return { cls: +cls, grp, prot: grp !== '', hideOthers: /^(overlay|glow):/.test(grp) }; });
  const kindAt = new Uint8Array(N), gAt = new Int32Array(N).fill(-1);
  for (const [li, gi, nm] of rows) { kindAt[li] = names.indexOf(nm) + 1; gAt[li] = gi; }
  const keep = new Uint8Array(N), pin = new Uint8Array(N);
  for (const u of vr.keepOut || []) { const li = local(u); if (li >= 0) keep[li] = 1; }
  for (const u of vr.pinned || []) { const li = local(u); if (li >= 0 && kindAt[li]) pin[li] = 1; }
  const filled = [], forbid = [];
  for (let k = 1; k <= K; k++) {
    const fm = new Uint8Array(N), bm = new Uint8Array(N), me = kinds[k - 1];
    for (let i = 0; i < N; i++) {
      const q = kindAt[i];
      if (q === k) fm[i] = 1;
      else if (keep[i] || (q && (kinds[q - 1].cls !== me.cls || kinds[q - 1].hideOthers))) bm[i] = 1;
    }
    filled[k] = prefix(fm, n); forbid[k] = prefix(bm, n);
  }
  // ---- 2. 精确合（和老做法一样：每个起点试 6 个方向，取体积最大的；3 种扫描顺序取最少的）----
  let boxes = null;
  for (const scan of SCANS) {
    const used = new Uint8Array(N), out = [], p = [0, 0, 0], q = [0, 0, 0], [s0, s1, s2] = scan;
    const ok = (x, y, z, k) => x < n && y < n && z < n && kindAt[L(x, y, z)] === k && !used[L(x, y, z)];
    for (p[s2] = 0; p[s2] < n; p[s2]++) for (p[s1] = 0; p[s1] < n; p[s1]++) for (p[s0] = 0; p[s0] < n; p[s0]++) {
      const i = L(p[0], p[1], p[2]), k = kindAt[i];
      if (!k || used[i]) continue;
      let best = null, bv = 0;
      for (const ord of ORDERS) {
        const len = [1, 1, 1];
        for (let t = 0; t < 3; t++) {
          const a = ord[t], b = ord[(t + 1) % 3], cc = ord[(t + 2) % 3];
          for (;;) {
            let all = true;
            for (let i2 = 0; i2 < len[b] && all; i2++) for (let j2 = 0; j2 < len[cc] && all; j2++) {
              q[a] = p[a] + len[a]; q[b] = p[b] + i2; q[cc] = p[cc] + j2;
              if (!ok(q[0], q[1], q[2], k)) all = false;
            }
            if (!all) break;
            len[a]++;
          }
        }
        const v = len[0] * len[1] * len[2];
        if (v > bv) { bv = v; best = len; }
      }
      for (let x = 0; x < best[0]; x++) for (let y = 0; y < best[1]; y++) for (let z = 0; z < best[2]; z++) used[L(p[0] + x, p[1] + y, p[2] + z)] = 1;
      out.push({ lo: p.slice(), hi: [p[0] + best[0], p[1] + best[1], p[2] + best[2]], k });
    }
    if (!boxes || out.length < boxes.length) boxes = out;
  }
  const exact = boxes.length;
  // ---- 3. 贪心合 / 删 ----
  const NB = boxes.length, alive = new Uint8Array(NB).fill(1);
  const cov = []; for (let k = 1; k <= K; k++) cov[k] = new Uint16Array(N);
  const each = (b, fn) => { for (let z = b.lo[2]; z < b.hi[2]; z++) for (let y = b.lo[1]; y < b.hi[1]; y++) { let i = L(b.lo[0], y, z); for (let x = b.lo[0]; x < b.hi[0]; x++, i++) fn(i); } };
  const addCov = (b, d) => { const cv = cov[b.k]; each(b, (i) => { cv[i] += d; }); };
  for (const b of boxes) addCov(b, 1);
  const air = (b) => vol(b) - filled[b.k](b.lo, b.hi);
  const union = (a, b) => ({ lo: [0, 1, 2].map((t) => Math.min(a.lo[t], b.lo[t])), hi: [0, 1, 2].map((t) => Math.max(a.hi[t], b.hi[t])), k: a.k });
  const inter = (a, b) => ({ lo: [0, 1, 2].map((t) => Math.max(a.lo[t], b.lo[t])), hi: [0, 1, 2].map((t) => Math.min(a.hi[t], b.hi[t])), k: a.k });
  const absorbed = (U, i, j) => { const out = []; for (let t = 0; t < NB; t++) if (alive[t] && t !== i && t !== j && boxes[t].k === U.k && inside(boxes[t], U)) out.push(t); return out; };
  const MC = new Float64Array(NB * NB).fill(Infinity), MA = new Int16Array(NB * NB);
  const mergeCost = (i, j) => {
    const a = boxes[i], b = boxes[j];
    if (a.k !== b.k || kinds[a.k - 1].prot) return [Infinity, 0];
    const U = union(a, b);
    if (forbid[a.k](U.lo, U.hi) > 0) return [Infinity, 0];
    const I = inter(a, b), ov = touch(a, b) ? air(I) : 0;
    return [air(U) - air(a) - air(b) + ov, absorbed(U, i, j).length];
  };
  const setPair = (i, j) => { const [cst, ab] = mergeCost(i, j), x = i < j ? i * NB + j : j * NB + i; MC[x] = cst; MA[x] = ab; };
  for (let i = 0; i < NB; i++) for (let j = i + 1; j < NB; j++) setPair(i, j);
  const DC = new Float64Array(NB).fill(Infinity);
  const delCost = (i) => {
    const b = boxes[i];
    if (kinds[b.k - 1].prot) return Infinity;
    const cv = cov[b.k], k = b.k;
    let s = 0, bad = false;
    each(b, (li) => { if (cv[li] !== 1) return; if (kindAt[li] === k) { s += LOSS; if (pin[li]) bad = true; } else s--; });
    return bad ? Infinity : s;
  };
  for (let i = 0; i < NB; i++) DC[i] = delCost(i);
  const outer = () => { const lo = [n, n, n], hi = [0, 0, 0]; for (let t = 0; t < NB; t++) if (alive[t]) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], boxes[t].lo[a]); hi[a] = Math.max(hi[a], boxes[t].hi[a]); } return { lo, hi }; };
  const box0 = outer();
  const guardOk = (i) => {   // 删掉 i 以后，整格的外包盒每边缩不超过 2 个体素
    alive[i] = 0; const o = outer(); alive[i] = 1;
    return [0, 1, 2].every((a) => o.lo[a] - box0.lo[a] <= 2 && box0.hi[a] - o.hi[a] <= 2);
  };
  let count = NB, merges = 0, deletes = 0;
  while (count > limit) {
    let best = -1, bc = Infinity, del = false;
    for (let i = 0; i < NB; i++) {
      if (!alive[i]) continue;
      if (DC[i] < bc) { bc = DC[i]; best = i; del = true; }
      for (let j = i + 1; j < NB; j++) {
        if (!alive[j]) continue;
        const x = i * NB + j, cst = MC[x] / (1 + MA[x]);
        if (cst < bc) { bc = cst; best = x; del = false; }
      }
    }
    if (best < 0 || bc === Infinity) break;
    if (del) {
      if (!guardOk(best)) { DC[best] = Infinity; continue; }
      const b = boxes[best];
      addCov(b, -1); alive[best] = 0; count--; deletes++;
      for (let t = 0; t < NB; t++) if (alive[t] && boxes[t].k === b.k && touch(boxes[t], b)) DC[t] = delCost(t);
      continue;
    }
    const i = Math.floor(best / NB), j = best % NB, U = union(boxes[i], boxes[j]), ab = absorbed(U, i, j);
    if (ab.length !== MA[best]) { MA[best] = ab.length; continue; }   // 吞掉几块变了：重新挑
    for (const t of [i, j, ...ab]) { addCov(boxes[t], -1); alive[t] = 0; }
    boxes[i] = U; alive[i] = 1; addCov(U, 1);
    count -= 1 + ab.length; merges++;
    for (let t = 0; t < NB; t++) if (alive[t] && t !== i) setPair(i, t);
    for (let t = 0; t < NB; t++) if (alive[t] && boxes[t].k === U.k && touch(boxes[t], U)) DC[t] = delCost(t);
  }
  // ---- 结果：u 坐标、透明度类、元素名（盒子里最多的部件）----
  const out = [];
  for (let t = 0; t < NB; t++) {
    if (!alive[t]) continue;
    const b = boxes[t], cnt = new Map();
    each(b, (li) => { if (kindAt[li] === b.k) { const tg = G.tag[gAt[li]]; cnt.set(tg, (cnt.get(tg) || 0) + 1); } });
    let tag = -1, tn = -1; for (const [tg, nn] of [...cnt].sort((p, q) => p[0] - q[0])) if (nn > tn) { tn = nn; tag = tg; }
    out.push({ lo: b.lo.map((v, a) => v + O[a]), hi: b.hi.map((v, a) => v + O[a]), cls: kinds[b.k - 1].cls, tag, kind: b.k });
  }
  // 误差：多盖的空气、丢掉的体素（种类内）
  let extra = 0, lost = 0;
  for (let i = 0; i < N; i++) {
    const k = kindAt[i];
    if (k) { if (!cov[k][i]) lost++; }
    else { for (let q = 1; q <= K; q++) if (cov[q][i]) { extra++; break; } }
  }
  const R = { O, n, local, kindAt, gAt, cov, kinds, K };
  return { boxes: out, R, stats: { exact, merges, deletes, elements: out.length, voxels: rows.length, extra, lost, over: count > limit } };
}

// 屏幕面板的正面挪到网页叠上去的屏幕平面后面 SCREEN_GAP（u，1/32 米；0.064 = 2 毫米）：只挪几何（b.geo），贴图不变。
// boxes：一格的块（u 坐标，简化过的、没简化的都行）；screens：furn-mc-vox 的 vr.screens
// 屏幕边上的块（边框）伸进了平面那一块、又穿过平面（取整以后电脑屏左边的边框盖住了平面左边半格）：把伸进来的那一边退到平面的边上。
export function snapScreens(boxes, screens) {
  let n = 0;
  for (const sc of screens || []) {
    const front = sc.sg < 0 ? sc.panel : sc.panel + 1, ax = sc.ax, inPl = [0, 1, 2].filter((a) => a !== ax);
    for (const b of boxes) {
      if (!inPl.every((a) => b.lo[a] < sc.hi[a] && b.hi[a] > sc.lo[a])) continue;           // 和平面那一块不沾边
      const g = b.geo || { lo: b.lo.slice(), hi: b.hi.slice() };
      if ((sc.sg < 0 ? b.lo : b.hi)[ax] === front) {                                          // 屏幕面板：正面挪到平面后面
        (sc.sg < 0 ? g.lo : g.hi)[ax] = sc.D - sc.sg * SCREEN_GAP; b.geo = g; n++;
      } else if (b.lo[ax] < sc.D && b.hi[ax] > sc.D) {                                         // 穿过平面的边框：伸进来最少的那一边退到平面边上
        let best = null;
        for (const a of inPl) {
          if (b.lo[a] < sc.lo[a] && b.hi[a] > sc.lo[a]) { const d = b.hi[a] - sc.lo[a]; if (!best || d < best.d) best = { a, d, hi: true }; }
          if (b.hi[a] > sc.hi[a] && b.lo[a] < sc.hi[a]) { const d = sc.hi[a] - b.lo[a]; if (!best || d < best.d) best = { a, d, hi: false }; }
        }
        if (!best) continue;
        if (best.hi) g.hi[best.a] = sc.lo[best.a]; else g.lo[best.a] = sc.hi[best.a];
        b.geo = g; n++;
      }
    }
  }
  return n;
}

// ---- 面 ----
// R：simplifyCell 的区域；b：一块（u 坐标）；返回 { d, w, h, px, vis } 或 null（整面看不见）
export function faceLite(G, R, b, d) {
  const [[ua, us], [va, vs]] = UVAX[d], nrm = NORMALS[d], na = nrm[0] ? 0 : nrm[1] ? 1 : 2, sg = nrm[na];
  const w = b.hi[ua] - b.lo[ua], h = b.hi[va] - b.lo[va], depth = b.hi[na] - b.lo[na];
  const px = new Uint8Array(w * h * 4);
  const plane = sg > 0 ? b.hi[na] - 1 : b.lo[na], alpha = G.alphas[b.cls - 1];
  const v = [0, 0, 0];
  let vis = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    v[ua] = us > 0 ? b.lo[ua] + i : b.hi[ua] - 1 - i;
    v[va] = vs > 0 ? b.lo[va] + j : b.hi[va] - 1 - j;
    let gi = -1, li = -1;
    for (let k = 0; k < depth; k++) {
      v[na] = plane - sg * k;
      li = R.local(v);
      if (li >= 0 && R.kindAt[li] === b.kind) { gi = R.gAt[li]; break; }
    }
    const o = (j * w + i) * 4;
    if (gi < 0) continue;
    // 这个像素看不看得见：面外面那格是不透明的体素（或同一种玻璃），并且有元素盖着（别的格的算有）
    const at = v[na];
    v[na] = plane + sg;
    const nb = G.at(v[0], v[1], v[2]);
    let hidden = false;
    if (nb && (nb === b.cls || G.alphas[nb - 1] >= 1)) {
      const ln = R.local(v);
      if (ln < 0 || !R.kindAt[ln]) hidden = true;                       // 别的格的体素（或这一格的格外）
      else { const kq = R.kindAt[ln]; hidden = R.cov[kq][ln] > 0; }
    }
    v[na] = at;
    if (!hidden) vis++;
    const c = G.col[gi], kk = G.noise[gi] * aoOf(G, gi, v, d);
    px[o] = srgb(lin(c >> 16) * kk); px[o + 1] = srgb(lin((c >> 8) & 255) * kk); px[o + 2] = srgb(lin(c & 255) * kk);
    px[o + 3] = Math.round(alpha * 255);
  }
  if (!vis) return null;
  return { d, w, h, px, vis };
}
