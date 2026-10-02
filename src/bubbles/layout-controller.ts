import { bubbleLayout } from './layout';
import type { MotionAuthority } from '../motion/authority';
import type { MotionWriteQueue } from '../motion/write-queue';

type Geometry = { x: number; y: number; width: number; height: number; factor: number; workAreaTop: number };
export interface BubbleLayoutPort {
  read(): Promise<Geometry>;
  apply(layout: ReturnType<typeof bubbleLayout>): Promise<void>;
}

/** Owns layout lifetime; native size + position remain one serialized transaction. */
export class BubbleLayoutController {
  revision = 0;
  busy = false;
  constructor(private port: BubbleLayoutPort, private runtime: {
    authority: MotionAuthority; queue: MotionWriteQueue;
    dragging(): boolean; cancelFall(): void;
    placement(value: 'above' | 'inside'): void; report(error: unknown): void;
  }) {}
  cancel() {
    this.revision++;
    this.busy = false;
    this.runtime.queue.invalidate('layout');
    this.runtime.authority.cancel('layout');
  }
  async resize(expanded: boolean, scale: number) {
    const lease = this.runtime.authority.acquire('layout');
    if (!lease) return;
    const revision = ++this.revision;
    const valid = () => lease.valid() && revision === this.revision && !this.runtime.dragging();
    this.busy = true;
    this.runtime.cancelFall();
    try {
      await this.runtime.queue.enqueue(async () => {
        const geometry = await this.port.read();
        if (!valid()) return;
        const next = bubbleLayout({ ...geometry, expanded, scale });
        this.runtime.placement(next.placement);
        if (geometry.width !== next.width || geometry.height !== next.height
          || geometry.x !== next.x || geometry.y !== next.y) await this.port.apply(next);
      }, valid, 'layout');
    } catch (error) {
      if (valid()) this.runtime.report(error);
    } finally {
      if (revision === this.revision) this.busy = false;
      lease.release();
    }
  }
}
