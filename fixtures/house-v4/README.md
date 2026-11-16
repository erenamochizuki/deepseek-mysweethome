# fixtures/house-v4：小鲸鱼之家 v4 方块房子（P4 定稿）

这里是生成器 `web/src/42-house-mc.js`（`V3.houseMc`）用默认材料（`V3.houseMc.DEFAULTS`：两色屋顶、平滑石英白墙）导出的定稿房子。**不要手改**，改了生成器就重新导出。用户 2026-11-06 选的：方案 B、一楼净高 3 米、两色屋顶、平滑石英、屋脊加盖板（说明见 docs/HOUSE-V4.md）。草图时的方案 A（`house-v4-a.*`）已经删掉，在提交 d3440c4 里。

| 文件 | 是什么 |
| --- | --- |
| `house-v4-b.png` | 鲸图：`xjSc` 块里是整座房子的方块数据（格式见 docs/FORMAT.md）；图片是自己配色的预览（左：南立面，右：俯视，北在上） |
| `house-v4-b.json` | 同一份方块数据的 dump（docs/FORMAT.md §4），给游戏里核对用 |

`web/assets/house/house-v4.png` 和 `house-v4-b.png` 是同样的字节（游戏页内嵌的房子，web/build.mjs 把 assets/ 下的文件打进页面），`export` 一起写，`check` 一起查。

外墙 14 × 10，模型 16 × 12 × 15，807 个方块，35 种状态（含空气），Offset (−6, 0, −15)，Origin (−2, 0, −2)，Facing north。格子 (0,0,0) 在场景里的位置 = Origin + Offset（docs/FORMAT.md §3.2）。场景坐标 +x 东、+y 上、+z 南（朝海），和 MC 一样。

## 怎么重新生成、怎么检查（在 web/ 里跑）

| 命令 | 做什么 |
| --- | --- |
| `node tools/house-mc.mjs export` | 重新生成这 2 个文件和 `web/assets/house/house-v4.png`（只写有变化的） |
| `node tools/house-mc.mjs check` | 在内存里重新生成，和这 3 个文件逐字节比（2D 图也查） |
| `node tools/house-mc.mjs info` | 打印尺寸、高度、楼梯、走路步数、方块数量 |
| `npm run test:house` | 生成器的全部测试（加 `MC_JAR=<客户端 jar>` 会再用真 jar 查每种方块状态） |

- JSON 一律 LF；仓库根的 `.gitattributes` 里 `fixtures/** -text`，git 不会改换行。
- 预览图用 Node 自带的 zlib 压缩，升级 Node 后 PNG 字节可能变。`check` 会说明方块数据是不是一样；一样的话重新 `export` 再提交就行。
- 图片只用自己的配色（`web/src/17-mcfallback.js`），不含 MC 的贴图。

## 给游戏里核对的人（卡片 P4-002）

- 用 `/xjy place` 把 `house-v4-b.png` 原样盖进开发世界，再查每个方块是不是游戏按邻居算出来的样子：栅栏、玻璃板的连接，楼梯拐角，门的两半，灯笼的支撑。读回来和 `house-v4-b.json` 比，也必须完全一样。不一样就报给写生成器的人和 lead，**不要放宽比较**；以游戏为准改生成器，再重新导出。
- 支撑：一楼的灯笼吊在灯梁（整根去皮云杉原木，y=4 那层）下面，阁楼的吊在屋脊楼梯（下半）下面，门廊的 4 盏站在栏杆的栅栏柱上；门下面是地梁（去皮云杉原木）。
- 屋脊盖板：屋脊那两排背靠背的楼梯（y=10）上面各铺一排云杉木下半砖（y=11），半砖不连栅栏和玻璃板，也不改楼梯的形状。
- 最容易出差别的地方：小山墙和主屋顶交界的 4 块拐角楼梯，生成器照 26.1 的 `StairBlock.getStairsShape` 算的（场景格子坐标）：
  - (−4, 6, −7) 云杉楼梯 facing=north shape=inner_right
  - (−3, 7, −8) 丛林楼梯 facing=north shape=inner_right
  - (0, 6, −7) 云杉楼梯 facing=north shape=inner_left
  - (−1, 7, −8) 丛林楼梯 facing=north shape=inner_left
- 其余楼梯都是 straight。栅栏、玻璃板只和整块方块、同类相连（这座房子里它们旁边没有别的东西）。

## P6 工作台往返样本

[workbench-edited.png](workbench-edited.png) 和 [workbench-edited.json](workbench-edited.json) 是 2026-11-09 已通过真实浏览器编辑、导出及 MC 放置抓回验收的固定样本，供 [P6-001](../../mod/cards/P6-001.yml) 使用。它们是从当时的临时验收产物逐字节复制到此处的；干净源码包直接包含它们，无需先运行网页、依赖历史临时目录或重做编辑操作。这两个文件不由上面的房屋生成器 `export/check` 管理。

场景为 16×12×16，265 个非空气方块，Offset (0,0,0)，包含木地板、朝东的双半门和床、朝北的望远镜及相册桌、移动并转向南的照片框；相册与照片框保留 128×128 三色照片。PNG 内嵌鲸图数据，JSON 是同一数据的 dump，必须一起更新，不能手改期望结果以掩盖往返差异。

| 文件 | SHA-256 |
| --- | --- |
| [workbench-edited.png](workbench-edited.png) | `b7c8a45d07b167c776aaf951bec187b26a70ca147693f9eaf23722fb95497028` |
| [workbench-edited.json](workbench-edited.json) | `cb9f11d3691494fd338d53778ea87bf341a3da4bd860f39fec9f8b05c9bb18a6` |

从仓库根执行 `node mod/tools/run-cards.mjs mod/cards/P6-001.yml` 会启动开发 MC 跑该卡，需要 Java 25 JDK；选择顺序为 `--java-home <目录>`、`XJY_JAVA_HOME`、`JAVA_HOME`，均未设置则由 Gradle 从 `PATH` 查找 Java。仅验证运行器及固定样本、不启动 MC：`node --test mod/tools/test/run-cards-portable.test.mjs`。

若确需更新样本，先构建并提供工作台页面，在 `web/` 运行 `npm run test:editor -- --url <studio页面URL>`。当前 [浏览器测试](../../web/test/block-editor.mjs) 将新候选写到 `tmp/recovery-20261109/editor/workbench-edited.{png,json}`；两文件一并更新到本目录后，重新执行 P6-001 的真实 MC 往返验收，并记录新哈希。临时路径只用于重新生成候选，不是使用正式样本的前置条件。
