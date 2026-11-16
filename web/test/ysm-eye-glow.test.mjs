// 眼睛全亮叠层（ysmGlow*）的规则：眼睛默认跟着场景光照，不再只认 'builtin:fatfish' 这一个模型。
//
// 背景：蓝色大肥鱼的眼睛在阴天、夜里发亮的问题以前修过，但修法是给自带模型配了一张骨骼名单
// （29-ysmui 的 FATFISH_TUNE.disableGlowBones），只有 id 是 'builtin:fatfish' 时才生效。
// 同一作者的「蓝色大肥鱼(冬装)」是玩家导入的模型，骨骼名一模一样，却拿不到这张名单，眼睛照旧全亮。
//
// 真实模块 + 真实 three，在 Node 里跑；不开浏览器、不构建。
//   node --test test/ysm-eye-glow.test.mjs
// 冬装版不随源码分发：设 YSM_WINTER_ZIP=<zip 路径> 时再用真文件核对一遍（不设就跳过那一项）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const asset = await readFile(new URL('../assets/girl/fatfish-1.2.zip', import.meta.url));
const EYE_BONES = ['ysmGlowRightEyesBase', 'ysmGlowLeftEyesBase', 'ysmGlowRightEyesBase4', 'ysmGlowLeftEyesBase4',
  'ysmGlowAutoRightEyesBase1', 'ysmGlowAutoLeftEyesBase1', 'ysmGlowAutoRightEyesBase2', 'ysmGlowAutoLeftEyesBase2'];

function env() {
  // YSM_SRC_DIR=<另一份 src 目录>：拿修复前的源码跑同一批断言（应当失败），确认这些测试真的在测这次的改动。
  const h = loadV3(['03-vox', '10-zip', '11-molang', '29-ysm'], { three: 'real', ...(process.env.YSM_SRC_DIR ? { srcDir: process.env.YSM_SRC_DIR } : {}) });
  return { V: h.V3, T: h.window.THREE, window: h.window };
}
async function load(V, bytes) {
  const model = V.ysm.load(await V.zip.read(bytes));
  model.textures = [];                         // no browser image decode in this source-only test
  return model;
}
const glowOf = (inst) => {
  let mesh = null, body = 0;
  inst.root.traverse(o => { if (o.name === 'ysm-glow') mesh = o; if (o.name === 'ysm-body') body = o.geometry.index.count; });
  return { mesh, count: mesh ? mesh.geometry.index.count : 0, visible: mesh ? mesh.visible : false, body };
};

test('eye glow bones are recognised by name or by any ancestor, eyebrows and non-eye glow are not', () => {
  const { V, T } = env();
  const chain = (...names) => { let parent = null, b = null; for (const n of names) { b = new T.Bone(); b.name = n; if (parent) parent.add(b); parent = b; } return b; };
  const is = (...names) => V.ysm.isEyeGlowBone(chain(...names));
  assert.equal(is('Head', 'Eyes', 'RightEyesBase', 'ysmGlowRightEyesBase'), true);
  assert.equal(is('Head', 'LeftEye', 'ysmGlow1'), true, 'generic glow name under an eye bone');
  assert.equal(is('Head', 'Pupil', 'ysmGlowDot'), true);
  assert.equal(is('Head', 'ysmGlowIris'), true);
  assert.equal(is('Head', '左眼', 'ysmGlowA'), true);
  assert.equal(is('Head', 'Halo', 'ysmGlowHalo'), false, 'a halo keeps glowing');
  assert.equal(is('RightArm', 'Lantern', 'ysmGlowLantern'), false);
  assert.equal(is('Head', 'Eyebrow1', 'ysmGlowEyebrow'), false, 'eyebrow is not an eye');
  assert.equal(is('Head', 'Eyelash', 'ysmGlowEyelash'), false);
  assert.equal(is('Head', 'Eyes', 'RightEyesBase'), false, 'only ysmGlow* bones can be glow bones');
  assert.equal(V.ysm.isEyeGlowBone(null), false);
});

test('an imported model (no built-in tune) no longer gets a full-bright eye overlay by default', async () => {
  const { V } = env();
  const model = await load(V, asset);
  // exactly how an imported model is built: no tune at all
  const inst = V.ysm.build(model, { height: 1.26 });
  const g = glowOf(inst);
  assert.equal(inst.canEyeGlow, true, 'the model does have eye glow bones');
  assert.equal(inst.getEyeGlow(), false);
  assert.equal(g.count, 0, 'no eye triangles are drawn full-bright');
  assert.equal(g.visible, false, 'an empty glow layer is not submitted at all');
  assert.ok(g.body > 0);
  inst.dispose();
});

test('eye geometry is untouched: the lit body mesh is identical with or without the overlay', async () => {
  const { V } = env();
  const model = await load(V, asset);
  const off = V.ysm.build(model, { height: 1.26 }), on = V.ysm.build(model, { height: 1.26, eyeGlow: true });
  assert.equal(glowOf(off).body, glowOf(on).body, 'eyes are still part of the lit body either way');
  assert.ok(glowOf(on).count > 0 && glowOf(on).visible, 'opting in restores the author\'s full-bright eyes');
  assert.equal(on.getEyeGlow(), true);
  off.dispose(); on.dispose();
});

test('the setting switches live in both directions without rebuilding the character', async () => {
  const { V } = env();
  const model = await load(V, asset);
  const reference = glowOf(V.ysm.build(model, { height: 1.26, eyeGlow: true })).count;
  const inst = V.ysm.build(model, { height: 1.26 });
  const mesh = glowOf(inst).mesh;
  inst.setEyeGlow(true);
  assert.equal(glowOf(inst).mesh, mesh, 'same mesh object, only its index changes');
  assert.equal(glowOf(inst).count, reference);
  assert.equal(glowOf(inst).visible, true);
  inst.setEyeGlow(true);                       // idempotent
  assert.equal(glowOf(inst).count, reference);
  inst.setEyeGlow(false);
  assert.equal(glowOf(inst).count, 0);
  assert.equal(glowOf(inst).visible, false);
  assert.equal(inst.getEyeGlow(), false);
  inst.dispose();
});

test('the built-in tune still works and stays stricter than the default (explicit names win even when opted in)', async () => {
  const { V } = env();
  const model = await load(V, asset);
  const tuned = V.ysm.build(model, { height: 1.26, tune: { disableGlowBones: EYE_BONES }, eyeGlow: true });
  assert.equal(glowOf(tuned).count, 0, 'bones listed by name are never glow bones');
  assert.equal(tuned.canEyeGlow, false, 'so there is nothing for the player to switch on');
  tuned.dispose();
});

test('non-eye glow bones keep glowing', async () => {
  const { V } = env();
  const model = await load(V, asset);
  // Give the real model one more full-bright bone that is NOT an eye: a copy of an eye bone's cubes hung on the arm.
  const bones = model.geo.bones, eye = bones.find(b => b.name === 'ysmGlowRightEyesBase');
  assert.ok(eye && eye.cubes.length, 'fixture bone exists');
  assert.ok(bones.some(b => b.name === 'RightArm'), 'fixture parent exists');
  const withLantern = { ...model, geo: { ...model.geo, bones: [...bones, { ...eye, name: 'ysmGlowLantern', parent: 'RightArm' }] } };
  const eyesOnly = V.ysm.build(model, { height: 1.26, eyeGlow: true });
  const perEye = glowOf(eyesOnly).count / 8;
  assert.ok(Number.isInteger(perEye) && perEye > 0, 'eight identical eye bones');

  const inst = V.ysm.build(withLantern, { height: 1.26 });
  const lantern = inst.rig.list.find(b => b.name === 'ysmGlowLantern');
  assert.equal(V.ysm.isEyeGlowBone(lantern), false);
  assert.equal(glowOf(inst).count, perEye, 'the lantern is full-bright, the eight eyes are not');
  assert.equal(glowOf(inst).visible, true);
  inst.setEyeGlow(true);
  assert.equal(glowOf(inst).count, perEye * 9, 'opting in adds the eyes back next to the lantern');
  inst.setEyeGlow(false);
  assert.equal(glowOf(inst).count, perEye);
  eyesOnly.dispose(); inst.dispose();
});

test('real winter-outfit model, when provided: same eight eye bones, no full-bright eyes', { skip: !process.env.YSM_WINTER_ZIP }, async () => {
  const { V } = env();
  const model = await load(V, new Uint8Array(fs.readFileSync(process.env.YSM_WINTER_ZIP)));
  const inst = V.ysm.build(model, { height: 1.26 });
  const glowBones = inst.rig.list.filter(b => /^ysmGlow/.test(b.name));
  assert.deepEqual(glowBones.map(b => b.name).sort(), [...EYE_BONES].sort());
  assert.ok(glowBones.every(b => V.ysm.isEyeGlowBone(b)));
  assert.equal(glowOf(inst).count, 0);
  assert.equal(glowOf(inst).visible, false);
  inst.setEyeGlow(true);
  assert.ok(glowOf(inst).count > 0);
  inst.dispose();
});
