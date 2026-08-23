import type { PluginEventName } from "./types";

type Listener = (payload: unknown) => void | Promise<void>;

class PluginEventBus {
  private listeners = new Map<PluginEventName, Set<Listener>>();

  on<T = unknown>(event: PluginEventName, callback: (payload: T) => void | Promise<void>): () => void {
    const bucket = this.listeners.get(event) ?? new Set<Listener>();
    bucket.add(callback as Listener);
    this.listeners.set(event, bucket);
    return () => {
      bucket.delete(callback as Listener);
      if (bucket.size === 0) this.listeners.delete(event);
    };
  }

  emit<T = unknown>(event: PluginEventName, payload?: T): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const listener of [...bucket]) {
      void Promise.resolve(listener(payload)).catch((error) => {
        console.error(`[plugin:event:${event}]`, error);
      });
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const pluginEventBus = new PluginEventBus();
