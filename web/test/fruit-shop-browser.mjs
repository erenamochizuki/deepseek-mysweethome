import assert from 'node:assert/strict';
import path from 'node:path';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';

const fresh = ['strawberry', 'mandarin', 'apple', 'kiwi', 'watermelon', 'mango'];
const server = await serveFiles({ '/cabin.html': path.join(WEB_DIR, 'dist/cabin.html') });
let browser;
try {
  browser = await launchBrowser({ width: 1024, height: 760, gpu: 'swiftshader' });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => window.__READY && V3.cabinInventory.ready && V3.hud.mounted, { timeout: 120000 });
  const click = selector => page.$eval(selector, button => button.click());
  const stock = () => page.$$eval('.shop-item', items => items.map(item => item.dataset.sku));
  await page.goto(server.url + '/cabin.html?auto=0&wx=clear&time=morning'); await ready();
  await click('.hud-shop');
  assert.equal((await stock()).length, 32);
  assert.deepEqual(await page.$$eval('.shop-filters button', buttons => buttons.map(button => button.textContent)), ['全部商品 · 32', '新鲜水果 · 8', '咸点与轻食 · 8','甜点 · 8','饮品 · 8']);
  const listings={savory:['nori','bread','chips','fish_cracker','onigiri','pretzel','sandwich','dried_fish'],sweet:['cake','honey','cookie','marshmallow','pudding','madeleine','donut','berry_star'],drink:['cocoa','milk','lemonade','barley_tea','matcha','peach_yogurt','sea_soda','osmanthus_oolong']};
  for(const [key,skus] of Object.entries(listings)) {
    await click(`[data-shelf="${key}"]`); assert.deepEqual(await stock(),skus);
    assert.ok(await page.$$eval('.shop-pic img',async images => {await Promise.all(images.map(image=>image.decode())); return images.length===8 && images.every(image=>image.naturalWidth>1);}));
  }
  await page.focus('[data-shelf="fruit"]'); await page.keyboard.press('Enter');
  assert.deepEqual(await stock(), ['blueberry', ...fresh, 'durian']);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('.shop-go', button => button.disabled), true);
  await click('[data-shelf="all"]'); assert.equal((await stock()).length, 32);
  await click('[data-shelf="fruit"]');
  await page.evaluate(() => V3.cabinInventory.devCoins(50));
  for (const sku of fresh) {
    const item = `.shop-item[data-sku="${sku}"]`;
    await click(item + ' .shop-go'); await page.waitForSelector(item + ' .shop-have');
  }
  const basket = () => page.evaluate(() => V3.game.inventory().snacks.map(item => [item.sku, item.left]));
  const servings = await basket();
  assert.deepEqual(servings.map(([sku]) => sku), fresh);
  assert.equal(await page.evaluate(() => V3.game.inventory().coins), 25);
  await click('.shop .hud-x'); await click('.hud-snack');
  assert.equal(await page.$$eval('.snk-item', items => items.length), 6);
  await page.focus('.snk-item[aria-label="蜜橘"]'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => V3.game.inventory().snacks.find(item => item.sku === 'mandarin').left === 7);
  const afterFeeding = await basket();
  await page.reload(); await ready(); assert.deepEqual(await basket(), afterFeeding);
  assert.equal(await page.evaluate(() => V3.game.inventory().coins), 25);
  const arrivals=[['fruit','durian',3],['savory','dried_fish',6],['sweet','berry_star',4],['drink','osmanthus_oolong',3]];
  await click('.hud-shop');
  for(const [shelf,sku] of arrivals){
    await click(`[data-shelf="${shelf}"]`);const row=`.shop-item[data-sku="${sku}"]`;
    await click(row+' .shop-go'); await page.waitForSelector(row+' .shop-have');
  }
  assert.deepEqual((await basket()).slice(-4),arrivals.map(([,sku,count])=>[sku,count]));
  assert.equal(await page.evaluate(()=>V3.game.inventory().coins),5);
  await click('.shop .hud-x'); await click('.hud-snack');
  await page.focus('.snk-item[aria-label="桂花乌龙"]'); await page.keyboard.press('Enter');
  await page.waitForFunction(()=>V3.game.inventory().snacks.find(item=>item.sku==='osmanthus_oolong').left===2);

  const images = await page.evaluate(async skus => {
    async function portrait(sku, what) {
      const image = new Image(); image.src = V3.snackModels.icon(sku, { what, size: 320 }); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const brush = canvas.getContext('2d', { willReadFrequently: true }); brush.drawImage(image, 0, 0);
      const pixels = brush.getImageData(0, 0, canvas.width, canvas.height).data;
      let left = image.width, top = image.height, right = -1, bottom = -1;
      for (let row = 0; row < image.height; row++) for (let col = 0; col < image.width; col++) if (pixels[(row * image.width + col) * 4 + 3] > 20) {
        left = Math.min(left, col); right = Math.max(right, col); top = Math.min(top, row); bottom = Math.max(bottom, row);
      }
      if (right - left < 32 || bottom - top < 22) throw Error('Missing fruit portrait: ' + sku + '/' + what);
      canvas.width = right - left + 5; canvas.height = bottom - top + 5;
      brush.drawImage(image, -left + 2, -top + 2); return canvas.toDataURL();
    }
    const plates = [];
    for (const sku of skus) {
      const { name, count, unit, price, colors } = V3.snackCatalog.get(sku);
      if (V3.snackModels.held(sku, count)?.name !== 'snack-piece:' + sku) throw Error('Missing held fruit: ' + sku);
      plates.push({ name, count, unit, price, color: '#' + colors[2].toString(16).padStart(6, '0'), pack: await portrait(sku, 'pack'), piece: await portrait(sku, 'piece') });
    }
    return plates;
  }, fresh);
  assert.equal(new Set(images.flatMap(item => [item.pack, item.piece])).size, fresh.length * 2);
  const expandedModels=await page.evaluate(async()=>{
    const visual=async(sku,opt)=>{const image=new Image();image.src=V3.snackModels.icon(sku,{...opt,size:96}); await image.decode(); if(image.width<2)throw Error('Missing rendering: '+sku);return image.src;};
    for(const sku of ['pretzel','sandwich','madeleine','donut','durian','dried_fish','berry_star']) if(await visual(sku,{what:'piece'})===await visual(sku,{what:'pack'}))return false;
    for(const sku of ['matcha','barley_tea','peach_yogurt','sea_soda','osmanthus_oolong']) if(new Set(await Promise.all([0,1,2,3].map(left=>visual(sku,{left})))).size!==4)return false;
    return true;
  }); assert.equal(expandedModels,true);
  if(process.argv[2]==='--menu') {
    const { menuPhoto }=await import('../tools/lib/shop-menu-photo.mjs'); await menuPhoto(page,browser,path.resolve(process.argv[3]));
  } else if (process.argv[2]) {
    const { photograph } = await import('../tools/lib/fruit-stall-photo.mjs');
    await photograph(browser, images, path.resolve(process.argv[2]));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: 32 products, four shelves of eight, new arrivals purchased, keyboard feeding, saved basket, food portraits and four tea levels');
} finally { await browser?.close(); await server.close(); }
