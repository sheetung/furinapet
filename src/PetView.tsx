import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  cursorPosition,
  currentMonitor,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { desktop } from "./api";
import { characterRegistry, getCharacter, loadCharacterRegistry, type CharacterDefinition } from "./characters/registry";
import { computeLookDirection, mapLookDirection, type LookCell } from "./core/look-direction";
import {
  advanceSpeed,
  chooseDockPlacement,
  chooseWanderTarget,
  nextDecisionDelay,
  pauseDuration,
  type DockEdge,
  type DockPlacement,
  type Point,
  type WanderBounds,
  type WindowSurface,
  type WorkArea,
} from "./core/wander-controller";
import { PetBrain } from "./pet-brain";
import { planWanderGoal } from "./pet-brain/adapters/wander";
import { publishPetBrainSnapshot } from "./pet-brain/runtime";
import { resolveRenderBackend, resolveVrmUrl } from "./motion/config";
import type { StageSenseSample } from "./render/PetStage3D";
import type { AppSettings, MotionReaction, ReactionEvent } from "./types";
import "./pet.css";

/**
 * three.js and @pixiv/three-vrm are roughly 800 kB of the bundle. The sprite
 * backend is the default, so the 3D stack is split out and only fetched once a
 * character actually needs a skeleton.
 */
const PetCanvas = lazy(() => import("./PetCanvas"));

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const BUBBLE_SPACE = 92;
const MOTION_INTERVAL_MS = 32;
const GRAVITY_ACCELERATION = 2200;
const MAX_FALL_SPEED = 1250;
const GROUNDED_Y_TOLERANCE = 2;
const MIN_EFFECTIVE_MOTION_PX = 1;
const MAX_STALLED_TICKS = 4;
/** The 2D cell is 208 px tall and the 3D rigs are ~1.5 m, which fixes the scale. */
const PIXELS_PER_METRE = CELL_HEIGHT / 1.5;

interface FrameRow {
  row: number;
  durations: readonly number[];
}

/** Exact v2 used columns and per-frame timings. Never sample transparent tail cells. */
const frameRows: Record<MotionReaction, FrameRow> = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  "run-right": { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  "run-left": { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
};

interface WanderState {
  mode: "idle" | "walking" | "approaching" | "docked";
  target: Point | null;
  nextAt: number;
  speed: number;
  missedOpportunities: number;
  dockSurfaceId: string | null;
  dockEdge: DockEdge | null;
  dockRatio: number;
  dockUntil: number;
  dockRefreshAt: number;
  workArea: WorkArea | null;
  workAreaRefreshAt: number;
  lastPosition: Point | null;
  stalledTicks: number;
}

interface MotionState {
  dragging: boolean;
  falling: boolean;
  fallToken: number;
}

/**
 * High-frequency observations for the 3D backend.
 *
 * Kept in a ref rather than state: the render loop pulls this every frame, and
 * routing a moving cursor through `setState` would re-render the pet tree at the
 * cursor's sample rate for values React never displays.
 */
interface SenseState {
  gazeOffsetX: number;
  gazeOffsetY: number;
  gazeFocalPixels: number;
  gazeActive: boolean;
  velocityPxPerSecond: number;
  grounded: boolean;
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export function PetView() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [characters, setCharacters] = useState<CharacterDefinition[]>(characterRegistry);
  const [reaction, setReaction] = useState<MotionReaction>("idle");
  const [animationEpoch, setAnimationEpoch] = useState(0);
  const [spriteFrame, setSpriteFrame] = useState(0);
  const [look, setLook] = useState<LookCell | null>(null);
  const [message, setMessage] = useState("");
  const [bubbleEpoch, setBubbleEpoch] = useState(0);
  const reactionTimer = useRef<number | null>(null);
  const reactionRef = useRef<MotionReaction>(reaction);
  const settingsRef = useRef(settings);
  const charactersRef = useRef(characters);
  const motionRef = useRef<MotionState>({ dragging: false, falling: false, fallToken: 0 });
  const layoutQueue = useRef<Promise<void>>(Promise.resolve());
  const bubbleExpandedRef = useRef(false);
  const bubbleClampRef = useRef(0);
  const brainRef = useRef<PetBrain | null>(null);
  if (!brainRef.current) brainRef.current = new PetBrain();
  const backendRef = useRef(resolveRenderBackend());
  const vrmUrlRef = useRef(resolveVrmUrl());
  const senseRef = useRef<SenseState>({
    gazeOffsetX: 0,
    gazeOffsetY: 0,
    gazeFocalPixels: CELL_HEIGHT,
    gazeActive: false,
    velocityPxPerSecond: 0,
    grounded: true,
  });

  /**
   * The speech bubble is the only surface the pet window has, so a rig problem is
   * reported there — but on a timer, because a stuck error bubble also permanently
   * enlarges the window.
   */
  function reportRigFallback(reason: string) {
    if (reactionTimer.current) window.clearTimeout(reactionTimer.current);
    setMessage(reason);
    setBubbleEpoch((value) => value + 1);
    reactionTimer.current = window.setTimeout(() => {
      reactionTimer.current = null;
      setMessage("");
    }, 6000);
  }

  const readSenses = (): StageSenseSample => {    const senses = senseRef.current;
    return {
      gaze: senses.gazeActive
        ? { offsetX: senses.gazeOffsetX, offsetY: senses.gazeOffsetY, focalPixels: senses.gazeFocalPixels }
        : null,
      velocityPxPerSecond: senses.velocityPxPerSecond,
      pixelsPerMetre: PIXELS_PER_METRE * (settingsRef.current?.scale ?? 1),
      grounded: senses.grounded,
    };
  };

  useEffect(() => { reactionRef.current = reaction; }, [reaction]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { charactersRef.current = characters; }, [characters]);

  useEffect(() => {
    void loadCharacterRegistry().then(setCharacters).catch(() => {
      // Keep the built-in Furina character when local storage is unavailable.
    });
  }, [settings?.selectedCharacterId]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const cleanup = listen<string>("characters-changed", () => {
      void loadCharacterRegistry().then(setCharacters);
    });
    return () => { void cleanup.then((unlisten) => unlisten()); };
  }, []);

  function resizeForBubble(expanded: boolean, scale: number) {
    if (!("__TAURI_INTERNALS__" in window)) return Promise.resolve();

    layoutQueue.current = layoutQueue.current.then(async () => {
      const petWindow = getCurrentWindow();
      const [factor, position, size] = await Promise.all([
        petWindow.scaleFactor(),
        petWindow.outerPosition(),
        petWindow.outerSize(),
      ]);
      const targetWidth = Math.round(CELL_WIDTH * scale * factor);
      const targetHeight = Math.round((CELL_HEIGHT * scale + (expanded ? BUBBLE_SPACE : 0)) * factor);
      const heightDelta = targetHeight - size.height;
      let targetY = position.y - heightDelta;

      if (expanded && !bubbleExpandedRef.current) {
        let workArea: WorkArea | null = null;
        try {
          workArea = await desktop.getWorkAreaAt(
            Math.round(position.x + size.width / 2),
            Math.round(position.y + size.height / 2),
          );
        } catch {
          const monitor = await currentMonitor();
          if (monitor) {
            workArea = {
              x: monitor.position.x,
              y: monitor.position.y,
              width: monitor.size.width,
              height: monitor.size.height,
            };
          }
        }

        if (workArea) {
          const clampedY = Math.max(workArea.y, targetY);
          bubbleClampRef.current = clampedY - targetY;
          targetY = clampedY;
        } else {
          bubbleClampRef.current = 0;
        }
        bubbleExpandedRef.current = true;
      } else if (!expanded && bubbleExpandedRef.current) {
        targetY -= bubbleClampRef.current;
        bubbleClampRef.current = 0;
        bubbleExpandedRef.current = false;
      }

      await Promise.all([
        petWindow.setSize(new PhysicalSize(targetWidth, targetHeight)),
        petWindow.setPosition(new PhysicalPosition(position.x, targetY)),
      ]);
    }).catch(() => {
      // The pet window may be hidden or closing while a reaction ends.
    });

    return layoutQueue.current;
  }

  function changeReaction(next: MotionReaction, restart = false) {
    if (reactionRef.current !== next) {
      reactionRef.current = next;
      setReaction(next);
    } else if (restart) {
      setAnimationEpoch((value) => value + 1);
    }
  }

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void desktop.getSettings().then(setSettings);
    const cleanups = Promise.all([
      listen<AppSettings>("settings-changed", (event) => setSettings(event.payload)),
      listen<ReactionEvent>("pet-reaction", (event) => {
        const payload = event.payload;
        if (reactionTimer.current) window.clearTimeout(reactionTimer.current);
        setLook(null);
        changeReaction(payload.reaction, true);
        setMessage(payload.message ?? "");
        setBubbleEpoch((value) => value + 1);
        reactionTimer.current = window.setTimeout(() => {
          reactionTimer.current = null;
          changeReaction("idle");
          setMessage("");
        }, payload.durationMs ?? 2600);
      }),
    ]);
    return () => { void cleanups.then((items) => items.forEach((cleanup) => cleanup())); };
  }, []);

  useEffect(() => {
    setSpriteFrame(0);
    if (look) return;

    const spec = frameRows[reaction];
    let stopped = false;
    let timer = 0;
    let frame = 0;

    const scheduleNext = () => {
      timer = window.setTimeout(() => {
        if (stopped) return;
        frame = (frame + 1) % spec.durations.length;
        setSpriteFrame(frame);
        scheduleNext();
      }, spec.durations[frame]);
    };
    scheduleNext();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [reaction, animationEpoch, look?.index, settings?.selectedCharacterId]);

  useEffect(() => {
    if (!settings) return;
    void resizeForBubble(message.length > 0, settings.scale);
  }, [message.length > 0, settings?.scale, bubbleEpoch]);

  useEffect(() => {
    const petWindow = getCurrentWindow();
    const wander: WanderState = {
      mode: "idle",
      target: null,
      nextAt: Date.now() + 6000,
      speed: 0,
      missedOpportunities: 0,
      dockSurfaceId: null,
      dockEdge: null,
      dockRatio: 0.5,
      dockUntil: 0,
      dockRefreshAt: 0,
      workArea: null,
      workAreaRefreshAt: 0,
      lastPosition: null,
      stalledTicks: 0,
    };
    let cancelled = false;
    let timer = 0;
    let lastLook = -1;
    let lastLookAt = 0;
    let lastGazeAt = 0;
    let lastTick = performance.now();
    let lastAutonomousActionAt = Date.now();

    const resetWander = (nextAt = Date.now() + 1500) => {
      wander.mode = "idle";
      wander.target = null;
      wander.nextAt = nextAt;
      wander.speed = 0;
      wander.dockSurfaceId = null;
      wander.dockEdge = null;
      wander.dockUntil = 0;
      wander.lastPosition = null;
      wander.stalledTicks = 0;
    };

    const getWorkArea = async (position: PhysicalPosition, size: PhysicalSize): Promise<WorkArea> => {
      const now = Date.now();
      if (wander.workArea && now < wander.workAreaRefreshAt) return wander.workArea;
      try {
        wander.workArea = await desktop.getWorkAreaAt(
          Math.round(position.x + size.width / 2),
          Math.round(position.y + size.height / 2),
        );
      } catch {
        const monitor = await currentMonitor();
        wander.workArea = monitor
          ? { x: monitor.position.x, y: monitor.position.y, width: monitor.size.width, height: monitor.size.height }
          : { x: position.x, y: position.y, width: size.width, height: size.height };
      }
      wander.workAreaRefreshAt = now + 1000;
      return wander.workArea;
    };

    const makeBounds = (workArea: WorkArea, size: PhysicalSize): WanderBounds => {
      const padding = 24;
      const minX = workArea.x + padding;
      const minY = workArea.y + padding;
      return {
        minX,
        maxX: Math.max(minX, workArea.x + workArea.width - size.width - padding),
        minY,
        maxY: Math.max(minY, workArea.y + workArea.height - size.height - padding),
        groundY: Math.max(workArea.y, workArea.y + workArea.height - size.height),
      };
    };

    const refreshDockTarget = async (
      surfaces: WindowSurface[],
      size: PhysicalSize,
      workArea: WorkArea,
    ): Promise<DockPlacement | null> => {
      const surface = surfaces.find((candidate) => candidate.id === wander.dockSurfaceId);
      return surface && wander.dockEdge
        ? chooseDockPlacement(surface, size, workArea, 0, wander.dockRatio, wander.dockEdge)
        : null;
    };

    const tick = async () => {
      const currentSettings = settingsRef.current;
      if (cancelled) return;
      if (!currentSettings) {
        timer = window.setTimeout(() => void tick(), MOTION_INTERVAL_MS);
        return;
      }
      const now = performance.now();
      const wallClock = Date.now();
      const elapsed = Math.min(64, now - lastTick);
      lastTick = now;

      try {
        senseRef.current.grounded = !motionRef.current.falling;
        if (motionRef.current.dragging || motionRef.current.falling) {
          resetWander();
          return;
        }

        const userReactionActive = reactionTimer.current !== null;
        const isLocomotionState = !userReactionActive && (reactionRef.current === "idle"
          || reactionRef.current === "run-left"
          || reactionRef.current === "run-right"
          || reactionRef.current === "jumping"
          || (wander.mode === "docked" && (reactionRef.current === "waiting" || reactionRef.current === "review")));
        let position = await petWindow.outerPosition();
        const size = await petWindow.outerSize();
        const activeCharacter = getCharacter(currentSettings.selectedCharacterId, charactersRef.current);
        const profile = activeCharacter.wanderProfile!;
        const workArea = await getWorkArea(position, size);
        const bounds = makeBounds(workArea, size);

        if (currentSettings.autonomousMovement && isLocomotionState) {
          if (wander.mode === "docked") {
            if (!currentSettings.windowDocking || wallClock >= wander.dockUntil) {
              resetWander(wallClock + pauseDuration(profile));
              changeReaction("idle");
              if (currentSettings.gravityEnabled) {
                void settleWithGravity();
                return;
              }
            } else if (wallClock >= wander.dockRefreshAt) {
              wander.dockRefreshAt = wallClock + 450;
              const point = await refreshDockTarget(await desktop.listDockSurfaces(), size, workArea);
              if (!point || Math.hypot(point.x - position.x, point.y - position.y) > 140) {
                resetWander(wallClock + pauseDuration(profile));
                changeReaction("idle");
                if (currentSettings.gravityEnabled) {
                  void settleWithGravity();
                  return;
                }
              } else {
                await petWindow.setPosition(new PhysicalPosition(point.x, point.y));
                position = new PhysicalPosition(point.x, point.y);
              }
            }
          }

          if (
            currentSettings.gravityEnabled
            && wander.mode === "idle"
            && Math.abs(position.y - bounds.groundY) > GROUNDED_Y_TOLERANCE
          ) {
            resetWander(wallClock + 300);
            changeReaction("idle");
            void settleWithGravity();
            return;
          }

          if (wander.mode === "idle" && wallClock >= wander.nextAt) {
            wander.nextAt = wallClock + nextDecisionDelay(profile);
            const brain = brainRef.current!;
            const goal = planWanderGoal(brain, {
              now: wallClock,
              autonomousMovement: currentSettings.autonomousMovement,
              canMove: isLocomotionState,
              canDock: currentSettings.windowDocking,
              userReactionActive,
              idleForMs: wallClock - lastAutonomousActionAt,
              wanderWeight: currentSettings.wanderWeight,
              dockWeight: currentSettings.dockWeight,
              missedOpportunities: wander.missedOpportunities,
              profile,
            });
            publishPetBrainSnapshot();

            if (goal === "wander" || goal === "dock") {
              wander.missedOpportunities = 0;
              if (goal === "dock" && currentSettings.windowDocking) {
                const candidates = (await desktop.listDockSurfaces())
                  .map((surface) => ({
                    surface,
                    ratio: 0.15 + Math.random() * 0.7,
                    edgeRoll: Math.random(),
                  }))
                  .map((candidate) => ({
                    ...candidate,
                    placement: chooseDockPlacement(
                      candidate.surface,
                      size,
                      workArea,
                      candidate.edgeRoll,
                      candidate.ratio,
                    ),
                  }))
                  .filter((candidate): candidate is typeof candidate & { placement: DockPlacement } => candidate.placement !== null);
                const candidate = candidates[Math.floor(Math.random() * candidates.length)];
                if (candidate) {
                  wander.mode = "approaching";
                  wander.target = candidate.placement;
                  wander.dockSurfaceId = candidate.surface.id;
                  wander.dockEdge = candidate.placement.edge;
                  wander.dockRatio = candidate.ratio;
                  wander.lastPosition = null;
                  wander.stalledTicks = 0;
                  lastAutonomousActionAt = wallClock;
                }
              }
              if (wander.mode === "idle") {
                wander.mode = "walking";
                wander.target = chooseWanderTarget(position, bounds, currentSettings.gravityEnabled, profile);
                if (currentSettings.gravityEnabled) wander.target.y = bounds.groundY;
                wander.lastPosition = null;
                wander.stalledTicks = 0;
                lastAutonomousActionAt = wallClock;
              }
            } else {
              wander.missedOpportunities += 1;
            }
          }

          if ((wander.mode === "walking" || wander.mode === "approaching") && wander.target) {
            if (wander.mode === "approaching" && wallClock >= wander.dockRefreshAt) {
              wander.dockRefreshAt = wallClock + 450;
              const point = await refreshDockTarget(await desktop.listDockSurfaces(), size, workArea);
              if (point) wander.target = point;
              else resetWander(wallClock + pauseDuration(profile));
            }
          }

          if ((wander.mode === "walking" || wander.mode === "approaching") && wander.target) {
            const groundedWander = wander.mode === "walking" && currentSettings.gravityEnabled;
            if (wander.mode === "approaching") {
              wander.target.x = Math.min(
                workArea.x + workArea.width - size.width - 8,
                Math.max(workArea.x + 8, wander.target.x),
              );
              wander.target.y = Math.min(
                workArea.y + workArea.height - size.height,
                Math.max(workArea.y + 8, wander.target.y),
              );
            } else {
              wander.target.x = Math.min(bounds.maxX, Math.max(bounds.minX, wander.target.x));
              wander.target.y = groundedWander
                ? bounds.groundY
                : Math.min(bounds.maxY, Math.max(bounds.minY, wander.target.y));
            }

            if (groundedWander && Math.abs(position.y - bounds.groundY) > GROUNDED_Y_TOLERANCE) {
              resetWander(wallClock + 300);
              changeReaction("idle");
              void settleWithGravity();
              return;
            }

            if (wander.lastPosition) {
              const progress = Math.hypot(
                position.x - wander.lastPosition.x,
                position.y - wander.lastPosition.y,
              );
              wander.stalledTicks = progress < 0.5 ? wander.stalledTicks + 1 : 0;
              if (wander.stalledTicks >= MAX_STALLED_TICKS) {
                resetWander(wallClock + 450);
                changeReaction("idle");
                return;
              }
            }
            wander.lastPosition = { x: position.x, y: position.y };

            const dx = wander.target.x - position.x;
            const dy = groundedWander ? 0 : wander.target.y - position.y;
            const distance = groundedWander ? Math.abs(dx) : Math.hypot(dx, dy);
            if (distance < 3) {
              const finalY = groundedWander ? bounds.groundY : wander.target.y;
              await petWindow.setPosition(new PhysicalPosition(wander.target.x, finalY));
              if (wander.mode === "approaching") {
                wander.mode = "docked";
                wander.target = null;
                wander.speed = 0;
                wander.dockUntil = wallClock + pauseDuration(profile);
                wander.dockRefreshAt = 0;
                wander.lastPosition = null;
                wander.stalledTicks = 0;
                const sideDock = wander.dockEdge === "left" || wander.dockEdge === "right";
                changeReaction(sideDock || Math.random() < profile.curiosity ? "review" : "waiting", true);
              } else {
                resetWander(wallClock + pauseDuration(profile));
                changeReaction("idle");
              }
            } else {
              wander.speed = advanceSpeed(
                wander.speed,
                distance,
                elapsed / 1000,
                currentSettings.wanderSpeed * profile.preferredSpeed,
              );
              const step = Math.min(distance, wander.speed * elapsed / 1000);
              let nextX = groundedWander
                ? Math.round(position.x + Math.sign(dx) * step)
                : Math.round(position.x + dx / distance * step);
              let nextY = groundedWander
                ? bounds.groundY
                : Math.round(position.y + dy / distance * step);

              if (nextX === position.x && nextY === position.y) {
                if (groundedWander || Math.abs(dx) >= Math.abs(dy)) {
                  nextX = position.x + Math.sign(dx) * MIN_EFFECTIVE_MOTION_PX;
                } else {
                  nextY = position.y + Math.sign(dy) * MIN_EFFECTIVE_MOTION_PX;
                }
              }

              const previousX = position.x;
              position = new PhysicalPosition(nextX, nextY);
              await petWindow.setPosition(position);
              senseRef.current.velocityPxPerSecond = (nextX - previousX) / (elapsed / 1000);
              setLook(null);
              changeReaction(groundedWander
                ? dx >= 0 ? "run-right" : "run-left"
                : Math.abs(dy) > Math.abs(dx) * 1.25 ? "jumping" : dx >= 0 ? "run-right" : "run-left");
            }
          } else {
            senseRef.current.velocityPxPerSecond = 0;
          }
        } else {
          senseRef.current.velocityPxPerSecond = 0;
          if (!userReactionActive) {
            const shouldFall = wander.mode === "docked" && currentSettings.gravityEnabled;
            resetWander();
            if (reactionRef.current === "run-left" || reactionRef.current === "run-right" || reactionRef.current === "jumping") {
              changeReaction("idle");
            }
            if (shouldFall) {
              void settleWithGravity();
              return;
            }
          }
        }

        const spriteLookDue = wander.mode === "idle"
          && currentSettings.lookAtCursor
          && reactionRef.current === "idle"
          && now - lastLookAt >= 96;
        // The 3D backend aims continuously and is not gated on the idle sprite row:
        // a bone chain can turn its head while walking, a 16-cell atlas cannot.
        const gazeDue = backendRef.current !== "sprite" && currentSettings.lookAtCursor && now - lastGazeAt >= 64;

        if (spriteLookDue || gazeDue) {
          const cursor = await cursorPosition();
          const petHeight = CELL_HEIGHT * currentSettings.scale * window.devicePixelRatio;

          if (gazeDue) {
            lastGazeAt = now;
            const senses = senseRef.current;
            // Aim from the head, not the cell centre, or the character looks past
            // the cursor by half a body height.
            senses.gazeOffsetX = cursor.x - (position.x + size.width / 2);
            senses.gazeOffsetY = cursor.y - (position.y + size.height - petHeight * 0.9);
            senses.gazeFocalPixels = petHeight;
            senses.gazeActive = Math.hypot(senses.gazeOffsetX, senses.gazeOffsetY) > petHeight * 0.22;
          }

          if (spriteLookDue) {
            lastLookAt = now;
            const origin = {
              x: position.x + size.width / 2,
              y: position.y + size.height - petHeight / 2,
            };
            if (Math.hypot(cursor.x - origin.x, cursor.y - origin.y) > Math.max(size.width, size.height) * 0.55) {
              const cell = computeLookDirection(origin, cursor);
              if (cell.index !== lastLook) {
                lastLook = cell.index;
                setLook(cell);
              }
            } else if (lastLook !== -1) {
              lastLook = -1;
              setLook(null);
            }
          }
        }

        if (!currentSettings.lookAtCursor) senseRef.current.gazeActive = false;
        if (!spriteLookDue && (wander.mode !== "idle" || reactionRef.current !== "idle") && lastLook !== -1) {
          lastLook = -1;
          setLook(null);
        }
      } catch {
        if (wander.mode === "walking" || wander.mode === "approaching") {
          wander.stalledTicks += 1;
          if (wander.stalledTicks >= MAX_STALLED_TICKS) {
            resetWander(Date.now() + 450);
            changeReaction("idle");
          }
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void tick(), MOTION_INTERVAL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window) || !settings?.gravityEnabled) return;
    const timer = window.setTimeout(() => void settleWithGravity(), 80);
    return () => window.clearTimeout(timer);
  }, [settings?.gravityEnabled, settings?.scale]);

  async function settleWithGravity() {
    const currentSettings = settingsRef.current;
    if (!currentSettings?.gravityEnabled) return;

    const motion = motionRef.current;
    const token = ++motion.fallToken;
    motion.falling = true;
    setLook(null);

    try {
      const petWindow = getCurrentWindow();
      const [position, size] = await Promise.all([
        petWindow.outerPosition(),
        petWindow.outerSize(),
      ]);
      let workArea: WorkArea;
      try {
        workArea = await desktop.getWorkAreaAt(
          Math.round(position.x + size.width / 2),
          Math.round(position.y + size.height / 2),
        );
      } catch {
        const monitor = await currentMonitor();
        if (!monitor) return;
        workArea = {
          x: monitor.position.x,
          y: monitor.position.y,
          width: monitor.size.width,
          height: monitor.size.height,
        };
      }

      const groundY = workArea.y + workArea.height - size.height;
      if (position.y >= groundY - 1) {
        await petWindow.setPosition(new PhysicalPosition(position.x, groundY));
        return;
      }
      changeReaction("jumping", true);
      let y = Math.min(position.y, groundY);
      let velocity = 40;
      let previous = performance.now();

      while (y < groundY && motionRef.current.fallToken === token && !motionRef.current.dragging) {
        await delay(16);
        const now = performance.now();
        const seconds = Math.min(0.05, (now - previous) / 1000);
        previous = now;
        velocity = Math.min(MAX_FALL_SPEED, velocity + GRAVITY_ACCELERATION * seconds);
        y = Math.min(groundY, y + velocity * seconds);
        await petWindow.setPosition(new PhysicalPosition(position.x, Math.round(y)));
      }
      if (motionRef.current.fallToken === token) {
        await petWindow.setPosition(new PhysicalPosition(position.x, groundY));
      }
    } catch {
      // The user may hide the pet while it is falling.
    } finally {
      if (motionRef.current.fallToken === token) {
        motionRef.current.falling = false;
        changeReaction("idle");
      }
    }
  }

  async function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (reactionTimer.current) {
      window.clearTimeout(reactionTimer.current);
      reactionTimer.current = null;
    }
    brainRef.current?.interrupt();
    brainRef.current?.observeUserInteraction(Date.now());
    motionRef.current.fallToken += 1;
    motionRef.current.falling = false;
    motionRef.current.dragging = true;
    setMessage("");
    setLook(null);
    changeReaction("idle");
    try {
      await resizeForBubble(false, settingsRef.current?.scale ?? 1);
      await getCurrentWindow().startDragging();
      await desktop.waitForDragRelease();
    } finally {
      motionRef.current.dragging = false;
      await settleWithGravity();
    }
  }

  if (!settings) return null;
  const activeCharacter = getCharacter(settings.selectedCharacterId, characters);
  const displayedLook = look
    ? mapLookDirection(look, activeCharacter.lookDirectionOrder)
    : null;
  const state = frameRows[reaction];
  const column = displayedLook ? displayedLook.column : Math.min(spriteFrame, state.durations.length - 1);
  const row = displayedLook ? displayedLook.row : state.row;
  const style = {
    backgroundPosition: `${-column * CELL_WIDTH}px ${-row * CELL_HEIGHT}px`,
    backgroundImage: `url("${activeCharacter.spriteSheetUrl}")`,
    transform: `scale(${settings.scale})`,
  } as React.CSSProperties;
  const stageStyle = { "--pet-height": `${CELL_HEIGHT * settings.scale}px` } as React.CSSProperties;
  const backend = backendRef.current;

  return (
    <div
      className="pet-stage"
      style={stageStyle}
      onPointerDown={(event) => void beginDrag(event)}
      onDoubleClick={() => void desktop.react("waving", activeCharacter.reactionMessages?.waving ?? "你好呀！")}
      onContextMenu={(event) => { event.preventDefault(); void desktop.showControlCenter(); }}
    >
      {message && <div className="pet-bubble">{message}</div>}
      {backend === "sprite" ? (
        <div className="sprite" style={style} role="img" aria-label={`${activeCharacter.name}：${reaction}`} />
      ) : (
        <Suspense fallback={null}>
          <PetCanvas
            rig={backend}
            vrmUrl={backend === "vrm" ? vrmUrlRef.current : undefined}
            reaction={reaction}
            readSenses={readSenses}
            onRigFallback={reportRigFallback}
            label={`${activeCharacter.name}：${reaction}`}
          />
        </Suspense>
      )}
    </div>
  );
}