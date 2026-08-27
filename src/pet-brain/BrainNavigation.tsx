import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { createPortal } from "react-dom";
import { desktop, type AiBehaviorSuggestion, type AiSettingsSnapshot } from "../api";
import type { AppSettings, SettingsPatch } from "../types";
import {
  PET_BRAIN_SNAPSHOT_EVENT,
  PET_BRAIN_SNAPSHOT_REQUEST_EVENT,
} from "./runtime";
import type { AiSuggestionTrace, PetBrainSnapshot, PetSemanticAction } from "./types";

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
  const [brainSnapshot, setBrainSnapshot] = useState<PetBrainSnapshot | null>(null);
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
    if (!active || !("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let stopListening: (() => void) | null = null;

    void listen<PetBrainSnapshot>(PET_BRAIN_SNAPSHOT_EVENT, (event) => {
      if (!disposed) setBrainSnapshot(event.payload);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopListening = unlisten;
    }).catch((error) => console.warn("[brain-inspector] snapshot listener failed", error));

    const requestSnapshot = () => {
      void emit(PET_BRAIN_SNAPSHOT_REQUEST_EVENT).catch((error) => {
        console.warn("[brain-inspector] snapshot request failed", error);
      });
    };
    requestSnapshot();
    const timer = window.setInterval(requestSnapshot, 1000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      stopListening?.();
    };
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

  const decision = brainSnapshot?.lastDecision ?? null;
  const executor = brainSnapshot?.executor;
  const topScore = decision?.candidates[0]?.score ?? 1;

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
        .brain-badge.warn { border-color:rgba(255,196,104,.28); background:rgba(181,121,40,.10); color:#f2c879; }
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
        .brain-inspector { padding:16px 18px 18px; }
        .brain-live-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:8px; }
        .brain-live-stat { min-width:0; padding:11px; border:1px solid rgba(164,190,228,.10); border-radius:11px; background:rgba(15,22,36,.38); }
        .brain-live-stat small { display:block; margin-bottom:5px; color:#71829a; font-size:9px; }
        .brain-live-stat strong { display:block; overflow:hidden; color:#dcecff; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
        .brain-energy-track { height:5px; margin-top:7px; overflow:hidden; border-radius:99px; background:#283248; }
        .brain-energy-track i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#65c2f2,#83e3c0); }
        .brain-inspector-grid { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(250px,.9fr); gap:12px; margin-top:12px; }
        .brain-panel { padding:13px; border:1px solid rgba(164,190,228,.10); border-radius:12px; background:rgba(15,22,36,.30); }
        .brain-panel-title { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; }
        .brain-panel-title strong { font-size:11px; }
        .brain-panel-title small { color:#71829a; font-size:9px; }
        .brain-score-list { display:grid; gap:8px; }
        .brain-score-row { display:grid; grid-template-columns:108px minmax(0,1fr) 40px; align-items:center; gap:8px; }
        .brain-score-name { overflow:hidden; color:#9fb0c7; font-size:10px; text-overflow:ellipsis; white-space:nowrap; }
        .brain-score-name.winner { color:#91e1ff; font-weight:800; }
        .brain-score-track { height:7px; overflow:hidden; border-radius:99px; background:#273146; }
        .brain-score-track i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#598edd,#72d4e8); }
        .brain-score-value { color:#9bc8ff; font-size:9px; font-variant-numeric:tabular-nums; text-align:right; }
        .brain-decision-reason { margin:10px 0 0; color:#8294ad; font-size:10px; line-height:1.55; }
        .brain-action-flow { display:flex; gap:6px; flex-wrap:wrap; }
        .brain-action-chip { padding:5px 7px; border:1px solid rgba(102,215,232,.16); border-radius:8px; color:#a8c7d6; background:rgba(63,134,153,.08); font-size:9px; }
        .brain-ai-traces { display:grid; gap:7px; margin-top:12px; }
        .brain-ai-trace { display:grid; grid-template-columns:68px minmax(0,1fr) auto; align-items:center; gap:9px; padding:9px 10px; border:1px solid rgba(164,190,228,.09); border-radius:10px; background:rgba(15,22,36,.26); }
        .brain-ai-trace time { color:#687991; font-size:9px; }
        .brain-ai-trace div strong { display:block; font-size:10px; }
        .brain-ai-trace div small { display:block; margin-top:3px; overflow:hidden; color:#7e8ea5; font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
        .brain-ai-status { font-size:9px; font-weight:800; }
        .brain-ai-status.accepted { color:#83dbab; }
        .brain-ai-status.pending { color:#f0c878; }
        .brain-ai-status.rejected { color:#a1adbf; }
        .brain-empty { padding:18px 0; color:#71829a; font-size:10px; text-align:center; }
        @media (max-width:980px) { .brain-live-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .brain-inspector-grid { grid-template-columns:1fr; } }
        @media (max-width:820px) { .brain-field { grid-template-columns:1fr; gap:7px; } .brain-actions { align-items:flex-start; flex-direction:column; } .brain-live-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
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
              <label><strong>自主移动</strong><small>允许 Pet Brain 主动选择当前运动模式下可用的行为。</small></label>
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
              <label><strong>窗口探索倾向</strong><small>{behaviorSettings.gravityEnabled ? "重力落地开启时窗口停靠会自动关闭，因此该权重不参与规划。" : behaviorSettings.windowDocking ? "独立影响 dock Goal 的 Utility 权重。" : "宠物页的“窗口停靠”已关闭，因此当前不会参与规划。"}</small></label>
              <div className="brain-range-control">
                <input
                  className="brain-range"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={behaviorSettings.dockWeight}
                  disabled={behaviorBusy || behaviorSettings.gravityEnabled || !behaviorSettings.windowDocking}
                  onChange={(event) => setBehaviorSettings((current) => current ? { ...current, dockWeight: Number(event.target.value) } : current)}
                  onPointerUp={(event) => void updateBehaviorSettings({ dockWeight: Number(event.currentTarget.value) })}
                />
                <span className="brain-range-value">{Math.round(behaviorSettings.dockWeight * 100)}%</span>
              </div>
            </div>
          </div>
        )}
        <div className="brain-note">重力落地与窗口停靠互斥：重力模式使用 Windows 工作区底边（任务栏上沿）作为唯一地面，普通漫步只沿 X 轴；开启窗口停靠会自动关闭重力，才允许二维接近窗口。</div>
      </div>

      <div className="brain-card">
        <div className="brain-card-head">
          <div>
            <span className="brain-kicker">Decision Inspector</span>
            <h3>自主决策实时面板</h3>
            <p>直接读取宠物 WebView 中正在运行的 Pet Brain，而不是控制中心的副本。</p>
          </div>
          <span className={`brain-badge ${brainSnapshot ? "live" : "warn"}`}>{brainSnapshot ? "实时" : "等待桌宠"}</span>
        </div>
        <div className="brain-inspector">
          {brainSnapshot ? (
            <>
              <div className="brain-live-grid">
                <LiveStat label="当前 Goal" value={goalLabel(brainSnapshot.currentGoal)} />
                <LiveStat label="Mood" value={moodLabel(brainSnapshot.mood)} />
                <div className="brain-live-stat"><small>Energy</small><strong>{Math.round(brainSnapshot.energy * 100)}%</strong><div className="brain-energy-track"><i style={{ width: `${Math.round(brainSnapshot.energy * 100)}%` }} /></div></div>
                <LiveStat label="Agent" value={agentStateLabel(brainSnapshot.agentState)} />
                <LiveStat label="Executor" value={executor?.running ? `${goalLabel(executor.goal ?? "idle")} · #${executor.actionIndex + 1}` : "空闲"} />
                <LiveStat label="Pending Intent" value={String(brainSnapshot.pendingIntentCount)} />
              </div>

              <div className="brain-inspector-grid">
                <div className="brain-panel">
                  <div className="brain-panel-title"><strong>Planner 评分</strong><small>{decision ? `${relativeTime(decision.at)}更新` : "暂无决策"}</small></div>
                  {decision?.candidates.length ? (
                    <div className="brain-score-list">
                      {decision.candidates.map((candidate) => (
                        <div className="brain-score-row" key={candidate.goal} title={candidate.reason}>
                          <span className={`brain-score-name ${candidate.goal === decision.goal ? "winner" : ""}`}>{candidate.goal === decision.goal ? "● " : ""}{goalLabel(candidate.goal)}</span>
                          <span className="brain-score-track"><i style={{ width: `${Math.round((candidate.score / Math.max(0.01, topScore)) * 100)}%` }} /></span>
                          <span className="brain-score-value">{candidate.score.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <div className="brain-empty">等待下一次 Planner 决策…</div>}
                  {decision && <p className="brain-decision-reason"><strong>胜出原因：</strong>{reasonLabel(decision.reason)}</p>}
                </div>

                <div className="brain-panel">
                  <div className="brain-panel-title"><strong>当前动作计划</strong><small>{decision ? `${Math.round(decision.score * 100)}%` : "—"}</small></div>
                  {decision?.actions.length ? (
                    <div className="brain-action-flow">
                      {decision.actions.map((action, index) => <span className="brain-action-chip" key={`${action.type}-${index}`}>{actionLabel(action)}</span>)}
                    </div>
                  ) : <div className="brain-empty">暂无动作计划</div>}
                  {brainSnapshot.history.length > 0 && <p className="brain-decision-reason"><strong>最近 Goal：</strong>{brainSnapshot.history.slice(0, 5).map((item) => goalLabel(item.goal)).join(" → ")}</p>}
                </div>
              </div>

              <div className="brain-panel" style={{ marginTop: 12 }}>
                <div className="brain-panel-title"><strong>最近 AI 建议</strong><small>最多保留 8 条</small></div>
                {brainSnapshot.aiSuggestions.length ? (
                  <div className="brain-ai-traces">
                    {brainSnapshot.aiSuggestions.map((trace) => <AiTraceRow key={trace.id} trace={trace} />)}
                  </div>
                ) : <div className="brain-empty">运行中的 AI Adviser 还没有产生建议。</div>}
              </div>

              {brainSnapshot.character && (
                <div className="brain-panel" style={{ marginTop: 12 }}>
                  <div className="brain-panel-title">
                    <strong>情绪状态 · Neuro</strong>
                    <small>{`arousal ${Math.round(brainSnapshot.character.arousal * 100)}% · 注意力 ${attentionLabel(brainSnapshot.character.attention.target)} ${Math.round(brainSnapshot.character.attention.strength * 100)}% · 派生 ${moodLabel(brainSnapshot.character.derivedMood)}`}</small>
                  </div>
                  <div className="brain-score-list">
                    {EMOTION_LABELS.map(({ key, label }) => {
                      const value = brainSnapshot.character!.emotion[key];
                      return (
                        <div className="brain-score-row" key={key}>
                          <span className="brain-score-name">{label}</span>
                          <span className="brain-score-track"><i style={{ width: `${Math.round(value * 100)}%` }} /></span>
                          <span className="brain-score-value">{value.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : <div className="brain-empty">正在请求宠物窗口的 Brain Snapshot…</div>}
        </div>
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

function LiveStat({ label, value }: { label: string; value: string }) {
  return <div className="brain-live-stat"><small>{label}</small><strong title={value}>{value}</strong></div>;
}

const EMOTION_LABELS: { key: keyof import("../neuro/contracts").EmotionState; label: string }[] = [
  { key: "happiness", label: "开心" },
  { key: "affection", label: "亲密" },
  { key: "curiosity", label: "好奇" },
  { key: "annoyance", label: "烦躁" },
  { key: "fear", label: "紧张" },
  { key: "boredom", label: "无聊" },
  { key: "sleepiness", label: "困倦" },
];

function attentionLabel(target: string) {
  const labels: Record<string, string> = { pointer: "鼠标", user: "用户", agent: "Agent", self: "自己", none: "无" };
  return labels[target] ?? target;
}

function AiTraceRow({ trace }: { trace: AiSuggestionTrace }) {
  return (
    <div className="brain-ai-trace">
      <time>{relativeTime(trace.at)}</time>
      <div><strong>AI → {goalLabel(trace.goal)} · {Math.round(trace.confidence * 100)}%</strong><small title={trace.reason}>{trace.reason}</small></div>
      <span className={`brain-ai-status ${trace.status}`}>{traceStatusLabel(trace.status)}</span>
    </div>
  );
}

function actionLabel(action: PetSemanticAction) {
  switch (action.type) {
    case "idle": return `idle${action.durationMs ? ` · ${action.durationMs}ms` : ""}`;
    case "wander": return "wander";
    case "dock": return "dock";
    case "observe": return `observe · ${action.durationMs}ms`;
    case "respond": return `respond · ${action.intensity}`;
    case "celebrate": return `celebrate · ${action.intensity}`;
    case "rest": return `rest · ${action.durationMs}ms`;
    case "wait": return `wait · ${action.durationMs}ms`;
  }
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

function moodLabel(mood: string) {
  switch (mood) {
    case "happy": return "开心";
    case "focused": return "专注";
    case "tired": return "疲惫";
    default: return "平常";
  }
}

function agentStateLabel(state: string) {
  switch (state) {
    case "thinking": return "思考中";
    case "editing": return "编辑中";
    case "testing": return "测试中";
    case "waiting": return "等待中";
    case "success": return "成功";
    case "error": return "错误";
    default: return "空闲";
  }
}

function traceStatusLabel(status: AiSuggestionTrace["status"]) {
  switch (status) {
    case "accepted": return "已采纳";
    case "rejected": return "未采纳";
    default: return "等待决策";
  }
}

function reasonLabel(reason: string) {
  return reason
    .replace("baseline calm state", "基础平静状态")
    .replace("recent user interaction", "最近有用户互动")
    .replace("repeated user interaction", "连续用户互动")
    .replace("agent error needs attention", "Agent 出错，需要关注")
    .replace("agent inactive", "Agent 当前未工作")
    .replace("agent completed work", "Agent 已完成任务")
    .replace("high user engagement", "用户互动强度较高")
    .replace("energy recovery", "恢复能量")
    .replace("autonomous exploration tendency", "自主漫步倾向")
    .replace("window exploration tendency", "窗口探索倾向")
    .replace("system intent", "系统 Intent")
    .replace("user intent", "用户 Intent")
    .replace("agent intent", "Agent Intent")
    .replace("plugin intent", "插件 Intent")
    .replace("ai intent", "AI 建议 Intent");
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 2) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
