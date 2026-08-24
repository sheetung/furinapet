import type { WanderProfile } from "../../core/wander-controller";
import { PetBrain } from "../index";
import type { BrainAgentState, PetGoalId } from "../types";

export interface WanderDecisionInput {
  now: number;
  autoWander: boolean;
  canMove: boolean;
  canDock: boolean;
  userReactionActive: boolean;
  agentState?: BrainAgentState;
  idleForMs: number;
  wanderProbability: number;
  missedOpportunities: number;
  profile: WanderProfile;
}

export function planWanderGoal(brain: PetBrain, input: WanderDecisionInput): PetGoalId {
  const effectiveProbability = Math.min(
    1,
    Math.max(0, input.wanderProbability) + Math.min(4, input.missedOpportunities) * 0.08,
  );
  const plan = brain.plan({
    now: input.now,
    autoWander: input.autoWander,
    canMove: input.canMove,
    canDock: input.canDock,
    userReactionActive: input.userReactionActive,
    agentState: input.agentState ?? brain.blackboard.getAgentState(),
    idleForMs: Math.max(0, input.idleForMs),
    wanderProbability: effectiveProbability,
    activity: input.profile.activity,
    curiosity: input.profile.curiosity,
  });
  return plan.goal;
}
