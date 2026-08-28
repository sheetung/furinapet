import { describe, expect, it } from "vitest";
import { SkeletalMotionBackend } from "./skeletal-motion-backend";
import { Skeleton } from "./skeleton";
import type { MotorPlan } from "../contracts/motor-plan";

describe("S4: Skeletal Motion Backend", () => {
  function makeSkeleton(): Skeleton {
    return new Skeleton({
      name: "root",
      position: [0, 0],
      children: {
        body: {
          name: "body",
          position: [0, 0],
          children: {
            head: { name: "head", position: [0, 5] },
            arm_left: { name: "arm_left", position: [-3, 2] },
            arm_right: { name: "arm_right", position: [3, 2] },
          },
        },
        tail: { name: "tail", position: [0, -3] },
      },
    });
  }

  describe("resolveMotorPlan", () => {
    it("resolves empty plan to idle", () => {
      const backend = new SkeletalMotionBackend({ skeleton: makeSkeleton() });
      const plan: MotorPlan = { actions: [], durationMs: 0, confidence: 1 };
      const result = backend.resolveMotorPlan(plan);
      expect(result).not.toBeNull();
      expect(result!.reaction).toMatchObject({ type: "skeletal" });
    });

    it("resolves recoil action", () => {
      const backend = new SkeletalMotionBackend({ skeleton: makeSkeleton() });
      const plan: MotorPlan = {
        actions: [{ type: "recoil", from: "pointer", strength: 1 }],
        durationMs: 300,
        confidence: 1,
      };
      const result = backend.resolveMotorPlan(plan);
      expect(result).not.toBeNull();
      const reaction = result!.reaction as { type: string; animations: { animationName: string }[] };
      expect(reaction.type).toBe("skeletal");
      expect(reaction.animations[0].animationName).toBe("recoil");
    });

    it("resolves lookAt action", () => {
      const backend = new SkeletalMotionBackend({ skeleton: makeSkeleton() });
      const plan: MotorPlan = {
        actions: [{ type: "lookAt", target: "pointer", weight: 1 }],
        durationMs: 400,
        confidence: 1,
      };
      const result = backend.resolveMotorPlan(plan);
      expect(result).not.toBeNull();
      const reaction = result!.reaction as { type: string; animations: { animationName: string }[] };
      expect(reaction.animations[0].animationName).toBe("lookAt");
    });

    it("resolves gesture (wave) action", () => {
      const backend = new SkeletalMotionBackend({ skeleton: makeSkeleton() });
      const plan: MotorPlan = {
        actions: [{ type: "gesture", gesture: "wave", weight: 1 }],
        durationMs: 800,
        confidence: 1,
      };
      const result = backend.resolveMotorPlan(plan);
      expect(result).not.toBeNull();
      const reaction = result!.reaction as { type: string; animations: { animationName: string }[] };
      expect(reaction.animations[0].animationName).toBe("wave");
    });

    it("priority: recoil > gesture", () => {
      const backend = new SkeletalMotionBackend({ skeleton: makeSkeleton() });
      const plan: MotorPlan = {
        actions: [
          { type: "gesture", gesture: "wave", weight: 1 },
          { type: "recoil", from: "pointer", strength: 1 },
        ],
        durationMs: 500,
        confidence: 1,
      };
      const result = backend.resolveMotorPlan(plan);
      const reaction = result!.reaction as { type: string; animations: { animationName: string }[] };
      expect(reaction.animations[0].animationName).toBe("recoil");
    });

    it("resolves earPose action", () => {
      const backend = new SkeletalMotionBackend({ skeleton: makeSkeleton() });
      const plan: MotorPlan = {
        actions: [{ type: "earPose", pose: "perked", weight: 1 }],
        durationMs: 300,
        confidence: 1,
      };
      const result = backend.resolveMotorPlan(plan);
      expect(result).not.toBeNull();
      const reaction = result!.reaction as { type: string; animations: { animationName: string }[] };
      expect(reaction.animations[0].animationName).toBe("earTwitch");
    });

    it("resolves tailMotion action", () => {
      const backend = new SkeletalMotionBackend({ skeleton: makeSkeleton() });
      const plan: MotorPlan = {
        actions: [{ type: "tailMotion", motion: "wag", weight: 1 }],
        durationMs: 600,
        confidence: 1,
      };
      const result = backend.resolveMotorPlan(plan);
      expect(result).not.toBeNull();
      const reaction = result!.reaction as { type: string; animations: { animationName: string }[] };
      expect(reaction.animations[0].animationName).toBe("tailWag");
    });
  });

  describe("update", () => {
    it("applies pose to skeleton", () => {
      const skeleton = makeSkeleton();
      const backend = new SkeletalMotionBackend({ skeleton });
      
      // Play an animation
      const plan: MotorPlan = {
        actions: [{ type: "lookAt", target: "pointer", weight: 1 }],
        durationMs: 400,
        confidence: 1,
      };
      backend.resolveMotorPlan(plan);
      
      // Update
      backend.update(0.016);
      
      // Pose should be applied
      const pose = backend.getCurrentPose();
      expect(typeof pose).toBe("object");
    });

    it("tracks animation state", () => {
      const backend = new SkeletalMotionBackend({ skeleton: makeSkeleton() });
      expect(backend.isAnimating()).toBe(false);
      
      const plan: MotorPlan = {
        actions: [{ type: "lookAt", target: "pointer", weight: 1 }],
        durationMs: 400,
        confidence: 1,
      };
      backend.resolveMotorPlan(plan);
      expect(backend.isAnimating()).toBe(true);
    });
  });

  describe("stopAnimation", () => {
    it("stops current animation and resets pose", () => {
      const skeleton = makeSkeleton();
      const backend = new SkeletalMotionBackend({ skeleton });
      
      const plan: MotorPlan = {
        actions: [{ type: "lookAt", target: "pointer", weight: 1 }],
        durationMs: 400,
        confidence: 1,
      };
      backend.resolveMotorPlan(plan);
      backend.update(0.016);
      
      backend.stopAnimation();
      expect(backend.isAnimating()).toBe(false);
      expect(backend.getCurrentPose()).toEqual({});
    });
  });

  describe("dispose", () => {
    it("cleans up resources", () => {
      const backend = new SkeletalMotionBackend({ skeleton: makeSkeleton() });
      
      const plan: MotorPlan = {
        actions: [{ type: "lookAt", target: "pointer", weight: 1 }],
        durationMs: 400,
        confidence: 1,
      };
      backend.resolveMotorPlan(plan);
      
      backend.dispose();
      expect(backend.isAnimating()).toBe(false);
    });
  });
});
