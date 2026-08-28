/**
 * S4: Skeletal Motion Backend
 * Implements MotionBackend using S1-S3 animation system
 */

import type { MotorPlan, MotorPrimitive } from "../contracts/motor-plan";
import type { ReactionDirective, SkeletalAnimationCommand } from "./motion-backend";
import { type Animation, ANIMATIONS, primitiveToAnimation } from "./animation";
import { AnimationPlayer } from "./animation";
import { type Pose } from "./animation";
import { Skeleton } from "./skeleton";

export interface SkeletalMotionBackendOptions {
  skeleton: Skeleton;
  animationPlayer?: AnimationPlayer;
}

/**
 * Skeletal Motion Backend: translates MotorPlan into bone-level animations
 */
export class SkeletalMotionBackend {
  readonly name = "skeletal";
  private skeleton: Skeleton;
  private player: AnimationPlayer;
  private currentPose: Pose = {};
  
  constructor(options: SkeletalMotionBackendOptions) {
    this.skeleton = options.skeleton;
    this.player = options.animationPlayer ?? new AnimationPlayer();
  }
  
  /**
   * Resolve MotorPlan into ReactionDirective
   */
  resolveMotorPlan(plan: MotorPlan): ReactionDirective | null {
    if (plan.actions.length === 0) {
      // Empty plan → idle
      const idleAnim = ANIMATIONS.idle;
      if (idleAnim) {
        this.player.play(idleAnim);
        return {
          reaction: {
            type: "skeletal",
            animations: [{ animationName: "idle", loop: true }],
          },
          durationMs: plan.durationMs || 1000,
        };
      }
      return null;
    }
    
    // Priority scan (same order as legacy backend)
    const priorityOrder: MotorPrimitive["type"][] = [
      "recoil",
      "gesture",
      "expression",
      "idleStyle",
      "turn",
      "lookAt",
      "lookAway",
      "lean",
      "step",
      "approach",
      "retreat",
      "earPose",
      "tailMotion",
    ];
    
    for (const type of priorityOrder) {
      const action = plan.actions.find((a) => a.type === type);
      if (!action) continue;
      
      const anim = primitiveToAnimation(action);
      if (!anim) continue;
      
      this.player.play(anim);
      
      const commands: SkeletalAnimationCommand[] = [{
        animationName: anim.name,
        loop: anim.loop ?? false,
      }];
      
      return {
        reaction: {
          type: "skeletal",
          animations: commands,
        },
        durationMs: plan.durationMs || anim.duration,
      };
    }
    
    return null;
  }
  
  /**
   * Update skeleton pose from animation player
   */
  update(_dt: number): void {
    this.currentPose = this.player.getCurrentPose();
    this.skeleton.applyPose(this.currentPose);
    this.skeleton.update();
  }
  
  /**
   * Get current pose (for rendering/debugging)
   */
  getCurrentPose(): Pose {
    return { ...this.currentPose };
  }
  
  /**
   * Check if animation is playing
   */
  isAnimating(): boolean {
    return this.player.isPlaying();
  }
  
  /**
   * Stop current animation
   */
  stopAnimation(): void {
    this.player.stop();
    this.skeleton.resetPose();
    this.skeleton.update();
    this.currentPose = {};
  }
  
  /**
   * Cleanup
   */
  dispose(): void {
    this.stopAnimation();
  }
}
