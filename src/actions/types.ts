import type { Reaction } from '../types';
import type { GestureMotion } from '../core/sprite-motion';

export const ACTION_PRIORITY = { background: 10, agent: 20, user: 100 } as const;
export type ActionSource = keyof typeof ACTION_PRIORITY;
export type StopReason = 'completed' | 'cancelled' | 'replaced' | 'blocked' | 'failed';
export type ExecutionPhase = 'starting' | 'displaying' | 'waiting';
export type Schedule = (callback: () => void, ms: number) => () => void;
export interface PlaybackSession {
  signal: AbortSignal;
  wait(ms: number): Promise<void>;
  perform(step: ActionStep): Promise<void>;
}
export interface ActionStep {
  reaction: Reaction;
  /** Minimum display time; zero means one full clip. */
  durationMs: number;
  message?: string;
  motion?: GestureMotion;
  /** Internal monotonic start time, assigned by the coordinator. */
  startedAt?: number;
}
export interface ActionRequest {
  actionId: string;
  source: ActionSource;
  steps: readonly ActionStep[];
}
export type ActionResult =
  | { status: 'completed' }
  | { status: 'rejected'; reason: 'blocked' | 'lower-priority' | 'invalid' }
  | { status: 'cancelled'; reason: 'cancelled' | 'replaced' | 'blocked' }
  | { status: 'failed'; error: unknown };
