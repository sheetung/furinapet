/**
 * LMC (Layered Motor Control) Decision Inspector.
 *
 * Visualizes the live neuro pipeline as the seven-layer architecture from
 * project.md §8: Environment → Perception → (Brain | Reflex) → Cerebellum →
 * Motion Engine → Body → Renderer. Each layer box shows its current
 * execution summary; clicking a box opens a side drawer with that layer's
 * neuro-trace details. Layers flash when a fresh decision flows through them.
 *
 * All data arrives via the Pet Brain snapshot event (published by the pet
 * window); this component is read-only and safe to render in the dashboard.
 */

import { useEffect, useRef, useState } from "react";
import type { NeuroTraceEntry } from "../neuro/trace/neuro-trace";
import type { BodyRegion } from "../neuro/contracts";
import type { PetBrainSnapshot } from "../pet-brain/types";
import {
  EMOTION_LABELS,
  actionLabel,
  agentStateLabel,
  attentionLabel,
  goalLabel,
  moodLabel,
  reasonLabel,
  relativeTime,
  traceStatusLabel,
} from "../pet-brain/labels";

type LayerId =
  | "environment"
  | "perception"
  | "brain"
  | "reflex"
  | "cerebellum"
  | "motion"
  | "body"
  | "renderer";

interface LayerMeta {
  id: LayerId;
  en: string;
  cn: string;
  hint: string;
}

const LAYERS: Record<LayerId, LayerMeta> = {
  environment: { id: "environment", en: "Environment", cn: "外部环境", hint: "鼠标 · 点击 · 拖拽 · Agent · 时间" },
  perception: { id: "perception", en: "Perception", cn: "感知层", hint: "PerceptionEvent → WorldState" },
  brain: { id: "brain", en: "Brain", cn: "大脑", hint: "NeuroBrainIntent · rule/ai" },
  reflex: { id: "reflex", en: "Reflex", cn: "脊髓反射", hint: "blink · startle · flinch · grip" },
  cerebellum: { id: "cerebellum", en: "Cerebellum", cn: "小脑", hint: "MotorPlan · 13 原语" },
  motion: { id: "motion", en: "Motion Engine", cn: "运动系统", hint: "语义 → Reaction 指令" },
  body: { id: "body", en: "Body", cn: "身体层", hint: "关节 · 弹簧 · 骨骼" },
  renderer: { id: "renderer", en: "Renderer", cn: "渲染器", hint: "Sprite Atlas 8×11" },
};

const REGION_LABELS: Record<BodyRegion, string> = { none: "无", head: "头", face: "脸", body: "身体", hand: "手" };
const MOTION_LABELS: Record<string, string> = { stationary: "静止", approaching: "接近", retreating: "远离", tangential: "掠过" };
const REACTION_LABELS: Record<string, string> = {
  idle: "待机", waving: "挥手", jumping: "开心跳", failed: "沮丧", waiting: "等待", running: "跑动", review: "思考",
};
const REFLEX_LABELS: Record<string, string> = { blink: "眨眼退缩", startle: "惊吓", flinch: "躲闪", grip: "抓握" };

function regionLabel(region: BodyRegion | undefined) {
  return region === undefined ? "—" : REGION_LABELS[region];
}

function reactionLabel(reaction: string | null | undefined) {
  if (!reaction) return "—";
  return REACTION_LABELS[reaction] ?? reaction;
}

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.round(minutes / 60)} 小时+`;
}

/** Current status summary lines shown inside a layer box. */
function layerLines(id: LayerId, snapshot: PetBrainSnapshot | null): string[] {
  if (!snapshot) return ["等待桌宠数据…"];
  const world = snapshot.world ?? null;
  const latest = snapshot.neuroTrace?.[0] ?? null;
  switch (id) {
    case "environment": {
      if (!world) return ["WorldState 未接入"];
      return [
        `鼠标 ${MOTION_LABELS[world.pointer.motion] ?? world.pointer.motion} · 目标区域 ${regionLabel(world.pointer.targetRegion)}`,
        `用户空闲 ${formatDuration(world.environment.userIdleMs)} · ${world.environment.canMove ? "允许自主移动" : "静止模式"}`,
        `Agent ${world.agent.connected ? `已连接 · ${agentStateLabel(world.agent.state)}` : "未连接"}`,
      ];
    }
    case "perception": {
      if (!world) return ["WorldState 未接入"];
      return [
        `pointer (${Math.round(world.pointer.x)}, ${Math.round(world.pointer.y)}) · ${Math.round(world.pointer.speed)} px/s`,
        `interaction ${world.interaction.type} · 连点 ${world.interaction.clickStreak} · 强度 ${Math.round(world.interaction.intensity * 100)}%`,
        `世界快照 ${relativeTime(world.timestamp)}`,
      ];
    }
    case "brain": {
      const brainLatest = snapshot.neuroTrace?.find((entry) => entry.source !== "reflex") ?? null;
      return [
        `goal ${goalLabel(snapshot.currentGoal)} · ${moodLabel(snapshot.mood)} · 能量 ${Math.round(snapshot.energy * 100)}%`,
        `Executor ${snapshot.executor?.running ? `${goalLabel(snapshot.executor.goal ?? "idle")} · 第 ${snapshot.executor.actionIndex + 1} 步` : "空闲"} · Pending ${snapshot.pendingIntentCount}`,
        brainLatest
          ? `最近输出 source: ${brainLatest.source} · 置信 ${Math.round(brainLatest.confidence * 100)}% · ${relativeTime(brainLatest.t)}`
          : "尚无大脑输出",
      ];
    }
    case "reflex": {
      const lastReflex = snapshot.neuroTrace?.find((entry) => entry.source === "reflex") ?? null;
      if (!lastReflex) {
        return ["待命：等待强刺激", "双击 → startle · 连点 6 次 → flinch", "点脸/头 → blink · 拖拽 → grip"];
      }
      return [
        `${REFLEX_LABELS[lastReflex.reflex ?? ""] ?? "反射"}${lastReflex.region ? ` @ ${regionLabel(lastReflex.region)}` : ""} · ${relativeTime(lastReflex.t)}`,
        `反应 ${reactionLabel(lastReflex.reaction)} · ${lastReflex.durationMs}ms`,
        "反射绕过大脑，直接驱动运动",
      ];
    }
    case "cerebellum": {
      if (!latest) return ["暂无 MotorPlan", "等待下一次决策…"];
      return [
        `${latest.primitives.length} 个原语 · source: ${latest.source}`,
        latest.primitives.length ? latest.primitives.join(" → ") : "（无动作）",
        `置信 ${Math.round(latest.confidence * 100)}% · ${relativeTime(latest.t)}`,
      ];
    }
    case "motion": {
      if (!latest?.reaction) return ["暂无运动指令", "等待 MotorPlan 输出…"];
      return [
        `sprite ${reactionLabel(latest.reaction)} · ${latest.durationMs}ms`,
        "legacy 映射已收敛（v2 词汇表）",
        `${relativeTime(latest.t)}`,
      ];
    }
    case "body": {
      return [
        latest?.reaction ? `sprite 刚体 · 播放 ${reactionLabel(latest.reaction)}` : "sprite 刚体",
        "关节解算隐式（M6+ 骨骼身体显式化）",
      ];
    }
    case "renderer": {
      return [
        latest?.reaction ? `Sprite Atlas 8×11 · ${reactionLabel(latest.reaction)}` : "Sprite Atlas 8×11",
        "WebP · v2 反应词汇表",
      ];
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Layer box                                                          */
/* ------------------------------------------------------------------ */

function LayerBox({
  layer,
  lines,
  flash,
  onOpen,
}: {
  layer: LayerMeta;
  lines: string[];
  flash: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`lmc-box${flash > 0 ? " flash" : ""}`}
      key={`${layer.id}-${flash}`}
      onClick={onOpen}
      title={`点击查看 ${layer.cn} 详情`}
    >
      <span className="lmc-box-head">
        <strong>{layer.en}</strong>
        <small>{layer.cn}</small>
        <span className="lmc-box-tag">{layer.hint}</span>
      </span>
      <span className="lmc-box-lines">
        {lines.map((line, index) => <small key={index}>{line}</small>)}
      </span>
    </button>
  );
}

function FlowArrow({ label }: { label?: string }) {
  return (
    <span className="lmc-arrow" aria-hidden>
      <i />
      {label ? <small>{label}</small> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Drawer content per layer                                           */
/* ------------------------------------------------------------------ */

function KV({ k, v }: { k: string; v: string }) {
  return <div className="lmc-kv"><small>{k}</small><strong title={v}>{v}</strong></div>;
}

function Bar({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="lmc-bar">
      <span className={accent ? "winner" : ""}>{label}</span>
      <span className="lmc-bar-track"><i style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} /></span>
      <em>{value.toFixed(2)}</em>
    </div>
  );
}

function TraceRow({ entry }: { entry: NeuroTraceEntry }) {
  return (
    <div className="lmc-trace-row">
      <time>{relativeTime(entry.t)}</time>
      <div>
        <strong>
          {entry.source === "reflex"
            ? `${REFLEX_LABELS[entry.reflex ?? ""] ?? "反射"}${entry.region ? ` @ ${regionLabel(entry.region)}` : ""}`
            : `${goalLabel(entry.goal)} · ${entry.source}`}
          {" → "}{reactionLabel(entry.reaction)} · {entry.durationMs}ms
        </strong>
        <small title={`avoid ${entry.motorTendency.avoidance.toFixed(2)} / approach ${entry.motorTendency.approach.toFixed(2)} / energy ${entry.motorTendency.energy.toFixed(2)} / express ${entry.motorTendency.expressiveness.toFixed(2)}`}>
          {entry.primitives.length ? entry.primitives.join(" → ") : "（无动作）"}
        </small>
      </div>
      <em>{Math.round(entry.confidence * 100)}%</em>
    </div>
  );
}

function DrawerSection({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="lmc-section">
      <header><strong>{title}</strong>{note ? <small>{note}</small> : null}</header>
      {children}
    </section>
  );
}

function EnvironmentBody({ snapshot }: { snapshot: PetBrainSnapshot }) {
  const world = snapshot.world;
  if (!world) return <div className="lmc-empty">WorldState 未接入（需要桌宠窗口运行新版运行时）</div>;
  return (
    <>
      <DrawerSection title="指针 Pointer">
        <div className="lmc-kv-grid">
          <KV k="位置" v={`(${Math.round(world.pointer.x)}, ${Math.round(world.pointer.y)}) px`} />
          <KV k="速度" v={`${Math.round(world.pointer.speed)} px/s`} />
          <KV k="运动" v={`${MOTION_LABELS[world.pointer.motion] ?? world.pointer.motion}`} />
          <KV k="目标区域" v={regionLabel(world.pointer.targetRegion)} />
          <KV k="与角色距离" v={`${Math.round(world.pointer.distanceToCharacter * 100)}% / 1200px`} />
        </div>
      </DrawerSection>
      <DrawerSection title="交互 Interaction">
        <div className="lmc-kv-grid">
          <KV k="类型" v={world.interaction.type} />
          <KV k="连点次数" v={String(world.interaction.clickStreak)} />
          <KV k="强度" v={`${Math.round(world.interaction.intensity * 100)}%`} />
        </div>
      </DrawerSection>
      <DrawerSection title="Agent">
        <div className="lmc-kv-grid">
          <KV k="状态" v={agentStateLabel(world.agent.state)} />
          <KV k="连接" v={world.agent.connected ? "已连接" : "未连接"} />
          <KV k="客户端" v={world.agent.clientName ?? "—"} />
        </div>
      </DrawerSection>
      <DrawerSection title="环境 Environment">
        <div className="lmc-kv-grid">
          <KV k="用户空闲" v={formatDuration(world.environment.userIdleMs)} />
          <KV k="允许移动" v={world.environment.canMove ? "是" : "否"} />
          <KV k="允许停靠" v={world.environment.canDock ? "是" : "否"} />
          <KV k="快照时间" v={relativeTime(world.timestamp)} />
        </div>
      </DrawerSection>
    </>
  );
}

function PerceptionBody({ snapshot }: { snapshot: PetBrainSnapshot }) {
  const log = snapshot.perceptionLog ?? [];
  return (
    <DrawerSection title="最近感知事件" note="pointer 每秒至多 1 条 · touch/drag/agentState 全量 · 最新在前">
      {log.length ? (
        <div className="lmc-log">
          {log.map((entry, index) => (
            <div className="lmc-log-row" key={`${entry.at}-${entry.type}-${index}`}>
              <time>{relativeTime(entry.at)}</time>
              <span className={`lmc-chip t-${entry.type}`}>{entry.type}</span>
              <small>{entry.region ? `${regionLabel(entry.region)} · ` : ""}{entry.detail}</small>
            </div>
          ))}
        </div>
      ) : <div className="lmc-empty">暂无感知事件记录。</div>}
    </DrawerSection>
  );
}

function BrainBody({ snapshot }: { snapshot: PetBrainSnapshot }) {
  const decision = snapshot.lastDecision;
  const topScore = decision?.candidates[0]?.score ?? 1;
  const brainTraces = (snapshot.neuroTrace ?? []).filter((entry) => entry.source !== "reflex");
  return (
    <>
      <DrawerSection title="当前状态">
        <div className="lmc-kv-grid">
          <KV k="Goal" v={goalLabel(snapshot.currentGoal)} />
          <KV k="Mood" v={moodLabel(snapshot.mood)} />
          <KV k="Energy" v={`${Math.round(snapshot.energy * 100)}%`} />
          <KV k="Agent" v={agentStateLabel(snapshot.agentState)} />
          <KV k="连点" v={String(snapshot.clickStreak)} />
          <KV k="Pending Intent" v={String(snapshot.pendingIntentCount)} />
          <KV k="Executor" v={snapshot.executor?.running ? `${goalLabel(snapshot.executor.goal ?? "idle")} · 第 ${snapshot.executor.actionIndex + 1} 步` : "空闲"} />
        </div>
      </DrawerSection>
      <DrawerSection title="Planner 评分" note={decision ? `${relativeTime(decision.at)}更新` : "暂无决策"}>
        {decision?.candidates.length ? (
          <div className="lmc-bars">
            {decision.candidates.map((candidate) => (
              <Bar
                key={candidate.goal}
                label={candidate.goal === decision.goal ? `● ${goalLabel(candidate.goal)}` : goalLabel(candidate.goal)}
                value={candidate.score / Math.max(0.01, topScore)}
                accent={candidate.goal === decision.goal}
              />
            ))}
            <p className="lmc-note"><strong>胜出原因：</strong>{reasonLabel(decision.reason)}</p>
          </div>
        ) : <div className="lmc-empty">等待下一次 Planner 决策…</div>}
      </DrawerSection>
      <DrawerSection title="动作计划">
        {decision?.actions.length ? (
          <div className="lmc-chip-row">
            {decision.actions.map((action, index) => <span className="lmc-chip" key={`${action.type}-${index}`}>{actionLabel(action)}</span>)}
          </div>
        ) : <div className="lmc-empty">暂无动作计划。</div>}
        {snapshot.history.length > 0 && (
          <p className="lmc-note"><strong>最近 Goal：</strong>{snapshot.history.slice(0, 5).map((item) => goalLabel(item.goal)).join(" → ")}</p>
        )}
      </DrawerSection>
      {snapshot.character && (
        <DrawerSection title="情绪 · Character" note={`arousal ${Math.round(snapshot.character.arousal * 100)}% · 注意力 ${attentionLabel(snapshot.character.attention.target)} ${Math.round(snapshot.character.attention.strength * 100)}% · ${moodLabel(snapshot.character.derivedMood)}`}>
          <div className="lmc-bars">
            {EMOTION_LABELS.map(({ key, label }) => (
              <Bar key={key} label={label} value={snapshot.character!.emotion[key]} />
            ))}
          </div>
        </DrawerSection>
      )}
      <DrawerSection title="最近 AI 建议" note="最多 8 条">
        {snapshot.aiSuggestions.length ? (
          <div className="lmc-traces">
            {snapshot.aiSuggestions.map((trace) => (
              <div className="lmc-trace-row" key={trace.id}>
                <time>{relativeTime(trace.at)}</time>
                <div><strong>AI → {goalLabel(trace.goal)} · {Math.round(trace.confidence * 100)}%</strong><small title={trace.reason}>{trace.reason}</small></div>
                <em className={`st-${trace.status}`}>{traceStatusLabel(trace.status)}</em>
              </div>
            ))}
          </div>
        ) : <div className="lmc-empty">AI Adviser 尚未产生建议。</div>}
      </DrawerSection>
      <DrawerSection title="大脑输出轨迹" note="rule/ai 条目">
        {brainTraces.length ? (
          <div className="lmc-traces">{brainTraces.slice(0, 8).map((entry) => <TraceRow key={`${entry.t}-${entry.goal}`} entry={entry} />)}</div>
        ) : <div className="lmc-empty">暂无大脑输出。</div>}
      </DrawerSection>
    </>
  );
}

function ReflexBody({ snapshot }: { snapshot: PetBrainSnapshot }) {
  const reflexTraces = (snapshot.neuroTrace ?? []).filter((entry) => entry.source === "reflex");
  return (
    <>
      <DrawerSection title="反射规则" note="优先级 startle > flinch > blink；grip 独立于点击">
        <div className="lmc-kv-grid">
          <KV k="startle" v="双击任意部位" />
          <KV k="flinch" v="连点 ≥ 6 次" />
          <KV k="blink" v="单击脸/头" />
          <KV k="grip" v="拖拽开始" />
        </div>
        <p className="lmc-note">反射弧绕过大脑管线（L4），由感知事件直接生成 MotorPlan 立即执行——身体先反应，大脑后理解。</p>
      </DrawerSection>
      <DrawerSection title="最近反射触发">
        {reflexTraces.length ? (
          <div className="lmc-traces">{reflexTraces.map((entry, index) => <TraceRow key={`${entry.t}-${index}`} entry={entry} />)}</div>
        ) : <div className="lmc-empty">本次运行还没有反射触发。试试双击宠物，或快速连点 6 次。</div>}
      </DrawerSection>
    </>
  );
}

function CerebellumBody({ snapshot }: { snapshot: PetBrainSnapshot }) {
  const latest = snapshot.neuroTrace?.[0] ?? null;
  return (
    <>
      <DrawerSection title="最新 MotorPlan" note={latest ? `${relativeTime(latest.t)} · source: ${latest.source}` : "暂无"}>
        {latest ? (
          <>
            <div className="lmc-chip-row">
              {latest.primitives.length
                ? latest.primitives.map((primitive, index) => <span className="lmc-chip" key={`${primitive}-${index}`}>{primitive}</span>)
                : <span className="lmc-chip">（无动作）</span>}
            </div>
            <p className="lmc-note">置信 {Math.round(latest.confidence * 100)}% · 时长 {latest.durationMs}ms</p>
          </>
        ) : <div className="lmc-empty">等待下一次决策…</div>}
      </DrawerSection>
      {latest && (
        <DrawerSection title="运动倾向 MotorTendency" note="合成意图的四个维度">
          <div className="lmc-bars">
            <Bar label="approach 趋近" value={latest.motorTendency.approach} />
            <Bar label="avoidance 回避" value={latest.motorTendency.avoidance} />
            <Bar label="energy 能量" value={latest.motorTendency.energy} />
            <Bar label="expressiveness 表现力" value={latest.motorTendency.expressiveness} />
          </div>
        </DrawerSection>
      )}
      <DrawerSection title="13 个运动原语" note="MotorPlan 的词汇表（语义意图，不含动画名）">
        <div className="lmc-chip-row">
          {["lookAt", "lookAway", "recoil", "lean", "turn", "step", "approach", "retreat", "earPose", "tailMotion", "expression", "gesture", "idleStyle"]
            .map((primitive) => <span className="lmc-chip" key={primitive}>{primitive}</span>)}
        </div>
        <p className="lmc-note">小脑把 BrainIntent + CharacterState + WorldState 合成为原语序列； locomotion（wander/dock）直接透传给 PetView 的移动循环。</p>
      </DrawerSection>
    </>
  );
}

const FALLBACK_TABLE: [string, string][] = [
  ["recoil", "failed 沮丧"],
  ["gesture: cheer", "jumping 开心跳"],
  ["gesture: wave", "waving 挥手"],
  ["gesture: deny", "failed 沮丧"],
  ["gesture: point", "review 思考"],
  ["expression: happy/surprised", "jumping 开心跳"],
  ["expression: sad/annoyed", "failed 沮丧"],
  ["expression: tired", "waiting 等待"],
  ["idleStyle: sleepy/alert", "waiting 等待"],
  ["idleStyle: sulk", "failed 沮丧"],
  ["turn", "running 跑动"],
  ["lookAt", "review 思考"],
];

function MotionBody({ snapshot }: { snapshot: PetBrainSnapshot }) {
  const latest = snapshot.neuroTrace?.[0] ?? null;
  return (
    <>
      <DrawerSection title="当前运动指令">
        {latest?.reaction ? (
          <div className="lmc-kv-grid">
            <KV k="Reaction" v={reactionLabel(latest.reaction)} />
            <KV k="时长" v={`${latest.durationMs}ms`} />
            <KV k="来源" v={String(latest.source ?? "—")} />
            <KV k="更新" v={relativeTime(latest.t)} />
          </div>
        ) : <div className="lmc-empty">暂无运动指令。</div>}
      </DrawerSection>
      <DrawerSection title="Legacy 映射表" note="原语 → v2 sprite 反应（按扫描顺序首个命中）">
        <div className="lmc-kv-grid">
          {FALLBACK_TABLE.map(([from, to]) => <KV key={from} k={from} v={to} />)}
        </div>
        <p className="lmc-note">M6+ 骨骼身体上线后，此层将替换为 IK / LookAt / Reach / Mixer 的真实解算器，映射表随之退役。</p>
      </DrawerSection>
    </>
  );
}

function BodyBody({ snapshot }: { snapshot: PetBrainSnapshot }) {
  const latest = snapshot.neuroTrace?.[0] ?? null;
  return (
    <DrawerSection title="身体层" note="sprite 阶段（隐式）">
      <div className="lmc-kv-grid">
        <KV k="当前形态" v="sprite 刚体（8×11 图集帧）" />
        <KV k="当前反应" v={latest?.reaction ? reactionLabel(latest.reaction) : "—"} />
        <KV k="关节限制" v="隐式（帧内固定）" />
        <KV k="弹簧/阻尼" v="未启用" />
      </div>
      <p className="lmc-note">当前 sprite 阶段关节解算隐式存在（动画师预先烘焙在帧里）。M6+ FurinaMotorNet rigged body 上线后，Joint Limit / Spring-Damping / Skeleton 将在本层显式化，届时 MotorPlan 的原语权重会真正驱动关节。</p>
    </DrawerSection>
  );
}

function RendererBody({ snapshot }: { snapshot: PetBrainSnapshot }) {
  const latest = snapshot.neuroTrace?.[0] ?? null;
  return (
    <DrawerSection title="渲染器" note="Sprite Atlas v2">
      <div className="lmc-kv-grid">
        <KV k="图集" v="8×11 帧 · WebP" />
        <KV k="反应词汇表" v="idle / waving / jumping / failed / waiting / running / review" />
        <KV k="正在播放" v={latest?.reaction ? reactionLabel(latest.reaction) : "idle"} />
      </div>
      <p className="lmc-note">渲染器只认 Reaction 指令，不知道上游是反射还是大脑决策；这也是不同决策路径最终可能渲染相同动画的原因（词汇表折叠）。</p>
    </DrawerSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Drawer shell                                                       */
/* ------------------------------------------------------------------ */

function LayerDrawer({
  layer,
  snapshot,
  onClose,
}: {
  layer: LayerId;
  snapshot: PetBrainSnapshot | null;
  onClose: () => void;
}) {
  const meta = LAYERS[layer];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="lmc-backdrop" onClick={onClose} />
      <aside className="lmc-drawer" role="dialog" aria-label={`${meta.cn} 详情`}>
        <header>
          <div>
            <strong>{meta.en}</strong>
            <small>{meta.cn} · {meta.hint}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <div className="lmc-drawer-body">
          {!snapshot ? (
            <div className="lmc-empty">正在请求宠物窗口的 Brain Snapshot…</div>
          ) : layer === "environment" ? <EnvironmentBody snapshot={snapshot} />
          : layer === "perception" ? <PerceptionBody snapshot={snapshot} />
          : layer === "brain" ? <BrainBody snapshot={snapshot} />
          : layer === "reflex" ? <ReflexBody snapshot={snapshot} />
          : layer === "cerebellum" ? <CerebellumBody snapshot={snapshot} />
          : layer === "motion" ? <MotionBody snapshot={snapshot} />
          : layer === "body" ? <BodyBody snapshot={snapshot} />
          : <RendererBody snapshot={snapshot} />}
        </div>
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function DecisionInspector({ snapshot }: { snapshot: PetBrainSnapshot | null }) {
  const [openLayer, setOpenLayer] = useState<LayerId | null>(null);
  const [flashTokens, setFlashTokens] = useState<Partial<Record<LayerId, number>>>({});
  const lastTraceKey = useRef("");

  const latest = snapshot?.neuroTrace?.[0] ?? null;

  useEffect(() => {
    if (!latest) return;
    const key = `${latest.t}:${latest.source ?? "-"}:${latest.goal}:${latest.reaction ?? "-"}`;
    if (lastTraceKey.current === key) return;
    const isFirstObservation = lastTraceKey.current === "";
    lastTraceKey.current = key;
    if (isFirstObservation) return; // don't flash everything on panel mount
    setFlashTokens((current) => {
      const next = { ...current };
      const bump = (id: LayerId) => { next[id] = (next[id] ?? 0) + 1; };
      bump("cerebellum");
      bump("motion");
      if (latest.source === "reflex") bump("reflex");
      else bump("brain");
      return next;
    });
  }, [latest]);

  const box = (id: LayerId) => (
    <LayerBox
      layer={LAYERS[id]}
      lines={layerLines(id, snapshot)}
      flash={flashTokens[id] ?? 0}
      onOpen={() => setOpenLayer(id)}
    />
  );

  return (
    <div className="lmc">
      <style>{LMC_STYLE}</style>
      <div className="lmc-stack">
        {box("environment")}
        <FlowArrow label="采样 + 事件" />
        {box("perception")}
        <FlowArrow label="WorldState" />
        <div className="lmc-parallel">
          {box("brain")}
          {box("reflex")}
        </div>
        <FlowArrow label="NeuroBrainIntent / MotorPlan（反射直达运动）" />
        {box("cerebellum")}
        <FlowArrow label="MotorPlan" />
        {box("motion")}
        <FlowArrow label="ReactionDirective" />
        {box("body")}
        <FlowArrow />
        {box("renderer")}
      </div>
      {openLayer && (
        <LayerDrawer layer={openLayer} snapshot={snapshot} onClose={() => setOpenLayer(null)} />
      )}
    </div>
  );
}

const LMC_STYLE = `
.lmc { margin-top: 14px; }
.lmc-stack { display: flex; flex-direction: column; align-items: stretch; max-width: 860px; }
.lmc-box { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 13px 15px; border: 1px solid rgba(164,190,228,.16); border-radius: 13px; background: linear-gradient(150deg, rgba(29,38,61,.72), rgba(16,22,38,.86)); color: #dcecff; font: inherit; text-align: left; cursor: pointer; transition: border-color .15s ease, transform .15s ease; }
.lmc-box:hover { border-color: rgba(103,214,255,.45); transform: translateY(-1px); }
.lmc-box-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.lmc-box-head strong { font-size: 13px; letter-spacing: .02em; }
.lmc-box-head small { color: #7f92ac; font-size: 10px; }
.lmc-box-tag { margin-left: auto; padding: 2px 8px; border: 1px solid rgba(102,215,232,.18); border-radius: 999px; color: #7fc6d8; font-size: 9px; white-space: nowrap; }
.lmc-box-lines { display: grid; gap: 3px; }
.lmc-box-lines small { color: #9db0c9; font-size: 10px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes lmc-flash-anim { 0% { box-shadow: 0 0 0 0 rgba(103,214,255,.55); border-color: rgba(103,214,255,.85); } 100% { box-shadow: 0 0 0 16px rgba(103,214,255,0); } }
.lmc-box.flash { animation: lmc-flash-anim .95s ease-out; }
.lmc-arrow { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 3px 0; }
.lmc-arrow i { width: 1px; height: 12px; background: linear-gradient(180deg, rgba(103,214,255,.65), rgba(103,214,255,.15)); }
.lmc-arrow small { color: #5f7490; font-size: 8.5px; letter-spacing: .06em; }
.lmc-parallel { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 820px) { .lmc-parallel { grid-template-columns: 1fr; } }
.lmc-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(3,7,14,.46); animation: lmc-fade .15s ease; }
@keyframes lmc-fade { from { opacity: 0; } }
.lmc-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 61; display: flex; flex-direction: column; width: min(420px, 94vw); border-left: 1px solid rgba(164,190,228,.2); background: linear-gradient(160deg, rgba(24,32,52,.99), rgba(14,20,35,.99)); box-shadow: -24px 0 60px rgba(0,0,0,.35); animation: lmc-slide .2s ease; }
@keyframes lmc-slide { from { transform: translateX(24px); opacity: 0; } }
.lmc-drawer > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid rgba(164,190,228,.14); }
.lmc-drawer > header strong { display: block; font-size: 16px; }
.lmc-drawer > header small { display: block; margin-top: 4px; color: #7f92ac; font-size: 10px; }
.lmc-drawer > header button { width: 30px; height: 30px; border: 1px solid #3d4960; border-radius: 9px; background: #202a3d; color: #dcecff; font-size: 12px; cursor: pointer; }
.lmc-drawer-body { flex: 1; overflow-y: auto; padding: 14px 18px 24px; }
.lmc-section { margin-bottom: 18px; }
.lmc-section > header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
.lmc-section > header strong { font-size: 12px; }
.lmc-section > header small { color: #71829a; font-size: 9px; text-align: right; }
.lmc-kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.lmc-kv { min-width: 0; padding: 8px 10px; border: 1px solid rgba(164,190,228,.1); border-radius: 10px; background: rgba(15,22,36,.42); }
.lmc-kv small { display: block; margin-bottom: 3px; color: #71829a; font-size: 9px; }
.lmc-kv strong { display: block; overflow: hidden; color: #dcecff; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.lmc-bars { display: grid; gap: 7px; }
.lmc-bar { display: grid; grid-template-columns: 108px minmax(0,1fr) 36px; align-items: center; gap: 8px; }
.lmc-bar span { overflow: hidden; color: #9fb0c7; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.lmc-bar span.winner { color: #91e1ff; font-weight: 800; }
.lmc-bar-track { height: 7px; overflow: hidden; border-radius: 99px; background: #273146; }
.lmc-bar-track i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg,#598edd,#72d4e8); }
.lmc-bar em { color: #9bc8ff; font-size: 9px; font-style: normal; font-variant-numeric: tabular-nums; text-align: right; }
.lmc-note { margin: 10px 0 0; color: #8294ad; font-size: 10px; line-height: 1.6; }
.lmc-empty { padding: 16px 0; color: #71829a; font-size: 10px; text-align: center; }
.lmc-chip-row { display: flex; gap: 6px; flex-wrap: wrap; }
.lmc-chip { padding: 4px 8px; border: 1px solid rgba(102,215,232,.16); border-radius: 8px; color: #a8c7d6; background: rgba(63,134,153,.08); font-size: 9px; }
.lmc-log { display: grid; gap: 6px; }
.lmc-log-row { display: grid; grid-template-columns: 62px 110px minmax(0,1fr); align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid rgba(164,190,228,.09); border-radius: 9px; background: rgba(15,22,36,.3); }
.lmc-log-row time { color: #687991; font-size: 9px; }
.lmc-log-row small { overflow: hidden; color: #8ea0b8; font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }
.lmc-traces { display: grid; gap: 7px; }
.lmc-trace-row { display: grid; grid-template-columns: 62px minmax(0,1fr) auto; align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid rgba(164,190,228,.09); border-radius: 10px; background: rgba(15,22,36,.3); }
.lmc-trace-row time { color: #687991; font-size: 9px; }
.lmc-trace-row div strong { display: block; font-size: 10px; }
.lmc-trace-row div small { display: block; margin-top: 3px; overflow: hidden; color: #7e8ea5; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.lmc-trace-row em { color: #9bc8ff; font-size: 9px; font-style: normal; font-variant-numeric: tabular-nums; }
.lmc-trace-row em.st-accepted { color: #83dbab; }
.lmc-trace-row em.st-pending { color: #f0c878; }
.lmc-trace-row em.st-rejected { color: #a1adbf; }
`;
