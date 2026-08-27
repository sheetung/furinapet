import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForAction } from "./Executor";

// waitForAction uses window.setTimeout; stub the global for the node test env.
vi.stubGlobal("window", { setTimeout, clearTimeout });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("waitForAction", () => {
  it("resolves after the duration when no signal is given (regression: reflex path)", async () => {
    // The reflex fast path used to pass `undefined as unknown as AbortSignal`,
    // which threw a TypeError on `signal.aborted` and skipped the snapshot
    // publish afterwards. A missing signal must mean "run to completion".
    const start = Date.now();
    await waitForAction(30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });

  it("resolves after the duration with an explicit undefined signal", async () => {
    const start = Date.now();
    await waitForAction(30, undefined);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });

  it("resolves after the duration with a live signal", async () => {
    const start = Date.now();
    await waitForAction(30, new AbortController().signal);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });

  it("resolves immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    await waitForAction(5000, controller.signal);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("resolves immediately for non-positive durations", async () => {
    await expect(waitForAction(0, new AbortController().signal)).resolves.toBeUndefined();
    await expect(waitForAction(-1, new AbortController().signal)).resolves.toBeUndefined();
  });

  it("resolves early when the signal aborts mid-wait", async () => {
    const controller = new AbortController();
    const start = Date.now();
    setTimeout(() => controller.abort(), 10);
    await waitForAction(5000, controller.signal);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
