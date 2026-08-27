import type { TargetRef } from "./common";
import type { EmotionState } from "./character-state";

export type BrainGoal =
  | "idle" | "interact" | "observe" | "approach" | "avoid" | "rest" | "celebrate";

export type SocialIntent =
  | "none" | "greet" | "complain" | "tease" | "comfort" | "brag" | "withdraw" | "plead";

export type BrainSource = "rule" | "ai" | "plugin" | "user";

/**
 * How much the character wants to move, and in what direction — never *which* joint.
 *
 * This is the whole width of the channel between cognition and movement. A brain that
 * wants to say "flinch your right hand back 12 cm" has to express it as high
 * `avoidance`, and the cerebellum decides the rest. That constraint is what allows the
 * brain to be a cloud LLM one day and a 0.6B local model the next without the
 * character's movement quality changing.
 */
export interface MotorTendency {
  approach: number;
  avoidance: number;
  energy: number;
  expressiveness: number;
}

/** Level 4 — what the character wants. Contains no geometry. */
export interface BrainIntent {
  schemaVersion: number;
  goal: BrainGoal;
  attention?: { target: TargetRef; strength: number };
  /** Signed nudges, -1..1, applied once. Absent channels are unchanged. */
  emotionDelta?: Partial<EmotionState>;
  socialIntent?: SocialIntent;
  motorTendency: MotorTendency;
  /** 0..1 — the producer's own confidence. Untrusted sources get capped. */
  confidence: number;
  source: BrainSource;
  ttlMs: number;
}

export const BRAIN_GOALS: readonly BrainGoal[] = [
  "idle", "interact", "observe", "approach", "avoid", "rest", "celebrate",
];

export const SOCIAL_INTENTS: readonly SocialIntent[] = [
  "none", "greet", "complain", "tease", "comfort", "brag", "withdraw", "plead",
];

export const BRAIN_SOURCES: readonly BrainSource[] = ["rule", "ai", "plugin", "user"];

/**
 * Ceiling on how much a source is trusted, mirroring the existing planner's policy of
 * capping AI suggestions below system and user input.
 */
export const SOURCE_CONFIDENCE_CAP: Record<BrainSource, number> = {
  user: 1,
  rule: 1,
  plugin: 0.95,
  ai: 0.82,
};
