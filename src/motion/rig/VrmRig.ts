import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { RigBoneName, SkeletonRig } from "../types";

/** Humanoid bones that map straight onto VRM normalized bone names. */
const HUMANOID = [
  "hips", "spine", "chest", "upperChest", "neck", "head",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
  "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot",
] as const satisfies readonly RigBoneName[];

/**
 * Name fragments used to find decorative bones, which the VRM humanoid spec does
 * not cover. Models name these inconsistently, so a miss is normal and simply
 * means the procedural layer has nothing to drive there.
 */
const EXTRA_PATTERNS: Record<string, readonly string[]> = {
  leftEar: ["ear_l", "l_ear", "earleft", "left_ear", "耳_l", "みみ_l"],
  rightEar: ["ear_r", "r_ear", "earright", "right_ear", "耳_r", "みみ_r"],
  tail1: ["tail_1", "tail1", "tail_01", "尾_1", "しっぽ_1"],
  tail2: ["tail_2", "tail2", "tail_02", "尾_2", "しっぽ_2"],
  tail3: ["tail_3", "tail3", "tail_03", "尾_3", "しっぽ_3"],
};

const headPosition = new THREE.Vector3();
const upperPosition = new THREE.Vector3();
const handPosition = new THREE.Vector3();
const restDirection = new THREE.Vector3();
const wantedDirection = new THREE.Vector3();
const rootRotation = new THREE.Quaternion();
const rootRotationInverse = new THREE.Quaternion();
const parentRotation = new THREE.Quaternion();
const correction = new THREE.Quaternion();
const conjugation = new THREE.Quaternion();
const FORWARD_AXIS = new THREE.Vector3(0, 0, 1);

/** Radians below horizontal that a relaxed arm should hang at. */
const ARM_DROP = 72 * Math.PI / 180;
/** Arms closer than this to the target are left alone. */
const ARM_DROP_TOLERANCE = 8 * Math.PI / 180;
const ELBOW_REST = 9 * Math.PI / 180;

/** ASCII "glTF", the first four bytes of every binary glTF — and so every .vrm. */
const GLB_MAGIC = 0x46546c67;

/**
 * Fetches and parses the model, checking the container before handing it to
 * three.js.
 *
 * Worth the extra step: a dev server answers a missing path with `index.html`, and
 * GLTFLoader then reports `Unexpected token '<'`, which sends you looking for a
 * corrupt model instead of a wrong path.
 */
async function parseGlb(url: string) {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error(`无法读取模型文件：${url}`);
  }
  if (!response.ok) throw new Error(`模型文件不存在或无法访问（HTTP ${response.status}）：${url}`);

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 12 || new DataView(buffer).getUint32(0, true) !== GLB_MAGIC) {
    throw new Error(`这个文件不是 VRM/GLB 模型：${url}`);
  }

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader.parseAsync(buffer, url.slice(0, url.lastIndexOf("/") + 1));
}

/**
 * Wraps a VRM so the motion pipeline can drive it.
 *
 * Two details matter for correctness. Poses are written to *normalized* bones —
 * a VRM's raw rest pose is model-specific, the normalized one is not, so the same
 * solver output works across models. And `update` is the point where three-vrm
 * runs its own humanoid → lookAt → node-constraint → spring-bone chain, which is
 * exactly the tail of the motion pipeline; nothing may write bones after it.
 */
export class VrmRig implements SkeletonRig {
  readonly root: THREE.Object3D;
  readonly height: number;
  private readonly vrm: VRM;
  private readonly bones = new Map<RigBoneName, THREE.Object3D>();
  private readonly rest = new Map<RigBoneName, THREE.Quaternion>();

  private constructor(vrm: VRM) {
    this.vrm = vrm;
    this.root = vrm.scene;

    for (const name of HUMANOID) {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (node) this.bones.set(name, node);
    }
    this.resolveExtras();

    // Captured before anything writes, so this is the model's own rest pose.
    for (const [name, node] of this.bones) this.rest.set(name, node.quaternion.clone());
    this.relaxArms();

    const head = this.bones.get("head");
    const measured = head ? head.getWorldPosition(headPosition).y * 1.09 : 1.5;
    this.height = THREE.MathUtils.clamp(measured, 0.5, 2.5);
  }

  /**
   * Lowers the rest pose of both arms to hang at the sides.
   *
   * Almost every VRM ships in a T-pose, and the rest pose is what the mixer relaxes
   * to whenever no solver claims a joint. Left as authored, the pet stands with its
   * arms straight out any time it is not actively gesturing — the single most
   * visible artefact of driving a VRM procedurally.
   *
   * The correction is the *difference* from the authored pose to the target, so a
   * model already authored in an A-pose is barely touched, and one already relaxed
   * is skipped entirely.
   */
  private relaxArms() {
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(rootRotation);
    rootRotationInverse.copy(rootRotation).invert();

    for (const side of ["left", "right"] as const) {
      const sign = side === "left" ? -1 : 1;
      const upperName = side === "left" ? "leftUpperArm" : "rightUpperArm";
      const lowerName = side === "left" ? "leftLowerArm" : "rightLowerArm";
      const upper = this.bones.get(upperName);
      const hand = this.bones.get(side === "left" ? "leftHand" : "rightHand");
      const restUpper = this.rest.get(upperName);
      if (!upper || !hand || !restUpper || !upper.parent) continue;

      restDirection.copy(this.root.worldToLocal(hand.getWorldPosition(handPosition)))
        .sub(this.root.worldToLocal(upper.getWorldPosition(upperPosition)));
      if (restDirection.lengthSq() < 1e-8) continue;
      restDirection.normalize();

      wantedDirection.set(sign * Math.cos(ARM_DROP), -Math.sin(ARM_DROP), 0.06).normalize();
      if (restDirection.angleTo(wantedDirection) < ARM_DROP_TOLERANCE) continue;

      correction.setFromUnitVectors(restDirection, wantedDirection);
      upper.parent.getWorldQuaternion(parentRotation).premultiply(rootRotationInverse);
      // Express the root-space correction in the bone's own parent frame.
      conjugation.copy(parentRotation).invert().multiply(correction).multiply(parentRotation);
      restUpper.premultiply(conjugation).normalize();
      upper.quaternion.copy(restUpper);

      const restLower = this.rest.get(lowerName);
      const lower = this.bones.get(lowerName);
      if (restLower && lower) {
        correction.setFromAxisAngle(FORWARD_AXIS, sign * -ELBOW_REST);
        restLower.multiply(correction).normalize();
        lower.quaternion.copy(restLower);
      }
      this.root.updateMatrixWorld(true);
    }
  }

  static async load(url: string): Promise<VrmRig> {
    const gltf = await parseGlb(url);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error("这个 GLB 文件没有 VRM 扩展，无法作为角色骨骼使用。");

    // Both calls are load-time only and cut per-frame cost substantially.
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.combineMorphs(vrm);
    // VRM 0.0 faces -Z; the rest of the pipeline assumes +Z forward.
    VRMUtils.rotateVRM0(vrm);
    // A desktop pet is always fully on screen, and culling a skinned mesh whose
    // bounds move every frame costs more than it saves.
    vrm.scene.traverse((object) => { object.frustumCulled = false; });

    return new VrmRig(vrm);
  }

  getBone(name: RigBoneName): THREE.Object3D | null {
    return this.bones.get(name) ?? null;
  }

  restQuaternion(name: RigBoneName): THREE.Quaternion | null {
    return this.rest.get(name) ?? null;
  }

  update(delta: number) {
    this.vrm.update(delta);
  }

  /** Drives the eye bones or eye expressions only; the head is ours to aim. */
  setEyeTarget(target: THREE.Object3D | null) {
    if (this.vrm.lookAt) this.vrm.lookAt.target = target;
  }

  /** Names of the decorative bones that were actually found. */
  get extras(): RigBoneName[] {
    return Object.keys(EXTRA_PATTERNS).filter((name) => this.bones.has(name as RigBoneName)) as RigBoneName[];
  }

  dispose() {
    VRMUtils.deepDispose(this.vrm.scene);
    this.bones.clear();
    this.rest.clear();
  }

  private resolveExtras() {
    const candidates: THREE.Object3D[] = [];
    this.vrm.scene.traverse((object) => { if (object.name) candidates.push(object); });

    for (const [bone, patterns] of Object.entries(EXTRA_PATTERNS)) {
      const match = candidates.find((object) => {
        const name = object.name.toLowerCase();
        return patterns.some((pattern) => name.includes(pattern));
      });
      if (match) this.bones.set(bone as RigBoneName, match);
    }
  }
}
