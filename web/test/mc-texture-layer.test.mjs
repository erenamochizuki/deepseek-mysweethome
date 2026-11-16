import assert from 'node:assert/strict';
import test from 'node:test';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const { V3 } = loadV3(['12-nbt', '13-share', '14-mc-instance', '14-mcjar', '15-mc-texture-layer', '15-mcmodel', '16-mcmesh', '17-mcfallback']);
const T = V3.mcTextureLayer, inflate = V3.mcInstance.inflateZlib;
const p = 'assets/minecraft/textures/block/stone.png';
const spriteId = 'minecraft:block/stone';
const png = rgb => V3.share.png.solid(16, 16, rgb);
const layer = files => ({ async read(path) { return files.get(path) || null; } });
const base = V3.mcjar.makePack(new Map([[p, png([17, 32, 47])]]), { inflateZlib: b => inflate(b, 8192) });
const rgb = sp => Array.from(sp.data.subarray(0, 3));

test('valid later pack wins, corrupt texture falls through, absent texture uses the base', async () => {
  const low = layer(new Map([[p, png([64, 75, 86])]]));
  const high = layer(new Map([[p, png([213, 16, 127])]]));
  const bad = layer(new Map([[p, png([1, 2, 3]).slice(0, -12)]]));
  assert.deepEqual(rgb(await T.apply(base, [low, high], inflate).sprite(spriteId)), [213, 16, 127]);
  assert.deepEqual(rgb(await T.apply(base, [low, bad], inflate).sprite(spriteId)), [64, 75, 86]);
  assert.deepEqual(rgb(await T.apply(base, [bad], inflate).sprite(spriteId)), [17, 32, 47]);
  assert.equal(T.apply(base, [], inflate), base);
});

test('fallback model can use an instance PNG without a client jar; an unrelated block stays unchanged', async () => {
  const pack = T.apply(null, [layer(new Map([[p, png([216, 27, 91])]]))], inflate);
  const mesh = await V3.mcmesh.build({ size: [2, 1, 1], offset: [0, 0, 0], palette: ['minecraft:stone', 'minecraft:dirt'], cells: Int32Array.of(0, 1) }, { pack, light: false });
  const { atlas } = mesh;
  assert.ok(atlas.rects.has(spriteId));
  const [x, y] = atlas.rects.get(spriteId);
  assert.deepEqual(Array.from(atlas.levels[0].slice((x + y * atlas.width) * 4, (x + y * atlas.width) * 4 + 4)), [216, 27, 91, 255]);
  assert.equal(atlas.rects.has('minecraft:block/dirt'), false);
  assert.ok(mesh.layers.solid.quads >= 10);
});
