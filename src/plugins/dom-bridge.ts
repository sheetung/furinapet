import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { desktop } from "../api";
import type { PetSenseEventDetail, PetSenseName } from "../pet-brain";

const TAP_MOVE_THRESHOLD = 8;
const DOUBLE_TAP_WINDOW_MS = 360;
export const PET_SENSE_EVENT = "furinapet:pet-sense";

function emitSense(name: PetSenseName, handledByPlugin: boolean) {
  const detail: PetSenseEventDetail = {
    name,
    at: Date.now(),
    handledByPlugin,
  };
  window.dispatchEvent(new CustomEvent<PetSenseEventDetail>(PET_SENSE_EVENT, { detail }));
}

/**
 * Pet-window sensor bridge.
 *
 * Native dragging can consume WebView pointerup/click events on Windows, so
 * physical tap classification lives here. The bridge reports every classified
 * sense to Pet Brain after plugin arbitration. Plugins may still consume the
 * event, while unhandled senses are free for the autonomous core to respond to.
 */
export function installPetDomBridge(): () => void {
  let disposed = false;
  let gestureToken = 0;
  let singleTapTimer = 0;
  let lastTapAt = 0;
  let lastDoubleDispatchAt = 0;

  const dispatch = async (name: "pet:clicked" | "pet:doubleClicked") => {
    try {
      const handled = await desktop.publishPetEvent(name);
      emitSense(name, handled);
    } catch (error) {
      console.error(`[plugin-host] ${name} dispatch failed`, error);
      emitSense(name, false);
    }
  };

  const dispatchDoubleTap = () => {
    const now = Date.now();
    if (now - lastDoubleDispatchAt < 450) return;
    lastDoubleDispatchAt = now;
    window.clearTimeout(singleTapTimer);
    lastTapAt = 0;
    void dispatch("pet:doubleClicked");
  };

  const registerTap = () => {
    const now = Date.now();
    if (lastTapAt > 0 && now - lastTapAt <= DOUBLE_TAP_WINDOW_MS) {
      dispatchDoubleTap();
      return;
    }

    lastTapAt = now;
    window.clearTimeout(singleTapTimer);
    singleTapTimer = window.setTimeout(() => {
      lastTapAt = 0;
      void dispatch("pet:clicked");
    }, DOUBLE_TAP_WINDOW_MS);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (disposed || event.button !== 0) return;

    const token = ++gestureToken;
    const scale = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
    const startPointer = {
      x: event.screenX * scale,
      y: event.screenY * scale,
    };
    const petWindow = getCurrentWindow();

    void (async () => {
      let startWindow: { x: number; y: number } | null = null;
      try {
        const position = await petWindow.outerPosition();
        startWindow = { x: position.x, y: position.y };
      } catch {
        // Pointer displacement alone can still classify the gesture.
      }

      try {
        await desktop.waitForDragRelease();
      } catch (error) {
        console.error("[plugin-host] wait for pet release failed", error);
        return;
      }

      if (disposed || token !== gestureToken) return;

      let pointerDistance: number | null = null;
      let windowDistance: number | null = null;

      try {
        const endPointer = await cursorPosition();
        pointerDistance = Math.hypot(
          endPointer.x - startPointer.x,
          endPointer.y - startPointer.y,
        );
      } catch {
        // Fall back to window displacement below.
      }

      if (startWindow) {
        try {
          const endWindow = await petWindow.outerPosition();
          windowDistance = Math.hypot(
            endWindow.x - startWindow.x,
            endWindow.y - startWindow.y,
          );
        } catch {
          // Ignore a hidden/closing pet window.
        }
      }

      const distances = [pointerDistance, windowDistance]
        .filter((value): value is number => value !== null && Number.isFinite(value));
      if (distances.length === 0) return;

      const moved = pointerDistance ?? windowDistance ?? Number.POSITIVE_INFINITY;
      if (moved <= TAP_MOVE_THRESHOLD) registerTap();
    })();
  };

  const onNativeDoubleClick = (event: MouseEvent) => {
    if (disposed || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    dispatchDoubleTap();
  };

  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("dblclick", onNativeDoubleClick, true);

  return () => {
    disposed = true;
    gestureToken += 1;
    window.clearTimeout(singleTapTimer);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("dblclick", onNativeDoubleClick, true);
  };
}
