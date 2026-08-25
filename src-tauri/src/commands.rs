use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::{
    pet,
    settings::{self, AppState, Settings, SettingsPatch},
};

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
    state
        .settings
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "settings lock is poisoned".into())
}

fn persist_and_apply(
    app: &AppHandle,
    state: &State<'_, AppState>,
    next: Settings,
) -> Result<Settings, String> {
    let previous = snapshot(state)?;
    settings::save(app, &next)?;

    // Publish the new visibility state before touching the window. The fullscreen
    // watcher runs on another thread and must never see a stale `pet_visible=true`
    // after the user has explicitly requested a hide.
    *state
        .settings
        .lock()
        .map_err(|_| "settings lock is poisoned")? = next.clone();

    if let Err(error) = pet::apply_settings(app, &next) {
        let _ = settings::save(app, &previous);
        if let Ok(mut current) = state.settings.lock() {
            *current = previous.clone();
        }
        let _ = pet::apply_settings(app, &previous);
        return Err(error);
    }

    app.emit_to("pet", "settings-changed", &next)
        .map_err(|error| error.to_string())?;
    app.emit_to("main", "settings-changed", &next)
        .map_err(|error| error.to_string())?;
    Ok(next)
}

#[tauri::command]
pub fn get_settings(app: AppHandle, state: State<'_, AppState>) -> Result<Settings, String> {
    let mut value = snapshot(&state)?;
    if let Ok(enabled) = app.autolaunch().is_enabled() {
        if value.launch_at_login != enabled {
            value.launch_at_login = enabled;
            settings::save(&app, &value)?;
            *state
                .settings
                .lock()
                .map_err(|_| "settings lock is poisoned")? = value.clone();
        }
    }
    Ok(value)
}

#[tauri::command]
pub fn get_dashboard(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DashboardSnapshot, String> {
    Ok(DashboardSnapshot {
        app_name: "芙宁娜桌宠",
        version: app.package_info().version.to_string(),
        engine: "Tauri 2 + WebView2",
        feature_count: 3,
        settings: snapshot(&state)?,
    })
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<Settings, String> {
    let mut next = snapshot(&state)?;
    let requested_autostart = patch.launch_at_login;
    next.apply(patch)?;
    if let Some(enabled) = requested_autostart {
        if enabled {
            app.autolaunch()
                .enable()
                .map_err(|error| error.to_string())?;
        } else if app
            .autolaunch()
            .is_enabled()
            .map_err(|error| error.to_string())?
        {
            app.autolaunch()
                .disable()
                .map_err(|error| error.to_string())?;
        }
        let actual = app
            .autolaunch()
            .is_enabled()
            .map_err(|error| error.to_string())?;
        if actual != enabled {
            return Err(if enabled {
                "Windows 启动项写入后未生效，请检查系统的启动应用设置。".into()
            } else {
                "Windows 启动项未能关闭。".into()
            });
        }
        next.launch_at_login = actual;
    }
    persist_and_apply(&app, &state, next)
}

pub fn set_pet_visible_inner(app: &AppHandle, visible: bool) -> Result<Settings, String> {
    let state = app.state::<AppState>();
    let mut next = snapshot(&state)?;
    if next.pet_visible == visible {
        let window = app
            .get_webview_window("pet")
            .ok_or("pet window is unavailable")?;
        if visible {
            window.show()
        } else {
            window.hide()
        }
        .map_err(|error| error.to_string())?;
        return Ok(next);
    }
    next.pet_visible = visible;
    persist_and_apply(app, &state, next)
}

#[tauri::command]
pub fn set_pet_visible(app: AppHandle, visible: bool) -> Result<Settings, String> {
    set_pet_visible_inner(&app, visible)
}

#[tauri::command]
pub fn toggle_pet(app: AppHandle) -> Result<Settings, String> {
    let state = app.state::<AppState>();
    let visible = !snapshot(&state)?.pet_visible;
    set_pet_visible_inner(&app, visible)
}

#[tauri::command]
pub fn reset_pet_position(app: AppHandle) -> Result<(), String> {
    pet::reset_position(&app)
}

#[tauri::command]
pub async fn wait_for_drag_release() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            use std::time::{Duration, Instant};
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};

            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(30) {
                let pressed = unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } < 0;
                if !pressed {
                    return;
                }
                std::thread::sleep(Duration::from_millis(24));
            }
        })
        .await
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn trigger_reaction_inner(
    app: &AppHandle,
    reaction: String,
    message: Option<String>,
) -> Result<(), String> {
    const ALLOWED: [&str; 7] = [
        "idle", "waving", "jumping", "failed", "waiting", "running", "review",
    ];
    if !ALLOWED.contains(&reaction.as_str()) {
        return Err("unsupported reaction".into());
    }
    let safe_message = message
        .map(|value| value.chars().take(160).collect::<String>())
        .filter(|value| !value.is_empty());
    let payload = ReactionPayload {
        reaction,
        message: safe_message,
        duration_ms: 2600,
    };

    // Background Agent / plugin / MCP reactions may update the pet state, but they
    // must not override an explicit user hide. UI quick reactions call show_pet
    // first when the user intentionally wants to reveal the pet.
    let user_wants_visible = app
        .state::<AppState>()
        .settings
        .lock()
        .map(|settings| settings.pet_visible)
        .unwrap_or(false);
    if user_wants_visible {
        if let Some(window) = app.get_webview_window("pet") {
            let _ = window.show();
        }
    }

    app.emit_to("pet", "pet-reaction", payload)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn trigger_reaction(
    app: AppHandle,
    reaction: String,
    message: Option<String>,
) -> Result<(), String> {
    trigger_reaction_inner(&app, reaction, message)
}

#[tauri::command]
pub fn show_control_center(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("control center is unavailable")?;
    window
        .show()
        .and_then(|_| window.set_focus())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
