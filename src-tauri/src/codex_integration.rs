use serde::Serialize;
use std::{fs, io::Write, path::{Path, PathBuf}, sync::Mutex};
use toml_edit::{DocumentMut, Item, Table, Array, value};

const MARKER: &str = "# furinapet-managed-codex-mcp";
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexIntegrationStatus {
    mcp_status: String,
    managed: bool,
    message: String,
}

fn config_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("CODEX_HOME").filter(|s| !s.is_empty()).map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|p| p.join(".codex")))
        .ok_or("无法定位 Codex 配置目录。")?;
    if !base.is_absolute() { return Err("CODEX_HOME 必须为绝对路径。".into()); }
    Ok(base.join("config.toml"))
}

fn read(path: &Path) -> Result<String, String> {
    match fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(_) => Err("无法读取 Codex 配置文件。".into()),
        Ok(meta) => {
            if meta.len() > 2 * 1024 * 1024 { return Err("Codex 配置过大，未修改。".into()); }
            fs::read_to_string(path).map_err(|_| "无法读取 Codex 配置文件。".into())
        }
    }
}
fn parse(raw: &str) -> Result<DocumentMut, String> {
    raw.parse().map_err(|_| "Codex TOML 配置格式错误，请修复后重试；原文件未修改。".into())
}
fn server(doc: &DocumentMut) -> Option<&Item> { doc.get("mcp_servers")?.get("furinapet") }
fn managed(item: &Item) -> bool {
    item.as_table().and_then(|t| t.decor().prefix()).and_then(|p| p.as_str())
        .is_some_and(|p| p.lines().any(|line| line.trim() == MARKER))
}
fn matches(item: &Item, exe: &Path) -> bool {
    item.get("command").and_then(Item::as_str) == exe.to_str()
        && item.get("args").and_then(Item::as_array).is_some_and(|a| a.len() == 1 && a.get(0).and_then(|v| v.as_str()) == Some("mcp"))
        && item.get("enabled").and_then(Item::as_bool) != Some(false)
        && item.get("url").is_none()
}
fn inspect(raw: &str, exe: &Path) -> Result<CodexIntegrationStatus, String> {
    let doc = parse(raw)?;
    let item = server(&doc);
    let owned = item.is_some_and(managed);
    let (status, message) = match item {
        None => ("not_installed", "一键配置 Codex MCP，支持调用桌宠动作、气泡和状态工具。"),
        Some(item) if matches(item, exe) => ("installed", "MCP 已配置。重启 Codex 或重新加载 MCP 后，在当前连接中确认会话。"),
        Some(_) if owned => ("needs_update", "桌宠路径或启用状态已变化，可更新接入。"),
        Some(_) => ("error", "已有同名 furinapet 配置，非本应用管理；请先手动检查，避免覆盖。"),
    };
    Ok(CodexIntegrationStatus { mcp_status: status.into(), managed: owned, message: message.into() })
}
fn edit(raw: &str, exe: &Path, remove: bool) -> Result<String, String> {
    let mut doc = parse(raw)?;
    if let Some(item) = server(&doc) {
        if !managed(item) {
            if !remove && matches(item, exe) { return Ok(raw.into()); }
            return Err("不会覆盖或移除非本应用管理的同名 MCP 配置。".into());
        }
    } else if remove { return Ok(raw.into()); }
    if doc.get("mcp_servers").is_none() { doc["mcp_servers"] = Item::Table(Table::new()); }
    let servers = doc.get_mut("mcp_servers").and_then(Item::as_table_mut)
        .ok_or("mcp_servers 不是标准 TOML 表，请手动检查配置。")?;
    if remove { servers.remove("furinapet"); }
    else {
        if servers.get("furinapet").is_none() {
            let mut table = Table::new(); table.decor_mut().set_prefix(format!("\n{MARKER}\n"));
            servers.insert("furinapet", Item::Table(table));
        }
        let table = servers.get_mut("furinapet").and_then(Item::as_table_mut).ok_or("无效的 MCP 表。")?;
        if table.contains_key("url") { return Err("受管理配置已改成HTTP，请手动检查；未覆盖。".into()); }
        table["command"] = value(exe.to_str().ok_or("桌宠路径无法编码。")?);
        let mut args = Array::new(); args.push("mcp"); table["args"] = value(args);
        table["enabled"] = value(true);
    }
    Ok(doc.to_string())
}
fn update(path: &Path, exe: &Path, remove: bool) -> Result<CodexIntegrationStatus, String> {
    let _lock = CONFIG_LOCK.lock().map_err(|_| "配置操作忙，请重试。")?;
    let raw = read(path)?;
    let next = edit(&raw, exe, remove)?;
    if next != raw {
        let parent = path.parent().ok_or("无效配置路径。")?;
        fs::create_dir_all(parent).map_err(|_| "无法创建Codex配置目录。")?;
        let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> Result<(), String> {
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_| "无法创建临时配置。")?;
            file.write_all(next.as_bytes()).and_then(|_| file.sync_all()).map_err(|_| "配置写入失败。")?;
            drop(file);
            if read(path)? != raw { return Err("Codex配置同时被修改，请刷新后重试。".into()); }
            if path.exists() {
                fs::copy(path, path.with_extension(format!("furinapet-{}.bak", uuid::Uuid::new_v4())))
                    .map_err(|_| "备份失败，未修改原配置。")?;
            }
            fs::rename(&temp, path).map_err(|_| "替换配置失败，原文件及备份保留。")?;
            Ok(())
        })();
        if result.is_err() { let _ = fs::remove_file(&temp); }
        result?;
    }
    inspect(&read(path)?, exe)
}
#[tauri::command]
pub fn get_codex_integration_status() -> Result<CodexIntegrationStatus, String> {
    inspect(&read(&config_path()?)?, &std::env::current_exe().map_err(|_| "无法定位桌宠程序。")?)
}
#[tauri::command]
pub fn install_codex_integration() -> Result<CodexIntegrationStatus, String> {
    update(&config_path()?, &std::env::current_exe().map_err(|_| "无法定位桌宠程序。")?, false)
}
#[tauri::command]
pub fn uninstall_codex_integration() -> Result<CodexIntegrationStatus, String> {
    update(&config_path()?, &std::env::current_exe().map_err(|_| "无法定位桌宠程序。")?, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_other_settings_and_roundtrips_windows_paths() {
        let raw = "# user settings\nmodel = 'example'\n[mcp_servers.other]\ncommand = 'other' # keep\n";
        let exe = Path::new(r"C:\Program Files\芙宁娜\furinapet.exe");
        let added = edit(raw, exe, false).unwrap();
        assert!(added.contains("command = 'other' # keep"));
        let status = inspect(&added, exe).unwrap();
        assert_eq!(status.mcp_status, "installed"); assert!(status.managed);
        assert_eq!(edit(&added, exe, false).unwrap(), added);
        let removed = edit(&added, exe, true).unwrap();
        assert!(removed.contains("model = 'example'"));
        assert!(server(&parse(&removed).unwrap()).is_none());
    }
    #[test]
    fn refuses_conflicting_or_invalid_user_config() {
        let exe = Path::new("pet.exe");
        assert!(edit("[broken", exe, false).is_err());
        let raw = "[mcp_servers.furinapet]\ncommand = 'other'\n";
        assert!(edit(raw, exe, false).is_err()); assert!(edit(raw, exe, true).is_err());
        let correct = "[mcp_servers.furinapet]\ncommand = 'pet.exe'\nargs = ['mcp']\n";
        assert_eq!(edit(correct, exe, false).unwrap(), correct);
        assert!(!inspect(correct, exe).unwrap().managed);
    }
    #[test]
    fn updates_managed_path_and_disabled_status() {
        let first = edit("", Path::new("old.exe"), false).unwrap();
        assert_eq!(inspect(&first, Path::new("new.exe")).unwrap().mcp_status, "needs_update");
        let next = edit(&first.replace("enabled = true", "enabled = false"), Path::new("new.exe"), false).unwrap();
        assert_eq!(inspect(&next, Path::new("new.exe")).unwrap().mcp_status, "installed");
    }
    #[test]
    fn disk_write_backs_up_and_removal_preserves_user_file() {
        let dir = std::env::temp_dir().join(format!("furina-codex-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.toml"); let exe = Path::new("pet.exe");
        fs::write(&path, "# mine\nmodel = 'example'\n").unwrap();
        assert_eq!(update(&path, exe, false).unwrap().mcp_status, "installed");
        assert!(fs::read_dir(&dir).unwrap().any(|e| e.unwrap().path().extension().is_some_and(|x| x == "bak")));
        assert_eq!(update(&path, exe, true).unwrap().mcp_status, "not_installed");
        assert!(read(&path).unwrap().contains("model = 'example'"));
        fs::remove_dir_all(dir).unwrap();
    }
}
