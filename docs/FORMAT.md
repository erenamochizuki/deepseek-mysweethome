# 鲸图格式（方块数据 + 分享 PNG）· 第 1 版

> 网页（JS）和模组（Java）共用的约定，由 lead 维护，**要改先找 lead**。两边的实现、测试、样例文件都以这里为准。
> 2026-11-06 定第 1 版。

## 一句话

鲸图是一张普通 PNG，里面多带一个私有数据块 `xjSc`；数据块里原样装着一个 Sponge Schematic 第 3 版文件（`.schem`，gzip 压缩的 NBT）。所以：
- 把数据块取出来另存，就是一个标准 `.schem`，WorldEdit 这类工具能直接用；
- 任何 Sponge 第 3 版 `.schem` 包进 PNG 就是鲸图；网页和模组也都能直接读 `.schem`。

图上画什么不影响数据（一般画建筑预览），读的时候只看数据块。

## 1. PNG 外壳

- 数据块类型 `xjSc`：第 1 个字母小写 = 附加块（看图软件不认识也照常显示），第 2 个小写 = 私有块，第 3 个大写 = PNG 规范要求，第 4 个小写 = 改图软件可以照搬（数据不依赖像素）。
- 数据块内容：一个 `.schem` 文件的全部字节，前后不加任何东西。块的长度、类型、数据、CRC32 按 PNG 规范（CRC 算「类型 + 数据」）。
- 一张图只能有一个 `xjSc`。写：先删掉原图里所有 `xjSc`，再把新的放在 `IEND` 紧前面。读：`IEND` 前面任何位置都认（不检查它在不在 `IHDR` 后面）。

读的步骤（按顺序，第一个出问题的地方报错）：
1. 开头 8 字节是 PNG 签名 → 按 PNG 读；开头两字节是 gzip 头 `1f 8b` → 当 `.schem` 直接读（跳到第 2 节）；都不是 → `unknown_file`。
2. 从第 9 字节起一块一块往下走，直到 `IEND`。块头不完整、块的长度超出文件、到文件末尾还没遇到 `IEND` → `bad_png`。`IEND` 后面多出来的字节不管。其他块的 CRC 不检查。
3. 走的过程中遇到 `xjSc` 当场检查，依次：声明的长度 > 16 MiB（16,777,216）→ `too_large`（先于「长度超出文件」）；数据不完整 → `bad_png`；CRC 不对 → `bad_crc`。
4. 走到 `IEND` 后：没有 `xjSc` → `no_data`；多于一个 → `multiple_data`。

## 2. gzip + NBT

- gzip（RFC 1952）。写：时间戳写 0、不写文件名、默认压缩级别。读：**先把 gzip 整个解压成字节，再解析 NBT**：解压阶段的问题（不是 gzip、数据坏了、被截断）→ `bad_gzip`，解析阶段的问题 → `bad_nbt`；解压出的字节累计超过 64 MiB（67,108,864）→ `too_large`（边解压边数，超了马上停）。gzip 后面多出来的字节、多段 gzip 拼在一起：行为不规定，不测。
- NBT 按 Java 版（大端）。根标签必须是 compound（类型 10；名字随意，一般是空字符串），否则 `bad_nbt`。根标签后面多出来的字节忽略。
- 字符串：Java 的 modified UTF-8（`DataOutput.writeUTF`）：U+0000 写成 `C0 80`；U+10000 以上的字（比如 🐳）先拆成两个 UTF-16 代理项，各写 3 字节；编码后最长 65535 字节，写的时候超出就报错。读到不合法的编码 → `bad_nbt`。
- 嵌套（compound、list 一层套一层）超过 512 层 → `bad_nbt`（和 MC 的 `NbtAccounter` 一样；正好在 512 附近的情况不测，样例用 600 层以上）。未知的标签类型、数据被截断 → `bad_nbt`。
- 标签总数最多 2,097,152 个（2^21）。读的时候按文件里出现的标签数：根算 1 个，compound 的每个成员算 1 个，list 的每个元素算 1 个（在展开 `{"": v}` 之前数，所以包装用的 compound 和里面的值各算 1 个）；数组不管多长只算 1 个，结束标记不算。要读第 2,097,153 个时就停（不再分配），报 `too_large`。写的时候也照样数，超了报 `too_large`，不写。原因：一个空 compound 在文件里只占 1 字节，读进内存要几十字节，一张 58 KB 的图就能让游戏内存不够、直接崩掉；2^21 个标签本身大约 150 MB 内存，加上解压出来的最多 64 MiB 字节，读的时候峰值大约 300 MB（fmt-js 在 Node 里量过：many-tags 292 MB，正好到上限 247 MB）。正常建筑远用不到：一栋房子几千个，一个装满东西的箱子大约 150 个。
- 数组、列表、字符串声明的长度是负数，或者比剩下的字节还多 → `bad_nbt`。**不要按声明的长度先分配内存**（几十字节的坏文件可以声明 20 亿个元素；MC 自己的 `NbtIo` 就会这样把 Java 内存撑爆，所以模组这边读用自己写的小读取器）。
- list 元素类型是 0 但长度 > 0 → `bad_nbt`；元素类型不认识但长度是 0 → 当空列表（和 MC 一样，不测）。
- Java 读的时候要用 `NbtAccounter.unlimitedHeap()` 的层数限制（只限层数），64 MiB 自己在解压流上数字节；MC 默认的 2 MiB 内存估算额度太小，会把正常的大建筑当成坏数据。
- compound 里键重复：后面的覆盖前面的（和 MC 一样，不测）。
- list：从 MC 1.21.5 起列表里可以混不同类型，规则照抄 MC 26.1 的 `ListTag`：
  - 写：元素都是同一类型 → 元素类型写那个类型；混合 → 元素类型写 10（compound），不是 compound 的元素包进一个「只有一个空键 `""`」的 compound，compound 元素照原样写。不管混不混，只要元素类型是 10，形状正好是「只有一个空键」的 compound 元素也要再包一层（不然读的时候会被拆开）。空列表元素类型写 0。
  - 读：每个元素如果是「只有一个空键」的 compound，就换成里面的值。
  - 所以列表不记元素类型，只记元素本身。
- float、double 按 IEEE 754 的位原样保存，包括 −0.0（读的时候别走会把 −0.0 变成 +0.0 的路，MC 的 `FloatTag.valueOf` / `DoubleTag.valueOf` 就会）。NaN 也不改位，但样例里只用标准 NaN（float `7fc00000`、double `7ff8000000000000`），因为 Java 在有些平台上不保证别的 NaN 位不变。long 是 64 位整数（JS 里用 BigInt）。

## 3. Schematic 内容（Sponge 第 3 版 + 我们的约定）

原规范：<https://github.com/SpongePowered/Schematic-Specification/blob/master/versions/schematic-3.md>。下面只写我们怎么用、哪里比原规范更严。

根 compound 里有一个 `Schematic` compound（原规范的写法）。读的时候也接受「根 compound 本身就是 Schematic」（根里没有 `Schematic` 键、但有 `Version` 键）。

| 字段 | NBT 类型 | 读 | 我们写 |
| --- | --- | --- | --- |
| `Version` | int | 必须 = 3，否则 `unsupported_version`；没有或类型不对 → `bad_schematic` | 3 |
| `DataVersion` | int | 必须有。≠ 4790 时给警告 `data_version` | 模组：当前游戏的数据版本（MC 26.1.2 = 4790）；网页：读进来的保留原值，新建的写 4790 |
| `Metadata` | compound | 可以没有；有的话必须是 compound（否则 `bad_schematic`），**整个原样保留**（包括不认识的键） | 见 3.1 |
| `Width` / `Height` / `Length` | short，当无符号用（`值 & 0xFFFF`） | x / y / z 方向的格数。必须有、必须是 short、每个 ≥ 1，否则 `bad_schematic`；任一 > 1024 或三者乘积 > 4,194,304 → `too_large` | 实际尺寸 |
| `Offset` | int array，3 个 | 可以没有（当作 [0,0,0]）；有的话必须正好 3 个，否则 `bad_schematic` | 一定写，见 3.2 |
| `Blocks` | compound | 必须有，否则 `bad_schematic` | 见 3.3 |
| `Biomes` | compound | 不读；有这个键就给警告 `ignored_biomes` | 不写 |
| `Entities` | list | 不读；至少有 1 个元素时给警告 `ignored_entities` | 不写 |
| 其他键 | | 忽略 | 不写 |

检查顺序：按上表从上往下（`Version` → `DataVersion` → `Metadata` → 尺寸 → `Offset` → `Blocks`），`Blocks` 里按 3.3 表从上往下（`Palette` → `Data` → `BlockEntities`），遇到第一个问题就报错。警告最后统一算。

### 3.1 Metadata

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `Name` | string | 建筑名。模组抓取时没给名字，就用 `capture-年月日-时分秒` |
| `Author` | string | 作者：模组写玩家名；网页写设置里的名字（没有就写空字符串） |
| `Date` | long | 创建时间，1970-01-01 UTC 起的毫秒数 |
| `RequiredMods` | list of string | 调色板里出现的、不是 `minecraft` 的命名空间，排好序（比如 `["xiaojingyu"]`）；一个都没有就不写这个键。读的时候不信它，用调色板自己算。命名空间的取法：状态字符串 `[` 前面的部分，有 `:` 就取第一个 `:` 前面，没有 `:` 就是 `minecraft`；去重、去掉 `minecraft`、按字符串排序（逐个比 UTF-16 码元，JS 默认排序和 Java `String.compareTo` 一样）。按写出去的（规范化后的）调色板算 |
| `Xiaojingyu` | compound | 我们自己的信息，见下表。别的工具写的 `.schem` 没有它，读的时候不能要求有 |

`Xiaojingyu` 里：

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `FormatVersion` | int | 本文档的版本，现在是 1。读到比 1 大的：照样读，给警告 `newer_format`；没有或类型不对：当作 1，不报错 |
| `Facing` | string | `north` / `south` / `east` / `west`：抓取时玩家面朝的方向。盖的时候按「当时的朝向 → 盖的人现在的朝向」转 |
| `Origin` | int array，3 个 | 抓取时站立点在原世界的坐标，只做记录 |
| `Dimension` | string | 抓取时所在的维度，比如 `minecraft:overworld`，只做记录 |
| `Source` | string | 谁写的：`xiaojingyu-mod/0.1.0`、`haibian-web/4.0.0-dev` |
| `GameVersion` | string | 写的时候的 MC 版本，比如 `26.1.2`，只做记录 |
| `FromPlace` | compound，可以没有 | 2026-11-07 加（可选，读的时候不能要求有）。有它表示这张图是模组的 `/xjy capture 上次` 抓的（COMMANDS.md §2b）：按某次 `/xjy place` 盖的盒子抓回来，大小、`Offset`、`Facing` 和当初放的那张文件一样，格子和方块状态也转回了那张文件的摆法，可以和它逐格比。里面：`File`（string，当初 place 的文件名，比如 `house-v4-b.png`）、`Turn`（int，当初 place 时顺时针转了几度：0 / 90 / 180 / 270）。这时 `Origin` 是那次 place 的站立点，`Facing` 照抄原文件（原文件没有就没有） |

读写代码（编解码器）不改 Metadata，只有 `RequiredMods` 例外：
- 写：模型里的 meta 原样写进文件；只有 `RequiredMods` 每次按调色板重算（有就写，没有就删掉这个键）。模型的 meta 是 null 时不写 `Metadata`，也不为了 `RequiredMods` 新建一个。`Name`、`Author`、`Date` 和 `Xiaojingyu` 里的东西由**创建模型的一方**填（模组抓取时、网页新建时），编解码器不自动盖时间、不改 `Source`——所以同一个 case 两边写出来的 Metadata 一样。
- 读：dump 里的 `meta` 就是文件里的原样（包括文件里写的 `RequiredMods`，哪怕它是错的）；真要用这个列表时自己按调色板算。

### 3.2 站立点和 Offset

- 站立点：抓取时玩家脚所在的那一格（MC 的 `player.blockPosition()`）。
- `Offset` = 第 (0,0,0) 格相对站立点的位置，即 `Offset = 最小角 − 站立点`。这和原规范一致（「从 P 点粘贴，第一格放在 P + Offset」），WorldEdit 粘贴时也这样用。
- 盖的时候：站立点 = 盖的玩家脚所在那一格；按 `Facing` → 现在的朝向，绕站立点（竖直轴）转 0 / 90 / 180 / 270 度再放。具体算法 P2 写进模组，这里只约定：转动中心是站立点。
- 第 (0,0,0) 格在原世界的坐标 = `Xiaojingyu.Origin` + `Offset`（不用另存）。网页画图要用它：MC 里草方块、石头这类的随机朝向和花草的随机偏移是按世界坐标算的，用这个坐标画出来才和抓取时的游戏画面一样。文件里没有 `Origin`（比如别的工具写的 `.schem`）时，就当第 (0,0,0) 格在 `Offset`，随机朝向会和原世界不一样，不算错。
- 有 `Xiaojingyu.FromPlace` 而且 `Turn` 不是 0 时（2026-11-07 加）：格子 (x, y, z) 在原世界里是 `Origin` + 把 `Offset + (x, y, z)` 绕竖直轴顺时针转 `Turn` 度（顺时针 90° 是 (x, y, z) → (−z, y, x)），不是 `Origin + Offset + (x, y, z)`。只影响上面说的随机朝向：不按这个算也只是草、石头的花纹和原世界不一样，不算错。

### 3.3 Blocks

| 键 | 类型 | 读 | 我们写 |
| --- | --- | --- | --- |
| `Palette` | compound：键 = 方块状态字符串，值 = int 编号 | 值必须是 int 且 ≥ 0；两个键用同一个编号 → `bad_schematic`；条目多于 65,536 个 → `too_large`。编号可以不连续、顺序随意 | 编号 0..n−1 连续，只放用到的状态，顺序 = 规范顺序（第 4 节） |
| `Data` | byte array：每格一个 varint | varint = 无符号 LEB128（每字节低 7 位是数据，先存低位；最高位为 1 表示后面还有），最多 5 字节，值 ≤ 2³¹−1。格数必须正好 = W×H×L，末尾不能多字节；每个编号都必须在 Palette 里。违反 → `bad_schematic` | 同左 |
| `BlockEntities` | list of compound | 每个元素必须有 `Pos`（int array，3 个，相对第 (0,0,0) 格，不加 Offset）和 `Id`（string）；`Data`（compound）可以没有。Pos 超出范围、两个元素 Pos 相同 → `bad_schematic`。`Data` 原样保留 | 一定写（可以是空列表），按格子编号从小到大排；`Data` = 方块实体的完整 NBT 去掉 `id`、`x`、`y`、`z` 四个键 |

格子编号：`i = x + z × W + y × W × L`（x 变得最快，然后 z，最后 y；和 P0 探针的 `/region` 一样）。

方块状态字符串：`命名空间:名字[属性=值,…]`，没有属性就不写方括号。我们写的时候命名空间一定写全（写 `minecraft:stone`，不写 `stone`）。模组写的就是 MC `BlockStateParser.serialize` 的结果（实测属性按名字排序、所有属性都写，比如 `minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]`）。读的时候字符串**原样**保留，不改顺序、不补全；写法不同的两个字符串算两种状态（P1 只管搬运，P2 盖进世界时才交给 MC 解析）。

`minecraft:air` 就是空气，盖的时候会把那一格清空。

## 4. 规范模型和 dump（两边对比用）

读出来的东西，两边都整理成同一个「规范模型」，并能输出成 JSON（dump）。两边对同一个文件输出的 dump 必须**完全相同**（按 JSON 的值比较：对象不管键的顺序，数组管顺序）。

规范化：
- 调色板按「第一次出现」排序：从第 0 格起按格子编号往后扫，新出现的状态依次编 0、1、2…；没用到的条目丢掉，并给警告 `unused_palette`。
- 方块实体按格子编号排序。
- Metadata、方块实体的 Data 原样（写成下面的类型化 JSON）。

```json
{
  "dump": 1,
  "size": [3, 1, 1],
  "offset": [-1, 0, 1],
  "dataVersion": 4790,
  "meta": { "compound": { "Name": { "string": "小屋" } } },
  "palette": ["minecraft:air", "minecraft:chest[facing=north,type=single,waterlogged=false]"],
  "cells": [[2, 0], [1, 1]],
  "blockEntities": [
    { "pos": [2, 0, 0], "id": "minecraft:chest", "data": { "compound": {} } }
  ],
  "warnings": []
}
```

- `meta`：没有 Metadata 时是 `null`。
- `cells`：按格子编号的连续段 `[个数, 调色板编号]`，相邻两段的编号一定不同（尽量合并）。
- `blockEntities[].data`：没有 Data 时是 `null`。
- `warnings`：警告代码，去重、按字母排序；没有就是 `[]`。

类型化 JSON：每个 NBT 值写成只有一个键的对象，键名就是类型。

| NBT | JSON |
| --- | --- |
| byte / short / int | `{"byte": -1}`、`{"short": 300}`、`{"int": 7}` |
| long | `{"long": "-9223372036854775808"}`（十进制字符串） |
| float | `{"float": "3fc00000"}`（32 位，8 位小写十六进制） |
| double | `{"double": "3ff8000000000000"}`（64 位，16 位小写十六进制） |
| string | `{"string": "海边 🐳"}` |
| byte array | `{"byteArray": [-128, 0, 127]}` |
| int array | `{"intArray": [1, 2]}` |
| long array | `{"longArray": ["1", "-2"]}` |
| list | `{"list": [值, 值, …]}`（不记元素类型，见第 2 节） |
| compound | `{"compound": {"键": 值, …}}` |

dump 也能变回模型：`fixtures/share/cases/*.json` 就是 dump，两边的写入器照它写图。

## 5. 错误和警告

错误（读不下去）的代码两边完全一样，测试比代码；给用户看的话用下面的中文。

| 代码 | 什么时候 | 给用户的话（参考） |
| --- | --- | --- |
| `unknown_file` | 既不是 PNG 也不是 gzip | 这不是鲸图（PNG）也不是 .schem 文件。 |
| `bad_png` | PNG 结构坏了或不完整 | 图片文件不完整，可能没下载完。请重新保存原图再试。 |
| `no_data` | PNG 里没有 `xjSc` | 这张图里没有方块数据。聊天软件（微信、QQ 等）发图时常会压缩图片、去掉附加数据。请让对方「发送原图」或者把图片当文件发，再试一次。 |
| `multiple_data` | 有两个或更多 `xjSc` | 这张图里有好几份方块数据，不知道该用哪份。 |
| `bad_crc` | `xjSc` 的 CRC 不对 | 方块数据损坏了。请让对方重新发原文件。 |
| `too_large` | 超过第 1–3 节的上限 | 这个建筑太大了，或者里面的东西太多了（上限：每边 1024 格，总共 4,194,304 格）。 |
| `bad_gzip` | 解压失败 | 方块数据损坏了（解压失败）。 |
| `bad_nbt` | NBT 结构不对 | 方块数据损坏了（数据结构不对）。 |
| `unsupported_version` | Sponge 版本不是 3 | 这个文件是 Sponge 第 N 版格式，现在只支持第 3 版。 |
| `bad_schematic` | 必要的字段缺失、类型不对、数据对不上 | 方块数据不完整：（写明具体哪里） |

警告（照样读，提醒一下）：`data_version`、`ignored_biomes`、`ignored_entities`、`newer_format`、`unused_palette`。

写入器写之前先用同一套规则检查自己的模型，保证写出来的文件自己读得回来。

## 6. 样例文件和测试

```
fixtures/share/
  README.md              怎么生成、怎么检查
  cases/名字.json        正常建筑的 dump（网页这边的脚本生成，lead 审过）
  js/名字.png            网页按 cases 写的鲸图
  java/名字.png          模组按 cases 写的鲸图
  odd/名字.png 或 .schem 特意造的特殊文件（网页这边的脚本生成）
  odd/名字.expect.json   期望结果：{"dump": {…}} 或 {"error": "代码"}
```

两边的测试都要做：
1. 每个 case：按 dump 建模型 → 写成图 → 再读 → dump 和 case 一样。
2. 读**对方**写的每张图（网页读 `java/`，模组读 `js/`）→ dump 和 case 一样。这一条就是 P1 的验收「同一张图两边读出来一格不差」。
3. `odd/` 里每个文件 → 结果和 expect 一样（错误比代码，能读的比 dump）。
4. 同一个 case 写两次，字节完全一样；重新生成自己那份样例，和提交的一样。（以后升级 Node 或 JDK 后如果只是压缩出来的字节变了、dump 没变，重新生成再提交就行。）

`fixtures/` 下的文件在 git 里不做换行转换（仓库根的 `.gitattributes`），JSON 一律写 LF。

样例图本身画一张 16×16 的纯色小图就行。真正的预览图到 P2（模组抓取）、P6（网页编辑器导出）再定。

## 7. 版本记录

- 第 1 版（2026-11-06）：第一版。
- 2026-11-06 03:20 补充（兼容，还是第 1 版）：`xjSc` 走块时当场检查的顺序；数组、列表、字符串长度为负或超出剩余字节 → `bad_nbt`，不按声明长度预先分配；list 元素类型 0 的规则；−0.0 要保留、样例只用标准 NaN；`RequiredMods` 命名空间的取法；`fixtures/` 不转换换行。
- 2026-11-06 05:15 补充（兼容，还是第 1 版）：标签总数最多 2,097,152 个，超了 `too_large`（防止很小的文件读进内存后变得极大，fmt-java 实测 58 KB 的文件让 1 GB 堆的 JVM 内存不够）；`too_large` 的提示文字改成也能说明「里面的东西太多了」。
- 2026-11-06 05:58 补充（只是说明，格式没变）：§3.2 写明第 (0,0,0) 格的世界坐标 = `Origin` + `Offset`，网页画随机朝向要用（mc-render 提的）。
- 2026-11-07 补充（兼容，还是第 1 版，mod5）：`Xiaojingyu` 里加可选的 `FromPlace`（`File`、`Turn`），模组 `/xjy capture 上次` 写；§3.2 写明这时格子在原世界的坐标要按 `Turn` 转。别的字段意思不变，没有它的文件和以前一样读。
- 以后：兼容的改动在这里记一笔；不兼容的改动把 `FormatVersion` 加 1。
