import assert from 'node:assert/strict';
import path from 'node:path';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';

const server=await serveFiles({'/cabin.html':path.join(WEB_DIR,'dist/cabin.html')});
let browser;
try {
  browser=await launchBrowser({width:1080,height:760,gpu:'swiftshader'});
  const page=await browser.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const wait=fn=>page.waitForFunction(fn,{timeout:90000});
  const ready=()=>wait(()=>window.__READY && V3.cabinInventory.canShore() && V3.shallows.state.spots.length);
  const press=txt=>page.locator(`::-p-xpath(//button[normalize-space(.)='${txt}'])`).click();
  await page.goto(server.url+'/cabin.html?auto=0&time=morning&wx=clear'); await ready();
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
  assert.deepEqual(errors,[]); console.log('PASS: physical tank clicks, paid upgrades, gated dolphin invitation, all seven resident behaviours, full super tank and reload');
} finally { await browser?.close(); await server.close(); }
