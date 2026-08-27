import { emit, listen } from "@tauri-apps/api/event";
import { desktop } from "../api";
import { buildCharacterState, characterSnapshot } from "../neuro/character/character-adapter";
import { planMotor, synthesizeBrainIntent } from "../neuro/cerebellum/rule-cerebellum";
import { reactionForMotorPlan } from "../neuro/motion/legacy-sprite-backend";
import { getWorldState } from "../neuro/perception/store";
import { getNeuroTrace, recordNeuroTrace } from "../neuro/trace/neuro-trace";
import { PET_SENSE_EVENT } from "../plugins/dom-bridge";
import { getPetBrain, waitForAction } from "./index";
import type {
  BrainAgentState,
  BrainAgentStateEvent,
  BrainContext,
  BrainIntentEvent,
  PetActionPlan,
  PetSemanticAction,
  PetSenseEventDetail,
} from "./types";

export const PET_BRAIN_AGENT_STATE_EVENT = "pet-brain-agent-state";
export const PET_BRAIN_INTENT_EVENT = "pet-brain-intent";
export const PET_BRAIN_SNAPSHOT_EVENT = "furinapet:brain-snapshot";
export const PET_BRAIN_SNAPSHOT_REQUEST_EVENT = "furinapet:brain-snapshot-request";

let bootstrapped = false;

function immediateContext(now: number, agentState: BrainAgentState): BrainContext {
  const brain = getPetBrain();
  const lastInteraction = brain.blackboard.getLastUserInteractionAt();
  return {
    now,
    autonomousMovement: false,
    canMove: false,
    canDock: false,
    userReactionActive: false,
    agentState,
    idleForMs: lastInteraction === null ? 0 : Math.max(0, now - lastInteraction),
    wanderWeight: 0,
    dockWeight: 0,
    activity: 0.65,
    curiosity: 0.65,
  };
}

export function publishPetBrainSnapshot() {
  const brain = getPetBrain();
  const snapshot = {
    ...brain.snapshot(),
    character: characterSnapshot(brain.blackboard, Date.now()),
    neuroTrace: getNeuroTrace().slice(0, 20),
  };
  window.dispatchEvent(new CustomEvent(PET_BRAIN_SNAPSHOT_EVENT, { detail: snapshot }));
  void emit(PET_BRAIN_SNAPSHOT_EVENT, snapshot).catch((error) => {
    console.warn("[pet-brain] snapshot publish failed", error);
  });
}

/** Duration the old fixed mapping took from the action itself. */
function actionFallbackDuration(action: PetSemanticAction): number | undefined {
  switch (action.type) {
    case "idle":
      return action.durationMs ?? 1200;
    case "observe":
    case "rest":
      return action.durationMs;
    default:
      return undefined;
  }
}

async function executeReactionPlan(plan: PetActionPlan, force = false) {
  const brain = getPetBrain();
  const now = Date.now();
  const character = buildCharacterState(brain.blackboard, now);
  const world = getWorldState();
  const intent = synthesizeBrainIntent(plan, character, world);
  publishPetBrainSnapshot();
  await brain.execute(plan, async (action, signal) => {
    publishPetBrainSnapshot();
    if (action.type === "wait") {
      await waitForAction(action.durationMs, signal);
      return;
    }
    if (action.type === "wander" || action.type === "dock") return;

    const motorPlan = planMotor(intent, character, world, action);
    const directive = reactionForMotorPlan(motorPlan, actionFallbackDuration(action));
    if (!directive || signal.aborted) return;
    recordNeuroTrace({
      t: Date.now(),
      goal: plan.goal,
      confidence: intent.confidence,
      motorTendency: intent.motorTendency,
      primitives: motorPlan.actions.map((primitive) => primitive.type),
      reaction: directive.reaction,
      durationMs: directive.durationMs,
    });
    await desktop.react(directive.reaction);
    await waitForAction(directive.durationMs, signal);
  }, { force });
  publishPetBrainSnapshot();
}

function handlePetSense(detail: PetSenseEventDetail) {
  const brain = getPetBrain();
  if (detail.name === "pet:clicked" || detail.name === "pet:doubleClicked") {
    brain.observeUserClick(detail.at);
  } else {
    brain.observeUserInteraction(detail.at);
  }

  if (detail.handledByPlugin) {
    publishPetBrainSnapshot();
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
    publishPetBrainSnapshot();
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

  void listen(PET_BRAIN_SNAPSHOT_REQUEST_EVENT, () => {
    publishPetBrainSnapshot();
  }).catch((error) => console.error("[pet-brain] snapshot request bridge failed", error));

  publishPetBrainSnapshot();
}
