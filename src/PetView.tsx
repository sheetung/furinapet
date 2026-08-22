import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { cursorPosition, currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { desktop } from "./api";
import { computeLookDirection, type LookCell } from "./core/look-direction";
import type { AppSettings, Reaction, ReactionEvent } from "./types";
import "./pet.css";

const frameRows: Record<Reaction | "run-left" | "run-right", { row: number; frames: number; duration: number }> = {
  idle: { row: 0, frames: 6, duration: 5500 },
  "run-right": { row: 1, frames: 8, duration: 1060 },
  "run-left": { row: 2, frames: 8, duration: 1060 },
  waving: { row: 3, frames: 8, duration: 1200 },
  jumping: { row: 4, frames: 8, duration: 1060 },
  failed: { row: 5, frames: 8, duration: 1450 },
  waiting: { row: 6, frames: 8, duration: 1500 },
  running: { row: 7, frames: 8, duration: 1050 },
  review: { row: 8, frames: 8, duration: 1300 },
};

interface WanderState { target: { x: number; y: number } | null; nextAt: number }

export function PetView() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [reaction, setReaction] = useState<Reaction | "run-left" | "run-right">("idle");
  const [look, setLook] = useState<LookCell | null>(null);
  const [message, setMessage] = useState("");
  const reactionTimer = useRef<number | null>(null);
  const reactionRef = useRef(reaction);
  const settingsRef = useRef(settings);

  useEffect(() => { reactionRef.current = reaction; }, [reaction]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void desktop.getSettings().then(setSettings);
    const cleanups = Promise.all([
      listen<AppSettings>("settings-changed", (event) => setSettings(event.payload)),
      listen<ReactionEvent>("pet-reaction", (event) => {
        const payload = event.payload;
        if (reactionTimer.current) window.clearTimeout(reactionTimer.current);
        setLook(null);
        setReaction(payload.reaction);
        setMessage(payload.message ?? "");
        reactionTimer.current = window.setTimeout(() => {
          setReaction("idle");
          setMessage("");
        }, payload.durationMs ?? 2600);
      }),
    ]);
    return () => { void cleanups.then((items) => items.forEach((cleanup) => cleanup())); };
  }, []);

  useEffect(() => {
    const petWindow = getCurrentWindow();
    const wander: WanderState = { target: null, nextAt: Date.now() + 6000 };
    let cancelled = false;
    let lastLook = -1;
    let lastTick = performance.now();

    const tick = async () => {
      const currentSettings = settingsRef.current;
      if (cancelled || !currentSettings) return;
      const now = performance.now();
      const elapsed = Math.min(100, now - lastTick);
      lastTick = now;
      try {
        const [position, size, monitor] = await Promise.all([
          petWindow.outerPosition(), petWindow.outerSize(), currentMonitor(),
        ]);
        if (!monitor) return;
        const isIdle = reactionRef.current === "idle" || reactionRef.current === "run-left" || reactionRef.current === "run-right";

        if (currentSettings.autoWander && !currentSettings.reducedMotion && isIdle) {
          if (!wander.target && Date.now() >= wander.nextAt) {
            const padding = 24;
            const maxX = monitor.position.x + monitor.size.width - size.width - padding;
            const maxY = monitor.position.y + monitor.size.height - size.height - 72;
            wander.target = {
              x: Math.round(monitor.position.x + padding + Math.random() * Math.max(1, maxX - monitor.position.x - padding)),
              y: Math.round(monitor.position.y + Math.max(40, (maxY - monitor.position.y) * 0.62) + Math.random() * Math.max(1, (maxY - monitor.position.y) * 0.38)),
            };
          }
          if (wander.target) {
            const dx = wander.target.x - position.x;
            const dy = wander.target.y - position.y;
            const distance = Math.hypot(dx, dy);
            if (distance < 6) {
              wander.target = null;
              wander.nextAt = Date.now() + 7000 + Math.random() * 9000;
              setReaction("idle");
            } else {
              const step = Math.min(distance, elapsed * 0.075 * currentSettings.wanderSpeed);
              await petWindow.setPosition(new PhysicalPosition(
                Math.round(position.x + dx / distance * step),
                Math.round(position.y + dy / distance * step),
              ));
              setLook(null);
              setReaction(dx >= 0 ? "run-right" : "run-left");
            }
          }
        } else {
          wander.target = null;
          if (reactionRef.current === "run-left" || reactionRef.current === "run-right") setReaction("idle");
        }

        if (!wander.target && currentSettings.lookAtCursor && reactionRef.current === "idle") {
          const cursor = await cursorPosition();
          const origin = { x: position.x + size.width / 2, y: position.y + size.height / 2 };
          if (Math.hypot(cursor.x - origin.x, cursor.y - origin.y) > Math.max(size.width, size.height) * 0.55) {
            const cell = computeLookDirection(origin, cursor);
            if (cell.index !== lastLook) { lastLook = cell.index; setLook(cell); }
          } else if (lastLook !== -1) {
            lastLook = -1;
            setLook(null);
          }
        } else if (lastLook !== -1) {
          lastLook = -1;
          setLook(null);
        }
      } catch {
        // Window may be hidden while a tick is in flight; the next tick retries.
      }
    };
    const interval = window.setInterval(() => void tick(), 80);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  if (!settings) return null;
  const state = frameRows[reaction];
  const style = look
    ? { backgroundPosition: `${-look.column * 192}px ${-look.row * 208}px`, transform: `scale(${settings.scale})` }
    : {
        transform: `scale(${settings.scale})`,
        "--row-y": `${-state.row * 208}px`,
        "--travel-x": `${-state.frames * 192}px`,
        "--frames": state.frames,
        "--duration": `${settings.reducedMotion ? Math.max(state.duration, 2200) : state.duration}ms`,
      } as React.CSSProperties;

  return (
    <div
      className="pet-stage"
      onPointerDown={(event) => { if (event.button === 0) void getCurrentWindow().startDragging(); }}
      onDoubleClick={() => void desktop.react("waving", "哼哼，是在叫我吗？")}
      onContextMenu={(event) => { event.preventDefault(); void desktop.showControlCenter(); }}
    >
      {message && <div className="pet-bubble">{message}</div>}
      <div className={`sprite ${look ? "looking" : "animating"}`} style={style} role="img" aria-label={`芙宁娜：${reaction}`} />
    </div>
  );
}
