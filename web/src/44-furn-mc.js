// src/44-furn-mc.js — P5：做成模组方块的家具的规格（V3.furnMc）。纯数据 + 几个小函数，不碰 THREE / DOM，Node 里也能加载。
// 约定见 docs/FURNITURE.md：模型「正面朝北」（正面在 −z），blockstate 用 y 旋转（north 0、east 90、south 180、west 270）。
// 坐标：cells 的 offset 是朝北时这一格相对主格的 [dx, dy, dz]（格）；slots 是朝北时主格方块内的坐标（单位格，主格的西北下角是 0，
// 可以超出 0..1 落到别的格里）。主格 = offset [0,0,0] 的那格：床是床头（和原版床一样只有它掉东西），贝壳柜是 left，餐桌就是自己。
// 用的人：web/tools/furn-mc.mjs（体素 → .bbmodel → MC 资源）、54-house-mc（部件名字）、57-shell-display（贝壳摆进格子）、测试。
(function (V3) {
  'use strict';
  const FACINGS = ['north', 'east', 'south', 'west'];
  const FACING_Y = { north: 0, east: 90, south: 180, west: 270 };

  // 每件：
  //   id        工具里用的名字（= 方块路径，文件名都用它：models/furniture/<id>.bbmodel、textures/block/<id>.png …）
  //   block     方块 id
  //   label     中文名（部件树、2D 反馈图上用）
  //   layout    V3.layout 里的 { layer, id }（体素版从这里来：56-furn-ground / 57-furn-loft 的同名家具）
  //   rot       体素版（正面朝 +z）转成朝北模型要绕 y 转的角度：180 = 正面转到北边；床是 0（体素的床头本来就在 −z，facing = 床尾 → 床头）
  //   align     模型在格子里怎么放（比格子小的方向）：'center' 居中；'back' 贴着背面（+z，靠墙的家具）
  //   facing    在房子里（V3.layout 的摆法）用的 facing，和体素版的朝向一样
  //   size      占几格 [x 宽, y 高, z 深]（朝北）
  //   cells     [{ part, offset }]：part 是 blockstate 的 part 值，单格的家具是 null
  //   models    part（单格的用 'main'）→ 方块模型名；item = 物品模型名；texture = 贴图名
  const LIST = [
    {
      id: 'bed', block: 'xiaojingyu:bed', label: '床', layout: { layer: 'ground', id: 'bed' },
      rot: 0, align: 'center', facing: 'north', size: [1, 1, 2],
      cells: [{ part: 'head', offset: [0, 0, 0] }, { part: 'foot', offset: [0, 0, 1] }],
      models: { head: 'xiaojingyu:block/bed_head', foot: 'xiaojingyu:block/bed_foot' },
      item: 'xiaojingyu:item/bed', texture: 'xiaojingyu:block/bed',
      // 她躺进这张床时网页里藏起来的东西（叠好的睡衣、枕头上的睡帽）。MC 的资源不动（MC 里一直摆着）；网页里 54-house-mc 把这些元素
      // 从房子网格里拿出来单独画一份，睡着时藏（V3.houseBlocks.setSleeper）。parts：part → 导出的方块模型（models/block/bed_*.json）里
      // 元素的下标 = models/furniture/bed.bbmodel 里这一格 group 中叫「睡帽」「睡衣」的元素（导出按 group 里的顺序一个一个写，
      // test/bed-props.test.mjs 对着 .bbmodel 的名字查）；total = 这一格模型的元素数，模型对不上（改过 .bbmodel 没改这里）就不拆，照旧一直画
      sleepProps: { label: '睡衣和睡帽', parts: { head: [13, 14, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31], foot: [7] }, total: { head: 32, foot: 8 } },
    },
    {
      id: 'dining_table', block: 'xiaojingyu:dining_table', label: '餐桌', layout: { layer: 'ground', id: 'dining' },
      rot: 180, align: 'center', facing: 'south', size: [1, 1, 1],
      cells: [{ part: null, offset: [0, 0, 0] }],
      models: { main: 'xiaojingyu:block/dining_table' },
      item: 'xiaojingyu:item/dining_table', texture: 'xiaojingyu:block/dining_table',
    },
    {
      id: 'shell_case', block: 'xiaojingyu:shell_case', label: '贝壳收集柜', layout: { layer: 'loft', id: 'shellCase' },
      rot: 180, align: 'back', facing: 'east', size: [2, 1, 1],
      cells: [{ part: 'left', offset: [0, 0, 0] }, { part: 'right', offset: [-1, 0, 0] }],   // 站在正面前看：left 在左手（朝北时是东边 +x）
      models: { left: 'xiaojingyu:block/shell_case_left', right: 'xiaojingyu:block/shell_case_right' },
      item: 'xiaojingyu:item/shell_case', texture: 'xiaojingyu:block/shell_case',
      // 12 个展示格的中心（朝北、主格 left 的方块内坐标，单位格）：上排 → 下排，每排从左到右（站在正面前看）。
      // 来自 57-furn-loft 的 SLOT_X = [−21, −7, 7, 21]、SLOT_F = [24, 17, 10]（体素），按 rot 180、贴背面换算（test/furn-mc.test.mjs 查）。
      slots: [0.859375, 0.640625, 0.421875].flatMap((y) => [0.671875, 0.234375, -0.203125, -0.640625].map((x) => [x, y, 0.75])),
      slotSize: [0.40625, 0.15625, 0.375],   // 每格里面的 [宽 x, 高 y, 深 z]（格）：体素 13 × 5 × 12 格
    },
  ];

  // ---- 第 2 轮（docs/FURNITURE.md 8.1、8.2）：通用的多格家具 ----
  // part 是整数：朝北时本地格子 cx = 0..w−1（往 +x）、cz = 0..d−1（往 +z，往后）、cy = 0..h−1（往上），part = cx + w × (cz + d × cy)，
  // 主格 part 0 = 朝北时正面、最西、最下那格；单格的没有 part（状态只有 facing）。模型名 xiaojingyu:block/<id>（单格）或 <id>_<part>。
  // 体素版都是正面朝 +z，rot 180；体素在格子里的位置照房子里的摆法（house：和 42-house-mc 的 FURN2 一样，[x0, x1]、[y0, y1]、[z0, z1] 场景格子）
  // 和 40-layout 的矩形算出来（工具 furn-mc-vox.mjs 的「场景」换法），所以 align 只是说明。
  //   collide  'box'（这一格模型的外包盒）/ 'thin'（贴地 1/16 格，能走上去）/ 'none'；数组 = 每个 part 一个
  //   light    方块光（0..15），会亮的才有
  //   overlay  网页里叠在方块上的体素版部件：56/57 里的网格名（骨骼名 = 网格 'vox:<骨骼名>'，平面写自己的名字，比如 'pc-screen'）
  //   planes   体素版里不是体素的平面（屏幕、画布）：转 MC 时跳过；画框的画另外画进了体素（模型里有）
  //   layout   体素版（主件）；extra = 合进这一件的别的体素家具（地毯 + 小茶几）；voxRect = 转 MC 时用的矩形（串灯只取一格一段）
  //   mount    怎么放（网页布置模式查「放得下」用，2026-11-07 web6）：不写 = 'floor'（放在地上，下面要有实心方块或者沙地）；
  //            'wall' = 挂墙（每格背后，也就是 facing 反方向那一格，要是墙）；'ceiling' = 吊顶（每格上面要有方块）
  function kind(id, label, layer, src, facing, w, d, h, house, o) {
    const n = w * d * h, cells = [], models = {};
    for (let cy = 0; cy < h; cy++) for (let cz = 0; cz < d; cz++) for (let cx = 0; cx < w; cx++) {
      const part = n > 1 ? cx + w * (cz + d * cy) : null;
      cells.push({ part, offset: [cx, cy, cz] });
      models[part == null ? 'main' : String(part)] = 'xiaojingyu:block/' + id + (part == null ? '' : '_' + part);
    }
    const [xs, ys, zs] = house || [];
    return Object.assign({
      id, block: 'xiaojingyu:' + id, label, layout: { layer, id: src }, rot: 180, align: 'center', facing, size: [w, h, d], w, d, h,
      cells, models, item: 'xiaojingyu:item/' + id, texture: 'xiaojingyu:block/' + id,
      house: house ? { facing, xs, ys, zs } : null, collide: 'box', light: 0, overlay: [], planes: [], round: 2,
    }, o || {});
  }
  const G = 'ground', LO = 'loft';
  LIST.push(
    kind('nightstand', '床头柜', G, 'nightstand', 'south', 1, 1, 1, [[-5, -5], [1, 1], [-15, -15]], { align: 'back' }),
    kind('bookshelf', '书架', G, 'bookshelf', 'south', 1, 1, 2, [[-4, -4], [1, 2], [-15, -15]], { align: 'back' }),
    kind('kitchen_counter', '厨房台面', G, 'kitchen', 'south', 4, 1, 1, [[-2, 1], [1, 1], [-15, -15]],
      { align: 'back', overlay: ['rice'] }),
    kind('spice_rack', '调料罐架', G, 'jars', 'south', 1, 1, 1, [[-1, -1], [2, 2], [-15, -15]], { align: 'back', collide: 'none', mount: 'wall' }),
    kind('mini_fridge', '小冰箱', G, 'fridge', 'south', 1, 1, 1, [[2, 2], [1, 1], [-15, -15]], { align: 'back' }),
    kind('dining_chair', '餐椅', G, 'chairDW', 'east', 1, 1, 1, [[-1, -1], [1, 1], [-12, -12]], { also: [{ layer: G, id: 'chairDE', facing: 'west', xs: [1, 1], ys: [1, 1], zs: [-12, -12] }] }),
    kind('desk', '书桌', G, 'desk', 'east', 2, 1, 1, [[-6, -6], [1, 1], [-11, -10]],
      { align: 'back', light: 10, overlay: ['pc-screen', 'bulb'], planes: ['pc-screen'] }),
    kind('desk_chair', '书桌椅', G, 'deskChair', 'west', 1, 1, 1, [[-5, -5], [1, 1], [-11, -11]]),
    // 画框墙的 6 个小框也能放照片（docs/PHOTOS.md）：photo / photoSlots 见下面第 5 轮的说明；行号 = 56-furn-ground 的 FR 顺序（canvas0..5）
    kind('picture_frames', '画框', G, 'frames', 'east', 2, 1, 1, [[-6, -6], [2, 2], [-11, -10]],
      { align: 'back', collide: 'none', mount: 'wall', planes: ['canvas0', 'canvas1', 'canvas2', 'canvas3', 'canvas4', 'canvas5'],
        photo: '画', photoSlots: [[1, 6.5, 1, 15, 6, 15.5], [1, -4, 1, 4.5, 6, 15.5], [0, 1, 0.5, 10.5, 6.5, 15.5], [1, 6.5, 8.5, 15, 13.5, 15.5], [1, -4.5, 8, 5, 14, 15.5], [0, 1.5, 8.5, 10, 13.5, 15.5]] }),
    kind('rocking_chair', '摇椅', G, 'rocking', 'west', 1, 1, 1, [[-5, -5], [1, 1], [-8, -8]]),
    kind('tv_stand', '电视和电视柜', G, 'tv', 'west', 2, 1, 1, [[5, 5], [1, 1], [-10, -9]], { align: 'back', light: 5, overlay: ['screen'], planes: ['screen'] }),
    kind('sofa', '双人小沙发', G, 'sofa', 'east', 2, 1, 1, [[2, 2], [1, 1], [-10, -9]]),
    // 地毯 2 × 2 + 小茶几（世界格子 (3, 1, −9)，朝南时是 part 1）：茶几那格 box，别的 thin
    kind('living_rug', '地毯和小茶几', G, 'rug', 'south', 2, 2, 1, [[3, 4], [1, 1], [-10, -9]], { collide: ['thin', 'box', 'thin', 'thin'], extra: [{ layer: G, id: 'coffee' }] }),
    kind('floor_plant', '大盆栽', G, 'plantSE', 'south', 1, 1, 1, [[5, 5], [1, 1], [-8, -8]]),
    kind('door_mat', '门口地垫', G, 'mat', 'south', 1, 1, 1, [[-2, -2], [1, 1], [-8, -8]], { collide: 'thin' }),
    kind('photo_album_table', '相册矮桌', LO, 'album', 'south', 1, 1, 1, [[-2, -2], [5, 5], [-11, -11]]),
    kind('floor_cushions', '地垫坐垫', LO, 'cushions', 'south', 2, 1, 1, [[-3, -2], [5, 5], [-10, -10]]),
    kind('window_seat', '窗边坐垫', LO, 'seat', 'north', 2, 1, 1, [[-2, -1], [5, 5], [-8, -8]], { align: 'back' }),
    kind('telescope', '望远镜', LO, 'scope', 'south', 1, 1, 1, [[0, 0], [5, 5], [-8, -8]]),
    kind('storage_chests', '储物箱', LO, 'chests', 'south', 2, 1, 1, [[-3, -2], [5, 5], [-15, -15]], { align: 'back' }),
    kind('beanbag', '懒人沙发', LO, 'beanbag', 'south', 1, 1, 1, [[1, 1], [5, 5], [-9, -9]]),
    // 串灯：一格一段（房子里 x −6..5 一排 12 格，同一个方块），串在这一格的南边上（朝北时的背边）；体素只取最西那一段
    kind('string_lights', '串灯', LO, 'lights', 'north', 1, 1, 1, [[-6, -6], [9, 9], [-12, -12]],
      { align: 'back', collide: 'none', mount: 'ceiling', light: 12, overlay: ['bulb'], voxRect: [-6, -12, -5, -11], repeat: { xs: [-6, 5] } }),
  );

  // ---- 第 3 轮（docs/FURNITURE.md 9.1）：屋外的小物件。状态、part、collide、light 照第 2 轮 ----
  // 体素版在场景部件里（55-house-detail、56-furn-beach、58-plants），vox 说从哪儿取：[{ part: 场景部件 id, name: 物体名, … }]
  //   不带 place：照场景里摆好的位置换（第 2 轮的「场景」换法：40-layout 里的位置就是格子里的位置）；
  //   place: true：不管场景里摆在哪，物体原点放到朝北模型的 at = [u x, u z]（u = 1/32 米，主格西北角是 0；默认占的格子正中间），
  //     正面（体素 +z）转到北边；straight：去掉体素版里的倾斜（遮阳伞）。
  //   reach  模型可以伸出自己那格（MC 允许 −16..32 像素）：伸出去的归最近的那格，没有碰撞，选框也只算自己那格
  //   solid  碰撞只算这些部件（元素名 = 体素 tag 的最后一段）：遮阳伞只有伞杆挡人
  //   glow   发光的部件（元素名）：MC 模型里这些元素 light_emission 15
  //   also   同一种摆在别处的（壁灯 2 盏、多肉 3 处）；layout 是布局里对应的那条（56-furn-beach 的 4 种都在 beachSet 里）
  const OUT = 'outside', PL = 'plants';
  const r3 = (o) => Object.assign({ round: 3 }, o);
  const src = (part, name, o) => Object.assign({ part, name }, o || {});
  LIST.push(
    kind('beach_lounger', '沙滩躺椅（毛巾、人字拖）', OUT, 'beachSet', 'south', 1, 2, 1, [[-11, -11], [0, 0], [4, 5]],
      r3({ vox: [src('furn-beach', 'furn:loungerA', { place: true })] })),
    kind('beach_lounger_hat', '沙滩躺椅（草帽和书）', OUT, 'beachSet', 'south', 1, 2, 1, [[-9, -9], [0, 0], [4, 5]],
      r3({ vox: [src('furn-beach', 'furn:loungerB', { place: true })] })),
    kind('beach_table', '白色独脚小圆桌', OUT, 'beachSet', 'south', 1, 1, 1, [[-10, -10], [0, 0], [4, 4]],
      r3({ vox: [src('furn-beach', 'furn:beachTable', { place: true })] })),
    // 遮阳伞：伞柱 3 格（lead 定），伞面在 y 2 那格，伸出格子盖住两张躺椅；网页整件用体素版（会随风摆）
    kind('beach_parasol', '条纹遮阳伞', OUT, 'beachSet', 'south', 1, 1, 3, [[-10, -10], [0, 2], [5, 5]],
      r3({ vox: [src('furn-beach', 'furn:parasol', { place: true, straight: true })], reach: true, solid: ['伞杆'], overlay: ['*'] })),
    kind('crate_lantern', '木箱和灯笼', OUT, 'chest', 'south', 1, 1, 1, [[8, 8], [0, 0], [-4, -4]],
      r3({ vox: [src('house-detail', 'house2:chest')], light: 12, overlay: ['lamp'], glow: ['灯'] })),
    // 花箱：箱体在 55-house-detail，花在 58-plants，合成一件
    kind('flower_box_purple', '花箱（紫花）', OUT, 'boxW', 'south', 2, 1, 1, [[-5, -4], [1, 1], [-6, -6]],
      r3({ align: 'back', vox: [src('house-detail', 'house2:boxW'), src('plants', 'boxW')] })),
    kind('flower_box_pink', '花箱（粉花）', OUT, 'boxE', 'south', 2, 1, 1, [[1, 2], [1, 1], [-6, -6]],
      r3({ align: 'back', vox: [src('house-detail', 'house2:boxE'), src('plants', 'boxE')] })),
    kind('towel_hook', '毛巾和挂钩', OUT, 'towel', 'south', 1, 1, 1, [[0, 0], [1, 1], [-6, -6]],
      r3({ align: 'back', collide: 'none', mount: 'wall', vox: [src('house-detail', 'house2:towel')] })),
    kind('wind_chime', '贝壳风铃', OUT, 'chime', 'south', 1, 1, 1, [[-2, -2], [3, 3], [-6, -6]],
      r3({ align: 'back', collide: 'none', mount: 'wall', overlay: ['*'], vox: [src('house-detail', 'house2:chime')] })),
    // 门边壁灯：布局里是 V3.layout.lanterns 的两对 [x, z]（不是矩形），lantern0 / lantern1 = 55-house-detail 里的物体名
    kind('wall_lantern', '门边壁灯', 'lanterns', 'lantern0', 'south', 1, 1, 1, [[-3, -3], [2, 2], [-6, -6]],
      r3({ align: 'back', collide: 'none', mount: 'wall', light: 12, overlay: ['lamp'], glow: ['灯'], vox: [src('house-detail', 'house2:lantern0')],
        also: [{ layer: 'lanterns', id: 'lantern1', facing: 'south', xs: [-1, -1], ys: [2, 2], zs: [-6, -6] }] })),
    kind('potted_fern', '盆栽（门廊西角）', PL, 'potW', 'south', 1, 1, 1, [[-7, -7], [1, 1], [-5, -5]],
      r3({ vox: [src('plants', 'potW')] })),
    // 吊篮：方块在东头栏杆柱上面那格，竖杆立在柱头上，吊臂往正面（西）伸出去挂篮子
    kind('hanging_basket', '吊篮', PL, 'potE', 'west', 1, 1, 1, [[7, 7], [2, 2], [-5, -5]],
      r3({ collide: 'none', reach: true, vox: [src('plants', 'potE')] })),
    kind('flower_pot', '花盆（台阶东侧）', PL, 'potStep', 'south', 1, 1, 1, [[1, 1], [0, 0], [-3, -3]],
      r3({ vox: [src('plants', 'potStep')] })),
    // 多肉：一格两小盆（58-plants 的 succ0、succ1 两盆摆进一格），一种方块摆 3 处
    kind('succulents', '多肉小盆栽', OUT, 'succ', 'south', 1, 1, 1, [[-4, -4], [0, 0], [-3, -3]],
      r3({ vox: [src('plants', 'succ0', { place: true, at: [9, 10] }), src('plants', 'succ1', { place: true, at: [23, 22] })],
        also: [{ layer: OUT, id: 'succ', facing: 'south', xs: [0, 0], ys: [0, 0], zs: [-3, -3] }, { layer: OUT, id: 'succ', facing: 'south', xs: [1, 1], ys: [2, 2], zs: [-4, -4] }] })),
    kind('step_mat', '台阶下地垫', OUT, 'stepMat', 'south', 2, 1, 1, [[-2, -1], [0, 0], [-2, -2]],
      r3({ collide: 'thin', vox: [src('house-detail', 'house2:stepMat')] })),
  );

  // ---- 第 5 轮（docs/PHOTOS.md，2026-11-07 web7）：单个的相框。不在默认房子里（house: null，生成器不放），布置模式的清单里有 ----
  //   make        体素版不在布局里，用 V3.furn.makers[make](ctx) 直接建（56-furn-ground；转模型的工具 furn-mc-vox 的 buildVoxel 认它）
  //   photo       放照片的元素名：.bbmodel 里叫这个名字的元素，它们朝 −z 的面就是照片那块（export 按它算 photoSlots，写进 FurnitureShapes.java）
  //   photoSlots  和 FurnitureShapes.java 的 Kind.photoSlots() 一样的数（test/furn-mc.test.mjs 查）：每行 [part, x0, y0, x1, y1, z]，
  //               朝北的模型里、相对这一格（part，单格的是 0）的像素；z 是那个面的位置。画法（往 −z 挪 0.01、正着贴、cover 裁剪）见 PHOTOS.md 第 3 节
  LIST.push(
    kind('photo_frame', '相框', G, 'photoFrame', 'south', 1, 1, 1, null,
      { round: 5, align: 'back', collide: 'none', mount: 'wall', make: 'photoFrame', photo: '照片', photoSlots: [[0, 2, 2, 14, 14, 15]] }),
  );

  const parse = (s) => { const t = String(s || ''); return t.includes(':') ? t : 'xiaojingyu:' + t; };
  const byBlock = (id) => { const k = parse(id).replace(/\[.*$/, ''); return LIST.find((f) => f.block === k) || null; };
  const byId = (id) => LIST.find((f) => f.id === id) || null;
  const byLayout = (id, layer) => LIST.find((f) => [f.layout].concat(f.extra || [], f.also || []).some((l) => l.id === id && (!layer || l.layer === layer))) || null;
  // 朝北的 [dx, dy, dz] 转到 facing（和 blockstate 的 y 旋转一样，从上往下看顺时针）：east 时 (dx, dz) → (−dz, dx)
  function rotate(off, facing) {
    let [x, y, z] = off;
    for (let k = (FACING_Y[facing] || 0) / 90; k > 0; k--) [x, z] = [-z, x];
    return [x + 0, y, z + 0];
  }
  // 朝北、主格方块内的点（单位格）转到 facing：绕主格中心 (0.5, 0.5) 转
  function rotatePoint(p, facing) {
    let [x, y, z] = p;
    for (let k = (FACING_Y[facing] || 0) / 90; k > 0; k--) [x, z] = [1 - z, x];
    return [x, y, z];
  }
  // 这件朝 facing 时每格相对主格的位置和 part
  const cellsFor = (f, facing) => f.cells.map((c) => ({ part: c.part, offset: rotate(c.offset, facing) }));
  // 主格的 part（单格的 null；床 head、贝壳柜 left、第 2 轮起 0）
  const mainPart = (f) => { const c = f.cells.find((q) => !q.offset[0] && !q.offset[1] && !q.offset[2]); return c ? c.part : null; };
  // 默认房子里（42-house-mc 的摆法）这一件的主格：h = f.house 或 also 里的一条（{facing, xs, ys, zs}）→ { cell: [x,y,z], facing, id }
  //   id = 布局里对应的那件（f.layout.id 或 also 的 id）。没有 house 的（第 1 轮的 3 件）→ null
  function homeOf(f, h) {
    h = h || (f && f.house);
    if (!h) return null;
    const offs = cellsFor(f, h.facing).map((c) => c.offset), mn = [0, 1, 2].map((k) => Math.min(...offs.map((o) => o[k])));
    return { cell: [h.xs[0] - mn[0], h.ys[0] - mn[1], h.zs[0] - mn[2]], facing: h.facing, id: h.id || (f.layout && f.layout.id) || f.id };
  }
  // 这一种在默认房子里的所有摆法（house + also）
  const homesOf = (f) => (f && f.house ? [homeOf(f)].concat((f.also || []).filter((a) => a.xs).map((a) => homeOf(f, a))) : []);
  // 从默认摆法 home 搬到 to（{cell, facing}）：场景里的点、three.js 的 rotation.y 都跟着转（绕主格底面中心，按 facing 差几个 90°）。
  // 朝向一样时只平移（默认房子里原地不动的，点原样返回，一点浮点误差都没有）
  function mover(home, to) {
    const k = (((FACING_Y[to.facing] || 0) - (FACING_Y[home.facing] || 0)) / 90 % 4 + 4) % 4;
    const hc = [home.cell[0] + 0.5, home.cell[1], home.cell[2] + 0.5], tc = [to.cell[0] + 0.5, to.cell[1], to.cell[2] + 0.5];
    const d = [tc[0] - hc[0], tc[1] - hc[1], tc[2] - hc[2]];
    const point = (p) => {
      if (!k) return [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
      let x = p[0] - hc[0], z = p[2] - hc[2];
      for (let i = 0; i < k; i++) [x, z] = [-z, x];            // 从上往下看顺时针（和 rotate 一样）
      return [tc[0] + x, p[1] + d[1], tc[2] + z];
    };
    const yaw = (a) => (k ? a - k * Math.PI / 2 : a);          // MC 顺时针一步 = three.js rotation.y 减 90°
    return { k, d, point, yaw, same: !k && !d[0] && !d[1] && !d[2] };
  }
  // 方块状态字符串，比如 state(bed, 'north', 'head') → 'xiaojingyu:bed[facing=north,part=head]'
  const state = (f, facing, part) => f.block + '[facing=' + facing + (part != null && part !== '' ? ',part=' + part : '') + ']';
  const modelOf = (f, part) => f.models[part == null || part === '' ? 'main' : String(part)];
  // 这一格的碰撞：'box' / 'thin' / 'none'（第 1 轮的 3 件都是 box）
  const collideOf = (f, part) => { const c = f.collide || 'box'; return Array.isArray(c) ? c[part | 0] : c; };
  // 怎么放：'floor'（默认）/ 'wall' / 'ceiling'（见上面 kind 的说明）
  const mountOf = (f) => (f && f.mount) || 'floor';

  // 游戏场景里，布局上带 block 的这件体素版怎么画（docs/FURNITURE.md 第 7、9 节）。block 可以是方块 id，也可以是规格本身：
  //   undefined  不是方块版（没有 block、房子不是方块房子、或者是工作台 ctx.studio）：照旧画完整的体素版
  //   null       不画，54-house-mc 画方块
  //   ['*']      整件照画体素版（风铃、遮阳伞：会随风摆），54-house-mc 不画这个方块
  //   [骨骼名…]  只留这些骨骼（灯泡、屏幕、灯罩……）叠在方块上，用 prune
  function webKeep(ctx, block) {
    const H = V3.layout && V3.layout.house;
    if (!block || !H || !H.blocks || (ctx && ctx.studio)) return undefined;
    const f = typeof block === 'string' ? byBlock(block) : block, k = f && f.overlay;
    return Array.isArray(k) && k.length ? k : null;
  }
  // 只留 keep 里的网格（名字是 'vox:<骨骼>' 或者直接是名字）和灯光；留下的和方块模型的面重合，往前偏一点免得闪。keep 含 '*' 时整件不动
  function prune(root, keep) {
    if (!root || !keep || keep.includes('*')) return root;
    const want = new Set(keep.flatMap((k) => [k, 'vox:' + k])), drop = [];
    root.traverse((m) => {
      if (!m.isMesh) return;
      if (!want.has(m.name)) { drop.push(m); return; }
      for (const mt of [].concat(m.material)) { mt.polygonOffset = true; mt.polygonOffsetFactor = -1; mt.polygonOffsetUnits = -4; }
      m.castShadow = false; m.userData.noShadow = true; m.userData.overlay = true;
    });
    for (const m of drop) m.removeFromParent();
    root.userData.overlay = keep.slice();
    return root;
  }

  V3.furnMc = { list: LIST, byBlock, byId, byLayout, rotate, rotatePoint, cellsFor, mainPart, homeOf, homesOf, mover, state, modelOf, collideOf, mountOf, webKeep, prune, FACINGS, FACING_Y };
})(window.V3);
