import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { packShore } from '../tools/lib/shore-blockbench.mjs';

const models = packShore();
function beach() {
  const host = loadV3(['30-shell-variants', '31-shore-models', '40-layout', '52-terrain', '58-inventory-rules', '63-hermit-life'], { three: 'real' });
  host.window.__V3_SHORE_MODELS = models;
  return host;
}

test('the painted moon keeps its atlas and UVs when a loan changes colour or is returned', () => {
  const { V3 } = beach(), crab = V3.shoreModels.build('hermit', .038);
  const mesh = crab.getObjectByName('shell_moon').children[0], original = mesh.geometry, map = mesh.material.map;
  assert.ok(map?.isDataTexture);
  assert.equal(original.getAttribute('uv').count, 37 * 36);
  assert.equal(original.getAttribute('uv').count, original.getAttribute('position').count);
  const pixels = map.image.data;
  assert.equal(pixels.length, map.image.width * map.image.height * 4);
  assert.ok(pixels.every((value, index) => index % 4 !== 3 || value === 255));
  for (const pat of ['mist', 'ring', 'dots', 'albino', 'sunset', 'iris']) {
    V3.shoreModels.wear(crab, 'moon', pat);
    assert.equal(mesh.geometry.getAttribute('uv'), original.getAttribute('uv'));
    assert.notDeepEqual(mesh.geometry.getAttribute('color').array, original.getAttribute('color').array);
  }
  V3.shoreModels.wear(crab, 'conch'); assert.equal(crab.getObjectByName('shell_conch').children[0].material.map, null);
  V3.shoreModels.wear(crab); assert.equal(mesh.geometry, original); assert.equal(mesh.material.map, map);
});

test('the hermit forages on clear sand and returns to its own den, even in preview or with a saved loan', () => {
  for (const loan of [false, true]) {
    const host = beach(), { V3, window } = host, den = V3.terrain.hermitDen;
    const store = V3.inventoryRules.freshState();
    if (loan) {
      for (const command of [{ op: 'collect', id: 'my-conch', kind: 'conch', pat: 'sunset', size: 65, at: 0, category: 'collectible' },
        { op: 'shore_loan', id: 'lend-conch', next: 'my-conch', expected: null }]) {
        V3.inventoryRules.apply(store, V3.inventoryRules.parseCommand(command), { clock: () => 0 });
      }
    }
    const saved = structuredClone(store.inventory);
    V3.cabinInventory = { data: loan ? store : null, canShore: () => false };
    let neighbors; V3.scene = { part: part => { neighbors = part; } }; host.load('64-shore');
    const root = neighbors.build({ rng: () => V3.util.rng(71) });
    const crab = root.children.find(child => child.userData.clickable === 'hermit'), mount = crab.getObjectByName('shell_mount');
    const steps = new Set(), patches = [], last = crab.position.clone(), near = new window.THREE.Vector3();
    let activity, yaw = crab.rotation.y, rests = 0, sawStride = false, scoops = 0, brushes = 0;
    const delta = loan ? 1 / 60 : .1;
    for (let frame = 0; frame < 75 / delta && rests < 2; frame++) {
      neighbors.update(delta, frame * delta);
      const current = V3.shore.state.activity, { x, z } = crab.position;
      assert.ok(crab.position.distanceTo(last) <= .521 * delta && Math.abs(crab.rotation.y - yaw) <= 3.41 * delta, 'no position or heading snaps');
      assert.ok(x >= den.yard.x0 && x <= den.yard.x1 && z >= den.frontZ && z <= den.yard.z1);
      if (current === 'wander' || current === 'sift' || current === 'groom' || current === 'home') {
        for (const across of [-.32, 0, .32]) for (const along of [-.32, 0, .32]) {
          assert.equal(V3.terrain.groundY(x + across, z + along), V3.terrain.seabedY(x, z));
          assert.equal(V3.terrain.isWet(x + across, z + along), false);
        }
      }
      assert.equal(crab.position.y, V3.terrain.seabedY(x, z) + .012);
      if (current !== activity) {
        steps.add(current); near.copy(crab.position);
        if (current === 'sift') patches.push(x);
        if (current === 'rest') { rests++; assert.ok(Math.hypot(x - den.x, z - den.frontZ) < .2); }
      }
      if (current === 'sift' || current === 'groom') assert.ok(crab.position.equals(near));
      if (current === 'sift' && crab.getObjectByName('claw_right').rotation.x < -.18) scoops++;
      if (current === 'groom' && crab.getObjectByName('claw_left').rotation.x > .55) brushes++;
      if (current === 'wander' && Math.abs(mount.rotation.z) > .06 && Math.abs(crab.getObjectByName('leg_left_1').rotation.y) > .18) sawStride = true;
      last.copy(crab.position); yaw = crab.rotation.y; activity = current;
    }
    assert.equal(rests, 2); assert.ok(steps.has('back') && sawStride && scoops && brushes);
    assert.ok((patches[0] - den.x) * (patches[1] - den.x) < 0, 'successive outings forage on different sides');
    assert.deepEqual(mount.children.filter(shell => shell.visible).map(shell => shell.name), [loan ? 'shell_conch' : 'shell_moon']);
    assert.deepEqual(structuredClone(store.inventory), saved, 'ambient behaviour never changes inventory or the first-shell portrait');
    neighbors.dispose();
  }
});

test('noticing a visitor or fitting a shell pauses in place, then continues the interrupted walk', () => {
  const { V3 } = beach(), den = V3.terrain.hermitDen, crab = V3.shoreModels.build('hermit', .038);
  const life = V3.hermitLife.create(crab, den, V3.util.rng(9)), body = crab.getObjectByName('body');
  const tick = (frames, fitting = false) => { for (let frame = 0; frame < frames; frame++) life.update(.05, fitting); };
  tick(69); assert.equal(life.activity, 'wander');
  const interrupted = crab.position.clone(), extended = body.position.z;
  life.notice(); tick(6);
  assert.equal(life.activity, 'notice'); assert.ok(crab.position.equals(interrupted) && body.position.z > extended + 2);
  tick(30); assert.equal(life.activity, 'wander'); assert.ok(crab.position.distanceTo(interrupted) > .1);
  const fittingSpot = crab.position.clone(); life.tryShell(); tick(40, true);
  assert.equal(life.activity, 'fit'); life.tryShell(); tick(5, true); assert.ok(body.position.z > extended + 2);
  tick(180, true); assert.ok(crab.position.equals(fittingSpot));
  tick(25); assert.equal(life.activity, 'wander'); assert.ok(crab.position.distanceTo(fittingSpot) > .1);
  const resumed = crab.position.clone(), eye = crab.getObjectByName('eye_right'), angle = eye.rotation.z;
  life.update(0, false); assert.ok(crab.position.equals(resumed)); assert.equal(eye.rotation.z, angle);
});
