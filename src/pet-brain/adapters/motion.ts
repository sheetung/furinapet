import type { MotionIntent } from "../../motion/types";
import type { Reaction } from "../../types";
import type { BrainAgentState, PetSemanticAction } from "../types";

let sequence = 0;

function intent(kind: MotionIntent["kind"], intensity: number, durationMs: number): MotionIntent {
  sequence += 1;
  return { kind, intensity, durationMs, id: sequence };
}

/**
 * Semantic action → motion intent.
 *
 * The 3D counterpart of `reaction.ts`: that adapter picks a sprite row, this one
 * picks a Cerebellum routine. Both consume the same `PetSemanticAction`, so the
 * Brain does not know or care which renderer is mounted — which is the whole point
 * of keeping the Brain's vocabulary semantic.
 */
export function motionIntentForSemanticAction(
  action: PetSemanticAction,
  agentState: BrainAgentState,
): MotionIntent | null {
  switch (action.type) {
    case "idle":
      return intent("idle", 0.3, action.durationMs ?? 1200);
    case "respond":
      if (action.intensity === "excited") return intent("cheer", 1, 2200);
      return action.intensity === "normal" ? intent("observe", 0.5, 1900) : intent("greet", 0.6, 1700);
    case "observe":
      if (agentState === "error") return intent("slump", 0.6, action.durationMs);
      if (agentState === "waiting") return intent("observe", 0.25, action.durationMs);
      if (agentState === "editing" || agentState === "testing") return intent("observe", 0.7, action.durationMs);
      return intent("observe", 0.45, action.durationMs);
    case "celebrate":
      return intent("cheer", action.intensity === "excited" ? 1 : 0.7, action.intensity === "excited" ? 2800 : 2200);
    case "rest":
      return intent("slump", 0.5, action.durationMs);
    case "wander":
      return intent("locomote", 0.5, 0);
    case "wait":
    case "dock":
      return null;
  }
}

/**
 * Sprite reaction → motion intent.
 *
 * A bridge, not the architecture. `PetView` already resolves every source of
 * behaviour — brain plans, MCP reactions, drag and wander — down to one reaction
 * string, so mirroring that string keeps the 3D backend in step with the 2D one
 * without a second copy of the arbitration logic.
 */
export function motionIntentForReaction(reaction: Reaction | "run-left" | "run-right"): MotionIntent {
  switch (reaction) {
    case "waving":
      return intent("greet", 0.7, 0);
    case "jumping":
      return intent("cheer", 0.9, 0);
    case "failed":
      return intent("slump", 0.7, 0);
    case "waiting":
      return intent("slump", 0.3, 0);
    case "running":
      return intent("observe", 0.7, 0);
    case "review":
      return intent("observe", 0.45, 0);
    case "run-left":
    case "run-right":
      return intent("locomote", 0.6, 0);
    case "idle":
      return intent("idle", 0.3, 0);
  }
}
