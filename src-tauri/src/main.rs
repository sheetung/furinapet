#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("mcp") {
        if let Err(error) = furina_desktop_pet_lib::run_mcp_stdio() {
            eprintln!("FurinaPet MCP server failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    furina_desktop_pet_lib::run();
}
