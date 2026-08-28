/**
 * S3: IK + Advanced Animation Features
 * Two-bone IK, Look-at IK, Spring-damper, Expression system
 */

import { Bone, Skeleton } from "./skeleton";

/**
 * Two-bone IK: solve for arm/leg chains (upper → lower → end effector)
 * Given a target position, compute the two joint angles.
 */
export interface TwoBoneIKConfig {
  upper: string; // upper bone name (e.g., "arm_left_upper")
  lower: string; // lower bone name (e.g., "arm_left_lower")
  upperLength: number;
  lowerLength: number;
  bendDirection: 1 | -1; // 1 = bend forward, -1 = bend backward
}

/**
 * Solve two-bone IK using law of cosines
 * Returns { upperAngle, lowerAngle } in radians
 */
export function solveTwoBoneIK(
  config: TwoBoneIKConfig,
  targetX: number,
  targetY: number,
): { upperAngle: number; lowerAngle: number } | null {
  const { upperLength, lowerLength, bendDirection } = config;
  
  // Distance to target
  const dist = Math.sqrt(targetX * targetX + targetY * targetY);
  
  // Check reachability
  const maxReach = upperLength + lowerLength;
  const minReach = Math.abs(upperLength - lowerLength);
  
  if (dist > maxReach || dist < minReach || dist < 0.001) {
    return null; // unreachable
  }
  
  // Law of cosines for lower angle (elbow/knee)
  const cosLower = (upperLength * upperLength + lowerLength * lowerLength - dist * dist) / (2 * upperLength * lowerLength);
  const lowerAngle = bendDirection * Math.acos(Math.max(-1, Math.min(1, cosLower)));
  
  // Law of cosines for upper angle (shoulder/hip)
  const cosUpper = (dist * dist + upperLength * upperLength - lowerLength * lowerLength) / (2 * dist * upperLength);
  const baseAngle = Math.atan2(targetY, targetX);
  const offsetAngle = Math.acos(Math.max(-1, Math.min(1, cosUpper)));
  const upperAngle = baseAngle - bendDirection * offsetAngle;
  
  return { upperAngle, lowerAngle };
}

/**
 * Apply two-bone IK to skeleton
 */
export function applyTwoBoneIK(
  skeleton: Skeleton,
  config: TwoBoneIKConfig,
  targetX: number,
  targetY: number,
): boolean {
  const solution = solveTwoBoneIK(config, targetX, targetY);
  if (!solution) return false;
  
  const upper = skeleton.getBone(config.upper);
  const lower = skeleton.getBone(config.lower);
  
  if (!upper || !lower) return false;
  
  upper.rotation = solution.upperAngle;
  lower.rotation = solution.lowerAngle;
  
  return true;
}

/**
 * Look-at IK: rotate head/eyes to face a target point
 */
export interface LookAtIKConfig {
  bone: string; // bone name (e.g., "head", "eye_left")
  maxAngle: number; // max rotation in radians
  speed: number; // 0..1, how fast to track (for smooth following)
}

/**
 * Compute look-at rotation toward a target
 */
export function solveLookAt(
  config: LookAtIKConfig,
  boneX: number,
  boneY: number,
  targetX: number,
  targetY: number,
  currentRotation: number,
): number {
  const dx = targetX - boneX;
  const dy = targetY - boneY;
  const targetAngle = Math.atan2(dy, dx);
  
  // Clamp to max angle
  const clampedAngle = Math.max(-config.maxAngle, Math.min(config.maxAngle, targetAngle));
  
  // Smooth interpolation
  const delta = clampedAngle - currentRotation;
  return currentRotation + delta * config.speed;
}

/**
 * Apply look-at IK to skeleton
 */
export function applyLookAtIK(
  skeleton: Skeleton,
  config: LookAtIKConfig,
  targetX: number,
  targetY: number,
): void {
  const bone = skeleton.getBone(config.bone);
  if (!bone) return;
  
  bone.rotation = solveLookAt(
    config,
    bone.worldPosition.x,
    bone.worldPosition.y,
    targetX,
    targetY,
    bone.rotation,
  );
}

/**
 * Spring-damper system for natural sway (ears, tail, etc.)
 */
export interface SpringConfig {
  stiffness: number; // spring constant (higher = stiffer)
  damping: number; // damping coefficient (higher = less oscillation)
  mass: number; // mass (higher = slower)
}

export interface SpringState {
  position: number;
  velocity: number;
}

/**
 * Update spring-damper simulation (semi-implicit Euler integration)
 */
export function updateSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number, // delta time in seconds
): SpringState {
  const { stiffness, damping, mass } = config;
  
  // Spring force: F = -k * (x - target)
  const springForce = -stiffness * (state.position - target);
  
  // Damping force: F = -c * v
  const dampingForce = -damping * state.velocity;
  
  // Acceleration: a = F / m
  const acceleration = (springForce + dampingForce) / mass;
  
  // Semi-implicit Euler (velocity first, then position)
  const newVelocity = state.velocity + acceleration * dt;
  const newPosition = state.position + newVelocity * dt;
  
  return { position: newPosition, velocity: newVelocity };
}

/**
 * Predefined spring configs for different body parts
 */
export const SPRING_CONFIGS = {
  ear: { stiffness: 8, damping: 1.5, mass: 0.3 }, // snappy, slight bounce
  tail: { stiffness: 4, damping: 0.8, mass: 0.5 }, // slower, more sway
  loose: { stiffness: 2, damping: 0.5, mass: 1.0 }, // very loose, heavy
} as const;

/**
 * Expression system: switch eye/mouth parts based on emotion
 */
export type ExpressionPart = "eye_left" | "eye_right" | "mouth";
export type ExpressionVariant = "neutral" | "happy" | "sad" | "annoyed" | "surprised" | "tired";

export interface ExpressionConfig {
  part: ExpressionPart;
  variants: Record<ExpressionVariant, string>; // variant → texture path
}

/**
 * Get texture path for expression variant
 */
export function getExpressionTexture(
  config: ExpressionConfig,
  variant: ExpressionVariant,
): string {
  return config.variants[variant] ?? config.variants.neutral;
}

/**
 * Default expression configs (placeholder textures)
 */
export const EXPRESSION_CONFIGS: ExpressionConfig[] = [
  {
    part: "eye_left",
    variants: {
      neutral: "placeholder.png",
      happy: "placeholder.png",
      sad: "placeholder.png",
      annoyed: "placeholder.png",
      surprised: "placeholder.png",
      tired: "placeholder.png",
    },
  },
  {
    part: "eye_right",
    variants: {
      neutral: "placeholder.png",
      happy: "placeholder.png",
      sad: "placeholder.png",
      annoyed: "placeholder.png",
      surprised: "placeholder.png",
      tired: "placeholder.png",
    },
  },
  {
    part: "mouth",
    variants: {
      neutral: "placeholder.png",
      happy: "placeholder.png",
      sad: "placeholder.png",
      annoyed: "placeholder.png",
      surprised: "placeholder.png",
      tired: "placeholder.png",
    },
  },
];

/**
 * Blink controller: periodic blinking with natural timing
 */
export interface BlinkState {
  isOpen: boolean;
  nextBlinkTime: number; // ms timestamp
}

export function initBlinkState(): BlinkState {
  return {
    isOpen: true,
    nextBlinkTime: Date.now() + randomBlinkInterval(),
  };
}

function randomBlinkInterval(): number {
  // Natural blink rate: 3-7 seconds
  return 3000 + Math.random() * 4000;
}

/**
 * Update blink state, returns true if blink occurred
 */
export function updateBlink(state: BlinkState): { newState: BlinkState; didBlink: boolean } {
  const now = Date.now();
  
  if (now < state.nextBlinkTime) {
    return { newState: state, didBlink: false };
  }
  
  // Blink occurred
  const wasOpen = state.isOpen;
  
  // Blink duration: 100-200ms
  const blinkDuration = 100 + Math.random() * 100;
  const nextInterval = wasOpen ? blinkDuration : randomBlinkInterval();
  
  return {
    newState: {
      isOpen: !wasOpen,
      nextBlinkTime: now + nextInterval,
    },
    didBlink: wasOpen, // didBlink = transition from open to closed
  };
}
