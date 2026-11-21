// 望远镜里的星图。打开或拍照时绘制，用同一个 J2000 → 地平矩阵；小屋相机和存档都不用动。
(function (V3) {
  'use strict';
  const S=V3.stars, L=V3.starLines, el=V3.util.el, D=Math.PI/180, clamp=THREE.MathUtils.clamp;
  const smooth=V3.util.smooth, drawTime=540, fadeTime=220;
  const compass=['北','东北','东','东南','南','西南','西','西北'];
  const stories={Ori:'腰间的三颗星排成一线。两侧的参宿四与参宿七，一红一蓝。',
    Cyg:'天津四在天鹅的尾部，长长的十字形沿着银河伸展。', UMa:'北斗七星是大熊的一部分，斗柄向外画出一道弧。',
    UMi:'沿小熊的尾巴找到北极星，就能认出北方。', Lyr:'先找明亮的织女星，再看它旁边几颗较暗的星组成的小四边形。',
    CMa:'从猎户腰带向东南延长，就能找到格外明亮的天狼星。', Cas:'五颗主星折成醒目的 W，绕着北天极转动。',
    Sco:'从红色的心宿二往后看，一串星弯成了蝎子的尾钩。', Tau:'毕宿五在牛的眼睛处，旁边的星排成一个 V 字。',
    Aql:'牛郎星两边各伴着一颗稍暗的星，三颗星近乎排成一线。', Ser:'蛇头与蛇尾分居蛇夫座两侧，共用一个星座名字。'};
  const planetStory={Mercury:'它离太阳最近，通常要在日落后或日出前的低空寻找。',Venus:'它披着厚云，有时在晨光里出现，有时在晚霞中出现。',
    Mars:'火星表面的铁氧化物，让它从远处看也泛着暖红色。',Jupiter:'太阳系中体积最大的行星，肉眼看起来像一颗很亮的星。',Saturn:'光环环绕在它的赤道上，在夜空里它呈柔和的淡黄色。'};
  let live=null;
  const dir=(az,alt)=>new THREE.Vector3(Math.sin(az*D)*Math.cos(alt*D),Math.sin(alt*D),-Math.cos(az*D)*Math.cos(alt*D));
  const wrap=a=>(a%360+360)%360;
  const defaultPose=site=>({az:site.lat<0 ? 25 : 155,alt:24,fov:78});
  const inFrame=(p,w,h)=>!!p && p.x>=0 && p.x<=w && p.y>=0 && p.y<=h;
  const behindMoon=(v,st)=>st.moonAlt>0 && v.dot(st.moonDir)>.99998;
  function skyCatalog(site,st) {
    const at={...site,date:st.ms};
    return {matrix:S.frame(at),points:S.visible({...at,sunAlt:st.sunAlt,moonAlt:st.moonAlt,moonIllum:st.moonIllum,wx:st.wx})};
  }
  const skyKey=(site,st)=>[Math.floor(st.ms/1000),site.lat,site.lon,site.tz,S.limit(st).toFixed(2)].join('/');
  function aimProjection(width,height,focal,fwd,right,up) {
    return v=>{
      const z=v.dot(fwd); if(z<=.04) return null;
      return {x:width/2+v.dot(right)*focal/z,y:height/2-v.dot(up)*focal/z};
    };
  }
  // The same astronomical canvas paint is used by the dialog and the detached photo.
  function paintSky(ctx,width,height,az,alt,focal,project,ray,matrix,points,st,screen,objects) {
    const horizon=height/2+focal*Math.tan(alt*D), base=clamp(horizon,height*.6,height*2);
    const gradient=ctx.createLinearGradient(0,0,0,base);
    gradient.addColorStop(0,'#091222'); gradient.addColorStop(.68,'#16253b'); gradient.addColorStop(1,'#334652');
    ctx.fillStyle=gradient; ctx.fillRect(0,0,width,height);
    // 真银道大圆。柔和的宽窄两层沿同一条弧走，不添加假星。
    const pole=S.vector(192.85948,27.12825), a=new THREE.Vector3().crossVectors(pole,new THREE.Vector3(0,0,1)).normalize();
    const b=new THREE.Vector3().crossVectors(pole,a); a.applyMatrix4(matrix); b.applyMatrix4(matrix);
    ctx.save(); ctx.beginPath(); let pen=false;
    for(let i=0;i<=180;i++) {
      const d=ray.copy(a).multiplyScalar(Math.cos(i*2*D)).addScaledVector(b,Math.sin(i*2*D));
      const p=d.y>0 && project(d); if(p) { if(pen)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y); } pen=!!p;
    }
    for(const [w,opacity] of [[.18,.009],[.13,.013],[.08,.017],[.045,.012]]) { ctx.strokeStyle=`rgba(198,209,238,${opacity})`; ctx.lineWidth=focal*w; ctx.stroke(); }
    ctx.restore(); screen?.clear();
    let stars=0;
    for(const s of points) {
      if(behindMoon(s.dir,st)) continue;
      const p=project(s.dir); if(!p) continue;
      if(screen && (s.hr || s.planet)) screen.set(s.hr || s.latin,{...p,s});
      if(!inFrame(p,width,height)) continue;
      if(!s.planet) stars++;
      if(objects && s.name) objects.push({name:s.name,latin:s.latin,kind:s.planet ? 'planet' : 'star',magnitude:s.mag});
      const {base:r,alpha}=L.size(s.mag);
      ctx.globalAlpha=alpha; ctx.fillStyle=s.color;
      ctx.beginPath();ctx.arc(p.x,p.y,r,0,2*Math.PI);ctx.fill();
      if(s.mag<1.2) { ctx.globalAlpha=.09;ctx.beginPath();ctx.arc(p.x,p.y,r*2.8,0,2*Math.PI);ctx.fill(); }
    }
    ctx.globalAlpha=1;
    const moon=project(st.moonDir);
    if(moon && st.moonAlt>0) {
      const r=Math.max(2,focal*.0045); ctx.save();ctx.translate(moon.x,moon.y);
      const sun=project(st.sunDir.clone().addScaledVector(st.moonDir,2).normalize());
      if(sun) ctx.rotate(Math.atan2(sun.y-moon.y,sun.x-moon.x));
      ctx.fillStyle='#283549';ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#f7ecd3';ctx.beginPath();ctx.arc(0,0,r,-Math.PI/2,Math.PI/2);
      const phase=1-2*st.moonIllum; ctx.ellipse(0,0,Math.max(.001,r*Math.abs(phase)),r,0,Math.PI/2,-Math.PI/2,phase>0);ctx.fill();ctx.restore();
    }
    ctx.textAlign='center';ctx.font='12px sans-serif';
    for(let i=0;i<8;i++) {
      const delta=(wrap(i*45-az+180)-180)*D; if(Math.abs(delta)>Math.PI/2) continue;
      const x=width/2+focal*Math.tan(delta)/Math.cos(alt*D), y=clamp(horizon-9,62,height-24);
      ctx.fillStyle='#aabfbe';ctx.fillText(compass[i],x,y);
    }
    return {horizon,stars,moon:st.moonAlt>0 && inFrame(moon,width,height)};
  }
  function season(ra) { return ['秋季','冬季','春季','夏季'][Math.floor(wrap(ra+45+(V3.env.astro.site().lat<0?180:0))/90)]; }
  function skyIssue() {
    const st=V3.env.state;
    if(st.sunAlt>=-6) return {ok:false,error:'daytime',text:'等天黑，再一起来看星星吧。'};
    if(!Number.isFinite(S.limit(st))) return {ok:false,error:'sky_obscured',text:'云太厚了，等等再看吧。'};
    return null;
  }
  const reason=()=>skyIssue()?.text || '';
  function close() {
    if(!live) return;
    const {modal,frameId,previous,dispose}=live; live=null; dispose();
    cancelAnimationFrame(frameId); modal.close(); modal.remove(); previous?.focus?.({preventScroll:true});
  }
  function open({fromTelescope=false}={}) {
    if(live) { live.fromTelescope ||= fromTelescope; return true; }
    const why=reason(); if(why) { V3.hud?.toast(why); return false; }
    const cv=el('canvas',{'aria-label':'星空',tabIndex:0});
    const overlay=el('canvas',{class:'sv-ink','aria-hidden':'true'});
    const names=el('div',{class:'sv-chart-names'}), sea=V3.starHorizon.ocean();
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    const dial=V3.starHorizon.compass(()=>{pointer=pinned=null;card.hidden=true;fly({az:0,alt,fov});});
    const back=el('button',{type:'button',onclick:close},'回小屋');
    const date=el('small'), heading=el('header',{},el('div',{},el('h2',{},'阁楼星空'),date),back);
    const list=el('div',{class:'sv-list'}), menu=el('details',{class:'sv-index'},el('summary',{},'今晚能看到'),list);
    const all=el('input',{type:'checkbox'}), tools=el('div',{class:'sv-tools'},el('label',{class:'sv-switch'},all,'星座连线'),menu);
    const chinese=el('strong'), latin=el('i'), detail=el('small');
    const label=el('span',{class:'sv-label',hidden:true},chinese,latin,detail), card=el('article',{hidden:true});
    const quote=el('blockquote',{},V3.actor?.stargazeLine?.() || '你也来看一眼嘛。');
    const sources=el('details',{class:'sv-sources'},el('summary',{},'数据来源'),
      el('div',{},el('p',{},'恒星取自耶鲁亮星星表第五修订版（BSC5，VizieR V/50）。'),
        el('p',{},'星座名称、连线与边界取自 d3-celestial。© 2015 Olaf Frohn，BSD-3-Clause 许可。')));
    const modal=el('dialog',{class:'star-view','aria-label':'阁楼星空'},cv,sea.canvas,overlay,names,heading,dial.button,tools,label,card,quote,sources);
    const previous=document.activeElement;
    document.body.append(modal); modal.showModal(); cv.focus({preventScroll:true});
    modal.addEventListener('cancel',e=>{ e.preventDefault(); close(); });
    const ctx=cv.getContext('2d'), ink=overlay.getContext('2d'), poles=new Map(), screen=new Map(), nodes=new Map();
    const fwd=dir(0,0), right=dir(90,0), up=new THREE.Vector3(), ray=new THREE.Vector3();
    const view=live={modal,previous,frameId:0,fromTelescope,pose(site,st){
      const current=!dirty && catalogTime===st.ms && stamp===skyKey(site,st);
      return {az,alt,fov,width,height,frame:current ? {canvas:cv,matrix,points} : null};
    }};
    let {az,alt,fov}=defaultPose(V3.env.astro.site());
    let width=0, height=0, scale=1, focal=1, matrix, inverse, project;
    let points=[], menuKey=null, stamp='', catalogTime=null, pointer=null, pinned=null, dirty=true;
    let hover=null, candidate=null, since=0, caption=null, placement=null, layoutDirty=true, chart=null;
    const tracks=[{key:'con'},{key:'group'}];
    const pointers=new Map(); let dragged=false, pinch=0;
    let flight=null, namesDirty=true;
    const obstacles=()=>[heading,dial.button,tools,card,quote,sources,...(menu.open?[list]:[]),...(sources.open?[sources.lastElementChild]:[])].filter(e=>!e.hidden).map(e=>e.getBoundingClientRect());
    function fly(to) {
      if(!to)return;
      flight={from:{az,alt,fov},to,start:performance.now()};invalidate();
    }
    function fitConstellation(c) {
      const members=[...L.plan(c).nodes.keys()].map(hr=>poles.get(hr)).filter(v=>v?.y>0);
      const cardTop=width<600 && !card.hidden ? card.getBoundingClientRect().top : height-35;
      const safe={left:18,right:width-18,top:Math.min(height*.24,dial.button.getBoundingClientRect().bottom+9),bottom:cardTop-14};
      if(safe.bottom<safe.top+50)safe.top=10;
      const blocks=obstacles(), pose={az,alt,fov};
      let target=V3.starFraming.fit(members,pose,width,height,safe,blocks);
      if(target && width>=600 && !card.hidden) {
        const rect=card.getBoundingClientRect(),lens=height/2/Math.tan(target.fov*D/2),project=V3.starFraming.plane(target.az,target.alt);
        if(members.some(v=>{const p=project(v),x=width/2+p.x*lens,y=height/2+p.y*lens;return x<rect.right+8 && y>rect.top-8;})) {
          const alternatives=[{...safe,left:rect.right+14},{...safe,bottom:rect.top-14}];
          const fits=alternatives.map(box=>V3.starFraming.fit(members,pose,width,height,box,blocks)).filter(Boolean);
          if(fits.length) target=fits.sort((a,b)=>a.score-b.score)[0];
        }
      }
      if(target) {fly(target);return true;}
      return false;
    }
    function aim(target) {
      menu.open=false;pointer=null;card.hidden=true;flight=null;
      pinned=target.con ? {con:target.con} : {star:target.star};
      if(target.con) fitConstellation(target.con);
      else fly({az:wrap(Math.atan2(target.v.x,-target.v.z)/D),alt:Math.asin(target.v.y)/D,fov});
      layoutDirty=namesDirty=pickDirty=true;wake();
    }
    function refresh(site,st) {
      ({matrix,points}=skyCatalog(site,st)); catalogTime=st.ms; inverse=matrix.clone().invert();
      poles.clear();
      const targets=[], limit=S.limit(st);
      for(const c of S.atlas) {
        const center=S.vector(...c.center).applyMatrix4(matrix);
        // 巨蛇的两段、横跨地平线的星座也能从可见的连线端点找到。
        let top=null;
        for(const hr of c.lines.flat()) {
          if(!poles.has(hr)) poles.set(hr,S.byHR.get(hr).v.clone().applyMatrix4(matrix));
          const p=poles.get(hr); if(S.byHR.get(hr).mag<=limit && (!top || p.y>top.y)) top=p;
        }
        if(top && top.y>Math.sin(12*D)) targets.push({id:c.id,name:c.name,con:c,v:center.y>.20 ? center : top});
      }
      for(const p of points.filter(p=>p.planet && p.alt>=12)) targets.push({id:p.latin,name:p.name,star:p,v:p.dir});
      targets.sort((a,b)=>b.v.y-a.v.y);
      view.targets=new Map(targets.map(t=>[t.id,t]));
      const key=targets.map(t=>t.id).join('/');
      if(key!==menuKey) {
        list.replaceChildren(...targets.map(t=>el('button',{type:'button','data-sky':t.id,onclick:()=>aim(view.targets.get(t.id))},t.name)));
        if(!targets.length) list.append(el('span',{},'暮光里还看不清星座。'));
        menuKey=key;
      }
      date.textContent=st.day+' · '+V3.env.hhmm(st.hour)+'　'+Math.abs(site.lat).toFixed(1)+'°'+(site.lat<0?'S':'N')+' '+Math.abs(site.lon).toFixed(1)+'°'+(site.lon<0?'W':'E');
    }
    function sight(x,y) {
      return ray.copy(fwd).addScaledVector(right,(x-width/2)/focal).addScaledVector(up,(height/2-y)/focal).normalize();
    }
    function hit(x,y) {
      const d=sight(x,y); if(d.y<0) return null;
      const v=d.clone().applyMatrix4(inverse);
      const con=S.region(Math.atan2(v.y,v.x)/D,Math.asin(clamp(v.z,-1,1))/D);
      let star=null, dist=14;
      for(const p of screen.values()) {
        if(!p.s.name) continue;
        const delta=Math.hypot(p.x-x,p.y-y); if(delta<dist) { star=p.s; dist=delta; }
      }
      // 星群的线附近也能命中；大三角内部仍然留给正式星座。
      let group=null, near=7;
      for(const g of S.groups) for(const line of g.lines) for(let i=1;i<line.length;i++) {
        const a=screen.get(line[i-1]), b=screen.get(line[i]); if(!a || !b) continue;
        const dx=b.x-a.x,dy=b.y-a.y,k=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy || 1),0,1);
        const delta=Math.hypot(x-a.x-k*dx,y-a.y-k*dy); if(delta<near) { group=g; near=delta; }
      }
      return con || star || group ? {con,star,group} : null;
    }
    function describe(h) {
      if(!h) { card.hidden=true; return; }
      const {star,con,group}=h, object=star || group || con;
      const title=el('h3',{},object.name), fields=[];
      if(star?.planet) fields.push(`此刻高度 ${star.alt.toFixed(0)}°`,planetStory[star.latin]);
      else {
        const members=group?.lines.flat().map(hr=>S.byHR.get(hr));
        const bright=members && !star ? members.reduce((a,b)=>a.mag<b.mag?a:b) : S.byHR.get(con?.bright);
        const ra=star?.ra ?? (members ? members[0].ra : con.center[0]);
        fields.push('晚间观赏 · '+season(ra), '最亮的星 · '+(bright?.name || con?.designation || 'HR '+bright.hr));
        if(star) fields.push(`${star.name}位于${con?.name || '这片天区'}，视星等为 ${star.mag.toFixed(2)}。`);
        else fields.push(group?.about || stories[con.id] || `顺着亮起的连线，可以在天上认出${con.name}。它的星图由 ${new Set(con.lines.flat()).size} 颗星勾出。`);
      }
      card.replaceChildren(el('button',{type:'button','aria-label':'收起卡片',onclick:()=>{card.hidden=true;layoutDirty=namesDirty=true;wake();}},'×'),title,el('i',{},object.latin),...fields.map(s=>el('p',{},s)));
      card.hidden=false; menu.open=false;
    }
    function linePath(path,c,progress,active) {
      for(const e of L.plan(c).edges) {
        const a=nodes.get(e.a), b=nodes.get(e.b);
        if(!a || !b || progress<=e.start) continue;
        const g=L.trim(a,b,active ? a.lit+2 : a.base+1.6,active ? b.lit+2 : b.base+1.6);
        if(!g) continue;
        const t=clamp((progress-e.start)/(e.end-e.start),0,1);
        path.moveTo(g.x,g.y);path.lineTo(g.x+g.dx*t,g.y+g.dy*t);
      }
    }
    function paint() {
      focal=height/2/Math.tan(fov*D/2); fwd.copy(dir(az,alt)); right.copy(dir(az+90,0)); up.crossVectors(right,fwd);
      project=aimProjection(width,height,focal,fwd,right,up);
      const st=V3.env.state, {horizon}=paintSky(ctx,width,height,az,alt,focal,project,ray,matrix,points,st,screen);
      nodes.clear();
      for(const [hr,v] of poles) {
        if(v.y<=0 || behindMoon(v,st)) continue;
        const p=project(v), s=S.byHR.get(hr);
        if(p) nodes.set(hr,{...p,...L.size(s.mag),s});
      }
      chart=null;
      const lights=[];
      function reflection(v,color,strength,seed,isMoon) {
        const surface=project(ray.set(v.x,0,v.z).normalize());
        if(!surface || surface.x<0 || surface.x>width || strength<=0)return;
        const mirror=project(ray.set(v.x,-v.y,v.z));
        lights.push({x:surface.x,color,alpha:strength,seed,moon:isMoon,depth:Math.max(18,(mirror ? mirror.y-horizon : height)*1.35)});
      }
      if(horizon<height) {
        for(const p of screen.values()) if(!p.s.planet && p.s.mag<.8 && p.y>=0 && p.x>=0 && p.x<=width)
          reflection(p.s.dir,p.s.color,clamp((1.7-p.s.mag)*.15,.12,.46),p.s.hr,false);
        if(st.moonAlt>0) reflection(st.moonDir,'#f0dfb8',st.moonIllum*.7,17,true);
      }
      sea.update(width,height,horizon,az,lights,reduced.matches);
      dirty=false;layoutDirty=namesDirty=true;
    }
    function select(h,now) {
      for(const track of tracks) {
        const object=h?.[track.key];
        if(track.current?.object===object) continue;
        if(track.current) track.old={...track.current,leave:now};
        track.current=object ? {object,start:now} : null;
      }
      if(h?.con!==hover?.con || h?.group!==hover?.group || h?.star?.name!==hover?.star?.name) layoutDirty=namesDirty=true;
      hover=h;
      if(h) caption=h;
    }
    function drawLabel(h,alpha) {
      if(!h || alpha<=0) { if(!label.hidden)namesDirty=true;label.hidden=true; placement=null; return; }
      label.style.opacity=alpha;
      if(!layoutDirty) return;
      layoutDirty=false;
      const object=h.con || h.group || h.star, extra=[h.star,h.group].filter(s=>s && s!==object).map(s=>s.name).join(' · ');
      if(chinese.textContent!==object.name) chinese.replaceChildren(...[...object.name].map(ch=>el('span',{},ch)));
      latin.textContent=object.latin;detail.textContent=extra;detail.hidden=!extra;
      label.hidden=false;
      const members=[],segments=[];
      for(const c of [h.con,h.group].filter(Boolean)) {
        const route=L.plan(c);
        for(const hr of route.nodes.keys()) {
          const p=nodes.get(hr); if(p && p.x>=0 && p.x<=width && p.y>=0 && p.y<=height) members.push(p);
        }
        for(const {a,b} of route.edges) if(nodes.has(a) && nodes.has(b)) segments.push([nodes.get(a),nodes.get(b)]);
      }
      if(!members.length && h.star && screen.has(h.star.hr || h.star.latin)) members.push(screen.get(h.star.hr || h.star.latin));
      // 刚进出画面的星逐渐参与求中心，避免边缘的一颗星让名字突然挪位。
      let sx=0,sy=0,total=0;
      for(const p of members) {
        const weight=clamp(Math.min(p.x,width-p.x,p.y,height-p.y)/44,.01,1);
        sx+=p.x*weight;sy+=p.y*weight;total+=weight;
      }
      const center=total ? {x:sx/total,y:sy/total} : h.con && project(S.vector(...h.con.center).applyMatrix4(matrix));
      if(!center || center.x<0 || center.x>width || center.y<0 || center.y>height) { label.hidden=true;return; }
      const blocks=obstacles();
      for(const p of [...members,...screen.values()]) if(!p.s || p.s.mag<2.6 || p.lit) blocks.push({left:p.x-4,right:p.x+4,top:p.y-4,bottom:p.y+4});
      const spot=L.labelSpot(center,label.offsetWidth,label.offsetHeight,{w:width,h:Math.min(height,height/2+focal*Math.tan(alt*D))},blocks,segments,placement?.object===object ? placement : null);
      if(!spot) {label.hidden=true;return;}
      label.style.left=spot.x+'px';label.style.top=spot.y+'px';placement={...spot,object};namesDirty=true;
    }
    function drawNames() {
      if(!namesDirty)return;
      namesDirty=false;
      if(!all.checked) {names.replaceChildren();return;}
      const area={w:width,h:Math.min(height,height/2+focal*Math.tan(alt*D)-16)};
      const blocks=obstacles(), candidates=[],segments=[];
      if(!label.hidden && placement) blocks.push({left:placement.x,top:placement.y,right:placement.x+label.offsetWidth,bottom:placement.y+label.offsetHeight});
      for(const p of screen.values()) if(p.s.mag<2.6) blocks.push({left:p.x-3,right:p.x+3,top:p.y-3,bottom:p.y+3});
      for(const c of S.atlas) {
        const route=L.plan(c), dots=[];
        for(const hr of route.nodes.keys()) {
          const p=nodes.get(hr);if(p && p.x>=0 && p.x<=width && p.y>=0 && p.y<=area.h)dots.push(p);
        }
        for(const e of route.edges) {
          const a=nodes.get(e.a),b=nodes.get(e.b);if(a && b)segments.push([a,b]);
        }
        if(!dots.length || c===hover?.con || (!label.hidden && c===caption?.con))continue;
        const x=dots.reduce((v,p)=>v+p.x,0)/dots.length,y=dots.reduce((v,p)=>v+p.y,0)/dots.length;
        const span=Math.max(...dots.map(p=>Math.hypot(p.x-x,p.y-y)));
        const mag=Math.min(...dots.map(p=>p.s.mag));
        candidates.push({c,x,y,rank:Math.log1p(span)+1.4-mag*.45});
      }
      const labels=[];
      for(const entry of candidates.sort((a,b)=>b.rank-a.rank)) {
        const {c}=entry,w=c.name.length*12,h=16;
        const spot=L.labelSpot(entry,w,h,area,blocks,segments,null,48);
        if(!spot)continue;
        const {x,y}=spot;
        labels.push(el('span',{'data-con':c.id,style:{left:x+'px',top:y+'px'}},c.name));
        blocks.push({left:x,right:x+w,top:y,bottom:y+h});
      }
      names.replaceChildren(...labels);
    }
    function drawNode(p,t) {
      const {x,y,s}=p, r=p.base+(p.lit-p.base)*t, halo=r*3.6;
      if(x< -halo || x>width+halo || y< -halo || y>height+halo) return;
      const glow=ink.createRadialGradient(x,y,0,x,y,halo);
      glow.addColorStop(0,s.color+'aa');glow.addColorStop(.34,s.color+'57');glow.addColorStop(.68,s.color+'19');glow.addColorStop(1,s.color+'00');
      ink.globalAlpha=t;ink.fillStyle=glow;ink.fillRect(x-halo,y-halo,2*halo,2*halo);
      ink.fillStyle=s.color;ink.beginPath();ink.arc(x,y,r,0,2*Math.PI);ink.fill();
    }
    function drawInk(now) {
      ink.clearRect(0,0,width,height);
      const layers=[],lit=new Map();let strength=0, running=false;
      for(const track of tracks) for(const state of [track.old,track.current]) {
        if(!state) continue;
        const age=((state.leave??now)-state.start)/drawTime;
        const fade=state.leave==null ? 1 : 1-smooth(0,fadeTime,now-state.leave);
        if(fade<=0) {track.old=null;continue;}
        const progress=smooth(0,1,age), alpha=smooth(0,.22,age)*fade;
        layers.push({track,state,progress,alpha});strength=Math.max(strength,alpha);
        running ||= state.leave!=null || age<1;
      }
      ink.save();ink.beginPath();ink.rect(0,0,width,height/2+focal*Math.tan(alt*D));ink.clip();
      ink.lineCap='round';
      if(all.checked) {
        if(!chart) {chart=new Path2D();for(const c of S.atlas) linePath(chart,c,1,false);}
        ink.strokeStyle='rgba(170,203,214,.28)';ink.lineWidth=.85;ink.stroke(chart);
      }
      if(strength>0) { ink.fillStyle=`rgba(3,9,18,${strength*.10})`;ink.fillRect(0,0,width,height); }
      for(const {track,state,progress,alpha} of layers) {
        const path=new Path2D();linePath(path,state.object,progress,true);
        const tint=track.key==='group' ? '227,211,177' : '188,215,223';
        ink.globalAlpha=alpha;
        for(const [w,a] of [[5.6,.035],[3,.085],[1.35,.72]]) {
          ink.lineWidth=w;ink.strokeStyle=`rgba(${tint},${a})`;ink.stroke(path);
        }
        for(const [hr,arrival] of L.plan(state.object).nodes) {
          const t=smooth(arrival,arrival+.14,progress)*alpha;
          if(t>0 && nodes.has(hr)) lit.set(hr,Math.max(lit.get(hr)||0,t));
        }
      }
      for(const [hr,t] of lit) drawNode(nodes.get(hr),t);
      ink.restore();drawLabel(caption,strength); return running;
    }
    let pickDirty=true,clock=0,lastCloud=null;
    function wake() { if(live===view && !view.frameId) view.frameId=requestAnimationFrame(tick); }
    function invalidate() { dirty=pickDirty=true;wake(); }
    function checkSky() {
      clearTimeout(clock);
      const st=V3.env.state, site=V3.env.astro.site(), why=reason();
      if(why) { close();V3.hud?.toast(why);return; }
      const key=skyKey(site,st);
      if(key!==stamp) { refresh(site,st);stamp=key;invalidate(); }
      if(st.mode==='real' || st.wx.cloud!==lastCloud) clock=setTimeout(checkSky,1000);
      lastCloud=st.wx.cloud;
    }
    function weatherChanged() {lastCloud=null;checkSky();}
    function tick(now) {
      view.frameId=0;if(live!==view)return;
      const w=cv.clientWidth,h=cv.clientHeight,dpr=window.devicePixelRatio||1;
      if(w!==width || h!==height || dpr!==scale) {
        width=w;height=h;scale=dpr;
        for(const c of [cv,overlay]) {c.width=Math.round(w*scale);c.height=Math.round(h*scale);c.getContext('2d').setTransform(c.width/w,0,0,c.height/h,0,0);}
        dirty=pickDirty=true;
      }
      if(flight) {
        const {from,to,start}=flight,k=reduced.matches ? 1 : smooth(0,550,now-start);
        az=wrap(from.az+V3.starFraming.turn(from.az,to.az)*k);alt=from.alt+(to.alt-from.alt)*k;fov=from.fov+(to.fov-from.fov)*k;
        dirty=pickDirty=true;if(k===1)flight=null;
      }
      if(dirty) paint();
      const turning=dial.draw(az,alt,now,reduced.matches);
      if(pickDirty) {
        const next=pinned || (pointer && hit(pointer.x,pointer.y));
        if(next?.con!==candidate?.con || next?.group!==candidate?.group) since=now;
        candidate=next;pickDirty=false;
      }
      const waiting=candidate && !pinned && now-since<45;
      if(!waiting) select(candidate,now);
      const tracing=drawInk(now);drawNames();
      if(tracing || waiting || flight || turning) wake();
    }
    const pos=e=>({x:e.clientX-cv.getBoundingClientRect().left,y:e.clientY-cv.getBoundingClientRect().top});
    const gap=()=>{ const [a,b]=pointers.values(); return Math.hypot(a.x-b.x,a.y-b.y); };
    cv.onpointerdown=e=>{ if(e.button!==0)return;flight=null;const p=pos(e);pointers.set(e.pointerId,{...p,start:p});cv.setPointerCapture(e.pointerId);
      dragged=pointers.size>1;if(dragged)pinch=gap(); };
    cv.onpointermove=e=>{
      const p=pos(e),old=pointers.get(e.pointerId);
      if(!old) { if(e.pointerType==='mouse') {pinned=null;pointer=p;pickDirty=true;wake();} return; }
      pointers.set(e.pointerId,{...p,start:old.start});
      if(pointers.size===2) { const g=gap(); fov=clamp(fov*pinch/Math.max(1,g),25,Math.max(110,fov));pinch=g; }
      else { dragged ||= Math.hypot(p.x-old.start.x,p.y-old.start.y)>4;
        if(dragged) {
          if(e.pointerType==='mouse') pinned=hover;
          az=wrap(az-(p.x-old.x)/focal/D);alt=clamp(alt+(p.y-old.y)/focal/D,0,88);
        } }
      pointer=dragged ? null : p;if(dragged) invalidate();
    };
    cv.onpointerup=e=>{ if(!pointers.delete(e.pointerId))return;
      if(!dragged) {
        pointer=pos(e);const h=hit(pointer.x,pointer.y);pinned=e.pointerType==='mouse' ? null : h;
        describe(h);if(h?.con && fitConstellation(h.con)) pinned=h;
        select(h,performance.now());candidate=h;layoutDirty=namesDirty=pickDirty=true;wake();
      } else if(e.pointerType==='mouse') { pinned=null;pointer=pos(e);pickDirty=true;wake(); } };
    cv.onpointercancel=e=>{pointers.delete(e.pointerId);dragged=true;pointer=null;pickDirty=true;wake();};
    cv.onpointerleave=()=>{if(!pointers.size){pointer=null;pickDirty=true;wake();}};
    cv.addEventListener('wheel',e=>{e.preventDefault();flight=null;fov=clamp(fov*Math.exp(clamp(e.deltaY,-300,300)*.001),25,Math.max(110,fov));invalidate();},{passive:false});
    function panelOpened() { card.hidden=true;pinned=pointer=null;layoutDirty=pickDirty=true;wake(); }
    menu.ontoggle=()=>{namesDirty=true;if(menu.open){sources.open=false;panelOpened();}wake();};
    sources.ontoggle=()=>{namesDirty=true;if(sources.open){menu.open=false;panelOpened();}wake();};
    cv.addEventListener('pointerdown',()=>{sources.open=false;});all.onchange=()=>{namesDirty=true;wake();};
    const resize=new ResizeObserver(invalidate);resize.observe(cv);window.addEventListener('resize',invalidate);
    reduced.addEventListener('change',invalidate);
    // 手动时间的静止星图不排动画帧。只有时刻、地点或天气真的变了才重画底图。
    V3.on('env',checkSky);V3.on('wx',weatherChanged);
    view.dispose=()=>{sea.dispose();clearTimeout(clock);resize.disconnect();window.removeEventListener('resize',invalidate);reduced.removeEventListener('change',invalidate);V3.off('env',checkSky);V3.off('wx',weatherChanged);};
    checkSky();return true;
  }
  let capturePending=false;
  V3.starView={open,close,reason,get capturePending(){return capturePending;},closeForBehavior(){if(live?.fromTelescope) close();},get isOpen(){return !!live;}};

  const MAX_IMAGE=2*1024*1024, WAIT_FOR_SCOPE=20000;
  // The actor can still be walking or turning after a successful start.
  function waitForScope(actor,start) {
    return new Promise(resolve=>{
      let timer, settled=false;
      function finish(reason='') {
        if(settled)return;
        settled=true; clearTimeout(timer); V3.off('actor:behavior',onBehavior);
        resolve(reason);
      }
      function onBehavior(e) {
        if(e?.kind!=='stargaze')return;
        if(e.phase==='action')finish();
        else if(e.phase==='cancelled' || e.phase==='completed')finish(e.reason || 'ended');
      }
      const opts={interrupt:true,preempt:true,run:true,together:true,seconds:2,text:'来看看这片星空。',while:()=>!settled};
      V3.on('actor:behavior',onBehavior);
      timer=setTimeout(()=>finish('timeout'),WAIT_FOR_SCOPE);
      try {
        if(start && !actor.startBehavior('stargaze',opts))
          return finish(actor.behaviorAvailability('stargaze',opts).reason || 'busy');
        if(actor.behavior?.phase==='action')finish();
      } catch(e) {
        V3.err('stargaze navigation: '+(e?.message || e));
        finish('failed');
      }
    });
  }
  const failure=(error,text)=>({ok:false,error,text});
  const scopeFailure={
    timeout:['telescope_timeout','还没走到目镜前，这次没能拍到星空。'],
    busy:['girl_busy','小鲸鱼正忙着，等她停下来再叫她一起看。'],
    'missing-furniture':['telescope_unavailable','小屋里没有可用的望远镜。'],
    unreachable:['telescope_unreachable','小鲸鱼走不到望远镜那边。'],
    'navigation-unavailable':['telescope_unreachable','现在无法为小鲸鱼找到去望远镜的路。'],
    blocked:['stargaze_blocked','小鲸鱼现在不方便过来。'],
    hidden:['page_hidden','小屋页面在后台，请先把它切回前台。'],
    'actor-not-ready':['actor_unavailable','小鲸鱼还没准备好。'],
  };
  function encode(canvas) {
    for(const [type,quality] of [['image/png'],['image/jpeg',.94],['image/jpeg',.82],['image/jpeg',.68]]) {
      const image=canvas.toDataURL(type,quality);
      if(image.length<=MAX_IMAGE && image.startsWith('data:'+type+';base64,'))return {image,mimeType:type};
    }
    return null;
  }
  function snapshot(telescope) {
    const env=V3.env, st=env.state, site=env.astro.site();
    const {az,alt,fov,width,height,frame}=live?.pose(site,st) || defaultPose(site);
    const w=width || window.innerWidth || 1280, h=height || window.innerHeight || 800;
    const focal=h/2/Math.tan(fov*D/2), forward=dir(az,alt), right=dir(az+90,0);
    const project=aimProjection(w,h,focal,forward,right,new THREE.Vector3().crossVectors(right,forward));
    const {matrix,points}=frame || skyCatalog(site,st), canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d');
    if(!ctx)return failure('capture_failed','到了目镜前，但这次没能拍到星空。');
    const nativeSize=Math.round(Math.max(w,h)*(window.devicePixelRatio || 1));
    for(const edge of new Set([clamp(nativeSize,1280,1920),1280,960])) {
      const scale=edge/Math.max(w,h);
      canvas.width=Math.max(1,Math.round(w*scale)); canvas.height=Math.max(1,Math.round(h*scale));
      ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
      const objects=[];
      const {stars,moon}=paintSky(ctx,w,h,az,alt,focal,project,new THREE.Vector3(),matrix,points,st,null,objects);
      if(frame?.canvas.width===canvas.width && frame.canvas.height===canvas.height) {
        // At the view's native resolution, keep the actual canvas pixels.
        ctx.resetTransform(); ctx.drawImage(frame.canvas,0,0);
      }
      const encoded=encode(canvas);
      if(!encoded)continue;
      const visibleObjects=objects.sort((a,b)=>a.magnitude-b.magnitude).slice(0,12);
      const direction=compass[Math.round(az/45)%8], time=env.hhmm(st.hour);
      const names=[...visibleObjects.slice(0,5).map(o=>o.name),...(moon?['月亮']:[])];
      const named=names.length ? '，其中可辨认的天体有'+names.join('、') : '';
      const text=st.day+' '+time+'（'+site.tz+'）的望远镜星图，朝'+direction+'，仰角 '+Math.round(alt)+'°。画面内绘有 '+stars+' 颗恒星'+named+'。请根据此图和画面内的天体描述。';
      return {ok:true,text,image:encoded.image,result:{
        source:'telescope_sky_canvas', actorPhase:'action', telescope:{cell:telescope.cell,facing:telescope.facing},
        skyTime:new Date(st.ms).toISOString(), localDate:st.day, localTime:time, timeMode:st.mode,
        site:{latitude:site.lat,longitude:site.lon,timeZone:site.tz}, weather:st.wx.kind,
        view:{azimuth:az,altitude:alt,verticalFov:fov,direction},
        starsInFrame:stars, visibleObjects, moonInFrame:moon,
        width:canvas.width,height:canvas.height,mimeType:encoded.mimeType,
      }};
    }
    return failure('capture_failed','到了目镜前，但这次没能拍到星空。');
  }
  async function lookAtSky() {
    if(document.hidden)return failure(...scopeFailure.hidden);
    const sky=skyIssue(); if(sky)return sky;
    const actor=V3.actor, furniture=V3.furniturePlay;
    if(!actor?.startBehavior)return failure(...scopeFailure['actor-not-ready']);
    const state=furniture?.state();
    if(!state?.ready)return failure('cabin_unavailable','小屋还没准备好，暂时找不到望远镜。');
    if(!state.items.some(r=>r.kind==='telescope'))return failure(...scopeFailure['missing-furniture']);
    if(V3.arrange?.on || V3.fb?.enabled || actor.held)return failure(...scopeFailure.blocked);
    const behavior=actor.behavior;
    const why=await waitForScope(actor,behavior?.kind!=='stargaze');
    if(document.hidden)return failure(...scopeFailure.hidden);
    const updatedSky=skyIssue(); if(updatedSky)return updatedSky;
    if(why)return failure(...(scopeFailure[why] || ['stargaze_interrupted','这次看星星在到达目镜前中断了。']));
    const at=actor.behavior, telescope=furniture.state().items.find(r=>r.kind==='telescope' && r.gazing);
    if(V3.actor!==actor || at?.kind!=='stargaze' || at.phase!=='action' || !telescope)
      return failure('stargaze_interrupted','小鲸鱼已经离开目镜，这次没有拍到星空。');
    try { return snapshot(telescope); }
    catch(e) {
      V3.err('stargaze screenshot: '+(e?.message || e));
      return failure('capture_failed','到了目镜前，但这次没能拍到星空。');
    }
  }
  V3.cabinTools?.register({
    name:'star_sky_view',
    description:'主人邀请你一起看星星时，走到小屋望远镜目镜前，拍一张小屋当前时间、地点和天气下渲染的星图。',
    parameters:{type:'object',properties:{},required:[],additionalProperties:false},
    async run() {
      capturePending=true;
      try { return await lookAtSky(); }
      finally { capturePending=false; }
    },
  });
})(window.V3);
