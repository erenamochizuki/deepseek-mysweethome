// 在临时浏览器和随机本地端口串两件风铃。朝海小窗的近景同时拍到空窗台。
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';

const buildDir = process.env.CABIN_BUILD_DIR || path.join(WEB_DIR, 'dist');
const server = await serveFiles({ '/cabin.html': path.join(buildDir, 'cabin.html') });
const dir = process.env.CHIME_SHOTS_DIR || path.join(WEB_DIR, 'shots', 'chime-craft');
const sampleKinds = ['scallop','cowrie','limpet','mussel','moon','nassa','miter','pearl','clam','conch','moon'];
const softKinds = ['kelp_ribbon','winged_kelp','fan_alga'];
let browser, page, step = '启动小屋';
const errors = [];
try {
  const args = process.argv.includes('--isolated-runner') ? ['--no-sandbox'] : [];
  browser = await launchBrowser({ width: 1080, height: 760, gpu: 'swiftshader', args });
  page = await browser.newPage(); page.on('pageerror', e => errors.push(e.stack || e.message));
  const ready = () => page.waitForFunction(() => window.__READY && V3.cabinInventory.canChime() && V3.houseDetail.chimes().length === 2, { timeout: 100000 });
  await page.goto(server.url + '/cabin.html?auto=0&wx=clear&time=noon', { waitUntil: 'load' }); await ready();
  await mkdir(dir, { recursive: true });
  const click = async (selector, text) => {
    const ref = await page.waitForFunction((s,t) => [...document.querySelectorAll(s)].find(b => b.textContent.trim() === t), {}, selector, text);
    await ref.asElement().click(); await ref.dispose();
  };
  const count = (slot, n) => page.waitForFunction((s,num) => V3.cabinInventory.data.inventory.chimes[s].strands.flat().length === num, {}, slot, n);
  const seeded = await page.evaluate(async kinds => {
    const I = V3.cabinInventory; if (I.remote || I.data.inventory.chimes.door.rev) throw Error('需要独立的新本地存档');
    const results = [];
    for (const [i, kind] of kinds.entries()) {
      const k = V3.game.kind(kind);
      results.push((await I.perform({ op: 'collect', id: `craft-${i}`, kind, category: 'collectible', at: 1,
        size: k.size * (i === 0 || i === 10 ? 1300 : 1000), pat: ['sunset','iris','plain','mist'][i % 4] })).ok);
    }
    return results;
  }, [...sampleKinds, ...softKinds]);
  assert.ok(seeded.every(Boolean));
  const frames = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const photo = async name => { await frames(); await page.screenshot({ path: path.join(dir, name + '.png') }); };
  async function focus(slot) {
    await page.evaluate(async slot => {
      // 机位在玻璃的屋内一侧，朝海外看，同时收入下方的窗台。
      await V3.view('floor=all'); V3.R.freeze(0);
      const name = slot === 'door' ? 'house2:chime' : 'house2:chimeWindow';
      const obj = V3.models.current().root.getObjectByName(name), pos = obj.getWorldPosition(new THREE.Vector3());
      const sign = slot === 'window' ? -1 : 1, target = [pos.x, pos.y - (slot === 'window' ? .55 : .35), pos.z + sign * .22];
      V3.R.setView({ pos: [pos.x + .18, target[1] + .07, target[2] + sign * (slot === 'window' ? 1.95 : 1.5)], target, fov: 43 });
    }, slot); await frames();
  }
  async function scenePhoto(slot, state) {
    await focus(slot);
    const visible = await page.evaluate(slot => {
      const obj = V3.models.current().root.getObjectByName(slot === 'door' ? 'house2:chime' : 'house2:chimeWindow');
      let shown = true; for (let p = obj; p; p = p.parent) shown &&= p.visible;
      const got = obj.getObjectByName('chime:craft');
      const inFrame = point => { const p = point.project(V3.R.camera); return Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1; };
      const w = V3.layout.openings.find(o => o.id === 'gableS');
      const sill = new THREE.Vector3((w.a0 + w.a1) / 2, w.y0, V3.layout.house.z1 - .75);
      return [shown && inFrame(obj.getWorldPosition(new THREE.Vector3())), !!got, obj.getObjectByName('s0').visible, slot === 'door' || inFrame(sill)];
    }, slot);
    assert.deepEqual(visible, [true, state === 'custom', state !== 'custom', true]); await photo(`${slot}-${state}`);
  }
  async function workbench(slot, verifyDismiss = false) {
    step = `打开 ${slot} 工作台`;
    await focus(slot);
    const xy = await page.evaluate(slot => {
      const obj = V3.models.current().root.getObjectByName(slot === 'door' ? 'house2:chime' : 'house2:chimeWindow');
      const cv = V3.R.canvas, rect = cv.getBoundingClientRect();
      const p = obj.getObjectByName('house2:chime:pick').getWorldPosition(new THREE.Vector3()).project(V3.R.camera);
      const x = Math.round(rect.left + (1 + p.x) * rect.width / 2), y = Math.round(rect.top + (1 - p.y) * rect.height / 2);
      const hit = V3.cabinTargets.pick({ clientX: x, clientY: y }), element = document.elementFromPoint(x, y);
      if (hit?.obj !== obj || hit.obj.userData.chimeSlot !== slot || element !== cv) {
        const ray = new THREE.Raycaster();
        ray.setFromCamera({ x: (x - rect.left) * 2 / rect.width - 1, y: 1 - (y - rect.top) * 2 / rect.height }, V3.R.camera);
        const front = ray.intersectObject(V3.R.scene, true).filter(({ object }) => {
          for (let o = object; o; o = o.parent) if (!o.visible) return false;
          return true;
        }).slice(0, 5).map(h => [h.object.parent?.name, h.object.name, +h.distance.toFixed(3)]);
        throw Error(`点不到${slot} (${x}, ${y})：` + JSON.stringify({ element: element?.outerHTML.slice(0,150),
          hit: hit?.obj.name, slot: obj.userData.chimeSlot, front, errors: window.__errors.slice(-3) }));
      }
      // 在游戏的 pointerup 处理后、下一帧前记结果。可区分事件没到、铃没响、菜单没建、菜单过早消失。
      const before = V3.chimes.stats().clicks, trace = window.__craftTap = {};
      for (const type of ['pointerdown', 'pointerup']) document.addEventListener(type, e => {
        trace[type] = e.target.id || e.target.tagName;
        if (type === 'pointerup') Object.assign(trace, { clicks: V3.chimes.stats().clicks - before, menu: document.querySelector('.chime-menu')?.textContent,
          feedback: !!V3.fb?.enabled, arrange: V3.arrange.on, errors: window.__errors.slice(-3) });
      }, { once: true });
      return [x,y];
    }, slot);
    await page.mouse.click(...xy);
    const trace = await page.evaluate(() => window.__craftTap);
    assert.ok(trace.pointerdown === 'v3-canvas' && trace.pointerup === 'v3-canvas' && trace.clicks === 1 && trace.menu === '重新串一串', JSON.stringify(trace));
    await page.waitForSelector('.chime-menu');
    if (verifyDismiss) {
      // 点菜单外面的空白：菜单要马上收起（2026-11-22 用户反馈：点旁边空白菜单不消失）。
      const blank = await page.evaluate(() => {
        const r = V3.R.canvas.getBoundingClientRect();
        const spots = [[.5, .08], [.9, .15], [.08, .1], [.85, .55], [.12, .55], [.5, .62]];
        for (const [fx, fy] of spots) {
          const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy);
          if (document.elementFromPoint(x, y) !== V3.R.canvas) continue;
          const hit = V3.cabinTargets.pick({ clientX: x, clientY: y });
          if (!hit || hit.what !== 'chime') return [x, y];       // 别再点到风铃，不然菜单会被重新叫出来
        }
        return null;
      });
      assert.ok(blank, '找不到空着的画布');
      await page.mouse.click(...blank);
      assert.equal(await page.$('.chime-menu'), null, '点菜单外面的空白处，菜单要收起');
      // 再点一次风铃：菜单还能出来，点它才打开工作台。
      await page.mouse.click(...xy);
      await page.waitForSelector('.chime-menu');
    }
    await page.click('.chime-menu');
    await page.waitForSelector('.chime-stage canvas');
    assert.equal(await page.$eval('.chime-editor', e => e.getAttribute('aria-label')), slot === 'door' ? '门上的风铃' : '窗边的风铃'); await frames();
  }
  async function hang(uid, line, finishFirstSave = false) {
    step = `拖 craft-${uid} 到第 ${line + 1} 串`;
    await page.click(`.chime-kind[data-kind="${sampleKinds[uid]}"]`);
    const guide = (await page.$$('.chime-guide'))[line], material = await page.$(`[data-uid="craft-${uid}"].chime-pick`);
    assert.ok(material); await material.evaluate(b => b.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    const a = await material.boundingBox(), b = await guide.boundingBox(), cv = await (await page.$('.chime-stage canvas')).boundingBox();
    await page.mouse.move(a.x+a.width/2, a.y+a.height/2); await page.mouse.down();
    if (finishFirstSave) {
      await page.evaluate(() => window.__finishFirstSave()); await count('door', 1);
      assert.ok(await material.evaluate(b => b.isConnected), '第一枚存好后，第二枚仍应留在手里');
    }
    await page.mouse.move(b.x+b.width/2, cv.y+cv.height*.45, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(uid => !document.querySelector(`.chime-pick[data-uid="craft-${uid}"]`), {}, uid);
  }
  step = '收藏盒的物品列表与小屋里的沙盘';
  await page.evaluate(() => V3.collection.open());
  await page.waitForSelector('.col-card.got');
  const collectionButtons = await page.$$eval('#col-page-shells button', bs => bs.map(b => b.textContent.trim()));
  assert.ok(!collectionButtons.some(t => /打开沙盘展示盒|^风铃\s*›/.test(t)), '收藏页不再提供两个小屋工具入口');
  await page.keyboard.press('Escape');
  const trayCenter = await page.evaluate(async () => {
    await V3.view('floor=all');
    const tray = V3.R.scene.getObjectByName('sand-tray-root');
    if (!tray?.visible) throw Error('场景沙盘未显示');
    const target = new THREE.Box3().setFromObject(tray).getCenter(new THREE.Vector3());
    V3.R.setView({pos:[target.x+.12,target.y+1.0,target.z+.65],target:target.toArray()});
    const r = V3.R.canvas.getBoundingClientRect();
    return [r.left+r.width/2,r.top+r.height/2];
  });
  await frames();
  assert.equal(await page.evaluate(([x,y]) => V3.cabinTargets.pick({clientX:x,clientY:y})?.what, trayCenter),'sandTray');
  await page.mouse.click(...trayCenter);
  await page.waitForSelector('.tray[aria-label="沙盘展示盒"]'); await page.keyboard.press('Escape');
  await scenePhoto('door','default'); await scenePhoto('window','default');
  await workbench('door', true);
  step = '在桌面和手机上按实物缩略图选择种类';
  for (const [mode,width,height] of [['desktop',1080,760],['mobile',390,844]]) {
    await page.setViewport({width,height}); await frames();
    const visibleKinds = await page.$$eval('button.chime-kind',async buttons => {
      return Promise.all(buttons.map(async b => {
        const img = b.querySelector('img');
        if (!img) throw new Error('缺少种类图：'+b.dataset.kind);
        await img.decode();
        const cv=document.createElement('canvas'); cv.width=cv.height=24;
        const ctx=cv.getContext('2d'); ctx.drawImage(img,0,0,24,24);
        const painted=ctx.getImageData(0,0,24,24).data.some((v,i)=>i%4===3&&v>0);
        const r=img.getBoundingClientRect(), name=V3.game.kind(b.dataset.kind).name;
        return {kind:b.dataset.kind, painted, displayed:r.width>0 && r.height>0,
          named:(b.getAttribute('aria-label') || b.textContent).includes(name), png:cv.toDataURL()};
      }));
    });
    assert.deepEqual(visibleKinds.map(k=>k.kind).sort(),[...new Set(sampleKinds)].sort(),'种类列表只展示已收藏且可以挂的材料');
    assert.ok(visibleKinds.every(k=>k.painted && k.displayed && k.named),'每种材料应有可见图案和可读名称');
    assert.ok(visibleKinds.find(k=>k.kind==='moon').png !== visibleKinds.find(k=>k.kind==='scallop').png,'白玉螺与扇贝应展示各自图案');
    await page.focus('.chime-kind[data-kind="moon"]'); await page.keyboard.press('Enter');
    assert.equal(await page.$eval('.chime-kind[data-kind="moon"]',b=>b.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.$$eval('.chime-pick',bs=>bs.length),2);
    assert.ok(await page.$eval('.chime-kind[data-kind="moon"]',b=>{
      const img=b.querySelector('img'), r=img.getBoundingClientRect();
      return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
    }),'选中的材料图案应该可以直接点击');
    await photo(`${mode}-material-kinds`);
  }
  await page.setViewport({width:1080,height:760}); await frames();
  await page.click('.chime-kind[data-kind="moon"]');
  const variants = await page.$$eval('.chime-pick', picks => picks.map(b => [b.dataset.uid,b.getAttribute('aria-label'),b.querySelector('img').src]));
  assert.deepEqual(variants.map(b => b[0]).sort(), ['craft-10','craft-4']);
  assert.notEqual(variants[0][1],variants[1][1]); assert.notEqual(variants[0][2],variants[1][2]);
  await page.click('.chime-kind[data-kind="scallop"]');
  assert.deepEqual(await page.$$eval('.chime-pick', picks => picks.map(b => b.dataset.uid)), ['craft-0']);
  // 控制首次存档的完成时机，确保真正松手前经过一次自动存档；仍用正式接口写入。
  await page.evaluate(() => {
    const I = V3.cabinInventory, save = I.setChime, wait = new Promise(resolve => { window.__finishFirstSave = resolve; });
    I.setChime = async (...args) => { I.setChime = save; await wait; return save(...args); };
  });
  async function dragPreview(slot, mode) {
    step = `${slot} ${mode} 拖动中的长度、挂件实样和取消`;
    await page.click('.chime-kind[data-kind="moon"]');
    const material = await page.$('.chime-pick[data-uid="craft-10"]');
    const source = await material.evaluate(b => {
      b.scrollIntoView({block:'nearest',inline:'nearest'});
      b.addEventListener('pointerdown', e => { window.__chimePointer = e.pointerId; }, {once:true});
      const r = b.getBoundingClientRect();
      return { x:r.x+r.width/2, y:r.y+r.height/2 };
    });
    const saved = await page.evaluate(s => structuredClone(V3.cabinInventory.data.inventory.chimes[s]),slot);
    const stage = await page.$eval('.chime-stage',e => e.getBoundingClientRect().toJSON());
    const total = slot === 'door' ? 80 : 45;
    const ruler = await page.$eval('.chime-ruler', el => [...el.children].map(t => {
      const rect=t.getBoundingClientRect();
      return {value:parseFloat(t.textContent), y:rect.top, bottom:rect.bottom};
    }).filter(t => Number.isFinite(t.value)));
    assert.ok(ruler.some(t=>t.value===0) && ruler.some(t=>t.value===total),'刻度须包含始末位置');
    assert.ok(ruler.every(t => t.y >= stage.top - 1 && t.bottom <= stage.bottom + 1), '最长绳长的刻度须全部可见');
    await page.mouse.move(source.x,source.y); await page.mouse.down();
    for (const i of [0,1]) {
      const x = await page.$$eval('.chime-guide',(bs,i) => {const r=bs[i].getBoundingClientRect();return r.left+r.width/2;},i);
      await page.mouse.move(x,stage.y+stage.height*.5,{steps:5}); await frames();
      const readout=await page.$eval('.chime-capacity',b=>({...b.dataset}));
      assert.equal(Number(readout.strand),i+1); assert.equal(Number(readout.total),total);
      assert.ok(Number(readout.projected)>Number(readout.used));
      assert.equal(readout.valid,'true');
      assert.ok(await page.$eval('.chime-drop-marker',b=>!b.hidden));
      const ghost=await page.$eval('.chime-ghost',async b=>{
        await b.decode();
        const item = V3.cabinInventory.data.inventory.found.moon.items.find(it=>it.uid==='craft-10');
        const rect = b.getBoundingClientRect();
        return {matches:b.src===V3.shellIcons.get('moon',{size:b.naturalWidth,pat:item.pat}), visible:rect.width>0&&rect.height>0};
      });
      assert.deepEqual(ghost,{matches:true,visible:true});
    }
    assert.deepEqual(await page.evaluate(s => V3.cabinInventory.data.inventory.chimes[s],slot),saved);
    await photo(`${slot}-${mode}-drag-preview`);
    await material.evaluate(b=>b.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__chimePointer,bubbles:true})));
    await page.mouse.up(); await frames();
    assert.equal(await page.$('.chime-ghost'),null);
    assert.ok(await page.$eval('.chime-drop-marker',b=>b.hidden));
    assert.equal(await page.$eval('.chime-capacity',b=>b.dataset.projected),undefined);
    assert.deepEqual(await page.evaluate(s => V3.cabinInventory.data.inventory.chimes[s],slot),saved);
  }
  async function benchPhotos(slot) {
    for (const [mode,width,height] of [['desktop',1080,760],['mobile',390,844]]) {
      await page.setViewport({width,height}); await frames();
      assert.ok(await page.$eval('.chime-editor', e => e.getBoundingClientRect().right <= innerWidth && e.scrollWidth <= e.clientWidth + 1));
      await photo(`${slot}-${mode}-workbench`);
      await dragPreview(slot, mode);
      if (slot === 'door' && mode === 'desktop' || slot === 'window' && mode === 'mobile') await photo(`${mode}-workbench`);
    }
    await page.setViewport({width:1080,height:760}); await frames();
  }
  for (let i=0;i<5;i++) await hang(i,i,i === 1); await count('door',5); await benchPhotos('door');
  await page.keyboard.press('Escape'); await workbench('window', true);
  assert.equal(await page.$('.chime-pick[data-uid="craft-0"]'), null);
  for (let i=0;i<3;i++) await hang(5+i,i); await count('window',3);
  await benchPhotos('window'); await page.keyboard.press('Escape');
  await page.reload({waitUntil:'load'}); await ready(); await count('door',5); await count('window',3);
  await scenePhoto('door','custom'); await scenePhoto('window','custom');
  assert.deepEqual(await page.evaluate(async () => {
    const I = V3.cabinInventory, window = I.data.inventory.chimes.window;
    return [(await I.perform({op:'sell',id:'locked-sale',uids:['craft-0']})).code,
      (await I.setChime('window',{...window,strands:[[{uid:'craft-0',gap:4}],[],[]]})).code];
  }), ['in_use','in_use']);
  await page.evaluate(() => V3.snackShop.open('sell')); await page.click('.shop-kind[data-kind="scallop"] button');
  assert.ok(await page.$eval('.shop-kind[data-kind="scallop"] .shop-shell.locked', e => e.querySelector('input').disabled && e.textContent.includes('挂在门上的风铃')));
  await page.keyboard.press('Escape');
  step = '工作台点挂件和空白处试听';
  await workbench('door'); await hang(8,0); await count('door',6); await frames();
  const points = await page.evaluate(() => {
    const play = V3.chimes.preview; window.__auditions = [];
    V3.chimes.preview = notes => { window.__auditions.push(notes.map(b => b.uid)); play(notes); };
    const stage = document.querySelector('.chime-stage');
    const labels = [...stage.querySelectorAll('.chime-guide')].map(el => el.getBoundingClientRect());
    const scale = (labels[1].x - labels[0].x) / .18, x = labels[0].x + labels[0].width / 2;
    const bar = labels[0].y - parseFloat(getComputedStyle(stage).getPropertyValue('--chime-guide-height'));
    const line = V3.chimeCraft.layout('door', V3.cabinInventory.data.inventory.chimes.door)[0];
    const shell = line.items.find(b => b.uid === 'craft-0');
    return { shell:[x, bar + (.037 + (shell.top + shell.bottom) / 200) * scale],
      blank:[x,bar + (.037 + (line.items[0].bottom + line.items[1].top) / 200) * scale], row:line.items.map(b => b.uid) };
  });
  for (const [name,point] of [['单枚',points.shell],['两枚之间的绳段',points.blank]]) {
    step = `试听${name}`;
    assert.equal(await page.evaluate(([x,y]) => document.elementFromPoint(x,y)?.tagName, point), 'CANVAS', step);
    await page.mouse.click(...point); await frames();
  }
  assert.deepEqual(await page.evaluate(() => window.__auditions), [['craft-0'],points.row]);
  assert.equal(await page.evaluate(() => V3.cabinInventory.data.inventory.chimes.door.strands.flat().length), 6);
  await page.keyboard.press('Escape');
  const peak = await page.evaluate(async () => {
    const c = new OfflineAudioContext(2,44100,44100);
    for (const pan of [-.35,.35]) for (const voice of ['metal','glass','shell']) {
      V3.chimes.materialHit(c,.01,{chime:voice,size:95},1,pan);
    }
    const out = await c.startRendering(); let max = 0;
    for (let i = 0; i < out.numberOfChannels; i++) for (const x of out.getChannelData(i)) max = Math.max(max,Math.abs(x));
    return max;
  });
  assert.ok(peak > .5 && peak <= .72, `两处同时敲响的峰值 ${peak}`);
  for (const slot of ['door','window']) { await workbench(slot); await click('.chime-editor button','全部取下'); await count(slot,0); await page.keyboard.press('Escape'); }
  assert.ok(await page.evaluate(() => ['house2:chime','house2:chimeWindow'].every(n => {
    const o = V3.models.current().root.getObjectByName(n); return o.getObjectByName('s0').visible && !o.getObjectByName('chime:craft');
  }) && V3.cabinInventory.available('scallop').some(b => b.uid === 'craft-0')));
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.__errors), []);
  console.log('PASS 两个入口、拖挂、刷新、锁定、恢复原款；两个位置的近景与桌面、手机工作台截图在 ' + dir);
} catch (error) {
  const state = await page?.evaluate(() => ({ tap: window.__craftTap, title: document.querySelector('.chime-editor')?.getAttribute('aria-label'),
    count: document.querySelector('.chime-editor .tray-count')?.textContent, saved: window.V3?.cabinInventory?.data?.inventory?.chimes,
    errors: window.__errors?.slice(-3) })).catch(() => null);
  console.error(step, JSON.stringify({ state, errors }, null, 2)); throw error;
} finally { await browser?.close(); await server.close(); }
