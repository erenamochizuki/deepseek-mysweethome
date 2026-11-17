// 「她在进行翻几页书的时候会陷到地下去」（2026-11-13，两个模型都会）：
//   翻书用的 tlm:bookshelf 是作者给 TLM 女仆坐在书架前的动画：AllBody 往下挪 18.5 px、两腿向前抬平。我们这里她是站在地板上演，
//   没有座位托着，直接放 → 脚比地板低 0.66 m，整个人陷进地里。现在 65-girl-actor 对不坐、不躺时的底层动画传 { ground: true }，
//   29-ysm 量这个动画摆出来最低的脚比站着低多少，把模型往上抬回来（淡入淡出跟着动画走）。
// 真实模块 + 真实 three + 真实房子和寻路 + 自带的模型；设 YSM_WINTER_ZIP 时冬装版也跑一遍。
//   node --test test/ysm-ground-anim.test.mjs
//   YSM_SRC_DIR=<改动前的 src>：同一批断言在旧代码上应当失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { requireGirlZip } from '../tools/lib/girl-asset.mjs';
requireGirlZip('ysm-ground-anim');   // 第三方模型不进仓库：没有就跳过

const image = await readFile(new URL('../assets/house/house-v4.png', import.meta.url));
const builtin = await readFile(new URL('../assets/girl/fatfish-1.2.zip', import.meta.url));
const src = process.env.YSM_SRC_DIR ? { srcDir: process.env.YSM_SRC_DIR } : {};
const MODELS = [['蓝色大肥鱼', builtin]];
if (process.env.YSM_WINTER_ZIP) MODELS.push(['蓝色大肥鱼(冬装)', fs.readFileSync(process.env.YSM_WINTER_ZIP)]);

async function cabin(t, bytes) {
  const h = loadV3(['03-vox', '10-zip', '11-molang', '12-nbt', '13-share', '15-mcmodel', '29-ysm', '40-layout', '42-house-mc', '44-furn-mc'], { three: 'real', ...src });
  const { V3: V, window } = h, T = window.THREE, parts = new Map();
  window.document = new EventTarget();
  V.scene = { part: p => parts.set(p.id, p) };
  h.load(['54-house-mc', '61-nav', '65-girl-actor']);
  const HB = V.houseBlocks;
  window.__V3_ASSETS = { [V.layout.house.asset]: image.toString('base64') };
  HB.store = { get: async () => null };
  await HB.load();
  const model = V.ysm.load(await V.zip.read(new Uint8Array(bytes)));
  model.textures = [];
  V.girlv1 = { build: () => V.ysm.build(model, { height: 1.25 }) };
  V.bubble = { say() { return true; } };
  const part = parts.get('girl-actor'), scene = new T.Group();
  part.build({ rng: () => () => 0.2 }).forEach(o => scene.add(o));
  V.viewTokens.girl('idle');
  const a = V.actor, inst = a.inst, mesh = inst.mesh;
  // 腿和脚（LeftLeg / RightLeg 以下所有骨骼）的顶点里最低的那个，世界坐标 y
  const P0 = mesh.geometry.attributes.position, SI = mesh.geometry.attributes.skinIndex, legs = new Set(), v = new T.Vector3();
  mesh.skeleton.bones.forEach((b, i) => { for (let o = b; o && o.isBone; o = o.parent) if (/^(Left|Right)(Leg|LowerLeg|Foot|Shoes)/.test(o.name)) { legs.add(i); break; } });
  const feet = () => {
    scene.updateMatrixWorld(true); mesh.skeleton.update();
    let lo = Infinity;
    for (let i = 0; i < P0.count; i++) if (legs.has(SI.getX(i))) { mesh.applyBoneTransform(i, v.fromBufferAttribute(P0, i)); v.applyMatrix4(mesh.matrixWorld); if (v.y < lo) lo = v.y; }
    return lo - a.pos[1];
  };
  t.after(() => { part.dispose(); assert.deepEqual(window.__errors, []); });
  return { a, part, inst, feet };
}

for (const [name, bytes] of MODELS) {
  test(name + ': reading at the bookshelf keeps her feet on the floor', async t => {
    const { a, part, inst, feet } = await cabin(t, bytes);
    a.place(-2.4, -7.5, 0, 1);
    part.update(0.05);
    const standing = feet();
    assert.ok(Math.abs(standing) < 0.03, 'standing: feet on the floor (' + standing.toFixed(3) + ')');
    assert.equal(a.startBehavior('read', { seconds: 4 }), true);
    const reading = [];
    let inAction = 0;
    for (let i = 0; i < 1600 && a.behavior; i++) {
      part.update(0.05);
      if (a.behavior && a.behavior.phase === 'action' && inst.actorAnimation.base === 'tlm:bookshelf' && ++inAction > 6) reading.push(feet());   // 淡入 0.2 s 之后
    }
    assert.ok(reading.length > 40, 'she really read for a while (' + reading.length + ' frames)');
    assert.equal(inst.actorAnimation.base, null, 'and stopped afterwards');
    const lo = Math.min(...reading), hi = Math.max(...reading);
    // 旧代码：-0.663 m（陷进地板）
    assert.ok(lo > -0.05, 'reading: lowest foot ' + lo.toFixed(3) + ' m — must not sink into the floor');
    assert.ok(hi < 0.05, 'reading: lowest foot ' + hi.toFixed(3) + ' m — and must not float either');
    part.update(0.5); part.update(0.5);
    assert.ok(Math.abs(feet() - standing) < 0.03, 'back to standing height after the book');
  });
}

test('the lift only applies to clips played on the ground (seated / lying clips are left alone)', async t => {
  const { inst } = await cabin(t, builtin);
  inst.setActorAnimation('tlm:bookshelf', null, null, { ground: true });
  assert.ok(inst.actorAnimation.lift > 0.5, 'bookshelf on the floor is lifted (' + inst.actorAnimation.lift + ')');
  inst.setActorAnimation('tlm:bookshelf');
  assert.equal(inst.actorAnimation.lift, 0, 'without ground: (seated at a desk) nothing changes');
  inst.setActorAnimation('main:run', null, null, { ground: true });
  assert.equal(inst.actorAnimation.lift, 0, 'running already has her feet on the ground');
  inst.setActorAnimation('main:sit', null, null, { ground: true });
  assert.equal(inst.actorAnimation.lift, 0);
  inst.setActorAnimation();
});
