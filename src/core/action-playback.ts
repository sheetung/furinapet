import { normalizeStep, type ActionStep } from './action-step';

export const ACTION_PRIORITY = { background: 10, agent: 20, user: 100 } as const;
export type StopReason = 'completed' | 'cancelled' | 'replaced' | 'blocked' | 'failed';
export interface PlaybackSession {
  signal: AbortSignal;
  show(step: ActionStep): void;
  wait(ms: number): Promise<void>;
  perform(step: ActionStep): Promise<void>;
}
interface Owner {
  id: number;
  controller: AbortController;
  priority: number;
  phase: 'starting' | 'displaying' | 'waiting';
  step: ActionStep | null;
  deadline: number | null;
  pending: Set<() => void>;
}

/** Exclusive session: asynchronous callbacks can update the view only while owning it. */
export class ActionPlayback {
  private current: Owner | null = null;
  private blocks = new Set<string>();
  private revision = 0;
  private lastReason: StopReason | null = null;
  private listeners = new Set<(step: ActionStep) => void>();
  constructor(private schedule = (callback: () => void, ms: number) => {
    const timer = globalThis.setTimeout(callback, ms);
    return () => globalThis.clearTimeout(timer);
  }, private now = () => performance.now()) {}

  get active() { return this.current !== null; }
  get epoch() { return this.revision; }
  snapshot() {
    const owner = this.current;
    return { active: !!owner, sessionId: owner?.id ?? null, priority: owner?.priority ?? null,
      phase: owner?.phase ?? (this.blocks.size ? 'blocked' : 'idle'),
      step: owner?.step ? { ...owner.step } : null,
      remainingMs: owner?.deadline == null ? null : Math.max(0, owner.deadline - this.now()),
      blocks: [...this.blocks], lastReason: this.lastReason };
  }
  canStart(priority: number) {
    return Number.isFinite(priority) && this.blocks.size === 0 && (!this.current || priority >= this.current.priority);
  }
  subscribe(listener: (step: ActionStep) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private publish(step: ActionStep) {
    for (const listener of this.listeners) listener({ ...step });
  }
  private owns(owner: Owner) { return this.current === owner && !owner.controller.signal.aborted; }
  private release(owner: Owner, reason: StopReason, neutral: boolean) {
    if (this.current !== owner) return;
    this.current = null;
    this.revision++;
    this.lastReason = reason;
    owner.controller.abort();
    for (const finish of [...owner.pending]) finish();
    // An abort listener may have started a replacement session.
    if (neutral && !this.current) this.publish({ reaction: 'idle', durationMs: 0 });
  }
  stop() {
    if (this.current) this.release(this.current, 'cancelled', true);
    else { this.revision++; this.lastReason = 'cancelled'; this.publish({ reaction: 'idle', durationMs: 0 }); }
  }
  block(reason: string, blocked: boolean) {
    if (!blocked) { this.blocks.delete(reason); return; }
    if (this.blocks.has(reason)) return;
    this.blocks.add(reason);
    if (this.current) this.release(this.current, 'blocked', true);
    else { this.revision++; this.lastReason = 'blocked'; this.publish({ reaction: 'idle', durationMs: 0 }); }
  }
  private display(owner: Owner, step: ActionStep) {
    if (!this.owns(owner)) return;
    owner.step = normalizeStep(step);
    owner.phase = 'displaying';
    this.publish(owner.step);
  }
  private wait(owner: Owner, ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) return Promise.reject(new RangeError('Invalid wait duration'));
    if (!this.owns(owner) || ms === 0) return Promise.resolve();
    owner.phase = 'waiting';
    owner.deadline = this.now() + ms;
    return new Promise<void>(resolve => {
      let settled = false;
      let cancel = () => {};
      const finish = () => {
        if (settled) return;
        settled = true;
        cancel();
        owner.pending.delete(finish);
        owner.deadline = null;
        resolve();
      };
      owner.pending.add(finish);
      cancel = this.schedule(finish, ms);
    });
  }
  async run(priority: number, execute: (session: PlaybackSession) => Promise<void>): Promise<boolean> {
    if (!this.canStart(priority)) return false;
    if (this.current) this.release(this.current, 'replaced', false);
    if (this.current || this.blocks.size) return false;
    const owner: Owner = { id: ++this.revision, controller: new AbortController(), priority,
      phase: 'starting', step: null, deadline: null, pending: new Set() };
    this.current = owner;
    const session: PlaybackSession = {
      signal: owner.controller.signal,
      show: step => this.display(owner, step),
      wait: ms => this.wait(owner, ms),
      perform: async step => {
        if (!this.owns(owner)) return;
        const normalized = normalizeStep(step);
        this.display(owner, normalized);
        await this.wait(owner, normalized.durationMs);
      },
    };
    try {
      await execute(session);
      const completed = this.owns(owner);
      this.release(owner, 'completed', true);
      return completed;
    } catch (error) {
      this.release(owner, 'failed', true);
      throw error;
    }
  }
  async play(steps: readonly ActionStep[], priority: number) {
    if (!this.canStart(priority) || steps.length === 0) return false;
    // Copy and validate before cancellation so bad input cannot replace a valid action.
    const plan = steps.map(normalizeStep);
    return this.run(priority, async session => {
      for (const step of plan) {
        if (session.signal.aborted) break;
        await session.perform(step);
      }
    });
  }
}

export const actionPlayback = new ActionPlayback();
