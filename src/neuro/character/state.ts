import {
  FURINA_PERSONALITY, NEURO_SCHEMA_VERSION,
  type AttentionState, type BrainIntent, type CharacterState,
  type EmotionState, type PerceptionEvent, type PersonalityState, type WorldState,
} from "../contracts";
import { applyEmotionDelta, applyPerceptionToEmotion, arousalOf, decayEmotion, neutralEmotion } from "./emotion";

export interface CharacterStateOptions {
  personality?: PersonalityState;
  emotion?: EmotionState;
  now?: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Level 3 — the character's own state, and the only place it is mutated.
 *
 * This supersedes nothing: the existing `PetBlackboard` keeps running the sprite
 * planner untouched. It is a parallel, richer store so the new pipeline can be built
 * and tested without putting the shipped behaviour at risk.
 */
export class CharacterStateStore {
  private readonly personality: PersonalityState;
  private emotion: EmotionState;
  private energy = 0.8;
  private arousal = 0;
  private attention: AttentionState = { target: "none", strength: 0 };
  private updatedAt: number;

  constructor(options: CharacterStateOptions = {}) {
    this.personality = options.personality ?? FURINA_PERSONALITY;
    this.emotion = options.emotion ? { ...options.emotion } : neutralEmotion();
    this.updatedAt = options.now ?? 0;
  }

  observe(event: PerceptionEvent) {
    this.emotion = applyPerceptionToEmotion(this.emotion, event, this.personality);
    this.updatedAt = event.at;

    // Anything that touches or addresses the character claims its attention outright;
    // a brain intent can redirect it later, but the body should already be turning.
    switch (event.kind) {
      case "touch":
      case "repeated-touch":
      case "grabbed":
      case "pointer-dwelling":
        this.attention = { target: "pointer", strength: Math.max(this.attention.strength, 0.85) };
        break;
      case "pointer-approaching":
        this.attention = { target: "pointer", strength: Math.max(this.attention.strength, 0.6) };
        break;
      case "user-spoke":
        this.attention = { target: "user", strength: 0.95 };
        break;
      case "agent-state-changed":
        if (this.attention.strength < 0.5) this.attention = { target: "screen", strength: 0.5 };
        break;
      default:
        break;
    }
  }

  /** Advance the continuous parts. `dt` is derived from the caller's clock. */
  tick(now: number, world: WorldState) {
    const dt = Math.max(0, Math.min(5, (now - this.updatedAt) / 1000));
    this.updatedAt = now;
    if (dt === 0) return;

    this.emotion = decayEmotion(this.emotion, dt);

    // Boredom is the one channel that grows from the *absence* of input, so it cannot
    // be driven by events alone.
    const idleMinutes = world.environment.userIdleMs / 60_000;
    if (idleMinutes > 1) {
      const growth = 0.006 * dt * (1 - this.personality.independence) * Math.min(4, idleMinutes);
      this.emotion.boredom = clamp01(this.emotion.boredom + growth);
    }

    this.arousal = arousalOf(this.emotion, this.personality);

    // Energy drains with activation and refills while nothing is going on.
    const drain = this.arousal * 0.045 * dt;
    const refill = (1 - this.arousal) * 0.012 * dt;
    this.energy = clamp01(this.energy - drain + refill);
    this.emotion.sleepiness = clamp01(this.emotion.sleepiness + (1 - this.energy) * 0.004 * dt);

    // Attention lapses on its own unless something keeps renewing it.
    const holdRate = world.pointer.onCharacter ? 0.15 : 0.5;
    this.attention = {
      target: this.attention.strength > 0.05 ? this.attention.target : "none",
      strength: clamp01(this.attention.strength * Math.pow(0.5, dt * holdRate)),
    };
  }

  /** The brain may nudge emotion and redirect attention. It may not set them. */
  applyIntent(intent: BrainIntent) {
    if (intent.emotionDelta) this.emotion = applyEmotionDelta(this.emotion, intent.emotionDelta);
    if (intent.attention) {
      this.attention = {
        target: intent.attention.target,
        strength: clamp01(intent.attention.strength * intent.confidence),
      };
    }
  }

  /** Direct energy control for drag and locomotion, which cost real effort. */
  spendEnergy(amount: number) {
    this.energy = clamp01(this.energy - Math.max(0, amount));
  }

  snapshot(): CharacterState {
    return {
      schemaVersion: NEURO_SCHEMA_VERSION,
      updatedAt: this.updatedAt,
      emotion: { ...this.emotion },
      personality: { ...this.personality },
      energy: this.energy,
      arousal: this.arousal,
      attention: { ...this.attention },
    };
  }
}
