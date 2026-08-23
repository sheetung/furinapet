import { emitTo, listen } from "@tauri-apps/api/event";

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
  let receivedSnapshot = false;

  const sendInteraction = (type: "clicked" | "double-clicked", event: MouseEvent) => {
    void emitTo("main", "plugin-pet-interaction", {
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
      receivedSnapshot = true;
      clickEnhancementEnabled = event.payload.enabled.includes("click-reaction");
    }),
  ]);

  let attempts = 0;
  const requestState = () => {
    attempts += 1;
    void emitTo("main", "plugin-state-request");
    if (!receivedSnapshot && attempts < 8) {
      window.setTimeout(requestState, 500);
    }
  };

  void listeners.then(requestState);

  return () => {
    window.clearTimeout(singleClickTimer);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("dblclick", onDoubleClick, true);
    void listeners.then((unlisteners) => unlisteners.forEach((unlisten) => unlisten()));
  };
}
