import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { WorkArea, WindowSurface } from "./core/wander-controller";
import type { AppSettings, DashboardSnapshot, Reaction, SettingsPatch } from "./types";

const releasesUrl = "https://github.com/sheetung/furinapet/releases";

export interface PluginSnapshot {
  id: string;
  name: string;
  description: string;
  version: string;
  installedVersion?: string;
  latestVersion?: string;
  sdkVersion: string;
  minAppVersion: string;
  publisherType: string;
  installed: boolean;
  enabled: boolean;
  active: boolean;
  updateAvailable: boolean;
  configurable: boolean;
}

export interface PluginConfigOption {
  value: unknown;
  label: string;
}

export interface PluginConfigField {
  type: "boolean" | "number" | "text" | "select";
  label: string;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  options?: PluginConfigOption[];
}

export interface PluginConfigSnapshot {
  id: string;
  name: string;
  schema: Record<string, PluginConfigField>;
  values: Record<string, unknown>;
}

export interface RuntimePlugin {
  id: string;
  version: string;
  source: string;
  permissions: string[];
  config: Record<string, unknown>;
}

export type PetPluginEventName = "pet:clicked" | "pet:doubleClicked" | "pet:dragStart" | "pet:dragEnd";

export type AgentState = "idle" | "thinking" | "editing" | "testing" | "waiting" | "success" | "error";

export interface AgentConnectionSnapshot {
  sessionId: string;
  agent: string;
  clientName: string;
  clientVersion?: string;
  integration: "mcp" | "hooks" | "mcp+hooks" | "manual" | string;
  project?: string;
  state: AgentState;
  working: boolean;
  active: boolean;
  connectedAtMs: number;
  lastActivityMs: number;
  lastSeenMs: number;
}

export interface AgentStatusSnapshot {
  appRunning: boolean;
  protocolVersion: number;
  state: AgentState;
  reaction: Reaction;
  agent?: string;
  clientName?: string;
  clientVersion?: string;
  integration?: string;
  project?: string;
  sessionId?: string;
  sessionCount: number;
  connectedCount: number;
  workingCount: number;
  sessions: AgentConnectionSnapshot[];
}

export type IntegrationStatus = "installed" | "not_installed" | "needs_update" | "error" | "unavailable";

export interface ClaudeIntegrationStatus {
  claudeAvailable: boolean;
  hooksStatus: IntegrationStatus;
  mcpStatus: IntegrationStatus;
  overallStatus: IntegrationStatus;
  message: string;
}

export interface McpServerConfigPreview {
  command: string;
  args: string[];
  json: string;
  claudeCommand: string;
}

export const desktop = {
  getSettings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (patch: SettingsPatch) => invoke<AppSettings>("update_settings", { patch }),
  getDashboard: () => invoke<DashboardSnapshot>("get_dashboard"),
  showPet: () => invoke<AppSettings>("set_pet_visible", { visible: true }),
  hidePet: () => invoke<AppSettings>("set_pet_visible", { visible: false }),
  togglePet: () => invoke<AppSettings>("toggle_pet"),
  resetPetPosition: () => invoke<void>("reset_pet_position"),
  waitForDragRelease: () => invoke<void>("wait_for_drag_release"),
  getWorkAreaAt: (x: number, y: number) => invoke<WorkArea>("get_work_area_at", { x, y }),
  listDockSurfaces: () => invoke<WindowSurface[]>("list_dock_surfaces"),
  react: (reaction: Reaction, message?: string) => invoke<void>("trigger_reaction", { reaction, message }),

  getAgentStatus: () => invoke<AgentStatusSnapshot>("get_agent_status"),
  getMcpServerConfig: () => invoke<McpServerConfigPreview>("get_mcp_server_config"),
  getClaudeIntegrationStatus: () => invoke<ClaudeIntegrationStatus>("get_claude_integration_status"),
  installClaudeIntegration: () => invoke<ClaudeIntegrationStatus>("install_claude_integration"),
  uninstallClaudeIntegration: () => invoke<ClaudeIntegrationStatus>("uninstall_claude_integration"),
  testAgentIntegration: () => invoke<void>("test_agent_integration"),

  listPlugins: () => invoke<PluginSnapshot[]>("list_plugins"),
  fetchPluginCatalog: () => invoke<PluginSnapshot[]>("fetch_plugin_catalog"),
  installPlugin: (id: string) => invoke<void>("install_plugin", { id }),
  uninstallPlugin: (id: string) => invoke<void>("uninstall_plugin", { id }),
  setPluginEnabled: (id: string, enabled: boolean) => invoke<void>("set_plugin_enabled", { id, enabled }),
  getPluginConfig: (id: string) => invoke<PluginConfigSnapshot>("get_plugin_config", { id }),
  setPluginConfig: (id: string, values: Record<string, unknown>) => invoke<void>("set_plugin_config", { id, values }),
  listRuntimePlugins: () => invoke<RuntimePlugin[]>("list_runtime_plugins"),
  pluginSdkCall: (id: string, method: string, args: unknown) => invoke<unknown>("plugin_sdk_call", { id, method, args }),
  publishPetEvent: (name: PetPluginEventName) => invoke<boolean>("publish_pet_event", { name }),

  showControlCenter: () => invoke<void>("show_control_center"),
  quit: () => invoke<void>("quit_app"),
  openReleases: () => openUrl(releasesUrl),
  openDownload: (url: string) => openUrl(url),
  checkForUpdates: (currentVersion: string) => invoke<UpdateResult>("check_for_updates", { currentVersion }),
  downloadAndInstallUpdate: (version: string, sha256: string) =>
    invoke<void>("download_and_install_update", { version, sha256 }),
};

export interface UpdateResult {
  state: "current" | "available" | "error";
  currentVersion: string;
  latestVersion?: string;
  title?: string;
  notes: string[];
  downloadUrl?: string;
  sha256?: string;
  size?: number;
  message: string;
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateResult> {
  try {
    return await desktop.checkForUpdates(currentVersion);
  } catch (error) {
    return {
      state: "error",
      currentVersion,
      notes: [],
      message: `检查失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
