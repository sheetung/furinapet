import type { TargetRef } from "./common";

/** All channels are 0..1. */
export interface EmotionState {
  happiness: number;
  affection: number;
  curiosity: number;
  annoyance: number;
  fear: number;
  boredom: number;
  sleepiness: number;
}

/**
 * Fixed per character, never moved by events.
 *
 * This is where "who the character is" lives, as opposed to how they happen to feel.
 * The same perception with a patient personality and an impatient one must produce
 * different emotion trajectories, or every character ends up behaving identically.
 */
export interface PersonalityState {
  /** How much of an emotion reaches the body. */
  expressiveness: number;
  /** Tendency to overstate — Furina's defining trait. */
  dramatism: number;
  /** Resistance to annoyance. */
  patience: number;
  /** Pull toward the user. */
  sociability: number;
  /** Willingness to act unprompted. */
  independence: number;
}

export interface AttentionState {
  target: TargetRef;
  /** 0..1 — how locked on. */
  strength: number;
}

/** Level 3 — everything the character carries between events. */
export interface CharacterState {
  schemaVersion: number;
  updatedAt: number;
  emotion: EmotionState;
  personality: PersonalityState;
  /** 0..1 physical reserve; drains with activity, refills at rest. */
  energy: number;
  /** 0..1 activation, independent of valence. Fear and joy both raise it. */
  arousal: number;
  attention: AttentionState;
}

export const EMOTION_CHANNELS = [
  "happiness", "affection", "curiosity", "annoyance", "fear", "boredom", "sleepiness",
] as const satisfies readonly (keyof EmotionState)[];

export const PERSONALITY_CHANNELS = [
  "expressiveness", "dramatism", "patience", "sociability", "independence",
] as const satisfies readonly (keyof PersonalityState)[];

export const NEUTRAL_EMOTION: EmotionState = {
  happiness: 0.5,
  affection: 0.5,
  curiosity: 0.3,
  annoyance: 0,
  fear: 0,
  boredom: 0.2,
  sleepiness: 0.1,
};

/** Furina: loud, dramatic, sociable, not especially patient. */
export const FURINA_PERSONALITY: PersonalityState = {
  expressiveness: 0.9,
  dramatism: 0.85,
  patience: 0.35,
  sociability: 0.75,
  independence: 0.5,
};
