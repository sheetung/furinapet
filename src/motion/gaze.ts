import { AttentionTracker } from '../core/attention';
import { computeLookDirection, lookCell } from '../core/look-direction';
import { CursorObserver } from './cursor-observer';
import { GazeInterest } from './gaze-interest';
import type { WanderPort, WanderRuntime } from './wander';

const GAZE_INTERVAL_MS = 48;

/** Gaze has its own sampler; a slow docking query cannot freeze cursor tracking. */
export function startGazeController(port: Pick<WanderPort, 'position' | 'size' | 'cursor'>,
  runtime: Pick<WanderRuntime, 'settings' | 'reaction' | 'playback' | 'layoutEpoch' | 'layoutBusy'
    | 'motion' | 'now' | 'wallNow' | 'pixelRatio' | 'schedule' | 'observeCursor' | 'setLook'>) {
  const attention = new AttentionTracker();
  const observer = new CursorObserver();
  const interest = new GazeInterest();
  let stopped = false, cancel = () => {};
  const clear = () => { attention.reset(runtime.now()); observer.reset(); interest.reset(); runtime.setLook(null); };
  const tick = async () => {
    if (stopped) return;
    const startedAt = runtime.now();
    const settings = runtime.settings();
    const epoch = runtime.playback.epoch, layout = runtime.layoutEpoch();
    const blocked = () => runtime.layoutBusy() || runtime.motion().dragging || runtime.motion().falling;
    try {
      if (!settings?.petVisible || blocked()) { clear(); return; }
      const [position, size, cursor] = await Promise.all([port.position(), port.size(), port.cursor()]);
      if (stopped) return;
      if (runtime.settings() !== settings || runtime.playback.epoch !== epoch
        || runtime.layoutEpoch() !== layout || blocked()) { clear(); return; }
      const factor = runtime.pixelRatio();
      const origin = { x: position.x + size.width / 2,
        y: position.y + size.height - 208 * settings.scale * factor / 2 };
      const observation = observer.sample(cursor, origin, runtime.wallNow(), factor);
      runtime.observeCursor(observation);
      if (!settings.lookAtCursor || runtime.reaction() !== 'idle') {
        attention.reset(runtime.now()); interest.reset(); runtime.setLook(null); return;
      }
      // Only the centre is ambiguous. Do not exclude most of the character's body.
      const distance = Math.hypot(cursor.x - origin.x, cursor.y - origin.y) / factor;
      const interested = interest.allows(distance, observation.moving, runtime.now());
      const target = interested && distance > 24 * settings.scale
        ? computeLookDirection(origin, cursor).index : null;
      const index = attention.update(target, runtime.now(), observation.moving);
      // Publish desired state even if unchanged: another action may have cleared the view.
      runtime.setLook(index === null ? null : lookCell(index));
    } catch {
      if (!stopped) clear();
    } finally {
      // Native reads consume part of the sampling interval; never stack another
      // full interval on top of that latency or overlap pending reads.
      if (!stopped) cancel = runtime.schedule(() => void tick(),
        Math.max(0, GAZE_INTERVAL_MS - (runtime.now() - startedAt)));
    }
  };
  void tick();
  return () => { stopped = true; cancel(); };
}
