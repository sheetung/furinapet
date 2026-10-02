import type { Schedule } from '../actions/types';

/** Gravity is independent of autonomy; busy actions/layout defer rather than discard it. */
export function requestSettling(runtime: {
  schedule: Schedule;
  enabled(): boolean;
  falling(): boolean;
  settle(): Promise<boolean>;
}) {
  let cancelled = false;
  let cancelTimer = () => {};
  const attempt = async () => {
    if (cancelled || !runtime.enabled()) return;
    const completed = !runtime.falling() && await runtime.settle();
    if (!cancelled && runtime.enabled() && !completed) {
      cancelTimer = runtime.schedule(() => void attempt(), 100);
    }
  };
  cancelTimer = runtime.schedule(() => void attempt(), 80);
  return () => { cancelled = true; cancelTimer(); };
}
