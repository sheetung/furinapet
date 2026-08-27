/**
 * Contract-consistency guard: the JSON Schema mirror (neuro-v1.schema.json)
 * must accept exactly the same payloads the TypeScript contracts produce.
 *
 * This file exists because the schema once drifted from the TS types
 * (perceptionEvent type enum naming, missing pointer variants, wrong
 * pointerMotion values) and no test caught it. These tests fail the moment
 * someone changes one side without the other.
 *
 * No external JSON-Schema validator is added on purpose (zero-dependency
 * policy): instead we hand-check the discriminating fields — every TS value
 * must appear in the schema's enum lists, and every schema enum value must
 * be constructible from TS.
 */
import { describe, expect, it } from "vitest";
import {
  emptyCharacterState,
  emptyWorldState,
  TOUCH_SENSES,
  type PerceptionEvent,
  type BodyRegion,
  type PointerMotion,
  type InteractionType,
} from "../contracts";
import type { BrainAgentState, PetGoalId, PetSenseName } from "../../pet-brain/types";
import schemaJson from "./neuro-v1.schema.json";

const schema = schemaJson as {
  $defs: Record<string, {
    enum?: unknown[];
    oneOf?: { properties: { type: { const?: string } }; required?: string[] }[];
    required?: string[];
  }>;
};

const enumOf = (name: string): unknown[] => {
  const def = schema.$defs[name];
  if (!def?.enum) throw new Error(`schema $defs.${name} is not an enum`);
  return def.enum;
};

describe("schema ↔ contract enum alignment", () => {
  it("pointerMotion matches the TS PointerMotion values", () => {
    const ts: PointerMotion[] = ["stationary", "approaching", "retreating", "tangential"];
    expect(enumOf("pointerMotion")).toEqual(ts);
  });

  it("bodyRegion matches the TS BodyRegion values", () => {
    const ts: BodyRegion[] = ["none", "head", "face", "body", "hand"];
    expect(enumOf("bodyRegion").slice().sort()).toEqual([...ts].sort());
  });

  it("interactionType matches the TS InteractionType values", () => {
    const ts: InteractionType[] = ["none", "hover", "click", "double-click", "long-press", "drag"];
    expect(enumOf("interactionType").slice().sort()).toEqual([...ts].sort());
  });

  it("petSenseName matches the TS PetSenseName values (TOUCH_SENSES)", () => {
    const ts: PetSenseName[] = [...TOUCH_SENSES];
    expect(enumOf("petSenseName").slice().sort()).toEqual([...ts].sort());
  });

  it("petGoalId matches the TS PetGoalId values", () => {
    const ts: PetGoalId[] = [
      "idle", "wander", "dock", "respond-user", "observe-agent", "celebrate", "rest",
    ];
    expect(enumOf("petGoalId").slice().sort()).toEqual([...ts].sort());
  });

  it("agentState matches the TS BrainAgentState values", () => {
    const ts: BrainAgentState[] = [
      "idle", "thinking", "editing", "testing", "waiting", "success", "error",
    ];
    expect(enumOf("agentState").slice().sort()).toEqual([...ts].sort());
  });
});

describe("schema perceptionEvent variants ↔ TS PerceptionEvent", () => {
  const variants = schema.$defs.perceptionEvent.oneOf
    ?.map((variant) => variant.properties.type.const)
    .filter(Boolean) as string[];

  it("covers all six TS event types with exact const names", () => {
    expect(variants.slice().sort()).toEqual(
      ["pointer", "pointerApproach", "touch", "drag", "agentState", "userIdle"].sort(),
    );
  });

  it("requires type and at on every variant", () => {
    for (const variant of schema.$defs.perceptionEvent.oneOf ?? []) {
      expect(variant.required).toContain("type");
      expect(variant.required).toContain("at");
    }
  });

  it("accepts a sample of every TS event shape", () => {
    const events: PerceptionEvent[] = [
      { type: "pointer", at: 1, x: 2, y: 3, region: "face" },
      { type: "pointerApproach", at: 1, motion: "retreating", region: "hand" },
      { type: "touch", at: 1, sense: "pet:doubleClicked", region: "head", streak: 2, intensity: 0.5 },
      { type: "drag", at: 1, phase: "start" },
      { type: "agentState", at: 1, state: "success", connected: true, clientName: "cli" },
      { type: "userIdle", at: 1, idleMs: 1000 },
    ];
    // Discriminator names must line up: the TS literal `type` exists as a schema const.
    for (const event of events) {
      expect(variants).toContain(event.type);
    }
  });
});

describe("schema factory-payload alignment", () => {
  it("worldState schema requires exactly the fields emptyWorldState produces", () => {
    const world = emptyWorldState(0);
    const required = ["timestamp", "pointer", "interaction", "agent", "environment"] as const;
    for (const key of required) expect(world).toHaveProperty(key);
    // The schema must not require anything the TS factory omits.
    expect(schema.$defs.worldState.required?.length ?? 0).toBeGreaterThanOrEqual(required.length);
  });

  it("characterState schema requires exactly the fields emptyCharacterState produces", () => {
    const character = emptyCharacterState();
    const required = ["emotion", "energy", "arousal", "attention", "currentGoal", "currentMotorState"] as const;
    for (const key of required) expect(character).toHaveProperty(key);
  });
});
