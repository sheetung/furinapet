/**
 * 2D Skeletal Animation System - S1 MVP
 *
 * Custom bone hierarchy for 2D characters rendered with Three.js.
 * Each bone has position/rotation/scale and can hold a 2D mesh (PlaneGeometry).
 * Bones form a tree: parent transforms propagate to children.
 */

import * as THREE from "three";

/** Configuration for a bone (serializable, can be loaded from JSON) */
export interface BoneConfig {
  name: string;
  position: [number, number]; // local position relative to parent
  rotation?: number; // initial rotation in radians
  scale?: [number, number]; // local scale
  anchor?: [number, number]; // pivot point offset for rotation
  children?: Record<string, BoneConfig>;
  mesh?: {
    texture: string; // texture path
    width: number;
    height: number;
  };
}

/** Runtime bone with Three.js mesh */
export class Bone {
  readonly name: string;
  readonly anchor: THREE.Vector2;
  readonly children: Bone[] = [];
  readonly meshConfig?: { texture: string; width: number; height: number };

  position: THREE.Vector2;
  rotation: number;
  scale: THREE.Vector2;

  // Computed world transform (updated by Skeleton.update())
  worldPosition = new THREE.Vector2();
  worldRotation = 0;
  worldScale = new THREE.Vector2(1, 1);

  // Three.js mesh (created by SkeletonRenderer)
  threeMesh?: THREE.Mesh;

  constructor(config: BoneConfig) {
    this.name = config.name;
    this.position = new THREE.Vector2(config.position[0], config.position[1]);
    this.rotation = config.rotation ?? 0;
    this.scale = new THREE.Vector2(config.scale?.[0] ?? 1, config.scale?.[1] ?? 1);
    this.anchor = new THREE.Vector2(config.anchor?.[0] ?? 0, config.anchor?.[1] ?? 0);
    this.meshConfig = config.mesh;

    if (config.children) {
      for (const childConfig of Object.values(config.children)) {
        this.children.push(new Bone(childConfig));
      }
    }
  }

  /** Recursively collect all bones into a flat list */
  flatten(): Bone[] {
    const result = [this];
    for (const child of this.children) {
      result.push(...child.flatten());
    }
    return result;
  }

  /** Find bone by name (depth-first search) */
  findBone(name: string): Bone | null {
    if (this.name === name) return this;
    for (const child of this.children) {
      const found = child.findBone(name);
      if (found) return found;
    }
    return null;
  }
}

/** Skeleton: a tree of bones with transform propagation */
export class Skeleton {
  readonly root: Bone;
  private bones: Map<string, Bone> = new Map();

  constructor(config: BoneConfig) {
    this.root = new Bone(config);
    for (const bone of this.root.flatten()) {
      this.bones.set(bone.name, bone);
    }
  }

  /** Get bone by name */
  getBone(name: string): Bone | null {
    return this.bones.get(name) ?? null;
  }

  /** Get all bones as a flat list */
  getAllBones(): Bone[] {
    return Array.from(this.bones.values());
  }

  /** Update world transforms for all bones (call every frame) */
  update(): void {
    this.updateBone(this.root, new THREE.Vector2(), 0, new THREE.Vector2(1, 1));
  }

  private updateBone(
    bone: Bone,
    parentPos: THREE.Vector2,
    parentRot: number,
    parentScale: THREE.Vector2,
  ): void {
    // Compute world transform
    const cos = Math.cos(parentRot);
    const sin = Math.sin(parentRot);

    // Rotate local position by parent rotation, then scale
    const localX = bone.position.x * parentScale.x;
    const localY = bone.position.y * parentScale.y;

    bone.worldPosition.set(
      parentPos.x + localX * cos - localY * sin,
      parentPos.y + localX * sin + localY * cos,
    );
    bone.worldRotation = parentRot + bone.rotation;
    bone.worldScale.set(parentScale.x * bone.scale.x, parentScale.y * bone.scale.y);

    // Recurse to children
    for (const child of bone.children) {
      this.updateBone(child, bone.worldPosition, bone.worldRotation, bone.worldScale);
    }
  }

  /** Apply a pose (map of bone name → target rotation) */
  applyPose(pose: Record<string, number>): void {
    for (const [boneName, rotation] of Object.entries(pose)) {
      const bone = this.getBone(boneName);
      if (bone) {
        bone.rotation = rotation;
      }
    }
  }

  /** Reset all bones to rest pose (rotation = 0) */
  resetPose(): void {
    for (const bone of this.bones.values()) {
      bone.rotation = 0;
    }
  }
}
