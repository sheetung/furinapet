import {
  AGENT_LIFECYCLES, BODY_REGIONS, NEURO_SCHEMA_VERSION, TARGET_REFS,
  type AgentLifecycle, type BodyRegion, type TargetRef,
} from "./common";
import {
  BRAIN_GOALS, BRAIN_SOURCES, SOCIAL_INTENTS, SOURCE_CONFIDENCE_CAP,
  type BrainGoal, type BrainIntent, type BrainSource, type MotorTendency, type SocialIntent,
} from "./brain-intent";
import { EMOTION_CHANNELS, type EmotionState } from "./character-state";
import {
  EAR_POSES, EXPRESSIONS, GESTURES, IDLE_STYLES, LEAN_DIRECTIONS, LIMBS,
  MOTOR_SOURCES, STEP_DIRECTIONS, TAIL_MOTIONS,
  type MotorPlan, type MotorPrimitive, type MotorSource,
} from "./motor-plan";

/** Beyond this an "intent" is a model spamming, not a plan. */
export const MAX_PLAN_ACTIONS = 12;
const MAX_TTL_MS = 60_000;
const MIN_TTL_MS = 100;

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : null;
}

/**
 * Validation is asymmetric on purpose.
 *
 * Out-of-range *numbers* are clamped with a warning: a model that says
 * `avoidance: 1.4` clearly meant "as much as possible", and refusing the whole plan
 * over it would make the character freeze. Unknown *enum members* are rejected: a
 * model that invents `"attack"` has misunderstood the contract, and guessing what it
 * meant is how an unsafe behaviour reaches the body.
 */
function validateEmotionDelta(input: unknown, warnings: string[]): Partial<EmotionState> | undefined {
  if (input === undefined) return undefined;
  if (!isRecord(input)) {
    warnings.push("emotionDelta 不是对象，已忽略。");
    return undefined;
  }
  const delta: Partial<EmotionState> = {};
  for (const key of Object.keys(input)) {
    if (!(EMOTION_CHANNELS as readonly string[]).includes(key)) {
      warnings.push(`未知情绪通道 ${key}，已忽略。`);
      continue;
    }
    delta[key as keyof EmotionState] = clamp(input[key], -1, 1, 0);
  }
  return Object.keys(delta).length > 0 ? delta : undefined;
}

export function validateBrainIntent(input: unknown, source: BrainSource = "ai"): ValidationResult<BrainIntent> {
  if (!isRecord(input)) return { ok: false, reason: "BrainIntent 必须是对象。" };
  const warnings: string[] = [];

  if (input.schemaVersion !== undefined && input.schemaVersion !== NEURO_SCHEMA_VERSION) {
    return { ok: false, reason: `BrainIntent schemaVersion 不受支持：${String(input.schemaVersion)}` };
  }

  const goal = oneOf<BrainGoal>(input.goal, BRAIN_GOALS);
  if (!goal) return { ok: false, reason: `未知 goal：${String(input.goal)}` };

  const resolvedSource = oneOf<BrainSource>(input.source, BRAIN_SOURCES) ?? source;
  const tendencyInput = isRecord(input.motorTendency) ? input.motorTendency : {};
  if (!isRecord(input.motorTendency)) warnings.push("缺少 motorTendency，已使用中性值。");

  const motorTendency: MotorTendency = {
    approach: clamp(tendencyInput.approach, 0, 1, 0),
    avoidance: clamp(tendencyInput.avoidance, 0, 1, 0),
    energy: clamp(tendencyInput.energy, 0, 1, 0.4),
    expressiveness: clamp(tendencyInput.expressiveness, 0, 1, 0.5),
  };

  let attention: BrainIntent["attention"];
  if (isRecord(input.attention)) {
    const target = oneOf<TargetRef>(input.attention.target, TARGET_REFS);
    if (!target) return { ok: false, reason: `未知 attention.target：${String(input.attention.target)}` };
    attention = { target, strength: clamp(input.attention.strength, 0, 1, 0.5) };
  }

  let socialIntent: SocialIntent | undefined;
  if (input.socialIntent !== undefined) {
    const parsed = oneOf<SocialIntent>(input.socialIntent, SOCIAL_INTENTS);
    if (!parsed) return { ok: false, reason: `未知 socialIntent：${String(input.socialIntent)}` };
    socialIntent = parsed;
  }

  const cap = SOURCE_CONFIDENCE_CAP[resolvedSource];
  const requested = clamp(input.confidence, 0, 1, 0.5);
  if (requested > cap) warnings.push(`confidence ${requested} 超过 ${resolvedSource} 上限 ${cap}，已下调。`);

  return {
    ok: true,
    warnings,
    value: {
      schemaVersion: NEURO_SCHEMA_VERSION,
      goal,
      attention,
      emotionDelta: validateEmotionDelta(input.emotionDelta, warnings),
      socialIntent,
      motorTendency,
      confidence: Math.min(cap, requested),
      source: resolvedSource,
      ttlMs: clamp(input.ttlMs, MIN_TTL_MS, MAX_TTL_MS, 5000),
    },
  };
}

/** Returns null for a primitive that cannot be repaired, so the caller can drop it. */
function validatePrimitive(input: unknown, warnings: string[]): MotorPrimitive | null {
  if (!isRecord(input)) {
    warnings.push("动作不是对象，已丢弃。");
    return null;
  }
  const weight = clamp(input.weight ?? input.strength, 0, 1, 0);
  if (weight <= 0) return null;

  switch (input.type) {
    case "lookAt":
    case "lookAway": {
      const target = oneOf<TargetRef>(input.target, TARGET_REFS);
      if (!target) return null;
      return { type: input.type, target, weight };
    }
    case "reach": {
      const limb = oneOf(input.limb, LIMBS);
      const target = oneOf<TargetRef>(input.target, TARGET_REFS);
      if (!limb || !target) return null;
      return { type: "reach", limb, target, strength: weight };
    }
    case "recoil": {
      const from = oneOf<TargetRef>(input.from, TARGET_REFS);
      if (!from) return null;
      return { type: "recoil", from, strength: weight };
    }
    case "lean": {
      const direction = oneOf(input.direction, LEAN_DIRECTIONS);
      return direction ? { type: "lean", direction, weight } : null;
    }
    case "turn": {
      const direction = oneOf(input.direction, ["left", "right"] as const);
      return direction ? { type: "turn", direction, weight } : null;
    }
    case "step": {
      const direction = oneOf(input.direction, STEP_DIRECTIONS);
      return direction ? { type: "step", direction, weight } : null;
    }
    case "earPose": {
      const pose = oneOf(input.pose, EAR_POSES);
      return pose ? { type: "earPose", pose, weight } : null;
    }
    case "tailMotion": {
      const motion = oneOf(input.motion, TAIL_MOTIONS);
      return motion ? { type: "tailMotion", motion, weight } : null;
    }
    case "expression": {
      const expression = oneOf(input.expression, EXPRESSIONS);
      return expression ? { type: "expression", expression, weight } : null;
    }
    case "gesture": {
      const gesture = oneOf(input.gesture, GESTURES);
      return gesture ? { type: "gesture", gesture, weight } : null;
    }
    case "idleStyle": {
      const style = oneOf(input.style, IDLE_STYLES);
      return style ? { type: "idleStyle", style, weight } : null;
    }
    default:
      warnings.push(`未知动作类型 ${String(input.type)}，已丢弃。`);
      return null;
  }
}

export function validateMotorPlan(input: unknown, source: MotorSource = "ai"): ValidationResult<MotorPlan> {
  if (!isRecord(input)) return { ok: false, reason: "MotorPlan 必须是对象。" };
  const warnings: string[] = [];

  if (input.schemaVersion !== undefined && input.schemaVersion !== NEURO_SCHEMA_VERSION) {
    return { ok: false, reason: `MotorPlan schemaVersion 不受支持：${String(input.schemaVersion)}` };
  }
  if (!Array.isArray(input.actions)) return { ok: false, reason: "MotorPlan.actions 必须是数组。" };

  const actions: MotorPrimitive[] = [];
  for (const candidate of input.actions) {
    if (actions.length >= MAX_PLAN_ACTIONS) {
      warnings.push(`动作数超过 ${MAX_PLAN_ACTIONS}，多余部分已截断。`);
      break;
    }
    const primitive = validatePrimitive(candidate, warnings);
    if (primitive) actions.push(primitive);
  }

  return {
    ok: true,
    warnings,
    value: {
      schemaVersion: NEURO_SCHEMA_VERSION,
      actions,
      durationMs: clamp(input.durationMs, 0, MAX_TTL_MS, 0),
      confidence: clamp(input.confidence, 0, 1, 0.5),
      source: oneOf<MotorSource>(input.source, MOTOR_SOURCES) ?? source,
    },
  };
}

/** Narrow guards used by the replay loader, where inputs come from disk. */
export function isBodyRegion(value: unknown): value is BodyRegion {
  return oneOf<BodyRegion>(value, BODY_REGIONS) !== null;
}

export function isAgentLifecycle(value: unknown): value is AgentLifecycle {
  return oneOf<AgentLifecycle>(value, AGENT_LIFECYCLES) !== null;
}

