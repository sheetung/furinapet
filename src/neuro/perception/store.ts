/**
 * Pet-window perception store: owns the WorldState accumulator and wires the
 * runtime event sources (senses, agent state, pointer sampler) into it.
 * Nothing here talks to AI; the world state is only read by the character
 * layer, the cerebellum and the debug UI.
 */

import { listen } from "@tauri-apps/api/event";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { desktop } from "../../api";
import { PET_SENSE_EVENT } from "../../plugins/dom-bridge";
import type { BrainAgentStateEvent, PetSenseEventDetail } from "../../pet-brain/types";
import type {
  PerceptionEvent,
  WorldState,
} from "../contracts";
import {
  emptyPerceptionMemory,
  reducePerceptionEvent,
  regionAtPointer,
  tickWorldState,
  type PetGeometry,
  type PerceptionMemory,
} from "./perception-reducer";

const POINTER_SAMPLE_MS = 125;
const TICK_MS = 1000;

class WorldStateStore {
  private world: WorldState;
  private memory: PerceptionMemory;
  private geometry: PetGeometry | null = null;

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
    this.world = result.world;
    this.memory = result.memory;
  }

  tick(now: number, input: { canMove: boolean; canDock: boolean }) {
    const result = tickWorldState(this.world, this.memory, now, input);
    this.world = result.world;
    this.memory = result.memory;
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
    state.dispatch({
      type: "pointer",
      at: Date.now(),
      x: pointer.x,
      y: pointer.y,
      region: regionAtPointer(pointer, geometry),
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

function senseToPerceptionEvent(detail: PetSenseEventDetail): PerceptionEvent | null {
  const at = detail.at;
  switch (detail.name) {
    case "pet:clicked":
    case "pet:doubleClicked":
      return { type: "touch", at, sense: detail.name, region: "none", streak: 0, intensity: 0 };
    case "pet:dragStart":
      return { type: "drag", at, phase: "start" };
    case "pet:dragEnd":
      return { type: "drag", at, phase: "end" };
    default:
      return null;
  }
}

let bootstrapped = false;

/** Install the perception pipeline in the pet window. Idempotent. */
export function bootstrapNeuroPerception() {
  if (bootstrapped || !("__TAURI_INTERNALS__" in window)) return;
  bootstrapped = true;

  window.addEventListener(PET_SENSE_EVENT, (event) => {
    const detail = (event as CustomEvent<PetSenseEventDetail>).detail;
    if (!detail) return;
    const perception = senseToPerceptionEvent(detail);
    if (perception) getWorldStateStore().dispatch(perception);
  });

  void listen<BrainAgentStateEvent>("pet-brain-agent-state", (event) => {
    getWorldStateStore().dispatch({
      type: "agentState",
      at: Date.now(),
      state: event.payload.state,
      connected: event.payload.state !== "idle",
      ...(event.payload.clientName ? { clientName: event.payload.clientName } : {}),
    });
  }).catch((error) => console.error("[neuro] agent state perception failed", error));

  const pointerTimer = window.setInterval(() => void samplePointer(), POINTER_SAMPLE_MS);
  const tickTimer = window.setInterval(() => void tickEnvironment(), TICK_MS);
  void tickEnvironment();

  window.addEventListener("beforeunload", () => {
    window.clearInterval(pointerTimer);
    window.clearInterval(tickTimer);
  });
}
