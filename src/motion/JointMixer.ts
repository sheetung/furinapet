import * as THREE from "three";
import type { JointLimit, JointLimits, PoseSink, RigBoneName, SkeletonRig } from "./types";

/** Below this the axis of an axis-angle decomposition is numerically meaningless. */
const MIN_AXIS_LENGTH = 1e-6;
/** Hard cap so a bad target or a long frame stall cannot fling a joint. */
const MAX_ANGULAR_SPEED = 40;

const DEFAULT_LIMIT: JointLimit = { maxSwing: Math.PI * 0.45, stiffness: 240, damping: 26 };

interface Contribution {
  quaternion: THREE.Quaternion;
  weight: number;
}

interface OffsetContribution {
  offset: THREE.Vector3;
  weight: number;
}

interface JointState {
  velocity: THREE.Vector3;
  offset: THREE.Vector3;
  restPosition: THREE.Vector3 | null;
}

const scratchDelta = new THREE.Quaternion();
const scratchDecompose = new THREE.Quaternion();
const scratchAxis = new THREE.Vector3();
const scratchStep = new THREE.Quaternion();
const scratchMean = new THREE.Quaternion();
const scratchTarget = new THREE.Quaternion();
const scratchOffset = new THREE.Vector3();

/** Shortest-path axis-angle of a unit quaternion, written into `axis`. */
export function toAxisAngle(quaternion: THREE.Quaternion, axis: THREE.Vector3): number {
  const q = scratchDecompose.copy(quaternion);
  if (q.w < 0) {
    q.set(-q.x, -q.y, -q.z, -q.w);
  }
  axis.set(q.x, q.y, q.z);
  const sine = axis.length();
  if (sine < MIN_AXIS_LENGTH) {
    axis.set(1, 0, 0);
    return 0;
  }
  axis.divideScalar(sine);
  return 2 * Math.atan2(sine, Math.min(1, Math.max(-1, q.w)));
}

/** Limits how far `target` may swing away from `rest`. Returns `target`, mutated. */
export function clampSwing(target: THREE.Quaternion, rest: THREE.Quaternion, maxSwing: number): THREE.Quaternion {
  scratchDelta.copy(rest).invert().multiply(target);
  const angle = toAxisAngle(scratchDelta, scratchAxis);
  if (angle <= maxSwing) return target;
  scratchStep.setFromAxisAngle(scratchAxis, maxSwing);
  return target.copy(rest).multiply(scratchStep);
}

/**
 * The single writer to the skeleton.
 *
 * Solvers never touch bones. They push weighted local orientations here and the
 * mixer resolves the whole frame at once: weighted blend from the rest pose,
 * then the joint constraint, then a spring-damper toward the constrained target.
 * That ordering is what stops the aim chain, the arm IK and the procedural layer
 * from silently overwriting each other when they share `chest` or `spine`.
 */
export class JointMixer implements PoseSink {
  private readonly rotations = new Map<RigBoneName, Contribution[]>();
  private readonly offsets = new Map<RigBoneName, OffsetContribution[]>();
  private readonly states = new Map<RigBoneName, JointState>();
  private readonly limits: JointLimits;

  constructor(limits: JointLimits = {}) {
    this.limits = limits;
  }

  add(bone: RigBoneName, local: THREE.Quaternion, weight: number) {
    if (!(weight > 0)) return;
    const list = this.rotations.get(bone);
    const contribution: Contribution = { quaternion: local.clone(), weight };
    if (list) list.push(contribution);
    else this.rotations.set(bone, [contribution]);
  }

  addOffset(bone: RigBoneName, offset: THREE.Vector3, weight: number) {
    if (!(weight > 0)) return;
    const list = this.offsets.get(bone);
    const contribution = { offset: offset.clone(), weight };
    if (list) list.push(contribution);
    else this.offsets.set(bone, [contribution]);
  }

  private state(bone: RigBoneName): JointState {
    let state = this.states.get(bone);
    if (!state) {
      state = { velocity: new THREE.Vector3(), offset: new THREE.Vector3(), restPosition: null };
      this.states.set(bone, state);
    }
    return state;
  }

  private limit(bone: RigBoneName): JointLimit {
    return this.limits[bone] ?? DEFAULT_LIMIT;
  }

  /**
   * Weighted mean of this frame's contributions, blended out of the rest pose by
   * the total weight. A total below 1 deliberately leaves the remainder on rest,
   * so a solver that fades out returns the joint to rest instead of holding it.
   */
  private blendTarget(list: readonly Contribution[], rest: THREE.Quaternion): THREE.Quaternion {
    let total = list[0].weight;
    scratchMean.copy(list[0].quaternion);
    for (let index = 1; index < list.length; index += 1) {
      total += list[index].weight;
      scratchMean.slerp(list[index].quaternion, list[index].weight / total);
    }
    return scratchTarget.copy(rest).slerp(scratchMean, Math.min(1, total));
  }

  /** Semi-implicit spring-damper on the rotation error, integrated in bone-local space. */
  private springStep(current: THREE.Quaternion, target: THREE.Quaternion, state: JointState, limit: JointLimit, dt: number) {
    scratchDelta.copy(current).invert().multiply(target);
    const angle = toAxisAngle(scratchDelta, scratchAxis);

    state.velocity.addScaledVector(scratchAxis, angle * limit.stiffness * dt);
    state.velocity.multiplyScalar(Math.max(0, 1 - limit.damping * dt));

    const speed = state.velocity.length();
    if (speed > MAX_ANGULAR_SPEED) state.velocity.multiplyScalar(MAX_ANGULAR_SPEED / speed);
    if (speed < MIN_AXIS_LENGTH) return;

    scratchStep.setFromAxisAngle(scratchAxis.copy(state.velocity).divideScalar(speed), speed * dt);
    current.multiply(scratchStep).normalize();
  }

  /**
   * Resolve every joint and write it to the rig. Must run before the rig's own
   * update, because spring bones and node constraints consume the pose we leave.
   */
  flush(rig: SkeletonRig, dt: number) {
    const step = Math.max(1e-4, Math.min(0.05, dt));

    for (const [bone, list] of this.rotations) {
      const node = rig.getBone(bone);
      const rest = rig.restQuaternion(bone);
      if (!node || !rest) continue;
      const limit = this.limit(bone);
      const target = clampSwing(this.blendTarget(list, rest), rest, limit.maxSwing);
      this.springStep(node.quaternion, target, this.state(bone), limit, step);
    }

    // Joints nobody asked for this frame relax back to rest under the same spring.
    for (const [bone, state] of this.states) {
      if (this.rotations.has(bone)) continue;
      const node = rig.getBone(bone);
      const rest = rig.restQuaternion(bone);
      if (!node || !rest) continue;
      const limit = this.limit(bone);
      if (state.velocity.lengthSq() < 1e-8 && node.quaternion.angleTo(rest) < 1e-4) continue;
      this.springStep(node.quaternion, scratchTarget.copy(rest), state, limit, step);
    }

    this.flushOffsets(rig, step);
    this.rotations.clear();
    this.offsets.clear();
  }

  private flushOffsets(rig: SkeletonRig, dt: number) {
    for (const bone of this.offsets.keys()) this.state(bone);
    for (const [bone, state] of this.states) {
      const node = rig.getBone(bone);
      if (!node) continue;
      if (!state.restPosition) state.restPosition = node.position.clone();

      scratchOffset.set(0, 0, 0);
      const list = this.offsets.get(bone);
      if (list) {
        for (const contribution of list) scratchOffset.addScaledVector(contribution.offset, contribution.weight);
      }
      // Exponential smoothing: translation needs no overshoot, only continuity.
      state.offset.lerp(scratchOffset, 1 - Math.exp(-18 * dt));
      node.position.copy(state.restPosition).add(state.offset);
    }
  }

  /** Clears spring velocities and pending contributions. Used on rig swap. */
  reset() {
    this.rotations.clear();
    this.offsets.clear();
    this.states.clear();
  }
}

