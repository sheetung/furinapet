import type { Point, PetSize, WindowSurface } from '../core/wander-controller';

/** Session-only preferences: user placement wins over automatic window visits. */
export class DockPolicyMemory {
  private blockedUntil = new Map<string, number>();
  private dockId: string | null = null;
  private draggedFrom: string | null = null;
  private placedUntil = 0;
  setDock(id: string | null) { this.dockId = id; }
  beginDrag() { this.draggedFrom = this.dockId; }
  finishDrag(moved: boolean, now: number) {
    if (moved) {
      if (this.draggedFrom) this.blockedUntil.set(this.draggedFrom, now + 300000);
      this.placedUntil = now + 300000;
    }
    this.draggedFrom = null;
  }
  prefersPlacement(now: number) { return now < this.placedUntil; }
  allowWindow(surface: WindowSurface, now: number, random = Math.random) {
    for (const [id, until] of this.blockedUntil) if (until <= now) this.blockedUntil.delete(id);
    if (this.prefersPlacement(now) || this.blockedUntil.has(surface.id)) return false;
    if (surface.isForeground && random() >= .2) {
      this.blockedUntil.set(surface.id, now + 60000);
      return false;
    }
    return true;
  }
}

export function awayFromCursor(point: Point, size: PetSize, cursor: Point, radius: number) {
  const dx = Math.max(point.x - cursor.x, 0, cursor.x - point.x - size.width);
  const dy = Math.max(point.y - cursor.y, 0, cursor.y - point.y - size.height);
  return Math.hypot(dx, dy) >= radius;
}
