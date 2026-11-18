import assert from 'node:assert/strict';
import path from 'node:path';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';

const server = await serveFiles({ '/cabin.html': path.join(WEB_DIR, 'dist', 'cabin.html') });

async function swimRoundTrip(page, press) {
  const buoyClick = await page.evaluate(() => {
    V3.shore.close();
    const [shoreX, shoreZ] = V3.shallows.track().shore;
    V3.actor.rest(true); V3.actor.place(shoreX, shoreZ - 2, 0);
    const buoy = V3.shallows.state.root.children.find(child => child.userData.clickable === 'swimPost');
    const target = buoy.localToWorld(new THREE.Vector3(.23, .8, .082));
    V3.R.setView({pos:[target.x + .15, target.y + .30, target.z + 2.2], target:target.toArray()});
    V3.R.camera.updateMatrixWorld(); const ndc = target.project(V3.R.camera), rect = V3.R.canvas.getBoundingClientRect();
    return [rect.left + (ndc.x + 1) * rect.width / 2, rect.top + (1 - ndc.y) * rect.height / 2];
  });
  await page.mouse.click(...buoyClick); await press('邀请她去浅海');
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
  page.on('pageerror', error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => window.__READY && V3.cabinInventory.canShore() && V3.shallows.state.spots.length, { timeout: 100000 });
  const press = text => page.locator(`::-p-xpath(//button[normalize-space(.)='${text}'])`).click();
  const menu = target => page.evaluate(key => V3.cabinTargets.act({ what: key, obj: {} }), target);
  const until = (fn, ...args) => page.waitForFunction(fn, { timeout: 18000 }, ...args);
  await page.goto(server.url + '/cabin.html?auto=0&wx=clear', { waitUntil: 'load' }); await ready();
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
  await page.evaluate(async () => {
    const client = V3.cabinInventory;
    for (const [id,kind,pat] of [['test-moon','moon','iris'],['test-top','top_shell','mist']]) await client.perform({op:'collect',id,kind,pat,size:65,at:Date.now(),category:'collectible'});
    V3.shore.act('hermit');
  });
  await press('试这枚'); assert.equal(await page.evaluate(() => V3.shore.shore().loan), null);
  await press('借给它'); await until(() => V3.shore.shore().loan === 'test-moon');
  await page.evaluate(async () => { V3.shore.close(); await V3.album.open(); });
  await press('把纪念照贴进这本相册'); await until(() => V3.album.photos().some(photo => photo.name.includes('邻居')));
  await page.evaluate(() => { V3.album.close(); V3.collection.openDetail('top_shell','test-top'); });
  await press('设为今日展品'); await until(() => Object.values(V3.game.inventory().placements).some(place => place.uid === 'test-top'));
  await page.evaluate(() => { V3.collection.close(); V3.shore.act('swimPost'); });
  await press('摆放 / 查看鱼缸'); await press('摆在门廊西侧的小架'); await until(() => V3.shallows.currentBerth()?.key === 'west');
  await page.evaluate(() => {
    const part = V3.scene.parts.find(item => item.id === 'shallows'); part.update(.05,0); V3.shallows.net();
  });
  await press('带回鱼缸'); await until(() => V3.shore.shore().fish.length === 1);
  await menu('homeTank'); await page.locator('input[aria-label="鱼的名字"]').fill('银点'); await press('取名'); await until(() => V3.shore.shore().fish[0].name === '银点');
  await press('喂食'); await until(() => V3.shore.shore().fish[0].fed > 0);
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
  assert.deepEqual(await page.evaluate(() => [V3.game.inventory().coins, V3.shore.shore().loan, V3.shore.shore().memory.pat, V3.shore.shore().fish[0].name, V3.shore.shore().fish[0].fed > 0, V3.album.photos().length]), [1, 'test-moon', 'iris', '银点', true, 1]);
  await until(() => V3.shallows.state.tank.getObjectByName('tank-body')?.getObjectByName('main') && V3.sandTray.objects()[0]?.getObjectByName('sand-tray:frame')?.isMesh);
  assert.equal(await photoOfTray(), classicPhoto);
  assert.deepEqual(await page.evaluate(() => {
    const inventory = V3.game.inventory(), exhibited = Object.values(inventory.placements).find(place => place.uid === 'test-case-shell');
    const kind = V3.game.kind('giant_clam'), clams = inventory.found.giant_clam;
    return [inventory.tray, V3.shallows.currentBerth().key, exhibited.kind, kind.name, kind.rarity, clams.n, clams.items.map(item => [item.uid, item.size, item.pat])];
  }), [shellLayout, 'west', 'giant_clam', '砗磲空壳', 'rare', 2, [['test-tray-shell', 122, 'iris'], ['test-case-shell', 115, 'mist']]]);
  const swimmers = [await swimRoundTrip(page, press)];
  if (!swimmers.includes('v1')) {
    await page.evaluate(() => V3.ysmUI.choose('v1')); await until(() => V3.actor.bodyId === 'v1');
    swimmers.push(await swimRoundTrip(page, press));
  }
  await page.evaluate(() => { V3.shore.close(); V3.actor.rest(false); });
  const snow = await page.evaluate(async () => {
    const model=V3.models.current(), part=V3.scene.parts.find(item=>item.id==='snow-cover');
    await V3.view('weather=snow+floor=all'); V3.env.setWeather('snow');
    for(let step=0;step<500;step++) { V3.env.update(.1); part.update(.1,step*.1,{state:{floor:'all'}}); }
    const root=model.root.getObjectByName('snow-cover'), depth=V3.snowCover.depth, heights=root.children.map(mesh=>mesh.geometry.attributes.position.count);
    part.update(.05,51,{state:{floor:'loft'}}); return [depth,root.visible,heights,root.getObjectByName('snow:roof').visible];
  });
  assert.ok(snow[0]>.3 && snow[1] && snow[2].every(count=>count>0) && !snow[3]);
  assert.deepEqual(await page.evaluate(() => window.__errors), []); assert.deepEqual(errors, []);
  console.log('PASS: physical coin and lifebuoy clicks, native swim / float / return (' + swimmers.join(', ') + '), shell loan, album, exhibit, catch and feeding, original furniture and two giant clams on the tray / shelf after reopening, terrain and cutaway snow');
} finally { await browser?.close(); await server.close(); }
