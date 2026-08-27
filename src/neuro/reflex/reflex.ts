/**
 * Spinal reflex layer (neuro reflex arc).
 *
 * Zero-AI, deterministic, immediate motor responses to salient stimuli.
 * Fires BEFORE the brain pipeline — body reacts first, brain understands later.
 *
 * Each reflex maps a PerceptionEvent directly onto a MotorPlan of primitives.
 * Returns null when no reflex triggers (the brain pipeline handles the event).
 */

import type { MotorPlan, MotorPrimitive } from "../contracts";
import type { PerceptionEvent } from "../contracts";

/** Identifier for debugging and trace. */
export type ReflexName = "blink" | "startle" | "grip" | "flinch";

export interface ReflexResult {
  name: ReflexName;
  plan: MotorPlan;
}

/* ------------------------------------------------------------------ */
/*  Reflex thresholds                                                  */
/* ------------------------------------------------------------------ */

/** Click streak at which the character flinches from repeated poking. */
const FLINCH_STREAK_THRESHOLD = 6;

/* ------------------------------------------------------------------ */
/*  Individual reflex rules                                            */
/* ------------------------------------------------------------------ */

function blink(event: Extract<PerceptionEvent, { type: "touch" }>): ReflexResult | null {
  if (event.sense !== "pet:clicked") return null;
  if (event.region !== "face" && event.region !== "head") return null;

  const intensity = event.region === "face" ? 0.6 : 0.35;
  const recoilStrength = event.region === "face" ? 0.25 : 0.12;

  const actions: MotorPrimitive[] = [
    { type: "expression", expression: "surprised", intensity },
    { type: "recoil", from: "pointer", strength: recoilStrength },
  ];

  if (event.region === "face") {
    actions.push({ type: "earPose", pose: "back", weight: 0.3 });
  }

  return {
    name: "blink",
    plan: { actions, durationMs: 380, confidence: 1 },
  };
}

function startle(event: Extract<PerceptionEvent, { type: "touch" }>): ReflexResult | null {
  if (event.sense !== "pet:doubleClicked") return null;

  return {
    name: "startle",
    plan: {
      actions: [
        { type: "recoil", from: "pointer", strength: 0.45 },
        { type: "lookAway", target: "pointer", weight: 0.3 },
        { type: "earPose", pose: "back", weight: 0.5 },
      ],
      durationMs: 550,
      confidence: 1,
    },
  };
}

function grip(event: Extract<PerceptionEvent, { type: "drag" }>): ReflexResult | null {
  if (event.phase !== "start") return null;

  return {
    name: "grip",
    plan: {
      actions: [
        { type: "lean", direction: "back", weight: 0.35 },
        { type: "expression", expression: "surprised", intensity: 0.3 },
      ],
      durationMs: 450,
      confidence: 1,
    },
  };
}

function flinch(event: Extract<PerceptionEvent, { type: "touch" }>): ReflexResult | null {
  if (event.sense !== "pet:clicked") return null;
  if (event.streak < FLINCH_STREAK_THRESHOLD) return null;

  const severity = Math.min(1, 0.4 + (event.streak - FLINCH_STREAK_THRESHOLD) * 0.08);

  return {
    name: "flinch",
    plan: {
      actions: [
        { type: "recoil", from: "pointer", strength: severity * 0.6 },
        { type: "earPose", pose: "back", weight: severity },
        { type: "expression", expression: "annoyed", intensity: severity * 0.7 },
      ],
      durationMs: 500,
      confidence: 1,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Evaluate all reflex arcs for a perception event.
 * Returns the first (highest-priority) matching reflex, or null.
 *
 * Priority order: startle > flinch > blink > grip
 * (startle is most urgent — a double-click override blink on a rapid second tap)
 */
export function evaluateReflex(event: PerceptionEvent): ReflexResult | null {
  switch (event.type) {
    case "touch":
      return startle(event) ?? flinch(event) ?? blink(event);
    case "drag":
      return grip(event);
    default:
      return null;
  }
}
