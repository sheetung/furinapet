import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  desktop,
  type AgentState,
  type AgentStatusSnapshot,
  type ClaudeIntegrationStatus,
  type IntegrationStatus,
  type McpServerConfigPreview,
} from "../api";

const stateMeta: Record<AgentState, { label: string; icon: string }> = {
  idle: { label: "空闲", icon: "○" },
  thinking: { label: "思考中", icon: "◌" },
  editing: { label: "编辑中", icon: "✎" },
  testing: { label: "测试中", icon: "◇" },
  waiting: { label: "等待授权", icon: "⌛" },
  success: { label: "已完成", icon: "✓" },
  error: { label: "发生错误", icon: "!" },
};

const statusLabel: Record<IntegrationStatus, string> = {
  installed: "已接入",
  not_installed: "未接入",
  needs_update: "需要更新",
  error: "检查失败",
  unavailable: "未检测到",
};

export function AgentNavigation() {
  const [active, setActive] = useState(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [agent, setAgent] = useState<AgentStatusSnapshot | null>(null);
  const [claude, setClaude] = useState<ClaudeIntegrationStatus | null>(null);
  const [mcp, setMcp] = useState<McpServerConfigPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const navButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let observer: MutationObserver | null = null;
    let mountedNav: HTMLElement | null = null;
    let delegatedListener: ((event: Event) => void) | null = null;

    const mountNavigation = () => {
      if (disposed || navButtonRef.current) return;
      const nav = document.querySelector<HTMLElement>(".sidebar nav");
      const settingsButton = Array.from(nav?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent?.includes("设置"));
      if (!nav || !settingsButton) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "agent-nav-button";
      button.innerHTML = "<span>⌘</span>智能体";
      button.addEventListener("click", () => {
        // Drive App and PluginNavigation back to a known page first so only one
        // dynamically hosted page can be active at a time.
        const home = Array.from(nav.querySelectorAll<HTMLButtonElement>("button"))
          .find((item) => item !== button && item.textContent?.includes("主页"));
        home?.click();
        Array.from(nav.querySelectorAll<HTMLButtonElement>("button")).forEach((item) => {
          if (item !== button) item.classList.remove("active");
        });
        setActive(true);
      });
      nav.insertBefore(button, settingsButton);
      navButtonRef.current = button;
      mountedNav = nav;
      delegatedListener = (event: Event) => {
        const target = event.target instanceof Element ? event.target.closest("button") : null;
        if (target && target !== button) setActive(false);
      };
      nav.addEventListener("click", delegatedListener);
    };

    mountNavigation();
    observer = new MutationObserver(mountNavigation);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      observer?.disconnect();
      if (mountedNav && delegatedListener) mountedNav.removeEventListener("click", delegatedListener);
      navButtonRef.current?.remove();
      navButtonRef.current = null;
      document.querySelector(".app-shell")?.classList.remove("agent-page-active");
    };
  }, []);

  useEffect(() => {
    navButtonRef.current?.classList.toggle("active", active);
    document.querySelector(".app-shell")?.classList.toggle("agent-page-active", active);
    if (!active) return;

    void refreshAll();
    const timer = window.setInterval(() => {
      void desktop.getAgentStatus().then(setAgent).catch(() => undefined);
    }, 1600);
    return () => window.clearInterval(timer);
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

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  async function refreshAll() {
    try {
      const [nextAgent, nextClaude, nextMcp] = await Promise.all([
        desktop.getAgentStatus(),
        desktop.getClaudeIntegrationStatus(),
        desktop.getMcpServerConfig(),
      ]);
      setAgent(nextAgent);
      setClaude(nextClaude);
      setMcp(nextMcp);
    } catch (error) {
      showToast(`智能体状态加载失败：${String(error)}`);
    }
  }

  async function installClaude() {
    setBusy(true);
    try {
      const status = await desktop.installClaudeIntegration();
      setClaude(status);
      showToast("Claude Code 已接入 FurinaPet");
    } catch (error) {
      showToast(`接入失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function uninstallClaude() {
    setBusy(true);
    try {
      const status = await desktop.uninstallClaudeIntegration();
      setClaude(status);
      showToast("已移除 FurinaPet 的 Claude Code 配置");
    } catch (error) {
      showToast(`移除失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function testIntegration() {
    try {
      await desktop.testAgentIntegration();
      showToast("已向桌宠发送测试状态");
    } catch (error) {
      showToast(`测试失败：${String(error)}`);
    }
  }

  async function copyMcpConfig() {
    if (!mcp) return;
    try {
      await navigator.clipboard.writeText(mcp.json);
      showToast("MCP 配置已复制");
    } catch {
      showToast("复制失败，请手动复制配置");
    }
  }

  if (!active || !host) return null;

  const meta = stateMeta[agent?.state ?? "idle"];
  const claudeInstalled = claude?.overallStatus === "installed";
  const claudeNeedsUpdate = claude?.overallStatus === "needs_update";

  return createPortal(
    <section className="page agent-page">
      <style>{`
        .agent-page { padding-bottom: 36px; }
        .agent-page .agent-header { margin-bottom: 22px; }
        .agent-page .agent-header > span { display:block; margin-bottom:6px; color:#69a8ff; font-size:11px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
        .agent-page .agent-header h1 { margin:0; font-size:26px; letter-spacing:-.02em; }
        .agent-page .agent-header p { margin:8px 0 0; color:#91a0b7; font-size:13px; line-height:1.65; }
        .agent-card { border:1px solid #303a4f; border-radius:14px; background:linear-gradient(145deg,#202a3c,#1c2535); box-shadow:0 12px 30px rgba(3,8,18,.12); margin-bottom:14px; overflow:hidden; }
        .agent-card-main { display:flex; align-items:center; gap:14px; padding:17px 18px; }
        .agent-icon { width:44px; height:44px; flex:0 0 44px; border:1px solid #3b4a65; border-radius:12px; display:grid; place-items:center; background:#263248; color:#89bdff; font-size:20px; font-weight:700; }
        .agent-card-info { min-width:0; flex:1; }
        .agent-card-title { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .agent-card-title strong { color:#e5eefb; font-size:14px; }
        .agent-card-info p { margin:5px 0 0; color:#8e9db3; font-size:12px; line-height:1.55; }
        .agent-badge { display:inline-flex; align-items:center; min-height:21px; padding:0 8px; border-radius:999px; border:1px solid #3b4960; background:#273247; color:#aebdd1; font-size:10px; font-weight:700; }
        .agent-badge.live { border-color:rgba(79,187,133,.28); background:rgba(49,153,101,.10); color:#80d9aa; }
        .agent-badge.warn { border-color:rgba(236,174,71,.28); background:rgba(185,126,36,.10); color:#efc477; }
        .agent-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .agent-actions button { min-height:34px; padding:0 12px; border-radius:9px; font-size:12px; white-space:nowrap; }
        .agent-status-hero { display:flex; align-items:center; gap:16px; padding:18px; }
        .agent-state-orb { width:54px; height:54px; border-radius:16px; display:grid; place-items:center; background:radial-gradient(circle at 30% 25%,rgba(105,168,255,.28),rgba(64,105,177,.10)); border:1px solid rgba(105,168,255,.28); color:#9bc8ff; font-size:25px; }
        .agent-status-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; padding:0 18px 18px; }
        .agent-stat { padding:10px 12px; border-radius:10px; background:#192233; border:1px solid #2b3549; }
        .agent-stat span { display:block; color:#75849b; font-size:10px; margin-bottom:4px; }
        .agent-stat strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#cfd9e8; font-size:12px; }
        .agent-section-title { display:flex; justify-content:space-between; align-items:end; margin:24px 1px 10px; }
        .agent-section-title span { color:#74849a; font-size:11px; letter-spacing:.08em; }
        .agent-section-title h3 { margin:4px 0 0; font-size:16px; }
        .agent-detail-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:7px; }
        .agent-mcp-config { padding:0 18px 18px; }
        .agent-mcp-config pre { margin:0; padding:13px 14px; max-height:150px; overflow:auto; border:1px solid #2d394d; border-radius:10px; background:#151d2b; color:#aebed5; font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace; white-space:pre-wrap; word-break:break-all; }
        .agent-privacy { margin-top:17px; padding:12px 14px; border:1px solid rgba(86,130,192,.20); border-radius:11px; background:rgba(38,72,117,.08); color:#8fa1ba; font-size:11px; line-height:1.65; }
        .agent-page .agent-danger { border-color:rgba(255,113,113,.24); color:#ffb2b2; background:rgba(198,63,63,.06); }
        @media (max-width: 820px) { .agent-status-grid { grid-template-columns:1fr; } .agent-card-main { align-items:flex-start; flex-wrap:wrap; } .agent-actions { width:100%; } }
      `}</style>

      <div className="agent-header">
        <span>Agents</span>
        <h1>智能体</h1>
        <p>让 Claude Code 和其他 MCP 智能体把运行状态映射到桌宠动画。Agent Bridge、MCP Server 与 Claude Hooks 都内置在 FurinaPet 中。</p>
      </div>

      <div className="agent-card">
        <div className="agent-status-hero">
          <div className="agent-state-orb">{meta.icon}</div>
          <div className="agent-card-info">
            <div className="agent-card-title">
              <strong>{meta.label}</strong>
              <span className="agent-badge live">Agent Bridge · 本地</span>
            </div>
            <p>{agent?.agent ? `${agent.agent}${agent.project ? ` · ${agent.project}` : ""}` : "当前没有活跃的智能体会话。"}</p>
          </div>
          <div className="agent-actions"><button className="secondary" onClick={() => void testIntegration()}>测试桌宠</button></div>
        </div>
        <div className="agent-status-grid">
          <div className="agent-stat"><span>当前状态</span><strong>{meta.label}</strong></div>
          <div className="agent-stat"><span>活跃会话</span><strong>{agent?.sessionCount ?? 0}</strong></div>
          <div className="agent-stat"><span>协议</span><strong>Agent Bridge v{agent?.protocolVersion ?? 1}</strong></div>
        </div>
      </div>

      <div className="agent-section-title"><div><span>官方集成</span><h3>智能体连接</h3></div></div>

      <div className="agent-card">
        <div className="agent-card-main">
          <div className="agent-icon">C</div>
          <div className="agent-card-info">
            <div className="agent-card-title">
              <strong>Claude Code</strong>
              <span className={`agent-badge ${claudeInstalled ? "live" : claudeNeedsUpdate ? "warn" : ""}`}>{statusLabel[claude?.overallStatus ?? "not_installed"]}</span>
            </div>
            <p>{claude?.message ?? "检测 Claude Code MCP 与生命周期 Hooks。"}</p>
            <div className="agent-detail-row">
              <span className="agent-badge">MCP · {statusLabel[claude?.mcpStatus ?? "not_installed"]}</span>
              <span className="agent-badge">Hooks · {statusLabel[claude?.hooksStatus ?? "not_installed"]}</span>
            </div>
          </div>
          <div className="agent-actions">
            {claudeInstalled ? (
              <button className="agent-danger" disabled={busy} onClick={() => void uninstallClaude()}>移除</button>
            ) : (
              <button className="primary" disabled={busy || claude?.claudeAvailable === false} onClick={() => void installClaude()}>{busy ? "处理中…" : claudeNeedsUpdate ? "更新接入" : "一键接入"}</button>
            )}
            <button className="secondary" disabled={busy} onClick={() => void refreshAll()}>刷新</button>
          </div>
        </div>
      </div>

      <div className="agent-card">
        <div className="agent-card-main">
          <div className="agent-icon">M</div>
          <div className="agent-card-info">
            <div className="agent-card-title"><strong>通用 MCP</strong><span className="agent-badge live">内置 stdio</span></div>
            <p>适用于 Cursor、支持 MCP 的编辑器和其他智能体。直接启动当前 FurinaPet 可执行文件的 <code>mcp</code> 模式，无需 Node 或 npx。</p>
          </div>
          <div className="agent-actions"><button className="secondary" onClick={() => void copyMcpConfig()}>复制配置</button></div>
        </div>
        {mcp && <div className="agent-mcp-config"><pre>{mcp.json}</pre></div>}
      </div>

      <div className="agent-privacy">自动状态只传递事件类别、会话标识、工具类别和项目名称，不把 prompt、代码内容、工具输出、终端日志或完整文件路径显示给桌宠。MCP 的主动气泡文本也会经过长度和敏感内容校验。</div>

      {toast && <div className="toast">{toast}</div>}
    </section>,
    host,
  );
}
