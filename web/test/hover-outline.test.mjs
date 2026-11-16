import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';
const {V3,window}=await loadV3(['08-hover-outline.js'],{three:'real'}),T=window.THREE;
const H=V3.hoverOutline;H.set([]);H.render({},new T.Scene(),new T.Camera());assert.equal(H.stats.passes,0);
const scene=new T.Scene(),o=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());H.set([o]);H.render({},scene,new T.Camera());assert.equal(H.stats.meshes,0);
scene.add(o);o.visible=false;H.render({},scene,new T.Camera());assert.equal(H.stats.passes,0);H.dispose();
console.log('PASS no target/detached/hidden do not allocate or render outline passes');
const u=process.argv.indexOf('--url'),server=process.argv.includes('--browser')?await serveFiles({'/home.html':path.join(WEB_DIR,'dist/home.html')}):null;
if(server||u>=0){
 const browser=await launchBrowser({width:1280,height:900}),out=path.resolve(WEB_DIR,'../tmp/hover-outline-20261109');fs.mkdirSync(out,{recursive:true});
 try{
  const results=[];
  for(const noPost of (process.argv.includes('--final')?[false]:[false,true])){
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   const url=new URL(server?server.url+'/home.html':process.argv[u+1]);url.searchParams.set('live','0');url.searchParams.set('time','noon');url.searchParams.set('wx','clear');if(noPost)url.searchParams.set('nopost','1');
   await page.goto(url.href,{waitUntil:'load',timeout:60000});await page.waitForFunction(()=>window.__READY&&V3.hoverOutline&&V3.furniturePlay.state().ready,{timeout:60000});
   const pixels=await page.evaluate(()=>{
    const H=V3.hoverOutline,r=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});r.setSize(128,128);r.setClearColor(0x223344);r.shadowMap.enabled=true;
    const scene=new THREE.Scene(),cam=new THREE.OrthographicCamera(-2,2,2,-2,.1,20);cam.position.set(0,0,5);cam.lookAt(0,0,0);cam.updateMatrixWorld();
    const target=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshBasicMaterial({color:0x778899}));scene.add(target);
    const rt=new THREE.WebGLRenderTarget(128,128),read=()=>{const a=new Uint8Array(128*128*4);r.readRenderTargetPixels(rt,0,0,128,128,a);return a;};
    const diff=(a,b)=>{const pts=[];for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>12)pts.push([i/4%128,Math.floor(i/4/128)]);return pts;};
    function draw(objects){H.set(objects);r.setRenderTarget(rt);r.render(scene,cam);const before=read(),mat=target.material,bg=scene.background,clear=r.getClearColor(new THREE.Color()).getHex(),shadow=r.shadowMap.autoUpdate;H.render(r,scene,cam);if(target.material!==mat||scene.background!==bg||r.getRenderTarget()!==rt||clear!==r.getClearColor(new THREE.Color()).getHex()||shadow!==r.shadowMap.autoUpdate||!r.autoClear)throw Error('renderer state leaked');return{pts:diff(before,read()),before,after:read(),passes:H.stats.passes};}
    const sphere=draw([target]);if(sphere.pts.length<150)throw Error('silhouette invisible '+sphere.pts.length);
    if(sphere.pts.some(([x,y])=>Math.hypot(x-63.5,y-63.5)<28))throw Error('outline painted sphere interior');
    const wall=new THREE.Mesh(new THREE.PlaneGeometry(2,4),new THREE.MeshBasicMaterial({color:0x991133}));wall.position.set(-1,0,2);scene.add(wall);
    const partial=draw([target]);if(partial.pts.length<40||partial.pts.some(([x])=>x<63))throw Error('outline leaks across foreground wall');
    wall.scale.x=3;wall.position.x=0;const covered=draw([target]);if(covered.pts.length)throw Error('outline visible through wall');scene.remove(wall);
    target.visible=false;
    const tex=new THREE.DataTexture(new Uint8Array([255,255,255,255,255,255,255,0,255,255,255,0,255,255,255,255]),2,2);tex.needsUpdate=true;
    const cut=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({map:tex,alphaTest:.5}));scene.add(cut);
    const alpha=draw([cut]);if(alpha.pts.length<100)throw Error('alpha cutout outline absent');
    // Empty alpha quadrant far from geometry edges must remain untouched; diagonal alpha boundary gets outline.
    if(alpha.pts.some(([x,y])=>x>72&&x<85&&y>72&&y<85))throw Error('alpha hole filled');
    scene.remove(cut);target.visible=true;const copy=target.clone();copy.userData.hoverOutlineOnly=true;copy.matrixAutoUpdate=false;copy.matrix.copy(target.matrix);
    const detached=draw([copy]);if(detached.pts.length<100||copy.parent)throw Error('outline-only copy missing or leaked');
    const originalRender=r.render;r.render=()=>{throw new Error('intentional-mask-failure');};let caught=false;
    H.set([copy]);try{H.render(r,scene,cam);}catch(e){caught=e.message==='intentional-mask-failure';}finally{r.render=originalRender;}
    if(!caught||copy.parent||target.material.type!=='MeshBasicMaterial'||!r.autoClear||r.getRenderTarget()!==rt)throw Error('mask failure leaked state');
    target.position.x=.5;target.updateMatrixWorld();const moved=draw([target]);if(!moved.pts.some(([x])=>x>103))throw Error('animated transform not followed');
    H.clear();const idle=draw([]);if(idle.pts.length||idle.passes)throw Error('idle outline persists');
    r.setSize(96,80);H.set([target]);r.setRenderTarget(null);r.render(scene,cam);H.render(r,scene,cam);if(H.stats.width!==96||H.stats.height!==80)throw Error('resize not followed');
    H.dispose();rt.dispose();r.dispose();tex.dispose();target.geometry.dispose();target.material.dispose();wall.geometry.dispose();wall.material.dispose();cut.geometry.dispose();cut.material.dispose();
    return{sphere:sphere.pts.length,partial:partial.pts.length,covered:covered.pts.length,alpha:alpha.pts.length,detached:detached.pts.length,idle:idle.pts.length};
   });
   await page.evaluate(async()=>{V3.game.set('girlAuto',false);await V3.view('girl=at_0_4_0');V3.R.ctl.set({az:0,el:.15,dist:3.5,target:[0,.65,4]},false);await V3.nextFrames(6);});
   const p=await page.evaluate(()=>{const p=V3.actor.head().add(new THREE.Vector3(0,-.4,0)).project(V3.R.camera),r=V3.R.canvas.getBoundingClientRect();return{x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};});
   await page.mouse.move(p.x,p.y);await page.waitForFunction(()=>V3.hoverOutline.stats.passes===3&&document.querySelector('.interaction-hover').dataset.target==='girl',{timeout:5000});
   assert.equal(await page.$('.interaction-hover-mark'),null);
   const actualPixels = async kind => page.evaluate(kind=>{
    let objects;
    if(kind==='girl')objects=[V3.actor.root];
    else if(kind==='collect')objects=[V3.beachItems.objects()[0]];
    else if(kind==='photo')objects=V3.furniturePlay.hoverObjects({what:'photo',obj:window.outlinePhoto});
    else{const rec=V3.furniturePlay.state().items.find(r=>r.kind===kind),obj=V3.furniturePlay.candidates().find(o=>o.userData.furnitureKey===rec.key);objects=V3.furniturePlay.hoverObjects({what:'furniture',obj});}
    const R=V3.R,H=V3.hoverOutline,c=document.createElement('canvas');c.width=R.canvas.width;c.height=R.canvas.height;const ctx=c.getContext('2d');
    const read=()=>{ctx.drawImage(R.canvas,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
    H.clear();R.render();const base=read();H.set(objects);R.render();const highlighted=read();let changed=0;
    for(let i=0;i<base.length;i+=4)if(Math.abs(base[i]-highlighted[i])+Math.abs(base[i+1]-highlighted[i+1])+Math.abs(base[i+2]-highlighted[i+2])>20)changed++;
    H.clear();R.render();const cleared=read();let residual=0;for(let i=0;i<base.length;i+=4)if(Math.abs(base[i]-cleared[i])+Math.abs(base[i+1]-cleared[i+1])+Math.abs(base[i+2]-cleared[i+2])>20)residual++;
    H.set(objects);R.render();let wallPixels=0,wallHits=[];if(window.outlineWall?.parent){for(let y=100;y<780;y++)for(let x=160;x<520;x++){const i=(y*c.width+x)*4;if(Math.abs(base[i]-highlighted[i])+Math.abs(base[i+1]-highlighted[i+1])+Math.abs(base[i+2]-highlighted[i+2])>20){wallPixels++;if(wallHits.length<3){const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x/c.width*2-1,1-y/c.height*2),R.camera);wallHits.push({x,y,hits:ray.intersectObjects(R.scene.children,true).slice(0,3).map(h=>({name:h.object.name,wall:h.object===outlineWall,distance:h.distance,point:h.point.toArray(),mat:h.object.material?.type}))});}}}}return{changed,residual,wallPixels,wallHits};
   },kind);
   const actorPixels=await actualPixels('girl');assert.ok(actorPixels.changed>150,'real actor silhouette pixels');assert.equal(actorPixels.residual,0);
   await page.screenshot({path:path.join(out,'actor-'+(noPost?'nopost':'post')+'.png')});
   if(!noPost){
    await page.evaluate(()=>{const a=V3.actor,c=V3.R.camera.position,p=a.head().add(new THREE.Vector3(0,-.75,0));window.outlineWall=new THREE.Mesh(new THREE.BoxGeometry(.45,1.8,.05),new THREE.MeshBasicMaterial({color:0x47687a}));outlineWall.position.copy(p).lerp(c,.5);outlineWall.position.x-=.3;outlineWall.lookAt(c);V3.R.scene.add(outlineWall);V3.hoverOutline.set([a.root]);V3.R.render();});
    await page.evaluate(()=>{window.savedWallFreeze=V3.R.frozen;window.savedWallShadow=V3.R.renderer.shadowMap.autoUpdate;V3.R.freeze(V3.R.t);V3.R.renderer.shadowMap.autoUpdate=false;});
    for(let check=0;check<12;check++){const wallDelta=await actualPixels('girl');console.log('Real wall pixel delta',JSON.stringify(wallDelta));assert.equal(wallDelta.wallPixels,0,'real wall must receive zero outline pixels');await page.evaluate(()=>V3.nextFrames(2));}
    await page.evaluate(()=>{V3.R.freeze(savedWallFreeze);V3.R.renderer.shadowMap.autoUpdate=savedWallShadow;});
    await page.screenshot({path:path.join(out,'actor-partial-occlusion.png')});
    await page.evaluate(()=>{outlineWall.removeFromParent();outlineWall.geometry.dispose();outlineWall.material.dispose();});
   }
   await page.mouse.move(5,5);await page.waitForFunction(()=>V3.hoverOutline.stats.passes===0,{timeout:3000});
   const realPixels={actor:actorPixels};
   if(!noPost){
    for(const kind of (process.argv.includes('--final')?['tv','photo']:['tv','cooker','rocker','collect','photo'])){
     const pts=await page.evaluate(async kind=>{
      await V3.view('floor='+(kind==='photo'?'loft':'ground'));await V3.nextFrames(12);let o;
      if(kind==='photo'){V3.models.current().root.traverse(n=>{if(!o&&n.userData.clickable==='photo'){let shown=true;for(let p=n;p;p=p.parent)if(!p.visible)shown=false;if(shown)o=n;}});window.outlinePhoto=o;}
      else if(kind==='collect'){V3.game.washNow(1);await new Promise(resolve=>setTimeout(resolve,1800));o=V3.beachItems.objects()[0];}
      else{const rec=V3.furniturePlay.state().items.find(r=>r.kind===kind);o=V3.furniturePlay.candidates().find(o=>o.userData.furnitureKey===rec.key);}
      const b=new THREE.Box3().setFromObject(o),c=b.getCenter(new THREE.Vector3());let az=-.7,el=.9;if(kind==='photo'){const n=new THREE.Vector3().fromBufferAttribute(o.geometry.attributes.normal,0).transformDirection(o.matrixWorld);az=Math.atan2(n.x,n.z);el=Math.asin(n.y)+.12;}V3.R.ctl.set({az,el,dist:kind==='collect'?3:4.5,target:c.toArray()},false);await V3.nextFrames(8);
      const r=V3.R.canvas.getBoundingClientRect(),pts=[];for(const x of [.5,.25,.75])for(const y of [.5,.25,.75])for(const z of [.5,.25,.75]){const p=new THREE.Vector3(b.min.x+(b.max.x-b.min.x)*x,b.min.y+(b.max.y-b.min.y)*y,b.min.z+(b.max.z-b.min.z)*z).project(V3.R.camera);pts.push({x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height});}return pts;
     },kind);
     let found=false;const text={tv:'电视',cooker:'电饭煲',rocker:'摇椅',collect:'点击拾取',photo:'点击更换'}[kind];
     for(const p of pts){await page.mouse.move(p.x,p.y);await page.evaluate(()=>new Promise(r=>setTimeout(r,160)));found=await page.evaluate(text=>V3.hoverOutline.stats.passes===3&&!document.querySelector('.interaction-hover').hidden&&document.querySelector('.interaction-hover-tip').textContent.includes(text),text);if(found)break;}
     assert.ok(found,kind+' actual outline and label');const delta=await actualPixels(kind);realPixels[kind]=delta;assert.ok(delta.changed>50,kind+' actual silhouette pixels');assert.equal(delta.residual,0,kind+' cleanup pixel residue');await page.screenshot({path:path.join(out,kind+'-outline.png')});
    }
   }
   assert.deepEqual(errors,[]);results.push({noPost,pixels,realPixels,build:await page.evaluate(()=>window.__V3_BUILD),errors});await page.close();
  }
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({pass:true,results},null,2));console.log('PASS pixel silhouette, occlusion, alpha cutouts, detached copies, movement, cleanup, resize, state restoration and post/nopost',results);
 }finally{await browser.close();if(server)await server.close();}
}
