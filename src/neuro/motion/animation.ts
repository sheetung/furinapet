/**
 * S2: Animation System
 * Pose definitions, tweening, Motor Primitives → Pose mapping, constraints
 */

import type { MotorPrimitive } from "../contracts/motor-plan";

/**
 * Pose: map of bone names to rotation (radians)
 * JSON-serializable for external tooling
 */
export type Pose = Record<string, number>;

/**
 * Keyframe: pose at a specific time
 */
export interface Keyframe {
  time: number; // ms from animation start
  pose: Pose;
  easing?: EasingType;
}

/**
 * Animation: sequence of keyframes for a specific motion
 */
export interface Animation {
  name: string;
  duration: number; // total duration in ms
  keyframes: Keyframe[];
  loop?: boolean;
}

export type EasingType = "linear" | "easeIn" | "easeOut" | "easeInOut";

/**
 * Easing functions
 */
export const easings = {
  linear: (t: number) => t,
  easeIn: (t: number) => t * t,
  easeOut: (t: number) => t * (2 - t),
  easeInOut: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
} as const;

/**
 * Interpolate between two poses
 */
export function lerpPose(a: Pose, b: Pose, t: number, easing: EasingType = "linear"): Pose {
  const eased = easings[easing](t);
  const result: Pose = {};
  
  // Union of all bone names
  const bones = new Set([...Object.keys(a), ...Object.keys(b)]);
  
  for (const bone of bones) {
    const aVal = a[bone] ?? 0;
    const bVal = b[bone] ?? 0;
    result[bone] = aVal + (bVal - aVal) * eased;
  }
  
  return result;
}

/**
 * Sample animation at a specific time
 */
export function sampleAnimation(anim: Animation, timeMs: number): Pose {
  if (anim.keyframes.length === 0) return {};
  
  // Handle looping
  const t = anim.loop ? timeMs % anim.duration : Math.min(timeMs, anim.duration);
  
  // Find surrounding keyframes
  let k0 = anim.keyframes[0];
  let k1 = anim.keyframes[anim.keyframes.length - 1];
  
  for (let i = 0; i < anim.keyframes.length - 1; i++) {
    const curr = anim.keyframes[i];
    const next = anim.keyframes[i + 1];
    if (t >= curr.time && t <= next.time) {
      k0 = curr;
      k1 = next;
      break;
    }
  }
  
  // Interpolate
  const segmentDuration = k1.time - k0.time;
  if (segmentDuration === 0) return { ...k1.pose };
  
  const localT = (t - k0.time) / segmentDuration;
  return lerpPose(k0.pose, k1.pose, localT, k1.easing ?? "linear");
}

/**
 * Constraint: rotation limits for a bone
 */
export interface BoneConstraint {
  min?: number; // min rotation (radians)
  max?: number; // max rotation (radians)
}

export type ConstraintMap = Record<string, BoneConstraint>;

/**
 * Apply constraints to a pose (clamp rotations)
 */
export function applyConstraints(pose: Pose, constraints: ConstraintMap): Pose {
  const result: Pose = { ...pose };
  
  for (const [bone, constraint] of Object.entries(constraints)) {
    if (result[bone] === undefined) continue;
    
    if (constraint.min !== undefined) {
      result[bone] = Math.max(result[bone], constraint.min);
    }
    if (constraint.max !== undefined) {
      result[bone] = Math.min(result[bone], constraint.max);
    }
  }
  
  return result;
}

/**
 * Furina constraints: realistic limits for cat-girl anatomy
 */
export const FURINA_CONSTRAINTS: ConstraintMap = {
  head: { min: -0.5, max: 0.5 }, // ±28°
  body: { min: -0.3, max: 0.3 }, // ±17°
  arm_left: { min: -1.2, max: 1.2 }, // ±68°
  arm_right: { min: -1.2, max: 1.2 },
  leg_left: { min: -0.8, max: 0.8 }, // ±45°
  leg_right: { min: -0.8, max: 0.8 },
  ear_left: { min: -0.4, max: 0.4 }, // ±22°
  ear_right: { min: -0.4, max: 0.4 },
  tail: { min: -0.6, max: 0.6 }, // ±34°
};

/**
 * Predefined animations (Motor Primitives → Pose sequences)
 */
export const ANIMATIONS: Record<string, Animation> = {
  idle: {
    name: "idle",
    duration: 2000,
    loop: true,
    keyframes: [
      { time: 0, pose: {}, easing: "easeInOut" },
      { time: 1000, pose: { body: 0.05, tail: 0.1 }, easing: "easeInOut" },
      { time: 2000, pose: {}, easing: "easeInOut" },
    ],
  },
  
  lookAt: {
    name: "lookAt",
    duration: 400,
    keyframes: [
      { time: 0, pose: {}, easing: "easeOut" },
      { time: 400, pose: { head: 0.3 }, easing: "easeOut" },
    ],
  },
  
  recoil: {
    name: "recoil",
    duration: 300,
    keyframes: [
      { time: 0, pose: {}, easing: "easeOut" },
      { time: 150, pose: { body: -0.2, head: -0.1 }, easing: "easeOut" },
      { time: 300, pose: {}, easing: "easeInOut" },
    ],
  },
  
  wave: {
    name: "wave",
    duration: 800,
    keyframes: [
      { time: 0, pose: {}, easing: "easeInOut" },
      { time: 200, pose: { arm_right: -1.0 }, easing: "easeInOut" },
      { time: 400, pose: { arm_right: -0.6 }, easing: "easeInOut" },
      { time: 600, pose: { arm_right: -1.0 }, easing: "easeInOut" },
      { time: 800, pose: {}, easing: "easeInOut" },
    ],
  },
  
  step: {
    name: "step",
    duration: 500,
    keyframes: [
      { time: 0, pose: {}, easing: "easeInOut" },
      { time: 250, pose: { leg_left: 0.4, leg_right: -0.4, body: 0.05 }, easing: "easeInOut" },
      { time: 500, pose: {}, easing: "easeInOut" },
    ],
  },
  
  earTwitch: {
    name: "earTwitch",
    duration: 300,
    keyframes: [
      { time: 0, pose: {}, easing: "easeOut" },
      { time: 100, pose: { ear_left: 0.2, ear_right: 0.2 }, easing: "easeOut" },
      { time: 300, pose: {}, easing: "easeInOut" },
    ],
  },
  
  tailWag: {
    name: "tailWag",
    duration: 600,
    loop: true,
    keyframes: [
      { time: 0, pose: {}, easing: "easeInOut" },
      { time: 300, pose: { tail: 0.4 }, easing: "easeInOut" },
      { time: 600, pose: { tail: -0.4 }, easing: "easeInOut" },
    ],
  },
};

/**
 * MotorPrimitive → Animation mapping
 */
export function primitiveToAnimation(primitive: MotorPrimitive): Animation | null {
  const mapping: Record<MotorPrimitive["type"], string> = {
    lookAt: "lookAt",
    lookAway: "lookAt",
    recoil: "recoil",
    lean: "step",
    turn: "step",
    step: "step",
    approach: "step",
    retreat: "step",
    earPose: "earTwitch",
    tailMotion: "tailWag",
    expression: "idle",
    gesture: "wave",
    idleStyle: "idle",
  };
  
  const animName = mapping[primitive.type];
  return ANIMATIONS[animName] ?? null;
}

/**
 * AnimationPlayer: plays animations over time
 */
export class AnimationPlayer {
  private current: Animation | null = null;
  private startTime = 0;
  private constraints: ConstraintMap;
  
  constructor(constraints: ConstraintMap = FURINA_CONSTRAINTS) {
    this.constraints = constraints;
  }
  
  play(animation: Animation): void {
    this.current = animation;
    this.startTime = Date.now();
  }
  
  stop(): void {
    this.current = null;
  }
  
  getCurrentPose(): Pose {
    if (!this.current) return {};
    
    const elapsed = Date.now() - this.startTime;
    const rawPose = sampleAnimation(this.current, elapsed);
    const constrained = applyConstraints(rawPose, this.constraints);
    
    // Auto-stop non-looping animations
    if (!this.current.loop && elapsed >= this.current.duration) {
      this.current = null;
    }
    
    return constrained;
  }
  
  isPlaying(): boolean {
    return this.current !== null;
  }
}
