import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const { getModDependencies } = loadV3(['53-house-mods'], { core: false, three: false }).V3.houseMods;
const { share: S, nbt: N } = loadV3(['12-nbt', '13-share'], { core: false, three: false }).V3;

const palette = Object.freeze([
  'unused:glass', 'zeta:fence[waterlogged=false]', 'minecraft:stone', 'alpha:lamp',
  'xiaojingyu:chair[facing=east]', 'zeta:door', 'oak_sign[value=property:only]',
]);
const makeModel = (overrides = {}) => ({
  size: [7, 1, 1], palette, cells: Int32Array.of(2, 1, 4, 1, 3, 5, 6),
  meta: { compound: { RequiredMods: { int: 42 }, Name: { string: 'Test house' } } },
  ...overrides,
});
const required = ['alpha', 'xiaojingyu', 'zeta'];

test('requirements use only referenced state IDs; the associated instance determines what is missing', () => {
  const model = makeModel();
  const ids = new Set(['zeta', 'unrelated']);
  assert.deepEqual(getModDependencies(model), { required, missing: ['alpha', 'zeta'] });
  assert.deepEqual(getModDependencies(model, ids), { required, missing: ['alpha'] });
  assert.deepEqual(getModDependencies(model, ['alpha', 'zeta', 'alpha']), { required, missing: [] });
  assert.deepEqual(getModDependencies(model, ['Alpha']), { required, missing: ['alpha', 'zeta'] });
  assert.deepEqual([...ids], ['zeta', 'unrelated']);
  assert.deepEqual([...model.cells], [2, 1, 4, 1, 3, 5, 6]);
  assert.deepEqual(model.meta.compound.RequiredMods, { int: 42 });
});

test('only vanilla and the built-in mod are available by default; metadata is never consulted', () => {
  const model = { palette, cells: [2, 6], get meta() { assert.fail('informational metadata was read'); } };
  assert.deepEqual(getModDependencies(model), { required: [], missing: [] });
  assert.deepEqual(getModDependencies({ palette, cells: [4] }), { required: ['xiaojingyu'], missing: [] });
  const unusual = { palette: [':block', 'Abc:block', 'abc:block', 'stone[x=mod:value]'], cells: [3, 2, 1, 0] };
  assert.deepEqual(getModDependencies(unusual).required, S.requiredMods(unusual.palette));
});

test('reading a foreign schematic preserves metadata but drops unused palette entries', async () => {
  const root = S.toNbt(makeModel());
  const sc = root.compound.Schematic.compound;
  sc.Blocks.compound.Palette.compound['unused:stair'] = { int: 100 };
  sc.Metadata.compound.RequiredMods = { list: [{ string: 'false_hint' }] };
  const model = await S.read(await N.gzip(N.write(root)));
  assert.deepEqual(model.warnings, ['unused_palette']);
  assert.deepEqual(model.meta.compound.RequiredMods, { list: [{ string: 'false_hint' }] });
  assert.ok(!model.palette.includes('unused:stair'));
  assert.deepEqual(getModDependencies(model), { required, missing: ['alpha', 'zeta'] });
});

test('PNG and schem writers replace stale metadata using the same used states without changing schema', async () => {
  const model = makeModel();
  const schem = await S.writeSchem(model);
  const png = await S.writePng(model);
  assert.deepEqual(S.extract(png), schem);
  for (const bytes of [schem, png]) {
    const back = await S.read(bytes);
    assert.equal(back.meta.compound.Name.string, 'Test house');
    assert.deepEqual(back.meta.compound.RequiredMods, { list: required.map((string) => ({ string })) });
    assert.deepEqual(back.palette, [palette[2], palette[1], palette[4], palette[3], palette[5], palette[6]]);
    assert.deepEqual([...back.cells], [0, 1, 2, 1, 3, 4, 5]);
    assert.deepEqual(getModDependencies(back, ['alpha']), { required, missing: ['zeta'] });
    const dump = S.dump(back);
    assert.throws(() => S.fromDump({ ...dump, requiredMods: required }), { code: 'bad_dump' });
  }
  assert.deepEqual(model.meta.compound.RequiredMods, { int: 42 });
  await assert.rejects(S.writeSchem(makeModel({ cells: [0, 1, 2, 3, 4, 5, 99] })), { code: 'bad_schematic' });
});

test('writing vanilla-only data removes stale RequiredMods and does not invent absent Metadata', async () => {
  const vanilla = makeModel({ size: [2, 1, 1], cells: [2, 6] });
  const back = await S.read(await S.writeSchem(vanilla));
  assert.equal(back.meta.compound.RequiredMods, undefined);
  assert.equal(back.meta.compound.Name.string, 'Test house');
  const noMetadata = await S.read(await S.writePng(makeModel({ meta: null })));
  assert.equal(noMetadata.meta, null);
  assert.deepEqual(getModDependencies(noMetadata), { required, missing: ['alpha', 'zeta'] });
});
