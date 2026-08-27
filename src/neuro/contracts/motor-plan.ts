import type { TargetRef } from "./common";

export type Limb = "left-hand" | "right-hand" | "left-foot" | "right-foot";
export type EarPose = "neutral" | "back" | "perked" | "droop";
export type TailMotion = "still" | "sway" | "flick" | "tuck" | "wag";
export type ExpressionType =
  | "neutral" | "happy" | "sad" | "angry" | "surprised" | "tired" | "smug" | "blink";
export type LeanDirection = "forward" | "back" | "left" | "right";
export type StepDirection = "left" | "right" | "forward" | "back";
export type GestureType = "wave" | "point" | "shrug" | "cheer" | "facepalm";
export type IdleStyle = "relaxed" | "alert" | "bored" | "sleepy";

/**
 * Level 5 — the motor vocabulary.
 *
 * Deliberately *not* animation names (`"angry_03"`) and deliberately *not* angles
 * (`head.rotation = 17°`). An animation name cannot be blended or scaled; an angle
 * cannot survive a change of body. A primitive with a weight can do both, which is why
 * this is the layer a small model is asked to predict.
 */
export type MotorPrimitive =
  | { type: "lookAt"; target: TargetRef; weight: number }
  | { type: "lookAway"; target: TargetRef; weight: number }
  | { type: "reach"; limb: Limb; target: TargetRef; strength: number }
  | { type: "recoil"; from: TargetRef; strength: number }
  | { type: "lean"; direction: LeanDirection; weight: number }
  | { type: "turn"; direction: "left" | "right"; weight: number }
  | { type: "step"; direction: StepDirection; weight: number }
  | { type: "earPose"; pose: EarPose; weight: number }
  | { type: "tailMotion"; motion: TailMotion; weight: number }
  | { type: "expression"; expression: ExpressionType; weight: number }
  | { type: "gesture"; gesture: GestureType; weight: number }
  | { type: "idleStyle"; style: IdleStyle; weight: number };

export type MotorPrimitiveType = MotorPrimitive["type"];

export type MotorSource = "reflex" | "rule" | "ai" | "shadow";

export interface MotorPlan {
  schemaVersion: number;
  actions: MotorPrimitive[];
  /** How long the plan stays authoritative. 0 means "until replaced". */
  durationMs: number;
  confidence: number;
  source: MotorSource;
}

export const MOTOR_PRIMITIVE_TYPES: readonly MotorPrimitiveType[] = [
  "lookAt", "lookAway", "reach", "recoil", "lean", "turn",
  "step", "earPose", "tailMotion", "expression", "gesture", "idleStyle",
];

export const LIMBS: readonly Limb[] = ["left-hand", "right-hand", "left-foot", "right-foot"];
export const EAR_POSES: readonly EarPose[] = ["neutral", "back", "perked", "droop"];
export const TAIL_MOTIONS: readonly TailMotion[] = ["still", "sway", "flick", "tuck", "wag"];
export const EXPRESSIONS: readonly ExpressionType[] = [
  "neutral", "happy", "sad", "angry", "surprised", "tired", "smug", "blink",
];
export const LEAN_DIRECTIONS: readonly LeanDirection[] = ["forward", "back", "left", "right"];
export const STEP_DIRECTIONS: readonly StepDirection[] = ["left", "right", "forward", "back"];
export const GESTURES: readonly GestureType[] = ["wave", "point", "shrug", "cheer", "facepalm"];
export const IDLE_STYLES: readonly IdleStyle[] = ["relaxed", "alert", "bored", "sleepy"];
export const MOTOR_SOURCES: readonly MotorSource[] = ["reflex", "rule", "ai", "shadow"];

/** The weight or strength field of a primitive, whatever it happens to be called. */
export function primitiveWeight(primitive: MotorPrimitive): number {
  return "weight" in primitive ? primitive.weight : primitive.strength;
}
