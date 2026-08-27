import * as THREE from "three";
import type { RigBoneName, SkeletonRig } from "../types";

/** Shoulder origin and total arm length of one side, measured at the rest pose. */
export interface ArmMetrics {
  origin: THREE.Vector3;
  reach: number;
}

const scratch = new THREE.Vector3();

/**
 * Measures an arm instead of assuming proportions.
 *
 * Body proportions vary far more than they look: a stylised VRM can have an arm
 * that is 0.22 of its height where a realistic one is 0.32. Placing hand goals from
 * a hardcoded fraction puts them past the reach limit on the short-armed models,
 * and the elbow then locks straight for the whole gesture.
 */
export function measureArm(
  root: THREE.Object3D,
  upper: THREE.Object3D | null,
  lower: THREE.Object3D | null,
  hand: THREE.Object3D | null,
): ArmMetrics | null {
  if (!upper || !lower || !hand) return null;
  const reach = lower.position.length() + hand.position.length();
  if (reach < 1e-4) return null;
  const origin = root.worldToLocal(upper.getWorldPosition(scratch)).clone();
  return { origin, reach };
}

export function armBones(side: "left" | "right"): [RigBoneName, RigBoneName, RigBoneName] {
  return side === "left"
    ? ["leftUpperArm", "leftLowerArm", "leftHand"]
    : ["rightUpperArm", "rightLowerArm", "rightHand"];
}

/** Measures both arms of a rig that already has its rest pose applied. */
export function measureArms(rig: SkeletonRig): Record<"left" | "right", ArmMetrics | null> {
  rig.root.updateMatrixWorld(true);
  const result = { left: null, right: null } as Record<"left" | "right", ArmMetrics | null>;
  for (const side of ["left", "right"] as const) {
    const [upper, lower, hand] = armBones(side);
    result[side] = measureArm(rig.root, rig.getBone(upper), rig.getBone(lower), rig.getBone(hand));
  }
  return result;
}
