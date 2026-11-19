import assert from 'node:assert/strict';
import path from 'node:path';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';

const server = await serveFiles({ '/cabin.html':path.join(WEB_DIR,'dist/cabin.html') });
let browser;
try {
  browser = await launchBrowser({width:1030,height:780,gpu:'swiftshader'});
  const page = await browser.newPage(), errors = [];
  page.on('pageerror',error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    const now=Date.now; Date.now=()=>Number(sessionStorage.getItem('test-tide-time')) || now();
  });
  const ready=()=>page.waitForFunction(()=>window.__READY && V3.cabinInventory.canShore() && V3.shallows.state.spots.length,{timeout:120000});
  await page.goto(server.url+'/cabin.html?auto=0&wx=clear&time=morning'); await ready();
  const go=selector=>page.$eval(selector,control=>control.click());
  const order=()=>page.$$eval('.shop-kind',groups=>groups.map(group=>group.dataset.kind));
  const chosen=()=>page.evaluate(()=>[...V3.snackShop._picked].sort());
  const group=(kind,control)=>`.shop-kind[data-kind="${kind}"] .shop-${control}`;
  await page.evaluate(async()=>{
    const client=V3.cabinInventory;
    const row=entries=>({first:1,last:1,n:entries.length,items:entries.map(([uid,size,pat='plain'])=>({uid,size,pat,at:1}))});
    await client.devFound({moon:row([['plain',55],['mist',60,'mist'],['white',59,'albino'],['rainbow',58,'iris'],['mini',42],['giant',78],['in-tray',62],['on-loan',59],['on-shelf',63]]),
      scallop:row([['s1',115],['s2',130],['s3',137]]),cowrie:row([['c1',117],['c2',120]]),conch:row([['queen1',150],['queen2',158,'dots'],['queen3',161]]),nautilus:row([['single',150]])});
    for (const command of [ {op:'shore_loan',next:'on-loan',expected:null}, {op:'place',uid:'on-shelf',kind:'moon',slot:'case:1:0',by:'player'},
      {op:'tray_set',base:client.data.inventory.tray.rev,items:[{uid:'in-tray',x:0,z:0,ry:0}],by:'player'} ]) {
      const result=await client.perform({...command,id:client.id(command.op)}); if(!result.ok)throw Error(result.error);
    }
    V3.snackShop.open('sell');
  });
  assert.deepEqual(await order(),['conch','nautilus','cowrie','moon','scallop']);
  await go('.shop-sort'); assert.deepEqual(await order(),['moon','scallop','cowrie','conch','nautilus']);
  await go(group('moon','kind-h')); await go(group('moon','bulk')); assert.deepEqual(await chosen(),['mist','plain']);
  await go(group('nautilus','kind-h')); assert.equal(await page.$eval(group('nautilus','bulk'),button=>button.disabled),true);
  await go(group('conch','kind-h')); await go(group('conch','bulk')); assert.deepEqual(await chosen(),['mist','plain','queen1','queen2']);
  await go('.shop-toggles label:nth-child(1) input'); await go('.shop-toggles label:nth-child(2) input');
  const manualRare=()=>page.$$eval(group('moon','shell'),rows=>rows.find(row=>row.querySelector('.shop-shell-pat').textContent==='虹彩').querySelector('input').click());
  await manualRare();await go(group('moon','bulk'));assert.deepEqual(await chosen(),['queen1','queen2','rainbow']);
  await go(group('moon','bulk'));assert.deepEqual(await chosen(),['mist','plain','queen1','queen2','rainbow']);
  await manualRare();await go(group('conch','bulk'));assert.ok((await chosen()).includes('queen3'));
  await go('.shop-toggles label:nth-child(2) input');assert.deepEqual(await chosen(),['mist','plain','queen1','queen2']);
  const sell='.shop-sellbar .shop-go';
  assert.match(await page.$eval(sell,button=>button.textContent),/4 枚，得 12/);
  await go(sell);assert.match(await page.$eval(sell,button=>button.textContent),/确定卖掉这 4 枚/);
  await go(sell);await page.waitForFunction(()=>V3.game.inventory().coins===12);
  assert.deepEqual(await page.evaluate(()=>V3.game.inventory().found.moon.items.map(item=>item.uid).sort()),['giant','in-tray','mini','on-loan','on-shelf','rainbow','white']);
  assert.deepEqual(await page.evaluate(()=>V3.game.inventory().found.conch.items.map(item=>item.uid)),['queen3']);
  const many=await page.evaluate(async()=>{
    V3.snackShop.close();const client=V3.cabinInventory, count=V3.inventoryRules.SELL_LIMIT+4;
    await client.devFound({limpet:{n:count,first:1,last:1,items:Array.from({length:count},(_,index)=>({uid:'lot-'+index,size:70,pat:'ring',at:1}))}});
    V3.snackShop.open('sell');return count-1;
  });
  await go(group('limpet','kind-h'));await go(group('limpet','bulk'));assert.equal((await chosen()).length,many);
  await go(sell);await go(sell);await page.waitForFunction(count=>V3.game.inventory().coins===12+count,{},many);
  assert.equal(await page.evaluate(()=>V3.game.inventory().found.limpet.n),1);await page.evaluate(()=>V3.snackShop.close());

  const shift=async(kind,form)=>page.evaluate(([kind,form])=>{
    const rules=V3.inventoryRules, start=rules.encounter(Date.now())+1;
    for(let epoch=start;epoch<start+8000;epoch++) {
      if ((rules.fishAt(epoch)===kind || rules.reefAt(epoch).includes(kind)) && rules.fishFormAt(kind,epoch)===form) {
        sessionStorage.setItem('test-tide-time',String(epoch*300000+600));return epoch;
      }
    }
    throw Error('No matching tide');
  },[kind,form]);
  await page.evaluate(async()=>{const client=V3.cabinInventory,next=V3.shallows.state.spots[0].key;
    const result=await client.perform({op:'shore_berth',id:client.id('berth'),expected:null,next});if(!result.ok)throw Error(result.error);});
  for(const [index,form] of ['lagoon','base'].entries()) {
    await shift('puffer',form);
    assert.equal(await page.evaluate(()=>{const part=V3.scene.parts.find(part=>part.id==='shallows');part.update(.05,0);return V3.shallows.net();}),true);
    if (form!=='base') assert.match(await page.$eval('.shore-panel',panel=>panel.textContent),/潟湖蓝带/);
    await page.locator('::-p-xpath(//button[normalize-space(.)="带回鱼缸"])').click();
    await page.waitForFunction(count=>V3.shore.shore().fish.length===count,{},index+1);
  }
  await page.reload({waitUntil:'load'});await ready();
  await page.waitForFunction(()=>V3.shallows.state.school[0].userData.form==='lagoon' && V3.shallows.state.school[1].userData.form==='base');
  await page.evaluate(()=>V3.collection.open('fish'));
  const puffer='.fish-specimen[data-kind="puffer"]';
  assert.equal(await page.$eval('.col-num',node=>node.textContent),'已观察 1 / 43');
  assert.equal(await page.$eval(puffer+' .fish-forms small',node=>node.textContent),'花色 2/2');
  const pictures=[];
  for(const name of ['潟湖蓝带','原色']) {
    await page.$$eval(puffer+' .fish-forms button',(buttons,name)=>buttons.find(button=>button.textContent===name).click(),name);
    pictures.push(await page.$eval(puffer+' img',image=>image.src));assert.equal(await page.$eval(puffer+' .fish-forms [aria-pressed="true"]',button=>button.textContent),name);
  }
  assert.notEqual(pictures[0],pictures[1]);await page.evaluate(()=>V3.collection.close());
  const epoch=await shift('manta','pearl');
  await page.waitForFunction(()=>{let correct=false;V3.R.scene.traverse(obj=>{if(obj.userData.clickable==='reefWatch' && obj.userData.species==='manta') correct=obj.userData.form==='pearl' && obj.geometry===V3.reefFish.model('manta','pearl').geometry;});return correct;});
  assert.equal(await page.evaluate(async epoch=>(await V3.cabinInventory.perform({op:'shore_watch',epoch,kind:'manta',id:'watch-pearl'})).ok,epoch),true);
  assert.deepEqual(await page.evaluate(()=>V3.shore.shore().forms.manta),['pearl']);assert.deepEqual(errors,[]);
  console.log('PASS: shell rarity/quantity ordering, scoped batch selection and protections, confirmed sales across batches; fish forms in the net, tank, folio and reef school after reload');
} finally {await browser?.close();await server.close();}
