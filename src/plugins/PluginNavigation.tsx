import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  desktop,
  type PluginConfigField,
  type PluginConfigSnapshot,
  type PluginSnapshot,
} from "../api";
import { PLUGINS_CHANGED_EVENT } from "./runtime";

export function PluginNavigation() {
  const [active, setActive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<PluginSnapshot[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [config, setConfig] = useState<PluginConfigSnapshot | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const navButtonRef = useRef<HTMLButtonElement | null>(null);

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
      button.addEventListener("click", () => {
        Array.from(nav.querySelectorAll<HTMLButtonElement>("button")).forEach((item) => {
          if (item !== button) item.classList.remove("active");
        });
        setActive(true);
      });
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
    setLoading(true);
    try {
      setPlugins(await desktop.fetchPluginCatalog());
      setError("");
    } catch (nextError) {
      try {
        setPlugins(await desktop.listPlugins());
      } catch {
        setPlugins([]);
      }
      setError(`在线插件目录加载失败：${String(nextError)}`);
    } finally {
      setLoading(false);
    }
  }

  function reloadRuntime() {
    window.dispatchEvent(new Event(PLUGINS_CHANGED_EVENT));
  }

  async function runMutation(id: string, task: () => Promise<void>) {
    setBusyId(id);
    try {
      await task();
      reloadRuntime();
      await refreshPlugins();
      setError("");
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setBusyId(null);
    }
  }

  async function install(plugin: PluginSnapshot) {
    await runMutation(`install:${plugin.id}`, () => desktop.installPlugin(plugin.id));
  }

  async function update(plugin: PluginSnapshot) {
    await runMutation(`update:${plugin.id}`, () => desktop.installPlugin(plugin.id));
  }

  async function toggle(plugin: PluginSnapshot) {
    await runMutation(`toggle:${plugin.id}`, () => desktop.setPluginEnabled(plugin.id, !plugin.enabled));
  }

  async function uninstall(plugin: PluginSnapshot) {
    if (!window.confirm(`确定卸载“${plugin.name}”吗？插件设置和本地数据也会删除。`)) return;
    setConfig((current) => current?.id === plugin.id ? null : current);
    await runMutation(`uninstall:${plugin.id}`, () => desktop.uninstallPlugin(plugin.id));
  }

  async function openConfig(plugin: PluginSnapshot) {
    setBusyId(`config:${plugin.id}`);
    try {
      const snapshot = await desktop.getPluginConfig(plugin.id);
      setConfig(snapshot);
      setConfigValues({ ...snapshot.values });
      setError("");
    } catch (nextError) {
      setError(`读取插件设置失败：${String(nextError)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function saveConfig() {
    if (!config) return;
    setBusyId(`save:${config.id}`);
    try {
      await desktop.setPluginConfig(config.id, configValues);
      reloadRuntime();
      setConfig(null);
      setError("");
    } catch (nextError) {
      setError(`保存插件设置失败：${String(nextError)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function testPlugin(plugin: PluginSnapshot) {
    setBusyId(`test:${plugin.id}`);
    try {
      if (plugin.id === "furinapet.click-reaction") {
        const handled = await desktop.publishPetEvent("pet:clicked");
        if (!handled) throw new Error("点击事件未被插件接管");
      } else {
        await desktop.pluginSdkCall(plugin.id, "pet.react", {
          reaction: "waving",
          message: `${plugin.name} 已连接到插件 Host。`,
        });
      }
      setError("");
    } catch (nextError) {
      setError(`插件测试失败：${String(nextError)}`);
    } finally {
      setBusyId(null);
    }
  }

  function setFieldValue(key: string, field: PluginConfigField, raw: string | boolean) {
    let value: unknown = raw;
    if (field.type === "number") value = Number(raw);
    if (field.type === "select") {
      const option = field.options?.find((entry) => JSON.stringify(entry.value) === raw);
      value = option?.value ?? raw;
    }
    setConfigValues((current) => ({ ...current, [key]: value }));
  }

  if (!active || !host) return null;

  const installed = plugins.filter((plugin) => plugin.installed);
  const available = plugins.filter((plugin) => !plugin.installed);

  const actionButtonStyle: React.CSSProperties = {
    border: "1px solid rgba(118, 196, 255, .22)",
    borderRadius: 8,
    background: "rgba(44, 133, 210, .10)",
    color: "inherit",
    padding: "7px 11px",
    cursor: busyId === null ? "pointer" : "default",
    whiteSpace: "nowrap",
  };

  const dangerButtonStyle: React.CSSProperties = {
    ...actionButtonStyle,
    borderColor: "rgba(255, 113, 113, .22)",
    background: "rgba(198, 63, 63, .08)",
  };

  return createPortal(
    <section className="page">
      <div className="page-header">
        <span>Extensions</span>
        <h1>插件</h1>
        <p>从 FurinaPet 插件仓库安装扩展。插件独立更新，主程序负责权限、设置与运行生命周期。</p>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 14 }}>
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      <div className="section-title">
        <div><span>本机</span><h3>已安装</h3></div>
        <small>{installed.length} 个插件</small>
      </div>

      <div className="settings-list">
        {installed.length === 0 && (
          <div className="setting-row"><div><strong>暂无已安装插件</strong><p>可以从下方插件仓库安装。</p></div></div>
        )}
        {installed.map((plugin) => (
          <div className="setting-row" key={plugin.id}>
            <div style={{ minWidth: 0 }}>
              <strong>{plugin.name}</strong>
              <p>{plugin.description}</p>
              <small style={{ opacity: .6 }}>
                v{plugin.installedVersion ?? plugin.version} · SDK {plugin.sdkVersion}
                {plugin.active ? " · 运行中" : ""}
                {plugin.updateAvailable ? ` · 可更新至 ${plugin.latestVersion}` : ""}
              </small>
            </div>
            <div className="setting-control" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {plugin.updateAvailable && (
                <button type="button" disabled={busyId !== null} style={actionButtonStyle} onClick={() => void update(plugin)}>更新</button>
              )}
              {plugin.configurable && (
                <button type="button" disabled={busyId !== null} style={actionButtonStyle} onClick={() => void openConfig(plugin)}>设置</button>
              )}
              <button type="button" disabled={!plugin.enabled || busyId !== null} style={{ ...actionButtonStyle, opacity: plugin.enabled ? 1 : .45 }} onClick={() => void testPlugin(plugin)}>测试</button>
              <button type="button" disabled={busyId !== null} style={dangerButtonStyle} onClick={() => void uninstall(plugin)}>卸载</button>
              <button
                type="button"
                role="switch"
                aria-checked={plugin.enabled}
                disabled={busyId !== null}
                className={`switch ${plugin.enabled ? "on" : ""}`}
                onClick={() => void toggle(plugin)}
              ><span /></button>
            </div>
          </div>
        ))}
      </div>

      {config && (
        <div className="card" style={{ marginTop: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
            <div><small style={{ opacity: .6 }}>插件设置</small><h3 style={{ margin: "4px 0 0" }}>{config.name}</h3></div>
            <button type="button" style={actionButtonStyle} onClick={() => setConfig(null)}>关闭</button>
          </div>
          <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
            {Object.entries(config.schema).map(([key, field]) => {
              const value = configValues[key] ?? field.default;
              return (
                <label key={key} style={{ display: "grid", gap: 7 }}>
                  <span style={{ fontSize: 13 }}>{field.label}</span>
                  {field.type === "boolean" ? (
                    <input type="checkbox" checked={Boolean(value)} onChange={(event) => setFieldValue(key, field, event.target.checked)} />
                  ) : field.type === "select" ? (
                    <select
                      value={JSON.stringify(value)}
                      onChange={(event) => setFieldValue(key, field, event.target.value)}
                      style={{ padding: "8px 10px", borderRadius: 8 }}
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      value={String(value ?? "")}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      maxLength={field.maxLength}
                      onChange={(event) => setFieldValue(key, field, event.target.value)}
                      style={{ padding: "8px 10px", borderRadius: 8 }}
                    />
                  )}
                </label>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <button type="button" disabled={busyId !== null} style={actionButtonStyle} onClick={() => void saveConfig()}>保存设置</button>
          </div>
        </div>
      )}

      <div className="section-title" style={{ marginTop: 22 }}>
        <div><span>Repository</span><h3>插件仓库</h3></div>
        <small>{loading ? "正在刷新…" : `${available.length} 个可安装`}</small>
      </div>

      <div className="settings-list">
        {available.length === 0 && !loading && (
          <div className="setting-row"><div><strong>没有新的插件</strong><p>当前目录中的插件都已安装。</p></div></div>
        )}
        {available.map((plugin) => (
          <div className="setting-row" key={plugin.id}>
            <div>
              <strong>{plugin.name}</strong>
              <p>{plugin.description}</p>
              <small style={{ opacity: .6 }}>v{plugin.version} · SDK {plugin.sdkVersion} · {plugin.publisherType === "official" ? "官方" : plugin.publisherType}</small>
            </div>
            <div className="setting-control">
              <button type="button" disabled={busyId !== null} style={actionButtonStyle} onClick={() => void install(plugin)}>安装</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" disabled={loading || busyId !== null} style={actionButtonStyle} onClick={() => void refreshPlugins()}>刷新插件目录</button>
      </div>
    </section>,
    host,
  );
}
