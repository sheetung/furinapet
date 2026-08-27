/**
 * Neuro trace ring buffer.
 *
 * Records the closed loop (intent → motor plan → reaction) for every
 * executed directive. Today it powers the Brain Navigation debug panel;
 * the same entries are the seed format for the future replay/training
 * dataset (State → MotorPlan), so keep the fields stable.
 */

import type { MotorTendency } from "../contracts";
import type { PetGoalId } from "../../pet-brain/types";
import type { Reaction } from "../../types";

export interface NeuroTraceEntry {
  t: number;
  goal: PetGoalId;
  confidence: number;
  motorTendency: MotorTendency;
  primitives: string[];
  reaction: Reaction | null;
  durationMs: number;
}

export const TRACE_LIMIT = 50;

const entries: NeuroTraceEntry[] = [];

export function recordNeuroTrace(entry: NeuroTraceEntry) {
  entries.unshift(entry);
  if (entries.length > TRACE_LIMIT) entries.length = TRACE_LIMIT;
}

export function getNeuroTrace(): readonly NeuroTraceEntry[] {
  return entries;
}
