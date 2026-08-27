/**
 * Neuro contract Level 4: NeuroBrainIntent.
 *
 * What the brain (rule planner today, LLM provider later) wants. Named
 * distinctly from pet-brain's priority-arbitration `BrainIntent`. The brain
 * must never output animations, sprite rows or coordinates — only this
 * semantic intent. Motor expression is decided by the cerebellum.
 */

import type { EmotionState, TargetRef } from "./character-state";
import type { PetGoalId } from "../../pet-brain/types";

/**
 * Social dimension of the brain's intent — how the character wants to relate
 * to the user right now, beyond the semantic goal. Optional; when absent the
 * character's social expression is derived from emotion and goal alone.
 */
export type SocialIntent =
  | "none"
  | "greet"
  | "complain"
  | "tease"
  | "comfort"
  | "brag"
  | "withdraw"
  | "plead";

export const SOCIAL_INTENTS: readonly SocialIntent[] = [
  "none", "greet", "complain", "tease", "comfort", "brag", "withdraw", "plead",
];

/**
 * Where a brain intent came from. Used for priority caps and for tracing
 * which decision layer produced the current behavior.
 */
export type BrainSource = "rule" | "ai" | "plugin" | "user";

export const BRAIN_SOURCES: readonly BrainSource[] = ["rule", "ai", "plugin", "user"];

/**
 * Ceiling on how much a source is trusted. Mirrors the existing planner's
 * policy of capping AI suggestions below system and user input.
 */
export const SOURCE_CONFIDENCE_CAP: Record<BrainSource, number> = {
  user: 1,
  rule: 1,
  plugin: 0.95,
  ai: 0.82,
};

export interface MotorTendency {
  /** 0..1 pull toward the attention target. */
  approach: number;
  /** 0..1 pull away from the attention target. */
  avoidance: number;
  /** 0..1 desired movement energy. */
  energy: number;
  /** 0..1 desired expressiveness (gesture/expression amplitude). */
  expressiveness: number;
}

export interface NeuroBrainIntent {
  /** Reuses the seven Pet Brain goals so both pipelines stay interchangeable. */
  goal: PetGoalId;
  attention?: {
    target: TargetRef;
    strength: number;
  };
  emotionDelta?: Partial<EmotionState>;
  /** Optional social dimension — how the character wants to relate to the user. */
  socialIntent?: SocialIntent;
  motorTendency: MotorTendency;
  /** 0..1 self-reported certainty. */
  confidence: number;
  /** Where this intent came from. Used for priority caps and tracing. */
  source?: BrainSource;
}

export const NEUTRAL_MOTOR_TENDENCY: MotorTendency = {
  approach: 0.2,
  avoidance: 0.1,
  energy: 0.4,
  expressiveness: 0.5,
};

export function clampMotorTendency(tendency: MotorTendency): MotorTendency {
  const clamp = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
  return {
    approach: clamp(tendency.approach),
    avoidance: clamp(tendency.avoidance),
    energy: clamp(tendency.energy),
    expressiveness: clamp(tendency.expressiveness),
  };
}

export function normalizeBrainIntent(value: NeuroBrainIntent): NeuroBrainIntent {
  const strength = value.attention?.strength;
  return {
    goal: value.goal,
    attention: value.attention
      ? { target: value.attention.target, strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength ?? 0)) : 0 }
      : undefined,
    emotionDelta: value.emotionDelta,
    socialIntent: value.socialIntent && SOCIAL_INTENTS.includes(value.socialIntent) ? value.socialIntent : undefined,
    motorTendency: clampMotorTendency(value.motorTendency ?? NEUTRAL_MOTOR_TENDENCY),
    confidence: Number.isFinite(value.confidence) ? Math.min(1, Math.max(0, value.confidence)) : 0.5,
    source: value.source && BRAIN_SOURCES.includes(value.source) ? value.source : undefined,
  };
}
