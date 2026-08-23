import { pluginEventBus } from "./event-bus";

export function installPetDomBridge(): () => void {
  let singleClickTimer = 0;

  const onClick = (event: MouseEvent) => {
    window.clearTimeout(singleClickTimer);
    singleClickTimer = window.setTimeout(() => {
      pluginEventBus.emit("pet:clicked", { x: event.screenX, y: event.screenY });
    }, 220);
  };

  const onDoubleClick = (event: MouseEvent) => {
    window.clearTimeout(singleClickTimer);
    pluginEventBus.emit("pet:double-clicked", { x: event.screenX, y: event.screenY });
  };

  const onPointerDown = () => pluginEventBus.emit("pet:drag-start");
  const onPointerUp = () => pluginEventBus.emit("pet:drag-end");

  window.addEventListener("click", onClick);
  window.addEventListener("dblclick", onDoubleClick);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);

  return () => {
    window.clearTimeout(singleClickTimer);
    window.removeEventListener("click", onClick);
    window.removeEventListener("dblclick", onDoubleClick);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
  };
}
