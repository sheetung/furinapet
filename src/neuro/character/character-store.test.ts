import { describe, expect, it } from "vitest";
import { emptyEmotionState, type PerceptionEvent } from "../contracts";
import {
  CharacterStore,
  EMOTION_BASELINE,
  EMOTION_DYNAMICS,
  getCharacterStore,
} from "./character-store";
import { deriveMood } from "./character-adapter";

const click = (at: number, streak = 0): PerceptionEvent => ({
  type: "touch", at, sense: "pet:clicked", region: "none", streak, intensity: 0,
});

describe("character store", () => {
  it("accumulates annoyance with streak bonus on repeated clicks", () => {
    const store = new CharacterStore();
    store.observe(click(1000, 1));
    const single = store.getEmotion().annoyance;
    expect(single).toBeCloseTo(EMOTION_BASELINE.annoyance + 0.02);

    store.observe(click(1300, 5));
    const boosted = store.getEmotion().annoyance;
    expect(boosted).toBeCloseTo(single + 0.02 + 4 * 0.015);
  });

  it("reduces boredom on interaction and grows it during idle ticks", () => {
    const store = new CharacterStore();
    store.observe(click(1000, 1));
    expect(store.getEmotion().boredom).toBeCloseTo(EMOTION_BASELINE.boredom - 0.1);

    store.tick(1000);
    store.tick(1000 + 60000);
    const afterOneMinute = store.getEmotion().boredom;
    expect(afterOneMinute).toBeGreaterThan(EMOTION_BASELINE.boredom - 0.1);
  });

  it("grows sleepiness with idle minutes", () => {
    const store = new CharacterStore();
    store.tick(1000);
    store.tick(1000 + 120000);
    expect(store.getEmotion().sleepiness).toBeCloseTo(
      EMOTION_BASELINE.sleepiness + 2 * EMOTION_DYNAMICS.sleepinessPerMinute,
      1,
    );
  });

  it("decays emotions toward baseline over time", () => {
    const store = new CharacterStore();
    for (let index = 0; index < 10; index += 1) store.observe(click(1000 + index, 1));
    const excited = store.getEmotion().happiness;
    store.tick(1000);
    store.tick(1000 + 60000);
    const relaxed = store.getEmotion().happiness;
    expect(relaxed).toBeLessThan(excited);
    expect(relaxed).toBeGreaterThan(EMOTION_BASELINE.happiness);
  });

  it("reacts to agent success and error events", () => {
    const success = new CharacterStore();
    success.observe({ type: "agentState", at: 1000, state: "success", connected: true });
    expect(success.getEmotion().happiness).toBeGreaterThan(EMOTION_BASELINE.happiness);

    const error = new CharacterStore();
    error.observe({ type: "agentState", at: 2000, state: "error", connected: true });
    expect(error.getEmotion().curiosity).toBeGreaterThan(EMOTION_BASELINE.curiosity);
    expect(error.getEmotion().annoyance).toBeGreaterThan(EMOTION_BASELINE.annoyance);
  });

  it("tracks arousal through interaction and relaxation", () => {
    const store = new CharacterStore();
    store.observe({ type: "drag", at: 1000, phase: "start" });
    expect(store.getArousal()).toBeCloseTo(EMOTION_DYNAMICS.arousalBaseline + 0.15);
    store.tick(1000);
    store.tick(1000 + 60000);
    expect(store.getArousal()).toBeLessThan(EMOTION_DYNAMICS.arousalBaseline + 0.15);
  });

  it("arouses only for on-body pointer activity (regression: arousal pinning)", () => {
    // The 125 ms sampler used to add +0.01 arousal per sample unconditionally
    // (+4.8/min vs max decay 0.34/min), pinning arousal at 1.0 forever. Only
    // pointer movement over the pet's body may stimulate it now.
    const store = new CharacterStore();
    const baseline = store.getArousal();
    store.observe({ type: "pointer", at: 1000, x: 1200, y: 1200, region: "none" });
    expect(store.getArousal()).toBeCloseTo(baseline);

    store.observe({ type: "pointer", at: 1125, x: 500, y: 500, region: "face" });
    expect(store.getArousal()).toBeCloseTo(baseline + 0.01);

    store.observe({ type: "pointer", at: 1250, x: 520, y: 510, region: "body" });
    expect(store.getArousal()).toBeCloseTo(baseline + 0.02);
  });

  it("clamps everything into 0..1 under extreme input", () => {
    const store = new CharacterStore();
    for (let index = 0; index < 200; index += 1) store.observe(click(1000 + index, 20));
    const emotion = store.getEmotion();
    for (const key of Object.keys(emotion) as (keyof typeof emotion)[]) {
      expect(emotion[key]).toBeLessThanOrEqual(1);
      expect(emotion[key]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("mood derivation", () => {
  it("prefers tired below the energy threshold", () => {
    expect(deriveMood(emptyEmotionState(), 0.2, false)).toBe("tired");
    expect(deriveMood(emptyEmotionState(), 0.2, true)).toBe("tired");
  });

  it("reports focused while an agent is working", () => {
    expect(deriveMood(emptyEmotionState(), 0.8, true)).toBe("focused");
  });

  it("maps high happiness or strong annoyance to happy", () => {
    expect(deriveMood({ ...emptyEmotionState(), happiness: 0.8 }, 0.8, false)).toBe("happy");
    expect(deriveMood({ ...emptyEmotionState(), annoyance: 0.75 }, 0.8, false)).toBe("happy");
    expect(deriveMood(emptyEmotionState(), 0.8, false)).toBe("normal");
  });
});

describe("singleton", () => {
  it("returns the same store instance", () => {
    expect(getCharacterStore()).toBe(getCharacterStore());
  });
});
