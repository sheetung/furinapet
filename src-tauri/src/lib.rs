mod commands;
mod pet;
mod plugin_host;
mod settings;
mod tray;
mod updater;
mod window_surfaces;

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
            app.manage(plugin_host::PluginHostState::load(&app_handle));

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
            window_surfaces::get_work_area_at,
            window_surfaces::list_dock_surfaces,
            commands::trigger_reaction,
            commands::show_control_center,
            commands::quit_app,
            plugin_host::list_plugins,
            plugin_host::fetch_plugin_catalog,
            plugin_host::install_plugin,
            plugin_host::uninstall_plugin,
            plugin_host::set_plugin_enabled,
            plugin_host::get_plugin_config,
            plugin_host::set_plugin_config,
            plugin_host::list_runtime_plugins,
            plugin_host::plugin_sdk_call,
            plugin_host::publish_pet_event,
            updater::check_for_updates,
            updater::download_and_install_update,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Furina desktop pet");
}
