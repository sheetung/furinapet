import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  setMotionBackend,
  getMotionBackendType,
  resolveMotorPlan,
  updateMotionBackend,
  getSkeletalBackend,
  disposeMotionBackends,
} from "./backend-manager";
import type { MotorPlan } from "../contracts/motor-plan";

describe("Motion Backend Manager", () => {
  beforeEach(() => {
    // Reset to legacy backend before each test
    setMotionBackend("legacy");
  });

  afterEach(() => {
    disposeMotionBackends();
  });

  describe("backend switching", () => {
    it("defaults to legacy backend", () => {
      expect(getMotionBackendType()).toBe("legacy");
    });

    it("switches to skeletal backend", () => {
      setMotionBackend("skeletal", { name: "root", position: [0, 0] });
      expect(getMotionBackendType()).toBe("skeletal");
    });

    it("switches back to legacy backend", () => {
      setMotionBackend("skeletal", { name: "root", position: [0, 0] });
      setMotionBackend("legacy");
      expect(getMotionBackendType()).toBe("legacy");
    });

    it("creates skeletal backend instance when switching", () => {
      setMotionBackend("skeletal", { name: "root", position: [0, 0] });
      expect(getSkeletalBackend()).not.toBeNull();
    });

    it("disposes skeletal backend when switching to legacy", () => {
      setMotionBackend("skeletal", { name: "root", position: [0, 0] });
      const backend = getSkeletalBackend();
      setMotionBackend("legacy");
      expect(getSkeletalBackend()).toBeNull();
    });
  });

  describe("resolveMotorPlan", () => {
    it("resolves with legacy backend", () => {
      const plan: MotorPlan = {
        actions: [{ type: "gesture", gesture: "wave", weight: 1 }],
        durationMs: 800,
        confidence: 1,
      };
      const result = resolveMotorPlan(plan);
      expect(result).not.toBeNull();
      expect(result!.reaction).toBe("waving"); // Legacy returns string
    });

    it("resolves with skeletal backend", () => {
      setMotionBackend("skeletal", { name: "root", position: [0, 0] });
      const plan: MotorPlan = {
        actions: [{ type: "lookAt", target: "pointer", weight: 1 }],
        durationMs: 400,
        confidence: 1,
      };
      const result = resolveMotorPlan(plan);
      expect(result).not.toBeNull();
      expect(result!.reaction).toMatchObject({ type: "skeletal" });
    });

    it("returns null for unresolvable plan", () => {
      const plan: MotorPlan = {
        actions: [],
        durationMs: 0,
        confidence: 1,
      };
      const result = resolveMotorPlan(plan, 1000);
      // Legacy returns null for empty plan (no actions to resolve)
      expect(result).toBeNull();
    });
  });

  describe("updateMotionBackend", () => {
    it("updates skeletal backend", () => {
      setMotionBackend("skeletal", { name: "root", position: [0, 0] });
      const plan: MotorPlan = {
        actions: [{ type: "lookAt", target: "pointer", weight: 1 }],
        durationMs: 400,
        confidence: 1,
      };
      resolveMotorPlan(plan);
      
      // Should not throw
      expect(() => updateMotionBackend(0.016)).not.toThrow();
    });

    it("no-op for legacy backend", () => {
      // Should not throw
      expect(() => updateMotionBackend(0.016)).not.toThrow();
    });
  });

  describe("disposeMotionBackends", () => {
    it("cleans up skeletal backend", () => {
      setMotionBackend("skeletal", { name: "root", position: [0, 0] });
      disposeMotionBackends();
      expect(getSkeletalBackend()).toBeNull();
    });

    it("safe to call multiple times", () => {
      expect(() => {
        disposeMotionBackends();
        disposeMotionBackends();
      }).not.toThrow();
    });
  });
});
