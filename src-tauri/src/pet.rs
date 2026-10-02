use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::settings::Settings;
use std::sync::atomic::{AtomicU64, Ordering};

// Invalidates an outstanding exit whenever settings are applied again.
static VISIBILITY_REVISION: AtomicU64 = AtomicU64::new(0);

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
    if let Some(monitor) = window.primary_monitor()? {
        let size = window.outer_size()?;
        let work_area = monitor.work_area();
        let x = work_area.position.x + work_area.size.width as i32 - size.width as i32 - 32;
        let y = work_area.position.y + work_area.size.height as i32 - size.height as i32;
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    Ok(window)
}

pub fn apply_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let window = app.get_webview_window("pet").ok_or("pet window is unavailable")?;
    window.set_size(LogicalSize::new(BASE_WIDTH * settings.scale, BASE_HEIGHT * settings.scale)).map_err(|error| error.to_string())?;
    window.set_always_on_top(settings.always_on_top).map_err(|error| error.to_string())?;
    let revision = VISIBILITY_REVISION.fetch_add(1, Ordering::SeqCst) + 1;
    if settings.pet_visible {
        window.show().map_err(|error| error.to_string())?;
    } else {
        // Keep the native surface alive for the frontend's 280ms exit animation.
        // Bounded fallback also hides it when the webview is unresponsive.
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            let dispatch = app.clone();
            let _ = dispatch.run_on_main_thread(move || {
                if VISIBILITY_REVISION.load(Ordering::SeqCst) != revision { return; }
                if let Some(window) = app.get_webview_window("pet") {
                    let _ = window.hide();
                }
            });
        });
    }
    Ok(())
}

pub fn reset_position(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("pet").ok_or("pet window is unavailable")?;
    let monitor = window.primary_monitor().map_err(|error| error.to_string())?.ok_or("primary monitor is unavailable")?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let work_area = monitor.work_area();
    let x = work_area.position.x + work_area.size.width as i32 - size.width as i32 - 32;
    let y = work_area.position.y + work_area.size.height as i32 - size.height as i32;
    window.set_position(PhysicalPosition::new(x, y)).map_err(|error| error.to_string())
}
