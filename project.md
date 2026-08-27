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
PerceptionEvent (L1)
      ↓
   WorldState (L2)          ← 感知 Reducer，事件驱动，无 AI
      ↓
CharacterState (L3)         ← 确定性情绪/能量/注意力（七维情绪）
      ↓
NeuroBrainIntent (L4)       ← 大脑输出：goal + attention + emotionDelta + motorTendency
      ↓                       （大脑禁止输出动画/坐标/帧；AI 优先级封顶 0.82）
   MotorPlan (L5)           ← 小脑输出：13 个 MotorPrimitive（lookAt/recoil/earPose…）
      ↓
LegacySpriteBackend         ← MotorPlan → 现有 v2 Reaction（8×11 图集）
      ↓
   PetView 渲染              ← wander/dock 仍由 PetView 运动循环执行（pass-through）
```

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
| **M5** | StructuredBrainProvider（AI → NeuroBrainIntent，OpenAI-compatible API，TS 直接调用） | 🔨 进行中 |
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
│  └─ contracts.test.ts     # 11 tests ✅
├─ perception/           # M1 ✅
│  ├─ perception-reducer.ts # 纯函数 reducer（事件 + 记忆 → WorldState）
│  ├─ store.ts              # pet 窗口单例 store + bootstrapNeuroPerception()
│  └─ perception-reducer.test.ts  # 9 tests ✅
├─ character/            # M2 ✅
│  ├─ character-store.ts    # 确定性情绪累加器（observe + tick）
│  ├─ character-adapter.ts  # PetBlackboard + CharacterStore → CharacterState (L3)
│  └─ character-store.test.ts     # 11 tests ✅
├─ reflex/               # M4 ✅
│  ├─ reflex.ts             # 脊髓反射弧（blink/startle/flinch/grip → MotorPlan）
│  └─ reflex.test.ts        # 20 tests ✅
├─ brain/                # M5 🔨
│  ├─ structured-brain.ts   # StructuredBrainProvider（OpenAI-compatible → full NeuroBrainIntent）
│  └─ structured-brain.test.ts  # 19 tests ✅
├─ cerebellum/           # M3 ✅
│  ├─ rule-cerebellum.ts  # synthesizeBrainIntent + planMotor（W+C+I → MotorPlan）
│  └─ rule-cerebellum.test.ts   # 27 tests ✅
├─ motion/               # M3 ✅
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
- **2026-08-27 M5 进行中**：
  - Rust 侧：`ai/mod.rs` 新增 `get_ai_api_credentials` 命令（返回 baseUrl/model/apiKey/timeoutSeconds），`lib.rs` 注册
  - `structured-brain.ts` ✅：TypeScript 直接 fetch OpenAI-compatible API，system prompt 要求完整 BrainIntent JSON（goal + attention + emotionDelta + motorTendency + confidence）
  - `validateAndNormalizeBrainIntent()` 解析+校验+归一化：goal 白名单、attention target 白名单、motorTendency clamp、emotionDelta 过滤非数值键
  - `structured-brain.test.ts` 19 条 ✅：null/非对象/缺 goal/错 goal/全 7 goal/confidence clamp/attention target 白名单/motorTendency clamp+默认值/emotionDelta 过滤/复杂完整 intent
  - `ai-runtime.ts` 接线 ✅：`tryStructuredBrain()` 优先走 structured path（buildStructuredContext → requestStructuredBrain → recordNeuroTrace → submitBrainIntent），失败回退 legacy single-goal
  - `vitest run` **126 tests 全绿** ✅，`tsc --noEmit` 零错误 ✅

## 八、参考文档

- **《LMC》**（原名「造人计划」，FurinaPet 类人认知—运动架构总纲）
  - 工程内副本：[`docs/LMC.md`](docs/LMC.md)
  - 原始位置：Obsidian `sheetung的知识区/make/LMC.md`（`C:\Users\sheetung\Documents\Obsidian\sheetung的知识区\make\LMC.md`）
  - 内容：感知/大脑/小脑/脊髓反射/运动系统/身体/渲染七层架构；Level 0–6 数据分级；大脑只输出 BrainIntent、小脑输出 MotorPrimitive 的职责划分；M0–M9 双线（工程线 + 模型线）开发路线；FunctionGemma → FurinaMotorNet 蒸馏策略；Shadow 模式与 Benchmark/Replay 基建要求。
  - 本工程的 M0–M3 里程碑即按其「Agent 工程线」前四个阶段执行。
