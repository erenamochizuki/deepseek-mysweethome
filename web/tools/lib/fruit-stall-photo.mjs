export async function photograph(browser, items, output) {
  const poster = await browser.newPage();
  try {
    await poster.setViewport({ width: 1152, height: 900, deviceScaleFactor: 1 });
    const cards = items.map((item, index) => `<article style="--tint:${item.color}">
      <div class="art"><span class="index">Nº ${String(index + 1).padStart(2, '0')}</span><img class="whole" src="${item.pack}">
      <div class="taste"><img src="${item.piece}"><span>单份</span></div></div>
      <div class="label"><div><h2>${item.name}</h2><small>一盒 · ${item.count} ${item.unit}</small></div><div class="price">${item.price} <b>贝币</b></div></div>
      </article>`).join('');
    await poster.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;color:#264a3d;background:#fff8e8;font:17px 'Microsoft YaHei',sans-serif}.stall{background:#fbf4e4;width:1152px}
      .awning{height:23px;background:repeating-linear-gradient(90deg,#3b725a 0 36px,#f2e6c6 36px 72px);border-bottom:2px solid #42654b}
      header{margin:28px 46px 19px;display:flex;align-items:end;justify-content:space-between;border-bottom:2px solid #486b52;padding:0 2px 20px}
      .eyebrow,.index,.serial{font:700 13px Consolas,monospace;letter-spacing:2px}.eyebrow{color:#5d7059}
      h1,h2,p{margin:0}h1{font:700 55px/1.18 SimSun,serif;letter-spacing:3px;margin:6px 0 7px}p{color:#5a6a56;font-size:18px}
      .badge{align-self:center;color:#396449;border:2px solid #547a59;padding:5px;border-radius:50%;transform:rotate(7deg);text-align:center;margin-right:8px}
      .badge div{width:79px;height:79px;border:1px dashed #739174;border-radius:50%;display:grid;align-content:center;justify-items:center}.badge strong{font:700 34px/1.05 Georgia,serif}.badge span{font-size:12px;letter-spacing:2px}
      main{display:grid;grid-template-columns:repeat(3,1fr);gap:17px;margin:0 46px}article{border:1px solid #d5c8ac;border-radius:12px;overflow:hidden;background:#fffbf2}
      .art{height:171px;position:relative;background:radial-gradient(ellipse at 46% 45%,#fffaf1 5%,color-mix(in srgb,var(--tint) 13%,#f7efda) 100%)}
      .art::after{content:'';position:absolute;inset:auto 0 0;height:1px;background:#dfd4bd}.index{position:absolute;left:14px;top:11px;font-size:12px;color:#6c7765}
      img{object-fit:contain;filter:drop-shadow(0 4px 2px #53371f25)}.whole{position:absolute;left:10px;top:30px;width:71%;height:134px}
      .taste{position:absolute;right:11px;bottom:12px;width:79px;height:79px;border:1px dashed #b8b099;border-radius:50%;background:#fffaed;display:flex;flex-direction:column;align-items:center;justify-content:center}
      .taste img{width:54px;height:42px}.taste span{color:#6b715c;font-size:11px;font-weight:700;line-height:15px}
      .label{display:flex;align-items:center;justify-content:space-between;padding:10px 17px 12px}h2{font:700 27px/1.2 SimSun,serif}small{font-size:14px;color:#6b735d}
      .price{font:700 28px Georgia,serif;color:#8e4b34}.price b{font:700 13px 'Microsoft YaHei',sans-serif}
      footer{margin:19px 46px 0;border-top:1px solid #a7ac92;padding:14px 2px 18px;display:flex;justify-content:space-between;align-items:center;color:#536653;font-size:15px}.serial{font-size:11px}
      </style><div class="stall"><div class="awning"></div><header><div><div class="eyebrow">HAIBIAN &nbsp;/&nbsp; FRUIT MARKET</div><h1>小屋鲜果摊</h1><p>今天新到六款水果，挑一盒，分一口给小鲸鱼。</p></div><div class="badge"><div><strong>06</strong><span>新到鲜果</span></div></div></header>
      <main>${cards}</main><footer><span>小店 › 买零食 › <strong>新鲜水果</strong></span><span class="serial">CABIN GOODS &nbsp; / &nbsp; FRESH SERIES</span></footer></div>`);
    await poster.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); await document.fonts.ready; });
    await (await poster.$('.stall')).screenshot({ path: output });
  } finally { await poster.close(); }
}
