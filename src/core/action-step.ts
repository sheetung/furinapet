import type { Reaction } from '../types';
import { frameRows, motionDuration, type GestureMotion } from './sprite-motion';

export interface ActionStep {
  reaction: Reaction;
  /** Minimum display time; zero uses the clip duration. */
  durationMs: number;
  message?: string;
  motion?: GestureMotion;
}

export function normalizeStep(step: ActionStep): ActionStep {
  if (!Number.isFinite(step.durationMs) || step.durationMs < 0) throw new RangeError('Invalid action duration');
  const motion = step.motion ?? step.reaction;
  if (!Object.hasOwn(frameRows, step.reaction) || !Object.hasOwn(frameRows, motion)) throw new Error('Unknown action');
  const minimum = frameRows[motion].once || step.durationMs === 0 ? motionDuration(motion) : 0;
  return { ...step, durationMs: Math.max(step.durationMs, minimum) };
}
