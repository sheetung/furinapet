import { normalizeStep, type ActionStep } from './steps';
import { ACTION_PRIORITY, type ActionRequest, type ActionResult } from './types';
import { createExecutor, executeSteps } from './executor';
import { animationClock } from '../animation/clock';
import type { PlaybackSession, StopReason, ExecutionPhase, Schedule } from './types';
import type { Activity } from '../pet-brain/needs';
export { ACTION_PRIORITY } from './types';
export type { PlaybackSession, StopReason } from './types';
interface Owner {
  id: number;
  controller: AbortController;
  priority: number;
  phase: ExecutionPhase;
  step: ActionStep | null;
  deadline: number | null;
  result: ActionResult | null;
  actionId: string;
  activity: Activity;
}

type ExecutionState = { kind: 'idle' } | { kind: 'blocked' } | { kind: 'performing'; owner: Owner };

/** Exclusive session: asynchronous callbacks can update the view only while owning it. */
export class ActionCoordinator {
  private state: ExecutionState = { kind: 'idle' };
  private get current() { return this.state.kind === 'performing' ? this.state.owner : null; }
  private set current(owner: Owner | null) {
    this.state = owner ? { kind: 'performing', owner } : { kind: this.blocks.size ? 'blocked' : 'idle' };
  }
  private blocks = new Set<string>();
  private revision = 0;
  private lastReason: StopReason | null = null;
  private listeners = new Set<(step: ActionStep) => void>();
  private activityListeners = new Set<() => void>();
  subscribeActivity(listener: () => void) {
    this.activityListeners.add(listener);
    return () => { this.activityListeners.delete(listener); };
  }
  private publishActivity() { for (const listener of this.activityListeners) listener(); }
  private resolver: (step: ActionStep) => ActionStep = normalizeStep;
  setResolver(resolve: (step: ActionStep) => ActionStep) {
    this.resolver = resolve;
    return () => { if (this.resolver === resolve) this.resolver = normalizeStep; };
  }
  constructor(private schedule: Schedule = (callback, ms) => {
    const timer = globalThis.setTimeout(callback, ms);
    return () => globalThis.clearTimeout(timer);
  }, private now = () => performance.now()) {}

  get active() { return this.current !== null; }
  get epoch() { return this.revision; }
  snapshot() {
    const owner = this.current;
    return { state: this.state.kind, actionId: owner?.actionId ?? null,
      active: !!owner, sessionId: owner?.id ?? null, priority: owner?.priority ?? null,
      phase: owner?.phase ?? (this.blocks.size ? 'blocked' : 'idle'),
      activity: owner?.activity ?? null,
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
    const startedAt = this.now();
    for (const listener of this.listeners) listener({ ...step, startedAt });
  }
  private owns(owner: Owner) { return this.current === owner && !owner.controller.signal.aborted; }
  private release(owner: Owner, reason: StopReason, neutral: boolean, error?: unknown) {
    if (this.current !== owner) return;
    owner.result = reason === 'completed' ? { status: 'completed' }
      : reason === 'failed' ? { status: 'failed', error }
      : { status: 'cancelled', reason };
    this.current = null;
    this.revision++;
    this.lastReason = reason;
    this.publishActivity();
    owner.controller.abort();
    // An abort listener may have started a replacement session.
    if (neutral && !this.current) this.publish({ reaction: 'idle', durationMs: 0 });
  }
  stop() {
    if (this.current) this.release(this.current, 'cancelled', true);
    else { this.revision++; this.lastReason = 'cancelled'; this.publish({ reaction: 'idle', durationMs: 0 }); }
  }
  block(reason: string, blocked: boolean) {
    if (!blocked) {
      this.blocks.delete(reason);
      if (!this.current) this.current = null;
      return;
    }
    if (this.blocks.has(reason)) return;
    this.blocks.add(reason);
    if (this.current) this.release(this.current, 'blocked', true);
    else { this.current = null; this.revision++; this.lastReason = 'blocked'; this.publish({ reaction: 'idle', durationMs: 0 }); }
  }
  async execute(priority: number, execute: (session: PlaybackSession) => Promise<void>, actionId = 'semantic'): Promise<ActionResult> {
    if (!Number.isFinite(priority)) return { status: 'rejected', reason: 'invalid' };
    if (!this.canStart(priority)) return { status: 'rejected', reason: this.blocks.size ? 'blocked' : 'lower-priority' };
    if (this.current) this.release(this.current, 'replaced', false);
    if (this.current || this.blocks.size) return { status: 'rejected', reason: this.blocks.size ? 'blocked' : 'lower-priority' };
    const owner: Owner = { id: ++this.revision, controller: new AbortController(), priority,
      phase: 'starting', step: null, deadline: null, result: null, actionId, activity: 'idle' };
    this.current = owner;
    const session = createExecutor({
      signal: owner.controller.signal,
      owns: () => this.owns(owner),
      schedule: this.schedule,
      resolve: step => this.resolver(step),
      activity: activity => {
        if (!this.owns(owner)) return;
        owner.activity = activity;
        this.publishActivity();
      },
      display: step => {
        if (!this.owns(owner)) return;
        owner.step = step;
        this.publish(step);
      },
      phase: (phase, ms) => {
        if (!this.owns(owner)) return;
        owner.phase = phase;
        owner.deadline = ms === null ? null : this.now() + ms;
      },
    });
    try {
      await execute(session);
      this.release(owner, 'completed', true);
    } catch (error) {
      this.release(owner, 'failed', true, error);
    }
    return owner.result!;
  }
  async request(request: ActionRequest): Promise<ActionResult> {
    let plan: ActionStep[];
    try {
      if (!request || !Object.hasOwn(ACTION_PRIORITY, request.source) || !request.actionId?.trim()
        || !Array.isArray(request.steps) || !request.steps.length) throw new Error('Invalid request');
      plan = request.steps.map(step => { normalizeStep(step); return { ...step }; });
    } catch { return { status: 'rejected', reason: 'invalid' }; }
    return this.execute(ACTION_PRIORITY[request.source], session => executeSteps(session, plan), request.actionId);
  }

}

export const actionPlayback = new ActionCoordinator(animationClock.schedule, animationClock.now);
