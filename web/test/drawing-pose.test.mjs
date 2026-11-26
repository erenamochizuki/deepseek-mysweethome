import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { actorCabin } from '../tools/lib/actor-cabin.mjs';

for (const style of ['Twin','Loose']) {
  test(style + ' 停在画垫期间关闭站立待机，离开以后恢复', async t => {
    const zip = await readFile(new URL('../assets/characters/Blue-Whale-Maid-' + style + '.zip', import.meta.url));
    const {V,a,step,until} = await actorCabin(t,{zip});
    const body = a.inst.rig.byLower.body;
    const standingOffset = () => body.position.distanceTo(body.userData.rest);
    const [x,y,z] = V.artDesk.spot().center;
    a.place(x,z+1.4,Math.PI,y);
    step(.15);
    assert.ok(standingOffset() > .001);
    assert.ok(a.startBehavior('draw',{seconds:14}));
    assert.equal(a.behavior.phase,'to_art_desk');
    assert.equal(a.inst.actorAnimation.posed,false);
    until(()=>a.behavior?.phase === 'action');
    step(1);
    assert.equal(a.inst.actorAnimation.posed,true);
    assert.equal(standingOffset(),0);
    assert.ok(a.drawingProgress < 1);
    step(8);
    assert.equal(a.drawingProgress,1);
    assert.equal(standingOffset(),0);
    assert.ok(a.root.rotation.x > 1);
    until(()=>!a.behavior);
    step(.15);
    assert.equal(a.inst.actorAnimation.posed,false);
    assert.ok(standingOffset() > .001);
  });
  test(style + ' 趴下画画时双脚翘起，结束或打断后站回落脚点', async t => {
    const zip=await readFile(new URL('../assets/characters/Blue-Whale-Maid-'+style+'.zip',import.meta.url));
    const {V,T,a,step,until}=await actorCabin(t,{zip});
    const [x,y,z]=V.artDesk.spot().center, bones=a.inst.rig.byLower;
    const height=name=>bones[name].getWorldPosition(new T.Vector3()).y-y;
    a.place(x,z+1.4,Math.PI,y);
    for(const cancel of [true,false]) {
      assert.ok(a.startBehavior('draw',{seconds:4}));
      until(()=>a.behavior?.phase==='action');step(1);
      assert.ok(a.root.rotation.x>1);
      assert.ok(height('head')<.4 && height('head')>.16);
      for(const side of ['left','right']) assert.ok(height(side+'foot')>height(side+'shin')+.1);
      assert.ok(height('lefthand')<.105 && height('lefthand')>=.02);
      const ankle=height('leftfoot');step(.25);assert.notEqual(height('leftfoot'),ankle);
      if(cancel) a.cancelBehavior(); else until(()=>!a.behavior);
      assert.ok(Math.abs(a.root.rotation.x)<.001);
      assert.ok(a.root.position.distanceTo(new T.Vector3(...a.pos))<.001);
      step(.1);
      assert.ok(height('leftfoot')<height('leftshin'));
    }
  });
}

test('导入模型趴下画画时不累计闲置计时，起身后恢复铁盆动作', async t => {
  const zip = await readFile(new URL('../../蓝色大肥鱼_1.2.zip',import.meta.url));
  const {V,a,step,until} = await actorCabin(t,{zip});
  const idle = () => a.inst.slotInfo().find(s => s.key === 'parallel_7').act.includes('idle_1');
  const [x,y,z] = V.artDesk.spot().center;
  a.place(x,z+1.4,Math.PI,y);
  a.rest(true);
  assert.ok(a.startBehavior('draw',{seconds:55}));
  until(()=>a.behavior?.phase==='action');
  for (let i=0; i<46; i++) {
    step(1);
    assert.equal(idle(),false);
    assert.equal(a.inst.getVar('timer'),0);
  }
  assert.equal(a.drawingProgress,1);
  a.cancelBehavior();
  step(.1);
  assert.equal(a.inst.actorAnimation.posed,false);
  until(idle,50,'起身后站立待机重新计时');
});
