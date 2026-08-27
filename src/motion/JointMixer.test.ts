import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { clampSwing, JointMixer } from "./JointMixer";
import { PrimitiveRig } from "./rig/PrimitiveRig";
import type { JointLimits } from "./types";

const REST = new THREE.Quaternion();

function yaw(degrees: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), degrees * Math.PI / 180);
}

const limits: JointLimits = {
  head: { maxSwing: Math.PI, stiffness: 400, damping: 40 },
  neck: { maxSwing: 10 * Math.PI / 180, stiffness: 400, damping: 40 },
};

function settle(mixer: JointMixer, rig: PrimitiveRig, contribute: () => void, seconds = 3) {
  const step = 1 / 120;
  for (let time = 0; time < seconds; time += step) {
    contribute();
    mixer.flush(rig, step);
  }
}

describe("clampSwing", () => {
  it("leaves a target inside the limit untouched", () => {
    const target = yaw(20);
    const result = clampSwing(target.clone(), REST, 30 * Math.PI / 180);
    expect(result.angleTo(yaw(20))).toBeLessThan(1e-6);
  });

  it("caps a target beyond the limit at exactly the limit", () => {
    const result = clampSwing(yaw(80), REST, 30 * Math.PI / 180);
    expect(result.angleTo(REST)).toBeCloseTo(30 * Math.PI / 180, 5);
  });
});

describe("JointMixer", () => {
  it("converges on a single full-weight contribution", () => {
    const rig = new PrimitiveRig({ visual: false });
    const mixer = new JointMixer(limits);
    const target = yaw(30);
    settle(mixer, rig, () => mixer.add("head", target, 1));
    expect(rig.getBone("head")!.quaternion.angleTo(target)).toBeLessThan(0.01);
  });

  it("treats total weight below one as a partial blend out of rest", () => {
    const rig = new PrimitiveRig({ visual: false });
    const mixer = new JointMixer(limits);
    settle(mixer, rig, () => mixer.add("head", yaw(40), 0.5));
    expect(rig.getBone("head")!.quaternion.angleTo(REST)).toBeCloseTo(20 * Math.PI / 180, 2);
  });

  it("averages competing contributions instead of letting the last one win", () => {
    const rig = new PrimitiveRig({ visual: false });
    const mixer = new JointMixer(limits);
    settle(mixer, rig, () => {
      mixer.add("head", yaw(30), 0.5);
      mixer.add("head", yaw(-30), 0.5);
    });
    // Last-write-wins would land on -30 degrees; a weighted mean lands on rest.
    expect(rig.getBone("head")!.quaternion.angleTo(REST)).toBeLessThan(0.02);
  });

  it("weights an uneven pair toward the heavier contribution", () => {
    const rig = new PrimitiveRig({ visual: false });
    const mixer = new JointMixer(limits);
    settle(mixer, rig, () => {
      mixer.add("head", yaw(40), 0.75);
      mixer.add("head", yaw(0), 0.25);
    });
    expect(rig.getBone("head")!.quaternion.angleTo(REST)).toBeCloseTo(30 * Math.PI / 180, 2);
  });

  it("never exceeds a joint's swing limit", () => {
    const rig = new PrimitiveRig({ visual: false });
    const mixer = new JointMixer(limits);
    settle(mixer, rig, () => mixer.add("neck", yaw(80), 1));
    expect(rig.getBone("neck")!.quaternion.angleTo(REST)).toBeLessThanOrEqual(10 * Math.PI / 180 + 1e-3);
  });

  it("relaxes a joint back to rest once nobody drives it", () => {
    const rig = new PrimitiveRig({ visual: false });
    const mixer = new JointMixer(limits);
    settle(mixer, rig, () => mixer.add("head", yaw(35), 1), 2);
    expect(rig.getBone("head")!.quaternion.angleTo(REST)).toBeGreaterThan(0.3);

    settle(mixer, rig, () => {}, 3);
    expect(rig.getBone("head")!.quaternion.angleTo(REST)).toBeLessThan(0.01);
  });

  it("stays bounded when handed an absurd time step", () => {
    // The controller feeds a fixed step, but a stalled tab or a debugger pause can
    // still produce one huge delta. Clamping inside flush is what keeps the spring
    // from integrating itself into a spin.
    const rig = new PrimitiveRig({ visual: false });
    const mixer = new JointMixer(limits);
    for (let index = 0; index < 50; index += 1) {
      mixer.add("head", yaw(35), 1);
      mixer.flush(rig, 5);
    }
    const angle = rig.getBone("head")!.quaternion.angleTo(REST);
    expect(Number.isFinite(angle)).toBe(true);
    expect(angle).toBeLessThanOrEqual(Math.PI);
  });
});
