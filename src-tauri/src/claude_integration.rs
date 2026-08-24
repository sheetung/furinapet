use crate::{agent_host, commands};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    env,
    ffi::OsStr,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Output},
    time::Duration,
};
use tauri::AppHandle;
use uuid::Uuid;

const MCP_SERVER_NAME: &str = "furinapet";
const HOOK_MARKER: &str = "--furinapet-managed";
const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;
const MAX_HOOK_STDIN_BYTES: u64 = 64 * 1024;
const CLAUDE_HOOK_EVENTS: [&str; 7] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "Stop",
    "StopFailure",
    "SessionEnd",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeIntegrationStatus {
    pub claude_available: bool,
    pub hooks_status: String,
    pub mcp_status: String,
    pub overall_status: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct HookBridgeReply {
    ok: bool,
    result: Option<Value>,
}

pub fn run_hook_from_stdin() -> Result<(), String> {
    let mut raw = String::new();
    std::io::stdin()
        .take(MAX_HOOK_STDIN_BYTES + 1)
        .read_to_string(&mut raw)
        .map_err(|_| "hook stdin is unavailable".to_string())?;
    if raw.len() as u64 > MAX_HOOK_STDIN_BYTES {
        return Ok(());
    }

    let Ok(payload) = serde_json::from_str::<Value>(&raw) else {
        return Ok(());
    };
    let Some(event_name) = payload.get("hook_event_name").and_then(Value::as_str) else {
        return Ok(());
    };

    let session_id = hook_session_id(&payload);
    let project = hook_project_name(&payload);
    let mut start_params = json!({
        "sessionId": session_id,
        "agent": "claude-code"
    });
    if let Some(project) = &project {
        start_params["project"] = Value::String(project.clone());
    }
    let _ = bridge_call("session.start", start_params);

    match event_name {
        "SessionStart" => {
            let _ = bridge_state(&session_id, "idle", project.as_deref());
        }
        "UserPromptSubmit" => {
            let _ = bridge_state(&session_id, "thinking", project.as_deref());
        }
        "PreToolUse" => {
            let state = classify_pre_tool_state(&payload).unwrap_or("thinking");
            let _ = bridge_state(&session_id, state, project.as_deref());
        }
        "PermissionRequest" => {
            let _ = bridge_state(&session_id, "waiting", project.as_deref());
        }
        "Stop" => {
            let _ = bridge_state(&session_id, "success", project.as_deref());
        }
        "StopFailure" => {
            let _ = bridge_state(&session_id, "error", project.as_deref());
        }
        "SessionEnd" => {
            let _ = bridge_call("session.end", json!({ "sessionId": session_id }));
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn get_claude_integration_status() -> Result<ClaudeIntegrationStatus, String> {
    Ok(integration_status())
}

#[tauri::command]
pub fn install_claude_integration() -> Result<ClaudeIntegrationStatus, String> {
    let claude = find_claude_command().ok_or(
        "未检测到 Claude Code，请先安装 Claude Code 并确保 claude 命令位于 PATH。",
    )?;
    let executable = current_executable()?;

    let _ = run_claude(
        &claude,
        ["mcp", "remove", "--scope", "user", MCP_SERVER_NAME],
    );
    let add = run_claude_owned(
        &claude,
        vec![
            "mcp".into(),
            "add".into(),
            "--scope".into(),
            "user".into(),
            MCP_SERVER_NAME.into(),
            "--".into(),
            executable.to_string_lossy().into_owned(),
            "mcp".into(),
        ],
    )?;
    if !add.status.success() {
        return Err(
            "Claude Code MCP 配置写入失败。请运行 `claude mcp list` 检查 Claude Code 状态。"
                .into(),
        );
    }

    if let Err(error) = install_hooks(&executable) {
        let _ = run_claude(
            &claude,
            ["mcp", "remove", "--scope", "user", MCP_SERVER_NAME],
        );
        return Err(error);
    }
    Ok(integration_status())
}

#[tauri::command]
pub fn uninstall_claude_integration() -> Result<ClaudeIntegrationStatus, String> {
    uninstall_hooks()?;
    if let Some(claude) = find_claude_command() {
        let _ = run_claude(
            &claude,
            ["mcp", "remove", "--scope", "user", MCP_SERVER_NAME],
        );
    }
    Ok(integration_status())
}

#[tauri::command]
pub fn test_agent_integration(app: AppHandle) -> Result<(), String> {
    commands::trigger_reaction_inner(
        &app,
        "review".into(),
        Some("智能体连接正常，我收到状态啦！".into()),
    )
}

fn integration_status() -> ClaudeIntegrationStatus {
    let claude = find_claude_command();
    let claude_available = claude.is_some();
    let hooks_status = match current_executable().and_then(|exe| inspect_hooks(&exe)) {
        Ok(value) => value,
        Err(_) => "error".into(),
    };
    let mcp_status = if let Some(command) = claude.as_ref() {
        match run_claude(command, ["mcp", "get", MCP_SERVER_NAME]) {
            Ok(output) if output.status.success() => "installed",
            Ok(_) => "not_installed",
            Err(_) => "error",
        }
    } else {
        "unavailable"
    }
    .to_string();

    let overall_status = if hooks_status == "installed" && mcp_status == "installed" {
        "installed"
    } else if !claude_available {
        "unavailable"
    } else if hooks_status == "needs_update" || mcp_status == "needs_update" {
        "needs_update"
    } else if hooks_status == "error" || mcp_status == "error" {
        "error"
    } else {
        "not_installed"
    };
    let message = match overall_status {
        "installed" => "Claude Code 已连接到 FurinaPet，MCP 与自动状态 Hooks 均已启用。",
        "unavailable" => "未检测到 Claude Code。安装后即可一键接入。",
        "needs_update" => "Claude Code 接入配置需要更新。",
        "error" => "Claude Code 配置无法读取或状态检查失败。",
        _ => "Claude Code 尚未接入 FurinaPet。",
    };

    ClaudeIntegrationStatus {
        claude_available,
        hooks_status,
        mcp_status,
        overall_status: overall_status.into(),
        message: message.into(),
    }
}

fn install_hooks(executable: &Path) -> Result<(), String> {
    let path = claude_settings_path()?;
    let mut settings = read_json_object(&path)?;
    remove_managed_hooks(&mut settings)?;
    let command = hook_command(executable)?;

    let hooks = settings
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or("Claude settings 的 hooks 字段不是对象，无法安全修改。")?;

    for event in CLAUDE_HOOK_EVENTS {
        let entries = hooks
            .entry(event)
            .or_insert_with(|| Value::Array(Vec::new()));
        let array = entries
            .as_array_mut()
            .ok_or("Claude hook 事件配置不是数组，无法安全修改。")?;
        array.push(json!({
            "hooks": [{
                "type": "command",
                "command": command,
                "timeout": 3,
                "async": true
            }]
        }));
    }

    backup_and_write_json(&path, &Value::Object(settings))
}

fn uninstall_hooks() -> Result<(), String> {
    let path = claude_settings_path()?;
    if !path.exists() {
        return Ok(());
    }
    let mut settings = read_json_object(&path)?;
    remove_managed_hooks(&mut settings)?;
    backup_and_write_json(&path, &Value::Object(settings))
}

fn inspect_hooks(executable: &Path) -> Result<String, String> {
    let path = claude_settings_path()?;
    if !path.exists() {
        return Ok("not_installed".into());
    }
    let settings = read_json_object(&path)?;
    let expected = hook_command(executable)?;
    let Some(hooks) = settings.get("hooks").and_then(Value::as_object) else {
        return Ok("not_installed".into());
    };

    let mut found_managed = false;
    for event in CLAUDE_HOOK_EVENTS {
        let Some(entries) = hooks.get(event).and_then(Value::as_array) else {
            return Ok(if found_managed {
                "needs_update"
            } else {
                "not_installed"
            }
            .into());
        };
        let mut current = false;
        for entry in entries {
            if contains_managed_hook(entry) {
                found_managed = true;
            }
            if contains_exact_hook(entry, &expected) {
                current = true;
            }
        }
        if !current {
            return Ok(if found_managed {
                "needs_update"
            } else {
                "not_installed"
            }
            .into());
        }
    }
    Ok("installed".into())
}

fn remove_managed_hooks(settings: &mut Map<String, Value>) -> Result<(), String> {
    let Some(hooks_value) = settings.get_mut("hooks") else {
        return Ok(());
    };
    let hooks = hooks_value
        .as_object_mut()
        .ok_or("Claude settings 的 hooks 字段不是对象，无法安全修改。")?;

    let event_names: Vec<String> = hooks.keys().cloned().collect();
    for event_name in event_names {
        let Some(entries) = hooks.get_mut(&event_name).and_then(Value::as_array_mut) else {
            continue;
        };
        let previous = std::mem::take(entries);
        *entries = previous
            .into_iter()
            .filter_map(strip_managed_hooks)
            .collect();
    }
    hooks.retain(|_, value| !matches!(value, Value::Array(items) if items.is_empty()));
    if hooks.is_empty() {
        settings.remove("hooks");
    }
    Ok(())
}

fn strip_managed_hooks(mut value: Value) -> Option<Value> {
    if let Some(object) = value.as_object_mut() {
        if let Some(hook_list) = object.get_mut("hooks").and_then(Value::as_array_mut) {
            hook_list.retain(|hook| !contains_managed_hook(hook));
            return if hook_list.is_empty() { None } else { Some(value) };
        }
    }
    if contains_managed_hook(&value) {
        None
    } else {
        Some(value)
    }
}

fn contains_managed_hook(value: &Value) -> bool {
    match value {
        Value::String(text) => text.contains(HOOK_MARKER),
        Value::Array(items) => items.iter().any(contains_managed_hook),
        Value::Object(object) => object.values().any(contains_managed_hook),
        _ => false,
    }
}

fn contains_exact_hook(value: &Value, expected_command: &str) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.get("type").and_then(Value::as_str) == Some("command")
        && object.get("command").and_then(Value::as_str) == Some(expected_command)
        && object.get("async").and_then(Value::as_bool) == Some(true)
    {
        return true;
    }
    object.values().any(|child| match child {
        Value::Array(items) => items
            .iter()
            .any(|item| contains_exact_hook(item, expected_command)),
        Value::Object(_) => contains_exact_hook(child, expected_command),
        _ => false,
    })
}

fn claude_settings_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".claude").join("settings.json"))
        .ok_or_else(|| "无法定位用户主目录。".into())
}

fn read_json_object(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "无法读取 Claude settings 元数据。".to_string())?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_SETTINGS_BYTES
    {
        return Err("Claude settings 文件类型或大小不符合安全要求。".into());
    }
    let content = fs::read_to_string(path).map_err(|_| "无法读取 Claude settings。".to_string())?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|_| "Claude settings 不是有效 JSON。".to_string())?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| "Claude settings 顶层必须是 JSON 对象。".into())
}

fn backup_and_write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "无法创建 Claude 配置目录。".to_string())?;
    }
    if path.exists() {
        let backup = path.with_extension("json.furinapet.bak");
        fs::copy(path, backup).map_err(|_| "无法备份 Claude settings。".to_string())?;
    }
    let content = serde_json::to_vec_pretty(value)
        .map_err(|_| "无法序列化 Claude settings。".to_string())?;
    let temporary = path.with_extension("json.furinapet.tmp");
    fs::write(&temporary, content)
        .map_err(|_| "无法写入 Claude settings 临时文件。".to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|_| "无法替换 Claude settings。".to_string())?;
    }
    fs::rename(temporary, path).map_err(|_| "无法提交 Claude settings。".to_string())
}

fn current_executable() -> Result<PathBuf, String> {
    env::current_exe().map_err(|_| "无法定位 FurinaPet 可执行文件。".into())
}

fn hook_command(executable: &Path) -> Result<String, String> {
    let value = executable.to_string_lossy();
    if value.contains('"') || value.contains('\n') || value.contains('\r') {
        return Err("FurinaPet 安装路径包含不支持的字符。".into());
    }
    #[cfg(target_os = "windows")]
    {
        Ok(format!("\"{value}\" claude-hook {HOOK_MARKER}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let escaped = value.replace('\'', "'\\''");
        Ok(format!("'{escaped}' claude-hook {HOOK_MARKER}"))
    }
}

fn find_claude_command() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = env::var_os("APPDATA") {
            candidates.push(PathBuf::from(appdata).join("npm").join("claude.cmd"));
        }
        if let Some(home) = dirs::home_dir() {
            candidates.push(home.join(".local").join("bin").join("claude.exe"));
            candidates.push(home.join("scoop").join("shims").join("claude.exe"));
            candidates.push(home.join("scoop").join("shims").join("claude.cmd"));
        }
        if let Some(program_data) = env::var_os("ProgramData") {
            candidates.push(
                PathBuf::from(program_data)
                    .join("scoop")
                    .join("shims")
                    .join("claude.exe"),
            );
        }
    }

    if let Some(path) = env::var_os("PATH") {
        #[cfg(target_os = "windows")]
        let names = ["claude.exe", "claude.cmd", "claude.bat", "claude"];
        #[cfg(not(target_os = "windows"))]
        let names = ["claude", "claude", "claude", "claude"];
        for directory in env::split_paths(&path) {
            for name in names {
                candidates.push(directory.join(name));
            }
        }
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn run_claude<I, S>(command: &Path, args: I) -> Result<Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut process = Command::new(command);
    process.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        process.creation_flags(CREATE_NO_WINDOW);
    }
    process
        .output()
        .map_err(|_| "Claude Code 命令执行失败。".into())
}

fn run_claude_owned(command: &Path, args: Vec<String>) -> Result<Output, String> {
    run_claude(command, args)
}

fn hook_session_id(payload: &Value) -> String {
    let candidate = payload
        .get("session_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if !candidate.is_empty()
        && candidate.len() <= 96
        && candidate.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')
        })
    {
        format!("claude-{candidate}")
    } else {
        format!("claude-{}", Uuid::new_v4().simple())
    }
}

fn hook_project_name(payload: &Value) -> Option<String> {
    let cwd = payload.get("cwd").and_then(Value::as_str)?;
    let name = Path::new(cwd)
        .file_name()?
        .to_string_lossy()
        .trim()
        .to_string();
    if name.is_empty()
        || name.chars().count() > 80
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
    {
        None
    } else {
        Some(name)
    }
}

fn classify_pre_tool_state(payload: &Value) -> Option<&'static str> {
    let tool_name = payload
        .get("tool_name")
        .and_then(Value::as_str)
        .unwrap_or("");
    if matches!(tool_name, "Edit" | "Write" | "MultiEdit" | "NotebookEdit") {
        return Some("editing");
    }
    if tool_name == "Bash" {
        let command = payload
            .get("tool_input")
            .and_then(Value::as_object)
            .and_then(|input| input.get("command"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if is_test_command(command) {
            return Some("testing");
        }
    }
    None
}

fn is_test_command(command: &str) -> bool {
    let lower = command
        .chars()
        .take(300)
        .collect::<String>()
        .to_ascii_lowercase();
    [
        "pytest",
        "vitest",
        "jest",
        "npm test",
        "npm run test",
        "pnpm test",
        "pnpm run test",
        "yarn test",
        "cargo test",
        "go test",
        "dotnet test",
        "mvn test",
        "gradle test",
        "ctest",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn bridge_state(session_id: &str, state: &str, project: Option<&str>) -> Result<Value, String> {
    let mut params = json!({
        "sessionId": session_id,
        "state": state,
        "agent": "claude-code"
    });
    if let Some(project) = project {
        params["project"] = Value::String(project.into());
    }
    bridge_call("session.state", params)
}

fn bridge_call(method: &str, params: Value) -> Result<Value, String> {
    let path = agent_host::discovery_path()?;
    let content = fs::read_to_string(path).map_err(|_| "Agent Bridge unavailable".to_string())?;
    let discovery: agent_host::AgentDiscovery = serde_json::from_str(&content)
        .map_err(|_| "Agent Bridge unavailable".to_string())?;
    if discovery.protocol != agent_host::AGENT_PROTOCOL_VERSION || discovery.host != "127.0.0.1" {
        return Err("Agent Bridge unavailable".into());
    }

    let address: SocketAddr = format!("{}:{}", discovery.host, discovery.port)
        .parse()
        .map_err(|_| "Agent Bridge unavailable".to_string())?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(500))
        .map_err(|_| "Agent Bridge unavailable".to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));

    let request = json!({
        "token": discovery.token,
        "method": method,
        "params": params
    });
    let encoded = serde_json::to_string(&request)
        .map_err(|_| "Agent Bridge unavailable".to_string())?;
    stream
        .write_all(encoded.as_bytes())
        .map_err(|_| "Agent Bridge unavailable".to_string())?;
    stream
        .write_all(b"\n")
        .map_err(|_| "Agent Bridge unavailable".to_string())?;
    stream
        .flush()
        .map_err(|_| "Agent Bridge unavailable".to_string())?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|_| "Agent Bridge unavailable".to_string())?;
    let reply: HookBridgeReply = serde_json::from_str(&line)
        .map_err(|_| "Agent Bridge unavailable".to_string())?;
    if reply.ok {
        Ok(reply.result.unwrap_or(Value::Null))
    } else {
        Err("Agent Bridge rejected request".into())
    }
}
