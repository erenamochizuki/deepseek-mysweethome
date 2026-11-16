# 第③阶段团队约定：小屋 2.0（房子、家具、阁楼、日月、沙滩、绿植）

先读 docs/SPEC.md（总约定：build、模块包装、parts、models、测试钩子），再读本文件。
ROOT = 海边小屋-v3 目录（所有命令都在 ROOT 下运行）。

## 1. 目标
- 做出 refs/concept-ext-day.png 那种 MC 方块小岛场景：黄昏暖光、白灰泥墙 + 深色木柱、阶梯木屋顶、
  白窗框 + 花箱、木门廊 + 栏杆 + 台阶、很多暖色灯笼、沙滩、透明海水切面、礁石珊瑚。
  室内参考 refs/concept-interior.png。用户最看重：灯光（黄昏/夜晚的暖光）和精致度。
- 布局数据只从 src/40-layout.js 读（V3.layout，单位米，+x 东，+y 上，+z 南 = 海）。有问题找 lead 改，不要自己改。
- 用户第5轮要求：沙滩不规整（弯的海岸线、小沙丘、沙纹、潮线海草碎贝壳）；绿植四项全要
  （墙上藤蔓 + 窗下花箱、门廊台阶盆栽、沙滩贴地爬藤和海边草、1–2 棵椰子树）；门上方贝壳风铃（先做模型）。
- 天上：圆形发光太阳 + 有月相的月亮，按真实轨迹（济宁 35.41N 116.59E）。

## 2. 尺度
- 房子外壳：方块 0.25 m 一格，贴图 16 px 对应 0.5 m（tileCells 2）。地形：0.5 m 一格（tileCells 1）。
- 家具/小物件/绿植：V3.vox 体素，默认 1/32 m 一格（大件且平的可以 1/16 m）。纹理密度和房子一致（32 px/m）。
- 小鲸鱼身高 1.3 m（layout.girlH），门高 2.0 m，一楼净高 2.5 m。

## 3. 文件和负责人（只写自己的文件；测试输出放 test/tmp-<名字>/）
| 文件 | 负责 | 内容 |
| --- | --- | --- |
| src/04-atlas.js, src/05-blocks.js, docs/BLOCKS.md | engine | 程序生成 16×16 像素贴图图集；方块注册表 + World 网格 + 网格化（形状、AO、部件标签） |
| src/06-env.js, src/07-post.js, src/51-sky.js | sky | 时钟/太阳/月亮/月相/天色；泛光 + 调色；天空球、太阳、月亮、星星、方块云、日月光照和阴影 |
| src/52-terrain.js, src/53-water.js, src/59-sealife.js | beach | 沙滩地形 + 海床 + 岛的分层侧面 + 礁石石堆；海面 + 切面 + 浪花；海草珊瑚小鱼 |
| src/54-house.js, src/55-house-detail.js | plan | 房子外壳（地基、墙、木柱、楼板、阁楼矮墙、山墙、屋顶、门廊）；门窗、灯笼、花箱箱体、毛巾、木箱、风铃 |
| src/56-furn-ground.js, src/57-furn-loft.js | furn | 一楼和阁楼全部家具 |
| src/58-plants.js | face（绿植） | 藤蔓、花箱里的花、盆栽、多肉、贴地爬藤、海边草、椰子树 |
| src/50-scene.js, 40-layout.js, 00–03 | lead | 场景框架（下面第4节）、布局、核心 |

## 4. 场景框架（src/50-scene.js，lead 写）
- 模型 id `house2`（小屋 2.0）。工作台里选它；打开时才构建，不影响别的模型。
- 注册部件：`V3.scene.part({ id, label, order, build(ctx) → Object3D | Object3D[], update?(dt, t, ctx), dispose?() })`
  - order：sky 0 · terrain 10 · water 30 · house 40 · house-detail 45 · furn 50 · plants 60 · sealife 70。
  - build 抛错只跳过这一个部件（记进 window.__errors），别的照常显示。
- ctx：`{ THREE, L (= V3.layout), root, env (= V3.env，可能还没有), rng(seed) → () => 0..1, lamp(opts), glowMat(hex, opts), state }`
  - `ctx.lamp({ pos:[x,y,z], color: 0xffb35c, intensity: 6, distance: 6 })` → PointLight，亮度乘夜晚系数；全场最多 8 个，超出的不生效（灯笼仍会发光）。
  - `ctx.glowMat(hex, { day: 0.15, night: 2.5 })` → 自发光材质（灯笼玻璃、窗户夜光），场景按夜晚系数调亮度。
  - 只用 ctx.rng / V3.util.hash3，不用 Math.random（每次构建一样，反馈的定位点才不会错位）。
- 场景自动：给所有 Mesh 开投影/受影（`userData.noShadow = true` 可关）；`userData.noPick = true` 不能点选（天空用）。
- 状态（工作台顶栏会自动出下拉框）：
  - `time` 时间：golden 黄昏（默认，日落前 50 分钟）· dawn 清晨 · morning 上午 · noon 中午 · dusk 傍晚 · night 夜晚 · real 实时。
  - `floor` 楼层：all 外观 · ground 一楼 · loft 阁楼。
- 视角：hero 主视角 · front 正面 · house 小屋 · inside 一楼 · loft 阁楼 · top 俯视 · site 全景。
- 已实现（02:34）补充：
  - part 还可以有 `setState?(k, v, ctx)`；`dispose?(ctx)`。update 抛错只停这一块的 update。
  - 每帧顺序：`V3.env.update(dt)`（场景调，sky 不要再调）→ 各 part.update → 灯光/发光 → 剖切。切时间时场景调 `V3.env.setTime(v)`。
  - 换模型时场景 dispose 所有几何体和材质；共享的材质设 `material.userData.shared = true` 免得被释放。`userData.noReceive = true` 关受影。
  - 点光源分配：plan ≤4（门廊/门灯/箱子灯笼），furn ≤3（吊灯/台灯/阁楼串灯），其他 0。
  - 统计：`window.__sceneStats = { parts: [{ id, ms, tris, error? }], lamps, glows, tris }`。
  - 没有 sky 时场景加临时灯光 + 天蓝背景，各块可以单独测。`V3.err` 只收一个字符串。

## 5. 部件命名、楼层、剖切（反馈工具和剖切都靠这些，必须做）
- 部件路径（中文）：`小屋/外墙/南墙`、`小屋/木柱`、`小屋/屋顶/主屋顶`、`小屋/门窗/前门`、`小屋/门廊/栏杆`、`小屋/灯笼/门左`、
  `小屋/风铃`、`小屋/一楼/床/被子`、`小屋/阁楼/贝壳收集柜`、`绿植/椰子树/西`、`场地/沙滩`、`场地/石堆`、`海/海面`、`天空/太阳`、`天空/月亮`。
  每个 Mesh 都要有唯一的 `userData.anchor`（如 `house2:wall-s-full`、`house2:furn:bed`）。
- `userData.layer`：`site`（沙滩海天空绿植）· `ground`（一楼墙/地板/家具）· `loft`（阁楼楼板以上的墙/家具）· `roof`（屋顶）。
- 墙要分成东南西北四面、每层单独一个 Mesh，并且每面做两份：
  `userData = { wall: 's'|'n'|'e'|'w', storey: 'ground'|'loft', cut: 'full'|'low' }`。
  一楼 low = 只到一楼地面以上 1.0 m；阁楼 low = 只到矮墙（eaveY）。
- 剖切规则（场景每帧做）：floor=all 全部 full。floor=ground 隐藏 roof 和 loft，一楼朝向相机的墙换 low。
  floor=loft 隐藏 roof，阁楼朝向相机的墙换 low。挂在墙上的东西设 `userData.onWall = 's'` 等，所在墙换 low 时一起隐藏。

## 6. 光和颜色
- 天空和灯光都归 sky（51-sky.js 的 build 里建太阳/月亮 DirectionalLight + 半球光，阴影盖住房子周围约 ±20 m）。
  别的部件不要自己加环境光。场景在没有 sky 部件时会放一盏临时光，方便单独测试。
- 夜晚系数 `V3.env.state.night`（0 白天 … 1 夜晚），黄昏系数 `V3.env.state.golden`。
- 颜色参考（可微调）：灰泥墙 #efe8da（灰缝 #d8cfbf）、木柱 #6b4a2f、屋顶木板 #a8683a/#8a5530 交替、窗框 #f6f3ee、
  玻璃 #bfe3f2（半透明）、门廊木板 #c89058、干沙 #ead5a3、湿沙 #c9ab78、石头 #9c978e、灯笼光 #ffb35c。

## 7. 引擎 API（engine 定稿写进 docs/BLOCKS.md；下面是目标，先照这个写）
```
V3.atlas  { S: 16, add(name, paint(px, rng)), index(name), uv(name) → [u0,v0,u1,v1], texture() (THREE.Texture, 最近邻, sRGB), names }
V3.blocks.def(name, { tiles: 'plaster' | { top, side, bottom, n, s, e, w }, shape: 'cube'|'slab'|'stairs'|'pane'|'fence'|'cross'|'carpet', opaque, tint })
const w = new V3.blocks.World({ cell: 0.25, origin: [x0, y0, z0] /* 米 */, size: [nx, ny, nz], tileCells: 2 })
w.set(i, j, k, name, { facing, half, tag }) · w.fill(i0, j0, k0, i1, j1, k1, name, opts) · w.get(i, j, k)
w.fillM(x0, y0, z0, x1, y1, z1, name, opts)   // 米为单位，方便直接用 layout
w.mesh({ part, anchor, filter(i, j, k, tag) }) → THREE.Mesh（按 tag 分组，userData.faceTags / triTag / anchor，AO 进顶点色）
V3.blocks.material()   // 共用材质
```

## 8. 预算（hero 视角，floor=all，time=golden，1280×800）
- ≤ 450 次绘制、≤ 70 万三角形、RTX 4070 Ti 上 ≥ 60 fps；整个 house2 构建 ≤ 4 秒。
- 每个部件自己控制：家具全部 ≤ 25 万三角形，绿植 ≤ 8 万，房子外壳 ≤ 8 万，地形 + 海 ≤ 12 万。

## 9. 测试和规矩
- `node build.mjs` 必须 syntaxErrors=0。
- 出图：`node tools/shoot.mjs --page studio --views "model=house2+hero+ui=0,model=house2+inside+floor=ground+ui=0" --out test/tmp-<名字>/<步骤> --w 1280 --h 800 --wait 1500 --gpu d3d11`
  （输出 `[__errors] none` 和 `RESULT: OK` 才算过）；多张拼图：`node tools/montage.mjs <out.jpg> 640 400 3 <图…>`。
- 自己的东西可以另外注册「一览」模型，方便在工作台单独看、单独收反馈：例如 `furn`（家具一览）、`plants`（绿植一览）、`blocks`（方块一览）。
- 提交前 `npm run check` 必须 PASS。不要 git commit（lead 统一提交）。
- **不要运行 serve.mjs，不要结束任何 node 进程**（用户的工作台服务器在 5193 端口上跑着）。
- 移植 v1：v1 代码在 `../海边小屋-旧工作区/beach-cabin/src/`（相对 ROOT），只能读。用 shell 复制进 v3 再小步改。
  v3 文件里不能出现 v1 的目录名、`window.K`、绝对盘符路径（npm run check 会查）。文件头写「移植自 v1 的 61-sky.js」即可。
- 写法：每次编辑 ≤ 120 行；先写骨架，留 `// @@NEXT@@`，之后每段替换它；**替换时不要再带文件结尾的 `})(window.V3);`**。
  同一个文件的编辑一次一个（遇到 EIO 1175 重试）。
- 只读自己需要的文件和图片。参考图每张最多看一次；看自己的截图用 ≤ 1280 px。
- 汇报：每完成一步给 lead 发一条中文消息（≤ 6 行：做了什么、截图路径、三角形/绘制数、问题）。
