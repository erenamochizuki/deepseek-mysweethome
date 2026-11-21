// 临时浏览器存档。只固定潮水送来的第一颗种子和测试时钟，其余走玩家的点击和真实存档命令。
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { WEB_DIR, launchBrowser, serveFiles } from '../tools/mc-lib.mjs';

const dir = path.join(WEB_DIR, 'shots', 'window-garden'), kind = 'beach_morning_glory';
const server = await serveFiles({ '/cabin.html': path.join(WEB_DIR, 'dist', 'cabin.html') });
let browser;
try {
  await mkdir(dir, { recursive:true });
  browser = await launchBrowser({width:1100, height:760, gpu:'swiftshader', args:process.argv.includes('--isolated-runner') ? ['--no-sandbox'] : []});
  const page = await browser.newPage(), errors = [];
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.gardenTestDay = Number(sessionStorage.getItem('garden-test-day')) || 0;
    Date.now = () => Date.UTC(2026, 10, 1, 6) + window.gardenTestDay * 86400000; // 默认小屋时间下午两点
  });
  const until = async (fn,...args) => {
    try { return await page.waitForFunction(fn, {timeout:30000}, ...args); }
    catch (err) {
      const state = await page.evaluate(() => ({ ready:window.__READY, floor:V3.models.current()?.states?.floor?.value,
        sill:V3.shellDecor.gardenSill(), garden:V3.game.inventory()?.garden, actor:V3.actor?.behavior,
        menu:document.querySelector('.shore-panel')?.textContent, last:window.gardenLog?.at(-1)?.type,
        beach:V3.game.st.beach.map(b=>b.kind), inventoryError:V3.cabinInventory.error, sceneErrors:window.__errors }));
      throw Error(String(fn) + ' ' + JSON.stringify({state, errors}), {cause:err});
    }
  };
  const ready = () => until(() => window.__READY && V3.cabinInventory.canGarden() && V3.actor?.root);
  const snap = file => page.screenshot({path:path.join(dir, file + '.png')});
  const action = key => page.locator('[data-garden-action="' + key + '"]').click();
  const day = n => page.evaluate(i => { window.gardenTestDay = i; sessionStorage.setItem('garden-test-day', i); }, n);
  // 朝模型中心取点，再用小屋自己的遮挡判断确认最终点击的是它。
  async function clickModel(what) {
    const pt = await page.evaluate(async what => {
      const scene = V3.R.scene, pot = what === 'windowGarden';
      const obj = pot ? V3.gardenScene.objects()[0] : V3.beachItems.objects().find(o => o.userData.kind === 'beach_morning_glory');
      if (!obj) throw Error('未找到场景模型 ' + what);
      scene.updateMatrixWorld(true);
      const point = new THREE.Box3().setFromObject(obj, true).getCenter(new THREE.Vector3());
      if (pot) { obj.getWorldPosition(point); point.y += .085; }
      else obj.getObjectByName('beach:pick').getWorldPosition(point);
      const rect = V3.R.canvas.getBoundingClientRect(), x = rect.left + rect.width/2, y = rect.top + rect.height/2;
      const hits = [];
      for (const delta of pot ? [[.5,.53,-1.5],[-.5,.72,-1.8],[0,.8,1.7],[.2,1.2,-1.5]] : [[.4,1.4,1.5],[0,2,-1]]) {
        V3.R.setView({pos:point.toArray().map((v,i) => v + delta[i]), target:point.toArray()});
        await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
        const hit = V3.cabinTargets.pick({clientX:x, clientY:y});
        const element = document.elementFromPoint(x,y);
        hits.push([hit?.what,hit?.obj?.name,element?.tagName,element?.className]);
        if (hit?.what === what && hit.obj === obj && element === V3.R.canvas) return [x,y];
      }
      throw Error('场景点选被挡住 '+what+' '+JSON.stringify(hits));
    }, what);
    await page.mouse.click(...pt);
  }
  await page.goto(server.url + '/cabin.html?auto=0&wx=clear&time=noon', {waitUntil:'load',timeout:120000}); await ready();
  await page.evaluate(async kind => {
    V3.actor.hold(true); window.gardenLog = []; V3.on('game:cabin-event', e => window.gardenLog.push(e));
    await V3.view('floor=loft+time=noon');
    const tide = V3.cabinTide, pick = tide.pick;
    try { tide.pick = () => V3.game.kind(kind); V3.game.washNow(1); } finally { tide.pick = pick; }
    V3.beachItems.settle();
  }, kind);
  await clickModel('collect'); await until(k => V3.game.inventory().garden.seeds[k] === 1, kind);
  assert.equal(await page.evaluate(() => V3.game.counts().total), 65);
  async function faceWindow() {
    await until(() => V3.shellDecor.gardenSill());
    await page.evaluate(async () => {
      const {position:[x,y,z]} = V3.shellDecor.gardenSill();
      await V3.view('floor=all'); // 屋内近景要保留南墙和真实窗框。
      V3.R.setView({pos:[x+.14,y+.65,z-1.9],target:[x,y+.2,z]});
    });
    await until(() => V3.gardenScene.objects().length);
  }
  await faceWindow(); await clickModel('windowGarden');
  await action('plant'); await until(() => V3.game.inventory().garden.pot); await action('water');
  await until(() => V3.game.inventory().garden.pot.watered.length === 1);
  await action('inspect'); await page.waitForSelector('.garden-orbit canvas');
  const orbit = await page.$('.garden-orbit canvas'), frame = await orbit.boundingBox();
  const before = await orbit.screenshot();
  await page.mouse.move(frame.x + frame.width/2, frame.y + frame.height/2); await page.mouse.down();
  await page.mouse.move(frame.x + frame.width/2 + 45, frame.y + frame.height/2 - 16, {steps:5}); await page.mouse.up();
  const turned = await orbit.screenshot(); assert.ok(!before.equals(turned), '拖动改变观赏角度');
  await page.mouse.wheel({deltaY:-130}); await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert.ok(!turned.equals(await orbit.screenshot()), '滚轮放大模型');
  await page.locator('.garden-view button').click(); await day(1);
  // 从一楼走上阁楼，喷壶到窗边才落盘。加快的只是演员的步伐。
  const route = await page.evaluate(() => {
    const a = V3.actor; a.hold(false); a.rest(false); V3.game.auto = true;
    const reason = a.behaviorAvailability('garden_water'); V3.cabinRoutine.tick();
    const began = a.behavior?.kind;
    const actor = V3.scene.parts.find(p => p.id === 'girl-actor');
    for (let i = 0; i < 6000 && a.behavior?.kind === 'garden_water' && a.behavior.phase !== 'action'; i++) actor.update(.05);
    return { began, reason, phase:a.behavior?.phase };
  });
  assert.equal(route.began, 'garden_water', JSON.stringify(route));
  await until(() => gardenLog.some(e => e.type === 'garden_water' && e.detail.by === 'girl'));
  await page.evaluate(() => { V3.game.auto = false; V3.actor.hold(true); });
  await clickModel('windowGarden');
  for (let i = 2; i < 15; i++) {
    await day(i); await until(() => !document.querySelector('[data-garden-action="water"]').disabled);
    await action('water'); await until(n => V3.game.inventory().garden.pot.watered.length === n, i+1);
  }
  await action('harvest'); await until(() => gardenLog.some(e => e.type === 'garden_harvest'));
  const stored = await page.evaluate(() => ({garden:V3.game.inventory().garden, types:gardenLog.map(e => e.type)}));
  assert.equal(stored.types.filter(t => t === 'garden_bloom').length, 1); assert.equal(stored.garden.pot.by[1], 'girl');
  assert.ok([1,2].includes(stored.garden.seeds[kind])); assert.equal(stored.garden.pot.harvested,15);
  await page.reload({waitUntil:'load'}); await ready(); assert.deepEqual(await page.evaluate(() => V3.game.inventory().garden), stored.garden);
  console.log('通过：拾种、播种、她上楼浇水、开花、收种、刷新保留。');
  await page.evaluate(async () => {
    V3.actor.hold(true); await V3.view('floor=loft+time=noon');
    const I = V3.cabinInventory;
    for (const op of [{op:'collect',id:'test-shell',kind:'scallop',at:Date.now(),category:'collectible'},
      {op:'place',id:'test-display',uid:'test-shell',kind:'scallop',slot:'loft-window',by:'girl'}]) {
      const r = await I.perform(op); if (!r.ok) throw Error(r.error);
    }
  });
  await faceWindow(); await until(() => V3.shellDecor.objects().length);
  await page.evaluate(() => {
    const pot = V3.gardenScene.objects()[0], shell = V3.shellDecor.objects().find(o => o.userData.shellDecorSlot === 'loft-window');
    const a = pot.getWorldPosition(new THREE.Vector3()), b = shell.getWorldPosition(new THREE.Vector3());
    if (Math.abs(a.x+1.5)>.001 || Math.abs(a.z+6.775)>.001 || Math.abs(b.x+6.225)>.001 || Math.abs(b.z+11.5)>.001) throw Error('南窗花盆或西窗陈设偏离窗台');
    V3.R.setView({pos:[b.x+2.45,b.y+.72,b.z-.30],target:[b.x,b.y+.36,b.z+.28]});
  });
  const painted = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await painted(); await snap('west-window');
  await page.evaluate(() => {
    const [x,y,z] = V3.shellDecor.gardenSill().position;
    V3.R.setView({pos:[x+.12,y+.62,z-2.23],target:[x,y+.44,z]});
  });
  await painted(); await snap('window');
  await page.evaluate(() => V3.collection.open()); await page.click('#col-tab-garden');
  await until(() => document.querySelectorAll('.garden-entry').length === 5 && document.querySelector('.garden-entry time'));
  await snap('journal'); await page.evaluate(() => V3.collection.close());
  await page.setViewport({width:390,height:844,deviceScaleFactor:1}); await until(() => V3.R.canvas.clientWidth === 390);
  await clickModel('windowGarden'); await page.waitForSelector('[data-garden-action="harvest"]');
  const fits = await page.$eval('[data-subject="windowGarden"]', p => {const b=p.getBoundingClientRect();return b.left>=0 && b.right<=innerWidth && b.top>=0 && b.bottom<=innerHeight && p.scrollWidth<=p.clientWidth+2;});
  assert.ok(fits, '手机菜单完整落在画面内'); await snap('mobile-390');
  await action('clear'); await action('cancel'); assert.deepEqual(await page.evaluate(() => V3.game.inventory().garden), stored.garden);
  await action('clear'); await action('confirm-clear'); await until(() => !V3.game.inventory().garden.pot);
  assert.deepEqual(await page.evaluate(() => V3.game.inventory().garden), {...stored.garden,pot:null});
  await page.evaluate(() => V3.shore.close());
  assert.ok(await page.$eval('.hud-floors', el => el.getBoundingClientRect().width > 0), '收起菜单时恢复楼层工具');
  await combinedWindow(page); await plates(page);
  assert.deepEqual(errors, []); console.log('通过：窗台、花盆手记、390 像素菜单与模型对比图。');
} finally { await browser?.close(); await server.close(); }

// 在刚换空的盆里种文殊兰，把三串挂件都做到 45 厘米，刷新后用实际模型测距和取景。
async function combinedWindow(page) {
  await page.setViewport({width:1100,height:760,deviceScaleFactor:1});
  await page.evaluate(async () => {
    const I=V3.cabinInventory, R=V3.inventoryRules, kind='crinum';
    async function perform(command) {
      const result=await I.perform(command);
      if (!result.ok || !result.applied) throw Error(command.id+' '+JSON.stringify(result));
    }
    await perform({op:'collect',id:'together-seed',kind,category:'seed',at:Date.now()});
    await perform({op:'garden_plant',id:'together-plant',kind});
    const zone=R.gardenZone(I.data.inventory,'UTC');
    for (let i=0;i<12;i++) {
      window.gardenTestDay++;
      await perform({op:'garden_water',id:'together-water-'+i,by:'player',zone,day:R.gardenDay(Date.now(),zone)});
    }
    sessionStorage.setItem('garden-test-day',window.gardenTestDay);
    const strands=[[],[],[]];
    const kinds=['scallop','blue_glass_float','starfish'];
    for (let row=0;row<3;row++) for (let j=0;j<3;j++) {
      const uid='together-'+row+'-'+j;
      await perform({op:'collect',id:uid,kind:kinds[(j+row)%3],category:'collectible',at:Date.now(),size:130,pat:'plain'});
      strands[row].push({uid,gap:2});
    }
    await perform({op:'chime_set',id:'together-hang',slot:'window',base:I.data.inventory.chimes.window.rev,bar:'driftwood',strands,by:'player'});
  });
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(() => window.__READY && V3.cabinInventory.canGarden() && V3.cabinInventory.canChime());
  await page.evaluate(() => V3.view('floor=all+time=noon'));
  await page.waitForFunction(() => V3.gardenScene.objects().length && V3.models.current().root.getObjectByName('house2:chimeWindow')?.getObjectByName('chime:craft'));
  const result=await page.evaluate(() => {
    V3.R.freeze(0);
    const inv=V3.cabinInventory.data.inventory, pot=V3.gardenScene.objects()[0];
    const bell=V3.models.current().root.getObjectByName('house2:chimeWindow').getObjectByName('chime:craft');
    const flower=new THREE.Box3().setFromObject(pot,true), chime=new THREE.Box3().setFromObject(bell,true);
    const [x,y,z]=V3.shellDecor.gardenSill().position;
    V3.R.setView({pos:[x+.13,y+.65,z-2.30],target:[x,y+.53,z],fov:43});
    return {kind:inv.garden.pot.kind,stage:V3.inventoryRules.gardenStage(inv.garden.pot.watered.length),
      lengths:V3.chimeCraft.layout('window',inv.chimes.window).map(row=>row.length),gap:(chime.min.y-flower.max.y)*100};
  });
  assert.equal(result.kind,'crinum'); assert.equal(result.stage,5); assert.deepEqual(result.lengths,[45,45,45]);
  assert.ok(result.gap>0,'最高花瓣与最低挂件的垂直净空 '+result.gap+' 厘米');
  const folder=path.join(WEB_DIR,'shots','integrate'); await mkdir(folder,{recursive:true});
  await page.evaluate(() => new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await page.screenshot({path:path.join(folder,'window-chime-garden.png')});
  console.log('同屏实测：满长三串与盛开文殊兰相隔 '+result.gap.toFixed(1)+' 厘米。');
}

// 用游戏中的原模型、同一镜位和灯光画图版。生长阶段共用缩放，保留实际高度变化。
async function plates(page) {
  const { images, faces } = await page.evaluate(() => {
    const ids=V3.washupCatalog.seeds.map(k => k.id), names=V3.washupCatalog.seeds.map(k => k.name.replace(/种子$/, ''));
    const drawPot=(k,s) => V3.gardenModels.build(k,s), drawSeed=k => V3.washupCatalog.build(k,{tag:false});
    const render=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
    render.setSize(240,260); render.setClearColor(0,0); render.toneMapping=THREE.ACESFilmicToneMapping;
    render.toneMappingExposure=.95; const scene=new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfffaf2,0xb1a996,.76));
    const key=new THREE.DirectionalLight(0xfff4df,1.1);key.position.set(-2,4,-3);scene.add(key);
    const camera=new THREE.OrthographicCamera(-.30,.30,.325,-.325,.001,20);
    const faces = {};
    function plate(title, objects, labels, normalize=false, centers=null) {
      const canvas=document.createElement('canvas');canvas.width=240*objects.length;canvas.height=340;
      const c=canvas.getContext('2d');c.fillStyle=centers ? '#a9c0b8' : '#cfdbd5';c.fillRect(0,0,canvas.width,canvas.height);
      c.fillStyle='#314b47';c.font='bold 24px Microsoft YaHei, sans-serif';c.fillText(title,20,34);
      objects.forEach((model,i) => {
        const holder=new THREE.Group();holder.add(model);scene.add(holder);
        const box=new THREE.Box3().setFromObject(model,true), extent=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
        holder.scale.setScalar(normalize ? .48/Math.max(extent.x,extent.y,extent.z) : 1);
        holder.position.set(-center.x,-box.min.y,-center.z).multiplyScalar(holder.scale.x);
        const target = centers ? holder.localToWorld(new THREE.Vector3(...centers[i])) : new THREE.Vector3(0,normalize ? extent.y*holder.scale.x*.46 : .25,0);
        camera.zoom = centers ? 2.45 : 1; camera.updateProjectionMatrix();
        camera.position.copy(target).add(new THREE.Vector3(.40,.74,-1.85));camera.lookAt(target);render.render(scene,camera);
        if (model.name === 'window-garden-model') {
          const {calls, triangles} = render.info.render;
          // 花冠特写允许视锥裁掉盆底，整株照才计入整盆预算。
          if (!calls || calls > model.children.length || (!centers && calls !== model.children.length) || triangles >= 9000) {
            throw Error(labels[i]+' 绘制异常 '+calls+' 次 / '+triangles+' 面');
          }
          if (!centers && labels[i] === names[i]) faces[ids[i]] = triangles;
        }
        const gl=render.getContext(),pixels=new Uint8Array(240*260*4);gl.readPixels(0,0,240,260,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let count=0;for(let j=3;j<pixels.length;j+=4) if(pixels[j]>100) count++;if(count<150) throw Error('图版模型没有绘出：'+labels[i]);
        c.drawImage(render.domElement,i*240,44);c.textAlign='center';c.font='17px Microsoft YaHei, sans-serif';
        c.fillText(labels[i],i*240+120,320);scene.remove(holder);
      });return canvas.toDataURL();
    }
    const studio=V3.models.get('plants').build(), fern=studio.root.getObjectByName('potW').clone();fern.position.set(0,0,0);
    try {
      const empty = drawPot(null,0); scene.add(empty); camera.position.set(0,.2,-1); camera.lookAt(0,.1,0); render.render(scene,camera);
      if (render.info.render.calls !== 1) throw Error('空盆超过一次绘制');
      faces.empty = render.info.render.triangles; scene.remove(empty);
      return { faces, images: {
      flowers:plate('窗台初花',ids.map(k=>drawPot(k,5)),names),
      details:plate('五种花的花冠',ids.map(k=>drawPot(k,5)),names,false,
        [[-.06,.367,-.045],[.03,.365,-.012],[-.03,.34,-.034],[0,.418,.008],[.02,.366,-.012]]),
      stages:plate('厚藤的五个阶段',[1,2,3,4,5].map(s=>drawPot(ids[0],s)),['第 1 天 · 发芽','第 3 天 · 幼苗','第 6 天 · 长叶','第 9 天 · 花苞','第 12 天 · 开花']),
      seeds:plate('潮线上的种子',[...ids.map(drawSeed),drawSeed('sea_bean')],[...names,'原有拾物 · 海漂心豆'],true),
      style:plate('窗台、门廊与海滩藏品',[fern,drawPot(ids[0],5),drawSeed('rainbow_abalone'),drawPot(ids[4],5),drawSeed('blue_glass_float')],
        ['门廊西盆栽','窗台 · 厚藤','虹彩鲍壳','窗台 · 黄槿','玻璃浮球'],true),
      } }; } finally { studio.dispose(); render.dispose();render.forceContextLoss(); }
  });
  console.log('实测三角面', faces);
  for (const [name,url] of Object.entries(images)) await writeFile(path.join(dir,name+'.png'),Buffer.from(url.split(',')[1],'base64'));
}
