# 小屋行为导演与本地行为交接设计（P2 + P3）

日期：2026-11-12　　状态：A1-1 / A1-2 已实现并通过隔离回归；尚未部署或重启。
相关：`_work/cabin-integration-contract.md`、`haibian/README.md`、`docs/PHOTOS.md`

> 本文第 3–5 节记录的是实现前方案，接口与文件规划并未逐字采用。实际可调用接口、回执语义和验证命令以第 9 节为准。

## 0. 一句话

P2 让页面里的小鲸鱼会「走到电脑前回消息 / 去书桌写日记画画 / 中午去餐桌吃饭（带已有动画）」；
P3 把这些**本地零 token 的行为**存下来，下一次唤醒时用一行【家里·刚才】交给 QQ 里的她。
聊天仍然只有小屋聊天/QQ 对话烧 token。

## 1. 现状（实现背景）

```
页面 (home/cabin.html)
  cabin-bridge.js   状态 chip / 聊天 / 事件上报 / 自主活动执行（9s 轮询 /activity）
  cabin-gallery.js  画册同步 / 挂画 / 日记本
  V3.actor          goto/collect/wander/sit/say/respond/stand；state: idle|walk|wander|collect|furniture|respond|shelter
桥接 cabin-house.js  state/cabin-house.json（events/计数/weather/activity）
  提示词【家里】段、qq_social_state.cabin 快照、记忆/日记素材
DSH 插件 cabin-chat  网页聊天（1 次 LLM/句）
```

现在的活动只有：`wander / collect / goto / sit_porch / stargaze / sleep / sit_rocking / watch_tv / cook_rice / respond / idle`，
全部是「走过去 + 气泡」，没有用模型自带动画；吃饭只有电饭煲状态，她本人没有动作。

## 2. 既有可用能力（已核实）

### 2.1 动画（内置角色「蓝色大肥鱼」实测存在）

`V3.actor.inst.setState('anim', '<组>:<名称>')` 会接管主动画；置空 `setState('anim','')` 恢复状态机。

| 用途 | 动画 | 说明 |
| --- | --- | --- |
| 坐下 | `main:sit`；椅子专用 `tlm:chair` | 手搓坐姿（legL/legR 弯曲）仍保留，动画用于更自然的坐姿/晃动 |
| 用电脑/打字 | `tlm:computer`、`tlm:keyboard` | 回复私聊、写日记用 |
| 看书/画画近似 | `tlm:bookshelf`（读），画画没有专属动画，用坐姿 + 抬手臂/`tlm:keyboard` 近似 |
| 吃饭 | `arm:use_mainhand:eat`（`arm:use_offhand:eat` 同理） | 手臂吃东西动作；`main:sit` 配合坐姿 |
| 睡觉 | `main:sleep` | 夜里可选 |
| 拿东西 | `arm:use_mainhand` / 挥手 `swing_hand` | 电饭煲「取餐」可先播一下抬手 |

降级规则：导入的 YSM 模型不一定有 `tlm`/`arm` 组 → 只走到位 + `main:sit`（或手搓坐姿）+ 气泡，绝不报错。

### 2.2 家具坐标（`40-layout.js` 默认房；布置过的房要扫房子模型）

| 家具 | 默认位置/朝向 | 用途 |
| --- | --- | --- |
| 餐桌 `dining_table` | (0,-12)..(1,-11)，朝南 | 吃饭 |
| 餐椅 `dining_chair` ×2 | chairDW (-0.6,-11.8)..(-0.1,-11.2) 朝东；chairDE (1.1..1.6) 朝西 | 吃饭坐 |
| 书桌 `desk` | (-6.0,-10.85)..(-5.3,-9.15) 朝东 | 电脑/写日记/画画 |
| 书桌椅 `desk_chair` | (-5.0,-10.775)..(-4.45,-10.225) 朝西 | 坐 |
| 厨房台面 `kitchen_counter`（含电饭煲） | (-2,-15)..(2,-14.4) | 取餐 |
| 摇椅 `rocking_chair` | (-4.9,-8)..(-4.1,-7) | 已有 |

实现时用 `V3.houseBlocks.model` 扫这些方块 id + `facing`（`V3.furnMc.FACING_Y`），再按 `69-furniture-play.js` 的
`anchor()` 写法（`pivot.localToWorld(...)` + `yaw = Math.PI - FACING_Y*π/180`）算坐姿锚点；扫不到才退回默认坐标。

### 2.3 角色坐姿 API

`V3.actor.sit({ position:[x,y,z], yaw, seconds, text, anchor, onEnd })` 已支持家具锚点（摇椅就是这么做的）；
`stand()` 起身，`state === 'furniture'` 表示坐着。`cabin-bridge` 已有「她忙时不插队」保护。

## 3. P2：页面行为导演

### 3.1 新文件

`haibian/web/cabin-behavior.js`（+ 少量 CSS），由 `server.mjs` 和 `cabin-bridge.js` 一起注入 home/cabin。
职责：**唯一**决定她的「脚本化动作」，避免和 `cabin-bridge` 的自主活动抢控制权。

与现有 `cabin-bridge` 的分工：

- `cabin-behavior.js` 负责「场景行为」（去电脑/书桌/吃饭/日记/画画），有队列与优先级；
- `cabin-bridge.js` 的自主活动只在**行为导演空闲**时执行（现有 `actorBusy()` + 新增 `behaviorBusy` 判断）；
- 用户点她/点家具的交互优先级最高，行为导演检测到 `actor.state` 被占用就暂停/让出。

### 3.2 场景定义（每个都是本地状态机，0 token）

| 场景 | 触发 | 动作序列 | 动画 | 结束 |
| --- | --- | --- | --- | --- |
| `reply_private` | 桥接 `/scene` 报 `privateUnread > 0` 或 `replying:true` | 从当前位置快速跑到书桌椅前 → 坐下 → 打字 | `main:sit` + `tlm:keyboard`（无则 `tlm:computer`） | 未读清零/`replying=false` 后 5~10s 或超时 120s 起身，气泡「等我看看消息」 |
| `write_diary` | 桥接在 23:30 日记回合开始/结束时给 `scene: write_diary` | 走到书桌椅坐下 → 打字 | `main:sit` + `tlm:keyboard` | 桥接 `scene: idle` 或 15 分钟后起身 |
| `draw` | 桥接检测到画册新增（`/api/cabin/art` 里出现新画）或 `scene: draw` | 走到书桌椅坐下 → 画 | `main:sit` + 抬手臂/`tlm:keyboard` 近似 | 画完/8 分钟后起身，气泡「画好啦」 |
| `eat` | 本地时间 11:30~13:00 且桥接 `meal` 未完成（或桥接主动给 `scene: eat`） | 走到厨房台面 → 「取餐」抬手 → 走到餐椅坐下 → 吃 → 起身 | 取餐 `arm:use_mainhand`；坐 `main:sit`；吃 `arm:use_mainhand:eat` 循环 20~30s | 吃完把 `mealDone` 报给桥接，今天不再自动吃 |
| `collect` / `wander` / `sit_porch`… | 保留现有 `/activity` 意图 | 不变 | 不变 | 不变 |

补充：
- 吃饭要「先坐到餐椅上再吃」：位置用 chairDE（或 chairDW）锚点，坐好后再播 eat，不站着吃；
- 「取餐」可只做动作 + 气泡（「饭好啦，我去盛一碗」），不强行点电饭煲 UI；如果桥接知道 `rice.phase==='ready'` 就同步一下；
- 画画没有专属动画：明确用「坐着 + 手臂动作」近似，不假称模型有画画动画；
- 所有可交互对象用现有高亮提示体系（不新增点击面）。

### 3.3 触发接口（桥接新增，页面只读）

```
GET /api/cabin/scene
{
  ok, at,
  privateUnread: 2,        // 私聊未读（>0 → reply_private）
  replying: true,          // QQ 回合进行中（可选：她正在打回复）
  diary: { active: true, startedAt, day },
  draw: { active: false, lastAt },
  meal: { due: true, done: false, window: '11:30-13:00' },
  fallback: 'idle'
}
```

页面每 5s 轮询；`scene` 与活动互斥：有场景时页面暂停向桥接要 `/activity` 的结果执行（桥接也可直接返回 null）。
数据源：桥接侧 `socialV2` 未读、`diaryState`、画册 mtime、`cabin-house` 的事件与时钟，全部本地计算，0 token。

### 3.4 状态机与记录

- 单实例串行队列：`running` + `pending`（最多 2 条），同一场景不重复入队；
- 每个场景产出 `POST /api/cabin/local-action`（见 P3）；
- 布置模式/反馈模式/页面切到后台：暂停并清理（沿用 cabin-bridge 的 `ui-off`/`cb-hidden` 规则）；
- 站点关闭或切页：不残留定时器。

## 4. P3：本地行为交接

### 4.1 事件 schema

页面 → 桥接：

```
POST /api/cabin/local-action
{ "kind": "go_computer|write_diary|draw|eat|collect|sit|stand|other",
  "text": "去电脑前回消息 / 去书桌画画 / 中午吃了饭",
  "at": 1794245000000,
  "detail": { "scene": "reply_private", "durationMs": 62000 } }
```

白名单 `kind`；`text` 由页面写好人话，桥接不再翻译。失败静默（行为不能因为上报失败中断）。

### 4.2 桥接存储与交付

`cabin-house.js` 新增：

- `state.localActions`：环形最多 50 条，字段 `{ at, kind, text, deliveredAt }`；
- 同类 5 分钟内只留一条（清洗重复）；`chat` 不在此列（聊天已有自己的记录路径）；
- `POST /api/cabin/local-action` 校验白名单 → 入队 → 返回 `{ok:true}`；
- `promptSection()` 增补一行（≤120 字）：

```
【家里·刚才】你去电脑前回了消息、去书桌画了张画、中午在餐桌吃了饭。
```

只取最近 5 条未交付的；**构建提示词时标记 deliveredAt**（避免每轮重复），没有就不加这一行；
同时把 `localActions` 的最近 3 条塞进 `qq_social_state.cabin.recentLocal`，她主动查也能看到。

### 4.3 与记忆/日记

- `eat`、`draw`、`write_diary` 这类「一天一次」的可以顺手进记忆 inbox（沿用 3 分钟节流）——但要控制噪声；
- 日记素材不写（日记本身有 QQ 对话素材，本地行为只进提示词/记忆）；
- token 预算不受影响：这些全是本地写文件与提示词拼装。

### 4.4 测试

- `test-cabin-house.mjs`：local-action 白名单/环形上限/同类去重/提示词交付一次不重复/空 actions 不注入；
- 浏览器 E2E（playwright，mock `/scene`）：`reply_private` 走到书桌并 `state=furniture`、动画 state 断言、
  `eat` 坐上餐椅再播 eat、结束后 `local-action` 请求体正确、无 pageerror；
- 回归：现有 26 项 cabin-house 单测、`test:regressions`、`test:audit`；启动链（P1）单独冒烟。

## 5. 变更文件清单（预计）

| 文件 | 改动 |
| --- | --- |
| `haibian/web/cabin-behavior.js`（新） | 行为导演 + 场景状态机 + 动画 + 上报 |
| `haibian/web/cabin-behavior.css`（新，可选） | 行为调试/状态提示（可复用 hud） |
| `haibian/server.mjs` | 注入新文件 |
| `haibian/web/cabin-bridge.js` | 与行为导演互斥（空闲才执行自主活动） |
| `surfcore/src/cabin-house.js` | localActions、scene 快照、提示词新行、状态字段 |
| `surfcore/src/bridge.js` | `/api/cabin/scene`、`/api/cabin/local-action` 路由与接线 |
| `surfcore/scripts/test-cabin-house.mjs` | P3 单测 |
| `haibian/test/`（新） | 行为 E2E 脚本 |
| 源码包 `source/integration/` | 同步新增文件 |

## 6. 风险与降级

| 风险 | 处理 |
| --- | --- |
| 导入模型没有 `tlm`/`arm` 动画 | 只走位 + 坐姿 + 气泡；`inst.setState` 包 try/catch，失败静默 |
| 布置过的房子挪了家具 | 每次触发前重扫 `houseBlocks.model`；扫不到才用默认坐标 |
| 和自主活动/用户点击抢控制 | 行为导演优先，自主活动让位；用户交互打断场景并清理 |
| 提示词变长 | 交付行 ≤120 字、只 5 条、构建时标记已交付；不影响主提示词预算 |
| 场景卡住 | 每个场景有硬超时（reply 120s / diary 15min / draw 8min / eat 60s），超时 `stand()` 并记一条失败日志 |
| 布置模式/反馈模式 | 与 cabin-bridge 相同的 `ui-off` / 隐藏规则，暂停场景 |

## 7. 分批与工时（估）

1. **P2-a**：行为导演骨架 + `reply_private` + 书桌锚点 + 动画与降级（约 3~4 小时，含浏览器验证）
2. **P2-b**：`write_diary` + `draw`（约 2 小时）
3. **P2-c**：`eat`（取餐→餐椅→吃，含餐椅锚点与动画）（约 2~3 小时）
4. **P3**：local-action 存储/交付/提示词/单测（约 2 小时）
5. **收尾**：源码同步、文档、manifest、回归（约 1 小时）

## 8. 验收标准（A1-1 / A1-2）

- [x] 角色状态机覆盖回复私聊、日记、画画、阅读和完整就餐序列；捡贝壳动作一次播放并保持后复位；资源缺失时安全降级。
- [x] 自主行为只在浏览器本地执行；日志保存在浏览器和本机桥接持久队列。只在小屋聊天或真实主人 QQ 私聊唤醒时注入 AI；失败、旧接口及请求后新追加记录均不误清。
- [x] 小屋专属 System Prompt 与 QQ 私聊的唤醒上下文共享同一批日志；动作控制行不显示在小屋聊天或历史中，只接受枚举值。
- [x] 私聊回复、已认领的日记回合、成功画册保存才产生短期场景提示；网页聊天、群聊、主动消息、历史回放和下发/失败意图不冒充真实行为。
- [x] 书架复用相册弹窗和翻页，按只读日记数据展示；桌面与 Edge 100 窄屏实际点击回归通过。
- [x] 隔离单测与 audit / regressions 全绿，无页面异常；本轮未触碰渲染器或基础移动物理。
- [ ] 部署到在用页面、重启服务：未执行，需用户确认后另开发布步骤。

## 9. 实际实现与接口（2026-11-12）

- 角色编排位于 `source/web/src/65-girl-actor.js`；动画叠加/循环模式由既有 YSM 适配层 `source/web/src/29-ysm.js` 管理。对外 API：`V3.actor.startBehavior(kind,{seconds?,text?})`、`behaviorAvailability(kind)`、`cancelBehavior(reason?)`、只读 `behavior`；监听 `V3.on('actor:behavior', handler)`。吃饭固定 24 秒、结束才记完成；伏案/阅读在实际 action 阶段记录。拾贝壳不覆盖模型循环片段，而使用经确认的一次性手部片段并保持末帧。
- 本地计划与最多 24 条未确认记录在 `source/web/src/89-cabin-routine.js`：上海时间 11:30–13:00 午餐、空闲阅读、真实收集事件；不向 `/activity` 轮询、不调用模型。`cabin-bridge.js` 通过同机 `POST /api/cabin/behavior` 写入 `{events:[{id,at,action}]}`，失败按原 UUID 重试，只清 `ackIds` 对应的浏览器记录。
- [本机行为队列](../../../../surfcore/src/cabin-behavior-queue.js) 上限 96 条，原子持久化并保留有界收件回执。一次至多取 24 条；小屋专属聊天拿到摘要注入回执后，或真实主人 QQ 私聊唤醒被 DSH 接受后，才消费对应快照。群聊、主动唤醒、预览和离线待投递不消费。
- 书架仍由 `91-cabin.js` 原点击/遮挡命中，日记数据从 `/api/cabin/art` 读取；`68-album.js` 新增只读页数据源，与相册共用 HUD 弹窗和上一页/下一页/页码选择。侧栏日记本和「今日小屋」不改。
- SurfCore 服务端契约位于 `plugins/surfcore/lib/cabin-chat-contract.js`（`src/cabin-chat-contract.js` 为兼容 re-export），A1-2 源码在 `plugins/surfcore/lib/cabin-chat.js`、`src/cabin-house.js`、`src/cabin-activity-events.js`、`src/bridge.js`。`cabinActivityEvents` 只保存在内存、约 120 秒过期，state 为空时不加字段。旧方案 `/scene` 与 `/local-action` 没有实现，勿按第 3–5 节接线。
- 验证命令：工作区根目录 `node --test haibian/test/cabin-routine.test.mjs haibian/test/cabin-behavior-proxy.test.mjs`，隔离构建后 `CABIN_EXPECT_ACTOR=1 node haibian/test/cabin-a1-browser.mjs`；网页源码目录 `npm test`；SurfCore 目录运行 `node --test scripts/test-cabin-behavior-queue.mjs`、`npm run test:regressions`、`npm run test:audit`。发布需更新运行版网页和小屋代理并重启小屋 HTTP 服务、SurfCore 与 DSH 插件宿主；本轮均未执行。

## 10. 现在实装了哪些行为（2026-11-12 晚上更新）

| 行为 | 谁触发 | 她做什么 | 费不费模型调用 |
| --- | --- | --- | --- |
| 收拾沙滩（2026-11-14 改） | 她自己（沙滩上最早冲上来的那件等够 30–90 秒）；聊天让她捡 | 一件接一件把沙滩上的都捡完：每件走过去 → 蹲下捡 → 站起来双手举起欢呼、蹦两下 → 下一件；沙滩空了回待机 | 不费 |
| 你先捡走 | 你点了贝壳 | 她会说是你捡到的；捡走的正好是她要去拿的那枚，她放弃目标 | 不费 |
| 摆贝壳 / 收贝壳 | 她自己（空闲、走得到时） | 挑一只摆到空窗台；地板摆件 10 分钟后可回收 | 不费 |
| 吃饭 | ① 上海时间 11:30–13:00 自动一次（锅空会先煮）② 你点电饭煲的「盛到碗里 / 吃饭」③ 聊天时 AI 带动作标记 | **跑**到灶台拿碗 → 餐椅坐下 → 吃 24 秒 → 起身 | ①② 不费；③ 是那次聊天本身 |
| 空闲消遣（2026-11-14 起） | 她自己（闲着时，每样做完隔 2.5–4.5 分钟挑下一样） | 看电视（坐沙发，没沙发坐地板；电视关着她自己开、看完关）、看书（书架前站着翻）、翻相册（阁楼矮桌旁坐地板）、坐门口台阶沿上看海（下雨下雪不去；坐着时随机演模型自带的动作，比如拿出铁盆吃饭那段）；坐着时隔一阵说一句。给吃饭、回消息、日记、画画、睡觉、收拾沙滩让路 | 不费 |
| 看星星（2026-11-14 起） | 只在夜里（天黑、没下雨）：她自己（空闲消遣，夜里权重最高）；你点阁楼望远镜 | 跑到望远镜背面，MC 蹲下凑到目镜上，边看边说；你点「看够了」/ 天亮 / 下雨起身 | 不费 |
| 一起看（2026-11-14 起） | 你开电视 / 点开着的电视、点阁楼相册、点书架上的日记本 | 她闲着（或在做别的消遣）就**跑**过来，坐下陪你看；你关了电视 / 面板她就起身。正忙正事时只说一句 | 不费 |
| 回私聊 | 她在 QQ 里真的回了你的私聊（小屋网页开着时） | 跑到书桌前坐在椅垫上敲键盘约 12 秒（2026-11-14 修：以前落在椅背上，像趴在椅子后面） | 不费（只是跟着已经发生的回复表演） |
| 写日记 | 她真的在写当天日记时 | 走到书桌前伏案约 15 秒 | 不费 |
| 画画 | 她真的画了一张新画并存进画册时；或聊天时 AI 带动作标记 | 走到书桌前伏案约 15 秒（模型没有专门的画画动作，用伏案近似） | 不费 |
| 坐摇椅 | 你点摇椅 | 跑过去坐 20 秒 | 不费 |
| 躲雨 / 躲雷 | 天气 | 下雨撑伞，雷雨回屋 | 不费 |
| 被戳 | 你点她 | 回应一句 | 不费 |
| 上床睡觉 | 上海时间 23:30 以后写完日记（没等到日记最晚 23:45；夜里才打开页面就马上） | 走到床边躺下，盖着被子闭眼睡到 08:00 自己起床 | 不费 |
| 夜里起来回消息 | 睡着时她真的回了你的 QQ 私聊 | 起床跑到电脑前坐下；从她最后一次回复算 5 分钟没有新回复，回床上接着睡 | 不费 |

不是她的行为、但也能点的小东西（2026-11-12 15:50 起）：贝壳风铃（点一下响一串）、小螃蟹（点一下跑回礁石洞里，躲 8–15 秒再出来）。吃饭时饭碗会跟着她：灶台 → 手里 → 餐桌上她面前 → 吃完消失。

还没有的：喝水、做饭的动作（煮饭只是锅在计时）、和你一起吃、端碗的专门姿势。书架前她站着看书，不会坐下读；看电视、翻相册、看海都没有专门的动作（坐着，模型的 sit 动画）。

睡觉的细节（实现在 `source/web/src/88-cabin-night.js`，设置 → 房子 →「夜里上床睡觉」，默认开）：夜里不捡贝壳（该上床起就不捡，正去捡的那颗放下，聊天里的捡贝壳标记夜里丢掉）；夜里戳她、点家具会把她叫起来站在床边迷糊地回应，然后回床上；网页聊天让她做的动作（捡贝壳除外）照做，做完回床上；雷雨夜不为回消息起床；没有床 / 走不到床时这一晚照白天过，每 60 秒再看一次。她睡着时床上叠好的睡衣和睡帽会藏起来，起床后放回去。

镜头「跟随」（2026-11-12 晚上，不是她的行为）：楼层按钮最右边多了「跟随」，镜头跟着她走，按她在屋外 / 一楼 / 阁楼自动切剖面；拖动、缩放照常，再点一次或点别的楼层退出。

前提：页面开着才会演；关着的时候不补演。布置模式、反馈模式、页面在后台时所有行为暂停。行为之间互斥，一次只做一件。

## 零食（2026-11-17，网页侧已完成）

网页新增了零食店和零食栏（`web/src/69-snack-shop.js`、`69-snack-bar.js`），数据在收藏存档 v2 里（见 `docs/INVENTORY-V2.md`）。桥接这边的变化：

- **对话里叫她吃零食（可选）**：页面的 `cabinAction` 现在多认一个 `snack`（她走到冰箱上的零食篮，拿一份吃）。要让模型能用，SurfCore 的 `CABIN_CHAT_ACTIONS` 加上 `'snack'`，`ACTION_LABELS` 加 `snack: '吃零食'`，提示词里说明「零食篮里有东西时可以用」。不加也没关系，页面照样能用。
- **行为日志不记零食**：`validateCabinBehaviorLog` 遇到不认识的动作会拒收整批，所以页面不把零食写进 `/api/cabin/behavior`。等桥接的白名单加上 `snack` 以后，如果想让日记看到她吃零食，再在 `89-cabin-routine.js` 的 `LOG_KIND` 里接上。
- **事件上报**（`POST /api/cabin/event`，和现有事件同一个通道，桥接照常转发即可）：
  - `snack_eat`：`{ sku, by: 'player' | 'girl', left, emptied }`，text 如「你喂她吃了一颗蓝莓」「她自己喝了一口热可可」；
  - `snack_buy`：`{ sku, qty, cost }`；`shell_sell`：`{ count, earned }`；
  - `trash_dispose` 的 detail 多了 `earned`（这次清理得到的贝币）。
