import { describe, expect, it } from "vitest";
import { Bone, Skeleton } from "./skeleton";
import {
  applyLookAtIK,
  applyTwoBoneIK,
  type BlinkState,
  getExpressionTexture,
  initBlinkState,
  solveLookAt,
  solveTwoBoneIK,
  SPRING_CONFIGS,
  updateBlink,
  updateSpring,
} from "./advanced-animation";

describe("S3: Advanced Animation", () => {
  describe("Two-bone IK", () => {
    it("solves reachable target", () => {
      const result = solveTwoBoneIK(
        { upper: "arm", lower: "forearm", upperLength: 5, lowerLength: 5, bendDirection: 1 },
        8,
        0,
      );
      expect(result).not.toBeNull();
      expect(result!.upperAngle).toBeDefined();
      expect(result!.lowerAngle).toBeDefined();
    });

    it("returns null for unreachable target (too far)", () => {
      const result = solveTwoBoneIK(
        { upper: "arm", lower: "forearm", upperLength: 5, lowerLength: 5, bendDirection: 1 },
        20,
        0,
      );
      expect(result).toBeNull();
    });

    it("returns null for unreachable target (too close)", () => {
      const result = solveTwoBoneIK(
        { upper: "arm", lower: "forearm", upperLength: 5, lowerLength: 5, bendDirection: 1 },
        0,
        0,
      );
      expect(result).toBeNull();
    });

    it("applies IK to skeleton", () => {
      const skeleton = new Skeleton({
        name: "root",
        position: [0, 0],
        children: {
          arm: {
            name: "arm",
            position: [0, 0],
            children: {
              forearm: { name: "forearm", position: [5, 0] },
            },
          },
        },
      });

      const success = applyTwoBoneIK(
        skeleton,
        { upper: "arm", lower: "forearm", upperLength: 5, lowerLength: 5, bendDirection: 1 },
        8,
        0,
      );

      expect(success).toBe(true);
      const arm = skeleton.getBone("arm");
      const forearm = skeleton.getBone("forearm");
      expect(arm?.rotation).toBeDefined();
      expect(forearm?.rotation).toBeDefined();
    });

    it("returns false when bone not found", () => {
      const skeleton = new Skeleton({ name: "root", position: [0, 0] });

      const success = applyTwoBoneIK(
        skeleton,
        { upper: "arm", lower: "forearm", upperLength: 5, lowerLength: 5, bendDirection: 1 },
        8,
        0,
      );

      expect(success).toBe(false);
    });
  });

  describe("Look-at IK", () => {
    it("computes rotation toward target", () => {
      const result = solveLookAt(
        { bone: "head", maxAngle: 1.0, speed: 1.0 },
        0,
        0,
        1,
        1,
        0,
      );
      expect(result).toBeCloseTo(Math.PI / 4, 1); // 45° toward (1,1)
    });

    it("clamps to max angle", () => {
      const result = solveLookAt(
        { bone: "head", maxAngle: 0.3, speed: 1.0 },
        0,
        0,
        1,
        1,
        0,
      );
      expect(Math.abs(result)).toBeLessThanOrEqual(0.3);
    });

    it("applies speed for smooth following", () => {
      const result = solveLookAt(
        { bone: "head", maxAngle: 1.0, speed: 0.5 },
        0,
        0,
        1,
        0,
        0,
      );
      expect(result).toBeCloseTo(0, 1); // 50% toward target
    });

    it("applies look-at to skeleton", () => {
      const skeleton = new Skeleton({
        name: "root",
        position: [0, 0],
        children: {
          head: { name: "head", position: [0, 5] },
        },
      });

      applyLookAtIK(
        skeleton,
        { bone: "head", maxAngle: 0.5, speed: 1.0 },
        1,
        5,
      );

      const head = skeleton.getBone("head");
      expect(head?.rotation).toBeDefined();
    });
  });

  describe("Spring-damper", () => {
    it("updates spring state", () => {
      const result = updateSpring(
        { position: 0, velocity: 0 },
        1,
        { stiffness: 10, damping: 1, mass: 1 },
        0.016,
      );
      expect(result.position).toBeGreaterThan(0);
      expect(result.velocity).toBeGreaterThan(0);
    });

    it("converges to target over time", () => {
      let state = { position: 0, velocity: 0 };
      const target = 1;
      const config = { stiffness: 10, damping: 5, mass: 1 };

      for (let i = 0; i < 100; i++) {
        state = updateSpring(state, target, config, 0.016);
      }

      expect(Math.abs(state.position - target)).toBeLessThan(0.1);
      expect(Math.abs(state.velocity)).toBeLessThan(0.1);
    });

    it("predefined configs are reasonable", () => {
      expect(SPRING_CONFIGS.ear.stiffness).toBeGreaterThan(SPRING_CONFIGS.tail.stiffness);
      expect(SPRING_CONFIGS.tail.damping).toBeGreaterThan(SPRING_CONFIGS.loose.damping);
    });
  });

  describe("Expression system", () => {
    it("gets texture for variant", () => {
      const config = {
        part: "eye_left" as const,
        variants: {
          neutral: "eye_neutral.png",
          happy: "eye_happy.png",
          sad: "eye_sad.png",
          annoyed: "eye_annoyed.png",
          surprised: "eye_surprised.png",
          tired: "eye_tired.png",
        },
      };

      expect(getExpressionTexture(config, "happy")).toBe("eye_happy.png");
    });

    it("falls back to neutral for unknown variant", () => {
      const config = {
        part: "eye_left" as const,
        variants: {
          neutral: "eye_neutral.png",
          happy: "eye_neutral.png",
          sad: "eye_neutral.png",
          annoyed: "eye_neutral.png",
          surprised: "eye_neutral.png",
          tired: "eye_neutral.png",
        },
      };

      // @ts-expect-error testing fallback
      expect(getExpressionTexture(config, "unknown")).toBe("eye_neutral.png");
    });
  });

  describe("Blink controller", () => {
    it("initializes with eyes open", () => {
      const state = initBlinkState();
      expect(state.isOpen).toBe(true);
      expect(state.nextBlinkTime).toBeGreaterThan(Date.now());
    });

    it("does not blink before scheduled time", () => {
      const state: BlinkState = { isOpen: true, nextBlinkTime: Date.now() + 10000 };
      const result = updateBlink(state);
      expect(result.didBlink).toBe(false);
      expect(result.newState.isOpen).toBe(true);
    });

    it("blinks when time reached", () => {
      const state: BlinkState = { isOpen: true, nextBlinkTime: Date.now() - 100 };
      const result = updateBlink(state);
      expect(result.didBlink).toBe(true);
      expect(result.newState.isOpen).toBe(false);
    });

    it("opens eyes after blink", () => {
      const state: BlinkState = { isOpen: false, nextBlinkTime: Date.now() - 100 };
      const result = updateBlink(state);
      expect(result.newState.isOpen).toBe(true);
      expect(result.newState.nextBlinkTime).toBeGreaterThan(Date.now());
    });
  });
});
