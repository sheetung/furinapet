import type { WanderProfile } from "../../core/wander-controller";
import { PetBrain } from "../index";
import type { BrainAgentState, PetGoalId } from "../types";

export interface WanderDecisionInput {
  now: number;
  autonomousMovement: boolean;
  canMove: boolean;
  canDock: boolean;
  userReactionActive: boolean;
  agentState?: BrainAgentState;
  idleForMs: number;
  wanderWeight: number;
  dockWeight: number;
  missedOpportunities: number;
  profile: WanderProfile;
}

export function planWanderGoal(brain: PetBrain, input: WanderDecisionInput): PetGoalId {
  const effectiveWanderWeight = input.wanderWeight <= 0
    ? 0
    : Math.min(1, Math.max(0, input.wanderWeight) + Math.min(4, input.missedOpportunities) * 0.05);
  const effectiveDockWeight = input.dockWeight <= 0
    ? 0
    : Math.min(1, Math.max(0, input.dockWeight) + Math.min(4, input.missedOpportunities) * 0.03);
  const plan = brain.plan({
    now: input.now,
    autonomousMovement: input.autonomousMovement,
    canMove: input.canMove,
    canDock: input.canDock,
    userReactionActive: input.userReactionActive,
    agentState: input.agentState ?? brain.blackboard.getAgentState(),
    idleForMs: Math.max(0, input.idleForMs),
    wanderWeight: effectiveWanderWeight,
    dockWeight: effectiveDockWeight,
    activity: input.profile.activity,
    curiosity: input.profile.curiosity,
  });
  return plan.goal;
}
