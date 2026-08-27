import { describe, expect, it } from "vitest";
import { emptyWorldState } from "../contracts";
import {
  CLICK_STREAK_WINDOW_MS,
  emptyPerceptionMemory,
  petCenter,
  reducePerceptionEvent,
  regionAtPointer,
  tickWorldState,
  type PetGeometry,
} from "./perception-reducer";

const GEOMETRY: PetGeometry = { x: 1000, y: 800, width: 192, height: 208 };
const CENTER = petCenter(GEOMETRY)!;

describe("pointer events", () => {
  it("computes velocity, speed and normalized distance", () => {
    let world = emptyWorldState(0);
    let memory = emptyPerceptionMemory();

    const first = reducePerceptionEvent(world, memory, {
      type: "pointer", at: 1000, x: CENTER.x + 200, y: CENTER.y, region: "none",
    }, GEOMETRY);
    world = first.world;
    memory = first.memory;
    expect(world.pointer.speed).toBe(0);
    expect(world.pointer.distanceToCharacter).toBeCloseTo(200 / 1200);

    const second = reducePerceptionEvent(world, memory, {
      type: "pointer", at: 1100, x: CENTER.x + 100, y: CENTER.y, region: "none",
    }, GEOMETRY);
    // 100px toward the pet in 0.1s → 1000 px/s, approaching.
    expect(second.world.pointer.speed).toBeCloseTo(1000);
    expect(second.world.pointer.motion).toBe("approaching");
  });

  it("classifies retreating and stationary motion", () => {
    let world = emptyWorldState(0);
    let memory = emptyPerceptionMemory();
    const at = (t: number, x: number) =>
      reducePerceptionEvent(world, memory, { type: "pointer", at: t, x, y: CENTER.y, region: "none" }, GEOMETRY);

    let step = at(1000, CENTER.x + 100);
    world = step.world;
    memory = step.memory;

    step = at(1100, CENTER.x + 200);
    world = step.world;
    memory = step.memory;
    expect(step.world.pointer.motion).toBe("retreating");

    step = at(1200, CENTER.x + 202);
    expect(step.world.pointer.motion).toBe("stationary");
  });

  it("maps pointer position onto body regions", () => {
    expect(regionAtPointer({ x: CENTER.x, y: GEOMETRY.y + 10 }, GEOMETRY)).toBe("face");
    expect(regionAtPointer({ x: CENTER.x, y: GEOMETRY.y + 100 }, GEOMETRY)).toBe("head");
    expect(regionAtPointer({ x: CENTER.x, y: GEOMETRY.y + 170 }, GEOMETRY)).toBe("body");
    expect(regionAtPointer({ x: CENTER.x + 500, y: GEOMETRY.y + 100 }, GEOMETRY)).toBe("none");
  });
});

describe("touch streaks", () => {
  it("accumulates clicks inside the streak window and computes intensity", () => {
    let world = emptyWorldState(0);
    let memory = emptyPerceptionMemory();

    for (let index = 1; index <= 3; index += 1) {
      const step = reducePerceptionEvent(world, memory, {
        type: "touch", at: 1000 + index * 300, sense: "pet:clicked", region: "none", streak: 0, intensity: 0,
      }, GEOMETRY);
      world = step.world;
      memory = step.memory;
      expect(world.interaction.clickStreak).toBe(index);
      expect(world.interaction.type).toBe("click");
    }
    expect(world.interaction.intensity).toBeCloseTo(0.35 + 2 * 0.12);
  });

  it("resets the streak after the window passes", () => {
    let world = emptyWorldState(0);
    let memory = emptyPerceptionMemory();

    const first = reducePerceptionEvent(world, memory, {
      type: "touch", at: 1000, sense: "pet:clicked", region: "none", streak: 0, intensity: 0,
    }, GEOMETRY);
    const second = reducePerceptionEvent(first.world, first.memory, {
      type: "touch",
      at: 1000 + CLICK_STREAK_WINDOW_MS + 100,
      sense: "pet:clicked",
      region: "none",
      streak: 0,
      intensity: 0,
    }, GEOMETRY);
    expect(second.world.interaction.clickStreak).toBe(1);
  });

  it("marks double clicks distinctly", () => {
    const step = reducePerceptionEvent(emptyWorldState(0), emptyPerceptionMemory(), {
      type: "touch", at: 1000, sense: "pet:doubleClicked", region: "none", streak: 0, intensity: 0,
    }, GEOMETRY);
    expect(step.world.interaction.type).toBe("double-click");
    expect(step.world.interaction.intensity).toBeCloseTo(0.8);
  });
});

describe("drag lifecycle", () => {
  it("enters and leaves the drag interaction", () => {
    let world = emptyWorldState(0);
    let memory = emptyPerceptionMemory();

    const start = reducePerceptionEvent(world, memory, { type: "drag", at: 1000, phase: "start" }, GEOMETRY);
    expect(start.world.interaction.type).toBe("drag");
    expect(start.world.interaction.intensity).toBeCloseTo(0.6);

    const end = reducePerceptionEvent(start.world, start.memory, { type: "drag", at: 1500, phase: "end" }, GEOMETRY);
    expect(end.world.interaction.type).toBe("none");
    expect(end.memory.streak).toBe(0);
  });
});

describe("agent state and ticks", () => {
  it("records agent presence with client name", () => {
    const step = reducePerceptionEvent(emptyWorldState(0), emptyPerceptionMemory(), {
      type: "agentState", at: 1000, state: "thinking", connected: true, clientName: "claude-code",
    }, GEOMETRY);
    expect(step.world.agent.state).toBe("thinking");
    expect(step.world.agent.connected).toBe(true);
    expect(step.world.agent.clientName).toBe("claude-code");
  });

  it("decays interactions and tracks idle time on tick", () => {
    let world = emptyWorldState(0);
    let memory = emptyPerceptionMemory();
    const touched = reducePerceptionEvent(world, memory, {
      type: "touch", at: 1000, sense: "pet:clicked", region: "none", streak: 0, intensity: 0,
    }, GEOMETRY);
    world = touched.world;
    memory = touched.memory;

    const ticked = tickWorldState(world, memory, 1000 + CLICK_STREAK_WINDOW_MS + 1, {
      canMove: true,
      canDock: false,
    });
    expect(ticked.world.interaction.type).toBe("none");
    expect(ticked.world.environment.userIdleMs).toBe(CLICK_STREAK_WINDOW_MS + 1);
    expect(ticked.world.environment.canMove).toBe(true);

    const drag = reducePerceptionEvent(ticked.world, ticked.memory, { type: "drag", at: 5000, phase: "start" }, GEOMETRY);
    const tickedDrag = tickWorldState(drag.world, drag.memory, 20000, { canMove: false, canDock: false });
    expect(tickedDrag.world.interaction.type).toBe("drag");
  });
});
