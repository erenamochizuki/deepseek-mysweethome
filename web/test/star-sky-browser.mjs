// 临时浏览器档案和本地单文件小屋。运行 npm run test:star-sky。
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { WEB_DIR, launchBrowser, serveFiles } from '../tools/mc-lib.mjs';

const out=path.join(WEB_DIR,'shots/star-sky');
const server=await serveFiles({'/cabin.html':path.join(WEB_DIR,'dist/cabin.html')});
let browser;
try {
  await mkdir(out,{recursive:true});
  browser=await launchBrowser({width:1280,height:800,args:process.argv.includes('--isolated-runner') ? ['--no-sandbox'] : []});
  const context=await browser.createBrowserContext(), errors=[];
  async function start(date, viewport) {
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('console',msg=>{if(msg.text().includes('Shader Error')) errors.push(msg.text());});
    if(viewport) await page.setViewport(viewport);
    await page.goto(`${server.url}/cabin.html?wx=clear&time=22:00&date=${date}&live=0`,{waitUntil:'load',timeout:120000});
    await page.waitForFunction(()=>window.__READY && V3.actor && V3.furniturePlay.state().ready,{timeout:120000});
    return page;
  }
  let page=await start('2026-12-01');
  const shot=name=>page.screenshot({path:path.join(out,name+'.png')});
  const settle=()=>page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,950)));
  const crop=async(selector,name)=>{const item=await page.$(selector);await item.screenshot({path:path.join(out,name+'.png')});await item.dispose();};
  async function scope() {
    const ok=await page.evaluate(()=>{
      const scope=V3.furniturePlay.state().items.find(r=>r.kind==='telescope');
      V3.actor.cancelBehavior('test'); V3.viewTokens.girl('idle');
      V3.actor.place?.(scope.cell[0]+.5,scope.cell[2]+1.6,0,scope.cell[1]);
      return V3.furniturePlay.activate({obj:{userData:{furnitureKey:scope.key}}}) && V3.starView.isOpen;
    });
    assert.ok(ok,'从阁楼望远镜进入');
    await page.waitForSelector('.star-view[open]');
  }
  const camera=()=>page.evaluate(()=>V3.R.camera.position.toArray().concat(V3.R.ctl.target.toArray()));
  const focus=async id=>{
    const press=selector=>page.viewport().hasTouch ? page.tap(selector) : page.click(selector);
    await press('.sv-index summary');await press(`[data-sky="${id}"]`);await settle();
  };
  const pixels=()=>page.$eval('.star-view canvas',cv=>{
    const data=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    let bright=0;
    for(let i=0;i<data.length;i+=4) {
      if(data[i]>100 && data[i+1]>100) bright++;
    }
    return {bright};
  });
  // 只看描线画布。记录每次实际落笔的宽度与节点星的半径、颜色。
  const watchInk=()=>page.$eval('.sv-ink',cv=>{
    const ctx=cv.getContext('2d'),state=window.inkSample={frames:0,stars:[],widths:[]};
    for(const name of ['clearRect','arc','stroke']) {
      const original=ctx[name].bind(ctx);
      ctx[name]=(...args)=>{
        if(name==='clearRect') {state.frames++;state.stars=[];state.widths=[];}
        if(name==='arc') state.stars.push([args[2],ctx.fillStyle,args[0],args[1]]);
        if(name==='stroke') state.widths.push(ctx.lineWidth);
        return original(...args);
      };
    }
  });
  const targetPoint=()=>page.evaluate(()=>{
    const stars=inkSample.stars.filter(([, ,x,y])=>x>15 && x<innerWidth-15 && y>175 && y<innerHeight-65);
    const cx=stars.reduce((n,s)=>n+s[2],0)/stars.length,cy=stars.reduce((n,s)=>n+s[3],0)/stars.length;
    for(let r=0;r<65;r+=5) for(let i=0;i<8;i++) {
      const x=Math.round(cx+r*Math.cos(i*Math.PI/4)),y=Math.round(cy+r*Math.sin(i*Math.PI/4));
      if(stars.every(s=>Math.hypot(s[2]-x,s[3]-y)>18))return {x,y};
    }
    throw Error('找不到与恒星卡分开的点选位置');
  });
  await page.evaluate(async()=>{
    V3.R.setView({pos:[-16,5,24],target:[-4,15,-7],fov:45}); await V3.nextFrames(4);
    if(!V3.sky.live.points.visible || !V3.sky.live.points.geometry.attributes.mag) throw Error('屋外星表未绘制');
  });
  await shot('01-outdoors');const before=await camera();
  await scope();await page.hover('.star-view header button');await page.waitForSelector('.sv-label',{hidden:true});await shot('02-winter');
  assert.ok((await pixels()).bright>30,'冬夜星图有可见星点');
  await crop('.sv-compass','08-compass-desktop');
  const seaTop=await page.$eval('.sv-sea',cv=>cv.getBoundingClientRect().top);
  await page.screenshot({path:path.join(out,'10-winter-reflections.png'),clip:{x:40,y:seaTop-155,width:535,height:282}});
  const seaPixels=()=>page.$eval('.sv-sea',cv=>cv.toDataURL());
  const tide=await seaPixels();await settle();assert.ok(await seaPixels()!==tide,'只有海面随波光变动');
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await settle();
  const quiet=await seaPixels();await settle();assert.ok(await seaPixels()===quiet,'减少动态时海面静止');
  await page.emulateMediaFeatures([]);
  assert.match(await page.$eval('.sv-compass',e=>e.textContent),/东南 · 仰角 24°/);
  const toggle='.sv-switch input';assert.equal(await page.$eval(toggle,e=>e.checked),false);
  const chartPixels=()=>page.$eval('.sv-ink',cv=>{
    const data=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    let drawn=0;for(let i=3;i<data.length;i+=4) if(data[i]>8) drawn++;
    return drawn;
  });
  assert.equal(await chartPixels(),0);
  await page.click(toggle);await page.evaluate(()=>V3.nextFrames(2));await shot('07-winter-lines');
  assert.ok(await chartPixels()>1000,'冬夜全图有可见的连线');
  const chartNames=await page.$$eval('.sv-chart-names span',els=>els.map(e=>({name:e.textContent,...e.getBoundingClientRect().toJSON()})));
  assert.ok(chartNames.length>=6,'冬夜有多个星座名');
  for(const a of chartNames) for(const b of chartNames) if(a!==b) assert.ok(a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top,`${a.name} 避开 ${b.name}`);
  await page.click(toggle);await page.evaluate(()=>V3.nextFrames(2));
  assert.equal(await chartPixels(),0,'关闭后清空所有线条');
  await page.click('.sv-compass');await settle();assert.match(await page.$eval('.sv-compass',e=>e.textContent),/^北 · 仰角 24°/);
  await watchInk();await focus('Ori');const orion=await targetPoint();
  await page.mouse.move(orion.x,orion.y);await page.hover('.star-view header button');await settle();
  // 截图可能比整段动画还慢。逐帧推进这一次悬停排出的回调，截到的就是游戏自己画的中间帧。
  const mid=await page.evaluate(({x,y})=>{
    const cv=document.querySelector('.star-view canvas'), raf=window.requestAnimationFrame;
    let next, time=performance.now()-1000;
    function hold(fn) {
      window.requestAnimationFrame=callback=>{next=callback;return -1;};
      try {fn();} finally {window.requestAnimationFrame=raf;}
    }
    window.stepSky=ms=>{time+=ms;const fn=next;next=null;if(fn) hold(()=>fn(time));return !!next;};
    hold(()=>cv.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,pointerType:'mouse'})));
    stepSky(0);stepSky(55);stepSky(265);return inkSample.stars.length;
  },orion);
  assert.ok(mid>0,'描线中途已点亮起笔的星');await shot('06-orion-tracing');
  assert.equal(await page.evaluate(()=>stepSky(400)),false,'描完就停止动画回调');
  const finished=await page.evaluate(()=>{
    const c=V3.stars.atlas.find(c=>c.id==='Ori');
    return {stars:inkSample.stars.map(p=>p.slice(0,2)),expected:[...new Set(c.lines.flat())].map(hr=>{
      const s=V3.stars.byHR.get(hr);return [V3.starLines.size(s.mag).lit,s.color];
    })};
  });
  assert.ok(mid<finished.stars.length,'其余节点在后半段才亮起');
  assert.deepEqual(finished.stars.sort(),finished.expected.sort(),'每颗猎户座节点都放大到相应半径并保留星色');
  await page.mouse.move(orion.x,orion.y);await page.waitForSelector('.sv-label:not([hidden])');
  assert.equal(await page.$eval('.sv-label i',e=>e.textContent),'Orion');
  await shot('03-orion'); await page.mouse.click(orion.x,orion.y);
  assert.match(await page.$eval('.star-view article',e=>e.textContent),/Orion/);
  await page.hover('.star-view header button');await page.waitForSelector('.sv-label',{hidden:true});
  assert.equal(await chartPixels(),0,'移开后星点和连线都淡去');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!V3.starView.isOpen);
  assert.deepEqual(await camera(),before,'回到原镜头');
  await page.evaluate(()=>V3.env.setTime('2026-07-15 22:00'));await scope();await focus('Cyg');
  await shot('04-summer');
  const canvas=await page.$('.star-view canvas');
  await page.setViewport({width:390,height:844});
  await page.waitForFunction(cv=>cv.isConnected && cv.width===390 && cv.height===844 && V3.starView.isOpen,{},canvas);
  await canvas.dispose();await page.close();
  // 切换 isMobile / hasTouch 会让 Puppeteer 重新载入页面；在手机进入小屋前设置。
  page=await start('2026-07-15',{width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await scope();await watchInk();await focus('Cyg');
  await page.evaluate(()=>V3.nextFrames(2));assert.ok((await pixels()).bright>20);
  await crop('.sv-compass','09-compass-mobile');
  const touch=await page.createCDPSession();
  const pan=async(dx)=>{
    for(const [type,x] of [['touchStart',195],['touchMove',195+dx],['touchEnd',0]])
      await touch.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd' ? [] : [{x,y:410,id:0}]});
    await page.evaluate(()=>V3.nextFrames(2));
  };
  const fullCount=await page.evaluate(()=>inkSample.stars.length);
  const outside=()=>page.evaluate(n=>inkSample.stars.length<n || inkSample.stars.some(s=>s[2]>390 || s[2]<0),fullCount);
  for(let i=0;i<4;i++) {
    if(await outside())break;
    await pan(58);
  }
  assert.ok(await outside(),'点选前天鹅座的一翼伸出画面');
  // 天鹅座横跨夏季大三角。先找只属于正式星座的空处，再让触摸独立触发点选。
  const swan=await page.evaluate(async center=>{
    const cv=document.querySelector('.star-view canvas'),label=document.querySelector('.sv-label');
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    for(const r of [0,24,45,68]) for(let i=0;i<(r?8:1);i++) {
      const x=Math.round(center.x+r*Math.cos(i*Math.PI/4)),y=Math.round(center.y+r*Math.sin(i*Math.PI/4));
      if(x<10 || x>innerWidth-10)continue;
      cv.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,pointerType:'mouse'}));await wait(180);
      if(!label.hidden && label.querySelector('strong').textContent==='天鹅座' && label.querySelector('small').hidden) {
        cv.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));await wait(300);return {x,y};
      }
    }
    throw Error('天鹅座可见部分缺少独立点选位置');
  },await targetPoint());
  await page.touchscreen.tap(swan.x,swan.y); await page.waitForSelector('.star-view article:not([hidden])');
  assert.match(await page.$eval('.star-view article',e=>e.textContent),/天鹅座/);
  await page.waitForFunction(()=>inkSample.stars.length>4 && document.querySelector('.sv-label i').textContent==='Cygnus');
  await settle();
  const mobile=await page.evaluate(()=>({w:document.querySelector('.sv-ink').width,widths:inkSample.widths,stars:inkSample.stars}));
  assert.equal(mobile.w,780);assert.ok(mobile.widths.some(w=>Math.abs(w-1.35)<.001),`手机线宽 ${mobile.widths}`);await shot('05-mobile-390');
  const cardTop=await page.$eval('.star-view article',e=>e.getBoundingClientRect().top);
  assert.equal(mobile.stars.length,fullCount,'移回所有可见节点');
  for(const [,,x,y] of mobile.stars) assert.ok(x>=7 && x<=383 && y>=7 && y<cardTop,`手机节点在可见区域内 ${x}, ${y}`);
  for(const [type,xy] of [['touchStart',[[155,422],[235,422]]],['touchMove',[[125,422],[265,422]]],['touchEnd',[]]]) {
    await touch.send('Input.dispatchTouchEvent',{type,touchPoints:xy.map(([x,y],id)=>({x,y,id}))});
  }
  await page.evaluate(()=>V3.nextFrames(2));
  assert.deepEqual(await page.evaluate(()=>inkSample.widths),mobile.widths,'双指缩放保持线宽');
  assert.notDeepEqual(await page.evaluate(()=>inkSample.stars),mobile.stars,'双指确实改变了星点投影');
  assert.match(await page.$eval('.sv-label:not([hidden])',e=>e.textContent),/天鹅座/);
  await touch.detach();
  await page.tap('.sv-sources summary');
  const sourceText=await page.$eval('.sv-sources[open]',e=>e.innerText);
  for(const name of ['BSC5','d3-celestial','Olaf Frohn','BSD-3-Clause']) assert.ok(sourceText.includes(name),name);
  await page.tap('.star-view header button');assert.equal(await page.evaluate(()=>V3.starView.isOpen),false);
  await page.evaluate(()=>V3.env.setTime('12:00'));assert.equal(await page.evaluate(()=>V3.starView.open()),false);
  await page.evaluate(()=>{V3.env.setTime('22:00');V3.env.setWeather('rain');});
  assert.equal(await page.evaluate(()=>V3.starView.open()),false);
  assert.deepEqual(errors,[]); console.log(`通过：冬夏星空、冬夜全图 ${chartNames.length} 个名字互不重叠、罗盘回北、海面波光与减少动态、猎户描线（中途 ${mid} 颗、完成 ${finished.stars.length} 颗）、卡片、原镜头、手机天鹅座 ${mobile.stars.length} 个节点全部入框及双指缩放、白天及雨天入口`);
} finally { try {await browser?.close();} finally {await server.close();} }
