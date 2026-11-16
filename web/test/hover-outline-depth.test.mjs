// Independent scene and selection depth avoid coplanar copy z-fighting without slope offsets.
// Pixel regressions (camera motion, coplanar copies, and foreground occlusion) run in the browser test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';
function setup() {
 const {V3,window}=loadV3(['08-hover-outline.js'],{three:'real',...(process.env.HOVER_SRC_DIR?{srcDir:process.env.HOVER_SRC_DIR}:{})}),T=window.THREE;
 const seen=[];
 const r={autoClear:true,toneMapping:0,shadowMap:{autoUpdate:true},info:{autoReset:true},target:null,
 getDrawingBufferSize:v=>v.set(32,32),getPixelRatio:()=>1,getRenderTarget:()=>r.target,setRenderTarget:t=>{r.target=t;},
 getClearAlpha:()=>1,getClearColor:c=>c,setClearColor(){},getViewport:v=>v,setViewport(){},getScissor:v=>v,setScissor(){},getScissorTest:()=>false,setScissorTest(){},clear(){},
 render(scene){if(r.target?.isWebGLRenderTarget){const materials={};scene.traverse(o=>{if(o.isMesh)materials[o.name]=o.material;});seen.push({target:r.target,materials});}}};
 return {T,H:V3.hoverOutline,r,seen};
}
const off=m=>({on:!!m.polygonOffset,factor:m.polygonOffset?m.polygonOffsetFactor:0,units:m.polygonOffset?m.polygonOffsetUnits:0});
test('both depth passes retain source offsets without pulling selected hidden surfaces forward',()=>{
 const {T,H,r,seen}=setup(),scene=new T.Scene();
 const girl=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());girl.name='girl';
 const quilt=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial({polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-4}));quilt.name='quilt';scene.add(girl,quilt);
 H.set([girl]);H.render(r,scene,new T.PerspectiveCamera());
 assert.equal(seen.length,2);assert.notEqual(seen[0].target,seen[1].target);
 assert.deepEqual(off(seen[0].materials.girl),{on:false,factor:0,units:0});
 assert.deepEqual(off(seen[1].materials.girl),{on:false,factor:0,units:0});
 assert.deepEqual(off(seen[0].materials.quilt),{on:true,factor:-1,units:-4});
 assert.equal(seen[1].materials.quilt.visible,false,'occluders write only the scene depth');
 assert.equal(girl.material.isMeshStandardMaterial,true);H.dispose();
});
test('detached copy and original never compete in the same depth buffer, even beneath a mesh parent',()=>{
 const {T,H,r,seen}=setup(),scene=new T.Scene();
 const parent=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());parent.name='parent';
 const body=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());body.name='body';parent.add(body);scene.add(parent);
 const copy=body.clone();copy.name='copy';copy.userData.hoverOutlineOnly=true;
 H.set([copy]);H.render(r,scene,new T.PerspectiveCamera());
 assert.ok(seen[0].materials.body.visible);assert.equal(seen[0].materials.copy,undefined);
 assert.equal(seen[1].materials.body.visible,false);assert.ok(seen[1].materials.copy.visible);assert.equal(copy.parent,null);
 H.set([body]);seen.length=0;H.render(r,scene,new T.PerspectiveCamera());
 assert.equal(seen[1].materials.parent.visible,false);assert.ok(seen[1].materials.body.visible,'selected child remains traversable');assert.ok(parent.visible);
 H.dispose();
});
test('selection-pass failure restores scene materials, detached roots, and caller target',()=>{
 const {T,H,r}=setup(),scene=new T.Scene(),body=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());scene.add(body);
 const copy=body.clone();copy.userData.hoverOutlineOnly=true;const mat=body.material,render=r.render;let passes=0;
 r.render=(s,c)=>{if(r.target?.isWebGLRenderTarget&&++passes===2)throw Error('selection failure');render(s,c);};
 H.set([copy]);assert.throws(()=>H.render(r,scene,new T.PerspectiveCamera()),/selection failure/);
 assert.equal(body.material,mat);assert.equal(copy.parent,null);assert.equal(r.target,null);assert.equal(r.autoClear,true);H.dispose();
});
