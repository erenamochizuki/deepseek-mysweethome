// 「睡觉的时候会触发吃饭的动作（模型内置的一个动作）」（2026-11-13 夜里）：
//   蓝色大肥鱼的动画控制器 player.parallel_7 用 variable.timer 计「站着不动」的时间（@player_update：ctrl.idle 且没在演额外动画就往上加），
//   站满约 38 秒（timer > 48，每秒 +1.25）演 idle_1（铁盆 / 吃白饭那段），叠在最上面的 parallel 槽位上。29-ysm 以前只看「没在走、pose = stand」
//   就给 ctrl.idle = 1：躺在床上睡、坐在书桌前打字、坐摇椅时她都不动，于是 37 秒左右铁盆就叠到躺着 / 坐着的姿势上。
//   现在 65-girl-actor 把她摆着（坐、躺）时传 { posed: true }，有 base / overlay / posed 时 29-ysm 给 ctrl.idle = 0、ctrl.playing_extra_animation = 1。
//   真正站着发呆时照旧会演（对照组）。
// 真实模块 + 真实 three + 真实房子和寻路 + 自带的模型；设 YSM_WINTER_ZIP 时冬装版也跑一遍。
//   node --test test/ysm-posed-idle.test.mjs
//   YSM_SRC_DIR=<改动前的 src>：同一批断言在旧代码上应当失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { requireGirlZip } from '../tools/lib/girl-asset.mjs';
requireGirlZip('ysm-posed-idle');   // 第三方模型不进仓库：没有就跳过

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
  V.ysmUI = { initialBody: () => ({ id: 'test:model', builder: () => V.ysm.build(model, { height: 1.25 }) }) };
  V.bubble = { say() { return true; } };
  const part = parts.get('girl-actor'), scene = new T.Group();
  part.build({ rng: () => () => 0.2 }).forEach(o => scene.add(o));
  V.viewTokens.girl('idle');
  const a = V.actor, inst = a.inst;
  // 模型自己的待机动画现在在不在演：parallel_7 的控制器状态 / 正在放的动画
  const idle = () => { const s = inst.slotInfo().find(x => x.key === 'parallel_7'); return !!s && (s.ctrl === 'idle_1' || s.act.includes('idle_1')); };
  t.after(() => { part.dispose(); assert.deepEqual(window.__errors, []); });
  return { V, a, part, inst, idle, model };
}
// 行为进到 'action' 以后再放 secs 秒（每帧 50 ms），记下 idle_1 第一次出现在第几秒
function hold(c, secs, phase = 'action') {
  let n = 0, first = null, timer = 0;
  for (let i = 0; i < 6000 && c.a.behavior; i++) {
    c.part.update(0.05);
    if (c.a.behavior && c.a.behavior.phase === phase) {
      n++; timer = Math.max(timer, c.inst.getVar('timer'));
      if (first == null && c.idle()) first = n * 0.05;
      if (n * 0.05 >= secs) break;
    }
  }
  return { secs: n * 0.05, first, timer };
}

for (const [name, bytes] of MODELS) {
  test(name + ': asleep in bed for 90 s — the model\'s own idle (idle_1, the rice-bowl bit) never plays over the lying clip', async t => {
    const c = await cabin(t, bytes);
    assert.ok(c.model.controllers['player.parallel_7'], 'this model has the parallel_7 idle controller');
    c.a.place(-2.4, -7.5, 0, 1); c.part.update(0.05);
    assert.equal(c.a.startBehavior('sleep'), true);
    const r = hold(c, 90);
    assert.ok(r.secs >= 90, 'she really slept 90 s (' + r.secs.toFixed(1) + ')');
    assert.equal(c.inst.actorAnimation.base, 'extra:extra13', 'lying clip');
    assert.equal(c.inst.actorAnimation.posed, true);
    // 旧代码：37.3 s 时 idle_1，timer 到 70
    assert.equal(r.first, null, 'idle_1 started after ' + r.first + ' s asleep');
    assert.ok(r.timer < 1, 'the idle timer does not run while she lies there (' + r.timer.toFixed(1) + ')');
  });

  test(name + ': seated at the desk (typing, then held) and seated to eat — no idle_1', async t => {
    const c = await cabin(t, bytes);
    c.a.place(-2.4, -7.5, 0, 1); c.part.update(0.05);
    assert.equal(c.a.startBehavior('reply_private', { seconds: 12, hold: true }), true);
    const r = hold(c, 75);
    assert.ok(r.secs >= 75, 'at the desk for 75 s');
    assert.equal(c.inst.actorAnimation.base, 'main:sit', 'typing is over, she sits and waits');
    assert.equal(r.first, null, 'idle_1 at the desk after ' + r.first + ' s');   // 旧代码：38.5 s
    c.a.endBehavior(); for (let i = 0; i < 40; i++) c.part.update(0.05);
    assert.equal(c.a.startBehavior('eat', { seconds: 50 }), true);
    const e = hold(c, 50);
    assert.equal(e.first, null, 'idle_1 while eating after ' + e.first + ' s');
  });

  test(name + ': sitting in the rocker (actor.sit, no clip of ours) — no idle_1; standing still afterwards still gets it', async t => {
    const c = await cabin(t, bytes);
    c.a.place(-2.4, -7.5, 0, 1); c.part.update(0.05);
    assert.equal(c.a.sit({ position: [c.a.pos[0], c.a.pos[1] + 0.45, c.a.pos[2]], seconds: 120 }), true);
    let first = null;
    for (let i = 1; i <= 1800; i++) { c.part.update(0.05); if (first == null && c.idle()) first = i * 0.05; }
    assert.equal(c.a.state, 'furniture', 'still seated after 90 s');
    assert.equal(first, null, 'idle_1 in the rocker after ' + first + ' s');   // 旧代码：3.6 s（坐下前站着积下的计时）
    // 对照：这个模型站着发呆够久，待机动画照旧会演（只是不叠在坐 / 躺上）
    const inst = c.inst;
    inst.setActorAnimation(); inst.states.pose.value = 'stand'; inst.states.anim.value = '';
    let seen = null;
    for (let i = 1; i <= 1200 && seen == null; i++) { inst.update(0.05, i * 0.05); if (c.idle()) seen = i * 0.05; }
    assert.ok(seen != null && seen > 30 && seen < 45, 'standing idle: idle_1 after ~38 s (' + seen + ')');
  });
}
