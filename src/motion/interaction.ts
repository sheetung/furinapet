import { isDragDisplacement } from '../core/attention';
import { fallToGround, type GravityPort } from './gravity';
import type { Point } from '../core/wander-controller';
import type { MotionReaction } from '../core/sprite-motion';
import type { AppSettings } from '../types';
import type { ActionRequest, Schedule } from '../actions/types';
import type { MotionAuthority, MotionLease } from './authority';

export interface InteractionPort {
  position(): Promise<Point>;
  startDragging(): Promise<void>;
  waitForRelease(): Promise<void>;
  drain(): Promise<void>;
  invalidate(): void;
  gravity(valid: () => boolean): GravityPort;
}
export interface InteractionRuntime {
  authority: MotionAuthority;
  settings(): AppSettings | null;
  layoutBusy(): boolean;
  prepareRelease(): Promise<void>;
  pixelRatio(): number;
  now(): number;
  schedule: Schedule;
  playback: { readonly epoch: number; readonly active: boolean;
    block(reason: string, blocked: boolean): void; request(request: ActionRequest): Promise<unknown> };
  reaction(value: MotionReaction): void;
  dragging(value: boolean): void;
  clearLook(): void;
  observeInteraction(): void;
  dragStarted?(): void;
  dragCompleted?(moved: boolean): void;
  report(error: unknown): void;
}

/** Owns drag/release/fall lifetimes. Late native completions cannot release a newer owner. */
export class InteractionController {
  private revision = 0;
  private dragOwner: number | null = null;
  private nativeDragBusy = false;
  private nativeCompletion: Promise<void> = Promise.resolve();
  private dragging = false;
  private fall: AbortController | null = null;
  private fallLease: MotionLease | null = null;
  constructor(private port: InteractionPort, private runtime: InteractionRuntime) {}
  snapshot() { return { dragging: this.dragging, falling: this.fall !== null }; }
  waitForNativeDrag() { return this.nativeCompletion; }
  cancelFall() { this.fall?.abort(); this.fall = null; this.fallLease?.release(); this.fallLease = null; }
  cancel() {
    this.revision++;
    this.port.invalidate();
    this.runtime.authority.cancel('wander', 'gravity', 'drag');
    this.cancelFall();
    if (this.dragOwner !== null) {
      this.dragOwner = null;
      this.dragging = false;
      this.runtime.dragging(false);
      this.runtime.playback.block('drag', false);
    }
  }

  async settle(): Promise<boolean> {
    const settings = this.runtime.settings();
    if (!settings?.petVisible || !settings.gravityEnabled) return true;
    if (this.dragging || this.runtime.layoutBusy() || this.runtime.playback.active) return false;
    this.cancelFall();
    const lease = this.runtime.authority.acquire('gravity');
    if (!lease) return false;
    this.fallLease = lease;
    const controller = new AbortController();
    this.fall = controller;
    const epoch = this.runtime.playback.epoch;
    const revision = this.revision;
    const valid = () => lease.valid() && this.fall === controller && !controller.signal.aborted
      && revision === this.revision && epoch === this.runtime.playback.epoch
      && this.runtime.settings() === settings && !this.dragging && !this.runtime.layoutBusy();
    this.runtime.clearLook();
    try {
      await this.port.drain();
      if (!valid()) return false;
      const result = await fallToGround(this.port.gravity(valid), {
        signal: controller.signal, valid, now: this.runtime.now, schedule: this.runtime.schedule,
        onFalling: () => this.runtime.reaction('falling'),
      });
      if (result !== 'completed' || !valid()) return false;
      this.runtime.reaction('idle');
      return true;
    } catch (error) {
      if (valid()) { this.runtime.report(error); this.runtime.reaction('idle'); }
      return false;
    } finally {
      lease.release();
      if (this.fallLease === lease) this.fallLease = null;
      if (this.fall === controller) this.fall = null;
    }
  }

  async beginDrag(button: number) {
    const settings = this.runtime.settings();
    if (button !== 0 || this.nativeDragBusy || this.runtime.layoutBusy() || !settings?.petVisible) return;
    const lease = this.runtime.authority.acquire('drag');
    if (!lease) return;
    const owner = ++this.revision;
    this.dragOwner = owner;
    this.cancelFall();
    this.runtime.playback.block('drag', true);
    const epoch = this.runtime.playback.epoch;
    const valid = () => this.dragOwner === owner && this.revision === owner
      && this.runtime.playback.epoch === epoch && this.runtime.settings() === settings;
    this.port.invalidate();
    this.dragging = true;
    this.runtime.dragStarted?.();
    this.nativeDragBusy = true;
    let finishNative!: () => void;
    this.nativeCompletion = new Promise(resolve => { finishNative = resolve; });
    this.runtime.dragging(true);
    this.runtime.observeInteraction();
    this.runtime.clearLook();
    this.runtime.reaction('dragged');
    let moved = false, completed = false;
    try {
      await this.port.drain();
      if (!valid() || !lease.valid()) return;
      const start = await this.port.position();
      if (!valid() || !lease.valid()) return;
      await this.port.startDragging();
      // Even a cancelled native drag must finish before another native drag starts.
      await this.port.waitForRelease();
      if (!valid()) return;
      const end = await this.port.position();
      if (!valid()) return;
      moved = isDragDisplacement(start, end, this.runtime.pixelRatio());
      this.runtime.dragCompleted?.(moved);
      completed = true;
    } catch (error) {
      if (valid()) this.runtime.report(error);
    } finally {
      this.nativeDragBusy = false;
      lease.release();
      finishNative();
      if (this.dragOwner === owner) {
        this.dragging = false;
        this.runtime.dragging(false);
      }
      if (!valid()) this.release(owner);
    }
    // A return from the try still needs to release this owner's block.
    if (!valid()) { this.release(owner); return; }
    try {
      this.runtime.reaction('idle');
      await this.runtime.prepareRelease();
      if (!valid()) return;
      if (completed && moved) completed = await this.settle();
      if (!valid()) return;
    } catch (error) {
      completed = false;
      if (valid()) this.runtime.report(error);
    } finally {
      this.release(owner);
    }
    if (completed && moved && this.revision === owner && this.runtime.playback.epoch === epoch) {
      await this.runtime.playback.request({ actionId: 'drag-release', source: 'user', steps: [
        { reaction: 'idle', durationMs: 180 }, { reaction: 'jumping', durationMs: 840 },
        { reaction: 'idle', durationMs: 500 },
      ] });
    }
  }
  private release(owner: number) {
    if (this.dragOwner !== owner) return;
    this.dragOwner = null;
    this.runtime.playback.block('drag', false);
  }
}
