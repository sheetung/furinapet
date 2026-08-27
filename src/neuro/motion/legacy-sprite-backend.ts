/**
 * Legacy sprite motion backend (neuro L5 → existing Reaction system).
 *
 * Translates a MotorPlan into the v2 sprite atlas vocabulary. This replaces
 * pet-brain's fixed `reactionForSemanticAction` mapping; the scan order below
 * is chosen so the standard plans produce byte-for-byte the same reactions
 * and durations as the old table (verified by unit tests).
 */

import type { MotorPlan } from "../contracts";
import type { Reaction } from "../../types";

export interface ReactionDirective {
  reaction: Reaction;
  durationMs: number;
}

export function reactionForMotorPlan(
  plan: MotorPlan,
  fallbackDurationMs?: number,
): ReactionDirective | null {
  const fallback = fallbackDurationMs ?? 2600;
  const first = <T extends MotorPlan["actions"][number]["type"]>(type: T) =>
    plan.actions.find((action) => action.type === type);

  const recoil = first("recoil");
  if (recoil && recoil.type === "recoil") {
    return { reaction: "failed", durationMs: 2200 };
  }

  const gesture = first("gesture");
  if (gesture && gesture.type === "gesture") {
    switch (gesture.gesture) {
      case "cheer":
        return { reaction: "jumping", durationMs: gesture.weight >= 0.95 ? 2800 : 2200 };
      case "wave":
        return { reaction: "waving", durationMs: 1700 };
      case "deny":
        return { reaction: "failed", durationMs: fallback };
      case "point":
        return { reaction: "review", durationMs: 1900 };
    }
  }

  const expression = first("expression");
  if (expression && expression.type === "expression") {
    switch (expression.expression) {
      case "happy":
        return { reaction: "jumping", durationMs: 2200 };
      case "sad":
        return { reaction: "failed", durationMs: fallback };
      case "tired":
        return { reaction: "waiting", durationMs: fallback };
      case "surprised":
        return { reaction: "jumping", durationMs: 2200 };
      case "annoyed":
        return { reaction: "failed", durationMs: fallback };
      case "neutral":
        break;
    }
  }

  const idleStyle = first("idleStyle");
  if (idleStyle && idleStyle.type === "idleStyle") {
    if (idleStyle.style === "sleepy" || idleStyle.style === "alert") {
      return { reaction: "waiting", durationMs: fallback };
    }
    if (idleStyle.style === "sulk") {
      return { reaction: "failed", durationMs: fallback };
    }
    return { reaction: "idle", durationMs: fallback };
  }

  const turn = first("turn");
  if (turn && turn.type === "turn") {
    return { reaction: "running", durationMs: fallback };
  }

  const lookAt = first("lookAt");
  if (lookAt && lookAt.type === "lookAt") {
    return { reaction: "review", durationMs: fallback };
  }

  return null;
}
