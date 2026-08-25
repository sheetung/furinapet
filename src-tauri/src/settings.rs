use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
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
    let mut value: Settings = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default();
    value.enforce_motion_mode();
    value
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let content = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}