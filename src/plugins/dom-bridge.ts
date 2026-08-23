import { pluginEventBus } from "./event-bus";
import { pluginManager } from "./manager";

export function installPetDomBridge(): () => void {
  let singleClickTimer = 0;

  const clickEnhancementEnabled = () =>
    pluginManager.states().some((state) => state.id === "click-reaction" && state.enabled);

  const onClick = (event: MouseEvent) => {
    window.clearTimeout(singleClickTimer);
    singleClickTimer = window.setTimeout(() => {
      pluginEventBus.emit("pet:clicked", { x: event.screenX, y: event.screenY });
    }, 220);
  };

  const onDoubleClick = (event: MouseEvent) => {
    window.clearTimeout(singleClickTimer);
    if (clickEnhancementEnabled()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    pluginEventBus.emit("pet:double-clicked", { x: event.screenX, y: event.screenY });
  };

  const onPointerDown = () => pluginEventBus.emit("pet:drag-start");
  const onPointerUp = () => pluginEventBus.emit("pet:drag-end");

  window.addEventListener("click", onClick);
  window.addEventListener("dblclick", onDoubleClick, true);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);

  return () => {
    window.clearTimeout(singleClickTimer);
    window.removeEventListener("click", onClick);
    window.removeEventListener("dblclick", onDoubleClick, true);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
  };
}
