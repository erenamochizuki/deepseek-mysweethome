import test from 'node:test';
import assert from 'node:assert/strict';
import {loadV3} from '../tools/lib/v3-node.mjs';
const h = loadV3(['69-furniture-play']), F = h.V3.furniturePlay;
test('rice must finish cooking before serving; full bowl prevents loss of second batch', () => {
  const empty = {phase:'idle',remaining:0,bowl:false};
  assert.deepEqual(F.reduce('cooker',empty,'serve'),empty);
  let s = F.reduce('cooker',empty,'cook');
  assert.equal(s.remaining,30); assert.equal(empty.phase,'idle');
  s = F.reduce('cooker',s,'tick',29.5); assert.equal(s.phase,'cooking');
  assert.equal(F.reduce('cooker',s,'serve').bowl,false);
  s = F.reduce('cooker',s,'tick',.5); assert.equal(s.phase,'ready');
  s = F.reduce('cooker',s,'serve'); assert.equal(s.bowl,true); assert.equal(s.phase,'idle');
  s = F.reduce('cooker',F.reduce('cooker',s,'cook'),'tick',30);
  assert.equal(F.reduce('cooker',s,'serve').phase,'ready','do not discard cooked food when the bowl is occupied');
  s = F.reduce('cooker',s,'eat'); s = F.reduce('cooker',s,'serve'); assert.equal(s.bowl,true); assert.equal(s.phase,'idle');
});
test('cooking can be cancelled, repeated cook does not restart, negative/invalid time does not advance', () => {
  let s=F.reduce('cooker',{},'cook'); s=F.reduce('cooker',s,'tick',9);
  assert.equal(F.reduce('cooker',s,'cook').remaining,21);
  for(const dt of [-1,NaN,Infinity]) assert.equal(F.reduce('cooker',s,'tick',dt).remaining,21);
  assert.deepEqual(F.reduce('cooker',s,'cancel'),{phase:'idle',remaining:0,bowl:false});
});
test('TVs keep channels independently and wrap to first channel', () => {
  let a=F.reduce('tv',{},'next'), b=F.reduce('tv',{},'toggle');
  assert.deepEqual(b,{on:true,channel:0}); assert.equal(a.channel,1);
  a=F.reduce('tv',F.reduce('tv',a,'next'),'next'); assert.equal(a.channel,0);
  assert.equal(F.reduce('tv',a,'toggle').on,false); assert.equal(b.on,true);
});
test('house state namespace changes with geometry but preserves state when only photos change', () => {
  const m={size:[2,1,1],offset:[0,0,0],palette:['minecraft:air','minecraft:stone'],cells:new Int32Array([0,1])};
  assert.equal(F.houseKey(m),F.houseKey({...m,blockEntities:[{Photo:'other'}]}));
  assert.notEqual(F.houseKey(m),F.houseKey({...m,cells:new Int32Array([1,0])}));
  assert.notEqual(F.houseKey(m),F.houseKey({...m,offset:[1,0,0]}));
});
