// 截图前核对站位（task-14）：lib/pose.mjs 的纯函数，和卡片里 shot 的 pose 参数检查。
// 真的跑起来核对（对着 mock）在 pose-run.test.mjs。运行：node --test mod/tools/test/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { tpPose, wrapDegrees, angleDiff, poseDiff, poseText, POSE_TOLERANCE } from '../lib/pose.mjs';
import { loadCard, describeStep, CardError } from '../lib/cards.mjs';
import { makeTempDir } from './mock-probe.mjs';
import { writeCard, removeDir } from './helpers.mjs';

const tmp = makeTempDir('pose-');
test.after(() => removeDir(tmp));
let n = 0;
const card = (text) => loadCard(writeCard(tmp, `pose-${++n}.yml`, text));

test('tpPose：绝对坐标 + 朝向的 tp 算得出站位（整数 x、z 加 0.5，角度按 MC 取余）', () => {
  assert.deepEqual(tpPose('tp @s 3 -60 -2 145 17'), { pose: { x: 3.5, y: -60, z: -1.5, yaw: 145, pitch: 17 } });
  assert.deepEqual(tpPose('/minecraft:teleport @s 1.25 -59.5 .5 540 100'), { pose: { x: 1.25, y: -59.5, z: 0.5, yaw: -180, pitch: 90 } });
  assert.deepEqual(tpPose('tp @s 0 -60 0 180 -10').pose, { x: 0.5, y: -60, z: 0.5, yaw: -180, pitch: -10 });
  assert.equal(tpPose('setblock 1 -60 3 minecraft:stone'), null, '不是 tp：不影响站位');
  assert.equal(tpPose('time set noon'), null);
});

test('tpPose：算不出来的 tp 给出原因（之后的截图不核对）', () => {
  const why = (cmd, as) => tpPose(cmd, as)?.reason;
  assert.equal(why('tp @s ~ ~1 ~ 90 0'), '用了相对坐标（~ 或 ^）');
  assert.equal(why('tp @s ^ ^ ^1 0 0'), '用了相对坐标（~ 或 ^）');
  assert.equal(why('tp @s 0 -60 0 ~10 0'), '用了相对坐标（~ 或 ^）');
  assert.equal(why('tp @s 0 -60 0 facing 5 -60 5'), '用了 facing');
  assert.equal(why('tp @s 0 -60 0'), '没写朝向');
  assert.equal(why('tp 0 -60 0'), '没写朝向');
  assert.equal(why('tp @s 0 -60 0 90 0', 'server'), '是 as server 执行的');
  assert.equal(why('tp @p 0 -60 0 90 0'), '的目标是 @p，不是 @s');
  assert.equal(why('tp @s Steve'), '是 tp 到别的实体');
  assert.equal(why('execute as @s run tp @s 0 -60 0 90 0'), '用了 execute … tp');
  assert.equal(why('tp @s 0 -60 0 abc 0'), '参数看不懂');
});

test('角度：wrapDegrees 和 Java 的 Mth.wrapDegrees 一样，angleDiff 按 360° 取余', () => {
  assert.equal(wrapDegrees(180), -180);
  assert.equal(wrapDegrees(-190), 170);
  assert.equal(wrapDegrees(359), -1);
  assert.equal(wrapDegrees(-180), -180);
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(-180, 180), 0);
  assert.equal(angleDiff(145, -215), 0);
  assert.ok(Math.abs(angleDiff(179.9, -179.8) - 0.3) < 1e-9);
});

test('poseDiff：容差是位置 0.01 格、yaw 0.5°、pitch 0.5°；08:40 那次的偏差报得出来', () => {
  assert.deepEqual(POSE_TOLERANCE, { pos: 0.01, yaw: 0.5, pitch: 0.5 });
  const want = { x: 3.5, y: -60, z: -1.5, yaw: 145, pitch: 17 };
  assert.deepEqual(poseDiff(want, { ...want, x: 3.508, yaw: 145.4, pitch: 16.6 }).problems, []);
  assert.deepEqual(poseDiff(want, { ...want, yaw: -215.3 }).problems, [], 'yaw 绕了一圈也算对上');
  const bad = poseDiff(want, { x: 3.5, y: -60.02, z: -1.5, yaw: 129.4, pitch: 90 });
  assert.deepEqual(bad.problems, ['位置差 0.02 格', 'yaw 差 15.6°', 'pitch 差 73°']);
  assert.deepEqual(poseDiff(want, null).problems, ['/status 里没有 player（不在世界里？）']);
  assert.equal(poseText(want), '(3.5, -60, -1.5) yaw 145 pitch 17');
  assert.equal(poseText(null), '（没有）');
});

test('shot 的 pose：不写、false、{x, y, z, yaw, pitch} 都行；describe 里看得到', () => {
  const steps = card('steps:\n  - shot: a\n  - shot: {name: b, pose: false}\n  - shot:\n      name: c\n      pose: {x: 3.5, y: -60, z: -1.5, yaw: 145, pitch: -17.5}\n').steps;
  assert.equal(steps[0].params.pose, undefined);
  assert.doesNotMatch(describeStep(steps[0]), /pose/);
  assert.equal(steps[1].params.pose, false);
  assert.match(describeStep(steps[1]), /pose=false/);
  assert.deepEqual(steps[2].params.pose, { x: 3.5, y: -60, z: -1.5, yaw: 145, pitch: -17.5 });
  assert.match(describeStep(steps[2]), /pose=\(3\.5, -60, -1\.5\) yaw 145 pitch -17\.5/);
});

test('pose 写错了：卡片错误（带文件名和行号，开游戏前就停）', () => {
  const bad = [
    ['"yes"', /pose 要写 false（不核对），或者 \{x: …/],
    ['true', /pose 要写 false/],
    ['[1, 2, 3]', /pose 要写 false/],
    ['{x: 1, y: 2, z: 3, yaw: 4}', /pose 的 pitch 要写成数/],
    ['{x: 1, y: 2, z: 3, yaw: 4, pitch: "5"}', /pose 的 pitch 要写成数/],
    ['{x: 1, y: 2, z: 3, yaw: 4, pitch: 91}', /pitch 要在 -90 到 90 之间/],
    ['{x: 1, y: 2, z: 3, yaw: 4, pitch: 5, roll: 0}', /pose 里不认识「roll」/],
  ];
  for (const [v, re] of bad) {
    assert.throws(
      () => card(`steps:\n  - shot:\n      name: bad\n      pose: ${v}\n`),
      (e) => e instanceof CardError && e.line === 4 && re.test(e.reason),
      `pose: ${v}`,
    );
  }
});
