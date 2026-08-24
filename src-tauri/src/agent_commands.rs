use serde::Serialize;
use serde_json::json;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfigPreview {
    pub command: String,
    pub args: Vec<String>,
    pub json: String,
    pub claude_command: String,
}

#[tauri::command]
pub fn get_mcp_server_config() -> Result<McpServerConfigPreview, String> {
    let executable = std::env::current_exe().map_err(|_| "无法定位 FurinaPet 可执行文件。".to_string())?;
    let command = executable.to_string_lossy().into_owned();
    let value = json!({
        "mcpServers": {
            "furinapet": {
                "type": "stdio",
                "command": command.clone(),
                "args": ["mcp"]
            }
        }
    });
    let json = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    let display_path = if command.contains(' ') { format!("\"{command}\"") } else { command.clone() };
    Ok(McpServerConfigPreview {
        command,
        args: vec!["mcp".into()],
        json,
        claude_command: format!("claude mcp add --scope user furinapet -- {display_path} mcp"),
    })
}
