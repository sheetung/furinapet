import { listen } from "@tauri-apps/api/event";
import { desktop } from "../api";
import { PET_SENSE_EVENT } from "../plugins/dom-bridge";
import { reactionForSemanticAction } from "./adapters/reaction";
import { getPetBrain, waitForAction } from "./index";
import type {
  BrainAgentState,
  BrainAgentStateEvent,
  BrainContext,
  BrainIntentEvent,
  PetActionPlan,
  PetSenseEventDetail,
} from "./types";

export const PET_BRAIN_AGENT_STATE_EVENT = "pet-brain-agent-state";
export const PET_BRAIN_INTENT_EVENT = "pet-brain-intent";
export const PET_BRAIN_SNAPSHOT_EVENT = "furinapet:brain-snapshot";

let bootstrapped = false;

function immediateContext(now: number, agentState: BrainAgentState): BrainContext {
  const brain = getPetBrain();
  const lastInteraction = brain.blackboard.getLastUserInteractionAt();
  return {
    now,
    autoWander: false,
    canMove: false,
    canDock: false,
    userReactionActive: false,
    agentState,
    idleForMs: lastInteraction === null ? 0 : Math.max(0, now - lastInteraction),
    wanderProbability: 0,
    activity: 0.65,
    curiosity: 0.65,
  };
}

function publishSnapshot() {
  window.dispatchEvent(new CustomEvent(PET_BRAIN_SNAPSHOT_EVENT, {
    detail: getPetBrain().snapshot(),
  }));
}

async function executeReactionPlan(plan: PetActionPlan, force = false) {
  const brain = getPetBrain();
  const agentState = brain.blackboard.getAgentState();
  await brain.execute(plan, async (action, signal) => {
    if (action.type === "wait") {
      await waitForAction(action.durationMs, signal);
      return;
    }
    if (action.type === "wander" || action.type === "dock") return;

    const directive = reactionForSemanticAction(action, agentState);
    if (!directive || signal.aborted) return;
    await desktop.react(directive.reaction);
    await waitForAction(directive.durationMs, signal);
  }, { force });
  publishSnapshot();
}

function handlePetSense(detail: PetSenseEventDetail) {
  const brain = getPetBrain();
  if (detail.name === "pet:clicked" || detail.name === "pet:doubleClicked") {
    brain.observeUserClick(detail.at);
  } else {
    brain.observeUserInteraction(detail.at);
  }

  if (detail.handledByPlugin) {
    publishSnapshot();
    return;
  }

  if (detail.name === "pet:clicked" || detail.name === "pet:doubleClicked") {
    brain.submitIntent("user", "respond-user", {
      id: `sense-${detail.name}-${detail.at}`,
      priority: detail.name === "pet:doubleClicked" ? 0.97 : 0.9,
      ttlMs: 1200,
      now: detail.at,
    });
    const plan = brain.plan(immediateContext(detail.at, brain.blackboard.getAgentState()));
    void executeReactionPlan(plan, true);
  }
}

function handleAgentState(payload: BrainAgentStateEvent) {
  const brain = getPetBrain();
  const now = payload.at ?? Date.now();
  brain.observeAgentState(payload.state, now);

  if (payload.state === "idle") brain.interrupt();
  const plan = brain.plan(immediateContext(now, payload.state));
  void executeReactionPlan(plan, payload.state === "idle" || payload.state === "success" || payload.state === "error");
}

function handleExternalIntent(payload: BrainIntentEvent) {
  const brain = getPetBrain();
  const now = Date.now();
  brain.submitIntent(payload.source, payload.goal, {
    id: payload.id,
    priority: payload.priority,
    ttlMs: payload.ttlMs,
    now,
  });

  // Locomotion is executed by PetView's movement loop. Keeping the intent on
  // the shared blackboard lets the next movement decision consume it safely.
  if (payload.goal === "wander" || payload.goal === "dock") {
    publishSnapshot();
    return;
  }

  const plan = brain.plan(immediateContext(now, brain.blackboard.getAgentState()));
  void executeReactionPlan(plan, (payload.priority ?? 0.65) >= 0.9);
}

export function bootstrapPetBrainRuntime() {
  if (bootstrapped || !("__TAURI_INTERNALS__" in window)) return;
  bootstrapped = true;

  const onSense = (event: Event) => {
    const detail = (event as CustomEvent<PetSenseEventDetail>).detail;
    if (detail) handlePetSense(detail);
  };
  window.addEventListener(PET_SENSE_EVENT, onSense);

  void listen<BrainAgentStateEvent>(PET_BRAIN_AGENT_STATE_EVENT, (event) => {
    handleAgentState(event.payload);
  }).catch((error) => console.error("[pet-brain] agent state bridge failed", error));

  void listen<BrainIntentEvent>(PET_BRAIN_INTENT_EVENT, (event) => {
    handleExternalIntent(event.payload);
  }).catch((error) => console.error("[pet-brain] intent bridge failed", error));

  publishSnapshot();
}
