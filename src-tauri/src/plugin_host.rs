use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands;

const CATALOG_URL: &str = "https://raw.githubusercontent.com/sheetung/furinapet-plugins/main/catalog.v1.json";
const OFFICIAL_REPOSITORY: &str = "sheetung/furinapet-plugins";
const STATE_FILE: &str = "plugin-state.json";
const MANIFEST_FILE: &str = "furinapet.plugin.json";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct PersistedPluginState {
    // Kept only so older plugin-system builds deserialize cleanly.
    #[serde(default)]
    enabled: Vec<String>,
    #[serde(default)]
    installed: HashMap<String, InstalledPlugin>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct InstalledPlugin {
    version: String,
    enabled: bool,
    #[serde(default)]
    config: BTreeMap<String, Value>,
    #[serde(default)]
    storage: BTreeMap<String, Value>,
}

pub struct PluginHostState {
    data: Mutex<PersistedPluginState>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    catalog_version: u8,
    plugins: Vec<CatalogPlugin>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogPlugin {
    id: String,
    name: String,
    description: String,
    version: String,
    manifest_version: u8,
    sdk_version: String,
    min_app_version: String,
    publisher_type: String,
    source: CatalogSource,
    files: Vec<CatalogFile>,
}

#[derive(Debug, Clone, Deserialize)]
struct CatalogSource {
    repository: String,
    #[serde(rename = "ref")]
    git_ref: String,
    path: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CatalogFile {
    path: String,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    manifest_version: u8,
    id: String,
    name: String,
    description: String,
    version: String,
    sdk_version: String,
    runtime: String,
    entry: String,
    min_app_version: String,
    #[serde(default)]
    permissions: Vec<String>,
    #[serde(default)]
    events: Vec<String>,
    #[serde(default)]
    config_schema: BTreeMap<String, ConfigField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigField {
    #[serde(rename = "type")]
    field_type: String,
    label: String,
    default: Value,
    min: Option<f64>,
    max: Option<f64>,
    step: Option<f64>,
    max_length: Option<usize>,
    #[serde(default)]
    options: Vec<ConfigOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigOption {
    value: Value,
    label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSnapshot {
    id: String,
    name: String,
    description: String,
    version: String,
    installed_version: Option<String>,
    latest_version: Option<String>,
    sdk_version: String,
    min_app_version: String,
    publisher_type: String,
    installed: bool,
    enabled: bool,
    active: bool,
    update_available: bool,
    configurable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfigSnapshot {
    id: String,
    name: String,
    schema: BTreeMap<String, ConfigField>,
    values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePlugin {
    id: String,
    version: String,
    source: String,
    permissions: Vec<String>,
    config: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEvent {
    name: String,
    plugin_ids: Vec<String>,
    payload: Value,
}

impl PluginHostState {
    pub fn load(app: &AppHandle) -> Self {
        let data = plugin_state_path(app)
            .ok()
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|raw| serde_json::from_str::<PersistedPluginState>(&raw).ok())
            .unwrap_or_default();
        Self { data: Mutex::new(data) }
    }
}

fn plugin_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(STATE_FILE))
        .map_err(|error| error.to_string())
}

fn plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("plugins"))
        .map_err(|error| error.to_string())
}

fn validate_plugin_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 120
        || !id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '_'))
    {
        return Err("invalid plugin id".into());
    }
    Ok(())
}

fn plugin_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    validate_plugin_id(id)?;
    Ok(plugins_dir(app)?.join(id))
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if path.is_absolute() || value.is_empty() {
        return Err("invalid plugin file path".into());
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err("plugin file path escapes package root".into());
        }
    }
    Ok(path.to_path_buf())
}

fn persist(app: &AppHandle, data: &PersistedPluginState) -> Result<(), String> {
    let path = plugin_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(data).map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn load_manifest(app: &AppHandle, id: &str) -> Result<PluginManifest, String> {
    let path = plugin_dir(app, id)?.join(MANIFEST_FILE);
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| format!("invalid plugin manifest: {error}"))
}

fn effective_config(manifest: &PluginManifest, installed: &InstalledPlugin) -> BTreeMap<String, Value> {
    let mut values = manifest
        .config_schema
        .iter()
        .map(|(key, field)| (key.clone(), field.default.clone()))
        .collect::<BTreeMap<_, _>>();
    for (key, value) in &installed.config {
        if manifest.config_schema.contains_key(key) {
            values.insert(key.clone(), value.clone());
        }
    }
    values
}

fn validate_config_value(field: &ConfigField, value: &Value) -> Result<(), String> {
    match field.field_type.as_str() {
        "boolean" if !value.is_boolean() => return Err(format!("{} must be a boolean", field.label)),
        "number" => {
            let number = value.as_f64().ok_or_else(|| format!("{} must be a number", field.label))?;
            if let Some(min) = field.min {
                if number < min { return Err(format!("{} must be >= {min}", field.label)); }
            }
            if let Some(max) = field.max {
                if number > max { return Err(format!("{} must be <= {max}", field.label)); }
            }
        }
        "text" => {
            let text = value.as_str().ok_or_else(|| format!("{} must be text", field.label))?;
            if let Some(max_length) = field.max_length {
                if text.chars().count() > max_length {
                    return Err(format!("{} is too long", field.label));
                }
            }
        }
        "select" => {
            if !field.options.iter().any(|option| option.value == *value) {
                return Err(format!("{} has an invalid option", field.label));
            }
        }
        "boolean" | "number" | "text" | "select" => {}
        _ => return Err(format!("unsupported config field type: {}", field.field_type)),
    }
    Ok(())
}

fn validate_config(
    manifest: &PluginManifest,
    values: &BTreeMap<String, Value>,
) -> Result<BTreeMap<String, Value>, String> {
    let mut next = BTreeMap::new();
    for (key, field) in &manifest.config_schema {
        let value = values.get(key).cloned().unwrap_or_else(|| field.default.clone());
        validate_config_value(field, &value)?;
        next.insert(key.clone(), value);
    }
    if values.keys().any(|key| !manifest.config_schema.contains_key(key)) {
        return Err("plugin config contains unknown fields".into());
    }
    Ok(next)
}

fn version_parts(value: &str) -> Vec<u64> {
    value
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(|value| value.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

fn is_newer(candidate: &str, current: &str) -> bool {
    let left = version_parts(candidate);
    let right = version_parts(current);
    let count = left.len().max(right.len());
    for index in 0..count {
        let a = *left.get(index).unwrap_or(&0);
        let b = *right.get(index).unwrap_or(&0);
        if a != b { return a > b; }
    }
    false
}

fn app_meets_minimum(app: &AppHandle, minimum: &str) -> bool {
    !is_newer(minimum, &app.package_info().version.to_string())
}

async fn http_bytes(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("furinapet-plugin-host/1")
        .build()
        .map_err(|error| error.to_string())?;
    let response = client.get(url).send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("plugin repository returned HTTP {}", response.status()));
    }
    response.bytes().await.map(|bytes| bytes.to_vec()).map_err(|error| error.to_string())
}

async fn fetch_catalog_inner() -> Result<Catalog, String> {
    let bytes = http_bytes(CATALOG_URL).await?;
    let catalog: Catalog = serde_json::from_slice(&bytes).map_err(|error| format!("invalid plugin catalog: {error}"))?;
    if catalog.catalog_version != 1 {
        return Err(format!("unsupported plugin catalog version: {}", catalog.catalog_version));
    }
    Ok(catalog)
}

fn snapshot_from_manifest(
    manifest: &PluginManifest,
    installed: &InstalledPlugin,
    latest: Option<&CatalogPlugin>,
) -> PluginSnapshot {
    let latest_version = latest.map(|plugin| plugin.version.clone());
    let update_available = latest_version
        .as_deref()
        .map(|version| is_newer(version, &installed.version))
        .unwrap_or(false);
    PluginSnapshot {
        id: manifest.id.clone(),
        name: latest.map(|plugin| plugin.name.clone()).unwrap_or_else(|| manifest.name.clone()),
        description: latest
            .map(|plugin| plugin.description.clone())
            .unwrap_or_else(|| manifest.description.clone()),
        version: latest_version.clone().unwrap_or_else(|| installed.version.clone()),
        installed_version: Some(installed.version.clone()),
        latest_version,
        sdk_version: manifest.sdk_version.clone(),
        min_app_version: manifest.min_app_version.clone(),
        publisher_type: latest.map(|plugin| plugin.publisher_type.clone()).unwrap_or_else(|| "local".into()),
        installed: true,
        enabled: installed.enabled,
        active: installed.enabled,
        update_available,
        configurable: !manifest.config_schema.is_empty(),
    }
}

fn snapshot_from_catalog(plugin: &CatalogPlugin) -> PluginSnapshot {
    PluginSnapshot {
        id: plugin.id.clone(),
        name: plugin.name.clone(),
        description: plugin.description.clone(),
        version: plugin.version.clone(),
        installed_version: None,
        latest_version: Some(plugin.version.clone()),
        sdk_version: plugin.sdk_version.clone(),
        min_app_version: plugin.min_app_version.clone(),
        publisher_type: plugin.publisher_type.clone(),
        installed: false,
        enabled: false,
        active: false,
        update_available: false,
        configurable: false,
    }
}

#[tauri::command]
pub fn list_plugins(
    app: AppHandle,
    state: State<'_, PluginHostState>,
) -> Result<Vec<PluginSnapshot>, String> {
    let data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?.clone();
    let mut result = Vec::new();
    for (id, installed) in &data.installed {
        if let Ok(manifest) = load_manifest(&app, id) {
            result.push(snapshot_from_manifest(&manifest, installed, None));
        }
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

#[tauri::command]
pub async fn fetch_plugin_catalog(
    app: AppHandle,
    state: State<'_, PluginHostState>,
) -> Result<Vec<PluginSnapshot>, String> {
    let catalog = fetch_catalog_inner().await?;
    let data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?.clone();
    let mut result = Vec::new();

    for remote in &catalog.plugins {
        if let Some(installed) = data.installed.get(&remote.id) {
            match load_manifest(&app, &remote.id) {
                Ok(manifest) => result.push(snapshot_from_manifest(&manifest, installed, Some(remote))),
                Err(_) => result.push(snapshot_from_catalog(remote)),
            }
        } else {
            result.push(snapshot_from_catalog(remote));
        }
    }

    for (id, installed) in &data.installed {
        if catalog.plugins.iter().any(|plugin| plugin.id == *id) { continue; }
        if let Ok(manifest) = load_manifest(&app, id) {
            result.push(snapshot_from_manifest(&manifest, installed, None));
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn install_plugin(
    app: AppHandle,
    state: State<'_, PluginHostState>,
    id: String,
) -> Result<(), String> {
    validate_plugin_id(&id)?;
    let catalog = fetch_catalog_inner().await?;
    let plugin = catalog
        .plugins
        .into_iter()
        .find(|plugin| plugin.id == id)
        .ok_or_else(|| "plugin is not present in the official catalog".to_string())?;

    if plugin.source.repository != OFFICIAL_REPOSITORY {
        return Err("v1 only accepts the official FurinaPet plugin repository".into());
    }
    if !app_meets_minimum(&app, &plugin.min_app_version) {
        return Err(format!("requires FurinaPet {} or newer", plugin.min_app_version));
    }
    if plugin.manifest_version != 1 {
        return Err("unsupported plugin manifest version".into());
    }

    let root = plugins_dir(&app)?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let stage = root.join(format!(".installing-{}", plugin.id));
    if stage.exists() { fs::remove_dir_all(&stage).map_err(|error| error.to_string())?; }
    fs::create_dir_all(&stage).map_err(|error| error.to_string())?;

    let mut manifest: Option<PluginManifest> = None;
    for file in &plugin.files {
        let relative = safe_relative_path(&file.path)?;
        let url = format!(
            "https://raw.githubusercontent.com/{}/{}/{}/{}",
            plugin.source.repository, plugin.source.git_ref, plugin.source.path, file.path
        );
        let bytes = http_bytes(&url).await?;
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if !actual.eq_ignore_ascii_case(&file.sha256) {
            let _ = fs::remove_dir_all(&stage);
            return Err(format!("SHA-256 mismatch for {}", file.path));
        }
        let destination = stage.join(&relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&destination, &bytes).map_err(|error| error.to_string())?;
        if file.path == MANIFEST_FILE {
            manifest = Some(serde_json::from_slice(&bytes).map_err(|error| format!("invalid manifest: {error}"))?);
        }
    }

    let manifest = manifest.ok_or("plugin package is missing furinapet.plugin.json")?;
    if manifest.id != plugin.id
        || manifest.version != plugin.version
        || manifest.manifest_version != plugin.manifest_version
        || manifest.sdk_version != plugin.sdk_version
        || manifest.min_app_version != plugin.min_app_version
    {
        let _ = fs::remove_dir_all(&stage);
        return Err("plugin manifest does not match catalog metadata".into());
    }
    if manifest.runtime != "javascript" {
        let _ = fs::remove_dir_all(&stage);
        return Err("unsupported plugin runtime".into());
    }
    let entry = safe_relative_path(&manifest.entry)?;
    if !stage.join(entry).is_file() {
        let _ = fs::remove_dir_all(&stage);
        return Err("plugin entry file is missing".into());
    }

    let destination = plugin_dir(&app, &plugin.id)?;
    let backup = root.join(format!(".backup-{}", plugin.id));
    if backup.exists() { fs::remove_dir_all(&backup).map_err(|error| error.to_string())?; }
    if destination.exists() {
        fs::rename(&destination, &backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&stage, &destination) {
        if backup.exists() { let _ = fs::rename(&backup, &destination); }
        return Err(error.to_string());
    }
    if backup.exists() { let _ = fs::remove_dir_all(&backup); }

    let mut data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?;
    let previous = data.installed.remove(&plugin.id).unwrap_or_default();
    let effective = effective_config(&manifest, &previous);
    data.installed.insert(plugin.id.clone(), InstalledPlugin {
        version: plugin.version,
        enabled: previous.enabled,
        config: effective,
        storage: previous.storage,
    });
    persist(&app, &data)
}

#[tauri::command]
pub fn uninstall_plugin(
    app: AppHandle,
    state: State<'_, PluginHostState>,
    id: String,
) -> Result<(), String> {
    let directory = plugin_dir(&app, &id)?;
    if directory.exists() {
        fs::remove_dir_all(directory).map_err(|error| error.to_string())?;
    }
    let mut data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?;
    data.installed.remove(&id);
    persist(&app, &data)
}

#[tauri::command]
pub fn set_plugin_enabled(
    app: AppHandle,
    state: State<'_, PluginHostState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let _manifest = load_manifest(&app, &id)?;
    let mut data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?;
    let plugin = data.installed.get_mut(&id).ok_or("plugin is not installed")?;
    plugin.enabled = enabled;
    persist(&app, &data)
}

#[tauri::command]
pub fn get_plugin_config(
    app: AppHandle,
    state: State<'_, PluginHostState>,
    id: String,
) -> Result<PluginConfigSnapshot, String> {
    let manifest = load_manifest(&app, &id)?;
    let data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?;
    let installed = data.installed.get(&id).ok_or("plugin is not installed")?;
    Ok(PluginConfigSnapshot {
        id,
        name: manifest.name.clone(),
        schema: manifest.config_schema.clone(),
        values: effective_config(&manifest, installed),
    })
}

#[tauri::command]
pub fn set_plugin_config(
    app: AppHandle,
    state: State<'_, PluginHostState>,
    id: String,
    values: BTreeMap<String, Value>,
) -> Result<(), String> {
    let manifest = load_manifest(&app, &id)?;
    let values = validate_config(&manifest, &values)?;
    let mut data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?;
    let installed = data.installed.get_mut(&id).ok_or("plugin is not installed")?;
    installed.config = values;
    persist(&app, &data)
}

#[tauri::command]
pub fn list_runtime_plugins(
    app: AppHandle,
    state: State<'_, PluginHostState>,
) -> Result<Vec<RuntimePlugin>, String> {
    let data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?.clone();
    let mut result = Vec::new();
    for (id, installed) in data.installed {
        if !installed.enabled { continue; }
        let manifest = match load_manifest(&app, &id) {
            Ok(value) if value.runtime == "javascript" => value,
            _ => continue,
        };
        let entry = safe_relative_path(&manifest.entry)?;
        let source = fs::read_to_string(plugin_dir(&app, &id)?.join(entry)).map_err(|error| error.to_string())?;
        result.push(RuntimePlugin {
            id,
            version: installed.version,
            source,
            permissions: manifest.permissions.clone(),
            config: effective_config(&manifest, &installed),
        });
    }
    Ok(result)
}

fn ensure_sdk_permission(manifest: &PluginManifest, permission: &str) -> Result<(), String> {
    if manifest.permissions.iter().any(|value| value == permission) {
        Ok(())
    } else {
        Err(format!("plugin permission denied: {permission}"))
    }
}

#[tauri::command]
pub fn plugin_sdk_call(
    app: AppHandle,
    state: State<'_, PluginHostState>,
    id: String,
    method: String,
    args: Value,
) -> Result<Value, String> {
    let manifest = load_manifest(&app, &id)?;
    {
        let data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?;
        let installed = data.installed.get(&id).ok_or("plugin is not installed")?;
        if !installed.enabled { return Err("plugin is disabled".into()); }
    }

    match method.as_str() {
        "pet.react" => {
            ensure_sdk_permission(&manifest, "pet:reaction")?;
            let reaction = args.get("reaction").and_then(Value::as_str).ok_or("reaction is required")?;
            let message = args.get("message").and_then(Value::as_str).map(str::to_owned);
            commands::trigger_reaction_inner(&app, reaction.to_owned(), message)?;
            Ok(Value::Null)
        }
        "storage.get" => {
            ensure_sdk_permission(&manifest, "storage")?;
            let key = args.get("key").and_then(Value::as_str).ok_or("storage key is required")?;
            if key.len() > 120 { return Err("storage key is too long".into()); }
            let data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?;
            let installed = data.installed.get(&id).ok_or("plugin is not installed")?;
            Ok(installed.storage.get(key).cloned().unwrap_or(Value::Null))
        }
        "storage.set" => {
            ensure_sdk_permission(&manifest, "storage")?;
            let key = args.get("key").and_then(Value::as_str).ok_or("storage key is required")?;
            if key.len() > 120 { return Err("storage key is too long".into()); }
            let value = args.get("value").cloned().unwrap_or(Value::Null);
            if serde_json::to_vec(&value).map_err(|error| error.to_string())?.len() > 64 * 1024 {
                return Err("storage value is too large".into());
            }
            let mut data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?;
            let installed = data.installed.get_mut(&id).ok_or("plugin is not installed")?;
            installed.storage.insert(key.to_owned(), value);
            persist(&app, &data)?;
            Ok(Value::Null)
        }
        _ => Err(format!("unsupported plugin SDK method: {method}")),
    }
}

#[tauri::command]
pub fn publish_pet_event(
    app: AppHandle,
    state: State<'_, PluginHostState>,
    name: String,
) -> Result<bool, String> {
    let data = state.data.lock().map_err(|_| "plugin host lock is poisoned")?.clone();
    let mut targets = Vec::new();
    for (id, installed) in data.installed {
        if !installed.enabled { continue; }
        let manifest = match load_manifest(&app, &id) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if manifest.events.iter().any(|event| event == &name)
            && manifest.permissions.iter().any(|permission| permission == "events:pet")
        {
            targets.push(id);
        }
    }
    if targets.is_empty() { return Ok(false); }
    app.emit_to("main", "plugin-runtime-event", RuntimeEvent {
        name,
        plugin_ids: targets,
        payload: json!({}),
    }).map_err(|error| error.to_string())?;
    Ok(true)
}
