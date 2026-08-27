import type { JointLimits } from "./types";

const DEGREE = Math.PI / 180;

/**
 * Anatomical-ish limits. These are the "Constraint" box of the motion pipeline:
 * a solver may ask for anything, the mixer will only ever apply what fits here.
 * Stiffness/damping pairs are chosen slightly under critical (`2*sqrt(k)`) so the
 * character settles with a little follow-through instead of snapping.
 */
export const defaultJointLimits: JointLimits = {
  hips: { maxSwing: 14 * DEGREE, stiffness: 90, damping: 17 },
  spine: { maxSwing: 18 * DEGREE, stiffness: 120, damping: 19 },
  chest: { maxSwing: 20 * DEGREE, stiffness: 150, damping: 21 },
  upperChest: { maxSwing: 16 * DEGREE, stiffness: 150, damping: 21 },
  neck: { maxSwing: 38 * DEGREE, stiffness: 260, damping: 28 },
  head: { maxSwing: 46 * DEGREE, stiffness: 320, damping: 31 },

  leftShoulder: { maxSwing: 22 * DEGREE, stiffness: 150, damping: 22 },
  rightShoulder: { maxSwing: 22 * DEGREE, stiffness: 150, damping: 22 },
  leftUpperArm: { maxSwing: 155 * DEGREE, stiffness: 220, damping: 26 },
  rightUpperArm: { maxSwing: 155 * DEGREE, stiffness: 220, damping: 26 },
  leftLowerArm: { maxSwing: 140 * DEGREE, stiffness: 260, damping: 28 },
  rightLowerArm: { maxSwing: 140 * DEGREE, stiffness: 260, damping: 28 },
  leftHand: { maxSwing: 55 * DEGREE, stiffness: 200, damping: 25 },
  rightHand: { maxSwing: 55 * DEGREE, stiffness: 200, damping: 25 },

  leftUpperLeg: { maxSwing: 60 * DEGREE, stiffness: 200, damping: 25 },
  rightUpperLeg: { maxSwing: 60 * DEGREE, stiffness: 200, damping: 25 },
  leftLowerLeg: { maxSwing: 110 * DEGREE, stiffness: 240, damping: 27 },
  rightLowerLeg: { maxSwing: 110 * DEGREE, stiffness: 240, damping: 27 },
  leftFoot: { maxSwing: 35 * DEGREE, stiffness: 200, damping: 25 },
  rightFoot: { maxSwing: 35 * DEGREE, stiffness: 200, damping: 25 },

  // Decorative bones are deliberately floppy: low stiffness, well under critical
  // damping, so they trail the body and overshoot on stops.
  leftEar: { maxSwing: 40 * DEGREE, stiffness: 55, damping: 8 },
  rightEar: { maxSwing: 40 * DEGREE, stiffness: 55, damping: 8 },
  tail1: { maxSwing: 45 * DEGREE, stiffness: 42, damping: 6.5 },
  tail2: { maxSwing: 50 * DEGREE, stiffness: 34, damping: 5.5 },
  tail3: { maxSwing: 55 * DEGREE, stiffness: 28, damping: 4.6 },
};
