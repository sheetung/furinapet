/**
 * S4: Motion Backend Abstraction + Skeletal Backend
 * Formal interface + skeletal animation integration
 */

import type { MotorPlan } from "../contracts/motor-plan";
import type { Reaction } from "../../types";

/**
 * Reaction directive: what the motion backend outputs
 */
export interface ReactionDirective {
  reaction: Reaction | SkeletalReaction;
  durationMs: number;
}

/**
 * Skeletal reaction: bone-level animation commands
 */
export interface SkeletalReaction {
  type: "skeletal";
  animations: SkeletalAnimationCommand[];
}

export interface SkeletalAnimationCommand {
  animationName: string;
  blendWeight?: number; // 0..1, for blending multiple animations
  loop?: boolean;
}

/**
 * Motion Backend interface
 * Abstract contract for animation backends (sprite atlas vs skeletal)
 */
export interface MotionBackend {
  readonly name: string;
  
  /**
   * Translate MotorPlan into a ReactionDirective
   * Returns null if the plan cannot be handled
   */
  resolveMotorPlan(plan: MotorPlan): ReactionDirective | null;
  
  /**
   * Called every frame to update backend state
   * @param dt delta time in seconds
   */
  update(dt: number): void;
  
  /**
   * Cleanup resources
   */
  dispose(): void;
}
