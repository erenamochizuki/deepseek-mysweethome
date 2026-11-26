// 阁楼地板画角。毛毯、画纸和蜡笔跟随房间；角色趴在毛毯上作画。
(function (V3) {
  'use strict';
  const A = V3.artDesk = {};
  const wood = 0xb8794e, oak = 0xd6a977, teal = 0x417c79, trim = 0x304e56, paper = 0xfff0d3;
  const pigments = [0xc76352, 0xe8a857, 0xc3b659, 0x739a72, 0x6298a8, 0x677ea3, 0x916d8b];
  const sheetSize = .29, sheetX = .12, sheetY = .052, sheetZ = .20;
  let live, lastGrid, lastVersion, placement, external, startingJob, session, unsaved;
  const notify = text => V3.hud?.toast(text);
  Object.defineProperty(A,'waitingForAlbum',{get:()=>!!unsaved || (!!external?.manual && startingJob!==external)});
  A.spot = () => {
    const hb = V3.houseBlocks;
    if (!hb?.grid) return null;
    if (lastGrid === hb.grid && lastVersion === hb.version) return placement;
    lastGrid = hb.grid; lastVersion = hb.version; placement = null;
    const world = p => hb.placePoint(p, hb.place), y = V3.layout.house.loftY;
    for (const [x,z] of [[.25,-13.48],[-2.5,-12.9],[1,-11.55]]) {
      const a = world([x-.81,y,z-.43]), b = world([x+.81,y,z+1.72]);
      const x0=Math.min(a[0],b[0]), x1=Math.max(a[0],b[0]), z0=Math.min(a[2],b[2]), z1=Math.max(a[2],b[2]);
      const clear = (x,z) => {
        const i=Math.floor(x), k=Math.floor(z);
        return hb.grid.at(i,y-1,k) && !hb.grid.at(i,y,k) && !hb.grid.at(i,y+1,k);
      };
      const front = world([x,y,z+.7]);
      if (!clear(front[0],front[2]) || ![x0,(x0+x1)/2,x1].every(i => [z0,(z0+z1)/2,z1].every(k => clear(i,k)))) continue;
      placement = { center: world([x,y,z]), yaw: hb.placeYaw(0,hb.place), x0,x1,z0,z1 };
      break;
    }
    return placement;
  };

  // Each crayon has a wax tip, paper wrapper and contrasting bands.
  function crayon(add, pos, axis, color, length=.18, radius=.014) {
    const dir = new THREE.Vector3(...axis).normalize(), base = new THREE.Vector3(...pos);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
    function section(y, h, bottom, top, tint) {
      const at = base.clone().addScaledVector(dir,y);
      add(new THREE.CylinderGeometry(top,bottom,h,8).applyQuaternion(q).translate(at.x,at.y,at.z), tint);
    }
    section(length*.42,length*.84,radius,radius,color);
    section(length*.92,length*.16,radius,.001,color);
    for (const y of [.12,.7]) section(length*y,.006,radius+.0008,radius+.0008,0xf8e6b9);
  }
  function floorSupplies() {
    const geo=V3.shellKit.sculpt(({add,beam})=>{
      const box=(x,y,z,w,h,d,col,turn=0)=>add(new THREE.BoxGeometry(w,h,d).rotateY(turn).translate(x,y,z),col);
      // Woven picnic blanket with a sage border, double stripes and short cotton fringe at either end.
      box(0,.011,.65,1.5,.018,2.01,0xc6d4ba);
      box(0,.021,.65,1.42,.002,1.92,0xeddfbb);
      for(const side of [-1,1]){
        for(const dx of [.64,.67])box(dx*side,.023,.65,.011,.002,1.90,0x70958b);
        for(const dz of [.84,.88])box(0,.024,.65+side*dz,1.41,.002,.012,0xb58168);
        for(let i=0;i<28;i++){
          const x=-.705+i*.052, z=.65+side*1.005;
          beam([x,.014,z],[x+.008*Math.sin(i*1.9),.009,z+side*(.03+(i%3)*.004)],.004,.003,0xe6cfaa,5);
        }
      }
      // Open ring-bound sketchbook plus loose sheets beneath the page in use.
      box(-.073,.029,sheetZ,.64,.009,.339,0x557b77,-.025);
      box(-.222,.036,sheetZ,.282,.008,.318,0xf4e7c6);
      box(sheetX,.038,sheetZ,.327,.01,.331,0xf7e8c9,.04);
      box(sheetX,.045,sheetZ,.314,.005,.319,0xffeed0,-.03);
      for(let i=0;i<6;i++)add(new THREE.TorusGeometry(.012,.0035,5,12).rotateY(Math.PI/2).translate(-.043,.046,sheetZ-.132+i*.049),0x8f795f);
      for(let i=0;i<4;i++)box(-.21,.043,sheetZ-.093+i*.037,.15-i*.016,.002,.005,0xc3b796,-.03*i);
      box(-.45,.034,.33,.238,.003,.27,0xfcf0d5,.18);
      box(-.47,.038,.32,.231,.003,.266,0xfff5de,.11);
      // An open metal crayon box with a hinged lid and individually wrapped crayons.
      box(.454,.037,-.158,.44,.028,.165,trim,-.05);
      box(.454,.053,-.158,.414,.006,.146,0xf2d697,-.05);
      add(new THREE.BoxGeometry(.43,.012,.16).rotateX(-1.04).translate(.454,.115,-.273),teal);
      for(let i=0;i<7;i++)crayon(add,[.277+i*.058,.069,-.219],[.028,0,1],pigments[i],.12,.013);
      crayon(add,[.51,.043,.15],[.89,0,.45],pigments[1],.174,.013);
      crayon(add,[.46,.044,.23],[.75,0,.66],pigments[5],.15,.013);
      // Two wax shavings beside the tin and a folded triangular corner on the loose sheet.
      for(let i=0;i<2;i++)add(new THREE.TorusGeometry(.013,.003,4,8,Math.PI*1.6).rotateX(Math.PI/2).translate(.37+i*.048,.032,.18),pigments[i]);
      box(-.53,.042,.44,.075,.003,.017,0xdfca9e,.1);
    });
    return new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92}));
  }
  function makePaper() {
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=384;
    const g=canvas.getContext('2d'); g.fillStyle='#fff4d9'; g.fillRect(0,0,384,384);
    return {canvas,g};
  }

  // Small wax-crayon studies of the shore, laid out differently for each drawing.
  function sketch() {
    const {canvas,g}=makePaper(), w=canvas.width;
    const rand=(a,b)=>a+Math.random()*(b-a);
    const skies=['#f8e8c9','#f6dad0','#e3e7dc'], seas=['#83b8ba','#8ab8c8','#7fabac'];
    const hue=Math.floor(rand(0,3)), horizon=rand(185,230), sunX=rand(62,303);
    const line=(pts,col,size)=>{
      g.strokeStyle=col;g.lineWidth=size;g.lineCap='round';g.lineJoin='round';g.beginPath();
      pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke();
    };
    // Broken, overlapping lines leave the tooth of the paper visible within the sky and sea.
    for(let y=21;y<358;y+=3) for(let x=21;x<352;x+=26) {
      const sea=y>horizon+Math.sin(x*.012)*3;
      g.globalAlpha=rand(.45,.87);
      line([[x+rand(-3,3),y],[x+rand(7,18),y+rand(-1,1)],[Math.min(363,x+rand(22,35)),y+rand(-2,2)]],sea?seas[hue]:skies[hue],rand(3,5));
    }
    g.globalAlpha=1;
    const sunY=rand(69,115);g.fillStyle='#df9967';g.beginPath();g.arc(sunX,sunY,22,0,Math.PI*2);g.fill();
    for(let i=0;i<36;i++){const y=rand(horizon+9,349),x=rand(24,320);line([[x,y],[x+rand(9,33),y-1]],i%3?'#cde4d6':'#fff2c9',rand(1,3));}
    const boatX=rand(117,261), boatY=horizon+rand(15,43);
    const polygon=(p,c)=>{g.beginPath();p.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fillStyle=c;g.fill();};
    let title;
    if(Math.random()<.5){
      title='蜡笔小画 · 归帆';
      line([[boatX,boatY],[boatX,boatY-77]],'#586c73',4);
      polygon([[boatX-4,boatY-73],[boatX-38,boatY-10],[boatX-4,boatY-12]],'#f4d29a');
      polygon([[boatX+4,boatY-64],[boatX+27,boatY-10],[boatX+3,boatY-13]],'#c57560');
      polygon([[boatX-46,boatY-5],[boatX+41,boatY-6],[boatX+25,boatY+8],[boatX-26,boatY+8]],'#576c76');
    }else{
      title='蜡笔小画 · 灯塔';
      polygon([[boatX-60,boatY+9],[boatX-26,boatY-8],[boatX+26,boatY-10],[boatX+60,boatY+8]],'#849181');
      polygon([[boatX-15,boatY],[boatX-10,boatY-64],[boatX+10,boatY-64],[boatX+16,boatY]],'#f9ecd0');
      polygon([[boatX-13,boatY-15],[boatX-12,boatY-29],[boatX+12,boatY-29],[boatX+13,boatY-15]],'#ba6e5d');
      g.fillStyle='#526971';g.fillRect(boatX-12,boatY-78,24,15);g.fillStyle='#f5cb7e';g.fillRect(boatX-7,boatY-75,14,8);
      polygon([[boatX-18,boatY-78],[boatX,boatY-91],[boatX+18,boatY-78]],'#a65c55');
    }
    for(let i=0;i<4;i++){const x=rand(45,330),y=rand(50,160),s=rand(5,10);line([[x-s,y-3],[x,y],[x+s,y-4]],'#65767c',2);}
    // Tiny exposed paper flecks give the solid illustration the same grain as its background.
    g.fillStyle='#fff4d9';g.globalAlpha=.32;
    for(let i=0;i<3500;i++)g.fillRect(rand(22,w-22),rand(22,w-22),rand(.4,1.6),.9);
    return {image:canvas,title};
  }
  const errorText = { 'album-full':'相册已经满了', 'missing-album':'屋里没有相册矮桌', 'storage-failed':'小屋暂时无法保存', arranging:'正在布置小屋' };
  function saveLocal(drawing) {
    const share = window.__cabinBridge?.api?.queueDrawing;
    if (share && !drawing.queuedForQQ) {
      try {
        share(drawing.title, drawing.original || drawing.image.toDataURL('image/png'));
        drawing.queuedForQQ = true;
      } catch { notify('画已完成，暂时无法把原图加入 QQ 发送队列。'); }
    }
    if (drawing.saving) return drawing.saving;
    drawing.saving = persistDrawing(drawing).finally(() => { drawing.saving = null; });
    return drawing.saving;
  }
  async function persistDrawing(drawing) {
    try {
      const blob=drawing.original ? await (await fetch(drawing.original)).blob() :
        await new Promise(resolve=>drawing.image.toBlob(resolve,'image/png'));
      const {photo}=await V3.album.fromFile(blob,drawing.title);
      const result=await V3.album.storeDrawing(photo);
      if (!result.ok) throw Error(errorText[result.why] || '相册暂时不可用');
      if(unsaved===drawing)unsaved=null;
      notify(result.duplicate?'这张画已经在相册里了。':'她把《'+drawing.title+'》放进了相册。');
    } catch(error) {notify(error.message+'。这张画留在地垫上，点画角可再存一次。');}
  }

  function requestDrawing(job, expired) {
    const room=live;
    function start() {
      if (!room || room!==live || session || unsaved || (job && external!==job)) return false;
      startingJob=job;
      try { return !!V3.actor?.startBehavior('draw',{interrupt:true,run:true}); }
      finally { startingJob=null; }
    }
    const night=V3.cabinNight?.state(), current=V3.actor?.behavior;
    if(night?.enabled && night.window && night.due && (!current || current.leisure || current.hold || current.kind==='sleep') && V3.cabinRoutine?.requestDrawing)
      return V3.cabinRoutine.requestDrawing(start,expired);
    return start();
  }
  A.invite = async () => {
    if(unsaved){void saveLocal(unsaved);return;}
    if(session?.image){notify(session.finished ? '她画好了，还在画垫上欣赏刚画的画。' : '她正在画这张画。');return;}
    if(session && !V3.actor?.cancelBehavior('player'))return;
    const busy=()=>notify('她现在还走不开，等一会儿再请她来画吧。');
    if(external){notify(external.manual ? '她正在准备这张画。' : '她现在还走不开。');return;}
    const generate=window.__cabinBridge?.api?.generateDrawing;
    const room=live, night=V3.cabinNight?.state();
    if(!room || (!(night?.enabled && night.window && night.due) && V3.actor?.behaviorAvailability?.('draw',{interrupt:true})?.available===false)){
      busy();return;
    }
    const job={manual:true};
    external=job;
    try {
      if(generate) notify('她正在构思这张画。');
      const result=generate ? await generate() : null;
      if(result){
        const image=new Image(); image.src=result.image; await image.decode();
        job.sheet={image,title:result.title,original:result.image};
      }
    } catch { /* The local sketchbook is available when the assistant cannot draw. */ }
    if(room!==live || external!==job)return;
    const expired=()=>{if(external===job)external=null;busy();};
    if(!requestDrawing(job,expired)) expired();
    else notify(job.sheet ? '她构思好了，去阁楼画给你看。' : '她会去阁楼给你画一张蜡笔画。');
  };
  A.drawForAlbum = async ({imageUrl}) => {
    if(!live || external || session || !imageUrl) return false;
    if(unsaved?.saving) await unsaved.saving;
    if(unsaved || external || session || !live) return false;
    const job={}; external=job;
    try {
      const image=new Image(); image.src=imageUrl; await image.decode();
      if(external!==job || !live || session || unsaved)return false;
      job.image=image;
      const result=new Promise(resolve=>{ job.resolve=resolve; });
      if(!requestDrawing(job,()=>job.resolve(false)))return false;
      return await result;
    } catch {return false;}
    finally {if(external===job)external=null;}
  };

  function reveal(drawing, progress) {
    const {g,canvas,map}=live, n=canvas.width, band=Math.min(32,Math.floor(progress*32)), tail=progress*32-band;
    const edge=Math.round((band%2 ? 1-tail : tail)*n);
    const marker=band*256+Math.round(tail*128);
    if(marker===drawing.marker)return; drawing.marker=marker;
    g.fillStyle='#fff4d9';g.fillRect(0,0,n,n);
    const h=n/32;
    g.save();g.beginPath();g.rect(0,0,n,band*h);
    if(band<32)g.rect(band%2?edge:0,band*h,band%2?n-edge:edge,h);
    g.clip();
    const image=drawing.image, w=image.naturalWidth||image.width, ht=image.naturalHeight||image.height;
    const scale=n/Math.max(w,ht), width=w*scale, height=ht*scale;
    g.drawImage(image,(n-width)/2,(n-height)/2,width,height);g.restore();map.needsUpdate=true;
  }
  function finishSheet(drawing) {
    if (drawing.finished) return;
    drawing.finished = true;
    if (!drawing.image) return;
    reveal(drawing, 1);
    if (drawing.job) drawing.job.resolve(true);
    else { unsaved = drawing; void saveLocal(drawing); }
  }
  function behavior(e) {
    if(e.kind!=='draw' || !live)return;
    if(e.phase==='started'){
      if(startingJob?.manual){
        session=startingJob.sheet || sketch();
        external=null;
      }else session=startingJob ? {image:startingJob.image,job:startingJob} : {};
      if(session.image)reveal(session,0);
      else { live.g.fillStyle='#fff4d9';live.g.fillRect(0,0,live.canvas.width,live.canvas.height);live.map.needsUpdate=true; }
    } else if(e.phase==='action' && session)session.onsite=true;
    else if((e.phase==='completed'||e.phase==='cancelled') && session) {
      const drawing=session;session=null; live.pen.visible=false;
      if(e.phase==='completed' && drawing.onsite) finishSheet(drawing);
      else if(!drawing.finished) drawing.job?.resolve(false);
    }
  }
  const aim=new THREE.Vector3(),tip=new THREE.Vector3(),hand=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  V3.scene.part({id:'art-desk',label:'阁楼地板画角',order:71,
    build(ctx) {
      const layer=new THREE.Group();layer.name='loft-art-station';layer.userData.layer='loft';
      const root=new THREE.Group();root.name='loft-crayon-mat';root.userData.clickable='artDesk';layer.add(root);
      const body=floorSupplies();body.receiveShadow=body.castShadow=true;root.add(body);
      const {canvas,g}=makePaper(), map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
      const page=new THREE.Mesh(new THREE.PlaneGeometry(sheetSize,sheetSize).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({map,roughness:.96}));
      page.position.set(sheetX,sheetY,sheetZ);root.add(page);
      const pen=new THREE.Mesh(V3.shellKit.sculpt(({add})=>crayon(add,[0,0,0],[0,1,0],pigments[4],.18,.012)),new THREE.MeshStandardMaterial({vertexColors:true}));
      pen.visible=false;layer.add(pen);
      live=ctx.artDesk={root,pen,canvas,g,map};V3.on('actor:behavior',behavior);
      return layer;
    },
    update(dt,t,ctx) {
      const d=ctx.artDesk, spot=A.spot();d.root.visible=!!spot;
      if(!spot)return;
      if(d.spot!==spot){d.spot=spot;d.root.position.set(...spot.center);d.root.rotation.y=spot.yaw;d.root.updateMatrixWorld(true);}
      const p=V3.actor?.drawingProgress;
      if(session?.onsite && p === 1) finishSheet(session);
      d.pen.visible=session?.onsite===true && !session.finished && p!=null;
      const row=p==null ? 0 : Math.min(31,Math.floor(p*32));
      if(!d.pen.visible)return;
      if(session.image)reveal(session,p);
      const phase=Math.min(1,p*32-row);
      tip.set(sheetX+sheetSize*((row%2?1-phase:phase)-.5),sheetY+.002,sheetZ+sheetSize*(row/31-.5));
      d.root.localToWorld(tip);
      aim.copy(tip);aim.y+=.103;aim.z+=.032*Math.cos(spot.yaw);aim.x+=.032*Math.sin(spot.yaw);
      V3.actor.aimHand?.(aim,1);V3.actor.hand(hand);
      // Tip rests on the sheet; barrel extends back toward her fingers.
      d.pen.position.copy(tip);d.pen.quaternion.setFromUnitVectors(up,aim.copy(hand).sub(tip).normalize().negate());
      d.pen.position.addScaledVector(aim,-.18);
    },
    dispose(ctx) {
      if(live!==ctx.artDesk)return;
      V3.off('actor:behavior',behavior);external?.resolve?.(false);external=null;session=null;
      live.map.dispose();live=null;
    }
  });
})(window.V3);
