# 小屋收藏存档 v2：本机服务要做的升级

海边邻居扩展保留 v2 备份格式。新版 `freshState`、`parseState` 和 `parseInventory` 会给旧档补 `inventory.shore`，其中有半日领币记录、借壳 UID、首次换壳纪念、鱼缸位置、住户和鱼种观察册。服务要返回完整 inventory，并将 `shore_gift`、`shore_loan`、`shore_berth`、`shore_catch`、`shore_watch`、`shore_fish` 和其他命令一样交给 `parseCommand` / `apply`。不要只更新页面而遗漏构建生成的规则模块。未返回扩展字段的旧服务不会收到新命令；带有实际海边记录的备份不能降级覆盖旧服存档。

写给：维护本机小屋服务（`haibian/server.mjs` + `cabin-inventory.mjs`）的人或 agent。
网页这边已经做完；离线成品不需要服务也能完整使用。只有接了本机服务（页面注入了 `/cabin-bridge.js`）的用户，需要按本文把服务端升级到 v2。

## 1. 为什么要升级

v2 给收藏加了这些东西：

- **每一枚贝壳独立**：有尺寸（mm）和花纹，还有大金冠 / 小金冠；
- **贝币**：清理垃圾、卖藏品可以得到贝币，买零食要花贝币；
- **零食**：小店共 32 款，按新鲜水果、咸点与轻食、甜点、饮品分架，每架 8 款。分类不改变消费规则：盒装、袋装按份吃，杯装或瓶装分三口（或三勺），吃喝完留下空容器。详见[货架盘点和补货清单](SHOP-MENU.md)；
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
  chimes: { door: { rev, bar, strands }, window: { rev, bar, strands } },
  garden: { seeds: { [kind]: n }, seen: [kind], bloomed: { [kind]: firstBloomAt }, zone?,
    pot: null | { kind, plantedAt, watered: ['YYYY-MM-DD'], harvested, by: ['player' | 'girl'] } },
  shore: { gift, loan, memory, berth, lastCatch, fish: [{ uid, kind, name, fed, form? }], observed: [kind], forms?: { [kind]: [form] } },
}
```

| 字段 | 含义 |
| --- | --- |
| `garden` | 旧档读入时补空。种子按种类计数，首次拾到记入 seen，首次开花记毫秒时间。原有海滩收藏按 found 计数。 |
| `garden.pot` | watered 按顺序记录实际浇过水的奖励日期，by 逐日对应。harvested 是上一次收种时的浇水日数，初始为 0。第一次浇花或领币会固定两者共用的奖励时区。 |
| `n` | 等于 `items.length`。可以是 **0**：这一种全卖了，但图鉴仍算「见过」 |
| `size` | 最长边，毫米，一位小数 |
| `pat` | 花纹 id：`plain sunset mist ring dots albino iris`。不认识的花纹按 `plain` 处理 |
| `uid` | 一枚贝壳的 id，等于捡起它那次 collect 的 op id（也就是沙滩物件的 id）。v1 迁移来的是 `legacy:<kind>:<序号>` |
| `placements[].uid` | 摆出去的是哪一枚。阁楼的贝壳展示位 `loft-window` 在西窗。朝海小窗上方的风铃用 `chimes.window` 保存，窗台留给花盆。 |
| `snacks[].left` | 盒、袋还剩几份；杯、瓶还剩几口（满 3 → 中 2 → 低 1 → 空 0） |
| `tray` | 沙盘，单位厘米，原点在沙盘中心。内框 90 × 60（规则里的 `TRAY`），最多 80 枚。`ry` 是弧度 |
| `chimes` | 门铃 5 串，每串最多 5 枚、80 cm。窗铃 3 串，每串最多 4 枚、45 cm。每串按从上到下存 `[{uid, gap}]`，`gap` 为上方线长（整厘米 2–12），总长包含藏品最长边。`bar` 为 `driftwood`。每个位置独立计 `rev`，旧档和备份缺少 `chimes` 时补两套空设计。 |
| `shore.observed` / `shore.forms` | 观察册按鱼种计数；有多种花色的鱼额外记录已经见过的花色。旧档只记鱼种时视为见过原色 `base`。花色由当班时段和鱼种共同决定，不由客户端指定 |
| `shore.fish[].form` | 鱼缸住户的花色；省略表示原色。搬缸、收缸、刷新和导入备份都不会重抽 |
| `shore.tankTier` | 0 / 1 / 2 / 3 对应 3 / 6 / 12 / 24 格；旧档缺省为 0。容量按成体预留，`fishSlots` 定义 1 / 2 / 4 / 6 格。小海豚需 3 级且有 6 个空格，恢复备份同样校验。2、3 级缸位只允许 `west`、`east` 或 `null` |
| `shore.fish[].caughtAt` | 新住户的入缸时间（服务端毫秒）；老住户以 `fish:<epoch>` 的五分钟窗口起点估算，其他旧编号显示日期不详。成长只读时间，不写存档 |
| `shore.released` | 最近 128 位放归住户，按离家顺序保留个体编号、名字、花色、入缸和离家时间及最近一次回访。驮岛鱼额外记离家时的 `islandStage`（0–5）；旧放归记录无此字段，按当时的三阶规则还原。旧档无放归列表时默认为空。`shore_visit` 只记录到访，不改变捕捞、格数、贝币和观察册；离家至少 2 天，全岸两次来访间隔至少 2 天，同一位至少 5 天。雨铃鱼只在有雨时回访，雷暴暂停。 |

王冠**不存**，由尺寸实时算：`Rules.crown(kind, size)`。尺寸落在本种区间两端 5% 以内就有王冠，区间默认是标准尺寸 × [0.7, 1.3]。

导出 / 导入格式是 `{ format: 'cabin-inventory-v2', inventory }`。`restore` 也接受 `cabin-inventory-v1`，会自动升级。

## 4. 操作（POST /api/cabin/inventory）

所有操作都带 `op` 和 `id`。`id` 最长 128 个字符，同一个 `id` 重放时不重复执行，返回 `applied: false`。
「结果」一列的字段会合并进响应：`{ ok, initialized, rev, inventory, applied, ...结果 }`。

| op | 字段 | 结果 | 说明 |
| --- | --- | --- | --- |
| `collect`（种子） | `kind, at, category: 'seed'` | `{ kind, first, gained: 1 }` | 收一颗种子，记录是否首次发现。种子没有尺寸、花纹或单独编号 |
| `garden_plant` | `kind` | `{ kind }` | 空盆中种下一颗拥有的种子 |
| `garden_water` | `day, by`，可选 `zone` | `{ kind, day, by, firstBloom }` | 按服务端当前时间核对日期。当天已经浇过返回 `applied: false`。第一次浇水时可提供小屋时区 |
| `garden_harvest` | 无 | `{ kind, gained, first: false }` | 开花后再浇 3 天可收 1–2 颗同种种子，数量由操作编号固定 |
| `garden_clear` | 无 | `{ kind }` | 清空当前花盆，保留手记 |
| `collect` | `kind, at, category`，可选 `size, pat` | 贝壳：`{ item, kind, crown }`；垃圾：`{ kind }` | 贝壳新增一枚，uid = op id。没给 size / pat 时按 op id 固定推出来；size 会夹进本种区间。垃圾只让 `trash` +1 |
| `place` | `kind, slot, by`，可选 `uid, returnAt` | `{ uid }` | 给了 uid 就摆这一枚，否则摆第一枚空闲的 |
| `return` | `slot, by`，可选 `expectedId` | `{ uid }` | 同 v1 |
| `dispose` | — | `{ disposed, earned }` | `cleaned += trash`，`coins += trash × 1`，然后 `trash = 0` |
| `sell` | `uids[]`（每次 1–200 个） | `{ sold, earned }` | 每件常见 1、少见 3、稀有 5、超稀有 50 贝币。展示中、沙盘里或借给寄居蟹的藏品不能卖。小店的「选中本类普通款」只勾选没有王冠和稀有花纹的可售藏品，默认保留每种的最后一件；超过 200 件分批结算 |
| `buy` | `sku, qty`（1–20） | `{ cost, bought: [uid] }` | 每件 uid 为 `<op id>:<序号>`，`left` = 目录里的份数 |
| `consume` | `uid, by` | `{ sku, left, emptied }` | `left - 1`。到 0 就移除；杯装的空杯会让 `trash` +1（`emptied: true`） |
| `tray_set` | `base, items[], by`，可选 `via` | `{ trayRev }` | 整盘替换。`base` 必须等于当前 `tray.rev`，否则报 409 `tray_changed`。`via` = 对话会话 id（小鲸鱼通过对话工具摆放时带上），只用来记录 |
| `chime_set` | `slot, base, bar, strands, by`，可选 `via` | `{ slot, chimeRev }` | `slot` 取 `door` 或 `window`。整套替换指定位置，`base` 校验该位置的版本。`via` 可记录会话。全部留空即取下，藏品的尺寸和花纹保留。 |
| `shore_catch` | `epoch, berth`，可选 `kind` | `{ kind }` | 每五分钟最多确认一尾浅海鱼；提供的种类须与当班相符。`berth: null` 只观察放回，否则须是当前缸位并有空位 |
| `shore_upgrade` | `expected`（当前等级） | `{ tankTier }` | 逐级支付 12、24、48 贝币；余额、缸位、等级均通过才扣款。网页、服务端规则须同步更新 |
| `shore_watch` | `epoch, kind` | `{ kind }` 或 `applied: false` | 当班远礁三种之一；记录见过的种类与花色，重复不加种，不消耗浅海抄网机会，不占鱼缸 |
| `legacy` | `found`（v1 格式） | `{}` | 同 v1：每个存档只导入一次浏览器旧档 |
| `restore` | `rev, inventory`（v1 或 v2） | `{}` | 同 v1：只能恢复到空存档 |
| `reset` | `rev` | `{}` | 同 v1 |

v2 新增的错误码都是 409：

| 错误码 | 什么时候出现 |
| --- | --- |
| `in_use` | 这一枚已在摆件位、沙盘、风铃或寄居蟹身上。卖出、展出、借出和挂上另一处风铃都检查同一份占用记录 |
| `chime_changed` | 指定位置刚被别处修改，`base` 与它的 `rev` 不同。重新读取存档后再编辑 |
| `pot_busy` / `pot_empty` | 往已有植物的花盆播种，或在空盆里浇水、收种、清空 |
| `no_seed` / `not_ready` | 没有对应种子，或还未到可收种的浇水日数 |
| `day_changed` | 指定的日期与服务端奖励日不同，或时区与存档固定值冲突 |
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

风铃更新也要同步这两份文件。服务返回完整的 `inventory.chimes`，目录保留 `decoratable`，让本机服务和网页接受同一批藏品。连接尚未升级的服务时，页面会提示升级，并拒绝将带挂件的备份降级导入。

新版规则读得懂旧版规则写的存档。目录里新增了种类或零食时，旧规则会把不认识的种类按「常见」算卖价，买不认识的零食会报 `unknown_item`，所以两边最好同时更新。
