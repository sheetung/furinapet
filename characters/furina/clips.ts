import type { AnimationClip } from '../../src/animation/clip';
import type { MotionReaction } from '../../src/core/sprite-motion';

/** Only populated v2 cells. One-shot gestures finish on a neutral pose. */
export const furinaClips: Record<MotionReaction, AnimationClip> = {
  idle: { row: 0, holds: [0, 3], durations: [1700, 120, 100, 1600, 130, 110] },
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
  doze: { row: 0, holds: [1, 2], columns: [0, 2, 2, 3], durations: [700, 2200, 2200, 700] },
  // Extension clips use explicit asset IDs; row 0 is the safe public-atlas fallback.
  greeting: { row: 0, clipId: 'greeting', durations: [250, 220, 350, 750, 300, 400], once: true },
  sitting: { row: 0, clipId: 'sitting', columns: [0, 1, 2, 3, 4, 3, 4, 5, 2, 1, 0], durations: [200, 280, 550, 400, 400, 400, 400, 1000, 350, 280, 350], once: true },
  'stretch-yawn': { row: 0, clipId: 'stretch', durations: [300, 350, 1000, 300, 1000, 650], once: true },
  tea: { row: 0, clipId: 'tea', holds: [3], durations: [500, 450, 550, 1500, 500, 650], once: true },
  cake: { row: 0, clipId: 'cake', holds: [3, 4], durations: [450, 400, 450, 800, 900, 550], once: true },
  proud: { row: 0, clipId: 'proud', holds: [3, 4], durations: [250, 300, 500, 900, 650, 400], once: true },
  failed: { row: 5, finish: 'hold', durations: [140, 140, 140, 140, 140, 140, 140, 240], once: true },
  waiting: { row: 6, durations: [800, 180, 200, 130, 150, 1100] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [700, 180, 200, 220, 180, 850] },
};
