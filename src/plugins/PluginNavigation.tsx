import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { desktop, type PluginSnapshot } from "../api";

const LEGACY_ENABLED_KEY = "furinapet.plugins.enabled";

export function PluginNavigation() {
  const [active, setActive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<PluginSnapshot[]>([]);
  const [error, setError] = useState("");
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const navButtonRef = useRef<HTMLButtonElement | null>(null);
  const migratedLegacyState = useRef(false);

  useEffect(() => {
    let disposed = false;
    let observer: MutationObserver | null = null;

    const mountNavigation = () => {
      if (disposed || navButtonRef.current) return;
      const nav = document.querySelector<HTMLDivElement>(".sidebar nav");
      const settingsButton = Array.from(nav?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent?.includes("设置"));
      if (!nav || !settingsButton) return;

      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = "<span>♧</span>插件";
      button.addEventListener("click", () => setActive(true));
      nav.insertBefore(button, settingsButton);
      navButtonRef.current = button;

      Array.from(nav.querySelectorAll<HTMLButtonElement>("button")).forEach((item) => {
        if (item === button) return;
        item.addEventListener("click", () => setActive(false));
      });
    };

    mountNavigation();
    observer = new MutationObserver(mountNavigation);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      observer?.disconnect();
      navButtonRef.current?.remove();
      navButtonRef.current = null;
    };
  }, []);

  useEffect(() => {
    navButtonRef.current?.classList.toggle("active", active);
    if (active) void refreshPlugins();
  }, [active]);

  useEffect(() => {
    const content = document.querySelector<HTMLElement>("main.content");
    if (!active || !content) {
      setHost(null);
      return;
    }

    const existingChildren = Array.from(content.children) as HTMLElement[];
    const previousDisplays = existingChildren.map((element) => element.style.display);
    existingChildren.forEach((element) => { element.style.display = "none"; });

    const pageHost = document.createElement("div");
    pageHost.style.display = "contents";
    content.appendChild(pageHost);
    setHost(pageHost);

    return () => {
      pageHost.remove();
      existingChildren.forEach((element, index) => {
        element.style.display = previousDisplays[index];
      });
    };
  }, [active]);

  async function refreshPlugins() {
    try {
      let next = await desktop.listPlugins();

      if (!migratedLegacyState.current) {
        migratedLegacyState.current = true;
        const raw = localStorage.getItem(LEGACY_ENABLED_KEY);
        if (raw) {
          try {
            const legacy = JSON.parse(raw);
            if (
              Array.isArray(legacy)
              && legacy.includes("click-reaction")
              && !next.some((plugin) => plugin.id === "click-reaction" && plugin.enabled)
            ) {
              next = await desktop.setPluginEnabled("click-reaction", true);
            }
          } catch {
            // Invalid legacy state is simply discarded.
          } finally {
            localStorage.removeItem(LEGACY_ENABLED_KEY);
          }
        }
      }

      setPlugins(next);
      setError("");
    } catch (nextError) {
      setError(`插件状态读取失败：${String(nextError)}`);
    }
  }

  async function toggle(id: string, enabled: boolean) {
    setBusyId(id);
    try {
      setPlugins(await desktop.setPluginEnabled(id, enabled));
      setError("");
    } catch (nextError) {
      setError(`插件状态保存失败：${String(nextError)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function testPlugin(id: string) {
    setBusyId(`test:${id}`);
    try {
      if (id === "click-reaction") {
        const handled = await desktop.publishPetEvent("pet:clicked");
        if (!handled) throw new Error("插件 Host 未接管测试事件");
      }
      setError("");
    } catch (nextError) {
      setError(`插件测试失败：${String(nextError)}`);
    } finally {
      setBusyId(null);
    }
  }

  if (!active || !host) return null;

  return createPortal(
    <section className="page">
      <div className="page-header">
        <span>Extensions</span>
        <h1>插件</h1>
        <p>为桌宠增加独立互动能力。插件可单独启停，不影响角色包和基础桌宠设置。</p>
      </div>

      <div className="section-title">
        <div><span>已安装插件</span><h3>功能扩展</h3></div>
        <small>{plugins.length} 个插件</small>
      </div>

      {error && <div className="card" style={{ marginBottom: 14 }}><p style={{ margin: 0 }}>{error}</p></div>}

      <div className="settings-list">
        {plugins.map((plugin) => (
          <div className="setting-row" key={plugin.id}>
            <div>
              <strong>{plugin.name}</strong>
              <p>{plugin.description}</p>
              <small style={{ opacity: .6 }}>v{plugin.version} · API v{plugin.apiVersion}{plugin.active ? " · 运行中" : ""}</small>
            </div>
            <div className="setting-control" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {plugin.id === "click-reaction" && (
                <button
                  type="button"
                  disabled={!plugin.enabled || busyId !== null}
                  onClick={() => void testPlugin(plugin.id)}
                  style={{
                    border: "1px solid rgba(118, 196, 255, .24)",
                    borderRadius: 8,
                    background: "rgba(44, 133, 210, .10)",
                    color: "inherit",
                    padding: "6px 12px",
                    cursor: plugin.enabled && busyId === null ? "pointer" : "default",
                    opacity: plugin.enabled ? 1 : .45,
                  }}
                >
                  测试
                </button>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={plugin.enabled}
                disabled={busyId !== null}
                className={`switch ${plugin.enabled ? "on" : ""}`}
                onClick={() => void toggle(plugin.id, !plugin.enabled)}
              >
                <span />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>,
    host,
  );
}
