import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { desktop } from "../api";

const TAP_MOVE_THRESHOLD = 8;
const DOUBLE_TAP_WINDOW_MS = 360;

/**
 * Pet-window sensor bridge.
 *
 * PetView starts a native OS window drag immediately on pointerdown. On Windows
 * that native drag loop can consume pointerup/click/dblclick before WebView2
 * sees them. Therefore tap detection must not depend on DOM click events.
 *
 * We record the pointer/window position on pointerdown, wait for the physical
 * left mouse button to be released through the Rust command, then classify the
 * gesture as a tap or a real drag. This mirrors OpenPets' separation between
 * pet senses and movement while still keeping FurinaPet's native Tauri drag.
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
      // Preserve the original built-in double-click behaviour when no plugin
      // consumes the event. The plugin host consumes this when click-reaction
      // is enabled, so the system reaction and plugin reaction never compete.
      if (name === "pet:doubleClicked" && !handled) {
        await desktop.react("waving", "你好呀！");
      }
    } catch (error) {
      console.error(`[plugin-host] ${name} dispatch failed`, error);
    }
  };

  const dispatchDoubleTap = () => {
    const now = Date.now();
    // A native dblclick may occasionally survive the OS drag loop. Deduplicate
    // it against the manual two-tap recognizer below.
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
    // MouseEvent screen coordinates are CSS/logical pixels in WebView2 while
    // Tauri cursorPosition() returns physical pixels.
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

      // Prefer the pointer measurement. Window displacement is only a fallback:
      // gravity may move a floating pet immediately after mouse release.
      const moved = pointerDistance ?? windowDistance ?? Number.POSITIVE_INFINITY;
      if (moved <= TAP_MOVE_THRESHOLD) {
        registerTap();
      }
    })();
  };

  const onNativeDoubleClick = (event: MouseEvent) => {
    if (disposed || event.button !== 0) return;
    // If WebView2 does produce dblclick, suppress PetView's built-in handler;
    // this bridge performs host arbitration and the fallback itself.
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
