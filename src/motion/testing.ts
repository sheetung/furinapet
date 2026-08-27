import * as THREE from "three";
import type { PoseSink, RigBoneName, SkeletonRig } from "./types";

/** Captures solver output without touching a skeleton. */
export class RecordingSink implements PoseSink {
  readonly rotations = new Map<RigBoneName, { quaternion: THREE.Quaternion; weight: number }[]>();
  readonly offsets = new Map<RigBoneName, { offset: THREE.Vector3; weight: number }[]>();

  add(bone: RigBoneName, local: THREE.Quaternion, weight: number) {
    const list = this.rotations.get(bone) ?? [];
    list.push({ quaternion: local.clone(), weight });
    this.rotations.set(bone, list);
  }

  addOffset(bone: RigBoneName, offset: THREE.Vector3, weight: number) {
    const list = this.offsets.get(bone) ?? [];
    list.push({ offset: offset.clone(), weight });
    this.offsets.set(bone, list);
  }

  first(bone: RigBoneName): THREE.Quaternion | null {
    return this.rotations.get(bone)?.[0]?.quaternion ?? null;
  }

  clear() {
    this.rotations.clear();
    this.offsets.clear();
  }
}

/** Writes recorded rotations straight onto the rig, bypassing the mixer's spring. */
export function applyRecorded(rig: SkeletonRig, sink: RecordingSink) {
  for (const [bone, list] of sink.rotations) {
    const node = rig.getBone(bone);
    if (node && list[0]) node.quaternion.copy(list[0].quaternion);
  }
  rig.root.updateMatrixWorld(true);
}

/** World position of a bone expressed in rig-root space. */
export function boneInRootSpace(rig: SkeletonRig, bone: RigBoneName): THREE.Vector3 {
  const node = rig.getBone(bone);
  if (!node) throw new Error(`missing bone ${bone}`);
  const position = node.getWorldPosition(new THREE.Vector3());
  return rig.root.worldToLocal(position);
}
