import type { Reaction } from "../../types";
import type { BrainAgentState, PetSemanticAction } from "../types";
import type { Activity } from '../needs';

export interface ReactionDirective {
  reaction: Reaction;
  durationMs: number;
  activity: Activity;
}

export function reactionForSemanticAction(
  action: PetSemanticAction,
  agentState: BrainAgentState,
): ReactionDirective | null {
  switch (action.type) {
    case "idle":
      return { reaction: "idle", durationMs: action.durationMs ?? 1200, activity: 'idle' };
    case "respond":
      return action.intensity === "excited"
        ? { reaction: "jumping", durationMs: 2200, activity: 'play' }
        : action.intensity === "normal"
          ? { reaction: "review", durationMs: 1900, activity: 'observe' }
          : { reaction: "waving", durationMs: 1700, activity: 'play' };
    case "observe":
      if (agentState === "error") return { reaction: "failed", durationMs: action.durationMs, activity: 'observe' };
      if (agentState === "waiting") return { reaction: "waiting", durationMs: action.durationMs, activity: 'observe' };
      if (agentState === "editing" || agentState === "testing") {
        return { reaction: "running", durationMs: action.durationMs, activity: 'observe' };
      }
      return { reaction: "review", durationMs: action.durationMs, activity: 'observe' };
    case "celebrate":
      return { reaction: "jumping", durationMs: action.intensity === "excited" ? 2800 : 2200, activity: 'play' };
    case "rest":
      return { reaction: "waiting", durationMs: action.durationMs, activity: 'rest' };
    case "wait":
    case "wander":
    case "dock":
      return null;
  }
}
