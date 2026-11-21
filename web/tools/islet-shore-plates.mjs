// Render field-guide plates from the compiled cabin; uses the same assets, stages and lighting as the game.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {launchBrowser, serveFiles, WEB_DIR} from './mc-lib.mjs';

const out = path.resolve(WEB_DIR, '../docs/tide-atlas');
const server = await serveFiles({'/cabin.html': path.join(WEB_DIR,'dist/cabin.html')});
let browser;
try {
  browser = await launchBrowser({width:640,height:480,gpu:'swiftshader'});
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.url+'/cabin.html?live=0&auto=0&ui=0');
  await page.waitForFunction(() => window.__READY && V3.R?.renderer && V3.fishGuide,{timeout:120000});
  const plates = await page.evaluate(async () => {
    const ids = ['crab_molt_claw','drift_cork','sea_bamboo','fan_alga','mermaid_comb','gooseneck_cluster','crinoid_crown','wreck_compass','amber_shrimp','silver_sail_badge'];
    const finds = ids.map(id => { const k = V3.washupCatalog.collectibles.find(k=>k.id===id); if (!k) throw Error('Missing collectible: '+id); return k; });
    const hints = ['空钳口与白尖','旧红漆绕过瓶塞','两端留着细沙','浅色同心叶纹','两枚梳齿的缺口','弯柄上的瓷白壳片','石纹里的羽冠','半开铜盖与红针','蜜色里的卷尾','弯折的银帆'];
    const captions = ['浅青幼鱼背着苔石','背上长出杏红珊瑚','鱼背渐宽，两礁相望','白沙环着一弯浅水','侧纹旁架起石拱','深青成鱼驮着花冠'];
    const timeline=V3.inventoryRules.ISLET_STAGES, stages=timeline.map((s,i)=>[s.day,s.name,captions[i]]), parts=timeline.slice(1).map(s=>s.group);
    const sea='#164950', ink='#193e42', dim='#536b69', rule='#adbfba', paper='#f7f7ee';
    const cn='"Microsoft YaHei",sans-serif', title='"SimSun",serif', mono='Consolas,monospace';
    const rarity={common:['常见','#4b897c'],uncommon:['少见','#486d97'],rare:['稀有','#98602e']};
    async function crop(url) {
      const img=new Image();img.src=url;await img.decode();
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);
      const d=g.getImageData(0,0,c.width,c.height).data;let l=c.width,r=-1,t=c.height,b=-1;
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(y*c.width+x)*4+3]>23){l=Math.min(x,l);r=Math.max(x,r);t=Math.min(y,t);b=Math.max(y,b);}
      if(r-l<12||b-t<10)throw Error('Empty specimen image');return {img,l,t,w:r-l+1,h:b-t+1};
    }
    function fish(stage,view,size) {
      return crop(V3.shellIcons.shot(()=>{
        const m=V3.shallows.fishModel('islet','base',stage);
        parts.forEach((name,i)=>{if(m.getObjectByName(name)?.visible !== (stage>i))throw Error(`Stage ${stage} / ${name} mismatch`);});return m;
      },{size,view}));
    }
    function sheet(w,h) {
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const c=canvas.getContext('2d');
      function box(x,y,w,h,col){c.fillStyle=col;c.fillRect(x,y,w,h);}
      function text(s,x,y,sz,col=ink,wt=400,font=cn,align='left'){c.fillStyle=col;c.font=`${wt} ${sz}px ${font}`;c.textAlign=align;c.fillText(s,x,y);}
      function line(x,y,xx,yy,col=rule,weight=1){c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.strokeStyle=col;c.lineWidth=weight;c.stroke();}
      function art(a,x,y,w,h){const z=Math.min(w/a.w,h/a.h);c.drawImage(a.img,a.l,a.t,a.w,a.h,x+(w-a.w*z)/2,y+(h-a.h*z)/2,a.w*z,a.h*z);}
      function header(num,zh,en,caption){box(0,0,w,h,paper);box(0,0,w,11,sea);text('海边小屋     /     潮间带观察手记',42,56,20,dim,600);text(en,w-42,56,20,dim,500,mono,'right');text(zh,38,135,65,ink,700,title);text(caption,w-42,131,25,dim,400,cn,'right');line(41,158,w-41,158,sea,2);}
      function footer(n){line(42,h-53,w-42,h-53);text('实机模型  ·  原色标本',42,h-22,17,dim);text('HAIBIAN   /   COASTAL FIELD NOTES     '+n,w-42,h-22,17,dim,500,mono,'right');}
      return {box,text,line,art,header,footer,png:()=>canvas.toDataURL().split(',')[1]};
    }
    const g=sheet(1600,862);g.header('01','驮岛鱼的六次生长','FISH   /   PLATE 01','六阶同一比例尺　·　左侧为成鱼特写');
    g.box(42,185,585,599,'#e1ece3');g.text('终阶特写',66,231,27,sea,700);g.text('FIG. 06',600,227,18,dim,500,mono,'right');
    g.art(await fish(5,{az:1.06,el:.40},750),55,245,557,401);g.text('花冠屿',64,709,53,ink,700,title);g.text('第 21 天起',67,751,23,dim);
    const adult=V3.shallows.fishModel('islet','base',5), bounds=new THREE.Box3().setFromObject(adult,true).getBoundingSphere(new THREE.Sphere());
    const compareView={az:1.07,el:.47,frameSpan:2.08*bounds.radius};
    const tiles=[];for(let i=0;i<6;i++)tiles.push(await fish(i,compareView,512));
    const zoom=Math.min(263/Math.max(...tiles.map(t=>t.w)),159/Math.max(...tiles.map(t=>t.h)));
    for(let i=0;i<6;i++){
      const [day,name,hint]=stages[i],x=654+(i%3)*305,y=186+Math.floor(i/3)*301;
      g.line(x,y+2,x+281,y+2,rule);g.text('DAY '+String(day).padStart(2,'0'),x+1,y+31,18,sea,600,mono);
      const a=tiles[i],w=a.w*zoom,h=a.h*zoom;g.art(a,x+9+(263-w)/2,y+204-h,w,h);
      g.text(name,x+1,y+244,34,ink,700,title);g.text(hint,x+2,y+279,21,dim);
    }
    g.footer('01');
    const s=sheet(1640,870);s.header('02','潮水带来的十件收藏','SHORE   /   PLATE 02','常见 4 件    ·    少见 2 件    ·    稀有 4 件');
    for(let i=0;i<finds.length;i++){
      const k=finds[i],[label,color]=rarity[k.rarity],x=42+i%5*313,y=186+Math.floor(i/5)*309;
      s.box(x,y,300,302,['#e8eee3','#ebeff1','#f0ebdf'][['common','uncommon','rare'].indexOf(k.rarity)]);
      s.text('FIG. '+String(i+1).padStart(2,'0'),x+17,y+29,17,dim,500,mono);s.text(label,x+281,y+30,19,color,700,cn,'right');
      s.art(await crop(V3.shellIcons.get(k.id,{size:480})),x+22,y+50,256,164);
      s.text(k.name,x+16,y+255,30,ink,700,title);s.text(hints[i],x+17,y+284,19,dim);
    }
    s.footer('02');
    function exportModel(root) { root.updateMatrixWorld(true);root.traverse(o=>{o.userData={};}); return root.toJSON(); }
    const exhibit={stages,fish:{id:'islet',model:exportModel(adult)},
      bounds:{center:bounds.center.toArray(),radius:bounds.radius},finds:finds.map(k=>({id:k.id,name:k.name,desc:k.desc,rank:rarity[k.rarity][0],
      view:V3.shellIcons.viewFor?.(k.id) || {az:.32,el:.82},model:exportModel(V3.washupCatalog.build(k.id,{tag:false}))}))};
    return {exhibit,images:{'islet-growth':g.png(),'shore-ten':s.png()}};
  });
  assert.deepEqual(errors,[]);
  for(const [name,bytes] of Object.entries(plates.images)) { const target=path.join(out,name+'.png');await writeFile(target,Buffer.from(bytes,'base64'));console.log(target); }
  const [template,...scripts]=await Promise.all(['tools/lib/shore-exhibit.html','vendor/three.min.js','src/00-core.js','src/31-shore-models.js','src/66-model-orbit.js'].map(f=>readFile(path.join(WEB_DIR,f),'utf8')));
  const html=template.replace('<!--RUNTIME-->',()=>scripts.map(s=>'<script>'+s.replace(/<\/script/gi,'<\\/script')+'\n</script>').join('\n')).replace('COMPRESSED_EXHIBIT',()=>gzipSync(JSON.stringify(plates.exhibit)).toString('base64'));
  await writeFile(path.join(WEB_DIR,'dist/shore-showcase.html'),html);
} finally {await browser?.close();await server.close();}
