(function (V3) {
  'use strict';
  const ui = V3.shore, rules = V3.inventoryRules, client = V3.cabinInventory;
  const names = rules.FISH;
  const closed = () => { const weather = V3.wx?.now?.() || V3.env?.state?.wx || {}; return weather.kind === 'storm' || weather.storm > .45; };
  let live, pendingCatch = null, landing, automaticFeedPending = false;
  const dayKey = at => {
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at).map(part=>[part.type,part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  function track() {
    if (landing) return landing;
    const terrain = V3.terrain, shoreX = 4, shoreZ = terrain.shoreZ(shoreX) - .95;
    let outerZ = shoreZ;
    while (outerZ < shoreZ + 13 && [-.85, 0, .85].some(offset => terrain.depthAt(shoreX + offset, outerZ) < .6)) outerZ += .25;
    const length = outerZ - shoreZ;
    return landing = { shore: [shoreX, shoreZ], length, point(progress, drift) {
      const blend = Math.max(0, (progress - .72) / .28);
      return [shoreX + .8 * Math.sin(drift) * blend, shoreZ + length * progress + .3 * (1 - Math.cos(drift)) * blend];
    } };
  }
  const residents = () => ui.shore()?.fish || [];
  function berths() {
    const blocks = V3.houseBlocks, spots = [];
    if (!blocks?.grid) return spots;
    const layout = blocks.placedLayout(), porch = layout.porch;
    for (const [key, edge, sign] of [['west', porch.x0, -1], ['east', porch.x1, 1]]) {
      for (let step = 0; step < 5; step++) {
        const px=Math.round(edge+sign*(1.25+step)), pz=Math.floor(porch.z1+1)+.5, height=V3.terrain.groundY(px,pz);
        const clear=[-.96,-.48,0,.48,.96].every(dx=>[-.47,0,.47].every(dz=>{
          const x=px+dx,z=pz+dz,y=V3.terrain.groundY(x,z);
          return !V3.terrain.isWet(x,z) && Math.abs(y-height)<.095 && V3.nav?.walkable(x,z,y) && !blocks.furnSolids(x,z).length && !blocks.solids(x,z).length;
        }));
        if(!clear)continue;
        spots.push({key,name:key==='west'?'门廊西侧':'门廊东侧',pos:[px,height+.012,pz],outdoor:true,yaw:0});break;
      }
    }
    const tables = blocks.furnInstances('dining_table');
    for (const [index, table] of tables.entries()) {
      const centre = table.cell.map(value => value + .5), local = blocks.place ? blocks.unplacePoint(centre, blocks.place) : centre;
      const key = 'table:' + ui.houseId() + ':' + local.map(Math.floor).join('.'), offset = V3.furnMc.rotate([0,0,.325], table.facing);
      const name = tables.length === 1 ? '餐桌的一角' : `第${index+1}张餐桌的一角`;
      spots.push({ key, name, pos: [centre[0]+offset[0],table.cell[1]+.625,centre[2]+offset[2]], yaw: -V3.furnMc.FACING_Y[table.facing]*Math.PI/180, cell: table.cell });
    }
    return spots;
  }
  function setBerth(next) { return ui.save('shore_berth', { next, expected: ui.shore().berth }, next ? '鱼缸安顿好了。' : '鱼缸已收好，住户仍在。'); }
  const currentBerth = () => live?.spots.find(spot => spot.key === ui.shore()?.berth);
  function watchTarget(){
    const s=live,spot=currentBerth();if(!spot || !residents().length || !s?.tank.visible || (spot.outdoor && closed()))return null;
    return s.watchSpot || null;
  }
  const islands=rules.ISLET_STAGES;
  function fishModel(species,form,stage=islands.length-1) {
    const mesh=V3.shoreModels.fish(species,.047,form);
    if(species==='islet')V3.shoreModels.poseIslet(mesh,stage);
    return mesh;
  }
  const tankPhotoWidth = 1600, tankPhotoHeight = 900;
  const tankPhotoMaxLength = 2 * 1024 * 1024;
  function tankViewImage(actor) {
    const R=V3.R, state=live, renderer=R?.renderer;
    const tank=state?.tank, root=actor.root, pos=actor.pos;
    if(!renderer || !R.scene || !tank?.visible || !root || !pos?.every(Number.isFinite) || !state.school.some(model=>model.visible))return null;
    // Use the pane on her side. Frame the whole pane from outside, not the fish centroid from above.
    const side=tank.worldToLocal(new THREE.Vector3(...pos));
    const [w,h,d]=tankSizes[state.tier], halfX=.2*w, halfZ=.115*d;
    const alongX=Math.abs(side.x)/halfX>Math.abs(side.z)/halfZ;
    const sign=Math.sign(alongX?side.x:side.z)||1;
    const halfAlong=alongX?halfX:halfZ, halfAcross=alongX?halfZ:halfX;
    const bottom=.026*h, top=.225*h, y=(bottom+top)/2;
    const cam=R.camera.clone();cam.fov=40;cam.zoom=1;cam.aspect=tankPhotoWidth/tankPhotoHeight;cam.near=.02;cam.far=400;
    const tanHalfFov=Math.tan(THREE.MathUtils.degToRad(cam.fov/2));
    const clearance=1.08*Math.max(halfAcross/cam.aspect,(top-bottom)/2)/tanHalfFov;
    const standOff=sign*(halfAlong+clearance);
    cam.position.copy(tank.localToWorld(new THREE.Vector3(alongX?standOff:0,y,alongX?0:standOff)));
    cam.layers.set(0);cam.lookAt(tank.localToWorld(new THREE.Vector3(0,y,0)));cam.updateProjectionMatrix();cam.updateMatrixWorld(true);
    const source = renderer.domElement;
    if (source.width < 2 || source.height < 2) return null;
    const size = renderer.getSize(new THREE.Vector2()), dpr = renderer.getPixelRatio();
    const viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4());
    const scissorTest = renderer.getScissorTest();
    const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const selfLayers = [], liveCameraMask = R.camera.layers.mask;
    try {
      // Resize the drawing buffer for a full-resolution photo without changing the canvas layout.
      renderer.setRenderTarget(null);
      renderer.setDrawingBufferSize(tankPhotoWidth, tankPhotoHeight, 1);
      renderer.setScissor(0, 0, tankPhotoWidth, tankPhotoHeight);
      renderer.setScissorTest(false);
      // Only the photo camera excludes the photographer; preserve the scene visibility.
      R.camera.layers.enable(1);
      root.traverse(object=>{selfLayers.push([object,object.layers.mask]);object.layers.set(1);});
      if (R.post) R.post(renderer, R.scene, cam, 0);
      else renderer.render(R.scene, cam);
      for (const quality of [.94, .86, .74, .62, .5]) {
        const image = source.toDataURL('image/jpeg', quality);
        if (image.length <= tankPhotoMaxLength && image.startsWith('data:image/jpeg;base64,')) return image;
      }
      return null;
    } catch(e) { V3.err('fish tank view: '+(e?.message||e));return null; }
    finally {
      for(const [object,mask] of selfLayers)object.layers.mask=mask;
      R.camera.layers.mask=liveCameraMask;
      renderer.setRenderTarget(null);
      renderer.setDrawingBufferSize(size.x, size.y, dpr);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
      try { R.render(); } catch(e) { V3.err('fish tank view restore: '+(e?.message||e)); }
      finally { renderer.setRenderTarget(target, face, mip); }
    }
  }
  let tankCapturePending=false;
  const ownerTankVisit={interrupt:true,preempt:true,run:true,together:true};
  const tankVisitOptions={...ownerTankVisit,seconds:6,text:'',photoOnly:true};
  const tankFailureMessages=new Map([
    ['hidden','小屋不在前台，看鱼动作停下了。'],
    ['blocked','小屋现在不适合走动，看鱼动作停下了。'],
    ['preempted','另一件事打断了这次看鱼。'],
    ['interrupted','这次看鱼动作被打断了。'],
    ['house-changed','房屋布置变动打断了这次看鱼。'],
    ['tank-changed','鱼缸状态变动打断了这次看鱼。'],
    ['weather','天气变化打断了这次看鱼。'],
    ['unreachable','当前路线走不到鱼缸边。'],
    ['timeout','等她走到鱼缸边并转身超时了。'],
    ['busy','小鲸鱼正在忙，暂时走不开。'],
  ]);
  function waitForTankAction(actor,timeoutMs=45000) {
    const end=performance.now()+timeoutMs;
    return new Promise(resolve=>{
      let timer, settled=false, phase='start';
      const finish=(reason='')=>{
        if(settled)return;
        settled=true;clearTimeout(timer);V3.off('actor:behavior',onBehavior);
        resolve({reason,phase});
      };
      const onBehavior=e=>{
        if(e.kind!=='watch_tank')return;
        if(e.phase==='cancelled')finish(e.reason || 'cancelled');
        else if(e.phase==='completed')finish('ended');
      };
      function poll(){
        const behavior=actor.behavior;
        if(V3.actor!==actor)return finish('actor-changed');
        if(behavior?.kind!=='watch_tank')return finish('ended');
        phase=behavior.phase;
        if(phase==='action'||phase==='sit')return finish();
        if(performance.now()>=end)return finish('timeout');
        timer=setTimeout(poll,50);
      }
      V3.on('actor:behavior',onBehavior);
      try {
        if(!actor.startBehavior('watch_tank',tankVisitOptions)){
          return finish(V3.backgroundPaused()?'hidden':actor.behaviorAvailability('watch_tank',tankVisitOptions).reason || 'busy');
        }
        if(!settled)poll();
      } catch(e) {
        V3.err('fish tank navigation: '+(e?.message||e));finish('tool_failed');
      }
    });
  }
  async function lookTank() {
    if(!client.canShore())return {ok:false,error:'inventory_unavailable',text:'小屋存档还没读好，暂时看不了鱼缸。'};
    if(!watchTarget())return {ok:false,error:'tank_unavailable',text:residents().length?'鱼缸现在看不见，或天气不适合去看。':'鱼缸里还没有鱼。'};
    const actor=V3.actor;if(!actor)return {ok:false,error:'actor_unavailable',text:'小鲸鱼还没准备好去看鱼缸。'};
    tankCapturePending=true;
    try {
      const {reason,phase}=await waitForTankAction(actor);
      if(reason){
        const error=reason==='timeout'?'tank_timeout':reason==='unreachable'?'tank_unreachable':phase==='start'&&reason==='busy'?'girl_busy':'tank_interrupted';
        const text=tankFailureMessages.get(reason)||'这次看鱼动作还没完成就结束了。';
        return {ok:false,error,text,result:{reason,phase}};
      }
      const image=tankViewImage(actor);
      if(!image)return {ok:false,error:'capture_failed',text:'小鲸鱼已经走到鱼缸边，但这次没拍到清楚的画面。',result:{phase}};
      return {ok:true,text:'这张画面是你站在鱼缸边、从自己眼前看到的现场。请根据画面描述确实看见的鱼和状态；看不清的就直说，不要用鱼类图鉴猜当前画面。',image,result:{fishCount:residents().length}};
    } finally {tankCapturePending=false;}
  }
  if(V3.cabinTools)V3.cabinTools.register({
    name:'fish_tank_view',
    description:'主人明确邀请你来看鱼缸时，从你走到缸边后的眼前视角看一张现场画面。只读；没有鱼、鱼缸不可见、天气不适合或你现在走不开时会拒绝。',
    parameters:{type:'object',properties:{},required:[]},
    run:lookTank,
  });
  function setFish(holder, species, scale, form = 'base') {
    if (holder.userData.species === species && holder.userData.form === form && holder.userData.unit===scale) return;
    holder.clear(); holder.add(V3.shoreModels.fish(species, scale, form)); Object.assign(holder.userData, {species, form,unit:scale});
    const mesh=holder.children[0], find=k=>mesh.getObjectByName(k);
    holder.userData.stars=find('adult_stars');
    holder.userData.fantasy={sail:find('folding_sail'),bellL:find('bell_left'),bellR:find('bell_right')};
  }
  function fantasyPose(model,{sail=1,bell=0}={}) {
    const rig=model.userData.fantasy;if(!rig)return;
    if(rig.sail){rig.sail.scale.y=.19+.81*sail;rig.sail.rotation.x=-.24*(1-sail);}
    if(rig.bellL){rig.bellL.rotation.z=-.14+1.28*bell;rig.bellR.rotation.z=-rig.bellL.rotation.z;}
  }
  function showGrowth(model,stage) {
    const data=model.userData;
    if(data.species==='islet') {
      model.scale.setScalar(1); // A holder may be reused after housing a juvenile of another species.
      V3.shoreModels.poseIslet(model.children[0],stage);
      return;
    }
    model.scale.setScalar(growthSizes[stage]);
    if(data.stars)data.stars.visible=stage===2;
  }
  const fishLabel = (species, form = 'base') => (names[species] || rules.REEF_FISH[species]) + (form === 'base' ? '' : ' · ' + rules.fishFormName(species, form));
  const waterAt = (east, south) => V3.water?.waveY(east, south) ?? V3.layout.sea.y;
  function swimAway(state) {
    const model = state.fish.children[0]; if (!model) return;
    const fish = new THREE.Group(), start = state.fish.position.clone(), rotation = state.fish.rotation.clone();
    const { direction, distance } = V3.fishPassage.course(start), turn = Math.atan2(direction.x,direction.z) - rotation.y;
    fish.position.copy(start); fish.rotation.copy(rotation); fish.add(model); state.root.add(fish);
    state.departures.push({ fish, start, rotation, direction, distance, turn:Math.atan2(Math.sin(turn),Math.cos(turn)),
      tail:state.tail, axis:state.fish.userData.species==='dolphin'?'x':'y', tailYaw:state.tail?.rotation[state.fish.userData.species==='dolphin'?'x':'y'] || 0, age:0, duration:Math.min(1.15,.78+.045*distance), epoch:state.epoch });
    delete state.fish.userData.species; state.tail = null; state.fish.visible = false; state.inRing = false;
  }
  function updateDepartures(state, delta, storm) {
    for (let index = state.departures.length-1; index >= 0; index--) {
      const flight = state.departures[index], { fish, start, rotation, direction } = flight;
      const age = flight.age += delta, progress = age/flight.duration;
      if (progress >= 1.32) { fish.removeFromParent(); state.departures.splice(index,1); continue; }
      const turn = V3.util.smooth(0,.19,age), dive = V3.util.smooth(1,1.32,progress), beat = Math.sin(age*27);
      const travel = flight.distance * (progress < 1 ? progress*progress*(2-progress) : progress);
      fish.position.copy(start).addScaledVector(direction,travel);
      fish.position.y += turn*(waterAt(fish.position.x,fish.position.z)-.16-.08*dive-start.y);
      fish.rotation.set(rotation.x*(1-turn), rotation.y+turn*(flight.turn+.075*beat), rotation.z*(1-turn)+turn*.09*beat);
      if (flight.tail) flight.tail.rotation[flight.axis] = flight.tailYaw*(1-turn)+turn*.76*beat;
      fish.scale.setScalar(1-dive);
      if (!storm && state.epoch === flight.epoch && !state.fish.visible) {
        state.ring.visible = true;
        if (age < .34) {
          state.ripple.visible = true; state.ripple.position.copy(state.ring.position); state.ripple.scale.setScalar(.7+age*2.2);
        }
      }
    }
  }
  const stageNames=['刚来家','渐渐长大','成鱼'];
  let selectedFish;
  function selectedResident() {
    if (ui.panel?.dataset.subject !== 'homeTank' || !live?.tank.visible) return null;
    return live.school.find(model => model.visible && model.userData.uid === selectedFish) || null;
  }
  function openTank() {
    ui.open('小屋鱼缸', tankMenu);
    ui.panel.dataset.subject='homeTank';
    if (live?.tank.visible) V3.shoreView?.focus('homeTank',live.tank);
  }
  function inviteTankFromMenu() {
    const actor=V3.actor;
    if(typeof actor?.startBehavior!=='function')return ui.toast('小鲸鱼还没准备好过来看鱼。');
    if(!actor.startBehavior('watch_tank',ownerTankVisit)) {
      return ui.toast('小鲸鱼现在走不开，等她空下来再邀请她看看。');
    }
  }
  function tankMenu({ text, button, body }) {
    const shore = ui.shore();
    if (!client.canShore()) { selectedFish = undefined; text('存档还没就绪，或需要更新小屋服务。'); return; }
    const tier=shore.tankTier ?? 0, tank=rules.tankOf(shore), offer=rules.TANKS[tier+1];
    const spot = currentBerth(), spots = (live?.spots || []).filter(where=>rules.fitsBerth(tier,where.key));
    const canVisit=typeof V3.actor?.startBehavior==='function';
    button('请她看看鱼缸',inviteTankFromMenu,!spot || !residents().length || !canVisit);
    text(`${tank.name} · ${rules.usedSlots(shore)} / ${tank.slots} 格 · ${residents().length} 尾`);
    const fish=residents().find(f=>f.uid===selectedFish) || residents()[0];
    selectedFish=fish?.uid;
    if (fish) {
      const select=V3.util.el('select',{'aria-label':'选择鱼缸住户'});
      residents().forEach((f,i)=>select.append(V3.util.el('option',{value:f.uid,selected:f.uid===fish.uid},`${i+1}. ${f.name || fishLabel(f.kind,f.form)}`)));
      select.onchange=()=>{ selectedFish=select.value; ui.redraw(); body.querySelector('select')?.focus(); }; body.append(select);
      button('喂食', () => ui.save('shore_fish',{uid:fish.uid,action:'feed'},null,()=>startMeal(fish.uid)), !spot);
      const day=rules.homeDay(fish,Date.now());
      const stage=rules.growthStage(day,fish.kind), island=fish.kind==='islet'?islands[stage]:null;
      const stageName=island?.name || (fish.kind==='dolphin' && stage===2 ? '已长成' : stageNames[stage]);
      text(`${fishLabel(fish.kind, fish.form)} · ${rules.fishSlots(fish.kind)} 格 · ${day===null?'来家日期不详':`来家第 ${day} 天`} · ${stageName}`);
      if(island)text(island.description);
      const input = V3.util.el('input', { type: 'text', maxlength: '24', value: fish.name, placeholder: '给这条鱼起名', 'aria-label': '鱼的名字' }); body.append(input);
      const change = (action, extra, msg) => ui.save('shore_fish', { uid: fish.uid, action, ...extra }, msg);
      button('取名', () => change('name',{ name: input.value.trim() },'新名字记住了。'));
      button('放归', () => change('release',{},'它游回浅海了。也许有一天，会在岸边再见。'));
    }
    text(spot ? `鱼缸在${spot.name}。` : shore.berth ? '原来的缸位不在这里，可以另选位置。' : '鱼缸已收好，住户仍在。');
    if (!spot && !spots.length) text(tier>=2 ? '门廊暂时没有空位。' : '这里没有适合的台面，在小屋放一张餐桌后再试。');
    for (const where of spots) if (where !== spot) button('摆在' + where.name, () => setBerth(where.key));
    if (shore.berth) button('收起鱼缸', () => setBerth(null));
    if (offer) {
      const coins=client.data.inventory.coins, fits=rules.fitsBerth(tier+1,shore.berth);
      text(`现有 ${coins} 贝币`+(fits ? '' : ' · 落地缸需要先搬到门廊或收起')+(tier===2?' · 超级大缸可以迎接小海豚':''));
      button(`升级为${offer.name} · ${offer.slots} 格 · ${offer.price} 贝币`,()=>ui.save('shore_upgrade',{expected:tier},'新缸到了，原来的住户都在。'),!fits || coins<offer.price || shore.tankTier===undefined);
    }
    text('收缸不会丢鱼，离线也不用补喂。');
  }
  function catchMenu({ text, button }) {
    const epoch = pendingCatch;
    if (epoch === null) { text('它已经游走了。'); return; }
    const species = rules.fishAt(epoch);
    const visitor=species==='dolphin';
    text(visitor ? '浪花小海豚自己游了过来，露出水面向你点点头。' : '捞到了' + fishLabel(species, rules.fishFormAt(species, epoch)) + '！它正在网里扑腾。');
    const shore=ui.shore(), spot = currentBerth(), free=rules.tankOf(shore).slots-rules.usedSlots(shore), need=rules.fishSlots(species), fits=rules.fitsTank(shore?.tankTier ?? 0,species), canKeep = spot && fits && free>=need;
    text(`这尾需要 ${need} 格 · 缸里还剩 ${free} 格。`);
    const commit = async berth => {
      const held = live?.grip;
      if (!held || pendingCatch !== epoch) return;
      const ok = await ui.save('shore_catch', { epoch, kind: species, berth }, berth ? '新住户在缸里摇了摇尾巴。' : visitor ? '小海豚摆摆尾，游回了海里。观察册添了一笔。' : '鱼已放归，观察册添了一笔。', () => {
        if (!berth && live?.grip === held && !closed()) swimAway(live);
      });
      if (ok && live?.grip === held) { pendingCatch = null; ui.close(); }
    };
    button(visitor?'目送它游回海里':'看一眼，放回海里', () => commit(null));
    button(visitor?'邀请小海豚入住':spot ? '带回鱼缸' : '还没有摆好鱼缸', () => commit(spot.key), !canKeep);
    if (!fits) text('小海豚只住潮湾超级大缸。今天目送它离开，也能留下观察记录。');
    if (!spot) text('鱼缸还没摆好。可以在岸边救生圈的「摆放 / 查看鱼缸」里给它选个位置。');
    if (spot && fits && free<need) text('空格不够。可以放心放归，不会丢掉观察记录。');
  }
  function net() {
    if (!live || closed() || !client.canShore()) return false;
    const epoch = rules.encounter(Date.now());
    if (ui.shore().lastCatch >= epoch) { ui.toast('这一拨鱼游远了。每五分钟会换一拨。'); return false; }
    const visitor=rules.fishAt(epoch)==='dolphin';
    if (live.epoch !== epoch || !live.inRing) { ui.toast(visitor?'它还在远处，等它游近一点。':'抄网落空了，等鱼游进网圈再点。'); return false; }
    if (pendingCatch !== null) return false;
    live.rejoin = null; live.grip = { x: live.fish.position.x, z: live.fish.position.z, yaw: live.fish.rotation.y, age: 0 };
    pendingCatch = epoch; ui.open(visitor?'海湾来客':'抄网里的小鱼', catchMenu, () => {
      if (live?.grip && pendingCatch === epoch && !closed() && ui.shore()?.lastCatch < epoch) {
        live.rejoin = { position:live.fish.position.clone(), rotation:live.fish.rotation.clone(), age:0 };
      }
      pendingCatch = null; if (live) live.grip = null;
    }); return true;
  }
  function watchReef(target, point, instanceId) {
    const species = target?.userData.species, epoch = rules.encounter(Date.now());
    if (!rules.REEF_FISH[species] || !Array.isArray(point) || closed() || !client.canShore()) return;
    const valid = () => !!live && !!target.parent && target.visible && target.userData.species === species && target.userData.encounterEpoch === epoch && epoch === rules.encounter(Date.now()) && !closed() && client.canShore();
    if (!valid() || !rules.reefAt(epoch).includes(species)) return;
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    const locate = () => {
      if (target.isInstancedMesh && Number.isInteger(instanceId) && instanceId >= 0 && instanceId < target.count) {
        target.getMatrixAt(instanceId, matrix); position.setFromMatrixPosition(matrix).applyMatrix4(target.matrixWorld).toArray(point);
      }
      return point;
    };
    const seen = async () => {
      if (!valid()) return;
      const form = rules.fishFormAt(species, epoch), label = fishLabel(species, form);
      if (!rules.knownForms(ui.shore(), species).includes(form)) await ui.save('shore_watch', { epoch, kind: species }, '一起看见了' + label + '，图鉴已记录。');
      V3.actor?.say?.('看，那尾' + label + '游过去了。');
    };
    if (V3.actor?.watchReef?.({point, locate, valid, seen})) ui.toast('小鲸鱼正往岸边走，一起看看那群鱼。');
    else ui.toast('她现在走不开，等她空下来再点鱼。');
  }
  function openFriend(){
    const visit=live?.visit;if(!visit || !live.guest.visible)return;
    const f=visit.fish, days=rules.homeDay(f,f.releasedAt), kind=fishLabel(f.kind,f.form);
    ui.open('岸边重逢',({text,button})=>{
      text(f.name?`是${f.name}，那位${kind}老朋友。`:`是从前住过小屋的${kind}。`);
      text(days===null?'它还记得这片浅水。':`它曾在你家住了 ${days} 天。`);
      if(f.kind==='islet') {
        const island=islands[visit.stage];text(`还是离家时的${island.name}。${island.description}`);
      } else text(({foldsail:'那面小白帆又迎着浪立了起来。',rainbell:'雨点间，两枚小铃轻轻碰了碰。',moonray:'它侧过身，水下亮起一弯熟悉的月牙。',dolphin:'它朝你点了两下头，又绕着浪尖游了一圈。'})[f.kind] || '它沿着救生圈外侧绕了个弯，在你面前停了一会儿。');
      button('目送它离开',()=>{visit.age=Math.max(visit.age,42);ui.close();});
    });
    ui.panel.dataset.subject='returnFish';V3.shoreView?.focus('returnFish',live.guest);
  }
  function updateFriend(s,dt,epoch,shore,storm){
    const end=()=>{s.visit=null;s.guest.visible=false;if(ui.panel?.dataset.subject==='returnFish')ui.close();ui.redraw();};
    if(s.visit && (storm || !shore?.released?.some(f=>f.uid===s.visit.fish.uid))){end();return;}
    if(!shore?.released?.length || storm || !client.canShore() || globalThis.document?.hidden)return;
    const wx=V3.wx?.now?.() || V3.env?.state?.wx || {}, rain=wx.kind==='rain' || wx.rain>.1;
    if(!s.visit){
      s.activeSeconds+=Math.min(dt,.25);
      if(s.activeSeconds<12 || s.claiming || (s.triedEpoch===epoch && s.triedRain===rain))return;
      s.triedEpoch=epoch;s.triedRain=rain;const f=rules.friendAt(shore,epoch,rain);if(!f)return;
      s.claiming=true;
      client.perform({op:'shore_visit',id:client.id('visit'),epoch,rain,uid:f.uid}).then(result=>{
        if(live!==s || !result.ok || result.applied===false || result.visitor!==f.uid || closed() || !ui.shore()?.released?.some(r=>r.uid===f.uid))return;
        const stage=rules.departureStage(f), g=s.guest;setFish(g,f.kind,.047,f.form);
        showGrowth(g,stage);
        s.visit={fish:f,age:0,stage,tail:g.getObjectByName('tail')};poseGuest(s);g.visible=true;ui.redraw();
      }).finally(()=>{s.claiming=false;});return;
    }
    const v=s.visit;v.age+=Math.min(dt,.25);if(v.age>=50){end();return;}
    poseGuest(s);
  }
  function poseGuest(s){
    const v=s.visit,g=s.guest,t=v.age,kind=v.fish.kind,angle=t*.51,far=1-smooth(t/7)+smooth((t-42)/8);
    const x=s.netX-1.17+.28*Math.sin(angle),z=s.netZ+.43+.18*Math.cos(angle)+far*2.6;
    const water=waterAt(x,z);g.position.set(x,water-((kind==='foldsail'||kind==='islet') ? .15 : .11)-far*.27,z);
    g.rotation.set(0,Math.atan2(.28*Math.cos(angle),-.18*Math.sin(angle)+(t<7?-.8:t>42?.8:0)),0);
    if(kind==='dolphin') {const beat=(t+1)%10;g.rotation.x=beat<2?-.26*Math.sin(beat*Math.PI*2):0;}
    if(kind==='moonray')g.rotation.z=Math.PI*Math.sin(Math.PI*smooth(((t+2)%12-3)/2.8));
    fantasyPose(g,{sail:.7+.3*Math.sin(angle),bell:kind==='rainbell'?Math.max(0,1-Math.min(Math.abs(t-6),Math.abs(t-6.6))*5):0});
    if(kind==='rainbell' && t>=6+(v.rings||0)*.6 && (v.rings||0)<2){v.rings=(v.rings||0)+1;V3.chimes?.fishBell?.();}
    if(v.tail)v.tail.rotation[kind==='dolphin'?'x':'y']=.24*Math.sin(t*5);
  }
  function beachMenu({ text, button }) {
    const phase = V3.actor?.water, epoch=rules.encounter(Date.now()), visitor=rules.fishAt(epoch)==='dolphin';
    text(closed() ? '雷雨来了，先不上水。' : V3.actor?.watchingReef ? '她正和你一起看远礁鱼群。' : phase === 'watch' ? '她在岸边陪你看鱼。' : phase === 'approach' ? '她正在去下水点的路上。' : phase === 'back' ? '她正沿原路回岸。' : visitor ? '一只小海豚在湾里探头。等它游到金圈里，就能和它打个招呼。' : '白环圈出抄网的位置。圈变金时，点鱼或按「抄网」。');
    if (!phase) button('邀请她去浅海', () => { if (!V3.actor?.startWater()) ui.toast('她现在走不开，或没有通往岸边的路。'); ui.redraw(); }, closed());
    else {
      if (phase === 'swim') button(V3.actor.floating ? '继续游' : '漂一会儿', () => { V3.actor.floatWater(); ui.redraw(); });
      button(phase === 'approach' ? '取消邀请' : V3.actor?.watchingReef ? '结束观察' : '上岸', () => V3.actor.leaveWater(), phase === 'back');
    }
    const done = client.canShore() && ui.shore().lastCatch >= epoch;
    if (live?.guest.visible) button('圈外的老朋友',openFriend);
    button(done ? '等待下一拨鱼' : visitor?'和小海豚打招呼':'抄网', net, closed() || done || !client.canShore());
    button('摆放 / 查看鱼缸', openTank);
    button('鱼类图鉴', () => V3.fishGuide.open());
  }
  ui.register('swimPost', '救生圈 · 浅海 / 抄网 / 鱼缸', () => ui.open('浅海下水点', beachMenu));
  ui.register('netFish', '浅海来客 · 看看它', net, () => !!live && !closed() && client.canShore() && ui.shore().lastCatch < rules.encounter(Date.now()));
  ui.register('returnFish','熟悉的身影 · 看看它',openFriend,()=>!!live?.guest.visible && !closed());
  ui.register('reefWatch', '远礁鱼群 · 邀小鲸鱼到岸边观察', watchReef, () => !!live && !closed() && client.canShore());
  ui.register('homeTank', '小屋鱼缸 · 看看住户', openTank, () => !!currentBerth());
  const meshOf = (geometry, color) => new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({ color, roughness:.82 }));
  // Source vessel measures .4 x .225 x .23 world units. The last size is exactly two floor cells.
  const tankSizes=[[1,1,1],[1.85,1.72,1.72],[3.6,3.35,3.45],[5,4.8,1/.23]], growthSizes=[.76,.9,1];
  const tankUnits={1:.0068,2:.009,4:.012,6:.017};
  const residentMagnification=[1,1.10,1.40,1.72];
  function buildGarden(tier){
    const group=new THREE.Group();group.name=['shell-sand','eelgrass-bank','tidal-terrace','coral-arch'][tier];if(!tier)return group;
    // The front two thirds remain open water. Batch the small facets by shape, not by colour.
    const pieces=[[],[],[]], matrix=new THREE.Object3D(), sand=.0365;
    function piece(shape,x,y,z,w,h,d,color,tilt=0,twist=0,roll=0){matrix.position.set(x,y,z);matrix.scale.set(w,h,d);matrix.rotation.set(tilt,twist,roll);matrix.updateMatrix();pieces[shape].push([matrix.matrix.clone(),color]);}
    function rock(x,y,z,w,h,d,c){piece(1,x,y,z,w,h,d,c,.10,x*9,.10);}
    function grass(x,z,size){for(let j=0;j<5;j++){const s=(j-2)/2,len=size*(1-.25*Math.abs(s)),base=x+s*.006;piece(0,base,sand+len*.27,z+j*.0006,.0036,len*.55,.0017,j%2?0x3b8975:0x649f73,.15,0,-s*.22);piece(0,base+s*len*.14,sand+len*.74,z-.002,.0031,len*.47,.0016,j%2?0x6fbf8e:0x96b975,-.12,0,-s*.46);}}
    function fan(x,y,z,size,stem,tip){for(const side of [-1,0,1]){const a=side*.52;piece(2,x+side*size*.13,y+size*.27,z,size*.074,size*.66,size*.07,stem,0,0,-a);for(const fork of [-1,1]){const bx=x+side*size*.28+fork*size*.055,by=y+size*.64;piece(2,bx,by,z,size*.052,size*.36,size*.051,tip,0,0,-a-fork*.43);}}}
    function scallop(x,z,size){for(let j=-2;j<=2;j++)piece(1,x+j*size*.14,sand+.0016,z+(2-Math.abs(j))*size*.06,size*.24,.0028,size*.59,j%2?0xf6caae:0xe6a18b,0,j*.24);}
    for(let i=0;i<16+tier*7;i++){const u=((i*37)%53)/53,v=((i*19)%47)/47;rock(-.17+u*.34,sand+.0006,-.083+v*.16,.003+i%3*.001,.0016,.0028,i%3===0?0xbaa58d:0xe8dbb5);}
    grass(-.154,-.065,.052+tier*.010);grass(-.127,-.073,.055);scallop(.072,.058,.015);scallop(-.087,.043,.012);
    if(tier>=2){for(let j=0;j<3;j++)rock(.131-j*.012,sand+.009+j*.012,-.061-j*.003,.049-j*.007,.016,.026, [0x6c8684,0x87a5a1,0xa6b4a4][j]);fan(.13,.075,-.068,.041,0xba6b65,0xee9b82);grass(.163,-.074,.052);}
    if(tier===3){for(let i=0;i<9;i++){const angle=i*Math.PI/8;rock(-.068+.046*Math.cos(angle),sand+.007+.056*Math.sin(angle),-.076,.018,.014,.017,i%3===0?0x84a89b:0x678c89);}fan(-.10,.074,-.079,.047,0xad715f,0xf2aa78);fan(.090,.054,-.083,.054,0x8380a7,0xc3a9c8);grass(.012,-.087,.046);}
    const geo=[new THREE.BoxGeometry(),new THREE.IcosahedronGeometry(1,0),new THREE.CylinderGeometry(.70,1,1,5)],mat=new THREE.MeshStandardMaterial({roughness:.86,flatShading:true});
    pieces.forEach((p,i)=>{if(!p.length){geo[i].dispose();return;}const mesh=new THREE.InstancedMesh(geo[i],mat,p.length);p.forEach(([m,c],j)=>{mesh.setMatrixAt(j,m);mesh.setColorAt(j,new THREE.Color(c));});group.add(mesh);});return group;
  }
  const bottomKinds=new Set(['sandray','flounder','frogfish','bamboo','moray','moonray','islet']);
  const bottomFish=kind=>bottomKinds.has(kind);
  function shelter() {
    const g=new THREE.Group(), tube=meshOf(new THREE.CylinderGeometry(.036,.036,.127,12,1,true),0xb77957);
    tube.material.side=THREE.DoubleSide; tube.rotation.x=Math.PI/2; g.add(tube);
    for (const z of [-.062,.062]) { const lip=meshOf(new THREE.TorusGeometry(.036,.0037,5,12),0xd59970);lip.position.z=z;g.add(lip); }
    return g;
  }
  function measureResident(model) {
    const data=model.userData, mesh=data.mesh, bounds=new THREE.Box3();
    // Measure in tank units, independent of the holder's animated transform.
    model.remove(mesh);
    if(data.species==='islet') {
      mesh.updateMatrixWorld(true);
      const box=new THREE.Box3();
      mesh.traverseVisible(part=>{
        if(!part.isMesh)return;
        if(!part.geometry.boundingBox)part.geometry.computeBoundingBox();
        bounds.union(box.copy(part.geometry.boundingBox).applyMatrix4(part.matrixWorld));
      });
      data.bottom=bounds.min.y;data.top=bounds.max.y;
    } else bounds.setFromObject(mesh);
    model.add(mesh);
    data.nose=bounds.max.z;data.reach=Math.max(-bounds.min.z,bounds.max.z);data.halfWidth=Math.max(-bounds.min.x,bounds.max.x);
    data.radius=Math.hypot(data.reach,data.halfWidth);
  }
  function syncTank(state,shore) {
    const tier=shore?.tankTier ?? 0, spot=currentBerth(), [w,h,d]=tankSizes[tier];
    state.shell.scale.set(w,h,d);state.gardens.forEach((g,i)=>g.visible=i===tier);
    Object.assign(state.tank.userData,{tankWidth:w,tankHeight:h});
    if (spot) {
      state.tank.position.set(...spot.pos); state.tank.rotation.y=spot.yaw;
      if (spot.cell && tier===1) state.tank.translateZ(-.12);
    }
    if (state.berth!==spot?.key || state.tier!==tier) state.meal=null;
    const marker=spot?[spot.key,tier,...spot.pos,spot.yaw].join(':'):'';
    if(marker!==state.watchMarker){
      state.watchMarker=marker;const pos=state.tank.position;
      state.watchSpot=spot?{key:marker,center:[pos.x,spot.outdoor?spot.pos[1]:spot.cell[1],pos.z],yaw:spot.yaw,width:.4*w,depth:.23*d,outdoor:!!spot.outdoor}:null;
      V3.nav?.setTankFootprint?.(spot?.outdoor?{x0:pos.x-.2*w,x1:pos.x+.2*w,z0:pos.z-.115*d,z1:pos.z+.115*d,top:pos.y+.225*h}:null);
    }
    state.berth=spot?.key; state.tier=tier;
    const fish=shore?.fish || [];
    fish.forEach((resident,i)=>{
      let model=state.school[i];
      if (!model) { model=new THREE.Group(); state.school.push(model); state.tank.add(model); }
      const kind=resident.kind, unit=tankUnits[rules.fishSlots(kind)]*residentMagnification[tier];
      setFish(model,kind,unit,resident.form);
      const data=model.userData;
      if (data.mesh!==model.children[0]) {
        const mesh=data.mesh=model.children[0];
        data.stage=undefined;
        if(kind!=='islet')measureResident(model);
        data.tail=mesh.getObjectByName('tail'); data.left=mesh.getObjectByName('fin_left'); data.right=mesh.getObjectByName('fin_right');
        data.mouth=mesh.getObjectByName('tube_mouth'); data.lamps=mesh.getObjectByName('lanterns');
      }
      if (kind==='moray' && !data.pipe) {data.pipe=shelter();state.tank.add(data.pipe);}
      if (data.pipe) data.pipe.visible=kind==='moray';
      data.uid=resident.uid; data.dayAt=undefined; model.visible=true;
    });
    for (let i=fish.length;i<state.school.length;i++) {state.school[i].visible=false;const pipe=state.school[i].userData.pipe;if(pipe)pipe.visible=false;}
    if (state.meal && !fish.some(f=>f.uid===state.meal.uid)) state.meal=null;
  }
  function feedIfNeededToday() {
    if (automaticFeedPending || !client.canShore() || !currentBerth() || !live?.tank?.visible) return false;
    const fish=residents(), today=dayKey(Date.now());
    if (!fish.length) return false;
    const target=fish.find(resident=>!resident.fed || dayKey(resident.fed)!==today);
    if (!target) return false;
    automaticFeedPending=true;
    void ui.save('shore_fish',{uid:target.uid,action:'feed'},null,()=>{
      startMeal(target.uid);V3.actor?.say?.('今天轮到你吃啦，喂你一口。','happy');
    }).catch(error=>{
      V3.err('automatic fish feeding: '+(error?.message||error));
    }).finally(()=>{automaticFeedPending=false;});
    return true;
  }
  function startMeal(uid) {
    const model=live?.school.find(m=>m.visible && m.userData.uid===uid);
    if (!model || !live.tank.visible) return;
    const [w,h]=tankSizes[live.tier], kind=model.userData.species, sign=model.position.x>0?-1:1;
    live.meal={uid,age:0,start:model.position.clone(),yaw:model.rotation.y,sign,
      x:model.position.x*.65+sign*.045*w, y:((kind==='archer'||kind==='dolphin') ? .163 : bottomFish(kind) ? .051 : .125)*h, z:model.position.z*.55};
    if (kind==='moray') {const pipe=model.userData.pipe, reach=.065+model.userData.nose*model.scale.x;
      Object.assign(live.meal,{x:pipe.position.x+Math.sin(pipe.rotation.y)*reach,z:pipe.position.z+Math.cos(pipe.rotation.y)*reach,y:pipe.position.y});}
  }
  const smooth = n => { n=Math.max(0,Math.min(1,n)); return n*n*(3-2*n); };
  const blendYaw=(from,to,t)=>from+t*Math.atan2(Math.sin(to-from),Math.cos(to-from));
  function swimTank(state,fish,dt,time,now) {
    const [w,h,d]=tankSizes[state.tier], meal=state.meal;
    if (meal) meal.age+=dt;
    state.jet.visible=false;
    for (const pellet of state.pellets) pellet.visible=false;
    for (let i=0;i<fish.length;i++) {
      const model=state.school[i], info=model.userData, resident=fish[i], bottom=bottomFish(resident.kind);
      // Recheck age at most once a minute; no writes or offline feeding required.
      if (info.dayAt!==Math.floor(now/60000)) {
        info.dayAt=Math.floor(now/60000);const stage=rules.growthStage(rules.homeDay(resident,now),resident.kind);
        if(info.stage!==stage) {
          info.stage=stage;showGrowth(model,stage);
          if(resident.kind==='islet')measureResident(model);
        }
      }
      const kind=resident.kind, r=info.radius*model.scale.x, night=V3.env?.state?.night || 0;
      let a=time*(kind==='sandray'||kind==='bamboo' ? .36 : .58)+i*2.4;
      if(kind==='frogfish') {const step=time*.38+i; a=(Math.floor(step)+smooth((step%1)*2.7))*.59;}
      const cols=Math.ceil(fish.length/3), col=i%cols, lane=Math.floor(i/cols), width=.18*w/cols;
      const cx=(2*col+1-cols)*width, rx=Math.max(width*.3,width-r), rz=Math.max(.012,.088*d-r)*.65;
      model.position.set(cx+rx*Math.sin(a), (bottom ? .050+.010*lane : .067+.03*lane+.007*Math.sin(a*.7))*h,rz*Math.cos(a)+(lane-1)*.012*d);
      model.rotation.set(0,Math.atan2(rx*Math.cos(a),-rz*Math.sin(a)),0);
      if (kind==='archer') model.position.y=(.139+.008*Math.sin(a))*h;
      if (kind==='dolphin') {
        const run=Math.max(.01,.176*w-r), turn=.024*d;
        model.position.set(run*Math.sin(a),(.138+.025*Math.sin(a*2))*h,-.040*d+turn*Math.cos(a));
        model.rotation.set(-.12*Math.cos(a*2),Math.atan2(run*Math.cos(a),-turn*Math.sin(a)),0);
      }
      if (info.lamps) {model.position.x=cx+rx*((1-night)*(-.60+.18*Math.sin(a))+night*Math.sin(a));model.position.y=(.067+.025*night)*h;info.lamps.scale.setScalar(.72+.5*night);}
      if (kind==='moray') {
        const pipe=info.pipe, sign=cx>0?-1:1;pipe.rotation.y=sign*1.10;
        pipe.position.set(cx-sign*.030*w,.040*h+.036,(lane-1)*.018*d);
        const peek=.028+.008*Math.sin(a);model.rotation.y=pipe.rotation.y;
        model.position.set(pipe.position.x+Math.sin(pipe.rotation.y)*peek,pipe.position.y-.02,pipe.position.z+Math.cos(pipe.rotation.y)*peek);
      }
      if(info.mouth)info.mouth.position.z=3.68;
      const eating=meal?.uid===resident.uid, age=eating?meal.age:0;
      if (kind==='foldsail' || kind==='rainbell') fantasyPose(model,{sail:eating?1-smooth((age-.65)/.6):1-Math.min(1,Math.abs(Math.cos(a+.23))*1.4),bell:eating?Math.exp(-Math.pow((age-.43)/.17,2)):0});
      if(kind==='rainbell' && eating && age>=.43 && !meal.rang){meal.rang=true;V3.chimes?.fishBell?.();}
      if (meal?.uid===resident.uid) {
        const age=meal.age, reach=kind==='frogfish'?smooth((age-.87)/.30):smooth((age-.16)/1.03), resume=smooth((age-1.53)/.70), yaw=kind==='moray'?info.pipe.rotation.y:meal.sign*Math.PI/2;
        const bite=info.mouth ? 1.8*Math.sin(Math.PI*smooth((age-.92)/.54)) : 0;
        if(info.mouth)info.mouth.position.z+=bite;
        const nose=(info.nose+bite*(info.mesh?.scale.z || 0))*model.scale.x;
        const x=meal.x-Math.sin(yaw)*nose, y=meal.y-(kind==='moray' ? .025 : bottom ? .004 : .018), z=meal.z-Math.cos(yaw)*nose;
        const lerp=(a,b,t)=>a+(b-a)*t;
        model.position.set(lerp(lerp(meal.start.x,x,reach),model.position.x,resume),lerp(lerp(meal.start.y,y,reach),model.position.y,resume),lerp(lerp(meal.start.z,z,reach),model.position.z,resume));
        model.rotation.y=blendYaw(blendYaw(meal.yaw,yaw,reach),model.rotation.y,resume);
        model.rotation.x=bottom?0:-.13*Math.sin(reach*Math.PI);
        state.pellets.forEach((pellet,j)=>{
          const t=age-.1*j; pellet.visible=t>=0 && t<1.19;
          const sink=kind==='archer' && j===0?smooth((t-.76)/.39):smooth(t/1.13); pellet.position.set(meal.x+(j-1)*.014*(1-sink),(.206*h)*(1-sink)+meal.y*sink,meal.z+(j-1)*.009*(1-sink));
        });
      }
      // A long tail needs different wall clearance head-on than broadside, even mid-bite.
      if(kind==='moonray' && eating){const roll=Math.PI*Math.sin(Math.PI*smooth((age-.35)/1.38));model.rotation.z=roll;model.position.y+=.053*Math.abs(Math.sin(roll))+.026*(1-Math.cos(roll));}
      const sn=Math.abs(Math.sin(model.rotation.y)), cs=Math.abs(Math.cos(model.rotation.y)), k=model.scale.x;
      const roomX=Math.max(0,.185*w-(cs*info.halfWidth+sn*info.reach)*k), roomZ=Math.max(0,.096*d-(sn*info.halfWidth+cs*info.reach)*k);
      model.position.x=Math.max(-roomX,Math.min(roomX,model.position.x)); model.position.z=Math.max(-roomZ,Math.min(roomZ,model.position.z));
      if(kind==='islet')model.position.y=Math.max(.04*h-info.bottom,Math.min(.201*h-info.top,model.position.y));
      if (info.tail) info.tail.rotation[kind==='dolphin'?'x':'y']=(bottom ? .12 : .23)*Math.sin(time*(meal?.uid===resident.uid?13:7)+i);
      if (kind!=='islet' && info.left && info.right) { const flap=.12*Math.sin(time*4+i); info.left.rotation.z=flap; info.right.rotation.z=-flap; }
      if (kind==='archer' && meal?.uid===resident.uid && meal.age>.39 && meal.age<.78) {
        const {jet,jetTip,jetDir}=state, target=state.pellets[0].position;
        jetTip.set(Math.sin(model.rotation.y)*info.nose*model.scale.x,.024*model.scale.x,Math.cos(model.rotation.y)*info.nose*model.scale.x).add(model.position);
        jetDir.subVectors(target,jetTip);const len=jetDir.length();jet.position.copy(jetTip).lerp(target,.5);jet.scale.y=len;
        if(len>.001){jet.quaternion.setFromUnitVectors(state.jetUp,jetDir.normalize());jet.visible=true;}
      }
    }
    if (meal?.age>=2.23) state.meal=null;
  }
  function build() {
    const root = new THREE.Group(), route = track(), [shoreX,shoreZ] = route.shore, post = ui.tag(new THREE.Group(),'swimPost');
    const pole = meshOf(new THREE.CylinderGeometry(.055,.065,1.15,8),0x927353), buoy = meshOf(new THREE.TorusGeometry(.23,.064,7,24),0xdd754c);
    pole.position.y=.575; buoy.position.set(0,.80,.082); post.add(pole,buoy);
    for (let stripe=0; stripe<4; stripe++) { const band=meshOf(new THREE.TorusGeometry(.23,.068,7,4,.43),0xffead2); band.rotation.z=stripe*Math.PI/2; band.position.copy(buoy.position); post.add(band); }
    post.rotation.y = Math.PI;
    post.position.set(shoreX-.70,V3.terrain.groundY(shoreX-.70,shoreZ),shoreZ); root.add(post);
    const netX = shoreX+1.65, netZ = V3.terrain.shoreZ(netX)+2.3;
    const ring = ui.tag(meshOf(new THREE.TorusGeometry(.38,.018,5,32),0xf4e7c4),'netFish'); ring.rotation.x=-Math.PI/2;
    const fish = ui.tag(new THREE.Group(),'netFish'); root.add(ring,fish);
    const guest=ui.tag(new THREE.Group(),'returnFish');guest.visible=false;root.add(guest);
    const ripple = meshOf(new THREE.TorusGeometry(.23,.012,5,28),0xd4fff5); ripple.rotation.x = -Math.PI/2; ripple.visible = false; root.add(ripple);
    const tank = ui.tag(new THREE.Group(),'homeTank'), vessel = V3.shoreModels.build('aquarium',.025);
    const shell=new THREE.Group(); tank.add(shell); vessel.name = 'tank-body'; shell.add(vessel);
    const water = new THREE.Mesh(new THREE.BoxGeometry(.373,.16,.195),new THREE.MeshStandardMaterial({color:0x8cd1d1,transparent:true,opacity:.22,depthWrite:false}));
    water.position.y=.121; shell.add(water);
    const gardens=tankSizes.map((_,i)=>buildGarden(i));shell.add(...gardens);
    const pellets=Array.from({length:3},()=>{const p=meshOf(new THREE.IcosahedronGeometry(.0053,0),0xe6a451); p.visible=false; tank.add(p); return p;});
    const jet=new THREE.Mesh(new THREE.CylinderGeometry(.0018,.0023,1,5),new THREE.MeshBasicMaterial({color:0xb1eaf5}));jet.visible=false;tank.add(jet);
    tank.visible=false; root.add(tank); root.name='shallows';
    live={ root,fish,ring,ripple,netX,netZ,tank,shell,gardens,school:[],pellets,jet,jetDir:new THREE.Vector3(),jetTip:new THREE.Vector3(),jetUp:new THREE.Vector3(0,1,0),meal:null,departures:[],guest,visit:null,activeSeconds:0,spots:[],version:-1,epoch:-1,inRing:false,grip:null,rev:-1 }; return root;
  }
  function updateEncounter(state,epoch,available) {
    const fish=state.fish, passage=V3.fishPassage;
    if (!available) state.passage=null;
    if (state.epoch===epoch && (!available || fish.children.length)) {
      if (state.passage && !state.passage.entering) {
        // A clock correction restored the old fish during its exit. Swim back from here.
        Object.assign(state.passage,{edge:fish.position.clone(),entering:true,heading:fish.rotation.y,age:0,complete:false});
      }
      return false;
    }
    if (available && state.epoch!==-1 && fish.visible && fish.children.length && V3.R?.camera) {
      if (state.passage && !state.passage.entering && !state.passage.complete) return false;
      if (!passage.outside(fish.position,state.radius)) {
        state.passage=passage.begin(fish.position,fish.rotation.y,state.radius,false);
        return false;
      }
    }
    const arriving=available && state.epoch!==-1 && !!V3.R?.camera;
    const kind=rules.fishAt(epoch);
    setFish(fish,kind,.047,rules.fishFormAt(kind,epoch));
    if (kind==='islet') V3.shoreModels.poseIslet(fish.children[0],0);
    const box=new THREE.Box3().setFromObject(fish), centre=fish.getWorldPosition(new THREE.Vector3());
    state.radius=.10+box.getBoundingSphere(new THREE.Sphere()).radius+box.getCenter(new THREE.Vector3()).distanceTo(centre);
    state.tail=fish.getObjectByName('tail'); state.epoch=epoch; state.rejoin=null; state.passage=null;
    return arriving;
  }
  function update(delta,time) {
    if (!live) return;
    const state=live, blocks=V3.houseBlocks, epoch=rules.encounter(Date.now()), shore=ui.shore(), storm=closed();
    if (state.version !== blocks?.version) { V3.nav?.setTankFootprint?.(null);state.watchMarker=null;state.spots=berths(); state.version=blocks?.version; state.rev=-1; }
    const oldBerth=state.berth, oldTier=state.tier;
    if (state.rev !== client.data?.rev) {
      syncTank(state,shore); state.rev=client.data?.rev;
    }
    const spot=currentBerth(); state.tank.visible=!!spot && (!spot.cell || blocks.visibleAt(...spot.cell));
    if ((oldBerth!==state.berth || oldTier!==state.tier) && state.tank.visible && ui.panel?.dataset.subject==='homeTank') V3.shoreView?.focus('homeTank',state.tank);
    if (state.tank.visible) swimTank(state,residents(),delta,time,Date.now()); else state.meal=null;
    if (pendingCatch !== null && (pendingCatch !== epoch || shore?.lastCatch >= pendingCatch || storm || !client.canShore())) ui.close();
    const available = !storm && (shore?.lastCatch ?? -1)<epoch;
    updateFriend(state,delta,epoch,shore,storm);
    const fish=state.fish, passage=V3.fishPassage;
    const arriving=updateEncounter(state,epoch,available);
    const phase = time * .73, swing = Math.sin(phase);
    const edge = Math.max(0, Math.min(1, (Math.abs(swing) - .25) / .31)), waiting = 1 - edge * edge * (3 - 2 * edge);
    const px = state.netX + 1.06*swing*(1-waiting) + .035*waiting*Math.sin(time*15);
    const pz = state.netZ + .19*Math.sin(phase*2)*(1-waiting) + .02*waiting*Math.sin(time*18);
    state.fish.position.set(px,waterAt(px,pz)-.17 + .04*waiting*Math.abs(Math.sin(time*15)),pz);
    state.fish.rotation.set(waiting*.17*Math.sin(time*14), Math.atan2(.774*Math.cos(phase),.277*Math.cos(phase*2)), waiting*.24*Math.sin(time*17));
    state.ring.position.set(state.netX,waterAt(state.netX,state.netZ)+.026,state.netZ);state.inRing=Math.hypot(px-state.netX,pz-state.netZ)<=.38;
    const grip = state.grip, visitor=state.fish.userData.species==='dolphin';
    if (visitor) {state.fish.position.y=waterAt(px,pz)-.16+.048*Math.cos(phase*2);state.fish.rotation.x=-.10*Math.sin(phase*2);state.fish.rotation.z=0;}
    state.ripple.visible = !!grip;
    if (grip) {
      grip.age += delta;
      const lift = Math.min(1, grip.age * 4), beat = Math.sin(grip.age * 19), pull = lift * .72;
      state.fish.position.set(grip.x + (state.netX-grip.x)*pull, waterAt(state.netX,state.netZ)-.17 + lift*(.17+.055*Math.abs(beat)), grip.z+(state.netZ-grip.z)*pull);
      state.fish.rotation.set(lift*.46*beat,grip.yaw+lift*.24*Math.sin(grip.age*12),lift*.58*Math.sin(grip.age*15));
      if (visitor) {state.fish.position.y=waterAt(state.netX,state.netZ)-.14+.025*Math.sin(grip.age*2);state.fish.rotation.set(-.12+.06*Math.sin(grip.age*2),grip.yaw,0);}
      state.ripple.position.copy(state.ring.position); state.ripple.scale.setScalar(.65 + (grip.age*1.8 % 1)*.9); state.inRing = true;
    } else if (state.rejoin) {
      const rejoin = state.rejoin, progress = Math.min(1,(rejoin.age += delta)/.55), blend = 1-progress*progress*(3-2*progress);
      state.fish.position.lerp(rejoin.position,blend);
      for (const axis of ['x','y','z']) { const offset = rejoin.rotation[axis]-state.fish.rotation[axis]; state.fish.rotation[axis] += blend*Math.atan2(Math.sin(offset),Math.cos(offset)); }
      state.inRing = Math.hypot(state.fish.position.x-state.netX,state.fish.position.z-state.netZ) <= .38;
      if (progress === 1) state.rejoin = null;
    }
    if (state.tail) {if (visitor) state.tail.rotation.x=.26*Math.sin(time*5);else state.tail.rotation.y = grip ? .82*Math.sin(grip.age*24) : .22*(1-waiting)*Math.sin(time*7) + .48*waiting*Math.sin(time*16);}
    if(state.fish.userData.species==='foldsail')fantasyPose(state.fish,{sail:1-Math.abs(Math.cos(phase+.2))});
    if (arriving) state.passage=passage.begin(fish.position,fish.rotation.y,state.radius,true);
    if (state.passage && available) {
      passage.move(state.passage,fish,arriving ? 0 : delta);
      state.inRing=false;
      if (state.tail) state.tail.rotation[visitor?'x':'y']=.32*Math.sin(time*8);
      if (state.passage.entering && state.passage.complete) state.passage=null;
    }
    state.fish.visible=state.ring.visible=available;
    if (!available) state.inRing = false;
    state.ring.material.color.setHex(grip ? 0xf58c48 : state.inRing ? 0xffcb52 : 0xf4e7c4);
    if (state.departures.length) updateDepartures(state,delta,storm);
    if (state.changedEpoch !== epoch || state.storm !== storm || state.lastCatch !== shore?.lastCatch) {
      state.changedEpoch=epoch;state.storm=storm;state.lastCatch=shore?.lastCatch;
      ui.redraw();
    }
  }
  V3.shallows={ track,closed,net,currentBerth,openTank,watchTarget,feedIfNeededToday,fishModel, get selectedResident(){return selectedResident();}, get tankCapturePending(){return tankCapturePending;}, get state(){return live;} };
  V3.on('shore:swim',ui.redraw);
  V3.scene?.part({ id:'shallows', order:72, build,update,dispose(){ V3.nav?.setTankFootprint?.(null);pendingCatch=null; landing=null; live=null; ui.close(); } });
})(window.V3);
