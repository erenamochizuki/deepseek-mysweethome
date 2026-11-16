// furn-mc.test.mjs — P5 家具：规格（src/44-furn-mc.js）、.bbmodel（models/furniture/）、导出的 MC 资源和 FurnitureShapes.java（web/tools/furn-mc.mjs）。
//   第 1 轮 3 件（床、餐桌、贝壳柜）+ 第 2 轮 22 种（docs/FURNITURE.md 8.1、8.2）+ 第 3 轮屋外 15 种（9.1）：摆法和 42-house-mc 的 V3.houseMc.FURN2 一样、part 的算法一样、
//   40-layout 的体素矩形在占的格子里、overlay 的网格在体素版里、体素放得进格子（不裁）、Java 的 Kind 和规格一样。
//   规格和布局对得上（格子数 = 布局矩形取整、位置和房子里的一样）；贝壳柜的格子和体素版一样；
//   .bbmodel 能读、每格一个 group、每格的元素都在这一格里；导出的 blockstate 覆盖所有 facing × part、模型和贴图都在、不引用原版父模型；
//   check 通过、导出两次一模一样；用我们自己的资源包画（16-mcmesh）没有缺模型、缺贴图；
//   有 MC_JAR 时再用真 jar + 我们的资源包合成的包画一遍（没有就 SKIP）。
//   第 10 节「简化」：每个方块模型 ≤ 32 个元素；老做法本来就 ≤ 32 的件 .bbmodel 和老做法一字不差；简化过的碰撞盒、选框只往里缩、每边不超过 1 像素；
//   网页叠上去的屏幕平面那层、空碗里米饭那块没有元素盖住，屏幕面板还在；受保护的部件（伞杆）还在。
// 用法：cd web && node test/furn-mc.test.mjs   （MC_JAR=<客户端 jar> 加真 jar 那一项；--require-jar 时没 jar 算失败）
import fs from 'node:fs';
import path from 'node:path';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { inflateRaw, inflateZlib } from '../tools/mc-lib.mjs';
import { furnMc, voxelsOf, buildVoxel, voxPointToMc, partObject, worldToU } from '../tools/lib/furn-mc-vox.mjs';
import { readBb, JAVA_FILE, elBox } from '../tools/lib/furn-mc-export.mjs';
import { groupName } from '../tools/lib/furn-mc-bb.mjs';
import { LIMIT } from '../tools/lib/furn-mc-lite.mjs';
import { REPO_DIR, bbFile, buildFiles, checkFiles, makeBb } from '../tools/furn-mc.mjs';

let pass = 0, fail = 0;
const ok = (c, what, got) => {
  if (c) { pass++; console.log('PASS ' + what); }
  else { fail++; console.log('FAIL ' + what + (got !== undefined ? ' → ' + JSON.stringify(got).slice(0, 500) : '')); }
};
const REQUIRE_JAR = process.argv.includes('--require-jar');
const JAR = process.env.MC_JAR && fs.existsSync(process.env.MC_JAR) ? process.env.MC_JAR : null;
const FACINGS = ['north', 'east', 'south', 'west'];
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---------------- 规格 ----------------
const M = furnMc(), H = loadV3(['40-layout', '44-furn-mc']), L = H.V3.layout;
const R1 = M.list.filter((f) => !(f.round >= 2)), R2 = M.list.filter((f) => f.round === 2), R3 = M.list.filter((f) => f.round === 3), R5 = M.list.filter((f) => f.round === 5), RK = R2.concat(R3, R5);
ok(R1.map((f) => f.id).join() === 'bed,dining_table,shell_case' && R2.length === 22 && R3.length === 15 && R5.map((f) => f.id).join() === 'photo_frame' && M.list.length === 41,
  '规格：第 1 轮 3 件 + 第 2 轮 22 种 + 第 3 轮 15 种 + 第 5 轮相框 = 41 种', M.list.map((f) => f.id));
// 第 5 轮：相框（docs/PHOTOS.md）。不在默认房子里，1 格、挂墙、没有碰撞；体素版用 V3.furn.makers 直接建
{
  const pf = M.byId('photo_frame');
  ok(pf && pf.block === 'xiaojingyu:photo_frame' && pf.label === '相框' && pf.house === null && M.homesOf(pf).length === 0 && pf.cells.length === 1 && pf.cells[0].part === null,
    '相框：xiaojingyu:photo_frame，1 格，不在默认房子里（house: null）', pf && { house: pf.house, cells: pf.cells });
  ok(M.collideOf(pf, null) === 'none' && M.mountOf(pf) === 'wall' && !pf.light && pf.make === 'photoFrame' && pf.photo === '照片', '相框：collide none、挂墙、不亮、体素版 make photoFrame、照片元素叫「照片」');
  ok(M.byBlock('xiaojingyu:photo_frame[facing=east]') === pf, '相框：byBlock 找得到');
  const pw = M.byId('picture_frames');
  ok(pw.photo === '画' && pw.photoSlots.length === 6 && pf.photoSlots.length === 1, '有照片的：画框墙 6 个小框（元素「画」）、相框 1 个');
}
ok(!!H.V3.furnMc && !H.window.THREE.Mesh, '规格：44-furn-mc.js 不用 THREE 也能加载（纯数据）');
for (const f of R1) {
  const it = (L[f.layout.layer] || []).find((q) => q.id === f.layout.id);
  ok(!!it, `${f.id}：V3.layout.${f.layout.layer} 里有 ${f.layout.id}`);
  if (!it) continue;
  ok(it.block === f.block, `${f.id}：布局里写着 block = ${f.block}`, it.block);
  ok(M.byBlock(f.block) === f && M.byBlock(f.block + '[facing=north]') === f && M.byLayout(f.layout.id, f.layout.layer) === f, `${f.id}：byBlock / byLayout 找得到`);
  ok(f.cells[0].offset.join() === '0,0,0', `${f.id}：主格（第一格）的 offset 是 [0,0,0]`);
  ok(f.cells.every((c) => !!M.modelOf(f, c.part)), `${f.id}：每个 part 都有模型名`, f.models);
  ok(f.cells.length === f.size[0] * f.size[1] * f.size[2], `${f.id}：格子数 = size 相乘`, f.size);
  // 格子数 = 布局矩形取整（最近的整格，至少 1）；按 f.facing 摆，正好盖住布局矩形占的方块
  const want = [Math.max(1, Math.round(it.x1 - it.x0)), Math.max(1, Math.round(it.h)), Math.max(1, Math.round(it.z1 - it.z0))];
  const cs = M.cellsFor(f, f.facing), lo = [0, 1, 2].map((a) => Math.min(...cs.map((c) => c.offset[a]))), hi = [0, 1, 2].map((a) => Math.max(...cs.map((c) => c.offset[a])) + 1);
  ok([0, 1, 2].every((a) => hi[a] - lo[a] === want[a]), `${f.id}：朝 ${f.facing} 时占 ${hi.map((v, a) => v - lo[a]).join(' × ')} 格 = 布局矩形取整 ${want.join(' × ')}`, { lo, hi, want });
  const bx = Math.round(it.x0), bz = Math.round(it.z0), main = [bx - lo[0], 0, bz - lo[2]];
  const world = cs.map((c) => [main[0] + c.offset[0], main[2] + c.offset[2]].join());
  const rect = []; for (let x = bx; x < bx + want[0]; x++) for (let z = bz; z < bz + want[2]; z++) rect.push(x + ',' + z);
  ok(world.slice().sort().join(';') === rect.sort().join(';'), `${f.id}：格子正好是布局矩形的方块（主格 x=${main[0]} z=${main[2]}）`, { world, rect });
}
// 和 docs/FURNITURE.md 第 1、2 节对一下
{
  const bed = M.byId('bed'), sc = M.byId('shell_case');
  const at = (f, facing, main) => Object.fromEntries(M.cellsFor(f, facing).map((c) => [c.part, [main[0] + c.offset[0], main[2] + c.offset[2]].join()]));
  ok(JSON.stringify(at(bed, 'north', [-6, 1, -15])) === JSON.stringify({ head: '-6,-15', foot: '-6,-14' }), '床：朝北时床头 z=−15、床尾 z=−14（床头 = 床尾 + facing）');
  ok(JSON.stringify(at(sc, 'east', [-6, 5, -10])) === JSON.stringify({ left: '-6,-10', right: '-6,-11' }), '贝壳柜：正面朝东时 left 在南（z=−10）、right = left + 北');
  ok(M.state(bed, 'east', 'head') === 'xiaojingyu:bed[facing=east,part=head]' && M.state(M.byId('dining_table'), 'west', null) === 'xiaojingyu:dining_table[facing=west]', '规格：state() 拼状态字符串');
  ok(M.rotate([0, 0, 1], 'east').join() === '-1,0,0' && M.rotate([-1, 0, 0], 'south').join() === '1,0,0' && M.rotatePoint([0.25, 0, 0.1], 'east').map((v) => +v.toFixed(3)).join() === '0.9,0,0.25', '规格：rotate / rotatePoint 和 blockstate 的 y 旋转一样（顺时针）');
}

// ---------------- 第 2 轮：规格 ↔ 生成器的摆法（V3.houseMc.FURN2）↔ 40-layout ----------------
{
  const HM = loadV3(['12-nbt', '13-share', '17-mcfallback', '42-house-mc'], { core: false }).V3.houseMc, F2 = HM.FURN2 || [];
  // 42 的 localCell（8.1）：世界格子 → 朝北本地格子
  const local = (facing, xs, zs, x, z) => facing === 'north' ? [x - xs[0], z - zs[0]] : facing === 'south' ? [xs[1] - x, zs[1] - z]
    : facing === 'east' ? [z - zs[0], xs[1] - x] : [zs[1] - z, x - xs[0]];
  ok(F2.length >= 22, `生成器的摆放表 FURN2 有 ${F2.length} 条`);
  for (const f of R2) {
    const rows = F2.filter((r) => r[0] === f.id), h = f.house;
    ok(rows.length >= 1, `${f.id}：生成器里有（${rows.length} 处）`);
    if (!rows.length) continue;
    const r0 = rows[0];
    ok(r0[1] === h.facing && r0[2].join() === h.xs.join() && r0[3].join() === h.ys.join() && r0[4].join() === h.zs.join(), `${f.id}：规格的 house 和生成器的第一处一样（${h.facing}，x ${h.xs.join('..')}，y ${h.ys.join('..')}，z ${h.zs.join('..')}）`, { spec: h, gen: r0 });
    if (f.repeat) ok(rows.length === f.repeat.xs[1] - f.repeat.xs[0] + 1 && rows.every((r) => r[1] === h.facing && r[2][0] >= f.repeat.xs[0] && r[2][0] <= f.repeat.xs[1]), `${f.id}：一排 ${rows.length} 格`);
    if (f.also) for (const a of f.also) ok(rows.some((r) => r[1] === a.facing && r[2].join() === a.xs.join() && r[4].join() === a.zs.join()), `${f.id}：另一件（${a.id}，${a.facing}）也在生成器里`);
    // 每格：生成器的 part 算法 = 规格的 cellsFor 摆法
    const [sx, sy, sz] = [h.xs[1] - h.xs[0] + 1, h.ys[1] - h.ys[0] + 1, h.zs[1] - h.zs[0] + 1];
    const wd = h.facing === 'east' || h.facing === 'west' ? [sz, sx] : [sx, sz];
    ok(wd[0] === f.w && wd[1] === f.d && sy === f.h, `${f.id}：占 ${f.w} × ${f.d} × ${f.h} 格 = 生成器的范围`, { wd, sy });
    const main = { north: [h.xs[0], h.zs[0]], south: [h.xs[1], h.zs[1]], east: [h.xs[1], h.zs[0]], west: [h.xs[0], h.zs[1]] }[h.facing];
    const bad = [];
    for (const c of M.cellsFor(f, h.facing)) {
      const x = main[0] + c.offset[0], z = main[1] + c.offset[2], y = h.ys[0] + c.offset[1], [cx, cz] = local(h.facing, h.xs, h.zs, x, z);
      const part = f.cells.length > 1 ? cx + f.w * (cz + f.d * (y - h.ys[0])) : null;
      if (x < h.xs[0] || x > h.xs[1] || z < h.zs[0] || z > h.zs[1] || part !== c.part) bad.push({ c, x, y, z, part });
    }
    ok(!bad.length, `${f.id}：每格的位置和 part 和生成器算的一样`, bad.slice(0, 2));
    ok(f.cells.every((c) => ['box', 'thin', 'none'].includes(M.collideOf(f, c.part))) && (!Array.isArray(f.collide) || f.collide.length === f.cells.length), `${f.id}：collide 每格都有（${[].concat(f.collide).join(' / ')}）`);
    // 40-layout：体素版（主件和合进来的）的矩形都在占的格子里，并且标着这个方块
    for (const s of [f.layout, ...(f.extra || []), ...(f.also || [])]) {
      const it = (L[s.layer] || []).find((q) => q.id === s.id), xs = s.xs || (f.repeat ? f.repeat.xs : h.xs), zs = s.zs || h.zs;
      ok(!!it && it.block === f.block, `${f.id}：布局里的 ${s.id} 标着 block = ${f.block}`, it && it.block);
      if (!it) continue;
      const e = 1e-9, inside = it.x0 >= xs[0] - e && it.x1 <= xs[1] + 1 + e && it.z0 >= zs[0] - e && it.z1 <= zs[1] + 1 + e;
      ok(inside, `${f.id}：布局里 ${s.id} 的矩形（x ${it.x0}..${it.x1}，z ${it.z0}..${it.z1}）在占的格子里`, { xs, zs });
    }
  }
  const living = M.byId('living_rug');
  ok(M.collideOf(living, 1) === 'box' && [0, 2, 3].every((k) => M.collideOf(living, k) === 'thin'), '地毯和小茶几：茶几那格（part 1）box，别的 thin');
  ok(M.byId('desk').light === 10 && M.byId('tv_stand').light === 5 && M.byId('string_lights').light === 12 && R2.filter((f) => f.light).length === 3, '光：书桌 10、电视 5、串灯 12，别的不亮');
  ok(['spice_rack', 'picture_frames', 'string_lights'].every((id) => M.collideOf(M.byId(id), 0) === 'none') && M.collideOf(M.byId('door_mat'), 0) === 'thin', 'collide：挂墙、吊顶的 none，门口地垫 thin');
}

// ---------------- 第 3 轮：规格 ↔ 生成器的摆法（FURN2 里的第 3 轮，逐条）↔ 40-layout（docs/FURNITURE.md 9.1） ----------------
{
  const HM = loadV3(['12-nbt', '13-share', '17-mcfallback', '42-house-mc'], { core: false }).V3.houseMc, F2 = HM.FURN2 || [], YD = HM.YARD;
  const ids3 = new Set(R3.map((f) => f.id)), rows3 = F2.filter((r) => ids3.has(r[0]));
  const spec3 = R3.flatMap((f) => [f.house, ...(f.also || [])].map((h) => [f.id, h.facing, h.xs, h.ys, h.zs]));
  const key = (r) => JSON.stringify(r);
  ok(rows3.length === 18 && spec3.length === 18 && rows3.map(key).sort().join() === spec3.map(key).sort().join(), `第 3 轮：规格的摆法（house + also）和生成器逐条一样（15 种 ${rows3.length} 件：壁灯 2、多肉 3）`,
    { gen: rows3.map(key).filter((k) => !spec3.map(key).includes(k)), spec: spec3.map(key).filter((k) => !rows3.map(key).includes(k)) });
  ok(R3.map((f) => f.id).join() === [...new Set(rows3.map((r) => r[0]))].join(), '第 3 轮：规格的顺序 = 生成器的顺序（9.1 的表）');
  const local = (facing, xs, zs, x, z) => facing === 'north' ? [x - xs[0], z - zs[0]] : facing === 'south' ? [xs[1] - x, zs[1] - z]
    : facing === 'east' ? [z - zs[0], xs[1] - x] : [zs[1] - z, x - xs[0]];
  const W = { beach_parasol: [1, 1, 3], beach_lounger: [1, 2, 1], beach_lounger_hat: [1, 2, 1], flower_box_purple: [2, 1, 1], flower_box_pink: [2, 1, 1], step_mat: [2, 1, 1] };
  for (const f of R3) {
    ok([f.w, f.d, f.h].join() === (W[f.id] || [1, 1, 1]).join(), `${f.id}：占 ${f.w} × ${f.d} × ${f.h} 格（9.1；遮阳伞伞柱 3 格）`);
    const bad = [];
    for (const h of [f.house, ...(f.also || [])]) {
      const main = { north: [h.xs[0], h.zs[0]], south: [h.xs[1], h.zs[1]], east: [h.xs[1], h.zs[0]], west: [h.xs[0], h.zs[1]] }[h.facing];
      for (const c of M.cellsFor(f, h.facing)) {
        const x = main[0] + c.offset[0], z = main[1] + c.offset[2], y = h.ys[0] + c.offset[1], [cx, cz] = local(h.facing, h.xs, h.zs, x, z);
        const part = f.cells.length > 1 ? cx + f.w * (cz + f.d * (y - h.ys[0])) : null;
        if (x < h.xs[0] || x > h.xs[1] || z < h.zs[0] || z > h.zs[1] || y > h.ys[1] || part !== c.part) bad.push({ c, x, y, z, part });
        if (YD && (x < YD.x0 || x > YD.x1 || z < YD.z0 || z > YD.z1)) bad.push({ yard: [x, z] });
      }
    }
    ok(!bad.length, `${f.id}：每格的位置和 part 和生成器算的一样，都在鲸图范围（YARD）里`, bad.slice(0, 2));
    ok(f.vox && f.vox.length >= 1 && f.cells.every((c) => ['box', 'thin', 'none'].includes(M.collideOf(f, c.part))), `${f.id}：有体素来源（${f.vox.map((q) => q.part + ':' + q.name).join('、')}），collide 每格都有`);
    // 布局：带 block（beachSet 是 blocks 列表；壁灯在 V3.layout.lanterns 里，是两对 [x, z]）；位置在占的格子里
    const it = (L[f.layout.layer] || []).find((q) => q && q.id === f.layout.id);
    if (f.layout.layer === 'lanterns') {
      const hs = [f.house, ...(f.also || [])];
      ok(L.lanterns.length === hs.length && L.lanterns.every(([x, z], i) => x > hs[i].xs[0] && x < hs[i].xs[1] + 1 && z >= hs[i].zs[0] - 1 && z <= hs[i].zs[1] + 1), `${f.id}：V3.layout.lanterns 的 ${L.lanterns.length} 盏在格子里（贴着南墙）`, L.lanterns);
    } else if (f.layout.id === 'beachSet') ok(!!it && (it.blocks || []).includes(f.block), `${f.id}：布局 beachSet 的 blocks 里有它`, it && it.blocks);
    else {
      ok(!!it && it.block === f.block, `${f.id}：布局里的 ${f.layout.id} 标着 block = ${f.block}`, it && it.block);
      const h = f.house, e = 1e-9;
      if (it && it.x != null) ok(it.x > h.xs[0] && it.x < h.xs[1] + 1 && it.z > h.zs[0] && it.z < h.zs[1] + 1, `${f.id}：布局里 ${it.id} 的位置（${it.x}, ${it.z}）在格子里`);
      else if (it && f.id !== 'succulents') ok(it.x0 >= h.xs[0] - e && it.x1 <= h.xs[1] + 1 + e && it.z0 >= h.zs[0] - (it.wallY != null ? 0.05 : 0) - e && it.z1 <= h.zs[1] + 1 + e,
        `${f.id}：布局里 ${it.id} 的矩形（x ${it.x0}..${it.x1}，z ${it.z0}..${it.z1}）在占的格子里`, h);
    }
  }
  const by = (id) => M.byId(id);
  ok(by('crate_lantern').light === 12 && by('wall_lantern').light === 12 && R3.filter((f) => f.light).length === 2, '第 3 轮的光：木箱灯笼 12、壁灯 12，别的不亮');
  ok(['towel_hook', 'wind_chime', 'wall_lantern', 'hanging_basket'].every((id) => M.collideOf(by(id), 0) === 'none') && M.collideOf(by('step_mat'), 0) === 'thin' && M.collideOf(by('step_mat'), 1) === 'thin',
    '第 3 轮的 collide：毛巾、风铃、壁灯、吊篮 none，台阶下地垫 thin');
  ok(R3.filter((f) => f.reach).map((f) => f.id).join() === 'beach_parasol,hanging_basket', '伸出格子的只有遮阳伞、吊篮');
  ok(by('wind_chime').overlay.join() === '*' && by('beach_parasol').overlay.join() === '*' && by('wall_lantern').overlay.join() === 'lamp' && by('crate_lantern').overlay.join() === 'lamp',
    'overlay：风铃、遮阳伞整件（*），壁灯、木箱灯笼叠发光的灯罩（vox:lamp）');
  ok(M.byLayout('lantern1', 'lanterns') === by('wall_lantern') && M.byLayout('succ', 'outside') === by('succulents') && M.byBlock('xiaojingyu:hanging_basket[facing=west]') === by('hanging_basket'), '第 3 轮：byLayout / byBlock 找得到');
}

// ---------------- 体素版 → MC 坐标 ----------------
const VR = {};
for (const f of M.list) {
  const vr = VR[f.id] = voxelsOf(f);
  const extra = (vr.skipped || []).filter((n) => !(f.planes || []).includes(n));
  ok(vr.vox.size > 50 && !vr.errors.length && !extra.length, `${f.id}：体素版建得出来（${vr.vox.size} 个体素${vr.skipped.length ? '，跳过平面 ' + vr.skipped.join('、') : ''}）`, { errors: vr.errors, skipped: extra });
  const msg = vr.clipped.outside ? `，裁掉格子外面的 ${vr.clipped.outside} 个（${[...vr.clipped.where].map(([t, n]) => t + ' ' + n).join('、')}）` : '';
  ok(!vr.clipped.outside, `${f.id}：体素版放得进 ${f.size.join(' × ')} 格，没有裁掉的${msg}`, vr.clipped);
  const top = 16 * (f.h || f.size[1]);
  ok(vr.bounds.max[1] <= top && (f.round >= 2 || vr.bounds.min[1] === 0), `${f.id}：不高过 ${top / 16} 格${f.round >= 2 ? '' : '、脚底在方块底'}`, vr.bounds);
  const HANG = ['spice_rack', 'picture_frames', 'string_lights', 'flower_box_purple', 'flower_box_pink', 'towel_hook', 'wind_chime', 'wall_lantern', 'photo_frame'];
  if (f.round >= 2 && !HANG.includes(f.id)) ok(vr.bounds.min[1] === 0, `${f.id}：落地（脚底在方块底，不悬空）`, vr.bounds);
  if (f.round === 5) ok(vr.bounds.max[2] === 16 && vr.bounds.min[2] >= 14 && !vr.reach, `${f.id}：挂墙的贴着格子背面（墙），2 像素厚`, vr.bounds);
  if (f.round === 3) {
    ok(f.reach ? vr.reach > 0 && vr.bounds.min.every((v) => v >= -16) && vr.bounds.max.every((v, a) => v <= 16 * f.size[a] + 16) : !vr.reach,
      `${f.id}：${f.reach ? `伸出格子的 ${vr.reach} 个体素都在 MC 允许的 −16..32 像素里` : '没有伸出格子的'}`, { reach: vr.reach, bounds: vr.bounds });
    if (HANG.includes(f.id)) ok(vr.bounds.max[2] === 16, `${f.id}：挂墙的贴着格子背面（墙）`, vr.bounds);
  }
  if (f.overlay && f.overlay.length && f.overlay[0] !== '*') {   // 网页要叠的部件在体素版里真有（网格名 'vox:<骨骼>' 或平面的名字）
    const names = new Set(); (f.vox ? partObject(f.vox[0].part, f.vox[0].name) : buildVoxel(f).o).traverse((m) => { if (m.isMesh) names.add(m.name); });
    const miss = f.overlay.filter((k) => !names.has(k) && !names.has('vox:' + k));
    ok(!miss.length, `${f.id}：overlay（${f.overlay.join('、')}）在体素版里都有`, { miss, names: [...names] });
  }
}
// 贝壳柜：规格里的格子 = 体素版 userData.slots 按同样的转法换过来
{
  const f = M.byId('shell_case'), { o } = buildVoxel(f), ud = o.userData, vr = VR.shell_case;
  ok(Array.isArray(ud.slots) && ud.slots.length === 12 && f.slots.length === 12, '贝壳柜：体素版和规格都有 12 个格子');
  const conv = ud.slots.map((p) => voxPointToMc(f, vr.off, p));
  const bad = conv.map((p, i) => [i, p, f.slots[i]]).filter(([, p, q]) => !q || p.some((v, a) => !near(v, q[a], 2e-4)));
  ok(!bad.length, '贝壳柜：规格的 slots = 体素版的 slots（朝北、主格 left 的方块内坐标，单位格）', bad.slice(0, 3));
  ok(ud.slotSize.every((v, a) => near(v, f.slotSize[a], 1e-4)), '贝壳柜：slotSize 一样（1 格 = 1 米）', { vox: ud.slotSize, spec: f.slotSize });
  const order = f.slots.slice(0, 4).map((p) => p[0]), rows = [0, 4, 8].map((i) => f.slots[i][1]);
  ok(order.every((v, i) => !i || v < order[i - 1]) && rows.every((v, i) => !i || v < rows[i - 1]), '贝壳柜：上排 → 下排，每排从左到右（朝北时左手是 +x）');
  ok(f.slots.every((p) => p[1] - f.slotSize[1] / 2 > 0 && p[1] + f.slotSize[1] / 2 < 1 && p[0] > -1 && p[0] < 1 && p[2] > 0 && p[2] < 1), '贝壳柜：格子都在柜子的两格里');
}

// ---------------- .bbmodel ----------------
for (const f of M.list) {
  const file = bbFile(f.id);
  ok(fs.existsSync(file), `${f.id}：有 models/furniture/${f.id}.bbmodel`);
  if (!fs.existsSync(file)) continue;
  let bb = null;
  try { bb = readBb(file); } catch (e) { ok(false, `${f.id}：.bbmodel 能读`, e.message); continue; }
  ok(bb.meta.model_format === 'java_block' && /^5\./.test(bb.meta.format_version), `${f.id}：Blockbench 5 的 java_block 工程`, bb.meta);
  const gname = new Map((bb.groups || []).map((g) => [g.uuid, g.name])), els = new Map(bb.elements.map((e) => [e.uuid, e]));
  const top = (bb.outliner || []).filter((n) => typeof n === 'object').map((n) => gname.get(n.uuid) || n.name);
  ok(top.slice().sort().join() === f.cells.map(groupName).sort().join(), `${f.id}：每格一个 group（${f.cells.map(groupName).join('、')}）`, top);
  const out = [];
  let n = 0;
  for (const node of bb.outliner || []) {
    if (typeof node !== 'object') continue;
    const c = f.cells.find((q) => groupName(q) === (gname.get(node.uuid) || node.name)); if (!c) continue;
    const m = f.reach ? 16 : 0;   // 伸出格子的：MC 允许 −16..32
    const walk = (nd) => { for (const ch of nd.children || []) { if (typeof ch === 'string') { const e = els.get(ch); if (e) { n++; for (let a = 0; a < 3; a++) { const lo = c.offset[a] * 16; if (e.from[a] < lo - m - 1e-9 || e.to[a] > lo + 16 + m + 1e-9) out.push([c.part, e.name, e.from, e.to]); } } } else walk(ch); } };
    walk(node);
  }
  ok(n === bb.elements.length && !out.length, `${f.id}：${n} 个元素都在自己那格里（${f.reach ? '伸出格子的在 −16..32' : '0..16'}）`, out.slice(0, 3));
  ok(bb.textures.length >= 1 && /^data:image\/png;base64,/.test(bb.textures[0].source), `${f.id}：贴图内嵌在 .bbmodel 里`);
  const per = f.cells.map((c) => bb.outliner.find((nd) => (gname.get(nd.uuid) || nd.name) === groupName(c)).children.length);
  ok(per.every((k) => k >= 1 && k <= LIMIT), `${f.id}：每格的元素 ${per.join(' / ')} 个（≤ ${LIMIT}，第 10 节）`, per);
}
// bb 是确定的（同样的体素每次一样）
{
  const f = M.byId('dining_table');
  ok(makeBb(f).text === makeBb(f).text, 'bb：同样的体素生成两次一模一样');
}

// ---------------- 导出 ----------------
const A = await buildFiles(), B = await buildFiles(), P = 'mod/src/main/resources/assets/';
ok(A.files.size === B.files.size && [...A.files].every(([k, v]) => B.files.has(k) && Buffer.compare(v, B.files.get(k)) === 0), `导出：两次一模一样（${A.files.size} 个文件）`);
const chk = await checkFiles();
ok(!chk.problems.length, 'check：仓库里的和重新导出的一样', chk.problems.slice(0, 5));
ok(!A.notes.length, '导出：没有提醒', A.notes);
const J = (k) => JSON.parse(A.files.get(k).toString('utf8'));
const packFiles = new Map();
for (const [k, v] of A.files) if (k.startsWith('mod/src/main/resources/')) packFiles.set(k.slice('mod/src/main/resources/'.length), new Uint8Array(v));
for (const f of M.list) {
  const [ns, id] = f.block.split(':'), bsKey = `${P}${ns}/blockstates/${id}.json`;
  ok(A.files.has(bsKey), `${f.id}：有 blockstate`);
  if (!A.files.has(bsKey)) continue;
  const bs = J(bsKey), miss = [];
  for (const facing of FACINGS) for (const c of f.cells) {
    const k = 'facing=' + facing + (c.part != null ? ',part=' + c.part : ''), v = bs.variants && bs.variants[k];
    const y = { north: 0, east: 90, south: 180, west: 270 }[facing];
    if (!v || v.model !== M.modelOf(f, c.part) || (v.y || 0) !== y) miss.push(k);
  }
  ok(!miss.length && Object.keys(bs.variants).length === FACINGS.length * f.cells.length, `${f.id}：blockstate 覆盖 4 个 facing × ${f.cells.length} 个 part，y 旋转对`, miss);
  for (const c of f.cells) {
    const [mns, mp] = M.modelOf(f, c.part).split(':'), mk = `${P}${mns}/models/${mp}.json`;
    ok(A.files.has(mk), `${f.id}：有方块模型 ${M.modelOf(f, c.part)}`);
    if (!A.files.has(mk)) continue;
    const m = J(mk), texs = Object.values(m.textures || {});
    ok(!m.parent && m.textures.particle && texs.every((t) => A.files.has(`${P}${t.split(':')[0]}/textures/${t.split(':')[1]}.png`)), `${f.id}/${groupName(c)}：不引用父模型、带 particle、贴图都在`, { parent: m.parent, textures: m.textures });
    ok(m.elements.length <= LIMIT, `${f.id}/${groupName(c)}：方块模型 ${m.elements.length} 个元素（≤ ${LIMIT}）`);
    const lim = f.reach ? [-16, 32] : [0, 16], outside = m.elements.filter((e) => e.from.some((v) => v < lim[0]) || e.to.some((v) => v > lim[1]));
    ok(m.elements.length && !outside.length, `${f.id}/${groupName(c)}：${m.elements.length} 个元素都在 ${lim.join('..')} 里`, outside.slice(0, 2));
    if (f.glow) {
      const g = m.elements.filter((e) => e.light_emission === 15);
      ok(g.length > 0, `${f.id}/${groupName(c)}：发光的灯罩元素 light_emission 15（${g.length} 个）`);
    }
    const uvBad = m.elements.flatMap((e) => Object.values(e.faces)).filter((fc) => fc.uv.some((v) => v < 0 || v > 16) || !/^#\d+$/.test(fc.texture));
    ok(!uvBad.length, `${f.id}/${groupName(c)}：面的 uv 在 0..16、贴图引用对`, uvBad.slice(0, 2));
  }
  const ik = `${P}${ns}/items/${id}.json`, im = f.item.split(':');
  ok(A.files.has(ik) && J(ik).model.type === 'minecraft:model' && J(ik).model.model === f.item && A.files.has(`${P}${im[0]}/models/${im[1]}.json`), `${f.id}：26.1 的物品定义 → 物品模型 ${f.item}`);
  if (A.files.has(`${P}${im[0]}/models/${im[1]}.json`)) {
    const it = J(`${P}${im[0]}/models/${im[1]}.json`);
    ok(!it.parent && it.display && it.display.gui && it.elements.every((e) => e.from.every((v) => v >= -16) && e.to.every((v) => v <= 32)), `${f.id}：物品模型是整件（${it.elements.length} 个元素，在 −16..32 里），有 display`);
  }
}
// FurnitureShapes.java：每件每个 part 一个常量，盒子 = 模型元素的外包盒
{
  const java = A.files.get(JAVA_FILE).toString('utf8'), probs = [];
  for (const f of R1) for (const c of f.cells) {
    const name = (f.id + (c.part ? '_' + c.part : '')).toUpperCase(), m = new RegExp(`double\\[\\]\\[\\] ${name} = \\{\\{([^}]*)\\}\\};`).exec(java);
    if (!m) { probs.push(name + ' 没有'); continue; }
    const box = m[1].split(',').map(Number), [mns, mp] = M.modelOf(f, c.part).split(':'), els = J(`${P}${mns}/models/${mp}.json`).elements;
    const want = elBox(els);
    if (box.some((v, i) => !near(v, want[i], 1e-4))) probs.push([name, box, want]);
    if (!java.includes(`case "${f.id}${c.part ? '/' + c.part : ''}": return ${name};`)) probs.push(name + ' 不在 boxes() 里');
  }
  ok(!probs.length && /package com\.xiaojingyu\.furniture;/.test(java) && !/import net\.minecraft/.test(java), 'FurnitureShapes.java：每件每个 part 的外包盒对、boxes() 能查到、不用 MC 的类', probs.slice(0, 3));
  ok(fs.existsSync(path.join(REPO_DIR, JAVA_FILE)), 'FurnitureShapes.java 在 mod 的源码里');
  // 第 2 轮：Kind（w、d、h、light、每格 collide、碰撞盒、选框），盒子 = 模型这一格的外包盒（thin = 贴地 1/16，none = 空），没有占位
  const kbad = [], num = (t) => (t.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  for (const f of RK) {
    const re = new RegExp(`Kind ${f.id.toUpperCase()} = new Kind\\("${f.id}", (\\d+), (\\d+), (\\d+), (\\d+),\\n\\s+new String\\[\\] \\{([^}]*)\\},\\n\\s+new double\\[\\]\\[\\]\\[\\] \\{(.*)\\},\\n\\s+new double\\[\\]\\[\\]\\[\\] \\{(.*)\\}, (true|false)\\);`);
    const m = re.exec(java);
    if (!m) { kbad.push(f.id + ' 没有 Kind'); continue; }
    if ([m[1], m[2], m[3], m[4]].map(Number).join() !== [f.w, f.d, f.h, f.light || 0].join()) kbad.push([f.id, 'w/d/h/light', m.slice(1, 5)]);
    if (m[5] !== f.cells.map((c) => JSON.stringify(M.collideOf(f, c.part))).join(', ')) kbad.push([f.id, 'collide', m[5]]);
    if (m[8] !== 'false') kbad.push([f.id, '还是占位']);
    const outl = num(m[7]), coll = num(m[6]);
    f.cells.forEach((c, i) => {
      const [mns, mp] = M.modelOf(f, c.part).split(':'), els = J(`${P}${mns}/models/${mp}.json`).elements;
      const want = elBox(els).map((v) => (f.reach ? Math.min(16, Math.max(0, v)) : v));
      if (outl.slice(i * 6, i * 6 + 6).some((v, k) => !near(v, want[k], 1e-4))) kbad.push([f.id, c.part, '选框', outl.slice(i * 6, i * 6 + 6), want]);
    });
    if (f.reach && (outl.some((v) => v < 0 || v > 16) || coll.some((v) => v < 0 || v > 16))) kbad.push([f.id, '伸出格子的碰撞 / 选框没裁到 0..16']);
    if (f.solid) for (let i = 0; i < coll.length; i += 6) if (coll[i + 3] - coll[i] > 4 || coll[i + 5] - coll[i + 2] > 4) kbad.push([f.id, '碰撞不只是伞杆', coll.slice(i, i + 6)]);
    const nBox = f.cells.filter((c) => M.collideOf(f, c.part) !== 'none').length;
    if (coll.length !== nBox * 6) kbad.push([f.id, '碰撞盒个数', coll.length / 6, nBox]);
  }
  ok(!kbad.length && /Kind\[\] KINDS = \{/.test(java), `FurnitureShapes.java：第 2、3 轮 ${RK.length} 种的 Kind（大小、光、collide、碰撞盒、选框）和规格、模型一样`, kbad.slice(0, 3));
  const ks = (/Kind\[\] KINDS = \{([^}]*)\}/.exec(java) || [])[1] || '';
  ok(ks.split(',').map((q) => q.trim()).join() === RK.map((f) => f.id.toUpperCase()).join(), `FurnitureShapes.java：KINDS 是第 2、3 轮的 ${RK.length - R5.length} 种 + 相框（顺序 = 规格）`);
  // 照片画在哪（docs/PHOTOS.md 第 3 节）：export 从 .bbmodel 算的 = 规格里写的 = Java 里的；Kind.photoSlots() 走 photoSlots(id)
  const PH = M.list.filter((f) => f.photo);
  ok(PH.map((f) => f.id).join() === 'picture_frames,photo_frame', '有照片的家具：画框墙、相框', PH.map((f) => f.id));
  for (const f of PH) {
    const got = A.list.find((q) => q.id === f.id).photoSlots, m = new RegExp(`double\\[\\]\\[\\] ${f.id.toUpperCase()}_PHOTO_SLOTS = \\{(.*)\\};`).exec(java);
    const jv = m ? [...m[1].matchAll(/\{([^}]*)\}/g)].map((q) => q[1].split(',').map(Number)) : null;
    ok(JSON.stringify(got) === JSON.stringify(f.photoSlots) && JSON.stringify(jv) === JSON.stringify(f.photoSlots) && java.includes(`case "${f.id}": return ${f.id.toUpperCase()}_PHOTO_SLOTS;`),
      `${f.id}：photoSlots（${f.photoSlots.length} 行）.bbmodel 算出来的 = 规格 = FurnitureShapes.java`, { got, spec: f.photoSlots, java: jv });
    const bad = f.photoSlots.filter(([p, x0, y0, x1, y1, z]) => !f.cells.some((c) => (c.part == null ? 0 : +c.part) === p) || !(x1 > x0 && y1 > y0) || z < 0 || z > 16 || y0 < 0 || y1 > 16);
    ok(!bad.length, `${f.id}：每行的 part 都有，矩形不空，y、z 在这一格里`, bad);
  }
  ok(/public double\[\]\[\] photoSlots\(\) \{ return FurnitureShapes\.photoSlots\(id\); \}/.test(java) && /default: return NO_PHOTO_SLOTS;/.test(java), 'FurnitureShapes.java：Kind.photoSlots()、photoSlots(id)，没有照片的返回空数组');
  ok(JSON.stringify(M.byId('photo_frame').photoSlots) === '[[0,2,2,14,14,15]]', '相框：照片那块 2..14 × 2..14（正方形 12 像素），面在 z 15');
  // 画框墙：行号 = 56-furn-ground 的 FR 顺序（体素版的画布平面 canvas0..5 换到 MC 坐标，中心对得上）
  {
    const f = M.byId('picture_frames'), b = buildVoxel(f, f.layout, { keep: true }), W2U = worldToU(f, b.THREE), cv = [];
    b.o.traverse((m) => { if (/^canvas\d$/.test(m.name)) cv[+m.name.slice(6)] = new b.THREE.Vector3().setFromMatrixPosition(m.matrixWorld).applyMatrix4(W2U); });
    const off = (p) => f.cells.find((c) => (c.part == null ? 0 : +c.part) === p).offset;
    const bad = f.photoSlots.map(([p, x0, y0, x1, y1], i) => {
      const o = off(p), cx = (x0 + x1) / 2 + 16 * o[0], cy = (y0 + y1) / 2 + 16 * o[1], v = cv[i];
      return v && Math.abs(v.x / 2 - cx) <= 0.5 && Math.abs(v.y / 2 - cy) <= 0.5 ? null : [i, [cx, cy], v && [v.x / 2, v.y / 2]];
    }).filter(Boolean);
    ok(cv.length === 6 && !bad.length, '画框墙：photoSlots 第 i 行 = 体素版的画布 canvas i（中心差不到半像素）', bad);
  }
}

// ---------------- 简化（docs/FURNITURE.md 第 10 节） ----------------
{
  const OLD = {}, oldFiles = await buildFiles(REPO_DIR, { bbOf: (f) => (OLD[f.id] = OLD[f.id] || makeBb(f, { lite: false, vr: VR[f.id] })).bb });
  const lite = M.list.filter((f) => OLD[f.id].stats.cells.some((c) => c.elements > LIMIT));
  ok(lite.length === 25, `简化过的（老做法有一格超过 ${LIMIT} 个元素的）有 ${lite.length} 件`, lite.map((f) => f.id));
  for (const f of M.list) {
    const old = OLD[f.id], text = fs.readFileSync(bbFile(f.id), 'utf8').replace(/\r\n/g, '\n');
    if (!lite.includes(f)) { ok(text === old.text, `${f.id}：本来就 ≤ ${LIMIT}（${old.stats.cells.map((c) => c.elements).join(' / ')}），.bbmodel 和老做法一字不差`); continue; }
    if (f.id === 'telescope') {
      const bb = readBb(bbFile(f.id)), ex = A.list.find(q => q.id === f.id);
      ok(bb.elements.length <= LIMIT && bb.elements.filter(e => e.rotation?.some(Boolean)).length >= 10,
        '望远镜：手工旋转镜筒和三脚架，元素不超过32');
      ok(ex.shapes[0].outline[0].slice(0, 3).every(v => v >= 0) && ex.shapes[0].outline[0].slice(3).every(v => v <= 16)
        && ex.shapes[0].outline[0][1] === 0, '望远镜：旋转后的选框在一格内、脚底落地');
      continue;
    }
    // 碰撞盒、选框：只往里缩，每边不超过 1 像素（每格；第 1 轮的 3 件比 shapes 里的 boxes）
    const now = A.list.find((q) => q.id === f.id).shapes, was = oldFiles.list.find((q) => q.id === f.id).shapes, bad = [];
    now.forEach((sh, i) => {
      for (const k of ['boxes', 'outline']) sh[k].forEach((b, j) => {
        const o = was[i][k][j];
        if (!o || b.some((v, a) => (a < 3 ? v < o[a] - 1e-9 || v > o[a] + 1 + 1e-9 : v > o[a] + 1e-9 || v < o[a] - 1 - 1e-9))) bad.push([sh.part, k, o, b]);
      });
    });
    ok(!bad.length, `${f.id}：简化后碰撞盒、选框只往里缩、每边不超过 1 像素`, bad.slice(0, 2));
  }
  // 网页叠上去的部分对得上（u = 1/32 米；元素坐标 × 2 就是 u）：
  //   空碗里米饭那块、屏幕面板前面那层空着的格子没有元素盖着；
  //   屏幕平面：盖着平面那块的元素一个都没有穿过平面（没被盖住），面板的正面就在平面后面 2 毫米以内（不悬空）
  const covers = (e, u) => [0, 1, 2].every((a) => e.from[a] * 2 < u[a] + 0.5 - 1e-6 && e.to[a] * 2 > u[a] + 0.5 + 1e-6);   // 盖住这一格的中心
  for (const f of M.list) {
    const vr = VR[f.id];
    if (!(vr.keepOut || []).length && !(vr.screens || []).length) continue;
    const els = readBb(bbFile(f.id)).elements;
    const hit = vr.keepOut.filter((u) => els.some((e) => covers(e, u))), lost = (vr.pinned || []).filter((u) => !els.some((e) => [0, 1, 2].every((k) => e.from[k] * 2 <= u[k] + 0.5 + 1e-6 && e.to[k] * 2 >= u[k] + 0.5 - 1e-6)));
    ok(!hit.length, `${f.id}：网页叠上去的（${f.overlay.join('、')}）那块空着，没有元素盖着（${vr.keepOut.length} 个格子）`, hit.slice(0, 3));
    if ((vr.pinned || []).length) ok(!lost.length, `${f.id}：屏幕面板还在（${vr.pinned.length} 个格子）`, lost.slice(0, 3));
    for (const sc of vr.screens || []) {
      const inPlane = (e) => [0, 1, 2].every((a) => a === sc.ax || (e.from[a] * 2 < sc.hi[a] - 1e-6 && e.to[a] * 2 > sc.lo[a] + 1e-6));
      const front = (e) => (sc.sg < 0 ? e.from[sc.ax] * 2 : e.to[sc.ax] * 2), gap = (e) => (front(e) - sc.D) * -sc.sg;   // 正面在平面后面多远（u）
      const through = els.filter((e) => inPlane(e) && e.from[sc.ax] * 2 < sc.D - 1e-6 && e.to[sc.ax] * 2 > sc.D + 1e-6);
      const c = [0, 1, 2].map((a) => (sc.lo[a] + sc.hi[a]) / 2), behind = els.filter((e) => [0, 1, 2].every((a) => a === sc.ax || (e.from[a] * 2 <= c[a] && e.to[a] * 2 >= c[a])) && gap(e) >= 0);
      const g = Math.min(...behind.map(gap));
      ok(!through.length && g > 0 && g <= 0.1, `${f.id}：屏幕平面 ${sc.name} 没被盖住，面板正面在平面后面 ${(g / 32 * 1000).toFixed(1)} 毫米`, { through: through.map((e) => [e.name, e.from, e.to]).slice(0, 2), g });
    }
  }
  ok(VR.desk.screens.length === 1 && VR.tv_stand.screens.length === 1 && VR.kitchen_counter.keepOut.length > 0, '书桌、电视有屏幕平面，厨房台面有不许盖的米饭');
  const pole = readBb(bbFile('beach_parasol')).elements.filter((e) => e.name === '伞杆');
  ok(pole.length >= 3 && pole.every((e) => e.to[0] - e.from[0] <= 4 && e.to[2] - e.from[2] <= 4), `遮阳伞：伞杆的元素单独留着（${pole.length} 个，不和伞面合）`);
}

// ---------------- 用资源包画（16-mcmesh） ----------------
const V = loadV3(['14-mcjar', '15-mcmodel', '16-mcmesh', '17-mcfallback', '19-mcentity', '19-mclight', '44-furn-mc']).V3;
function allFacings() {   // 每件 4 个朝向排成一排，中间隔一格，底下垫一层橡木板
  const palette = ['minecraft:air', 'minecraft:oak_planks'], cells = [];
  let x = 0;
  for (const f of M.list) for (const facing of FACINGS) {
    const cs = M.cellsFor(f, facing), lo = [0, 2].map((a) => Math.min(...cs.map((c) => c.offset[a])));
    for (const c of cs) { palette.push(M.state(f, facing, c.part)); cells.push([x + c.offset[0] - lo[0], 1 + c.offset[1], 1 + c.offset[2] - lo[1], palette.length - 1]); }
    x += Math.max(...cs.map((c) => c.offset[0])) - lo[0] + 2;
  }
  const W = x, Hh = 4, Lz = 6, arr = new Array(W * Hh * Lz).fill(0);
  for (let i = 0; i < W; i++) for (let k = 0; k < Lz; k++) arr[i + k * W] = 1;
  for (const [cx, cy, cz, p] of cells) arr[cx + cz * W + cy * W * Lz] = p;
  return { size: [W, Hh, Lz], palette, cells: arr };
}
{
  const pack = V.mcjar.makePack(packFiles, { inflateZlib });
  const res = await V.mcmesh.build(allFacings(), { pack, ao: true, mipmaps: false });
  const own = res.stats.missingStates.filter((s) => s.includes('xiaojingyu:')), sp = res.stats.missingSprites.filter((s) => s.includes('xiaojingyu:'));
  ok(!own.length && !sp.length && !res.warnings.some((w) => w.includes('xiaojingyu')), `只用我们的资源包：${M.list.length} 种 × 4 个朝向都画得出来，没有缺模型、缺贴图`, { own, sp, w: res.warnings.slice(0, 3) });
  ok(res.stats.quads.translucent > 0 && res.stats.quads.solid > 500, '只用我们的资源包：贝壳柜的玻璃在半透明层', res.stats.quads);
}
if (JAR) {
  const jar = await V.mcjar.fromBytes(fs.readFileSync(JAR), { inflateRaw, inflateZlib });
  const pack = V.mcjar.makePack(new Map([...jar.files, ...packFiles]), { inflateZlib });
  const res = await V.mcmesh.build(allFacings(), { pack, ao: true, mipmaps: false });
  ok(!res.stats.missingStates.length && !res.stats.missingSprites.length && !res.stats.fallback && !res.warnings.length,
    `真 jar（${jar.version ? jar.version.id : '?'}）+ 我们的资源包：没有缺模型、缺贴图的警告`, { st: res.stats.missingStates, sp: res.stats.missingSprites, fb: res.stats.fallback, w: res.warnings.slice(0, 5) });
} else {
  ok(!REQUIRE_JAR, '有 jar（加了 --require-jar）', '没设置 MC_JAR');
  console.log('SKIP 真 jar + 我们的资源包：没设 MC_JAR');
}

console.log(`\n${fail ? 'FAIL' : 'PASS'}  furn-mc：${pass} 项通过，${fail} 项失败`);
process.exitCode = fail ? 1 : 0;
