#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("mcp") => {
            if let Err(error) = furina_desktop_pet_lib::run_mcp_stdio() {
                eprintln!("FurinaPet MCP server failed: {error}");
                std::process::exit(1);
            }
            return;
        }
        Some("claude-hook") => {
            // Claude hooks are side effects only. They must never block or fail Claude Code.
            let _ = furina_desktop_pet_lib::run_claude_hook_stdio();
            return;
        }
        _ => {}
    }
    furina_desktop_pet_lib::run();
}
