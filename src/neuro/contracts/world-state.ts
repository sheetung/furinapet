import type { AgentLifecycle, BodyRegion } from "./common";

export type PointerDirection = "none" | "approaching" | "leaving" | "passing";
export type InteractionType = "none" | "hover" | "click" | "double-click" | "long-press" | "drag";
export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

/**
 * Level 2 — the world as the character understands it right now.
 *
 * Every spatial quantity is expressed in **character heights**, not pixels: a
 * distance of 0.5 means half a body height away, at any window scale or DPI. That is
 * what lets one set of behaviour rules — and one set of model training data —
 * survive a change of sprite size, monitor or model.
 */
export interface WorldState {
  schemaVersion: number;
  timestamp: number;

  pointer: {
    /** Offset from the character's centre, in character heights. */
    dx: number;
    dy: number;
    /** Speed in character heights per second. */
    speed: number;
    direction: PointerDirection;
    /** Which body area the pointer is over or closest to. */
    targetRegion: BodyRegion;
    /** Distance in character heights. 0 means on the body. */
    distance: number;
    onCharacter: boolean;
  };

  interaction: {
    type: InteractionType;
    /** Consecutive clicks inside the streak window. */
    clickStreak: number;
    /** 0..1, rises with streak length and click rate. */
    intensity: number;
    /** Body area of the most recent touch. */
    region: BodyRegion;
    lastAt: number | null;
  };

  agent: {
    state: AgentLifecycle;
    connected: boolean;
  };

  environment: {
    userIdleMs: number;
    canMove: boolean;
    canDock: boolean;
    timeOfDay: TimeOfDay;
  };
}

export const POINTER_DIRECTIONS: readonly PointerDirection[] = ["none", "approaching", "leaving", "passing"];
export const INTERACTION_TYPES: readonly InteractionType[] = [
  "none", "hover", "click", "double-click", "long-press", "drag",
];
export const TIMES_OF_DAY: readonly TimeOfDay[] = ["morning", "afternoon", "evening", "night"];
