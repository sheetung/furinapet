# Furina Rig Standard v0.3

> 芙宁娜桌面宠物「2D 外观 + 3D 骨骼驱动」的 Blender → glTF → furinapet renderer 数据契约。
> 定位：**AI 桌宠 + 小模型控制 + 实时渲染 + 极致轻量**——骨骼服务于「大脑/小脑」架构，不是影视动画。
> 关联：`project.md` 第十一节（S 系列里程碑）、`docs/LMC.md`（七层架构）、分支 `feat/character-runtime-2d3d`（PR1–PR3）。
> 本规范是唯一数据契约；未经共识不得单侧变更。
> **v0.3（2026-09-04 冻结评审）**：新增 `motion_root` 动作根（AI 动作与场景移动解耦）；`face` 内删眉/眼睑/嘴骨，表情全部归 morph；新增 §7 `bone_tags.json` 神经控制接口；Hair 摆动归 Spring（rotation+translation）。

---

## 0. 设计原则

1. **情绪优先于肢体**：AI 层最常产出注视、眨眼、眉、嘴、转头——不是手指或物理衣料。骨骼预算按此分配。
2. **肢体只做桌宠需求**：点名、招手（2 段臂）、正反转身（spine 旋转）就够。不做脚趾、不做手指、不做每根发丝。
3. **物理交给 Spring/Damping，不交给 bone**：衣服摆、发尾、尾巴用弹簧/阻尼（secondary motion），占用零决策算力。
4. **脸 = 2D 层 + 3D 骨骼混合**：五官用 morph 低成本驱动，头部旋转用骨骼；不追 Whisper 级口型，用嘴形状态机。
5. **极致轻量**：目标 33 ± 3 根骨骼（Root/motion_root 2、Body+Spine+Neck 4、Head 1、Face/Eye 3、Hair 3、Ear/Tail 3、Arms 6、Coat/Skirt 2、Accessory 2≈27 常用）。眉/眼睑/嘴**不建骨**（见 §4，morph 承担）；超预算需双人 review。

---

## 1. 骨骼命名规范（Blender 内必须遵守）

命名决定运行时 code 映射，不得擅自改。

| 规则 | 约定 |
|---|---|
| 大小写 | `snake_case` 全小写下划线连接 |
| 左右 | 后缀 `_left` / `_right`（**不用** `L/R`，与现有 2D 资产 `arm_left.png` 等一致） |
| 面提 | 角色区前缀：`body` `head` `face` `hair` `eyes` `brow` `mouth` `ear` `tail` `coat` `skirt` `hat` `deco`；所在“导演”前缀 `forward` 不在此列 |
| 根 | `root`（世界定位）+ `motion_root`（动作根）——两个根，见下树 |
| JSON 标签 | `bone_tags.json` 神经控制接口，见 §7 |
| 菊花块（白名） | 任意裙摆/凹陷都算骨；无名不允 |

### 推荐骨骼树（27 常用 + 可扩展，上限 33±2）

```text
root                ← 世界定位 / 移动（walk / approach / dock / step——只动 position）
│
└── motion_root     ← AI / Reflex 动作根（recoil / 开心跳 / 回弹 / 点头——只动 rotation）
    │
    ├── body
    │   ├── spine
    │   │   ├── chest
    │   │   │   ├── neck
    │   │   │   │   └── head
    │   │   │   │       ├── face
    │   │   │   │       │   └── eye_left / eye_right   ← 仅空间朝向（见 §4，表情全走 morph）
    │   │   │   │       ├── hair_back
    │   │   │   │       ├── hair_side_left
    │   │   │   │       ├── hair_side_right
    │   │   │   │       ├── ear_left
    │   │   │   │       └── ear_right
    │   │   │   ├── arm_left ── arm_hand_left（可选）
    │   │   │   └── arm_right ── arm_hand_right（可选）
    │   │   ├── coat（Spring）
    │   │   └── skirt（Damping）
    │   ├── tail               (Spring 摆动，与现 2D 资产 `tail.png` 对齐)
    │   └── accessory_brooch   (刚体)
    │
    └── …（可选：hat / 装饰,挂 head/body）
```

> **motion_root 规则**：AI 与 Reflex 层只操作 `motion_root`（及子骨骼）的**旋转**；`root` 只做**平移**（场景移动、被拖走、dock）。走路 vs 开心跳动 vs 回弹互不冲突——一个走 `root.position`，其余走 `motion_root.rotation`。
>
> **Face 规则**：眉 / 眼睑 / 嘴 **不建 bone**（原版方案里的 `brow_*`、`eyelid_*`、`mouth` 全部删除）；表情由 morph 承担（§4）。`face` 下仅保留 `eye_left/right` 供视线/瞳孔空间朝向。

不建模：手指、脚趾、独立头发丝、衣物褶皱、foot 轴分离、每根尾毛。

### Rest Pose

- **A-pose**：两臂微下垂；掌心向内侧——缓解 IK 折叠与布料冲突；
- 轴向：**Y 上，Z 前（forward = -Z 内）**，与 glTF/Three.js 一致；1 unit = 1 m；
- `root` 与 `motion_root` 在 Rest 完全重合（同一原位），后者只叠加旋转；
- `root` 在原点 `(0,0,0)`；左右对称（Mirror weights 用 `-X`）。

---

## 2. Mesh 拆分规范

| 部件资产 | 说明 | 挂骨 |
|---|---|---|
| `body` | body+spine+chest 顶点，躯干权重 | `body` |
| `head` | 头部、头发顶点 | `head` |
| `face` | 眼白/眉/嘴顶点，**morph 所在**（见 §4） | `face` |
| `eyes` | 瞳仁 + 眼白（或由材质 + 贴图出） | `eye_*` |
| `hair` | 发梢（可分成 back/left/right） | `hair_*` |
| `coat` / `skirt` | 见 §3 权重，挂 `chest` / `body` | `coat` / `skirt` |
| `decoration` | 帽子、别针等刚体 | `accessory` |

**材质槽位 1:1**：`Material_Face` / `Material_Hair` / `Material_Outfit`；不允许一张 atlas 串多骨。glTF 2.0 binary（.glb）导出，源文件分 `.skeleton.json/.anim.json` 供 runtime 校验 / Debug。

---

## 3. Weight Paint 规范

| 部位 | 权重 |
|---|---|
| 躯干 | `chest` 主、`spine` 尾（各 ≤3 骨/顶点） |
| 颈/肩 | neck: chest 0.2/neck 0.8；shoulder: chest 0.4/shoulder 0.6 |
| 头发 | `hair_*` **100% 附着本骨**（不发梢加第二骨）——摆动/回弹全部由 Spring 的 rotation + translation 承担（§1/§4），骨帧保持 Rest |
| 四肢 | `arm` 0.7 / `shoulder` 0.3 过渡，无第三 bone |
| 耳朵/尾巴 | `ear`、`tail` 100% 单骨（软尾可 spring 处理，权重固定） |
| 刚体 | 100% 单骨（`accessory_brooch` 即 `accessory`） |
| 全局 | **每顶点 ≤4 骨**（glTF 上限）；零权重顶点可能与矫枉过正相关——删除孤立顶点/清零权重顶点 |

---

## 4. Morph 目标（Blend Shapes）

- 只允许 `face` 相关 mesh 用 morph：`eye_open/eye_close`、`brow_raise/wipe`、`mouth_neutral/smile/open/anger/surprise`，总计 ≤ 10 个；
- morph 基座 Index≤3000（性能）；重量运行时 **ExpressionController（计划在 PR3 新增）** 插值；
- 分工（硬规则）：**bone 只负责空间变化**（眼球朝向、转头、Roll）；**眉、眼睑、嘴一律不建 bone**，表情全部由 morph 驱动——与 §1 骨树一致（原 `brow_*` / `eyelid_*` / `mouth` 骨删除）。

---

## 5. glTF 导入 / 导出规范

| 项 | 规范 |
|---|---|
| 格式 | glTF 2.0 **binary（.glb）**；追加 `furina.skeleton.json`（骨层级+Rest）、`furina.animations.json`（默认循环：idle/recoil/wave/blink 预烘） |
| 顶点 | 兼容 glTF（4 slots）；不使用 bisMesh 面貌（Unlit/flow 标记需要用电） |
| 纹理 | RGBA PNG，打组；纹理放 `characters/furina/model/textures/` |
| 轴向 | Y-up / Z-forward，scale 1（运行时 sprite 窗口缩放在渲染层处理） |
| 校验 | 导出后跑 `gltf_validator`：权重 [0,1]、骨名合法、morph 数 ≤10；不通过不出包 |
| 命名 | 所有骨名必须命中 §1 树；**不在树上的儿命名后台则删** |

---

## 6. furinapet renderer 接口契约（运行时 API）

现状（`furinapet-neuro` 已存在，作为基线）：

- `MotionBackend`（`src/neuro/motion/motion-backend.ts`）：`name` / `resolveMotorPlan(plan): ReactionDirective | null` / `update(dt)` / `dispose()`；
- `SkeletalMotionBackend`（`skeletal-motion-backend.ts`）：当前由 `primitiveToAnimation` + `AnimationPlayer` 驱动（primitive → 预烘 clip 播放），Pose 由 `player.getCurrentPose()` 读；
- `SkeletonRenderer`（`skeleton-renderer.ts`）：THREE.OrthographicCamera + WebGLRenderer，`loadSkeleton` / `update(skeleton)` / `render()` / `startLoop` / `dispose`，`boneMeshes: Map<name, Mesh>`；
- 高级动画数学（`advanced-animation.ts`）：`solveTwoBoneIK` / `solveLookAt` / Spring 已就位；
- 资产：`src/assets/skeleton-parts/*.png`（12 部件单张透明 PNG：head/body/arm/leg/ear/tail/mouth + eye 部分）。

PR3 目标（新增在 `SkeletalMotionBackend` Apprimand上）。

```ts
// 骨骼资产契约（PR2 输出，PR3 读取）
interface SkeletonAsset {
  bones: BoneConfig[];                    // { name, parent, position, rotation }：复用 skeleton.ts `BoneConfig`
  mesh?: THREE.Group;                     // glb 网格（挂骨后由 SkeletonRenderer 渲染）
  weights?: Record<string, Record<string, number>>; // vertexName → boneWeight 可选冗余
  boneTags?: Record<string, BoneControl>; // §7：骨名 → control 标签（神经控制接口，PR3 必读）
}

// 现有 MotionBackend 接口不变；PR3 让 SkeletalMotionBackend：
//   update(dt) = pose 目标 → IK/Spring → skinning → renderer.setPose(...)
```

### MotorPrimitive ↔ 骨骼（13 原语——与 `motor-plan.ts` 字符串一致，个别语义可空实现）

| 原语 | 骨骼动作 |
|---|---|
| `lookAt` | `head` Y 旋转朝向 + `eye_left/right` 瞳孔偏移；`neck` 微随（现有 solveLookAt） |
| `lookAway` | 反向偏移，`head` 微偏 |
| `recoil` | `body→spine` 后仰，`head` 反向前倾（一次弹簧回弹） |
| `lean` (left/right/forward/back) | `spine` 局部旋转 + `root` 中心线微移 |
| `turn` (left/right) | `spine`/`body` Y 轴旋转（正反转身） |
| `step` (left/right) | 腿部小位移（桌宠不做 walk cycle，微错步） |
| `approach` | `root` 位移逼近 target + `head` 朝向 |
| `retreat` | `root` 位移退避 |
| `earPose` | `ear_left/right` 旋转（竖/平/后——资产已有 ear 部件） |
| `tailMotion` | `tail` 摆动（Spring 模拟：still/sway/flick/wag） |
| `expression` | morph 权重（§4，ExpressionType 6 态：neutral/happy/sad/annoyed/surprised/tired） |
| `gesture`（wave/cheer/deny/point） | `arm_{side}` + `armhand_{side}` TwoBone IK（solveTwoBoneIK） |
| `idleStyle`（normal/sleepy/alert/sulk） | 姿态基准：呼吸幅度、注视/低头倾向、Spring 期望 |

> 当前 `SkeletalMotionBackend` 已按 legacy 优先级扫描（recoil>gesture>expression>idleStyle>turn>lookAt/lookAway>lean>…）命中 prim 后播 clip；PR1 目标把它改为**bone-target 直接求解**，但 `reaction.type === "skeletal"` 契约不变，`ResolveOrder` 不变，legacy 后端继续做回退。

### 情绪态 → 骨架签名

| 情绪 | 输出签名 |
|---|---|
| idle | head ±2°、spine ±1°、spring 自由 |
| happy | head 抬起 + body 正弦间距（hair/tail 甩动 via spring） |
| 傲娇 | head 偏左 5°、eye pupil 左 low（lookAway）、arm 交叉（IK 让臂交汇） |
| 恐慌/游离 | 眨眼变频（blink schedule 加快）、head 低垂、视线飘移、mouth 微开 |
| sleepy | eyelid morph 降幅、head 重力下垂（spring 低 stiff） |

---

## 8. 资源目录（新模型协议）

```text
characters/furina/                    # module = 一个可替换的角色包
├── character.json                    # 原字符定义；新增可选:
│                                     #   runtime: { type: "spritesheet" | "mesh-skeleton", asset: "model/", requires?: ["webgl2"] }
├── model/
│   ├── furina.mesh.glb              # 网格 + 骨树（权重内含）
│   ├── furina.skeleton.json         # bone 层级 + rest pose（校验/ Debug 冗余）
│   ├── furina.animations.json       # 预烘 loop clips（idle/wave/recoil/blink）
│   ├── textures/                    # RGBA PNG：face/body/outfit/hair
│   └── materials/                   # (可选) 材质 / 混合
└── spritesheet.webp               # v2 旧协议，保留为自动回退
```

**兼容规则**：`character.json` 无 `runtime.mesh-skeleton` 或 GPU 探测失败 → 回退 `spritesheet`。二者签名（`reaction.type`）相同，UI/switching 零侵入。

---

## 9. PR 拆分与验收（分支 `feat/character-runtime-2d3d`）

| PR | 内容 | 验收 |
|---|---|---|
| **PR1 · Skeleton Runtime**（无资产依赖） | 在现有 skeleton.ts/backend 之上：补 bone-target `Pose`+`PoseResolver`，把 §6 映射表全实现（IK/Spring/blink 已有），demo 用任意盒子+圆柱（不绑芙宁娜） | 测试全绿；CPU 纯计算 ≤ 2ms/帧（无 GPU 软路径）；`resolveMotorPlan` 契约不变 |
| **PR2 · Furina Rig 产出** | 按本规范 §1–§5 制作 Blender 资产，`gltf_validator` 过检，落入 `characters/furina/model/` | 骨数 33±2、morph ≤10、权 [0,1]、`furina.skeleton.json` 与资产一致；`character.json` runtime mesh-skeleton 生效 |
| **PR3 · Renderer 接入** | pet 窗口 p 渲染（Three.js/WebGL2），`update(dt)` 接 `SkeletalMotionBackend`+`ExpressionController`+Spring；pr2 资产替换 demo 骨架 | 3 种即时指令链路所见；spritesheet 不删（可切回）；内存/帧率达标 |
| PR4（可选） | 资产 bundle 压缩 / WebGPU（WebView2 支持后） / 多角色探针 | — |

GPU 策略：先 **Three.js（WebGL2）**——`SkeletonRenderer` 已是 WebGL，WebView2 成熟路线；**WebGPU 列为远期**（Tauri/WebView2 支持未稳，不赌）。

---

## 10. 后续与边界

- **不要做**：细节骨骼（手指/脚趾）、Whisper 唇形（先状态机）、替换 legacy（合并前保留）。
- **AI 依赖稳定接口**：13 原语映射表为闭环契约（prim → 表现）；PR1/PR2 不得吞并原语语义。
- **地址引用**：project.md 第十一节 S4 后追加 **S5（Rig 标准/资源路径）⬜＝等待 PR2 产出**，本文件作为 S5 正式输入。