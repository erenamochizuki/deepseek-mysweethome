import assert from 'node:assert/strict';
import path from 'node:path';
import { launchBrowser, serveFiles, WEB_DIR } from '../tools/mc-lib.mjs';

const build = process.env.CABIN_BUILD_DIR || path.join(WEB_DIR, 'dist');
const server = await serveFiles({'/cabin.html': path.join(build, 'cabin.html')});
let browser;
try {
  browser = await launchBrowser({width:1080, height:760, gpu:'swiftshader'});
  for (const area of ['shallows', 'reef']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      window.testTide = Date.UTC(2026,10,18,4,1);
      Date.now = () => window.testTide;
    });
    await page.goto(server.url+'/cabin.html?auto=0&wx=clear&time=12:00');
    await page.waitForFunction(() => window.__READY && V3.shallows?.state && V3.cabinInventory?.canShore(), {timeout:120000});
    const report = await page.evaluate(area => {
      const {R, inventoryRules:rules} = V3;
      R.freeze(0);
      const shallow = area === 'shallows';
      const part = V3.scene.parts.find(p => p.id === (shallow ? 'shallows' : 'sealife'));
      const {fish} = V3.shallows.state;
      const schools = [];
      R.scene.traverse(mesh => { if(mesh.isInstancedMesh && mesh.userData.clickable === 'reefWatch') schools.push(mesh); });
      schools.sort((a,b) => a.name.localeCompare(b.name));
      if (!shallow && schools.length !== 3) throw Error('没有找到三个远礁鱼群');
      let time = 0;
      const update = () => part.update(1/60, time += 1/60);
      update();
      const bounds = new THREE.Box3(), instance = new THREE.Matrix4(), transform = new THREE.Matrix4();
      function boxes(mesh) {
        mesh.updateWorldMatrix(true,true);
        if (shallow) return [new THREE.Box3().setFromObject(mesh)];
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        return Array.from({length:mesh.count}, (_,i) => {
          mesh.getMatrixAt(i, instance);
          transform.multiplyMatrices(mesh.matrixWorld, instance);
          return mesh.geometry.boundingBox.clone().applyMatrix4(transform);
        });
      }
      const groups = shallow ? [fish] : schools;
      for (const mesh of groups) for(const box of boxes(mesh)) bounds.union(box);
      const centre = bounds.getCenter(new THREE.Vector3());
      const extent = bounds.getSize(new THREE.Vector3());
      // A close view at the net; at the reef pull back enough to see all three schools.
      const distance = shallow ? 3 : 2.1*Math.max(extent.x, extent.z);
      R.setView({pos:[centre.x+.18*distance,centre.y+.6*distance,centre.z-distance],target:centre.toArray(),fov:43});
      R.camera.updateMatrixWorld(true);
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(R.camera.projectionMatrix,R.camera.matrixWorldInverse));
      function sample(mesh) {
        const volumes = boxes(mesh);
        const centres = volumes.map(box => box.getCenter(new THREE.Vector3()).project(R.camera));
        return {kind:mesh.userData.species, visible:mesh.visible && volumes.some(b=>frustum.intersectsBox(b)),
          x:centres[0].x, y:centres[0].y, centres:centres.map(p => [p.x,p.y])};
      }
      const start = groups.map(sample), roster = t => shallow ? [rules.fishAt(t)] : rules.reefAt(t);
      let next = rules.encounter(Date.now())+1;
      while(roster(next).some((id,i)=>id === start[i].kind)) next++;
      const intermediate = roster(next);
      let last = next + 1;
      while(roster(last).some((id,i)=>id === intermediate[i] || id === start[i].kind)) last++;
      window.testTide = next*300000 + 1000;
      const log = groups.map((_,i)=>[start[i]]);
      // Advance the real clock twice during one departure, e.g. after the page returns from sleep.
      for (let frame = 0; frame < 900; frame++) {
        if (frame === 6) window.testTide = last*300000 + 1000;
        update();
        groups.forEach((mesh,i)=>log[i].push(sample(mesh)));
      }
      const result = log.map((frames,i) => {
        const leave = frames.findIndex(f => f.kind !== frames[0].kind);
        const arrive = frames.findIndex(f => leave >= 0 && f.kind === roster(last)[i]);
        const returning = frames.slice(arrive).findIndex(f=>f.visible);
        let maxVisibleStep = 0;
        for (let j=1;j<frames.length;j++) {
          const a=frames[j-1], b=frames[j];
          if (a.kind!==b.kind || (!a.visible && !b.visible)) continue;
          for (const [k,[x,y]] of b.centres.entries()) {
            if (Math.abs(x)>1.2 || Math.abs(y)>1.2) continue;
            const [u,v]=a.centres[k];
            maxVisibleStep=Math.max(maxVisibleStep,Math.hypot(x-u,y-v));
          }
        }
        const visibleSteps = list => list.filter((f,j)=>j && f.visible && list[j-1].visible && Math.hypot(f.x-list[j-1].x,f.y-list[j-1].y)>.001).length;
        return {initial:start[i], expected:roster(last)[i], final:frames.at(-1).kind, leave, arrive,
          maxVisibleStep, oldMoved:visibleSteps(frames.slice(0,leave)), newMoved:visibleSteps(frames.slice(arrive,arrive+returning+90)),
          beforeSwap:frames[leave-1], firstNew:frames[arrive], returning, staleVisible:frames.some(f=>f.visible && f.kind===intermediate[i])};
      });
      R.freeze(null);
      return result;
    }, area);
    for (const row of report) {
      const why = area+' '+JSON.stringify(row);
      assert.ok(row.initial.visible && row.leave > 6 && row.arrive >= row.leave, why);
      assert.equal(row.final,row.expected,why);
      assert.equal(row.beforeSwap.visible,false,'旧鱼离开视野后才可换模型 '+why);
      assert.equal(row.firstNew.visible,false,'新鱼必须从画面外出现 '+why);
      assert.ok(row.returning > 0 && row.oldMoved > 2 && row.newMoved > 2,why);
      assert.ok(row.maxVisibleStep<.2,'鱼身逐帧游进游出 '+why);
      assert.equal(row.staleVisible,false,'时间再次变化时不应展示已过期鱼群 '+why);
    }
    // Leave during the next departure. Reopening the cabin should start at the current tide.
    const record = await page.evaluate(area=>{
      const shore=V3.shore.shore();
      const part=V3.scene.parts.find(p=>p.id===(area==='shallows'?'shallows':'sealife'));
      window.testTide+=300000;
      for(let i=0; i<5;i++) part.update(1/60,15+i/60);
      return {observed:shore.observed,catch:shore.lastCatch};
    },area);
    await page.reload({waitUntil:'load'});
    await page.waitForFunction(()=>window.__READY && V3.shallows?.state?.fish.userData.species && V3.cabinInventory.canShore(), {timeout:120000});
    const fresh = await page.evaluate(area=>{
      const {inventoryRules:rules}=V3, epoch=rules.encounter(Date.now()),shore=V3.shore.shore();
      const groups=[];
      V3.R.scene.traverse(mesh=>{if(mesh.isInstancedMesh && mesh.userData.clickable==='reefWatch')groups.push(mesh);});
      groups.sort((a,b)=>a.name.localeCompare(b.name));
      const ok=area==='shallows' ? V3.shallows.state.fish.userData.species===rules.fishAt(epoch)
        : groups.every((mesh,i)=>mesh.userData.species===rules.reefAt(epoch)[i]);
      return {ok,record:{observed:shore.observed,catch:shore.lastCatch}};
    },area);
    assert.ok(fresh.ok,'重新打开小屋后使用当前一轮鱼讯');
    assert.deepEqual(fresh.record,record,'换鱼不改变图鉴及捕捞记录');
    assert.deepEqual(errors,[]);
    console.log(area, report.map(r => r.initial.kind+' → '+r.final+' (offscreen swap frame '+r.leave+', return +'+r.returning+')').join(', '));
    await page.close();
  }
} finally { await browser?.close(); await server.close(); }
