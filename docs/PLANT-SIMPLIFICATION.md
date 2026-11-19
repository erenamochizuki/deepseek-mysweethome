# 花草家具建模记录

## 2026-11-19：开花家具改用交叉贴片

随后选定 **B 款海铃陶篮**为默认吊篮：16 个元素，两簇铃花、一侧垂枝。下文的 14 元素四面垂枝款与旧对照图记录的是 A 款；A 款源模型保存在 `models/furniture-options/hanging_basket/woven.bbmodel`。

台阶花盆（28 → 4）、紫花箱与粉花箱（各 64 → 20）、门廊吊篮（32 → 14）、带花瓶的餐桌（31 → 21）改用双面交叉花簇。每簇两张平面共用中心，绕竖轴转 45°；花、叶和茎画在带透明留白的原创像素贴图上。花箱各有六簇，分属原来的两格；吊篮另有四面垂枝。陶盆、箱体、篮架和花瓶保留厚度。蕨类、落地绿植和多肉不在本次改动内。

源文件为 `models/furniture/` 中对应的 `.bbmodel`。从这些工程统一导出方块、物品、贴图及贴图的 `strict_cutout` 缩小采样设置；批量重建不会用旧体素覆盖这些手工模型。[同视角前后对照](flower-cross.jpg)。

## 历史：2026-11-09 否决简化，七模型回退

用户看图后不满意这一版简化，并明确授权撤回。七个模型已从改前完整副本逐字节恢复；当前每个单格模型为 32 个元素，两种花箱各为 64（每格 32），总计 288。简化版的盆体、花叶密度、图集及蕨叶透明化修改均不再生效。

回退先把被否决的七模型保存到 `tmp/plant-rollback-20261109/rejected/models/furniture/`，再恢复 `tmp/plant-simplification/before/models/furniture/` 中对应七个文件。逐字节相等及 SHA-256 对照见 [sha256-comparison.json](../tmp/plant-rollback-20261109/sha256-comparison.json)。原简化预览保留为历史，不能当作当前模型效果或用户认可。

当前 [plant-models.test.mjs](../web/test/plant-models.test.mjs) 检查恢复版元素数、UUID/outliner、正体积、原放置包围范围、嵌入图集和 UV、完整内存转换及每格不超过 32；不依赖临时目录副本。回退测试日志保存为 [plant-models.log](../tmp/plant-rollback-20261109/plant-models.log)。网页与 Mod 的资源导出和构建由 lead 统一执行，本回退任务未写入这些生成产物。

## 以下为已否决方案的历史记录

用户指出花盆下面的碎块没有增加信息，要求盆体和底座用几个完整长方体。此次把容器、植物和支架分开表达：平直连续的盆身、清楚的盆口、土面、花茎及有高低的叶层。32 是每格上限，不是需要用满的目标。

## 模型决定

| 模型 | 原元素 | 现元素（每格） | 造型理由 |
| --- | ---: | ---: | --- |
| [flower_pot](../models/furniture/flower_pot.bbmodel) | 32 | 19 | 底座、盆身、盆口、土面四块；三层叶和三朵高低不同的粉/奶白花，花心独立可读。 |
| [potted_fern](../models/furniture/potted_fern.bbmodel) | 32 | 26 | 同样四块容器；保留原来的蕨叶及透明缝，补一根接到土面的蕨心，避免叶簇悬空。 |
| [floor_plant](../models/furniture/floor_plant.bbmodel) | 32 | 25 | 四块陶盆替换杂乱盆片，原有枝干和叶层保留，保住高挑轮廓。 |
| [succulents](../models/furniture/succulents.bbmodel) | 32 | 17 | 保持一格两盆、大盆两簇小盆一簇；完整低盆配矮莲座，盆身不再由细条拼接。 |
| [flower_box_purple](../models/furniture/flower_box_purple.bbmodel) | 64（32/32） | 40（20/20） | 两格连续木箱，每格一主体、一盆口、一土面、一托架；每格三朵花有高低，叶和下垂枝分层。 |
| [flower_box_pink](../models/furniture/flower_box_pink.bbmodel) | 64（32/32） | 40（20/20） | 与紫花箱同结构，保持粉花配色；减少原来难以读清的花叶碎片。 |
| [hanging_basket](../models/furniture/hanging_basket.bbmodel) | 32 | 23 | 四块篮体露出完整轮廓；保留八组原下垂叶，两个花头、两层冠叶，立杆/横臂/吊链各自连续。 |

合计从 288 个元素降至 190 个。所有模型的格数、分格 group、原点和布局接口保持；新几何仍在原模型包围范围内。吊篮原先向负 Z 伸出的装饰仍保留，不增加占格。

第一轮曾把蕨叶和落地植物叶片也改为大长方体，四角度预览显示过于板状，因此恢复它们原有叶纹和叶形，只简化容器。蕨叶/落地叶/吊篮垂叶继续使用模型原本内嵌的项目纹理；新增盆、土、木、花瓣和叶脉为原创 128×32 像素色块图集，没有读取或打包 Mojang 素材。保留叶纹的三个模型另有原尺寸图集，UV 已换算到项目坐标。蕨叶旧图集里混烘的棕色盆沿/土色像素已透明化，避免旧盆碎片随叶层残留；绿色叶片保留。

## 验证和对比

运行 `node --test web/test/plant-models.test.mjs`：7 个模型测试通过。测试覆盖元素 UUID/outliner 完整性、正体积、原放置边界、有效 UV、四块盆体的高度衔接及不透明纹理、花心/莲座数量、保留叶纹、吊链连接、分格元素上限，以及每件模型的内存 MC 转换（无 warnings）。测试不写入 mod 资源或 dist。

预览使用项目 [renderPreview](../web/tools/lib/furn-mc-preview.mjs)，通过独立 Edge 页面在内存中转换模型，不启用 Blockbench headless renderer。每件有四个角度、网页光照与 MC 光照；浏览器 pageErrors/errors 均为空。

改前模型完整副本在 `tmp/plant-simplification/before/models/furniture/`；改前/后原始图分别在 `tmp/plant-simplification/before/shots/`、`tmp/plant-simplification/after/shots/`。以下图每张上半为改前、下半为改后，相机和光照一致：

- [小花盆对比](../tmp/plant-simplification/compare/flower_pot.png)
- [蕨盆对比](../tmp/plant-simplification/compare/potted_fern.png)
- [落地植物对比](../tmp/plant-simplification/compare/floor_plant.png)
- [多肉对比](../tmp/plant-simplification/compare/succulents.png)
- [紫花箱对比](../tmp/plant-simplification/compare/flower_box_purple.png)
- [粉花箱对比](../tmp/plant-simplification/compare/flower_box_pink.png)
- [吊篮对比](../tmp/plant-simplification/compare/hanging_basket.png)

测试日志为 [test.log](../tmp/plant-simplification/test.log)。临时对比图不是发布资源；模型通过后由 lead 统一导出、构建和整合验收。本任务未生成 mod 资源、未修改共享 dist、未启动 MC、未提交 Git。花箱花朵数量和小花盆密度有意降低，属于新的审美选择，最终听取用户看图反馈。
