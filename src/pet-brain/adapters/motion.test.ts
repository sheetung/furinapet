import { describe, expect, it } from "vitest";
import type { PetSemanticAction } from "../types";
import { motionIntentForReaction, motionIntentForSemanticAction } from "./motion";
import { reactionForSemanticAction } from "./reaction";

const ACTIONS: PetSemanticAction[] = [
  { type: "idle", durationMs: 1200 },
  { type: "wander" },
  { type: "dock" },
  { type: "observe", durationMs: 2000 },
  { type: "respond", intensity: "soft" },
  { type: "respond", intensity: "normal" },
  { type: "respond", intensity: "excited" },
  { type: "celebrate", intensity: "normal" },
  { type: "celebrate", intensity: "excited" },
  { type: "rest", durationMs: 4000 },
  { type: "wait", durationMs: 500 },
];

describe("motionIntentForSemanticAction", () => {
  it("covers every semantic action the brain can emit", () => {
    for (const action of ACTIONS) {
      expect(() => motionIntentForSemanticAction(action, "idle")).not.toThrow();
    }
  });

  it("agrees with the sprite adapter on which actions produce no visible change", () => {
    // Both renderers should ignore the same actions, or the 3D pet would react to a
    // plan the 2D pet treats as a no-op. `wander` is the deliberate exception: the
    // sprite backend has no walk pose to hold, while a skeleton can swing its arms.
    for (const action of ACTIONS) {
      if (action.type === "wander") continue;
      const sprite = reactionForSemanticAction(action, "idle");
      const motion = motionIntentForSemanticAction(action, "idle");
      expect(motion === null).toBe(sprite === null);
    }
  });

  it("reads the agent state when observing", () => {
    const action: PetSemanticAction = { type: "observe", durationMs: 2000 };
    expect(motionIntentForSemanticAction(action, "error")!.kind).toBe("slump");
    expect(motionIntentForSemanticAction(action, "editing")!.kind).toBe("observe");
    expect(motionIntentForSemanticAction(action, "waiting")!.intensity)
      .toBeLessThan(motionIntentForSemanticAction(action, "editing")!.intensity);
  });

  it("scales celebration intensity", () => {
    const normal = motionIntentForSemanticAction({ type: "celebrate", intensity: "normal" }, "success")!;
    const excited = motionIntentForSemanticAction({ type: "celebrate", intensity: "excited" }, "success")!;
    expect(excited.intensity).toBeGreaterThan(normal.intensity);
    expect(excited.durationMs).toBeGreaterThan(normal.durationMs);
  });

  it("hands out a fresh id every time so the cerebellum restarts the routine", () => {
    const first = motionIntentForSemanticAction({ type: "idle" }, "idle")!;
    const second = motionIntentForSemanticAction({ type: "idle" }, "idle")!;
    expect(second.id).toBeGreaterThan(first.id);
  });
});

describe("motionIntentForReaction", () => {
  it("maps every sprite reaction, including the locomotion-only rows", () => {
    const reactions = [
      "idle", "waving", "jumping", "failed", "waiting", "running", "review", "run-left", "run-right",
    ] as const;
    for (const reaction of reactions) {
      const intent = motionIntentForReaction(reaction);
      expect(intent.intensity).toBeGreaterThanOrEqual(0);
      expect(intent.intensity).toBeLessThanOrEqual(1);
    }
  });

  it("treats both run directions as locomotion", () => {
    expect(motionIntentForReaction("run-left").kind).toBe("locomote");
    expect(motionIntentForReaction("run-right").kind).toBe("locomote");
  });
});
