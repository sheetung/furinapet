/**
 * Deterministic character emotion store (neuro L3).
 *
 * Emotions evolve from perception events and time — never from a model.
 * Rules follow the LMC plan: small increments per touch, streak-scaled
 * annoyance, boredom/sleepiness growth during idle, and slow decay toward
 * baseline. Fully reproducible and unit-tested.
 */

import {
  applyEmotionDelta,
  clamp01,
  emptyEmotionState,
  type EmotionState,
  type PerceptionEvent,
} from "../contracts";

/** Baseline the emotions relax toward when nothing happens. */
export const EMOTION_BASELINE: EmotionState = emptyEmotionState();

/** Per-minute rates used by tick(). */
export const EMOTION_DYNAMICS = {
  boredomPerMinute: 0.06,
  sleepinessPerMinute: 0.04,
  /** Fraction of the distance to baseline covered per minute. */
  decayPerMinute: 0.6,
  arousalBaseline: 0.15,
  arousalDecayPerMinute: 0.4,
} as const;

/** Per-event emotion deltas. */
export const TOUCH_DELTAS = {
  click: { happiness: 0.04, curiosity: 0.02, annoyance: 0.02, boredom: -0.1 },
  clickStreakBonus: { annoyance: 0.015 },
  doubleClick: { happiness: 0.06, curiosity: 0.03, annoyance: 0.01, boredom: -0.12 },
  dragStart: { fear: 0.01, boredom: -0.05 },
  agentSuccess: { happiness: 0.08, annoyance: -0.03, curiosity: -0.02 },
  agentError: { curiosity: 0.02, annoyance: 0.02 },
} as const;

export class CharacterStore {
  private emotion: EmotionState = { ...EMOTION_BASELINE };
  private arousal: number = EMOTION_DYNAMICS.arousalBaseline;
  private lastTickAt: number | null = null;
  private lastInteractionAt: number | null = null;

  observe(event: PerceptionEvent): void {
    let delta: Partial<EmotionState> | null = null;
    let arousalDelta = 0;

    switch (event.type) {
      case "touch": {
        if (event.sense === "pet:clicked") {
          delta = { ...TOUCH_DELTAS.click };
          const bonus = Math.max(0, event.streak - 1) * TOUCH_DELTAS.clickStreakBonus.annoyance;
          delta.annoyance = TOUCH_DELTAS.click.annoyance + bonus;
          arousalDelta = 0.08;
          this.lastInteractionAt = event.at;
        } else if (event.sense === "pet:doubleClicked") {
          delta = { ...TOUCH_DELTAS.doubleClick };
          arousalDelta = 0.12;
          this.lastInteractionAt = event.at;
        }
        break;
      }
      case "drag": {
        if (event.phase === "start") {
          delta = { ...TOUCH_DELTAS.dragStart };
          arousalDelta = 0.15;
          this.lastInteractionAt = event.at;
        } else {
          arousalDelta = -0.05;
        }
        break;
      }
      case "agentState": {
        if (event.state === "success") delta = { ...TOUCH_DELTAS.agentSuccess };
        else if (event.state === "error") delta = { ...TOUCH_DELTAS.agentError };
        break;
      }
      case "pointer": {
        // On-body pointer activity is mildly stimulating; movement elsewhere
        // on the screen is ambient noise. The sampler fires ~8×/s, so an
        // ungated delta here would accumulate far faster than arousal can
        // decay and pin it at 1.0.
        arousalDelta = event.region === "none" ? 0 : 0.01;
        break;
      }
      default:
        break;
    }

    if (delta) this.emotion = applyEmotionDelta(this.emotion, delta);
    if (arousalDelta !== 0) this.arousal = clamp01(this.arousal + arousalDelta);
  }

  tick(now: number): void {
    const last = this.lastTickAt ?? now;
    const minutes = Math.max(0, Math.min(5, (now - last) / 60000));
    this.lastTickAt = now;
    if (minutes === 0) return;

    const decay = Math.min(1, minutes * EMOTION_DYNAMICS.decayPerMinute);
    const next: EmotionState = { ...this.emotion };
    for (const key of Object.keys(next) as (keyof EmotionState)[]) {
      const baseline = EMOTION_BASELINE[key];
      next[key] = next[key] + (baseline - next[key]) * decay;
    }
    next.boredom = clamp01(next.boredom + minutes * EMOTION_DYNAMICS.boredomPerMinute);
    next.sleepiness = clamp01(next.sleepiness + minutes * EMOTION_DYNAMICS.sleepinessPerMinute);
    this.emotion = next;

    this.arousal = clamp01(
      this.arousal + (EMOTION_DYNAMICS.arousalBaseline - this.arousal)
        * Math.min(1, minutes * EMOTION_DYNAMICS.arousalDecayPerMinute),
    );
  }

  getEmotion(): EmotionState {
    return { ...this.emotion };
  }

  getArousal(): number {
    return this.arousal;
  }

  getLastInteractionAt(): number | null {
    return this.lastInteractionAt;
  }
}

let store: CharacterStore | null = null;

export function getCharacterStore(): CharacterStore {
  if (!store) store = new CharacterStore();
  return store;
}
