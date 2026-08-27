/**
 * Neuro contract Level 2: WorldState.
 *
 * The reduced, semantic view of the environment. This is what the brain and
 * cerebellum read — never raw event streams, never renderer internals.
 * Coordinates are physical screen pixels, matching Tauri window APIs.
 */

import type { BodyRegion, PointerMotion } from "./perception-event";
import type { BrainAgentState } from "../../pet-brain/types";

export interface PointerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Magnitude of (vx, vy) in px/s. */
  speed: number;
  motion: PointerMotion;
  targetRegion: BodyRegion;
  /** Distance from pointer to the pet's body center, normalized 0..1 over 1200 px. */
  distanceToCharacter: number;
}

export type InteractionType =
  | "none"
  | "hover"
  | "click"
  | "double-click"
  | "long-press"
  | "drag";

export interface InteractionState {
  type: InteractionType;
  clickStreak: number;
  /** 0..1 strength of the latest touch, derived from streak and sense. */
  intensity: number;
}

export interface AgentPresenceState {
  state: BrainAgentState;
  connected: boolean;
  clientName?: string;
}

export interface EnvironmentState {
  userIdleMs: number;
  canMove: boolean;
  canDock: boolean;
}

export interface WorldState {
  timestamp: number;
  pointer: PointerState;
  interaction: InteractionState;
  agent: AgentPresenceState;
  environment: EnvironmentState;
}

export const POINTER_DISTANCE_RANGE_PX = 1200;

export function emptyWorldState(at: number): WorldState {
  return {
    timestamp: at,
    pointer: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      speed: 0,
      motion: "stationary",
      targetRegion: "none",
      distanceToCharacter: 1,
    },
    interaction: { type: "none", clickStreak: 0, intensity: 0 },
    agent: { state: "idle", connected: false },
    environment: { userIdleMs: 0, canMove: false, canDock: false },
  };
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
