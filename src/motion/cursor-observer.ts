import type { Point } from '../core/wander-controller';

export interface CursorObservation {
  at: number;
  near: boolean;
  moving: boolean;
  speed: number;
}

/** Screen-space displacement distinguishes user movement from pet/window movement. */
export class CursorObserver {
  private previous: { point: Point; at: number } | null = null;
  reset() { this.previous = null; }
  sample(point: Point, origin: Point, at: number, factor: number): CursorObservation {
    const previous = this.previous;
    this.previous = { point: { ...point }, at };
    const dt = previous ? at - previous.at : 0;
    const distance = previous ? Math.hypot(point.x - previous.point.x, point.y - previous.point.y) / factor : 0;
    const moving = dt > 0 && dt <= 500 && distance >= 3;
    return { at, near: Math.hypot(point.x - origin.x, point.y - origin.y) < 650 * factor,
      moving, speed: moving ? distance * 1000 / dt : 0 };
  }
}
