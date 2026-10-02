import type { WorkArea, Point } from '../core/wander-controller';
import type { MotionAuthority } from './authority';

export function resetTarget(area: WorkArea, size: { width: number; height: number }): Point {
  return { x: Math.max(area.x, area.x + area.width - size.width - 32),
    y: Math.max(area.y, area.y + area.height - size.height) };
}

/** Serial reset ownership: older reads cannot commit after a newer request/disposal. */
export class WindowResetController {
  private revision = 0;
  private pending = false;
  constructor(private port: {
    authority: MotionAuthority;
    cancelMotion(): void;
    waitForDrag(): Promise<void>;
    reset(area: WorkArea, valid: () => boolean): Promise<void>;
  }) {}
  get busy() { return this.pending; }
  cancel() { this.revision++; this.pending = false; this.port.authority.cancel('reset'); }
  async reset(area: WorkArea) {
    const lease = this.port.authority.acquire('reset');
    if (!lease) return false;
    const revision = ++this.revision;
    this.pending = true;
    const valid = () => revision === this.revision && lease.valid();
    try {
      this.port.cancelMotion();
      await this.port.waitForDrag();
      if (!valid()) return false;
      await this.port.reset(area, valid);
      return valid();
    } finally {
      if (revision === this.revision) this.pending = false;
      lease.release();
    }
  }
}
