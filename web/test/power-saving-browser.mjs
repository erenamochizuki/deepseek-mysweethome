import assert from 'node:assert/strict';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {BASE_ARGS, GPU, WEB_DIR, findEdge, serveFiles} from '../tools/mc-lib.mjs';

const build = process.env.CABIN_BUILD_DIR || path.join(WEB_DIR,'dist');
const server = await serveFiles({'/cabin.html':path.join(build,'cabin.html')});
let browser;
try {
  // Desktop Edge puts both tabs in one window and delivers real visibility changes.
  // Restore the browser's usual background timer policy for this test.
  browser = await puppeteer.launch({
    executablePath:findEdge(), headless:false,
    args:[...BASE_ARGS,...GPU.swiftshader,'--window-position=-3000,-3000','--window-size=840,660','--disable-features=CalculateNativeWinOcclusion'],
    ignoreDefaultArgs:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
    defaultViewport:{width:800,height:600},protocolTimeout:120000,
  });
  const cabin = (await browser.pages())[0], other = await browser.newPage(), errors = [];
  cabin.on('pageerror',error=>errors.push(error.message));
  const ready = () => cabin.waitForFunction(()=>window.__READY && V3.actor && V3.shallows?.state && V3.game.started,{timeout:90000});
  const foreground = async tab => {
    await tab.bringToFront();
    await cabin.waitForFunction(hidden=>document.hidden===hidden,{polling:100,timeout:5000},tab!==cabin);
  };
  const openSettings = async (page=cabin) => {
    await page.locator('.hud-settings').click();
    await page.locator('.set-tab[data-tab="运行"]').click();
  };
  const read = () => cabin.evaluate(()=>({
    hidden:document.hidden,time:V3.R.t,fish:V3.shallows.state.fish.position.toArray(),wall:performance.now()/1000,
  }));
  await foreground(cabin);
  await cabin.goto(server.url+'/cabin.html?auto=0&time=12:00&wx=clear');
  await ready();
  await openSettings();
  const checkbox = '#set-powerSaving';
  const toggle = page => page.locator('label[data-key="powerSaving"]').click();
  assert.equal(await cabin.$eval(checkbox,e=>e.checked),true);
  await foreground(other);
  const paused = await read();
  await delay(2000);
  const still = await read();
  assert.equal(still.time,paused.time,'默认节能模式下后台场景应暂停');
  assert.deepEqual(still.fish,paused.fish);
  await foreground(cabin);
  await cabin.waitForFunction(t=>V3.R.t>t,{},still.time);
  // Repeat toggles, ending off. Dropping a pending timer or a pending rAF is critical.
  for (let i=0;i<3;i++) await toggle(cabin);
  assert.equal(await cabin.$eval(checkbox,e=>e.checked),false);
  await cabin.click('.set .hud-x');
  await foreground(other);
  const start = await read();
  assert.equal(start.hidden,true);
  assert.equal(await cabin.evaluate(()=>V3.actor.startBehavior('read',{interrupt:true,seconds:40})),true,'后台可以开始阅读');
  await cabin.waitForFunction(t=>V3.R.t>=t+2,{polling:200,timeout:12000},start.time);
  const running = await read();
  assert.equal(running.hidden,true);
  assert.notDeepEqual(start.fish,running.fish,'鱼在实际隐藏的页面中应游动');
  assert.ok(running.time-start.time<=running.wall-start.wall+1.3,'反复切换后避免重复推进');
  assert.equal(await cabin.evaluate(()=>V3.actor.behavior?.kind),'read');
  await foreground(cabin);
  await cabin.waitForFunction(t=>V3.R.t>t,{},running.time);
  await cabin.reload({waitUntil:'load'});await ready();await openSettings();
  assert.equal(await cabin.$eval(checkbox,e=>e.checked),false,'刷新后仍保留关闭节能模式的选择');
  await toggle(cabin);await foreground(other);
  const again = await read();
  await delay(2000);
  assert.equal((await read()).time,again.time,'重新启用节能应停止后台推进');
  await other.goto(cabin.url());await other.waitForFunction(()=>window.__READY && V3.game.started);
  await openSettings(other);await toggle(other);
  await cabin.waitForFunction(t=>!V3.game.get('powerSaving') && V3.R.t>t+.5,{polling:200,timeout:12000},again.time);
  assert.equal(await cabin.$eval(checkbox,e=>e.checked),false,'另一标签页修改节能后，已打开的设置面板同步');
  assert.deepEqual(errors,[]);
  console.log('PASS: actual hidden-tab pause/resume, background swimming and reading, repeated toggles, preference after reload',
    JSON.stringify({hiddenSeconds:running.wall-start.wall,simulatedSeconds:running.time-start.time}));
} finally {
  await browser?.close();await server.close();
}
