import { describe, it, expect } from "vitest";
import { Skeleton, Bone, type BoneConfig } from "./skeleton";

describe("Skeleton System (S1)", () => {
  const testConfig: BoneConfig = {
    name: "root",
    position: [0, 0],
    children: {
      body: {
        name: "body",
        position: [0, 50],
        children: {
          head: {
            name: "head",
            position: [0, 30],
            anchor: [0, -10],
          },
          arm_left: {
            name: "arm_left",
            position: [-20, 20],
          },
        },
      },
    },
  };

  describe("Bone", () => {
    it("should create bone from config", () => {
      const bone = new Bone({ name: "test", position: [10, 20], rotation: 0.5 });
      expect(bone.name).toBe("test");
      expect(bone.position.x).toBe(10);
      expect(bone.position.y).toBe(20);
      expect(bone.rotation).toBe(0.5);
    });

    it("should default rotation to 0", () => {
      const bone = new Bone({ name: "test", position: [0, 0] });
      expect(bone.rotation).toBe(0);
    });

    it("should default scale to (1, 1)", () => {
      const bone = new Bone({ name: "test", position: [0, 0] });
      expect(bone.scale.x).toBe(1);
      expect(bone.scale.y).toBe(1);
    });

    it("should create children from config", () => {
      const bone = new Bone(testConfig);
      expect(bone.children).toHaveLength(1);
      expect(bone.children[0].name).toBe("body");
      expect(bone.children[0].children).toHaveLength(2);
    });

    it("should flatten bone tree", () => {
      const bone = new Bone(testConfig);
      const flat = bone.flatten();
      expect(flat).toHaveLength(4); // root, body, head, arm_left
      expect(flat.map((b) => b.name)).toEqual(["root", "body", "head", "arm_left"]);
    });

    it("should find bone by name", () => {
      const bone = new Bone(testConfig);
      const head = bone.findBone("head");
      expect(head).not.toBeNull();
      expect(head?.name).toBe("head");

      const missing = bone.findBone("missing");
      expect(missing).toBeNull();
    });
  });

  describe("Skeleton", () => {
    it("should create skeleton from config", () => {
      const skeleton = new Skeleton(testConfig);
      expect(skeleton.root.name).toBe("root");
    });

    it("should get bone by name", () => {
      const skeleton = new Skeleton(testConfig);
      const head = skeleton.getBone("head");
      expect(head).not.toBeNull();
      expect(head?.name).toBe("head");
    });

    it("should return null for missing bone", () => {
      const skeleton = new Skeleton(testConfig);
      expect(skeleton.getBone("missing")).toBeNull();
    });

    it("should update world transforms", () => {
      const skeleton = new Skeleton(testConfig);
      skeleton.update();

      // Root should be at origin
      expect(skeleton.root.worldPosition.x).toBe(0);
      expect(skeleton.root.worldPosition.y).toBe(0);

      // Body should be at (0, 50) relative to root
      const body = skeleton.getBone("body")!;
      expect(body.worldPosition.x).toBe(0);
      expect(body.worldPosition.y).toBe(50);

      // Head should be at (0, 80) relative to root (50 + 30)
      const head = skeleton.getBone("head")!;
      expect(head.worldPosition.x).toBe(0);
      expect(head.worldPosition.y).toBe(80);
    });

    it("should propagate rotation to children", () => {
      const skeleton = new Skeleton(testConfig);
      const body = skeleton.getBone("body")!;
      body.rotation = Math.PI / 2; // 90 degrees

      skeleton.update();

      // Head should be rotated 90 degrees
      const head = skeleton.getBone("head")!;
      expect(head.worldRotation).toBeCloseTo(Math.PI / 2, 5);

      // Head position should be rotated: (0, 30) rotated 90° around body = (-30, 50)
      expect(head.worldPosition.x).toBeCloseTo(-30, 5);
      expect(head.worldPosition.y).toBeCloseTo(50, 5);
    });

    it("should apply pose", () => {
      const skeleton = new Skeleton(testConfig);
      skeleton.applyPose({
        body: 0.5,
        head: -0.3,
      });

      const body = skeleton.getBone("body")!;
      const head = skeleton.getBone("head")!;

      expect(body.rotation).toBe(0.5);
      expect(head.rotation).toBe(-0.3);
    });

    it("should reset pose", () => {
      const skeleton = new Skeleton(testConfig);
      skeleton.applyPose({ body: 0.5, head: -0.3 });
      skeleton.resetPose();

      const body = skeleton.getBone("body")!;
      const head = skeleton.getBone("head")!;

      expect(body.rotation).toBe(0);
      expect(head.rotation).toBe(0);
    });

    it("should handle anchor offset", () => {
      const skeleton = new Skeleton(testConfig);
      const head = skeleton.getBone("head")!;

      expect(head.anchor.x).toBe(0);
      expect(head.anchor.y).toBe(-10);
    });
  });
});
