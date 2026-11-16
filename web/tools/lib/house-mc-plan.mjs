// web/tools/lib/house-mc-plan.mjs — 平面图（俯视，北在上、东在右）。1 格 = 1 米。
// 一楼图剖在 y=2（窗户那层），阁楼图剖在阁楼地面那层（矮墙，info.loftFloorY）；剖到的墙、柱描深色边，这层地板变浅，更低的更浅。
import { openGrid, rgbOf, hex, walk } from './house-mc-grid.mjs';
import { COL, mix, textWidth, arrow } from './house-mc-svg.mjs';

const EDGE = 'rgba(0,0,0,0.16)';
const f = (v) => +(+v).toFixed(1);
const DIR = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
const LEFT = { north: 'west', west: 'south', south: 'east', east: 'north' };
const EDGES = { north: [[0, 0], [1, 0]], south: [[0, 1], [1, 1]], west: [[0, 0], [0, 1]], east: [[1, 0], [1, 1]] };

function stairMark(C, X, Y, s, facing) {
  const [dx, dz] = DIR[facing], c = s / 2;
  for (const t of [0.3, 0.7]) {
    if (dx) C.line(X + t * s, Y + 3, X + t * s, Y + s - 3, { stroke: COL.ink, strokeWidth: 1 });
    else C.line(X + 3, Y + t * s, X + s - 3, Y + t * s, { stroke: COL.ink, strokeWidth: 1 });
  }
  arrow(C, X + c - dx * s * 0.32, Y + c - dz * s * 0.32, X + c + dx * s * 0.36, Y + c + dz * s * 0.36, { strokeWidth: 1.6, head: 9 });
}

function fenceMark(C, X, Y, s, st) {
  const p = st.props, col = hex(rgbOf(st)), c = s / 2;
  for (const [side, [dx, dz]] of Object.entries(DIR)) if (p[side] === 'true') C.line(X + c, Y + c, X + c + dx * c, Y + c + dz * c, { stroke: col, strokeWidth: s * 0.16 });
  C.rect(X + s * 0.375, Y + s * 0.375, s * 0.25, s * 0.25, { fill: col, stroke: COL.ink, strokeWidth: 0.8 });
}

export function lampMark(C, cx, cy, s, hanging) {
  C.circle(cx, cy, s * 0.2, { fill: COL.lamp, stroke: COL.ink, strokeWidth: 1.2, strokeDasharray: hanging ? '3 2' : null });
}

// 门：关着时门板在背着 facing 的那条边上；虚线画开门的位置和扫过的弧
function doorMark(C, X, Y, s, st) {
  const F = st.props.facing, side = st.props.hinge === 'left' ? LEFT[F] : OPP[LEFT[F]];
  const closed = EDGES[OPP[F]], open = EDGES[side], same = (p, q) => p[0] === q[0] && p[1] === q[1];
  const hg = closed.find((p) => open.some((q) => same(p, q))), a0 = closed.find((p) => !same(p, hg)), b0 = open.find((p) => !same(p, hg));
  const P = ([u, v]) => [X + u * s, Y + v * s], [h, a, b] = [P(hg), P(a0), P(b0)];
  const sweep = (a[0] - h[0]) * (b[1] - h[1]) - (a[1] - h[1]) * (b[0] - h[0]) > 0 ? 1 : 0;
  C.path(`M ${f(a[0])} ${f(a[1])} A ${f(s)} ${f(s)} 0 0 ${sweep} ${f(b[0])} ${f(b[1])}`, { fill: 'none', stroke: COL.sub, strokeWidth: 1, strokeDasharray: '4 3' });
  C.line(h[0], h[1], b[0], b[1], { stroke: COL.sub, strokeWidth: 1.5, strokeDasharray: '4 3' });
  C.line(h[0], h[1], a[0], a[1], { stroke: hex(rgbOf(st)), strokeWidth: s * 0.18 });
}

function paneMark(C, X, Y, s, st, dash) {
  const p = st.props, ew = p.east === 'true' || p.west === 'true';
  C.rect(ew ? X : X + s * 0.3, ew ? Y + s * 0.3 : Y, ew ? s : s * 0.4, ew ? s * 0.4 : s,
    { fill: COL.glass, stroke: COL.glassLine, strokeWidth: 1.2, strokeDasharray: dash ? '4 2' : null });
}

// 画一层平面。返回 { V（投影：px(x米)、pz(z米)、s、w、h）, G }
export function drawPlan(C, r, { x: X0, y: Y0, s, level, furniture = true, labels = true, size = 14 }) {
  const G = openGrid(r), gi = r.info.grid, loft = level === 'loft', cutY = loft ? r.info.loftFloorY : 2, floorY = loft ? cutY - 1 : 0;
  const zMax = gi.maxZ + 1;   // 台阶前面多画一排沙子
  const V = { s, px: (x) => X0 + (x - gi.minX) * s, pz: (z) => Y0 + (z - gi.minZ) * s, w: (gi.maxX - gi.minX + 1) * s, h: (zMax - gi.minZ + 1) * s };
  const ring = (x, z) => x >= gi.x0 && x <= gi.x1 && z >= gi.z0 && z <= gi.z1;
  const thin = [];
  for (let z = gi.minZ; z <= zMax; z++) for (let x = gi.minX; x <= gi.maxX; x++) {
    const X = V.px(x), Y = V.pz(z), out = !ring(x, z);
    let hit = null;
    // 阁楼图：墙外面从最高处往下找，画出屋檐和山墙挑出去的轮廓（淡色）
    for (let y = loft && out ? G.max[1] : cutY; y >= 0 && !hit; y--) {
      const k = G.kind(x, y, z), st = G.state(x, y, z);
      if (k === 'air') continue;
      if (k === 'thin' || k === 'door') { if (k === 'thin' || st.props.half === 'upper') thin.push({ x, y, z, st, k }); continue; }
      hit = { y, k, st };
    }
    if (!hit) { C.rect(X, Y, s, s, { fill: COL.sand, stroke: EDGE, strokeWidth: 0.5 }); continue; }
    const rgb = rgbOf(hit.st);
    if (out) C.rect(X, Y, s, s, { fill: hex(mix(rgb, loft ? (hit.y >= cutY ? 0.5 : 0.7) : 0.3)), stroke: EDGE, strokeWidth: 0.6 });
    else if (hit.y > floorY) C.rect(X, Y, s, s, { fill: hex(rgb), stroke: COL.cut, strokeWidth: 1.2 });
    else C.rect(X, Y, s, s, { fill: hex(mix(rgb, hit.y === floorY ? 0.35 : 0.1)), stroke: EDGE, strokeWidth: 0.6 });
    if (hit.k === 'stairs' && !ring(x, z) && !loft) stairMark(C, X, Y, s, hit.st.props.facing);
  }
  const st = r.info.stairs;
  for (let k = 0; k < st.steps; k++) stairMark(C, V.px(st.x), V.pz(st.z0 + k), s, st.up);
  if (loft) C.rect(V.px(st.x) + 2, V.pz(st.hole[0]) + 2, s - 4, (st.hole[1] - st.hole[0] + 1) * s - 4, { fill: 'none', stroke: COL.ink, strokeWidth: 1.5, strokeDasharray: '7 4' });
  // 这层屋里的灯（像素中心），家具名字躲开它
  const lamps = thin.filter((t) => t.st.id === 'lantern' && ring(t.x, t.z) && (loft ? t.y >= floorY : true))
    .map((t) => [V.px(t.x) + s / 2, V.pz(t.z) + s / 2]);
  // 剖切面上面吊着的灯：阁楼图看到屋顶为止，一楼图看到阁楼楼板底下为止（一楼的灯吊在灯梁下，比窗那层高）
  const lampTop = loft ? G.max[1] : gi.beamY - 1;
  const hung = [];
  for (let z = gi.z0; z <= gi.z1; z++) for (let x = gi.x0; x <= gi.x1; x++) for (let y = cutY + 1; y <= lampTop; y++)
    if (G.state(x, y, z).id === 'lantern') { hung.push([x, z]); lamps.push([V.px(x) + s / 2, V.pz(z) + s / 2]); }
  const numbered = furniture ? drawFurniture(C, V, r, level, { labels, size, lamps, wall: [gi.x0, gi.x1, gi.z0, gi.z1] }) : [];
  for (const t of thin) {
    if (loft && t.y < floorY) continue;
    const X = V.px(t.x), Y = V.pz(t.z);
    if (t.k === 'door') doorMark(C, X, Y, s, t.st);
    else if (t.st.id === 'glass_pane') paneMark(C, X, Y, s, t.st, false);
    else if (t.st.id.endsWith('_fence')) fenceMark(C, X, Y, s, t.st);
    else if (t.st.id === 'lantern') lampMark(C, X + s / 2, Y + s / 2, s, t.st.props.hanging === 'true');
  }
  // 剖切面上面吊着的灯（一楼：灯梁下那盏；阁楼：屋脊下那盏）
  for (const [x, z] of hung) lampMark(C, V.px(x) + s / 2, V.pz(z) + s / 2, s, true);
  // 阁楼图：剖切面上面的窗（山墙窗、小山墙窗）画虚线
  if (loft) for (let z = gi.z0; z <= gi.z1; z++) for (let x = gi.x0; x <= gi.x1; x++) for (let y = cutY + 1; y <= G.max[1]; y++) {
    const sx = G.state(x, y, z);
    if (sx.id === 'glass_pane' && ring(x, z) && (x === gi.x0 || x === gi.x1 || z === gi.z0 || z === gi.z1)) { paneMark(C, V.px(x), V.pz(z), s, sx, true); break; }
  }
  return { V, G, numbered };
}

// 家具占位框；放不下名字的标号，返回标了号的那些（图例里列出来）。串灯只画一条黄虚线（先画，不压别的）。
// lamps：这层灯的像素中心，名字放在框里没被灯挡住的那块；wall = [x0, x1, z0, z1]（墙那一圈的格子）
export function drawFurniture(C, V, r, level, { labels = true, size = 14, lamps = [], wall = null } = {}) {
  const numbered = [], tw = (s) => textWidth(s, size);
  // P5：家具是模组方块（r.furnBlocks，占整格；三角是正面朝向）；还有占位的也照旧画
  const isLights = (q) => q.id === 'lights' || q.id === 'string_lights';
  // 画面范围以外的（第 3 轮屋外的沙滩休闲角、木箱……）不画
  const gi = r.info.grid, inView = (q) => q.box[0] >= gi.minX && q.box[3] <= gi.maxX + 1 && q.box[2] >= gi.minZ && q.box[5] <= gi.maxZ + 2;
  const items = r.furniture.concat(r.furnBlocks || []).filter((q) => q.level === level && inView(q)).sort((a, b) => isLights(b) - isLights(a));
  for (const it of items) {
    let [x0, y0, z0, x1, y1, z1] = it.box;
    // 挂墙的方块家具（画框、调料罐架：比这层地面高一格）只画贴墙那一条，免得盖住下面的家具
    const floorY0 = level === 'loft' ? r.info.loftFloorY : r.info.floorY;
    if (it.block && y0 >= floorY0 + 1 && it.facing) {
      const t = 0.18;
      if (it.facing === 'east') x1 = x0 + t; else if (it.facing === 'west') x0 = x1 - t; else if (it.facing === 'south') z1 = z0 + t; else z0 = z1 - t;
    }
    const X = V.px(x0), Y = V.pz(z0), w = (x1 - x0) * V.s, h = (z1 - z0) * V.s;
    if (isLights(it)) { const ly = it.block ? Y + h : Y + h / 2; C.line(X, ly, X + w, ly, { stroke: COL.lamp, strokeWidth: 3, strokeDasharray: '2 5', strokeLinecap: 'round' }); continue; }
    const flat = y1 - y0 <= 0.2 || it.id === 'door_mat' || it.id === 'living_rug', noted = !!it.note, ink = noted ? COL.note : COL.ink;
    C.rect(X + (it.block ? 2 : 0), Y + (it.block ? 2 : 0), w - (it.block ? 4 : 0), h - (it.block ? 4 : 0), { fill: flat ? 'none' : COL.furn, fillOpacity: flat ? null : 0.92, stroke: ink, strokeWidth: noted ? 2 : 1, strokeDasharray: flat || noted ? '5 3' : null, rx: 2 });
    if (it.block && it.facing && w > 14 && h > 14) {                  // 正面朝向：贴着正面那条边的小三角（挂墙的细条不画）
      const D = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[it.facing], cx = X + w / 2, cy = Y + h / 2, a = 6;
      const fx = cx + D[0] * (w / 2 - 7), fy = cy + D[1] * (h / 2 - 7);
      C.poly([[fx + D[0] * a, fy + D[1] * a], [fx - D[1] * a - D[0] * a * 0.4, fy + D[0] * a - D[1] * a * 0.4], [fx + D[1] * a - D[0] * a * 0.4, fy - D[0] * a - D[1] * a * 0.4]], { fill: ink });
    }
    if (!labels) continue;
    const lamp = lamps.find(([lx, ly]) => lx > X && lx < X + w && ly > Y && ly < Y + h);
    let reg = [X, Y, w, h];
    if (lamp) {
      const [lx, ly] = lamp, g = V.s * 0.26;
      const cand = [[X, Y, lx - g - X, h], [lx + g, Y, X + w - lx - g, h], [X, Y, w, ly - g - Y], [X, ly + g, w, Y + h - ly - g]]
        .filter((q) => q[2] > 0 && q[3] > 0);
      const fits = cand.filter((q) => tw(it.label) <= q[2] - 6 && q[3] >= size + 6);
      reg = (fits.length ? fits : cand).sort((a, b) => b[2] * b[3] - a[2] * a[3])[0] || reg;
    }
    const [rx, ry, rw, rh] = reg;
    if (tw(it.label) <= rw - 6 && rh >= size + 6) { C.text(rx + rw / 2, ry + rh / 2 + size * 0.36, it.label, { fontSize: size, textAnchor: 'middle', fill: ink }); continue; }
    numbered.push(it);
    let tx = rx + rw / 2, ty = ry + rh / 2;
    // 贴墙挂的薄东西（画框、调料罐架）：号码挪到它贴着的那面墙上，免得压住旁边家具的名字
    if (wall && !lamp) {
      const [wx0, wx1, wz0, wz1] = wall;
      if (x1 - x0 < 0.25) tx = V.px(Math.abs(x0 - (wx0 + 1)) <= Math.abs(x1 - wx1) ? wx0 : wx1) + V.s / 2;
      else if (z1 - z0 < 0.25) ty = V.pz(Math.abs(z0 - (wz0 + 1)) <= Math.abs(z1 - wz1) ? wz0 : wz1) + V.s / 2;
    }
    C.tag(tx, ty, String(numbered.length), ink);
  }
  return numbered;
}

// 她走的路（橙色虚线）：pts = walk() 的格子；只画给定的一段
export function drawWalk(C, V, pts) {
  if (pts.length < 2) return;
  const P = pts.map(([x, , z]) => [V.px(x) + V.s / 2, V.pz(z) + V.s / 2]);
  C.pline(P, { stroke: COL.path, strokeWidth: 3, strokeDasharray: '8 5', strokeLinejoin: 'round' });
  C.circle(P[0][0], P[0][1], 6, { fill: COL.path });
  const a = P[P.length - 2], b = P[P.length - 1];
  arrow(C, a[0], a[1], b[0], b[1], { stroke: COL.path, strokeWidth: 3, head: 14 });
}

export function walkPath(G, r) { return walk(G, { furniture: r.furniture }); }
