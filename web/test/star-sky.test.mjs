import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const { V3 } = loadV3(['06-env', /^06-star/, '68-star-lines','68-star-framing'], {three:'real'});
const sky = V3.stars, site = {lat:35.41, lon:116.59, date:new Date('2026-12-01T22:00:00+08:00')};
const close = (a,b,tol) => assert.ok(Math.abs(a-b) <= tol, `${a} 与 ${b} 相差超过 ${tol}°`);

test('手机取景完整容纳天鹅座并避开卡片，重复点选保留镜头',()=>{
  const F=V3.starFraming,c=sky.atlas.find(c=>c.id==='Cyg');
  const m=sky.frame({...site,date:new Date('2026-07-15T22:00:00+08:00')});
  const members=[...new Set(c.lines.flat())].map(hr=>sky.byHR.get(hr).v.clone().applyMatrix4(m)).filter(v=>v.y>0);
  const box={left:18,top:180,right:372,bottom:555}, card={left:12,top:580,right:370,bottom:810};
  const pose=F.fit(members,{az:155,alt:24,fov:45},390,844,box,[card]);assert.ok(pose);
  const lens=422/Math.tan(pose.fov*Math.PI/360),project=F.plane(pose.az,pose.alt);
  for(const v of members) {const p=project(v),x=195+p.x*lens,y=422+p.y*lens;assert.ok(x>=17.99 && x<=372.01 && y>=179.99 && y<=555.01);}
  assert.equal(F.fit(members,pose,390,844,box,[card]),null);
  assert.equal(F.turn(355,2),7);assert.equal(F.turn(5,358),-7);
});

test('济宁冬夜的天狼、织女、北极星', () => {
  // 独立计算：Meeus《天文算法》21 章三角式进动，再用球面时角三角形求地平坐标。
  // J2000 赤经赤纬取 (101.287,-16.716)、(279.235,38.784)、(37.955,89.264)，不加折射。
  const points = sky.visible(site);
  for (const [hr,alt,az] of [[2491,9.697,118.693],[7001,3.964,316.181],[424,36.026,.131]]) {
    const p=points.find(p=>p.hr===hr); close(p.alt,alt,.5); close(p.az,az,.5);
  }
  close(points.find(p=>p.hr===424).alt,site.lat,1);
  assert.ok(points.every(p=>p.alt>0 && p.color && Number.isFinite(p.mag)));
});
test('五颗行星的地心方向，地平线下也核对', () => {
  // 独立用 Schlyter 的日期黄道轨道根数、木土摄动项和当日黄赤交角算出。顺序为高度、从北向东的方位。
  const ref=[[-67.894,322.524],[-62.436,22.099],[-14.080,62.593],[-9.610,65.962],[46.318,223.984]];
  const ps=sky.planets(site); assert.equal(ps.length,5);
  ps.forEach((p,i)=>{close(p.alt,ref[i][0],1);close(p.az,ref[i][1],1);});
});
test('88 个天区、亮星、星群和所有连线端点齐备', () => {
  assert.equal(new Set(sky.atlas.map(c=>c.name)).size,88);
  assert.equal(sky.catalog.filter(s=>s.mag<=6).length,5080);
  assert.equal(sky.groups.length,4);
  for(const c of [...sky.atlas,...sky.groups]) {
    assert.ok(c.name && c.latin && c.lines.length);
    for(const hr of c.lines.flat()) assert.ok(sky.byHR.has(hr),`${c.id} / HR ${hr}`);
  }
  for(const c of sky.atlas) assert.ok(c.bounds.length && sky.byHR.has(c.bright),c.id);
});
test('天区命中跨赤经零点、南北天极及巨蛇的两段', () => {
  for(const [ra,dec,id] of [[83,-1,'Ori'],[0,40,'And'],[179,89.9,'UMi'],[5,-89.9,'Oct'],[235,10,'Ser'],[280,4,'Ser']])
    assert.equal(sky.region(ra,dec)?.id,id);
});
test('从最亮节点起笔，每条实线只走一次，各支到达的星依次亮起', () => {
  for(const c of [...sky.atlas,...sky.groups]) {
    const {nodes,edges}=V3.starLines.plan(c), hrs=new Set(c.lines.flat()), unique=new Set();
    for(const line of c.lines) for(let i=1;i<line.length;i++) if(line[i]!==line[i-1]) unique.add([line[i],line[i-1]].sort().join('/'));
    assert.deepEqual(new Set(nodes.keys()),hrs,c.id);
    assert.equal(edges.length,unique.size,c.id);
    const first=[...nodes].find(([,t])=>t===0)[0];
    assert.equal(sky.byHR.get(first).mag,Math.min(...[...hrs].map(hr=>sky.byHR.get(hr).mag)),c.id);
    for(const e of edges) {
      assert.ok(unique.delete([e.a,e.b].sort().join('/')) && e.start===nodes.get(e.a) && e.start<e.end && e.end<=1,c.id);
      assert.ok(nodes.get(e.b)<=e.end+1e-9,c.id);
    }
    assert.ok([...nodes.values()].every(t=>t>=0 && t<1),c.id);
  }
});
test('星点保留亮度次序，暗星放大比例更大，近邻之间留不下的短线略去', () => {
  const L=V3.starLines, bright=L.size(0),dim=L.size(5.5);
  assert.ok(dim.lit>2 && bright.lit>dim.lit && dim.lit/dim.base>bright.lit/bright.base);
  const a={x:3,y:4},b={x:43,y:4};
  assert.deepEqual(L.trim(a,b,5,3),{x:8,y:4,dx:32,dy:0});
  assert.equal(L.trim(a,{x:8,y:4},5,3),null);
});
test('黄昏、月光和天气改变肉眼极限星等', () => {
  const limit=(sunAlt,moonAlt=-10,moonIllum=0,kind='clear')=>sky.limit({sunAlt,moonAlt,moonIllum,wx:{kind}});
  assert.ok(limit(-18)>limit(-8) && limit(-8)>limit(-4));
  assert.ok(limit(-18)>limit(-18,65,1) && limit(-18,15,1)>limit(-18,65,1));
  assert.equal(limit(-18,-10,1),limit(-18));
  for(const wx of ['overcast','rain','drizzle','storm','snow','fog']) assert.equal(limit(-18,-10,0,wx),-Infinity);
});
test('更换观测地点时保留同一时刻，拒绝无效坐标和时区，支持恢复小屋地点', () => {
  const env=V3.env; env.setTime(site.date);
  assert.ok(env.setSite({lat:-33.87,lon:151.21,tz:'Australia/Sydney'}));
  assert.equal(env.state.ms,+site.date); assert.equal(env.astro.site().lat,-33.87);
  assert.equal(env.state.day,'2026-12-02');close(env.state.hour,1,.001);
  assert.equal(env.setSite({lat:123,lon:0,tz:'UTC'}),false);
  assert.equal(env.setSite({lat:0,lon:0,tz:'Not/AZone'}),false);
  assert.equal(env.astro.site().lat,-33.87);
  assert.ok(env.setSite(null));assert.equal(env.astro.site().lat,site.lat);
});
test('屋外星空用一份点阵随时钟转动，白天和雨天隐藏', () => {
  const app=loadV3(['06-env',/^06-star/], {three:'real'});
  const v=app.V3; let part;
  v.R={renderer:{getPixelRatio:()=>1}}; v.scene={part:p=>{part=p;}};
  app.load('51-sky');v.env.setTime(site.date);v.env.setWeather('clear');
  part.build();const {points,uni}=v.sky.live, pos=points.geometry.attributes.position;
  assert.ok(points.isPoints && points.visible);assert.equal(pos.count,v.stars.catalog.length+5);
  const before=uni.uFrame.value.clone();v.env.setTime(+site.date+3600000);part.update(.016,1);
  assert.ok(!uni.uFrame.value.equals(before));assert.equal(points.geometry.attributes.position,pos);
  v.env.setWeather('rain');part.update(.016,2);assert.equal(points.visible,false);
  v.env.setTime('12:00');v.env.setWeather('clear');part.update(.016,3);assert.equal(points.visible,false);
  part.dispose();
});
