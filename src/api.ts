import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { WorkArea, WindowSurface } from "./core/wander-controller";
import type { AppSettings, DashboardSnapshot, Reaction, SettingsPatch } from "./types";

const releasesUrl = "https://github.com/sheetung/furinapet/releases";

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
