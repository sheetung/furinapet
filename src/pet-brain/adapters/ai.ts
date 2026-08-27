import type { BrainIntentEvent, PetGoalId } from "../types";
import { SOURCE_CONFIDENCE_CAP } from "../../neuro/contracts";

const ALLOWED_AI_GOALS = new Set<PetGoalId>([
  "idle",
  "wander",
  "dock",
  "respond-user",
  "observe-agent",
  "celebrate",
  "rest",
]);

export interface AiBehaviorSuggestion {
  goal: PetGoalId;
  confidence?: number;
  ttlMs?: number;
  id?: string;
}

/**
 * Converts an untrusted AI suggestion into a constrained high-level intent.
 * AI never receives an animation/action primitive here: it can only suggest
 * one of the Brain's semantic goals. Priority is capped below user/system
 * control so model output cannot steal drag/click/safety arbitration.
 */
export function normalizeAiBehaviorSuggestion(value: unknown): BrainIntentEvent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const goal = typeof candidate.goal === "string" ? candidate.goal as PetGoalId : null;
  if (!goal || !ALLOWED_AI_GOALS.has(goal)) return null;

  const confidence = typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
    ? Math.min(1, Math.max(0, candidate.confidence))
    : 0.6;
  const ttlMs = typeof candidate.ttlMs === "number" && Number.isFinite(candidate.ttlMs)
    ? Math.round(Math.min(30_000, Math.max(500, candidate.ttlMs)))
    : 5_000;
  const id = typeof candidate.id === "string" && candidate.id.length <= 120
    ? candidate.id
    : undefined;

  return {
    source: "ai",
    goal,
    // Keep AI below explicit user/system intent priority by construction.
    priority: Math.min(SOURCE_CONFIDENCE_CAP.ai, 0.5 + confidence * 0.32),
    ttlMs,
    id,
  };
}
