import type * as THREE from "three";

/**
 * Canonical bone names for the motion layer. The humanoid subset matches VRM 1.0
 * humanoid bone names so a VRM rig maps 1:1; the trailing entries are optional
 * decorative bones resolved by node name when the model provides them.
 */
export type RigBoneName =
  | "hips" | "spine" | "chest" | "upperChest" | "neck" | "head"
  | "leftShoulder" | "leftUpperArm" | "leftLowerArm" | "leftHand"
  | "rightShoulder" | "rightUpperArm" | "rightLowerArm" | "rightHand"
  | "leftUpperLeg" | "leftLowerLeg" | "leftFoot"
  | "rightUpperLeg" | "rightLowerLeg" | "rightFoot"
  | "leftEar" | "rightEar"
  | "tail1" | "tail2" | "tail3";

export const AIM_CHAIN: readonly RigBoneName[] = ["chest", "neck", "head"];
export const ARM_CHAINS = {
  left: ["leftUpperArm", "leftLowerArm", "leftHand"],
  right: ["rightUpperArm", "rightLowerArm", "rightHand"],
} as const satisfies Record<"left" | "right", readonly [RigBoneName, RigBoneName, RigBoneName]>;
export const LEG_CHAINS = {
  left: ["leftUpperLeg", "leftLowerLeg", "leftFoot"],
  right: ["rightUpperLeg", "rightLowerLeg", "rightFoot"],
} as const satisfies Record<"left" | "right", readonly [RigBoneName, RigBoneName, RigBoneName]>;

/** Per-joint constraint and spring parameters. Angles are radians. */
export interface JointLimit {
  /** Maximum swing away from the rest orientation. */
  maxSwing: number;
  /** Spring stiffness in rad/s^2 per rad of error. */
  stiffness: number;
  /** Viscous damping. `2 * sqrt(stiffness)` is critical. */
  damping: number;
}

export type JointLimits = Partial<Record<RigBoneName, JointLimit>>;

/**
 * The discrete side of the boundary: what the Brain decided. Produced by
 * `pet-brain/adapters/motion.ts`, never by a solver.
 */
export interface MotionIntent {
  /** Semantic label used for logging and for picking a Cerebellum routine. */
  kind: "idle" | "greet" | "cheer" | "observe" | "slump" | "locomote";
  /** 0..1 arousal. Drives amplitude and speed, not bone angles. */
  intensity: number;
  /** Wall-clock ms the routine should stay active. 0 means "until replaced". */
  durationMs: number;
  /** Monotonic id so the Cerebellum can detect a genuinely new intent. */
  id: number;
}

/** Continuous, per-step motion request. The only thing solvers are allowed to read. */
export interface MotionTarget {
  /** Where the character wants to look, in rig-local space. */
  gaze: THREE.Vector3;
  /** 0..1 blend for the aim chain. 0 leaves the head on its rest pose. */
  gazeWeight: number;
  /** Rig-local IK goals for the hands, with their own blend weights. */
  hands: {
    left: { target: THREE.Vector3; pole: THREE.Vector3; weight: number };
    right: { target: THREE.Vector3; pole: THREE.Vector3; weight: number };
  };
  /** Breathing rate in Hz and chest amplitude in radians. */
  breathHz: number;
  breathAmount: number;
  /** Lateral weight shift, -1 (left) .. 1 (right). */
  weightShift: number;
  /** Vertical bob in metres, applied to the hips. */
  bob: number;
  /** Extra sway fed to the decorative bones. 0..1. */
  liveliness: number;
  /** Postural droop, 0..1. Used by `slump`/`rest`. */
  droop: number;
}

/**
 * A skeleton the motion layer can drive. `VrmRig` wraps @pixiv/three-vrm;
 * `PrimitiveRig` is an asset-free stand-in used by tests and by the first run
 * before the user supplies a model.
 */
export interface SkeletonRig {
  readonly root: THREE.Object3D;
  /** Approximate height in metres, used to scale IK goals and the camera. */
  readonly height: number;
  getBone(name: RigBoneName): THREE.Object3D | null;
  /** Local-space orientation captured when the rig was created. */
  restQuaternion(name: RigBoneName): THREE.Quaternion | null;
  /** Commit the written local transforms down to the render skeleton. */
  update(delta: number): void;
  /** Optional continuous eye gaze, if the rig has an eye rig. */
  setEyeTarget?(target: THREE.Object3D | null): void;
  dispose(): void;
}

/** Where solvers write. Implemented by `JointMixer`. */
export interface PoseSink {
  add(bone: RigBoneName, local: THREE.Quaternion, weight: number): void;
  addOffset(bone: RigBoneName, offset: THREE.Vector3, weight: number): void;
}
