# 寄居蟹的换壳衣架

每个 `.bbmodel` 都是独立可编辑的 Blockbench 工程。打开单件时只有螺壳；网页构建时将其装在寄居蟹的 `body → shell_mount` 下。白玉螺与薄荷钟螺仍在[本体工程](../hermit_crab.bbmodel)内。

| 文件 | 原色造型 |
| --- | --- |
| `nassa.bbmodel` | 织纹螺：棕白交织的螺带 |
| `periwinkle.bbmodel` | 灰纹玉黍螺：短而偏斜的灰塔、栗色壳唇 |
| `wentletrap.bbmodel` | 梯纹螺：斜背的细塔、凸起的奶白壳肋 |
| `carrier_shell.bbmodel` | 负壳螺：宽而低的壳背，带粉、白、紫色碎贝片 |
| `violet_snail.bbmodel` | 紫罗兰浮螺：侧卷的紫色壳身、淡色唇缘 |
| `conch.bbmodel` | 女王凤凰螺：分节的肩瘤、粉色外翻唇 |
| `nautilus.bbmodel` | 鹦鹉螺：竖直盘卷的奶油色壳，外圈的锈红虎纹向卷心收细 |
| `sundial.bbmodel` | 日晷螺：扁宽的阶梯螺盘，焦糖与奶油棋格围着塔顶旋转 |
| `miter.bbmodel` | 笔螺：斜背的细尖塔，每一层都有一圈朱红短纹 |

根组命名为 `shell_<收藏品 ID>`，枢轴为 `[0, 3.45, 0.65]`；蟹脸朝 −Z。每个工程自带色板。添加品种时同步更新存档规则 `SHELL_LOANS`，运行 `web` 下的 `npm test` 检查壳组、花纹、洞口净空和借还。
