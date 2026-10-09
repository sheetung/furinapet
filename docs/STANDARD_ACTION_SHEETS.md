# 芙宁娜独立动作帧图

2026-10-09：按用户选择保留现有画面，统一文件规格、比例和基准点；未重绘素材。

## 文件与规格

运行时读取 `characters/furina/animations/standard/` 下28张PNG：27种动作各一张，16方向注视共用独立的 `gaze.png`。所有图片为透明RGBA、768×832，按4列×4行排列192×208单帧，未使用格保持透明。帧数见 `characters/furina/standard-sheets.ts`。

文件名就是动作名，例如 `idle.png`、`run-left.png`、`waiting.png`、`tea.png`。播放帧序列、时长、循环和结束规则仍由 `characters/furina/clips.ts` 定义，未在本轮调整。派生动作（眨眼、小憩、拖拽等）拥有独立文件，即使目前使用同一组源画面，后续也可单独替换。

比例及定位已烘焙进单帧，运行时以1倍显示，再统一应用用户设置的整体缩放。普通站姿以(96,200)为基准，窗口坐姿保留髋部158基准；跳跃、低头和坐下保留真实高度变化，不按每帧轮廓拉伸。

## 修改与重新导出

可以直接编辑对应动作PNG，保持画布、格子尺寸与帧顺序；修改动作播放顺序或停留时间则编辑 `clips.ts`。

源素材、旧v2图集均保留；旧图用于兼容回退及预览对照，正常内置动作不再从旧大图集取帧。`animations/source-frames.json` 记录此次迁移使用的源文件、裁切和比例。

安装有Pillow的Python环境可运行：

```powershell
python tools/build-furina-sheets.py
python tools/build-furina-sheets.py --check
```

第一条按迁移源重新生成PNG、帧数表和概览，会覆盖对标准PNG的直接编辑；保留手工编辑时不要运行它。第二条仅核对图片是否仍与迁移源一致，不会写文件。新的自绘帧无需继续匹配旧迁移源。

## 验证

139项前端测试通过，前端构建及差异检查通过；23张PNG逐像素导出校验通过。测试覆盖每动作独立文件、透明通道与固定尺寸、时间线到独立图片的映射、注视全方向、坐姿基准、跳跃高度和导入角色隔离。

开发预览：`http://localhost:1420/motion-preview.html`，可选择22种动作并逐帧查看，另有全部16个注视方向。概览图为 `docs/standard-action-sheets.png`。原生拖拽、重力及多DPI视觉验收未在此次迁移中实测。

浏览器实际选择全部22种动作，确认逐帧元素读取各自标准PNG、显示尺寸192×208且定位为(0,0)；16个注视方向确认映射到 `gaze.png` 的不同格子。可见区域截图保存为 `docs/standard-action-preview.png`。

后续新增breathing、nod、tea-enter、tea-sip、tea-exit五张图，详情及生成提示词见 `NEW_ACTION_BATCH.md`。源图、标准打包主图和配方均保留；28张逐像素校验、156项测试及前端构建通过。此节上方139项与23张校验是首次迁移时的历史结果。
