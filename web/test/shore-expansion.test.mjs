import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { packModel, packShore } from '../tools/lib/shore-blockbench.mjs';
import { actorCabin } from '../tools/lib/actor-cabin.mjs';

function ledger() {
  const { V3 } = loadV3(['58-inventory-rules']);
  const rules = V3.inventoryRules, state = rules.freshState(); let seq = 0, at = 0;
  function run(op, args = {}) { return rules.apply(state, rules.parseCommand({ op, id: 'entry-' + ++seq, ...args }), { clock: () => at }); }
  const shell = (id,kind,pat='plain') => run('collect', { id, kind, pat, size: 63, at, category:'collectible' });
  return { rules,state,run,shell,time(value) { at = typeof value === 'string' ? Date.parse(value) : value; } };
}

test('the crab pays only the current local half-day, even across midnight, reload and a clock rollback', () => {
  const {rules,state,run,time}=ledger(), zone='Asia/Shanghai';
  const claim=(instant, expected) => { time(instant); assert.equal(rules.halfDay(Date.parse(instant),zone),expected); return run('shore_gift',{zone,slot:expected}); };
  assert.deepEqual(claim('2026-11-18T03:59:59Z','2026-11-18/am'),{earned:1});
  assert.equal(claim('2026-11-18T03:59:59Z','2026-11-18/am'),false);
  assert.deepEqual(claim('2026-11-18T04:00:00Z','2026-11-18/pm'),{earned:1});
  assert.deepEqual(claim('2026-11-18T16:00:00Z','2026-11-19/am'),{earned:1});
  state.inventory=rules.parseInventory(structuredClone(state.inventory));
  assert.equal(claim('2026-11-18T02:00:00Z','2026-11-18/am'),false);
  assert.throws(()=>run('shore_gift',{zone:'UTC',slot:'2026-11-18/am'}),/shift_changed/);
  assert.deepEqual(claim('2026-11-25T06:00:00Z','2026-11-25/pm'),{earned:1});
  assert.equal(state.inventory.coins,4);
});

test('two local clients serialize all writes; failed persistence never spends the gift', async () => {
  const mem=new Map(), storage={getItem:key=>mem.get(key)??null,setItem(key,value){if(broken)throw Error('full');mem.set(key,value);}};
  let waiting=Promise.resolve(), broken=false;
  const locks={request(key,work){assert.equal(key,'v3.inventory'); const job=waiting.then(work);waiting=job.catch(()=>{});return job;}};
  const make=async()=>{
    const {V3}=loadV3(['58-inventory-rules','59-cabin-inventory'],{ globals:{localStorage:storage,navigator:{locks},document:{querySelector:()=>null,addEventListener(){}}} });
    await V3.cabinInventory.start({});return V3;
  };
  const first=await make(), second=await make(), zone='UTC',slot=first.inventoryRules.halfDay(Date.now(),zone);
  const claim=(page,id)=>page.cabinInventory.perform({op:'shore_gift',slot,zone,id});
  broken=true;assert.equal((await claim(first,'failed')).ok,false);assert.equal(first.cabinInventory.data.inventory.coins,0);
  broken=false;const results=await Promise.all([claim(first,'left'),claim(second,'right')]);
  assert.deepEqual(results.map(result=>result.applied).sort(),[false,true]);
  assert.equal((await make()).cabinInventory.data.inventory.coins,1);
});

test('a loan reserves one exact shell; failed exchanges are atomic and the first portrait never changes', () => {
  const {rules,state,run,shell}=ledger(), inv=state.inventory;
  shell('pink','moon','sunset'); shell('blue','moon','mist'); shell('tower','top_shell','ring');shell('stone','pumice');
  const loan=(next,expected)=>run('shore_loan',{next,expected});
  loan('pink',null);const original=structuredClone(inv.shore.memory);
  assert.deepEqual(rules.available(inv,'moon').map(row=>row.uid),['blue']);
  assert.throws(()=>run('sell',{uids:['pink']}),/in_use/);
  assert.throws(()=>run('tray_set',{base:0,items:[{uid:'pink',x:0,z:0,ry:0}],by:'player'}),/in_use/);
  assert.throws(()=>run('place',{kind:'moon',uid:'pink',slot:'case:1:0',by:'player'}),/in_use/);
  run('place',{kind:'moon',uid:'blue',slot:'case:1:0',by:'player'});
  assert.throws(()=>loan('blue','pink'),/in_use/);assert.throws(()=>loan('stone','pink'),/shell_unsuitable/);
  assert.equal(inv.shore.loan,'pink');assert.equal(rules.parseInventory(inv).shore.loan,'pink');
  loan('tower','pink');assert.throws(()=>loan(null,'pink'),/shore_changed/);loan(null,'tower');
  assert.deepEqual(inv.shore.memory,original);assert.equal(inv.found.moon.n,2);assert.equal(rules.available(inv,'top_shell')[0].uid,'tower');
  const old=structuredClone(inv);delete old.shore;assert.equal(rules.parseInventory(old).shore.loan,null);
  assert.throws(()=>rules.parseInventory({...inv,shore:{...inv.shore,loan:'blue'}}),/invalid_input/);
});

test('fish encounters, a full three-place tank, moves, feeding and release survive restoring a backup', () => {
  const {rules,state,run,time}=ledger(), shelter=state.inventory.shore;
  const catchAt=(epoch,berth)=>{time(epoch*300000);return run('shore_catch',{epoch,berth});};
  assert.throws(()=>catchAt(80,'west'),/shore_changed/);catchAt(80,null);assert.equal(shelter.fish.length,0);
  run('shore_berth',{expected:null,next:'west'});assert.throws(()=>catchAt(80,'west'),/fish_gone/);
  for(const epoch of [81,82,83]) catchAt(epoch,'west');
  assert.throws(()=>catchAt(84,'west'),/tank_full/);assert.equal(shelter.lastCatch,83);catchAt(84,null);
  const uid=shelter.fish[0].uid;run('shore_fish',{action:'name',uid,name:'小银'});run('shore_fish',{action:'feed',uid});
  run('shore_berth',{next:null,expected:'west'});assert.equal(shelter.fish.length,3);
  run('shore_berth',{next:'east',expected:null});time(85*300000);assert.throws(()=>run('shore_catch',{epoch:85,berth:'west'}),/shore_changed/);
  assert.deepEqual(rules.parseInventory(rules.exportData(state.inventory).inventory).shore,shelter);
  assert.equal(shelter.fish[0].name,'小银');assert.ok(shelter.fish[0].fed>0);
  const observed=[...shelter.observed];run('shore_fish',{uid,action:'release'});assert.deepEqual(shelter.observed,observed);
  assert.equal(shelter.fish.length,2); assert.deepEqual(Object.keys(state.inventory.found),[]);
});

test('Blockbench groups, shell finishes and the real house-side den fit the largest shell', () => {
  const {V3,window}=loadV3(['30-shell-variants','31-shore-models','40-layout','52-terrain'],{three:'real'});
  window.__V3_SHORE_MODELS=packShore();const models=V3.shoreModels, crab=models.build('hermit',.038);
  const den=V3.terrain.hermitDen, cave=V3.terrain.crabBurrow, bounds=new window.THREE.Box3().setFromObject(crab);
  assert.ok(cave.x>0 && den.x<0 && den.cells.size>=4);assert.ok(bounds.max.x<.5 && bounds.min.x>-.5 && bounds.max.y+.02<.5);
  for(const kind of ['top_shell','moon']){models.wear(crab,kind,'iris');const shell=crab.getObjectByName('shell_'+kind);assert.ok(shell.visible);assert.notEqual(shell.children[0].geometry,shell.children[0].userData.original);}
  assert.equal(crab.getObjectByName('shell_top_shell').visible,false);assert.ok(models.build('fish',1).getObjectByName('main'));assert.ok(models.build('aquarium',1).getObjectByName('main'));
});

test('two beach clams keep their own finish and cannot be used twice on a tray and an exhibit', () => {
  const {rules, state, run} = ledger();
  const kind = 'giant_clam', shelf = 'case:1:0';
  for (const [id, size, pat] of [['pearl-ribs', 122, 'iris'], ['silver-ribs', 115, 'mist']]) {
    run('collect', {id, kind, size, pat, at: 1, category: 'collectible'});
  }
  run('tray_set', {base: 0, items: [{uid: 'pearl-ribs', x: -14, z: 11, ry: .26, flip: true}], by: 'player'});
  assert.throws(() => run('place', {slot: shelf, kind, uid: 'pearl-ribs', by: 'player'}), /in_use/);
  run('place', {slot: shelf, kind, uid: 'silver-ribs', by: 'player'});
  assert.throws(() => run('sell', {uids: ['silver-ribs']}), /in_use/);
  const backup = rules.exportData(state.inventory), restored = ledger();
  restored.run('restore', {rev: 0, inventory: JSON.parse(JSON.stringify(backup.inventory))});
  const inventory = restored.state.inventory;
  assert.deepEqual(inventory.found[kind], state.inventory.found[kind]);
  assert.deepEqual(inventory.tray, state.inventory.tray);
  const {id: originalPlacement, ...before} = state.inventory.placements[shelf], {id: restoredPlacement, ...after} = inventory.placements[shelf];
  assert.notEqual(restoredPlacement, originalPlacement); assert.deepEqual(after, before);
  assert.equal(rules.available(inventory, kind).length, 0);
  restored.run('return', {slot: shelf, by: 'player'});
  assert.deepEqual(rules.available(inventory, kind).map(item => item.uid), ['silver-ribs']);
});

test('a service without shore support cannot silently accept a backup containing a fish encounter', async () => {
  const {rules, state, run} = ledger(), posted = [];
  const saved = rules.empty(); delete saved.shore;
  const host = loadV3(['58-inventory-rules', '59-cabin-inventory'], {globals: {__CABIN_LOCAL_INVENTORY: true,
    document: {addEventListener() {}, querySelector: () => null}, fetch: async (url, options) => {
      if (options.body) posted.push(JSON.parse(options.body));
      return {ok: true, status: 200, json: async () => ({ok: true, initialized: true, rev: 1, inventory: saved})};
    }}});
  const client = host.V3.cabinInventory; await client.start({});
  assert.equal(client.canShore(), false);
  assert.equal((await client.perform({op: 'shore_catch', id: 'net', epoch: 0, berth: null})).code, 'old_server');
  run('shore_catch', {epoch: 0, berth: null});
  assert.equal((await client.restore(rules.exportData(state.inventory))).code, 'old_server');
  assert.equal(posted.length, 0);
  assert.ok((await client.restore(rules.exportData(rules.empty()))).ok);
  assert.equal(posted.length, 1); assert.equal('shore' in posted[0].inventory, false);
});

test('archived Blockbench models stay editable but are not packed into the live game', () => {
  const {V3,window}=loadV3(['31-shore-models'],{three:'real'}), {Box3,Vector3}=window.THREE;
  window.__V3_SHORE_MODELS=packShore();
  assert.deepEqual(Object.keys(window.__V3_SHORE_MODELS).sort(),['aquarium','fish','hermit']);
  for(const [key,file] of [['specimenBench','specimen_bench'],['kelpGarden','kelp_garden']]) {
    window.__V3_SHORE_MODELS[key]=packModel(new URL(`../../models/archive/shore-furniture/${file}.bbmodel`,import.meta.url));
  }
  const tray=V3.shoreModels.build('specimenBench',.01),tank=V3.shoreModels.build('kelpGarden',.01);
  function boxesOf(root) {
    const boxes=[];root.updateWorldMatrix(true,true);
    root.traverse(mesh=>{if(!mesh.isMesh)return;const vertices=mesh.geometry.attributes.position;
      for(let start=0;start<vertices.count;start+=36){const box=new Box3();for(let index=start;index<start+36;index++)box.expandByPoint(new Vector3().fromBufferAttribute(vertices,index).applyMatrix4(mesh.matrixWorld));boxes.push(box);}
    });return boxes;
  }
  const box=(lower,upper)=>new Box3(new Vector3(...lower),new Vector3(...upper));
  const innerSand=box([-.4499,.3449,-.2999],[.4499,.6,.2999]);
  for(const part of boxesOf(tray))assert.equal(part.intersectsBox(innerSand),false,'usable 90 × 60 cm surface');
  const envelope=new Box3().setFromObject(tray);assert.ok(envelope.max.x<=.491&&envelope.max.z<=.343&&envelope.min.y>=0);
  const tankSize=new Box3().setFromObject(tank).getSize(new Vector3());assert.ok(tankSize.x<.42&&tankSize.z<.24&&tankSize.y<.29);
  const lane=box([-.134,.066,-.055],[.134,.175,.055]);
  for(const part of boxesOf(tank))assert.equal(part.intersectsBox(lane),false,'fish remain visible in the central lane');
});

test('snow builds and melts at different rates, excludes wet sand, sea and cutaway interiors', () => {
  const {V3}=loadV3(['40-layout','52-terrain','54-snow-cover'],{three:'real'}),cover=V3.snowCover, terrain=V3.terrain;
  assert.ok(cover.advance(.5,.2,{snow:1})>.5);assert.ok(cover.advance(.5,.2,{rain:1})<cover.advance(.5,.2,{}));
  assert.equal(cover.advance(0,60,{snow:1}),cover.advance(0,.5,{snow:1}));assert.equal(cover.advance(1,1,{snow:1}),1);
  const dry=cover.surface(7,3);assert.equal(dry.type,'ground');assert.equal(cover.surface(4,terrain.shoreZ(4)-.1),null);assert.equal(cover.surface(3,25),null);
  const home=V3.layout.house, midpoint=(home.x1+home.x0)/2, inside=(home.z1+home.z0)/2;assert.equal(cover.surface(midpoint,inside),null);
  V3.houseBlocks={solids:()=>[[0,home.ridgeY]],furnSolids:()=>[]};assert.equal(cover.surface(midpoint,inside).height,home.ridgeY);
});

function waterFlags(inst) {
  const queries = ['q.is_on_ground', 'q.is_in_water', 'q.is_swimming', 'ctrl.swim', 'q.is_in_water_or_rain'];
  inst.runStmt(queries.map((query, index) => `v.shore_probe_${index} = ${query};`).join(' '));
  return queries.map((_, index) => inst.getVar('shore_probe_' + index));
}

test('native swim plays strokes in the real cove; YSM sees wading, floating and dry land, not a land run', async context => {
  const cabin = await actorCabin(context, { shore: true }), { a: actor, V: game } = cabin;
  const route = game.shallows.track(), [shoreX, shoreZ] = route.shore, inst = actor.inst;
  const depth = () => game.terrain.depthAt(actor.pos[0], actor.pos[2]);
  actor.place(shoreX, shoreZ - 1.5, 0);
  assert.equal(inst.findAnimation('swim'), 'main:swim');
  assert.ok(actor.startWater());
  cabin.until(() => depth() > 0 && depth() < .52, 20, 'walking on the seabed');
  assert.deepEqual(waterFlags(inst), [1, 1, 0, 0, 1]);
  cabin.until(() => actor.water === 'swim', 20, 'reached the swimming lane');
  cabin.step(.4);
  assert.equal(inst.actorAnimation.base, 'main:swim');
  assert.deepEqual(waterFlags(inst), [0, 1, 1, 1, 1]);
  const arm = inst.bones.armR.quaternion.clone(); cabin.step(.25);
  assert.ok(arm.angleTo(inst.bones.armR.quaternion) > .03, 'the native stroke actually moves her arm');
  for (let step = 0; step < 40; step++) {
    cabin.step(.25);
    assert.ok(Math.abs(actor.pos[0] - shoreX) <= .801 && Math.abs(actor.pos[2] - (shoreZ + route.length)) <= .601 && depth() >= .52);
  }
  assert.ok(actor.floatWater());
  const horizontal = () => [actor.pos[0], actor.pos[2]], held = horizontal();
  cabin.step(.65); assert.deepEqual(horizontal(), held);
  assert.equal(inst.actorAnimation.base, inst.findAnimation('float') || 'main:swim');
  assert.deepEqual(waterFlags(inst), [0, 1, 1, 1, 1]);
  assert.ok(actor.floatWater()); cabin.step(.6); assert.notDeepEqual(horizontal(), held);
  assert.ok(actor.leaveWater()); cabin.until(() => !actor.water, 20, 'back on land');
  assert.deepEqual(horizontal(), route.shore); assert.ok(game.nav.walkable(...horizontal()));
  assert.equal(inst.actorAnimation.base, null); assert.deepEqual(waterFlags(inst), [1, 0, 0, 0, 0]);
});

test('rain umbrellas stay ashore; a storm or a model change clears the swim pose; a non-swimmer watches', async context => {
  const cabin = await actorCabin(context, { shore: true }), { a: actor, V: game } = cabin;
  const shore = game.shallows.track().shore, umbrella = () => actor.root.getObjectByName('girl-actor:umbrella')?.visible;
  let weather = { kind: 'rain', rain: 1, storm: 0 }; game.wx = { now: () => weather };
  actor.place(shore[0], shore[1] - 1, 0); cabin.step(.65); assert.equal(umbrella(), true);
  assert.ok(actor.startWater()); cabin.until(() => actor.water === 'swim', 25);
  assert.equal(umbrella(), false);
  weather = { kind: 'storm', rain: 1, storm: 1 }; cabin.step(.05);
  assert.equal(actor.water, null); assert.equal(actor.startWater(), false); assert.ok(game.nav.walkable(actor.pos[0], actor.pos[2]));
  assert.deepEqual(waterFlags(actor.inst).slice(0, 4), [1, 0, 0, 0]);
  weather = { kind: 'rain', rain: 1, storm: 0 }; cabin.step(.15);
  actor.place(...shore, 0); cabin.step(.1); assert.ok(actor.startWater()); cabin.until(() => actor.water === 'swim', 25);
  const model = { ...actor.inst.model, anims: { main: { idle: { loop: true }, walk: { loop: true } } }, controllers: {}, functions: [] };
  actor.useBody('test:shore-watcher', () => game.ysm.build(model, { height: 1.25 }));
  assert.equal(actor.bodyId, 'test:shore-watcher');
  assert.equal(actor.water, null); assert.deepEqual([actor.pos[0], actor.pos[2]], shore);
  assert.equal(actor.inst.findAnimation('swim'), null); assert.ok(actor.startWater());
  cabin.until(() => actor.water === 'watch', 10); cabin.step(2);
  assert.deepEqual([actor.pos[0], actor.pos[2]], shore); assert.equal(umbrella(), true);
  assert.deepEqual(waterFlags(actor.inst), [1, 0, 0, 0, 1]);
  assert.equal(actor.floatWater(), false); assert.ok(actor.leaveWater());
});
