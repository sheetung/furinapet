/**
 * Motion Backend Manager
 *
 * Manages dual backend system: Legacy (sprite atlas) vs Skeletal (bone animation)
 * Allows runtime switching between backends for gradual migration.
 */

import type { MotorPlan } from "../contracts/motor-plan";
import type { ReactionDirective, SkeletalReaction } from "./motion-backend";
import { reactionForMotorPlan as legacyResolve } from "./legacy-sprite-backend";
import { SkeletalMotionBackend } from "./skeletal-motion-backend";
import { Skeleton } from "./skeleton";
import type { BoneConfig } from "./skeleton";
import type { Reaction } from "../../types";

export type BackendType = "legacy" | "skeletal";

export interface BackendConfig {
  type: BackendType;
  skeleton?: BoneConfig; // Required for skeletal backend
}

let currentBackendType: BackendType = "legacy";
let skeletalBackend: SkeletalMotionBackend | null = null;

/**
 * Set the active motion backend type
 */
export function setMotionBackend(type: BackendType, skeleton?: BoneConfig): void {
  currentBackendType = type;
  
  if (type === "skeletal" && skeleton) {
    if (skeletalBackend) {
      skeletalBackend.dispose();
    }
    const skel = new Skeleton(skeleton);
    skeletalBackend = new SkeletalMotionBackend({ skeleton: skel });
  } else if (type === "legacy") {
    if (skeletalBackend) {
      skeletalBackend.dispose();
      skeletalBackend = null;
    }
  }
}

/**
 * Get current backend type
 */
export function getMotionBackendType(): BackendType {
  return currentBackendType;
}

/**
 * Resolve MotorPlan using the active backend
 * Returns ReactionDirective compatible with both backends
 */
export function resolveMotorPlan(plan: MotorPlan, fallbackDurationMs?: number): ReactionDirective | null {
  if (currentBackendType === "skeletal" && skeletalBackend) {
    return skeletalBackend.resolveMotorPlan(plan);
  }
  
  // Legacy backend
  const legacyDirective = legacyResolve(plan, fallbackDurationMs);
  if (!legacyDirective) return null;
  
  return {
    reaction: legacyDirective.reaction,
    durationMs: legacyDirective.durationMs,
  };
}

/**
 * Update the active backend (call every frame)
 */
export function updateMotionBackend(dt: number): void {
  if (currentBackendType === "skeletal" && skeletalBackend) {
    skeletalBackend.update(dt);
  }
}

/**
 * Get skeletal backend instance (for rendering)
 */
export function getSkeletalBackend(): SkeletalMotionBackend | null {
  return skeletalBackend;
}

/**
 * Cleanup all backends
 */
export function disposeMotionBackends(): void {
  if (skeletalBackend) {
    skeletalBackend.dispose();
    skeletalBackend = null;
  }
}

/**
 * Check if a reaction is a legacy string reaction (vs skeletal object)
 */
export function isLegacyReaction(reaction: ReactionDirective["reaction"]): reaction is Reaction {
  return typeof reaction === "string";
}

/**
 * Get legacy reaction string for trace compatibility
 * Returns null if the reaction is skeletal (not a string)
 */
export function getLegacyReactionForTrace(reaction: ReactionDirective["reaction"]): Reaction | null {
  return isLegacyReaction(reaction) ? reaction : null;
}
