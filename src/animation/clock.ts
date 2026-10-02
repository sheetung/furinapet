/** One frame-aligned, monotonic clock for animation and action deadlines. */
export class AnimationClock {
  private jobs = new Map<number, { at: number; callback: () => void }>();
  private nextId = 0;
  private frame: number | null = null;
  constructor(
    readonly now = () => performance.now(),
    private requestFrame = (callback: FrameRequestCallback) => requestAnimationFrame(callback),
    private cancelFrame = (id: number) => cancelAnimationFrame(id),
  ) {}
  readonly schedule = (callback: () => void, ms: number) => {
    const id = ++this.nextId;
    this.jobs.set(id, { at: this.now() + Math.max(0, ms), callback });
    this.wake();
    return () => {
      this.jobs.delete(id);
      if (!this.jobs.size && this.frame !== null) {
        this.cancelFrame(this.frame);
        this.frame = null;
      }
    };
  };
  private wake() {
    if (this.frame === null && this.jobs.size) this.frame = this.requestFrame(() => this.tick());
  }
  private tick() {
    this.frame = null;
    const now = this.now();
    try {
      for (const [id, job] of [...this.jobs]) {
        if (job.at > now || !this.jobs.has(id)) continue;
        this.jobs.delete(id);
        job.callback();
      }
    } finally { this.wake(); }
  }
}
export const animationClock = new AnimationClock();
