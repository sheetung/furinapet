import type { PetActionPlan, PetSemanticAction } from "./types";

export type PetActionHandler = (action: PetSemanticAction, signal: AbortSignal) => Promise<void> | void;

export interface ExecutorSnapshot {
  running: boolean;
  planId: string | null;
  goal: PetActionPlan["goal"] | null;
  score: number;
  actionIndex: number;
}

export interface RunPlanOptions {
  force?: boolean;
  interruptMargin?: number;
}

export class PetActionExecutor {
  private controller: AbortController | null = null;
  private plan: PetActionPlan | null = null;
  private actionIndex = -1;
  private generation = 0;

  async run(plan: PetActionPlan, handler: PetActionHandler, options: RunPlanOptions = {}) {
    const interruptMargin = Math.max(0, Math.min(0.5, options.interruptMargin ?? 0.08));
    if (
      this.plan
      && !options.force
      && plan.score + interruptMargin < this.plan.score
    ) {
      return false;
    }

    this.interrupt();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.plan = plan;

    try {
      for (let index = 0; index < plan.actions.length; index += 1) {
        if (controller.signal.aborted || generation !== this.generation) break;
        this.actionIndex = index;
        await handler(plan.actions[index], controller.signal);
      }
    } finally {
      if (generation === this.generation) {
        this.controller = null;
        this.plan = null;
        this.actionIndex = -1;
      }
    }
    return true;
  }

  interrupt() {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.plan = null;
    this.actionIndex = -1;
  }

  snapshot(): ExecutorSnapshot {
    return {
      running: this.plan !== null,
      planId: this.plan?.id ?? null,
      goal: this.plan?.goal ?? null,
      score: this.plan?.score ?? 0,
      actionIndex: this.actionIndex,
    };
  }
}

export function waitForAction(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted || milliseconds <= 0) {
      resolve();
      return;
    }
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
