// test/mc-model.test.mjs — 15-mcmodel.js 的单元测试（方块状态匹配、multipart、随机选模型、parent 合并、旋转和 uvlock）
//   node test/mc-model.test.mjs
// 只用手写的小模型，不需要 MC 的 jar。随机数的期望值是用 JDK 的 java.util.Random 和 MC 的 Mth.getSeed 公式算出来的。
import { loadV3 } from '../tools/lib/v3-node.mjs';

const M = loadV3(['15-mcmodel']).V3.mcmodel;
let pass = 0, fail = 0;
function ok(cond, what, got) {
  if (cond) { pass++; console.log('PASS', what); } else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got, (k, v) => (typeof v === 'bigint' ? String(v) : v))); }
}
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;

// ---- 状态字符串 ----
{
  const st = M.parseState('minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]');
  ok(st.name === 'minecraft:oak_stairs' && st.props.facing === 'east' && st.props.half === 'top' && Object.keys(st.props).length === 4, 'parseState 读出名字和属性', st);
  ok(M.parseState('stone').name === 'minecraft:stone', '没写命名空间按 minecraft', M.parseState('stone'));
  ok(M.isAir(M.parseState('minecraft:cave_air')) && M.isAir(M.parseState('minecraft:air')) && !M.isAir(M.parseState('minecraft:glass')), '空气的判断');
}

// ---- variants 的 key ----
{
  const P = { facing: 'east', half: 'top', shape: 'straight', waterlogged: 'false' };
  ok(M.matchVariantKey('facing=east,half=top,shape=straight', P), 'variant key：列出的属性都对上就匹配');
  ok(!M.matchVariantKey('facing=east,half=bottom', P), 'variant key：有一个属性不同就不匹配');
  ok(M.matchVariantKey('', P), 'variant key：空字符串匹配所有状态');
  ok(!M.matchVariantKey('type=bottom', {}) && M.matchVariantKey('type=bottom', {}, true), 'variant key：状态里缺属性时严格不匹配、宽松匹配');
}

// ---- multipart 的 when ----
{
  const W = { north: 'low', east: 'none', up: 'true' };
  ok(M.matchCondition({ north: 'low|tall' }, W), 'when：| 表示几个值任选一个');
  ok(!M.matchCondition({ north: 'low', east: 'tall' }, W), 'when：写了几个属性就要都满足');
  ok(M.matchCondition({ OR: [{ east: 'tall' }, { up: 'true' }] }, W), 'when：OR');
  ok(!M.matchCondition({ AND: [{ up: 'true' }, { east: 'low' }] }, W) && M.matchCondition({ AND: [{ up: 'true' }, { north: 'low' }] }, W), 'when：AND');
  ok(M.matchCondition({ OR: [{ AND: [{ up: 'true' }, { north: 'tall|low' }] }, { east: 'x' }] }, W), 'when：OR 里套 AND');
  ok(M.matchCondition({ east: '!tall' }, W) && !M.matchCondition({ east: '!none' }, W), 'when：! 表示「不是这个值」');
  ok(!M.matchCondition({ missing: 'x' }, W), 'when：状态里没有的属性 → 不匹配');
  ok(M.matchCondition(undefined, W), '没有 when → 总是用');
}

// ---- variant 列表 ----
{
  const l = M.variantList([{ model: 'block/a', y: 90, weight: 3 }, { model: 'minecraft:block/b', x: -90, uvlock: true }, { nope: 1 }]);
  ok(l.length === 2 && l[0].model === 'minecraft:block/a' && l[0].y === 90 && l[0].weight === 3 && l[1].x === 270 && l[1].uvlock && l[1].weight === 1, 'variantList：补命名空间、角度取模、weight 默认 1', l);
}

// ---- 随机选模型：和 java.util.Random + Mth.getSeed 逐位一致 ----
{
  const SEEDS = [[[0, -61, 0], 2402721n, 3, 0, -1332982980727659532n], [[1, -61, 0], 133226188124491n, 1, 2, 4676533259948288751n],
    [[2, -61, 0], -30603005453396n, 2, 1, -7272698366861773682n], [[-5, 70, 12], -18661031759246n, 1, 2, 7008123437990542129n],
    [[123456, 64, -98765], 55942278971130n, 2, 0, -6038358044855702344n], [[-30000000, -64, 29999999], 16785290161034n, 3, 0, -3032758596755859629n]];
  for (const [p, seed, n4, n3, l] of SEEDS) {
    const s = M.posSeed(...p);
    ok(s === seed && new M.JavaRandom(s).nextInt(4) === n4 && new M.JavaRandom(s).nextInt(3) === n3 && new M.JavaRandom(s).nextLong() === l, `位置种子和 JDK 一致 ${p}`, String(s));
  }
  ok(new M.JavaRandom(42n).next(32) === -1170105035, 'new Random(42).nextInt() 和 JDK 一致');
}

// ---- 一个内存里的小资源包（只有 resolver 用到的 blockstate / model） ----
function memPack(blockstates, models) {
  const id = (s) => (s.includes(':') ? s : 'minecraft:' + s);
  return { blockstate: (n) => blockstates[id(n)] || null, model: (n) => models[id(n)] || null };
}
const ALL6 = (tex, cull) => Object.fromEntries(M.DIRS.map((d) => [d, { texture: tex, ...(cull ? { cullface: d } : {}) }]));
const MODELS = {
  'minecraft:block/t_base': { ambientocclusion: false, textures: { particle: '#side' }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: ALL6('#side', true) }] },
  'minecraft:block/t_mid': { parent: 'block/t_base', textures: { side: '#all' } },
  'minecraft:block/t_leaf': { parent: 'minecraft:block/t_mid', textures: { all: 'block/stone' },
    elements: [{ from: [0, 0, 0], to: [16, 8, 8], faces: { up: { texture: '#all' }, north: { texture: '#all', cullface: 'north' } } }] },
  'minecraft:block/t_full': { parent: 'block/t_mid', textures: { all: { sprite: 'block/glass', force_translucent: true } } },
  'minecraft:block/t_loop_a': { parent: 'block/t_loop_b' },
  'minecraft:block/t_loop_b': { parent: 'block/t_loop_a' },
  'minecraft:block/t_orphan': { parent: 'block/not_there', textures: { all: 'block/stone' } },
  'minecraft:block/t_box': { textures: { all: 'block/stone' }, elements: [{ from: [4, 0, 2], to: [12, 6, 10], faces: ALL6('#all', false) }] },
  'minecraft:block/t_rot45': { textures: { all: 'block/stone' }, elements: [{ from: [0, 0, 8], to: [16, 16, 8], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45, rescale: true }, faces: { north: { texture: '#all' }, south: { texture: '#all' } } }] },
};
const BLOCKSTATES = {
  'minecraft:t_dir': { variants: { 'facing=north': { model: 'block/t_leaf' }, 'facing=east': { model: 'block/t_leaf', y: 90 }, 'facing=south': { model: 'block/t_leaf', y: 180 } } },
  'minecraft:t_slab': { variants: { 'type=bottom': { model: 'block/t_box' }, 'type=top': { model: 'block/t_box', x: 180 } } },
  'minecraft:t_rand': { variants: { '': [{ model: 'block/t_box' }, { model: 'block/t_box', y: 90 }, { model: 'block/t_box', y: 180 }, { model: 'block/t_box', y: 270 }] } },
  'minecraft:t_wall': { multipart: [{ when: { up: 'true' }, apply: { model: 'block/t_box' } },
    { when: { north: 'low|tall' }, apply: { model: 'block/t_leaf' } },
    { when: { OR: [{ east: 'tall' }, { AND: [{ up: 'false' }, { north: 'none' }] }] }, apply: { model: 'block/t_full' } },
    { apply: [{ model: 'block/t_box' }, { model: 'block/t_box', y: 90 }, { model: 'block/t_box', y: 180 }] }] },
};
const R = M.createResolver(memPack(BLOCKSTATES, MODELS));

// ---- parent 链合并 ----
{
  const leaf = R.resolveModel('block/t_leaf');
  ok(leaf.elements.length === 1 && leaf.elements[0].to[1] === 8, 'parent 合并：子模型自己的 elements 优先', leaf.elements);
  ok(leaf.ao === false, 'parent 合并：ambientocclusion 从 parent 继承', leaf.ao);
  ok(leaf.textures.side && leaf.textures.side.sprite === 'minecraft:block/stone' && leaf.textures.particle.sprite === 'minecraft:block/stone', 'parent 合并：#引用一层层解开（particle → #side → #all → block/stone）', leaf.textures);
  const full = R.resolveModel('block/t_full');
  ok(full.elements.length === 1 && full.elements[0].to[1] === 16 && full.textures.side.sprite === 'minecraft:block/glass' && full.textures.side.force === true, 'parent 合并：没 elements 用 parent 的；贴图可写成 {sprite, force_translucent}', full.textures.side);
  const q = M.bakeModel(full, M.variantList({ model: 'x' })[0]);
  ok(q.length === 6 && q.every((x) => x.sprite === 'minecraft:block/glass' && x.force), 'parent 合并后烤出 6 个面，带 force_translucent', q.length);
  const loop = R.resolveModel('block/t_loop_a');
  ok(!loop.hasElements && R.warnings.some((w) => w.includes('循环')), 'parent 循环：不死循环，记一条警告', R.warnings);
  const orphan = R.resolveModel('block/t_orphan');
  ok(!orphan.hasElements && orphan.missing === 'minecraft:block/not_there' && R.warnings.some((w) => w.includes('not_there')), '找不到 parent：记警告', orphan.missing);
}

// ---- 选模型 + 整块旋转 ----
const bounds = (qs) => {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const q of qs) for (let i = 0; i < 12; i++) { const a = i % 3; b[a] = Math.min(b[a], q.pos[i]); b[a + 3] = Math.max(b[a + 3], q.pos[i]); }
  return b.map((v) => Math.round(v * 1e4) / 1e4);
};
const D = (n) => M.dirIndex(n);
{
  const east = R.block('minecraft:t_dir[facing=east]', [0, 0, 0]);
  ok(east.status === 'ok' && east.parts[0].variant.y === 90, 'variants：按 facing 选到 y=90', east.parts[0].variant);
  const b = bounds(east.quads);
  ok(near(b[0], 0.5) && near(b[3], 1) && near(b[2], 0) && near(b[5], 1) && near(b[4], 0.5), 'y=90：北半边的元素转到东半边', b);
  const side = east.quads.find((q) => q.dir !== D('up'));
  ok(side && side.dir === D('east') && side.cull === D('east'), 'y=90：north 面和它的 cullface 一起变成 east', side && [side.dir, side.cull]);
  const top = R.block('minecraft:t_slab[type=top]', [0, 0, 0]);
  const tb = bounds(top.quads);
  ok(near(tb[1], 10 / 16) && near(tb[4], 1) && near(tb[2], 6 / 16) && near(tb[5], 14 / 16), 'x=180：下半砖翻到上面（z 也跟着翻）', tb);
  ok(top.quads.some((q) => q.dir === D('down')) && top.quads.filter((q) => q.dir === D('up')).length === 1, 'x=180：原来的 up 面朝下');
}

// ---- uvlock：转过之后贴图仍按世界坐标对齐（16 种 x/y 组合、6 个面都查） ----
{
  const world = [(p) => [p[0], 1 - p[2]], (p) => [p[0], p[2]], (p) => [1 - p[0], 1 - p[1]], (p) => [p[0], 1 - p[1]], (p) => [p[2], 1 - p[1]], (p) => [1 - p[2], 1 - p[1]]];
  const box = R.resolveModel('block/t_box');
  const check = (qs) => qs.every((q) => [0, 1, 2, 3].every((i) => {
    const w = world[q.dir]([q.pos[i * 3], q.pos[i * 3 + 1], q.pos[i * 3 + 2]]);
    return near(q.uv[i * 2], w[0]) && near(q.uv[i * 2 + 1], w[1]);
  }));
  ok(check(M.bakeModel(box, { x: 0, y: 0, z: 0, uvlock: false })), '不转时默认 UV = 按世界坐标的 UV（基准）');
  let bad = [];
  for (const x of [0, 90, 180, 270]) for (const y of [0, 90, 180, 270]) if (!check(M.bakeModel(box, { x, y, z: 0, uvlock: true }))) bad.push([x, y]);
  ok(!bad.length, 'uvlock：16 种旋转、每个面的 UV 都按世界坐标对齐', bad);
  ok(!check(M.bakeModel(box, { x: 0, y: 90, z: 0, uvlock: false })), '没 uvlock 时 y=90 的 UV 跟着模型转（确认上面的检查不是白过）');
}

// ---- 元素 rotation（45° + rescale，像草那样的交叉面） ----
{
  const qs = M.bakeModel(R.resolveModel('block/t_rot45'), { x: 0, y: 0, z: 0, uvlock: false });
  const b = bounds(qs);
  ok(qs.length === 2 && qs.every((q) => q.rotated), '扁平元素只留 north/south 两面，标记为 rotated', qs.length);
  ok(near(b[0], 0) && near(b[3], 1) && near(b[2], 0) && near(b[5], 1) && near(b[1], 0) && near(b[4], 1), 'rescale：45° 斜面正好撑满方块对角线', b);
}

// ---- 随机模型、multipart、兜底 ----
{
  const Y = { '0,-61,0': 270, '1,-61,0': 90, '2,-61,0': 180, '-5,70,12': 90 };
  for (const [k, y] of Object.entries(Y)) {
    const s = R.select(M.parseState('minecraft:t_rand'), k.split(',').map(Number));
    ok(s.random && s.parts[0].y === y, `随机 variant 在 ${k} 选 y=${y}（和 MC 一样按位置）`, s.parts[0]);
  }
  const W = (p) => R.select(M.parseState('minecraft:t_wall[' + p + ']'), [3, 4, 5]);
  const a = W('east=none,north=low,up=true');
  const expect = new M.JavaRandom(new M.JavaRandom(M.posSeed(3, 4, 5)).nextLong()).nextInt(3);
  ok(a.status === 'ok' && a.parts.length === 3 && a.parts[0].model === 'minecraft:block/t_box' && a.parts[1].model === 'minecraft:block/t_leaf' && a.parts[2].y === [0, 90, 180][expect], 'multipart：when 条件 + 带权重的部分按 MC 的种子规则选', a.parts);
  ok(W('east=none,north=none,up=false').parts.length === 2 && W('east=tall,north=none,up=true').parts.some((p) => p.model === 'minecraft:block/t_full'), 'multipart：OR 里的 AND 分支、OR 的第一个分支');
  const len = R.block('minecraft:t_slab', [0, 0, 0]);
  ok(len.status === 'ok' && R.warnings.some((w) => w.includes('宽松匹配')), '状态不全：宽松匹配 + 警告', len.status);
  const none = R.block('minecraft:nope[a=b]', [0, 0, 0]);
  ok(none.status === 'noblockstate' && !none.quads.length && R.warnings.some((w) => w.includes('没有模型')), '没有 blockstate：状态 noblockstate + 警告', none.status);
  ok(R.block('minecraft:air', [0, 0, 0]).status === 'air', '空气不出 quad');
}

console.log(`\nmc-model: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
