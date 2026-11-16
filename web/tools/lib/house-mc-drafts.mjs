// web/tools/lib/house-mc-drafts.mjs — 把小屋 v4 的 2D 草图写进 refkit 项目 web/refs/house-v4/
//   drafts-src/<名字>.svg  由 house-mc-sheets.mjs 生成（只用自己的颜色）
//   drafts/<名字>.png      由 tools/refkit/draw.mjs（无头 Edge）把 svg 转成 png
// questions.json 是手写的（问用户的问题），answers.json 是用户在 /2d/ 页面上填的，这里都不碰。
// PNG 是浏览器画的，不同机器上字体抗锯齿可能不一样，所以 check 只逐字节比 svg，png 只查在不在、尺寸对不对。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { WEB_DIR } from './v3-node.mjs';
import { DRAFTS } from './house-mc-sheets.mjs';

export const REFS_DIR = path.join(WEB_DIR, 'refs', 'house-v4');
const SRC = 'drafts-src', PNG = 'drafts';

// 名字 → svg 文本
export function buildDrafts() {
  return new Map(DRAFTS.map((d) => [d.name, d.svg()]));
}

const pngSize = (buf) => buf.length >= 24 && buf.toString('latin1', 12, 16) === 'IHDR' ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null;
const svgSize = (svg) => { const m = /width="(\d+)" height="(\d+)"/.exec(svg); return m ? [+m[1], +m[2]] : null; };

// 和重新生成的比：svg 逐字节一样，png 都在、尺寸和 svg 一样；多出来的 svg/png 也报出来
export function checkDrafts(dir = REFS_DIR) {
  const want = buildDrafts(), problems = [];
  for (const [name, svg] of want) {
    const sp = path.join(dir, SRC, name + '.svg'), pp = path.join(dir, PNG, name + '.png');
    if (!fs.existsSync(sp)) problems.push(`${SRC}/${name}.svg：没有（先跑 node tools/house-mc.mjs drafts）`);
    else if (fs.readFileSync(sp, 'utf8').replace(/\r\n/g, '\n') !== svg) problems.push(`${SRC}/${name}.svg：和重新生成的不一样（改过草图代码就重新跑 drafts）`);
    if (!fs.existsSync(pp)) { problems.push(`${PNG}/${name}.png：没有`); continue; }
    const a = pngSize(fs.readFileSync(pp)), b = svgSize(svg);
    if (!a || !b || a[0] !== b[0] || a[1] !== b[1]) problems.push(`${PNG}/${name}.png：尺寸 ${a} 和 svg 的 ${b} 不一样`);
  }
  for (const [sub, ext] of [[SRC, '.svg'], [PNG, '.png']]) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith(ext) && !want.has(f.slice(0, -ext.length))) problems.push(`${sub}/${f}：生成器里没有这张（旧的请挪到 trash/）`);
  }
  return { files: want.size * 2, problems };
}

// 写 svg（只写有变化的），再把变了的或缺 png 的转成 png。all = true 时全部重新转。
export function writeDrafts(dir = REFS_DIR, { all = false, log = console.log } = {}) {
  const want = buildDrafts(), out = [];
  fs.mkdirSync(path.join(dir, SRC), { recursive: true });
  fs.mkdirSync(path.join(dir, PNG), { recursive: true });
  for (const [name, svg] of want) {
    const sp = path.join(dir, SRC, name + '.svg'), pp = path.join(dir, PNG, name + '.png');
    const same = fs.existsSync(sp) && fs.readFileSync(sp, 'utf8') === svg;
    if (!same) fs.writeFileSync(sp, svg);
    if (same && fs.existsSync(pp) && !all) { out.push({ name, svg: '没变', png: '没变' }); continue; }
    const relWeb = (p) => path.relative(WEB_DIR, p).split(path.sep).join('/');
    const res = spawnSync(process.execPath, ['tools/refkit/draw.mjs', relWeb(sp), relWeb(pp)], { cwd: WEB_DIR, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`draw.mjs 转 ${name} 失败（exit ${res.status}）：${(res.stderr || res.stdout || '').trim().slice(0, 400)}`);
    out.push({ name, svg: same ? '没变' : '写了', png: '转了' });
    log(`  ${name}：svg ${same ? '没变' : '写了'}，png 转好了`);
  }
  return out;
}
