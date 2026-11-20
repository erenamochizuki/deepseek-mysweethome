// furn-mc.mjs — P5 家具：网页里的体素家具 → Blockbench 工程 → MC 资源（docs/FURNITURE.md 第 4 节起）。规格在 web/src/44-furn-mc.js（V3.furnMc）。
// 用法（在 web/ 下）：
//   node tools/furn-mc.mjs bb [<id> …] [--force]   体素 → models/furniture/<id>.bbmodel（每格超过 32 个元素的简化到 32 以内，第 10 节）。已经有的不覆盖，要重做加 --force
//   node tools/furn-mc.mjs export                  .bbmodel → mod/src/main/resources/assets/xiaojingyu/（blockstates、models、textures、items）和 FurnitureShapes.java，只写有变化的
//   node tools/furn-mc.mjs check                   在内存里重新导出，和仓库里的逐字节比；不一样就失败（exit 1）
//   node tools/furn-mc.mjs preview [--round N]     出对比图 → web/refs/furniture-p5/（drafts/*.png + 这一轮的 questions.json，无头 Edge；不用原版贴图）。默认第 4 轮：简化前 / 简化后
//   node tools/furn-mc.mjs info                    每件的数：占几格、元素数、贴图大小、和体素版比
// <id> 是 V3.furnMc 里的 id（web/src/44-furn-mc.js）：bed、dining_table、shell_case、第 2 轮的 22 种、第 3 轮屋外的 15 种、第 5 轮的相框 photo_frame。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_DIR } from './lib/v3-node.mjs';
import { voxelsOf, furnMc } from './lib/furn-mc-vox.mjs';
import { toBbmodel, bbText } from './lib/furn-mc-bb.mjs';
import { exportOne, javaShapes, JAVA_FILE, placeholderShapes } from './lib/furn-mc-export.mjs';

export const REPO_DIR = path.resolve(WEB_DIR, '..');
export const BB_DIR = path.join(REPO_DIR, 'models', 'furniture');
export const ASSET_ROOT = 'mod/src/main/resources/assets/xiaojingyu';
// Original voxel pots with individually authored plant crowns.
export const REPLANTED = new Set(['potted_fern','succulents']);
export const HAND_MODELED = new Set(['telescope', 'kitchen_counter', 'bookshelf', 'sofa', 'mini_fridge', 'living_rug',
  'window_seat', 'storage_chests', 'beach_lounger', 'beach_lounger_hat',
  'flower_pot', 'flower_box_purple', 'flower_box_pink', 'hanging_basket', 'dining_table', 'dining_chair', 'beach_parasol']);
export const bbFile = (id, root = REPO_DIR) => path.join(root, 'models', 'furniture', id + '.bbmodel');
const rel = (p) => path.relative(REPO_DIR, p).split(path.sep).join('/');

// ---- bb ----
// opt.lite = false：简化前（第 1–3 轮的做法；预览图的「简化前」那排用）
export function makeBb(f, opt = {}) {
  const vr = opt.vr || voxelsOf(f), r = toBbmodel(f, vr, opt);
  return Object.assign(r, { vr, text: bbText(r.bb) });
}
export function writeBb(ids, { force = false, root = REPO_DIR, log = console.log } = {}) {
  const M = furnMc(), out = [];
  for (const id of ids.length ? ids : M.list.map((f) => f.id)) {
    const f = M.byId(id);
    if (!f) throw new Error(`没有这件家具：${id}（有：${M.list.map((q) => q.id).join('、')}）`);
    const file = bbFile(id, root);
    if (!ids.length && force && (HAND_MODELED.has(id) || REPLANTED.has(id)) && fs.existsSync(file)) {
      log(`  ${id}：保留手工 Blockbench 工程；要从旧体素覆盖，须单独指定 id 和 --force`);
      out.push({ id, written: false }); continue;
    }
    if (fs.existsSync(file) && !force) { log(`  ${id}：${rel(file)} 已经有了，没动（要重做加 --force）`); out.push({ id, written: false }); continue; }
    const r = makeBb(f);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, r.text);
    const c = r.vr.clipped;
    log(`  ${id}：写了 ${rel(file)}；${r.stats.cells.map((q) => `${q.part} ${q.elements} 个元素`).join('，')}；贴图 ${r.stats.texture.join(' × ')}；体素 ${r.vr.vox.size} 个` +
      (c.outside ? `；裁掉格子外面的 ${c.outside} 个体素（${[...c.where].map(([t, n]) => t + ' ' + n).join('、')}）` : '') +
      (r.vr.skipped.length ? `；跳过不是体素的网格 ${r.vr.skipped.join('、')}` : ''));
    out.push({ id, written: true, stats: r.stats, clipped: c });
  }
  return out;
}

// ---- export / check ----
// 仓库里的相对路径 → Buffer。opt.bbOf(f)：不读 .bbmodel 文件，用它给的对象（预览图的「简化前」：makeBb(f, { lite: false }).bb）
export async function buildFiles(root = REPO_DIR, opt = {}) {
  const M = furnMc(), files = new Map(), list = [], notes = [];
  for (const f of M.list) {
    const file = bbFile(f.id, root), given = opt.bbOf ? opt.bbOf(f) : null;
    if (!given && !fs.existsSync(file)) {
      if (!(f.round >= 2)) throw new Error(`没有 ${rel(file)}（先跑 node tools/furn-mc.mjs bb）`);
      list.push({ id: f.id, block: f.block, label: f.label, shapes: placeholderShapes(f), spec: f, placeholder: true });   // 先出接口：占位的盒子
      notes.push(`${f.id}：还没有 .bbmodel，FurnitureShapes 里先用占位的盒子`);
      continue;
    }
    const r = await exportOne(f, file, given ? { bb: given } : {});
    for (const [k, v] of r.files) files.set(k, v);
    list.push({ id: f.id, block: f.block, label: f.label, shapes: r.shapes, stats: r.stats, spec: f, photoSlots: r.photoSlots });
    notes.push(...r.notes);
  }
  files.set(JAVA_FILE, javaShapes(list));
  return { files, list, notes };
}
const isText = (n) => /\.(json|java)$/.test(n);
const sameBytes = (n, a, b) => (isText(n) ? a.toString('utf8').replace(/\r\n/g, '\n') === b.toString('utf8') : Buffer.compare(a, b) === 0);
// 生成器管的目录（多出来的文件也报）：blockstates / models / textures / items 下面我们这几件的
const OWNED = ['blockstates', 'models/block', 'models/item', 'textures/block', 'items'].map((d) => ASSET_ROOT + '/' + d);

export async function exportFiles(root = REPO_DIR) {
  const { files, list, notes } = await buildFiles(root), written = [];
  for (const [name, buf] of files) {
    const file = path.join(root, name);
    if (fs.existsSync(file) && sameBytes(name, fs.readFileSync(file), buf)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    written.push(name);
  }
  return { files: files.size, written, list, notes };
}
export async function checkFiles(root = REPO_DIR) {
  const { files, notes } = await buildFiles(root), problems = [];
  for (const [name, buf] of files) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) { problems.push(`${name}：没有这个文件（先跑 export）`); continue; }
    if (!sameBytes(name, fs.readFileSync(file), buf)) problems.push(`${name}：和重新导出的不一样（改过 .bbmodel 或工具就重新 export）`);
  }
  for (const d of OWNED) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const n of fs.readdirSync(dir)) if (!files.has(d + '/' + n)) problems.push(`${d}/${n}：多出来的文件（规格里没有，旧的请删掉）`);
  }
  return { files: files.size, problems, notes };
}

// ---- info ----
export async function info(root = REPO_DIR) {
  const M = furnMc(), rows = [];
  const { list } = await buildFiles(root);
  for (const f of M.list) {
    const vr = voxelsOf(f), s = list.find((q) => q.id === f.id).stats;
    rows.push({ id: f.id, label: f.label, block: f.block, size: f.size, cells: s.cells, texture: s.texture, elements: s.elements,
      voxSize: vr.voxSize, voxels: vr.vox.size, clipped: vr.clipped.outside, clippedWhere: [...vr.clipped.where], itemScale: s.itemScale });
  }
  return rows;
}

const USAGE = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 8).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');

async function main(argv) {
  switch (argv[0]) {
    case 'bb': {
      const ids = argv.slice(1).filter((a) => !a.startsWith('--'));
      const r = writeBb(ids, { force: argv.includes('--force') });
      console.log(`bb：写了 ${r.filter((q) => q.written).length} 个，没动 ${r.filter((q) => !q.written).length} 个`);
      break;
    }
    case 'export': {
      const r = await exportFiles();
      for (const n of r.written) console.log('写了 ' + n);
      for (const n of r.notes) console.log('  提醒：' + n);
      console.log(`导出完：写了 ${r.written.length} 个，没变 ${r.files - r.written.length} 个`);
      break;
    }
    case 'check': {
      const r = await checkFiles();
      for (const p of r.problems) console.log('  ' + p);
      console.log(r.problems.length ? `FAIL  ${r.problems.length} 处和重新导出的不一样` : `PASS  ${r.files} 个文件和重新导出的一样`);
      if (r.problems.length) process.exitCode = 1;
      break;
    }
    case 'preview': {
      const { writePreview } = await import('./lib/furn-mc-preview.mjs');
      const ri = argv.indexOf('--round'), r = await writePreview(ri > 0 ? { round: +argv[ri + 1] } : {});
      for (const l of r.log) console.log('  ' + l);
      console.log(`预览：${r.images.length} 张图 → ${rel(r.dir)}`);
      break;
    }
    case 'info': {
      for (const r of await info()) {
        console.log(`${r.label}（${r.block}）：占 ${r.size.join(' × ')} 格（宽 × 高 × 深）；体素版 ${r.voxSize.map((v) => v.toFixed(2)).join(' × ')} 米，${r.voxels} 个体素` +
          (r.clipped ? `，裁掉 ${r.clipped} 个（${r.clippedWhere.map(([t, n]) => t + ' ' + n).join('、')}）` : ''));
        console.log(`  元素 ${r.elements} 个（${r.cells.map((c) => `${c.part} ${c.elements}，外包盒 ${c.box.join(' ')}`).join('；')}）；贴图 ${r.texture.map((t) => t.join(' × ')).join('、')}；物品栏里缩到 ${r.itemScale}`);
      }
      break;
    }
    default: console.error(USAGE); process.exit(2);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) main(process.argv.slice(2)).catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(2); });
