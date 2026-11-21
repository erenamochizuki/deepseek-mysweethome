// 31-washup-catalog.js — tide finds and litter. Drop weights and collection rules live elsewhere.
(function (V3) {
  'use strict';
  const entry = (category, id, name, rarity, size, desc, weather, decoratable, chime) => ({
    id, name, rarity, size, desc, category, weather, ...(decoratable ? { decoratable: true, chime } : {}),
  });
  const find = (...args) => entry('collectible', ...args);
  const litter = (id, name, size, desc, weather) => entry('trash', id, name, 'common', size, desc, weather);
  const collectibles = [
    find('limpet', '帽贝', 'common', 0.07, '小小一顶石灰色斗笠，壳肋从偏斜的尖顶一路垂下来。', ['clear', 'cloudy'], true, 'shell'),
    find('oyster_shell', '牡蛎壳', 'common', 0.12, '外缘像叠了几层岩片，内侧却是浅浅的粉白色。', ['overcast', 'rain'], true, 'shell'),
    find('razor_clam', '竹蛏壳', 'common', 0.13, '细长的两片壳还扣在一起，中间留着一道深色细缝。', ['drizzle', 'rain'], true, 'shell'),
    find('green_sea_glass', '青绿海玻璃', 'common', 0.065, '不再扎手的一小片青绿玻璃，磨圆的边像融化的糖。', ['clear', 'cloudy'], true, 'glass'),
    find('striped_pebble', '白纹卵石', 'common', 0.09, '一条乳白色石纹斜穿过蓝灰色的卵石。', ['clear', 'drizzle'], true, 'stone'),
    find('driftwood', '分叉浮木', 'common', 0.16, '褪成暖灰色的小树枝，分叉处还留着两道浅色木纹。', ['rain', 'storm'], true, 'wood'),
    find('kelp_ribbon', '褐藻带', 'common', 0.15, '湿漉漉的褐藻打着卷，中间一条浅色的筋。', ['overcast', 'storm']),
    find('sea_bean', '海漂心豆', 'common', 0.065, '随海流远行的硬壳种子，像一颗深栗色的小爱心。', ['cloudy', 'rain'], true, 'wood'),
    find('barnacle_cluster', '藤壶空壳', 'common', 0.095, '一块黑石上有三座小火山，里面已经空了。', ['fog', 'overcast']),
    find('coral_fragment', '珊瑚残枝', 'uncommon', 0.12, '被海浪磨白的旧骨骼，分叉的末梢还带一点粉色。', ['rain', 'storm']),
    find('sea_urchin_test', '海胆空壳', 'uncommon', 0.09, '没有刺的薄壳上，五道粉紫色孔纹围着顶端的小圆洞。', ['cloudy', 'overcast'], true, 'shell'),
    find('blue_glass_float', '蓝玻璃浮球', 'uncommon', 0.11, '旧渔具的蓝色浮球，沙色的绳网还打着结。', ['fog', 'storm'], true, 'glass'),
    find('rainbow_abalone', '虹彩鲍壳', 'rare', 0.14, '褐色的粗边排着一串小孔，壳里翻着青蓝和淡粉的珍珠光。', ['drizzle', 'storm'], true, 'shell'),
    find('cockle', '蜜桃鸟蛤', 'common', 0.082, '一对鼓鼓的心形壳，蜜桃色壳肋间夹着奶白的生长线。', ['clear', 'cloudy'], true, 'shell'),
    find('coquina', '彩霞蝶贝', 'common', 0.065, '两扇小壳还连着，摊在手心像一只紫橙色蝴蝶。', ['clear', 'drizzle'], true, 'shell'),
    find('tusk_shell', '象牙角贝', 'common', 0.089, '弯弯的奶白色细管，两头都透光。', ['cloudy', 'rain'], true, 'shell'),
    find('top_shell', '薄荷钟螺', 'common', 0.073, '矮圆的螺塔盘着一圈圈薄荷绿的珠边。', ['clear', 'fog'], true, 'shell'),
    find('mermaids_eye', '猫眼螺盖', 'common', 0.056, '碧绿的石眼躺在乳白边框里，背后留着细密的旋纹。', ['clear', 'overcast'], true, 'shell'),
    find('winged_kelp', '琥珀气囊藻', 'common', 0.115, '薄薄的藻叶间挂了几粒浅琥珀色的浮囊。', ['overcast', 'storm'], true, 'wood'),
    find('sea_pottery', '青花海陶片', 'common', 0.08, '水磨圆了瓷片的断口，半朵靛蓝小花还留在釉面上。', ['rain', 'drizzle'], true, 'stone'),
    find('ark_shell', '栗纹蚶壳', 'common', 0.097, '方舟一样的栗色小壳，细白的壳筋一直通到铰合处。', ['cloudy', 'overcast'], true, 'shell'),
    find('venus_comb', '维纳斯骨螺', 'uncommon', 0.146, '一把象牙色小梳子，两侧的长棘都朝着海流弯过去。', ['storm', 'fog'], true, 'shell'),
    find('sundial', '日晷螺', 'uncommon', 0.096, '低矮的螺盘有奶油与焦糖相间的方格，像铺了一圈细瓷砖。', ['clear', 'drizzle'], true, 'shell'),
    find('violet_snail', '紫罗兰浮螺', 'uncommon', 0.084, '卷起的紫色薄壳，边缘是几乎透明的丁香白。', ['rain', 'storm'], true, 'shell'),
    find('lions_paw', '狮爪扇贝', 'uncommon', 0.132, '宽大的琥珀色扇面上，每条肋都顶着一排小鳞冠。', ['cloudy', 'storm'], true, 'shell'),
    find('red_coral', '红珊瑚', 'rare', 0.158, '一束朱红色的海底树枝，枝梢留着细小的浅色盏窝。', ['storm', 'rain'], true, 'shell'),
    find('opal_ammonite', '欧泊菊石', 'rare', 0.147, '一侧保留着化石的肋纹，另一侧露出青蓝矿晶填满的螺旋房室。', ['fog', 'drizzle'], true, 'stone'),
    find('periwinkle', '灰纹玉黍螺', 'common', .032, '细小的石灰色螺塔，螺口压着一道栗色的唇。', ['clear', 'cloudy'], true, 'shell'),
    find('cuttlebone', '乌贼白骨', 'common', .154, '轻得像一片羽毛，翻过来能看见粉白的横纹。', ['overcast', 'rain'], true, 'shell'),
    find('pumice', '蜂孔浮石', 'common', .086, '掌心大小的暖灰色石头，表面布满深浅不一的气孔。', ['storm', 'cloudy'], true, 'stone'),
    find('float_knot', '盘绳浮标结', 'common', .12, '盐霜染白的八字绳结，一端还留着一小段红线。', ['rain', 'fog'], true, 'wood'),
    find('wentletrap', '梯纹螺', 'uncommon', .065, '一层层奶白色壳肋，像绕着塔尖的小梯子。', ['fog', 'clear'], true, 'shell'),
    find('carrier_shell', '负壳螺', 'uncommon', .092, '扁圆的螺塔把小贝片黏在身边，像带着自己的收藏。', ['cloudy', 'drizzle'], true, 'shell'),
    find('chiton_plate', '石鳖甲片', 'uncommon', .041, '一片马鞍形的碎甲，青灰的边缘叠着细纹。', ['rain', 'overcast'], true, 'shell'),
    find('skate_eggcase', '鳐鱼空卵鞘', 'uncommon', .101, '空空的深褐色小钱包，四角各拖着一条卷须。', ['storm', 'overcast'], true, 'wood'),
    find('spiny_oyster', '棘牡蛎壳', 'uncommon', .122, '砖红色壳脊上长着短棘，底边露出一圈杏色。', ['drizzle', 'cloudy'], true, 'shell'),
    find('crinoid_fossil', '海百合茎化石', 'rare', .081, '五角星形的小骨节还连成一串，中间透着光。', ['fog', 'rain'], true, 'stone'),
    find('giant_clam', '砗磲空壳', 'rare', .113, '潮水送来一瓣空壳。壳里白得像瓷，五道厚褶把壳缘托成了一排小浪。', ['storm', 'fog'], true, 'shell'),
    find('crab_molt_claw', '螃蟹蜕下的小钳', 'common', .054, '钳尖白得像刚蘸过盐。翻到腕口一看，橘红的薄壳里空空的，原主人早就换了新衣。', ['clear', 'cloudy'], true, 'shell'),
    find('drift_cork', '海漂软木塞', 'common', .047, '软木塞被浪磨圆了，两头还有细小的气眼。腰间那圈红漆，只剩断断续续的一道。', ['cloudy', 'storm'], true, 'wood'),
    find('sea_bamboo', '波纹海竹节', 'common', .106, '沙色的小竹管上起着一圈圈波纹；迎着亮处，从参差的断口能一直望到另一头。', ['overcast', 'rain'], true, 'wood'),
    find('fan_alga', '海扇藻叶', 'common', .091, '短柄上摊开一面橄榄绿的小扇，浅色生长纹一圈追着一圈，到了薄边便随波打起褶来。', ['drizzle', 'clear'], true, 'wood'),
    find('mermaid_comb', '人鱼梳', 'uncommon', .104, '蜜糖色的梳背弯成一钩新月，沿背刻着细线。梳齿缺了两枚，断茬却已磨得不扎手了。', ['fog', 'drizzle'], true, 'wood'),
    find('gooseneck_cluster', '鹅颈藤壶空簇', 'uncommon', .083, '三枚瓷白的壳板从深褐色弯柄上探出头，壳缝张着，里面的住客已经不在了。', ['overcast', 'storm'], true, 'shell'),
    find('crinoid_crown', '海百合冠化石', 'rare', .143, '灰蓝色石片上，海百合的细腕从花萼向外舒展，连羽毛似的侧枝都一根根留了下来。', ['rain', 'fog'], true, 'stone'),
    find('wreck_compass', '沉船罗盘', 'rare', .085, '青铜表盖半开着，铰链里积了绿锈。浅色刻度盘上，一枚朱红的指针仍指着北边。', ['storm', 'overcast'], true, 'metal'),
    find('amber_shrimp', '琥珀封虾', 'rare', .064, '透过蜂蜜色的琥珀，能看见一只蜷起尾扇的小虾；眼前的长须和腹下几条细腿都分得清。', ['clear', 'fog'], true, 'stone'),
    find('silver_sail_badge', '银帆船徽', 'rare', .068, '小船的银帆沿一道折痕弯了过去，凹处积着乌色。翻到背面，还能摸到两颗圆铆钉。', ['drizzle', 'storm'], true, 'metal'),
  ];
  const trash = [
    litter('plastic_cap', '塑料瓶盖', 0.06, '海水磨旧的青绿汽水瓶盖，盖顶印着一头奶白色的小鲸鱼。', ['clear', 'cloudy']),
    litter('crushed_can', '压扁的易拉罐', 0.13, '褪色的蓝罐被踩出一道折痕，拉环还挂在盖上。', ['rain', 'storm']),
    litter('tangled_fishing_line', '缠成团的钓线', 0.12, '几股旧钓线绕在一起，红白小浮标也被缠住了。', ['overcast', 'storm']),
    litter('broken_flipflop', '断带拖鞋', .15, '橘色鞋底被磨薄了，蓝绿的人字带只剩一边扣着。', ['clear', 'rain']),
    litter('foil_wrapper', '褪色糖纸', .09, '扭皱的条纹糖纸，折角露出银灰色的内衬。', ['cloudy', 'storm']),
  ];
  const byId = new Map([...collectibles, ...trash].map(k => [k.id, k]));
  const makers = new Map(), cache = new Map(), materials = new Map();
  for (const {id, name, size, desc, make, weather, chime} of V3.moonTreasures?.items || []) {
    const k = find(id, name, 'ultra', size, desc, weather, true, chime);
    collectibles.push(k); byId.set(id, k); makers.set(id, () => V3.moonTreasures.geometry(make));
  }
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
    // An inclusion draws its opaque interior first, then the polished skin. Keep opacity
    // separate from vertex colour so repainting a specimen never hides what's inside.
    let skinStart;
    draw({ loft, add, beam, tri, quad, beginSkin: () => { skinStart = pos.length / 3; } });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (skinStart !== undefined) {
      const uv = new Float32Array(pos.length / 3 * 2);
      for (let i = 0; i < uv.length / 2; i++) uv[i*2] = i < skinStart ? .25 : .75;
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    }
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











  // Restored triangle sculpt (as before the 11-12 cuboid conversion). The MC resource pack keeps its own
  // cuboid version (31-collectible-cubes.js); only the web mesh is sculpted.
  model('sea_urchin_test', ({ loft, add }) => {
    const sections = rings([[0, .32, .32], [.08, .45, .45], [.19, .50, .50], [.29, .45, .45], [.38, .32, .32], [.41, .14, .14],
      [.38, .096, .096], [.24, .08, .08]], 30,
    ([x, y, z], a) => { const f = 1 + .059 * Math.cos(5 * a); return [x*f, y*(1.12+.05*Math.cos(5*a)), z*f]; });
    loft(sections, (r, i) => r >= 6 ? 0x5a5f72 : r < 0 ? 0x91ac9e : r === 5 ? 0xdedac6 : i % 6 === 0 || i % 6 === 5 ? (r%2?0xbd9ab2:0xbb88a0) : (i%6===3?0x88aa97:0xa4ba9e));
    // Small contrasting pore pairs, flush along the five bands rather than spikes.
    for (let arm = 0; arm < 5; arm++) {
      for (const [row, r, y] of [[0, .464, .11], [1, .5, .19], [2, .46, .27], [3, .363, .35]]) {
        for (const side of [-1, 1]) {
          const a = TAU * arm / 5 + side * (.06 + row * .013);
          const surface = r * (1 + .059 * Math.cos(5 * a));
          const geo = new THREE.IcosahedronGeometry(.017 - row * .001, 0).scale(.5, 1, 1).rotateY(-a)
            .translate(Math.cos(a) * surface, y*(1.12+.05*Math.cos(5*a)), Math.sin(a) * surface);
          add(geo, 0x785776);
        }
      }
    }
  });

  // Abalone, nacre side up: a thick ear-shaped cup meshed as rings around the spire (C, near the narrow end).
  // Top = iridescent inside, bottom = brown ribbed outside, a brown lip, five real through-holes on the ridge.
  model('rainbow_abalone', ({ tri, quad }) => {
    const n = 22, ts = [0, .3, .56, .74, .86, .95, 1], R = ts.length - 1, HOLE = 3, H = .38, C = [.57, .17];
    const holes = new Set([12, 14, 16, 18, 20]), plugged = new Set([21, 0]);
    const nacre = [0x327f80, 0x3b798d, 0x6786a8, 0x986f91, 0xc8928c, 0xc7ad80];
    const UP = [0, 1, 0], DN = [0, -1, 0];
    const outline = Array.from({ length: n }, (_, i) => {
      const f = TAU * i / n, s = Math.sin(f), wave = 1+.052*Math.sin(7*f+.4)+.036*Math.cos(3*f);
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





  // Tide atlas: individual specimens, in design units. Rows, tubes and inlaid pigments bake to one mesh per find.
  const cycle = (n, fn) => Array.from({length:n}, (_,i)=>fn(i*TAU/n,i));
  const blend = (a,b,t) => {const channel = s => Math.round(((a>>s)&255)*(1-t)+((b>>s)&255)*t)<<s;return channel(16)|channel(8)|channel(0);};
  function ell(g,p,r,c,turn=0) {g.add(new THREE.SphereGeometry(1,10,6).scale(...r).rotateY(turn).translate(...p),c);}
  function strand(g,pts,r,col,n=5,segments=Math.max(6,pts.length)) {g.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(v)),segments,r,n,false),col);}
  // A pair of continuously joined valves; each rib alters both the contour and the highlights.
  function valve(g,o) {
    const {w,l,h,colors:c,ribs:n}=o,N=n*4, R=7;
    function p(i,j,under){const a=i*TAU/N,t=j/R,petal=(1+Math.cos(n*a))*.5,edge=1+.045*Math.cos(n*a),s=Math.sin(a),z=Math.cos(a);
      let x=w*s*(1+(o.fan?.43:.14)*z),zz=l*z;
      if(o.ark){x=w*Math.sign(s)*Math.abs(s)**.74;zz=l*Math.sign(z)*Math.abs(z)**.60+.12*x;}
      const shift=-l*(o.fan?.84:.40);zz=shift+t*(zz*edge-shift);x=x*t*edge;
      return [x,(under?-.48:1)*h*(.06+(1-t*t)**.65)+t*(.13*h*petal+(j%2)*.036*h)*(under?-.6:1),zz];}
    for(let i=0;i<N;i++){const k=(i+1)%N;for(let j=0;j<R;j++)for(const u of [false,true]){
      const light=(i%4===0||i%4===3), pigment=o.ark?(Math.floor(i/6+j*.7)%3===0?c[0]:c[1]):blend(c[0],c[1],j/R),col=u?blend(pigment,c[2],.42):blend(pigment,light?c[2]:c[0],j===5?.66:light?.48:.12);
      g.quad(p(i,j,u),p(k,j,u),p(k,j+1,u),p(i,j+1,u),col,[0,u?-1:1,0]);}
      const a=p(i,R,false),b=p(k,R,false);g.quad(a,b,p(k,R,true),p(i,R,true),c[0],[a[0],0,a[2]]);
      if(o.crowns&&i%8===0){for(const j of [4,6]){const a=p(i,j,false),q=p((i+N-1)%N,j,false),s=p(k,j,false),b=p(i,j+1,false),t=[a[0]*1.05,a[1]+.085,a[2]+.025];g.tri(q,b,t,c[1],[0,1,0]);g.tri(b,s,t,c[2],[0,1,0]);g.tri(s,q,t,c[0],[0,1,0]);}}
    }
  }
  model('cockle',g=>valve(g,{w:.48,l:.46,h:.31,ribs:14,colors:[0xaa5e51,0xefaa92,0xffddb4]}));
  model('ark_shell',g=>valve(g,{w:.57,l:.34,h:.23,ribs:16,ark:true,colors:[0x754533,0xbb815c,0xe3c398]}));
  model('lions_paw',g=>{valve(g,{w:.55,l:.48,h:.24,ribs:12,fan:true,crowns:true,colors:[0x983f38,0xce7046,0xffc184]});g.add(new THREE.BoxGeometry(.37,.067,.145).translate(0,.13,-.41),0xbb7254);});
  model('coquina',g=>{for(const side of [-1,1]){
    const rows=rings([[0,.20,.38],[.035,.25,.44],[.075,.26,.45],[.107,.23,.40],[.115,.12,.20]],28,([x,y,z],a,i,j)=>[side*(.21+x+.15*z),y+x*.24+.034*Math.cos(a*7)*(j===2?1:.1),z]);
    g.loft(side===-1?rows.map(r=>r.slice().reverse()):rows,(j,i)=>j<1?0xab7961:j===1?0xe0bb97:j===2?0xc1a2b9:i%7<3?0xb58ca8:0xeac6ac);}
    g.beam([0,.045,-.22],[0,.049,.19],.029,.023,0xa57565,8);});
  model('tusk_shell',g=>{const N=16,R=19, outer=[],inner=[];for(let j=0;j<=R;j++){const t=j/R,rr=(.138*(1-t)+.043*t)*(j%3===0?1.035:1);
    function ringAt(f){return cycle(N,(a,i)=>[t-.50,.14+.32*t*t+Math.cos(a)*rr*f,.12*Math.sin(3*t)+Math.sin(a)*rr*f]);}outer.push(ringAt(1));inner.push(ringAt(.72));}
    for(let j=0;j<=R;j++)for(let i=0;i<N;i++){const k=(i+1)%N,a=i*TAU/N,n=[0,Math.cos(a),Math.sin(a)];if(j<R){g.quad(outer[j][i],outer[j][k],outer[j+1][k],outer[j+1][i],j%4===1?0xc3ac8a:i%5===1?0xd4c09c:0xeddec2,n);g.quad(inner[j][i],inner[j][k],inner[j+1][k],inner[j+1][i],j<4?0x9d8a71:0x73655a,n.map(x=>-x));}if(j===0||j===R)g.quad(outer[j][i],outer[j][k],inner[j][k],inner[j][i],0xf4e8cf,[j?1:-1,0,0]);}});
  // Compact log spiral shells: profile, winding and aperture are part of the mesh, not a painted spiral.
  function coil(g,{turns,shrink,rise,width,tube,height,paint,tilt=0,steps=32}){const R=Math.round(turns*steps),N=10,rows=[];const tiltPoint=([x,y,z])=>{const X=x*Math.cos(tilt)-y*Math.sin(tilt);return [-.50*X+.866*z,y*Math.cos(tilt)+x*Math.sin(tilt),-.866*X-.50*z];};
    for(let j=0;j<=R;j++){const t=j/steps,a=t*TAU+.36,s=shrink**t;rows.push(cycle(N,b=>tiltPoint([(width+tube*Math.cos(b))*Math.sin(a)*s,rise*(1-s)+height*Math.sin(b)*s,(width+tube*Math.cos(b))*Math.cos(a)*s])));}
    for(let j=0;j<R;j++)for(let i=0;i<N;i++){const k=(i+1)%N,a=(j+.5)/steps*TAU+.36,b=(i+.5)*TAU/N,n=[Math.cos(b)*Math.sin(a),Math.sin(b),Math.cos(b)*Math.cos(a)];g.quad(rows[j][i],rows[j][k],rows[j+1][k],rows[j+1][i],paint(j,i),tiltPoint(n));}
    // Inward throat: close its back well inside the last whorl, preserving the visible hollow mouth.
    const mid=r=>r.reduce((s,p)=>s.map((v,k)=>v+p[k]/N),[0,0,0]),m=mid(rows[0]),deep=mid(rows[3]);const lip=rows[0].map(p=>p.map((x,k)=>m[k]+.82*(x-m[k])));
    for(let i=0;i<N;i++){const k=(i+1)%N;g.quad(rows[0][i],rows[0][k],lip[k],lip[i],0xf4dfb9,tiltPoint([-.94,0,.35]));g.tri(lip[i],lip[k],deep,blend(paint(2,i),0x6a484b,.5),tiltPoint([-.94,0,.35]));g.tri(rows[R][i],rows[R][k],mid(rows[R]),paint(R,i),[0,1,0]);}}
  model('top_shell',g=>coil(g,{turns:3.3,shrink:.63,rise:.62,width:.36,tube:.18,height:.16,paint:(r,i)=>i===1||i===5?(r%3===0?0xe8c69b:0x97b29d):i<6?0x529185:r%6<3?0x446c65:0xc0ad89}));
  model('sundial',g=>coil(g,{turns:3.4,shrink:.48,rise:.25,width:.38,tube:.15,height:.11,steps:28,paint:(r,i)=>i===2||i===5?0xc6975f:(r+(i>2?1:0))%4<2?0x784c38:0xefdbaf}));
  model('violet_snail',g=>coil(g,{turns:2.7,shrink:.38,rise:.52,width:.23,tube:.26,height:.27,tilt:.62,paint:(r,i)=>i<4?(r%8===1?0xe2cce2:0xb094b8):i<8?0x90799f:0x6d557f}));
  model('mermaids_eye',g=>{const N=32,R=9;const rows=rings([[0,.32,.23],[.04,.47,.35],[.08,.51,.39],[.11,.48,.36],[.14,.42,.3],[.22,.31,.23],[.26,.12,.08]],N,([x,y,z],a,i,j)=>[x+.035*j/6,y,z+.08*x]);g.loft(rows,(j,i)=>j<2?0xd0bda1:j===2?0xf2e5c4:j===3?0x668978:j===4?0x396b57:j===5?0x78a580:0xacc49c);
    const pts=Array.from({length:R*3},(_,i)=>{const a=i*.34,r=.012+.005*i;return [.03+r*Math.cos(a),.265-.1*(r/.35)**2,r*.57*Math.sin(a)];});strand(g,pts,.009,0x365a4d,5);});
  model('winged_kelp',g=>{const stalk=[[-.42,.01,-.20],[-.20,.06,-.07],[.01,.08,.01],[.25,.12,.13],[.45,.11,.21]];strand(g,stalk,.018,0x7d7337);
    for(const [x,z,sign,h] of [[-.25,-.11,1,.20],[-.12,-.05,-1,.17],[0,.03,1,.25],[.18,.09,-1,.25],[.27,.14,1,.18]]){const rows=Array.from({length:8},(_,i)=>{const t=i/7,b=.008+.064*Math.sin(t*Math.PI);return [[x+.16*t-b,.055+h*Math.sin(t*2.7),z+sign*.27*t],[x+.16*t,.08+h*Math.sin(t*2.7),z+sign*.27*t+.007],[x+.16*t+b,.052+h*Math.sin(t*2.7),z+sign*.27*t],[x+.16*t,.045+h*Math.sin(t*2.7),z+sign*.27*t-.008]];});g.loft(sign<0?rows.map(row=>row.slice().reverse()):rows,(j,i)=>i%3===0?0xba9c42:0x827b3c);ell(g,[x+.06,.117,z+sign*.07],[.070,.069,.056],0xc69540);}});
  model('sea_pottery',g=>{const e=[[-.46,-.20],[-.23,-.38],[.20,-.35],[.48,-.13],[.39,.20],[.14,.37],[-.35,.30]],y=(x,z)=>.114+.13*x+.19*z*z;const rows=[[.87,-.08],[1,-.025],[.98,0],[.88,.006]].map(([f,d])=>e.map(([x,z])=>[f*x,y(f*x,f*z)+d,f*z]));g.loft(rows,(j,i)=>j<1?0xb99c79:j===1?0xcfb992:0xf0e3c9);
    const arc=(a,b,f,n)=>Array.from({length:n},(_,i)=>{const t=a+(b-a)*i/(n-1),[x,z]=f(t);return [x,y(x,z)+.026,z];});for(const rad of [.31,.338])strand(g,arc(-.75,2.1,t=>[rad*Math.cos(t),rad*Math.sin(t)*.77],15),.009,0x375681);
    for(let i=0;i<5;i++){const a=i*TAU/5;strand(g,arc(0,TAU,t=>{const l=.105*(1-Math.cos(t)),w=.033*Math.sin(t);return [-.07+l*Math.cos(a)-w*Math.sin(a),-.02+l*Math.sin(a)+w*Math.cos(a)];},13),.011,0x355985);}ell(g,[-.07,y(-.07,-.02)+.033,-.02],[.028,.012,.026],0xa18b57);});
  model('venus_comb',g=>{coil(g,{turns:3,shrink:.48,rise:.52,width:.20,tube:.19,height:.16,tilt:-.78,steps:18,paint:(r,i)=>r%4===0?0xb69175:i%4===0?0xd8bda2:0xe7d2b2});
    strand(g,[[-.03,.06,.04],[-.11,.01,.41],[-.30,-.015,.80]],.045,0xd4b89c,7);
    for(let i=0;i<10;i++)for(const side of [-1,1]){const t=i/10,x=-.02-.24*t,z=.01+.70*t,h=.09-.1*t,L=.30*(1-.65*t);const mid=[x+side*L*.65,h+.04,z-.07],tip=[x+side*L,h+.08,z-.15];g.beam([x+side*.04,h,z],mid,.034*(1-.5*t),.021,0xd5b898,6);g.beam(mid,tip,.021,.003,0xe9d8b8,6);}});
  model('red_coral',g=>{const paths=[[[0,0,0],[-.04,.24,0],[.055,.46,-.015],[-.01,.67,0],[.075,.89,.018]],[[0,.20,0],[-.23,.36,.025],[-.31,.53,.04],[-.49,.62,.01],[-.54,.75,.03]],[[-.27,.46,.03],[-.20,.59,.09],[-.25,.73,.11]],[[-.405,.59,.025],[-.39,.72,-.01],[-.42,.81,-.03]],[[.05,.44,-.015],[.24,.57,.055],[.35,.75,.06],[.48,.85,.045]],[[.25,.60,.055],[.22,.74,.12],[.28,.88,.14]],[[0,.65,0],[-.135,.76,-.07],[-.13,.91,-.085]],[[.33,.73,.065],[.32,.835,.03],[.36,.96,.04]],[[.02,.37,-.01],[.05,.48,-.18],[.16,.60,-.22]]];
    paths.forEach((pts,k)=>{const curve=new THREE.CatmullRomCurve3(pts.map(v)),N=7,L=pts.length*2,frames=curve.computeFrenetFrames(L,false);const rows=Array.from({length:L+1},(_,j)=>{const t=j/L,p=curve.getPointAt(t),r=(k===0?.077:k===1||k===4?.052:.034)*(1-.68*t);return cycle(N,a=>p.clone().addScaledVector(frames.normals[j],r*Math.cos(a)).addScaledVector(frames.binormals[j],r*Math.sin(a)).toArray());});// Frenet cross sections wind counter to this catalog’s horizontal-ring convention.
      g.loft(rows.map(row=>row.slice().reverse()),(j,i)=>blend(i%4===0?0x983e3c:0xb3413e,0xe07b60,Math.max(0,j/L)*.65));const tip=pts.at(-1),rad=k===0?.026:.016;ell(g,tip,[rad,rad,rad],0xe47c63);});
    ell(g,[.005,.028,-.02],[.13,.047,.085],0xb95e4a);});
  model('opal_ammonite',g=>{
    // Chamber partitions bow towards the opening. The opal facets and septa share vertices with
    // the outer rind, so turning a specimen over shows a continuous, ribbed fossil underside.
    const count=88, sweep=2.36*TAU, colors=[0x287a80,0x378384,0x496d88,0x478b85,0x65749c,0x337f88,0x669a8d];
    const rad=u=>1+1.86*u, H=u=>.11+.065*Math.sin(Math.PI*u), stops=[0,.075,.38,.76,.95,1];
    const P=(i,u,h)=>{const a=i/count*sweep+.105*Math.sin(Math.PI*u),r=.046*Math.exp(.167*a)*rad(u);return [r*Math.cos(a)-.05,r*h+.034,r*Math.sin(a)];};
    for(let i=0;i<count;i++){
      const pigment=colors[(Math.floor(i/4)*3)%colors.length], groove=i%4===0, bottom=(j,u)=>-.14-.14*u+.035*(j%4===0?1:0)*u;
      for(let j=0;j<stops.length-1;j++){
        const u=stops[j], w=stops[j+1], a=P(i,u,H(u)), b=P(i+1,u,H(u)), c=P(i+1,w,H(w)), d=P(i,w,H(w));
        let col=j===0||j===4?0x9e865e:groove?0xbfa478:blend(pigment,j===1?0x25445b:0x96c3ab,j===1?.43:.1+.10*(i%4));
        g.quad(a,b,c,d,[col,(!groove&&j===2&&i%4===2)?blend(col,0x9dcaca,.55):col],[0,1,0]);
        g.quad(P(i,u,bottom(i,u)),P(i+1,u,bottom(i+1,u)),P(i+1,w,bottom(i+1,w)),P(i,w,bottom(i,w)),groove?0x896e55:0x655a52,[0,-1,0]);
      }
      for(const u of [0,1]){const n=[Math.cos(i/count*sweep),0,Math.sin(i/count*sweep)].map(v=>v*(u?1:-1));g.quad(P(i,u,H(u)),P(i+1,u,H(u)),P(i+1,u,bottom(i+1,u)),P(i,u,bottom(i,u)),groove?0xaa8e68:0x786952,n);}
      if(i===0||i===count-1){const k=i?count:0,a=k/count*sweep,n=[-Math.sin(a),0,Math.cos(a)].map(x=>x*(i?1:-1));for(let j=0;j<stops.length-1;j++){const u=stops[j],w=stops[j+1];g.quad(P(k,u,H(u)),P(k,w,H(w)),P(k,w,bottom(k,w)),P(k,u,bottom(k,u)),j%2?0xa98c69:0x8e795f,n);}}
    }
  });
  model('broken_flipflop',g=>{const edge=[[-.21,-.44],[-.03,-.52],[.18,-.46],[.23,-.27],[.18,-.02],[.19,.25],[.12,.43],[-.06,.47],[-.21,.36],[-.19,.11],[-.17,-.09],[-.24,-.26]];const rows=[[.90,0],[1,.035],[1,.067],[.96,.086]].map(([s,y])=>edge.map(([x,z])=>[s*x,y+.06*z*z,s*z]));g.loft(rows,j=>j===1?0xdbb57d:j<1?0x995f43:0xd08b53);strand(g,[[-.16,.092,.03],[-.13,.21,-.16],[-.01,.19,-.27],[.075,.19,-.22],[.17,.23,-.11]],.028,0x52847e,6);ell(g,[.15,.095,.05],[.033,.01,.034],0x8e613e);for(const z of [.20,.27,.34])strand(g,[[-.12,.098,z],[-.013,.105,z+.025],[.10,.10,z]],.008,0xb27550);});
  model('foil_wrapper',g=>{const rows=[[-.52,.17],[-.41,.13],[-.31,.045],[-.23,.18],[-.13,.22],[.16,.21],[.24,.16],[.31,.037],[.42,.13],[.52,.17]].map(([x,r],j)=>cycle(10,(a,i)=>[x+(j===0||j===9?.014*(i%2):0),.15+r*.75*Math.sin(a+j*.32),r*Math.cos(a+j*.32)]));g.loft(rows,(j,i)=>j<2||j>=7?(i%2?0xbac1b6:0x829398):i%5<2?0xc28875:i%5===2?0xe2c8a9:0x77938b);});

  // Hand-finished surfaces for the earlier strandline finds: secondary stripes follow the actual folds.
  const detailing = {
    limpet(g){const N=48,rows=rings([[0,.43,.33],[.035,.52,.39],[.073,.48,.36],[.14,.42,.31,-.02],[.17,.40,.29,-.035],[.27,.28,.21,-.068],[.35,.17,.13,-.11],[.405,.044,.036,-.16]],N,([x,y,z],a,i,j)=>{const rib=1+.082*Math.cos(a*12);return [x*rib,y+(j?.012*Math.sin(3*a):0),z*rib];});g.loft(rows,(j,i)=>j<1?0x8e7965:j===3?0xd4b997:blend(i%4<2?0xb39578:0x79796e,0xdbbc91,Math.max(0,j)*.09));},
    oyster_shell(g){const N=32,r=[[0,.37,.22],[.025,.50,.30],[.055,.46,.29],[.085,.53,.31],[.11,.48,.28],[.15,.54,.32],[.175,.48,.285],[.198,.52,.30],[.19,.45,.26],[.12,.33,.2],[.095,.19,.108],[.09,.07,.042]];g.loft(rings(r,N,([x,y,z],a,i,j)=>{const f=1+.12*Math.cos(3*a)+.048*Math.sin(7*a+j*.19);return [x*f,y+.043*Math.sin(3*a)*Math.min(1,j/3),z*f*(1+.34*Math.cos(a))];}),(j,i)=>j<0?0x695f59:j<7?[0x766c62,0xa49074,0x6d7369,0x9a8b7b,0x756763,0xbeaa91,0x8b7c73][j]:[0xd7bdae,0xe3c9b8,0xcbafb6,0xb5a6ad,0xe2c7b9][j-7]);},
    razor_clam(g){for(const side of [-1,1]){const rows=Array.from({length:18},(_,j)=>{const t=j/17,x=t-.5,r=(.62+.38*Math.sin(t*Math.PI))*(j%3===0?.97:1);return cycle(12,a=>[x,.063+.032*Math.sin(t*3)+.053*r*Math.sin(a),side*.054+.049*r*Math.cos(a)+.045*x*x]);});g.loft(rows,(j,i)=>j<0||j===17?0x9c8068:i<6?(j%5===1?0xaa8e68:j%5===2?0xc6aa81:0xe2c99e):0x8c7661);}},
    green_sea_glass(g){const edge=[[-.48,-.10],[-.40,-.24],[-.26,-.33],[-.06,-.32],[.20,-.26],[.40,-.17],[.48,-.035],[.41,.10],[.26,.24],[.06,.31],[-.17,.30],[-.36,.21]];g.loft([[0,.7],[.032,.91],[.07,1],[.14,.98],[.18,.87],[.20,.64],[.205,.27]].map(([y,s],j)=>edge.map(([x,z],i)=>[x*s+.011*j,y+.016*Math.sin(i*.72)*Math.min(1,j/3),z*s])),(j,i)=>j<1?0x397d75:j===2?0x529c8e:j===4?blend(0x5bad9f,0x99ccaf,.5+.28*Math.sin(i)):j>4?0x64b5a2:0x318e83);},
    striped_pebble(g){const ys=[[0,.29,.21],[.033,.42,.28],[.073,.49,.32],[.09,.50,.33],[.12,.52,.34],[.17,.53,.35],[.188,.53,.35],[.205,.51,.34],[.265,.43,.29],[.30,.30,.21],[.32,.16,.12]];g.loft(rings(ys,22,([x,y,z],a,i,j)=>[x*(1+.045*Math.cos(3*a)),y+.055*Math.sin(a+.3)*Math.sin(j/10*Math.PI)+.022*Math.cos(2*a)*Math.sin(j/10*Math.PI),z+.065*x]),(j,i)=>j===2?0xc3b795:j===5?0xeee0c0:j===6?0xa9a48c:j>7?0x778484:blend(0x485a60,0x819194,.13+.06*Math.cos(i)));},
    driftwood(g){const paths=[[[[-.53,.08,-.03],[-.35,.10,-.005],[-.19,.105,.04],[.06,.095,.07],[.28,.13,.025],[.52,.17,-.084]],.097],[[[-.11,.105,.06],[.01,.16,.20],[.18,.19,.31],[.29,.21,.36]],.065],[[[.25,.13,.03],[.30,.23,.10],[.34,.29,.13]],.038]];for(const [pts,r] of paths){const rows=pts.map(([x,y,z],j)=>cycle(9,(a,i)=>[x,y+Math.sin(a)*r*(1-.64*j/(pts.length-1)),z+Math.cos(a)*r*(1-.64*j/(pts.length-1))]));g.loft(rows,(j,i)=>j<0||j===pts.length-1?0xad8c69:[0x8e715a,0xb29876,0xc0a480,0x9f846d,0xcab08a,0x957f68,0x846e5b,0xa88f76,0xb1997c][i]);}strand(g,[[-.49,.14,-.066],[-.30,.174,-.005],[-.15,.171,.025],[.07,.145,.05],[.21,.153,.025]],.009,0x88715d);},
    kelp_ribbon(g){const rows=Array.from({length:23},(_,j)=>{const t=j/22,w=.04+.12*Math.sin(Math.PI*t),z=.12*Math.sin(6*t-.8),y=.095+.14*t+.12*Math.sin(6.7*t)**2;const d=.07*Math.sin(11*t);return [[t-.5,y-d,z-w],[t-.5,y+.016,z],[t-.5,y+d,z+w],[t-.5,y-.018,z]];});g.loft(rows.map(row=>row.slice().reverse()),(j,i)=>i===1?0x969253:i===0?0x788249:0x636740);strand(g,rows.map(r=>r[1]),.011,0xb9a85d);},
    sea_bean(g){const N=36;const edge=cycle(N,a=>[.46*Math.sin(a)**3,-(.31*Math.cos(a)-.12*Math.cos(2*a)-.057*Math.cos(3*a)-.024*Math.cos(4*a))]);g.loft([[0,.7],[.052,.89],[.106,.98],[.122,1],[.145,.995],[.159,.985],[.205,.92],[.245,.72],[.263,.42]].map(([y,s])=>edge.map(([x,z])=>[x*s,y,z*s])),(j,i)=>j===2||j===4?0x794937:j===3?0xc29565:j<2?0x6a4240:blend(0x875041,0xab6951,.18+.12*Math.cos(i*.2)));},
    barnacle_cluster(g){g.add(new THREE.IcosahedronGeometry(.46,1).scale(1,.26,.80),0x526263);for(const [x,z,r,h] of [[-.19,.06,.22,.35],[.14,.14,.16,.28],[.10,-.16,.145,.32],[-.29,-.15,.090,.17],[.295,-.04,.082,.14]]){const rows=rings([[.025,r,r,x,z],[h*.42,r*.89,r*.92,x,z],[h*.78,r*.67,r*.69,x,z],[h,r*.49,r*.50,x,z],[h*.95,r*.35,r*.34,x,z],[h*.54,r*.23,r*.22,x,z]],15,([px,y,pz],a,i,j)=>[px,y+(j>=2?.021*Math.cos(a*5):0),pz]);g.loft(rows,(j,i)=>j>3?0x62545a:j===3?0xf0d4b8:i%3===0?0xa39388:i%3===1?0xd6bda8:0xbba399);}},
    coral_fragment(g) {
      // A broken cluster of stony coral. Each branch has a single fluted skin and a recessed
      // calice at the end; the sea-worn broken base stays distinct from the intact red coral.
      const chalk = 0xe7d1b3, rose = 0xcd637f, seam = 0xad6771, lip = 0xe69ba0;
      function branch(pts, sizes, faded = false, broken = false) {
        const path = new THREE.CatmullRomCurve3(pts.map(v)), steps = (pts.length - 1) * 3, n = 12;
        const frames = path.computeFrenetFrames(steps, false), rows = [], centres = [];
        for (let j = 0; j <= steps; j++) {
          const t = j / steps, f = t * (sizes.length - 1), h = Math.min(Math.floor(f), sizes.length - 2);
          const r = sizes[h] + (sizes[h + 1] - sizes[h]) * (f - h), c = path.getPointAt(t);
          centres.push(c); rows.push(cycle(n, (a, i) => {
            const rad = r * (i % 2 ? .94 : 1.04), b = a + .17*t;
            return c.clone().addScaledVector(frames.normals[j], rad*Math.cos(b))
              .addScaledVector(frames.binormals[j], rad*Math.sin(b)).toArray();
          }));
        }
        for (let j = 0; j < steps; j++) for (let i = 0; i < n; i++) {
          const k = (i+1)%n, tone = Math.max(0, Math.min(1, (j/steps-.25)*1.48));
          const col = blend(chalk, faded ? 0xd5a3a2 : rose, tone);
          const outward = v(rows[j][i]).sub(centres[j]).toArray();
          g.quad(rows[j][i], rows[j][k], rows[j+1][k], rows[j+1][i], blend(col, seam, i%3===0 ? .14 : .02), outward);
        }
        // Both caps have thickness. The little cup and its darker floor read even at icon size.
        for (const end of [0, steps]) {
          const top = end === steps, c = centres[end], rim = rows[end], r = sizes[top ? sizes.length-1 : 0];
          const normal = frames.tangents[end].clone().multiplyScalar(top ? 1 : -1);
          const floor = c.clone().addScaledVector(normal, -.33*r);
          const inner = rim.map(p => c.clone().lerp(v(p), top ? .53 : .61).toArray());
          const floorRing = inner.map(p => floor.clone().addScaledVector(v(p).sub(c), .63).toArray());
          for (let i = 0; i < n; i++) {
            const k = (i+1)%n, pale = top && !broken ? lip : 0xe3c7a6;
            g.quad(rim[i], rim[k], inner[k], inner[i], i%2 ? pale : blend(pale,0xffedce,.26), normal.toArray());
            g.quad(inner[i], inner[k], floorRing[k], floorRing[i], top && !broken ? 0xa26471 : 0xb29581, c.clone().sub(v(inner[i])).toArray());
            g.tri(floor.toArray(), floorRing[i], floorRing[k], top && !broken ? 0x976173 : 0xb39c86, normal.toArray());
          }
        }
      }
      branch([[-.15,.065,.27],[-.09,.20,.10],[.01,.36,-.012],[.035,.52,-.052],[.005,.68,-.08]], [.113,.112,.094,.073,.064]);
      branch([[-.068,.235,.047],[-.21,.32,.005],[-.325,.43,-.04],[-.36,.56,-.075]], [.099,.09,.078,.062]);
      branch([[-.284,.398,-.03],[-.41,.435,.017],[-.478,.487,.043]], [.069,.061,.053], true);
      branch([[.002,.335,.004],[.135,.391,.046],[.248,.47,.073],[.31,.605,.085]], [.095,.09,.074,.061]);
      branch([[.215,.45,.065],[.332,.475,.13],[.402,.529,.159]], [.061,.055,.05]);
      branch([[-.024,.303,.025],[-.076,.356,-.12],[-.15,.443,-.13]], [.069,.054,.047], true, true);
      branch([[.043,.362,.048],[.068,.421,.14],[.056,.472,.178]], [.052,.043,.039]);
    },
    blue_glass_float(g){ell(g,[0,0,0],[.414,.406,.414],0x227e88);const at=(t,a,r=.421)=>[r*Math.sin(t)*Math.cos(a),r*.98*Math.cos(t),r*Math.sin(t)*Math.sin(a)];const levels=[.18,.68,1.26,1.87,2.44,2.94];for(let j=0;j<5;j++)for(let i=0;i<8;i++){const a=i*TAU/8+(j%2)*TAU/16;for(const side of [-1,1]){const pts=Array.from({length:5},(_,k)=>{const t=k/4;return at(levels[j]*(1-t)+levels[j+1]*t,a+t*side*TAU/16);});strand(g,pts,.014,j%2?0xbea377:0xd9ba85,4,3);}}g.add(new THREE.TorusGeometry(.065,.022,5,12).translate(0,.435,0),0xc19d66);},
    plastic_cap(g) {
      // A faded soda cap: a rolled shoulder, a narrow breakaway band, and a recessed liner.
      // The fine grip only dents the middle of the skirt; the silhouette stays circular.
      const n = 60;
      const profile = [ // [height, radius, groove depth, colour of the following strip]
        [.008,.437,0,0x354f54],[.018,.459,0,0x457679],[.051,.459,0,0x36575a],
        [.061,.451,0,0x284f54],[.076,.465,0,0x4d8282],[.101,.471,.012,0x47787b],
        [.211,.467,.011,0x568b87],[.242,.458,0,0x649994],[.264,.441,0,0x72a59b],
        [.280,.412,0,0x76a69a],[.286,.382,0,0x538881],[.281,.362,0,0x4e807c],
      ];
      const ring = ([y,r,d]) => cycle(n,(a,i)=>{
        const radius=r-(i%2 ? 0 : d);return [radius*Math.cos(a),y,radius*Math.sin(a)];
      });
      const rows=profile.map(ring), radial=i=>[Math.cos((i+.5)*TAU/n),0,Math.sin((i+.5)*TAU/n)];
      function band(a,b,colour,dir) {
        for(let i=0;i<n;i++) {const k=(i+1)%n;g.quad(a[i],a[k],b[k],b[i],colour(i),dir(i));}
      }
      for(let j=0;j<rows.length-1;j++) {
        const col=profile[j][3];
        band(rows[j],rows[j+1],i=>j===5&&i%2===0 ? blend(col,0x253f47,.22) : col,
          i=>j<8 ? radial(i) : [0,1,0]);
      }
      const lip=ring([.009,.385,0]), wall=ring([.206,.379,0]), seal=ring([.227,.360,0]);
      band(rows[0],lip,()=>0x427473,()=>[0,-1,0]);
      band(lip,wall,()=>0x38625f,i=>radial(i).map(x=>-x));
      band(wall,seal,()=>0xb5b39a,()=>[0,-1,0]);
      for(let i=0;i<n;i++) {const k=(i+1)%n;
        g.tri([0,.227,0],seal[i],seal[k],0xc6c2a8,[0,-1,0]);
        g.tri([0,.281,0],rows.at(-1)[i],rows.at(-1)[k],0x508781,[0,1,0]);
      }
      for(let h=0;h<2;h++) {
        const path=Array.from({length:21},(_,j)=>{const a=TAU*(j/24+h*.5);return [.378*Math.cos(a),.063+h*.071+j*.0015,.378*Math.sin(a)];});
        strand(g,path,.012,0x7d9c8b,5,21);
      }
      // Original one-colour whale stamp. Ink is part of the same mesh (no texture or external font).
      // Screen-right is +x and the back of the cap is -z. Turn the art to face the icon camera.
      const ink=0xf0dfb8, surface=(x,z,y=.283)=>[
        x*Math.cos(.35)+z*Math.sin(.35),y,-x*Math.sin(.35)+z*Math.cos(.35)];
      function print(shape,colour,y) {
        const pts=shape.getPoints(5), faces=THREE.ShapeUtils.triangulateShape(pts,[]);
        for(const face of faces) g.tri(...face.map(i=>surface(pts[i].x,pts[i].y,y)),colour,[0,1,0]);
      }
      const whale=new THREE.Shape(); whale.moveTo(-.249,-.008);
      whale.bezierCurveTo(-.253,-.104,-.172,-.147,-.079,-.139);
      whale.bezierCurveTo(.019,-.137,.065,-.073,.107,-.048);
      whale.quadraticCurveTo(.143,-.028,.168,-.069);
      whale.quadraticCurveTo(.151,-.128,.168,-.158);
      whale.quadraticCurveTo(.197,-.148,.208,-.111);
      whale.quadraticCurveTo(.230,-.146,.274,-.151);
      whale.quadraticCurveTo(.268,-.096,.224,-.075);
      whale.bezierCurveTo(.190,.018,.131,.079,.047,.107);
      whale.quadraticCurveTo(.016,.120,-.028,.121);
      whale.quadraticCurveTo(-.046,.164,-.087,.167);
      whale.lineTo(-.077,.120); whale.bezierCurveTo(-.170,.118,-.241,.077,-.249,-.008);
      print(whale,ink,.284);
      const eye=new THREE.Shape();eye.absellipse(-.166,-.032,.013,.014,0,TAU,false,0);print(eye,0x385956,.285);
      for(const [x,z,r] of [[-.157,-.195,.021],[-.116,-.242,.012]]) {
        const bubble=new THREE.Shape();bubble.absarc(x,z,r,0,TAU,false);print(bubble,ink,.284);
      }
    },
    crushed_can(g){const R=[[-.48,.21,.23],[-.45,.24,.25],[-.41,.23,.24],[-.37,.22,.23],[-.22,.16,.28],[-.14,.10,.27],[-.08,.12,.28],[.02,.095,.29],[.18,.16,.24],[.30,.22,.24],[.39,.22,.23],[.415,.24,.25],[.45,.23,.24],[.458,.19,.20]];g.loft(R.map(([x,h,w],j)=>cycle(18,(a,i)=>[x,.15+h*Math.sin(a)+.035*Math.cos(2*a)*Math.sin(j/13*Math.PI),w*Math.cos(a)+.055*Math.sin(4*x)])),(j,i)=>j<2||j>9?0xa9b8b4:j===3||j===8?0xebc291:(i+j)%12<3?0xe0ceab:i%8<3?0x638d87:0x3e746f);g.add(new THREE.TorusGeometry(.077,.015,5,14).scale(1.15,.65,1).rotateY(Math.PI/2).translate(.47,.16,.033),0xd6d0bb);},
    tangled_fishing_line(g){const loops=4;for(let j=0;j<loops;j++){const p=cycle(17,(a,i)=>[(.31+.03*Math.sin(3*a+j))*Math.cos(a)+.05*j-.09,.019+j*.019+.024*Math.sin(2*a+j),(.19+.02*Math.cos(2*a))*Math.sin(a+j*.39)]);p.push(p[0]);strand(g,p,.010, j%2?0x8a9c8b:0x667f76,4);}const q=[[-.16,.116,.07],[-.09,.126,.055],[.045,.148,.02],[.15,.164,-.01],[.22,.175,-.027]];for(let j=0;j<4;j++)g.beam(q[j],q[j+1],[.018,.065,.069,.021][j],[.065,.069,.021,.014][j],[0xc89b69,0xe6d7b6,0xba5949,0x99734c][j],10);},
  };

  for (const [id, draw] of Object.entries(detailing)) model(id, draw);
  function whorls(mesh, height, radius, ribs, palette) {
    const turns = 4, rows = 20;
    const spiral = Array.from({ length: rows }, (_, row) => {
      const progress = row / (rows - 1);
      return cycle(32, angle => {
        const ridge = .84 + .14 * Math.cos(angle - progress * TAU * turns) + .055 * Math.cos(angle * ribs + progress * 8);
        const width = (.035 + .965 * (1 - progress)) * radius * ridge;
        return [width * Math.cos(angle), height * progress, width * Math.sin(angle)];
      });
    });
    mesh.loft(spiral, (row, side) => palette[(side + Math.max(0, row)) % 8 < 2 ? 2 : Math.max(0, row) % 4 === 0 ? 1 : 0]);
  }
  function ellipsoid(mesh, centre, radii, color, sides = 12) {
    mesh.add(new THREE.SphereGeometry(1, sides, 7).scale(...radii).translate(...centre), color);
  }
  model('periwinkle', mesh => {
    whorls(mesh, .65, .44, 7, [0x9f9784, 0xc5b79b, 0x685e50]);
    ellipsoid(mesh, [.03, .12, .32], [.185, .13, .097], 0x583c2d);
  });
  model('wentletrap', mesh => {
    whorls(mesh, .96, .32, 12, [0xf4e6ce, 0xd2bda6, 0xfff5e5]);
    for (let tier = 0; tier < 5; tier++) mesh.add(new THREE.TorusGeometry(.27 - tier * .047, .023, 4, 16).rotateX(Math.PI / 2).translate(0, .085 + tier * .17, 0), 0xffedcf);
  });
  model('carrier_shell', mesh => {
    whorls(mesh, .35, .48, 5, [0xac9275, 0xc3aa88, 0x8c735b]);
    for (let chip = 0; chip < 9; chip++) { const angle = chip * TAU / 9; ellipsoid(mesh, [.42 * Math.cos(angle), .06 + chip % 2 * .045, .42 * Math.sin(angle)], [.095, .065, .081], [0xddd1ac, 0x93796d, 0xe3ae91][chip % 3], 7); }
  });
  model('cuttlebone', mesh => mesh.loft(Array.from({ length: 21 }, (_, slice) => {
    const progress = slice / 20, width = .014 + .25 * Math.sin(Math.PI * progress) ** .82 * (1.2 - progress * .5);
    return cycle(14, angle => [progress - .5, .03 + width * .31 * Math.sin(angle), width * Math.cos(angle)]);
  }), (slice, side) => side < 7 ? slice % 3 === 0 ? 0xd8cbb7 : 0xf5ecda : 0xdabca7));
  model('pumice', mesh => {
    mesh.loft(rings([[0,.33,.21],[.07,.45,.29],[.23,.41,.26],[.31,.27,.17]], 15, (point, angle) => [point[0], point[1] + .02 * Math.sin(angle * 3), point[2]]), (row, side) => (row + side) % 4 ? 0xaea498 : 0x988e81);
    for (let hole = 0; hole < 12; hole++) { const angle = hole * 2.4, radius = Math.sqrt((hole + 1) / 12); ellipsoid(mesh, [.25 * radius * Math.cos(angle), .314, .15 * radius * Math.sin(angle)], [.033, .012, .023], 0x726a61, 7); }
  });
  model('float_knot', mesh => {
    const points = cycle(32, angle => [.39 * Math.sin(angle), .11 + .074 * Math.cos(angle), .20 * Math.sin(2 * angle)]); points.push(points[0]);
    strand(mesh, points, .065, 0xb69361, 7, 36);
    strand(mesh, [[.03,.07,.01],[.16,.06,-.10],[.34,.045,-.16],[.52,.041,-.14]], .035, 0xaa5846);
  });
  model('chiton_plate', mesh => mesh.loft(Array.from({ length: 11 }, (_, row) => {
    const across = row / 10 * 2 - 1, crest = .26 * (1 - Math.abs(across));
    return cycle(12, angle => [across * .43, crest + .046 * Math.sin(angle), .29 * Math.cos(angle) + .10 * Math.abs(across)]);
  }), (row, side) => row % 4 === 0 ? 0xa2b2a2 : side < 6 ? 0x788d83 : 0x68766c));
  model('skate_eggcase', mesh => {
    mesh.loft(rings([[0,.29,.18],[.06,.34,.22],[.14,.27,.17]], 12), (row, side) => side % 3 ? 0x6a4430 : 0x8c6346);
    for (const end of [-1,1]) for (const side of [-1,1]) strand(mesh, [[end*.20,.07,side*.14],[end*.34,.065,side*.22],[end*.45,.07,side*.29],[end*.52,.12,side*.26],[end*.53,.15,side*.21]], .019, 0x64402d);
  });
  model('spiny_oyster', mesh => {
    mesh.loft(rings([[0,.34,.35],[.04,.44,.46],[.14,.38,.37],[.24,.18,.23]], 22, (point,angle) => [point[0],point[1]+.013*Math.cos(11*angle),point[2]]), (row,side) => row === 0 ? 0xe9bb87 : side % 2 ? 0xad5744 : 0xc4785c);
    for (let spine = 0; spine < 14; spine++) { const angle = spine * TAU / 14; mesh.beam([.32*Math.cos(angle),.14,.32*Math.sin(angle)], [.48*Math.cos(angle),.25,.51*Math.sin(angle)], .037,.008,0xdd9470); }
  });
  model('crinoid_fossil', mesh => {
    for (let disc = 0; disc < 5; disc++) {
      const offset = disc * .145, torus = new THREE.TorusGeometry(.117, .058, 7, 10).rotateY(Math.PI / 2);
      const positions = torus.attributes.position;
      for (let vertex = 0; vertex < positions.count; vertex++) { const py = positions.getY(vertex), pz = positions.getZ(vertex), wave = 1 + .24 * Math.cos(5 * Math.atan2(py,pz)); positions.setXYZ(vertex, positions.getX(vertex) + offset, py * wave, pz * wave); }
      mesh.add(torus, disc % 2 ? 0xc2b196 : 0xa2947d);
    }
  });
  model('giant_clam', ({ tri, quad }) => {
    const segments = 64, rings = [], shade = new THREE.Color(), highlight = new THREE.Color();
    const mix = (low, high, amount) => shade.setHex(low).lerp(highlight.setHex(high), amount).getHex();
    function profile(angle) {
      const front = Math.cos(angle), fan = THREE.MathUtils.smoothstep(front, -.66, .30);
      const pleat = (.5 + .5 * Math.cos(8.6 * Math.acos(front) + .12 * Math.sin(angle * 3))) ** 1.35;
      return { fan, pleat, wave: fan * (pleat - .44), reach: .66 + .29 * front };
    }
    function ring(radius, face, growth = false) {
      const points = [], colors = [];
      for (let step = 0; step < segments; step++) {
        const angle = TAU * step / segments, { fan, wave, pleat, reach } = profile(angle);
        const span = radius * reach * (1 + .17 * wave * radius + .017 * Math.sin(3 * angle)) *
          (face === 'inside' ? .945 : face === 'lip' ? .977 : 1 + (growth ? .013 : 0));
        const basin = .09 + (.19 + .17 * fan) * radius ** 1.78;
        const corrugation = .345 * wave * radius ** (face === 'outside' ? 1.08 : 1.32);
        const height = basin + corrugation + (face === 'outside' ? -.09 + .057 * radius - (growth ? .01 : 0) : face === 'lip' ? .008 : 0);
        points.push([-.04 + span * Math.sin(angle) * 1.12 + .04 * radius ** 2, height, -.23 + span * Math.cos(angle) * .83]);
        const tone = profile(angle + Math.PI / segments).pleat;
        colors.push(face === 'lip' ? mix(0xddc8a6, 0xffefd4, .4 + .55 * tone) : face === 'inside'
          ? mix(0xa09392, 0xfdf1d9, .19 + .18 * radius + .18 * (1 - fan) + .43 * tone * fan)
          : mix(growth ? 0x928472 : 0xa89b8c, growth ? 0xcfc0a5 : 0xe5d5b8, .20 + .54 * tone + .06 * pleat));
      }
      rings.push({ points, colors });
    }
    for (const radius of [.16,.34,.53,.71,.87,1]) ring(radius, 'inside');
    ring(1, 'lip');
    for (const radius of [1,.88,.852,.73,.699,.56,.532,.37,.18]) ring(radius, 'outside', [.88,.73,.56].includes(radius));
    const inner = rings[0], outer = rings[rings.length - 1];
    for (let step = 0; step < segments; step++) {
      const next = (step + 1) % segments;
      tri([-.04,.09,-.23], inner.points[step], inner.points[next], inner.colors[step]);
      for (let layer = 1; layer < rings.length; layer++) {
        const from = rings[layer - 1].points, to = rings[layer].points;
        quad(from[step], to[step], to[next], from[next], rings[layer].colors[step]);
      }
      tri([-.04,0,-.23], outer.points[next], outer.points[step], outer.colors[step]);
    }
  });
  // Closed, tapered sections: [x, y, z, half-width, half-height]. Unlike a tube, a tooth or
  // a pincer can flatten and broaden independently as it bends. The end caps are part of the loft.
  function taper(g, path, paint, facets = 8, up = [0,1,0]) {
    const pts = path.map(p => v(p.slice(0,3)));
    const rows = path.map(([, , , w, h = w], i) => {
      const axis = pts[Math.min(i+1, pts.length-1)].clone().sub(pts[Math.max(0,i-1)]).normalize();
      const side = axis.clone().cross(v(up)).normalize(), lift = side.clone().cross(axis);
      return cycle(facets, a => pts[i].clone().addScaledVector(side,w*Math.cos(a)).addScaledVector(lift,h*Math.sin(a)).toArray());
    });
    g.loft(rows, typeof paint === 'number' ? () => paint : paint);
  }

  model('crab_molt_claw', g => {
    // Start inside the broken wrist, turn over its jagged lip, then swell into the palm.
    const sections = [[-.26,.088,.12],[-.49,.125,.148],[-.50,.15,.17],[-.35,.145,.16],
      [-.22,.205,.245],[-.04,.218,.25],[.10,.15,.19],[.16,.09,.12]];
    g.loft(sections.map(([x,h,w], j) => cycle(18, a => [x+(j===1||j===2?.021*Math.cos(5*a):0),
      .22+h*Math.sin(a), w*Math.cos(a)+.14*x])), (r,i) => r<1?0x7a5048:r===1?0xf3d1aa:
      blend(0xb94c35,0xf6aa75,.22+.5*(1+Math.sin(i*TAU/18))/2+.10*Math.cos(2*i+r)));
    for (const [path, movable] of [
      [[[.015,.18,.085,.14,.13],[.16,.17,.15,.11,.094],[.34,.16,.21,.078,.061],[.49,.17,.207,.046,.043],[.59,.19,.136,.009,.012]],false],
      [[[.07,.24,-.095,.126,.115],[.16,.30,-.18,.097,.094],[.29,.34,-.206,.078,.069],[.43,.33,-.16,.049,.046],[.54,.285,-.054,.010,.014]],true],
    ]) taper(g,path,(r,i)=>r>=3?0xffefdb:r===2?0xf1c7a0:movable&&i<4?0xcd6145:0xdd7853,10);
    for (const [x,y,z,side] of [[.30,.18,.15,-1],[.39,.17,.17,-1],[.28,.32,-.145,1],[.37,.33,-.13,1]])
      g.beam([x,y,z],[x+.018,y+.006,z+.057*side],.034,.006,0xf3cda7,5);
    for (const [x,y,z,r] of [[-.22,.405,-.02,.028],[-.15,.416,-.045,.022],[-.08,.425,-.07,.019]])
      ell(g,[x,y,z],[r,r*.52,r*.84],0xf5b78c);
  });

  model('drift_cork', g => {
    const n = 24, profile = [[-.48,.20],[-.455,.237],[-.36,.249],[-.20,.26],[-.06,.266],
      [.045,.271],[.12,.276],[.25,.28],[.39,.284],[.45,.263],[.47,.224]];
    const grain = (j,i) => .5+.5*Math.sin(7.83*i+2.19*j)*Math.cos(2.71*i-3.17*j);
    g.loft(profile.map(([x,r], j) => cycle(n,(a,i) => {
      const radius=r*(.98+.022*Math.cos(a*3)+.015*grain(j,i));
      return [x+.009*Math.sin(3*a+.2*j),.29-.038*x+radius*Math.sin(a),radius*Math.cos(a)];
    })), (j,i) => j===4||j===5 ? (grain(j,i)>.77?0xc39970:blend(0xa34439,0xbc6150,grain(j,i))) :
      j<0||j===profile.length-1 ? 0xc79b6a : blend(0xb0865f,0xd4ad7c,grain(j,i)));
    // Tangential lenticels and dark elongated pits in the exposed end grain.
    for (const [x,a,len] of [[-.31,.56,.075],[-.18,1.26,.068],[-.29,2.01,.036],[.22,.70,.091],
      [.32,1.68,.048],[.18,2.6,.061],[-.32,4.1,.056],[.25,5.6,.05],[-.14,0,.044]]) {
      const r=.269+.04*x, p=[x,.29-.038*x+r*Math.sin(a),r*Math.cos(a)];
      g.add(new THREE.SphereGeometry(1,7,4).scale(len,.013,.012).rotateX(-a).translate(...p),0x82583d);
    }
    for(const s of [-1,1]) for(const [y,z,w] of [[.082,-.055,.05],[-.091,.035,.034],[.014,.106,.027],[-.04,-.113,.04]])
      ell(g,[s<0?-.482:.473,.29-.018*s+y,z],[.009,.012,w],0x896341);
  });

  model('sea_bamboo', g => {
    const n=18, profile=[[-.55,.127],[-.48,.135],[-.35,.14],[-.33,.165],[-.29,.17],[-.265,.145],
      [-.09,.151],[.08,.149],[.125,.173],[.167,.178],[.202,.15],[.38,.144],[.51,.132]];
    const surface=(x,r,a) => [x,.16+.09*x*x+r*Math.sin(a),.074*Math.sin(3*x)+r*Math.cos(a)];
    const rows=profile.map(([x,r],j)=>cycle(n,a=>surface(x+(j===0||j===profile.length-1?.024:.010)*Math.sin(3*a+.4*j),r*(1+.033*Math.cos(5*a)),a)));
    const inner=rows.map((row,j)=>row.map(([x,y,z],i)=>surface(x,profile[j][1]*.69,TAU*i/n)));
    for(let j=0;j<rows.length;j++) for(let i=0;i<n;i++) {
      const k=(i+1)%n, a=(i+.5)*TAU/n, out=[0,Math.sin(a),Math.cos(a)];
      if(j+1<rows.length) {
        const col=[3,8].includes(j)?0xc49a61:[2,7].includes(j)?0xe4c997:[4,9].includes(j)?0x94754d:blend(0xc4a576,0xdcca9f,(1+Math.cos(5*a+.34*j))/2);
        g.quad(rows[j][i],rows[j][k],rows[j+1][k],rows[j+1][i],col,out);
        g.quad(inner[j][i],inner[j][k],inner[j+1][k],inner[j+1][i],i%3?0x897455:0x9e8761,out.map(x=>-x));
      }
      if(!j||j===rows.length-1) g.quad(rows[j][i],rows[j][k],inner[j][k],inner[j][i],i%3?0xe9d5a7:0xf5e7c3,[j?1:-1,0,0]);
    }
  });

  model('fan_alga', g => {
    const arcs=32, radii=[.045,.20,.32,.365,.50,.54,.70,.745,.875,.916,1];
    const band=[0x627a49,0x79945c,0xadc68a,0x668553,0xa7c188,0x658358,0xb8ca88,0x627f53,0xacc488,0x728d57];
    const point=(t,i,back) => {
      const a=-1.33+2.63*i/arcs, lobe=.045*Math.cos(9*a+.35)+.026*Math.sin(4*a);
      const r=t*(1+t*lobe), fold=.040*Math.cos(9*a+.35)*t**1.3;
      return [.66*r*Math.sin(a)+.035*t*t,.057+.115*t*t+fold+(back?-.015-.016*(1-t):0),.40-.85*r*Math.cos(a)];
    };
    for(let j=0;j+1<radii.length;j++) for(let i=0;i<arcs;i++) {
      const t=radii[j],u=radii[j+1];
      for (const back of [false,true]) {
        const col=blend(band[j],back?0x475d40:0xb3bd76,back?.51:.08*(1+Math.cos(i*1.4)));
        g.quad(point(t,i,back),point(t,i+1,back),point(u,i+1,back),point(u,i,back),col,[0,back?-1:1,0]);
      }
      if(j===radii.length-2) g.quad(point(u,i,false),point(u,i+1,false),point(u,i+1,true),point(u,i,true),0xc1ce92,[Math.sin(-1.33+2.63*i/arcs),0,-Math.cos(-1.33+2.63*i/arcs)]);
      if(j===0) g.quad(point(t,i,false),point(t,i+1,false),point(t,i+1,true),point(t,i,true),0x677e4c,[0,0,1]);
      for(const side of [0,arcs]) if(i===(side?arcs-1:0)) g.quad(point(t,side,false),point(u,side,false),point(u,side,true),point(t,side,true),0xa5b67c,[side?1:-1,0,1]);
    }
    taper(g,[[-.075,.041,.54,.036],[-.025,.045,.48,.032],[.007,.05,.40,.029],[0,.065,.33,.047,.019]],0x697947);
  });

  model('mermaid_comb', g => {
    const arc=t=>-.30+.28*t*t, width=t=>.035+.091*(1-t*t);
    const path=Array.from({length:19},(_,i)=>{const t=(i-9)/9; return [.565*t,.092,arc(t),width(t),.041+.021*(1-t*t)];});
    taper(g,path,(j,i)=>i<2||i===7?0xca8236:i===2?0xf3c16c:i===3?0xdc9847:0xa66631,8);
    for(const offset of [-.60,.45]) {
      const line=path.slice(1,-1).map(([x,y,z,w,h])=>[x,y+h*.88,z+w*offset]);
      strand(g,line,.009,offset<0?0xffdc8b:0x965a32,4,18);
    }
    for(let i=0;i<13;i++) {
      const t=(i-6)/6,x=t*.49,z=arc(x/.565)+.04,len=.485-.15*t*t;
      // Two worn stubs, separated by intact teeth. Keep the gaps open at thumbnail size.
      const broken=i===3||i===9;
      const tooth=broken?[[x,.089,z,.031,.027],[x+.008*t,.080,z+.094,.029,.020],[x+.012*t,.078,z+.104,.021,.012]]:
        [[x,.088,z,.034,.028],[x+.015*t,.078,z+.13,.029,.022],[x+.045*t,.056,z+len*.75,.022,.017],[x+.062*t-.009,.049,z+len,.008,.010]];
      taper(g,tooth,(r,i)=>broken&&r>0?0xeac17f:i<3?0xe0a34c:0xc98a3d,7);
    }
    for(const x of [-.40,0,.40]) {
      const z=arc(x/.565); ell(g,[x,.148-.018*(x/.40)**2,z],[.026,.011,.021],0xffcf7d);
    }
  });

  model('gooseneck_cluster', g => {
    const rock=rings([[.01,.26,.13],[.07,.32,.17],[.13,.20,.116]],10,
      ([x,y,z],a)=>[x+.038*Math.cos(3*a),y+.016*Math.cos(2*a),z]);
    g.loft(rock,(r,i)=>blend(0x504b45,0x7c7461,.5+.38*Math.cos(3*i+r)));
    for(const [x,z,s,lean,yaw] of [[-.105,.015,.83,-.23,-.30],[.0,-.08,1,.06,.28],[.13,.085,.72,.22,-.12]]) {
      const stem=t=>[x+lean*t*t-.065*s*Math.sin(TAU*t),.08+.42*s*t,z+.06*s*Math.sin(Math.PI*t)];
      const rows=Array.from({length:10},(_,i)=>{const t=i/9,r=s*(.067+.014*Math.sin(t*Math.PI)+.006*(i%2));return [...stem(t),r,r*.85];});
      taper(g,rows,(r,i)=>r%3===1?0x684635:i%4<2?0x44342f:0x584039,8,[0,0,1]);
      const [cx,cy,cz]=stem(1), bend=lean*.52;
      // Mirrored porcelain valves around a real dark gape; each has a raised keel and a warm lip.
      const outline=[[-.075,-.035],[-.125,.072],[-.109,.204],[-.042,.303],[.046,.354],[.105,.231],[.124,.107],[.064,.013]];
      const at=(u,h,d)=>[cx+s*(u*Math.cos(yaw)+d*Math.sin(yaw)+bend*h),cy+s*h,cz+s*(-u*Math.sin(yaw)+d*Math.cos(yaw))];
      for(const side of [-1,1]) {
        const rim=outline.map(([u,h])=>at(u,h,side*(.019+.021*h))),
          shoulder=outline.map(([u,h])=>at(u*.89,.015+h*.93,side*.052)), peak=at(-.027,.157,side*.108);
        const out=[side*Math.sin(yaw),0,side*Math.cos(yaw)];
        for(let i=0;i<rim.length;i++) {
          const k=(i+1)%rim.length, dir=[(outline[i][0]+outline[k][0])*4,(outline[i][1]+outline[k][1])*.5-.15,0];
          g.quad(rim[i],rim[k],shoulder[k],shoulder[i],i===3||i===4?0xd8ae77:0xc5bbaa,dir);
          g.tri(peak,shoulder[i],shoulder[k],[0xdad8c8,0xf0eee1,0xfff9e7,0xf2ecdc,0xe0dcca,0xc6c5bb,0xece4d1,0xcec8b9][i],out);
          g.tri(at(0,.155,side*.015),rim[i],rim[k],0x625348,out.map(n=>-n));
        }
        const seam=[[-.105,.11,.055],[-.027,.157,.109],[.074,.23,.071]];
        strand(g,seam.map(([u,h,d])=>at(u,h,side*d)),.005*s,0xa69782,4,4);
      }
    }
  });

  model('crinoid_crown', g => {
    const outline=[[-.54,-.24],[-.36,-.47],[-.03,-.51],[.32,-.45],[.52,-.29],[.55,.07],[.41,.33],[.16,.45],[-.27,.41],[-.51,.22]];
    const faceY=(x,z)=>.127-.043*z+.019*x;
    const rows=[[.84,-.11],[1,-.078],[.975,-.048],[1,-.029],[.933,0]].map(([s,dy])=>outline.map(([x,z])=>[x*s,faceY(x*s,z*s)+dy,z*s]));
    g.loft(rows,(r,i)=>r<0?0x55616b:r>=4?0x536572:blend([0x414d59,0x879197,0x505f6a,0x71808a][r],0x9ba4a5,.15*(1+Math.cos(i*3))));
    const fossil=(x,z,h=.017)=>[x,faceY(x,z)+h,z];
    // Trace five splayed feather arms. Each pinnule grows from its own station on a curved arm.
    const base=[-.025,.14];
    for(const [a,len,curl] of [[-1.07,.43,-.14],[-.57,.56,-.12],[-.10,.58,.12],[.40,.54,.19],[.93,.49,.17]]) {
      const point=t=>[base[0]+len*(Math.sin(a)*t+curl*t*t),base[1]-len*Math.cos(a)*t+.055*t*t];
      const arm=Array.from({length:9},(_,i)=>{const t=i/8; return [...fossil(...point(t)),.023-.017*t,.013-.007*t];});
      taper(g,arm,(j,i)=>j%3===0?0xc7ae84:i<4?0xe0cba2:0xad9475,6);
      for(let j=1;j<=6;j++) for(const side of [-1,1]) {
        const t=(j+.10*side)/7.5,[x,z]=point(t), l=(.043+.035*Math.sin(t*Math.PI))*(1-.24*t), angle=a+side*.82;
        const dx=l*Math.sin(angle), dz=-l*Math.cos(angle);
        taper(g,[[...fossil(x,z,.016),.012,.009],[...fossil(x+.52*dx,z+.52*dz,.016),.010,.008],
          [...fossil(x+dx,z+dz,.014),.0025,.004]],j%3?0xcbb58c:0xe4d0aa,3);
      }
    }
    for(let i=0;i<5;i++) ell(g,fossil(-.021+.008*i,.186+.034*i),[.032-i*.002,.014,.019],i%2?0xbea582:0xe1c49c);
    g.loft(rings([[.012,.029,.03],[.035,.066,.062],[.061,.053,.049]],8,
      ([x,y,z])=>[x+base[0],faceY(x+base[0],z+base[1])+y,z+base[1]]),(r,i)=>i%2?0xd9c199:0xb39776);
  });

  model('wreck_compass', g => {
    const bronze=0x986a43, bright=0xcd9d64, patina=0x60887b, dial=0xe6d6ae, ink=0x413d39;
    g.loft(rings([[.012,.325,.325],[.038,.395,.395],[.075,.414,.414],[.153,.415,.415],
      [.18,.40,.40],[.186,.353,.353],[.158,.335,.335]],32),(r,i)=>r===6?dial:r===4?bright:r===5?0x63533f:
      (i+2*r)%11===0?patina:r===2?0x805d42:bronze);
    const at=(a,r,h)=>[r*Math.sin(a),h,-r*Math.cos(a)], north=.28;
    for (let i=0;i<32;i++) {
      const a=north+i*TAU/32, major=i%4===0, w=major?.024:.015, r=major?.249:.284;
      g.quad(at(a-w,.315,.1595),at(a+w,.315,.1595),at(a+w,r,.1595),at(a-w,r,.1595),ink,[0,1,0]);
    }
    for (let i=0;i<8;i++) {
      const a=north+i*TAU/8, tip=at(a,i%2?.151:.207,.161);
      g.tri([0,.161,0],at(a-.54,.058,.161),tip,0x99876a,[0,1,0]);
      g.tri([0,.161,0],tip,at(a+.54,.058,.161),0xc0a77e,[0,1,0]);
    }
    const d=(x,z,h)=>[x*Math.cos(north)-z*Math.sin(north),h,x*Math.sin(north)+z*Math.cos(north)];
    const strokes=[[-.031,-.236],[-.031,-.297],[.011,-.238],[.011,-.297]];
    for(let i=1;i<strokes.length;i++) g.beam(d(...strokes[i-1],.166),d(...strokes[i],.166),.007,.007,ink,5);
    for(const [z,left,right] of [[-.229,0xae3028,0xe84835],[.218,0x33566a,0x547687]]) {
      const tip=d(0,z,.177), hub=d(0,0,.209);
      g.tri(d(-.048,0,.177),hub,tip,left,[0,1,0]); g.tri(tip,hub,d(.048,0,.177),right,[0,1,0]);
      g.tri(d(-.048,0,.177),d(.048,0,.177),tip,0x825942,[0,-1,0]);
    }
    ell(g,[0,.204,0],[.033,.021,.033],bright);
    // Hinge across the rear edge. The negative local Y face of the lid faces the open dial.
    const angle=1.73,c=Math.cos(angle),s=Math.sin(angle);
    const lid=([x,y,z])=>[x,.17+y*c+(z+.36)*s,-.372-y*s+(z+.36)*c];
    const lidRows=rings([[-.027,.27,.27],[-.028,.312,.312],[-.046,.325,.325],[-.045,.35,.35],
      [-.009,.373,.373],[.033,.344,.344],[.069,.22,.22]],28).map(row=>row.map(lid));
    g.loft(lidRows,(r,i)=>r<0?0x8e7754:r===0?0xaf8556:r===1?0x6a7460:r===2?bright:(i+3*r)%13<2?patina:bronze);
    const front=[0,-c,s];
    for(let i=0;i<8;i++) {
      const a=i*TAU/8,atL=(a,r,y)=>lid([r*Math.cos(a),y,r*Math.sin(a)]), tip=atL(a,i%2?.12:.215,-.032);
      g.tri(lid([0,-.037,0]),atL(a-.41,.067,-.032),tip,0x755e42,front);
      g.tri(lid([0,-.037,0]),tip,atL(a+.41,.067,-.032),0xc59a62,front);
    }
    for(let i=0;i<3;i++) g.beam([-.22+i*.15,.159,-.348],[-.081+i*.15,.159,-.348],.045,.045,i===1?patina:bright,10);
    g.add(new THREE.TorusGeometry(.07,.017,6,16).rotateX(Math.PI/2).translate(0,.093,.423),bronze);
  });

  model('amber_shrimp', g => {
    // A dark honey rind surrounding a paler interior, not an opaque rock with a shrimp on top.
    const outline=[[-.52,-.18],[-.34,-.37],[.01,-.42],[.34,-.33],[.49,-.14],[.46,.17],[.22,.36],[-.09,.40],[-.43,.26]];
    const ring=(s,y,dx=0)=>outline.map(([x,z],i)=>[dx+s*x,y+.014*Math.cos(2.1*i),s*z]);
    const bottom=ring(.71,.025), flank=ring(1,.13), shoulder=ring(.93,.26), crown=ring(.73,.345,.014);
    g.loft([bottom,flank,ring(.83,.113)],(r,i)=>r===2?0xf2ba63:r===1?0xb6742a:r<0?0xb87827:i%3?0xcc8733:0xe7a545);
    // Carapace, rostrum and a segmented abdomen curling under towards the tail fan.
    const body=[[-.227,.213,-.051,.055,.044],[-.16,.218,-.091,.097,.069],[-.055,.221,-.126,.106,.072],
      [.052,.215,-.111,.087,.056],[.143,.205,-.064,.077,.052],[.191,.200,.018,.063,.043],
      [.177,.199,.092,.051,.038],[.109,.199,.149,.041,.031],[.034,.198,.161,.029,.024]];
    taper(g,body,(r,i)=>r<2?i<4?0x9e462c:0xcb6836:r%2?0x98442d:0xb85b32,10);
    for(let j=3;j<=7;j++) {
      const [x,y,z,w,h]=body[j], prev=body[j-1], ang=Math.atan2(z-prev[2],x-prev[0]);
      const arc=Array.from({length:7},(_,i)=>{const t=Math.PI*i/6;return [x-w*Math.sin(ang)*Math.cos(t),y+h*Math.sin(t),z+w*Math.cos(ang)*Math.cos(t)];});
      strand(g,arc,.007,0xe2a45b,4,6);
    }
    taper(g,[[-.20,.226,-.061,.039,.023],[-.268,.230,-.038,.022,.013],[-.321,.235,-.059,.005,.005]],0xb1542e,6);
    ell(g,[-.218,.252,-.045],[.023,.017,.022],0x513b2d);
    for(const [x,z,tip] of [[-.18,-.027,.104],[-.124,-.009,.14],[-.065,-.016,.141],[-.005,-.026,.126],[.06,-.011,.112]]) {
      taper(g,[[x,.209,z,.014],[x-.026,.193,z+.045,.011],[x-.065,.182,tip-.023,.009],[x-.088,.185,tip,.004]],0x8b462c,5);
    }
    for(const [dx,dz] of [[-.100,-.036],[-.122,.016],[-.077,.066]])
      taper(g,[[.037,.201,.16,.018,.014],[.037+dx*.62,.198,.16+dz*.62,.027,.014],[.037+dx,.202,.16+dz,.009,.006]],0xb65a32,6);
    strand(g,[[-.218,.224,-.055],[-.300,.218,-.112],[-.339,.202,-.195],[-.303,.196,-.263]],.008,0x874727,5,9);
    strand(g,[[-.230,.222,-.047],[-.322,.207,-.023],[-.378,.202,.041],[-.368,.194,.099]],.007,0xa2522c,5,8);
    // Air bubbles trapped off the animal, below the cut facets.
    for(const [x,z,r] of [[.275,-.15,.023],[.298,-.115,.011],[-.28,.172,.016]])
      ell(g,[x,.232,z],[r,r*.63,r],0xfad898);
    g.beginSkin();
    for(let i=0;i<outline.length;i++) {
      const k=(i+1)%outline.length, out=[outline[i][0],.2,outline[i][1]];
      g.quad(flank[i],flank[k],shoulder[k],shoulder[i],i%3?0xf0a13d:0xffce70,out);
      g.quad(shoulder[i],shoulder[k],crown[k],crown[i],i%3?0xf7bc58:0xffdb8f,[out[0],1,out[2]]);
      g.tri(crown[i],crown[k],[.035,.373,-.037],i%4===1?0xffe7a5:0xffcb69,[0,1,0]);
    }
  });

  model('silver_sail_badge', g => {
    // Stamped sheet: the sail ridges are folds in the metal, with a matching reverse and rolled edges.
    function sheet(outline, peak, face, back=0x768187) {
      const under=([x,y,z])=>[x,y-.032,z], rim=outline.map(under);
      for(let i=0;i<outline.length;i++) {
        const k=(i+1)%outline.length,a=outline[i],b=outline[k];
        g.tri(peak,a,b,face[i%face.length],[0,1,0]); g.tri(under(peak),rim[i],rim[k],back,[0,-1,0]);
        const mx=(a[0]+b[0])/2-peak[0],mz=(a[2]+b[2])/2-peak[2];
        g.quad(a,b,rim[k],rim[i],0x899598,[mx,0,mz]);
      }
    }
    const boom=[.006,.092,.225], mast=[-.046,.088,-.488];
    taper(g,[[...boom,.023],[.001,.103,-.099,.020],[...mast,.012]],0x9ca6a5,7);
    sheet([[-.033,.105,-.42],[-.066,.125,-.10],[-.055,.122,.141],[-.394,.092,.169],[-.284,.101,-.012]],
      [-.135,.207,.034],[0xe6e8df,0xb1bdbf,0x96a5ac,0xd8dedb,0xeef0df]);
    sheet([[-.016,.115,-.386],[.149,.124,-.178],[.329,.094,.088],[.365,.082,.132],[.041,.111,.095]],
      [.110,.245,-.004],[0xc5d2d3,0xf2f1dd,0xa6b3b8,0x81939d,0xa5b6bf]);
    sheet([[-.441,.095,.184],[-.203,.115,.208],[.095,.109,.180],[.469,.092,.126],
      [.377,.095,.246],[.255,.10,.326],[-.266,.095,.358],[-.363,.086,.298]],
      [-.015,.145,.259],[0xdce0d8,0xc5cfcc,0xdde3dc,0x92a0a5,0x88989f,0xb3bfc0,0x8f9fa5,0xbac6c6]);
    strand(g,[[-.365,.107,.26],[-.218,.126,.286],[.03,.135,.265],[.246,.120,.231],[.385,.102,.183]],.009,0x697e88,5,8);
    // Two actual clinched rivets on the back of the hull, flush when the badge lies on a shelf.
    for(const x of [-.213,.203]) {
      g.beam([x,.023,.26],[x,.102,.26],.042,.043,0x7d898c,10);
      g.loft(rings([[.005,.032,.032],[.015,.054,.054],[.032,.055,.055],[.044,.039,.039]],12,
        ([u,y,z])=>[u+x,y,z+.26]),(r,i)=>r<0?0xcbd0ca:r===1?0x929d9b:i%4?0xb5bfbb:0xd1d6cc);
    }
  });

  const finishes = { red_coral: .64, opal_ammonite: .32, mermaids_eye: .43, violet_snail: .48, sea_pottery: .45, foil_wrapper: .48, green_sea_glass: .58, blue_glass_float: .34, rainbow_abalone: .44, sea_bean: .63, crushed_can: .56, giant_clam: .58,
    crab_molt_claw:.57, sea_bamboo:.76, fan_alga:.60, mermaid_comb:.35, gooseneck_cluster:.55, wreck_compass:.53, amber_shrimp:.38, silver_sail_badge:.36 };
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
    const roughness = finishes[k.id] ?? ({ jade_branch:.33, dragon_pearl:.19, swallow_cowrie:.28, stone_bowl:.73, treasure_shell:.24 })[k.id] ?? .88;
    const metalness = ({treasure_shell:.38, wreck_compass:.27, silver_sail_badge:.55})[k.id] || 0;
    const resin = k.id === 'amber_shrimp', key = [roughness, metalness, resin].join(':');
    if (!materials.has(key)) {
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
      if (resin) {
        // Two opacity values, one draw. The standard material (including its turntable clone)
        // keeps this mask when a pattern replaces the mesh's RGB attribute.
        const mask = new THREE.DataTexture(new Uint8Array([255,255,255,255, 48,48,48,255]),2,1);
        mask.needsUpdate = true; mask.userData.shared = true;
        material.alphaMap = mask; material.transparent = true;
      }
      material.name = 'V3.washupCatalog.' + key; material.userData.shared = true;
      materials.set(key, material);
    }
    return materials.get(key);
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
