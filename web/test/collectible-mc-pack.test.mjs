import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { decodePng, makeZip } from '../tools/mc-lib.mjs';
import { makeCollectiblePack } from '../tools/collectible-mc-pack.mjs';

const { V3 } = loadV3(['14-mcjar', '15-mcmodel', '31-collectible-abalone', '31-collectible-cubes', '31-collectible-render']);
const get = (files, p) => JSON.parse(files.get(p));
const ns = 'assets/xiaojingyu/';

test('26.1.2 resource pack contains matching assets, baked faces and atlas bytes', async () => {
  const { files, stats } = makeCollectiblePack();
  assert.deepEqual(get(files, 'pack.mcmeta').pack.min_format, [84, 0]);
  assert.deepEqual(get(files, 'pack.mcmeta').pack.max_format, [84, 0]);
  for (const id of ['sea_urchin_test', 'rainbow_abalone']) {
    const spec = V3.collectibleCubes.build(id);
    const definition = get(files, ns + `items/${id}.json`);
    assert.deepEqual(definition, { model: { type: 'minecraft:model', model: `xiaojingyu:item/${id}` } });
    const model = get(files, ns + `models/item/${id}.json`);
    assert.equal(model.textures.skin, `xiaojingyu:item/${id}`);
    assert.deepEqual(model.elements, V3.collectibleRender.elements(spec));
    assert(model.elements.length > 0 && model.elements.length <= 64, `${id}: at most 64 elements`);
    const atlas = await decodePng(files.get(ns + `textures/item/${id}.png`));
    assert.equal(atlas.width, spec.width); assert.equal(atlas.height, spec.height);
    assert.deepEqual(atlas.data, spec.rgba);
    const baked = V3.mcmodel.bakeModel({ ...model, textures: V3.mcmodel.resolveTextures([model]) });
    assert.equal(baked.length, stats.find((row) => row.id === id).faces);
    assert(baked.every((q) => q.sprite === model.textures.skin && q.uv.every((v) => v >= 0 && v <= 1)));
  }
  const pot = get(files, ns + 'models/block/flower_pot.json');
  assert(pot.elements.length > 0 && pot.elements.length < 32);
  assert(files.has(ns + 'models/item/flower_pot.json') && files.has(ns + 'textures/block/flower_pot.png'));
  const zip = makeZip([...files]);
  const listed = V3.mcjar.listZip(zip);
  assert.deepEqual(listed.map((e) => e.name), [...files.keys()]);
  for (const e of listed) {
    assert.equal(e.method, 8);
    const start = e.offset + 30 + zip.readUInt16LE(e.offset + 26) + zip.readUInt16LE(e.offset + 28);
    assert.deepEqual(inflateRawSync(zip.subarray(start, start + e.csize)), files.get(e.name));
  }
});
