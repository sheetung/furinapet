/**
 * Rule cerebellum v1 (neuro L4 → L5).
 *
 * Synthesizes a NeuroBrainIntent from a planner plan plus the character
 * state, then maps it (per semantic action) onto a MotorPlan of primitives.
 * Rules are deterministic — this is the stand-in for the future
 * FunctionGemma/MotorNet cerebellum and must stay cheap and side-effect free.
 */

import type {
  CharacterState,
  MotorPlan,
  NeuroBrainIntent,
  WorldState,
} from "../contracts";
import { normalizeBrainIntent } from "../contracts";
import type { PetActionPlan, PetSemanticAction } from "../../pet-brain/types";

export function synthesizeBrainIntent(
  plan: PetActionPlan,
  character: CharacterState,
  world: WorldState,
): NeuroBrainIntent {
  const { emotion } = character;
  return normalizeBrainIntent({
    goal: plan.goal,
    attention: character.attention.target === "none"
      ? undefined
      : { target: character.attention.target, strength: character.attention.strength },
    motorTendency: {
      approach: emotion.affection * 0.5 + emotion.happiness * 0.25 + (plan.goal === "respond-user" ? 0.15 : 0),
      avoidance: emotion.annoyance * 0.55 + emotion.fear * 0.6,
      energy: character.energy,
      expressiveness: character.arousal * 0.5 + emotion.happiness * 0.3 + 0.2,
    },
    confidence: plan.score,
  });
}

/** Avoidance override threshold for the sustained-head-touch rule. */
export const AVOIDANCE_OVERRIDE = 0.5;
const HEAD_REGIONS = ["head", "face"] as const;

export function planMotor(
  intent: NeuroBrainIntent,
  character: CharacterState,
  world: WorldState,
  action: PetSemanticAction,
): MotorPlan {
  const confidence = intent.confidence;

  switch (action.type) {
    case "idle":
      return { actions: [{ type: "idleStyle", style: "normal", weight: 0.6 }], durationMs: action.durationMs ?? 1200, confidence };
    case "wander":
      return { actions: [], durationMs: 0, confidence, locomotion: "wander" };
    case "dock":
      return { actions: [], durationMs: 0, confidence, locomotion: "dock" };
    case "wait":
      return { actions: [], durationMs: action.durationMs, confidence };
    case "rest":
      return {
        actions: [
          { type: "idleStyle", style: "sleepy", weight: 0.8 },
          { type: "expression", expression: "tired", intensity: 0.5 },
        ],
        durationMs: action.durationMs,
        confidence,
      };
    case "observe": {
      const agentState = world.agent.state;
      let actions: MotorPlan["actions"];
      if (agentState === "error") {
        actions = [{ type: "expression", expression: "sad", intensity: 0.7 }];
      } else if (agentState === "waiting") {
        actions = [{ type: "idleStyle", style: "alert", weight: 0.5 }];
      } else if (agentState === "editing" || agentState === "testing") {
        actions = [{ type: "turn", direction: "right", weight: 0.4 }];
      } else {
        actions = [{ type: "lookAt", target: "agent", weight: 0.6 }];
      }
      if (character.emotion.curiosity > 0.6) {
        actions = [...actions, { type: "earPose", pose: "perked", weight: 0.4 }];
      }
      return { actions, durationMs: action.durationMs, confidence };
    }
    case "respond": {
      // Sustained head touching with high annoyance: dodge instead of
      // engaging, but never at fear magnitude.
      if (
        intent.motorTendency.avoidance > AVOIDANCE_OVERRIDE &&
        HEAD_REGIONS.includes(world.pointer.targetRegion as (typeof HEAD_REGIONS)[number])
      ) {
        const strength = Math.min(0.8, 0.45 + intent.motorTendency.avoidance * 0.3);
        return {
          actions: [
            { type: "recoil", from: "pointer", strength },
            { type: "lookAway", target: "pointer", weight: 0.3 + intent.motorTendency.avoidance * 0.2 },
            { type: "earPose", pose: "back", weight: character.emotion.annoyance },
          ],
          durationMs: 2200,
          confidence,
        };
      }

      const annoyed = character.emotion.annoyance > 0.3
        ? [{ type: "earPose" as const, pose: "back" as const, weight: character.emotion.annoyance }]
        : [];
      if (action.intensity === "excited") {
        return {
          actions: [
            { type: "gesture", gesture: "cheer", weight: 0.9 },
            { type: "expression", expression: "happy", intensity: 0.8 },
            { type: "tailMotion", motion: "wag", weight: 0.7 },
            ...annoyed,
          ],
          durationMs: 2200,
          confidence,
        };
      }
      if (action.intensity === "normal") {
        return {
          actions: [
            { type: "gesture", gesture: "point", weight: 0.55 },
            { type: "lookAt", target: "pointer", weight: 0.3 },
            ...annoyed,
          ],
          durationMs: 1900,
          confidence,
        };
      }
      return {
        actions: [
          { type: "gesture", gesture: "wave", weight: 0.6 },
          { type: "expression", expression: "happy", intensity: 0.35 },
          ...annoyed,
        ],
        durationMs: 1700,
        confidence,
      };
    }
    case "celebrate": {
      if (action.intensity === "excited") {
        return {
          actions: [
            { type: "gesture", gesture: "cheer", weight: 1 },
            { type: "expression", expression: "happy", intensity: 1 },
            { type: "tailMotion", motion: "wag", weight: 1 },
          ],
          durationMs: 2800,
          confidence,
        };
      }
      return {
        actions: [
          { type: "gesture", gesture: "cheer", weight: 0.8 },
          { type: "expression", expression: "happy", intensity: 0.7 },
        ],
        durationMs: 2200,
        confidence,
      };
    }
  }
}
