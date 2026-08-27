import * as THREE from "three";
import type { MotionIntent, MotionTarget } from "./types";

/** What the pet window can actually observe, expressed in rig-root space. */
export interface MotionSenses {
  /** Cursor projected into rig-root space, or null when it is out of interest range. */
  gaze: THREE.Vector3 | null;
  /** Signed horizontal speed in metres/second. Positive is the character's right. */
  velocity: number;
  grounded: boolean;
}

export const IDLE_INTENT: MotionIntent = { kind: "idle", intensity: 0.3, durationMs: 0, id: 0 };

/**
 * Fallbacks used only until a rig reports its real measurements, and for the
 * degenerate case of a rig with no arms at all.
 */
const SHOULDER_OUT = 0.085;
const SHOULDER_UP = 0.75;
const ARM_REACH = 0.3;

/** Rig measurements the routines need in order to place goals correctly. */
export interface RigMetrics {
  height: number;
  arms: Record<"left" | "right", { origin: THREE.Vector3; reach: number } | null>;
}

export function createMotionTarget(): MotionTarget {
  return {
    gaze: new THREE.Vector3(0, 1, 1),
    gazeWeight: 0,
    hands: {
      left: { target: new THREE.Vector3(), pole: new THREE.Vector3(), weight: 0 },
      right: { target: new THREE.Vector3(), pole: new THREE.Vector3(), weight: 0 },
    },
    breathHz: 0.25,
    breathAmount: 0.03,
    weightShift: 0,
    bob: 0,
    liveliness: 0.3,
    droop: 0,
  };
}

/**
 * 小脑 / Cerebellum.
 *
 * Turns the Brain's discrete intent into the continuous, per-step targets the
 * solvers consume. Two rules define the boundary and are worth keeping:
 *
 * 1. Nothing above this layer may name a bone or an angle. The Brain says
 *    "greet with intensity 0.8"; what that means in joints is decided here.
 * 2. Nothing here is frame-rate dependent. `step` is driven at a fixed rate by
 *    `MotionController`, so the same intent produces the same motion at 30 fps
 *    and at 144 fps.
 */
export class Cerebellum {
  private readonly current = createMotionTarget();
  private readonly desired = createMotionTarget();
  private readonly gazeFallback = new THREE.Vector3();
  private readonly armDirection = new THREE.Vector3();
  private intent: MotionIntent = IDLE_INTENT;
  private clock = 0;
  private stride = 0;
  private height = 1.5;
  private metrics: RigMetrics | null = null;

  setScale(height: number) {
    this.height = Math.max(0.2, height);
  }

  /** Supplies measured shoulder positions and reaches; call on every rig change. */
  setMetrics(metrics: RigMetrics) {
    this.metrics = metrics;
    this.setScale(metrics.height);
  }

  setIntent(intent: MotionIntent) {
    if (intent.id === this.intent.id) return;
    this.intent = intent;
    this.clock = 0;
  }

  get activeIntent(): MotionIntent {
    return this.intent;
  }

  step(dt: number, senses: MotionSenses): MotionTarget {
    this.clock += dt;
    if (this.intent.durationMs > 0 && this.clock * 1000 >= this.intent.durationMs) {
      this.intent = { ...IDLE_INTENT, id: this.intent.id + 1 };
      this.clock = 0;
    }
    this.stride += dt * (2.4 + Math.abs(senses.velocity) * 1.6);

    this.writeDesired(senses);
    // One exponential filter over every channel. This is the whole of the
    // Cerebellum's "coordination" job: no channel is allowed to step.
    const blend = 1 - Math.exp(-dt / 0.12);
    this.smooth(blend);
    return this.current;
  }

  private writeDesired(senses: MotionSenses) {
    const h = this.height;
    const target = this.desired;
    const intensity = THREE.MathUtils.clamp(this.intent.intensity, 0, 1);
    const moving = Math.abs(senses.velocity) > 0.02;

    if (senses.gaze) {
      target.gaze.copy(senses.gaze);
      target.gazeWeight = this.intent.kind === "slump" ? 0.35 : 0.95;
    } else {
      target.gaze.copy(this.gazeFallback.set(0, h * 0.9, h * 1.2));
      target.gazeWeight = 0.2;
    }

    target.breathHz = 0.22 + intensity * 0.5 + Math.abs(senses.velocity) * 0.35;
    target.breathAmount = 0.028 + intensity * 0.03;
    target.liveliness = 0.25 + intensity * 0.6;
    target.droop = 0;
    target.bob = 0;
    target.weightShift = moving ? THREE.MathUtils.clamp(senses.velocity * 0.5, -1, 1) : Math.sin(this.stride * 0.21) * 0.3;
    target.hands.left.weight = 0;
    target.hands.right.weight = 0;
    this.setPole(target.hands.left.pole, -1);
    this.setPole(target.hands.right.pole, 1);

    switch (this.intent.kind) {
      case "greet": {
        const wave = Math.sin(this.clock * (7 + intensity * 5));
        // A wiper motion about the shoulder: elevation sweeps, radius does not.
        this.placeHand(target.hands.right.target, 1, 0.74 + wave * 0.3, 0.3, 0.84);
        target.hands.right.weight = 0.9;
        target.gazeWeight = Math.max(target.gazeWeight, 0.9);
        target.liveliness = 0.5 + intensity * 0.5;
        break;
      }
      case "cheer": {
        const pump = Math.sin(this.clock * (9 + intensity * 6));
        const elevation = 1.16 + pump * 0.2;
        this.placeHand(target.hands.left.target, -1, elevation, 0.22, 0.72);
        this.placeHand(target.hands.right.target, 1, elevation, 0.22, 0.72);
        target.hands.left.weight = 0.85;
        target.hands.right.weight = 0.85;
        target.bob = Math.max(0, pump) * h * 0.035 * (0.5 + intensity);
        target.liveliness = 1;
        break;
      }
      case "observe": {
        target.gazeWeight = 1;
        target.breathHz = 0.2 + intensity * 0.2;
        target.liveliness = 0.2;
        break;
      }
      case "slump": {
        target.droop = 0.55 + intensity * 0.35;
        target.breathHz = 0.16;
        target.breathAmount = 0.05;
        target.liveliness = 0.12;
        break;
      }
      case "locomote": {
        const swing = Math.sin(this.stride);
        // Arms hang and swing counter-phase, still at a constant radius.
        this.placeHand(target.hands.left.target, -1, -1.16, swing * 0.5, 0.7);
        this.placeHand(target.hands.right.target, 1, -1.16, -swing * 0.5, 0.7);
        target.hands.left.weight = 0.45;
        target.hands.right.weight = 0.45;
        target.bob = Math.abs(Math.sin(this.stride)) * h * 0.012;
        target.liveliness = 0.6 + intensity * 0.4;
        break;
      }
      case "idle":
        break;
    }

    // Droop has to read from the front. Pitching the spine forward is most of the
    // pose, but an orthographic camera looking straight at the pet barely sees a
    // forward lean — so the visible part is the head coming down and the body
    // sinking. Applied after the switch so every drooping routine gets it.
    if (target.droop > 0) {
      this.gazeFallback.set(0, h * (0.9 - 0.62 * target.droop), h * (1.2 - 0.7 * target.droop));
      target.gaze.lerp(this.gazeFallback, target.droop);
      target.gazeWeight = Math.max(target.gazeWeight, 0.55 * target.droop);
      target.bob -= target.droop * h * 0.028;
    }

    if (!senses.grounded) {
      target.bob = 0;
      target.liveliness = Math.max(target.liveliness, 0.7);
    }
  }

  /**
   * Elbows and knees are hinted low, behind and outside the torso so the limb never
   * inverts. Anchored to the measured shoulder so the hint stays meaningful on a
   * short-armed rig, where an absolute point derived from height would sit far away.
   */
  private setPole(pole: THREE.Vector3, side: -1 | 1) {
    const h = this.height;
    const measured = this.metrics?.arms[side < 0 ? "left" : "right"] ?? null;
    const reach = measured?.reach ?? h * ARM_REACH;
    if (measured) pole.copy(measured.origin);
    else pole.set(side * h * SHOULDER_OUT, h * SHOULDER_UP, 0);
    pole.x += side * reach * 0.8;
    pole.y -= reach * 0.5;
    pole.z -= reach * 1.1;
  }

  /**
   * Places a hand goal at a fraction of the arm's measured reach from its measured
   * shoulder.
   *
   * Holding the radius constant and animating only the direction is the important
   * part: a goal that sweeps radially crosses the reach limit, and the elbow then
   * snaps between bent and locked straight once per cycle. Constant radius means the
   * elbow holds its bend while the arm sweeps.
   *
   * @param elevation radians above the horizontal, in the shoulder's frame
   * @param forward how far in front of the body, relative to the radius
   * @param extension fraction of full arm reach; keep below ~0.85 to stay bent
   */
  private placeHand(
    out: THREE.Vector3,
    side: -1 | 1,
    elevation: number,
    forward: number,
    extension: number,
  ) {
    const h = this.height;
    const measured = this.metrics?.arms[side < 0 ? "left" : "right"] ?? null;
    const reach = measured?.reach ?? h * ARM_REACH;

    this.armDirection.set(side * Math.cos(elevation), Math.sin(elevation), forward).normalize();
    if (measured) out.copy(measured.origin);
    else out.set(side * h * SHOULDER_OUT, h * SHOULDER_UP, 0);
    out.addScaledVector(this.armDirection, reach * extension);
  }

  private smooth(blend: number) {
    const a = this.current;
    const b = this.desired;
    a.gaze.lerp(b.gaze, blend);
    a.gazeWeight += (b.gazeWeight - a.gazeWeight) * blend;
    a.breathHz += (b.breathHz - a.breathHz) * blend;
    a.breathAmount += (b.breathAmount - a.breathAmount) * blend;
    a.weightShift += (b.weightShift - a.weightShift) * blend;
    a.bob += (b.bob - a.bob) * blend;
    a.liveliness += (b.liveliness - a.liveliness) * blend;
    a.droop += (b.droop - a.droop) * blend;
    for (const side of ["left", "right"] as const) {
      const from = a.hands[side];
      const to = b.hands[side];
      // A hand fading in must not drag its goal in from wherever it was left.
      if (from.weight < 0.01 && to.weight > 0.01) from.target.copy(to.target);
      from.target.lerp(to.target, blend);
      from.pole.lerp(to.pole, blend);
      from.weight += (to.weight - from.weight) * blend;
    }
  }
}

