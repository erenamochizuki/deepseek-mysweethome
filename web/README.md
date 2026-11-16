# 海边小屋 v4 · 网页部分（web/）

这里是 v4 的网页工作流：

- **工作台**（`studio.html`）：3D / 2D 反馈，以及模型菜单中的「方块编辑器 · P6」：逐层修改原版方块、摆放和移动整件家具、撤销重做、导入导出鲸图。操作说明见 [方块编辑器](docs/BLOCK-EDITOR.md)。
- **游戏页**：`cabin.html`（海边小屋，加 `?fb=1` 可以写反馈）和 `home.html`（小鲸鱼之家，只能玩）。

最初从 v3 提交 `44487be` 导入；当前已加入 v4 方块房屋、MC 双向鲸图、相册、家具互动、角色戳击、方块编辑器及真实物体悬停轮廓。完整构建和交付入口见[根说明](../README.md)。
v3 的计划和历史记录在 [docs/PLAN.md](docs/PLAN.md)，v4 的计划和进度在 [../PLAN.md](../PLAN.md)。

## 启动

要求：Node ≥ 24。截图和界面测试用系统里的 Edge。

- 工作台：双击 `启动工作台.bat`。它先构建，再开服务，然后打开 http://127.0.0.1:5194/studio.html 。关掉黑窗口，服务就停了。
- 游戏页：双击 `启动小屋.bat`，打开 http://127.0.0.1:5194/cabin.html 。服务已经开着时，它只打开页面。
- 命令行（在 web/ 下）：先 `node build.mjs`，再 `node serve.mjs`。换端口用 `--port <端口>`。

v3 的服务用 5193，v4 用 5194，可以同时开。端口不同，浏览器里的存档互不影响；反馈也各存在自己的 `feedback/` 文件夹里。

工作台和游戏页怎么用：[docs/使用说明.md](docs/使用说明.md)。全部工具和命令：[docs/TOOLS.md](docs/TOOLS.md)。

## v5（2026-11-14）：模型连成一体、收拾沙滩、空闲找事做、跑着去、坐对椅子

### 1. 角色模型的接缝条纹

YSM 模型是几千个互相穿插的方块。以前近看能看到三样毛病：方块棱上一段段亮色虚线（开着多重采样时，面边缘的像素取到了贴图上隔壁那一格）；两个方块落在同一平面上的地方深度打架、出现干涉条纹（自带和冬装各有两万对左右这样的面）；头发、裙摆一片片方块各自一个亮度。[29-ysm.js](src/29-ysm.js) 建模型时一次处理掉（搜「连成一体」）：

- 打架的方块按级往外胀一点（每级 0.012 像素，最多 4 级，最大位移约 0.08 像素，看不出形状变化）；一模一样叠在同一处的面不动（不会闪）。
- **脸上那层「贴图纸片」不胀（2026-11-15 修）**：眼睛（眼球 / 眼白 / 瞳孔 / 高光 / 眼睑 / 睫毛 / 眉毛）、嘴和牙齿（smile / catMouth / toothSmile / openMouth…，父骨骼 Mouth / GuiMouth / AutoMouth）、腮红 / 胡须 / 眼泪 / 问号（父骨骼 ExtraFace 一类）这些方块，本来是一层贴图叠在另一层前面、位置几乎完全一样，MC 里靠绘制顺序决定谁盖谁。按级一胀层次就反了——眼白上的高光被眼睑盖掉、说话的嘴变成一个歪的小方块、生气的嘴边缘一圈锯齿；剩下两个面只差零点几毫米，跟随镜头默认 9 米远深度精度只有约 ±0.24 mm，那片像素就在两层之间来回跳，看起来一直在闪（用户先反馈眼睛，随后嘴也有）。
  现在这些方块（骨骼名或任一父骨骼名命中 `FACE_LIFT_SKIP` 的正则：eye / pupil / iris / lid / lash / brow / mouth / tooth / teeth / tongue / lip / smile / cry / sulk / extraface / tear / whisker / shy / cheek / question / 瞳眼睫眉嘴牙舌唇泪腮须）不参加「往外胀」，保持作者原样：深度逐位相同 → 后画的稳定盖住先画的；②③ 照做。测试：`test/ysm-soften.test.mjs` 的「face paper layers … are never lifted」（两千多个脸上的顶点，开 soft 关 soft 逐位相同）。
- 贴图坐标往面里收 0.02 格，材质的贴图坐标改成 centroid 插值（WebGL2；WebGL1 不改）。
- 显示着的方块按「3 像素以内、朝向相差 55° 以内」的面平均法线，再和原来的法线 8:2 混合；方块自己的直角棱不受影响。隐藏的备用件（别的嘴型、饭盆）不参加。「模型设置」里改了变量，0.25 秒后重算一次。
- 代价：建模型多花约 0.2 秒（自带）/ 0.35 秒（冬装），只在换角色时发生；每帧开销不变。
- 关掉对照：网址加 `ysmsoft=0`；代码里 `V3.ysm.SOFT` 的数可调。
- 测试：`YSM_WINTER_ZIP=<冬装 zip> node --test test/ysm-soften.test.mjs`（7 项；其中一项确认关掉以后和改动前的源码逐位一样）。截图对比在 `../_work/v5/shots/`（`winter.jpg` 上排改前下排改后）。
- 没验证的：只看了静止画面，没有在 780M 上看「她走动时」还有没有闪；没有量帧时间。

### 2. 捡贝壳是一个状态，捡完举手欢呼

以前她一次冲着一颗去，捡完回到空闲，下一颗要等它自己的计时。现在（[65-girl-actor.js](src/65-girl-actor.js) 搜「收拾沙滩」）：

1. 沙滩上有了东西 → 从**最早冲上来的那一件**开始计时（设置里「沙滩上有东西后多久开始收拾」，默认 30–90 秒）。
2. 时间到 → 进入「收拾」状态（`V3.actor.state` 一直是 `collect`）→ 从近到远一件接一件，把沙滩上的都捡了，途中新冲上来的也捡。
3. 每捡起一件：站起来、两只手举在脸两侧欢呼、原地蹦两下、说一句（约 1 秒），然后马上去下一件。
4. 沙滩空了 → 说一句「沙滩收拾干净啦！」之类（捡了两件以上时）→ 回到空闲。

- 被你戳、去吃饭 / 回消息、进布置模式、打雷：放下手里那件、退出收拾；之后一闲下来，时间早就到了，马上接着收拾。夜里该睡了立刻停（正在存的那一颗捡完）。
- 聊天让她「捡贝壳」、`girl=collect`：马上进入收拾状态，不看计时，也不看「自己去收拾」的开关。
- 举手的姿势是按骨骼摆的（模型自带的动画里没有举手的）：Q 版模型头大手短，手举不过头顶，直着往上举会被头发挡住，所以举在脸的两侧。角度在 [29-ysm.js](src/29-ysm.js) 的 `CHEER_POSE`，调试时网址 token `cheerpose=ax_ay_az_fx_fy_fz` 可以试。
- **规矩变了的一处**：她正在收拾（走向下一件、或两件之间）时你点「吃饭」，以前提示「正忙」，现在她放下贝壳去吃。正蹲着捡的那一件会先捡完。
- 事件：`actor:sweep { phase: 'started' | 'ended', count, reason }`。测试：`node --test test/actor-sweep.test.mjs`（4 项）。

### 3. 空闲时找事做；你打开家具她过来一起看

她闲着（站着、闲逛）时，[89-cabin-routine.js](src/89-cabin-routine.js) 隔一阵挑一样消遣（权重：看海 3、看电视 2、看书 2、翻相册 1；做不了的换下一样）：

| 消遣 | 她做什么 | 多久 |
| --- | --- | --- |
| 看电视 | 坐到朝着电视的沙发上（没有沙发就坐在电视前的地板上）；电视关着就打开，看完替自己关掉 | 35–65 秒 |
| 看书 | 走到书架前站着翻书（和以前一样） | 15 秒 |
| 翻相册 | 坐在阁楼相册矮桌旁的地板上 | 20–35 秒 |
| 坐台阶看海 | 见下面第 5 条 | 50–100 秒 |

- 页面打开 1.5 分钟后第一次，之后每样消遣结束后隔 2.5–4.5 分钟再挑。坐着的时候隔一阵说一句（「这个节目好看～」「海风好舒服～」……）。
- 消遣给别的事让路：吃饭、回消息、写日记、画画、睡觉随时可以叫她起来；沙滩该收拾了她自己放下消遣去收拾。
- **你打开家具**：点电视（开电视、换台、点一台开着的）、点阁楼相册、点书架上的日记本，她闲着就**跑过来**一起看（正在做别的消遣就换过来，已经在看同一样就接着看）。你关电视 / 关掉相册面板，她就起身。她正忙正事时不过来，只在原地说一句。你碰过的电视她走的时候不替你关。
- 不记进行为日志（桥接只认原来那 6 种，看书照旧记一条）；不调模型、不联网。
- 实现：[65-girl-actor.js](src/65-girl-actor.js) 的 `BEHAVIORS`（`leisure`）和 `V3.actor.join(kind, opts)`；[69-furniture-play.js](src/69-furniture-play.js) 的 `tvCompany`；[91-cabin.js](src/91-cabin.js) 的 `join`。
- 测试：`node --test test/actor-leisure.test.mjs`（8 项）。

### 4. 跑着去

吃饭、回消息、你叫她过来的事（一起看电视 / 相册 / 日记、坐摇椅）都**跑着去**：1.9 m/s（平时走 1 m/s），放模型自带的跑步动画，快到的时候提前减速。她自己找的消遣和闲逛照旧慢慢走。

### 5. 坐在门口台阶上看海

消遣之一：走到门廊的沿上，转身面朝大海坐下，腿垂在第一级台阶前面。下雨、下雪不去（坐着的时候下起来就起身）；打雷照旧跑回去缩着坐（同一个地方，那是躲雷的姿势）。

坐着看海时，坐下 8–16 秒后、之后每隔 15–35 秒，随机演一段模型自带的动作：拿出电饭锅和铁盆吃饭那段（`idle_1`，以前只有站着发呆 38 秒才演，权重最高）、端着铁盆吃白饭、举牌子「吃白饭 / 区区 / 偷米罪」、摇晃、开心。腿由坐姿接管，这些动作坐在台阶上演不穿帮（截图 `../_work/v5/shots/seaext/`）。导入的模型没有这些动作就只是坐着。列表在 [65-girl-actor.js](src/65-girl-actor.js) 的 `SEA_FIDGETS`。

### 7. 阁楼的望远镜（只在夜里）

- 天黑（天空的 night > 0.6）、没下雨下雪打雷时，望远镜才能点：鼠标移上去有描边和「望远镜 · 和小鲸鱼一起看星星」，点它弹出面板。白天点不到、也没有提示。
- 点了（或面板里「一起看星星」）：她**跑**过来，站在望远镜背面（目镜那头）、顺着镜筒朝前，用 MC 的蹲下动作（`main:sneaking`）凑到目镜上，一直看到你点「看够了」、天亮或下雨（最多 10 分钟）。看的时候隔一阵说一句（「哇，今晚的星星好多！」「找到北斗七星了！」「刚才是不是有流星！」……），陪你看时说得勤一点。天亮了会说「天亮啦，星星看不到了。」再起身。
- 她自己也会去：天黑以后空闲消遣里它的权重最高（40–80 秒）。23:30 以后照旧放下去写日记、睡觉。
- 她在忙正事、走不过去时，提示原因；她睡着时点它，她迷糊地回一句「星星明天再看吧」。
- 没做到的：Q 版模型头大，蹲下以后眼睛还是比目镜（离地约 0.6 m）高一点，看上去是凑在目镜后上方，不是贴在上面。
- 实现：[65-girl-actor.js](src/65-girl-actor.js) 的 `stargaze`、`starry()`；[69-furniture-play.js](src/69-furniture-play.js) 的 `telescope` / `telescopeSetup`（看不见的点选盒只在夜里显示）。测试：`test/actor-leisure.test.mjs` 里的 telescope 一项；真实鼠标：`node ../_work/v5/scripts/telescope-browser.mjs <构建>/cabin.html <截图目录>`（白天点不到 → 夜里悬停提示 → 点下去面板 + 她蹲在目镜前 → 「看够了」）。

### 6. 用电脑时坐在椅子上

以前她坐在书桌椅的椅背上、看起来趴在椅子后面。原因：方块模型里椅子不在自己那一格的正中间——书桌椅的座面中心比格子中心往正面偏 3.75/16 米，**椅背正好在格子中心**，而以前按格子中心放她。现在按模型真正的座面放（书桌椅、餐椅、沙发各自量过，见 `SEATS`）。吃饭时坐的餐椅也一起改了（偏得少，以前不明显）。

### v5 的验证

- Node（不开浏览器）：新增 `ysm-soften`(7)、`actor-sweep`(4)、`actor-leisure`(8)，对改动前的源码分别失败 3 / 4 / 8 项；按这次有意改掉的行为改了 4 个旧测试（每处在测试里写了原因）：`actor-behavior`（餐椅座面、捡完先欢呼）、`meal-cooker-link`（「忙」改用写日记，另加「看书给吃饭让路」）、`night-sleep`（固定消遣为看书；「5 分钟」从回复到达时算起——以前从到达后 2 秒算，结果要看例行检查落在哪一拍）。
- 顺手修的一个旧问题（[88-cabin-night.js](src/88-cabin-night.js)）：没有床的夜里，回复正好在「1 分钟后再找床」到期的那一拍到达时，会被当成夜里的回复（坐在电脑前等 5 分钟），可那一晚根本没床可回。现在已知没床时，到期那一拍她正忙或有事排着，就接着照白天过。另外夜里该上床时她正在做消遣，会放下去睡。
- 真实画面截图：`../_work/v5/shots/`（desk、leisure、cheer、sweep2、winter）。
- 辅助脚本和改动前的源码备份：`../_work/v5/scripts/`、`../_work/v5/src-orig/`；执行计划：`../v5-执行计划.md`。

## 一楼书架与日记本

书架仍用现有点选和遮挡判定。[91-cabin.js](src/91-cabin.js) 将本机 `/api/cabin/art` 的日记按日期倒序交给 [68-album.js](src/68-album.js)；相册与书架共用弹窗、上一页/下一页和跳页选择。书架只读，正文按纯文本显示，不写相册、鲸图或 Minecraft 模组。侧栏原有「日记本／今日小屋」不变。

重新构建 `home`、`cabin` 后，带上集成脚本一同部署。独立静态成品没有日记服务时书架不会显示可点击状态。

## 本地行为与聊天交接（A1-1 / A1-2）

- [角色状态机](src/65-girl-actor.js) 用现有导航走到家具，再播放就餐、电脑或伏案动作。导入模型缺动画时降级到基础姿势；没有专属画画动作的模型用伏案动作近似。书桌与餐椅找不到时不会让角色传送或穿家具。
- [本地调度](src/89-cabin-routine.js) 在上海时间 11:30–13:00 触发午餐，完成后当天不再自动触发；捡贝壳仍由本地角色自主运行，空闲可去书架阅读。新页面不轮询旧 `/activity`，无额外模型调用。关闭网页不会补演。
- 实际行为先在浏览器缓存最近 24 条，随后通过同机桥接持久化；本机 ACK 后才删除对应浏览器副本。队列只有用户发起小屋聊天或主人 QQ 私聊唤醒时才进入 AI 上下文；小屋聊天注入 System Prompt，QQ 附在该次唤醒上下文。成功确认后仅消费当次快照，未支持旧插件、投递失败或新追加的记录保留。收藏存档、今日小屋流水和日记互不影响。
- 聊天控制字段只认 `meal/shell/read/diary/draw/reply_private`，仅触发网页里的角色动作，不会发送 QQ、生成图片或写日记文件。真实 QQ/日记/画册的本机状态事件只让正在打开的小屋表演相应动作，不触发新的模型回合。
- 回归：工作区根目录运行 `node --test haibian/test/cabin-routine.test.mjs`，隔离构建后运行 `node haibian/test/cabin-a1-browser.mjs`。未获发布确认时只使用暂存构建，不替换在用网页、不重启服务。

## 图鉴天气提示与拾取归属

有天气偏好的收藏在未解锁详情保留原提示，并追加“等到……的时候，说不定海浪就会把它带上岸”；不改变掉落权重，不限制其他天气出现。玩家捡到贝壳时，她会认出是玩家拾取；正在忙则等空闲再回应，玩家先拿到她的目标时会取消该次拾取。桥接的最近事件也明确标注拾取者，不把玩家拾取算成她的自主行为。

## 房屋 Mod 依赖与 Minecraft 纹理（A2）

- 小屋与方块编辑器导入 `.png` / `.schem` 时按实际用到的方块重算所需命名空间（不信文件自带清单）。`minecraft` 与自带的 `xiaojingyu` 不要求另装；第三方 Mod ID 由关联实例顶层 `mods` JAR 的 Fabric、Quilt、Forge/NeoForge 清单识别。缺任一个时一次列全，并保留当前房屋与存档；「还是用它」只适用于原有尺寸等软提示。保存/导出仍使用鲸图现有的 `Metadata.RequiredMods`。
- 小屋里打开 **设置 → 房子 → 关联 MC 游戏目录**，选包含 `options.txt`、`resourcepacks` 或 `mods` 的实例根目录。用版本隔离时选对应实例，不选单个 `resourcepacks` 目录。浏览器只记目录句柄；缺权限时点「重新读取／授权」。无需上传，也不修改 Minecraft 文件。
- **纹理模式**默认用内置材质。选择「跟随关联 MC 纹理包」时，按 `options.txt` 中启用的本地 ZIP 或文件夹包顺序读取，后加载包优先。缺失、损坏或超出读取上限的单张纹理先尝试较低优先级包，仍读不到用内置。未授权、没有启用包或选回默认时整屋回到原材质。当前同步的是方块 PNG（动画贴图取一帧），不是模组代码、模型、着色器或实体。没有客户端 jar 时，使用原内置模型与常见方块贴图命名匹配。
- 隔离验证：此目录运行 `node --test test/house-mods.test.mjs test/mc-instance.test.mjs test/mc-texture-layer.test.mjs`；构建到 `_work/cabin-a2-20261112/web` 后，工作区根运行 `node haibian/test/cabin-a2-browser.mjs`。原生目录选择和用户实际 MC 实例未在自动测试中打开。

## 电饭煲和吃饭动作（2026-11-12 下午）

以前这是两套互不相干的东西：电饭煲面板的「盛到碗里」「吃饭」只改一个状态、显示一句话；她真正走去盛饭、坐下吃的那套动作只在上海时间 11:30–13:00 自动触发一次（或聊天时 AI 带了动作标记）。所以别的时间煮饭，她不会动。现在接上了：

| 按钮 | 什么时候能点 | 现在会发生什么 |
| --- | --- | --- |
| 煮一锅饭 | 待机 | 不变：煮 30 秒 |
| 盛到碗里 | 饭煮好、碗空 | 她走到灶台 → 拿碗（这一刻碗里才出现饭）→ 走到餐椅坐下 → 吃 24 秒 → 起身，碗空 |
| 吃饭 | 饭煮好或碗里有饭 | 同上；碗里已经有饭时不会再盛一次，吃完才清空 |

- 饭跟着她实际做的事走，不跟着点击走：还没走到灶台就被打断，饭还在锅里；拿了碗以后被打断（进布置模式、切走页面、雷雨躲雨、换房子），碗里的饭留着，再点「吃饭」接着来。
- 她正忙（在回应你、坐着、捡贝壳、做别的事）：状态不变，提示「小鲸鱼正忙着，等她停下来再点一次」。她只是在闲逛时会立刻转身过来。
- 她演不了（没有朝着餐桌的餐椅、走不到、角色骨骼不能坐、v1 小鲸鱼）：退回原来的立即生效，并说明原因，例如「餐桌旁没有能坐的椅子，这次先直接盛好。」
- 午饭：到点时锅是空的，她会先煮一锅（「到饭点啦，先煮一锅饭」），煮好再去盛；已经有饭就直接用。没有电饭煲的房子照旧。
- 实现：[69-furniture-play.js](src/69-furniture-play.js) 调 `V3.actor.startBehavior('eat', { interrupt: true })`，听 `actor:meal`（拿碗）和 `actor:behavior`（完成 / 取消）；[65-girl-actor.js](src/65-girl-actor.js) 在拿碗那一刻发 `actor:meal`；[89-cabin-routine.js](src/89-cabin-routine.js) 开饭前问 `V3.furniturePlay.mealReady()`。
- 测试：`node --test test/meal-cooker-link.test.mjs`（10 项，真实房屋 + 导航 + 角色 + 家具模块；对改动前的源码 10 项全失败）；真实浏览器里点真按钮：`node ../../../../haibian/test/cabin-meal-browser.mjs`。
- **饭碗跟着她走（2026-11-12 15:50 补）**：拿碗那一刻一碗饭从灶台到她右手（0.8 秒滑过去），跟着手掌走到餐椅，坐下时滑到餐桌上她面前那一侧（0.4 秒），吃完消失。她端着碗的时候灶台的碗和钢盆里没有饭。拿了碗以后被打断，手里 / 桌上的碗当场收掉，灶台重新显示盛好的饭。
  - 桌上放哪由她坐的那把椅子和它朝着的桌子算出来（桌子中心往椅子那边 0.27 米；正对桌子时放在盘子上），不是写死的坐标。
  - 实现：[56-furn-ground.js](src/56-furn-ground.js) 的 `V3.furn.looseDish` 给一只和灶台同款的碗；[65-girl-actor.js](src/65-girl-actor.js) 的 `V3.actor.mealBowl(out)` 报告碗现在该在哪（0 没有 / 1 手里 / 2 桌上）；[69-furniture-play.js](src/69-furniture-play.js) 每个场景只建一只碗，只在端着的时候逐帧跟随，随场景一起释放。
  - 测试：`node --test test/meal-bowl-carry.test.mjs`（8 项，按世界坐标断言；对改动前的源码 7 项失败）。近景截图脚本的做法见 `_work/cabin-c-20261112/closeup.mjs`。
  - 还没有的：灶台自己那只碗是烤在厨房方块模型里的，藏不掉，所以她端走一碗时灶台上还留着一只空碗；没有专门的端碗姿势，碗跟着手掌走，会随手臂摆；只在默认房子、默认角色上看过，房子转过方向或换了别的角色模型没有在浏览器里看。

## 风铃和螃蟹可以点（2026-11-12 15:50）

| 点什么 | 提示 | 会发生什么 |
| --- | --- | --- |
| 贝壳风铃 | 「贝壳风铃 · 点击摇一摇」 | 响一串（和她从下面走过时同一套声音，2–3 下），那只风铃摆起来 |
| 小螃蟹 | 「小螃蟹 · 点一下」 | 受惊跑回礁石的洞里，躲 8–15 秒，再走出来接着原来的日程 |

- 风铃：点击不受「她刚走过 1 秒内不再响」的限制；同一只 0.4 秒内连点只响一次。设置里关了「风铃声」时只摆不响。屋顶盖着从外面也点得到；切到一楼 / 阁楼把那面墙剖掉时点不到。
- 螃蟹：跑的时候平均 0.65 米/秒（平时走 0.24–0.38），沿着沙地走、不穿石头；直线被挡住就先绕到当前这段路的端点。逃跑途中、躲在洞里、以及日程里本来就在进洞 / 躲着的时候点它没有反应；它正在往外走的时候点，会马上再钻回去。接回日程时位置、朝向、腿和钳子的姿势都是连续的。
- 躲在洞里时身子压低了 1.5 厘米：以前它的眼睛顶贴着洞顶，身体起伏时会有两个黑点从石头上面一闪一闪（日程里原来的躲藏也一样，一并修了）。
- 两样都是纯本地的小互动，不上报、不进她的行为日志、不费模型调用。布置模式和反馈模式下不响应。
- 实现：[91-cabin.js](src/91-cabin.js) 认 `chime` / `crab` 两种目标；[66-chime-sound.js](src/66-chime-sound.js) 的 `V3.chimes.click`；[55-house-detail.js](src/55-house-detail.js) 给风铃挂可点标记和一块看不见的点选盒（只在游戏场景里加，工作台 / 导出 MC 模型时不加）；[59-sealife.js](src/59-sealife.js) 在原日程之上叠一段「受惊」日程，原日程一行没改。
- 测试：`node --test test/click-chime-crab.test.mjs`（13 项；对改动前的源码全失败）；真实鼠标悬停和点击：`node ../../../../haibian/test/cabin-toys-browser.mjs`。
- 没验证的：声音本身没有人耳听过（无头浏览器只核对了音频状态和播放计数）；螃蟹在洞里跨过 0.25 米台阶时高度有一帧跳变（原日程就这样，没动）。

## 夜里上床睡觉（2026-11-12 晚上）

设置 → 房子 →「夜里上床睡觉」，默认开。只按本机钟点走，不调模型、不联网（[88-cabin-night.js](src/88-cabin-night.js)）。

- 时段是上海时间 23:30 – 次日 08:00。23:30 以后那晚的写日记动作结束就上床；没等到日记最晚 23:45；夜里才打开页面或页面从后台回来，马上上床。08:00 自己起床。
- 睡着时她真的回了主人的 QQ 私聊：起床跑到电脑前坐下。每来一条新的回复重新等 5 分钟，5 分钟没有新回复就回床上。页面只知道「她回了」，所以 5 分钟从她最后一次回复算。
- 夜里写日记 / 画画：去书桌做完就回床上，不等 5 分钟。网页聊天让她做的动作照做，做完回床上。
- 夜里不捡贝壳（2026-11-13 修）：该上床了那一刻起她就不再去捡，正往贝壳走、刚蹲下还没捡起来的那颗当场放下；网页聊天让她「捡贝壳」的动作标记夜里直接丢掉，不为它起床。原因：11-12 23:51 页面从后台回来时她正走向一颗珍珠贝，夜里的规矩只拦「开始新的一颗」，她走过去捡完才上床。测试在 `test/night-sleep.test.mjs` 的三项 `no shells at night`（对改之前的源码三项都失败）。
- 戳她、点家具：她被叫起来站在床边迷糊地回应（「唔……怎么啦？」），然后回床上。雷雨夜不为回消息起床。
- 没有床、走不到床、这个角色躺不了：这一晚照白天过，每 60 秒再看一次。布置模式、反馈模式、页面在后台时先停下，结束后还在时段里就回床上。
- 睡着时用表情表里的 `sleep`（闭眼、嘴放松）；没有表情表的模型照旧自己眨眼。被子上会多一个人形的鼓包（`V3.furn.sleepCover`）。
- 床上叠好的睡衣和枕头上的睡帽：她躺下睡着时藏起来，起来（含各种取消、换房子、场景重建）重新出现（2026-11-12 23:30）。网页里方块床的这 18 个元素（`bed.bbmodel` 里名为「睡帽」「睡衣」的，下标记在 [44-furn-mc.js](src/44-furn-mc.js) 床规格的 `sleepProps`）单独画成一块小网格 `bed-props`，由 [54-house-mc.js](src/54-house-mc.js) 的 `HB.setSleeper` 开关；MC 资源包里的床模型没改。测试：`node --test test/bed-props.test.mjs`（7 项）。
- 睡着时不再演模型自带的「吃饭」（2026-11-13 夜里）：自带和冬装小鲸鱼的动画控制器（槽位 parallel_7）把「站着不动」计时，满约 38 秒演待机动画 `idle_1`（铁盆 / 吃白饭那段）。以前 [29-ysm.js](src/29-ysm.js) 只要她没在走就当她「站着发呆」，躺在床上、坐在书桌前打字或等消息、坐摇椅时计时照走，37 秒左右铁盆就叠到躺着 / 坐着的姿势上。现在 [65-girl-actor.js](src/65-girl-actor.js) 在她坐着或躺着时给 `setActorAnimation` 传 `posed`；我们在放动作（base / overlay）或把她摆着时，模型看到的是 `ctrl.idle = 0`、`ctrl.playing_extra_animation = 1`，它自己的计时清零。真正站着发呆时照旧会演。测试：`node --test test/ysm-posed-idle.test.mjs`（设 `YSM_WINTER_ZIP` 时冬装也测；改之前全部失败：睡觉 37.3 秒、书桌 38.4 秒、摇椅里出现 `idle_1`）。
- 鼠标停在床上的她身上，描边不再透出被子（2026-11-13 夜里）：[08-hover-outline.js](src/08-hover-outline.js) 的遮罩那一遍给被选中的网格加了按斜率放大的深度偏移（polygonOffset factor −1），本来是让「只用来描边」的复制品赢过场景里和它重合的本体；躺着时腿、手、尾巴和被面几乎平行，偏移就把被子底下几厘米的部分推到了被子前面，被面上冒出一块块亮边。现在被选中的只往前挪一个固定的深度单位（不乘斜率），材质自己的偏移（被子鼓包、发光的眼睛）照旧保留。浏览器里同一帧量「描边离她看得见的像素超过 5 像素」的像素：侧面 / 正上方 / 床尾三个角度，改前 152 / 2514 / 50，改后 0 / 2 / 2。测试：`node --test test/hover-outline-depth.test.mjs`（改之前失败）。
- 测试：`node --test test/night-sleep.test.mjs`（9 项）；真实浏览器：`node ../../../../haibian/test/cabin-sleep-browser.mjs`（含真实等 5 分钟，约 10 分钟；另外检查床上悬停描边的像素、睡满 90 秒和坐在电脑前时都没有 `idle_1`）。

## 镜头「跟随」（2026-11-12 晚上）

楼层按钮（外观 / 一楼 / 阁楼）最右边多了「跟随」（[67-follow.js](src/67-follow.js)）。

- 进入时镜头离她 9 米、俯仰约 32°，方位角不变；之后拖动、滚轮 / 双指缩放都照常，不会被改回去。平移在跟随时不起作用。
- 剖面跟着她自动换：屋外 → 外观，一楼 → 一楼，阁楼 → 阁楼。进出门、上下楼梯有回差，不会来回闪。
- 退出：再点一次「跟随」，或点外观 / 一楼 / 阁楼。布置模式、反馈工具开着时暂停，关掉后接着跟。刷新后回到外观，不记住。
- URL / `V3.view` 里可以写 `follow=1`。
- 测试：`node --test test/follow-camera.test.mjs`（12 项）；真实浏览器：`node ../../../../haibian/test/cabin-follow-browser.mjs`。没测过的：真实触屏双指；宽度小于 352 px 时按钮会碰到「反馈」。

## 设置里的数值可以直接输入、导入模型的表情（2026-11-12 晚上）

- 设置面板和「角色」页模型设置里，滑条右边的数值可以点一下直接输入：回车确定、Esc 取消、↑ / ↓ 调一步。接受全角数字、逗号小数点和带单位的写法（「7 分钟」「50%」），超出范围按滑条的范围和步长夹回去。实现是 [00-core.js](src/00-core.js) 的 `U.parseNumber` / `U.numField`，[69-settings.js](src/69-settings.js) 和 [29-ysmui.js](src/29-ysmui.js) 共用。
- 冬装小鲸鱼被戳没有表情变化：表情对照表（`FATFISH_TUNE`）以前只认自带模型的 id，冬装是导入的模型拿不到。现在按模型自己的脸部选项认（`UI.sameFaceAsFatfish`）：同一套脸就用同一张表，被戳、说话、躲雷、睡觉时脸会变。别的作者的模型认不出来就不调，和以前一样。
- 测试：`node --test test/ysm-face-tune.test.mjs`（7 项，设 `YSM_WINTER_ZIP=<冬装 zip>` 时用真文件核对）；真实浏览器：`YSM_WINTER_ZIP=… node ../../../../haibian/test/cabin-settings-face-browser.mjs`。

## 「新发现！」提示和收集盒的底色（2026-11-12 晚上）

第一次捡到的东西（不只是虹彩鲍壳这类稀有的）弹出的「新发现！」提示，文字下面没有底色。原因是这条提示和收集盒的稀有度浅色用了 CSS `color-mix()`，Chrome / Edge 111 才支持；本机 Edge 100 会把整条 `background` 丢掉，而那条又覆盖了原来的白底。

- 提示：白底上叠一层 18% 不透明的稀有度颜色（`.hud-toast.first::before`），哪个浏览器都认。
- 收集盒：浅色和半透明色改在 JS 里算好（`U.mix` / `U.alpha`，[68-collection.js](src/68-collection.js) 的 `tint()`），设成 `--c-30a` 之类的变量。源码里已经没有 `color-mix()`。
- 验证：上面那个 `cabin-settings-face-browser.mjs` 里核对了首次 / 普通 / 稀有提示和收集盒的计算后样式。

## 翻书时不再陷进地板（2026-11-13）

看书（「翻几页书。」）用的是模型自带的 `tlm:bookshelf` 动画，作者是按「坐在书架前」做的：整个人往下放 18.5 像素、两腿抬平。我们这里她站在地板上演，下面没有座位托着，就沉下去只剩头露在外面（自带和冬装两个模型都这样，最低的脚低到地板下 0.66 米）。

- 修法：[29-ysm.js](src/29-ysm.js) 的 `setActorAnimation(base, overlay, mode, { ground: true })` 先量这个动画让脚比站着低多少（每个动画量一次），再把整个人抬回去，和动画一起淡入淡出；[65-girl-actor.js](src/65-girl-actor.js) 只在她没坐着、没躺着时传 `ground`（坐椅子、敲键盘、睡觉照旧）。现在看书时她坐在地板上翻书，脚贴着地面。
- 测试：`YSM_WINTER_ZIP=<冬装 zip> node --test test/ysm-ground-anim.test.mjs`（3 项；改之前 3 项都失败）。

## 贝壳改成三角面模型（2026-11-13）

12 种经典贝壳原来是体素拼的，现在和潮汐拾物一样用自由三角面雕刻（不进 MC，不受 MC 限制）。三角数 28,660 → 8,608，几何内存约 2.2 MB → 约 0.3 MB；外形、颜色和原来对得上。

- 工具 [30-shell-kit.js](src/30-shell-kit.js)（`V3.shellKit`：lens 壳面、loft 管、spiral 螺、ball 珍珠，面的朝向自动定），模型在 [30-shell-m1.js](src/30-shell-m1.js)（扇贝、花蛤、青口、沙钱、珍珠贝、海星）和 [30-shell-m2.js](src/30-shell-m2.js)（白玉螺、织纹螺、笔螺、女王凤凰螺、鹦鹉螺、虎斑宝贝）。
- [30-shells.js](src/30-shells.js) 的 `build` / `KINDS` 接口不变，先用雕刻版，没有时用体素版；体素版还在源码里，网址加 `?shells=voxel` 可以对照。原文件备份在 `_backups/cabin-shells-voxel-20261112/`。
- 测试：`node --test test/shell-sculpt.test.mjs`（每种都有雕刻版、三角数、归一大小、没有退化三角、从任何方向都看不穿、翻过来从下面看得见、共享缓存）；体素版仍由 `node test/shell-surfaces.test.mjs` 测。对比图：`node tools/shell-compare.mjs --stage <构建目录> --tag new --ids …`。
- 没做到的：虎斑宝贝的斑点比体素版稀；织纹螺的珠粒主要靠颜色；花蛤的锯齿纹更像斜纹；扇贝背面没有肋。
- 潮汐拾物里的海胆空壳、虹彩鲍壳（2026-11-13）：网页版不再用 MC 方块模型，改回三角面（[31-washup-catalog.js](src/31-washup-catalog.js)）。海胆是 11-12 方块化之前的雕刻原样还原（1,280 三角）；鲍壳原来是体素，没有三角原版，重新雕了一个（708 三角：耳形浅杯、靠一端的螺顶、一排 5 个真通孔、里面虹彩、外面褐色螺纹）。MC 资源包仍用方块版（31-collectible-cubes / -abalone / -render 和 `tools/collectible-mc-pack.mjs` 没动）。两个模型闭合、绕向一致：`node --test test/washup-sculpt-closed.test.mjs`。对比图：`node tools/shell-compare.mjs --stage <构建目录> --tag new --ids sea_urchin_test,rainbow_abalone`。

## 资源释放与逐帧开销（A3，2026-11-12）

按 [A3 排查清单](../../../../_work/cabin-a2-20261112/A3-静态排查清单.md) 的优先级修了源码，没有改渲染效果和玩法：

- **整屋重建**：换房子 / 恢复 / 布置完成时，缓存的每份房屋网格连同自己的贴图图集和层材质一起释放（原来只清门和灯笼）。过期的异步构建结果自己释放，不再挂到新房子上。
- **部件登记**：`V3.parts.untag(obj)` 按对象注销。房屋网格被当前房子接纳后才登记，淘汰、拖家具换网格、切屋时注销，`V3.parts.objects('小屋')` 里不再留着已拆掉的网格。
- **相框**：换照片时释放旧相框面片的几何。**鱼群和脚印**：重建时调用 `InstancedMesh.dispose()` 释放实例缓冲。
- **悬停描边**：源材质 dispose 时同步释放对应的遮罩材质；每帧复用临时对象。描边画面逐字节不变。
- **家具**：开关快照只在门/灯笼真的变化时重建；电视关着不重绘；家具状态没变就不写 localStorage（关页面和切屋时照旧必写）。同一房子开两个标签页时，空闲的那个不再每 5 秒覆盖另一个的家具状态。
- **灯光与剖切**：每帧不再分配临时数组/集合；选出的灯和剖切结果与原来一致。剖切仍每帧重写可见性（布置模式和阴影通道依赖它），灯光仍每帧排序（没有可靠的"位置没变"信号）。

没做的：后处理 / DPR / 阴影分辨率 / 静止鼠标仍每 80 ms 拾取 / 空闲仍持续渲染。

**核显实测（2026-11-12，AMD Radeon 780M，Edge 100 有界面窗口，ANGLE/D3D11，全屏 1920×1027 画布、系统缩放 125%）**：`node ../../../../haibian/test/cabin-perf-gpu.mjs`，每项重开页面、预热 6 秒、量 12 秒。

| 场景 | 不限帧时每帧耗时（中位 / p95 / p99） | 相当于 |
| --- | --- | --- |
| 默认（晴天正午） | 9.2 / 10.5 / 11.6 ms | 约 108 帧/秒 |
| 夜晚 | 8.8 / 11.1 / 12.3 ms | 约 113 |
| 雷雨黄昏 | 9.4 / 12.0 / 16.5 ms | 约 104 |
| 下雪 | 9.2 / 11.6 / 13.8 ms | 约 108 |
| 一楼剖切视角（对照） | 8.7 / 11.0 / 13.7 ms | 约 114 |
| 一楼视角 + 鼠标停在家具上（描边通道） | 9.4 / 12.0 / 14.2 ms | 约 105 |
| 关后处理 | 6.3 / 9.5 / 13.7 ms | 约 151 |
| 只关后处理的 MSAA | 6.5 / 9.6 / 14.3 ms | 约 148 |
| 只关 Bloom | 8.8 / 10.2 / 12.7 ms | 约 113 |
| 关阴影 | 7.6 / 9.4 / 13.5 ms | 约 129 |
| 阴影 2048² | 8.2 / 10.3 / 12.7 ms | 约 120 |
| 低配组合（MSAA 0 + 阴影 2048² + 渲染像素比 1） | 4.4 / 5.2 / 5.9 ms | 约 227 |

- 按显示器刷新率（75 Hz）正常显示时，默认、夜晚、雷雨、悬停四项全部稳定 75 帧/秒：p99 13.5–13.6 ms，没有一帧超过 20 ms。**在这台机器上不需要任何降档。**
- 后处理里贵的是 4× MSAA（约 2.7 ms），不是 Bloom（约 0.4 ms）。阴影总共约 1.6 ms，4096²→2048² 省约 1 ms。悬停描边约 0.7 ms（和同一视角不悬停比）；鼠标停在空处时量不出 80 ms 拾取的开销。
- 单把渲染像素比降到 1 没有收益（瓶颈不在填充率）；和 MSAA、阴影一起降才明显。
- 所以这几项**没有改默认值**：780M 上余量足够，改了只会掉画质。如果以后要照顾更弱的核显，现成的方案是加一个「低配」档位：后处理 MSAA 0、阴影 2048²，每帧从约 9.2 ms 降到约 4.4 ms。
- 量的时候机器要空闲：同时跑别的测试时，雷雨场景曾量出 34% 的帧超过 20 ms，空闲时重测是 0.9%。测的是静止镜头，没有量拖动镜头、布置模式、切换楼层那一下的卡顿，也没有量显存。

验证（都不连真实服务）：

| 命令 | 测什么 |
| --- | --- |
| `node --test test/a3-house-lifecycle.test.mjs test/a3-parts-registry.test.mjs test/a3-scene-disposal.test.mjs test/a3-hover-outline.test.mjs test/a3-tick-churn.test.mjs` | 29 项。真实模块 + 真实 three 在 Node 里跑：释放事件、登记表、遮罩缓存、空闲帧的写盘/重绘/分配。对修复前的源码会失败 |
| `node ../../../../haibian/test/cabin-a3-browser.mjs` | Edge 里跑真实构建页（先 `CABIN_BUILD_DIR=<暂存目录> node build.mjs`，再设 `CABIN_TEST_STAGE`）：连续整屋重建后 `renderer.info` 的贴图/几何数不变、实例网格 dispose 触发、登记表无脱离场景的房屋网格、换相框几何数不变、悬停描边仍出图、空闲 17 秒家具状态零写入、无页面报错 |

修复前的构建跑同一个浏览器脚本的对照数字：每次整屋重建贴图 +1（26→30）、实例网格 dispose 0/12、剖切和拖动折腾后登记表里 1347 个脱离场景的对象、换 10 次相框几何 +60、空闲 17 秒写盘 2 次。修复后依次是 25→25、12/12、0、+0、0。

注意：`test/game-house.test.mjs`、`test/mc-view.test.mjs`、`test/mc-house.test.mjs`、`test/fb-ui.test.mjs` 会**无条件重建 `dist/`**，源码改到一半时别跑。它们需要 `puppeteer-core`：2026-11-12 下午已在 `web/` 下按 lockfile 装好（`PUPPETEER_SKIP_DOWNLOAD=1 npm ci`，25 个包，不下载浏览器，用本机 Edge）。装好后在最终源码上的结果：game-house 131 项、mc-view 25、mc-house 63、fb-ui 49、visual-feedback、furniture-play-browser、hover-outline `--browser`、shell-surfaces `--browser`（48 个视角）、block-editor 173 全部通过。

已知不稳定（两项，都不是今天的改动带来的，原因都没查清，没有改测试也没有改代码）：

- `node test/interaction-hover.test.mjs --browser` 第 52 行（`V3.emit('model')` 之后提示应当隐藏）：最终源码 3 次里失败 1 次，**今天所有改动之前的构建** 6 次里失败 4 次；单独复现那一步（三份构建各一次）提示都是立刻隐藏的。
- `node test/hover-outline.test.mjs --browser` 的 `collect actual outline and label`（冲上来一只贝壳后把鼠标移上去，应当出现描边和「点击拾取」）：15:50 的源码 5 次里失败 4 次，**加风铃 / 螃蟹 / 端碗之前的构建**（14:04 那版）4 次里失败 3 次，失败率相当。单独复现那一步，两份构建都是一移上去就出提示和描边。它在 13:45 的那一轮里通过过一次，所以上一条里写的「全部通过」只说明那一次。

## 测试

在 web/ 下按顺序跑：

| 命令 | 测什么 | 通过时显示 |
| --- | --- | --- |
| `npm run build` | 构建所有页面 | 每页都是 `syntaxErrors=0` |
| `npm test` | 服务/API 契约（140 checks）+ 角色状态机、动画顺序、降级和拾取归属 | 两组全部通过 |
| `node test/fb-ui.test.mjs` | 工作台的反馈界面（用 Edge） | `RESULT: OK 49 checks` |
| `node tools/refkit/selftest.mjs` | 2D 反馈页面（用 Edge） | `SELFTEST: PASS` |
| `npm run test:share` | 鲸图读写和共用样例（不开浏览器，约 4 秒），见下面「鲸图」一节 | `ALL PASS (N checks)`；后面带「跳过了」说明没测读 Java 写的图 |
| `npm run test:mc` | 网页按 MC 的模型画方块（不开浏览器）：模型、网格、光照、箱子和床；设了 `MC_JAR=<MC 客户端 jar>` 时再用真 jar 查一遍 | 每个文件最后一行是 `N passed, 0 failed`；没设 `MC_JAR` 时 mc-realjar 打印 SKIP |
| `npm run test:mc-view` | MC 方块查看页（用 Edge）：读 jar、缓存、打开鲸图 | `N passed, 0 failed` |
| `npm run test:house` | 小屋 v4 方块房子：生成器、`fixtures/house-v4/`、2D 草图（不开浏览器）；设了 `MC_JAR` 时查用到的方块状态 jar 里都有 | `ALL PASS (N checks)`；没设 `MC_JAR` 时后面带说明 |
| `npm run test:mc-house` | 工作台模型「小屋 v4 方块草图」（Node 部分 + Edge；加 `--node` 只跑 Node 部分） | `N passed, 0 failed` |
| `npm run test:game` | 游戏页的方块房子（用 Edge，约 4–5 分钟）：房子读内嵌的鲸图且和生成器一致、三个楼层、按方块走路（一楼 + 阁楼、门、家具挡路）、她真的走进屋上阁楼再出来、冲上来的贝壳她去捡；导入 MC 抓回来的房子（灯、屏幕、风铃、遮阳伞、贝壳柜跟着方块，重开还在，恢复后一样；只跑这一节设 `GAME_HOUSE_ONLY=import`，见 ../docs/HOUSE-V4.md 第 17 节）；布置模式（挪 / 转 / 加 / 拆家具、撤销、放弃、完成后重开还在、导出再导入逐格一样、整栋房子挪一格转 90°、真的鼠标长按拖动；只跑这两节设 `GAME_HOUSE_ONLY=arrange`，只跑挪房子设 `house`，见第 18 节）；相册和相框（真的点相册矮桌、加照片、改名删除排序、真的点画框墙换照片、布置模式加相框换照片、照片跟着家具和房子走、重开还在、导出再导入照片都在、坏照片不画；只跑这一节设 `GAME_HOUSE_ONLY=photos`，见 ../docs/PHOTOS.md 第 5 节）；设了 `MC_JAR` 时再用真贴图画一次 | `ALL PASS (N)`（2026-11-08：130 项）；没设 `MC_JAR` 时多一行 SKIP |
| `npm run test:editor` | P6 纯数据编辑不变量；已 build 并启动 5194 时追加 `-- --url http://127.0.0.1:5194/studio.html` 验证真实按钮、照片家具移动与导出再读，生成 P6-001 输入 | 全部断言通过；浏览器产物在 `../tmp/recovery-20261109/editor/` |
| `npm run test:chime` | 阵风与人物共用冷却、静音/解锁/距离、房屋重建 | Node tests 全过 |
| `npm run test:visual` | 原创门/木板/灯笼贴图、眼睛 glow（自带与导入模型默认都不全亮、勾选后恢复） | 全部断言通过 |
| `node --test test/night-sleep.test.mjs test/follow-camera.test.mjs test/ysm-face-tune.test.mjs` | 夜里睡觉、跟随镜头、数值输入和导入模型的表情（不开浏览器） | 9 + 12 + 7 项通过（不给 `YSM_WINTER_ZIP` 时 ysm-face-tune 跳过 1 项） |
| `node --test test/ysm-eye-glow.test.mjs` | 眼睛全亮规则（不开浏览器）：按骨骼名认眼睛、导入模型默认不亮、可当场开关、非眼睛的 glow 保留 | 6 项通过（给了 `YSM_WINTER_ZIP` 是 7 项） |
| `npm run test:furn` | 所有家具导出、尺寸与旋转包围盒；设 `MC_JAR` 验真资源包 | 全部断言通过 |
| `npm run test:zip-fallback` | 老浏览器没有 `DecompressionStream('deflate-raw')` 时的纯 JS inflate 兜底（见 [BROWSER-COMPAT](../docs/BROWSER-COMPAT.md)） | `✓ zip 兼容兜底全部通过` |
| `npm run check` | 代码里没有写死的绝对路径 | `PASS  扫描 N 个文件，0 处违规` |

测试用自己的端口（`npm test` 用 5299，fb-ui 用 5298，被占用时设 `FBUI_PORT=5311`），不用 5193 和 5194，开着服务也能跑。

> 2026-11-09：老浏览器（实测 Edge 100）不支持 `DecompressionStream('deflate-raw')`，默认角色「蓝色大肥鱼」会解不开。
> `src/10-zip.js` / `src/14-mcjar.js` 已加纯 JS inflate 兜底；问题经过、修法和验证见 [BROWSER-COMPAT](../docs/BROWSER-COMPAT.md)。

## 鲸图（分享 PNG / .schem）

鲸图是一张普通 PNG，里面的 `xjSc` 块装着整个 `.schem`（Sponge 第 3 版）。格式约定只看 [../docs/FORMAT.md](../docs/FORMAT.md)；两边共用的样例和怎么重新生成见 [../fixtures/share/README.md](../fixtures/share/README.md)。

| 文件 | 是什么 |
| --- | --- |
| `src/12-nbt.js` | `V3.nbt`：NBT 读写（大端）、MUTF-8、varint、gzip / gunzip |
| `src/13-share.js` | `V3.share`：读鲸图和 `.schem`、写 `.schem` 和鲸图、dump |
| `tools/lib/v3-node.mjs` | 在 Node 里加载 `src/` 的浏览器模块（测试和命令行工具用） |
| `tools/share.mjs` | 命令行工具 + 样例生成器（生成器的代码在 `tools/lib/share-raw.mjs`、`share-cases.mjs`、`share-odd.mjs`） |
| `test/share.test.mjs` | 测试：`npm run test:share`；加 `--require-cross` 时缺了 `fixtures/share/java/` 的图算失败 |

两个模块是所有页面共用的（编号小于 90），加载时只定义函数，不碰 DOM。解压和压缩用 `DecompressionStream` / `CompressionStream`，新版 Chrome、Edge、Firefox、Safari 和 Node 24 都有。

### 模型

`read` 读出来的、`writePng` / `writeSchem` 要的都是这个对象：

```js
{
  size: [W, H, L],                 // x / y / z 方向的格数，每边 1–1024，总数 ≤ 4,194,304
  offset: [x, y, z],               // 第 (0,0,0) 格相对站立点的位置
  dataVersion: 4790,               // MC 数据版本；读到别的值照样保留，并给警告 data_version
  meta: { compound: {…} } | null,  // Metadata 原样（带类型的 NBT，见下面）；null = 没有 Metadata
  palette: ['minecraft:stone', …], // 方块状态字符串，原样保留
  cells: Int32Array,               // 长 W×H×L，值是 palette 的下标；格子 i = x + z×W + y×W×L
  blockEntities: [{ pos: [x, y, z], id: 'minecraft:chest', data: { compound: {…} } | null }],
  warnings: ['data_version', …],   // 读的时候发现的问题（FORMAT.md 第 5 节），排好序
}
```

- 读出来的一定是规范形式：palette 按格子里第一次出现的顺序排、没有用不到的项；blockEntities 按格子顺序排。
- 写的时候宽松一点：`cells` 可以是普通数组，palette 可以有没用到的项、顺序随意，写出去会规范化。`meta` 原样写，只有 `RequiredMods` 按调色板重新算（一个外部模组都没有就去掉）。写入器不会自己填 `Date`、`Source`，要写就放进 `meta`。

带类型的 NBT（和 FORMAT.md 第 4 节的 dump 是同一个形状）：每个值是只有一个键的对象，键就是类型：`{byte: 1}`、`{short: 1}`、`{int: 1}`、`{long: '-5'}`（十进制字符串）、`{float: '3f800000'}`、`{double: '3ff0000000000000'}`（IEEE 位，小写十六进制，NaN 和 −0 也不会变）、`{string: '…'}`、`{byteArray}`（Int8Array）、`{intArray}`（Int32Array）、`{longArray}`（BigInt64Array）、`{list: [值…]}`、`{compound: {键: 值}}`。读出来的 compound 是 `V3.nbt.Compound` 的实例，原型链上没有 Object.prototype（`__proto__`、`constructor` 这种键只是普通的键）；写的时候也收普通数组和普通对象。标签总数最多 2,097,152 个（`V3.nbt.MAX_TAGS`，FORMAT.md 第 2 节），读和写都数，超了报 `too_large`。`V3.nbt.toJSON(值)` 转成可以 `JSON.stringify` 的形状，`V3.nbt.fromJSON(json)` 反过来；`V3.nbt.int(5)`、`V3.nbt.compound({…})` 这些可以少打几个字。

### V3.share 的函数

| 函数 | 说明 |
| --- | --- |
| `await read(bytes)` | 鲸图 PNG 或裸 `.schem` → 模型。也收 `Blob` / `File` / `ArrayBuffer` |
| `await readSchem(bytes)` | 只读 `.schem`（gzip 过的 NBT） |
| `extract(png)` | 从鲸图里取出 `.schem` 字节（按 FORMAT.md 第 1 节检查） |
| `await writeSchem(model)` | 模型 → `.schem` 字节 |
| `await writePng(model, png?)` | 模型 → 鲸图字节。给了 `png` 就把数据放进这张图（原来有的 `xjSc` 会被替换），不给就用 16×16 纯色占位图 |
| `dump(model)` / `fromDump(json)` | 模型和 dump JSON（FORMAT.md 第 4 节）互转；`fromDump` 很严格，JSON 不对抛 `bad_dump` |
| `canonicalize(model)` | 规范化后的副本（不改原来的） |
| `requiredMods(palette)` | 调色板里不是 `minecraft` 的命名空间，去重、排好序 |
| `index(size, x, y, z)` / `posOf(size, i)` | 格子坐标和下标互转 |
| `png.isPng / crc32 / chunks / chunk / setChunk / solid` | PNG 小工具：认 PNG、算 CRC、列出块、做块、替换块、生成纯色图 |
| `LIMITS`、`DATA_VERSION`（4790）、`SOURCE`、`MESSAGES` | 常量 |

出错时抛 `V3.share.ShareError`：`e.code` 是 FORMAT.md 第 5 节的代码（`no_data`、`bad_crc`……），`e.message` 是可以直接给用户看的中文，`e.detail` 写具体哪里不对（给开发者看）。写入器用和读取器一样的规则先检查模型，所以写也会抛同样的错。

```js
try {
  const model = await V3.share.read(file);           // file 来自 <input type=file> 或拖放
  const png = await V3.share.writePng(model, screenshotPngBytes);
} catch (e) {
  if (e instanceof V3.share.ShareError) alert(e.message); else throw e;
}
```

### 在 Node 里用

```js
import { loadV3 } from './tools/lib/v3-node.mjs';   // 路径按自己的位置改
const { V3 } = loadV3(['12-nbt', '13-share']);      // 先加载 00-core.js，再加载这两个
const model = await V3.share.read(fs.readFileSync('x.png'));
```

`loadV3` 在主 realm 里跑浏览器模块（`Uint8Array` 等和 Node 里是同一个类），用一个假的 `window`。模块名可以写 `'13-share.js'`、`'13-share'`、`'share'` 或编号；`opts.core: false` 不加载 00-core.js，`opts.three: 'real'` 加载真的 three.js（默认是个小替身），`opts.url`、`opts.globals` 用来补 `location` 和别的全局变量。模块之间只能通过 `window` / `V3` 互相找，彼此的顶层变量看不到。

### 命令行（在 web/ 下）

```
node tools/share.mjs info <文件>                    看文件里有什么（PNG 块、尺寸、调色板、警告…）
node tools/share.mjs dump <文件>                    打印 dump JSON；读不了时打印 {"error":…} 并退出 1
node tools/share.mjs extract <png> <out.schem>      把鲸图里的 .schem 原样取出来
node tools/share.mjs wrap <schem> <out.png> [图片]  把 .schem 原样塞进图片（不给图就用 16×16 纯色图）
node tools/share.mjs make-fixtures                  重新生成 fixtures/share/ 下的 cases/、js/、odd/
node tools/share.mjs check-fixtures                 在内存里重新生成一遍，和提交的逐字节比
node tools/share.mjs list                           列出所有样例（Markdown 表格）
```

## 不进 git 的本地资源

以下为依赖缓存或可选本地参考资源，不是核心网页/模组构建输入。新机器无需旧 v3 工程；运行 `npm ci` 按锁文件安装测试依赖，网页构建所需自有资产和家具资源均在当前仓库。可选参考项目缺失只影响相应参考页面，反馈配图会随完整工程包保留。

| 路径 | 是什么 | 缺了会怎样 |
| --- | --- | --- |
| `node_modules/` | puppeteer-core，用来驱动 Edge 截图和跑界面测试 | 截图工具、fb-ui 测试、refkit 自检都跑不了。也可以在 web/ 下运行 `npm install` 装回来 |
| `refs/scene-01/` | MyGO scene-01 的 2D 标注项目（约 20 MB） | 2D 反馈的项目列表里没有它 |
| `refs/models/tripo-ref.glb` | Tripo 参考模型（用户自己生成的，约 11 MB） | 工作台里的「参考模型」和「Tripo」对照打不开 |
| `feedback/shots/` | 反馈截图（反馈内容 `feedback/items/` 在 git 里） | 反馈里看不到截图 |

另外 `dist/`（构建产物）、`shots/`（截图输出）和 `test/tmp-*`（测试临时文件）也不进 git，随时可以重新生成。
