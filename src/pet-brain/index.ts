import { PetBlackboard } from "./Blackboard";
import { PetActionExecutor, type PetActionHandler, type RunPlanOptions } from "./Executor";
import { PetUtilityPlanner } from "./Planner";
import type {
  BrainAgentState,
  BrainContext,
  BrainIntent,
  BrainIntentSource,
  PetActionPlan,
  PetBrainSnapshot,
  PetGoalId,
} from "./types";

export * from "./types";
export { PetBlackboard } from "./Blackboard";
export { PetActionExecutor, waitForAction } from "./Executor";
export { PetUtilityPlanner } from "./Planner";

export interface PetBrainOptions {
  random?: () => number;
  isolated?: boolean;
}

interface PetBrainCore {
  blackboard: PetBlackboard;
  planner: PetUtilityPlanner;
  executor: PetActionExecutor;
}

let sharedCore: PetBrainCore | null = null;

function createCore(random?: () => number): PetBrainCore {
  return {
    blackboard: new PetBlackboard(),
    planner: new PetUtilityPlanner(random),
    executor: new PetActionExecutor(),
  };
}

function getSharedCore(random?: () => number) {
  if (!sharedCore) sharedCore = createCore(random);
  return sharedCore;
}

export class PetBrain {
  readonly blackboard: PetBlackboard;
  readonly planner: PetUtilityPlanner;
  readonly executor: PetActionExecutor;

  constructor(options: PetBrainOptions = {}) {
    const core = options.isolated ? createCore(options.random) : getSharedCore(options.random);
    this.blackboard = core.blackboard;
    this.planner = core.planner;
    this.executor = core.executor;
  }

  observeUserClick(now = Date.now()) {
    this.blackboard.observeUserClick(now);
  }

  observeUserInteraction(now = Date.now()) {
    this.blackboard.observeUserInteraction(now);
  }

  observeAgentState(state: BrainAgentState, now = Date.now()) {
    this.blackboard.observeAgentState(state, now);
  }

  submitIntent(
    source: BrainIntentSource,
    goal: PetGoalId,
    options: { priority?: number; ttlMs?: number; id?: string; now?: number } = {},
  ) {
    const now = options.now ?? Date.now();
    const priority = Math.min(1, Math.max(0, options.priority ?? 0.65));
    const ttlMs = Math.max(250, Math.min(60_000, options.ttlMs ?? 5000));
    const intent: BrainIntent = {
      id: options.id ?? `${source}-${goal}-${now}`,
      source,
      goal,
      priority,
      createdAt: now,
      expiresAt: now + ttlMs,
    };
    this.blackboard.submitIntent(intent);
    return intent.id;
  }

  plan(context: BrainContext): PetActionPlan {
    this.blackboard.tick(context.now, context.userReactionActive || !context.canMove);
    const activeIntents = this.blackboard.getActiveIntents(context.now);
    const plan = this.planner.plan(context, this.blackboard);
    const consumed = activeIntents.find((intent) => intent.goal === plan.goal);
    if (consumed) this.blackboard.consumeIntent(consumed.id);
    this.blackboard.recordDecision(plan.goal, context.now);
    return plan;
  }

  execute(plan: PetActionPlan, handler: PetActionHandler, options?: RunPlanOptions) {
    return this.executor.run(plan, handler, options);
  }

  interrupt() {
    this.executor.interrupt();
  }

  snapshot(now = Date.now()): PetBrainSnapshot & { executor: ReturnType<PetActionExecutor["snapshot"]> } {
    return {
      ...this.blackboard.snapshot(now),
      executor: this.executor.snapshot(),
    };
  }
}

export function getPetBrain() {
  return new PetBrain();
}
