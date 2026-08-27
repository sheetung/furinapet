/**
 * Pure-function pipeline runner for integration tests.
 *
 * Chains the cerebellum's synthesizeBrainIntent → planMotor → reactionForMotorPlan
 * without going through the Blackboard/CharacterStore singletons. Tests pass
 * pre-built CharacterState and WorldState values directly.
 */

import type { CharacterState, WorldState, NeuroBrainIntent, MotorPlan } from "../../contracts";
import { synthesizeBrainIntent, planMotor } from "../../cerebellum/rule-cerebellum";
import { reactionForMotorPlan, type ReactionDirective } from "../../motion/legacy-sprite-backend";
import type { PetActionPlan, PetSemanticAction } from "../../../pet-brain/types";

export interface PipelineResult {
  intent: NeuroBrainIntent;
  motorPlan: MotorPlan;
  directive: ReactionDirective | null;
}

/**
 * Run the brain pipeline on a single action from a plan.
 * Skips the Blackboard planner — the plan is provided directly.
 */
export function runPipeline(
  plan: PetActionPlan,
  action: PetSemanticAction,
  character: CharacterState,
  world: WorldState,
): PipelineResult {
  const intent = synthesizeBrainIntent(plan, character, world);
  const motorPlan = planMotor(intent, character, world, action);
  const directive = reactionForMotorPlan(motorPlan);
  return { intent, motorPlan, directive };
}

/**
 * Run the pipeline for the first action in a plan. Convenience wrapper for
 * plans with a single action (the common case in integration tests).
 */
export function runFirstAction(
  plan: PetActionPlan,
  character: CharacterState,
  world: WorldState,
): PipelineResult {
  const action = plan.actions[0];
  if (!action) throw new Error("plan has no actions");
  return runPipeline(plan, action, character, world);
}
