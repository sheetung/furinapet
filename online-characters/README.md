# Online characters

这里的角色会保存在 GitHub 工程中，但不会被默认打包进 furinapet 安装程序。

每个角色使用 `online-characters/<id>/` 目录，并包含：

- `character.json`
- `avatar.png`
- `thumbnail.png`
- `spritesheet.webp`（v2：1536 × 2288）

角色图集的 16 向视线默认按顺时针排列。如果素材的左右方向相反，可在 `character.json` 中设置：

```json
"lookDirectionOrder": "counterclockwise"
```

添加完成后，把角色目录名写入 `catalog.json` 的 `characters` 数组。应用的“在线安装”页面会从 GitHub 读取清单并下载安装到本机。
