/**
 * L1 Trace integrity tests.
 *
 * Verifies that recordNeuroTrace writes complete entries, the ring buffer
 * enforces the 50-entry cap, and timestamps are monotonically non-decreasing
 * in sequential execution.
 *
 * The trace is a module-level array (no reset function), so tests use large,
 * independent timestamps to avoid interference from earlier tests in the suite.
 */
import { describe, expect, it } from "vitest";
import { recordNeuroTrace, getNeuroTrace, TRACE_LIMIT } from "../trace/neuro-trace";
import type { NeuroTraceEntry } from "../trace/neuro-trace";
import type { MotorTendency } from "../contracts";

const NEUTRAL_TENDENCY: MotorTendency = { approach: 0, avoidance: 0, energy: 0, expressiveness: 0 };

function makeEntry(t: number, overrides: Partial<NeuroTraceEntry> = {}): NeuroTraceEntry {
  return {
    t,
    goal: "idle",
    confidence: 1,
    motorTendency: NEUTRAL_TENDENCY,
    primitives: ["idleStyle"],
    reaction: "idle",
    durationMs: 1200,
    source: "rule",
    ...overrides,
  };
}

describe("neuro trace integrity", () => {
  it("rule pipeline execution → trace entry has goal, confidence, primitives, reaction", () => {
    const entry = makeEntry(1_000_000, {
      goal: "respond-user",
      confidence: 0.9,
      primitives: ["gesture", "expression"],
      reaction: "jumping",
      durationMs: 2200,
      source: "rule",
    });
    recordNeuroTrace(entry);

    const trace = getNeuroTrace();
    const found = trace.find((e) => e.t === 1_000_000);
    expect(found).toBeDefined();
    expect(found!.goal).toBe("respond-user");
    expect(found!.confidence).toBe(0.9);
    expect(found!.primitives).toEqual(["gesture", "expression"]);
    expect(found!.reaction).toBe("jumping");
    expect(found!.source).toBe("rule");
  });

  it("reflex execution → trace entry has goal='idle', confidence=1, source='reflex'", () => {
    const entry = makeEntry(2_000_000, {
      goal: "idle",
      confidence: 1,
      primitives: ["expression", "recoil"],
      reaction: "jumping",
      source: "reflex",
      reflex: "blink",
      region: "face",
    });
    recordNeuroTrace(entry);

    const trace = getNeuroTrace();
    const found = trace.find((e) => e.t === 2_000_000);
    expect(found).toBeDefined();
    expect(found!.goal).toBe("idle");
    expect(found!.confidence).toBe(1);
    expect(found!.source).toBe("reflex");
    expect(found!.reflex).toBe("blink");
    expect(found!.region).toBe("face");
  });

  it("trace entry timestamp is monotonically non-decreasing in sequential recording", () => {
    const timestamps = [3_000_000, 3_000_100, 3_000_200, 3_000_300, 3_000_400];
    for (const t of timestamps) {
      recordNeuroTrace(makeEntry(t));
    }

    const trace = getNeuroTrace();
    const relevant = trace.filter((e) => e.t >= 3_000_000 && e.t <= 3_000_400);
    // Trace is newest-first, so timestamps in the returned array are descending
    for (let i = 1; i < relevant.length; i++) {
      expect(relevant[i].t).toBeLessThanOrEqual(relevant[i - 1].t);
    }
    expect(relevant.length).toBe(timestamps.length);
  });

  it("ring buffer caps at TRACE_LIMIT entries (newest first, oldest dropped)", () => {
    // Record enough entries to overflow the buffer
    const overflowCount = TRACE_LIMIT + 10;
    const baseT = 4_000_000;
    for (let i = 0; i < overflowCount; i++) {
      recordNeuroTrace(makeEntry(baseT + i, { goal: "rest" }));
    }

    const trace = getNeuroTrace();
    expect(trace.length).toBe(TRACE_LIMIT);
    // Newest entry is first
    expect(trace[0].t).toBe(baseT + overflowCount - 1);
    // Oldest retained entry is the (overflowCount - TRACE_LIMIT)th one
    expect(trace[TRACE_LIMIT - 1].t).toBe(baseT + (overflowCount - TRACE_LIMIT));
  });

  it("every entry has required fields (goal, confidence, motorTendency, primitives, reaction, durationMs)", () => {
    recordNeuroTrace(makeEntry(5_000_000));
    const trace = getNeuroTrace();
    const entry = trace.find((e) => e.t === 5_000_000);
    expect(entry).toBeDefined();

    expect(entry!.goal).toBeDefined();
    expect(typeof entry!.confidence).toBe("number");
    expect(entry!.motorTendency).toBeDefined();
    expect(Array.isArray(entry!.primitives)).toBe(true);
    expect(typeof entry!.durationMs).toBe("number");
  });

  it("newest entry is always at index 0", () => {
    recordNeuroTrace(makeEntry(6_000_000, { goal: "wander" }));
    recordNeuroTrace(makeEntry(6_000_100, { goal: "celebrate" }));

    const trace = getNeuroTrace();
    expect(trace[0].t).toBe(6_000_100);
    expect(trace[0].goal).toBe("celebrate");
    expect(trace[1].t).toBe(6_000_000);
  });
});
