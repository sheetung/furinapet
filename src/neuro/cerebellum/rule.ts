import {
  MAX_PLAN_ACTIONS, NEURO_SCHEMA_VERSION,
  type BrainIntent, type CharacterState, type MotorPlan, type MotorPrimitive,
  type TargetRef, type WorldState,
} from "../contracts";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The rule cerebellum.
 *
 * Documentation-wise this is the least glamorous file here and architecturally the most
 * important: it proves the whole chain runs before a single model is trained. Later it
 * becomes the fallback and the shadow baseline that a 270M function-calling model — and
 * eventually a distilled sub-10M motor net — is measured against, which is also why it
 * returns nothing but `MotorPrimitive`s. If this file ever mentions a bone or an
 * animation row, the replacement plan stops working.
 */
export class RuleCerebellum {
  plan(world: WorldState, character: CharacterState, intent: BrainIntent): MotorPlan {
    const actions: MotorPrimitive[] = [];
    const { emotion, personality } = character;
    const { approach, avoidance, energy, expressiveness } = intent.motorTendency;
    const focus: TargetRef = intent.attention?.target ?? "none";
    const focusStrength = clamp01(intent.attention?.strength ?? 0);

    switch (intent.goal) {
      case "avoid": {
        actions.push({ type: "recoil", from: focus === "none" ? "pointer" : focus, strength: avoidance });
        // She looks away, but not so hard that she stops tracking what is bothering her:
        // a character that fully breaks gaze reads as broken rather than annoyed.
        actions.push({ type: "lookAway", target: "pointer", weight: clamp01(avoidance * 0.6) });
        actions.push({ type: "lookAt", target: "pointer", weight: clamp01(0.3 * focusStrength) });
        actions.push({ type: "lean", direction: "back", weight: clamp01(avoidance * 0.7) });
        actions.push({ type: "earPose", pose: "back", weight: clamp01(0.4 + emotion.annoyance * 0.6) });
        actions.push({ type: "tailMotion", motion: "flick", weight: clamp01(avoidance * expressiveness) });
        actions.push({
          type: "expression",
          expression: emotion.fear > emotion.annoyance ? "sad" : "angry",
          weight: clamp01(Math.max(emotion.fear, emotion.annoyance) * expressiveness),
        });
        break;
      }

      case "interact": {
        actions.push({ type: "lookAt", target: focus === "none" ? "pointer" : focus, weight: Math.max(0.7, focusStrength) });
        if (intent.socialIntent === "greet") {
          actions.push({ type: "gesture", gesture: "wave", weight: clamp01(0.5 + expressiveness * 0.5) });
        }
        if (intent.socialIntent === "complain") {
          actions.push({ type: "gesture", gesture: "shrug", weight: clamp01(0.4 + personality.dramatism * 0.5) });
          actions.push({ type: "earPose", pose: "back", weight: clamp01(emotion.annoyance) });
        }
        if (intent.socialIntent === "tease") {
          actions.push({ type: "expression", expression: "smug", weight: clamp01(0.5 + personality.dramatism * 0.5) });
        }
        actions.push({ type: "lean", direction: "forward", weight: clamp01(approach * 0.6) });
        actions.push({
          type: "expression",
          expression: emotion.annoyance > 0.55 ? "angry" : "happy",
          weight: clamp01((0.4 + emotion.happiness * 0.5) * expressiveness),
        });
        actions.push({ type: "tailMotion", motion: "wag", weight: clamp01(emotion.affection * expressiveness) });
        actions.push({ type: "idleStyle", style: "alert", weight: 0.6 });
        break;
      }

      case "celebrate": {
        actions.push({ type: "gesture", gesture: "cheer", weight: clamp01(0.6 + expressiveness * 0.4) });
        actions.push({ type: "expression", expression: "happy", weight: 1 });
        actions.push({ type: "lookAt", target: focus === "none" ? "user" : focus, weight: 0.8 });
        actions.push({ type: "tailMotion", motion: "wag", weight: 1 });
        actions.push({ type: "earPose", pose: "perked", weight: 0.9 });
        actions.push({ type: "lean", direction: "forward", weight: clamp01(energy * 0.5) });
        break;
      }

      case "observe": {
        actions.push({ type: "lookAt", target: focus === "none" ? "screen" : focus, weight: Math.max(0.75, focusStrength) });
        actions.push({ type: "earPose", pose: "perked", weight: 0.55 });
        actions.push({ type: "idleStyle", style: "alert", weight: 0.7 });
        if (intent.socialIntent === "comfort") {
          actions.push({ type: "expression", expression: "sad", weight: clamp01(0.5 * expressiveness) });
          actions.push({ type: "lean", direction: "forward", weight: 0.25 });
        }
        actions.push({ type: "tailMotion", motion: "sway", weight: 0.3 });
        break;
      }

      case "approach": {
        const direction = world.pointer.dx >= 0 ? "right" : "left";
        actions.push({ type: "turn", direction, weight: clamp01(approach * 0.7) });
        actions.push({ type: "step", direction: "forward", weight: clamp01(approach) });
        actions.push({ type: "lookAt", target: focus === "none" ? "user" : focus, weight: 0.85 });
        actions.push({ type: "tailMotion", motion: "sway", weight: clamp01(0.4 + approach * 0.5) });
        actions.push({ type: "expression", expression: "happy", weight: clamp01(0.3 * expressiveness) });
        if (intent.socialIntent === "plead") {
          actions.push({ type: "earPose", pose: "droop", weight: clamp01(0.4 + emotion.boredom * 0.5) });
        }
        break;
      }

      case "rest": {
        actions.push({ type: "idleStyle", style: "sleepy", weight: clamp01(0.5 + emotion.sleepiness * 0.5) });
        actions.push({ type: "expression", expression: "tired", weight: clamp01(emotion.sleepiness) });
        actions.push({ type: "earPose", pose: "droop", weight: 0.7 });
        actions.push({ type: "tailMotion", motion: "still", weight: 0.8 });
        actions.push({ type: "lookAway", target: "pointer", weight: 0.3 });
        break;
      }

      case "idle": {
        const style = emotion.sleepiness > 0.5 ? "sleepy" : emotion.boredom > 0.5 ? "bored" : "relaxed";
        actions.push({ type: "idleStyle", style, weight: 0.7 });
        if (focus !== "none" && focusStrength > 0.1) {
          actions.push({ type: "lookAt", target: focus, weight: clamp01(focusStrength * 0.7) });
        }
        actions.push({ type: "tailMotion", motion: "sway", weight: clamp01(0.25 + expressiveness * 0.3) });
        actions.push({ type: "earPose", pose: "neutral", weight: 0.4 });
        break;
      }
    }

    const kept = actions
      .filter((action) => ("weight" in action ? action.weight : action.strength) > 0.02)
      .slice(0, MAX_PLAN_ACTIONS);

    return {
      schemaVersion: NEURO_SCHEMA_VERSION,
      actions: kept,
      durationMs: Math.max(200, Math.min(8000, intent.ttlMs)),
      confidence: clamp01(intent.confidence),
      source: "rule",
    };
  }
}
