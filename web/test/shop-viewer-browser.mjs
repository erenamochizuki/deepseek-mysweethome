import assert from 'node:assert/strict';
import path from 'node:path';
import {launchBrowser,serveFiles,WEB_DIR} from '../tools/mc-lib.mjs';

const server=await serveFiles({'/home.html':path.join(WEB_DIR,'dist/home.html')});let browser;
try {
  browser=await launchBrowser({width:1060,height:790,gpu:'swiftshader'});
  const page=await browser.newPage(), errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.url+'/home.html?auto=0&time=morning&wx=clear');
  await page.waitForFunction(()=>window.__READY && V3.cabinInventory.ready && V3.hud.mounted,{timeout:120000});
  const click=selector=>page.$eval(selector,button=>button.click());
  await click('.hud-shop');assert.equal(await page.$$eval('.shop-pic[aria-haspopup=dialog]',nodes=>nodes.length),34);
  assert.ok(await page.$$eval('.shop-pic',buttons=>buttons.every(button=>!button.textContent && !button.title && button.getAttribute('aria-label') && getComputedStyle(button).cursor==='zoom-in')));
  assert.equal(await page.$eval('.shop .hud-card-head',node=>getComputedStyle(node).backgroundColor),'rgb(49, 93, 80)');
  const inventory=()=>page.evaluate(()=>JSON.stringify(V3.game.inventory())); const before=await inventory();
  await page.evaluate(()=>{
    const prototype=THREE.OrthographicCamera.prototype, update=prototype.updateProjectionMatrix;
    prototype.updateProjectionMatrix=function(){if(this.near===.001 && this.far===20)window.previewCamera=this;return update.call(this);};
  });
  const snapshot=()=>page.evaluate(async()=>{
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
    const camera=window.previewCamera;return JSON.stringify([camera.position.toArray(),camera.top]);
  });
  await click('[data-shelf=sweet]');const opener='[data-sku=berry_star] .shop-pic';await page.click(opener);
  const canvas=await page.waitForSelector('.shop-view-stage canvas');
  assert.deepEqual(await page.$$eval('.shop-viewer button',buttons=>buttons.map(button=>button.textContent)),['×']);
  assert.equal(await page.$('.shop-view-actions,.shop-view-hint'),null);
  assert.doesNotMatch(await page.$eval('.shop-viewer',node=>node.textContent),/观赏/);
  const initial=await snapshot();await new Promise(resolve=>setTimeout(resolve,350));assert.notEqual(await snapshot(),initial);
  const box=await canvas.boundingBox(), middle=box.x+box.width/2, center=box.y+box.height/2;
  await page.mouse.move(middle,center);await page.mouse.down();await page.mouse.move(middle+65,center+20,{steps:3});
  const paused=await snapshot();await new Promise(resolve=>setTimeout(resolve,150));assert.equal(await snapshot(),paused);
  await page.mouse.wheel({deltaY:-420});assert.notEqual(await snapshot(),paused);await page.mouse.up();
  const released=await snapshot();await new Promise(resolve=>setTimeout(resolve,350));assert.notEqual(await snapshot(),released);
  await page.mouse.click(5,5);assert.equal(await page.$('dialog[open]'),null);assert.equal(await page.evaluate(selector=>document.activeElement.matches(selector),opener),true);
  assert.equal(await page.$eval('[data-shelf=sweet]',button=>button.getAttribute('aria-pressed')),'true');
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await click('[data-shelf=drink]');
  await page.evaluate(()=>{window.previewCamera=null;});await click('[data-sku=osmanthus_oolong] .shop-peek-name');
  const teaPosition=await snapshot();await new Promise(resolve=>setTimeout(resolve,350));assert.equal(await snapshot(),teaPosition);
  if(process.argv[2])await (await page.$('.shop-viewer')).screenshot({path:path.resolve(process.argv[2])});
  await click('.shop-view-back');assert.equal(await inventory(),before);
  await click('.shop .hud-x');await page.evaluate(async()=>{await V3.cabinInventory.devCoins(10);await V3.cabinInventory.perform({op:'buy',id:'preview-berries',sku:'blueberry',qty:1});});
  await click('.hud-snack');const berry='.snk-item[aria-label="蓝莓"]';
  const full=await page.$eval(berry+' img',image=>image.src);await page.focus(berry);await page.keyboard.press('Enter');
  await page.waitForFunction(()=>V3.game.inventory().snacks.find(item=>item.sku==='blueberry')?.left===11);
  await page.waitForFunction((selector,initial)=>document.querySelector(selector+' img')?.src!==initial,{},berry,full);
  await page.reload();await page.waitForFunction(()=>window.__READY && V3.cabinInventory.ready && V3.hud.mounted,{timeout:120000});await click('.hud-snack');
  assert.notEqual(await page.$eval(berry+' img',image=>image.src),full);assert.equal(await page.$eval(berry+' .snk-left',node=>node.textContent),'11 颗');
  const plates=await page.evaluate(()=>{
    const models=V3.snackModels;
    for(const item of V3.snackCatalog.list.filter(entry=>entry.pack!=='cup')){
      const vertices=left=>models.pack(item.sku,left).children[0].geometry.attributes.position.count;
      if(vertices()!==vertices(item.count))throw Error('Full stock mismatch: '+item.sku);
      for(let left=1;left<item.count;left++)if(vertices(left)<=vertices(left-1))throw Error('Missing serving: '+item.sku+' '+left);
      if(models.icon(item.sku,{size:56})===models.icon(item.sku,{size:56,left:1}))throw Error('Stale thumbnail: '+item.sku);
    }
    return [12,6,1].map(left=>({left,src:models.icon('blueberry',{size:260,left})}));
  });assert.equal(new Set(plates.map(item=>item.src)).size,3);
  if(process.argv[3]){
    const sheet=await browser.newPage();await sheet.setViewport({width:780,height:298});await sheet.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#f5efdf;color:#315d50;font:18px 'Microsoft YaHei',sans-serif}header{padding:12px 24px;background:#315d50;color:#fff9ed;font:700 24px SimSun,serif}main{display:flex;padding:13px 16px;gap:10px}figure{margin:0;flex:1;border:1px solid #d7cbb6;background:#fffbf1;border-radius:8px;text-align:center;padding:4px 0 9px}img{width:100%;height:172px;object-fit:contain}figcaption{font-weight:700}</style><header>零食篮里的蓝莓</header><main>${plates.map(item=>`<figure><img src="${item.src}"><figcaption>剩 ${item.left} 颗</figcaption></figure>`).join('')}</main>`);
    await sheet.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));await sheet.screenshot({path:path.resolve(process.argv[3])});await sheet.close();
  }
  await page.setViewport({width:375,height:667,isMobile:true,hasTouch:true});
  await page.goto(server.url+'/home.html?auto=0&time=morning&wx=clear');
  await page.waitForFunction(()=>window.__READY && V3.cabinInventory.ready && V3.hud.mounted,{timeout:120000});
  await page.tap('.hud-shop');await page.tap('[data-shelf=drink]');await page.tap('[data-sku=osmanthus_oolong] .shop-pic');
  assert.ok(await page.$eval('.shop-viewer',node=>node.getBoundingClientRect().width<=375 && node.scrollWidth===node.clientWidth));
  await page.tap('.shop-view-back');
  await click('[data-sku=matcha] .shop-pic');await page.evaluate(()=>V3.snackShop.close());assert.equal(await page.$('.shop-viewer'),null);
  assert.deepEqual(errors,[]);console.log('PASS: minimal viewer, backdrop and X, automatic spin, drag and wheel; actual berry feeding survives reload; remaining portions and thumbnails across all solid foods');
} finally {await browser?.close();await server.close();}
