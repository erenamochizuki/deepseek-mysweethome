import assert from 'node:assert/strict';
import test from 'node:test';
import { packModel } from '../tools/lib/shore-blockbench.mjs';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const layers = ['coral_1', 'coral_2', 'tide_pool', 'tide_arch', 'flower_crown'];
const packed = packModel(new URL('../../models/shore/fish/islet.bbmodel', import.meta.url));
const { V3, window: { THREE } } = loadV3(['31-shore-models'], {
  three: 'real', globals: { __V3_SHORE_MODELS: { fish_islet: packed } },
});
function resident() {
  const fish = V3.shoreModels.fish('islet', 1);
  fish.updateMatrixWorld(true);
  return fish;
}
function layer(fish, name) {
  const group = fish.getObjectByName(name);
  assert.ok(group, `Missing growth layer: ${name}`);
  return group;
}
const bounds = group => new THREE.Box3().setFromObject(group, true);
const centre = box => box.getCenter(new THREE.Vector3());

test('each reveal is an independently drawable sibling; the complete resident stays cheap', () => {
  const fish = resident(), deck = layer(fish, 'islet_deck');
  for (const name of layers) {
    const group = layer(fish, name);
    assert.equal(group.parent, deck);
    assert.ok(!bounds(group).isEmpty());
  }
  assert.ok(fish.getObjectByName('tail'));
  let meshes = 0, triangles = 0;
  const materials = new Set();
  fish.traverseVisible(part => {
    if (!part.isMesh) return;
    meshes++; triangles += part.geometry.attributes.position.count / 3;
    materials.add(part.material);
  });
  assert.ok(meshes <= 9 && triangles <= 1800, `${meshes} meshes, ${triangles} triangles`);
  assert.equal(materials.size, 1);
});

test('second reef sits lower, across the back from the first, not inside its profile', () => {
  const fish = resident(), a = bounds(layer(fish, 'coral_1')), b = bounds(layer(fish, 'coral_2'));
  assert.ok(centre(a).x * centre(b).x < 0, 'reefs should favour opposite flanks');
  assert.ok(b.max.y < a.max.y - .5, 'the lilac shelf must be visibly lower');
  assert.ok(Math.abs(centre(a).z - centre(b).z) > 1.5, 'both reefs must read in profile');
});

test('the final garden leaves a framed window of daylight in the arch and both eyes exposed', () => {
  const fish = resident(), arch = layer(fish, 'tide_arch'), box = bounds(arch);
  const { y, z } = centre(box);
  function profile(target, height, depth, side = 1) {
    const ray = new THREE.Raycaster(new THREE.Vector3(side * 20, height, depth), new THREE.Vector3(-side, 0, 0));
    const meshes = []; target.traverseVisible(o => { if (o.isMesh) meshes.push(o); });
    return ray.intersectObjects(meshes, false);
  }
  // Test an aperture with area, not a hairline crack between blocks.
  for (const dy of [-.36, 0, .36]) for (const dz of [-.46, 0, .46]) {
    assert.equal(profile(fish, y + dy, z + dz).length, 0, 'arch window is plugged');
  }
  const samples = Array.from({length: 41}, (_, i) => i / 40);
  const hasPier = sign => samples.some(t => profile(arch, y, z + sign * t * (box.max.z - z)).length);
  assert.ok(hasPier(-1) && hasPier(1), 'two piers must frame the opening');
  assert.ok(samples.some(t => profile(arch, y + t * (box.max.y - y), z).length), 'the arch needs a span overhead');
  for (const side of [-1, 1]) {
    const hits = profile(fish, 2.69, 4.28, side);
    assert.ok(hits[0] && layer(fish, 'islet_body').getObjectById(hits[0].object.id), 'the face is not covered');
    const color = new THREE.Color().fromBufferAttribute(hits[0].object.geometry.attributes.color, hits[0].face.a);
    assert.ok(Math.max(color.r, color.g, color.b) < .13, 'dark pupil must read on each flank');
  }
});

function pose(fish, stage) {
  assert.equal(typeof V3.shoreModels.poseIslet, 'function', 'missing shared model pose');
  V3.shoreModels.poseIslet(fish, stage);
  fish.updateMatrixWorld(true);
}
function visibleSize(group) {
  const box = new THREE.Box3();
  group.traverseVisible(o => { if (o.isMesh) box.union(bounds(o)); });
  return box.getSize(new THREE.Vector3());
}
const close = (a, b) => assert.ok(a.distanceTo(b) < 1e-5, `${a.toArray()} != ${b.toArray()}`);

test('all three body dimensions grow every time, changing proportion within the original adult envelope', () => {
  const fish = resident(), sizes = [];
  for (let stage = 0; stage <= 5; stage++) {
    pose(fish, stage);
    sizes.push(visibleSize(layer(fish, 'islet_body')));
  }
  for (const axis of ['x','y','z']) {
    sizes.slice(1).forEach((v,i) => assert.ok(v[axis] > sizes[i][axis] * 1.025, `${axis}: stage ${i+1}`));
    assert.ok(sizes[0][axis] < sizes[5][axis] * .8);
  }
  assert.ok(sizes[0].y/sizes[0].z > 1.12 * sizes[5].y/sizes[5].z, 'the young fish should be rounder');
  const adult = new THREE.Vector3(8.438, 3.435, 12.542); // approved fin-to-fin, belly-to-back, lip-to-tail bounds
  sizes[5].toArray().forEach((v,i) => assert.ok(Math.abs(v/adult.getComponent(i)-1) < .035));
});

test('the complete deck rides the growing back by translation only, including the first moss rock', () => {
  const fish = V3.shoreModels.fish('islet', .23);
  pose(fish, 5);
  const deck = layer(fish, 'islet_deck'), moss = layer(fish, 'moss_rock');
  const pieces = [moss, ...layers.map(n => layer(fish,n))];
  const originals = pieces.map(g => ({ size: visibleSize(g), centre: centre(bounds(g)), basis:g.matrixWorld.clone().setPosition(0,0,0) }));
  for (const stage of [0,1,2,3,4,5,2,0]) {
    pose(fish,stage);
    const offset = centre(bounds(moss)).sub(originals[0].centre);
    if (stage < 5) assert.ok(offset.y < -.005, 'rock must sit lower on the smaller body');
    close(fish.scale, new THREE.Vector3(.23,.23,.23));
    close(deck.getWorldPosition(new THREE.Vector3()), layer(fish,'deck_socket').getWorldPosition(new THREE.Vector3()));
    pieces.forEach((g,i) => {
      assert.equal(g.visible, i <= stage);
      close(bounds(g).getSize(new THREE.Vector3()), originals[i].size);
      close(centre(bounds(g)).sub(originals[i].centre),offset);
      assert.deepEqual(g.matrixWorld.clone().setPosition(0,0,0).elements,originals[i].basis.elements);
    });
  }
});

// Sample the rendered flank in body-local coordinates. Colour comes from the hit
// triangle; the relief mask detects physical skin marks, independent of their colour.
function skinSample(fish) {
  const body=layer(fish,'islet_body'), meshes=[];
  body.traverseVisible(o=>{if(o.isMesh) meshes.push(o);});
  function hit(y,z) {
    const point=body.localToWorld(new THREE.Vector3(12,y,z));
    return new THREE.Raycaster(point,new THREE.Vector3(-1,0,0)).intersectObjects(meshes,false)[0];
  }
  const flank=hit(2.23,-.22);
  const color=new THREE.Color().fromBufferAttribute(flank.object.geometry.attributes.color,flank.face.a);
  const mask=[];
  for(let y=1.92;y<3.28;y+=.15)for(let z=-2.50;z<.74;z+=.16) {
    const h=hit(y,z);mask.push(h && body.worldToLocal(h.point).x>2.385 ? '1':'0');
  }
  return {rgb:color.getHex(),mask:mask.join('')};
}
test('each coat has a darker flank and a distinct physical marking pattern; the fan opens with age', () => {
  const fish=resident(), coats=[], fans=[];
  for(let stage=0;stage<6;stage++) {
    pose(fish,stage);coats.push(skinSample(fish));
    const body=layer(fish,'islet_body');fans.push(visibleSize(layer(fish,'tail')).divide(body.scale));
  }
  assert.equal(new Set(coats.map(s=>s.mask)).size,6);
  const greens=coats.map(({rgb})=>(rgb>>8)&255);
  assert.ok(greens[0]>180 && greens[5]<120);
  greens.slice(1).forEach((g,i)=>assert.ok(g<greens[i]-5));
  assert.ok((coats[5].rgb&255) > (coats[5].rgb>>16)+40, 'adult flank must remain teal');
  assert.ok(fans[5].y>fans[0].y*1.15, 'fan changes shape beyond whole-body growth');
});

test('reposing live and cabinet copies never changes a neighbour or resets its animated tail', () => {
  const a=resident(), b=resident();pose(a,2);pose(b,2);
  const before=skinSample(a), size=visibleSize(layer(a,'islet_body'));
  const tail=layer(b,'tail');tail.rotation.y=.43;
  // The standalone cabinet loads serialized Three objects, not a new packed build.
  const copy=new THREE.ObjectLoader().parse(a.toJSON());
  for (const fish of [b,copy]) {
    for (const different of [5,0]) {
      pose(fish,different);assert.notDeepEqual(skinSample(fish),before);
      assert.deepEqual(skinSample(a),before);close(visibleSize(layer(a,'islet_body')),size);
      assert.deepEqual(layers.filter(n=>layer(a,n).visible),layers.slice(0,2));
    }
    pose(fish,2);assert.deepEqual(skinSample(fish),before);
  }
  assert.equal(tail.rotation.y,.43);
});
