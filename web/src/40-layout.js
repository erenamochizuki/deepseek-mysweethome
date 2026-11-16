// src/40-layout.js — 小鲸鱼之家 v4（方块房子）+ 场地布局数据（单位：米）。+x 东, +y 上(世界绝对高度), +z 南(朝海)。
// 家具、绿植、天气、脚印、地形这些「不是方块」的东西都只读这里：改布局只改这一个文件。纯数据，无副作用。
(function (V3) {
  'use strict';
  // rect: x0..x1 (west→east), z0..z1 (north→south), h = 高度（家具：离所在楼层地面；场地：0）
  const R = (id, label, x0, z0, x1, z1, h, extra) => Object.assign({ id, label, x0, z0, x1, z1, h }, extra || {});
  const L = {
    version: 2,
    girlH: 1.3,                                   // 小鲸鱼身高（比例参考）
    site: { x0: -26, x1: 26, z0: -18, z1: 40, sandY: 0, bottomY: -6 },
    sea: { y: -0.15, shoreZ: 12 },
    zones: [                                      // 沙滩和海的分带（俯视图底色）
      R('sand', '干沙滩', -26, -18, 26, 8, 0),
      R('wash', '冲上岸区（贝壳、海螺、海星、漂流瓶）', -20, 8, 20, 12, 0),
      R('wet', '湿沙 + 浪花线', -26, 11, 26, 13, 0),
      R('wade', '浅水区：蹚水（水深 0–0.6 m）', -26, 13, 26, 21, 0),
      R('swim', '深水区：游泳（台阶状海底到 -4 m，海带、珊瑚、小丑鱼）', -26, 21, 26, 40, 0),
    ],
    // v4（2026-11-06 用户定稿：方案 B、一楼净高 3 米、平滑石英、屋脊盖板）：房子是 MC 方块，1 格 = 1 米。
    // 方块数据是鲸图 assets/house/house-v4.png（生成器 web/src/42-house-mc.js，说明 docs/HOUSE-V4.md）：
    // 54-house-mc.js 读它来画，61-nav 按方块算能走的地方。这里的尺寸要和鲸图对得上。小屋 2.0 的版本在 git d3440c4。
    house: {
      blocks: true, asset: 'house/house-v4.png',  // blocks：54-house-mc 画方块；55-house-detail 不画门窗和门廊灯笼
      stand: [-2, 0, -2],                         // 站立点（台阶前那一格，朝北看房子）：鲸图格子 (0,0,0) 放在 stand + Offset（不看 Metadata 的 Origin）
      x0: -7, x1: 7, z0: -16, z1: -6, wallT: 1,   // 外墙外皮（墙 1 格厚，屋里 x −6..6、z −15..−7）
      floorY: 1.0,                                // 一楼地面（y=0 那层木板的顶面，门廊同高）
      loftY: 5.0,                                 // 阁楼地面（y=4 那层整块木板的顶面；一楼净高 3 米）
      eaveY: 6.0,                                 // 阁楼矮墙顶（矮墙 1 米）
      ridgeY: 11.5, ridgeIn: 9.9,                 // 屋脊顶（两排台阶 + 下半砖盖板）；屋脊下面（串灯挂在这个高度）
      ridgeAxis: 'x', overhang: 1,                // 主屋脊东西向 → 东/西两面是山墙；45°；挑檐 1 格
      crossGable: { x0: -4, x1: 1, z: -6, ridgeY: 8.5, label: '朝海的小山墙（门上方，白墙 + 阁楼窗）' },
      doorIn: [-1.5, -7.6], doorOut: [-1.5, -5.4], // 门内 / 门外落脚点
    },
    porch: {
      x0: -8, x1: 8, z0: -6, z1: -3, y: 1.0, railH: 1.0, label: '木门廊（云杉栅栏，1 级台阶）',
      steps: R('steps', '台阶（1 级橡木楼梯：半格 + 半格）', -3, -3, 0, -2, 1.0, { n: 2 }),
    },
    // 门窗在方块房子里的位置（只给藤蔓让洞、花箱这些用）。wall: s/n/e/w；a0..a1 = 沿墙坐标（s/n 墙用 x，e/w 墙用 z）；y0..y1 = 世界高度
    openings: [
      { id: 'door', label: '前门（橡木门）', wall: 's', a0: -2, a1: -1, y0: 1.0, y1: 3.0 },
      { id: 'winSW', label: '前窗·西（紫色花箱）', wall: 's', a0: -5, a1: -3, y0: 2.0, y1: 3.0 },
      { id: 'winSE', label: '前窗·东（粉色花箱）', wall: 's', a0: 1, a1: 3, y0: 2.0, y1: 3.0 },
      { id: 'winW', label: '西窗（摇椅看海）', wall: 'w', a0: -8, a1: -7, y0: 2.0, y1: 3.0 },
      { id: 'winE', label: '东窗', wall: 'e', a0: -8, a1: -7, y0: 2.0, y1: 3.0 },
      { id: 'winN', label: '北窗（水槽上方）', wall: 'n', a0: 0, a1: 1, y0: 2.0, y1: 3.0 },
      { id: 'gableW', label: '西山墙窗（阁楼）', wall: 'w', a0: -12, a1: -10, y0: 6.0, y1: 8.0 },
      { id: 'gableE', label: '东山墙窗（阁楼）', wall: 'e', a0: -12, a1: -10, y0: 6.0, y1: 8.0 },
      { id: 'gableS', label: '小山墙窗（阁楼，朝海）', wall: 's', a0: -2, a1: -1, y0: 6.0, y1: 7.0 },
    ],
    // 一楼家具（h = 离一楼地面高度）。位置照小屋 2.0，跟着墙挪（北边那排往北 1.25 米，东西各 0.25 米，和 42 的家具占位一样）。
    // 吊灯和楼梯是方块（灯笼、橡木楼梯），不在这里。
    ground: [
      R('bed', '床（蓝被子 + 白枕头）', -6.0, -15.0, -5.0, -13.0, 0.55, { block: 'xiaojingyu:bed' }),   // P5：整格的模组方块（1 × 2 格，床头朝北）
      R('nightstand', '床头柜（咖啡壶、杯子）', -4.8, -15.0, -4.2, -14.5, 0.55, { block: 'xiaojingyu:nightstand' }),
      R('bookshelf', '书架（书 + 小盆栽）', -4.0, -15.0, -3.0, -14.6, 2.0, { block: 'xiaojingyu:bookshelf' }),
      R('kitchen', '厨房台面（灶台、水槽、电饭煲）', -2.0, -15.0, 2.0, -14.4, 0.8, { block: 'xiaojingyu:kitchen_counter' }),
      R('jars', '调料罐架（挂墙上）', -1.0, -15.0, 0.0, -14.8, 0.3, { wallY: 2.5, block: 'xiaojingyu:spice_rack' }),
      R('fridge', '小冰箱', 2.15, -15.0, 2.85, -14.35, 1.0, { block: 'xiaojingyu:mini_fridge' }),
      R('dining', '餐桌（格子桌布 + 小花瓶）', 0.0, -12.0, 1.0, -11.0, 0.6, { block: 'xiaojingyu:dining_table' }),   // P5：1 格，在一楼吊灯正下方
      R('chairDW', '餐椅', -0.6, -11.8, -0.1, -11.2, 0.35, { block: 'xiaojingyu:dining_chair' }),
      R('chairDE', '餐椅', 1.1, -11.8, 1.6, -11.2, 0.35, { block: 'xiaojingyu:dining_chair' }),
      R('desk', '书桌（复古电脑、台灯、摊开的书）', -6.0, -10.85, -5.3, -9.15, 0.62, { block: 'xiaojingyu:desk' }),
      R('deskChair', '椅子（蓝格子坐垫）', -5.0, -10.775, -4.45, -10.225, 0.35, { block: 'xiaojingyu:desk_chair' }),
      R('frames', '6 个画框（她的画，2×3 挂西墙）', -5.97, -11.0, -5.92, -9.0, 0.9, { wallY: 2.0, block: 'xiaojingyu:picture_frames' }),
      R('rocking', '摇椅（对着西窗看海）', -4.9, -8.0, -4.1, -7.0, 0.8, { block: 'xiaojingyu:rocking_chair' }),
      R('tv', '电视 + 电视柜（靠东墙，朝西）', 5.5, -9.8, 6.0, -8.2, 0.95, { block: 'xiaojingyu:tv_stand' }),
      R('sofa', '双人小沙发（格子靠垫，朝东）', 2.15, -10.0, 2.85, -8.0, 0.75, { block: 'xiaojingyu:sofa' }),
      R('rug', '蓝色编织圆地毯', 3.0, -10.0, 5.0, -8.0, 0.02, { round: true, block: 'xiaojingyu:living_rug' }),
      R('coffee', '小茶几（地毯上，沙发和电视之间）', 3.1, -8.85, 3.9, -8.15, 0.4, { block: 'xiaojingyu:living_rug' }),
      R('plantSE', '大盆栽', 5.3, -7.6, 5.9, -7.0, 1.0, { block: 'xiaojingyu:floor_plant' }),
      R('mat', '门口地垫', -2.0, -7.6, -1.0, -7.0, 0.02, { block: 'xiaojingyu:door_mat' }),
    ],
    // 阁楼家具（h = 离阁楼地面高度）。主屋脊东西向：从南往北每排净高 2 / 3 / 4 / 5 / 5 / 4 / 3 / 2 米。
    // 楼梯口（x 5..6、z −15..−11）和它西边的栏杆是方块。
    loft: [
      R('shellCase', '贝壳收集柜（玻璃展示格 + 小抽屉，点开看收藏）', -6.0, -11.0, -5.4, -9.0, 1.0, { block: 'xiaojingyu:shell_case' }),   // P5：2 格长、1 格高，靠西山墙面朝东
      R('album', '相册矮桌（相册先留接口）', -2.0, -11.0, -1.0, -10.0, 0.4, { block: 'xiaojingyu:photo_album_table' }),
      R('cushions', '地垫坐垫 ×2', -3.0, -9.9, -1.0, -9.3, 0.12, { block: 'xiaojingyu:floor_cushions' }),
      R('seat', '窗边坐垫（看海）', -1.9, -7.6, -0.1, -7.0, 0.4, { block: 'xiaojingyu:window_seat' }),
      R('scope', '望远镜（看月亮、星星）', 0.15, -7.7, 0.75, -7.1, 1.0, { block: 'xiaojingyu:telescope' }),
      R('chests', '储物箱 ×2（北边矮墙下）', -3.0, -15.0, -1.0, -14.4, 0.6, { block: 'xiaojingyu:storage_chests' }),
      R('beanbag', '懒人沙发', 1.0, -9.0, 2.0, -8.0, 0.5, { block: 'xiaojingyu:beanbag' }),
      R('lights', '串灯（屋脊下，一格一段 × 12）', -6.0, -12.0, 6.0, -11.0, 0, { ceiling: true, wallY: 9.0, block: 'xiaojingyu:string_lights' }),   // 挂在 y 9 那层格子里，串在格子的南边上
    ],
    // 屋外小物件（h = 离沙面高度；门廊上的按门廊面）。P5 第 3 轮（docs/FURNITURE.md 9.1）：带 block 的是模组方块，位置在方块的格子里
    outside: [
      R('rocks', '石块堆（台阶状灰石）', -13, -8, -9, -3, 1.5),
      R('chest', '木箱 + 灯笼', 8.1, -3.9, 8.9, -3.1, 1.0, { block: 'xiaojingyu:crate_lantern' }),   // 格子 (8, 0, −4)，连灯笼 1 米高
      R('towel', '蓝白条纹毛巾（门右边挂钩）', 0.3, -6.0, 0.7, -5.85, 0, { wallY: 1.875, block: 'xiaojingyu:towel_hook' }),   // 格子 (0, 1, −6)
      R('boxW', '花箱（紫花）', -5.0, -5.95, -3.0, -5.6, 0, { wallY: 1.7, block: 'xiaojingyu:flower_box_purple' }),   // x −5..−4，y 1，z −6（箱体 + 58 的花）
      R('boxE', '花箱（粉花）', 1.0, -5.95, 3.0, -5.6, 0, { wallY: 1.7, block: 'xiaojingyu:flower_box_pink' }),     // x 1..2，y 1，z −6
      R('succ', '多肉小盆栽（台阶两边 + 栏杆头）', -3.4, -2.9, 0.4, -2.1, 0.2, { block: 'xiaojingyu:succulents' }),   // 方块：(−4, 0, −3)、(0, 0, −3)、(1, 2, −4)，一格两小盆
      R('reefE', '礁石（螃蟹的家）', 14, 11, 18, 15, 1.0),
      R('reefW', '礁石', -18, 15, -15, 18, 0.8),
      R('stepMat', '台阶下地垫', -1.8, -1.95, -0.2, -1.35, 0.02, { block: 'xiaojingyu:step_mat' }),   // x −2..−1，y 0，z −2（站立点那格）
      R('chime', '贝壳风铃（门上方小铁臂挂着，风吹会摆，开关门会响）', -1.65, -5.95, -1.35, -5.65, 0, { wallY: 3.7, block: 'xiaojingyu:wind_chime' }),   // 格子 (−2, 3, −6)，整串在 y 3..4 里
      // 用户反馈 fb-20261105-054642-y82：沙滩椅 + 遮阳伞 + 白色独脚小圆桌（桌上柠檬汁 + 高脚杯鸡尾酒），用户点在 (-9.2, 5.1)
      // P5 第 3 轮：4 种都是模组方块（躺椅 x −11 / −9、z 4..5；小圆桌 (−10, 4)；遮阳伞 (−10, 0..2, 5)），体素版的摆法在 56-furn-beach
      R('beachSet', '沙滩休闲角：沙滩椅 ×2（面朝海）+ 遮阳伞 + 白色独脚小圆桌（柠檬汁、高脚杯鸡尾酒）', -11.6, 3.4, -6.8, 6.6, 0,
        { blocks: ['xiaojingyu:beach_lounger', 'xiaojingyu:beach_lounger_hat', 'xiaojingyu:beach_table', 'xiaojingyu:beach_parasol'] }),
    ],
    // 门两侧的壁灯。门廊栏杆上 4 盏、屋里 2 盏是方块灯笼，54-house-mc 给它们点光。
    // P5 第 3 轮：这两盏是模组方块 xiaojingyu:wall_lantern（格子 (−3, 2, −6)、(−1, 2, −6)；55-house-detail 里叫 lantern0 / lantern1）
    lanterns: [ [-2.5, -5.9], [-0.5, -5.9] ],
    greenery: '墙上藤蔓 + 窗下花箱、门廊和台阶边的盆栽、沙滩上贴地爬的海边植物、一两棵椰子树（第5轮用户选了全部四项）；不要草坪',
    plants: [                                     // 第5轮：绿植位置（建模时可微调，用户会用反馈工具提意见）
      { id: 'palmW', label: '椰子树（屋子西北，石堆后面）', x: -10.5, z: -11.5, h: 6.5, lean: [0.25, 0.1] },
      { id: 'palmE', label: '椰子树（东边沙滩，向海歪）', x: 11.5, z: 1.5, h: 5.5, lean: [0.15, 0.45] },
      { id: 'vineSW', label: '藤蔓（西南墙角）', wall: 's', a: -6.9, b: -5.1, y0: 1.0, y1: 4.2 },
      { id: 'vineSE', label: '藤蔓（粉花窗东边）', wall: 's', a: 3.2, b: 4.6, y0: 1.0, y1: 3.4 },
      { id: 'vineE', label: '藤蔓（东墙北段）', wall: 'e', a: -13.2, b: -11.6, y0: 1.0, y1: 4.0 },
      { id: 'potW', label: '盆栽（门廊西角）', x: -6.5, z: -4.5, block: 'xiaojingyu:potted_fern' },   // 格子 (−7, 1, −5)
      // 吊篮：竖杆立在东头栏杆柱（(7, 1, −5) 的栅栏）顶上，post = 柱顶离门廊面的高度；吊臂往 arm 那边（西）伸出去挂篮子
      { id: 'potE', label: '盆栽（门廊东角，吊篮）', x: 7.5, z: -4.5, hang: true, post: 1.0, arm: 'w', block: 'xiaojingyu:hanging_basket' },   // 格子 (7, 2, −5)
      { id: 'potStep', label: '盆栽（台阶东侧）', x: 1.5, z: -2.5, block: 'xiaojingyu:flower_pot' },   // 格子 (1, 0, −3)
      { id: 'creepW', label: '海边爬藤（紫花，石堆旁）', x0: -15, z0: -6, x1: -9.5, z1: 0 },
      { id: 'creepE', label: '海边爬藤（东侧）', x0: 9.5, z0: -9, x1: 14, z1: -4 },
      // grassS（沙丘上的海边草）按用户反馈 fb-20261105-054413-wx1「喧宾夺主了，去掉」已删除
    ],
    sky: { lat: 35.41, lon: 116.59, note: '太阳东升（+x）、正午在海面上空（南）、西落；月亮按真实轨迹，可落到地平线下' },
    heroCam: { az: 0.55, note: '主视角从海那边（正南偏东 32°）看向小屋' },
  };
  V3.layout = L;
})(window.V3);
