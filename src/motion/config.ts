/** Which renderer the pet window mounts. */
export type RenderBackend = "sprite" | "primitive" | "vrm";

const BACKEND_KEY = "furinapet.renderBackend";
const MODEL_KEY = "furinapet.vrmUrl";
const DEFAULT_MODEL_URL = "models/pet.vrm";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode or a locked-down WebView; fall through to the default.
    return null;
  }
}

function isBackend(value: string | null): value is RenderBackend {
  return value === "sprite" || value === "primitive" || value === "vrm";
}

/**
 * Sprite stays the default on purpose. The 3D pipeline is opt-in until a model is
 * present, so an existing install behaves exactly as before after an update.
 *
 * `?rig=` wins over the stored value so the backend can be forced from a dev URL
 * without persisting anything.
 */
export function resolveRenderBackend(): RenderBackend {
  const override = new URLSearchParams(window.location.search).get("rig");
  if (isBackend(override)) return override;
  const stored = readStorage(BACKEND_KEY);
  return isBackend(stored) ? stored : "sprite";
}

export function setRenderBackend(backend: RenderBackend) {
  try {
    window.localStorage.setItem(BACKEND_KEY, backend);
  } catch {
    // Nothing to do; the caller re-reads on the next launch.
  }
}

/**
 * No model ships with the repository — character models cannot be redistributed
 * here — so the URL is configuration. A missing file is an expected outcome and
 * the caller falls back to `PrimitiveRig`.
 */
export function resolveVrmUrl(): string {
  return readStorage(MODEL_KEY) ?? DEFAULT_MODEL_URL;
}

export function setVrmUrl(url: string | null) {
  try {
    if (url) window.localStorage.setItem(MODEL_KEY, url);
    else window.localStorage.removeItem(MODEL_KEY);
  } catch {
    // See above.
  }
}
