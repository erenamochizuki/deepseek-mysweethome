// 捡起贝壳以后的欢呼（2026-11-17，用户的要求）：
//   1. 站起来时转向「这一刻镜头所在的位置」，对着看她的人举手欢呼，而不是捡的时候随便朝着的方向；
//   2. 从捡到（拿着）到欢呼结束一直是开心脸（表情表里的 laugh：>_< O∀O），不被说话的嘴型、「第一次见」的惊讶盖掉。
// 真实房屋 + 真实寻路 + 真实角色（自带 YSM 模型），假沙滩，假镜头 V3.R.camera。
//   node --test test/actor-cheer-face.test.mjs
//   YSM_SRC_DIR=<改动前的 src>：同一批断言在旧代码上应当失败
import test from 'node:test';
import assert from 'node:assert/strict';
import { actorCabin, fakeGame } from '../tools/lib/actor-cabin.mjs';

const src = process.env.YSM_SRC_DIR ? { srcDir: process.env.YSM_SRC_DIR } : {};
const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));

function walkableNear(c, list) {
  const [x, , z] = c.a.pos, N = c.V.nav;
  for (const [dx, dz] of list) if (N.walkable(x + dx, z + dz)) return [x + dx, z + dz];
  assert.fail('no walkable beach spot');
}

test('after picking a shell up she turns to where the camera is at that moment, cheers facing it, and smiles throughout', async t => {
  const G = fakeGame([]);
  const c = await actorCabin(t, { game: G, ...src }), { a, V } = c;
  c.V.viewTokens.girl('auto');
  c.step(1);
  // 镜头：两次分别放在她的两侧，和她去捡贝壳时的朝向差得很远
  for (const [n, spot, camOff] of [[1, [[1.2, 2.2], [0.3, 3.0], [2.0, 2.6]], [-7, 1.5]], [2, [[-1.6, 3.0], [-2.4, 2.2], [0.8, 3.6]], [6, -3]]]) {
    const p = walkableNear(c, spot);
    const cam = { position: { x: p[0] + camOff[0], y: 3, z: p[1] + camOff[1] } };
    V.R = { camera: cam };
    G.add({ id: 'i' + n, x: p[0], z: p[1], at: Date.now() - 3600e3, kind: 'k' });
    const from = c.frames.length;
    assert.ok(a.collect('i' + n), 'she goes for it');
    c.until(() => G.collected.length === n, 30, 'picked it up');
    c.until(() => a._dbg.sub === 'cheer', 6, 'starts cheering');
    const startCheer = c.frames.length;
    c.until(() => a._dbg.mode !== 'pick', 8, 'cheer ends');
    const fr = c.frames.slice(from);
    const pickIdx = fr.findIndex(f => f.sub === 'hold' || f.sub === 'up');
    assert.ok(pickIdx >= 0, 'went through hold/up after collecting');
    // 蹲下的时候面朝贝壳（为了让手对准最多偏 0.35 rad，加转身误差留到 0.45）
    const crouch = fr.filter(f => f.sub === 'down' && f.pose === 'pickup');
    assert.ok(crouch.length > 3, 'she crouches');
    const toShell = Math.atan2(p[0] - a.pos[0], p[1] - a.pos[2]);
    assert.ok(crouch.every(f => Math.abs(wrap(f.yaw - toShell)) < 0.45), `faces the shell while crouching (off by up to ${Math.max(...crouch.map(f => Math.abs(wrap(f.yaw - toShell)))).toFixed(2)} rad)`);
    const glad = fr.slice(pickIdx).filter(f => f.mode === 'pick' && ['hold', 'up', 'cheer'].includes(f.sub));
    assert.ok(glad.length > 10, 'some frames of hold/up/cheer');
    assert.ok(glad.every(f => f.expr === 'laugh'), 'happy face the whole time: ' + [...new Set(glad.map(f => f.expr))].join(','));
    // 欢呼开始那一帧：正对着镜头（镜头的水平方向）
    const [x, , z] = a.pos, want = Math.atan2(cam.position.x - x, cam.position.z - z);
    const atCheer = c.frames[startCheer - 1].yaw;
    assert.ok(Math.abs(wrap(atCheer - want)) < 0.15, `faces the camera when the cheer starts (off by ${wrap(atCheer - want).toFixed(2)} rad)`);
    const during = c.frames.slice(startCheer).filter(f => f.sub === 'cheer');
    assert.ok(during.every(f => Math.abs(wrap(f.yaw - want)) < 0.15), 'keeps facing the camera while cheering');
  }
});
