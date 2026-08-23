import { listen } from "@tauri-apps/api/event";
import { pluginEventBus } from "./event-bus";
import { pluginManager } from "./manager";
import { registerBuiltinPlugins } from "./registry";

interface PluginChangedEvent {
  id: string;
  enabled: boolean;
}

let bootstrapped = false;

export async function bootstrapPlugins(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  registerBuiltinPlugins();
  await pluginManager.activateEnabled();

  if ("__TAURI_INTERNALS__" in window) {
    void listen<PluginChangedEvent>("plugin-state-changed", (event) => {
      void pluginManager.setEnabled(event.payload.id, event.payload.enabled).catch((error) => {
        console.error(`[plugin:${event.payload.id}] sync failed`, error);
      });
    });
  }

  pluginEventBus.emit("app:ready");
}

export { pluginEventBus, pluginManager };
export type * from "./types";
