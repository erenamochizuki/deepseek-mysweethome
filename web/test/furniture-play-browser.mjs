import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {WEB_DIR,launchBrowser,serveFiles} from '../tools/mc-lib.mjs';
const srv=await serveFiles({'/cabin.html':path.join(WEB_DIR,'dist/cabin.html')});
const browser=await launchBrowser({width:1280,height:800}), errors=[];
const out=path.join(WEB_DIR,'shots/furniture-play');fs.mkdirSync(out,{recursive:true});
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(srv.url+'/cabin.html?wx=clear&live=0',{waitUntil:'load',timeout:120000});
 await page.waitForFunction(()=>window.__READY && V3.furniturePlay.state().ready,{timeout:120000});
 await page.evaluate(async()=>{await V3.view('floor=ground+time=noon+cam=0_17_-7_0_1_-10');V3.actor.hold(true);});
 const items=await page.evaluate(()=>V3.furniturePlay.state().items);console.log(JSON.stringify(items));
 const click=async kind=>{
   const p=await page.evaluate(async kind=>{
    const it=V3.furniturePlay.state().items.find(r=>r.kind===kind);if(!it)return null;
    const o=V3.furniturePlay.candidates().find(o=>o.userData.furnitureKey===it.key);if(!o)return null;
    const b=new THREE.Box3().setFromObject(o),c=b.getCenter(new THREE.Vector3());
    const front=V3.furnMc.rotate([0,0,-1],it.facing||'south');
    await V3.view('cam='+[c.x+front[0]*2,c.y+1.6,c.z+front[2]*2,c.x,c.y,c.z].join('_'));
    await V3.nextFrames(3);
    const p=c.clone().project(V3.R.camera),r=V3.R.canvas.getBoundingClientRect();return {key:it.key,x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
   },kind);
   assert.ok(p,'candidate '+kind);await page.mouse.click(p.x,p.y);
   await page.waitForFunction(key=>V3.furniturePlay.state().selected===key,{timeout:5000},p.key);
   return p.key;
 };
 const tv=await click('tv');assert.equal(await page.evaluate(k=>V3.furniturePlay.state().items.find(r=>r.key===k).state.on,tv),true);
 await page.click('[data-action="next"]');assert.equal(await page.evaluate(k=>V3.furniturePlay.state().items.find(r=>r.key===k).state.channel,tv),1);
 await page.screenshot({path:path.join(out,'television.png')});await page.click('[aria-label="关闭家具面板"]');
 const cooker=await click('cooker');assert.equal(await page.evaluate(k=>V3.furniturePlay.state().items.find(r=>r.key===k).state.phase,cooker),'cooking');
 await page.screenshot({path:path.join(out,'cooking.png')});
 await page.evaluate(()=>{const p=V3.scene.parts.find(p=>p.id==='furniture-play');p.update(31,31);});
 assert.equal(await page.evaluate(k=>V3.furniturePlay.state().items.find(r=>r.key===k).state.phase,cooker),'ready');
 await page.click('[data-action="serve"]');assert.equal(await page.evaluate(k=>V3.furniturePlay.state().items.find(r=>r.key===k).state.bowl,cooker),true);
 await page.evaluate(()=>V3.nextFrames(3));
 assert.ok(await page.evaluate(()=>{let n=0;V3.models.current().root.traverse(o=>{if(o.name!=='vox:rice')return;for(let p=o;p;p=p.parent)if(!p.visible)return;n++;});return n>=2;}),'both bowl and basin rice visibly rendered');
 await page.screenshot({path:path.join(out,'rice-served.png')});await page.click('[data-action="eat"]');
 assert.equal(await page.evaluate(k=>V3.furniturePlay.state().items.find(r=>r.key===k).state.bowl,cooker),false);
 await page.reload({waitUntil:'load'});await page.waitForFunction(()=>window.__READY&&V3.furniturePlay.state().ready,{timeout:120000});
 assert.equal(await page.evaluate(k=>V3.furniturePlay.state().items.find(r=>r.key===k).state.channel,tv),1);
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__errors||[]),[]);
 console.log('PASS real clicks TV channels, cooker cooking/serving/eating and reload persistence');
}finally{await browser.close();await srv.close();}
