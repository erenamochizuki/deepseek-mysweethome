import test from 'node:test';import assert from 'node:assert/strict';import {loadV3} from '../tools/lib/v3-node.mjs';
async function setup(){
 const paint=new Proxy({}, {get:()=>()=>{},set:()=>true});
 const h=loadV3([],{three:'real',document:{createElement:()=>({getContext:()=>paint})}}),V=h.V3,T=h.window.THREE;
 V.scene={part:p=>V.part=p};V.furnMc={cellsFor:()=>[{offset:[0,0,0],part:null}],state:(f,face)=>f.block+'[facing='+face+']',FACING_Y:{north:0}};
 const root=new T.Group(),tv=new T.Group(),cooker=new T.Group();
 for(const [o,kind,cell]of [[tv,'tv',[0,0,0]],[cooker,'kitchen',[3,0,0]]]){Object.assign(o.userData,{furn:kind,cell,facing:'north'});o.position.set(...cell);root.add(o);}
 const screen=new T.Mesh(new T.PlaneGeometry(.7,.4),new T.MeshStandardMaterial());screen.name='screen';tv.add(screen);
 const closed=new T.Group(),open=new T.Group(),lamp=new T.Group();closed.add(new T.Mesh(new T.BoxGeometry(.2,2,1),new T.MeshBasicMaterial()));open.visible=false;root.add(closed,open,lamp);
 const switches=[{kind:'door',key:'door',cell:[6,0,0],objects:[closed,open]},{kind:'lamp',key:'lamp',cell:[8,0,0],objects:[lamp]}];
 const disposed=[],created=[];
 V.houseBlocks={model:{size:[1,1,1],cells:[0],palette:['air']},visibleAt:()=>true,interactions:()=>switches,switchState:()=>({}),
 // 2026-11-14：69 也查望远镜（telescope）了；这个假房子只有电视和厨房台面，摇椅、望远镜都没有
 furnInstances:block=>block==='rocking_chair'||block==='telescope'?[]:[{f:{block},block,cell:block==='tv_stand'?[0,0,0]:[3,0,0],facing:'north'}],
 meshFor:async list=>{const g=new T.Group(),tv=list[0].pos[0]===0;g.position.copy(tv?new T.Vector3():new T.Vector3(3,0,0));
 const box=(pos,size)=>{const geo=new T.BoxGeometry(...size);geo.translate(...pos);const m=new T.Mesh(geo,new T.MeshStandardMaterial());g.add(m);};
 if(tv){box([0,.75,-.04],[.8,.45,.06]);box([0,.45,-.05],[.3,.025,.1]);box([0,.2,0],[1.5,.4,.5]);}
 else{box([50/32,29/32,-1/32],[.3,.18,.26]);box([0,.4,0],[4,.8,.6]);}
 created.push(g);return g;},disposeGroup:g=>{disposed.push(g);g.traverse(o=>o.geometry?.dispose());}};
 h.load(['69-furniture-play']);const ctx={root,_waits:[],wait:p=>ctx._waits.push(p)};root.add(V.part.build(ctx));await Promise.all(ctx._waits);
 return {V,T,root,tv,cooker,closed,open,lamp,ctx,created,disposed,F:V.furniturePlay};
}
const triangleCount=g=>{let n=0;g.traverse(m=>{if(m.isMesh&&m.visible)n+=(m.geometry.index?.count||0)/3;});return n;};
test('TV/cooker outline uses real appliance triangles, not screen-only, invisible proxy or entire cabinet',async()=>{
 const h=await setup(),{F,V}=h;
 const tv=F.hoverObjects({key:'tv:0,0,0'}),cooker=F.hoverObjects({key:'cooker:3,0,0'});
 assert.equal(tv.length,2);assert.equal(tv[1].name,'screen');assert.equal(cooker.length,1);
 assert.equal(triangleCount(tv[0]),24,'panel and foot retained, cabinet excluded');assert.equal(triangleCount(cooker[0]),12,'cooker retained, kitchen excluded');
 for(const o of [tv[0],cooker[0]]){assert.equal(o.parent,null);assert(o.userData.hoverOutlineOnly);assert.equal(o.matrixAutoUpdate,false);assert(o.matrix.equals(o.matrixWorld));}
 assert(!cooker.includes(F.candidates().find(o=>o.material?.opacity===0)));
 h.tv.visible=false;assert.deepEqual(F.hoverObjects({key:'tv:0,0,0'}),[]);h.tv.visible=true;
 V.arrange={on:true};assert.deepEqual(F.hoverObjects({key:'cooker:3,0,0'}),[]);V.arrange.on=false;
 V.part.dispose(h.ctx);assert.equal(h.disposed.length,2);assert(tv[0].visible===false);assert.deepEqual(F.hoverObjects({key:'tv:0,0,0'}),[]);
});
test('door chooses visible open/closed instance; lamps stay individual and rebuild releases old targets',async()=>{
 const h=await setup();assert.deepEqual(h.F.hoverObjects({obj:h.closed.children[0]}),[h.closed]);
 h.closed.visible=false;h.open.visible=true;assert.deepEqual(h.F.hoverObjects({key:'door'}),[h.open]);assert.deepEqual(h.F.hoverObjects({key:'lamp'}),[h.lamp]);
 h.V.part.dispose(h.ctx);assert.equal(h.disposed.length,2);const n=await setup();assert.notEqual(n.F.hoverObjects({key:'cooker:3,0,0'})[0],h.created[1]);n.V.part.dispose(n.ctx);
});

test('unhandled interactive targets return null, photo proxies resolve to cached real frame and release on rebuild',async()=>{
 const h=await setup(),{V,T,F}=h;
 for(const what of ['collect','girl','album','shellBox'])assert.equal(F.hoverObjects({what,obj:h.root}),null);
 V.houseBlocks.version=1;V.photos={frameAt:()=>({kind:'frame',f:{block:'photo_frame'},cell:[3,0,0],facing:'north'}),slotGeom:()=>({corners:[[0,0,0],[1,0,0],[1,1,0],[0,1,0]]})};
 const parent=new T.Group(),proxy=new T.Mesh(new T.PlaneGeometry(),new T.MeshBasicMaterial({visible:false}));proxy.userData.photoTarget={cell:[3,0,0],slot:0};parent.add(proxy);h.root.add(parent);
 const t={what:'photo',obj:proxy};assert.deepEqual(F.hoverObjects(t),[]);await new Promise(r=>setImmediate(r));const first=F.hoverObjects(t);assert.equal(first.length,1);assert(first[0].userData.hoverOutlineOnly);assert(first[0]!==proxy);
 V.houseBlocks.version++;assert.deepEqual(F.hoverObjects(t),[]);assert.equal(first[0].visible,false);assert(h.disposed.includes(first[0]));await new Promise(r=>setImmediate(r));assert.notEqual(F.hoverObjects(t)[0],first[0]);
 V.part.dispose(h.ctx);assert.deepEqual(F.hoverObjects(t),[]);
});

test('photo wall clips merged bars to the selected slot without dropping the bottom or selecting neighbours',async()=>{
 const h=await setup(),{V,T,F}=h;V.houseBlocks.version=1;
 V.photos={frameAt:()=>({kind:'wall',f:{block:'frames'},cell:[0,0,0],facing:'north'}),slotGeom:()=>({normal:[0,0,1],corners:[[.5,.1,0],[1,.1,0],[1,.6,0],[.5,.6,0]]})};
 V.houseBlocks.meshFor=async()=>{const g=new T.Group(),geo=new T.BoxGeometry(3,.08,.1);geo.translate(1.5,.08,0);g.add(new T.Mesh(geo,new T.MeshBasicMaterial()));return g;};
 const proxy=new T.Mesh(new T.PlaneGeometry(),new T.MeshBasicMaterial({visible:false}));proxy.userData.photoTarget={cell:[0,0,0],slot:0};h.root.add(proxy);const t={what:'photo',obj:proxy};F.hoverObjects(t);await new Promise(r=>setImmediate(r));const [o]=F.hoverObjects(t);assert(o);const b=new T.Box3().setFromObject(o,true);assert(Math.abs(b.min.x-(.5-1/16))<1e-6);assert(Math.abs(b.max.x-(1+1/16))<1e-6);assert(triangleCount(o)>0,'cross-slot bottom bar survives clipping');V.part.dispose(h.ctx);
});
