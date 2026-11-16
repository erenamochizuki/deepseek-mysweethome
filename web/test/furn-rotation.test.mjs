import test from 'node:test';
import assert from 'node:assert/strict';
import { elBox } from '../tools/lib/furn-mc-export.mjs';
import { loadV3 } from '../tools/lib/v3-node.mjs';
const near = (a,b) => a.forEach((v,i) => assert.ok(Math.abs(v-b[i])<1e-4,`${v} != ${b[i]}`));
test('rotated bounds include the actual corners and rescale', () => {
  const e={from:[-2,-1,-1],to:[2,1,1],rotation:{origin:[0,0,0],axis:'z',angle:45}};
  const k=3/Math.sqrt(2); near(elBox([e]),[-k,-k,-1,k,k,1]);
  near(elBox([{...e,rotation:{...e.rotation,rescale:true}}]),[-3,-3,-1,3,3,1]);
  near(elBox([{from:[0,1,2],to:[2,3,5],rotation:{origin:[0,0,0],axis:'y',angle:90}}]),[2,1,-2,5,3,0]);
});
test('multi-axis pivot bounds agree with independent THREE corner transform', () => {
  const {window:{THREE:T}}=loadV3([], {three:'real'});
  const e={from:[2,1,3],to:[4,9,6],rotation:{origin:[3,4,5],x:21.05,y:17,z:-29.67}};
  const b=new T.Box3(),pivot=new T.Vector3(...e.rotation.origin),r=e.rotation;
  const q=new T.Quaternion().setFromEuler(new T.Euler(r.x*Math.PI/180,r.y*Math.PI/180,r.z*Math.PI/180,'ZYX'));
  for(const x of [2,4])for(const y of [1,9])for(const z of [3,6])b.expandByPoint(new T.Vector3(x,y,z).sub(pivot).applyQuaternion(q).add(pivot));
  near(elBox([e]),[...b.min.toArray(),...b.max.toArray()]);
});
