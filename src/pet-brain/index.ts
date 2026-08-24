import { PetBlackboard } from "./Blackboard";
import { PetActionExecutor, type PetActionHandler } from "./Executor";
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
}

export class PetBrain {
  readonly blackboard: PetBlackboard;
  readonly planner: PetUtilityPlanner;
  readonly executor: PetActionExecutor;

  constructor(options: PetBrainOptions = {}) {
    this.blackboard = new PetBlackboard();
    this.planner = new PetUtilityPlanner(options.random);
    this.executor = new PetActionExecutor();
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
    this.blackboard.observeAgentState(context.agentState, context.now);
    const plan = this.planner.plan(context, this.blackboard);
    this.blackboard.recordDecision(plan.goal, context.now);
    return plan;
  }

  async execute(plan: PetActionPlan, handler: PetActionHandler) {
    await this.executor.run(plan, handler);
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
