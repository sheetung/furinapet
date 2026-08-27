/**
 * FurinaPet neuro contracts (the "neuro system ABI", schema version 1).
 *
 * Data levels:
 *   1. PerceptionEvent   — what just happened, typed
 *   2. WorldState        — reduced semantic environment
 *   3. CharacterState    — the character's own emotion/energy/attention
 *   4. NeuroBrainIntent  — what the brain wants (never animation data)
 *   5. MotorPlan         — how the intent is expressed as motor primitives
 *
 * Adding fields is additive and bumps nothing; changing/removing fields
 * requires a schema version bump. The LLM brain may never emit anything
 * below level 4.
 */

export const NEURO_SCHEMA_VERSION = 1;

export * from "./perception-event";
export * from "./world-state";
export * from "./character-state";
export * from "./brain-intent";
export * from "./motor-plan";
