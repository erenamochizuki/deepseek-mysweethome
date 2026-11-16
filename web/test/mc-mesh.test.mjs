// test/mc-mesh.test.mjs — 14-mcjar.js + 16-mcmesh.js + 17-mcfallback.js 的单元测试
//   node test/mc-mesh.test.mjs
// 用 tools/mc-testjar.mjs 现造的小 jar（几张纯色贴图 + 我们手写的模型），不需要 MC 的 jar。
// 读 jar 走 DecompressionStream（和浏览器同一条路）。
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { makeZip } from '../tools/mc-lib.mjs';
import { testJarEntries, TEST_COLORS } from '../tools/mc-testjar.mjs';

const { V3 } = loadV3(['14-mcjar', '15-mcmodel', '16-mcmesh', '17-mcfallback']);
const J = V3.mcjar, S = V3.mcmesh, F = V3.mcfallback;
let pass = 0, fail = 0;
function ok(cond, what, got) {
  if (cond) { pass++; console.log('PASS', what); } else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); }
}
const near = (a, b, e = 1e-3) => Math.abs(a - b) < e;

// 一层里的每个 quad：{p:[[x,y,z]×4], c:[[r,g,b]×4]}
function quadsOf(layer) {
  const out = [];
  for (let k = 0; k < layer.quads; k++) {
    const p = [], c = [];
    for (let i = 0; i < 4; i++) {
      const v = (k * 4 + i) * 3;
      p.push([layer.position[v], layer.position[v + 1], layer.position[v + 2]]);
      c.push([layer.color[v], layer.color[v + 1], layer.color[v + 2]]);
    }
    out.push({ p, c });
  }
  return out;
}
// 落在 axis=value 平面上的 quad
const onPlane = (qs, axis, value) => qs.filter((q) => q.p.every((v) => near(v[axis], value)));

// ---- 读 jar ----
const entries = testJarEntries();
const extra = [['assets/minecraft/textures/entity/creeper.png', Buffer.from('x')], ['assets/minecraft/lang/en_us.json', '{}'], ['net/minecraft/Foo.class', Buffer.from('x')]];
const jarBytes = new Uint8Array(makeZip([...entries, ...extra]));
const pack = await J.fromBytes(jarBytes);
{
  ok(J.listZip(jarBytes).length === entries.length + extra.length, 'listZip 列出全部条目', J.listZip(jarBytes).length);
  ok(pack.counts.blockstates === 7 && pack.counts.models === 12 && pack.counts.textures === 9 && pack.counts.mcmeta === 1 && pack.counts.colormap === 2, '只取需要的目录（blockstates/models/textures/block/colormap）', pack.counts);
  ok(!pack.has('assets/minecraft/textures/entity/creeper.png') && !pack.has('assets/minecraft/lang/en_us.json') && !pack.has('net/minecraft/Foo.class'), '别的文件不读');
  ok(pack.version.id === 'test-1' && pack.key.startsWith('v' + J.CACHE_VER + '|test-1|2026-01-01'), 'version.json → 缓存用的版本 key', pack.key);
  let threw = false;
  try { await J.fromBytes(new Uint8Array(makeZip([['hello.txt', 'hi']]))); } catch (e) { threw = /没有方块模型/.test(e.message); }
  ok(threw, '不是 MC jar：给出中文提示');
  const back = J.deserialize(J.serialize(pack));
  ok(back.key === pack.key && back.counts.models === 12 && back.blockstate('stone').variants, '缓存的序列化来回一致');
  ok(J.cacheUsable(J.serialize(pack)) && !J.cacheUsable(Object.assign(J.serialize(pack), { key: 'v1|test-1|x|1' })) && !J.cacheUsable(null), '旧版本缓存不用（要重新选 jar）');
  ok(pack.has('data/minecraft/dimension_type/overworld.json') && pack.dimension('overworld').attributes, '读主世界维度文件（雾色、天空色）');
}

// ---- 贴图 ----
{
  const sp = await pack.sprite('minecraft:block/stone');
  ok(sp && sp.w === 16 && sp.h === 16 && sp.data[0] === TEST_COLORS.stone[0] && sp.data[3] === 255, 'PNG 解码：stone 16×16 灰色', sp && [sp.w, sp.h, sp.data[0], sp.data[3]]);
  const w = await pack.sprite('minecraft:block/water_still');
  ok(w && w.meta && w.meta.animation, '.mcmeta 一起读到', w && w.meta);
  const lv = await pack.sprite('minecraft:block/leaves'), gl = await pack.sprite('minecraft:block/glass');
  ok(J.spriteTransparency(sp, 0, 0, 1, 1) === 'solid' && J.spriteTransparency(lv, 0, 0, 1, 1) === 'cutout' && J.spriteTransparency(w, 0, 0, 1, 1) === 'translucent', '按贴图透明度分层：实心 / 镂空 / 半透明');
  ok(J.spriteTransparency(gl, 0, 0, 1 / 16, 1) === 'solid' && J.spriteTransparency(gl, 0, 0, 1, 1) === 'cutout', '只看面用到的那块 UV（玻璃边框是实心的）');
  const env = await S.environment(pack);
  const g = TEST_COLORS.grassMap, f = TEST_COLORS.foliageMap;
  ok(env.from === 'jar' && near(env.grass[0], g[0] / 255) && near(env.grass[1], g[1] / 255) && near(env.foliage[1], f[1] / 255) && near(env.water[2], 0xcc / 255), '草/树叶颜色从 jar 的 colormap 取，水色从平原群系取', env);
  // 雾：测试 jar 里雾色 #ff8000、群系天空色 #2040ff（盖过维度的 #000000）、环境雾终点 50。
  // 渲染距离 8：天空混合比例 1 − (0.25 + 0.75 × 8/32)^0.25 ≈ 0.1867，按 0–255 整数插值 → (213,116,47)
  const fog = env.fog, c255 = fog && fog.color.map((v) => Math.round(v * 255));
  ok(fog && c255.join(',') === '213,116,47' && fog.start === 0 && fog.end === 50 && near(fog.rdStart, 115.2) && fog.rdEnd === 128, '雾色、雾的距离从 jar 的维度和群系文件算', fog);
  const f2 = S.fogFrom(pack.dimension('overworld'), pack.biome('plains'), 2);
  ok(f2.rdStart === 28 && f2.rdEnd === 32 && Math.round(f2.color[0] * 255) < 213, '渲染距离 2：雾从 28 格开始，天空色混得更多', f2);
  ok(S.fogFrom(null, {}) === null && (await S.environment(null)).fog === undefined, '没有雾色、天空色（或没有 jar）就不加雾');
}

// ---- 网格：剔除 / 分层 / 明暗 ----
const mc = (s) => (s.includes(':') ? s : 'minecraft:' + s);
const model = (size, palette, cells) => ({ size, palette: palette.map(mc), cells });
const build = (m, o = {}) => S.build(m, { pack, mipmaps: false, ...o });
const SLAB_B = 'oak_slab[type=bottom,waterlogged=false]', SLAB_T = 'oak_slab[type=top,waterlogged=false]';
{
  const r = await build(model([2, 1, 1], ['air', 'stone'], [1, 1]));
  ok(r.layers.solid.quads === 10 && r.stats.culled === 2, '两块石头相邻：中间两个面剔掉', [r.layers.solid.quads, r.stats.culled]);
  const r3 = await build(model([3, 3, 3], ['air', 'stone'], new Array(27).fill(1)));
  ok(r3.layers.solid.quads === 54, '3×3×3 的石头只剩外表面 54 个面', r3.layers.solid.quads);
  const sg = await build(model([2, 1, 1], ['air', 'stone', 'glass'], [1, 2]));
  ok(sg.layers.solid.quads === 6 && sg.layers.cutout.quads + sg.layers.translucent.quads === 5, '石头挨玻璃：石头的面照画（玻璃不挡），玻璃贴石头的面剔掉', sg.stats.quads);
  const gg = await build(model([2, 1, 1], ['air', 'glass'], [1, 1]));
  ok(gg.layers.cutout.quads + gg.layers.translucent.quads === 10, '玻璃挨玻璃：中间的面不画（同种方块）', gg.stats.quads);
  const ll = await build(model([2, 1, 1], ['air', 'oak_leaves'], [1, 1]));
  ok(ll.layers.cutout.quads === 12, '树叶挨树叶：都画（cutoutLeaves 开着时 MC 也不剔）', ll.stats.quads);
  const ss = await build(model([1, 2, 1], ['air', 'stone', SLAB_B], [1, 2]));
  ok(ss.layers.solid.quads === 10, '石头上放下半砖：贴着的两个面剔掉', ss.stats.quads);
  const bb = await build(model([2, 1, 1], ['air', SLAB_B], [1, 1]));
  ok(bb.layers.solid.quads === 10, '两个下半砖并排：半高的侧面互相挡住', bb.stats.quads);
  const bt = await build(model([2, 1, 1], ['air', SLAB_B, SLAB_T], [1, 2]));
  ok(bt.layers.solid.quads === 12, '下半砖挨上半砖：侧面对不上，都画', bt.stats.quads);
  const fz = (p) => build(model([1, 1, 1], ['air', 'oak_fence[' + p + ',waterlogged=false]'], [1]));
  const f0 = await fz('east=false,north=false,south=false'), f2 = await fz('east=false,north=true,south=false');
  ok(f0.layers.solid.quads === 6 && f2.layers.solid.quads === 12, 'multipart：栅栏柱子 + 连接的那一边', [f0.layers.solid.quads, f2.layers.solid.quads]);
}
{
  const one = await build(model([1, 1, 1], ['air', 'stone'], [1]));
  const qs = quadsOf(one.layers.solid);
  const sh = (axis, v) => onPlane(qs, axis, v)[0].c[0][0];
  const got = [sh(1, 1), sh(1, 0), sh(2, 0), sh(2, 1), sh(0, 0), sh(0, 1)];
  ok([1, 0.5, 0.8, 0.8, 0.6, 0.6].every((v, i) => near(got[i], v)), '朝向明暗：上 1、下 0.5、南北 0.8、东西 0.6', got);
  const gb = await build(model([1, 1, 1], ['air', 'grass_block[snowy=false]'], [1]));
  const gq = quadsOf(gb.layers.solid), top = onPlane(gq, 1, 1)[0], side = onPlane(gq, 2, 0)[0];
  const g = TEST_COLORS.grassMap;
  ok(top.c.every((c) => near(c[0], g[0] / 255) && near(c[1], g[1] / 255) && near(c[2], g[2] / 255)) && side.c.every((c) => near(c[0], 0.8) && near(c[1], 0.8)), '草方块：顶面染草色（tintindex 0），侧面不染', [top.c[0], side.c[0]]);
}
{
  // (0,0,0) 和 (1,1,0) 两块石头：下面那块的顶面，靠近 x=1 的两个角被斜上方的方块压暗
  const m = model([2, 2, 1], ['air', 'stone'], [1, 0, 0, 1]);
  const topOf = (res) => onPlane(quadsOf(res.layers.solid), 1, 1).find((q) => q.p.every((v) => v[0] <= 1 + 1e-6));
  const t1 = topOf(await build(m)), t0 = topOf(await build(m, { ao: false }));
  const at = (t, x) => t.p.map((v, i) => [v[0], t.c[i][0]]).filter(([vx]) => near(vx, x)).map(([, c]) => c);
  ok(Math.max(...at(t1, 1)) < Math.min(...at(t1, 0)) - 0.05 && near(Math.max(...at(t1, 0)), 1), '平滑光照：靠近旁边方块的角更暗', [at(t1, 0), at(t1, 1)]);
  ok(t0.c.every((c) => near(c[0], 1)), '关掉平滑光照：四个角一样亮', t0.c);
}
{
  const w1 = await build(model([1, 1, 1], ['air', 'water[level=0]'], [1]));
  const wq = quadsOf(w1.layers.translucent), wt = onPlane(wq, 1, 8 / 9);
  ok(wq.length === 6 && wt.length === 1 && near(wt[0].c[0][2], 0xcc / 255), '一格水：6 个面，水面高 8/9，颜色是群系水色', [wq.length, wt.length, wt[0] && wt[0].c[0]]);
  const w2 = await build(model([1, 2, 1], ['air', 'water[level=0]'], [1, 1]));
  const wq2 = quadsOf(w2.layers.translucent);
  ok(wq2.length === 10 && onPlane(wq2, 1, 1 + 8 / 9).length === 1 && onPlane(wq2, 1, 1).length === 0, '两格水叠着：中间不画，只有最上面有水面', wq2.length);
  // 含水方块：方块自己的模型 + 一层水（平顶 8/9）；挨着水、自己完整的那面不画水
  const SW = 'oak_slab[type=bottom,waterlogged=true]';
  const fo = (s) => S.fluidOf(V3.mcmodel.parseState(s));
  ok(fo('minecraft:' + SW) === 'water' && fo('minecraft:seagrass') === 'water' && fo('minecraft:kelp_plant') === 'water' && fo('minecraft:bubble_column[drag=true]') === 'water'
    && fo('minecraft:lava[level=0]') === 'lava' && fo('minecraft:' + SLAB_B) === null && fo('minecraft:stone') === null && fo('mymod:pipe[waterlogged=true]') === 'water', '哪些格子泡着水：含水方块、海草、海带、气泡柱');
  const ws = await build(model([1, 1, 1], ['air', SW], [1]));
  const wsq = quadsOf(ws.layers.translucent);
  ok(ws.stats.waterlogged === 1 && wsq.length === 5 && onPlane(wsq, 1, 8 / 9).length === 1 && onPlane(wsq, 1, 0).length === 0 && ws.layers.solid.quads === 6,
    '含水的底半砖：半砖 6 个面 + 水 5 个面（底下被半砖自己挡住）', [ws.stats.waterlogged, wsq.length, ws.layers.solid.quads]);
  const dry = await build(model([1, 1, 1], ['air', SLAB_B], [1]));
  ok(dry.stats.waterlogged === 0 && dry.layers.translucent.quads === 0, '不含水的半砖没有水');
  const wn = await build(model([2, 1, 1], ['air', SW, 'water[level=0]'], [1, 2]));
  const wnq = quadsOf(wn.layers.translucent);
  ok(wnq.length === 9 && onPlane(wnq, 0, 1).length === 0, '含水方块挨着水：中间那面两边都不画', wnq.length);
  const wu = await build(model([1, 2, 1], ['air', SW, 'water[level=0]'], [1, 2]));
  const wuq = quadsOf(wu.layers.translucent);
  ok(wuq.length === 9 && onPlane(wuq, 1, 1).length === 0 && wuq.some((q) => q.p.every((v) => near(v[2], 0)) && q.p.some((v) => near(v[1], 1))), '上面还有水：含水方块里的水满一格，中间不画', wuq.length);
  const wf = await S.build(model([1, 1, 1], ['air', SW], [1]), { mipmaps: false });
  ok(wf.stats.waterlogged === 1 && wf.layers.translucent.quads === 5, '没 jar 也画含水方块里的水（兜底颜色）', [wf.stats.waterlogged, wf.layers.translucent.quads]);
  const o2 = S.plantOffset(2, 0, 0, 'short_grass'), o1 = S.plantOffset(1, 0, 0, 'poppy');
  ok(near(o2[0], -0.25) && near(o2[1], -0.2) && near(o2[2], -0.25) && near(o1[1], 0), '花草的随机偏移（位置 0,0 → −0.25, −0.2, −0.25）', [o1, o2]);
}
{
  const np = await S.build(model([4, 1, 1], ['air', 'stone', 'glass', 'oak_leaves[distance=7,persistent=false,waterlogged=false]', 'mymod:thing'], [1, 2, 3, 4]), { mipmaps: false });
  ok(np.stats.fallback === 4 && np.layers.solid.quads > 0, '没有 jar：全部按名字兜底画出来', np.stats);
  const P = V3.mcmodel.parseState, fs = F.colorOf(P('minecraft:stone')).color, fl = F.colorOf(P('minecraft:oak_leaves')).color;
  ok(Math.abs(fs[0] - fs[1]) < 0.08 && Math.abs(fs[1] - fs[2]) < 0.08 && fl[1] > fl[0] && fl[1] > fl[2], '兜底颜色：石头偏灰，树叶偏绿', [fs, fl]);
  ok(F.colorOf(P('mymod:thing')).cat === 'mod', '别的模组的方块：统一用模组色');
  const pack2 = await J.fromBytes(new Uint8Array(makeZip([...entries,
    ['assets/minecraft/blockstates/chest.json', { variants: { '': { model: 'minecraft:block/chest' } } }],
    ['assets/minecraft/models/block/chest.json', { textures: { particle: 'minecraft:block/planks' } }]])));
  const ch = await S.build(model([1, 1, 1], ['air', 'chest[facing=north,type=single,waterlogged=false]'], [1]), { pack: pack2, mipmaps: false });
  ok(ch.stats.specials.includes('chest') && ch.stats.fallback === 0 && ch.layers.solid.quads >= 6, '箱子（方块实体，模型没有 elements）：画成盒子', ch.stats);
}
{
  const rle = await build({ size: [3, 1, 1], palette: ['minecraft:air', 'minecraft:stone'], cells: [[2, 1], [1, 0]] });
  ok(rle.layers.solid.quads === 10, 'dump 的游程格子 [[个数, 编号]…]', rle.layers.solid.quads);
  const pr = await build({ origin: [10, -61, 5], size: [2, 1, 1], palette: ['minecraft:stone'], blocks: [0, 0] });
  ok(pr.layers.solid.quads === 10 && pr.origin.join() === '10,-61,5', '探针 /region 的格式（origin + blocks）', [pr.layers.solid.quads, pr.origin]);
  const at = (await build(model([3, 1, 1], ['air', 'stone', 'grass_block[snowy=false]', 'oak_planks'], [1, 2, 3]), { mipmaps: true })).atlas;
  const pow2 = (n) => n > 0 && (n & (n - 1)) === 0, rs = [...at.rects.values()];
  const overlap = rs.some((a, i) => rs.some((b, j) => j > i && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]));
  ok(pow2(at.width) && pow2(at.height) && !overlap && rs.every((q) => q[0] % 16 === 0 && q[1] % 16 === 0), '图集：2 的幂、16 像素对齐、不重叠', [at.width, at.height, rs]);
  ok(at.levels.length === Math.log2(Math.max(at.width, at.height)) + 1 && at.levels[0].length === at.width * at.height * 4, '图集带完整的 mipmap 链', at.levels.length);
}
// 图集的边：两张纯色贴图紧挨着放，每张四周的边、每一级 mipmap 里都只能是自己的颜色（线性采样不会混到隔壁）
{
  const solid = (id, c) => ({ id, w: 16, h: 16, data: new Uint8Array(16 * 16 * 4).map((_, i) => c[i % 4]) });
  const A = [250, 10, 10, 255], B = [10, 10, 250, 255];
  const at = S.packAtlas([solid('a', A), solid('b', B)], { mipmaps: true });
  let bad = 0;
  for (const [id, c] of [['a', A], ['b', B]]) {
    const [x, y, w, h] = at.rects.get(id);
    for (let k = 0; k <= S.ATLAS_SPRITE_MIPS; k++) {
      const LW = Math.max(1, at.width >> k), d = at.levels[k];
      const x0 = (x - at.pad) >> k, y0 = (y - at.pad) >> k, x1 = (x + w + at.pad) >> k, y1 = (y + h + at.pad) >> k;
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
        const q = (py * LW + px) * 4;
        if (d[q] !== c[0] || d[q + 2] !== c[2] || d[q + 3] !== 255) bad++;
      }
    }
  }
  ok(at.pad === 16 && bad === 0, '图集：每张贴图四周留 16 像素的边，前 4 级 mipmap 里边也只有自己的颜色', { pad: at.pad, bad });
}
// 世界坐标：鲸图 = Metadata.Xiaojingyu.Origin + Offset；没有 Origin 当在 Offset；探针 /region 用 origin
{
  const meta = { compound: { Xiaojingyu: { compound: { Origin: { intArray: Int32Array.of(100, 64, -20) }, Facing: { string: 'south' } } } } };
  const base = { size: [1, 1, 1], palette: ['minecraft:stone'], cells: [0] };
  const a = S.worldOrigin({ ...base, offset: [-2, 0, -3], meta });
  const b = S.worldOrigin({ ...base, offset: [-2, 0, -3], meta: null });
  const c = S.worldOrigin({ ...base, origin: [5, -60, 7] });
  const d = S.normalize({ ...base, offset: Int32Array.of(1, 2, 3), meta }).origin;
  ok(JSON.stringify([a, b, c, d]) === JSON.stringify([[98, 64, -23], [-2, 0, -3], [5, -60, 7], [101, 66, -17]]), '世界坐标：Origin + Offset；没有 Origin 用 Offset；探针用 origin', [a, b, c, d]);
  ok(JSON.stringify(S.normalize(base).origin) === '[0,0,0]', '什么都没有：第 (0,0,0) 格当在世界原点');
}
// 提示只给这次的：同一个 jar 先后建两个模型，第二个没缺东西就没有提示
{
  const r1 = await S.build({ size: [1, 1, 1], palette: ['minecraft:foo_bar'], cells: [0] }, { pack });
  const r2 = await S.build({ size: [1, 1, 1], palette: ['minecraft:stone'], cells: [0] }, { pack });
  const r3 = await S.build({ size: [1, 1, 1], palette: ['minecraft:foo_bar'], cells: [0] }, { pack });
  ok(r1.warnings.some((w) => /foo_bar/.test(w)) && r2.warnings.length === 0 && r3.warnings.some((w) => /foo_bar/.test(w)), '提示只给这次建的模型，缺模型的每次都列', [r1.warnings, r2.warnings, r3.warnings]);
}
// Original fallback textures must survive atlas baking and never replace a valid resource-pack model.
{
  const P = V3.mcmodel.parseState;
  const names = ['planks', 'grain', 'rings', 'door_upper', 'door_lower', 'metal', 'lantern', 'soul_lantern'];
  for (const name of names) {
    const sp = F.sprite('v3:fallback/' + name);
    ok(sp.w === 16 && sp.h === 16 && sp.data.length === 1024 && new Set(sp.data).size > 8,
      '原创像素纹理有细节：' + name);
  }
  ok(!F.sprite('minecraft:block/oak_planks'), '原创纹理不冒充 MC 资源');
  const lamp = F.block(P('minecraft:lantern[hanging=false]'));
  ok(lamp.quads.length >= 36 && lamp.quads.some(q => q.sprite === 'v3:fallback/metal') && lamp.quads.some(q => q.sprite === 'v3:fallback/lantern'), '灯笼分出灯体、铁框、提环');
  ok(F.block(P('minecraft:copper_lantern')).quads.length >= 36 && F.block(P('minecraft:sea_lantern')).quads.length === 6, '铜灯笼保持灯形、海晶灯仍是整方块');
  const sp = F.sprite('v3:fallback/lantern');
  ok(sp.data[0] < 50 && sp.data[(4 * 16 + 4) * 4] > 220, '灯笼框架深色、灯芯暖色，不是整块白色');
  for (const facing of ['north', 'east', 'south', 'west']) for (const open of ['true', 'false']) for (const half of ['upper', 'lower']) {
    const door = F.block(P(`minecraft:oak_door[facing=${facing},open=${open},half=${half},hinge=left]`));
    const panels = door.quads.filter(q => q.sprite === 'v3:fallback/door_' + half);
    ok(panels.length === 2 && panels.every(q => q.uv.every(v => v >= 0 && v <= 1)), `门板上下纹理和开关朝向：${facing}/${open}/${half}`);
  }
  const np = await S.build(model([3, 1, 1], ['air', 'oak_planks', 'lantern[hanging=true]', 'oak_door[half=lower,facing=north,open=false,hinge=left]'], [1, 2, 3]), { mipmaps: false });
  ok(np.stats.missingSprites.length === 0 && np.atlas.rects.has('v3:fallback/planks') && np.atlas.rects.has('v3:fallback/door_lower'), '无 jar：原创木板、门、灯笼进入图集，无缺图');
  const ownPack = await J.fromBytes(new Uint8Array(makeZip([...entries,
    ['assets/minecraft/blockstates/oak_planks.json', { variants: { '': { model: 'minecraft:block/stone' } } }]])));
  const jarWood = await S.build(model([1, 1, 1], ['air', 'oak_planks'], [1]), { pack: ownPack, mipmaps: false });
  ok(jarWood.stats.fallback === 0 && !jarWood.atlas.rects.has('v3:fallback/planks'), '已有 jar 模型优先，不被自绘兜底替换');
}
console.log(`mc-mesh: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
