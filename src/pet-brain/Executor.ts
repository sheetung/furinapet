import type { PetActionPlan, PetSemanticAction } from "./types";

export type PetActionHandler = (action: PetSemanticAction, signal: AbortSignal) => Promise<void> | void;

export interface ExecutorSnapshot {
  running: boolean;
  planId: string | null;
  goal: PetActionPlan["goal"] | null;
  score: number;
  actionIndex: number;
}

/** Records semantic progress; the action coordinator owns cancellation and arbitration. */
export class PetActionExecutor {
  private current: { plan: PetActionPlan; actionIndex: number } | null = null;

  async run(plan: PetActionPlan, handler: PetActionHandler, signal: AbortSignal) {
    if (signal.aborted) return;
    const progress = { plan, actionIndex: -1 };
    this.current = progress;
    const clear = () => { if (this.current === progress) this.current = null; };
    signal.addEventListener('abort', clear, { once: true });
    try {
      for (let index = 0; index < plan.actions.length; index++) {
        if (signal.aborted || this.current !== progress) break;
        progress.actionIndex = index;
        await handler(plan.actions[index], signal);
      }
    } finally {
      signal.removeEventListener('abort', clear);
      clear();
    }
  }

  snapshot(): ExecutorSnapshot {
    const progress = this.current;
    return {
      running: progress !== null,
      planId: progress?.plan.id ?? null,
      goal: progress?.plan.goal ?? null,
      score: progress?.plan.score ?? 0,
      actionIndex: progress?.actionIndex ?? -1,
    };
  }
}
