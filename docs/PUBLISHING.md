# 发布流程（Git）

思路：**仓库里放源码（任何人都能对照、提反馈），Releases 里放编译好的包（不含源码）。**

- `main` 分支：源码（`web/`、`mod/`、`integration/`、`docs/`、测试、构建脚本）
- Releases 提供静态游玩 ZIP 和可用 Node.js 启动的服务端 ZIP；下载包只含发布资源和所需的运行模块。
- `release` 分支：只有发布包的内容（可直接当静态站托管，这个分支里也没有源码）；本仓库的 GitHub Pages 就指向它

托管在 GitHub：https://github.com/erenamochizuki/deepseek-mysweethome

## 1. 构建和打包

先使用 JDK 25 在 `mod/` 中运行 `./gradlew build`（Windows 用 `.\gradlew.bat build`）。然后在仓库根目录运行打包命令。

```bash
node 发布/package.mjs [--version v1.5.0] [--live <本机小屋的 web 目录>] [--build <已构建的目录>] [--date 20261118]
```

- 自己构建一份 `build-<日期>/`（`web/build.mjs --no-builtin-girl` 内嵌Twin 和 Loose 两款可爱小鲸鱼，并排除 `assets/girl/` 下本机可选的第三方模型），再打包。已经构建好的可以用 `--build` 指过去。
- 打包从仓库读取 `integration/web/` 的桥接和相册、默认鲸图、使用说明，以及 `mod/build/libs/` 中的模组。已有单独部署时，`--live <目录>` 或 `CABIN_LIVE` 可以覆盖同名文件。只有清单中列出的静态资源和说明会进入包。
- 产出 `发布/海边小屋-<日期>-<版本>-可发布/`：
  - 页面；
  - `cabin-bridge.*`、`cabin-gallery.*`、`manifest.json`；
  - `服务端/inventory-rules.mjs`：本机服务升级用，见 `docs/INVENTORY-V2.md`；
  - `说明/`：带上 INVENTORY-V2、CABIN-TOOLS-BRIDGE 和星座数据的上游许可原文 `d3-celestial-LICENSE.txt`。打包时也把许可文件的 SHA-256 记入 `manifest.json`；
  - `使用说明.md`：自动补上角色模型和这一版新玩法两节；
  - `发布说明.md`。
- `build-*/` 和打包产物都在 `.gitignore` 里，不进仓库。

## 从源码运行本地服务

在仓库根目录运行 `node web/build.mjs --no-builtin-girl`，然后运行 `node integration/server.mjs`，在浏览器打开 `http://127.0.0.1:5194/`。库存数据保存在已被 Git 忽略的 `integration/state/` 中，可通过 `CABIN_INVENTORY_DATA_DIR` 指定其他私有目录。连接自己的 SurfCore 服务时，用 `CABIN_CONSOLE_TOKEN_FILE` 指向已有的本机令牌文件。构建后可运行 `node --test haibian-test/inventory*.test.mjs haibian-test/cabin-behavior-proxy.test.mjs` 验证库存和代理。

## 2. 上传到 Releases

打包脚本同时生成静态包 `haibian-cabin-<版本>.zip` 和可直接启动的服务端包 `haibian-cabin-server-<版本>.zip`。在 GitHub 用对应 main 提交创建相同版本的标签和 Release，上传这两个文件。服务端包只包含运行所需的模块、页面和说明。解压后运行 `node integration/server.mjs`。
每版在上传前分别解压两个 ZIP，校验静态文件清单，并从解压出的服务端启动、迁移旧进度和导出测试存档。

## 3. 可选：静态站 / release 分支

```bash
git checkout --orphan release
# 把 发布/海边小屋-<日期>-<版本>-可发布/ 里的内容拷到仓库根目录（去掉 模型/ 里的第三方 zip）
git add -A && git commit -m "release: 2026-11-16"
git push origin release
```

然后在平台里把这分支设为 Pages 源即可（Gitee Pages / GitHub Pages）。

## 注意

- 发布包里**不要**放 `web/src`、`mod/src`、测试脚本。
- `模型/*.zip` 是第三方模型（ccci202），只在发布包 / Release 附件里分发，别提交进仓库。
- `manifest.json` 里的 `defaultModel` 应为 `builtin:blue-whale-maid-twin`，页面应内嵌 `characters/Blue-Whale-Maid-Twin.zip` 和 `characters/Blue-Whale-Maid-Loose.zip`，并排除 `girl/` 资源。
