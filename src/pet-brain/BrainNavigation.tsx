import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { desktop, type AiBehaviorSuggestion, type AiSettingsSnapshot } from "../api";
import type { AppSettings, SettingsPatch } from "../types";

type FormState = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  cooldownSeconds: number;
  timeoutSeconds: number;
  apiKey: string;
};

const emptyForm: FormState = {
  enabled: false,
  baseUrl: "",
  model: "",
  cooldownSeconds: 45,
  timeoutSeconds: 12,
  apiKey: "",
};

export function BrainNavigation() {
  const [active, setActive] = useState(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettingsSnapshot | null>(null);
  const [behaviorSettings, setBehaviorSettings] = useState<AppSettings | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [behaviorBusy, setBehaviorBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiBehaviorSuggestion | null>(null);
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
      button.className = "brain-nav-button";
      button.innerHTML = "<span>◈</span>自主";
      button.addEventListener("click", () => {
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
    };
  }, []);

  useEffect(() => {
    navButtonRef.current?.classList.toggle("active", active);
    if (!active) return;
    void refresh();
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
    window.setTimeout(() => setToast(""), 2400);
  }

  async function refresh() {
    try {
      const [nextAi, nextBehavior] = await Promise.all([
        desktop.getAiSettings(),
        desktop.getSettings(),
      ]);
      setAiSettings(nextAi);
      setBehaviorSettings(nextBehavior);
      setForm({
        enabled: nextAi.enabled,
        baseUrl: nextAi.baseUrl,
        model: nextAi.model,
        cooldownSeconds: nextAi.cooldownSeconds,
        timeoutSeconds: nextAi.timeoutSeconds,
        apiKey: "",
      });
    } catch (error) {
      showToast(`自主设置加载失败：${String(error)}`);
    }
  }

  async function updateBehaviorSettings(patch: SettingsPatch) {
    setBehaviorBusy(true);
    try {
      const next = await desktop.updateSettings(patch);
      setBehaviorSettings(next);
    } catch (error) {
      showToast(`自主设置保存失败：${String(error)}`);
      void desktop.getSettings().then(setBehaviorSettings).catch(() => undefined);
    } finally {
      setBehaviorBusy(false);
    }
  }

  async function save(clearApiKey = false) {
    setBusy(true);
    try {
      const next = await desktop.updateAiSettings({
        enabled: form.enabled,
        baseUrl: form.baseUrl,
        model: form.model,
        cooldownSeconds: form.cooldownSeconds,
        timeoutSeconds: form.timeoutSeconds,
        apiKey: form.apiKey.trim() || undefined,
        clearApiKey,
      });
      setAiSettings(next);
      setForm((current) => ({ ...current, apiKey: "" }));
      setTestResult(null);
      showToast(clearApiKey ? "已清除 AI API Key" : "AI 建议设置已保存");
      return true;
    } catch (error) {
      showToast(`保存失败：${String(error)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function testProvider() {
    if (!(await save(false))) return;
    setTesting(true);
    try {
      const result = await desktop.testAiProvider();
      setTestResult(result);
      showToast(`AI 返回：${goalLabel(result.goal)}`);
    } catch (error) {
      setTestResult(null);
      showToast(`AI 测试失败：${String(error)}`);
    } finally {
      setTesting(false);
    }
  }

  if (!active || !host) return null;

  return createPortal(
    <section className="page brain-page">
      <style>{`
        .brain-page { padding-bottom:36px; }
        .brain-header > span { color:#66d7e8; font-size:10px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
        .brain-header h1 { margin:6px 0 8px; font-size:28px; }
        .brain-header p { margin:0 0 22px; color:#91a2bd; font-size:13px; line-height:1.65; }
        .brain-card { margin-bottom:14px; overflow:hidden; border:1px solid rgba(164,190,228,.14); border-radius:16px; background:linear-gradient(145deg,rgba(29,38,61,.96),rgba(20,27,45,.96)); box-shadow:0 15px 36px rgba(0,0,0,.15); }
        .brain-card-head { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:18px; border-bottom:1px solid rgba(164,190,228,.12); }
        .brain-card-head h3 { margin:4px 0 0; font-size:16px; }
        .brain-card-head p { margin:6px 0 0; color:#91a2bd; font-size:11px; line-height:1.55; }
        .brain-kicker { color:#66d7e8; font-size:9px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
        .brain-badge { display:inline-flex; align-items:center; min-height:24px; padding:0 9px; border:1px solid #3b4960; border-radius:999px; color:#aebdd1; background:#273247; font-size:10px; font-weight:700; }
        .brain-badge.live { border-color:rgba(85,214,138,.28); background:rgba(49,153,101,.10); color:#80d9aa; }
        .brain-fields { display:grid; gap:10px; padding:16px 18px; }
        .brain-field { display:grid; grid-template-columns:190px minmax(0,1fr); align-items:center; gap:20px; min-height:48px; }
        .brain-field label strong { display:block; font-size:12px; }
        .brain-field label small { display:block; margin-top:4px; color:#77879f; font-size:10px; line-height:1.4; }
        .brain-input,.brain-select { width:100%; height:36px; padding:0 11px; border:1px solid #3d4960; border-radius:9px; color:#dcecff; background:#202a3d; outline:none; font:inherit; }
        .brain-input:focus,.brain-select:focus { border-color:rgba(88,173,245,.72); box-shadow:0 0 0 1px rgba(88,173,245,.18); }
        .brain-input::placeholder { color:#5f6d82; }
        .brain-switch { width:42px; height:23px; padding:2px; border:1px solid #3d4960; border-radius:999px; background:#252e40; cursor:pointer; }
        .brain-switch span { display:block; width:17px; height:17px; border-radius:50%; background:#8490a3; transition:.18s ease; }
        .brain-switch.on { border-color:rgba(98,190,255,.55); background:rgba(63,143,217,.32); }
        .brain-switch.on span { transform:translateX(17px); background:#8fe5ff; box-shadow:0 0 9px rgba(104,211,255,.6); }
        .brain-switch:disabled { opacity:.45; cursor:default; }
        .brain-range-control { display:grid; grid-template-columns:minmax(0,1fr) 52px; align-items:center; gap:12px; }
        .brain-range { width:100%; accent-color:#58adf5; }
        .brain-range:disabled { opacity:.45; }
        .brain-range-value { color:#9bc8ff; font-size:12px; font-weight:700; text-align:right; }
        .brain-actions { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 18px 18px; }
        .brain-actions > div { display:flex; gap:9px; flex-wrap:wrap; }
        .brain-note { padding:13px 15px; margin:0 18px 18px; border:1px solid rgba(102,215,232,.16); border-radius:11px; background:rgba(47,105,126,.08); color:#91a7ba; font-size:11px; line-height:1.65; }
        .brain-result { padding:13px 15px; margin:0 18px 18px; border:1px solid rgba(85,214,138,.18); border-radius:11px; background:rgba(49,153,101,.08); color:#9bd9b8; font-size:11px; }
        .brain-danger { border-color:rgba(255,113,113,.24)!important; color:#ffb2b2!important; background:rgba(198,63,63,.06)!important; }
        @media (max-width:820px) { .brain-field { grid-template-columns:1fr; gap:7px; } .brain-actions { align-items:flex-start; flex-direction:column; } }
      `}</style>

      <div className="brain-header">
        <span>Pet Brain</span>
        <h1>自主</h1>
        <p>本地 Utility Planner 拥有最终决定权。这里配置角色的自主行为倾向；AI 只提供高层 Goal 建议，不直接控制动画或坐标。</p>
      </div>

      <div className="brain-card">
        <div className="brain-card-head">
          <div>
            <span className="brain-kicker">Core</span>
            <h3>自主行为核心</h3>
            <p>Blackboard → Utility Planner → Action Plan → Priority Executor</p>
          </div>
          <span className="brain-badge live">本地运行</span>
        </div>
        {behaviorSettings && (
          <div className="brain-fields">
            <div className="brain-field">
              <label><strong>自主移动</strong><small>允许 Pet Brain 主动选择漫步或窗口探索。</small></label>
              <button
                className={`brain-switch ${behaviorSettings.autonomousMovement ? "on" : ""}`}
                role="switch"
                aria-checked={behaviorSettings.autonomousMovement}
                disabled={behaviorBusy}
                onClick={() => void updateBehaviorSettings({ autonomousMovement: !behaviorSettings.autonomousMovement })}
              ><span /></button>
            </div>
            <div className="brain-field">
              <label><strong>漫步倾向</strong><small>影响 wander Goal 的 Utility 权重，不是固定触发概率。</small></label>
              <div className="brain-range-control">
                <input
                  className="brain-range"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={behaviorSettings.wanderWeight}
                  disabled={behaviorBusy}
                  onChange={(event) => setBehaviorSettings((current) => current ? { ...current, wanderWeight: Number(event.target.value) } : current)}
                  onPointerUp={(event) => void updateBehaviorSettings({ wanderWeight: Number(event.currentTarget.value) })}
                />
                <span className="brain-range-value">{Math.round(behaviorSettings.wanderWeight * 100)}%</span>
              </div>
            </div>
            <div className="brain-field">
              <label><strong>窗口探索倾向</strong><small>{behaviorSettings.windowDocking ? "独立影响 dock Goal 的 Utility 权重。" : "宠物页的“窗口停靠”已关闭，因此当前不会参与规划。"}</small></label>
              <div className="brain-range-control">
                <input
                  className="brain-range"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={behaviorSettings.dockWeight}
                  disabled={behaviorBusy || !behaviorSettings.windowDocking}
                  onChange={(event) => setBehaviorSettings((current) => current ? { ...current, dockWeight: Number(event.target.value) } : current)}
                  onPointerUp={(event) => void updateBehaviorSettings({ dockWeight: Number(event.currentTarget.value) })}
                />
                <span className="brain-range-value">{Math.round(behaviorSettings.dockWeight * 100)}%</span>
              </div>
            </div>
          </div>
        )}
        <div className="brain-note">权重只改变 Planner 的行为倾向。即使漫步倾向设为 100%，用户互动、Agent 状态、能量、冷却和更高优先级 Intent 仍可让其他 Goal 胜出。</div>
      </div>

      <div className="brain-card">
        <div className="brain-card-head">
          <div>
            <span className="brain-kicker">AI Adviser · v1</span>
            <h3>OpenAI-compatible 行为建议</h3>
            <p>事件触发 + 冷却时间。AI 建议优先级最高 0.82，低于用户和系统行为。</p>
          </div>
          <span className={`brain-badge ${aiSettings?.enabled ? "live" : ""}`}>{aiSettings?.enabled ? "已启用" : "未启用"}</span>
        </div>

        <div className="brain-fields">
          <div className="brain-field">
            <label><strong>启用 AI 建议</strong><small>关闭后不会发起任何 Provider 请求。</small></label>
            <button className={`brain-switch ${form.enabled ? "on" : ""}`} role="switch" aria-checked={form.enabled} disabled={busy} onClick={() => setForm((current) => ({ ...current, enabled: !current.enabled }))}><span /></button>
          </div>
          <div className="brain-field">
            <label><strong>API 地址</strong><small>填写 OpenAI-compatible 的 /v1 基础地址。</small></label>
            <input className="brain-input" value={form.baseUrl} disabled={busy} placeholder="https://provider.example/v1" onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} />
          </div>
          <div className="brain-field">
            <label><strong>模型</strong><small>由你的 Provider 提供，例如其模型 ID。</small></label>
            <input className="brain-input" value={form.model} disabled={busy} placeholder="model-name" onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} />
          </div>
          <div className="brain-field">
            <label><strong>API Key</strong><small>{aiSettings?.hasApiKey ? "已保存在 Windows Credential Manager；留空保持不变。" : "云端 Provider 通常需要；无密钥的本地模型可留空。"}</small></label>
            <input className="brain-input" type="password" autoComplete="off" value={form.apiKey} disabled={busy} placeholder={aiSettings?.hasApiKey ? "已保存 · 输入新值可替换" : "可选"} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} />
          </div>
          <div className="brain-field">
            <label><strong>最短建议间隔</strong><small>后端还会强制冷却，避免状态频繁变化导致连续请求。</small></label>
            <select className="brain-select" value={form.cooldownSeconds} disabled={busy} onChange={(event) => setForm((current) => ({ ...current, cooldownSeconds: Number(event.target.value) }))}>
              <option value="30">30 秒 · 活跃</option>
              <option value="45">45 秒 · 平衡</option>
              <option value="60">60 秒 · 保守</option>
              <option value="120">120 秒 · 很少</option>
            </select>
          </div>
          <div className="brain-field">
            <label><strong>请求超时</strong><small>超时或失败不会影响本地自主行为。</small></label>
            <select className="brain-select" value={form.timeoutSeconds} disabled={busy} onChange={(event) => setForm((current) => ({ ...current, timeoutSeconds: Number(event.target.value) }))}>
              <option value="8">8 秒</option>
              <option value="12">12 秒</option>
              <option value="20">20 秒</option>
              <option value="30">30 秒</option>
            </select>
          </div>
        </div>

        {testResult && <div className="brain-result">测试建议：<strong>{goalLabel(testResult.goal)}</strong> · 置信度 {Math.round(testResult.confidence * 100)}% · TTL {testResult.ttlMs} ms</div>}
        <div className="brain-note">发送给 AI 的只有：当前 Goal、mood、energy、最近 Goal、Agent 分类状态、是否连接、用户多久未互动、点击 streak，以及是否允许自主移动/窗口停靠。</div>
        <div className="brain-actions">
          <span className="brain-badge">{aiSettings?.configured ? "Provider 已配置" : "等待配置"}</span>
          <div>
            {aiSettings?.hasApiKey && <button className="secondary brain-danger" disabled={busy || testing} onClick={() => void save(true)}>清除密钥</button>}
            <button className="secondary" disabled={busy || testing} onClick={() => void save(false)}>{busy ? "保存中…" : "保存"}</button>
            <button className="primary" disabled={busy || testing} onClick={() => void testProvider()}>{testing ? "测试中…" : "测试 AI"}</button>
          </div>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </section>,
    host,
  );
}

function goalLabel(goal: string) {
  switch (goal) {
    case "idle": return "空闲";
    case "wander": return "漫步";
    case "dock": return "窗口停靠";
    case "respond-user": return "回应用户";
    case "observe-agent": return "观察 Agent";
    case "celebrate": return "庆祝";
    case "rest": return "休息";
    default: return goal;
  }
}
