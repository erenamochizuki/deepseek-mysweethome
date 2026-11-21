// 在临时浏览器和随机本地端口串两件风铃。朝海小窗的近景同时拍到空窗台。
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';

const server = await serveFiles({ '/cabin.html': path.join(WEB_DIR, 'dist', 'cabin.html') });
const dir = path.join(WEB_DIR, 'shots', 'chime-craft');
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
  const seeded = await page.evaluate(async () => {
    const I = V3.cabinInventory; if (I.remote || I.data.inventory.chimes.door.rev) throw Error('需要独立的新本地存档');
    const results = [];
    for (const [i, kind] of ['scallop','cowrie','starfish','mussel','moon','nassa','miter','pearl','clam','conch','moon'].entries()) {
      const k = V3.game.kind(kind);
      results.push((await I.perform({ op: 'collect', id: `craft-${i}`, kind, category: 'collectible', at: 1,
        size: k.size * (i === 0 ? 1300 : 1000), pat: ['sunset','iris','plain','mist'][i % 4] })).ok);
    }
    return results;
  });
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
  async function workbench(slot, fromScene = false) {
    step = `打开 ${slot} 工作台`;
    if (fromScene) {
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
      await page.click('.chime-menu');
    } else {
      await page.evaluate(() => V3.collection.open()); await click('.col-tray','风铃 ›');
      await click('.chime-places button', slot === 'door' ? '门上的风铃' : '窗边的风铃');
    }
    await page.waitForSelector('.chime-stage canvas');
    assert.equal(await page.$eval('.chime-editor', e => e.getAttribute('aria-label')), slot === 'door' ? '门上的风铃' : '窗边的风铃'); await frames();
  }
  async function hang(uid, line, finishFirstSave = false) {
    step = `拖 craft-${uid} 到第 ${line + 1} 串`;
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
  await scenePhoto('door','default'); await scenePhoto('window','default');
  await workbench('door', true);
  // 控制首次存档的完成时机，确保真正松手前经过一次自动存档；仍用正式接口写入。
  await page.evaluate(() => {
    const I = V3.cabinInventory, save = I.setChime, wait = new Promise(resolve => { window.__finishFirstSave = resolve; });
    I.setChime = async (...args) => { I.setChime = save; await wait; return save(...args); };
  });
  async function benchPhotos(slot) {
    for (const [mode,width,height] of [['desktop',1080,760],['mobile',390,844]]) {
      await page.setViewport({width,height}); await frames();
      assert.ok(await page.$eval('.chime-editor', e => e.getBoundingClientRect().right <= innerWidth && e.scrollWidth <= e.clientWidth + 1));
      await photo(`${slot}-${mode}-workbench`);
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
