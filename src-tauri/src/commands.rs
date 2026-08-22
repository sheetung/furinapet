use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::{pet, settings::{self, AppState, Settings, SettingsPatch}};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    app_name: &'static str,
    version: String,
    engine: &'static str,
    feature_count: usize,
    settings: Settings,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReactionPayload {
    reaction: String,
    message: Option<String>,
    duration_ms: u64,
}

fn snapshot(state: &State<'_, AppState>) -> Result<Settings, String> {
    state.settings.lock().map(|value| value.clone()).map_err(|_| "settings lock is poisoned".into())
}

fn persist_and_apply(app: &AppHandle, state: &State<'_, AppState>, next: Settings) -> Result<Settings, String> {
    settings::save(app, &next)?;
    pet::apply_settings(app, &next)?;
    *state.settings.lock().map_err(|_| "settings lock is poisoned")? = next.clone();
    app.emit_to("pet", "settings-changed", &next).map_err(|error| error.to_string())?;
    app.emit_to("main", "settings-changed", &next).map_err(|error| error.to_string())?;
    Ok(next)
}

#[tauri::command]
pub fn get_settings(app: AppHandle, state: State<'_, AppState>) -> Result<Settings, String> {
    let mut value = snapshot(&state)?;
    if let Ok(enabled) = app.autolaunch().is_enabled() { value.launch_at_login = enabled; }
    Ok(value)
}

#[tauri::command]
pub fn get_dashboard(app: AppHandle, state: State<'_, AppState>) -> Result<DashboardSnapshot, String> {
    Ok(DashboardSnapshot {
        app_name: "芙宁娜桌宠",
        version: app.package_info().version.to_string(),
        engine: "Tauri 2 + WebView2",
        feature_count: 3,
        settings: snapshot(&state)?,
    })
}

#[tauri::command]
pub fn update_settings(app: AppHandle, state: State<'_, AppState>, patch: SettingsPatch) -> Result<Settings, String> {
    let mut next = snapshot(&state)?;
    let previous_autostart = next.launch_at_login;
    next.apply(patch)?;
    if next.launch_at_login != previous_autostart {
        if next.launch_at_login { app.autolaunch().enable() } else { app.autolaunch().disable() }.map_err(|error| error.to_string())?;
    }
    persist_and_apply(&app, &state, next)
}

pub fn set_pet_visible_inner(app: &AppHandle, visible: bool) -> Result<Settings, String> {
    let state = app.state::<AppState>();
    let mut next = snapshot(&state)?;
    next.pet_visible = visible;
    persist_and_apply(app, &state, next)
}

#[tauri::command]
pub fn set_pet_visible(app: AppHandle, visible: bool) -> Result<Settings, String> { set_pet_visible_inner(&app, visible) }

#[tauri::command]
pub fn toggle_pet(app: AppHandle) -> Result<Settings, String> {
    let state = app.state::<AppState>();
    let visible = !snapshot(&state)?.pet_visible;
    set_pet_visible_inner(&app, visible)
}

#[tauri::command]
pub fn reset_pet_position(app: AppHandle) -> Result<(), String> { pet::reset_position(&app) }

pub fn trigger_reaction_inner(app: &AppHandle, reaction: String, message: Option<String>) -> Result<(), String> {
    const ALLOWED: [&str; 7] = ["idle", "waving", "jumping", "failed", "waiting", "running", "review"];
    if !ALLOWED.contains(&reaction.as_str()) { return Err("unsupported reaction".into()); }
    let safe_message = message.map(|value| value.chars().take(160).collect::<String>()).filter(|value| !value.is_empty());
    let payload = ReactionPayload { reaction, message: safe_message, duration_ms: 2600 };
    if let Some(window) = app.get_webview_window("pet") { let _ = window.show(); }
    app.emit_to("pet", "pet-reaction", payload).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn trigger_reaction(app: AppHandle, reaction: String, message: Option<String>) -> Result<(), String> {
    trigger_reaction_inner(&app, reaction, message)
}

#[tauri::command]
pub fn show_control_center(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("control center is unavailable")?;
    window.show().and_then(|_| window.set_focus()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) { app.exit(0); }
