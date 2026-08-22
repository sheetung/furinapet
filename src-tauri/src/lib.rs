mod commands;
mod pet;
mod settings;
mod tray;
mod updater;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let initial_settings = settings::load(&app_handle);
            app.manage(settings::AppState::new(initial_settings.clone()));

            let pet_window = pet::create(&app_handle, &initial_settings)?;
            let pet_for_close = pet_window.clone();
            pet_window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = pet_for_close.hide();
                }
            });

            if let Some(main_window) = app.get_webview_window("main") {
                let main_for_close = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_for_close.hide();
                    }
                });
            }
            tray::create(&app_handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::get_dashboard,
            commands::update_settings,
            commands::set_pet_visible,
            commands::toggle_pet,
            commands::reset_pet_position,
            commands::wait_for_drag_release,
            commands::trigger_reaction,
            commands::show_control_center,
            commands::quit_app,
            updater::check_for_updates,
            updater::download_and_install_update,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Furina desktop pet");
}
