import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AppSettings, DashboardSnapshot, Reaction, SettingsPatch } from "./types";

const releasesUrl = "https://github.com/sheetung/furinapet/releases";
const latestReleaseApi = "https://api.github.com/repos/sheetung/furinapet/releases/latest";

export const desktop = {
  getSettings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (patch: SettingsPatch) => invoke<AppSettings>("update_settings", { patch }),
  getDashboard: () => invoke<DashboardSnapshot>("get_dashboard"),
  showPet: () => invoke<AppSettings>("set_pet_visible", { visible: true }),
  hidePet: () => invoke<AppSettings>("set_pet_visible", { visible: false }),
  togglePet: () => invoke<AppSettings>("toggle_pet"),
  resetPetPosition: () => invoke<void>("reset_pet_position"),
  react: (reaction: Reaction, message?: string) => invoke<void>("trigger_reaction", { reaction, message }),
  showControlCenter: () => invoke<void>("show_control_center"),
  quit: () => invoke<void>("quit_app"),
  openReleases: () => openUrl(releasesUrl),
};

export interface UpdateResult {
  state: "current" | "available" | "error";
  currentVersion: string;
  latestVersion?: string;
  message: string;
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateResult> {
  try {
    const response = await fetch(latestReleaseApi, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = await response.json() as { tag_name?: string };
    const latestVersion = String(release.tag_name ?? "").replace(/^v/, "");
    if (!latestVersion) throw new Error("发布版本号无效");
    const available = compareVersions(latestVersion, currentVersion) > 0;
    return {
      state: available ? "available" : "current",
      currentVersion,
      latestVersion,
      message: available ? `发现新版本 ${latestVersion}` : "当前已是最新版本",
    };
  } catch (error) {
    return { state: "error", currentVersion, message: `检查失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

function compareVersions(left: string, right: string): number {
  const a = left.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}
