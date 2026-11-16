# 工具速查

所有命令都在项目根目录运行，路径参数一律相对项目根解析（从别的目录调用也一样）。
环境：Node ≥ 24；唯一依赖 puppeteer-core（已在 node_modules）；截图用本机 Edge；拼图要 ffmpeg 在 PATH。

| npm 脚本 | 等价命令 |
|---|---|
| `npm run build` | `node build.mjs [page]` → `dist/<page>.html`（单文件，file:// 可直接打开）。页面：`studio` 工作台、`cabin` 游戏页（开发用，`?fb=1` 开反馈）、`home` 小鲸鱼之家（只能玩：不带反馈工具和工作台专用模块，约 2.6 MB） |
| `npm run serve` | `node serve.mjs` |
| `npm run shoot -- …` | `node tools/shoot.mjs …` |
| `npm run fb -- …` | `node tools/fb.mjs …` |
| `npm test` | `node test/api.test.mjs` |
| `npm run check` | `node tools/check-isolation.mjs` |
| `npm run release` | `node tools/release.mjs [--out 成品] [--no-build]`：构建三个页面，生成 `成品/反馈工作流/`（工作流 + 工具 + 指引 + 两个演示）和 `成品/小鲸鱼之家/`（只能玩的页面 + 接入说明 + 接口说明）。指引和说明的源文件在 `docs/成品/` |

- `assets/` 下的文件由 `build.mjs` 内联进每个页面（`window.__V3_ASSETS['girl/fatfish-1.2.zip']` = base64）：现在只有默认小鲸鱼蓝色大肥鱼的模型 zip（约 0.9 MB）。

## serve.mjs：本地服务（反馈 API + 2D 反馈 + 静态文件）

```
node serve.mjs [--port 5194] [--fb-dir feedback] [--ref-dir refs]
```

- 只监听 127.0.0.1。`/` 跳转到 `/studio.html`；静态目录：`/` = dist/，`/refs/` = refs/，`/feedback/` = 反馈目录（只读）；`/2d/` = 2D 反馈页面（见下一节）。
- 截图地址 = `/feedback/` + item.shot，例如 `/feedback/shots/fb-20261104-215756-fz7.png`。
- API（错误统一返回 `{error}` + 4xx）：

| 请求 | 返回 |
|---|---|
| `GET /api/ping` | `{ok, build?}`，build 取自 dist/build.json 的 `"build"` 字段（文件存在时） |
| `GET /api/refs` | `{files:[…]}`，refs/ 里的图片（SPEC 之外的补充，参考图下拉用；refs/ 下的子文件夹不列） |
| `GET /api/fb` | `{items:[…]}`，新的在前 |
| `GET /api/fb/<id>` | `{item}` |
| `POST /api/fb` | 条目（不含 id/created）+ `shotData`（png/jpeg/webp dataURL）→ `{item}` |
| `PATCH /api/fb/<id>` | `{status?, reply?:{who:"user"/"ai", text}}` → `{item}`，reply 追加到 thread |
| `DELETE /api/fb/<id>` | json 和截图移到 trash/ → `{ok, id, moved}` |
| `GET /api/ref`、`POST /api/ref {name}` | 2D 反馈的项目列表 / 新建项目（`--ref-dir` 下的文件夹） |
| `/api/ref/<项目>/…` | 2D 反馈页面用：`state` `meta` `img/…` `answers` `upload` `delete` `export`，见下一节 |

- POST/PATCH 必须 `Content-Type: application/json`；请求体上限 25 MB（超了 413）；Host 头不是 127.0.0.1/localhost 时 403。
- 服务端只写 id / created / updated / shot，其它字段（包括 point 里的 anchor 之类扩展字段）原样保存。
- 每个 /api 请求打印一行日志：`时:分:秒 方法 路径 状态码 耗时`。2D 反馈页面的轮询、读取和自动保存不打印（页面每 3 秒查一次更新），上传、删除、新建和出错的请求照常打印。

## 2D 反馈（参考图标注）：tools/refkit/

工作台左边最上面是「3D 反馈 | 2D 反馈」切换。2D = 参考图标注页：在截图上框选、回答我出的问题，一轮一轮确认场景、人物和物件。页面怎么用见 [tools/refkit/GUIDE.md](../tools/refkit/GUIDE.md)；questions.json / answers.json 的格式、服务接口和 agent 每轮的流程见 [tools/refkit/README.md](../tools/refkit/README.md)。

- 项目 = `refs/<项目名>/`（serve.mjs 的 `--ref-dir`，默认 refs/）里有 questions.json、answers.json 或 images/ 的文件夹。示例：`refs/scene-01`，三轮答完的 MyGO 场景，见 `demos/mygo-scene-01/README.md`。
- 页面 `/2d/?p=<项目名>`，文件在 `tools/refkit/page/`，不经过 build.mjs，改完刷新就生效。接口 `/api/ref`、`/api/ref/<项目>/{state,meta,img/…,answers,upload,delete,export}`，处理器是 `tools/refkit/server.mjs`。只有页面写 answers.json；写请求带着别的网站的 Origin 一律 403。
- 工作台这边是 `src/79-fb-2d.js`：2D 时一个 iframe 盖住整个工作台，左边一栏是切换、项目选择（新项目、刷新、新标签页打开）和简短说明；3D 画面暂停绘制，工作台的快捷键和拖放（比如 YSM 模型的拖放）收不到事件，粘贴/拖到左边一栏的图片转给标注页；切回 3D，模型、镜头、选中的部位都和之前一样。记在 localStorage：`v3.fb.mode`（3d / 2d）、`v3.fb.2d.project`。file:// 打开时 2D 只提示要开服务。
- 截图和测试：token `fb2d=<项目>`、`fb2d`（上次的项目）、`fb2d=0`（回 3D）；页面参数 `?fb2d=<项目>|1|0`；`V3.fb.d2`（on、project、frame、open()、close()、whenReady()）。

| 命令 | 作用 |
|---|---|
| `node tools/refkit/report.mjs --dir refs/<项目> [--list\|--todo\|--check\|--json]` | 读用户的回答。不加参数是完整摘要：每张图的回答、每个框（带裁图用的 `crop=W:H:X:Y`）、角色、物件/地点；`--check` 检查 questions.json，有问题退出码 1 |
| `node tools/refkit/draw.mjs <in.svg\|in.html> <out.png> [--w N --h N]` | 无头浏览器把草图渲染成 PNG（尺寸取 SVG 的 width/height），放进 `refs/<项目>/drafts/` 就能在页面上标注 |
| `tools/refkit/gen-lib.mjs` | 画草图 SVG 的小函数：`sheet()` → `rect/line/text/box/…`，`save()` 同时写出 0–1 的框坐标 |
| `node tools/refkit/serve.mjs --dir refs/<项目> [--port 5178]` | 不开工作台、只开一个项目（同一套页面和接口） |
| `node tools/refkit/selftest.mjs [--standalone] [--keep] [--shots <目录>]` | 真实浏览器走完整流程，33 项检查，最后一行 `SELFTEST: PASS`。默认测 serve.mjs，`--standalone` 测单项目服务；用临时目录，不碰 refs/ |
| `node tools/refkit/selftest.mjs --demo refs/_demo` | 只生成一个示例项目：两张画出来的测试图和第 1 轮问题 |

## tools/shoot.mjs：无头 Edge 截图

```
node tools/shoot.mjs --page studio --views "front,side+expr=smile,q34+ui=0" --out shots/x
    [--w 1280] [--h 800] [--wait 1500] [--timeout 60]
    [--gpu auto|d3d11|swiftshader|gl|swiftshader-legacy|egl]
    [--url http://127.0.0.1:5194/studio.html | --file test/tmp-x/page.html]
```

- 默认用 file:// 打开 `dist/<page>.html`，等 `window.__READY`（--timeout 秒），每个视角执行 `window.__view(v)`，再等 --wait 毫秒和 2 帧，截图存为 `<out>/<视角>.png`（`\ / : * ? " < > |` 和空白换成 `_`）。
- `--gpu auto`（默认）依次试 d3d11 → swiftshader → angle-gl → …，只有 WebGL 不可用、全部截图全黑或浏览器崩溃时才换下一个。
- 输出：浏览器、GPU 渲染器、每张图的尺寸和平均亮度（全黑标 BLACK）、控制台错误、页面异常、失败请求、`window.__errors`。最后一行 `RESULT: OK n shots`（退出码 0）或 `RESULT: FAIL 原因`（退出码 1）。
- 浏览器：环境变量 `TOOLKIT_BROWSER` 优先，否则自动找 Edge。
- 小贴士：视角加 `ui=0` 隐藏工具栏；表情、姿势会延续到后面的视角，需要时每个视角都写上 `expr=` / `pose=`。

### 截图 token 一览（`--views` 里用 `+` 连起来；同一次 shoot 里前面设的状态会带到后面）

| token | 作用 |
| --- | --- |
| 视角名 | 当前模型的视角。house2：`hero isle front house inside loft top site sun moon reef`；旧版小鲸鱼：`front side back q34 face` |
| `cam=px_py_pz_tx_ty_tz` | 相机位置 + 看向的点（米） |
| `model=<id>`、`ui=0`、`sel=<部位路径>` | 换模型、隐藏界面、选中部位 |
| `<状态>=<值>` | 当前模型的任意状态。house2：`time=golden/dawn/morning/noon/dusk/night/real`、`floor=all/ground/loft`、`weather=real/clear/cloudy/overcast/fog/drizzle/rain/storm/snow`；小鲸鱼：`expr=`、`pose=` |
| `wash` / `wash=N`、`beachSettle`、`beachDemo=N` | 马上冲上来贝壳、让漂着的贝壳立刻落定、摆 N 个演示贝壳 |
| `collect[=id]`、`found=all\|N`、`reset`、`open=collection\|settings\|album` | 收集、直接设成已找到、清空存档、打开面板 |
| `tap=first\|x_y` | 走真实的点击流程（cabin） |
| `coldetail=<种类>`、`icons=1`、`fx=<种类>[:first][:girl]` | 收集盒详情卡、图标表、飞入动画 |
| `girl=…`、`say=文字` | 小鲸鱼的动作和说话，见 `docs/接入新小鲸鱼.md` 第 6 节 |
| `wxfx=rain\|drizzle\|snow\|storm[:量][:bolt]`、`wxfx=off` | 强制雨雪雷的粒子（会一直覆盖到 `wxfx=off`） |
| `variant=<家具>:<状态>` | `bed:made/sleeping`、`pc:off/on`、`bowl:empty/full`、`basin:empty/full` |
| `shelfflash=i`、`fpDemo`、`fpAge=秒` | 贝壳柜闪一格、演示脚印、脚印变旧 |
| `nav=1`、`navpath=x0_z0_x1_z1`、`navdoor=1\|0` | 显示可走区域、算一条路、开关门 |
| `fb2d=<项目>`、`fb2d`、`fb2d=0` | 工作台切到 2D 反馈（这个项目 / 上次的项目）、切回 3D 反馈；要开着服务（`--url`） |

页面参数：`?fb=1`（游戏页打开反馈工具）、`?fb2d=<项目>|1|0`（工作台直接开在 2D 反馈 / 3D 反馈）、`?time=`、`?wx=`、`?date=YYYY-MM-DD`、`?seed=`（冲上岸可重复）、`?live=0`（游戏存档只读不写：贝壳、收集、设置改了不保存；角色选择、模型设置、导入的模型、天气缓存照常存）、`?auto=1`（自动化浏览器里也跑冲上岸计时）、`?wxlive=1`（自动化浏览器里也查实时天气）、`?wind=0..2`、`?nopost=1`、`?realsky=1`（日月画在真实高度）、`?solo=0`、`?bubbledebug=1`、`?bvh=0`（关掉射线加速，回到 three 逐个三角形检测，对比用）。

射线加速（`src/08-bvh.js`）：每个大网格（≥ 256 个三角形）建一棵三角形包围盒树，替换 three 的逐三角形检测，命中结果和顺序都和原来一样。点选、悬停、反馈大头针的遮挡检测、游戏页点贝壳都走它。自检：`V3.bvh.compare(V3.parts.pickables(), 200)`，同样的射线开关加速各打一遍，`bad` 必须是 0；`V3.bvh.stats` 是建树数量和耗时。

## tools/montage.mjs：多图拼成一张（ffmpeg）

```
node tools/montage.mjs <out.jpg> <格宽> <格高> <列数> <图片或目录> [更多图片或目录 …]
node tools/montage.mjs shots/x/sheet.jpg 480 300 3 shots/x
```

- 目录里的图按修改时间排序（等于 shoot 的视角顺序）；每格左上角标黄色序号，终端打印序号和文件的对照表。

## tools/gen-image.mjs：AI 生图（hei-image 中转）

```
node tools/gen-image.mjs --models
node tools/gen-image.mjs --out refs/new.png --prompt "…" [--prompt-file p.txt]
    [--ref refs/whale-girl-sheet.png --ref …] [--model gpt-image-2.5-sunburst]
    [--size 1536x1024] [--quality high] [--n 1] [--timeout 600] [--dry-run]
```

- 有 --ref 走 `/images/edits`（参考图 + 文字），否则走 `/images/generations`。`--n 2` 时另存 `new-2.png`。
- `--dry-run` 只显示将发送的请求，不调用接口。真正生图会产生费用。
- 密钥：环境变量 `HEI_IMAGE_API_KEY`，或 `~/.dsh/.credentials.yaml`；任何输出里都不会出现密钥。
- 退出码：0 成功，1 接口/网络错误，2 参数错误或没有密钥。

## tools/fb.mjs：反馈命令行（直接读写反馈文件，不需要开服务）

```
node tools/fb.mjs list [--status open,reopen] [--part 刘海] [--json]
node tools/fb.mjs show <id> [--json]
node tools/fb.mjs reply <id> "刘海已加长" [--status fixed] [--who ai]
node tools/fb.mjs status <id> closed
node tools/fb.mjs summary [--json]
node tools/fb.mjs export out.json [--status …] [--part …] [--no-shots]
node tools/fb.mjs import in.json
```

- 每个命令都可以加 `--dir <目录>`（默认 feedback/）。
- 状态写英文或中文都行：open 新 · doing AI处理中 · fixed AI已修 · closed 已解决 · wontfix 不修 · reopen 重开。
- reply 默认 who=ai；status 只改状态，不写对话。summary 按状态、按部位计数，未解决 = 新 + AI处理中 + 重开。
- 导出/导入格式与网页离线模式的 导出/导入 相同：`{kind:"v3-fb-bundle", version:1, exported, items:[{…条目, shotData}]}`。导入按 id 合并：updated 更新的覆盖，更旧或相同的跳过，不合规的 id 重新分配。
- 退出码：0 成功，1 出错（打印“错误：…”），2 用法错误。

## tools/check-isolation.mjs：隔离检查

```
node tools/check-isolation.mjs
```

- 扫描 .js .mjs .cjs .html .css .json（跳过 node_modules、dist、shots、feedback、test/tmp-*，不扫 .md）。
- 出现旧工作区名、旧参考图目录名、H 盘路径或任何盘符绝对路径时，逐条打印 `文件:行` 并输出 FAIL（退出码 1）；全部干净输出 PASS。
- 唯一例外：tools/shoot.mjs 里的 Edge 安装路径。

## tools/dsh-cost.mjs：DSH 会话用量与费用

```
node tools/dsh-cost.mjs <会话 id 或前缀> [--turns] [--tools] [--count shoot.mjs,build.mjs] [--json out.json]
```

- 统计一个 DSH 会话及它派生的所有子代理和队友的 token、调用次数、费用（读 ~/.dsh 下的会话日志和用量账本）。不带参数运行显示完整用法。

## tools/face-sheet.mjs：表情总览图

```
node tools/face-sheet.mjs [--scale 6] [--cols 4] [--out shots/face/sheet.png]
```

- 把 src/21-girl-face.js 里的每个表情画进一张 PNG，不需要浏览器。

## test/api.test.mjs：服务与命令行测试

```
node test/api.test.mjs
```

- 在 5299 端口启动 serve.mjs（`--fb-dir test/tmp-fb --ref-dir test/tmp-ref`），覆盖 ping、静态文件和越权路径、POST / 列表 / 读取 / PATCH / DELETE、25 MB 上限，2D 反馈的页面和 `/api/ref` 接口（项目列表、读取、保存和备份、上传、导出、删除、新建、越权路径、别的网站的写请求），再跑 fb.mjs 的全部命令和导出导入。全部通过打印 `ALL PASS (140 checks)`；任一失败退出码 1。
- 结束时删除临时目录（`KEEP_TMP=1` 时保留）。
- `test/fb-ui.test.mjs`：无头 Edge 里走一遍 3D 反馈（在线、file:// 离线）和 2D 反馈的切换（打开标注页、在里面打字不触发 3D 快捷键、新标签页打开时工作台里的先关掉、切回 3D 一切照旧、刷新后记得模式、file:// 的提示），2D 用临时项目 `test/tmp-fbui/ref`。默认在 5298 端口开测试服务器；被别的程序占着（比如代理软件的临时端口）时用 `FBUI_PORT=5311 node test/fb-ui.test.mjs`。全部通过打印 `RESULT: OK 49 checks`。
- 2D 反馈页面本身的完整流程测试是 `node tools/refkit/selftest.mjs`（见上面 2D 反馈一节）。
