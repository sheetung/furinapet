import { describe, expect, it } from "vitest";
import { evaluateReflex } from "./reflex";
import type { PerceptionEvent } from "../contracts";

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

const touch = (overrides: Partial<Extract<PerceptionEvent, { type: "touch" }>> = {}): PerceptionEvent => ({
  type: "touch",
  at: 1000,
  sense: "pet:clicked",
  region: "body",
  streak: 1,
  intensity: 0.35,
  ...overrides,
});

const drag = (phase: "start" | "end"): PerceptionEvent => ({
  type: "drag", at: 1000, phase,
});

/* ------------------------------------------------------------------ */
/*  blink reflex                                                       */
/* ------------------------------------------------------------------ */

describe("blink reflex", () => {
  it("fires on face click → surprised + small recoil", () => {
    const result = evaluateReflex(touch({ sense: "pet:clicked", region: "face" }));
    expect(result).not.toBeNull();
    expect(result!.name).toBe("blink");
    const types = result!.plan.actions.map((a) => a.type);
    expect(types).toContain("expression");
    expect(types).toContain("recoil");
    expect(types).toContain("earPose");
    expect(result!.plan.durationMs).toBe(380);
  });

  it("fires on head click but weaker (no earPose)", () => {
    const result = evaluateReflex(touch({ sense: "pet:clicked", region: "head" }));
    expect(result).not.toBeNull();
    expect(result!.name).toBe("blink");
    const types = result!.plan.actions.map((a) => a.type);
    expect(types).toContain("expression");
    expect(types).toContain("recoil");
    expect(types).not.toContain("earPose");
  });

  it("does NOT fire on body click", () => {
    const result = evaluateReflex(touch({ region: "body" }));
    expect(result).toBeNull();
  });

  it("does NOT fire on hand click", () => {
    const result = evaluateReflex(touch({ region: "hand" }));
    expect(result).toBeNull();
  });

  it("face recoil is stronger than head recoil", () => {
    const face = evaluateReflex(touch({ region: "face" }));
    const head = evaluateReflex(touch({ region: "head" }));
    const faceRecoil = face!.plan.actions.find((a) => a.type === "recoil");
    const headRecoil = head!.plan.actions.find((a) => a.type === "recoil");
    if (faceRecoil?.type === "recoil" && headRecoil?.type === "recoil") {
      expect(faceRecoil.strength).toBeGreaterThan(headRecoil.strength);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  startle reflex                                                     */
/* ------------------------------------------------------------------ */

describe("startle reflex", () => {
  it("fires on double-click → recoil + lookAway + earPose", () => {
    const result = evaluateReflex(touch({ sense: "pet:doubleClicked", region: "body" }));
    expect(result).not.toBeNull();
    expect(result!.name).toBe("startle");
    const types = result!.plan.actions.map((a) => a.type);
    expect(types).toContain("recoil");
    expect(types).toContain("lookAway");
    expect(types).toContain("earPose");
    expect(result!.plan.durationMs).toBe(550);
  });

  it("fires regardless of body region", () => {
    for (const region of ["face", "head", "body", "hand"] as const) {
      const result = evaluateReflex(touch({ sense: "pet:doubleClicked", region }));
      expect(result).not.toBeNull();
      expect(result!.name).toBe("startle");
    }
  });

  it("startle overrides blink on face double-click", () => {
    const result = evaluateReflex(touch({ sense: "pet:doubleClicked", region: "face" }));
    expect(result!.name).toBe("startle");
  });
});

/* ------------------------------------------------------------------ */
/*  flinch reflex (repeated poking)                                    */
/* ------------------------------------------------------------------ */

describe("flinch reflex", () => {
  it("fires when streak >= 6", () => {
    const result = evaluateReflex(touch({ streak: 6 }));
    expect(result).not.toBeNull();
    expect(result!.name).toBe("flinch");
    const types = result!.plan.actions.map((a) => a.type);
    expect(types).toContain("recoil");
    expect(types).toContain("earPose");
    expect(types).toContain("expression");
  });

  it("does NOT fire at streak 5", () => {
    const result = evaluateReflex(touch({ streak: 5, region: "face" }));
    // At streak 5 on face, blink fires instead
    expect(result).not.toBeNull();
    expect(result!.name).toBe("blink");
  });

  it("severity scales with streak", () => {
    const mild = evaluateReflex(touch({ streak: 6 }));
    const severe = evaluateReflex(touch({ streak: 12 }));
    const mildRecoil = mild!.plan.actions.find((a) => a.type === "recoil");
    const severeRecoil = severe!.plan.actions.find((a) => a.type === "recoil");
    if (mildRecoil?.type === "recoil" && severeRecoil?.type === "recoil") {
      expect(severeRecoil.strength).toBeGreaterThan(mildRecoil.strength);
    }
  });

  it("flinch overrides blink on face with high streak", () => {
    const result = evaluateReflex(touch({ streak: 8, region: "face" }));
    expect(result!.name).toBe("flinch");
  });
});

/* ------------------------------------------------------------------ */
/*  grip reflex                                                        */
/* ------------------------------------------------------------------ */

describe("grip reflex", () => {
  it("fires on drag start → lean back + surprised", () => {
    const result = evaluateReflex(drag("start"));
    expect(result).not.toBeNull();
    expect(result!.name).toBe("grip");
    const types = result!.plan.actions.map((a) => a.type);
    expect(types).toContain("lean");
    expect(types).toContain("expression");
    expect(result!.plan.durationMs).toBe(450);
  });

  it("does NOT fire on drag end", () => {
    const result = evaluateReflex(drag("end"));
    expect(result).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  No reflex for non-salient events                                   */
/* ------------------------------------------------------------------ */

describe("no reflex", () => {
  it("returns null for pointer events", () => {
    const event: PerceptionEvent = { type: "pointer", at: 1000, x: 100, y: 200, region: "face" };
    expect(evaluateReflex(event)).toBeNull();
  });

  it("returns null for agentState events", () => {
    const event: PerceptionEvent = { type: "agentState", at: 1000, state: "thinking", connected: true };
    expect(evaluateReflex(event)).toBeNull();
  });

  it("returns null for userIdle events", () => {
    const event: PerceptionEvent = { type: "userIdle", at: 1000, idleMs: 30000 };
    expect(evaluateReflex(event)).toBeNull();
  });

  it("returns null for body/hand single click", () => {
    expect(evaluateReflex(touch({ region: "body" }))).toBeNull();
    expect(evaluateReflex(touch({ region: "hand" }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Priority ordering                                                  */
/* ------------------------------------------------------------------ */

describe("priority", () => {
  it("startle > flinch > blink for face touch with high streak + doubleClick", () => {
    // doubleClick on face with high streak → startle wins
    const result = evaluateReflex(touch({ sense: "pet:doubleClicked", region: "face", streak: 10 }));
    expect(result!.name).toBe("startle");
  });

  it("flinch > blink for face touch with high streak + singleClick", () => {
    const result = evaluateReflex(touch({ sense: "pet:clicked", region: "face", streak: 8 }));
    expect(result!.name).toBe("flinch");
  });
});

/* ------------------------------------------------------------------ */
/*  MotorSource tagging                                                */
/* ------------------------------------------------------------------ */

describe("motor source tagging", () => {
  it("tags every reflex plan with source: reflex", () => {
    const cases: PerceptionEvent[] = [
      touch({ sense: "pet:clicked", region: "face" }),      // blink
      touch({ sense: "pet:doubleClicked", region: "body" }), // startle
      touch({ sense: "pet:clicked", region: "face", streak: 8 }), // flinch
      drag("start"),                                        // grip
    ];
    for (const event of cases) {
      const result = evaluateReflex(event);
      expect(result, `reflex should fire for ${JSON.stringify(event)}`).not.toBeNull();
      expect(result!.plan.source).toBe("reflex");
    }
  });
});
