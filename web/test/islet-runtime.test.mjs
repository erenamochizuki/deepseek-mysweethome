import test from 'node:test';
import assert from 'node:assert/strict';
import {loadV3} from '../tools/lib/v3-node.mjs';
import {packModel} from '../tools/lib/shore-blockbench.mjs';

// A deliberately asymmetric model makes a missing pose or a measurement in world space observable.
function setup(realIslet=false) {
  let now=0, part;
  const host=loadV3(['31-shore-models','58-inventory-rules'],{three:'real',globals:{Date:class extends Date {static now(){return now;}}}});
  const {V3,window:{THREE:T}}=host, shore={berth:'west',tankTier:1,fish:[{uid:'resident',kind:'islet',caughtAt:0}],released:[]};
  const assets=V3.shoreModels;
  if(realIslet)host.window.__V3_SHORE_MODELS={fish_islet:packModel(new URL('../../models/shore/fish/islet.bbmodel',import.meta.url))};
  V3.shoreModels={build:()=>new T.Group(),fish(kind,unit){
    if(realIslet && kind==='islet')return assets.fish(kind,unit);
    const fish=new T.Group(), body=new T.Mesh(new T.BoxGeometry(3,2,6));body.name='body';fish.add(body);fish.scale.setScalar(unit);
    const hidden=new T.Mesh(new T.BoxGeometry(40,40,40));hidden.visible=false;fish.add(hidden);
    return fish;
  },poseIslet:realIslet?assets.poseIslet:(fish,stage)=>{const body=fish.getObjectByName('body');body.scale.setScalar(1+stage/5);body.position.z=stage/5;}};
  V3.cabinInventory={data:{rev:1},canShore:()=>true};
  V3.shore={register(){},redraw(){},tag:o=>o,shore:()=>shore};V3.scene={part:p=>{part=p;}};
  V3.terrain={shoreZ:()=>0,groundY:()=>0,depthAt:()=>1,isWet:()=>false};V3.layout={sea:{y:0}};
  V3.houseBlocks={version:1,grid:{},placedLayout:()=>({porch:{x0:2,x1:5,z1:2}}),furnSolids:()=>[],solids:()=>[],furnInstances:()=>[]};
  V3.nav={walkable:()=>true};
  host.load(['57-fish-passage','66-shallows','68-fish-guide']);part.build();
  return {V3,T,day(n,t=2){now=(n-1)*86400000;part.update(.01,t);}};
}

test('tank growth remeasures the posed fish in tank units without scaling its holder',()=>{
  const {V3,day}=setup(), days=[1,3,7,10,14,21];
  for(const [i,d] of days.entries()) {
    day(d);const holder=V3.shallows.state.school[0], info=holder.userData, unit=info.unit;
    assert.deepEqual(holder.scale.toArray(),[1,1,1]);
    assert.ok(Math.abs(info.nose-unit*(3+4*i/5))<1e-7,`nose on day ${d}`);
    assert.ok(Math.abs(info.halfWidth-unit*1.5*(1+i/5))<1e-7,`width on day ${d}`);
  }
});

test('visible vertices of every actual islet stage stay within the smallest eligible tank during patrol',()=>{
  const {V3,T,day}=setup(true), state=V3.shallows.state;
  const p=new T.Vector3(), matrix=new T.Matrix4();
  for(const d of [1,3,7,10,14,21])for(let t=0;t<12;t+=.4) {
    day(d,t);state.tank.updateWorldMatrix(true,true);
    const inverse=state.tank.matrixWorld.clone().invert(), bounds=new T.Box3();
    state.school[0].traverseVisible(part=>{
      if(!part.isMesh)return;matrix.multiplyMatrices(inverse,part.matrixWorld);
      const pos=part.geometry.attributes.position;
      for(let i=0;i<pos.count;i++)bounds.expandByPoint(p.fromBufferAttribute(pos,i).applyMatrix4(matrix));
    });
    const {x:w,y:h,z:depth}=state.shell.scale;
    assert.ok(!bounds.isEmpty() && bounds.min.x>=-.187*w && bounds.max.x<=.187*w && bounds.min.z>=-.098*depth && bounds.max.z<=.098*depth && bounds.min.y>=.039*h && bounds.max.y<=.202*h,`day ${d}, t=${t}: ${JSON.stringify(bounds)}`);
  }
});

test('the gallery poses the mesh and all portrait stages share the fully-grown model frame',()=>{
  const {V3,T}=setup(), entry=V3.fishGuide.entries(null).find(e=>e.id==='islet');
  // Capture the frame passed to the offscreen renderer without needing a GPU.
  V3.shellIcons={get:(_key,opts)=>opts};
  const adult=V3.shallows.fishModel('islet','base');adult.updateMatrixWorld(true);
  const diameter=new T.Box3().setFromObject(adult.getObjectByName('body')).getBoundingSphere(new T.Sphere()).radius*2;
  const spans=[];
  for(let stage=0;stage<=5;stage++) {
    const portrait=V3.fishGuide.portrait(entry,'base',224,stage);
    assert.equal(portrait.build().getObjectByName('body').scale.x,1+stage/5);
    assert.ok(portrait.view.frameSpan>=diameter && portrait.view.frameSpan<diameter*1.2,'frame should fit the full island');
    spans.push(portrait.view.frameSpan);
  }
  assert.equal(new Set(spans).size,1);
  assert.equal(V3.fishGuide.portrait({...entry,id:'goby'}).view.frameSpan,undefined);
});
