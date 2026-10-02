import type { RoutineStep } from './action-routines';

export const ACTION_PRIORITY = { background: 10, agent: 20, user: 100 } as const;
export interface PlaybackSession {
  signal: AbortSignal;
  show(step: RoutineStep): void;
  wait(ms: number): Promise<void>;
}

/** One owner for a complete sequence, including pauses. Cancellation resets the view. */
export class ActionPlayback {
  private current: { controller: AbortController; priority: number } | null = null;
  private blocks = new Set<string>();
  private revision = 0;
  private listeners = new Set<(step: RoutineStep) => void>();
  constructor(private schedule = (callback: () => void, ms: number) => {
    const timer = globalThis.setTimeout(callback, ms);
    return () => globalThis.clearTimeout(timer);
  }) {}
  get active() { return this.current !== null; }
  get epoch() { return this.revision; }
  canStart(priority: number) {
    return this.blocks.size === 0 && (!this.current || priority >= this.current.priority);
  }
  subscribe(listener: (step: RoutineStep) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private show(step: RoutineStep) { this.listeners.forEach(listener => listener(step)); }
  stop() {
    this.revision++;
    const previous = this.current;
    this.current = null;
    previous?.controller.abort();
    this.show({ reaction: 'idle', durationMs: 0 });
  }
  block(reason: string, blocked: boolean) {
    if (blocked) { this.blocks.add(reason); this.stop(); }
    else this.blocks.delete(reason);
  }
  async run(priority: number, execute: (session: PlaybackSession) => Promise<void>): Promise<boolean> {
    if (!this.canStart(priority)) return false;
    this.stop();
    const owner = { controller: new AbortController(), priority };
    this.current = owner;
    const signal = owner.controller.signal;
    const session: PlaybackSession = {
      signal,
      show: step => { if (!signal.aborted) this.show(step); },
      wait: ms => new Promise<void>(resolve => {
        if (signal.aborted || ms <= 0) { resolve(); return; }
        const finish = () => { cancel(); signal.removeEventListener('abort', finish); resolve(); };
        const cancel = this.schedule(finish, ms);
        signal.addEventListener('abort', finish, { once: true });
      }),
    };
    try { await execute(session); return !signal.aborted; }
    finally { if (this.current === owner) this.stop(); }
  }
  play(steps: readonly RoutineStep[], priority: number) {
    return this.run(priority, async session => {
      for (const step of steps) {
        if (session.signal.aborted) break;
        session.show(step);
        await session.wait(step.durationMs);
      }
    });
  }
}

export const actionPlayback = new ActionPlayback();
