import {
  NEURO_SCHEMA_VERSION,
  type CharacterState, type MotorPlan, type MotorPrimitive, type PerceptionEvent,
} from "../contracts";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function plan(actions: MotorPrimitive[], durationMs: number): MotorPlan {
  return {
    schemaVersion: NEURO_SCHEMA_VERSION,
    actions,
    durationMs,
    confidence: 1,
    source: "reflex",
  };
}

/**
 * The spinal layer: body first, understanding afterwards.
 *
 * A poke in the face has to produce a blink before anything has decided how to feel
 * about it. Routing that through a planner — let alone a model — is what makes a pet
 * feel like a puppet: the lag is small in milliseconds and enormous in perceived
 * aliveness. So this runs synchronously on the perception event, returns a short
 * high-confidence plan, and the brain gets the same event to think about in its own
 * time.
 *
 * Contains no state and no AI, and must stay that way.
 */
export function reflexFor(event: PerceptionEvent, character: CharacterState): MotorPlan | null {
  const jumpiness = clamp01(0.4 + character.emotion.fear * 0.6 - character.personality.patience * 0.2);

  switch (event.kind) {
    case "touch": {
      const actions: MotorPrimitive[] = [
        { type: "expression", expression: "blink", weight: 0.8 },
      ];
      if (event.region === "face") {
        actions.push({ type: "recoil", from: "pointer", strength: clamp01(0.2 * jumpiness + 0.1) });
        actions.push({ type: "earPose", pose: "back", weight: 0.3 });
      }
      return plan(actions, 220);
    }

    case "repeated-touch":
      return plan([
        { type: "recoil", from: "pointer", strength: clamp01(0.12 * event.repeat * jumpiness) },
        { type: "earPose", pose: "back", weight: clamp01(0.25 + event.repeat * 0.08) },
        { type: "expression", expression: "surprised", weight: 0.35 },
      ], 300);

    case "grabbed":
      return plan([
        { type: "recoil", from: "pointer", strength: clamp01(0.45 * jumpiness + 0.25) },
        { type: "earPose", pose: "back", weight: 0.85 },
        { type: "tailMotion", motion: "tuck", weight: 0.8 },
        { type: "expression", expression: "surprised", weight: 0.9 },
      ], 400);

    case "released":
      return plan([
        { type: "idleStyle", style: "alert", weight: 0.6 },
        { type: "expression", expression: "blink", weight: 0.5 },
      ], 350);

    case "pointer-approaching":
      // Only a genuinely fast approach startles; a slow one is the brain's business.
      if (event.intensity < 0.5) return null;
      return plan([
        { type: "expression", expression: "surprised", weight: clamp01(event.intensity * 0.6) },
        { type: "earPose", pose: "perked", weight: 0.5 },
      ], 250);

    default:
      return null;
  }
}
