// 冲上岸的运动要平滑（2026-11-17）：以前浪追上贝壳的那一帧直接按 ≤ 3 m/s 挪、浪一走立刻停，
// 速度一帧内从 0 跳到 3 m/s（加速度 180 m/s²），翻滚跟着位置走，最快约 23 rad/s，看着一顿一顿还乱翻。
// 这里用一组周期性的假浪（浪前沿最快约 3.9 m/s 往陆地推）逐帧推一枚贝壳，检查：
//   速度不超过 1.6 m/s、相邻两帧的速度差换算成加速度不超过 12 m/s²、翻滚不超过 12 rad/s、20 秒内正好停在落点。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadV3 } from '../tools/lib/v3-node.mjs';

function fixture() {
  const h = loadV3(['03-vox', '30-shell-kit', '30-shell-m1', '30-shell-m2', '30-shells'], { three: 'real' }), V = h.V3;
  V.layout = { zones: [{ id: 'wash', x0: -30, x1: 30 }], outside: [] }; h.load(['60-game']);
  V.terrain = { groundY: () => 0, seabedY: () => 0, shoreZ: () => 12, tideZ: () => 8 };
  V.nav = { reachable: () => true, walkable: () => true }; V.scene = { part: p => V.part = p }; h.load(['62-beach-items']);
  V.part.build();
  return { ...h, V };
}

for (const [label, period, reach] of [['short quick waves', 3.2, 2.2], ['long big waves', 5.5, 3.6]]) {
  test(`wash-up motion is smooth and lands exactly on its spot (${label})`, () => {
    const { V } = fixture();
    let clock = 0;
    // 浪前沿离岸线的距离：每 period 秒涌上来一次，最远 reach 米，退回去时 frontD 回到 0
    V.water = { frontD: () => reach * Math.max(0, Math.sin(2 * Math.PI * clock / period)) };
    const it = { id: 'w1', kind: 'scallop', x: 0, z: 9.2, ry: 0.6, at: 1 };
    V.game.st.beach.push(it); V.emit('game:wash', { items: [it], silent: false });
    const dt = 1 / 60, zs = [], th = [];
    for (let f = 0; f < 60 * 20 && !V.beachItems.ready('w1'); f++) {
      clock += dt; V.part.update(dt);
      const r = V.beachItems.get('w1');
      zs.push(r.position.z); th.push(r.getObjectByName('spin').rotation.x);
    }
    assert(V.beachItems.ready('w1'), 'settles within 20 s');
    assert(Math.abs(V.beachItems.get('w1').position.z - 9.2) < 1e-6, 'lands exactly on its saved spot');
    const v = zs.slice(1).map((z, k) => (zs[k] - z) / dt);
    const acc = v.slice(1).map((x, k) => Math.abs(x - v[k]) / dt);
    const t2 = th.slice(0, -1), w = t2.slice(1).map((t, k) => Math.abs(t - t2[k]) / dt);   // 最后一帧落定时角度归零，不算
    const vmax = Math.max(...v), amax = Math.max(...acc), wmax = Math.max(...w);
    console.log(`${label}: ${(zs.length / 60).toFixed(2)} s, vmax ${vmax.toFixed(2)} m/s, accMax ${amax.toFixed(1)} m/s², spinMax ${wmax.toFixed(1)} rad/s`);
    if (reach > 3) assert(zs.length / 60 < 10, 'a wave that reaches past the spot carries it there within one or two waves, not left behind');
    assert(Math.min(...v) > -1e-9, 'never slides back out to sea');
    assert(vmax <= 1.6 + 1e-6, `top speed ${vmax}`);
    assert(amax <= 12, `speed changes smoothly (max ${amax.toFixed(1)} m/s²)`);
    assert(wmax <= 12, `tumbles at a readable rate (max ${wmax.toFixed(1)} rad/s)`);
    V.part.dispose();
  });
}
