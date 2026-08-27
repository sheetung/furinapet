/**
 * B1 Brain-as-Primary arbitration.
 *
 * Compares an AI brain decision against pending Blackboard intents using
 * SOURCE_CONFIDENCE_CAP as ceilings. The AI (cap 0.82) can win over low-
 * priority plugin/agent intents, but user/system intents (cap 1.0, typically
 * priority >= 0.9) always beat it — preserving the snappy click response.
 *
 * Pure functions with no side effects — trivially unit-testable.
 */

import { SOURCE_CONFIDENCE_CAP } from "../neuro/contracts";
import type { NeuroBrainIntent } from "../neuro/contracts";
import type { StructuredBrainResult } from "../neuro/brain/structured-brain";
import type { BrainIntent, PetActionPlan, PetGoalId } from "./types";
import type { PetBlackboard } from "./Blackboard";
import { actionsForGoal } from "./Planner";

export interface ArbitrationResult {
  plan: PetActionPlan;
  source: "ai" | "rule";
}

/**
 * Arbitrate between an AI decision and the rule planner's plan, considering
 * any pending intents on the blackboard.
 *
 * @param aiResult  Result from requestStructuredBrain (null if AI unavailable)
 * @param rulePlan  The plan produced by PetUtilityPlanner (always available as fallback)
 * @param activeIntents  Currently active intents from the blackboard
 * @param blackboard  PetBlackboard (needed for actionsForGoal when AI wins)
 * @param now  Current timestamp
 */
export function arbitrateDecision(
  aiResult: StructuredBrainResult | null,
  rulePlan: PetActionPlan,
  activeIntents: BrainIntent[],
  blackboard: PetBlackboard,
  now: number,
): ArbitrationResult {
  // Find best pending intent effective score
  let bestIntentEffective = 0;
  for (const intent of activeIntents) {
    const cap = SOURCE_CONFIDENCE_CAP[intent.source] ?? 0.8;
    const effective = Math.min(cap, intent.priority);
    if (effective > bestIntentEffective) {
      bestIntentEffective = effective;
    }
  }

  // AI competes
  if (aiResult) {
    const aiCap = SOURCE_CONFIDENCE_CAP.ai;
    const aiEffective = Math.min(aiCap, aiResult.intent.confidence);
    if (aiEffective >= bestIntentEffective) {
      const plan = buildPlanFromAiIntent(aiResult.intent, rulePlan, blackboard, now);
      return { plan, source: "ai" };
    }
  }

  // Rule wins (AI unavailable, failed, or outscored by an intent)
  return { plan: { ...rulePlan, source: "rule" }, source: "rule" };
}

/**
 * Build a PetActionPlan from a NeuroBrainIntent. Uses actionsForGoal to
 * generate the same semantic actions the rule planner would for this goal.
 */
export function buildPlanFromAiIntent(
  intent: NeuroBrainIntent,
  rulePlan: PetActionPlan,
  blackboard: PetBlackboard,
  now: number,
): PetActionPlan {
  const actions = intent.goal === rulePlan.goal
    ? rulePlan.actions
    : actionsForGoal(intent.goal, blackboard);
  return {
    id: `ai-primary-${now}`,
    goal: intent.goal,
    score: intent.confidence,
    reason: `ai-primary (confidence=${intent.confidence.toFixed(2)})`,
    createdAt: now,
    actions,
    candidates: rulePlan.candidates,
    source: "ai",
  };
}
