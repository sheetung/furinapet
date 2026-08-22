import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { checkForUpdates, desktop, type UpdateResult } from "./api";
import {
  characterRegistry,
  getCharacter,
  importCharacterFolder,
  installOnlineCharacter,
  loadCharacterRegistry,
  loadOnlineCharacters,
  type CharacterDefinition,
} from "./characters/registry";
import type { AppSettings, DashboardSnapshot, Reaction, SettingsPatch } from "./types";

type Page = "home" | "pet" | "settings";
type DownloadProgress = { downloaded: number; total: number; percent: number };
type CharacterManagerView = "sources" | "online";

const defaultSettings: AppSettings = {
  selectedCharacterId: "furina",
  petVisible: true,
  alwaysOnTop: true,
  launchAtLogin: false,
  scale: 1,
  lookAtCursor: true,
  autoWander: false,
  wanderProbability: 1,
  wanderSpeed: 1,
  gravityEnabled: true,
  reducedMotion: false,
};

const reactions: readonly { id: Reaction; label: string; icon: string }[] = [
  { id: "waving", label: "挥手", icon: "👋" },
  { id: "jumping", label: "开心", icon: "✨" },
  { id: "review", label: "思考", icon: "🔍" },
  { id: "waiting", label: "等待", icon: "⏳" },
  { id: "failed", label: "沮丧", icon: "💧" },
];

export function App() {
  const [page, setPage] = useState<Page>("home");
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [update, setUpdate] = useState<UpdateResult | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [characterManagerOpen, setCharacterManagerOpen] = useState(false);
  const [characterManagerView, setCharacterManagerView] = useState<CharacterManagerView>("sources");
  const [characters, setCharacters] = useState<CharacterDefinition[]>(characterRegistry);
  const [onlineCharacters, setOnlineCharacters] = useState<CharacterDefinition[]>([]);
  const [characterBusy, setCharacterBusy] = useState(false);
  const localCharacterInput = useRef<HTMLInputElement | null>(null);
  const version = dashboard?.version ?? "1.0.6";
  const activeCharacter = getCharacter(settings.selectedCharacterId, characters);

  useEffect(() => {
    void loadCharacterRegistry()
      .then(setCharacters)
      .catch((error) => showToast(`角色加载失败：${String(error)}`));
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    Promise.all([desktop.getSettings(), desktop.getDashboard()])
      .then(([nextSettings, nextDashboard]) => {
        setSettings(nextSettings);
        setDashboard(nextDashboard);
        window.setTimeout(() => void runUpdateCheck(nextDashboard.version, true), 900);
      })
      .catch((error) => showToast(`加载失败：${String(error)}`));
    const cleanup = listen<AppSettings>("settings-changed", (event) => setSettings(event.payload));
    return () => { void cleanup.then((unlisten) => unlisten()); };
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const cleanup = listen<DownloadProgress>("update-download-progress", (event) => setDownloadProgress(event.payload));
    return () => { void cleanup.then((unlisten) => unlisten()); };
  }, []);

  const statusText = useMemo(() => settings.petVisible ? "正在陪伴" : "暂时休息", [settings.petVisible]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function updateSettings(patch: SettingsPatch) {
    setBusy(true);
    try {
      const next = await desktop.updateSettings(patch);
      setSettings(next);
    } catch (error) {
      showToast(`保存失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function togglePet() {
    const next = await desktop.togglePet();
    setSettings(next);
    showToast(next.petVisible ? `${activeCharacter.name}已回到桌面` : `${activeCharacter.name}暂时隐藏了`);
  }

  async function react(reaction: Reaction, message: string) {
    if (!settings.petVisible) await desktop.showPet();
    await desktop.react(reaction, message);
    setSettings((current) => ({ ...current, petVisible: true }));
  }

  async function runUpdateCheck(currentVersion = version, automatic = false) {
    setUpdateChecking(true);
    const result = await checkForUpdates(currentVersion);
    setUpdate(result);
    setUpdateChecking(false);
    if (result.state === "available" && result.latestVersion) {
      const skipped = localStorage.getItem("furinapet.skippedUpdate");
      if (!automatic || skipped !== result.latestVersion) {
        setUpdateOpen(true);
        if (automatic) void desktop.showControlCenter();
      }
    } else if (!automatic) {
      showToast(result.message);
    }
  }

  async function installUpdate() {
    if (!update?.latestVersion || !update.sha256) return;
    setUpdateInstalling(true);
    setDownloadProgress({ downloaded: 0, total: update.size ?? 0, percent: 0 });
    try {
      await desktop.downloadAndInstallUpdate(update.latestVersion, update.sha256);
    } catch (error) {
      setUpdateInstalling(false);
      showToast(`更新失败：${String(error)}`);
    }
  }

  function skipUpdate() {
    if (update?.latestVersion) localStorage.setItem("furinapet.skippedUpdate", update.latestVersion);
    setUpdateOpen(false);
  }

  function openManualDownload() {
    if (update?.downloadUrl) void desktop.openDownload(update.downloadUrl);
    else void desktop.openReleases();
  }

  function openCharacterManager() {
    setCharacterManagerView("sources");
    setCharacterManagerOpen(true);
  }

  async function showOnlineCharacters() {
    setCharacterBusy(true);
    setCharacterManagerView("online");
    try {
      setOnlineCharacters(await loadOnlineCharacters());
    } catch (error) {
      showToast(`在线角色加载失败：${String(error)}`);
    } finally {
      setCharacterBusy(false);
    }
  }

  async function handleLocalCharacterFiles(files: FileList | null) {
    if (!files?.length) return;
    setCharacterBusy(true);
    try {
      const manifest = await importCharacterFolder(files);
      const nextCharacters = await loadCharacterRegistry();
      setCharacters(nextCharacters);
      await updateSettings({ selectedCharacterId: manifest.id });
      setCharacterManagerOpen(false);
      showToast(`${manifest.name}已导入并切换`);
    } catch (error) {
      showToast(`导入失败：${String(error)}`);
    } finally {
      setCharacterBusy(false);
      if (localCharacterInput.current) localCharacterInput.current.value = "";
    }
  }

  async function installOnline(character: CharacterDefinition) {
    setCharacterBusy(true);
    try {
      const manifest = await installOnlineCharacter(character);
      const nextCharacters = await loadCharacterRegistry();
      setCharacters(nextCharacters);
      await updateSettings({ selectedCharacterId: manifest.id });
      showToast(`${manifest.name}已安装并切换`);
    } catch (error) {
      showToast(`安装失败：${String(error)}`);
    } finally {
      setCharacterBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-brand" data-tauri-drag-region>
          <img className="brand-avatar" src="/assets/furina-app-icon.png" alt="" />
          <span>芙宁娜桌宠</span>
          <small>轻量版</small>
        </div>
        <div className="window-actions">
          <button aria-label="最小化" onClick={() => void getCurrentWindow().minimize()}>—</button>
          <button aria-label="关闭到托盘" onClick={() => void getCurrentWindow().hide()}>×</button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="pet-avatar"><img src={activeCharacter.avatarUrl} alt={activeCharacter.name} /></div>
        <div className="sidebar-name">{activeCharacter.name}</div>
        <div className={`status-pill ${settings.petVisible ? "online" : ""}`}><span />{statusText}</div>
        <nav>
          <NavButton active={page === "home"} icon="⌂" label="主页" onClick={() => setPage("home")} />
          <NavButton active={page === "pet"} icon="♢" label="宠物" onClick={() => setPage("pet")} />
          <NavButton active={page === "settings"} icon="⚙" label="设置" onClick={() => setPage("settings")} />
        </nav>
        <div className="sidebar-foot">Tauri · WebView2<br />v{version}</div>
      </aside>

      <main className="content">
        {page === "home" && (
          <section className="page">
            <PageHeader eyebrow="Bonjour" title="欢迎回来" description={`一个专注于${activeCharacter.name}的轻量桌面伴侣。`} />
            <div className="hero-card">
              <div>
                <span className="hero-kicker">当前状态</span>
                <h2>{settings.petVisible ? `${activeCharacter.name}正在舞台上` : `${activeCharacter.name}正在后台休息`}</h2>
                <p>视线、动画和漫步均在本地运行，不需要插件市场或后台服务。</p>
                <div className="button-row">
                  <button className="primary" onClick={() => void togglePet()}>{settings.petVisible ? "暂时隐藏" : `显示${activeCharacter.name}`}</button>
                  <button className="secondary" onClick={() => void react("waving", activeCharacter.reactionMessages?.waving ?? "你好呀！")}>让她打招呼</button>
                </div>
              </div>
              <img src={activeCharacter.thumbnailUrl} alt={`${activeCharacter.name}桌宠预览`} />
            </div>
            <div className="section-title"><div><span>角色</span><h3>选择桌面伙伴</h3></div><small>{characters.length} 位已发现</small></div>
            <div className="character-grid">
              {characters.map((character) => (
                <button
                  key={character.id}
                  className={`character-card ${character.id === activeCharacter.id ? "active" : ""}`}
                  disabled={busy}
                  onClick={() => void updateSettings({ selectedCharacterId: character.id })}
                >
                  <img src={character.avatarUrl} alt="" />
                  <strong>{character.name}</strong>
                  <i>{character.id === activeCharacter.id ? "使用中" : "点击切换"}</i>
                </button>
              ))}
              <button className="character-card add-character" onClick={openCharacterManager}>
                <span>＋</span>
                <strong>添加角色</strong>
                <i>在线安装或导入</i>
              </button>
            </div>
            <div className="section-title"><div><span>快捷互动</span><h3>今天想看什么？</h3></div></div>
            <div className="reaction-grid">
              {reactions.map((item) => (
                <button key={item.id} className="reaction-card" onClick={() => void react(item.id, activeCharacter.reactionMessages?.[item.id] ?? "")}>
                  <span>{item.icon}</span><strong>{item.label}</strong>
                </button>
              ))}
            </div>
          </section>
        )}

        {page === "pet" && (
          <section className="page">
            <PageHeader eyebrow="Companion" title="宠物" description="所有角色共享一套可靠的 v2 动画契约。" />
            <div className="pet-profile card">
              <img src={activeCharacter.thumbnailUrl} alt={activeCharacter.name} />
              <div><span className="tag">已注册 · v2</span><h2>{activeCharacter.name}</h2><p>{activeCharacter.description} 11 行、8 列图集，包含 9 种基础动画和 16 个顺时针视线方向。</p></div>
            </div>
            <div className="settings-list">
              <SettingRow title="显示桌宠" description={`在桌面显示或隐藏${activeCharacter.name}。`}><Switch checked={settings.petVisible} disabled={busy} onChange={(value) => void updateSettings({ petVisible: value })} /></SettingRow>
              <SettingRow title="视线跟随" description="空闲时看向全局鼠标位置。"><Switch checked={settings.lookAtCursor} disabled={busy} onChange={(value) => void updateSettings({ lookAtCursor: value })} /></SettingRow>
              <SettingRow title="自动漫步" description="按设定概率在当前显示器内开始一次漫步。"><Switch checked={settings.autoWander} disabled={busy || settings.reducedMotion} onChange={(value) => void updateSettings({ autoWander: value })} /></SettingRow>
              <SettingRow title="漫步概率" description="每次漫步机会实际出发的概率。">
                <select className="select" value={settings.wanderProbability} disabled={busy || !settings.autoWander} onChange={(event) => void updateSettings({ wanderProbability: Number(event.target.value) })}>
                  <option value="0.25">偶尔 · 25%</option>
                  <option value="0.5">适中 · 50%</option>
                  <option value="0.75">经常 · 75%</option>
                  <option value="1">总是 · 100%</option>
                </select>
              </SettingRow>
              <SettingRow title="重力落地" description="拖动松手后自然落到当前屏幕底部，漫步时保持贴地。"><Switch checked={settings.gravityEnabled} disabled={busy} onChange={(value) => void updateSettings({ gravityEnabled: value })} /></SettingRow>
              <SettingRow title="宠物大小" description={`${Math.round(settings.scale * 100)}%`} wide>
                <input className="range" type="range" min="0.65" max="1.5" step="0.05" value={settings.scale} onChange={(event) => setSettings((current) => ({ ...current, scale: Number(event.target.value) }))} onPointerUp={(event) => void updateSettings({ scale: Number(event.currentTarget.value) })} />
              </SettingRow>
              <SettingRow title="漫步速度" description={`${Math.round(settings.wanderSpeed * 100)}%`} wide>
                <input className="range" type="range" min="0.6" max="1.8" step="0.1" value={settings.wanderSpeed} disabled={!settings.autoWander} onChange={(event) => setSettings((current) => ({ ...current, wanderSpeed: Number(event.target.value) }))} onPointerUp={(event) => void updateSettings({ wanderSpeed: Number(event.currentTarget.value) })} />
              </SettingRow>
            </div>
            <button className="secondary" onClick={() => void desktop.resetPetPosition().then(() => showToast("已重置到主屏幕右下角"))}>重置桌宠位置</button>
          </section>
        )}

        {page === "settings" && (
          <section className="page">
            <PageHeader eyebrow="Preferences" title="设置" description="没有插件权限、账户或远程服务，只有必要的桌面选项。" />
            <div className="settings-list">
              <SettingRow title="始终置顶" description={`让${activeCharacter.name}保持在普通窗口上方。`}><Switch checked={settings.alwaysOnTop} disabled={busy} onChange={(value) => void updateSettings({ alwaysOnTop: value })} /></SettingRow>
              <SettingRow title="开机自动启动" description="登录 Windows 后在托盘启动，不弹出终端。"><Switch checked={settings.launchAtLogin} disabled={busy} onChange={(value) => void updateSettings({ launchAtLogin: value })} /></SettingRow>
              <SettingRow title="减少动态效果" description="停止自动漫步，保留必要的角色动画。"><Switch checked={settings.reducedMotion} disabled={busy} onChange={(value) => void updateSettings({ reducedMotion: value, autoWander: value ? false : settings.autoWander })} /></SettingRow>
            </div>
            <div className="update-card card">
              <div><span className="tag">更新</span><h3>版本 {version}</h3><p>{update?.message ?? "从 GitHub Releases 检查新版本。"}</p></div>
              <div className="button-row">
                <button className="secondary" disabled={busy || updateChecking} onClick={() => void runUpdateCheck()}>{updateChecking ? "检查中…" : "检查更新"}</button>
                {update?.state === "available" && <button className="primary" onClick={() => setUpdateOpen(true)}>查看新版本</button>}
              </div>
            </div>
          </section>
        )}
      </main>
      {toast && <div className="toast">{toast}</div>}
      {updateOpen && update?.state === "available" && (
        <div className="update-overlay" role="dialog" aria-modal="true" aria-labelledby="update-title">
          <div className="update-dialog">
            <header>
              <div><img src="/assets/furina-app-icon.png" alt="" /><strong id="update-title">发现新版本 {update.latestVersion}</strong></div>
              <button aria-label="关闭" disabled={updateInstalling} onClick={() => setUpdateOpen(false)}>×</button>
            </header>
            <div className="update-body">
              <span className="update-badge">NEW UPDATE</span>
              <h2>{update.title ?? `furinapet v${update.latestVersion}`}</h2>
              <p>新版本已经准备好，可以自动下载安装，也可以前往 GitHub 手动下载。</p>
              <div className="release-notes">
                <strong>本次更新</strong>
                <ul>{(update.notes.length ? update.notes : ["稳定性与体验改进"]).map((note) => <li key={note}>{note}</li>)}</ul>
              </div>
              <div className="update-source">
                <span>↓</span>
                <div><strong>GitHub Releases</strong><small>官方发布渠道 · SHA-256 完整性校验{update.size ? ` · ${formatBytes(update.size)}` : ""}</small></div>
              </div>
              {updateInstalling && (
                <div className="download-status">
                  <div><span>正在下载安装程序…</span><strong>{downloadProgress?.percent ?? 0}%</strong></div>
                  <div className="progress-track"><i style={{ width: `${downloadProgress?.percent ?? 0}%` }} /></div>
                  <small>{formatBytes(downloadProgress?.downloaded ?? 0)} / {formatBytes(downloadProgress?.total || update.size || 0)}</small>
                </div>
              )}
            </div>
            <footer>
              <button className="manual-download" disabled={updateInstalling} onClick={openManualDownload}>◎ 手动下载</button>
              <div>
                <button className="secondary" disabled={updateInstalling} onClick={skipUpdate}>本版本不再提示</button>
                <button className="secondary" disabled={updateInstalling} onClick={() => setUpdateOpen(false)}>取消</button>
                <button className="primary" disabled={updateInstalling} onClick={() => void installUpdate()}>{updateInstalling ? "正在更新…" : "↓ 立即更新"}</button>
              </div>
            </footer>
          </div>
        </div>
      )}
      {characterManagerOpen && (
        <div className="update-overlay" role="dialog" aria-modal="true" aria-labelledby="character-manager-title">
          <div className="character-dialog">
            <header>
              <div><img src="/assets/furina-app-icon.png" alt="" /><strong id="character-manager-title">添加桌面角色</strong></div>
              <button aria-label="关闭" onClick={() => setCharacterManagerOpen(false)}>×</button>
            </header>
            <div className="character-dialog-body">
              {characterManagerView === "sources" ? (
                <>
                  <h2>选择添加方式</h2>
                  <p>角色包保持独立的 v2 结构，不会修改桌宠运动内核。</p>
                  <div className="character-source-grid">
                    <button disabled={characterBusy} onClick={() => void showOnlineCharacters()}>
                      <span>◎</span><strong>在线安装</strong><small>从 GitHub 角色库选择并安装</small><i>GitHub</i>
                    </button>
                    <button disabled={characterBusy} onClick={() => localCharacterInput.current?.click()}>
                      <span>⇧</span><strong>本地导入</strong><small>选择包含完整 v2 资源的文件夹</small><i>选择文件夹</i>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2>在线角色</h2>
                  <p>角色从 GitHub 下载到本机，不会增加 furinapet 安装包体积。</p>
                  {characterBusy && onlineCharacters.length === 0 ? (
                    <div className="character-empty">正在读取在线角色库…</div>
                  ) : onlineCharacters.length === 0 ? (
                    <div className="character-empty">暂无可安装角色。在工程的 online-characters 目录添加后会显示在这里。</div>
                  ) : (
                    <div className="online-character-list">
                      {onlineCharacters.map((character) => {
                        const installed = characters.some((item) => item.id === character.id);
                        return (
                          <div key={character.id} className="online-character-item">
                            <img src={character.avatarUrl} alt="" />
                            <div><strong>{character.name}</strong><small>{character.description}</small></div>
                            <button className={installed ? "secondary" : "primary"} disabled={installed || characterBusy} onClick={() => void installOnline(character)}>{installed ? "已安装" : "安装"}</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              <input
                ref={(node) => {
                  localCharacterInput.current = node;
                  if (node) node.setAttribute("webkitdirectory", "");
                }}
                className="character-folder-input"
                type="file"
                multiple
                onChange={(event) => void handleLocalCharacterFiles(event.currentTarget.files)}
              />
            </div>
            <footer>
              {characterManagerView === "online" && <button className="secondary" disabled={characterBusy} onClick={() => setCharacterManagerView("sources")}>返回</button>}
              <button className="secondary" disabled={characterBusy} onClick={() => setCharacterManagerOpen(false)}>完成</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}</span>{label}</button>;
}

function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-header"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>;
}

function SettingRow({ title, description, children, wide = false }: { title: string; description: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={`setting-row ${wide ? "wide" : ""}`}><div><strong>{title}</strong><p>{description}</p></div><div className="setting-control">{children}</div></div>;
}

function Switch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <button role="switch" aria-checked={checked} disabled={disabled} className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span /></button>;
}
