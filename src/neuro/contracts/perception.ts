import type { AgentLifecycle, BodyRegion } from "./common";

/**
 * Level 0 — raw input, exactly as the host reports it.
 *
 * These are cheap and high frequency. Nothing above the perception reducer is ever
 * allowed to see them: a stream of `pointer-move` is not information, it is noise
 * that happens to contain information.
 */
export type RawEvent =
  | { type: "pointer-move"; at: number; x: number; y: number }
  | { type: "pointer-down"; at: number; x: number; y: number; region: BodyRegion }
  | { type: "pointer-up"; at: number; x: number; y: number }
  | { type: "click"; at: number; region: BodyRegion }
  | { type: "double-click"; at: number; region: BodyRegion }
  | { type: "drag-start"; at: number }
  | { type: "drag-end"; at: number }
  | { type: "agent-state"; at: number; state: AgentLifecycle; connected: boolean }
  | { type: "character-rect"; at: number; x: number; y: number; width: number; height: number }
  | { type: "user-text"; at: number; length: number };

/**
 * Level 1 — a thing that happened, in the character's terms.
 *
 * One `PerceptionEvent` may summarise hundreds of raw events. Reflexes fire on
 * these, and emotion moves on these; neither ever samples a coordinate.
 */
export type PerceptionEventKind =
  | "pointer-approaching"
  | "pointer-leaving"
  | "pointer-dwelling"
  | "touch"
  | "repeated-touch"
  | "grabbed"
  | "released"
  | "agent-state-changed"
  | "user-spoke"
  | "user-went-idle";

export interface PerceptionEvent {
  schemaVersion: number;
  kind: PerceptionEventKind;
  at: number;
  region: BodyRegion;
  /** 0..1 — how forceful or insistent this was. */
  intensity: number;
  /** Repeat count for streak-shaped events; 1 for one-off events. */
  repeat: number;
}

export const PERCEPTION_EVENT_KINDS: readonly PerceptionEventKind[] = [
  "pointer-approaching",
  "pointer-leaving",
  "pointer-dwelling",
  "touch",
  "repeated-touch",
  "grabbed",
  "released",
  "agent-state-changed",
  "user-spoke",
  "user-went-idle",
];
