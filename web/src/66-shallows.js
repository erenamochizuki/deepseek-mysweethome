(function (V3) {
  'use strict';
  const ui = V3.shore, rules = V3.inventoryRules, client = V3.cabinInventory;
  const names = rules.FISH;
  const closed = () => { const weather = V3.wx?.now?.() || V3.env?.state?.wx || {}; return weather.kind === 'storm' || weather.storm > .45; };
  let live, pendingCatch = null, landing;
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
      for (let step = 0; step < 4; step++) {
        const px = edge + sign * (1 + .5 * step), pz = porch.z1 + .8, height = V3.terrain.groundY(px,pz);
        if (V3.terrain.isWet(px,pz) || !V3.nav?.walkable(px,pz) || blocks.furnSolids(px,pz).length || blocks.solids(px,pz).length) continue;
        spots.push({ key, name: key === 'west' ? '门廊西侧的小架' : '门廊东侧的小架', pos: [px,height+.65,pz], stand: true, yaw: 0 }); break;
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
  function setFish(holder, species, scale, form = 'base') {
    if (holder.userData.species === species && holder.userData.form === form) return;
    holder.clear(); holder.add(V3.shoreModels.fish(species, scale, form)); Object.assign(holder.userData, {species, form});
    const mesh=holder.children[0], find=k=>mesh.getObjectByName(k);
    holder.userData.fantasy={sail:find('folding_sail'),bellL:find('bell_left'),bellR:find('bell_right'),coral1:find('coral_1'),coral2:find('coral_2')};
  }
  function fantasyPose(model,{sail=1,bell=0,stage=2}={}) {
    const rig=model.userData.fantasy;if(!rig)return;
    if(rig.sail){rig.sail.scale.y=.19+.81*sail;rig.sail.rotation.x=-.24*(1-sail);}
    if(rig.bellL){rig.bellL.rotation.z=-.14+1.28*bell;rig.bellR.rotation.z=-rig.bellL.rotation.z;}
    if(rig.coral1){rig.coral1.visible=stage>=1;rig.coral2.visible=stage>=2;}
  }
  const fishLabel = (species, form = 'base') => (names[species] || rules.REEF_FISH[species]) + (form === 'base' ? '' : ' · ' + rules.fishFormName(species, form));
  const waterAt = (east, south) => V3.water?.waveY(east, south) ?? V3.layout.sea.y;
  function exitCourse(start) {
    const camera = V3.R?.camera, across = new THREE.Vector3(1,0,0), offshore = new THREE.Vector3(0,0,1);
    let frustum;
    if (camera) {
      camera.updateWorldMatrix(true,false);
      across.setFromMatrixColumn(camera.matrixWorld,0).setY(0).normalize();
      frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    }
    if (across.z < 0) across.negate();
    for (const direction of [across, across.clone().negate(), across.clone().addScaledVector(offshore,.8).normalize(), offshore]) {
      let distance = frustum ? Infinity : 3.5;
      for (const plane of frustum?.planes || []) {
        const rate = -plane.normal.dot(direction);
        if (rate > .001) distance = Math.min(distance,(plane.distanceToPoint(start)+.65)/rate);
      }
      distance = Math.max(1, Math.min(distance,120));
      let clear = true;
      for (let step = .35; step <= distance; step += .35) {
        if (V3.terrain.depthAt(start.x + direction.x*step, start.z + direction.z*step) < .14) { clear = false; break; }
      }
      if (clear || direction === offshore) return { direction, distance };
    }
  }
  function swimAway(state) {
    const model = state.fish.children[0]; if (!model) return;
    const fish = new THREE.Group(), start = state.fish.position.clone(), rotation = state.fish.rotation.clone();
    const { direction, distance } = exitCourse(start), turn = Math.atan2(direction.x,direction.z) - rotation.y;
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
  function openTank() {
    ui.open('小屋鱼缸', tankMenu);
    ui.panel.dataset.subject='homeTank';
    if (live?.tank.visible) V3.shoreView?.focus('homeTank',live.tank);
  }
  function tankMenu({ text, button, body }) {
    const shore = ui.shore();
    button('鱼类图鉴', () => V3.fishGuide.open());
    if (!client.canShore()) { text('存档还没就绪，或需要更新小屋服务。'); return; }
    const tier=shore.tankTier ?? 0, tank=rules.tankOf(shore), offer=rules.TANKS[tier+1];
    const spot = currentBerth(), spots = (live?.spots || []).filter(where=>rules.fitsBerth(tier,where.key));
    text(`${tank.name} · ${rules.usedSlots(shore)} / ${tank.slots} 格 · ${residents().length} 尾`);
    const fish=residents().find(f=>f.uid===selectedFish) || residents()[0];
    if (fish) {
      selectedFish=fish.uid;
      const select=V3.util.el('select',{'aria-label':'选择鱼缸住户'});
      residents().forEach((f,i)=>select.append(V3.util.el('option',{value:f.uid,selected:f.uid===fish.uid},`${i+1}. ${f.name || fishLabel(f.kind,f.form)}`)));
      select.onchange=()=>{ selectedFish=select.value; ui.redraw(); body.querySelector('select')?.focus(); }; body.append(select);
      button('喂食', () => ui.save('shore_fish',{uid:fish.uid,action:'feed'},null,()=>startMeal(fish.uid)), !spot);
      const day=rules.homeDay(fish,Date.now());
      const stage=rules.growthStage(day), stageName=fish.kind==='dolphin' && stage===2 ? '已长成' : stageNames[stage];
      text(`${fishLabel(fish.kind, fish.form)} · ${rules.fishSlots(fish.kind)} 格 · ${day===null?'来家日期不详':`来家第 ${day} 天 · ${stageName}`}`);
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
    const valid = () => !!live && !!target.parent && target.visible && target.userData.species === species && epoch === rules.encounter(Date.now()) && !closed() && client.canShore();
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
      text(({foldsail:'那面小白帆又迎着浪立了起来。',rainbell:'雨点间，两枚小铃轻轻碰了碰。',moonray:'它侧过身，水下亮起一弯熟悉的月牙。',islet:['背上仍是离家时的那块小礁石。','石缝里还是离家时的那一枝珊瑚。','礁石上，那两枝珊瑚一枝也没少。'][rules.growthStage(days)],dolphin:'它朝你点了两下头，又绕着浪尖游了一圈。'})[f.kind] || '它沿着救生圈外侧绕了个弯，在你面前停了一会儿。');
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
        const stage=rules.growthStage(rules.homeDay(f,f.releasedAt)), g=s.guest;setFish(g,f.kind,.047,f.form);
        g.scale.setScalar(growthSizes[stage]);fantasyPose(g,{stage});const stars=g.getObjectByName('adult_stars');if(stars)stars.visible=stage===2;
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
    fantasyPose(g,{stage:v.stage,sail:.7+.3*Math.sin(angle),bell:kind==='rainbell'?Math.max(0,1-Math.min(Math.abs(t-6),Math.abs(t-6.6))*5):0});
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
  const tankSizes=[[1,1,1],[1.65,1.35,1.6],[2.7,2,2.5],[4.4,2.65,3.5]], growthSizes=[.76,.9,1];
  const tankUnits={1:.0068,2:.009,4:.012,6:.017};
  const bottomKinds=new Set(['sandray','flounder','frogfish','bamboo','moray','moonray','islet']);
  const bottomFish=kind=>bottomKinds.has(kind);
  function shelter() {
    const g=new THREE.Group(), tube=meshOf(new THREE.CylinderGeometry(.036,.036,.127,12,1,true),0xb77957);
    tube.material.side=THREE.DoubleSide; tube.rotation.x=Math.PI/2; g.add(tube);
    for (const z of [-.062,.062]) { const lip=meshOf(new THREE.TorusGeometry(.036,.0037,5,12),0xd59970);lip.position.z=z;g.add(lip); }
    return g;
  }
  function syncTank(state,shore) {
    const tier=shore?.tankTier ?? 0, spot=currentBerth(), [w,h,d]=tankSizes[tier];
    state.shell.scale.set(w,h,d); state.stand.scale.set(w,1,d);
    Object.assign(state.tank.userData,{tankWidth:w,tankHeight:h});
    if (spot) {
      state.tank.position.set(...spot.pos); state.tank.rotation.y=spot.yaw; state.stand.visible=!!spot.stand;
      if (spot.cell && tier===1) state.tank.translateZ(-.12);
    }
    if (state.berth!==spot?.key || state.tier!==tier) state.meal=null;
    state.berth=spot?.key; state.tier=tier;
    const fish=shore?.fish || [];
    fish.forEach((resident,i)=>{
      let model=state.school[i];
      if (!model) { model=new THREE.Group(); state.school.push(model); state.tank.add(model); }
      const kind=resident.kind, unit=tankUnits[rules.fishSlots(kind)];
      setFish(model,kind,unit,resident.form);
      const data=model.userData;
      if (data.mesh!==model.children[0]) {
        const mesh=data.mesh=model.children[0];
        // Measure in tank units, before the patrol pose or growth scale is applied.
        model.remove(mesh); const bounds=new THREE.Box3().setFromObject(mesh); model.add(mesh);
        data.nose=bounds.max.z; data.reach=Math.max(-bounds.min.z,bounds.max.z); data.halfWidth=Math.max(-bounds.min.x,bounds.max.x);
        data.radius=Math.hypot(data.reach,data.halfWidth);
        data.tail=mesh.getObjectByName('tail'); data.left=mesh.getObjectByName('fin_left'); data.right=mesh.getObjectByName('fin_right');
        data.mouth=mesh.getObjectByName('tube_mouth'); data.stars=mesh.getObjectByName('adult_stars'); data.lamps=mesh.getObjectByName('lanterns');
      }
      if (kind==='moray' && !data.pipe) {data.pipe=shelter();state.tank.add(data.pipe);}
      if (data.pipe) data.pipe.visible=kind==='moray';
      data.uid=resident.uid; data.dayAt=undefined; model.visible=true;
    });
    for (let i=fish.length;i<state.school.length;i++) {state.school[i].visible=false;const pipe=state.school[i].userData.pipe;if(pipe)pipe.visible=false;}
    if (state.meal && !fish.some(f=>f.uid===state.meal.uid)) state.meal=null;
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
      if (info.dayAt!==Math.floor(now/60000)) { info.dayAt=Math.floor(now/60000); const stage=info.stage=rules.growthStage(rules.homeDay(resident,now));model.scale.setScalar(growthSizes[stage]);if(info.stars)info.stars.visible=stage===2; }
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
      if (kind==='foldsail' || kind==='rainbell' || kind==='islet') fantasyPose(model,{stage:info.stage,sail:eating?1-smooth((age-.65)/.6):1-Math.min(1,Math.abs(Math.cos(a+.23))*1.4),bell:eating?Math.exp(-Math.pow((age-.43)/.17,2)):0});
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
      if (info.tail) info.tail.rotation[kind==='dolphin'?'x':'y']=(bottom ? .12 : .23)*Math.sin(time*(meal?.uid===resident.uid?13:7)+i);
      if (info.left && info.right) { const flap=.12*Math.sin(time*4+i); info.left.rotation.z=flap; info.right.rotation.z=-flap; }
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
    const stand = new THREE.Group(), top = meshOf(new THREE.BoxGeometry(.58,.05,.38),0xb29770); top.position.y=-.025;stand.add(top);
    for (const dx of [-.23,.23]) for (const dz of [-.14,.14]) { const leg=meshOf(new THREE.BoxGeometry(.048,.62,.048),0x847965);leg.position.set(dx,-.34,dz);stand.add(leg); }
    tank.add(stand);
    const pellets=Array.from({length:3},()=>{const p=meshOf(new THREE.IcosahedronGeometry(.0053,0),0xe6a451); p.visible=false; tank.add(p); return p;});
    const jet=new THREE.Mesh(new THREE.CylinderGeometry(.0018,.0023,1,5),new THREE.MeshBasicMaterial({color:0xb1eaf5}));jet.visible=false;tank.add(jet);
    tank.visible=false; root.add(tank); root.name='shallows';
    live={ root,fish,ring,ripple,netX,netZ,tank,shell,stand,school:[],pellets,jet,jetDir:new THREE.Vector3(),jetTip:new THREE.Vector3(),jetUp:new THREE.Vector3(0,1,0),meal:null,departures:[],guest,visit:null,activeSeconds:0,spots:[],version:-1,epoch:-1,inRing:false,grip:null,rev:-1 }; return root;
  }
  function update(delta,time) {
    if (!live) return;
    const state=live, blocks=V3.houseBlocks, epoch=rules.encounter(Date.now()), shore=ui.shore(), storm=closed();
    if (state.version !== blocks?.version) { state.spots=berths(); state.version=blocks?.version; state.rev=-1; }
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
    if (epoch !== state.epoch || (available && !state.fish.children.length)) {
      const kind = rules.fishAt(epoch); setFish(state.fish,kind,.047,rules.fishFormAt(kind,epoch)); state.tail = state.fish.getObjectByName('tail'); state.epoch=epoch; state.rejoin=null;
    }
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
    state.fish.visible=state.ring.visible=available;
    if (!available) state.inRing = false;
    state.ring.material.color.setHex(grip ? 0xf58c48 : state.inRing ? 0xffcb52 : 0xf4e7c4);
    if (state.departures.length) updateDepartures(state,delta,storm);
    if (state.changedEpoch !== epoch || state.storm !== storm || state.lastCatch !== shore?.lastCatch) {
      state.changedEpoch=epoch;state.storm=storm;state.lastCatch=shore?.lastCatch;
      ui.redraw();
    }
  }
  V3.shallows={ track,closed,net,currentBerth,openTank, fishModel: (species, form) => V3.shoreModels.fish(species, .047, form), get state(){return live;} };
  V3.on('shore:swim',ui.redraw);
  V3.scene?.part({ id:'shallows', order:72, build,update,dispose(){ pendingCatch=null; landing=null; live=null; ui.close(); } });
})(window.V3);
