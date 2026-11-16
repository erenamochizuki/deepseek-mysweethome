import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';
const {V3,window}=await loadV3(['03-vox.js','30-shells.js'],{three:'real'}),T=window.THREE;
const out=path.resolve(WEB_DIR,'../tmp/shell-correction-20261109');fs.mkdirSync(out,{recursive:true});
const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],report=[];
const key=(p,n)=>p.map(v=>Math.round(v*2)).join(',')+'/'+n.join(',');
for(const kind of V3.shells.KINDS){
 const g=V3.shells._grid(kind.id),o=V3.shells.build(kind.id,{tag:false}),mesh=o.children[0],geo=mesh.geometry;
 const expected=new Map(),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],bottom=[];
 let voxels=0;
 for(let iz=0;iz<g.nz;iz++)for(let iy=0;iy<g.ny;iy++)for(let ix=0;ix<g.nx;ix++){
  const p=[ix-g.o[0],iy-g.o[1],iz-g.o[2]];if(!g.has(...p))continue;voxels++;
  p.forEach((v,i)=>{lo[i]=Math.min(lo[i],v);hi[i]=Math.max(hi[i],v);});
  for(const n of dirs){if(g.has(...p.map((v,i)=>v+n[i])))continue;const center=p.map((v,i)=>v+.5*n[i]);expected.set(key(center,n),0);if(n[1]===-1)bottom.push(center);}
 }
 const cells=Math.max(...hi.map((v,i)=>v-lo[i]+1)),scale=kind.size/cells;
 const shift=[(lo[0]+hi[0])/2,lo[1]-.5,(lo[2]+hi[2])/2];
 const pos=geo.attributes.position,nor=geo.attributes.normal,idx=geo.index;
 let bottomTris=0,groundTris=0;
 const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),normal=new T.Vector3();
 for(let i=0;i<idx.count;i+=3){
  const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];ids.forEach(j=>assert.ok(j>=0&&j<pos.count));
  a.fromBufferAttribute(pos,ids[0]);b.fromBufferAttribute(pos,ids[1]);c.fromBufferAttribute(pos,ids[2]);
  assert.ok([...a.toArray(),...b.toArray(),...c.toArray()].every(Number.isFinite));
  normal.copy(b).sub(a).cross(c.clone().sub(a));
  assert.ok(Math.abs(normal.length()/(scale*scale)-1)<1e-4,kind.id+' nondegenerate unit-voxel triangle');
  const n=new T.Vector3().fromBufferAttribute(nor,ids[0]);assert.ok(normal.clone().normalize().dot(n)>.9999,kind.id+' outward winding');
  for(const id of ids)assert.ok(n.distanceTo(new T.Vector3().fromBufferAttribute(nor,id))<1e-7);
  const pts=[a.toArray(),b.toArray(),c.toArray()],center=[0,1,2].map(d=>(Math.min(...pts.map(p=>p[d]))+Math.max(...pts.map(p=>p[d])))/2/scale+shift[d]);
  const k=key(center,n.toArray());assert.ok(expected.has(k),kind.id+' no invented cap over a modeled opening: '+k);expected.set(k,expected.get(k)+1);
  if(n.y<-.5){bottomTris++;if(Math.abs(a.y)<1e-7)groundTris++;}
 }
 for(const [k,count]of expected)assert.equal(count,2,kind.id+' complete exposed voxel face '+k);
 assert.ok(groundTris>0);assert.ok(Math.abs(geo.boundingBox.min.y)<1e-7);
 mesh.material.forEach(m=>assert.equal(m.side,T.FrontSide));
 assert.equal(V3.shells.build(kind.id,{tag:false}).children[0].geometry,geo,'shared immutable geometry cache');
 // Rays from below and after flipping, including every sand-dollar underside face.
 const samples=kind.id==='dollar'?bottom:bottom.filter((_,i)=>i%Math.max(1,Math.floor(bottom.length/16))===0);
 const ray=new T.Raycaster();let rayChecks=0;
 for(const p of samples){
  const surface=new T.Vector3(...p.map((v,i)=>(v-shift[i])*scale));
  for(const flip of [0,Math.PI]){
   o.rotation.x=flip;o.updateMatrixWorld(true);const direction=new T.Vector3(0,1,0).transformDirection(o.matrixWorld),world=surface.clone().applyMatrix4(o.matrixWorld);
   ray.set(world.clone().addScaledVector(direction,-scale*.2),direction);ray.near=0;ray.far=scale*.4;
   assert.ok(ray.intersectObject(o,true).length,kind.id+' visible underside after rotation '+flip);rayChecks++;
  }
 }
 o.rotation.x=0;
 report.push({id:kind.id,name:kind.name,voxels,triangles:idx.count/3,exposedFaces:expected.size,bottomTriangles:bottomTris,groundTriangles:groundTris,recoveredTriangles:groundTris,rayChecks});
}
fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify({pass:true,kinds:report},null,2));
console.log('PASS all 12 kinds: exact occupied/empty voxel boundary, outward normals, nondegenerate triangles, FrontSide and flipped underside rays');console.table(report.map(({id,triangles,groundTriangles,rayChecks})=>({id,triangles,recovered:groundTriangles,rayChecks})));
const u=process.argv.indexOf('--url');
const server=process.argv.includes('--browser')?await serveFiles({'/studio.html':path.join(WEB_DIR,'dist/studio.html')}):null;
if(server||u>=0){
 const browser=await launchBrowser({width:1280,height:900});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=new URL(server?server.url+'/studio.html':process.argv[u+1]);url.searchParams.set('model','shells');
  await page.goto(url.href,{waitUntil:'load',timeout:60000});await page.waitForFunction(()=>window.__READY&&V3.shells,{timeout:60000});
  const data=await page.evaluate(()=>{
   const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(400,400);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
   const scene=new THREE.Scene();scene.background=new THREE.Color('#b8c5cf');scene.add(new THREE.AmbientLight(0xffffff,.9));
   for(const p of [[2,3,4],[-2,-3,-4]]){const l=new THREE.DirectionalLight(0xffffff,1.1);l.position.set(...p);scene.add(l);}
   const dirs=[{name:'顶面 Top',p:[0,1,0],up:[0,0,-1]},{name:'底面 Bottom',p:[0,-1,0],up:[0,0,1]},{name:'前面 Front',p:[0,.2,1],up:[0,1,0]},{name:'侧面 Side',p:[1,.2,0],up:[0,1,0]}],rows=[];
   for(const k of V3.shells.KINDS){
    const o=V3.shells.build(k.id,{tag:false});scene.add(o);const box=new THREE.Box3().setFromObject(o),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),span=Math.max(size.x,size.y,size.z)*.68;
    const camera=new THREE.OrthographicCamera(-span,span,span,-span,.001,10),images=[];
    for(const v of dirs){camera.up.set(...v.up);camera.position.copy(center).add(new THREE.Vector3(...v.p).normalize().multiplyScalar(1));camera.lookAt(center);camera.updateMatrixWorld();renderer.render(scene,camera);images.push({view:v.name,png:renderer.domElement.toDataURL('image/png')});}
    rows.push({id:k.id,name:k.name,triangles:o.userData.tris,images});scene.remove(o);
   }
   renderer.dispose();return{build:window.__V3_BUILD,rows};
  });
  const sheet=await browser.newPage();await sheet.setViewport({width:1600,height:450,deviceScaleFactor:1});
  for(const row of data.rows){
   for(let i=0;i<row.images.length;i++)fs.writeFileSync(path.join(out,row.id+'-'+['top','bottom','front','side'][i]+'.png'),Buffer.from(row.images[i].png.split(',')[1],'base64'));
   await sheet.setContent(`<body style="margin:0;background:#eaf0f3;font:18px system-ui;color:#193746"><header style="height:40px;padding-left:16px;line-height:40px">${row.name} / ${row.id} · ${row.triangles} triangles · FrontSide</header><main style="display:flex">${row.images.map(im=>`<div style="position:relative"><img width="400" height="400" src="${im.png}"><span style="position:absolute;left:12px;top:8px">${im.view}</span></div>`).join('')}</main></body>`);
   await sheet.screenshot({path:path.join(out,row.id+'-four-views.png'),fullPage:true});
  }
  await sheet.setViewport({width:1500,height:2160,deviceScaleFactor:1});
  await sheet.setContent(`<body style="margin:0;background:#eaf0f3;color:#193746;font:17px system-ui"><main style="display:grid;grid-template-columns:repeat(3,500px)">${data.rows.map(row=>`<article><header style="height:40px;line-height:40px;padding-left:12px">${row.name} / ${row.id}</header><div style="display:grid;grid-template-columns:repeat(2,250px)">${row.images.map(im=>`<div style="position:relative"><img width="250" height="250" src="${im.png}"><span style="position:absolute;left:8px;top:6px">${im.view}</span></div>`).join('')}</div></article>`).join('')}</main></body>`);
  await sheet.screenshot({path:path.join(out,'all-12-contact-sheet.png'),fullPage:true});
  assert.deepEqual(errors,[]);for(const row of data.rows)assert.equal(row.triangles,report.find(r=>r.id===row.id).triangles,'built browser geometry matches fixed source');
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({pass:true,build:data.build,rows:data.rows.map(({id,triangles})=>({id,triangles})),errors},null,2));console.log('PASS real browser 48 views; build '+data.build);
 }finally{await browser.close();if(server)await server.close();}
}
