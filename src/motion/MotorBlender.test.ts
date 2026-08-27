import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Cerebellum, IDLE_INTENT, type MotionSenses } from "./Cerebellum";
import type { MotionIntent } from "./types";

const STILL: MotionSenses = { gaze: null, velocity: 0, grounded: true };

function intent(kind: MotionIntent["kind"], intensity = 0.7, durationMs = 0, id = 1): MotionIntent {
  return { kind, intensity, durationMs, id };
}

function run(cerebellum: Cerebellum, seconds: number, dt: number, senses = STILL) {
  const steps = Math.round(seconds / dt);
  for (let index = 0; index < steps; index += 1) cerebellum.step(dt, senses);
  return cerebellum.step(dt, senses);
}

describe("Cerebellum", () => {
  it("starts idle with the arms unclaimed", () => {
    const cerebellum = new Cerebellum();
    const motion = cerebellum.step(1 / 120, STILL);
    expect(motion.hands.left.weight).toBe(0);
    expect(motion.hands.right.weight).toBe(0);
    expect(cerebellum.activeIntent).toBe(IDLE_INTENT);
  });

  it("raises the greeting hand and leaves the other one alone", () => {
    const cerebellum = new Cerebellum();
    cerebellum.setScale(1.5);
    cerebellum.setIntent(intent("greet"));
    const motion = run(cerebellum, 0.5, 1 / 120);

    expect(motion.hands.right.weight).toBeGreaterThan(0.8);
    expect(motion.hands.left.weight).toBeLessThan(0.05);
    expect(motion.hands.right.target.y).toBeGreaterThan(1.1);
  });

  it("ramps a hand in rather than snapping it to full weight", () => {
    const cerebellum = new Cerebellum();
    cerebellum.setIntent(intent("greet"));
    const early = cerebellum.step(1 / 120, STILL).hands.right.weight;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.2);
  });

  it("raises both hands to cheer and adds a bob", () => {
    const cerebellum = new Cerebellum();
    cerebellum.setScale(1.5);
    cerebellum.setIntent(intent("cheer", 1));
    const motion = run(cerebellum, 1, 1 / 120);

    expect(motion.hands.left.weight).toBeGreaterThan(0.7);
    expect(motion.hands.right.weight).toBeGreaterThan(0.7);
    expect(motion.liveliness).toBeGreaterThan(0.9);
  });

  it("droops when slumping and not otherwise", () => {
    const cerebellum = new Cerebellum();
    cerebellum.setIntent(intent("slump", 0.8));
    expect(run(cerebellum, 1, 1 / 120).droop).toBeGreaterThan(0.7);

    cerebellum.setIntent(intent("observe", 0.5, 0, 2));
    expect(run(cerebellum, 2, 1 / 120).droop).toBeLessThan(0.05);
  });

  it("drops the head and sinks the body when slumping", () => {
    // A forward lean is invisible to a camera pointed straight at the pet, so droop
    // has to move something the viewer can actually see.
    const cerebellum = new Cerebellum();
    cerebellum.setScale(1.5);
    cerebellum.setIntent(intent("slump", 0.9));
    const slumped = run(cerebellum, 1.5, 1 / 120);

    const upright = new Cerebellum();
    upright.setScale(1.5);
    const neutral = run(upright, 1.5, 1 / 120);

    expect(slumped.gaze.y).toBeLessThan(neutral.gaze.y - 0.3);
    expect(slumped.gazeWeight).toBeGreaterThan(0.4);
    expect(slumped.bob).toBeLessThan(-0.01);
  });

  it("still looks down when slumping even with the cursor in range", () => {
    const cerebellum = new Cerebellum();
    cerebellum.setScale(1.5);
    cerebellum.setIntent(intent("slump", 0.9));
    const high: MotionSenses = { gaze: new THREE.Vector3(0, 2.2, 1), velocity: 0, grounded: true };
    const motion = run(cerebellum, 1.5, 1 / 120, high);
    expect(motion.gaze.y).toBeLessThan(1.6);
  });

  it("returns to idle when a timed intent expires", () => {
    const cerebellum = new Cerebellum();
    cerebellum.setIntent(intent("cheer", 1, 300));
    run(cerebellum, 0.2, 1 / 120);
    expect(cerebellum.activeIntent.kind).toBe("cheer");

    run(cerebellum, 0.4, 1 / 120);
    expect(cerebellum.activeIntent.kind).toBe("idle");
  });

  it("aims at the cursor when one is in range and relaxes when it is not", () => {
    const cerebellum = new Cerebellum();
    const tracking: MotionSenses = { gaze: new THREE.Vector3(0.5, 1.3, 1), velocity: 0, grounded: true };
    const tracked = run(cerebellum, 1, 1 / 120, tracking);
    expect(tracked.gazeWeight).toBeGreaterThan(0.85);

    const released = run(cerebellum, 2, 1 / 120, STILL);
    expect(released.gazeWeight).toBeLessThan(0.3);
  });

  it("produces the same motion at 120 Hz and at 240 Hz", () => {
    const fast = new Cerebellum();
    const slow = new Cerebellum();
    fast.setScale(1.5);
    slow.setScale(1.5);
    fast.setIntent(intent("greet", 0.8));
    slow.setIntent(intent("greet", 0.8));

    const a = run(fast, 1, 1 / 240);
    const b = run(slow, 1, 1 / 120);

    expect(Math.abs(a.hands.right.weight - b.hands.right.weight)).toBeLessThan(0.02);
    expect(Math.abs(a.breathHz - b.breathHz)).toBeLessThan(0.02);
    expect(a.hands.right.target.distanceTo(b.hands.right.target)).toBeLessThan(0.05);
  });
});
