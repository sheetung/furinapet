import { createPluginContext } from "./context";
import type { FurinaPlugin, PluginRuntimeState } from "./types";

const ENABLED_KEY = "furinapet.plugins.enabled";

function loadEnabled(): Set<string> {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

class PluginManager {
  private plugins = new Map<string, FurinaPlugin>();
  private active = new Set<string>();
  private errors = new Map<string, string>();
  private enabled = loadEnabled();

  register(plugin: FurinaPlugin): void {
    const { id, apiVersion } = plugin.manifest;
    if (!id) throw new Error("插件 id 不能为空");
    if (apiVersion !== 1) throw new Error(`插件 ${id} 使用了不支持的 API 版本：${apiVersion}`);
    if (this.plugins.has(id)) throw new Error(`插件已注册：${id}`);
    this.plugins.set(id, plugin);
  }

  list(): readonly FurinaPlugin[] {
    return [...this.plugins.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  states(): PluginRuntimeState[] {
    return this.list().map((plugin) => ({
      id: plugin.manifest.id,
      enabled: this.enabled.has(plugin.manifest.id),
      active: this.active.has(plugin.manifest.id),
      error: this.errors.get(plugin.manifest.id),
    }));
  }

  isEnabled(id: string): boolean {
    return this.enabled.has(id);
  }

  private persistEnabled(): void {
    localStorage.setItem(ENABLED_KEY, JSON.stringify([...this.enabled]));
  }

  async activate(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`插件不存在：${id}`);
    if (this.active.has(id)) return;
    this.errors.delete(id);
    try {
      await plugin.activate(createPluginContext(plugin));
      this.active.add(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errors.set(id, message);
      throw error;
    }
  }

  async deactivate(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin || !this.active.has(id)) return;
    await plugin.deactivate?.();
    this.active.delete(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (enabled) {
      this.enabled.add(id);
      this.persistEnabled();
      await this.activate(id);
      return;
    }
    await this.deactivate(id);
    this.enabled.delete(id);
    this.persistEnabled();
  }

  async activateEnabled(): Promise<void> {
    for (const id of [...this.enabled]) {
      if (!this.plugins.has(id)) continue;
      try {
        await this.activate(id);
      } catch (error) {
        console.error(`[plugin:${id}] activation failed`, error);
      }
    }
  }
}

export const pluginManager = new PluginManager();
