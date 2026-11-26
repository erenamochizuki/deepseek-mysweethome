import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';

const pageName=process.env.CABIN_TEST_PAGE==='home'?'home':'cabin';
const buildDir=process.env.CABIN_BUILD_DIR || path.join(WEB_DIR,'dist');
const server=await serveFiles({['/'+pageName+'.html']:path.join(buildDir,pageName+'.html')});
let browser;
try {
  browser=await launchBrowser({width:1080,height:760,gpu:'swiftshader'});
  const page=await browser.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const wait=fn=>page.waitForFunction(fn,{timeout:90000});
  const ready=()=>wait(()=>window.__READY && V3.cabinInventory.canShore() && V3.shallows.state.spots.length);
  const press=txt=>page.locator(`::-p-xpath(//button[normalize-space(.)='${txt}'])`).click();
  await page.evaluateOnNewDocument(()=>{
    window.advanceToNet = () => {
      const part=V3.scene.parts.find(p=>p.id==='shallows'), state=V3.shallows.state;
      for (let i=0;i<400;i++) {
        part.update(.05,0);
        if (state.epoch===V3.inventoryRules.encounter(Date.now()) && state.inRing) return;
      }
      throw Error('Shallow visitor did not finish swimming into the net');
    };
  });
  await page.goto(server.url+'/'+pageName+'.html?auto=0&time=morning&wx=clear'); await ready();
  await page.evaluate(async()=>{
    const c=V3.cabinInventory, backup=structuredClone(c.exportData()), s=backup.inventory.shore;
    backup.inventory.coins=36; s.berth='west'; s.observed=['knifejaw','puffer'];
    s.fish=s.observed.map((kind,i)=>({uid:'demo:'+i,kind,name:['墨墨','点点'][i],fed:0,caughtAt:Date.now()-8*86400000}));
    const result=await c.restore(backup); if(!result.ok)throw Error(result.error);
  });
  await wait(()=>V3.shallows.state.tank.visible);
  const clickTank=async(attempt=0)=>{
    const pt=await page.evaluate(()=>{
      const t=V3.shallows.state.tank, p=t.position, h=t.userData.tankHeight, aim=[p.x,p.y+.12*h,p.z];
      V3.R.setView({pos:[p.x+.4,p.y+.4,p.z+1.7],target:aim}); V3.R.scene.updateMatrixWorld(true);
      const r=V3.R.canvas.getBoundingClientRect(), pt={clientX:r.x+r.width/2,clientY:r.y+r.height/2};
      if(V3.cabinTargets.pick(pt)?.what!=='homeTank')throw Error('Glass is not clickable'); return [pt.clientX,pt.clientY];
    });
    // A click lands on whatever is topmost at that point; wait out any fading overlay so the
    // assertion below tests the glass, not a transition frame.
    const deadline=Date.now()+15000; let top=null;
    for(;;) {
      top=await page.evaluate(([x,y])=>{const e=document.elementFromPoint(x,y),r=V3.R.canvas.getBoundingClientRect();
        return {ok:e===V3.R.canvas||!!(e&&e.closest&&e.closest('.shore-closeup')),tag:e?e.tagName:'',id:e?e.id:'',cls:e?String(e.className).slice(0,120):'',
          point:[x,y],rect:[r.x,r.y,r.width,r.height],window:[innerWidth,innerHeight],scroll:[scrollX,scrollY]};},pt);
      if(top.ok)break;
      if(Date.now()>deadline){
        // Software GL occasionally leaves a full-page overlay behind after a reload; one clean
        // reload re-runs the same physical click without weakening the assertion.
        if(attempt===0){console.log('点击前遮挡，重载一次重试：'+JSON.stringify(top));await page.reload();await ready();return clickTank(1);}
        throw Error('click target occluded at '+pt.join(',')+': '+JSON.stringify(top));
      }
      await new Promise(r=>setTimeout(r,150));
    }
    await page.mouse.click(...pt); await page.waitForSelector('.shore-closeup[data-subject="homeTank"]');
  };
  await clickTank(); await press('升级为加宽鱼缸 · 6 格 · 12 贝币'); await wait(()=>V3.shallows.state.tier===1);
  await press('升级为门廊落地缸 · 12 格 · 24 贝币'); await wait(()=>V3.shallows.state.tier===2);
  assert.equal(await page.evaluate(()=>V3.cabinInventory.data.inventory.coins),0);
  const rayUid=await page.evaluate(()=>{
    const r=V3.inventoryRules; let epoch=r.encounter(Date.now()); while(r.fishAt(++epoch)!=='sandray') {}
    Date.now=()=>epoch*300000+123; V3.shore.close(); window.advanceToNet();
    if(!V3.shallows.net())throw Error('Net missed ray'); return 'fish:'+epoch;
  });
  assert.match(await page.$eval('.shore-panel',n=>n.innerText),/这尾需要 4 格 · 缸里还剩 9 格/);
  await press('带回鱼缸');
  await wait(()=>V3.shallows.state.school.length===3);
  await clickTank();
  const checkCard=async uid=>{
    const card=await page.evaluate(uid=>{
      const f=V3.shore.shore().fish.find(r=>r.uid===uid), traits=V3.inventoryRules.fishTraits(f.kind,f.uid);
      const host=document.querySelector('.tank-orbit'), fields=[...document.querySelectorAll('.tank-traits dd')].map(n=>n.textContent);
      return {actual:fields, expected:[(traits.size/10).toFixed(1)+'厘米',traits.patternName,traits.finName],
        shown:host.dataset.uid,canvas:!!host.querySelector('canvas[tabindex="0"]')};
    },uid);
    assert.equal(card.shown,uid); assert.deepEqual(card.actual,card.expected); assert.ok(card.canvas);
  };
  const pickResident=async uid=>{
    await page.click('.tank-picker summary');
    await page.click(`.tank-choices button[value="${uid}"]`);
  };
  await checkCard('demo:0');
  for(const [uid,kind] of [['demo:0','knifejaw'],[rayUid,'sandray']]) {
    await pickResident(uid);
    await checkCard(uid);
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
    const fits=await page.evaluate(()=>{
      const panel=V3.shore.panel, card=panel.querySelector('.tank-specimen').getBoundingClientRect(), frame=panel.getBoundingClientRect();
      return card.bottom<=frame.bottom && card.top>=frame.top && panel.scrollWidth<=panel.clientWidth;
    });
    assert.ok(fits,'the model and its measurements are visible on first open at '+viewport.width);
    await page.click('.tank-picker summary');
    assert.ok(await page.$eval('.tank-picker',picker=>{
      const trigger=picker.querySelector('summary').getBoundingClientRect();
      const list=picker.querySelector('.tank-choices').getBoundingClientRect();
      const panel=picker.closest('.shore-panel').getBoundingClientRect();
      return Math.abs(list.left-trigger.left)<1 && Math.abs(list.right-trigger.right)<1 &&
        list.top>=trigger.bottom && list.top-trigger.bottom<=5 && list.bottom<=panel.bottom;
    }),'resident choices align with the trigger at '+viewport.width);
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('.tank-picker details',menu=>menu.open),false);
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
    const c=V3.cabinInventory, backup=structuredClone(c.exportData());
    backup.inventory.shore.fish=backup.inventory.shore.fish.slice(0,2);
    backup.inventory.shore.fish[0].name='泡泡'; backup.inventory.shore.fish[1].name='点点';
    if(c.remote || !(await c.perform({op:'reset',rev:c.data.rev,id:c.id('outline-fixture')})).ok || !(await c.restore(backup)).ok)throw Error('Could not seed the isolated resident fixture');
  });
  await wait(()=>V3.shallows.state.tank.visible && V3.shallows.state.school.filter(f=>f.visible).length===2);
  await clickTank();
  for(const uid of ['full:0','full:1']) {
    await pickResident(uid);
    await page.waitForFunction(uid=>V3.shallows.selectedResident?.userData.uid===uid,{},uid);
    const outlined=await page.evaluate(()=>{
      const outline=V3.hoverOutline, render=outline.render, R=V3.R, selected=V3.shallows.selectedResident;
      const frame=document.createElement('canvas');
      frame.width=R.canvas.width; frame.height=R.canvas.height;
      const ctx=frame.getContext('2d');
      const read=()=>{ctx.drawImage(R.canvas,0,0);return ctx.getImageData(0,0,frame.width,frame.height).data;};
      let actualTarget=null;
      try {
        outline.render=()=>{};
        R.render(); const normal=read();
        outline.render=function(renderer,scene,camera,resident) {
          actualTarget=resident;
          return render.call(this,renderer,scene,camera,resident);
        };
        R.render(); const highlighted=read();
        const bounds=new THREE.Box3().setFromObject(selected,true);
        const corners=[bounds.min.x,bounds.max.x].flatMap(x=>[bounds.min.y,bounds.max.y].flatMap(y=>[bounds.min.z,bounds.max.z].map(z=>new THREE.Vector3(x,y,z).project(R.camera))));
        const xs=corners.map(p=>(p.x+1)*frame.width/2), ys=corners.map(p=>(1-p.y)*frame.height/2);
        let changed=0;
        for(let y=Math.max(0,Math.floor(Math.min(...ys))-4);y<Math.min(frame.height,Math.max(...ys)+4);y++){
          for(let x=Math.max(0,Math.floor(Math.min(...xs))-4);x<Math.min(frame.width,Math.max(...xs)+4);x++){
            const i=(y*frame.width+x)*4;
            if(Math.abs(highlighted[i]-normal[i])+Math.abs(highlighted[i+1]-normal[i+1])+Math.abs(highlighted[i+2]-normal[i+2])>48) changed++;
          }
        }
        return {target:actualTarget===selected,uid:actualTarget?.userData.uid,changed};
      } finally {outline.render=render;}
    });
    assert.equal(outlined.target,true); assert.equal(outlined.uid,uid);
    assert.ok(outlined.changed>12,'选择在游戏画布上产生可见的轮廓：'+JSON.stringify(outlined));
  }
  if(process.env.TANK_RESIDENT_SHOT_DIR) {
    fs.mkdirSync(process.env.TANK_RESIDENT_SHOT_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.TANK_RESIDENT_SHOT_DIR,pageName+'-resident-selected.png')});
  }
  await page.evaluate(()=>V3.shore.close());
  assert.equal(await page.evaluate(()=>!!V3.shallows.selectedResident),false,'关掉鱼缸菜单后取消高亮');
  await page.evaluate(async()=>{
    const c=V3.cabinInventory,b=structuredClone(c.exportData()); b.inventory.shore.fish=[];b.inventory.coins=48;
    if(c.remote || !(await c.perform({op:'reset',rev:c.data.rev,id:c.id('fixture')})).ok || !(await c.restore(b)).ok)throw Error('isolated fixture failed');
    window.visit=kind=>{const r=V3.inventoryRules;let e=Math.max(r.encounter(Date.now()),V3.shore.shore().lastCatch)+1;while(r.fishAt(e)!==kind)e++;
      Date.now=()=>e*300000+998;window.advanceToNet();return e;};
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
    async function meal(kind,age){const f=residents.find(f=>f.kind===kind);V3.shore.panel.querySelector('.tank-picker summary').click();
      V3.shore.panel.querySelector(`.tank-choices button[value="${CSS.escape(f.uid)}"]`).click();
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
    actor.cancelBehavior('fixture');
    actor.place(-2.4,-7.5,0,1);
    if(!start('watch_tank'))throw Error('expected an autonomous tank visit before the QQ invitation');
    let routineRuns=0,protectedTrip=false;
    night.tick=()=>{routineRuns++;return false;};
    actor.startBehavior=(kind,options)=>{
      const started=start(kind,options);
      if(started&&kind==='watch_tank')queueMicrotask(()=>{
        const before=routineRuns;
        V3.cabinRoutine.tick();
        protectedTrip=actor.behavior?.together===true&&V3.shallows.tankCapturePending&&routineRuns===before;
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
  assert.equal(interruption.protectedTrip,true,'QQ invitation joins the existing walk and protects it from routine work');
  assert.equal(interruption.pending,false);
  assert.equal(interruption.resumed,true,'routine resumes after the photo ends');
  // A portrait viewport and fractional DPR exercise the independent photo aspect and buffer sizing.
  await page.setViewport({width:744,height:900});
  await wait(()=>V3.R.camera.aspect===744/900);
  await page.evaluate(()=>V3.shallows.openTank());
  await page.waitForFunction(()=>!!V3.shallows.selectedResident);
  const capture=await page.evaluate(async()=>{
    const R=V3.R,actor=V3.actor,original=R.post;
    const {renderer:liveRenderer,scene:liveScene,camera:liveCamera}=R;
    let photoOutlines=0;
    const outline=V3.hoverOutline, drawOutline=outline.render;
    outline.render=function(renderer,scene,camera,...rest) {
      if(camera!==liveCamera)photoOutlines++;
      return drawOutline.call(this,renderer,scene,camera,...rest);
    };
    liveRenderer.setPixelRatio(1.25);
    const layers=[];
    actor.root.traverse(object=>layers.push([object,object.layers.mask]));
    const liveState=()=>({
      size:liveRenderer.getSize(new THREE.Vector2()).toArray(),
      buffer:[liveRenderer.domElement.width,liveRenderer.domElement.height],
      canvasStyle:liveRenderer.domElement.style.cssText,
      dpr:liveRenderer.getPixelRatio(),
      viewport:liveRenderer.getViewport(new THREE.Vector4()).toArray(),
      scissor:liveRenderer.getScissor(new THREE.Vector4()).toArray(),
      scissorTest:liveRenderer.getScissorTest(),
      aspect:liveCamera.aspect,
      projection:liveCamera.projectionMatrix.toArray(),
      cameraLayers:liveCamera.layers.mask,
    });
    const before=liveState();
    let pose=null;
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
        const gl=renderer.getContext();
        pose={eye:eye.toArray(),direction:dir.toArray(),phase:actor.behavior?.phase,rootVisible:actor.root.visible,
          sameSide:Math.sign(eye[axis])===Math.sign(actorSide[axis]),outside:Math.abs(eye[axis])>near,
          windowHeight:eye.y/h,corners,liveIncludesSelf:meshes.every(object=>R.camera.layers.test(object.layers)),
          cameraIncludesSelf:meshes.some(object=>camera.layers.test(object.layers)),
          sameRendererAndScene:renderer===liveRenderer&&scene===liveScene,
          drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],aspect:camera.aspect};
      }
      return original(renderer,scene,camera,dt);
    };
    try{
      actor.respond('准备出发',{seconds:12});
      const startedFrom=actor.state;
      const fed=()=>V3.shore.shore().fish.map(f=>f.fed);
      const fedBefore=fed();
      if(!fedBefore.includes(0))throw Error('photo fixture needs an unfed fish');
      const view=await V3.cabinTools.call('fish_tank_view',{});
      const after=liveState();
      const snapshot=HTMLCanvasElement.prototype.toDataURL, rejectedQualities=[];
      const oversize='data:image/jpeg;base64,'+'A'.repeat(2*1024*1024);
      HTMLCanvasElement.prototype.toDataURL=function(type,quality){
        if(this!==liveRenderer.domElement || type!=='image/jpeg')return snapshot.apply(this,arguments);
        rejectedQualities.push(quality);
        return oversize;
      };
      let failure;
      try {failure=await V3.cabinTools.call('fish_tank_view',{});}
      finally {HTMLCanvasElement.prototype.toDataURL=snapshot;}
      return {view,startedFrom,pose,before,after,failure,rejectedQualities,afterFailure:liveState(),photoOutlines,fedBefore,fedAfter:fed(),
        restoredVisibility:actor.root.visible,restoredLayers:layers.every(([object,mask])=>object.layers.mask===mask)};
    }
    finally{R.post=original;outline.render=drawOutline;}
  });
  const {view,pose}=capture;
  assert.equal(capture.startedFrom,'respond','QQ capture can interrupt a busy attention animation');
  assert.equal(view.ok,true,view.error);assert.match(view.image,/^data:image\/jpeg;base64,/);
  assert.equal(capture.photoOutlines,0,'QQ 鱼缸照片不绘制菜单的描边');
  await page.evaluate(()=>V3.shore.close());
  assert.deepEqual(capture.fedAfter,capture.fedBefore,'QQ photos must leave feeding records untouched');
  assert.ok(Buffer.byteLength(view.image)<=2*1024*1024,'the full encoded JPEG data URL fits the bridge cap');
  assert.ok(pose,'the captured frame must use the dedicated first-person camera');
  assert.equal(pose.sameRendererAndScene,true);
  assert.deepEqual(pose.drawingBuffer,[1600,900],'the WebGL pass renders at native photo resolution');
  assert.equal(pose.aspect,1600/900);
  assert.deepEqual(capture.after,capture.before,'restore live canvas, renderer, and camera state after capture');
  assert.equal(capture.failure.error,'capture_failed');
  assert.equal(capture.failure.image,undefined,'an oversized JPEG never leaves the cabin');
  assert.ok(capture.rejectedQualities.length>1&&capture.rejectedQualities.every((q,i,a)=>i===0||q<a[i-1]),
    'retry oversized output at lower JPEG quality');
  assert.deepEqual(capture.afterFailure,capture.before,'restore live state when encoding stays over the limit');
  assert.ok(['action','sit'].includes(pose.phase),'capture waits until she finishes turning toward the tank: '+JSON.stringify(pose));
  assert.equal(pose.rootVisible,true,'capture must not change the whale scene visibility');
  assert.equal(pose.cameraIncludesSelf,false,'the first-person camera excludes the photographer layer');
  assert.equal(capture.restoredVisibility,true);assert.equal(capture.restoredLayers,true,'restore all scene camera layers after capture');
  assert.equal(pose.liveIncludesSelf,true,'the regular camera still renders the photographer');
  assert.ok(pose.sameSide&&pose.outside,'camera stays outside the pane on her side: '+JSON.stringify(pose));
  assert.ok(Math.abs(pose.windowHeight-.1255)<.001&&Math.abs(pose.direction[1])<.001,'camera looks horizontally through the middle of the glass: '+JSON.stringify(pose));
  assert.ok(pose.corners.every(([x,y,z])=>Math.abs(x)<1&&Math.abs(y)<1&&Math.abs(z)<1),'both edges and bottom of the front pane fit: '+JSON.stringify(pose));
  const preview=await page.evaluate(async data=>{
    const image=new Image();
    image.src=data;
    await image.decode();
    const c=document.createElement('canvas');
    c.width=image.naturalWidth;c.height=image.naturalHeight;
    const ctx=c.getContext('2d');
    ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,c.width,c.height).data;
    let varied=0;
    for(let i=0;i<pixels.length;i+=64){
      if(Math.abs(pixels[i]-pixels[0])+Math.abs(pixels[i+1]-pixels[1])+Math.abs(pixels[i+2]-pixels[2])>35)varied++;
    }
    return {width:c.width,height:c.height,varied};
  },view.image);
  assert.equal(preview.width,1600);assert.equal(preview.height,900);
  assert.ok(preview.varied>preview.width*preview.height/1600,'the browser-decoded preview is not blank');
  if(process.env.FISH_TANK_CAPTURE_PATH)fs.writeFileSync(process.env.FISH_TANK_CAPTURE_PATH,Buffer.from(view.image.split(',')[1],'base64'));
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
  assert.deepEqual(errors,[]); console.log('PASS: physical tank clicks, paid upgrades, daily auto-feed, bounded native-resolution first-person tank preview, all resident behaviours and reload');
} finally { await browser?.close(); await server.close(); }
