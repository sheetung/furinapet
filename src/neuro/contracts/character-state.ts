/**
 * Neuro contract Level 3: CharacterState.
 *
 * The character's own internal state — emotions, energy, attention. Extends
 * what the Pet Blackboard tracks today with the seven-dimension emotion model.
 * All values are 0..1 floats and evolve deterministically from perception
 * events; models may only propose deltas on top (emotionDelta in the intent).
 */

export interface EmotionState {
  happiness: number;
  affection: number;
  curiosity: number;
  annoyance: number;
  fear: number;
  boredom: number;
  sleepiness: number;
}

export const EMOTION_KEYS: readonly (keyof EmotionState)[] = [
  "happiness",
  "affection",
  "curiosity",
  "annoyance",
  "fear",
  "boredom",
  "sleepiness",
];

export type TargetRef =
  | "none"
  | "pointer"
  | "user"
  | "agent"
  | "self";

export interface AttentionState {
  target: TargetRef;
  /** 0..1, how strongly attention is held. */
  strength: number;
}

export interface CharacterState {
  emotion: EmotionState;
  energy: number;
  arousal: number;
  attention: AttentionState;
  currentGoal: string;
  /** Currently active motor primitives, e.g. ["recoil", "lookAway"]. */
  currentMotorState: string[];
}

export function emptyEmotionState(): EmotionState {
  return {
    happiness: 0.5,
    affection: 0.5,
    curiosity: 0.5,
    annoyance: 0.1,
    fear: 0.05,
    boredom: 0.2,
    sleepiness: 0.2,
  };
}

export function emptyCharacterState(at = 0): CharacterState {
  return {
    emotion: emptyEmotionState(),
    energy: 0.78,
    arousal: 0.2,
    attention: { target: "none", strength: 0 },
    currentGoal: "idle",
    currentMotorState: [],
  };
}

export function clampEmotion(emotion: EmotionState): EmotionState {
  const clamp = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
  return {
    happiness: clamp(emotion.happiness),
    affection: clamp(emotion.affection),
    curiosity: clamp(emotion.curiosity),
    annoyance: clamp(emotion.annoyance),
    fear: clamp(emotion.fear),
    boredom: clamp(emotion.boredom),
    sleepiness: clamp(emotion.sleepiness),
  };
}

export function applyEmotionDelta(
  emotion: EmotionState,
  delta: Partial<EmotionState>,
): EmotionState {
  const next = { ...emotion };
  for (const key of EMOTION_KEYS) {
    const amount = delta[key];
    if (typeof amount === "number" && Number.isFinite(amount)) {
      next[key] = emotion[key] + amount;
    }
  }
  return clampEmotion(next);
}
