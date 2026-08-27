import { describe, expect, it } from "vitest";
import {
  applyEmotionDelta,
  clampEmotion,
  clampMotorTendency,
  clampWeight,
  emptyCharacterState,
  emptyEmotionState,
  emptyMotorPlan,
  emptyWorldState,
  isPerceptionEvent,
  NEUTRAL_MOTOR_TENDENCY,
  normalizeBrainIntent,
  planActionWeight,
  SOURCE_CONFIDENCE_CAP,
} from "./index";
import { bodyRegionAt, type MotorPrimitive } from "./motor-plan";

describe("world state contract", () => {
  it("starts with a neutral world", () => {
    const state = emptyWorldState(1000);
    expect(state.interaction.clickStreak).toBe(0);
    expect(state.pointer.distanceToCharacter).toBe(1);
    expect(state.agent.state).toBe("idle");
  });
});

describe("character state contract", () => {
  it("clamps emotions into 0..1", () => {
    const clamped = clampEmotion({ ...emptyEmotionState(), annoyance: 1.7, fear: -0.3 });
    expect(clamped.annoyance).toBe(1);
    expect(clamped.fear).toBe(0);
  });

  it("applies deltas additively then clamps", () => {
    const base = emptyEmotionState();
    const next = applyEmotionDelta(base, { annoyance: 0.11, curiosity: -0.08 });
    expect(next.annoyance).toBeCloseTo(base.annoyance + 0.11);
    expect(next.curiosity).toBeCloseTo(base.curiosity - 0.08);
  });

  it("ignores non-finite deltas", () => {
    const base = emptyEmotionState();
    const next = applyEmotionDelta(base, { happiness: Number.NaN });
    expect(next.happiness).toBe(base.happiness);
  });

  it("creates a full character state", () => {
    const state = emptyCharacterState();
    expect(Object.keys(state.emotion)).toHaveLength(7);
    expect(state.attention.target).toBe("none");
  });
});

describe("brain intent contract", () => {
  it("normalizes out-of-range tendency and confidence", () => {
    const intent = normalizeBrainIntent({
      goal: "respond-user",
      attention: { target: "pointer", strength: 1.4 },
      motorTendency: { ...NEUTRAL_MOTOR_TENDENCY, avoidance: 2, approach: -1 },
      confidence: 9,
    });
    expect(intent.attention?.strength).toBe(1);
    expect(intent.motorTendency.avoidance).toBe(1);
    expect(intent.motorTendency.approach).toBe(0);
    expect(intent.confidence).toBe(1);
  });

  it("falls back to 0.5 confidence for non-finite input", () => {
    const intent = normalizeBrainIntent({
      goal: "idle",
      motorTendency: clampMotorTendency(NEUTRAL_MOTOR_TENDENCY),
      confidence: Number.POSITIVE_INFINITY,
    });
    expect(intent.confidence).toBe(0.5);
  });

  it("preserves valid socialIntent", () => {
    const intent = normalizeBrainIntent({
      goal: "celebrate",
      motorTendency: { ...NEUTRAL_MOTOR_TENDENCY },
      confidence: 0.8,
      socialIntent: "brag",
    });
    expect(intent.socialIntent).toBe("brag");
  });

  it("rejects invalid socialIntent", () => {
    const intent = normalizeBrainIntent({
      goal: "idle",
      motorTendency: { ...NEUTRAL_MOTOR_TENDENCY },
      confidence: 0.5,
      socialIntent: "attack" as any,
    });
    expect(intent.socialIntent).toBeUndefined();
  });

  it("preserves valid source", () => {
    const intent = normalizeBrainIntent({
      goal: "observe-agent",
      motorTendency: { ...NEUTRAL_MOTOR_TENDENCY },
      confidence: 0.7,
      source: "ai",
    });
    expect(intent.source).toBe("ai");
  });

  it("rejects invalid source", () => {
    const intent = normalizeBrainIntent({
      goal: "idle",
      motorTendency: { ...NEUTRAL_MOTOR_TENDENCY },
      confidence: 0.5,
      source: "unknown" as any,
    });
    expect(intent.source).toBeUndefined();
  });

  it("keys SOURCE_CONFIDENCE_CAP by the arbitration BrainIntentSource set", () => {
    // Mirrors pet-brain/types.ts BrainIntentSource — the real arbitration axis.
    expect(Object.keys(SOURCE_CONFIDENCE_CAP).sort()).toEqual(
      ["agent", "ai", "plugin", "system", "user"],
    );
  });

  it("matches the Rust source_cap table in brain_commands.rs", () => {
    // src-tauri/src/brain_commands.rs:
    //   user|system => 1.0, agent|plugin => 0.95, ai => 0.82
    expect(SOURCE_CONFIDENCE_CAP.user).toBe(1);
    expect(SOURCE_CONFIDENCE_CAP.system).toBe(1);
    expect(SOURCE_CONFIDENCE_CAP.agent).toBe(0.95);
    expect(SOURCE_CONFIDENCE_CAP.plugin).toBe(0.95);
    expect(SOURCE_CONFIDENCE_CAP.ai).toBe(0.82);
  });
});

describe("motor plan contract", () => {
  it("sums weights per action type", () => {
    const actions: MotorPrimitive[] = [
      { type: "lookAt", target: "pointer", weight: 0.35 },
      { type: "recoil", from: "pointer", strength: 0.64 },
      { type: "recoil", from: "pointer", strength: 0.2 },
    ];
    const plan = { ...emptyMotorPlan(), actions };
    expect(planActionWeight(plan, "recoil")).toBeCloseTo(0.84);
    expect(planActionWeight(plan, "lookAt")).toBeCloseTo(0.35);
    expect(planActionWeight(plan, "gesture")).toBe(0);
  });

  it("clamps primitive weights", () => {
    expect(clampWeight(1.5)).toBe(1);
    expect(clampWeight(-0.2)).toBe(0);
    expect(clampWeight(Number.NaN)).toBe(0);
  });

  it("maps normalized pointer height to body regions", () => {
    expect(bodyRegionAt(0.1)).toBe("face");
    expect(bodyRegionAt(0.4)).toBe("head");
    expect(bodyRegionAt(0.7)).toBe("body");
    expect(bodyRegionAt(0.95)).toBe("hand");
  });

  it("accepts optional source field", () => {
    const plan = {
      ...emptyMotorPlan(),
      actions: [{ type: "lookAt" as const, target: "pointer" as const, weight: 0.5 }],
      source: "reflex" as const,
    };
    expect(plan.source).toBe("reflex");
  });
});

describe("perception event contract", () => {
  it("validates known event shapes", () => {
    expect(isPerceptionEvent({ type: "drag", at: 1, phase: "start" })).toBe(true);
    expect(isPerceptionEvent({ type: "somethingElse" })).toBe(false);
    expect(isPerceptionEvent(null)).toBe(false);
  });
});
