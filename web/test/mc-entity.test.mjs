// test/mc-entity.test.mjs — 19-mcentity.js（箱子、床的真模型）和它在 16-mcmesh.js 里怎么用
//   node test/mc-entity.test.mjs
// 用 tools/mc-testjar.mjs 现造的小 jar（自己画的 64×64 实体贴图），不需要 MC 的 jar。
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { makeZip } from '../tools/mc-lib.mjs';
import { testJarEntries, entityTestEntries, ENTITY_COLORS } from '../tools/mc-testjar.mjs';

const { V3 } = loadV3(['14-mcjar', '15-mcmodel', '16-mcmesh', '17-mcfallback', '19-mcentity', '19-mclight']);
const J = V3.mcjar, M = V3.mcmodel, S = V3.mcmesh, E = V3.mcentity;
let pass = 0, fail = 0;
function ok(cond, what, got) {
  if (cond) { pass++; console.log('PASS', what); } else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); }
}
const near = (a, b, e = 1e-3) => Math.abs(a - b) < e;
const st = (s) => M.parseState(s);
const ent = (s) => E.forState(st(s));
// 模型所有顶点的包围盒，单位 = 方块的 1/16
function box(quads) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const q of quads) for (let i = 0; i < 4; i++) for (let a = 0; a < 3; a++) {
    const v = q.pos[i * 3 + a] * 16; b[a] = Math.min(b[a], v); b[a + 3] = Math.max(b[a + 3], v);
  }
  return b.map((v) => Math.round(v * 1000) / 1000).join();
}
// 某个方向、贴在 axis = val/16 平面上的面有几个
const facesOn = (quads, dir, axis, val) => quads.filter((q) => q.dir === dir && [0, 1, 2, 3].every((i) => near(q.pos[i * 3 + axis] * 16, val))).length;

// ---- 贴图名字 ----
{
  const sp = (s) => { const f = E.spec(st(s)); return f ? f.sprite : null; };
  ok(sp('minecraft:chest[facing=north,type=single,waterlogged=false]') === 'minecraft:entity/chest/normal', '单箱子 → entity/chest/normal');
  ok(sp('minecraft:chest[facing=north,type=left,waterlogged=false]') === 'minecraft:entity/chest/normal_left', '大箱子左半 → normal_left');
  ok(sp('minecraft:trapped_chest[facing=north,type=right,waterlogged=false]') === 'minecraft:entity/chest/trapped_right', '陷阱箱右半 → trapped_right');
  ok(sp('minecraft:ender_chest[facing=north,waterlogged=false]') === 'minecraft:entity/chest/ender', '末影箱 → ender（总是单个）');
  ok(sp('minecraft:waxed_weathered_copper_chest[facing=north,type=single,waterlogged=false]') === 'minecraft:entity/chest/copper_weathered', '涂蜡的锈铜箱子 → copper_weathered（涂蜡不影响样子）');
  ok(sp('minecraft:light_blue_bed[facing=north,occupied=false,part=head]') === 'minecraft:entity/bed/light_blue', '床按颜色取贴图');
  ok(E.spec(st('minecraft:stone')) == null && E.spec(st('minecraft:oak_sign[rotation=0,waterlogged=false]')) == null, '别的方块（告示牌也是）不归这里管');
}

// ---- 另一半在哪 ----
{
  const pt = (s) => { const f = ent(s); return f && f.partner ? f.partner.join() : 'null'; };
  // MC ChestBlock.getConnectedDirection：type=left → 朝向顺时针转 90°，right → 逆时针
  ok(pt('minecraft:chest[facing=south,type=left,waterlogged=false]') === '-1,0', '朝南的大箱子左半：另一半在西边');
  ok(pt('minecraft:chest[facing=south,type=right,waterlogged=false]') === '1,0', '朝南的大箱子右半：另一半在东边');
  ok(pt('minecraft:chest[facing=north,type=left,waterlogged=false]') === '1,0', '朝北的左半：另一半在东边');
  ok(pt('minecraft:chest[facing=east,type=left,waterlogged=false]') === '0,1', '朝东的左半：另一半在南边');
  ok(pt('minecraft:chest[facing=north,type=single,waterlogged=false]') === 'null', '单箱子没有另一半');
  // 床：床头的另一半在朝向的反方向，床脚的在朝向那边
  ok(pt('minecraft:red_bed[facing=south,occupied=false,part=head]') === '0,-1', '朝南的床头：床脚在北边');
  ok(pt('minecraft:red_bed[facing=south,occupied=false,part=foot]') === '0,1', '朝南的床脚：床头在南边');
  ok(pt('minecraft:red_bed[facing=east,occupied=false,part=head]') === '-1,0', '朝东的床头：床脚在西边');
}

// ---- 形状和朝向 ----
{
  const b = (s) => box(ent(s).quads);
  ok(b('minecraft:chest[facing=south,type=single,waterlogged=false]') === '1,0,1,15,14,16', '单箱子朝南：宽 1..15、高 14，锁伸到 z=16', b('minecraft:chest[facing=south,type=single,waterlogged=false]'));
  ok(b('minecraft:chest[facing=north,type=single,waterlogged=false]') === '1,0,0,15,14,15', '朝北：锁在 z=0 那边', b('minecraft:chest[facing=north,type=single,waterlogged=false]'));
  ok(b('minecraft:chest[facing=east,type=single,waterlogged=false]') === '1,0,1,16,14,15', '朝东：锁在 x=16 那边', b('minecraft:chest[facing=east,type=single,waterlogged=false]'));
  ok(b('minecraft:ender_chest[facing=west,waterlogged=false]') === '0,0,1,15,14,15', '末影箱朝西：锁在 x=0 那边', b('minecraft:ender_chest[facing=west,waterlogged=false]'));
  const L = ent('minecraft:chest[facing=south,type=left,waterlogged=false]').quads, R = ent('minecraft:chest[facing=south,type=right,waterlogged=false]').quads;
  ok(box(L) === '0,0,1,15,14,16' && facesOn(L, 4, 0, 0) === 0, '大箱子左半（朝南）：一直到 x=0，挨着另一半的西面不画', box(L));
  ok(box(R) === '1,0,1,16,14,16' && facesOn(R, 5, 0, 16) === 0, '大箱子右半（朝南）：一直到 x=16，挨着另一半的东面不画', box(R));
  const H = ent('minecraft:red_bed[facing=south,occupied=false,part=head]').quads, F = ent('minecraft:red_bed[facing=south,occupied=false,part=foot]').quads;
  ok(box(H) === '0,0,0,16,9,16' && box(F) === '0,0,0,16,9,16', '床：铺满一格、高 9（床腿 3）', [box(H), box(F)]);
  ok(facesOn(H, 2, 2, 0) === 0 && facesOn(F, 3, 2, 16) === 0 && facesOn(H, 3, 2, 16) === 3 && facesOn(F, 2, 2, 0) === 3, '床头不画挨着床脚的北面，床脚不画南面；两头的外侧都画（床面 + 两条床腿）');
  ok(H.length === 15 && F.length === 15 && ent('minecraft:chest[facing=south,type=single,waterlogged=false]').quads.length === 18, '面数：床每半 15，单箱子 18', [H.length, F.length]);
}

// ---- 明暗、法线 ----
{
  const q = ent('minecraft:chest[facing=south,type=single,waterlogged=false]').quads;
  const by = {}; for (const x of q) by[x.dir] = x.light;
  ok(near(by[1], 1) && near(by[0], 0.4) && near(by[2], 0.7396) && near(by[3], 0.7396) && near(by[4], 0.4970) && near(by[5], 0.4970), '实体的明暗：上 1、下 0.4、南北 0.74、东西 0.50（MC 实体的两盏灯）', by);
  let bad = 0;
  const all = [...q, ...ent('minecraft:red_bed[facing=west,occupied=false,part=head]').quads, ...ent('minecraft:chest[facing=east,type=left,waterlogged=false]').quads];
  for (const x of all) {
    const p = (i) => [x.pos[i * 3], x.pos[i * 3 + 1], x.pos[i * 3 + 2]];
    const a = p(0).map((v, i) => v - p(1)[i]), c = p(2).map((v, i) => v - p(1)[i]);
    const n = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]];
    const d = M.NORMALS[x.dir];
    if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] <= 0) bad++;
  }
  ok(bad === 0, '每个面的顶点顺序都让法线朝外（和方块面同一个绕向）', bad);
}

// ---- 接进网格（16-mcmesh.js） ----
const mc = (s) => (s.includes(':') ? s : 'minecraft:' + s);
const model = (size, palette, cells) => ({ size, palette: palette.map(mc), cells });
// 一层里的每个面：顶点、颜色、UV、法线
function quadsOf(layer) {
  const out = [];
  for (let k = 0; k < layer.quads; k++) {
    const p = [], c = [], t = [];
    for (let i = 0; i < 4; i++) {
      const v = (k * 4 + i) * 3, w = (k * 4 + i) * 2;
      p.push([layer.position[v], layer.position[v + 1], layer.position[v + 2]]);
      c.push([layer.color[v], layer.color[v + 1], layer.color[v + 2]]);
      t.push([layer.uv[w], layer.uv[w + 1]]);
    }
    const a = p[0].map((v, i) => v - p[1][i]), b = p[2].map((v, i) => v - p[1][i]);
    const n = [b[1] * a[2] - b[2] * a[1], b[2] * a[0] - b[0] * a[2], b[0] * a[1] - b[1] * a[0]];
    const len = Math.hypot(...n) || 1;
    out.push({ p, c, t, n: n.map((v) => v / len) });
  }
  return out;
}
// 面中心在图集第 0 级上的颜色
function texel(atlas, q) {
  const u = q.t.reduce((s, v) => s + v[0], 0) / 4, v = q.t.reduce((s, x) => s + x[1], 0) / 4;
  const x = Math.floor(u * atlas.width), y = Math.floor(v * atlas.height), o = (y * atlas.width + x) * 4, d = atlas.levels[0];
  return [d[o], d[o + 1], d[o + 2]];
}
const same = (a, b, e = 2) => a.every((v, i) => Math.abs(v - b[i]) <= e);
const tops = (qs) => qs.filter((q) => q.n[1] > 0.99);
const C = ENTITY_COLORS;
const pack = await J.fromBytes(new Uint8Array(makeZip([...testJarEntries(), ...entityTestEntries()])));
{
  ok(pack.counts.entity === 2 && pack.has('assets/minecraft/textures/entity/chest/normal.png'), '读 jar 时把 textures/entity/chest、bed 也取出来', pack.counts);
  const r = await S.build(model([1, 1, 1], ['air', 'chest[facing=south,type=single,waterlogged=false]'], [1]), { pack, mipmaps: false });
  const qs = quadsOf(r.layers.entity);
  ok(r.stats.entityModels === 1 && r.layers.entity.quads === 18 && r.layers.solid.quads === 0, '单箱子：画真模型（实体层 18 个面），不再画盒子', r.stats);
  const top = tops(qs).sort((a, b) => b.p[0][1] - a.p[0][1])[0];
  ok(top && near(top.p[0][1], 14 / 16) && same(texel(r.atlas, top), C.chestLid), '箱子盖子顶面在 y=14/16，贴图取到盖子那块（红）', top && [top.p[0][1], texel(r.atlas, top)]);
  const lock = qs.filter((q) => q.n[2] > 0.99).sort((a, b) => b.p[0][2] - a.p[0][2])[0];
  ok(lock && near(lock.p[0][2], 1) && same(texel(r.atlas, lock), C.chestLock), '锁的正面在 z=1（朝南），贴图取到锁那块（黄）', lock && [lock.p[0][2], texel(r.atlas, lock)]);
  ok(r.warnings.length === 0 && r.stats.missingSprites.length === 0, '没有警告、没有缺贴图', [r.warnings, r.stats.missingSprites]);
}
{
  // 朝南的床：床脚 z=0，床头 z=1
  const r = await S.build(model([1, 1, 2], ['air', 'red_bed[facing=south,occupied=false,part=foot]', 'red_bed[facing=south,occupied=false,part=head]'], [1, 2]), { pack, mipmaps: false });
  const t = tops(quadsOf(r.layers.entity)).filter((q) => near(q.p[0][1], 9 / 16));
  const head = t.find((q) => q.p.every((v) => v[2] >= 1 - 1e-6)), foot = t.find((q) => q.p.every((v) => v[2] <= 1 + 1e-6));
  ok(r.stats.entityModels === 2 && r.layers.entity.quads === 30 && t.length === 2, '床：两半都是真模型，顶面在 y=9/16', [r.stats.entityModels, r.layers.entity.quads, t.length]);
  ok(head && foot && same(texel(r.atlas, head), C.pillow) && same(texel(r.atlas, foot), C.bed), '床头顶面取到枕头那块（白），床脚是床单（红）', head && foot && [texel(r.atlas, head), texel(r.atlas, foot)]);
}
{
  // 测试 jar 里故意没有 normal_left / normal_right：大箱子退回盒子
  const r = await S.build(model([2, 1, 1], ['air', 'chest[facing=south,type=right,waterlogged=false]', 'chest[facing=south,type=left,waterlogged=false]'], [1, 2]), { pack, mipmaps: false });
  ok(r.stats.entityModels === 0 && r.layers.entity.quads === 0 && r.layers.solid.quads > 0 && r.stats.specials.includes('chest'), '读不到实体贴图（大箱子）：照旧画盒子', r.stats);
}
{
  // 光照：封死的石头屋子（5×3×3），中间一排：x=1 光源方块 level=4，x=2 床脚，x=3 床头（朝东）。
  // 方块光：床脚 3、床头 2；MC 的床两半取亮的那个（BrightnessCombiner）→ 两半顶面一样亮，都按 block 3、sky 0 算。
  const W = 5, H = 3, Ln = 3, cells = new Array(W * H * Ln).fill(0);
  const id = (x, y, z) => x + z * W + y * W * Ln;
  cells[id(1, 1, 1)] = 1; cells[id(2, 1, 1)] = 2; cells[id(3, 1, 1)] = 3;
  const pal = ['stone', 'light[level=4,waterlogged=false]', 'red_bed[facing=east,occupied=false,part=foot]', 'red_bed[facing=east,occupied=false,part=head]'];
  const lit = await S.build(model([W, H, Ln], pal, cells), { pack, mipmaps: false });
  const t = tops(quadsOf(lit.layers.entity)).filter((q) => near(q.p[0][1], 1 + 9 / 16));
  const foot = t.find((q) => q.p.every((v) => v[0] <= 3 + 1e-6)), head = t.find((q) => q.p.every((v) => v[0] >= 3 - 1e-6));
  const want = new Float32Array(3); V3.mclight.sample(V3.mclight.noonLightmap(), V3.mclight.pack(3, 0), want);
  ok(foot && head && same(foot.c[0], head.c[0], 1e-4) && same(foot.c[0], [...want], 1e-3), '暗屋里的床：两半一样亮，= 光照表(block 3, sky 0)', foot && head && [foot.c[0], head.c[0], [...want]]);
  const side = quadsOf(lit.layers.entity).find((q) => q.n[2] > 0.99 && q.p.every((v) => v[0] >= 2 - 1e-6 && v[0] <= 3 + 1e-6) && q.p.every((v) => v[1] >= 1 + 3 / 16 - 1e-6));
  ok(side && near(side.c[0][0], want[0] * 0.7396, 2e-3), '侧面 = 光照 × 实体方向光（南面 0.74）', side && [side.c[0][0], want[0] * 0.7396]);
  const off = await S.build(model([W, H, Ln], pal, cells), { pack, mipmaps: false, light: false });
  const t2 = tops(quadsOf(off.layers.entity));
  ok(t2.length > 0 && t2.every((q) => same(q.c[0], [1, 1, 1], 1e-4)), '关掉光照：顶面满亮（只剩方向光，顶面 1）');
}

console.log('mc-entity: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
