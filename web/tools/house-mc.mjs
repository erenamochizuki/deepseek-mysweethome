// house-mc.mjs — 小鲸鱼之家 v4 方块房子的命令行（房子的数据来自 web/src/42-house-mc.js 的 V3.houseMc）
// 用法（在 web/ 下）：
//   node tools/house-mc.mjs export    重新生成 fixtures/house-v4/house-v4-b.png（鲸图）、.json（dump）和 web/assets/house/house-v4.png，只写有变化的
//   node tools/house-mc.mjs check     在内存里重新生成一遍，和仓库里的逐字节比；不一样就失败（exit 1）
//   node tools/house-mc.mjs info      打印尺寸、高度、门、楼梯、用到的方块、走路检查
//   node tools/house-mc.mjs drafts    重新生成 2D 图 web/refs/house-v4/drafts-src/*.svg → drafts/*.png（无头 Edge）；--all 全部重转
// check 同时查 2D 图：svg 逐字节比，png 只查在不在、尺寸对不对（浏览器画的字可能因机器而异）。
// 导出的都是默认材料（V3.houseMc.DEFAULTS：两色屋顶、平滑石英白墙）。鲸图里的图是南立面 + 俯视，颜色是我们自己的（17-mcfallback）。
// web/assets/house/house-v4.png 和 fixtures 里的 house-v4-b.png 是同样的字节：游戏页内嵌的房子（build.mjs 把 assets/ 打进页面）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_DIR } from './lib/v3-node.mjs';
import { formatJSON } from './lib/share-raw.mjs';
import { diffJSON } from './share.mjs';
import { v3, houseMc, openGrid, walk, parseState } from './lib/house-mc-grid.mjs';
import { previewPng } from './lib/house-mc-png.mjs';
import { checkDrafts, writeDrafts, REFS_DIR } from './lib/house-mc-drafts.mjs';

export const REPO_DIR = path.resolve(WEB_DIR, '..');
export const HOUSE_DIR = path.join(REPO_DIR, 'fixtures', 'house-v4');
export const ASSET_FILE = path.join(WEB_DIR, 'assets', 'house', 'house-v4.png');
const rel = (p) => path.relative(REPO_DIR, p).split(path.sep).join('/');

// 仓库里的相对路径 → 内容（Buffer）。.json 是 V3.share.dump（FORMAT.md §4），.png 是带 xjSc 块的鲸图
export async function buildFiles() {
  const S = v3().share, H = houseMc(), files = new Map();
  for (const { id } of H.variants) {
    const r = H.build({ variant: id });
    const png = Buffer.from(await S.writePng(r.model, previewPng(r)));
    files.set(rel(path.join(HOUSE_DIR, `house-v4-${id}.json`)), Buffer.from(formatJSON(S.dump(r.model)), 'utf8'));
    files.set(rel(path.join(HOUSE_DIR, `house-v4-${id}.png`)), png);
    if (id === H.DEFAULTS.variant) files.set(rel(ASSET_FILE), png);
  }
  return files;
}

export async function checkFiles(root = REPO_DIR) {
  const S = v3().share, want = await buildFiles(), problems = [];
  for (const [name, buf] of want) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) { problems.push(`${name}：没有这个文件（先跑 export）`); continue; }
    const have = fs.readFileSync(file);
    if (name.endsWith('.json')) {
      const a = have.toString('utf8').replace(/\r\n/g, '\n'), b = buf.toString('utf8');
      if (a === b) continue;
      let at;
      try { at = diffJSON(JSON.parse(a), JSON.parse(b)) || '只是排版不一样'; } catch (e) { at = '仓库里那份不是合法 JSON'; }
      problems.push(`${name}：内容不一样（第一处：${at}）`);
    } else if (Buffer.compare(have, buf) !== 0) {
      let same = false;
      try { same = S.equalDump(S.dump(await S.read(new Uint8Array(have))), S.dump(await S.read(new Uint8Array(buf)))); } catch (e) { same = false; }
      problems.push(`${name}：字节不一样（${same ? '方块数据一样，是图或压缩字节变了：改过预览图就重新 export；没改代码多半是 Node 的 zlib 变了' : '方块数据也不一样'}）`);
    }
  }
  const dir = path.join(root, rel(HOUSE_DIR));
  for (const n of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (/^house-v4-/.test(n) && !want.has(rel(path.join(HOUSE_DIR, n)))) problems.push(`${rel(HOUSE_DIR)}/${n}：多出来的文件（现在没有这个方案）`);
  }
  return { files: want.size, problems };
}

export async function exportFiles(root = REPO_DIR) {
  const files = await buildFiles();
  const written = [];
  for (const [name, buf] of files) {
    const file = path.join(root, name);
    if (fs.existsSync(file) && Buffer.compare(fs.readFileSync(file), buf) === 0) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    written.push(name);
  }
  return { files: files.size, written };
}

function info() {
  const H = houseMc();
  for (const { id, label } of H.variants) {
    const r = H.build({ variant: id }), i = r.info, G = openGrid(r);
    const w0 = walk(G), w1 = walk(G, { furniture: r.furniture });
    const steps = (w) => (w.ok ? `${w.path.length - 1} 步` : `走不通（${w.reason}）`);
    console.log(`\n${label}：屋顶${i.roof.label}，墙${i.wall.label}`);
    console.log(`  外墙 ${i.outer.join(' × ')} 格，室内 ${i.inner.join(' × ')} 格；模型 ${i.size.join(' × ')}，${i.blocks} 个方块，${i.palette} 种状态`);
    console.log(`  地面 ${i.floorY} 米，一楼净高 ${i.groundClear} 米，阁楼地板 ${i.loftFloorY} 米，矮墙 ${i.kneeWall} 米（墙顶 ${i.wallTop} 米），屋脊顶 ${i.ridgeTop} 米${i.cap ? '（含盖板）' : ''}，挑檐 ${i.overhang} 格`);
    console.log(`  阁楼净高（从南往北每排）：${i.loftClear.join(' / ')} 米`);
    console.log(`  门 x=${i.door.x}（${i.door.block}，${i.door.y0}–${i.door.y1} 米）；楼梯 x=${i.stairs.x}，z ${i.stairs.z0} → ${i.stairs.z1}，${i.stairs.steps} 级往${i.stairs.up === 'south' ? '南' : i.stairs.up}上；楼梯口 z ${i.stairs.hole[0]} → ${i.stairs.hole[1]}`);
    console.log(`  从台阶前走到阁楼：不算家具 ${steps(w0)}，算上家具 ${steps(w1)}`);
    const byBlock = new Map();
    r.model.cells.forEach((c) => {
      const b = parseState(r.model.palette[c]).id;
      if (b !== 'air') byBlock.set(b, (byBlock.get(b) || 0) + 1);
    });
    console.log('  方块：' + [...byBlock].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([b, n]) => `${b} ${n}`).join('，'));
    const moved = r.furniture.filter((f) => f.note);
    console.log(`  家具占位 ${r.furniture.length} 件` + (moved.length ? '；有说明的：' + moved.map((f) => `${f.label}（${f.note}）`).join('；') : ''));
  }
}

const USAGE = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 8)
  .map((l) => l.replace(/^\/\/ ?/, '')).join('\n');

async function main(argv) {
  switch (argv[0]) {
    case 'export': {
      const r = await exportFiles();
      for (const n of r.written) console.log('写了 ' + n);
      console.log(`导出完：写了 ${r.written.length} 个，没变 ${r.files - r.written.length} 个`);
      break;
    }
    case 'check': {
      const r = await checkFiles(), d = checkDrafts();
      for (const p of [...r.problems, ...d.problems]) console.log('  ' + p);
      const n = r.problems.length + d.problems.length;
      console.log(n ? `FAIL  ${n} 处和重新生成的不一样` : `PASS  ${r.files} 个文件 + ${d.files} 个 2D 图文件和重新生成的一样`);
      if (n) process.exitCode = 1;
      break;
    }
    case 'drafts': {
      const out = writeDrafts(REFS_DIR, { all: argv.includes('--all') });
      console.log(`2D 图：${out.length} 张，转了 ${out.filter((o) => o.png === '转了').length} 张（${rel(REFS_DIR)}）`);
      break;
    }
    case 'info': info(); break;
    default: console.error(USAGE); process.exit(2);
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) main(process.argv.slice(2)).catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(2); });
