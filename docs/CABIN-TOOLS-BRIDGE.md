# 小屋工具桥接：让「对话里的她」用页面上的工具

写给：维护本机聊天桥接的人或 agent，也就是 `cabin-bridge.js`，加上 SurfCore 或其他「把小屋聊天接到模型」的服务端。
网页这边已经做完。用哪个模型、怎么调模型、怎么排队，都由你们自己定。本文只规定两件事：页面提供什么，桥接必须保证什么。

目前只有一个工具 `sand_tray`（门廊上的沙盘展示盒）。以后新增的工具走同一套机制，桥接不用再改。

## 1. 为什么要这样接

小鲸鱼通过工具摆沙盘时，这次调用必须来自**正在和玩家聊天的那一段对话**，结果也必须回到**同一段对话**。这样才能保证：

- 摆贝壳的就是对话里的她，她的性格、记忆、刚才答应玩家的事都一致；
- 她能看到自己摆成了什么样（文字草图，或者截图），然后在同一轮回复里告诉玩家。

页面本身不知道是谁在调用，`call()` 谁都能调。**身份由桥接保证**：只把工具交给小屋聊天那条会话的模型，也只把结果送回那条会话。

## 2. 页面提供什么

页面全局对象 `window.V3.cabinTools`，源码在 `web/src/58-cabin-tools.js`：

```js
V3.cabinTools.list()
// → [{ name, description, parameters }]
//   parameters 是 JSON Schema（type / properties / items / enum / required 这些常用子集）

V3.cabinTools.call(name, args, { via })
// → Promise<{ ok, text, result?, image?, error? }>
//   永远不会抛异常；同一时间只执行一个调用，多余的排队

V3.cabinTools.connect({ next, reply })   // 可选：把桥接的传输方式接进来，见第 4 节
V3.cabinTools.disconnect()
```

返回值里各字段：

| 字段 | 内容 |
| --- | --- |
| `text` | **给模型看的文字**：执行结果、现在摆了什么、俯视草图（字符格子）、还能用哪些贝壳。看不了图的模型只看它就够了 |
| `image` | `data:image/jpeg;base64,…`，512 × 512 的俯视截图。模型能看图时作为图片附上；看不了就丢掉。调用时传 `image: false` 就不生成 |
| `result` | 结构化数据（items / results / saved），桥接自己记日志或调试用，不一定要给模型 |
| `ok` | 这次是否全部成功。部分失败时 `ok: false`，但成功的步骤已经保存，`text` 里写清了哪一步失败、为什么 |
| `via` | 对话会话的 id（最长 128 个字符）。页面会把它写进事件，存档里记成 `by: 'girl'`；只用来记录，不用来鉴权 |

### sand_tray

完整的 schema 以 `list()` 的输出为准，这里是摘要：

```jsonc
{
  "action": "look" | "apply",          // look 只看；apply 按顺序执行 ops 并保存
  "ops": [                               // apply 时用
    { "op": "place", "kind": "扇贝" | "scallop", "prefer": "big|small|rare", "x": -10, "z": 5, "ry": 30, "flip": false },
    { "op": "place", "uid": "<某一枚>", "x": 0, "z": 0 },
    { "op": "move",  "uid": "<某一枚>", "x": 3, "ry": 90 },
    { "op": "remove", "uid": "<某一枚>" },
    { "op": "clear" }
  ],
  "image": true                          // 默认 true
}
```

- 沙盘内框 90 × 60 厘米，原点在正中。`x` 从 -45（左）到 45（右），`z` 从 -30（后，靠墙）到 30（前，朝外），`ry` 是角度。
- 贝壳按真实大小摆，最长边 3–20 厘米。
- 超出边界的会挪回沙盘里，并在结果里注明。
- 摆进沙盘的贝壳算「在展示」：不能卖，也不能再摆到别处。
- `apply` 成功后，她会走到沙盘前看一眼，场景里的贝壳一枚接一枚落下来。这只是表演，不影响返回时机：结果马上就回。
- 玩家正在编辑器里改同一个沙盘时，页面会自动按最新的状态重做一遍，桥接不用管。

## 3. 桥接必须保证的事

1. **只给小屋聊天那条会话用**。把 `list()` 的工具注册给那条会话的模型。群聊、主动唤醒、别的角色**不要**注册。
2. **结果回到同一条会话**。把 `call()` 的 `text`（以及模型支持的话附上 `image`）作为这次工具调用的结果，交回**同一个模型、同一轮对话**，让它接着生成回复。不要另开一轮，不要换会话。
3. **带上 `via`**：每次 `call()` 都传会话 id。
4. **页面没开就如实告诉模型**。工具只能在页面里执行：页面没开、或者 20 秒没回应，就把下面这个结果交回去，让她在对话里自然地说「等你打开小屋再摆」：
   ```json
   { "ok": false, "error": "page_offline", "text": "小屋页面现在没开着，沙盘摆不了。" }
   ```
5. **限次数**：一轮对话最多 6 次工具调用，超过就不再执行，并告诉模型「这一轮先摆到这里」。
6. **只接受本机来源**：工具调用只能来自本机桥接，比如沿用小屋服务现有的 host / origin 校验和 3100 令牌。不要开放给局域网或网页里的其他脚本。
7. **记录**：页面会发 `game:cabin-event`，`type` 为 `tray_arrange`，detail 是 `{ by: 'girl', via, placed, total }`，走现有的 `/api/cabin/event` 上报。桥接照常转发就行，日记的取材里能看到「她在门廊的沙盘里摆了 N 枚贝壳」。

## 4. 推荐的接法（参考，不强制）

### 模型支持原生工具调用时

```
模型 ──tool_use(sand_tray, args)──▶ 服务端（挂起这一轮）
服务端 ──待执行的调用──▶ 页面（长轮询）
页面 V3.cabinTools.call() ──结果──▶ 服务端
服务端 ──tool_result(text + image)──▶ 同一个模型，继续生成
```

服务端新增两个本机路由，经现有的 5194 → 3100 代理：

- `GET /api/cabin/tool/next?client=<页面 id>`：长轮询，最多挂 25 秒。有调用就返回 `{ callId, name, args, via }`，没有就返回 `null`；
- `POST /api/cabin/tool/result`：请求体 `{ callId, result }`，`result` 就是 `call()` 的返回值。

`cabin-bridge.js` 里接上：

```js
V3.cabinTools.connect({
  next: () => fetch('/api/cabin/tool/next?client=' + clientId, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null)),
  reply: (callId, result) => fetch('/api/cabin/tool/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callId, result }),
  }),
});
```

`connect` 会一直循环：`next()` → `call()` → `reply()`。`next()` 返回 `null` 时歇 1 秒再问，出错时歇 3 秒。

把结果交给模型时：

- 文字放进工具结果的文本里；
- 图片用你们模型 SDK 的图片块，把 `image` 去掉 `data:image/jpeg;base64,` 前缀后，作为 base64 数据传；
- 模型不能看图就只传文字。

### 模型不支持原生工具调用时

可以沿用现在的 `<cabin-action>` 控制行，扩展一种：回复最后一行写 `<cabin-tool name="sand_tray">{json 参数}</cabin-tool>`。

1. 桥接解析出这一行，从回复里去掉，不给玩家看；
2. 调用页面执行工具；
3. 把 `text` 作为下一条系统消息喂回**同一段对话**，再请模型续写一次。

`cabin-chat-contract.js` 的 `splitCabinChatReply` 是现成的写法，可以参照着加。

### 提示词里要告诉模型的事

- 门廊上有个沙盘展示盒，可以把收集到的贝壳摆成图案给玩家看；
- 先 `look` 再 `apply`，摆完看一眼结果，不满意可以 `move` 微调；
- 别一次把所有贝壳都摆上去，给玩家留一点惊喜。

## 5. 验收清单

- [ ] 小屋聊天里说「帮我在沙盘里摆个笑脸」：模型先调 `sand_tray` look，再 apply；页面上她走到门廊沙盘前，贝壳一枚枚落下；她的回复里提到自己摆成了什么样。
- [ ] 模型能看图时，工具结果里带着那张俯视图；不能看图时，只用文字草图也能描述出摆好的样子。
- [ ] 关掉小屋页面后再让她摆：20 秒内得到 `page_offline`，她在对话里说要等页面打开。
- [ ] 群聊、别的会话里的她**看不到**这个工具。
- [ ] 玩家打开沙盘编辑器挪了一枚，再让她摆：结果里是最新的样子，玩家挪的那枚没被冲掉，除非她自己 move 了它。
- [ ] 日记取材里出现「她在门廊的沙盘里摆了 N 枚贝壳」。
- [ ] 一轮里第 7 次调用被拒绝。

## 6. 页面这边可以用来核对的东西

| 方法 | 用法 |
| --- | --- |
| 浏览器控制台 | `await V3.cabinTools.call('sand_tray', { action: 'look' }, { via: 'test' })`，直接看返回值 |
| 截图 token | `?view=found=all+traytool=heart`（只对浏览器本地存档有效）：用能用的贝壳摆一个爱心，并把回给模型的图和文字铺在屏幕上 |
| Node 测试 | `web/test/cabin-tools.test.mjs`：look / apply / 部分失败 / clear / `connect` 的往返 |
