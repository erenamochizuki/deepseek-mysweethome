// house-mc-grid.mjs — 给 tools/house-mc.mjs、画图和 test/house-mc.test.mjs 用：
// 把 V3.houseMc.build() 的结果包成「按场景格子坐标查方块」，再加一个走路检查（她占 1×2 格，从台阶前走到阁楼）。
// 走路规则故意写得简单（按格子算，不细算碰撞箱）：
//   - 站得住：脚下那格是整块 / 上半砖 / 楼梯（y=0 踩沙子），脚和头两格都是空气或门（门能打开）；
//   - 平走：前后左右一格；往上：只能走上「朝着走的方向」的楼梯（一级 1 格），起步那格头顶再高一格也要空；
//     往下：一格（脚和头经过的两格要空）；
//   - 栅栏、玻璃板、灯笼都挡人；给了家具就把家具也算上：高 > 0.2 米、盖住格子中心、和人（1.8 米高）有重叠就挡。
import { loadV3 } from './v3-node.mjs';

let _V3 = null;
export function v3() {
  if (!_V3) _V3 = loadV3(['12-nbt', '13-share', '17-mcfallback', '42-house-mc'], { core: false }).V3;
  return _V3;
}
export const houseMc = () => v3().houseMc;

// 'minecraft:oak_door[facing=north,half=lower]' → { ns, id, props }（宽松，只给这些工具用；格式是否规范由测试另外查）
export function parseState(s) {
  const m = /^([a-z0-9_.-]+):([a-z0-9_./-]+)(?:\[([^\]]*)\])?$/.exec(s);
  if (!m) throw new Error('状态字符串格式不对：' + s);
  const props = {};
  if (m[3]) for (const kv of m[3].split(',')) { const k = kv.indexOf('='); props[kv.slice(0, k)] = kv.slice(k + 1); }
  return { ns: m[1], id: m[2], props };
}

// 走路用的大类：air / door / stairs / slabTop / slabBottom / thin（栅栏、玻璃板、灯笼）/ carpet（贴地家具，能走）/ none（挂墙吊顶家具）/ furniture（别的模组家具）/ full
export function kindOf(st) {
  const id = st.id;
  if (id === 'air') return 'air';
  if (/_door$/.test(id)) return 'door';
  if (/_stairs$/.test(id)) return 'stairs';
  if (/_slab$/.test(id)) return st.props.type === 'top' ? 'slabTop' : st.props.type === 'double' ? 'full' : 'slabBottom';
  if (/_fence$|_pane$|^lantern$/.test(id)) return 'thin';
  if (st.ns && st.ns !== 'minecraft') {                     // P5 模组家具（docs/FURNITURE.md 8.1 的 collide）
    if (id === 'door_mat' || id === 'step_mat' || (id === 'living_rug' && st.props.part !== '1')) return 'carpet';   // 贴地的能走（地毯茶几那格 part 1 除外）
    if (/^(picture_frames|spice_rack|string_lights|towel_hook|wind_chime|wall_lantern|hanging_basket)$/.test(id)) return 'none';                  // 挂墙、吊顶的没有碰撞
    return 'furniture';                                                                        // 其余挡路，也不能站上去
  }
  return 'full';
}

const AIR = Object.freeze({ ns: 'minecraft', id: 'air', props: Object.freeze({}) });

// build() 的结果 → 按场景格子坐标 (x, y, z) 查。模型外面一律当空气。
export function openGrid(r) {
  const H = houseMc(), m = r.model, [W, Hh, L] = m.size;
  const base = [H.ORIGIN[0] + m.offset[0], H.ORIGIN[1] + m.offset[1], H.ORIGIN[2] + m.offset[2]];
  const states = m.palette.map(parseState), kinds = states.map(kindOf);
  const idx = (x, y, z) => {
    const lx = x - base[0], ly = y - base[1], lz = z - base[2];
    return lx < 0 || ly < 0 || lz < 0 || lx >= W || ly >= Hh || lz >= L ? -1 : lx + lz * W + ly * W * L;
  };
  const G = {
    r, model: m, base, size: m.size, max: [base[0] + W - 1, base[1] + Hh - 1, base[2] + L - 1], idx,
    string: (x, y, z) => { const i = idx(x, y, z); return i < 0 ? 'minecraft:air' : m.palette[m.cells[i]]; },
    state: (x, y, z) => { const i = idx(x, y, z); return i < 0 ? AIR : states[m.cells[i]]; },
    kind: (x, y, z) => { const i = idx(x, y, z); return i < 0 ? 'air' : kinds[m.cells[i]]; },
    part: (x, y, z) => { const i = idx(x, y, z); return i < 0 ? null : r.parts[i]; },
    open: (x, y, z) => { const k = G.kind(x, y, z); return k === 'air' || k === 'door' || k === 'carpet' || k === 'none'; },
    each(fn) {
      for (let i = 0; i < m.cells.length; i++) {
        const lx = i % W, lz = Math.floor(i / W) % L, ly = Math.floor(i / (W * L)), c = m.cells[i];
        fn(base[0] + lx, base[1] + ly, base[2] + lz, states[c], kinds[c], r.parts[i], i);
      }
    },
  };
  return G;
}

// 自己的颜色（17-mcfallback，和工作台没选 jar 时一样）→ [r, g, b]（0–255）
export function rgbOf(st) { return v3().mcfallback.colorOf(st).color.map((v) => Math.round(v * 255)); }
export const hex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

const DIRS = [['north', 0, -1], ['south', 0, 1], ['west', -1, 0], ['east', 1, 0]];

// 从台阶前（Origin 那格，y=0 站在沙子上）走到阁楼（脚在阁楼地面 info.loftFloorY 那一层，且在墙里面）。
// 返回 { ok, path: [[x,y,z]…]（脚所在的格子）, visited, reached: Set('x,y,z'), reason? }
// 想要「能走到的所有格子」就传 goal: () => false（会走遍，ok 是 false）。
export function walk(G, { furniture = null, start = null, goal = null } = {}) {
  const H = houseMc(), g = G.r.info.grid;
  const blockers = (furniture || []).filter((f) => f.box[4] - f.box[1] > 0.2);
  const blocked = (x, y, z) => blockers.some(({ box: b }) => x + 0.5 > b[0] && x + 0.5 < b[3] && z + 0.5 > b[2] && z + 0.5 < b[5]
    && b[1] < y + 1.8 && b[4] > y);
  const support = (x, y, z) => { if (y === 0) return true; const k = G.kind(x, y - 1, z); return k === 'full' || k === 'slabTop' || k === 'stairs'; };
  const stand = (x, y, z) => support(x, y, z) && G.open(x, y, z) && G.open(x, y + 1, z) && !blocked(x, y, z);
  const s0 = start || [H.ORIGIN[0], 0, H.ORIGIN[2]];
  const loftY = G.r.info.loftFloorY;
  const isGoal = goal || ((x, y, z) => y === loftY && x > g.x0 && x < g.x1 && z > g.z0 && z < g.z1);
  const lim = { x0: g.minX - 2, x1: g.maxX + 2, z0: g.minZ - 2, z1: 0 };
  const key = (p) => p.join(',');
  if (!stand(...s0)) return { ok: false, reason: '起点站不住', path: [], visited: 0, reached: new Set() };
  const prev = new Map([[key(s0), null]]), q = [s0];
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi], [x, y, z] = cur;
    if (isGoal(x, y, z)) {
      const path = [];
      for (let p = cur; p; p = prev.get(key(p))) path.unshift(p);
      return { ok: true, path, visited: prev.size, reached: new Set(prev.keys()) };
    }
    for (const [face, dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (nx < lim.x0 || nx > lim.x1 || nz < lim.z0 || nz > lim.z1) continue;
      const next = [];
      if (stand(nx, y, nz)) next.push([nx, y, nz]);
      if (G.kind(nx, y, nz) === 'stairs' && G.state(nx, y, nz).props.facing === face && G.open(x, y + 2, z) && stand(nx, y + 1, nz)) next.push([nx, y + 1, nz]);
      if (y > 0 && G.open(nx, y, nz) && G.open(nx, y + 1, nz) && stand(nx, y - 1, nz)) next.push([nx, y - 1, nz]);
      for (const p of next) if (!prev.has(key(p))) { prev.set(key(p), cur); q.push(p); }
    }
  }
  return { ok: false, reason: '走不到', path: [], visited: prev.size, reached: new Set(prev.keys()) };
}
