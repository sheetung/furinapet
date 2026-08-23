import { desktop } from "../api";

/**
 * Thin pet-window sensor bridge, intentionally mirroring OpenPets' preload
 * model: the renderer only reports curated interaction events; the backend
 * plugin host owns plugin state and side effects.
 */
export function installPetDomBridge(): () => void {
  let singleClickTimer = 0;
  let pointerStart: { x: number; y: number } | null = null;
  let suppressClickUntil = 0;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointerStart = { x: event.screenX, y: event.screenY };
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!pointerStart) return;
    if (Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y) > 4) {
      suppressClickUntil = Date.now() + 300;
    }
    pointerStart = null;
  };

  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || Date.now() < suppressClickUntil) return;
    window.clearTimeout(singleClickTimer);
    singleClickTimer = window.setTimeout(() => {
      void desktop.publishPetEvent("pet:clicked").catch((error) => {
        console.error("[plugin-host] pet click dispatch failed", error);
      });
    }, 220);
  };

  const onDoubleClick = () => {
    // PetView already has a built-in double-click fallback. Its `waving`
    // request is now intercepted by the Rust plugin host, so cancel the
    // pending single-click without creating a second double-click dispatch.
    window.clearTimeout(singleClickTimer);
  };

  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("dblclick", onDoubleClick, true);

  return () => {
    window.clearTimeout(singleClickTimer);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("dblclick", onDoubleClick, true);
  };
}
