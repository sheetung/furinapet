/**
 * Character adapter: PetBlackboard + CharacterStore → CharacterState (L3).
 *
 * The Blackboard stays authoritative for planner inputs (mood, energy,
 * clickStreak). This adapter layers the neuro emotion model on top for the
 * cerebellum and the debug UI; the derived mood is display-only and never
 * fed back into the planner in this milestone.
 */

import type {
  AttentionState,
  CharacterState,
  EmotionState,
} from "../contracts";
import type { PetBlackboard, PetMood } from "../../pet-brain";
import { getWorldState } from "../perception/store";
import { getCharacterStore } from "./character-store";

const RECENT_INTERACTION_MS = 5000;

export interface NeuroCharacterSnapshot {
  emotion: EmotionState;
  energy: number;
  arousal: number;
  attention: AttentionState;
  derivedMood: PetMood;
}

function deriveAttention(blackboard: PetBlackboard, now: number): AttentionState {
  const world = getWorldState();
  const lastInteraction = getCharacterStore().getLastInteractionAt();
  if (lastInteraction !== null && now - lastInteraction <= RECENT_INTERACTION_MS) {
    return { target: "pointer", strength: clamp(0.4 + world.interaction.intensity * 0.5) };
  }
  if (world.agent.state !== "idle" && world.agent.connected) {
    return { target: "agent", strength: 0.6 };
  }
  if (world.agent.connected) {
    return { target: "agent", strength: 0.3 };
  }
  return { target: "none", strength: 0 };
}

/** Display/analysis mood derived from the neuro emotion model. */
export function deriveMood(emotion: EmotionState, energy: number, agentActive: boolean): PetMood {
  if (energy < 0.28) return "tired";
  if (agentActive) return "focused";
  if (emotion.happiness >= 0.62 || emotion.annoyance >= 0.7) return "happy";
  return "normal";
}

const clamp = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

export function buildCharacterState(blackboard: PetBlackboard, now: number): CharacterState {
  const store = getCharacterStore();
  const world = getWorldState();
  return {
    emotion: store.getEmotion(),
    energy: blackboard.getEnergy(),
    arousal: store.getArousal(),
    attention: deriveAttention(blackboard, now),
    currentGoal: blackboard.snapshot(now).currentGoal,
    currentMotorState: [],
  };
}

export function characterSnapshot(blackboard: PetBlackboard, now: number): NeuroCharacterSnapshot {
  const store = getCharacterStore();
  const world = getWorldState();
  const emotion = store.getEmotion();
  const energy = blackboard.getEnergy();
  return {
    emotion,
    energy,
    arousal: store.getArousal(),
    attention: deriveAttention(blackboard, now),
    derivedMood: deriveMood(emotion, energy, world.agent.state !== "idle" && world.agent.connected),
  };
}
