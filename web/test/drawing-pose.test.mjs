import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { actorCabin } from '../tools/lib/actor-cabin.mjs';

for (const style of ['Twin','Loose']) {
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
