// 角色模型「连成一体」（2026-11-14，用户的要求 1：方块接缝之间有互相干涉的条纹）。29-ysm 的 soften / smoothNormals / centroidUv：
//   ① 共面又互相盖着的方块按级往外胀一点（不再深度打架）；② 贴图坐标往面里收一点 + centroid 插值（棱上不再漏出隔壁那一格的颜色）；
//   ③ 显示着的方块按附近朝向差不多的面平均法线（明暗连成一片）。{ soft: false } / 网址 ysmsoft=0 关掉，和以前逐位一样。
//   2026-11-15 补：脸上那层「贴图纸片」（眼睛 / 眼睑 / 睫毛 / 眉毛 / 嘴和牙齿 / 腮红胡须眼泪）不参加
//   ①「按级往外胀」—— 用户反馈眼睛左上角和外圈那条深色边一直在闪，随后嘴也发现同样的问题：胀过之后层次反了，
//   高光被眼睑盖掉、嘴的边被相邻嘴型压出锯齿，剩下的面只差零点几毫米，跟随镜头 9 米远时深度精度不够。
//   现在这些方块保持作者原样（深度逐位相同 → 绘制顺序稳定），②③ 照做。
//   node --test test/ysm-soften.test.mjs            （设 YSM_WINTER_ZIP=<冬装 zip> 时冬装也测）
//   YSM_SRC_DIR=<改动前的 src>：前几项在旧代码上应当失败
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = process.env.YSM_SRC_DIR ? { srcDir: process.env.YSM_SRC_DIR } : {};
const MODELS = [['蓝色大肥鱼', fs.readFileSync(path.join(HERE, '..', 'assets', 'girl', 'fatfish-1.2.zip'))]];
if (process.env.YSM_WINTER_ZIP) MODELS.push(['蓝色大肥鱼(冬装)', fs.readFileSync(process.env.YSM_WINTER_ZIP)]);
const ORIG = path.resolve(HERE, '..', '..', '_work', 'v5', 'src-orig');   // 改动前的源码（有就拿来对照 soft: false）

async function load(bytes, opts = {}) {
  const h = loadV3(['10-zip', '11-molang', '29-ysm'], { three: 'real', ...opts });
  const model = h.V3.ysm.load(await h.V3.zip.read(new Uint8Array(bytes)));
  model.textures = [];
  return { V: h.V3, model };
}
const PX = 1 / 16;

for (const [name, bytes] of MODELS) {
  test(name + ': coplanar fights found and resolved by at most 4 tiny steps; nothing moves more than 0.1 px', async () => {
    const { V, model } = await load(bytes, src);
    const soft = V.ysm.build(model, { height: 1.25 }), raw = V.ysm.build(model, { height: 1.25, soft: false });
    const S = soft.rig.soft;
    assert.ok(S, 'rig.soft is there');
    assert.ok(S.coplanar > 1000 && S.lifted > 100, 'it found the fighting faces: ' + JSON.stringify(S));
    assert.ok(S.levels >= 1 && S.levels <= 4);
    assert.equal(raw.rig.soft, null);
    const P = soft.rig.geometry.attributes.position.array, P0 = raw.rig.geometry.attributes.position.array;
    assert.equal(P.length, P0.length);
    let max = 0, moved = 0;
    for (let i = 0; i < P.length; i += 3) { const d = Math.hypot(P[i] - P0[i], P[i + 1] - P0[i + 1], P[i + 2] - P0[i + 2]); if (d > max) max = d; if (d > 1e-7) moved++; }
    assert.ok(max < 0.1 * PX, 'max vertex move ' + (max / PX).toFixed(3) + ' px');
    assert.ok(moved > 1000, 'vertices moved: ' + moved);
    soft.dispose(); raw.dispose();
  });

  test(name + ': face paper layers (eye / eyelid / brow / mouth / teeth / face extras) are never lifted', async () => {
    const { V, model } = await load(bytes, src);
    const soft = V.ysm.build(model, { height: 1.25 }), raw = V.ysm.build(model, { height: 1.25, soft: false });
    const P = soft.rig.geometry.attributes.position.array, P0 = raw.rig.geometry.attributes.position.array;
    const SI = soft.rig.geometry.attributes.skinIndex.array, bones = soft.rig.list;
    const FACE = /eye|pupil|iris|lid|lash|brow|mouth|tooth|teeth|tongue|lip|smile|cry|sulk|extraface|tear|whisker|shy|cheek|question|瞳|眼|睫|眉|嘴|牙|舌|唇|泪|腮|须/i;
    let verts = 0, moved = 0, worst = 0;
    for (let v = 0; v < P.length / 3; v++) {
      let face = false;
      for (let b = bones[SI[v * 4]], k = 0; b && b.isBone && k < 32; b = b.parent, k++) if (FACE.test(b.name)) { face = true; break; }
      if (!face) continue;
      verts++;
      const o = v * 3, d = Math.hypot(P[o] - P0[o], P[o + 1] - P0[o + 1], P[o + 2] - P0[o + 2]);
      if (d > 1e-7) moved++;
      if (d > worst) worst = d;
    }
    assert.ok(verts > 2000, 'found the face-layer vertices: ' + verts);
    assert.equal(moved, 0, 'face-layer vertices moved: ' + moved + ' (worst ' + (worst / PX).toFixed(4) + ' px)');
    assert.ok(soft.rig.soft.coplanar > 1000, 'the rest of the model still gets the seam fix: ' + JSON.stringify(soft.rig.soft));
    soft.dispose(); raw.dispose();
  });

  test(name + ': texture corners pulled into their own texel rectangle; materials sample the texture with centroid interpolation', async () => {
    const { V, model } = await load(bytes, src);
    const soft = V.ysm.build(model, { height: 1.25 }), raw = V.ysm.build(model, { height: 1.25, soft: false });
    const U = soft.rig.geometry.attributes.uv.array, U0 = raw.rig.geometry.attributes.uv.array;
    let inside = 0, quads = U.length / 8;
    for (let q = 0; q < quads; q++) {
      const o = q * 8, xs = [0, 2, 4, 6].map(k => U0[o + k]), ys = [1, 3, 5, 7].map(k => U0[o + k]);
      const lo = [Math.min(...xs), Math.min(...ys)], hi = [Math.max(...xs), Math.max(...ys)];
      let ok = true;
      for (let k = 0; k < 4; k++) {
        const u = U[o + 2 * k], v = U[o + 2 * k + 1];
        if (u <= lo[0] - 1e-9 || u >= hi[0] + 1e-9 || v <= lo[1] - 1e-9 || v >= hi[1] + 1e-9) ok = false;
        if (Math.abs(u - U0[o + 2 * k]) < 1e-9 && hi[0] > lo[0]) ok = false;       // 真的往里收了
      }
      if (ok) inside++;
    }
    assert.ok(inside / quads > 0.99, 'pulled in: ' + inside + ' / ' + quads);
    const mat = Array.isArray(soft.mesh.material) ? soft.mesh.material[0] : soft.mesh.material;
    assert.equal(mat.customProgramCacheKey(), 'ysm-centroid-uv');
    // 着色器真的改成 centroid：拿 three 自己的 uv 片段试一下
    const sh = { vertexShader: '#include <uv_pars_vertex>', fragmentShader: '#include <uv_pars_fragment>' };
    mat.onBeforeCompile(sh, { capabilities: { isWebGL2: true } });
    assert.match(sh.vertexShader, /centroid varying vec2 vMapUv;/);
    assert.match(sh.fragmentShader, /centroid varying vec2 vMapUv;/);
    const sh1 = { vertexShader: '#include <uv_pars_vertex>', fragmentShader: '#include <uv_pars_fragment>' };
    mat.onBeforeCompile(sh1, { capabilities: { isWebGL2: false } });
    assert.equal(sh1.vertexShader, '#include <uv_pars_vertex>', 'WebGL1: left alone (no centroid there)');
    soft.dispose(); raw.dispose();
  });

  test(name + ': normals smoothed only across shown cubes, unit length, at most ~30° off; hidden cubes keep their flat normals', async () => {
    const { V, model } = await load(bytes, src);
    const soft = V.ysm.build(model, { height: 1.25 }), raw = V.ysm.build(model, { height: 1.25, soft: false });
    const N = soft.rig.geometry.attributes.normal.array, N0 = raw.rig.geometry.attributes.normal.array, SI = soft.rig.geometry.attributes.skinIndex.array;
    const info = soft.rig.soft.normals;
    assert.ok(info && info.quads > 1000 && info.quads < N.length / 12, 'only the shown quads take part: ' + JSON.stringify(info));
    let changed = 0, worst = 0;
    const tiny = b => Math.min(Math.abs(b.scale.x), Math.abs(b.scale.y), Math.abs(b.scale.z)) < 0.01;
    const hidden = soft.rig.list.map(b => { for (let o = b; o && o.isBone; o = o.parent) if (tiny(o)) return true; return false; });
    for (let i = 0; i < N.length; i += 3) {
      const l = Math.hypot(N[i], N[i + 1], N[i + 2]);
      assert.ok(Math.abs(l - 1) < 1e-4, 'unit normal');
      const dot = N[i] * N0[i] + N[i + 1] * N0[i + 1] + N[i + 2] * N0[i + 2];
      worst = Math.max(worst, Math.acos(Math.min(1, dot)) * 180 / Math.PI);
      if (dot < 0.9999) { changed++; assert.ok(!hidden[SI[(i / 3) * 4]], 'a hidden cube keeps its normal'); }
    }
    assert.ok(changed > 5000, 'normals smoothed: ' + changed);
    assert.ok(worst < 35, 'at most ' + worst.toFixed(1) + '°');
    soft.dispose(); raw.dispose();
  });
}

test('soft: false builds exactly the geometry of the code before this change', { skip: !fs.existsSync(path.join(ORIG, '29-ysm.js')) && 'no _work/v5/src-orig' }, async () => {
  const [, bytes] = MODELS[0];
  const now = await load(bytes, src), old = await load(bytes, { srcDir: ORIG });
  const a = now.V.ysm.build(now.model, { height: 1.25, soft: false }), b = old.V.ysm.build(old.model, { height: 1.25 });
  for (const k of ['position', 'normal', 'uv', 'skinIndex']) {
    const A = a.rig.geometry.attributes[k].array, B = b.rig.geometry.attributes[k].array;
    assert.equal(A.length, B.length, k);
    for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) assert.fail(k + '[' + i + '] differs: ' + A[i] + ' vs ' + B[i]);
  }
  a.dispose(); b.dispose();
});
