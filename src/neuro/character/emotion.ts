import {
  EMOTION_CHANNELS, NEUTRAL_EMOTION,
  type EmotionState, type PerceptionEvent, type PersonalityState,
} from "../contracts";

interface Dynamics {
  /** Where the channel drifts when nothing is happening. */
  baseline: number;
  /** Seconds to close half the gap to the baseline. */
  halfLife: number;
}

/**
 * Anger fades in half a minute, fear in seconds, affection over the better part of an
 * hour. Getting these apart matters more than getting any one of them exactly right:
 * equal decay rates make every emotion feel like the same emotion.
 */
const DYNAMICS: Record<keyof EmotionState, Dynamics> = {
  happiness: { baseline: 0.5, halfLife: 120 },
  affection: { baseline: 0.5, halfLife: 2400 },
  curiosity: { baseline: 0.3, halfLife: 45 },
  annoyance: { baseline: 0, halfLife: 30 },
  fear: { baseline: 0, halfLife: 8 },
  boredom: { baseline: 0.2, halfLife: 600 },
  sleepiness: { baseline: 0.1, halfLife: 1800 },
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function neutralEmotion(): EmotionState {
  return { ...NEUTRAL_EMOTION };
}

/** Signed nudges, applied once and clamped. Used for `BrainIntent.emotionDelta`. */
export function applyEmotionDelta(emotion: EmotionState, delta: Partial<EmotionState>): EmotionState {
  const next = { ...emotion };
  for (const channel of EMOTION_CHANNELS) {
    const amount = delta[channel];
    if (amount !== undefined) next[channel] = clamp01(next[channel] + amount);
  }
  return next;
}

/** Exponential relaxation toward each channel's baseline. Frame-rate independent. */
export function decayEmotion(emotion: EmotionState, dtSeconds: number): EmotionState {
  if (!(dtSeconds > 0)) return emotion;
  const next = { ...emotion };
  for (const channel of EMOTION_CHANNELS) {
    const { baseline, halfLife } = DYNAMICS[channel];
    const blend = 1 - Math.pow(0.5, dtSeconds / halfLife);
    next[channel] = clamp01(next[channel] + (baseline - next[channel]) * blend);
  }
  return next;
}

/** Regions that are more personal to touch than others. */
function touchSensitivity(region: PerceptionEvent["region"]): number {
  switch (region) {
    case "face": return 1.6;
    case "head": return 1.2;
    case "tail": return 1.5;
    case "hand": return 0.7;
    default: return 1;
  }
}

/**
 * Emotion moves by rule, not by model.
 *
 * This is on purpose and it is the part most likely to be second-guessed later. A
 * language model asked "how annoyed is she now?" gives a different answer every call,
 * which makes the character's mood unreproducible and untestable, and makes a
 * regression impossible to bisect. Rules are boring, deterministic and cheap; the brain
 * gets to *nudge* the result through `emotionDelta`, which is enough for it to express
 * an opinion without owning the state.
 */
export function applyPerceptionToEmotion(
  emotion: EmotionState,
  event: PerceptionEvent,
  personality: PersonalityState,
): EmotionState {
  const next = { ...emotion };
  // Patience buys down annoyance gain but never to zero.
  const irritability = 1 - personality.patience * 0.7;
  const warmth = 0.5 + personality.sociability * 0.5;
  const sensitivity = touchSensitivity(event.region);

  switch (event.kind) {
    case "touch":
      next.annoyance += 0.02 * sensitivity * irritability;
      next.affection += 0.012 * warmth;
      next.happiness += 0.02 * warmth;
      next.boredom -= 0.1;
      next.curiosity += 0.04;
      break;
    case "repeated-touch":
      // The streak, not the individual poke, is what wears her down.
      next.annoyance += event.repeat * 0.015 * sensitivity * irritability;
      next.affection += 0.004 * warmth;
      next.happiness -= event.repeat * 0.004;
      next.curiosity -= 0.03;
      next.boredom -= 0.15;
      break;
    case "pointer-approaching":
      next.curiosity += 0.06 * (0.5 + event.intensity);
      next.boredom -= 0.04;
      break;
    case "pointer-dwelling":
      next.curiosity += 0.03;
      break;
    case "pointer-leaving":
      next.curiosity -= 0.02;
      break;
    case "grabbed":
      next.fear += 0.18 * (1 - personality.independence * 0.4);
      next.annoyance += 0.05 * irritability;
      next.boredom -= 0.2;
      break;
    case "released":
      next.fear -= 0.12;
      next.happiness += 0.02;
      break;
    case "user-spoke":
      next.happiness += 0.05 * warmth;
      next.affection += 0.02 * warmth;
      next.boredom -= 0.25;
      next.curiosity += 0.08;
      break;
    case "agent-state-changed":
      next.curiosity += 0.05;
      next.boredom -= 0.05;
      break;
    case "user-went-idle":
      next.boredom += 0.2 * (1 - personality.independence);
      next.sleepiness += 0.05;
      break;
  }

  for (const channel of EMOTION_CHANNELS) next[channel] = clamp01(next[channel]);
  return next;
}

/**
 * Activation, not valence: delight and panic both score high.
 *
 * The motion layer needs this separately from any single emotion because amplitude and
 * speed track arousal, while *which* pose is chosen tracks the emotion mix.
 */
export function arousalOf(emotion: EmotionState, personality: PersonalityState): number {
  const raw = Math.max(
    emotion.fear,
    emotion.annoyance * 0.9,
    emotion.curiosity * 0.7,
    Math.abs(emotion.happiness - 0.5) * 1.4,
  );
  const damped = raw * (1 - emotion.sleepiness * 0.6);
  return clamp01(damped * (0.6 + personality.expressiveness * 0.5));
}

