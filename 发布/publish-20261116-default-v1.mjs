// 发布 2026-11-16 可发布包（默认角色 v1，蓝色大肥鱼改外部模型）到在用的 haibian/web。
//   node 发布/publish-20261116-default-v1.mjs            预览（跑内容自检，什么都不改）
//   node 发布/publish-20261116-default-v1.mjs --apply    先备份再覆盖
//   node 发布/publish-20261116-default-v1.mjs --rollback 用备份恢复
// 只覆盖 home.html / cabin.html / studio.html 与 manifest.json；bridge / gallery / 模型 zip 不用动。
// 覆盖前请把 模型/*.zip 复制到 haibian/web/ 旁边（或任意位置），用户从设置里导入。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, '发布', '海边小屋-20261116-可发布');
const LIVE = 'D:/Dafeiyu/haibian/web';
const BACKUP = 'D:/Dafeiyu/_backups/cabin-publish-20261116-default-v1/web-live-before';
const FILES = ['home.html', 'cabin.html', 'studio.html'];
const NAMES = { 'home.html': '小鲸鱼之家.html', 'cabin.html': '海边小屋.html', 'studio.html': '工作台.html' };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--rollback') ? 'rollback' : 'dry';

if (!fs.existsSync(path.join(PKG, 'cabin.html'))) { console.error('先打包：node 发布/package-20261116.mjs'); process.exit(1); }
if (!fs.existsSync(path.join(LIVE, 'cabin.html'))) { console.error('找不到 haibian/web：' + LIVE); process.exit(1); }
console.log('包：' + PKG + '\n发布到：' + LIVE + '\n备份：' + BACKUP + '\n');

if (mode === 'rollback') {
  if (!fs.existsSync(BACKUP)) { console.error('没有备份：' + BACKUP); process.exit(1); }
  for (const f of [...FILES, 'manifest.json']) { fs.copyFileSync(path.join(BACKUP, f), path.join(LIVE, f)); console.log('已恢复 ' + f); }
  console.log('回滚完成。浏览器 Ctrl+F5 强刷。');
  process.exit(0);
}

for (const f of FILES) {
  const next = fs.readFileSync(path.join(PKG, f)), cur = fs.readFileSync(path.join(LIVE, f));
  console.log((sha(cur) === sha(next) ? '相同 ' : '覆盖 ') + ' ' + f + '  ' + cur.length + ' -> ' + next.length + '  sha256=' + sha(next).slice(0, 16));
}

const home = fs.readFileSync(path.join(PKG, 'home.html'), 'utf8');
const cabin = fs.readFileSync(path.join(PKG, 'cabin.html'), 'utf8');
const both = (s) => home.includes(s) && cabin.includes(s);
const checks = [
  // 页面源码里会提到 girl/fatfish-1.2.zip（BUILTIN 的 asset 名字），但只要没内嵌 base64 就不算带资源
  ['默认角色只剩 v1（没有内嵌 girl/ 资源）', !/"girl\/[^"]+":"[A-Za-z0-9+\/=]{100,}"/.test(home) && !/"girl\/[^"]+":"[A-Za-z0-9+\/=]{100,}"/.test(cabin)],
  ['没有自带角色时回退 v1（defaultId）', both('defaultId') && both("return b ? b.id : 'v1'")],
  ['只显示真正打包进来的自带模型', both('BUILTIN.filter(b => assetB64(b.asset))')],
  ['举手欢呼（cheerArms / CHEER_POSE）', both('cheerArms') && both('CHEER_POSE')],
  ['庆祝只演一遍 + 保持（CHEER_HOLD）', both('CHEER_HOLD')],
  ['举手角度 40-45 度（arm: [-40, 0, 75]）', both('CHEER_POSE = { arm: [-40, 0, 75]')],
  ['蹦交给模型 jump（cheer: jump/idle）', both("cheer: ['jump', 'idle']") && both('CHEER_ACT = 0.12')],
  ['行为状态机（startBehavior）', both('startBehavior')],
  ['收拾沙滩状态（actor:sweep）', both("'actor:sweep'")],
  ['夜里上床睡觉', home.includes('V3.cabinNight') && cabin.includes('nightSleep')],
  ['没有构建期语法错误标记', !/syntaxErrors=[1-9]/.test(home + cabin)],
];
let ok = true;
for (const [name, pass] of checks) { console.log((pass ? 'OK   ' : 'FAIL ') + name); if (!pass) ok = false; }
if (!ok) { console.error('包内容不完整，已停止（什么都没改）。'); process.exit(1); }
if (mode === 'dry') { console.log('\n（只是预览。加 --apply 才会备份并覆盖。）'); process.exit(0); }

fs.mkdirSync(BACKUP, { recursive: true });
for (const f of [...FILES, 'manifest.json']) {
  const dst = path.join(BACKUP, f);
  if (!fs.existsSync(dst)) fs.copyFileSync(path.join(LIVE, f), dst);
}
console.log('已备份到 ' + BACKUP);
for (const f of FILES) {
  const tmp = path.join(LIVE, f + '.publishing');
  fs.copyFileSync(path.join(PKG, f), tmp);
  fs.renameSync(tmp, path.join(LIVE, f));
  console.log('已覆盖 ' + f);
}
const mf = path.join(LIVE, 'manifest.json');
if (fs.existsSync(mf)) {
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  for (const [f, name] of Object.entries(NAMES)) {
    const item = (manifest.files || []).find((x) => x.file === name);
    if (!item) continue;
    const bytes = fs.readFileSync(path.join(LIVE, f));
    item.bytes = bytes.length; item.sha256 = sha(bytes);
  }
  manifest.defaultModel = 'v1';
  manifest.publishedAt = new Date().toISOString();
  fs.writeFileSync(mf, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('已更新 manifest.json（三个页面哈希 + defaultModel=v1）');
}
console.log('\n发布完成。服务不用重启；浏览器 Ctrl+F5。模型 zip 用设置里的「导入模型」加载。');