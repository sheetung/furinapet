import { frameRows, motionDuration } from '../core/sprite-motion';
import type { ActionStep } from './types';
export type { ActionStep } from './types';

const publicReactions = new Set(['idle', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']);
const gestures = new Set(['double-blink', 'curious', 'doze', 'greeting', 'sitting', 'stretch-yawn', 'tea', 'cake', 'proud', 'breathing', 'nod', 'tea-enter', 'tea-sip', 'tea-exit']);
const activities = new Set(['idle', 'walk', 'play', 'observe', 'rest', 'sleep', 'tea', 'cake', 'paused']);

export function normalizeStep(step: ActionStep): ActionStep {
  if (!step || !Number.isFinite(step.durationMs) || step.durationMs < 0) throw new RangeError('Invalid action duration');
  if (!publicReactions.has(step.reaction) || (step.motion !== undefined && !gestures.has(step.motion))) throw new Error('Unknown action');
  if (step.message !== undefined && typeof step.message !== 'string') throw new Error('Invalid action message');
  if (step.activity !== undefined && !activities.has(step.activity)) throw new Error('Unknown activity');
  const motion = step.motion ?? step.reaction;
  if (!Object.hasOwn(frameRows, step.reaction) || !Object.hasOwn(frameRows, motion)) throw new Error('Unknown action');
  const minimum = frameRows[motion].once || step.durationMs === 0 ? motionDuration(motion) : 0;
  return { ...step, durationMs: Math.max(step.durationMs, minimum) };
}
