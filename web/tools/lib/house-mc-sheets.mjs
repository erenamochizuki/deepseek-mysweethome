// web/tools/lib/house-mc-sheets.mjs — 小鲸鱼之家 v4（定稿）的 2D 图（web/refs/house-v4/drafts-src/*.svg）。
// 一楼平面、阁楼平面、侧面（南立面 + 东剖面）在这里；材料和方块清单在 house-mc-sheets2.mjs。
// DRAFTS 是全部图的清单，house-mc.mjs 的 drafts / check 用它。
// 草图时的 9 张图（两个方案、净高对比、材料小样）在 web/refs/house-v4/trash/，生成它们的代码在提交 d3440c4。
import { canvas, COL, arrow, dimH, dimV, person, legend, label } from './house-mc-svg.mjs';
import { drawPlan, drawWalk, walkPath, lampMark } from './house-mc-plan.mjs';
import { drawSouth, drawSection } from './house-mc-views.mjs';
import { build, blockHex, lightHex, moved, steps, materialsSheet } from './house-mc-sheets2.mjs';

const TITLE = '小鲸鱼之家 v4';

// 图例里的小符号（x, y 是 22 × 20 小格的左上角）
const sym = (C) => ({
  pane: (x, y, dash) => C.rect(x, y + 5, 22, 9, { fill: COL.glass, stroke: COL.glassLine, strokeWidth: 1.2, strokeDasharray: dash ? '4 2' : null }),
  door: (x, y) => {
    C.path(`M ${x + 22} ${y + 16} A 22 22 0 0 0 ${x} ${y - 6}`, { fill: 'none', stroke: COL.sub, strokeWidth: 1, strokeDasharray: '4 3' });
    C.line(x, y + 16, x, y - 6, { stroke: COL.sub, strokeWidth: 1.5, strokeDasharray: '4 3' });
    C.line(x, y + 16, x + 22, y + 16, { stroke: blockHex('oak_door'), strokeWidth: 5 });
  },
  fence: (x, y) => {
    C.line(x, y + 7, x + 22, y + 7, { stroke: blockHex('spruce_fence'), strokeWidth: 4 });
    C.rect(x + 7, y + 3, 8, 8, { fill: blockHex('spruce_fence'), stroke: COL.ink, strokeWidth: 0.8 });
  },
  lamp: (x, y, hang) => lampMark(C, x + 11, y + 7, 30, hang),
  stairs: (x, y) => {
    for (const yy of [y + 2, y + 12]) C.line(x, yy, x + 22, yy, { stroke: COL.ink });
    arrow(C, x + 11, y + 18, x + 11, y - 4, { strokeWidth: 1.6, head: 8 });
  },
  path: (x, y) => C.line(x, y + 7, x + 22, y + 7, { stroke: COL.path, strokeWidth: 3, strokeDasharray: '6 4' }),
  lights: (x, y) => C.line(x, y + 7, x + 22, y + 7, { stroke: COL.lamp, strokeWidth: 3, strokeDasharray: '2 5', strokeLinecap: 'round' }),
});

// 吊着的灯笼：灯底 = 格子 y + 1/16（MC 的吊灯笼形状从 1/16 起）
const lampBottom = (G, part) => { let ly = null; G.each((x, y, z, st, k, p) => { if (p === part) ly = y; }); return ly + 1 / 16; };

const groundItems = (r, S, G) => [
  { fill: blockHex(r.info.wall.block), stroke: COL.cut, text: '白墙（剖到的；平滑石英）' },
  { fill: blockHex('stripped_spruce_log'), stroke: COL.cut, text: '木柱、门框（去皮云杉原木）' },
  { fill: lightHex('oak_planks', 0.35), text: '地板和门廊（橡木木板，一样高，离沙滩 1 米）' },
  { draw: (x, y) => S.pane(x, y), text: '窗（玻璃板；窗台离地 1 米，窗高 1 米，上面还有 1 米白墙）' },
  { draw: S.door, text: '门（橡木门，带小窗，2 米高；虚线是开着的样子）' },
  { draw: S.fence, text: '栏杆（云杉木栅栏）' },
  { draw: (x, y) => S.lamp(x, y, false), text: '灯笼：门廊 4 盏，立在栏杆柱上' },
  { draw: (x, y) => S.lamp(x, y, true), text: `吊灯：挂在灯梁下、餐桌上方，灯底离地板约 ${(lampBottom(G, '一楼/吊灯') - r.info.floorY).toFixed(1)} 米` },
  { draw: S.stairs, text: `楼梯：${r.info.stairs.steps} 级，每级 1 米，箭头朝上楼的方向` },
  { fill: COL.furn, stroke: COL.ink, text: '家具：模组方块，占整格（三角 = 正面；虚线 = 贴地，能走上去）' },
  ...(moved(r).length ? [{ fill: 'none', stroke: COL.note, dash: '5 3', color: COL.note, text: '红色虚线框：和 2.0 比挪了或改小的家具' }] : []),
  { draw: S.path, text: `她从沙滩走到阁楼的路（${steps(r)} 步，绕开家具）` },
];

function loftItems(r, S, G) {
  const st = r.info.stairs, holeN = st.hole[1] - st.hole[0] + 1;
  return [
    { fill: blockHex(r.info.wall.block), stroke: COL.cut, text: '矮墙（1 米高）和东西山墙（平滑石英）' },
    { fill: blockHex('stripped_spruce_log'), stroke: COL.cut, text: '四角的木柱' },
    { fill: lightHex('oak_planks', 0.35), text: '阁楼地板（橡木木板，整块，1 米厚）' },
    { fill: lightHex('stripped_spruce_log', 0.35), text: '灯梁：一整根原木，一楼的吊灯挂在它下面' },
    { fill: lightHex('jungle_stairs', 0.5), text: '墙外一圈：从上往下看到的屋顶（伸出墙外 1 格），更浅的是门廊和台阶' },
    { fill: 'none', stroke: COL.ink, dash: '7 4', text: `楼梯口（${holeN} 格；西边是栏杆，北边是矮墙）` },
    { draw: S.fence, text: '楼梯口的栏杆（云杉木栅栏）' },
    { draw: (x, y) => S.pane(x, y, true), text: '虚线窗：比矮墙高（山墙上 2 × 2 的方窗、门上方的小窗）' },
    { draw: (x, y) => S.lamp(x, y, true), text: `吊灯：挂在屋脊下，灯底离阁楼地面约 ${(lampBottom(G, '阁楼/吊灯') - r.info.loftFloorY).toFixed(1)} 米` },
    { draw: S.lights, text: '串灯：一格一段的方块，挂在屋脊下' },
    { fill: COL.furn, stroke: COL.ink, text: '家具：模组方块（三角 = 正面朝向）' },
    { draw: S.path, text: '从楼梯上来' },
  ];
}

function listBlock(C, x, y, numbered, r, level) {
  if (numbered.length) {
    C.text(x, y, '标了号的家具：', { fontSize: 16, fontWeight: 'bold' });
    numbered.forEach((it, i) => C.text(x + (i % 2) * 260, y + 26 + Math.floor(i / 2) * 24, `${i + 1}  ${it.label}`, { fontSize: 15, fill: it.note ? COL.note : COL.ink }));
    y += 26 + Math.ceil(numbered.length / 2) * 24 + 16;
  }
  const mv = moved(r).filter((q) => q.level === level);
  if (mv.length) {
    C.text(x, y, '和 2.0 不一样的家具（红框）：', { fontSize: 16, fontWeight: 'bold', fill: COL.note });
    mv.forEach((it, i) => C.text(x, y + 26 + i * 24, `${it.label}：${it.note}`, { fontSize: 15, fill: COL.note }));
    y += 26 + mv.length * 24 + 16;
  }
  return y;
}

function planSheet(level) {
  const C = canvas(), r = build(), gi = r.info.grid, loft = level === 'loft', S = sym(C);
  const rows = gi.maxZ + 2 - gi.minZ, s = Math.min(54, Math.floor(780 / rows)), X0 = 110, Y0 = 160;
  C.title(`${TITLE}：${loft ? '阁楼' : '一楼'}平面`, loft
    ? `阁楼地面离沙滩 ${r.info.loftFloorY} 米；剖在矮墙那层（离阁楼地面 0–1 米），更高的窗画虚线；1 格 = 1 米，北在上`
    : `外墙 ${r.info.outer.join(' × ')} 米，屋里 ${r.info.inner.join(' × ')} 米，一楼净高 ${r.info.groundClear} 米；剖在离一楼地面 1–2 米（窗那层）；1 格 = 1 米，北在上`);
  const P = drawPlan(C, r, { x: X0, y: Y0, s, level }), V = P.V;
  dimH(C, V.px(gi.x0), V.px(gi.x1 + 1), Y0 - 22, `外墙 ${r.info.outer[0]} 米（${r.info.outer[0]} 格）`);
  dimV(C, X0 - 22, V.pz(gi.z0), V.pz(gi.z1 + 1), `${r.info.outer[1]} 米`);
  arrow(C, X0 + V.w + 26, Y0 + 56, X0 + V.w + 26, Y0 + 10, { strokeWidth: 2.5 });
  C.text(X0 + V.w + 26, Y0 + 78, '北', { fontSize: 18, textAnchor: 'middle', fontWeight: 'bold' });
  C.text(X0, Y0 + V.h + 26, '↓ 南：沙滩，再往前是海', { fontSize: 16, fill: COL.sub });
  if (!loft) drawWalk(C, V, walkPath(P.G, r).path);
  else {
    const st = r.info.stairs, mid = r.anchors.find((a) => a.id === 'loft_mid').pos;
    arrow(C, V.px(st.x + 0.5), V.pz(st.z1 + 0.5), V.px(mid[0]), V.pz(mid[2]), { stroke: COL.path, strokeWidth: 3, dash: '8 5', head: 14 });
    r.info.loftClear.forEach((h, i) => C.text(X0 + V.w + 8, V.pz(gi.z1 - 1 - i) + s / 2 + 5, `净高 ${h} 米`, { fontSize: 15, fill: COL.sub }));
  }
  const LX = X0 + V.w + 110;
  let y = legend(C, LX, Y0 + 10, loft ? loftItems(r, S, P.G) : groundItems(r, S, P.G), 30);
  y = listBlock(C, LX, y + 16, P.numbered, r, level);
  if (loft) C.lines(LX, y + 4, ['靠墙那一排最矮（2 米）；小山墙下面（门的正上方）最高 3 米，', '窗边坐垫放在那里。'], { fontSize: 15, fill: COL.sub }, 22);
  return C.svg();
}

function sideSheet() {
  const C = canvas(), r = build(), i = r.info, gi = i.grid, X0 = 150, Y0 = 170;
  const s = Math.floor(1280 / (gi.maxX - gi.minX + 1 + gi.maxZ - gi.minZ + 1));
  C.title(`${TITLE}：南立面和东剖面`, '1 格 = 1 米；她 1.3 米，MC 玩家 1.8 米；颜色是自己的近似色');
  const E = drawSouth(C, r, { x: X0, y: Y0, s });
  const marks = [[i.floorY, `${i.floorY} 米 一楼地面`], [i.door.y1, `${i.door.y1} 米 门顶`], [i.loftFloorY - 1, `${i.loftFloorY - 1} 米 阁楼楼板底`],
    [i.loftFloorY, `${i.loftFloorY} 米 阁楼地面`], [i.wallTop, `${i.wallTop} 米 屋檐`], [i.ridgeTop, `${i.ridgeTop} 米 屋脊顶`]];
  for (const [m, t] of marks) {
    C.line(X0 - 10, E.py(m), X0 - 2, E.py(m), { stroke: COL.sub, strokeWidth: 1.2 });
    C.text(X0 - 14, E.py(m) + 5, t, { fontSize: 14, fill: COL.sub, textAnchor: 'end' });
  }
  // 两个人站在门廊东边（不挡门、窗和灯）；名字带底色，压在墙上也看得清
  const gx = 3.25, px = 4.45;
  person(C, E.px(gx), E.py(1), 1.3 * s, 'girl');
  person(C, E.px(px), E.py(1), 1.8 * s, 'player');
  label(C, E.px(gx) + 4, E.py(2.3) - 8, '她 1.3 米', { color: COL.girl, anchor: 'end', bold: true });
  label(C, E.px(px) - 4, E.py(2.8) - 8, '玩家 1.8 米', { color: COL.player, anchor: 'start', bold: true });
  const rx = E.px(gi.x1 - 2.5), ry = E.py(i.ridgeTop);
  C.text(rx + 10, ry - 18, '屋脊：两排楼梯背靠背，上面各铺一排云杉木半砖（盖板）', { fontSize: 15 });
  arrow(C, rx + 8, ry - 14, rx - 6, ry + s * 0.25, { strokeWidth: 1.5, head: 9 });
  C.text(X0, E.py(0) + 44, '南立面：从海那边看过来（东在右边）', { fontSize: 17, fontWeight: 'bold' });
  C.lines(X0, E.py(0) + 74, [
    '墙：平滑石英白墙；柱子、地梁、腰梁是去皮云杉原木，像 2.0 的木框白墙。',
    `屋顶：45°，一格一级楼梯，丛林木和云杉木一排一排交替，伸出墙外 1 格；屋脊顶 ${i.ridgeTop} 米。`,
    '小山墙在门正上方，5 格宽，开一个窗；它只从南坡伸出来。',
    '小山墙和主屋顶交界处有 4 个转角楼梯，形状照 MC 26.1 自己算的写。'], { fontSize: 15 }, 22);
  const SX = X0 + E.w + 120, Sv = drawSection(C, r, { x: SX, y: Y0, s, cutX: i.stairs.x });
  const sb = r.anchors.find((a) => a.id === 'stair_bottom').pos, stp = r.anchors.find((a) => a.id === 'stair_top').pos;
  person(C, Sv.pz(sb[2]), Sv.py(i.floorY), 1.3 * s, 'girl');
  person(C, Sv.pz(stp[2]), Sv.py(i.loftFloorY), 1.8 * s, 'player');
  label(C, Sv.pz(sb[2]), Sv.py(i.floorY + 1.3) - 8, '她', { color: COL.girl, bold: true });
  label(C, Sv.pz(stp[2]) + 0.35 * s, Sv.py(i.loftFloorY + 1.4), '玩家', { color: COL.player, anchor: 'start', bold: true });
  dimV(C, Sv.pz(gi.z1 - 0.25), Sv.py(i.floorY), Sv.py(i.floorY + i.groundClear), `净高 ${i.groundClear} 米`, { side: 'right', size: 14 });
  C.text(SX, Sv.py(0) + 44, '东剖面：在楼梯这一列切开，从东往西看（左边是南、海）', { fontSize: 17, fontWeight: 'bold' });
  const holeN = i.stairs.hole[1] - i.stairs.hole[0] + 1;
  C.lines(SX, Sv.py(0) + 74, [`楼梯 ${i.stairs.steps} 级，每级 1 米，最上一级就在阁楼地板那一层。`,
    `楼梯口开了 ${holeN} 格（上楼前站的那格 + 前 ${holeN - 1} 级的上方），`, '西边是栏杆，北边是矮墙；上楼时头碰不到阁楼楼板。',
    `一楼净高 ${i.groundClear} 米：玩家（1.8 米）头顶还空 ${(i.groundClear - 1.8).toFixed(1)} 米。`], { fontSize: 15 }, 22);
  return C.svg();
}

export const groundSheet = () => planSheet('ground');
export const loftSheet = () => planSheet('loft');
export { sideSheet };
// 文件名换了新的（refkit 的规矩：新版不覆盖旧文件名，旧图挪进 trash/）
export const DRAFTS = Object.freeze([
  { name: '10-ground', svg: groundSheet },
  { name: '11-loft', svg: loftSheet },
  { name: '12-side', svg: sideSheet },
  { name: '13-materials', svg: materialsSheet },
]);
