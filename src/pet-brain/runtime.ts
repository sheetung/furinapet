import { emit, listen } from "@tauri-apps/api/event";
import { actionPlayback, ACTION_PRIORITY } from '../actions/coordinator';
import { PET_SENSE_EVENT } from "../pet/dom-bridge";
import { GestureSelector } from './adapters/gesture-selector';
import { getPetBrain } from "./index";
import { performNeedRecovery } from './recovery';
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
export const PET_BRAIN_SNAPSHOT_REQUEST_EVENT = "furinapet:brain-snapshot-request";

let bootstrapped = false;
const gestureSelector = new GestureSelector();
let permitsExecution = (_priority: number) => false;
export function bindExecutionPolicy(policy: (priority: number) => boolean) {
  permitsExecution = policy;
  return () => { if (permitsExecution === policy) permitsExecution = () => false; };
}

function immediateContext(now: number, agentState: BrainAgentState): BrainContext {
  const brain = getPetBrain();
  const lastInteraction = brain.blackboard.getLastUserInteractionAt();
  return {
    now,
    autonomousMovement: false,
    canMove: false,
    canDock: false,
    userReactionActive: actionPlayback.active,
    agentState,
    idleForMs: lastInteraction === null ? 0 : Math.max(0, now - lastInteraction),
    wanderWeight: 0,
    dockWeight: 0,
    activity: 0.65,
    curiosity: 0.65,
  };
}

export function publishPetBrainSnapshot() {
  const snapshot = getPetBrain().snapshot();
  window.dispatchEvent(new CustomEvent(PET_BRAIN_SNAPSHOT_EVENT, { detail: snapshot }));
  void emit(PET_BRAIN_SNAPSHOT_EVENT, snapshot).catch((error) => {
    console.warn("[pet-brain] snapshot publish failed", error);
  });
}

export async function executeReactionPlan(plan: PetActionPlan, priority: number) {
  if (!permitsExecution(priority)) return;
  const brain = getPetBrain();
  const agentState = brain.blackboard.getAgentState();
  const recovery = plan.actions.find(action => action.type === 'rest' && action.recovery);
  publishPetBrainSnapshot();
  const result = await actionPlayback.execute(priority, async session => {
    await brain.execute(plan, async (action, signal) => {
      publishPetBrainSnapshot();
      if (action.type === "wait") {
        await session.wait(action.durationMs);
        return;
      }
      if (action.type === "wander" || action.type === "dock" || signal.aborted) return;
      if (action.type === 'rest' && action.recovery) {
        await performNeedRecovery(session, action.recovery, () => brain.blackboard.getNeeds());
        return;
      }
      const directive = gestureSelector.select(action, agentState, brain.blackboard.getEnergy(), Date.now(), brain.blackboard.getNeeds());
      if (directive && !signal.aborted) {
        await session.perform(directive);
        if (!signal.aborted) gestureSelector.recordPerformed(directive, Date.now());
      }
    }, session.signal);
  }, recovery?.type === 'rest' ? `recovery:${recovery.recovery}` : 'semantic');
  if (result.status === 'failed') console.warn('[pet-brain] action failed', result.error);
  publishPetBrainSnapshot();
}

function handlePetSense(detail: PetSenseEventDetail) {
  const brain = getPetBrain();
  if (detail.name === "pet:clicked" || detail.name === "pet:doubleClicked") {
    brain.observeUserClick(detail.at);
  } else {
    brain.observeUserInteraction(detail.at);
  }

  if (detail.name === "pet:clicked" || detail.name === "pet:doubleClicked") {
    brain.submitIntent("user", "respond-user", {
      id: `sense-${detail.name}-${detail.at}`,
      priority: detail.name === "pet:doubleClicked" ? 0.97 : 0.9,
      ttlMs: 1200,
      now: detail.at,
    });
    const plan = brain.plan(immediateContext(detail.at, brain.blackboard.getAgentState()));
    void executeReactionPlan(plan, ACTION_PRIORITY.user);
  }
}

function handleAgentState(payload: BrainAgentStateEvent) {
  const brain = getPetBrain();
  const now = payload.at ?? Date.now();
  brain.observeAgentState(payload.state, now);

  if (!actionPlayback.canStart(ACTION_PRIORITY.agent)) return;
  const plan = brain.plan(immediateContext(now, payload.state));
  void executeReactionPlan(plan, ACTION_PRIORITY.agent);
}

function handleExternalIntent(payload: BrainIntentEvent) {
  const brain = getPetBrain();
  const now = Date.now();
  const priority = payload.source === 'user' ? ACTION_PRIORITY.user : ACTION_PRIORITY.background;
  if (!permitsExecution(priority)) return;
  if (!actionPlayback.canStart(priority)) return;
  brain.submitIntent(payload.source, payload.goal, {
    id: payload.id,
    priority: payload.priority,
    ttlMs: payload.ttlMs,
    now,
  });

  // Locomotion is executed by PetView's movement loop. Keeping the intent on
  // the shared blackboard lets the next movement decision consume it safely.
  if (payload.goal === "wander" || payload.goal === "dock") {
    publishPetBrainSnapshot();
    return;
  }

  const plan = brain.plan(immediateContext(now, brain.blackboard.getAgentState()));
  void executeReactionPlan(plan, priority);
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

  void listen(PET_BRAIN_SNAPSHOT_REQUEST_EVENT, () => {
    publishPetBrainSnapshot();
  }).catch((error) => console.error("[pet-brain] snapshot request bridge failed", error));

  publishPetBrainSnapshot();
}
