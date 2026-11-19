import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, serveFiles, WEB_DIR } from './mc-lib.mjs';

const output = path.resolve(process.argv[2] || path.join(WEB_DIR, '../docs/fish-folio.png'));
const server = await serveFiles({ '/cabin.html': path.join(WEB_DIR, 'dist/cabin.html') });
let browser;
try {
  browser = await launchBrowser({ width: 900, height: 680, gpu: 'swiftshader' });
  const page = await browser.newPage();
  await page.goto(server.url + '/cabin.html?live=0&auto=0&ui=0', {waitUntil:'load'});
  await page.waitForFunction(() => window.__READY && V3.R?.renderer && V3.fishGuide, {timeout:120000});
  const png = await page.evaluate(async () => {
    const rules = V3.inventoryRules, guide = V3.fishGuide, fish = guide.entries().map((entry, index) => ({...entry, observed:true, index:index+1}));
    const fantasyIds=new Set(['foldsail','rainbell','moonray','islet']), fantasy=fish.filter(f=>fantasyIds.has(f.id));
    const shallow = fish.filter(entry => !entry.reef && !fantasyIds.has(entry.id)), reef = fish.filter(entry => entry.reef);
    const forms = fish.flatMap(entry => Object.entries(rules.FISH_FORMS[entry.id] || {}).map(([form, name]) => ({...entry, form, formName:name})));
    async function plate(entry) {
      const image = new Image(); image.src = guide.portrait(entry, entry.form || 'base', 384); await image.decode();
      const trim = document.createElement('canvas'); trim.width = image.width; trim.height = image.height;
      const brush = trim.getContext('2d', {willReadFrequently:true}); brush.drawImage(image,0,0);
      const pixels = brush.getImageData(0,0,trim.width,trim.height).data;
      let left = trim.width, right = -1, top = trim.height, bottom = -1;
      for (let row = 0; row < trim.height; row++) for (let col = 0; col < trim.width; col++) if (pixels[4*(row*trim.width+col)+3] > 16) {
        left=Math.min(left,col); right=Math.max(right,col); top=Math.min(top,row); bottom=Math.max(bottom,row);
      }
      if (right-left < 10 || bottom-top < 8) throw Error('Empty portrait: ' + entry.id);
      entry.art = {image, left, top, width:right-left+1, height:bottom-top+1};
    }
    for (const entry of [...fish,...forms]) await plate(entry);
    const canvas = document.createElement('canvas'), width = 1720, margin = 64, cols = 5, pitch = (width-margin*2)/cols, cellHeight = 156;
    const headerHeight = 208, sectionHeight = 83, variantHeight = 148, footerHeight = 57;
    const height = headerHeight + sectionHeight*4 + cellHeight*[shallow,fantasy,reef].reduce((n,list)=>n+Math.ceil(list.length/cols),0) + variantHeight + footerHeight;
    canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext('2d'), ink='#1b3940', muted='#547176', sea='#2e756f', reefBlue='#36637a', amber='#b35c40', paper='#f7f6ed';
    const sans='"Microsoft YaHei", "Noto Sans CJK SC", sans-serif', serif='"SimSun", "Noto Serif CJK SC", serif', mono='Consolas, monospace';
    function rect(left, top, wide, high, fill) { ctx.fillStyle=fill; ctx.fillRect(left,top,wide,high); }
    function line(x0,y0,x1,y1,color,stroke=1) { ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.strokeStyle=color;ctx.lineWidth=stroke;ctx.stroke(); }
    function label(value,left,baseline,size,color,weight=400,font=sans,align='left') { ctx.font=`${weight} ${size}px ${font}`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(value,left,baseline); }
    function diamond(left,top,size,color) { ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(left,top-size);ctx.lineTo(left+size,top);ctx.lineTo(left,top+size);ctx.lineTo(left-size,top);ctx.closePath();ctx.fill(); }
    function draw(entry,cx,cy,maxW,maxH) { const art=entry.art, zoom=Math.min(maxW/art.width,maxH/art.height); const wide=art.width*zoom, high=art.height*zoom;
      ctx.save();ctx.shadowColor='rgba(27,55,60,.23)';ctx.shadowBlur=2;ctx.shadowOffsetY=1.1;
      ctx.drawImage(art.image,art.left,art.top,art.width,art.height,cx-wide/2,cy-high/2,wide,high);ctx.restore(); }
    rect(0,0,width,height,paper); rect(0,0,width,headerHeight,'#153d45');
    ctx.save();ctx.beginPath();ctx.rect(0,0,width,headerHeight);ctx.clip();
    for(let index=0;index<16;index++) {
      ctx.beginPath();ctx.moveTo(945+index*21,-24);ctx.bezierCurveTo(825+index*24,58,1130+index*22,123,969+index*26,240);
      ctx.strokeStyle='#24565c';ctx.lineWidth=index%4===0?2.2:1.1;ctx.stroke();
    }
    ctx.restore();
    label('HAIBIAN   /   MARINE FIELD NOTES',margin,43,19,'#a9d0c5',600,mono);line(margin,57,405,57,'#77a69e');
    label('海边小屋 · 鱼儿全家福',margin-3,132,65,'#fff5db',700,serif);
    label('从一面小白帆，到珊瑚旁的远礁',margin+2,177,24,'#c1ddd4');
    label(String(fish.length).padStart(2,'0'),width-margin-153,135,116,'#f0c480',600,'Georgia, serif','center');
    line(width-margin-70,66,width-margin-70,140,'#71918a',1);
    label('物 种',width-margin,97,21,'#f0e9cc',600,sans,'right'); label('SPECIES',width-margin,127,15,'#a9d0c5',500,mono,'right');
    const zero = number => String(number).padStart(2,'0');
    function section(top, code, title, sub, count, color) {
      rect(margin,top+24,6,32,color);label(code,margin+18,top+49,17,color,700,mono); label(title,margin+79,top+53,32,ink,700,serif);
      label(sub,margin+300,top+50,21,muted); label(count,width-margin,top+49,23,color,700,sans,'right');
      line(margin,top+sectionHeight-9,width-margin,top+sectionHeight-9,color,1.6);
    }
    function region(members,top,code,title,subtitle,color,tint) {
      section(top,code,title,subtitle,members.length+' 种',color); const from=top+sectionHeight;
      members.forEach((entry,index)=>{
        const col=index%cols, row=Math.floor(index/cols), left=margin+col*pitch, y=from+row*cellHeight;
        rect(left+1,y,pitch-2,cellHeight-4,tint);
        if(col) line(left,y+15,left,y+cellHeight-15,'#cbd7ca');
        label('FIG. '+zero(entry.index),left+15,y+24,15,muted,500,mono);
        if(rules.FISH_FORMS[entry.id]) diamond(left+pitch-21,y+19,5.5,amber);
        draw(entry,left+pitch/2,y+65,pitch-78,86);
        label(entry.name,left+pitch/2,y+138,25,ink,700,sans,'center');
        line(left+9,y+cellHeight-3,left+pitch-9,y+cellHeight-3,'#d0d9ce');
      }); return from+Math.ceil(members.length/cols)*cellHeight;
    }
    let top = region(shallow,headerHeight,'01 /','浅海相遇','可迎进鱼缸，也可目送它们离开',sea,'#e6eee4');
    top=region(fantasy,top,'02 /','浅海幻想','白帆、雨铃、月牙与珊瑚小岛','#78577a','#f0e8f0');
    top=region(reef,top,'03 /','远礁观赏','与小鲸鱼一起观察，不可捕捉',reefBlue,'#e4ecec');
    section(top,'04 /','同种异色','带菱标的鱼，还有这一种模样',forms.length+' 款',amber);top+=sectionHeight;
    const panelWidth=(width-margin*2)/forms.length;
    forms.forEach((entry,index)=>{const left=margin+index*panelWidth, middle=left+panelWidth/2;
      rect(left+1,top,panelWidth-2,variantHeight-1,'#f3ede1');
      if(index) line(left,top+14,left,top+variantHeight-13,'#d8cabc');
      diamond(left+19,top+18,4.5,amber);label(zero(entry.index),left+29,top+23,15,amber,600,mono);
      draw(entry,middle,top+48,panelWidth-50,67);label(entry.formName,middle,top+105,23,ink,700,sans,'center');label(entry.name,middle,top+132,17,muted,500,sans,'center');
    });
    top+=variantHeight;line(margin,top+9,width-margin,top+9,'#bfcac0');
    label('海边小屋  /  鱼类图鉴',margin,top+39,17,muted,600);label('游戏模型实绘  ·  图中大小不代表实际比例',width-margin,top+39,17,muted,400,sans,'right');
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await writeFile(output,Buffer.from(png,'base64'));
  console.log(output);
} finally { await browser?.close(); await server.close(); }
