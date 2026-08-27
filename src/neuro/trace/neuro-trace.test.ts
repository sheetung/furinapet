import { describe, expect, it, beforeEach } from "vitest";
import { recordNeuroTrace, getNeuroTrace, TRACE_LIMIT, type NeuroTraceEntry } from "./neuro-trace";

function entry(overrides: Partial<NeuroTraceEntry> = {}): NeuroTraceEntry {
  return {
    t: Date.now(),
    goal: "idle",
    confidence: 0.5,
    motorTendency: { approach: 0.2, avoidance: 0.1, energy: 0.4, expressiveness: 0.5 },
    primitives: ["idleStyle"],
    reaction: "idle",
    durationMs: 1200,
    ...overrides,
  };
}

describe("neuro-trace ring buffer", () => {
  beforeEach(() => {
    // Drain the shared module-level buffer (cast away readonly for test cleanup)
    const buf = getNeuroTrace() as NeuroTraceEntry[];
    buf.length = 0;
  });

  it("starts empty after drain", () => {
    expect(getNeuroTrace()).toHaveLength(0);
  });

  it("records entries in reverse-chronological order (newest first)", () => {
    recordNeuroTrace(entry({ goal: "idle", t: 1000 }));
    recordNeuroTrace(entry({ goal: "respond-user", t: 2000 }));
    const trace = getNeuroTrace();
    expect(trace).toHaveLength(2);
    expect(trace[0].goal).toBe("respond-user");
    expect(trace[1].goal).toBe("idle");
  });

  it("caps at TRACE_LIMIT", () => {
    for (let i = 0; i < TRACE_LIMIT + 10; i++) {
      recordNeuroTrace(entry({ t: i }));
    }
    expect(getNeuroTrace()).toHaveLength(TRACE_LIMIT);
  });

  it("oldest entries are dropped when over limit", () => {
    for (let i = 0; i < TRACE_LIMIT + 5; i++) {
      recordNeuroTrace(entry({ t: i, goal: `goal-${i}` as NeuroTraceEntry["goal"] }));
    }
    const trace = getNeuroTrace();
    // Newest is t = TRACE_LIMIT + 4
    expect(trace[0].t).toBe(TRACE_LIMIT + 4);
    // Oldest surviving is t = 5
    expect(trace[TRACE_LIMIT - 1].t).toBe(5);
  });

  it("preserves all entry fields", () => {
    const e = entry({
      t: 42,
      goal: "celebrate",
      confidence: 0.92,
      motorTendency: { approach: 0.8, avoidance: 0.05, energy: 0.9, expressiveness: 0.95 },
      primitives: ["gesture", "expression", "tailMotion"],
      reaction: "jumping",
      durationMs: 2800,
    });
    recordNeuroTrace(e);
    const stored = getNeuroTrace()[0];
    expect(stored.t).toBe(42);
    expect(stored.goal).toBe("celebrate");
    expect(stored.confidence).toBeCloseTo(0.92);
    expect(stored.motorTendency.approach).toBeCloseTo(0.8);
    expect(stored.primitives).toEqual(["gesture", "expression", "tailMotion"]);
    expect(stored.reaction).toBe("jumping");
    expect(stored.durationMs).toBe(2800);
  });

  it("supports null reaction (e.g. wander/dock)", () => {
    recordNeuroTrace(entry({ reaction: null }));
    expect(getNeuroTrace()[0].reaction).toBeNull();
  });
});
