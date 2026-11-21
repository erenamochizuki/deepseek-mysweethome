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

[海滩标本图鉴：全套模型前后对比和新增 16 件掉落物](docs/tide-atlas/README.md)

[海边邻居试玩指南：蟹洞礼物、寄居蟹换壳、65 种收藏、积雪与浅海鱼缸](docs/BEACH-NEIGHBORS.md)（含可编辑的 Blockbench 源模型）

[驮岛鱼六阶成长对照](docs/tide-atlas/islet-growth.png) · [十件海滩新收藏实物图](docs/tide-atlas/shore-ten.png)

[小屋海域鱼谱：32 种浅海鱼、1 位海豚访客、10 种远礁鱼与 7 款异色](docs/fish-folio.png)

[小屋鲜果摊：六款新水果的整盒、单份与售价](docs/fruit-stall.png)

[海边小店完整菜单：四个货架各八款，附补货清单和价签](docs/SHOP-MENU.md)

## 合并前测试

在 `web/` 下用 Node.js 24 运行 `npm ci`、`npm test`。默认检查 API、角色行为、自主活动时长、零食事件、风铃与螃蟹路线，以及海边邻居、收藏、积雪、泳区与鱼缸。不需要启动浏览器；没有第三方角色包时，行为测试用仓库自带的测试骨架执行相同断言，不会整组跳过。另可用 `npm run test:shore-browser` 做实际页面的冒烟测试。

目标为 `main` 的 PR 和合并队列都运行 [Web tests](.github/workflows/web-tests.yml)。如需阻止红灯合并，管理员在首次运行后，将 GitHub Actions 的 `web-tests` 添加为 `main` 规则中的必需状态检查；工作流本身不会修改远端分支保护。

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
