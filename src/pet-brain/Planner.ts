import { PetBlackboard } from "./Blackboard";
import type { BrainContext, GoalScore, PetActionPlan, PetGoalId, PetSemanticAction } from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const ACTIVE_AGENT_STATES = new Set(["thinking", "editing", "testing", "waiting"]);

export class PetUtilityPlanner {
  constructor(private readonly random: () => number = Math.random) {}

  scoreGoals(context: BrainContext, blackboard: PetBlackboard): GoalScore[] {
    const now = context.now;
    const clickStreak = blackboard.getClickStreak();
    const lastUserInteractionAt = blackboard.getLastUserInteractionAt();
    const recentUserInteraction = lastUserInteractionAt === null
      ? 0
      : clamp01(1 - (now - lastUserInteractionAt) / 5000);
    const energy = blackboard.getEnergy();
    const repeatPenalty = (goal: PetGoalId, amount: number) => Math.min(0.45, blackboard.goalRepeatCount(goal) * amount);
    const cooldownPenalty = (goal: PetGoalId, cooldownMs: number, amount: number) => {
      const elapsed = blackboard.msSinceGoal(goal, now);
      return elapsed >= cooldownMs ? 0 : amount * (1 - elapsed / cooldownMs);
    };

    const intent = blackboard.getActiveIntents(now)[0];
    if (intent && intent.priority >= 0.85) {
      return [{ goal: intent.goal, score: 1, reason: `${intent.source} intent` }];
    }

    const scores: GoalScore[] = [];
    const add = (goal: PetGoalId, score: number, reason: string) => {
      scores.push({ goal, score: clamp01(score), reason });
    };

    add("idle", 0.26 + (1 - context.activity) * 0.12 + (context.userReactionActive ? 0.32 : 0), "baseline calm state");

    const respondScore = recentUserInteraction * (0.62 + Math.min(3, clickStreak) * 0.11)
      - repeatPenalty("respond-user", 0.12)
      - cooldownPenalty("respond-user", 1400, 0.25);
    add("respond-user", respondScore, clickStreak >= 2 ? "repeated user interaction" : "recent user interaction");

    const agentActive = ACTIVE_AGENT_STATES.has(context.agentState);
    const observeScore = agentActive
      ? 0.58 + context.curiosity * 0.2 + (context.agentState === "waiting" ? 0.08 : 0)
      : context.agentState === "error" ? 0.32 : 0.05;
    add(
      "observe-agent",
      observeScore - repeatPenalty("observe-agent", 0.08) - cooldownPenalty("observe-agent", 4500, 0.12),
      agentActive ? `agent ${context.agentState}` : "agent inactive",
    );

    const celebrateScore = context.agentState === "success"
      ? 0.9 - cooldownPenalty("celebrate", 12000, 0.5)
      : clickStreak >= 3 ? 0.64 - cooldownPenalty("celebrate", 8000, 0.4) : 0;
    add("celebrate", celebrateScore, context.agentState === "success" ? "agent completed work" : "high user engagement");

    const restScore = (1 - energy) * 0.7
      + (context.idleForMs > 45000 ? 0.12 : 0)
      - (agentActive ? 0.18 : 0)
      - recentUserInteraction * 0.25;
    add("rest", restScore - cooldownPenalty("rest", 12000, 0.18), "energy recovery");

    const wanderBase = context.autoWander && context.canMove && !context.userReactionActive
      ? context.wanderProbability * (0.55 + context.activity * 0.45)
      : 0;
    const wanderScore = wanderBase
      + Math.min(0.18, context.idleForMs / 90000 * 0.18)
      + energy * 0.08
      - recentUserInteraction * 0.35
      - (agentActive ? 0.2 : 0)
      - repeatPenalty("wander", 0.1)
      - cooldownPenalty("wander", 3500, 0.15);
    add("wander", wanderScore, "autonomous exploration");

    const dockScore = context.canDock
      ? wanderBase * (0.45 + context.curiosity * 0.4)
        - recentUserInteraction * 0.25
        - repeatPenalty("dock", 0.12)
        - cooldownPenalty("dock", 10000, 0.28)
      : 0;
    add("dock", dockScore, "curiosity about nearby windows");

    if (intent) {
      const existing = scores.find((item) => item.goal === intent.goal);
      if (existing) {
        existing.score = clamp01(existing.score + intent.priority * 0.45);
        existing.reason = `${existing.reason}; ${intent.source} intent`;
      }
    }

    return scores.sort((a, b) => b.score - a.score);
  }

  plan(context: BrainContext, blackboard: PetBlackboard): PetActionPlan {
    const scores = this.scoreGoals(context, blackboard);
    const selected = this.selectContextualGoal(scores);
    const actions = this.actionsFor(selected.goal, blackboard);
    return {
      id: `plan-${context.now}-${Math.floor(this.random() * 1_000_000)}`,
      goal: selected.goal,
      score: selected.score,
      reason: selected.reason,
      createdAt: context.now,
      actions,
    };
  }

  private selectContextualGoal(scores: GoalScore[]) {
    const top = scores[0] ?? { goal: "idle" as const, score: 1, reason: "fallback" };
    if (top.score >= 0.92 || scores.length === 1) return top;

    const eligible = scores.filter((item) => item.score >= Math.max(0.18, top.score - 0.16));
    if (eligible.length <= 1) return top;

    const weights = eligible.map((item) => Math.max(0.01, item.score ** 2));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let roll = this.random() * total;
    for (let index = 0; index < eligible.length; index += 1) {
      roll -= weights[index];
      if (roll <= 0) return eligible[index];
    }
    return top;
  }

  private actionsFor(goal: PetGoalId, blackboard: PetBlackboard): PetSemanticAction[] {
    switch (goal) {
      case "wander":
        return [{ type: "wander" }];
      case "dock":
        return [{ type: "dock" }];
      case "respond-user": {
        const streak = blackboard.getClickStreak();
        return [{ type: "respond", intensity: streak >= 3 ? "excited" : streak >= 2 ? "normal" : "soft" }];
      }
      case "observe-agent":
        return [{ type: "observe", durationMs: 2200 + Math.round(this.random() * 1800) }, { type: "wait", durationMs: 500 }];
      case "celebrate":
        return [{ type: "celebrate", intensity: blackboard.getMood() === "happy" ? "excited" : "normal" }];
      case "rest":
        return [{ type: "rest", durationMs: 3000 + Math.round(this.random() * 3500) }];
      case "idle":
      default:
        return [{ type: "idle", durationMs: 1200 + Math.round(this.random() * 2200) }];
    }
  }
}
