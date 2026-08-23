import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { desktop } from "../api";

const TAP_MOVE_THRESHOLD = 6;
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
    const startPointer = { x: event.screenX, y: event.screenY };
    const petWindow = getCurrentWindow();

    void (async () => {
      let startWindow: { x: number; y: number } | null = null;
      try {
        const position = await petWindow.outerPosition();
        startWindow = { x: position.x, y: position.y };
      } catch {
        // Pointer displacement alone is still enough to classify the gesture.
      }

      try {
        await desktop.waitForDragRelease();
      } catch (error) {
        console.error("[plugin-host] wait for pet release failed", error);
        return;
      }

      if (disposed || token !== gestureToken) return;

      let pointerDistance = Number.POSITIVE_INFINITY;
      let windowDistance = 0;

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

      const moved = Math.max(pointerDistance, windowDistance);
      if (Number.isFinite(moved) && moved <= TAP_MOVE_THRESHOLD) {
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
