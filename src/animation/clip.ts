export interface AnimationClip {
  row: number;
  clipId?: string;
  durations: readonly number[];
  columns?: readonly number[];
  once?: boolean;
  finish?: 'neutral' | 'hold';
  holds?: readonly number[];
}
export interface ClipFrame { row: number; column: number; clipId?: string; nextMs: number | null }
export function clipDuration(clip: AnimationClip) {
  return clip.durations.reduce((sum, ms) => sum + ms, 0);
}
export function clipPhase(clip: AnimationClip, elapsed: number): 'motion' | 'hold' | 'complete' {
  const total = clipDuration(clip);
  if (clip.once && elapsed >= total) return clip.finish === 'hold' ? 'hold' : 'complete';
  let remaining = Math.max(0, elapsed) % total;
  for (let index = 0; index < clip.durations.length; index++) {
    if (remaining < clip.durations[index]) return clip.holds?.includes(index) ? 'hold' : 'motion';
    remaining -= clip.durations[index];
  }
  return 'complete';
}
export function sampleClip(clip: AnimationClip, elapsedMs: number): ClipFrame {
  const total = clipDuration(clip), elapsed = Math.max(0, elapsedMs);
  const frame = (index: number, nextMs: number | null): ClipFrame => ({
    ...(clip.clipId ? { clipId: clip.clipId } : {}), row: clip.row,
    column: clip.columns?.[index] ?? index, nextMs,
  });
  if (clip.once && elapsed >= total) return clip.finish === 'hold'
    ? frame(clip.durations.length - 1, null) : { row: 0, column: 0, nextMs: null };
  let remaining = clip.once ? elapsed : elapsed % total;
  for (let index = 0; index < clip.durations.length; index++) {
    if (remaining < clip.durations[index]) return frame(index, clip.durations[index] - remaining);
    remaining -= clip.durations[index];
  }
  return { row: 0, column: 0, nextMs: null };
}
