import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';

const pageName=process.env.CABIN_TEST_PAGE==='home'?'home':'cabin';
const server=await serveFiles({['/'+pageName+'.html']:path.join(WEB_DIR,'dist',pageName+'.html')});
let browser;
try {
  browser=await launchBrowser({width:1080,height:760,gpu:'swiftshader'});
  const page=await browser.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const wait=fn=>page.waitForFunction(fn,{timeout:90000});
  const ready=()=>wait(()=>window.__READY && V3.cabinInventory.canShore() && V3.shallows.state.spots.length);
  const press=txt=>page.locator(`::-p-xpath(//button[normalize-space(.)='${txt}'])`).click();
  await page.goto(server.url+'/'+pageName+'.html?auto=0&time=morning&wx=clear'); await ready();
  await page.evaluate(async()=>{
    const c=V3.cabinInventory, backup=structuredClone(c.exportData()), s=backup.inventory.shore;
    backup.inventory.coins=36; s.berth='west'; s.observed=['knifejaw','puffer'];
    s.fish=s.observed.map((kind,i)=>({uid:'demo:'+i,kind,name:['墨墨','点点'][i],fed:0,caughtAt:Date.now()-8*86400000}));
    const result=await c.restore(backup); if(!result.ok)throw Error(result.error);
  });
  await wait(()=>V3.shallows.state.tank.visible);
  const clickTank=async()=>{
    const pt=await page.evaluate(()=>{
      const t=V3.shallows.state.tank, p=t.position, h=t.userData.tankHeight, aim=[p.x,p.y+.12*h,p.z];
      V3.R.setView({pos:[p.x+.4,p.y+.4,p.z+1.7],target:aim}); V3.R.scene.updateMatrixWorld(true);
      const r=V3.R.canvas.getBoundingClientRect(), pt={clientX:r.x+r.width/2,clientY:r.y+r.height/2};
      if(V3.cabinTargets.pick(pt)?.what!=='homeTank')throw Error('Glass is not clickable'); return [pt.clientX,pt.clientY];
    });
    await page.mouse.click(...pt); await page.waitForSelector('.shore-closeup[data-subject="homeTank"]');
  };
  await clickTank(); await press('升级为加宽鱼缸 · 6 格 · 12 贝币'); await wait(()=>V3.shallows.state.tier===1);
  await press('升级为门廊落地缸 · 12 格 · 24 贝币'); await wait(()=>V3.shallows.state.tier===2);
  assert.equal(await page.evaluate(()=>V3.cabinInventory.data.inventory.coins),0);
  const rayUid=await page.evaluate(()=>{
    const r=V3.inventoryRules; let epoch=r.encounter(Date.now()); while(r.fishAt(++epoch)!=='sandray') {}
    Date.now=()=>epoch*300000+123; V3.shore.close(); V3.scene.parts.find(p=>p.id==='shallows').update(.05,0);
    if(!V3.shallows.net())throw Error('Net missed ray'); return 'fish:'+epoch;
  });
  assert.match(await page.$eval('.shore-panel',n=>n.innerText),/这尾需要 4 格 · 缸里还剩 9 格/);
  await press('带回鱼缸');
  await wait(()=>V3.shallows.state.school.length===3);
  await clickTank();
  for(const [uid,kind] of [['demo:0','knifejaw'],[rayUid,'sandray']]) {
    await page.select('select[aria-label="选择鱼缸住户"]',uid);
    assert.match(await page.$eval('.shore-body',n=>n.innerText),kind==='sandray'?/来家第 1 天 · 刚来家/:/成鱼/);
    await press('喂食'); await wait(()=>V3.shallows.state.meal);
    const meal=await page.evaluate(uid=>{
      const s=V3.shallows.state,part=V3.scene.parts.find(p=>p.id==='shallows'),model=s.school.find(m=>m.userData.uid===uid);
      const m=s.meal; if(m?.uid!==uid)throw Error('wrong resident'); m.age=0; part.update(.3,1);
      const start=s.pellets[0].position.y, count=s.pellets.filter(p=>p.visible).length;part.update(.8,1.8);const lower=s.pellets[0].position.y;
      part.update(.31,2.1);const bite=model.position.y, empty=s.pellets.every(p=>!p.visible);
      part.update(.90,3);return {start,lower,count,empty,bite,done:s.meal===null};
    },uid);
    assert.ok(meal.start>meal.lower && meal.count===3 && meal.empty && meal.done);
    assert.ok(kind==='sandray'?meal.bite<.20:meal.bite>.30);
  }
  await page.reload(); await ready(); assert.equal(await page.evaluate(()=>V3.shore.shore().fish.filter(f=>f.fed).length),2);
  for(const viewport of [{width:1080,height:760},{width:390,height:844}]) {
    await page.setViewport(viewport); await clickTank();
    const clear=await page.evaluate(()=>{
      const {tank,shell}=V3.shallows.state, {camera,canvas}=V3.R, rect=canvas.getBoundingClientRect();
      return [-1,1].every(side=>[.02,.21].every(height=>{
        const point=tank.localToWorld(new THREE.Vector3(side*.2*shell.scale.x,height*shell.scale.y,0)).project(camera);
        return Math.abs(point.x)<1 && Math.abs(point.y)<1 && document.elementFromPoint(rect.x+(1+point.x)*rect.width/2, rect.y+(1-point.y)*rect.height/2)===canvas;
      }));
    }); assert.ok(clear,`whole tank unobstructed at ${viewport.width}`);
    await page.evaluate(()=>V3.shore.close());
  }
  const count=await page.evaluate(async()=>{
    const c=V3.cabinInventory,b=structuredClone(c.exportData()),s=b.inventory.shore;
    s.fish=Array.from({length:12},(_,i)=>({uid:'full:'+i,kind:'puffer',name:'',fed:0,caughtAt:0}));
    if(c.remote || !(await c.perform({op:'reset',rev:c.data.rev,id:c.id('fixture')})).ok)throw Error('Test fixture reset failed');
    if(!(await c.restore(b)).ok)throw Error('Full restore failed');
    const state=V3.shallows.state, part=V3.scene.parts.find(p=>p.id==='shallows');
    for(let i=0;i<96;i++) { part.update(.05,i*.21); state.tank.updateWorldMatrix(true,true);
      for(const model of state.school.filter(m=>m.visible)) {
        const box=new THREE.Box3().setFromObject(model,true), a=state.tank.worldToLocal(box.min), z=state.tank.worldToLocal(box.max);
        const {x:w,y:h,z:d}=state.shell.scale;if(a.x<-.188*w || z.x>.188*w || a.y<.036*h || z.y>.211*h || a.z<-.101*d || z.z>.101*d)throw Error('Swam through glass');
      }
    } return state.school.filter(m=>m.visible).length;
  });
  assert.equal(count,12);
  await page.setViewport({width:1080,height:760});
  await page.evaluate(async()=>{
    const c=V3.cabinInventory,b=structuredClone(c.exportData()); b.inventory.shore.fish=[];b.inventory.coins=48;
    if(c.remote || !(await c.perform({op:'reset',rev:c.data.rev,id:c.id('fixture')})).ok || !(await c.restore(b)).ok)throw Error('isolated fixture failed');
    window.visit=kind=>{const r=V3.inventoryRules;let e=Math.max(r.encounter(Date.now()),V3.shore.shore().lastCatch)+1;while(r.fishAt(e)!==kind)e++;
      Date.now=()=>e*300000+998;V3.scene.parts.find(p=>p.id==='shallows').update(.05,0);return e;};
    window.visit('dolphin');V3.shallows.net();
  });
  const disabled=()=>page.$eval('.shore-panel',p=>[...p.querySelectorAll('button')].find(b=>b.textContent==='邀请小海豚入住').disabled);
  assert.equal(await disabled(),true);assert.match(await page.$eval('.shore-body',n=>n.innerText),/还剩 12 格.*|只住潮湾超级大缸/);
  await page.evaluate(()=>{V3.shore.close();V3.shallows.openTank();});await press('升级为潮湾超级大缸 · 24 格 · 48 贝币');await wait(()=>V3.shallows.state.tier===3);
  await page.evaluate(()=>{V3.shore.close();V3.scene.parts.find(p=>p.id==='shallows').update(.05,0);if(!V3.shallows.net())throw Error('missed visitor');});
  assert.equal(await disabled(),false);await press('邀请小海豚入住');await wait(()=>V3.shore.shore().fish.length===1);
  await page.evaluate(async()=>{
    const c=V3.cabinInventory;for(const kind of ['frogfish','pinecone','archer','bamboo','dory','moray']){
      const epoch=window.visit(kind);const result=await c.perform({op:'shore_catch',id:c.id(kind),kind,epoch,berth:'west'});if(!result.ok)throw Error(result.error);
    }
    V3.scene.parts.find(p=>p.id==='shallows').update(.05,0);
  });
  await clickTank();assert.match(await page.$eval('.shore-body',n=>n.innerText),/24 \/ 24 格 · 7 尾/);
  const tankButtons=await page.$eval('.shore-panel',p=>[...p.querySelectorAll('button')].map(b=>b.textContent.trim()));
  assert.ok(tankButtons.includes('请她看看鱼缸'));assert.equal(tankButtons.includes('鱼类图鉴'),false);
  await page.evaluate(()=>{
    const actor=V3.actor;actor.cancelBehavior('test-reset');actor.place(-2.4,-7.5,0,1);
    const calls=window.__tankInviteCalls={chat:0,snapshot:0,feed:0,start:actor.pos};
    const originalChat=window.__cabinBridge, snapshot=HTMLCanvasElement.prototype.toDataURL, feed=V3.shallows.feedIfNeededToday;
    window.__cabinBridge={api:{chat:()=>{calls.chat++;return Promise.reject(new Error('unexpected model chat'));}}};
    HTMLCanvasElement.prototype.toDataURL=function(type,...args){if(type==='image/jpeg')calls.snapshot++;return snapshot.call(this,type,...args);};
    V3.shallows.feedIfNeededToday=()=>{calls.feed++;return feed();};
    window.__tankInviteRestore=()=>{window.__cabinBridge=originalChat;HTMLCanvasElement.prototype.toDataURL=snapshot;V3.shallows.feedIfNeededToday=feed;};
  });
  const fedBefore=await page.evaluate(()=>V3.shore.shore().fish.map(f=>f.fed));
  await press('请她看看鱼缸');
  const visit=await page.evaluate(()=>{
    const actor=V3.actor, part=V3.scene.parts.find(p=>p.id==='girl-actor');
    const before=actor.behavior?.kind;
    // Step the production actor explicitly so software-rendered frames cannot delay arrival in CI.
    for(let i=0;i<1200&&actor.behavior?.kind==='watch_tank'&&actor.behavior.phase!=='action';i++)part.update(.05);
    return {before,phase:actor.behavior?.phase,pos:actor.pos,...window.__tankInviteCalls};
  });
  assert.equal(visit.before,'watch_tank',JSON.stringify(visit));
  assert.equal(visit.phase,'action',JSON.stringify(visit));
  assert.ok(Math.hypot(visit.pos[0]-visit.start[0],visit.pos[2]-visit.start[2])>.05,JSON.stringify(visit));
  assert.equal(visit.chat,0,'web invitation must not call the model');
  assert.equal(visit.snapshot,0,'web invitation must not take a JPEG');
  assert.equal(visit.feed,1,'manual visit uses the same single arrival feed check');
  await page.waitForFunction(before=>V3.shore.shore().fish.some((f,i)=>f.fed!==before[i]),{timeout:10000},fedBefore);
  assert.equal(await page.evaluate(before=>V3.shore.shore().fish.filter((f,i)=>f.fed!==before[i]).length,fedBefore),1);
  await page.evaluate(()=>{window.__tankInviteRestore();V3.actor.cancelBehavior('test-complete');});
  const anim=await page.evaluate(async()=>{
    const s=V3.shallows.state, residents=V3.shore.shore().fish, p=V3.scene.parts.find(p=>p.id==='shallows');
    const model=kind=>s.school.find(m=>m.visible&&m.userData.species===kind), day=Date.now(), shark=model('bamboo').userData;
    const juvenile=!shark.stars.visible;Date.now=()=>day+7*86400000;p.update(0,1);const adult=shark.stars.visible;
    const frog=model('frogfish');p.update(0,2.1);const pos=frog.position.clone();p.update(.04,2.2);const still=pos.distanceTo(frog.position)<.0001;
    async function meal(kind,age){const f=residents.find(f=>f.kind===kind);const sel=V3.shore.panel.querySelector('select');sel.value=f.uid;sel.onchange();
      const btn=[...V3.shore.panel.querySelectorAll('button')].find(b=>b.textContent==='喂食');btn.click();
      for(let n=0;n<500 && s.meal?.uid!==f.uid;n++)await new Promise(done=>setTimeout(done,10));
      if(s.meal?.uid!==f.uid)throw Error('Did not feed '+kind);s.meal.age=0;p.update(age,2);}
    await meal('archer',.58);const jet=s.jet.visible&&s.pellets[0].position.y>s.pellets[1].position.y;
    await meal('dory',1.18);const beak=model('dory').userData.mouth.position.z>4.5;
    const eel=model('moray'),pipe=eel.userData.pipe,p0=pipe.position.clone();await meal('moray',1.22);
    return {juvenile,adult,still,jet,beak,pipe:pipe.visible&&pipe.position.equals(p0)&&eel.position.distanceTo(p0)>.045,
      light:model('pinecone').userData.lamps.children[0].material.isMeshBasicMaterial,fluke:Math.abs(model('dolphin').userData.tail.rotation.x)>.01};
  }); assert.ok(Object.values(anim).every(Boolean),JSON.stringify(anim));

  await page.reload();await ready();assert.equal(await page.evaluate(()=>V3.shore.shore().tankTier===3&&V3.inventoryRules.usedSlots(V3.shore.shore())===24),true);
  const interruption=await page.evaluate(async()=>{
    const actor=V3.actor, night=V3.cabinNight, tick=night.tick;
    const start=actor.startBehavior;
    let routineRuns=0,protectedTrip=false;
    night.tick=()=>{routineRuns++;return false;};
    actor.startBehavior=(kind,options)=>{
      const started=start(kind,options);
      if(started&&kind==='watch_tank')queueMicrotask(()=>{
        const before=routineRuns;
        V3.cabinRoutine.tick();
        protectedTrip=V3.shallows.tankCapturePending&&routineRuns===before;
        actor.cancelBehavior('tank-changed');
      });
      return started;
    };
    try{
      const failure=await V3.cabinTools.call('fish_tank_view',{});
      const pending=V3.shallows.tankCapturePending, before=routineRuns;
      V3.cabinRoutine.tick();
      return {failure,protectedTrip,pending,resumed:routineRuns>before};
    }finally{actor.startBehavior=start;night.tick=tick;}
  });
  assert.equal(interruption.failure.error,'tank_interrupted',JSON.stringify(interruption));
  assert.deepEqual(interruption.failure.result,{reason:'tank-changed',phase:'to_tank'});
  assert.equal(interruption.failure.image,undefined);
  assert.equal(interruption.protectedTrip,true,'routine cannot preempt the photo trip');
  assert.equal(interruption.pending,false);
  assert.equal(interruption.resumed,true,'routine resumes after the photo ends');
  const capture=await page.evaluate(async()=>{
    const R=V3.R,actor=V3.actor,original=R.post;let pose=null;const layers=[];actor.root.traverse(object=>layers.push([object,object.layers.mask]));
    R.post=function(renderer,scene,camera,dt){
      if(camera!==R.camera&&!pose){
        const {tank,shell}=V3.shallows.state, dir=camera.getWorldDirection(new THREE.Vector3());
        const eye=tank.worldToLocal(camera.position.clone()), actorSide=tank.worldToLocal(new THREE.Vector3(...actor.pos));
        const {x:w,y:h,z:d}=shell.scale, alongX=Math.abs(eye.x)>Math.abs(eye.z), axis=alongX?'x':'z';
        const near=alongX?.2*w:.115*d, across=alongX?.115*d:.2*w;
        const corners=[-across,across].flatMap(edge=>[.026*h,.225*h].map(y=>{
          const side=Math.sign(eye[axis])*near;
          return tank.localToWorld(new THREE.Vector3(alongX?side:edge,y,alongX?edge:side)).project(camera).toArray();
        }));
        const meshes=[];actor.root.traverse(object=>{if(object.isMesh)meshes.push(object);});
        pose={eye:eye.toArray(),direction:dir.toArray(),phase:actor.behavior?.phase,rootVisible:actor.root.visible,
          sameSide:Math.sign(eye[axis])===Math.sign(actorSide[axis]),outside:Math.abs(eye[axis])>near,
          windowHeight:eye.y/h,corners,liveIncludesSelf:meshes.every(object=>R.camera.layers.test(object.layers)),
          cameraIncludesSelf:meshes.some(object=>camera.layers.test(object.layers))};
      }
      return original(renderer,scene,camera,dt);
    };
    try{
      actor.respond('准备出发',{seconds:12});
      const startedFrom=actor.state;
      return {view:await V3.cabinTools.call('fish_tank_view',{}),startedFrom,pose,restoredVisibility:actor.root.visible,restoredLayers:layers.every(([object,mask])=>object.layers.mask===mask)};
    }
    finally{R.post=original;}
  });
  const {view,pose}=capture;
  assert.equal(capture.startedFrom,'respond','QQ capture can interrupt a busy attention animation');
  assert.equal(view.ok,true,JSON.stringify(view));assert.match(view.image,/^data:image\/jpeg;base64,/);
  if(process.env.FISH_TANK_CAPTURE_PATH)fs.writeFileSync(process.env.FISH_TANK_CAPTURE_PATH,Buffer.from(view.image.split(',')[1],'base64'));
  assert.ok(pose,'the captured frame must use the dedicated first-person camera');
  assert.ok(['action','sit'].includes(pose.phase),'capture waits until she finishes turning toward the tank: '+JSON.stringify(pose));
  assert.equal(pose.rootVisible,true,'capture must not change the whale scene visibility');
  assert.equal(pose.cameraIncludesSelf,false,'the first-person camera excludes the photographer layer');
  assert.equal(capture.restoredVisibility,true);assert.equal(capture.restoredLayers,true,'restore all scene camera layers after capture');
  assert.equal(pose.liveIncludesSelf,true,'the regular camera still renders the photographer');
  assert.ok(pose.sameSide&&pose.outside,'camera stays outside the pane on her side: '+JSON.stringify(pose));
  assert.ok(Math.abs(pose.windowHeight-.1255)<.001&&Math.abs(pose.direction[1])<.001,'camera looks horizontally through the middle of the glass: '+JSON.stringify(pose));
  assert.ok(pose.corners.every(([x,y,z])=>Math.abs(x)<1&&Math.abs(y)<1&&Math.abs(z)<1),'both edges and bottom of the front pane fit: '+JSON.stringify(pose));
  const pixels=await page.evaluate(async data=>{const image=new Image();image.src=data;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext('2d');x.drawImage(image,0,0);const p=x.getImageData(0,0,c.width,c.height).data;let varied=0;for(let i=0;i<p.length;i+=64)if(Math.abs(p[i]-p[0])+Math.abs(p[i+1]-p[1])+Math.abs(p[i+2]-p[2])>35)varied++;return {width:c.width,height:c.height,varied};},view.image);
  assert.equal(pixels.width,640);assert.equal(pixels.height,360);assert.ok(pixels.varied>100,JSON.stringify(pixels));
  const dailyFeed=await page.evaluate(async()=>{
    // End the photo visit before resetting the independent feed fixture.
    V3.actor.cancelBehavior('feed-fixture');
    const c=V3.cabinInventory,s=structuredClone(c.exportData());s.inventory.shore.fish.forEach(f=>{f.fed=0;});
    if(c.remote || !(await c.perform({op:'reset',rev:c.data.rev,id:c.id('fixture')})).ok || !(await c.restore(s)).ok)throw Error('fresh-feed fixture restore failed');
    const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now());
    const fedToday=()=>c.data.inventory.shore.fish.filter(f=>f.fed>0&&todayKey(f.fed)===today());
    const todayKey=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
    const count=c.data.inventory.shore.fish.length;let calls=0,mealSeen=false;
    while(fedToday().length<count && calls<count*3){
      const before=fedToday().length;let accepted=false;
      for(let wait=0;wait<200&&!accepted;wait++){accepted=V3.shallows.feedIfNeededToday();if(!accepted)await new Promise(done=>setTimeout(done,10));}
      if(!accepted)throw Error('auto-feed did not accept the next unfed resident');
      calls++;
      for(let wait=0;wait<200&&fedToday().length===before;wait++)await new Promise(done=>setTimeout(done,10));
      if(fedToday().length!==before+1)throw Error('one viewing must save exactly one fish feed');
      mealSeen ||= !!V3.shallows.state.meal;
    }
    return {calls,total:count,fed:fedToday().length,mealSeen,done:V3.shallows.feedIfNeededToday()===false};
  });
  assert.deepEqual(dailyFeed,{calls:dailyFeed.total,total:dailyFeed.total,fed:dailyFeed.total,mealSeen:true,done:true},JSON.stringify(dailyFeed));
  await page.reload();await ready();
  assert.equal(await page.evaluate(()=>V3.shallows.feedIfNeededToday()),false,"all residents' saved feeds remain complete after reload");
  assert.deepEqual(errors,[]); console.log('PASS: physical tank clicks, paid upgrades, daily auto-feed, first-person nonblank tank image, all resident behaviours and reload');
} finally { await browser?.close(); await server.close(); }
