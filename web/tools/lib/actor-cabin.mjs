// tools/lib/actor-cabin.mjs — 测试用：真实房屋（assets/house/house-v4.png）+ 真实寻路（61-nav）+ 真实角色（65-girl-actor，自带的 YSM 模型），
// 不开浏览器、不建场景渲染。test/actor-sweep.test.mjs、test/actor-leisure.test.mjs 用（2026-11-14）。
//   const c = await actorCabin(t, { srcDir?, game?, zip? })
//   c.a = V3.actor；c.step(秒)、c.until(fn, 最多秒, 说明)；c.events（actor:behavior）、c.sweeps（actor:sweep）、c.speech、c.frames（每帧的 state / pose / sub / v / 动画）
//   c.hip() = 两条大腿根的中点（世界坐标）；c.furn(id) = 这种家具的 [{ center, yaw, facing, cell }]（按 65 的算法：格子中心 + 朝向的 yaw）
//   game：一个假的 V3.game（见 fakeGame），给了就在角色建好之前装上
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadV3 } from './v3-node.mjs';
import { loadActorTestModel } from './actor-test-model.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const image = fs.readFileSync(path.join(WEB, 'assets', 'house', 'house-v4.png'));
const FACE = { north: 0, east: 90, south: 180, west: 270 };

// 假的沙滩：items = [{ id, x, z, at, kind? }]；S 是设置（girlMin / girlMax / girlAuto）。和 60-game 一样：claim 了的不在 free() 里，collect 以后从沙滩上拿走
export function fakeGame(items, S = {}) {
  const claims = new Map(), collected = [];
  const G = {
    S: Object.assign({ girlMin: 30, girlMax: 30, girlAuto: true }, S), st: { beach: items.slice() }, collected,
    free: () => G.st.beach.filter(b => !claims.has(b.id)),
    claim: (id, who = 'girl') => { if (!G.st.beach.some(b => b.id === id) || (claims.has(id) && claims.get(id) !== who)) return false; claims.set(id, who); return true; },
    claimedBy: id => claims.get(id) || null,
    unclaim: id => { claims.delete(id); },
    collect(id, by = 'player') {
      const i = G.st.beach.findIndex(b => b.id === id);
      if (i < 0) return null;
      const [item] = G.st.beach.splice(i, 1);
      claims.delete(id); collected.push({ id, by });
      return { item, kind: { name: '测试贝壳' + id, category: 'collectible' }, by, first: false };
    },
    kind: () => ({ category: 'collectible' }),
    add(...more) { G.st.beach.push(...more); },
  };
  return G;
}

export async function actorCabin(t, { srcDir, game, zip, shore = false } = {}) {
  const h = loadV3(['03-vox', '10-zip', '11-molang', '12-nbt', '13-share', '15-mcmodel', '29-ysm', '40-layout', '42-house-mc', '44-furn-mc'],
    { three: 'real', ...(srcDir ? { srcDir } : {}) });
  const { V3: V, window } = h, T = window.THREE, parts = new Map(), events = [], sweeps = [], speech = [], frames = [];
  window.document = new EventTarget();
  V.scene = { part: p => parts.set(p.id, p) };
  if (shore) h.load(['52-terrain', '58-inventory-rules', '59-cabin-inventory', '64-shore', '66-shallows']);
  h.load(['54-house-mc', '61-nav', '65-girl-actor']);
  const HB = V.houseBlocks;
  window.__V3_ASSETS = { [V.layout.house.asset]: image.toString('base64') };
  HB.store = { get: async () => null };
  await HB.load();
  const model = await loadActorTestModel(V, zip);
  V.girlv1 = { build: () => V.ysm.build(model, { height: 1.25 }) };
  V.bubble = { say(_id, text) { speech.push(text); return true; }, hide() {} };
  if (game) V.game = game;
  const part = parts.get('girl-actor'), scene = new T.Group();
  part.build({ rng: () => () => 0.2 }).forEach(o => scene.add(o));
  const a = V.actor;
  V.on('actor:behavior', e => events.push({ ...e }));
  V.on('actor:sweep', e => sweeps.push({ ...e }));
  let clock = 0;
  const update = () => {
    part.update(0.05); clock += 0.05;
    const d = a._dbg;
    frames.push({ t: clock, state: a.state, sub: d && d.sub, pose: d && d.pose, v: d ? d.v : 0, base: a.inst.actorAnimation && a.inst.actorAnimation.base,
      lift: a.root.position.y - a.pos[1], phase: a.behavior && a.behavior.phase, kind: a.behavior && a.behavior.kind,
      yaw: a.yaw, expr: a.inst.states && a.inst.states.expr ? a.inst.states.expr.value : null, mode: d && d.mode });
  };
  const step = secs => { for (let i = 0; i < Math.ceil(secs / 0.05); i++) update(); };
  const dump = () => JSON.stringify({ behavior: a.behavior, state: a.state, pos: a.pos, dbg: a._dbg, sweep: a.sweep, events: events.slice(-6), sweeps: sweeps.slice(-4) });
  function until(fn, limit = 60, what = '') {
    for (let i = 0; i < Math.ceil(limit / 0.05); i++) { if (fn()) return; update(); }
    assert.ok(fn(), what + ' ' + dump());
  }
  const hip = () => {
    const b = a.inst.bones;
    a.root.updateMatrixWorld(true);
    return b.legL.getWorldPosition(new T.Vector3()).add(b.legR.getWorldPosition(new T.Vector3())).multiplyScalar(0.5);
  };
  const furn = id => HB.furnInstances(id).map(it => {
    const offsets = V.furnMc.cellsFor(it.f, it.facing).map(q => q.offset);
    const mid = k => (Math.min(...offsets.map(o => o[k])) + Math.max(...offsets.map(o => o[k]))) / 2;
    const yaw = Math.PI - FACE[it.facing] * Math.PI / 180;
    return { center: [it.cell[0] + 0.5 + mid(0), it.cell[1], it.cell[2] + 0.5 + mid(2)], yaw, facing: it.facing, cell: it.cell.slice() };
  });
  // 朝向 yaw 的人是不是面朝 p 点（水平方向，夹角 60° 以内）
  const faces = (yaw, from, p) => { const x = p[0] - from[0], z = p[2] - from[2], d = Math.hypot(x, z); return d > 1e-6 && Math.sin(yaw) * x + Math.cos(yaw) * z > d * 0.5; };
  t.after(() => { part.dispose(); assert.deepEqual(window.__errors, []); });
  return { V, T, HB, a, window, events, sweeps, speech, frames, step, until, dump, hip, furn, faces, get clock() { return clock; } };
}
