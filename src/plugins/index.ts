import { emitTo, listen } from "@tauri-apps/api/event";
import { pluginEventBus } from "./event-bus";
import { pluginManager } from "./manager";
import { registerBuiltinPlugins } from "./registry";

interface PluginPetInteraction {
  type: "clicked" | "double-clicked";
  x?: number;
  y?: number;
}

let bootstrapped = false;

function enabledPluginIds(): string[] {
  return pluginManager.states()
    .filter((state) => state.enabled)
    .map((state) => state.id);
}

export async function bootstrapPlugins(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  registerBuiltinPlugins();
  await pluginManager.activateEnabled();

  if ("__TAURI_INTERNALS__" in window) {
    void listen<PluginPetInteraction>("plugin-pet-interaction", (event) => {
      const payload = event.payload;
      if (payload.type === "clicked") {
        pluginEventBus.emit("pet:clicked", { x: payload.x, y: payload.y });
      } else if (payload.type === "double-clicked") {
        pluginEventBus.emit("pet:double-clicked", { x: payload.x, y: payload.y });
      }
    });

    void listen("plugin-state-request", () => {
      void emitTo("pet", "plugin-state-snapshot", { enabled: enabledPluginIds() });
    });

    void emitTo("pet", "plugin-state-snapshot", { enabled: enabledPluginIds() });
  }

  pluginEventBus.emit("app:ready");
}

export { pluginEventBus, pluginManager };
export type * from "./types";
