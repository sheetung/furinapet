/**
 * Pet-window perception store: owns the WorldState accumulator and wires the
 * runtime event sources (senses, agent state, pointer sampler) into it.
 * Nothing here talks to AI; the world state is only read by the character
 * layer, the cerebellum and the debug UI.
 */

import { listen } from "@tauri-apps/api/event";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { desktop } from "../../api";
import { PET_SENSE_EVENT, petSpriteScreenRect } from "../../plugins/dom-bridge";
import { getCharacterStore } from "../character/character-store";
import type { BrainAgentStateEvent, PetSenseEventDetail } from "../../pet-brain/types";
import type {
  PerceptionEvent,
  WorldState,
} from "../contracts";
import {
  emptyPerceptionMemory,
  formatPerceptionLogEntry,
  reducePerceptionEvent,
  regionAtPointer,
  tickWorldState,
  type PerceptionLogEntry,
  type PetGeometry,
  type PerceptionMemory,
} from "./perception-reducer";

const POINTER_SAMPLE_MS = 125;
const TICK_MS = 1000;
const PERCEPTION_LOG_LIMIT = 30;
const PERCEPTION_LOG_POINTER_THROTTLE_MS = 1000;

class WorldStateStore {
  private world: WorldState;
  private memory: PerceptionMemory;
  private geometry: PetGeometry | null = null;
  private log: PerceptionLogEntry[] = [];
  private lastPointerLogAt = 0;

  constructor(at: number) {
    this.world = {
      timestamp: at,
      pointer: {
        x: 0, y: 0, vx: 0, vy: 0, speed: 0,
        motion: "stationary", targetRegion: "none", distanceToCharacter: 1,
      },
      interaction: { type: "none", clickStreak: 0, intensity: 0 },
      agent: { state: "idle", connected: false },
      environment: { userIdleMs: 0, canMove: false, canDock: false },
    };
    this.memory = emptyPerceptionMemory();
  }

  setGeometry(geometry: PetGeometry | null) {
    this.geometry = geometry;
  }

  getGeometry() {
    return this.geometry;
  }

  dispatch(event: PerceptionEvent) {
    const result = reducePerceptionEvent(this.world, this.memory, event, this.geometry);
    // Stationary pointer samples still refresh WorldState (velocity, region)
    // but must not stimulate the character: the sampler fires ~8×/s, so
    // observing every sample pins arousal at 1.0 regardless of gating in the
    // character store.
    const pointerMoved =
      event.type !== "pointer" ||
      result.world.pointer.x !== this.world.pointer.x ||
      result.world.pointer.y !== this.world.pointer.y;
    this.world = result.world;
    this.memory = result.memory;
    this.appendLog(event);
    if (pointerMoved) getCharacterStore().observe(event);
  }

  /** Newest-first perception event log for the LMC inspector. */
  getLog(): readonly PerceptionLogEntry[] {
    return this.log;
  }

  private appendLog(event: PerceptionEvent) {
    if (event.type === "pointer") {
      // The sampler fires ~8×/s; one line per second is plenty for the drawer.
      if (event.at - this.lastPointerLogAt < PERCEPTION_LOG_POINTER_THROTTLE_MS) return;
      this.lastPointerLogAt = event.at;
    }
    this.log.unshift(formatPerceptionLogEntry(event));
    if (this.log.length > PERCEPTION_LOG_LIMIT) this.log.length = PERCEPTION_LOG_LIMIT;
  }

  tick(now: number, input: { canMove: boolean; canDock: boolean }) {
    const result = tickWorldState(this.world, this.memory, now, input);
    this.world = result.world;
    this.memory = result.memory;
    getCharacterStore().tick(now);
  }

  snapshot(): WorldState {
    return this.world;
  }
}

let store: WorldStateStore | null = null;

export function getWorldStateStore(): WorldStateStore {
  if (!store) store = new WorldStateStore(Date.now());
  return store;
}

export function getWorldState(): WorldState {
  return getWorldStateStore().snapshot();
}

/** Newest-first recent perception events (LMC inspector Perception drawer). */
export function getPerceptionLog(): readonly PerceptionLogEntry[] {
  return getWorldStateStore().getLog();
}

async function samplePointer() {
  const petWindow = getCurrentWindow();
  try {
    const [pointer, position, size] = await Promise.all([
      cursorPosition(),
      petWindow.outerPosition(),
      petWindow.outerSize(),
    ]);
    const geometry: PetGeometry = {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };
    const state = getWorldStateStore();
    state.setGeometry(geometry);
    // The sprite may sit below an expanded bubble; classify against its real
    // visual bounds so regions do not shift upward while the bubble is open.
    const spriteRect = petSpriteScreenRect(position);
    state.dispatch({
      type: "pointer",
      at: Date.now(),
      x: pointer.x,
      y: pointer.y,
      region: spriteRect ? regionAtPointer(pointer, spriteRect) : regionAtPointer(pointer, geometry),
    });
  } catch {
    // The pet window may be hidden or closing; skip this sample.
  }
}

async function tickEnvironment() {
  try {
    const settings = await desktop.getSettings();
    const canMove = settings.autonomousMovement && settings.petVisible;
    const canDock = canMove && settings.windowDocking && !settings.gravityEnabled;
    getWorldStateStore().tick(Date.now(), { canMove, canDock });
  } catch {
    getWorldStateStore().tick(Date.now(), { canMove: false, canDock: false });
  }
}

/** Map a pet-sense detail onto its perception event. Exported for tests. */
export function senseToPerceptionEvent(detail: PetSenseEventDetail): PerceptionEvent | null {
  const at = detail.at;
  switch (detail.name) {
    case "pet:clicked":
    case "pet:doubleClicked":
      return { type: "touch", at, sense: detail.name, region: detail.region ?? "none", streak: 0, intensity: 0 };
    case "pet:dragStart":
      return { type: "drag", at, phase: "start" };
    case "pet:dragEnd":
      return { type: "drag", at, phase: "end" };
    default:
      return null;
  }
}

let bootstrapped = false;
let teardown: (() => void) | null = null;

/** Install the perception pipeline in the pet window. Idempotent. */
export function bootstrapNeuroPerception() {
  if (bootstrapped || !("__TAURI_INTERNALS__" in window)) return;
  bootstrapped = true;

  const onSense = (event: Event) => {
    const detail = (event as CustomEvent<PetSenseEventDetail>).detail;
    if (!detail) return;
    const perception = senseToPerceptionEvent(detail);
    if (perception) getWorldStateStore().dispatch(perception);
  };
  window.addEventListener(PET_SENSE_EVENT, onSense);

  let stopAgentStateListener: (() => void) | null = null;
  void listen<BrainAgentStateEvent>("pet-brain-agent-state", (event) => {
    getWorldStateStore().dispatch({
      type: "agentState",
      at: Date.now(),
      state: event.payload.state,
      connected: event.payload.state !== "idle",
      ...(event.payload.clientName ? { clientName: event.payload.clientName } : {}),
    });
  }).then((unlisten) => {
    if (!bootstrapped) unlisten();
    else stopAgentStateListener = unlisten;
  }).catch((error) => console.error("[neuro] agent state perception failed", error));

  const pointerTimer = window.setInterval(() => void samplePointer(), POINTER_SAMPLE_MS);
  const tickTimer = window.setInterval(() => void tickEnvironment(), TICK_MS);
  void tickEnvironment();

  const onBeforeUnload = () => teardown?.();
  window.addEventListener("beforeunload", onBeforeUnload);

  teardown = () => {
    window.removeEventListener(PET_SENSE_EVENT, onSense);
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.clearInterval(pointerTimer);
    window.clearInterval(tickTimer);
    stopAgentStateListener?.();
    stopAgentStateListener = null;
  };
}

/** Tear down the perception pipeline (samplers + listeners). Test/HMR safety. */
export function disposeNeuroPerception() {
  teardown?.();
  teardown = null;
  bootstrapped = false;
}
