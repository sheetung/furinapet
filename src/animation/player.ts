import { animationClock, type AnimationClock } from './clock';
import { sampleClip, type AnimationClip, type ClipFrame } from './clip';

/** Samples elapsed time, skipping missed frames rather than replaying a backlog. */
export function playClip(clip: AnimationClip, startedAt: number,
  publish: (frame: ClipFrame) => void,
  clock: Pick<AnimationClock, 'now' | 'schedule'> = animationClock) {
  let stopped = false;
  let cancel = () => {};
  let lastCell = '';
  const tick = () => {
    if (stopped) return;
    const frame = sampleClip(clip, clock.now() - startedAt);
    const cell = `${frame.clipId ?? 'atlas'}:${frame.row}:${frame.column}`;
    if (cell !== lastCell) { lastCell = cell; publish(frame); }
    if (!stopped && frame.nextMs !== null) cancel = clock.schedule(tick, frame.nextMs);
  };
  tick();
  return () => { stopped = true; cancel(); };
}
