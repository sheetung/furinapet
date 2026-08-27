import {
  NEURO_SCHEMA_VERSION,
  type AgentLifecycle, type BodyRegion, type InteractionType,
  type PerceptionEvent, type PerceptionEventKind, type PointerDirection,
  type RawEvent, type TimeOfDay, type WorldState,
} from "../contracts";

export interface PerceptionOptions {
  /** Character height in device pixels. Every distance is normalised by this. */
  characterHeight?: number;
  clickStreakWindowMs?: number;
  idleThresholdMs?: number;
}

interface Rect { x: number; y: number; width: number; height: number }

const DEFAULT_RECT: Rect = { x: 0, y: 0, width: 192, height: 208 };
/** Heights per second below which the pointer counts as parked. */
const DWELL_SPEED = 0.15;
const DWELL_DISTANCE = 0.55;
const DWELL_HOLD_MS = 600;
/** Heights per second of closing speed needed to call it an approach. */
const APPROACH_RATE = 0.2;
const APPROACH_RANGE = 2.5;
const LONG_PRESS_MS = 500;
const REPEAT_TOUCH_STREAK = 3;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Body area under a point, in character-relative coordinates.
 *
 * `dx` is -0.5..0.5 across the width and `dyTop` is 0 at the crown and 1 at the feet.
 * The bands are deliberately coarse: the character needs to know it was poked in the
 * face rather than the arm, and nothing above this layer benefits from more precision.
 */
export function regionAt(dx: number, dyTop: number): BodyRegion {
  if (dyTop < 0 || dyTop > 1 || Math.abs(dx) > 0.5) return "none";
  if (dyTop < 0.16) return "head";
  if (dyTop < 0.32) return Math.abs(dx) < 0.18 ? "face" : "head";
  if (dyTop < 0.62) return Math.abs(dx) > 0.3 ? "hand" : "body";
  return "body";
}

export function timeOfDayAt(timestamp: number): TimeOfDay {
  const hour = new Date(timestamp).getHours();
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  if (hour < 23) return "evening";
  return "night";
}

/**
 * Level 0 → Level 1 and 2.
 *
 * The point of this class is subtraction. Five hundred `pointer-move` events become one
 * `WorldState` and, if something meaningful crossed a threshold, at most one
 * `PerceptionEvent`. Everything downstream — reflexes, emotion, a brain prompt, a
 * training sample — reads the summary, so none of them pay for the sample rate.
 */
export class PerceptionReducer {
  private readonly characterHeightPx: number;
  private readonly streakWindowMs: number;
  private readonly idleThresholdMs: number;

  private rect: Rect = DEFAULT_RECT;
  private pointer = { x: 0, y: 0, at: 0, known: false };
  private speed = 0;
  private distance = Infinity;
  private closingRate = 0;
  private direction: PointerDirection = "none";
  private region: BodyRegion = "none";

  private dwellSince: number | null = null;
  private dwellReported = false;
  private approachReported = false;

  private pressedAt: number | null = null;
  private dragging = false;
  private lastTouchAt: number | null = null;
  private lastTouchRegion: BodyRegion = "none";
  private lastTouchWasDouble = false;
  private clickStreak = 0;
  private lastInteractionAt = 0;
  private idleReported = false;

  private agentState: AgentLifecycle = "idle";
  private agentConnected = false;
  private canMove = true;
  private canDock = true;

  constructor(options: PerceptionOptions = {}) {
    this.characterHeightPx = Math.max(1, options.characterHeight ?? DEFAULT_RECT.height);
    this.streakWindowMs = options.clickStreakWindowMs ?? 1200;
    this.idleThresholdMs = options.idleThresholdMs ?? 60_000;
  }

  setEnvironment(flags: { canMove?: boolean; canDock?: boolean }) {
    if (flags.canMove !== undefined) this.canMove = flags.canMove;
    if (flags.canDock !== undefined) this.canDock = flags.canDock;
  }

  /** Folds one raw event and returns the semantic events it produced, usually none. */
  push(event: RawEvent): PerceptionEvent[] {
    switch (event.type) {
      case "character-rect":
        this.rect = { x: event.x, y: event.y, width: event.width, height: event.height };
        return [];
      case "pointer-move":
        return this.foldPointer(event.at, event.x, event.y);
      case "pointer-down":
        this.pressedAt = event.at;
        return [];
      case "pointer-up":
        this.pressedAt = null;
        return [];
      case "click":
      case "double-click":
        return [this.foldTouch(event.at, event.region, event.type === "double-click")];
      case "drag-start":
        this.dragging = true;
        this.lastInteractionAt = event.at;
        return [this.event("grabbed", event.at, this.region, 0.6, 1)];
      case "drag-end":
        this.dragging = false;
        this.lastInteractionAt = event.at;
        return [this.event("released", event.at, this.region, 0.4, 1)];
      case "agent-state": {
        const changed = event.state !== this.agentState;
        this.agentState = event.state;
        this.agentConnected = event.connected;
        return changed ? [this.event("agent-state-changed", event.at, "none", 0.5, 1)] : [];
      }
      case "user-text":
        this.lastInteractionAt = event.at;
        this.idleReported = false;
        return [this.event("user-spoke", event.at, "none", clamp01(event.length / 120), 1)];
    }
  }

  /** Call on a timer so idle can be noticed without an input event to hang it on. */
  tick(now: number): PerceptionEvent[] {
    if (this.idleReported || now - this.lastInteractionAt < this.idleThresholdMs) return [];
    this.idleReported = true;
    return [this.event("user-went-idle", now, "none", 0.3, 1)];
  }

  private foldPointer(at: number, x: number, y: number): PerceptionEvent[] {
    const previous = this.pointer;
    const elapsed = previous.known ? Math.max(1, at - previous.at) : 0;
    const height = this.characterHeightPx;

    const centreX = this.rect.x + this.rect.width / 2;
    const dx = (x - centreX) / height;
    const dyTop = (y - this.rect.y) / this.rect.height;
    const inside = Math.abs(x - centreX) <= this.rect.width / 2
      && y >= this.rect.y && y <= this.rect.y + this.rect.height;

    const nearestX = Math.max(this.rect.x, Math.min(this.rect.x + this.rect.width, x));
    const nearestY = Math.max(this.rect.y, Math.min(this.rect.y + this.rect.height, y));
    const distance = Math.hypot(x - nearestX, y - nearestY) / height;

    if (elapsed > 0) {
      const travelled = Math.hypot(x - previous.x, y - previous.y) / height;
      // Exponential smoothing: a single jumpy sample must not read as a lunge.
      this.speed += (travelled / (elapsed / 1000) - this.speed) * 0.35;
      const rate = (distance - this.distance) / (elapsed / 1000);
      this.closingRate += (rate - this.closingRate) * 0.35;
    }

    this.pointer = { x, y, at, known: true };
    this.distance = distance;
    this.region = inside ? regionAt(dx, dyTop) : "none";

    const emitted: PerceptionEvent[] = [];
    const nextDirection = this.resolveDirection(distance);
    if (nextDirection !== this.direction) {
      this.direction = nextDirection;
      // Only the transition is news; staying "approaching" for a second is not.
      if (nextDirection === "approaching" && !this.approachReported) {
        this.approachReported = true;
        emitted.push(this.event("pointer-approaching", at, this.region, clamp01(this.speed / 3), 1));
      }
      if (nextDirection === "leaving") {
        this.approachReported = false;
        emitted.push(this.event("pointer-leaving", at, "none", clamp01(this.speed / 3), 1));
      }
    }

    if (this.speed < DWELL_SPEED && distance < DWELL_DISTANCE) {
      this.dwellSince ??= at;
      if (!this.dwellReported && at - this.dwellSince >= DWELL_HOLD_MS) {
        this.dwellReported = true;
        emitted.push(this.event("pointer-dwelling", at, this.region, 0.4, 1));
      }
    } else {
      this.dwellSince = null;
      this.dwellReported = false;
    }

    return emitted;
  }

  private resolveDirection(distance: number): PointerDirection {
    if (!this.pointer.known) return "none";
    if (this.closingRate < -APPROACH_RATE && distance < APPROACH_RANGE) return "approaching";
    if (this.closingRate > APPROACH_RATE) return "leaving";
    if (this.speed > 1.2) return "passing";
    return "none";
  }

  private foldTouch(at: number, region: BodyRegion, isDouble: boolean): PerceptionEvent {
    const withinWindow = this.lastTouchAt !== null && at - this.lastTouchAt <= this.streakWindowMs;
    this.clickStreak = withinWindow ? this.clickStreak + 1 : 1;
    this.lastTouchAt = at;
    this.lastTouchRegion = region;
    this.lastTouchWasDouble = isDouble;
    this.lastInteractionAt = at;
    this.idleReported = false;

    // A streak is a different experience from a poke, not a louder one, so it gets its
    // own event kind: the emotion rules and the reflexes react to them differently.
    const repeated = this.clickStreak >= REPEAT_TOUCH_STREAK;
    const intensity = clamp01((isDouble ? 0.5 : 0.35) + this.clickStreak * 0.06);
    return this.event(repeated ? "repeated-touch" : "touch", at, region, intensity, this.clickStreak);
  }

  private event(
    kind: PerceptionEventKind,
    at: number,
    region: BodyRegion,
    intensity: number,
    repeat: number,
  ): PerceptionEvent {
    return {
      schemaVersion: NEURO_SCHEMA_VERSION,
      kind,
      at,
      region,
      intensity: clamp01(intensity),
      repeat: Math.max(1, Math.round(repeat)),
    };
  }

  private interactionType(now: number): InteractionType {
    if (this.dragging) return "drag";
    if (this.pressedAt !== null && now - this.pressedAt >= LONG_PRESS_MS) return "long-press";
    if (this.lastTouchAt !== null && now - this.lastTouchAt <= 400) {
      return this.lastTouchWasDouble ? "double-click" : "click";
    }
    return this.region !== "none" ? "hover" : "none";
  }

  worldState(now: number): WorldState {
    const streakLive = this.lastTouchAt !== null && now - this.lastTouchAt <= this.streakWindowMs;
    const centreX = this.rect.x + this.rect.width / 2;
    return {
      schemaVersion: NEURO_SCHEMA_VERSION,
      timestamp: now,
      pointer: {
        dx: this.pointer.known ? (this.pointer.x - centreX) / this.characterHeightPx : 0,
        dy: this.pointer.known ? (this.pointer.y - (this.rect.y + this.rect.height)) / this.characterHeightPx : 0,
        speed: Math.max(0, this.speed),
        direction: this.direction,
        targetRegion: this.region,
        distance: Number.isFinite(this.distance) ? this.distance : 99,
        onCharacter: this.region !== "none",
      },
      interaction: {
        type: this.interactionType(now),
        clickStreak: streakLive ? this.clickStreak : 0,
        intensity: streakLive ? clamp01(0.3 + this.clickStreak * 0.08) : 0,
        region: streakLive ? this.lastTouchRegion : "none",
        lastAt: this.lastTouchAt,
      },
      agent: { state: this.agentState, connected: this.agentConnected },
      environment: {
        userIdleMs: Math.max(0, now - this.lastInteractionAt),
        canMove: this.canMove,
        canDock: this.canDock,
        timeOfDay: timeOfDayAt(now),
      },
    };
  }
}


