# 发布流程（Git）

思路：**仓库里放源码（任何人都能对照、提反馈），Releases 里放编译好的包（不含源码）。**

- `main` 分支：源码（`web/`、`mod/`、`docs/`、测试、构建脚本）
- Releases：`海边小屋-<日期>-可发布.zip`，只有页面 / 桥接 / 模型 / 文档，**没有 `web/src`**
- `release` 分支：只有发布包的内容（可直接当静态站托管，这个分支里也没有源码）；本仓库的 GitHub Pages 就指向它

托管在 GitHub：https://github.com/erenamochizuki/deepseek-mysweethome

## 1. 构建 + 打包（一步）

```bash
node 发布/package.mjs [--version v1.1.0] [--live <本机小屋的 web 目录>] [--build <已构建的目录>] [--date 20261118]
```

- 自己构建一份 `build-<日期>/`（`web/build.mjs --no-builtin-girl`：页面里不内嵌 `assets/girl/`，默认角色只剩 v1 小鲸鱼），再打包。已经构建好的可以用 `--build` 指过去。
- 本机集成文件（`cabin-bridge.*`、`cabin-gallery.*`、`说明/`、`使用说明.md`、模组 jar）从本机小屋的 `web` 目录拿。不给 `--live` 时按顺序找：环境变量 `CABIN_LIVE` → 仓库旁边的 `deepseek-mysweethome-ext/haibian/web` → `D:/Dafeiyu/haibian/web`。换了机器、目录不一样，就用 `--live` 或 `CABIN_LIVE` 指一下。
- 产出 `发布/海边小屋-<日期>-可发布/`：
  - 页面；
  - `cabin-bridge.*`、`cabin-gallery.*`、`manifest.json`；
  - `服务端/inventory-rules.mjs`：本机服务升级用，见 `docs/INVENTORY-V2.md`；
  - `说明/`：带上 INVENTORY-V2 和 CABIN-TOOLS-BRIDGE；
  - `使用说明.md`：自动补上角色模型和这一版新玩法两节；
  - `发布说明.md`。
- `build-*/` 和打包产物都在 `.gitignore` 里，不进仓库。

## 2. 上传到 Releases

把 `发布/海边小屋-<日期>-可发布/` 压成 zip，在 Gitee / GitHub 的 Releases 里新建一个 tag（例 `v2026.11.16`）并上传它。
Release 里只放 zip 和发布说明，**不要**放源码包（平台自动生成的 Source code 是仓库源码，本来就可见，不用管）。

## 3. 可选：静态站 / release 分支

```bash
git checkout --orphan release
# 把 发布/海边小屋-<日期>-可发布/ 里的内容拷到仓库根目录（去掉 模型/ 里的第三方 zip）
git add -A && git commit -m "release: 2026-11-16"
git push origin release
```

然后在平台里把这分支设为 Pages 源即可（Gitee Pages / GitHub Pages）。

## 注意

- 发布包里**不要**放 `web/src`、`mod/src`、测试脚本。
- `模型/*.zip` 是第三方模型（ccci202），只在发布包 / Release 附件里分发，别提交进仓库。
- `manifest.json` 里的 `defaultModel` 应为 `v1`，页面不应内嵌 `girl/` 资源。