// mock-shapes.mjs：mock 探针的 /shapes 用的「游戏按邻居算出来的样子」。只是个简化版，够测试和 P4 卡片用：
//   栅栏、玻璃板（铁栏杆）四个方向连不连；灯笼有没有支撑（没有就变空气）；门的两半（另一半不对就变空气，对的话照另一半的
//   facing / hinge / open / powered）。别的方块（楼梯拐角、墙、红石线……）mock 都不重算，原样返回。
// 不是游戏：「整块方块」按名字猜（不是下面这些「薄」方块的就当整块），P4 的房子里够用。
// 方块是 { id, props, state }（和 mock-probe.mjs 的一样）。getBlock([x, y, z]) 拿邻居。

const SIDES = { north: [0, 0, -1], east: [1, 0, 0], south: [0, 0, 1], west: [-1, 0, 0] };
const add = (p, d) => p.map((v, k) => v + d[k]);
export const isAir = (b) => /^minecraft:(air|cave_air|void_air)$/.test(b.id);
const name = (b) => b.id.replace(/^minecraft:/, '');
const THIN = /(fence|pane|iron_bars|_wall$|_door$|trapdoor|stairs|slab|^(soul_)?lantern$|torch|sign|ladder|_bed$|chest|carpet|leaves|redstone_wire|button|lever|pressure_plate|rail$|flower|sapling|^short_grass$|^tall_grass$|fern$|vine|^snow$)/;
const isFull = (b) => !isAir(b) && !THIN.test(name(b));
const isFence = (b) => /fence$/.test(b.id);
const isWoodFence = (b) => isFence(b) && b.id !== 'minecraft:nether_brick_fence';
const isPaneLike = (b) => /(glass_pane|iron_bars)$/.test(b.id);
const isWall = (b) => /_wall$/.test(b.id);
const isLantern = (b) => /^minecraft:(soul_)?lantern$/.test(b.id);
const isDoor = (b) => /_door$/.test(b.id);

// Block.canSupportCenter(level, pos, face)：这一格 face 那一面的正中间是不是实的（挂灯笼、立灯笼用）
function supportsCenter(b, face) {
  if (isAir(b)) return false;
  if (isFull(b)) return true;
  if (isFence(b) || isPaneLike(b) || isWall(b)) return true; // 中间有柱子（墙没柱子时两边的墙身也盖住中间）
  if (/_slab$/.test(b.id)) return b.props.type === 'double' || (face === 'up' ? b.props.type === 'top' : b.props.type === 'bottom');
  if (/_stairs$/.test(b.id)) return face === 'up' ? b.props.half === 'top' : b.props.half === 'bottom';
  return false;
}

// 门下面要能立住：下面那格的上表面整面是实的（简化）
const sturdyTop = (b) => isFull(b) || (/_slab$/.test(b.id) && b.props.type !== 'bottom') || (/_stairs$/.test(b.id) && b.props.half === 'top');

/** 游戏按邻居算出来的状态：{ id, props }（变成空气就是 { id: 'minecraft:air', props: {} }）。 */
export function gameShape(b, pos, getBlock) {
  const props = { ...b.props };
  const AIR = { id: 'minecraft:air', props: {} };
  if (isFence(b) || isPaneLike(b)) {
    for (const [side, d] of Object.entries(SIDES)) {
      if (props[side] === undefined) continue;
      const n = getBlock(add(pos, d));
      const same = isFence(b) ? (isWoodFence(b) ? isWoodFence(n) : n.id === b.id) : isPaneLike(n) || isWall(n);
      props[side] = String(same || isFull(n));
    }
    return { id: b.id, props };
  }
  if (isLantern(b)) {
    const hanging = props.hanging === 'true';
    const n = getBlock(add(pos, [0, hanging ? 1 : -1, 0]));
    return supportsCenter(n, hanging ? 'down' : 'up') ? { id: b.id, props } : AIR;
  }
  if (isDoor(b) && (props.half === 'lower' || props.half === 'upper')) {
    const lower = props.half === 'lower';
    const other = getBlock(add(pos, [0, lower ? 1 : -1, 0]));
    if (!isDoor(other) || other.props.half === props.half) return AIR;
    if (lower && !sturdyTop(getBlock(add(pos, [0, -1, 0])))) return AIR;
    return { id: other.id, props: { ...other.props, half: props.half } };
  }
  return { id: b.id, props };
}
