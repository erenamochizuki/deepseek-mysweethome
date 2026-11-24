# 老浏览器兼容：`DecompressionStream('deflate-raw')`（2026-11-09）

## 现象

在小屋页面里提示：

```
这个角色用不了，先换回 v1 小鲸鱼：Failed to construct 'DecompressionStream':
Unsupported compression format: 'deflate-raw'
```

默认角色「蓝色大肥鱼」用不了，退回 v1 小鲸鱼。

## 根因

- 当时的默认角色模型是 `assets/girl/fatfish-1.2.zip`（构建时内联成 `window.__V3_ASSETS`），zip 里 25 个条目是 deflate 压缩；
- `web/src/10-zip.js` 原来只用 `new DecompressionStream('deflate-raw')` 解压；
- 这台机器上的 Edge 是 `100.0.1185.36`（2022 年版本），**不支持** `deflate-raw`（只有 `gzip` / `deflate`），于是报错。

同样的问题也影响 `web/src/14-mcjar.js`（读玩家的 MC jar 时解压 deflate 条目）和玩家自己导入的 YSM zip。

## 修法

在 `10-zip.js` 里加了一个纯 JS 的 raw-deflate 解压器 `V3.zip.inflateRawJS`（canonical Huffman，参考 tinf/puff）：

- `inflate()` 先试浏览器原生 `DecompressionStream('deflate-raw')`，失败（老浏览器）自动退回 JS 实现；
- `14-mcjar.js` 的 `streamInflate()` 同样：`deflate-raw` 退回 `V3.zip.inflateRawJS`；`deflate`（zlib 头 + adler 尾）去掉 2 字节头再按 raw 解；
- 页面构建产物（`web/dist/home.html`、`cabin.html`、`studio.html`）已用修好的源码重新构建；成品包（`ready/`、`haibian-v4-ready/`）里的三个 html 和 manifest 哈希同步更新。

## 验证

```bash
cd web
node test/zip-fallback.test.mjs
```

覆盖：

1. 用当前默认模型包 `assets/characters/Blue-Whale-Maid-Twin.zip` 的全部 deflate 条目，逐个用 `V3.zip.inflateRawJS` 解压并与 Node `zlib.inflateRawSync` **逐字节比对**；
2. 抹掉 `window.DecompressionStream`（模拟老浏览器）后 `V3.zip.read` 整包读取，文件条数和内容与原生路径一致；
3. 原生路径（Node 的 `DecompressionStream` 支持时）也能正常读。

当时的浏览器实测（Edge 100）：页面能正常选到 `builtin:fatfish`、`preload` 成功、无报错提示、角色正常显示；重载后相册/挂画/照片都还在。

## 备注

- 根治仍是升级浏览器（Edge 100 太旧，其它现代 API 也可能踩坑）；JS 兜底是为了「分发出去的环境不可控」也能跑。
- 性能：纯 JS inflate 比原生慢，但只在老浏览器、且只在读模型/读 jar 时用；模型包首次读约几十毫秒级。
- 新增任何「用 `DecompressionStream` 解 deflate-raw」的地方，都要走 `V3.zip.inflateRawJS` 兜底，不要直接 new。
