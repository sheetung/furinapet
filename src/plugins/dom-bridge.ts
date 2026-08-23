import { emit, listen } from "@tauri-apps/api/event";

interface PluginChangedEvent {
  id: string;
  enabled: boolean;
}

interface PluginStateSnapshot {
  enabled: string[];
}

export function installPetDomBridge(): () => void {
  let singleClickTimer = 0;
  let clickEnhancementEnabled = false;

  const sendInteraction = (type: "clicked" | "double-clicked", event: MouseEvent) => {
    void emit("plugin-pet-interaction", {
      type,
      x: event.screenX,
      y: event.screenY,
    });
  };

  const onClick = (event: MouseEvent) => {
    if (!clickEnhancementEnabled) return;
    window.clearTimeout(singleClickTimer);
    singleClickTimer = window.setTimeout(() => {
      sendInteraction("clicked", event);
    }, 220);
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (!clickEnhancementEnabled) return;
    window.clearTimeout(singleClickTimer);
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    sendInteraction("double-clicked", event);
  };

  window.addEventListener("click", onClick, true);
  window.addEventListener("dblclick", onDoubleClick, true);

  const listeners = Promise.all([
    listen<PluginChangedEvent>("plugin-state-changed", (event) => {
      if (event.payload.id === "click-reaction") {
        clickEnhancementEnabled = event.payload.enabled;
      }
    }),
    listen<PluginStateSnapshot>("plugin-state-snapshot", (event) => {
      clickEnhancementEnabled = event.payload.enabled.includes("click-reaction");
    }),
  ]);

  void listeners.then(() => emit("plugin-state-request"));

  return () => {
    window.clearTimeout(singleClickTimer);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("dblclick", onDoubleClick, true);
    void listeners.then((unlisteners) => unlisteners.forEach((unlisten) => unlisten()));
  };
}
