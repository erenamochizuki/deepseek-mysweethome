// A3 (P2) hover-outline repairs (08-hover-outline.js), real module + vendored three, with a recording stand-in for the
// WebGL renderer (the module only talks to the renderer through the calls below; no GL is needed to drive it):
//  - a mask material is released when its source material is disposed, borrowed maps are never disposed, and the
//    global teardown takes the module's listeners off the sources that are still alive;
//  - an active outline reuses its per-frame scratch (saved viewport / scissor vectors, multi-material mask arrays)
//    and still restores the scene and the renderer exactly, also when the mask pass throws.
// Pixels are covered by test/hover-outline.test.mjs --browser (needs the built page and a browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

function setup() {
  const { V3, window } = loadV3(['08-hover-outline.js'], { three: 'real' }), T = window.THREE;
  const viewport = new T.Vector4(0, 0, 64, 48), scissor = new T.Vector4(1, 2, 30, 20), clear = new T.Color(0x223344);
  const r = {
    autoClear: true, toneMapping: T.ACESFilmicToneMapping, shadowMap: { autoUpdate: true }, info: { autoReset: true },
    target: null, sceneTarget: null, clearAlpha: 0.75, scissorTest: true, onMask: null, fail: null,
    seen: { viewport: [], scissor: [], passes: [] },
    getDrawingBufferSize: (v) => v.set(64, 48), getPixelRatio: () => 1,
    getRenderTarget: () => r.target, setRenderTarget: (t) => { r.target = t; },
    getClearAlpha: () => r.clearAlpha, getClearColor: (c) => c.copy(clear), setClearColor: (c, a) => { clear.set(c); r.clearAlpha = a; },
    getViewport: (v) => { r.seen.viewport.push(v); return v.copy(viewport); }, setViewport: (v) => { viewport.copy(v); },
    getScissor: (v) => { r.seen.scissor.push(v); return v.copy(scissor); }, setScissor: (v) => { scissor.copy(v); },
    getScissorTest: () => r.scissorTest, setScissorTest: (b) => { r.scissorTest = b; },
    clear() {},
    render(scene, camera) {
      const mask = !!(r.target && r.target.isWebGLRenderTarget);     // the outline's own target; the composite goes back to the caller's (null here)
      r.seen.passes.push(mask ? 'mask' : 'composite');
      if (mask) { if (!r.sceneTarget) r.sceneTarget = r.target; if (r.fail) throw new Error(r.fail); if (r.onMask && r.target === r.sceneTarget) r.onMask(scene, camera); }
    },
  };
  const state = () => ({ target: r.target, autoClear: r.autoClear, tone: r.toneMapping, shadow: r.shadowMap.autoUpdate, autoReset: r.info.autoReset,
    clear: clear.getHex(), alpha: r.clearAlpha, scissorTest: r.scissorTest, viewport: viewport.toArray(), scissor: scissor.toArray() });
  const disposed = new Map();
  const watch = (o) => { if (!disposed.has(o)) { disposed.set(o, 0); o.addEventListener('dispose', () => disposed.set(o, disposed.get(o) + 1)); } return o; };
  const listeners = (o) => ((o._listeners && o._listeners.dispose) || []).length;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera();
  const frame = () => { const before = state(); V3.hoverOutline.render(r, scene, camera); assert.deepEqual(state(), before, 'renderer state restored'); };
  return { V3, T, H: V3.hoverOutline, r, scene, camera, state, frame, watch, count: (o) => disposed.get(o), listeners };
}
const texture = (T) => { const t = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; };

test('a mask material is released with its source material; the borrowed map is not disposed', () => {
  const { T, H, r, scene, frame, watch, count, listeners } = setup();
  const tex = watch(texture(T));
  const a = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial({ map: tex, alphaTest: 0.5 }));
  const b = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  scene.add(a, b);
  const srcA = a.material, srcB = b.material, masks = [];
  r.onMask = () => masks.push([a.material, b.material]);
  H.set([a]);
  frame();
  assert.equal(H.stats.passes, 3); assert.equal(H.stats.meshes, 1);
  assert.deepEqual(r.seen.passes, ['mask', 'mask', 'composite']);
  assert.equal(a.material, srcA); assert.equal(b.material, srcB);
  const [maskA, maskB] = masks[0];
  assert.ok(maskA.isMeshBasicMaterial && maskA !== srcA && maskB !== srcB && maskA !== maskB);
  assert.equal(maskA.map, tex, 'the mask borrows the source map (alpha cut-outs)');
  watch(maskA); watch(maskB);
  frame();
  assert.deepEqual(masks[1], [maskA, maskB], 'a live source keeps its mask between frames');

  srcA.dispose();                                                     // the owner drops the photo / texture variant
  assert.equal(count(maskA), 1, 'mask of a disposed source is disposed right away');
  assert.equal(maskA.map, null, 'and no longer holds the texture');
  assert.equal(count(tex), 0, 'the borrowed map is never disposed by the outline');
  assert.equal(count(maskB), 0, 'other sources are untouched');
  assert.equal(listeners(srcA), 0, 'the listener is gone with the mask');

  frame();                                                            // a disposed three material may be used again
  const maskA2 = watch(masks[2][0]);
  assert.notEqual(maskA2, maskA); assert.equal(maskA2.map, tex);
  assert.equal(masks[2][1], maskB);
  assert.equal(listeners(srcA), 1); assert.equal(listeners(srcB), 1);

  H.dispose();                                                        // model change
  assert.deepEqual([count(maskA), count(maskA2), count(maskB), count(tex)], [1, 1, 1, 0]);
  assert.equal(maskA2.map, null);
  assert.equal(listeners(srcA), 0, 'teardown takes the outline listener off live sources');
  assert.equal(listeners(srcB), 0);
  srcA.dispose(); srcB.dispose();                                     // late disposal after teardown: nothing left to do
  assert.deepEqual([count(maskA), count(maskA2), count(maskB), count(tex)], [1, 1, 1, 0]);
});

test('unique photos / variants do not pile up mask materials until the next model change', () => {
  const { T, H, r, scene, frame, watch, count } = setup();
  const a = new T.Mesh(new T.PlaneGeometry(), null);
  scene.add(a);
  const masks = [], textures = [];
  r.onMask = () => masks.push(watch(a.material));
  H.set([a]);
  for (let i = 0; i < 12; i++) {
    const tex = watch(texture(T)); textures.push(tex);
    a.material = new T.MeshStandardMaterial({ map: tex });
    frame();
    assert.equal(masks.length, i + 1);
    a.material.dispose(); tex.dispose();                              // what 55-photo-frames does with an unused photo
    assert.equal(count(masks[i]), 1, 'mask ' + i + ' released with its photo material');
    assert.equal(masks[i].map, null, 'mask ' + i + ' does not keep the disposed texture alive');
  }
  assert.equal(new Set(masks).size, 12);
  H.dispose();
  assert.ok(masks.every((m) => count(m) === 1), 'nothing is disposed twice at teardown');
  assert.ok(textures.every((t) => count(t) === 1), 'only the owner disposed the textures');
});

test('an active outline reuses its scratch and restores the scene exactly', () => {
  const { T, H, r, scene, frame, state } = setup();
  const x = new T.MeshBasicMaterial(), y = new T.MeshBasicMaterial({ transparent: true, opacity: 0.5 });
  const multi = new T.Mesh(new T.BoxGeometry(), [x, y]);
  const sparse = new T.Mesh(new T.BoxGeometry(), [x, , y]);          // eslint-disable-line no-sparse-arrays
  const group = new T.Group(); group.add(multi);
  const line = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial());
  const hidden = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()); hidden.visible = false;
  const copy = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()); copy.userData.hoverOutlineOnly = true;   // detached outline-only copy
  scene.add(group, sparse, line, hidden);
  const original = { multi: multi.material, sparse: sparse.material, line: line.material, hidden: hidden.material, copy: copy.material };
  const seen = [];
  r.onMask = () => seen.push({ multi: multi.material, items: multi.material.slice(), sparse: sparse.material, hole: !(1 in sparse.material),
    line: line.visible, hidden: hidden.visible, copyInScene: copy.parent === scene, copyMask: copy.material });
  const intact = () => {
    assert.equal(multi.material, original.multi); assert.deepEqual(multi.material, [x, y]);
    assert.equal(sparse.material, original.sparse); assert.equal(sparse.material.length, 3); assert.ok(!(1 in sparse.material));
    assert.equal(line.material, original.line); assert.equal(line.visible, true);
    assert.equal(hidden.material, original.hidden); assert.equal(hidden.visible, false);
    assert.equal(copy.material, original.copy); assert.equal(copy.parent, null, 'outline-only copy never stays in the scene');
  };
  const list = [group, group, null, copy];
  H.set(list); list.length = 0;                                       // duplicates and blanks dropped, caller's array not kept
  for (let i = 0; i < 3; i++) { frame(); intact(); }
  assert.equal(H.stats.meshes, 2);
  assert.equal(seen.length, 3);
  for (const s of seen) {
    assert.ok(Array.isArray(s.multi) && s.multi !== original.multi && s.items.length === 2);
    assert.ok(s.items.every((m) => m.isMeshBasicMaterial && m !== x && m !== y), 'every entry of a multi-material is masked');
    assert.equal(s.items[1].visible, true, 'selected transparent material still writes the mask');
    assert.ok(s.hole && s.sparse.length === 3, 'holes in a material array stay holes');
    assert.equal(s.line, false, 'lines are hidden during the mask pass');
    assert.equal(s.hidden, false);
    assert.ok(!s.copyInScene && s.copyMask !== original.copy, 'detached copies do not compete in scene depth');
  }
  assert.deepEqual(seen[1].items, seen[0].items, 'same mask materials every frame');
  // Fewer per-frame allocations: the same scratch objects are handed out frame after frame …
  assert.equal(seen[1].multi, seen[0].multi, 'mask array of a multi-material mesh is reused');
  assert.equal(seen[2].multi, seen[0].multi);
  assert.equal(new Set(r.seen.viewport).size, 1, 'saved viewport vector is reused');
  assert.equal(new Set(r.seen.scissor).size, 1, 'saved scissor vector is reused');
  // … and they do not keep scene materials alive between frames.
  assert.ok(seen[0].multi.every((m) => m == null), 'the reused mask array is emptied after the frame');

  // The mask pass fails: everything is put back, and the next frame works as before.
  const before = state();
  r.fail = 'intentional-mask-failure';
  assert.throws(() => H.render(r, scene, new T.PerspectiveCamera()), /intentional-mask-failure/);
  assert.deepEqual(state(), before); intact();
  r.fail = null;
  frame(); intact();
  assert.equal(seen.length, 4); assert.equal(H.stats.passes, 3);
  assert.equal(seen[3].multi, seen[0].multi);

  // Target gone: no passes, nothing touched.
  const passes = r.seen.passes.length;
  H.clear(); frame(); intact();
  assert.equal(r.seen.passes.length, passes); assert.equal(H.stats.passes, 0);
  H.set(null); frame();
  assert.equal(r.seen.passes.length, passes);
  H.dispose();
});
