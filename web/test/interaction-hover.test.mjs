import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';
const { V3 } = await loadV3(['69-interaction-hover.js']);
V3.shells = { KINDS: [{ id: 'scallop', name: '扇贝' }] };
let item = { key: 'one', kind: 'tv', state: { on: false } };
V3.furniturePlay = { state: () => ({ items: [item] }) };
const label = (what, userData = {}) => V3.interactionHover.label({ what, obj: { userData } });
for (const [what, text] of [['girl','小鲸鱼 · 戳一戳'],['shellBox','收藏柜 · 查看贝壳'],['album','相册 · 点击翻看'],['photo','照片 · 点击更换'],['houseSwitch','']]) assert.equal(label(what), text);
assert.equal(label('collect',{kind:'scallop'}), '扇贝 · 点击拾取');
assert.equal(label('furniture',{furnitureKey:'missing'}),'');
for (const [kind,state,ending] of [['tv',{on:false},'点击开机'],['tv',{on:true},'点击控制'],['cooker',{phase:'idle'},'点击煮饭'],['cooker',{phase:'cooking'},'点击查看'],['door',{open:true},'点击关门'],['door',{open:false},'点击开门'],['lamp',{enabled:false},'点击开灯'],['lamp',{enabled:true},'点击关灯']]) { item = {key:'one',kind,state}; assert.ok(label('furniture',{furnitureKey:'one'}).endsWith(ending)); }
item = {key:'one',kind:'rocker',state:{},sitting:true}; assert.ok(label('furniture',{furnitureKey:'one'}).includes('起身'));
console.log('PASS hover labels match executable categories and current furniture actions');
const u = process.argv.indexOf('--url');
const server = process.argv.includes('--browser') ? await serveFiles({'/home.html':path.join(WEB_DIR,'dist/home.html')}) : null;
if (server || u >= 0) {
 const browser = await launchBrowser({width:1280,height:900});
 const out = path.resolve(WEB_DIR,'../tmp/recovery-20261109/hover'); fs.mkdirSync(out,{recursive:true});
 try {
  const page = await browser.newPage(), errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const url = new URL(server ? server.url+'/home.html' : process.argv[u+1]); url.searchParams.set('live','0'); url.searchParams.set('time','noon');url.searchParams.set('wx','clear');
  await page.goto(url.href,{waitUntil:'load',timeout:60000});
  await page.waitForFunction(()=>window.__READY&&V3.interactionHover&&V3.furniturePlay.state().ready,{timeout:60000});
  await page.evaluate(async()=>{await V3.houseBlocks.live().ready;V3.game.set('girlAuto',false);window.pokes=[];V3.on('actor:poke',e=>pokes.push(e));});
  const visible=()=>page.evaluate(()=>!document.querySelector('.interaction-hover').hidden);
  const hidden=async()=>{await page.waitForFunction(()=>document.querySelector('.interaction-hover').hidden,{timeout:3000});assert.equal(await page.evaluate(()=>document.body.classList.contains('hover-pick')),false);};
  async function prep() {
   await page.evaluate(async()=>{await V3.view('girl=at_0_4_0');V3.R.ctl.set({az:0,el:.15,dist:3.5,target:[0,.65,4]},false);await V3.nextFrames(4);});
   return page.evaluate(()=>{const p=V3.actor.head().add(new THREE.Vector3(0,-.4,0)).project(V3.R.camera),r=V3.R.canvas.getBoundingClientRect();return{x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};});
  }
  async function hover(p,text='小鲸鱼') {await page.mouse.move(p.x-2,p.y);await page.mouse.move(p.x,p.y);await page.waitForFunction(t=>!document.querySelector('.interaction-hover').hidden&&document.querySelector('.interaction-hover-tip').textContent.includes(t),{timeout:3000},text);}
  let p = await prep(); await hover(p);
  assert.equal(await page.evaluate(()=>getComputedStyle(V3.R.canvas).cursor),'pointer');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.interaction-hover')).pointerEvents),'none');
  await page.screenshot({path:path.join(out,'actor-hover.png')});
  await page.mouse.click(p.x,p.y);assert.equal(await page.evaluate(()=>pokes.length),1);await hidden();
  p=await prep();await hover(p);await page.mouse.down();await hidden();await page.mouse.move(p.x+35,p.y);await page.mouse.move(p.x,p.y);await page.mouse.up();await hidden();assert.equal(await page.evaluate(()=>pokes.length),1);
  p=await prep();await hover(p);
  await page.evaluate(()=>{const a=V3.actor,c=V3.R.camera.position,p=a.head().add(new THREE.Vector3(0,-.4,0));window.wall=new THREE.Mesh(new THREE.BoxGeometry(2,2,.08),new THREE.MeshBasicMaterial({color:0x888888}));wall.position.copy(p).lerp(c,.25);wall.lookAt(c);V3.R.scene.add(wall);});
  await hidden();await page.mouse.click(p.x,p.y);assert.equal(await page.evaluate(()=>pokes.length),1);
  await page.evaluate(()=>{wall.removeFromParent();wall.geometry.dispose();wall.material.dispose();});await hover(p);
  await page.evaluate(p=>{window.overlay=document.createElement('div');overlay.style.cssText=`position:fixed;left:${p.x-50}px;top:${p.y-50}px;width:100px;height:100px;z-index:9999;background:white`;document.body.append(overlay);},p);await hidden();await page.evaluate(()=>overlay.remove());await hover(p);
  for (const field of ['arrange','fb']) {await page.evaluate(field=>{window.savedGate=V3[field];V3[field]={[field==='fb'?'enabled':'on']:true};},field);await hidden();await page.evaluate(field=>V3[field]=savedGate,field);await hover(p);}
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await hidden();await hover(p);
  await page.evaluate(()=>V3.R.canvas.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'})));await hidden();await hover(p);
  await page.evaluate(p=>V3.R.canvas.dispatchEvent(new PointerEvent('pointermove',{pointerType:'touch',clientX:p.x,clientY:p.y})),p);await hidden();await hover(p);
  await page.evaluate(()=>{window.actorParent=V3.actor.root.parent;V3.actor.root.removeFromParent();});await hidden();await page.evaluate(()=>actorParent.add(V3.actor.root));await hover(p);
  await page.evaluate(()=>V3.actor.root.visible=false);await hidden();await page.evaluate(()=>V3.actor.root.visible=true);await hover(p);
  await page.evaluate(()=>V3.emit('model'));await hidden();await hover(p);
  console.log('PASS real actor hover/click, wall, drag, overlay, modes, touch, blur, leave, removal and scene lifecycle');
  // Real furniture instances: scan their projected mesh extent for a visible surface, without bypassing the shared picker.
  const kinds=['tv','cooker','rocker','door','lamp'];
  const furniture=[];
  for(const kind of kinds){
   const points=await page.evaluate(async kind=>{
    await V3.view('floor='+(['door','lamp'].includes(kind)?'all':'ground'));await V3.nextFrames(12);const r=V3.furniturePlay.state().items.find(r=>r.kind===kind);if(!r)return[];
    const o=V3.furniturePlay.candidates().find(o=>o.userData.furnitureKey===r.key);
    if(!o)throw new Error(kind+' missing candidate '+JSON.stringify(V3.furniturePlay.candidates().map(o=>o.userData.furnitureKey)));
    const box=new THREE.Box3().setFromObject(o),c=box.getCenter(new THREE.Vector3());
    V3.R.ctl.set({az:-.7,el:.9,dist:4.5,target:c.toArray()},false);await V3.nextFrames(4);
    const rect=V3.R.canvas.getBoundingClientRect(),pts=[];
    for(const fx of [.5,.25,.75])for(const fy of [.5,.25,.75])for(const fz of [.5,.25,.75]){const p=new THREE.Vector3(box.min.x+(box.max.x-box.min.x)*fx,box.min.y+(box.max.y-box.min.y)*fy,box.min.z+(box.max.z-box.min.z)*fz).project(V3.R.camera);pts.push({x:rect.left+(p.x+1)/2*rect.width,y:rect.top+(1-p.y)/2*rect.height});}return pts;
   },kind);
   const expected={tv:'电视',cooker:'电饭煲',rocker:'摇椅',door:'门',lamp:'灯'}[kind];let found=false;
   for(const p of points){await page.mouse.move(p.x,p.y);await page.evaluate(()=>new Promise(r=>setTimeout(r,100)));found=await page.evaluate(s=>!document.querySelector('.interaction-hover').hidden&&document.querySelector('.interaction-hover-tip').textContent.startsWith(s+' ·'),expected);if(found)break;}
   assert.ok(found,'real '+kind+' visible hover');furniture.push(kind);
   if(kind==='rocker'||kind==='tv')await page.screenshot({path:path.join(out,kind+'-hover.png')});
  }
  const extras=[];
  for(const what of ['collect','album','photo','shellBox']) {
   const points=await page.evaluate(async what=>{
    await V3.view('floor='+(['shellBox','album','photo'].includes(what)?'loft':'ground'));await V3.nextFrames(12);
    let o;
    if(what==='collect'){V3.game.washNow(1);V3.beachItems.settle();await V3.nextFrames(8);o=V3.beachItems.objects()[0];window.hoverShell={id:o.userData.collectId,kind:o.userData.kind,n:(V3.game.st.found[o.userData.kind]||{n:0}).n};}
    else V3.models.current().root.traverse(n=>{if(!o&&n.userData.clickable===what){let shown=true;for(let p=n;p;p=p.parent)if(!p.visible)shown=false;if(shown)o=n;}});
    if(!o)return[];
    const box=new THREE.Box3().setFromObject(o),c=box.getCenter(new THREE.Vector3());
    let az=-.7,el=.9;if(what==='photo'){const n=new THREE.Vector3().fromBufferAttribute(o.geometry.attributes.normal,0).transformDirection(o.matrixWorld);az=Math.atan2(n.x,n.z);el=Math.asin(n.y)+.12;}
    V3.R.ctl.set({az,el,dist:what==='collect'?5.5:3.5,target:c.toArray()},false);await V3.nextFrames(4);
    const rect=V3.R.canvas.getBoundingClientRect(),pts=[];
    for(const fx of [.5,.25,.75])for(const fy of [.5,.25,.75])for(const fz of [.5,.25,.75]){const p=new THREE.Vector3(box.min.x+(box.max.x-box.min.x)*fx,box.min.y+(box.max.y-box.min.y)*fy,box.min.z+(box.max.z-box.min.z)*fz).project(V3.R.camera);pts.push({x:rect.left+(p.x+1)/2*rect.width,y:rect.top+(1-p.y)/2*rect.height});}return pts;
   },what);
   let found=null;
   for(const p of points){await page.mouse.move(p.x,p.y);await page.evaluate(()=>new Promise(r=>setTimeout(r,100)));if(await page.evaluate(what=>!document.querySelector('.interaction-hover').hidden&&document.querySelector('.interaction-hover').dataset.target===what,what)){found=p;break;}}
   assert.ok(found,'real '+what+' visible hover');extras.push(what);
   await page.screenshot({path:path.join(out,what+'-hover.png')});
   if(what==='collect'){await page.mouse.click(found.x,found.y);await hidden();assert.equal(await page.evaluate(()=>V3.game.st.found[hoverShell.kind].n-hoverShell.n),1);assert.equal(await page.evaluate(()=>V3.game.st.beach.some(i=>i.id===hoverShell.id)),false);}
  }
  await page.evaluate(()=>{window.oldSceneRoot=V3.models.current().root.uuid;V3.models.show('house2');});
  await hidden();await page.waitForFunction(()=>V3.models.current().root.uuid!==oldSceneRoot&&V3.furniturePlay.state().ready,{timeout:15000});
  assert.equal(await page.evaluate(()=>document.querySelectorAll('.interaction-hover').length),1);
  assert.deepEqual(errors,[]);
  const result={pass:true,build:await page.evaluate(()=>window.__V3_BUILD),furniture,extras,errors};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log('PASS browser hover',result);
 }finally{await browser.close();if(server)await server.close();}
}
