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
import type { PetSenseEventDetail } from "../../pet-brain/types";
import { getWorldStateStore, senseToPerceptionEvent } from "./store";

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

describe("sense → perception mapping (tap-region handoff)", () => {
  it("carries the tapped body region through to the touch perception event", () => {
    const detail: PetSenseEventDetail = {
      name: "pet:clicked",
      at: 100,
      handledByPlugin: false,
      region: "face",
    };
    expect(senseToPerceptionEvent(detail)).toMatchObject({
      type: "touch",
      sense: "pet:clicked",
      at: 100,
      region: "face",
    });
  });

  it("defaults the touch region to none when the sense carries none", () => {
    const detail: PetSenseEventDetail = { name: "pet:doubleClicked", at: 200, handledByPlugin: false };
    expect(senseToPerceptionEvent(detail)).toMatchObject({
      type: "touch",
      sense: "pet:doubleClicked",
      region: "none",
    });
  });

  it("maps drag senses to drag phases", () => {
    expect(senseToPerceptionEvent({ name: "pet:dragStart", at: 1, handledByPlugin: false })).toEqual({
      type: "drag",
      at: 1,
      phase: "start",
    });
    expect(senseToPerceptionEvent({ name: "pet:dragEnd", at: 2, handledByPlugin: false })).toEqual({
      type: "drag",
      at: 2,
      phase: "end",
    });
  });
});

describe("perception event log (LMC inspector)", () => {
  it("logs touch and drag events immediately, newest first", () => {
    const world = getWorldStateStore();
    world.dispatch({ type: "touch", at: 5000, sense: "pet:clicked", region: "face", streak: 2, intensity: 0.4 });
    world.dispatch({ type: "drag", at: 5100, phase: "start" });
    const log = world.getLog();
    expect(log[0]).toMatchObject({ type: "drag", at: 5100, detail: "start" });
    expect(log[1]).toMatchObject({ type: "touch", at: 5000, region: "face", detail: "clicked · streak 2" });
  });

  it("throttles pointer samples to at most one line per second", () => {
    const world = getWorldStateStore();
    // Use large timestamps so the assertion is independent of the pointer
    // samples dispatched by earlier tests (shared singleton store).
    const before = world.getLog().length;
    world.dispatch(pointer(100000, 1100, 1100));
    world.dispatch(pointer(100400, 1200, 1200));
    world.dispatch(pointer(100800, 1300, 1300));
    expect(world.getLog().length).toBe(before + 1);
    world.dispatch(pointer(101001, 1400, 1400));
    expect(world.getLog().length).toBe(before + 2);
  });

  it("caps the log at 30 entries", () => {
    const world = getWorldStateStore();
    for (let index = 0; index < 40; index += 1) {
      world.dispatch({ type: "touch", at: 20000 + index, sense: "pet:clicked", region: "body", streak: index, intensity: 0 });
    }
    expect(world.getLog().length).toBe(30);
    expect(world.getLog()[0]).toMatchObject({ at: 20039 });
  });
});
