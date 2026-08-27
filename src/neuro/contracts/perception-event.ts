/**
 * Neuro contract Level 1: typed perception events.
 *
 * Raw renderer/DOM events (Level 0) are reduced into these discriminated
 * events before anything downstream — brain, cerebellum or trace — sees them.
 * Never send raw mousemove streams past this boundary.
 */

import type { BrainAgentState, PetSenseName } from "../../pet-brain/types";

export type BodyRegion = "none" | "head" | "face" | "body" | "hand";

export type PointerMotion =
  | "stationary"
  | "approaching"
  | "retreating"
  | "tangential";

export type PerceptionEvent =
  | { type: "pointer"; at: number; x: number; y: number; region: BodyRegion }
  | { type: "pointerApproach"; at: number; motion: PointerMotion; region: BodyRegion }
  | {
      type: "touch";
      at: number;
      sense: PetSenseName;
      region: BodyRegion;
      streak: number;
      intensity: number;
    }
  | { type: "drag"; at: number; phase: "start" | "end" }
  | { type: "agentState"; at: number; state: BrainAgentState; connected: boolean; clientName?: string }
  | { type: "userIdle"; at: number; idleMs: number };

export const TOUCH_SENSES: readonly PetSenseName[] = [
  "pet:clicked",
  "pet:doubleClicked",
  "pet:dragStart",
  "pet:dragEnd",
];

export function isPerceptionEvent(value: unknown): value is PerceptionEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "pointer" ||
    type === "pointerApproach" ||
    type === "touch" ||
    type === "drag" ||
    type === "agentState" ||
    type === "userIdle"
  );
}
