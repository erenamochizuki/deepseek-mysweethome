import test from 'node:test';
import assert from 'node:assert/strict';
import {loadV3} from '../tools/lib/v3-node.mjs';
import {packModel} from '../tools/lib/shore-blockbench.mjs';

const DAY=86400000, stages=[[1,'苔石'],[3,'初枝'],[7,'双礁'],[10,'潮池'],[14,'穿潮拱'],[21,'花冠屿']];
const groups=['coral_1','coral_2','tide_pool','tide_arch','flower_crown'];
const rules=loadV3(['58-inventory-rules']).V3.inventoryRules;
const stageAt=(fish,now)=>rules.growthStage(rules.homeDay(fish,now),fish.kind);

test('only islets gain new stages at the exact elapsed-day boundaries; all six cost four slots',()=>{
  const fish={kind:'islet',uid:'fish:42'}, at=42*300000; // legacy epoch, without caughtAt
  for(const [index,[day]] of stages.entries()) {
    const start=at+(day-1)*DAY;
    assert.equal(stageAt(fish,start-1),Math.max(0,index-1));
    assert.equal(stageAt(fish,start),index,`day ${day}`);
    assert.equal(rules.usedSlots({fish:[fish]}),4);
  }
  assert.equal(stageAt({...fish,kind:'bamboo'},at+40*DAY),2);
  assert.equal(stageAt({...fish,uid:'legacy'},at+40*DAY),2,'unknown arrival keeps the previous double reef');
});

test('each released island retains its departure stage after backup and a much later visit',()=>{
  for(const [index,[day]] of stages.entries()) {
    const state=rules.freshState(), shore=state.inventory.shore;
    shore.tankTier=1; shore.berth='west';
    let epoch=0; while(rules.fishAt(epoch)!=='islet')epoch++;
    const caughtAt=epoch*300000+123, releasedAt=caughtAt+(day-1)*DAY;
    const run=(cmd,now)=>rules.apply(state,rules.parseCommand(cmd),{clock:()=>now});
    run({id:'catch',op:'shore_catch',kind:'islet',epoch,berth:'west'},caughtAt);
    run({id:'release',op:'shore_fish',action:'release',uid:shore.fish[0].uid},releasedAt);
    const restored=rules.parseInventory(structuredClone(state.inventory)).shore;
    assert.equal(rules.usedSlots(restored),0);
    const start=rules.encounter(releasedAt+50*DAY);
    let visit=null;
    for(let e=start;e<start+300 && !visit;e++)visit=rules.friendAt(restored,e);
    assert.ok(visit); assert.equal(rules.homeDay(visit,releasedAt+50*DAY),day);
    assert.equal(stageAt(visit,releasedAt+50*DAY),index);
    assert.equal(visit.islandStage,index);
    assert.equal(rules.departureStage(visit),index);
  }
});

test('pre-update releases preserve the old appearance after import, even after 21 days at home',()=>{
  for(const [day,expected] of [[1,0],[3,1],[10,2],[14,2],[21,2],[32,2]]) {
    const inv=rules.freshState().inventory;inv.shore.observed=['islet'];
    inv.shore.released=[{uid:'old',kind:'islet',name:'旧朋友',caughtAt:0,releasedAt:(day-1)*DAY}];
    const [old]=rules.parseInventory(inv).shore.released;
    assert.equal(rules.departureStage(old),expected);
    inv.shore.released[0].islandStage=6;assert.throws(()=>rules.parseInventory(inv),/invalid_input/);
  }
});

test('gallery model stages independently reveal cumulative groups and default to the full island',()=>{
  const host=loadV3(['31-shore-models','58-inventory-rules'],{three:'real'}), {V3}=host;
  V3.shore={register(){}};
  host.window.__V3_SHORE_MODELS={fish_islet:packModel(new URL('../../models/shore/fish/islet.bbmodel',import.meta.url))};
  host.load(['66-shallows','68-fish-guide']);
  const visible=model=>groups.filter(name=>model.getObjectByName(name).visible);
  const mature=V3.shallows.fishModel('islet','base');
  for(let stage=0;stage<6;stage++)assert.deepEqual(visible(V3.shallows.fishModel('islet','base',stage)),groups.slice(0,stage));
  assert.deepEqual(visible(mature),groups);
  const tip=V3.fishGuide.entries(null).find(f=>f.id==='islet').tip;
  for(const [day,name] of stages)assert.match(tip,new RegExp(`${day}\\s*天[^，、；。]*${name}`));
});
