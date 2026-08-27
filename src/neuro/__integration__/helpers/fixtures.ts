/**
 * Test fixtures for neuro integration tests.
 *
 * Pre-built WorldState, CharacterState, PerceptionEvent, and PetActionPlan
 * objects. These are plain value constructors — no singletons, no side effects.
 */

import {
  emptyWorldState,
  emptyEmotionState,
  emptyCharacterState,
  type WorldState,
  type CharacterState,
  type PerceptionEvent,
} from "../../contracts";
import type { PetActionPlan, PetSemanticAction, PetGoalId } from "../../../pet-brain/types";

/* ------------------------------------------------------------------ */
/*  WorldState fixtures                                                */
/* ------------------------------------------------------------------ */

/** Neutral world: no interaction, idle agent, no pointer activity. */
export function neutralWorld(at = 0): WorldState {
  return emptyWorldState(at);
}

/** World with a face-click interaction already registered. */
export function worldAfterFaceClick(at: number, streak = 1): WorldState {
  const base = emptyWorldState(at);
  return {
    ...base,
    interaction: { type: "click", clickStreak: streak, intensity: 0.35 + (streak - 1) * 0.12 },
    pointer: { ...base.pointer, targetRegion: "face" },
  };
}

/* ------------------------------------------------------------------ */
/*  CharacterState fixtures                                            */
/* ------------------------------------------------------------------ */

/** Neutral character: baseline emotions, 78% energy, low arousal. */
export function neutralCharacter(): CharacterState {
  return emptyCharacterState();
}

/** Annoyed character: high annoyance, moderate fear. */
export function annoyedCharacter(): CharacterState {
  const base = emptyCharacterState();
  return {
    ...base,
    emotion: { ...emptyEmotionState(), annoyance: 0.8, fear: 0.3 },
  };
}

/** Fearful character: high fear, low energy. */
export function fearfulCharacter(): CharacterState {
  const base = emptyCharacterState();
  return {
    ...base,
    emotion: { ...emptyEmotionState(), fear: 0.9, annoyance: 0.2 },
    energy: 0.3,
  };
}

/* ------------------------------------------------------------------ */
/*  PerceptionEvent fixtures                                           */
/* ------------------------------------------------------------------ */

export function faceClickEvent(at: number, streak = 0): PerceptionEvent {
  return { type: "touch", at, sense: "pet:clicked", region: "face", streak, intensity: 0.35 };
}

export function bodyClickEvent(at: number, streak = 0): PerceptionEvent {
  return { type: "touch", at, sense: "pet:clicked", region: "body", streak, intensity: 0.35 };
}

export function doubleClickEvent(at: number): PerceptionEvent {
  return { type: "touch", at, sense: "pet:doubleClicked", region: "face", streak: 0, intensity: 0.8 };
}

export function dragStartEvent(at: number): PerceptionEvent {
  return { type: "drag", at, phase: "start" };
}

export function agentSuccessEvent(at: number): PerceptionEvent {
  return { type: "agentState", at, state: "success", connected: true, clientName: "test" };
}

/* ------------------------------------------------------------------ */
/*  PetActionPlan fixtures                                             */
/* ------------------------------------------------------------------ */

function basePlan(goal: PetGoalId, score: number, actions: PetSemanticAction[]): PetActionPlan {
  return {
    id: `test-${goal}-${score}`,
    goal,
    score,
    reason: "test fixture",
    createdAt: 0,
    actions,
    candidates: [{ goal, score, reason: "test" }],
  };
}

export function respondPlan(score = 1): PetActionPlan {
  return basePlan("respond-user", score, [{ type: "respond", intensity: "normal" }]);
}

export function idlePlan(): PetActionPlan {
  return basePlan("idle", 0.8, [{ type: "idle", durationMs: 1200 }]);
}

export function celebratePlan(score = 1): PetActionPlan {
  return basePlan("celebrate", score, [{ type: "celebrate", intensity: "excited" }]);
}

export function restPlan(durationMs = 3000): PetActionPlan {
  return basePlan("rest", 0.6, [{ type: "rest", durationMs }]);
}
