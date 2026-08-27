/**
 * Neuro perception reducer: PerceptionEvent stream → WorldState (pure).
 *
 * Everything here is deterministic and synchronous — no timers, no sampling,
 * no AI. The pet-window store (./store.ts) owns memory and pushes events in;
 * tests drive this module directly.
 */

import {
  bodyRegionAt,
  type BodyRegion,
  type PerceptionEvent,
  type PointerMotion,
  type WorldState,
  clamp01,
  POINTER_DISTANCE_RANGE_PX,
} from "../contracts";
import type { InteractionType } from "../contracts";

export interface PetGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Reducer memory — everything WorldState itself must not carry. */
export interface PerceptionMemory {
  lastPointerAt: number | null;
  lastPointer: { x: number; y: number } | null;
  lastTouchAt: number | null;
  lastUserInteractionAt: number | null;
  streak: number;
  lastInteractionTypeAt: number | null;
}

export function emptyPerceptionMemory(): PerceptionMemory {
  return {
    lastPointerAt: null,
    lastPointer: null,
    lastTouchAt: null,
    lastUserInteractionAt: null,
    streak: 0,
    lastInteractionTypeAt: null,
  };
}

export const CLICK_STREAK_WINDOW_MS = 1800;
const STATIONARY_SPEED_PX = 40;

export function petCenter(geometry: PetGeometry | null): { x: number; y: number } | null {
  return geometry ? { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 } : null;
}

function classifyMotion(
  previous: { x: number; y: number } | null,
  next: { x: number; y: number },
  elapsedMs: number,
  center: { x: number; y: number } | null,
): PointerMotion {
  if (!previous || elapsedMs <= 0) return "stationary";
  const seconds = elapsedMs / 1000;
  const vx = (next.x - previous.x) / seconds;
  const vy = (next.y - previous.y) / seconds;
  const speed = Math.hypot(vx, vy);
  if (speed < STATIONARY_SPEED_PX || !center) return "stationary";
  const ux = center.x - next.x;
  const uy = center.y - next.y;
  const length = Math.hypot(ux, uy);
  if (length < 1) return "tangential";
  const radialSpeed = (vx * ux + vy * uy) / length;
  if (radialSpeed > STATIONARY_SPEED_PX) return "approaching";
  if (radialSpeed < -STATIONARY_SPEED_PX) return "retreating";
  return "tangential";
}

function touchInteraction(type: InteractionType, streak: number, baseIntensity: number): {
  type: InteractionType;
  clickStreak: number;
  intensity: number;
} {
  return { type, clickStreak: streak, intensity: clamp01(baseIntensity + (streak - 1) * 0.12) };
}

export interface ReduceResult {
  world: WorldState;
  memory: PerceptionMemory;
}

/**
 * Apply one perception event. Returns the next world/memory pair; inputs are
 * never mutated. `geometry` is the pet window's current physical bounds and
 * may be null while the window is hidden.
 */
export function reducePerceptionEvent(
  world: WorldState,
  memory: PerceptionMemory,
  event: PerceptionEvent,
  geometry: PetGeometry | null,
): ReduceResult {
  const nextMemory: PerceptionMemory = { ...memory };
  const next: WorldState = { ...world, timestamp: event.at };

  switch (event.type) {
    case "pointer": {
      const center = petCenter(geometry);
      const dt = nextMemory.lastPointerAt === null ? 0 : event.at - nextMemory.lastPointerAt;
      const seconds = dt > 0 && dt <= 2000 ? dt / 1000 : 0;
      const vx = nextMemory.lastPointer && seconds > 0 ? (event.x - nextMemory.lastPointer.x) / seconds : 0;
      const vy = nextMemory.lastPointer && seconds > 0 ? (event.y - nextMemory.lastPointer.y) / seconds : 0;
      const distance = center
        ? Math.hypot(event.x - center.x, event.y - center.y) / POINTER_DISTANCE_RANGE_PX
        : 1;
      next.pointer = {
        x: event.x,
        y: event.y,
        vx,
        vy,
        speed: Math.hypot(vx, vy),
        motion: classifyMotion(nextMemory.lastPointer, { x: event.x, y: event.y }, dt, center),
        targetRegion: event.region,
        distanceToCharacter: clamp01(distance),
      };
      nextMemory.lastPointerAt = event.at;
      nextMemory.lastPointer = { x: event.x, y: event.y };
      return { world: next, memory: nextMemory };
    }
    case "pointerApproach": {
      next.pointer = { ...next.pointer, motion: event.motion };
      return { world: next, memory: nextMemory };
    }
    case "touch": {
      const isTouchSense = event.sense === "pet:clicked" || event.sense === "pet:doubleClicked";
      if (!isTouchSense) return { world: next, memory: nextMemory };

      const withinWindow =
        nextMemory.lastTouchAt !== null && event.at - nextMemory.lastTouchAt <= CLICK_STREAK_WINDOW_MS;
      const streak = event.streak > 0 ? event.streak : withinWindow ? nextMemory.streak + 1 : 1;
      const type: InteractionType = event.sense === "pet:doubleClicked" ? "double-click" : "click";
      next.interaction = touchInteraction(type, streak, event.sense === "pet:doubleClicked" ? 0.8 : 0.35);
      nextMemory.streak = streak;
      nextMemory.lastTouchAt = event.at;
      nextMemory.lastUserInteractionAt = event.at;
      nextMemory.lastInteractionTypeAt = event.at;
      return { world: next, memory: nextMemory };
    }
    case "drag": {
      if (event.phase === "start") {
        next.interaction = { type: "drag", clickStreak: 0, intensity: 0.6 };
        nextMemory.streak = 0;
        nextMemory.lastInteractionTypeAt = event.at;
      } else {
        next.interaction = { type: "none", clickStreak: 0, intensity: 0 };
        nextMemory.lastInteractionTypeAt = null;
      }
      nextMemory.lastUserInteractionAt = event.at;
      return { world: next, memory: nextMemory };
    }
    case "agentState": {
      next.agent = {
        state: event.state,
        connected: event.connected,
        ...(event.clientName ? { clientName: event.clientName } : {}),
      };
      return { world: next, memory: nextMemory };
    }
    case "userIdle": {
      next.environment = { ...next.environment, userIdleMs: event.idleMs };
      return { world: next, memory: nextMemory };
    }
  }
}

export interface TickInput {
  canMove: boolean;
  canDock: boolean;
}

/**
 * Advance time-derived fields. Interaction types decay back to "none" after
 * the click-streak window passes; drag persists until its "end" event.
 */
export function tickWorldState(
  world: WorldState,
  memory: PerceptionMemory,
  now: number,
  input: TickInput,
): ReduceResult {
  const nextMemory: PerceptionMemory = { ...memory };
  const next: WorldState = { ...world, timestamp: now };
  next.environment = { ...world.environment, canMove: input.canMove, canDock: input.canDock };
  if (nextMemory.lastUserInteractionAt !== null) {
    next.environment.userIdleMs = Math.max(0, now - nextMemory.lastUserInteractionAt);
  }
  if (
    world.interaction.type !== "none" &&
    world.interaction.type !== "drag" &&
    nextMemory.lastInteractionTypeAt !== null &&
    now - nextMemory.lastInteractionTypeAt > CLICK_STREAK_WINDOW_MS
  ) {
    next.interaction = { type: "none", clickStreak: 0, intensity: 0 };
    nextMemory.streak = 0;
  }
  if (nextMemory.lastTouchAt !== null && now - nextMemory.lastTouchAt > CLICK_STREAK_WINDOW_MS) {
    nextMemory.streak = 0;
  }
  return { world: next, memory: nextMemory };
}

/** Region lookup for a pointer position against the pet's physical bounds. */
export function regionAtPointer(pointer: { x: number; y: number }, geometry: PetGeometry) {
  const inside =
    pointer.x >= geometry.x &&
    pointer.x <= geometry.x + geometry.width &&
    pointer.y >= geometry.y &&
    pointer.y <= geometry.y + geometry.height;
  if (!inside) return "none" as const;
  return bodyRegionAt((pointer.y - geometry.y) / Math.max(1, geometry.height));
}

/** Compact, serializable log line for the LMC inspector's Perception drawer. */
export interface PerceptionLogEntry {
  at: number;
  type: PerceptionEvent["type"];
  region?: BodyRegion;
  detail: string;
}

export function formatPerceptionLogEntry(event: PerceptionEvent): PerceptionLogEntry {
  switch (event.type) {
    case "pointer":
      return { at: event.at, type: event.type, region: event.region, detail: `(${Math.round(event.x)}, ${Math.round(event.y)})` };
    case "pointerApproach":
      return { at: event.at, type: event.type, region: event.region, detail: event.motion };
    case "touch":
      return { at: event.at, type: event.type, region: event.region, detail: `${event.sense.replace("pet:", "")} · streak ${event.streak}` };
    case "drag":
      return { at: event.at, type: event.type, detail: event.phase };
    case "agentState":
      return { at: event.at, type: event.type, detail: event.clientName ? `${event.state} · ${event.clientName}` : event.state };
    case "userIdle":
      return { at: event.at, type: event.type, detail: `${Math.round(event.idleMs / 1000)}s` };
  }
}
