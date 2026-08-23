import type { Reaction } from "../types";

export type PluginPermission =
  | "pet:react"
  | "pet:message"
  | "events"
  | "storage";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description?: string;
  author?: string;
  permissions?: readonly PluginPermission[];
}

export interface PluginEventMap {
  "app:ready": undefined;
  "pet:clicked": { x?: number; y?: number } | undefined;
  "pet:double-clicked": { x?: number; y?: number } | undefined;
  "pet:drag-start": undefined;
  "pet:drag-end": undefined;
  "character:changed": { characterId: string };
  "settings:changed": unknown;
}

export type PluginEventName = keyof PluginEventMap | (string & {});

export interface PluginContext {
  pluginId: string;
  pet: {
    react(reaction: Reaction, message?: string): Promise<void>;
    showMessage(message: string): Promise<void>;
  };
  events: {
    on<T = unknown>(event: PluginEventName, callback: (payload: T) => void | Promise<void>): () => void;
    emit<T = unknown>(event: PluginEventName, payload?: T): void;
  };
  storage: {
    get<T>(key: string): T | null;
    set<T>(key: string, value: T): void;
    remove(key: string): void;
  };
  logger: {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  };
}

export interface FurinaPlugin {
  manifest: PluginManifest;
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export interface PluginRuntimeState {
  id: string;
  enabled: boolean;
  active: boolean;
  error?: string;
}
