// web/tools/lib/house-mc-sheets2.mjs — 2D 图第 2 部分：定稿的材料（两色屋顶 × 平滑石英）和方块清单。共用的小工具也在这里。
import { houseMc, openGrid, parseState, rgbOf, hex, walk } from './house-mc-grid.mjs';
import { canvas, COL, mix } from './house-mc-svg.mjs';
import { drawSouth, drawSection } from './house-mc-views.mjs';

export const build = (o = {}) => houseMc().build(o);   // 不传就是定稿（V3.houseMc.DEFAULTS）
export const blockRgb = (s) => rgbOf(parseState(s.includes(':') ? s : 'minecraft:' + s));
export const blockHex = (s) => hex(blockRgb(s));
export const lightHex = (s, t) => hex(mix(blockRgb(s), t));
export const steps = (r) => { const w = walk(openGrid(r), { furniture: r.furniture }); return w.ok ? w.path.length - 1 : null; };
export const moved = (r) => r.furniture.filter((q) => q.note && q.id !== 'lights');

// 方块 → 用在哪（清单的顺序就是这里的顺序）
const USES = [
  ['smooth_quartz', '平滑石英：白墙、山墙、阁楼矮墙'],
  ['stripped_spruce_log', '去皮云杉原木：柱子、地梁、腰梁、灯梁'],
  ['oak_planks', '橡木木板：一楼和阁楼地板、门廊、楼梯下面'],
  ['jungle_stairs', '丛林木楼梯：屋顶（和云杉木一排一排交替）'],
  ['spruce_stairs', '云杉木楼梯：屋顶'],
  ['spruce_slab', '云杉木半砖（下半）：屋脊盖板、小山墙顶'],
  ['oak_stairs', '橡木楼梯：屋里的楼梯、门廊台阶'],
  ['spruce_fence', '云杉木栅栏：门廊栏杆、楼梯口栏杆'],
  ['glass_pane', '玻璃板：窗'],
  ['oak_door', '橡木门（有小窗；上下两半算 2 个）'],
  ['lantern', '灯笼：门廊 4 盏、一楼和阁楼各吊 1 盏'],
  ['bed', '小床（模组「小鲸鱼之家」，1 × 2 格，床头、床尾各 1 个）'],
  ['dining_table', '餐桌（模组「小鲸鱼之家」，1 格）'],
  ['shell_case', '贝壳收集柜（模组「小鲸鱼之家」，2 格）'],
];

// 材料：定稿的南立面和东立面，下面列出用到的全部方块和个数
export function materialsSheet() {
  const C = canvas(), r = build(), i = r.info, gi = i.grid, s = 30;
  C.title('小鲸鱼之家 v4：材料和方块清单', '屋顶两色交替（丛林木 + 云杉木）× 平滑石英白墙，屋脊加盖板；颜色是自己的近似色，真的贴图请在工作台里打开「MC 贴图」，或者看开发 MC 里拍的截图');
  const X1 = 110, Y = 170;
  const E = drawSouth(C, r, { x: X1, y: Y, s });
  C.text(X1, Y - 20, '南立面（从海那边看）', { fontSize: 17, fontWeight: 'bold' });
  const X2 = X1 + E.w + 130;
  drawSection(C, r, { x: X2, y: Y, s, cutX: gi.maxX + 1 });
  C.text(X2, Y - 20, '东立面（从东边看，左边是南、海）', { fontSize: 17, fontWeight: 'bold' });
  const count = new Map();
  r.model.cells.forEach((c) => { const id = parseState(r.model.palette[c]).id; if (id !== 'air') count.set(id, (count.get(id) || 0) + 1); });
  const rows = USES.filter(([id]) => count.has(id));
  // 第 2 轮的模组家具：用途就是它的名字（42 的 FURN2_LABEL）
  const F2 = houseMc().FURN2_LABEL || {};
  for (const id of Object.keys(F2)) if (count.has(id) && !rows.some(([u]) => u === id)) rows.push([id, F2[id] + '（模组「小鲸鱼之家」的家具）']);
  const missing = [...count.keys()].filter((id) => !USES.some(([u]) => u === id) && !F2[id]);
  if (missing.length) throw new Error('materialsSheet：这些方块没写用在哪：' + missing.join('、'));
  const LY = Y + E.h + 80;
  C.text(60, LY, `用到的方块（都是原版 MC 方块）：一共 ${i.blocks} 个，${i.palette - 1} 种状态（不算空气）`, { fontSize: 17, fontWeight: 'bold' });
  rows.forEach(([id, t], n) => {
    const X = 60 + (n % 2) * 760, Yr = LY + 36 + Math.floor(n / 2) * 32;
    C.rect(X, Yr - 16, 24, 20, { fill: blockHex(id), stroke: COL.cut, strokeWidth: 1 });
    C.text(X + 34, Yr, `${t}（${id}）`, { fontSize: 15 });
    C.text(X + 700, Yr, `${count.get(id)} 个`, { fontSize: 15, textAnchor: 'end', fill: COL.sub });
  });
  return C.svg();
}
