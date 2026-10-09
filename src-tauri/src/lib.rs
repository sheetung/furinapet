mod agent_commands;
mod agent_host;
mod ai;
mod brain_commands;
mod claude_integration;
mod codex_integration;
mod commands;
mod mcp_server;
mod pet;
mod settings;
mod tray;
mod updater;
mod window_surfaces;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

pub fn run_mcp_stdio() -> Result<(), String> {
    mcp_server::run()
}

pub fn run_claude_hook_stdio() -> Result<(), String> {
    claude_integration::run_hook_from_stdin()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let initial_settings = settings::load(&app_handle);
            app.manage(settings::AppState::new(initial_settings.clone()));
            app.manage(agent_host::AgentHostState::default());
            app.manage(ai::AiServiceState::load(&app_handle));
            if let Err(error) = agent_host::start(&app_handle) {
                eprintln!("[agent] failed to start local bridge: {error}");
            }

            let pet_window = pet::create(&app_handle, &initial_settings)?;
            let app_for_pet_close = app_handle.clone();
            pet_window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(error) = commands::set_pet_visible_inner(&app_for_pet_close, false) {
                        eprintln!("[pet] failed to persist hide: {error}");
                    }
                }
            });
            window_surfaces::start_fullscreen_watcher(&app_handle);

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
            agent_host::get_agent_status,
            brain_commands::submit_pet_brain_intent,
            ai::get_ai_settings,
            ai::update_ai_settings,
            ai::test_ai_provider,
            ai::request_ai_behavior_suggestion,
            agent_commands::get_mcp_server_config,
            claude_integration::get_claude_integration_status,
            codex_integration::get_codex_integration_status,
            codex_integration::install_codex_integration,
            codex_integration::uninstall_codex_integration,
            claude_integration::install_claude_integration,
            claude_integration::uninstall_claude_integration,
            claude_integration::test_agent_integration,
            updater::check_for_updates,
            updater::download_and_install_update,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Furina desktop pet");
}
