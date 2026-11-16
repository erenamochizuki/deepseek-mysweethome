// 发布 2026-11-14 v5 的小屋网页构建到在用的 haibian/web。内容 = 11-14 那批（海胆/鲍壳三角面、睡觉不叠 idle_1、被子不透高亮）
// + v5（角色模型连成一体、收拾沙滩 + 举手欢呼、空闲消遣 + 一起看、跑着去、坐对椅子、坐台阶看海 + 随机动作、阁楼望远镜）。
//   node 发布/publish-cabin-20261114-v5.mjs                 预览（默认，什么都不改；跑内容自检）
//   node 发布/publish-cabin-20261114-v5.mjs --apply         先备份再覆盖
//   node 发布/publish-cabin-20261114-v5.mjs --rollback      用备份恢复（回到发布前那一版）
//   --live <haibian/web 目录>  指定发布到哪里。不给：原机器有 ../haibian/web 就发到那里；没有就发到这个包旁边的
//                              cabin-dev-20261114/haibian/web（解压的开发工程里那份线上页面）。
//   --stage <构建目录>         默认是这个脚本上一级的 build-20261114-v5。
// 只覆盖 home.html / cabin.html / studio.html / cabin-bridge.js（桥接和线上相同），更新 manifest.json 里三个页面的哈希；
// 备份在 <live>/../../_backups/cabin-publish-20261114-v5/web-live-before（只写第一次）。不重启服务、不动存档，浏览器 Ctrl+F5 生效。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const STAGE = path.resolve(arg('--stage') || path.join(ROOT, 'build-20261114-v5'));
const LIVE = path.resolve(arg('--live') || ['../haibian/web', path.join(ROOT, 'cabin-dev-20261114', 'haibian', 'web')].find((p) => fs.existsSync(path.join(p, 'cabin.html'))) || '');
const BACKUP = path.join(LIVE, '..', '..', '_backups', 'cabin-publish-20261114-v5', 'web-live-before');
const FILES = ['home.html', 'cabin.html', 'studio.html', 'cabin-bridge.js'];
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
  console.log(`${sha(cur) === sha(next) ? '相同 ' : '覆盖 '} ${f}  ${cur.length} → ${next.length}  sha256=${sha(next).slice(0, 16)}…`);
}
// 发布前的最后一道闸：这份构建必须带着这次要上线的东西
const home = fs.readFileSync(path.join(STAGE, 'home.html'), 'utf8');
const cabin = fs.readFileSync(path.join(STAGE, 'cabin.html'), 'utf8');
const bridge = fs.readFileSync(path.join(STAGE, 'cabin-bridge.js'), 'utf8');
const both = (s) => home.includes(s) && cabin.includes(s);
const checks = [
  // 以前已经上线的（不能丢）
  ['图鉴天气提示', both('说不定海浪就会把它带上岸')],
  ['拾取归属（playerFind）', both('playerFind')],
  ['行为状态机（startBehavior）', both('startBehavior')],
  ['A2 纹理模式设置', home.includes('mcTextureMode')],
  ['A3 部件按对象注销（untag）', home.includes('P.untag')],
  ['桥接层行为上报', bridge.includes("postJson('/behavior'") && bridge.includes('玩家捡到了')],
  ['眼睛全亮规则', both('isEyeGlowBone') && home.includes('眼睛发光（本游戏）')],
  ['电饭煲接上吃饭动作', both('mealReady') && home.includes("'actor:meal'")],
  ['饭碗端上桌', both('mealBowl') && home.includes('looseDish')],
  ['风铃 / 螃蟹可点', both('点击摇一摇') && both('crabStartle')],
  ['夜里上床睡觉', home.includes('V3.cabinNight') && cabin.includes('nightSleep')],
  ['跟随镜头', home.includes('V3.follow') && cabin.includes('hud-follow')],
  ['设置数值可输入', home.includes('U.numField') && cabin.includes('set-val')],
  ['导入模型表情', both('sameFaceAsFatfish')],
  ['不用 color-mix()', !/color-mix\(in srgb, var/.test(home) && !/color-mix\(in srgb, var/.test(cabin)],
  ['睡觉时藏睡衣睡帽', home.includes('setSleeper') && cabin.includes('bed-props')],
  ['夜里不捡贝壳（quitShell）', both('quitShell')],
  ['贝壳三角面（shellKit）', cabin.includes('V3.shellKit')],
  ['翻书不陷地（liftOf）', both('liftOf')],
  // 11-14（这次一起上线）
  ['idle_1 抑制（actorPosed）', home.includes('posed') && cabin.includes('actorPosed')],
  ['悬停高亮深度', home.includes('polygonOffsetUnits')],
  // v5
  ['模型连成一体（soften / centroid uv）', both('ysm-centroid-uv') && both('smoothNormals')],
  ['举手欢呼（cheerArms）', both('cheerArms') && both('CHEER_POSE')],
  ['收拾沙滩状态（actor:sweep）', both("'actor:sweep'") && both('sweepDue')],
  ['空闲消遣（watch_tv / album / sea）', both("watch_tv:") && both("album:") && both("sea:") && both('startLeisure')],
  ['一起看（join / tvCompany）', both('tvCompany') && both('cabin.join')],
  ['跑着去（HURRY_SPEED）', both('HURRY_SPEED')],
  ['坐在真正的座面上（SEATS）', both('seatHip')],
  ['看海随机动作（SEA_FIDGETS）', both('SEA_FIDGETS')],
  ['阁楼望远镜（stargaze / telescopeSetup）', both('stargaze') && both('telescopeSetup')],
  ['设置文字：收拾沙滩', both('小鲸鱼自己去收拾沙滩')],
  ['没有构建期语法错误标记', !/syntaxErrors=[1-9]/.test(home + cabin)],
];
let ok = true;
for (const [name, pass] of checks) { console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}`); if (!pass) ok = false; }
if (!ok) { console.error('构建不完整，已停止（什么都没改）。'); process.exit(1); }
if (mode === 'dry') { console.log('\n（只是预览。加 --apply 才会备份并覆盖。）'); process.exit(0); }

fs.mkdirSync(BACKUP, { recursive: true });
for (const f of [...FILES, 'manifest.json']) {
  const dst = path.join(BACKUP, f);
  if (!fs.existsSync(dst)) fs.copyFileSync(path.join(LIVE, f), dst);   // 只写一次：重复 --apply 不能用新文件盖掉真正的旧文件
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
    const bytes = fs.readFileSync(path.join(LIVE, f));
    item.bytes = bytes.length; item.sha256 = sha(bytes);
  }
  fs.writeFileSync(mf, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('已更新 manifest.json 的三个页面哈希');
}
console.log('\n发布完成。小屋服务不用重启；浏览器里 Ctrl+F5 强刷。回滚：同一脚本加 --rollback。');
