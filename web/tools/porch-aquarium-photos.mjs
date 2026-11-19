// Photograph the actual stocked porch aquarium and its autonomous visitor, without touching player saves.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {serveFiles,launchBrowser,findEdge,BASE_ARGS,GPU,WEB_DIR} from './mc-lib.mjs';
import {decodePNG} from './girl/png.mjs';

const srv=await serveFiles({'/cabin.html':path.join(WEB_DIR,'dist/cabin.html')});let browser;
try{
  const pw=process.env.CABIN_PLAYWRIGHT;
  browser=pw?await (await import(pathToFileURL(pw))).chromium.launch({headless:true,executablePath:findEdge(),args:[...BASE_ARGS,...GPU.swiftshader]}):await launchBrowser({gpu:'swiftshader'});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const resize=(w,h)=>pw?page.setViewportSize({width:w,height:h}):page.setViewport({width:w,height:h});
  await resize(1280,800);await page.goto(srv.url+'/cabin.html?auto=0&ui=0&time=morning&wx=clear');
  await page.waitForFunction(()=>window.__READY && V3.actor?.pos && V3.cabinInventory.canShore() && V3.shallows.state.spots.some(p=>p.key==='west'));
  await page.evaluate(async()=>{const c=V3.cabinInventory,b=structuredClone(c.exportData()),s=b.inventory.shore;
    s.berth='west';s.tankTier=3;s.observed=['islet','foldsail','dolphin','moonray','pinecone','bamboo','rainbell'];s.fish=s.observed.map((kind,i)=>({kind,uid:'photo:'+i,caughtAt:Date.now()-9*86400000,fed:0,name:''}));
    if(!(await c.restore(b)).ok)throw Error('photo fixture failed');});
  await page.waitForFunction(()=>V3.shallows.watchTarget()?.width===2);
  const metric=await page.evaluate(()=>{const s=V3.shallows.state,t=V3.shallows.watchTarget(),p=s.tank.position;
    const box=new THREE.Box3().setFromObject(s.shell),sz=box.getSize(new THREE.Vector3());
    if(Math.abs(sz.x-2)>.005||Math.abs(sz.z-1)>.005||Math.abs(sz.y-1.08)>.005||V3.nav.walkable(p.x,p.z,p.y)||!s.gardens[3].visible)throw Error('bad physical tank: '+sz.toArray());
    window.photoView=(mode,portrait=false)=>{const side=t.key.startsWith('west')?-1:1;const aim=[p.x,p.y+.52,p.z+(mode==='pair' ? .20 : 0)], d=portrait?2.28:1;
      const v=mode==='pair'?[side*2.42,1.1,2.6]:[side*.84,.62,2.75];
      V3.follow?.set(false);V3.R.setView({target:aim,pos:aim.map((n,i)=>n+v[i]*d),fov:mode==='pair'?39:37});V3.R.render();};
    V3.viewTokens.girl('idle');V3.R.freeze(2.1);photoView('tank');return {dimensions:sz.toArray(),height:V3.layout.girlH,adults:s.school.length,scale:s.school[2].userData.unit};});console.log(metric);
  const photos=path.resolve(WEB_DIR,'../docs');
  const waitFrame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await waitFrame();await page.screenshot({path:path.join(photos,'porch-aquarium-interior.jpg'),quality:93});
  const watched=await page.evaluate(()=>{const s=V3.shallows.state,p=s.tank.position,a=V3.actor,nav=V3.nav;
    const approach=nav.nearest(p.x-.1,p.z+2.9,3,p.y);a.place(approach[0],approach[1],0,approach[2]);
    if(!a.startBehavior('watch_tank',{seconds:180}))throw Error(JSON.stringify(a.behaviorAvailability('watch_tank')));
    const actor=V3.scene.parts.find(p=>p.id==='girl-actor');for(let i=0;i<1200 && a.behavior?.phase!=='action';i++)actor.update(.05);
    if(a.behavior?.phase!=='action')throw Error('did not reach glass: '+JSON.stringify(a._dbg));V3.bubble?.hide?.('girl');photoView('pair');return {feet:a.pos,berth:p.toArray(),facing:a.yaw};});console.log(watched);
  function detail(buf){const {rgba,w,h}=decodePNG(Buffer.from(buf)),colors=new Set();for(let i=0;i<rgba.length;i+=28)colors.add((rgba[i]>>4)*256+(rgba[i+1]>>4)*16+(rgba[i+2]>>4));return {colors:colors.size,rgba,w,h};}
  async function visiblePixels(){return page.evaluate(()=>{const {tank,gardens,school}=V3.shallows.state,r=V3.R,c=document.createElement('canvas');c.width=390;c.height=Math.round(390*r.canvas.height/r.canvas.width);const ctx=c.getContext('2d',{willReadFrequently:true});
    const sample=()=>{r.render();ctx.drawImage(r.canvas,0,0,c.width,c.height);return ctx.getImageData(0,0,c.width,c.height).data;},full=sample(),measure=items=>{const states=items.map(o=>o.visible);items.forEach(o=>o.visible=false);const a=sample();items.forEach((o,i)=>o.visible=states[i]);let count=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-full[i])+Math.abs(a[i+1]-full[i+1])+Math.abs(a[i+2]-full[i+2])>35)count++;return count;};
    const scores={tank:measure([tank]),actor:measure([V3.actor.root]),garden:measure([gardens[3]]),fish:measure(school)};r.render();return scores;});}
  for(const [label,w,h] of [['desktop',1280,800],['mobile',390,844]]){await resize(w,h);await waitFrame();await page.evaluate(m=>photoView('pair',m),label==='mobile');await waitFrame();
    const clip=await page.evaluate(()=>{const s=V3.shallows.state,p=s.tank.position,feet=V3.actor.pos,r=V3.R.canvas.getBoundingClientRect(),pr=v=>{v.project(V3.R.camera);if(Math.abs(v.x)>.99||Math.abs(v.y)>.99)throw Error('clipped subject '+v.toArray());return [r.left+(1+v.x)*r.width/2,r.top+(1-v.y)*r.height/2];};
      for(const x of [-1,1])for(const z of [-.5,.5])for(const y of [0,1.08])pr(p.clone().add(new THREE.Vector3(x,y,z)));pr(new THREE.Vector3(...feet));pr(new THREE.Vector3(...feet).add(new THREE.Vector3(0,V3.layout.girlH,0)));
      const [x,y]=pr(p.clone().add(new THREE.Vector3(0,.53,0)));return {x:Math.round(x)-60,y:Math.round(y)-40,width:120,height:80};});
    const a=detail(await page.screenshot({clip}));await page.evaluate(()=>V3.R.freeze(6.8));await waitFrame();const b=detail(await page.screenshot({clip}));let diff=0;for(let i=0;i<a.rgba.length;i+=4)if(Math.abs(a.rgba[i]-b.rgba[i])+Math.abs(a.rgba[i+1]-b.rgba[i+1])+Math.abs(a.rgba[i+2]-b.rgba[i+2])>18)diff++;
    const visible=await visiblePixels();console.log(label,{colors:a.colors,changed:diff,visible});assert.ok(a.colors>10&&diff>12&&visible.tank>700&&visible.actor>200&&visible.garden>30&&visible.fish>30);await page.screenshot({path:path.join(photos,'porch-aquarium-'+label+'.jpg'),quality:93});await page.evaluate(()=>V3.R.freeze(2.1));}
  assert.deepEqual(errors,[]);
}finally{await browser?.close();await srv.close();}
