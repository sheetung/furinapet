import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { emitTo } from "@tauri-apps/api/event";
import { pluginManager } from "./manager";

export function PluginNavigation() {
  const [active, setActive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const navButtonRef = useRef<HTMLButtonElement | null>(null);
  const plugins = useMemo(() => pluginManager.list(), [revision]);
  const states = pluginManager.states();

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
    const button = navButtonRef.current;
    if (!button) return;
    button.classList.toggle("active", active);
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

  async function toggle(id: string, enabled: boolean) {
    setBusyId(id);
    try {
      await pluginManager.setEnabled(id, enabled);
      if ("__TAURI_INTERNALS__" in window) {
        await emitTo("pet", "plugin-state-changed", { id, enabled });
      }
    } finally {
      setBusyId(null);
      setRevision((value) => value + 1);
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

      <div className="settings-list">
        {plugins.map((plugin) => {
          const state = states.find((item) => item.id === plugin.manifest.id);
          const enabled = state?.enabled ?? false;
          return (
            <div className="setting-row" key={plugin.manifest.id}>
              <div>
                <strong>{plugin.manifest.name}</strong>
                <p>{plugin.manifest.description ?? plugin.manifest.id}</p>
                <small style={{ opacity: .6 }}>v{plugin.manifest.version} · API v{plugin.manifest.apiVersion}{state?.active ? " · 运行中" : ""}</small>
                {state?.error && <small style={{ display: "block", marginTop: 6, color: "#d95c5c" }}>{state.error}</small>}
              </div>
              <div className="setting-control">
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={busyId === plugin.manifest.id}
                  className={`switch ${enabled ? "on" : ""}`}
                  onClick={() => void toggle(plugin.manifest.id, !enabled)}
                >
                  <span />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>,
    host,
  );
}
