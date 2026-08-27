import * as THREE from "three";
import type { PoseSink, RigBoneName, SkeletonRig } from "../types";

const EPSILON = 1e-5;

export interface TwoBoneChain {
  upper: RigBoneName;
  lower: RigBoneName;
  end: RigBoneName;
}

export interface TwoBoneRequest {
  /** Goal for the end effector, in rig-root space. */
  target: THREE.Vector3;
  /** Hint for the bend direction (elbow/knee), in rig-root space. */
  pole: THREE.Vector3;
  weight: number;
}

const rootInverse = new THREE.Quaternion();
const parentRotation = new THREE.Quaternion();
const parentInverse = new THREE.Quaternion();
const origin = new THREE.Vector3();
const midOffset = new THREE.Vector3();
const endOffset = new THREE.Vector3();
const restUpperLocal = new THREE.Quaternion();
const restLowerLocal = new THREE.Quaternion();
const localUpper = new THREE.Quaternion();
const localLower = new THREE.Quaternion();
const rotationUpper = new THREE.Quaternion();
const rotationLower = new THREE.Quaternion();
const midPosition = new THREE.Vector3();
const endPosition = new THREE.Vector3();
const goal = new THREE.Vector3();
const pole = new THREE.Vector3();
const bendAxis = new THREE.Vector3();
const spin = new THREE.Quaternion();
const conjugation = new THREE.Quaternion();
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchD = new THREE.Vector3();

/** Law of cosines: the angle between sides `a` and `b` when the third side is `c`. */
function cosineAngle(a: number, b: number, c: number): number {
  const denominator = 2 * a * b;
  if (denominator < EPSILON) return 0;
  return Math.acos(THREE.MathUtils.clamp((a * a + b * b - c * c) / denominator, -1, 1));
}

/**
 * The "Two-Bone IK / 手臂腿部" stage.
 *
 * Closed-form, not iterative: one law-of-cosines bend, one alignment swing, one
 * twist about the goal axis. No convergence loop means no jitter near the reach
 * limit, the usual complaint about running CCD on a two-segment limb.
 *
 * Forward kinematics restarts from the rest pose every frame instead of from the
 * bones' live values, so the solution is a pure function of the goal. Smoothing is
 * left entirely to the mixer's spring; solving from the live pose would feed the
 * spring's own output back into its input.
 *
 * Everything is computed in rig-root space, which assumes uniform root scale.
 */
export class TwoBoneIK {
  private upperLength = 0;
  private lowerLength = 0;
  private reachError = 0;

  solve(rig: SkeletonRig, chain: TwoBoneChain, request: TwoBoneRequest, sink: PoseSink): boolean {
    if (!(request.weight > 0)) return false;

    const upper = rig.getBone(chain.upper);
    const lower = rig.getBone(chain.lower);
    const end = rig.getBone(chain.end);
    const restUpper = rig.restQuaternion(chain.upper);
    const restLower = rig.restQuaternion(chain.lower);
    if (!upper || !lower || !end || !restUpper || !restLower || !upper.parent) return false;

    midOffset.copy(lower.position);
    endOffset.copy(end.position);
    this.upperLength = midOffset.length();
    this.lowerLength = endOffset.length();
    if (this.upperLength < EPSILON || this.lowerLength < EPSILON) return false;

    rig.root.getWorldQuaternion(rootInverse).invert();
    upper.parent.getWorldQuaternion(parentRotation).premultiply(rootInverse);
    parentInverse.copy(parentRotation).invert();
    rig.root.worldToLocal(upper.getWorldPosition(origin));

    restUpperLocal.copy(restUpper);
    restLowerLocal.copy(restLower);
    localUpper.copy(restUpper);
    localLower.copy(restLower);
    goal.copy(request.target);
    pole.copy(request.pole);
    this.forward();

    const reach = this.upperLength + this.lowerLength;
    const straightDistance = scratchA.copy(goal).sub(origin).length();
    this.reachError = Math.max(0, straightDistance - reach);
    const distance = THREE.MathUtils.clamp(
      straightDistance,
      Math.abs(this.upperLength - this.lowerLength) + EPSILON,
      reach - EPSILON,
    );

    this.resolveBendAxis();
    this.bendToDistance(distance);
    this.alignToGoal();
    this.applyPole();

    sink.add(chain.upper, localUpper, request.weight);
    sink.add(chain.lower, localLower, request.weight);
    return true;
  }

  /** Metres by which the last goal exceeded the chain's reach. Zero when reachable. */
  get overreach(): number {
    return this.reachError;
  }

  /** Effector position of the last solve, in rig-root space. Used by tests. */
  get effector(): THREE.Vector3 {
    return endPosition;
  }

  private forward() {
    rotationUpper.copy(parentRotation).multiply(localUpper);
    midPosition.copy(midOffset).applyQuaternion(rotationUpper).add(origin);
    rotationLower.copy(rotationUpper).multiply(localLower);
    endPosition.copy(endOffset).applyQuaternion(rotationLower).add(midPosition);
  }

  /**
   * Normal of the current limb triangle.
   *
   * A limb at rest is usually straight, so the triangle is degenerate and the plane
   * has to come from the pole hint instead. The axis must stay perpendicular to the
   * limb chord: rotating about anything else changes the effector's direction
   * without changing its distance from the root, and the bend silently does nothing.
   */
  private resolveBendAxis() {
    scratchA.copy(endPosition).sub(origin);
    scratchB.copy(midPosition).sub(origin);
    bendAxis.copy(scratchA).cross(scratchB);
    if (bendAxis.lengthSq() >= 1e-10) {
      bendAxis.normalize();
      return;
    }

    scratchB.copy(pole).sub(origin);
    bendAxis.copy(scratchA).cross(scratchB);
    if (bendAxis.lengthSq() < 1e-10) {
      // The pole is colinear with the limb, so any perpendicular is as good as another.
      scratchD.copy(scratchA).normalize();
      scratchB.set(0, 0, 1);
      if (Math.abs(scratchD.dot(scratchB)) > 0.9) scratchB.set(0, 1, 0);
      bendAxis.copy(scratchA).cross(scratchB);
    }
    if (bendAxis.lengthSq() < 1e-10) bendAxis.set(1, 0, 0);
    bendAxis.normalize();
  }

  /**
   * Opens or closes the middle joint until the effector sits `distance` from the
   * root. Both rotation signs are tried and the better one kept: deriving the sign
   * from the cross-product order is easy to get wrong and silently mirrors the
   * elbow, while measuring the result costs one extra forward pass.
   */
  private bendToDistance(distance: number) {
    const current = cosineAngle(
      scratchA.copy(origin).sub(midPosition).length(),
      scratchB.copy(endPosition).sub(midPosition).length(),
      scratchC.copy(endPosition).sub(origin).length(),
    );
    const target = cosineAngle(this.upperLength, this.lowerLength, distance);
    const delta = target - current;
    if (Math.abs(delta) < 1e-6) return;

    this.rotateLower(delta);
    this.forward();
    const positiveError = Math.abs(scratchA.copy(endPosition).sub(origin).length() - distance);
    if (positiveError < 1e-4) return;

    localLower.copy(restLowerLocal);
    this.rotateLower(-delta);
    this.forward();
    const negativeError = Math.abs(scratchA.copy(endPosition).sub(origin).length() - distance);
    if (negativeError <= positiveError) return;

    localLower.copy(restLowerLocal);
    this.rotateLower(delta);
    this.forward();
  }

  /** Swings the whole limb so the effector lands on the ray from root to goal. */
  private alignToGoal() {
    scratchA.copy(endPosition).sub(origin);
    scratchB.copy(goal).sub(origin);
    if (scratchA.lengthSq() < 1e-10 || scratchB.lengthSq() < 1e-10) return;
    spin.setFromUnitVectors(scratchA.normalize(), scratchB.normalize());
    this.rotateUpper(spin);
    this.forward();
  }

  /** Twists the limb about the root-to-goal axis so the middle joint faces the pole. */
  private applyPole() {
    scratchC.copy(goal).sub(origin);
    if (scratchC.lengthSq() < 1e-10) return;
    scratchC.normalize();

    scratchA.copy(midPosition).sub(origin).projectOnPlane(scratchC);
    scratchB.copy(pole).sub(origin).projectOnPlane(scratchC);
    if (scratchA.lengthSq() < 1e-8 || scratchB.lengthSq() < 1e-8) return;
    scratchA.normalize();
    scratchB.normalize();

    const angle = Math.atan2(
      scratchD.copy(scratchA).cross(scratchB).dot(scratchC),
      scratchA.dot(scratchB),
    );
    if (Math.abs(angle) < 1e-6) return;
    spin.setFromAxisAngle(scratchC, angle);
    this.rotateUpper(spin);
    this.forward();
  }

  /** Rotates the lower bone by `delta` about the root-space bend axis. */
  private rotateLower(delta: number) {
    scratchC.copy(bendAxis).applyQuaternion(conjugation.copy(rotationUpper).invert());
    spin.setFromAxisAngle(scratchC, delta);
    localLower.premultiply(spin).normalize();
  }

  /** Applies a root-space rotation to the upper bone's local orientation. */
  private rotateUpper(rootSpin: THREE.Quaternion) {
    conjugation.copy(parentInverse).multiply(rootSpin).multiply(parentRotation);
    localUpper.premultiply(conjugation).normalize();
  }
}


