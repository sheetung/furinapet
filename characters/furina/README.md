# 芙宁娜角色资源

本目录是内置芙宁娜资源的统一入口。

| 路径 | 用途 |
| --- | --- |
| character.json | 桌面角色清单与行为参数 |
| avatar.png / thumbnail.png | 角色头像与缩略图 |
| spritesheet.webp | 桌宠基础v2图集 |
| animations/ | 已接入动作图片；地面坐姿使用sitting-stool-v2.png，窗口坐姿使用dock-sitting-v1.png；drafts中的其余五组素材仍被运行时引用 |
| art.ts / clips.ts | 裁切锚点、帧序列、时长和停顿定义 |
| icons/ | 应用界面图标及Windows/macOS打包图标 |
| codex/ | 可独立导入的Codex v2宠物包、验证记录及图集副本 |
| source/motion-refresh/ | 本地美术制作源图与预览，原pet-runs输出，未纳入Git |
| model/ | 本地暂停的模型实验，未纳入Git或运行时 |

修改基础图集时同步codex/spritesheet.webp，CI会验证两份图集一致。保留该副本是为了独立分发Codex包。

通用加载/兼容逻辑仍在src/characters；其他角色的线上示例及历史制作资料不属于芙宁娜，本次未删除。制作源文件和模型不会因移动目录而自动进入构建。
