// 31-washup-catalog.js — tide finds and litter. Drop weights and collection rules live elsewhere.
(function (V3) {
  'use strict';
  const entry = (category, id, name, rarity, size, desc, weather, decoratable) => ({
    id, name, rarity, size, desc, category, weather, ...(decoratable ? { decoratable: true } : {}),
  });
  const find = (...args) => entry('collectible', ...args);
  const litter = (id, name, size, desc, weather) => entry('trash', id, name, 'common', size, desc, weather);
  const collectibles = [
    find('limpet', '帽贝', 'common', 0.07, '小小一顶石灰色斗笠，壳肋从偏斜的尖顶一路垂下来。', ['clear', 'cloudy'], true),
    find('oyster_shell', '牡蛎壳', 'common', 0.12, '外缘像叠了几层岩片，内侧却是浅浅的粉白色。', ['overcast', 'rain'], true),
    find('razor_clam', '竹蛏壳', 'common', 0.13, '细长的两片壳还扣在一起，中间留着一道深色细缝。', ['drizzle', 'rain'], true),
    find('green_sea_glass', '青绿海玻璃', 'common', 0.065, '不再扎手的一小片青绿玻璃，磨圆的边像融化的糖。', ['clear', 'cloudy'], true),
    find('striped_pebble', '白纹卵石', 'common', 0.09, '一条乳白色石纹斜穿过蓝灰色的卵石。', ['clear', 'drizzle'], true),
    find('driftwood', '分叉浮木', 'common', 0.16, '褪成暖灰色的小树枝，分叉处还留着两道浅色木纹。', ['rain', 'storm'], true),
    find('kelp_ribbon', '褐藻带', 'common', 0.15, '湿漉漉的褐藻打着卷，中间一条浅色的筋。', ['overcast', 'storm']),
    find('sea_bean', '海漂心豆', 'common', 0.065, '随海流远行的硬壳种子，像一颗深栗色的小爱心。', ['cloudy', 'rain'], true),
    find('barnacle_cluster', '藤壶空壳', 'common', 0.095, '一块黑石上有三座小火山，里面已经空了。', ['fog', 'overcast']),
    find('coral_fragment', '珊瑚残枝', 'uncommon', 0.12, '被海浪磨白的旧骨骼，分叉的末梢还带一点粉色。', ['rain', 'storm']),
    find('sea_urchin_test', '海胆空壳', 'uncommon', 0.09, '没有刺的薄壳上，五道粉紫色孔纹围着顶端的小圆洞。', ['cloudy', 'overcast'], true),
    find('blue_glass_float', '蓝玻璃浮球', 'uncommon', 0.11, '旧渔具的蓝色浮球，沙色的绳网还打着结。', ['fog', 'storm'], true),
    find('rainbow_abalone', '虹彩鲍壳', 'rare', 0.14, '褐色的粗边排着一串小孔，壳里翻着青蓝和淡粉的珍珠光。', ['drizzle', 'storm'], true),
  ];
  const trash = [
    litter('plastic_cap', '塑料瓶盖', 0.06, '掉了色的红瓶盖，细齿缝里卡着几粒沙。', ['clear', 'cloudy']),
    litter('crushed_can', '压扁的易拉罐', 0.13, '褪色的蓝罐被踩出一道折痕，拉环还挂在盖上。', ['rain', 'storm']),
    litter('tangled_fishing_line', '缠成团的钓线', 0.12, '几股旧钓线绕在一起，红白小浮标也被缠住了。', ['overcast', 'storm']),
  ];
  const byId = new Map([...collectibles, ...trash].map(k => [k.id, k]));
  const makers = new Map(), cache = new Map(), materials = new Map();
  const TAU = Math.PI * 2;
  const v = p => new THREE.Vector3(...p);

  // Combine small primitives and sculpted faces into one vertex-coloured draw call. Keeping a
  // single centred mesh also lets the existing collection turntable borrow the complete model.
  function sculpt(draw) {
    const pos = [], colors = [], c = new THREE.Color();
    const triangle = (a, b, d, color) => {
      c.setHex(color);
      for (const p of [a, b, d]) { pos.push(...p); colors.push(c.r, c.g, c.b); }
    };
    const add = (geo, color) => {
      const p = geo.getAttribute('position'), ix = geo.index;
      c.setHex(color);
      for (let i = 0, n = ix ? ix.count : p.count; i < n; i++) {
        const j = ix ? ix.getX(i) : i;
        pos.push(p.getX(j), p.getY(j), p.getZ(j)); colors.push(c.r, c.g, c.b);
      }
      geo.dispose();
    };
    // Sections are ordered around the axis; the final section may run back inside a hollow rim.
    const loft = (sections, paint) => {
      const n = sections[0].length, end = sections.length - 1;
      const centre = ring => [0, 1, 2].map(axis => ring.reduce((sum, p) => sum + p[axis], 0) / n);
      const base = centre(sections[0]), top = centre(sections[end]);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        triangle(base, sections[0][i], sections[0][j], paint(-1, i));
        triangle(top, sections[end][j], sections[end][i], paint(end, i));
        for (let r = 0; r < end; r++) {
          const a = sections[r][i], b = sections[r][j], d = sections[r + 1][i], e = sections[r + 1][j], color = paint(r, i);
          triangle(a, d, b, color); triangle(b, d, e, color);
        }
      }
    };
    const beam = (a, b, ra, rb, color, sides = 5) => {
      const direction = v(b).sub(v(a)), mid = v(a).lerp(v(b), 0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(v([0, 1, 0]), direction.clone().normalize());
      const geo = new THREE.CylinderGeometry(rb, ra, direction.length(), sides);
      geo.applyQuaternion(q).translate(mid.x, mid.y, mid.z);
      add(geo, color);
    };
    // tri / quad with an explicit facing: want = the direction the face should point; the winding follows it.
    const tri = (a, b, d, color, want) => {
      const n = v(b).sub(v(a)).cross(v(d).sub(v(a)));
      if (n.lengthSq() < 1e-14) return;
      if (want && n.dot(v(want)) < 0) triangle(a, d, b, color); else triangle(a, b, d, color);
    };
    const quad = (a, b, d, e, color, want) => {
      const two = Array.isArray(color);
      tri(a, b, d, two ? color[0] : color, want); tri(a, d, e, two ? color[1] : color, want);
    };
    draw({ loft, add, beam, tri, quad });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.addGroup(0, pos.length / 3, 0);
    return geo;
  }
  // [height, x radius, z radius, x offset?, z offset?]. Warp gives individual silhouettes.
  function rings(profile, n, warp) {
    return profile.map(([y, rx, rz, x = 0, z = 0], r) => Array.from({ length: n }, (_, i) => {
      const a = TAU * i / n, p = [x + rx * Math.cos(a), y, z + rz * Math.sin(a)];
      return warp ? warp(p, a, i, r) : p;
    }));
  }
  const model = (id, draw) => makers.set(id, () => sculpt(draw));

  model('limpet', ({ loft }) => {
    const sections = rings([[0, .44, .34], [.06, .50, .38], [.24, .29, .23, -.06], [.38, .07, .061, -.14]], 20,
      ([x, y, z], a, i, r) => [x * (i % 2 ? .86 : 1), y + (r ? .017 * Math.cos(a * 3) : 0), z * (i % 2 ? .86 : 1)]);
    loft(sections, (r, i) => r < 0 ? 0xac8e68 : (i % 4 < 2 ? [0xc7ad81, 0xd7bf98, 0xe4d2ae, 0xe9d5b0] : [0x90714f, 0xad8961, 0xc0a77e, 0xe9d5b0])[r]);
  });

  model('oyster_shell', ({ loft }) => {
    const sections = rings([[0, .41, .22], [.05, .52, .27], [.085, .47, .25], [.15, .54, .29], [.21, .46, .25], [.11, .32, .17], [.085, .16, .10]], 18,
      ([x, y, z], a, i, r) => {
        const edge = 1 + .13 * Math.sin(3 * a) + .08 * Math.cos(7 * a + r * .6);
        return [x * edge, y + .045 * Math.sin(2 * a) * Math.min(1, r / 2) + (i % 2 ? .012 : 0), z * edge * (1 + .33 * Math.cos(a))];
      });
    loft(sections, (r, i) => [0x9b8a7f, 0x9f8271, 0xc2b3a7, 0x82766d, 0xccb9a8, 0xe6cbbc, 0xf2dbd5, 0xf7e6df][r + 1] - (r < 4 && i % 3 === 2 ? 0x0a0a08 : 0));
  });

  model('razor_clam', ({ loft }) => {
    const sections = rings([[0, .45, .09], [.041, .50, .121], [.058, .51, .119], [.078, .49, .120], [.127, .45, .088]], 20,
      ([x, y, z], a, i, r) => [Math.sign(x) * Math.pow(Math.abs(x), .64), y + (r > 0 ? .009 * Math.cos(a) : 0), z + .033 * x]);
    loft(sections, (r, i) => r < 0 ? 0xa9885f : r === 1 ? 0x614a37 : i % 4 === 0 ? 0xc0a278 : r < 3 ? 0xe0c092 : 0xe8ce9f);
  });

  model('green_sea_glass', ({ loft }) => {
    const edge = [[-.47, -.10], [-.27, -.35], [.17, -.29], [.48, -.11], [.37, .16], [.05, .32], [-.35, .26]];
    loft([[0, .78], [.075, 1], [.175, .85], [.21, .50]].map(([y, s], r) =>
      edge.map(([x, z], i) => [x * s + r * .018, y + (r ? .014 * ((i % 3) - 1) : 0), z * s])),
    (r, i) => r < 0 ? 0x257b62 : r === 0 ? 0x388a72 : r === 1 ? (i % 2 ? 0x82d3ad : 0xa5dec1) : r === 2 ? 0x60b99b : 0x74c7ab);
  });

  model('striped_pebble', ({ loft }) => {
    const sections = rings([[0, .31, .22], [.085, .50, .30], [.148, .53, .35], [.197, .50, .32], [.25, .41, .27], [.29, .26, .18]], 12,
      ([x, y, z], a, i, r) => [x * (1 + .06 * Math.sin(3 * a)), y + Math.sin(a) * [0, .034, .075, .073, .042, .028][r], z + .075 * x]);
    loft(sections, (r, i) => r === 2 ? 0xe5dfcc : r === 3 ? (i % 3 === 0 ? 0x607884 : 0x778b95) : r > 3 ? 0x8197a2 : (i % 3 ? 0x566c78 : 0x495f6a));
  });

  model('driftwood', ({ beam }) => {
    const a = [-.52, .12, -.10], b = [-.12, .13, .014], c = [.23, .11, .029];
    beam(a, b, .115, .089, 0xa28b73); beam(b, c, .091, .072, 0xb19b84);
    beam(c, [.52, .145, -.15], .073, .03, 0xbda68b);
    beam(b, [.21, .18, .33], .075, .039, 0x9e8167);
    beam([-.17, .17, .045], [-.14, .27, -.075], .046, .025, 0xb3977d);
    beam([-.49, .222, -.115], [-.14, .208, -.019], .015, .009, 0xd2b99a, 4);
    beam([-.085, .212, .048], [.175, .209, .266], .014, .01, 0xd4bd9e, 4);
  });

  model('kelp_ribbon', ({ loft, beam }) => {
    const spine = [[-.57, .042, -.13, .033, .01], [-.38, .07, -.17, .11, -.035], [-.23, .093, -.08, .16, .07],
      [-.02, .09, .08, .18, .06], [.16, .13, .13, .16, -.06], [.31, .24, .06, .13, -.07], [.46, .26, -.055, .10, .055], [.55, .16, -.14, .022, .018]];
    loft(spine.map(([x, y, z, w, tilt]) => [[x, y - tilt - .018, z - w], [x, y + tilt - .018, z + w],
      [x, y + tilt + .018, z + w], [x, y - tilt + .018, z - w]]),
    (r, i) => i === 2 ? (r % 2 ? 0x8c823c : 0x787538) : 0x585c30);
    const rib = ([x, y, z]) => [x, y + .018, z];
    for (let i = 1; i < spine.length; i++) beam(rib(spine[i - 1]), rib(spine[i]), .013, .013, 0xbba751, 4);
  });

  model('sea_bean', ({ loft }) => {
    const heart = [[.50, -.14], [.49, .08], [.35, .29], [.09, .46], [0, .51], [-.14, .45], [-.37, .27], [-.49, .05],
      [-.48, -.18], [-.37, -.34], [-.20, -.39], [-.07, -.32], [0, -.25], [.13, -.37], [.34, -.40]];
    loft([[0, .70], [.10, .97], [.13, 1], [.16, 1], [.24, .80], [.27, .48]].map(([y, s]) => heart.map(([x, z]) => [x * s, y, z * s])),
      (r, i) => r === 2 ? 0xae744a : r === 3 && i >= 10 ? 0x713725 : r > 3 ? 0x80482e : 0x613422);
  });

  model('barnacle_cluster', ({ loft, add }) => {
    add(new THREE.IcosahedronGeometry(.48, 0).scale(1, .31, .75), 0x4e5759);
    const shell = (x, z, r, h) => loft(rings([[.027, r, r, x, z], [h * .57, r * .76, r * .76, x, z], [h, r * .58, r * .55, x, z],
      [h * .94, r * .37, r * .36, x, z], [h * .57, r * .32, r * .31, x, z]], 10,
    ([px, y, pz], a, i) => [x + (px - x) * (i % 2 ? .85 : 1), y + .021 * Math.sin(2 * a), pz]),
    (j, i) => j >= 3 ? 0x5d5052 : j === 2 ? 0xe6d4c7 : (i % 2 ? 0xa89b8c : 0xcbb9a4));
    shell(-.18, .08, .205, .39); shell(.20, .067, .165, .30); shell(.025, -.18, .126, .26);
  });

  model('coral_fragment', ({ beam, add }) => {
    const base = [-.18, .035, .08], fork = [-.12, .29, -.02];
    beam(base, fork, .121, .095, 0xc79888);
    const branches = [
      [fork, [-.30, .48, -.14], [[-.47, .63, -.14], [-.26, .75, -.24]]],
      [fork, [.062, .60, -.05], [[-.04, .86, .04], [.19, .80, -.14]]],
      [fork, [.21, .45, .06], [[.40, .64, .08], [.34, .56, .27]]],
      [[-.16, .19, .037], [-.01, .38, .22], [[.05, .54, .28], [-.13, .47, .32]]],
    ];
    for (const [start, mid, ends] of branches) {
      beam(start, mid, .087, .056, 0xe2b6a5);
      for (const [i, end] of ends.entries()) {
        beam(mid, end, .053, .035, 0xecd1ba);
        add(new THREE.IcosahedronGeometry(.04, 0).translate(...end), i ? 0xe0af9e : 0xf5d9bd);
      }
    }
  });

  // Restored triangle sculpt (as before the 11-12 cuboid conversion). The MC resource pack keeps its own
  // cuboid version (31-collectible-cubes.js); only the web mesh is sculpted.
  model('sea_urchin_test', ({ loft, add }) => {
    const sections = rings([[0, .32, .32], [.08, .45, .45], [.19, .50, .50], [.29, .45, .45], [.38, .32, .32], [.41, .14, .14],
      [.38, .096, .096], [.24, .08, .08]], 30,
    ([x, y, z], a) => { const f = 1 + .035 * Math.cos(5 * a); return [x * f, y, z * f]; });
    loft(sections, (r, i) => r >= 6 ? 0x5a5f72 : r < 0 ? 0x91ac9e : r === 5 ? 0xdedac6 : i % 6 === 0 || i % 6 === 5 ? 0xb5839f : 0xa3c5b2);
    // Small contrasting pore pairs, flush along the five bands rather than spikes.
    for (let arm = 0; arm < 5; arm++) {
      for (const [row, r, y] of [[0, .464, .11], [1, .5, .19], [2, .46, .27], [3, .363, .35]]) {
        for (const side of [-1, 1]) {
          const a = TAU * arm / 5 + side * (.06 + row * .013);
          const surface = r * (1 + .035 * Math.cos(5 * a));
          const geo = new THREE.IcosahedronGeometry(.017 - row * .001, 0).scale(.5, 1, 1).rotateY(-a)
            .translate(Math.cos(a) * surface, y, Math.sin(a) * surface);
          add(geo, 0x765f77);
        }
      }
    }
  });

  // Abalone, nacre side up: a thick ear-shaped cup meshed as rings around the spire (C, near the narrow end).
  // Top = iridescent inside, bottom = brown ribbed outside, a brown lip, five real through-holes on the ridge.
  model('rainbow_abalone', ({ tri, quad }) => {
    const n = 22, ts = [0, .3, .56, .74, .86, .95, 1], R = ts.length - 1, HOLE = 3, H = .27, C = [.56, .2];
    const holes = new Set([12, 14, 16, 18, 20]), plugged = new Set([21, 0]);
    const nacre = [0x4fa59c, 0x3f86a8, 0x6f7fc4, 0xa985bf, 0xd894a6, 0xd9c08e];
    const UP = [0, 1, 0], DN = [0, -1, 0];
    const outline = Array.from({ length: n }, (_, i) => {
      const f = TAU * i / n, s = Math.sin(f), wave = 1 + .03 * Math.sin(7 * f + .4);
      return [Math.cos(f) * wave, .68 * s * (s > 0 ? .86 : 1) * (1 - .14 * Math.max(0, Math.cos(f))) * wave];
    });
    const dir = outline.map(([x, z]) => Math.atan2(z - C[1], x - C[0]));            // direction of each ray seen from the spire
    const shelf = i => Math.sin(dir[i]) > .5;                                       // columellar side: flat inner plate
    const ridge = i => holes.has(i) || plugged.has(i) || holes.has((i + 1) % n) || holes.has((i + n - 1) % n);
    const thick = t => .075 - .035 * t;
    const bottomY = (t, i, r) => H * Math.pow(t, 1.45) - (r === 0 ? .035 : 0) - (ridge(i) && (r === HOLE || r === HOLE + 1) ? .03 : 0)
      - .012 * t * Math.sin(r * 2.1 + dir[i] * 3);                                      // wavy growth ridges
    const xz = (t, i) => [C[0] + (outline[i][0] - C[0]) * t, C[1] + (outline[i][1] - C[1]) * t];
    const Bo = ts.map((t, r) => outline.map((_, i) => { const [x, z] = xz(t, i); return [x, bottomY(t, i, r), z]; }));
    const To = ts.map((t, r) => outline.map((_, i) => {
      const [x, z] = xz(t, i), y = Bo[r][i][1] + thick(t);
      return [x, shelf(i) && t >= .56 ? Math.max(y, .82 * H + thick(1)) : y, z];
    }));
    const band = (r, i) => nacre[((Math.floor(ts[r] * 6.5 + .9 * Math.sin(2 * dir[i]) + .5 * Math.cos(5 * dir[i])) % 6) + 6) % 6];
    const topColor = (r, i) => r === R - 1 ? (i % 2 ? 0x8d6f58 : 0xa5856a) : shelf(i) && r >= 2 ? (r % 2 ? 0xe2d3c6 : 0xd4c6c8)
      : r === 0 ? 0x5d9aa6 : band(r, i);
    const spiral = (r, i) => ((Math.round(ts[r] * 9 - dir[i] / TAU * 2.6) % 3) + 3) % 3;
    const botColor = (r, i) => r === 0 ? 0x5e3b2d : plugged.has(i) && r === HOLE ? 0x3e2f25 : r === 1 && spiral(r, i) === 0 ? 0x9c6c55
      : spiral(r, i) === 0 ? 0x8a6043 : spiral(r, i) === 1 ? (i % 4 === 1 ? 0x5c6443 : 0x6c4a36) : 0x573a2b;
    const lerp = (a, b, s) => a.map((x, k) => x + (b[k] - x) * s);
    const bil = (q, u, w) => lerp(lerp(q[0], q[1], u), lerp(q[3], q[2], u), w);
    const len = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
    for (let r = 0; r < R; r++) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, top = [To[r][i], To[r][j], To[r + 1][j], To[r + 1][i]], bot = [Bo[r][i], Bo[r][j], Bo[r + 1][j], Bo[r + 1][i]];
      if (!(r === HOLE && holes.has(i))) {
        quad(...top, topColor(r, i), UP); quad(...bot, botColor(r, i), DN);
        continue;
      }
      // Through-hole: an octagon inset in this cell on both faces (12 triangles from the 4 cell corners, no
      // T-junctions), joined by a short dark tube; the hole sits a little lower on the outside.
      const arc = len(bil(top, 0, .5), bil(top, 1, .5)), rad = len(bil(top, .5, 0), bil(top, .5, 1)), rh = .34 * Math.min(arc, rad);
      const oct = Array.from({ length: 8 }, (_, k) => { const a = -3 * TAU / 8 + TAU * k / 8; return [.5 + 1.15 * rh / arc * Math.cos(a), .5 + rh / rad * Math.sin(a)]; });
      const ring = (q, drop) => oct.map(([u, w]) => { const p = bil(q, u, w); return [p[0], p[1] - drop, p[2]]; });
      const ht = ring(top, 0), hb = ring(bot, .016), centre = bil(top, .5, .5);
      for (const [q, h, want, color] of [[top, ht, UP, band(r, i)], [bot, hb, DN, 0x6c5544]]) {
        for (let k = 0; k < 4; k++) {
          const l = (k + 1) % 4, m = 2 * k + 1, m2 = (2 * k + 2) % 8;
          tri(q[k], q[l], h[m], color, want); tri(q[k], h[m], h[2 * k], color, want); tri(q[l], h[m2], h[m], color, want);
        }
      }
      for (let k = 0; k < 8; k++) {
        const l = (k + 1) % 8, mid = lerp(ht[k], ht[l], .5);
        quad(ht[k], ht[l], hb[l], hb[k], 0x4f3d31, [centre[0] - mid[0], 0, centre[2] - mid[2]]);
      }
    }
    for (let i = 0; i < n; i++) {                                                   // the lip: outward wall between nacre and outside
      const j = (i + 1) % n, a = To[R][i], b = To[R][j], mid = lerp(a, b, .5);
      quad(a, b, Bo[R][j], Bo[R][i], i % 3 ? 0x9c7c60 : 0xc7ad94, [mid[0] - C[0], 0, mid[2] - C[1]]);
    }
  });

  model('blue_glass_float', ({ add }) => {
    add(new THREE.SphereGeometry(.421, 12, 8).scale(1, .94, 1), 0x328b9e);
    const cord = (angle, color) => add(new THREE.TorusGeometry(.423, .025, 4, 16).rotateY(angle).scale(1, .94, 1), color);
    cord(0, 0xc9aa79); cord(Math.PI / 3, 0xb49768); cord(2 * Math.PI / 3, 0xc5a474);
    add(new THREE.TorusGeometry(.423, .023, 4, 16).rotateX(Math.PI / 2), 0xc8a776);
    add(new THREE.IcosahedronGeometry(.073, 0).scale(1.2, .67, 1).translate(.048, .414, .0), 0xd3b487);
  });

  model('plastic_cap', ({ loft }) => {
    const sections = rings([[0, .40, .39], [.037, .48, .47], [.17, .48, .46], [.21, .42, .40], [.214, .33, .32]], 24,
      ([x, y, z], a, i, r) => [x * (i % 2 && r < 4 ? .91 : 1), y + (r > 0 ? .017 * Math.sin(2 * a) : 0), z * (i % 2 && r < 4 ? .91 : 1)]);
    loft(sections, (r, i) => r < 0 ? 0x9d3531 : r === 3 ? 0xeec1a4 : r === 4 ? 0xc85852 : i % 2 ? 0xc95e54 : 0xaa413c);
  });

  model('crushed_can', ({ loft, add }) => {
    const sections = rings([[-.49, .23, .30], [-.43, .25, .32], [-.20, .17, .34], [-.01, .093, .32], [.15, .19, .34], [.36, .24, .27],
      [.43, .21, .245], [.47, .229, .26], [.5, .19, .223]], 14,
    ([x, y, z], a, i, r) => [-y, x + (r >= 2 && r <= 5 ? .044 * Math.sin(2 * a) : 0), z + .063 * y]);
    loft(sections, (r, i) => r < 1 || r >= 6 ? (r === 8 ? 0x969d9f : 0xc6c8c4) : r === 2 ? 0x4c6776 : i < 5 ? 0xc5cfca : i % 3 ? 0x54899d : 0x4c768d);
    add(new THREE.TorusGeometry(.084, .018, 4, 10).scale(1.25, .77, 1).rotateY(-Math.PI / 2).translate(-.509, .025, .031), 0xd5d1c5);
  });

  model('tangled_fishing_line', ({ add, beam }) => {
    const loops = [
      [[-.44, .04, -.16], [-.1, .064, -.30], [.32, .068, -.20], [.39, .055, .10], [.09, .041, .31], [-.35, .034, .21]],
      [[-.49, .071, .069], [-.29, .053, -.23], [.044, .088, -.17], [.30, .105, .16], [.019, .091, .25], [-.28, .04, .106]],
      [[-.24, .06, -.26], [.12, .075, -.24], [.36, .11, .02], [.23, .065, .28], [-.16, .06, .17], [-.36, .095, -.09]],
    ];
    loops.forEach((pts, i) => {
      const path = new THREE.CatmullRomCurve3(pts.map(v), true);
      add(new THREE.TubeGeometry(path, 19, .022, 4, true), [0x727951, 0xa2a572, 0x888e62][i]);
    });
    beam([-.20, .106, .085], [-.036, .13, .060], .086, .092, 0xf3e8d2, 8);
    beam([-.036, .13, .060], [.14, .143, .038], .092, .051, 0xca4e3f, 8);
    beam([.14, .143, .038], [.215, .147, .032], .033, .028, 0x9e3f34, 6);
  });

  const finishes = { green_sea_glass: .58, blue_glass_float: .34, rainbow_abalone: .44, sea_bean: .63, crushed_can: .56 };
  function geometryOf(k) {
    if (cache.has(k.id)) return cache.get(k.id);
    const geo = makers.get(k.id)();
    geo.computeBoundingBox();
    const b = geo.boundingBox, span = b.getSize(new THREE.Vector3()), scale = k.size / Math.max(span.x, span.y, span.z);
    geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2).scale(scale, scale, scale);
    geo.computeBoundingBox(); geo.computeBoundingSphere(); geo.userData.shared = true;
    cache.set(k.id, geo);
    return geo;
  }
  function materialOf(k) {
    const roughness = finishes[k.id] ?? .88;
    if (!materials.has(roughness)) {
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness });
      material.name = 'V3.washupCatalog.' + roughness; material.userData.shared = true;
      materials.set(roughness, material);
    }
    return materials.get(roughness);
  }
  const has = id => byId.has(id) && makers.has(id);
  function build(id, opt = {}) {
    if (!has(id)) throw new Error('V3.washupCatalog.build: unknown id ' + id);
    const k = byId.get(id), isTrash = k.category === 'trash', geo = geometryOf(k);
    const anchor = opt.anchor || (isTrash ? 'trash:' : 'shell:') + id;
    const tris = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
    const root = new THREE.Group(), mesh = new THREE.Mesh(geo, [materialOf(k)]);
    root.name = (isTrash ? 'trash-' : 'shell-') + id; mesh.name = anchor;
    Object.assign(root.userData, { kind: id, category: k.category, tris, ...(isTrash ? {} : { shell: id }) });
    Object.assign(mesh.userData, { kind: id, category: k.category, anchor, faceTags: [(isTrash ? '海滩垃圾/' : '贝壳/') + k.name],
      triTag: new Uint16Array(tris), ...(isTrash ? {} : { shell: id }) });
    if (opt.tag !== false) V3.parts.tagFaces(mesh);
    root.add(mesh);
    return root;
  }
  V3.washupCatalog = { collectibles, trash, has, build };
})(window.V3);
