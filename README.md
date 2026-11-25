# 海边小屋 / 小鲸鱼之家

小鲸鱼主题的网页小屋 + Minecraft 模组，作者 **Moci**。

- `web/`：网页（源码在 `web/src/`，构建成单文件 HTML）
- `mod/`：Minecraft 模组（NeoForge 26.1.2）
- `integration/`：本机小屋服务、库存、桥接和相册
- `docs/`：设计文档、格式说明、集成契约
- `fixtures/`、`haibian-test/`：测试用的场景与浏览器测试脚本

在本机小屋里，点一楼厨房旁的绿色食谱台可以翻看、搜索和编辑食谱，也可以点「＋ 记一道菜」写下菜名、食材和做法。接入配套 SurfCore 后，她在 QQ 主人私聊中学会的菜也会记在这里。两端共用小屋服务的 `state/cabin-recipes.sqlite`，首次打开是空本。相同菜名或相同食材与做法会指向已有食谱。

## 仓库与下载

- 仓库：https://github.com/erenamochizuki/deepseek-mysweethome
- 在线玩：https://erenamochizuki.github.io/deepseek-mysweethome/ （由 `release` 分支生成，只有编译好的页面）
- 成品下载：[最新发布版](https://github.com/erenamochizuki/deepseek-mysweethome/releases/latest)

## 下载 / 游玩

发布包在 Releases 里，**只包含编译好的页面，不含源码**：

- 下载发布附件 `haibian-cabin-<版本号>.zip`，里面有 `home.html`、`cabin.html`、`studio.html`、桥接脚本和使用说明。
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

运行 haibian-test 里的浏览器测试时，请先在仓库根目录运行 `npm ci`，安装 Edge，并用 `node web/build.mjs` 构建页面。跨项目的 cabin-upgrade-browser 测试可用 SURFCORE_ROOT 指向配套的 SurfCore 源码目录。

目标为 `main` 的 PR 和合并队列都运行 [Web tests](.github/workflows/web-tests.yml)。如需阻止红灯合并，管理员在首次运行后，将 GitHub Actions 的 `web-tests` 添加为 `main` 规则中的必需状态检查；工作流本身不会修改远端分支保护。

## 构建网页

```bash
cd web
node build.mjs --no-builtin-girl   # 可发布版：内置Twin 和 Loose 两款小鲸鱼
node build.mjs                     # 本机开发：assets/girl/ 下放了模型 zip 时会一起内嵌
```

产物在 `web/dist/`。

## 角色模型

- 内置 Moci 的两款「可爱小鲸鱼」，默认显示 Twin（低双马尾），可在设置 →「角色」里切换 Loose（散发）。两个原包都内嵌在页面里，离线也能切换。
- 旧存档里选过已移除角色的会自动使用 Twin，自己导入的角色仍然可用。
- 支持导入YSM模型
  
## 发布

见 `docs/PUBLISHING.md`。

## 许可证

CC BY-NC-SA 4.0，见 `LICENSE.md`。
