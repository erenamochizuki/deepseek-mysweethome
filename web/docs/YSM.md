# YSM 模型导入

把我的世界「是，史蒂夫模型」（YSM）模组用的人物模型放进海边小屋。2026-11-05 第一步：**只做导入**，支持**不加密**的模型。格式细节见 `docs/YSM-FORMAT.md`。

**默认的小鲸鱼就是一个 YSM 模型**（2026-11-05 第9轮起）：「蓝色大肥鱼」（作者 ccci202）。用户买下了这个模型，作者同意修改并作为游戏默认角色打包（包里写的「不可修改」是作者没改）。
- 文件 `assets/girl/fatfish-1.2.zip`；`build.mjs` 把 `assets/` 下的文件内联进页面（`window.__V3_ASSETS`，base64），两个页面各多约 0.9 MB。
- 模型 id `builtin:fatfish`。没选过角色时就是它；设置里还能换「小鲸鱼 v1（自带）」或导入的模型。只有这个模型能打包，dsV4P 等别人的模型仍然只在本地测。
- 游戏页开场景之前先把它读好（`V3.ysmUI.preload()`），场景里直接用它建（`initialBody()`），不会先闪一下 v1。
- **眼睛不全亮（所有模型，2026-11-12 起）**：`ysmGlow*` 骨骼在 YSM 里是全亮、不受光照的，放在眼睛上，阴天和夜里就像两盏灯。现在的规则在 `29-ysm.js`（`Y.isEyeGlowBone`）：一根 `ysmGlow*` 骨骼自己或任何一级父骨骼的名字里有 eye / pupil / iris / 眼 / 瞳（不算 eyebrow、eyelash），就不进全亮叠层，和脸一起受光；眼睛的面本来就在主体网格里，什么都不会少。灯、光环这类不是眼睛的 `ysmGlow*` 照旧全亮。
  - 以前这件事只靠 `29-ysmui.js` 的 `FATFISH_TUNE.disableGlowBones`（八个骨骼名）做，而这张表只在模型 id 是 `builtin:fatfish` 时才用。同一作者的「蓝色大肥鱼(冬装)」是玩家导入的模型，八个骨骼名一模一样，却拿不到这张表，所以它的眼睛照旧在夜里发亮。名单保留作兜底。
  - 想要作者原样的全亮眼睛：设置 →「角色」→ 模型设置里勾「眼睛发光（本游戏）」，每个模型单独记住（键 `@eyeGlow`），当场生效、不用重建角色。
  - 测试：`node --test test/ysm-eye-glow.test.mjs`（设 `YSM_WINTER_ZIP=<冬装 zip>` 时再用真文件核对；设 `YSM_SRC_DIR=<旧 src>` 可拿修复前的源码跑同一批断言，应当失败）。说话、大笑、惊讶、躲雷害怕时换她「脸部选项」里的眼睛和嘴（只在那一帧临时改，不动玩家的设置）；闲逛后偶尔站着发呆约 1 分钟，让她自己的控制器演站久了的待机动画（铁盆那段）。

## 怎么用

**游戏页**（`cabin.html`）
1. 右下角「设置」→「角色」。
2. 点「导入 zip / .ysm」或「导入文件夹」。也可以把 zip、模型文件夹或 .ysm 直接拖进窗口。
3. 导入后会自动换上新角色。列表里随时可以换回「蓝色大肥鱼（自带）」「小鲸鱼 v1（自带）」，或者删掉导入的模型。
4. 「身高」默认 1.26 米，可以调（蓝色大肥鱼和导入的模型都按它缩放；v1 小鲸鱼固定 1.3 米，门高 2 米）。按作者的默认设置（含模型自己的「模型大小」默认值）站着时头顶的实际高度来缩放；玩家在模型设置里改的「模型大小」「头部缩放」之类在这个基础上变大变小，刷新页面后也保留。「角色音效」可以关掉模型自带的音效。
5. 选中导入的模型后，「角色」页下面会出现「模型自带设置」（作者在 ysm.json 里写的选项，比如 dsV4P 的模型大小、头部大小、发光眼睛、尾巴、钢盆）。
   - 作者分了好几页的（蓝色大肥鱼：脸部选项 / 面部细调 / 服饰 / 额外），每页一个可折叠的组，默认只展开第一组。
   - 同一个设置出现在好几页里（比如「禁用自动表情」）时，改一个其余的跟着变。
   - 单选的每个选项是一句 Molang，可能同时改好几个变量（`v.roaming.pants_change1=1;v.roaming.le=1`），全部记住。
   - 说明文字里 MC 的颜色代码（`§c§l`）去掉了。
6. 还有一个我们自己加的「腿长（本游戏）」：50%–120%，默认 100%（作者原样）。腿沿自身长度缩短，脚掌不压扁，脚还踩在地上，身高不变（所以腿短了上半身会大一点）。只改游戏里的显示，不改模型文件；每个模型单独记住（键 `@legs`）。

**工作台**（`studio.html`）
- 模型选「导入的 YSM 模型」，底部会出现小面板：导入、选已导入的、删除，并显示作者和协议。
- 顶栏会出现「动作」「动画」「贴图」下拉框。「动画」里能逐个播放模型里的所有动画（主动画、表情动作、各模组兼容动画）。
- 反馈工具能按骨骼点选，部位路径是 `小鲸鱼/头|身体|手臂|腿|尾巴/<骨骼名>`。

**存在哪**：导入的模型存在当前浏览器里（IndexedDB `v3-ysm`）。用哪个角色存在 localStorage `v3.girl.model`。换浏览器、清浏览器数据都要重新导入；用 `http://127.0.0.1:5194` 打开和直接双击 html 打开也是分开存的。

## 支持什么

| 内容 | 支持情况 |
| --- | --- |
| 新版格式：文件夹 / zip，带 `ysm.json`（spec 2） | 支持 |
| 旧版格式：`main.json` + `*.animation.json` + png（可带 `info.json`） | 支持 |
| 加密的 `.ysm`（文件头 `YSGP`） | **不支持**。只显示文件头里的明文：名字、作者、协议、简介、包含哪些东西；并说明要向作者要不加密的源文件 |
| 几何：基岩版模型（骨骼、方块、旋转、inflate、盒子 UV / 逐面 UV、镜像、负尺寸） | 支持，规则照 Blockbench |
| 贴图：多张皮肤（可切换）、`default_texture` | 支持；PBR 贴图（`_s`、`_n`）不用 |
| 动画：关键帧、Molang、linear / catmullrom / step、loop / hold_on_last_frame | 支持 |
| 动画叠加：`pre_parallel0–7` → 主动画 → 手部动画 → `parallel0–7` | 支持；后面的层覆盖前面的，只有 `parallel*` 的旋转是叠加 |
| `functions/*@player_init.molang`、`*@player_update.molang` | 支持 |
| 模型自带设置（`extra_animation_buttons` 里的 `config_forms`：滑条 / 勾选 / 单选） | 支持。工作台面板「模型设置 ▸」和游戏「角色」页都能改，改了马上生效，每个模型单独记住（localStorage `v3.ysm.vars.<id>`） |
| 时间轴 `timeline` 里的 Molang | 支持（拼成一整段再执行） |
| 常用查询：`q.anim_time`、`q.life_time`、`q.ground_speed`、`ysm.head_yaw/pitch`、`ysm.is_close_eyes`（眨眼）、`ysm.first_order/second_order`（头发尾巴摆动）、`ctrl.*` 状态 | 支持（数值是估计的，见 YSM-FORMAT §6） |
| 天气：`ysm.weather`（0 晴 / 1 雨 / 2 雷雨）、`q.is_in_water_or_rain`（正淋着雨） | 支持。游戏里跟着真实天气；跑回家的路上算淋着，到了门廊板上不算。工作台顶栏有「天气」可以预览 |
| 蹲下（`sneaking` / `sneak`）时整体往下挪 | 支持。MC 画蹲着的玩家会往下挪 2 px，新版模型的蹲下动画都把脚抬高了约 2 px；我们按每个模型实测抬高的量往下挪（最多 2 px），蹲着时脚和站着一样高。旧版兔子没抬，就不挪 |
| 动画控制器（`files.player.animation_controllers`，键是槽位名，如 `player.parallel_7`） | 支持 `main`、`pre_parallel_0–7`、`parallel_0–7` 这些槽位：状态、条件跳转（一帧最多跳一次）、`on_entry` / `on_exit`、每个动画的权重、`blend_transition` 淡入淡出、`ysm-builtin` 状态。被接管的槽位不再放 main 文件里同名的并行动画；`main` 被接管时由它决定主动画 |
| 脚本控制器 `@player_ctrl_<槽位>.molang` | 支持同样的槽位：`ctrl.set_animation('名字'[, ctrl.loop / play_once / hold_on_last_frame])`、`set_beginning_transition_length`、`reset`，返回 `state_continue / pause / stop / bypass`（bypass = 照内置的走） |
| `ysmGlow*` 发光骨骼 | 支持：这根骨骼自己的方块不受光照（全亮，夜里能看见），子骨骼不算。单独一个网格叠着画，主体还是一次绘制 |
| 音效（动画里的 `sound_effects`、`ysm.play_sound`，文件在 `sounds/`） | 支持（WebAudio；浏览器要等页面上点过一次才出声）。设置「角色」页「角色音效」可以关 |
| 下雨撑伞 | 支持有 `RightArm` 的模型：右大臂往外抬、小臂往上弯，手在脸颊外侧握伞，伞杆最多斜 14°（`umbrellaArm` / `umbUp`）。同时她自己的淋雨效果照样显示 |
| 粒子、第一人称手臂（`arm.json`）、手持物品、其余控制器槽位（手部、骑乘、盔甲……） | 还不支持 |

## 在游戏里怎么动

| 游戏里的动作 | 用模型里的哪个动画（找到第一个有的） |
| --- | --- |
| 站着 | `idle` |
| 走路 | `walk`（按她的速度加快 / 放慢） |
| 蹲下捡贝壳 | `sneaking` / `sneak`，再叠一个伸手 `use_mainhand` / `use_righthand` / `swing_hand` |
| 欢呼 | `jump` |
| 打雷时缩着 | `sneaking` / `sneak`（`sit` 是骑乘坐姿，坐得比门廊沿高，不用） |

- 头跟着她看的方向转（YSM 自己也是这样）。
- 旧版小鲸鱼那些「起步时摆幅变小、跑步前倾、闪电时哆嗦」的骨骼调整不加在导入的模型上：骨骼轴向不一样，动作都用模型自己的动画。
- 下雨时撑我们的小伞（模型要有 `RightArm`）；模型自己有淋雨效果的照样显示（蓝色大肥鱼身边会有雨滴）。
- 表情由模型自己的动画决定（比如 `ysm.is_close_eyes` 眨眼；蓝色大肥鱼的眨眼和自动表情在 `pre_parallel1` / `parallel1` 里）。自带的蓝色大肥鱼另外按游戏的心情换脸：说话时嘴轮换 OoO / OωO / 无 / O∀O，大笑 >_< O∀O，惊讶 O△O，躲雷时「害怕」，其余时间用她自己的自动表情。
- 欢呼时她的控制器会反复走「跳 → 落地」，落地动画 `jump_end` 一直在播（游戏里她总是踩在地上）。
- 对话框和伞尖的位置按模型头部顶点算出来的头顶（`inst.headTop`；骨骼没有网格，量不出包围盒）。

## 协议

- 导入时会显示模型自己写的作者和协议。例如 dsV4P（DeepSeek 酱，作者 B 站「羊毛」）写的是 ARR（保留所有权利），只能自己用。
- 别人的模型只存在玩家自己的浏览器里。**不要把别人的模型复制进工程、也不要打包进页面**；想作为游戏自带的角色，要先问作者。唯一的例外是默认小鲸鱼蓝色大肥鱼：用户买下了它，作者同意修改并打包（2026-11-05）。
- 加密的 .ysm 不解密：解开它就是绕过作者和 YSM 的加密保护，做成导入功能等于给所有人一个解密工具。YSM 官方说明也写了加密格式「不能转换回普通模型文件」。

## 代码

| 文件 | 内容 |
| --- | --- |
| `src/10-zip.js` | 读 zip（不加库；中文文件名先试 UTF-8 再试 GBK） |
| `src/11-molang.js` | Molang 解释器：自己解析，不执行任何 JS；`V3.molang.radians` = 反三角函数返回弧度（YSM 是这样） |
| `src/29-ysm.js` | `V3.ysm.load(files)` → 模型描述（含 `controllers`、`sounds`）；`V3.ysm.build(model, { height, vars, tune })` → 角色（一个蒙皮网格、一次绘制、每根骨骼一个面组；发光骨骼另一个网格）；槽位 / 动画控制器 / 脚本控制器、音效；`V3.ysm.header(bytes)` 读加密文件头；调试 `inst.slotInfo()` |
| `src/29-ysmui.js` / `.css` | 存储、导入界面、自带模型（`BUILTIN`、`preload` / `initialBody`、`FATFISH_TUNE`）、工作台模型 `ysm`、游戏设置「角色」页；换角色调 `V3.actor.useBody(id, builder)` |
| `src/65-girl-actor.js` | 建场景时先用 `initialBody()`；`useBody()` 玩着也能换身体；模型带 `noOverlay` / `setLook` / `setWeather` / `umbrellaArm` / `umbUp` / `headTop` / `longIdle` 时按 YSM 模型的方式处理 |
| `build.mjs` | `assets/` 下的文件内联进页面（`window.__V3_ASSETS`） |
| `src/69-settings.js` | 设置面板支持 `type: 'custom'` 的行（模块自己画） |

## 测试样本（只在本地测，不进工程）

- `../dsV4P.zip`：新版格式，155 根骨骼、567 个方块、58 个主动画 + 8 个表情动作。作者羊毛，ARR。
- 社区合集 github.com/Elaina69/Yes-Steve-Model-Repo 里的 `_Rabbit_1.zip`：旧版格式，110 根骨骼、1509 个方块，盒子 UV + 镜像。
- `../D蓝色大肥鱼.ysm`：加密，用来测文件头显示。
- 蓝色大肥鱼（`../蓝色大肥鱼_1.2.zip`，作者 ccci202；现在就是自带的默认小鲸鱼 `assets/girl/fatfish-1.2.zip`）：新版格式，458 根骨骼、27,932 个三角面（发光的眼睛 672 个）；工作台「动画」下拉里 293 个动画（main 60 个、表情动作 24 个，其余是各模组兼容动画；16 个叠加层一直在播，不进下拉），每帧更新约 0.11 ms。
  - 全部能用：造型、贴图、站 / 走 / 蹲 / 跳、24 个表情动作（吃白饭、偷米罪的牌子，睡觉、坐……）、眨眼和自动表情、29 个模型设置、淋雨的雨滴、发光眼睛、砸盆音效。
  - 她的控制器 `player.parallel_7`（槽位 parallel_7）：站着不动约 38 秒演待机动画 `idle_1`（铁盆那段），一动就停；跑完收步 `run_end`；跳完落地 `jump_end`；长时间下落开伞 `drop`（游戏里不会掉落）。设置里「禁用待机动画」「禁用掉落动画」现在起作用。
  - 第一人称手臂、弓箭 `arrow.png`、各模组兼容动画游戏里用不到。
- 截图：`test/tmp-ysm/`（ds-rest、rabbit-rest、ds-anim、flow、seat2、pick-head、forms、tail2、foot）。
- dsV4P 自己的两个特点（不是导入器的问题）：
  - 右鞋的鞋带方块挂在左脚骨骼 `LeftFoot` 上（第 3 个方块），走路时会跟着左脚从右鞋里戳出来（`foot.jpg`）；
  - 鲸鱼尾由模型设置「尾巴」（`v.roaming.Tail`）控制，默认不勾，勾上才出来；
  - 腿约占全身的一半（大腿 8 px + 小腿 9.75 px + 脚，全身约 42 px）。
- 骨骼名区分大小写（YSM 基于 GeckoLib）：dsV4P 动画里写的小写 `tail` 对不上 `Tail`，不起作用。
