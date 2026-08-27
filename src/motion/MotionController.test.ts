import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { MotionSenses } from "./Cerebellum";
import { FIXED_STEP, MotionController } from "./MotionController";
import { PrimitiveRig } from "./rig/PrimitiveRig";
import type { MotionIntent, RigBoneName } from "./types";

const ALL_BONES: RigBoneName[] = [
  "hips", "spine", "chest", "upperChest", "neck", "head",
  "leftUpperArm", "leftLowerArm", "leftHand",
  "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "rightUpperLeg", "rightLowerLeg",
  "leftEar", "rightEar", "tail1", "tail2", "tail3",
];

const STILL: MotionSenses = { gaze: null, velocity: 0, grounded: true };

function intent(kind: MotionIntent["kind"], intensity = 0.8, id = 1): MotionIntent {
  return { kind, intensity, durationMs: 0, id };
}

function drive(controller: MotionController, seconds: number, senses = STILL, frameDelta = 1 / 60) {
  const frames = Math.round(seconds / frameDelta);
  for (let index = 0; index < frames; index += 1) controller.update(frameDelta, senses);
}

function assertFinite(rig: PrimitiveRig) {
  for (const bone of ALL_BONES) {
    const node = rig.getBone(bone);
    if (!node) continue;
    const { x, y, z, w } = node.quaternion;
    expect(Number.isFinite(x + y + z + w)).toBe(true);
    expect(node.quaternion.length()).toBeCloseTo(1, 5);
    expect(Number.isFinite(node.position.x + node.position.y + node.position.z)).toBe(true);
  }
}

/** How far a bone has swung from the rig's own rest orientation, in radians. */
function awayFromRest(rig: PrimitiveRig, bone: RigBoneName): number {
  return rig.getBone(bone)!.quaternion.angleTo(rig.restQuaternion(bone)!);
}

describe("MotionController", () => {
  it("does nothing without a rig", () => {
    const controller = new MotionController();
    expect(() => controller.update(1 / 60, STILL)).not.toThrow();
    expect(controller.diagnostics().substeps).toBe(0);
  });

  it("keeps the whole skeleton finite and normalised while idling", () => {
    const rig = new PrimitiveRig({ visual: false });
    const controller = new MotionController();
    controller.setRig(rig);
    drive(controller, 5);
    assertFinite(rig);
  });

  it("breathes: the chest keeps moving even with no intent", () => {
    const rig = new PrimitiveRig({ visual: false });
    const controller = new MotionController();
    controller.setRig(rig);
    drive(controller, 1);

    const first = rig.getBone("chest")!.quaternion.clone();
    drive(controller, 1.6);
    const second = rig.getBone("chest")!.quaternion.clone();
    expect(first.angleTo(second)).toBeGreaterThan(0.002);
  });

  it("moves the greeting arm well away from its rest pose", () => {
    const rig = new PrimitiveRig({ visual: false });
    const controller = new MotionController();
    controller.setRig(rig);

    drive(controller, 0.5);
    expect(awayFromRest(rig, "rightUpperArm")).toBeLessThan(0.05);

    controller.setIntent(intent("greet"));
    drive(controller, 1.5);
    expect(awayFromRest(rig, "rightUpperArm")).toBeGreaterThan(0.4);
    // The unused arm must stay where it was.
    expect(awayFromRest(rig, "leftUpperArm")).toBeLessThan(0.1);
    assertFinite(rig);
  });

  it("keeps the elbow bent throughout the wave instead of snapping it straight", () => {
    // The hand goal sweeps for a full second here. If a routine let the goal cross
    // the arm's reach limit, the elbow would lock straight once per cycle — visible
    // as a snap, and invisible to a single-frame assertion.
    const rig = new PrimitiveRig({ visual: false });
    const controller = new MotionController();
    controller.setRig(rig);
    controller.setIntent(intent("greet"));
    drive(controller, 1);

    let minimumBend = Infinity;
    for (let index = 0; index < 60; index += 1) {
      controller.update(1 / 60, STILL);
      minimumBend = Math.min(minimumBend, awayFromRest(rig, "rightLowerArm"));
      expect(controller.diagnostics().overreach.right).toBe(0);
    }
    expect(minimumBend).toBeGreaterThan(0.4);
  });

  it("returns the arm to rest after the greeting is replaced by idle", () => {
    const rig = new PrimitiveRig({ visual: false });
    const controller = new MotionController();
    controller.setRig(rig);

    controller.setIntent(intent("greet"));
    drive(controller, 1.5);
    expect(awayFromRest(rig, "rightUpperArm")).toBeGreaterThan(0.4);

    controller.setIntent(intent("idle", 0.3, 2));
    drive(controller, 3);
    expect(awayFromRest(rig, "rightUpperArm")).toBeLessThan(0.06);
  });

  it("tracks a gaze target while walking, which the sprite backend cannot", () => {
    const rig = new PrimitiveRig({ visual: false });
    const controller = new MotionController();
    controller.setRig(rig);
    controller.setIntent(intent("locomote", 0.6));

    const walking: MotionSenses = { gaze: new THREE.Vector3(0.8, 1.3, 0.9), velocity: 0.4, grounded: true };
    drive(controller, 2, walking);

    expect(Math.abs(controller.diagnostics().gazeYaw)).toBeGreaterThan(0.2);
    assertFinite(rig);
  });

  it("clamps the substep count instead of chasing a stalled frame", () => {
    const rig = new PrimitiveRig({ visual: false });
    const controller = new MotionController();
    controller.setRig(rig);

    controller.update(3, STILL);
    const diagnostics = controller.diagnostics();
    expect(diagnostics.substeps).toBeLessThanOrEqual(8);
    assertFinite(rig);
  });

  it("runs one substep per frame at the fixed rate", () => {
    const rig = new PrimitiveRig({ visual: false });
    const controller = new MotionController();
    controller.setRig(rig);
    controller.update(FIXED_STEP, STILL);
    expect(controller.diagnostics().substeps).toBe(1);
  });

  it("survives a rig swap mid-flight", () => {
    const controller = new MotionController();
    const first = new PrimitiveRig({ visual: false });
    controller.setRig(first);
    controller.setIntent(intent("cheer", 1));
    drive(controller, 1);

    const second = new PrimitiveRig({ visual: false });
    controller.setRig(second);
    drive(controller, 1);
    assertFinite(second);
    first.dispose();
  });
});
