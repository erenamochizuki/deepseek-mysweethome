import { readFile } from 'node:fs/promises';
import { GIRL_ZIP, hasGirlZip } from './girl-asset.mjs';

function fixtureFiles() {
  const bone = (name, pivot, origin, size) => ({ name, ...(name !== 'AllBody' && { parent: 'AllBody' }), pivot, cubes: [{ origin, size, uv: [0, 0] }] });
  const bones = [bone('AllBody', [0, 8, 0], [-2, 8, -1], [4, 5, 2]), bone('Head', [0, 13, 0], [-2, 13, -2], [4, 4, 4])];
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    bones.push(bone(side + 'Arm', [3 * sign, 13, 0], [3 * sign - 1, 8, -1], [2, 5, 2]),
      bone(side + 'Leg', [sign, 8, 0], [sign - 1, 0, -1], [2, 8, 2]));
  }
  const still = { loop: true, animation_length: 1 };
  const swim = { ...still, bones: { RightArm: { rotation: { 0: [-65, 0, 0], .5: [60, 0, 0], 1: [-65, 0, 0] } } } };
  const eat = { loop: true, animation_length: 2, bones: { RightArm: { rotation: { 0: [0, 0, 0], 1.25: [-60, 0, 0], 2: [0, 0, 0] } } } };
  return new Map(Object.entries({
    'main.json': { 'minecraft:geometry': [{ bones }] },
    'main.animation.json': { animations: { run: still, sit: still, use_mainhand: still, swim } },
    'tlm.animation.json': { animations: { bookshelf: still, keyboard: still } },
    'arm.animation.json': { animations: { 'use_mainhand:eat': eat } },
  }).map(([name, data]) => [name, Buffer.from(JSON.stringify(data))]));
}

let bundled;
export async function loadActorTestModel(engine, zip) {
  const bytes = zip ?? (hasGirlZip() ? await (bundled ??= readFile(GIRL_ZIP)) : null);
  const model = engine.ysm.load(bytes ? await engine.zip.read(bytes) : fixtureFiles());
  model.textures = [];
  return model;
}
