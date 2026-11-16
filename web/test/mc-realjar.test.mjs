// test/mc-realjar.test.mjs — 用玩家自己的 MC 客户端 jar 跑一遍（jar 不进 git，测试里也不写死路径）
//   MC_JAR=<客户端 jar> node test/mc-realjar.test.mjs      或      node test/mc-realjar.test.mjs <客户端 jar>
// 找不到 jar 就打印 SKIP，正常退出。
import fs from 'node:fs';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const jarPath = process.argv[2] || process.env.MC_JAR;
if (!jarPath || !fs.existsSync(jarPath)) {
  console.log('SKIP mc-realjar：没有 jar（设置环境变量 MC_JAR=<客户端 jar>，或把路径作为参数）');
  process.exit(0);
}
const { V3 } = loadV3(['14-mcjar', '15-mcmodel', '16-mcmesh', '17-mcfallback', '19-mcentity', '19-mclight']);
const J = V3.mcjar, M = V3.mcmodel, S = V3.mcmesh;
let pass = 0, fail = 0;
function ok(cond, what, got) {
  if (cond) { pass++; console.log('PASS', what); } else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); }
}

let t = Date.now();
const pack = await J.fromBytes(new Uint8Array(fs.readFileSync(jarPath)));
console.log('jar', JSON.stringify(pack.version), JSON.stringify(pack.counts), (Date.now() - t) + ' ms');
ok(pack.counts.blockstates > 1000 && pack.counts.models > 2000 && pack.counts.textures > 1000 && pack.counts.colormap >= 2, '读到方块状态、模型、贴图、colormap', pack.counts);
ok(!!pack.version.id && !!pack.key, 'jar 版本（缓存 key）', pack.key);

// 每个 blockstate 文件的每个 variant / multipart 部件都能解析、烘焙，贴图都找得到
const R = M.createResolver(pack);
const names = [...pack.files.keys()].filter((k) => /^assets\/minecraft\/blockstates\/[^/]+\.json$/.test(k)).map((k) => k.slice(29, -5)).sort();
let parts = 0, quads = 0;
const noTex = new Set(), slots = [];
t = Date.now();
for (const name of names) {
  const bs = pack.blockstate(name);
  const vs = [];
  if (bs && bs.variants) for (const [key, v] of Object.entries(bs.variants)) { vs.push(...M.variantList(v)); slots.push('minecraft:' + name + (key ? '[' + key + ']' : '')); }
  if (bs && bs.multipart) { for (const p of bs.multipart) vs.push(...M.variantList(p.apply)); slots.push('minecraft:' + name); }
  for (const v of vs) {
    parts++;
    for (const q of R.bake(v).quads) { quads++; if (!pack.hasTexture(q.sprite)) noTex.add(q.sprite); }
  }
}
console.log(`blockstates ${names.length}, parts ${parts}, quads ${quads}, ${Date.now() - t} ms`);
ok(names.length === pack.counts.blockstates && parts > 7000 && quads > 50000, '全部 blockstate 都解析、烘焙了', [names.length, parts, quads]);
ok(noTex.size === 0, '烘焙出来的面都找得到贴图', [...noTex].slice(0, 10));
ok(R.warnings.length === 0 && R.errors.length === 0 && pack.errors.length === 0, '没有警告和错误', [R.warnings.slice(0, 5), R.errors.slice(0, 5), pack.errors.slice(0, 5)]);

// 几个有代表性的状态
const blk = (s, pos = [0, 0, 0]) => R.block(s, pos);
ok(blk('minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]').quads.length >= 10, '楼梯（倒挂、朝东）');
ok(blk('minecraft:oak_fence[east=true,north=true,south=false,waterlogged=false,west=false]').parts.length === 3, '栅栏 multipart：柱子 + 两边');
ok(blk('minecraft:chest[facing=north,type=single,waterlogged=false]').status === 'empty', '箱子没有 JSON 模型（方块实体）');
ok(blk('minecraft:oak_log[axis=x]').parts[0].variant.x === 90, '原木横放：x=90');

// 分层（26.1 的玻璃模型写了 force_translucent，所以玻璃在半透明层）
const one = (s) => ({ size: [1, 1, 1], palette: ['minecraft:air', s], cells: [1] });
const layerOf = async (s) => {
  const r = await S.build(one(s), { pack, mipmaps: false });
  return ['solid', 'cutout', 'translucent'].filter((k) => r.layers[k].quads > 0).join('+');
};
// 26.1 的火把（template_torch）是一个 2×10×2 的小盒子，UV 只取贴图里不透明的那一条 → 和石头一样在实心层
const want = { 'minecraft:stone': 'solid', 'minecraft:glass': 'translucent', 'minecraft:ice': 'translucent', 'minecraft:water[level=0]': 'translucent',
  'minecraft:oak_leaves[distance=7,persistent=false,waterlogged=false]': 'cutout', 'minecraft:torch': 'solid', 'minecraft:short_grass': 'cutout' };
const got = {};
for (const s of Object.keys(want)) got[s] = await layerOf(s);
ok(Object.keys(want).every((s) => got[s] === want[s]), '按贴图和 force_translucent 分层', got);
console.log('redstone_wire 层：', await layerOf('minecraft:redstone_wire[east=none,north=none,power=0,south=none,west=none]'));
const env = await S.environment(pack);
ok(env.from === 'jar' && env.grass[1] > env.grass[0] && env.grass[1] > env.grass[2] && env.foliage[1] > env.foliage[2], '草色、树叶色从 jar 的 colormap 取（平原）', env);

// 所有方块状态排成一大片（隔一格放，免得互相剔除），整片建网格：不应该有兜底、不应该报错
const side = Math.ceil(Math.sqrt(slots.length)), W = side * 2, L = side * 2;
const cells = new Array(W * L).fill(0);
slots.forEach((s, i) => { cells[(i % side) * 2 + Math.floor(i / side) * 2 * W] = i + 1; });
t = Date.now();
const big = await S.build({ size: [W, 1, L], palette: ['minecraft:air', ...slots], cells }, { pack, mipmaps: true });
const ms = Date.now() - t;
console.log(`全部状态 ${slots.length} 个，${W}×${L}：${ms} ms，quads ${JSON.stringify(big.stats.quads)}，图集 ${big.atlas.width}×${big.atlas.height}，方块实体 ${big.stats.specials.length} 种，警告 ${big.warnings.length}`);
ok(big.stats.fallback === 0 && big.stats.missingStates.length === 0 && big.stats.missingSprites.length === 0, '整片：没有兜底、没有缺贴图', [big.stats.fallback, big.stats.missingStates.slice(0, 5), big.stats.missingSprites.slice(0, 5)]);
ok(big.stats.quads.solid > 30000 && big.stats.quads.cutout > 2000 && big.stats.quads.translucent > 300 && big.stats.specials.length > 30, '整片：几层都有东西，方块实体种类多', [big.stats.quads, big.stats.specials.length]);
// 箱子（普通、陷阱、末影、各种铜箱子）和 16 色的床读 textures/entity/… 画真模型，别的方块实体还是盒子
// （整片里每种方块状态文件的每个 variant 只放一个；26.1 的箱子、床的方块状态只有 "" 一个 variant）
const entSlots = slots.filter((s) => V3.mcentity.spec(V3.mcmodel.parseState(s)));
ok(pack.counts.entity >= 30 && entSlots.length >= 27 && big.stats.entityModels === entSlots.length && big.stats.quads.entity >= entSlots.length * 15, '整片：箱子和床全部用 jar 里的实体贴图画真模型（一个都没退回盒子）', [pack.counts.entity, entSlots.length, big.stats.entityModels, big.stats.quads.entity]);
ok(ms < 20000, '整片建网格不太慢（< 20 秒）', ms);
console.log(`mc-realjar: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
