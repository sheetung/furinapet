import { describe, expect, it } from "vitest";
import {
  type Animation,
  AnimationPlayer,
  applyConstraints,
  type ConstraintMap,
  easings,
  FURINA_CONSTRAINTS,
  lerpPose,
  primitiveToAnimation,
  sampleAnimation,
} from "./animation";

describe("S2: Animation System", () => {
  describe("easings", () => {
    it("linear at 0.5 returns 0.5", () => {
      expect(easings.linear(0.5)).toBe(0.5);
    });

    it("easeIn at 0 returns 0, at 1 returns 1", () => {
      expect(easings.easeIn(0)).toBe(0);
      expect(easings.easeIn(1)).toBe(1);
    });

    it("easeOut at 0 returns 0, at 1 returns 1", () => {
      expect(easings.easeOut(0)).toBe(0);
      expect(easings.easeOut(1)).toBe(1);
    });

    it("easeInOut at 0 returns 0, at 1 returns 1", () => {
      expect(easings.easeInOut(0)).toBe(0);
      expect(easings.easeInOut(1)).toBe(1);
    });
  });

  describe("lerpPose", () => {
    it("interpolates between two poses at t=0.5", () => {
      const a = { head: 0, arm_left: 0 };
      const b = { head: 1, arm_left: 0.5 };
      const result = lerpPose(a, b, 0.5);
      expect(result.head).toBeCloseTo(0.5);
      expect(result.arm_left).toBeCloseTo(0.25);
    });

    it("returns pose a at t=0", () => {
      const a = { head: 0.3 };
      const b = { head: 0.8 };
      const result = lerpPose(a, b, 0);
      expect(result.head).toBeCloseTo(0.3);
    });

    it("returns pose b at t=1", () => {
      const a = { head: 0.3 };
      const b = { head: 0.8 };
      const result = lerpPose(a, b, 1);
      expect(result.head).toBeCloseTo(0.8);
    });

    it("handles missing bones (defaults to 0)", () => {
      const a = { head: 0.5 };
      const b = { arm_left: 1.0 };
      const result = lerpPose(a, b, 0.5);
      expect(result.head).toBeCloseTo(0.25);
      expect(result.arm_left).toBeCloseTo(0.5);
    });

    it("applies easing function", () => {
      const a = { head: 0 };
      const b = { head: 1 };
      const result = lerpPose(a, b, 0.5, "easeIn");
      expect(result.head).toBeCloseTo(0.25); // 0.5^2 = 0.25
    });
  });

  describe("sampleAnimation", () => {
    const anim: Animation = {
      name: "test",
      duration: 1000,
      keyframes: [
        { time: 0, pose: { head: 0 } },
        { time: 500, pose: { head: 0.5 }, easing: "linear" },
        { time: 1000, pose: { head: 0 }, easing: "linear" },
      ],
    };

    it("returns first keyframe at t=0", () => {
      const pose = sampleAnimation(anim, 0);
      expect(pose.head).toBeCloseTo(0);
    });

    it("interpolates at midpoint between keyframes", () => {
      const pose = sampleAnimation(anim, 250);
      expect(pose.head).toBeCloseTo(0.25);
    });

    it("returns middle keyframe at t=500", () => {
      const pose = sampleAnimation(anim, 500);
      expect(pose.head).toBeCloseTo(0.5);
    });

    it("interpolates second segment", () => {
      const pose = sampleAnimation(anim, 750);
      expect(pose.head).toBeCloseTo(0.25);
    });

    it("clamps to end time for non-looping", () => {
      const pose = sampleAnimation(anim, 2000);
      expect(pose.head).toBeCloseTo(0);
    });

    it("wraps time for looping animation", () => {
      const looping = { ...anim, loop: true };
      const pose = sampleAnimation(looping, 1500);
      expect(pose.head).toBeCloseTo(0.5); // 1500 % 1000 = 500, at middle keyframe
    });
  });

  describe("applyConstraints", () => {
    it("clamps rotation to min/max", () => {
      const pose = { head: 1.5 };
      const constraints: ConstraintMap = { head: { min: -0.5, max: 0.5 } };
      const result = applyConstraints(pose, constraints);
      expect(result.head).toBe(0.5);
    });

    it("clamps negative rotation", () => {
      const pose = { head: -1.5 };
      const constraints: ConstraintMap = { head: { min: -0.5, max: 0.5 } };
      const result = applyConstraints(pose, constraints);
      expect(result.head).toBe(-0.5);
    });

    it("leaves unconstrained bones unchanged", () => {
      const pose = { head: 1.5, arm_left: 2.0 };
      const constraints: ConstraintMap = { head: { min: -0.5, max: 0.5 } };
      const result = applyConstraints(pose, constraints);
      expect(result.head).toBe(0.5);
      expect(result.arm_left).toBe(2.0);
    });

    it("handles missing bones in pose", () => {
      const pose = { head: 0.3 };
      const constraints: ConstraintMap = { arm_left: { min: -1, max: 1 } };
      const result = applyConstraints(pose, constraints);
      expect(result.head).toBe(0.3);
    });
  });

  describe("FURINA_CONSTRAINTS", () => {
    it("defines constraints for all major bones", () => {
      expect(FURINA_CONSTRAINTS.head).toBeDefined();
      expect(FURINA_CONSTRAINTS.body).toBeDefined();
      expect(FURINA_CONSTRAINTS.arm_left).toBeDefined();
      expect(FURINA_CONSTRAINTS.arm_right).toBeDefined();
      expect(FURINA_CONSTRAINTS.leg_left).toBeDefined();
      expect(FURINA_CONSTRAINTS.leg_right).toBeDefined();
      expect(FURINA_CONSTRAINTS.ear_left).toBeDefined();
      expect(FURINA_CONSTRAINTS.ear_right).toBeDefined();
      expect(FURINA_CONSTRAINTS.tail).toBeDefined();
    });

    it("head constraints are reasonable (±28°)", () => {
      expect(FURINA_CONSTRAINTS.head?.min).toBeCloseTo(-0.5, 1);
      expect(FURINA_CONSTRAINTS.head?.max).toBeCloseTo(0.5, 1);
    });
  });

  describe("primitiveToAnimation", () => {
    it("maps lookAt primitive to lookAt animation", () => {
      const anim = primitiveToAnimation({ type: "lookAt", target: "pointer", weight: 1 });
      expect(anim?.name).toBe("lookAt");
    });

    it("maps idleStyle primitive to idle animation", () => {
      const anim = primitiveToAnimation({ type: "idleStyle", style: "normal", weight: 1 });
      expect(anim?.name).toBe("idle");
    });

    it("maps step primitive to step animation", () => {
      const anim = primitiveToAnimation({ type: "step", direction: "left", distance: 10 });
      expect(anim?.name).toBe("step");
    });

    it("maps earPose primitive to earTwitch animation", () => {
      const anim = primitiveToAnimation({ type: "earPose", pose: "perked", weight: 1 });
      expect(anim?.name).toBe("earTwitch");
    });

    it("maps tailMotion primitive to tailWag animation", () => {
      const anim = primitiveToAnimation({ type: "tailMotion", motion: "wag", weight: 1 });
      expect(anim?.name).toBe("tailWag");
    });
  });

  describe("AnimationPlayer", () => {
    it("starts with no animation", () => {
      const player = new AnimationPlayer();
      expect(player.isPlaying()).toBe(false);
      expect(player.getCurrentPose()).toEqual({});
    });

    it("plays animation and returns pose", () => {
      const player = new AnimationPlayer();
      const anim: Animation = {
        name: "test",
        duration: 1000,
        keyframes: [
          { time: 0, pose: { head: 0 } },
          { time: 1000, pose: { head: 1 } },
        ],
      };
      
      player.play(anim);
      expect(player.isPlaying()).toBe(true);
      
      const pose = player.getCurrentPose();
      expect(pose.head).toBeDefined();
    });

    it("applies constraints to pose", () => {
      const player = new AnimationPlayer(FURINA_CONSTRAINTS);
      const anim: Animation = {
        name: "test",
        duration: 100,
        keyframes: [
          { time: 0, pose: { head: 0 } },
          { time: 100, pose: { head: 2.0 } }, // exceeds constraint
        ],
      };
      
      player.play(anim);
      const pose = player.getCurrentPose();
      expect(pose.head).toBeLessThanOrEqual(0.5);
    });

    it("stops animation", () => {
      const player = new AnimationPlayer();
      const anim: Animation = {
        name: "test",
        duration: 1000,
        keyframes: [{ time: 0, pose: {} }],
      };
      
      player.play(anim);
      expect(player.isPlaying()).toBe(true);
      
      player.stop();
      expect(player.isPlaying()).toBe(false);
    });
  });
});
