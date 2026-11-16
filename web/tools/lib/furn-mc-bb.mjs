// web/tools/lib/furn-mc-bb.mjs — 体素（furn-mc-vox.mjs 换好的 MC 坐标）→ Blockbench 工程（.bbmodel，格式 5.0，java_block）。
//
// 1. 按格子切开（每格一个 group，名字 = part；单格的家具叫 main），每格里把体素合成尽量少的长方块（element）：
//    透明度不同的（玻璃）分开合；同一个部件（体素的 tag，比如「床架」「床垫」）才合在一起，element 的名字就是部件名
//    （一格超过 200 个时不分部件再合一次）。这样合出来一格超过 32 个的，交给 furn-mc-lite.mjs 简化（docs/FURNITURE.md 第 10 节）。
//    每个起点试 6 种「先往哪个方向长」，取体积最大的那个；整格再试 3 种扫描顺序，取方块最少的。
// 2. 每个 element 的 6 个面：整面都被别的体素挡住（不透明的，或同一种玻璃）就不要这个面；否则这个面在贴图里占一块。
// 3. 贴图：32 像素 / 格，一个体素的面 = 一个像素。像素颜色 = 体素颜色 × 体素版的明暗噪点 × 体素版的 AO（四个角的平均，
//    和 03-vox.js 一样的算法），在线性空间里乘。每块四周留一圈延伸出去的边，块的起点和大小都是偶数（远处 mipmap 不串色）。
// 面的 uv 和像素的对应（和 MC 一样）：up u→+x v→+z；down u→+x v→−z；north u→−x v→−y；south u→+x v→−y；west u→+z v→−y；east u→−z v→−y。
import crypto from 'node:crypto';
import { encodePng } from '../mc-lib.mjs';
import { footprint } from './furn-mc-vox.mjs';
import { simplifyCell, faceLite, snapScreens, LIMIT } from './furn-mc-lite.mjs';

const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
export const NORMALS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
// 每个面：像素 (i, j) 沿哪个轴、哪个方向走：[轴, 正负]
export const UVAX = [[[0, 1], [2, -1]], [[0, 1], [2, 1]], [[0, -1], [1, -1]], [[0, 1], [1, -1]], [[2, 1], [1, -1]], [[2, -1], [1, -1]]];
// 03-vox.js 的 AO：每个面的两个切线方向
const TAN = [[[1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0]], [[0, 1, 0], [1, 0, 0]], [[1, 0, 0], [0, 1, 0]], [[0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1]]];

export const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export const srgb = (c) => { c = Math.max(0, Math.min(1, c)); return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); };

// 体素 Map → 稠密网格（占的格子范围内；f.reach 的往外多 1 格，MC 允许 −16..32 像素）
export function denseGrid(f, vox) {
  const fp = footprint(f), m = f.reach ? 32 : 0, X0 = fp.lo[0] * 32 - m, Y0 = fp.lo[1] * 32 - m, Z0 = fp.lo[2] * 32 - m;
  const NX = (fp.hi[0] - fp.lo[0]) * 32 + 2 * m, NY = (fp.hi[1] - fp.lo[1]) * 32 + 2 * m, NZ = (fp.hi[2] - fp.lo[2]) * 32 + 2 * m, N = NX * NY * NZ;
  const alphas = [...new Set([...vox.values()].map((v) => v.alpha))].sort((a, b) => b - a);
  const tags = [...new Set([...vox.values()].map((v) => v.tag))].sort();
  const G = { fp, X0, Y0, Z0, NX, NY, NZ, alphas, tags, cls: new Uint8Array(N), col: new Uint32Array(N), tag: new Uint16Array(N), noise: new Float32Array(N), ao: new Float32Array(N) };
  G.idx = (x, y, z) => (x < X0 || y < Y0 || z < Z0 || x >= X0 + NX || y >= Y0 + NY || z >= Z0 + NZ) ? -1 : (x - X0) + NX * ((y - Y0) + NY * (z - Z0));
  G.at = (x, y, z) => { const i = G.idx(x, y, z); return i < 0 ? 0 : G.cls[i]; };
  for (const v of vox.values()) {
    const i = G.idx(...v.u);
    G.cls[i] = 1 + alphas.indexOf(v.alpha); G.col[i] = v.col; G.tag[i] = tags.indexOf(v.tag); G.noise[i] = v.noise; G.ao[i] = v.ao;
  }
  if (f.reach) {   // 每个体素归哪一格（格子外面的归最近的那格）
    G.reach = true; G.own = new Int16Array(N).fill(-1);
    for (const v of vox.values()) {
      const c = [0, 1, 2].map((a) => Math.min(fp.hi[a] - 1, Math.max(fp.lo[a], Math.floor(v.u[a] / 32))));
      G.own[G.idx(...v.u)] = f.cells.findIndex((q) => q.offset.every((o, a) => o === c[a]));
    }
  }
  return G;
}

// ---- 合成长方块 ----
const ORDERS = [[0, 2, 1], [2, 0, 1], [0, 1, 2], [1, 0, 2], [1, 2, 0], [2, 1, 0]];
function boxesIn(G, lo, hi, scan, anyTag, ci) {
  const key = (i) => G.cls[i] * 65536 + (anyTag ? 0 : G.tag[i]);
  const used = new Uint8Array(G.cls.length), out = [];
  const [s0, s1, s2] = scan;   // s2 最外层
  const p = [0, 0, 0];
  const mine = (i) => !G.own || G.own[i] === ci;
  const ok = (q, k) => { const i = G.idx(q[0], q[1], q[2]); return i >= 0 && G.cls[i] && !used[i] && mine(i) && key(i) === k && q[0] < hi[0] && q[1] < hi[1] && q[2] < hi[2]; };
  const grow = (st, k, ord) => {
    const len = [1, 1, 1], q = [0, 0, 0];
    for (let t = 0; t < 3; t++) {
      const a = ord[t];
      for (;;) {
        // 往 a 方向再加一层：这一层（其余两个轴的当前长度）都要是同一种、没用过
        let all = true;
        const b = ord[(t + 1) % 3], c = ord[(t + 2) % 3];
        for (let i = 0; i < len[b] && all; i++) for (let j = 0; j < len[c] && all; j++) {
          q[a] = st[a] + len[a]; q[b] = st[b] + i; q[c] = st[c] + j;
          if (!ok(q, k)) all = false;
        }
        if (!all) break;
        len[a]++;
      }
    }
    return len;
  };
  for (p[s2] = lo[s2]; p[s2] < hi[s2]; p[s2]++) for (p[s1] = lo[s1]; p[s1] < hi[s1]; p[s1]++) for (p[s0] = lo[s0]; p[s0] < hi[s0]; p[s0]++) {
    const i = G.idx(p[0], p[1], p[2]);
    if (i < 0 || !G.cls[i] || used[i] || !mine(i)) continue;
    const k = key(i);
    let best = null, bv = 0;
    for (const ord of ORDERS) { const len = grow(p, k, ord), v = len[0] * len[1] * len[2]; if (v > bv) { bv = v; best = len; } }
    for (let x = 0; x < best[0]; x++) for (let y = 0; y < best[1]; y++) for (let z = 0; z < best[2]; z++) used[G.idx(p[0] + x, p[1] + y, p[2] + z)] = 1;
    out.push({ lo: p.slice(), hi: [p[0] + best[0], p[1] + best[1], p[2] + best[2]], cls: G.cls[i], tag: G.tag[i] });
  }
  return out;
}
// 一格超过 MAX_EL 个元素时，不同部件也合在一起（元素名取起点那个体素的部件）
export const MAX_EL = 200;
// ci：这一格在 f.cells 里的序号（伸出格子的家具：这一格的范围往外多 1 格，只合归这一格的体素）
export function cellBoxes(G, cellLo, anyTag = false, ci = 0) {
  const m = G.reach ? 32 : 0, lo = cellLo.map((v) => v * 32 - m), hi = cellLo.map((v) => v * 32 + 32 + m);
  let best = null;
  for (const scan of [[0, 2, 1], [2, 0, 1], [0, 1, 2]]) { const b = boxesIn(G, lo, hi, scan, anyTag, ci); if (!best || b.length < best.length) best = b; }
  return !anyTag && best.length > MAX_EL ? cellBoxes(G, cellLo, true, ci) : best;
}

// ---- 面和像素 ----
export function aoOf(G, i, v, d) {
  const n = NORMALS[d], [T1, T2] = TAN[d], k = G.ao[i], AO = [1, 1 - k * 0.28, 1 - k * 0.55, 1 - k];
  const a = [v[0] + n[0], v[1] + n[1], v[2] + n[2]], f = (dx, dy, dz) => G.at(a[0] + dx, a[1] + dy, a[2] + dz) > 0;
  let s = 0;
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const s1 = f(T1[0] * su, T1[1] * su, T1[2] * su), s2 = f(T2[0] * sv, T2[1] * sv, T2[2] * sv);
    const c = f(T1[0] * su + T2[0] * sv, T1[1] * su + T2[1] * sv, T1[2] * su + T2[2] * sv);
    s += AO[s1 && s2 ? 3 : (s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0)];
  }
  return s / 4;
}
// 一个面：{ d, w, h, px: Uint8Array(w*h*4), vis（看得见的像素数） }；整面看不见返回 null
function faceOf(G, b, d, opt) {
  const [[ua, us], [va, vs]] = UVAX[d], n = NORMALS[d], na = n[0] ? 0 : n[1] ? 1 : 2;
  const w = b.hi[ua] - b.lo[ua], h = b.hi[va] - b.lo[va], px = new Uint8Array(w * h * 4);
  const plane = n[na] > 0 ? b.hi[na] - 1 : b.lo[na];
  const alpha = G.alphas[b.cls - 1];
  let vis = 0;
  const v = [0, 0, 0];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    v[na] = plane;
    v[ua] = us > 0 ? b.lo[ua] + i : b.hi[ua] - 1 - i;
    v[va] = vs > 0 ? b.lo[va] + j : b.hi[va] - 1 - j;
    const id = G.idx(v[0], v[1], v[2]), nb = G.at(v[0] + n[0], v[1] + n[1], v[2] + n[2]);
    const see = !nb || (nb !== b.cls && G.alphas[nb - 1] < 1);
    if (see) vis++;
    const c = G.col[id], k = G.noise[id] * (see && opt.ao !== false ? aoOf(G, id, v, d) : 1), o = (j * w + i) * 4;
    px[o] = srgb(lin(c >> 16) * k); px[o + 1] = srgb(lin((c >> 8) & 255) * k); px[o + 2] = srgb(lin(c & 255) * k);
    px[o + 3] = Math.round(alpha * 255);
  }
  return vis ? { d, w, h, px, vis } : null;
}

// ---- 拼贴图：架子式，块按高、宽从大到小；每块留 1 像素延伸的边，块起点、大小都是偶数 ----
const even = (n) => n + (n & 1);
export function packFaces(faces) {
  const items = faces.map((f, k) => ({ f, k, w: even(f.w + 2), h: even(f.h + 2) }));
  items.sort((a, b) => (b.h - a.h) || (b.w - a.w) || (a.k - b.k));
  const area = items.reduce((s, it) => s + it.w * it.h, 0);
  let best = null;
  for (let W = 32; W <= 4096; W *= 2) {
    if (items.some((it) => it.w > W)) continue;
    let x = 0, y = 0, rowH = 0;
    const place = [];
    for (const it of items) {
      if (x + it.w > W) { x = 0; y += rowH; rowH = 0; }
      place.push([it, x, y]); x += it.w; rowH = Math.max(rowH, it.h);
    }
    const H = Math.ceil((y + rowH) / 16) * 16;
    if (H > W * 2) continue;
    const score = W * H + (W > H ? 0 : 1);   // 面积最小；一样大时宽的优先
    if (!best || score < best.score) best = { W, H, place, score };
    if (W * W >= area * 4) break;
  }
  const { W, H } = best, img = new Uint8Array(W * H * 4);
  for (const [it, x, y] of best.place) {
    const f = it.f;
    f.rect = [x + 1, y + 1, f.w, f.h];
    for (let py = 0; py < it.h; py++) for (let qx = 0; qx < it.w; qx++) {
      const sx = Math.min(f.w - 1, Math.max(0, qx - 1)), sy = Math.min(f.h - 1, Math.max(0, py - 1));
      const s = (sy * f.w + sx) * 4, o = ((y + py) * W + x + qx) * 4;
      img[o] = f.px[s]; img[o + 1] = f.px[s + 1]; img[o + 2] = f.px[s + 2]; img[o + 3] = f.px[s + 3];
    }
  }
  return { width: W, height: H, rgba: img, area };
}

// 确定的 uuid（同样的输入每次一样）
const uuid = (...parts) => {
  const h = crypto.createHash('sha1').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) & 3]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const r6 = (v) => +v.toFixed(6);
export const groupName = (c) => (c.part == null || c.part === '' ? 'main' : String(c.part));

// 体素 → { bbmodel(对象), stats }
// opt.lite：false = 简化前（第 1–3 轮的做法，每格不限元素数）；默认简化：老做法超过 LIMIT（32）个元素的格交给 furn-mc-lite（第 10 节）
export function toBbmodel(f, vr, opt = {}) {
  const G = denseGrid(f, vr.vox), elements = [], faces = [], perCell = [], lite = [];
  for (const [ci, c] of f.cells.entries()) {
    const boxes = cellBoxes(G, c.offset, false, ci), list = [];
    if (opt.lite !== false && boxes.length > LIMIT) {
      const r = simplifyCell(G, f, vr, ci);
      for (const b of r.boxes) {
        const fs = [];
        for (let d = 0; d < 6; d++) { const fc = faceLite(G, r.R, b, d); if (fc) { fs.push(fc); faces.push(fc); } }
        if (fs.length) list.push({ b, fs });
      }
      snapScreens(list.map((q) => q.b), vr.screens);
      perCell.push({ c, list });
      lite.push(Object.assign({ part: groupName(c), before: boxes.length }, r.stats));
      continue;
    }
    for (const b of boxes) {
      const fs = [];
      for (let d = 0; d < 6; d++) { const fc = faceOf(G, b, d, opt); if (fc) { fs.push(fc); faces.push(fc); } }
      if (!fs.length) continue;   // 整个被包在里面（不会出现：体素的外面总有面）
      list.push({ b, fs });
    }
    if (opt.lite !== false) snapScreens(list.map((q) => q.b), vr.screens);   // 屏幕面板对齐网页叠上去的屏幕平面（第 10 节）
    perCell.push({ c, list });
  }
  const tex = packFaces(faces), png = encodePng(tex.width, tex.height, tex.rgba);
  const groups = [], outliner = [], stats = { cells: [], texture: [tex.width, tex.height], faces: faces.length, voxels: vr.vox.size, lite };
  for (const { c, list } of perCell) {
    const gid = uuid(f.id, 'group', groupName(c)), kids = [];
    list.forEach(({ b, fs }, k) => {
      const tag = G.tags[b.tag].split('/').pop() || 'part', id = uuid(f.id, groupName(c), k, b.lo.join(','), b.hi.join(','));
      const from = (b.geo || b).lo.map((v) => r6(v / 2)), to = (b.geo || b).hi.map((v) => r6(v / 2));   // b.geo：屏幕对齐挪过的几何（furn-mc-lite 的 snapScreens）
      const fcs = {};
      for (let d = 0; d < 6; d++) {
        const fc = fs.find((q) => q.d === d);
        fcs[DIRS[d]] = fc ? { uv: [fc.rect[0], fc.rect[1], fc.rect[0] + fc.rect[2], fc.rect[1] + fc.rect[3]], texture: 0 } : { uv: [0, 0, 0, 0], texture: null };
      }
      elements.push({
        name: tag, box_uv: false, rescale: false, locked: false, light_emission: (f.glow || []).includes(tag) ? 15 : 0, render_order: 'default', allow_mirror_modeling: true,
        from, to, autouv: 0, color: (b.tag % 8), origin: [0, 1, 2].map((a) => r6((from[a] + to[a]) / 2)), faces: fcs, type: 'cube', uuid: id,
      });
      kids.push(id);
    });
    groups.push({ name: groupName(c), uuid: gid, origin: [8 + 16 * c.offset[0], 8 + 16 * c.offset[1], 8 + 16 * c.offset[2]], rotation: [0, 0, 0],
      export: true, visibility: true, mirror_uv: false, reset: false, color: 0, autouv: 0, shade: true, locked: false });
    outliner.push({ uuid: gid, isOpen: false, children: kids });
    stats.cells.push({ part: groupName(c), elements: kids.length });
  }
  const tname = f.texture.split('/').pop();
  const bb = {
    meta: { format_version: '5.0', model_format: 'java_block', box_uv: false },
    name: f.id, model_identifier: '', visible_box: [f.size[0], f.size[1], 0], resolution: { width: tex.width, height: tex.height },
    elements, groups, outliner,
    textures: [{
      path: '', name: tname, folder: 'block', namespace: f.block.split(':')[0], id: '0', width: tex.width, height: tex.height,
      uv_width: tex.width, uv_height: tex.height, particle: true, use_as_default: false, layers_enabled: false, sync_to_project: '',
      render_mode: 'default', render_sides: 'auto', frame_time: 1, frame_order_type: 'loop', frame_order: '', frame_interpolate: false,
      visible: true, internal: true, saved: true, uuid: uuid(f.id, 'texture'), relative_path: '', source: 'data:image/png;base64,' + png.toString('base64'),
    }],
    variable_placeholders: '', variable_placeholder_buttons: [], timeline_setups: [], unhandled_root_fields: {},
  };
  return { bb, stats, png };
}

export const bbText = (bb) => JSON.stringify(bb, null, '\t') + '\n';
