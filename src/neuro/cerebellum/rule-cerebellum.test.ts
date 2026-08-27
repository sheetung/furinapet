import { describe, expect, it } from "vitest";
import { planMotor, synthesizeBrainIntent, AVOIDANCE_OVERRIDE } from "./rule-cerebellum";
import type { CharacterState, WorldState } from "../contracts";
import { emptyCharacterState, emptyWorldState, normalizeBrainIntent, NEUTRAL_MOTOR_TENDENCY } from "../contracts";
import type { PetActionPlan, PetGoalId, PetSemanticAction } from "../../pet-brain/types";

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function plan(goal: PetActionPlan["goal"] = "idle", score = 0.7): PetActionPlan {
  return { id: "p1", goal, score, reason: "test", createdAt: 0, actions: [], candidates: [] };
}

function character(overrides: Partial<CharacterState> = {}): CharacterState {
  return { ...emptyCharacterState(0), ...overrides };
}

function world(overrides: Partial<WorldState> = {}): WorldState {
  return { ...emptyWorldState(0), ...overrides };
}

function baseIntent(goal: PetGoalId = "idle", confidence = 0.7) {
  return normalizeBrainIntent({ goal, motorTendency: { ...NEUTRAL_MOTOR_TENDENCY }, confidence });
}

/* ------------------------------------------------------------------ */
/*  synthesizeBrainIntent                                              */
/* ------------------------------------------------------------------ */

describe("synthesizeBrainIntent", () => {
  it("maps plan score to confidence", () => {
    const intent = synthesizeBrainIntent(plan("idle", 0.65), character(), world());
    expect(intent.confidence).toBeCloseTo(0.65);
  });

  it("carries the plan goal through", () => {
    const intent = synthesizeBrainIntent(plan("respond-user"), character(), world());
    expect(intent.goal).toBe("respond-user");
  });

  it("omits attention when character target is none", () => {
    const intent = synthesizeBrainIntent(plan(), character(), world());
    expect(intent.attention).toBeUndefined();
  });

  it("forwards attention when character has a target", () => {
    const char = character({ attention: { target: "pointer", strength: 0.8 } });
    const intent = synthesizeBrainIntent(plan(), char, world());
    expect(intent.attention).toEqual({ target: "pointer", strength: 0.8 });
  });

  it("boosts approach for respond-user goal", () => {
    const base = synthesizeBrainIntent(plan("idle"), character(), world());
    const boosted = synthesizeBrainIntent(plan("respond-user"), character(), world());
    expect(boosted.motorTendency.approach).toBeGreaterThan(base.motorTendency.approach);
  });

  it("increases avoidance with annoyance and fear", () => {
    const calm = character();
    const upset = character({ emotion: { ...calm.emotion, annoyance: 0.8, fear: 0.6 } });
    const intentCalm = synthesizeBrainIntent(plan(), calm, world());
    const intentUpset = synthesizeBrainIntent(plan(), upset, world());
    expect(intentUpset.motorTendency.avoidance).toBeGreaterThan(intentCalm.motorTendency.avoidance);
  });

  it("clamps motor tendency into 0..1", () => {
    const extreme = character({ emotion: { ...emptyCharacterState(0).emotion, annoyance: 1, fear: 1, affection: 1, happiness: 1 }, arousal: 1 });
    const intent = synthesizeBrainIntent(plan(), extreme, world());
    for (const value of Object.values(intent.motorTendency)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  planMotor — per-action branches                                    */
/* ------------------------------------------------------------------ */

describe("planMotor", () => {
  const intent = baseIntent("idle", 0.7);
  const char = character();
  const w = world();

  it("idle → idleStyle normal", () => {
    const motor = planMotor(intent, char, w, { type: "idle" });
    expect(motor.actions).toHaveLength(1);
    expect(motor.actions[0]).toEqual({ type: "idleStyle", style: "normal", weight: 0.6 });
    expect(motor.durationMs).toBe(1200);
  });

  it("idle with custom duration", () => {
    const motor = planMotor(intent, char, w, { type: "idle", durationMs: 3000 });
    expect(motor.durationMs).toBe(3000);
  });

  it("wander → empty actions + locomotion", () => {
    const motor = planMotor(intent, char, w, { type: "wander" });
    expect(motor.actions).toHaveLength(0);
    expect(motor.locomotion).toBe("wander");
  });

  it("dock → empty actions + locomotion", () => {
    const motor = planMotor(intent, char, w, { type: "dock" });
    expect(motor.actions).toHaveLength(0);
    expect(motor.locomotion).toBe("dock");
  });

  it("wait → empty actions with duration", () => {
    const motor = planMotor(intent, char, w, { type: "wait", durationMs: 500 });
    expect(motor.actions).toHaveLength(0);
    expect(motor.durationMs).toBe(500);
  });

  it("rest → sleepy idleStyle + tired expression", () => {
    const motor = planMotor(intent, char, w, { type: "rest", durationMs: 4000 });
    const types = motor.actions.map((a) => a.type);
    expect(types).toContain("idleStyle");
    expect(types).toContain("expression");
    expect(motor.durationMs).toBe(4000);
  });
});

describe("planMotor — observe", () => {
  const intent = baseIntent("observe-agent", 0.6);
  const char = character();

  it("agent error → sad expression", () => {
    const motor = planMotor(intent, char, world({ agent: { state: "error", connected: true } }), { type: "observe", durationMs: 1500 });
    const expr = motor.actions.find((a) => a.type === "expression");
    expect(expr).toBeDefined();
    if (expr?.type === "expression") expect(expr.expression).toBe("sad");
  });

  it("agent waiting → alert idleStyle", () => {
    const motor = planMotor(intent, char, world({ agent: { state: "waiting", connected: true } }), { type: "observe", durationMs: 1500 });
    const idle = motor.actions.find((a) => a.type === "idleStyle");
    expect(idle).toBeDefined();
    if (idle?.type === "idleStyle") expect(idle.style).toBe("alert");
  });

  it("agent editing → turn right", () => {
    const motor = planMotor(intent, char, world({ agent: { state: "editing", connected: true } }), { type: "observe", durationMs: 1500 });
    const turn = motor.actions.find((a) => a.type === "turn");
    expect(turn).toBeDefined();
    if (turn?.type === "turn") expect(turn.direction).toBe("right");
  });

  it("agent thinking → lookAt agent", () => {
    const motor = planMotor(intent, char, world({ agent: { state: "thinking", connected: true } }), { type: "observe", durationMs: 1500 });
    const look = motor.actions.find((a) => a.type === "lookAt");
    expect(look).toBeDefined();
    if (look?.type === "lookAt") expect(look.target).toBe("agent");
  });

  it("adds perked ears when curiosity > 0.6", () => {
    const curious = character({ emotion: { ...emptyCharacterState(0).emotion, curiosity: 0.75 } });
    const motor = planMotor(intent, curious, world({ agent: { state: "thinking", connected: true } }), { type: "observe", durationMs: 1500 });
    const ear = motor.actions.find((a) => a.type === "earPose");
    expect(ear).toBeDefined();
    if (ear?.type === "earPose") expect(ear.pose).toBe("perked");
  });

  it("no perked ears when curiosity <= 0.6", () => {
    const motor = planMotor(intent, character(), world({ agent: { state: "thinking", connected: true } }), { type: "observe", durationMs: 1500 });
    const ear = motor.actions.find((a) => a.type === "earPose");
    expect(ear).toBeUndefined();
  });
});

describe("planMotor — respond", () => {
  const char = character();

  it("excited → cheer + happy + wag", () => {
    const intent = baseIntent("respond-user", 0.8);
    const motor = planMotor(intent, char, world(), { type: "respond", intensity: "excited" });
    const types = motor.actions.map((a) => a.type);
    expect(types).toContain("gesture");
    expect(types).toContain("expression");
    expect(types).toContain("tailMotion");
    expect(motor.durationMs).toBe(2200);
  });

  it("normal → point gesture + lookAt pointer", () => {
    const intent = baseIntent("respond-user", 0.7);
    const motor = planMotor(intent, char, world(), { type: "respond", intensity: "normal" });
    const types = motor.actions.map((a) => a.type);
    expect(types).toContain("gesture");
    expect(types).toContain("lookAt");
    expect(motor.durationMs).toBe(1900);
  });

  it("soft → wave gesture", () => {
    const intent = baseIntent("respond-user", 0.6);
    const motor = planMotor(intent, char, world(), { type: "respond", intensity: "soft" });
    const gesture = motor.actions.find((a) => a.type === "gesture");
    if (gesture?.type === "gesture") expect(gesture.gesture).toBe("wave");
    expect(motor.durationMs).toBe(1700);
  });

  it("adds back ears when annoyance > 0.3", () => {
    const annoyed = character({ emotion: { ...emptyCharacterState(0).emotion, annoyance: 0.5 } });
    const intent = baseIntent("respond-user", 0.7);
    const motor = planMotor(intent, annoyed, world(), { type: "respond", intensity: "normal" });
    const ear = motor.actions.find((a) => a.type === "earPose");
    expect(ear).toBeDefined();
    if (ear?.type === "earPose") expect(ear.pose).toBe("back");
  });

  it("avoids (recoil) when avoidance > threshold and pointer on head/face", () => {
    const upset = character({ emotion: { ...emptyCharacterState(0).emotion, annoyance: 0.9, fear: 0.7 } });
    const w = world({ pointer: { targetRegion: "face" } as WorldState["pointer"] });
    const intent = synthesizeBrainIntent(plan("respond-user", 0.8), upset, w);
    expect(intent.motorTendency.avoidance).toBeGreaterThan(AVOIDANCE_OVERRIDE);
    const motor = planMotor(intent, upset, w, { type: "respond", intensity: "normal" });
    const types = motor.actions.map((a) => a.type);
    expect(types).toContain("recoil");
    expect(types).toContain("lookAway");
    expect(motor.durationMs).toBe(2200);
  });

  it("does NOT avoid when pointer is on body (not head/face)", () => {
    const upset = character({ emotion: { ...emptyCharacterState(0).emotion, annoyance: 0.9, fear: 0.7 } });
    const w = world({ pointer: { targetRegion: "body" } as WorldState["pointer"] });
    const intent = synthesizeBrainIntent(plan("respond-user", 0.8), upset, w);
    const motor = planMotor(intent, upset, w, { type: "respond", intensity: "normal" });
    const types = motor.actions.map((a) => a.type);
    expect(types).not.toContain("recoil");
  });
});

describe("planMotor — celebrate", () => {
  const intent = baseIntent("celebrate", 0.9);
  const char = character();

  it("excited → cheer + happy + wag (full)", () => {
    const motor = planMotor(intent, char, world(), { type: "celebrate", intensity: "excited" });
    const types = motor.actions.map((a) => a.type);
    expect(types).toContain("gesture");
    expect(types).toContain("expression");
    expect(types).toContain("tailMotion");
    expect(motor.durationMs).toBe(2800);
  });

  it("normal → cheer + happy (no tail)", () => {
    const motor = planMotor(intent, char, world(), { type: "celebrate", intensity: "normal" });
    const types = motor.actions.map((a) => a.type);
    expect(types).toContain("gesture");
    expect(types).toContain("expression");
    expect(types).not.toContain("tailMotion");
    expect(motor.durationMs).toBe(2200);
  });
});

/* ------------------------------------------------------------------ */
/*  MotorSource tagging                                                */
/* ------------------------------------------------------------------ */

describe("motor source tagging", () => {
  it("tags every planMotor output with source: rule", () => {
    const cases: PetSemanticAction[] = [
      { type: "idle" },
      { type: "wander" },
      { type: "dock" },
      { type: "wait", durationMs: 500 },
      { type: "rest", durationMs: 5000 },
      { type: "observe", durationMs: 2000 },
      { type: "respond", intensity: "excited" },
      { type: "respond", intensity: "normal" },
      { type: "respond", intensity: "soft" },
      { type: "celebrate", intensity: "excited" },
      { type: "celebrate", intensity: "normal" },
    ];
    for (const action of cases) {
      const plan = planMotor(baseIntent(), character(), world(), action);
      expect(plan.source, `planMotor(${action.type}) should carry source`).toBe("rule");
    }
  });
});
