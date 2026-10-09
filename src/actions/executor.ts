import { normalizeStep } from './steps';
import type { ActionStep, ExecutionPhase, PlaybackSession, Schedule } from './types';
import { activityForStep } from './activity';
import type { Activity } from '../pet-brain/needs';

interface ExecutorOptions {
  signal: AbortSignal;
  owns: () => boolean;
  schedule: Schedule;
  display: (step: ActionStep) => void;
  phase: (phase: ExecutionPhase, durationMs: number | null) => void;
  activity?: (activity: Activity) => void;
  resolve?: (step: ActionStep) => ActionStep;
}

/** One accepted session's timeline. Arbitration and behavior selection live elsewhere. */
export function createExecutor(options: ExecutorOptions): PlaybackSession {
  const { signal, schedule, display, phase } = options;
  const owns = () => !signal.aborted && options.owns();
  let waiting = false;

  const wait = (ms: number, retainActivity = false): Promise<void> => {
    if (!Number.isFinite(ms) || ms < 0) return Promise.reject(new RangeError('Invalid wait duration'));
    if (!owns()) return Promise.resolve();
    if (waiting) return Promise.reject(new Error('Concurrent action steps are not supported'));
    if (!retainActivity) options.activity?.('idle');
    if (ms === 0) return Promise.resolve();
    waiting = true;
    phase('waiting', ms);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let cancel = () => {};
      const finish = () => {
        if (settled) return;
        settled = true;
        waiting = false;
        signal.removeEventListener('abort', finish);
        cancel();
        if (owns()) phase('displaying', null);
        resolve();
      };
      signal.addEventListener('abort', finish, { once: true });
      try {
        cancel = schedule(finish, ms);
        // Synchronous completion/abort inside a scheduler must also clear its handle.
        if (settled) cancel();
        else if (!owns()) finish();
      } catch (error) {
        settled = true;
        waiting = false;
        signal.removeEventListener('abort', finish);
        if (owns()) phase('displaying', null);
        reject(error);
      }
    });
  };

  return {
    signal, wait,
    perform: async step => {
      if (!owns()) return;
      if (waiting) throw new Error('Concurrent action steps are not supported');
      const normalized = options.resolve ? options.resolve(step) : normalizeStep(step);
      options.activity?.(activityForStep(normalized));
      phase('displaying', null);
      display(normalized);
      // Display subscribers may synchronously replace or block this session.
      if (owns()) await wait(normalized.durationMs, true);
    },
  };
}

export async function executeSteps(session: PlaybackSession, steps: readonly ActionStep[]) {
  for (const step of steps) {
    if (session.signal.aborted) break;
    await session.perform(step);
  }
}
