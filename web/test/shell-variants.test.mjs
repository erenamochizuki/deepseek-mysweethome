// 贝壳花纹（30-shell-variants）：每一种 × 每一个花纹都建得出来；只换颜色，形状不变；按（几何, 花纹）缓存。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

test('every kind builds in every pattern, sharing positions and only recolouring', () => {
  const { V3 } = loadV3(['03-vox', '30-shell-kit', '30-shell-m1', '30-shell-m2', '30-shell-variants', '30-shells', '31-moon-treasures', '31-washup-catalog', '58-inventory-rules'], { three: 'real' });
  const R = V3.inventoryRules, ids = [...V3.shells.KINDS, ...V3.washupCatalog.collectibles].map((k) => k.id);
  assert.deepEqual(R.PATTERNS.map((p) => p.id).filter((p) => p !== 'plain').sort(), V3.shellVariants.ids.slice().sort(), 'every rule pattern has a painter');
  assert.equal(ids.length, 65);
  const meshOf = (o) => { let m = null; o.traverse((x) => { if (x.isMesh && !m) m = x; }); return m; };
  for (const id of ids) {
    const plain = meshOf(V3.shells.build(id, { tag: false })).geometry;
    const cols = new Set();
    for (const p of R.PATTERNS) {
      const g = meshOf(V3.shells.build(id, { tag: false, pat: p.id })).geometry;
      if (p.id === 'plain') { assert.equal(g, plain); continue; }
      assert.notEqual(g, plain, id + ' ' + p.id);
      assert.equal(g.getAttribute('position'), plain.getAttribute('position'), 'shape shared');
      assert.equal(g.userData.shared, true);
      assert.equal(meshOf(V3.shells.build(id, { tag: false, pat: p.id })).geometry, g, 'cached per pattern');
      const c = g.getAttribute('color').array;
      assert.ok(c.every(Number.isFinite));
      cols.add(Array.from(c.slice(0, 600)).map((v) => v.toFixed(3)).join());
    }
    cols.add(Array.from(plain.getAttribute('color').array.slice(0, 600)).map((v) => v.toFixed(3)).join());
    assert.ok(cols.size >= 5, id + ': patterns actually look different (' + cols.size + ')');
  }
});
