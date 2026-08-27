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
  motorTendency: MotorTendency;
  /** 0..1 self-reported certainty. */
  confidence: number;
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
    motorTendency: clampMotorTendency(value.motorTendency ?? NEUTRAL_MOTOR_TENDENCY),
    confidence: Number.isFinite(value.confidence) ? Math.min(1, Math.max(0, value.confidence)) : 0.5,
  };
}
