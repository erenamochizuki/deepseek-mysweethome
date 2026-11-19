(function (V3) {
  'use strict';
  const el = V3.util.el, clamp = V3.util.clamp;
  let current = null;
  function close() { if (!current) return false; current(); return true; }
  function open(item, returnFocus) {
    close();
    const dialog = el('dialog', {class:'shop-viewer', 'aria-labelledby':'shop-view-title'});
    const stage = el('div', {class:'shop-view-stage'});
    const quit = el('button', {type:'button',class:'shop-view-back',autofocus:true,'aria-label':'关闭观赏窗',onclick:close},'×');
    dialog.append(el('header', {}, el('div', {}, el('small', {}, 'CABIN GOODS　/　商品观赏'),el('h2', {id:'shop-view-title'}, item.name)), quit),
      stage, el('div', {class:'shop-view-info'}, el('strong', {}, V3.snackCatalog.shelves[item.category]+' · '+item.price+' 贝币'),el('p', {},item.desc)));
    document.body.append(dialog); dialog.showModal();
    let renderer, observer, frame=0, previous=0, dirty=true, single=false, auto=!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let yaw=.38, elevation=.48, zoom=1, drag=null, model, size=1, disposed=false;
    const scene=new THREE.Scene(), camera=new THREE.OrthographicCamera(-1,1,1,-1,.001,20), pivot=new THREE.Group();
    scene.add(pivot,new THREE.HemisphereLight(0xfff9ed,0xb8b2a3,1.05));
    for(const [color,intensity,x,y,z] of [[0xfff3df,1.65,-2,3,3],[0xe8f4ed,.65,2,1,-2]]) {
      const light=new THREE.DirectionalLight(color,intensity);light.position.set(x,y,z);scene.add(light);
    }
    const discard = () => { cancelAnimationFrame(frame); frame=0; observer?.disconnect(); if(renderer){renderer.dispose();renderer.forceContextLoss();renderer=null;} };
    const visibility=()=>{previous=0;if(document.hidden){cancelAnimationFrame(frame);frame=0;}else schedule();};
    current=()=>{current=null;disposed=true;document.removeEventListener('visibilitychange',visibility);discard();dialog.close();dialog.remove();returnFocus?.();};
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    const outside=event=>{const box=dialog.getBoundingClientRect();return event.target===dialog&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom);};
    let pressedOutside=false;dialog.onpointerdown=event=>{pressedOutside=outside(event);};dialog.onclick=event=>{if(pressedOutside&&outside(event))close();pressedOutside=false;};
    function togglePiece(){if(item.pack!=='cup'){single=!single;loadModel();}}
    function magnify(factor){zoom=clamp(zoom*factor,.7,2);schedule();}
    function schedule(){dirty=true;if(renderer&&!disposed&&!document.hidden&&!frame)frame=requestAnimationFrame(draw);}
    function draw(now){frame=0;if(!renderer||disposed||document.hidden)return;
      if(auto&&!drag)yaw+=Math.min(.08,previous?(now-previous)/1000:0)*.23;previous=now;
      if(dirty||auto){const aspect=stage.clientWidth/Math.max(stage.clientHeight,1), extent=size*1.04/zoom;
        camera.left=-extent*Math.max(1,aspect);camera.right=-camera.left;camera.top=extent*Math.max(1,1/aspect);camera.bottom=-camera.top;
        camera.updateProjectionMatrix();camera.position.set(Math.sin(yaw)*Math.cos(elevation),Math.sin(elevation),Math.cos(yaw)*Math.cos(elevation)).multiplyScalar(size*4);camera.lookAt(0,0,0);renderer.render(scene,camera);dirty=false;}
      if(auto&&!drag)frame=requestAnimationFrame(draw);
    }
    function still(){discard();stage.replaceChildren();const src=V3.snackModels.icon(item.sku,{what:single?'piece':'pack',size:400});
      if(src)stage.append(el('img',{src,alt:item.name+'（静态预览）'}));}
    function loadModel(){if(!renderer){still();return;}
      try{if(model)pivot.remove(model);model=single?V3.snackModels.piece(item.sku):V3.snackModels.pack(item.sku);
        const bounds=new THREE.Box3().setFromObject(model),sphere=bounds.getBoundingSphere(new THREE.Sphere());model.position.sub(sphere.center);size=Math.max(.001,sphere.radius);pivot.add(model);schedule();}
      catch(error){V3.err('商品模型 '+item.sku+': '+error.message);still();}
    }
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}catch{still();return;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
    const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label',item.name+'模型，可用方向键旋转，加减键缩放'+(item.pack==='cup'?'':'，回车切换整件与单份'));stage.append(canvas);
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();if(!disposed&&renderer)still();});
    canvas.onpointerdown=event=>{if(event.button!==0||drag)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,distance:0};canvas.setPointerCapture(event.pointerId);};
    canvas.onpointermove=event=>{if(!drag||event.pointerId!==drag.id)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(!dx&&!dy)return;
      drag.distance+=Math.hypot(dx,dy);yaw-=dx*.012;elevation=clamp(elevation+dy*.012,-1.52,1.52);drag.x=event.clientX;drag.y=event.clientY;schedule();};
    canvas.onlostpointercapture=canvas.onpointerup=canvas.onpointercancel=event=>{if(drag?.id===event.pointerId){const tap=event.type==='pointerup'&&drag.distance<5;drag=null;previous=0;if(tap)togglePiece();schedule();}};
    canvas.addEventListener('wheel',event=>{event.preventDefault();magnify(event.deltaY<0?1.1:1/1.1);},{passive:false});
    canvas.onkeydown=event=>{if(['+','=','-'].includes(event.key)){event.preventDefault();magnify(event.key==='-'?1/1.18:1.18);return;}
      if(event.key==='Enter'){event.preventDefault();togglePiece();return;}
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();
      yaw+=event.key==='ArrowLeft'?-.15:event.key==='ArrowRight'?.15:0;elevation=clamp(elevation+(event.key==='ArrowUp'?.15:event.key==='ArrowDown'?-.15:0),-1.52,1.52);schedule();};
    const resize=()=>{if(!renderer)return;renderer.setSize(Math.max(1,stage.clientWidth),Math.max(1,stage.clientHeight),false);schedule();};
    observer=new ResizeObserver(resize);observer.observe(stage);document.addEventListener('visibilitychange',visibility);resize();loadModel();
  }
  V3.shopViewer={open,close};
})(window.V3);
