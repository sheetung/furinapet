import type { CursorObservation } from './cursor-observer';
import { awayFromCursor, DockPolicyMemory } from './dock-policy';
import { startGazeController } from './gaze';
import { type LookCell } from '../core/look-direction';
import { isTravelMotion, locomotionReaction, type MotionReaction } from '../core/sprite-motion';
import { advanceSpeed, exposedTopPlacement, nearestRestingEdge, chooseWanderTarget, nextDecisionDelay, pauseDuration,
  type DockEdge, type DockPlacement, type Point, type WanderBounds, type WindowSurface,
  type WorkArea, type PetSize, type WanderProfile } from '../core/wander-controller';
import type { AppSettings } from '../types';
import type { WanderDecisionInput } from '../pet-brain/adapters/wander';
import type { PetGoalId } from '../pet-brain/types';
import type { MotionAuthority } from './authority';

export interface WanderPort {
  position(): Promise<Point>;
  size(): Promise<PetSize>;
  workArea(position: Point, size: PetSize): Promise<WorkArea>;
  surfaces(): Promise<WindowSurface[]>;
  cursor(): Promise<Point>;
  move(point: Point, valid: () => boolean): Promise<unknown>;
}
export interface WanderRuntime {
  dockMemory?: DockPolicyMemory;
  authority: MotionAuthority;
  settings(): AppSettings | null;
  profile(): WanderProfile;
  reaction(): MotionReaction;
  playback: { readonly epoch: number; readonly active: boolean };
  layoutEpoch(): number;
  layoutBusy(): boolean;
  motion(): { dragging: boolean; falling: boolean };
  now(): number;
  wallNow(): number;
  pixelRatio(): number;
  schedule(callback: () => void, delay: number): () => void;
  observeCursor(observation: CursorObservation): void;
  needsRest(): boolean;
  dockSitting?(): boolean;
  plan(input: WanderDecisionInput): PetGoalId;
  changeReaction(reaction: MotionReaction, restart?: boolean): void;
  setLook(look: LookCell | null): void;
  settle(): Promise<void>;
}
const MOTION_INTERVAL_MS = 32;
const IDLE_INTERVAL_MS = 250;
const HIDDEN_INTERVAL_MS = 1000;
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

export function startWanderController(port: WanderPort, runtime: WanderRuntime) {
    const dockMemory = runtime.dockMemory ?? new DockPolicyMemory();
    const { changeReaction, setLook, playback: actionPlayback } = runtime;
    const wander: WanderState = {
      mode: "idle",
      target: null,
      nextAt: runtime.wallNow() + 6000,
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
    let cancelTick = () => {};
    const stopGaze = startGazeController(port, runtime);
    let lastTick = runtime.now();
    let lastAutonomousActionAt = runtime.wallNow();

    const resetWander = (nextAt = runtime.wallNow() + 1500) => {
      if (runtime.reaction() === 'dock-sitting') changeReaction('idle');
      dockMemory.setDock(null);
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

    const getWorkArea = async (position: Point, size: PetSize): Promise<WorkArea> => {
      const now = runtime.wallNow();
      if (wander.workArea && now < wander.workAreaRefreshAt) return wander.workArea;
      wander.workArea = await port.workArea(position, size);
      wander.workAreaRefreshAt = now + 1000;
      return wander.workArea;
    };

    const makeBounds = (workArea: WorkArea, size: PetSize): WanderBounds => {
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
      size: PetSize,
      workArea: WorkArea,
    ): Promise<DockPlacement | null> => {
      const index = surfaces.findIndex((candidate) => candidate.id === wander.dockSurfaceId);
      return index >= 0 && wander.dockEdge
        ? exposedTopPlacement(surfaces, index, size, workArea, wander.dockRatio)
        : null;
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const settings = runtime.settings();
      const blocked = runtime.layoutBusy() || runtime.motion().dragging || runtime.motion().falling || actionPlayback.active;
      const delay = !settings?.petVisible ? HIDDEN_INTERVAL_MS
        : blocked || !settings.autonomousBehavior ? IDLE_INTERVAL_MS
        : wander.mode === 'idle' ? Math.max(MOTION_INTERVAL_MS, Math.min(IDLE_INTERVAL_MS, wander.nextAt - runtime.wallNow()))
        : MOTION_INTERVAL_MS;
      cancelTick = runtime.schedule(() => void tick(), delay);
    };

    const tick = async () => {
      const currentSettings = runtime.settings();
      if (cancelled) return;
      if (!currentSettings) {
        lastTick = runtime.now();
        scheduleNext();
        return;
      }
      const now = runtime.now();
      const wallClock = runtime.wallNow();
      const elapsed = wander.mode === 'idle' ? MOTION_INTERVAL_MS : Math.min(64, now - lastTick);
      lastTick = now;
      // No native geometry reads while paused or waiting for a decision. Gravity
      // retries and cursor sensing have independent controllers.
      if (!currentSettings.petVisible || runtime.layoutBusy() || runtime.motion().dragging
        || runtime.motion().falling || actionPlayback.active) {
        // An animation must not shorten the decision deadline already chosen.
        resetWander(Math.max(wander.nextAt, wallClock + 1500));
        scheduleNext();
        return;
      }
      if (wander.mode === 'idle' && (!currentSettings.autonomousBehavior || wallClock < wander.nextAt)) {
        if (!currentSettings.autonomousBehavior) resetWander();
        scheduleNext();
        return;
      }
      const playbackEpoch = actionPlayback.epoch;
      const layoutEpoch = runtime.layoutEpoch();
      const lease = runtime.authority.acquire('wander');
      const stale = () => cancelled || playbackEpoch !== actionPlayback.epoch
        || !lease?.valid()
        || layoutEpoch !== runtime.layoutEpoch() || runtime.layoutBusy()
        || runtime.settings() !== currentSettings || runtime.motion().dragging || runtime.motion().falling;

      try {
        if (!lease || !currentSettings.petVisible || runtime.layoutBusy() || runtime.motion().dragging || runtime.motion().falling) {
          resetWander();
          return;
        }

        const userReactionActive = actionPlayback.active;
        const isLocomotionState = !userReactionActive && (runtime.reaction() === "idle"
          || isTravelMotion(runtime.reaction())
          || (wander.mode === "docked" && ['waiting', 'review', 'dock-sitting'].includes(runtime.reaction())));
        const geometry = await Promise.all([port.position(), port.size()]);
        if (stale()) return;
        let position = geometry[0];
        const size = geometry[1];
        // Sprite feet sit eight logical pixels above the bottom of the stage.
        const seated = runtime.dockSitting?.() ?? false;
        const seatOffset = seated ? 42 * currentSettings.scale * runtime.pixelRatio() : 0;
        size.feetInset = 8 * currentSettings.scale * runtime.pixelRatio()
          + (wander.mode === 'docked' ? seatOffset : 0);
        if (actionPlayback.active) {
          resetWander();
          return;
        }

        const profile = runtime.profile();
        const workArea = await getWorkArea(position, size);
        if (stale()) return;
        const bounds = makeBounds(workArea, size);
        // Restore the standing baseline only while this controller still owns motion.
        // Drag/actions invalidate the lease and must never receive a delayed correction.
        const leaveDock = async (nextAt: number) => {
          if (wander.mode === 'docked' && runtime.reaction() === 'dock-sitting') {
            const standing = { x: position.x, y: Math.max(workArea.y, position.y - seatOffset) };
            await port.move(standing, () => !stale());
            if (stale()) return false;
            position = standing;
          }
          resetWander(nextAt);
          changeReaction('idle');
          return true;
        };

        if (currentSettings.autonomousBehavior && isLocomotionState) {
          if ((!currentSettings.autonomousMovement && wander.mode === 'walking')
            || (!currentSettings.windowDocking && wander.mode === 'approaching')) {
            resetWander(wallClock);
            changeReaction('idle');
          }
          if (runtime.needsRest() && (wander.mode === 'walking' || wander.mode === 'approaching')) {
            resetWander(wallClock);
            changeReaction('idle');
          }
          if (wander.mode === "docked") {
            if (!currentSettings.windowDocking || wallClock >= wander.dockUntil) {
              if (!await leaveDock(wallClock + pauseDuration(profile))) return;
              if (currentSettings.gravityEnabled) {
                void runtime.settle();
                return;
              }
            } else if (wallClock >= wander.dockRefreshAt) {
              wander.dockRefreshAt = wallClock + 96;
              const point = await refreshDockTarget(await port.surfaces(), size, workArea);
              if (stale()) return;
              if (!point || Math.hypot(point.x - position.x, point.y - position.y) > 24 * runtime.pixelRatio()) {
                if (!await leaveDock(wallClock + pauseDuration(profile))) return;
                if (currentSettings.gravityEnabled) {
                  void runtime.settle();
                  return;
                }
              } else {
                await port.move(point, () => !stale());
                if (stale()) return;
                position = { x: point.x, y: point.y };
                wander.stalledTicks = 0;
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
            void runtime.settle();
            return;
          }

          if (wander.mode === "idle" && wallClock >= wander.nextAt) {
            wander.nextAt = wallClock + nextDecisionDelay(profile);
            const goal = runtime.plan({
              now: wallClock,
              autonomousMovement: currentSettings.autonomousMovement || currentSettings.windowDocking,
              canMove: isLocomotionState && !dockMemory.prefersPlacement(wallClock),
              canDock: currentSettings.windowDocking && !dockMemory.prefersPlacement(wallClock)
                && Math.abs(position.y - bounds.groundY) > 24 * runtime.pixelRatio(),
              userReactionActive,
              idleForMs: wallClock - lastAutonomousActionAt,
              wanderWeight: currentSettings.autonomousMovement ? currentSettings.wanderWeight : 0,
              dockWeight: currentSettings.dockWeight,
              missedOpportunities: wander.missedOpportunities,
              profile,
            });
            if (stale()) return;

            if (!dockMemory.prefersPlacement(wallClock) && ((goal === "wander" && currentSettings.autonomousMovement)
              || (goal === "dock" && currentSettings.windowDocking
                && Math.abs(position.y - bounds.groundY) > 24 * runtime.pixelRatio()))) {
              wander.missedOpportunities = 0;
              if (goal === "dock" && currentSettings.windowDocking) {
                const cursor = await port.cursor();
                if (stale()) return;
                const candidate = nearestRestingEdge(await port.surfaces(), size, workArea,
                  position, 360 * runtime.pixelRatio(), Math.random, {
                    allowWindow: surface => dockMemory.allowWindow(surface, wallClock),
                    allowPlacement: point => awayFromCursor(point, size, cursor, 180 * runtime.pixelRatio()),
                  });
                if (stale()) return;
                if (candidate) {
                  dockMemory.setDock(candidate.surface.id);
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
              if (goal === 'wander' && wander.mode === "idle" && currentSettings.autonomousMovement) {
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
              const point = await refreshDockTarget(await port.surfaces(), size, workArea);
              if (stale()) return;
              const cursor = await port.cursor();
              if (stale()) return;
              if (point && awayFromCursor(point, size, cursor, 180 * runtime.pixelRatio())
                && Math.hypot(point.x - wander.target.x, point.y - wander.target.y) <= 48 * runtime.pixelRatio()) wander.target = point;
              else {
                resetWander(wallClock + pauseDuration(profile));
                changeReaction('idle');
              }
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
              void runtime.settle();
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
              let destination = { x: wander.target.x, y: groundedWander ? bounds.groundY : wander.target.y };
              if (wander.mode === 'approaching') {
                // Validate the actual seated footprint before entering it (screen bottom,
                // occlusion and a closed/moved window can all invalidate the arrival).
                const seatSize = { ...size, feetInset: (size.feetInset ?? 0) + seatOffset };
                const point = await refreshDockTarget(await port.surfaces(), seatSize, workArea);
                if (stale()) return;
                if (!point || Math.hypot(point.x - destination.x, point.y - seatOffset - destination.y) > 24 * runtime.pixelRatio()) {
                  resetWander(wallClock + pauseDuration(profile));
                  changeReaction('idle');
                  return;
                }
                destination = point;
              }
              await port.move(destination, () => !stale());
              if (stale()) return;
              if (wander.mode === "approaching") {
                wander.mode = "docked";
                wander.target = null;
                wander.speed = 0;
                wander.dockUntil = wallClock + 12000;
                wander.dockRefreshAt = 0;
                wander.lastPosition = null;
                wander.stalledTicks = 0;
                setLook(null);
                changeReaction(seated ? 'dock-sitting' : 'waiting', true);
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

              position = { x: nextX, y: nextY };
              await port.move(position, () => !stale());
              if (stale()) return;
              setLook(null);
              changeReaction(locomotionReaction(dx, dy, groundedWander));
            }
          }
        } else {
          if (!userReactionActive) {
            const shouldFall = wander.mode === "docked" && currentSettings.gravityEnabled;
            const wasDocked = wander.mode === "docked";
            if (wasDocked) {
              if (!await leaveDock(wallClock + 1500)) return;
            } else resetWander();
            if (wasDocked || isTravelMotion(runtime.reaction())) {
              changeReaction("idle");
            }
            if (shouldFall) {
              void runtime.settle();
              return;
            }
          }
        }


      } catch {
        if (stale()) return;
        if (wander.mode === "walking" || wander.mode === "approaching" || wander.mode === 'docked') {
          wander.stalledTicks += 1;
          if (wander.stalledTicks >= MAX_STALLED_TICKS) {
            resetWander(runtime.wallNow() + 450);
            changeReaction("idle");
          }
        }
      } finally {
        lease?.release();
        scheduleNext();
      }
    };

    void tick();
    return () => {
      cancelled = true;
      cancelTick();
      stopGaze();
    };
}
