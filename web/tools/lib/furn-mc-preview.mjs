// web/tools/lib/furn-mc-preview.mjs — 体素版和 MC 模型版并排出图（无头 Edge），写进 refkit 的 2D 反馈项目 web/refs/furniture-p5/。
// 每件一张图：3 排 × 4 个角度，同一个机位：
//   ① 体素版（56-furn-ground / 57-furn-loft 的真代码，工作台「家具一览」的样子）；
//   ② MC 模型，网页里的画法（16-mcmesh + 我们导出的资源包，cardinal: false，和 54-house-mc 一样的材质），和 ① 一样的灯光；
//   ③ MC 模型，MC 游戏里的光照（18-mcthree：贴图 × 朝向明暗 × AO，不受灯光影响）。
// 不用原版贴图（没有 jar），图可以进 git。图上写着每件在 MC 里占几格、元素数、贴图大小。
// 第 4 轮「简化」（第 10 节）：3 排换成 ① 简化前的 MC 模型（老做法在内存里重新生成）② 简化后 ③ 简化后、MC 游戏里的光照，只出简化过的件。
// questions.json 是给用户的问题（每轮一份；这里写；answers.json 是页面写的，不碰）。换轮时上一轮的图挪进 trash/。
import fs from 'node:fs';
import path from 'node:path';
import { WEB_DIR, SRC_DIR, VENDOR_THREE } from './v3-node.mjs';
import { launchBrowser, serveFiles } from '../mc-lib.mjs';
import { furnMc, voxelsOf, sourceMatrices } from './furn-mc-vox.mjs';
import { buildFiles, REPO_DIR, makeBb } from '../furn-mc.mjs';
import { LIMIT } from './furn-mc-lite.mjs';
// 试改体素家具（不动 web/src）：环境变量 FURN_MC_SRC=<目录> 让体素和预览页都从那个目录读 src（furn-mc-vox.mjs 里同样）
const SRC = process.env.FURN_MC_SRC ? path.resolve(process.env.FURN_MC_SRC) : SRC_DIR;

export const PREVIEW_DIR = path.join(WEB_DIR, 'refs', 'furniture-p5');
const MODULES = ['00-core.js', '03-vox.js', '14-mcjar.js', '15-mcmodel.js', '16-mcmesh.js', '17-mcfallback.js', '18-mcthree.js', '40-layout.js', '44-furn-mc.js',
  '50-scene.js', '55-house-detail.js', '56-furn-beach.js', '56-furn-ground.js', '57-furn-loft.js', '57-furn-loft2.js', '58-plants.js'];   // 第 3 轮的体素版在场景部件里（50 + 55 / 56-beach / 58）
export const VIEWS = [{ name: '左前', az: -38, el: 26 }, { name: '右前', az: 38, el: 26 }, { name: '右后', az: 145, el: 26 }, { name: '上面', az: 18, el: 62 }];
export const IMAGES = [['bed', '01-bed.png'], ['dining_table', '02-dining_table.png'], ['shell_case', '03-shell_case.png']];
const esc = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');

// 页面里跑的：建体素版、MC 版，按 VIEWS 拍，拼成一张带字的图
function pageMain() {
  const D = window.__FURN, T = THREE, VIEWS = D.views, out = window.__furnPreview = { done: false, images: {}, stats: {}, errors: [] };
  const b64 = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const TW = D.tile[0], TH = D.tile[1];
  const lit = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  lit.setPixelRatio(1); lit.setSize(TW, TH); lit.shadowMap.enabled = true; lit.shadowMap.type = T.PCFSoftShadowMap;
  if ('outputColorSpace' in lit) lit.outputColorSpace = T.SRGBColorSpace; else lit.outputEncoding = T.sRGBEncoding;
  lit.toneMapping = T.NoToneMapping;
  const mcr = V3.mcthree.renderer(document.createElement('canvas'), { antialias: true }); mcr.setSize(TW, TH);
  const BG = 0xeef2f5;
  function litScene(obj, c, r, fy) {
    const sc = new T.Scene(); sc.background = new T.Color(BG);
    sc.add(new T.HemisphereLight(0xffffff, 0xb8a890, 0.75));
    const sun = new T.DirectionalLight(0xffffff, 1.5); sun.position.set(c.x - 2.2 * r, c.y + 4 * r, c.z + 2.6 * r); sun.target.position.copy(c);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc2 = sun.shadow.camera; sc2.left = sc2.bottom = -1.6 * r; sc2.right = sc2.top = 1.6 * r; sc2.near = 0.1; sc2.far = 12 * r; sun.shadow.bias = -0.0004;
    sc.add(sun, sun.target);
    const fl = new T.Mesh(new T.PlaneGeometry(40, 40), new T.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 1 }));
    fl.rotation.x = -Math.PI / 2; fl.position.set(c.x, (fy || 0) - 0.0005, c.z); fl.receiveShadow = true; sc.add(fl);
    sc.add(obj);
    return sc;
  }
  function camFor(v, c, r, turn) {
    const cam = new T.PerspectiveCamera(30, TW / TH, 0.02, 100), az = (v.az + (turn || 0)) * Math.PI / 180, el = v.el * Math.PI / 180, d = r / Math.sin(15 * Math.PI / 180) * 1.02;
    cam.position.set(c.x + d * Math.sin(az) * Math.cos(el), c.y + d * Math.sin(el), c.z + d * Math.cos(az) * Math.cos(el));
    cam.lookAt(c); cam.updateMatrixWorld(true);
    return cam;
  }
  // ---- 体素版 ----
  // keep = 留着 buildAll 照布局摆好的场景位置（第 2 轮）；rect = 换掉布局矩形（串灯只取一段）
  function voxelObj(f, src, keep, rect) {
    const L = V3.layout, { layer, id } = src || f.layout, saved = L[layer];
    let it = saved.find((q) => q.id === id);
    if (rect) it = Object.assign({}, it, { x0: rect[0], z0: rect[1], x1: rect[2], z1: rect[3] });
    const ctx = { studio: true, glowMat: (c, o) => Object.assign(new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, vertexColors: !!(o && o.vertexColors) }), { userData: { glow: Object.assign({}, o) } }), lamp: () => null, tickLights() {} };
    L[layer] = [it];
    let g; try { g = V3.furn.buildAll(ctx, layer); } finally { L[layer] = saved; }
    const o = g.children.find((q) => q.name === 'furn:' + id);
    o.removeFromParent();
    if (!keep) { o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); }
    o.traverse((m) => { if (m.isMesh) { m.castShadow = !m.userData.noShadow; m.receiveShadow = true; } });
    return o;
  }
  // ---- 第 3 轮：体素版在场景部件里（55-house-detail、56-furn-beach、58-plants）：部件建一次，按名字取物体 ----
  // srcs：[{ part, name, m（place 的：物体 → 世界的矩阵，Node 里算好的；没有 = 照场景里的位置）, straight（去掉倾斜） }]
  let PARTS = null;
  function partObj(part, name) {
    if (!PARTS) {
      PARTS = {};
      const ctx = V3.scene.ctx(new T.Group(), { studio: true });
      for (const id of ['house-detail', 'furn-beach', 'plants']) {
        const g = new T.Group(); for (const o of [].concat(V3.scene.parts.find((p) => p.id === id).build(ctx) || [])) g.add(o);
        g.updateMatrixWorld(true); PARTS[id] = g;
      }
    }
    let o = null; PARTS[part].traverse((m) => { if (!o && m.name === name) o = m; });
    if (!o) throw new Error(part + ' 里没有 ' + name);
    return o;
  }
  function partVoxels(srcs) {
    const g = new T.Group();
    for (const s of srcs) {
      const o = partObj(s.part, s.name), mw = o.matrixWorld.clone();
      o.removeFromParent();
      if (s.straight) o.traverse((q) => { if (q !== o) q.rotation.set(0, 0, 0); });
      o.matrixAutoUpdate = false; o.matrix.copy(s.m ? new T.Matrix4().fromArray(s.m) : mw);
      o.traverse((m) => { if (m.isMesh) { m.castShadow = !m.userData.noShadow; m.receiveShadow = true; } });
      g.add(o);
    }
    return g;
  }
  // ---- MC 版：这件朝着体素版的方向（rot 180 → south，0 → north），体素原点放到世界原点 ----
  function mcModel(f, off) {
    const facing = f.rot === 180 ? 'south' : 'north', M = V3.furnMc, cs = M.cellsFor(f, facing);
    const lo = [0, 1, 2].map((a) => Math.min(...cs.map((c) => c.offset[a]))), hi = [0, 1, 2].map((a) => Math.max(...cs.map((c) => c.offset[a])) + 1);
    const W = hi[0] - lo[0], H = hi[1] - lo[1], Lz = hi[2] - lo[2], palette = ['minecraft:air'], cells = new Array(W * H * Lz).fill(0);
    for (const c of cs) {
      palette.push(M.state(f, facing, c.part));
      const x = c.offset[0] - lo[0], y = c.offset[1] - lo[1], z = c.offset[2] - lo[2];
      cells[x + z * W + y * W * Lz] = palette.length - 1;
    }
    const pN = [(off[0] / 2 + 0.25) / 16, 0, (off[2] / 2 + 0.25) / 16], p = M.rotatePoint(pN, facing);   // 体素原点在主格里的位置
    return { model: { size: [W, H, Lz], palette, cells }, shift: [-(p[0] - lo[0]), -(0 - lo[1]), -(p[2] - lo[2])] };
  }
  // ---- 第 2 轮：MC 版照房子里的摆法（f.house）放在场景坐标里，和照布局摆好的体素版自然对齐 ----
  function mcModelWorld(f) {
    const M = V3.furnMc, h = f.house, cs = M.cellsFor(f, h.facing);
    const main = { north: [h.xs[0], h.zs[0]], south: [h.xs[1], h.zs[1]], east: [h.xs[1], h.zs[0]], west: [h.xs[0], h.zs[1]] }[h.facing];
    const lo = [0, 1, 2].map((a) => Math.min(...cs.map((c) => c.offset[a]))), hi = [0, 1, 2].map((a) => Math.max(...cs.map((c) => c.offset[a])) + 1);
    const W = hi[0] - lo[0], H = hi[1] - lo[1], Lz = hi[2] - lo[2], palette = ['minecraft:air'], cells = new Array(W * H * Lz).fill(0);
    for (const c of cs) {
      palette.push(M.state(f, h.facing, c.part));
      cells[(c.offset[0] - lo[0]) + (c.offset[2] - lo[2]) * W + (c.offset[1] - lo[1]) * W * Lz] = palette.length - 1;
    }
    return { model: { size: [W, H, Lz], palette, cells }, shift: [main[0] + lo[0], h.ys[0] + lo[1], main[1] + lo[2]] };
  }
  const lin = (c) => Math.pow(Math.max(0, c), 2.2);
  function makeTex(atlas) {   // 和 54-house-mc 一样
    const lv = atlas.levels, tex = new T.DataTexture(lv[0], atlas.width, atlas.height, T.RGBAFormat, T.UnsignedByteType);
    if (lv.length > 1) { tex.mipmaps = lv.map((data, i) => ({ data, width: Math.max(1, atlas.width >> i), height: Math.max(1, atlas.height >> i) })); tex.minFilter = T.NearestMipmapLinearFilter; }
    else tex.minFilter = T.NearestFilter;
    tex.magFilter = T.NearestFilter; tex.generateMipmaps = false; tex.flipY = false; tex.unpackAlignment = 1;
    tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
    if ('colorSpace' in tex) tex.colorSpace = T.SRGBColorSpace; else tex.encoding = 3001;
    tex.needsUpdate = true;
    return tex;
  }
  function litMc(res) {   // 和 54-house-mc 一样：贴图 × AO（转成线性），MeshStandardMaterial 受灯光照
    const g = new T.Group(), tex = makeTex(res.atlas);
    for (const k of ['solid', 'cutout', 'entity', 'translucent']) {
      const Ly = res.layers[k]; if (!Ly || !Ly.quads) continue;
      const geo = new T.BufferGeometry(), col = Float32Array.from(Ly.color, lin);
      geo.setAttribute('position', new T.BufferAttribute(Ly.position, 3)); geo.setAttribute('uv', new T.BufferAttribute(Ly.uv, 2));
      geo.setAttribute('color', new T.BufferAttribute(col, 3)); geo.setIndex(new T.BufferAttribute(Ly.index, 1)); geo.computeVertexNormals();
      const o = { map: tex, vertexColors: true, roughness: 0.92, metalness: 0 };
      if (k === 'cutout') o.alphaTest = 0.5; if (k === 'entity') o.alphaTest = 0.1; if (k === 'translucent') Object.assign(o, { transparent: true, depthWrite: false });
      const m = new T.Mesh(geo, new T.MeshStandardMaterial(o)); m.castShadow = k !== 'translucent'; m.receiveShadow = true; m.renderOrder = k === 'translucent' ? 2 : 0;
      g.add(m);
    }
    return g;
  }
  // ---- 拼图 ----
  const LW = 170, HD = 138, PAD = 10, FONT = '"Microsoft YaHei", "微软雅黑", "PingFang SC", sans-serif';
  const ROWS = ['体素版\n（现在网页里的）', 'MC 模型\n（网页里的画法，\n同样的灯光）', 'MC 模型\n（MC 游戏里的光照）'];
  const ROWS4 = ['简化前\n（MC 模型，\n网页里的画法）', '简化后\n（MC 模型，\n网页里的画法）', '简化后\n（MC 游戏里的光照）'];   // 第 4 轮
  async function one(f, info) {
    let vobj, turn = 0;
    if (f.vox) {                                     // 第 3 轮：场景部件里的体素版（照场景位置，或者 Node 算好的摆法），和 MC 版都在场景坐标里
      vobj = partVoxels(info.srcs);
      turn = { south: 0, east: 90, north: 180, west: -90 }[f.house.facing];
    } else if (f.house) {                            // 第 2 轮：体素版和 MC 版都在场景坐标里（房子里的位置），机位跟着正面转
      vobj = new T.Group();
      [f.layout, ...(f.extra || [])].forEach((s, i) => vobj.add(voxelObj(f, s, true, i ? null : f.voxRect)));
      turn = { south: 0, east: 90, north: 180, west: -90 }[f.house.facing];
    } else vobj = voxelObj(f);
    vobj.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(vobj), c = box.getCenter(new T.Vector3()), r = Math.max(0.35, box.getSize(new T.Vector3()).length() / 2);
    const fy = f.vox ? f.house.ys[0] : f.house ? (f.layout.layer === 'loft' ? V3.layout.house.loftY : V3.layout.house.floorY) : 0;   // 地板：这件所在的那层（第 3 轮：方块底）
    const { model, shift } = f.house ? mcModelWorld(f) : mcModel(f, info.off);
    const opt = { pack: D.packObj, ao: true, light: false, mipmaps: true };
    const resLit = await V3.mcmesh.build(model, Object.assign({ cardinal: false }, opt)), resMc = await V3.mcmesh.build(model, opt);
    const resOld = D.packBefore ? await V3.mcmesh.build(model, Object.assign({ cardinal: false }, opt, { pack: D.packBeforeObj })) : null;   // 第 4 轮：简化前
    for (const res of [resLit, resMc].concat(resOld ? [resOld] : [])) {
      if (res.stats.missingStates.length || res.stats.missingSprites.length || res.stats.fallback) out.errors.push(f.id + '：MC 模型缺东西 ' + JSON.stringify({ st: res.stats.missingStates, sp: res.stats.missingSprites, fb: res.stats.fallback, w: res.warnings }));
    }
    const mlit = litMc(resLit); mlit.position.set(...shift);
    const mmc = V3.mcthree.group(resMc); mmc.position.set(...shift);
    let first = vobj;
    if (resOld) { first = litMc(resOld); first.position.set(...shift); }
    const scA = litScene(first, c, r, fy), scB = litScene(mlit, c, r, fy), scC = new T.Scene();
    scC.background = new T.Color(0xc6d8ea);
    const fl = new T.Mesh(new T.PlaneGeometry(40, 40), new T.MeshBasicMaterial({ color: new T.Color().setRGB(0.78, 0.75, 0.69) })); fl.rotation.x = -Math.PI / 2; fl.position.set(c.x, fy - 0.0005, c.z); scC.add(fl, mmc);
    const cv = document.createElement('canvas'); cv.width = LW + VIEWS.length * TW + PAD * (VIEWS.length + 1); cv.height = HD + 3 * TH + PAD * 4;
    const g2 = cv.getContext('2d');
    g2.fillStyle = '#ffffff'; g2.fillRect(0, 0, cv.width, cv.height);
    g2.fillStyle = '#1d2733'; g2.font = 'bold 30px ' + FONT; g2.textBaseline = 'top';
    g2.fillText(info.title, PAD, 12);
    g2.font = '19px ' + FONT; g2.fillStyle = '#34404e';
    info.lines.forEach((l, i) => g2.fillText(l, PAD, 52 + i * 26));
    VIEWS.forEach((v, j) => {
      const cam = camFor(v, c, r, turn), x = LW + PAD + j * (TW + PAD);
      g2.fillStyle = '#5a6675'; g2.font = 'bold 18px ' + FONT; g2.fillText(v.name, x + 6, HD - 26);
      [[lit, scA], [lit, scB], [mcr, scC]].forEach(([R, S], i) => {
        R.render(S, cam);
        g2.drawImage(R.domElement, x, HD + i * (TH + PAD), TW, TH);
      });
    });
    (D.packBefore ? ROWS4 : ROWS).forEach((t, i) => {
      g2.fillStyle = '#1d2733'; g2.font = 'bold 19px ' + FONT;
      t.split('\n').forEach((l, k) => { g2.font = (k ? '16px ' : 'bold 19px ') + FONT; g2.fillText(l, PAD, HD + i * (TH + PAD) + 14 + k * 24); });
    });
    out.images[f.id] = cv.toDataURL('image/png');
    out.stats[f.id] = { lit: resLit.stats.quads, mc: resMc.stats.quads, warnings: resLit.warnings };
    V3.mcthree.dispose(mmc);
  }
  (async () => {
    try {
      const files = new Map(Object.entries(D.pack).map(([k, v]) => [k, b64(v)]));
      D.packObj = V3.mcjar.makePack(files, { key: 'furn-preview' });
      if (D.packBefore) D.packBeforeObj = V3.mcjar.makePack(new Map(Object.entries(D.packBefore).map(([k, v]) => [k, b64(v)])), { key: 'furn-preview-before' });
      for (const info of D.list) await one(V3.furnMc.byId(info.id), info);
      out.windowErrors = (window.__errors || []).slice(0, 20);
    } catch (e) { out.errors.push(String(e && e.stack || e)); }
    out.done = true;
  })();
}

function pageHtml(data) {
  const parts = MODULES.map((f) => `<script>/* ${f} */\n${esc(fs.readFileSync(path.join(SRC, f), 'utf8'))}\n</script>`);
  return ['<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>furn preview</title></head><body>',
    `<script>window.__V3_BUILD='furn-preview';window.__V3_PAGE='furn-preview';window.__V3_NO_FB=true;window.__FURN=${JSON.stringify(data)};</script>`,
    `<script>${esc(fs.readFileSync(VENDOR_THREE, 'utf8'))}</script>`, ...parts,
    `<script>(${pageMain.toString()})();</script>`, '</body></html>'].join('\n');
}

// questions.json（第 1 轮）
export function questions(infos) {
  const by = Object.fromEntries(infos.map((i) => [i.id, i]));
  const sum = (id, extra) => { const i = by[id]; return `${i.lines[0]}。${i.lines[1]}。${extra}`; };
  return {
    round: 1,
    intro: 'P5 先试做的 3 件家具：网页里的体素家具自动转成了 MC 模型（Blockbench 工程在 models/furniture/，以后可以在 Blockbench 里改）。' +
      '每张图：上面一排是现在网页里的体素版，中间一排是转出来的 MC 模型用网页里一样的灯光画的（游戏页里就是这样），下面一排是 MC 游戏里的光照；4 列是 4 个角度。' +
      '看看样子行不行、哪里要改：可以在图上框出来写备注，也可以直接答下面的题。',
    project: [
      { id: 'p5-all', text: '3 件的样子整体行不行？', type: 'choice', options: ['行，剩下的家具也照这样转', '大体行，有几处要改（框出来或写在备注里）', '不行，要换做法'], other: true },
      { id: 'p5-tex', text: '细节（半个 MC 像素一格）在 MC 里看着会比原版方块细一倍，这样可以吗？', type: 'choice', options: ['可以', '太细了，想要和原版一样粗（1 个 MC 像素）'], other: true },
    ],
    images: {
      'drafts/01-bed.png': {
        summary: sum('bed', '床改成 1 米宽（原来 1.2 米），1 × 2 格，床头朝北。被子、枕头、叠好的睡衣都保留；枕头上斜着放的睡帽在 MC 里只能用正的小方块拼，看着会粗一点。'),
        questions: [
          { id: 'bed-ok', text: '床的 MC 模型行不行？', type: 'choice', options: ['行', '要改（框出来或写备注）'] },
          { id: 'bed-cap', text: '枕头上的睡帽（MC 版是小方块拼的）要不要留？', type: 'choice', options: ['留着', '去掉', '换个摆法（写备注）'] },
        ],
      },
      'drafts/02-dining_table.png': {
        summary: sum('dining_table', '餐桌改成 1 × 1 米（原来 1.4 × 1 米）。'),
        questions: [
          { id: 'dining-ok', text: '餐桌的 MC 模型行不行？', type: 'choice', options: ['行', '要改（框出来或写备注）'] },
          ...(by.dining_table.clipped ? [{ id: 'dining-fit', text: '桌子变窄以后，两头的盘子和杯子落到桌边外面了，花也比 1 米高一点（MC 版把超出 1 格的裁掉了）。改成：盘子挪进桌面、花瓶矮一点，可以吗？', type: 'choice', options: ['可以，这样改', '别的改法（写备注）'] }] : []),
        ],
      },
      'drafts/03-shell_case.png': {
        summary: sum('shell_case', '贝壳柜改成 2 × 1 米（原来 2.4 × 1.19 米），深度不变；还是 4 × 3 = 12 个玻璃展示格（放收藏的贝壳）+ 2 排 16 个小抽屉，排得紧一点。MC 里占 2 格，贴着墙放。'),
        questions: [
          { id: 'shell-ok', text: '贝壳柜的 MC 模型行不行？', type: 'choice', options: ['行', '要改（框出来或写备注）'] },
          { id: 'shell-layout', text: '新的排法（展示格每格 0.4 × 0.16 米，抽屉 2 排 × 8 个）行不行？', type: 'choice', options: ['行', '展示格少几个、做大一点', '别的（写备注）'] },
        ],
      },
    },
  };
}

// 第 4 轮「简化」：简化前的 .bbmodel（老做法，每格不限元素数）在内存里重新生成；简化过的 = 老做法有一格超过 LIMIT（32）个元素的
const OLD = new Map();
export function oldBb(f) {
  if (!OLD.has(f.id)) OLD.set(f.id, makeBb(f, { lite: false }));
  return OLD.get(f.id);
}
export const simplified = () => furnMc().list.filter((f) => oldBb(f).stats.cells.some((c) => c.elements > LIMIT));
// 每轮的图：第 1 轮 3 张（床、餐桌、贝壳柜），第 2 轮 22 张（屋里剩下的），第 3 轮 15 张（屋外的；V3.furnMc 里 round 是几就是第几轮），
// 第 4 轮：简化过的每件一张（简化前 / 简化后）
export function imagesFor(round) {
  if (round === 1) return IMAGES;
  if (round === 4) return simplified().map((f, i) => [f.id, `4-${String(i + 1).padStart(2, '0')}-${f.id}.png`]);
  return furnMc().list.filter((f) => f.round === round).map((f, i) => [f.id, `${round}-${String(i + 1).padStart(2, '0')}-${f.id}.png`]);
}
const COLL = { box: '挡人', thin: '贴地（能走上去）', none: '不挡（挂墙 / 吊顶）' };
export async function renderPreview({ tile = [380, 290], root = REPO_DIR, round = 3, only = null } = {}) {
  const M = furnMc(), { files, list } = await buildFiles(root), pack = {};
  for (const [k, v] of files) if (k.startsWith('mod/src/main/resources/')) pack[k.slice('mod/src/main/resources/'.length)] = v.toString('base64');
  let before = null, packBefore = null;   // 第 4 轮：简化前的资源包
  if (round === 4) {
    before = await buildFiles(root, { bbOf: (f) => oldBb(f).bb }); packBefore = {};
    for (const [k, v] of before.files) if (k.startsWith('mod/src/main/resources/')) packBefore[k.slice('mod/src/main/resources/'.length)] = v.toString('base64');
  }
  const infos = [];
  for (const [id] of imagesFor(round)) {
    if (only && !only.includes(id)) continue;
    const f = M.byId(id), vr = voxelsOf(f), s = list.find((q) => q.id === id).stats;
    const vs = vr.voxSize.map((v) => v.toFixed(2)).join(' × ');
    const els = `元素 ${s.elements} 个` + (s.cells.length > 1 ? `（${s.cells.map((c) => (c.part === 'main' ? '' : c.part + ' 号格 ') + c.elements).join('、')}）` : '');
    const tex = `贴图 ${s.texture.map((t) => t.join(' × ')).join('、')} 像素`;
    const perCell = (st) => st.cells.map((c) => c.elements).join(' / ');
    const sb = before && before.list.find((q) => q.id === id).stats;
    const lines = round === 4 ? [
      `元素：简化前 ${sb.elements} 个（${s.cells.length > 1 ? '每格 ' + perCell(sb) : '1 格'}）→ 简化后 ${s.elements} 个（${s.cells.length > 1 ? '每格 ' + perCell(s) : '1 格'}，每格不超过 ${LIMIT}）` +
        `　贴图 ${sb.texture.map((t) => t.join(' × ')).join('、')} → ${s.texture.map((t) => t.join(' × ')).join('、')} 像素`,
      `MC 里：占 ${f.w || f.size[0]} × ${f.d || f.size[2]} × ${f.h || f.size[1]} 格（宽 × 深 × 高）　${[...new Set(f.cells.map((c) => COLL[Array.isArray(f.collide) ? f.collide[c.part | 0] : f.collide || 'box']))].join(' + ')}` +
        (f.light ? `　会亮（光 ${f.light}）` : '') + (f.overlay && f.overlay[0] === '*' ? '　网页里整件照旧用体素版（会随风摆）' : f.overlay && f.overlay.length ? '　网页里会动 / 会亮的部分照旧用体素版叠上去' : ''),
    ] : f.round >= 2 ? [
      `MC 里：占 ${f.w} × ${f.d} × ${f.h} 格（宽 × 深 × 高）　${els}　${tex}` +
        `　${[...new Set(f.cells.map((c) => COLL[Array.isArray(f.collide) ? f.collide[c.part | 0] : f.collide || 'box']))].join(' + ')}` + (f.light ? `　会亮（光 ${f.light}）` : ''),
      `体素版：${vs} 米，${vr.vox.size} 个体素` + (vr.clipped.outside ? `；超出格子的 ${vr.clipped.outside} 个裁掉了（${[...vr.clipped.where].map(([t, n]) => t + ' ' + n).join('、')}）` : '') +
        (vr.reach ? `；伸出格子的 ${vr.reach} 个（只是画出来，不挡人）` : '') +
        (f.overlay && f.overlay[0] === '*' ? '　网页里整件照旧用体素版（会随风摆）' : f.overlay && f.overlay.length ? '　网页里会动 / 会亮的部分照旧用体素版叠上去' : ''),
    ] : [
      `MC 里：占 ${f.size[0]} × ${f.size[1]} × ${f.size[2]} 格（宽 × 高 × 深）　${els}　${tex}（32 像素 / 格）`,
      `体素版：${vs} 米，${vr.vox.size} 个体素（1/32 米一格 = 半个 MC 像素）` + (vr.clipped.outside ? `；超出格子的 ${vr.clipped.outside} 个体素裁掉了（${[...vr.clipped.where].map(([t, n]) => t + ' ' + n).join('、')}）` : ''),
    ];
    const srcs = f.vox ? f.vox.map((q) => { const sm = sourceMatrices(f, q); return { part: q.part, name: q.name, straight: !!q.straight, m: sm.objToWorld ? sm.objToWorld.toArray() : null }; }) : null;
    infos.push({ id, off: vr.off, title: `${f.label}　${f.block}`, lines, stats: s, before: sb, voxSize: vr.voxSize, clipped: vr.clipped.outside, srcs });
  }
  const html = pageHtml({ pack, packBefore, list: infos, tile, views: VIEWS });
  const srv = await serveFiles({ '/preview.html': Buffer.from(html, 'utf8') });
  const browser = await launchBrowser({ width: 1280, height: 900 });
  try {
    const page = await browser.newPage(), perr = [];
    page.on('pageerror', (e) => perr.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') perr.push(m.text()); });
    await page.goto(srv.url + '/preview.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__furnPreview && window.__furnPreview.done, { timeout: 600000, polling: 1000 });
    const r = await page.evaluate(() => window.__furnPreview);
    r.pageErrors = perr;
    return { r, infos };
  } finally { await browser.close().catch(() => {}); await srv.close(); }
}

// questions.json 第 2 轮
const Q2 = {
  kitchen_counter: '厨房台面缩到 4 米：灶台挪到调料罐架下面，水槽对着北窗，台面上的锅、龙头、电饭煲都矮了一点（1 格高以内），水果碗挪到灶台和水槽之间。',
  bookshelf: '书架缩到 1 米宽、2 格高：柜子矮一点（4 层书还在），顶上的绿萝放得下。',
  mini_fridge: '小冰箱从 1.3 米矮到 1 米，门上她画的小画和冰箱贴、顶上的面包篮都还在。',
  picture_frames: '画框从 2.3 米缩到 2 米，每幅窄一点；MC 里的画是现在的占位小画（以后换成她画的，要重新导出一次）。',
  spice_rack: '调料罐架缩到 1 米宽，6 个罐子 + 小盆罗勒 + 下面挂的 3 个杯子。',
  string_lights: '串灯改成一格一段（1 米一段，挂钩在每段东头，两颗灯泡），房子里 12 段排成一排。',
  telescope: '望远镜使用倾斜镜筒与三脚架；横轴伸出筒身，调节钮和镜筒不再争同一块侧面。',
  living_rug: '地毯和小茶几合成一件（2 × 2 格），茶几在地毯西南那格。',
  photo_album_table: '相册矮桌缩到 1 米（1 格），放在格子中间。',
  floor_cushions: '两个坐垫缩到 2 米（2 格）。',
  storage_chests: '两个储物箱缩到 2 米（2 格），木箱和藤箱都窄了一点。',
  floor_plant: '大盆栽从 1.1 米矮到 1 米，叶子短一点。',
  door_mat: '门口地垫缩到 1 米，贴地，人能走上去。',
};
export function questions2(infos) {
  const M = furnMc(), images = {};
  for (const [id, name] of imagesFor(2)) {
    const i = infos.find((q) => q.id === id), f = M.byId(id);
    if (!i) continue;
    const qs = [{ id: id + '-ok', text: `${f.label}的 MC 模型行不行？`, type: 'choice', options: ['行', '要改（框出来或写备注）'] }];
    images['drafts/' + name] = { summary: `${i.lines[0]}。${i.lines[1]}。` + (Q2[id] || ''), questions: qs };
  }
  return {
    round: 2,
    intro: '第 2 轮：屋里剩下的家具全部转成了 MC 模型（22 种；两把餐椅是同一种，地毯和小茶几合成一件）。和第 1 轮一样，每张图上面一排是现在网页里的体素版，' +
      '中间一排是 MC 模型用网页里一样的灯光画的（游戏页里就是这样），下面一排是 MC 游戏里的光照；4 列是 4 个角度，都是从这件家具的正面看。' +
      '比格子大的几件缩了（厨房台面、书架、小冰箱、画框、调料罐架、相册矮桌、坐垫、储物箱、大盆栽、门口地垫），图下面写了改了什么。' +
      '电脑屏幕、台灯和串灯的灯泡、电视屏幕、碗里的米饭在网页里照旧会动、会亮（叠在方块上）；在 MC 里是不动的方块，灯和屏幕会发光。第 1 轮的 3 张图挪进了 trash/。',
    project: [
      { id: 'p5r2-all', text: '这 22 种的样子整体行不行？', type: 'choice', options: ['行', '大体行，有几处要改（框出来或写在备注里）', '不行，要换做法'], other: true },
      { id: 'p5r2-shrink', text: '缩小的那几件（厨房台面、书架、小冰箱、画框……）这样缩行不行？', type: 'choice', options: ['行', '有的要改（写在那张图的备注里）'] },
    ],
    images,
  };
}

// questions.json 第 3 轮（屋外的 15 种）
const Q3 = {
  beach_lounger: '躺椅 1 × 2 格，摆正了（原来微微斜着）；靠背是斜的，转 MC 时只能用正的小方块拼，看着会粗一点。叠着的毛巾、地上的人字拖都在。',
  beach_lounger_hat: '和另一张一样，椅子上放草帽和书。',
  beach_table: '小圆桌在两张躺椅的头中间；桌上的柠檬汁和鸡尾酒很小（体素版 1/128 米一格），MC 里只能粗略拼出来（半透明的杯子 + 果汁 / 酒的颜色）。',
  beach_parasol: '伞柱 3 格高，伞面在 2 米多那一格，伸出格子盖住两张躺椅（伸出去的没有碰撞，只有伞柱挡人）。MC 里是正的；网页里也挪到方块那格、改成正的（伞杆正好在挡人的位置），照旧随风摆。',
  crate_lantern: '木箱矮了 2 格，连上面的灯笼正好 1 米；摆正了（原来斜一点）。灯笼会亮（光 12），灯罩在 MC 里自己发亮。',
  flower_box_purple: '花箱 2 格长，挂在西南窗下；箱子和里面的紫花合成一件，花都在箱子的两头以内。',
  flower_box_pink: '花箱 2 格长，挂在东南窗下；箱子和里面的粉花合成一件。',
  towel_hook: '毛巾挂得低一点（整条在门右边那格墙上，1..2 米高）。',
  wind_chime: '风铃挂高了一点（整串在门上方那格里，3..4 米高）。MC 里不动；网页里照旧随风摆、会响。',
  wall_lantern: '门两边各一盏，会亮（光 12），灯罩在 MC 里自己发亮；网页里发光的灯罩照旧叠上去。',
  potted_fern: '蕨的叶子短了一点，整盆收进 1 格里。',
  hanging_basket: '吊篮改成立在东头栏杆柱顶上的一根竖杆，吊臂往西伸出去挂篮子（吊臂和篮子伸出格子，没有碰撞）。',
  flower_pot: '台阶东边的小花盆，挪到格子正中间。',
  succulents: '一格两小盆（大盆两朵、小盆一朵），台阶两边各一格、东边栏杆头上一格，3 处是同一种方块。',
  step_mat: '台阶下地垫 2 格宽，贴地，人能走上去（站立点就在这块地垫上）。',
};
export function questions3(infos) {
  const M = furnMc(), images = {};
  for (const [id, name] of imagesFor(3)) {
    const i = infos.find((q) => q.id === id), f = M.byId(id);
    if (!i) continue;
    images['drafts/' + name] = { summary: `${i.lines[0]}。${i.lines[1]}。` + (Q3[id] || ''),
      questions: [{ id: id + '-ok', text: `${f.label}的 MC 模型行不行？`, type: 'choice', options: ['行', '要改（框出来或写备注）'] }] };
  }
  return {
    round: 3,
    intro: '第 3 轮：屋外的小物件全部转成了 MC 模型（15 种、18 件：壁灯 2 盏、多肉 3 处是同一种方块）。和前两轮一样，每张图上面一排是现在网页里的体素版，' +
      '中间一排是 MC 模型用网页里一样的灯光画的，下面一排是 MC 游戏里的光照；4 列是 4 个角度，都是从这件东西的正面看。' +
      '为了放进格子，有几件挪了一点、矮了一点（木箱、毛巾、风铃、蕨、吊篮），图下面写了改了什么。遮阳伞的伞面、吊篮的吊臂伸出了自己那格（只是画出来，不挡人）。' +
      '风铃、遮阳伞在网页里照旧整件用体素版（会随风摆），壁灯和木箱上的灯笼照旧会亮。前两轮的图挪进了 trash/。',
    project: [
      { id: 'p5r3-all', text: '这 15 种的样子整体行不行？', type: 'choice', options: ['行', '大体行，有几处要改（框出来或写在备注里）', '不行，要换做法'], other: true },
      { id: 'p5r3-fit', text: '为了放进格子挪了 / 矮了的那几件（木箱、毛巾、风铃、蕨、吊篮）行不行？', type: 'choice', options: ['行', '有的要改（写在那张图的备注里）'] },
    ],
    images,
  };
}

// questions.json 第 4 轮「简化」（每格 ≤ 32 个元素，docs/FURNITURE.md 第 10 节）：简化过的每件一张
const Q4 = {
  bed: '床头那格的枕头、叠好的睡衣、睡帽合成了几块，样子没变。',
  dining_table: '桌布的垂边、盘子、杯子、花瓶和花都在；花和叶子是一块带透明缝的方块。',
  shell_case: '只是把不同部件的方块合在一起，样子没变（12 个展示格、玻璃、16 个小抽屉都在）。',
  bookshelf: '书一排排合成几块，高低不齐的书顶上是透明的；顶上的绿萝和垂下来的藤都在。',
  kitchen_counter: '灶台、锅、水槽、碗、电饭煲都在，台面上的小东西合得粗一点。',
  mini_fridge: '样子没变（门、把手、小画、冰箱贴、面包篮都在）。',
  desk: '样子没变。另外电脑屏幕的玻璃往里退了 7 毫米，网页里叠上去的屏幕画面不再被挡住。',
  rocking_chair: '椅背的一根根栏杆合成了一块，栏杆中间的缝用透明贴图（看过去还是一根根的）；弧形的摇椅底座、毛线篮都在。',
  tv_stand: '样子没变。电视面板往前挪了 1.7 厘米，贴着网页里叠上去的屏幕（原来屏幕浮在面板前面）。',
  sofa: '样子没变。',
  living_rug: '茶几上的点心、杂志合得粗一点，样子没变。',
  floor_plant: '一片片叶子合成了一簇簇的块，叶子中间的缝是透明的，还是一盆树。',
  telescope: '最难的一件：腿和镜筒本来就是斜的（用小方块拼成台阶状），简化后台阶更粗，腿有点疙疙瘩瘩，镜筒、三脚架、托盘都还在。',
  storage_chests: '样子没变。',
  beanbag: '圆的豆袋变成一层层的块；正面看差不多，从后面斜着看角上方一点。鲸鱼抱枕（连尾巴）还在。',
  beach_lounger: '斜的靠背还是台阶状的（和原来一样），毛巾、人字拖都在。',
  beach_lounger_hat: '同上，草帽和书都在。',
  beach_table: '样子没变（柠檬汁、鸡尾酒、吸管、小伞都在）。',
  beach_parasol: '照你说的：伞面变成一层一层的方块，一层比一层小；红白条纹画在贴图上，圆边外面的角是透明的，所以看着还是圆的。',
  flower_box_purple: '花丛合成了几层，花和叶子画在贴图上；垂在箱子前面的藤是带透明缝的薄片。',
  flower_box_pink: '同上。',
  potted_fern: '蕨叶最外面的几个叶尖没了（碰撞盒每边小了 1 像素），叶子之间的缝是透明的。',
  hanging_basket: '链子、斜撑、垂下来的藤是带透明缝的薄片，样子差不多。',
  flower_pot: '样子没变。',
  succulents: '样子没变。',
};
export function questions4(infos) {
  const M = furnMc(), images = {};
  for (const [id, name] of imagesFor(4)) {
    const i = infos.find((q) => q.id === id), f = M.byId(id);
    if (!i) continue;
    images['drafts/' + name] = { summary: `${i.lines[0]}。` + (Q4[id] || ''),
      questions: [{ id: id + '-ok', text: `${f.label}简化后行不行？`, type: 'choice', options: ['行', '要改（框出来或写备注）'] }] };
  }
  return {
    round: 4,
    intro: `第 4 轮「简化」：你说方块太多 MC 负担不了、每格不超过 ${LIMIT} 个，这一轮把超过的 ${Object.keys(images).length} 件都简化到了每格 ${LIMIT} 个以内（别的 15 件本来就不超过，没动）。` +
      '每张图上面一排是简化前的 MC 模型，中间一排是简化后的（同样的角度、网页里的画法），下面一排是简化后在 MC 游戏里的光照；图上写着每格的元素数前后。' +
      '做法：小方块尽量合成大块，合不下的小零件的样子画进贴图；合起来的块里原来是空的地方（椅背栏杆的缝、花丛的空隙、伞面圆边外面的角）用透明贴图，看过去还是空的。' +
      '碰撞没变（个别的每边最多小 1 像素），网页里会动 / 会亮的部分（屏幕、灯泡、碗里的饭）照旧叠在方块上。第 3 轮的图挪进了 trash/。',
    project: [
      { id: 'p5r4-all', text: '简化以后整体行不行？', type: 'choice', options: ['行', '大体行，有几处要改（框出来或写在备注里）', '不行，要换做法'], other: true },
      { id: 'p5r4-cut', text: '栏杆缝、花丛、伞面圆边用透明贴图（看着更像原来的）可以吗？', type: 'choice', options: ['可以', '不要透明的，宁可块是实心的、粗一点'], other: true },
    ],
    images,
  };
}

// 写图和 questions.json；换轮的时候把上一轮的图挪进 trash/（文件名前加时间，refkit 的规矩）
export async function writePreview({ root = REPO_DIR, dir = PREVIEW_DIR, round = 4 } = {}) {
  const { r, infos } = await renderPreview({ root, round, tile: round === 1 ? [380, 290] : [330, 250] }), log = [];
  if (r.errors.length || r.pageErrors.length) throw new Error('预览页出错：\n' + [...r.errors, ...r.pageErrors].join('\n'));
  const images = [], want = imagesFor(round);
  fs.mkdirSync(path.join(dir, 'drafts'), { recursive: true });
  const keep = new Set(want.map(([, n]) => n)), d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  for (const n of fs.readdirSync(path.join(dir, 'drafts'))) {
    if (!n.endsWith('.png') || keep.has(n)) continue;
    fs.mkdirSync(path.join(dir, 'trash'), { recursive: true });
    fs.renameSync(path.join(dir, 'drafts', n), path.join(dir, 'trash', `${stamp}__${n}`));
    log.push(`上一轮的 ${n} 挪进 trash/`);
  }
  for (const [id, name] of want) {
    const u = r.images[id]; if (!u) throw new Error('预览页没出 ' + id + ' 的图');
    const file = path.join(dir, 'drafts', name);
    fs.writeFileSync(file, Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'));
    images.push(file);
    log.push(`${name}：MC 网格 ${JSON.stringify(r.stats[id].lit)}`);
  }
  fs.writeFileSync(path.join(dir, 'questions.json'), JSON.stringify(round === 1 ? questions(infos) : round === 2 ? questions2(infos) : round === 3 ? questions3(infos) : questions4(infos), null, 2) + '\n');
  if ((r.windowErrors || []).length) log.push('页面里的错误：' + r.windowErrors.join(' | '));
  return { dir, images, log, infos };
}
