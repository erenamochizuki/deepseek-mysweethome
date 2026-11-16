// GPU regression: moving a camera must not paint coplanar furniture interiors.
// node test/hover-outline-stability.test.mjs --url <isolated built home.html URL>
import assert from 'node:assert/strict';
import { launchBrowser } from '../tools/mc-lib.mjs';
const urlIndex = process.argv.indexOf('--url');
if (urlIndex >= 0) {
 const browser = await launchBrowser({width:1000,height:760});
 try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const url=new URL(process.argv[urlIndex+1]);url.searchParams.set('live','0');
  await page.goto(url.href,{waitUntil:'load'});
  await page.waitForFunction(()=>window.__READY&&V3.furniturePlay.state().ready,{timeout:60000});
  const result=await page.evaluate(async()=>{
   await V3.view('time=night+weather=clear+floor=loft');
   const R=V3.R,H=V3.hoverOutline,r=R.renderer;
   R.freeze(R.t);r.shadowMap.autoUpdate=false;
   const rec=V3.furniturePlay.state().items.find(x=>x.kind==='telescope');
   const obj=V3.furniturePlay.candidates().find(o=>o.userData.furnitureKey===rec.key);
   const objects=V3.furniturePlay.hoverObjects({what:'furniture',obj});
   // An independent selected-only silhouette is the reference, irrespective of the implementation's mask passes.
   const reference=new THREE.Scene(),white=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide});
   for(const root of objects){root.updateWorldMatrix(true,true);root.traverseVisible(o=>{if(o.isMesh){const m=new THREE.Mesh(o.geometry,white);m.matrixAutoUpdate=false;m.matrix.copy(o.matrixWorld);reference.add(m);}});}
   const w=R.canvas.width,h=R.canvas.height,target=new THREE.WebGLRenderTarget(w,h);
   const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');
   const read=()=>{ctx.drawImage(R.canvas,0,0);return ctx.getImageData(0,0,w,h).data;};
   const rows=[];
   for(let frame=0;frame<16;frame++){
    R.ctl.set({az:.15+frame*.001,el:.12+frame*.0004,dist:2.2,target:[.5,5.6,-7.5]});
    r.setRenderTarget(target);r.render(reference,R.camera);const mask=new Uint8Array(w*h*4);r.readRenderTargetPixels(target,0,0,w,h,mask);r.setRenderTarget(null);
    H.clear();R.render();const base=read();H.set(objects);R.render();const after=read();
    let interior=0,painted=0,changed=0;
    for(let y=5;y<h-5;y++)for(let x=5;x<w-5;x++){
     const j=((h-1-y)*w+x)*4;
     const delta=Math.abs(base[j]-after[j])+Math.abs(base[j+1]-after[j+1])+Math.abs(base[j+2]-after[j+2]);
     if(delta>20)changed++;
     if(mask[(y*w+x)*4]<128)continue;
     let inside=true;
     for(let dy=-4;dy<=4&&inside;dy++)for(let dx=-4;dx<=4;dx++)if(mask[((y+dy)*w+x+dx)*4]<128){inside=false;break;}
     if(inside){interior++;if(delta>20)painted++;}
    }
    rows.push({frame,interior,painted,changed});
   }
   // Completely covered geometry must not outline through a foreground board.
   const wall=new THREE.Mesh(new THREE.PlaneGeometry(3,3),new THREE.MeshBasicMaterial({color:0x445566}));
   const center=new THREE.Vector3(.5,5.6,-7.5);wall.position.copy(center).lerp(R.camera.position,.5);wall.lookAt(R.camera.position);R.scene.add(wall);
   H.clear();R.render();const base=read();H.set(objects);R.render();const after=read();let covered=0;
   for(let i=0;i<base.length;i+=4)if(Math.abs(base[i]-after[i])+Math.abs(base[i+1]-after[i+1])+Math.abs(base[i+2]-after[i+2])>20)covered++;
   wall.removeFromParent();wall.geometry.dispose();wall.material.dispose();target.dispose();white.dispose();
   return {rows,covered};
  });
  console.log(JSON.stringify(result));
  for(const row of result.rows){assert.ok(row.interior>50000,'real telescope surface is visible');assert.ok(row.changed>1000,'silhouette remains visible');assert.ok(row.painted<=10,'spurious interior highlight at angle '+row.frame+': '+row.painted);}
  assert.equal(result.covered,0,'foreground board hides every outline pixel');assert.deepEqual(errors,[]);
  console.log('PASS 16 camera angles: no visible interior flicker; foreground occlusion intact');
 } finally {await browser.close();}
}
