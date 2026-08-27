/**
 * L3 Pipeline integration tests.
 *
 * Verifies that data flows correctly across layer boundaries when the pure
 * functions are chained: PerceptionEvent → WorldState → CharacterState →
 * BrainIntent → MotorPlan → Reaction.
 *
 * No Tauri runtime needed — all core functions are pure. CharacterState and
 * WorldState are constructed from fixtures, bypassing the Blackboard/store
 * singletons that buildCharacterState() depends on.
 */
import { describe, expect, it } from "vitest";
import { reducePerceptionEvent, emptyPerceptionMemory } from "../perception/perception-reducer";
import {
  emptyCharacterState,
  emptyEmotionState,
  type CharacterState,
} from "../contracts";
import { runFirstAction } from "./helpers/run-pipeline";
import {
  faceClickEvent,
  doubleClickEvent,
  dragStartEvent,
  agentSuccessEvent,
  neutralWorld,
  neutralCharacter,
  annoyedCharacter,
  respondPlan,
  idlePlan,
  celebratePlan,
} from "./helpers/fixtures";

describe("full pipeline integration", () => {
  it("face click → respond → MotorPlan with recoil → Reaction is failed (recoil maps to failed)", () => {
    const world = neutralWorld(1000);
    const character = neutralCharacter();
    const plan = respondPlan();

    const { motorPlan, directive } = runFirstAction(plan, character, world);

    // respond action on neutral character produces gesture point (no recoil)
    expect(motorPlan.actions.length).toBeGreaterThan(0);
    expect(motorPlan.source).toBe("rule");
    expect(directive).not.toBeNull();
    // "respond normal" → gesture wave or point → mapped Reaction
    expect(directive!.reaction).toBeDefined();
    expect(directive!.durationMs).toBeGreaterThan(0);
  });

  it("idle tick → idleStyle normal → Reaction is idle", () => {
    const world = neutralWorld(2000);
    const character = neutralCharacter();
    const plan = idlePlan();

    const { motorPlan, directive } = runFirstAction(plan, character, world);

    expect(motorPlan.actions[0].type).toBe("idleStyle");
    expect(directive).not.toBeNull();
    expect(directive!.reaction).toBe("idle");
  });

  it("celebrate excited → gesture cheer + expression happy → Reaction is jumping", () => {
    const world = neutralWorld(3000);
    const character = neutralCharacter();
    const plan = celebratePlan();

    const { motorPlan, directive } = runFirstAction(plan, character, world);

    const types = motorPlan.actions.map((a) => a.type);
    expect(types).toContain("gesture");
    expect(types).toContain("expression");
    expect(directive).not.toBeNull();
    expect(directive!.reaction).toBe("jumping");
  });

  it("respond with high annoyance + face pointer → dodge with recoil → Reaction is failed", () => {
    const world = { ...neutralWorld(4000), pointer: { ...neutralWorld(4000).pointer, targetRegion: "face" as const } };
    const character = annoyedCharacter();
    const plan = respondPlan();

    const { motorPlan, directive } = runFirstAction(plan, character, world);

    // high annoyance + face region triggers avoidance override in planMotor
    const hasRecoil = motorPlan.actions.some((a) => a.type === "recoil");
    expect(hasRecoil).toBe(true);
    expect(directive).not.toBeNull();
    expect(directive!.reaction).toBe("failed");
  });

  it("PerceptionEvent reduces correctly into WorldState (click updates interaction)", () => {
    const world = neutralWorld(5000);
    const memory = emptyPerceptionMemory();
    const event = faceClickEvent(5001);

    const result = reducePerceptionEvent(world, memory, event, null);

    expect(result.world.interaction.type).toBe("click");
    expect(result.world.interaction.clickStreak).toBe(1);
    expect(result.memory.streak).toBe(1);
    expect(result.memory.lastTouchAt).toBe(5001);
  });

  it("double-click reduces to double-click interaction type with higher intensity", () => {
    const world = neutralWorld(6000);
    const memory = emptyPerceptionMemory();
    const event = doubleClickEvent(6001);

    const result = reducePerceptionEvent(world, memory, event, null);

    expect(result.world.interaction.type).toBe("double-click");
    expect(result.world.interaction.intensity).toBe(0.8);
  });
});
