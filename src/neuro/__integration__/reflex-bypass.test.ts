/**
 * L2 Reflex bypass integration tests.
 *
 * Verifies that reflex rules produce valid MotorPlans and that the reflex
 * arc correctly bypasses the brain pipeline. Each reflex rule is tested
 * end-to-end: PerceptionEvent → evaluateReflex → MotorPlan → reactionForMotorPlan.
 */
import { describe, expect, it } from "vitest";
import { evaluateReflex } from "../reflex/reflex";
import { reactionForMotorPlan } from "../motion/legacy-sprite-backend";
import type { PerceptionEvent } from "../contracts";

describe("reflex bypass integration", () => {
  it("face click → blink fires → MotorPlan has expression + recoil, source=reflex", () => {
    const event: PerceptionEvent = {
      type: "touch",
      at: 1000,
      sense: "pet:clicked",
      region: "face",
      streak: 1,
      intensity: 0.5,
    };

    const reflex = evaluateReflex(event);
    expect(reflex).not.toBeNull();
    expect(reflex!.name).toBe("blink");
    expect(reflex!.plan.source).toBe("reflex");
    expect(reflex!.plan.confidence).toBe(1);

    const types = reflex!.plan.actions.map((a) => a.type);
    expect(types).toContain("expression");
    expect(types).toContain("recoil");

    // blink plan should map to a Reaction
    const directive = reactionForMotorPlan(reflex!.plan, reflex!.plan.durationMs);
    expect(directive).not.toBeNull();
    expect(directive!.durationMs).toBeGreaterThan(0);
  });

  it("double-click → startle fires → MotorPlan has recoil + lookAway + earPose", () => {
    const event: PerceptionEvent = {
      type: "touch",
      at: 2000,
      sense: "pet:doubleClicked",
      region: "face",
      streak: 0,
      intensity: 0.8,
    };

    const reflex = evaluateReflex(event);
    expect(reflex).not.toBeNull();
    expect(reflex!.name).toBe("startle");
    expect(reflex!.plan.source).toBe("reflex");

    const types = reflex!.plan.actions.map((a) => a.type);
    expect(types).toContain("recoil");
    expect(types).toContain("lookAway");
    expect(types).toContain("earPose");

    const directive = reactionForMotorPlan(reflex!.plan, reflex!.plan.durationMs);
    expect(directive).not.toBeNull();
  });

  it("drag start → grip fires → MotorPlan has lean + expression", () => {
    const event: PerceptionEvent = {
      type: "drag",
      at: 3000,
      phase: "start",
    };

    const reflex = evaluateReflex(event);
    expect(reflex).not.toBeNull();
    expect(reflex!.name).toBe("grip");
    expect(reflex!.plan.source).toBe("reflex");

    const types = reflex!.plan.actions.map((a) => a.type);
    expect(types).toContain("lean");
    expect(types).toContain("expression");
  });

  it("click streak >= 6 → flinch fires → severity-scaled recoil + annoyed", () => {
    const event: PerceptionEvent = {
      type: "touch",
      at: 4000,
      sense: "pet:clicked",
      region: "body",
      streak: 12,
      intensity: 0.5,
    };

    const reflex = evaluateReflex(event);
    expect(reflex).not.toBeNull();
    expect(reflex!.name).toBe("flinch");
    expect(reflex!.plan.source).toBe("reflex");

    const types = reflex!.plan.actions.map((a) => a.type);
    expect(types).toContain("recoil");
    expect(types).toContain("earPose");
    expect(types).toContain("expression");

    // Severity scales with streak above threshold (6): severity = min(1, 0.4 + (12-6)*0.08) = 0.88
    const recoil = reflex!.plan.actions.find((a) => a.type === "recoil");
    expect(recoil).toBeDefined();
    if (recoil && recoil.type === "recoil") {
      expect(recoil.strength).toBeGreaterThan(0.4);
    }
  });

  it("body click (low streak) → no reflex → falls through to brain pipeline", () => {
    const event: PerceptionEvent = {
      type: "touch",
      at: 5000,
      sense: "pet:clicked",
      region: "body",
      streak: 1,
      intensity: 0.35,
    };

    const reflex = evaluateReflex(event);
    expect(reflex).toBeNull();
  });

  it("all reflex MotorPlans have source='reflex' (MotorSource contract)", () => {
    const events: PerceptionEvent[] = [
      { type: "touch", at: 6000, sense: "pet:clicked", region: "face", streak: 1, intensity: 0.5 },
      { type: "touch", at: 7000, sense: "pet:doubleClicked", region: "body", streak: 0, intensity: 0.8 },
      { type: "drag", at: 8000, phase: "start" },
      { type: "touch", at: 9000, sense: "pet:clicked", region: "body", streak: 8, intensity: 0.5 },
    ];

    for (const event of events) {
      const reflex = evaluateReflex(event);
      if (reflex) {
        expect(reflex.plan.source).toBe("reflex");
        expect(reflex.plan.confidence).toBe(1);
      }
    }
  });
});
