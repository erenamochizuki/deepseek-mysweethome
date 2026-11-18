// Sculpted collectibles can land any side up on the beach:
// every edge must be shared by exactly two triangles walking it in opposite directions (closed, consistently wound).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

test('urchin, abalone and the fluted giant clam are closed, consistently wound meshes', () => {
  const { V3 } = loadV3(['03-vox', '15-mcmodel', '31-collectible-abalone', '31-collectible-cubes', '31-collectible-render', '31-washup-catalog'], { three: 'real' });
  for (const id of ['sea_urchin_test', 'rainbow_abalone', 'giant_clam']) {
    const p = V3.washupCatalog.build(id, { tag: false }).children[0].geometry.getAttribute('position');
    const key = i => [p.getX(i), p.getY(i), p.getZ(i)].map(x => x.toFixed(5)).join(',');
    const directed = new Map();
    for (let i = 0; i < p.count; i += 3) for (let k = 0; k < 3; k++) {
      const e = key(i + k) + '>' + key(i + (k + 1) % 3);
      directed.set(e, (directed.get(e) || 0) + 1);
    }
    for (const [e, count] of directed) {
      assert.equal(count, 1, id + ' edge walked twice in one direction ' + e);
      const [a, b] = e.split('>');
      assert(directed.has(b + '>' + a), id + ' open edge ' + e);
    }
  }
});
