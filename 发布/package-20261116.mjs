// 打包 2026-11-16 的可发布版本：默认角色只有 v1 小鲸鱼，蓝色大肥鱼 / 冬装 改成外部模型。
//   node 发布/package-20261116.mjs
// 产物：发布/海边小屋-20261116-可发布/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build-20261116-v6');
const LIVE = '../haibian/web';
const OUT = path.join(ROOT, '发布', '海边小屋-20261116-可发布');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

if (!fs.existsSync(path.join(BUILD, 'cabin.html'))) throw new Error('先构建到 build-20261116-v6（node build.mjs --no-builtin-girl）');
if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return { rel: path.relative(OUT, to).replace(/\\/g, '/'), bytes: fs.statSync(to).size };
}
const copied = [];
for (const f of ['home.html', 'cabin.html', 'studio.html']) copied.push(copy(path.join(BUILD, f), path.join(OUT, f)));
for (const f of ['cabin-bridge.js', 'cabin-bridge.css', 'cabin-gallery.js', 'cabin-gallery.css', 'house-v4.png', 'LICENSE.md', 'xiaojingyu-0.1.0.jar']) {
  copied.push(copy(path.join(LIVE, f), path.join(OUT, f)));
}
for (const f of fs.readdirSync(path.join(LIVE, '说明'))) copied.push(copy(path.join(LIVE, '说明', f), path.join(OUT, '说明', f)));

// 使用说明：在“网页和编辑器”前面插一节角色模型
const guide = fs.readFileSync(path.join(LIVE, '使用说明.md'), 'utf8');
const MODEL_SECTION = [
  '## 角色模型', '',
  '- 默认角色是**小鲸鱼 v1**（页面内置，不需要额外文件）。',
  '- 也可以在设置 →「角色」→「导入模型」里加载自己的 YSM 模型 zip；导入的模型只存在这台机器的浏览器里（IndexedDB），不随发布包分发。', '', ''
].join('\n');
const anchor = '\n## 网页和编辑器';
const patched = guide.includes(anchor) ? guide.replace(anchor, '\n' + MODEL_SECTION + '## 网页和编辑器') : guide + '\n' + MODEL_SECTION;
fs.writeFileSync(path.join(OUT, '使用说明.md'), patched.replace(/小鲸鱼 v1/g, '小鲸鱼'), 'utf8');


// manifest.json
const docs = [['house-v4.png', 'web/assets/house/house-v4.png'], ['xiaojingyu-0.1.0.jar', 'mod/build/libs/xiaojingyu-0.1.0.jar'],
  ['说明/PHOTOS.md', 'docs/PHOTOS.md'], ['说明/BLOCK-EDITOR.md', 'web/docs/BLOCK-EDITOR.md'], ['说明/INTEGRATION-V4.md', 'docs/INTEGRATION-V4.md'],
  ['使用说明.md', 'docs/RELEASE-V4.md'], ['LICENSE.md', 'LICENSE.md']];
const manifest = { createdAt: new Date().toISOString(), defaultModel: 'v1',
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
  '# 海边小屋 / 小鲸鱼之家 v1.0.0', '',
  '第一版成品：网页小屋 + 工作台 + Minecraft 模组。', '',
  '## 包里有什么', '',
  '- 小鲸鱼之家.html：游玩页（干净的玩法，不带调试工具）',
  '- 海边小屋.html：完整版（布置模式、房屋调试、?fb=1 反馈工具）',
  '- 工作台.html：模型预览 + 方块编辑器',
  '- cabin-bridge.*、cabin-gallery.*、manifest.json：本机集成用',
  '- 支持在设置 →「角色」→「导入模型」里加载自己的 YSM 模型 zip（不随包分发）',
  '- 说明/、使用说明.md：文档', '',
  '## 怎么放', '',
  '- 三页 + bridge + gallery + manifest.json 覆盖到 haibian/web/ 即可；服务不用重启，浏览器 Ctrl+F5',
  '- 默认角色是小鲸鱼（页面内置），不需要额外文件', '',
  '## 验证过', '',
  '- Edge 打开三页无报错；默认角色 bodyId = v1；页面里没有内嵌第三方模型资源',
  '- 大厅页面不内嵌任何第三方模型；本机导入 zip 后能正常切换角色', ''].join('\n');
fs.writeFileSync(path.join(OUT, '发布说明.md'), RELEASE_NOTE, 'utf8');

let total = 0;
for (const c of copied) total += c.bytes;
console.log('打包到 ' + OUT);
for (const f of fs.readdirSync(OUT)) console.log('  ' + f);
console.log('文件 ' + copied.length + ' 个，约 ' + (total / 1048576).toFixed(1) + ' MB');