# 小鲸鱼之家（xiaojingyu）模组工程

NeoForge 模组。Minecraft 26.1.2，NeoForge 26.1.2.76，Java 25。mod_id 是 `xiaojingyu`，包名 `com.xiaojingyu`。内容：/xjy 命令（抓取、盖、撤销、抓取黑名单，见下面「命令」）、抓取范围的设置（模组 → 小鲸鱼之家 → 配置，见下面「抓取范围（模组配置）」）和家具方块（见下面「家具（P5）」），相册矮桌、新相框和画框墙能放照片、右键换照片（见下面「相册和相框」）。

工程里还有一个开发专用的探针模组 `xjyprobe`。它只在 `gradlew runClient` 里加载，在游戏里开一个本机 HTTP 服务，让 Node 脚本能开世界、执行命令、读方块、截图，用来做自动验收。发布的 jar 里没有它。接口约定见 [docs/PROBE.md](../docs/PROBE.md)。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/main/` | 小鲸鱼之家本体：`java/com/xiaojingyu/` 下的 `XiaojingyuMod.java`（入口）、`share/`（鲸图读写）、`command/`（/xjy 命令）、`build/`（抓取和分批盖的计算）、`blacklist/`（抓取黑名单和它的网络包）、`config/`（模组配置：抓取范围）、`client/`（只在客户端加载：黑名单界面、配置页、照片的渲染器和贴图）、`furniture/`（家具方块）、`photo/`（相册和相框：方块实体、右键换照片、发给客户端），两份语言文件、`data/`（家具的掉落表和斧子标签），`templates/META-INF/neoforge.mods.toml` |
| `src/probe/` | 探针 xjyprobe：`java/com/xiaojingyu/probe/`、它自己的 `templates/META-INF/neoforge.mods.toml` |
| `src/shareTest/` | 鲸图格式的测试（不进 jar）：`java/com/xiaojingyu/share/` 里的 `ShareTestMain` 等，说明见下面「分享格式（鲸图）」 |
| `src/cmdTest/` | /xjy 命令纯计算部分的测试（不进 jar）：`java/com/xiaojingyu/build/` 里的 `CmdTestMain` 等，说明见下面「命令（/xjy）」的「测试」 |
| `dev/` | 开发用的游戏设置模板：`options.txt`、`neoforge-client.toml` |
| `tools/`、`cards/` | 验收用的 Node 脚本和卡片（归 probe-tools，说明见 docs/PROBE.md） |
| `build.gradle`、`gradle.properties`、`settings.gradle` | 构建配置。模组名、版本号在 `gradle.properties`，中文用 `\uXXXX` 写；许可证 `CC-BY-NC-SA-4.0`、作者 `Moci` 也在这里（说明见仓库根目录的 [LICENSE.md](../LICENSE.md)） |
| `run/` | 开发游戏的运行目录（git 忽略，见下面「文件都在哪」） |

## 构建

需要 JDK 25。只在这一次命令里设置 `JAVA_HOME`，不用改系统设置：

```bash
cd mod
JAVA_HOME=/path/to/jdk-25 ./gradlew build
```

PowerShell：

```powershell
cd mod
$env:JAVA_HOME = 'X:\path\to\jdk-25'; .\gradlew.bat build
```

产物是 `build/libs/xiaojingyu-0.1.0.jar`，里面只有本体的类、`META-INF/neoforge.mods.toml`、两份语言文件、家具的资源（`assets/xiaojingyu/` 下 furn 生成的 blockstates、models、textures、items）和数据（掉落表、斧子标签）。`build` 也会编译探针（`check` 依赖 `probeClasses`），探针写错了在这里就会报出来，但探针不会打进 jar。

第一次构建要下载 NeoForge 和 Minecraft，几分钟；之后不改代码的话几秒钟。

### 网络

依赖都下载到 Gradle 缓存以后，`build` 和 `runClient` 不加代理都能跑（实测）。`--offline` 只用 `-m` 空跑验证过，没有真的带它跑过。

缓存是空的时候（换了机器、清过缓存），要从 maven.neoforged.net 下 `neoforge-26.1.2.76-moddev-config.json`、`DevLaunch-1.0.2.jar` 等文件。这台机器不走代理连不上 maven.neoforged.net，报 `Connect to maven.neoforged.net:443 ... failed: Connection timed out`。这时只在这一条命令后面加代理参数：

```bash
./gradlew runClient -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=10808 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=10808
```

不要把代理写进 `gradle.properties` 或用户目录下的 Gradle 配置。

## 运行开发游戏

```bash
cd mod
JAVA_HOME=/path/to/jdk-25 ./gradlew runClient
```

- 同时加载小鲸鱼之家和探针，窗口 1280×720。
- 探针端口默认随机，要固定就加 `-Pxjyprobe.port=端口号`。
- `runClient` 之前会先跑 `seedDevOptions`：`dev/options.txt` 复制到 `run/options.txt`，`dev/neoforge-client.toml` 复制到 `run/config/neoforge-client.toml`，**目标文件已经存在就不复制**。所以改了 `dev/` 里的模板，要先删掉 `run/` 里对应的文件才会生效。
- 预置的设置让游戏启动后直接停在主菜单：不弹无障碍引导、模组加载警告、多人游戏警告、Realms 通知；关教程、关旁白、关额外遥测、所有音量 0、语言 en_us、失去焦点不暂停、只在窗口最小化时降帧率；视距 8、模拟距离 5、区块淡入关掉（免得截图拍到半透明区块）。
- 退出：用探针的 `POST /quit`（在仓库根目录跑 `node mod/tools/probe.mjs quit`），实测会正常清理。直接关窗口走的是同一条路（`Minecraft.stop()`），按源码也会正常清理，但没实测过。
- 同一时间只能开一个开发游戏。两个游戏共用 `run/`，后开的会覆盖 `run/xjyprobe.json`，存档也会互相干扰。

### 自动验收

在仓库根目录：

```bash
node mod/tools/run-cards.mjs          # 启动游戏，跑 mod/cards/ 下全部卡片，跑完用 /quit 退出
node mod/tools/run-cards.mjs --attach # 连已经开着的游戏
node mod/tools/probe.mjs status       # 手动发单个请求，--help 看全部命令
```

卡片格式、结果放在哪，见 docs/PROBE.md 和 `--help`。

## 文件都在哪

| 文件 | 说明 |
| --- | --- |
| `build/libs/xiaojingyu-0.1.0.jar` | 发布用的 jar |
| `run/logs/latest.log`、`run/logs/debug.log` | 开发游戏的日志。探针的日志都以 `[xjyprobe]` 开头 |
| `run/xjyprobe.json` | 探针的连接信息 `{"v":1,"port":…,"token":"…","pid":…,"startedAt":"…"}`，游戏正常退出时删除 |
| `run/probe-shots/` | 探针截图，`<名字>-yyyyMMdd-HHmmss.png` |
| `run/saves/` | 探针开的世界。探针从不删存档，要清理手动删 |
| `run/xiaojingyu/` | `/xjy capture` 存的建筑文件，`/xjy place` 也从这里找。每次 capture 都多一个文件（不覆盖旧的），不会自动清理，要清理手动删 |
| `run/config/xiaojingyu-common.toml` | 抓取范围的模组配置（开发游戏所有存档共用；游戏启动时没有就按默认值写一个）。P2-006 卡片用 `config` 步骤改它，卡片结束时 runner 原样改回去 |
| `run/config/xiaojingyu-blacklist.json` | 抓取黑名单（开发游戏所有存档共用）。第一次改名单时才有；P2-005 卡片开头和结尾都 clear，别的卡片抓取时名单是空的 |
| `run/options.txt`、`run/config/neoforge-client.toml` | 从 `dev/` 复制来的设置，游戏会改写它们 |
| `build/probe-runs/` | `run-cards.mjs` 的运行结果（默认位置） |

## 探针是怎么做的

### 为什么不会进发布 jar

探针在单独的 source set `probe` 里，有自己的 `neoforge.mods.toml`。`jar` 任务只打包 `main`。`runs.client` 用 `sourceSet = sourceSets.probe`，`loadedMods` 列了两个模组，所以只有开发游戏会加载探针。锁输入用的 mixin 配置 `src/probe/resources/xjyprobe.mixins.json` 也只在探针的 `neoforge.mods.toml` 里登记，发布 jar 和只加载主模组的 `runServer`、`runData` 都不会用到它。

### 依赖

不加任何新依赖。HTTP 服务用 JDK 自带的 `com.sun.net.httpserver`，JSON 用 Minecraft 自带的 Gson。`runs.client` 加了 JVM 参数 `--add-modules=jdk.httpserver` 兜底（开发游戏从 classpath 启动，按理默认就有这个模块，日志里也显示有；参数留着不碍事）。锁输入的 mixin 用的是 NeoForge 自带的 Mixin（日志里是 0.8.7），也不是新依赖；26.1 不混淆，不需要 refmap。

### 文件

`src/probe/java/com/xiaojingyu/probe/` 下：

| 文件 | 内容 |
| --- | --- |
| `ProbeMod.java` | 模组入口，注册事件，启动和关闭 HTTP 服务 |
| `ProbeServer.java` | HTTP 服务：校验、路由、读请求体、写回复、写和删 `xjyprobe.json` |
| `ProbeSnapshot.java` | 每个客户端 tick 刷新一次的状态快照，`/status` 只读它 |
| `ProbeThreads.java` | 把任务交给 Render thread 或服务器线程执行，带超时 |
| `ClientEndpoints.java` | `/status`、`/world/open`、`/world/leave`、`/screenshot`、`/quit` |
| `HiddenGuiShot.java` | `/screenshot` 的 `hideGui`：改设置、数帧、截图、恢复原值 |
| `ScreenEndpoints.java` | `/screen`：打开模组的配置界面、点界面上的按钮、关掉界面（不发真实键鼠，见 docs/PROBE.md 接口 11） |
| `ServerEndpoints.java` 里的 `use`、`mixin/GuiAccessor.java` | `/use`（2026-11-08 mod7 加）：在服务器线程上走真右键的 `ServerPlayerGameMode.useItemOn`（主手、潜行可选），再读客户端动作栏的字回给卡片（`Gui` 的字段是 private，用 mixin 的 `@Accessor` 读）。不发真实键鼠，见 docs/PROBE.md 接口 12 |
| `InputLock.java` | `/input`：锁和解锁键盘鼠标；锁上时松开按住的键、放开被接管的鼠标 |
| `mixin/MouseHandlerMixin.java`、`mixin/KeyboardHandlerMixin.java` | 锁着时跳过 Minecraft 处理鼠标和键盘输入的方法（见下面「锁输入」） |
| `ServerEndpoints.java` | `/command`、`/block`、`/region`、`/shapes`（见下面「查方块连接」） |
| `ProbeRequest.java`、`Reply.java`、`ProbeException.java` | 读参数、回复、错误码 |

### 时机

1. 模组构造函数：只注册监听，这时候还没有 `Minecraft` 实例。系统属性 `xjyprobe.lockInput` 是 true 的话，这里就把输入锁上，所以从加载画面开始就是锁着的。
2. `FMLClientSetupEvent`：生成 token（`SecureRandom` 32 字节转 hex），在 `127.0.0.1` 上开 HTTP 服务（端口来自系统属性 `xjyprobe.port`，0 表示随机），然后写 `run/xjyprobe.json`（先写临时文件再改名，读的一方不会读到半个文件）。同时注册一个 JVM shutdown hook。这一步出错只打日志，游戏照常运行。
3. 每个客户端 tick 结束（`ClientTickEvent.Post`，Render thread）：刷新快照，包括当前界面、在不在世界里、玩家位置、`chunksRendered`、fps。主菜单（`TitleScreen`，而且没有加载遮罩）第一次出现时 `ready` 变成 true，之后一直是 true。
4. 退出：`/quit` 或关窗口都会调 `Minecraft.stop()`，它发出 `GameShuttingDownEvent`，探针在这里关 HTTP 服务、删 `xjyprobe.json`。删之前确认文件里还是自己的 token，不会删掉别的游戏写的文件。shutdown hook 做同样的事，两边谁先到谁做，只做一次。

### 线程

- HTTP 请求由一个单线程执行器按顺序处理，一次只处理一个。
- 每个请求先按顺序检查：有 `Origin` 头或 `Host` 不对 → 403；token 不对 → 401（用 `MessageDigest.isEqual` 比较）；路径 → 404；方法 → 405；请求体超过 64 KB → 400 `too_large`；不是 JSON 对象 → 400；还没 ready → 409 `busy`（`/status`、`/input` 和 `/quit` 除外）。
- `/status` 只读最近一次 tick 的快照，不碰游戏状态。
- 要读客户端状态的操作用 `mc.execute` 交给 Render thread，HTTP 线程最多等 10 秒，超时回 504。
- 读写世界的操作（`/command`、`/block`、`/region`、`/shapes`）用 `server.execute` 交给内置服务器线程，最多等 10 秒。交出去之前先确认服务器还在运行（服务器停了以后 `execute` 会直接在调用线程上执行），任务开头再确认确实在服务器线程上。
- `/world/open` 和 `/world/leave` 是「交出去马上回」：`createFreshLevel` 和 `disconnectFromWorld` 会一直占住 Render thread，直到世界加载完或存完，所以探针只把它们排进 Render thread 的队列，立刻回复，由调用方轮询 `/status`。正在开或正在关世界时，再开回 409 `busy`，读世界的请求回 409 `not_in_world`。
- `/screenshot`：在 Render thread 调 `Screenshot.takeScreenshot`，回调要等 GPU 复制完，在之后某一帧才执行。回调里算 `meanBrightness` 和 `distinctColors`、写 PNG、关掉 `NativeImage`，HTTP 线程最多等 15 秒。
- `/screenshot` 带 `hideGui: true`（`HiddenGuiShot.java`）：在 Render thread 上记下 `options.hideGui` 原来的值，设成 true；用 `RenderFrameEvent.Pre/Post` 数帧（不用 tick，无人值守时只有约 17 fps），等 2 个完整画完的帧，在第 2 帧的 `RenderFrameEvent.Post` 里截（这时主画面已经画完，还没送去显示），截完马上改回原值。成功、出错、超时都会恢复，只恢复一次；HTTP 线程超时放弃以后不会再截，迟到的截图回调也不写文件。`options.hideGui` 只在内存里，`Options.save()` 不写这个键，`options.txt` 不会变。它只去掉手、物品栏、准星、方块描边、聊天栏、提示框和暗角；打开的界面（暂停菜单、聊天输入框）照样会画（`GameRenderer.java:510`），所以截之前要确认 `/status` 的 `screen` 是 null。
- `/command`：用自己的 `CommandSource` 收集输出（不发到聊天栏和日志），用 `withCallback` 记录成败，`result` 是各次成功执行的结果之和。语法错误不会触发回调，所以回 `success:false`、`result:0`，错误文字在 `output` 里。
- `/quit`：先把回复发完，再把 `mc.stop()` 交给 Render thread。

### 锁输入（`/input`）

跑卡片时用户可能正在用电脑。锁上以后，不管游戏窗口在不在前台，键盘和鼠标都动不了游戏，机位不会被碰歪。

- `POST /input`，body `{"locked": true}` 或 `{"locked": false}`，回 `{"ok":true,"locked":...}`。`locked` 缺了、是 null、字符串、数字都回 400 `bad_request`。ready 之前也能用。
- 启动时就锁：`gradlew runClient -Pxjyprobe.lockInput=true`（传成系统属性 `xjyprobe.lockInput`）。锁的状态只在内存里，不写 `options.txt`，重开游戏就回到不锁（除非又带了这个参数）。
- `/status` 多了三项：`inputLocked`（现在锁没锁，直接读，不等快照）、`mouseGrabbed`（`MouseHandler.isMouseGrabbed()`）、`windowFocused`（`Minecraft.isWindowActive()`，是 GLFW 自己记的焦点，不等于 Windows 的前台窗口，见下面实测）。后两项来自每 tick 的快照。
- 锁着时：不接管鼠标，已经接管了就马上放开；移动鼠标不转视角；鼠标按键、滚轮、往窗口里拖文件都没用；所有键都没用（Esc 不出暂停菜单，T 不开聊天，F1、F3 不切换，WASD 不走，数字键不换物品栏）；输入法候选也不处理。探针自己的功能照常：命令、tp、截图（包括 `hideGui`）、开关世界、`/quit`。窗口右上角的关闭按钮也照常（实测锁着时给窗口发和点关闭按钮一样的 `WM_SYSCOMMAND`/`SC_CLOSE` 消息，0.8 秒后游戏退出，`xjyprobe.json` 删了）。
- 解锁后一切照常，但游戏不会自己去接管鼠标，要人点一下窗口。点进去时视角不会跳（原版 `grabMouse` 会忽略接管后的第一次鼠标移动，实测 yaw 0 → 0）。

为什么要用 mixin：有两处 NeoForge 的事件挡不住。`Minecraft.setScreen(null)`（关掉界面、进世界时都会走）直接调 `MouseHandler.grabMouse()`（`Minecraft.java:1197`），中间没有能取消的事件；`KeyboardHandler.keyPress` 在世界里先改 `KeyMapping`，最后才发 `InputEvent.Key`，而且不能取消（`KeyboardHandler.java:599-606`）。鼠标按键和滚轮的事件也是在原版记完按下的键、累计完滚轮之后才发。所以探针用两个开发专用的 mixin（只在 probe source set 里），在这些方法开头加一句「锁着就直接返回」：

- `MouseHandler`：`onButton`、`onScroll`、`onMove`、`onDrop`、`grabMouse`
- `KeyboardHandler`：`keyPress`、`charTyped`、`preeditCallback`

这些方法都在 Render thread 上跑（GLFW 回调先用 `minecraft.execute` 交给 Render thread）。输入法切换的回调没拦，它只通知文字输入框，不改游戏状态。

线程：`/input` 在 HTTP 线程上改一个 volatile 标志，回 200 时就已经生效。`InputLock` 在每帧开头（`RenderFrameEvent.Pre`）看一眼：刚锁上的那一帧调 `KeyMapping.releaseAll()`，免得锁之前按住的键一直算按着（比如一直往前走）；锁着时鼠标还被接管着，就调 `releaseMouse()`。实测从锁上到放开鼠标 34 ms 和 57 ms。

2026-11-06 开了两次游戏实测（发真实键鼠前都先确认前台窗口属于游戏进程）：

- 第 1 次（不带参数）：游戏窗口从出来到进世界都没到前台，前台一直是别的程序，但 `/status` 在 ready 前就报 `windowFocused: true`，进世界后（还没锁）报 `mouseGrabbed: true`。也就是说窗口不在前台时 GLFW 也可能认为自己有焦点，一进世界就接管鼠标。08:40 跑卡片时机位被转歪，多半就是这样。锁着时 `grabMouse` 直接跳过，不会接管。
- 第 2 次（`-Pxjyprobe.lockInput=true`）：gradlew 启动后约 2 秒，FML 的加载窗口自己跑到了前台，之后一直在前台到退出。两次为什么不一样没查清，可能和 Windows 对「最近有没有人操作」的判断有关。加载窗口在任何模组加载之前就开了，探针管不了它抢不抢前台。这次窗口在前台、`windowFocused` 是 true，锁着的游戏照样没接管鼠标。
- 锁着时实际发过的输入：鼠标移动、左键、右键、滚轮，按键 W、2、F3、T、Esc。位置、朝向、物品栏格子、界面都没变，F3 调试画面也没出来。解锁后同样的输入都起作用（视角转了 60°，W 走了约 3 格，换了格子，T 开聊天、Esc 开暂停菜单、F3 出调试画面）。F1 和往窗口里拖文件没实际试过；F1 和 W、2 走的是同一个 `keyPress`。

结论：开发游戏窗口出来时可能会跑到前台。锁着时键盘和鼠标对它没用，点回自己的窗口接着用就行；不锁的话，它不在前台也可能把鼠标接管过去。所以没人看着跑卡片时要锁着。

### 查方块连接（`/shapes`）

P4 起网页生成的房子要和游戏自己算的一模一样：栅栏、玻璃板的连接，楼梯的拐角，门的两半，灯笼有没有支撑。不一样的话，玩家在旁边一动，方块就会自己变样。`/xjy place` 原样盖、不改状态，所以盖完以后用 `POST /shapes` 查（约定见 docs/PROBE.md 第 10 个接口，代码在 `ServerEndpoints.java`）。

- 对区域里每个不是空气的格子，照 `Block.updateFromNeighbourShapes` 的顺序（`WEST, EAST, NORTH, SOUTH, DOWN, UP`，抄的 `BlockBehaviour.UPDATE_SHAPE_ORDER`，那个字段是 protected），依次用邻居的当前状态调 `updateShape`，和现在的状态比（`BlockState` 每种只有一个对象，直接比引用）。区域外面的邻居也照样读，所以区域本身和外面一圈的区块都要加载着，不然回 409 `chunk_not_loaded`，外面一圈没加载时错误文字后面会注明。
- 只读：`updateShape` 要的 `ScheduledTickAccess` 传一个什么都不做的（`getBlockTicks()` / `getFluidTicks()` 回 `BlackholeTickAccess.emptyLevelList()`），不会排计划刻，含水方块也不会因为查一次就开始流水；随机数用 `RandomSource.create(0)`，不动世界的随机数。扫过 26.1.2 原版所有 `updateShape` 的写法：只有蜂巢 / 蜂箱（`BeehiveBlock`）的会改世界（放蜜蜂出来），而它的状态从来不被 `updateShape` 改，所以直接跳过；别的方块读的都在这一格周围一格以内。
- 回 `checked`（不算空气）、`changed`、`diffs`（按格子下标排，最多 256 条；`state` 是现在的，`game` 是游戏算的，会掉下来、变成空气的写 `minecraft:air`）、`truncated`。和 `/region` 一样每边最多 64 格，在服务器线程上做，最多等 10 秒。

2026-11-06 13:01 开了 1 次游戏实测（锁着键鼠，没发真实键鼠；脚本 `tmp/lead/shapes-game.mjs` 和 `shapes-tests.mjs`，结果在 `tmp/lead/shapes-run/`），24 项全过：

- 同样的东西摆三份：不加 strict、让游戏自己算的（参照），strict 故意放错的，strict 放对的。故意放错的 4 格（玻璃板没连旁边的石头、楼梯该拐没拐、门只有下半、灯笼悬空）都报出来了，`game` 和参照一样（门和灯笼是 `minecraft:air`），按格子下标排；游戏自己放的和放对的（门两半、灯笼站在石头上）都是 `changed: 0`。只查玻璃板一格也报得出来（邻居在区域外面）。
- 同一块查两次结果一样；查完等 2 秒，`/region` 前后一样。
- strict 放的含水半砖查完 1.5 秒，水没流出来。对照：旁边不加 strict 放一块石头（真的邻居更新），1.5 秒内水就流出来了，说明这一项查得出来。
- 错误：65 格回 400 `too_large`；y=320 回 400 `bad_request`；缺 `to` 回 400；不认识的维度和 `/region` 一样回 400；没加载回 409 `chunk_not_loaded`；加载区边上那一格（renderDistance 8 时是 x=175）`/region` 能读，`/shapes` 因为外面一圈没加载回 409；没进世界回 409 `not_in_world`；用 GET 回 405。
- 速度：64³ 全是空气 13 ms；64³ 全是没连上的栅栏（262,144 格都不对，最坏情况）116 ms。

## 分享格式（鲸图）

鲸图是一张普通 PNG，里面多了一个私有块 `xjSc`，内容是一份完整的 Sponge v3 `.schem`。格式的约定都在 [docs/FORMAT.md](../docs/FORMAT.md)，以那里为准。这一节只讲模组这边的代码怎么用、怎么测，以及实现上的几处取舍。网页那边的实现在 `web/`，两边共用的样例在 [fixtures/share/](../fixtures/share/README.md)。

### 代码

`src/main/java/com/xiaojingyu/share/`（会进发布 jar）：

| 文件 | 内容 |
| --- | --- |
| `ShareModel.java` | 纯数据：尺寸、`Offset`、`DataVersion`、`Metadata`（`CompoundTag` 或 null）、调色板、格子（`int[]`，第 i 格，i = x + z×W + y×W×L）、方块实体、警告。不依赖 `Level` |
| `ShareFiles.java` | 入口：`read` 读一个文件（自动认 PNG 和裸 `.schem`），`writeSchem` / `writePng` 写文件 |
| `SchemCodec.java` | 模型 ⇄ NBT（`CompoundTag`），按 FORMAT §3 的顺序逐条检查 |
| `SharePng.java` | 在 PNG 里找、放、去掉 `xjSc` 块，算 CRC32；自己拼 16×16 纯色占位图（不用 ImageIO） |
| `ShareNbt.java` | 只在包内用：自己的 NBT 读取器、写出、gzip 和解压（解压后上限 64 MiB）、varint |
| `ShareException.java` | 出错时抛的受检异常。`code()` 是 FORMAT §5 的错误代码，`getMessage()` 是那里写的给玩家看的中文，`detail()` 是写日志用的英文细节 |

`src/shareTest/java/com/xiaojingyu/share/`（不进 jar，只在测试时用）：`ShareDump`（模型 → FORMAT §4 的 dump JSON，也能反过来）、`ShareTestMain`（命令行入口）、`TestKit`，以及 `ShareNbtTests`、`ShareTagTests`、`SharePngTests`、`ShareCodecTests`、`ShareFixtureTests`。它和探针一样是单独的 source set，`jar` 任务不打包它。

### 用法（给 P2）

```java
// 抓取：世界 → 模型 → 文件
ShareModel m = new ShareModel(w, h, l);                              // 开始时每格都是 minecraft:air
m.set(x, y, z, BlockStateParser.serialize(state));                   // x、y、z 是格子坐标，从 0 开始
m.putBlockEntity(x, y, z, id, ShareModel.blockEntityData(fullNbt));  // 去掉 id、x、y、z 再存
m.setOffset(minX - standX, minY - standY, minZ - standZ);            // FORMAT §3.2
m.setMeta(ShareModel.newMeta(ShareModel.defaultName(LocalDateTime.now()), playerName,
        System.currentTimeMillis(), "north", standX, standY, standZ,
        "minecraft:overworld", "xiaojingyu-mod/0.1.0", gameVersion));
Files.write(path, ShareFiles.writePng(m));

// 盖：文件 → 模型
try {
    ShareModel m = ShareFiles.read(Files.readAllBytes(path));
    String state = m.get(x, y, z);                                   // 等于 m.palette().get(m.cells()[m.index(x, y, z)])
    for (ShareModel.BlockEntityEntry be : m.blockEntities()) {       // 按格子编号排好
        CompoundTag nbt = be.fullNbt(worldX, worldY, worldZ);        // 加回 id、x、y、z
    }
    List<String> warnings = m.warnings();                            // 能读，但要提醒玩家的情况
} catch (ShareException e) {
    // 给玩家看 e.getMessage()（中文）；日志里记 e.toString()（代码 + 英文细节）
}
```

- `gameVersion`（比如 `26.1.2`）由调用的地方传进来，游戏里可以从 `SharedConstants.getCurrentVersion()` 拿。share 包自己不调 `getCurrentVersion()`，因为在普通 JVM（测试）里它会因为没有 FML 而初始化失败。`ShareModel.CURRENT_DATA_VERSION` 用的是编译期常量 `SharedConstants.WORLD_VERSION`（4790），没有这个问题。
- 模型可以改，没有加锁，不要在两个线程里同时用。大建筑读写要几十到几百毫秒（见下面「测了什么」），不要放在服务器主线程上做。
- 写的时候：调色板按格子里第一次出现的顺序重新编号，只留用到的状态；`RequiredMods` 按调色板重新算，`Metadata` 的其他内容原样写（meta 是 null 就不写 `Metadata`）；写之前按读的规则检查一遍，不合格就抛 `ShareException`，不会写出自己读不回来的文件。
- 读出来的模型：调色板已经按第一次出现的顺序排好，没用到的状态去掉了（同时加警告 `unused_palette`）；`warnings()` 已排序。

### Gradle 任务

| 命令 | 做什么 |
| --- | --- |
| `gradlew shareTest` | 在普通 JVM 里跑全部检查（不开游戏），逐行打印 PASS / FAIL / SKIP，有 FAIL 就让构建失败。`check` 依赖它，所以 `gradlew build` 也会跑 |
| `gradlew shareTest -Prequire-cross` | 同上，但缺了互读用的图（`fixtures/share/js/`，网页写的）算 FAIL，不算 SKIP。P1 验收用这个 |
| `gradlew shareFixtures` | 重新生成 `fixtures/share/java/*.png`（模组写的图）。内容没变的文件不重写；case 删掉了，对应的图也删掉 |
| `gradlew shareDump -Pfile=路径` | 打印一个文件的 dump（`{"dump": …}`），读不了就打印 `{"error": "代码"}`，格式和 `odd/*.expect.json` 一样，排查用。加 `-Pout=路径` 写进文件。相对路径从 `mod/` 算起 |

另外还有三个参数：`-Pfixtures=目录` 换一套样例，`-Pformat-doc=文件` 换一份 FORMAT.md（shareTest 会核对 FORMAT.md §4 的例子和 §5 的错误表、警告表），`-Pshare-heap=大小` 改这几个 JVM 的堆（默认 `1g`；用 `256m` 跑一遍可以确认标签上限把内存压住了）。这几个任务的工作目录是 `build/shareTest-run/`，log4j 的日志写在那里，不会写进 `mod/logs/`。

### 测了什么

`gradlew shareTest -Prequire-cross` 现在是 376 项全过，约 5 秒。包括：

- varint 的各个边界；MUTF-8：U+0000、emoji 写出的字节和 `DataOutputStream.writeUTF`、MC 的 `NbtIo.write` 一样，读的宽松程度和 JDK 的 `readUTF` 一样（另外拿 20,000 个随机字符串对照过）。
- 12 种 NBT 类型来回读写（包括 −0.0、NaN、±∞、非正规数、各类型的最大最小值）；列表规则（FORMAT §2）写出的字节和 MC 自己写的一样；各种坏数据都报 `bad_nbt`；嵌套 512 层能读、513 层不行，和 MC 一样。
- 标签上限：正好 2^21 个能过 NBT 这一步，多 1 个就 `too_large`（读和写都查；包装、重复的键、数组的数法；超出的那个标签名字被截断或类型不认识时也是 `too_large`）；6000 万个空 compound 的 58 KB 文件不会内存溢出。
- gzip：截断、校验和错、正好 64 MiB / 多 1 字节、1 GiB 的压缩炸弹（约 30 毫秒就拒绝）；CRC32 已知值；PNG 块的各种情况（位置、IEND 后面的字节、两份、没有、CRC 错、声明的长度太大、各个位置截断）。
- `.schem` 读取的每条规则和检查顺序（FORMAT §3）；写出的结构、调色板、`RequiredMods`、方块实体排序、模型自检；FORMAT.md §4 的例子和 §5 的错误代码、中文提示、警告与代码完全一致。
- 样例：`cases/` 每个 case 经过 PNG 和 `.schem` 读回来 dump 都一样，写两次字节一样；`js/`（网页写的图）读出来和 case 一样；`odd/` 每个文件的结果和 `.expect.json` 一样；`java/` 和现在重新生成的逐字节一样；big-air（256×64×256）读 PNG 只要几十毫秒（要求 3 秒以内）；随机内容的 1024×4×1024 写约 0.4 秒，读约 0.1 秒。

### 为什么不用 MC 的 NbtIo 读

读用自己的 `ShareNbt`（生成的还是 MC 的 `Tag` 对象），写用 MC 的 `NbtIo.writeUnnamedTag`，但是配自己的 `DataOutput`。`NbtIo` 有下面 4 个问题（26.1.2.76）。以后有人想「换回 NbtIo」，得先把这 4 条都解决：

1. **坏数据会走崩溃报告**：`NbtIo.read` 把 `IOException` 包成 `CrashReport` 再抛 `ReportedNbtException`，而 `CrashReport` 要调 `SharedConstants.getCurrentVersion()`。在普通 JVM 里这一步因为没有 FML（`There is no current FML Loader`）而失败，抛出来的是 `NoClassDefFoundError: Could not initialize class net.minecraft.SharedConstants`；在游戏里则是为每个坏文件生成一份崩溃报告。（实测）
2. **会改浮点数**：`FloatTag` / `DoubleTag` 读的时候走 `valueOf`，值等于 0 就返回共用的 `ZERO`，−0.0 变成 +0.0；写的时候用 `DataOutputStream.writeFloat`，各种 NaN 都变成同一个标准 NaN。FORMAT 要求原样保留位。（实测）
3. **按声明的长度预先分配**：数组和列表直接按文件里写的长度 `new`。几十字节的文件声明 20 亿个元素就能让游戏内存溢出（用 `unlimitedHeap()` 时没有额度挡着）。`ShareNbt` 先拿声明的长度和剩下的字节数比，不够就报 `bad_nbt`。（看源码得出）
4. **超长字符串悄悄变成空串**：`NbtIo.write` 用的 `StringFallbackDataOutput` 遇到超过 65,535 字节的字符串时只打一行日志，写成 `""`，数据丢了也不报错。我们改成报 `bad_nbt`，不写出坏文件。（看源码得出）

### 其他取舍

- 嵌套最多 512 层，数法和 MC 的 `NbtAccounter.unlimitedHeap()` 一样（根算第 1 层）。没用 MC 默认的 2 MiB 内存额度，因为它会把正常的大建筑拒掉；改成解压时自己数字节，超过 64 MiB 马上停。写之前也按同样的数法查深度和标签数（list 元素被包成 `{"": …}` 时多算一层、多算一个标签），保证写出来的文件自己读得回来。
- 逐字节一样：占位图的 IDAT 用不压缩的 deflate 块，字节是固定的；`.schem` 的 gzip 字节取决于 JDK 自带的 zlib。换 JDK 以后 `java/*.png` 可能和提交的不一样，但 dump 不会变：这时 shareTest 会报「java/NAME.png is what this writer writes now」失败，确认其他检查都过了以后，跑 `gradlew shareFixtures` 重新生成再提交（FORMAT §6）。两边写出的字节本来就不要求一样（比如 big-air：网页写的 5,444 字节，模组写的 5,419 字节），只要求互相读出来一样。
- **标签总数上限**：一个文件最多 2^21 = 2,097,152 个标签（FORMAT §2），超了报 `too_large`。原因：64 MiB 只限制了解压后的字节数，一个 58 KB 的文件照样能装 6000 万个空 compound（每个在文件里只占 1 字节），读进内存要大约 4 GB；实测 1 GB 堆的 JVM 抛 `OutOfMemoryError`，它不是 `ShareException`，调用的地方接不住。上限没取 4,194,304（和格子数一样），是因为 MC 默认堆 2 GB、游戏本身已经占了不少，网页那边每个标签也更占内存；2^21 个标签最坏大约 150 MB。正常建筑远用不到：一栋房子几千个，一个装满东西的箱子大约 150 个。数法：每个标签在读它之前就数（根 1 个，compound 每个成员 1 个，list 每个元素 1 个，包装 `{"": v}` 和里面的值各 1 个，数组不管多长 1 个，结束标记不算），所以第 2,097,153 个还没分配就被拒绝了；写的时候按同样的数法先数一遍，超了什么都不写。实测那个 6000 万的文件在 256 MB 堆里约 0.15 秒就拒绝。原版读结构文件（`TemplateSource` 也用 `unlimitedHeap()`）没有这道限制，只不过那些文件不是陌生人发来的。

## 命令（/xjy）

约定写在 [docs/COMMANDS.md](../docs/COMMANDS.md)，以那里为准。这一节讲怎么用、代码在哪、怎么测，以及实现上的取舍。

### 用法

要权限等级 2（单人世界开了作弊就有）。

| 命令 | 做什么 | 命令的 result |
| --- | --- | --- |
| `/xjy capture` | 按模组配置里的范围抓（默认往前 16 格、往后 0、左右各 8 格、高 12 格；在 模组 → 小鲸鱼之家 → 配置 里用滑块改，见下面「抓取范围（模组配置）」） | 盒子里不是空气的方块数 |
| `/xjy capture <前> <左右> <高> [名字…]` | 自己定大小：前 1–64，左右 0–64（宽 = 2×左右+1），高 1–64；往后用配置里的（默认 0，和以前一样）。名字可以有中文和空格，不用加引号，可以以数字开头 | 同上 |
| `/xjy capture 范围 <前> <后> <左右> <高> [名字…]`（英文 `range`） | 4 个数都自己写，不看配置：后 0–64（从自己站的这一列算起往身后几格） | 同上 |
| `/xjy capture 上次 [名字…]`（英文 `last`） | 不管站在哪，按自己上次 `/xjy place` 盖的那块抓；抓出来和当初放的文件同样大小、同样摆法（见下面「改完原样抓回去」） | 同上 |
| `/xjy place <文件> [auto\|0\|90\|180\|270]` | 把 `xiaojingyu/` 文件夹里的文件盖在自己站的地方。名字里有中文、空格或符号时加英文双引号；扩展名可以不写（先找 `.png`，再找 `.schem`）；按 Tab 列出文件。转向默认 auto：把抓取时的朝向转成现在的朝向，数字是在文件的基础上顺时针转几度 | 要放的格子数（含空气） |
| `/xjy undo` | 撤销自己最近一次 place，最多记 5 次 | 要还原的格子数 |
| `/xjy status` | 看放置进度、上次抓取的文件名、上次放的（文件名、站在哪放的、转了几度、占了哪块）、还能撤销几次 | 还没放完的格子数，0 = 空闲 |
| `/xjy blacklist` | 打开抓取黑名单的界面（见下面「抓取黑名单」）；在控制台里等于 `list` | 名单里几种方块 |
| `/xjy blacklist add [方块]` | 把一种方块加进抓取黑名单，以后 capture 把它当空气。按 Tab 补全方块 id；不写方块就加准星对着的那块 | 加完名单里几种 |
| `/xjy blacklist remove [方块]` | 从名单里删掉。按 Tab 列出名单里已有的；不写方块就删准星对着的那块 | 删完还剩几种 |
| `/xjy blacklist list` | 在聊天栏列出名单和名单文件的位置 | 几种 |
| `/xjy blacklist clear` | 清空名单 | 删掉了几种 |

- 位置以玩家站的方块为准，方向取玩家的水平朝向。抓取的盒子从面前 1 格开始，最下面一层是脚下那层。比如站在 (0, -60, 0) 朝北执行 `/xjy capture 6 3 5`，盒子是 x −3…3、y −61…−57、z −6…−1（7×5×6）。往后 N 格是从自己站的这一列算起往身后 N 列：同样站着执行 `/xjy capture 范围 6 2 3 5`，盒子是 z −6…1（多了自己这一列 z=0 和身后的 z=1，7×5×8），Offset 还是 (−3, −1, −6)。
- 文件存在游戏目录下的 `xiaojingyu/`（开发游戏是 `mod/run/xiaojingyu/`），文件夹没有就建。文件名 = 名字 + `.png`，不给名字就用 `capture-年月日-时分秒`。`\ / : * ? " < > |` 和控制字符换成 `_`，去掉结尾的空格和点，最多 64 个字，Windows 保留名（CON、NUL、COM1 等）前面加 `_`；重名就加 `-2`、`-3`，不覆盖已有的文件。聊天栏里的文件名点一下会复制完整路径。
- 出问题时（参数超范围、盒子超出世界高度、区块没加载、文件读不出来、有不认识的方块等），命令失败，什么都不写、一格都不放，聊天栏写原因。卡片靠命令的 success 和 result 判断，不看聊天文字。
- 大的建筑分几个 tick 放，进度只发给本人。`/xjy status` 的 result 变成 0 才算放完。放的过程中，同一个玩家再 place 或 undo 会被拒绝。
- 抓取时：抓取黑名单里的方块当空气；水、岩浆（源头的、流动的）和气泡柱一律当空气；含水的楼梯、半砖、栅栏、告示牌这类方块留下方块、去掉水。海草、海带照常抓（不想要就加进黑名单）。世界里的方块不会被改。有方块被换掉时聊天栏多一句，说各换了几格。

### 抓取范围（模组配置）

不写数字的 `/xjy capture` 抓多大，在游戏里用滑块调（约定 COMMANDS.md §2「抓取范围配置」）：

1. 游戏主菜单或暂停菜单 →「模组」→ 左边选「小鲸鱼之家」→ 右下「配置」。直接打开「小鲸鱼之家：抓取范围」这一页。
2. 4 个滑块：
   - **往前几格**（1–64，默认 16）：从面前那一格算起往前抓几格。
   - **往后几格**（0–64，默认 0）：身后也抓。从自己站的这一格算起往身后数，0 = 身后不抓，1 = 只多抓自己站的这一列，7 = 自己这一列 + 身后 6 列。站在台阶前面朝房子时调到 7 左右，就能把身后的沙滩休闲角一起抓进来。
   - **左右各几格**（0–64，默认 8）：左右两边一样，宽 = 2 × 左右 + 1。
   - **往上几层**（1–64，默认 12）：从脚下踩的那一层算起。
   鼠标停在名字或滑块上有一句说明和取值范围。拖完马上生效（单人游戏下一次 capture 就按新的抓），点「完成」存进文件；「取消」撤回这次的改动，「重置」4 个都回默认值。
3. 下面还有「抓取黑名单 [打开…]」：等于输入 `/xjy blacklist`，打开黑名单界面，点「完成」回到这一页。在主菜单（没进世界）、没开作弊、服务器没装这个模组时是灰的，鼠标停上去说为什么。

- 设置存在游戏目录的 `config/xiaojingyu-common.toml`（开发游戏是 `mod/run/config/`），整个游戏一份，所有存档共用。用记事本改也行（`captureFront`、`captureBack`、`captureSide`、`captureUp` 4 行，上面有中文说明），保存后大约 1 秒游戏自己重读，不用重启；写了超出范围的数会被改到最近的界上（原来的文件先备份成 `xiaojingyu-common-1.toml.bak`）。
- 写了数字的命令照数字：`/xjy capture <前> <左右> <高>` 只有往后用配置，`/xjy capture 范围 <前> <后> <左右> <高>` 4 个都用写的。`/xjy capture 上次` 不管这些滑块，总是正好原来那张的范围。
- `/xjy status` 最后一行说现在不写数字的 capture 用的 4 个数。
- **专用服务器**：这是 NeoForge 的 COMMON 配置，不同步。服务器上 capture 用的是服务器自己 `config/xiaojingyu-common.toml` 里的数（服主改那个文件，改完服务器自己重读）；玩家的配置界面改的是玩家自己电脑上的文件，只管自己的单人游戏，连着服务器打开时最下面有一行黄字「这里改的不管服务器」。玩家用 `/xjy status` 看服务器现在用的数。

### 改完原样抓回去（capture 上次）

网页的房子是一张鲸图。盖进 MC、改了以后，想原样抓回去给网页用，就用这个（约定 COMMANDS.md §2b）：

1. 把鲸图放进 `xiaojingyu/` 文件夹，站好，`/xjy place 房子`（转不转都行，`auto` 或 `0/90/180/270`）。放完以后，模组就记下了这次盖在哪。
2. 在游戏里随便改：拆家具、加方块、放水……
3. 走到哪儿都行、朝哪儿都行（只要那块地方还在加载范围里），输入 `/xjy capture 上次`（或者 `/xjy capture 上次 我的小屋` 给个名字；英文写 `last`）。
4. 文件存在 `xiaojingyu/` 里，不给名字就叫「原文件名-年月日-时分秒.png」，比如 `house-v4-b-20261107-121530.png`；聊天栏点文件名复制完整路径。这张图和原来那张一样大、一样摆法（Offset、Facing 都一样），place 时转过的也转回去了，所以网页拿去和原来的逐格对得上，只差你改过的地方。水、黑名单里的方块照样当空气。

- 「上次」是这个玩家在这个存档里最后一次**放完**的 place（放到一半停下的不算）。记录存在存档里（`saves/<存档>/data/xiaojingyu/last_place.dat`），退出再进来也还在；每个存档各记各的，每人记最近 5 次。
- `/xjy undo` 撤掉一次 place，这次的记录也删掉，「上次」回到再前一次。
- `/xjy status` 会说「上次放的：文件名，站在哪放的，转了几度，占了从哪到哪」，就是 capture 上次 会抓的那块。
- 没 place 过就用 capture 上次：命令失败，聊天栏说要先 place。人走太远、那块没加载：命令失败，让你走近一点。

### 抓取黑名单

名单整个游戏一份，所有存档共用，存在游戏目录的 `config/xiaojingyu-blacklist.json`（开发游戏是 `mod/run/config/`），一开始没有这个文件，就是空名单。名单里记的是方块 id，这种方块的所有朝向、状态都算。约定见 COMMANDS.md §2a。

**用命令改**：

```
/xjy blacklist add minecraft:stone        加石头（可以只写 stone；按 Tab 补全）
/xjy blacklist add                        加准星对着的那块
/xjy blacklist remove minecraft:stone     删掉（按 Tab 列出名单里有的）
/xjy blacklist list                       看名单；点一行把删除命令填进聊天栏；点文件路径复制
/xjy blacklist clear                      清空
```

改完马上生效，聊天栏会说加了 / 删了什么、名单里现在几种。空气、水、岩浆、气泡柱本来就当空气，加不进去；这个游戏里没有的方块也加不进去。

**用界面改**：输入 `/xjy blacklist`（不带别的）打开。

- 上半部分是名单，每种方块显示图标、名字、id。**点一下就删掉。** 多了用鼠标滚轮翻。
- 左下是你的物品栏。**点一个方块就加进名单。** 不是方块的东西是暗的；已经在名单里的方块有黄边。
- 右下可以输入方块 id（比如 `minecraft:stone`），回车或点「加进名单」。输入时后面有灰字提示，按 Tab 补全。
- 每次点完，界面下方用绿字（成功）或红字（失败）说一句结果，聊天栏也记一句。按 Esc 或「完成」关掉。界面不会暂停游戏。

**用记事本改**：打开 `config/xiaojingyu-blacklist.json`，在 `blocks` 里一行写一个方块 id（英文双引号括起来，中间用英文逗号隔开），保存。下一次抓取（或下一次用 blacklist 命令、打开界面）时就会重新读，不用重进世界。

```json
{
  "note": "……",
  "blocks": [
    "minecraft:stone",
    "xiaojingyu:dining_table"
  ]
}
```

文件写坏了也不会崩：名单按空的算，聊天栏用黄字提醒哪一行附近有错。改好保存就行；在游戏里加删方块也会把它重写，原来的坏文件会先另存成 `xiaojingyu-blacklist.json.bak`。不是方块 id 的项会被跳过，其余照用。

专用服务器上名单在服务器的 `config/` 里，界面也能用（加删都由服务器来做，客户端只显示）。

### 代码

都在 `src/main/java/com/xiaojingyu/` 下：

| 文件 | 做什么 |
| --- | --- |
| `XiaojingyuMod.java` | 注册命令（`RegisterCommandsEvent`），每个服务器 tick 推进放置（`ServerTickEvent.Post`），服务器停止时收尾（`ServerStoppingEvent`），注册区块加载票，注册黑名单界面的两个网络包（`RegisterPayloadHandlersEvent`） |
| `command/XjyCommands.java` | 命令树、参数范围、Tab 补全；不写的数字从 `CaptureConfig.current()` 拿 |
| `build/CaptureRange.java` | 抓取范围（往前、往后、左右、往上）：默认值、上限、最大的盒子（1,056,768 格）、按站立点和朝向算盒子（`Frame.captureBox`，纯计算） |
| `config/CaptureConfig.java` | 模组配置 `config/xiaojingyu-common.toml`（NeoForge `ModConfigSpec`，COMMON）：4 个带范围的整数、在模组构造函数里登记、`current()`（没读进来时用默认值） |
| `command/CaptureCommand.java`、`Capture.java` | 抓取：检查、读世界（按黑名单和液体规则换方块）、生成模型和预览图、写文件、发聊天消息；`capture 上次` 按记录的盒子读，格子和方块状态转回原文件的摆法 |
| `build/PlaceRecord.java` | 一次放完的 place 记了什么（文件名、维度、站立点、朝向、转了几度、Offset、Size、Facing），算盒子和每一格在世界里的位置（和 place 用同一套算法），NBT 的读写（codec） |
| `build/LastPlaces.java`、`LastPlaceStore.java` | 每个玩家最近 5 次放完的 place，存在存档的 `data/xiaojingyu/last_place.dat`（游戏的 SavedData）；place 放完时加、undo 时删 |
| `build/CaptureFilter.java` | 抓取时一种方块怎么存：名单里的、液体 → 空气，含水 → 去掉水，其余照旧（按方块状态字符串判断，纯计算） |
| `command/BlacklistCommand.java` | `/xjy blacklist` 的各个子命令、准星对着的方块、Tab 补全 |
| `blacklist/Blacklist.java` | 名单本身：读写 `config/xiaojingyu-blacklist.json`，文件被别人改了就重新读，坏文件另存 `.bak`，写失败就撤销改动 |
| `blacklist/BlacklistFile.java` | 名单文件的文字：宽松地读（BOM、注释、大小写、不写 `minecraft:`……），固定格式地写（纯计算） |
| `blacklist/BlacklistActions.java` | 加、删、清空的检查和聊天文字，命令和界面共用 |
| `blacklist/BlacklistNet.java` | 两个网络包：`Sync`（服务器 → 客户端：整个名单、要不要打开界面、一句结果）、`Edit`（客户端 → 服务器：加或删一种）；服务器这边的处理 |
| `client/XiaojingyuClient.java` | 只在客户端加载的入口（`@Mod(dist = Dist.CLIENT)`），登记 `Sync` 的客户端处理、配置界面（`IConfigScreenFactory`） |
| `client/CaptureConfigScreen.java` | 配置页：NeoForge 自带配置页（`ConfigurationScreen.ConfigurationSectionScreen`）的子类，下面加「抓取黑名单 [打开…]」和连着服务器时的提示 |
| `client/BlacklistScreen.java` | 名单界面（从配置页打开的，「完成」回配置页） |
| `command/PlaceCommand.java` | 盖：找文件、读文件、检查调色板、算转向和位置、检查区域，然后交给 `BuildManager` |
| `command/UndoCommand.java` | undo 和 status |
| `command/BuildFiles.java` | `xiaojingyu/` 文件夹：不覆盖地写新文件、找文件、读文件、列文件 |
| `command/Checks.java`、`Msg.java` | 共用的检查（高度、区块、上一次放完没有）；翻译键和失败消息，`ShareException` 按错误代码对应到翻译 |
| `build/Frame.java` | 朝向、转向、抓取盒子和放置盒子的坐标（纯计算） |
| `build/FileNames.java` | 文件名清理和找文件的规则 |
| `build/BuildPlan.java`、`UndoRecord.java` | 一次放置要放什么（和世界坐标对齐的盒子、调色板、方块实体）；放之前的快照 |
| `build/BuildJob.java`、`BuildManager.java` | 分 tick 的两遍放法；每个玩家的任务、撤销记录、上次抓取的文件；place 放完时把记录交给 `LastPlaces`，undo 时删掉 |
| `build/BuildTickets.java` | 放置期间用的临时区块加载票 `xiaojingyu:build` |
| `build/PreviewImage.java`、`PngWriter.java` | 俯视预览图；自己写的 PNG 编码器（`Deflater` + `CRC32`，不用 `ImageIO` 和 `NativeImage`） |

翻译在 `src/main/resources/assets/xiaojingyu/lang/`，`zh_cn.json` 和 `en_us.json` 各 163 个键：99 个是 `xiaojingyu.command.*`（黑名单界面的文字也用这个前缀，`blacklist.gui.*`；右键换照片时动作栏的 7 句话也用，`photo.*`；好让 cmdTest 的 Lang 检查一起查到），20 个是配置页的 `xiaojingyu.configuration.*`（NeoForge 配置页认的键：标题、每个值的名字和 `.tooltip` 说明、我们加的两行；cmdTest 的 CaptureRange 组查），41 个家具名 `block.xiaojingyu.*`（新相框的名字是 web7 加的），创造模式页 `itemGroup.xiaojingyu.home`，模组名和简介各 1 个。开发游戏用的是英文。

客户端和服务器分开：专用服务器上没有 `net.minecraft.client` 的类，碰到就崩。所以界面相关的都放在 `client/` 包里，只从 `dist = CLIENT` 的 `XiaojingyuClient` 进去；`Sync` 包在公共代码里只登记不带处理（`playToClient(type, codec)`），客户端的处理在 `RegisterClientPayloadHandlersEvent` 里登记。cmdTest 的 ClientSplit 扫一遍编译出来的类，`client/` 以外的类都不能提到客户端的类。

### 实现上的取舍

- **都在服务器线程上做**：命令执行时把检查一次做完，不合格就失败，什么都不动。最大的盒子（65×64×64）抓取实测 35 ms，所以读世界、生成文件、写盘都直接在命令里做，没放到后台（约定说超过 250 ms 再改）。写文件时先写临时文件，再改名成没被占用的名字；改名不替换已有文件，撞名就换下一个名字。
- **抓取**：每一格都存（包括空气）。状态用 `BlockStateParser.serialize`，方块实体用 `saveWithoutMetadata`（箱子里的东西也在）。实体（生物、画、盔甲架、掉落物）不抓。
- **黑名单和液体**：每种 BlockState 只判断一次（按对象缓存）。`CaptureFilter` 按序列化的字符串判断（这样不开游戏也能测）：空气不动；名单里的 → 空气；`LiquidBlock`（水、岩浆，流动的也是）和气泡柱 → 空气；带 `waterlogged=true` 的 → 用 `setValue(WATERLOGGED, false)` 换成不含水的。换过的状态用来算非空气格子数、预览图颜色，也决定存不存方块实体（当空气的就不存）。
- **名单文件**：每次用之前比一下文件的大小和修改时间，变了就重读，所以记事本改完马上生效。写的时候先写临时文件再替换；Windows 上替换偶尔会被杀毒软件之类拦一下（`AccessDeniedException`，cmdTest 里真遇到过一次），所以重试几次（最多约 0.4 秒），再不行就直接写进原文件。都失败才算存不进去，这时撤销这次改动。
- **界面走网络包**：界面不自己读写文件。打开时服务器把名单发过来；点一下只发「加 / 删哪种」给服务器，服务器检查权限（和 `/xjy` 一样）和 id 以后改名单、写文件，再把新名单发给所有有权限的玩家，开着的界面都会更新。这样专用服务器上也对。
- **预览图**：从上往下看，每一列取最上面一个有地图颜色的方块；明暗按北边那一列的高低算，和原版地图一样（`MapItem` 的公式，比例 1:1）。每格 s×s 像素，长边不超过 512 像素。
- **两遍放法**（约定 §3）：第一遍原样放状态，flags = 818（`2|16|32|256|512`：通知客户端、不重算形状、不掉落、不触发方块实体的副作用、不调 `onPlace`）；有方块实体的格子照 `StructureTemplate` 的做法，先放屏障（flags 820）、再放真方块、再用 `loadWithComponents` 读入数据。同时把原来的状态和方块实体记进撤销快照。第二遍只管盒子外面：盒子表面上真的变了的格子，让贴着它的盒外方块用 `neighborShapeChanged` 重算形状，再发一次 `neighborChanged`。盒子里的格子不收任何更新，所以放完和文件一格不差。没照 `FillCommand` 给每一格发更新，因为那样盒子里的红石线、门、含水的方块会按新环境改状态。
- **撤销**：快照也用两遍法放回去。拆掉的方块带 flags 256，箱子里的东西不会洒出来（箱子换箱子、箱子换空气都实测过）。
- **分 tick**：每 tick 最多放 8192 格，最多用 40 ms；第二遍等第一遍全放完再做。几个玩家同时放时平分这 8192 格（每人至少 512）。266,240 格实测 1.6 秒放完，服务器每 tick 平均 1.9 ms。
- **区块**：开始放之前，给盒子碰到的每个区块加一张临时加载票（半径 0），放完、中途停下或服务器停止时撤掉。万一还是碰到没加载的区块，就停下这次放置：放了的留着，撤销记录照样能撤。不在服务器线程上同步加载区块。
- **找文件**：参数不能有 `/`、`\`、`:` 和控制字符，也不能整个是 `.` 或 `..`；名字中间有 `..`（比如 `a..b.png`）可以。拼出路径、规范化以后，上一级必须就是 `xiaojingyu/` 文件夹本身，而且是普通文件（不是文件夹，也不跟随链接）。Windows 不认的名字当作找不到。
- **转向**：方块状态用 `state.rotate(Rotation)` 转，方块实体的数据原样放到转过去的位置。在同一个地方、朝同一个方向用 auto 盖回去，结果和抓的时候一样。
- **抓取范围放在 NeoForge 的模组配置里**（COMMON 类型）：这样「模组 → 配置」的界面、文件、改了自己重读都是 NeoForge 现成的，不用自己写。4 个数都是带范围的整数，NeoForge 自带的配置页（`ConfigurationSectionScreen.createIntegerValue`）只要最大 − 最小 < 256 就画成滑块，所以没自己写界面，只用它的扩展点 `createSyntheticValues` 在下面加了黑名单按钮和服务器提示。键放在顶层不分节，打开就是 4 个滑块，不用再点进一层。COMMON 配置不同步给客户端，所以专用服务器上按服务器的文件（NeoForge 的常规）；没为它另做「客户端改服务器的数」的网络包或命令，服主改文件、玩家用 `/xjy status` 看。
- **往后从自己站的这一列算起**：「往后 N」是自己这一列 + 身后 N−1 列，前后一共「前 + 后」格，和「往前从面前那一格算起数 N 格」对称；N = 0 时盒子和以前一模一样，所以默认值不变时以前的卡片、以前的用法结果都不变。
- **新写法用字面量开头**：`/xjy capture 范围 <前> <后> <左右> <高> [名字…]`。没有做成「4 个数字」的写法，因为名字是最后一个参数、可以以数字开头，`/xjy capture 3 2 3 7 号房` 会分不清 7 是往上还是名字；字面量开头就没有这个问题，旧的 3 个数字的写法也一点不变。
- **place 的上限跟着改大**：加了往后以后最大的抓取是 129×64×128 = 1,056,768 格，比原来 place 的上限 1,048,576 多 8,192 格（只有 4 个都拉到 64 才会超），所以把 place 的上限改成正好这个数，抓得出来的都能盖回去。
- **capture 上次**：place 和 capture 上次 用同一个 `PlaceRecord` 算位置（第 (x,y,z) 格 = 站立点 + 转k(Offset + (x,y,z))），放的时候怎么放，抓的时候就从那一格读；方块状态用 `state.rotate` 转 −k（`Frame.back(k)`）。原版和我们的家具转一圈回来都和原来一样（门的合页、床和家具的 part 不跟着转），卡片 P4-003 在游戏里 4 个角度都核对过。记录只在 place **放完**时写，所以放到一半停下的不会变成「上次」；undo 一开始就删，免得撤到一半的那块被当成「上次」。记录用游戏自己的 SavedData（`MinecraftServer.getDataStorage()`），跟存档走，不另写文件；status 和 capture 上次 只读（`get`，没有就不建），第一次 place 放完才建这个文件。没有为 capture 上次 加载区块：人走远了就失败，让人走近。

### 测试

`gradlew cmdTest` 在普通 JVM 里测命令这边的纯计算部分，不开游戏。源码在 `src/cmdTest/java/com/xiaojingyu/build/`，是单独的 source set，不进 jar。`check` 依赖它，所以 `gradlew build` 也会跑。工作目录是 `build/cmdTest-run/`。现在 3358 项全过，约 4 秒：

- `Frame`：四个朝向的前方和右方与 `Direction` 一致；转向和 `BlockPos.rotate`、`Rotation.rotate(Direction)` 一致；四个朝向的抓取盒子，带往后的也是（往后 0 和以前的盒子一样；往后 1 正好多自己站的这一列；每个局部格子 (f, s, u)、f = 1−往后…前，用 MC 的 `Direction` 走过去都落在盒子里、一格对一格，Offset 对，最大的 64/64/64/64 也查）；换个地方、换个朝向用 auto 盖，每一格相对玩家的位置和抓的时候一样；放置盒子里的格子一一对应，表面格子数对。
- `FileNames`：文件名清理、保留名、重名编号；place 的参数（`a..b` 能找到；`.`、`..`、`a/b`、`a\b`、`C:x`、`x:y`、控制字符拒绝；文件夹不算；就算绕过参数检查也找不到文件夹外面的文件；Windows 不认的名字当作找不到）；加了引号的名字用 Brigadier 读回来不变。
- `Images`：预览图比例；明暗和原版地图的公式一致；北在上；PNG 编码器写的图用 `ImageIO` 读回来逐像素一样（含透明）；`ShareFiles.writePng` 带上我们的预览图以后还能读回来。
- `Lang`：两份翻译的键一样；代码里用到的键都在，每个键都有用到；占位符格式对；`zh_cn` 的 `share.*` 和 FORMAT.md §5 的表逐字一样；`no_data` 里有「原图」。
- `CaptureFilter`：名单里的方块（所有状态，含模组家具）→ 空气，名字相近的（`stone_bricks`、`stone_stairs`）不算；水、岩浆（源头、流动、下落）、气泡柱 → 空气，别的模组的 `LiquidBlock` 也是；含水的楼梯、半砖、灯笼、栅栏、告示牌、箱子 → 不含水，名单里的含水楼梯 → 空气；只认 `waterlogged=true` 这一个属性；海草、高海草、海带、草照旧。
- `Blacklist`：名单文件的读法（空文件、只有空白、BOM、对象和列表两种写法、大小写和不写 `minecraft:`、写成方块状态、重复、不是 id 的项、这个游戏没有的 id、注释和多余的逗号、坏 JSON 报第几行、形状不对、最多 4096 项）；写出的格式（一行一个、中文说明不转义、读回来一样）；文件存取（没有文件、第一次改才建文件、外面改了马上重读、坏文件不动它、下次改时另存 `.bak`、clear 能修好坏文件、0 字节文件、文件被删、存不进去时撤销改动且不留临时文件、两个对象读同一个文件、Windows 上文件被别的程序开着时照样存进去）。
- `LastPlace`（capture 上次）：转 k 再转 `back(k)` 回到原样（`Rotation.getRotated`、四个朝向、坐标）；房子在 (0,-60,0) 不转、在 (40,-60,40) 转 90° 的盒子和门的位置；4 个角度下「按 place 的算法放、按 capture 上次 的算法读」每一格都回到原来的格子（和 `BuildPlan` 对照）；记录的 NBT（`turn` 存度数、没有 Facing 就不写 `file_facing`、`box` 只给人看读的时候重算、转 45° / 尺寸 0 / 数组长度不对都拒绝）；每人最多 5 条、新的在前、undo 删掉后回到上一次、id 不重复、存盘再读回来一样；默认文件名（去扩展名、换掉旧的时间戳）。方块状态转回去要游戏里的方块，普通 JVM 造不了（`docs/NEOFORGE-26.1-API.md` §12.6），放在卡片 P4-003 里测。
- `CaptureRange`（抓取范围）：默认 16 / 0 / 8 / 12、上限、最大体积 1,056,768；配置的 4 个键和顺序（就是配置页的顺序）、默认值、范围（最大 − 最小 < 256，NeoForge 才画成滑块）、不用重启、注释有中文和范围；NeoForge 读文件时的修正（没写的用默认值，100 → 64，0 → 1，−3 → 0，不是数字 → 默认值，不认识的键删掉）；没读进来时 `current()` 用默认值，读进来以后按文件的、拖滑块（`set`）马上变、文件重读后按新的；两份语言文件都有每个值的名字和说明、配置页的标题和两行，status 那一行两种语言都有「范围 / range 4 个数」。
- `Photos`（相册和相框，mod7）：照片检查（好的、坏文件头、IHDR 不对、64×64 / 128×127 / 256×128、正好 49152 字节能用、多 1 字节不行、Id = SHA-1 前 16 位）；NBT 里读照片（空 compound、不是 compound、没 Png、没 Id 按字节算、整个 compound 留着、发给客户端只有 Id 和 Png；相册跳过坏的和空的、最多读 64 张）；翻页（下一张、上一张、找不到、空的、末尾是空、只有一张、同一张出现两次、转一圈）；画框墙按点击位置找框（4 个朝向，每个框的正中和角，框和框之间的木头找最近的，手算的几个世界坐标）；cover 裁法。
- `ClientSplit`：编译出来的 main 类里，`com/xiaojingyu/client/` 以外的都不提 `net/minecraft/client/`、`net/neoforged/neoforge/client/`、`com/mojang/blaze3d/` 和我们自己的 `client` 包（专用服务器加载模组不会崩）。

游戏里的验收卡片是 `mod/cards/P2-*.yml`（probe-tools 写的；黑名单和液体是 `P2-005.yml`），capture 上次 是 `P4-003.yml`：房子原样放 → capture 上次 和原文件一样；拆沙发、加石头、放水、楼梯含水 → 走开转身再 capture 上次，正好差沙发两格和石头一格；房子转 90° / 180° / 270° 放 → capture 上次 和原文件逐格一样，中间 undo 一次「上次」回到改过的那栋；原版的床、合页在右的门、装了钻石的箱子、上半楼梯也转 3 个角度放、抓回来逐格一样（箱子里的东西也一样）。卡片新加的步骤 `expect_files`（两个鲸图逐格比，可以写期望不一样的格子）见 `docs/PROBE.md`；`mod/tools/test/last-place.test.mjs` 把 P4-003 对着 mock 跑一遍。

抓取范围的配置是 `P2-006.yml`：卡片用新步骤 `config` 直接改 `run/config/xiaojingyu-common.toml`，用 `/xjy status` 等 NeoForge 重读完（`cmd` 的 `until.outputContains`，status 那一行有「range 前 后 左右 高」），然后核对：默认（往后 0）抓的和以前一样；往后 7 时 3 个数字的写法抓到身后第 6 格的金块、抓不到第 7 格的钻石块，Offset 不变；不写数字时 4 个都用配置（往后 1 正好多自己站的这一列）；名字以数字开头；`范围` / `range` 4 个数都用写的、出界的失败；朝东时往后跟着转；往后 7 时 place 再 `capture 上次` 和原来那张一模一样；最后改回默认。卡片结束时 runner 还会把改过的配置文件原样写回去（过没过都写，不影响后面的卡片）。`mod/tools/test/capture-range.test.mjs` 把 P2-006 对着 mock 跑一遍。

2026-11-07 抓取范围开了 1 次开发游戏（runner 自己开、锁着键鼠，没发真实键鼠；临时把 `run/options.txt` 改成 `lang:zh_cn`，跑完原样拷回去）：P2-006 一次全过（47 步，7.8 秒；改完配置文件到 status 显示新的数大约 0.5 秒）；接着用探针的 `/screen`（docs/PROBE.md 接口 11）打开配置界面截图：主菜单里打开（黑名单按钮是灰的）、世界里打开、点「打开…」进黑名单界面、点「完成」回到配置页、再「完成」回到游戏，都对；截图里中文正常，4 个都是滑块（`tmp/mod6/shots/P2-006-config-title-*.png`、`-world-*.png`、`-blacklist-*.png`）。游戏留着 `--attach` 跑全部卡片（中文），14 张都过，游戏 `/quit` 正常退出。日志里没有配置的警告（没有「Untranslated configuration keys」，没有「not correct. Correcting」），只有已知的退出世界时 `SavedDataStorage` 的 `AccessDeniedException`（见「已知问题」）。跑完 `run/config/xiaojingyu-common.toml` 是默认的 16 / 0 / 8 / 12。

2026-11-07 capture 上次开了 1 次开发游戏（runner 自己开、锁着键鼠，没发真实键鼠）：先只跑 P4-003，一次全过（108 步，19 秒）；游戏留着 `--attach` 跑全部卡片（结果见下面那句）。截图 `build/probe-runs/20261107-161728/shots/`：`P4-003-edited-*.png`（屋里：沙发没了，石头、水，楼梯顶上那格含水），`P4-003-R270-*.png`（转了 270° 的房子，门廊朝东；远处是原样放的那栋）。存档里的 `data/xiaojingyu/last_place.dat` 读出来是 2 条（原样放的和 270° 的，另外 5 次都被 undo 删了），`next_id` 8。

2026-11-07 黑名单开了 2 次开发游戏（锁着键鼠，没发真实键鼠）：
- 第 1 次把开发游戏临时改成中文（`run/options.txt` 的 `lang:zh_cn`，跑完原样恢复），跑全部卡片：P2-005 过了，界面截图里中文正常；P3-001、P3-002 没过，因为它们的场景里有水，鲸图里现在没有水了，卡片改成抓完先把世界里的水去掉再比（见那两张卡片里的注释）。日志里 P2-005 第一次抓取是「3 格名单、5 格液体、2 个含水方块去掉水」，和设计的一样；不带方块名的 `add` 加到的正是准星对着的橡木木板。
- 第 2 次（英文，平常的设置）跑全部 12 张卡片，全过。截图在 `build/probe-runs/20261107-111956/shots/P2-005-gui-*.png`。截图右上角有「新配方」「进度」的提示框（`/give` 物品时游戏自己弹的），挡住了一点标题和说明文字的右半边。

## 家具（P5）

小鲸鱼之家的家具做成了模组方块，网页和鲸图用同一套方块状态。约定（用户定的、方块状态、分工）都在 [docs/FURNITURE.md](../docs/FURNITURE.md)，以那里为准；这一节讲模组这边做了什么。第 1 轮试做了 3 件（床、餐桌、贝壳柜，下面先讲它们），第 2 轮是屋里剩下的 22 种（见下面「第 2 轮：22 种」），第 3 轮是屋外的 15 种小物件（见「第 3 轮：屋外 15 种」，贝壳风铃有人从下面经过会响）。

### 有哪些方块

| 方块 id（物品同名） | 中文 / 英文名 | 占几格 | 状态 | 掉东西的格（主格） |
| --- | --- | --- | --- | --- |
| `xiaojingyu:bed` | 小床 / Little Bed | 1 × 2（像原版床） | `facing`、`part=head\|foot` | 床头 `head`（和原版一样） |
| `xiaojingyu:dining_table` | 餐桌 / Dining Table | 1 × 1 | `facing` | 自己 |
| `xiaojingyu:shell_case` | 贝壳收集柜 / Shell Case | 2 × 1 | `facing`、`part=left\|right` | 左格 `left` |

- 创造模式物品栏里多了一页「小鲸鱼之家」（英文 Xiao Jing Yu's Home，和模组的英文名一样），放全部家具（第 1 轮的 3 件在前，后面是第 2 轮的 22 种、第 3 轮的 15 种）。图标是小床。
- 状态只有 `facing`（north / south / east / west）和 `part`，没有 `waterlogged`、`occupied` 这些。网页和生成器写的鲸图要和这个一模一样。
- 只是好看的方块：不能睡、不能打开，右键没反应；不含水；不挡光、不遮住旁边方块的面（`noOcclusion`）；声音、硬度（2，抗爆 3）、地图颜色照橡木木板；用斧子挖得快（`data/minecraft/tags/block/mineable/axe.json`）；被活塞推会直接碎掉（两格的，像原版床），餐桌照普通方块。

### 朝向和两格的位置

- 模型按「正面朝北」做，`facing` 换成别的方向就是整个转过去（和炉子一样）。
- 床：`facing` 是从床尾指向床头的方向，床头格 = 床尾格 + facing。
- 贝壳柜：`facing` 是正面朝的方向；`left` / `right` 是站在正面前、看着它时的左右。右格 = 左格 + （facing 逆时针转 90°）。例：facing=east（正面朝东）时人站在东边往西看，左手是南，所以 left 在南边，right 在 left 的北边一格。
- 餐桌：只有一格。

### 怎么放、怎么拆

- **放**：餐桌和贝壳柜的正面朝着放的人。床是站在床尾这头、朝床头的方向放（和原版床一样），点的那一格是床尾，床头往前一格。贝壳柜点的那一格是左格，右格在放的人的右手边一格。另一格放不下（有东西、在世界边界外）就放不了。放下时两格一起出现。
- **拆**：拆掉任一格，另一格跟着消失，只掉一件物品（掉落表只在主格上，`data/xiaojingyu/loot_table/blocks/`）。生存模式拆哪一格都掉 1 件；创造模式拆哪一格都不掉。爆炸炸掉时和普通方块一样按「挺过爆炸」的几率掉。
- **另一格不对就消失**：两格的家具，另一格必须是同一件、同一个 facing、另一个 part。不对的话，这一格一收到邻居变化就变成空气（和原版床一样）。所以 `/shapes`（docs/PROBE.md 接口 10）能查出鲸图里写错、写了一半的家具。
- `/setblock` 放两格的家具时两格都加 `strict`（docs/PROBE.md「搭场景」），不然先放的那一格可能被后放的那一格的形状更新弄没。
- `/xjy place` 原样放状态、不重算，转向时用 `state.rotate`：位置和 facing 一起转，两格的关系不变。镜像（模组现在不用）会把贝壳柜的左右对调，和 NeoForge 给大箱子的修正一样。

### 碰撞和选框

- 每格的盒子来自 `FurnitureShapes.java`（furn 成员的工具 `web/tools/furn-mc.mjs export` 生成，不 import 任何 MC 的类）：`FurnitureShapes.boxes(id, part)` 给朝北、像素单位（0..16，每格自己的坐标）的一组盒子 `{x0, y0, z0, x1, y1, z1}`，单格的餐桌 `part` 给 null；`rotateY` / `quarterTurns` 按 facing 转（和 blockstate 的 y 旋转一样：从上往下看顺时针，北边转到东边）。`FurnitureCollision` 用 `Block.box` / `Shapes.or` 拼起来，每个方块造出来时就把 4 个朝向都算好。碰撞和选框用同一套。
- 现在每格一个盒子：这一格里所有模型元素的外包盒（FURNITURE.md 第 2 节），比如床尾 `{0.5, 0, 0, 16, 10, 16}`。
- 兜底：`boxes` 找不到这一格（返回 null）、盒子都是空的，就用整格并在日志里打一行警告（不然那一格选不中、拆不掉）；盒子超出 0..16 的截到格子里并打警告。

### 第 2 轮：22 种（FURNITURE.md 第 8 节）

22 种都用同一个类 `FurnitureBlock`，每种的大小、每格的盒子、碰撞方式、光从规格 `FurnitureSpec` 来（`FurnitureSpecs` 读 furn 生成的数据）。第 1 轮的 3 件不变。

| 方块 id | 中文 / 英文名 | 占格 w × d × h | 碰撞 / 光 |
| --- | --- | --- | --- |
| `nightstand` | 床头柜 / Nightstand | 1×1×1 | |
| `bookshelf` | 书架 / Bookcase | 1×1×2 | |
| `kitchen_counter` | 厨房台面 / Kitchen Counter | 4×1×1 | |
| `spice_rack` | 调料罐架 / Spice Rack | 1×1×1 | none |
| `mini_fridge` | 小冰箱 / Mini Fridge | 1×1×1 | |
| `dining_chair` | 餐椅 / Dining Chair | 1×1×1 | |
| `desk` | 书桌 / Desk | 2×1×1 | 光 10 |
| `desk_chair` | 书桌椅 / Desk Chair | 1×1×1 | |
| `picture_frames` | 画框 / Picture Frames | 2×1×1 | none |
| `rocking_chair` | 摇椅 / Rocking Chair | 1×1×1 | |
| `tv_stand` | 电视和电视柜 / TV and Stand | 2×1×1 | 光 5 |
| `sofa` | 双人小沙发 / Loveseat | 2×1×1 | |
| `living_rug` | 地毯和小茶几 / Rug and Coffee Table | 2×2×1 | thin（茶几那格 box） |
| `floor_plant` | 大盆栽 / Big Potted Plant | 1×1×1 | |
| `door_mat` | 门口地垫 / Door Mat | 1×1×1 | thin |
| `photo_album_table` | 相册矮桌 / Photo Album Table | 1×1×1 | |
| `floor_cushions` | 地垫坐垫 / Floor Cushions | 2×1×1 | |
| `window_seat` | 窗边坐垫 / Window Seat | 2×1×1 | |
| `telescope` | 望远镜 / Telescope | 1×1×1 | |
| `storage_chests` | 储物箱 / Storage Chests | 2×1×1 | |
| `beanbag` | 懒人沙发 / Beanbag | 1×1×1 | |
| `string_lights` | 串灯 / String Lights | 1×1×1 | none，光 12 |

（方块 id 前面都是 `xiaojingyu:`，物品同名。中文名照 FURNITURE.md 8.2 表的「家具」列，去掉了件数。）

- **状态**：只有 `facing`；占不止 1 格的再加 `part`（整数 0..N−1，N = w × d × h）。`facing` 是正面朝的方向（坐的人脸朝的方向、柜门朝的方向；挂墙的是离开墙的方向）。
- **格子**：朝北时本地格子 cx = 0..w−1（往东）、cz = 0..d−1（往后，往南）、cy = 0..h−1（往上），`part = cx + w × (cz + d × cy)`；主格是 part 0（朝北时正面、最西、最下那格），只有它掉东西。朝别的方向时格子跟着模型顺时针转，相对主格：east (cx, cz) → (−cz, +cx)，south → (−cx, −cz)，west → (+cz, −cx)。例：沙发（2×1×1）朝东时 part 1 在 part 0 的南边一格；书架（1×1×2）part 1 在 part 0 上面。
- **放**：正面朝着放的人。点的那一格是本地 (w−1, 0, 0)，也就是站在正面看的左前下那格（和贝壳柜点 left 一样），其余的格往放的人的右手边、往后、往上长。有一格放不下（有东西、出了世界的高度或边界）就整件放不了。
- **拆**：拆任何一格，整件都没了，只掉 1 件（掉落表只在 part 0 上）。创造模式拆别的格时先把 part 0 不掉落地拆掉，所以也不掉。每一格只看它在这一件里的邻格：邻格不是同一种、facing 不一样、part 不对，它就变成空气，一格带一格，整件都没了（`/shapes` 能查出来）。
- **碰撞**：选框都是模型盒子（拆的时候点得中）；碰撞 `box` 和选框一样，`thin` 是贴地 1/16 格高的一层（地毯、地垫，人能走上去），`none` 是没有碰撞（画框、调料罐架、串灯，人能穿过去）。
- **光**：书桌 10、电视 5、串灯 12（按规格每格的光）。不挡光、不遮住旁边方块的面，和第 1 轮一样。
- **别的**：硬度照木板；声音照木板，软的（地毯和小茶几、门口地垫、坐垫、窗边坐垫、懒人沙发、双人小沙发）是羊毛的声音（`ModFurniture.SOFT`，用户 2026-11-07 定的）；能用斧子挖得快；占不止 1 格的被活塞推会碎掉；镜像时左右对调（part 的 cx 换成 w−1−cx）。

### 第 3 轮：屋外 15 种（FURNITURE.md 第 9 节）

做法和第 2 轮一样：还是通用的 `FurnitureBlock`，furn 生成的 `FurnitureShapes.KINDS` 里加了这 15 种，方块和物品自动注册，创造模式页排在第 2 轮后面。状态、格子、放、拆、碰撞都照上面「第 2 轮」那几条。

| 方块 id | 中文 / 英文名 | 占格 w × d × h | 碰撞 / 光 | 声音 / 快的工具 |
| --- | --- | --- | --- | --- |
| `beach_lounger` | 沙滩躺椅（毛巾）/ Beach Lounger with Towel | 1×2×1 | | 木头 / 斧 |
| `beach_lounger_hat` | 沙滩躺椅（草帽）/ Beach Lounger with Sun Hat | 1×2×1 | | 木头 / 斧 |
| `beach_table` | 白色小圆桌 / Little Round Table | 1×1×1 | | 木头 / 斧 |
| `beach_parasol` | 条纹遮阳伞 / Striped Parasol | 1×1×3 | 只有伞杆挡人；伞面伸出格子 | 木头 / 斧 |
| `crate_lantern` | 木箱和灯笼 / Crate and Lantern | 1×1×1 | 光 12 | 木头 / 斧 |
| `flower_box_purple` | 花箱（紫花）/ Purple Flower Box | 2×1×1 | | 木头 / 斧 |
| `flower_box_pink` | 花箱（粉花）/ Pink Flower Box | 2×1×1 | | 木头 / 斧 |
| `towel_hook` | 毛巾和挂钩 / Towel and Hook | 1×1×1 | none | 羊毛 / 斧 |
| `wind_chime` | 贝壳风铃 / Shell Wind Chime | 1×1×1 | none；下面有人经过会响（见下） | 紫水晶簇 / 斧 |
| `wall_lantern` | 门边壁灯 / Wall Lantern | 1×1×1 | none，光 12 | 灯笼 / 镐 |
| `potted_fern` | 盆栽 / Potted Fern | 1×1×1 | | 陶罐 / 镐 |
| `hanging_basket` | 吊篮 / Hanging Basket | 1×1×1 | none；吊臂伸出格子 | 木头 / 斧 |
| `flower_pot` | 小花盆 / Potted Flowers | 1×1×1 | | 陶罐 / 镐 |
| `succulents` | 多肉小盆栽 / Succulents | 1×1×1 | | 陶罐 / 镐 |
| `step_mat` | 台阶下地垫 / Step Mat | 2×1×1 | thin | 羊毛 / 斧 |

（方块 id 前面都是 `xiaojingyu:`，物品同名。中文名照 FURNITURE.md 9.1 表的「东西」列，去掉了括号里的位置和件数；两张躺椅留一个词区分。「花盆」改叫「小花盆」，免得和原版的花盆（也叫「花盆」、有物品）重名；英文 Potted Fern 和原版的盆栽蕨同名，但原版那个没有物品，不会在物品栏里撞上。）

- **声音和工具**（mod3 定的）：硬度都照木板（2，抗爆 3），用什么挖、空手挖都掉东西（不要求工具），只是对的工具挖得快。木头做的照第 2 轮：木头声音、斧子。软的（台阶下地垫、毛巾）和门口地垫一样：羊毛声音、斧子（`ModFurniture.SOFT`）。陶土盆的（盆栽、小花盆、多肉）用原版饰纹陶罐的声音、镐子挖得快、地图颜色是陶土橙、岩浆不会点着（`POTTERY`）。门边壁灯照原版灯笼：灯笼的声音、镐子、地图颜色金属（`LANTERN`）。贝壳风铃放下、拆掉时是紫水晶簇的清脆声音（`CHIME`），工具照木头用斧子（挂贝壳的是木圈和绳子）。镐子的标签是新加的 `data/minecraft/tags/block/mineable/pickaxe.json`（`replace: false`）。
- **伸出格子**（遮阳伞的伞面、吊篮的吊臂，FURNITURE.md 9 节）：只是模型画到格子外面（MC 方块模型允许 −16..32 像素）；碰撞和选框照规格只在自己那格里。furn 的生成器已经把这两种的盒子裁在每格的 0..16 里，所以通用类不用改（`FurnitureCollision` 遇到超出 0..16 的盒子还是会截到格子里、打警告，正常不会出现）。遮阳伞 3 格都是 box，但盒子只有伞杆（规格 `solid: ['伞杆']`），伞面挡不住人。
- **光**：木箱上的灯笼、门边壁灯 12（整格一样亮）。

**贝壳风铃会响**（用户 2026-11-07 02:10 要的，FURNITURE.md 9.3）：

- 风铃正下方那一列、往下 3 格以内，有活的东西（玩家、动物、怪物都算；盔甲架、旁观模式的玩家不算）**刚走进来**，就在风铃的位置响一串：原版紫水晶风铃声 `SoundEvents.AMETHYST_BLOCK_CHIME`，2–3 下，每下隔 3–5 tick，音高在 0.8–1.6 之间随机（原版紫水晶是 0.5–1.7，取了偏高的一段，听起来轻一点），声音类别「方块」。模组里没有加音频文件。
- 「走进来」按碰撞箱算：实体的碰撞箱碰到风铃下面那 3 格的空间就算在下面。站着不动不会一直响；出去再进来才会再响。同一个风铃 1 秒（20 tick）内不重复响：一串开始以后 1 秒内再有东西进来也不响，几个一起进来只响一串。
- 只在服务器那边算。做法：`furniture/WindChimes.java` 在每个服务器 tick 末尾（`ServerTickEvent.Post`）每 2 tick 把每个世界里活的实体过一遍，查它碰撞箱上面几格有没有风铃，和上一次查的比，新出现的才算「刚走进来」。每 2 tick 查一次是因为跑步一次能走 0.5 格多，查得太稀会漏掉从边上一穿而过的人；每次每个实体只读十几格方块，开销很小。不去加载没加载的区块。
- **为什么不用方块实体、也不用定时 tick**：风铃的方块状态照约定只有 `facing`，鲸图不能变。方块实体会被 `/xjy capture` 写进鲸图（游戏里抓下来的就和生成器写的不一样了），卡片的 `expect_file` 也会因为多了方块实体而对不上。定时 tick 要在 `onPlace` 里起头，可是 `/xjy place` 放方块的 flags 里有 512（`UPDATE_SKIP_ON_PLACE`），根本不调 `onPlace`；随机刻平均一分多钟才轮到一次，卡片里还关了。从实体这边看就没有这些问题：不管风铃是玩家放的、`/setblock` 的、`/xjy place` 盖出来的还是旧存档里的，都一样会响，也不往存档里多写东西。代价是：重开世界后，本来就站在风铃下面的东西不算「刚进来」（第一次查只记下来不响）。
- 开发版（`runClient`，`FMLEnvironment.isProduction()` 是 false）里另外记数，给卡片查「响了」：命令存储 `xiaojingyu:dev` 的 `wind_chime.rings`（响了几串）、`wind_chime.hits`（一共响了几下）、`wind_chime.last`（最后一串在哪，[x, y, z]），用 `/data get storage xiaojingyu:dev wind_chime.rings` 读。发布版不记。
- 测不到的：声音本身（开发游戏的音量都是 0，探针也听不见），要人进游戏听。

### 代码

都在 `src/main/java/com/xiaojingyu/furniture/` 下（`FurnitureShapes.java` 是生成的，别手改）：

| 文件 | 做什么 |
| --- | --- |
| `ModFurniture.java` | 注册第 1 轮 3 个、第 2 轮 22 个、第 3 轮 15 个方块和物品（后两轮按 `FurnitureSpecs` 自动注册，名字还叫 `ROUND2_BLOCKS` / `ROUND2_ITEMS`），创造模式页（第 1 轮在前）；「照木板」的属性，软的、陶土的、灯笼、风铃的声音（`SOFT`、`POTTERY`、`LANTERN`、`CHIME`）。`XiaojingyuMod` 的构造函数里调 `ModFurniture.register(modEventBus)`，它再调 `WindChimes.register()` |
| `TwoCellFurnitureBlock.java` | 两格家具共用的：放之前查另一格、`setPlacedBy` 放另一格、`updateShape` 里另一格不对就变空气、创造模式拆非主格时把主格也拆掉（不掉东西） |
| `LittleBedBlock.java`、`ShellCaseBlock.java`、`ShellCasePart.java` | 床和贝壳柜：另一格在哪个方向、哪格是主格、放的时候是哪一格；贝壳柜的 `part` 属性（left / right）和镜像 |
| `DiningTableBlock.java` | 餐桌（单格） |
| `TwoCellBlockItem.java` | 两格家具的物品：照原版 `BedItem`，第一格放下时不做邻居更新，等另一格放好再一起做 |
| `FurnitureCollision.java` | 读每格的盒子、按 facing 转、拼成碰撞形状 |
| `FurnitureBlock.java` | 第 2 轮的通用家具方块：facing + 整数 part、放、拆、`updateShape` 连锁、镜像、选框和碰撞（box / thin / none）、光。`part` 属性要在 `Block` 的构造函数里就定，所以先把规格放进 `ThreadLocal`（见 docs/NEOFORGE-26.1-API.md §11.8） |
| `FurnitureBlockItem.java` | 第 2 轮多格家具的物品：和 `TwoCellBlockItem` 一样，点的那格先不做更新 |
| `FurnitureSpec.java`、`FurnitureSpecs.java` | 每种的大小、每格的盒子、碰撞方式、光；`FurnitureSpecs` 从 furn 生成的数据里读，按创造模式页的顺序列出第 2、3 轮的 37 种 |
| `WindChimes.java` | 第 3 轮：贝壳风铃下面有活的东西刚走进来就响（服务器 tick 事件里从实体这边查，见上面「贝壳风铃会响」）；开发版的计数 |

26.1 的注册写法（`Properties` 要先 `setId`，NeoForge 的 `DeferredRegister.Blocks` / `Items` 替你做）记在 docs/NEOFORGE-26.1-API.md 第 11 节。

资源和数据：

| 东西 | 在哪 | 谁写 |
| --- | --- | --- |
| 方块状态、方块模型、贴图、物品定义（26.1 的 `items/`）和物品模型 | `src/main/resources/assets/xiaojingyu/` 下的 `blockstates/`、`models/`、`textures/`、`items/` | furn 的工具生成，别手改 |
| 中英文名字 | `assets/xiaojingyu/lang/`：`block.xiaojingyu.*`、`itemGroup.xiaojingyu.home` | mod |
| 掉落表 | `data/xiaojingyu/loot_table/blocks/`：床只有 `part=head` 掉、贝壳柜只有 `part=left` 掉、餐桌自己掉；第 2、3 轮多格的只有 `part=0` 掉、单格的自己掉；都带「挺过爆炸」条件（照原版床）。第 3 轮的 15 个是 `tmp/mod3/round3-data.mjs` 写的（同时写标签和 lang，可以重跑，`--check` 只看不写） | mod |
| 斧子、镐子标签 | `data/minecraft/tags/block/mineable/axe.json`（`replace: false`，只追加：第 1、2 轮 25 个 + 第 3 轮 11 个）、`pickaxe.json`（第 3 轮的壁灯、盆栽、小花盆、多肉 4 个） | mod |

### 和网页、鲸图的约定

- 网页、生成器、转换工具和模组用同一套状态（FURNITURE.md 第 2 节），网页里的规格是 `web/src/44-furn-mc.js`（`V3.furnMc`）：主格是 offset [0,0,0] 那格，床是床头、贝壳柜是 left；朝北时床尾在床头南边一格，贝壳柜的 right 在 left 西边一格。和上面的规则一致。
- 鲸图里两格的家具两格都要写，状态要和游戏会算的一样（否则 `/shapes` 报出来，玩家一碰旁边就会消失）。鲸图要用到这 3 种方块，玩家的游戏里就要装这个模组（鲸图的 `RequiredMods` 会写上 `xiaojingyu`）。
- 房子的鲸图（`fixtures/house-v4/house-v4-b.*`）里也有这些家具（第 1 轮 3 件 + 第 2 轮 22 种 + 第 3 轮屋外的 20 件），P4-002 的卡片盖房子时用的就是这里的方块。门上方的贝壳风铃在 (−2, 3, −6)，人从门口进出正好从它下面经过。

### 测试

- 卡片 `mod/cards/P5-001.yml`（平地世界）：① `setblock … strict` 放 3 件，`/shapes` 0 处不一样；② `/xjy place` 盖测试鲸图 `fixtures/furniture-p5/furniture-p5.png`（3 件 × 4 个朝向），和 `furniture-p5.json` 一样、`/shapes` 0 处不一样，再转 90° 盖一份查 `/shapes`；③ 拆：`setblock … air` 拆床头、贝壳柜 left，另一格也没了、不掉东西；`setblock … air destroy`（像玩家挖）拆床尾、贝壳柜 right、餐桌，另一格也没了、每件正好掉 1 个；另一格是别的方块、facing 不一样、part 一样三种情况，这一格都变成空气；④ 旁观模式、不带界面，每件 2 个角度截图，再拍一张测试鲸图的全景。
- 测试鲸图怎么来的：`node fixtures/furniture-p5/make.mjs` 用 `web/tools/share.mjs` 从规则算出 dump 再写成鲸图；`--check` 在内存里重新生成，和仓库里的逐字节比。
- 2026-11-06 开发游戏里开了 2 次（锁着键鼠，没发真实键鼠）：只跑 P5-001 一次、全部卡片一次，P5-001 两次都是 107 步全过；全部卡片 9 张都过（P4-002 的房子里有这 3 件，`/shapes` 查了 812 个方块，0 处不一样）。另外用 `give` 拿到了 3 件物品（名字 Little Bed / Dining Table / Shell Case），`execute if block … #minecraft:mineable/axe` 成功；日志里没有缺模型、缺贴图、缺盒子的警告。
- 第 2 轮的卡片 `mod/cards/P5-002.yml` 是 `node fixtures/furniture-p5/make2.mjs` 生成的（同时生成测试鲸图 `furniture-p5-2.png` / `.json`：22 种 × 4 个朝向，19 × 2 × 54），不要手改，改生成器再跑，`--check` 逐字节比。生成器里的尺寸表照 FURNITURE.md 8.2，和 `web/src/44-furn-mc.js` 逐件核对（每格的 collide 也核对）。卡片做的：
  - A：`setblock … strict` 一格一格照鲸图放，`expect_file` 和 dump 一模一样，`/shapes` 0 处不一样；
  - B：`/xjy place` 原样盖，`expect_file`、`/shapes`；再转 90° 盖一份查 `/shapes`；
  - 站高（创造模式，tp 到格子上方半格，等 2 秒，`data get entity @s Pos[1] 16`）：地毯、地垫（thin）站在 1/16 格高（−959），调料罐架、画框、串灯（none）掉穿过去站在草地上（−960）；
  - 拆：B 里每种朝东那件拆最后一格（`setblock … air destroy`），整件都没了，附近正好 1 个掉落物、就是这种家具；
  - 截图：每种朝南放一件，旁观模式、不带界面，从东南边看，22 张，再加一张 A 的全景。
- 2026-11-07 第 2 轮开了 2 次游戏：第 1 次启动就崩了（`lightLevel` 的函数在 `Block` 的构造函数里建状态时就被调，那时方块的字段还没赋值，空指针），改成只用规格算光（`FurnitureBlock.lightFunction`）；第 2 次跑全部卡片 10 张都过（P5-002 132 秒；P4-002 的房子里有 25 种家具，`/shapes` 查了 860 个方块，0 处不一样）。另外 `give` 拿到的物品名字对、`#minecraft:mineable/axe` 对；日志里没有缺模型、缺贴图的警告。
- 第 3 轮的卡片 `mod/cards/P5-003.yml` 是 `node fixtures/furniture-p5/make3.mjs` 生成的（同时生成测试鲸图 `furniture-p5-3.png` / `.json`：屋外 15 种 × 4 个朝向，15 × 3 × 34；和风铃的小鲸图 `furniture-p5-3-chime.png` / `.json`：1 × 4 × 1，最上面一格是风铃），不要手改，`--check` 逐字节比；尺寸、每格的 collide、哪些伸出格子（`reach`）都和 `web/src/44-furn-mc.js` 逐件核对。卡片做的和 P5-002 一样（A setblock、B `/xjy place`、R 转 90°、站高、拆、截图），另外：
  - 站高：台阶下地垫（thin）−959；毛巾、风铃、壁灯、吊篮（none）−960；遮阳伞伞顶那格东边一格、伞面的高度也掉到草地上（伸出去的伞面没有碰撞）；
  - 风铃：`/xjy place` 盖风铃的小鲸图（`/xjy place` 不调 `onPlace`，正好查盖出来的也会响），用开发版的计数查：没东西时 0 串；一只猪（NoAI）tp 进下面那一列响 1 串、2–3 下、位置对；站着不动 2 秒不再响；出去再和另一只猪一起进来只多 1 串；创造模式的玩家进来多 1 串；旁观模式进来不响。
  - 截图 15 张（伸出格子的两种两边多留 2 格），再加一张 A 的全景。
- 2026-11-07 第 3 轮开了 1 次游戏（runner 自己开、锁键鼠，没发真实键鼠）：先只跑 P5-003，全过（116 秒，A / B / R 的 `/shapes` 各查 88 格、截图那排 22 格，0 处不一样）；游戏留着，用 `probe.mjs` 开了个新世界 `give` 15 种（英文名对）、`execute if block … #minecraft:mineable/axe` / `pickaxe` 对；再 `--attach` 跑全部卡片，11 张都过（P5-003 第二遍 114 秒；P4-002 的房子已经带上屋外的 20 件，`/shapes` 查了 885 个方块，0 处不一样），跑完游戏正常退出。日志里没有缺模型、缺贴图、模组的警告和错误。
- 卡片测不到的：玩家用物品放（右键）、玩家挖（生存 / 创造）、活塞推、创造模式物品栏那一页的样子（要打开物品栏界面，得发真实键鼠）、方块光的实际亮度（白天在外面看不出来）、方块的声音和风铃的声音本身（开发游戏音量是 0）。这些照原版的写法做的，只看过源码，没在游戏里点过、听过。

## 相册和相框

用户 2026-11-07 要的：网页的相册里传照片（压成 128 × 128），房子进 MC 时相册跟着进来，相框、画框墙显示照片，在 MC 里右键换照片，抓回网页时换过的也带回去。约定（照片的格式、方块实体的键、照片画在哪）在 [docs/PHOTOS.md](../docs/PHOTOS.md)，以那里为准；**给玩家看的用法在那里的 4.1 节**。这一节讲模组这边怎么做的（mod7，2026-11-08）。

### 有哪些方块

| 方块 id（物品同名） | 中文 / 英文名 | 占几格 | 方块实体（id 和方块一样）里存的 |
| --- | --- | --- | --- |
| `xiaojingyu:photo_album_table` | 相册矮桌 / Photo Album Table | 1 × 1 | `Album`：整本相册（最多 64 张，按顺序） |
| `xiaojingyu:photo_frame`（新） | 相框 / Photo Frame | 1 × 1，挂墙，人能穿过去 | `Photo`：一张照片；没有 = 空相框（露出衬纸） |
| `xiaojingyu:picture_frames` | 画框 / Picture Frames | 2 × 1，挂墙 | `Slots`：6 个框各一张或空的（空 = 原来的小画），只在 `part=0` 那格 |

- 新相框的模型、方块状态、物品、`FurnitureShapes` 里的格子和照片的位置是 web7 用 furn 的工具生成的；掉落表、斧子标签、方块实体是模组这边加的。在创造模式「小鲸鱼之家」页的最后。
- 新相框像展示框一样放：点墙的侧面，就贴在那面墙上（朝离开墙的方向）；点地面、天花板时朝着放的人（和别的家具一样）。卡片 P5-004 用探针拿着物品放过（会走 `BlockItem` 的正常放法）。别的照家具的规矩（FURNITURE.md 8.1）。
- 状态没变（只有 `facing`，画框墙还有 `part`），鲸图里这几格多了方块实体条目。

### 右键换照片

规则见 PHOTOS.md 第 4 节，做法：

- `PhotoFurnitureBlock.useItemOn`：手里是方块（`BlockItem`）就 `PASS`（照常放方块），别的都 `TRY_WITH_EMPTY_HAND`，于是主手接着调 `useWithoutItem` → `PhotoActions.use`。客户端那边直接回「用了」（挥手），服务器做事。
- 潜行：原版在「潜行而且任一只手有东西」时根本不调方块的右键（`ServerPlayerGameMode`），所以潜行往回翻只能空手。没有为这个改原版的规矩（别的方块也是这样）。
- 相册：同一维度、已经加载的区块里，离相框的方块实体（画框墙是 part 0 那格）最近的相册矮桌，方块中心之间不超过 16 格；一样近的取坐标小的。只在相框附近 3 × 3 个区块里找，不为这个加载区块。
- 翻页：`AlbumPaging`（下一张 / 上一张、找不到、末尾是空，cmdTest 测）。相册里坏的照片跳过，编号按好的算（「第 2 / 3 张」）。
- 画框墙找框：点到的位置换算到朝北的模型（`PhotoSlots.toModel`，和模型、碰撞盒一样绕主格中心转），在 6 个矩形里找；都不在里面就取最近的。
- 动作栏（物品栏上面一行字）说一句：「第 i / n 张照片[：名字]」「相框空了」「换回原来的小画了」「附近 16 格里没有相册矮桌」「相册是空的」；右键相册矮桌说「相册里有 n 张照片」。翻页时放一下原版展示框转物品的声音。7 句话在两份语言文件里（`xiaojingyu.command.photo.*`）。

### 存和发

- 读进来的 `Album`、`Photo`、`Slots` 原样存回去（`ExtraCodecs.NBT` 读写整段 NBT），坏照片也留着，只是不显示、不翻到；所以 `/xjy capture` 抓回去的就是放进来的（P5-004 的 expect_files 逐格比过，连坏照片都一样）。换照片时把相册里那张照片的整个 compound（Id、Png、Name、Added）复制进框里。
- MC 给方块实体存盘时总带一个空的 `components: {}`，这三种空的时候不写，空方块实体就是 `{}`，和网页默认房子写的一样（lead 已经让生成器给相册矮桌、画框墙 part 0 写了 `{}` 的条目，P4-002 / P4-003 / P5-002 的核对照常过）。
- 照片检查（`Photos.problem`）：PNG 文件头和 IHDR、128 × 128、不超过 49152 字节（48 × 1024，读的一方的上限；网页写的不超过 48000，PHOTOS.md 第 1 节）。服务器读方块实体时、客户端收到时、解码之前都查，不合规的当没有，日志一行 `[xiaojingyu] … photo … skipped (not_png …)`。`Id` 没写就按 PNG 算（存的数据不改）。
- 发给客户端（`PhotoDisplayBlockEntity`、`PhotoSync`）：只发相框和画框墙，只发合规照片的 `Id` 和 `Png`；相册矮桌一个字节都不发（整本相册最多 3 MB）。
  - 换照片、`/xjy place`、`/setblock` 带 NBT：每个方块实体一个包（`getUpdatePacket`，最多 6 × 48 KB），同一个 tick 发出去，客户端马上看到。
  - 进世界、走近时的区块包（`getUpdateTag`）：每个区块里的照片最多算 1 MiB（按方块位置先后），超出的方块实体在区块包里是空的，区块包发完马上单独补发（`ChunkWatchEvent.Sent`）。原因：PNG 压不小，联机时一个包压缩后最多约 2 MiB，NeoForge 只拆 8 MiB 以上的包；不这样做，一个区块里挂几十张照片就会让玩家进不了服务器。单人游戏不受影响。
  - 开发游戏里可以用命令存储 `xiaojingyu:dev photo_chunk_budget` 把 1 MiB 改小来测补发，`photo_late_sent` 数补发了几个（发布版不读不写）。

### 画

- `client/PhotoRenderer`（方块实体渲染器，26.1 先 `extractRenderState` 再 `submit`，见 docs/NEOFORGE-26.1-API.md §15）：每张照片一个四边形，画在 photoSlots 的矩形上，按 PHOTOS.md 第 3 节的 4 条画法（面前 0.01 像素、正着贴、cover 从中间裁、跨格的按中心那格算），整件跟着 `facing` 绕主格中心转。用原版画地图的 `text` 渲染类型（受方块光，没有方向阴影），加深度偏移的那种（`textPolygonOffset`，告示牌的字用的），远处也不闪。画框墙的渲染范围放大到周围一圈，part 1 那格在视野里也画。
- `client/PhotoTextures`：照片解码成 `DynamicTexture`，登记成 `xiaojingyu:photo/<PNG 的 SHA-1 前 16 位>`（自己算，Id 写错也不会显示成别的照片），同一张照片好几个框共用一张贴图；每帧最多新解码 4 张；解码后再查一次 128 × 128，像素都改成不透明；解不出来的记下（日志一行），不再试。30 秒没画到的释放，退出世界全部释放。
- 只在客户端：这两个类在 `client/` 包里，只从 `XiaojingyuClient` 登记（cmdTest 的 ClientSplit 查过）。

### 代码

| 文件 | 做什么 |
| --- | --- |
| `photo/Photos.java` | 照片的规矩（128、48 KB、64 张、Id 16 位）、检查、算 Id。不用 MC 的类 |
| `photo/Photo.java` | 一张照片：从 NBT 读（检查、记日志）、整个 compound、发给客户端的 {Id, Png}、贴图用的哈希 |
| `photo/AlbumPaging.java` | 翻页规则 |
| `photo/PhotoSlots.java` | 照片画在哪（读 `FurnitureShapes.photoSlots`）、世界 ⇄ 朝北模型的换算、点到哪个框、cover 裁法。不用 MC 的类 |
| `photo/PhotoBlockEntity.java` | 三种方块实体共用：空的不写 `components` |
| `photo/PhotoAlbumTableBlockEntity.java` | 相册矮桌：`Album`，不发给客户端 |
| `photo/PhotoDisplayBlockEntity.java` | 显示照片的（相框、画框墙）共用：换照片、发给客户端（区块包按预算、变化时全发） |
| `photo/PhotoFrameBlockEntity.java`、`PictureFramesBlockEntity.java` | 新相框（`Photo`）、画框墙（`Slots`，6 个） |
| `photo/PhotoBlockEntities.java` | 三种方块实体类型的注册（id 和方块一样）、区块发完的事件 |
| `photo/PhotoSync.java` | 区块包里照片的预算、补发 |
| `photo/PhotoActions.java` | 右键：找相册、翻页、动作栏的话 |
| `furniture/PhotoFurnitureBlock.java` | 这三种方块：`FurnitureBlock` + `EntityBlock`、右键、新相框贴墙放 |
| `client/PhotoRenderer.java`、`client/PhotoTextures.java` | 画照片、照片的贴图 |

`FurnitureBlock.mainPos` 从 private 改成包内可见（右键画框墙 part 1 时要找 part 0）。`ModFurniture` 注册方块时，这三种用 `PhotoFurnitureBlock`，别的照旧；方块实体类型在 `ModFurniture.register` 里一起登记。

### 测试

- `gradlew cmdTest` 的 `Photos` 组（138 项，见上面「命令」的「测试」）。
- `node --test mod/tools/test/*.test.mjs` 里的 `photos.test.mjs`：卡片的 `use` 步骤（参数、请求、consumed、动作栏）、`ProbeClient.use()`、生成器造的照片合规、翻页和点击位置和 Java 一样、P5-004 是最新的。
- 卡片 `mod/cards/P5-004.yml`（`node mod/tools/photo-card.mjs` 生成，别手改；`--check` 只比不写）：照片是生成器造的 128 × 128 PNG（底色 + 左上白、右上黄、左下黑三个角 + 几根白竖条，看截图就知道贴得正不正），直接写进 `/setblock` 的 NBT。用探针新加的 `/use`（docs/PROBE.md 接口 12）模拟右键，用 `data get block` 查结果：
  - 相册矮桌（A、坏的、B、C）在白方块顶上；新相框、画框墙 4 个朝向挂在四面；
  - 新相框：下一张、潜行上一张、末尾是空、空的潜行 → 最后一张、不在相册里的 → 第一张 / 潜行 → 最后一张；
  - 拿着石头右键是放石头、照片不变；潜行拿着木棍不起作用；拿着木棍照常换；
  - 拿着新相框的物品点白方块的东侧面 → 贴在东面、朝东；点地面 → 朝着人；
  - 画框墙 4 个朝向 × 6 个框都按点到的位置换（第 i 个框换成第 i mod 3 + 1 张），南面的先放好 2 张；
  - 远处：16 格里没有相册矮桌、相册是空的、坏照片（不崩，数据原样）；
  - 旁观模式拍 4 面和 20 格外各一张；
  - 区块包预算调成 2000 字节，走到 3000 格外再回来，照片都在，`photo_late_sent` 有数；
  - 站在南边 capture → 清成空气 → 原地 place → 马上拍 2 张 → capture 上次 和第一次的逐格一样（含方块实体）。

## 已知问题

- **缓存是空的时候要代理**：见上面「网络」。
- **dev 设置只复制一次**：`run/options.txt` 已经存在时，改 `dev/options.txt` 不会生效，要先删掉 `run/options.txt`。`neoforge-client.toml` 也一样。
- **`graphicsPreset:"custom"` 不能删**：游戏启动时会按画质预设重设视距和模拟距离（默认预设 FANCY 会改成 16 和 12）。预设是 custom 时才保留 `options.txt` 里的数值。
- **第一次启动日志里有一行 `Configuration file ... neoforge-client.toml is not correct. Correcting`**：NeoForge 在补齐模板里没写的配置项，`showLoadWarnings = false` 会保留，不用管。
- **开关世界期间 `/status` 会变旧**：加载和保存世界时客户端不 tick，快照不刷新，`snapshotAgeMs` 会变大。判断进没进世界要等 `inWorld` 为 true 且 `screen` 为 null。
- **超平坦世界里有动物**：和平难度也会生成猪、牛这类动物，可能拍进截图。需要干净的画面时先执行 `kill @e[type=!minecraft:player]`。
- **出生位置每次不一样**：同样是 seed 0，玩家出生点也会变（实测有 (1.5, -60, -9.5) 和 (-3.5, -60, 5.5)）。卡片和命令里用绝对坐标，不要用 `~` 相对坐标。
- **退出世界时日志里偶尔有存档 ERROR**：`IO-Worker-N/ERROR ... SavedDataStorage: Could not save data to chunk_tickets.dat`（或 `data_attachments.dat`），下面是 `java.nio.file.AccessDeniedException: ...neoforge-tmp -> ...`。出错的是 NeoForge 的 `IOUtilities.atomicWrite`：它把临时文件 `Files.move` 成正式文件，Windows 拒绝了这次改名，它不重试，这一个文件这次就没存上（旧文件还在，临时文件也删了）。堆栈里没有探针的代码。probe-tools 第一次启动时建了 4 个世界，每个只开 1.6–6.2 秒，其中 2 个（开了 1.6 秒和 4.8 秒）退出时各出了一条；我那次（世界开了 1 分钟左右）和最后一次验收（约 7 秒）都没出。原因没查实，可能是刚写完的文件被别的进程（杀毒软件、索引服务）短暂占着。测试世界里丢的是没去过的维度的空数据，不影响结果，验收时不用把它当失败。
- **存档期间 Render thread 不处理排队的任务**：`/world/leave` 之后、回到主菜单之前，游戏一直在等服务器存档（`Minecraft.disconnect` 里的 `while (!server.isShutdown()) renderFrame(false)`），这段时间不执行交给 Render thread 的任务。这时发的 `/screenshot` 要等存档完才执行（超平坦世界约 1 秒；这一条是看源码得出的，没实测），`/command`、`/block`、`/region` 直接回 409 `not_in_world`（`/block` 实测过）。
- **`/world/leave` 开始时会清空 Render thread 的任务队列**：`Minecraft.disconnect` 一开始调 `dropAllTasks()`，那一瞬间排在队列里的任务会被丢掉：截图会等满 15 秒回 504，`/quit` 会回 200 但游戏不退出。按顺序一个一个发请求时基本碰不到（`/world/leave` 回复发出时，Render thread 马上就会执行到清空这一步）。这一条是看源码得出的，没实际碰到过，记一笔备查。
- **`--add-modules=jdk.httpserver` 可能是多余的**：没有去掉它再验证过，留着无害。
- **`runServer`、`runData`、`runGameTestServer` 没有跑过**：它们也用 `run/`，会在里面写 `eula.txt`、`server.properties` 等文件。要跑的话，建议先在 `build.gradle` 里给它们单独设 `gameDirectory`（比如 `project.file('run-server')`），别和开发游戏共用 `run/`。这一条还没改，等真要跑服务端时再定。
- **截图和存档不会自动清理**：`run/probe-shots/` 和 `run/saves/` 会越积越多。
- **/xjy place 和 undo 的两个已知代价**（约定 §3，看源码得出，没实测）：盒子外隔一格的比较器读不到盒子里容器的变化；被拆掉的拉杆隔两格的强充能不刷新。旁边动一下方块就好。这是为了让盒子里一格不差而做的取舍。
- **盒子边上的方块不会改去连外面的东西**：比如盒子边上的栅栏不会连到盒外的栅栏。这是故意的（约定 §3）。反过来，盒外贴着的方块会按新邻居正常更新。
- **不抓实体**：生物、画、物品展示框、盔甲架、掉落物都不进文件。
- **撤销记录只在内存里**：服务器停止（单人世界退出到主菜单也算）就没了。每人最多 5 次，没有重做。
- **「上次放的」存在存档里，撤销记录不在**：所以重进世界以后 capture 上次 还能用，但 undo 不能撤那次了。重进世界以后记录还在这件事，卡片没法直接测（探针只能开新世界），看的是退出后存档里 `data/xiaojingyu/last_place.dat` 的内容，加上 cmdTest 的存盘、读回测试。
- **capture 上次 不管别人改了什么**：记录的是那块地方，不是「你改过的」。别人（或者你后来又 place 别的东西）改了那块，抓到的就是现在的样子。改的时候盖到盒子外面去的部分（比如在院子外面加了一排栅栏），不会被抓进来，要抓更大的范围就用普通的 `/xjy capture`。
- **v1 不做的**（约定 §8）：镜像、不放空气的合并、在服务器之间传文件、旧版本数据的 DataFixer。文件的 DataVersion 和游戏不一样时照样放，只在聊天栏提醒一句；有不认识的方块就整个不放。
- **Tab 补全最多列 500 个文件**：更多的要自己把名字打全。
- **专用服务器上，玩家的配置界面改不到服务器的抓取范围**：抓取范围是 NeoForge 的 COMMON 配置，不同步（NeoForge 的常规）。服务器用自己 `config/xiaojingyu-common.toml` 里的数，服主改文件（改完自己重读）；玩家用 `/xjy status` 看服务器现在用的数。玩家连着服务器打开配置页时，最下面有一行黄字提醒。专用服务器没开过（`runServer` 一直没跑过，见上面），这一条是按 NeoForge 源码说的。
- **配置页上鼠标停住才出来的说明没有截到图**：探针不发真实鼠标，截不到提示框（tooltip）。说明的文字在两份语言文件里，cmdTest 查了都有。
- **`run/xiaojingyu/` 也不会自动清理**：每次 capture 都会多一个文件（不覆盖旧的）。
- **拆装相册矮桌保留照片**：正常掉落物和创造模式 Ctrl＋中键复制带 `xiaojingyu:album_reference`（64 位 SHA-256），整本照片存主世界 SavedData，物品不带 3 MiB PNG。再放下深拷贝成独立相册，修改一张桌子不影响复制品。空桌保持普通物品；缺失/跨世界引用拒绝放置并保留物品，跨世界用鲸图 capture / place。备份需包括整个世界存档；快照不自动回收。相框、画框墙拆掉时当前照片仍不随物品携带，但相册里还有。详见 [PHOTOS.md §4.3](../docs/PHOTOS.md#43-拆装持久化2026-11-09)。
- **P5-006 拆装验收**：`node mod/tools/album-carry-card.mjs` 生成；`node --test mod/tools/test/album-carry.test.mjs` 检查生成卡和新步骤契约。Java Photos 组测 64 × 49152 字节快照压缩写盘重读、哈希与深拷贝、65 字节引用组件；MC 卡测 64 张照片真实掉落/放置、独立改名、退回标题重进世界、Ctrl 中键、空桌、缺失引用不消耗。开发探针新增 `/pick` 和只重进本进程最后创建存档的 `/world/reopen`，发布 jar 不包含这两项；卡片步骤为 `pick`、`reopen`。
- **潜行往回翻只能空手**：原版在「潜行而且手里有东西」时不让方块处理右键（门、箱子也一样），没改。
- **坏照片每次读都记一行日志**：相册、相框里有不合规的照片时，区块每加载一次、客户端每收到一次都会记一行 `photo … skipped`，不影响别的。
- **照片的卡片测不到的**：真鼠标右键（客户端那边的预测、挥手动作，探针是在服务器上直接右键）、动作栏的字在屏幕上的样子（探针读的是文字）、真的联机服务器上包有多大（单人游戏的包不编码；超出预算单独补发的那条路是在开发游戏里把预算调小测的）。
