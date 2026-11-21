// 从 BSC5 定宽表和 d3-celestial 的 J2000 天区生成离线星图。用法见 docs/STAR-SKY.md。
import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const tmp = new URL('../../tmp/star-sky/', import.meta.url), src = new URL('../src/', import.meta.url);
const upstream = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/';
const inputs = [
  ['catalog.gz', 'https://vizier.cfa.harvard.edu/ftp/cats/V/50/catalog.gz', '3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed'],
  ['constellations.json', upstream+'data/constellations.json', 'ab4ae692027cbc042c0d6791a84456a65eb7c55656107fd00c58ff6e55d4d8b2'],
  ['constellations.lines.json', upstream+'data/constellations.lines.json', '294f66bef5d5cf50b1e17f16d2efa1d97a15131612c68dd935adef6e7373e13c'],
  ['constellations.bounds.json', upstream+'data/constellations.bounds.json', 'f2e2687af6b20b24567879f838c21874d412efcc93ecc1966be07e78431cc196'],
  ['LICENSE', upstream+'LICENSE', 'a8c79239001ad4bea243d1796b85084e1fc39309c5c5a663930a1b46320254c6'],
];
await fs.mkdir(tmp, { recursive:true });
const raw = {};
for (const [name,url,hash] of inputs) {
  const path = new URL(name,tmp);
  if (process.argv.includes('--download')) {
    const res = await fetch(url);
    if (!res.ok) throw Error(`${name}: HTTP ${res.status}`);
    raw[name] = Buffer.from(await res.arrayBuffer());
  } else raw[name] = await fs.readFile(path);
  if (createHash('sha256').update(raw[name]).digest('hex') !== hash) throw Error('请核对原始文件版本：'+name);
  if (process.argv.includes('--download')) await fs.writeFile(path,raw[name]);
}
const rad = Math.PI/180;
function vector(ra,dec) { return [Math.cos(ra*rad)*Math.cos(dec*rad), Math.sin(ra*rad)*Math.cos(dec*rad), Math.sin(dec*rad)]; }
const all = [];
for (const row of gunzipSync(raw['catalog.gz']).toString('ascii').split('\n')) {
  const n = (a,b) => +row.slice(a-1,b);
  if (!row.slice(75,83).trim() || !row.slice(102,107).trim()) continue;
  const ra = 15*(n(76,77)+n(78,79)/60+n(80,83)/3600);
  const dec = (row[83] === '-' ? -1 : 1)*(n(85,86)+n(87,88)/60+n(89,90)/3600);
  all.push({hr:n(1,4), ra, dec, mag:n(103,107), bv:row.slice(109,114).trim() ? n(110,114) : null,
    con:row.slice(11,14), desig:row.slice(4,14).trim(), v:vector(ra,dec)});
}
const keep = new Set(all.filter(s => s.mag <= 6));
function endpoint([ra,dec]) {
  const [x,y,z] = vector(ra,dec);
  let best, dist = Infinity;
  for (const s of all) {
    const d = (x-s.v[0])**2 + (y-s.v[1])**2 + (z-s.v[2])**2;
    if (d < dist) { best=s; dist=d; }
  }
  if (Math.sqrt(dist)/rad > .08) throw Error(`连线端点 ${ra}, ${dec} 相差 ${Math.sqrt(dist)/rad} 度`);
  keep.add(best); return best.hr;
}
const features = key => JSON.parse(raw[key]).features;
const names = '仙女 唧筒 天燕 宝瓶 天鹰 天坛 白羊 御夫 牧夫 雕具 鹿豹 巨蟹 猎犬 大犬 小犬 摩羯 船底 仙后 半人马 仙王 鲸鱼 蝘蜓 圆规 天鸽 后发 南冕 北冕 乌鸦 巨爵 南十字 天鹅 海豚 剑鱼 天龙 小马 波江 天炉 双子 天鹤 武仙 时钟 长蛇 水蛇 印第安 蝎虎 狮子 小狮 天兔 天秤 豺狼 天猫 天琴 山案 显微镜 麒麟 苍蝇 矩尺 南极 蛇夫 猎户 孔雀 飞马 英仙 凤凰 绘架 双鱼 南鱼 船尾 罗盘 网罟 天箭 人马 天蝎 玉夫 盾牌 巨蛇 六分仪 金牛 望远镜 三角 南三角 杜鹃 大熊 小熊 船帆 室女 飞鱼 狐狸'.split(' ');
const cons = {};
for (const f of features('constellations.json')) {
  if (cons[f.id]) continue;
  const brightest = all.filter(s => s.con === f.id).sort((a,b) => a.mag-b.mag)[0];
  cons[f.id] = {id:f.id, name:names[Object.keys(cons).length]+'座', latin:f.properties.la.replace(/\s/g,' '),
    center:f.geometry.coordinates, bright:brightest?.hr, designation:brightest?.desig, lines:[], bounds:[]};
}
for (const f of features('constellations.lines.json')) cons[f.id].lines.push(...f.geometry.coordinates.map(line => line.map(endpoint)));
for (const f of features('constellations.bounds.json')) cons[f.id].bounds.push(...f.geometry.coordinates);
const stars = [...keep].sort((a,b) => a.hr-b.hr), buf = Buffer.alloc(stars.length*10);
stars.forEach((s,i) => {
  const p=i*10;
  buf.writeUInt16LE(s.hr,p); buf.writeUInt16LE(Math.round(s.ra/360*65535),p+2);
  buf.writeInt16LE(Math.round(s.dec/90*32767),p+4); buf.writeInt16LE(Math.round(s.mag*100),p+6);
  buf.writeInt16LE(s.bv === null ? -32768 : Math.round(s.bv*100),p+8);
});
const generated = '// 由 web/tools/star-catalog.mjs 生成，请改生成器或原始数据。\n';
await fs.writeFile(new URL('06-star-data.js',src), generated+`window.V3.starBytes = '${buf.toString('base64')}';\n`);
await fs.writeFile(new URL('06-star-atlas.js',src), generated+'/* d3-celestial\n'+raw.LICENSE+'\n*/\nwindow.V3.starAtlas = '+JSON.stringify(Object.values(cons))+';\n');
await fs.copyFile(new URL('LICENSE',tmp), new URL('../vendor/d3-celestial-LICENSE.txt',src));
console.log(`${stars.length} 颗恒星，其中 ${stars.filter(s=>s.mag>6).length} 颗仅补作连线端点，${Object.keys(cons).length} 个星座`);
