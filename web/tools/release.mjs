// tools/release.mjs — v3 完成版：生成两个文件夹（2026-11-05 第9轮用户要的）
//   成品/反馈工作流/  工作台（3D 反馈 + 左边切到 2D 标注）、服务器、命令行工具、指引；演示：小鲸鱼之家（3D）、MyGO scene-01（2D）
//   成品/小鲸鱼之家/  只能玩的游戏页（双击就能玩）+ 接入说明 + 接口说明
// node tools/release.mjs [--out 成品] [--no-build]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, opt('out', '成品'));
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const fail = (msg) => { console.error('错误：' + msg); process.exit(1); };

// 1. 构建三个页面
let buildId = '';
if (!args.includes('--no-build')) {
  for (const p of ['studio', 'cabin', 'home']) {
    const r = build(p);
    if (r.errors.length) fail(`${p} 有 ${r.errors.length} 个模块语法错误，先修好再出成品`);
    buildId = r.id;
  }
} else {
  try { buildId = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'build.json'), 'utf8')).build; } catch (e) { buildId = '?'; }
}
const need = ['dist/studio.html', 'dist/cabin.html', 'dist/home.html', 'docs/成品/反馈工作流-使用指引.md', 'docs/成品/小鲸鱼之家-接入说明.md', 'docs/成品/小鲸鱼之家-接口说明.md'];
for (const f of need) if (!fs.existsSync(path.join(ROOT, f))) fail('缺少 ' + f);

const outRel = rel(OUT);
if (!outRel || outRel.startsWith('..')) fail('--out 要在工程目录里面');
const WF = path.join(OUT, '反馈工作流'), HOME = path.join(OUT, '小鲸鱼之家');
fs.rmSync(WF, { recursive: true, force: true });
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(WF, { recursive: true }); fs.mkdirSync(HOME, { recursive: true });
// 署名（refs/CREDITS.md 要求成品写明，不得商用）
const CREDIT = '角色设计：上善无形（ZipZipPipe），CC BY-NC-SA 4.0，不得商用。默认角色模型「蓝色大肥鱼」：ccci202（用户购买，作者同意修改并打包）。';
const stamp = `版本 ${buildId}\n生成于 ${new Date().toLocaleString('zh-CN', { hour12: false })}\n${CREDIT}\n`;

// 2. 小鲸鱼之家：游戏页 + 两份说明
fs.copyFileSync(path.join(ROOT, 'dist/home.html'), path.join(HOME, '小鲸鱼之家.html'));
fs.copyFileSync(path.join(ROOT, 'docs/成品/小鲸鱼之家-接入说明.md'), path.join(HOME, '接入说明.md'));
fs.copyFileSync(path.join(ROOT, 'docs/成品/小鲸鱼之家-接口说明.md'), path.join(HOME, '接口说明.md'));
fs.writeFileSync(path.join(HOME, '版本.txt'), stamp + '双击「小鲸鱼之家.html」就能玩（Edge / Chrome / Firefox）。存档在浏览器里。\n');

// 3. 反馈工作流：工程里能跑的部分（不带开发过程的杂物：archive、shots、test/tmp-*、成品本身）
const SKIP = [
  /^\.git(\/|$)/, /^archive(\/|$)/, /^shots(\/|$)/, /^data(\/|$)/, /^test\/tmp-/, /^feedback\/trash(\/|$)/,
  /^refs\/models\/tripo-ref\.glb$/,            // 本地才有的大文件（不进 git）
  /^dist\/home\.html$/,                        // 在「小鲸鱼之家」里
  /^docs\/成品(\/|$)/,                          // 下面单独放到对应位置
];
const skipOut = rel(OUT) + '/';
const filter = (src) => {
  const r = rel(src);
  if (!r) return true;
  if ((r + '/').startsWith(skipOut)) return false;
  return !SKIP.some(re => re.test(r));
};
const TOP = ['package.json', 'build.mjs', 'serve.mjs', '启动工作台.bat', '启动小屋.bat', '.gitignore',
  'src', 'dist', 'tools', 'test', 'vendor', 'assets', 'docs', 'feedback', 'refs', 'demos', 'node_modules'];
// 自己递归复制：这台机器上 fs.cpSync 遇到中文路径会让 Node 崩掉
const copyTree = (src, dst) => {
  if (!filter(src)) return;
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src)) copyTree(path.join(src, e), path.join(dst, e));
  } else fs.copyFileSync(src, dst);
};
for (const t of TOP) {
  const src = path.join(ROOT, t);
  if (!fs.existsSync(src)) { console.log('  （没有 ' + t + '，跳过）'); continue; }
  copyTree(src, path.join(WF, t));
}
fs.copyFileSync(path.join(ROOT, 'docs/成品/反馈工作流-使用指引.md'), path.join(WF, '使用指引.md'));
fs.writeFileSync(path.join(WF, '版本.txt'), stamp + '先看「使用指引.md」。双击「启动工作台.bat」开工作台（要 Node ≥ 24）。\n');

// 4. 汇总
const sizeOf = (dir) => { let n = 0, b = 0; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { n++; b += fs.statSync(p).size; } } }; walk(dir); return { n, mb: (b / 1048576).toFixed(1) }; };
const a = sizeOf(WF), b = sizeOf(HOME);
console.log(`成品 → ${outRel}/（版本 ${buildId}）`);
console.log(`  反馈工作流/  ${a.n} 个文件，${a.mb} MB`);
console.log(`  小鲸鱼之家/  ${b.n} 个文件，${b.mb} MB`);
console.log('RESULT: OK');
