import type { BodyRegion, WorldState } from "../neuro/contracts";
import type { PerceptionLogEntry } from "../neuro/perception/perception-reducer";
import type { NeuroCharacterSnapshot } from "../neuro/character/character-adapter";
import type { NeuroTraceEntry } from "../neuro/trace/neuro-trace";

export type PetGoalId =
  | "idle"
  | "wander"
  | "dock"
  | "respond-user"
  | "observe-agent"
  | "celebrate"
  | "rest";

export type PetMood = "happy" | "normal" | "focused" | "tired";

export type BrainAgentState =
  | "idle"
  | "thinking"
  | "editing"
  | "testing"
  | "waiting"
  | "success"
  | "error";

export type BrainIntentSource = "system" | "user" | "agent" | "plugin" | "ai";

export type PetSenseName = "pet:clicked" | "pet:doubleClicked" | "pet:dragStart" | "pet:dragEnd";

export interface PetSenseEventDetail {
  name: PetSenseName;
  at: number;
  handledByPlugin: boolean;
  /**
   * Body region the tap landed on, resolved from the real pointerdown
   * position. Absent when the region could not be resolved (window hidden);
   * consumers fall back to the sampled pointer region.
   */
  region?: BodyRegion;
}

export interface BrainAgentStateEvent {
  state: BrainAgentState;
  sessionId?: string;
  agent?: string;
  clientName?: string;
  project?: string;
  at?: number;
}

export interface BrainIntentEvent {
  source: BrainIntentSource;
  goal: PetGoalId;
  priority?: number;
  ttlMs?: number;
  id?: string;
}

export interface BrainContext {
  now: number;
  autonomousMovement: boolean;
  canMove: boolean;
  canDock: boolean;
  userReactionActive: boolean;
  agentState: BrainAgentState;
  idleForMs: number;
  wanderWeight: number;
  dockWeight: number;
  activity: number;
  curiosity: number;
}

export interface BrainIntent {
  id: string;
  source: BrainIntentSource;
  goal: PetGoalId;
  priority: number;
  createdAt: number;
  expiresAt: number;
}

export type PetSemanticAction =
  | { type: "idle"; durationMs?: number }
  | { type: "wander" }
  | { type: "dock" }
  | { type: "observe"; durationMs: number }
  | { type: "respond"; intensity: "soft" | "normal" | "excited" }
  | { type: "celebrate"; intensity: "normal" | "excited" }
  | { type: "rest"; durationMs: number }
  | { type: "wait"; durationMs: number };

export interface GoalScore {
  goal: PetGoalId;
  score: number;
  reason: string;
}

export interface PetActionPlan {
  id: string;
  goal: PetGoalId;
  score: number;
  reason: string;
  createdAt: number;
  actions: PetSemanticAction[];
  candidates: GoalScore[];
}

export interface BrainHistoryEntry {
  goal: PetGoalId;
  at: number;
}

export interface PetDecisionTrace {
  planId: string;
  at: number;
  goal: PetGoalId;
  score: number;
  reason: string;
  candidates: GoalScore[];
  actions: PetSemanticAction[];
}

export type AiSuggestionTraceStatus = "pending" | "accepted" | "rejected";

export interface AiSuggestionTrace {
  id: string;
  at: number;
  goal: PetGoalId;
  confidence: number;
  ttlMs: number;
  expiresAt: number;
  status: AiSuggestionTraceStatus;
  decidedAt?: number;
  reason: string;
}

export interface BrainExecutorSnapshot {
  running: boolean;
  planId: string | null;
  goal: PetGoalId | null;
  score: number;
  actionIndex: number;
}

export interface PetBrainSnapshot {
  currentGoal: PetGoalId;
  mood: PetMood;
  energy: number;
  agentState: BrainAgentState;
  clickStreak: number;
  lastUserInteractionAt: number | null;
  lastAgentActivityAt: number | null;
  lastDecisionAt: number | null;
  pendingIntentCount: number;
  history: BrainHistoryEntry[];
  lastDecision: PetDecisionTrace | null;
  aiSuggestions: AiSuggestionTrace[];
  executor?: BrainExecutorSnapshot;
  /** Neuro character layer (emotion model), merged in by the pet-window runtime. */
  character?: NeuroCharacterSnapshot;
  /** Recent neuro pipeline decisions (intent → motor plan → reaction). */
  neuroTrace?: NeuroTraceEntry[];
  /** Pet-window WorldState at snapshot time (LMC Environment/Perception layers). */
  world?: WorldState;
  /** Recent perception events, newest first (LMC Perception drawer). */
  perceptionLog?: PerceptionLogEntry[];
}
