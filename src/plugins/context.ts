import { desktop } from "../api";
import { pluginEventBus } from "./event-bus";
import type { FurinaPlugin, PluginContext, PluginPermission } from "./types";

function assertPermission(plugin: FurinaPlugin, permission: PluginPermission): void {
  if (!plugin.manifest.permissions?.includes(permission)) {
    throw new Error(`插件 ${plugin.manifest.id} 缺少权限：${permission}`);
  }
}

function storageKey(pluginId: string, key: string): string {
  return `furinapet.plugin.${pluginId}.${key}`;
}

export function createPluginContext(plugin: FurinaPlugin): PluginContext {
  const pluginId = plugin.manifest.id;

  return {
    pluginId,
    pet: {
      async react(reaction, message) {
        assertPermission(plugin, "pet:react");
        await desktop.react(reaction, message);
      },
      async showMessage(message) {
        assertPermission(plugin, "pet:message");
        await desktop.react("review", message);
      },
    },
    events: {
      on(event, callback) {
        assertPermission(plugin, "events");
        return pluginEventBus.on(event, callback);
      },
      emit(event, payload) {
        assertPermission(plugin, "events");
        pluginEventBus.emit(event, payload);
      },
    },
    storage: {
      get<T>(key: string): T | null {
        assertPermission(plugin, "storage");
        const raw = localStorage.getItem(storageKey(pluginId, key));
        if (raw === null) return null;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return null;
        }
      },
      set<T>(key: string, value: T): void {
        assertPermission(plugin, "storage");
        localStorage.setItem(storageKey(pluginId, key), JSON.stringify(value));
      },
      remove(key: string): void {
        assertPermission(plugin, "storage");
        localStorage.removeItem(storageKey(pluginId, key));
      },
    },
    logger: {
      info(message, ...args) {
        console.info(`[plugin:${pluginId}] ${message}`, ...args);
      },
      warn(message, ...args) {
        console.warn(`[plugin:${pluginId}] ${message}`, ...args);
      },
      error(message, ...args) {
        console.error(`[plugin:${pluginId}] ${message}`, ...args);
      },
    },
  };
}
