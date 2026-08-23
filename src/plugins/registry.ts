import type { FurinaPlugin } from "./types";
import { pluginManager } from "./manager";

const builtinModules = import.meta.glob<{ default: FurinaPlugin }>("./builtin/*/index.ts", {
  eager: true,
});

export const builtinPlugins = Object.values(builtinModules)
  .map((module) => module.default)
  .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

export function registerBuiltinPlugins(): readonly FurinaPlugin[] {
  for (const plugin of builtinPlugins) {
    pluginManager.register(plugin);
  }
  return builtinPlugins;
}
