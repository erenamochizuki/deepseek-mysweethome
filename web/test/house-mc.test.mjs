// test/house-mc.test.mjs — 小鲸鱼之家 v4 方块房子（P4 定稿，web/src/42-house-mc.js 的 V3.houseMc）的检查，不开浏览器
//   node test/house-mc.test.mjs                                   不查 jar（会打印 SKIP）
//   MC_JAR=<客户端 jar> node test/house-mc.test.mjs [--require-jar]  再用真 jar 查每种方块状态；--require-jar 时没 jar 算失败
// 第一个失败就停（exit 1）；全过打印 ALL PASS (N checks)。fixtures/house-v4 不一样时先跑 node tools/house-mc.mjs export。
import fs from 'node:fs';
import path from 'node:path';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { v3, openGrid, walk, parseState } from '../tools/lib/house-mc-grid.mjs';
import { buildFiles, checkFiles, HOUSE_DIR, ASSET_FILE } from '../tools/house-mc.mjs';
import { checkDrafts } from '../tools/lib/house-mc-drafts.mjs';

const REQUIRE_JAR = process.argv.includes('--require-jar');
const JAR = process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.MC_JAR || '';

class TestFail extends Error {}
let checks = 0;
const show = (x) => JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? `${v}n` : v));
function ok(cond, what, got) {
  checks++;
  if (!cond) throw new TestFail(`FAIL ${what}` + (got === undefined ? '' : `\n  got: ${typeof got === 'string' ? got : show(got)}`));
  console.log(`PASS ${what}`);
}
const die = (e) => {
  const msg = e instanceof TestFail ? e.message : `CRASH ${e && e.stack ? e.stack : e}`;
  process.stdout.write(msg + '\n', () => process.exit(1));
};
process.on('uncaughtException', die);
process.on('unhandledRejection', die);
const errorOf = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

const V = v3(), H = V.houseMc, S = V.share;
const IDS = H.variants.map((v) => v.id);
const builds = Object.fromEntries(IDS.map((id) => [id, H.build({ variant: id })]));
const STEPS = 24;   // 从台阶前走到阁楼的步数（docs/HOUSE-V4.md 里写的数）

// ---- 1. 只有定稿这一种（方案 B）；默认材料两色屋顶 + 平滑石英；模型写成鲸图再读回来一模一样 ----
ok(IDS.join(',') === 'b' && H.variants[0].label === '小鲸鱼之家 v4（方案 B）', '只有一个方案：b（小鲸鱼之家 v4）', H.variants);
ok(show(H.DEFAULTS) === show({ variant: 'b', roof: 'two', wall: 'quartz' }) && Object.isFrozen(H.DEFAULTS), 'DEFAULTS = 方案 b、两色屋顶、平滑石英', H.DEFAULTS);
ok(show(S.dump(H.build().model)) === show(S.dump(builds.b.model)) && show(S.dump(H.build({ roof: 'two', wall: 'quartz' }).model)) === show(S.dump(builds.b.model)),
  '不传参数 = 传 b = 默认材料');
ok(H.roofs.map((r) => r.id).join(',') === 'two,jungle,spruce' && H.walls.map((w) => w.id).join(',') === 'calcite,quartz', '材料小样还在：屋顶 3 种、墙面 2 种', [H.roofs, H.walls]);
ok(/方案/.test(errorOf(() => H.build({ variant: 'a' })) || '') && /方案/.test(errorOf(() => H.build({ variant: 'c' })) || '') && /gold/.test(errorOf(() => H.build({ roof: 'gold' })) || '')
  && /pink/.test(errorOf(() => H.build({ wall: 'pink' })) || ''), '方案 a（已经去掉）、不认识的方案 / 屋顶 / 墙面会报错');
const SIZE = { b: [20, 12, 23] }, OUTER = { b: [14, 10] };   // P5 第 3 轮起鲸图包住屋外的小物件（YARD）
for (const id of IDS) {
  const r = builds[id], m = r.model, meta = m.meta.compound, x = meta.Xiaojingyu.compound;
  ok(show(m.size) === show(SIZE[id]) && m.cells instanceof Int32Array && m.cells.length === m.size[0] * m.size[1] * m.size[2], `${id}：模型 ${m.size.join('×')}，cells 长度对`, m.size);
  ok(show(r.info.outer) === show(OUTER[id]) && r.info.inner[0] === OUTER[id][0] - 2 && r.info.inner[1] === OUTER[id][1] - 2, `${id}：外墙 ${OUTER[id].join('×')} 格，墙厚 1 格`, r.info);
  ok(x.Facing.string === 'north' && show(Array.from(x.Origin.intArray)) === '[-2,0,-2]' && x.FormatVersion.int === 1 && x.Source.string === S.SOURCE,
    `${id}：Metadata.Xiaojingyu 有 Facing north、Origin -2,0,-2、FormatVersion 1、Source`, S.dump(m).meta);
  ok(!('Date' in meta) && meta.Author.string === 'Moci' && meta.Name.string === '小鲸鱼之家 v4', `${id}：Name「小鲸鱼之家 v4」、Author Moci，没有 Date（导出两次才会一样）`, S.dump(m).meta);
  // 方块实体只有带照片的家具那几格（docs/PHOTOS.md 第 2 节：相册矮桌、相框、画框墙 part=0），Data 都是空的
  const beOk = m.blockEntities.every((be) => { const [x, y, z] = be.pos, s = m.palette[m.cells[x + z * m.size[0] + y * m.size[0] * m.size[2]]]; return be.id === H.furnBlockEntity(s) && be.data && Object.keys(be.data.compound || {}).length === 0; })
    && m.palette.every((s, k) => !H.furnBlockEntity(s) || m.cells.some((c, i) => c === k && m.blockEntities.some((be) => be.pos[0] + be.pos[2] * m.size[0] + be.pos[1] * m.size[0] * m.size[2] === i)));
  ok(m.dataVersion === S.DATA_VERSION && m.blockEntities.length === 2 && beOk && m.warnings.length === 0, `${id}：DataVersion ${S.DATA_VERSION}、只有相册矮桌和画框墙的 2 个空方块实体、没有警告`, m.blockEntities);
  const c = S.canonicalize(m);
  ok(show(c.palette) === show(m.palette) && c.cells.every((v, i) => v === m.cells[i]), `${id}：本来就是规范形式（调色板按第一次出现排，没有用不到的）`);
  const back = await S.read(await S.writePng(m));
  ok(S.equalDump(S.dump(back), S.dump(m)) && back.warnings.length === 0, `${id}：写成鲸图再读回来，dump 一样`);
}

// ---- 2. 方块状态字符串：和游戏写的一样（属性写全、按名字排序），只用这几种方块 ----
const DIR4 = ['east', 'north', 'south', 'west'], TF = ['false', 'true'];
const PROPS = {   // MC 26.1 源码里这些方块的全部属性（blockstates JSON 里不写 waterlogged，所以照源码写死在这里）
  stairs: { facing: DIR4, half: ['bottom', 'top'], shape: ['inner_left', 'inner_right', 'outer_left', 'outer_right', 'straight'], waterlogged: TF },
  fence: { east: TF, north: TF, south: TF, waterlogged: TF, west: TF },
  pane: { east: TF, north: TF, south: TF, waterlogged: TF, west: TF },
  door: { facing: DIR4, half: ['lower', 'upper'], hinge: ['left', 'right'], open: TF, powered: TF },
  slab: { type: ['bottom', 'double', 'top'], waterlogged: TF },
  log: { axis: ['x', 'y', 'z'] },
  lantern: { hanging: TF, waterlogged: TF },
  plain: {},
  // P5 模组家具（docs/FURNITURE.md 第 2 节）
  furnBed: { facing: DIR4, part: ['foot', 'head'] },
  furnTable: { facing: DIR4 },
  furnCase: { facing: DIR4, part: ['left', 'right'] },
};
const FURN_FAMILY = { 'xiaojingyu:bed': 'furnBed', 'xiaojingyu:dining_table': 'furnTable', 'xiaojingyu:shell_case': 'furnCase' };
const familyOf = (id) => (FURN_FAMILY[id] ? FURN_FAMILY[id] : /_stairs$/.test(id) ? 'stairs' : /_fence$/.test(id) ? 'fence' : /_pane$/.test(id) ? 'pane' : /_door$/.test(id) ? 'door'
  : /_slab$/.test(id) ? 'slab' : /_log$/.test(id) ? 'log' : id === 'lantern' ? 'lantern' : 'plain');
const ALLOWED = new Set(['air', 'calcite', 'smooth_quartz', 'stripped_spruce_log', 'oak_planks', 'oak_stairs', 'oak_door', 'spruce_fence',
  'glass_pane', 'lantern', 'jungle_stairs', 'spruce_stairs', 'jungle_slab', 'spruce_slab']);
const STATE_RE = /^(minecraft|xiaojingyu):[a-z0-9_]+(\[[a-z0-9_]+=[a-z0-9_]+(,[a-z0-9_]+=[a-z0-9_]+)*\])?$/;
const FURN2_IDS = new Set(H.FURN2.map((r) => 'xiaojingyu:' + r[0]));
const FURN2_CELLS = new Map(H.FURN2.map((r) => ['xiaojingyu:' + r[0], (r[2][1] - r[2][0] + 1) * (r[3][1] - r[3][0] + 1) * (r[4][1] - r[4][0] + 1)]));
const allStates = new Set(), bad = [];
for (const id of IDS) for (const roof of H.roofs) for (const wall of H.walls) {
  for (const s of H.build({ variant: id, roof: roof.id, wall: wall.id }).model.palette) allStates.add(s);
}
for (const s of allStates) {
  if (!STATE_RE.test(s)) { bad.push(s + '（格式不对）'); continue; }
  const st = parseState(s), full = s.replace(/\[.*$/, ''), mod = !full.startsWith('minecraft:');
  const want = PROPS[familyOf(mod ? full : st.id)], keys = Object.keys(st.props);
  if (mod && FURN2_IDS.has(full)) {                                     // 第 2 轮（FURNITURE.md 8.1）：facing，多格的再加数字 part
    const n = FURN2_CELLS.get(full), keys2 = Object.keys(st.props).join(',');
    if (keys2 !== (n > 1 ? 'facing,part' : 'facing') || !DIR4.includes(st.props.facing) || (n > 1 && !(/^\d+$/.test(st.props.part) && +st.props.part < n)))
      bad.push(s + '（第 2 轮家具：属性应该是 facing' + (n > 1 ? ',part（0..' + (n - 1) + '）' : '') + '）');
    continue;
  }
  if (mod ? !FURN_FAMILY[full] : !ALLOWED.has(st.id)) bad.push(s + '（没登记的方块）');
  if (keys.join(',') !== Object.keys(want).join(',')) bad.push(s + '（属性应该正好是 ' + (Object.keys(want).join(',') || '没有') + '，按名字排序）');
  for (const k of keys) if (want[k] && !want[k].includes(st.props[k])) bad.push(s + `（${k}=${st.props[k]} 不认识）`);
}
ok(bad.length === 0, `所有方案 × 屋顶 × 墙面一共 ${allStates.size} 种状态：格式对、属性写全、按名字排序、只用登记的方块`, bad);
for (const roof of H.roofs) for (const wall of H.walls) {
  const r = H.build({ roof: roof.id, wall: wall.id }), woods = new Set(), whites = new Set();
  r.model.cells.forEach((c, i) => {
    const st = parseState(r.model.palette[c]);
    if ((r.parts[i] || '').startsWith('屋顶/')) woods.add(st.id.split('_')[0]);
    if (st.id === 'calcite' || st.id === 'smooth_quartz') whites.add(st.id);
  });
  const name = r.model.meta.compound.Name.string, isDef = roof.id === H.DEFAULTS.roof && wall.id === H.DEFAULTS.wall;
  ok([...woods].sort().join(',') === (roof.id === 'two' ? 'jungle,spruce' : roof.id) && [...whites].join(',') === (wall.id === 'quartz' ? 'smooth_quartz' : 'calcite')
    && (isDef ? name === '小鲸鱼之家 v4' : /^小鲸鱼之家 v4（.+）$/.test(name)),
    `材料开关：屋顶 ${roof.id} + 墙面 ${wall.id}（名字「${name}」）`, { woods: [...woods], whites: [...whites], name });
}

// ---- 3. parts：和 cells 一样长，空气是 null，每个方块都有部件，部件和大类都有中文名 ----
const TOPS = ['墙', '门窗', '一楼', '阁楼', '屋顶', '门廊', '家具'];   // 家具：P5 的模组家具方块
for (const id of IDS) {
  const r = builds[id], m = r.model, air = m.palette.indexOf('minecraft:air'), wrong = [];
  m.cells.forEach((c, i) => { if ((c === air) !== (r.parts[i] === null)) wrong.push(i); });
  const used = [...new Set(r.parts.filter(Boolean))];
  ok(air >= 0 && r.parts.length === m.cells.length && wrong.length === 0, `${id}：parts 和 cells 一样长，空气是 null，方块都有部件`, wrong.slice(0, 5));
  ok(used.every((p) => p.split('/').length === 2 && TOPS.includes(p.split('/')[0])), `${id}：部件都是「大类/名字」，大类是 ${TOPS.join('、')}`, used);
  const noLabel = [...used, ...TOPS, '家具'].filter((p) => !r.labels[p]);
  ok(noLabel.length === 0, `${id}：${used.length} 个部件和各个大类都有中文名`, noLabel);
  // P5 起家具都是模组方块：占位盒子没了，家具方块都在「家具/」下面（3 件第 1 轮 + 22 种第 2 轮）
  const furnParts = new Set(used.filter((p) => p.startsWith('家具/')));
  ok(r.furniture.length === 0 && furnParts.size === 40, `${id}：没有占位盒子了，家具方块 ${furnParts.size} 种（床、餐桌、贝壳柜 + 第 2 轮 22 种 + 第 3 轮屋外 15 种）`, [...furnParts]);
}

// ---- 4. 同样的输入两次结果一样；导出的文件两次逐字节一样 ----
for (const id of IDS) {
  const a = H.build({ variant: id }), b = H.build({ variant: id });
  ok(show({ ...a, model: S.dump(a.model) }) === show({ ...b, model: S.dump(b.model) }), `${id}：建两次结果一样`);
}
const f1 = await buildFiles(), f2 = await buildFiles();
ok(f1.size === 3 && [...f1].every(([n, buf]) => Buffer.compare(buf, f2.get(n)) === 0), '导出两次逐字节一样（3 个文件）', [...f1.keys()]);
ok(show([...f1.keys()].sort()) === show(['fixtures/house-v4/house-v4-b.json', 'fixtures/house-v4/house-v4-b.png', 'web/assets/house/house-v4.png'])
  && Buffer.compare(f1.get('fixtures/house-v4/house-v4-b.png'), f1.get('web/assets/house/house-v4.png')) === 0,
  '导出：fixtures 的鲸图和 dump，再加一份同样字节的 web/assets/house/house-v4.png（游戏页内嵌）', [...f1.keys()]);
// ---- 5. 连接：楼梯拐角、栅栏、玻璃板照 MC 26.1 源码重新算一遍，必须和写的一样（P4 卡片在游戏里还会再核一次）----
const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
const STEP = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const axis = (f) => (f === 'north' || f === 'south' ? 'z' : 'x');
function stairShape(G, x, y, z) {   // StairBlock.getStairsShape / canTakeShape
  const me = G.state(x, y, z).props, at = (d) => [x + STEP[d][0], y, z + STEP[d][1]];
  const stairs = (p) => (G.kind(...p) === 'stairs' ? G.state(...p).props : null);
  const canTake = (d) => { const n = stairs(at(d)); return !n || n.facing !== me.facing || n.half !== me.half; };
  const b = stairs(at(me.facing));
  if (b && b.half === me.half && axis(b.facing) !== axis(me.facing) && canTake(OPP[b.facing])) return b.facing === CCW[me.facing] ? 'outer_left' : 'outer_right';
  const f = stairs(at(OPP[me.facing]));
  if (f && f.half === me.half && axis(f.facing) !== axis(me.facing) && canTake(f.facing)) return f.facing === CCW[me.facing] ? 'inner_left' : 'inner_right';
  return 'straight';
}
const wrongConn = [], corners = [];
for (const id of IDS) for (const roof of H.roofs) for (const wall of H.walls) {
  const G = openGrid(H.build({ variant: id, roof: roof.id, wall: wall.id }));
  let n = 0;
  G.each((x, y, z, st) => {
    const fam = familyOf(st.id), here = `${id}/${roof.id}/${wall.id} ${x},${y},${z} ${st.id}`;
    if (fam === 'stairs') {
      const want = stairShape(G, x, y, z);
      if (want !== st.props.shape) wrongConn.push(`${here} shape=${st.props.shape}，算出来是 ${want}`);
      if (want !== 'straight') n++;
    }
    if (fam !== 'fence' && fam !== 'pane') return;
    for (const d of DIR4) {   // 栅栏：整块的结实面 / 同类栅栏；玻璃板：整块的结实面 / 玻璃板（别的这里没有，有就报出来）
      const nx = x + STEP[d][0], nz = z + STEP[d][1], nk = G.kind(nx, y, nz), nf = familyOf(G.state(nx, y, nz).id);
      // 模组家具（P5）：那一面不是完整的实心面，不连（开发 MC 的 /shapes 核对过）
      const furnN = G.string(nx, y, nz).startsWith('xiaojingyu:');
      if (furnN) { if (st.props[d] !== 'false') wrongConn.push(`${here} ${d}=${st.props[d]}，旁边是模组家具，应该不连`); continue; }
      if (nk !== 'air' && nk !== 'full' && nf !== fam) wrongConn.push(`${here} ${d} 边是 ${G.string(nx, y, nz)}，这个测试没算它连不连`);
      const want = String(nk === 'full' || nf === fam);
      if (st.props[d] !== want) wrongConn.push(`${here} ${d}=${st.props[d]}，算出来是 ${want}`);
    }
  });
  corners.push(n);
}
ok(wrongConn.length === 0, `楼梯形状、栅栏和玻璃板的连接照 26.1 源码重新算，${corners.length} 种组合（方案 × 屋顶 × 墙面）都一样`, wrongConn.slice(0, 8));
ok(corners.every((n) => n === 4), '每种组合正好 4 块拐角楼梯（小山墙和主屋顶交界的山谷），其余都是直的', corners);
{
  const G = openGrid(builds.b), at = (x, y, z) => { const st = G.state(x, y, z); return st.id + ' ' + st.props.facing + ' ' + st.props.shape; };
  const want = [[-4, 6, -7, 'spruce_stairs north inner_right'], [-3, 7, -8, 'jungle_stairs north inner_right'],
    [0, 6, -7, 'spruce_stairs north inner_left'], [-1, 7, -8, 'jungle_stairs north inner_left']];
  const got = want.map(([x, y, z]) => at(x, y, z));
  ok(show(got) === show(want.map((w) => w[3])), '4 块拐角楼梯的位置和形状（fixtures/house-v4/README.md 里列的那几块）', got);
}

// ---- 6. 门、灯笼放得住；灯笼不挡路 ----
const sturdyCenter = (st, kind, face) => {   // Block.canSupportCenter：站着的灯看下面那块的顶面（up），吊着的灯看上面那块的底面（down）
  if (kind === 'full') return true;
  if (face === 'up') return /_fence$/.test(st.id) || kind === 'slabTop' || (kind === 'stairs' && st.props.half === 'top');
  return kind === 'slabBottom' || (kind === 'stairs' && st.props.half === 'bottom');
};
for (const id of IDS) {
  const r = builds[id], G = openGrid(r), d = r.info.door, z = r.info.grid.z1;
  const lo = G.state(d.x, 1, z), up = G.state(d.x, 2, z);
  ok(/_door$/.test(lo.id) && lo.props.half === 'lower' && up.id === lo.id && up.props.half === 'upper'
    && ['facing', 'hinge', 'open', 'powered'].every((k) => lo.props[k] === up.props[k]), `${id}：门上下两半齐全，朝向、合页、开关一致`, [lo, up]);
  ok(G.kind(d.x, 0, z) === 'full' && G.state(d.x, 3, z).id === r.info.wall.block && G.kind(d.x, 4, z) === 'full',
    `${id}：门下面是整块（地梁，门才放得住），门上面 y=3 是白墙，再上面是腰梁`, [G.string(d.x, 0, z), G.string(d.x, 3, z), G.string(d.x, 4, z)]);
  const panes = [];
  G.each((x, y, zz, st) => { if (st.id === 'glass_pane' && y === 2) panes.push([x, zz, G.string(x, 1, zz), G.string(x, 3, zz)]); });
  ok(panes.length === 7 && panes.every((p) => p[2] === 'minecraft:' + r.info.wall.block && p[3] === 'minecraft:' + r.info.wall.block),
    `${id}：一楼 7 格窗都在 y=2（离地板 1 米、1 米高），上下都是白墙`, panes);
  ok(d.y1 - d.y0 >= 2 && [z - 1, z + 1].every((zz) => G.open(d.x, 1, zz) && G.open(d.x, 2, zz)), `${id}：门洞 ${d.y1 - d.y0} 米高，门里门外各空两格`);
  const lamps = [];
  G.each((x, y, zz, st) => { if (st.id === 'lantern') lamps.push({ x, y, z: zz, hanging: st.props.hanging === 'true', part: r.parts[G.idx(x, y, zz)] }); });
  const broken = lamps.filter((l) => { const dy = l.hanging ? 1 : -1; return !sturdyCenter(G.state(l.x, l.y + dy, l.z), G.kind(l.x, l.y + dy, l.z), l.hanging ? 'down' : 'up'); });
  ok(lamps.length === 6 && broken.length === 0, `${id}：6 盏灯笼（一楼 1、阁楼 1、门廊 4）都放得住（一楼的吊在整根木梁下）`, broken);
  const g = r.info.grid, l1 = lamps.find((l) => l.part === '一楼/吊灯'), l2 = lamps.find((l) => l.part === '阁楼/吊灯');
  ok(l1 && l1.hanging && show([l1.x, l1.y, l1.z]) === show([g.midX, g.beamY - 1, g.lampZ]) && G.part(g.midX, g.beamY, g.lampZ) === '一楼/灯梁'
    && l2 && l2.hanging && show([l2.x, l2.y, l2.z]) === show([g.doorX, g.ridgeY - 1, g.ridgeZ]),
    `${id}：一楼的灯吊在灯梁下 (${g.midX}, ${g.beamY - 1}, ${g.lampZ})，灯底离地板约 2 米；阁楼的吊在屋脊台阶下`, [l1, l2]);
  ok(show(lamps.map((l) => l.part).sort()) === show(['一楼/吊灯', '门廊/灯', '门廊/灯', '门廊/灯', '门廊/灯', '阁楼/吊灯'].sort()), `${id}：灯笼的部件对`, lamps);
  // 灯笼碰撞箱只会碰到「脚在灯笼下面一格」的人（人高 1.8 米）。那一格本来就不该是走路的地方：下面要么是家具，要么脚下没东西
  const blocksF = (x, y, zz) => r.furniture.some(({ box: b }) => b[4] - b[1] > 0.2 && x + 0.5 > b[0] && x + 0.5 < b[3] && zz + 0.5 > b[2] && zz + 0.5 < b[5] && b[1] < y + 1.8 && b[4] > y);
  const overPath = lamps.filter((l) => {
    const y = l.y - 1, below = G.kind(l.x, y - 1, l.z);
    return (y === 0 || below === 'full' || below === 'slabTop' || below === 'stairs') && G.open(l.x, y, l.z) && !blocksF(l.x, y, l.z);
  });
  ok(overPath.length === 0, `${id}：灯笼都不在走路的地方上头（一楼那盏离地板 2 米多、在餐桌上方，阁楼那盏离地板 4 米多，门廊的站在栏杆柱上）`, overPath);
}

// ---- 7. 走得通：从台阶前进门、上楼梯、到阁楼（她占 1×2 格；不算家具、算上家具都要通）----
for (const id of IDS) {
  const r = builds[id], G = openGrid(r), d = r.info.door, s = r.info.stairs, ly = r.info.loftFloorY;
  for (const [what, opts] of [['不算家具', {}], ['算上家具', { furniture: r.furniture }]]) {
    const w = walk(G, opts), at = new Set(w.path.map((p) => p.join(',')));
    ok(w.ok && w.path.length - 1 === STEPS, `${id}：${what}，从台阶前走得到阁楼（${w.ok ? w.path.length - 1 + ' 步' : '走不到'}，应该是 ${STEPS} 步）`, w.reason);
    ok(at.has(`${d.x},1,${r.info.grid.z1}`) && at.has(`${s.x},${ly},${s.z1}`), `${id}：${what}，路线穿过门，从楼梯最上一级上到阁楼`, w.path);
  }
  const reach = walk(G, { furniture: r.furniture, goal: () => false }).reached;
  const miss = r.anchors.filter((a) => !reach.has(a.pos.map(Math.floor).join(',')));
  ok(r.anchors.length === 7 && miss.length === 0, `${id}：7 个锚点（台阶前、门外、门里、一楼中间、楼梯下、楼梯上、阁楼中间）算上家具都走得到`, miss);
}

// ---- 8. 家具占位：盒子正常、在屋里、在自己那层地板上、不和方块重叠 ----
for (const id of IDS) {
  const r = builds[id], G = openGrid(r), g = r.info.grid, wrong = [];
  for (const f of r.furniture) {
    const b = f.box, lv = r.levels.find((l) => l.id === f.level);
    if (!(b[0] < b[3] && b[1] < b[4] && b[2] < b[5])) wrong.push(f.id + ' 盒子反了');
    if (b[0] < g.x0 + 1 || b[3] > g.x1 || b[2] < g.z0 + 1 || b[5] > g.z1) wrong.push(f.id + ' 出了墙');
    if (!lv || b[1] < lv.floorY) wrong.push(f.id + ' 低于自己那层的地板');
    for (let x = Math.floor(b[0]); x < Math.ceil(b[3]); x++) for (let y = Math.floor(b[1]); y < Math.ceil(b[4]); y++) for (let z = Math.floor(b[2]); z < Math.ceil(b[5]); z++) {
      const k = G.kind(x, y, z);
      if (k !== 'air' && G.state(x, y, z).id !== 'lantern') wrong.push(`${f.id} 和 ${x},${y},${z} 的 ${G.string(x, y, z)} 重叠`);
    }
  }
  ok(wrong.length === 0, `${id}：${r.furniture.length} 件家具都在屋里、在自己那层地板上、不和方块重叠`, wrong);
  // 第 2 轮的家具方块（FURNITURE.md 8.2；42 的 FURN2）：摆放表里每一格都是那种方块、朝向对
  const badF2 = [];
  for (const [fid, facing, xs, ys, zs] of H.FURN2) for (let y = ys[0]; y <= ys[1]; y++) for (let x = xs[0]; x <= xs[1]; x++) for (let z = zs[0]; z <= zs[1]; z++) {
    const s = G.string(x, y, z);
    if (!s.startsWith('xiaojingyu:' + fid + '[')) badF2.push(`${fid} ${x},${y},${z} 是 ${s}`);
    else if (!s.includes('facing=' + facing)) badF2.push(`${fid} ${x},${y},${z} 朝向不对：${s}`);
  }
  ok(badF2.length === 0, `${id}：第 2 轮的家具（${H.FURN2.length} 条摆放）都在房子里，朝向对`, badF2.slice(0, 5));
}

// ---- 9. info 里的数字和方块对得上：高度、阁楼地板、楼梯和楼梯口、屋脊盖板 ----
for (const id of IDS) {
  const r = builds[id], G = openGrid(r), g = r.info.grid, i = r.info, st = i.stairs;
  ok(i.floorY === 1 && i.groundClear === 3 && i.loftFloorY === 5 && i.wallTop === 6 && i.kneeWall === 1 && i.ridgeTop === 11.5 && i.cap === true && g.beamY === 4,
    `${id}：一楼地面 1 米、净高 3 米、阁楼地面 5 米、矮墙顶 6 米、屋脊顶 11.5 米（含盖板）`, i);
  ok(show(r.levels) === show([{ id: 'ground', label: '一楼', y0: 0, y1: 3, floorY: 1 }, { id: 'loft', label: '阁楼', y0: 4, y1: 5, floorY: 5 }]), `${id}：levels 一楼 y 0–3、阁楼 y 4–5`, r.levels);
  // 阁楼地板（y=4）：整块橡木木板，正中一条整根木梁（灯梁）；楼梯口和最上一级除外
  const y4 = new Set(), y123 = new Set();
  for (let x = g.x0 + 1; x < g.x1; x++) for (let z = g.z0 + 1; z < g.z1; z++) {
    if (x === st.x && z >= st.hole[0] && z <= st.z1) continue;
    y4.add(G.state(x, g.beamY, z).id + (x === g.midX ? '@正中' : ''));
    if (x === st.x && z >= st.z0 && z <= st.z1) continue;   // 楼梯那一列
    for (let y = 1; y < g.beamY; y++) if (G.kind(x, y, z) !== 'air' && G.part(x, y, z) !== '一楼/吊灯' && !String(G.part(x, y, z) || '').startsWith('家具/')) y123.add(`${x},${y},${z} ${G.string(x, y, z)}`);
  }
  ok(show([...y4].sort()) === show(['oak_planks', 'stripped_spruce_log@正中']), `${id}：阁楼地板是整块橡木木板（4–5 米），正中一条整根木梁（灯梁）`, [...y4]);
  ok(y123.size === 0, `${id}：一楼屋里 y=1–3 除了楼梯、吊灯和家具都是空的（净高 3 米）`, [...y123].slice(0, 5));
  // 外墙：y=1–3 是白墙 / 柱子 / 门窗，y=4 一圈腰梁，南北墙 y=5 矮墙，四角柱子 y=0–5
  const ring = [], bad = [];
  for (let x = g.x0; x <= g.x1; x++) for (const z of [g.z0, g.z1]) ring.push([x, z]);
  for (let z = g.z0 + 1; z < g.z1; z++) for (const x of [g.x0, g.x1]) ring.push([x, z]);
  for (const [x, z] of ring) {
    const corner = (x === g.x0 || x === g.x1) && (z === g.z0 || z === g.z1);
    if (corner) { for (let y = 0; y <= 5; y++) if (G.string(x, y, z) !== 'minecraft:stripped_spruce_log[axis=y]') bad.push(`${x},${y},${z} 四角柱子`); continue; }
    if (G.state(x, 4, z).id !== 'stripped_spruce_log' || G.state(x, 4, z).props.axis === 'y') bad.push(`${x},4,${z} 不是横放的腰梁：${G.string(x, 4, z)}`);
    for (let y = 1; y <= 3; y++) if (!['full', 'door'].includes(G.kind(x, y, z)) && G.state(x, y, z).id !== 'glass_pane') bad.push(`${x},${y},${z} ${G.string(x, y, z)}`);
    if ((z === g.z0 || z === g.z1) && G.state(x, 5, z).id !== i.wall.block) bad.push(`${x},5,${z} 不是矮墙：${G.string(x, 5, z)}`);
  }
  ok(bad.length === 0, `${id}：外墙 y=1–3 是白墙、柱子、门窗，y=4 一圈腰梁，南北墙 y=5 是矮墙，四角柱子 y=0–5`, bad.slice(0, 6));
  // 楼梯：4 级，x = stairX，y 1–4 对 z stairZ..stairZ+3，朝南，下面填满木板；楼梯口 4 格，西边一排栅栏
  const stair = [], hole = [];
  for (let k = 0; k < st.steps; k++) {
    stair.push(G.string(st.x, 1 + k, st.z0 + k));
    for (let y = 1; y <= k; y++) if (G.state(st.x, y, st.z0 + k).id !== 'oak_planks') stair.push(`${st.x},${y},${st.z0 + k} 下面没填满`);
  }
  for (let z = st.hole[0]; z <= st.hole[1]; z++) hole.push(G.kind(st.x, g.beamY, z) + '/' + G.state(st.x - 1, i.loftFloorY, z).id);
  ok(st.steps === 4 && st.z0 === -14 && st.z1 === -11 && stair.every((s) => s === 'minecraft:oak_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]'),
    `${id}：楼梯 4 级，x=${st.x}、z ${st.z0} → ${st.z1}、y 1 → 4，朝南，下面填满木板`, stair);
  ok(show(st.hole) === show([st.z0 - 1, st.z0 + 2]) && hole.every((h) => h === 'air/spruce_fence') && G.kind(st.x, g.beamY, st.hole[1] + 1) === 'stairs'
    && G.kind(st.x, g.beamY, st.z1 + 1) === 'full' && G.state(st.x - 1, i.loftFloorY, st.z0 - 2).id === i.wall.block,
    `${id}：楼梯口 z ${st.hole[0]} → ${st.hole[1]} 共 4 格（站的那格 + 前三级上方），西边 4 格栅栏，北边矮墙，出口 z ${st.z1 + 1}`, hole);
  // 上楼不碰头：站在第 k 级上（脚在这级顶上），身子还有一半在后面那格，两列从脚到 1.8 米都要空
  const bump = [];
  for (let k = 0; k < st.steps; k++) {
    const feet = 2 + k;
    for (const z of [st.z0 + k, st.z0 + k - 1]) for (let y = feet; y < Math.ceil(feet + 1.8); y++) if (G.kind(st.x, y, z) !== 'air') bump.push(`第 ${k + 1} 级：${st.x},${y},${z} ${G.string(st.x, y, z)}`);
  }
  ok(bump.length === 0, `${id}：上楼梯时每一级头顶 1.8 米都是空的（连上后面那格）`, bump);
  // 阁楼净高；屋脊盖板
  const clear = [];
  // 量西边第二列（第一列靠西墙放着贝壳柜）
  for (let z = g.z1 - 1; z > g.z0; z--) { let y = i.loftFloorY; while (['air', 'none'].includes(G.kind(g.x0 + 2, y, z))) y++; clear.push(y - i.loftFloorY); }   // 串灯（没有碰撞）不算顶
  ok(show(clear) === show(i.loftClear) && show(clear) === show([2, 3, 4, 5, 5, 4, 3, 2]), `${id}：阁楼净高（从南往北）${clear.join(' / ')} 米，和 info 一样`, [clear, i.loftClear]);
  const capY = g.ridgeY + 1, capWant = `minecraft:${i.roof.cap}_slab[type=bottom,waterlogged=false]`, cap = [];
  G.each((x, y, z, s0, kind, part) => {
    if (kind === 'air') return;
    if (y === capY) { if (G.string(x, y, z) !== capWant || part !== '屋顶/屋脊盖板' || (z !== g.ridgeZ && z !== g.ridgeZ - 1)) cap.push(`${x},${y},${z} ${G.string(x, y, z)} ${part}`); }
    else if (part === '屋顶/屋脊盖板') cap.push(`${x},${y},${z} 盖板不在 y=${capY}`);
  });
  let nCap = 0;
  for (let x = g.minX; x <= g.maxX; x++) for (const z of [g.ridgeZ, g.ridgeZ - 1]) {
    const under = G.state(x, g.ridgeY, z);
    if (G.string(x, capY, z) === capWant && under.id.endsWith('_stairs') && under.props.half === 'bottom'
      && under.props.facing === (z === g.ridgeZ ? 'north' : 'south')) nCap++;
  }
  ok(cap.length === 0 && nCap === 2 * (g.maxX - g.minX + 1), `${id}：屋脊盖板 ${nCap} 块：y=${capY}，铺在背靠背的两排台阶上面，x ${g.minX} → ${g.maxX}（含山墙挑檐），${i.roof.cap} 下半砖`, cap.slice(0, 5));
  let top = 0;
  G.each((x, y, z, s0, kind) => { if (kind !== 'air') top = Math.max(top, y + (kind === 'slabBottom' ? 0.5 : 1)); });
  ok(top === i.ridgeTop, `${id}：最高处 ${top} 米（盖板顶）`, [top, i.ridgeTop]);
}

// ---- 10. 有 jar 时：每种状态在 MC 26.1.2 里都能精确选中（不靠宽松匹配）----
let jarSkipped = false;
if (JAR && fs.existsSync(JAR)) {
  const t0 = Date.now(), MC = loadV3(['14-mcjar', '15-mcmodel']).V3;
  const jar = await MC.mcjar.fromBytes(new Uint8Array(fs.readFileSync(JAR)));
  // P5 模组家具：和网页一样，把模组自己的资源（mod/src/main/resources/assets/xiaojingyu/blockstates|models|textures）盖在 jar 上面一起查；
  // 模组资源还没导出（P5 做到一半）时跳过模组的状态，写明原因
  const MODA = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'mod', 'src', 'main', 'resources');
  const modFiles = new Map(), walkDir = (d, rel) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) { const p = path.join(d, f), r = rel + '/' + f; if (fs.statSync(p).isDirectory()) walkDir(p, r); else modFiles.set(r.slice(1), new Uint8Array(fs.readFileSync(p))); } };
  for (const sub of ['blockstates', 'models', 'textures']) walkDir(path.join(MODA, 'assets', 'xiaojingyu', sub), '/assets/xiaojingyu/' + sub);
  const hasMod = [...modFiles.keys()].some((k) => k.includes('/blockstates/'));
  const pack = hasMod ? MC.mcjar.makePack(new Map([...jar.files, ...modFiles]), { key: jar.key + '+xjy', inflateZlib: jar.inflateZlib }) : jar;
  if (!hasMod) console.log('######## SKIP 模组家具的状态：mod/src/main/resources/assets/xiaojingyu/blockstates 还没有（P5 的 furn-mc export 之后再查）########');
  const R = MC.mcmodel.createResolver(pack), miss = [];
  for (const s of allStates) {
    if (s === 'minecraft:air' || (!hasMod && s.startsWith('xiaojingyu:'))) continue;
    const sel = R.select(MC.mcmodel.parseState(s), [0, 0, 0]);
    if (sel.status !== 'ok' || !sel.parts.length) miss.push(`${s} → ${sel.status}`);
  }
  ok(jar.version && jar.version.worldVersion === S.DATA_VERSION, `jar 是 ${jar.version && jar.version.id}（worldVersion ${S.DATA_VERSION}）`, jar.version);
  ok(miss.length === 0 && R.warnings.length === 0, `jar 里查 ${allStates.size - 1} 种状态都精确选中（${Date.now() - t0} ms）`, { miss, warnings: R.warnings });
} else {
  ok(!REQUIRE_JAR, '有 jar（加了 --require-jar）', JAR || '没设置 MC_JAR');
  jarSkipped = true;
  console.log('######## SKIP 没用真 jar 查方块状态：设置 MC_JAR=<客户端 jar> 再跑一次 ########');
}

// ---- 11. fixtures/house-v4 和 web/assets/house/house-v4.png 和重新生成的一样 ----
const chk = await checkFiles();
ok(chk.problems.length === 0, `fixtures/house-v4 和 web/assets/house 的 ${chk.files} 个文件和重新生成的一样（不一样先跑 node tools/house-mc.mjs export）`, chk.problems);
for (const id of IDS) {
  const png = new Uint8Array(fs.readFileSync(path.join(HOUSE_DIR, `house-v4-${id}.png`)));
  const json = JSON.parse(fs.readFileSync(path.join(HOUSE_DIR, `house-v4-${id}.json`), 'utf8'));
  ok(S.equalDump(S.dump(await S.read(png)), json) && S.equalDump(json, S.dump(builds[id].model)), `${id}：house-v4-${id}.png 里的方块数据 = house-v4-${id}.json = 生成器`);
}
ok(Buffer.compare(fs.readFileSync(ASSET_FILE), fs.readFileSync(path.join(HOUSE_DIR, 'house-v4-b.png'))) === 0, 'web/assets/house/house-v4.png 和 fixtures/house-v4/house-v4-b.png 字节一样');
ok(!fs.readdirSync(HOUSE_DIR).some((n) => /^house-v4-a\./.test(n)), 'fixtures/house-v4 里没有方案 A 的文件了');

// ---- 12. 2D 图（web/refs/house-v4）和重新生成的一样：SVG 逐字节，PNG 查在不在、尺寸对不对 ----
// refs/ 不进 git（.gitignore）：刚克隆的仓库里没有这些图，只在本机生成过（node tools/house-mc.mjs drafts）时才比
const draftsDir = path.join(path.dirname(path.dirname(HOUSE_DIR)), 'web', 'refs', 'house-v4');
let draftsSkipped = false;
if (!fs.existsSync(draftsDir)) {
  draftsSkipped = true;
  console.log('SKIP web/refs/house-v4 不在（refs/ 不进仓库）：没比 2D 图；要比就先跑 node tools/house-mc.mjs drafts');
} else {
  const drafts = checkDrafts();
  ok(drafts.problems.length === 0, `web/refs/house-v4 的 ${drafts.files} 个 2D 图文件和重新生成的一样（不一样先跑 node tools/house-mc.mjs drafts）`, drafts.problems);
}
// 第 1 轮是在对话里答的。用户打开过看图页时会留下一个空的 answers.json（没交过、没写字、没框），那个不算
{
  const ap = path.join(path.dirname(path.dirname(HOUSE_DIR)), 'web', 'refs', 'house-v4', 'answers.json');
  const a = fs.existsSync(ap) ? JSON.parse(fs.readFileSync(ap, 'utf8')) : null;
  const blank = !a || (!a.submittedRound && !Object.keys((a.project && a.project.answers) || {}).length
    && Object.values(a.images || {}).every((im) => !im.note && !(im.boxes || []).length && !Object.keys(im.answers || {}).length));
  ok(blank, 'web/refs/house-v4 没有答过的 answers.json（第 1 轮是在对话里答的）');
}
console.log(`ALL PASS (${checks} checks)` + (jarSkipped ? ' —— 但没用真 jar 查（见上面的 SKIP）' : '') + (draftsSkipped ? ' —— 没比 2D 图（见上面的 SKIP）' : ''));
