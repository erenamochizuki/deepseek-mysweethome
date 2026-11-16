import test from 'node:test';
import assert from 'node:assert/strict';
import {loadV3} from '../tools/lib/v3-node.mjs';
function fixture(){
 const h=loadV3(['03-vox','30-shell-kit','30-shell-m1','30-shell-m2','30-shells'],{three:'real'}),V=h.V3,T=h.window.THREE;
 V.layout={zones:[{id:'wash',x0:-30,x1:30}],outside:[]};h.load(['60-game']);
 V.terrain={groundY:()=>0,seabedY:()=>0,shoreZ:()=>12,tideZ:()=>8};
 V.nav={reachable:()=>true,walkable:()=>true};V.scene={part:p=>V.part=p};h.load(['62-beach-items']);
 const root=V.part.build();return {...h,V,T,root};
}
function visibleBounds(T,root){root.updateMatrixWorld(true);const b=new T.Box3();root.traverse(o=>{if(!o.isMesh||!o.userData.shell)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)b.expandByPoint(new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld));});return b;}
function item(kind,id=kind,ry=0){return {id,kind,x:0,z:9,ry,at:1};}
test('all 12 visible shell meshes match the small flower-pot width with a 0.375 m 3D size cap; shared cabinet/icon geometry unchanged',()=>{
 const {V,T}=fixture();assert.equal(V.shells.KINDS.length,12);
 for(const k of V.shells.KINDS){
  const original=V.shells.build(k.id,{tag:false}),base=new T.Box3().setFromObject(original,true).getSize(new T.Vector3());
  V.game.st.beach=[item(k.id)];V.beachItems.sync();const r=V.beachItems.get(k.id),shell=r.getObjectByName('shell-'+k.id),yaw=r.getObjectByName('yaw');
  assert.equal(shell.scale.x,shell.scale.y);assert.equal(shell.scale.x,shell.scale.z);
  let minimum=Infinity,range=null;
  for(let deg=0;deg<360;deg++){yaw.rotation.y=deg*Math.PI/180;const b=visibleBounds(T,r),s=b.getSize(new T.Vector3());minimum=Math.min(minimum,Math.max(s.x,s.z));assert(Math.max(s.x,s.z)<=Math.SQRT2*.375+1e-6&&s.y<=.375+1e-6,`${k.id} yaw ${deg}: actual vertex bounds ${s.toArray()}`);assert(b.min.y>=-1e-6);if(!deg){range=s.toArray();assert(Math.abs(Math.max(...range)-.375)<1e-6,'largest local dimension matches pot rim');}}
  assert.deepEqual(new T.Box3().setFromObject(V.shells.build(k.id,{tag:false}),true).getSize(new T.Vector3()).toArray(),base.toArray());
  assert(base.length()<0.4,'cabinet and icon scale is still original');
  console.log(`${k.id}: settled xyz=${range.map(n=>n.toFixed(4))}, minimum horizontal span over 360 yaw=${minimum.toFixed(4)}`);
 }
 V.part.dispose();
});
test('old saved shells reload enlarged, wash stays above flat ground, settle/pick/glint/detach remain coherent',()=>{
 const {V,T}=fixture();
 for(const k of V.shells.KINDS){
  const it=item(k.id,k.id,.8);V.game.st.beach.push(it);V.emit('game:wash',{items:[it],silent:false});
 }
 for(let frame=0;frame<80;frame++){V.part.update(.1);for(const r of V.beachItems.objects())assert(visibleBounds(T,r).min.y>=-1e-6,'rotated large shell does not penetrate sand');}
 V.beachItems.settle();V.part.update(.85);V.part.update(.1);
 for(const r of V.beachItems.objects()){
  assert(V.beachItems.ready(r.userData.collectId));const b=visibleBounds(T,r),pick=r.getObjectByName('beach:pick'),spark=r.getObjectByName('beach:glint');
  assert(pick.scale.x>.05&&pick.scale.z>.05);assert(pick.visible);assert(spark.position.y>b.max.y-r.position.y);
 }
 for(const who of ['player','girl']){
  const id=V.game.st.beach[0].id,old=visibleBounds(T,V.beachItems.get(id)),ev=V.game.collect(id,who),r=ev.obj;
  assert.equal(ev.by,who);assert.equal(V.game.st.found[ev.item.kind].n,1);assert(!V.game.st.beach.some(it=>it.id===id));assert.equal(V.game.collect(id,who),null);
  assert(r);assert.equal(V.beachItems.get(id),null);assert.equal(r.parent,null);assert(!r.getObjectByName('beach:pick'));assert(!r.getObjectByName('beach:glint'));
  assert.deepEqual(visibleBounds(T,r).min.toArray(),old.min.toArray());assert.deepEqual(visibleBounds(T,r).max.toArray(),old.max.toArray());
 }
 V.game.st.beach=[];V.beachItems.sync();assert.equal(V.beachItems.objects().length,0);V.part.dispose();
});
test('new spawn locations keep enlarged shells separated and clear of obstacles and blocked footprint edges',()=>{
 const {V}=fixture();let seed=3;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 V.layout.outside.push({id:'rocks',x0:-3,x1:3,z0:8,z1:11});
 const pts=[];for(let i=0;i<12;i++){const p=V.beachItems.spot(rng);if(!p)break;assert(p.x<=-3.44||p.x>=3.44);for(const q of pts)assert(Math.hypot(p.x-q.x,p.z-q.z)>=.75-1e-6);pts.push(p);V.game.st.beach.push({...item('clam','spawn'+i),...p});}
 assert(pts.length>=6,'useful shore capacity remains');
 V.nav.randomPoint=()=>[0,9];V.nav.walkable=()=>false;assert.equal(V.beachItems.spot(rng),null);V.part.dispose();
});

test('real washNow respects full/blocked placement and never bypasses failed placement with legacy fallback',()=>{
 const {V}=fixture();V.game.S.maxBeach=12;
 const spawned=V.game.washNow(8);assert(spawned.length>=4);
 for(let i=0;i<spawned.length;i++)for(let j=0;j<i;j++)assert(Math.hypot(spawned[i].x-spawned[j].x,spawned[i].z-spawned[j].z)>=.748,'saved rounding retains clearance');
 V.game.st.beach=[];V.beachItems.sync();V.beachItems.spot=()=>null;assert.equal(V.game.washNow(3).length,0);
 V.beachItems.spot=()=>{throw Error('blocked probe');};V.err=()=>{};assert.equal(V.game.washNow(3).length,0);
 delete V.beachItems.spot;assert(V.game.washNow(1).length===1,'bootstrap without beach module retains fallback');V.part.dispose();
});
