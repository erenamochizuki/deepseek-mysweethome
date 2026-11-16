# 第④阶段规格（SPEC-4）· 贝壳收集 + 小鲸鱼进场景

用户 2026-11-05 05:40 的决定：第④阶段现在就开始，小屋的反馈边做边改；场景里的小鲸鱼先用旧版模型（model `girl`，src/20-girl.js）占位，新模型（girl3，另一个窗口在做）好了只换一处。

> **2026-11-05 07:45 已完成。** 这份是开工前的分工规格，做出来的接口以代码文件头的注释为准。换新小鲸鱼看 `docs/接入新小鲸鱼.md`；截图 token 和页面参数看 `docs/TOOLS.md`；游戏页怎么玩看 `docs/使用说明.md`。和本文不一样的地方：天气粒子在 `src/54-wx.js`（不是 sky 做的），天气数据在 `V3.env.setWeather` / `state.wx`（`src/06-env.js`），设置项是 `V3.game.SCHEMA` 里的 `weather`，设置面板分「海边 / 天气」两页，门能开关（`V3.nav.setDoor`），沙滩休闲角在 `src/56-furn-beach.js`。

## 1. 要做成什么样
- 贝壳海螺被浪冲上岸。间隔（默认 7–8 分钟）、每次触发真的有东西的概率（默认 50%）、每次几个、沙滩上最多几个，都能在设置里改。
- 玩家点沙滩上的贝壳：抬起转一下，变成图标飞进右下角的收集盒按钮。
- 小鲸鱼空闲时自己去捡：贝壳在沙滩上待够一段时间（默认 30–90 秒）后，她走过去、蹲下、捡起、说一句话。
- 收集盒：点阁楼贝壳柜或屏幕角落的按钮都能打开。12 种按 常见/少见/稀有 分组。没找到的是灰色剪影加「？？？」；找到的显示数量、第一次找到的时间、介绍和一个小转台。
- 阁楼贝壳柜有 12 格，找到一种就摆上一只。
- 头顶对话框跟着她的头走，DPR 要对。v1 的 bug 是拿画布像素当 CSS 像素。
- 脚印：她在沙上走会留下脚印。干沙上慢慢变淡，湿沙上浪一扫就没了。
- 新页面 dist/cabin.html（「海边小屋」）是真正玩的页面，有 HUD、点贝壳和设置；studio.html 继续当反馈工作台。cabin.html?fb=1 会打开反馈工具。

## 2. 文件和负责人
| 文件 | 负责人 | 内容 |
|---|---|---|
| src/60-game.js | lead | V3.store 存档；V3.game 设置、状态、冲上岸计时、收集、事件、测试 token |
| src/91-cabin.js / .css | lead | 页面入口、点选贝壳和贝壳柜、鼠标光标 |
| src/61-nav.js | plan | V3.nav 走路网格、寻路、地面高度 |
| src/62-beach-items.js | beach | 场景部件 beach-items：沙滩上的贝壳、冲上岸动画、闪光、点选球 |
| src/63-footprints.js | beach | 场景部件 footprints：脚印 |
| src/64-bubble.js / .css | sky | V3.bubble 头顶对话框 |
| src/65-girl-actor.js | engine | 场景部件 girl-actor：小鲸鱼在场景里走、捡、说话；20-girl.js 里加 pose |
| src/66-shell-icons.js、src/66-collect-fx.js | face | V3.shellIcons 图标和剪影；V3.collectFx 收集动画 |
| src/57-shell-display.js | furn | 场景部件 shell-display：在阁楼贝壳柜里摆贝壳 |
| src/67-hud、68-collection、69-settings（.js + .css） | fbui | V3.hud、V3.collection、V3.settingsPanel |

场景部件 order：furn-ground 50，furn-loft 51，shell-display 52，plants 60，beach-items 62，footprints 63，girl-actor 65，sealife 70。

## 3. 核心 API（src/60-game.js，lead 写）
- `V3.store = { get(key, def), set(key, val) }`：存在 localStorage，键名加前缀 'v3.'。live 为 false 时 set 不写。
- `V3.game`：
  - `S` 是设置（扁平对象）。`SCHEMA = [{ key, label, type: 'range'|'toggle'|'button', min, max, step, unit, group, hint }]`。
  - `st = { beach: [item], found: { [kindId]: { n, first, last } }, nextWash, stats: { washes, hits, misses } }`。
  - `item = { id: 'b17', kind: 'scallop', x, z, ry, at /* 冲上来的时间戳 ms */ }`。
  - `start({ live })`：读存档。live 时开始计时；页面关掉的那段时间会静默补算，但不超过上限。没有存档时，第一次冲上岸在 30 秒后，并且一定有东西。
  - `set(key, value)`、`get(key)`。
  - `washNow(n?)` → 新冲上来的 item[]。不看概率，但仍受上限限制。
  - `collect(id, by = 'player' | 'girl')` → `{ item, kind, by, first, n, obj }` 或 null。
  - `claim(id, who)`、`unclaim(id)`、`free()` → 没人认领的 item[]。
  - `counts()` → `{ kinds 已找到种类数, total: 12, items 总个数 }`。
  - `reset()` 清空收集，设置不变。
- 设置默认值：washMin 7 和 washMax 8（分钟）、washChance 0.5、perMin 1、perMax 2、maxBeach 8、wCommon 70、wUncommon 25、wRare 5、girlAuto true、girlMin 30 和 girlMax 90（秒）。
- 事件（`V3.on`）：
  - `'game:wash' ({ items, silent })`：silent 为 true 表示补算出来的，不要放动画。
  - `'game:miss' ()`：这次触发没冲上东西。
  - `'game:collect' ({ item, kind, by, first, n, obj })`：obj 是 beach-items 已经从沙滩上摘下来的 Object3D，用世界坐标。FX 播完负责 dispose。
  - `'game:claim' ({ id, who })`、`'game:reset' ()`、`'game:settings' ({ key, value })`。
  - `'game:open' (what)`：what 是 'collection'、'settings' 或 'album'。
- 测试 token（`__view` / `?view=`）：`wash`、`wash=N`（立刻冲上 N 个，带动画）、`collect`（捡第一个）、`found=all` 或 `found=N`（直接设成找到 N 种）、`reset`、`open=collection` 或 `open=settings`。模块可以用 `V3.viewTokens.名字 = (v) => …` 自己加 token，别用 time、floor 这类已有状态名。
- studio.html 也会调 `V3.game.start({ live: false })`：读存档但不写也不计时，工作台里的 house2 也能看到沙滩上的贝壳。

## 4. 各模块
### V3.nav（plan）
- 0.25 m 网格，覆盖场地 x −26..26、z −18..40。
- `walkable(x, z)`。
- `heightAt(x, z)`：沙地用 V3.terrain.groundY，门廊和台阶用木板面。
- `path([x, z], [x, z])` → `[[x, z]…]` 或 null（A*，8 方向，拉直）。
- `randomPoint(zone)`，zone 是 'beach'、'porch'、'tideline' 或 'any'。
- `nearest(x, z)` → 最近能走的点。
- 不能走：房子（门先当关着；第⑤阶段再开门进屋）、栏杆、石头堆、礁石、椰子树干、木箱、水深 > 0.35 m（下水第⑤阶段做）。
- `?nav=1` 在场景上画绿/红格子（noPick）。
- 先写网格、walkable 和 heightAt，交给 engine 用，再写 path。

### V3.beachItems（beach）
- build 时把 V3.game.st.beach 摆出来，听 'game:wash' 往上加。
- 每个 item 一个 root：`userData.collectId = item.id`，part 是 '贝壳/<名字>'，anchor 是 'beach:' + id。里面有：
  - `V3.shells.build(kind)`；
  - 一个看不见的点选球（半径 0.18 m，material.visible = false）；
  - 一颗闪光，几秒闪一次，稀有的更亮（noPick、noShadow）。
- 冲上岸动画跟着 V3.water.runup 从水线滑到落点，翻一两下再停住。silent 的直接放好。
- `spot(rng)` → `{ x, z, ry }`：落在潮线和湿沙一带（V3.terrain.tideZ / shoreZ），避开礁石和石头，彼此相隔 ≥ 1 m，并且 nav 能走到。V3.game 生成 item 时会调它。
- `detach(id)` → Object3D（世界坐标，从场景摘下来）。V3.game.collect 会调它。
- `objects()` → 点选用的 root 列表。

### V3.footprints（beach）
- `step(x, z, ry, foot 'L'|'R')` 在沙上放一个小脚印。用 InstancedMesh，最多 300 个，满了换掉最旧的。
- 干沙上约 3 分钟变淡消失；湿沙上浪扫过（V3.water.frontD / runup）就没了。门廊木板上不放。

### V3.bubble（sky）
- `say(id, text, { anchor: () => THREE.Vector3（世界坐标）, ms?, mood? })`、`hide(id)`、`clear()`。
- 用 HTML 层，不画进画布。每帧按 canvas.getBoundingClientRect() 的 CSS 像素投影，绝不用 drawingBuffer 的尺寸。
- 锚点在镜头背后或出了屏幕就藏起来；离得远就缩小一点。
- 样式：白色圆角加一条指向锚点的小尾巴；字一个个出来；显示时长按字数算；同一个 id 的新话替换旧话。
- token `say=文字` 让小鲸鱼说话（场景里没有她就对准场地中心）。
- ui=0 时仍然显示，方便截图看位置。

### girl-actor（engine）
- 用 `V3.girl.build()`（旧版模型，占位），放在门廊前的沙滩上。以后换模型只改这一处。
- `V3.actor = { inst, root, head() → 头顶上方 0.15 m 的世界坐标, state, goto(x, z) → Promise, say(text) }`。
- 状态：
  - idle：站一会儿，转头看看。
  - wander：走到 `V3.nav.randomPoint('beach')`。
  - collect：S.girlAuto 打开，并且 `V3.game.free()` 里有在沙滩上待了 ≥ girlMin..girlMax 秒的贝壳时触发。她先 claim，走过去，蹲下（新 pose 'pickup'），调 `V3.game.collect(id, 'girl')`，然后开心（expr happy + pose 'cheer'）并 `V3.bubble.say`。玩家先捡走了，她就换下一个或者回到 wander。
- 走路 1.0 m/s，转身要平滑。每一步调 `V3.footprints.step`，高度用 `V3.nav.heightAt`。
- 新 pose 'pickup' 和 'cheer' 加在 src/20-girl.js 的 animate 里。只加分支，不改造型。
- 台词表分几类：找到新种类、稀有、普通、玩家帮忙捡、空闲自言自语。每类随机挑一句。
- token：`girl=collect`（马上去捡最近的）、`girl=x_z`（走到某点）。

### V3.shellIcons + V3.collectFx（face）
- `shellIcons.get(kind, { silhouette, size: 96 })` → dataURL。用主渲染器画到离屏 RenderTarget 再读回来，画完恢复渲染器状态，结果缓存。剪影是同样形状，一个颜色 #5d6b7c，半透明。
- `collectFx.play({ obj, kind, by, first })`，听 'game:collect' 自己播：
  1. 抬起 0.4 m，转一圈（0.5 s）。
  2. 换成 2D 图标，沿弧线飞到 `V3.hud.anchor('box')`（0.7 s）。
  3. `V3.hud.pulse('box')`，再加一个 toast：「+1 扇贝」；第一次找到是「新发现！扇贝」；颜色按稀有度。
- 没有 HUD 时（工作台）就原地升起淡出。by 为 'girl' 时先飞到她手边。播完 dispose。

### shell-display（furn）
- 找到阁楼贝壳柜：`userData.clickable === 'shellBox'`，`userData.slots` 是 12 个本地坐标，`slotSize = [0.53, 0.19, 0.38]`。
- 第 i 格放 KINDS[i]，找到了才放。用 `V3.shells.build`，缩放到格子里，朝外。
- 听 'game:collect' 和 'game:reset' 更新；新放上去的那格闪一下。

### HUD / 收集盒 / 设置（fbui）
只在 cabin 页面挂载，`V3.hud.mount()` 由 91-cabin.js 调用。
- `V3.hud`：
  - 右下角圆按钮：收集盒（角标是「已找到种类/12」）、设置、反馈（跳到 ?fb=1）。
  - 左下角楼层按钮：外观、一楼、阁楼（`V3.setState('floor', …)`）。
  - `anchor(name)` → 按钮中心的屏幕坐标；`pulse(name)`；`badge(name, text)`；`toast(text, { color })`。
  - body.ui-off 时隐藏。
- `V3.collection.open()` / `close()`，也听 'game:open' 'collection'：
  - 顶部写「已找到 n / 12」，卡片按 常见/少见/稀有 分三组。
  - 没找到的卡片：V3.shellIcons 剪影、「？？？」、稀有度。找到的：图标、名字、×n。
  - 点卡片打开详情：小转台（自己建 256×256 的小 WebGLRenderer，关掉就 dispose）、名字、稀有度、desc、第一次找到的时间、数量。
- `V3.settingsPanel.open()` / `close()`：
  - 按 V3.game.SCHEMA 自动生成滑条、开关和按钮，改动调 V3.game.set。
  - 分组「海边」：冲上岸间隔（最短/最长，分钟）、每次触发有东西的概率、每次几个、沙滩上最多几个、三档稀有度权重、小鲸鱼自己去捡（开关）、她多久后去捡、「现在就冲一波」按钮、「清空收集」（要确认）。以后的阶段会往 SCHEMA 里加分组。
- 风格：圆角、可爱，深海蓝 #1e2a56 + 天蓝 #6fc3f5 + 白，中文。

## 5. 规则（同 SPEC-3 §9）
- 每次改 ≤ 120 行，先写骨架。`node build.mjs` 现在会出 studio.html 和 cabin.html，两个都要 syntaxErrors=0。还要跑 `npm run check`。
- 截图：
  - 游戏页：`node tools/shoot.mjs --page cabin --views "hero+time=golden+ui=0,wash=3" --out test/tmp-<名字>/<步骤> --w 1280 --h 800 --wait 1500 --gpu d3d11`。每次截图都是新的浏览器配置，存档是空的。
  - 工作台：`--page studio --views "model=house2+…"`。
- 不 git commit；不启动也不杀 serve.mjs 或 node 进程；只改自己的文件。
- 别碰 girl3 相关的文件：src/23–28、tools/girl/、docs/GIRL-V3.md（另一个窗口在做），也别碰 serve.mjs。
- 中文汇报，每步 ≤ 6 行。
