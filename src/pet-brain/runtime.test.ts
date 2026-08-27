/**
 * Regression tests for the tap-region handoff into the reflex arc.
 *
 * Bug: tap senses used to drop the click position, so buildReflexEvent fell
 * back to the 125 ms sampler's targetRegion — stale by the time the delayed
 * tap dispatch fires (360 ms double-tap window). Region-dependent reflexes
 * (blink on face/head) never triggered, so every tap rendered identically.
 */
import { describe, expect, it } from "vitest";
import { emptyWorldState } from "../neuro/contracts";
import { buildReflexEvent } from "./runtime";
import type { PetSenseEventDetail } from "./types";

const sense = (
  name: PetSenseEventDetail["name"],
  region?: PetSenseEventDetail["region"],
): PetSenseEventDetail => ({
  name,
  at: 1234,
  handledByPlugin: false,
  ...(region !== undefined ? { region } : {}),
});

describe("buildReflexEvent tap region", () => {
  it("prefers the region resolved from the real click position", () => {
    const world = emptyWorldState(0);
    world.pointer.targetRegion = "none"; // sampler already stale at dispatch time
    const event = buildReflexEvent(sense("pet:clicked", "face"), world);
    expect(event).toMatchObject({ type: "touch", sense: "pet:clicked", region: "face" });
  });

  it("falls back to the sampled pointer region when the sense carries none", () => {
    const world = emptyWorldState(0);
    world.pointer.targetRegion = "head";
    const event = buildReflexEvent(sense("pet:clicked"), world);
    expect(event).toMatchObject({ type: "touch", region: "head" });
  });

  it("double-click senses keep the resolved region for the startle reflex", () => {
    const world = emptyWorldState(0);
    world.pointer.targetRegion = "body";
    const event = buildReflexEvent(sense("pet:doubleClicked", "hand"), world);
    expect(event).toMatchObject({ type: "touch", sense: "pet:doubleClicked", region: "hand" });
  });

  it("maps drag senses to drag perception events", () => {
    const world = emptyWorldState(0);
    expect(buildReflexEvent(sense("pet:dragStart"), world)).toMatchObject({ type: "drag", phase: "start" });
    expect(buildReflexEvent(sense("pet:dragEnd"), world)).toMatchObject({ type: "drag", phase: "end" });
  });
});
