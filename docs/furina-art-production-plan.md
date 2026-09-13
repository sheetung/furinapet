# Furina Art Production Plan v0.1

> **2026-09-13：暂停推进。** 用户认为当前迭代混乱、美术效果不满意，现保留实验成果，
> 不以测试通过替代视觉验收。S5、最终角色美术与全动作验收均未完成。
> 本文以下为历史计划和过程记录；最新状态统一见 [实验分支归档说明](art-pipeline-snapshot.md)。

## Goal

Create a lightweight AI desktop pet asset: 2D visual style + 3D skeletal driving + real-time rendering.

The asset is optimized for interaction, expression and low latency, not cinematic animation.

## Pipeline

```
Concept art
  -> PSD layer separation
  -> Blender mesh preparation
  -> Skeleton rig
  -> Weight paint
  -> Morph expressions
  -> glTF export
  -> furinapet renderer
```

## Asset layers

```
body
head
face
eyes
hair
clothes
accessory
```

## Production stages

### M0 White Model

Deliver:
- mesh
- skeleton
- skin weights
- glTF loading test

### M1 Interactive Character

Add:
- lookAt
- blink
- basic expressions
- simple gestures

### M2 Final Asset

Add:
- refined textures
- accessories
- spring motion tuning

## Avoid

Do not create:
- finger bones
- toe bones
- individual hair strand bones
- complex cloth simulation

Use morph, spring and damping instead.

## Delivery

```
characters/furina/model/
  furina.mesh.glb
  furina.skeleton.json
  furina.animations.json

characters/furina/textures/
```

## 当前进度（2026-09-07）

2026-09-09 骨骼动作更新（最新）：候选增加膝骨至 21 骨，腿部重新分配渐变权重；walk/jump/cheer/think 已写入 Blender 和 GLB，共 8 段动画。运行时用真实骨骼轨道替换展示层起伏，并加入受限阻尼跟随、关节限幅。324 项测试通过；需继续完整 IK/足底锁定、全范围美术和新版原生验证。旧 19 骨/4 动画计数及整体起伏方案为历史。

2026-09-09 外观一致性更新（最新）：用户人工确认拖动位移正常。已修复待机 GLB/运动 sprite 混用：GLB 加载成功后保持同一身体，缺失能力仅降级动作并记录，故障才回退旧图。补基础程序化跳跃、跑动起伏与思考倾斜；323 项测试通过。程序动画不是最终美术/完整 IK，S5 仍未全部完成。

2026-09-09 复测更新：旧实例已按授权停止，新版已运行。自动化拖动未获位移证据；双击应验收感知层惊吓反射（不是必出气泡），本次工具只触发普通点击记录。等待用户手动复核，避免继续推测性改动；带气泡拖动仍待验收。

2026-09-09 更新：含拖动修复的 GLB 原生调试版已构建成功。检测到用户正在运行 D:\furinapet 下的另一实例，为避免覆盖共享通信发现文件，暂未启动复测；等待退出旧实例或停止授权。

2026-09-08 更新：已实现拖动阈值与点击分离、移除原生拖动前的异步布局等待，补齐释放/取消/多指针测试。320 项 / 25 文件及构建通过；下一步重建原生调试版验证拖动位移、双击及带气泡拖动。代码修复不等于原生验收通过。

原生抽样（最新）：Tauri debug 内嵌 GLB 构建/启动成功，候选显示、控制中心挥手和短气泡、隐藏恢复已确认。拖动与双击尚未通过；下一步诊断 pointerdown/native drag/双击时序，复核后再推进剩余动作约束。详见 [S5 原生验收](s5-native-acceptance.md)。美术精修继续后置。

S5 稳定性推进（最新）：修复重复取消、表情残留、隐藏/停帧后的到期计时、上下文丢失与异步加载竞争以及共享骨架释放。显式表情覆盖 idleStyle；未实现的前后 lean 明确走 legacy。316 项 / 24 文件测试及前端构建通过；Rust `cargo test --locked` 编译/链接通过（0 个 Rust 测试，非原生交互验收）。下一技术验收项仍为 Tauri/WebView2 实际窗口交互、剩余动作/约束能力；最终美术暂缓。

最新验证补记：测试增至 **311 项 / 24 文件**（含原生 CSP 防回归），前端构建与 Rust `cargo check --locked` 通过；浏览器确认不支持动作回退及取消后恢复。下述 310 项为加入 CSP 检查前的阶段结果。

**优先级更新**：按用户要求将最终美术精修后置，先完成框架和项目对接。已接通脑/反射 MotorPlan → GLB 身体 → PetView 的可选链路及失败/不支持动作回退；310 项测试、构建及浏览器共用组件加载/失败回退验证通过。默认 spritesheet 不变。原生端到端、剩余动作能力和最终美术验收仍待完成，详见 `docs/rigged-runtime-integration.md`。

### 第二轮修整（最新，覆盖下方首轮候选数量及缺陷状态）

- imagegen 补绘双臂，保留原 RGBA 候选；衣摆网格裁去误包含的袖子区域。当前挥手采样帧已不见先前的悬空袖子残片，完整动作范围仍待验收。
- 新增左右独立眼睛与眼睑网格；眼部底肤仅采样补绘图内部区域，头发/帽子仍用原图。闭眼不再变形刘海，浏览器已确认闭眼效果。
- 目前为 **13 个 glTF 网格、19 骨、6,350 顶点**；Three.js 因头部双材质拆为 14 个 SkinnedMesh。仍是 4 段动画、5 个形态名称，blink 合并驱动所有眼部网格。
- 校验新增头发不受 blink 位移、眼睛/眼睑动画通道完整性规则；Khronos 0 错误、0 警告，契约检查通过。304 项代码测试和构建通过。
- 预览页的正弦摆动已替换为现有 `updateSpring` 弹簧阻尼积分，加入“轻推衣摆”、子步长和幅度限制；这不等于全范围物理/碰撞验收。
- 最新渲染在 `characters/furina/model/qa/refined/`，生成来源与完整提示词在 `characters/furina/source-art/refinement-prompts.md`。
- 剩余：眼部贴合边缘/表情美感精修，嘴部与眉毛独立控制，完整动作/弹簧视觉验收，最终 JSON 契约同步及 S5 接入。`productionReady` 仍为 false。

### 首轮链路打通记录（历史快照）

状态：**Blender → 蒙皮 GLB → 实际加载链路已打通；美术仍为候选版，PR2 / S5 未完成。**
本节替代此前“缺少 Blender、蒙皮和动画”的阶段性记录，不改变原定交付标准。

### 已完成

- 使用本机 Blender 5.1.1 生成可编辑工程 `characters/furina/model/furina.blend`，纹理已打包。
- 导出独立候选 `characters/furina/model/furina.skinned.glb`：1 个 skin、19 根骨骼、9 个蒙皮网格、4,548 个顶点。
- 写入真实动画轨道：`idle`、`wave`、`recoil`、`blink`。
- 写入 5 个面部形态键试作：`happy`、`surprised`、`annoyed`、`tired`、`blink`；neutral 为基础形态。形态键存在不代表表情美术验收通过。
- 修复形态键默认叠加、挥手旋转轴错误，以及蒙皮网格非根节点导出警告。
- 新增 `/skinned-art.html` 开发验收页，通过 Three.js GLTFLoader / AnimationMixer 加载真实 GLB，支持动画、表情强度、摆动测试及背景切换。
- 提供可复现脚本 `scripts/build-furina-blender.py`、`scripts/validate-furina-skinned.mjs`。

### 验证结果与证据

- Khronos 校验：**0 错误、0 警告**，另有 9 条非二次幂纹理尺寸提示。报告：`characters/furina/model/qa/khronos-validation.json`。
- 候选摘要及 SHA-256：`characters/furina/model/qa/skinned-validation.json`，`productionReady: false`。
- 浏览器已验证实际加载、挥手控件和眨眼形态切换；记录：`characters/furina/model/qa/runtime-review.md`。
- Blender 中性、表情及动作渲染：`characters/furina/model/qa/skinned/`。
- 最近代码回归：23 个测试文件、304 项测试通过；TypeScript 与 Vite 构建通过。代码测试不替代美术验收。

### 下一步与验收缺口

1. 补绘手臂、肩部及遮挡区域，清除大幅挥手暴露的衣服/头发残片。
2. 独立拆分眼睛、眼睑与脸部，消除眨眼牵动刘海和眼角的问题；完善五种表情及眼睛朝向控制。
3. 复核动作幅度、关节遮挡及衣摆/后发弹簧。验收页当前仅为正弦摆动测试，不是弹簧物理或正式验收。
4. 美术通过后统一骨架/动画 JSON 与最终 `furina.mesh.glb`，补齐绑定当前文件哈希的生产验收证据。
5. 完成 S5 运行时切换及 legacy fallback 回归。

### 资产边界

旧 `furina.mesh.glb`、`furina.skeleton.json`、`furina.animations.json` 仍描述此前的无蒙皮切片原型，不能与新候选混用。候选应读取 GLB 内嵌 skin、动画和 morph 数据。
正式桌宠仍使用原 spritesheet，尚未接入新候选；未创建生产验收通过记录。
详细复现命令与视觉缺陷见 `characters/furina/model/PROTOTYPE-STATUS.md`。
