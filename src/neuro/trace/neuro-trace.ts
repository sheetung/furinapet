/**
 * Neuro trace ring buffer.
 *
 * Records the closed loop (intent → motor plan → reaction) for every
 * executed directive. Today it powers the Brain Navigation debug panel;
 * the same entries are the seed format for the future replay/training
 * dataset (State → MotorPlan), so keep the fields stable.
 */

import type { BodyRegion, MotorSource, MotorTendency } from "../contracts";
import type { ReflexName } from "../reflex/reflex";
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
  /** Origin of the executed motor plan (reflex/rule/ai/shadow). */
  source?: MotorSource;
  /** Reflex name when this entry came from the reflex arc. */
  reflex?: ReflexName;
  /** Body region that triggered the reflex/touch, when applicable. */
  region?: BodyRegion;
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
