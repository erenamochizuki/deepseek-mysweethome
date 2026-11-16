# 开发探针 xjyprobe

> 「接口约定」一节由 lead 维护。Java 探针（mod-2）和 Node 工具（probe-tools）都按它写。
> 要改接口：先发消息给 lead，lead 改完这一节再通知两边。其余各节由 probe-tools 写。

## 它是什么

- 开发专用的第二个模组 `xjyprobe`，源码在 `mod/src/probe/`。只有 `gradlew runClient` 会加载它，`gradlew build` 出的 `xiaojingyu-*.jar` 里没有它。
- 它在游戏里开一个只有本机能连的 HTTP 服务。Node 脚本通过它开世界、放方块、读方块、截图、退出游戏，用来做自动验收。

## 接口约定（v1）

### 连接

- 只监听 `127.0.0.1`。端口默认随机；`gradlew runClient -Pxjyprobe.port=端口` 可以固定。
- HTTP 服务起来之后，在游戏目录 `mod/run/` 写 `xjyprobe.json`：
  `{"v":1,"port":53123,"token":"<32 字节随机数的 hex>","pid":12345,"startedAt":"2026-11-05T23:30:00+08:00"}`
  游戏正常退出时删掉。runner 启动游戏前先删掉旧的这个文件。
- 每个请求都要带 `Authorization: Bearer <token>`，否则回 401。
- 带 `Origin` 头的请求一律回 403（挡住网页里的脚本）。`Host` 必须是 `127.0.0.1:<port>` 或 `localhost:<port>`，否则回 403。
- 请求体和回复都是 UTF-8 的 JSON，请求体最大 64 KB，超过回 400 `too_large`。
- 请求按顺序一个一个处理（单线程）。

### 回复格式

- 成功：HTTP 200，`{"ok":true, ...各接口自己的字段}`。
- 失败：`{"ok":false,"error":"<错误码>","message":"<说明>"}`。
- HTTP 状态：400 参数不对，401 没带 token 或 token 不对，403 Origin/Host 不对，404 没有这个接口，405 方法不对，409 现在的状态做不了（比如没进世界就读方块），504 等游戏线程超时，500 其它。
- 错误码：`bad_request`、`unauthorized`、`forbidden`、`not_found`、`method_not_allowed`、`busy`、`not_in_world`、`chunk_not_loaded`、`too_large`、`timeout`、`internal`。

### 线程

- HTTP 线程不碰游戏对象。读写世界用 `server.submit(...)`（服务器线程），碰客户端和画面用 `Minecraft.getInstance().submit(...)`（Render thread），再 `get(超时)` 等结果。默认超时 10 秒，截图 15 秒。超时回 504 `timeout`。
- 例外：`GET /status` 不进游戏线程，只读一份每个客户端 tick 刷新一次的快照。建世界时 Render thread 会卡住，这时 `/status` 也要马上回。

### 接口

**1. `GET /status`**

```json
{"ok":true,"v":1,"mc":"26.1.2","neoforge":"26.1.2.76","pid":12345,
 "ready":true,"screen":"TitleScreen","inWorld":false,"player":null,
 "chunksRendered":null,"fps":60,"snapshotAgeMs":12}
```

- `ready`：主菜单出现过一次以后是 true。在这之前，除了 `/status` 和 `/quit`，别的接口回 409 `busy`。
- `screen`：当前界面类的简单名，没有界面时是 null。比如 `TitleScreen`、`LevelLoadingScreen`。
- `inWorld`：客户端有 level 而且有 player。
- `player`（在世界里时）：`{"x":0.5,"y":-60.0,"z":0.5,"yaw":0.0,"pitch":0.0,"dimension":"minecraft:overworld","gameMode":"creative"}`，不在世界里是 null。
- `chunksRendered`：在世界里时是 `LevelRenderer.hasRenderedAllSections()` 的结果，不在世界里是 null。它只表示「现在没有等着编译的区块」：tp 之后的一两个 tick 里，新区块可能还没排进队列，它会短暂是 true。所以 tp 以后要先等 1 秒左右，再等它变 true。
- `snapshotAgeMs`：快照是多久以前刷新的。建世界时会变大，runner 只拿它做参考。

**2. `POST /world/open`**

- 请求：`{"name":"probe-flat","seed":0}`，两项都可以不写。默认 name 是 `probe-<时间>`，seed 是 0。
- 新建一个世界并进去：超平坦（默认预设）、创造模式、允许作弊、和平难度、不生成建筑、不给奖励箱。
- 这个接口只负责「开始」：交给 Render thread 以后马上回 `{"ok":true,"started":true,"name":"probe-flat","folder":"probe-flat"}`。`name` 是存档显示名，`folder` 是 `mod/run/saves/` 下实际用的文件夹名（同名时游戏会加后缀，两个就不一样了）。
- runner 轮询 `/status`，直到 `inWorld` 是 true **而且** `screen` 是 null。只看 `inWorld` 不够：它会在加载界面关掉之前就变成 true。
- 已经在世界里，回 409 `busy`。
- 存档在 `mod/run/saves/`。探针不删任何存档，要清理就手动删。
- 超平坦默认预设：基岩 y=-64，泥土 y=-63、-62，草方块 y=-61，玩家站在 y=-60。

**3. `POST /world/leave`**

- 保存并回到主菜单。马上回 `{"ok":true,"started":true}`。runner 轮询 `/status`，直到 `inWorld` 是 false 而且 `screen` 是 `TitleScreen`。
- 不在世界里，回 409 `not_in_world`。

**4. `POST /command`**

- 请求：`{"command":"setblock 1 -60 3 minecraft:oak_stairs[facing=east,half=top]","as":"player"}`
- `command` 前面的 `/` 写不写都行。
- `as`：`player`（默认）用玩家的身份执行，单人世界里玩家有作弊权限；`server` 用服务器身份执行，权限最高，位置在世界出生点。
- 在服务器线程执行，回 `{"ok":true,"success":true,"result":1,"output":["Changed the block at 1, -60, 3"]}`。
- 命令本身失败（语法错、参数不对）也回 HTTP 200，`success` 是 false，`output` 里是游戏给的错误文字。`ok:false` 只表示探针自己出了问题。
- `success`：至少有一次执行成功就是 true。`result`：所有成功执行的结果加起来（只有一个目标时就是那个值）。语法错时游戏不调用结果回调，回 `success:false`、`result:0`。
- 不在世界里，回 409 `not_in_world`。

**5. `GET /block?x=1&y=-60&z=3`**

- 可选 `dim=minecraft:overworld`，默认是玩家所在的维度。
- 回：

```json
{"ok":true,"pos":[1,-60,3],
 "state":"minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]",
 "block":"minecraft:oak_stairs",
 "properties":{"facing":"east","half":"top","shape":"straight","waterlogged":"false"},
 "blockEntity":null}
```

- `state` 直接用 `BlockStateParser.serialize(state)` 的结果，不自己拼。
- 有方块实体时，`blockEntity` 是 `saveWithFullMetadata(registryAccess)` 转成的 SNBT 字符串（里面有 id）。
- 区块没加载，回 409 `chunk_not_loaded`。y 超出这个维度的高度范围（主世界是 -64 到 319），回 400 `bad_request`，不要报成 `chunk_not_loaded`。

**6. `POST /region`**

- 请求：`{"from":[0,-61,2],"to":[2,-59,4]}`，可选 `dim`。`from`、`to` 是两个角，包含两端，先后随意。
- 回：

```json
{"ok":true,"origin":[0,-61,2],"size":[3,3,3],
 "palette":["minecraft:grass_block[snowy=false]","minecraft:air","..."],
 "blocks":[0,0,0,"..."],
 "blockEntities":[{"pos":[1,-60,3],"nbt":"{...}"}]}
```

- `origin` 是最小角；`size` 是 `[x 方向格数, y 方向格数, z 方向格数]`。
- `blocks[i]` 是 `palette` 里的下标。`i = x + z*宽 + y*宽*长`，其中 x、y、z 是相对 `origin` 的偏移，宽 = `size[0]`，长 = `size[2]`。也就是 x 变得最快，然后 z，然后 y，和 Sponge schematic v3 一样。
- `palette` 按第一次出现的先后排，每项是 `BlockStateParser.serialize` 的结果。
- 每个方向最多 64 格（也就是最大 64×64×64），超过回 400 `too_large`。y 超出高度范围回 400 `bad_request`。有区块没加载，回 409 `chunk_not_loaded`。

**7. `POST /screenshot`**

- 请求：`{"name":"P0-001-stairs"}`，可以不写，默认 `shot`。名字只能用 `[A-Za-z0-9._-]`，1 到 64 个字符，不合规回 400 `bad_request`。
- 截下一帧游戏画面（默认带界面，和按 F2 一样；不要界面用下面的 `hideGui`），存到 `mod/run/probe-shots/<name>-<yyyyMMdd-HHmmss>.png`，同一秒里重名就在后面加 `-2`、`-3`。`path` 回绝对路径。
- 回：`{"ok":true,"path":"../mod\\run\\probe-shots\\P0-001-stairs-20261105-233000.png","width":1280,"height":720,"meanBrightness":0.43,"distinctColors":5210,"ms":180}`
- `meanBrightness`：0 到 1，每个像素 (R+G+B)/3/255 的平均值。`distinctColors`：不同 RGB 颜色的个数，不算透明度。两个都在 Java 里算。
- `width`、`height` 是实际的画面大小，系统有缩放时可能不是 1280×720。
- 可选 `"hideGui": true`（布尔值，默认 false；写成别的类型，包括 null，回 400 `bad_request`）：截一张纯世界画面，和按 F1 一样，不画手、物品栏、准星、方块描边、聊天栏和暗角。已经打开的界面（暂停菜单、聊天输入框等）照样会画，截之前要确认 `/status` 的 `screen` 是 null。做法：在 Render thread 上记下 `options.hideGui` 原来的值，设成 true，等至少 2 个完整画完的帧之后再截；截完（成功、出错、超时都算）马上改回原来的值。这个值只在内存里改，不写进 options.txt。超时还是 15 秒，超时就不再截了。默认 false 时和以前完全一样。用途：P3 和网页对比时，屋里机位的暗角会随时间变暗，网页不模仿它。

**8. `POST /quit`**

- 任何时候都能用，`ready` 之前也行（游戏卡在加载报错界面时，runner 可以正常退出，不用杀进程）。
- 先回 `{"ok":true}`，再在 Render thread 上调 `Minecraft.stop()`。
- 退出一开始探针就删掉 `xjyprobe.json`、关掉 HTTP 服务，这时游戏还在存盘，进程还在。所以 runner 判断「退干净了」要等 `/status` 给的 `pid` 进程消失，不能只看文件没了。

**9. `POST /input`**（2026-11-06 09:30 加）

- 请求：`{"locked":true}`。`locked` 必须是布尔值，写成别的类型（包括 null）或者不写，回 400 `bad_request`。任何时候都能用，`ready` 之前也行。
- 回：`{"ok":true,"locked":true}`。
- 锁上时，游戏不理会这台电脑上的键盘和鼠标：不接管（抓住、隐藏）鼠标，已经接管的马上放开；动鼠标不转视角；鼠标按键、滚轮不起作用；键盘按键全都不起作用（Esc、F1、F3、T、WASD 等）。探针自己的接口照常工作（命令、tp、截图、进出世界、退出）。窗口的关闭按钮照常能用。
- 解开以后和平常一样，但游戏不会自己去抢鼠标，要等人点进游戏窗口。
- 只改内存，不写进 `options.txt`。
- 启动参数 `-Dxjyprobe.lockInput=true`（gradle 写 `-Pxjyprobe.lockInput=true`）：游戏一启动就是锁上的。runner 自己开游戏时带上它。
- 为什么要有它：跑卡片时有人在用这台电脑，游戏窗口弹出来抢走鼠标，人一动鼠标相机就转了，截图就不对（2026-11-06 08:40 遇到过）。
- `/status` 里多三项：`inputLocked`（现在锁没锁），`mouseGrabbed`（`MouseHandler.isMouseGrabbed()`），`windowFocused`（`Minecraft.isWindowActive()`，游戏窗口是不是当前窗口）。

**10. `POST /shapes`**（2026-11-06 11:10 加）

- 用途：查一块区域里的方块是不是游戏自己会算出来的样子。栅栏、玻璃板、墙的连接，楼梯的拐角，门和床的两半，挂着的东西有没有支撑，这些都是游戏按邻居算的。网页生成的房子（P4 起）写的状态要和游戏算的一模一样，不然玩家在旁边一动，方块就会自己变样。
- 请求和 `/region` 一样：`{"from":[x,y,z],"to":[x,y,z]}`，可选 `dim`；包含两端；每个方向最多 64 格，超过回 400 `too_large`；y 超出高度回 400 `bad_request`；区域本身或者它外面一圈有区块没加载，回 409 `chunk_not_loaded`；不在世界里回 409 `not_in_world`。
- 对区域里每个不是空气的格子，算一遍 `Block.updateFromNeighbourShapes(当前状态, level, pos)`（和 `/setblock` 不带 strict 时放方块前算的一样：按 `BlockBehaviour.UPDATE_SHAPE_ORDER` 的六个方向，依次用邻居的当前状态调 `updateShape`），和当前状态比。邻居在区域外面也照样算（区域外的方块是真邻居）。
- 只读：不改世界，不通知邻居，不发方块更新，也不排计划刻（`updateShape` 要的 `ScheduledTickAccess` 传一个什么都不做的，比如 `getBlockTicks()` / `getFluidTicks()` 回 `BlackholeTickAccess.emptyLevelList()`，这样含水方块也不会排水的刻）。在 server thread 上做，超时 10 秒。
- 回：

```json
{"ok":true,"origin":[-9,-61,-17],"size":[14,9,13],"checked":541,"changed":1,
 "diffs":[{"pos":[-3,-59,-7],
           "state":"minecraft:glass_pane[east=false,north=false,south=false,waterlogged=false,west=true]",
           "game":"minecraft:glass_pane[east=true,north=false,south=false,waterlogged=false,west=true]"}],
 "truncated":false}
```

- `checked`：算过的格子数（不算空气）。`changed`：算出来和现在不一样的格子数。`diffs` 按格子下标排（`i = x + z*宽 + y*宽*长`，和 `/region` 一样），最多 256 条，多了 `truncated` 为 true，`changed` 还是总数。`state` 是现在的状态，`game` 是游戏算出来的，都是 `BlockStateParser.serialize`；会掉下来、变成空气的写 `minecraft:air`。

**11. `POST /screen`**（2026-11-07 mod6 加，看模组配置界面用）

- 不发真实键鼠，在 Render thread 上直接操作界面。body 里只写下面一种（写了两种或一种都没写回 400 `bad_request`）：
  - `{"config":"xiaojingyu"}`：打开这个模组的配置界面，和「模组 → 选这个模组 → 配置」一样（用模组登记的 `IConfigScreenFactory`），上一级是现在的界面（在世界里没开界面时，关掉就回到游戏）。没有这个模组、或者它没登记配置界面，回 404 `not_found`。
  - `{"press":"按钮上的字"}`：在现在的界面里找字完全一样（`getMessage().getString()`，开发游戏是英文就写英文）、能点、看得见的按钮（`AbstractButton`，包括列表里一行一行的），调它的 `onPress`，和用鼠标左键点一下一样。找不到回 404 `not_found`，错误文字里列出这个界面上所有的按钮。没开界面也是 404。
  - `{"close":true}`：现在的界面 `onClose()`（和按 Esc 一样）。
- 回 `{"ok":true,"screen":"CaptureConfigScreen","buttons":[{"text":"Open…","active":true}, …]}`：做完以后的界面类名（没有界面是 null）和它上面的按钮。按钮的灰不灰有些是画的时候才更新的（比如 NeoForge 配置页的「重置」），刚打开时可能还不对。
- 点了以后要等服务器回话才变的（比如配置页的「打开…」发 `/xjy blacklist`，服务器发回名单才打开黑名单界面），用 `/status` 的 `screen` 等。正在开、关世界时回 409 `busy`。超时 10 秒。

**12. `POST /use`**（2026-11-08 mod7 加，卡片换照片用）

- 模拟玩家右键一个方块，不发真实键鼠。请求：`{"pos":[10,-59,9],"face":"north","hit":[10.5,-58.5,9.9],"sneak":false}`。
  - `pos` 必填，整数。`face`：点到的面，`down` / `up` / `north` / `south` / `west` / `east`，默认 `up`。`hit`：点到的位置（世界坐标，可以有小数），默认那个面的正中。画框墙这种「点哪里换哪个」的方块要写 `hit`。`sneak`：布尔值，默认 false。
- 在服务器线程上走真右键在服务器上的那一段：`ServerPlayerGameMode.useItemOn`，用主手、手里拿的东西，NeoForge 的 `RightClickBlock` 事件照常发；`sneak` 时临时把玩家设成潜行，做完改回原来的。手里拿着方块时就是放方块（和真右键一样）。不检查够不够得着，也不经过客户端的预测。
- 回：`{"ok":true,"result":"success","consumed":true,"actionBar":"Photo 1 of 3: 海边日落"}`。`result` 是 `InteractionResult` 的类名小写（`success`、`pass`、`fail`、`tryemptyhandinteraction`），`consumed` 是右键有没有起作用（`consumesAction()`）。`actionBar`：之后 2 秒内动作栏（物品栏上面那行字）出现的新字，没有新字是 null（这时这个请求要等满 2 秒）。同一句话再发一次也算新的。
- 不在世界里回 409 `not_in_world`；区块没加载回 409 `chunk_not_loaded`；y 超出高度回 400 `bad_request`。旁观模式下右键方块大多没反应（和真游戏一样），要先 `gamemode creative`。

### 版本

- 接口有不兼容的改动时，`v` 加 1。runner 遇到不认识的 `v` 就停下报错。
- 2026-11-05 23:45 补充（兼容，`v` 还是 1）：`/world/open` 多回 `folder`；进世界要等 `inWorld` 为 true 且 `screen` 为 null；请求体超 64 KB 回 400 `too_large`；`/block`、`/region` 的 y 超出高度回 400 `bad_request`；写明 `chunksRendered` 在 tp 后要先等 1 秒左右。
- 2026-11-06 00:15 补充（兼容，`v` 还是 1）：`/quit` 在 `ready` 之前也能用；退出要等 `pid` 进程消失才算完；`/region` 是每个方向最多 64 格；写明 `/command` 的 `success`、`result` 怎么算；`/screenshot` 的名字规则、文件名格式、`path` 是绝对路径。
- 2026-11-06 07:15 补充（兼容，`v` 还是 1）：`/screenshot` 加可选的 `hideGui`（截纯世界画面，截完恢复原值）；卡片 `shot` 步骤加同名参数。
- 2026-11-06 09:30 补充（兼容，`v` 还是 1）：加 `POST /input`（锁住键盘鼠标，跑卡片时用）和启动参数 `xjyprobe.lockInput`；`/status` 多 `inputLocked`、`mouseGrabbed`、`windowFocused`。
- 2026-11-06 11:10 补充（兼容，`v` 还是 1）：加 `POST /shapes`（只读，查方块是不是游戏按邻居算出来的样子，P4 核对网页生成的房子用）。
- 2026-11-07 补充（兼容，`v` 还是 1，mod6）：加 `POST /screen`（打开模组配置界面、点按钮、关界面，不发真实键鼠）。探针的路由表超过 10 条，`ProbeServer` 改用 `Map.ofEntries`。
- 2026-11-08 补充（兼容，`v` 还是 1，mod7）：加 `POST /use`（模拟右键一个方块，回动作栏的字）；卡片加步骤 `use`。

## 怎么用

Node 这边的工具都在 `mod/tools/`，验收卡片在 `mod/cards/`。只用 Node 自带的模块，不用 `npm install`（`mod/` 下也没有 `package.json`）。

需要：

- Node 24。
- JDK 25。runner 只给自己启动的 gradlew 设 `JAVA_HOME`，默认 `../dev-env\jdk-25`，可以用环境变量 `XJY_JAVA_HOME` 或 `--java-home` 改。别指望 PATH 里的 java，那个版本不对。
- 第一次 `runClient` 要下载依赖和游戏资源（要走代理），可能要好几分钟。下载过以后，从启动到 `ready` 大约 12 秒。

### 自动验收：run-cards.mjs

```
node mod/tools/run-cards.mjs                          # 跑 mod/cards/ 下全部卡片（按文件名排序）
node mod/tools/run-cards.mjs mod/cards/P0-001.yml     # 只跑这一张
node mod/tools/run-cards.mjs --keep                   # 跑完不关游戏，方便接着用 probe.mjs 看现场
node mod/tools/run-cards.mjs --attach                 # 连已经开着的游戏
node mod/tools/run-cards.mjs --help                   # 全部选项
```

不加 `--attach` 时，runner 按顺序做这些事：

1. 先读完全部卡片、检查格式。写错了直接报「文件:行号: 原因」，退出码 2，不开游戏。
2. 看 `mod/run/xjyprobe.json`：如果有游戏正连着这个探针，就拒绝再开一个（让你用 `--attach` 或先把它关掉）；如果是上次留下的旧文件，就删掉。
3. 经过 cmd.exe 启动 `gradlew.bat runClient --console=plain -Pxjyprobe.lockInput=true`，不弹窗口，输出全部写进本次运行目录的 `gradle.log`。等待时每 15 秒打印一次 `gradle.log` 的最后一行，让你知道它在干什么。`-Pxjyprobe.lockInput=true` 让游戏一启动就锁住键盘鼠标（见下面「键盘鼠标」）。
4. 等探针写出 `xjyprobe.json`，再轮询 `/status` 到 `ready`。总时间受 `--timeout-start` 限制（默认 900 秒）。中间 gradlew 退出了、游戏停在报错界面、游戏进程没了，都会马上停下报错，不会傻等。
5. 按顺序跑卡片。每张开始前确认游戏在主菜单（上一张停在世界里就先退出世界）。某一步失败，这张卡片就停在那一步，接着跑下一张。
6. 发 `/quit`，等游戏进程（`/status` 报的 pid）和 gradlew 都退出，最多等 `--timeout-quit`（默认 90 秒）。还没退就自己动手：先按 pid 结束游戏进程（游戏 JVM 一般是早就开着的 Gradle daemon 的子进程，不在 runner 的进程树里），再 `taskkill /PID <pid> /T /F` 结束自己启动的 gradlew 进程树。按 pid 结束之前会核对这个进程的启动时间确实晚于这次启动，防止 pid 被系统复用后杀错进程。Gradle daemon 和别的进程一律不碰。

Ctrl+C：第一次打断当前这一步，照第 6 步正常收尾，退出码 2；再按一次就不等了，直接结束。

`--attach`：不启动、也不结束任何进程。没加 `--keep` 时，跑完照样发 `/quit` 并等游戏退出；加了 `--keep` 就不发 `/quit`，只把键盘鼠标恢复成原来的样子（原来没锁就解开，原来锁着就不动）。

`--keep`（不带 `--attach`）：只有全部卡片正常跑完时才把游戏留着。启动失败或者按了 Ctrl+C，还是会把游戏关掉。留着的游戏键盘鼠标还锁着，要自己在游戏里操作，先运行 `node mod/tools/probe.mjs input unlock`，再点一下游戏窗口。用完了用 `node mod/tools/probe.mjs quit` 关。

键盘鼠标：跑卡片时，runner 让游戏不理这台电脑的键盘和鼠标。有人在用电脑，也不会转动游戏里的相机、走动玩家。卡片里的命令、tp、截图都走探针，不受影响。

- 自己开的游戏：靠第 3 步的 `-Pxjyprobe.lockInput=true`，从启动起就锁着（万一没锁住，runner 会发 `/input` 补锁）。
- `--attach`：先记下原来锁没锁，开跑前发 `/input` 锁上。
- 探针太旧、没有 `/input`（回 404），或者锁的时候出了别的错：只打一行「提醒：…」，照样跑，不算失败。这时跑卡片期间别碰这台电脑的键盘鼠标。
- 锁只在内存里，游戏重开就没了。解锁后游戏不会自己抢鼠标，要人点进窗口才会。
- 不管锁没锁上，每次截图前都会核对玩家的位置和朝向（见「卡片格式」里的 shot）。

### 运行结果

每次运行一个目录：`mod/build/probe-runs/<年月日-时分秒>/`（同一秒跑两次会加 `-2`）。

- `results.json`：每张卡片、每一步的状态（`pass` / `fail` / `interrupted` / `skipped`）、耗时、结果、失败原因，检查没过时还有 `expected` 和 `actual`；另外有启动（`startup`）、键盘鼠标（`input`）、游戏进程（`game`）、收尾（`shutdown`：有没有发 `/quit`、等了多久、有没有强制结束、还剩哪些进程）、致命错误（`fatal`）。每跑完一张卡片就更新一次，中途出事也能看到前面的结果。
  - `input`：`before` 原来锁没锁（不知道是 null），`locked` 这次锁上没有，`by` 谁锁的（`launch` 启动参数、`runner` 发的 `/input`），`error` 锁的时候出的错，`restored` `--attach --keep` 时有没有恢复成原样。
  - 每张截图的结果里有 `player`（截图前玩家的位置、朝向、维度、游戏模式）和 `pose`：核对过的是 `{checked: true, source, expected, before, after}`（`before`、`after` 是截图前后和期望差多少：`dist` 格、`dYaw`、`dPitch` 度），没核对的是 `{checked: false, note: "没核对：…"}`。
- `gradle.log`：gradlew 的全部输出，最后一行记 gradlew 的退出码。`--attach` 时只有一行说明。
- `shots/`：这次运行的截图副本（原图在 `mod/run/probe-shots/`）。

`mod/build/` 会被 `gradlew clean` 整个删掉，要留的结果自己拷走。

控制台每一步打一行（`[ ok ]`、`[FAIL]`、`[STOP]` 加耗时），截图那一步下面再打一行「站位核对过了（第 N 步的 tp）」或者「没核对：…」，每张卡片打一行 `PASS <id>` 或 `FAIL <id>  第 N 步「…」（文件:行号）：原因`，最后打退出码。

退出码：

- 0：全部卡片通过，游戏也退出了。
- 1：有卡片没通过。
- 2：卡片文件写错、启动失败或超时、连不上探针、游戏中途没了、被 Ctrl+C 打断、收尾后还有进程没退出。

卡片都过了、但游戏不理 `/quit` 被强制结束时，退出码还是 0，`results.json` 里 `shutdown.forced` 是 true。

### 手动调试：probe.mjs

游戏开着时（比如用 `--keep` 跑完卡片），可以一条一条发请求，输出探针回复的 JSON：

```
node mod/tools/probe.mjs status
node mod/tools/probe.mjs open test1                  # 开超平坦世界 test1
node mod/tools/probe.mjs wait inWorld=true screen=null
node mod/tools/probe.mjs cmd setblock 1 -60 3 "minecraft:oak_stairs[facing=east,half=top]"
node mod/tools/probe.mjs block 1 -60 3
node mod/tools/probe.mjs region 0 -61 2 2 -59 4      # 每个方向最多 64 格
node mod/tools/probe.mjs shapes -5 -60 -13 8 -52 -1  # 是不是游戏按邻居算出来的样子（每个方向最多 64 格）
node mod/tools/probe.mjs shot test1
node mod/tools/probe.mjs shot test1-world --hide-gui # 不带界面（像按 F1）
node mod/tools/probe.mjs screen config xiaojingyu   # 打开模组的配置界面（接口 11，不发真实键鼠）
node mod/tools/probe.mjs screen press Done           # 点界面上字是 Done 的按钮
node mod/tools/probe.mjs screen close                # 关掉界面（像按 Esc）
node mod/tools/probe.mjs use 10 -59 9 --face north   # 右键这个方块（接口 12）；--hit x y z 点到的位置，--sneak 潜行
node mod/tools/probe.mjs leave
node mod/tools/probe.mjs input unlock                # 解开键盘鼠标（要自己在游戏里操作时；解开后点一下游戏窗口）
node mod/tools/probe.mjs input lock                  # 锁住：游戏不理这台电脑的键盘鼠标
node mod/tools/probe.mjs quit                        # 默认等游戏进程消失才返回
```

- 带方括号的方块状态在命令行里要加引号，不然 shell 可能把它当通配符。
- `cmd ... --as server` 用服务器身份（最高权限）执行。这时 `~ ~ ~` 是世界出生点，不是玩家的位置，所以卡片里一律写绝对坐标。
- `wait` 的值会转换类型：`true`、`false`、`null`、数字，其它当字符串。
- 退出码：请求成功 0（命令本身失败也是 0，看回复里的 `success`）；探针报错或连不上 1，输出 `{"ok":false,"error":"错误码","message":"..."}`；参数写错 2。`--help` 看全部用法。

常用流程：`run-cards.mjs --keep` 跑一遍 → 失败了用 `probe.mjs` 看现场 → 改卡片 → `run-cards.mjs --attach --keep` 再跑（不用重开游戏）→ 最后 `probe.mjs quit`。

`mod/run/` 是游戏的运行目录（存档、截图、配置、`xjyprobe.json`），同一时间只能有一个游戏在用。几个人同时开发时，开游戏或者跑 gradlew 之前先拿锁：在 bash 里 `( set -o noclobber; echo "<名字> $(date +%H:%M:%S) <在干什么>" > tmp/mod.lock )`，失败说明别人在用（`cat tmp/mod.lock` 看是谁），过一会儿再试；用完 `rm -f tmp/mod.lock`。别人的锁不要删。

### 跑测试

```
node --test mod/tools/test/*.test.mjs
```

不开游戏，也不用 Gradle，大约 40 秒。

- `mod/tools/test/mock-probe.mjs`：假探针（node:http），在内存里存方块，按上面的接口约定回复，包括 401、403、409 等错误。也有 `/input` 和 `/status` 里的 `inputLocked`、`mouseGrabbed`、`windowFocused`；`tp @s` 照真游戏的规则改玩家的位置和朝向。`oldProbe: true` 时没有这些，用来测旧探针。`/shapes` 只算栅栏和玻璃板的连接、灯笼挂没挂住、门的两半（`mock-shapes.mjs`），楼梯形状不算，要在真游戏里查。
- `mod/tools/test/fake-game.mjs`：假的 gradlew 加假游戏，用来测 runner 的启动和收尾。「游戏」进程会脱离 runner 的进程树，和真的 Gradle daemon 一样。
- `mod/tools/test/mock-xjy.mjs`：给假探针加上假的 `/xjy capture|place|undo|status|blacklist` 和 `setblock`、`fill`、`execute if …`、`tick freeze|unfreeze`、`give`（读写鲸图用 web 那边的 `V3.share`），不开游戏也能把 P2 的卡片从头跑一遍。capture 照 `docs/COMMANDS.md` §2 把黑名单里的方块和水、岩浆、气泡柱当空气，含水的去掉水；`/xjy blacklist` 不带子命令时 `/status` 的 `screen` 变成 `BlacklistScreen`；不带方块的 `add`/`remove` 按玩家的位置和朝向找准星对着的方块（2026-11-07 mod4 加，给 P2-005 用）。`/xjy capture 上次|last [名字]`（COMMANDS.md §2b）：place 放完（status 回到 0）才记成「上次」，按世界（`/world/open` 开的那个）分开记，undo 删掉它那条，抓的时候格子和 facing、axis、连接属性转回原文件的摆法；`/xjy status` 的输出多一行 `Last placed: 文件名, turned N°`（2026-11-07 mod5 加，给 P4-003 用；`last-place.test.mjs` 把 P4-003 对着 mock 跑一遍，截图、等画面、sleep 不跑）。抓取范围（COMMANDS.md §2，2026-11-07 mod6 加，给 P2-006 用）：不写数字的 capture 和 3 个数字的写法的往后，每次现读游戏目录的 `config/xiaojingyu-common.toml`（没有就是默认值，超出范围截到界上；真游戏是 NeoForge 读、文件变了约 1 秒后重读，mock 马上就是新的）；认 `/xjy capture 范围|range <前> <后> <左右> <高> [名字]`；`/xjy status` 多一行 `Plain /xjy capture takes … the same as /xjy capture range F B S U.`。mock 没有 `/screen`（接口 11）。mock-probe 的 `/use`（接口 12，2026-11-08 mod7 加）只查参数、记下请求，回什么由测试给的 `onUse(请求, api)` 定，不给就是「没起作用」；不会换照片。照片方块（相册矮桌、相框、画框墙）的方块实体和模组一样不写空的 `components`。它不会按邻居重新算连接属性，也不会掉落物品，水和岩浆不会流、也不会碰到一起变成石头，所以卡片里要把游戏算好的属性写全（写全了对真游戏也没坏处）。「默认跑 mod/cards/ 下的全部卡片」这个测试就是这样跑的：P0、P2 的卡片必须通过，P3、P4 的卡片用了 mock 不认识的命令（`gamerule`、`gamemode`），允许失败。P4 盖房子、核对的那几步另有测试 `p4-cards.test.mjs`（截图那一段不跑）。
- `mod/tools/test/helpers.mjs`：测试共用的小工具。

这三个文件故意不叫 `*.test.mjs`，不然会被当成测试执行。不要写成 `node --test mod/tools/test/`：Node 24 会把目录当成一个测试文件，报 `Cannot find module`。

## 卡片格式

卡片是 `mod/cards/` 下的 `.yml` 文件，一个文件一张卡片，runner 按文件名顺序跑。例子：

```yaml
id: demo                  # 不写就用文件名；只能用字母、数字和 . _ -
title: 放一块石头
steps:
  - open: demo            # 开超平坦世界 demo
  - wait:
      inWorld: true
      screen: null
      timeout: 180
  - cmd: setblock 1 -60 3 minecraft:stone
  - expect_block:
      pos: [1, -60, 3]
      state: minecraft:stone
  - leave
  - wait: {inWorld: false, screen: TitleScreen}
```

- 最外层只能有 `id`、`title`、`steps`。`steps` 按顺序执行，一步失败这张卡片就停下。
- 每一步写成「`- 步骤名`」或者「`- 步骤名: 参数`」，一步只能有一个键。不认识的步骤或参数、类型不对，开游戏之前就会报「文件:行号: 原因」。
- 卡片从主菜单开始，最后回到主菜单。忘了 `leave` 也没关系，runner 跑下一张之前会先退出世界。
- 卡片里任何字符串都可以写 `${run}`，跑的时候换成这次运行的编号（就是 `mod/build/probe-runs/` 下运行目录的名字，比如 `20261106-063727`）。写进 `mod/run/xiaojingyu/` 的文件（`xjy capture` 的名字、`copy_file` 的 `to`）一定要带上它：那个文件夹不会自动清理，同名文件也不会被覆盖，不带的话第二次跑就对不上了。除了 `${run}` 别的 `${…}` 都会报错。开游戏前先用一个假编号检查一遍卡片。
- 卡片之间不要互相影响：每张卡片开自己的世界（`open` 用不同的名字），`/xjy undo` 的记录、放过的方块都不会带到下一张。

### 步骤

**open**：新开一个超平坦世界（创造模式、开作弊、和平、不生成结构）。

- `- open`、`- open: 名字`，或者 `- open: {name: 名字, seed: 123}`。名字默认用卡片 id，seed 默认 0。
- 它只是开始加载，后面一定要跟 `wait: {inWorld: true, screen: null}`。
- 同名存档已经有了，游戏会给文件夹名加后缀，探针不会删旧存档。

**leave**：退出到主菜单。同样只是开始退出，后面跟 `wait: {inWorld: false, screen: TitleScreen}`。

**wait**：每 0.25 秒问一次 `/status`，直到写的条件全部成立。

- 条件：`ready`、`inWorld`（true/false）、`chunksRendered`（true/false/null）、`screen`（界面的类名，比如 `TitleScreen`；null 表示没开界面）。至少写一个，比较是严格相等。
- `timeout`：秒，默认 60。超时这一步就失败，`results.json` 里记最后一次 `/status`。
- `stableFor`：秒，默认 0。条件要连续成立这么久才算数。
- 进世界一定要同时等 `inWorld: true` 和 `screen: null`。`inWorld` 在加载界面关掉之前就会变 true。
- tp 之后先 `sleep: 1`，再等 `chunksRendered: true`（最好加 `stableFor: 2`）。tp 后一两个 tick 里它会短暂是 true，那时候其实还没画完。

**cmd**：执行一条游戏命令（开头的 `/` 可写可不写）。

- 简写：`- cmd: time set noon`。
- 完整写法：`- cmd: {command: ..., as: server, success: any, outputContains: ..., timeout: 30}`。
- `as`：`player`（默认）或 `server`（见上面 probe.mjs 那里的说明）。
- `success`：默认 true，要求命令成功；false 要求失败；`any` 不管成败。
- `outputContains`：一个字符串或字符串列表，命令输出里必须都出现。
- `timeout`：秒，默认 20。
- `result`：整数。命令必须成功，而且 `result` 必须正好等于它。比如 `- cmd: {command: 'xjy place house-${run}', result: 210}`。开发版游戏是英文的，输出文字以后可能会改，能用 `result` 判断的就别用 `outputContains`。
- `until`：反复执行这条命令，直到 `result` 等于这个数。写成 `until: 0`，或者 `until: {result: 0, timeout: 60, interval: 0.5}`（秒，默认 60 和 0.5）。中途命令失败了就马上算这一步失败；超时也失败，并报最后一次的 `result`。用来等 `/xjy place`、`/xjy undo` 放完：`- cmd: {command: xjy status, until: 0}`。`until` 不能和 `result`、`success: false`、`success: any` 一起用。
- `until` 里也可以写 `outputContains`（一个字符串或列表，2026-11-07 mod6 加）：反复执行到输出里这些字都有，比如 `until: {outputContains: ' 16 7 8 12', timeout: 15}`（等改过的模组配置生效）。和 `result` 一起写就两个都要满足；只写 `outputContains` 也行。等不到时报最后一次的输出。

**expect_block**：读一格方块，和期望比较。

- `pos: [x, y, z]`、`state`（完整的方块状态字符串，精确比较，写法见下面）必填。
- `blockEntityContains`：一个字符串或字符串列表，方块实体的 SNBT 里必须都出现，比如 `'id:"minecraft:chest"'`。写了这个而这一格没有方块实体，也算失败。
- `dim`：维度，比如 `minecraft:the_nether`，默认是玩家所在的维度。

**use**：模拟玩家右键一个方块（探针接口 12，2026-11-08 mod7 加），不发真实键鼠。比如 `- use: {pos: [10, -59, 9], face: north, consumed: true, actionBarContains: 'Photo 1 of 3'}`。

- `pos: [x, y, z]` 必填。`face`（默认 `up`）、`hit: [x, y, z]`（点到的位置，世界坐标，可以有小数）、`sneak: true` 可选，意思见接口 12。
- 检查（都可以不写）：`consumed: true / false`（右键有没有起作用）；`actionBarContains`：一个字符串或列表，动作栏的新字里都要有（开发游戏是英文）。动作栏没有新字时，写了 `actionBarContains` 就算失败。
- 右键之后改了什么用 `cmd` 查，比如 `- cmd: {command: 'data get block 10 -59 9 Photo.Id', outputContains: '3b473d58d2581555'}`；没有这个键时 `data get` 失败，写 `success: false`。`data get` 一个列表或数组时 result 是它的长度。

**expect_region**：读一块区域。

- `from`、`to`：两个角（包含两端，先后随意），每个方向最多 64 格。
- `size: [x, y, z]`：可选。要和 `from`/`to` 算出来的一致，不一致开游戏前就报错，用来防止把坐标写错。
- `palette`：方块状态列表，每一项都必须在区域里出现过（区域里多出别的状态没关系）。
- `at`：检查区域里的某几格，`[{pos: [x, y, z], state: ...}, ...]`，只查一格时也可以直接写 `{pos: ..., state: ...}`。pos 必须在区域里面。
- `size`、`palette`、`at` 至少写一样。`dim` 同上。

**shot**：截图。

- `- shot`、`- shot: 名字`，或者 `- shot: {name: ..., meanBrightness: [0.05, 0.95], distinctColors: 50}`。名字默认用卡片 id，只能用字母、数字和 `. _ -`，最多 64 个字符。
- 截图默认带快捷栏和准星（和按 F2 一样）。原图在 `mod/run/probe-shots/<名字>-<时间>.png`，runner 再拷一份到运行目录的 `shots/`。
- `hideGui: true`：截不带界面的纯世界画面（和按 F1 一样：没有手、快捷栏、准星、方块描边、聊天栏和暗角），比如要和网页渲染的图对比的时候。只能写不加引号的 `true` 或 `false`，写成别的（`"true"`、`1`、`yes`）开游戏前就报卡片错误。不写就不发这个参数，和以前一样带界面；截完游戏自己把界面开关改回原样。命令行里对应 `probe.mjs shot 名字 --hide-gui`。
- `meanBrightness`：整张图平均亮度（0 到 1）必须在这个范围里。`distinctColors`：不同颜色的数量不能少于这个数。这两个只能挡住黑屏、白屏、一种颜色铺满这类明显的坏图；画面对不对，还是要人看图。
- 截图前核对站位：拿这张卡片进世界以后最近一次成功的 `tp @s x y z yaw pitch`（绝对坐标、写了朝向、`as: player`）和 `/status` 的 `player` 比：位置差不超过 0.01 格，yaw（按 360° 取余）和 pitch 差不超过 0.5°。tp 刚发完可能还没生效，最多等 2 秒；还对不上，这一步失败，错误码 `pose_changed`，不截图。截完再读一次，这时对不上也算 `pose_changed`（图照样留着）。坐标照游戏的规则算：x、z 写整数（不带小数点）时按方块中心算，加 0.5。
- 最近的 tp 用了 `~` 或 `^`、`facing`、没写朝向、tp 到别的实体、套在 `execute` 里、`as: server`，或者进世界以后还没 tp 过，就不核对，结果里记一句「没核对：…」，控制台也打出来。
- `pose: {x: …, y: …, z: …, yaw: …, pitch: …}`：不看 tp，按这里写的核对，五个都要写，pitch 在 -90 到 90 之间（比如 tp 用了相对坐标，但你知道站在哪）。`pose: false`：这张不核对。写成别的开游戏前就报卡片错误。
- 创造模式下 tp 到半空，玩家会往下掉，核对就过不了。截图的位置要么站在地上（超平坦是 y=-60），要么先 `gamemode spectator`。

**sleep**：等几秒，比如 `- sleep: 1`（可以写小数，大于 0、最多 600）。

**snapshot**：把一个盒子里的方块记下来，给后面的 `expect_same` 用。

- `- snapshot: {name: A, from: [x, y, z], to: [x, y, z]}`，`dim` 可选。`from`/`to` 是两个角（包含两端）。
- 记的是每一格的完整状态，和每个方块实体的 id、位置、数据。盒子大于 64 格的方向会分几次读，一共最多 1048576 格。
- 只在这张卡片里有效。

**expect_same**：再读一个一样大的盒子，必须和某个 snapshot 一模一样。

- `- expect_same: A`（读原来的位置），或者 `- expect_same: {snapshot: A, at: [x, y, z]}`（`at` 是新盒子的最小角，用来比「搬到别处放下」的结果）。
- 每一格的状态精确比较；方块实体比位置（相对盒子）、id 和数据。数据里去掉 `x`、`y`、`z`，其余全部比较（数字类型也算，`3b` 和 `3` 不一样）；键的顺序不管，列表的顺序要一样。
- 不一样时报前 8 处不一样的地方（世界坐标）和一共几处。
- 前面没有同名的 snapshot，开游戏前就报错。

**expect_file**：拿一个鲸图（`.png` / `.schem`）或者 dump（`.json`，见 `docs/FORMAT.md` §4）和游戏里比。

- 文件二选一：`file: fixtures/share/cases/p0-blocks.json`（仓库里的相对路径），或者 `saved: 名字`（`mod/run/xiaojingyu/` 里的文件，比如 `xjy capture` 刚拍的；可以省掉 `.png`）。
- `at: [x, y, z]`：模型的 `[0, 0, 0]` 那一格在世界里的坐标（就是盒子的最小角）。
- `size`、`offset`：可选，写了就先检查文件里的大小和 Offset，防止拿错文件或者坐标算错。
- 比较规则和 `expect_same` 一样。文件里没有数据的方块实体按空数据算。
- `.png` / `.schem` 是调 `node web/tools/share.mjs dump` 读的，和网页用的是同一份代码。读不出来（比如普通图片）这一步就失败，报 share.mjs 的错误码。

**expect_files**（2026-11-07 mod5 加，给 `/xjy capture 上次` 用）：两个鲸图（或 dump）逐格比，不读世界。用来查「capture 上次 抓回来的」和「当初 place 的那张」是不是同样大小、同样摆法、只差卡片里写的那几格。

- 原来的文件二选一：`file: fixtures/house-v4/house-v4-b.json`（仓库里的），或者 `saved: 名字`（`mod/run/xiaojingyu/` 里的，可以省掉 `.png`）。
- `capture: 名字`：`xjy capture` 抓出来的文件（`mod/run/xiaojingyu/` 里的，可以省掉 `.png`），必填。
- 先比大小、`Offset`（没有当 [0, 0, 0]）、`Metadata.Xiaojingyu.Facing`（两边都没有也算一样），有一样不同就失败。
- `fromPlace: {file: 当初 place 的文件名（带扩展名）, turn: 0/90/180/270}`：可选，查 capture 出来的文件里的 `Xiaojingyu.FromPlace`（FORMAT.md §3.1）。
- `diffs`：可选，期望不一样的格子：`[{pos: [x, y, z], was: 原来的状态, now: 抓出来的状态}, …]`。`pos` 是**模型里的格子**（从 0 起，和 dump 一样：x 是第几列，y 是第几层，z 是第几行），不是世界坐标；状态要写全（规则和 `expect_block` 一样）。这几格必须正好是 was → now；这几格的方块实体不比。
- 其余每一格的状态必须一样，方块实体比 id 和数据（规则和 `expect_same` 一样）。不一样时报前 8 处（模型格子）和一共几处。
- 例子（P4-003）：`- expect_files: {file: fixtures/house-v4/house-v4-b.json, capture: 'P4-003-R90-${run}', fromPlace: {file: 'P4-003-${run}.png', turn: 90}}`。

**expect_shapes**：查一片区域里的方块是不是游戏按邻居算出来的样子（调 `/shapes`，接口 10）。`setblock … strict` 和 `/xjy place` 放下的状态游戏不会重算；状态不对的话，玩家在旁边一动它就会变：楼梯拐角变直、栅栏和玻璃板的连接变了、门只剩半扇掉成物品、灯笼掉下来。

- 区域二选一：`from: [x, y, z]` 和 `to: [x, y, z]`（两个角，含两头），或者 `file`（仓库里的 dump `.json` / 鲸图 `.png` / `.schem`）加 `at`（模型 `[0, 0, 0]` 那一格的世界坐标，和 `expect_file` 一样；区域大小按文件算）。可以加 `dim`。
- `changed` 是 0 才算过。不过就报一共几格不对，再列前 10 格：世界坐标、现在的状态、游戏算出来的状态（`minecraft:air` 是这一格站不住、会掉）。`results.json` 里有总数和最多 256 格的明细。
- 区域里一个方块都没有（全是空气）也算失败：多半是坐标写错了。
- 超过 64 格的区域分几次查，结果合在一起。区域外面的邻居也算数（比如门下面那一格）。
- 探针太旧没有 `/shapes`：这一步失败，错误码 `shapes_unsupported`，重新编译、启动开发游戏再跑。
- 例子（P4-002，房子盖好以后）：`- expect_shapes: {file: fixtures/house-v4/house-v4-b.json, at: [-6, -60, -15]}`。

**copy_file**：把仓库里的一个文件拷进 `mod/run/xiaojingyu/`。

- `- copy_file: {from: fixtures/share/js/p0-blocks.png, to: 'p0-${run}.png'}`。`to` 只能是文件名，不写就用原来的名字。
- 那里已经有同名文件就失败，从不覆盖。所以 `to` 要带 `${run}`。
- 只往 `xiaojingyu/` 里拷。游戏目录是 `--probe-file` 所在的文件夹（默认 `mod/run/`）。

**config**（2026-11-07 mod6 加，给抓取范围的配置用）：改游戏目录 `config/` 下的一个 `.toml`（模组配置，开发游戏是 `mod/run/config/`）。

- `- config: {set: {captureBack: 7}}`、`- config: {file: xiaojingyu-common.toml, set: {captureFront: 3, captureUp: 3}}`。`file` 只能是文件名，默认 `xiaojingyu-common.toml`；`set` 至少一项，键是顶层的键（字母、数字、`_`、`-`），值是整数、true / false 或字符串。
- 只改文件里顶层那一行的值（`键 = 值`），注释和别的行原样留着；没有这个键就加在最前面；文件没有就新建。先写临时文件再换掉原文件，游戏读不到写了一半的文件。
- 游戏不是马上用新的值：NeoForge 盯着配置文件，发现变了大约 0.5–1 秒后自己重读。所以后面要等它生效，比如 `- cmd: {command: xjy status, until: {outputContains: ' 16 7 8 12', timeout: 15}}`（`/xjy status` 有一行写着现在的抓取范围）。
- **卡片结束时（过没过都）runner 把这张卡片改过的文件原样写回去**（原来没有的就删掉），`results.json` 里这张卡片多一项 `restored`（写回去的文件），写不回去记在 `restoreError`。所以一张卡片中途失败，也不会把改过的配置留给后面的卡片。卡片最后最好自己也改回默认值。

### 方块状态怎么写

- 格式：`命名空间:名字[属性=值,属性=值]`。属性按名字的字母顺序写，因为游戏读回来就是这个顺序；写乱了、或者没写 `minecraft:`，开游戏前就报错。
- `setblock` 时没写的属性，游戏会补上默认值。`expect_block`、`at`、`palette` 里要写补全后的完整字符串。例如放 `minecraft:oak_stairs[facing=east,half=top]`，读回来是 `minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]`。
- 拿不准时先用 `probe.mjs` 放一个、读回来，确认这个值符合这种方块的属性规则，再抄进卡片。不要为了通过把比较放宽成「包含」。
- 有些属性会跟着邻居重算：楼梯的 `shape`、箱子的 `type`（两个箱子挨着会变成大箱子）。要检查的方块之间隔开一格。
- 草方块上面压着完整方块，过一会儿可能变成泥土。不要检查原木、箱子这类方块正下方的草。

### 坐标

- 超平坦默认地形：y=-64 基岩，-63 和 -62 泥土，-61 草方块，玩家站在 -60。方块放在 y=-60。
- 出生点每次不一样，卡片里写绝对坐标。截图前用 `tp @s x y z yaw pitch` 把玩家放到固定的位置和朝向（yaw 0 朝南，也就是 z 增大的方向）。runner 截图前会拿这条 tp 核对玩家的站位（见上面 shot）。
- 世界里有乱跑的动物，截图前可以 `kill @e[type=!minecraft:player]`。没有东西可杀时这条命令算失败，所以要写 `success: any`。

### 搭场景和 /xjy 命令

- 门、床这种两格的方块，两半都用 `setblock … strict` 放。不加 strict 时游戏会按邻居重算形状，单独放下的半个门会直接变成空气。
- 其他方块用普通 `setblock`，按「先放被靠的，再放靠上去的」顺序：先天花板再挂灯笼，先墙再放墙上的火把、梯子、告示牌，先地面再放红石线和立着的告示牌。栅栏、墙、红石线的连接属性是游戏按邻居算出来的，`expect_block` 里要写算完的值，第一次真跑时确认。
- 清空一个盒子用 `fill … minecraft:air strict`。不加 strict 的话，靠着别的方块的东西（火把、梯子、告示牌）会掉成物品，箱子里的东西也会撒出来。
- 查「附近没有掉落物」：`- cmd: {command: 'execute if entity @e[type=minecraft:item,x=…,y=…,z=…,dx=…,dy=…,dz=…]', success: false}`。卡片开头先 `kill @e[type=!minecraft:player]`（`success: any`）。
- 开发游戏才认的测试开关放在命令存储 `xiaojingyu:dev`：`wind_chime.*`（风铃响了几次）；`photo_chunk_budget`（区块包里照片的字节预算，写个小数就能测「超出的单独补发」，用完 `data remove`）、`photo_late_sent`（补发了几个方块实体）。发布版不读不写。例子见 P5-004（`node mod/tools/photo-card.mjs` 生成，别手改）。
- `/xjy place`、`/xjy undo` 会分几个 tick 放完，没放完时读到的是半成品。每次之后都要 `- cmd: {command: xjy status, until: 0}`。
- `/xjy` 的成败只看 `success` 和 `result`（`docs/COMMANDS.md` §6）：capture 的 result 是非空气的格子数，place 和 undo 是盒子的格子数（含空气），status 是还没放完的格子数。
- 转向后的坐标要手算，写在卡片开头的注释里。规则见 `docs/COMMANDS.md` §1、§3（站的那一格 S、朝向 F、右手方向 R；auto 时把文件里的 Facing 转到玩家的朝向）。例子见 `mod/cards/P2-001.yml`。
- 站位用 `tp @s x.5 -60 z.5 <yaw> 0`：yaw 180 朝北，-90 朝东，0 朝南，90 朝西。站在方块中心，朝向才不会算错。

### 卡片里的 YAML

卡片用的是自己写的 YAML 子集（`mod/tools/yaml-lite.mjs`），不是完整的 YAML。

能用的：

- 「键: 值」映射、「- 」开头的列表、用空格缩进表示嵌套（列表可以和它的键缩进一样多）。
- 行内列表 `[1, -60, 3]`、行内映射 `{a: 1, b: [2, 3]}`，可以嵌套，但必须写在一行里。
- 不加引号的字符串、单引号（`''` 表示一个单引号）、双引号（`\"`、`\\`、`\n`、`\uXXXX` 这些转义）。
- 整数、小数；`true`/`false`；`null`、`~` 或者什么都不写都是 null。
- `#` 注释，`#` 前面要有空格，引号里的 `#` 不算。

什么时候要加引号：

- 方块状态、命令写在「键: 值」或「- 」后面时，可以不加引号，比如 `state: minecraft:oak_log[axis=x]`、`- cmd: kill @e[type=!minecraft:player]`。
- 写在 `[ ]` 或 `{ }` 里面时，带 `:`、`[`、`]`、`,`、`{`、`}` 的值要加引号，比如 `palette: ['minecraft:air', 'minecraft:stone']`。
- 值里有「: 」（冒号加空格）或者以冒号结尾，要加引号。
- 以 `@`、`&`、`*`、`!`、`|`、`>`、`%`、`?`、反引号开头的值要加引号，比如 `'@s'`。
- 想要字符串 `"true"`、`"123"` 而不是布尔或数字，加引号。超过 2^53 的整数也要加引号。

不支持（会报错并给出行号）：tab 缩进、锚点和引用（`&`、`*`）、多行字符串（`|`、`>`）、标签（`!`）、`---` 和 `...`、同一层重复的键、跨行的 `[ ]` / `{ }`。

## 排错

先看控制台最后几行，再看 `results.json` 里的 `fatal`（`error`、`message`、`hint`）。

`fatal.error` 常见的值：

- **卡片写错（退出码 2，还没开游戏）**：照「文件:行号」改。
- **`game_running`**：已经有游戏连着 `mod/run/xjyprobe.json`。用 `--attach` 连上去跑，或者 `node mod/tools/probe.mjs quit` 关掉它。先问问是不是别人正在用。
- **`no_java`**：`JAVA_HOME` 下面没有 `bin\java.exe`。用 `--java-home` 或 `XJY_JAVA_HOME` 指到 JDK 25。
- **`start_failed`**：gradlew 在探针起来之前就退出了。控制台会打出 `gradle.log` 的最后 25 行，常见原因是编译错误、依赖下载失败（第一次要走代理）。
- **`start_timeout`**：等探针文件或者 `ready` 超时。第一次启动要下载资源，可以加大 `--timeout-start`；看 `gradle.log` 卡在哪一步。
- **`load_error`**：游戏停在模组加载的报错或警告界面，到不了主菜单。看游戏窗口或 `gradle.log` 里的 ERROR / WARN，找是哪个模组。只是警告的话，可以在 `mod/run/config/neoforge-client.toml` 里设 `showLoadWarnings = false`。
- **`unauthorized` / `forbidden`**：token 不对（多半是别的游戏留下的 `xjyprobe.json`），或者请求带了 `Origin`、`Host` 不对。正常用 runner 和 probe.mjs 不会遇到。
- **`version_mismatch`**：探针和工具的接口版本 `v` 对不上，先把两边的代码更新到一致。
- **`connect_failed`**：`--attach` 时连不上。游戏没开，或者 `xjyprobe.json` 是旧的。
- **`game_exited`**：游戏进程中途没了，多半崩了。看 `gradle.log` 末尾和 `mod/run/crash-reports/`。
- **`cleanup_failed`**：两张卡片之间回不到主菜单，看看游戏窗口是不是弹了什么界面。

某一步 `FAIL`：控制台有原因，`results.json` 里有 `expected` 和 `actual`。先判断实际值对不对（符不符合这种方块的规则）：实际值是对的，就改卡片，并写明改了什么、为什么；实际值不对，是模组或探针的问题，交给写 Java 的人。

其它情况：

- **收尾时提示「还有进程没退出」（退出码 2）**：按提示里的 pid 手动结束（`taskkill /PID <pid> /T /F`）。只结束提示里的那些，不要动 Gradle daemon 和别的 java 进程。
- **runner 被强行结束了**（任务管理器结束 node、直接关掉终端）：它来不及收尾，gradlew 和游戏可能还开着。先 `node mod/tools/probe.mjs quit`；探针不回应，就按 `mod/run/xjyprobe.json` 里的 `pid` 结束游戏进程。
- **超时发生在探针写出 `xjyprobe.json` 之前**：runner 还不知道游戏的 pid，只能结束自己启动的 gradlew 进程树。游戏 JVM 是 Gradle daemon 启动的，一般会跟着这次构建被取消一起退出（没专门验证过）；如果游戏窗口还开着，手动关掉。
- **`chunksRendered` 一直不是 true**：tp 之后要先 sleep 一下再等；视距太大也会慢（`mod/run/options.txt` 里的 `renderDistance`，现在是 8）。
- **截图全黑或者一种颜色**：多半是没等 `chunksRendered` 就截了，或者游戏窗口被最小化了。
- **截图那一步 `pose_changed`（「截图前（或截图时）玩家的位置或朝向变了…」）**：开发游戏的窗口弹出来时会抢鼠标，以前跑卡片期间有人动鼠标，相机就跟着转，截出来的角度不对，runner 也没发现（2026-11-06 08:40 遇到过：卡片要 145° / 17°，实际 129.4° / 往正下看）。现在 runner 锁住键盘鼠标，截图前后都核对站位，对不上就让这一步失败。遇到了：
  - 先看控制台开头有没有「提醒：这个探针太旧…」或「提醒：锁键盘鼠标没成功…」。有的话就是没锁上，又有人动了键盘鼠标。跑卡片期间别碰这台电脑，重跑一次。
  - 锁上了还对不上，多半是卡片的问题：tp 到了半空（创造模式会往下掉）、tp 进了方块里被挤出来，或者 tp 之后又有命令移动了玩家。对照 `results.json` 里这一步的 `expected`、`actual` 和 `result.player` 改卡片。
  - 不要放宽误差，也不要为了通过写 `pose: false`。只有确实不需要固定站位的截图才写 `pose: false`。
  - 「截图时」对不上的，图照样拷进了 `shots/`，可以看看被动成了什么样。
- **控制台提醒「这个探针太旧，没有 /input」**：`--attach` 连上的游戏是改代码之前开的。卡片照样跑，但锁不住键盘鼠标。重开一次游戏（不加 `--attach` 跑 runner，会重新编译），或者跑卡片期间别碰键盘鼠标。
- **跑完以后游戏里点了、按了都没反应**：游戏还锁着（`--keep` 留下的，或者 runner 被强行结束了）。运行 `node mod/tools/probe.mjs input unlock`，再点一下游戏窗口。
- **日志里有 `SavedDataStorage: Could not save data to data_attachments.dat`（或 `chunk_tickets.dat`）和 `AccessDeniedException`**：退出存档时 Windows 拒绝了文件改名，原版和 NeoForge 的问题，跟探针无关，存档没坏。见 `mod/README.md`「已知问题」，不算验收失败。
- **存档和截图越来越多**：探针从不删 `mod/run/saves/` 和 `mod/run/probe-shots/`，游戏没开的时候可以手动清理。`mod/run/xiaojingyu/` 里卡片拍的和拷进去的鲸图也一样（文件名里带运行编号，删了不影响以后的运行）。

P2 的那几种步骤：

- **`expect_same` / `expect_file` 报「有 N 处不一样」**：控制台只列前 8 处，带世界坐标；`results.json` 里 `actual.mismatches` 是总数，`actual.first` 是前几处。先看是不是场景搭得不对：某个方块没站住（灯笼、火把、梯子、牌子要先放它靠着的方块），或者游戏按邻居重新算了楼梯形状、墙和栅栏的连接；门和床要用 `setblock … strict` 两半都放。场景没问题，就是 `/xjy` 命令放错了，交给写 Java 的人。
- **`expect_files` 报「有 N 处不对」**：位置是模型里的格子 (x, y, z)，不是世界坐标；换成世界坐标要看当初 place 站在哪、转了几度（卡片开头的注释）。「原来是 A，抓出来是 B」= 卡片没写这一格却不一样（多半是改世界的那几步改到了别的格子，或者 capture 上次 转错了）；「期望抓出来是 X，实际 Y」= 卡片写了这一格，但改得不对。`Facing`、`Offset`、大小不一样的话先报这个，不逐格比。
- **「方块实体 … 的数据不一样：.Items[0].count：期望 {"int":3}，实际 {"int":2}」**：前面是 NBT 里的路径，后面是带类型的值（格式见 `docs/FORMAT.md` §4）。比较时已经去掉了 `x`、`y`、`z`，`id` 单独比。
- **「SNBT 第 N 个字符：…」**：探针回的方块实体文字里有 `mod/tools/lib/snbt.mjs` 不认识的写法。它是照着 MC 26.1 的 `StringTagVisitor` 写的，只认游戏自己打印出来的格式；游戏升级后格式变了就要更新它，不要放宽成「猜着读」。
- **「<文件> 读不出来：no_data：…」**：`expect_file` 读 `.png`、`.schem` 是调 `node web/tools/share.mjs dump`，后面的错误码是鲸图读取器给的：`no_data` 是一张普通图片（没有方块数据），`unknown_file` 是既不是 PNG 也不是 .schem。错误码的意思见 `docs/FORMAT.md`。
- **`copy_file` 报「已经有了，不覆盖」**：目标文件名里没带 `${run}`，上次运行已经拷过一份。
- **`xjy status` 的 `until` 等超时**：放置或撤销一直没放完（进度只发在游戏聊天栏里，看游戏窗口），或者游戏太卡。大建筑可以把 `until` 的 `timeout` 调大。
- **查掉落物的 `execute if entity @e[type=minecraft:item,…]` 成功了**：附近有掉落的物品。多半是清场地时没用 `fill … minecraft:air strict`，或者方块没了靠着的东西掉了下来；如果是撤销、放置之后才有，就是命令把箱子里的东西洒出来了，交给写 Java 的人。
- **某一步的错误是 `card_error`**：带 `${run}` 的参数换成真的编号以后不合法（比如拼出来的文件不存在），按提示改卡片。
