# 动作层 Motion Stack

桌宠原本只有一张 8×11 的精灵图集：11 行动画 + 16 个注视方向，"看向鼠标"是把角度取整到
22.5° 再查表。这一层在不改动 Pet Brain 的前提下补上了骨骼驱动的下半部分。

```text
                        Furinapet
              ┌─────────────────┬─────────────────┐
              │                 │                 │
         大脑 Brain                        小脑 Cerebellum
      语言 / 感知 / 性格                动作决策 / 协调
      情绪 / 记忆 / 推理                姿态 / IK / 反应
              │                 │                 │
              └────────┬────────┴─────────────────┘
                       ▼
              Behavior Intent          docs/PET_BRAIN.md，本层不改动
                       ▼
              Motion Controller        src/motion/MotionController.ts
        ┌──────────────┼──────────────┐
    Aim IK        Two-Bone IK     Procedural
    头眼颈          手臂腿部        耳朵尾巴身体
        └──────────────┼──────────────┘
                       ▼
                  Joint Mixer          src/motion/JointMixer.ts
                       │
          Constraint + Spring/Damping  同上 + src/motion/limits.ts
                       ▼
                 Skeleton Pose         src/motion/rig/*
                       ▼
                   Renderer            src/render/PetStage3D.ts
```

## 分层与文件

| 阶段 | 实现 | 说明 |
| --- | --- | --- |
| Behavior Intent | `src/pet-brain/adapters/motion.ts` | 与 `adapters/reaction.ts` 平级：一个把语义动作映射成精灵行号，一个映射成小脑例程 |
| 小脑 Cerebellum | `src/motion/Cerebellum.ts` | 离散意图 → 连续目标（注视点、手部 IK 目标、呼吸、重心、活跃度、颓丧度） |
| Motion Controller | `src/motion/MotionController.ts` | 固定步长时钟 + 阶段顺序 |
| Aim IK | `src/motion/solvers/AimIK.ts` | 一次算出总偏航/俯仰，再按 chest 0.16 / neck 0.34 / head 0.5 分摊 |
| Two-Bone IK | `src/motion/solvers/TwoBoneIK.ts` | 解析解，无迭代 |
| Procedural | `src/motion/solvers/Procedural.ts` | 呼吸、重心偏移、上下浮动、耳朵尾巴摆动 |
| Joint Mixer | `src/motion/JointMixer.ts` | 加权四元数合成 + 关节限幅 + 弹簧阻尼 |
| 关节参数 | `src/motion/limits.ts` | 每根骨骼的 `maxSwing` / `stiffness` / `damping` |
| 骨架 | `src/motion/rig/VrmRig.ts`、`PrimitiveRig.ts` | 见下 |
| 渲染 | `src/render/PetStage3D.ts`、`src/PetCanvas.tsx` | WebGL、正交相机、帧率控制 |

## 三条硬约束

**一、Brain 不认识骨骼。** 它输出的仍然是 `PetSemanticAction`，7 个语义 goal 一个没加。
AI 建议的优先级上限 0.82 也没动。3D 后端只是在 `reaction.ts` 旁边多接了一个 adapter。

**二、只有 Joint Mixer 能写骨骼。** 三个求解器都要动 `chest` / `spine` / `head`：注视要转脖子，
呼吸要动胸腔，挥手会带上身。如果各自 `bone.quaternion.set(...)`，后跑的会静默覆盖先跑的，
结果是"呼吸把注视吃掉了"这类极难定位的问题。求解器只能往 mixer 里提交 `(骨骼, 四元数, 权重)`，
mixer 每帧统一解算一次：

```text
rest ──slerp(权重和)──> 各贡献的加权平均 ──限幅──> 弹簧阻尼 ──> bone.quaternion
```

权重和不足 1 时，剩下的部分留在 rest 上——所以求解器淡出时关节会自己回位，不需要谁去清理。
`JointMixer.test.ts` 里那条 "averages competing contributions instead of letting the last one win"
就是守这条不变量的：两个 ±30° 等权贡献必须回到 0°，而不是停在 -30°。

**三、时间步长固定。** `FIXED_STEP = 1/120`，最多 8 个子步，超了就丢掉积压。弹簧和振荡器
按固定步长积分，所以 30 fps 和 144 fps 下动作一致；掉一帧也不会把弹簧积分炸掉。
`vrm.update(delta)` 用真实 delta 调用，因为 SpringBone 需要真实时间。

## 顺序为什么是这样

`@pixiv/three-vrm` 的 `VRM.update()` 内部顺序是：

```text
humanoid → lookAt → expressions → nodeConstraint → springBone → materials
```

正好是图里下半段。所以我们的 mixer 必须在 `vrm.update()` **之前**跑完：SpringBone 消费的是
我们写完的姿态。`MotionController.update()` 里的顺序不能调。

`vrm.lookAt` 只驱动**眼球**骨骼或眼球表情，不碰头颈，所以它和 Aim IK 不冲突：
头/颈/胸由 `AimIK` 转，眼球交给 three-vrm。

## 两套骨架

`SkeletonRig` 是抽象接口，求解器不知道下面是什么。

- **`VrmRig`** 包 `@pixiv/three-vrm`。姿态写在**规范化骨骼**（`getNormalizedBoneNode`）上，
  不是原始骨骼——VRM 的原始 rest pose 每个模型都不一样，规范化之后才通用。
- **`PrimitiveRig`** 是不依赖任何资源的替身骨架：胶囊体拼的人形，骨骼名、偏移、rest 姿态
  都和 VRM 规范化骨骼一致。它让整条链路能在 Node 里跑单元测试，也让没有模型文件时
  桌宠还有东西可显示。

两者都在构造时量出真实的肩部位置和手臂长度（`rig/metrics.ts`）交给小脑。**不要**改回用
身高比例估算：写实模型的手臂约占身高 0.32，Q 版可能只有 0.22，用固定比例会让手部目标
越过可达范围，肘部就会在整个动作里锁成直的。

VRM 的 rest pose 几乎都是 T-pose，而 rest pose 正是"没人驱动时 mixer 回到的地方"。
`VrmRig.relaxArms()` 因此把手臂 rest 下放到体侧，并且只补**差值**——已经是 A-pose 的模型
几乎不动。少了这一步，桌宠只要不做手势就张着双臂站着。

## 已知边界

- **鼠标穿透还没做。** 现在 3D 画布是 `pointer-events: none`，拖拽走 `.pet-stage`
  整个窗口矩形，和精灵版一样。要做到按角色轮廓穿透，需要 `PetStage3D.hitTest()`
  （已实现）配合 Tauri 的 `setIgnoreCursorEvents`，而后者要在
  `src-tauri/capabilities/default.json` 里加 `core:window:allow-set-ignore-cursor-events`。
  本次没有改 Rust 侧。
- **腿部 IK 没有接入。** `TwoBoneIK` 已支持并有测试（`solves a leg chain`），
  但小脑还没有踩地/迈步例程，所以走路时只有手臂摆动和上下浮动。
- **表情没接。** `vrm.expressionManager` 可用，小脑还没有输出情绪通道到表情。

## 调试

```powershell
pnpm dev
# 打开 http://localhost:1420/motion-preview.html
```

`motion-preview.html` + `dev/motion-preview.ts` 是动作层的可视化工作台，不进入 Tauri 构建
（不是 Vite 的入口）。鼠标移到棋盘格上驱动 Aim IK，按钮切换意图，右侧实时显示意图、
注视角度、手部权重、超出可达范围的距离和子步数。

参数：

| 参数 | 说明 |
| --- | --- |
| `?rig=primitive\|vrm` | 选择骨架 |
| `?model=/models/pet.vrm` | VRM 路径 |
| `?reaction=waving` | 初始动作 |

桌宠窗口本身默认仍是精灵后端。切换方式：

```js
localStorage.setItem("furinapet.renderBackend", "primitive");  // 或 "vrm" / "sprite"
```

也可以用 `?rig=` 临时覆盖，不写入存储。

## 测试

```powershell
pnpm test
```

47 个测试覆盖 mixer 的加权合成与限幅、两骨 IK 的可达性/超限/极向/确定性、
Aim IK 的指向精度与分摊、小脑的帧率无关性与意图过期，以及整条流水线不产生
NaN、不越限、松手后回位。
