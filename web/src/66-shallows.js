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
    for (const table of blocks.furnInstances('dining_table')) {
      const centre = table.cell.map(value => value + .5), local = blocks.place ? blocks.unplacePoint(centre, blocks.place) : centre;
      const key = 'table:' + ui.houseId() + ':' + local.map(Math.floor).join('.'), offset = V3.furnMc.rotate([0,0,.325], table.facing);
      spots.push({ key, name: `餐桌的一角（${table.cell.join('，')}）`, pos: [centre[0]+offset[0],table.cell[1]+.625,centre[2]+offset[2]], yaw: -V3.furnMc.FACING_Y[table.facing]*Math.PI/180, cell: table.cell });
    }
    return spots;
  }
  function setBerth(next) { return ui.save('shore_berth', { next, expected: ui.shore().berth }, next ? '鱼缸安顿好了。' : '鱼缸已收好，住户仍在。'); }
  const currentBerth = () => live?.spots.find(spot => spot.key === ui.shore()?.berth);
  function setFish(holder, species, scale) {
    if (holder.userData.species === species) return;
    holder.clear(); holder.add(V3.shoreModels.fish(species, scale)); holder.userData.species = species;
  }
  const openTank = () => ui.open('小屋鱼缸', tankMenu);
  function tankMenu({ text, button, body }) {
    const shore = ui.shore();
    button('鱼类图鉴', () => V3.fishGuide.open());
    if (!client.canShore()) { text('存档还没就绪，或需要更新小屋服务。'); return; }
    const spot = currentBerth(), spots = live?.spots || [];
    text(spot ? `鱼缸在${spot.name} · ${residents().length} / 3 尾。` : '鱼缸已收好，不用购买。选下面一个位置，就会直接摆在那里。');
    if (!spot && !spots.length) text('这里没有适合的台面，在小屋放一张餐桌后再试。');
    for (const where of spots) if (where !== spot) button('摆在' + where.name, () => setBerth(where.key));
    if (shore.berth) button('收起鱼缸', () => setBerth(null));
    for (const fish of residents()) {
      text(`${fish.name || names[fish.kind]} · ${names[fish.kind]}${fish.fed ? ' · 喂过食' : ''}`);
      const input = V3.util.el('input', { type: 'text', maxlength: '24', value: fish.name, placeholder: '给这条鱼起名', 'aria-label': '鱼的名字' }); body.append(input);
      const change = (action, extra, msg) => ui.save('shore_fish', { uid: fish.uid, action, ...extra }, msg);
      button('取名', () => change('name',{ name: input.value.trim() },'新名字记住了。'));
      button('喂食', () => change('feed',{},'鱼游上来，啄走了食粒。'), !spot);
      button('放归', () => change('release',{},'它游回浅海了，观察册还记得它。'));
    }
    text('收缸不会丢鱼，离线也不用补喂。');
  }
  function catchMenu({ text, button }) {
    const epoch = pendingCatch;
    if (epoch === null) { text('它已经游走了。'); return; }
    text('捞到了' + names[rules.fishAt(epoch)] + '！它正在网里扑腾。');
    const spot = currentBerth(), canKeep = spot && residents().length < 3;
    const commit = async berth => {
      const ok = await ui.save('shore_catch', { epoch, kind: rules.fishAt(epoch), berth }, berth ? '新住户在缸里摇了摇尾巴。' : '鱼已放归，观察册添了一笔。');
      if (ok && live && pendingCatch === epoch) { pendingCatch = null; ui.close(); }
    };
    button('看一眼，放回海里', () => commit(null));
    button(spot ? '带回鱼缸' : '还没有摆好鱼缸', () => commit(spot.key), !canKeep);
    if (!spot) text('这次先放回海里也算观察。下次抄网前，点岸边救生圈里的「摆放 / 查看鱼缸」选一个位置。');
    if (spot && !canKeep) text('鱼缸住满了。可以放心放归，不会丢掉观察记录。');
  }
  function net() {
    if (!live || closed() || !client.canShore()) return false;
    const epoch = rules.encounter(Date.now());
    if (ui.shore().lastCatch >= epoch) { ui.toast('这一拨鱼游远了。每五分钟会换一拨。'); return false; }
    if (live.epoch !== epoch || !live.inRing) { ui.toast('抄网落空了，等鱼游进网圈再点。'); return false; }
    if (pendingCatch !== null) return false;
    live.release = null; live.grip = { x: live.fish.position.x, z: live.fish.position.z, yaw: live.fish.rotation.y, age: 0 };
    pendingCatch = epoch; ui.open('抄网里的小鱼', catchMenu, () => {
      if (live?.grip && pendingCatch === epoch && !closed() && ui.shore()?.lastCatch < epoch) {
        live.release = { position:live.fish.position.clone(), rotation:live.fish.rotation.clone(), age:0 };
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
      const label = rules.REEF_FISH[species];
      if (!ui.shore().observed.includes(species)) await ui.save('shore_watch', { epoch, kind: species }, '一起看见了' + label + '，图鉴已点亮。');
      V3.actor?.say?.('看，那尾' + label + '游过去了。');
    };
    if (V3.actor?.watchReef?.({point, locate, valid, seen})) ui.toast('小鲸鱼正往岸边走，一起看看那群鱼。');
    else ui.toast('她现在走不开，等她空下来再点鱼。');
  }
  function beachMenu({ text, button }) {
    const phase = V3.actor?.water;
    text(closed() ? '雷雨来了，先不上水。' : V3.actor?.watchingReef ? '她正和你一起看远礁鱼群。' : phase === 'watch' ? '她在岸边陪你看鱼。' : phase === 'approach' ? '她正在去下水点的路上。' : phase === 'back' ? '她正沿原路回岸。' : '白环圈出抄网的位置。圈变金时，点鱼或按「抄网」。');
    if (!phase) button('邀请她去浅海', () => { if (!V3.actor?.startWater()) ui.toast('她现在走不开，或没有通往岸边的路。'); ui.redraw(); }, closed());
    else {
      if (phase === 'swim') button(V3.actor.floating ? '继续游' : '漂一会儿', () => { V3.actor.floatWater(); ui.redraw(); });
      button(phase === 'approach' ? '取消邀请' : V3.actor?.watchingReef ? '结束观察' : '上岸', () => V3.actor.leaveWater(), phase === 'back');
    }
    const done = client.canShore() && ui.shore().lastCatch >= rules.encounter(Date.now());
    button(done ? '等待下一拨鱼' : '抄网', net, closed() || done || !client.canShore());
    button('摆放 / 查看鱼缸', openTank);
    button('鱼类图鉴', () => V3.fishGuide.open());
  }
  ui.register('swimPost', '救生圈 · 浅海 / 抄网 / 鱼缸', () => ui.open('浅海下水点', beachMenu));
  ui.register('netFish', '浅海鱼影 · 抄网', net, () => !!live && !closed() && client.canShore() && ui.shore().lastCatch < rules.encounter(Date.now()));
  ui.register('reefWatch', '远礁鱼群 · 邀小鲸鱼到岸边观察', watchReef, () => !!live && !closed() && client.canShore());
  ui.register('homeTank', '小屋鱼缸 · 看看住户', openTank, () => !!currentBerth());
  const meshOf = (geometry, color) => new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({ color, roughness:.82 }));
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
    const ripple = meshOf(new THREE.TorusGeometry(.23,.012,5,28),0xd4fff5); ripple.rotation.x = -Math.PI/2; ripple.visible = false; root.add(ripple);
    const tank = ui.tag(new THREE.Group(),'homeTank'), vessel = V3.shoreModels.build('aquarium',.025);
    vessel.name = 'tank-body'; tank.add(vessel);
    const water = new THREE.Mesh(new THREE.BoxGeometry(.373,.16,.195),new THREE.MeshStandardMaterial({color:0x8cd1d1,transparent:true,opacity:.22,depthWrite:false}));
    water.position.y=.121; tank.add(water);
    const stand = new THREE.Group(), top = meshOf(new THREE.BoxGeometry(.58,.05,.38),0xb29770); top.position.y=-.025;stand.add(top);
    for (const dx of [-.23,.23]) for (const dz of [-.14,.14]) { const leg=meshOf(new THREE.BoxGeometry(.048,.62,.048),0x847965);leg.position.set(dx,-.34,dz);stand.add(leg); }
    tank.add(stand);
    const school = Array.from({length:3},() => {const model=new THREE.Group();tank.add(model);return model;});
    tank.visible=false; root.add(tank); root.name='shallows';
    live={ root,fish,ring,ripple,netX,netZ,tank,stand,school,spots:[],version:-1,epoch:-1,inRing:false,grip:null,rev:-1 }; return root;
  }
  function update(delta,time) {
    if (!live) return;
    const state=live, blocks=V3.houseBlocks, epoch=rules.encounter(Date.now()), shore=ui.shore(), storm=closed();
    if (state.version !== blocks?.version) { state.spots=berths(); state.version=blocks?.version; state.rev=-1; }
    if (state.rev !== client.data?.rev) {
      const spot=currentBerth(); state.tank.visible=!!spot;
      if (spot) { state.tank.position.set(...spot.pos); state.tank.rotation.y=spot.yaw; state.stand.visible=!!spot.stand; }
      residents().forEach((fish,index) => setFish(state.school[index],fish.kind,.0056)); state.rev=client.data?.rev;
    }
    const spot=currentBerth(); state.tank.visible=!!spot && (!spot.cell || blocks.visibleAt(...spot.cell));
    if (state.tank.visible) state.school.forEach((model,index) => {
      const resident=residents()[index]; model.visible=!!resident; if (!resident) return;
      const angle=time*.65+index*2.4, fed=resident.fed>0 && Date.now()-resident.fed<3500;
      model.position.set(.112*Math.sin(angle),fed ? .162 : .075+index*.025,.042*Math.cos(angle));model.rotation.y=Math.atan2(.112*Math.cos(angle),-.042*Math.sin(angle));
    });
    if (pendingCatch !== null && (pendingCatch !== epoch || shore?.lastCatch >= pendingCatch || storm || !client.canShore())) ui.close();
    if (epoch !== state.epoch) { setFish(state.fish,rules.fishAt(epoch),.047); state.tail = state.fish.getObjectByName('tail'); state.epoch=epoch; state.release=null; }
    const phase = time * .73, swing = Math.sin(phase);
    const edge = Math.max(0, Math.min(1, (Math.abs(swing) - .25) / .31)), waiting = 1 - edge * edge * (3 - 2 * edge);
    const px = state.netX + 1.06*swing*(1-waiting) + .035*waiting*Math.sin(time*15);
    const pz = state.netZ + .19*Math.sin(phase*2)*(1-waiting) + .02*waiting*Math.sin(time*18);
    const waterAt=(x,z) => V3.water?.waveY(x,z) ?? V3.layout.sea.y;
    state.fish.position.set(px,waterAt(px,pz)-.17 + .04*waiting*Math.abs(Math.sin(time*15)),pz);
    state.fish.rotation.set(waiting*.17*Math.sin(time*14), Math.atan2(.774*Math.cos(phase),.277*Math.cos(phase*2)), waiting*.24*Math.sin(time*17));
    state.ring.position.set(state.netX,waterAt(state.netX,state.netZ)+.026,state.netZ);state.inRing=Math.hypot(px-state.netX,pz-state.netZ)<=.38;
    const grip = state.grip;
    state.ripple.visible = !!grip;
    if (grip) {
      grip.age += delta;
      const lift = Math.min(1, grip.age * 4), beat = Math.sin(grip.age * 19), pull = lift * .72;
      state.fish.position.set(grip.x + (state.netX-grip.x)*pull, waterAt(state.netX,state.netZ)-.17 + lift*(.17+.055*Math.abs(beat)), grip.z+(state.netZ-grip.z)*pull);
      state.fish.rotation.set(lift*.46*beat,grip.yaw+lift*.24*Math.sin(grip.age*12),lift*.58*Math.sin(grip.age*15));
      state.ripple.position.copy(state.ring.position); state.ripple.scale.setScalar(.65 + (grip.age*1.8 % 1)*.9); state.inRing = true;
    } else if (state.release) {
      const release = state.release, progress = Math.min(1,(release.age += delta)/.55), blend = 1-progress*progress*(3-2*progress);
      state.fish.position.lerp(release.position,blend);
      for (const axis of ['x','y','z']) { const offset = release.rotation[axis]-state.fish.rotation[axis]; state.fish.rotation[axis] += blend*Math.atan2(Math.sin(offset),Math.cos(offset)); }
      state.inRing = Math.hypot(state.fish.position.x-state.netX,state.fish.position.z-state.netZ) <= .38;
      if (progress === 1) state.release = null;
    }
    if (state.tail) state.tail.rotation.y = grip ? .82*Math.sin(grip.age*24) : .22*(1-waiting)*Math.sin(time*7) + .48*waiting*Math.sin(time*16);
    state.ring.material.color.setHex(grip ? 0xf58c48 : state.inRing ? 0xffcb52 : 0xf4e7c4);
    state.fish.visible=!storm && (shore?.lastCatch ?? -1)<epoch;state.ring.visible=state.fish.visible;
    if (state.changedEpoch !== epoch || state.storm !== storm || state.lastCatch !== shore?.lastCatch) {
      state.changedEpoch=epoch;state.storm=storm;state.lastCatch=shore?.lastCatch;
      ui.redraw();
    }
  }
  V3.shallows={ track,closed,net,currentBerth,openTank, fishModel: species => V3.shoreModels.fish(species, .047), get state(){return live;} };
  V3.on('shore:swim',ui.redraw);
  V3.scene?.part({ id:'shallows', order:72, build,update,dispose(){ pendingCatch=null; landing=null; live=null; ui.close(); } });
})(window.V3);
