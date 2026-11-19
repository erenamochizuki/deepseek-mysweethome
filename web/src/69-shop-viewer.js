(function (V3) {
  'use strict';
  const el = V3.util.el;
  let current = null;
  function close() { if (!current) return false; current(); return true; }
  function open(item, returnFocus) {
    close();
    const dialog = el('dialog', {class:'shop-viewer', 'aria-labelledby':'shop-view-title'});
    const stage = el('div', {class:'shop-view-stage'});
    const quit = el('button', {type:'button',class:'shop-view-back',autofocus:true,'aria-label':'关闭商品详情',onclick:close},'×');
    dialog.append(el('header', {}, el('div', {}, el('small', {}, 'CABIN GOODS'),el('h2', {id:'shop-view-title'}, item.name)), quit),
      stage, el('div', {class:'shop-view-info'}, el('strong', {}, V3.snackCatalog.shelves[item.category]+' · '+item.price+' 贝币'),el('p', {},item.desc)));
    document.body.append(dialog); dialog.showModal();
    let single=false, orbit;
    current=()=>{current=null;orbit?.dispose();dialog.close();dialog.remove();returnFocus?.();};
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    const outside=event=>{const box=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom);};
    let pressedOutside=false;dialog.onpointerdown=event=>{pressedOutside=outside(event);};dialog.onclick=event=>{if(pressedOutside&&outside(event))close();pressedOutside=false;};
    orbit=V3.modelOrbit.mount(stage,{
      label:()=>item.name+'模型，可用方向键旋转，加减键缩放'+(item.pack==='cup'?'':'，回车切换整件与单份'),
      build:()=>single?V3.snackModels.piece(item.sku):V3.snackModels.pack(item.sku),
      onTap:item.pack==='cup'?null:()=>{single=!single;orbit.reload();},
      still:()=>{const src=V3.snackModels.icon(item.sku,{what:single?'piece':'pack',size:400});return src?el('img',{src,alt:item.name+'（静态预览）'}):null;}
    });
  }
  V3.shopViewer={open,close};
})(window.V3);
