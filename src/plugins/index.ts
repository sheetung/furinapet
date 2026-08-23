import { pluginEventBus } from "./event-bus";
import { pluginManager } from "./manager";
import { registerBuiltinPlugins } from "./registry";

let bootstrapped = false;

export async function bootstrapPlugins(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  registerBuiltinPlugins();
  await pluginManager.activateEnabled();
  pluginEventBus.emit("app:ready");
}

export { pluginEventBus, pluginManager };
export type * from "./types";
