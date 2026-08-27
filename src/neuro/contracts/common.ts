/** Bumped only when a contract changes shape. Consumers must reject other values. */
export const NEURO_SCHEMA_VERSION = 1;
export type NeuroSchemaVersion = typeof NEURO_SCHEMA_VERSION;

/**
 * The six levels the pipeline is allowed to speak in, from the design doc.
 *
 * The rule that makes the rest of the architecture hold: a language model may
 * produce level 4, and a motor model level 5, but nothing above level 5 may ever
 * name a bone, an angle or an animation row. Level 6 belongs to the motion engine.
 */
export const NEURO_LEVELS = {
  0: "RawEvent",
  1: "PerceptionEvent",
  2: "WorldState",
  3: "CharacterState",
  4: "BrainIntent",
  5: "MotorPlan",
  6: "JointPose",
} as const;

/** Where the character's attention or a primitive's subject can point. */
export type TargetRef = "none" | "pointer" | "user" | "screen" | "self";

/** Body areas the pointer can be over, and that a touch can land on. */
export type BodyRegion = "none" | "head" | "face" | "body" | "hand" | "tail";

/** Agent lifecycle, unchanged from the existing `BrainAgentState`. */
export type AgentLifecycle =
  | "idle" | "thinking" | "editing" | "testing" | "waiting" | "success" | "error";

export const TARGET_REFS: readonly TargetRef[] = ["none", "pointer", "user", "screen", "self"];
export const BODY_REGIONS: readonly BodyRegion[] = ["none", "head", "face", "body", "hand", "tail"];
export const AGENT_LIFECYCLES: readonly AgentLifecycle[] = [
  "idle", "thinking", "editing", "testing", "waiting", "success", "error",
];
