import { describe, expect, it } from "vitest";
import { arbitrateDecision, buildPlanFromAiIntent } from "./arbitration";
import { PetBlackboard } from "./Blackboard";
import type { BrainIntent, PetActionPlan, PetSemanticAction, PetGoalId, GoalScore } from "./types";
import type { StructuredBrainResult } from "../neuro/brain/structured-brain";
import { NEUTRAL_MOTOR_TENDENCY } from "../neuro/contracts";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makeIntent(overrides: Partial<BrainIntent> = {}): BrainIntent {
  return {
    id: "intent-1",
    source: "user",
    goal: "respond-user",
    priority: 0.9,
    createdAt: 1000,
    expiresAt: 2200,
    ...overrides,
  };
}

function makeRulePlan(goal: PetGoalId = "idle", score = 0.5): PetActionPlan {
  return {
    id: "rule-plan-1",
    goal,
    score,
    reason: "rule",
    createdAt: 1000,
    actions: [{ type: "idle", durationMs: 2000 }] as PetSemanticAction[],
    candidates: [{ goal, score, reason: "rule" }] as GoalScore[],
  };
}

function makeAiResult(goal: PetGoalId = "wander", confidence = 0.75): StructuredBrainResult {
  return {
    intent: {
      goal,
      confidence,
      motorTendency: { ...NEUTRAL_MOTOR_TENDENCY },
    },
    raw: {},
    latencyMs: 200,
  };
}

function makeBlackboard(): PetBlackboard {
  return new PetBlackboard();
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("arbitrateDecision", () => {
  it("AI wins when no pending intents", () => {
    const ai = makeAiResult("wander", 0.75);
    const rule = makeRulePlan("idle", 0.3);
    const result = arbitrateDecision(ai, rule, [], makeBlackboard(), 1000);
    expect(result.source).toBe("ai");
    expect(result.plan.goal).toBe("wander");
    expect(result.plan.source).toBe("ai");
  });

  it("user intent (priority 0.9) beats AI (cap 0.82)", () => {
    const ai = makeAiResult("rest", 0.8);
    const rule = makeRulePlan("respond-user", 0.9);
    const intents = [makeIntent({ source: "user", priority: 0.9 })];
    const result = arbitrateDecision(ai, rule, intents, makeBlackboard(), 1000);
    expect(result.source).toBe("rule");
    expect(result.plan.goal).toBe("respond-user");
  });

  it("AI at cap (0.82) beats plugin intent (priority 0.7)", () => {
    const ai = makeAiResult("celebrate", 0.82);
    const rule = makeRulePlan("idle", 0.3);
    const intents = [makeIntent({ source: "plugin", goal: "idle", priority: 0.7 })];
    const result = arbitrateDecision(ai, rule, intents, makeBlackboard(), 1000);
    expect(result.source).toBe("ai");
    expect(result.plan.goal).toBe("celebrate");
  });

  it("agent intent (priority 0.95, cap 0.95) beats AI", () => {
    const ai = makeAiResult("observe-agent", 0.82);
    const rule = makeRulePlan("observe-agent", 0.85);
    const intents = [makeIntent({ source: "agent", goal: "observe-agent", priority: 0.95 })];
    const result = arbitrateDecision(ai, rule, intents, makeBlackboard(), 1000);
    expect(result.source).toBe("rule");
  });

  it("AI null (not configured) falls back to rule plan", () => {
    const rule = makeRulePlan("idle", 0.5);
    const result = arbitrateDecision(null, rule, [], makeBlackboard(), 1000);
    expect(result.source).toBe("rule");
    expect(result.plan.goal).toBe("idle");
    expect(result.plan.source).toBe("rule");
  });

  it("AI confidence equals best intent: AI wins (tie-break)", () => {
    const ai = makeAiResult("wander", 0.7);
    const rule = makeRulePlan("idle", 0.3);
    const intents = [makeIntent({ source: "plugin", goal: "idle", priority: 0.7 })];
    // plugin cap is 0.95, effective = min(0.95, 0.7) = 0.7
    // ai cap is 0.82, effective = min(0.82, 0.7) = 0.7
    // AI >= bestIntent → AI wins
    const result = arbitrateDecision(ai, rule, intents, makeBlackboard(), 1000);
    expect(result.source).toBe("ai");
  });

  it("system intent (priority 1.0, cap 1.0) always beats AI", () => {
    const ai = makeAiResult("celebrate", 0.82);
    const rule = makeRulePlan("idle", 0.3);
    const intents = [makeIntent({ source: "system", goal: "rest", priority: 1.0 })];
    const result = arbitrateDecision(ai, rule, intents, makeBlackboard(), 1000);
    expect(result.source).toBe("rule");
  });

  it("double-click intent (priority 0.97) beats AI", () => {
    const ai = makeAiResult("respond-user", 0.82);
    const rule = makeRulePlan("respond-user", 0.97);
    const intents = [makeIntent({ source: "user", goal: "respond-user", priority: 0.97 })];
    const result = arbitrateDecision(ai, rule, intents, makeBlackboard(), 1000);
    expect(result.source).toBe("rule");
  });
});

describe("buildPlanFromAiIntent", () => {
  it("uses rule plan actions when goals match", () => {
    const rule = makeRulePlan("respond-user", 0.5);
    rule.actions = [{ type: "respond", intensity: "excited" }];
    const bb = makeBlackboard();
    const plan = buildPlanFromAiIntent(
      { goal: "respond-user", confidence: 0.7, motorTendency: { ...NEUTRAL_MOTOR_TENDENCY } },
      rule,
      bb,
      2000,
    );
    expect(plan.actions).toEqual(rule.actions);
    expect(plan.source).toBe("ai");
    expect(plan.score).toBe(0.7);
  });

  it("generates actions via actionsForGoal when goals differ", () => {
    const rule = makeRulePlan("idle", 0.3);
    const bb = makeBlackboard();
    const plan = buildPlanFromAiIntent(
      { goal: "wander", confidence: 0.8, motorTendency: { ...NEUTRAL_MOTOR_TENDENCY } },
      rule,
      bb,
      2000,
    );
    expect(plan.goal).toBe("wander");
    expect(plan.actions).toEqual([{ type: "wander" }]);
    expect(plan.source).toBe("ai");
  });
});
