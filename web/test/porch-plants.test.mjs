import test from 'node:test';
import assert from 'node:assert/strict';
import {houseMc,openGrid} from '../tools/lib/house-mc-grid.mjs';

test('each paired pot rests on the sand plane or a full-width support', () => {
  const grid=openGrid(houseMc().build());
  let count=0;
  grid.each((x,y,z,state)=>{
    if(state.id!=='succulents')return;
    count++;
    if(y!==0)assert.equal(grid.kind(x,y-1,z),'full',`two off-center bases at ${x},${y},${z}`);
  });
  assert.equal(count,3);
});
