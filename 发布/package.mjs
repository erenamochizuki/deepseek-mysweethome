// 打包可发布版本（页面 + 本机集成文件 + 说明 + 模组），不含源码。在任何一台机器上都能跑：
//   node 发布/package.mjs [--live <本机小屋 web 目录>] [--version v1.1.0] [--build <已构建好的目录>] [--date 20261118]
//
// --live：本机小屋服务的 web 目录（cabin-bridge.*、cabin-gallery.*、说明/、使用说明.md、模组 jar 从这里拿）。不给就按顺序找：
//   环境变量 CABIN_LIVE → 仓库旁边的 deepseek-mysweethome-ext/haibian/web → D:/Dafeiyu/haibian/web。都没有就报错，列出找过的地方。
// --build：不给就自己构建一份（web/build.mjs --no-builtin-girl，输出到 build-<日期>/；默认角色只有 v1 小鲸鱼，不内嵌第三方模型）。
// 产物：发布/海边小屋-<日期>-可发布/（.gitignore 里，不进仓库）。之后压成 zip 传到 Releases，见 docs/PUBLISHING.md。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };
const p2 = (n) => String(n).padStart(2, '0');
const now = new Date();
const DATE = arg('date') || `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`;
const VERSION = arg('version') || 'v1.1.0';
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---- 本机小屋 web 目录 ----
const LIVE_TRIED = [arg('live'), process.env.CABIN_LIVE, path.resolve(ROOT, '..', 'deepseek-mysweethome-ext', 'haibian', 'web'), 'D:/Dafeiyu/haibian/web']
  .filter(Boolean).map((p) => path.resolve(p));
const LIVE = LIVE_TRIED.find((p) => fs.existsSync(path.join(p, 'cabin-bridge.js')));
if (!LIVE) {
  console.error('找不到本机小屋的 web 目录（要有 cabin-bridge.js）。找过：\n  ' + LIVE_TRIED.join('\n  ') + '\n用 --live <目录> 或环境变量 CABIN_LIVE 指定。');
  process.exit(1);
}

// ---- 构建 ----
let BUILD = arg('build') ? path.resolve(arg('build')) : null;
if (!BUILD) {
  BUILD = path.join(ROOT, `build-${DATE}`);
  console.log(`构建到 ${path.relative(ROOT, BUILD)}（--no-builtin-girl）…`);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'web', 'build.mjs'), '--no-builtin-girl', 'home', 'cabin', 'studio'],
    { cwd: path.join(ROOT, 'web'), env: { ...process.env, CABIN_BUILD_DIR: BUILD }, stdio: 'inherit' });
  if (r.status !== 0) { console.error('构建失败'); process.exit(1); }
}
for (const f of ['home.html', 'cabin.html', 'studio.html', 'inventory-rules.mjs']) {
  if (!fs.existsSync(path.join(BUILD, f))) { console.error(`构建目录里没有 ${f}：${BUILD}`); process.exit(1); }
}

const OUT = path.join(ROOT, '发布', `海边小屋-${DATE}-可发布`);
if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const copied = [];
function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied.push({ rel: path.relative(OUT, to).replace(/\\/g, '/'), bytes: fs.statSync(to).size });
}
for (const f of ['home.html', 'cabin.html', 'studio.html']) copy(path.join(BUILD, f), path.join(OUT, f));
// LICENSE 用仓库里的（本机那份可能写着不随包分发的第三方模型）
copy(path.join(ROOT, 'LICENSE.md'), path.join(OUT, 'LICENSE.md'));
for (const f of ['cabin-bridge.js', 'cabin-bridge.css', 'cabin-gallery.js', 'cabin-gallery.css', 'house-v4.png', 'xiaojingyu-0.1.0.jar']) {
  const from = path.join(LIVE, f);
  if (fs.existsSync(from)) copy(from, path.join(OUT, f)); else console.warn(`  （跳过：本机小屋目录里没有 ${f}）`);
}
if (fs.existsSync(path.join(LIVE, '说明'))) for (const f of fs.readdirSync(path.join(LIVE, '说明'))) copy(path.join(LIVE, '说明', f), path.join(OUT, '说明', f));
// 这一版新增：本机服务升级用的规则模块 + 两份给集成方的说明
copy(path.join(BUILD, 'inventory-rules.mjs'), path.join(OUT, '服务端', 'inventory-rules.mjs'));
for (const f of ['INVENTORY-V2.md', 'CABIN-TOOLS-BRIDGE.md']) copy(path.join(ROOT, 'docs', f), path.join(OUT, '说明', f));
const starLicense = 'd3-celestial-LICENSE.txt';
copy(path.join(ROOT, 'web', 'vendor', starLicense), path.join(OUT, '说明', starLicense));

// ---- 使用说明：本机小屋的那份 + 角色模型一节 + 这一版的新玩法 ----
let guide = fs.readFileSync(path.join(LIVE, '使用说明.md'), 'utf8');
const MODEL_SECTION = [
  '## 角色模型', '',
  '- 默认角色是**小鲸鱼**（页面内置，不需要额外文件）。',
  '- 也可以在设置 →「角色」→「导入模型」里加载自己的 YSM 模型 zip；导入的模型只存在这台机器的浏览器里（IndexedDB），不随发布包分发。', '', '',
].join('\n');
const PLAY_SECTION = [
  '## 贝壳、小店和沙盘（' + VERSION + '）', '',
  '- **每一枚贝壳都不一样**：冲上岸时就定好尺寸和花纹（原色、晚霞、雾蓝、环纹、斑点，稀有的白化、虹彩）。尺寸落在这一种的最大 / 最小 5% 内会得到**大金冠 / 小金冠**，收集盒卡片右上角会显示。收集盒详情里能看到每一枚的尺寸、花纹和捡到的时间。',
  '- **小店**（右下角「小店」）：清理门廊垃圾桶每件得 1 贝币；卖贝壳常见 1、少见 3、稀有 5 贝币。带王冠的和每种最后一枚默认不卖，摆着的不能卖。贝币可以买 32 种商品，新鲜水果、咸点与轻食、甜点和饮品各 8 种，可以分架查看。',
  '- **零食**（右下角「零食」）：按住一份拖到小鲸鱼身上喂她；杯装的拖杯子给她喝一口，一杯 3 口，喝完的空杯可以扔进垃圾桶再换 1 贝币。零食篮在小冰箱顶上，她闲着时偶尔会自己去拿一份吃。',
  '- **沙盘展示盒**（门廊靠墙、右窗下）：点它或收集盒里的按钮打开，把贝壳按真实大小拖到沙子上摆成图案；可以转、翻面、拍照。',
  '- **存档**：没有本机服务时收藏存在这个浏览器里（换浏览器前用收集盒的「导出收藏」）。接了本机小屋服务的，服务要按 `说明/INVENTORY-V2.md` 升级，并把 `服务端/inventory-rules.mjs` 放到 `cabin-inventory.mjs` 旁边；让对话里的她自己摆沙盘见 `说明/CABIN-TOOLS-BRIDGE.md`。', '', '',
].join('\n');
const anchor = '\n## 网页和编辑器';
guide = guide.includes(anchor) ? guide.replace(anchor, '\n' + MODEL_SECTION + PLAY_SECTION + '## 网页和编辑器') : guide + '\n' + MODEL_SECTION + PLAY_SECTION;
// 本机那份可能把第三方模型写成默认角色；发布包里默认是小鲸鱼，那个模型不随包分发
guide = guide.replace(/小鲸鱼 v1/g, '小鲸鱼').replace(/默认角色模型「[^」]*」[^。\n]*。/g, '');
fs.writeFileSync(path.join(OUT, '使用说明.md'), guide, 'utf8');

// ---- manifest.json ----
const docs = [['house-v4.png', 'web/assets/house/house-v4.png'], ['xiaojingyu-0.1.0.jar', 'mod/build/libs/xiaojingyu-0.1.0.jar'],
  ['说明/PHOTOS.md', 'docs/PHOTOS.md'], ['说明/BLOCK-EDITOR.md', 'web/docs/BLOCK-EDITOR.md'], ['说明/INTEGRATION-V4.md', 'docs/INTEGRATION-V4.md'],
  ['说明/INVENTORY-V2.md', 'docs/INVENTORY-V2.md'], ['说明/CABIN-TOOLS-BRIDGE.md', 'docs/CABIN-TOOLS-BRIDGE.md'],
  ['说明/' + starLicense, 'web/vendor/' + starLicense],
  ['服务端/inventory-rules.mjs', 'web/src/58-inventory-rules.js'], ['使用说明.md', 'docs/RELEASE-V4.md'], ['LICENSE.md', 'LICENSE.md']];
const manifest = { version: VERSION, createdAt: new Date().toISOString(), defaultModel: 'v1',
  note: '默认角色是小鲸鱼；其他 YSM 模型由使用者自行导入', files: [] };
const PAGES = { '小鲸鱼之家.html': 'home.html', '海边小屋.html': 'cabin.html', '工作台.html': 'studio.html' };
for (const [rel, src] of Object.entries(PAGES)) {
  const buf = fs.readFileSync(path.join(OUT, src));
  manifest.files.push({ file: rel, source: 'web/' + src, bytes: buf.length, sha256: sha(buf) });
}
for (const [rel, src] of docs) {
  const p = path.join(OUT, rel);
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  manifest.files.push({ file: rel, source: src, bytes: buf.length, sha256: sha(buf) });
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const RELEASE_NOTE = [
  `# 海边小屋 / 小鲸鱼之家 ${VERSION}`, '',
  '网页小屋 + 工作台 + Minecraft 模组。', '',
  '## 这一版新增', '',
  '- 贝壳个体化：每一枚有自己的尺寸和花纹，最大 / 最小的有大金冠 / 小金冠；收集盒里逐枚查看',
  '- 小店和贝币：清理垃圾、卖贝壳换贝币，购买水果和零食；拖一份喂小鲸鱼，她也会自己去零食篮拿',
  '- 门廊上的沙盘展示盒：把贝壳按真实大小摆成图案',
  '- 离线版（双击 HTML）也有全部 25 种收藏、海滩垃圾和摆件，和接本机服务的版本一样完整', '',
  '## 包里有什么', '',
  '- 小鲸鱼之家.html：游玩页（干净的玩法，不带调试工具）',
  '- 海边小屋.html：完整版（布置模式、房屋调试、?fb=1 反馈工具）',
  '- 工作台.html：模型预览 + 方块编辑器',
  '- cabin-bridge.*、cabin-gallery.*、manifest.json、服务端/inventory-rules.mjs：本机集成用',
  '- 支持在设置 →「角色」→「导入模型」里加载自己的 YSM 模型 zip（不随包分发）',
  '- 说明/、使用说明.md：文档', '',
  '## 怎么放', '',
  '- 只想玩：双击 小鲸鱼之家.html（推荐 Edge / Chrome），收藏存在浏览器里',
  '- 本机小屋服务：**先**按 说明/INVENTORY-V2.md 升级服务（inventory-rules.mjs 放到 cabin-inventory.mjs 旁边、备份 state/cabin-inventory.json、重启服务），' +
    '**再**把三页 + bridge + gallery + manifest.json 覆盖到 haibian/web/，浏览器 Ctrl+F5', '',
].join('\n');
fs.writeFileSync(path.join(OUT, '发布说明.md'), RELEASE_NOTE, 'utf8');

let total = 0;
for (const c of copied) total += c.bytes;
console.log(`本机小屋目录：${LIVE}`);
console.log(`打包到 ${OUT}`);
for (const f of fs.readdirSync(OUT)) console.log('  ' + f);
console.log(`文件 ${copied.length} 个，约 ${(total / 1048576).toFixed(1)} MB`);
