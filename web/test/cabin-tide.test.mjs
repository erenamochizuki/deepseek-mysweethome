import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const V3 = {};
vm.runInNewContext(readFileSync(new URL('../src/59-cabin-tide.js', import.meta.url), 'utf8'), { window: { V3 } });
const tide = V3.cabinTide;
const kinds = [{ id: 'ordinary', rarity: 'common' }, { id: 'green', rarity: 'common', weather: ['clear'] }, { id: 'abalone', rarity: 'rare', weather: ['storm'] }];
const trash = [{ id: 'litter', rarity: 'common', weather: ['storm'] }];
const settings = { wCommon: 70, wUncommon: 25, wRare: 5 };
const draw = (wx, values, allowTrash = false, s = settings) => tide.pick({ wx, kinds, trash, settings: s, allowTrash, random: () => values.shift() ?? 0 }).id;
test('weather affects wave and tier rates; baseline is neutral and configurable', () => {
  assert.equal(tide.chance(.5, 'baseline'), .5);
  assert.ok(tide.chance(.5, 'storm') > tide.chance(.5, 'clear'));
  assert.equal(tide.chance(1, 'storm'), 1);
  assert.equal(tide.chance(0, 'storm'), 0);
  assert.equal(draw('clear', [.91, .1]), 'ordinary');
  assert.equal(draw('storm', [.91, .1]), 'abalone');
  assert.equal(draw('storm', [.99, .1], false, { ...settings, wRare: 0 }), 'ordinary');
});
test('weather favors items without making them exclusive; litter is separate and optional', () => {
  assert.equal(draw('clear', [.1, .4]), 'green');
  assert.equal(draw('baseline', [.1, .4]), 'ordinary');
  assert.equal(draw('baseline', [.1, .9]), 'green');
  assert.equal(draw('storm', [.15, 0], true), 'litter');
  assert.notEqual(draw('clear', [.15, 0], true), 'litter');
  assert.notEqual(draw('storm', [.01, 0], false), 'litter');
});
