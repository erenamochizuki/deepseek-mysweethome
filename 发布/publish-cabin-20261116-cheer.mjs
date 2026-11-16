// 发布 2026-11-16 的构建到在用的 haibian/web。
// 内容：捡到贝壳后的举手欢呼只演一遍（挥手一个来回 + 蹦一下），然后举着手保持约 3 秒；
//       举手角度从约 60 度降到约 40-45 度（手在脸颊外侧，不挡脸）。默认「蓝色大肥鱼」和导入的「冬装」共用同一套角度。
//   node 发布/publish-cabin-20261116-cheer.mjs            预览（跑内容自检，什么都不改）
//   node 发布/publish-cabin-20261116-cheer.mjs --apply    先备份再覆盖
//   node 发布/publish-cabin-20261116-cheer.mjs --rollback 用备份恢复
// 只覆盖 home.html / cabin.html / studio.html，更新 manifest.json 里三个页面的哈希。服务不用重启，浏览器 Ctrl+F5。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const STAGE = path.resolve(arg('--stage') || path.join(ROOT, 'web', 'dist'));
const LIVE = path.resolve(arg('--live') || ['../haibian/web', path.join(ROOT, 'cabin-dev-20261114', 'haibian', 'web')].find((p) => fs.existsSync(path.join(p, 'cabin.html'))) || '');
const BACKUP = path.join(LIVE, '..', '..', '_backups', 'cabin-publish-20261116-cheer', 'web-live-before');
const FILES = ['home.html', 'cabin.html', 'studio.html'];
const MANIFEST_NAMES = { 'home.html': '小鲸鱼之家.html', 'cabin.html': '海边小屋.html', 'studio.html': '工作台.html' };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--rollback') ? 'rollback' : 'dry';

if (!LIVE || !fs.existsSync(path.join(LIVE, 'cabin.html'))) { console.error('找不到要发布到的 haibian/web（用 --live 指定）：' + LIVE); process.exit(1); }
console.log('构建：' + STAGE + '\n发布到：' + LIVE + '\n备份：' + BACKUP + '\n');

if (mode === 'rollback') {
  if (!fs.existsSync(BACKUP)) { console.error('没有备份：' + BACKUP); process.exit(1); }
  for (const f of [...FILES, 'manifest.json']) { fs.copyFileSync(path.join(BACKUP, f), path.join(LIVE, f)); console.log('已恢复 ' + f); }
  console.log('回滚完成。浏览器 Ctrl+F5 强刷即可。');
  process.exit(0);
}

for (const f of FILES) {
  const next = fs.readFileSync(path.join(STAGE, f)), cur = fs.readFileSync(path.join(LIVE, f));
  console.log((sha(cur) === sha(next) ? '相同 ' : '覆盖 ') + ' ' + f + '  ' + cur.length + ' -> ' + next.length + '  sha256=' + sha(next).slice(0, 16));
}

// 发布前的闸：这份构建必须带着这次要上线的东西，也不能丢掉已经在线的
const home = fs.readFileSync(path.join(STAGE, 'home.html'), 'utf8');
const cabin = fs.readFileSync(path.join(STAGE, 'cabin.html'), 'utf8');
const both = (s) => home.includes(s) && cabin.includes(s);
const checks = [
  ['举手欢呼（cheerArms）', both('cheerArms') && both('CHEER_POSE')],
  ['欢呼只演一遍 + 保持（CHEER_HOLD）', both('CHEER_HOLD')],
  ['举手角度约 40-45 度（arm: [-40, 0, 75]）', both('CHEER_POSE = { arm: [-40, 0, 75]')],
  ['蹦交给模型 jump、不再用代码抬高度', both('CHEER_ACT = 0.12') && !both('HOP_H') && !both('HOP_N = ') ],
  ['保持时不再循环跳（cheerK）', both('cheerK') && both('CHEER_ACT')],
  ['欢呼用模型自带的 jump（cheer: [\'jump\', \'idle\']）', both("cheer: ['jump', 'idle']")],
  ['模型连成一体（soften / centroid uv）', both('ysm-centroid-uv') && both('smoothNormals')],
  ['收拾沙滩状态（actor:sweep）', both("'actor:sweep'") && both('sweepDue')],
  ['空闲消遣 + 一起看', both('startLeisure') && both('tvCompany')],
  ['行为状态机（startBehavior）', both('startBehavior')],
  ['导入模型表情（sameFaceAsFatfish）', both('sameFaceAsFatfish')],
  ['夜里上床睡觉', home.includes('V3.cabinNight') && cabin.includes('nightSleep')],
  ['阁楼望远镜（stargaze）', both('stargaze')],
  ['没有构建期语法错误标记', !/syntaxErrors=[1-9]/.test(home + cabin)],
];
let ok = true;
for (const [name, pass] of checks) { console.log((pass ? 'OK   ' : 'FAIL ') + name); if (!pass) ok = false; }
if (!ok) { console.error('构建不完整，已停止（什么都没改）。'); process.exit(1); }
if (mode === 'dry') { console.log('\n（只是预览。加 --apply 才会备份并覆盖。）'); process.exit(0); }

fs.mkdirSync(BACKUP, { recursive: true });
for (const f of [...FILES, 'manifest.json']) {
  const dst = path.join(BACKUP, f);
  if (!fs.existsSync(dst)) fs.copyFileSync(path.join(LIVE, f), dst);
}
console.log('已备份到 ' + BACKUP);
for (const f of FILES) {
  const tmp = path.join(LIVE, f + '.publishing');
  fs.copyFileSync(path.join(STAGE, f), tmp);
  fs.renameSync(tmp, path.join(LIVE, f));
  console.log('已覆盖 ' + f);
}
const mf = path.join(LIVE, 'manifest.json');
if (fs.existsSync(mf)) {
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  for (const [f, name] of Object.entries(MANIFEST_NAMES)) {
    const item = (manifest.files || []).find((x) => x.file === name);
    if (!item) continue;
    item.source = 'web/dist/' + f;
    const bytes = fs.readFileSync(path.join(LIVE, f));
    item.bytes = bytes.length; item.sha256 = sha(bytes);
  }
  manifest.publishedAt = new Date().toISOString();
  fs.writeFileSync(mf, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('已更新 manifest.json 的三个页面哈希');
}
console.log('\n发布完成。小屋服务不用重启；浏览器里 Ctrl+F5 强刷。回滚：同一脚本加 --rollback。');