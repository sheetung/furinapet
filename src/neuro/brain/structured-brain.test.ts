import { describe, expect, it } from "vitest";
import { validateAndNormalizeBrainIntent } from "./structured-brain";
import { NEUTRAL_MOTOR_TENDENCY } from "../contracts";

describe("validateAndNormalizeBrainIntent", () => {
  it("returns null for null input", () => {
    expect(validateAndNormalizeBrainIntent(null)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(validateAndNormalizeBrainIntent("hello")).toBeNull();
    expect(validateAndNormalizeBrainIntent(42)).toBeNull();
  });

  it("returns null when goal is missing", () => {
    expect(validateAndNormalizeBrainIntent({ confidence: 0.8 })).toBeNull();
  });

  it("returns null for an unsupported goal", () => {
    expect(validateAndNormalizeBrainIntent({ goal: "dance" })).toBeNull();
    expect(validateAndNormalizeBrainIntent({ goal: "" })).toBeNull();
  });

  it("accepts a minimal intent with only a valid goal", () => {
    const result = validateAndNormalizeBrainIntent({ goal: "idle" });
    expect(result).not.toBeNull();
    expect(result!.goal).toBe("idle");
    expect(result!.confidence).toBe(0.5); // default
    expect(result!.motorTendency).toEqual(NEUTRAL_MOTOR_TENDENCY);
    expect(result!.attention).toBeUndefined();
    expect(result!.emotionDelta).toBeUndefined();
  });

  it("accepts all seven valid goals", () => {
    for (const goal of ["idle", "wander", "dock", "respond-user", "observe-agent", "celebrate", "rest"]) {
      const result = validateAndNormalizeBrainIntent({ goal });
      expect(result).not.toBeNull();
      expect(result!.goal).toBe(goal);
    }
  });

  it("clamps confidence to 0..1", () => {
    expect(validateAndNormalizeBrainIntent({ goal: "idle", confidence: -0.5 })!.confidence).toBe(0);
    expect(validateAndNormalizeBrainIntent({ goal: "idle", confidence: 1.5 })!.confidence).toBe(1);
    expect(validateAndNormalizeBrainIntent({ goal: "idle", confidence: 0.72 })!.confidence).toBeCloseTo(0.72);
  });

  it("defaults confidence to 0.5 when not a number", () => {
    expect(validateAndNormalizeBrainIntent({ goal: "idle", confidence: "high" })!.confidence).toBe(0.5);
  });

  it("parses attention with valid target", () => {
    const result = validateAndNormalizeBrainIntent({
      goal: "observe-agent",
      attention: { target: "agent", strength: 0.8 },
    });
    expect(result!.attention).toEqual({ target: "agent", strength: 0.8 });
  });

  it("clamps attention strength to 0..1", () => {
    const result = validateAndNormalizeBrainIntent({
      goal: "idle",
      attention: { target: "pointer", strength: 2.0 },
    });
    expect(result!.attention!.strength).toBe(1);
  });

  it("falls back to target 'none' for invalid attention target", () => {
    const result = validateAndNormalizeBrainIntent({
      goal: "idle",
      attention: { target: "dragon", strength: 0.5 },
    });
    expect(result!.attention!.target).toBe("none");
  });

  it("accepts all five valid attention targets", () => {
    for (const target of ["none", "pointer", "user", "agent", "self"]) {
      const result = validateAndNormalizeBrainIntent({
        goal: "idle",
        attention: { target, strength: 0.5 },
      });
      expect(result!.attention!.target).toBe(target);
    }
  });

  it("parses motorTendency when provided", () => {
    const result = validateAndNormalizeBrainIntent({
      goal: "wander",
      motorTendency: { approach: 0.8, avoidance: 0.1, energy: 0.9, expressiveness: 0.3 },
    });
    expect(result!.motorTendency).toEqual({
      approach: 0.8,
      avoidance: 0.1,
      energy: 0.9,
      expressiveness: 0.3,
    });
  });

  it("clamps motorTendency values to 0..1", () => {
    const result = validateAndNormalizeBrainIntent({
      goal: "idle",
      motorTendency: { approach: -0.5, avoidance: 2, energy: 0.5, expressiveness: 0.5 },
    });
    expect(result!.motorTendency.approach).toBe(0);
    expect(result!.motorTendency.avoidance).toBe(1);
  });

  it("fills neutral defaults for missing motorTendency fields", () => {
    const result = validateAndNormalizeBrainIntent({
      goal: "idle",
      motorTendency: { approach: 0.9 },
    });
    expect(result!.motorTendency.approach).toBe(0.9);
    expect(result!.motorTendency.avoidance).toBe(NEUTRAL_MOTOR_TENDENCY.avoidance);
    expect(result!.motorTendency.energy).toBe(NEUTRAL_MOTOR_TENDENCY.energy);
    expect(result!.motorTendency.expressiveness).toBe(NEUTRAL_MOTOR_TENDENCY.expressiveness);
  });

  it("parses emotionDelta with valid keys", () => {
    const result = validateAndNormalizeBrainIntent({
      goal: "celebrate",
      emotionDelta: { happiness: 0.15, affection: 0.05 },
    });
    expect(result!.emotionDelta).toEqual({ happiness: 0.15, affection: 0.05 });
  });

  it("filters out non-numeric emotionDelta values", () => {
    const result = validateAndNormalizeBrainIntent({
      goal: "idle",
      emotionDelta: { happiness: "lots", fear: 0.1, boredom: undefined },
    });
    expect(result!.emotionDelta).toEqual({ fear: 0.1 });
  });

  it("ignores unknown keys in emotionDelta", () => {
    const result = validateAndNormalizeBrainIntent({
      goal: "idle",
      emotionDelta: { happiness: 0.1, excitement: 0.5 },
    });
    expect(result!.emotionDelta).toEqual({ happiness: 0.1 });
  });

  it("returns a fully normalized intent for a complex input", () => {
    const result = validateAndNormalizeBrainIntent({
      goal: "respond-user",
      attention: { target: "user", strength: 0.9 },
      emotionDelta: { happiness: 0.1, curiosity: 0.05 },
      motorTendency: { approach: 0.7, avoidance: 0, energy: 0.6, expressiveness: 0.8 },
      confidence: 0.85,
    });
    expect(result).not.toBeNull();
    expect(result!.goal).toBe("respond-user");
    expect(result!.attention).toEqual({ target: "user", strength: 0.9 });
    expect(result!.emotionDelta).toEqual({ happiness: 0.1, curiosity: 0.05 });
    expect(result!.motorTendency.approach).toBe(0.7);
    expect(result!.confidence).toBeCloseTo(0.85);
  });
});
