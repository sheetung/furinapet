# 美术与骨骼实验分支保存说明

日期：2026-09-13

分支：`feat/furina-art-pipeline`

结论：**暂停实验，保存成果；美术不满意，未通过正式验收，不合入 main。**

## 为什么暂停

迭代中叠加了旧精灵图、无蒙皮切片原型、蒙皮候选和运行时适配，文件与历史说明
逐渐混杂。当前角色比例、分层、关节遮挡和动作表现尚未形成满意的统一美术效果。
已有自动测试和导出校验仅证明部分技术链路可用，不表示角色制作完成。

## 保存了什么

| 内容 | 当前入口与状态 |
| --- | --- |
| 原版角色 | `characters/furina/spritesheet.webp`；保留作为默认显示及故障回退 |
| 可编辑候选 | `characters/furina/model/furina.blend`；纹理打包，21 骨、13 网格、6,350 顶点 |
| 蒙皮导出 | `furina.skinned.glb`；idle、wave、recoil、blink、walk、jump、cheer、think 共 8 动画，5 个 morph |
| 旧切片原型 | `furina.mesh.glb`、骨架/动画 JSON、puppet JSON；不是新蒙皮候选的统一契约，不能混用 |
| 生成来源 | `characters/furina/source-art/` 与 `model/textures/`；保留来源、提示词与修整过程 |
| 制作脚本 | `scripts/build-furina-blender.py`；Blender 建模/绑定/导出与抽样渲染 |
| 运行时 | `PetBody` / `RiggedPet` / `GlbBody` 与 MotorPlan 桥；可选 GLB，默认 sprite |
| 检查入口 | `skeletal-art.html` 为旧切片；`skinned-art.html` 为蒙皮预览；`rigged-integration.html` 为运行时组件测试 |

GLB 开启方式是 `renderer=rigged` 或构建时 `VITE_PET_RENDERER=rigged`。
成功加载后保持同一 GLB，未支持动作作局部降级；加载/渲染故障仍回退原 sprite。
当前步行/跳跃为骨骼 FK 动画，附有局部关节限幅和衣摆/头发阻尼跟随，**不是完整 IK**。

## 已验证与未完成

- 最近自动测试：324 项 / 25 文件通过；GLB 校验零错误、零警告；前端及原生 debug 构建通过。
- 用户手测确认拖动能移动到鼠标释放位置并播放开心跳，单击挥手。
- 最新骨骼版已启动抽样检查开心动作与短气泡；没有完成全动作原生验收。
- 尚缺完整 IK、脚底锁定、全帧变形/遮挡检查、最终美术定稿、统一资产契约及发布验收。
- `model/qa/` 含多轮历史检查图；`qa/refined/` 和最新校验 JSON 对应当前候选，其他图片不可当作当前结果。

## 主线边界

保存时已 fetch 确认 `origin/main` 为 `cccf510`（v1.1.2）。主线没有 `src/neuro`，
没有本次 GLB / 骨骼美术实验，但有早期 `src/pet-brain`、AI Adviser、Agent/插件功能。
切回主线只做快进同步，不合并本实验分支。恢复实验时显式切回本分支。

依赖缓存、`tmp/`、构建产物和 `.blend1` 本地备份不提交；工程、源码、候选资产与
过程图保留。历史计划继续归档，本说明是分支现状的首要入口。
