use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::settings::Settings;

const BASE_WIDTH: f64 = 192.0;
const BASE_HEIGHT: f64 = 208.0;

pub fn create(app: &AppHandle, settings: &Settings) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("index.html?window=pet".into()))
        .title("芙宁娜")
        .inner_size(BASE_WIDTH * settings.scale, BASE_HEIGHT * settings.scale)
        .min_inner_size(BASE_WIDTH * 0.65, BASE_HEIGHT * 0.65)
        .max_inner_size(BASE_WIDTH * 1.5, BASE_HEIGHT * 1.5)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(true)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(settings.always_on_top)
        .skip_taskbar(true)
        .focused(false)
        .visible(settings.pet_visible)
        .build()?;
    reset_position(app)?;
    Ok(window)
}

pub fn apply_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let window = app.get_webview_window("pet").ok_or("pet window is unavailable")?;
    window.set_size(LogicalSize::new(BASE_WIDTH * settings.scale, BASE_HEIGHT * settings.scale)).map_err(|error| error.to_string())?;
    window.set_always_on_top(settings.always_on_top).map_err(|error| error.to_string())?;
    if settings.pet_visible { window.show() } else { window.hide() }.map_err(|error| error.to_string())?;
    Ok(())
}

pub fn reset_position(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("pet").ok_or("pet window is unavailable")?;
    let monitor = window.primary_monitor().map_err(|error| error.to_string())?.ok_or("primary monitor is unavailable")?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let x = monitor_position.x + monitor_size.width as i32 - size.width as i32 - 32;
    let y = monitor_position.y + monitor_size.height as i32 - size.height as i32 - 96;
    window.set_position(PhysicalPosition::new(x, y)).map_err(|error| error.to_string())
}
