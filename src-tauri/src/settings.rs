use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub schema_version: u32,
    pub selected_character_id: String,
    pub pet_visible: bool,
    pub always_on_top: bool,
    pub launch_at_login: bool,
    pub scale: f64,
    pub look_at_cursor: bool,
    pub autonomous_movement: bool,
    pub wander_weight: f64,
    pub dock_weight: f64,
    pub wander_speed: f64,
    pub gravity_enabled: bool,
    pub window_docking: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            selected_character_id: "furina".into(),
            pet_visible: true,
            always_on_top: true,
            launch_at_login: false,
            scale: 1.0,
            look_at_cursor: true,
            autonomous_movement: false,
            wander_weight: 0.65,
            dock_weight: 0.45,
            wander_speed: 1.0,
            gravity_enabled: true,
            window_docking: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub selected_character_id: Option<String>,
    pub pet_visible: Option<bool>,
    pub always_on_top: Option<bool>,
    pub launch_at_login: Option<bool>,
    pub scale: Option<f64>,
    pub look_at_cursor: Option<bool>,
    pub autonomous_movement: Option<bool>,
    pub wander_weight: Option<f64>,
    pub dock_weight: Option<f64>,
    pub wander_speed: Option<f64>,
    pub gravity_enabled: Option<bool>,
    pub window_docking: Option<bool>,
}

impl Settings {
    fn enforce_motion_mode(&mut self) {
        if self.gravity_enabled && self.window_docking {
            self.window_docking = false;
        }
    }

    pub fn apply(&mut self, patch: SettingsPatch) -> Result<(), String> {
        if let Some(value) = patch.selected_character_id {
            let valid = !value.is_empty()
                && value.len() <= 48
                && !value.ends_with('-')
                && value.bytes().enumerate().all(|(index, byte)| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || (byte == b'-' && index > 0)
                });
            if !valid { return Err("selectedCharacterId is invalid".into()); }
            self.selected_character_id = value;
        }
        if let Some(value) = patch.pet_visible { self.pet_visible = value; }
        if let Some(value) = patch.always_on_top { self.always_on_top = value; }
        if let Some(value) = patch.launch_at_login { self.launch_at_login = value; }
        if let Some(value) = patch.look_at_cursor { self.look_at_cursor = value; }
        if let Some(value) = patch.autonomous_movement { self.autonomous_movement = value; }
        if let Some(value) = patch.gravity_enabled {
            self.gravity_enabled = value;
            if value { self.window_docking = false; }
        }
        if let Some(value) = patch.window_docking {
            self.window_docking = value;
            if value { self.gravity_enabled = false; }
        }
        if let Some(value) = patch.scale {
            if !(0.65..=1.5).contains(&value) { return Err("scale must be between 0.65 and 1.5".into()); }
            self.scale = (value * 20.0).round() / 20.0;
        }
        if let Some(value) = patch.wander_speed {
            if !(0.6..=1.8).contains(&value) { return Err("wanderSpeed must be between 0.6 and 1.8".into()); }
            self.wander_speed = (value * 10.0).round() / 10.0;
        }
        if let Some(value) = patch.wander_weight {
            if !(0.0..=1.0).contains(&value) { return Err("wanderWeight must be between 0 and 1".into()); }
            self.wander_weight = (value * 20.0).round() / 20.0;
        }
        if let Some(value) = patch.dock_weight {
            if !(0.0..=1.0).contains(&value) { return Err("dockWeight must be between 0 and 1".into()); }
            self.dock_weight = (value * 20.0).round() / 20.0;
        }
        self.enforce_motion_mode();
        Ok(())
    }
}

pub struct AppState {
    pub settings: Mutex<Settings>,
}

impl AppState {
    pub fn new(settings: Settings) -> Self { Self { settings: Mutex::new(settings) } }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map(|dir| dir.join("settings.json")).map_err(|error| error.to_string())
}

pub fn load(app: &AppHandle) -> Settings {
    let Ok(path) = settings_path(app) else { return Settings::default(); };
    load_path(&path)
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    save_path(&path, settings)
}

fn decode(content: &str) -> Result<Settings, String> {
    let mut value: Settings = serde_json::from_str(content).map_err(|e| e.to_string())?;
    if value.schema_version > 1 { return Err("Settings belong to a newer application".into()); }
    // v0/legacy files have the same field names; missing fields use safe defaults.
    value.schema_version = 1;
    let defaults = Settings::default();
    if !(0.65..=1.5).contains(&value.scale) { value.scale = defaults.scale; }
    if !(0.6..=1.8).contains(&value.wander_speed) { value.wander_speed = defaults.wander_speed; }
    if !(0.0..=1.0).contains(&value.wander_weight) { value.wander_weight = defaults.wander_weight; }
    if !(0.0..=1.0).contains(&value.dock_weight) { value.dock_weight = defaults.dock_weight; }
    value.enforce_motion_mode();
    Ok(value)
}

fn load_path(path: &std::path::Path) -> Settings {
    if let Ok(content) = fs::read_to_string(path) {
        match decode(&content) {
            Ok(value) => return value,
            Err(error) => {
                eprintln!("[settings] {error}; recovering backup");
                let _ = fs::copy(path, path.with_extension(format!("invalid-{}.json", uuid::Uuid::new_v4())));
            }
        }
    }
    fs::read_to_string(path.with_extension("bak"))
        .ok().and_then(|content| decode(&content).ok()).unwrap_or_default()
}

static SAVE_LOCK: Mutex<()> = Mutex::new(());
fn save_path(path: &std::path::Path, settings: &Settings) -> Result<(), String> {
    use std::io::Write;
    let _guard = SAVE_LOCK.lock().map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    if let Ok(content) = fs::read_to_string(path) {
        let raw: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
        if raw["schemaVersion"].as_u64().unwrap_or(0) > 1 {
            return Err("配置来自较新版本，请升级应用后再保存。".into());
        }
        if decode(&content).is_ok() {
            fs::copy(path, path.with_extension("bak")).map_err(|e| e.to_string())?;
        }
    }
    let content = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(&content)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self { Self(std::env::temp_dir().join(format!("furinapet-settings-test-{}", uuid::Uuid::new_v4()))) }
        fn path(&self) -> PathBuf { self.0.join("settings.json") }
    }
    impl Drop for Directory { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn migrates_legacy_and_normalizes_ranges() {
        let settings = decode(r#"{"scale":99,"petVisible":false,"gravityEnabled":true,"windowDocking":true}"#).unwrap();
        assert_eq!(settings.schema_version, 1);
        assert_eq!(settings.scale, 1.0);
        assert!(!settings.pet_visible);
        assert!(!settings.window_docking);
    }
    #[test]
    fn replaces_existing_file_and_recovers_previous_backup() {
        let directory = Directory::new(); let path = directory.path();
        let first = Settings { scale: 0.8, ..Settings::default() };
        save_path(&path, &first).unwrap();
        save_path(&path, &Settings::default()).unwrap();
        assert_eq!(load_path(&path).scale, 1.0);
        fs::write(&path, "{broken").unwrap();
        assert_eq!(load_path(&path).scale, 0.8);
        assert!(fs::read_dir(&directory.0).unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().contains("invalid-")));
    }
    #[test]
    fn never_overwrites_future_configuration() {
        let directory = Directory::new(); let path = directory.path();
        fs::create_dir_all(&directory.0).unwrap();
        let future = r#"{"schemaVersion":2,"newField":"preserve"}"#;
        fs::write(&path, future).unwrap();
        assert!(save_path(&path, &Settings::default()).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), future);
    }
}
