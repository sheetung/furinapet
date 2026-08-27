import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createMotionTarget } from "../Cerebellum";
import { JointMixer } from "../JointMixer";
import { defaultJointLimits } from "../limits";
import { PrimitiveRig } from "../rig/PrimitiveRig";
import type { MotionTarget } from "../types";
import { AimIK } from "./AimIK";

const FORWARD = new THREE.Vector3(0, 0, 1);

function settle(gaze: THREE.Vector3, gazeWeight = 1, seconds = 3) {
  const rig = new PrimitiveRig({ visual: false });
  const mixer = new JointMixer(defaultJointLimits);
  const aim = new AimIK();
  const motion: MotionTarget = createMotionTarget();
  motion.gaze.copy(gaze);
  motion.gazeWeight = gazeWeight;

  const step = 1 / 120;
  for (let time = 0; time < seconds; time += step) {
    rig.root.updateMatrixWorld(true);
    aim.solve(rig, motion, mixer);
    mixer.flush(rig, step);
  }
  rig.root.updateMatrixWorld(true);
  return { rig, aim };
}

/** Angle in degrees between where the head points and where the goal is. */
function aimError(rig: PrimitiveRig, gaze: THREE.Vector3): number {
  const head = rig.getBone("head")!;
  const facing = FORWARD.clone().applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
  const desired = gaze.clone().sub(rig.root.worldToLocal(head.getWorldPosition(new THREE.Vector3()))).normalize();
  return facing.angleTo(desired) * 180 / Math.PI;
}

describe("AimIK", () => {
  it("points the head at a goal to the side", () => {
    const gaze = new THREE.Vector3(0.7, 1.35, 1.2);
    const { rig } = settle(gaze);
    expect(aimError(rig, gaze)).toBeLessThan(6);
  });

  it("points the head at a goal above and behind the shoulder line", () => {
    const gaze = new THREE.Vector3(-0.5, 1.9, 0.4);
    const { rig } = settle(gaze);
    expect(aimError(rig, gaze)).toBeLessThan(8);
  });

  it("spreads the turn across chest, neck and head instead of snapping the head", () => {
    const gaze = new THREE.Vector3(0.9, 1.35, 0.9);
    const { rig } = settle(gaze);
    const rest = new THREE.Quaternion();

    const chest = rig.getBone("chest")!.quaternion.angleTo(rest);
    const neck = rig.getBone("neck")!.quaternion.angleTo(rest);
    const head = rig.getBone("head")!.quaternion.angleTo(rest);

    expect(chest).toBeGreaterThan(0.01);
    expect(neck).toBeGreaterThan(chest);
    expect(head).toBeGreaterThan(neck);
  });

  it("keeps every joint inside its configured limit", () => {
    const gaze = new THREE.Vector3(6, 1.4, -3);
    const { rig } = settle(gaze);
    const rest = new THREE.Quaternion();
    for (const bone of ["chest", "neck", "head"] as const) {
      const limit = defaultJointLimits[bone]!.maxSwing;
      expect(rig.getBone(bone)!.quaternion.angleTo(rest)).toBeLessThanOrEqual(limit + 1e-3);
    }
  });

  it("leaves the chain on its rest pose at zero weight", () => {
    const gaze = new THREE.Vector3(0.9, 1.35, 0.9);
    const { rig } = settle(gaze, 0);
    const rest = new THREE.Quaternion();
    for (const bone of ["chest", "neck", "head"] as const) {
      expect(rig.getBone(bone)!.quaternion.angleTo(rest)).toBeLessThan(1e-6);
    }
  });

  it("clamps yaw so a goal directly behind does not wring the neck", () => {
    const { aim } = settle(new THREE.Vector3(0, 1.35, -3));
    expect(Math.abs(aim.angles.yaw)).toBeLessThanOrEqual(110 * Math.PI / 180 + 1e-6);
  });
});
