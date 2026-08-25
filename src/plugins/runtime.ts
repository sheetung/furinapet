import { listen } from "@tauri-apps/api/event";
import { desktop, type RuntimePlugin } from "../api";
import type { PetGoalId } from "../pet-brain";

export const PLUGINS_CHANGED_EVENT = "furinapet-plugins-changed";

type WorkerRecord = {
  worker: Worker;
  pluginUrl: string;
  workerUrl: string;
  version: string;
};

type RuntimeEvent = {
  name: string;
  pluginIds: string[];
  payload: unknown;
};

type WorkerMessage =
  | { kind: "sdk"; requestId: number; method: string; args: unknown }
  | { kind: "ready" }
  | { kind: "error"; message: string };

const workers = new Map<string, WorkerRecord>();
let bootstrapped = false;
let refreshChain: Promise<void> = Promise.resolve();

function workerBootstrap(plugin: RuntimePlugin, pluginUrl: string) {
  const encodedConfig = JSON.stringify(plugin.config);
  const encodedPermissions = JSON.stringify(plugin.permissions);
  const encodedPluginUrl = JSON.stringify(pluginUrl);
  const encodedId = JSON.stringify(plugin.id);

  return `
const pluginId = ${encodedId};
const config = Object.freeze(${encodedConfig});
const permissions = new Set(${encodedPermissions});
const pending = new Map();
const handlers = new Map();
let requestSequence = 0;
let cleanup = null;

const fail = (message) => self.postMessage({ kind: "error", message: String(message) });

const requirePermission = (permission) => {
  if (!permissions.has(permission)) throw new Error("Permission denied: " + permission);
};

const sdk = (method, args = {}) => new Promise((resolve, reject) => {
  const requestId = ++requestSequence;
  pending.set(requestId, { resolve, reject });
  self.postMessage({ kind: "sdk", requestId, method, args });
});

const guardDelay = (milliseconds) => {
  const value = Number(milliseconds);
  if (!Number.isFinite(value)) throw new Error("Timer delay must be finite");
  return Math.max(0, Math.min(value, 7 * 24 * 60 * 60 * 1000));
};

const invokeHandler = (handler, payload) => {
  try {
    Promise.resolve(handler(payload)).catch((error) => fail(error?.stack || error));
  } catch (error) {
    fail(error?.stack || error);
  }
};

const ctx = Object.freeze({
  config: Object.freeze({
    get(key) {
      requirePermission("config");
      return config[String(key)];
    },
  }),
  storage: Object.freeze({
    get(key) {
      requirePermission("storage");
      return sdk("storage.get", { key: String(key) });
    },
    set(key, value) {
      requirePermission("storage");
      return sdk("storage.set", { key: String(key), value });
    },
  }),
  pet: Object.freeze({
    react(reaction, message) {
      requirePermission("pet:reaction");
      return sdk("pet.react", {
        reaction: String(reaction),
        ...(message === undefined ? {} : { message: String(message) }),
      });
    },
    intent(goal, options = {}) {
      requirePermission("pet:behavior");
      const priority = Number(options?.priority ?? 0.7);
      const ttlMs = Number(options?.ttlMs ?? 3000);
      return sdk("pet.intent", {
        goal: String(goal),
        priority: Number.isFinite(priority) ? priority : 0.7,
        ttlMs: Number.isFinite(ttlMs) ? ttlMs : 3000,
        ...(options?.id === undefined ? {} : { id: String(options.id) }),
      });
    },
  }),
  timer: Object.freeze({
    setTimeout(handler, milliseconds) {
      requirePermission("timer");
      return self.setTimeout(() => invokeHandler(handler), guardDelay(milliseconds));
    },
    clearTimeout(handle) {
      requirePermission("timer");
      self.clearTimeout(handle);
    },
    setInterval(handler, milliseconds) {
      requirePermission("timer");
      return self.setInterval(() => invokeHandler(handler), guardDelay(milliseconds));
    },
    clearInterval(handle) {
      requirePermission("timer");
      self.clearInterval(handle);
    },
  }),
  events: Object.freeze({
    on(name, handler) {
      requirePermission("events:pet");
      const eventName = String(name);
      if (!eventName.startsWith("pet:")) throw new Error("Unsupported event namespace");
      if (typeof handler !== "function") throw new Error("Event handler must be a function");
      let entries = handlers.get(eventName);
      if (!entries) {
        entries = new Set();
        handlers.set(eventName, entries);
      }
      entries.add(handler);
      return () => entries.delete(handler);
    },
  }),
});

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.kind === "sdk-result") {
    const pendingRequest = pending.get(message.requestId);
    if (!pendingRequest) return;
    pending.delete(message.requestId);
    if (message.ok) pendingRequest.resolve(message.result);
    else pendingRequest.reject(new Error(String(message.error || "SDK call failed")));
    return;
  }

  if (message.kind === "event") {
    const entries = handlers.get(String(message.name));
    if (!entries) return;
    for (const handler of [...entries]) invokeHandler(handler, message.payload);
    return;
  }

  if (message.kind === "deactivate") {
    if (typeof cleanup === "function") invokeHandler(cleanup);
    handlers.clear();
    self.close();
  }
};

(async () => {
  try {
    const module = await import(${encodedPluginUrl});
    const plugin = module?.default;
    if (!plugin || typeof plugin.activate !== "function") {
      throw new Error("Plugin entry must export default { activate(ctx) }");
    }
    cleanup = await plugin.activate(ctx);
    self.postMessage({ kind: "ready" });
  } catch (error) {
    fail(error?.stack || error);
  }
})();
`;
}

function stopWorker(id: string) {
  const current = workers.get(id);
  if (!current) return;
  current.worker.postMessage({ kind: "deactivate" });
  window.setTimeout(() => current.worker.terminate(), 50);
  URL.revokeObjectURL(current.pluginUrl);
  URL.revokeObjectURL(current.workerUrl);
  workers.delete(id);
}

function isPetGoal(value: unknown): value is PetGoalId {
  return typeof value === "string" && [
    "idle",
    "wander",
    "dock",
    "respond-user",
    "observe-agent",
    "celebrate",
    "rest",
  ].includes(value);
}

function startWorker(plugin: RuntimePlugin) {
  const pluginUrl = URL.createObjectURL(new Blob([plugin.source], { type: "text/javascript" }));
  const workerUrl = URL.createObjectURL(new Blob([workerBootstrap(plugin, pluginUrl)], { type: "text/javascript" }));
  const worker = new Worker(workerUrl, { type: "module", name: `furinapet:${plugin.id}` });

  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.kind === "sdk") {
      if (message.method === "pet.intent") {
        const args = message.args && typeof message.args === "object"
          ? message.args as Record<string, unknown>
          : {};
        const goal = args.goal;
        if (!plugin.permissions.includes("pet:behavior") || !isPetGoal(goal)) {
          worker.postMessage({
            kind: "sdk-result",
            requestId: message.requestId,
            ok: false,
            error: "Plugin permission denied or invalid Pet Brain goal",
          });
          return;
        }
        const priority = typeof args.priority === "number" ? args.priority : 0.7;
        const ttlMs = typeof args.ttlMs === "number" ? args.ttlMs : 3000;
        const id = typeof args.id === "string" ? `${plugin.id}:${args.id}` : undefined;
        void desktop.submitBrainIntent("plugin", goal, { priority, ttlMs, id })
          .then(() => worker.postMessage({ kind: "sdk-result", requestId: message.requestId, ok: true, result: null }))
          .catch((error) => worker.postMessage({
            kind: "sdk-result",
            requestId: message.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        return;
      }

      void desktop.pluginSdkCall(plugin.id, message.method, message.args)
        .then((result) => worker.postMessage({ kind: "sdk-result", requestId: message.requestId, ok: true, result }))
        .catch((error) => worker.postMessage({
          kind: "sdk-result",
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      return;
    }
    if (message.kind === "error") {
      console.error(`[plugin:${plugin.id}]`, message.message);
    }
  };

  worker.onerror = (event) => {
    console.error(`[plugin:${plugin.id}] worker error`, event.message);
  };

  workers.set(plugin.id, { worker, pluginUrl, workerUrl, version: plugin.version });
}

async function performRefresh() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const runtimePlugins = await desktop.listRuntimePlugins();
  const nextIds = new Set(runtimePlugins.map((plugin) => plugin.id));

  for (const id of [...workers.keys()]) {
    if (!nextIds.has(id)) stopWorker(id);
  }

  for (const plugin of runtimePlugins) {
    const current = workers.get(plugin.id);
    if (current) stopWorker(plugin.id);
    startWorker(plugin);
  }
}

export function refreshPluginRuntime() {
  refreshChain = refreshChain
    .catch(() => undefined)
    .then(performRefresh)
    .catch((error) => console.error("[plugin-runtime] refresh failed", error));
  return refreshChain;
}

export function bootstrapPluginRuntime() {
  if (bootstrapped || !("__TAURI_INTERNALS__" in window)) return;
  bootstrapped = true;

  void listen<RuntimeEvent>("plugin-runtime-event", (event) => {
    for (const id of event.payload.pluginIds) {
      workers.get(id)?.worker.postMessage({
        kind: "event",
        name: event.payload.name,
        payload: event.payload.payload,
      });
    }
  }).catch((error) => console.error("[plugin-runtime] event bridge failed", error));

  window.addEventListener(PLUGINS_CHANGED_EVENT, () => void refreshPluginRuntime());
  void refreshPluginRuntime();
}
