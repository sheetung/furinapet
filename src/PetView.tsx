import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { cursorPosition, currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { desktop } from "./api";
import { computeLookDirection, type LookCell } from "./core/look-direction";
import type { AppSettings, Reaction, ReactionEvent } from "./types";
import "./pet.css";

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const GROUND_CLEARANCE = 72;
const MOTION_INTERVAL_MS = 32;
const GRAVITY_ACCELERATION = 2200;
const MAX_FALL_SPEED = 1250;

type MotionReaction = Reaction | "run-left" | "run-right";

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
  target: { x: number; y: number } | null;
  nextAt: number;
}

interface MotionState {
  dragging: boolean;
  falling: boolean;
  fallToken: number;
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export function PetView() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [reaction, setReaction] = useState<MotionReaction>("idle");
  const [animationEpoch, setAnimationEpoch] = useState(0);
  const [spriteFrame, setSpriteFrame] = useState(0);
  const [look, setLook] = useState<LookCell | null>(null);
  const [message, setMessage] = useState("");
  const reactionTimer = useRef<number | null>(null);
  const reactionRef = useRef<MotionReaction>(reaction);
  const settingsRef = useRef(settings);
  const motionRef = useRef<MotionState>({ dragging: false, falling: false, fallToken: 0 });

  useEffect(() => { reactionRef.current = reaction; }, [reaction]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

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
        reactionTimer.current = window.setTimeout(() => {
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
    if (settings?.reducedMotion && reaction === "idle") return;

    const spec = frameRows[reaction];
    const speedFactor = settings?.reducedMotion ? 1.55 : 1;
    let stopped = false;
    let timer = 0;
    let frame = 0;

    const scheduleNext = () => {
      timer = window.setTimeout(() => {
        if (stopped) return;
        frame = (frame + 1) % spec.durations.length;
        setSpriteFrame(frame);
        scheduleNext();
      }, spec.durations[frame] * speedFactor);
    };
    scheduleNext();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [reaction, animationEpoch, look?.index, settings?.reducedMotion]);

  useEffect(() => {
    const petWindow = getCurrentWindow();
    const wander: WanderState = { target: null, nextAt: Date.now() + 6000 };
    let cancelled = false;
    let timer = 0;
    let lastLook = -1;
    let lastLookAt = 0;
    let lastTick = performance.now();

    const tick = async () => {
      const currentSettings = settingsRef.current;
      if (cancelled) return;
      if (!currentSettings) {
        timer = window.setTimeout(() => void tick(), MOTION_INTERVAL_MS);
        return;
      }
      const now = performance.now();
      const elapsed = Math.min(64, now - lastTick);
      lastTick = now;

      try {
        if (motionRef.current.dragging || motionRef.current.falling) {
          wander.target = null;
          return;
        }

        const isLocomotionState = reactionRef.current === "idle"
          || reactionRef.current === "run-left"
          || reactionRef.current === "run-right";
        let position = await petWindow.outerPosition();
        const size = await petWindow.outerSize();

        if (currentSettings.autoWander && !currentSettings.reducedMotion && isLocomotionState) {
          if (!wander.target && Date.now() >= wander.nextAt) {
            const monitor = await currentMonitor();
            if (monitor) {
              const padding = 24;
              const minX = monitor.position.x + padding;
              const maxX = monitor.position.x + monitor.size.width - size.width - padding;
              const groundY = monitor.position.y + monitor.size.height - size.height - GROUND_CLEARANCE;
              wander.target = {
                x: Math.round(minX + Math.random() * Math.max(1, maxX - minX)),
                y: currentSettings.gravityEnabled ? groundY : position.y,
              };
            }
          }

          if (wander.target) {
            const dx = wander.target.x - position.x;
            const dy = wander.target.y - position.y;
            const distance = Math.hypot(dx, dy);
            if (distance < 2.5) {
              await petWindow.setPosition(new PhysicalPosition(wander.target.x, wander.target.y));
              wander.target = null;
              wander.nextAt = Date.now() + 7000 + Math.random() * 9000;
              changeReaction("idle");
            } else {
              const step = Math.min(distance, elapsed * 0.11 * currentSettings.wanderSpeed);
              position = new PhysicalPosition(
                Math.round(position.x + dx / distance * step),
                Math.round(position.y + dy / distance * step),
              );
              await petWindow.setPosition(position);
              setLook(null);
              changeReaction(dx >= 0 ? "run-right" : "run-left");
            }
          }
        } else {
          wander.target = null;
          if (reactionRef.current === "run-left" || reactionRef.current === "run-right") changeReaction("idle");
        }

        if (!wander.target && currentSettings.lookAtCursor && reactionRef.current === "idle" && now - lastLookAt >= 96) {
          lastLookAt = now;
          const cursor = await cursorPosition();
          const origin = { x: position.x + size.width / 2, y: position.y + size.height / 2 };
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
        } else if ((wander.target || reactionRef.current !== "idle") && lastLook !== -1) {
          lastLook = -1;
          setLook(null);
        }
      } catch {
        // A hidden or closing window is retried by the next non-overlapping tick.
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
      const [position, size, monitor] = await Promise.all([
        petWindow.outerPosition(),
        petWindow.outerSize(),
        currentMonitor(),
      ]);
      if (!monitor) return;

      const groundY = monitor.position.y + monitor.size.height - size.height - GROUND_CLEARANCE;
      if (currentSettings.reducedMotion || position.y >= groundY - 1) {
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
    if (reactionTimer.current) window.clearTimeout(reactionTimer.current);
    motionRef.current.fallToken += 1;
    motionRef.current.falling = false;
    motionRef.current.dragging = true;
    setMessage("");
    setLook(null);
    changeReaction("idle");
    try {
      await getCurrentWindow().startDragging();
    } finally {
      motionRef.current.dragging = false;
      await settleWithGravity();
    }
  }

  if (!settings) return null;
  const state = frameRows[reaction];
  const column = look ? look.column : Math.min(spriteFrame, state.durations.length - 1);
  const row = look ? look.row : state.row;
  const style = {
    backgroundPosition: `${-column * CELL_WIDTH}px ${-row * CELL_HEIGHT}px`,
    transform: `scale(${settings.scale})`,
  } as React.CSSProperties;

  return (
    <div
      className="pet-stage"
      onPointerDown={(event) => void beginDrag(event)}
      onDoubleClick={() => void desktop.react("waving", "哼哼，是在叫我吗？")}
      onContextMenu={(event) => { event.preventDefault(); void desktop.showControlCenter(); }}
    >
      {message && <div className="pet-bubble">{message}</div>}
      <div className="sprite" style={style} role="img" aria-label={`芙宁娜：${reaction}`} />
    </div>
  );
}
