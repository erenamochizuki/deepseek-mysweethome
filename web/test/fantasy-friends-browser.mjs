import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {launchBrowser,serveFiles,WEB_DIR,findEdge,BASE_ARGS,GPU} from '../tools/mc-lib.mjs';
import {decodePNG} from '../tools/girl/png.mjs';

const server=await serveFiles({'/cabin.html':path.join(process.env.CABIN_BUILD_DIR || path.join(WEB_DIR,'dist'),'cabin.html')});
let browser;
try {
  const pw=process.env.CABIN_PLAYWRIGHT;
  browser=pw?await (await import(pathToFileURL(pw))).chromium.launch({executablePath:findEdge(),headless:true,args:[...BASE_ARGS,...GPU.swiftshader]}):await launchBrowser({gpu:'swiftshader'});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const resize=(width,height)=>pw?page.setViewportSize({width,height}):page.setViewport({width,height});
  await resize(1080,760);
  if(pw)await page.emulateMedia({reducedMotion:'reduce'});else await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const ready=()=>page.waitForFunction(()=>window.__READY && V3.cabinInventory.canShore() && V3.shallows.state.spots.length);
  await page.goto(server.url+'/cabin.html?auto=0&time=morning&wx=clear');await ready();
  await page.evaluate(async()=>{
    const c=V3.cabinInventory,b=structuredClone(c.exportData()),s=b.inventory.shore,now=Date.now();
    s.tankTier=2;s.berth='west';s.observed=['foldsail','rainbell','moonray','islet'];
    s.fish=s.observed.map(kind=>({uid:'test:'+kind,kind,name:kind==='islet'?'小屿':'',fed:0,caughtAt:now}));
    if(!(await c.restore(b)).ok)throw Error('restore failed');
    window.tick=(dt,t)=>V3.scene.parts.find(p=>p.id==='shallows').update(dt,t);
    window.advance=days=>{Date.now=()=>now+days*86400000;tick(.01,2);};
    window.islandParts=fish=>['coral_1','coral_2','tide_pool','tide_arch','flower_crown'].filter(name=>{
      const part=fish.getObjectByName(name);if(!part)throw Error('missing island group: '+name);return part.visible;
    });
    // Geometry volume times the world-transform determinant is independent of patrol heading.
    window.fishVolumes=holder=>{
      holder.updateWorldMatrix(true,true);
      const parts=['moss_rock',...islandParts(holder)], rockVolumes={}, body=[];
      holder.traverseVisible(o=>{
        if(!o.isMesh)return;
        const geo=o.geometry;if(!geo.boundingBox)geo.computeBoundingBox();
        const d=geo.boundingBox.getSize(new THREE.Vector3()),volume=d.x*d.y*d.z*Math.abs(o.matrixWorld.determinant());
        for(let p=o;p!==holder;p=p.parent){
          if(parts.includes(p.name)){rockVolumes[p.name]=(rockVolumes[p.name]||0)+volume;return;}
          if(p.name==='islet_body'){body.push(volume);return;}
        }
      });
      return {body:Math.max(...body),rocks:rockVolumes};
    };
    window.pickKind=kind=>{const sel=document.querySelector('[aria-label="选择鱼缸住户"]');sel.value='test:'+kind;sel.dispatchEvent(new Event('change'));};
    window.press=text=>{const btn=[...document.querySelectorAll('.shore-body button')].find(b=>b.textContent===text);if(!btn||btn.disabled)throw Error('missing '+text);btn.click();};
    const st=V3.shallows.state;window.model=kind=>st.school.find(m=>m.userData.species===kind && m.visible);
    window.rings=0;const orig=V3.chimes.fishBell;V3.chimes.fishBell=()=>{rings++;orig();};
  });
  await page.waitForFunction(()=>V3.shallows.state.school.length===4);
  await page.evaluate(()=>V3.shallows.openTank());
  const parts=['coral_1','coral_2','tide_pool','tide_arch','flower_crown'];
  const wild=await page.evaluate(()=>{
    const r=V3.inventoryRules;let e=r.encounter(Date.now());while(r.fishAt(e)!=='islet')e++;
    Date.now=()=>e*300000;const m=V3.shallows.state.fish;
    for (let i=0;i<300 && (m.userData.species!=='islet' || !V3.shallows.state.inRing);i++)tick(.05,0);
    if (m.userData.species!=='islet' || !V3.shallows.state.inRing) throw Error('微屿鱼没有游进网圈');
    return {parts:islandParts(m),body:fishVolumes(m).body/m.userData.unit**3};
  });
  assert.deepEqual(wild.parts,[]);
  const stages=[[1,'苔石'],[3,'初枝'],[7,'双礁'],[10,'潮池'],[14,'穿潮拱'],[21,'花冠屿']];
  const bodies=[],firstRockVolumes={};
  for(const [index,[day,name]] of stages.entries()) {
    const resident=await page.evaluate(day=>{advance(day-1);pickKind('islet');const m=model('islet');
      return {parts:islandParts(m),scale:m.scale.toArray(),unit:m.userData.unit,...fishVolumes(m),text:V3.shore.panel.textContent};},day);
    assert.deepEqual(resident.parts,parts.slice(0,index));assert.deepEqual(resident.scale,[1,1,1]);
    const body=resident.body/resident.unit**3;
    assert.ok(body>(bodies.at(-1) || 0),`body did not grow on day ${day}`);bodies.push(body);
    if(!index)assert.ok(Math.abs(wild.body/body-1)<1e-6,'wild fish must have the stage-0 body');
    for(const p of ['moss_rock',...resident.parts]){firstRockVolumes[p]??=resident.rocks[p];assert.ok(Math.abs(resident.rocks[p]/firstRockVolumes[p]-1)<1e-6,`${p} changed size on day ${day}`);}
    assert.match(resident.text,new RegExp(`4 格 · 来家第 ${day} 天 · ${name}`));
  }
  await page.evaluate(()=>{
    const original=V3.shallows.fishModel;
    V3.shallows.fishModel=(...args)=>{
      const fish=original(...args);
      let measured=false;
      if(args[0]==='islet')fish.traverseVisible(o=>{if(!o.isMesh)return;
        o.onBeforeRender=(renderer,scene,camera)=>{if(renderer===V3.R.renderer)return;
          if(!measured){window.guideBody=fishVolumes(fish).body/fish.scale.x**3;measured=true;}
          window.guideFrame=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(fish.matrixWorld).toArray();};});
      return fish;
    };
    window.restoreGuideModel=()=>{V3.shallows.fishModel=original;};
    V3.fishGuide.open();document.querySelector('[data-kind="islet"] .fish-open').click();
  });
  const preview='.fish-detail select[aria-label="岛屿生长阶段"]';
  assert.equal(await page.$eval(preview,s=>s.value),'5');
  assert.deepEqual(await page.$eval(preview,s=>Array.from(s.options,o=>o.textContent)),stages.map(([day,name])=>`第 ${day} 天 · ${name}`));
  const note=await page.$eval('.fish-detail-info',n=>n.textContent);assert.match(note,/花冠屿/);
  const before=await page.evaluate(()=>JSON.stringify(V3.shore.shore()));
  await page.waitForFunction(()=>!!window.guideFrame);
  const grownFrame=await page.evaluate(()=>window.guideFrame);
  for(let i=0;i<stages.length;i++) {
    await page.$eval(preview,(s,i)=>{window.guideFrame=null;s.value=String(i);s.dispatchEvent(new Event('change'));},i);
    await page.waitForFunction(()=>!!window.guideFrame);
    assert.match(await page.$eval('.fish-view canvas',n=>n.getAttribute('aria-label')),new RegExp(stages[i][1]));
    const frame=await page.evaluate(()=>window.guideFrame);
    assert.ok(frame.every((n,j)=>Math.abs(n-grownFrame[j])<1e-6),`guide refitted stage ${i}`);
    assert.ok(Math.abs((await page.evaluate(()=>window.guideBody))/bodies[i]-1)<1e-6,`guide drew the wrong body at stage ${i}`);
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(V3.shore.shore())),before);
  await page.evaluate(()=>{restoreGuideModel();V3.collection.close();V3.shallows.openTank();});
  for(const kind of ['foldsail','rainbell','moonray','islet']){
    await page.evaluate(kind=>{pickKind(kind);press('喂食');},kind);await page.waitForFunction(()=>!!V3.shallows.state.meal);
    const result=await page.evaluate(kind=>{const m=model(kind),s=V3.shallows.state;const result=[];for(const t of [.43,1.04,1.48]){s.meal.age=t;tick(0,2);result.push([m.userData.fantasy.sail?.scale.y||0,m.userData.fantasy.bellL?.rotation.z||0,m.rotation.z,s.pellets.filter(p=>p.visible).length]);}tick(2.3,3);return {poses:result,rings:window.rings};},kind);
    assert.ok(result.poses[0][3]>0);if(kind==='foldsail')assert.ok(result.poses[0][0]>.95 && result.poses[2][0]<.22);
    if(kind==='rainbell')assert.ok(result.poses[0][1]>1 && result.rings===1);if(kind==='moonray')assert.ok(result.poses[1][2]>3);
  }
  for(const [label,w,h] of [['desktop',1080,760],['mobile',390,844]]){
    await resize(w,h);await page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
    await page.evaluate(()=>{V3.R.freeze(1);V3.shallows.openTank();});
    const capture=async t=>{await page.evaluate(async t=>{V3.R.freeze(t);await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));},t);
      const clip=await page.evaluate(()=>{const {tank,shell,school}=V3.shallows.state,{canvas,camera}=V3.R,r=canvas.getBoundingClientRect();const pr=v=>{v.project(camera);return [r.x+(1+v.x)*r.width/2,r.y+(1-v.y)*r.height/2];};
        for(const m of school){const [x,y]=pr(m.getWorldPosition(new THREE.Vector3()));if(document.elementFromPoint(x,y)!==canvas)throw Error('obscured '+m.userData.species);}
        const pts=[-1,1].flatMap(i=>[.02,.21].map(j=>pr(tank.localToWorld(new THREE.Vector3(i*.2*shell.scale.x,j*shell.scale.y,0))))),x=Math.ceil(Math.min(...pts.map(p=>p[0]))),y=Math.ceil(Math.min(...pts.map(p=>p[1])));return {x,y,width:Math.floor(Math.max(...pts.map(p=>p[0])))-x,height:Math.floor(Math.max(...pts.map(p=>p[1])))-y};});
      return decodePNG(Buffer.from(await page.screenshot({clip}))).rgba;};
    const a=await capture(1),b=await capture(3.1),colors=new Set();let moving=0;for(let i=0;i<a.length;i+=4){colors.add((a[i]>>4)*256+(a[i+1]>>4)*16+(a[i+2]>>4));if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>20)moving++;}
    assert.ok(colors.size>20 && moving>20,`${label} tank blank or static`);await page.screenshot({path:path.join(os.tmpdir(),'cabin-fantasy-'+label+'.png')});
    console.log(label,colors.size,'colors;',moving,'changed pixels');await page.evaluate(()=>V3.shore.close());
  }
  // Rewind the fixture to day 14 and release it, then visit well past the crown threshold.
  await page.evaluate(()=>{advance(13);V3.shallows.openTank();pickKind('islet');press('放归');});await page.waitForFunction(()=>V3.shore.shore().released.length===1);
  await page.evaluate(()=>{V3.shore.close();const s=V3.shore.shore(),r=V3.inventoryRules;let e=r.encounter(Date.now())+15*288;while(!r.friendAt(s,e,false))e++;Date.now=()=>e*300000+600;for(let i=0;i<52;i++)tick(.25,i*.25);});
  await page.waitForFunction(()=>V3.shallows.state.guest.visible);
  const guest=await page.evaluate(()=>{const s=V3.shallows.state;for(let i=0;i<32;i++)tick(.25,0);if(!s.ring.visible||!s.inRing||!V3.shallows.net())throw Error('visitor blocked net');V3.shore.close();if(!V3.shore.act('returnFish'))throw Error('visitor not actionable');return {text:V3.shore.panel.textContent,parts:islandParts(s.guest),dist:Math.hypot(s.guest.position.x-s.netX,s.guest.position.z-s.netZ)};});
  assert.match(guest.text,/小屿/);assert.match(guest.text,/14 天/);assert.match(guest.text,/穿潮拱/);assert.deepEqual(guest.parts,parts.slice(0,4));assert.ok(guest.dist>.6);
  const guestBody=await page.evaluate(()=>{const m=V3.shallows.state.guest;return fishVolumes(m).body/m.userData.unit**3;});
  assert.ok(Math.abs(guestBody/bodies[4]-1)<1e-6,'visitor must retain the day-14 body');
  for(const [label,w,h] of [['desktop',1080,760],['mobile',390,844]]){await resize(w,h);await page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
    await page.evaluate(()=>V3.shore.act('returnFish'));await page.waitForFunction(()=>{const {canvas,camera}=V3.R,r=canvas.getBoundingClientRect(),p=V3.shallows.state.guest.getWorldPosition(new THREE.Vector3()).project(camera);return document.elementFromPoint(r.x+(1+p.x)*r.width/2,r.y+(1-p.y)*r.height/2)===canvas;});
    await page.screenshot({path:path.join(os.tmpdir(),'cabin-reunion-'+label+'.png')});}
  await page.evaluate(()=>{press('目送它离开');for(let i=0;i<38;i++)tick(.25,i*.25);});assert.equal(await page.evaluate(()=>V3.shallows.state.guest.visible),false);
  await page.reload();await ready();assert.deepEqual(await page.evaluate(()=>{const s=V3.shore.shore();return [s.fish.length,s.released[0].name,s.released[0].visitedAt>0,s.lastCatch];}),[3,'小屿',true,-1]);assert.deepEqual(errors,[]);
  console.log('PASS: four fantasy residents, feeding, coral growth, visible same-individual visit and independent net, saved farewell');
} finally {await browser?.close();await server.close();}
