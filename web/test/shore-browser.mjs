import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';

const server = await serveFiles({ '/cabin.html': path.join(WEB_DIR, 'dist', 'cabin.html') });
const photoDir = process.env.SHORE_VIEW_PHOTOS, captured = new Set();

async function releaseFromNet(page, press) {
  const directory = process.env.SHORE_RELEASE_FRAMES;
  const held = await page.evaluate(() => {
    window.shoreTestAdvance = 300000;
    V3.shore.close(); V3.R.freeze(0);
    const part = V3.scene.parts.find(item => item.id === 'shallows'), state = V3.shallows.state;
    part.update(.05,0);
    const {netX,netZ}=state, water=V3.water.waveY(netX,netZ);
    V3.R.setView({pos:[netX+.42,water+1.06,netZ-2.12],target:[netX,water-.07,netZ]});
    V3.shore.act('swimPost');
    return {kind:state.fish.userData.species, model:state.fish.children[0].uuid, residents:V3.shore.shore().fish.length};
  });
  await press('抄网');
  const before = await page.evaluate(record => {
    const part=V3.scene.parts.find(item=>item.id==='shallows'), frames=[];
    for (let index=0;index<7;index++) { part.update(.05,0); if (record) frames.push(V3.R.snapshot(540)); }
    return {frames, position:V3.shallows.state.fish.position.toArray()};
  }, !!directory);
  await press('看一眼，放回海里'); await page.waitForFunction(() => !V3.shore.panel && V3.shallows.state.departures.length === 1);
  const after = await page.evaluate(record => {
    const state=V3.shallows.state, part=V3.scene.parts.find(item=>item.id==='shallows'), {fish}=state.departures[0];
    const position=fish.position.toArray(), model=fish.children[0].uuid, frames=[];
    let visibleInWater=false, offScreen=false;
    for (let index=0;index<34;index++) {
      part.update(.05,index*.05);
      if (record) frames.push(V3.R.snapshot(540));
      const screen=fish.position.clone().project(V3.R.camera);
      if (fish.parent && Math.max(Math.abs(screen.x),Math.abs(screen.y))<.95 && Math.hypot(fish.position.x-state.netX,fish.position.z-state.netZ)>.2) visibleInWater=true;
      if (fish.parent && Math.max(Math.abs(screen.x),Math.abs(screen.y))>1) offScreen=true;
    }
    const gone=!fish.parent && !state.fish.visible && !state.ring.visible && !state.departures.length;
    V3.R.freeze(null);
    return {position,model,frames,visibleInWater,offScreen,gone,canCatch:V3.shallows.net(),observed:V3.shore.shore().observed,residents:V3.shore.shore().fish.length};
  }, !!directory);
  assert.deepEqual(after.position,before.position); assert.equal(after.model,held.model);
  assert.ok(after.visibleInWater && after.offScreen && after.gone && !after.canCatch);
  assert.equal(after.residents,held.residents); assert.ok(after.observed.includes(held.kind));
  if (directory) {
    await mkdir(directory,{recursive:true});
    await Promise.all(before.frames.concat(after.frames).map((frame,index) => writeFile(path.join(directory,String(index).padStart(3,'0')+'.png'),Buffer.from(frame.split(',')[1],'base64'))));
  }
}

async function checkCloseup(page, kind) {
  await page.waitForFunction(() => Math.abs(V3.R.ctl.dist - V3.R.ctl.g.dist) < .015, {timeout:20000});
  const result = await page.evaluate(kind => {
    const { camera, canvas, ctl } = V3.R; V3.R.scene.updateMatrixWorld(true);
    const root = V3.models.current().root;
    let point;
    if (kind === 'hermit') {
      const shell = root.getObjectByName('shore-neighbors').getObjectByName('shell_mount').children.find(group => group.visible);
      point = new THREE.Box3().setFromObject(shell).getCenter(new THREE.Vector3());
    } else if (kind === 'crab') point = root.getObjectByName('sealife:crab').localToWorld(new THREE.Vector3(0,.13,0));
    else point = V3.shallows.state.root.children.find(child => child.userData.clickable === kind).localToWorld(new THREE.Vector3(.23,.8,.082));
    const rect = canvas.getBoundingClientRect();
    function screen(world) {
      const projected = world.clone().project(camera), clientX = rect.left + (1 + projected.x) * rect.width / 2, clientY = rect.top + (1 - projected.y) * rect.height / 2;
      return { clientX, clientY, visible: Math.abs(projected.x) < .96 && Math.abs(projected.y) < .96 && Math.abs(projected.z) < 1 && document.elementFromPoint(clientX,clientY) === canvas };
    }
    const spot = screen(point);
    return { kind: V3.cabinTargets.pick(spot)?.what, visible: spot.visible, near: ctl.dist < 6, wide: rect.width > 600,
      net: kind === 'swimPost' ? screen(V3.shallows.state.ring.getWorldPosition(new THREE.Vector3())).visible : true };
  }, kind);
  assert.ok(result.near && result.visible && result.kind === kind && result.net, `${kind} close-up and net should be unobstructed: ${JSON.stringify(result)}`);
  const key = kind + (result.wide ? '-desktop' : '-portrait');
  if (photoDir && !captured.has(key)) {
    captured.add(key); await mkdir(photoDir, {recursive:true}); await page.mouse.move(3,3);
    await page.screenshot({ path: path.join(photoDir, key + '.png') });
  }
}

async function clickRockCrab(page) {
  const hit = await page.evaluate(() => {
    const crab = V3.sealife.crab; crab.pose(crab.state().t + Math.max(0,crab.state().left) + .1);
    const plan = crab.plan, snap = plan.seg.find(segment => segment.k === 'snap' && Math.hypot(segment.p0[0]-plan.HX,segment.p0[1]-plan.MZ) > .6);
    const time = crab.state().offset + plan.T + (snap?.t0 || 0) + .6;
    V3.R.freeze(time); crab.pose(time); const pose = crab.now();
    V3.R.scene.updateMatrixWorld(true); const rect = V3.R.canvas.getBoundingClientRect(), spot = { clientX:rect.left+rect.width/2, clientY:rect.top+rect.height/2 };
    for (const offset of [[.6,1.3,-5],[-1.2,2,-4],[0,4,-3]]) {
      V3.R.setView({pos:[pose.x+offset[0],pose.y+offset[1],pose.z+offset[2]],target:[pose.x,pose.y+.13,pose.z]});
      if (V3.cabinTargets.pick(spot)?.what === 'crab') return [spot.clientX,spot.clientY];
    }
    throw Error('Cannot pick the crab on open sand: ' + JSON.stringify({pose, picked:V3.cabinTargets.pick(spot)?.what}));
  });
  await page.mouse.click(...hit); assert.ok(await page.evaluate(() => V3.sealife.crab.state().startled));
  await checkCloseup(page, 'crab'); await page.evaluate(() => V3.R.freeze(null));
}

async function clickHermit(page) {
  const hit = await page.evaluate(() => {
    const root = V3.models.current().root.getObjectByName('shore-neighbors'), targets = [];
    root.traverse(object => { if (object.userData.clickable === 'hermit') targets.push(object); });
    if (targets.length !== 1 || !targets[0].getObjectByName('claw_right')) throw Error('Only the crab should open the fitting menu');
    const crab = targets[0], shell = crab.getObjectByName('shell_mount').children.find(group => group.visible);
    root.updateWorldMatrix(true,true); const box = new THREE.Box3().setFromObject(shell), point = box.getCenter(new THREE.Vector3());
    const rect = V3.R.canvas.getBoundingClientRect(), clientX = rect.left+rect.width/2, clientY = rect.top+rect.height/2;
    for (const offset of [1,-1.2,0]) {
      V3.R.setView({pos:[point.x+offset,point.y+1.1,point.z+4.8],target:point.toArray()}); V3.R.camera.updateMatrixWorld();
      if (V3.cabinTargets.pick({clientX,clientY})?.obj === crab) return [clientX,clientY];
    }
    throw Error('Cannot pick the crab itself at the den mouth');
  });
  await page.mouse.click(...hit); await page.waitForSelector('.shore-panel[aria-label="石堆里的邻居"]');
  await checkCloseup(page, 'hermit');
}

async function observeReef(page, until) {
  const hit = await page.evaluate(() => {
    V3.shore.close(); V3.collection.close();
    const shore = V3.shallows.track().shore;
    V3.actor.rest(true); V3.actor.place(shore[0], shore[1]-2, 0);
    const scene = V3.R.scene, schools = [];
    scene.updateMatrixWorld(true); scene.traverse(obj => { if (obj.userData.clickable === 'reefWatch' && !V3.shore.shore().observed.includes(obj.userData.species)) schools.push(obj); });
    const part = V3.scene.parts.find(item => item.id === 'sealife'), resume = part.update;
    part.update = () => {}; window.resumeReef = () => { part.update = resume; };
    const rect = V3.R.canvas.getBoundingClientRect(), clientX = rect.left+rect.width/2, clientY = rect.top+rect.height/2;
    for (const mesh of schools) for (let index = 0; index < mesh.count; index++) {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix); mesh.geometry.computeBoundingBox();
      const point = mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld);
      for (const side of [-1,1]) {
        V3.R.setView({pos:[point.x+side*1.6, Math.max(.65,point.y+2.3), point.z+.45],target:point.toArray()}); V3.R.camera.updateMatrixWorld();
        const picked = V3.cabinTargets.pick({clientX, clientY});
        if (picked?.obj === mesh && picked.instanceId === index) return {x:clientX,y:clientY,kind:mesh.userData.species};
      }
    }
    return null;
  });
  assert.ok(hit, 'a visible, not-yet-observed fish can be picked from above the reef');
  await page.mouse.click(hit.x, hit.y);
  assert.deepEqual(await page.evaluate(kind => {
    window.resumeReef(); return [V3.actor.watchingReef, V3.shore.shore().observed.includes(kind)];
  }, hit.kind), [true,false], 'clicking an actual fish starts the invitation but does not fill in its plate');
  const ashore = await page.evaluate(() => {
    const actor = V3.actor, part = V3.scene.parts.find(item => item.id === 'girl-actor');
    for (let frame = 0; frame < 800 && actor.water !== 'watch'; frame++) part.update(.05);
    const dry = V3.nav.walkable(actor.pos[0], actor.pos[2]);
    for (let frame = 0; frame < 50; frame++) part.update(.05);
    return [dry,actor.water,V3.shore.shore().fish.length];
  });
  assert.deepEqual(ashore, [true,'watch',0]); await until(kind => V3.shore.shore().observed.includes(kind),hit.kind);
  await page.evaluate(() => V3.actor.leaveWater()); return hit.kind;
}

async function clickBuoy(page) {
  await page.waitForFunction(() => V3.R.canvas.clientWidth === innerWidth && Math.abs(V3.R.camera.aspect-innerWidth/innerHeight) < .001);
  const buoyClick = await page.evaluate(() => {
    V3.shore.close();
    const buoy = V3.shallows.state.root.children.find(child => child.userData.clickable === 'swimPost');
    const target = buoy.localToWorld(new THREE.Vector3(.23, .8, .082));
    V3.R.scene.updateMatrixWorld(true); const rect = V3.R.canvas.getBoundingClientRect();
    const spot = {clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2};
    for (const offset of [[.65,1.1,7.2],[-2,2.6,-6],[3,1,-5]]) {
      V3.R.setView({pos:[target.x+offset[0],target.y+offset[1],target.z+offset[2]],target:target.toArray()});
      if (V3.cabinTargets.pick(spot)?.obj === buoy && document.elementFromPoint(spot.clientX,spot.clientY) === V3.R.canvas) return [spot.clientX,spot.clientY];
    }
    throw Error('Cannot pick the lifebuoy from the beach: ' + JSON.stringify({target, picked:V3.cabinTargets.pick(spot)?.what, element:document.elementFromPoint(spot.clientX,spot.clientY)?.className}));
  });
  await page.mouse.click(...buoyClick); await page.waitForSelector('.shore-panel[aria-label="浅海下水点"]', {timeout:6000});
  await checkCloseup(page, 'swimPost');
}

async function swimRoundTrip(page, press) {
  await page.evaluate(() => {
    const [shoreX, shoreZ] = V3.shallows.track().shore;
    V3.actor.rest(true); V3.actor.place(shoreX, shoreZ - 2, 0);
  });
  await clickBuoy(page); await press('邀请她去浅海');
  const result = await page.evaluate(() => {
    const actor = V3.actor, inst = actor.inst, part = V3.scene.parts.find(item => item.id === 'girl-actor');
    const clip = () => inst.states.clip?.value || inst.actorAnimation?.base || null, approach = new Set();
    for (let frame = 0; frame < 800 && actor.water !== 'swim'; frame++) { part.update(.05); approach.add(clip()); }
    for (let frame = 0; frame < 12; frame++) part.update(.05);
    const arm = inst.bones.armR.quaternion.clone();
    for (let frame = 0; frame < 5; frame++) part.update(.05);
    return { body: actor.bodyId, phase: actor.water, clip: clip(), approach: [...approach], stroke: arm.angleTo(inst.bones.armR.quaternion) };
  });
  const classic = result.body === 'v1';
  assert.equal(result.phase, 'swim'); assert.equal(result.clip, classic ? 'swim' : 'main:swim');
  assert.ok(result.stroke > .03, 'her arm moves during the stroke');
  if (classic) assert.ok(result.approach.includes('wade'), 'the v1 wading clip plays on the way in');
  await press('漂一会儿');
  const afloat = await page.evaluate(() => {
    const actor = V3.actor, old = actor.pos, part = V3.scene.parts.find(item => item.id === 'girl-actor');
    for (let frame = 0; frame < 16; frame++) part.update(.05);
    return [actor.floating, actor.inst.states.clip?.value || actor.inst.actorAnimation?.base, Math.hypot(actor.pos[0] - old[0], actor.pos[2] - old[2])];
  });
  assert.deepEqual(afloat, [true, classic ? 'float' : 'main:swim', 0]);
  await press('继续游'); await press('上岸');
  const ashore = await page.evaluate(() => {
    const actor = V3.actor, part = V3.scene.parts.find(item => item.id === 'girl-actor');
    for (let frame = 0; frame < 800 && actor.water; frame++) part.update(.05);
    const shore = V3.shallows.track().shore;
    return { phase: actor.water, distance: Math.hypot(actor.pos[0] - shore[0], actor.pos[2] - shore[1]), dry: V3.nav.walkable(actor.pos[0], actor.pos[2]) };
  });
  assert.deepEqual(ashore, {phase:null, distance:0, dry:true});
  return result.body;
}

let browser;
try {
  browser = await launchBrowser({ width: 1080, height: 760, gpu: 'swiftshader' });
  const page = await browser.newPage(), errors = [];
  await page.evaluateOnNewDocument(() => { const start = Date.UTC(2026,10,18,4,1); Date.now = () => start + Math.floor(Math.min(120000,performance.now())) + (window.shoreTestAdvance || 0); });
  page.on('pageerror', error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => window.__READY && V3.cabinInventory.canShore() && V3.shallows.state.spots.length, { timeout: 100000 });
  const press = text => page.locator(`::-p-xpath(//button[normalize-space(.)='${text}'])`).click();
  const menu = target => page.evaluate(key => V3.cabinTargets.act({ what: key, obj: {} }), target);
  const until = (fn, ...args) => page.waitForFunction(fn, { timeout: 18000 }, ...args);
  await page.goto(server.url + '/cabin.html?auto=0&wx=clear&time=morning', { waitUntil: 'load' }); await ready();
  assert.equal(await page.evaluate(() => V3.game.kinds().length), 50);
  const delivery = await page.evaluate(() => {
    const courier = V3.sealife.crab, neighbors = V3.scene.parts.find(part => part.id === 'shore-neighbors');
    const start = courier.state().t, coin = V3.shore.state.coin, previous = new THREE.Vector3();
    let phase = V3.shore.state.delivery, carried = 0, placing = 0, gripError = 0, jump = 0;
    for (let step = 1; step <= 1200 && phase !== 'dropped'; step++) {
      const lastPhase = phase; previous.copy(coin.position);
      const time = start + step * .05; courier.pose(time); neighbors.update(.05,time);
      phase = V3.shore.state.delivery;
      if (phase === 'carrying' && coin.visible) { carried++; gripError = Math.max(gripError, coin.position.distanceTo(courier.rightClawGrip)); }
      if (phase === 'placing' || lastPhase === 'placing') { placing++; jump = Math.max(jump, coin.position.distanceTo(previous)); }
    }
    return { phase, carried, placing, gripError, jump };
  });
  assert.equal(delivery.phase, 'dropped'); assert.ok(delivery.carried > 5 && delivery.placing > 5);
  assert.ok(delivery.gripError < .001 && delivery.jump < .09, 'the coin stays in her claw and is set down without jumping: ' + JSON.stringify(delivery));
  const coinHit = await page.evaluate(() => {
    const coin = V3.shore.state.coin, point = coin.getWorldPosition(new THREE.Vector3());
    V3.R.setView({pos:[point.x+.6,point.y+.85,point.z-1.7],target:point.toArray()});
    V3.R.camera.updateMatrixWorld(); const ndc=point.clone().project(V3.R.camera), rect=V3.R.canvas.getBoundingClientRect();
    return [rect.left+(ndc.x+1)*rect.width/2,rect.top+(1-ndc.y)*rect.height/2];
  });
  await page.mouse.click(...coinHit); await until(() => V3.cabinInventory.data.inventory.coins === 1);
  await clickRockCrab(page);
  await clickBuoy(page); await page.evaluate(() => V3.shore.close());
  await page.evaluate(() => { V3.collection.open(); window.firstFolio = document.querySelector('.col-folio'); }); await press('鱼类图鉴');
  assert.equal(await page.$eval('.col-num', label => label.textContent), '已观察 0 / 30');
  assert.equal((await page.$$('.fish-specimen[data-state="unseen"]')).length, 20);
  await press('远礁观赏 · 0/10');
  assert.deepEqual(await page.$$eval('.fish-specimen h3', cards => cards.map(card => card.textContent)), await page.evaluate(() => Object.values(V3.inventoryRules.REEF_FISH)));
  await until(() => document.querySelector('.fish-plate img')?.naturalWidth === 224);
  await page.focus('#col-tab-fish'); await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await page.evaluate(() => [document.activeElement.id, document.querySelector('#col-page-fish').hidden, document.querySelector('.col-folio') === window.firstFolio]), ['col-tab-shells',true,true]);
  assert.match(await page.$eval('.col-num', label => label.textContent), /0 \/ 50/);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const client = V3.cabinInventory;
    for (const [id,kind,pat] of [['test-moon','moon','iris'],['test-top','top_shell','mist'],['test-wing','conch','sunset'],['test-chips','carrier_shell','ring'],['test-disc','nautilus','mist'],['test-dial','sundial','ring'],['test-spire','miter','sunset']]) await client.perform({op:'collect',id,kind,pat,size:65,at:Date.now(),category:'collectible'});
  });
  await clickHermit(page);
  const chooseShell = uid => page.select('.shore-panel select',uid);
  const wearing = (kind, pat) => until((kind, pat) => {
    const mount = V3.models.current().root.getObjectByName('shore-neighbors').getObjectByName('shell_mount'), visible = mount.children.filter(group => group.visible);
    return visible.length === 1 && visible[0].name === 'shell_'+kind && (visible[0].children[0]?.geometry.userData.pat || 'plain') === pat;
  },kind,pat);
  await page.locator('.shore-panel summary').click(); assert.match(await page.$eval('.shore-panel details',details=>details.innerText), /11 种[\s\S]*负壳螺[\s\S]*女王凤凰螺[\s\S]*鹦鹉螺[\s\S]*日晷螺[\s\S]*笔螺/);
  for (const [uid, kind, pattern] of [['test-disc','nautilus','mist'],['test-dial','sundial','ring'],['test-spire','miter','sunset']]) {
    await chooseShell(uid); await press('试这枚'); await wearing(kind, pattern);
  }
  await chooseShell('test-chips'); await press('试这枚'); await wearing('carrier_shell','ring');
  await chooseShell('test-wing'); await wearing('moon','plain');
  await press('试这枚'); await wearing('conch','sunset'); assert.equal(await page.evaluate(() => V3.shore.shore().loan), null);
  await page.locator('.shore-panel button[aria-label="关闭"]').click(); await wearing('moon','plain');
  await clickHermit(page); await chooseShell('test-wing'); await press('试这枚'); await press('借给它');
  await until(() => V3.shore.shore().loan === 'test-wing');
  await chooseShell('test-chips'); await press('试这枚'); await press('借给它'); await until(() => V3.shore.shore().loan === 'test-chips');
  const watching = await page.evaluate(() => {
    const part = V3.scene.parts.find(item => item.id === 'shore-neighbors'), panel = V3.shore.panel;
    const picker = panel.querySelector('select'), note = panel.querySelector('.hermit-observation'), seen = new Set();
    const crab = V3.models.current().root.getObjectByName('shore-neighbors').children.find(child => child.userData.clickable === 'hermit');
    const den = V3.terrain.hermitDen; let range = 0;
    picker.focus();
    for (let frame = 0; frame < 640; frame++) {
      part.update(.05, frame * .05); seen.add(note.textContent);
      range = Math.max(range, Math.hypot(crab.position.x - den.x, crab.position.z - den.frontZ));
    }
    return { roaming: range > 1.3, sifted: [...seen].some(text => text.includes('细沙')), groomed: [...seen].some(text => text.includes('蹭了蹭')),
      uninterrupted: document.activeElement === picker && note.isConnected };
  });
  assert.deepEqual(watching, { roaming: true, sifted: true, groomed: true, uninterrupted: true }, 'watching a crab with a borrowed shell never pins it or redraws the controls');
  assert.deepEqual(await page.evaluate(() => [V3.shore.shore().memory.kind,V3.shore.shore().memory.pat,V3.cabinInventory.available('conch')[0].uid]), ['conch','sunset','test-wing']);
  await page.evaluate(async () => { V3.shore.close(); await V3.album.open(); });
  await press('把纪念照贴进这本相册'); await until(() => V3.album.photos().some(photo => photo.name.includes('女王凤凰螺')));
  await page.evaluate(() => { V3.album.close(); V3.collection.openDetail('top_shell','test-top'); });
  await press('设为今日展品'); await until(() => Object.values(V3.game.inventory().placements).some(place => place.uid === 'test-top'));
  await page.evaluate(() => { V3.collection.close(); V3.shore.act('swimPost'); });
  await press('鱼类图鉴'); await press('摆放 / 查看鱼缸');
  assert.equal(await page.evaluate(() => V3.shore.shore().berth), null);
  await press('摆在门廊西侧的小架'); await until(() => V3.shallows.currentBerth()?.key === 'west');
  const net = await page.evaluate(() => {
    const part = V3.scene.parts.find(item => item.id === 'shallows'), state = V3.shallows.state;
    part.update(.05,2); const miss = V3.shallows.net();
    part.update(.05,.22); const waiting = [state.inRing,Math.abs(state.fish.rotation.z),state.ring.material.color.getHex()];
    const caught = V3.shallows.net(), poses = [];
    for (let frame = 0; frame < 20; frame++) { part.update(.05,2+frame*.05); poses.push([Math.hypot(state.fish.position.x-state.netX,state.fish.position.z-state.netZ),state.fish.rotation.z,state.tail.rotation.y]); }
    return {miss,waiting,caught,poses,ripple:state.ripple.visible,ring:state.ring.material.color.getHex()};
  });
  assert.equal(net.miss,false); assert.ok(net.waiting[0] && net.waiting[1]>.05 && net.waiting[2]===0xffcb52);
  assert.ok(net.caught && net.ripple && net.ring===0xf58c48 && net.poses.every(pose => pose[0]<.38));
  assert.ok(net.poses.some(pose => pose[1]>.4) && net.poses.some(pose => pose[1]<-.4) && net.poses.some(pose => Math.abs(pose[2])>.7));
  await page.locator('.shore-panel button[aria-label="关闭"]').click();
  assert.deepEqual(await page.evaluate(() => {
    const shallows = V3.scene.parts.find(part => part.id === 'shallows'), state=V3.shallows.state;
    for(let frame=0;frame<15;frame++) shallows.update(.05,2+frame*.05);
    return [state.grip,state.ripple.visible,state.inRing,V3.shore.shore().observed.length];
  }), [null,false,false,0]);
  await page.evaluate(() => { V3.scene.parts.find(part => part.id === 'shallows').update(.05,0); V3.shallows.net(); });
  await press('带回鱼缸'); await until(() => V3.shore.shore().fish.length === 1);
  assert.equal(await page.evaluate(() => V3.shallows.state.departures.length),0);
  await menu('homeTank'); await page.locator('input[aria-label="鱼的名字"]').fill('银点'); await press('取名'); await until(() => V3.shore.shore().fish[0].name === '银点');
  await press('喂食'); await until(() => V3.shore.shore().fish[0].fed > 0);
  await press('鱼类图鉴');
  assert.equal(await page.$eval('.col-num', label => label.textContent), '已观察 1 / 30');
  assert.equal(await page.$eval('.fish-residents', label => label.textContent), '鱼缸住户 · 1 尾');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    V3.shore.close();
    for (const [id, size, pat] of [['test-tray-shell', 122, 'iris'], ['test-case-shell', 115, 'mist']]) {
      const spot = V3.beachItems.spot(); if (!spot) throw Error('No dry landing place for a clam');
      const item = {...spot, id, kind: 'giant_clam', size, pat, at: Date.now()};
      V3.game.st.beach.push(item); V3.emit('game:wash', {items: [item], silent: true});
      if (!V3.beachItems.get(id) || !(await V3.game.collect(id))?.instance) throw Error('The clam could not be picked up from the beach');
    }
    V3.collection.openDetail('giant_clam', 'test-case-shell');
  });
  await press('设为今日展品'); await until(() => Object.values(V3.game.inventory().placements).some(place => place.uid === 'test-case-shell'));
  const shellLayout = await page.evaluate(async () => {
    V3.collection.close();
    const layout = await V3.sandTray.commit([{uid: 'test-tray-shell', x: -14, z: 11, ry: .26, flip: true}]);
    if (!layout.ok) throw Error(layout.error);
    V3.sandTray.open(); return V3.game.inventory().tray;
  });
  const photoOfTray = () => page.evaluate(() => V3.sandTray.snapshot({size: 160, type: 'image/png'}));
  const classicPhoto = await photoOfTray(); assert.match(classicPhoto, /^data:image\/png;base64,/);
  await page.evaluate(() => V3.sandTray.close());
  await page.reload({waitUntil: 'load'}); await ready();
  assert.deepEqual(await page.evaluate(() => [V3.game.inventory().coins, V3.shore.shore().loan, V3.shore.shore().memory.pat, V3.shore.shore().fish[0].name, V3.shore.shore().fish[0].fed > 0, V3.album.photos().length]), [1, 'test-chips', 'sunset', '银点', true, 1]);
  await page.setViewport({width:390,height:844});
  await wearing('carrier_shell','ring'); await clickHermit(page); await press('收回借出的壳'); await wearing('moon','plain');
  await page.setViewport({width:1080,height:760});
  assert.equal(await page.evaluate(() => V3.cabinInventory.available('carrier_shell')[0]?.uid),'test-chips'); await page.evaluate(() => V3.shore.close());
  await until(() => V3.shallows.state.tank.getObjectByName('tank-body')?.getObjectByName('main') && V3.sandTray.objects()[0]?.getObjectByName('sand-tray:frame')?.isMesh);
  assert.equal(await photoOfTray(), classicPhoto);
  await menu('homeTank'); await press('鱼类图鉴');
  assert.equal(await page.$eval('.fish-specimen[data-state="seen"]', card => card.dataset.kind), await page.evaluate(() => V3.shore.shore().fish[0].kind));
  await press('摆放 / 查看鱼缸'); await press('放归'); await until(() => !V3.shore.shore().fish.length);
  await press('鱼类图鉴'); assert.equal(await page.$eval('.col-num', label => label.textContent), '已观察 1 / 30');
  assert.equal(await page.$('.fish-residents'), null); await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => {
    const inventory = V3.game.inventory(), exhibited = Object.values(inventory.placements).find(place => place.uid === 'test-case-shell');
    const kind = V3.game.kind('giant_clam'), clams = inventory.found.giant_clam;
    return [inventory.tray, V3.shallows.currentBerth().key, exhibited.kind, kind.name, kind.rarity, clams.n, clams.items.map(item => [item.uid, item.size, item.pat])];
  }), [shellLayout, 'west', 'giant_clam', '砗磲空壳', 'rare', 2, [['test-tray-shell', 122, 'iris'], ['test-case-shell', 115, 'mist']]]);
  const spotted = [];
  for (let school = 0; school < 3; school++) spotted.push(await observeReef(page,until));
  await page.reload({waitUntil:'load'}); await ready();
  await page.evaluate(() => V3.collection.open()); await press('鱼类图鉴'); await press('远礁观赏 · 3/10');
  assert.equal(await page.$eval('.col-num', label => label.textContent), '已观察 4 / 30');
  assert.deepEqual((await page.$$eval('.fish-specimen[data-state="seen"]', cards => cards.map(card => card.dataset.kind))).sort(),spotted.sort());
  for (const image of await page.$$('.fish-plate img')) {
    await image.evaluate(element => element.scrollIntoView({block:'nearest'})); await until(element => element.naturalWidth===224,image);
  }
  await page.$eval('.fish-pages', body => { body.scrollTop=0; });
  if (process.env.SHORE_GUIDE_PHOTO) await (await page.$('.col-folio')).screenshot({path:process.env.SHORE_GUIDE_PHOTO,quality:92});
  await page.keyboard.press('Escape');
  const swimmers = [await swimRoundTrip(page, press)];
  if (!swimmers.includes('v1')) {
    await page.evaluate(() => V3.ysmUI.choose('v1')); await until(() => V3.actor.bodyId === 'v1');
    await page.setViewport({width:390,height:844});
    swimmers.push(await swimRoundTrip(page, press));
    await page.setViewport({width:1080,height:760});
  }
  await page.evaluate(() => { V3.shore.close(); V3.actor.rest(false); });
  await releaseFromNet(page,press);
  const snow = await page.evaluate(async () => {
    const model=V3.models.current(), part=V3.scene.parts.find(item=>item.id==='snow-cover');
    await V3.view('weather=snow+floor=all'); V3.env.setWeather('snow');
    for(let step=0;step<500;step++) { V3.env.update(.1); part.update(.1,step*.1,{state:{floor:'all'}}); }
    const root=model.root.getObjectByName('snow-cover'), depth=V3.snowCover.depth, heights=root.children.map(mesh=>mesh.geometry.attributes.position.count);
    part.update(.05,51,{state:{floor:'loft'}}); return [depth,root.visible,heights,root.getObjectByName('snow:roof').visible];
  });
  assert.ok(snow[0]>.3 && snow[1] && snow[2].every(count=>count>0) && !snow[3]);
  assert.deepEqual(await page.evaluate(() => window.__errors), []); assert.deepEqual(errors, []);
  console.log('PASS: tap-to-focus on the hermit, rock crab and lifebuoy; unobstructed shore menus; physical reef clicks, shore observations restored, two collection tabs, net struggle, cancellation and visible swim-away on release, coin pickup, native swim / float / return (' + swimmers.join(', ') + '), shell loan, album, exhibit, catch and feeding, furniture, clams, snow');
} finally { await browser?.close(); await server.close(); }
