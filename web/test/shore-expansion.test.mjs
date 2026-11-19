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

test('every wearable shell reserves its exact specimen, survives backup, and keeps its first portrait after a swap', () => {
  const kinds = ['moon','top_shell','nassa','periwinkle','wentletrap','carrier_shell','violet_snail','conch','nautilus','sundial','miter'];
  assert.deepEqual(ledger().rules.SHELL_LOANS, kinds);
  for (const kind of kinds) {
    const {rules,state,run,shell} = ledger(), inventory = state.inventory;
    shell('loan',kind,'iris'); shell('spare',kind,'mist'); shell('other','moon','sunset');
    run('shore_loan',{next:'loan',expected:null});
    const memory = {uid:'loan',kind,pat:'iris',size:63,at:0}; assert.deepEqual(inventory.shore.memory,memory);
    assert.equal(rules.available(inventory,kind).some(item => item.uid === 'loan'),false);
    assert.equal(rules.available(inventory,kind).some(item => item.uid === 'spare'),true);
    assert.throws(() => run('sell',{uids:['loan']}),/in_use/);
    assert.throws(() => run('tray_set',{base:0,items:[{uid:'loan',x:0,z:0,ry:0}],by:'player'}),/in_use/);
    const backup = ledger(); backup.run('restore',{rev:0,inventory:rules.exportData(inventory).inventory});
    assert.deepEqual(backup.state.inventory.shore,inventory.shore);
    run('shore_loan',{next:'other',expected:'loan'}); assert.ok(rules.available(inventory,kind).some(item => item.uid === 'loan'));
    run('shore_loan',{next:null,expected:'other'}); assert.deepEqual(inventory.shore.memory,memory);
  }
  const {run,shell,state} = ledger();
  for (const kind of ['giant_clam','opal_ammonite','mermaids_eye']) {
    shell('no-'+kind,kind); assert.throws(() => run('shore_loan',{next:'no-'+kind,expected:null}),/shell_unsuitable/);
  }
  assert.equal(state.inventory.shore.memory,null);
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

test('thirty live fish plates share the shore ledger; discovery, aquarium residents and shell collections stay independent', () => {
  const host = loadV3(['03-vox', '04-atlas', '30-shell-variants', '31-shore-models', '58-inventory-rules'], {three: 'real'});
  const {V3, window} = host; V3.scene = {part() {}}; V3.shore = {register() {}};
  window.__V3_SHORE_MODELS = packShore(); host.load(['59-sealife', '66-shallows', '68-fish-guide']);
  const guide = V3.fishGuide, {rules, state, run, time} = ledger(), shore = state.inventory.shore;
  const blank = guide.entries(shore);
  assert.equal(blank.filter(entry => !entry.reef).length, 20); assert.equal(blank.filter(entry => entry.reef).length, 10);
  assert.equal(new Set(blank.map(entry => entry.id)).size, 30); assert.equal(new Set(blank.map(entry => entry.name)).size, 30);
  assert.ok(blank.every(entry => entry.note && !entry.observed && !entry.residents));
  assert.deepEqual(guide.entries(undefined), blank);
  for (const entry of blank) {
    const model = entry.reef ? V3.reefFish.model(entry.id) : V3.shallows.fishModel(entry.id);
    assert.ok(new window.THREE.Box3().setFromObject(model).getSize(new window.THREE.Vector3()).length() > .1);
    if (!entry.reef) assert.ok(model.getObjectByName('tail')?.children.length, entry.name + ' has an articulated tail');
    for (const form of Object.keys(rules.FISH_FORMS[entry.id] || {})) {
      const other = entry.reef ? V3.reefFish.model(entry.id,form) : V3.shallows.fishModel(entry.id,form);
      const buffers = (root, attr) => { const values=[]; root.traverseVisible(part => { if (part.isMesh) values.push(...part.geometry.getAttribute(attr).array); }); return values; };
      assert.notDeepEqual(buffers(other,'position'), buffers(model,'position'), entry.name+' has different markings');
      assert.notDeepEqual(buffers(other,'color'), buffers(model,'color'), entry.name+' has a different palette');
      if (!entry.reef) assert.ok(other.getObjectByName('tail')?.children.length);
    }
  }
  run('shore_berth', {expected: null, next: 'west'});
  const original = rules.fishAt(0);
  const duplicate = Array.from({length: 512}, (_, index) => index + 1).find(epoch => rules.fishAt(epoch) === original);
  assert.ok(duplicate);
  run('shore_catch', {epoch: 0, berth: null}); time(duplicate * 300000);
  run('shore_catch', {epoch: duplicate, berth: 'west'});
  const known = () => guide.entries(shore).filter(entry => entry.observed);
  assert.deepEqual(known().map(entry => [entry.id, entry.residents]), [[original, 1]]);
  run('shore_fish', {uid: shore.fish[0].uid, action: 'release'});
  assert.deepEqual(known().map(entry => [entry.id, entry.residents]), [[original, 0]]);
  const reefKind = rules.reefAt(duplicate)[0];
  assert.deepEqual(run('shore_watch', {kind:reefKind, epoch:duplicate}), {kind:reefKind});
  assert.equal(run('shore_watch', {kind:reefKind, epoch:duplicate}), false);
  assert.deepEqual(known().map(entry => [entry.id, entry.residents]), [[original, 0], [reefKind, 0]]);
  const invalid = structuredClone(state.inventory); invalid.shore.fish.push({uid:'invalid',kind:reefKind,name:'',fed:0});
  assert.throws(() => rules.parseInventory(invalid));
  const restored = rules.parseInventory(rules.exportData(state.inventory).inventory);
  assert.deepEqual(guide.entries(restored.shore), guide.entries(shore)); assert.deepEqual(Object.keys(restored.found), []);
});

function netScene() {
  const book = ledger(); let epoch = 80, part, dismiss, fail = false;
  const timestamp = () => epoch*300000+100;
  const host = loadV3(['30-shell-variants','31-shore-models','40-layout','52-terrain','58-inventory-rules'], {
    three:'real', globals:{Date:class extends Date { static now() { return timestamp(); } }}
  });
  const {V3, window} = host, three = window.THREE, buttons = new Map(), shore = book.state.inventory.shore;
  const camera = new three.PerspectiveCamera(30,1,.02,400); V3.R = {camera};
  V3.scene = {part(value) { part=value; }}; V3.cabinInventory = {canShore:()=>true,data:{rev:0}};
  V3.shore = {register() {}, toast() {}, redraw() {}, tag:(object,key)=>{ object.userData.clickable=key; return object; }, shore:()=>shore,
    open(_title, draw, close) { this.close(); dismiss=close; draw({text() {},button:(label,act,disabled)=>{ if (!disabled) buttons.set(label,act); }}); },
    close() { dismiss?.(); dismiss=null; buttons.clear(); },
    async save(op,args,_message,applied) { if (fail) return false; book.time(timestamp()); book.run(op,args); applied?.(); return true; }
  };
  window.__V3_SHORE_MODELS=packShore(); host.load(['66-shallows']); part.build(); part.update(.05,.22);
  const state=V3.shallows.state;
  return { V3, state, camera, shore, buttons, step:(delta,time=2)=>part.update(delta,time), fail:value=>{fail=value;}, next:()=>{epoch++;} };
}

test('net release: the same fish leaves its held pose, beats its tail and clears the viewport before it is removed', async () => {
  for (const [aspect,east,up,south] of [[1.7,-.7,1.2,-3],[.46,1.9,2.1,.8],[2.2,18,13,-9]]) {
    const {V3,state,camera,shore,buttons,step,next}=netScene();
    const model=state.fish.children[0], tail=state.tail, kind=state.fish.userData.species;
    camera.aspect=aspect; camera.updateProjectionMatrix(); camera.position.set(state.netX+east,up,state.netZ+south); camera.lookAt(state.ring.position);
    assert.ok(V3.shallows.net()); step(.32); const held=state.fish.position.clone(), pose=state.fish.quaternion.clone(), beat=tail.rotation.y;
    await buttons.get('看一眼，放回海里')(); step(0);
    const departing=model.parent; assert.notEqual(departing,state.fish); assert.equal(departing.parent,state.root);
    assert.ok(departing.position.equals(held) && departing.quaternion.angleTo(pose)<1e-6); assert.equal(tail.rotation.y,beat);
    assert.deepEqual(shore.observed,[kind]); assert.deepEqual(shore.fish,[]); assert.equal(V3.shallows.net(),false);
    assert.ok(!state.inRing && !state.fish.visible && state.ring.visible && state.ripple.visible);
    let passedEdge=false, moved=false, tailBeats=false;
    for (let frame=1;frame<=40;frame++) {
      if (frame===6 && aspect<1) next();
      step(.04,frame*.04); if (!departing.parent) break;
      if (frame===6 && aspect<1) assert.ok(state.fish.visible && state.fish.children[0]!==model);
      const projected=departing.position.clone().project(camera);
      if (Math.max(Math.abs(projected.x),Math.abs(projected.y))>1 && departing.scale.x===1) passedEdge=true;
      if (departing.position.distanceTo(held)>.5) moved=true;
      if (Math.abs(tail.rotation.y-beat)>.45) tailBeats=true;
      assert.ok(V3.terrain.depthAt(departing.position.x,departing.position.z)>0);
    }
    assert.ok(moved && passedEdge && tailBeats, `motion with aspect ${aspect}`); assert.equal(departing.parent,null);
    assert.equal(state.departures.length,0); assert.deepEqual(shore.observed,[kind]);
  }
});

test('net release: a failed save keeps the fish in the net, and cancelling returns it to patrol without recording it', async () => {
  const {V3,state,shore,step,buttons,fail}=netScene();
  assert.ok(V3.shallows.net()); step(.3); const grip=state.grip, model=state.fish.children[0];
  fail(true); await buttons.get('看一眼，放回海里')(); step(.05);
  assert.equal(state.grip,grip); assert.equal(state.fish.children[0],model); assert.equal(state.departures.length,0);
  V3.shore.close(); step(.6); assert.ok(state.fish.visible && !state.grip && !state.rejoin && !state.inRing);
  assert.equal(state.departures.length,0); assert.equal(state.fish.children[0],model); assert.deepEqual(shore.observed,[]);
  step(.05,0); assert.ok(V3.shallows.net());
});

test('five-minute encounters rotate the entire catalogue; refresh, stale requests and absent reef species cannot reroll it', () => {
  const {rules, state, time, run} = ledger(), shallow = new Set(), reef = new Set();
  for (let epoch = 0; epoch < 600; epoch++) {
    const school = rules.reefAt(epoch), kind = rules.fishAt(epoch);
    assert.equal(new Set(school).size, 3); assert.equal(school.length, 3);
    assert.deepEqual(rules.reefAt(rules.encounter(epoch * 300000 + 299999)), school);
    assert.equal(rules.fishAt(rules.encounter(epoch * 300000 + 1)), kind);
    shallow.add(kind); school.forEach(species => reef.add(species));
  }
  assert.deepEqual(shallow, new Set(Object.keys(rules.FISH))); assert.deepEqual(reef, new Set(Object.keys(rules.REEF_FISH)));
  time(300000); const present = rules.reefAt(1)[0], absent = [...reef].find(kind => !rules.reefAt(1).includes(kind));
  assert.throws(() => run('shore_watch',{kind:absent,epoch:1}), /fish_gone/);
  assert.throws(() => run('shore_watch',{kind:rules.reefAt(0)[0],epoch:0}), /fish_gone/);
  assert.throws(() => run('shore_watch',{kind:rules.fishAt(1),epoch:1}));
  assert.throws(() => run('shore_catch',{kind:[...shallow].find(kind => kind !== rules.fishAt(1)),epoch:1,berth:null}), /fish_gone/);
  assert.deepEqual(state.inventory.shore.observed, []);
  run('shore_watch',{kind:present,epoch:1}); run('shore_catch',{kind:rules.fishAt(1),epoch:1,berth:null});
  assert.deepEqual(state.inventory.shore.observed, [present, rules.fishAt(1)]);
});

test('encounter coats persist for individual tank fish and observations, including legacy base coats', () => {
  const {rules,state,time,run}=ledger(), shore=state.inventory.shore;
  const epochs = (kind, from=0) => {
    const found = new Map();
    for (let epoch=from; epoch<from+5000; epoch++) {
      if (rules.fishAt(epoch)!==kind && !rules.reefAt(epoch).includes(kind)) continue;
      const form=rules.fishFormAt(kind,epoch); assert.equal(form,rules.fishFormAt(kind,rules.encounter(epoch*300000+299999)));
      if (!found.has(form)) found.set(form,epoch);
    }
    assert.deepEqual(new Set(found.keys()),new Set(['base',...Object.keys(rules.FISH_FORMS[kind])])); return found;
  };
  for (const kind of Object.keys(rules.FISH_FORMS)) epochs(kind);
  run('shore_berth',{expected:null,next:'west'});
  for (const [form,epoch] of epochs('puffer')) { time(epoch*300000); run('shore_catch',{epoch,kind:'puffer',berth:'west'}); assert.equal(shore.fish.at(-1).form || 'base',form); }
  assert.deepEqual(shore.observed,['puffer']); assert.equal(new Set(rules.knownForms(shore,'puffer')).size,2);
  const legacy=structuredClone(state.inventory); delete legacy.shore.forms; legacy.shore.fish.forEach(fish => delete fish.form);
  assert.deepEqual(rules.knownForms(rules.parseInventory(legacy).shore,'puffer'),['base']);
  const invalid=structuredClone(state.inventory); invalid.shore.fish[0].form='pearl'; assert.throws(()=>rules.parseInventory(invalid),/invalid_input/);
  invalid.shore.fish=[]; invalid.shore.forms.puffer=['base','base']; assert.throws(()=>rules.parseInventory(invalid),/invalid_input/);
  const disguised=structuredClone(state.inventory); disguised.shore.forms.puffer=['base']; assert.throws(()=>rules.parseInventory(disguised),/invalid_input/);
  for (const fish of [...shore.fish]) run('shore_fish',{uid:fish.uid,action:'release'});
  assert.equal(rules.knownForms(shore,'puffer').length,2);
  for (const [form,epoch] of epochs('manta',shore.lastCatch+1)) {
    time(epoch*300000); assert.deepEqual(run('shore_watch',{epoch,kind:'manta'}),{kind:'manta'});
    assert.ok(rules.knownForms(shore,'manta').includes(form)); assert.equal(run('shore_watch',{epoch,kind:'manta'}),false);
  }
  assert.deepEqual(shore.observed,['puffer','manta']); assert.equal(shore.fish.length,0);
  assert.deepEqual(rules.parseInventory(rules.exportData(state.inventory).inventory).shore,shore);
});

test('Blockbench groups, shell finishes and the real house-side den fit the largest shell', () => {
  const {V3,window}=loadV3(['30-shell-variants','31-shore-models','40-layout','52-terrain','58-inventory-rules'],{three:'real'});
  window.__V3_SHORE_MODELS=packShore();const models=V3.shoreModels, crab=models.build('hermit',.038);
  const den=V3.terrain.hermitDen, cave=V3.terrain.crabBurrow, bounds=new window.THREE.Box3().setFromObject(crab);
  assert.ok(cave.x>0 && den.x<0 && den.cells.size>=4);assert.ok(bounds.max.x<.5 && bounds.min.x>-.5 && bounds.max.y+.02<.5);
  const shells=crab.getObjectByName('shell_mount').children, kinds=V3.inventoryRules.SHELL_LOANS, sizes=new Set();
  assert.deepEqual(shells.map(group => group.name).sort(),kinds.map(kind => 'shell_'+kind).sort());
  assert.deepEqual(shells.filter(group => group.children.length).map(group => group.name),['shell_moon']);
  for (const kind of kinds) {
    models.wear(crab,kind,'iris'); crab.updateMatrixWorld(true);
    const shell=crab.getObjectByName('shell_'+kind), mesh=shell.children[0];
    assert.deepEqual(shells.filter(group => group.visible).map(group => group.name),[shell.name]);
    const volume=new window.THREE.Box3().setFromObject(shell); sizes.add(volume.getSize(new window.THREE.Vector3()).toArray().map(value => value.toFixed(3)).join(','));
    assert.ok(volume.min.x>-.46 && volume.max.x<.46 && volume.min.y>.02 && volume.max.y+.025<.5 && volume.min.z>-.10 && volume.max.z<.35,kind+' clears the cave, sand and eye stalks');
    assert.equal(mesh.geometry.userData.pat,'iris'); assert.notEqual(mesh.geometry,mesh.userData.original);
    models.wear(crab,kind,'plain'); assert.equal(mesh.geometry,mesh.userData.original);
  }
  assert.equal(sizes.size,kinds.length,'different silhouettes, not just different colours');
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
  const packed = Object.keys(window.__V3_SHORE_MODELS);
  assert.deepEqual(packed.filter(key => !key.startsWith('fish_')).sort(),['aquarium','fish','hermit']);
  assert.equal(packed.filter(key => key.startsWith('fish_') && !key.includes(':')).length,25);
  assert.equal(packed.filter(key => key.startsWith('fish_') && key.includes(':')).length,7);
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

test('she must reach dry land and turn towards the chosen reef before recording it; cancellation and a departing school are not discoveries', async context => {
  const cabin = await actorCabin(context, { shore:true }), {a:actor, V:game} = cabin, shore = game.shallows.track().shore;
  let visible = true, noted = 0;
  const sighting = {point:[shore[0]+8,-1,shore[1]+3], locate:() => [shore[0]-8,-1,shore[1]+3], valid:() => visible, seen:() => noted++};
  actor.place(shore[0], shore[1]-2, 0); assert.ok(actor.watchReef(sighting));
  assert.ok(actor.watchingReef); assert.equal(actor.water,'approach'); cabin.step(.15); assert.equal(noted,0);
  assert.ok(actor.leaveWater()); assert.equal(actor.watchingReef,false); assert.equal(noted,0);
  assert.ok(actor.watchReef(sighting)); visible = false; cabin.step(.1); assert.equal(actor.water,null); assert.equal(noted,0);
  visible = true; assert.ok(actor.watchReef(sighting)); cabin.until(() => actor.water === 'watch',20);
  cabin.step(.4); assert.equal(noted,0); cabin.until(() => noted === 1,4);
  assert.deepEqual([actor.pos[0],actor.pos[2]],shore); assert.ok(game.nav.walkable(...shore));
  assert.ok(Math.abs(actor.root.rotation.y - Math.atan2(-8,3)) < .13);
  cabin.step(4); assert.equal(actor.water,null); assert.equal(noted,1);
});

test('clicking a reef fish interrupts seated TV leisure and walks her to shore', async context => {
  const cabin = await actorCabin(context, { shore: true }), { a: actor, V: game } = cabin;
  const shore = game.shallows.track().shore;
  let noted = 0;
  const sighting = { point: [shore[0] + 8, -1, shore[1] + 3], locate: () => [shore[0] - 8, -1, shore[1] + 3], valid: () => true, seen: () => noted++ };
  assert.ok(actor.startBehavior('watch_tv'));
  cabin.until(() => actor.behavior?.phase === 'action', 60, 'seated watching TV');
  assert.equal(actor.state, 'furniture');
  assert.ok(actor.watchReef(sighting), 'a direct fish click preempts the seated leisure');
  assert.equal(actor.behavior, null);
  assert.equal(actor.water, 'approach');
  assert.equal(cabin.events.filter(e => e.kind === 'watch_tv').at(-1).reason, 'swim');
  cabin.until(() => actor.water === 'watch', 20, 'arrives at shore to watch the fish');
  cabin.until(() => noted === 1, 4, 'records the sighting');
  assert.deepEqual([actor.pos[0], actor.pos[2]], shore);
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
