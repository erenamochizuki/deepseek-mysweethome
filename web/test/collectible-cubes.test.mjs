import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const { build } = loadV3(['31-collectible-abalone', '31-collectible-cubes']).V3.collectibleCubes;
const ids = ['sea_urchin_test', 'rainbow_abalone'];
const normals = { down: [1, -1], up: [1, 1], north: [2, -1], south: [2, 1], west: [0, -1], east: [0, 1] };
const inside = ({ from, to }, p) => p.every((value, i) => from[i] < value && value < to[i]);
const solid = ({ elements }, ...p) => elements.some(e => inside(e, p));
const pixel = ({ rgba, width }, x, y) => rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4);
const pow2 = n => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

function topPixel(model, x, z) {
  const top = model.elements.filter(({ from, to, faces }) => faces.up && from[0] <= x && x < to[0] && from[2] <= z && z < to[2])
    .sort((a, b) => b.to[1] - a.to[1])[0];
  if (!top) return null;
  const [u0, v0, u1, v1] = top.faces.up;
  const u = u0 + Math.floor((x - top.from[0]) * (u1 - u0) / (top.to[0] - top.from[0]));
  const v = v0 + Math.floor((z - top.from[2]) * (v1 - v0) / (top.to[2] - top.from[2]));
  return pixel(model, u, v);
}

test('deterministic compact Minecraft model specs with bounded, opaque, disjoint UV charts', () => {
  assert.throws(() => build('constructor'), /unknown id/);
  for (const id of ids) {
    const m = build(id), { elements, width, height, rgba } = m;
    assert.deepEqual(build(id), m, id);
    assert(elements.length >= 8 && elements.length <= 64, id);
    assert(pow2(width) && pow2(height) && rgba instanceof Uint8Array && rgba.length === 4 * width * height, id);
    assert.equal(Math.min(...elements.map(e => e.from[1])), 0, id);
    assert(Math.max(...elements.map(e => e.to[1])) < 6, id);

    const used = new Set();
    for (const [i, el] of elements.entries()) {
      assert.equal(el.from.length, 3);
      assert.equal(el.to.length, 3);
      for (let axis = 0; axis < 3; axis++) {
        assert(Number.isInteger(4 * el.from[axis]) && Number.isInteger(4 * el.to[axis]));
        assert(0 <= el.from[axis] && el.from[axis] < el.to[axis] && el.to[axis] <= 16, id);
      }
      for (const other of elements.slice(i + 1)) {
        assert(el.from.some((from, axis) => from >= other.to[axis] || el.to[axis] <= other.from[axis]), `${id}: no overlapping solids`);
      }
      for (const [name, [x0, y0, x1, y1]] of Object.entries(el.faces)) {
        assert(Object.hasOwn(normals, name));
        assert([x0, y0, x1, y1].every(Number.isInteger));
        assert(0 < x0 && x0 < x1 && x1 < width && 0 < y0 && y0 < y1 && y1 < height, id);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const at = y * width + x;
          assert(!used.has(at), `${id}: overlapping UV charts`);
          used.add(at);
          assert.equal(pixel(m, x, y)[3], 255, id);
        }
        assert.deepEqual(pixel(m, x0 - 1, y0), pixel(m, x0, y0), `${id}: gutter colour`);
      }
      for (const [name, [axis, sign]] of Object.entries(normals)) {
        const [u, v] = [0, 1, 2].filter(i => i !== axis);
        const p = [0, 0, 0];
        p[axis] = (sign < 0 ? el.from : el.to)[axis] + sign * .125;
        let exposed = false;
        for (p[u] = el.from[u] + .125; p[u] < el.to[u]; p[u] += .25) {
          for (p[v] = el.from[v] + .125; p[v] < el.to[v]; p[v] += .25) exposed ||= !solid(m, ...p);
        }
        assert.equal(Object.hasOwn(el.faces, name), exposed, `${id}: element ${i} ${name} is included iff exposed`);
      }
    }
  }
});

test('urchin has a true central aperture with five pink bands and paired dark pores', () => {
  const m = build('sea_urchin_test');
  for (const x of [7.375, 8, 8.625]) for (const z of [6.625, 8, 9.375]) {
    for (let y = .125; y < 5.25; y += .25) assert(!solid(m, x, y, z), 'aperture is open from top to underside');
    assert.equal(topPixel(m, x, z), null);
  }
  assert(solid(m, 5.5, 4.625, 8));
  assert(topPixel(m, 6.625, 6.625), 'the crown clips the aperture corners');
  assert(solid(m, 1.5, 1, 8) && !solid(m, 1.5, 3, 8));
  assert(!solid(m, 2.5, 1, 2.5));
  const pink = ([r, g, b]) => r > g + 10 && b > g + 5;
  const darkPore = ([r, g, b]) => r > 104 && r < 159 && g < 107 && b > g + 15;
  const tau = Math.PI * 2;
  const at = (a, r) => topPixel(m, 8 + r * Math.cos(a), 8 + r * Math.sin(a));
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + tau * i / 5;
    assert([2.75, 3.25, 3.75, 4.25].every(r => pink(at(a, r))), `pink arm ${i}`);
    assert([2.75, 3.25, 3.75, 4.25].every(r => !pink(at(a + tau / 10, r))), `sage interval ${i}`);
    for (const side of [-1, 1]) {
      let pores = 0;
      for (let r = 2.75; r < 5.5; r += .125) {
        if (darkPore(at(a + side * .13, r))) pores++;
      }
      assert(pores >= 2, `multiple pore marks on arm ${i}, side ${side}`);
    }
  }
});

test('abalone has an asymmetric terraced dish, four through-pores, and nacre colour bands', () => {
  const m = build('rainbow_abalone');
  assert(solid(m, 7, .75, 7.5));
  for (let y = 1.375; y < 3.75; y += .25) assert(!solid(m, 7, y, 7.5), 'bowl is open above its floor');
  const pores = [[4.25, 5, 4, 4.75], [6.5, 7.5, 3.5, 4.25], [8.75, 9.75, 3, 4], [11, 12, 3.25, 4]];
  for (const [x0,x1,z0,z1] of pores) {
    const x = (x0+x1)/2, z = (z0+z1)/2;
    for (let y = .125; y < 3.75; y += .25) assert(!solid(m, x, y, z), 'hole is cut through the lip');
    assert.equal(topPixel(m, x, z), null);
    for (const [u,v] of [[x0-.125,z], [x1+.125,z], [x,z0-.125], [x,z1+.125]]) {
      assert(solid(m, u, 2.625, v), 'each hole is enclosed by the raised lip');
    }
  }
  assert(solid(m, 2, 2.625, 9) && !solid(m, 14.625, 2.625, 10.75));
  assert(solid(m, 6.25, 2.625, 12.375) && !solid(m, 6.25, 3.125, 12.375));

  const top = [];
  for (let x = 3.125; x < 12.5; x += .25) for (let z = 4.125; z < 10.5; z += .25) {
    const p = topPixel(m, x, z); if (p) top.push(p);
  }
  assert(top.filter(([r, g, b]) => r > 213 && r > g + 24 && b > g + 9).length > 10, 'pink nacre');
  assert(top.filter(([r, g, b]) => b > r + 20 && b > g + 20).length > 10, 'blue nacre');
  assert(top.filter(([r, g, b]) => g > r + 35 && b > r + 25).length > 10, 'turquoise nacre');
  const [r, g, b] = topPixel(m, 10.25, 2.75);
  assert(r > g && g > b, 'warm cut rim contrasts with the cool basin');
});
