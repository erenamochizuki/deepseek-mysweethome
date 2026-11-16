# tools/refkit：2D 反馈（参考图标注）

> 给回答问题的人看的页面说明在 [GUIDE.md](GUIDE.md)。本文写启动、文件格式、服务接口和 agent 的流程。

给"照着参考还原场景"用的小工具。你把截图交给我，我看完在页面上提问：这是什么场景、室内还是室外、哪些是角色、哪些是路人、哪几张里是同一个人。你在页面上点选、框选、填字回答，答案自动存成文件，我再读回来。

不联网，不装依赖（自测和画草图用已有的 puppeteer-core）。服务只监听本机 127.0.0.1。

## 启动

平时不用单独启动：本工程的 `serve.mjs` 已经带了这个页面。双击 `启动工作台.bat`，在工作台左边最上面点「2D 反馈」，再选项目。

    node serve.mjs [--port 5194] [--ref-dir refs]

- 项目 = `--ref-dir`（默认 `refs/`）下面的文件夹，里面有 `questions.json`、`answers.json` 或 `images/` 之一。`refs/face`、`refs/models` 这类不算项目，不会出现在列表里。
- 页面地址：`http://127.0.0.1:5194/2d/?p=<项目名>`。工作台里的 2D 反馈就是把这个页面放在 iframe 里。

只开一个项目、不开工作台时：

    node tools/refkit/serve.mjs --dir refs/<项目名> [--port 5178]

- `--dir` 相对项目根；目录不存在会自动创建。端口被占用时依次往后试（最多 20 个），`--port 0` 用随机端口。地址打印在 `refkit: <url>  dir=<目录>` 这一行，也写进 `<目录>/.server.json`。
- 页面和接口跟 `serve.mjs` 完全一样（同一个 `tools/refkit/server.mjs`），只是只认这一个项目，`/` 跳到 `/2d/?p=<项目名>`。

想先试一下：`node tools/refkit/selftest.mjs --demo refs/_demo` 会生成一个示例项目（两张画出来的测试图和第 1 轮问题），然后在工作台「2D 反馈」的项目里选 `_demo`。

## 你怎么用

每个按钮和操作见 [GUIDE.md](GUIDE.md)。简单说：交图 → 答「基本信息」「我的问题」→ 核对框 → 在「角色」「物件/地点」里把不同图里的同一个人、同一样东西对应起来 → 写「项目」备注 → 点「这轮答完了」，回聊天说一声。

## 文件

    refs/<项目名>/
      images/          你的参考图（原图）
      drafts/          我做的草图，比如俯视布局图、对比图；在页面上同样可以标注和回答
      drafts-src/      草图的 SVG 源文件
      questions.json   我写：问题、猜测、我框的框。页面每 3 秒检查一次更新
      answers.json     页面写：你的回答、框、角色、物件/地点、备注，改动后自动保存
      answers.bak.json 服务每次启动后第一次保存前，旧的 answers.json 备份在这里
      exports/         页面自动导出的带框标注图（如 images__001.jpg），给我核对框的位置
      trash/           删掉的图，文件名前加了删除时间（如 20261101-062000__001.png）

## 服务接口（tools/refkit/server.mjs）

| 请求 | 作用 |
|---|---|
| `GET /2d/` | 页面（`?p=<项目名>`）；`app.css core.js view.js panel.js extra.js` 也在 `/2d/` 下 |
| `GET /api/ref` | `{dir, projects:[{name, images, drafts, round, submittedRound, savedAt}]}` |
| `POST /api/ref` `{name}` | 新建项目：`<ref-dir>/<name>/{images,drafts,exports}`。名字只能用字母、数字、中文和 `- _ .` |
| `GET /api/ref/<项目>/state` | 图片列表、questions.json、answers.json、签名 |
| `GET /api/ref/<项目>/meta` | `{sig}`，页面每 3 秒查一次，变了就重新读 |
| `GET /api/ref/<项目>/img/<images或drafts>/<文件>` | 一张图 |
| `PUT /api/ref/<项目>/answers` | 页面保存回答（JSON，≤ 20 MB）。只有页面写 answers.json |
| `POST /api/ref/<项目>/upload?name=<文件名>` | 上传一张图（图片字节，≤ 80 MB），重名自动换名 → `{key}` |
| `POST /api/ref/<项目>/delete?key=images/<文件>` | 把图移到 `trash/`，标注保留 |
| `POST /api/ref/<项目>/export?key=<键>` | 页面导出的带框 JPEG → `exports/` |

- 错误统一返回 `{error}` + 4xx。路径里的 `..`、反斜杠、设备名、不存在的项目都会被拒绝。
- 写请求（PUT/POST）带着别的网站的 `Origin` 时一律 403；Host 头不是 127.0.0.1/localhost 时 403。
- `serve.mjs` 的日志里不打印这些接口的轮询、读取和自动保存，只打印上传、删除、新建和出错的请求。

## 给 agent：一轮的流程

1. `node tools/refkit/report.mjs --dir refs/<项目名> --list`：列出图片和尺寸。
2. 用 read_image 看图。大图会被缩小，细节用 ffmpeg 裁出来再看：`ffmpeg -y -i in.png -vf crop=W:H:X:Y crop.png`。
3. 写 `questions.json`（格式见下），`round` 加 1。只写 questions.json，**不要改 answers.json**，页面开着时会把它覆盖掉。写完跑一次 `node tools/refkit/report.mjs --dir refs/<项目名> --check`。
4. 需要画草图（俯视布局、对比图）时：把 SVG 写进 `refs/<项目名>/drafts-src/`，再用 `node tools/refkit/draw.mjs <in.svg> refs/<项目名>/drafts/<名字>.png` 渲染成 PNG，尺寸取 SVG 的 width/height。拿不准的位置在 questions.json 里给这张草图放虚线框，用户拖到对的地方再确认。`tools/refkit/gen-lib.mjs` 是画这类草图用的小工具。
5. 用户说答完后：`node tools/refkit/report.mjs --dir refs/<项目名>` 读答案摘要，再看 `exports/` 里的标注图核对框的位置。草图上的框被拖动过，就说明位置要改，比较新旧坐标。
6. 还有不清楚的就进入下一轮。

坐标约定：框的 x、y、w、h 都是 0–1 的比例，原点在图片左上角，x 向右，y 向下。

## 给 agent：注意事项

- 页面开着时以页面为准。不要改 `answers.json`，也不要用第二个浏览器（包括 puppeteer 脚本）打开用户正在用的项目，否则会把用户的答案覆盖掉。要测试就用 `selftest.mjs`（临时目录）或 `--demo`，截图时把项目复制到 `test/tmp-*/` 再用 `serve.mjs --ref-dir` 指过去。
- 出题前先跑一次 `report.mjs`。用户可能已经自己改了答案、画了新框，按旧状态出题会问过时的问题。
- 往后几轮的 `questions.json` 要保留以前出过的框（同 id、同坐标、同 `guess`）。框从 questions.json 里去掉后，页面上就没有它的猜测和提问了，用户确认过的那份看起来像用户自己画的。
- 标了「这张不用参考」的图不计未答，不要在上面出题，有疑问在聊天里问。
- 写框坐标前先画到图上核对：`ffmpeg -y -i in.png -vf "drawbox=x=iw*0.29:y=ih*0.39:w=iw*0.02:h=ih*0.04:color=red:t=3" check.png`，再用 read_image 看。
- 草图出新版时用新文件名（如 `plan-outdoor-v2.png`），旧版移到 `trash/`。不要覆盖旧文件名，否则旧答案里的框会套到新图上。
- 每轮读完答案，把 `report.mjs` 的输出存一份（如 `shots/<项目名>/report-r2.txt`），再备份一份 `answers.json`。
- 改了页面代码（`tools/refkit/page/`）要让用户刷新（F5），不用重新构建。改完跑一次 `selftest.mjs`。
- 参考图和成品并排对比：`node tools/montage.mjs compare.jpg 800 450 2 ref.png render.png`。

## questions.json 格式

```json
{
  "round": 1,
  "intro": "这一轮先确认场景和人物。",
  "project": [
    { "id": "style", "text": "最终想要什么风格？", "type": "choice",
      "options": ["和便利店那次一样的卡通", "更写实", "不确定"], "other": true }
  ],
  "characters": [ { "id": "c1", "name": "红伞女生", "note": "黑色长发" } ],
  "images": {
    "images/001.png": {
      "summary": "雨夜，从马路对面看一家便利店门口，左边有两个人。",
      "fields": { "where": "室外", "time": "夜晚", "weather": "雨" },
      "questions": [
        { "id": "q1", "text": "门口招牌上的字要照抄吗？", "type": "yesno" }
      ],
      "boxes": [
        { "id": "a1", "x": 0.12, "y": 0.40, "w": 0.08, "h": 0.35,
          "guess": { "kind": "character", "character": "c1" }, "ask": "这是主角吗？" }
      ]
    }
  },
  "pairs": [
    { "id": "p1", "a": "images/001.png#a1", "b": "images/003.png#u2", "ask": "这两个是同一个人吗？" }
  ],
  "things": [
    { "id": "t1", "name": "练习室的门", "note": "外面的人从这里进来",
      "boxes": ["images/001.png#u5", "drafts/plan.png#a2"] }
  ]
}
```

- 题型 `type`：`choice` 单选，`multi` 多选，`yesno` 是/否/不确定，`text` 填空，`number` 数字。`options` 是选项，`other: true` 允许自己填，`guess` 是你的猜测。页面会标出猜测，但不会替用户作答。
- `fields` 是对基本信息的猜测，可选键：`scene`（文字）、`where`（室内/室外/室内外都有）、`time`（白天/傍晚/夜晚）、`weather`（晴/阴/雨/雪/雾）。用户确认前算作未答。
- 框的 `guess.kind`：`character` 角色，`passerby` 路人，`object` 物件，`sign` 招牌/文字，`vehicle` 车辆，`other` 其他，`ignore` 忽略。你的框 id 用 `a` 开头。用户画的框 id 以 `u` 开头，下一轮可以在 `pairs` 里引用。
- `things` 是我提议的「同一个东西/地点」：`boxes` 列出我认为是它的框（`图片键#框id`，框的种类要是物件、招牌、车辆或其他）。用户对每个框回答「是」或「不是」，没回答的算未答。我的框也可以在 `guess` 里写 `"thing": "t1"`，用户点「对，确认」时一起确认。id 用 `t` 开头，不要用 `ut` 加数字，也不要和角色 id 重复。
- id 跨轮保持不变，用户已经答过的就不会丢。想重新问同一件事，换一个新 id。
- `drafts/` 里的图用 `drafts/xxx.png` 作键，用法相同。

## answers.json 结构（页面写，agent 只读）

```json
{
  "submittedRound": 1,
  "project": { "answers": { "style": { "v": "更写实", "note": "" } },
               "notes": { "keep": "", "free": "", "avoid": "", "motion": "" } },
  "images": { "images/001.png": {
      "w": 1920, "h": 1080,
      "fields": { "scene": "", "where": "室外", "time": "夜晚", "weather": "雨", "main": true, "skip": false },
      "answers": { "q1": { "v": "是", "note": "字可以改成虚构的" } },
      "boxes": [ { "id": "a1", "src": "agent", "x": 0.12, "y": 0.4, "w": 0.08, "h": 0.35,
                   "kind": "character", "character": "c1", "thing": null, "notThing": [], "note": "", "removed": false } ],
      "note": "" } },
  "characters": [ { "id": "c1", "name": "红伞女生", "note": "", "color": "#ff5a7a" } ],
  "things": [ { "id": "t1", "name": "练习室的门", "note": "", "color": "#ffc04a", "src": "agent" } ],
  "pairs": { "p1": { "v": "是", "note": "" } }
}
```

答案的 `v`：单选和是否题是选项文字（自填时 `other: true`，`v` 是自填的文字），多选是选项数组（自填的另存在 `otherText`），填空和数字是字符串。基本信息里 `fields.<键>` 有值就算确认过。

- 用户动过的框和角色才会写进 answers.json。你的框带 `src: "agent"`；用户画的框带 `src: "user"`，id 以 `u` 开头；用户新建的角色 id 以 `uc` 开头，物件/地点以 `ut` 开头。框的 `thing` 是用户认定的那一项，`notThing` 是用户回答过「不是」的项。
- 不用自己合并 questions.json 和 answers.json：`report.mjs` 合并后列出每张图、每个框的最终结果，以及裁图用的 `crop=W:H:X:Y`。


## 自测

    node tools/refkit/selftest.mjs [--standalone] [--keep] [--shots shots/refkit]

在真实浏览器（Edge 或 Chrome，经 puppeteer-core）里走一遍完整流程：上传、确认猜测、快捷键改种类、删框、画框、新建角色、各种题型、同一人配对、物件/地点的确认、否认和新建、这轮答完了、导出、刷新后答案还在、删图进 trash 且标注保留、重传同名图换新名字，以及服务拒绝越界路径、外来 Host 和别的网站发来的写请求。共 33 项检查，最后一行是 `SELFTEST: PASS` 或 `SELFTEST: FAIL`。

- 默认在随机空闲端口启动 `serve.mjs`（`--ref-dir` 指向系统临时目录），也就是工作台用的那个服务；`--standalone` 改用 `tools/refkit/serve.mjs`。不会碰 `refs/`。
- `--keep` 保留临时目录；截图默认在 `shots/refkit/`，`--shots tools/refkit/img` 会更新 [GUIDE.md](GUIDE.md) 用的截图。
- 浏览器：环境变量 `TOOLKIT_BROWSER` 优先，否则自动找 Edge，再找 Chrome。
