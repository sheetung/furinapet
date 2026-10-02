/** Dwell before changing gaze; return slowly rather than following boundary jitter. */
export class AttentionTracker {
  private candidate: number | null = null;
  private candidateSince = 0;
  private current: number | null = null;
  private changedAt = 0;
  reset(now: number) {
    this.candidate = this.current = null;
    this.candidateSince = this.changedAt = now;
  }
  update(target: number | null, now: number): number | null {
    if (target !== this.candidate) {
      this.candidate = target;
      this.candidateSince = now;
    }
    const dwell = target === null ? 650 : 280;
    if (now - this.candidateSince >= dwell && now - this.changedAt >= 450 && this.current !== target) {
      this.current = target;
      this.changedAt = now;
    }
    return this.current;
  }
}

export function isDragDisplacement(start: { x: number; y: number }, end: { x: number; y: number }, scale = 1) {
  return Math.hypot(end.x - start.x, end.y - start.y) > 8 * scale;
}
