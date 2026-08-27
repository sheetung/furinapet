import { listen } from "@tauri-apps/api/event";
import { desktop, type AiBehaviorContext } from "../api";
import { normalizeAiBehaviorSuggestion } from "./adapters/ai";
import { getPetBrain } from "./index";
import { PET_BRAIN_AGENT_STATE_EVENT, publishPetBrainSnapshot } from "./runtime";
import type { BrainAgentStateEvent } from "./types";
import { buildCharacterState } from "../neuro/character/character-adapter";
import { requestStructuredBrain, type BrainProviderContext } from "../neuro/brain/structured-brain";
import { getWorldState } from "../neuro/perception/store";
import { getNeuroTrace, recordNeuroTrace } from "../neuro/trace/neuro-trace";

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
      canDock: settings.autonomousMovement && settings.windowDocking && !settings.gravityEnabled,
    },
  };
}

/** Build a BrainProviderContext for the structured brain from current state. */
function buildStructuredContext(): BrainProviderContext {
  const brain = getPetBrain();
  const snapshot = brain.snapshot();
  const now = Date.now();
  const world = getWorldState();
  const character = buildCharacterState(brain.blackboard, now);
  const lastInteraction = snapshot.lastUserInteractionAt;
  const userIdleMs = lastInteraction === null ? 60_000 : Math.max(0, now - lastInteraction);

  return {
    world,
    character,
    recentGoals: snapshot.history.slice(-6).map((entry) => entry.goal),
    userIdleMs,
    agentConnected: world.agent.connected,
  };
}

/**
 * Try the structured brain provider first (full NeuroBrainIntent).
 * Returns true if a structured intent was successfully submitted.
 */
async function tryStructuredBrain(reason: string): Promise<boolean> {
  const ctx = buildStructuredContext();
  const result = await requestStructuredBrain(ctx);
  if (!result) return false;

  const now = Date.now();
  const intentId = `ai-structured-${reason}-${now}`;
  const priority = Math.min(0.82, 0.5 + result.intent.confidence * 0.32);
  const ttlMs = 5_000;

  // Record in neuro trace for debugging
  recordNeuroTrace({
    t: now,
    goal: result.intent.goal,
    confidence: result.intent.confidence,
    motorTendency: result.intent.motorTendency,
    primitives: [],
    reaction: "idle" as never,
    durationMs: 0,
    source: "ai",
  });

  getPetBrain().recordAiSuggestion(
    intentId,
    result.intent.goal,
    result.intent.confidence,
    ttlMs,
    now,
  );
  publishPetBrainSnapshot();

  await desktop.submitBrainIntent("ai", result.intent.goal, {
    priority,
    ttlMs,
    id: intentId,
  });

  console.info(
    `[pet-brain:ai] structured brain: goal=${result.intent.goal} confidence=${result.intent.confidence.toFixed(2)} latency=${result.latencyMs}ms`,
  );
  return true;
}

async function requestSuggestion(reason: string) {
  if (inFlight || !("__TAURI_INTERNALS__" in window)) return;
  inFlight = true;
  try {
    const settings = await desktop.getAiSettings();
    if (!settings.enabled || !settings.configured) return;

    // Try structured brain (full NeuroBrainIntent) first
    const structured = await tryStructuredBrain(reason);
    if (structured) return;

    // Fall back to legacy single-goal suggestion
    const context = await buildContext();
    const result = await desktop.requestAiBehaviorSuggestion(context);
    if (result.state !== "suggested" || !result.suggestion) return;

    const intent = normalizeAiBehaviorSuggestion(result.suggestion);
    if (!intent) {
      console.warn("[pet-brain:ai] rejected provider suggestion");
      return;
    }

    const now = Date.now();
    const intentId = intent.id ?? `ai-${reason}-${now}`;
    const ttlMs = intent.ttlMs ?? result.suggestion.ttlMs;
    getPetBrain().recordAiSuggestion(
      intentId,
      intent.goal,
      result.suggestion.confidence,
      ttlMs,
      now,
    );
    publishPetBrainSnapshot();

    await desktop.submitBrainIntent(intent.source, intent.goal, {
      priority: intent.priority,
      ttlMs,
      id: intentId,
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
