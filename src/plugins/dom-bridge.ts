import { pluginEventBus } from "./event-bus";

export function installPetDomBridge(): () => void {
  const onDoubleClick = (event: MouseEvent) => {
    pluginEventBus.emit("pet:double-clicked", { x: event.screenX, y: event.screenY });
  };
  const onPointerDown = () => pluginEventBus.emit("pet:drag-start");
  const onPointerUp = () => pluginEventBus.emit("pet:drag-end");

  window.addEventListener("dblclick", onDoubleClick);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);

  return () => {
    window.removeEventListener("dblclick", onDoubleClick);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
  };
}
