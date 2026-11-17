# 小屋收藏存档 v2：本机服务要做的升级

写给：维护本机小屋服务（`haibian/server.mjs` + `cabin-inventory.mjs`）的人或 agent。
网页这边已经做完；离线成品不需要服务也能完整使用。只有接了本机服务（页面注入了 `/cabin-bridge.js`）的用户，需要按本文把服务端升级到 v2。

## 1. 为什么要升级

v2 给收藏加了这些东西：

- **每一枚贝壳独立**：有尺寸（mm）和花纹，还有大金冠 / 小金冠；
- **贝币**：清理垃圾、卖贝壳可以得到贝币，买零食要花贝币；
- **零食**：按盒、袋、杯计数；
- **沙盘展示盒**：可以自由摆放贝壳。

旧版（v1）服务端只存「每种几枚」，并且会拒绝不认识的字段。新页面遇到旧服务端时会这样降级，不会坏，但新功能用不了：

| 情况 | 页面的处理 |
| --- | --- |
| 读回 v1 存档 | 页面把它当成 v2 显示。旧贝壳按「种类 + 序号」固定生成尺寸，都是原色，不会出王冠 |
| 捡贝壳 | collect 照 v1 的格式发。新捡到的贝壳尺寸和花纹会丢，显示时由 uid 推出来 |
| 卖、买、吃零食、沙盘 | 直接提示「小屋服务还是旧版存档」，请求根本不会发出去 |

## 2. 最省事的做法：直接用页面的规则模块

`web/build.mjs` 构建 `cabin` / `home` 页时，会顺带产出 **`web/dist/inventory-rules.mjs`**。它包含两样东西：

- 和页面一字不差的规则：源码是 `web/src/58-inventory-rules.js`；
- 当前的目录：贝壳、潮汐拾物、垃圾、零食，带稀有度、标准尺寸和价格。

**规则只有这一份**：服务端只负责 rev、幂等账本和落盘。每次网页更新后，把新的 `inventory-rules.mjs` 和页面一起复制过去。

把它复制到 `cabin-inventory.mjs` 旁边，然后做下面 6 处改动。这 6 处已经在 v1 版 `cabin-inventory.mjs` 的副本上实测过：v1 存档文件能升级，collect、重放、dispose、sell 都正常，带旧字段的 collect 也能用。

```js
// 1) 引入
import Rules, { catalog } from './inventory-rules.mjs';

// 2) load()：读盘用规则解析（v1 文件读进来自动升级成 v2，下次落盘就是 v2）
if (e.code === 'ENOENT') return Rules.freshState();
...
return Rules.parseState(JSON.parse(decoder.decode(bytes)), { catalog });

// 3) post()：解析命令
const cmd = Rules.parseCommand(value, { catalog });

// 4) post()：执行（替换原来的 disposed 计算和 apply 调用）
const result = Rules.apply(s, cmd, { catalog, clock });
if (result === false) return { ...snapshot(s), applied: false };

// 5) post()：把结果并进响应
return { ...snapshot(s), applied: true, ...result };

// 6) 错误处理：规则抛的是 Rules.InventoryError（也带 status / code）
const { status, code } = e instanceof InventoryError || e instanceof Rules.InventoryError ? e : { status: 503, code: 'inventory_unavailable' };
```

原来这几样照旧保留，它们本来就不属于规则：

- **幂等账本**：`seen` 是 id 到命令哈希的映射；collect 的哈希把 `at` 当 0 算；
- **rev 的递增**和 `MAX_LEDGER` 上限；
- **原子落盘**：tmp + fsync + rename；
- **请求来源校验**：`guard()` 检查 host / origin / CSRF 头；
- **请求体大小限制**。

原文件里的 `parseFound / parseInventory / parseCommand / apply / parseState / fresh / empty / mergeFound` 不再用到，可以删掉。

升级前**先备份** `state/cabin-inventory.json`。v1 文件第一次被写回时就变成 v2，旧版服务端读不了 v2 文件。

## 3. 数据格式（v2）

存档文件：`{ v: 2, initialized, rev, inventory, seen }`

```js
inventory = {
  found: { [kind]: { n, first, last, items: [{ uid, size, pat, at }] } },
  placements: { [slot]: { id, kind, uid, placedAt, by, returnAt? } },
  trash, cleaned,
  coins,
  snacks: [{ uid, sku, left, at }],
  tray: { rev, items: [{ uid, x, z, ry, flip? }] },
}
```

| 字段 | 含义 |
| --- | --- |
| `n` | 等于 `items.length`。可以是 **0**：这一种全卖了，但图鉴仍算「见过」 |
| `size` | 最长边，毫米，一位小数 |
| `pat` | 花纹 id：`plain sunset mist ring dots albino iris`。不认识的花纹按 `plain` 处理 |
| `uid` | 一枚贝壳的 id，等于捡起它那次 collect 的 op id（也就是沙滩物件的 id）。v1 迁移来的是 `legacy:<kind>:<序号>` |
| `placements[].uid` | 摆出去的是哪一枚 |
| `snacks[].left` | 盒、袋还剩几份；杯、瓶还剩几口（满 3 → 中 2 → 低 1 → 空 0） |
| `tray` | 沙盘，单位厘米，原点在沙盘中心。内框 60 × 40，最多 80 枚。`ry` 是弧度 |

王冠**不存**，由尺寸实时算：`Rules.crown(kind, size)`。尺寸落在本种区间两端 5% 以内就有王冠，区间默认是标准尺寸 × [0.7, 1.3]。

导出 / 导入格式是 `{ format: 'cabin-inventory-v2', inventory }`。`restore` 也接受 `cabin-inventory-v1`，会自动升级。

## 4. 操作（POST /api/cabin/inventory）

所有操作都带 `op` 和 `id`。`id` 最长 128 个字符，同一个 `id` 重放时不重复执行，返回 `applied: false`。
「结果」一列的字段会合并进响应：`{ ok, initialized, rev, inventory, applied, ...结果 }`。

| op | 字段 | 结果 | 说明 |
| --- | --- | --- | --- |
| `collect` | `kind, at, category`，可选 `size, pat` | 贝壳：`{ item, kind, crown }`；垃圾：`{ kind }` | 贝壳新增一枚，uid = op id。没给 size / pat 时按 op id 固定推出来；size 会夹进本种区间。垃圾只让 `trash` +1 |
| `place` | `kind, slot, by`，可选 `uid, returnAt` | `{ uid }` | 给了 uid 就摆这一枚，否则摆第一枚空闲的 |
| `return` | `slot, by`，可选 `expectedId` | `{ uid }` | 同 v1 |
| `dispose` | — | `{ disposed, earned }` | `cleaned += trash`，`coins += trash × 1`，然后 `trash = 0` |
| `sell` | `uids[]`（1–200 个） | `{ sold, earned }` | 常见 1、少见 3、稀有 5 贝币。在摆件或沙盘里的贝壳不能卖 |
| `buy` | `sku, qty`（1–20） | `{ cost, bought: [uid] }` | 每件 uid 为 `<op id>:<序号>`，`left` = 目录里的份数 |
| `consume` | `uid, by` | `{ sku, left, emptied }` | `left - 1`。到 0 就移除；杯装的空杯会让 `trash` +1（`emptied: true`） |
| `tray_set` | `base, items[], by`，可选 `via` | `{ trayRev }` | 整盘替换。`base` 必须等于当前 `tray.rev`，否则报 409 `tray_changed`。`via` = 对话会话 id（小鲸鱼通过对话工具摆放时带上），只用来记录 |
| `legacy` | `found`（v1 格式） | `{}` | 同 v1：每个存档只导入一次浏览器旧档 |
| `restore` | `rev, inventory`（v1 或 v2） | `{}` | 同 v1：只能恢复到空存档 |
| `reset` | `rev` | `{}` | 同 v1 |

v2 新增的错误码都是 409：

| 错误码 | 什么时候出现 |
| --- | --- |
| `in_use` | 这一枚正在摆件位或沙盘里 |
| `not_owned` | uid 不在收藏里 |
| `not_enough_coins` | 贝币不够 |
| `unknown_item` | 目录里没有这个 sku |
| `snack_gone` | 这件零食已经吃完了 |
| `tray_changed` | 沙盘被别处改过，`base` 对不上 |
| `id_reused` | 同一个 id 配了不同的内容 |
| `inventory_limit` | 超出存档上限 |

页面里这些错误码都有中文提示，见 `web/src/59-cabin-inventory.js` 的 `messages`。

## 5. 验收清单

升级后逐条确认：

- [ ] 用旧的 `state/cabin-inventory.json` 启动，`GET /api/cabin/inventory` 返回的 inventory 带 `coins / snacks / tray`，`found[*].items` 的条数等于 `n`；
- [ ] 打开小屋页面，收集盒底部的提示**不再**写「小屋服务还是旧版存档」；
- [ ] 在沙滩上捡一枚贝壳，收集盒详情里能看到它的尺寸和花纹，和沙滩上看到的一样；刷新页面后不变；
- [ ] 同一个 collect 请求发两次，第二次 `applied: false`，贝壳只多一枚；
- [ ] 在门廊垃圾桶清理 N 件垃圾，响应里 `earned = N`，`coins` 加 N；
- [ ] 卖掉一枚摆在窗台上的贝壳，返回 409 `in_use`；
- [ ] 收集盒「导出收藏」得到 `cabin-inventory-v2`，导入到一个空存档后内容完全一样；
- [ ] 原来的 `haibian/test/inventory*.test.mjs` 里，v1 专属的断言要改成 v2：例如 v1 拒绝 `size` 字段，v2 接受。

## 6. 更新流程

网页每次更新，都要把 `web/dist/` 里的页面和 **`inventory-rules.mjs`** 一起复制到本机服务目录：页面放进 `haibian/web/`，`inventory-rules.mjs` 放在 `cabin-inventory.mjs` 旁边。然后重启小屋服务。

新版规则读得懂旧版规则写的存档。目录里新增了种类或零食时，旧规则会把不认识的种类按「常见」算卖价，买不认识的零食会报 `unknown_item`，所以两边最好同时更新。
