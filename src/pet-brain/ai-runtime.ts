import { listen } from "@tauri-apps/api/event";
import { desktop, type AiBehaviorContext } from "../api";
import { normalizeAiBehaviorSuggestion } from "./adapters/ai";
import { getPetBrain } from "./index";
import { PET_BRAIN_AGENT_STATE_EVENT } from "./runtime";
import type { BrainAgentStateEvent } from "./types";

const IDLE_CHECK_MS = 30_000;
const STARTUP_DELAY_MS = 8_000;
let bootstrapped = false;
let inFlight = false;

async function buildContext(): Promise<AiBehaviorContext> {
  const brain = getPetBrain();
  const snapshot = brain.snapshot();
  const now = Date.now();
  const [settings, agent] = await Promise.all([
    desktop.getSettings(),
    desktop.getAgentStatus().catch(() => null),
  ]);
  const lastInteraction = snapshot.lastUserInteractionAt;
  const idleForMs = lastInteraction === null ? 60_000 : Math.max(0, now - lastInteraction);

  return {
    pet: {
      goal: snapshot.currentGoal,
      mood: snapshot.mood,
      energy: snapshot.energy,
      recentGoals: snapshot.history.slice(-6).map((entry) => entry.goal),
    },
    agent: {
      state: brain.blackboard.getAgentState(),
      connected: (agent?.connectedCount ?? 0) > 0,
    },
    user: {
      idleForMs,
      clickStreak: snapshot.clickStreak,
      recentInteraction: idleForMs <= 5_000,
    },
    environment: {
      canWander: settings.autonomousMovement,
      canDock: settings.autonomousMovement && settings.windowDocking,
    },
  };
}

async function requestSuggestion(reason: string) {
  if (inFlight || !("__TAURI_INTERNALS__" in window)) return;
  inFlight = true;
  try {
    const settings = await desktop.getAiSettings();
    if (!settings.enabled || !settings.configured) return;

    const context = await buildContext();
    const result = await desktop.requestAiBehaviorSuggestion(context);
    if (result.state !== "suggested" || !result.suggestion) return;

    const intent = normalizeAiBehaviorSuggestion(result.suggestion);
    if (!intent) {
      console.warn("[pet-brain:ai] rejected provider suggestion");
      return;
    }
    await desktop.submitBrainIntent(intent.source, intent.goal, {
      priority: intent.priority,
      ttlMs: intent.ttlMs,
      id: intent.id ?? `ai-${reason}-${Date.now()}`,
    });
  } catch (error) {
    console.warn("[pet-brain:ai] suggestion failed", error);
  } finally {
    inFlight = false;
  }
}

export function bootstrapAiSuggestionRuntime() {
  if (bootstrapped || !("__TAURI_INTERNALS__" in window)) return;
  bootstrapped = true;

  window.setTimeout(() => void requestSuggestion("startup"), STARTUP_DELAY_MS);
  window.setInterval(() => {
    const snapshot = getPetBrain().snapshot();
    const lastInteraction = snapshot.lastUserInteractionAt;
    if (lastInteraction === null || Date.now() - lastInteraction >= 30_000) {
      void requestSuggestion("idle");
    }
  }, IDLE_CHECK_MS);

  void listen<BrainAgentStateEvent>(PET_BRAIN_AGENT_STATE_EVENT, (event) => {
    if (event.payload.state !== "idle") {
      window.setTimeout(() => void requestSuggestion(`agent-${event.payload.state}`), 700);
    }
  }).catch((error) => console.error("[pet-brain:ai] agent trigger bridge failed", error));
}
