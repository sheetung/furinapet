/**
 * L1 Contract consistency tests (full JSON Schema validation).
 *
 * Uses ajv to validate TS-constructed objects against the JSON Schema mirror
 * (neuro-v1.schema.json). Catches drift between TypeScript types and the
 * schema that external systems (Python training pipeline, brain servers) rely on.
 *
 * Complements schema-consistency.test.ts (which checks enum alignment without
 * ajv) by running full structural validation on every contract level.
 */
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import {
  emptyWorldState,
  emptyCharacterState,
  emptyEmotionState,
  emptyMotorPlan,
  normalizeBrainIntent,
  NEUTRAL_MOTOR_TENDENCY,
  type PerceptionEvent,
  type WorldState,
  type CharacterState,
  type NeuroBrainIntent,
  type MotorPlan,
  type MotorPrimitive,
  type BodyRegion,
  type MotorSource,
  EMOTION_KEYS,
  MOTOR_SOURCES,
  SOCIAL_INTENTS,
} from "../contracts";
import { reducePerceptionEvent, emptyPerceptionMemory } from "../perception/perception-reducer";
import { applyEmotionDelta } from "../contracts";
import schemaJson from "../schemas/neuro-v1.schema.json";

/* ------------------------------------------------------------------ */
/*  Ajv setup                                                          */
/* ------------------------------------------------------------------ */

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(schemaJson, "neuro");

function validateDef(name: string, data: unknown): { valid: boolean; errors: string } {
  const valid = ajv.validate({ $ref: `neuro#/$defs/${name}` }, data);
  const errors = valid ? "" : ajv.errorsText(ajv.errors, { dataVar: name });
  return { valid, errors };
}

/* ------------------------------------------------------------------ */
/*  L1 PerceptionEvent                                                 */
/* ------------------------------------------------------------------ */

describe("contract consistency: L1 PerceptionEvent", () => {
  it("emptyWorldState() validates against worldState schema", () => {
    const { valid, errors } = validateDef("worldState", emptyWorldState(0));
    expect(valid, errors).toBe(true);
  });

  it("all six PerceptionEvent variants validate against schema", () => {
    const events: PerceptionEvent[] = [
      { type: "pointer", at: 1, x: 100, y: 200, region: "face" },
      { type: "pointerApproach", at: 2, motion: "approaching", region: "body" },
      { type: "touch", at: 3, sense: "pet:clicked", region: "head", streak: 1, intensity: 0.35 },
      { type: "drag", at: 4, phase: "start" },
      { type: "agentState", at: 5, state: "thinking", connected: true },
      { type: "userIdle", at: 6, idleMs: 5000 },
    ];
    for (const event of events) {
      const { valid, errors } = validateDef("perceptionEvent", event);
      expect(valid, `${event.type}: ${errors}`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  L2 WorldState                                                      */
/* ------------------------------------------------------------------ */

describe("contract consistency: L2 WorldState", () => {
  it("reducePerceptionEvent output validates against worldState schema", () => {
    const result = reducePerceptionEvent(
      emptyWorldState(0),
      emptyPerceptionMemory(),
      { type: "touch", at: 100, sense: "pet:clicked", region: "face", streak: 1, intensity: 0.35 },
      null,
    );
    const { valid, errors } = validateDef("worldState", result.world);
    expect(valid, errors).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  L3 CharacterState                                                  */
/* ------------------------------------------------------------------ */

describe("contract consistency: L3 CharacterState", () => {
  it("emptyCharacterState() validates against characterState schema", () => {
    const { valid, errors } = validateDef("characterState", emptyCharacterState());
    expect(valid, errors).toBe(true);
  });

  it("applyEmotionDelta result validates", () => {
    const base = emptyEmotionState();
    const next = applyEmotionDelta(base, { happiness: 0.1, annoyance: 0.05 });
    const character: CharacterState = {
      ...emptyCharacterState(),
      emotion: next,
    };
    const { valid, errors } = validateDef("characterState", character);
    expect(valid, errors).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  L4 BrainIntent                                                     */
/* ------------------------------------------------------------------ */

describe("contract consistency: L4 BrainIntent", () => {
  it("normalizeBrainIntent output validates against brainIntent schema", () => {
    const intent = normalizeBrainIntent({
      goal: "respond-user",
      confidence: 0.85,
      motorTendency: NEUTRAL_MOTOR_TENDENCY,
    });
    const { valid, errors } = validateDef("brainIntent", intent);
    expect(valid, errors).toBe(true);
  });

  it("all PetGoalId values are valid in schema", () => {
    const goals = ["idle", "wander", "dock", "respond-user", "observe-agent", "celebrate", "rest"] as const;
    for (const goal of goals) {
      const intent = normalizeBrainIntent({ goal, confidence: 0.5, motorTendency: NEUTRAL_MOTOR_TENDENCY });
      const { valid, errors } = validateDef("brainIntent", intent);
      expect(valid, `${goal}: ${errors}`).toBe(true);
    }
  });

  it("all SocialIntent values validate when present", () => {
    for (const social of SOCIAL_INTENTS) {
      const intent = normalizeBrainIntent({
        goal: "idle",
        confidence: 0.5,
        motorTendency: NEUTRAL_MOTOR_TENDENCY,
        socialIntent: social,
      });
      const { valid, errors } = validateDef("brainIntent", intent);
      expect(valid, `${social}: ${errors}`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  L5 MotorPlan                                                       */
/* ------------------------------------------------------------------ */

describe("contract consistency: L5 MotorPlan", () => {
  it("emptyMotorPlan() validates against motorPlan schema", () => {
    const { valid, errors } = validateDef("motorPlan", emptyMotorPlan());
    expect(valid, errors).toBe(true);
  });

  it("all MotorSource values are valid in schema", () => {
    for (const source of MOTOR_SOURCES) {
      const plan: MotorPlan = { actions: [], durationMs: 0, confidence: 0, source };
      const { valid, errors } = validateDef("motorPlan", plan);
      expect(valid, `${source}: ${errors}`).toBe(true);
    }
  });

  it("representative MotorPrimitive types validate", () => {
    const primitives: MotorPrimitive[] = [
      { type: "lookAt", target: "pointer", weight: 0.5 },
      { type: "lookAway", target: "pointer", weight: 0.3 },
      { type: "recoil", from: "pointer", strength: 0.45 },
      { type: "lean", direction: "back", weight: 0.35 },
      { type: "turn", direction: "right", weight: 0.4 },
      { type: "earPose", pose: "back", weight: 0.5 },
      { type: "tailMotion", motion: "wag", weight: 0.7 },
      { type: "expression", expression: "happy", intensity: 0.8 },
      { type: "gesture", gesture: "cheer", weight: 0.9 },
      { type: "idleStyle", style: "sleepy", weight: 0.6 },
    ];
    for (const primitive of primitives) {
      const plan: MotorPlan = { actions: [primitive], durationMs: 1000, confidence: 1, source: "rule" };
      const { valid, errors } = validateDef("motorPlan", plan);
      expect(valid, `${primitive.type}: ${errors}`).toBe(true);
    }
  });

  it("schema required fields match TS required fields for motorPlan", () => {
    const schemaDef = (schemaJson as Record<string, unknown>).$defs as Record<string, { required?: string[] }>;
    const required = schemaDef.motorPlan?.required ?? [];
    expect(required).toContain("actions");
    expect(required).toContain("durationMs");
    expect(required).toContain("confidence");
    // source is optional in both TS and schema
    expect(required).not.toContain("source");
  });
});
