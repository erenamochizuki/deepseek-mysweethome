# fixtures/share — 鲸图格式的共用样例

网页（web/）和模组（mod/）两边的测试都读这里的文件，用来确认两边读写鲸图（分享 PNG / .schem）的结果一样。
格式约定见 [docs/FORMAT.md](../../docs/FORMAT.md)，第 6 节讲样例和测试。

## 目录

| 目录 | 是什么 | 谁生成 | 怎么重新生成 |
|---|---|---|---|
| `cases/名字.json` | 标准答案：每个样例建筑的 dump（FORMAT.md 第 4 节） | `web/tools/share.mjs` | `node web/tools/share.mjs make-fixtures` |
| `js/名字.png` | 网页写入器（`web/src/13-share.js`）按 cases 写出的鲸图，图是 16×16 纯色 | 同上 | 同上 |
| `java/名字.png` | 模组写入器按 cases 写出的鲸图 | 模组的 shareTest（`mod/src/shareTest`） | 在 mod/ 下 `gradlew shareFixtures` |
| `odd/名字.png`、`odd/名字.schem` | 怪文件：每个只有一个问题 | `web/tools/share.mjs` | 同 cases |
| `odd/名字.expect.json` | 读这个怪文件应该得到什么：`{"dump": …}` 或 `{"error": "代码"}` | 同上 | 同上 |

## 规矩

- 不要手改这里的文件。要改样例就改生成器，重新生成，再跑检查：
  cases 在 `web/tools/lib/share-cases.mjs`，odd 在 `web/tools/lib/share-odd.mjs`，java/ 在 `mod/src/shareTest`。
- cases/ 的 dump 是生成器从它自己定义的模型直接算出来的（自己数调色板、自己做游程），不经过任何一边的读取器，
  免得读取器「自己证明自己」。
- odd/ 的文件用生成器自己的小编码器拼（`web/tools/lib/share-raw.mjs`，可以故意写错类型、长度、CRC）。
  里面的 gzip 只用「不压缩」的块，PNG 的 IDAT 也是，所以不依赖 zlib 版本，哪台机器上生成都逐字节一样。
  gzip 炸弹是手写的动态 Huffman 块：文件约 64 KB，解压出 67,633,153 个 0 字节。
  「标签太多」的三个（many-tags、tags-at-limit、tags-over-limit）也是手写的 deflate（`gzipZeroRun`）：
  解压后是 12 字节的头加一长串 0（每个 0 是一个空 compound），many-tags 文件约 58 KB、解压后约 57 MiB。
- js/*.png 用真正的网页写入器写，压缩用的是 Node 的 CompressionStream（底层是 zlib）。
  换了 Node 版本后 check-fixtures 可能报「字节不同，但读出来的 dump 一样」：这是正常的，
  确认后重新 make-fixtures 并提交（FORMAT.md 第 6 节）。java/ 换 JDK 后同理。
- odd/ 的期望按 FORMAT.md 的检查顺序定：同一个文件里要是有两个问题，先查到的那个算数。所以每个文件只放一个问题。
- 所有 JSON 用 LF 换行，末尾有换行。仓库根的 `.gitattributes` 写了 `fixtures/** -text`，git 不会转换换行；
  check-fixtures 也会把 CRLF 当 LF 来比。
- gzip 头的 OS 字节两边都写 ff（这一项不跨边比较，只要求各自写两次一样）。
- 加新样例：在生成器的 CASES 或 ODD 里加一项，make-fixtures，再告诉模组那边重新生成 java/ 并把它加进测试。

## 检查

| 命令 | 查什么 |
|---|---|
| `node web/tools/share.mjs check-fixtures` | 在内存里重新生成 cases/、js/、odd/，和这里的逐字节比；多出来的文件也报 |
| `node web/test/share.test.mjs` | 网页这边：每个 case 写 → 读 → dump 和 cases/ 一样、写两次一样；读 java/*.png；odd/ 的结果对不对 |
| `node web/test/share.test.mjs --require-cross` | 同上，但 java/ 缺文件算失败（P1 验收用这个） |
| `gradlew shareTest -Prequire-cross`（在 mod/ 下） | 模组这边的同一套检查，见 `mod/build.gradle` 里 shareTest 的说明 |

看单个文件：`node web/tools/share.mjs info <文件>`、`node web/tools/share.mjs dump <文件>`。
下面两张表可以用 `node web/tools/share.mjs list` 重新打印。

## cases

| case | 尺寸 | 调色板 | 方块实体 | 测什么 |
|---|---|---|---|---|
| single-stone | 1×1×1 | 1 | 0 | 最小的建筑：1 格石头，没有 Metadata |
| p0-blocks | 3×2×1 | 6 | 1 | P0 实测过的 6 个完整状态字符串、负的 Offset、空箱子的方块实体（P0 实测的写法） |
| chest-items | 1×1×1 | 1 | 1 | 箱子里有物品（MC 26.1：Slot byte、id、count int、components），箱子有自定义名字 |
| small-house | 5×4×5 | 6 | 2 | 混一个 xiaojingyu: 命名空间的方块（RequiredMods）、没有 Data 的方块实体、告示牌方块实体 |
| big-palette | 20×2×15 | 300 | 0 | 300 种状态：调色板编号超过 127，Data 里要用 2 字节 varint；上层倒着排 |
| nbt-types | 1×1×1 | 1 | 1 | 所有标签类型和极值、float/double 的 −0/±Inf/次正规数/标准 NaN、空串/中文/emoji/U+0000、空列表/嵌套列表/混合列表/像包装的 compound、空数组、怪键名 |
| unicode-meta | 2×1×1 | 2 | 0 | 中文 + emoji 的 Name/Author，Metadata 里有不认识的键（要原样保留） |
| tall-thin | 1×200×1 | 4 | 0 | 1×200×1 的细高柱子：查 y 方向的下标和负的 Offset |
| axes | 2×3×4 | 24 | 3 | 2×3×4，24 格状态全不同：查格子顺序 i = x + z×W + y×W×L；方块实体故意不按顺序列 |
| big-air | 256×64×256 | 4 | 0 | 256×64×256 = 4,194,304 格（正好到上限），大部分是空气；读要 < 3 秒 |

p0-blocks 会被 P2 真的放进开发世界再读回来比（docs/COMMANDS.md），所以摆法保证邻居更新后状态不变：
灯笼下面是原木，箱子只有一个，楼梯旁边没有别的楼梯。

## odd

| 文件 | 期望 | 测什么 |
|---|---|---|
| bare.schem | 能读（dump） | 裸 .schem（gzip，不包在 PNG 里） |
| root-no-wrapper.png | 能读（dump） | 根上没有 Schematic 这一层，Version 等键直接在根上 |
| entities-biomes.png | 能读（dump） | 带 Entities（1 个）和 Biomes：忽略，给两个警告 |
| palette-shuffled.png | 能读（dump） | 调色板乱序（编号 0/3/7）且 dirt 没用到：规范化，给 unused_palette 警告 |
| no-metadata.png | 能读（dump） | 没有 Metadata：meta 是 null |
| format-version-2.png | 能读（dump） | Metadata.Xiaojingyu.FormatVersion 是 2：能读，给 newer_format 警告 |
| old-data-version.png | 能读（dump） | DataVersion 是 3700：能读，保留读到的值，给 data_version 警告 |
| data-before-idat.png | 能读（dump） | xjSc 块在 IDAT 前面 |
| text-chunk.png | 能读（dump） | 有一个 tEXt 块（别的软件加的） |
| trailing-after-iend.png | 能读（dump） | IEND 后面还有字节（里面甚至有一个完整的 xjSc 块）：不管 |
| list-wrapped.png | 能读（dump） | Metadata 里有个 compound 列表，元素都是 {"": int}：读成 int 列表 |
| nbt-trailing.png | 能读（dump） | 解压后 NBT 后面还多 4 个字节：不管 |
| root-name.png | 能读（dump） | 根标签的名字不是空的（"鲸图"）：不管 |
| no-data.png | no_data | 普通 PNG，没有 xjSc 块 |
| two-data.png | multiple_data | 两个 xjSc 块 |
| bad-crc.png | bad_crc | xjSc 块的 CRC 不对 |
| random.png | unknown_file | 随机字节（不是 PNG 也不是 gzip，里面有 NUL） |
| truncated.png | bad_png | PNG 在 xjSc 块的数据中间被截断 |
| no-iend.png | bad_png | 没有 IEND（文件在 xjSc 块后面就结束了） |
| data-length-huge.png | too_large | xjSc 声明长度 16,777,217（超过 16 MiB），文件本身很小 |
| data-length-limit.png | bad_png | xjSc 声明长度正好 16,777,216（没超上限），但数据不够 |
| chunk-length-huge.png | bad_png | tEXt 块声明长度 0xFFFFFFF4（当有符号数是负的），超出文件 |
| gzip-bomb.png | too_large | gzip 炸弹：文件约 64 KB，解压出 67,633,153 字节（超过 64 MiB） |
| bad-gzip.png | bad_gzip | gzip 头没问题，压缩数据的块类型是保留值 3 |
| truncated-gzip.png | bad_gzip | gzip 数据只剩前一半（xjSc 块本身完整） |
| not-gzip.png | bad_gzip | xjSc 里是没压缩的 NBT（开头不是 1f 8b） |
| unknown-tag.png | bad_nbt | Schematic 里有一个类型号 13 的标签 |
| deep-nesting.png | bad_nbt | 600 层嵌套的 compound |
| deep-lists.png | bad_nbt | 600 层嵌套的列表 |
| bad-mutf8.png | bad_nbt | Metadata.Name 的字节不是合法的 MUTF-8（C3 41） |
| root-not-compound.png | bad_nbt | 根标签是字符串，不是 compound |
| huge-array-length.png | bad_nbt | Data 声明长度 2,147,483,647，实际只有 2 字节（不能按声明长度预先分配） |
| huge-list-length.png | bad_nbt | BlockEntities 声明 2,147,483,647 个元素，实际一个也没有 |
| negative-array-length.png | bad_nbt | Data 的长度是 −1 |
| negative-list-count.png | bad_nbt | BlockEntities 的长度是 −1 |
| many-tags.png | too_large | 根 {l: [60,000,000 个空 compound]}：文件约 58 KB，解压后约 57 MiB（没超 64 MiB），标签太多 |
| tags-at-limit.png | bad_schematic | 根 {l: [2,097,150 个空 compound]}：标签正好 2,097,152 个，能读完 NBT，但没有 Version |
| tags-over-limit.png | too_large | 根 {l: [2,097,151 个空 compound]}：标签 2,097,153 个，多了 1 个 |
| version-2.schem | unsupported_version | Sponge 第 2 版的裸 .schem（根标签名字是 Schematic，Version 2） |
| no-blocks.png | bad_schematic | 没有 Blocks |
| data-length-wrong.png | bad_schematic | Data 里只有 1 格（应该有 2 格） |
| palette-missing-id.png | bad_schematic | Data 用了编号 2，调色板里没有 |
| palette-duplicate-id.png | bad_schematic | 调色板里 glass 和 dirt 都是编号 1 |
| be-duplicate-pos.png | bad_schematic | 两个方块实体都在 [1,0,0] |
| be-out-of-range.png | bad_schematic | 方块实体的 Pos 是 [2,0,0]，出界（Width 是 2） |
| width-zero.png | bad_schematic | Width 是 0 |
| width-not-short.png | bad_schematic | Width 是 int，不是 short |
| width-2000.png | too_large | Width 是 2000（每边上限 1024），Height = Length = 1 |
| varint-too-long.png | bad_schematic | Data 第 2 格的 varint 有 6 字节（80 80 80 80 80 00） |
| varint-too-big.png | bad_schematic | Data 第 2 格的 varint 是 FF FF FF FF 0F（大于 2³¹−1） |
