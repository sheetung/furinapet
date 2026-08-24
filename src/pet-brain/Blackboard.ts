import type {
  AiSuggestionTrace,
  BrainAgentState,
  BrainHistoryEntry,
  BrainIntent,
  PetActionPlan,
  PetBrainSnapshot,
  PetGoalId,
  PetMood,
} from "./types";

const HISTORY_LIMIT = 12;
const AI_TRACE_LIMIT = 8;
const CLICK_STREAK_WINDOW_MS = 1800;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export class PetBlackboard {
  private currentGoal: PetGoalId = "idle";
  private mood: PetMood = "normal";
  private energy = 0.78;
  private clickStreak = 0;
  private lastClickAt: number | null = null;
  private lastUserInteractionAt: number | null = null;
  private lastAgentActivityAt: number | null = null;
  private lastDecisionAt: number | null = null;
  private lastTickAt: number | null = null;
  private agentState: BrainAgentState = "idle";
  private history: BrainHistoryEntry[] = [];
  private intents: BrainIntent[] = [];
  private lastDecision: PetBrainSnapshot["lastDecision"] = null;
  private aiSuggestions: AiSuggestionTrace[] = [];

  observeUserClick(now: number) {
    this.clickStreak = this.lastClickAt !== null && now - this.lastClickAt <= CLICK_STREAK_WINDOW_MS
      ? this.clickStreak + 1
      : 1;
    this.lastClickAt = now;
    this.lastUserInteractionAt = now;
    this.energy = clamp01(this.energy - 0.012);
    this.refreshMood();
  }

  observeUserInteraction(now: number) {
    this.lastUserInteractionAt = now;
  }

  observeAgentState(state: BrainAgentState, now: number) {
    this.agentState = state;
    if (state !== "idle") this.lastAgentActivityAt = now;
    this.refreshMood();
  }

  getAgentState() {
    return this.agentState;
  }

  submitIntent(intent: BrainIntent) {
    this.intents = this.intents.filter((item) => item.id !== intent.id);
    this.intents.push(intent);
  }

  getActiveIntents(now: number) {
    const expiredIds = new Set(this.intents.filter((intent) => intent.expiresAt <= now).map((intent) => intent.id));
    this.intents = this.intents.filter((intent) => intent.expiresAt > now);
    if (expiredIds.size > 0) {
      this.aiSuggestions = this.aiSuggestions.map((item) => (
        item.status === "pending" && expiredIds.has(item.id)
          ? { ...item, status: "rejected", decidedAt: now, reason: "TTL 到期前未被 Planner 选择" }
          : item
      ));
    }
    return [...this.intents].sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
  }

  consumeIntent(id: string) {
    this.intents = this.intents.filter((intent) => intent.id !== id);
  }

  recordAiSuggestion(id: string, goal: PetGoalId, confidence: number, ttlMs: number, now: number) {
    const trace: AiSuggestionTrace = {
      id,
      at: now,
      goal,
      confidence: clamp01(confidence),
      ttlMs,
      expiresAt: now + ttlMs,
      status: "pending",
      reason: "等待 Utility Planner 决策",
    };
    this.aiSuggestions = [trace, ...this.aiSuggestions.filter((item) => item.id !== id)].slice(0, AI_TRACE_LIMIT);
  }

  markAiSuggestionAccepted(id: string, plan: PetActionPlan, now: number) {
    this.aiSuggestions = this.aiSuggestions.map((item) => (
      item.id === id
        ? { ...item, status: "accepted", decidedAt: now, reason: `Planner 选择 ${plan.goal} · ${(plan.score * 100).toFixed(0)}%` }
        : item
    ));
  }

  tick(now: number, isBusy: boolean) {
    const elapsedMs = this.lastTickAt === null ? 0 : Math.min(5000, Math.max(0, now - this.lastTickAt));
    this.lastTickAt = now;

    if (this.lastClickAt !== null && now - this.lastClickAt > CLICK_STREAK_WINDOW_MS) {
      this.clickStreak = 0;
    }

    const elapsedSeconds = elapsedMs / 1000;
    const energyDelta = isBusy ? -0.0025 * elapsedSeconds : 0.004 * elapsedSeconds;
    this.energy = clamp01(this.energy + energyDelta);
    this.getActiveIntents(now);
    this.refreshMood();
  }

  recordDecision(plan: PetActionPlan) {
    this.currentGoal = plan.goal;
    this.lastDecisionAt = plan.createdAt;
    this.lastDecision = {
      planId: plan.id,
      at: plan.createdAt,
      goal: plan.goal,
      score: plan.score,
      reason: plan.reason,
      candidates: plan.candidates.map((item) => ({ ...item })),
      actions: plan.actions.map((action) => ({ ...action })),
    };
    this.history.unshift({ goal: plan.goal, at: plan.createdAt });
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;

    if (plan.goal === "wander" || plan.goal === "dock") this.energy = clamp01(this.energy - 0.02);
    if (plan.goal === "celebrate") this.energy = clamp01(this.energy - 0.035);
    if (plan.goal === "rest") this.energy = clamp01(this.energy + 0.05);
    this.refreshMood();
  }

  goalRepeatCount(goal: PetGoalId) {
    let count = 0;
    for (const item of this.history) {
      if (item.goal !== goal) break;
      count += 1;
    }
    return count;
  }

  msSinceGoal(goal: PetGoalId, now: number) {
    const entry = this.history.find((item) => item.goal === goal);
    return entry ? Math.max(0, now - entry.at) : Number.POSITIVE_INFINITY;
  }

  getEnergy() {
    return this.energy;
  }

  getMood() {
    return this.mood;
  }

  getClickStreak() {
    return this.clickStreak;
  }

  getLastUserInteractionAt() {
    return this.lastUserInteractionAt;
  }

  getLastAgentActivityAt() {
    return this.lastAgentActivityAt;
  }

  snapshot(now = Date.now()): PetBrainSnapshot {
    this.getActiveIntents(now);
    return {
      currentGoal: this.currentGoal,
      mood: this.mood,
      energy: this.energy,
      agentState: this.agentState,
      clickStreak: this.clickStreak,
      lastUserInteractionAt: this.lastUserInteractionAt,
      lastAgentActivityAt: this.lastAgentActivityAt,
      lastDecisionAt: this.lastDecisionAt,
      pendingIntentCount: this.intents.length,
      history: [...this.history],
      lastDecision: this.lastDecision ? {
        ...this.lastDecision,
        candidates: this.lastDecision.candidates.map((item) => ({ ...item })),
        actions: this.lastDecision.actions.map((action) => ({ ...action })),
      } : null,
      aiSuggestions: this.aiSuggestions.map((item) => ({ ...item })),
    };
  }

  private refreshMood() {
    if (this.energy < 0.28) {
      this.mood = "tired";
      return;
    }
    if (["thinking", "editing", "testing", "waiting"].includes(this.agentState)) {
      this.mood = "focused";
      return;
    }
    if (this.clickStreak >= 2 || this.agentState === "success") {
      this.mood = "happy";
      return;
    }
    this.mood = "normal";
  }
}
