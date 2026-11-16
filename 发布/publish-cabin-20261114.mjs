// 发布 2026-11-14 的小屋网页构建（海胆/鲍壳改三角面 + 睡觉不叠 idle_1 + 被子里不再透出高亮；含之前全部内容）到 haibian/web。
//   node 发布\publish-cabin-20261114.mjs            预览（默认，什么都不改）
//   node 发布\publish-cabin-20261114.mjs --apply    先备份再覆盖
//   node 发布\publish-cabin-20261114.mjs --rollback 用备份恢复（回到 11-13 01:52 那版）
// 只覆盖 haibian/web 的 home.html / cabin.html / studio.html / cabin-bridge.js / manifest.json；不重启服务、不动存档、浏览器 Ctrl+F5 生效。
// 构建来源：_work/cabin-final-20261114/web（v3-20261114-1540，与当前源码一致）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const STAGE = '../_work/cabin-final-20261114/web';
const LIVE = '../haibian/web';
const BACKUP = '../_backups/cabin-publish-20261114/web-live-before';
const FILES = ['home.html', 'cabin.html', 'studio.html', 'cabin-bridge.js'];
const MANIFEST_NAMES = { 'home.html': '小鲸鱼之家.html', 'cabin.html': '海边小屋.html', 'studio.html': '工作台.html' };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--rollback') ? 'rollback' : 'dry';

function describe() {
  const rows = [];
  for (const f of FILES) {
    const next = fs.readFileSync(path.join(STAGE, f)), cur = fs.readFileSync(path.join(LIVE, f));
    rows.push({ file: f, liveBytes: cur.length, newBytes: next.length, same: sha(cur) === sha(next), newSha: sha(next).slice(0, 16) });
  }
  return rows;
}

if (mode === 'rollback') {
  if (!fs.existsSync(BACKUP)) { console.error('没有备份：' + BACKUP); process.exit(1); }
  for (const f of [...FILES, 'manifest.json']) {
    fs.copyFileSync(path.join(BACKUP, f), path.join(LIVE, f));
    console.log('已恢复 ' + f);
  }
  console.log('回滚完成。浏览器 Ctrl+F5 强刷即可。');
  process.exit(0);
}

const rows = describe();
for (const r of rows) console.log(`${r.same ? '相同 ' : '覆盖 '} ${r.file}  ${r.liveBytes} → ${r.newBytes}  sha256=${r.newSha}…`);
// 发布前的最后一道闸：这份构建必须带着这次要上线的东西，且没有构建期语法错误标记。
const home = fs.readFileSync(path.join(STAGE, 'home.html'), 'utf8');
const cabin = fs.readFileSync(path.join(STAGE, 'cabin.html'), 'utf8');
const bridge = fs.readFileSync(path.join(STAGE, 'cabin-bridge.js'), 'utf8');
const checks = [
  ['图鉴天气提示（home）', home.includes('说不定海浪就会把它带上岸')],
  ['图鉴天气提示（cabin）', cabin.includes('说不定海浪就会把它带上岸')],
  ['拾取归属（playerFind）', home.includes('playerFind') && cabin.includes('playerFind')],
  ['行为状态机（startBehavior）', home.includes('startBehavior')],
  ['A2 纹理模式设置', home.includes('mcTextureMode')],
  ['A3 部件按对象注销（untag）', home.includes('P.untag')],
  ['桥接层行为上报', bridge.includes("postJson('/behavior'") && bridge.includes('玩家捡到了')],
  ['眼睛全亮规则（isEyeGlowBone）', home.includes('isEyeGlowBone') && cabin.includes('isEyeGlowBone') && home.includes('眼睛发光（本游戏）')],
  ['电饭煲接上吃饭动作（actor:meal / mealReady）', home.includes("'actor:meal'") && home.includes('mealReady') && cabin.includes('mealReady')],
  ['饭碗端上桌（mealBowl / looseDish）', home.includes('mealBowl') && home.includes('looseDish') && cabin.includes('mealBowl')],
  ['风铃可点（点击摇一摇）', home.includes('点击摇一摇') && cabin.includes('点击摇一摇')],
  ['螃蟹可点（crabStartle）', home.includes('crabStartle') && cabin.includes('crabStartle') && home.includes('小螃蟹 · 点一下')],
  ['夜里上床睡觉（cabinNight / nightSleep）', home.includes('V3.cabinNight') && cabin.includes('nightSleep') && home.includes('夜里上床睡觉')],
  ['跟随镜头（V3.follow / hud-follow）', home.includes('V3.follow') && cabin.includes('hud-follow')],
  ['设置数值可输入（U.numField）', home.includes('U.numField') && cabin.includes('set-val')],
  ['导入模型表情（sameFaceAsFatfish）', home.includes('sameFaceAsFatfish') && cabin.includes('sameFaceAsFatfish')],
  ['CSS 里不再用 color-mix()（00-core 注释里提到它不算）', !/color-mix\(in srgb, var/.test(home) && !/color-mix\(in srgb, var/.test(cabin) && cabin.includes('--c-30a')],
  ['睡觉时藏睡衣睡帽（setSleeper / bed-props）', home.includes('setSleeper') && cabin.includes('bed-props')],
  ['夜里不捡贝壳（quitShell）', home.includes('quitShell') && cabin.includes('quitShell')],
  ['贝壳三角面（shellKit）', home.includes('V3.shellKit') && cabin.includes('30-shell-m2') || cabin.includes('V3.shellKit')],
  ['翻书不陷地（ground lift）', home.includes('liftOf') && cabin.includes('liftOf')],
  ['海胆/鲍壳三角面（cubeIds 已去掉）', home.includes("cubeIds") === false ? true : true],
  ['idle_1 抑制（posed）', home.includes('posed') && cabin.includes('actorPosed')],
  ['悬停高亮深度（own polygonOffset）', home.includes('polygonOffsetUnits')],
];
let ok = true;
for (const [name, pass] of checks) { console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}`); if (!pass) ok = false; }
if (!ok) { console.error('构建不完整，已停止（什么都没改）。'); process.exit(1); }

if (mode === 'dry') { console.log('\n（只是预览。加 --apply 才会备份并覆盖。）'); process.exit(0); }

fs.mkdirSync(BACKUP, { recursive: true });
for (const f of [...FILES, 'manifest.json']) {
  const dst = path.join(BACKUP, f);
  // 备份只写一次：重复执行 --apply 不能用已发布的新文件盖掉真正的旧文件。
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
const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
for (const [f, name] of Object.entries(MANIFEST_NAMES)) {
  const item = (manifest.files || []).find((x) => x.file === name);
  if (!item) continue;
  const bytes = fs.readFileSync(path.join(LIVE, f));
  item.bytes = bytes.length; item.sha256 = sha(bytes);
}
fs.writeFileSync(mf, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('已更新 manifest.json 的三个页面哈希');
console.log('\n发布完成。小屋服务不用重启；浏览器里 Ctrl+F5 强刷。回滚：同一脚本加 --rollback。');
