import type {
  BrainAgentState,
  BrainHistoryEntry,
  BrainIntent,
  PetBrainSnapshot,
  PetGoalId,
  PetMood,
} from "./types";

const HISTORY_LIMIT = 12;
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
    this.intents = this.intents.filter((intent) => intent.expiresAt > now);
    return [...this.intents].sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
  }

  consumeIntent(id: string) {
    this.intents = this.intents.filter((intent) => intent.id !== id);
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

  recordDecision(goal: PetGoalId, now: number) {
    this.currentGoal = goal;
    this.lastDecisionAt = now;
    this.history.unshift({ goal, at: now });
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;

    if (goal === "wander" || goal === "dock") this.energy = clamp01(this.energy - 0.02);
    if (goal === "celebrate") this.energy = clamp01(this.energy - 0.035);
    if (goal === "rest") this.energy = clamp01(this.energy + 0.05);
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
      clickStreak: this.clickStreak,
      lastUserInteractionAt: this.lastUserInteractionAt,
      lastAgentActivityAt: this.lastAgentActivityAt,
      lastDecisionAt: this.lastDecisionAt,
      pendingIntentCount: this.intents.length,
      history: [...this.history],
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
