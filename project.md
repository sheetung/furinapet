# FurinaPet Neuro 工程记录

> 本文档记录 `furinapet-neuro` 分支上的「类人认知—运动架构」改造：目标、架构、里程碑与当前进度。
> 基线：`main` v1.1.2（`cccf510`）。架构总纲见 **《LMC》**（[`docs/LMC.md`](docs/LMC.md)）。

## 一、项目简介

FurinaPet 是 Windows 轻量芙宁娜桌宠（Tauri 2 + WebView2 + React，无重型渲染依赖）。
v1.1.2 已内置：

- **Pet Brain**（`src/pet-brain/`）：Blackboard → Utility Planner（7 个语义 goal）→ Executor → Reaction 固定映射；
- **AI Adviser v1**（`src-tauri/src/ai/`）：OpenAI-compatible Provider，只能从 7 个 goal 里选一个，优先级封顶 0.82；
- **Agent Bridge / MCP**（`agent_host.rs` / `mcp_server.rs`）：TCP 本地桥 + stdio MCP server；
- **插件系统**（`plugin_host.rs` + `src/plugins/`）：Worker 隔离、市场、`pet:behavior` 意图权限。

Neuro 改造在 Pet Brain 之上加一层**神经系统**，把「感知 → 认知 → 动作表达」拆成可替换的协议化管线，为后续接入 LLM 大脑（BrainIntent）与 FunctionGemma/蒸馏小脑（MotorNet）铺路。

## 二、目标架构

```text
┌─────────────────────────────────────────────────────────────┐
│                      外部环境 Environment                    │
│ 鼠标 / 点击 / 拖拽 / 用户语言 / 语音 / 屏幕 / 时间 / 窗口等 │
└──────────────────────────┬──────────────────────────────────
                           ↓
                 ┌──────────────────┐
                 │   Perception     │
                 │     感知层        │
                 │  PerceptionEvent │
                 │  WorldState      │
                 └────────┬─────────
                          ↓
                    World State
                          │
        ┌─────────────────┼─────────────────
        ↓                                   ↓
┌────────────────                  ┌────────────────┐
│     Brain      │                  │     Reflex     │
│      大脑       │                  │    脊髓反射     │
│                │                  │                │
│语言/情绪/记忆    │                  │点击/碰撞/极限    │
│人格/理解/目标    │                  │即时安全响应      │
│                │                  │                │
│ NeuroBrainIntent│                  │ MotorPlan      │
│ source: rule/ai │                  │ source: reflex │
└───────┬────────┘                  └───────┬────────┘
        │                                   │
        ↓                                   │
 Character Intent                           │
        │                                   │
        ↓                                   │
┌────────────────┐                          │
│   Cerebellum   │                          │
│      小脑       │                          │
│                │                          │
│动作策略/协调     │                          │
│Motor Primitive │                          │
│ 13 个原语       │                          │
└───────────────┘                          │
        │                                   │
        └────────────────┬──────────────────┘
                         ↓
                 ┌────────────────┐
                 │ Motion Engine  │
                 │    运动系统      │
                 │                │
                 │ IK / LookAt    │
                 │ Reach / Mixer  │
                 │ Procedural     │
                 └───────┬────────┘
                         ↓
                 ┌────────────────┐
                 │      Body      │
                 │     身体层      │
                 │                │
                 │ Joint Limit    │
                 │ Spring/Damping │
                 │ Skeleton       │
                 └───────┬────────┘
                         ↓
                 ┌────────────────┐
                 │    Renderer    │
                 │     渲染器      │
                 │                │
                 │ Sprite Atlas   │
                 │ (当前 v2 8×11) │
                 └────────────────┘
```

### 当前实现映射

| LMC 层 | 工程实现 | 状态 |
|--------|---------|------|
| Perception | `src/neuro/perception/`（reducer + store） | ✅ M1 |
| Brain | `src/neuro/brain/`（structured-brain）+ `src/pet-brain/`（legacy） | ✅ M5 |
| Reflex | `src/neuro/reflex/`（blink/startle/flinch/grip） | ✅ M4 |
| Cerebellum | `src/neuro/cerebellum/`（rule-cerebellum） | ✅ M3 |
| Motion Engine | `src/neuro/motion/`（legacy-sprite-backend） | ✅ M3（sprite 阶段隐式） |
| Body + Renderer | PetView + v2 sprite atlas | ✅ 既有 |
| Motion Engine（rigged） | IK / VRM rig / JointMixer |  M6+ |

核心原则（摘自《LMC》）：

- **越靠近身体越不用大模型**：实时层全部是数学/状态机/规则；
- **脊髓反射优先**：身体先反应，大脑后理解（Reflex 层后续加入）；
- **内部数据不传自然语言**：Typed State → Typed Intent → Typed Motor Command；
- **LLM 永远不跨过 L4/L5 直接碰 L6（关节数据）**。

## 三、里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| **M0** | Neuro Contracts v1（`src/neuro/contracts/`：L1–L5 五份契约 + 校验函数 + vitest） | ✅ 已提交 `df738fd` |
| **M1** | Perception Reducer（`WorldState` 累加器、指针采样 125ms、感知接线、补 dragStart/dragEnd sense） | ✅ 已提交 `160ba7b` |
| **M2** | CharacterState V1（确定性七维情绪、PetMood 兼容派生、快照扩展 + 情绪调试面板） | ✅ 已提交 `f8e0053` |
| **M3** | RuleCerebellum + LegacySpriteBackend + Neuro Trace（管线已接线，单测完成） | ✅ 已提交 `e1bd20a` |
| **M4** | Reflex 脊髓反射层（blink/startle/flinch/grip，reflex 优先于 brain pipeline） | ✅ 已提交 `a8d3bff` |
| **M5** | StructuredBrainProvider（AI → NeuroBrainIntent，OpenAI-compatible API，TS 直接调用）+ 契约增强（SocialIntent/BrainSource/MotorSource + JSON Schema） | ✅ 已提交 `d7e98f3` + `59e7ff1` |
| M6+ | FunctionGemma Shadow → 蒸馏 FurinaMotorNet → Rigged Body | ⬜（不在本轮） |

接入方式（已定）：**直接替换**——旧 `adapters/reaction.ts` 固定映射已被删除，`runtime.ts` 内联走 MotorPlan 路径（`synthesizeBrainIntent → planMotor → reactionForMotorPlan`）；等价性由逐条映射测试保证（`legacy-sprite-backend.test.ts` 23 条 ✅）。

## 四、目录结构（neuro 部分）

```text
src/neuro/
├─ contracts/            # 神经系统 ABI（schema v1）
│  ├─ perception-event.ts   # L1: click/drag/agentState/userIdle 等类型化事件
│  ├─ world-state.ts        # L2: pointer/interaction/agent/environment
│  ├─ character-state.ts    # L3: 七维 EmotionState + CharacterState
│  ├─ brain-intent.ts       # L4: NeuroBrainIntent + MotorTendency
│  ├─ motor-plan.ts         # L5: 13 个 MotorPrimitive + MotorPlan
│  ├─ index.ts              # barrel + NEURO_SCHEMA_VERSION
│  └─ contracts.test.ts     # 16 tests ✅
├─ perception/           # M1 ✅
│  ├─ perception-reducer.ts # 纯函数 reducer（事件 + 记忆 → WorldState）
│  ├─ store.ts              # pet 窗口单例 store + bootstrapNeuroPerception()（P0 修复静止采样门控）
│  ├─ perception-reducer.test.ts  # 9 tests ✅
│  └─ store.test.ts              # 3 tests ✅（dispatch 边界/arousal 回归守卫）
├─ character/            # M2 ✅
│  ├─ character-store.ts    # 确定性情绪累加器（observe + tick）
│  ├─ character-adapter.ts  # PetBlackboard + CharacterStore → CharacterState (L3)
│  └─ character-store.test.ts     # 12 tests ✅
─ reflex/               # M4 ✅（P1 起全标 source: "reflex"）
│  ├─ reflex.ts             # 脊髓反射弧（blink/startle/flinch/grip → MotorPlan）
│  └─ reflex.test.ts        # 21 tests ✅
├─ brain/                # M5 ✅
│  ├─ structured-brain.ts   # StructuredBrainProvider（OpenAI-compatible → full NeuroBrainIntent）
│  └─ structured-brain.test.ts  # 19 tests ✅
├─ schemas/              # M5 ✅（借鉴 PR #9）+ P1 防漂移守卫
│  ├─ neuro-v1.schema.json  # 跨语言契约验证（JSON Schema 2020-12，P1 对齐感知层 6 变体）
│  └─ schema-consistency.test.ts  # 11 tests ✅（schema ↔ TS 枚举/变体/required 防漂移）
├─ cerebellum/           # M3 ✅
│  ├─ rule-cerebellum.ts  # synthesizeBrainIntent + planMotor（W+C+I → MotorPlan）
│  └─ rule-cerebellum.test.ts   # 28 tests ✅
─ motion/               # M3 ✅
│  ├─ legacy-sprite-backend.ts  # MotorPlan → ReactionDirective（替代旧映射）
│  └─ legacy-sprite-backend.test.ts  # 23 tests ✅
└─ trace/                # M3 ✅
   ├─ neuro-trace.ts      # 环形缓冲（intent → motor → reaction 记录）
   └─ neuro-trace.test.ts       # 6 tests ✅
```

## 五、开发规约

- 每个里程碑一个独立提交，提交前必须 `pnpm build` + `pnpm test` 全绿；
- M0–M3 期间**禁止修改** `src-tauri/**`、`characters/**`、Rust 插件宿主；
- 允许触碰的现有文件：`src/pet-brain/**`、`src/PetView.tsx`、`src/plugins/dom-bridge.ts`、`src/main.tsx`、`src/api.ts`（仅必要接线）；
- 契约演进只做**增量加字段**；改/删字段必须升 schema 版本（当前 `NEURO_SCHEMA_VERSION = 1`）；
- 情绪系统第一版**不用模型算**——确定性、可测试、可复现，之后才让 Brain 修正（emotionDelta）。

## 六、关键既有契约（对接点）

- 感知事件源：window 事件 `furinapet:pet-sense`（dom-bridge）、Tauri 事件 `pet-brain-agent-state`、`pet-brain-intent`；
- 意图统一入口：Tauri 命令 `submit_pet_brain_intent`（优先级封顶 user/system 1.0、agent/plugin 0.95、ai 0.82）；
- Planner 直接覆盖阈值 0.85（介于插件与 AI 之间）；
- 快照通道：`furinapet:brain-snapshot`（pet 窗口发布，控制中心 1Hz 轮询）；
- 语义动作 → Reaction 映射：旧 `adapters/reaction.ts` 已删除，现由 `runtime.ts` 内联走 `synthesizeBrainIntent → planMotor → reactionForMotorPlan` 路径（M3 接线完成）。

## 七、进度日志

- **2026-08-27**：分支 `furinapet-neuro` 建立于 v1.1.2 基线（本地手写 MCP/IPC 草稿已被官方 Agent Bridge 取代，存于 stash `WIP: hand-rolled MCP/IPC agent-state bridge`）。
- **2026-08-27 M0 完成**（`df738fd`）：五份契约 + vitest 基建；产物 hash 与改动前一致，零行为变化。
- **2026-08-27 M1 完成**（`160ba7b`）：perception-reducer + store + sampler；PetView 拖拽 sense 与 main.tsx bootstrap 接线；9 tests ✅。
- **2026-08-27 M2 完成**（`f8e0053`）：CharacterStore（确定性七维情绪 observe/tick）+ character-adapter（PetBlackboard → CharacterState L3）+ BrainNavigation 情绪调试面板 + neuroTrace 面板；11 tests ✅。
- **2026-08-27 M3 完成**（`e1bd20a`）：
  - `rule-cerebellum.test.ts` 27 条 ✅：synthesizeBrainIntent（7 条：confidence/goal/attention/approach-boost/avoidance/clamp）+ planMotor 全分支（20 条：idle/wander/dock/wait/rest/observe×6/respond×6/celebrate×2）
  - `legacy-sprite-backend.test.ts` 23 条 ✅：优先级扫描（recoil > gesture > expression > idleStyle > turn > lookAt）+ 逐条映射等价性 + 端到端 plan 验证
  - `neuro-trace.test.ts` 6 条 ✅：环形缓冲 record/reverse-order/TRACE_LIMIT 截断/字段完整性/null reaction
  - `vitest run` **87 tests 全绿** ✅，`tsc --noEmit` 零错误 ✅
  - **M0–M3 全部完成并提交**，下一站 M4+（Rust StructuredBrainProvider → FunctionGemma Shadow → 蒸馏 FurinaMotorNet）
- **2026-08-27 M4 完成**（`a8d3bff`）：
  - `reflex.ts` ✅：4 个反射弧（blink=脸部点击/startle=双击/flinch=连续戳≥6次/grip=拖拽开始），零 AI 纯规则
  - `reflex.test.ts` 20 条 ✅：覆盖全部分支、优先级（startle > flinch > blink）、region 过滤、streak 阈值、severity 递增
  - `runtime.ts` 接线 ✅：`handlePetSense` 先走 reflex arc，命中则立即执行 MotorPlan → Reaction，跳过 brain pipeline（brain 仍更新 intent 用于状态追踪）
  - `buildReflexEvent()` 从 PetSenseEventDetail 构建 PerceptionEvent 供 reflex 求值
  - `executeReflex()` 走 `reactionForMotorPlan → recordNeuroTrace → desktop.react`
  - `vitest run` **107 tests 全绿** ✅，`tsc --noEmit` 零错误 ✅
- **2026-08-27 M5 完成**（`d7e98f3` + `59e7ff1`）：
  - Rust 侧：`ai/mod.rs` 新增 `get_ai_api_credentials` 命令（返回 baseUrl/model/apiKey/timeoutSeconds），`lib.rs` 注册
  - `structured-brain.ts` ✅：TypeScript 直接 fetch OpenAI-compatible API，system prompt 要求完整 BrainIntent JSON（goal + attention + emotionDelta + motorTendency + confidence）
  - `validateAndNormalizeBrainIntent()` 解析+校验+归一化：goal 白名单、attention target 白名单、motorTendency clamp、emotionDelta 过滤非数值键
  - `structured-brain.test.ts` 19 条 ✅：null/非对象/缺 goal/错 goal/全 7 goal/confidence clamp/attention target 白名单/motorTendency clamp+默认值/emotionDelta 过滤/复杂完整 intent
  - `ai-runtime.ts` 接线 ✅：`tryStructuredBrain()` 优先走 structured path（buildStructuredContext → requestStructuredBrain → recordNeuroTrace → submitBrainIntent），失败回退 legacy single-goal
  - **契约增强**（借鉴 PR #9，合入 PR #10 `59e7ff1`）：
    - `SocialIntent` 类型：社交维度（greet/complain/tease/comfort/brag/withdraw/plead）
    - `BrainSource` 类型 + `SOURCE_CONFIDENCE_CAP`：追踪意图来源及置信度上限
    - `MotorSource` 类型：追踪运动计划来源（reflex/rule/ai/shadow），为 Shadow 模式铺路
    - `neuro-v1.schema.json`：跨语言契约验证（JSON Schema 2020-12），供 Python 训练管线或远程 Brain Server 使用
  - `vitest run` **131 tests 全绿** ✅，`tsc --noEmit` 零错误 ✅
  - 下一站 M6+（FunctionGemma Shadow → 蒸馏 FurinaMotorNet → Rigged Body）
- **2026-08-27 架构审查**（fullstack 代码审查）：按 project.md 核对框架与通信协议一致性。发现 1 Critical + 3 Major + 5 Minor：反射 AbortSignal 崩溃、arousal 钉死、schema 感知层脱节、MotorSource 空转、优先级封顶三处硬编码、快照 CustomEvent 死通道等。报告：`outputs/neuro-review-report.md`（本机 workspace）。L4/L5 契约、事件通道、Tauri 命令注册、凭证结构全部一致 ✅。
- **2026-08-27 P0 修复完成**（PR #12 `e8e5f77`，已合入）：
  - **C1 反射 AbortSignal 崩溃**：`executeReflex` 曾传 `undefined as unknown as AbortSignal` → `waitForAction` 首行读 `signal.aborted` 抛 TypeError → 反射后 `publishPetBrainSnapshot()` 永不执行。修复：传真实 never-aborting signal + `waitForAction` 容忍缺失 signal（防御纵深）
  - **M3 arousal 钉死**：125ms 采样每事件 +0.01（+4.8/min）vs 衰减上限 0.34/min → arousal 恒 1.0。双层修复：`dispatch()` 仅指针位置实际变化才转发 observe（静止采样仍刷新 WorldState）；character-store 仅 `region !== "none"` 计入
  - 测试 131 → **141** ✅（waitForAction 信号契约 ×6、dispatch 边界 ×3、on-body 门控 ×1）
  - 本地环境：VS Build Tools 2022 + Windows SDK 已装，`cargo check` 本地可跑（此前 link.exe 解析到 Git GNU link 导致失败）
- **2026-08-27 P1 修复完成**（schema 对齐 + MotorSource 接线）：
  - **M1 schema 感知层对齐**：`perceptionEvent` 从宽松单对象改为 **6 变体 discriminated union**（原 type 枚举 kebab 命名漂移 + 缺 pointer/pointerApproach）；`pointerMotion` 修正 leaving/passing → **retreating/tangential**；`sense` 从自由字符串收紧为 petSenseName 枚举（4 值）
  - **M2 MotorSource 全链路接线**（原为纸面协议，Shadow 模式前提）：`reflex.ts` 4 反射全标 `source: "reflex"`；`planMotor` 全部 11 分支标 `source: "rule"`；`ai-runtime.ts` AI trace 标 `source: "ai"`；`NeuroTraceEntry` 新增 `source?: MotorSource` 字段，`runtime.ts` 两处 trace 记录透传
  - 新增 `schema-consistency.test.ts` **11 条防漂移测试**（枚举逐值比对 + 变体覆盖 + required 对齐），schema 与 TS 再漂移会直接红
  - reflex/cerebellum 测试补 source 断言 ×2
  - 测试 141 → **154** ✅，`tsc` 零错误，`pnpm build` + `cargo check` 通过
- **2026-08-27 点击部位丢失修复**（region 传递链）：实测发现不同部位点击无差异化反应。根因：`dom-bridge emitSense` 丢弃点击坐标 → `buildReflexEvent` 回退到 125ms 采样器的过期 `targetRegion`（点击派发延迟 360ms 双击窗口，指针早已移开，恒为 "none"）→ blink（要求 face/head）永不命中 → 全部点击走大脑路径渲染同一动画。修复：`PetSenseEventDetail` 新增 `region?: BodyRegion`；dom-bridge 在 pointerdown 时刻用 `regionAtPointer` 解析真实部位随事件下发（双击路径同样处理）；`buildReflexEvent`/`senseToPerceptionEvent` 优先使用 `detail.region`。测试 154 → **161** ✅（runtime buildReflexEvent ×4 + store sense 映射 ×3）
- **2026-08-27 M-Panel 完成**（LMC 自主决策面板，project.md 第八节）：
  - **数据管线扩展**：`publishPetBrainSnapshot` 快照新增 `world: WorldState` + `perceptionLog`（最近 30 条感知事件，pointer 节流 1 条/秒，touch/drag/agentState 全量）；`NeuroTraceEntry` 新增 `reflex?: ReflexName` + `region?: BodyRegion`（executeReflex 记录反射名与触发部位）
  - **新增 `src/components/DecisionInspector.tsx`**（~600 行）：七层架构图（Environment → Perception → Brain|Reflex 并行 → Cerebellum → Motion → Body → Renderer），每层框内显示当前执行状态摘要（鼠标运动/目标区域/连点/goal/source/原语序列/当前 reaction 等）；点击任意层弹出右侧抽屉展示该层详情（Planner 评分/动作计划/情绪七维/AI 建议/大脑输出轨迹/反射触发历史/感知事件日志/MotorTendency/legacy 映射表/13 原语词汇表）；新决策流经时对应层闪烁高亮（reflex → Reflex 框，rule/ai → Brain 框，全部 → Cerebellum/Motion 框）；Esc/遮罩关闭抽屉
  - **`src/pet-brain/labels.ts`** 抽取共享中文标签（goalLabel/moodLabel/agentStateLabel 等 9 个），BrainNavigation 与 DecisionInspector 共用
  - BrainNavigation 旧平铺面板（Planner 评分/动作计划/AI 建议/情绪/Neuro Trace 五个 panel）全部折叠进对应层的抽屉，六格实时统计条保留
  - 感知日志测试 ×3（touch/drag 即时记录、pointer 节流、30 条上限），测试 161 → **164** ✅，`tsc` 零错误
  - 验证方式切换：`pnpm tauri dev` 热更新迭代（免打包），最终发布前再打 NSIS 包实测

## 八、自主决策面板（Decision Inspector）

### 当前状态（✅ 2026-08-27 已实现）

LMC 架构可视化交互面板已上线（`src/components/DecisionInspector.tsx`）：自主页面显示七层管线图，每层框内实时状态摘要，点击弹侧边抽屉，新决策流经时闪烁。数据经 `furinapet:brain-snapshot` 快照传递：`world`（WorldState）、`perceptionLog`（感知事件日志）、`neuroTrace`（含 reflex 名/部位/source）、`character`（情绪）+ 旧有字段。旧平铺面板内容全部折叠进各层抽屉。

> 历史状态：控制中心「自主」页面原有实时面板，直接读取 Pet Brain 快照（`furinapet:brain-snapshot`），展示 Goal、Mood、Energy、Agent 状态、Planner 评分、当前动作计划——现已升级为下述 LMC 面板。

### 目标：LMC 架构可视化交互面板

将自主页面升级为 LMC 架构的可视化交互面板，每个模块框内显示当前执行状态，点击展开详情。

```text
┌─────────────────────────────────────────────────────────────┐
│                      外部环境 Environment                    │
│ 鼠标 / 点击 / 拖拽 / 用户语言 / 语音 / 屏幕 / 时间 / 窗口等 │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
                 ┌──────────────────┐
                 │   Perception     │
                 │     感知层        │
                 │  PerceptionEvent │  ← 点击展开：最近事件列表
                 │  WorldState      │     （region/streak/intensity）
                 └────────┬─────────
                          ↓
                    World State
                          │
        ┌─────────────────┼─────────────────
        ↓                                   ↓
┌────────────────                  ┌────────────────┐
│     Brain      │                  │     Reflex     │
│      大脑       │                  │    脊髓反射     │
│                │                  │                │
│语言/情绪/记忆    │                  │点击/碰撞/极限    │
│人格/理解/目标    │                  │即时安全响应      │
│                │                  │                │
│ NeuroBrainIntent│                  │ MotorPlan      │
│ source: rule/ai │                  │ source: reflex │
└───────┬────────┘                  └───────┬────────┘
        │  点击展开：                         │  点击展开：
        │  - 当前 goal                       │  - 最近 reflex 触发
        │  - SocialIntent                    │  - blink/startle/flinch/grip
        │  - confidence                      │  - 触发时间 + region
        │  - emotionDelta                    │  - MotorPlan 内容
        ↓                                   │
 Character Intent                           │
        │                                   │
        ↓                                   │
────────────────┐                          │
│   Cerebellum   │                          │
│      小脑       │                          │
│                │                          │
│动作策略/协调     │                          │
│Motor Primitive │                          │
│ 13 个原语       │                          │
└───────┬────────┘                          │
        │  点击展开：                         │
        │  - 当前 MotorPlan                  │
        │  - 各 primitive weight             │
        │  - source: rule/ai                 │
        ────────────────┬──────────────────┘
                         ↓
                 ┌────────────────┐
                 │ Motion Engine  │
                 │    运动系统      │
                 │                │
                 │ IK / LookAt    │
                 │ Reach / Mixer  │
                 │ Procedural     │
                 ───────┬────────┘
                         │  点击展开：
                         │  - 当前 sprite reaction
                         │  - durationMs
                         │  - fallback 链
                         ↓
                 ┌────────────────┐
                 │      Body      │
                 │     身体层      │
                 │                │
                 │ Joint Limit    │
                 │ Spring/Damping │
                 │ Skeleton       │
                 ───────┬────────┘
                         ↓
                 ┌────────────────┐
                 │    Renderer    │
                 │     渲染器      │
                 │                │
                 │ Sprite Atlas   │
                 │ (当前 v2 8×11) │
                 └────────────────┘
```

### 数据来源

| 面板模块 | 数据来源 |
|---------|---------|
| Environment | `getWorldState()` 的 environment 字段 |
| Perception | `getWorldState()` + `getNeuroTrace()` 最近事件 |
| Brain | `getPetBrain().snapshot()` + `getNeuroTrace()` AI 条目 |
| Reflex | `getNeuroTrace()` source="reflex" 条目 |
| Cerebellum | `getNeuroTrace()` 最近 MotorPlan primitives |
| Motion Engine | `getNeuroTrace()` reaction + durationMs |
| Body + Renderer | 当前 sprite 状态（PetView） |

### 实现计划

1. 在 `src/components/` 新增 `DecisionInspector.tsx`（或扩展现有 BrainNavigation）
2. 每层模块框从 `furinapet:brain-snapshot` 事件获取实时数据
3. 框内显示当前状态摘要（如 Brain 框显示当前 goal + source）
4. 点击模块弹出侧边抽屉，展示该层的详细决策日志（从 neuro-trace 过滤）
5. 活跃模块高亮（如 reflex 触发时 Reflex 框闪烁）

## 九、参考文档

- **《LMC》**（原名「造人计划」，FurinaPet 类人认知—运动架构总纲）
  - 工程内副本：[`docs/LMC.md`](docs/LMC.md)
  - 原始位置：Obsidian `sheetung的知识区/make/LMC.md`（`C:\Users\sheetung\Documents\Obsidian\sheetung的知识区\make\LMC.md`）
  - 内容：感知/大脑/小脑/脊髓反射/运动系统/身体/渲染七层架构；Level 0–6 数据分级；大脑只输出 BrainIntent、小脑输出 MotorPrimitive 的职责划分；M0–M9 双线（工程线 + 模型线）开发路线；FunctionGemma → FurinaMotorNet 蒸馏策略；Shadow 模式与 Benchmark/Replay 基建要求。
  - 本工程的 M0–M3 里程碑即按其「Agent 工程线」前四个阶段执行。
