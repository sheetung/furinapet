import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PrimitiveRig } from "../rig/PrimitiveRig";
import { applyRecorded, boneInRootSpace, RecordingSink } from "../testing";
import { TwoBoneIK } from "./TwoBoneIK";

const RIGHT_ARM = { upper: "rightUpperArm", lower: "rightLowerArm", end: "rightHand" } as const;
const LEFT_LEG = { upper: "leftUpperLeg", lower: "leftLowerLeg", end: "leftFoot" } as const;

function freshRig() {
  const rig = new PrimitiveRig({ visual: false });
  rig.root.updateMatrixWorld(true);
  return rig;
}

describe("TwoBoneIK", () => {
  it("puts the effector on a reachable goal", () => {
    const rig = freshRig();
    const sink = new RecordingSink();
    const solver = new TwoBoneIK();
    const target = new THREE.Vector3(0.25, 1.15, 0.2);

    const solved = solver.solve(rig, RIGHT_ARM, {
      target,
      pole: new THREE.Vector3(0.8, 0.5, -0.6),
      weight: 1,
    }, sink);

    expect(solved).toBe(true);
    expect(solver.effector.distanceTo(target)).toBeLessThan(0.002);
    expect(solver.overreach).toBe(0);
  });

  it("reproduces the goal on the rig once the solved locals are applied", () => {
    const rig = freshRig();
    const sink = new RecordingSink();
    const solver = new TwoBoneIK();
    const target = new THREE.Vector3(0.3, 1.32, 0.05);

    solver.solve(rig, RIGHT_ARM, { target, pole: new THREE.Vector3(0.8, 0.5, -0.6), weight: 1 }, sink);
    applyRecorded(rig, sink);

    expect(boneInRootSpace(rig, "rightHand").distanceTo(target)).toBeLessThan(0.005);
  });

  it("straightens the limb and reports overreach for an unreachable goal", () => {
    const rig = freshRig();
    const sink = new RecordingSink();
    const solver = new TwoBoneIK();
    const target = new THREE.Vector3(3, 1.12, 0);

    solver.solve(rig, RIGHT_ARM, { target, pole: new THREE.Vector3(0.8, 0.5, -0.6), weight: 1 }, sink);
    applyRecorded(rig, sink);

    const shoulder = boneInRootSpace(rig, "rightUpperArm");
    const elbow = boneInRootSpace(rig, "rightLowerArm");
    const hand = boneInRootSpace(rig, "rightHand");
    // Reach is 0.235 + 0.215; anything past that must come out fully extended.
    expect(shoulder.distanceTo(hand)).toBeCloseTo(0.45, 2);
    expect(solver.overreach).toBeGreaterThan(2);

    const upperDirection = elbow.clone().sub(shoulder).normalize();
    const lowerDirection = hand.clone().sub(elbow).normalize();
    expect(upperDirection.dot(lowerDirection)).toBeGreaterThan(0.999);
  });

  it("bends the elbow toward the pole rather than away from it", () => {
    const rig = freshRig();
    const sink = new RecordingSink();
    const solver = new TwoBoneIK();
    const target = new THREE.Vector3(0.22, 1.2, 0.18);
    const pole = new THREE.Vector3(0.9, 0.6, -0.7);

    solver.solve(rig, RIGHT_ARM, { target, pole, weight: 1 }, sink);
    applyRecorded(rig, sink);

    const shoulder = boneInRootSpace(rig, "rightUpperArm");
    const elbow = boneInRootSpace(rig, "rightLowerArm");
    const axis = target.clone().sub(shoulder).normalize();
    const elbowSide = elbow.clone().sub(shoulder).projectOnPlane(axis).normalize();
    const poleSide = pole.clone().sub(shoulder).projectOnPlane(axis).normalize();

    expect(elbowSide.dot(poleSide)).toBeGreaterThan(0.9);
  });

  it("is deterministic: repeated solves of the same goal agree", () => {
    const rig = freshRig();
    const solver = new TwoBoneIK();
    const target = new THREE.Vector3(0.24, 1.18, 0.14);
    const pole = new THREE.Vector3(0.8, 0.5, -0.6);

    const first = new RecordingSink();
    solver.solve(rig, RIGHT_ARM, { target, pole, weight: 1 }, first);
    const second = new RecordingSink();
    solver.solve(rig, RIGHT_ARM, { target, pole, weight: 1 }, second);

    expect(first.first("rightUpperArm")!.angleTo(second.first("rightUpperArm")!)).toBeLessThan(1e-9);
    expect(first.first("rightLowerArm")!.angleTo(second.first("rightLowerArm")!)).toBeLessThan(1e-9);
  });

  it("solves a leg chain, whose bones run along -Y instead of X", () => {
    const rig = freshRig();
    const sink = new RecordingSink();
    const solver = new TwoBoneIK();
    const target = new THREE.Vector3(-0.075, 0.12, 0.22);

    solver.solve(rig, LEFT_LEG, { target, pole: new THREE.Vector3(-0.2, 0.4, 0.9), weight: 1 }, sink);
    applyRecorded(rig, sink);

    expect(boneInRootSpace(rig, "leftFoot").distanceTo(target)).toBeLessThan(0.005);
  });

  it("declines a zero weight without writing anything", () => {
    const rig = freshRig();
    const sink = new RecordingSink();
    const solver = new TwoBoneIK();

    const solved = solver.solve(rig, RIGHT_ARM, {
      target: new THREE.Vector3(0.25, 1.15, 0.2),
      pole: new THREE.Vector3(0.8, 0.5, -0.6),
      weight: 0,
    }, sink);

    expect(solved).toBe(false);
    expect(sink.rotations.size).toBe(0);
  });
});
