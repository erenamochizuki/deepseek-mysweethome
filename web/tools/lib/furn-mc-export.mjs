// web/tools/lib/furn-mc-export.mjs — .bbmodel（models/furniture/<id>.bbmodel）→ MC 资源 + FurnitureShapes.java。
// 输出（都是「仓库里的相对路径 → 字节」，同样的输入每次一样）：
//   mod/src/main/resources/assets/xiaojingyu/
//     blockstates/<id>.json          facing × part → 模型 + y 旋转（north 0、east 90、south 180、west 270）
//     models/block/<模型>.json       每个 part 一个（朝北、坐标 0..16、不引用原版父模型、textures 带 particle）
//     models/item/<id>.json          整件（所有格的元素拼在一起，居中），display 按大小缩到物品栏的格子里
//     items/<id>.json                26.1 的物品定义 → 物品模型
//     textures/block/<贴图>.png       .bbmodel 里的贴图（解开再按我们的编码器重新写，字节稳定）
//   mod/src/main/java/com/xiaojingyu/furniture/FurnitureShapes.java   每件每个 part 的外包盒（朝北、像素单位）
// .bbmodel 可能被用户在 Blockbench 里改过：只认 cube（别的跳过并报出来）；group 按名字找 part（单格的叫 main）；
// 元素的旋转、inflate、shade、发光、面的旋转、tint 都照搬；cullface 按位置重新算（贴在方块边上的面才有）。
import fs from 'node:fs';
import path from 'node:path';
import { encodePng, decodePng } from '../mc-lib.mjs';
import { formatJSON } from './share-raw.mjs';
import { groupName } from './furn-mc-bb.mjs';

// 这一格的碰撞（V3.furnMc 的 collideOf，这里不加载网页模块，照抄）
export const collideOf = (f, part) => { const c = f.collide || 'box'; return Array.isArray(c) ? c[part | 0] : c; };
// 还没有 .bbmodel 的（第 2 轮先出接口）：占位的盒子（box = 整格）
export function placeholderShapes(f) {
  return f.cells.map((c) => { const col = collideOf(f, c.part); return { name: javaName(f, c.part), part: c.part, collide: col, boxes: col === 'none' ? [] : col === 'thin' ? [THIN] : [[0, 0, 0, 16, 16, 16]], outline: [[0, 0, 0, 16, 16, 16]] }; });
}

export const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
const NORMAL = { down: [1, -1], up: [1, 1], north: [2, -1], south: [2, 1], west: [0, -1], east: [0, 1] };   // [轴, 正负]
const r5 = (v) => { const x = +(+v).toFixed(5); return Object.is(x, -0) ? 0 : x; };
const CREDIT = (id) => `Xiaojingyu's Home (CC BY-NC-SA 4.0, Moci): models/furniture/${id}.bbmodel -> node web/tools/furn-mc.mjs export`;

// 原版 block/block.json 的 display（不引用它，抄过来再按大小缩）
const DISPLAY = {
  gui: { rotation: [30, 225, 0], translation: [0, 0, 0], scale: 0.625 },
  ground: { rotation: [0, 0, 0], translation: [0, 3, 0], scale: 0.25 },
  fixed: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: 0.5 },
  thirdperson_righthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: 0.375 },
  firstperson_righthand: { rotation: [0, 45, 0], translation: [0, 0, 0], scale: 0.4 },
  firstperson_lefthand: { rotation: [0, 225, 0], translation: [0, 0, 0], scale: 0.4 },
};

// ---- 读 .bbmodel ----
export function readBb(file) {
  const bb = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!bb || !bb.meta || !Array.isArray(bb.elements)) throw new Error(`${file}：不是 .bbmodel`);
  return bb;
}
// group 名字 → 里面的元素（递归子 group）
function groupsOf(bb) {
  const byId = new Map((bb.groups || []).map((g) => [g.uuid, g])), els = new Map(bb.elements.map((e) => [e.uuid, e])), out = new Map();
  const walk = (node, acc) => {
    for (const ch of node.children || []) {
      if (typeof ch === 'string') { if (els.has(ch)) acc.push(els.get(ch)); }
      else if (ch && typeof ch === 'object') walk(ch, acc);
    }
  };
  const loose = [];
  for (const node of bb.outliner || []) {
    if (typeof node === 'string') { if (els.has(node)) loose.push(els.get(node)); continue; }
    const g = byId.get(node.uuid) || node, acc = [];
    walk(node, acc);
    out.set(g.name, (out.get(g.name) || []).concat(acc));
  }
  return { groups: out, loose };
}
// 贴图 i → { id: 'xiaojingyu:block/bed', file, png(字节), w, h, uw, uh }
async function texturesOf(bb, f, base) {
  const out = [];
  for (const [i, t] of (bb.textures || []).entries()) {
    const ns = t.namespace || f.block.split(':')[0], folder = t.folder || 'block', name = String(t.name || ('texture' + i)).replace(/\.png$/i, '');
    let bytes = null;
    if (typeof t.source === 'string' && t.source.startsWith('data:image/png;base64,')) bytes = Buffer.from(t.source.slice(22), 'base64');
    else if (t.relative_path || t.path) {
      const p = t.relative_path ? path.resolve(base, t.relative_path) : t.path;
      if (fs.existsSync(p)) bytes = fs.readFileSync(p);
    }
    if (!bytes) throw new Error(`${f.id}.bbmodel：贴图 ${name} 读不出来（要内嵌在 .bbmodel 里，或者 relative_path 指到 PNG）`);
    const img = await decodePng(bytes);
    out.push({ id: `${ns}:${folder}/${name}`, file: `${ns}/textures/${folder}/${name}.png`, png: encodePng(img.width, img.height, img.data),
      w: img.width, h: img.height, uw: t.uv_width || (bb.resolution && bb.resolution.width) || 16, uh: t.uv_height || (bb.resolution && bb.resolution.height) || 16,
      particle: !!t.particle, rgba: img.data });
  }
  if (!out.length) throw new Error(`${f.id}.bbmodel：没有贴图`);
  return out;
}

// Blockbench 的元素 → MC 的元素（坐标减去 shift）。notes 收集提醒
function mcElement(e, shift, texs, notes, f) {
  const inf = +e.inflate || 0;
  const from = [0, 1, 2].map((a) => r5(e.from[a] - inf - shift[a])), to = [0, 1, 2].map((a) => r5(e.to[a] + inf - shift[a]));
  const el = { from, to };
  const rot = (e.rotation || [0, 0, 0]).map(Number), nz = rot.map((v, a) => (v ? a : -1)).filter((a) => a >= 0);
  if (nz.length) {
    const origin = [0, 1, 2].map((a) => r5((e.origin || [8, 8, 8])[a] - shift[a]));
    el.rotation = nz.length === 1 ? { origin, axis: 'xyz'[nz[0]], angle: rot[nz[0]] } : { origin, x: rot[0], y: rot[1], z: rot[2] };
    if (e.rescale) el.rotation.rescale = true;
  }
  if (e.shade === false) el.shade = false;
  if (e.light_emission) el.light_emission = e.light_emission | 0;
  const faces = {};
  for (const d of DIRS) {
    const fc = e.faces && e.faces[d];
    if (!fc || fc.texture === null || fc.texture === undefined || fc.texture === false) continue;
    const ti = typeof fc.texture === 'number' ? fc.texture : texs.findIndex((t, i) => String(i) === String(fc.texture));
    const t = texs[ti];
    if (!t) { notes.push(`${f.id}：元素「${e.name}」的 ${d} 面贴图 ${fc.texture} 不存在，跳过这个面`); continue; }
    const uv = fc.uv || [0, 0, 0, 0];
    const o = { uv: [r5(uv[0] * 16 / t.uw), r5(uv[1] * 16 / t.uh), r5(uv[2] * 16 / t.uw), r5(uv[3] * 16 / t.uh)], texture: '#' + ti };
    if (fc.rotation) o.rotation = fc.rotation;
    if (Number.isInteger(fc.tint) && fc.tint >= 0) o.tintindex = fc.tint;
    const [ax, sg] = NORMAL[d], plane = sg > 0 ? to[ax] : from[ax];
    if (!el.rotation && plane === (sg > 0 ? 16 : 0) && from.every((v) => v >= 0) && to.every((v) => v <= 16)) o.cullface = d;   // 伸出格子的元素不剔除
    faces[d] = o;
  }
  el.faces = faces;
  return el;
}
export const elBox = (els) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const e of els) {
    const r = e.rotation, origin = r?.origin || [8, 8, 8];
    // MC 26.1 / Blockbench use Z·Y·X. Transform all eight corners; from/to
    // alone only bound unrotated cubes. Rescale stretches local basis vectors.
    const angles = r ? ['x', 'y', 'z'].map(a => (r.axis ? r.axis === a ? +r.angle || 0 : 0 : +r[a] || 0) * Math.PI / 180) : [0, 0, 0];
    const rotate = p => {
      let [x, y, z] = p;
      const [a, b, c] = angles, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
      [y, z] = [y * ca - z * sa, y * sa + z * ca];
      [x, z] = [x * cb + z * sb, -x * sb + z * cb];
      return [x * cc - y * sc, x * sc + y * cc, z];
    };
    const basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(rotate);
    if (r?.rescale) for (const b of basis) { const scale = Math.max(...b.map(Math.abs)); for (let a = 0; a < 3; a++) b[a] /= scale; }
    for (const x of [e.from[0], e.to[0]]) for (const y of [e.from[1], e.to[1]]) for (const z of [e.from[2], e.to[2]]) {
      const p = [x, y, z].map((v, a) => v - origin[a]);
      for (let a = 0; a < 3; a++) {
        const v = origin[a] + basis.reduce((sum, b, k) => sum + b[a] * p[k], 0);
        lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v);
      }
    }
  }
  return [...lo, ...hi].map(r5);
};

// GUI 里看着和整块方块一样大：转到 gui 的角度后投影的宽、高，和 16³ 的方块比
function fitScale(box, c) {
  const [rx, ry] = [30, 225].map((d) => d * Math.PI / 180);
  const pts = [];
  for (const x of [box[0], box[3]]) for (const y of [box[1], box[4]]) for (const z of [box[2], box[5]]) pts.push([x - c[0], y - c[1], z - c[2]]);
  const proj = (p) => { const x1 = p[0] * Math.cos(ry) + p[2] * Math.sin(ry), z1 = -p[0] * Math.sin(ry) + p[2] * Math.cos(ry); return [x1, p[1] * Math.cos(rx) - z1 * Math.sin(rx)]; };
  const ext = (ps) => { const a = ps.map(proj); return [0, 1].map((k) => 2 * Math.max(...a.map((q) => Math.abs(q[k])))); };
  const cube = []; for (const x of [-8, 8]) for (const y of [-8, 8]) for (const z of [-8, 8]) cube.push([x, y, z]);
  const e = ext(pts), e0 = ext(cube);
  return Math.min(1, e0[0] / e[0], e0[1] / e[1]);
}

const FACING_Y = { north: 0, east: 90, south: 180, west: 270 };
const hasPart = (p) => p != null && p !== '';
const javaName = (f, part) => (f.id + (hasPart(part) ? '_' + part : '')).toUpperCase();
const THIN = [0, 0, 0, 16, 1, 16];
const jnum = (v) => (Number.isInteger(v) ? String(v) : String(r5(v)));

// 一件家具 → Map(相对路径 → Buffer)，加上给 Java 的盒子、统计。opt.bb：不读文件，直接用这个 .bbmodel 对象（预览图的「简化前」）
export async function exportOne(f, bbFile, opt = {}) {
  const bb = opt.bb || readBb(bbFile), notes = [], files = new Map();
  const ASSETS = 'mod/src/main/resources/assets/';
  const texs = await texturesOf(bb, f, path.dirname(bbFile));
  for (const t of texs) {
    files.set(ASSETS + t.file, t.png);
    if (t.w % 16 || t.h % 16) notes.push(`${f.id}：贴图 ${t.id} 是 ${t.w}×${t.h}，不是 16 的倍数（MC 会少几级 mipmap）`);
  }
  const textures = {};
  texs.forEach((t, i) => { textures[String(i)] = t.id; });
  textures.particle = (texs.find((t) => t.particle) || texs[0]).id;
  const { groups, loose } = groupsOf(bb);
  if (loose.length) notes.push(`${f.id}：${loose.length} 个元素不在任何 group 里，没导出（${loose.slice(0, 3).map((e) => e.name).join('、')}…）`);
  const skip = bb.elements.filter((e) => e.type && e.type !== 'cube');
  if (skip.length) notes.push(`${f.id}：${skip.length} 个不是方块元素（${skip[0].type}），MC 方块模型不支持，跳过`);
  const shapes = [], cells = [], itemEls = [];
  const fpLo = [0, 1, 2].map((a) => Math.min(...f.cells.map((c) => c.offset[a]))), fpHi = [0, 1, 2].map((a) => Math.max(...f.cells.map((c) => c.offset[a] + 1)));
  const center = [0, 2].map((a) => (fpLo[a] + fpHi[a]) * 8);   // 整件在 x、z 上的中心（像素，主格坐标）
  for (const c of f.cells) {
    const gn = groupName(c), list = (groups.get(gn) || []).filter((e) => !e.type || e.type === 'cube');
    if (!groups.has(gn)) throw new Error(`${f.id}.bbmodel：没有叫「${gn}」的 group（每格一个，名字 = part）`);
    const shift = c.offset.map((v) => v * 16);
    const els = list.map((e) => mcElement(e, shift, texs, notes, f));
    if (!els.length) throw new Error(`${f.id}.bbmodel：group「${gn}」是空的`);
    const box = elBox(els);
    if (!f.reach && (box.slice(0, 3).some((v) => v < 0) || box.slice(3).some((v) => v > 16))) notes.push(`${f.id}：${gn} 的元素超出了这一格（${box.map(r5).join(', ')}）`);
    if (box.slice(0, 3).some((v) => v < -16) || box.slice(3).some((v) => v > 32)) throw new Error(`${f.id}：${gn} 的元素超出了 MC 允许的 −16..32`);
    const model = { credit: CREDIT(f.id), textures, elements: els };
    const mname = f.models[gn];
    if (!mname) throw new Error(`V3.furnMc 里 ${f.id} 没有 part ${gn} 的模型名`);
    const [mns, mpath] = mname.split(':');
    files.set(`${ASSETS}${mns}/models/${mpath}.json`, Buffer.from(formatJSON(model), 'utf8'));
    const col = collideOf(f, c.part);
    // 伸出格子的（f.reach）：碰撞、选框都只算这一格（裁到 0..16）；f.solid：碰撞只算这些部件（遮阳伞的伞杆）
    const clip = (b) => (f.reach ? b.map((v) => Math.min(16, Math.max(0, v))) : b).map(r5);
    const solidEls = f.solid ? list.filter((e) => f.solid.includes(e.name)).map((e) => mcElement(e, shift, texs, [], f)) : els;
    const cbox = solidEls.length ? [clip(elBox(solidEls))] : [];
    shapes.push({ name: javaName(f, c.part), part: c.part, collide: col, boxes: col === 'none' ? [] : col === 'thin' ? [THIN] : cbox, outline: [clip(box)] });
    cells.push({ part: gn, elements: els.length, faces: els.reduce((s, e) => s + Object.keys(e.faces).length, 0), box: box.map(r5) });
    // 物品模型：整件拼起来，挪到 x、z 的中心在 8（床 z 0..32 → −8..24，贝壳柜 x −16..16 → −8..24）
    for (const e of list) itemEls.push(mcElement(e, [center[0] - 8, 0, center[1] - 8], texs, [], f));
  }
  // 物品模型的 cullface 去掉：物品不剔除
  for (const e of itemEls) for (const fc of Object.values(e.faces)) delete fc.cullface;
  // MC 只认 −16..32 的元素：整件比 3 格还大（4 格长的厨房台面）就先绕中心 (8, 8, 8) 把元素缩进去（uv 不变），display 再按缩过的大小算
  const b0 = elBox(itemEls), reach = Math.max(...[0, 1, 2].map((a) => Math.max(8 - b0[a], b0[a + 3] - 8)));
  if (reach > 24) {
    const sk = 24 / reach, sc = (v) => r5(8 + (v - 8) * sk);
    for (const e of itemEls) { e.from = e.from.map(sc); e.to = e.to.map(sc); if (e.rotation) e.rotation.origin = e.rotation.origin.map(sc); }
  }
  const ibox = elBox(itemEls), k = fitScale(ibox, [8, 8, 8]), display = {};
  for (const [ctx, d] of Object.entries(DISPLAY)) display[ctx] = { rotation: d.rotation, translation: d.translation.map((v) => r5(v * k)), scale: [0, 1, 2].map(() => r5(d.scale * k)) };
  const [ins, ipath] = f.item.split(':');
  files.set(`${ASSETS}${ins}/models/${ipath}.json`, Buffer.from(formatJSON({ credit: CREDIT(f.id), textures, elements: itemEls, display }), 'utf8'));
  const [bns, bid] = f.block.split(':');
  files.set(`${ASSETS}${bns}/items/${bid}.json`, Buffer.from(formatJSON({ model: { type: 'minecraft:model', model: f.item } }), 'utf8'));
  // blockstate
  const variants = {};
  const keys = [];
  for (const facing of Object.keys(FACING_Y)) for (const c of f.cells) keys.push([facing, c]);
  keys.sort((a, b) => { const ka = 'facing=' + a[0] + (hasPart(a[1].part) ? ',part=' + a[1].part : ''), kb = 'facing=' + b[0] + (hasPart(b[1].part) ? ',part=' + b[1].part : ''); return ka < kb ? -1 : ka > kb ? 1 : 0; });
  for (const [facing, c] of keys) {
    const v = { model: f.models[groupName(c)] };
    if (FACING_Y[facing]) v.y = FACING_Y[facing];
    variants['facing=' + facing + (hasPart(c.part) ? ',part=' + c.part : '')] = v;
  }
  files.set(`${ASSETS}${bns}/blockstates/${bid}.json`, Buffer.from(formatJSON({ variants }), 'utf8'));
  const tex0 = texs[0];
  const photoSlots = f.photo ? photoSlotsOf(f, groups, notes) : null;
  return { files, shapes, notes, photoSlots, stats: { id: f.id, cells, texture: texs.map((t) => [t.w, t.h]), itemScale: r5(k), elements: cells.reduce((s, c) => s + c.elements, 0) }, texture: tex0 };
}

// ---- 照片画在哪（docs/PHOTOS.md 第 3 节）：.bbmodel 里叫 f.photo 的元素（相框「照片」、画框墙「画」）朝 −z 的面 ----
// 元素坐标是整件的（part 1 在 x 16..32），同一个面上挨着的拼成一块（画框墙中间那两幅跨了两格，是两个元素）；
// 排序 = 行从下到上（y 范围重叠的算一行），行里从正面看从左到右（朝北的模型从北往南看，左边是 x 大的）= 56-furn-ground 的 FR 顺序。
// 每块：part = 矩形中心所在的那格（单格的 0），坐标减去这一格的位置（可以超出 0..16）→ [part, x0, y0, x1, y1, z]
export function photoSlotsOf(f, groups, notes = []) {
  const rects = [];
  for (const c of f.cells) for (const e of groups.get(groupName(c)) || []) {
    if (e.name !== f.photo || (e.type && e.type !== 'cube')) continue;
    if ((e.rotation || []).some((v) => +v)) { notes.push(`${f.id}：照片元素「${e.name}」转过，不算照片那块`); continue; }
    const inf = +e.inflate || 0, lo = [0, 1, 2].map((a) => Math.min(e.from[a], e.to[a]) - inf), hi = [0, 1, 2].map((a) => Math.max(e.from[a], e.to[a]) + inf);
    rects.push({ x0: lo[0], x1: hi[0], y0: lo[1], y1: hi[1], z: lo[2] });
  }
  const eq = (a, b) => Math.abs(a - b) < 1e-6;
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < rects.length && !merged; i++) for (let j = i + 1; j < rects.length && !merged; j++) {
      const a = rects[i], b = rects[j];
      if (!eq(a.z, b.z)) continue;
      const sideX = eq(a.y0, b.y0) && eq(a.y1, b.y1) && (eq(a.x1, b.x0) || eq(b.x1, a.x0));
      const sideY = eq(a.x0, b.x0) && eq(a.x1, b.x1) && (eq(a.y1, b.y0) || eq(b.y1, a.y0));
      if (!sideX && !sideY) continue;
      rects[i] = { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), z: a.z };
      rects.splice(j, 1); merged = true;
    }
  }
  rects.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const rows = [];
  for (const r of rects) { const row = rows[rows.length - 1]; if (row && r.y0 < row.top - 1e-6) { row.list.push(r); row.top = Math.max(row.top, r.y1); } else rows.push({ top: r.y1, list: [r] }); }
  const out = [];
  for (const row of rows) for (const r of row.list.sort((a, b) => (b.x0 + b.x1) - (a.x0 + a.x1))) {
    const ctr = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, r.z + 0.01].map((v) => Math.floor(v / 16));
    const c = f.cells.find((q) => q.offset.every((o, a) => o === ctr[a]));
    if (!c) { notes.push(`${f.id}：照片那块（${[r.x0, r.y0, r.x1, r.y1, r.z].map(r5).join(', ')}）不在任何一格里`); continue; }
    const s = c.offset.map((v) => v * 16), part = hasPart(c.part) ? +c.part : 0;
    out.push([part, r5(r.x0 - s[0]), r5(r.y0 - s[1]), r5(r.x1 - s[0]), r5(r.y1 - s[1]), r5(r.z - s[2])]);
  }
  if (!out.length) notes.push(`${f.id}：.bbmodel 里没有叫「${f.photo}」的元素，没有照片那块`);
  if (f.photoSlots && JSON.stringify(f.photoSlots) !== JSON.stringify(out)) notes.push(`${f.id}：规格（44-furn-mc）里的 photoSlots 和 .bbmodel 算出来的不一样，规格要改成 ${JSON.stringify(out)}`);
  return out;
}

export const JAVA_FILE = 'mod/src/main/java/com/xiaojingyu/furniture/FurnitureShapes.java';
const jbox = (b) => '{' + b.map(jnum).join(', ') + '}';
const jstr = (v) => JSON.stringify(v);
// list：[{ id, block, label, shapes, spec, placeholder }]。第 1 轮的 3 件（床、餐桌、贝壳柜）照旧是具名常量 + boxes(id, part)；
// 第 2 轮的是 Kind（通用多格家具，mod 的通用方块类直接读）
export function javaShapes(list) {
  const L = [], r1 = list.filter((q) => !(q.spec.round >= 2)), r2 = list.filter((q) => q.spec.round >= 2), A = (...l) => L.push(...l);
  A('// 生成的文件，不要手改：node web/tools/furn-mc.mjs export（源头是 models/furniture/<id>.bbmodel 和 web/src/44-furn-mc.js）。',
    "// 小鲸鱼之家 Xiaojingyu's Home — CC BY-NC-SA 4.0, Moci",
    'package com.xiaojingyu.furniture;', '',
    '/**',
    ' * 家具的格子、碰撞盒 / 选框、碰撞种类、方块光（接口说明：tmp/furn/shapes-api.md；约定：docs/FURNITURE.md 第 2、8 节）。',
    ' * 盒子 {x0, y0, z0, x1, y1, z1}（和 Block.box 的参数顺序一样）：朝北（正面在 -z；床是床头在 -z），像素单位（一格 16），每格自己的方块内坐标 0..16。',
    ' * box 的格：这一格里所有方块元素的外包盒；thin：贴地 1/16 格 {0, 0, 0, 16, 1, 16}；none：没有盒子。数组是只读的，别改里面的数。',
    ' * 这个类不用任何 Minecraft 的类；按 facing 转用 rotateY。',
    ' */',
    'public final class FurnitureShapes {',
    '    private FurnitureShapes() {}', '',
    '    // ---- 第 1 轮：床、餐桌、贝壳柜（part 是名字）----');
  for (const q of r1) for (const s of q.shapes) {
    A(`    /** ${q.label}${hasPart(s.part) ? '（' + s.part + '）' : ''}：${q.block}${hasPart(s.part) ? '[part=' + s.part + ']' : ''} */`,
      `    public static final double[][] ${s.name} = {${s.boxes.map(jbox).join(', ')}};`);
  }
  A('', '    /**',
    '     * 碰撞盒。id = 方块路径（带不带 "xiaojingyu:" 都行）。第 1 轮的 3 件：part = "head" / "foot" / "left" / "right"，餐桌给 null 或 ""；',
    '     * 第 2 轮的：part 给数字的字符串 "0"、"1" …，单格的给 null 或 ""。找不到返回 null。',
    '     */',
    '    public static double[][] boxes(String id, String part) {',
    '        String path = id.startsWith("xiaojingyu:") ? id.substring(11) : id;',
    '        String k = path + (part == null || part.isEmpty() ? "" : "/" + part);',
    '        switch (k) {');
  for (const q of r1) for (const s of q.shapes) A(`            case "${q.id}${hasPart(s.part) ? '/' + s.part : ''}": return ${s.name};`);
  A('            default: break;',
    '        }',
    '        Kind kd = kind(path);',
    '        if (kd == null) return null;',
    '        if (part == null || part.isEmpty()) return kd.parts() == 1 ? kd.boxes[0] : null;',
    '        try {',
    '            int p = Integer.parseInt(part);',
    '            return p >= 0 && p < kd.parts() ? kd.boxes[p] : null;',
    '        } catch (NumberFormatException e) {',
    '            return null;',
    '        }',
    '    }', '',
    '    // ---- 第 2、3 轮：通用的多格家具（docs/FURNITURE.md 8.1、9.1）----',
    '    /**',
    '     * 一种家具。朝北时本地格子 cx = 0..w-1（往 +x）、cz = 0..d-1（往 +z，往后）、cy = 0..h-1（往上），',
    '     * part = cx + w * (cz + d * cy)，主格 part 0；只有 1 格的方块没有 part 属性（状态只有 facing）。',
    '     * 第 3 轮的遮阳伞、吊篮：模型伸出自己那格（只是画出来），碰撞盒、选框照样只在这一格的 0..16 里。',
    '     */',
    '    public static final class Kind {',
    '        /** 方块路径，比如 "kitchen_counter"（方块 id 是 xiaojingyu:kitchen_counter） */',
    '        public final String id;',
    '        /** 占几格：宽（朝北时沿 +x）、深（沿 +z）、高 */',
    '        public final int w, d, h;',
    '        /** 方块光 0..15（每格都一样；0 = 不亮） */',
    '        public final int light;',
    '        /** 每个 part 的碰撞："box" / "thin" / "none" */',
    '        public final String[] collide;',
    '        /** 每个 part 一组盒子（朝北、像素、这一格自己的 0..16）；none 的格是空数组 */',
    '        public final double[][][] boxes;',
    '        /** 每个 part 的选框盒子（点中、拆的时候用）：不管 collide 是什么，都是模型这一格的外包盒（none、thin 的格也有） */',
    '        public final double[][][] outlines;',
    '        /** true = 模型还没导出，box 的格先用整格占位（export 以后换成模型的外包盒） */',
    '        public final boolean placeholder;', '',
    '        Kind(String id, int w, int d, int h, int light, String[] collide, double[][][] boxes, double[][][] outlines, boolean placeholder) {',
    '            this.id = id;',
    '            this.w = w;',
    '            this.d = d;',
    '            this.h = h;',
    '            this.light = light;',
    '            this.collide = collide;',
    '            this.boxes = boxes;',
    '            this.outlines = outlines;',
    '            this.placeholder = placeholder;',
    '        }', '',
    '        /** 一共几格（= part 的个数）。1 = 单格，方块没有 part 属性 */',
    '        public int parts() { return w * d * h; }', '',
    '        /** 朝北的本地格子 → part */',
    '        public int part(int cx, int cy, int cz) { return cx + w * (cz + d * cy); }', '',
    '        /** part → 朝北的本地格子 {cx, cy, cz} */',
    '        public int[] cell(int part) { return new int[] {part % w, part / (w * d), (part / w) % d}; }', '',
    '        /**',
    '         * part 这一格相对主格（part 0）的世界偏移 {dx, dy, dz}；quarterTurns：north 0、east 1、south 2、west 3。',
    '         * 本地 (cx, cz) → north (cx, cz)、east (-cz, cx)、south (-cx, -cz)、west (cz, -cx)（模型跟着顺时针转）。',
    '         */',
    '        public int[] offset(int part, int quarterTurns) {',
    '            int[] c = cell(part);',
    '            int x = c[0], z = c[2];',
    '            switch (((quarterTurns % 4) + 4) % 4) {',
    '                case 1: return new int[] {-z, c[1], x};',
    '                case 2: return new int[] {-x, c[1], -z};',
    '                case 3: return new int[] {z, c[1], -x};',
    '                default: return new int[] {x, c[1], z};',
    '            }',
    '        }', '',
    '        /**',
    '         * 照片画在哪（docs/PHOTOS.md 第 3 节）：每行 {part, x0, y0, x1, y1, z}，朝北的模型里、相对这一格（part）的像素，',
    '         * x0..x1、y0..y1 是照片那块，z 是那个面（画的时候往 -z 挪 0.01）。行号 = 方块实体里 Slots 的编号。没有照片的家具是空数组。',
    '         */',
    '        public double[][] photoSlots() { return FurnitureShapes.photoSlots(id); }',
    '    }', '');
  for (const q of r2) {
    const f = q.spec, col = q.shapes.map((s) => jstr(s.collide)).join(', '), bx = q.shapes.map((s) => '{' + s.boxes.map(jbox).join(', ') + '}').join(', '), ol = q.shapes.map((s) => '{' + s.outline.map(jbox).join(', ') + '}').join(', ');
    A(`    /** ${q.label}：${f.block}，${f.w} × ${f.d} × ${f.h} 格${f.light ? '，光 ' + f.light : ''}${q.placeholder ? '（占位：模型还没导出）' : ''} */`,
      `    public static final Kind ${f.id.toUpperCase()} = new Kind(${jstr(f.id)}, ${f.w}, ${f.d}, ${f.h}, ${f.light || 0},`,
      `        new String[] {${col}},`,
      `        new double[][][] {${bx}},`,
      `        new double[][][] {${ol}}, ${q.placeholder ? 'true' : 'false'});`);
  }
  A('', '    /** 第 2、3 轮的全部家具和第 5 轮的相框（注册方块、物品用；顺序 = FURNITURE.md 8.2、9.1 的表，相框在最后） */',
    `    public static final Kind[] KINDS = {${r2.map((q) => q.spec.id.toUpperCase()).join(', ')}};`, '',
    '    /** 按方块路径找（带不带 "xiaojingyu:" 都行）；第 1 轮的 3 件和找不到的返回 null */',
    '    public static Kind kind(String id) {',
    '        String path = id.startsWith("xiaojingyu:") ? id.substring(11) : id;',
    '        for (Kind k : KINDS) if (k.id.equals(path)) return k;',
    '        return null;',
    '    }', '');
  // 照片画在哪（export 从 .bbmodel 里规格 photo 名字的元素算出来，furn-mc-export 的 photoSlotsOf）
  const ph = list.filter((q) => q.photoSlots && q.photoSlots.length);
  A('    // ---- 照片（docs/PHOTOS.md 第 3 节）：每行 {part, x0, y0, x1, y1, z}，朝北的模型、相对这一格（part）的像素；行号 = 方块实体里 Slots 的编号 ----');
  for (const q of ph) {
    A(`    /** ${q.label}：${q.block} 的照片那块${q.photoSlots.length > 1 ? '（' + q.photoSlots.length + ' 个，下排先、从正面看从左到右 = 56-furn-ground 的 FR 顺序）' : ''} */`,
      `    public static final double[][] ${q.id.toUpperCase()}_PHOTO_SLOTS = {${q.photoSlots.map(jbox).join(', ')}};`);
  }
  A('    private static final double[][] NO_PHOTO_SLOTS = {};', '',
    '    /** 照片画在哪（id 带不带 "xiaojingyu:" 都行）；没有照片的家具和找不到的返回空数组。数组是只读的，别改里面的数 */',
    '    public static double[][] photoSlots(String id) {',
    '        String path = id.startsWith("xiaojingyu:") ? id.substring(11) : id;',
    '        switch (path) {');
  for (const q of ph) A(`            case "${q.id}": return ${q.id.toUpperCase()}_PHOTO_SLOTS;`);
  A('            default: return NO_PHOTO_SLOTS;',
    '        }',
    '    }', '');
  A(
    '    /**',
    '     * 朝北的盒子转到别的朝向：quarterTurns = 从上往下看顺时针转几个 90°（north 0、east 1、south 2、west 3，',
    "     * 和 blockstate 的 y 旋转 0 / 90 / 180 / 270 一样）。一个 90°：x' = 16 - z，z' = x。返回新数组。",
    '     */',
    '    public static double[] rotateY(double[] box, int quarterTurns) {',
    '        double x0 = box[0], y0 = box[1], z0 = box[2], x1 = box[3], y1 = box[4], z1 = box[5];',
    '        for (int t = ((quarterTurns % 4) + 4) % 4; t > 0; t--) {',
    '            double nx0 = 16 - z1, nx1 = 16 - z0, nz0 = x0, nz1 = x1;',
    '            x0 = nx0;',
    '            x1 = nx1;',
    '            z0 = nz0;',
    '            z1 = nz1;',
    '        }',
    '        return new double[] {x0, y0, z0, x1, y1, z1};',
    '    }', '',
    '    /** "north" → 0、"east" → 1、"south" → 2、"west" → 3（Direction 的 getSerializedName()）；别的返回 0。 */',
    '    public static int quarterTurns(String facing) {',
    '        switch (facing) {',
    '            case "east": return 1;',
    '            case "south": return 2;',
    '            case "west": return 3;',
    '            default: return 0;',
    '        }',
    '    }',
    '}');
  return Buffer.from(L.join('\n') + '\n', 'utf8');
}
