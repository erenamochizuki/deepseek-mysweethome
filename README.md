# 海边小屋 / 小鲸鱼之家

小鲸鱼主题的网页小屋 + Minecraft 模组，作者 **Moci**。

- `web/`：网页（源码在 `web/src/`，构建成单文件 HTML）
- `mod/`：Minecraft 模组（NeoForge 26.1.2）
- `docs/`：设计文档、格式说明、集成契约
- `fixtures/`、`haibian-test/`：测试用的场景与浏览器测试脚本

## 仓库与下载

- 仓库：https://github.com/erenamochizuki/deepseek-mysweethome
- 在线玩：https://erenamochizuki.github.io/deepseek-mysweethome/ （由 `release` 分支生成，只有编译好的页面）
- 成品下载：Releases 里的 `haibian-cabin-<日期>.zip`（不含源码）

## 下载 / 游玩

发布包在 Releases 里，**只包含编译好的页面，不含源码**：

- `haibian-cabin-v1.0.0.zip`：`home.html`、`cabin.html`、`studio.html` + 桥接脚本 + 说明文档
- 解压后双击 HTML 即可玩，推荐 Edge / Chrome

想对照源码、提反馈或自己改：直接看本仓库的 `web/src/`、`mod/src/`。

## 构建网页

```bash
cd web
node build.mjs --no-builtin-girl   # 可发布版：默认角色只有 v1 小鲸鱼
node build.mjs                     # 本机开发：assets/girl/ 下放了模型 zip 时会一起内嵌
```

产物在 `web/dist/`。

## 角色模型

- 默认角色是小鲸鱼在源码里（`web/src/20-girlv1*.js`），不需要额外文件。
- 支持导入YSM模型
  
## 发布

见 `docs/PUBLISHING.md`。

## 许可证

CC BY-NC-SA 4.0，见 `LICENSE.md`。
