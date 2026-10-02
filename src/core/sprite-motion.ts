import type { Reaction } from '../types';

export type GestureMotion = 'double-blink' | 'curious' | 'doze' | 'greeting' | 'sitting' | 'stretch-yawn' | 'tea' | 'cake' | 'proud';
export type MotionReaction = Reaction | GestureMotion | 'run-left' | 'run-right' | 'airborne' | 'falling' | 'dragged';

export function locomotionReaction(dx: number, dy: number, grounded: boolean): MotionReaction {
  if (!grounded && Math.abs(dy) > Math.abs(dx) * 1.25) return dy < 0 ? 'airborne' : 'falling';
  return dx >= 0 ? 'run-right' : 'run-left';
}

export function isTravelMotion(reaction: MotionReaction) {
  return ['run-left', 'run-right', 'airborne', 'falling'].includes(reaction);
}
export interface FrameRow {
  row: number;
  durations: readonly number[];
  columns?: readonly number[];
  once?: boolean;
}

/** Only populated v2 cells. One-shot gestures finish on a neutral pose. */
export const frameRows: Record<MotionReaction, FrameRow> = {
  idle: { row: 0, durations: [1700, 120, 100, 1600, 130, 110] },
  'run-right': { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  'run-left': { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, columns: [0, 1, 2, 1, 2, 3, 0], durations: [180, 150, 170, 150, 170, 180, 180], once: true },
  jumping: { row: 4, durations: [170, 130, 180, 140, 220], once: true },
  // Continuous travel must never finish on idle while the native window is moving.
  airborne: { row: 4, columns: [1, 2, 1, 2], durations: [180, 220, 180, 220] },
  falling: { row: 4, columns: [2, 1], durations: [220, 180] },
  dragged: { row: 4, columns: [1, 2, 1, 2], durations: [280, 320, 280, 320] },
  'double-blink': { row: 0, columns: [0, 2, 3, 2, 3, 0], durations: [300, 100, 180, 100, 450, 400], once: true },
  curious: { row: 8, columns: [0, 1, 2, 4, 2, 5], durations: [250, 300, 800, 450, 500, 400], once: true },
  doze: { row: 0, columns: [0, 2, 2, 3], durations: [700, 2200, 2200, 700] },
  // Rows 11–14 are internal extension keys, not rows of the public v2 atlas.
  greeting: { row: 11, durations: [250, 220, 350, 750, 300, 400], once: true },
  sitting: { row: 12, columns: [0, 1, 2, 3, 4, 3, 4, 5, 2, 1, 0], durations: [200, 280, 550, 400, 400, 400, 400, 1000, 350, 280, 350], once: true },
  'stretch-yawn': { row: 13, durations: [300, 350, 1000, 300, 1000, 650], once: true },
  tea: { row: 14, durations: [500, 450, 550, 1500, 500, 650], once: true },
  cake: { row: 15, durations: [450, 400, 450, 800, 900, 550], once: true },
  proud: { row: 16, durations: [250, 300, 500, 900, 650, 400], once: true },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240], once: true },
  waiting: { row: 6, durations: [800, 180, 200, 130, 150, 1100] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [700, 180, 200, 220, 180, 850] },
};

export function motionDuration(reaction: MotionReaction) {
  return frameRows[reaction].durations.reduce((sum, ms) => sum + ms, 0);
}

export function resolveMotion(step: { reaction: Reaction; motion?: GestureMotion }, characterId: string, source?: string): MotionReaction {
  return characterId === 'furina' && source === 'built-in' && step.motion ? step.motion : step.reaction;
}

export function sampleMotion(reaction: MotionReaction, elapsedMs: number) {
  const spec = frameRows[reaction];
  const total = motionDuration(reaction);
  const elapsed = Math.max(0, elapsedMs);
  if (spec.once && elapsed >= total) {
    // Failed remains a held expression; wave and jump return to the original idle pose.
    return reaction === 'failed'
      ? { row: spec.row, column: spec.durations.length - 1, nextMs: null }
      : { row: 0, column: 0, nextMs: null };
  }
  let remaining = spec.once ? elapsed : elapsed % total;
  for (let frame = 0; frame < spec.durations.length; frame++) {
    if (remaining < spec.durations[frame]) {
      return { row: spec.row, column: spec.columns?.[frame] ?? frame, nextMs: spec.durations[frame] - remaining };
    }
    remaining -= spec.durations[frame];
  }
  return { row: 0, column: 0, nextMs: null };
}
