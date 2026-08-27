import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { desktop } from "../api";
import type { BodyRegion } from "../neuro/contracts";
import { regionAtPointer } from "../neuro/perception/perception-reducer";
import type { PetSenseEventDetail, PetSenseName } from "../pet-brain";

const TAP_MOVE_THRESHOLD = 8;
const DOUBLE_TAP_WINDOW_MS = 360;
export const PET_SENSE_EVENT = "furinapet:pet-sense";

function pointerScale(): number {
  return Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
}

/**
 * Resolve the body region for a tap from its physical screen position.
 *
 * Region is resolved at pointerdown time, when the pointer is guaranteed to
 * be on the pet. By the time the classified tap is dispatched (360 ms double-
 * tap window later) the pointer may already have moved away, so the sampler's
 * `targetRegion` would be stale — usually "none" — and region-dependent
 * reflexes (blink on face/head) would never fire.
 */
async function regionForPointer(pointer: { x: number; y: number }): Promise<BodyRegion | undefined> {
  try {
    const petWindow = getCurrentWindow();
    const [position, size] = await Promise.all([petWindow.outerPosition(), petWindow.outerSize()]);
    return regionAtPointer(pointer, {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    });
  } catch {
    // Window hidden or closing; the sense is still reported without a region.
    return undefined;
  }
}

function emitSense(name: PetSenseName, handledByPlugin: boolean, region?: BodyRegion) {
  const detail: PetSenseEventDetail = {
    name,
    at: Date.now(),
    handledByPlugin,
  };
  if (region !== undefined) detail.region = region;
  window.dispatchEvent(new CustomEvent<PetSenseEventDetail>(PET_SENSE_EVENT, { detail }));
}

/**
 * Dispatch a drag-lifecycle sense through plugin arbitration and Pet Brain.
 * Used by PetView around native window dragging; tap classification above
 * only covers click/double-click.
 */
export function dispatchPetSense(name: "pet:dragStart" | "pet:dragEnd") {
  void (async () => {
    let handled = false;
    try {
      handled = await desktop.publishPetEvent(name);
    } catch {
      // Plugin host unavailable; the sense is still reported locally.
    }
    emitSense(name, handled);
  })();
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

  const dispatch = async (name: "pet:clicked" | "pet:doubleClicked", region?: BodyRegion) => {
    try {
      const handled = await desktop.publishPetEvent(name);
      emitSense(name, handled, region);
    } catch (error) {
      console.error(`[plugin-host] ${name} dispatch failed`, error);
      emitSense(name, false, region);
    }
  };

  const dispatchDoubleTap = (region?: BodyRegion) => {
    const now = Date.now();
    if (now - lastDoubleDispatchAt < 450) return;
    lastDoubleDispatchAt = now;
    window.clearTimeout(singleTapTimer);
    lastTapAt = 0;
    void dispatch("pet:doubleClicked", region);
  };

  const registerTap = (region?: BodyRegion) => {
    const now = Date.now();
    if (lastTapAt > 0 && now - lastTapAt <= DOUBLE_TAP_WINDOW_MS) {
      dispatchDoubleTap(region);
      return;
    }

    lastTapAt = now;
    window.clearTimeout(singleTapTimer);
    singleTapTimer = window.setTimeout(() => {
      lastTapAt = 0;
      void dispatch("pet:clicked", region);
    }, DOUBLE_TAP_WINDOW_MS);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (disposed || event.button !== 0) return;

    const token = ++gestureToken;
    const scale = pointerScale();
    const startPointer = {
      x: event.screenX * scale,
      y: event.screenY * scale,
    };
    const petWindow = getCurrentWindow();

    void (async () => {
      const tapRegion = await regionForPointer(startPointer);
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
      if (moved <= TAP_MOVE_THRESHOLD) registerTap(tapRegion);
    })();
  };

  const onNativeDoubleClick = (event: MouseEvent) => {
    if (disposed || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const scale = pointerScale();
    void regionForPointer({ x: event.screenX * scale, y: event.screenY * scale }).then(
      (region) => dispatchDoubleTap(region),
    );
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
