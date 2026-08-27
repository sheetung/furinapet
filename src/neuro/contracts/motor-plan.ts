/**
 * Neuro contract Level 5: MotorPlan.
 *
 * The cerebellum's output. Actions are motor primitives — never animation
 * names, sprite rows or joint angles. The motion backend translates a plan
 * into whatever the current body supports (today: the v2 sprite atlas).
 */

import type { TargetRef } from "./character-state";
import type { BodyRegion } from "./perception-event";

/**
 * Which decision layer produced this motor plan. Essential for Shadow mode
 * where rule and AI plans run in parallel and need to be distinguished.
 */
export type MotorSource = "reflex" | "rule" | "ai" | "shadow";

export const MOTOR_SOURCES: readonly MotorSource[] = ["reflex", "rule", "ai", "shadow"];

export type ExpressionType =
  | "neutral"
  | "happy"
  | "sad"
  | "annoyed"
  | "surprised"
  | "tired";

export type EarPose = "neutral" | "back" | "perked";
export type TailMotion = "still" | "sway" | "flick" | "wag";
export type GestureType = "wave" | "cheer" | "deny" | "point";
export type IdleStyle = "normal" | "sleepy" | "alert" | "sulk";

export type MotorPrimitive =
  | { type: "lookAt"; target: TargetRef; weight: number }
  | { type: "lookAway"; target: TargetRef; weight: number }
  | { type: "recoil"; from: TargetRef; strength: number }
  | { type: "lean"; direction: "left" | "right" | "forward" | "back"; weight: number }
  | { type: "turn"; direction: "left" | "right"; weight: number }
  | { type: "step"; direction: "left" | "right"; distance: number }
  | { type: "approach"; target: TargetRef; weight: number }
  | { type: "retreat"; from: TargetRef; weight: number }
  | { type: "earPose"; pose: EarPose; weight: number }
  | { type: "tailMotion"; motion: TailMotion; weight: number }
  | { type: "expression"; expression: ExpressionType; intensity: number }
  | { type: "gesture"; gesture: GestureType; weight: number }
  | { type: "idleStyle"; style: IdleStyle; weight: number };

/** 0..1 strength/weight/intensity clamp shared by all primitives. */
export function clampWeight(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export interface MotorPlan {
  actions: MotorPrimitive[];
  durationMs: number;
  confidence: number;
  /** Which decision layer produced this plan. Useful for Shadow mode tracing. */
  source?: MotorSource;
  /**
   * Locomotion pass-through: wander/dock are executed by PetView's movement
   * loop, not the reaction executor. The backend forwards these untouched.
   */
  locomotion?: "wander" | "dock";
}

export function emptyMotorPlan(): MotorPlan {
  return { actions: [], durationMs: 0, confidence: 0 };
}

/** Sum of all action weights per type, useful for debugging and shadow diff. */
export function planActionWeight(plan: MotorPlan, type: MotorPrimitive["type"]): number {
  return plan.actions.reduce((total, action) => {
    if (action.type !== type) return total;
    const magnitude = "weight" in action
      ? action.weight
      : "strength" in action
        ? action.strength
        : "intensity" in action
          ? action.intensity
          : "distance" in action
            ? action.distance
            : 0;
    return total + clampWeight(magnitude);
  }, 0);
}

/** Region helper shared with the perception reducer. */
export function bodyRegionAt(normalizedY: number): BodyRegion {
  if (normalizedY < 0.28) return "face";
  if (normalizedY < 0.52) return "head";
  if (normalizedY < 0.86) return "body";
  return "hand";
}
