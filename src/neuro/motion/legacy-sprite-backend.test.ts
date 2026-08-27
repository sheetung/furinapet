import { describe, expect, it } from "vitest";
import { reactionForMotorPlan } from "./legacy-sprite-backend";
import type { MotorPlan } from "../contracts";

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function mp(...actions: MotorPlan["actions"]): MotorPlan {
  return { actions, durationMs: 2000, confidence: 0.7 };
}

/* ------------------------------------------------------------------ */
/*  Priority scan order: recoil > gesture > expression > idleStyle > turn > lookAt
/* ------------------------------------------------------------------ */

describe("reactionForMotorPlan — priority scan", () => {
  it("recoil always wins → failed", () => {
    const plan = mp(
      { type: "recoil", from: "pointer", strength: 0.6 },
      { type: "gesture", gesture: "cheer", weight: 1 },
    );
    const result = reactionForMotorPlan(plan);
    expect(result).not.toBeNull();
    expect(result!.reaction).toBe("failed");
    expect(result!.durationMs).toBe(2200);
  });

  it("returns null for empty actions", () => {
    expect(reactionForMotorPlan(mp())).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  gesture mappings                                                   */
/* ------------------------------------------------------------------ */

describe("gesture → reaction", () => {
  it("cheer (weight >= 0.95) → jumping 2800", () => {
    const result = reactionForMotorPlan(mp({ type: "gesture", gesture: "cheer", weight: 1 }));
    expect(result).toEqual({ reaction: "jumping", durationMs: 2800 });
  });

  it("cheer (weight < 0.95) → jumping 2200", () => {
    const result = reactionForMotorPlan(mp({ type: "gesture", gesture: "cheer", weight: 0.8 }));
    expect(result).toEqual({ reaction: "jumping", durationMs: 2200 });
  });

  it("wave → waving 1700", () => {
    const result = reactionForMotorPlan(mp({ type: "gesture", gesture: "wave", weight: 0.6 }));
    expect(result).toEqual({ reaction: "waving", durationMs: 1700 });
  });

  it("deny → failed (fallback)", () => {
    const result = reactionForMotorPlan(mp({ type: "gesture", gesture: "deny", weight: 0.5 }));
    expect(result).toEqual({ reaction: "failed", durationMs: 2600 });
  });

  it("deny with custom fallback", () => {
    const result = reactionForMotorPlan(mp({ type: "gesture", gesture: "deny", weight: 0.5 }), 3000);
    expect(result).toEqual({ reaction: "failed", durationMs: 3000 });
  });

  it("point → review 1900", () => {
    const result = reactionForMotorPlan(mp({ type: "gesture", gesture: "point", weight: 0.55 }));
    expect(result).toEqual({ reaction: "review", durationMs: 1900 });
  });
});

/* ------------------------------------------------------------------ */
/*  expression mappings                                                */
/* ------------------------------------------------------------------ */

describe("expression → reaction", () => {
  it("happy → jumping 2200", () => {
    const result = reactionForMotorPlan(mp({ type: "expression", expression: "happy", intensity: 0.8 }));
    expect(result).toEqual({ reaction: "jumping", durationMs: 2200 });
  });

  it("sad → failed (fallback)", () => {
    const result = reactionForMotorPlan(mp({ type: "expression", expression: "sad", intensity: 0.7 }));
    expect(result).toEqual({ reaction: "failed", durationMs: 2600 });
  });

  it("tired → waiting (fallback)", () => {
    const result = reactionForMotorPlan(mp({ type: "expression", expression: "tired", intensity: 0.5 }));
    expect(result).toEqual({ reaction: "waiting", durationMs: 2600 });
  });

  it("surprised → jumping 2200", () => {
    const result = reactionForMotorPlan(mp({ type: "expression", expression: "surprised", intensity: 0.6 }));
    expect(result).toEqual({ reaction: "jumping", durationMs: 2200 });
  });

  it("annoyed → failed (fallback)", () => {
    const result = reactionForMotorPlan(mp({ type: "expression", expression: "annoyed", intensity: 0.5 }));
    expect(result).toEqual({ reaction: "failed", durationMs: 2600 });
  });

  it("neutral → falls through to next primitive", () => {
    const plan = mp(
      { type: "expression", expression: "neutral", intensity: 0.5 },
      { type: "idleStyle", style: "normal", weight: 0.6 },
    );
    const result = reactionForMotorPlan(plan);
    expect(result).toEqual({ reaction: "idle", durationMs: 2600 });
  });
});

/* ------------------------------------------------------------------ */
/*  idleStyle mappings                                                 */
/* ------------------------------------------------------------------ */

describe("idleStyle → reaction", () => {
  it("sleepy → waiting", () => {
    const result = reactionForMotorPlan(mp({ type: "idleStyle", style: "sleepy", weight: 0.8 }));
    expect(result).toEqual({ reaction: "waiting", durationMs: 2600 });
  });

  it("alert → waiting", () => {
    const result = reactionForMotorPlan(mp({ type: "idleStyle", style: "alert", weight: 0.5 }));
    expect(result).toEqual({ reaction: "waiting", durationMs: 2600 });
  });

  it("sulk → failed", () => {
    const result = reactionForMotorPlan(mp({ type: "idleStyle", style: "sulk", weight: 0.6 }));
    expect(result).toEqual({ reaction: "failed", durationMs: 2600 });
  });

  it("normal → idle", () => {
    const result = reactionForMotorPlan(mp({ type: "idleStyle", style: "normal", weight: 0.6 }));
    expect(result).toEqual({ reaction: "idle", durationMs: 2600 });
  });
});

/* ------------------------------------------------------------------ */
/*  turn / lookAt fallbacks                                            */
/* ------------------------------------------------------------------ */

describe("turn / lookAt → reaction", () => {
  it("turn → running", () => {
    const result = reactionForMotorPlan(mp({ type: "turn", direction: "right", weight: 0.4 }));
    expect(result).toEqual({ reaction: "running", durationMs: 2600 });
  });

  it("lookAt → review", () => {
    const result = reactionForMotorPlan(mp({ type: "lookAt", target: "agent", weight: 0.6 }));
    expect(result).toEqual({ reaction: "review", durationMs: 2600 });
  });
});

/* ------------------------------------------------------------------ */
/*  Full pipeline plans from rule-cerebellum                           */
/* ------------------------------------------------------------------ */

describe("end-to-end plans (from rule-cerebellum output shape)", () => {
  it("rest plan → waiting", () => {
    const plan = mp(
      { type: "idleStyle", style: "sleepy", weight: 0.8 },
      { type: "expression", expression: "tired", intensity: 0.5 },
    );
    const result = reactionForMotorPlan(plan, 4000);
    // idleStyle sleepy wins over expression tired (scan order)
    expect(result).toEqual({ reaction: "waiting", durationMs: 4000 });
  });

  it("observe-error plan → failed", () => {
    const plan = mp({ type: "expression", expression: "sad", intensity: 0.7 });
    const result = reactionForMotorPlan(plan, 1500);
    expect(result).toEqual({ reaction: "failed", durationMs: 1500 });
  });

  it("celebrate-excited plan → jumping 2800", () => {
    const plan = mp(
      { type: "gesture", gesture: "cheer", weight: 1 },
      { type: "expression", expression: "happy", intensity: 1 },
      { type: "tailMotion", motion: "wag", weight: 1 },
    );
    const result = reactionForMotorPlan(plan, 2800);
    expect(result).toEqual({ reaction: "jumping", durationMs: 2800 });
  });
});
