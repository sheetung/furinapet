import * as THREE from "three";
import type { RigBoneName, SkeletonRig } from "../types";

interface BoneSpec {
  name: RigBoneName;
  parent: RigBoneName | null;
  offset: [number, number, number];
  /** Rest orientation as YXZ Euler radians. Omitted means identity. */
  restEuler?: [number, number, number];
  /** Radius of the capsule drawn from this bone to its primary child. */
  thickness?: number;
  /** Visual extent for a leaf bone, which has no child offset to draw along. */
  tip?: [number, number, number];
}
const ARM_DROP = 72 * Math.PI / 180;
const ELBOW_REST = 9 * Math.PI / 180;

/**
 * Skeleton in metres, +Z forward, +Y up — the same convention as a VRM normalized
 * humanoid, so both rigs accept identical solver output.
 *
 * Bone *offsets* describe a T-pose, matching how VRM normalized bones are laid
 * out. The arms then carry a rest rotation that drops them to the sides, because a
 * fallback rig standing in a literal T-pose reads as a placeholder rather than a
 * character. Solvers never assume an identity rest orientation, so this is free.
 */
const SKELETON: readonly BoneSpec[] = [
  { name: "hips", parent: null, offset: [0, 0.78, 0], thickness: 0.075 },
  { name: "spine", parent: "hips", offset: [0, 0.085, 0], thickness: 0.075 },
  { name: "chest", parent: "spine", offset: [0, 0.105, 0], thickness: 0.08 },
  { name: "upperChest", parent: "chest", offset: [0, 0.095, 0], thickness: 0.075 },
  { name: "neck", parent: "upperChest", offset: [0, 0.09, 0], thickness: 0.032 },
  { name: "head", parent: "neck", offset: [0, 0.065, 0] },

  { name: "leftShoulder", parent: "upperChest", offset: [-0.045, 0.055, 0], thickness: 0.035 },
  { name: "leftUpperArm", parent: "leftShoulder", offset: [-0.075, 0, 0], restEuler: [0, 0, ARM_DROP], thickness: 0.033 },
  { name: "leftLowerArm", parent: "leftUpperArm", offset: [-0.235, 0, 0], restEuler: [0, 0, ELBOW_REST], thickness: 0.027 },
  { name: "leftHand", parent: "leftLowerArm", offset: [-0.215, 0, 0], thickness: 0.026, tip: [-0.075, 0, 0] },
  { name: "rightShoulder", parent: "upperChest", offset: [0.045, 0.055, 0], thickness: 0.035 },
  { name: "rightUpperArm", parent: "rightShoulder", offset: [0.075, 0, 0], restEuler: [0, 0, -ARM_DROP], thickness: 0.033 },
  { name: "rightLowerArm", parent: "rightUpperArm", offset: [0.235, 0, 0], restEuler: [0, 0, -ELBOW_REST], thickness: 0.027 },
  { name: "rightHand", parent: "rightLowerArm", offset: [0.215, 0, 0], thickness: 0.026, tip: [0.075, 0, 0] },

  { name: "leftUpperLeg", parent: "hips", offset: [-0.075, -0.04, 0], thickness: 0.042 },
  { name: "leftLowerLeg", parent: "leftUpperLeg", offset: [0, -0.34, 0], thickness: 0.035 },
  { name: "leftFoot", parent: "leftLowerLeg", offset: [0, -0.36, 0], thickness: 0.03, tip: [0, -0.02, 0.09] },
  { name: "rightUpperLeg", parent: "hips", offset: [0.075, -0.04, 0], thickness: 0.042 },
  { name: "rightLowerLeg", parent: "rightUpperLeg", offset: [0, -0.34, 0], thickness: 0.035 },
  { name: "rightFoot", parent: "rightLowerLeg", offset: [0, -0.36, 0], thickness: 0.03, tip: [0, -0.02, 0.09] },

  { name: "leftEar", parent: "head", offset: [-0.075, 0.105, 0], thickness: 0.018, tip: [-0.03, 0.1, -0.01] },
  { name: "rightEar", parent: "head", offset: [0.075, 0.105, 0], thickness: 0.018, tip: [0.03, 0.1, -0.01] },
  { name: "tail1", parent: "hips", offset: [0, -0.02, -0.075], thickness: 0.03 },
  { name: "tail2", parent: "tail1", offset: [0, -0.03, -0.14], thickness: 0.024 },
  { name: "tail3", parent: "tail2", offset: [0, -0.05, -0.13], thickness: 0.018, tip: [0, -0.05, -0.1] },
];

const CHILD_OF = new Map<RigBoneName, BoneSpec>();
for (const spec of SKELETON) {
  if (spec.parent && !CHILD_OF.has(spec.parent)) CHILD_OF.set(spec.parent, spec);
}

const SKIN_COLOR = 0xf3f7ff;
const CLOTH_COLOR = 0x8fbdf0;
const ACCENT_COLOR = 0x4c6fa5;

export interface PrimitiveRigOptions {
  /** Skip mesh creation. Tests only need the bone hierarchy. */
  visual?: boolean;
}

/**
 * An asset-free stand-in rig.
 *
 * It exists for two reasons: the motion pipeline is testable in Node without a
 * model file, and the app has something to show before the user supplies a VRM —
 * a character model cannot be shipped in this repository for licensing reasons.
 * Because it uses the same bone names, offsets and identity rest rotations as a
 * VRM normalized humanoid, solver output is interchangeable between the two.
 */
export class PrimitiveRig implements SkeletonRig {
  readonly root = new THREE.Object3D();
  readonly height = 1.5;
  private readonly bones = new Map<RigBoneName, THREE.Object3D>();
  private readonly rest = new Map<RigBoneName, THREE.Quaternion>();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(options: PrimitiveRigOptions = {}) {
    this.root.name = "primitive-rig";
    for (const spec of SKELETON) {
      const bone = new THREE.Object3D();
      bone.name = spec.name;
      bone.position.set(...spec.offset);
      if (spec.restEuler) bone.rotation.set(...spec.restEuler, "YXZ");
      const parent = spec.parent ? this.bones.get(spec.parent) : undefined;
      (parent ?? this.root).add(bone);
      this.bones.set(spec.name, bone);
      this.rest.set(spec.name, bone.quaternion.clone());
    }
    if (options.visual !== false) this.buildVisual();
    this.root.updateMatrixWorld(true);
  }

  getBone(name: RigBoneName): THREE.Object3D | null {
    return this.bones.get(name) ?? null;
  }

  restQuaternion(name: RigBoneName): THREE.Quaternion | null {
    return this.rest.get(name) ?? null;
  }

  update() {
    this.root.updateMatrixWorld(true);
  }
  dispose() {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.root.clear();
    this.bones.clear();
    this.rest.clear();
  }

  private material(color: number): THREE.Material {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
    this.disposables.push(material);
    return material;
  }

  private buildVisual() {
    const cloth = this.material(CLOTH_COLOR);
    const skin = this.material(SKIN_COLOR);
    const accent = this.material(ACCENT_COLOR);

    for (const spec of SKELETON) {
      const bone = this.bones.get(spec.name)!;
      const extent = spec.tip ?? CHILD_OF.get(spec.name)?.offset;
      if (!spec.thickness || !extent) continue;
      const direction = new THREE.Vector3(...extent);
      const length = direction.length();
      if (length < 1e-4) continue;

      const geometry = new THREE.CapsuleGeometry(spec.thickness, length, 4, 8);
      this.disposables.push(geometry);
      const limb = new THREE.Mesh(geometry, spec.name.includes("Ear") || spec.name.startsWith("tail") ? accent : cloth);
      // Capsules are built along +Y; aim it down the bone and centre it.
      limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
      limb.position.copy(direction).multiplyScalar(0.5);
      bone.add(limb);
    }

    const headGeometry = new THREE.SphereGeometry(0.098, 20, 14);
    this.disposables.push(headGeometry);
    const head = new THREE.Mesh(headGeometry, skin);
    head.position.set(0, 0.085, 0);
    this.bones.get("head")!.add(head);

    // A nose marks the facing direction, which is otherwise invisible on a sphere.
    const noseGeometry = new THREE.ConeGeometry(0.022, 0.05, 10);
    this.disposables.push(noseGeometry);
    const nose = new THREE.Mesh(noseGeometry, accent);
    nose.position.set(0, 0.08, 0.095);
    nose.rotation.x = Math.PI / 2;
    this.bones.get("head")!.add(nose);
  }
}

