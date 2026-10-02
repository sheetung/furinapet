import type { Point, WorkArea } from '../core/wander-controller';
import type { Schedule } from '../actions/types';

export interface GravityPort {
  position(): Promise<Point>;
  size(): Promise<{ width: number; height: number }>;
  workArea(position: Point, size: { width: number; height: number }): Promise<WorkArea>;
  move(position: Point): Promise<void>;
}
export type MotionResult = 'completed' | 'cancelled';

/** Cancellation is checked after every native read and before every position write. */
export async function fallToGround(port: GravityPort, options: {
  signal: AbortSignal;
  valid: () => boolean;
  now: () => number;
  schedule: Schedule;
  onFalling: () => void;
}): Promise<MotionResult> {
  const valid = () => !options.signal.aborted && options.valid();
  const [position, size] = await Promise.all([port.position(), port.size()]);
  if (!valid()) return 'cancelled';
  const area = await port.workArea(position, size);
  if (!valid()) return 'cancelled';
  const ground = Math.max(area.y, area.y + area.height - size.height);
  if (position.y >= ground - 1) {
    await port.move({ x: position.x, y: ground });
    return valid() ? 'completed' : 'cancelled';
  }
  options.onFalling();
  let y = position.y, velocity = 40, previous = options.now();
  while (y < ground && valid()) {
    await new Promise<void>(resolve => {
      let settled = false;
      let cancel = () => {};
      const finish = () => {
        if (settled) return;
        settled = true;
        cancel();
        options.signal.removeEventListener('abort', finish);
        resolve();
      };
      options.signal.addEventListener('abort', finish, { once: true });
      cancel = options.schedule(finish, 16);
      if (settled) cancel();
      else if (!valid()) finish();
    });
    if (!valid()) return 'cancelled';
    const now = options.now();
    const seconds = Math.min(.05, Math.max(0, now - previous) / 1000);
    previous = now;
    velocity = Math.min(1250, velocity + 2200 * seconds);
    y = Math.min(ground, y + velocity * seconds);
    await port.move({ x: position.x, y: Math.round(y) });
  }
  return valid() ? 'completed' : 'cancelled';
}
