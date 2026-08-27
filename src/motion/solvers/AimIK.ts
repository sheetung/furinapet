import * as THREE from "three";
import { AIM_CHAIN, type MotionTarget, type PoseSink, type RigBoneName, type SkeletonRig } from "../types";

/** How much of the total aim each joint carries. Sums to 1. */
const SHARES: Record<string, number> = { chest: 0.16, neck: 0.34, head: 0.5 };

const MAX_YAW = 110 * Math.PI / 180;
const MAX_PITCH = 45 * Math.PI / 180;

const headWorld = new THREE.Vector3();
const direction = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const delta = new THREE.Quaternion();
const local = new THREE.Quaternion();

/**
 * The "Aim IK / 头眼颈" stage.
 *
 * Rather than iterating a solver, the required yaw/pitch is computed once at the
 * chain tip and distributed down the chain by anatomical share. That is stable at
 * any frame rate, cannot oscillate, and keeps the eyes and head consistent — the
 * failure mode of running CCD on a three-bone neck.
 */
export class AimIK {
  private lastYaw = 0;
  private lastPitch = 0;

  solve(rig: SkeletonRig, motion: MotionTarget, sink: PoseSink) {
    if (!(motion.gazeWeight > 0)) return;

    const head = rig.getBone("head");
    if (!head) return;

    // Work in rig-root space so yaw is about the character's own up axis.
    head.getWorldPosition(headWorld);
    rig.root.worldToLocal(headWorld);
    direction.copy(motion.gaze).sub(headWorld);
    if (direction.lengthSq() < 1e-8) return;
    direction.normalize();

    const yaw = THREE.MathUtils.clamp(Math.atan2(direction.x, direction.z), -MAX_YAW, MAX_YAW);
    const pitch = THREE.MathUtils.clamp(-Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)), -MAX_PITCH, MAX_PITCH);
    this.lastYaw = yaw;
    this.lastPitch = pitch;

    for (const bone of AIM_CHAIN) {
      const share = SHARES[bone] ?? 0;
      if (share <= 0) continue;
      const rest = rig.restQuaternion(bone);
      if (!rest || !rig.getBone(bone)) continue;

      euler.set(pitch * share, yaw * share, 0);
      delta.setFromEuler(euler);
      local.copy(rest).multiply(delta);
      sink.add(bone as RigBoneName, local, motion.gazeWeight);
    }
  }

  /** Last resolved aim angles in radians. Exposed for diagnostics. */
  get angles() {
    return { yaw: this.lastYaw, pitch: this.lastPitch };
  }
}
