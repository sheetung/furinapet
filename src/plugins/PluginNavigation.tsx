import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  desktop,
  type PluginConfigField,
  type PluginConfigSnapshot,
  type PluginSnapshot,
} from "../api";
import { PLUGINS_CHANGED_EVENT } from "./runtime";

const compactButtonStyle: React.CSSProperties = {
  minHeight: 34,
  padding: "0 12px",
  borderRadius: 9,
  fontSize: 12,
  whiteSpace: "nowrap",
};

const dangerButtonStyle: React.CSSProperties = {
  ...compactButtonStyle,
  borderColor: "rgba(255, 113, 113, .25)",
  color: "#ffb2b2",
  background: "rgba(198, 63, 63, .07)",
};

const fieldInputStyle: React.CSSProperties = {
  width: 190,
  height: 36,
  padding: "0 11px",
  border: "1px solid #3d4960",
  borderRadius: 9,
  outline: "none",
  color: "#dcecff",
  background: "#202a3d",
};

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
      const nav = document.querySelector<HTMLElement>(".sidebar nav");
      const settingsButton = Array.from(nav?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent?.includes("设置"));
      if (!nav || !settingsButton) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "plugin-nav-button";
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
      document.querySelector(".app-shell")?.classList.remove("plugin-page-active");
    };
  }, []);

  useEffect(() => {
    navButtonRef.current?.classList.toggle("active", active);
    document.querySelector(".app-shell")?.classList.toggle("plugin-page-active", active);
    if (active) void refreshPlugins();
    else setConfig(null);
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

  useEffect(() => {
    if (!config) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busyId === null) setConfig(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config, busyId]);

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
      await refreshPlugins();
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
  const configPlugin = config ? plugins.find((plugin) => plugin.id === config.id) : null;

  const page = createPortal(
    <section className="page">
      <div className="page-header">
        <span>Extensions</span>
        <h1>插件</h1>
        <p>从 FurinaPet 插件仓库安装扩展。插件独立更新，主程序负责权限、设置与运行生命周期。</p>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, padding: "13px 16px", borderRadius: 12 }}>
          <p style={{ margin: 0, color: "#ffb4b4", fontSize: 12 }}>{error}</p>
        </div>
      )}

      <div className="section-title">
        <div><span>本机</span><h3>已安装</h3></div>
        <small>{installed.length} 个插件</small>
      </div>

      <div className="settings-list" style={{ gap: 10 }}>
        {installed.length === 0 && (
          <div className="setting-row"><div><strong>暂无已安装插件</strong><p>可以从下方插件仓库安装。</p></div></div>
        )}
        {installed.map((plugin) => (
          <div className="setting-row" key={plugin.id} style={{ minHeight: 86, padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: "1 1 auto" }}>
              <div style={{
                width: 42,
                height: 42,
                flex: "0 0 auto",
                display: "grid",
                placeItems: "center",
                borderRadius: 12,
                border: "1px solid rgba(102, 215, 232, .20)",
                color: "#8fe5ff",
                background: "linear-gradient(145deg, rgba(69,151,210,.16), rgba(43,83,138,.08))",
                fontSize: 19,
              }}>✦</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 14 }}>{plugin.name}</strong>
                  {plugin.active && <span className="tag" style={{ color: "#72e5a1", borderColor: "rgba(85,214,138,.22)", background: "rgba(85,214,138,.07)" }}>运行中</span>}
                  {plugin.updateAvailable && <span className="tag">有更新</span>}
                </div>
                <p style={{ marginTop: 5 }}>{plugin.description}</p>
                <small style={{ display: "block", marginTop: 5, opacity: .55, fontSize: 10 }}>
                  v{plugin.installedVersion ?? plugin.version} · SDK {plugin.sdkVersion}
                  {plugin.updateAvailable ? ` · 最新 ${plugin.latestVersion}` : ""}
                </small>
              </div>
            </div>
            <div className="setting-control" style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {plugin.updateAvailable && (
                <button type="button" className="primary" disabled={busyId !== null} style={compactButtonStyle} onClick={() => void update(plugin)}>更新</button>
              )}
              {plugin.configurable && (
                <button type="button" className="secondary" disabled={busyId !== null} style={compactButtonStyle} onClick={() => void openConfig(plugin)}>设置</button>
              )}
              <button type="button" className="secondary" disabled={!plugin.enabled || busyId !== null} style={{ ...compactButtonStyle, opacity: plugin.enabled ? 1 : .45 }} onClick={() => void testPlugin(plugin)}>测试</button>
              <button type="button" className="secondary" disabled={busyId !== null} style={dangerButtonStyle} onClick={() => void uninstall(plugin)}>卸载</button>
              <button
                type="button"
                role="switch"
                aria-label={`${plugin.enabled ? "禁用" : "启用"}${plugin.name}`}
                aria-checked={plugin.enabled}
                disabled={busyId !== null}
                className={`switch ${plugin.enabled ? "on" : ""}`}
                onClick={() => void toggle(plugin)}
              ><span /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 30 }}>
        <div><span>Repository</span><h3>插件仓库</h3></div>
        <small>{loading ? "正在刷新…" : `${available.length} 个可安装`}</small>
      </div>

      <div className="settings-list" style={{ gap: 10 }}>
        {available.length === 0 && !loading && (
          <div className="setting-row"><div><strong>没有新的插件</strong><p>当前目录中的插件都已安装。</p></div></div>
        )}
        {available.map((plugin) => (
          <div className="setting-row" key={plugin.id} style={{ minHeight: 82, padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
              <div style={{
                width: 42,
                height: 42,
                flex: "0 0 auto",
                display: "grid",
                placeItems: "center",
                borderRadius: 12,
                border: "1px solid rgba(126, 201, 255, .16)",
                color: "#78c5ff",
                background: "rgba(84,169,255,.07)",
                fontSize: 18,
              }}>◇</div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{plugin.name}</strong>
                  {plugin.publisherType === "official" && <span className="tag">官方</span>}
                </div>
                <p style={{ marginTop: 5 }}>{plugin.description}</p>
                <small style={{ display: "block", marginTop: 5, opacity: .55, fontSize: 10 }}>v{plugin.version} · SDK {plugin.sdkVersion}</small>
              </div>
            </div>
            <div className="setting-control">
              <button type="button" className="primary" disabled={busyId !== null} style={compactButtonStyle} onClick={() => void install(plugin)}>安装</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 15 }}>
        <button type="button" className="secondary" disabled={loading || busyId !== null} style={compactButtonStyle} onClick={() => void refreshPlugins()}>
          {loading ? "正在刷新…" : "刷新插件目录"}
        </button>
      </div>
    </section>,
    host,
  );

  const configModal = config ? createPortal(
    <div
      className="update-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plugin-config-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && busyId === null) setConfig(null);
      }}
    >
      <div className="update-dialog" style={{ width: "min(620px, 100%)" }} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div style={{
              width: 28,
              height: 28,
              display: "grid",
              placeItems: "center",
              borderRadius: 9,
              border: "1px solid rgba(102,215,232,.22)",
              background: "rgba(70,154,215,.10)",
              color: "#8fe5ff",
            }}>✦</div>
            <div style={{ display: "grid", gap: 1 }}>
              <strong id="plugin-config-title">{config.name}</strong>
              <small style={{ color: "#73849d", fontSize: 9 }}>插件设置 · {configPlugin?.installedVersion ? `v${configPlugin.installedVersion}` : "FurinaPet"}</small>
            </div>
          </div>
          <button aria-label="关闭" disabled={busyId !== null} onClick={() => setConfig(null)}>×</button>
        </header>

        <div className="update-body" style={{ padding: "22px 24px 24px" }}>
          {configPlugin?.description && (
            <p style={{ margin: "0 0 18px", color: "#91a2bd", fontSize: 12, lineHeight: 1.65 }}>{configPlugin.description}</p>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {Object.entries(config.schema).map(([key, field]) => {
              const value = configValues[key] ?? field.default;
              return (
                <div className="setting-row" key={key} style={{ minHeight: 66, padding: "13px 15px", boxShadow: "none" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{field.label}</strong>
                    {field.type === "number" && (field.min !== undefined || field.max !== undefined) && (
                      <p>{field.min !== undefined ? `最小 ${field.min}` : ""}{field.min !== undefined && field.max !== undefined ? " · " : ""}{field.max !== undefined ? `最大 ${field.max}` : ""}</p>
                    )}
                  </div>
                  <div className="setting-control">
                    {field.type === "boolean" ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(value)}
                        className={`switch ${Boolean(value) ? "on" : ""}`}
                        onClick={() => setFieldValue(key, field, !Boolean(value))}
                      ><span /></button>
                    ) : field.type === "select" ? (
                      <select
                        className="select"
                        value={JSON.stringify(value)}
                        onChange={(event) => setFieldValue(key, field, event.target.value)}
                        style={{ width: 190 }}
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
                        style={fieldInputStyle}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <footer>
          <span style={{ marginRight: "auto", color: "#63728a", fontSize: 10 }}>设置由插件声明，FurinaPet 统一渲染</span>
          <div>
            <button className="secondary" disabled={busyId !== null} onClick={() => setConfig(null)}>取消</button>
            <button className="primary" disabled={busyId !== null} onClick={() => void saveConfig()}>{busyId?.startsWith("save:") ? "保存中…" : "保存设置"}</button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  ) : null;

  return <>{page}{configModal}</>;
}
