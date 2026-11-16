// mc-light：19-mclight.js 的光照计算 + 16-mcmesh 用光照上色（不需要 MC jar）
// 跑法：node test/mc-light.test.mjs
import { loadV3 } from '../tools/lib/v3-node.mjs';

const { V3 } = loadV3(['14-mcjar', '15-mcmodel', '16-mcmesh', '17-mcfallback', '19-mclight']);
const L = V3.mclight, S = V3.mcmesh, M = V3.mcmodel;
let pass = 0, fail = 0;
const ok = (cond, what, got) => {
  if (cond) { pass++; console.log('PASS ' + what); } else { fail++; console.log('FAIL ' + what + (got === undefined ? '' : '  → ' + JSON.stringify(got))); }
};
const near = (a, b, eps = 0.005) => Math.abs(a - b) <= eps;
const st = (s) => M.parseState(s);

// ---- 发光值 ----
ok(L.emission(st('minecraft:torch')) === 14 && L.emission(st('minecraft:glowstone')) === 15, '发光：火把 14、萤石 15');
ok(L.emission(st('minecraft:furnace[facing=north,lit=true]')) === 13 && L.emission(st('minecraft:furnace[facing=north,lit=false]')) === 0, '发光：熔炉点着 13、没点 0');
ok(L.emission(st('minecraft:red_candle[candles=3,lit=true,waterlogged=false]')) === 9, '发光：3 根点着的蜡烛 9');
ok(L.emission(st('minecraft:sea_pickle[pickles=2,waterlogged=true]')) === 9 && L.emission(st('minecraft:sea_pickle[pickles=2,waterlogged=false]')) === 0, '发光：海泡菜在水里 3+3×个数，离水 0');
ok([0, 1, 2, 3, 4].map((c) => L.emission(st('minecraft:respawn_anchor[charges=' + c + ']'))).join() === '0,3,7,11,15', '发光：重生锚 0/3/7/11/15');
ok(L.emission(st('minecraft:light[level=6,waterlogged=false]')) === 6, '发光：光源方块按 level');
ok(L.emission(st('minecraft:waxed_exposed_copper_bulb[lit=true,powered=false]')) === 12 && L.emission(st('minecraft:oxidized_copper_lantern[hanging=false,waterlogged=false]')) === 15, '发光：涂蜡铜灯、铜灯笼');
ok(L.emission(st('minecraft:stone')) === 0 && L.emission(st('somemod:glow_thing')) === 0, '发光：普通方块和模组方块 0');
ok(L.emissive(st('minecraft:magma_block')) && L.emissive(st('minecraft:sculk_sensor[power=0,sculk_sensor_phase=active,waterlogged=false]')) && !L.emissive(st('minecraft:glowstone')), 'emissive：岩浆块、激活的幽匿感测器');

// ---- 挡光 ----
const ent = (s, f) => Object.assign({ ns: st(s).ns, id: st(s).id, props: st(s).props, occ: false, cube: false, masks: null }, f || {});
const full = () => Uint32Array.from({ length: 8 }, () => 0xFFFFFFFF), empty = () => new Uint32Array(8);
const half = () => { const m = new Uint32Array(8); for (let w = 4; w < 8; w++) m[w] = 0xFFFFFFFF; return m; };
ok(L.occlusion(ent('minecraft:stone', { occ: true, cube: true })).damp === 15, '挡光：石头 15');
ok(L.occlusion(ent('minecraft:oak_leaves[distance=7,persistent=true,waterlogged=false]', { cube: true })).damp === 1, '挡光：树叶 1');
ok(L.occlusion(ent('minecraft:glass', { cube: true })).damp === 0 && L.occlusion(ent('minecraft:tinted_glass', { cube: true })).damp === 15, '挡光：玻璃 0、遮光玻璃 15');
ok(L.occlusion(ent('minecraft:ice', { cube: true })).damp === 1 && L.occlusion(ent('minecraft:water[level=0]')).damp === 1, '挡光：冰 1、水 1');
ok(L.occlusion(ent('minecraft:oak_fence[east=false,north=false,south=false,waterlogged=false,west=false]')).damp === 0
  && L.occlusion(ent('minecraft:oak_fence[east=false,north=false,south=false,waterlogged=true,west=false]')).damp === 1, '挡光：栅栏 0，含水的栅栏 1');
const slabMasks = [full(), empty(), half(), half(), half(), half()];
const so = L.occlusion(ent('minecraft:oak_slab[type=bottom,waterlogged=false]', { occ: true, masks: slabMasks }));
ok(so.damp === 0 && so.shape === slabMasks, '挡光：底半砖 0，用形状挡光');
ok(L.occlusion(ent('minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]', { occ: false })).shape === null, '挡光：门不用形状');
ok(L.shut(slabMasks, null, 0) && !L.shut(slabMasks, null, 1) && !L.shut(slabMasks, slabMasks, 2), '形状：半砖下面封死，上面和侧面不封');
ok(L.shut(slabMasks, [empty(), half(), half(), half(), half(), half()], 4) === false && L.shut([0, 0, 0, 0, half(), 0].map((m) => m || empty()), [0, 0, 0, 0, 0, (() => { const m = new Uint32Array(8); for (let w = 0; w < 4; w++) m[w] = 0xFFFFFFFF; return m; })()].map((m) => m || empty()), 4), '形状：两个半面合起来盖满才封死');

// ---- 传播 ----
{
  // 7×5×7：地面一层石头，上面一个封闭的石头房子（墙、屋顶），里面中间一个火把
  const W = 7, H = 5, Ln = 7, N = W * H * Ln, id = (x, y, z) => x + z * W + y * W * Ln;
  const damp = new Uint8Array(N), emit = new Uint8Array(N), shape = new Array(N).fill(null);
  for (let z = 0; z < Ln; z++) for (let x = 0; x < W; x++) damp[id(x, 0, z)] = 15;
  for (let y = 1; y <= 4; y++) for (let z = 1; z <= 5; z++) for (let x = 1; x <= 5; x++)
    if (x === 1 || x === 5 || z === 1 || z === 5 || y === 4) damp[id(x, y, z)] = 15;
  emit[id(3, 1, 3)] = 14;
  const r = L.compute({ W, H, L: Ln, damp, shape, emit });
  ok(r.blk[id(3, 1, 3)] === 14 && r.blk[id(2, 1, 3)] === 13 && r.blk[id(2, 2, 2)] === 11, '传播：方块光每格减 1（火把 14 → 旁边 13 → 斜对角 11）', [r.blk[id(3, 1, 3)], r.blk[id(2, 1, 3)], r.blk[id(2, 2, 2)]]);
  ok(r.sky[id(3, 2, 3)] === 0 && r.sky[id(0, 1, 0)] === 15 && r.sky[id(3, 4, 3)] === 0, '传播：封闭房子里没有天光，外面 15，石头里 0');
  ok(r.blk[id(0, 1, 3)] === 0, '传播：光穿不过石头墙');
  // 开一个窗：天光从侧面照进去
  damp[id(1, 2, 3)] = 0;
  const r2 = L.compute({ W, H, L: Ln, damp, shape, emit });
  ok(r2.sky[id(1, 2, 3)] === 14 && r2.sky[id(2, 2, 3)] === 13 && r2.sky[id(3, 2, 3)] === 12, '传播：窗口 14，往里每格减 1', [r2.sky[id(1, 2, 3)], r2.sky[id(2, 2, 3)], r2.sky[id(3, 2, 3)]]);
  // 3×4×3：中间一列 3 格水，四周石头，上面露天，下面当实心地 → 天光 14/13/12
  const d3 = new Uint8Array(36).fill(15), id3 = (x, y, z) => x + z * 3 + y * 9;
  for (let y = 0; y < 3; y++) d3[id3(1, y, 1)] = 1;
  for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) d3[id3(x, 3, z)] = 0;
  const r3 = L.compute({ W: 3, H: 4, L: 3, damp: d3, shape: new Array(36).fill(null), emit: new Uint8Array(36) }, { floor: true });
  ok([0, 1, 2].map((y) => r3.sky[id3(1, y, 1)]).join() === '12,13,14', '传播：3 格深的水（四周石头）从上往下 14/13/12', [0, 1, 2].map((y) => r3.sky[id3(1, y, 1)]));
  // 底半砖：上面露天 → 半砖那格 15；下面被半砖的底面封住，只能从侧面照到
  const s4 = new Array(27).fill(null); s4[13] = slabMasks;
  const r4 = L.compute({ W: 3, H: 3, L: 3, damp: new Uint8Array(27), shape: s4, emit: new Uint8Array(27) }, { floor: true });
  ok(r4.sky[13] === 15 && r4.sky[4] === 14, '传播：底半砖那格 15，正下面 14（从旁边来）', [r4.sky[13], r4.sky[4]]);
}

// ---- 打包、平滑、光照图 ----
{
  ok(L.pack(15, 15) === 15728880 && L.FULL === 15728880, '打包：满亮 = 15728880（同 MC）');
  ok((L.smoothBlend(L.pack(0, 15), L.pack(0, 0), L.pack(0, 15), L.pack(0, 14)) >>> 16) === 232, 'smoothBlend：邻居是 0 的那份用中心补（15+14+15+14）×16/4 = 232');
  ok((L.smoothBlend(L.pack(0, 0), L.pack(0, 0), L.pack(0, 0), L.pack(0, 2)) >>> 16) === 8, 'smoothBlend：中心不亮（≤2）就不补');
  ok(L.smoothWeightedBlend(L.pack(4, 8) & 0xFF00FF, 0, 0, 0, 0.5, 0, 0, 0) === ((32 & 0xFF) | (64 << 16)), 'smoothWeightedBlend：按权重取整');
  const lm = L.noonLightmap(), at = (s, b, k) => lm[(s * 16 + b) * 3 + k];
  ok(at(15, 0, 0) === 1 && near(at(14, 0, 0), 0.910) && near(at(0, 0, 0), 0.094), '光照图：天光 15 → 1，14 → 0.91，全黑 → 0.094', [at(15, 0, 0), at(14, 0, 0), at(0, 0, 0)]);
  ok(at(0, 12, 0) > at(0, 12, 2) + 0.05, '光照图：方块光偏暖（红 > 蓝）', [at(0, 12, 0), at(0, 12, 2)]);
  const out = new Float32Array(3);
  L.sample(lm, (232 << 16), out);
  ok(near(out[0], (at(14, 0, 0) + at(15, 0, 0)) / 2), '光照图采样：天光 232 = 14 和 15 中间', out[0]);
}

// ---- 16-mcmesh 用光照上色（没 jar，走兜底颜色）----
const room = (torch) => {
  const W = 7, H = 5, Ln = 7, cells = [];
  for (let y = 0; y < H; y++) for (let z = 0; z < Ln; z++) for (let x = 0; x < W; x++) {
    const wall = y === 0 || (x >= 1 && x <= 5 && z >= 1 && z <= 5 && (x === 1 || x === 5 || z === 1 || z === 5 || y === 4));
    cells.push(wall ? 1 : (torch && x === 3 && y === 1 && z === 3) ? 2 : 0);
  }
  return { size: [W, H, Ln], palette: ['minecraft:air', 'minecraft:stone', 'minecraft:torch'], cells };
};
// 找出房子里地面（y=1 平面，x、z 在 2..5）朝上的面，返回每个顶点的颜色
const floorColors = (res) => {
  const Ly = res.layers.solid, out = [];
  for (let q = 0; q < Ly.quads; q++) {
    let inside = true;
    for (let v = 0; v < 4; v++) {
      const i = (q * 4 + v) * 3, X = Ly.position[i], Y = Ly.position[i + 1], Z = Ly.position[i + 2];
      if (Math.abs(Y - 1) > 1e-6 || X < 2 - 1e-6 || X > 5 + 1e-6 || Z < 2 - 1e-6 || Z > 5 + 1e-6) inside = false;
    }
    if (inside) for (let v = 0; v < 4; v++) { const i = (q * 4 + v) * 3; out.push([Ly.color[i], Ly.color[i + 1], Ly.color[i + 2]]); }
  }
  return out;
};
{
  const lit = await S.build(room(true), {});
  const dark = await S.build(room(false), {});
  const off = await S.build(room(true), { light: false });
  const offDark = await S.build(room(false), { light: false });
  const cl = floorColors(lit), cd = floorColors(dark), co = floorColors(off), cod = floorColors(offDark);
  ok(cl.length === 36 && cd.length === 36 && co.length === 36, '房子里的地面 9 个面', [cl.length, cd.length, co.length]);
  // 和 light:false（同样的面、同样的顺序）相除 = 光照图的值
  const ratio = (a, b, k) => a.reduce((s, c, i) => s + c[k] / b[i][k], 0) / a.length;
  ok(near(ratio(cd, cod, 0), 0.094, 0.002) && near(ratio(cd, cod, 2), 0.094, 0.002), '封闭的黑屋子：只剩环境光（光照图 0.094）、是灰的', [ratio(cd, cod, 0), ratio(cd, cod, 2)]);
  ok(ratio(cl, co, 0) > 0.8 && ratio(cl, co, 0) > ratio(cl, co, 2) + 0.05, '有火把：地面亮起来、偏暖', [ratio(cl, co, 0), ratio(cl, co, 2)]);
  ok(co.every((c) => near(c[0], c[2], 1e-6)) === cod.every((c) => near(c[0], c[2], 1e-6)), 'light:false：不算光照，有没有火把颜色一样');
  ok(lit.stats.light && lit.stats.light.lit === 1 && typeof lit.stats.lightMs === 'number', 'stats.light：1 个发光格子');
  // 屋外露天的地面顶上：和 light:false 一样（光照图 = 1）
  const Ly = lit.layers.solid, Lo = off.layers.solid;
  let same = 0, tot = 0;
  for (let q = 0; q < Ly.quads; q++) {
    const i = q * 12;
    if (![1, 4, 7, 10].every((k) => Math.abs(Ly.position[i + k] - 1) < 1e-6) || Ly.position[i] < 6 - 1e-6) continue;
    tot++;
    if ([0, 1, 2].every((k) => near(Ly.color[i + k], Lo.color[i + k], 1e-6))) same++;
  }
  ok(tot > 0 && same === tot, '露天的地面顶上：光照图 = 1，颜色不变', [same, tot]);
}
{
  // 不用 AO 的平面光：没有 AO 时有 cullface 的面取那一侧的光
  const lit = await S.build(room(true), { ao: false });
  const cl = floorColors(lit);
  ok(cl.length === 36 && cl.every((c) => c[0] > c[2]), 'ao:false：房子里的地面也按光照上色（偏暖）', cl.length);
  // 中间那格（火把正下方）最亮
  const mx = Math.max(...cl.map((c) => c[0])), mn = Math.min(...cl.map((c) => c[0]));
  ok(mx > mn, 'ao:false：离火把近的面更亮', [mx, mn]);
}

console.log('mc-light: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
