可以。现在可以把它正式定成一套 **Furinapet「类人认知—运动架构」**。核心不是“LLM 控制角色”，而是把角色拆成类似人的 **感知系统、大脑、小脑、脊髓反射、身体运动控制、渲染**。

我建议最终目标如下：

```text
┌─────────────────────────────────────────────────────────────┐
│                      外部环境 Environment                    │
│ 鼠标 / 点击 / 拖拽 / 用户语言 / 语音 / 屏幕 / 时间 / 窗口等 │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
                 ┌──────────────────┐
                 │   Perception     │
                 │     感知层        │
                 └────────┬─────────┘
                          ↓
                    World State
                          │
        ┌─────────────────┼─────────────────┐
        ↓                                   ↓
┌────────────────┐                  ┌────────────────┐
│     Brain      │                  │     Reflex     │
│      大脑       │                  │    脊髓反射     │
│                │                  │                │
│语言/情绪/记忆    │                  │点击/碰撞/极限    │
│人格/理解/目标    │                  │即时安全响应      │
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
└───────┬────────┘                          │
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
                 └────────────────┘
```

这会成为后续整个 Furinapet 的核心架构。

---

# 一、各层到底负责什么

|层|负责回答的问题|是否 AI|推荐频率|
|---|---|--:|--:|
|感知 Perception|外界发生了什么？|少量|事件驱动|
|大脑 Brain|我怎么看这件事？我想干什么？|✅ LLM|事件驱动 / 低频|
|小脑 Cerebellum|这个意图应该怎么表现出来？|✅ 小策略模型|5–15 Hz|
|脊髓 Reflex|突然被戳、撞墙怎么办？|❌|30–60 Hz|
|Motion Engine|手到底怎么伸过去？|❌|30–60 Hz|
|Body|这个关节能不能这样转？|❌|30–60 Hz|
|Renderer|最终怎么显示？|❌|30–60 FPS|

这里最关键的是：

> **越靠近身体，越不应该使用大模型。**

真正实时部分全部应该是数学、状态机、IK 和简单控制器。

---

# 二、大脑 Brain

大脑是角色真正的“认知层”。

它负责：

```text
语言理解
+
用户意图
+
人格
+
长期记忆
+
短期记忆
+
情绪
+
关系状态
+
环境理解
+
当前目标
+
复杂行为规划
```

比如用户说：

> 你今天怎么不理我？

同时过去一分钟用户戳了角色很多次。

大脑看到的是：

```json
{
  "user_input": "你今天怎么不理我？",
  "interaction": {
    "head_touch_count_60s": 12
  },
  "character": {
    "affection": 0.82,
    "annoyed": 0.63,
    "sleepiness": 0.71
  }
}
```

大脑输出：

```json
{
  "emotion": {
    "affection": 0.78,
    "annoyed": 0.55,
    "sleepiness": 0.72
  },
  "attention": {
    "target": "user"
  },
  "goal": "respond_tired_but_friendly",
  "social_intent": "slightly_complain",
  "motor_tendency": {
    "energy": 0.32,
    "approach": 0.1,
    "avoidance": 0.18
  }
}
```

注意：

**依然没有任何骨骼信息。**

---

# 三、大脑不应该常驻运行

这是保持轻量的第一个关键。

正常桌宠状态：

```text
              Brain
                │
              sleeping
                │
        ┌───────┴─────────┐
        │                 │
   用户说话          重要事件发生
        │                 │
        └──────┬──────────┘
               ↓
          Wake Brain
               ↓
            推理一次
               ↓
      更新 CharacterState
               ↓
            Sleep
```

例如鼠标移动完全不需要 LLM。

连续鼠标移动：

```text
mouse
 ↓
Perception
 ↓
LookAt Target
 ↓
Motion Engine
```

就够了。

只有：

```text
用户说话
复杂行为
明显情绪变化
新人物/事件
长期计划
需要理解屏幕内容
```

才唤醒 Brain。

---

# 四、大脑模型怎么选择

本地模式可以从类似 Qwen3-0.6B 这一档开始，目前官方仍提供 0.6B 版本。([Hugging Face](https://huggingface.co/Qwen/Qwen3-0.6B/blob/main/config.json?utm_source=chatgpt.com "config. json · Qwen/Qwen3-0.6B at main"))

不过我不建议把“大脑模型”固定死。

正确接口应该是：

```text
BrainProvider
    │
    ├── CloudBrain
    │      ├── OpenAI
    │      ├── Gemini
    │      └── ...
    │
    ├── LocalBrain
    │      ├── Qwen
    │      ├── Gemma
    │      └── ...
    │
    └── HybridBrain
```

这样用户可以选择：

```text
极致轻量
→ 云端大脑

完全离线
→ 本地大脑

日常本地 + 复杂问题云端
→ Hybrid
```

大脑永远只输出统一 `BrainIntent`。

---

# 五、小脑 Cerebellum

这里我要调整我们之前的方案。

**第一版可以用 FunctionGemma 270M。**

但最终版本我不建议让 270M LLM 永久充当小脑。

FunctionGemma 确实非常适合我们做第一阶段：它就是基于 Gemma 3 270M 的边缘 function-calling 模型，Google 也明确说明它适合作为针对具体函数调用任务进一步微调的基础模型。([Google DeepMind](https://deepmind.google/models/gemma/functiongemma/?utm_source=chatgpt.com "FunctionGemma — Google DeepMind"))

例如：

```text
BrainIntent
     ↓
FunctionGemma
     ↓
[
  look_at(user, 0.4),
  recoil(user, 0.2),
  ear(back, 0.35),
  expression(tired, 0.65)
]
```

非常合适。

但等我们积累足够数据后：

```text
FunctionGemma 270M
        │
        │ Teacher
        ↓
训练数据
        ↓
FurinaMotorNet
  1M～10M
        ↓
最终小脑
```

这样才能做到真正极致轻量。

---

# 六、最终的小脑甚至不需要 LLM

因为它面对的输入其实非常有限。

比如：

```text
emotion = 12维
interaction = 20维
environment = 20维
body = 30维
goal = embedding
personality = 16维
```

总输入可能只有：

```text
100～300维
```

输出也只是：

```text
look
reach
lean
recoil
ear
tail
expression
step
turn
idle
```

完全没必要一直跑 Transformer LLM。

最终可以训练一个：

```text
             Input
              192
               │
               ↓
             FC256
               │
              GRU
               │
             FC256
               │
       ┌───────┼────────┐
       ↓       ↓        ↓
    Action  Intensity  Target
```

参数可能只有几百万。

INT8 后甚至可以做到：

```text
几 MB ～ 十几 MB
```

级别。

这才应该是最终的“小脑”。

---

# 七、FunctionGemma 在这里真正的作用

它更适合作为：

```text
训练老师
+
第一版小脑
+
未知行为 fallback
```

而不是永远作为 Runtime。

Google 官方的 FunctionGemma 微调指南甚至专门把**模型蒸馏**列为典型场景：用较大模型产生合成数据，再训练更小模型复制特定工作流。([Google AI](https://ai.google.dev/gemma/docs/functiongemma/finetuning-with-functiongemma?hl=zh-CN&utm_source=chatgpt.com "使用 FunctionGemma 进行微调  |  Google AI for Developers"))

所以：

```text
                 Teacher
           大模型 / FunctionGemma
                   │
            生成动作决策
                   │
                   ↓
             Training Data
                   │
                   ↓
             FurinaMotorNet
                   │
                   ↓
              Production
```

---

# 八、小脑到底输出什么

不要输出动画名称：

```text
animation = "angry_03"
```

也不要输出：

```text
head.rotation = 17°
```

而是 Motor Primitive：

|Primitive|含义|
|---|---|
| `look_at` |看向|
| `look_away` |避开视线|
| `reach` |伸手|
| `recoil` |躲避|
| `lean` |身体倾斜|
| `turn` |转身|
| `step` |移动一步|
| `approach` |靠近|
| `retreat` |远离|
| `ear_pose` |耳朵姿态|
| `tail_motion` |尾巴行为|
| `expression` |表情|
| `gesture` |手势|
| `idle_style` |待机状态|

例如：

```json
{
  "actions": [
    {
      "type": "look_at",
      "target": "mouse",
      "weight": 0.35
    },
    {
      "type": "recoil",
      "target": "mouse",
      "weight": 0.65
    },
    {
      "type": "ear_pose",
      "pose": "back",
      "weight": 0.72
    }
  ]
}
```

---

# 九、脊髓 Reflex

这是保证“像生物”的另外一个关键。

假设用户突然：

```text
啪！
点击角色眼睛
```

不能：

```text
Event
 ↓
LLM
 ↓
270M模型
 ↓
Motion
```

太笨了。

应该：

```text
touch(face)
     │
     ├────────────→ Reflex
     │               ↓
     │           blink()
     │           recoil()
     │
     └────────────→ Brain
                     ↓
                更新 annoyance
```

也就是说：

**身体先反应，大脑后理解。**

非常像人类。

---

# 十、感知层应该感知什么

感知不要理解成“摄像头模型一直跑”。

真正需要的是统一事件系统。

### 第一优先级

这是必须有的：

```text
鼠标位置
鼠标速度
鼠标方向
hover 哪个身体区域

单击
双击
连续点击
长按
拖拽

角色当前位置
角色姿态
身体区域
屏幕边界

当前动作
动作持续时间

用户输入文字
```

### 第二优先级

以后增加：

```text
窗口位置
窗口大小
活动窗口
用户空闲时间

一天时间
日期
天气

CPU负载
电池状态
播放音乐状态
```

### 第三优先级

真正 AI 感知：

```text
屏幕内容
摄像头
麦克风
语音
环境声音
```

但一定：

> **事件驱动，而不是持续分析。**

---

# 十一、视觉感知千万不要一直截图

否则“极致轻量”直接没了。

应该：

```text
Screen
   ↓
Change Detector
   │
   ├── 没变化
   │      ↓
   │    nothing
   │
   └── 有重大变化
          ↓
       ROI Crop
          ↓
      Vision Model
```

例如：

```text
60FPS Renderer
但
0FPS Vision
```

正常情况下视觉模型根本不工作。

用户触发：

```text
“你看看这个页面”
```

才：

```text
Capture
 ↓
Vision
 ↓
Structured perception
 ↓
Brain
```

---

# 十二、音频也是这样

不要持续跑 ASR。

正确：

```text
Microphone
    ↓
超轻 VAD
    ↓
检测到人声？
    │
 ┌──┴──┐
No    Yes
│       │
丢弃    ↓
       ASR
        ↓
      Brain
```

所以长期运行只有一个极小的声音活动检测器。

---

# 十三、内部数据不要传自然语言

这是非常重要的一条。

错误架构：

```text
Perception:
“用户刚刚连续点击了我的头很多次，看起来似乎在逗我”

↓

Brain

↓

Cerebellum:
“角色感觉有点烦，所以稍微后退并把耳朵向后。”
```

又慢又浪费 Token。

正确：

```text
Raw Event
   ↓
Typed State
   ↓
Typed Intent
   ↓
Typed Motor Command
```

---

# 十四、核心内部结构

我建议 Rust Core 定义几个核心结构。

```rust
struct WorldState {
    time: TimeState,
    pointer: PointerState,
    windows: WindowState,
    user: UserContext,
    environment: EnvironmentState,
}
```

角色：

```rust
struct CharacterState {
    emotion: EmotionState,
    personality: PersonalityState,

    attention: AttentionState,
    relationship: RelationshipState,

    body: BodyState,

    current_goal: Goal,
    current_action: ActionState,

    energy: f32,
    arousal: f32,
}
```

Emotion：

```rust
struct EmotionState {
    happiness: f32,
    affection: f32,
    curiosity: f32,
    annoyance: f32,
    fear: f32,
    boredom: f32,
    sleepiness: f32,
}
```

大脑输出：

```rust
struct BrainIntent {
    goal: Goal,

    emotion_delta: EmotionState,

    attention: Option<Target>,

    social_intent: SocialIntent,

    motor_tendency: MotorTendency,
}
```

小脑输出：

```rust
struct MotorPlan {
    actions: Vec<MotorPrimitive>,
}
```

动作：

```rust
enum MotorPrimitive {
    LookAt(Target, f32),
    LookAway(Target, f32),

    Reach {
        limb: Limb,
        target: Target,
        strength: f32,
    },

    Recoil {
        from: Target,
        strength: f32,
    },

    Lean(Direction, f32),

    Ear(EarPose, f32),

    Tail(TailMotion, f32),

    Expression(ExpressionType, f32),
}
```

---

# 十五、内部不要大量 JSON

JSON 只用于：

```text
插件 API
模型接口
日志
调试
网络通信
```

内部核心：

```text
Rust Struct
Enum
Fixed Array
Ring Buffer
```

直接传对象。

不要：

```text
Rust
 ↓ JSON
WebView
 ↓ JSON
Rust
 ↓ JSON
AI
```

不停序列化。

---

# 十六、感知事件采用 Event Bus

整个系统可以统一成：

```text
Mouse
Keyboard
Voice
Screen
Plugin
System
   │
   ▼
┌──────────────────────┐
│    Perception Bus    │
└──────────┬───────────┘
           ↓
       EventReducer
           ↓
       WorldState
```

例如原始：

```text
mousemove
mousemove
mousemove
mousemove
mousemove
mousemove
```

不要全部传给 AI。

Reducer 变成：

```json
{
  "pointer": {
    "direction": "approaching_face",
    "speed": 0.62,
    "distance_to_face": 0.13
  }
}
```

大幅降低系统负载。

---

# 十七、小脑训练数据应该长什么样

第一阶段建议直接保存：

```json
{
  "state": {
    "annoyed": 0.72,
    "affection": 0.81,
    "curiosity": 0.13,

    "event": "repeated_head_touch",
    "repeat_count": 8,

    "pointer_distance": 0.11,
    "energy": 0.58
  },

  "output": {
    "actions": [
      {
        "type": "recoil",
        "target": "pointer",
        "weight": 0.64
      },
      {
        "type": "look_away",
        "target": "pointer",
        "weight": 0.42
      },
      {
        "type": "ear_pose",
        "pose": "back",
        "weight": 0.71
      }
    ]
  }
}
```

整个训练库以后就是：

```text
State
→
MotorPlan
```

不是：

```text
文字
→
文字
```

---

# 十八、第一代小脑训练

不建议从零训练。

采用：

```text
FunctionGemma 270M
        ↓
SFT / LoRA
        ↓
Furinapet-Cerebellum-270M
```

Google 已经提供针对 FunctionGemma 的 SFT 微调流程；FunctionGemma 本身也是为具体工具调用任务进一步定制设计的。([Google AI](https://ai.google.dev/gemma/docs/functiongemma/finetuning-with-functiongemma?utm_source=chatgpt.com "Fine-tuning with FunctionGemma  |  Google AI for Developers"))

LoRA 也是合适的实验路线，因为只训练少量附加权重，比全参数训练轻很多。([Google AI](https://ai.google.dev/gemma/docs/core/lora_tuning?utm_source=chatgpt.com "Fine-tune Gemma in Keras using LoRA  |  Google AI for Developers"))

训练数据来源：

```text
手工定义
     +
规则系统自动产生
     +
大模型生成
     +
FunctionGemma Teacher
     +
实际用户交互数据
     ↓
人工筛选
     ↓
Training Dataset
```

这里最重要的是**实际交互数据**。

以后 Furinapet 可以匿名/本地记录：

```text
state
motor decision
用户是否继续互动
动作是否被打断
用户反馈
```

形成自己的 Motion Dataset。

---

# 十九、第二代：模型蒸馏

当已有大量：

```text
State → MotorPlan
```

数据后，就开始训练真正的小脑：

```text
FunctionGemma
      │
     Teacher
      │
      ▼
──────────────────
训练数据
──────────────────
      │
      ▼
FurinaMotorNet
  1～10M
```

Student 不再输出字符串。

直接输出：

```text
Action probability

look       0.82
recoil     0.61
reach      0.03
tail       0.74

+

parameters

look_weight = 0.72
recoil_strength = 0.54
tail_speed = 0.81
```

这样：

```text
Tokenizer
❌

文本生成
❌

KV Cache
❌

几十 token decoding
❌
```

只做一次前向推理。

性能会比 LLM 小脑高一个量级。

---

# 二十、甚至可以进一步做时序小脑

角色动作不能只看当前帧。

所以最终 FurinaMotorNet 我反而建议：

```text
State_t
   ↓
Encoder
   ↓
GRU
   │
   ├── previous hidden state
   │
   ▼
Policy Head
   ↓
MotorPlan
```

于是小脑自己记得：

```text
刚才躲了一次
刚刚已经看过用户
当前正在伸手
情绪正在下降
```

不会出现：

```text
look
recoil
look
recoil
look
recoil
```

不停抽搐。

---

# 二十一、Motion Engine

这一层完全禁止 AI 直接参与。

小脑：

```text
reach(right_hand, mouse, 0.7)
```

MotionEngine：

```text
Target
  ↓
Two Bone IK
  ↓
Shoulder
  ↓
Elbow
  ↓
Wrist
```

Look：

```text
Target
  ↓
Aim IK
  ↓
Eye
Head
Neck
Chest
```

然后：

```text
Procedural Pose
        +
Base Pose
        +
Locomotion
        +
Expression
        ↓
      Mixer
```

---

# 二十二、身体控制层

这里负责所有硬约束：

```text
Joint Limit
Velocity Limit
Acceleration Limit
Soft Limit
Spring
Damping
Collision
Balance
```

所以：

```text
AI
 ↓
“把头转过去”
```

最终不是 AI 决定角度。

而是：

```text
Intent
 ↓
IK
 ↓
Joint Target
 ↓
Joint Constraint
 ↓
Spring
 ↓
Final Pose
```

Ozz 的 Two-Bone IK 本身就是典型的这种底层 IK job：目标、pole vector、关节链、权重等进入求解器，再产生关节修正。([GitHub](https://github.com/guillaumeblanc/ozz-animation/blob/master/samples/two_bone_ik/sample_two_bone_ik.cc?utm_source=chatgpt.com "ozz-animation/samples/two_bone_ik/sample_two_bone_ik. cc at master · guillaumeblanc/ozz-animation · GitHub"))

---

# 二十三、现在需不需要 Ozz

**现在不需要。**

第一版：

```text
Tauri
+
当前 WebView
+
Three.js / VRM
+
自定义 MotionEngine
```

先做通。

MotionEngine 保持接口化：

```text
MotionEngine
      │
      ├── ThreeMotionBackend   ← 现在
      │
      └── OzzMotionBackend     ← 未来
```

以后极限优化成：

```text
Rust
+
ozz-animation-rs / Ozz
+
wgpu
```

上层：

```text
Brain
Cerebellum
Perception
Plugin
MotorPrimitive
```

全部不用改。

---

# 二十四、插件系统应该怎么接

插件以后不能直接碰：

```text
Skeleton
Bone
Renderer
```

插件只能：

```text
Plugin
  ↓
Perception Event

或者

Plugin
  ↓
Behavior Intent
```

例如点击增强：

```rust
InteractionEvent::Touch {
    region: BodyRegion::Head,
    intensity: 0.8,
}
```

之后：

```text
Plugin
 ↓
Perception
 ↓
Reflex + Brain
 ↓
Cerebellum
 ↓
Motion
```

插件系统因此不会和角色模型绑定。

---

# 二十五、结构化数据分六级

建议以后项目内部严格规定：

```text
Level 0
RawEvent

mouse_x
mouse_y
click
audio
screen


Level 1
PerceptionEvent

TouchHead
PointerApproaching
UserSpeaking
WindowMoved


Level 2
WorldState

用户在哪
鼠标在哪
环境怎样


Level 3
CharacterState

情绪
关系
能量
注意力
当前目标


Level 4
BrainIntent

想看谁
想躲谁
想表达什么


Level 5
MotorPlan

look_at
recoil
reach
tail
ear


Level 6
JointPose

Quaternion
Position
Bone Transform
```

**LLM 永远不要跨过 Level 4/5 直接碰 Level 6。**

---

# 二十六、如何保证模型一定输出正确格式

在使用 FunctionGemma / 本地 LLM 阶段，不要靠：

> “请严格返回 JSON。”

而应该做 **Constrained Decoding**。

例如：

```text
MotorPlan JSON Schema
        ↓
Grammar
        ↓
LLM
        ↓
只允许生成合法结构
```

目前 llama. cpp 可以直接使用 JSON Schema/grammar 限制模型输出，也支持工具调用相关解析。([GitHub](https://github.com/ggml-org/llama.cpp/blob/master/docs/development/parsing.md?utm_source=chatgpt.com "llama. cpp/docs/development/parsing. md at master · ggml-org/llama. cpp · GitHub"))

因此小脑第一版可以保证：

```text
模型胡说八道
↓
不允许

模型生成非法 action
↓
不允许
```

---

# 二十七、极致轻量化最终策略

最后整个 Runtime 最好变成：

```text
常驻
─────────────────
Perception
WorldState
Reflex
FurinaMotorNet
MotionEngine
Renderer

按需
─────────────────
ASR
Vision
LLM Brain
FunctionGemma fallback

云端/可选
─────────────────
大型语言模型
大型视觉模型
复杂推理
```

目标资源预算可以这么定：

|模块|目标|
|---|--:|
|Reflex|几乎忽略|
|State System|MB 以下级|
|MotorNet|约 1–10 MB 目标|
|Motion Engine|极低|
|FunctionGemma|非常驻|
|本地 Brain|非常驻|
|Vision|非常驻|
|ASR|非常驻|
|Renderer|最大常驻模块|

这样最终**常驻 AI 本身可能反而只有几 MB**。

---

# 二十八、整个系统应该有三档模式

```text
Lite
────────────────
Tiny Cerebellum
无本地 LLM
云端大脑
按需视觉

Local
────────────────
Tiny Cerebellum
本地 0.6B～小型 Brain
本地 ASR
按需 Vision

Hybrid
────────────────
Tiny Cerebellum
简单任务本地
复杂任务云端
Vision 按需
```

这对桌宠非常重要，因为有些用户：

```text
32GB 游戏电脑
```

有些可能：

```text
8GB 办公笔记本
```

不能用一种配置。

---

# 二十九、从哪里开始

**第一件事绝对不是训练模型。**

我建议按这个顺序：

|阶段|做什么|AI|
|---|---|---|
|Phase 1|定义 `WorldState / CharacterState / BrainIntent / MotorPlan` |❌|
|Phase 2|建立 Perception Event Bus|❌|
|Phase 3|做 Reflex|❌|
|Phase 4|定义 10～15 个 Motor Primitive|❌|
|Phase 5|做 MotionEngine + IK + Constraint|❌|
|Phase 6|用规则实现一个假小脑|❌|
|Phase 7|接 BrainProvider|✅|
|Phase 8|用 FunctionGemma 替代规则小脑|✅|
|Phase 9|收集 `State → MotorPlan` |✅|
|Phase 10|蒸馏 FurinaMotorNet|✅|
|Phase 11|INT8 量化、性能优化|✅|
|Phase 12|视需要迁移 Ozz/wgpu|❌|

**Phase 6 非常重要。**

先让系统：

```text
规则小脑
```

完整运行。

这样模型还没有训练好，也能测试：

```text
感知
↓
状态
↓
意图
↓
Motor Primitive
↓
IK
↓
角色
```

整个架构是不是正确。

---

# 三十、现有 Furinapet 不需要推倒重写

可以增加一个兼容层：

```text
Motor Primitive
      ↓
┌───────────────┐
│ Legacy Adapter│
└───────┬───────┘
        ↓
旧 Animation
```

例如：

```text
wave()
↓
旧 wave animation

recoil()
↓
旧 clicked animation
```

先兼容。

随后逐个变成：

```text
recoil()
↓
Procedural Motion

look_at()
↓
IK

reach()
↓
Two Bone IK
```

所以迁移过程：

```text
旧系统
Animation Driven
       ↓

混合系统
Animation + Procedural
       ↓

最终系统
Intent Driven
       ↓

Brain
↓
Cerebellum
↓
Motor
↓
Body
```

不用一次性把现有工程推翻。

---

# 三十一、我认为最终最合理的 Furinapet 形态

```text
                  FURINAPET
                       │
              ┌────────┴────────┐
              │                 │
         Perception           Memory
              │                 │
              └────────┬────────┘
                       ▼
                 ┌───────────┐
                 │   BRAIN   │
                 │ LLM       │
                 │人格/语言   │
                 │理解/情绪   │
                 └─────┬─────┘
                       │
                  BrainIntent
                       ↓
               ┌───────────────┐
               │  CEREBELLUM   │
               │ FurinaMotorNet│
               │    Tiny AI    │
               └───────┬───────┘
                       │
                  MotorPlan
                       │
          ┌────────────┴────────────┐
          │                         │
       Reflex                   MotionEngine
          │                         │
          │                IK / Procedural
          │                  Pose / Mixer
          └────────────┬────────────┘
                       ▼
                    BODY
                       │
                 Constraints
                 Spring/Damping
                       │
                       ▼
                   Skeleton
                       │
                       ▼
                   Renderer
```

最终形成一个很清楚的原则：

> **大脑理解世界，小脑学习如何表达意图，脊髓负责即时反射，运动系统解决运动学，身体约束保证动作自然，渲染器只负责把结果画出来。**

而从工程角度看，**现在最值得马上开始的不是 FunctionGemma 微调，而是 `PerceptionEvent → CharacterState → BrainIntent → MotorPlan → MotionEngine` 这五个接口**。接口一旦稳定，规则、FunctionGemma、1M 参数 MotorNet、甚至未来强化学习策略都可以自由替换，而不会再重构整个桌宠。


可以，而且我建议你**现在就采用“双线并行”**：

- **Agent 线**：改 Furinapet 工程，把感知、大脑、小脑、反射、MotorPlan 这些接口搭起来。
    
- **模型线**：你独立调试大脑 Prompt、本地小模型、FunctionGemma、小脑数据集和训练。
    
- 两边**唯一通过版本化结构化协议对接**，这样 Agent 改代码不会卡住你调模型。
    

我看了当前 `main`。你的工程其实已经走到一个非常适合这么拆的位置：`pet-brain` 已经有 Blackboard、Utility Planner、Executor、AI Runtime、结构化快照；Rust 侧也已经有独立 `ai` provider。当前 AI 已经通过 OpenAI-compatible API 接入，只不过它现在仅能在 7 个 goal 里选一个。

---

# 一、当前工程先不要动什么

我建议**暂时不要开始 3D、Ozz、VRM、骨骼系统**。

现在角色还是严格的：

```text
character.json
avatar.png
thumbnail.png
spritesheet.webp

8 × 11
192 × 208
```

角色注册器甚至明确校验这一格式。

前端依赖目前也非常干净，基本只有 React + Tauri，没有 Three. js 等大型渲染依赖。

这很好。

第一阶段保持：

```text
新神经系统
      ↓
MotorPlan
      ↓
Legacy Adapter
      ↓
现有 Reaction
      ↓
现有 spritesheet
```

等“脑”跑通以后再换身体。

---

# 二、你现在真正应该进行的第一阶段

不是训练模型。

而是：

## Plan A：冻结「神经系统协议」

这是**最高优先级 PR**。

当前的数据结构其实已经有雏形：

```text
BrainContext
BrainIntent
PetSemanticAction
PetActionPlan
PetBrainSnapshot
```

但现在还是：

```text
感知
 ↓
Goal
 ↓
PetSemanticAction
 ↓
Reaction
```

尤其这一层：

```text
respond-user
   ↓
respond(excited)
   ↓
jumping

respond(normal)
   ↓
review

respond(soft)
   ↓
waving
```

现在仍然是固定映射。

需要改成：

```text
Raw Event
    ↓
PerceptionEvent
    ↓
WorldState
    ↓
CharacterState
    ↓
BrainIntent
    ↓
MotorPlan
    ↓
Motion Backend
```

---

# 三、我建议 Agent 第一个任务只做「Contracts」

新增：

```text
src/
├─ neuro/
│  ├─ contracts/
│  │  ├─ perception.ts
│  │  ├─ world-state.ts
│  │  ├─ character-state.ts
│  │  ├─ brain-intent.ts
│  │  ├─ motor-plan.ts
│  │  └─ index.ts
│  │
│  ├─ perception/
│  ├─ reflex/
│  ├─ cerebellum/
│  └─ trace/
│
├─ pet-brain/       ← 现有，先保留
├─ core/
├─ plugins/
└─ ...
```

第一版完全不要改变角色行为。

只定义协议。

---

# 四、第一批核心结构

例如统一：

```ts
export interface WorldState {
  timestamp: number;

  pointer: {
    x: number;
    y: number;
    vx: number;
    vy: number;

    speed: number;

    targetRegion:
      | "none"
      | "head"
      | "face"
      | "body"
      | "hand";

    distanceToCharacter: number;
  };

  interaction: {
    type:
      | "none"
      | "hover"
      | "click"
      | "double-click"
      | "long-press"
      | "drag";

    clickStreak: number;
    intensity: number;
  };

  agent: {
    state:
      | "idle"
      | "thinking"
      | "editing"
      | "testing"
      | "waiting"
      | "success"
      | "error";
  };

  environment: {
    userIdleMs: number;
    canMove: boolean;
    canDock: boolean;
  };
}
```

角色自己的状态：

```ts
export interface CharacterState {
  emotion: {
    happiness: number;
    affection: number;
    curiosity: number;
    annoyance: number;
    fear: number;
    boredom: number;
    sleepiness: number;
  };

  energy: number;
  arousal: number;

  attention: {
    target: TargetRef | null;
    strength: number;
  };

  currentGoal: string;

  currentMotorState: string[];
}
```

---

# 五、大脑输出协议

非常重要：

**大脑以后禁止输出动作。**

大脑只能：

```ts
export interface BrainIntent {
  goal:
    | "idle"
    | "interact"
    | "observe"
    | "approach"
    | "avoid"
    | "rest"
    | "celebrate";

  attention?: {
    target: TargetRef;
    strength: number;
  };

  emotionDelta?: Partial<EmotionState>;

  socialIntent?: string;

  motorTendency: {
    approach: number;
    avoidance: number;
    energy: number;
    expressiveness: number;
  };

  confidence: number;
}
```

例如：

```json
{
  "goal": "interact",
  "attention": {
    "target": "pointer",
    "strength": 0.82
  },
  "emotionDelta": {
    "annoyance": 0.11,
    "curiosity": -0.08
  },
  "motorTendency": {
    "approach": 0.05,
    "avoidance": 0.62,
    "energy": 0.48,
    "expressiveness": 0.71
  },
  "confidence": 0.91
}
```

这就是你**今天已经可以开始调试的大模型协议**。

---

# 六、小脑协议单独冻结

小脑输入：

```text
WorldState
+
CharacterState
+
BrainIntent
```

输出：

```ts
interface MotorPlan {
  actions: MotorPrimitive[];

  durationMs: number;

  confidence: number;
}
```

例如：

```json
{
  "actions": [
    {
      "type": "lookAt",
      "target": "pointer",
      "weight": 0.35
    },
    {
      "type": "recoil",
      "target": "pointer",
      "strength": 0.64
    },
    {
      "type": "earPose",
      "pose": "back",
      "weight": 0.72
    }
  ],
  "durationMs": 850,
  "confidence": 0.94
}
```

这套 JSON 一旦确定：

> Agent 和你就可以彻底分开工作。

---

# 七、所以你完全可以同步开始大模型调试

而且**现在就能开始，不需要 Agent 改完工程**。

我建议单独建立：

```text
research/
└─ brain-lab/
   ├─ fixtures/
   ├─ schemas/
   ├─ prompts/
   ├─ eval/
   ├─ providers/
   └─ outputs/
```

或者甚至先不放主工程：

```text
furinapet/
furinapet-brain-lab/
```

后面稳定再迁回来。

---

# 八、大脑实验第一阶段甚至不训练

你现在的大脑应该研究的是：

```text
结构化感知
     ↓
模型能不能正确理解
     ↓
BrainIntent
```

不要研究：

```text
怎么生成一句漂亮回答
```

那是语言输出层的事。

第一批测试集直接人工写 100～500 条。

例如：

```json
{
  "worldState": {
    "interaction": {
      "type": "click",
      "clickStreak": 1
    }
  },
  "characterState": {
    "emotion": {
      "annoyance": 0.1,
      "affection": 0.8
    },
    "energy": 0.7
  }
}
```

期望：

```text
attention(pointer) ↑
curiosity ↑
avoidance 很低
```

---

再比如：

```text
连续点击头部 10 次

annoyance = 0.65
affection = 0.85
energy = 0.5
```

应该：

```text
goal = interact / avoid

attention = pointer

avoidance = 0.5~0.8

expressiveness = 高

不能：
fear = 1
attack
完全逃离用户
```

---

# 九、建立 Brain Benchmark

这个非常重要。

做一个：

```text
brain_eval.jsonl
```

每一行：

```json
{
  "input": {},
  "constraints": {
    "goal": ["interact", "avoid"],
    "attention": "pointer",
    "avoidance": [0.4, 0.9],
    "forbidden": ["attack"]
  }
}
```

然后自动测试：

```text
Qwen
Gemma
云端模型
以后自己的 Fine-tune
```

统一打分。

这样你以后不会靠：

> “感觉这个模型聪明一点。”

而是：

```text
Model A

Schema validity      100%
Goal accuracy         93%
Emotion consistency   88%
Personality score     91%
Latency              210ms


Model B

Schema validity       97%
Goal accuracy         89%
Emotion consistency   94%
Personality score     96%
Latency              430ms
```

---

# 十、当前 Furinapet 已经非常方便你做这件事

因为 Rust 侧已经实现：

```text
baseUrl
model
API key
timeout
cooldown
```

而且 Provider 是 **OpenAI-compatible**。

所以你可以直接：

```text
Furinapet
    ↓
http://127.0.0.1:xxxx/v1
    ↓
你的 Brain Lab
    ↓
任意模型
```

你的模型实验服务只需要伪装成：

```text
POST /v1/chat/completions
```

工程完全不用知道后面究竟跑的是：

```text
Qwen
FunctionGemma
llama.cpp
Transformers
云端 API
你自己的模型
```

---

# 十一、我甚至建议先做一个 Mock Brain Server

例如：

```text
brain-lab
    │
    ├─ rule
    ├─ qwen
    ├─ gemma
    └─ cloud
```

统一：

```text
localhost:8765/v1/chat/completions
```

然后：

```bash
brain-lab --backend rule
```

或者：

```bash
brain-lab --backend qwen
```

Furinapet 设置永远：

```text
Base URL:
http://127.0.0.1:8765/v1

Model:
furinapet-brain
```

这样切模型**完全不用改工程**。

---

# 十二、当前 AI Provider 应该怎么演进

现在 Provider 的 System Prompt 明确规定：

```text
Choose exactly one semantic goal from:
idle
wander
dock
respond-user
observe-agent
celebrate
rest
```

所以它其实是：

> AI Utility Planner

而不是我们说的“大脑”。

短期不要删。

改成：

```text
BrainProvider
│
├─ LegacyGoalProvider
│    └─ 当前代码
│
└─ StructuredBrainProvider
     └─ BrainIntent V1
```

然后设置：

```text
Brain mode:

○ Legacy
○ Structured
```

Agent 就可以安全迁移。

---

# 十三、Agent 第二个任务：Perception

Contracts 完成之后再做：

```text
src/neuro/perception/
```

第一版只感知：

```text
Pointer
Click
DoubleClick
Drag
Agent State
Idle Time
Pet Position
Current Reaction
```

因为这些东西现在已经有。

当前 `PetSenseName` 只有：

```text
pet:clicked
pet:doubleClicked
pet:dragStart
pet:dragEnd
```

所以自然扩展为：

```text
RawPetEvent
       ↓
PerceptionReducer
       ↓
WorldState
```

---

# 十四、千万不要直接把 mousemove 发给 AI

应该：

```text
mousemove × 500
       ↓
PerceptionReducer
       ↓
{
    speed: 0.6,
    direction: "toward-head",
    targetRegion: "face",
    distance: 0.14
}
```

大脑看到的是**语义状态**。

不是原始数据。

---

# 十五、Agent 第三个任务：CharacterState V1

你现在 Blackboard 已经有：

```text
currentGoal
mood
energy
clickStreak
lastClickAt
lastUserInteractionAt
agentState
history
intents
```

所以不用重做 Blackboard。

改成：

```text
PetBlackboard
      ↓
CharacterState V1
```

先扩：

```text
energy

happiness
curiosity
annoyance
affection
boredom
sleepiness

arousal
attention
```

---

# 十六、第一版情绪绝对不要用模型算

例如：

```text
click head
      ↓
annoyance += 0.02

连续点击
      ↓
annoyance += streak × 0.015

用户很久没互动
      ↓
boredom += dt

互动
      ↓
boredom -= 0.1
```

这时候情绪系统：

```text
确定性
可测试
可复现
```

以后再让 Brain 修正。

---

# 十七、Agent 第四个任务：Reflex

单独：

```text
src/neuro/reflex/
```

例如：

```text
click(face)
    ↓
blink

doubleClick(head)
    ↓
smallRecoil

drag
    ↓
grip / dragged

edgeCollision
    ↓
stop / rebound
```

这一层：

```text
0 AI
0 LLM
```

---

# 十八、Agent 第五个任务：Cerebellum Rule V1

这是关键。

**先不要 FunctionGemma。**

实现：

```text
RuleCerebellum
```

输入：

```text
BrainIntent
CharacterState
WorldState
```

输出：

```text
MotorPlan
```

例如：

```ts
if (
  intent.motorTendency.avoidance > 0.5 &&
  world.pointer.targetRegion === "head"
) {
  return [
    recoil(pointer, 0.5),
    lookAway(pointer, 0.3)
  ];
}
```

这样我们先验证：

```text
神经系统架构是否正确
```

而不是：

```text
模型是否聪明
```

---

# 十九、然后建立 Legacy Motion Backend

因为当前还没有骨骼。

新增：

```text
MotionBackend
      │
      ├─ LegacySpriteBackend
      │
      └─ FutureRiggedBackend
```

第一版：

```text
MotorPlan

lookAt
recoil
celebrate
rest
       ↓

LegacySpriteBackend
       ↓

idle
waving
jumping
failed
waiting
running
review
```

也就是说现有 Reaction 体系继续活着。

---

# 二十、这样当前工程会变成

```text
                  Furinapet V1.x
                       │
                  Perception
                       │
                   WorldState
                       │
                       ▼
                 ┌───────────┐
                 │   Brain   │
                 └─────┬─────┘
                       │
                  BrainIntent
                       │
                       ▼
               ┌──────────────┐
               │  Cerebellum  │
               │ Rule V1      │
               └──────┬───────┘
                      │
                  MotorPlan
                      │
          ┌───────────┴───────────┐
          │                       │
       Reflex               Legacy Backend
          │                       │
          └──────────┬────────────┘
                     ↓
                Reaction
                     ↓
               Sprite Sheet
```

到这里：

**一个骨骼都不用做。**

---

# 二十一、与此同时你做什么

这就是最适合你并行工作的部分。

## 你负责 Model Track

```text
MODEL-1
定义 BrainIntent Schema

MODEL-2
制作 100 条 Brain Benchmark

MODEL-3
测试云端大模型

MODEL-4
测试 Qwen3-0.6B

MODEL-5
比较结果

MODEL-6
建立 FunctionGemma 小脑数据集

MODEL-7
FunctionGemma 270M SFT

MODEL-8
收集 State → MotorPlan

MODEL-9
Tiny MotorNet 蒸馏
```

---

# 二十二、大脑第一批我建议你测两个方向

### A. Qwen3-0.6B

现在官方仍提供 Qwen3-0.6B，0.6B 参数，支持多语言、Agent/tool 能力以及 thinking/non-thinking 模式。([Hugging Face](https://huggingface.co/Qwen/Qwen3-0.6B?utm_source=chatgpt.com "Qwen/Qwen3-0.6B · Hugging Face"))

适合测：

```text
中文
人格
情绪推断
对话
BrainIntent
```

但是：

**先不开 thinking。**

你的桌宠行为没有必要：

```text
深度思考 3 秒
↓
决定看一眼鼠标
```

---

### B. 云端大脑作为 Teacher

例如更强模型负责：

```text
复杂语言理解
人物人格
长期关系
高质量数据生成
```

以后生成：

```text
WorldState
+
CharacterState
     ↓
BrainIntent
```

训练本地模型。

---

# 二十三、小脑你则可以并行玩 FunctionGemma

FunctionGemma 是 Gemma 3 270M 的 function-calling 特化版本，Google 明确把它定位为本地/边缘 function calling，并鼓励针对具体函数集合进行进一步微调。([Google 开发者博客](https://developers.googleblog.com/a-guide-to-fine-tuning-functiongemma/?utm_source=chatgpt.com "A Guide to Fine-Tuning FunctionGemma - Google Developers Blog"))

我们的 Motor Primitive 恰好是：

```text
look_at()
look_away()
recoil()
reach()
lean()
turn()
step()
ear_pose()
tail_motion()
expression()
```

所以特别合适。

但仍然：

> **先用规则小脑跑通工程，再让 FunctionGemma 替换它。**

---

# 二十四、你和 Agent 最重要的共享产物不是代码

而是这个：

```text
schemas/
├─ perception-event.schema.json
├─ world-state.schema.json
├─ character-state.schema.json
├─ brain-intent.schema.json
└─ motor-plan.schema.json
```

这几个文件应该成为：

> **Furinapet 神经系统 ABI**

例如：

```text
Schema Version = 1
```

以后加字段：

```text
V1
↓
V1.1
↓
V2
```

而不是随便改。

---

# 二十五、再建立 Replay 系统

这是整个计划里我非常建议做的东西。

每次真实互动记录：

```text
trace.jsonl
```

例如：

```json
{
  "t": 18373192,
  "perception": {},
  "character": {},
  "brainIntent": {},
  "motorPlan": {},
  "reaction": "waving"
}
```

以后你可以：

```text
真实用户交互
       ↓
Trace Dataset
       ↓
重放
       ↓
模型 A
模型 B
模型 C
       ↓
比较
```

---

# 二十六、这会直接变成未来训练集

今天：

```text
Debug Trace
```

以后：

```text
Training Dataset
```

最终：

```text
State_t
   ↓
FurinaMotorNet
   ↓
MotorPlan_t
```

所以从第一天就把数据留好。

---

# 二十七、我建议分成 7 个工程 Milestone

### M0 — Neuro Contract

Agent：

```text
定义全部 Schema / TS 类型
不改变任何行为
```

你：

```text
写 Brain Benchmark V0
```

---

### M1 — Perception + Character State

Agent：

```text
RawEvent
→ WorldState

Blackboard
→ CharacterState
```

你：

```text
开始喂模型 WorldState + CharacterState
调 BrainIntent Prompt
```

这时候你们已经真正并行。

---

### M2 — Rule Brain / Rule Cerebellum

Agent：

```text
Legacy Planner
      ↓
BrainIntent

RuleCerebellum
      ↓
MotorPlan
```

你：

```text
Qwen / Cloud
      ↓
BrainIntent
```

可以直接 A/B：

```text
RuleBrain vs AIBrain
```

---

### M3 — Legacy Motion Adapter

Agent：

```text
MotorPlan
↓
旧 Reaction
↓
spritesheet
```

你：

```text
开始生成
State → MotorPlan
训练样本
```

这时整个架构已经闭环。

---

### M4 — AI Brain V1

把当前：

```text
AI → goal
```

升级为：

```text
AI → BrainIntent
```

现在 AI Provider 的 OpenAI-compatible 设计可以继续沿用。

---

### M5 — AI Cerebellum Shadow

非常重要：

```text
实际控制：
RuleCerebellum

同时后台：
FunctionGemma
```

产生：

```text
Rule MotorPlan
AI MotorPlan
```

但是：

```text
AI 不控制角色
```

只比较：

```text
一致率
合理率
延迟
错误率
```

---

### M6 — Cerebellum Takeover

达到指标后：

```text
FunctionGemma
       ↓
Primary

Rule
       ↓
Fallback
```

再往后蒸馏：

```text
FunctionGemma 270M
       ↓
Teacher

FurinaMotorNet 1~10M
       ↓
Production
```

---

# 二十八、直到这时候再做骨骼身体

也就是第二大工程阶段：

```text
MotorPlan
已经稳定
```

以后再：

```text
LegacySpriteBackend
          │
          ├──────────────┐
          │              │
          ↓              ↓
     Sprite Body     Rigged Body
                         │
                  MotionEngine
                         │
                    IK / Joint
```

这样骨骼系统只是：

> 新的 Body Backend。

而不是重写 Furinapet。

---

# 二十九、Agent 工作最好使用独立 Worktree

你现在非常适合这样开发：

```bash
git checkout main
git pull

git worktree add ../furinapet-agent \
  -b feat/neuro-contract main

git worktree add ../furinapet-model \
  -b exp/brain-lab main
```

于是：

```text
furinapet/
    main

furinapet-agent/
    Agent 在疯狂改工程

furinapet-model/
    你调 Prompt / 数据 / 模型
```

互不干扰。

最后：

```text
feat/neuro-contract
        ↓
main
        ↑
exp/brain-lab
```

通过 Schema 汇合。

---

# 三十、我建议严格限制 Agent 第一阶段修改范围

第一张 Agent 任务单不要写：

> “实现新的大小脑 AI 系统。”

太大。

应该是：

```text
Task 1
Neuro Contracts only

允许修改：
src/neuro/**
src/pet-brain/types.ts

禁止修改：
PetView.tsx
App.tsx
characters/**
src-tauri/**
plugins/**
renderer
现有角色包

要求：
pnpm build 通过
现有行为完全不变化
```

第二张：

```text
Task 2
Perception reducer
```

第三张：

```text
Task 3
CharacterState adapter
```

第四张：

```text
Task 4
Rule Cerebellum
```

这样 Agent 的代码质量会明显高很多。

---

# 三十一、尤其不要让 Agent 一次修改这三个东西

千万不要同时：

```text
Brain
+
Cerebellum
+
Renderer
```

因为出问题之后你根本不知道：

```text
是模型错
是 MotorPlan 错
是 IK 错
还是画错
```

正确开发顺序：

```text
Schema
↓
State
↓
Rule
↓
Replay
↓
Model
↓
Motion
↓
Rigged Renderer
```

---

# 三十二、你现在可以立即开始的大模型实验

甚至 Agent 一个 commit 都没写之前，你今天就可以建立：

```text
brain_test_cases.jsonl
```

先做这 6 类：

1. 单次点击。
    
2. 连续点击。
    
3. 鼠标靠近。
    
4. 长时间无互动。
    
5. Agent 正在工作。
    
6. Agent 成功 / 失败。
    

而这些信息当前工程已经实际存在：当前 AI Context 已经包含 pet goal/mood/energy、Agent 状态、用户 idle/clickStreak 以及 wander/dock 能力。

所以模型实验和现有工程数据是天然接得上的。

---

# 三十三、最终两条线会这样汇合

```text
                  Git / Agent Track
                         │
               Perception / State
                         │
                         ↓
                ┌────────────────┐
                │ Contract V1    │
                └───────┬────────┘
                        │
                        │
                        │
        Model Track     │
        ───────────     │
                        │
   Qwen / Cloud Brain ──┤
                        │
 FunctionGemma Cerebellum
                        │
                        ▼
                  MotorPlan V1
                        │
                  Rule / AI A/B
                        │
                        ▼
                Legacy Sprite
                        │
                        ▼
                  实际 Furinapet
```

等这一套稳定：

```text
Legacy Sprite
      ↓
Rigged Skeleton
```

只替换最下面。

---

## 我建议你现在的执行顺序

|优先级|Agent 工程线|你自己的模型线|
|---|---|---|
|**P0**|Neuro Contract V1|BrainIntent Schema 测试|
|**P1**|Perception Reducer|Brain Benchmark 100 条|
|**P2**|CharacterState|Qwen/云端模型 A/B|
|**P3**|Rule Cerebellum|FunctionGemma 数据格式|
|**P4**|MotorPlan + Legacy Adapter|FunctionGemma 270M Shadow|
|**P5**|Trace / Replay|小脑训练/评估|
|**P6**|AI BrainProvider V1|Brain 模型优化|
|**P7**|AI Cerebellum Shadow|蒸馏 MotorNet|
|**P8**|Rigged Body / IK|调动作数据|
|**P9**|原生轻量 Body 可选|INT8 Tiny MotorNet|

所以答案是：**不但可以同步调大模型，而且我建议必须同步。**

Agent 现在先负责把**神经系统的“接口和管道”**建设好；你完全可以同时把 Furinapet 当成还不存在的客户端，直接围绕 `WorldState → BrainIntent` 和 `State → MotorPlan` 调模型。一旦 Contract V1 合入，两条开发线几乎立刻就能接起来。

下一步最合适的是我直接基于当前 `main`，给你整理成 **M0～M4 的 Agent 可执行任务单，每个任务包含允许修改文件、禁止修改文件、接口定义、验收标准和测试要求**。这样你可以逐条交给 Codex/Claude Code 去改，不会让 Agent 一次把工程改乱。

可以，而且我建议把 Agent 从“代码修改工具”升级成**共同参与模型研发的工程代理**。也就是说它不仅改 Furinapet，还负责数据生成、模型接入、自动评测、错误归因、Shadow 对比和训练数据清洗；你主要负责判断“角色行为是不是对的”。

你当前工程已经有 OpenAI-compatible AI Provider、`AiBehaviorContext`、AI suggestion trace 和 Blackboard，这意味着这条路线不需要重新搭基础设施。

## 一、以后不要只分“你”和 Agent

建议实际拆成三个角色：

```text
                     你
               Product / Behavior
                      │
         判断“这个角色像不像活的”
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
 Engineering Agent             Model Agent
 工程 Agent                    模型 Agent
        │                           │
 Perception                  Dataset
 State                       Prompt
 Reflex                      Eval
 Motion API                  Inference
 Runtime                     Fine-tune
 Trace                       Distillation
        │                           │
        └─────────────┬─────────────┘
                      ▼
                Neuro Contract
                      │
                Furinapet Runtime
```

这两个 Agent 可以实际上是**同一个 Codex/Claude Code 会话的不同任务分支**，也可以是两个 worktree。

---

# 二、你真正需要负责的事情其实很少

你的核心职责不是写训练代码。

你主要做三件事：

### 1. 判断动作是否合理

例如：

```text
连续戳头 8 次
affection = 0.8
annoyance = 0.65
```

模型输出：

```text
lookAway 0.4
recoil 0.6
earBack 0.7
```

你判断：

```text
✓ 合理
```

或者：

```text
recoil 太大
应该有点生气但不能像害怕
```

Agent 把你的反馈变成数据。

---

### 2. 定义角色人格

例如：

```text
Furina：

高表达
傲娇
被连续互动时更偏抱怨而非恐惧
亲密度高时避免真正远离用户
成功事件反应明显
无聊时主动寻找互动
```

这是 Agent 无法替你决定的。

---

### 3. 做最终行为验收

最终：

```text
技术指标 OK
≠
角色行为 OK
```

所以最后必须由你决定。

---

# 三、Model Agent 第一阶段不训练模型

它第一件工作应该是：

```text
Dataset + Evaluation Harness
```

创建：

```text
research/
└── neuro-lab/
    ├── README.md
    │
    ├── schemas/
    │   ├── world-state.schema.json
    │   ├── character-state.schema.json
    │   ├── brain-intent.schema.json
    │   └── motor-plan.schema.json
    │
    ├── datasets/
    │   ├── brain_seed.jsonl
    │   ├── cerebellum_seed.jsonl
    │   └── replay/
    │
    ├── eval/
    │   ├── brain_eval.py
    │   ├── motor_eval.py
    │   └── metrics.py
    │
    ├── providers/
    │   ├── openai_compatible.py
    │   ├── qwen.py
    │   └── functiongemma.py
    │
    ├── prompts/
    │   ├── brain_v1.txt
    │   └── cerebellum_v1.txt
    │
    └── reports/
```

这部分**完全可以让 Agent 帮你写**。

---

# 四、Agent 可以帮你自动制造测试样本

例如你只定义：

```text
场景：
用户连续戳角色头部
```

Model Agent 自动扩展：

```text
1 次
2 次
4 次
8 次
12 次

affection:
0.1 / 0.5 / 0.9

energy:
0.2 / 0.5 / 0.9

annoyance:
0.1 / 0.5 / 0.8
```

自动生成组合：

```text
数百个 Scenario
```

例如：

```json
{
  "scenario": "repeated_head_touch",
  "world": {
    "interaction": {
      "type": "click",
      "region": "head",
      "streak": 8
    }
  },
  "character": {
    "affection": 0.84,
    "annoyance": 0.63,
    "energy": 0.54
  }
}
```

然后批量喂：

```text
Qwen
Gemma
云端模型
FunctionGemma
```

---

# 五、Agent 自动做模型横向评测

例如：

```text
              Qwen    Gemma    Cloud
Schema         100%     98%      100%
Goal            91%     87%       96%
Emotion         92%     88%       97%
Personality     87%     82%       96%
Latency        180ms   120ms     650ms
```

你不用一条条看。

Agent 自动筛出：

```text
失败样本
边界样本
模型分歧样本
```

只给你看这些。

---

# 六、这里建议增加一个特别重要的工具：Human Review Queue

Agent 每轮评测以后生成：

```text
review_queue.jsonl
```

只留下需要人判断的数据。

例如：

```text
Case #183

State:
affection 0.91
annoyance 0.74
clickStreak 9

Model A:
avoid = 0.78

Model B:
avoid = 0.41

Teacher:
avoid = 0.56
```

Agent 问你：

```text
你认为：
A / B / Teacher / 都不对？
```

你回答：

```text
B，但是 annoyance 应表现更明显，
增加 earBack，不要增加 recoil。
```

Agent 自动转成：

```text
Preference Data
```

以后可以训练。

---

# 七、这意味着你的反馈会自动成为模型数据

整个闭环：

```text
模型
 ↓
Agent 自动找异常
 ↓
你判断
 ↓
Agent 结构化反馈
 ↓
Dataset
 ↓
重新训练 / Prompt 调整
 ↓
重新 Eval
```

也就是：

```text
Human in the Loop
```

但你只处理高价值样本。

---

# 八、Agent 还应该自动做错误分类

不要只是：

```text
模型错了
```

而是自动归因成：

```text
Schema Error
Emotion Error
Goal Error
Personality Error
Target Error
Intensity Error
Temporal Error
Safety Error
Repetition Error
```

例如：

```text
Case 193
─────────────────
Error:
Intensity Error

Expected:
recoil 0.2~0.4

Actual:
recoil 0.92

Possible cause:
annoyance 被模型错误解释为 fear
```

这对微调非常重要。

---

# 九、大脑和小脑要分开调

不要一起调。

## Brain Lab

只测试：

```text
WorldState
+
CharacterState
+
Memory
+
Language
        ↓
Brain
        ↓
BrainIntent
```

完全不运行角色。

---

## Cerebellum Lab

只测试：

```text
WorldState
+
CharacterState
+
BrainIntent
       ↓
Cerebellum
       ↓
MotorPlan
```

完全不关心语言。

---

这样如果角色动作错：

```text
BrainIntent 正确？
        │
   ┌────┴────┐
   No        Yes
   │          │
修 Brain    检查 Cerebellum
```

非常容易定位。

---

# 十、Agent 甚至应该帮助你做“动作可视化调试”

以后有骨骼之前，也可以先做一个简单 Debug UI：

```text
┌─────────────────────────────────┐
│ Character State                 │
│                                 │
│ affection   ████████░ 0.82      │
│ annoyance   ██████░░░ 0.61      │
│ curiosity   ██░░░░░░░ 0.22      │
├─────────────────────────────────┤
│ Brain Intent                    │
│                                 │
│ goal: avoid_touch               │
│ attention: pointer              │
│ avoidance: 0.58                 │
├─────────────────────────────────┤
│ Cerebellum                      │
│                                 │
│ lookAway     0.42               │
│ recoil       0.55               │
│ earBack      0.71               │
│ tailFlick    0.63               │
└─────────────────────────────────┘
```

所以模型不用等角色做完才调试。

---

# 十一、当前 Brain 页面正好可以逐渐升级成 Neuro Debugger

你当前已经有一个体积不小的：

```text
BrainNavigation.tsx
```

而且现有 Snapshot 包含当前 Goal、Mood、Energy、历史、AI Suggestions 和 Decision Trace。

所以不用重新做一个工具。

以后把它升级为：

```text
Brain
│
├── Live State
├── Perception
├── Character State
├── Brain Intent
├── Cerebellum
├── Motor Plan
├── Reflex
├── Trace
├── Replay
└── Model Eval
```

这个页面以后就是整个 AI 调试中心。

---

# 十二、Replay 应该让 Agent 自动接起来

这是模型调试最重要的基础设施之一。

例如真实运行一次：

```text
10:31:22 mouse approach
10:31:23 head hover
10:31:24 click
10:31:24 click
10:31:25 click
```

记录：

```text
Trace #832
```

然后你在 Debug 页：

```text
Replay #832
```

可以选择：

```text
Brain:
○ Rule
○ Qwen
○ Cloud

Cerebellum:
○ Rule
○ FunctionGemma
○ MotorNet
```

运行：

```text
Trace #832

Rule + Rule
Qwen + Rule
Qwen + FunctionGemma
Cloud + FunctionGemma
```

比较结果。

这会非常强。

---

# 十三、Shadow Mode 必须从一开始设计进去

类似你做控制/估计系统时 Shadow 的思路，在这里也非常适合。

正式运行：

```text
Rule Cerebellum
      │
      ▼
真实角色
```

同时：

```text
FunctionGemma
      │
      ▼
Shadow MotorPlan
      │
    不执行
```

记录：

```text
Production:
recoil 0.4

Shadow:
recoil 0.6

delta:
0.2
```

等 Agent 自动评估：

```text
95% 行为可接受
Schema 100%
Unsafe 0
P95 < 100ms
```

再 takeover。

---

# 十四、同样，大脑也应该 Shadow

例如：

```text
当前 Utility Planner
        │
       Primary
        │
       Role
```

同时：

```text
Qwen Brain
        │
      Shadow
```

记录：

```text
Planner:
respond-user

AI:
{
  goal: interact,
  annoyance:+0.1,
  avoidance:0.2
}
```

这样不会因为新模型没调好直接破坏桌宠。

---

# 十五、Agent 可以参与 Prompt 优化，但不能自己无限修改

建议采用：

```text
Prompt Registry
```

比如：

```text
brain_v1
brain_v2
brain_v3

cerebellum_v1
cerebellum_v2
```

每次 Agent 提议改 Prompt：

```text
旧：
v7

新：
v8

原因：
case 332/401/519 对 annoyance 过度映射成 fear
```

然后自动跑 Benchmark。

只有：

```text
指标提高
+
没有严重 regression
```

才能升级。

---

# 十六、不要让 Agent 直接“觉得 Prompt 更好就换”

必须：

```text
修改
 ↓
Eval
 ↓
Regression Test
 ↓
报告
 ↓
决定
```

例如：

```text
Brain V7 → V8

Goal Accuracy:
91.3 → 94.1 ✓

Emotion:
92.7 → 93.2 ✓

Personality:
90.1 → 88.2 ✗

Severe regressions:
2
```

那么 Agent 应该说：

```text
不建议升级。
```

---

# 十七、Agent 还能帮助准备微调数据

例如从：

```text
人类确认样本
+
Teacher 高置信度样本
+
规则生成样本
+
Replay 样本
```

自动生成：

```text
train.jsonl
validation.jsonl
test.jsonl
```

并且严格避免：

```text
同一场景随机拆到 train 和 test
```

造成数据泄漏。

Agent 根据：

```text
scenario family
```

分组拆分。

---

# 十八、训练 FunctionGemma 时 Agent 负责这些

你不需要手动做：

```text
dataset conversion
tokenizer formatting
tool schema
LoRA config
checkpoint save
eval script
GGUF / ONNX conversion
benchmark
```

Agent 都可以辅助完成。

你重点看：

```text
行为效果
```

---

# 十九、模型训练最好也进入 Git，但不要提交权重

工程：

```text
research/neuro-lab/
```

提交：

```text
training config
dataset schema
eval
scripts
prompt
metrics
metadata
```

不要提交：

```text
model.safetensors
*.gguf
checkpoint
```

使用：

```text
artifacts/
```

本地忽略。

---

# 二十、每个训练模型都生成 Model Card

Agent 自动生成：

```yaml
model_id: furinapet-cerebellum-001
base_model: functiongemma-270m
dataset_version: motor-v12
schema_version: neuro-v1
quantization: int8

metrics:
  valid_schema: 1.0
  action_accuracy: 0.93
  personality_consistency: 0.91

runtime:
  device: CPU
  p50_ms: 24
  p95_ms: 37
  memory_mb: 310
```

这样以后你不会搞混：

```text
这个 gguf 到底是哪次训练的？
```

---

# 二十一、最终甚至可以让 Agent 自动发起训练实验

例如你说：

> 连续点击场景里角色还是太胆小。

Model Agent 可以：

```text
1. 查询失败 Trace
2. 提取相关案例
3. 检查当前数据分布
4. 生成增量数据
5. 建议 Prompt 修改
6. 跑 Eval
7. 如有必要生成 LoRA 数据
8. 输出训练命令
9. 训练后重新评测
10. 给你报告
```

而你只需要判断最终几个案例。

---

# 二十二、推荐三个 Git Worktree

现在我会把之前两个扩成三个：

```bash
git worktree add ../furinapet-engine \
  -b feat/neuro-runtime main

git worktree add ../furinapet-model \
  -b exp/neuro-models main

git worktree add ../furinapet-eval \
  -b feat/neuro-eval main
```

变成：

```text
main
 │
 ├── Engine Agent
 │
 │    感知/状态/反射/Motion
 │
 ├── Model Agent
 │
 │    Prompt/模型/训练
 │
 └── Eval Agent
      数据/Benchmark/Replay
```

小项目阶段 Engine + Eval 可以由一个 Agent 做。

---

# 二十三、Agent 的任务也应该有明确边界

例如 Model Agent：

```text
允许：

research/neuro-lab/**
schemas/**
model configs
prompt
dataset
eval
local inference adapter
```

禁止：

```text
src/PetView.tsx
character renderer
window movement
plugin runtime
Tauri system code
```

Engine Agent 则反过来。

避免两个 Agent 打架。

---

# 二十四、建议统一一个实验 ID

例如：

```text
EXP-BRAIN-001
EXP-BRAIN-002

EXP-CEREB-001
EXP-CEREB-002
```

Trace：

```text
TR-000183
```

模型：

```text
FM-001
```

Prompt：

```text
BP-007
```

最后一个 Bug 可以准确描述：

```text
TR-183

Brain:
Qwen3-0.6B
BP-007

Cerebellum:
FunctionGemma
FM-003

错误：
RepeatedHeadTouch
产生过强 recoil
```

以后调试效率非常高。

---

# 二十五、整个开发闭环最终应该长这样

```text
                       用户真实互动
                            │
                            ▼
                       Perception
                            │
                            ▼
                         Trace
                            │
             ┌──────────────┼──────────────┐
             │              │              │
             ▼              ▼              ▼
          Brain A         Brain B       Teacher
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                          Eval
                            │
                       异常样本
                            │
                            ▼
                       Model Agent
                            │
                 错误分析 / 数据整理
                            │
                            ▼
                           你
                    行为 / 人格判断
                            │
                            ▼
                    Preference Data
                            │
                            ▼
                      Fine-tuning
                            │
                            ▼
                      Shadow Mode
                            │
                            ▼
                       Production
```

---

## 所以我建议接下来的任务分配变成

|阶段|Engine Agent|Model/Eval Agent|你|
|---|---|---|---|
|**M0**|Neuro Contract|Benchmark 框架|确认行为定义|
|**M1**|Perception|生成 Scenario|审 20–30 条|
|**M2**|CharacterState|Brain Prompt / A-B|定人格|
|**M3**|Rule Cerebellum|Motor Eval|判断动作合理性|
|**M4**|Trace + Replay|Replay 分析工具|实机体验|
|**M5**|AI Brain Adapter|Qwen/云端模型对比|选 Brain|
|**M6**|Shadow Runtime|FunctionGemma 调试|审异常案例|
|**M7**|Model Runtime|FunctionGemma SFT|角色动作验收|
|**M8**|Tiny Motor Runtime|MotorNet 蒸馏|最终验收|
|**M9**|Rigged Body|动作数据优化|视觉/角色体验|

最关键的是：**Agent 不只是帮你“跑模型”，而应该承担实验工程师的职责**——主动寻找失败案例、建立 benchmark、比较模型、生成训练数据、分析回归、整理 Trace；你承担的是更难替代的“角色行为审美和人格判断”。

这样你同时推进工程和模型时，不会变成“Agent 在写代码，你另外开几十个 Python 脚本手工试模型”，而会形成真正统一的 Furinapet AI 研发工作流。