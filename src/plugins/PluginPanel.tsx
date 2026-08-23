import { useMemo, useState } from "react";
import { pluginManager } from "./manager";

export function PluginPanel() {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const plugins = useMemo(() => pluginManager.list(), [revision]);
  const states = pluginManager.states();

  async function toggle(id: string, enabled: boolean) {
    setBusyId(id);
    try {
      await pluginManager.setEnabled(id, enabled);
    } finally {
      setBusyId(null);
      setRevision((value) => value + 1);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          right: 22,
          bottom: 22,
          zIndex: 80,
          border: "1px solid rgba(255,255,255,.16)",
          borderRadius: 999,
          padding: "10px 15px",
          background: "rgba(28,32,46,.94)",
          color: "white",
          cursor: "pointer",
          boxShadow: "0 10px 30px rgba(0,0,0,.22)",
        }}
      >
        🧩 插件
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="插件管理"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "grid",
            placeItems: "center",
            background: "rgba(8,10,16,.58)",
            padding: 24,
          }}
        >
          <section
            style={{
              width: "min(680px, 92vw)",
              maxHeight: "78vh",
              overflow: "auto",
              borderRadius: 22,
              background: "#171b28",
              color: "#f5f7ff",
              border: "1px solid rgba(255,255,255,.12)",
              boxShadow: "0 24px 80px rgba(0,0,0,.38)",
            }}
          >
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 22px 14px" }}>
              <div>
                <small style={{ opacity: .62 }}>PLUGIN HOST · API v1</small>
                <h2 style={{ margin: "5px 0 0" }}>插件管理</h2>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setOpen(false)} style={{ border: 0, background: "transparent", color: "white", fontSize: 24, cursor: "pointer" }}>×</button>
            </header>

            <div style={{ padding: "0 22px 22px" }}>
              <p style={{ marginTop: 0, opacity: .7, lineHeight: 1.6 }}>
                当前版本先支持内置 TypeScript 插件。插件通过受限 API 使用桌宠互动、事件和独立存储，不直接暴露 Tauri invoke。
              </p>

              <div style={{ display: "grid", gap: 12 }}>
                {plugins.map((plugin) => {
                  const state = states.find((item) => item.id === plugin.manifest.id);
                  const enabled = state?.enabled ?? false;
                  return (
                    <article key={plugin.manifest.id} style={{ display: "flex", gap: 18, alignItems: "center", justifyContent: "space-between", padding: 16, borderRadius: 16, background: "rgba(255,255,255,.055)", border: "1px solid rgba(255,255,255,.08)" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <strong>{plugin.manifest.name}</strong>
                          <small style={{ opacity: .55 }}>v{plugin.manifest.version}</small>
                          {state?.active && <small style={{ color: "#8de6b1" }}>运行中</small>}
                        </div>
                        <p style={{ margin: "7px 0 0", opacity: .7 }}>{plugin.manifest.description ?? plugin.manifest.id}</p>
                        {state?.error && <small style={{ display: "block", marginTop: 7, color: "#ff9b9b" }}>{state.error}</small>}
                      </div>
                      <button
                        type="button"
                        disabled={busyId === plugin.manifest.id}
                        onClick={() => void toggle(plugin.manifest.id, !enabled)}
                        style={{
                          flex: "0 0 auto",
                          border: 0,
                          borderRadius: 999,
                          padding: "9px 14px",
                          cursor: busyId === plugin.manifest.id ? "wait" : "pointer",
                          background: enabled ? "#dbe8ff" : "rgba(255,255,255,.1)",
                          color: enabled ? "#15213a" : "#fff",
                        }}
                      >
                        {busyId === plugin.manifest.id ? "处理中…" : enabled ? "已启用" : "启用"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
