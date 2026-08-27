import * as THREE from "three";
import type { MotionTarget, PoseSink, RigBoneName, SkeletonRig } from "../types";

const euler = new THREE.Euler(0, 0, 0, "YXZ");
const delta = new THREE.Quaternion();
const local = new THREE.Quaternion();
const offset = new THREE.Vector3();

const TAIL: readonly RigBoneName[] = ["tail1", "tail2", "tail3"];

/**
 * The "Procedural / 耳朵尾巴身体" stage.
 *
 * Everything here is an open-loop oscillator: breathing, weight shift, a vertical
 * bob and the decorative chain. Nothing solves for a goal, so the layer costs
 * almost nothing and never fights the IK stages — the mixer's per-joint weights
 * decide how much of it survives.
 *
 * The tail and ears are only given a small sinusoidal target. Their trailing and
 * overshoot come from the deliberately under-damped springs in `limits.ts`, not
 * from a hand-written delay line.
 */
export class Procedural {
  private phase = 0;

  step(dt: number, motion: MotionTarget) {
    this.phase += dt * motion.breathHz * Math.PI * 2;
    if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
  }

  solve(rig: SkeletonRig, motion: MotionTarget, sink: PoseSink) {
    const breath = Math.sin(this.phase);
    const secondary = Math.sin(this.phase * 0.5 + 0.9);

    this.push(rig, sink, "spine", motion.breathAmount * 0.35 * breath + motion.droop * 0.12, 0, 0, 1);
    this.push(
      rig, sink, "chest",
      -motion.breathAmount * breath + motion.droop * 0.16,
      0,
      motion.weightShift * 0.05,
      1,
    );
    this.push(
      rig, sink, "hips",
      motion.droop * 0.06,
      motion.weightShift * 0.06,
      -motion.weightShift * 0.09,
      1,
    );

    offset.set(0, motion.bob + motion.breathAmount * 0.02 * breath, 0);
    sink.addOffset("hips", offset, 1);

    const sway = motion.liveliness;
    if (sway > 0) {
      TAIL.forEach((bone, index) => {
        const wave = Math.sin(this.phase * 1.6 - index * 0.7) * sway;
        this.push(rig, sink, bone, wave * 0.08, wave * 0.22, 0, 1);
      });
      this.push(rig, sink, "leftEar", secondary * sway * 0.1, 0, secondary * sway * 0.14, 1);
      this.push(rig, sink, "rightEar", secondary * sway * 0.1, 0, -secondary * sway * 0.14, 1);
    }
  }

  private push(
    rig: SkeletonRig,
    sink: PoseSink,
    bone: RigBoneName,
    pitch: number,
    yaw: number,
    roll: number,
    weight: number,
  ) {
    const rest = rig.restQuaternion(bone);
    if (!rest || !rig.getBone(bone)) return;
    euler.set(pitch, yaw, roll);
    delta.setFromEuler(euler);
    local.copy(rest).multiply(delta);
    sink.add(bone, local, weight);
  }
}
