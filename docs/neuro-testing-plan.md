# Neuro 底层通信测试方案

## 现状

126 个单测覆盖各层纯函数，但层与层之间的接线零测试。`runtime.ts` 是集成枢纽，把 perception → character → brain → cerebellum → motor → sprite 串成一条链路，任何一层的数据格式不对、字段丢失、类型不匹配，单测抓不到，只有运行时调试面板能看到。

目标：**在不依赖 Tauri 运行时的前提下，验证整条管线的数据流通性。**

---

## 一、测试分层

```
┌─────────────────────────────────────────────────────┐
│  L3 端到端管线集成测试（pipeline integration）         │  ← 最高优先级
│  PerceptionEvent → WorldState → CharacterState       │
│  → BrainIntent → MotorPlan → Reaction                │
├─────────────────────────────────────────────────────┤
│  L2 Reflex Bypass 集成测试                            │  ← 高优先级
│  PerceptionEvent → evaluateReflex → MotorPlan        │
│  → Reaction（跳过 brain pipeline）                    │
├─────────────────────────────────────────────────────┤
│  L2 Structured Brain 集成测试                         │  ← 高优先级
│  mock fetch → validateAndNormalize → recordTrace     │
│  → submitBrainIntent → fallback to legacy            │
├─────────────────────────────────────────────────────┤
│  L1 契约一致性测试（contract consistency）             │  ← 中优先级
│  JSON Schema ↔ TypeScript 类型双向校验                │
├─────────────────────────────────────────────────────┤
│  L1 Trace 完整性测试                                  │  ← 中优先级
│  每次决策都正确写入 neuro-trace，字段完整              │
└─────────────────────────────────────────────────────┘
```

---

## 二、L3 管线集成测试

### 文件：`src/neuro/__integration__/pipeline.test.ts`

### 核心思路

构造 PerceptionEvent，手动调用各层的纯函数串联管线，断言最终产出的 Reaction。不需要 Tauri 运行时，因为核心函数（`reducePerceptionEvent`、`buildCharacterState`、`synthesizeBrainIntent`、`planMotor`、`reactionForMotorPlan`）都是纯函数。

### Mock 清单

| 依赖 | 策略 |
|------|------|
| `getWorldState()` | 用 `emptyWorldState()` 或手动构造 |
| `buildCharacterState()` | 直接调用纯函数，传入 mock blackboard + CharacterStore |
| `desktop.react()` | `vi.fn()` 捕获所有 reaction 调用 |
| `recordNeuroTrace()` | spy，断言 trace 内容 |

### 测试用例

```
describe("full pipeline integration", () => {

  1. "click on face → WorldState updates → CharacterState annoyance rises 
      → BrainIntent respond-user → MotorPlan has recoil → Reaction is jumping/failed"
      
  2. "idle tick → WorldState.decay → CharacterState boredom → BrainIntent idle 
      → MotorPlan idleStyle normal → Reaction is idle"
      
  3. "double-click → WorldState streak=2 → CharacterState fear rises 
      → BrainIntent respond-user + high avoidance → MotorPlan has strong recoil 
      → Reaction respects priority (recoil > gesture)"
      
  4. "agent success → BrainIntent celebrate → MotorPlan gesture cheer 
      → Reaction is jumping"
      
  5. "drag start → WorldState drag active → CharacterState surprise 
      → MotorPlan lean back → Reaction is waiting"
      
  6. "click streak >= 6 → flinch reflex fires → brain pipeline NOT reached"
      (这条验证 bypass，放在下一节)
})
```

### 关键断言

- `desktop.react()` 被调用了正确的次数
- 每次调用的 `Reaction` 值在合法枚举内
- `recordNeuroTrace()` 的 entry 包含完整的 goal、confidence、primitives、reaction
- MotorPlan 的 `source` 字段在 rule 路径下为 `"rule"` 或 undefined

---

## 三、L2 Reflex Bypass 集成测试

### 文件：`src/neuro/__integration__/reflex-bypass.test.ts`

### 核心思路

验证 reflex 触发后，brain pipeline 被完全跳过，动画由 reflex 直接驱动。

### 测试用例

```
describe("reflex bypass integration", () => {

  1. "face click → blink fires → reactionForMotorPlan → desktop.react 
      with surprised expression + recoil, confidence=1, source=reflex"
      
  2. "double-click → startle fires → desktop.react 
      with recoil + lookAway + earPose back"
      
  3. "drag start → grip fires → desktop.react 
      with lean back + surprised"
      
  4. "click streak 6+ → flinch fires → severity-scaled recoil + annoyed"
      
  5. "body click → no reflex → falls through to brain pipeline"
  
  6. "reflex MotorPlan has source: 'reflex' (MotorSource)"
})
```

### 关键断言

- reflex 路径下 `desktop.react()` 只被调用 1 次（不是多次）
- trace entry 的 `goal` 是 `"idle"`，`confidence` 是 `1`
- reflex MotorPlan 的 `source` 字段为 `"reflex"`
- body/hand click 不触发 reflex，走 brain pipeline

---

## 四、L2 Structured Brain 集成测试

### 文件：`src/neuro/__integration__/structured-brain-e2e.test.ts`

### 核心思路

Mock `fetch` 和 `invoke("get_ai_api_credentials")`，验证从 AI API 调用到 intent 提交的完整链路。

### Mock 清单

| 依赖 | 策略 |
|------|------|
| `global.fetch` | `vi.fn()` 返回可控的 OpenAI-compatible 响应 |
| `invoke("get_ai_api_credentials")` | mock 返回 `{ baseUrl, model, apiKey, timeoutSeconds }` |
| `desktop.submitBrainIntent()` | `vi.fn()` 捕获提交 |
| `recordNeuroTrace()` | spy |
| `getWorldState()` | 返回 `emptyWorldState()` |
| `buildCharacterState()` | 返回 `emptyCharacterState()` |

### 测试用例

```
describe("structured brain e2e", () => {

  // 成功路径
  1. "valid AI response → validateAndNormalize → recordTrace → submitBrainIntent 
      with correct priority and ttlMs"
      
  2. "AI returns full intent with socialIntent=greet → validated → submitted"
      
  3. "AI returns confidence=0.9 → priority = min(0.82, 0.5 + 0.9*0.32) = 0.788"
  
  // 失败路径 + fallback
  4. "fetch throws → structured returns null → fallback to legacy 
      desktop.requestAiBehaviorSuggestion()"
      
  5. "AI returns invalid goal → validation fails → fallback to legacy"
      
  6. "API key empty → structured returns null immediately, no fetch called"
      
  7. "AI returns malformed JSON → validation fails → fallback"
      
  // 并发保护
  8. "concurrent requestSuggestion → inFlight guard prevents double fetch"
})
```

### 关键断言

- structured 成功时 `desktop.requestAiBehaviorSuggestion()` 不被调用（没有 fallback）
- structured 失败时 legacy 路径被调用
- `recordNeuroTrace()` 的 entry 包含 AI 返回的 latencyMs
- priority 计算正确：`min(0.82, 0.5 + confidence * 0.32)`

---

## 五、L1 契约一致性测试

### 文件：`src/neuro/__integration__/contract-consistency.test.ts`

### 核心思路

用 `ajv`（JSON Schema 校验库）对 TypeScript 构造的对象做 JSON Schema 校验，确保两边同步。

### 依赖

```json
"devDependencies": { "ajv": "^8.x" }
```

### 测试用例

```
describe("contract consistency: JSON Schema ↔ TypeScript", () => {

  // L1 PerceptionEvent
  1. "emptyWorldState() output validates against JSON Schema WorldState definition"
  2. "all PerceptionEvent types validate against schema"
  
  // L2 WorldState  
  3. "reducePerceptionEvent output validates against WorldState schema"
  
  // L3 CharacterState
  4. "emptyCharacterState() validates against CharacterState schema"
  5. "applyEmotionDelta result validates"
  
  // L4 BrainIntent
  6. "normalizeBrainIntent output validates against BrainIntent schema"
  7. "all PetGoalId values are valid in schema"
  8. "all SocialIntent values are valid in schema"
  
  // L5 MotorPlan
  9. "emptyMotorPlan() validates against MotorPlan schema"
  10. "all MotorPrimitive types validate"
  11. "MotorSource values valid in schema"
  
  // 反向：schema 有但 TS 没有
  12. "schema required fields match TS required fields"
})
```

### 关键价值

如果改了 TypeScript 类型但忘了更新 JSON Schema（或反过来），测试直接报错。这是防止跨语言契约漂移的唯一自动化手段。

---

## 六、L1 Trace 完整性测试

### 文件：`src/neuro/__integration__/trace-integrity.test.ts`

### 测试用例

```
describe("neuro trace integrity", () => {

  1. "rule pipeline execution → trace entry has goal, confidence, primitives[], reaction"
  2. "reflex execution → trace entry has goal='idle', confidence=1, source='reflex'"
  3. "structured brain success → trace entry has latencyMs, raw response"
  4. "trace entry timestamp is monotonically non-decreasing in sequential execution"
  5. "trace ring buffer: 50 entries → oldest is dropped, newest is first"
  6. "every desktop.react() call has a corresponding trace entry"
})
```

---

## 七、测试基础设施

### 新增文件

```
src/neuro/__integration__/
  ├── helpers/
  │   ├── mock-desktop.ts      # vi.fn() 版本的 desktop API
  │   ├── mock-tauri.ts        # mock invoke/listen/emit
  │   ├── fixtures.ts          # 预构造的 WorldState、CharacterState、PerceptionEvent
  │   └── run-pipeline.ts     # 串联各层纯函数的 helper
  ├── pipeline.test.ts
  ├── reflex-bypass.test.ts
  ├── structured-brain-e2e.test.ts
  ├── contract-consistency.test.ts
  └── trace-integrity.test.ts
```

### `mock-desktop.ts`

```typescript
export function createMockDesktop() {
  return {
    react: vi.fn(),
    submitBrainIntent: vi.fn(),
    requestAiBehaviorSuggestion: vi.fn(),
    getAiSettings: vi.fn().mockResolvedValue({ enabled: true, configured: true }),
    getSettings: vi.fn().mockResolvedValue({ /* defaults */ }),
    // ...
  };
}
```

### `run-pipeline.ts`

```typescript
/**
 * 纯函数管线串联：跳过 Tauri/runtime，直接调用各层纯函数。
 * 用于验证数据在层间传递时不丢失、不变形。
 */
export function runPipeline(
  event: PerceptionEvent,
  world: WorldState,
  character: CharacterState,
) {
  const intent = synthesizeBrainIntent(plan, character, world);
  const motorPlan = planMotor(intent, character, world, action);
  const directive = reactionForMotorPlan(motorPlan);
  return { intent, motorPlan, directive };
}
```

### `fixtures.ts`

```typescript
export const FIXTURES = {
  faceClick: (streak = 1) => ({
    type: "touch" as const,
    sense: "pet:clicked" as const,
    region: "face" as const,
    streak,
    intensity: 0.5,
    at: Date.now(),
  }),
  doubleClick: () => ({ ... }),
  dragStart: () => ({ ... }),
  neutralWorld: () => emptyWorldState(0),
  neutralCharacter: () => emptyCharacterState(),
  annoyedCharacter: () => ({ ...emptyCharacterState(), emotion: { ...emptyEmotionState(), annoyance: 0.8 } }),
};
```

---

## 八、执行计划

| 阶段 | 内容 | 预估测试数 | 依赖 |
|------|------|-----------|------|
| **P1** | 测试基础设施（mock + fixtures + helpers） | 0 | 无 |
| **P2** | 管线集成测试（pipeline.test.ts） | ~6 | P1 |
| **P3** | Reflex bypass 集成测试 | ~6 | P1 |
| **P4** | Structured brain e2e 测试 | ~8 | P1 + ajv(可选) |
| **P5** | 契约一致性测试 | ~12 | P1 + ajv |
| **P6** | Trace 完整性测试 | ~6 | P2 + P3 |

总计约 **38 个新测试**，预期全绿后 `vitest run` 总数从 131 → ~169。

---

## 九、不在本轮范围

- **Property-based testing**（fast-check 随机生成 PerceptionEvent 验证管线不变量）——有价值但复杂度高，放后续
- **Visual regression testing**（截图对比 sprite 动画）——需要 Tauri 运行时
- **Performance benchmarking**（管线延迟测量）——放 M6+ Shadow 模式时一起做
- **MSW (Mock Service Worker)** 替代 `vi.fn()` mock fetch——当前 `vi.fn()` 够用
