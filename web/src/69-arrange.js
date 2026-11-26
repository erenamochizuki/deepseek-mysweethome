// 69-arrange.js — V3.arrange：游戏页的「布置模式」（2026-11-07 用户定的；docs/HOUSE-V4.md 第 18 节）。
// 左下角「布置」进入：她停在原地（V3.actor.hold），不捡贝壳；镜头照常转。上面一条：加家具、挪房子、导出鲸图、撤销一步、放弃修改、完成。
//   选中：长按（0.4 秒没怎么动）一件家具，或者点一下。选中的描边，旁边一组小按钮：转向（顺时针 90°）、东 / 南 / 西 / 北各挪一格
//   （按镜头方向排，按钮上写世界方向）、放回原处、拆掉。键盘：方向键挪（按镜头方向）、R 转、Delete 拆、Esc 取消选中、Ctrl+Z 撤销一步。
//   拖动：按住选中的家具（或者长按别的家具）拖，贴着格子走，可以拖到一楼、阁楼、门廊、沙滩；放不下的地方变红、松手回原位。
//   加家具：清单里 41 种（屋里 / 屋外，相框在屋里那页），点一种它就跟着指针走（半透明），点地方放下。
//   挪房子（第二步）：选中整栋房子（「挪房子」按钮，或者长按墙 / 屋顶），按格子挪、每次转 90°，也能拖；压到椰子树、石堆、爬藤、湿沙、出场地的不让放。
// 改的都是房子的方块数据（V3.houseBlocks 的模型：家具方块的 facing、part；挪房子时整张鲸图），改完整个场景按新方块重建（HB.applyEdit），
//   会亮会动的东西跟着方块走。「完成」存进浏览器（HB.saveArranged：设置「房子」页显示「布置过的房子」）；「放弃修改」回到进来时的样子。
// 放得下的规则（check，docs/HOUSE-V4.md 18.2）：每一格都在房子的鲸图范围里、是空的（空气或者草、雪片这类能替换的）、不压石头 / 沙丘 / 椰子树；
//   放地上的（mount floor）最下面一层每格下面要有能托住的方块（整块、上半砖、栅栏头……）或者平的干沙；家具不叠在家具上；
//   挂墙的（mount wall）每格背后（facing 反方向那格）要是墙；吊顶的（mount ceiling）每格上面要有方块。
// 点选、拖动按格子走射线（cast），不靠网格拾取：剖开时上面几层、压低的墙不算（HB.visibleAt），窗户、栏杆、灯笼看得穿。
// 测试、截图用的接口在文件最后（AR.enter / select / nudge / rotate / remove / reset / moveTo / add / undo / discard / done / state ……）。
(function (V3) {
  'use strict';
  if (!V3.util || !V3.scene) return;
  const U = V3.util;
  const AR = V3.arrange = { on: false };
  const HB = () => V3.houseBlocks, FM = () => V3.furnMc;
  const AIR = 'minecraft:air';
  const CW = ['north', 'east', 'south', 'west'];                      // 从上往下看顺时针（MC 的 facing 顺序）
  const DIRV = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
  const CN = { north: '北', east: '东', south: '南', west: '西' };
  const LONG = 400, SLOP = 8, TAP = 6;                                 // 长按 0.4 秒、长按时最多挪 8 像素、点一下最多 6 像素
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const key = (p) => p[0] + ',' + p[1] + ',' + p[2];
  const isMod = (s) => !!(s && s.ns && s.ns !== 'minecraft');
  const isAirStr = (s) => /^(minecraft:)?(air|cave_air|void_air)$/.test(String(s).replace(/\[.*$/, ''));
  const samePlace = (a, b) => (a ? a.dx | 0 : 0) === (b ? b.dx | 0 : 0) && (a ? a.dz | 0 : 0) === (b ? b.dz | 0 : 0) && (((a ? a.k | 0 : 0) % 4) + 4) % 4 === (((b ? b.k | 0 : 0) % 4) + 4) % 4;
  // 水平偏移顺时针转 k 步（和 V3.furnMc.rotate 一样：(x, z) → (−z, x)）
  const rotK = (o, k) => { let [x, y, z] = o; for (let i = ((k % 4) + 4) % 4; i > 0; i--) [x, z] = [-z, x]; return [x + 0, y, z + 0]; };
  const dirName = (n) => (n[0] > 0.5 ? 'east' : n[0] < -0.5 ? 'west' : n[2] > 0.5 ? 'south' : n[2] < -0.5 ? 'north' : null);

  // ---- 模型：按场景格子读写（不改原来的对象，写的时候出一份新的）----
  function mview(m) {
    const [W, Hh, Lz] = m.size, org = HB().originOf(m), M = V3.mcmodel, cache = new Map();
    const B = { x0: org[0], x1: org[0] + W, y0: org[1], y1: org[1] + Hh, z0: org[2], z1: org[2] + Lz };
    const inside = (p) => p[0] >= B.x0 && p[0] < B.x1 && p[1] >= B.y0 && p[1] < B.y1 && p[2] >= B.z0 && p[2] < B.z1;
    const idx = (p) => (p[0] - org[0]) + (p[2] - org[2]) * W + (p[1] - org[1]) * W * Lz;
    const str = (p) => (inside(p) ? m.palette[m.cells[idx(p)]] : null);
    const st = (p) => {
      if (!inside(p)) return null;
      const i = m.cells[idx(p)];
      if (!cache.has(i)) { const q = M.parseState(m.palette[i]); cache.set(i, M.isAir(q) ? null : q); }
      return cache.get(i);
    };
    return { m, B, org, W, H: Hh, L: Lz, inside, idx, str, st };
  }
  // 方块实体（docs/PHOTOS.md：相册矮桌、相框、画框墙 part=0 那格）：pos 是模型里的格子（不加 Offset）
  const beIdx = (V, q) => q[0] + q[2] * V.W + q[1] * V.W * V.L;
  function beAt(V, pos) {
    const q = [pos[0] - V.org[0], pos[1] - V.org[1], pos[2] - V.org[2]];
    return (V.m.blockEntities || []).find((be) => be.pos[0] === q[0] && be.pos[1] === q[1] && be.pos[2] === q[2]) || null;
  }
  // 写方块：w = { pos（场景格子）, state, be? }。写过的格子上原来的方块实体去掉（方块换了）；w.be 给了的放上去（挪家具时带着走、新放的空的）
  function writeModel(m, writes) {
    const V = mview(m), palette = m.palette.slice(), cells = Int32Array.from(m.cells), ids = new Map(palette.map((s, i) => [s, i]));
    const touched = new Set(), put = [];
    for (const w of writes) {
      if (!V.inside(w.pos)) throw new Error('格子不在鲸图里：' + key(w.pos));
      let k = ids.get(w.state);
      if (k == null) { k = palette.length; palette.push(w.state); ids.set(w.state, k); }
      cells[V.idx(w.pos)] = k;
      touched.add(V.idx(w.pos));
      if (w.be) put.push(w);
    }
    let bes = m.blockEntities || [];
    if (put.length || bes.some((be) => touched.has(beIdx(V, be.pos)))) {
      const at = new Map();
      for (const be of bes) if (!touched.has(beIdx(V, be.pos))) at.set(beIdx(V, be.pos), be);
      for (const w of put) { const q = [w.pos[0] - V.org[0], w.pos[1] - V.org[1], w.pos[2] - V.org[2]]; at.set(beIdx(V, q), Object.assign({}, w.be, { pos: q })); }
      bes = [...at.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    }
    return Object.assign({}, m, { palette, cells, blockEntities: bes });
  }
  // 新放的这一格要不要方块实体（MC 里放下就有，同 42-house-mc 的 H.furnBlockEntity）：要就给一条空的
  const freshBE = (state) => { const id = V3.photos && V3.photos.beIdOf(state); return id ? { id, data: { compound: {} } } : null; };
  // 带类型的 NBT 一样吗（字节数组按字节比：Int8Array 和 Uint8Array 也算一样）
  function nbtEq(x, y) {
    if (x === y) return true;
    if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return false;
    const vx = ArrayBuffer.isView(x), vy = ArrayBuffer.isView(y);
    if (vx || vy) { if (!vx || !vy || x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && ((Number(x[i]) & 255) !== (Number(y[i]) & 255))) return false; return true; }
    if (Array.isArray(x) !== Array.isArray(y)) return false;
    const kx = Object.keys(x), ky = Object.keys(y);
    if (kx.length !== ky.length) return false;
    for (const k of kx) if (!Object.prototype.hasOwnProperty.call(y, k) || !nbtEq(x[k], y[k])) return false;
    return true;
  }
  function sameBEs(a, b) {
    const x = a.blockEntities || [], y = b.blockEntities || [];
    if (x === y) return true;
    if (x.length !== y.length) return false;
    const k = (be) => be.pos.join(','), my = new Map(y.map((be) => [k(be), be]));
    return x.every((be) => { const o = my.get(k(be)); return !!o && o.id === be.id && nbtEq(be.data || null, o.data || null); });
  }
  // 两个模型逐格一样吗（同一个场景位置、同一种方块状态、同样的方块实体）
  function sameModel(a, b) {
    if (a === b) return true;
    if (!a || !b || a.size.join() !== b.size.join() || Array.from(a.offset).join() !== Array.from(b.offset).join()) return false;
    const M = V3.mcmodel, ka = a.palette.map((s) => M.stateKey(M.parseState(s))), kb = b.palette.map((s) => M.stateKey(M.parseState(s)));
    for (let i = 0; i < a.cells.length; i++) if (ka[a.cells[i]] !== kb[b.cells[i]]) return false;
    return sameBEs(a, b);
  }
  const stKey = (str) => { const M = V3.mcmodel; return M.stateKey(M.parseState(str)); };

  // ---- 一件家具：规格 f、主格 main、facing、每格 { pos, part, state } ----
  function makePiece(f, main, facing) {
    const F = FM();
    return { f, main: main.slice(), facing, cells: F.cellsFor(f, facing).map((c) => ({ pos: add3(main, c.offset), part: c.part, state: F.state(f, facing, c.part) })) };
  }
  function pieceAt(V, pos) {
    const s = V.st(pos);
    if (!isMod(s)) return null;
    const F = FM(), f = F.byBlock(s.ns + ':' + s.id);
    if (!f) return null;
    const p = s.props || {}, facing = CW.includes(p.facing) ? p.facing : f.facing || 'north';
    const pv = p.part == null ? null : String(p.part), cs = F.cellsFor(f, facing);
    const me = cs.find((c) => (c.part == null ? null : String(c.part)) === pv) || cs[0];
    const pc = makePiece(f, sub3(pos, me.offset), facing);
    pc.broken = pc.cells.some((c) => { const q = V.str(c.pos); return !q || stKey(q) !== stKey(c.state); });
    return pc;
  }
  const sameBlock = (s, f) => !!(s && isMod(s) && s.ns + ':' + s.id === f.block);

  // ---- 放得下的规则 ----
  const FREE = /^(minecraft:)?(air|cave_air|void_air|short_grass|tall_grass|fern|large_fern|dead_bush|short_dry_grass|tall_dry_grass|bush|snow|seagrass|tall_seagrass|vine|glow_lichen|light)$/;
  const isFree = (str) => str != null && FREE.test(String(str).replace(/\[.*$/, ''));
  function nameOf(s) {
    if (!s) return '空气';
    if (isMod(s)) { const f = FM().byBlock(s.ns + ':' + s.id); return f ? f.label : s.id; }
    const id = s.id;
    if (/_door$/.test(id)) return '门';
    if (/(_pane|glass)$/.test(id)) return '窗户';
    if (/_fence(_gate)?$/.test(id)) return '栏杆';
    if (/lantern$/.test(id)) return '灯笼';
    if (/_stairs$/.test(id)) return '楼梯 / 台阶';
    if (/_slab$/.test(id)) return '半砖';
    if (/_(log|wood)$/.test(id)) return '木柱 / 木梁';
    if (/_planks$/.test(id)) return '木板';
    if (/quartz|calcite|stone|brick|concrete|terracotta|wool|sandstone|deepslate|tuff/.test(id)) return '墙';
    return '方块（' + id + '）';
  }
  // 能托住放在上面的家具：碰撞盒顶到这一格顶、盖住格子中间（整块、上半砖、栅栏头）；楼梯、门、灯笼、玻璃板不算
  const solidTop = (s) => !!s && !isMod(s) && !/(_stairs|_door|lantern|chain|_pane|_trapdoor|_bars)$/.test(s.id)
    && HB().boxes(s).some((b) => b[4] >= 0.99 && b[0] <= 0.5 && b[3] >= 0.5 && b[2] <= 0.5 && b[5] >= 0.5);
  // 能挂东西的墙：整块的方块（窗户、门、栏杆、楼梯、半砖不算）
  const wallLike = (s) => !!s && !isMod(s) && !/(_pane|glass|_door|_fence|_fence_gate|lantern|chain|_stairs|_slab|_trapdoor|_wall|_bars)$/.test(s.id)
    && HB().boxes(s).some((b) => b[0] <= 0.01 && b[1] <= 0.01 && b[2] <= 0.01 && b[3] >= 0.99 && b[4] >= 0.99 && b[5] >= 0.99);
  // 一格（x..x+1, z..z+1）下面的地：最高、最低、湿不湿、是不是石头（52-terrain）
  function ground(x, z) {
    const T = V3.terrain;
    if (!T || !T.groundY) return { top: 0, low: 0, wet: false, rock: false };
    let top = -1e9, low = 1e9, wet = false, rock = false;
    for (const [u, v] of [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]) {
      const gx = x + u, gz = z + v, y = T.groundY(gx, gz);
      top = Math.max(top, y); low = Math.min(low, y);
      if (T.isWet && T.isWet(gx, gz)) wet = true;
      if (T.seabedY && y - T.seabedY(gx, gz) > 0.05) rock = true;
    }
    return { top, low, wet, rock };
  }
  const rectD = (x0, z0, x1, z1, x, z) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
  // 这一格压到椰子树干没有（树干歪着长，同 61-nav 的弯法，查到她头顶那么高）
  function palmAt(x, z) {
    for (const p of (V3.layout && V3.layout.plants) || []) {
      if (!/^palm/.test(p.id)) continue;
      let bx = p.x, bz = p.z;
      if (p.lean) { const h = p.h || 6, t = Math.min(1, 1.5 / h), f = (1.5 * t - 0.5 * t * t) * h; bx += p.lean[0] * f; bz += p.lean[1] * f; }
      for (let i = 0; i <= 4; i++) if (rectD(x, z, x + 1, z + 1, p.x + (bx - p.x) * i / 4, p.z + (bz - p.z) * i / 4) < 0.3) return p;
    }
    return null;
  }
  // 沙滩上的爬藤（不是方块，贴着沙子长）
  function creeperAt(x, z) {
    for (const p of (V3.layout && V3.layout.plants) || []) if (/^creep/.test(p.id) && p.x0 != null && x < p.x1 && x + 1 > p.x0 && z < p.z1 && z + 1 > p.z0) return p;
    return null;
  }
  // 这件家具摆在 main、朝 facing 放得下吗。ignore：当成空的格子（挪的时候它自己原来那几格）→ { ok, why, at, piece }
  function check(V, f, main, facing, ignore) {
    const F = FM(), mount = F.mountOf(f), pc = makePiece(f, main, facing), ign = ignore || new Set(), B = V.B;
    const no = (why, at) => ({ ok: false, why, at: at || null, piece: pc });
    for (const c of pc.cells) {
      const p = c.pos;
      if (!V.inside(p)) return no('超出了房子鲸图的范围（家具只能放在房子这一块里：东西 ' + B.x0 + '..' + B.x1 + '、南北 ' + B.z0 + '..' + B.z1 + ' 米）', p);
      if (!ign.has(key(p)) && !isFree(V.str(p))) return no('那里已经有' + nameOf(V.st(p)) + '了', p);
      const g = ground(p[0], p[2]);
      if (g.top > p[1] + 0.3) return no(g.rock ? '那里是石头' : p[1] < 0 ? '埋进沙子里了' : '那里的沙子高起来了（沙丘）', p);
      if (p[1] < 2 && palmAt(p[0], p[2])) return no('那里有椰子树', p);
    }
    for (const c of pc.cells) {
      const p = c.pos;
      if (mount === 'wall') {
        const d = DIRV[facing], b = [p[0] - d[0], p[1], p[2] - d[1]], s = ign.has(key(b)) ? null : V.st(b);
        if (!wallLike(s)) return no('挂墙的东西背后要有墙' + (s ? '（背后是' + nameOf(s) + '）' : '（背后是空的）') + '：拖到墙上，它会自己转过来贴着墙', p);
      } else if (mount === 'ceiling') {
        const a = [p[0], p[1] + 1, p[2]], s = ign.has(key(a)) ? null : V.st(a);
        if (!s || isMod(s) || !HB().boxes(s).length) return no('吊顶的东西上面要有东西挂（屋脊、横梁、楼板下面）', p);
      } else {
        if (p[1] !== main[1]) continue;                                 // 只看最下面一层
        const b = [p[0], p[1] - 1, p[2]], s = ign.has(key(b)) ? null : V.st(b);
        if (s) {
          if (isMod(s)) return no('下面是' + nameOf(s) + '：家具不能叠在家具上', p);
          if (!solidTop(s)) return no('下面是' + nameOf(s) + '，放不稳', p);
        } else {
          const g = ground(p[0], p[2]);
          if (g.top < p[1] - 0.13 || g.low < p[1] - 0.3) return no('下面是空的（要放在地板、地面或者栏杆头上）', p);
          if (g.wet) return no('那里是湿沙，会被海水打湿', p);
        }
      }
    }
    return { ok: true, piece: pc };
  }

  // ---- 射线：按格子走（Amanatides–Woo）----
  // 射线和盒子（世界坐标 [x0,y0,z0,x1,y1,z1]）：→ { t, n }（n = 进去那一面朝外的法线；起点就在盒子里时 n = null）或 null
  function rayBox(o, d, b) {
    let tn = -Infinity, tf = Infinity, n = null;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-12) { if (o[k] < b[k] || o[k] > b[k + 3]) return null; continue; }
      let t1 = (b[k] - o[k]) / d[k], t2 = (b[k + 3] - o[k]) / d[k];
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
      if (t1 > tn) { tn = t1; n = [0, 0, 0]; n[k] = d[k] > 0 ? -1 : 1; }
      if (t2 < tf) tf = t2;
      if (tn > tf) return null;
    }
    if (tf < 0) return null;
    return tn >= 0 ? { t: tn, n } : { t: 0, n: null };
  }
  const wbox = (c, b) => [c[0] + b[0], c[1] + b[1], c[2] + b[2], c[0] + b[3], c[1] + Math.min(1, b[4]), c[2] + b[5]];
  // 沿射线一格一格走（只在 B 这个范围里），fn(格子, t) 返回 undefined 就接着走
  function cast(o, d, B, fn) {
    const bb = rayBox(o, d, [B.x0, B.y0, B.z0, B.x1, B.y1, B.z1]);
    if (!bb) return undefined;
    const lo = [B.x0, B.y0, B.z0], hi = [B.x1, B.y1, B.z1];
    let t = bb.t;
    const c = [0, 1, 2].map((k) => U.clamp(Math.floor(o[k] + d[k] * (t + 1e-6)), lo[k], hi[k] - 1));
    const step = d.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
    const tMax = [0, 1, 2].map((k) => (step[k] ? ((step[k] > 0 ? c[k] + 1 : c[k]) - o[k]) / d[k] : Infinity));
    const tDel = d.map((v) => (v ? Math.abs(1 / v) : Infinity));
    for (let n = 0; n < 4000; n++) {
      const r = fn(c, t);
      if (r !== undefined) return r;
      const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      t = tMax[k]; c[k] += step[k]; tMax[k] += tDel[k];
      if (c[k] < lo[k] || c[k] >= hi[k]) return undefined;
    }
    return undefined;
  }
  const THRU = /(_pane|glass|_fence|_fence_gate|lantern|chain|_bars)$/;      // 点选时看得穿
  const RAY = new THREE.Raycaster();
  function rayAt(cx, cy) {
    const R = V3.R, r = R.canvas.getBoundingClientRect();
    RAY.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), R.camera);
    return { o: RAY.ray.origin.toArray(), d: RAY.ray.direction.toArray() };
  }
  // 点到的东西：{ cell, piece: true }（家具）/ { cell, block }（房子的方块：墙、屋顶……）/ null
  function pickAt(ray, V) {
    return cast(ray.o, ray.d, V.B, (c) => {
      if (!HB().visibleAt(c[0], c[1], c[2])) return undefined;
      const s = V.st(c);
      if (!s) return undefined;
      if (isMod(s)) {
        const f = FM().byBlock(s.ns + ':' + s.id);
        if (!f) return undefined;
        const thin = FM().collideOf(f, (s.props || {}).part) === 'thin';
        return rayBox(ray.o, ray.d, wbox(c, thin ? [0, 0, 0, 1, 0.25, 1] : [0, 0, 0, 1, 1, 1])) ? { cell: c.slice(), piece: true } : undefined;
      }
      if (THRU.test(s.id)) return undefined;
      for (const b of HB().boxes(s)) if (rayBox(ray.o, ray.d, wbox(c, b))) return { cell: c.slice(), block: s };
      return undefined;
    }) || null;
  }
  // 射线打到的「面」（房子的方块，家具和 ign 里的格子看得穿）：{ p, n, cell }；没打到房子就打到沙地（y = 0 那个平面）
  function surfaceAt(ray, V, ign) {
    const hit = cast(ray.o, ray.d, V.B, (c) => {
      if (!HB().visibleAt(c[0], c[1], c[2]) || ign.has(key(c))) return undefined;
      const s = V.st(c);
      if (!s || isMod(s)) return undefined;
      let best = null;
      for (const b of HB().boxes(s)) { const h = rayBox(ray.o, ray.d, wbox(c, b)); if (h && h.n && (!best || h.t < best.t)) best = h; }
      return best ? { p: [0, 1, 2].map((k) => ray.o[k] + ray.d[k] * best.t), n: best.n, cell: c.slice() } : undefined;
    });
    if (hit) return hit;
    if (ray.d[1] >= -1e-6) return null;
    const t = (0 - ray.o[1]) / ray.d[1];
    return t > 0 ? { p: [ray.o[0] + ray.d[0] * t, 0, ray.o[2] + ray.d[2] * t], n: [0, 1, 0], terrain: true } : null;
  }
  // 拖到哪一格：放地上的从打到的面往下落到地上；挂墙的贴着打到的那面墙（facing = 离开墙的方向）；吊顶的往上贴到东西下面
  function targetAt(ray, V, f, facing, ign) {
    const h = surfaceAt(ray, V, ign);
    if (!h) return null;
    const mount = FM().mountOf(f), n = h.n, c = [0, 1, 2].map((k) => Math.floor(h.p[k] + n[k] * 0.02));
    const free = (q) => V.inside(q) && (isFree(V.str(q)) || ign.has(key(q)));
    let fc = null;
    if (mount === 'wall') {
      if (Math.abs(n[1]) < 0.5) fc = dirName(n);
      else for (const x of [facing].concat(CW.filter((q) => q !== facing))) { const d = DIRV[x]; if (wallLike(V.st([c[0] - d[0], c[1], c[2] - d[1]]))) { fc = x; break; } }
    } else if (mount === 'ceiling') {
      if (n[1] >= -0.5) for (let i = 0; i < 14 && free([c[0], c[1] + 1, c[2]]); i++) c[1]++;
    } else if (n[1] < 0.5) {
      for (let i = 0; i < 14 && c[1] > V.B.y0 && free([c[0], c[1] - 1, c[2]]); i++) c[1]--;
    }
    return { cell: c, facing: fc || facing };
  }

  // ---- 本次布置的状态 ----
  // S = { model（场景里的模型，改了就换新的）, place（房子摆法）, start（进来时的）, undo: [快照], track: id → { id, block, main, facing, orig },
  //       sel: { kind: 'piece', id } | { kind: 'house' } | null, mode: 'furn' | 'house', drag, press, placing }
  let S = null;
  const snap = () => ({ model: S.model, place: Object.assign({}, S.place), track: [...S.track.values()].map((t) => Object.assign({}, t, { main: t.main.slice() })),
    sel: S.sel && Object.assign({}, S.sel), mode: S.mode });
  function commit(model, opts = {}) {
    S.undo.push(snap());
    if (S.undo.length > 300) S.undo.shift();
    S.model = model;
    if (opts.place) S.place = Object.assign({}, opts.place);
    schedule(opts.delay || 0);
  }
  // 这件在本次布置里的记录（第一次碰到时记下它原来在哪，「放回原处」用）
  function trackOf(pc) {
    for (const t of S.track.values()) if (t.block === pc.f.block && t.facing === pc.facing && key(t.main) === key(pc.main)) return t;
    const t = { id: ++S.seq, block: pc.f.block, main: pc.main.slice(), facing: pc.facing, orig: { main: pc.main.slice(), facing: pc.facing } };
    S.track.set(t.id, t);
    return t;
  }
  function selPiece() {
    if (!S || !S.sel || S.sel.kind !== 'piece') return null;
    const t = S.track.get(S.sel.id);
    if (!t) return null;
    const pc = pieceAt(mview(S.model), t.main);
    return pc && pc.f.block === t.block && pc.facing === t.facing && key(pc.main) === key(t.main) ? Object.assign(pc, { t }) : null;
  }
  const OK = { ok: true };
  const fail = (why) => ({ ok: false, why });
  function movePiece(pc, main, facing) {
    const V = mview(S.model), ign = new Set(pc.cells.map((c) => key(c.pos)));
    if (key(main) === key(pc.main) && facing === pc.facing) return fail('已经在这里了');
    const r = check(V, pc.f, main, facing, ign);
    if (!r.ok) return r;
    const clear = pc.cells.filter((c) => sameBlock(V.st(c.pos), pc.f)).map((c) => ({ pos: c.pos, state: AIR }));
    // 方块实体（相册、照片）跟着同一个 part 走；原来没有的（老鲸图）新的那格给一条空的
    const carry = new Map(pc.cells.map((c) => [String(c.part), sameBlock(V.st(c.pos), pc.f) ? beAt(V, c.pos) : null]));
    const put = r.piece.cells.map((c) => {
      const be = carry.get(String(c.part)), fresh = freshBE(c.state);
      return { pos: c.pos, state: c.state, be: fresh ? (be ? { id: be.id, data: be.data } : fresh) : null };
    });
    commit(writeModel(S.model, clear.concat(put)), { delay: S.keyDelay || 0 });
    pc.t.main = main.slice(); pc.t.facing = facing;
    return OK;
  }

  // ---- 操作（按钮、键盘、测试都走这里；返回 { ok, why }）----
  function selectAt(cell) {
    const pc = pieceAt(mview(S.model), cell);
    if (!pc) { S.sel = null; return fail('那里没有家具'); }
    const t = trackOf(pc);
    S.sel = { kind: 'piece', id: t.id }; S.mode = 'furn';
    return Object.assign({ ok: true }, pieceInfo(pc));
  }
  function nudge(dir) {
    if (S.mode === 'house') return houseNudge(dir);
    const pc = selPiece(), d = DIRV[dir];
    if (!pc) return fail('先选中一件家具');
    if (!d) return fail('方向不对：' + dir);
    let first = null;
    for (const dy of [0, -1, 1]) {                                      // 同一层放不下就试试低一格、高一格（门廊 ↔ 沙滩、上下台阶）
      const r = movePiece(pc, [pc.main[0] + d[0], pc.main[1] + dy, pc.main[2] + d[1]], pc.facing);
      if (r.ok) return r;
      if (!first) first = r;
    }
    return fail(first.why);
  }
  function rotate() {
    if (S.mode === 'house') return houseRotate();
    const pc = selPiece();
    if (!pc) return fail('先选中一件家具');
    const F = FM(), wall = F.mountOf(pc.f) === 'wall', i = CW.indexOf(pc.facing);
    let first = null;
    for (const k of wall ? [1, 2, 3] : [1]) {
      const fc = CW[(i + k) % 4];
      // 绕哪一格转：先绕主格，转不开再绕别的格子（2 格长的家具在墙角也转得过来）
      for (const c of pc.cells) {
        const local = rotK(sub3(c.pos, pc.main), (4 - CW.indexOf(pc.facing)) % 4), main = sub3(c.pos, rotK(local, CW.indexOf(fc)));
        const r = movePiece(pc, main, fc);
        if (r.ok) return r;
        if (!first) first = r;
      }
    }
    return fail(wall ? '挂墙的东西只能贴着墙，这里转不了方向' : first.why);
  }
  function resetPiece() {
    if (S.mode === 'house') return houseReset();
    const pc = selPiece();
    if (!pc) return fail('先选中一件家具');
    if (!pc.t.orig) return fail('这件是刚加的，没有原处（不要可以拆掉）');
    if (key(pc.t.orig.main) === key(pc.main) && pc.t.orig.facing === pc.facing) return fail('已经在原处了');
    return movePiece(pc, pc.t.orig.main, pc.t.orig.facing);
  }
  function removePiece() {
    if (S.mode === 'house') return fail('房子不能拆');
    const pc = selPiece();
    if (!pc) return fail('先选中一件家具');
    const V = mview(S.model);
    commit(writeModel(S.model, pc.cells.filter((c) => sameBlock(V.st(c.pos), pc.f)).map((c) => ({ pos: c.pos, state: AIR }))));
    S.track.delete(pc.t.id); S.sel = null;
    return Object.assign({ ok: true }, { removed: pc.f.label });
  }
  function moveSelTo(main, facing) {
    const pc = selPiece();
    if (!pc) return fail('先选中一件家具');
    return movePiece(pc, main, facing || pc.facing);
  }
  function addPiece(f, main, facing) {
    const r = check(mview(S.model), f, main, facing);
    if (!r.ok) return r;
    commit(writeModel(S.model, r.piece.cells.map((c) => ({ pos: c.pos, state: c.state, be: freshBE(c.state) }))));
    const t = { id: ++S.seq, block: f.block, main: main.slice(), facing, orig: null };
    S.track.set(t.id, t); S.sel = { kind: 'piece', id: t.id }; S.mode = 'furn';
    return OK;
  }
  // 换照片（docs/PHOTOS.md 第 5 节）：cell = 相框那格 / 画框墙 part=0 那格，slot = 第几个框，photo = 相册里的一张或 null（空）。算一步，能撤销
  function setPhoto(cell, slot, photo) {
    const P = V3.photos, fr = P && P.frameAt(S.model, cell);
    if (!fr) return fail('那里没有相框');
    if (!(slot >= 0 && slot < fr.slots.length)) return fail('没有第 ' + (slot + 1) + ' 个框');
    const cur = fr.slots[slot];
    if ((cur ? cur.id : null) === (photo ? photo.id : null)) return fail(photo ? '已经是这张了' : '已经是空的了');
    commit(P.setSlot(S.model, cell, slot, photo));
    return OK;
  }
  // 选中的相框 / 画框墙：打开「换照片」（68-album 的选择框），挑好了照片走 setPhoto
  function pickPhoto(slot) {
    const pc = selPiece();
    if (!pc || !(pc.f.photoSlots && pc.f.photoSlots.length)) return fail('先选中一个相框或者画框');
    if (!V3.album || !V3.album.pick) return fail('这个页面没有相册');
    V3.album.pick({ model: () => S && S.model, cell: pc.main.slice(), slot, apply: (s, photo) => act(setPhoto(pc.main, s, photo)) });
    return OK;
  }
  function undo() {
    const u = S.undo.pop();
    if (!u) return fail('没有可以撤销的了');
    S.model = u.model; S.place = u.place; S.track = new Map(u.track.map((t) => [t.id, t])); S.sel = u.sel; S.mode = u.mode;
    endDrag(false); S.placing = null;
    schedule(0);
    return OK;
  }
  const pieceInfo = (pc) => ({ id: pc.f.id, label: pc.f.label, block: pc.f.block, cell: pc.main.slice(), facing: pc.facing, cells: pc.cells.map((c) => c.pos), mount: FM().mountOf(pc.f) });

  // ---- 挪房子（第二步）：place = { dx, dz, k }，模型整张转 / 挪（54-house-mc 的 HB.placeModel）----
  const canMoveHouse = () => !!(HB() && HB().placeModel && HB().unplaceModel);
  const houseLocal = () => (HB().isIdentity(S.place) ? S.model : HB().unplaceModel(S.model, S.place));
  // 房子摆在这里行不行：每一列有方块的地方，下面要是平的干沙（不压石堆、礁石、沙丘、湿沙、海）、不压椰子树和沙滩上的爬藤、不出场地
  function checkHouse(world) {
    const V = mview(world), S0 = V3.layout.site, cols = new Map();
    for (let i = 0; i < world.cells.length; i++) {
      if (isAirStr(world.palette[world.cells[i]])) continue;
      const x = V.org[0] + i % V.W, z = V.org[2] + Math.floor(i / V.W) % V.L, y = V.org[1] + Math.floor(i / (V.W * V.L));
      const k = x + ',' + z, c = cols.get(k);
      if (c == null || y < c) cols.set(k, y);
    }
    for (const [k, y0] of cols) {                                         // 先看出没出场地（最要紧），再看压到什么
      const [x, z] = k.split(',').map(Number);
      if (x < S0.x0 + 1 || x + 1 > S0.x1 - 1 || z < S0.z0 + 1 || z + 1 > S0.z1 - 1) return { ok: false, why: '会跑出场地', at: [x, y0, z] };
    }
    for (const [k, y0] of cols) {
      const [x, z] = k.split(',').map(Number), at = [x, y0, z];
      const g = ground(x, z);
      if (g.wet) return { ok: false, why: '会压到湿沙、跑进海里', at };
      if (g.top > y0 + 0.3) return { ok: false, why: g.rock ? '会压到石堆 / 礁石' : '那里有沙丘，地不平', at };
      if (y0 <= 0 && g.low < y0 - 0.3) return { ok: false, why: '那里地不平', at };
      const p = palmAt(x, z);
      if (p) return { ok: false, why: '会压到' + (p.label || '椰子树'), at };
      const c = y0 <= 0 && creeperAt(x, z);
      if (c) return { ok: false, why: '会压到沙滩上的' + (c.label || '爬藤'), at };
    }
    return OK;
  }
  function tryPlace(place) {
    if (!canMoveHouse()) return fail('这个页面不能挪房子');
    const H = HB(), local = houseLocal(), p = { dx: place.dx | 0, dz: place.dz | 0, k: (((place.k | 0) % 4) + 4) % 4 };
    if (samePlace(p, S.place)) return fail('已经在这里了');
    const world = H.isIdentity(p) ? local : H.placeModel(local, p), r = checkHouse(world);
    if (!r.ok) return r;
    commit(world, { place: p, delay: S.keyDelay || 0 });                // 她跟不跟着挪：重建时按场景里的摆法算（girlFollow）
    return OK;
  }
  // 房子从摆法 from 换到 to（场景里现在是 model）：她在房子那一块里（门廊、屋里、阁楼、台阶前）就跟着一起挪、一起转；在沙滩上不动
  function girlFollow(model, from, to) {
    const A = V3.actor, H = HB(), b = boundsOf(model);
    if (!A || !A.pos || !b || !H.placePoint) return null;
    const p = A.pos;
    if (p[0] < b.mn[0] || p[0] > b.mx[0] || p[2] < b.mn[2] || p[2] > b.mx[2]) return null;
    const q = H.placePoint(H.unplacePoint([p[0], p[1], p[2]], from), to);
    return [q[0], q[2], A.yaw - (((to.k | 0) - (from.k | 0)) * Math.PI / 2), q[1]];
  }
  function houseNudge(dir) { const d = DIRV[dir]; return d ? tryPlace({ dx: S.place.dx + d[0], dz: S.place.dz + d[1], k: S.place.k }) : fail('方向不对：' + dir); }
  // 转 90°：原地转不开（会压到树、出场地……）就找最近一个转得开的地方（8 格以内），挪过去再转，并说一声
  function houseRotate() {
    const k = S.place.k + 1, here = tryPlace({ dx: S.place.dx, dz: S.place.dz, k });
    if (here.ok || !canMoveHouse()) return here;
    const H = HB(), local = houseLocal(), cand = [];
    for (let ddz = -8; ddz <= 8; ddz++) for (let ddx = -8; ddx <= 8; ddx++) if (ddx || ddz) cand.push([ddx, ddz]);
    cand.sort((a, b) => (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])) || Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
    for (const [ddx, ddz] of cand) {
      const p = { dx: S.place.dx + ddx, dz: S.place.dz + ddz, k };
      if (!checkHouse(H.isIdentity(p) ? local : H.placeModel(local, p)).ok) continue;
      const r = tryPlace(p);
      if (!r.ok) continue;
      const bits = [];
      if (ddx) bits.push('往' + (ddx > 0 ? '东' : '西') + '挪了 ' + Math.abs(ddx) + ' 格');
      if (ddz) bits.push('往' + (ddz > 0 ? '南' : '北') + '挪了 ' + Math.abs(ddz) + ' 格');
      say('原地转不开（' + here.why + '），' + bits.join('、') + '再转', true);
      return { ok: true, moved: [ddx, ddz], note: here.why };
    }
    return fail('转不开：' + here.why + '（附近 8 格以内也找不到能转的地方）');
  }
  function houseReset() { return HB().isIdentity(S.place) ? fail('房子已经在原处了') : tryPlace({ dx: 0, dz: 0, k: 0 }); }
  function setMode(mode) {
    if (mode === 'house' && !canMoveHouse()) return fail('这个页面不能挪房子');
    endDrag(false); S.placing = null; closeCatalog();
    S.mode = mode; S.sel = mode === 'house' ? { kind: 'house' } : null;
    return OK;
  }
  // 整张模型里有方块的范围（场景米）：挪房子时的框
  const BOUNDS = new WeakMap();
  function boundsOf(m) {
    if (!m) return null;
    if (BOUNDS.has(m)) return BOUNDS.get(m);
    const V = mview(m), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.cells.length; i++) {
      if (isAirStr(m.palette[m.cells[i]])) continue;
      const p = [V.org[0] + i % V.W, V.org[1] + Math.floor(i / (V.W * V.L)), V.org[2] + Math.floor(i / V.W) % V.L];
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k] + 1); }
    }
    const b = mn[0] === Infinity ? null : { mn, mx };
    BOUNDS.set(m, b);
    return b;
  }

  // ---- 改完重建场景：排队，一次只建一个；方向键连按时等一下再建（keyDelay）----
  const RB = { busy: false, again: false, timer: 0, pending: false, p: Promise.resolve() };
  function schedule(delay) {
    clearTimeout(RB.timer);
    if (delay) { RB.pending = true; RB.timer = setTimeout(() => schedule(0), delay); return; }
    RB.pending = false;
    if (RB.busy) { RB.again = true; return; }
    RB.busy = true;
    RB.p = (async () => {
      try {
        do {
          RB.again = false;
          if (!S) break;
          const H = HB(), m = S.model, pl = Object.assign({}, S.place), moved = !samePlace(pl, H.place);
          if (m === H.model && !moved) continue;
          await H.applyEdit(m, { place: moved ? pl : null, girlAt: moved ? girlFollow(H.model, H.place, pl) : null });
        } while (RB.again);
      } catch (e) { V3.err('arrange rebuild: ' + ((e && e.stack) || e)); }
      RB.busy = false;
      afterRebuild();
    })();
  }
  AR.whenIdle = async () => {
    for (let i = 0; i < 400; i++) {
      if (RB.pending) await new Promise((r) => setTimeout(r, 20));
      else if (RB.busy) await RB.p;
      else return true;
    }
    return false;
  };
  function afterRebuild() {
    HIDDEN = [];                                                        // 场景重建过了：藏起来的那些已经扔掉
    if (S && S.dropGhost) { S.dropGhost = null; showGhost(null); }
    if (S && S.drag && !S.drag.house) hideOriginal(S.drag.pc);           // 重建时正拖着别的：新场景里也先藏起来
  }

  // ---- 场景里的框、半透明预览（加在 V3.R.scene 上，换场景也不丢）----
  let OV = null;
  function overlay() {
    if (OV) return OV;
    const root = new THREE.Group(); root.name = 'arrange-overlay';
    const mat = new THREE.MeshBasicMaterial({ color: 0x6fc3f5, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    const fillM = new THREE.MeshBasicMaterial({ color: 0x6fc3f5, transparent: true, opacity: 0.13, depthTest: false, depthWrite: false });
    const geo = new THREE.BoxGeometry(1, 1, 1), frame = new THREE.Group(), edges = [];
    for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(geo, mat); m.renderOrder = 999; frame.add(m); edges.push(m); }
    const fill = new THREE.Mesh(geo, fillM); fill.renderOrder = 998;
    const ghost = new THREE.Group(); ghost.name = 'arrange-ghost';
    root.add(frame, fill, ghost);
    frame.visible = fill.visible = false;
    root.traverse((o) => { o.userData.noPick = true; o.castShadow = false; o.receiveShadow = false; });
    V3.R.scene.add(root);
    OV = { root, frame, fill, edges, mat, fillM, ghost, geo, ghostKey: '' };
    return OV;
  }
  function showBox(b, bad) {
    const O = overlay();
    O.frame.visible = O.fill.visible = !!b;
    if (!b) return;
    const pad = 0.04, mn = b.mn.map((v) => v - pad), mx = b.mx.map((v) => v + pad), s = [0, 1, 2].map((k) => mx[k] - mn[k]), c = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2);
    const t = Math.max(0.03, Math.min(0.06, Math.max(...s) * 0.012));
    let i = 0;
    for (const ax of [0, 1, 2]) {
      const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
      for (const a of [mn[o1], mx[o1]]) for (const bb of [mn[o2], mx[o2]]) {
        const m = O.edges[i++], p = [0, 0, 0], sc = [t, t, t];
        p[ax] = c[ax]; p[o1] = a; p[o2] = bb; sc[ax] = s[ax] + t;
        m.position.set(p[0], p[1], p[2]); m.scale.set(sc[0], sc[1], sc[2]);
      }
    }
    O.fill.position.set(c[0], c[1], c[2]); O.fill.scale.set(s[0], s[1], s[2]);
    const col = bad ? 0xff5a5a : 0x6fc3f5;
    O.mat.color.setHex(col); O.fillM.color.setHex(col); O.fillM.opacity = bad ? 0.2 : 0.13;
  }
  // 半透明预览：每种家具每个朝向出一份网格（HB.meshFor），留着反复用
  const GH = new Map();
  function ghostOf(f, facing) {
    const k = f.block + '|' + facing;
    if (!GH.has(k)) {
      GH.set(k, (async () => {
        const pc = makePiece(f, [0, 0, 0], facing);
        const g = await HB().meshFor(pc.cells.map((c) => ({ pos: c.pos, state: c.state })));
        g.traverse((o) => {
          o.userData.noPick = true;
          if (!o.isMesh) return;
          o.material = o.material.clone();
          Object.assign(o.material, { transparent: true, opacity: 0.62, depthWrite: false });
          o.material.needsUpdate = true; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 990;
        });
        g.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(g);
        return { group: g, mn: b.isEmpty() ? [0, 0, 0] : b.min.toArray(), mx: b.isEmpty() ? [1, 1, 1] : b.max.toArray() };
      })().catch((e) => { V3.err('arrange ghost ' + k + ': ' + ((e && e.stack) || e)); return null; }));
    }
    return GH.get(k);
  }
  const GHB = new Map();   // 'block|facing' → 量好的外框（相对主格），量好之前用格子
  function pieceBox(pc) {
    const k = pc.f.block + '|' + pc.facing, b = GHB.get(k);
    if (b) return { mn: add3(pc.main, b.mn), mx: add3(pc.main, b.mx) };
    if (!GHB.has(k)) { GHB.set(k, null); ghostOf(pc.f, pc.facing).then((g) => { if (g) GHB.set(k, { mn: g.mn, mx: g.mx }); }); }
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const c of pc.cells) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], c.pos[i]); mx[i] = Math.max(mx[i], c.pos[i] + 1); }
    return { mn, mx };
  }
  // 预览摆在 g = { f, main, facing } 那里（null = 不显示）
  function showGhost(g) {
    const O = overlay(), k = g ? g.f.block + '|' + g.facing : '';
    O.ghost.visible = !!g;
    if (!g) return;
    O.ghost.position.set(g.main[0], g.main[1], g.main[2]);
    if (O.ghostKey === k) return;
    O.ghostKey = k;
    O.ghost.clear();
    ghostOf(g.f, g.facing).then((t) => { if (t && O.ghostKey === k) { O.ghost.clear(); O.ghost.add(t.group); } });
  }
  function disposeGhosts() {
    if (OV) { OV.ghost.clear(); OV.ghostKey = ''; }
    for (const p of GH.values()) p.then((t) => {
      if (!t) return;
      t.group.traverse((o) => { if (o.isMesh && o.material) o.material.dispose(); });
      HB().disposeGroup(t.group);
    });
    GH.clear();
  }

  // ---- 拖动 ----
  let HIDDEN = [];
  function hideOriginal(pc) {
    const cells = pc.cells.map((c) => c.pos), ks = new Set(cells.map(key)), live = HB().live && HB().live();
    if (live && live.setHidden) live.setHidden(cells);
    const cur = V3.models.current && V3.models.current();
    HIDDEN = [];
    if (cur && cur.root) cur.root.traverse((o) => { const c = o.userData && o.userData.cell; if (c && ks.has(key(c)) && o.visible) { o.visible = false; HIDDEN.push(o); } });
  }
  function unhideOriginal() {
    const live = HB().live && HB().live();
    if (live && live.setHidden) live.setHidden(null);
    for (const o of HIDDEN) o.visible = true;
    HIDDEN = [];
  }
  function startDrag(p) {
    if (S.mode === 'house') return startHouseDrag(p);
    let pc = selPiece();
    if (!pc || !p.hit || !pc.cells.some((c) => key(c.pos) === key(p.hit.cell))) {
      if (!p.hit || !p.hit.piece || !selectAt(p.hit.cell).ok) return;
      pc = selPiece();
      if (!pc) return;
    }
    const lg = rotK(sub3(p.hit.cell, pc.main), (4 - CW.indexOf(pc.facing)) % 4);
    S.drag = { id: p.id, pc, grab: [lg[0], 0, lg[2]], target: null };
    try { V3.R.ctl.ptrs.delete(p.id); } catch (e) { /* 镜头没在转 */ }
    hideOriginal(pc);
    document.body.classList.add('ar-dragging');
    showGhost({ f: pc.f, main: pc.main, facing: pc.facing });
  }
  function dragTo(cx, cy) {
    const d = S.drag;
    if (!d) return;
    if (d.house) return houseDragTo(cx, cy);
    const V = mview(S.model), pc = d.pc, ign = new Set(pc.cells.map((c) => key(c.pos)));
    const tg = targetAt(rayAt(cx, cy), V, pc.f, pc.facing, ign);
    if (!tg) { d.target = null; tip('', cx, cy); return; }
    const g = rotK(d.grab, CW.indexOf(tg.facing)), main = [tg.cell[0] - g[0], tg.cell[1], tg.cell[2] - g[2]];
    const r = check(V, pc.f, main, tg.facing, ign);
    d.target = { main, facing: tg.facing, ok: r.ok, why: r.why || '' };
    tip(r.ok ? '' : '放不下：' + r.why, cx, cy);
  }
  function endDrag(apply) {
    const d = S && S.drag;
    if (!d) return null;
    S.drag = null;
    document.body.classList.remove('ar-dragging');
    tip('');
    if (d.house) return endHouseDrag(d, apply);
    let r = null;
    if (apply && d.target && d.target.ok) {
      r = movePiece(d.pc, d.target.main, d.target.facing);
      if (r.ok) { S.dropGhost = true; return r; }
    } else if (apply && d.target && !d.target.ok) r = fail(d.target.why);
    unhideOriginal(); showGhost(null);
    if (r && !r.ok && r.why !== '已经在这里了') say(r.why);
    return r;
  }
  // 挪房子：按住房子拖，按沙地上的点挪（整格）；松手时放得下才挪
  function startHouseDrag(p) {
    const b = boundsOf(S.model);
    if (!b) return;
    const ray = rayAt(p.x, p.y), t = ray.d[1] < -1e-6 ? -ray.o[1] / ray.d[1] : -1;
    if (t <= 0) return;
    S.sel = { kind: 'house' };
    S.drag = { id: p.id, house: true, from: [ray.o[0] + ray.d[0] * t, ray.o[2] + ray.d[2] * t], base: Object.assign({}, S.place), target: null };
    try { V3.R.ctl.ptrs.delete(p.id); } catch (e) { /* 镜头没在转 */ }
    document.body.classList.add('ar-dragging');
  }
  function houseDragTo(cx, cy) {
    const d = S.drag, ray = rayAt(cx, cy), t = ray.d[1] < -1e-6 ? -ray.o[1] / ray.d[1] : -1;
    if (t <= 0) return;
    const dx = Math.round(ray.o[0] + ray.d[0] * t - d.from[0]), dz = Math.round(ray.o[2] + ray.d[2] * t - d.from[1]);
    const p = { dx: d.base.dx + dx, dz: d.base.dz + dz, k: d.base.k };
    if (d.target && samePlace(d.target.place, p)) { tip(d.target.ok ? '' : '放不下：' + d.target.why, cx, cy); return; }
    const H = HB(), world = H.isIdentity(p) ? houseLocal() : H.placeModel(houseLocal(), p), r = samePlace(p, S.place) ? OK : checkHouse(world);
    d.target = { place: p, ok: r.ok, why: r.why || '', box: boundsOf(world) };
    tip(r.ok ? '' : '放不下：' + r.why, cx, cy);
  }
  function endHouseDrag(d, apply) {
    if (!apply || !d.target || samePlace(d.target.place, S.place)) return null;
    if (!d.target.ok) { say(d.target.why); return fail(d.target.why); }
    return tryPlace(d.target.place);
  }

  // ---- 加家具：点清单里的一种，它跟着指针走，点地方放下 ----
  function startPlacing(id) {
    const f = FM().byId(id);
    if (!f) return fail('没有这种家具：' + id);
    endDrag(false);
    if (S.mode === 'house') S.mode = 'furn';
    S.sel = null;
    S.placing = { f, facing: camFacing(), target: null };
    closeCatalog();
    return OK;
  }
  function placingAt(cx, cy) {
    const P = S.placing, V = mview(S.model);
    const tg = targetAt(rayAt(cx, cy), V, P.f, P.facing, new Set());
    if (!tg) { P.target = null; return null; }
    const r = check(V, P.f, tg.cell, tg.facing, null);
    P.target = { main: tg.cell, facing: tg.facing, ok: r.ok, why: r.why || '' };
    return P.target;
  }
  function placeTap(cx, cy) {
    const t = placingAt(cx, cy);
    if (!t) return fail('点到地面、地板、墙上或者屋脊下面');
    if (!t.ok) { say(t.why); return fail(t.why); }
    const f = S.placing.f, r = addPiece(f, t.main, t.facing);
    if (r.ok) { S.placing = null; say('放好了「' + f.label + '」', true); }
    else say(r.why);
    return r;
  }
  // 新家具默认正面朝着镜头
  function camFacing() {
    const c = V3.R && V3.R.camera, t = V3.R && V3.R.ctl && V3.R.ctl.target;
    if (!c || !t) return 'south';
    const dx = c.position.x - t.x, dz = c.position.z - t.z;
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : (dz > 0 ? 'south' : 'north');
  }
  // 镜头方向 → 世界方向：屏幕上「往上」是离开镜头那个方向（东南西北里最接近的）
  function camDirs() {
    const back = camFacing(), i = CW.indexOf(back);
    return { up: CW[(i + 2) % 4], down: back, right: CW[(i + 3) % 4], left: CW[(i + 1) % 4] };
  }

  // ---- 界面 ----
  const say = (t, good) => { if (V3.hud && V3.hud.toast && V3.hud.mounted) V3.hud.toast(t, { color: good ? '#6fc3f5' : '#ff8a8a', ms: good ? 2600 : 4200 }); };
  const clean = (r) => { if (!r) return r; const o = Object.assign({}, r); delete o.piece; return o; };
  const act = (r) => { if (r && !r.ok && r.why) say(r.why); sync(); return clean(r); };
  let UI = null;
  const ARROW = { up: '↑', down: '↓', left: '←', right: '→' };
  function btn(label, cls, onclick, title) { return U.el('button', { class: 'ar-btn' + (cls ? ' ' + cls : ''), type: 'button', title: title || label, onclick }, label); }
  function buildUI() {
    const bar = U.el('div', { class: 'ar-bar' });
    const discard = btn('放弃修改', 'warn', () => {
      if (!AR.dirty()) { AR.discard(); return; }
      if (discard.classList.contains('ask')) { AR.discard(); return; }
      discard.classList.add('ask'); discard.textContent = '确定放弃？';
      setTimeout(() => { discard.classList.remove('ask'); discard.textContent = '放弃修改'; }, 3000);
    }, '不要这次的改动，回到进来时的样子');
    const cat = btn('加家具', 'pri', () => toggleCatalog(), '从清单里挑一件放进房子');
    const house = btn('挪房子', '', () => { act(setMode(S.mode === 'house' ? 'furn' : 'house')); }, '整栋房子按格子挪、转方向（也可以长按墙或屋顶）');
    const undoB = btn('撤销一步', '', () => act(undo()), '撤销一步（Ctrl+Z）');
    const exp = btn('导出鲸图', '', async () => {
      exp.disabled = true;
      try {
        await AR.whenIdle();
        if (OV) OV.root.visible = false;
        const p = HB().exportFromUI();                                   // 鲸图上的截图不带框和预览（截图在这一步同步拍）
        if (OV) OV.root.visible = true;
        await p;
      } catch (e) { say('没导出来：' + ((e && e.message) || e)); }
      if (OV) OV.root.visible = !!AR.on;
      exp.disabled = false;
    },
      '把现在这栋房子存成鲸图，放进 MC 的 xiaojingyu 文件夹用 /xjy place 盖出来');
    const doneB = btn('完成', 'go', () => AR.done(), '存好，回到游戏');
    if (!canMoveHouse()) house.style.display = 'none';
    const tipEl = U.el('div', { class: 'ar-hint' }, '');
    bar.append(U.el('div', { class: 'ar-title' }, '布置模式'), tipEl, U.el('div', { class: 'ar-btns' }, cat, house, exp, undoB, discard, doneB));
    // 选中时旁边的小按钮
    const name = U.el('b', { class: 'ar-pop-name' });
    const pad = U.el('div', { class: 'ar-pad' });
    const dirB = {};
    for (const slot of ['up', 'left', 'rot', 'right', 'down']) {
      if (slot === 'rot') { pad.append(U.el('button', { class: 'ar-key rot', type: 'button', title: '转 90°（R）', 'data-slot': 'rot', onclick: () => act(rotate()) }, '⟳', U.el('small', null, '转向'))); continue; }
      const b = U.el('button', { class: 'ar-key ' + slot, type: 'button', 'data-slot': slot, onclick: () => { const d = camDirs()[slot]; act(nudge(d)); } });
      dirB[slot] = b; pad.append(b);
    }
    const resetB = btn('放回原处', '', () => act(resetPiece()), '回到这次布置开始时的位置');
    const delB = btn('拆掉', 'warn', () => act(removePiece()), '拆掉这件（Delete）');
    const photoB = btn('换照片', 'pri ar-photo', () => act(pickPhoto()), '从相册里挑一张挂上，或者换回空的');
    const msg = U.el('div', { class: 'ar-pop-msg' });
    const pop = U.el('div', { class: 'ar-pop hide' },
      U.el('div', { class: 'ar-pop-head' }, name, U.el('button', { class: 'ar-x', type: 'button', title: '取消选中（Esc）', onclick: () => { escape(); } }, '✕')),
      pad, U.el('div', { class: 'ar-pop-row' }, resetB, delB), U.el('div', { class: 'ar-pop-row' }, photoB), msg);
    // 正在放新家具时的小条
    const plName = U.el('b');
    const placing = U.el('div', { class: 'ar-placing hide' }, U.el('span', null, '放：', plName, '　点地面、墙上或者屋脊下面放下'),
      btn('转向', '', () => { if (S.placing) { S.placing.facing = CW[(CW.indexOf(S.placing.facing) + 1) % 4]; S.placing.target = null; sync(); } }, '转 90°（R）'),
      btn('取消', '', () => { S.placing = null; sync(); }, '不放了（Esc）'));
    const tipBad = U.el('div', { class: 'ar-tipbad hide' });
    const root = U.el('div', { class: 'ar-root' }, bar, pop, placing, tipBad);
    document.body.append(root);
    UI = { root, bar, pop, name, pad, dirB, resetB, delB, photoB, msg, placing, plName, tipBad, tipEl, undoB, house, cat: null };
    sync();
  }
  function tip(text, cx, cy) {
    if (!UI) return;
    UI.tipBad.classList.toggle('hide', !text);
    if (!text) return;
    UI.tipBad.textContent = text;
    const w = innerWidth, x = U.clamp(cx + 16, 8, w - 260);
    UI.tipBad.style.left = x + 'px'; UI.tipBad.style.top = U.clamp(cy + 18, 8, innerHeight - 60) + 'px';
  }
  // 界面跟着状态走（按钮、文字）；每帧再摆一次位置
  function sync() {
    if (!UI || !S) return;
    const house = S.mode === 'house', pc = house ? null : selPiece();
    UI.house.classList.toggle('on', house);
    UI.house.textContent = house ? '挪家具' : '挪房子';
    UI.undoB.disabled = !S.undo.length;
    UI.tipEl.textContent = house ? '按住房子拖，或者用小按钮一格一格挪、转；压到树、石头、爬藤、湿沙的地方放不下'
      : S.placing ? '点一个地方放下；按住空地照样转镜头' : '长按家具拖动 · 点一下选中 · 按住空地转镜头';
    const show = !!(pc || house) && !S.placing && !S.drag;
    UI.pop.classList.toggle('hide', !show);
    UI.pop.classList.toggle('house', house);
    if (show) {
      UI.name.textContent = house ? '整栋房子' + (HB().isIdentity(S.place) ? '' : '（挪过）') : pc.f.label;
      UI.resetB.disabled = house ? HB().isIdentity(S.place) : !pc.t.orig || (key(pc.t.orig.main) === key(pc.main) && pc.t.orig.facing === pc.facing);
      UI.delB.style.display = house ? 'none' : '';
      UI.photoB.parentNode.style.display = !house && pc.f.photoSlots && pc.f.photoSlots.length ? '' : 'none';   // 相框、画框墙多一个「换照片」
      UI.msg.textContent = house ? '' : pc.broken ? '这件的格子不全（MC 里可能缺了一半），挪的时候会补全' : '';
    }
    UI.placing.classList.toggle('hide', !S.placing);
    if (S.placing) UI.plName.textContent = S.placing.f.label;
    labelPad();
  }
  function labelPad() {
    if (!UI) return;
    const d = camDirs();
    for (const slot in UI.dirB) {
      const b = UI.dirB[slot], w = d[slot];
      if (b.dataset.dir === w) continue;
      b.dataset.dir = w; b.title = '往' + CN[w] + '挪一格（方向键）';
      b.replaceChildren(ARROW[slot], U.el('small', null, CN[w]));
    }
  }
  // 每帧：框、预览、小按钮的位置
  const _v = new THREE.Vector3();
  function frame() {
    if (!AR.on || !S || !UI) return;
    const pc = S.mode === 'house' ? null : selPiece();
    let box = null, bad = false;
    if (S.drag && !S.drag.house) {
      const t = S.drag.target;
      if (t) { const g = makePiece(S.drag.pc.f, t.main, t.facing); box = pieceBox(g); bad = !t.ok; showGhost({ f: g.f, main: t.main, facing: t.facing }); }
      else showGhost(null);
    } else if (S.drag && S.drag.house) {
      const t = S.drag.target;
      box = t ? t.box : boundsOf(S.model); bad = !!(t && !t.ok);
    } else if (S.placing) {
      const t = S.placing.target;
      if (t) { box = pieceBox(makePiece(S.placing.f, t.main, t.facing)); bad = !t.ok; showGhost({ f: S.placing.f, main: t.main, facing: t.facing }); }
      else showGhost(null);
    } else if (S.mode === 'house') box = boundsOf(S.model);
    else if (pc) box = pieceBox(pc);
    if (!S.drag && !S.placing && !S.dropGhost) showGhost(null);
    showBox(box, bad);
    labelPad();
    placePop(S.mode === 'house' || pc ? box : null);
  }
  function placePop(box) {
    const el = UI.pop;
    if (!box || el.classList.contains('hide')) return;
    const narrow = innerWidth < 640;
    el.classList.toggle('dock', narrow);
    if (narrow) { el.style.left = el.style.top = ''; return; }
    const cam = V3.R.camera;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, front = false;
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? box.mx[0] : box.mn[0], i & 2 ? box.mx[1] : box.mn[1], i & 4 ? box.mx[2] : box.mn[2]).project(cam);
      if (_v.z > 1) continue;
      front = true;
      const sx = (_v.x + 1) / 2 * innerWidth, sy = (1 - _v.y) / 2 * innerHeight;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const w = el.offsetWidth || 190, h = el.offsetHeight || 220;
    let left = front ? x1 + 18 : innerWidth - w - 18, top = front ? (y0 + y1) / 2 - h / 2 : innerHeight - h - 90;
    if (front && left + w > innerWidth - 10) left = x0 - w - 18;
    left = U.clamp(left, 10, innerWidth - w - 10); top = U.clamp(top, 96, innerHeight - h - 76);
    el.style.left = Math.round(left) + 'px'; el.style.top = Math.round(top) + 'px';
  }

  // ---- 家具清单（41 种，屋里 / 屋外；小图在第一次打开时用 renderer 画）----
  const INDOOR = { ground: 1, loft: 1 };
  function toggleCatalog() { if (UI && UI.cat && !UI.cat.classList.contains('hide')) closeCatalog(); else openCatalog(); }
  function closeCatalog() { if (UI && UI.cat) UI.cat.classList.add('hide'); }
  function openCatalog(tab) {
    if (!UI) return;
    if (S.mode === 'house') setMode('furn');
    S.placing = null; S.sel = null;
    if (!UI.cat) {
      const grid = U.el('div', { class: 'ar-cat-grid' }), tabs = U.el('div', { class: 'ar-cat-tabs' });
      const items = FM().list.map((f) => {
        const img = U.el('img', { class: 'ar-item-img', alt: '', src: THUMBS && THUMBS[f.id] ? THUMBS[f.id] : BLANK });
        const b = U.el('button', { class: 'ar-item', type: 'button', 'data-id': f.id, 'data-in': INDOOR[f.layout && f.layout.layer] ? '1' : '0', title: f.label,
          onclick: () => { act(startPlacing(f.id)); } }, img, U.el('span', null, f.label));
        grid.append(b);
        return { f, b, img };
      });
      const setTab = (t) => {
        for (const x of tabs.children) x.classList.toggle('on', x.dataset.t === t);
        for (const it of items) it.b.classList.toggle('hide', (it.b.dataset.in === '1') !== (t === 'in'));
        UI.catTab = t;
      };
      for (const [t, l] of [['in', '屋里'], ['out', '屋外']]) tabs.append(U.el('button', { class: 'ar-cat-tab', type: 'button', 'data-t': t, onclick: () => setTab(t) }, l));
      UI.cat = U.el('div', { class: 'ar-cat hide' },
        U.el('div', { class: 'ar-cat-head' }, U.el('b', null, '加家具'), tabs, U.el('button', { class: 'ar-x', type: 'button', title: '关上', onclick: () => closeCatalog() }, '✕')),
        grid, U.el('div', { class: 'ar-cat-hint' }, '点一件，它跟着指针走；再点地面、墙上或者屋脊下面放下（放不下的地方是红的）。'));
      UI.root.append(UI.cat);
      UI.catItems = items;
      setTab('in');
      makeThumbs().then((T) => { for (const it of items) if (T[it.f.id]) it.img.src = T[it.f.id]; }).catch((e) => V3.err('arrange thumbs: ' + ((e && e.stack) || e)));
    }
    if (tab) [...UI.cat.querySelectorAll('.ar-cat-tab')].find((x) => x.dataset.t === tab).click();
    UI.cat.classList.remove('hide');
    sync();
  }
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  let THUMBS = null, THUMBS_P = null;
  // 41 种家具一次出网格（朝南，正面对着镜头），一种一种画到 112×112 的小图（线性 → sRGB 自己换）
  function makeThumbs() {
    if (THUMBS_P) return THUMBS_P;
    THUMBS_P = (async () => {
      const out = {}, list = FM().list, cols = 8, sp = 6, items = [];
      list.forEach((f, i) => { for (const c of makePiece(f, [(i % cols) * sp, 0, Math.floor(i / cols) * sp], 'south').cells) items.push({ pos: c.pos, state: c.state }); });
      const g = await HB().meshFor(items), rr = V3.R.renderer, N = 112;
      const rt = new THREE.WebGLRenderTarget(N, N, { samples: rr.capabilities.isWebGL2 ? 4 : 0 });
      const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(0xffffff, 1.7);
      sun.position.set(2, 5, 4);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xc8b89a, 1.25), sun, g);
      g.updateMatrixWorld(true);
      const cam = new THREE.PerspectiveCamera(26, 1, 0.05, 200), buf = new Uint8Array(N * N * 4);
      const cv = U.el('canvas', { width: N, height: N }), cx = cv.getContext('2d'), img = cx.createImageData(N, N);
      const LUT = new Uint8Array(256);
      for (let i = 0; i < 256; i++) { const v = i / 255; LUT[i] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }
      const prev = { rt: rr.getRenderTarget(), ac: rr.autoClear, cc: rr.getClearColor(new THREE.Color()), ca: rr.getClearAlpha() };
      try {
        for (const f of list) {
          const grp = g.children.find((o) => o.name === '小屋/家具/' + f.label);
          if (!grp) continue;
          for (const o of g.children) o.visible = o === grp;
          const box = new THREE.Box3().setFromObject(grp), c = box.getCenter(new THREE.Vector3()), r = Math.max(0.35, box.getSize(new THREE.Vector3()).length() / 2);
          const az = 0.62, el = 0.42, dist = r / Math.sin(13 * Math.PI / 180);
          cam.position.set(c.x + dist * Math.cos(el) * Math.sin(az), c.y + dist * Math.sin(el), c.z + dist * Math.cos(el) * Math.cos(az));
          cam.lookAt(c);
          rr.setRenderTarget(rt); rr.autoClear = true; rr.setClearColor(0x000000, 0); rr.clear(); rr.render(scene, cam);
          rr.readRenderTargetPixels(rt, 0, 0, N, N, buf);
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const s = ((N - 1 - y) * N + x) * 4, d = (y * N + x) * 4, a = buf[s + 3];
            for (let k = 0; k < 3; k++) img.data[d + k] = a ? LUT[Math.min(255, Math.round(buf[s + k] * 255 / a))] : 0;
            img.data[d + 3] = a;
          }
          cx.putImageData(img, 0, 0);
          out[f.id] = cv.toDataURL('image/png');
        }
      } finally {
        rr.setRenderTarget(prev.rt); rr.autoClear = prev.ac; rr.setClearColor(prev.cc, prev.ca);
        rt.dispose(); scene.remove(g); HB().disposeGroup(g);
      }
      THUMBS = out;
      return out;
    })();
    THUMBS_P.catch(() => { THUMBS_P = null; });
    return THUMBS_P;
  }

  // ---- 指针：长按 / 点一下 / 拖（在镜头控制之前接住：window 捕获阶段）----
  const PTR = new Set();
  function onDown(e) {
    if (!AR.on || !S || e.target !== V3.R.canvas) return;
    PTR.add(e.pointerId);
    if (PTR.size > 1) { cancelPress(); if (S.drag) { endDrag(false); sync(); } return; }   // 两根手指：缩放 / 平移镜头
    if (e.button !== 0) return;
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, timer: 0, hit: null, grab: false };
    S.press = p;
    if (S.placing) return;                                              // 放新家具：点一下放；按住拖照样转镜头
    const V = mview(S.model), hit = pickAt(rayAt(e.clientX, e.clientY), V);
    p.hit = hit;
    if (S.mode === 'house') {
      if (hit) { p.grab = true; e.stopPropagation(); }                    // 挪房子：按住房子（墙、屋顶、家具都算）就拖
      return;
    }
    const pc = selPiece();
    if (hit && hit.piece && pc && pc.cells.some((c) => key(c.pos) === key(hit.cell))) { p.grab = true; e.stopPropagation(); return; }   // 按住选中的那件：直接拖
    if (hit) p.timer = setTimeout(() => longPress(p), LONG);
  }
  function longPress(p) {
    p.timer = 0;
    if (!S || S.press !== p || p.moved > SLOP) return;
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) { /* 不支持 */ } }
    if (p.hit && p.hit.piece) startDrag(p);
    else if (p.hit && p.hit.block && canMoveHouse()) { setMode('house'); startHouseDrag(p); }
    sync();
  }
  function cancelPress() { if (S && S.press) { clearTimeout(S.press.timer); S.press = null; } }
  function onMove(e) {
    if (!AR.on || !S) return;
    if (S.drag && S.drag.id === e.pointerId) { dragTo(e.clientX, e.clientY); e.stopPropagation(); return; }
    const p = S.press;
    if (p && p.id === e.pointerId) {
      p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.x, e.clientY - p.y));
      if (p.timer && p.moved > SLOP) { clearTimeout(p.timer); p.timer = 0; }
      if (p.grab && p.moved > TAP) { startDrag(p); dragTo(e.clientX, e.clientY); e.stopPropagation(); sync(); }
      return;
    }
    if (S.placing && !e.buttons && e.target === V3.R.canvas) { placingAt(e.clientX, e.clientY); const t = S.placing.target; tip(t && !t.ok ? '放不下：' + t.why : '', e.clientX, e.clientY); }
  }
  function onUp(e) {
    PTR.delete(e.pointerId);
    if (!AR.on || !S) return;
    if (S.drag && S.drag.id === e.pointerId) { endDrag(e.type !== 'pointercancel'); S.press = null; sync(); e.stopPropagation(); return; }
    const p = S.press;
    if (!p || p.id !== e.pointerId) return;
    clearTimeout(p.timer); S.press = null;
    if (e.type === 'pointercancel' || p.moved > TAP) return;
    tap(e.clientX, e.clientY, p);
  }
  function tap(cx, cy, p) {
    if (S.placing) { placeTap(cx, cy); tip(''); sync(); return; }
    if (S.mode === 'house') { sync(); return; }
    if (p.hit && p.hit.piece) selectAt(p.hit.cell); else S.sel = null;
    sync();
  }
  function escape() {
    if (!S) return;
    if (S.drag) endDrag(false);
    else if (S.placing) S.placing = null;
    else if (UI && UI.cat && !UI.cat.classList.contains('hide')) closeCatalog();
    else if (S.mode === 'house') setMode('furn');
    else S.sel = null;
    tip(''); sync();
  }
  addEventListener('pointerdown', onDown, true);
  addEventListener('pointermove', onMove, true);
  addEventListener('pointerup', onUp, true);
  addEventListener('pointercancel', onUp, true);
  addEventListener('keydown', (e) => {
    if (!AR.on || !S || e.defaultPrevented) return;
    if (V3.hud && V3.hud.modalOpen && V3.hud.modalOpen()) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); act(undo()); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'Escape') { e.preventDefault(); escape(); return; }
    if (k === 'r' || k === 'R') {
      e.preventDefault();
      if (S.placing) { S.placing.facing = CW[(CW.indexOf(S.placing.facing) + 1) % 4]; S.placing.target = null; sync(); }
      else act(rotate());
      return;
    }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); act(removePiece()); return; }
    const slot = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[k];
    if (slot) { e.preventDefault(); S.keyDelay = 140; try { act(nudge(camDirs()[slot])); } finally { S.keyDelay = 0; } }
  });

  // ---- 进 / 出 ----
  AR.dirty = () => !!S && (!samePlace(S.place, S.start.place) || !sameModel(S.model, S.start.model));
  AR.enter = async () => {
    if (AR.on) return true;
    const H = HB(), cur = V3.models && V3.models.current && V3.models.current();
    if (!H || !H.load || !cur || cur.id !== 'house2' || !V3.R) return false;
    await H.load();
    if (H.live && H.live()) await H.live().ready;
    if (V3.settingsPanel && V3.settingsPanel.isOpen && V3.settingsPanel.isOpen()) V3.settingsPanel.close();
    S = { model: H.model, place: Object.assign({}, H.place), start: { model: H.model, place: Object.assign({}, H.place) }, undo: [], track: new Map(), seq: 0,
      sel: null, mode: 'furn', drag: null, press: null, placing: null, dropGhost: null, keyDelay: 0 };
    AR.on = true;
    document.body.classList.add('arranging');
    if (V3.actor && V3.actor.hold) V3.actor.hold(true);
    overlay().root.visible = true;
    buildUI();
    V3.emit('arrange', true);
    return true;
  };
  async function leave() {
    if (S) { endDrag(false); S.placing = null; }
    await AR.whenIdle();
    AR.on = false; S = null;
    document.body.classList.remove('arranging', 'ar-dragging');
    if (UI) { UI.root.remove(); UI = null; }
    if (OV) { showBox(null); showGhost(null); OV.root.visible = false; }
    disposeGhosts(); GHB.clear();
    if (V3.actor && V3.actor.hold) V3.actor.hold(false);
    V3.emit('arrange', false);
  }
  // 完成：有改动就存进浏览器（布置过的房子），回到游戏
  AR.done = async () => {
    if (!AR.on || !S) return null;
    endDrag(false);
    await AR.whenIdle();
    const dirty = AR.dirty();
    let saved = null;
    if (dirty) saved = await HB().saveArranged();
    await leave();
    if (dirty) say(saved && saved.stored ? '布置好了，已经保存到小屋存档（设置「房子」页可以导出鲸图、恢复原来的房子）'
      : '布置好了，但存档失败（' + ((saved && saved.storeError) || '') + '），关掉页面以后会回到原来的房子', !!(saved && saved.stored));
    return { dirty, saved };
  };
  // 放弃修改：回到进来时的样子（方块和房子的位置都回去）
  AR.discard = async () => {
    if (!AR.on || !S) return null;
    endDrag(false);
    const dirty = AR.dirty();
    if (S.model !== S.start.model || !samePlace(S.place, S.start.place)) {
      S.model = S.start.model; S.place = Object.assign({}, S.start.place); S.sel = null;
      schedule(0);
    }
    await leave();
    if (dirty) say('放弃了这次的修改', true);
    return { dirty };
  };

  // ---- HUD 上的「布置」按钮（左下角楼层旁边）----
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13.5V10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4.5H3z" fill="currentColor"/><path d="M5.5 17.5v2M18.5 17.5v2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  let hudBtn = null;
  function mountButton() {
    const root = document.querySelector('.hud-root');
    if (!root || hudBtn) return;
    hudBtn = U.el('button', { class: 'hud-arrange', type: 'button', title: '布置：挪家具、加家具、挪房子', 'aria-label': '布置',
      onclick: () => { AR.enter().then((ok) => { if (!ok) say('房子还没读好，等一下再点'); }); } });
    hudBtn.innerHTML = ICON;
    hudBtn.append(U.el('span', null, '布置'));
    root.append(hudBtn);
  }
  V3.on('hud:mount', () => mountButton());
  V3.on('frame', () => { if (AR.on) { try { frame(); } catch (e) { V3.err('arrange frame: ' + ((e && e.stack) || e)); AR.on && leave(); } } });
  V3.on('model', () => { if (AR.on) { OV && V3.R.scene.add(OV.root); } });

  // ---- 测试、截图用的接口（不用真的鼠标）：格子都是场景格子 [x, y, z] ----
  const need = () => { if (!AR.on || !S) throw new Error('先 V3.arrange.enter()'); };
  Object.assign(AR, {
    state: () => (S ? { on: AR.on, mode: S.mode, sel: S.mode === 'house' ? 'house' : (selPiece() ? pieceInfo(selPiece()) : null), placing: S.placing ? { id: S.placing.f.id, facing: S.placing.facing, target: S.placing.target } : null,
      drag: S.drag ? { house: !!S.drag.house, target: S.drag.target } : null, undo: S.undo.length, dirty: AR.dirty(), place: Object.assign({}, S.place), busy: RB.busy || RB.pending } : { on: false }),
    select: (cell) => { need(); const r = selectAt(cell); sync(); return r; },
    selectHouse: () => { need(); const r = setMode('house'); sync(); return r; },
    furnMode: () => { need(); const r = setMode('furn'); sync(); return r; },
    deselect: () => { need(); S.sel = null; sync(); return OK; },
    nudge: (dir) => { need(); return act(nudge(dir)); },
    rotate: () => { need(); return act(rotate()); },
    remove: () => { need(); return act(removePiece()); },
    reset: () => { need(); return act(resetPiece()); },
    moveTo: (cell, facing) => { need(); return act(moveSelTo(cell, facing)); },
    add: (id, cell, facing) => { need(); const f = FM().byId(id); return act(f ? addPiece(f, cell, facing || f.facing || 'south') : fail('没有这种家具：' + id)); },
    check: (id, cell, facing) => { need(); const f = FM().byId(id); return clean(f ? check(mview(S.model), f, cell, facing || f.facing || 'south') : fail('没有这种家具：' + id)); },
    // 房子里已经有的这一件，原地放得下吗（它自己那几格当成空的）
    checkHere: (cell) => { need(); const V = mview(S.model), pc = pieceAt(V, cell); return clean(pc ? check(V, pc.f, pc.main, pc.facing, new Set(pc.cells.map((c) => key(c.pos)))) : fail('那里没有家具')); },
    checkHouse: (place) => { need(); const H = HB(); return canMoveHouse() ? checkHouse(H.isIdentity(place) ? houseLocal() : H.placeModel(houseLocal(), place)) : fail('不能挪房子'); },
    placeHouse: (place) => { need(); return act(tryPlace(place)); },
    undo: () => { need(); return act(undo()); },
    startPlacing: (id) => { need(); const r = startPlacing(id); sync(); return r; },
    openCatalog: (tab) => { need(); openCatalog(tab); return makeThumbs(); },
    closeCatalog: () => closeCatalog(),
    camDirs, pickAt: (cx, cy) => (S ? pickAt(rayAt(cx, cy), mview(S.model)) : null),
    // 屏幕上的点（CSS 像素）：场景里一点 [x, y, z] 投到哪儿（测试用真的指针时找位置）
    screenOf: (p) => { const v = new THREE.Vector3(p[0], p[1], p[2]).project(V3.R.camera), r = V3.R.canvas.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; },
    thumbs: () => makeThumbs(),
    model: () => (S ? S.model : HB().model),
    // 相框换照片（docs/PHOTOS.md）：cell = 相框 / 画框墙 part=0 那格；photo = V3.photos 的一张或 null
    setPhoto: (cell, slot, photo) => { need(); return act(setPhoto(cell, slot | 0, photo || null)); },
    pickPhoto: (slot) => { need(); return act(pickPhoto(slot)); },
  });
})(window.V3);
