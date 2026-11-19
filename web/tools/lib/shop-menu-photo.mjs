export async function menuPhoto(page,browser,output) {
  const shelves=await page.evaluate(async()=>{
    const catalog=V3.snackCatalog;
    async function portrait(sku) {
      const image=new Image(); image.src=V3.snackModels.icon(sku,{size:224}); await image.decode();
      const canvas=document.createElement('canvas'); canvas.width=image.width;canvas.height=image.height;
      const brush=canvas.getContext('2d',{willReadFrequently:true});brush.drawImage(image,0,0);
      const pixels=brush.getImageData(0,0,image.width,image.height).data;
      let left=image.width,top=image.height,right=-1,bottom=-1;
      for(let row=0;row<image.height;row++) for(let col=0;col<image.width;col++) if(pixels[(row*image.width+col)*4+3]>16){left=Math.min(left,col);right=Math.max(right,col);top=Math.min(top,row);bottom=Math.max(bottom,row);}
      if(right-left<8||bottom-top<8)throw Error('Blank menu photo: '+sku);
      canvas.width=right-left+5;canvas.height=bottom-top+5;brush.drawImage(image,2-left,2-top);return canvas.toDataURL();
    }
    const groups=[];
    for(const [key,label] of Object.entries(catalog.shelves)) {
      const items=[];
      for(const item of catalog.list.filter(entry=>entry.category===key)) items.push({...item,picture:await portrait(item.sku)});
      groups.push({key,label,items});
    }
    return groups;
  });
  const accents={fruit:['#467352','FRUIT STAND'],savory:['#93653e','DELI COUNTER'],sweet:['#9c5e68','PASTRY CASE'],drink:['#397583','DRINKS BAR']};
  const arrivals=new Set(['durian','dried_fish','berry_star','osmanthus_oolong']);
  const rows=shelves.map(({key,label,items},index)=>`<section style="--ink:${accents[key][0]}"><header><b>0${index+1}</b><h2>${label}</h2><em>${accents[key][1]}</em><span>${items.length} 款</span></header><div class="row">${items.map(item=>`<article>${arrivals.has(item.sku)?'<i>新到</i>':''}<img src="${item.picture}"><h3>${item.name}</h3><div class="price"><span>${item.count} ${item.unit}</span><strong>${item.price} 贝币</strong></div></article>`).join('')}</div></section>`).join('');
  const poster=await browser.newPage();try {
    await poster.setViewport({width:1536,height:1350,deviceScaleFactor:1});
    await poster.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;color:#243f3b;font-family:'Microsoft YaHei',sans-serif}.menu{width:1536px;background:#f6efdf;padding:0 43px 21px}
      .awning{margin:0 -43px;height:17px;background:repeating-linear-gradient(90deg,#345e55 0 36px,#eee1bb 36px 72px)}.mast{display:flex;justify-content:space-between;align-items:center;padding:24px 2px 18px;border-bottom:2px solid #516b5d}.mast small,em,header b{font:700 15px Consolas,monospace;letter-spacing:2px}.mast small{color:#577467}h1,h2,h3,p{margin:0}h1{font:700 50px SimSun,serif;letter-spacing:4px}.mast aside{font:22px SimSun,serif;text-align:right}.mast aside b{font:700 40px Georgia,serif;color:#986644}.mast aside p{font:15px 'Microsoft YaHei';margin-top:6px;color:#617466}
      section{margin-top:16px}header{display:flex;color:var(--ink);align-items:baseline;gap:13px;padding:0 2px 7px}header h2{font:700 27px SimSun,serif}header em{font-size:12px}header span{margin-left:auto;font-size:14px;font-weight:700}.row{display:grid;grid-template-columns:repeat(${Math.max(...shelves.map(group=>group.items.length))},1fr);gap:9px}article{position:relative;background:#fffaf0;border:1px solid #d7cdb7;border-top:3px solid var(--ink);border-radius:4px 4px 10px 10px;padding:11px 11px 10px}img{display:block;object-fit:contain;width:100%;height:99px;filter:drop-shadow(0 3px 2px #42341a25)}h3{text-align:center;font:700 21px SimSun,serif;margin-top:8px}.price{display:flex;justify-content:space-between;border-top:1px dotted #c4bea8;padding-top:6px;margin-top:7px;font-size:14px;color:#697366}.price strong{color:var(--ink)}i{position:absolute;right:6px;top:5px;border:1px solid #b77154;background:#fff6e1;color:#985338;font:700 11px 'Microsoft YaHei';transform:rotate(6deg);z-index:1;padding:1px 4px}footer{margin-top:18px;padding:10px 2px 0;border-top:1px solid #8b9c89;display:flex;justify-content:space-between;font-size:14px;color:#5c7063}</style>
      <div class="menu"><div class="awning"></div><div class="mast"><div><small>HAIBIAN &nbsp; / &nbsp; CABIN PROVISIONS</small><h1>海边小店菜单</h1></div><aside><b>${shelves.reduce((sum,group)=>sum+group.items.length,0)}</b> 款在售<p>四个货架 · ${arrivals.size} 款新到</p></aside></div>${rows}<footer><span>每张价签：一件里的分量 ／ 买下整件的贝币数</span><span>小店 › 买零食 › 选择货架</span></footer></div>`);
    await poster.evaluate(async()=>{await Promise.all([...document.images].map(image=>image.decode()));await document.fonts.ready;});
    await (await poster.$('.menu')).screenshot({path:output});
  } finally {await poster.close();}
}
