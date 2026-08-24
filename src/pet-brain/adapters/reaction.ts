import type { Reaction } from "../../types";
import type { BrainAgentState, PetSemanticAction } from "../types";

export interface ReactionDirective {
  reaction: Reaction;
  durationMs: number;
}

export function reactionForSemanticAction(
  action: PetSemanticAction,
  agentState: BrainAgentState,
): ReactionDirective | null {
  switch (action.type) {
    case "idle":
      return { reaction: "idle", durationMs: action.durationMs ?? 1200 };
    case "respond":
      return action.intensity === "excited"
        ? { reaction: "jumping", durationMs: 2200 }
        : action.intensity === "normal"
          ? { reaction: "review", durationMs: 1900 }
          : { reaction: "waving", durationMs: 1700 };
    case "observe":
      if (agentState === "waiting") return { reaction: "waiting", durationMs: action.durationMs };
      if (agentState === "editing" || agentState === "testing") {
        return { reaction: "running", durationMs: action.durationMs };
      }
      return { reaction: "review", durationMs: action.durationMs };
    case "celebrate":
      return { reaction: "jumping", durationMs: action.intensity === "excited" ? 2800 : 2200 };
    case "rest":
      return { reaction: "waiting", durationMs: action.durationMs };
    case "wait":
    case "wander":
    case "dock":
      return null;
  }
}
