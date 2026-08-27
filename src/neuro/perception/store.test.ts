/**
 * Integration-level tests for the WorldStateStore dispatch boundary.
 *
 * Guards the arousal calibration bug: the 125 ms sampler dispatches pointer
 * events ~8×/s. Stationary samples must still reduce WorldState (velocity,
 * region tracking) but must not be forwarded to the character store —
 * otherwise arousal accumulates far faster than it can decay and pins at 1.0.
 */
import { describe, expect, it } from "vitest";
import { getCharacterStore } from "../character/character-store";
import type { PerceptionEvent } from "../contracts";
import { getWorldStateStore } from "./store";

const pointer = (at: number, x: number, y: number, region: "body" | "face" = "body"): PerceptionEvent => ({
  type: "pointer",
  at,
  x,
  y,
  region,
});

describe("world state store dispatch", () => {
  it("forwards moving pointer samples to the character store", () => {
    const world = getWorldStateStore();
    const character = getCharacterStore();
    const before = character.getArousal();
    world.dispatch(pointer(1000, 500, 500));
    expect(character.getArousal()).toBeCloseTo(before + 0.01);
  });

  it("does not stimulate the character for stationary samples (regression: arousal pinning)", () => {
    const world = getWorldStateStore();
    const character = getCharacterStore();
    world.dispatch(pointer(2000, 700, 700));
    const afterMove = character.getArousal();
    // An unmoving cursor at 8 Hz for ~12.5 s: arousal must not move at all.
    for (let index = 1; index <= 100; index += 1) {
      world.dispatch(pointer(2000 + index * 125, 700, 700));
    }
    expect(character.getArousal()).toBeCloseTo(afterMove);
  });

  it("still refreshes WorldState for stationary samples", () => {
    const world = getWorldStateStore();
    world.dispatch(pointer(3000, 900, 900, "face"));
    world.dispatch(pointer(3125, 900, 900, "face"));
    const snapshot = world.snapshot();
    expect(snapshot.pointer.x).toBe(900);
    expect(snapshot.pointer.targetRegion).toBe("face");
    expect(snapshot.pointer.speed).toBe(0);
    expect(snapshot.timestamp).toBe(3125);
  });
});
