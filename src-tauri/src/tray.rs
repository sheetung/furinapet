use tauri::{menu::MenuBuilder, tray::TrayIconBuilder, AppHandle, Manager};

use crate::commands;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("control_center", "打开控制中心")
        .text("toggle_pet", "显示 / 隐藏芙宁娜")
        .separator()
        .text("wave", "让芙宁娜打招呼")
        .text("reset_position", "重置桌宠位置")
        .separator()
        .text("quit", "退出")
        .build()?;

    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::new().tooltip("芙宁娜桌宠").menu(&menu).show_menu_on_left_click(true);
    if let Some(icon) = icon { builder = builder.icon(icon); }
    builder.on_menu_event(|app, event| {
        if event.id() == "control_center" {
            if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
        } else if event.id() == "toggle_pet" {
            let _ = commands::toggle_pet(app.clone());
        } else if event.id() == "wave" {
            let _ = commands::trigger_reaction_inner(app, "waving".into(), Some("贵安，今天也请多关照啦。".into()));
        } else if event.id() == "reset_position" {
            let _ = crate::pet::reset_position(app);
        } else if event.id() == "quit" {
            app.exit(0);
        }
    }).build(app)?;
    Ok(())
}
