// A shared camera scale must preserve actual fish growth in the standalone file, even after orbiting.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchBrowser,WEB_DIR} from '../tools/mc-lib.mjs';
import {decodePNG} from '../tools/girl/png.mjs';

const browser=await launchBrowser({width:1100,height:740,gpu:'swiftshader'});
try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.goto(pathToFileURL(path.join(WEB_DIR,'dist/shore-showcase.html')).href);
  await page.waitForSelector('#model canvas');
  const tick=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const image=async()=>{await tick();return decodePNG(Buffer.from(await (await page.$('#model canvas')).screenshot()));};
  const dims=({w,h,rgba})=>{let left=w,right=-1,top=h,bottom=-1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=4*(y*w+x);if(Math.abs(rgba[i]-rgba[0])+Math.abs(rgba[i+1]-rgba[1])+Math.abs(rgba[i+2]-rgba[2])>35){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
    assert.ok(left>0&&right<w-1&&top>0&&bottom<h-1);return Math.max(0,right-left+1);};
  async function visibleImage(){for(let i=0;i<12;i++){const frame=await image();if(dims(frame)>20)return frame;}throw Error('empty exhibit canvas');}
  const change=async i=>{await page.$$eval('#choices button',(buttons,i)=>buttons[i].click(),i);};
  for(const [width,height] of [[1100,740],[390,844]]) {
    await page.setViewport({width,height});await page.click('#fish');await change(0);const baby=dims(await visibleImage());
    await change(5);const mature=await visibleImage(),adult=dims(mature);assert.ok(adult>baby*1.25,`${width}: baby ${baby}px, mature ${adult}px`);
    await page.focus('#model canvas');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');const turned=await image();
    let diff=0;for(let i=0;i<mature.rgba.length;i+=4)if(Math.abs(mature.rgba[i]-turned.rgba[i])+Math.abs(mature.rgba[i+1]-turned.rgba[i+1])>28)diff++;
    assert.ok(diff>100);await page.screenshot({path:path.join(WEB_DIR,'shots',`islet-exhibit-${width}.png`)});
    await page.click('#finds');const opts=await page.$$eval('#choices option',os=>os.map(o=>[o.value,o.textContent.split(' · ')[1]]));
    assert.equal(opts.length,10);for(const [value,label] of opts){await page.select('#choices select',value);assert.equal(await page.$eval('#name',x=>x.textContent),label);await visibleImage();}
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log(`${width}×${height}: projected width ${baby} → ${adult}px, ${diff} pixels changed on turn; all ten finds selectable`);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__errors),[]);
} finally {await browser.close();}
