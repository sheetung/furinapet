import { useEffect, useRef, useState } from "react";
import { ROUTINE_EVENT, routines, type RoutineStep } from './core/action-routines';
import { actionPlayback, ACTION_PRIORITY } from './core/action-playback';
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
import { computeLookDirection, lookCell, mapLookDirection, type LookCell } from "./core/look-direction";
import { sampleMotion, locomotionReaction, isTravelMotion, type MotionReaction } from './core/sprite-motion';
import { AttentionTracker, isDragDisplacement } from './core/attention';
import { replacementFrame, replacementStyle } from './core/motion-art';
import { motionAssets } from './characters/motion-assets';
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
import type { AppSettings, Reaction, ReactionEvent } from "./types";
import "./pet.css";

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const BUBBLE_SPACE = 92;
const MOTION_INTERVAL_MS = 32;
const GRAVITY_ACCELERATION = 2200;
const MAX_FALL_SPEED = 1250;
const GROUNDED_Y_TOLERANCE = 2;
const MIN_EFFECTIVE_MOTION_PX = 1;
const MAX_STALLED_TICKS = 4;


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

const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export function PetView() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [characters, setCharacters] = useState<CharacterDefinition[]>(characterRegistry);
  const [reaction, setReaction] = useState<MotionReaction>("idle");
  const [animationEpoch, setAnimationEpoch] = useState(0);
  const [spriteCell, setSpriteCell] = useState({ row: 0, column: 0 });
  const [look, setLook] = useState<LookCell | null>(null);
  const [message, setMessage] = useState("");
  const [bubbleEpoch, setBubbleEpoch] = useState(0);
  const reactionRef = useRef<MotionReaction>(reaction);
  const settingsRef = useRef(settings);
  const charactersRef = useRef(characters);
  const motionRef = useRef<MotionState>({ dragging: false, falling: false, fallToken: 0 });
  const layoutQueue = useRef<Promise<void>>(Promise.resolve());
  const bubbleExpandedRef = useRef(false);
  const bubbleClampRef = useRef(0);
  const brainRef = useRef<PetBrain | null>(null);
  if (!brainRef.current) brainRef.current = new PetBrain();

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
    const applyReaction = (payload:RoutineStep) => {
      setLook(null);
      const character = getCharacter(settingsRef.current?.selectedCharacterId ?? 'furina', charactersRef.current);
      const supportsGestures = character.id === 'furina' && character.source === 'built-in';
      changeReaction(supportsGestures && payload.motion ? payload.motion : payload.reaction, true);
      setMessage(payload.message ?? "");
      setBubbleEpoch((value) => value + 1);
    };
    const unsubscribe = actionPlayback.subscribe(applyReaction);
    const cleanups = Promise.all([
      listen<unknown>(ROUTINE_EVENT, (event) => {
        if(event.payload==='stop'){actionPlayback.stop();brainRef.current?.interrupt();return;}
        if(!settingsRef.current?.petVisible)return;
        const routine = routines.find(item => item.id === event.payload);
        if (routine && actionPlayback.canStart(ACTION_PRIORITY.user)) {
          brainRef.current?.observeUserInteraction(Date.now());
          void actionPlayback.play(routine.steps, ACTION_PRIORITY.user);
        }
      }),
      listen<AppSettings>("settings-changed", (event) => setSettings(event.payload)),
      listen<ReactionEvent>("pet-reaction", (event) => {
        if (!settingsRef.current?.petVisible) return;
        if (event.payload.manual && actionPlayback.canStart(ACTION_PRIORITY.user)) {
          brainRef.current?.observeUserInteraction(Date.now());
        }
        void actionPlayback.play([{ ...event.payload, durationMs: event.payload.durationMs ?? 2600 }],
          event.payload.manual ? ACTION_PRIORITY.user : ACTION_PRIORITY.background);
      }),
    ]);
    return () => {actionPlayback.stop();unsubscribe();void cleanups.then((items) => items.forEach((cleanup) => cleanup()));};
  }, []);

  useEffect(()=>{
    actionPlayback.stop();
    brainRef.current?.interrupt();
    actionPlayback.block('hidden', !settings?.petVisible);
    setMessage('');changeReaction('idle');
  },[settings?.petVisible,settings?.selectedCharacterId]);

  useEffect(() => {
    setSpriteCell(sampleMotion(reaction, 0));
    if (look) return;
    let stopped = false;
    let timer = 0;
    const started = performance.now();
    const scheduleNext = () => {
      if (stopped) return;
      const frame = sampleMotion(reaction, performance.now() - started);
      setSpriteCell(frame);
      if (frame.nextMs !== null) timer = window.setTimeout(scheduleNext, Math.max(1, frame.nextMs));
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
    const attention = new AttentionTracker();
    let lastLookAt = 0;
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
      const playbackEpoch = actionPlayback.epoch;
      const stale = () => cancelled || playbackEpoch !== actionPlayback.epoch
        || settingsRef.current !== currentSettings || motionRef.current.dragging || motionRef.current.falling;

      try {
        if (!currentSettings.petVisible || actionPlayback.active || motionRef.current.dragging || motionRef.current.falling) {
          attention.reset(now);
          lastLook = -1;
          resetWander();
          return;
        }

        const userReactionActive = actionPlayback.active;
        const isLocomotionState = !userReactionActive && (reactionRef.current === "idle"
          || isTravelMotion(reactionRef.current)
          || (wander.mode === "docked" && (reactionRef.current === "waiting" || reactionRef.current === "review")));
        let position = await petWindow.outerPosition();
        const size = await petWindow.outerSize();
        const activeCharacter = getCharacter(currentSettings.selectedCharacterId, charactersRef.current);
        const profile = activeCharacter.wanderProfile!;
        const workArea = await getWorkArea(position, size);
        if (stale()) return;
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
              if (stale()) return;
              if (!point || Math.hypot(point.x - position.x, point.y - position.y) > 140) {
                resetWander(wallClock + pauseDuration(profile));
                changeReaction("idle");
                if (currentSettings.gravityEnabled) {
                  void settleWithGravity();
                  return;
                }
              } else {
                await petWindow.setPosition(new PhysicalPosition(point.x, point.y));
                if (stale()) return;
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
                if (stale()) return;
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
              if (stale()) return;
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
              if (stale()) return;
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

              position = new PhysicalPosition(nextX, nextY);
              await petWindow.setPosition(position);
              if (stale()) return;
              setLook(null);
              changeReaction(locomotionReaction(dx, dy, groundedWander));
            }
          }
        } else {
          if (!userReactionActive) {
            const shouldFall = wander.mode === "docked" && currentSettings.gravityEnabled;
            resetWander();
            if (isTravelMotion(reactionRef.current)) {
              changeReaction("idle");
            }
            if (shouldFall) {
              void settleWithGravity();
              return;
            }
          }
        }

        if (wander.mode === "idle" && currentSettings.lookAtCursor && reactionRef.current === "idle" && now - lastLookAt >= 96) {
          lastLookAt = now;
          const cursor = await cursorPosition();
          if (stale()) return;
          const petHeight = CELL_HEIGHT * currentSettings.scale * window.devicePixelRatio;
          const origin = {
            x: position.x + size.width / 2,
            y: position.y + size.height - petHeight / 2,
          };
          const distance = Math.hypot(cursor.x - origin.x, cursor.y - origin.y);
          const target = distance > Math.max(size.width, size.height) * 0.55 && distance < 650 * window.devicePixelRatio
            ? computeLookDirection(origin, cursor).index : null;
          const index = attention.update(target, now);
          if ((index ?? -1) !== lastLook) {
            lastLook = index ?? -1;
            setLook(index === null ? null : lookCell(index));
          }
        } else if ((!currentSettings.lookAtCursor || wander.mode !== "idle" || reactionRef.current !== "idle") && lastLook !== -1) {
          lastLook = -1;
          attention.reset(now);
          setLook(null);
        }
      } catch {
        if (stale()) return;
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
      changeReaction("falling", true);
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
    if (event.button !== 0 || motionRef.current.dragging) return;
    actionPlayback.block('drag', true);
    const gestureEpoch = actionPlayback.epoch;
    let moved = false;
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
      const start = await getCurrentWindow().outerPosition();
      await getCurrentWindow().startDragging();
      await desktop.waitForDragRelease();
      const end = await getCurrentWindow().outerPosition();
      moved = isDragDisplacement(start, end, window.devicePixelRatio);
    } catch (error) {
      console.warn('[pet] drag did not complete', error);
    } finally {
      motionRef.current.dragging = false;
      try { if (moved) await settleWithGravity(); }
      finally { actionPlayback.block('drag', false); }
    }
    if (moved && settingsRef.current?.petVisible && gestureEpoch === actionPlayback.epoch) {
      void actionPlayback.play([
        { reaction: 'idle', durationMs: 180 },
        { reaction: 'jumping', durationMs: 840 },
        { reaction: 'idle', durationMs: 500 },
      ], ACTION_PRIORITY.user);
    }
  }

  if (!settings) return null;
  const activeCharacter = getCharacter(settings.selectedCharacterId, characters);
  const displayedLook = look
    ? mapLookDirection(look, activeCharacter.lookDirectionOrder)
    : null;
  const column = displayedLook ? displayedLook.column : spriteCell.column;
  const row = displayedLook ? displayedLook.row : spriteCell.row;
  const replacement = replacementFrame(activeCharacter.id, activeCharacter.source, row, column);
  const style = {
    backgroundPosition: `${-column * CELL_WIDTH}px ${-row * CELL_HEIGHT}px`,
    backgroundImage: replacement ? 'none' : `url("${activeCharacter.spriteSheetUrl}")`,
    transform: `scale(${settings.scale})`,
  } as React.CSSProperties;
  const stageStyle = { "--pet-height": `${CELL_HEIGHT * settings.scale}px` } as React.CSSProperties;

  return (
    <div
      className="pet-stage"
      style={stageStyle}
      onPointerDown={(event) => void beginDrag(event)}
      onContextMenu={(event) => { event.preventDefault(); void desktop.showControlCenter(); }}
    >
      {message && <div className="pet-bubble">{message}</div>}
      <div className="sprite" style={style} role="img" aria-label={`${activeCharacter.name}：${reaction}`}>
        {replacement && <div className="sprite-art" style={replacementStyle(replacement, motionAssets[replacement.asset])} />}
      </div>
    </div>
  );
}
